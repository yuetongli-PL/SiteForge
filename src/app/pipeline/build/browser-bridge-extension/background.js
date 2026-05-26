const activeTabs = new Map();
const SITEFORGE_BRIDGE_EXTENSION_VERSION = 'route-queue-chinese-semantic-v6';
const SITEFORGE_COLLECT_MESSAGE_TYPE = `siteforge-collect-structure:${SITEFORGE_BRIDGE_EXTENSION_VERSION}`;
const ROUTE_COLLECT_FALLBACK_DELAY_MS = 6500;
const ROUTE_STABLE_AFTER_COMPLETE_MS = 1500;
const TAB_STABLE_MAX_POLLS = 16;
const TAB_STABLE_POLL_MS = 500;
const COLLECTOR_READY_DELAY_MS = 250;
const COLLECTOR_RETRY_BACKOFF_MS = [1000, 3000, 7000];
const API_REPLAY_READY_DELAY_MS = 1000;

function safeUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return ['http:', 'https:'].includes(url.protocol) ? url : null;
  } catch {
    return null;
  }
}

function sameAllowedHost(urlValue, allowedHost) {
  const parsed = safeUrl(urlValue);
  return Boolean(parsed && parsed.hostname === String(allowedHost || ''));
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
  return Boolean(parsed && target && parsed.hostname === target.hostname && routePath(parsed.toString()) === routePath(target.toString()));
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
      if (!target || target.hostname !== allowedHost) {
        return null;
      }
      return {
        id: String(route?.id || `route-${index + 1}`),
        targetUrl: target.toString(),
        sourceLayer: route?.sourceLayer === 'authenticated_overlay' ? 'authenticated_overlay' : 'authenticated',
        allowedHost,
        allowedOrigin: String(route?.allowedOrigin || target.origin),
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
    allowedOrigin: route.allowedOrigin,
  };
}

function normalizedApiReplay(session) {
  const apiReplay = session?.apiReplay || null;
  const endpoint = safeUrl(apiReplay?.endpoint);
  const pageUrl = safeUrl(apiReplay?.pageUrl || (endpoint ? `${endpoint.origin}/` : ''));
  const method = String(apiReplay?.method || 'GET').toUpperCase();
  const allowedHost = String(apiReplay?.allowedHost || endpoint?.hostname || '');
  if (!endpoint || !pageUrl || !['GET', 'HEAD'].includes(method)) {
    return null;
  }
  if (endpoint.hostname !== allowedHost || pageUrl.hostname !== allowedHost) {
    return null;
  }
  return {
    id: String(apiReplay?.id || 'api-replay-1'),
    endpoint: endpoint.toString(),
    pageUrl: pageUrl.toString(),
    method,
    allowedHost,
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
    func: async ({ endpoint, method, allowedHost }) => {
      try {
        const response = await fetch(endpoint, {
          method,
          credentials: 'include',
          cache: 'no-store',
          redirect: 'follow',
        });
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
        const verified = response.ok && responseKind === 'json';
        return {
          status: verified ? 'verified' : 'failed',
          reasonCode: verified ? null : (response.ok ? 'api_replay_non_json_response' : 'api_replay_http_failed'),
          httpStatus: response.status,
          contentType,
          responseKind,
        };
      } catch {
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
      method: replay.method,
      allowedHost: replay.allowedHost,
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
  await sleep(API_REPLAY_READY_DELAY_MS);
  const result = await executeApiReplayFetch(tab.id, replay);
  await submitApiReplay(session, replay, result);
  signal(session, `api-replay-submit-ok:${replay.id}`);
  return { ok: true };
}

async function waitForStableTab(tabId, session, route) {
  for (let attempt = 0; attempt < TAB_STABLE_MAX_POLLS; attempt += 1) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab?.id) {
      return { ok: false, reasonCode: 'tab-missing', tab: null };
    }
    const currentUrl = tab.url || tab.pendingUrl || route.targetUrl;
    if (tab.status === 'loading' || tab.pendingUrl) {
      signal(session, `navigation-in-progress:${route.id}`);
      await sleep(TAB_STABLE_POLL_MS);
      continue;
    }
    await sleep(ROUTE_STABLE_AFTER_COMPLETE_MS);
    const stableTab = await chrome.tabs.get(tabId).catch(() => null);
    if (!stableTab?.id) {
      return { ok: false, reasonCode: 'tab-missing', tab: null };
    }
    const stableUrl = stableTab.url || stableTab.pendingUrl || currentUrl;
    if (stableTab.status === 'loading' || stableTab.pendingUrl) {
      signal(session, `navigation-in-progress:${route.id}`);
      await sleep(TAB_STABLE_POLL_MS);
      continue;
    }
    if (stableUrl !== currentUrl) {
      signal(session, `route-tab-settling:${route.id}`);
      await sleep(TAB_STABLE_POLL_MS);
      continue;
    }
    signal(session, `route-tab-stable:${route.id}`);
    return { ok: true, reasonCode: null, tab: stableTab, currentUrl: stableUrl };
  }
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  const committedUrl = tab?.url || '';
  if (tab?.id && sameAllowedHost(committedUrl, route.allowedHost) && sameRoutePath(committedUrl, route.targetUrl)) {
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
    if (!sameAllowedHost(currentUrl, route.allowedHost)) {
      signal(state.session, `route-host-mismatch:${route.id}`);
      submitRouteStatus(state.session, route, 'blocked', 'host-mismatch', currentUrl)
        .finally(() => finishRoute(tabId, state, route));
      return;
    }
    if (loginLikeUrl(currentUrl)) {
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
  }, ROUTE_COLLECT_FALLBACK_DELAY_MS);
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
  if (!sameAllowedHost(tab?.url, route.allowedHost)) {
    signal(state.session, `route-host-mismatch:${route.id}`);
    submitRouteStatus(state.session, route, 'blocked', 'host-mismatch', tab?.url || route.targetUrl)
      .finally(() => finishRoute(tabId, state, route));
    return;
  }
  if (loginLikeUrl(tab?.url)) {
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
