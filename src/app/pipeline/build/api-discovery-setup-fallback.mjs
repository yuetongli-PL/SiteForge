// @ts-check

import { uniqueSortedStrings } from '../../../shared/normalize.mjs';

export const SETUP_BLOCKED_API_DISCOVERY_STATUS = 'api_discovery_setup_blocked';
export const SETUP_BLOCKED_API_DISCOVERY_WARNING = 'setup-blocked-api-discovery-only';
export const SETUP_BLOCKED_API_DISCOVERY_BOUNDARY = 'setup page collection remains blocked; default API candidates and read-only replay may continue best-effort';

export function isBrowserSetupBlockedReason(reasonCode) {
  return /^browser[_-]/u.test(String(reasonCode ?? '').trim());
}

export function isApiDiscoveryRequested(options = /** @type {any} */ ({})) {
  return options.internalRawNetwork === true
    || options.captureNetwork === true
    || options.network === true;
}

export function canContinueSetupBlockedForApiDiscovery(setupPlan, options = /** @type {any} */ ({})) {
  return options.authMode === 'browser'
    && options.strictBrowserAuth === true
    && options.renderJs !== false
    && isApiDiscoveryRequested(options)
    && isBrowserSetupBlockedReason(setupPlan?.buildReadiness?.reasonCode);
}

export function setupBlockedApiDiscoveryOptions(options, setupPlan) {
  const reasonCode = setupPlan?.buildReadiness?.reasonCode ?? 'browser_check_failed';
  return {
    ...options,
    strictBrowserAuth: false,
    allowSetupBlockedApiDiscovery: true,
    setupBlockedApiDiscoveryReasonCode: reasonCode,
  };
}

export function setupBlockedApiDiscoveryPlan(setupPlan) {
  const reasonCode = setupPlan?.buildReadiness?.reasonCode ?? 'browser_check_failed';
  return {
    ...setupPlan,
    warnings: uniqueSortedStrings([
      ...(setupPlan?.warnings ?? []),
      SETUP_BLOCKED_API_DISCOVERY_WARNING,
    ]),
    apiDiscoverySetupFallback: {
      status: 'enabled',
      reasonCode,
      boundary: SETUP_BLOCKED_API_DISCOVERY_BOUNDARY,
    },
  };
}
