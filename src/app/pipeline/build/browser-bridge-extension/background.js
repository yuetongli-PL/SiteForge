const activeTabs = new Map();
const SITEFORGE_BRIDGE_EXTENSION_VERSION = 'route-queue-x-api-runtime-v8';
const SITEFORGE_COLLECT_MESSAGE_TYPE = `siteforge-collect-structure:${SITEFORGE_BRIDGE_EXTENSION_VERSION}`;
const ROUTE_COLLECT_FALLBACK_DELAY_MS = 6500;
const ROUTE_STABLE_AFTER_COMPLETE_MS = 1500;
const TAB_STABLE_MAX_POLLS = 16;
const TAB_STABLE_POLL_MS = 500;
const COLLECTOR_READY_DELAY_MS = 250;
const COLLECTOR_RETRY_BACKOFF_MS = [1000, 3000, 7000];
const API_REPLAY_READY_DELAY_MS = 1000;

function timingValue(session, key, fallback, min, max) {
  const value = Number(session?.timing?.[key]);
  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function safeUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return ['http:', 'https:'].includes(url.protocol) ? url : null;
  } catch {
    return null;
  }
}

function allowedHostSet(allowedHost, allowedHosts = []) {
  return new Set([
    allowedHost,
    ...(Array.isArray(allowedHosts) ? allowedHosts : []),
  ].map((host) => String(host || '').trim()).filter(Boolean));
}

function sameAllowedHost(urlValue, allowedHost, allowedHosts = []) {
  const parsed = safeUrl(urlValue);
  return Boolean(parsed && allowedHostSet(allowedHost, allowedHosts).has(parsed.hostname));
}

function routePath(urlValue) {
  const parsed = safeUrl(urlValue);
  if (!parsed) {
    return '';
  }
  return parsed.pathname.replace(/\/+$/u, '') || '/';
}

function sameRoutePath(urlValue, targetUrl) {
  const parsed = safeUrl(urlValue);
  const target = safeUrl(targetUrl);
  return Boolean(parsed && target && routePath(parsed.toString()) === routePath(target.toString()));
}

function loginLikeUrl(urlValue) {
  const parsed = safeUrl(urlValue);
  if (!parsed) {
    return false;
  }
  return /\/(?:login|signin|sign-in|auth|account\/login|passport)(?:\/|$)/iu.test(parsed.pathname);
}

function sessionKey(session) {
  return String(session?.nonce || '');
}

async function signal(session, stage) {
  if (!session?.extensionStatusUrl) {
    return;
  }
  try {
    const url = new URL(session.extensionStatusUrl);
    url.searchParams.set('stage', stage);
    await fetch(url.toString(), { method: 'POST', credentials: 'omit', cache: 'no-store' });
  } catch {
    // Diagnostics are best-effort; structure submission remains authoritative.
  }
}

function normalizedRoutes(session) {
  const baseTarget = safeUrl(session?.targetUrl);
  const routes = Array.isArray(session?.routes) && session.routes.length
    ? session.routes
    : [{
      id: 'route-1',
      targetUrl: session?.targetUrl,
      sourceLayer: session?.sourceLayer || 'authenticated',
      allowedHost: session?.allowedHost,
      allowedOrigin: session?.allowedOrigin,
    }];
  return routes
    .map((route, index) => {
      const target = safeUrl(route?.targetUrl);
      const allowedHost = String(route?.allowedHost || session?.allowedHost || baseTarget?.hostname || '');
      const allowedHosts = [...allowedHostSet(allowedHost, [
        ...(route?.allowedHosts || []),
        ...(session?.allowedHosts || []),
      ])];
      if (!target || !allowedHosts.includes(target.hostname)) {
        return null;
      }
      return {
        id: String(route?.id || `route-${index + 1}`),
        targetUrl: target.toString(),
        sourceLayer: route?.sourceLayer === 'authenticated_overlay' ? 'authenticated_overlay' : 'authenticated',
        allowedHost,
        allowedHosts,
        allowedOrigin: String(route?.allowedOrigin || target.origin),
        allowLoginLikeCapture: route?.allowLoginLikeCapture === true || session?.allowLoginLikeCapture === true,
      };
    })
    .filter(Boolean);
}

function routeSession(session, route) {
  return {
    ...session,
    routeId: route.id,
    targetUrl: route.targetUrl,
    sourceLayer: route.sourceLayer,
    allowedHost: route.allowedHost,
    allowedHosts: route.allowedHosts,
    allowedOrigin: route.allowedOrigin,
  };
}

function normalizedApiReplay(session) {
  const apiReplay = session?.apiReplay || null;
  const endpoint = safeUrl(apiReplay?.endpoint);
  const endpointTemplate = String(apiReplay?.endpointTemplate || apiReplay?.runtimeEndpoint || apiReplay?.endpoint || '');
  const pageUrl = safeUrl(apiReplay?.pageUrl || (endpoint ? `${endpoint.origin}/` : ''));
  const method = String(apiReplay?.method || 'GET').toUpperCase();
  const allowedHost = String(apiReplay?.allowedHost || endpoint?.hostname || '');
  if (!endpoint || !pageUrl || !['GET', 'HEAD'].includes(method)) {
    return null;
  }
  if (endpoint.hostname !== allowedHost || pageUrl.hostname !== allowedHost) {
    return null;
  }
  const credentials = ['include', 'same-origin'].includes(String(apiReplay?.fetchOptions?.credentials || 'include'))
    ? String(apiReplay.fetchOptions.credentials)
    : 'include';
  return {
    id: String(apiReplay?.id || 'api-replay-1'),
    endpoint: endpoint.toString(),
    pageUrl: pageUrl.toString(),
    method,
    allowedHost,
    endpointTemplate,
    runtimeParameterSource: apiReplay?.runtimeParameterSource || null,
    responseEvidence: apiReplay?.responseEvidence || null,
    fetchOptions: {
      credentials,
    },
    extensionStatusUrl: session?.extensionStatusUrl || '',
  };
}

function clearFallbackTimer(state) {
  if (state?.fallbackTimerId) {
    clearTimeout(state.fallbackTimerId);
    state.fallbackTimerId = null;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createTab(url) {
  return new Promise((resolve) => {
    chrome.tabs.create({ url, active: true }, (tab) => resolve(tab || null));
  });
}

function waitForTabComplete(tabId) {
  return new Promise((resolve) => {
    const listener = (updatedTabId, changeInfo, tab) => {
      if (updatedTabId !== tabId || changeInfo.status !== 'complete') {
        return;
      }
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve(tab || null);
    };
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      chrome.tabs.get(tabId, (tab) => resolve(tab || null));
    }, TAB_STABLE_MAX_POLLS * TAB_STABLE_POLL_MS);
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId, (tab) => {
      if (tab?.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve(tab);
      }
    });
  });
}

async function executeApiReplayFetch(tabId, replay) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: async ({ endpoint, endpointTemplate, method, allowedHost, runtimeParameterSource, responseEvidence, fetchOptions, extensionStatusUrl, replayId }) => {
      const requestedCredentials = String(fetchOptions?.credentials || 'include');
      const runtimeFetchOptions = {
        credentials: ['include', 'same-origin'].includes(requestedCredentials)
          ? requestedCredentials
          : 'include',
      };
      const reportStage = (stage) => {
        if (!extensionStatusUrl || !stage) {
          return;
        }
        try {
          const url = new URL(extensionStatusUrl);
          url.searchParams.set('stage', stage);
          fetch(url.toString(), {
            method: 'POST',
            credentials: 'omit',
            cache: 'no-store',
          }).catch(() => {});
        } catch {
          // Replay telemetry is best-effort only.
        }
      };
      const normalizeTextLocal = (value) => String(value ?? '').replace(/\s+/gu, ' ').trim();
      const parseRenderData = (encoded) => {
        const text = String(encoded || '');
        const decodeAttempts = [
          text,
          (() => {
            try {
              return decodeURIComponent(text);
            } catch {
              return null;
            }
          })(),
          text.replace(/%([0-9a-f]{2})/giu, (_match, hex) => String.fromCharCode(Number.parseInt(hex, 16))),
        ];
        for (const attempt of decodeAttempts) {
          if (!attempt) {
            continue;
          }
          try {
            return JSON.parse(attempt);
          } catch {
            // Try the next decoding strategy; only structural ASCII fields are needed for API replay.
          }
        }
        return null;
      };
      const replaceRuntimePlaceholders = (template, values) => String(template || '')
        .replace(/\{self\.uid\}|%7Bself\.uid%7D/giu, encodeURIComponent(values.uid || ''))
        .replace(/\{self\.secUid\}|%7Bself\.secUid%7D/gu, encodeURIComponent(values.secUid || ''))
        .replace(/\{self\.sec_uid\}|%7Bself\.sec_uid%7D/giu, encodeURIComponent(values.secUid || ''));
      const resolveRuntimeEndpoint = () => {
        const sourceKind = String(runtimeParameterSource?.kind || '');
        if (!sourceKind) {
          return { endpoint: endpointTemplate || endpoint, reasonCode: null };
        }
        if (sourceKind === 'qidian_yuew_sign' || sourceKind === 'x_web_auth_headers') {
          return { endpoint: endpointTemplate || endpoint, reasonCode: null };
        }
        if (sourceKind !== 'douyin_self_user_render_data') {
          return { endpoint: null, reasonCode: 'runtime_parameter_source_unsupported' };
        }
        let renderData = null;
        try {
          const renderNode = document.getElementById('RENDER_DATA');
          renderData = parseRenderData(renderNode?.textContent || '');
        } catch {
          renderData = null;
        }
        const selfInfo = renderData?.app?.user?.info ?? null;
        const uid = normalizeTextLocal(selfInfo?.uid || '');
        const secUid = normalizeTextLocal(selfInfo?.secUid || selfInfo?.sec_uid || '');
        if (!uid || !secUid) {
          return { endpoint: null, reasonCode: 'runtime_parameter_source_unavailable' };
        }
        return {
          endpoint: replaceRuntimePlaceholders(endpointTemplate || endpoint, { uid, secUid }),
          reasonCode: null,
        };
      };
      const evaluateResponseEvidence = (json) => {
        if (!responseEvidence || typeof responseEvidence !== 'object') {
          return {
            status: null,
            observedStatusCode: null,
            observedArrayFieldPresent: null,
          };
        }
        const expectedStatus = Number(responseEvidence.statusCode);
        const observedStatusCode = Number(json?.status_code ?? json?.statusCode ?? json?.code);
        const statusCodeMatches = !Number.isFinite(expectedStatus)
          || (Number.isFinite(observedStatusCode) && observedStatusCode === expectedStatus);
        const arrayField = normalizeTextLocal(responseEvidence.arrayField || '');
        const observedArrayFieldPresent = arrayField ? Array.isArray(json?.[arrayField]) : null;
        const arrayMatches = !arrayField || observedArrayFieldPresent === true;
        const objectField = normalizeTextLocal(responseEvidence.objectField || '');
        const observedObjectFieldPresent = objectField
          ? Boolean(json?.[objectField] && typeof json[objectField] === 'object' && !Array.isArray(json[objectField]))
          : null;
        const objectMatches = !objectField || observedObjectFieldPresent === true;
        return {
          status: statusCodeMatches && arrayMatches && objectMatches ? 'matched' : 'failed',
          observedStatusCode: Number.isFinite(observedStatusCode) ? observedStatusCode : null,
          observedArrayFieldPresent,
          observedObjectFieldPresent,
        };
      };
      const cookieValue = (name) => {
        const wanted = String(name || '');
        return document.cookie
          .split(';')
          .map((part) => part.trim())
          .find((part) => part.startsWith(`${wanted}=`))
          ?.slice(wanted.length + 1) || '';
      };
      const qidianPageCsrfToken = () => {
        try {
          return normalizeTextLocal((typeof _csrfToken === 'undefined' ? '' : _csrfToken) || globalThis._csrfToken || '');
        } catch {
          return normalizeTextLocal(globalThis._csrfToken || '');
        }
      };
      const qidianCsrfToken = () => cookieValue('_csrfToken') || qidianPageCsrfToken();
      const appendQidianCsrfQuery = (endpointValue, csrf) => {
        if (String(runtimeParameterSource?.kind || '') !== 'qidian_yuew_sign' || !csrf) {
          return endpointValue;
        }
        try {
          const baseHref = globalThis.location?.href || endpointValue;
          const nextUrl = new URL(endpointValue, baseHref);
          if (!nextUrl.searchParams.get('_csrfToken')) {
            nextUrl.searchParams.set('_csrfToken', csrf);
          }
          return nextUrl.toString();
        } catch {
          return endpointValue;
        }
      };
      const sleepLocal = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const waitForQidianFock = async () => {
        for (let attempt = 0; attempt < 60; attempt += 1) {
          if (typeof globalThis.Fock?.sign === 'function') {
            return globalThis.Fock;
          }
          await sleepLocal(500);
        }
        return null;
      };
      const qidianSignedHeaders = async () => {
        if (String(runtimeParameterSource?.kind || '') !== 'qidian_yuew_sign') {
          return { headers: {} };
        }
        reportStage(`qidian-api-replay:${replayId || 'replay'}:sign-wait`);
        const fock = await waitForQidianFock();
        if (typeof fock?.sign !== 'function') {
          reportStage(`qidian-api-replay:${replayId || 'replay'}:sign-unavailable`);
          return { error: 'qidian_sign_unavailable' };
        }
        const csrf = qidianCsrfToken();
        if (!csrf) {
          reportStage(`qidian-api-replay:${replayId || 'replay'}:csrf-unavailable`);
          return { error: 'qidian_csrf_unavailable' };
        }
        try {
          fock.initialize?.();
          const timeDistance = Number(document.getElementById('qdcstd')?.content ?? globalThis._timeDistance ?? 0) || 0;
          const signedTime = String(Math.floor(Date.now() / 1000) + timeDistance);
          const csrfHeaderNames = Array.isArray(runtimeParameterSource?.csrfHeaderNames)
            ? runtimeParameterSource.csrfHeaderNames
            : [];
          const csrfHeaders = csrfHeaderNames
            .map((name) => normalizeTextLocal(name))
            .filter((name) => /^[A-Za-z0-9-]+$/u.test(name))
            .reduce((headers, name) => ({ ...headers, [name]: csrf }), {});
          return {
            headers: {
              'X-Yuew-time': signedTime,
              'X-Yuew-sign': fock.sign(`${signedTime}${csrf}`),
              'X-Requested-With': 'XMLHttpRequest',
              Accept: 'application/json, text/javascript, */*; q=0.01',
              ...csrfHeaders,
            },
            csrf,
          };
        } catch {
          reportStage(`qidian-api-replay:${replayId || 'replay'}:sign-failed`);
          return { error: 'qidian_sign_failed' };
        }
      };
      const xWebAuthHeaders = async () => {
        if (String(runtimeParameterSource?.kind || '') !== 'x_web_auth_headers') {
          return { headers: {} };
        }
        const csrfCookieName = normalizeTextLocal(runtimeParameterSource?.csrfCookieName || 'ct0');
        let csrf = cookieValue(csrfCookieName);
        for (let attempt = 0; !csrf && attempt < 20; attempt += 1) {
          await sleepLocal(250);
          csrf = cookieValue(csrfCookieName);
        }
        if (!csrf) {
          return { error: 'x_csrf_unavailable' };
        }
        const language = normalizeTextLocal(navigator?.language || 'en').split('-')[0] || 'en';
        return {
          headers: {
            Accept: 'application/json, text/plain, */*',
            'x-csrf-token': csrf,
            'x-twitter-active-user': 'yes',
            'x-twitter-auth-type': 'OAuth2Session',
            'x-twitter-client-language': language,
          },
        };
      };
      try {
        reportStage(`api-replay-script-started:${replayId || 'replay'}`);
        const resolved = resolveRuntimeEndpoint();
        if (!resolved.endpoint) {
          return {
            status: 'skipped',
            reasonCode: resolved.reasonCode || 'endpoint_not_runtime_resolvable',
            httpStatus: null,
            contentType: null,
            responseKind: null,
          };
        }
        const signedHeaders = await qidianSignedHeaders();
        if (signedHeaders.error) {
          return {
            status: 'failed',
            reasonCode: signedHeaders.error,
            httpStatus: null,
            contentType: null,
            responseKind: null,
          };
        }
        const authHeaders = await xWebAuthHeaders();
        if (authHeaders.error) {
          return {
            status: 'failed',
            reasonCode: authHeaders.error,
            httpStatus: null,
            contentType: null,
            responseKind: null,
          };
        }
        reportStage(`qidian-api-replay:${replayId || 'replay'}:fetch-started`);
        const fetchEndpoint = appendQidianCsrfQuery(resolved.endpoint, signedHeaders.csrf);
        const response = await fetch(fetchEndpoint, {
          method,
          headers: {
            ...signedHeaders.headers,
            ...authHeaders.headers,
          },
          credentials: runtimeFetchOptions.credentials,
          cache: 'no-store',
          redirect: 'follow',
        });
        reportStage(`qidian-api-replay:${replayId || 'replay'}:fetch-finished`);
        const contentType = response.headers.get('content-type') || '';
        const finalHost = new URL(response.url).hostname;
        const responseKind = /json/iu.test(contentType)
          ? 'json'
          : /html/iu.test(contentType)
            ? 'html'
            : contentType
              ? 'other'
              : null;
        if (finalHost !== allowedHost) {
          return {
            status: 'failed',
            reasonCode: 'cross_site_redirect',
            httpStatus: response.status,
            contentType,
            responseKind,
          };
        }
        const json = await response.clone().json().catch(() => null);
        const effectiveResponseKind = json && typeof json === 'object' ? 'json' : responseKind;
        const evidence = evaluateResponseEvidence(json);
        const evidenceFailed = evidence.status === 'failed';
        const qidianLoginRequired = String(runtimeParameterSource?.kind || '') === 'qidian_yuew_sign'
          && evidence.observedStatusCode === 1000;
        const verified = response.ok && effectiveResponseKind === 'json' && !evidenceFailed;
        return {
          status: verified ? 'verified' : 'failed',
          reasonCode: verified
            ? null
            : qidianLoginRequired
              ? 'login_required_response'
              : evidenceFailed
              ? 'api_replay_response_evidence_failed'
              : (response.ok ? 'api_replay_non_json_response' : 'api_replay_http_failed'),
          httpStatus: response.status,
          contentType,
          responseKind: effectiveResponseKind,
          responseEvidenceStatus: evidence.status,
          observedStatusCode: evidence.observedStatusCode,
          observedArrayFieldPresent: evidence.observedArrayFieldPresent,
        };
      } catch {
        reportStage(`qidian-api-replay:${replayId || 'replay'}:fetch-failed`);
        return {
          status: 'failed',
          reasonCode: 'api_replay_fetch_failed',
          httpStatus: null,
          contentType: null,
          responseKind: null,
        };
      }
    },
    args: [{
      endpoint: replay.endpoint,
      endpointTemplate: replay.endpointTemplate,
      method: replay.method,
      allowedHost: replay.allowedHost,
      runtimeParameterSource: replay.runtimeParameterSource,
      responseEvidence: replay.responseEvidence,
      fetchOptions: replay.fetchOptions,
      extensionStatusUrl: replay.extensionStatusUrl,
      replayId: replay.id,
    }],
  });
  return results?.[0]?.result || {
    status: 'failed',
    reasonCode: 'api_replay_failed',
    httpStatus: null,
    contentType: null,
    responseKind: null,
  };
}

async function submitApiReplay(session, replay, result) {
  const submitUrl = session?.apiReplaySubmitUrl || session?.submitUrl;
  if (!submitUrl) {
    return;
  }
  await fetch(submitUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'omit',
    cache: 'no-store',
    body: JSON.stringify({
      nonce: session.nonce,
      apiReplay: {
        replayId: replay.id,
        method: replay.method,
        ...result,
      },
    }),
  });
}

async function runApiReplaySession(session) {
  const replay = normalizedApiReplay(session);
  signal(session, `bridge-version:${SITEFORGE_BRIDGE_EXTENSION_VERSION}`);
  if (!sessionKey(session) || !replay) {
    return { ok: false };
  }
  signal(session, `api-replay-started:${replay.id}`);
  const tab = await createTab(replay.pageUrl);
  if (!tab?.id) {
    await submitApiReplay(session, replay, {
      status: 'failed',
      reasonCode: 'browser-bridge-route-open-failed',
      httpStatus: null,
      contentType: null,
      responseKind: null,
    }).catch(() => {});
    return { ok: false };
  }
  const settledTab = await waitForTabComplete(tab.id);
  if (!settledTab?.id || !sameAllowedHost(settledTab.url, replay.allowedHost) || loginLikeUrl(settledTab.url)) {
    await submitApiReplay(session, replay, {
      status: 'failed',
      reasonCode: loginLikeUrl(settledTab?.url) ? 'challenge_or_login_wall_response' : 'host-mismatch',
      httpStatus: null,
      contentType: null,
      responseKind: null,
    }).catch(() => {});
    return { ok: false };
  }
  signal(session, `api-replay-page-ready:${replay.id}`);
  await sleep(API_REPLAY_READY_DELAY_MS);
  const result = await executeApiReplayFetch(tab.id, replay);
  signal(session, `api-replay-script-finished:${replay.id}`);
  await submitApiReplay(session, replay, result);
  signal(session, `api-replay-submit-ok:${replay.id}`);
  return { ok: true };
}

async function waitForStableTab(tabId, session, route) {
  const maxPolls = timingValue(session, 'tabStableMaxPolls', TAB_STABLE_MAX_POLLS, 1, 120);
  const pollMs = timingValue(session, 'tabStablePollMs', TAB_STABLE_POLL_MS, 100, 5000);
  const stableAfterCompleteMs = timingValue(session, 'routeStableAfterCompleteMs', ROUTE_STABLE_AFTER_COMPLETE_MS, 250, 15000);
  for (let attempt = 0; attempt < maxPolls; attempt += 1) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab?.id) {
      return { ok: false, reasonCode: 'tab-missing', tab: null };
    }
    const currentUrl = tab.url || tab.pendingUrl || route.targetUrl;
    if (tab.status === 'loading' || tab.pendingUrl) {
      signal(session, `navigation-in-progress:${route.id}`);
      await sleep(pollMs);
      continue;
    }
    await sleep(stableAfterCompleteMs);
    const stableTab = await chrome.tabs.get(tabId).catch(() => null);
    if (!stableTab?.id) {
      return { ok: false, reasonCode: 'tab-missing', tab: null };
    }
    const stableUrl = stableTab.url || stableTab.pendingUrl || currentUrl;
    if (stableTab.status === 'loading' || stableTab.pendingUrl) {
      signal(session, `navigation-in-progress:${route.id}`);
      await sleep(pollMs);
      continue;
    }
    if (stableUrl !== currentUrl) {
      signal(session, `route-tab-settling:${route.id}`);
      await sleep(pollMs);
      continue;
    }
    signal(session, `route-tab-stable:${route.id}`);
    return { ok: true, reasonCode: null, tab: stableTab, currentUrl: stableUrl };
  }
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  const committedUrl = tab?.url || '';
  if (tab?.id && sameAllowedHost(committedUrl, route.allowedHost, route.allowedHosts) && sameRoutePath(committedUrl, route.targetUrl)) {
    signal(session, `route-tab-usable-while-loading:${route.id}`);
    return { ok: true, reasonCode: 'navigation-in-progress', tab, currentUrl: committedUrl };
  }
  return { ok: false, reasonCode: 'navigation-in-progress', tab };
}

async function submitRouteStatus(session, route, status, reasonCode, targetUrl = route?.targetUrl) {
  if (!session?.submitUrl || !route?.id) {
    return;
  }
  try {
    await fetch(session.submitUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'omit',
      cache: 'no-store',
      body: JSON.stringify({
        nonce: session.nonce,
        routeResults: [{
          routeId: route.id,
          targetUrl,
          sourceLayer: route.sourceLayer,
          status,
          reasonCode,
        }],
      }),
    });
  } catch {
    signal(session, `route-status-submit-failed:${route.id}`);
  }
}

async function executeCollectorScript(tabId, session, route, stage = 'collector-injecting') {
  signal(session, `${stage}:${route.id}`);
  let executeOk = false;
  let executeError = null;
  for (let attempt = 0; attempt < COLLECTOR_RETRY_BACKOFF_MS.length; attempt += 1) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['collector-content.js'],
      });
      executeOk = true;
      break;
    } catch (error) {
      executeError = error;
      signal(session, `execute-script-failed:${route.id}:attempt-${attempt + 1}`);
      await sleep(COLLECTOR_RETRY_BACKOFF_MS[attempt]);
    }
  }
  if (!executeOk) {
    throw Object.assign(new Error('execute-script-failed'), { reasonCode: 'execute-script-failed', cause: executeError });
  }
  await sleep(COLLECTOR_READY_DELAY_MS);
}

async function injectCollector(tabId, session, route) {
  const currentSession = routeSession(session, route);
  await executeCollectorScript(tabId, session, route);
  let result = null;
  let messageError = null;
  for (let attempt = 0; attempt < COLLECTOR_RETRY_BACKOFF_MS.length; attempt += 1) {
    try {
      result = await chrome.tabs.sendMessage(tabId, {
        type: SITEFORGE_COLLECT_MESSAGE_TYPE,
        session: currentSession,
      });
      if (result?.ok) {
        if (result.collectorVersion) {
          await signal(session, `collector-version:${route.id}:${result.collectorVersion}`);
        }
        await signal(session, `collector-submit-ok:${route.id}`);
        return;
      }
      messageError = new Error(result?.reason || result?.status || 'collector-message-failed');
      signal(session, `collector-message-failed:${route.id}:${result?.reason || result?.status || 'unknown'}:attempt-${attempt + 1}`);
    } catch (error) {
      messageError = error;
      signal(session, `collector-message-failed:${route.id}:attempt-${attempt + 1}`);
    }
    if (attempt < COLLECTOR_RETRY_BACKOFF_MS.length - 1) {
      await sleep(COLLECTOR_RETRY_BACKOFF_MS[attempt]);
      await executeCollectorScript(tabId, session, route, 'collector-reinjecting');
    }
  }
  throw Object.assign(new Error('collector-message-failed'), { reasonCode: 'collector-message-failed', cause: messageError });
}

function finishRoute(tabId, state, route) {
  clearFallbackTimer(state);
  signal(state.session, `route-complete:${route.id}`);
  state.index += 1;
  state.collecting = false;
  openRoute(state);
}

function collectRoute(tabId, state, route, triggerStage) {
  if (!state || state.collecting || state.routes[state.index]?.id !== route?.id) {
    return;
  }
  state.collecting = true;
  clearFallbackTimer(state);
  if (triggerStage) {
    signal(state.session, `${triggerStage}:${route.id}`);
  }
  waitForStableTab(tabId, state.session, route).then(({ ok, reasonCode, tab, currentUrl: stableCurrentUrl }) => {
    if (!ok || !tab?.id) {
      submitRouteStatus(state.session, route, 'blocked', reasonCode || 'tab-missing')
        .finally(() => finishRoute(tabId, state, route));
      return;
    }
    const currentUrl = stableCurrentUrl || tab.url || tab.pendingUrl || route.targetUrl;
    if (!sameAllowedHost(currentUrl, route.allowedHost, route.allowedHosts)) {
      signal(state.session, `route-host-mismatch:${route.id}`);
      submitRouteStatus(state.session, route, 'blocked', 'host-mismatch', currentUrl)
        .finally(() => finishRoute(tabId, state, route));
      return;
    }
    if (loginLikeUrl(currentUrl) && !(route.allowLoginLikeCapture === true && sameRoutePath(currentUrl, route.targetUrl))) {
      signal(state.session, `route-login-wall:${route.id}`);
      submitRouteStatus(state.session, route, 'blocked', 'login-wall', currentUrl)
        .finally(() => finishRoute(tabId, state, route));
      return;
    }
    if (!sameRoutePath(currentUrl, route.targetUrl)) {
      signal(state.session, `route-url-canonicalized:${route.id}`);
    }
    injectCollector(tabId, state.session, route)
      .then(() => finishRoute(tabId, state, route))
      .catch((error) => {
        const reasonCode = error?.reasonCode || 'browser-bridge-collector-injection-failed';
        signal(state.session, `route-collect-failed:${route.id}:${reasonCode}`);
        submitRouteStatus(state.session, route, 'blocked', reasonCode, currentUrl)
          .finally(() => finishRoute(tabId, state, route));
      });
  });
}

function scheduleFallbackCollection(state, route) {
  clearFallbackTimer(state);
  const tabId = state.tabId;
  if (!tabId) {
    return;
  }
  state.fallbackTimerId = setTimeout(() => {
    const latestState = activeTabs.get(tabId);
    if (!latestState || latestState !== state || latestState.collecting || latestState.routes[latestState.index]?.id !== route.id) {
      return;
    }
    collectRoute(tabId, latestState, route, 'route-load-fallback');
  }, timingValue(state.session, 'routeCollectFallbackDelayMs', ROUTE_COLLECT_FALLBACK_DELAY_MS, 1000, 60000));
}

function openRoute(state) {
  const route = state.routes[state.index];
  if (!route) {
    clearFallbackTimer(state);
    activeTabs.delete(state.tabId);
    signal(state.session, 'session-complete');
    return;
  }
  state.collecting = false;
  clearFallbackTimer(state);
  signal(state.session, `route-opened:${route.id}`);
  if (state.tabId) {
    chrome.tabs.update(state.tabId, { url: route.targetUrl }, (tab) => {
      if (!tab?.id) {
        activeTabs.delete(state.tabId);
        signal(state.session, `route-open-failed:${route.id}`);
        submitRouteStatus(state.session, route, 'blocked', 'browser-bridge-route-open-failed')
          .finally(() => {
            state.index += 1;
            openRoute(state);
          });
        return;
      }
      scheduleFallbackCollection(state, route);
    });
    return;
  }
  chrome.tabs.create({ url: route.targetUrl, active: true }, (tab) => {
    if (!tab?.id) {
      signal(state.session, `route-open-failed:${route.id}`);
      submitRouteStatus(state.session, route, 'blocked', 'browser-bridge-route-open-failed')
        .finally(() => {
          state.index += 1;
          openRoute(state);
        });
      return;
    }
    state.tabId = tab.id;
    activeTabs.set(tab.id, state);
    scheduleFallbackCollection(state, route);
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'siteforge-bridge-session') {
    return false;
  }

  const session = message.session;
  if (session?.apiReplay) {
    runApiReplaySession(session)
      .then((result) => sendResponse?.(result))
      .catch(() => sendResponse?.({ ok: false }));
    return true;
  }

  const routes = normalizedRoutes(session);
  if (!sessionKey(session) || !routes.length) {
    sendResponse?.({ ok: false });
    return false;
  }

  const state = {
    session,
    routes,
    index: 0,
    tabId: null,
    collecting: false,
  };
  signal(session, `bridge-version:${SITEFORGE_BRIDGE_EXTENSION_VERSION}`);
  openRoute(state);
  signal(session, 'target-route-queue-started');
  sendResponse?.({ ok: true, routeCount: routes.length });
  return false;
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') {
    return;
  }
  const state = activeTabs.get(tabId);
  if (!state || state.collecting) {
    return;
  }
  const route = state.routes[state.index];
  if (!route) {
    activeTabs.delete(tabId);
    return;
  }
  if (!sameAllowedHost(tab?.url, route.allowedHost, route.allowedHosts)) {
    signal(state.session, `route-host-mismatch:${route.id}`);
    submitRouteStatus(state.session, route, 'blocked', 'host-mismatch', tab?.url || route.targetUrl)
      .finally(() => finishRoute(tabId, state, route));
    return;
  }
  if (loginLikeUrl(tab?.url) && !(route.allowLoginLikeCapture === true && sameRoutePath(tab?.url, route.targetUrl))) {
    signal(state.session, `route-login-wall:${route.id}`);
    submitRouteStatus(state.session, route, 'blocked', 'login-wall', tab?.url || route.targetUrl)
      .finally(() => finishRoute(tabId, state, route));
    return;
  }
  if (!sameRoutePath(tab?.url, route.targetUrl)) {
    signal(state.session, `route-url-canonicalized:${route.id}`);
  }
  collectRoute(tabId, state, route, null);
});
