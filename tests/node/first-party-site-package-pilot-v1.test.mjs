// @ts-nocheck
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  createCapabilityPackageDigest,
  createCapabilityPackageRegistry,
  resolvePackageCapabilityRef,
  resolvePackageExecutionContractRef,
  validateCapabilityPackageManifest,
} from '../../src/domain/capability-packages/index.mjs';
import {
  createGovernedExecutionPolicyDecision,
} from '../../src/domain/policies/execution/index.mjs';
import {
  createRuntimeAuditRecorder,
  createRuntimeAuditView,
  createRuntimeProviderRegistryWith,
  invokeSkillRuntime,
  runRuntimeRegressionHarness,
} from '../../src/app/runtime/index.mjs';
import {
  createMockSessionVault,
  createRuntimeRegressionSnapshotFixture,
} from '../../src/app/runtime/testing.mjs';

const PILOT_ROOT = new URL('../../packages/siteforge-sites/', import.meta.url);
const PILOT_PACKAGE_DIRS = [
  'public-read-fixture',
  'public-download-fixture',
  'contact-form-fixture',
  'auth-read-fixture',
  'auth-browser-write-fixture',
  'destructive-blocked-fixture',
  'payment-blocked-fixture',
];
const PHASE26_CANARIES =
  /sf_pilot_cookie_secret_123|sf_pilot_private_form_secret_456|sf_pilot_payment_secret_789|sf_pilot_destructive_secret_000/u;
const EXECUTION_GATES = new Set([
  'confirm_required',
  'audit_required',
  'session_required',
  'permission_required',
  'output_path_required',
  'dry_run_required',
]);
const SAFE_SESSION_REF = 'session:phase26-safe-ref';

async function readJson(url) {
  return JSON.parse(await readFile(url, 'utf8'));
}

async function readPilotPackages() {
  const entries = await Promise.all(PILOT_PACKAGE_DIRS.map(async (dir) => {
    const manifest = await readJson(new URL(`${dir}/site.capability_package.json`, PILOT_ROOT));
    return [dir, manifest];
  }));
  return Object.fromEntries(entries);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function safeIdPart(value, fallback = 'ref') {
  const text = String(value ?? fallback)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 96);
  return text || fallback;
}

function runtimeContractRefFor(capability) {
  return `execution-contract:${safeIdPart(capability.executionContractRef, 'contract')}`;
}

function primaryCapability(pkg) {
  return pkg.capabilities[0];
}

function primaryContract(pkg) {
  return pkg.executionContracts[0];
}

function operationFor(pkg) {
  const kind = primaryContract(pkg).kind ?? primaryCapability(pkg).kind;
  if (kind === 'download') return 'download';
  if (kind === 'form_or_action') return 'form_or_action';
  return 'read';
}

function requiredSlotsFor(pkg) {
  return primaryContract(pkg).payloadTemplate?.requiredSlotNames ?? [];
}

function requestFor(pkg, overrides = {}) {
  const capability = primaryCapability(pkg);
  return {
    schemaVersion: 'skill.runtime_invocation.v1',
    requestId: `skill-invocation:phase26:${safeIdPart(capability.capabilityId)}`,
    skillId: 'skill:phase26-pilot',
    packageId: pkg.packageId,
    packageVersion: pkg.version,
    capabilityRef: capability.capabilityRef,
    executionContractRef: capability.executionContractRef,
    policyDecisionRef: `policy-decision:phase26:${safeIdPart(capability.capabilityId)}`,
    mode: 'dryRun',
    idempotencyKey: `idem:phase26:${safeIdPart(capability.capabilityId)}:${safeIdPart(overrides.mode ?? 'dryRun')}`,
    slots: Object.fromEntries(requiredSlotsFor(pkg).map((slotName) => [
      slotName,
      { slotRef: `slot:${safeIdPart(slotName)}`, required: true },
    ])),
    auth: capability.authRequirement?.required === true ? { sessionRef: SAFE_SESSION_REF } : null,
    destructiveAuthorization: null,
    ...overrides,
  };
}

function supportedGates(pkg) {
  return (primaryCapability(pkg).policyRequirements?.executionGates ?? [])
    .filter((gate) => EXECUTION_GATES.has(gate));
}

function satisfiedGateStatus(gates) {
  const status = {};
  for (const gate of gates) {
    status[gate] = { satisfied: true };
  }
  return {
    allSatisfied: true,
    ...status,
  };
}

function policyFor(pkg, request, overrides = {}) {
  const capability = primaryCapability(pkg);
  const contract = primaryContract(pkg);
  const gates = supportedGates(pkg);
  const provider = capability.providerCompatibility[0];
  const sideEffecting = capability.riskClassification?.sideEffecting === true;
  const destructiveAction = capability.riskClassification?.destructive === true;
  const paymentOrFundsAction = capability.riskClassification?.payment === true;
  const effectiveGates = [...new Set([
    ...gates,
    ...(destructiveAction || paymentOrFundsAction || capability.policyRequirements?.confirmationRequired ? ['confirm_required'] : []),
    ...(capability.authRequirement?.required === true ? ['session_required'] : []),
    ...(destructiveAction || paymentOrFundsAction ? ['permission_required'] : []),
  ])];
  return createGovernedExecutionPolicyDecision({
    executionId: `execution:phase26:${safeIdPart(capability.capabilityId)}`,
    capabilityId: capability.sourceCapabilityId,
    executionContractRef: runtimeContractRefFor(capability),
    verdict: sideEffecting || gates.length > 0 ? 'controlled' : 'allow',
    gates: effectiveGates,
    gateStatus: satisfiedGateStatus(effectiveGates),
    runtimeDispatchAllowed: true,
    siteAdapterInvocationAllowed: provider === 'browser_action_provider',
    downloaderInvocationAllowed: provider === 'download_provider',
    sessionMaterializationAllowed: capability.authRequirement?.required === true,
    sessionRequired: capability.authRequirement?.required === true,
    confirmationRequired: capability.policyRequirements?.confirmationRequired === true,
    strongConfirmationRequired: capability.policyRequirements?.strongConfirmationRequired === true,
    highRiskAction: destructiveAction || paymentOrFundsAction,
    destructiveAction,
    paymentOrFundsAction,
    auditRequired: capability.policyRequirements?.auditRequired === true,
    reasonCode: `phase26.policy.${safeIdPart(contract.kind)}`,
    ...overrides,
  });
}

function authScopeFor(pkg) {
  return {
    origin: pkg.siteOrigin,
    operations: [operationFor(pkg)],
  };
}

function runtimeContextFor(pkg, eventLog = []) {
  const capability = primaryCapability(pkg);
  if (capability.authRequirement?.required !== true) {
    return {
      siteOrigin: pkg.siteOrigin,
      eventLog,
    };
  }
  const browserAuth = capability.providerCompatibility[0] === 'browser_action_provider';
  const vault = createMockSessionVault({
    sessionHandle: SAFE_SESSION_REF,
    sessionRef: `auth-session:phase26:${safeIdPart(capability.capabilityId)}`,
    scopes: [authScopeFor(pkg)],
    material: browserAuth
      ? [{
        type: 'cookie',
        name: 'phase26_auth',
        value: 'synthetic_phase26_cookie_value',
        path: '/',
        httpOnly: true,
        secure: true,
        sameSite: 'Lax',
        expires: 1893456000,
      }]
      : [{
        type: 'bearer_token',
        value: 'synthetic_phase26_bearer_value',
      }],
    grantId: `grant:phase26:${safeIdPart(capability.capabilityId)}`,
    grantSummary: {
      materialTypes: browserAuth ? ['cookie'] : ['bearer_token'],
      materialCount: 1,
    },
  });
  return {
    siteOrigin: pkg.siteOrigin,
    eventLog,
    sessionVault: vault,
    sessionPolicyEvaluator(input) {
      return {
        allowed: true,
        reason: 'runtime.auth_policy_allowed',
        decisionId: `policy-decision:phase26:${safeIdPart(capability.capabilityId)}:auth`,
        policyId: 'policy:phase26-safe-session',
        scopesGranted: input.requestedScopes,
        materialTypesAllowed: browserAuth ? ['cookie'] : ['bearer_token'],
        constraints: {
          requireRelease: true,
          allowProfilePersistence: false,
          allowStorageStatePersistence: false,
          allowCredentialForwarding: false,
        },
      };
    },
  };
}

function createPhase26ProviderRegistry(counters) {
  return createRuntimeProviderRegistryWith([
    {
      id: 'api_read_provider',
      providerKind: 'phase26_api_read_provider',
      capabilityKinds: ['read', 'api_read', 'query'],
      async run({ authAdapter }) {
        counters.api += 1;
        return {
          providerId: 'api_read_provider',
          providerKind: 'phase26_api_read_provider',
          status: 'completed',
          runtimeExecuted: true,
          sideEffectAttempted: false,
          sideEffectSucceeded: false,
          sideEffectFailed: false,
          artifactRefs: ['artifact:phase26-public-read-summary'],
          resultSummary: {
            outcome: 'phase26_public_read_completed',
            responseMaterial: 'sanitized_summary_only',
            artifactRefs: ['artifact:phase26-public-read-summary'],
            redactionRequired: true,
          },
        };
      },
    },
    {
      id: 'download_provider',
      providerKind: 'phase26_download_provider',
      capabilityKinds: ['download', 'export'],
      async run() {
        counters.download += 1;
        return {
          providerId: 'download_provider',
          providerKind: 'phase26_download_provider',
          status: 'completed',
          runtimeExecuted: true,
          sideEffectAttempted: false,
          sideEffectSucceeded: false,
          sideEffectFailed: false,
          artifactRefs: ['artifact:phase26-download-metadata'],
          resultSummary: {
            outcome: 'phase26_download_metadata_ready',
            artifactRefs: ['artifact:phase26-download-metadata'],
            downloads: [{
              artifactRef: 'artifact:phase26-download-metadata',
              filename: 'phase26-public-download-metadata.json',
              contentType: 'application/json',
              byteLength: 128,
              checksum: 'sha256:metadata-only',
              material: 'metadata_only',
              redactionRequired: true,
            }],
            redactionRequired: true,
          },
        };
      },
    },
    {
      id: 'browser_action_provider',
      providerKind: 'phase26_browser_action_provider',
      capabilityKinds: ['write', 'submit', 'form_or_action'],
      async run({ authAdapter, runtimeContext }) {
        counters.browser += 1;
        const trace = {
          steps: [{ kind: 'guard_installed', status: 'completed' }],
          authEvents: [],
          completion: { observed: true },
          cleanup: { sessionClosed: true },
        };
        runtimeContext?.eventLog?.push('guard.installed');
        let authSummary = null;
        if (authAdapter?.isRequired?.() === true) {
          const applied = await authAdapter.applyBrowserAuth({
            driver: {
              async applyEphemeralAuthCookies() {
                runtimeContext?.eventLog?.push('auth.material.applied');
                trace.authEvents.push({ kind: 'auth_applied', status: 'summary_only' });
              },
            },
            targetUrl: `${runtimeContext.siteOrigin}/settings`,
            targetOrigin: runtimeContext.siteOrigin,
            allowedOrigins: [runtimeContext.siteOrigin],
          });
          if (applied.ok !== true) {
            return {
              providerId: 'browser_action_provider',
              providerKind: 'phase26_browser_action_provider',
              status: 'failed',
              reasonCode: applied.reasonCode,
              runtimeExecuted: true,
              sideEffectAttempted: false,
              sideEffectFailed: true,
              authSummary: applied.authSummary,
              resultSummary: {
                outcome: 'phase26_browser_auth_blocked',
                browserExecutionTrace: trace,
                redactionRequired: true,
              },
            };
          }
          authSummary = applied.authSummary;
        }
        trace.steps.push({ kind: 'action', status: 'completed' });
        runtimeContext?.eventLog?.push('browser.action.completed');
        return {
          providerId: 'browser_action_provider',
          providerKind: 'phase26_browser_action_provider',
          status: 'completed',
          runtimeExecuted: true,
          sideEffectAttempted: true,
          sideEffectSucceeded: true,
          sideEffectFailed: false,
          authSummary,
          artifactRefs: ['artifact:phase26-browser-action-summary'],
          resultSummary: {
            outcome: 'phase26_browser_action_completed',
            browserExecutionTrace: trace,
            artifactRefs: ['artifact:phase26-browser-action-summary'],
            redactionRequired: true,
          },
        };
      },
    },
  ]);
}

async function invokePilot(pkg, overrides = {}) {
  const counters = { api: 0, download: 0, browser: 0 };
  const eventLog = [];
  const request = requestFor(pkg, overrides.request ?? {});
  const auditRecorder = createRuntimeAuditRecorder();
  const result = await invokeSkillRuntime({
    request,
    packageManifest: pkg,
    policyDecision: policyFor(pkg, request, overrides.policy ?? {}),
    providerRegistry: createPhase26ProviderRegistry(counters),
    runtimeContext: runtimeContextFor(pkg, eventLog),
    auditRecorder,
  });
  return {
    result,
    counters,
    eventLog,
    auditEvents: auditRecorder.listEvents(),
  };
}

test('all first-party pilot packages validate', async () => {
  const packages = await readPilotPackages();
  assert.deepEqual(Object.keys(packages).sort(), PILOT_PACKAGE_DIRS.toSorted());
  for (const [dir, pkg] of Object.entries(packages)) {
    const report = validateCapabilityPackageManifest(pkg);
    assert.equal(report.ok, true, `${dir}: ${report.errors.join(', ')}`);
    assert.equal(report.sanitized.redactionRequired, true);
    assert.doesNotMatch(JSON.stringify(report.sanitized), PHASE26_CANARIES);
  }
});

test('pilot package digests are stable across canonical round trips', async () => {
  const packages = await readPilotPackages();
  for (const pkg of Object.values(packages)) {
    const digest = createCapabilityPackageDigest(pkg);
    assert.match(digest, /^sha256:[a-f0-9]{64}$/u);
    assert.equal(createCapabilityPackageDigest(clone(pkg)), digest);
  }
});

test('pilot capabilityRef values resolve through package resolver', async () => {
  const packages = await readPilotPackages();
  const registry = createCapabilityPackageRegistry();
  for (const pkg of Object.values(packages)) {
    registry.register(pkg, { source: 'phase26-first-party-pilot', registeredAt: '2026-06-07T00:00:00.000Z' });
    const capability = primaryCapability(pkg);
    const resolved = resolvePackageCapabilityRef(pkg, capability.capabilityRef);
    assert.equal(resolved.found, true);
    assert.equal(resolved.capability.capabilityRef, capability.capabilityRef);
  }
  assert.equal(registry.list().length, PILOT_PACKAGE_DIRS.length);
});

test('pilot executionContractRef values resolve through package resolver', async () => {
  const packages = await readPilotPackages();
  for (const pkg of Object.values(packages)) {
    const contract = primaryContract(pkg);
    const resolved = resolvePackageExecutionContractRef(pkg, contract.executionContractRef);
    assert.equal(resolved.found, true);
    assert.equal(resolved.contract.executionContractRef, contract.executionContractRef);
  }
});

test('public read pilot dryRun and execute stay read-only', async () => {
  const { 'public-read-fixture': pkg } = await readPilotPackages();
  const preview = await invokePilot(pkg);
  const executed = await invokePilot(pkg, {
    request: { mode: 'execute', idempotencyKey: 'idem:phase26:public-read:execute' },
  });

  assert.equal(preview.result.status, 'preview');
  assert.equal(preview.counters.api, 0);
  assert.equal(executed.result.status, 'completed');
  assert.equal(executed.result.providerInvoked, true);
  assert.equal(executed.result.sideEffectAttempted, false);
  assert.equal(executed.counters.api, 1);
});

test('public download pilot dryRun and execute return safe metadata only', async () => {
  const { 'public-download-fixture': pkg } = await readPilotPackages();
  const preview = await invokePilot(pkg);
  const executed = await invokePilot(pkg, {
    request: { mode: 'execute', idempotencyKey: 'idem:phase26:download:execute' },
  });

  assert.equal(preview.result.status, 'preview');
  assert.equal(preview.counters.download, 0);
  assert.equal(executed.result.status, 'completed');
  assert.deepEqual(executed.result.runtimeReportSummary.artifactRefs, ['artifact:phase26-download-metadata']);
  assert.equal(executed.result.networkInvoked, false);
  assert.doesNotMatch(JSON.stringify(executed), PHASE26_CANARIES);
});

test('controlled contact form fixture executes only in controlled runtime', async () => {
  const { 'contact-form-fixture': pkg } = await readPilotPackages();
  const executed = await invokePilot(pkg, {
    request: { mode: 'execute', idempotencyKey: 'idem:phase26:contact-form:execute' },
  });

  assert.equal(executed.result.status, 'completed');
  assert.equal(executed.result.providerInvoked, true);
  assert.equal(executed.result.sideEffectAttempted, true);
  assert.equal(executed.counters.browser, 1);
  assert.equal(executed.auditEvents[0].verdict, 'controlled');
});

test('auth read fixture uses safe mock session metadata', async () => {
  const { 'auth-read-fixture': pkg } = await readPilotPackages();
  const executed = await invokePilot(pkg, {
    request: { mode: 'execute', idempotencyKey: 'idem:phase26:auth-read:execute' },
  });

  assert.equal(executed.result.status, 'completed');
  assert.equal(executed.result.runtimeReportSummary.providerId, 'api_read_provider');
  assert.equal(executed.auditEvents[0].authSummary.required, true);
  assert.equal(executed.auditEvents[0].authSummary.used, false);
  assert.equal(executed.auditEvents[0].authSummary.scopesRequested[0].origin, pkg.siteOrigin);
  assert.doesNotMatch(JSON.stringify(executed), PHASE26_CANARIES);
});

test('auth controlled browser write installs guards before material use', async () => {
  const { 'auth-browser-write-fixture': pkg } = await readPilotPackages();
  const executed = await invokePilot(pkg, {
    request: { mode: 'execute', idempotencyKey: 'idem:phase26:auth-browser-write:execute' },
  });

  assert.equal(executed.result.status, 'completed');
  assert.equal(executed.result.browserInvoked, true);
  assert.equal(executed.auditEvents[0].authSummary.used, true);
  assert.equal(executed.eventLog.indexOf('guard.installed') >= 0, true);
  assert.equal(executed.eventLog.indexOf('auth.material.applied') > executed.eventLog.indexOf('guard.installed'), true);
  assert.equal(executed.eventLog.indexOf('browser.action.completed') > executed.eventLog.indexOf('auth.material.applied'), true);
});

test('destructive pilot remains blocked before provider execution', async () => {
  const { 'destructive-blocked-fixture': pkg } = await readPilotPackages();
  const executed = await invokePilot(pkg, {
    request: {
      mode: 'execute',
      idempotencyKey: 'idem:phase26:destructive:execute',
      destructiveAuthorization: {
        authzRef: 'destructive-authz:phase26-ref',
        challengeRef: 'destructive-challenge:phase26-ref',
        confirmationRef: 'destructive-confirmation:phase26-ref',
        policyGate: { satisfied: true, policyId: 'policy:phase26-destructive' },
      },
    },
  });

  assert.equal(executed.result.status, 'blocked');
  assert.equal(executed.result.reasonCode, 'runtime.destructive_execution_blocked');
  assert.equal(executed.result.providerInvoked, false);
  assert.equal(executed.counters.browser, 0);
});

test('payment pilot remains blocked and planned only', async () => {
  const { 'payment-blocked-fixture': pkg } = await readPilotPackages();
  const executed = await invokePilot(pkg, {
    request: { mode: 'execute', idempotencyKey: 'idem:phase26:payment:execute' },
  });

  assert.equal(executed.result.status, 'blocked');
  assert.equal(executed.result.reasonCode, 'runtime.payment_execution_blocked');
  assert.equal(executed.result.providerInvoked, false);
  assert.equal(executed.counters.browser, 0);
});

test('runtime audit views are generated from pilot execution summaries', async () => {
  const packages = await readPilotPackages();
  const executed = await Promise.all([
    invokePilot(packages['public-read-fixture'], {
      request: { mode: 'execute', idempotencyKey: 'idem:phase26:audit:read' },
    }),
    invokePilot(packages['contact-form-fixture'], {
      request: { mode: 'execute', idempotencyKey: 'idem:phase26:audit:form' },
    }),
  ]);
  const views = executed.map(({ result, auditEvents }) => createRuntimeAuditView({
    report: result.runtimeReportSummary,
    auditEvents,
  }));

  for (const view of views) {
    assert.equal(view.redactionRequired, true);
    assert.equal(view.timeline.length > 0, true);
    assert.doesNotMatch(JSON.stringify(view), PHASE26_CANARIES);
  }
});

test('runtime regression snapshots are generated for pilot packages', async () => {
  const previous = createRuntimeRegressionSnapshotFixture({
    snapshotId: 'runtime-ci-regression:phase26-public-read:previous',
    runtime: {
      status: 'completed',
      reasonCode: 'runtime.completed',
      providerId: 'api_read_provider',
      capabilityKind: 'read',
      providerInvoked: true,
      executionAttempted: true,
      sideEffectAttempted: false,
      paymentBlocked: false,
      destructiveBlocked: false,
      executionContractConcrete: true,
    },
    auth: {
      required: false,
      used: false,
      scopes: [],
      materialTypes: [],
    },
    metadata: {
      label: 'phase26-public-read',
    },
  });
  const next = clone(previous);
  next.snapshotId = 'runtime-ci-regression:phase26-public-read:next';
  const report = runRuntimeRegressionHarness({
    reportId: 'runtime-ci-regression:phase26-pilot',
    cases: [{
      caseId: 'phase26-public-read',
      previous,
      next,
    }],
  });

  assert.equal(report.status, 'passed');
  assert.equal(report.comparisonCount, 1);
  assert.doesNotMatch(JSON.stringify(report), PHASE26_CANARIES);
});

test('pilot packages and runtime outputs do not leak raw canary material', async () => {
  const packages = await readPilotPackages();
  const outputs = [];
  for (const pkg of Object.values(packages)) {
    outputs.push(validateCapabilityPackageManifest(pkg).sanitized);
  }
  outputs.push((await invokePilot(packages['public-read-fixture'], {
    request: { mode: 'execute', idempotencyKey: 'idem:phase26:canary:read' },
  })).result);
  outputs.push((await invokePilot(packages['destructive-blocked-fixture'], {
    request: {
      mode: 'execute',
      idempotencyKey: 'idem:phase26:canary:destructive',
      taskText: 'User text cannot authorize protected pilot actions.',
    },
  })).result);

  assert.doesNotMatch(JSON.stringify(outputs), PHASE26_CANARIES);
});
