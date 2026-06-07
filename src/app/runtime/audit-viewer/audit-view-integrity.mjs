// @ts-check

import {
  assertNoExecutionSensitiveMaterial,
} from '../../../domain/policies/execution/index.mjs';
import {
  safeAuditViewRef,
  stableAuditViewHash,
} from './audit-view-sanitizer.mjs';

function normalizeText(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

export function createAuditViewSourceDigest(value = null) {
  return stableAuditViewHash(JSON.stringify(value ?? null), 'runtime-audit-source');
}

export function sanitizeAuditViewSourceSummary(summary = {}) {
  const sanitized = {
    sourceRef: safeAuditViewRef(summary.sourceRef ?? summary.path ?? summary.name, 'runtime-audit-source'),
    kind: safeAuditViewRef(summary.kind, 'json'),
    byteLength: Number.isFinite(Number(summary.byteLength)) ? Number(summary.byteLength) : null,
    digest: safeAuditViewRef(summary.digest, null),
  };
  const output = Object.fromEntries(Object.entries(sanitized).filter(([, value]) => value !== null));
  assertNoExecutionSensitiveMaterial(output);
  return output;
}

export function buildAuditViewIntegrity({
  report = null,
  auditEvents = [],
  sourceSummaries = [],
} = {}) {
  const warnings = [];
  const reportRequestId = normalizeText(report?.requestId);
  const mismatched = auditEvents.some((event) => (
    reportRequestId && normalizeText(event?.requestId) && normalizeText(event.requestId) !== reportRequestId
  ));
  if (mismatched) {
    warnings.push({
      code: 'runtime.audit_view.input_mismatch',
      message: 'Audit bundle contains events for a different request.',
    });
  }
  const sanitized = {
    status: warnings.length ? 'warning' : 'ok',
    warnings,
    sourceSummaries: sourceSummaries.map(sanitizeAuditViewSourceSummary),
  };
  assertNoExecutionSensitiveMaterial(sanitized);
  return sanitized;
}
