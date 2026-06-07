// @ts-check

import {
  assertNoExecutionSensitiveMaterial,
} from '../../../domain/policies/execution/index.mjs';
import {
  sanitizeRuntimeAuditView,
} from '../audit-viewer/index.mjs';

function isPlainObject(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function normalizeText(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

export function sanitizeAuditQueryView(value = {}) {
  return sanitizeRuntimeAuditView(value);
}

export function sanitizeAuditQueryViews(values = []) {
  return (Array.isArray(values) ? values : [])
    .map((view) => {
      try {
        return sanitizeAuditQueryView(view);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

export function viewSummary(view = {}) {
  const sanitized = sanitizeAuditQueryView(view);
  const materialTypes = sanitized.authSummary?.materialSummary?.types ?? [];
  const targetOrigins = [...new Set([
    ...(sanitized.authSummary?.scopesRequested ?? []).map((scope) => scope.origin),
    ...(sanitized.authSummary?.scopesGranted ?? []).map((scope) => scope.origin),
  ].filter(Boolean))].sort();
  const summary = {
    sourceDigest: sanitized.sourceDigest,
    requestId: sanitized.invocation?.requestId ?? null,
    capabilityId: sanitized.invocation?.capabilityId ?? null,
    capabilityKind: sanitized.invocation?.capabilityKind ?? null,
    providerId: sanitized.invocation?.providerId ?? null,
    status: sanitized.outcome?.status ?? 'unknown',
    reason: sanitized.outcome?.blockedReason ?? sanitized.outcome?.reasonCode ?? null,
    providerInvoked: sanitized.outcome?.providerInvoked === true,
    executionAttempted: sanitized.outcome?.executionAttempted === true,
    sideEffectAttempted: sanitized.outcome?.sideEffectAttempted === true,
    auth: {
      required: sanitized.authSummary?.required === true,
      used: sanitized.authSummary?.used === true,
      materialTypes,
    },
    targetOrigins,
    policy: sanitized.policySummary
      ? {
        allowed: sanitized.policySummary.allowed === true,
        reason: sanitized.policySummary.reason ?? null,
        policyId: sanitized.policySummary.policyId ?? null,
      }
      : null,
    destructive: sanitized.destructiveSummary
      ? {
        required: sanitized.destructiveSummary.required === true,
        strongAuthPresent: sanitized.destructiveSummary.strongAuth?.present === true,
        policyGateSatisfied: sanitized.destructiveSummary.policyGate?.satisfied === true,
        reason: sanitized.destructiveSummary.reason ?? null,
      }
      : null,
    unsafeInputDetected: sanitized.redactionSummary?.unsafeInputDetected === true,
    redactionRequired: true,
  };
  const output = Object.fromEntries(Object.entries(summary).filter(([, value]) => value !== null));
  assertNoExecutionSensitiveMaterial(output);
  return output;
}

export function normalizeQueryFilter(filter = {}) {
  if (!isPlainObject(filter)) return {};
  return {
    providerId: normalizeText(filter.providerId),
    capabilityKind: normalizeText(filter.capabilityKind),
    reason: normalizeText(filter.reason),
    status: normalizeText(filter.status ?? filter.outcome),
    sideEffectAttempted: typeof filter.sideEffectAttempted === 'boolean' ? filter.sideEffectAttempted : null,
    authUsed: typeof filter.authUsed === 'boolean' ? filter.authUsed : null,
    authRequired: typeof filter.authRequired === 'boolean' ? filter.authRequired : null,
    materialType: normalizeText(filter.materialType),
    targetOrigin: normalizeText(filter.targetOrigin),
    unsafeInputDetected: typeof filter.unsafeInputDetected === 'boolean' ? filter.unsafeInputDetected : null,
  };
}
