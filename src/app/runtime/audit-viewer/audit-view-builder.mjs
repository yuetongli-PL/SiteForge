// @ts-check

import {
  assertNoExecutionSensitiveMaterial,
} from '../../../domain/policies/execution/index.mjs';
import {
  RUNTIME_AUDIT_TIMELINE_EVENT_SET,
  RUNTIME_AUDIT_VIEW_SCHEMA_VERSION,
} from './audit-view-model.mjs';
import {
  buildAuditViewIntegrity,
  createAuditViewSourceDigest,
} from './audit-view-integrity.mjs';
import {
  safeAuditViewRef,
  sanitizeAuditEventForAuditView,
  sanitizeAuditViewArtifactMetadata,
  sanitizeAuditViewAuthSummary,
  sanitizeAuditViewDestructiveSummary,
  sanitizeAuditViewPolicySummary,
  sanitizeBrowserTraceSummary,
  sanitizeProviderResultEnvelope,
  sanitizeRuntimeReportForAuditView,
  scanAuditViewUnsafeInput,
} from './audit-view-sanitizer.mjs';

function isPlainObject(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeStatus(value) {
  return safeAuditViewRef(value, 'unknown');
}

function event(index, type, detail = {}) {
  const eventType = RUNTIME_AUDIT_TIMELINE_EVENT_SET.has(type) ? type : 'runtime.dispatch.evaluated';
  const sanitized = {
    sequence: index,
    eventType,
    derived: detail.derived !== false,
    providerId: safeAuditViewRef(detail.providerId, null),
    status: safeAuditViewRef(detail.status, null),
    reason: safeAuditViewRef(detail.reason, null),
    summary: safeAuditViewRef(detail.summary, null),
  };
  return Object.fromEntries(Object.entries(sanitized).filter(([, value]) => value !== null));
}

function timelineFromAuditEvents(auditEvents = []) {
  const timeline = [];
  for (const auditEvent of auditEvents) {
    if (!isPlainObject(auditEvent)) continue;
    const eventType = safeAuditViewRef(auditEvent.eventType, '');
    if (RUNTIME_AUDIT_TIMELINE_EVENT_SET.has(eventType)) {
      timeline.push(event(timeline.length + 1, eventType, {
        derived: false,
        providerId: auditEvent.providerId,
        status: auditEvent.status,
        reason: auditEvent.reasonCode ?? auditEvent.blockedReason,
      }));
    }
  }
  return timeline;
}

function derivedTimeline({
  report = null,
  providerEnvelope = null,
  browserSummary = null,
  artifactMetadata = [],
} = {}) {
  const timeline = [];
  const push = (type, detail = {}) => timeline.push(event(timeline.length + 1, type, detail));
  push('runtime.invocation.received', { status: 'observed' });
  push('runtime.dispatch.evaluated', {
    status: report?.runtimeDispatchAllowed === true ? 'allowed' : 'blocked',
    reason: report?.blockedReason ?? report?.reasonCode,
  });
  if (report?.providerId) {
    push('runtime.provider.selected', { providerId: report.providerId, status: 'selected' });
    push('runtime.provider.can_execute', { providerId: report.providerId, status: report.providerInvoked ? 'allowed' : 'not_invoked' });
  }
  if (report?.authSummary) {
    push('runtime.auth.requirement.evaluated', { status: report.authSummary.required ? 'required' : 'not_required' });
    push(report.authSummary.outcome === 'blocked' ? 'runtime.auth.gate.blocked' : 'runtime.auth.gate.allowed', {
      reason: report.authSummary.reason,
    });
    if (report.authSummary.materialSummary?.count > 0) {
      push('runtime.auth.material.summary_observed', { status: 'summary_only' });
    }
  }
  if (report?.policySummary) {
    push(report.policySummary.allowed === true ? 'runtime.gate.allowed' : 'runtime.gate.blocked', {
      status: report.policySummary.allowed === true ? 'allowed' : 'blocked',
      reason: report.policySummary.reason,
      summary: 'session_policy_decision',
    });
  }
  if (report?.destructiveSummary) {
    push('runtime.gate.blocked', {
      status: 'blocked',
      reason: report.destructiveSummary.reason,
      summary: 'destructive_strong_authorization',
    });
  }
  if (report?.providerInvoked) {
    push('runtime.provider.invoked', { providerId: report.providerId, status: 'invoked' });
  }
  push(report?.sideEffectAttempted ? 'runtime.side_effect.attempted' : 'runtime.side_effect.not_attempted', {
    status: report?.sideEffectAttempted ? 'attempted' : 'not_attempted',
  });
  if (browserSummary) {
    push('runtime.browser.descriptor.validated', { status: 'observed' });
    for (const step of asArray(browserSummary.steps)) {
      if (step.kind === 'guard_installed') push('runtime.browser.guard.installed', { status: step.status });
      if (step.kind === 'guard_failed') push('runtime.browser.guard.failed', { reason: step.reasonCode });
      if (step.kind === 'navigate') push('runtime.browser.navigation.allowed', { status: step.status });
      if (step.kind === 'action') push('runtime.browser.action.performed', { status: step.status });
    }
    if (asArray(browserSummary.authEvents).length > 0) {
      push('runtime.browser.auth.applied', { status: 'summary_only' });
    }
    if (browserSummary.completion?.observed === true) {
      push('runtime.browser.completion.observed', { status: 'observed' });
    } else if (browserSummary.completion) {
      push('runtime.browser.completion.not_observed', { reason: browserSummary.completion.reasonCode });
    }
    if (browserSummary.cleanup?.sessionClosed === true) {
      push('runtime.cleanup.completed', { status: 'completed' });
    }
  }
  if (artifactMetadata.length > 0 || asArray(report?.artifactRefs).length > 0) {
    push('runtime.artifact.recorded', { status: 'recorded' });
  }
  if (report?.status === 'completed') {
    push('runtime.provider.completed', { providerId: report.providerId, status: 'completed' });
    push('runtime.execution.completed', { status: 'completed' });
  } else if (report?.status === 'blocked') {
    push('runtime.gate.blocked', { reason: report.blockedReason ?? report.reasonCode });
    push('runtime.execution.blocked', { reason: report.blockedReason ?? report.reasonCode });
  } else {
    push('runtime.provider.failed', { providerId: report?.providerId, reason: report?.reasonCode });
    push('runtime.execution.failed', { reason: report?.reasonCode });
  }
  if (providerEnvelope?.redirect?.crossOrigin === true || providerEnvelope?.response?.redirect?.crossOrigin === true) {
    push('runtime.browser.navigation.blocked', { reason: 'cross_origin_redirect' });
  }
  return timeline;
}

function buildDecisions(report = null) {
  const decisions = [];
  decisions.push({
    decision: 'dispatch',
    allowed: report?.runtimeDispatchAllowed === true,
    reason: safeAuditViewRef(report?.blockedReason ?? report?.reasonCode, null),
  });
  if (report?.providerId) {
    decisions.push({
      decision: 'provider_selection',
      allowed: true,
      providerId: safeAuditViewRef(report.providerId, null),
    });
  }
  if (report?.authSummary) {
    decisions.push({
      decision: 'auth',
      allowed: report.authSummary.outcome !== 'blocked',
      reason: safeAuditViewRef(report.authSummary.reason, null),
      required: report.authSummary.required === true,
      used: report.authSummary.used === true,
    });
  }
  if (report?.policySummary) {
    decisions.push({
      decision: 'session_policy',
      allowed: report.policySummary.allowed === true,
      reason: safeAuditViewRef(report.policySummary.reason, null),
      policyId: safeAuditViewRef(report.policySummary.policyId, null),
      decisionId: safeAuditViewRef(report.policySummary.decisionId, null),
    });
  }
  if (report?.destructiveSummary) {
    decisions.push({
      decision: 'destructive_authorization',
      allowed: false,
      reason: safeAuditViewRef(report.destructiveSummary.reason, null),
      required: report.destructiveSummary.required === true,
      strongAuthPresent: report.destructiveSummary.strongAuth?.present === true,
      policyGateSatisfied: report.destructiveSummary.policyGate?.satisfied === true,
    });
  }
  decisions.push({
    decision: 'side_effect',
    allowed: report?.sideEffectAttempted === true,
    reason: report?.sideEffectAttempted === true ? null : 'runtime.side_effect_not_attempted',
  });
  return decisions.map((decision) => Object.fromEntries(Object.entries(decision).filter(([, value]) => value !== null)));
}

function outcomeFromReport(report = null) {
  return {
    status: normalizeStatus(report?.status),
    verdict: safeAuditViewRef(report?.verdict, null),
    reasonCode: safeAuditViewRef(report?.reasonCode, null),
    blockedReason: safeAuditViewRef(report?.blockedReason, null),
    providerInvoked: report?.providerInvoked === true,
    executionAttempted: report?.executionAttempted === true,
    sideEffectAttempted: report?.sideEffectAttempted === true,
    sideEffectSucceeded: report?.sideEffectSucceeded === true,
    sideEffectFailed: report?.sideEffectFailed === true,
  };
}

export function sanitizeRuntimeAuditView(view = {}) {
  const sanitized = {
    schemaVersion: RUNTIME_AUDIT_VIEW_SCHEMA_VERSION,
    sourceDigest: safeAuditViewRef(view.sourceDigest, null),
    integrity: isPlainObject(view.integrity) ? view.integrity : { status: 'unknown', warnings: [], sourceSummaries: [] },
    invocation: isPlainObject(view.invocation) ? view.invocation : {},
    outcome: isPlainObject(view.outcome) ? view.outcome : {},
    decisions: asArray(view.decisions),
    authSummary: sanitizeAuditViewAuthSummary(view.authSummary),
    policySummary: sanitizeAuditViewPolicySummary(view.policySummary),
    destructiveSummary: sanitizeAuditViewDestructiveSummary(view.destructiveSummary),
    browserSummary: sanitizeBrowserTraceSummary(view.browserSummary),
    artifactMetadata: sanitizeAuditViewArtifactMetadata(view.artifactMetadata),
    providerResult: sanitizeProviderResultEnvelope(view.providerResult),
    auditEvents: asArray(view.auditEvents).map(sanitizeAuditEventForAuditView).filter(Boolean),
    timeline: asArray(view.timeline).map((entry, index) => event(index + 1, entry?.eventType, {
      derived: entry?.derived !== false,
      providerId: entry?.providerId,
      status: entry?.status,
      reason: entry?.reason,
      summary: entry?.summary,
    })),
    redactionSummary: isPlainObject(view.redactionSummary)
      ? {
        unsafeInputDetected: view.redactionSummary.unsafeInputDetected === true,
        redactedFieldCount: Number(view.redactionSummary.redactedFieldCount) || 0,
        redactedValueCount: Number(view.redactionSummary.redactedValueCount) || 0,
      }
      : { unsafeInputDetected: false, redactedFieldCount: 0, redactedValueCount: 0 },
    redactionRequired: true,
  };
  const output = Object.fromEntries(Object.entries(sanitized).filter(([, value]) => value !== null));
  assertNoExecutionSensitiveMaterial(output);
  return output;
}

export function createRuntimeAuditView(bundle = {}) {
  const report = sanitizeRuntimeReportForAuditView(bundle.report ?? bundle.runtimeExecutionReport ?? bundle.runtime_execution_report);
  const auditEvents = asArray(bundle.auditEvents ?? bundle.audit_events)
    .map(sanitizeAuditEventForAuditView)
    .filter(Boolean);
  const providerResult = sanitizeProviderResultEnvelope(bundle.providerResult ?? bundle.providerResultEnvelope ?? report?.resultSummary);
  const browserSummary = sanitizeBrowserTraceSummary(
    bundle.browserTrace
      ?? bundle.browserSummary
      ?? providerResult?.browserExecutionTrace
      ?? report?.resultSummary?.browserExecutionTrace,
  );
  const artifactMetadata = sanitizeAuditViewArtifactMetadata(
    bundle.artifactMetadata
      ?? bundle.artifacts
      ?? providerResult?.downloads
      ?? report?.resultSummary?.downloads
      ?? [],
  );
  const sourceSummaries = asArray(bundle.sourceSummaries).filter(isPlainObject);
  const unsafe = scanAuditViewUnsafeInput(bundle);
  const timeline = timelineFromAuditEvents(auditEvents);
  const view = sanitizeRuntimeAuditView({
    sourceDigest: createAuditViewSourceDigest({
      report,
      auditEvents,
      providerResult,
      browserSummary,
      artifactMetadata,
    }),
    integrity: buildAuditViewIntegrity({ report, auditEvents, sourceSummaries }),
    invocation: {
      requestId: safeAuditViewRef(report?.requestId, null),
      executionId: safeAuditViewRef(report?.executionId, null),
      capabilityId: safeAuditViewRef(report?.capabilityId, null),
      executionContractRef: safeAuditViewRef(report?.executionContractRef, null),
      policyDecisionRef: safeAuditViewRef(report?.policyDecisionRef, null),
      capabilityKind: safeAuditViewRef(report?.capabilityKind, null),
      providerId: safeAuditViewRef(report?.providerId, null),
    },
    outcome: outcomeFromReport(report),
    decisions: buildDecisions(report),
    authSummary: report?.authSummary ?? providerResult?.authSummary ?? null,
    policySummary: report?.policySummary ?? providerResult?.policySummary ?? null,
    destructiveSummary: report?.destructiveSummary ?? null,
    browserSummary,
    artifactMetadata,
    providerResult,
    auditEvents,
    timeline: timeline.length ? timeline : derivedTimeline({
      report,
      providerEnvelope: providerResult,
      browserSummary,
      artifactMetadata,
    }),
    redactionSummary: unsafe,
  });
  assertNoExecutionSensitiveMaterial(view);
  return view;
}
