// @ts-nocheck
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  extractStaticCapabilityContractsV2,
} from '../../src/app/compiler/index.mjs';
import {
  createRuntimeInvocationRequest,
} from '../../src/app/planner/index.mjs';
import {
  BROWSER_ACTION_PROVIDER_ID,
  RUNTIME_REASONS,
  createProductionRuntimeProviderRegistry,
  createRunStoreQueryIndex,
  createRuntimeAuditRecorder,
  createRuntimeAuditView,
  executeRuntimeInvocation,
  invokeSkillRuntime,
  loadRuntimeRunStore,
  queryRunStoreIndex,
  queryRuntimeAuditViews,
  runRuntimeRegressionHarness,
  writeRuntimeRunStore,
} from '../../src/app/runtime/index.mjs';
import {
  createFakeControlledBrowserRuntimeDeps,
  createMockSessionVault,
  createRuntimeRegressionSnapshotFixture,
} from '../../src/app/runtime/testing.mjs';
import {
  buildCapabilityPackageFromGraph,
  diffCapabilityPackages,
} from '../../src/domain/capability-packages/index.mjs';
import {
  createGovernedExecutionPolicyDecision,
} from '../../src/domain/policies/execution/index.mjs';
import {
  simulatePolicyPack,
} from '../../src/domain/policies/policy-pack/index.mjs';
import {
  createPaymentAuditPlanningSummary,
  simulatePaymentPolicy,
} from '../../src/domain/payment-authorization/index.mjs';

const FIXTURE_URL = new URL('./fixtures/siteforge-runtime-productization-e2e-v1/fixture-site.html', import.meta.url);
const PAYMENT_PLAN_URL = new URL('./fixtures/payment-authorization-architecture-plan-v1/safe-payment-plan.json', import.meta.url);
const E2E_CANARIES =
  /sf_e2e_secret_123|sf_browser_cookie_secret_123|sf_browser_session_handle_secret_should_not_log|sf_browser_auth_grant_secret_456|sf_payment_card_secret_123|sf_payment_token_secret_789|sf_destructive_plan_confirmation_secret_123/u;
const SAFE_DATE = '2026-06-07T00:00:00.000Z';
const BROWSER_START_URL = 'http://e2e.example.test/support';
const BROWSER_ORIGIN = new URL(BROWSER_START_URL).origin;

async function readHtmlFixture() {
  return readFile(FIXTURE_URL, 'utf8');
}

async function readJson(url) {
  return JSON.parse(await readFile(url, 'utf8'));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

async function tempRoot() {
  return mkdtemp(path.join(tmpdir(), 'siteforge-e2e-run-store-'));
}

function assertNoE2ELeak(value) {
  const serialized = JSON.stringify(value);
  assert.doesNotMatch(serialized, E2E_CANARIES);
  assert.doesNotMatch(serialized, /Set-Cookie|Authorization:\s*Bearer|storageState|localStorage|sessionStorage|IndexedDB|raw DOM|raw body/u);
}

function baseGraph({ siteKey = 'e2e.example.test', capabilityKey, operationKind, providerCompatibility, risk = {} }) {
  const capabilityId = `capability:${siteKey}:${capabilityKey}`;
  const contractId = `execution-contract:${siteKey}:${capabilityKey}`;
  const governanceId = `governance-policy:${siteKey}:${capabilityKey}`;
  const destructive = risk.destructive === true;
  const payment = risk.payment === true;
  const highRisk = destructive || payment || risk.highRisk === true;
  return {
    schemaVersion: 1,
    graphVersion: `compiler-generated:${siteKey}:${capabilityKey}:e2e`,
    manifest: {
      schemaVersion: 1,
      graphSchemaVersion: 1,
      graphDataVersion: `compiler-generated:${siteKey}:${capabilityKey}:e2e`,
      sourceInventories: ['tests/node/fixtures/siteforge-runtime-productization-e2e-v1/fixture-site.html'],
      layerCompatibility: {
        kernelCompatibilityVersion: 'compiler-kernel-v1',
      },
      provenance: {
        compilerVersion: 'siteforge-e2e-test',
      },
    },
    nodes: [
      {
        schemaVersion: 1,
        id: `site:${siteKey}`,
        type: 'SiteNode',
        siteKey,
        hostFamily: [siteKey],
        redactionRequired: true,
      },
      {
        schemaVersion: 1,
        id: capabilityId,
        type: 'CapabilityNode',
        siteKey,
        capabilityKey,
        capabilityFamily: capabilityKey,
        mode: operationKind === 'api_read' ? 'read' : 'write',
        requiresApproval: highRisk,
        supportedTaskTypes: [`${capabilityKey}.e2e`],
        routeRefs: [`route:${siteKey}:${capabilityKey}`],
        authRequirementRefs: [],
        sessionRequirementRefs: [],
        riskPolicyRef: governanceId,
        sourceRefs: ['fixture-site.html'],
        testEvidenceRefs: ['test:siteforge-runtime-productization-e2e-v1'],
        runtimeCallable: !highRisk,
        autoExecutable: operationKind === 'api_read' && !highRisk,
        redactionRequired: true,
      },
      {
        schemaVersion: 1,
        id: contractId,
        type: 'ExecutionContractNode',
        siteKey,
        capabilityRef: capabilityId,
        operationKind,
        runtimeBindingRef: `runtime-binding:${siteKey}:${capabilityKey}`,
        governancePolicyRef: governanceId,
        executionGates: highRisk ? ['confirm_required', 'audit_required', 'permission_required'] : [],
        runtimeCallable: !highRisk,
        autoExecutable: operationKind === 'api_read' && !highRisk,
        destructiveAction: destructive,
        paymentOrFundsAction: payment,
        highRiskAction: highRisk,
        providerCompatibility,
        selectorConfidence: operationKind === 'form_or_action' ? 0.91 : null,
        executionContractConcrete: true,
        completionSignals: operationKind === 'form_or_action' ? ['selector_visible'] : [],
        redactionRequired: true,
      },
      {
        schemaVersion: 1,
        id: governanceId,
        type: 'GovernancePolicyNode',
        executionDisposition: highRisk ? 'controlled' : 'allow',
        executionVerdict: highRisk ? 'controlled' : 'allow',
        executionGates: highRisk ? ['confirm_required', 'audit_required', 'permission_required'] : [],
        auditRequired: true,
        confirmationRequired: highRisk,
        destructiveConfirmationRequired: destructive,
        paymentConfirmationRequired: payment,
        strongConfirmationRequired: highRisk,
        sitePolicyExplicitAllowRequired: highRisk,
        runtimeConstraintRequired: operationKind === 'form_or_action',
        naturalLanguageRequestGrantsExecution: false,
        runtimeDispatchAllowedByDefault: operationKind === 'api_read' && !highRisk,
        redactionRequired: true,
      },
    ],
    edges: [
      {
        schemaVersion: 1,
        id: `edge:${capabilityId}:site`,
        type: 'site_declares_capability',
        from: `site:${siteKey}`,
        to: capabilityId,
      },
      {
        schemaVersion: 1,
        id: `edge:${capabilityId}:contract`,
        type: 'capability_has_execution_contract',
        from: capabilityId,
        to: contractId,
      },
    ],
    redactionRequired: true,
  };
}

function publicReadGraph() {
  return baseGraph({
    capabilityKey: 'public-orders-read',
    operationKind: 'api_read',
    providerCompatibility: ['api_read_provider'],
  });
}

function browserWriteGraph() {
  return baseGraph({
    capabilityKey: 'support-form-submit',
    operationKind: 'form_or_action',
    providerCompatibility: ['browser_action_provider'],
  });
}

function destructiveGraph() {
  return baseGraph({
    capabilityKey: 'account-delete',
    operationKind: 'form_or_action',
    providerCompatibility: ['browser_action_provider'],
    risk: { destructive: true },
  });
}

function paymentGraph() {
  return baseGraph({
    capabilityKey: 'checkout-payment',
    operationKind: 'form_or_action',
    providerCompatibility: ['browser_action_provider'],
    risk: { payment: true },
  });
}

async function packageFromGraph(graph, version = '1.0.0') {
  return buildCapabilityPackageFromGraph(graph, {
    version,
    compiledAt: SAFE_DATE,
  });
}

function skillRequest(manifest, { mode = 'dryRun', taskText = 'structured e2e invocation', suffix = mode } = {}) {
  const capability = manifest.capabilities[0];
  return {
    schemaVersion: 'skill.runtime_invocation.v1',
    requestId: `skill-invocation:e2e:${capability.capabilityId}:${suffix}`,
    skillId: 'skill:e2e-safe-skill',
    packageId: manifest.packageId,
    packageVersion: manifest.version,
    capabilityRef: capability.capabilityRef,
    executionContractRef: capability.executionContractRef,
    policyDecisionRef: `policy-decision:e2e:${capability.capabilityId}`,
    mode,
    idempotencyKey: `idem:e2e:${capability.capabilityId}:${suffix}`,
    taskText,
    slots: {},
  };
}

function runtimeContractRefForPackageContract(contractRef) {
  const safe = String(contractRef)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 96);
  return `execution-contract:${safe}`;
}

function safeEvidenceRef(value, prefix) {
  const safe = String(value ?? prefix)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 120);
  return `${prefix}:${safe || 'e2e'}`;
}

function allowPolicyForPackage(manifest) {
  const capability = manifest.capabilities[0];
  return createGovernedExecutionPolicyDecision({
    executionId: `execution:e2e:${capability.capabilityId}`,
    capabilityId: capability.sourceCapabilityId,
    executionContractRef: runtimeContractRefForPackageContract(capability.executionContractRef),
    verdict: 'allow',
    gates: [],
    runtimeDispatchAllowed: true,
    siteAdapterInvocationAllowed: true,
    auditRequired: true,
  });
}

function controlledHighRiskPolicy(manifest, { destructive = false, payment = false } = {}) {
  const capability = manifest.capabilities[0];
  return createGovernedExecutionPolicyDecision({
    executionId: `execution:e2e:${capability.capabilityId}`,
    capabilityId: capability.sourceCapabilityId,
    executionContractRef: runtimeContractRefForPackageContract(capability.executionContractRef),
    verdict: 'controlled',
    gates: ['confirm_required', 'audit_required', 'permission_required'],
    gateStatus: {
      allSatisfied: true,
      confirm_required: { satisfied: true },
      audit_required: { satisfied: true },
      permission_required: { satisfied: true },
    },
    runtimeDispatchAllowed: true,
    siteAdapterInvocationAllowed: true,
    destructiveAction: destructive,
    paymentOrFundsAction: payment,
    strongConfirmationRequired: true,
    permissionRequired: true,
    auditRequired: true,
    naturalLanguageRequestGrantsExecution: false,
  });
}

function reportFromSkillResult(result, { capabilityKind = 'read' } = {}) {
  const summary = result.runtimeReportSummary ?? {};
  return {
    schemaVersion: '1.0.0',
    executionVersion: '0.1.0',
    reportType: 'RuntimeExecutionReport',
    requestId: result.runtimeInvocationRequestRef ?? result.requestId,
    executionId: `execution:${result.requestId}`,
    capabilityId: safeEvidenceRef(result.capabilityRef, 'capability'),
    executionContractRef: safeEvidenceRef(result.executionContractRef, 'execution-contract'),
    policyDecisionRef: result.policyDecisionRef,
    verdict: result.status === 'completed' ? 'allow' : 'blocked',
    status: summary.status ?? result.status,
    capabilityKind,
    providerId: summary.providerId ?? null,
    providerKind: summary.providerKind ?? null,
    runtimeDispatchAllowed: result.status !== 'blocked',
    providerInvoked: summary.providerInvoked === true,
    executionAttempted: summary.executionAttempted === true,
    runtimeExecuted: summary.runtimeExecuted === true,
    sideEffectAttempted: summary.sideEffectAttempted === true,
    sideEffectSucceeded: summary.sideEffectSucceeded === true,
    sideEffectFailed: summary.sideEffectFailed === true,
    reasonCode: summary.reasonCode ?? result.reasonCode ?? null,
    blockedReason: result.status === 'blocked' ? result.reasonCode : null,
    artifactRefs: summary.artifactRefs ?? [],
    redactionRequired: true,
  };
}

async function writeAndLoadRun({ runId, report, auditView, policyId = 'policy-pack:e2e' }) {
  const root = await tempRoot();
  const storedReport = {
    schemaVersion: report.schemaVersion,
    executionVersion: report.executionVersion,
    reportType: report.reportType,
    requestId: report.requestId,
    executionId: report.executionId,
    capabilityId: report.capabilityId,
    executionContractRef: report.executionContractRef,
    policyDecisionRef: report.policyDecisionRef,
    status: report.status,
    providerId: report.providerId,
    providerKind: report.providerKind,
    reasonCode: report.reasonCode,
    blockedReason: report.blockedReason,
    providerInvoked: report.providerInvoked,
    executionAttempted: report.executionAttempted,
    sideEffectAttempted: report.sideEffectAttempted,
    sideEffectSucceeded: report.sideEffectSucceeded,
    sideEffectFailed: report.sideEffectFailed,
    redactionRequired: true,
  };
  const storedAuditView = {
    runId,
    status: report.status,
    providerId: report.providerId,
    outcome: {
      status: report.status,
      reasonCode: report.reasonCode,
      blockedReason: report.blockedReason,
    },
    redactionRequired: true,
  };
  const manifest = await writeRuntimeRunStore(root, {
    runId,
    createdAt: SAFE_DATE,
    invocationRef: report.requestId,
    capabilityRef: report.capabilityId,
    executionContractRef: report.executionContractRef,
    providerId: report.providerId,
    packageId: 'sitepkg:e2e.example.test',
    status: report.status,
    sideEffectAttempted: report.sideEffectAttempted,
    runtimeExecutionReport: storedReport,
    auditEvents: [{
      eventType: 'runtime_execution_report',
      providerId: report.providerId,
      status: report.status,
      reasonCode: report.reasonCode,
      redactionRequired: true,
    }],
    auditView: storedAuditView,
    artifactMetadata: [],
    policyDecisionSummary: {
      decisionId: report.policyDecisionRef,
      policyId,
      reason: report.reasonCode ?? report.blockedReason ?? '',
      allowed: report.status === 'completed',
    },
    redaction: {
      status: 'ok',
      sensitiveInputDetected: false,
    },
  });
  const loaded = await loadRuntimeRunStore(root, `${runId.replace(/[^a-z0-9._-]+/giu, '-')}/run_manifest.json`);
  const index = createRunStoreQueryIndex([manifest]);
  return { manifest, loaded, index };
}

function publicReadPolicyPack() {
  return {
    schemaVersion: 'policy.pack.v1',
    policyPackId: 'policy-pack:e2e-public-read',
    version: '1.0.0',
    rules: [{
      id: 'allow-public-read',
      match: {
        providerId: 'api_read_provider',
        capabilityKind: 'read',
        operations: ['read'],
        authRequired: false,
      },
      effect: 'allow',
      reason: 'policy.public_read_allowed',
      constraints: {
        maxGrantTtlMs: 0,
        requireRelease: false,
      },
    }],
    provenance: {
      authoringMode: 'structured_policy_pack',
    },
    redactionRequired: true,
  };
}

test('E2E public read compiles packages invokes runtime and writes sanitized run store', async () => {
  const html = await readHtmlFixture();
  const extraction = extractStaticCapabilityContractsV2({ html, url: 'https://e2e.example.test/orders' });
  const graph = publicReadGraph();
  const manifest = await packageFromGraph(graph);
  const policyPack = publicReadPolicyPack();
  const policySimulation = simulatePolicyPack(policyPack, {
    packageId: manifest.packageId,
    capabilityRef: manifest.capabilities[0].capabilityRef,
    providerId: 'api_read_provider',
    capabilityKind: 'read',
    operation: 'read',
    authRequirement: { required: false, scopes: [] },
    requestedScopes: [],
    destructiveRequirement: { required: false },
    paymentRequirement: { required: false },
    naturalLanguageRequestGrantsExecution: false,
  });
  const dryRun = await invokeSkillRuntime({
    request: skillRequest(manifest, { mode: 'dryRun' }),
    packageManifest: manifest,
    policyDecision: allowPolicyForPackage(manifest),
    providerRegistry: createProductionRuntimeProviderRegistry(),
  });
  const executed = await invokeSkillRuntime({
    request: skillRequest(manifest, { mode: 'execute' }),
    packageManifest: manifest,
    policyDecision: allowPolicyForPackage(manifest),
    providerRegistry: createProductionRuntimeProviderRegistry(),
  });
  const report = reportFromSkillResult(executed, { capabilityKind: 'read' });
  const auditView = createRuntimeAuditView({ report });
  const auditQuery = queryRuntimeAuditViews([auditView], { status: 'completed', providerId: 'api_read_provider' });
  const { loaded, index } = await writeAndLoadRun({ runId: 'run:e2e-public-read', report, auditView });
  const runQuery = queryRunStoreIndex(index, { providerId: 'api_read_provider' });
  const regressionSnapshot = createRuntimeRegressionSnapshotFixture({
    snapshotId: 'runtime-ci-regression:e2e-public-read',
    runtime: {
      status: report.status,
      reasonCode: '',
      providerId: 'api_read_provider',
      capabilityKind: 'read',
      providerInvoked: true,
      executionAttempted: true,
      sideEffectAttempted: true,
      paymentBlocked: false,
      destructiveBlocked: false,
      executionContractConcrete: true,
    },
    auth: { required: false, used: false, scopes: [], materialTypes: [] },
    policy: { policyId: policyPack.policyPackId, verdict: 'allow', reason: policySimulation.decision.reason, allowed: true },
    capabilityGraph: graph,
    capabilityPackage: manifest,
    auditView: {
      requestId: auditView.invocation.requestId,
      status: auditView.outcome.status,
      providerId: auditView.invocation.providerId,
      capabilityKind: auditView.invocation.capabilityKind,
      providerInvoked: auditView.outcome.providerInvoked,
      executionAttempted: auditView.outcome.executionAttempted,
      sideEffectAttempted: auditView.outcome.sideEffectAttempted,
    },
  });

  assert.ok(extraction.apiEndpointHints.some((hint) => hint.endpoint === '/api/orders/search'));
  assert.equal(policySimulation.decision.allowed, true);
  assert.equal(dryRun.status, 'preview');
  assert.equal(dryRun.providerInvoked, false);
  assert.equal(executed.status, 'completed');
  assert.equal(executed.runtimeReportSummary.providerId, 'api_read_provider');
  assert.equal(auditQuery.count, 1);
  assert.equal(loaded.auditView.outcome.status, 'completed');
  assert.equal(runQuery.count, 1);
  assert.equal(regressionSnapshot.runtime.providerInvoked, true);
  assertNoE2ELeak({ extraction, manifest, dryRun, executed, auditView, loaded, regressionSnapshot });
});

function browserScope() {
  return { origin: BROWSER_ORIGIN, operations: ['form_or_action'] };
}

function browserAuthRequirement() {
  return {
    required: true,
    mode: 'session_handle',
    scopes: [browserScope()],
    material: {
      allowedTypes: ['cookie'],
      injectionTarget: 'browser_context',
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

function browserContract() {
  return {
    capabilityKind: 'submit',
    operationKind: 'form_or_action',
    contractKind: 'form_or_action',
    runtimeBindingRef: 'runtime-binding:e2e:support-form',
    runtimeBinding: {
      kind: 'browser_bridge',
      targetUrl: BROWSER_START_URL,
    },
    authRequirement: browserAuthRequirement(),
    browserActionDescriptor: {
      actionRef: 'action:e2e-submit-support',
      routeRef: 'route:e2e-support',
      requiredSlots: ['message'],
      selectors: {
        fields: {
          message: '[data-sf-field="message"]',
        },
        submit: '[data-sf-action="submit-support"]',
      },
      completionSignal: {
        kind: 'selectorVisible',
        selector: '[data-sf-completion="support-sent"]',
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
        selector: '[data-sf-action="submit-support"]',
        actionRef: 'action:e2e-submit-support',
        routeRef: 'route:e2e-support',
        savedMaterial: 'sanitized_summary_only',
      }],
    },
    redactionRequired: true,
  };
}

function browserRequest() {
  return createRuntimeInvocationRequest({
    capabilityPlan: {
      siteId: 'e2e.example.test',
      capabilityId: 'capability:e2e:support-form',
      executionContractRef: 'execution-contract:e2e:support-form',
      planId: 'plan:e2e:support-form',
    },
    executionContractRef: 'execution-contract:e2e:support-form',
    policyDecisionRef: 'policy:e2e:support-form',
    verdictHint: 'allow',
    auth: {
      sessionHandle: 'sf_browser_session_handle_secret_should_not_log',
      requestedScopes: [browserScope()],
      authGate: { satisfied: true, gateId: 'gate:e2e-browser-auth', policyId: 'policy:e2e-browser-auth' },
    },
  });
}

function browserPolicy(request) {
  return createGovernedExecutionPolicyDecision({
    executionId: `execution:${request.capabilityId}`,
    capabilityId: request.capabilityId,
    executionContractRef: request.executionContractRef,
    verdict: 'allow',
    gates: [],
    runtimeDispatchAllowed: true,
    siteAdapterInvocationAllowed: true,
    auditRequired: true,
  });
}

function wrapVault(base, eventLog) {
  return {
    ...base,
    getCounters: base.getCounters,
    async inspectSession(request) {
      eventLog.push('vault.inspect');
      return await base.inspectSession(request);
    },
    async getScopedSessionMaterial(request) {
      eventLog.push('vault.material');
      return await base.getScopedSessionMaterial(request);
    },
    async releaseScopedSessionMaterial(request) {
      eventLog.push('vault.release');
      return await base.releaseScopedSessionMaterial(request);
    },
  };
}

test('E2E auth controlled browser write keeps guards before material and stores sanitized evidence', async () => {
  const html = await readHtmlFixture();
  const extraction = extractStaticCapabilityContractsV2({ html, url: BROWSER_START_URL });
  const packageManifest = await packageFromGraph(browserWriteGraph());
  const request = browserRequest();
  const eventLog = [];
  const fake = createFakeControlledBrowserRuntimeDeps({ eventLog });
  const vault = wrapVault(createMockSessionVault({
    sessionHandle: 'sf_browser_session_handle_secret_should_not_log',
    sessionRef: 'auth-session:e2e-browser-safe',
    scopes: [browserScope()],
    material: [{
      type: 'cookie',
      name: 'sf_browser_cookie_name_should_not_log',
      value: 'sf_browser_cookie_secret_123',
      path: '/',
      httpOnly: true,
      secure: false,
      sameSite: 'Lax',
      expires: 1893456000,
    }],
    grantId: 'sf_browser_auth_grant_secret_456',
    grantSummary: {
      materialTypes: ['cookie'],
      materialCount: 1,
      expiresAt: '2030-01-01T00:00:00.000Z',
    },
  }), eventLog);
  const auditRecorder = createRuntimeAuditRecorder();
  const report = await executeRuntimeInvocation({
    invocationRequest: request,
    policyDecision: browserPolicy(request),
    executionContract: browserContract(),
    runtimeContext: {
      controlledBrowserRuntime: true,
      browserRuntime: browserRuntimeDescriptor(),
      slotValues: { message: 'fixture controlled browser message' },
      taskText: 'submit support form but do not derive target origin from text',
      sessionVault: vault,
    },
    providerRegistry: createProductionRuntimeProviderRegistry({
      browserRuntimeDeps: {
        openBrowserSession: fake.openBrowserSession,
      },
    }),
    auditRecorder,
  });
  const auditView = createRuntimeAuditView({ report, auditEvents: auditRecorder.listEvents() });
  const authApplied = auditView.timeline.some((entry) => entry.eventType === 'runtime.browser.auth.applied');
  const auditQuery = queryRuntimeAuditViews([auditView], { providerId: BROWSER_ACTION_PROVIDER_ID, authUsed: true });
  const { loaded } = await writeAndLoadRun({ runId: 'run:e2e-browser-write', report, auditView });

  assert.equal(packageManifest.capabilities[0].kind, 'form_or_action');
  assert.equal(extraction.formContracts.some((contract) => contract.slotSchema.some((slot) => slot.name === 'message')), true);
  assert.equal(report.status, 'completed');
  assert.equal(report.providerId, BROWSER_ACTION_PROVIDER_ID);
  assert.equal(report.authSummary.used, true);
  assert.deepEqual(report.authSummary.materialSummary, { types: ['cookie'], count: 1 });
  assert.equal(fake.state.authCookieApplyCount, 1);
  assert.equal(vault.getCounters().getScopedSessionMaterialCalls, 1);
  assert.equal(eventLog.indexOf('vault.material') > eventLog.indexOf('guard:Browser.setDownloadBehavior'), true);
  assert.equal(authApplied, true);
  assert.equal(auditQuery.count, 1);
  assert.equal(loaded.auditView.outcome.status, 'completed');
  assertNoE2ELeak({ extraction, packageManifest, report, auditView, loaded });
});

test('E2E destructive capability remains blocked and natural language is not authorization', async () => {
  const manifest = await packageFromGraph(destructiveGraph());
  const result = await invokeSkillRuntime({
    request: skillRequest(manifest, {
      mode: 'execute',
      taskText: 'I confirm deletion in natural language only',
      suffix: 'destructive-execute',
    }),
    packageManifest: manifest,
    policyDecision: controlledHighRiskPolicy(manifest, { destructive: true }),
    providerRegistry: createProductionRuntimeProviderRegistry(),
  });
  const report = reportFromSkillResult(result, { capabilityKind: 'destructive' });
  const auditView = createRuntimeAuditView({ report });
  const auditQuery = queryRuntimeAuditViews([auditView], { reason: RUNTIME_REASONS.destructiveExecutionBlocked });

  assert.equal(manifest.capabilities[0].riskClassification.destructive, true);
  assert.equal(result.status, 'blocked');
  assert.equal(result.reasonCode, RUNTIME_REASONS.destructiveExecutionBlocked);
  assert.equal(result.providerInvoked, false);
  assert.equal(result.sideEffectAttempted, false);
  assert.equal(result.naturalLanguageRequestGrantsExecution, false);
  assert.equal(auditQuery.count, 1);
  assertNoE2ELeak({ manifest, result, auditView, auditQuery });
});

test('E2E payment capability remains blocked and planning-only', async () => {
  const manifest = await packageFromGraph(paymentGraph());
  const paymentPlan = await readJson(PAYMENT_PLAN_URL);
  const paymentSimulation = simulatePaymentPolicy(paymentPlan, {
    taskText: 'please pay now',
    outOfBandApprovalObserved: true,
  });
  const paymentSummary = createPaymentAuditPlanningSummary(paymentPlan, paymentSimulation);
  const result = await invokeSkillRuntime({
    request: skillRequest(manifest, {
      mode: 'execute',
      taskText: 'I authorize payment in natural language only',
      suffix: 'payment-execute',
    }),
    packageManifest: manifest,
    policyDecision: controlledHighRiskPolicy(manifest, { payment: true }),
    providerRegistry: createProductionRuntimeProviderRegistry(),
  });
  const report = {
    ...reportFromSkillResult(result, { capabilityKind: 'payment' }),
    resultSummary: {
      outcome: paymentSummary.summaryType,
      runtimeMode: paymentSummary.planningStatus,
      artifactRefs: [],
      redactionRequired: true,
    },
  };
  const auditView = createRuntimeAuditView({ report });
  const auditQuery = queryRuntimeAuditViews([auditView], { reason: RUNTIME_REASONS.paymentExecutionBlocked });

  assert.equal(manifest.capabilities[0].riskClassification.payment, true);
  assert.equal(paymentSimulation.decision.allowed, false);
  assert.equal(result.status, 'blocked');
  assert.equal(result.reasonCode, RUNTIME_REASONS.paymentExecutionBlocked);
  assert.equal(result.providerInvoked, false);
  assert.equal(result.sideEffectAttempted, false);
  assert.equal(result.naturalLanguageRequestGrantsExecution, false);
  assert.equal(auditView.providerResult.outcome, 'payment_audit_planning_summary');
  assert.equal(auditQuery.count, 1);
  assertNoE2ELeak({ manifest, paymentSimulation, paymentSummary, result, auditView, auditQuery });
});

test('E2E package risk drift is high or critical and regression report is sanitized', async () => {
  const previousPackage = await packageFromGraph(publicReadGraph(), '1.0.0');
  const nextPackage = clone(previousPackage);
  nextPackage.capabilities[0].risk = 'payment';
  nextPackage.capabilities[0].riskClassification = {
    ...nextPackage.capabilities[0].riskClassification,
    level: 'payment',
    payment: true,
    sideEffecting: true,
  };
  nextPackage.capabilities[0].runtimeCallable = false;
  nextPackage.capabilities[0].executableByDefault = false;
  nextPackage.capabilities[0].authRequirement = {
    ...nextPackage.capabilities[0].authRequirement,
    required: true,
    scopes: ['orders.read', 'billing.write'],
    material: 'descriptor_only',
    grantsAuthorization: false,
  };
  const packageDiff = diffCapabilityPackages(previousPackage, nextPackage);
  const regression = runRuntimeRegressionHarness({
    reportId: 'runtime-ci-regression:e2e-risk-drift',
    cases: [{
      caseId: 'e2e-package-risk-drift',
      previous: createRuntimeRegressionSnapshotFixture({
        snapshotId: 'runtime-ci-regression:e2e-before',
        runtime: {
          status: 'completed',
          reasonCode: '',
          providerId: 'api_read_provider',
          capabilityKind: 'read',
          providerInvoked: true,
          executionAttempted: true,
          sideEffectAttempted: true,
          paymentBlocked: false,
          destructiveBlocked: false,
          executionContractConcrete: true,
        },
        auth: { required: false, used: false, scopes: [], materialTypes: [] },
        policy: { policyId: 'policy-pack:e2e', verdict: 'allow', reason: 'policy.public_read_allowed', allowed: true },
        capabilityPackage: previousPackage,
      }),
      next: createRuntimeRegressionSnapshotFixture({
        snapshotId: 'runtime-ci-regression:e2e-after',
        runtime: {
          status: 'blocked',
          reasonCode: RUNTIME_REASONS.paymentExecutionBlocked,
          providerId: '',
          capabilityKind: 'payment',
          providerInvoked: false,
          executionAttempted: false,
          sideEffectAttempted: false,
          paymentBlocked: true,
          destructiveBlocked: false,
          executionContractConcrete: true,
        },
        auth: { required: true, used: false, scopes: ['orders.read', 'billing.write'], materialTypes: [] },
        policy: { policyId: 'policy-pack:e2e', verdict: 'blocked', reason: RUNTIME_REASONS.paymentExecutionBlocked, allowed: false },
        capabilityPackage: nextPackage,
      }),
    }],
  });

  assert.ok(packageDiff.changes.some((change) => ['high', 'critical'].includes(change.severity)));
  assert.equal(regression.maxSeverity === 'high' || regression.maxSeverity === 'critical', true);
  assert.equal(regression.providerInvoked, false);
  assert.equal(regression.networkInvoked, false);
  assertNoE2ELeak({ packageDiff, regression });
});
