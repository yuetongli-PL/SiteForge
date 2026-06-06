// @ts-check

import {
  assertSafeBrowserRuntimeSummary,
  safeOriginHash,
  safePathHash,
  stableRuntimeHash,
} from './browser-runtime-sanitizer.mjs';

function normalizeText(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function nowIso() {
  return new Date().toISOString();
}

export function createBrowserRuntimeTrace({
  actionRef = null,
  routeRef = null,
  slotNames = [],
  startUrl = null,
} = {}) {
  const steps = [];
  const networkEvents = [];
  const startedAt = nowIso();
  let cleanup = {
    sessionClosed: false,
  };

  return {
    step(kind, detail = {}) {
      steps.push({
        kind: normalizeText(kind, 'step'),
        status: normalizeText(detail.status, 'completed'),
        slotName: normalizeText(detail.slotName) || undefined,
        selectorHash: detail.selector ? stableRuntimeHash(detail.selector, 'selector-hash') : undefined,
        reasonCode: normalizeText(detail.reasonCode) || undefined,
      });
    },
    blockedNetwork(url, reasonCode) {
      networkEvents.push({
        kind: 'blocked_request',
        status: 'blocked',
        originHash: safeOriginHash(url),
        pathHash: safePathHash(url),
        reasonCode,
      });
    },
    markCleanup(nextCleanup = {}) {
      cleanup = {
        sessionClosed: nextCleanup.sessionClosed === true,
      };
    },
    summary({ completion = null, status = 'completed' } = {}) {
      const summary = {
        traceType: 'sanitized_browser_execution_trace',
        status,
        actionRef,
        routeRef,
        slotNames,
        startOriginHash: startUrl ? safeOriginHash(startUrl) : null,
        startPathHash: startUrl ? safePathHash(startUrl) : null,
        steps: steps.map((step) => Object.fromEntries(
          Object.entries(step).filter(([, value]) => value !== undefined),
        )),
        networkEvents,
        completion,
        cleanup,
        startedAt,
        redactionRequired: true,
      };
      return assertSafeBrowserRuntimeSummary(summary);
    },
  };
}
