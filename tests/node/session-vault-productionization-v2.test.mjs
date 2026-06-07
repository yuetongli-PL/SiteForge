import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import {
  createRuntimeInvocationRequest,
} from '../../src/app/planner/index.mjs';
import {
  RUNTIME_AUTH_REASONS,
  createProductionRuntimeProviderRegistry,
  createRuntimeAuditRecorder,
  executeRuntimeInvocation,
  sessionStatusToRuntimeReason,
} from '../../src/app/runtime/index.mjs';
import {
  createSessionVaultAuditLedger,
} from '../../src/app/runtime/session-vault/session-vault-audit-ledger.mjs';
import {
  normalizeSessionMaterialGrant,
} from '../../src/app/runtime/session-vault/session-vault-grants.mjs';
import {
  createSessionInventoryView,
  createSessionVaultHealthView,
} from '../../src/app/runtime/session-vault/session-vault-health.mjs';
import {
  normalizeSessionInspection,
  normalizeSessionRecord,
} from '../../src/app/runtime/session-vault/session-vault-lifecycle.mjs';
import {
  createInMemorySessionVaultProvider,
} from '../../src/app/runtime/session-vault/session-vault-provider.mjs';
import {
  createGovernedExecutionPolicyDecision,
} from '../../src/domain/policies/execution/index.mjs';

const FIXTURE_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'session-vault-productionization-v2',
);

const CANARIES = Object.freeze([
  'sf_vault_token_secret_123',
  'sf_vault_cookie_secret_456',
  'sf_vault_session_handle_secret_should_not_log',
  'sf_vault_grant_secret_789',
  'sf_vault_credential_secret_000',
]);

function assertNoCanaryLeak(payload, label = 'session vault output') {
  const serialized = JSON.stringify(payload);
  for (const canary of CANARIES) {
    assert.equal(serialized.includes(canary), false, `${label} leaked ${canary}`);
  }
  assert.doesNotMatch(serialized, /Bearer\s+|Authorization|Cookie\s*[:=]|Set-Cookie|credential|password/u);
}

function scope({ origin = 'https://vault.example.test', operations = ['read'] } = {}) {
  return { origin, operations };
}

function sessionRecord(overrides = {}) {
  return {
    sessionHandle: CANARIES[2],
    sessionRef: 'auth-session:vault-safe-ref',
    status: 'active',
    active: true,
    origin: 'https://vault.example.test',
    scopes: [scope()],
    expiresAt: '2030-01-01T00:00:00.000Z',
    lastUsedAt: '2029-01-01T00:00:00.000Z',
    policyVersion: 'policy:vault-v2',
    materialSummary: { types: ['bearer_token'], count: 1 },
    ...overrides,
  };
}

function authRequirement() {
  return {
    required: true,
    mode: 'session_handle',
    scopes: [scope()],
    material: {
      allowedTypes: ['bearer_token'],
      injectionTarget: 'http_request',
    },
    policy: {
      requireGovernanceGate: true,
      allowCredentialForwarding: false,
      allowRawHeaderAudit: false,
      allowRawCookieAudit: false,
      allowRawBodyAudit: false,
    },
  };
}

function requestFor(requirement = authRequirement()) {
  return createRuntimeInvocationRequest({
    capabilityPlan: {
      siteId: 'vault.example.test',
      capabilityId: 'capability:vault-v2:read',
      executionContractRef: 'execution-contract:vault-v2:read',
      planId: 'plan:vault-v2:read',
    },
    executionContractRef: 'execution-contract:vault-v2:read',
    policyDecisionRef: 'policy:vault-v2:read',
    verdictHint: 'allow',
    authRequirement: requirement,
    auth: {
      sessionHandle: CANARIES[2],
      requestedScopes: [scope()],
      authGate: { satisfied: true, gateId: 'gate:vault-v2', policyId: 'policy:vault-v2' },
    },
  });
}

function policyFor(request) {
  return createGovernedExecutionPolicyDecision({
    executionId: 'execution:vault-v2:read',
    capabilityId: request.capabilityId,
    executionContractRef: request.executionContractRef,
    verdict: 'allow',
    gates: [],
    gateStatus: null,
    runtimeDispatchAllowed: true,
    siteAdapterInvocationAllowed: true,
    downloaderInvocationAllowed: false,
    auditRequired: false,
  });
}

test('session vault production fixtures are present and sanitized', async () => {
  const files = (await readdir(FIXTURE_DIR)).filter((file) => file.endsWith('.json')).sort();
  assert.deepEqual(files, ['session-inventory.json']);
  const fixture = JSON.parse(await readFile(path.join(FIXTURE_DIR, files[0]), 'utf8'));
  assert.equal(Array.isArray(fixture.sessions), true);
  assertNoCanaryLeak(fixture, 'fixture');
});

test('session lifecycle normalization maps statuses and runtime reasons', () => {
  /** @type {Array<[string, boolean, string|null]>} */
  const cases = [
    ['active', true, null],
    ['expired', false, RUNTIME_AUTH_REASONS.sessionExpired],
    ['revoked', false, RUNTIME_AUTH_REASONS.sessionExpired],
    ['disabled', false, RUNTIME_AUTH_REASONS.sessionExpired],
    ['stale', false, RUNTIME_AUTH_REASONS.sessionExpired],
  ];
  for (const [status, active, reason] of cases) {
    const normalized = normalizeSessionInspection(sessionRecord({
      status,
      active,
      revoked: status === 'revoked',
      expired: status === 'expired',
      disabled: status === 'disabled',
      stale: status === 'stale',
    }), { sessionHandle: CANARIES[2] });
    assert.equal(normalized.status, status);
    assert.equal(normalized.active, active);
    assert.equal(sessionStatusToRuntimeReason(status), reason);
    assertNoCanaryLeak(normalized, status);
  }

  const secretRef = normalizeSessionRecord(sessionRecord({ sessionRef: CANARIES[2] }), {
    sessionHandle: CANARIES[2],
  });
  assert.notEqual(secretRef.sessionRef, CANARIES[2]);
  assertNoCanaryLeak(secretRef, 'safe sessionRef');
});

test('grant normalization and ledger events never expose raw material', () => {
  const ledger = createSessionVaultAuditLedger();
  const grantSummary = normalizeSessionMaterialGrant({
    grantId: CANARIES[3],
    materials: [
      { type: 'bearer_token', value: CANARIES[0] },
      { type: 'cookie', value: CANARIES[1] },
    ],
    summary: { materialTypes: ['bearer_token', 'cookie'], materialCount: 2 },
  }, {
    providerId: 'api_read_provider',
    capabilityId: 'capability:vault-v2:read',
    purpose: 'http_request_auth',
    scopes: [scope()],
  });
  ledger.record({
    eventType: 'session.grant.issued',
    sessionRef: 'auth-session:vault-safe-ref',
    providerId: 'api_read_provider',
    capabilityId: 'capability:vault-v2:read',
    purpose: 'http_request_auth',
    scopes: [scope()],
    materialSummary: grantSummary.materialSummary,
    outcome: 'issued',
  });

  assert.deepEqual(grantSummary.materialSummary, { types: ['bearer_token', 'cookie'], count: 2 });
  assert.notEqual(grantSummary.grantRef, CANARIES[3]);
  assert.equal(ledger.listEvents()[0].eventType, 'session.grant.issued');
  assertNoCanaryLeak({ grantSummary, ledger: ledger.listEvents() }, 'grant ledger');
});

test('production session vault provider tracks grant issued and release lifecycle', async () => {
  const vault = createInMemorySessionVaultProvider({
    sessions: [sessionRecord()],
    async materialResolver() {
      return {
        grantId: CANARIES[3],
        materials: [{ type: 'bearer_token', value: CANARIES[0] }],
        summary: { materialTypes: ['bearer_token'], materialCount: 1 },
      };
    },
  });

  const inspection = await vault.inspectSession({ sessionHandle: CANARIES[2] });
  assert.equal(inspection.active, true);
  const grant = await vault.getScopedSessionMaterial({
    sessionHandle: CANARIES[2],
    providerId: 'api_read_provider',
    capabilityId: 'capability:vault-v2:read',
    scopes: [scope()],
    materialTypes: ['bearer_token'],
    purpose: 'http_request_auth',
  });
  assert.equal(grant.materials[0].value, CANARIES[0]);
  await vault.releaseScopedSessionMaterial({ grantId: CANARIES[3] });

  const events = vault.listLedgerEvents();
  assert.equal(events.some((event) => event.eventType === 'session.inspect.completed'), true);
  assert.equal(events.some((event) => event.eventType === 'session.grant.issued'), true);
  assert.equal(events.some((event) => event.eventType === 'session.grant.released'), true);
  assertNoCanaryLeak({ inspection, events, inventory: vault.listSessionInventory() }, 'provider lifecycle');
});

test('scope denied, material unavailable, and release failure ledger events are sanitized', async () => {
  const unavailableVault = createInMemorySessionVaultProvider({
    sessions: [sessionRecord()],
  });
  const denied = await unavailableVault.getScopedSessionMaterial({
    sessionHandle: CANARIES[2],
    providerId: 'api_read_provider',
    capabilityId: 'capability:vault-v2:read',
    scopes: [scope({ origin: 'https://other.example.test' })],
    materialTypes: ['bearer_token'],
    purpose: 'http_request_auth',
  });
  assert.equal(denied, null);
  assert.equal(unavailableVault.listLedgerEvents().some((event) => event.eventType === 'session.scope.denied'), true);

  const unavailable = await unavailableVault.getScopedSessionMaterial({
    sessionHandle: CANARIES[2],
    providerId: 'api_read_provider',
    capabilityId: 'capability:vault-v2:read',
    scopes: [scope()],
    materialTypes: ['bearer_token'],
    purpose: 'http_request_auth',
  });
  assert.equal(unavailable, null);
  assert.equal(unavailableVault.listLedgerEvents().some((event) => event.eventType === 'session.material.unavailable'), true);

  const releaseVault = createInMemorySessionVaultProvider({
    sessions: [sessionRecord()],
    async materialResolver() {
      return {
        grantId: CANARIES[3],
        materials: [{ type: 'bearer_token', value: CANARIES[0] }],
        summary: { materialTypes: ['bearer_token'], materialCount: 1 },
      };
    },
    async releaseMaterial() {
      throw new Error(`release failed ${CANARIES[3]}`);
    },
  });
  await releaseVault.getScopedSessionMaterial({
    sessionHandle: CANARIES[2],
    providerId: 'api_read_provider',
    capabilityId: 'capability:vault-v2:read',
    scopes: [scope()],
    materialTypes: ['bearer_token'],
    purpose: 'http_request_auth',
  });
  await assert.rejects(() => releaseVault.releaseScopedSessionMaterial({ grantId: CANARIES[3] }));
  assert.equal(releaseVault.listLedgerEvents().some((event) => event.eventType === 'session.grant.release_failed'), true);
  assertNoCanaryLeak({
    unavailableEvents: unavailableVault.listLedgerEvents(),
    releaseEvents: releaseVault.listLedgerEvents(),
  }, 'failure ledger');
});

test('session inventory and health surfaces expose metadata only', () => {
  const records = [
    sessionRecord(),
    sessionRecord({
      sessionHandle: `${CANARIES[2]}-revoked`,
      sessionRef: CANARIES[2],
      status: 'revoked',
      revoked: true,
      materialSummary: { types: ['cookie'], count: 1 },
    }),
  ];
  const inventory = createSessionInventoryView(records);
  const health = createSessionVaultHealthView(records, {
    ledgerEvents: [{ eventType: 'session.inspect.completed' }],
  });
  assert.equal(inventory.length, 2);
  assert.equal(health.sessionCount, 2);
  assert.equal(health.byStatus.active, 1);
  assert.equal(health.byStatus.revoked, 1);
  assertNoCanaryLeak({ inventory, health }, 'inventory health');
});

test('production vault remains compatible with Auth Runtime V1 provider adapter', async () => {
  const requirement = authRequirement();
  const request = requestFor(requirement);
  const fetchCalls = [];
  const vault = createInMemorySessionVaultProvider({
    sessions: [sessionRecord()],
    async materialResolver() {
      return {
        grantId: CANARIES[3],
        materials: [{ type: 'bearer_token', value: CANARIES[0] }],
        summary: { materialTypes: ['bearer_token'], materialCount: 1 },
      };
    },
  });
  const auditRecorder = createRuntimeAuditRecorder();
  const report = await executeRuntimeInvocation({
    invocationRequest: request,
    policyDecision: policyFor(request),
    executionContract: {
      capabilityKind: 'read',
      operationKind: 'api_request',
      contractKind: 'api_request',
      runtimeBinding: {
        httpRequest: {
          url: 'https://vault.example.test/api/items',
          method: 'GET',
        },
      },
      authRequirement: requirement,
      redactionRequired: true,
    },
    runtimeContext: {
      sessionVault: vault,
      async fetchImpl(url, options) {
        fetchCalls.push({ url, options });
        assert.equal(options.headers.authorization, `Bearer ${CANARIES[0]}`);
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
    },
    providerRegistry: createProductionRuntimeProviderRegistry(),
    auditRecorder,
  });

  assert.equal(report.status, 'completed');
  assert.equal(report.authSummary.used, true);
  assert.equal(fetchCalls.length, 1);
  assert.equal(vault.listLedgerEvents().some((event) => event.eventType === 'session.grant.released'), true);
  assertNoCanaryLeak({
    report,
    auditEvents: auditRecorder.listEvents(),
    ledger: vault.listLedgerEvents(),
    inventory: vault.listSessionInventory(),
  }, 'auth runtime compatibility');
});
