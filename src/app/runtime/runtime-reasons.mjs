// @ts-check

import {
  BROWSER_RUNTIME_REASONS,
} from './browser-runtime/browser-runtime-errors.mjs';

export const RUNTIME_AUTH_REASONS = Object.freeze({
  authRequired: 'runtime.auth_required',
  sessionMissing: 'runtime.auth_session_missing',
  sessionExpired: 'runtime.auth_session_expired',
  scopeNotAllowed: 'runtime.auth_session_scope_not_allowed',
  materialUnavailable: 'runtime.auth_session_material_unavailable',
  providerInjectionFailed: 'runtime.auth_provider_injection_failed',
  policyGateNotSatisfied: 'runtime.auth_policy_gate_not_satisfied',
  sessionVaultUnavailable: 'runtime.auth_session_vault_unavailable',
});

export const RUNTIME_REASONS = Object.freeze({
  paymentExecutionBlocked: 'runtime.payment_execution_blocked',
  destructiveExecutionBlocked: 'runtime.destructive_execution_blocked',
  browserActionUncontrolledSite: 'runtime.browser_action_uncontrolled_site',
  contractNotConcreteEnough: 'runtime.contract_not_concrete_enough',
  ...RUNTIME_AUTH_REASONS,
  browserRuntimeUnavailable: BROWSER_RUNTIME_REASONS.runtimeUnavailable,
  browserRuntimeDescriptorMissing: BROWSER_RUNTIME_REASONS.descriptorMissing,
  browserSelectorNotFound: BROWSER_RUNTIME_REASONS.selectorNotFound,
  browserSelectorNotUnique: BROWSER_RUNTIME_REASONS.selectorNotUnique,
  browserActionNotActionable: BROWSER_RUNTIME_REASONS.actionNotActionable,
  browserActionTimeout: BROWSER_RUNTIME_REASONS.actionTimeout,
  browserCompletionNotObserved: BROWSER_RUNTIME_REASONS.completionNotObserved,
  browserNavigationNotAllowed: BROWSER_RUNTIME_REASONS.navigationNotAllowed,
  browserPopupNotAllowed: BROWSER_RUNTIME_REASONS.popupNotAllowed,
  browserDownloadNotAllowed: BROWSER_RUNTIME_REASONS.downloadNotAllowed,
});
