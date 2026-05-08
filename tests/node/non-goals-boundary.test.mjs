import test from 'node:test';
import assert from 'node:assert/strict';

import {
  REDACTION_PLACEHOLDER,
} from '../../src/sites/capability/security-guard.mjs';
import {
  NON_GOALS_BOUNDARY_SCHEMA_VERSION,
  assertNonGoalBoundary,
  scanNonGoalBoundary,
} from '../../src/sites/capability/non-goals-boundary.mjs';
import * as nonGoalsBoundary from '../../src/sites/capability/non-goals-boundary.mjs';

function loadNonGoalRuntimeBoundaryHandoffGuardApi() {
  const create = nonGoalsBoundary.createNonGoalRuntimeBoundaryHandoffGuard;
  const assertCompatibility =
    nonGoalsBoundary.assertNonGoalRuntimeBoundaryHandoffGuardCompatibility;
  if (typeof create !== 'function' || typeof assertCompatibility !== 'function') {
    throw new Error(
      'NonGoalsBoundary runtime handoff guard exports are required: '
      + 'createNonGoalRuntimeBoundaryHandoffGuard and '
      + 'assertNonGoalRuntimeBoundaryHandoffGuardCompatibility',
    );
  }
  return { create, assertCompatibility };
}

function loadNonGoalLiveConsumerAcceptanceGuardApi() {
  const create = nonGoalsBoundary.createNonGoalLiveConsumerAcceptanceGuard;
  const assertCompatibility =
    nonGoalsBoundary.assertNonGoalLiveConsumerAcceptanceGuardCompatibility;
  if (typeof create !== 'function' || typeof assertCompatibility !== 'function') {
    throw new Error(
      'NonGoalsBoundary live consumer acceptance guard exports are required: '
      + 'createNonGoalLiveConsumerAcceptanceGuard and '
      + 'assertNonGoalLiveConsumerAcceptanceGuardCompatibility',
    );
  }
  return { create, assertCompatibility };
}

function loadNonGoalLiveConsumerCompatibilityReviewGateApi() {
  const create = nonGoalsBoundary.createNonGoalLiveConsumerCompatibilityReviewGate;
  const assertCompatibility =
    nonGoalsBoundary.assertNonGoalLiveConsumerCompatibilityReviewGateCompatibility;
  if (typeof create !== 'function' || typeof assertCompatibility !== 'function') {
    throw new Error(
      'NonGoalsBoundary live consumer compatibility review gate exports are required: '
      + 'createNonGoalLiveConsumerCompatibilityReviewGate and '
      + 'assertNonGoalLiveConsumerCompatibilityReviewGateCompatibility',
    );
  }
  return { create, assertCompatibility };
}

function captureThrownMessage(fn) {
  try {
    fn();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error('Expected function to throw');
}

test('NonGoalsBoundary allows site-agnostic Kernel descriptors with redacted payloads', () => {
  const result = assertNonGoalBoundary({
    owner: 'Kernel',
    responsibility: 'coordinate lifecycle, reason codes, schema gates, and policy handoff',
    payload: {
      reasonCode: 'policy-gated',
      sessionSummary: {
        status: 'ready',
        authorization: REDACTION_PLACEHOLDER,
      },
    },
    imports: [
      {
        specifier: 'src/sites/capability/reason-codes.mjs',
        imported: ['reasonCodes'],
      },
    ],
  });

  assert.equal(result.schemaVersion, NON_GOALS_BOUNDARY_SCHEMA_VERSION);
  assert.equal(result.owner, 'Kernel');
  assert.equal(result.allowed, true);
  assert.deepEqual(result.findings, []);
});

test('NonGoalsBoundary allows SiteAdapter to own concrete site interpretation without raw material', () => {
  const result = assertNonGoalBoundary({
    owner: 'SiteAdapter',
    responsibilities: [
      'bilibili page type interpretation',
      'douyin endpoint validation with redacted evidence',
    ],
    payload: {
      siteDecision: 'video-page',
      evidence: {
        cookie: REDACTION_PLACEHOLDER,
      },
    },
  });

  assert.equal(result.owner, 'SiteAdapter');
  assert.equal(result.allowed, true);
});

test('NonGoalsBoundary rejects Kernel concrete site semantics', () => {
  assert.throws(
    () => assertNonGoalBoundary({
      owner: 'Kernel',
      responsibility: 'bilibili page type interpretation and endpoint validation',
      payload: {
        reasonCode: 'site-specific-decision',
      },
    }),
    /concrete-site-semantics/u,
  );
});

test('NonGoalsBoundary rejects CapabilityService raw credential ownership by sensitive field', () => {
  const result = scanNonGoalBoundary({
    owner: 'CapabilityService',
    responsibility: 'normalize cross-site evidence',
    payload: {
      sessionMaterial: 'synthetic fixture value',
      nested: {
        csrfToken: 'synthetic fixture value',
      },
    },
  });

  assert.equal(result.allowed, false);
  assert.equal(result.findings.length, 2);
  assert.deepEqual(
    result.findings.map((finding) => finding.rule),
    ['raw-sensitive-material', 'raw-sensitive-material'],
  );
  assert.deepEqual(
    result.findings.map((finding) => finding.path),
    ['payload.sessionMaterial', 'payload.nested.csrfToken'],
  );
});

test('NonGoalsBoundary rejects downloader raw session reads from imports', () => {
  assert.throws(
    () => assertNonGoalBoundary({
      owner: 'downloader',
      responsibility: 'execute low-permission file transfer from planned resources',
      imports: [
        {
          specifier: 'src/infra/browser/session.mjs',
          imported: ['readRawSessionMaterial'],
        },
      ],
    }),
    /downloader-raw-session-read/u,
  );
});

test('NonGoalsBoundary rejects API auto-promotion for every owner', () => {
  for (const owner of ['Kernel', 'CapabilityService', 'SiteAdapter', 'downloader']) {
    assert.throws(
      () => assertNonGoalBoundary({
        owner,
        responsibility: 'auto-promote API candidate into catalog',
        payload: {
          apiAutoPromotion: true,
        },
      }),
      /api-auto-promotion/u,
    );
  }
});

test('NonGoalsBoundary rejects CAPTCHA anti-bot access-control bypass descriptors without executing', () => {
  const safeDescriptor = assertNonGoalBoundary({
    owner: 'CapabilityService',
    responsibility: [
      'classify CAPTCHA, anti-bot, access-control, and platform-risk states as blocked manual recovery boundaries',
      'record blocked challenge state without solving, bypassing, or executing runtime handlers',
    ],
    payload: {
      riskState: 'captcha_required',
      result: 'blocked',
      action: 'manual_recovery_required',
      manualRecoveryRequired: true,
      runtimeArtifactWriteEnabled: false,
      repoWriteEnabled: false,
      writePathEnabled: false,
      executionEnabled: false,
    },
  });

  assert.equal(safeDescriptor.allowed, true);
  assert.deepEqual(safeDescriptor.findings, []);

  for (const { name, descriptor } of [
    {
      name: 'captchaBypass',
      descriptor: {
        payload: {
          captchaBypass: true,
        },
      },
    },
    {
      name: 'solveCaptcha',
      descriptor: {
        payload: {
          solveCaptcha: 'synthetic-secret-value',
        },
      },
    },
    {
      name: 'antiBotBypass',
      descriptor: {
        payload: {
          antiBotBypass: true,
        },
      },
    },
    {
      name: 'accessControlBypass',
      descriptor: {
        payload: {
          accessControlBypass: true,
        },
      },
    },
    {
      name: 'platformRiskEvasion',
      descriptor: {
        payload: {
          platformRiskEvasion: true,
        },
      },
    },
    {
      name: 'silentPrivilegeExpansion',
      descriptor: {
        payload: {
          silentPrivilegeExpansion: true,
        },
      },
    },
    {
      name: 'bypass CAPTCHA text',
      descriptor: {
        responsibility: 'bypass CAPTCHA challenge with synthetic-secret-value',
      },
    },
    {
      name: 'evade anti-bot risk control text',
      descriptor: {
        payload: {
          note: 'evade anti-bot risk control with synthetic-secret-value',
        },
      },
    },
  ]) {
    const candidate = {
      owner: 'CapabilityService',
      responsibility: 'classify blocked non-goal boundary without runtime execution',
      ...descriptor,
    };
    const result = scanNonGoalBoundary(candidate);

    assert.equal(result.allowed, false, name);
    assert.equal(
      result.findings.some((finding) => finding.rule === 'non-goal-bypass'),
      true,
      name,
    );
    assert.equal(
      result.findings.some((finding) => /artifactPath|writePath|runtimeArtifact|repoPath/iu.test(finding.path)),
      false,
      name,
    );
    assert.doesNotMatch(JSON.stringify(result), /synthetic-secret-value/u, name);

    const message = captureThrownMessage(() => assertNonGoalBoundary(candidate));
    assert.match(message, /non-goal-bypass/u, name);
    assert.doesNotMatch(message, /synthetic-secret-value/u, name);
  }
});

test('NonGoalsBoundary runtime handoff guard keeps blocked non-goals from becoming live consumers', () => {
  const { create, assertCompatibility } = loadNonGoalRuntimeBoundaryHandoffGuardApi();
  const descriptor = {
    owner: 'CapabilityService',
    responsibility: [
      'classify blocked non-goal states as manual recovery descriptors',
      'record runtime handoff as blocked without live consumers, writes, or materialization',
    ],
    payload: {
      riskState: 'captcha_required',
      result: 'blocked',
      reasonCode: 'non-goal-runtime-boundary-disabled',
      action: 'manual_recovery_required',
      manualRecoveryRequired: true,
    },
  };
  const boundaryResult = assertNonGoalBoundary(descriptor);
  const scanResult = scanNonGoalBoundary(descriptor);

  assert.equal(boundaryResult.allowed, true);
  assert.deepEqual(boundaryResult.findings, []);
  assert.equal(scanResult.allowed, true);
  assert.deepEqual(scanResult.findings, []);

  const guard = create({
    boundary: descriptor,
    guardName: 'synthetic-non-goal-runtime-boundary-handoff-guard',
  });
  const item = guard.items[0];

  assert.equal(assertCompatibility(guard), true);
  assert.equal(guard.queryName, 'createNonGoalRuntimeBoundaryHandoffGuard');
  assert.equal(guard.artifactFamily, 'site-capability-graph-non-goal-runtime-boundary-handoff-guard');
  assert.equal(guard.redactionRequired, true);
  assert.equal(item.handoffMode ?? item.guardMode ?? item.contractMode, 'descriptor-only');
  assert.equal(item.result, 'blocked');
  assert.equal(item.reasonCode, 'non-goal-runtime-boundary-disabled');
  assert.equal(item.requiredBoundaryGuard, 'assertNonGoalBoundary');
  assert.equal(item.requiredRuntimeGuard, 'assertNonGoalRuntimeBoundaryHandoffGuardCompatibility');
  assert.equal(item.sourceBoundary.owner, boundaryResult.owner);
  assert.equal(item.sourceBoundary.allowed, true);
  assert.equal(item.sourceBoundary.findingCount, 0);

  for (const flagName of [
    'runtimeConsumerEnabled',
    'producerEnabled',
    'subscriberEnabled',
    'writeEnabled',
    'runtimeHandoffEnabled',
    'executionEnabled',
    'runtimeExecutionEnabled',
    'materializationEnabled',
    'sessionMaterializationEnabled',
    'runtimeArtifactWriteEnabled',
    'repoWriteEnabled',
    'siteAdapterInvocationEnabled',
    'downloaderInvocationEnabled',
    'externalTelemetryEnabled',
    'captchaBypassEnabled',
    'antiBotBypassEnabled',
    'accessControlBypassEnabled',
  ]) {
    if (Object.hasOwn(item, flagName)) {
      assert.equal(item[flagName], false, flagName);
    }
  }

  for (const runtimeField of [
    'sessionView',
    'downloadPolicy',
    'taskList',
    'siteAdapter',
    'downloader',
    'handler',
    'outputPath',
    'repoPath',
    'runtimeArtifact',
    'externalTelemetry',
    'cookie',
    'Authorization',
    'token',
    'sessionId',
    'browserProfile',
    'captchaBypass',
  ]) {
    assert.equal(Object.hasOwn(item, runtimeField), false, runtimeField);
  }

  for (const { name, options, pattern } of [
    {
      name: 'runtimeConsumerEnabled',
      options: { runtimeConsumerEnabled: true },
      pattern: /runtimeConsumerEnabled must remain false|runtimeConsumerEnabled must be false|runtime field/i,
    },
    {
      name: 'executionEnabled',
      options: { executionEnabled: true },
      pattern: /executionEnabled must remain false|executionEnabled must be false|runtime field/i,
    },
    {
      name: 'sessionMaterializationEnabled',
      options: { sessionMaterializationEnabled: true },
      pattern: /sessionMaterializationEnabled must remain false|sessionMaterializationEnabled must be false|runtime field/i,
    },
    {
      name: 'runtimeArtifactWriteEnabled',
      options: { runtimeArtifactWriteEnabled: true },
      pattern: /runtimeArtifactWriteEnabled must remain false|runtimeArtifactWriteEnabled must be false|runtime field/i,
    },
    {
      name: 'repoWriteEnabled',
      options: { repoWriteEnabled: true },
      pattern: /repoWriteEnabled must remain false|repoWriteEnabled must be false|runtime field/i,
    },
    {
      name: 'siteAdapterInvocationEnabled',
      options: { siteAdapterInvocationEnabled: true },
      pattern: /siteAdapterInvocationEnabled must remain false|siteAdapterInvocationEnabled must be false|runtime field/i,
    },
    {
      name: 'downloaderInvocationEnabled',
      options: { downloaderInvocationEnabled: true },
      pattern: /downloaderInvocationEnabled must remain false|downloaderInvocationEnabled must be false|runtime field/i,
    },
    {
      name: 'sessionView',
      options: { sessionView: { sessionId: 'synthetic-secret-value' } },
      pattern: /sessionView|descriptor-only|runtime field|raw sensitive material/i,
    },
    {
      name: 'downloadPolicy',
      options: { downloadPolicy: { execute: 'synthetic-secret-value' } },
      pattern: /downloadPolicy|descriptor-only|runtime field/i,
    },
    {
      name: 'taskList',
      options: { taskList: [] },
      pattern: /taskList|descriptor-only|runtime field/i,
    },
    {
      name: 'siteAdapter',
      options: { siteAdapter: { execute: 'synthetic-secret-value' } },
      pattern: /siteAdapter|descriptor-only|runtime field/i,
    },
    {
      name: 'downloader',
      options: { downloader: { execute: 'synthetic-secret-value' } },
      pattern: /downloader|descriptor-only|runtime field/i,
    },
    {
      name: 'handler',
      options: { handler: { execute: 'synthetic-secret-value' } },
      pattern: /handler|descriptor-only|runtime field/i,
    },
    {
      name: 'outputPath',
      options: { outputPath: 'runs/synthetic-secret-value.json' },
      pattern: /outputPath|descriptor-only|runtime field/i,
    },
    {
      name: 'repoPath',
      options: { repoPath: 'C:\\synthetic-secret-value' },
      pattern: /repoPath|descriptor-only|runtime field/i,
    },
    {
      name: 'runtimeArtifact',
      options: { runtimeArtifact: { value: 'synthetic-secret-value' } },
      pattern: /runtimeArtifact|descriptor-only|runtime field/i,
    },
    {
      name: 'externalTelemetry',
      options: { externalTelemetry: { Authorization: 'Bearer synthetic-secret-value' } },
      pattern: /externalTelemetry|Authorization|descriptor-only|runtime field|raw sensitive material/i,
    },
    {
      name: 'cookie',
      options: { cookie: 'synthetic-secret-value' },
      pattern: /cookie|descriptor-only|runtime field|raw sensitive material/i,
    },
    {
      name: 'Authorization',
      options: { Authorization: 'Bearer synthetic-secret-value' },
      pattern: /Authorization|descriptor-only|runtime field|raw sensitive material/i,
    },
    {
      name: 'token',
      options: { token: 'synthetic-secret-value' },
      pattern: /token|descriptor-only|runtime field|raw sensitive material/i,
    },
    {
      name: 'sessionId',
      options: { sessionId: 'synthetic-secret-value' },
      pattern: /sessionId|descriptor-only|runtime field|raw sensitive material/i,
    },
    {
      name: 'browserProfile',
      options: { browserProfile: 'synthetic-secret-value' },
      pattern: /browserProfile|descriptor-only|runtime field|raw sensitive material/i,
    },
    {
      name: 'captchaBypass',
      options: { captchaBypass: true },
      pattern: /captchaBypass|non-goal-bypass|descriptor-only|runtime field/i,
    },
  ]) {
    const message = captureThrownMessage(() => create({
      boundary: descriptor,
      guardName: 'synthetic-non-goal-runtime-boundary-handoff-guard',
      ...options,
    }));
    assert.match(message, pattern, name);
    assert.doesNotMatch(message, /synthetic-secret-value/u, name);
  }

  const unsafeGuard = create({
    boundary: descriptor,
    guardName: 'synthetic-non-goal-runtime-boundary-handoff-guard',
  });
  unsafeGuard.items[0].runtimeConsumerEnabled = true;
  assert.throws(
    () => assertCompatibility(unsafeGuard),
    /runtimeConsumerEnabled must be false|runtimeConsumerEnabled must remain false/u,
  );

  const rendered = JSON.stringify(guard);
  assert.doesNotMatch(rendered, /synthetic-secret-value|Authorization|Bearer|cookie|token|sessionId|browserProfile/iu);
  assert.doesNotMatch(rendered, /"sessionView"\s*:|"downloadPolicy"\s*:|"taskList"\s*:|"siteAdapter"\s*:/u);
  assert.doesNotMatch(rendered, /"downloader"\s*:|"handler"\s*:|"outputPath"\s*:|"repoPath"\s*:/u);
  assert.doesNotMatch(rendered, /"runtimeArtifact"\s*:|"externalTelemetry"\s*:|"captchaBypass"\s*:/u);
});

test('NonGoalsBoundary live consumer acceptance guard keeps runtime handoffs from promotion', () => {
  const { create: createHandoffGuard, assertCompatibility: assertHandoffCompatibility } =
    loadNonGoalRuntimeBoundaryHandoffGuardApi();
  const { create: createAcceptanceGuard, assertCompatibility: assertAcceptanceCompatibility } =
    loadNonGoalLiveConsumerAcceptanceGuardApi();
  const descriptor = {
    owner: 'CapabilityService',
    responsibility: [
      'classify blocked non-goal states as manual recovery descriptors',
      'record live consumer acceptance as blocked without runtime producers, subscribers, writes, or materialization',
    ],
    payload: {
      riskState: 'captcha_required',
      result: 'blocked',
      reasonCode: 'non-goal-runtime-boundary-disabled',
      action: 'manual_recovery_required',
      manualRecoveryRequired: true,
    },
  };
  const boundaryResult = assertNonGoalBoundary(descriptor);
  const scanResult = scanNonGoalBoundary(descriptor);
  const handoffGuard = createHandoffGuard({
    boundary: descriptor,
    boundaryResult,
    scanResult,
    guardName: 'synthetic-non-goal-live-consumer-source-handoff-guard',
  });
  const acceptanceGuard = createAcceptanceGuard(handoffGuard, {
    guardName: 'synthetic-non-goal-live-consumer-acceptance-guard',
  });
  const item = acceptanceGuard.items[0];
  const sourceHandoff = item.sourceRuntimeBoundaryHandoff
    ?? item.sourceHandoffGuard
    ?? item.sourceHandoff
    ?? item.sourceNonGoalRuntimeBoundaryHandoff;

  assert.equal(boundaryResult.allowed, true);
  assert.deepEqual(boundaryResult.findings, []);
  assert.equal(scanResult.allowed, true);
  assert.equal(assertHandoffCompatibility(handoffGuard), true);
  assert.equal(assertAcceptanceCompatibility(acceptanceGuard), true);
  assert.equal(acceptanceGuard.queryName, 'createNonGoalLiveConsumerAcceptanceGuard');
  assert.equal(
    acceptanceGuard.artifactFamily,
    'site-capability-graph-non-goal-live-consumer-acceptance-guard',
  );
  assert.equal(acceptanceGuard.redactionRequired, true);
  assert.equal(item.guardMode ?? item.acceptanceMode ?? item.contractMode, 'descriptor-only');
  assert.equal(item.result, 'blocked');
  assert.equal(item.reasonCode, 'non-goal-runtime-boundary-disabled');
  assert.ok(sourceHandoff, 'source runtime boundary handoff summary is required');
  assert.equal(sourceHandoff.queryName, handoffGuard.queryName);
  assert.equal(sourceHandoff.artifactFamily, handoffGuard.artifactFamily);
  assert.equal(sourceHandoff.result, handoffGuard.items[0].result);
  assert.equal(sourceHandoff.reasonCode, handoffGuard.items[0].reasonCode);
  assert.equal(
    item.requiredRuntimeBoundaryHandoffGuard
      ?? item.requiredSourceHandoffGuard
      ?? item.requiredHandoffGuard
      ?? item.requiredGuards?.runtimeBoundaryHandoffGuard
      ?? item.requiredGuards?.handoffGuard,
    'assertNonGoalRuntimeBoundaryHandoffGuardCompatibility',
  );
  assert.equal(
    item.requiredLiveConsumerAcceptanceGuard
      ?? item.requiredAcceptanceGuard
      ?? item.requiredGuards?.liveConsumerAcceptanceGuard
      ?? item.requiredGuards?.acceptanceGuard,
    'assertNonGoalLiveConsumerAcceptanceGuardCompatibility',
  );

  for (const flagName of [
    'liveConsumerEnabled',
    'runtimeProducerEnabled',
    'runtimeSubscriberEnabled',
    'externalTelemetryEnabled',
    'repoWriteEnabled',
    'docsWriteEnabled',
    'runtimeWriteEnabled',
    'runtimeArtifactWriteEnabled',
    'graphExecutionEnabled',
    'siteAdapterInvocationEnabled',
    'downloaderInvocationEnabled',
    'sessionMaterializationEnabled',
    'statusPromotionAllowed',
    'verifiedPromotionAllowed',
    'runtimeConsumerEnabled',
    'producerEnabled',
    'subscriberEnabled',
    'writeEnabled',
    'executionEnabled',
    'runtimeExecutionEnabled',
  ]) {
    if (Object.hasOwn(item, flagName)) {
      assert.equal(item[flagName], false, flagName);
    }
  }

  for (const runtimeField of [
    'sessionView',
    'downloadPolicy',
    'siteAdapter',
    'downloader',
    'runtimeArtifact',
    'runtimePayload',
    'externalTelemetry',
    'cookie',
    'Authorization',
    'token',
    'sessionId',
    'browserProfile',
    'captchaBypass',
  ]) {
    assert.equal(Object.hasOwn(item, runtimeField), false, runtimeField);
  }

  for (const { name, options, pattern } of [
    {
      name: 'liveConsumerEnabled',
      options: { liveConsumerEnabled: true },
      pattern: /liveConsumerEnabled must remain false|liveConsumerEnabled must be false|runtime field/i,
    },
    {
      name: 'runtimeProducerEnabled',
      options: { runtimeProducerEnabled: true },
      pattern: /runtimeProducerEnabled must remain false|runtimeProducerEnabled must be false|runtime field/i,
    },
    {
      name: 'runtimeSubscriberEnabled',
      options: { runtimeSubscriberEnabled: true },
      pattern: /runtimeSubscriberEnabled must remain false|runtimeSubscriberEnabled must be false|runtime field/i,
    },
    {
      name: 'externalTelemetryEnabled',
      options: { externalTelemetryEnabled: true },
      pattern: /externalTelemetryEnabled must remain false|externalTelemetryEnabled must be false|runtime field/i,
    },
    {
      name: 'repoWriteEnabled',
      options: { repoWriteEnabled: true },
      pattern: /repoWriteEnabled must remain false|repoWriteEnabled must be false|runtime field/i,
    },
    {
      name: 'docsWriteEnabled',
      options: { docsWriteEnabled: true },
      pattern: /docsWriteEnabled must remain false|docsWriteEnabled must be false|runtime field/i,
    },
    {
      name: 'runtimeArtifactWriteEnabled',
      options: { runtimeArtifactWriteEnabled: true },
      pattern: /runtimeArtifactWriteEnabled must remain false|runtimeArtifactWriteEnabled must be false|runtime field/i,
    },
    {
      name: 'graphExecutionEnabled',
      options: { graphExecutionEnabled: true },
      pattern: /graphExecutionEnabled must remain false|graphExecutionEnabled must be false|runtime field/i,
    },
    {
      name: 'sessionView',
      options: { sessionView: { sessionId: 'synthetic-secret-value' } },
      pattern: /sessionView|descriptor-only|runtime field|raw sensitive material/i,
    },
    {
      name: 'downloadPolicy',
      options: { downloadPolicy: { execute: 'synthetic-secret-value' } },
      pattern: /downloadPolicy|descriptor-only|runtime field/i,
    },
    {
      name: 'siteAdapter',
      options: { siteAdapter: { execute: 'synthetic-secret-value' } },
      pattern: /siteAdapter|descriptor-only|runtime field/i,
    },
    {
      name: 'downloader',
      options: { downloader: { execute: 'synthetic-secret-value' } },
      pattern: /downloader|descriptor-only|runtime field/i,
    },
    {
      name: 'runtimeArtifact',
      options: { runtimeArtifact: { path: 'runs/synthetic-secret-value.json' } },
      pattern: /runtimeArtifact|descriptor-only|runtime field/i,
    },
    {
      name: 'externalTelemetry',
      options: { externalTelemetry: { Authorization: 'Bearer synthetic-secret-value' } },
      pattern: /externalTelemetry|Authorization|descriptor-only|runtime field|forbidden sensitive pattern/i,
    },
    {
      name: 'cookie',
      options: { cookie: 'synthetic-secret-value' },
      pattern: /cookie|descriptor-only|runtime field|raw sensitive material/i,
    },
    {
      name: 'Authorization',
      options: { Authorization: 'Bearer synthetic-secret-value' },
      pattern: /Authorization|descriptor-only|runtime field|forbidden sensitive pattern/i,
    },
    {
      name: 'token',
      options: { token: 'synthetic-secret-value' },
      pattern: /token|descriptor-only|runtime field|raw sensitive material/i,
    },
    {
      name: 'sessionId',
      options: { sessionId: 'synthetic-secret-value' },
      pattern: /sessionId|descriptor-only|runtime field|raw sensitive material/i,
    },
    {
      name: 'browserProfile',
      options: { browserProfile: 'synthetic-secret-value' },
      pattern: /browserProfile|descriptor-only|runtime field|raw sensitive material/i,
    },
    {
      name: 'captchaBypass',
      options: { captchaBypass: true },
      pattern: /captchaBypass|non-goal-bypass|descriptor-only|runtime field/i,
    },
  ]) {
    const message = captureThrownMessage(() => createAcceptanceGuard(handoffGuard, {
      guardName: 'synthetic-non-goal-live-consumer-acceptance-guard',
      ...options,
    }));
    assert.match(message, pattern, name);
    assert.doesNotMatch(message, /synthetic-secret-value/u, name);
  }

  const unsafeGuard = createAcceptanceGuard(handoffGuard, {
    guardName: 'synthetic-non-goal-live-consumer-acceptance-guard',
  });
  unsafeGuard.items[0].liveConsumerEnabled = true;
  assert.throws(
    () => assertAcceptanceCompatibility(unsafeGuard),
    /liveConsumerEnabled must be false|liveConsumerEnabled must remain false/u,
  );

  const rendered = JSON.stringify(acceptanceGuard);
  assert.doesNotMatch(rendered, /synthetic-secret-value/u);
  assert.doesNotMatch(rendered, /"sessionView"\s*:|"downloadPolicy"\s*:|"siteAdapter"\s*:/u);
  assert.doesNotMatch(rendered, /"downloader"\s*:|"runtimeArtifact"\s*:|"runtimePayload"\s*:/u);
  assert.doesNotMatch(rendered, /"externalTelemetry"\s*:|"captchaBypass"\s*:/u);
});

test('NonGoalsBoundary live consumer compatibility review gate consumes only acceptance guard safe summaries', () => {
  const { create: createHandoffGuard } = loadNonGoalRuntimeBoundaryHandoffGuardApi();
  const {
    create: createAcceptanceGuard,
    assertCompatibility: assertAcceptanceCompatibility,
  } = loadNonGoalLiveConsumerAcceptanceGuardApi();
  const {
    create: createReviewGate,
    assertCompatibility: assertReviewGateCompatibility,
  } = loadNonGoalLiveConsumerCompatibilityReviewGateApi();
  const descriptor = {
    owner: 'CapabilityService',
    responsibilities: [
      'classify blocked non-goal states as manual recovery descriptors',
      'record compatibility review as blocked without live consumers or runtime promotion',
    ],
    payload: {
      riskState: 'captcha_required',
      result: 'blocked',
      reasonCode: 'non-goal-runtime-boundary-disabled',
      action: 'manual_recovery_required',
      manualRecoveryRequired: true,
    },
  };
  const boundaryResult = assertNonGoalBoundary(descriptor);
  const scanResult = scanNonGoalBoundary(descriptor);
  const handoffGuard = createHandoffGuard({
    boundary: descriptor,
    boundaryResult,
    scanResult,
    guardName: 'synthetic-non-goal-review-source-handoff-guard',
  });
  const acceptanceGuard = createAcceptanceGuard(handoffGuard, {
    guardName: 'synthetic-non-goal-review-source-acceptance-guard',
  });
  const reviewGate = createReviewGate(acceptanceGuard, {
    guardName: 'synthetic-non-goal-live-consumer-compatibility-review-gate',
  });
  const item = reviewGate.items[0];
  const sourceAcceptance = item.sourceLiveConsumerAcceptance
    ?? item.sourceAcceptanceGuard
    ?? item.sourceAcceptance
    ?? item.sourceNonGoalLiveConsumerAcceptance
    ?? item.sourceLiveConsumerAcceptanceGuard;

  assert.equal(boundaryResult.allowed, true);
  assert.deepEqual(boundaryResult.findings, []);
  assert.equal(scanResult.allowed, true);
  assert.equal(assertAcceptanceCompatibility(acceptanceGuard), true);
  assert.equal(assertReviewGateCompatibility(reviewGate), true);
  assert.equal(reviewGate.queryName, 'createNonGoalLiveConsumerCompatibilityReviewGate');
  assert.equal(
    reviewGate.artifactFamily,
    'site-capability-graph-non-goal-live-consumer-compatibility-review-gate',
  );
  assert.equal(reviewGate.redactionRequired, true);
  assert.equal(item.guardMode ?? item.reviewMode ?? item.contractMode, 'descriptor-only');
  assert.equal(item.result, 'blocked');
  assert.equal(item.reasonCode, 'non-goal-runtime-boundary-disabled');
  assert.ok(sourceAcceptance, 'source live consumer acceptance safe summary is required');
  assert.equal(sourceAcceptance.queryName, acceptanceGuard.queryName);
  assert.equal(sourceAcceptance.artifactFamily, acceptanceGuard.artifactFamily);
  assert.equal(sourceAcceptance.redactionRequired, true);
  assert.equal(sourceAcceptance.guardMode, acceptanceGuard.items[0].guardMode);
  assert.equal(sourceAcceptance.result, acceptanceGuard.items[0].result);
  assert.equal(sourceAcceptance.reasonCode, acceptanceGuard.items[0].reasonCode);
  assert.equal(
    sourceAcceptance.requiredSourceHandoffGuard,
    'assertNonGoalRuntimeBoundaryHandoffGuardCompatibility',
  );
  assert.equal(
    sourceAcceptance.requiredAcceptanceGuard,
    'assertNonGoalLiveConsumerAcceptanceGuardCompatibility',
  );
  assert.equal(
    item.requiredLiveConsumerAcceptanceGuard
      ?? item.requiredSourceAcceptanceGuard
      ?? item.requiredAcceptanceGuard
      ?? item.requiredGuards?.liveConsumerAcceptanceGuard
      ?? item.requiredGuards?.acceptanceGuard,
    'assertNonGoalLiveConsumerAcceptanceGuardCompatibility',
  );
  assert.equal(
    item.requiredCompatibilityReviewGate
      ?? item.requiredReviewGate
      ?? item.requiredGuards?.compatibilityReviewGate
      ?? item.requiredGuards?.reviewGate,
    'assertNonGoalLiveConsumerCompatibilityReviewGateCompatibility',
  );

  for (const flagName of [
    'runtimeConsumerEnabled',
    'liveConsumerEnabled',
    'consumerEnabled',
    'callbackEnabled',
    'handlerEnabled',
    'siteAdapterInvocationEnabled',
    'downloaderInvocationEnabled',
    'sessionViewEnabled',
    'repoWriteEnabled',
    'docsWriteEnabled',
    'runtimeWriteEnabled',
    'runtimeArtifactWriteEnabled',
    'artifactWriteEnabled',
    'externalTelemetryEnabled',
    'externalDispatchEnabled',
    'telemetryDispatchEnabled',
    'statusPromotionEnabled',
    'statusPromotionAllowed',
    'verifiedPromotionEnabled',
    'verifiedPromotionAllowed',
    'livePromotionEnabled',
    'livePromotionAllowed',
    'runtimeProducerEnabled',
    'runtimeSubscriberEnabled',
    'producerEnabled',
    'subscriberEnabled',
    'writeEnabled',
    'executionEnabled',
    'runtimeExecutionEnabled',
    'graphExecutionEnabled',
    'materializationEnabled',
    'sessionMaterializationEnabled',
  ]) {
    if (Object.hasOwn(item, flagName)) {
      assert.equal(item[flagName], false, flagName);
    }
  }

  for (const runtimeField of [
    'runtimeConsumer',
    'consumer',
    'callback',
    'onAccept',
    'handler',
    'siteAdapter',
    'downloader',
    'SessionView',
    'sessionView',
    'repoWrite',
    'docsWrite',
    'runtimeWrite',
    'writePath',
    'repoPath',
    'docsPath',
    'runtimeArtifact',
    'externalTelemetry',
    'externalDispatch',
    'telemetryDispatch',
    'statusPromotion',
    'verifiedPromotion',
    'livePromotion',
    'cookie',
    'Authorization',
    'token',
    'sessionId',
    'browserProfile',
    'csrfToken',
    'SESSDATA',
  ]) {
    assert.equal(Object.hasOwn(item, runtimeField), false, runtimeField);
    assert.equal(Object.hasOwn(sourceAcceptance, runtimeField), false, runtimeField);
  }

  const rendered = JSON.stringify(reviewGate);
  assert.doesNotMatch(rendered, /synthetic-secret-value/u);
  assert.doesNotMatch(rendered, /"runtimeConsumer"\s*:|"consumer"\s*:|"callback"\s*:|"handler"\s*:/u);
  assert.doesNotMatch(rendered, /"siteAdapter"\s*:|"downloader"\s*:|"SessionView"\s*:|"sessionView"\s*:/u);
  assert.doesNotMatch(rendered, /"repoWrite"\s*:|"docsWrite"\s*:|"runtimeWrite"\s*:|"writePath"\s*:/u);
  assert.doesNotMatch(rendered, /"externalTelemetry"\s*:|"externalDispatch"\s*:|"telemetryDispatch"\s*:/u);
  assert.doesNotMatch(rendered, /"statusPromotion"\s*:|"verifiedPromotion"\s*:|"livePromotion"\s*:/u);
  assert.doesNotMatch(rendered, /Authorization|Bearer|cookie|token|sessionId|browserProfile|csrfToken|SESSDATA/iu);
});

test('NonGoalsBoundary live consumer compatibility review gate rejects live runtime, writes, telemetry, promotion, and sensitive material', () => {
  const { create: createHandoffGuard } = loadNonGoalRuntimeBoundaryHandoffGuardApi();
  const { create: createAcceptanceGuard } = loadNonGoalLiveConsumerAcceptanceGuardApi();
  const {
    create: createReviewGate,
    assertCompatibility: assertReviewGateCompatibility,
  } = loadNonGoalLiveConsumerCompatibilityReviewGateApi();
  const descriptor = {
    owner: 'CapabilityService',
    responsibilities: [
      'classify blocked non-goal states as manual recovery descriptors',
      'record compatibility review as blocked without live consumers or runtime promotion',
    ],
    payload: {
      riskState: 'captcha_required',
      result: 'blocked',
      reasonCode: 'non-goal-runtime-boundary-disabled',
      action: 'manual_recovery_required',
      manualRecoveryRequired: true,
    },
  };
  const handoffGuard = createHandoffGuard({
    boundary: descriptor,
    guardName: 'synthetic-non-goal-review-rejection-source-handoff-guard',
  });
  const acceptanceGuard = createAcceptanceGuard(handoffGuard, {
    guardName: 'synthetic-non-goal-review-rejection-source-acceptance-guard',
  });

  const unexpectedlyAccepted = [];
  for (const { name, options, pattern } of [
    {
      name: 'runtimeConsumerEnabled',
      options: { runtimeConsumerEnabled: true },
      pattern: /runtimeConsumerEnabled must remain false|runtimeConsumerEnabled must be false|runtime field|live consumer/i,
    },
    {
      name: 'callback',
      options: { callback: 'synthetic-secret-value' },
      pattern: /callback|descriptor-only|runtime field|live consumer/i,
    },
    {
      name: 'handler',
      options: { handler: { execute: 'synthetic-secret-value' } },
      pattern: /handler|descriptor-only|runtime field|live consumer/i,
    },
    {
      name: 'siteAdapter',
      options: { siteAdapter: { execute: 'synthetic-secret-value' } },
      pattern: /siteAdapter|descriptor-only|runtime field|live consumer/i,
    },
    {
      name: 'downloader',
      options: { downloader: { execute: 'synthetic-secret-value' } },
      pattern: /downloader|descriptor-only|runtime field|live consumer/i,
    },
    {
      name: 'SessionView',
      options: { SessionView: { sessionId: 'synthetic-secret-value' } },
      pattern: /SessionView|sessionView|descriptor-only|runtime field|raw sensitive material/i,
    },
    {
      name: 'sessionView',
      options: { sessionView: { sessionId: 'synthetic-secret-value' } },
      pattern: /sessionView|descriptor-only|runtime field|raw sensitive material/i,
    },
    {
      name: 'repoWrite',
      options: { repoWrite: { path: 'repo/synthetic-secret-value.json' } },
      pattern: /repoWrite|repoPath|descriptor-only|write|runtime field/i,
    },
    {
      name: 'docsWriteEnabled',
      options: { docsWriteEnabled: true },
      pattern: /docsWriteEnabled must remain false|docsWriteEnabled must be false|runtime field|write/i,
    },
    {
      name: 'runtimeWrite',
      options: { runtimeWrite: { path: 'runs/synthetic-secret-value.json' } },
      pattern: /runtimeWrite|runtimeArtifact|descriptor-only|write|runtime field/i,
    },
    {
      name: 'externalTelemetry',
      options: { externalTelemetry: { Authorization: 'Bearer synthetic-secret-value' } },
      pattern: /externalTelemetry|Authorization|descriptor-only|runtime field|forbidden sensitive pattern/i,
    },
    {
      name: 'externalDispatch',
      options: { externalDispatch: { url: 'https://example.invalid/synthetic-secret-value' } },
      pattern: /externalDispatch|dispatch|descriptor-only|runtime field|telemetry/i,
    },
    {
      name: 'statusPromotionAllowed',
      options: { statusPromotionAllowed: true },
      pattern: /statusPromotionAllowed must remain false|statusPromotionAllowed must be false|promotion|runtime field/i,
    },
    {
      name: 'verifiedPromotionEnabled',
      options: { verifiedPromotionEnabled: true },
      pattern: /verifiedPromotionEnabled must remain false|verifiedPromotionEnabled must be false|promotion|runtime field/i,
    },
    {
      name: 'livePromotionAllowed',
      options: { livePromotionAllowed: true },
      pattern: /livePromotionAllowed must remain false|livePromotionAllowed must be false|promotion|runtime field/i,
    },
    {
      name: 'cookie',
      options: { cookie: 'synthetic-secret-value' },
      pattern: /cookie|descriptor-only|runtime field|raw sensitive material|forbidden sensitive pattern/i,
    },
    {
      name: 'Authorization',
      options: { Authorization: 'Bearer synthetic-secret-value' },
      pattern: /Authorization|descriptor-only|runtime field|forbidden sensitive pattern/i,
    },
    {
      name: 'csrfToken',
      options: { csrfToken: 'synthetic-secret-value' },
      pattern: /csrfToken|descriptor-only|runtime field|raw sensitive material|forbidden sensitive pattern/i,
    },
    {
      name: 'SESSDATA',
      options: { SESSDATA: 'synthetic-secret-value' },
      pattern: /SESSDATA|sessdata|descriptor-only|runtime field|raw sensitive material|forbidden sensitive pattern/i,
    },
    {
      name: 'token',
      options: { token: 'synthetic-secret-value' },
      pattern: /token|descriptor-only|runtime field|raw sensitive material|forbidden sensitive pattern/i,
    },
    {
      name: 'sessionId',
      options: { sessionId: 'synthetic-secret-value' },
      pattern: /sessionId|descriptor-only|runtime field|raw sensitive material|forbidden sensitive pattern/i,
    },
    {
      name: 'browserProfile',
      options: { browserProfile: 'synthetic-secret-value' },
      pattern: /browserProfile|descriptor-only|runtime field|raw sensitive material|forbidden sensitive pattern/i,
    },
  ]) {
    let message;
    try {
      createReviewGate(acceptanceGuard, {
        guardName: 'synthetic-non-goal-live-consumer-compatibility-review-gate',
        ...options,
      });
      unexpectedlyAccepted.push(name);
      continue;
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    assert.match(message, pattern, name);
    assert.doesNotMatch(message, /synthetic-secret-value/u, name);
    assert.doesNotMatch(message, /Bearer synthetic-secret-value/u, name);
  }
  assert.deepEqual(unexpectedlyAccepted, []);

  const unsafeGate = createReviewGate(acceptanceGuard, {
    guardName: 'synthetic-non-goal-live-consumer-compatibility-review-gate',
  });
  unsafeGate.items[0].externalDispatchEnabled = true;
  assert.throws(
    () => assertReviewGateCompatibility(unsafeGate),
    /externalDispatchEnabled must be false|externalDispatchEnabled must remain false|runtime field|dispatch/u,
  );
  unsafeGate.items[0].externalDispatchEnabled = false;
  unsafeGate.items[0].SessionView = { sessionId: 'synthetic-secret-value' };
  const compatibilityMessage = captureThrownMessage(() => assertReviewGateCompatibility(unsafeGate));
  assert.match(compatibilityMessage, /SessionView|sessionView|descriptor-only|runtime field|raw sensitive material/i);
  assert.doesNotMatch(compatibilityMessage, /synthetic-secret-value/u);
});

test('NonGoalsBoundary fails closed for unknown owners and malformed import descriptors', () => {
  assert.throws(
    () => scanNonGoalBoundary({
      owner: 'UnknownLayer',
      responsibility: 'schema gate',
    }),
    /Unknown NonGoalsBoundary owner/u,
  );

  const result = scanNonGoalBoundary({
    owner: 'Kernel',
    responsibility: 'schema gate',
    imports: [{}],
  });

  assert.equal(result.allowed, false);
  assert.deepEqual(result.findings.map((finding) => finding.rule), ['invalid-import-descriptor']);
});
