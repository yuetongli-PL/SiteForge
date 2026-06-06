// @ts-check

import {
  assertNoExecutionSensitiveMaterial,
} from '../../domain/policies/execution/index.mjs';

function normalizeText(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function safeIdPart(value, fallback = 'synthetic') {
  return normalizeText(value, fallback)
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 120) || fallback;
}

export function createMockSessionVault({
  available = true,
} = {}) {
  return {
    vaultType: 'mock_session_boundary',
    async resolveSessionRequirement({
      sessionRequirementRef = 'session-requirement:synthetic',
      requestId = 'runtime-request',
    } = {}) {
      const sessionBoundary = {
        boundaryType: 'MockRuntimeSessionBoundary',
        runtimeBoundary: 'app/runtime',
        sessionRequirementRef,
        availability: available === true ? 'synthetic_available' : 'synthetic_unavailable',
        leaseRef: `session-requirement:${safeIdPart(sessionRequirementRef)}:${safeIdPart(requestId)}`,
        placeholderKind: 'synthetic_runtime_session_placeholder',
        materialized: false,
        materialPolicy: 'placeholder_only',
        persistentSessionAllowed: false,
        redactionRequired: true,
      };
      assertNoExecutionSensitiveMaterial(sessionBoundary);
      return sessionBoundary;
    },
  };
}
