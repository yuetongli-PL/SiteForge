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
  runSiteForgeBuild,
  stableCapabilityId,
  upsertSkillRegistryRecord,
  writeCapabilityInteractionDecisions,
  writeCapabilityRemediationPlan,
} from '../../src/app/pipeline/build/index.mjs';
import {
  genericNavigationAdapter,
} from '../../src/sites/adapters/generic-navigation.mjs';
import {
  testHtmlPage,
  testRobotsTxt,
  testSitemapXml,
  withTestSite,
} from './helpers/test-site-server.mjs';

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

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

const PROSE_LABEL_SENTINEL = 'SITEFORGE_PROSE_SENTINEL';
const LONG_CHINESE_PROSE_LABEL = [
  '\u8fd9\u662f\u4e00\u6bb5\u7528\u4e8e\u80fd\u529b\u8fc7\u6ee4\u7684\u5408\u6210\u6b63\u6587\u5185\u5bb9',
  PROSE_LABEL_SENTINEL,
  '\u5b83\u6a21\u62df\u7ad9\u70b9\u5217\u8868\u91cc\u7684\u957f\u7bc7\u7ae0\u6458\u5f55',
  '\u4e0d\u5e94\u8be5\u88ab\u63d0\u5347\u6210\u7528\u6237\u53ef\u8c03\u7528\u80fd\u529b',
].join('');

function proseLabelRoutes(rootUrl) {
  const indexHtml = testHtmlPage('Prose Label Fixture', `
    <main>
      <nav>
        <a href="/category.html">\u5206\u7c7b</a>
        <a href="/ranking.html">\u6392\u884c\u699c</a>
      </nav>
      <section>
        <a href="/book.html">${LONG_CHINESE_PROSE_LABEL}</a>
      </section>
      <form method="GET" action="/search.html" role="search" aria-label="\u641c\u7d22\u5c0f\u8bf4">
        <input name="q" type="search">
        <button type="submit">\u641c\u7d22</button>
      </form>
    </main>
  `);
  return {
    '/robots.txt': { contentType: 'text/plain; charset=utf-8', body: testRobotsTxt(rootUrl) },
    '/sitemap.xml': {
      contentType: 'application/xml; charset=utf-8',
      body: testSitemapXml(rootUrl, ['/', '/category.html', '/ranking.html', '/book.html', '/search.html']),
    },
    '/': indexHtml,
    '/category.html': testHtmlPage('Category', '<main><h1>\u5206\u7c7b</h1></main>'),
    '/ranking.html': testHtmlPage('Ranking', '<main><h1>\u6392\u884c\u699c</h1></main>'),
    '/book.html': testHtmlPage('Book', '<main><h1>Fixture Book</h1></main>'),
    '/search.html': testHtmlPage('Search', '<main><h1>Search</h1></main>'),
  };
}

function readOnlyActionFalsePositiveRoutes(rootUrl) {
  const indexHtml = testHtmlPage('Read Only Action False Positives', `
    <main>
      <nav>
        <a href="/book.html">\u7b2c11\u7ae0 \u53d1\u5e03\u4f1a</a>
        <a href="/category.html">\u5206\u7c7b</a>
      </nav>
      <form id="t_frmsearch" name="t_frmsearch" method="POST" action="/soushu/" role="search">
        <input name="searchkey" type="text" placeholder="\u53ef\u641c\u4e66\u540d\u548c\u4f5c\u8005">
        <button type="submit">\u641c\u7d22</button>
      </form>
    </main>
  `);
  return {
    '/robots.txt': { contentType: 'text/plain; charset=utf-8', body: testRobotsTxt(rootUrl) },
    '/sitemap.xml': {
      contentType: 'application/xml; charset=utf-8',
      body: testSitemapXml(rootUrl, ['/', '/category.html', '/book.html', '/soushu/']),
    },
    '/': indexHtml,
    '/category.html': testHtmlPage('Category', '<main><h1>\u5206\u7c7b</h1></main>'),
    '/book.html': testHtmlPage('Book', '<main><h1>\u7b2c11\u7ae0 \u53d1\u5e03\u4f1a</h1></main>'),
    '/soushu/': testHtmlPage('Search', '<main><h1>\u641c\u7d22</h1></main>'),
  };
}

function visibleCapabilityText(capability) {
  return JSON.stringify({
    name: capability.name,
    userValue: capability.userValue,
    user_facing_name: capability.user_facing_name,
    object: capability.object,
    description: capability.description,
    elementLabel: capability.elementLabel,
    intents: capability.intents,
  });
}

function visibleIntentText(intent) {
  return JSON.stringify({
    name: intent.name,
    description: intent.description,
    canonicalUtterance: intent.canonicalUtterance,
    utteranceExamples: intent.utteranceExamples,
  });
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

test('public element capability generation keeps prose labels as evidence only', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-prose-label-filter-'));
  try {
    await withTestSite(proseLabelRoutes, async (rootUrl) => {
      const result = await runSiteForgeBuild(rootUrl, {
        cwd: workspace,
        buildId: 'prose-label-filter',
        now: new Date('2026-06-07T09:00:00.000Z'),
        fetchDelayMs: 0,
        maxPages: 6,
      });

      assert.equal(result.status, 'success');

      const capabilitiesPayload = await readJson(path.join(result.artifactDir, 'capabilities.json'));
      const intentsPayload = await readJson(path.join(result.artifactDir, 'intents.json'));
      const capabilities = capabilitiesPayload.capabilities ?? [];
      const intents = intentsPayload.intents ?? [];
      const visibleCapabilities = capabilities.map(visibleCapabilityText).join('\n');
      const visibleIntents = intents.map(visibleIntentText).join('\n');

      assert.doesNotMatch(visibleCapabilities, new RegExp(PROSE_LABEL_SENTINEL, 'u'));
      assert.doesNotMatch(visibleIntents, new RegExp(PROSE_LABEL_SENTINEL, 'u'));
      assert.equal(capabilities.some((capability) => (
        capability.evidenceModel === 'public_element_summary'
        && String(capability.object ?? '').includes('\u5206\u7c7b')
      )), true);
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('auto action generation ignores read-only chapter titles and search forms', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-readonly-action-filter-'));
  try {
    await withTestSite(readOnlyActionFalsePositiveRoutes, async (rootUrl) => {
      const result = await runSiteForgeBuild(rootUrl, {
        cwd: workspace,
        buildId: 'readonly-action-filter',
        now: new Date('2026-06-07T09:15:00.000Z'),
        fetchDelayMs: 0,
        maxPages: 5,
      });

      assert.equal(result.status, 'success');

      const capabilitiesPayload = await readJson(path.join(result.artifactDir, 'capabilities.json'));
      const capabilities = capabilitiesPayload.capabilities ?? [];
      assert.equal(capabilities.some((capability) => (
        capability.name === 'publish action'
        || (
          capability.action === 'submit'
          && String(capability.object ?? '').includes('\u53d1\u5e03\u4f1a')
        )
      )), false);
      assert.equal(capabilities.some((capability) => (
        capability.name === 'submit action'
        && /t_frmsearch|searchkey|\u641c\u7d22/u.test(`${capability.object ?? ''} ${capability.userValue ?? ''}`)
      )), false);
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

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
  const executableWrite = capabilities.find((capability) => capability.name === 'publish post');
  assert.ok(following);
  assert.ok(draft);
  assert.ok(executableWrite);
  assert.equal(following.enabled_status, 'enabled');
  assert.equal(following.status, 'active');
  assert.match(following.user_facing_name, /\p{Script=Han}/u);
  assert.equal(draft.enabled_status, 'enabled');
  assert.equal(draft.executionPlan.dryRunOnly, false);
  assert.equal(executableWrite.enabled_status, 'enabled');
  assert.equal(executableWrite.status, 'active');
  assert.equal(executableWrite.planCallable, true);
  assert.equal(executableWrite.runtimeCallable, true);
  assert.equal(executableWrite.autoExecutable, true);
  assert.equal(executableWrite.executionDisposition, 'allow');
  assert.notEqual(executableWrite.executionPlan.governedExecution, true);
  assert.equal(executableWrite.executionPlan.autoExecute, false);

  const intents = generateAutoIntentRecords(context, [following, draft, executableWrite]);
  // @ts-ignore
  const intentsByCapability = Map.groupBy(intents, (intent) => intent.capabilityId);
  assert.equal(intentsByCapability.get(following.id).every((intent) => intent.callable === true), true);
  assert.equal(intentsByCapability.get(draft.id).every((intent) => intent.callable === true), true);
  assert.equal(intentsByCapability.get(executableWrite.id).every((intent) => (
    intent.callable === true
    && intent.runtimeCallable === true
    && intent.autoExecutable === true
    && intent.executionDisposition === 'allow'
  )), true);
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
