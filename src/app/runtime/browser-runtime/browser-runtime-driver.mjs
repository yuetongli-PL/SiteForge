// @ts-check

import {
  openBrowserSession,
} from '../../../infra/browser/session.mjs';
import {
  BROWSER_RUNTIME_REASONS,
  createBrowserRuntimeError,
} from './browser-runtime-errors.mjs';

function normalizeText(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function selectorInspection(selector) {
  const nodes = Array.from(document.querySelectorAll(selector));
  if (nodes.length !== 1) {
    return { count: nodes.length, actionable: false, visible: false };
  }
  const node = nodes[0];
  const style = window.getComputedStyle(node);
  const rect = node.getBoundingClientRect();
  const disabled = node.disabled === true || node.getAttribute('aria-disabled') === 'true';
  const visible = style.display !== 'none'
    && style.visibility !== 'hidden'
    && Number(style.opacity || 1) > 0
    && rect.width > 0
    && rect.height > 0;
  return {
    count: 1,
    actionable: visible && !disabled,
    visible,
  };
}

function fillSelectorValue(selector, value) {
  const node = document.querySelector(selector);
  if (!node) return { filled: false };
  if ('value' in node) {
    node.value = value;
  } else if (node.isContentEditable) {
    node.textContent = value;
  } else {
    return { filled: false };
  }
  node.dispatchEvent(new Event('input', { bubbles: true }));
  node.dispatchEvent(new Event('change', { bubbles: true }));
  return { filled: true };
}

function clickSelector(selector) {
  const node = document.querySelector(selector);
  if (!node || typeof node.click !== 'function') {
    return { clicked: false };
  }
  node.click();
  return { clicked: true };
}

function observeCompletionSignal(signal) {
  const kind = String(signal?.kind ?? '').trim();
  if (kind === 'selectorVisible') {
    const inspected = selectorInspection(String(signal?.selector ?? ''));
    return inspected.count === 1 && inspected.visible === true;
  }
  if (kind === 'selectorTextEquals') {
    const nodes = Array.from(document.querySelectorAll(String(signal?.selector ?? '')));
    if (nodes.length !== 1) return false;
    return String(nodes[0].textContent ?? '').trim() === String(signal?.text ?? '').trim();
  }
  if (kind === 'urlMatchesSafePattern') {
    const path = `${window.location.origin}${window.location.pathname}`;
    const pattern = String(signal?.pattern ?? '').trim();
    if (!pattern) return false;
    return new RegExp(pattern).test(path);
  }
  return false;
}

function originAllowed(url, allowedOrigins) {
  try {
    return allowedOrigins.has(new URL(String(url ?? '')).origin);
  } catch {
    return false;
  }
}

async function safeSend(session, method, params = {}) {
  if (typeof session?.send === 'function') {
    return await session.send(method, params);
  }
  return await session?.client?.send?.(method, params, session?.sessionId);
}

async function runCriticalGuardSetup(guard, operation) {
  try {
    return await operation();
  } catch {
    throw createBrowserRuntimeError(BROWSER_RUNTIME_REASONS.runtimeUnavailable, {
      phase: 'guard_setup',
      guard,
    });
  }
}

async function installRequestGuard(session, descriptor, trace, progress) {
  const allowedOrigins = new Set(descriptor.allowedOrigins);
  const offCallbacks = [];
  const state = {
    blockedReason: null,
  };

  function disposeCallbacks() {
    for (const off of offCallbacks) {
      try {
        off?.();
      } catch {
        // Listener cleanup is best-effort after the fail-closed decision.
      }
    }
  }

  const client = session?.client;
  if (!client || typeof client.on !== 'function' || typeof client.send !== 'function') {
    throw createBrowserRuntimeError(BROWSER_RUNTIME_REASONS.runtimeUnavailable, {
      phase: 'guard_setup',
      guard: 'cdp_client',
    });
  }

  function addCriticalListener(guard, method, handler, options) {
    try {
      const off = client.on(method, handler, options);
      offCallbacks.push(off);
    } catch {
      throw createBrowserRuntimeError(BROWSER_RUNTIME_REASONS.runtimeUnavailable, {
        phase: 'guard_setup',
        guard,
      });
    }
  }

  try {
    addCriticalListener('request', 'Fetch.requestPaused', (event = {}) => {
      const params = event.params ?? {};
      const requestUrl = params.request?.url ?? params.url ?? '';
      if (!originAllowed(requestUrl, allowedOrigins)) {
        state.blockedReason = BROWSER_RUNTIME_REASONS.navigationNotAllowed;
        trace.blockedNetwork(requestUrl, state.blockedReason);
        progress.blockedExternalRequestCount += 1;
        void client.send?.('Fetch.failRequest', {
          requestId: params.requestId,
          errorReason: 'BlockedByClient',
        }, event.sessionId ?? session.sessionId);
        return;
      }
      void client.send?.('Fetch.continueRequest', {
        requestId: params.requestId,
      }, event.sessionId ?? session.sessionId);
    }, { sessionId: session.sessionId });

    addCriticalListener('popup', 'Target.targetCreated', (event = {}) => {
      const target = event.params?.targetInfo ?? {};
      if (target.type === 'page' && target.targetId && target.targetId !== session.targetId) {
        state.blockedReason = BROWSER_RUNTIME_REASONS.popupNotAllowed;
        progress.popupBlockedCount += 1;
        void client.send?.('Target.closeTarget', { targetId: target.targetId });
      }
    });

    addCriticalListener('popup', 'Page.windowOpen', () => {
      state.blockedReason = BROWSER_RUNTIME_REASONS.popupNotAllowed;
      progress.popupBlockedCount += 1;
    }, { sessionId: session.sessionId });

    addCriticalListener('download', 'Page.downloadWillBegin', () => {
      state.blockedReason = BROWSER_RUNTIME_REASONS.downloadNotAllowed;
      progress.downloadBlockedCount += 1;
    }, { sessionId: session.sessionId });

    await runCriticalGuardSetup('request', async () => {
      await safeSend(session, 'Fetch.enable', { patterns: [{ urlPattern: '*' }] });
    });

    await runCriticalGuardSetup('popup', async () => {
      await session?.client?.send?.('Target.setDiscoverTargets', { discover: true });
    });

    await runCriticalGuardSetup('download', async () => {
      await session?.client?.send?.('Browser.setDownloadBehavior', { behavior: 'deny' });
    });
  } catch (error) {
    disposeCallbacks();
    throw error;
  }

  return {
    state,
    dispose: disposeCallbacks,
  };
}

async function inspectRequiredSelector(session, selector, trace, { slotName = null, kind = 'selector' } = {}) {
  const inspected = await session.callPageFunction(selectorInspection, selector);
  trace.step(kind, {
    status: inspected?.count === 1 && inspected?.actionable === true ? 'validated' : 'failed',
    selector,
    slotName,
    reasonCode: inspected?.count === 0
      ? BROWSER_RUNTIME_REASONS.selectorNotFound
      : inspected?.count > 1
        ? BROWSER_RUNTIME_REASONS.selectorNotUnique
        : inspected?.actionable !== true
          ? BROWSER_RUNTIME_REASONS.actionNotActionable
          : undefined,
  });
  if (inspected?.count === 0) {
    throw createBrowserRuntimeError(BROWSER_RUNTIME_REASONS.selectorNotFound);
  }
  if (inspected?.count > 1) {
    throw createBrowserRuntimeError(BROWSER_RUNTIME_REASONS.selectorNotUnique);
  }
  if (inspected?.actionable !== true) {
    throw createBrowserRuntimeError(BROWSER_RUNTIME_REASONS.actionNotActionable);
  }
}

async function waitForCompletion(session, signal, timeoutMs, guardState) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (guardState.blockedReason) {
      throw createBrowserRuntimeError(guardState.blockedReason);
    }
    if (await session.callPageFunction(observeCompletionSignal, signal) === true) {
      return true;
    }
    await delay(50);
  }
  if (guardState.blockedReason) {
    throw createBrowserRuntimeError(guardState.blockedReason);
  }
  throw createBrowserRuntimeError(BROWSER_RUNTIME_REASONS.completionNotObserved);
}

async function applyEphemeralAuthCookies(session, request = {}) {
  const cookies = asArray(request.cookies);
  if (cookies.length === 0) {
    throw createBrowserRuntimeError('runtime.auth_provider_injection_failed');
  }
  for (const cookie of cookies) {
    if (!cookie?.url && !cookie?.domain) {
      throw createBrowserRuntimeError('runtime.auth_provider_injection_failed');
    }
  }
  if (typeof session?.applyEphemeralAuthCookies === 'function') {
    return await session.applyEphemeralAuthCookies({
      origin: request.origin,
      cookies,
    });
  }
  await safeSend(session, 'Network.setCookies', { cookies });
  return { applied: true };
}

export async function openControlledBrowserSession(descriptor, deps = {}) {
  const openBrowserSessionImpl = deps.openBrowserSession ?? openBrowserSession;
  const timeoutMs = descriptor.timeoutMs;
  return await openBrowserSessionImpl({
    headless: true,
    timeoutMs,
    sessionOpenRetries: 0,
    fullPage: false,
    viewport: {
      width: 1280,
      height: 800,
      deviceScaleFactor: 1,
    },
    startupUrl: 'about:blank',
    networkCapture: {
      requestLimit: 0,
      rawTraceLimit: 0,
      rawBodyMaxBytes: 0,
    },
  }, {
    userDataDirPrefix: 'siteforge-controlled-browser-',
    cleanupUserDataDirOnShutdown: true,
  }, deps.openBrowserSessionDeps ?? {});
}

/** @param {Record<string, any>} options */
export async function runControlledBrowserDriver({
  descriptor,
  contract,
  slotValues,
  trace,
  authAdapter = null,
  deps = {},
} = {}) {
  const progress = {
    sideEffectAttempted: false,
    blockedExternalRequestCount: 0,
    popupBlockedCount: 0,
    downloadBlockedCount: 0,
  };
  let session = null;
  let guard = null;
  let authSummary = null;
  try {
    session = await openControlledBrowserSession(descriptor, deps);
    guard = await installRequestGuard(session, descriptor, trace, progress);

    if (authAdapter?.isRequired?.() === true) {
      const appliedAuth = await authAdapter.applyBrowserAuth({
        driver: {
          applyEphemeralAuthCookies: async (request) => applyEphemeralAuthCookies(session, request),
        },
        targetUrl: descriptor.startUrl,
        targetOrigin: new URL(descriptor.startUrl).origin,
        allowedOrigins: descriptor.allowedOrigins,
      });
      if (appliedAuth?.ok !== true) {
        throw createBrowserRuntimeError(
          normalizeText(appliedAuth?.reasonCode, 'runtime.auth_provider_injection_failed'),
          { authSummary: appliedAuth?.authSummary ?? null },
        );
      }
      authSummary = appliedAuth.authSummary ?? null;
      trace.authApplied({
        origin: appliedAuth.origin,
        authSummary: appliedAuth.authSummary,
      });
    }

    await session.navigateAndWait(descriptor.startUrl, {
      useLoadEvent: false,
      useNetworkIdle: false,
      documentReadyTimeoutMs: descriptor.timeoutMs,
      domQuietMs: 50,
      domQuietTimeoutMs: descriptor.actionTimeoutMs,
    });
    trace.step('navigate', { status: 'completed' });

    if (guard.state.blockedReason) {
      throw createBrowserRuntimeError(guard.state.blockedReason);
    }

    for (const slotName of contract.requiredSlots) {
      await inspectRequiredSelector(session, contract.fieldSelectors[slotName], trace, {
        slotName,
        kind: 'field_selector',
      });
    }
    await inspectRequiredSelector(session, contract.submitSelector, trace, { kind: 'submit_selector' });

    for (const slotName of contract.requiredSlots) {
      progress.sideEffectAttempted = true;
      const filled = await session.callPageFunction(
        fillSelectorValue,
        contract.fieldSelectors[slotName],
        slotValues[slotName],
      );
      if (filled?.filled !== true) {
        throw createBrowserRuntimeError(BROWSER_RUNTIME_REASONS.actionTimeout);
      }
      trace.step('fill', { status: 'completed', selector: contract.fieldSelectors[slotName], slotName });
    }

    progress.sideEffectAttempted = true;
    const clicked = await session.callPageFunction(clickSelector, contract.submitSelector);
    if (clicked?.clicked !== true) {
      throw createBrowserRuntimeError(BROWSER_RUNTIME_REASONS.actionTimeout);
    }
    trace.step('submit', { status: 'completed', selector: contract.submitSelector });

    await waitForCompletion(
      session,
      contract.completionSignal,
      contract.completionSignal.timeoutMs ?? descriptor.completionTimeoutMs,
      guard.state,
    );
    trace.step('completion', { status: 'observed' });

    return {
      status: 'completed',
      reasonCode: null,
      sideEffectAttempted: progress.sideEffectAttempted,
      progress,
      authSummary,
    };
  } catch (error) {
    return {
      status: 'failed',
      reasonCode: normalizeText(error?.reasonCode ?? error?.code, BROWSER_RUNTIME_REASONS.runtimeUnavailable),
      sideEffectAttempted: progress.sideEffectAttempted,
      progress,
      authSummary: error?.details?.authSummary ?? authSummary,
    };
  } finally {
    guard?.dispose?.();
    try {
      await session?.close?.();
      trace.markCleanup({ sessionClosed: true });
    } catch {
      trace.markCleanup({ sessionClosed: false });
    }
  }
}
