// @ts-check

import { createHash } from 'node:crypto';

import {
  assertNoExecutionSensitiveMaterial,
} from '../../../domain/policies/execution/index.mjs';
import {
  sanitizeAuthAuditSummary,
  sanitizeRuntimeSessionPolicySummary,
} from '../auth-runtime.mjs';
import {
  sanitizeDestructiveAuthorizationSummary,
} from '../destructive-authorization.mjs';

const SECRET_VALUE_PATTERN =
  /(?:sf_(?:replay|global|test|browser|vault)_[a-z0-9_]*secret[a-z0-9_]*|Bearer\s+|Authorization|Set-Cookie|Cookie\s*[:=]|access[_-]?token=|api[_-]?key=|storageState|localStorage|sessionStorage|IndexedDB)/iu;
const SECRET_KEY_PATTERN =
  /(?:authorization|cookie|set-cookie|token|secret|password|credential|sessionhandle|session[_-]?object|vault[_-]?response|material[_-]?grant|grantid|headers?|body|storageState|localStorage|sessionStorage|IndexedDB|dom|screenshot|video|cdp|submitted)/iu;

function isPlainObject(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

export function stableAuditViewHash(value, prefix = 'audit-view-hash') {
  const digest = createHash('sha256')
    .update(String(value ?? ''), 'utf8')
    .digest('hex')
    .slice(0, 24);
  return `${prefix}:${digest}`;
}

function normalizeText(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

export function safeAuditViewRef(value, fallback = null) {
  const text = normalizeText(value);
  if (!text) return fallback;
  if (SECRET_VALUE_PATTERN.test(text) || SECRET_KEY_PATTERN.test(text)) {
    return stableAuditViewHash(text, 'safe-ref');
  }
  return text
    .replace(/[^a-z0-9._:/-]+/giu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 180) || fallback;
}

export function safeAuditViewText(value, fallback = '') {
  const text = normalizeText(value, fallback);
  if (!text) return fallback;
  if (SECRET_VALUE_PATTERN.test(text)) {
    return fallback || 'sanitized';
  }
  return text
    .replace(/[\r\n\t]+/gu, ' ')
    .replace(/\s{2,}/gu, ' ')
    .slice(0, 240);
}

function safeBoolean(value) {
  return value === true;
}

function safeNumber(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

export function scanAuditViewUnsafeInput(value) {
  const findings = {
    sensitiveKeyCount: 0,
    sensitiveValueCount: 0,
  };
  const visit = (next) => {
    if (Array.isArray(next)) {
      next.forEach(visit);
      return;
    }
    if (isPlainObject(next)) {
      for (const [key, child] of Object.entries(next)) {
        if (SECRET_KEY_PATTERN.test(key)) {
          findings.sensitiveKeyCount += 1;
        }
        visit(child);
      }
      return;
    }
    if (typeof next === 'string' && SECRET_VALUE_PATTERN.test(next)) {
      findings.sensitiveValueCount += 1;
    }
  };
  visit(value);
  return {
    unsafeInputDetected: findings.sensitiveKeyCount > 0 || findings.sensitiveValueCount > 0,
    redactedFieldCount: findings.sensitiveKeyCount,
    redactedValueCount: findings.sensitiveValueCount,
  };
}

export function sanitizeAuditViewAuthSummary(summary = null) {
  if (!isPlainObject(summary)) return null;
  return sanitizeAuthAuditSummary(summary);
}

export function sanitizeAuditViewPolicySummary(summary = null) {
  if (!isPlainObject(summary)) return null;
  return sanitizeRuntimeSessionPolicySummary(summary);
}

export function sanitizeAuditViewDestructiveSummary(summary = null) {
  if (!isPlainObject(summary)) return null;
  return sanitizeDestructiveAuthorizationSummary({
    destructiveRequirement: {
      required: summary.required === true,
      actionClass: summary.actionClass,
      targetSafeRef: summary.targetSafeRef,
    },
    destructiveAuthorization: {
      authorizationRef: summary.strongAuth?.authzRef,
      challengeRef: summary.strongAuth?.challengeRef,
      confirmationRef: summary.strongAuth?.confirmationRef,
      policyGate: summary.policyGate,
    },
    reason: summary.reason,
  });
}

export function sanitizeAuditViewError(error = null) {
  if (!isPlainObject(error)) return null;
  const code = safeAuditViewRef(error.code ?? error.reasonCode, 'runtime.error')?.replace(/:/gu, '.');
  return {
    name: safeAuditViewRef(error.name, 'RuntimeError'),
    code,
    message: 'Runtime error redacted',
    redactionRequired: true,
  };
}

export function sanitizeAuditViewArtifactMetadata(value = null) {
  const entries = asArray(value);
  return entries.map((entry) => {
    const source = isPlainObject(entry) ? entry : {};
    const output = {
      artifactRef: safeAuditViewRef(source.artifactRef ?? source.ref, null),
      outputRef: safeAuditViewRef(source.outputRef, null),
      filename: safeAuditViewRef(source.filename, null),
      mimeType: safeAuditViewText(source.mimeType ?? source.contentType, null),
      byteSize: safeNumber(source.byteSize ?? source.byteLength, null),
      hash: safeAuditViewRef(source.hash ?? source.checksum, null),
      redactionRequired: true,
    };
    return Object.fromEntries(Object.entries(output).filter(([, child]) => child !== null && child !== ''));
  });
}

function sanitizeDownloads(resultSummary = {}) {
  return asArray(resultSummary.downloads).map((download) => sanitizeAuditViewArtifactMetadata([download])[0]);
}

function sanitizeResponseSummary(response = null) {
  if (!isPlainObject(response)) return null;
  const output = {
    status: safeNumber(response.status, null),
    ok: response.ok === true,
    contentType: safeAuditViewText(response.contentType, null),
    responseMaterial: safeAuditViewRef(response.responseMaterial, null),
    bodyShape: safeAuditViewRef(response.bodyShape ?? response.bodySummary?.kind, null),
    byteLength: safeNumber(response.byteLength ?? response.bodySummary?.byteLength, null),
    itemCount: safeNumber(response.itemCount ?? response.bodySummary?.itemCount, null),
    redirect: sanitizeRedirectSummary(response.redirect),
  };
  return Object.fromEntries(Object.entries(output).filter(([, child]) => child !== null && child !== ''));
}

export function sanitizeRedirectSummary(redirect = null) {
  if (!isPlainObject(redirect)) return null;
  const output = {
    status: safeNumber(redirect.status, null),
    crossOrigin: redirect.crossOrigin === true,
    locationOrigin: safeAuditViewText(redirect.locationOrigin, null),
  };
  return Object.fromEntries(Object.entries(output).filter(([, child]) => child !== null && child !== ''));
}

export function sanitizeBrowserTraceSummary(trace = null) {
  if (!isPlainObject(trace)) return null;
  const output = {
    traceType: safeAuditViewRef(trace.traceType, 'sanitized_browser_execution_trace'),
    status: safeAuditViewRef(trace.status, null),
    actionRef: safeAuditViewRef(trace.actionRef, null),
    routeRef: safeAuditViewRef(trace.routeRef, null),
    slotNames: asArray(trace.slotNames).map((slot) => safeAuditViewRef(slot)).filter(Boolean),
    startOriginHash: safeAuditViewRef(trace.startOriginHash, null),
    startPathHash: safeAuditViewRef(trace.startPathHash, null),
    steps: asArray(trace.steps).map((step) => ({
      kind: safeAuditViewRef(step?.kind, 'step'),
      status: safeAuditViewRef(step?.status, 'completed'),
      selectorHash: safeAuditViewRef(step?.selectorHash, null),
      reasonCode: safeAuditViewRef(step?.reasonCode, null),
    })).map((step) => Object.fromEntries(Object.entries(step).filter(([, child]) => child !== null))),
    networkEvents: asArray(trace.networkEvents).map((event) => ({
      kind: safeAuditViewRef(event?.kind, 'network_event'),
      status: safeAuditViewRef(event?.status, 'observed'),
      originHash: safeAuditViewRef(event?.originHash, null),
      pathHash: safeAuditViewRef(event?.pathHash, null),
      reasonCode: safeAuditViewRef(event?.reasonCode, null),
    })).map((event) => Object.fromEntries(Object.entries(event).filter(([, child]) => child !== null))),
    authEvents: asArray(trace.authEvents).map((event) => ({
      event: safeAuditViewRef(event?.event, 'browser.auth.observed'),
      originHash: safeAuditViewRef(event?.originHash, null),
      sessionRef: safeAuditViewRef(event?.sessionRef, null),
      materialSummary: {
        types: asArray(event?.materialSummary?.types).map((type) => safeAuditViewRef(type)).filter(Boolean),
        count: safeNumber(event?.materialSummary?.count, 0) ?? 0,
      },
    })),
    completion: isPlainObject(trace.completion)
      ? {
        observed: trace.completion.observed === true,
        reasonCode: safeAuditViewRef(trace.completion.reasonCode, null),
      }
      : null,
    cleanup: isPlainObject(trace.cleanup)
      ? { sessionClosed: trace.cleanup.sessionClosed === true }
      : null,
    redactionRequired: true,
  };
  const sanitized = Object.fromEntries(Object.entries(output).filter(([, child]) => child !== null));
  assertNoExecutionSensitiveMaterial(sanitized);
  return sanitized;
}

export function sanitizeProviderResultEnvelope(result = null) {
  if (!isPlainObject(result)) return null;
  const resultSummary = isPlainObject(result.resultSummary) ? result.resultSummary : result;
  const browserTrace = resultSummary.browserExecutionTrace ?? result.browserExecutionTrace ?? null;
  const output = {
    providerId: safeAuditViewRef(result.providerId ?? resultSummary.providerId, null),
    providerKind: safeAuditViewRef(result.providerKind, null),
    status: safeAuditViewRef(result.status, null),
    reasonCode: safeAuditViewRef(result.reasonCode ?? resultSummary.reasonCode, null),
    outcome: safeAuditViewRef(resultSummary.outcome, null),
    runtimeMode: safeAuditViewRef(resultSummary.runtimeMode, null),
    response: sanitizeResponseSummary(resultSummary.response),
    redirect: sanitizeRedirectSummary(resultSummary.redirect),
    downloads: sanitizeDownloads(resultSummary),
    browserExecutionTrace: sanitizeBrowserTraceSummary(browserTrace),
    authSummary: sanitizeAuditViewAuthSummary(result.authSummary ?? resultSummary.authSummary),
    policySummary: sanitizeAuditViewPolicySummary(result.policySummary ?? resultSummary.policySummary),
    artifactRefs: asArray(result.artifactRefs ?? resultSummary.artifactRefs)
      .map((ref) => safeAuditViewRef(ref))
      .filter(Boolean),
    redactionRequired: true,
  };
  const sanitized = Object.fromEntries(Object.entries(output).filter(([, child]) => (
    child !== null && (!Array.isArray(child) || child.length > 0)
  )));
  assertNoExecutionSensitiveMaterial(sanitized);
  return sanitized;
}

export function sanitizeRuntimeReportForAuditView(report = null) {
  if (!isPlainObject(report)) return null;
  const resultSummary = isPlainObject(report.resultSummary) ? report.resultSummary : {};
  const output = {
    schemaVersion: report.schemaVersion,
    executionVersion: safeAuditViewRef(report.executionVersion, null),
    reportType: safeAuditViewRef(report.reportType, 'RuntimeExecutionReport'),
    requestId: safeAuditViewRef(report.requestId, null),
    executionId: safeAuditViewRef(report.executionId, null),
    capabilityId: safeAuditViewRef(report.capabilityId, null),
    executionContractRef: safeAuditViewRef(report.executionContractRef, null),
    policyDecisionRef: safeAuditViewRef(report.policyDecisionRef, null),
    verdict: safeAuditViewRef(report.verdict, null),
    status: safeAuditViewRef(report.status, null),
    capabilityKind: safeAuditViewRef(report.capabilityKind, null),
    providerId: safeAuditViewRef(report.providerId, null),
    providerKind: safeAuditViewRef(report.providerKind, null),
    dispatchStatus: safeAuditViewRef(report.dispatchStatus, null),
    runtimeDispatchAllowed: safeBoolean(report.runtimeDispatchAllowed),
    providerInvoked: safeBoolean(report.providerInvoked),
    executionAttempted: safeBoolean(report.executionAttempted),
    runtimeExecuted: safeBoolean(report.runtimeExecuted),
    sideEffectAttempted: safeBoolean(report.sideEffectAttempted),
    sideEffectSucceeded: safeBoolean(report.sideEffectSucceeded),
    sideEffectFailed: safeBoolean(report.sideEffectFailed),
    reasonCode: safeAuditViewRef(report.reasonCode, null),
    blockedReason: safeAuditViewRef(report.blockedReason, null),
    artifactRefs: asArray(report.artifactRefs).map((ref) => safeAuditViewRef(ref)).filter(Boolean),
    authSummary: sanitizeAuditViewAuthSummary(report.authSummary),
    policySummary: sanitizeAuditViewPolicySummary(report.policySummary),
    destructiveSummary: sanitizeAuditViewDestructiveSummary(report.destructiveSummary),
    sanitizedError: sanitizeAuditViewError(report.sanitizedError),
    resultSummary: sanitizeProviderResultEnvelope({ resultSummary }),
    redactionRequired: true,
  };
  const sanitized = Object.fromEntries(Object.entries(output).filter(([, child]) => (
    child !== null && (!Array.isArray(child) || child.length > 0)
  )));
  assertNoExecutionSensitiveMaterial(sanitized);
  return sanitized;
}

export function sanitizeAuditEventForAuditView(event = null) {
  if (!isPlainObject(event)) return null;
  const sanitized = {
    eventType: safeAuditViewRef(event.eventType, 'runtime.audit.event'),
    auditRef: safeAuditViewRef(event.auditRef, null),
    requestId: safeAuditViewRef(event.requestId, null),
    executionId: safeAuditViewRef(event.executionId, null),
    capabilityId: safeAuditViewRef(event.capabilityId, null),
    providerId: safeAuditViewRef(event.providerId, null),
    verdict: safeAuditViewRef(event.verdict, null),
    status: safeAuditViewRef(event.status, null),
    runtimeDispatchAllowed: safeBoolean(event.runtimeDispatchAllowed),
    executionAttempted: safeBoolean(event.executionAttempted),
    sideEffectAttempted: safeBoolean(event.sideEffectAttempted),
    sideEffectSucceeded: safeBoolean(event.sideEffectSucceeded),
    sideEffectFailed: safeBoolean(event.sideEffectFailed),
    blockedReason: safeAuditViewRef(event.blockedReason, null),
    reasonCode: safeAuditViewRef(event.reasonCode, null),
    artifactRefs: asArray(event.artifactRefs).map((ref) => safeAuditViewRef(ref)).filter(Boolean),
    authSummary: sanitizeAuditViewAuthSummary(event.authSummary),
    policySummary: sanitizeAuditViewPolicySummary(event.policySummary),
    destructiveSummary: sanitizeAuditViewDestructiveSummary(event.destructiveSummary),
    sanitizedError: sanitizeAuditViewError(event.sanitizedError),
    redactionRequired: true,
  };
  const output = Object.fromEntries(Object.entries(sanitized).filter(([, child]) => (
    child !== null && (!Array.isArray(child) || child.length > 0)
  )));
  assertNoExecutionSensitiveMaterial(output);
  return output;
}
