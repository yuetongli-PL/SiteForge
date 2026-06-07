import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  createRuntimeInvocationRequest,
} from '../../src/app/planner/index.mjs';
import {
  BROWSER_ACTION_PROVIDER_ID,
  PRODUCTION_SESSION_VAULT_ADAPTER_CAPABILITY_MATRIX,
  createProductionRuntimeProviderRegistry,
  createProductionSessionVaultAdapterAuditSink,
  createProductionSessionVaultAdapterInterface,
  createRuntimeAuditRecorder,
  executeRuntimeInvocation,
  runProductionSessionVaultAdapterConformance,
  validateProductionSessionVaultAdapter,
} from '../../src/app/runtime/index.mjs';
import {
  createInMemoryProductionVaultAdapter,
} from '../../src/app/runtime/session-vault-adapters/in-memory-production-vault-adapter.mjs';
import {
  createFakeControlledBrowserRuntimeDeps,
} from '../../src/app/runtime/testing.mjs';
import {
  createGovernedExecutionPolicyDecision,
} from '../../src/domain/policies/execution/index.mjs';

const CANARIES = Object.freeze([
  'sf_prod_vault_cookie_secret_123',
  'sf_prod_vault_token_secret_456',
  'sf_prod_vault_credential_secret_789',
  'sf_prod_vault_storage_secret_000',
]);

const HTTP_ORIGIN = 'https://prod-vault.example.test';
const BROWSER_START_URL = 'http://prod-vault-browser.example.test/contact';
const BROWSER_ORIGIN = new URL(BROWSER_START_URL).origin;

function assertNoCanaryLeak(payload, label = 'payload') {
  const serialized = JSON.stringify(payload);
  for (const canary of CANARIES) {
    assert.equal(serialized.includes(canary), false, `${label} leaked ${canary}`);
  }
  assert.doesNotMatch(
    serialized,
    /Bearer\s+|Authorization|Cookie\s*[:=]|Set-Cookie|credential|password|storageState|localStorage|IndexedDB/u,
  );
}

function scope({
  origin = HTTP_ORIGIN,
  operations = ['read'],
  resources = undefined,
} = {}) {
  return {
    origin,
    operations,
    ...(resources ? { resources } : {}),
  };
}

function sessionRecord({
  sessionHandle = 'prod-vault-session-handle-safe',
  sessionRef = 'auth-session:prod-vault-safe-ref',
  origin = HTTP_ORIGIN,
  operations = ['read'],
  materials = [
    { type: 'bearer_token', value: CANARIES[1] },
    { type: 'api_key', value: CANARIES[2], headerName: 'x-api-key' },
    { type: 'custom_header', value: CANARIES[3], headerName: 'x-siteforge-safe' },
  ],
  leaseTtlMs = 60_000,
  status = 'active',
} = {}) {
  return {
    sessionHandle,
    sessionRef,
    status,
    active: status === 'active',
    origin,
    scopes: [scope({ origin, operations })],
    leaseTtlMs,
    policyVersion: 'policy:prod-vault-adapter-v1',
    materialSummary: {
      types: [...new Set(materials.map((entry) => entry.type))],
      count: materials.length,
    },
    materials,
  };
}

function authRequirement({
  origin = HTTP_ORIGIN,
  operations = ['read'],
  materialTypes = ['bearer_token'],
  injectionTarget = 'http_request',
} = {}) {
  return {
    required: true,
    mode: 'session_handle',
    scopes: [scope({ origin, operations })],
    material: {
      allowedTypes: materialTypes,
      injectionTarget,
    },
    policy: {
      requireGovernanceGate: true,
      allowCredentialForwarding: false,
      allowRawHeaderAudit: false,
      allowRawCookieAudit: false,
      allowRawBodyAudit: false,
      allowStorageStatePersistence: false,
      allowProfilePersistence: false,
      allowAutomaticLogin: false,
    },
  };
}

function requestFor({
  capabilityId = 'capability:prod-vault-adapter:read',
  executionContractRef = 'execution-contract:prod-vault-adapter:read',
  origin = HTTP_ORIGIN,
  operations = ['read'],
  requirement = authRequirement({ origin, operations }),
  sessionHandle = 'prod-vault-session-handle-safe',
} = {}) {
  return createRuntimeInvocationRequest({
    capabilityPlan: {
      siteId: new URL(origin).hostname,
      capabilityId,
      executionContractRef,
      planId: `plan:${capabilityId.replace(/[^a-z0-9:_-]+/giu, '-')}`,
    },
    executionContractRef,
    policyDecisionRef: `policy:${capabilityId.replace(/[^a-z0-9:_-]+/giu, '-')}`,
    verdictHint: 'allow',
    authRequirement: requirement,
    auth: {
      sessionHandle,
      requestedScopes: [scope({ origin, operations })],
      authGate: { satisfied: true, gateId: 'gate:prod-vault', policyId: 'policy:prod-vault' },
    },
  });
}

function policyFor(request) {
  return createGovernedExecutionPolicyDecision({
    executionId: `execution:${request.capabilityId}`,
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

function readContract(requirement = authRequirement()) {
  return {
    capabilityKind: 'read',
    operationKind: 'api_request',
    contractKind: 'api_request',
    runtimeBinding: {
      httpRequest: {
        url: `${HTTP_ORIGIN}/api/items`,
        method: 'GET',
      },
    },
    authRequirement: requirement,
    redactionRequired: true,
  };
}

function browserContract(requirement = authRequirement({
  origin: BROWSER_ORIGIN,
  operations: ['form_or_action'],
  materialTypes: ['cookie'],
  injectionTarget: 'browser_context',
})) {
  return {
    capabilityKind: 'submit',
    operationKind: 'form_or_action',
    contractKind: 'form_or_action',
    runtimeBindingRef: 'runtime-binding:prod-vault-browser',
    runtimeBinding: {
      kind: 'browser_bridge',
      targetUrl: BROWSER_START_URL,
    },
    authRequirement: requirement,
    browserActionDescriptor: {
      actionRef: 'action:prod-vault-browser-submit',
      routeRef: 'route:prod-vault-browser-contact',
      requiredSlots: ['message'],
      selectors: {
        fields: { message: '[data-sf-field="message"]' },
        submit: '[data-sf-action="submit-contact"]',
      },
      completionSignal: {
        kind: 'selectorVisible',
        selector: '[data-sf-completion="contact-submitted"]',
        timeoutMs: 250,
      },
    },
    payloadTemplate: {
      material: 'template_only',
      redactionRequired: true,
      savedMaterial: 'sanitized_summary_only',
      slotBindings: [{
        name: 'message',
        type: 'string',
        required: true,
        binding: 'payload.message',
        selector: '[data-sf-field="message"]',
      }],
      steps: [{
        kind: 'form_submit',
        selector: '[data-sf-action="submit-contact"]',
        actionRef: 'action:prod-vault-browser-submit',
        routeRef: 'route:prod-vault-browser-contact',
        savedMaterial: 'sanitized_summary_only',
      }],
    },
    redactionRequired: true,
  };
}

function browserRuntimeDescriptor() {
  return {
    mode: 'controlled',
    engine: 'chromium',
    startUrl: BROWSER_START_URL,
    allowedOrigins: [BROWSER_ORIGIN],
    allowExternalNetwork: false,
    allowDownloads: false,
    allowPopups: false,
    persistProfile: false,
    recordDom: false,
    recordScreenshots: false,
    recordVideo: false,
    recordFullTrace: false,
    timeoutMs: 500,
    actionTimeoutMs: 250,
    completionTimeoutMs: 250,
  };
}

test('production adapter interface validates and declares safe capability matrix', () => {
  const descriptor = createProductionSessionVaultAdapterInterface({
    adapterId: 'production-vault-adapter:interface',
  });
  const adapter = createInMemoryProductionVaultAdapter({
    sessions: [sessionRecord()],
  });
  const validation = validateProductionSessionVaultAdapter(adapter);

  assert.equal(validation.valid, true);
  assert.equal(descriptor.capabilityMatrix.materialPersistence, 'forbidden');
  assert.equal(PRODUCTION_SESSION_VAULT_ADAPTER_CAPABILITY_MATRIX.automaticLogin, 'forbidden');
  assertNoCanaryLeak({ descriptor, validation }, 'interface validation');
});

test('fileless in-memory prototype supports inspect, material grant, and release', async () => {
  const adapter = createInMemoryProductionVaultAdapter({
    sessions: [sessionRecord()],
  });

  const inspection = await adapter.inspectSession({ sessionHandle: 'prod-vault-session-handle-safe' });
  const grant = await adapter.getScopedSessionMaterial({
    sessionHandle: 'prod-vault-session-handle-safe',
    providerId: 'api_read_provider',
    capabilityId: 'capability:prod-vault-adapter:read',
    scopes: [scope()],
    materialTypes: ['bearer_token'],
    purpose: 'http_request_auth',
  });
  assert.equal(inspection.active, true);
  assert.equal(grant.materials[0].value, CANARIES[1]);
  const release = await adapter.releaseScopedSessionMaterial({ grantId: grant.grantId });

  assert.equal(release.released, true);
  assert.equal(adapter.listLedgerEvents().some((event) => event.eventType === 'session.grant.issued'), true);
  assert.equal(adapter.listLedgerEvents().some((event) => event.eventType === 'session.grant.released'), true);
  assertNoCanaryLeak({
    inspection,
    release,
    ledger: adapter.listLedgerEvents(),
    inventory: adapter.listSessionInventory(),
    health: await adapter.healthCheck(),
  }, 'prototype lifecycle');
});

test('lease TTL is enforced before material lookup', async () => {
  let now = Date.parse('2030-01-01T00:00:00.000Z');
  const adapter = createInMemoryProductionVaultAdapter({
    now: () => now,
    sessions: [sessionRecord({ leaseTtlMs: 1_000 })],
  });
  assert.equal((await adapter.inspectSession({ sessionHandle: 'prod-vault-session-handle-safe' })).status, 'active');

  now += 1_001;
  const expired = await adapter.inspectSession({ sessionHandle: 'prod-vault-session-handle-safe' });
  const grant = await adapter.getScopedSessionMaterial({
    sessionHandle: 'prod-vault-session-handle-safe',
    providerId: 'api_read_provider',
    capabilityId: 'capability:prod-vault-adapter:read',
    scopes: [scope()],
    materialTypes: ['bearer_token'],
    purpose: 'http_request_auth',
  });

  assert.equal(expired.status, 'expired');
  assert.equal(grant, null);
  assert.equal(adapter.listLedgerEvents().some((event) => event.eventType === 'session.expired.observed'), true);
  assertNoCanaryLeak({ expired, ledger: adapter.listLedgerEvents(), health: await adapter.healthCheck() }, 'ttl');
});

test('lease TTL and revocation clear active grants from health', async () => {
  let now = Date.parse('2030-01-01T00:00:00.000Z');
  const ttlAdapter = createInMemoryProductionVaultAdapter({
    now: () => now,
    sessions: [sessionRecord({ leaseTtlMs: 1_000 })],
  });
  const ttlGrant = await ttlAdapter.getScopedSessionMaterial({
    sessionHandle: 'prod-vault-session-handle-safe',
    providerId: 'api_read_provider',
    capabilityId: 'capability:prod-vault-adapter:read',
    scopes: [scope()],
    materialTypes: ['bearer_token'],
    purpose: 'http_request_auth',
  });
  assert.equal(ttlGrant.materials[0].value, CANARIES[1]);
  assert.equal((await ttlAdapter.healthCheck()).activeGrantCount, 1);
  now += 1_001;
  assert.equal((await ttlAdapter.healthCheck()).activeGrantCount, 0);

  const revokeAdapter = createInMemoryProductionVaultAdapter({
    sessions: [sessionRecord()],
  });
  const revokeGrant = await revokeAdapter.getScopedSessionMaterial({
    sessionHandle: 'prod-vault-session-handle-safe',
    providerId: 'api_read_provider',
    capabilityId: 'capability:prod-vault-adapter:read',
    scopes: [scope()],
    materialTypes: ['bearer_token'],
    purpose: 'http_request_auth',
  });
  assert.equal(revokeGrant.materials[0].value, CANARIES[1]);
  assert.equal((await revokeAdapter.healthCheck()).activeGrantCount, 1);
  await revokeAdapter.revokeSession({ sessionHandle: 'prod-vault-session-handle-safe' });
  assert.equal((await revokeAdapter.healthCheck()).activeGrantCount, 0);
  assertNoCanaryLeak({
    ttlLedger: ttlAdapter.listLedgerEvents(),
    revokeLedger: revokeAdapter.listLedgerEvents(),
  }, 'grant invalidation');
});

test('revocation propagates to inspect and material requests', async () => {
  const adapter = createInMemoryProductionVaultAdapter({
    sessions: [sessionRecord()],
  });
  const revoked = await adapter.revokeSession({ sessionHandle: 'prod-vault-session-handle-safe' });
  const inspection = await adapter.inspectSession({ sessionHandle: 'prod-vault-session-handle-safe' });
  const grant = await adapter.getScopedSessionMaterial({
    sessionHandle: 'prod-vault-session-handle-safe',
    providerId: 'api_read_provider',
    capabilityId: 'capability:prod-vault-adapter:read',
    scopes: [scope()],
    materialTypes: ['bearer_token'],
    purpose: 'http_request_auth',
  });

  assert.equal(revoked.revoked, true);
  assert.equal(inspection.status, 'revoked');
  assert.equal(grant, null);
  assert.equal(adapter.listLedgerEvents().some((event) => event.eventType === 'session.revoked.observed'), true);
  assertNoCanaryLeak({ revoked, inspection, ledger: adapter.listLedgerEvents() }, 'revocation');
});

test('material grant requests fail closed without explicit material types', async () => {
  const adapter = createInMemoryProductionVaultAdapter({
    sessions: [sessionRecord()],
  });
  const grant = await adapter.getScopedSessionMaterial({
    sessionHandle: 'prod-vault-session-handle-safe',
    providerId: 'api_read_provider',
    capabilityId: 'capability:prod-vault-adapter:read',
    scopes: [scope()],
    materialTypes: [],
    purpose: 'http_request_auth',
  });

  assert.equal(grant, null);
  assert.equal(adapter.listLedgerEvents().some((event) => event.eventType === 'session.material.unavailable'), true);
  assertNoCanaryLeak({ ledger: adapter.listLedgerEvents(), health: await adapter.healthCheck() }, 'empty material types');
});

test('audit sink sanitizes event fields before storage', () => {
  const sink = createProductionSessionVaultAdapterAuditSink();
  sink.record({
    eventType: 'session.grant.issued',
    sessionRef: CANARIES[0],
    providerId: 'api_read_provider',
    capabilityId: 'capability:prod-vault-adapter:read',
    purpose: 'http_request_auth',
    scopes: [scope()],
    materialSummary: { types: ['bearer_token'], count: 1 },
    outcome: 'issued',
  });

  assert.equal(sink.listEvents().length, 1);
  assert.notEqual(sink.listEvents()[0].sessionRef, CANARIES[0]);
  assertNoCanaryLeak(sink.listEvents(), 'audit sink');
});

test('health output is sanitized metadata only', async () => {
  const adapter = createInMemoryProductionVaultAdapter({
    sessions: [
      sessionRecord(),
      sessionRecord({
        sessionHandle: 'prod-vault-session-handle-safe-2',
        sessionRef: 'auth-session:prod-vault-safe-ref-2',
        status: 'revoked',
      }),
    ],
  });
  const health = await adapter.healthCheck();

  assert.equal(health.sessionCount, 2);
  assert.equal(health.byStatus.active, 1);
  assert.equal(health.byStatus.revoked, 1);
  assert.equal(health.capabilityMatrix.materialPersistence, 'forbidden');
  assertNoCanaryLeak({ health, inventory: adapter.listSessionInventory() }, 'health');
});

test('fileless prototype does not expose material through serialized state', async () => {
  const adapter = createInMemoryProductionVaultAdapter({
    adapterId: CANARIES[0],
    sessions: [sessionRecord()],
  });
  await adapter.inspectSession({ sessionHandle: 'prod-vault-session-handle-safe' });

  assertNoCanaryLeak({
    enumerableKeys: Object.keys(adapter),
    serializedAdapter: JSON.stringify(adapter),
    inventory: adapter.listSessionInventory(),
    ledger: adapter.listLedgerEvents(),
    health: await adapter.healthCheck(),
  }, 'serialized adapter state');
});

test('runtime public index exposes safe adapter API without raw material factories', async () => {
  const runtimeIndex = await import('../../src/app/runtime/index.mjs');
  const forbidden = Object.keys(runtimeIndex)
    .filter((name) => (
      /mock|fake|test|testing|fixture|raw/iu.test(name)
      || /^(?:create(?:InMemory)?SessionVaultProvider|createInMemoryProductionVaultAdapter|normalizeSessionMaterialGrant|getScopedSessionMaterial|releaseScopedSessionMaterial)$/u.test(name)
    ))
    .sort();

  assert.equal(Object.hasOwn(runtimeIndex, 'createInMemoryProductionVaultAdapter'), false);
  assert.equal(Object.hasOwn(runtimeIndex, 'createInMemorySessionVaultProvider'), false);
  assert.equal(Object.hasOwn(runtimeIndex, 'normalizeSessionMaterialGrant'), false);
  assert.equal(typeof runtimeIndex.runProductionSessionVaultAdapterConformance, 'function');
  assert.deepEqual(forbidden, []);
});

test('adapter conformance passes and stays compatible with Auth Runtime V1', async () => {
  const adapter = createInMemoryProductionVaultAdapter({
    sessions: [sessionRecord()],
  });
  const conformance = await runProductionSessionVaultAdapterConformance({
    adapter,
    sessionHandle: 'prod-vault-session-handle-safe',
    scopes: [scope()],
    materialTypes: ['bearer_token'],
  });

  assert.equal(conformance.status, 'passed');
  assertNoCanaryLeak(conformance, 'conformance report');

  const request = requestFor();
  const auditRecorder = createRuntimeAuditRecorder();
  const fetchCalls = [];
  const report = await executeRuntimeInvocation({
    invocationRequest: request,
    policyDecision: policyFor(request),
    executionContract: readContract(),
    runtimeContext: {
      sessionVault: adapter,
      async fetchImpl(url, options) {
        fetchCalls.push({ url, options });
        assert.equal(options.headers.authorization, `Bearer ${CANARIES[1]}`);
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
  assert.equal(adapter.listLedgerEvents().some((event) => event.eventType === 'session.grant.released'), true);
  assertNoCanaryLeak({
    report,
    auditEvents: auditRecorder.listEvents(),
    ledger: adapter.listLedgerEvents(),
  }, 'auth runtime');
});

test('adapter conformance rejects unsafe health ledger or inventory output', async () => {
  const unsafeAdapter = {
    adapterId: 'unsafe-adapter',
    async inspectSession() {
      return {
        sessionRef: 'auth-session:unsafe-safe-ref',
        status: 'active',
        active: true,
        scopes: [scope()],
        redactionRequired: true,
      };
    },
    async getScopedSessionMaterial() {
      return {
        grantId: 'unsafe-grant',
        materials: [{ type: 'bearer_token', value: CANARIES[1] }],
        summary: { materialTypes: ['bearer_token'], materialCount: 1 },
      };
    },
    async releaseScopedSessionMaterial() {
      return { released: true, redactionRequired: true };
    },
    async healthCheck() {
      return {
        status: 'available',
        token: CANARIES[1],
        redactionRequired: true,
      };
    },
    listLedgerEvents() {
      return [{ eventType: 'session.grant.issued', sessionRef: CANARIES[0] }];
    },
    listSessionInventory() {
      return [{ sessionRef: CANARIES[2], status: 'active' }];
    },
  };

  const conformance = await runProductionSessionVaultAdapterConformance({
    adapter: unsafeAdapter,
    sessionHandle: 'prod-vault-session-handle-safe',
    scopes: [scope()],
    materialTypes: ['bearer_token'],
  });

  assert.equal(conformance.status, 'failed');
  assert.equal(conformance.findings.some((finding) => /unsafe|unavailable/u.test(finding.code)), true);
  assertNoCanaryLeak(conformance, 'unsafe conformance report');
});

test('adapter works with Auth-aware Controlled Browser V1', async () => {
  const adapter = createInMemoryProductionVaultAdapter({
    sessions: [sessionRecord({
      sessionRef: 'auth-session:prod-vault-browser-safe-ref',
      origin: BROWSER_ORIGIN,
      operations: ['form_or_action'],
      leaseTtlMs: 200_000_000_000,
      materials: [{
        type: 'cookie',
        name: 'sfv',
        value: CANARIES[0],
        path: '/',
        httpOnly: true,
        secure: false,
        sameSite: 'Lax',
        expires: 1_893_456_000,
      }],
    })],
  });
  const fake = createFakeControlledBrowserRuntimeDeps({ eventLog: [] });
  const requirement = authRequirement({
    origin: BROWSER_ORIGIN,
    operations: ['form_or_action'],
    materialTypes: ['cookie'],
    injectionTarget: 'browser_context',
  });
  const request = requestFor({
    capabilityId: 'capability:prod-vault-adapter:browser',
    executionContractRef: 'execution-contract:prod-vault-adapter:browser',
    origin: BROWSER_ORIGIN,
    operations: ['form_or_action'],
    requirement,
  });
  const auditRecorder = createRuntimeAuditRecorder();
  const report = await executeRuntimeInvocation({
    invocationRequest: request,
    policyDecision: policyFor(request),
    executionContract: browserContract(requirement),
    runtimeContext: {
      controlledBrowserRuntime: true,
      browserRuntime: browserRuntimeDescriptor(),
      slotValues: { message: 'browser auth fixture value' },
      sessionVault: adapter,
    },
    providerRegistry: createProductionRuntimeProviderRegistry({
      browserRuntimeDeps: {
        openBrowserSession: fake.openBrowserSession,
      },
    }),
    auditRecorder,
  });

  assert.equal(createProductionRuntimeProviderRegistry().resolve({ executionContract: browserContract(requirement) })?.id, BROWSER_ACTION_PROVIDER_ID);
  assert.equal(report.status, 'completed');
  assert.equal(fake.state.authCookieApplyCount, 1);
  assert.equal(adapter.listLedgerEvents().some((event) => event.eventType === 'session.grant.released'), true);
  assertNoCanaryLeak({
    report,
    auditEvents: auditRecorder.listEvents(),
    ledger: adapter.listLedgerEvents(),
  }, 'auth-aware browser');
});

test('release failure is sanitized', async () => {
  const adapter = createInMemoryProductionVaultAdapter({
    sessions: [sessionRecord()],
    releaseFailure: true,
  });
  const grant = await adapter.getScopedSessionMaterial({
    sessionHandle: 'prod-vault-session-handle-safe',
    providerId: 'api_read_provider',
    capabilityId: 'capability:prod-vault-adapter:read',
    scopes: [scope()],
    materialTypes: ['bearer_token'],
    purpose: 'http_request_auth',
  });

  await assert.rejects(
    () => adapter.releaseScopedSessionMaterial({ grantId: grant.grantId }),
    /production vault adapter release failed/u,
  );
  assert.equal(adapter.listLedgerEvents().some((event) => event.eventType === 'session.grant.release_failed'), true);
  assertNoCanaryLeak({
    errorMessage: 'production vault adapter release failed',
    ledger: adapter.listLedgerEvents(),
    health: await adapter.healthCheck(),
  }, 'release failure');
});

test('unknown and double release fail closed without successful release event', async () => {
  const adapter = createInMemoryProductionVaultAdapter({
    sessions: [sessionRecord()],
  });
  await assert.rejects(
    () => adapter.releaseScopedSessionMaterial({ grantId: 'prod-vault-grant:missing' }),
    /production vault adapter release failed/u,
  );

  const grant = await adapter.getScopedSessionMaterial({
    sessionHandle: 'prod-vault-session-handle-safe',
    providerId: 'api_read_provider',
    capabilityId: 'capability:prod-vault-adapter:read',
    scopes: [scope()],
    materialTypes: ['bearer_token'],
    purpose: 'http_request_auth',
  });
  await adapter.releaseScopedSessionMaterial({ grantId: grant.grantId });
  await assert.rejects(
    () => adapter.releaseScopedSessionMaterial({ grantId: grant.grantId }),
    /production vault adapter release failed/u,
  );

  const releaseEvents = adapter.listLedgerEvents().filter((event) => event.eventType === 'session.grant.released');
  assert.equal(releaseEvents.length, 1);
  assert.equal(adapter.listLedgerEvents().some((event) => event.eventType === 'session.grant.release_failed'), true);
  assertNoCanaryLeak({ ledger: adapter.listLedgerEvents(), health: await adapter.healthCheck() }, 'unknown release');
});

test('boundary document records storage, encryption, key, and prohibited login boundaries', async () => {
  const doc = await readFile('docs/security/session-vault-adapter-boundary.md', 'utf8');
  assert.match(doc, /backend-agnostic storage boundary/u);
  assert.match(doc, /encryption at rest/iu);
  assert.match(doc, /key management/iu);
  assert.match(doc, /lease TTL/u);
  assert.match(doc, /revocation/u);
  assert.match(doc, /automatic login is out of scope/u);
  assert.match(doc, /storageState persistence is forbidden/u);
  for (const canary of CANARIES) {
    assert.equal(doc.includes(canary), false, `boundary doc leaked ${canary}`);
  }
});
