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

/** @param {Record<string, any>} options */
export function createMockSessionVault(options = {}) {
  const {
    available = true,
    sessionHandle = 'mock-session-handle',
    sessionRef = 'auth-session:mock',
    scopes = [{
      origin: 'https://auth.example.test',
      operations: ['read', 'query', 'download'],
    }],
    material = [{
      type: 'bearer_token',
      value: 'synthetic-mock-bearer-token',
    }],
    grantId = null,
    grantSummary = null,
    failureMode = null,
  } = options;
  const counters = {
    inspectSessionCalls: 0,
    getScopedSessionMaterialCalls: 0,
    releaseScopedSessionMaterialCalls: 0,
    materialIssuedCount: 0,
    releaseCalls: 0,
  };
  return {
    vaultType: 'mock_session_boundary',
    counters,
    getCounters() {
      return { ...counters };
    },
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
    /** @param {Record<string, any>} request */
    async inspectSession(request = {}) {
      const { sessionHandle: requestedHandle } = request;
      counters.inspectSessionCalls += 1;
      if (failureMode === 'inspectThrows') {
        throw new Error('Mock inspect failed with synthetic secret material');
      }
      if (failureMode === 'missingSession' || !normalizeText(requestedHandle)) {
        return null;
      }
      if (failureMode === 'expiredSession') {
        return {
          sessionRef,
          status: 'expired',
          expired: true,
          scopes,
          materialPolicy: 'metadata_only',
          redactionRequired: true,
        };
      }
      if (failureMode === 'revokedSession') {
        return {
          sessionRef,
          status: 'revoked',
          revoked: true,
          scopes,
          materialPolicy: 'metadata_only',
          redactionRequired: true,
        };
      }
      return {
        sessionRef,
        status: 'active',
        active: true,
        handleMatches: requestedHandle === sessionHandle || Boolean(requestedHandle),
        scopes: failureMode === 'scopeMismatch' ? [] : scopes,
        materialPolicy: 'metadata_only',
        redactionRequired: true,
      };
    },
    async getScopedSessionMaterial() {
      counters.getScopedSessionMaterialCalls += 1;
      if (failureMode === 'materialThrows') {
        throw new Error('Mock material failed with synthetic cookie material');
      }
      if (failureMode === 'materialUnavailable') {
        return null;
      }
      counters.materialIssuedCount += 1;
      return {
        grantId: grantId ?? `grant:mock:${counters.materialIssuedCount}`,
        materials: failureMode === 'injectionFailure'
          ? [{ type: 'custom_header', name: '', value: 'synthetic-api-key-material' }]
          : material,
        summary: grantSummary ?? {
          materialTypes: [...new Set(material.map((entry) => normalizeText(entry?.type ?? entry?.materialType)).filter(Boolean))],
          materialCount: material.length,
        },
      };
    },
    async releaseScopedSessionMaterial() {
      counters.releaseScopedSessionMaterialCalls += 1;
      counters.releaseCalls += 1;
      if (failureMode === 'releaseThrows') {
        throw new Error('Mock release failed with synthetic authorization material');
      }
      return {
        released: true,
        redactionRequired: true,
      };
    },
  };
}
