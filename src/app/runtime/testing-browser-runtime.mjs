// @ts-check

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

/**
 * Test-only controlled browser runtime deps. The fake records counters and safe
 * booleans only; it never stores raw cookie names, values, domains, or paths.
 *
 * @param {Record<string, any>} scenario
 */
export function createFakeControlledBrowserRuntimeDeps(scenario = {}) {
  const eventLog = Array.isArray(scenario.eventLog) ? scenario.eventLog : [];
  const state = {
    launchCount: 0,
    closeCount: 0,
    navigateCount: 0,
    fillCount: 0,
    clickCount: 0,
    guardSetupAttempts: [],
    guardSetupFailures: [],
    continuedRequests: [],
    failedRequests: [],
    closedTargets: [],
    popupsCreated: [],
    downloadsCreated: [],
    cdpMethods: [],
    authCookieApplyCount: 0,
    authCookieMaterialTypeCount: 0,
    authCookieHostOnlyCount: 0,
    authCookieDomainCount: 0,
    authCookieDomainPropertySeen: false,
    lastAuthOrigin: null,
    eventLog,
  };
  const listeners = new Map();

  const client = {
    on(method, handler) {
      const handlers = listeners.get(method) ?? new Set();
      handlers.add(handler);
      listeners.set(method, handlers);
      return () => handlers.delete(handler);
    },
    async send(method, params = {}) {
      state.cdpMethods.push(method);
      if (['Fetch.enable', 'Target.setDiscoverTargets', 'Browser.setDownloadBehavior'].includes(method)) {
        state.guardSetupAttempts.push(method);
        eventLog.push(`guard:${method}`);
      }
      if (scenario.guardSetupFailureMethod === method) {
        state.guardSetupFailures.push(method);
        const error = new Error(`SENTINEL_CDP_GUARD_SETUP_ERROR_SHOULD_NOT_APPEAR ${method}`);
        error.details = {
          method,
          payload: 'sf_browser_cdp_cookie_payload_secret_789',
        };
        throw error;
      }
      if (method === 'Fetch.continueRequest') {
        state.continuedRequests.push(params.requestId);
      }
      if (method === 'Fetch.failRequest') {
        state.failedRequests.push(params.requestId);
      }
      if (method === 'Target.closeTarget') {
        state.closedTargets.push(params.targetId);
      }
      return {};
    },
    emit(method, params = {}, sessionId = 'ctx-1') {
      for (const handler of listeners.get(method) ?? []) {
        handler({ method, params, sessionId });
      }
    },
  };

  function selectorState(selector) {
    const count = Object.hasOwn(scenario.selectorCounts ?? {}, selector)
      ? scenario.selectorCounts[selector]
      : 1;
    return {
      count,
      actionable: count === 1 && scenario.notActionableSelector !== selector,
      visible: count === 1 && scenario.notActionableSelector !== selector,
    };
  }

  const session = {
    client,
    sessionId: 'ctx-1',
    targetId: 'target-main',
    async applyEphemeralAuthCookies(request = {}) {
      const cookies = asArray(request.cookies);
      state.authCookieApplyCount += 1;
      state.authCookieMaterialTypeCount += cookies.length;
      state.authCookieHostOnlyCount += cookies.filter((cookie) => cookie?.url && !Object.hasOwn(cookie, 'domain')).length;
      state.authCookieDomainCount += cookies.filter((cookie) => Object.hasOwn(cookie, 'domain')).length;
      state.authCookieDomainPropertySeen = state.authCookieDomainPropertySeen
        || cookies.some((cookie) => Object.hasOwn(cookie, 'domain'));
      state.lastAuthOrigin = String(request.origin ?? '') || null;
      eventLog.push('driver.applyEphemeralAuthCookies');
      if (scenario.authCookieApplyFailure === true) {
        throw new Error('sf_browser_cdp_cookie_payload_secret_789');
      }
      return { applied: true };
    },
    async navigateAndWait() {
      state.navigateCount += 1;
      eventLog.push('browser.navigate');
    },
    async callPageFunction(fn, ...args) {
      switch (fn.name) {
        case 'selectorInspection':
          return selectorState(args[0]);
        case 'fillSelectorValue':
          state.fillCount += 1;
          eventLog.push('browser.fill');
          return { filled: scenario.fillFails !== true };
        case 'clickSelector':
          state.clickCount += 1;
          eventLog.push('browser.click');
          if (scenario.externalAfterClick) {
            client.emit('Fetch.requestPaused', {
              requestId: 'external-request-1',
              request: {
                url: 'https://external.invalid/collect?token=sf_browser_cookie_secret_123',
              },
            });
          }
          if (scenario.popupAfterClick) {
            state.popupsCreated.push('popup-target-1');
            client.emit('Target.targetCreated', {
              targetInfo: {
                targetId: 'popup-target-1',
                type: 'page',
                url: 'https://external.invalid/popup?token=sf_browser_cookie_secret_123',
              },
            }, null);
          }
          if (scenario.downloadAfterClick) {
            state.downloadsCreated.push('download-1');
            client.emit('Page.downloadWillBegin', {
              guid: 'download-1',
              url: 'https://external.invalid/download?token=sf_browser_cookie_secret_123',
            });
          }
          return { clicked: scenario.clickFails !== true };
        case 'observeCompletionSignal':
          return scenario.completionObserved !== false
            && !scenario.externalAfterClick
            && !scenario.popupAfterClick
            && !scenario.downloadAfterClick;
        default:
          throw new Error(`Unexpected page function: ${fn.name}`);
      }
    },
    async send(method, params = {}) {
      return await client.send(method, params);
    },
    async close() {
      state.closeCount += 1;
    },
  };

  return {
    state,
    openBrowserSession: async () => {
      state.launchCount += 1;
      return session;
    },
  };
}
