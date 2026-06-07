// @ts-check

export const RUNTIME_AUDIT_VIEW_SCHEMA_VERSION = 'runtime-audit-view/v1';

export const RUNTIME_AUDIT_TIMELINE_EVENTS = Object.freeze([
  'runtime.invocation.received',
  'runtime.dispatch.evaluated',
  'runtime.provider.selected',
  'runtime.provider.can_execute',
  'runtime.gate.allowed',
  'runtime.gate.blocked',
  'runtime.auth.requirement.evaluated',
  'runtime.auth.gate.allowed',
  'runtime.auth.gate.blocked',
  'runtime.auth.material.summary_observed',
  'runtime.provider.invoked',
  'runtime.side_effect.not_attempted',
  'runtime.side_effect.attempted',
  'runtime.provider.completed',
  'runtime.provider.failed',
  'runtime.browser.descriptor.validated',
  'runtime.browser.guard.installed',
  'runtime.browser.guard.failed',
  'runtime.browser.auth.applied',
  'runtime.browser.navigation.allowed',
  'runtime.browser.navigation.blocked',
  'runtime.browser.action.performed',
  'runtime.browser.completion.observed',
  'runtime.browser.completion.not_observed',
  'runtime.artifact.recorded',
  'runtime.cleanup.completed',
  'runtime.execution.completed',
  'runtime.execution.blocked',
  'runtime.execution.failed',
]);

export const RUNTIME_AUDIT_TIMELINE_EVENT_SET = Object.freeze(new Set(RUNTIME_AUDIT_TIMELINE_EVENTS));
