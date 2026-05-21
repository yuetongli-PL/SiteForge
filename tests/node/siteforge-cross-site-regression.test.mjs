import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile, rm } from 'node:fs/promises';

import {
  capabilityInteractionState,
  createEmptySkillRegistry,
  generateAutoCapabilities,
  generateAutoIntentRecords,
  lookupSkillIntentFromRegistry,
  stableCapabilityId,
  upsertSkillRegistryRecord,
  writeCapabilityInteractionDecisions,
  writeCapabilityRemediationPlan,
} from '../../src/app/pipeline/build/index.mjs';
import {
  genericNavigationAdapter,
} from '../../src/sites/adapters/generic-navigation.mjs';

function safeLimitedReadPlan(capabilityId) {
  return {
    id: `plan:${capabilityId.replace(/^capability:/u, '')}`,
    capabilityId,
    mode: 'limited_read',
    autoExecute: false,
    limitedOutputOnly: true,
    savedMaterial: 'sanitized_summary_only',
    steps: [{
      kind: 'read_sanitized_summary',
      autoExecute: false,
      submit: false,
      finalSubmit: false,
      upload: false,
      selectSensitiveRecipient: false,
      limitedOutputOnly: true,
      savedMaterial: 'sanitized_summary_only',
    }],
  };
}

function evidence(source = 'http://127.0.0.1/simple-shop') {
  return [{
    type: 'url',
    source,
    confidence: 1,
  }];
}

function fixtureSensitiveRead(id, overrides = /** @type {any} */ ({})) {
  return {
    id,
    name: 'read saved account summary',
    user_facing_name: '\u8bfb\u53d6\u8d26\u6237\u6458\u8981',
    status: 'active',
    enabled_status: 'confirmation_required',
    default_policy: 'confirmation_required',
    risk_level: 'read_personal_medium',
    riskPolicy: { riskLevel: 'read_personal_medium' },
    evidence_status: 'confirmation_required',
    evidence_sources: ['fixture'],
    source_nodes: ['node:fixture-local:account-summary'],
    evidence: evidence(),
    raw_content_saved: false,
    private_content_saved: false,
    executionPlan: safeLimitedReadPlan(id),
    ...overrides,
  };
}

test('generic adapter redacts sensitive semantic fields for fixture sites', () => {
  const semanticEntry = genericNavigationAdapter.describeApiCandidateSemantics({
    candidate: {
      id: 'candidate:fixture-local:search',
      siteKey: 'generic-navigation',
    },
    semantics: {
      auth: {
        cookie: 'session=synthetic-secret-cookie',
        authorization: 'Bearer synthetic-secret-token',
        csrfToken: 'synthetic-csrf-token',
      },
      fieldMapping: {
        title: 'safe public title',
      },
    },
    scope: {
      host: 'fixture.local',
      userDataDir: 'C:\\Users\\example\\secret-profile',
      query: 'safe',
    },
  });

  assert.equal(semanticEntry.adapterId, 'generic-navigation');
  assert.equal(semanticEntry.siteKey, 'generic-navigation');
  assert.equal(semanticEntry.auth.cookie, '[REDACTED]');
  assert.equal(semanticEntry.auth.authorization, '[REDACTED]');
  assert.equal(semanticEntry.auth.csrfToken, '[REDACTED]');
  assert.equal(semanticEntry.scope.userDataDir, '[REDACTED]');
  assert.equal(semanticEntry.fieldMapping.title, 'safe public title');

  const serialized = JSON.stringify(semanticEntry);
  assert.doesNotMatch(serialized, /synthetic-secret|secret-profile/u);
});

test('fixture-site sensitive reads and safe remediation are not x-only', async () => {
  const siteDir = await mkdtemp(path.join(os.tmpdir(), 'siteforge-cross-site-remediation-'));
  try {
    const safeRead = fixtureSensitiveRead('capability:fixture-local:read-saved-account-summary');
    const disabledSensitiveRead = fixtureSensitiveRead('capability:fixture-local:read-saved-cart-summary', {
      name: 'read saved cart summary',
      user_facing_name: '\u8bfb\u53d6\u8d2d\u7269\u8f66\u6458\u8981',
      status: 'disabled',
      enabled_status: 'disabled',
      default_policy: 'disabled',
      executionPlan: undefined,
    });
    const disabledWrite = {
      id: 'capability:fixture-local:delete-saved-address',
      name: 'delete saved address',
      user_facing_name: '\u5220\u9664\u6536\u8d27\u5730\u5740',
      action: 'delete',
      object: 'saved address',
      status: 'disabled',
      enabled_status: 'disabled',
      default_policy: 'disabled',
      risk_level: 'write_high',
      riskPolicy: { riskLevel: 'write_high' },
      evidence_status: 'disabled',
      evidence_sources: ['fixture'],
      source_nodes: ['node:fixture-local:address-book'],
      evidence: evidence(),
      raw_content_saved: false,
      private_content_saved: false,
    };
    const unverifiedDisabledWrite = {
      id: 'capability:fixture-local:change-account-password',
      name: 'change account password',
      user_facing_name: '\u4fee\u6539\u8d26\u6237\u5bc6\u7801',
      action: 'change_password',
      object: 'account password',
      status: 'disabled',
      enabled_status: 'disabled',
      default_policy: 'disabled',
      risk_level: 'account_security_critical',
      riskPolicy: { riskLevel: 'account_security_critical' },
      evidence_status: 'disabled',
      evidence_sources: [],
      source_nodes: [],
      raw_content_saved: false,
      private_content_saved: false,
    };
    const buildResult = {
      status: 'success',
      build_id: 'fixture-cross-site',
      buildContext: { siteDir },
      user_report: {
        result_status: 'partial_success',
        skill_id: 'simple-shop',
        site: { root_url: 'https://fixture.local/' },
        confirmation_required_capabilities: [safeRead],
        disabled_capabilities: [disabledSensitiveRead, disabledWrite, unverifiedDisabledWrite],
      },
    };

    const state = capabilityInteractionState(buildResult);
    assert.deepEqual(state.safeConfirmable.map((capability) => capability.id), [safeRead.id]);
    assert.equal(state.safeConfirmable[0].confirmation_group, 'sensitive-read');
    assert.equal(state.safeConfirmable[0].confirmation_mode, 'limited');
    assert.equal(state.safeConfirmable[0].executionPlan.savedMaterial, 'sanitized_summary_only');
    assert.equal(state.safeConfirmable[0].raw_content_saved, false);
    assert.equal(state.safeConfirmable[0].private_content_saved, false);

    const remediationById = new Map(state.remediationCandidates.map((capability) => [capability.id, capability]));
    const sensitiveRemediation = remediationById.get(disabledSensitiveRead.id);
    assert.equal(sensitiveRemediation.safe_remediation_path, 'limited_sanitized_summary_path');
    assert.equal(sensitiveRemediation.safe_remediation.canAutoPrepare, true);
    assert.equal(sensitiveRemediation.safe_remediation.immediateLimitedUse, true);
    assert.match(sensitiveRemediation.safe_remediation.label, /\p{Script=Han}/u);
    assert.match(sensitiveRemediation.terminal_remediation.safe_path, /\p{Script=Han}/u);

    const writeRemediation = remediationById.get(disabledWrite.id);
    assert.equal(writeRemediation.safe_remediation_path, 'user_mediated_safe_action_path');
    assert.equal(writeRemediation.safe_remediation.userFinalActionRequired, true);
    assert.equal(writeRemediation.safe_remediation.writeActionsEnabled, false);
    assert.equal(writeRemediation.safe_remediation.finalActionsAllowed, false);
    assert.equal(writeRemediation.safe_remediation.rawMaterialAllowed, false);
    assert.equal(writeRemediation.safe_remediation.privateContentAllowed, false);
    assert.match(writeRemediation.safe_remediation.label, /\p{Script=Han}/u);

    const adapterRemediation = remediationById.get(unverifiedDisabledWrite.id);
    assert.equal(adapterRemediation.safe_remediation_path, 'explicit_external_adapter_path');
    assert.equal(adapterRemediation.safe_remediation.requiresSiteAdapterVerificationBeforeUse, true);
    assert.equal(adapterRemediation.safe_remediation.writeActionsEnabled, false);
    assert.equal(adapterRemediation.safe_remediation.rawMaterialAllowed, false);
    assert.equal(adapterRemediation.safe_remediation.privateContentAllowed, false);
    assert.match(adapterRemediation.safe_remediation.label, /\p{Script=Han}/u);

    const decisions = await writeCapabilityInteractionDecisions(buildResult, state.safeConfirmable, { siteDir });
    assert.equal(decisions.count, 1);
    assert.equal(decisions.decisions[0].mode, 'limited');
    assert.equal(decisions.decisions[0].usablePathType, 'limited_sanitized_summary_path');
    assert.equal(decisions.decisions[0].writeActionsEnabled, false);
    assert.equal(decisions.decisions[0].rawMaterialAllowed, false);
    assert.equal(decisions.decisions[0].privateContentAllowed, false);

    const recorded = await writeCapabilityRemediationPlan(buildResult, state.remediationCandidates, { siteDir });
    assert.equal(recorded.count, 3);
    assert.equal(recorded.summary.limitedSanitizedSummaryPath, 1);
    assert.equal(recorded.summary.userMediatedSafeActionPath, 1);
    assert.equal(recorded.summary.explicitExternalAdapterPath, 1);
    assert.equal(recorded.summary.requiresSiteAdapterVerification, 1);

    const persisted = JSON.parse(await readFile(path.join(siteDir, 'capability_remediation_plan.json'), 'utf8'));
    assert.equal(persisted.skillId, 'simple-shop');
    assert.equal(persisted.safetyBoundary.writeActionsEnabled, false);
    assert.equal(persisted.safetyBoundary.rawMaterialAllowed, false);
    assert.equal(persisted.safetyBoundary.privateContentAllowed, false);
    assert.equal(persisted.plans.every((plan) => /\p{Script=Han}/u.test(plan.pathLabel)), true);
    assert.equal(persisted.plans.some((plan) => plan.pathType === 'limited_sanitized_summary_path'), true);
    assert.equal(persisted.plans.some((plan) => plan.pathType === 'user_mediated_safe_action_path'), true);
    assert.equal(persisted.plans.some((plan) => plan.pathType === 'explicit_external_adapter_path'), true);
  } finally {
    await rm(siteDir, { recursive: true, force: true });
  }
});

test('non-x known-site capability generation filters duplicates and keeps callable intents bounded', () => {
  const context = {
    skillId: 'fixture-social',
    site: {
      id: 'fixture-social-local',
      rootUrl: 'https://fixture-social.local/',
    },
    options: {
      privacy: 'limited',
    },
    setupProfile: {
      knownSitePolicy: {
        siteKey: 'fixture-social',
        adapterId: 'generic-navigation',
      },
    },
  };
  const graph = {
    nodes: [{
      id: 'node:fixture-social:home',
      type: 'page',
      routePattern: '/',
      routeState: {
        source: 'known-social-route-state-model',
        stateId: 'home-for-you',
      },
      evidence: evidence(),
    }],
  };
  const duplicateId = stableCapabilityId(context.site.id, 'read recommended timeline');
  const capabilities = generateAutoCapabilities(context, {
    graph,
    existingCapabilities: [{
      id: duplicateId,
      name: 'read recommended timeline',
    }],
  });

  assert.equal(capabilities.length > 0, true);
  assert.equal(capabilities.some((capability) => capability.id === duplicateId), false);
  assert.equal(new Set(capabilities.map((capability) => capability.id)).size, capabilities.length);

  const following = capabilities.find((capability) => capability.name === 'read following timeline');
  const draft = capabilities.find((capability) => capability.name === 'create post draft');
  const disabledWrite = capabilities.find((capability) => capability.name === 'publish post');
  assert.ok(following);
  assert.ok(draft);
  assert.ok(disabledWrite);
  assert.equal(following.enabled_status, 'limited_enabled');
  assert.equal(following.status, 'active');
  assert.match(following.user_facing_name, /\p{Script=Han}/u);
  assert.equal(draft.enabled_status, 'draft_only');
  assert.equal(draft.executionPlan.dryRunOnly, true);
  assert.equal(disabledWrite.enabled_status, 'disabled');
  assert.equal(disabledWrite.executionPlan, undefined);

  const intents = generateAutoIntentRecords(context, [following, draft, disabledWrite]);
  // @ts-ignore
  const intentsByCapability = Map.groupBy(intents, (intent) => intent.capabilityId);
  assert.equal(intentsByCapability.get(following.id).every((intent) => intent.callable === true), true);
  assert.equal(intentsByCapability.get(draft.id).every((intent) => intent.callable === true), true);
  assert.equal(intentsByCapability.get(disabledWrite.id).every((intent) => intent.callable === false), true);
  assert.equal(intents.some((intent) => /\p{Script=Han}/u.test(intent.canonicalUtterance)), true);
});

test('news fixture registry resolves Chinese utterances without x.com assumptions', () => {
  let registry = createEmptySkillRegistry('2026-05-17T00:00:00.000Z');
  registry = upsertSkillRegistryRecord(registry, {
    skillId: 'tencent-news',
    siteId: 'news.qq.com',
    domains: ['news.qq.com'],
    skillDir: '.siteforge/sites/news.qq.com-5cc57f4c/current',
    artifactDir: '.siteforge/sites/news.qq.com-5cc57f4c/builds/news-cross-site',
    verificationStatus: 'passed',
    intents: [{
      intentId: 'intent:news.qq.com:view-news-homepage',
      name: 'view news homepage',
      capabilityId: 'capability:news.qq.com:view-news-homepage',
      capabilityName: 'view news homepage',
      capabilityAction: 'view',
      executionPlanId: 'plan:news.qq.com:view-news-homepage',
      canonicalUtterance: '\u6253\u5f00\u65b0\u95fb\u9996\u9875',
      utteranceExamples: [
        '\u770b\u65b0\u95fb\u9996\u9875',
        '\u5e2e\u6211\u6253\u5f00\u817e\u8baf\u65b0\u95fb',
      ],
      safetyLevel: 'read_only',
      invocationScore: 1,
    }],
  }, '2026-05-17T00:00:01.000Z');

  const lookup = lookupSkillIntentFromRegistry(registry, {
    domain: 'NEWS.QQ.COM',
    utterance: '\u65b0\u95fb\u9996\u9875',
  });

  assert.equal(lookup.status, 'found');
  assert.equal(lookup.skillId, 'tencent-news');
  // @ts-ignore
  assert.equal(lookup.skillDir, '.siteforge/sites/news.qq.com-5cc57f4c/current');
  assert.equal(lookup.intentId, 'intent:news.qq.com:view-news-homepage');
  assert.equal(lookup.capabilityId, 'capability:news.qq.com:view-news-homepage');
  // @ts-ignore
  assert.equal(lookup.executionPlanId, 'plan:news.qq.com:view-news-homepage');
});
