import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';

import {
  BUILD_SCHEMA_VERSION,
  FORCED_DISABLED_ACTIONS,
  RISK_LEVEL_DEFAULTS,
  applyRiskDefaults,
  buildCapabilitySafeRemediationPath,
  createEmptySkillRegistry,
  createSiteForgeOutputValidationReport,
  findForcedDisabledActions,
  inferCapabilityRiskLevel,
  lookupSkillIntent,
  normalizeEvidenceObject,
  runSiteForgeBuild,
  upsertSkillRegistryRecord,
  validateCapabilitySafeRemediationPath,
  validateExecutionPlanAgainstRiskPolicy,
  validateCapabilitySafetyForVerification,
} from '../../src/app/pipeline/build/index.mjs';
import { pathExists } from '../../src/infra/io.mjs';
import {
  simpleShopRoutes,
  testRobotsTxt,
  withTestSite,
} from './helpers/test-site-server.mjs';
import {
  selectSiteForgePrimaryReason,
} from '../../src/app/pipeline/build/output-validation.mjs';

const NOW = '2026-05-16T00:00:00.000Z';

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

test('page reconciliation failure takes priority over crawl warning reasons', () => {
  const reason = selectSiteForgePrimaryReason([
    { reasonCode: 'network-fetch-failed' },
    { reasonCode: 'page-reconciliation-failed' },
  ]);
  assert.equal(reason.reasonCode, 'page-reconciliation-failed');
  assert.equal(reason.failureClass, 'validation');
});

test('external access boundaries take priority over page reconciliation failures', () => {
  const robotsReason = selectSiteForgePrimaryReason([
    { reasonCode: 'page-reconciliation-failed' },
    { reasonCode: 'robots-disallowed' },
  ]);
  assert.equal(robotsReason.reasonCode, 'robots-disallowed');

  const challengeReason = selectSiteForgePrimaryReason([
    { reasonCode: 'page-reconciliation-failed' },
    { reasonCode: 'anti-crawl-verify' },
  ]);
  assert.equal(challengeReason.reasonCode, 'anti-crawl-verify');
  assert.equal(challengeReason.failureClass, 'risk');
});

function createValidationFixture() {
  const evidence = [normalizeEvidenceObject({ type: 'url', source: 'http://127.0.0.1/simple-shop', confidence: 1 })];
  const context = {
    schemaVersion: BUILD_SCHEMA_VERSION,
    buildId: 'validation-live-build',
    startedAt: NOW,
    cwd: path.resolve('.'),
    artifactDir: path.join(os.tmpdir(), 'siteforge-output-validation-artifacts'),
    skillId: 'simple-shop',
    skillDir: path.join(os.tmpdir(), 'siteforge-output-validation-artifacts', 'skill'),
    site: {
      schemaVersion: BUILD_SCHEMA_VERSION,
      id: 'local-test',
      rootUrl: 'http://127.0.0.1/',
      normalizedUrl: 'http://127.0.0.1/',
      allowedDomains: ['127.0.0.1'],
      createdAt: NOW,
      updatedAt: NOW,
    },
    source: {
      type: 'live_website',
      requestedUrl: 'http://127.0.0.1/',
      finalUrl: 'http://127.0.0.1/',
      fetchedAt: NOW,
    },
  };
  const homepage = {
    schemaVersion: BUILD_SCHEMA_VERSION,
    id: 'node:home',
    siteId: context.site.id,
    type: 'page',
    url: 'http://127.0.0.1/',
    normalizedUrl: 'http://127.0.0.1/',
    routePattern: '/',
    title: 'Simple Shop',
    textSummary: 'Simple Shop homepage.',
    classification: 'homepage',
    discoveredBy: 'html_link',
    parentNodeIds: [],
    childNodeIds: ['node:route-home'],
    authRequired: false,
    confidence: 0.95,
    evidence,
  };
  const route = {
    schemaVersion: BUILD_SCHEMA_VERSION,
    id: 'node:route-home',
    siteId: context.site.id,
    type: 'route',
    routePattern: '/',
    title: 'Route /',
    textSummary: 'Homepage route.',
    classification: 'route',
    discoveredBy: 'html_link',
    parentNodeIds: ['node:home'],
    childNodeIds: [],
    authRequired: false,
    confidence: 0.9,
    evidence: [normalizeEvidenceObject({ type: 'url', source: 'https://fixture.local/', text: '/', confidence: 0.9 })],
  };
  const graph = {
    schemaVersion: BUILD_SCHEMA_VERSION,
    buildId: context.buildId,
    site: context.site,
    nodes: [homepage, route],
    edges: [{
      id: 'edge:home-route',
      type: 'has_route_pattern',
      from: homepage.id,
      to: route.id,
      evidence,
    }],
    summary: { nodes: 2, edges: 1, pages: 1 },
  };
  const capabilityId = 'capability:fixture-local:view-homepage';
  const plan = {
    schemaVersion: BUILD_SCHEMA_VERSION,
    id: 'plan:fixture-local:view-homepage',
    capabilityId,
    mode: 'read_only',
    dryRunOnly: false,
    requiresConfirmation: false,
    autoExecute: false,
    steps: [{ kind: 'navigate', url: 'https://fixture.local/', nodeId: homepage.id }],
  };
  const capability = {
    schemaVersion: BUILD_SCHEMA_VERSION,
    id: capabilityId,
    siteId: context.site.id,
    name: 'view homepage',
    description: 'Open the public homepage.',
    action: 'view',
    object: 'homepage',
    userValue: 'Inspect the public homepage.',
    entryNodeIds: [homepage.id],
    requiredNodeIds: [],
    inputs: [],
    outputs: [{ name: 'page', type: 'html' }],
    safetyLevel: 'read_only',
    executionPlan: plan,
    evidence,
    confidence: 0.95,
    status: 'active',
    informational: false,
    authRequired: false,
    sourceLayer: 'public',
    requiredEvidenceLevel: 'public_verified',
    observedEvidenceLevel: 'public_verified',
    evidenceMatrix: {
      capabilityId,
      authRequired: false,
      requiredEvidenceLevel: 'public_verified',
      observedEvidenceLevel: 'public_verified',
      sourceLayer: 'public',
      requiredEvidence: ['source_node_present', 'public_route_accessible', 'sanitized_evidence_present', 'risk_policy_passed'],
      observedEvidence: ['source_node_present', 'public_route_accessible', 'sanitized_evidence_present', 'risk_policy_passed'],
      missingEvidence: [],
      activationDecision: 'active',
    },
  };
  const intent = {
    schemaVersion: BUILD_SCHEMA_VERSION,
    id: 'intent:fixture-local:view-homepage',
    capabilityId,
    skillId: context.skillId,
    name: 'view homepage',
    description: 'Open the public homepage.',
    canonicalUtterance: 'view homepage',
    utteranceExamples: ['view homepage', 'open the homepage'],
    negativeExamples: ['delete my account'],
    slots: [],
    safetyLevel: 'read_only',
    invocationScore: 0.9,
    evidence,
  };
  const registry = upsertSkillRegistryRecord(createEmptySkillRegistry(NOW), {
    skillId: context.skillId,
    siteId: context.site.id,
    domains: context.site.allowedDomains,
    skillDir: '.siteforge/sites/fixture-local/builds/validation-fixture-build/skill',
    artifactDir: '.siteforge/sites/fixture-local/builds/validation-fixture-build',
    verificationStatus: 'passed',
    intents: [{
      intentId: intent.id,
      name: intent.name,
      capabilityId,
      capabilityName: capability.name,
      capabilityAction: capability.action,
      executionPlanId: plan.id,
      canonicalUtterance: intent.canonicalUtterance,
      utteranceExamples: intent.utteranceExamples,
      safetyLevel: intent.safetyLevel,
      invocationScore: intent.invocationScore,
    }],
  }, NOW);
  const stageResults = {
    discoverSeeds: {
      seeds: [{ normalizedUrl: context.site.rootUrl }],
      robots: {
        status: 'parsed',
        source: 'http://127.0.0.1/robots.txt',
        sourceType: 'live_website',
      },
      robotsPolicy: {
        status: 'parsed',
        disallowPaths: [],
        sitemapUrls: [],
      },
    },
    crawlStatic: { pages: [{ normalizedUrl: context.site.rootUrl }], summary: { duplicateRatio: 0 } },
    buildSiteGraph: { graph },
    classifyNodes: { graph: clone(graph) },
    extractAffordances: {
      affordances: [{
        id: 'affordance:route-home',
        nodeId: homepage.id,
        kind: 'route',
        label: 'Homepage route',
        href: '/',
        safety: 'read_only',
        evidence,
        confidence: 0.9,
      }],
    },
    discoverCapabilities: { capabilities: [capability], executionPlans: [plan] },
    generateIntents: { intents: [intent] },
    generateSkill: {
      skillPaths: {
        skillYaml: path.join(context.skillDir, 'skill.yaml'),
        graph: path.join(context.skillDir, 'graph.json'),
        capabilities: path.join(context.skillDir, 'capabilities.json'),
        intents: path.join(context.skillDir, 'intents.json'),
        executionPlans: path.join(context.skillDir, 'execution_plans.json'),
        safetyPolicy: path.join(context.skillDir, 'safety_policy.json'),
        invocationTest: path.join(context.skillDir, 'tests', 'invocation.test.json'),
        dryRunTest: path.join(context.skillDir, 'tests', 'dry_run.test.json'),
      },
    },
  };
  return {
    context,
    stageResults,
    registry,
    invocationProbe: {
      domain: '127.0.0.1',
      utterance: 'view homepage',
    },
  };
}

async function validateFixture(fixture) {
  return await createSiteForgeOutputValidationReport(fixture.context, fixture.stageResults, {
    artifactExists: async () => true,
    candidateRegistry: fixture.registry,
    invocationProbe: fixture.invocationProbe,
    successfulBuild: true,
  });
}

function errorCodes(report) {
  return new Set(report.errorDetails.map((error) => error.code));
}

test('output validation accepts a complete graph, capability map, intents, and registry path', async () => {
  const fixture = createValidationFixture();
  const report = await validateFixture(fixture);

  assert.equal(report.status, 'passed');
  assert.equal(report.gates.nodeCompleteness.homepagePresent, true);
  assert.equal(report.gates.capabilityMap.activeCapabilityCount, 1);
  assert.equal(report.gates.userIntents.intentCount, 1);
  assert.equal(report.gates.registryLookup.status, 'found');
  assert.equal(report.gates.registryLookup.skillId, 'simple-shop');
  assert.equal(report.gates.registryLookup.intentId, 'intent:fixture-local:view-homepage');
  assert.equal(report.gates.registryLookup.capabilityId, 'capability:fixture-local:view-homepage');
  // @ts-ignore
  assert.equal(report.gates.registryLookup.executionPlanId, 'plan:fixture-local:view-homepage');
});

test('output validation accepts active read-only API request execution plans', async () => {
  const fixture = createValidationFixture();
  const capability = fixture.stageResults.discoverCapabilities.capabilities[0];
  const plan = /** @type {any} */ (capability.executionPlan);
  capability.name = 'read API endpoint /api/feed';
  capability.action = 'view';
  capability.object = 'API endpoint';
  capability.userValue = 'Read API endpoint /api/feed.';
  capability.apiReplayVerified = true;
  capability.apiAdapter = {
    candidateRef: '.siteforge/sites/fixture-local/builds/validation-fixture-build/discovery/api-candidates/candidate-0001.json',
    adapterDecisionRef: '.siteforge/sites/fixture-local/builds/validation-fixture-build/discovery/api-adapter-decisions/decision-0001.json',
    replayVerificationRef: '.siteforge/sites/fixture-local/builds/validation-fixture-build/discovery/api-replay-verifications/replay-0001.json',
    method: 'GET',
    redactedEndpoint: 'http://127.0.0.1/api/feed',
    authBoundary: 'none',
    responsePolicy: 'sanitized_summary_only',
  };
  plan.mode = 'limited_read';
  plan.limitedOutputOnly = true;
  plan.responseMaterial = 'sanitized_summary_only';
  plan.steps = [{
    kind: 'api_request',
    method: 'GET',
    endpoint: 'http://127.0.0.1/api/feed',
    autoExecute: false,
    responseMaterial: 'sanitized_summary_only',
  }];

  const report = await validateFixture(fixture);

  assert.equal(report.status, 'passed');
  assert.equal(report.gates.capabilityMap.activeCapabilityCount, 1);
});

test('risk policy defaults encode privacy and forced-disabled action boundaries', () => {
  assert.deepEqual(RISK_LEVEL_DEFAULTS.read_public_low.defaultAction, 'enabled');
  assert.deepEqual(RISK_LEVEL_DEFAULTS.read_personal_medium.defaultAction, 'confirm_or_limited');
  assert.deepEqual(RISK_LEVEL_DEFAULTS.read_private_high.defaultAction, 'disabled_or_confirm_limited');
  assert.deepEqual(RISK_LEVEL_DEFAULTS.write_low.defaultAction, 'draft_only');
  assert.deepEqual(RISK_LEVEL_DEFAULTS.write_high.defaultAction, 'disabled');
  assert.deepEqual(RISK_LEVEL_DEFAULTS.account_security_critical.defaultAction, 'disabled');
  for (const action of [
    'submit',
    'send',
    'delete',
    'pay',
    'checkout',
    'upload',
    'change_password',
    'change_email',
    'change_2fa',
    'change_payment',
    'edit_profile',
    'follow',
    'unfollow',
    'like',
    'repost',
    'publish',
    'publish_reply',
    'send_reply',
    'send_dm',
    'select_sensitive_recipient',
  ]) {
    assert.equal(FORCED_DISABLED_ACTIONS.includes(action), true);
  }
});

test('risk policy recognizes Chinese forced-disabled action labels', () => {
  const cases = [
    ['\u53d1\u5e03', 'publish'],
    ['\u8bc4\u8bba', 'publish_reply'],
    ['\u53d1\u9001\u79c1\u4fe1', 'send_dm'],
    ['\u5220\u9664', 'delete'],
    ['\u4e0a\u4f20', 'upload'],
    ['\u652f\u4ed8', 'pay'],
    ['\u5173\u6ce8', 'follow'],
    ['\u53d6\u5173', 'unfollow'],
    ['\u70b9\u8d5e', 'like'],
    ['\u8f6c\u53d1', 'repost'],
    ['\u4fee\u6539\u5bc6\u7801', 'change_password'],
    ['\u4fee\u6539\u90ae\u7bb1', 'change_email'],
    ['\u4fee\u65392FA', 'change_2fa'],
    ['\u4fee\u6539\u4ed8\u6b3e\u65b9\u5f0f', 'change_payment'],
    ['\u4fee\u6539\u8d44\u6599', 'edit_profile'],
  ];
  for (const [label, action] of cases) {
    assert.equal(findForcedDisabledActions(label).includes(action), true, `${label} should map to ${action}`);
  }
});

test('risk policy classifies X personal, private, and write surfaces conservatively', () => {
  assert.equal(inferCapabilityRiskLevel({
    action: 'view',
    object: 'recommended timeline',
    name: 'read recommended timeline',
  }), 'read_personal_medium');
  assert.equal(inferCapabilityRiskLevel({
    action: 'view',
    object: 'following timeline',
    name: 'read following timeline',
  }), 'read_personal_medium');
  assert.equal(inferCapabilityRiskLevel({
    action: 'view',
    object: 'bookmark summaries',
    name: 'read bookmarks summary',
  }), 'read_personal_medium');
  assert.equal(inferCapabilityRiskLevel({
    action: 'view',
    object: 'notification body',
    name: 'read notification body',
  }), 'read_private_high');
  assert.equal(inferCapabilityRiskLevel({
    action: 'view',
    object: 'bookmarked post body',
    name: 'read bookmarked post body',
    safetyLevel: 'requires_confirmation',
    risk_level: 'read_private_high',
  }), 'read_private_high');
  assert.equal(inferCapabilityRiskLevel({
    action: 'create',
    object: 'direct message draft',
    name: 'create direct message draft',
    safetyLevel: 'requires_confirmation',
  }), 'write_high');
  assert.equal(inferCapabilityRiskLevel({
    action: 'create',
    object: 'reply draft',
    name: 'create reply draft',
    safetyLevel: 'requires_confirmation',
  }), 'write_low');
});

test('risk defaults separate limited sensitive reads, confirmation gates, and disabled private writes', () => {
  const recommended = applyRiskDefaults({
    id: 'capability:x:recommended',
    siteId: 'x',
    name: 'read recommended timeline',
    action: 'view',
    object: 'recommended timeline',
    status: 'active',
    safetyLevel: 'read_only',
    evidence: [normalizeEvidenceObject({ type: 'url', source: 'https://x.com/home' })],
  }, {
    riskLevel: 'read_personal_medium',
    privacy: 'limited',
  });
  assert.equal(recommended.risk_level, 'read_personal_medium');
  assert.equal(recommended.enabled_status, 'limited_enabled');
  assert.equal(recommended.default_policy, 'limited_enabled');

  const followers = applyRiskDefaults({
    id: 'capability:x:followers',
    siteId: 'x',
    name: 'read followers',
    action: 'view',
    object: 'followers',
    status: 'active',
    safetyLevel: 'read_only',
    evidence: [normalizeEvidenceObject({ type: 'url', source: 'https://x.com/example/followers' })],
  }, {
    riskLevel: 'read_personal_medium',
    privacy: 'limited',
    enabledStatus: 'confirmation_required',
    defaultPolicy: 'confirmation_required',
  });
  assert.equal(followers.enabled_status, 'confirmation_required');
  assert.equal(followers.default_policy, 'confirmation_required');

  const dmDraft = applyRiskDefaults({
    id: 'capability:x:dm-draft',
    siteId: 'x',
    name: 'create direct message draft',
    action: 'create',
    object: 'direct message draft',
    status: 'active',
    safetyLevel: 'requires_confirmation',
    executionPlan: {
      id: 'plan:x:dm-draft',
      capabilityId: 'capability:x:dm-draft',
      mode: 'dry_run',
      dryRunOnly: true,
      requiresConfirmation: true,
      autoExecute: false,
      steps: [],
    },
    evidence: [normalizeEvidenceObject({ type: 'url', source: 'https://x.com/messages' })],
  }, {
    riskLevel: 'write_high',
  });
  assert.equal(dmDraft.status, 'disabled');
  assert.equal(dmDraft.enabled_status, 'disabled');
  assert.equal(dmDraft.executionPlan, undefined);

  const videoDownload = applyRiskDefaults({
    id: 'capability:jable:download-content',
    siteId: 'jable.tv',
    name: 'download video content',
    action: 'download',
    object: 'video media',
    status: 'active',
    safetyLevel: 'requires_confirmation',
    executionPlan: {
      id: 'plan:jable:download-content',
      capabilityId: 'capability:jable:download-content',
      mode: 'dry_run',
      dryRunOnly: true,
      requiresConfirmation: true,
      autoExecute: false,
      steps: [],
    },
    evidence: [normalizeEvidenceObject({ type: 'url', source: 'https://jable.tv/videos/abc-001/' })],
  }, {
    riskLevel: 'download_high',
  });
  assert.equal(RISK_LEVEL_DEFAULTS.download_high.enabled, false);
  assert.equal(videoDownload.risk_level, 'download_high');
  assert.equal(videoDownload.status, 'disabled');
  assert.equal(videoDownload.enabled_status, 'disabled');
  assert.equal(videoDownload.default_policy, 'disabled');
  assert.equal(videoDownload.riskPolicy.safetyLevel, 'destructive');
  assert.equal(videoDownload.executionPlan, undefined);
});

test('risk validation rejects sensitive recipient selection inside draft plans', () => {
  const errors = validateExecutionPlanAgainstRiskPolicy({
    id: 'capability:x:draft-reply',
    siteId: 'x',
    name: 'create reply draft',
    action: 'create',
    object: 'reply draft',
    risk_level: 'write_low',
    safetyLevel: 'requires_confirmation',
    status: 'active',
    executionPlan: {
      mode: 'dry_run',
      dryRunOnly: true,
      requiresConfirmation: true,
      autoExecute: false,
      steps: [{
        kind: 'draft_preview',
        submit: false,
        finalSubmit: false,
        selectSensitiveRecipient: true,
      }],
    },
  });
  assert.equal(errors.some((error) => error.code === 'capability.forced_action_execution_blocked'), true);
});

test('risk validation blocks delete upload follow DM and account-security plan aliases', () => {
  const errors = validateExecutionPlanAgainstRiskPolicy({
    id: 'capability:x:misclassified-read',
    siteId: 'x',
    name: 'misclassified read',
    action: 'view',
    object: 'homepage',
    status: 'active',
    safetyLevel: 'read_only',
    executionPlan: {
      id: 'plan:x:misclassified-read',
      mode: 'read_only',
      autoExecute: false,
      steps: [
        { kind: 'inspect', deleteAccount: true },
        { kind: 'inspect', upload: true },
        { kind: 'inspect', follow: true },
        { kind: 'inspect', sendDm: true },
        { kind: 'inspect', changePassword: true },
      ],
    },
  });
  const forced = errors.find((error) => error.code === 'capability.forced_action_execution_blocked');
  assert.ok(forced);
  assert.deepEqual(forced.forcedDisabledActions, [
    'change_password',
    'delete',
    'follow',
    'send_dm',
    'upload',
  ]);
});

test('risk validation rejects unsafe remediation plans without exposing raw material', async () => {
  const fixture = createValidationFixture();
  const capability = fixture.stageResults.discoverCapabilities.capabilities[0];
  capability.remediationPlan = {
    mode: 'repair',
    rawMaterialAllowed: true,
    privateContentAllowed: true,
    steps: [{
      kind: 'follow',
      follow: true,
      savedMaterial: 'private_message_body',
    }],
  };

  const directErrors = validateExecutionPlanAgainstRiskPolicy(capability);
  assert.equal(directErrors.some((error) => error.code === 'capability.forced_action_execution_blocked'), true);
  assert.equal(directErrors.some((error) => error.code === 'capability.plan_material_privacy_policy_invalid'), true);

  const report = await validateFixture(fixture);
  const codes = errorCodes(report);
  const serialized = JSON.stringify(report);
  assert.equal(report.status, 'failed');
  assert.equal(codes.has('capability.forced_action_execution_blocked'), true);
  assert.equal(codes.has('capability.plan_material_privacy_policy_invalid'), true);
  assert.equal(report.gates.safety.passed, false);
  assert.equal(serialized.includes('raw-secret'), false);
  assert.equal(serialized.includes('private message body text'), false);
});

test('output validation requires capability evidence to be sanitized summary only', async () => {
  const fixture = createValidationFixture();
  delete fixture.stageResults.discoverCapabilities.capabilities[0].evidence[0].saved_material;

  const report = await validateFixture(fixture);
  const codes = errorCodes(report);

  assert.equal(report.status, 'failed');
  assert.equal(codes.has('capability.evidence_privacy_policy_invalid'), true);
  assert.equal(report.gates.safety.passed, false);
  assert.equal(report.errorDetails.some((error) => (
    error.expectedSavedMaterial === 'sanitized_summary_only'
    && error.evidencePolicyCode === 'invalid_saved_material'
  )), true);
});

test('output validation keeps disabled high-risk capabilities visible and non-executable', async () => {
  const fixture = createValidationFixture();
  const disabledCapability = {
    schemaVersion: BUILD_SCHEMA_VERSION,
    id: 'capability:fixture-local:disabled-checkout-action',
    siteId: fixture.context.site.id,
    name: 'disabled checkout action',
    description: 'Checkout is visible but disabled by policy.',
    action: 'purchase',
    object: 'checkout',
    userValue: 'Do not checkout.',
    entryNodeIds: ['node:home'],
    requiredNodeIds: ['node:home'],
    inputs: [],
    outputs: [{ name: 'blocked_action', type: 'safety_boundary' }],
    safetyLevel: 'payment',
    evidence: fixture.stageResults.discoverCapabilities.capabilities[0].evidence,
    confidence: 0.4,
    status: 'disabled',
    informational: true,
  };
  // @ts-ignore
  fixture.stageResults.discoverCapabilities.capabilities.push(disabledCapability);

  const report = await validateFixture(fixture);

  assert.equal(report.status, 'passed');
  assert.equal(report.gates.capabilityMap.capabilityCount, 2);
  assert.equal(report.gates.capabilityMap.disabledCapabilityCount, 1);
  assert.equal(report.gates.capabilityMap.riskPolicy.write_high, 1);
  assert.equal(report.gates.capabilityMap.safeRemediation.total >= 1, true);
  assert.equal(report.gates.capabilityMap.safeRemediation.canAutoPrepare, 0);
  assert.equal(report.gates.safety.disabledHighRiskCapabilityCount, 1);

  const remediation = buildCapabilitySafeRemediationPath(disabledCapability);
  assert.equal(remediation.path, 'user_mediated_safe_action_path');
  assert.equal(remediation.canAutoPrepare, false);
  assert.equal(remediation.resultingStatus, 'confirmation_required');
});

test('safe remediation model rejects high-risk write auto-prepare', async () => {
  const fixture = createValidationFixture();
  const disabledCapability = {
    schemaVersion: BUILD_SCHEMA_VERSION,
    id: 'capability:fixture-local:disabled-send-action',
    siteId: fixture.context.site.id,
    name: 'disabled send action',
    action: 'send',
    object: 'message',
    safetyLevel: 'destructive',
    evidence: fixture.stageResults.discoverCapabilities.capabilities[0].evidence,
    status: 'disabled',
    enabled_status: 'disabled',
    safe_remediation: {
      path: 'draft_only_preview',
      canAutoPrepare: true,
      resultingStatus: 'enabled',
      writeActionsEnabled: true,
      rawMaterialAllowed: false,
      privateContentAllowed: false,
    },
  };

  // @ts-ignore
  const directErrors = validateCapabilitySafeRemediationPath(disabledCapability, disabledCapability.safe_remediation);
  assert.equal(directErrors.some((error) => error.code === 'capability.safe_remediation_high_risk_write_auto_prepare'), true);
  assert.equal(directErrors.some((error) => error.code === 'capability.safe_remediation_resulting_status_enabled'), true);
  assert.equal(directErrors.some((error) => error.code === 'capability.safe_remediation_privacy_boundary_invalid'), true);

  // @ts-ignore
  fixture.stageResults.discoverCapabilities.capabilities.push(disabledCapability);
  const report = await validateFixture(fixture);
  const codes = errorCodes(report);
  assert.equal(report.status, 'failed');
  assert.equal(codes.has('capability.safe_remediation_high_risk_write_auto_prepare'), true);
  assert.equal(codes.has('capability.safe_remediation_resulting_status_enabled'), true);
  assert.equal(codes.has('capability.safe_remediation_privacy_boundary_invalid'), true);
});

test('output validation rejects active or planned forced-disabled actions', async () => {
  const fixture = createValidationFixture();
  const capability = fixture.stageResults.discoverCapabilities.capabilities[0];
  capability.name = 'checkout now';
  capability.action = 'purchase';
  capability.object = 'checkout';
  capability.safetyLevel = 'payment';
  capability.executionPlan.mode = 'live';
  capability.executionPlan.steps[0].kind = 'checkout';
  fixture.stageResults.generateIntents.intents[0].safetyLevel = 'payment';

  const report = await validateFixture(fixture);
  const codes = errorCodes(report);

  assert.equal(report.status, 'failed');
  assert.equal(codes.has('capability.risk_policy_active_disabled'), true);
  assert.equal(codes.has('capability.forced_action_execution_blocked'), true);
  assert.equal(report.gates.safety.passed, false);
});

test('output validation redacts raw setup hints in validation details', async () => {
  const fixture = createValidationFixture();
  fixture.context.setupProfile = {
    userHints: ['private timeline access_token=synthetic-raw-hint-token'],
    userIntentCoverage: {
      supportedRequests: [],
      unsupportedRequests: [{
        hint: 'private timeline access_token=synthetic-raw-hint-token',
        label: 'private unsupported label',
      }],
      unmatchedRequests: [{
        hint: 'private timeline access_token=synthetic-raw-hint-token',
      }],
    },
    capabilityScope: {
      selectedCapabilities: [],
      disabledCapabilities: [],
    },
  };

  const report = await validateFixture(fixture);
  const reportText = JSON.stringify(report);
  assert.equal(report.status, 'failed');
  assert.equal(reportText.includes('synthetic-raw-hint-token'), false);
  assert.equal(reportText.includes('access_token='), false);
  assert.equal(reportText.includes('private unsupported label'), false);
  assert.equal(reportText.includes('redacted-user-hint'), true);
});

test('output validation rejects nodes without evidence or discoveredBy and missing edge endpoints', async () => {
  const fixture = createValidationFixture();
  fixture.stageResults.classifyNodes.graph.nodes[0].evidence = /** @type {any[]} */ ([]);
  delete fixture.stageResults.classifyNodes.graph.nodes[0].discoveredBy;
  fixture.stageResults.classifyNodes.graph.edges[0].to = 'node:missing';

  const report = await validateFixture(fixture);
  const codes = errorCodes(report);

  assert.equal(report.status, 'failed');
  assert.equal(codes.has('classified_graph.json.node_missing_discovered_by'), true);
  assert.equal(codes.has('classified_graph.json.node_missing_evidence'), true);
  assert.equal(codes.has('classified_graph.json.edge_missing_node'), true);
  assert.equal(report.errors.some((error) => /missing evidence/u.test(error)), true);
  assert.equal(report.errors.some((error) => /missing discoveredBy/u.test(error)), true);
  assert.equal(report.errors.some((error) => /references a missing node/u.test(error)), true);
});

test('output validation rejects evidence-free, source-free, or unplanned active capabilities', async () => {
  const fixture = createValidationFixture();
  const capability = fixture.stageResults.discoverCapabilities.capabilities[0];
  capability.evidence = /** @type {any[]} */ ([]);
  capability.entryNodeIds = /** @type {any[]} */ ([]);
  capability.executionPlan = null;
  fixture.stageResults.discoverCapabilities.executionPlans = /** @type {any[]} */ ([]);

  const report = await validateFixture(fixture);
  const codes = errorCodes(report);

  assert.equal(report.status, 'failed');
  assert.equal(codes.has('capability.active_missing_evidence'), true);
  assert.equal(codes.has('capability.active_missing_source_nodes'), true);
  assert.equal(codes.has('capability.actionable_missing_plan'), true);
  assert.equal(report.errors.some((error) => /lacks evidence/u.test(error)), true);
  assert.equal(report.errors.some((error) => /lacks source nodes/u.test(error)), true);
  assert.equal(report.errors.some((error) => /lacks executionPlan/u.test(error)), true);
});

test('output validation rejects active known-site capabilities without capability-specific proof', async () => {
  const fixture = createValidationFixture();
  const capability = fixture.stageResults.discoverCapabilities.capabilities[0];
  capability.requiresCapabilityEvidence = true;
  capability.capabilityVerified = false;
  capability.setupCapabilityId = 'list-followed-users';

  const report = await validateFixture(fixture);
  const codes = errorCodes(report);

  assert.equal(report.status, 'failed');
  assert.equal(report.reasonCode, 'capability-evidence-required');
  assert.equal(codes.has('capability.active_lacks_capability_specific_evidence'), true);
});

test('output validation rejects selected setup capabilities left as candidates', async () => {
  const fixture = createValidationFixture();
  fixture.context.setupProfile = {
    capabilityScope: {
      selectedCapabilities: [{
        id: 'list-followed-users',
        name: 'List followed users',
        evidenceRequirement: 'capability-specific-evidence',
      }],
    },
  };
  const candidate = clone(fixture.stageResults.discoverCapabilities.capabilities[0]);
  candidate.id = 'capability:fixture-local:list-followed-users';
  candidate.name = 'list followed users';
  candidate.status = 'candidate';
  candidate.setupCapabilityId = 'list-followed-users';
  candidate.executionPlan = null;
  candidate.activationBlockedReason = 'capability-specific-evidence-required';
  fixture.stageResults.discoverCapabilities.capabilities.push(candidate);

  const report = await validateFixture(fixture);
  const codes = errorCodes(report);

  assert.equal(report.status, 'failed');
  assert.equal(report.reasonCode, 'capability-evidence-required');
  assert.equal(codes.has('capability.selected_not_active'), true);
});

test('output validation allows unselected candidate capabilities when they stay out of intents and registry', async () => {
  const fixture = createValidationFixture();
  const candidate = clone(fixture.stageResults.discoverCapabilities.capabilities[0]);
  candidate.id = 'capability:fixture-local:candidate-network-apis';
  candidate.name = 'capture network APIs';
  candidate.description = 'Candidate network API capture without verification.';
  candidate.action = 'track';
  candidate.object = 'network APIs';
  candidate.status = 'candidate';
  candidate.executionPlan = null;
  candidate.activationBlockedReason = 'capability-candidate';
  fixture.stageResults.discoverCapabilities.capabilities.push(candidate);

  const report = await validateFixture(fixture);
  const registryRecord = fixture.registry.skills.find((skill) => skill.skillId === fixture.context.skillId);
  const registeredCapabilityIds = new Set((registryRecord?.intents ?? []).map((intent) => intent.capabilityId));

  assert.equal(report.status, 'passed');
  assert.equal(report.gates.capabilityMap.capabilityCount, 2);
  assert.equal(report.gates.capabilityMap.activeCapabilityCount, 1);
  assert.equal(registeredCapabilityIds.has(candidate.id), false);
});

test('output validation rejects candidate capabilities with execution plans', async () => {
  const fixture = createValidationFixture();
  const candidate = clone(fixture.stageResults.discoverCapabilities.capabilities[0]);
  candidate.id = 'capability:fixture-local:candidate-network-apis';
  candidate.name = 'capture network APIs';
  candidate.description = 'Candidate network API capture without verification.';
  candidate.action = 'track';
  candidate.object = 'network APIs';
  candidate.status = 'candidate';
  candidate.executionPlan = {
    ...clone(fixture.stageResults.discoverCapabilities.executionPlans[0]),
    id: 'plan:fixture-local:candidate-network-apis',
    capabilityId: candidate.id,
  };
  fixture.stageResults.discoverCapabilities.capabilities.push(candidate);
  fixture.stageResults.discoverCapabilities.executionPlans.push(candidate.executionPlan);

  const report = await validateFixture(fixture);
  const codes = errorCodes(report);

  assert.equal(report.status, 'failed');
  assert.equal(codes.has('capability.inactive_has_plan'), true);
  assert.equal(codes.has('execution_plan.inactive_capability'), true);
});

test('output validation rejects intents and registry lookups for candidate capabilities', async () => {
  const fixture = createValidationFixture();
  const candidate = clone(fixture.stageResults.discoverCapabilities.capabilities[0]);
  candidate.id = 'capability:fixture-local:candidate-network-apis';
  candidate.name = 'capture network APIs';
  candidate.description = 'Candidate network API capture without verification.';
  candidate.action = 'track';
  candidate.object = 'network APIs';
  candidate.status = 'candidate';
  delete candidate.executionPlan;
  fixture.stageResults.discoverCapabilities.capabilities.push(candidate);

  const candidateIntent = {
    ...clone(fixture.stageResults.generateIntents.intents[0]),
    id: 'intent:fixture-local:candidate-network-apis',
    capabilityId: candidate.id,
    name: candidate.name,
    description: candidate.description,
    canonicalUtterance: 'capture network APIs',
    utteranceExamples: ['capture network APIs'],
  };
  fixture.stageResults.generateIntents.intents.push(candidateIntent);

  const registryRecord = fixture.registry.skills.find((skill) => skill.skillId === fixture.context.skillId);
  registryRecord.intents.push({
    intentId: candidateIntent.id,
    name: candidateIntent.name,
    capabilityId: candidate.id,
    capabilityName: candidate.name,
    capabilityAction: candidate.action,
    executionPlanId: null,
    canonicalUtterance: candidateIntent.canonicalUtterance,
    utteranceExamples: candidateIntent.utteranceExamples,
    safetyLevel: candidateIntent.safetyLevel,
    invocationScore: 1,
  });
  fixture.invocationProbe = {
    domain: '127.0.0.1',
    utterance: 'capture network APIs',
  };

  const report = await validateFixture(fixture);
  const codes = errorCodes(report);

  assert.equal(report.status, 'failed');
  assert.equal(codes.has('intent.references_inactive_capability'), true);
  assert.equal(codes.has('registry.lookup_inactive_capability'), true);
  assert.equal(report.gates.registryLookup.capabilityId, candidate.id);
});

test('output validation rejects active capabilities without mapped intent capability', async () => {
  const fixture = createValidationFixture();
  fixture.stageResults.generateIntents.intents = /** @type {any[]} */ ([]);

  const report = await validateFixture(fixture);
  const codes = errorCodes(report);

  assert.equal(report.status, 'failed');
  assert.equal(codes.has('intents.empty'), true);
  assert.equal(codes.has('intent.missing_for_active_capability'), true);
  assert.equal(report.errors.some((error) => /No intent maps to active capability/u.test(error)), true);
});

test('output validation rejects malformed intents and safety mismatches', async () => {
  const fixture = createValidationFixture();
  const intent = fixture.stageResults.generateIntents.intents[0];
  intent.utteranceExamples = /** @type {any[]} */ ([]);
  intent.negativeExamples = /** @type {any[]} */ ([]);
  intent.safetyLevel = 'destructive';

  const report = await validateFixture(fixture);

  assert.equal(report.status, 'failed');
  assert.equal(report.errors.some((error) => /utterance examples/u.test(error)), true);
  assert.equal(report.errors.some((error) => /negative examples/u.test(error)), true);
  assert.equal(report.errors.some((error) => /safetyLevel does not match/u.test(error)), true);
});

test('output validation rejects unsafe high-risk auto execution', async () => {
  const fixture = createValidationFixture();
  const capability = fixture.stageResults.discoverCapabilities.capabilities[0];
  capability.name = 'purchase product';
  capability.action = 'purchase';
  capability.safetyLevel = 'payment';
  capability.executionPlan.mode = 'live';
  capability.executionPlan.autoExecute = true;
  capability.executionPlan.dryRunOnly = false;
  capability.executionPlan.requiresConfirmation = false;
  fixture.stageResults.generateIntents.intents[0].safetyLevel = 'payment';

  const directErrors = validateCapabilitySafetyForVerification(capability);
  assert.equal(directErrors.some((error) => /lacks dry-run or confirmation/u.test(error)), true);
  assert.equal(directErrors.some((error) => /unsafe auto-execution/u.test(error)), true);

  const report = await validateFixture(fixture);
  assert.equal(report.status, 'failed');
  assert.equal(report.errors.some((error) => /unsafe auto-execution/u.test(error)), true);
});

test('output validation rejects auto-executable execution plan steps', async () => {
  const fixture = createValidationFixture();
  const plan = fixture.stageResults.discoverCapabilities.executionPlans[0];
  plan.steps[0].autoExecute = true;

  const report = await validateFixture(fixture);
  const codes = errorCodes(report);

  assert.equal(report.status, 'failed');
  assert.equal(codes.has('execution_plan.step_auto_execute'), true);
  assert.equal(report.gates.safety.passed, false);
  assert.equal(report.errors.some((error) => /auto-execute step/u.test(error)), true);
});

test('output validation rejects registry lookup misses', async () => {
  const fixture = createValidationFixture();
  fixture.registry = createEmptySkillRegistry(NOW);

  const report = await validateFixture(fixture);

  assert.equal(report.status, 'failed');
  assert.equal(report.gates.registryLookup.status, 'not_found');
  assert.equal(report.errors.some((error) => /Registry lookup did not resolve/u.test(error)), true);
});

test('output validation rejects live builds without fetched robots.txt', async () => {
  const fixture = createValidationFixture();
  fixture.context.source = {
    type: 'live_website',
    requestedUrl: 'https://fixture.local/',
    finalUrl: 'https://fixture.local/',
    fetchedAt: NOW,
  };
  fixture.stageResults.discoverSeeds.robots = {
    status: 'unavailable',
    source: 'live_website',
    sourceType: 'robots_txt',
    reason: 'Static fetch failed for https://fixture.local/robots.txt: HTTP 503',
    sitemaps: [],
    processedSitemaps: [],
    disallowPaths: [],
    excludedUrls: [],
  };

  const report = await validateFixture(fixture);
  const codes = errorCodes(report);

  assert.equal(report.status, 'failed');
  assert.equal(codes.has('robots.unavailable'), true);
  assert.equal(report.gates.nodeCompleteness.passed, false);
  assert.equal(report.errors.some((error) => /requires fetched robots\.txt/u.test(error)), true);
});

test('valid local HTTP build writes a verification report with populated gate content', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-output-validation-pass-'));
  try {
    await withTestSite(simpleShopRoutes, async (rootUrl) => {
    const result = await runSiteForgeBuild(rootUrl, {
      cwd: workspace,
      buildId: 'output-validation-pass-build',
      now: new Date(NOW),
      fetchDelayMs: 0,
    });

    const verificationReport = await readJson(path.join(result.artifactDir, 'verification_report.json'));
    const capabilitiesPayload = await readJson(path.join(result.artifactDir, 'capabilities.json'));
    const activeEvidence = capabilitiesPayload.capabilities
      .filter((capability) => capability.status === 'active')
      .flatMap((capability) => capability.evidence ?? []);

    assert.equal(result.status, 'success');
    assert.equal(verificationReport.status, 'passed');
    assert.equal(verificationReport.gates.requiredArtifacts.passed, true);
    assert.equal(verificationReport.gates.requiredArtifacts.checked.includes('skill.yaml'), true);
    assert.equal(verificationReport.gates.requiredArtifacts.finalArtifacts.includes('verification_report.json'), true);
    assert.equal(verificationReport.gates.requiredArtifacts.deferredUntilBuildReport.includes('build_report.json'), true);
    assert.equal(verificationReport.gates.requiredArtifacts.deferredUntilBuildReport.includes('capability_intent_summary.html'), true);
    assert.equal(verificationReport.gates.requiredArtifacts.deferredUntilBuildReport.includes('page_reconciliation_report.json'), true);
    assert.equal(verificationReport.gates.nodeCompleteness.graphExists, true);
    assert.equal(verificationReport.gates.nodeCompleteness.classifiedGraphExists, true);
    assert.equal(verificationReport.gates.nodeCompleteness.edgeRefsValid, true);
    assert.equal(verificationReport.gates.capabilityMap.activeCapabilityCount > 0, true);
    assert.equal(verificationReport.gates.userIntents.intentCount > 0, true);
    assert.equal(verificationReport.gates.safety.highRiskAutoExecutable, false);
    assert.equal(verificationReport.gates.safety.savedMaterial, 'sanitized_summary_only');
    assert.equal(verificationReport.gates.safety.rawContentSaved, false);
    assert.equal(verificationReport.gates.safety.privateContentSaved, false);
    assert.equal(verificationReport.gates.registryLookup.status, 'found');
    assert.equal(verificationReport.gates.registryLookup.skillId, 'simple-shop');
    assert.equal(activeEvidence.length > 0, true);
    assert.equal(activeEvidence.every((item) => (
      ['route', 'structure', 'control', 'adapter', 'network_summary'].includes(item.evidence_source)
      && item.evidence_status
      && item.saved_material === 'sanitized_summary_only'
      && item.raw_content_saved === false
      && item.private_content_saved === false
    )), true);
    assert.deepEqual(verificationReport.errors, []);
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('validation failure preserves artifacts without promoting current skill or registry records', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-output-validation-fail-'));
  try {
    await withTestSite((rootUrl) => ({
      '/robots.txt': { contentType: 'text/plain; charset=utf-8', body: testRobotsTxt(rootUrl, { sitemap: false }) },
    }), async (rootUrl) => {
      let capturedError = /** @type {any} */ (null);
      await assert.rejects(
        async () => runSiteForgeBuild(rootUrl, {
          cwd: workspace,
          buildId: 'empty-build',
          now: new Date(NOW),
          fetchDelayMs: 0,
        }),
        (error) => {
          capturedError = /** @type {any} */ (error);
          return /Static crawl produced no pages/u.test(String(capturedError?.message ?? ''));
        },
      );

      assert.ok(capturedError?.artifactDir);
      assert.equal(await pathExists(path.join(capturedError.artifactDir, 'build_report.json')), true);
      assert.equal(await pathExists(path.join(capturedError.artifactDir, 'reports', 'capability_intent_summary.html')), true);

      const buildReport = await readJson(path.join(capturedError.artifactDir, 'build_report.json'));
      const htmlReport = await readFile(path.join(capturedError.artifactDir, 'reports', 'capability_intent_summary.html'), 'utf8');
      assert.match(htmlReport, /暂无能力和意图|upstream stage failed|上游/u);
      assert.doesNotMatch(htmlReport, /\bcookie\b|\btoken\b|\bauthorization\b|\bbearer\b|synthetic-secret|sessionid=|<script\b/iu);
      assert.equal(buildReport.status, 'blocked');
      assert.equal(buildReport.failedStage, 'crawlStatic');
      assert.equal(buildReport.report_index.capability_intent_summary_html, 'reports/capability_intent_summary.html');
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
