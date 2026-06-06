// @ts-check

import {
  assertNoExecutionSensitiveMaterial,
} from '../../domain/policies/execution/index.mjs';

function normalizeText(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function safeIdPart(value, fallback = 'event') {
  return normalizeText(value, fallback)
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 120) || fallback;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function sanitizeGateStatus(gateStatus = {}) {
  const output = {};
  if (!gateStatus || typeof gateStatus !== 'object' || Array.isArray(gateStatus)) {
    return output;
  }
  for (const [gate, status] of Object.entries(gateStatus)) {
    output[gate] = {
      satisfied: status === true || status?.satisfied === true,
    };
  }
  return output;
}

function sanitizeAuditError(value) {
  if (!value) return null;
  return sanitizeRuntimeError(value, {
    code: value?.code ?? 'runtime.error',
    message: 'Runtime error redacted',
  });
}

export function sanitizeRuntimeError(error, {
  code = 'runtime.provider_failed',
  message = 'Runtime provider failed',
} = {}) {
  const errorCode = safeIdPart(error?.code ?? code, code).replace(/:/gu, '.');
  const sanitized = {
    name: /^[A-Za-z][A-Za-z0-9_.-]{0,80}$/u.test(String(error?.name ?? 'Error'))
      ? String(error?.name ?? 'Error')
      : 'Error',
    code: errorCode,
    message,
    redactionRequired: true,
  };
  assertNoExecutionSensitiveMaterial(sanitized);
  return sanitized;
}

export function sanitizeRuntimeAuditEvent(event = {}) {
  const requestId = normalizeText(event.requestId, 'runtime-request');
  const auditRef = normalizeText(event.auditRef)
    || `artifact:runtime-audit:${safeIdPart(requestId)}`;
  const sanitized = {
    schemaVersion: event.schemaVersion,
    executionVersion: event.executionVersion,
    eventType: normalizeText(event.eventType, 'runtime_execution_report'),
    auditRef,
    requestId,
    executionId: normalizeText(event.executionId),
    capabilityId: normalizeText(event.capabilityId),
    executionContractRef: normalizeText(event.executionContractRef),
    providerId: normalizeText(event.providerId),
    verdict: normalizeText(event.verdict),
    status: normalizeText(event.status),
    gates: asArray(event.gates).map((gate) => normalizeText(gate)).filter(Boolean),
    gateStatus: sanitizeGateStatus(event.gateStatus),
    runtimeDispatchAllowed: event.runtimeDispatchAllowed === true,
    executionAttempted: event.executionAttempted === true,
    sideEffectAttempted: event.sideEffectAttempted === true,
    sideEffectSucceeded: event.sideEffectSucceeded === true,
    sideEffectFailed: event.sideEffectFailed === true,
    blockedReason: normalizeText(event.blockedReason),
    artifactRefs: asArray(event.artifactRefs).map((ref) => normalizeText(ref)).filter(Boolean),
    sanitizedError: sanitizeAuditError(event.sanitizedError),
    redactionRequired: true,
  };
  assertNoExecutionSensitiveMaterial(sanitized);
  return sanitized;
}

export function createRuntimeAuditRecorder() {
  const events = [];
  return {
    record(event = {}) {
      const sanitized = sanitizeRuntimeAuditEvent({
        ...event,
        auditRef: event.auditRef
          || `artifact:runtime-audit:${safeIdPart(event.requestId)}:${events.length + 1}`,
      });
      events.push(sanitized);
      return sanitized;
    },
    listEvents() {
      return events.map((event) => ({ ...event }));
    },
  };
}
