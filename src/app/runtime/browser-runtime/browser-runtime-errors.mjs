// @ts-check

export const BROWSER_RUNTIME_REASONS = Object.freeze({
  runtimeUnavailable: 'runtime.browser_runtime_unavailable',
  descriptorMissing: 'runtime.browser_runtime_descriptor_missing',
  selectorNotFound: 'runtime.browser_selector_not_found',
  selectorNotUnique: 'runtime.browser_selector_not_unique',
  actionNotActionable: 'runtime.browser_action_not_actionable',
  actionTimeout: 'runtime.browser_action_timeout',
  completionNotObserved: 'runtime.browser_completion_not_observed',
  navigationNotAllowed: 'runtime.browser_navigation_not_allowed',
  popupNotAllowed: 'runtime.browser_popup_not_allowed',
  downloadNotAllowed: 'runtime.browser_download_not_allowed',
});

export class ControlledBrowserRuntimeError extends Error {
  constructor(reasonCode, message = 'Controlled browser runtime failed', details = {}) {
    super(message);
    this.name = 'ControlledBrowserRuntimeError';
    this.code = reasonCode;
    this.reasonCode = reasonCode;
    this.details = details;
  }
}

export function createBrowserRuntimeError(reasonCode, details = {}) {
  return new ControlledBrowserRuntimeError(reasonCode, 'Controlled browser runtime failed', details);
}
