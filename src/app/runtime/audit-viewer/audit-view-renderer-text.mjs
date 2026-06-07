// @ts-check

import {
  assertNoExecutionSensitiveMaterial,
} from '../../../domain/policies/execution/index.mjs';
import {
  sanitizeRuntimeAuditView,
} from './audit-view-builder.mjs';

function line(label, value) {
  return `${label}: ${value ?? ''}`;
}

export function renderRuntimeAuditViewText(view) {
  const sanitized = sanitizeRuntimeAuditView(view);
  const output = [
    '# Runtime Audit View',
    line('schemaVersion', sanitized.schemaVersion),
    line('status', sanitized.outcome.status),
    line('reason', sanitized.outcome.blockedReason ?? sanitized.outcome.reasonCode ?? 'none'),
    line('provider', sanitized.invocation.providerId ?? 'none'),
    line('providerInvoked', String(sanitized.outcome.providerInvoked)),
    line('executionAttempted', String(sanitized.outcome.executionAttempted)),
    line('sideEffectAttempted', String(sanitized.outcome.sideEffectAttempted)),
    line('authRequired', String(sanitized.authSummary?.required === true)),
    line('authUsed', String(sanitized.authSummary?.used === true)),
    line('policyAllowed', String(sanitized.policySummary?.allowed === true)),
    line('destructiveRequired', String(sanitized.destructiveSummary?.required === true)),
    line('artifactCount', String(sanitized.artifactMetadata.length)),
    '',
    '## Decisions',
    ...sanitized.decisions.map((decision) => `- ${decision.decision}: ${decision.allowed === true ? 'allowed' : 'blocked'}${decision.reason ? ` (${decision.reason})` : ''}`),
    '',
    '## Timeline',
    ...sanitized.timeline.map((entry) => `- ${entry.sequence}. ${entry.eventType}${entry.derived ? ' [derived]' : ''}${entry.reason ? ` (${entry.reason})` : ''}`),
  ].join('\n');
  assertNoExecutionSensitiveMaterial({ output });
  return output;
}

export function renderRuntimeAuditView(view, options = {}) {
  return renderRuntimeAuditViewText(view);
}
