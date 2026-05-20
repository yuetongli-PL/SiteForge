import path from 'node:path';

const OBSERVED_HEADER_ALLOWLIST = new Set([
  'accept',
  'accept-language',
  'cache-control',
  'origin',
  'pragma',
  'priority',
  'referer',
  'sec-ch-ua',
  'sec-ch-ua-mobile',
  'sec-ch-ua-platform',
  'sec-fetch-dest',
  'sec-fetch-mode',
  'sec-fetch-site',
  'upgrade-insecure-requests',
  'user-agent',
]);

function normalizeText(value) {
  return String(value ?? '').trim();
}

function normalizeHeaderName(name) {
  return normalizeText(name).toLowerCase();
}

function isDouyinHttpUrl(value) {
  try {
    const parsed = new URL(String(value));
    return /^https?:$/i.test(parsed.protocol) && /(^|\.)douyin\.com$/i.test(parsed.hostname);
  } catch {
    return false;
  }
}

function filterObservedHeaders(headers) {
  const filtered = {};
  for (const [rawName, rawValue] of Object.entries(headers ?? {})) {
    const name = normalizeHeaderName(rawName);
    const value = normalizeText(rawValue);
    if (!name || !value || !OBSERVED_HEADER_ALLOWLIST.has(name)) {
      continue;
    }
    filtered[name] = value;
  }
  return filtered;
}

function buildAcceptLanguage(navigatorInfo = {}) {
  const languages = Array.isArray(navigatorInfo.languages)
    ? navigatorInfo.languages.map((value) => normalizeText(value)).filter(Boolean)
    : [];
  if (languages.length) {
    return languages.join(',');
  }
  return normalizeText(navigatorInfo.language);
}

function deriveSafeHeaders({
  browserVersion,
  navigatorInfo,
  pageInfo,
  observedNavigationHeaders,
}) {
  const headers = {};
  const observed = filterObservedHeaders(observedNavigationHeaders);
  const userAgent = normalizeText(observed['user-agent'])
    || normalizeText(navigatorInfo?.userAgent)
    || normalizeText(browserVersion?.userAgent);
  if (userAgent) {
    headers['user-agent'] = userAgent;
  }

  const acceptLanguage = normalizeText(observed['accept-language']) || buildAcceptLanguage(navigatorInfo);
  if (acceptLanguage) {
    headers['accept-language'] = acceptLanguage;
  }

  const finalUrl = normalizeText(pageInfo?.url);
  if (isDouyinHttpUrl(finalUrl)) {
    headers.referer = normalizeText(observed.referer) || finalUrl;
    try {
      headers.origin = normalizeText(observed.origin) || new URL(finalUrl).origin;
    } catch {
      // Ignore origin derivation failures.
    }
  }

  return {
    safeDefaultHeaders: headers,
    observedRequestHeaders: observed,
  };
}

function resolveSidecarPath(cookieFilePath) {
  const resolved = path.resolve(cookieFilePath);
  if (resolved.toLowerCase().endsWith('.txt')) {
    return `${resolved.slice(0, -4)}.headers.json`;
  }
  return `${resolved}.headers.json`;
}

async function createSessionTarget(client, inputUrl, timeoutMs) {
  const target = await client.send('Target.createTarget', {
    url: 'about:blank',
    newWindow: false,
    background: true,
  });
  const targetId = target?.targetId;
  if (!targetId) {
    throw new Error('Failed to create a CDP target for Douyin live export.');
  }
  const attach = await client.send('Target.attachToTarget', { targetId, flatten: true });
  const sessionId = attach?.sessionId;
  if (!sessionId) {
    throw new Error('Failed to attach to the CDP target for Douyin live export.');
  }

  const cleanup = async () => {
    try {
      await client.send('Target.closeTarget', { targetId });
    } catch {
      // Ignore target cleanup failures.
    }
  };

  try {
    await client.send('Page.enable', {}, sessionId);
    await client.send('Runtime.enable', {}, sessionId);
    await client.send('Network.enable', {}, sessionId);

    const requestHeadersById = new Map();
    let documentRequestId = null;
    let navigationRequest = null;

    const offRequest = client.on(
      'Network.requestWillBeSent',
      ({ params }) => {
        const requestId = normalizeText(params?.requestId);
        if (requestId) {
          requestHeadersById.set(requestId, filterObservedHeaders(params?.request?.headers ?? {}));
        }
        if (params?.type !== 'Document') {
          return;
        }
        const url = normalizeText(params?.request?.url);
        if (!isDouyinHttpUrl(url)) {
          return;
        }
        documentRequestId = requestId || documentRequestId;
        navigationRequest = {
          url,
          method: normalizeText(params?.request?.method) || 'GET',
          headers: filterObservedHeaders(params?.request?.headers ?? {}),
        };
      },
      { sessionId },
    );

    const offExtraInfo = client.on(
      'Network.requestWillBeSentExtraInfo',
      ({ params }) => {
        const requestId = normalizeText(params?.requestId);
        if (!requestId) {
          return;
        }
        const existing = requestHeadersById.get(requestId) ?? {};
        requestHeadersById.set(requestId, {
          ...existing,
          ...filterObservedHeaders(params?.headers ?? {}),
        });
      },
      { sessionId },
    );

    try {
      const loadEvent = client.waitForEvent('Page.loadEventFired', {
        sessionId,
        timeoutMs,
      });
      await client.send('Page.navigate', { url: inputUrl }, sessionId, timeoutMs);
      await loadEvent.catch(() => null);
      await new Promise((resolve) => setTimeout(resolve, 750));
    } finally {
      offRequest();
      offExtraInfo();
    }

    const browserVersion = await client.send('Browser.getVersion');
    const runtimeResult = await client.send(
      'Runtime.evaluate',
      {
        returnByValue: true,
        expression: `(() => ({
          navigatorUserAgent: navigator.userAgent || '',
          navigatorLanguage: navigator.language || '',
          navigatorLanguages: Array.isArray(navigator.languages) ? navigator.languages : [],
          navigatorPlatform: navigator.platform || '',
          locationHref: location.href || '',
          locationOrigin: location.origin || '',
          documentReferrer: document.referrer || ''
        }))()`,
      },
      sessionId,
      timeoutMs,
    );

    const runtimeValue = runtimeResult?.result?.value ?? {};
    const mergedObservedHeaders = documentRequestId
      ? requestHeadersById.get(documentRequestId) ?? navigationRequest?.headers ?? {}
      : navigationRequest?.headers ?? {};
    const pageInfo = {
      url: normalizeText(runtimeValue.locationHref) || normalizeText(inputUrl),
      origin: normalizeText(runtimeValue.locationOrigin),
      referrer: normalizeText(runtimeValue.documentReferrer),
    };
    const navigatorInfo = {
      userAgent: normalizeText(runtimeValue.navigatorUserAgent),
      language: normalizeText(runtimeValue.navigatorLanguage),
      languages: Array.isArray(runtimeValue.navigatorLanguages) ? runtimeValue.navigatorLanguages : [],
      platform: normalizeText(runtimeValue.navigatorPlatform),
    };
    const headerBundle = deriveSafeHeaders({
      browserVersion,
      navigatorInfo,
      pageInfo,
      observedNavigationHeaders: mergedObservedHeaders,
    });

    return {
      browserVersion: {
        product: normalizeText(browserVersion?.product),
        revision: normalizeText(browserVersion?.revision),
        userAgent: normalizeText(browserVersion?.userAgent),
        jsVersion: normalizeText(browserVersion?.jsVersion),
      },
      navigator: navigatorInfo,
      page: {
        ...pageInfo,
        navigationRequestUrl: normalizeText(navigationRequest?.url),
        navigationMethod: normalizeText(navigationRequest?.method) || 'GET',
      },
      headers: headerBundle.safeDefaultHeaders,
      observedRequestHeaders: headerBundle.observedRequestHeaders,
    };
  } finally {
    await cleanup();
  }
}

export {
  createSessionTarget,
  deriveSafeHeaders,
  resolveSidecarPath,
};
