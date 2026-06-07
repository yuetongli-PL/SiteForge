// @ts-check

import {
  RUNTIME_AUTH_REASONS,
} from '../runtime-reasons.mjs';
import {
  normalizeSessionMaterialGrant,
} from '../session-vault/session-vault-grants.mjs';
import {
  assertSessionVaultSafeOutput,
  safeSessionVaultRef,
} from '../session-vault/session-vault-sanitizer.mjs';
import {
  assertProductionSessionVaultAdapterValid,
} from './session-vault-adapter-interface.mjs';

export const PRODUCTION_SESSION_VAULT_ADAPTER_CONFORMANCE_SCHEMA_VERSION =
  'production-session-vault-adapter-conformance/v1';

function normalizeText(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

export async function runProductionSessionVaultAdapterConformance({
  adapter = null,
  sessionHandle = '',
  providerId = 'api_read_provider',
  capabilityId = 'capability:production-vault-adapter:read',
  scopes = [],
  materialTypes = ['bearer_token'],
  purpose = 'http_request_auth',
} = {}) {
  const findings = [];
  try {
    assertProductionSessionVaultAdapterValid(adapter);
  } catch (error) {
    findings.push({
      code: 'adapter_interface_invalid',
      reason: safeSessionVaultRef(error?.code ?? 'adapter_interface_invalid', 'adapter_interface_invalid'),
    });
  }

  let inspection = null;
  let grantSummary = null;
  let releaseSummary = null;
  let healthSummary = null;

  const assertSafeSurface = (label, value) => {
    try {
      assertSessionVaultSafeOutput(value);
    } catch {
      findings.push({
        code: `${label}_unsafe`,
        reason: 'redaction_required',
      });
    }
  };

  if (findings.length === 0) {
    inspection = await adapter.inspectSession({ sessionHandle });
    if (inspection?.active !== true) {
      findings.push({
        code: 'session_not_active',
        reason: safeSessionVaultRef(inspection?.status ?? RUNTIME_AUTH_REASONS.sessionMissing, 'session_not_active'),
      });
    }
  }

  if (findings.length === 0) {
    const grant = await adapter.getScopedSessionMaterial({
      sessionHandle,
      providerId,
      capabilityId,
      scopes,
      materialTypes,
      purpose,
    });
    if (!grant) {
      findings.push({
        code: 'material_unavailable',
        reason: RUNTIME_AUTH_REASONS.materialUnavailable,
      });
    } else {
      grantSummary = normalizeSessionMaterialGrant(grant, {
        providerId,
        capabilityId,
        purpose,
        scopes,
        outcome: 'issued',
      });
      try {
        releaseSummary = await adapter.releaseScopedSessionMaterial({ grantId: grant.grantId });
      } catch {
        findings.push({
          code: 'release_failed',
          reason: RUNTIME_AUTH_REASONS.sessionVaultUnavailable,
        });
      }
    }
  }

  if (findings.length === 0) {
    try {
      healthSummary = await adapter.healthCheck();
      assertSafeSurface('health', healthSummary);
      assertSafeSurface('ledger', adapter.listLedgerEvents());
      assertSafeSurface('inventory', adapter.listSessionInventory());
      if (healthSummary?.redactionRequired !== true) {
        findings.push({
          code: 'health_not_redaction_required',
          reason: 'redaction_required',
        });
      }
    } catch {
      findings.push({
        code: 'health_unavailable',
        reason: 'redaction_required',
      });
    }
  }

  const report = {
    schemaVersion: PRODUCTION_SESSION_VAULT_ADAPTER_CONFORMANCE_SCHEMA_VERSION,
    adapterId: safeSessionVaultRef(adapter?.adapterId, 'production-vault-adapter'),
    status: findings.length === 0 ? 'passed' : 'failed',
    checks: {
      interfaceValid: findings.some((finding) => finding.code === 'adapter_interface_invalid') !== true,
      inspectSupported: inspection !== null,
      materialLeaseSupported: grantSummary !== null,
      releaseSupported: releaseSummary?.released === true,
      healthSupported: healthSummary?.redactionRequired === true,
    },
    sessionRef: safeSessionVaultRef(inspection?.sessionRef, null),
    materialSummary: grantSummary?.materialSummary ?? null,
    health: healthSummary ? {
      status: normalizeText(healthSummary.status, 'metadata_only'),
      sessionCount: Math.max(0, Number(healthSummary.sessionCount) || 0),
      activeGrantCount: Math.max(0, Number(healthSummary.activeGrantCount) || 0),
      ledgerEventCount: Math.max(0, Number(healthSummary.ledgerEventCount) || 0),
      redactionRequired: true,
    } : null,
    findings,
    redactionRequired: true,
  };
  return assertSessionVaultSafeOutput(report);
}
