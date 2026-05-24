import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';

import {
  runSiteForgeBuild,
} from '../../src/app/pipeline/build/index.mjs';
import {
  prepareSiteForgeBuildSetup,
} from '../../src/app/pipeline/build/setup-assistant.mjs';
import {
  testHtmlPage,
  testRobotsTxt,
  testSitemapXml,
  withTestSite,
} from './helpers/test-site-server.mjs';

const X_URL = 'https://x.com/';

const ENABLED_STATUSES = new Set([
  'enabled',
  'limited_enabled',
  'confirmation_required',
  'draft_only',
  'disabled',
  'debug_only',
  'candidate_debug_only',
]);
const EVIDENCE_STATUSES = new Set(['verified', 'inferred', 'confirmation_required', 'debug_only', 'disabled', 'candidate']);
const RISK_LEVELS = new Set([
  'read_public_low',
  'read_personal_medium',
  'read_private_high',
  'write_low',
  'write_high',
  'download_high',
  'account_security_critical',
]);

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function writeKnownXPolicyConfig(workspace, baseUrl = X_URL) {
  const host = new URL(baseUrl).hostname;
  const configDir = path.join(workspace, 'config');
  await mkdir(configDir, { recursive: true });
  await writeFile(path.join(configDir, 'site-registry.json'), `${JSON.stringify({
    version: 1,
    sites: {
      [host]: {
        canonicalBaseUrl: baseUrl,
        host,
        siteKey: 'x',
        adapterId: 'x',
        repoSkillDir: 'skills/x',
        siteArchetype: 'social-content',
        siteAccessStatus: 'blocked_live_robots_disallowed',
        genericLiveBuild: {
          status: 'blocked',
          reasonCode: 'robots-disallowed',
          reason: 'x.com robots.txt disallows the generic SiteForge live crawler from root-level public collection.',
          alternativeAccessPaths: [
            'official/API or platform-authorized integration',
            'user-authorized bounded X SiteAdapter workflow',
            'sanitized local validation',
          ],
        },
        downloadSessionRequirement: 'optional',
        capabilityFamilies: [
          'download-content',
          'query-account-profile',
          'query-social-content',
          'query-social-relations',
        ],
      },
    },
  }, null, 2)}\n`, 'utf8');
  await writeFile(path.join(configDir, 'site-capabilities.json'), `${JSON.stringify({
    version: 1,
    sites: {
      [host]: {
        baseUrl,
        host,
        siteKey: 'x',
        adapterId: 'x',
        primaryArchetype: 'social-content',
        capabilityFamilies: [
          'navigate-to-author',
          'query-account-profile',
          'query-social-content',
          'query-social-relations',
          'search-content',
        ],
        supportedIntents: [
          'profile-content',
          'search-posts',
          'list-followed-updates',
        ],
        safeActionKinds: ['navigate'],
        approvalActionKinds: ['search-submit'],
        siteAccessStatus: 'blocked_live_robots_disallowed',
        genericLiveBuild: {
          status: 'blocked',
          reasonCode: 'robots-disallowed',
          reason: 'x.com robots.txt disallows the generic SiteForge live crawler from root-level public collection.',
          alternativeAccessPaths: [
            'official/API or platform-authorized integration',
            'user-authorized bounded X SiteAdapter workflow',
            'sanitized local validation',
          ],
        },
      },
    },
  }, null, 2)}\n`, 'utf8');
}

function xPublicRoutes(rootUrl) {
  const indexHtml = testHtmlPage('X public social surface', `
    <nav>
      <a href="/search">Search</a>
      <a href="/home">Home</a>
      <a href="/notifications">Notifications</a>
      <a href="/i/bookmarks">Bookmarks</a>
      <a href="/i/lists">Lists</a>
      <a href="/messages">Messages</a>
      <a href="/settings">Settings</a>
    </nav>
    <form action="/search" method="get"><input name="q" type="search"></form>
  `);
  return {
    '/robots.txt': { contentType: 'text/plain; charset=utf-8', body: testRobotsTxt(rootUrl) },
    '/sitemap.xml': { contentType: 'application/xml; charset=utf-8', body: testSitemapXml(rootUrl, ['/', '/search']) },
    '/': indexHtml,
    '/home': indexHtml,
    '/search': indexHtml,
    '/notifications': indexHtml,
    '/i/bookmarks': indexHtml,
    '/i/lists': indexHtml,
    '/messages': indexHtml,
    '/settings': indexHtml,
  };
}

function xAuthenticatedStructureSummary(rootUrl = X_URL) {
  const url = (route) => new URL(route, rootUrl).toString();
  const page = (url, routeTemplate, pageType, tabState, visibleItemCount = 3) => ({
    url,
    routeTemplate,
    pageType,
    tabState,
    visibleItemCount,
    listPresent: true,
    emptyStatePresent: false,
    evidenceLevel: 'capability_verified',
    structureHash: `${routeTemplate}:${tabState}:summary`,
  });
  return {
    authenticatedPages: [
      page(url('/home'), '/home', 'home', 'for_you', 8),
      page(url('/home?tab=following'), '/home', 'home', 'following', 6),
      page(url('/search?q=siteforge&f=top'), '/search', 'search', 'top', 5),
      page(url('/search?q=siteforge&f=live'), '/search', 'search', 'latest', 5),
      page(url('/search?q=siteforge&f=user'), '/search', 'search', 'people', 5),
      page(url('/search?q=siteforge&f=media'), '/search', 'search', 'media', 5),
      page(url('/example'), '/:handle', 'profile', 'posts', 4),
      page(url('/example/with_replies'), '/:handle/with_replies', 'profile', 'replies', 4),
      page(url('/example/media'), '/:handle/media', 'profile', 'media', 4),
      page(url('/example/status/123'), '/:handle/status/:postId', 'post_detail', 'detail', 4),
      page(url('/notifications'), '/notifications', 'notifications', 'all', 4),
      page(url('/notifications/mentions'), '/notifications/mentions', 'notifications', 'mentions', 2),
      page(url('/notifications/verified'), '/notifications/verified', 'notifications', 'verified', 2),
      page(url('/i/bookmarks'), '/i/bookmarks', 'bookmarks', 'saved', 3),
      page(url('/i/lists'), '/i/lists', 'lists', 'index', 3),
      page(url('/i/lists/123'), '/i/lists/:listId', 'lists', 'list_detail', 3),
      page(url('/messages'), '/messages', 'messages', 'inbox', 3),
      page(url('/settings'), '/settings', 'settings', 'entry', 1),
    ],
    authenticatedOverlayPages: [
      {
        url: rootUrl,
        publicUrl: rootUrl,
        routeTemplate: '/',
        pageType: 'auth_overlay_control',
        tabState: 'authenticated',
        visibleItemCount: 2,
        listPresent: true,
        emptyStatePresent: false,
        evidenceLevel: 'login_page_verified',
        structureHash: 'root:authenticated:overlay',
      },
    ],
  };
}

test('x.com cookie-auth capability generation covers social intents, disabled writes, and draft-only writes', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-x-auto-capabilities-'));
  try {
    await withTestSite(xPublicRoutes, async (rootUrl) => {
    await writeKnownXPolicyConfig(workspace, rootUrl);
    const setup = await prepareSiteForgeBuildSetup(rootUrl, {
      cwd: workspace,
      buildId: 'x-auto-capability-profile',
      now: new Date('2026-05-16T09:00:00.000Z'),
      setupInteractive: true,
      interactive: true,
      fetchDelayMs: 0,
      authMode: 'cookie',
      setupPrompt: async () => '',
      setupOutput: { write() {} },
      authStateProvider: async () => ({
        crawlMode: 'authenticated_cookie',
        authMethod: 'cookie',
        authVerificationStatus: 'cookie_verified',
        verified: true,
        source: 'cookie_header_verification',
        finalUrl: new URL('/home', rootUrl).toString(),
        positiveSignals: ['test_verified_sanitized_bridge', 'same_site_final_url', 'not_login_route'],
        blockingSignals: [],
        verifiedRoutes: ['/home'],
      }),
      authenticatedStructureProvider: async () => xAuthenticatedStructureSummary(rootUrl),
    });

    const result = await runSiteForgeBuild(rootUrl, {
      ...setup.buildOptions,
      cwd: workspace,
      buildId: 'x-auto-capability-build',
      now: new Date('2026-05-16T09:00:10.000Z'),
      fetchDelayMs: 0,
      authenticatedStructureProvider: async () => xAuthenticatedStructureSummary(rootUrl),
    });

    assert.equal(result.status, 'success');

    const capabilitiesPayload = await readJson(path.join(result.artifactDir, 'capabilities.json'));
    const intentsPayload = await readJson(path.join(result.artifactDir, 'intents.json'));
    const capabilities = capabilitiesPayload.capabilities;
    const capabilityTotal = capabilities.filter((capability) => (
      ['enabled', 'limited_enabled', 'confirmation_required', 'draft_only', 'disabled'].includes(capability.enabled_status)
    )).length;
    const embeddedIntentTotal = capabilities.reduce((sum, capability) => sum + (capability.intents?.length ?? 0), 0);

    assert.equal(capabilityTotal >= 20, true);
    assert.equal(embeddedIntentTotal >= 40, true);
    assert.equal(intentsPayload.intents.length >= 40, true);
    assert.equal(capabilitiesPayload.summary.countedTotal >= 20, true);
    assert.equal(capabilitiesPayload.summary.embeddedIntents >= 40, true);

    const requiredFields = [
      'id',
      'user_facing_name',
      'internal_name',
      'category',
      'risk_level',
      'default_policy',
      'evidence_status',
      'evidence_sources',
      'saved_material',
      'raw_content_saved',
      'private_content_saved',
      'intents',
      'enabled_status',
    ];
    for (const capability of capabilities) {
      for (const field of requiredFields) {
        assert.equal(Object.hasOwn(capability, field), true, `${capability.name} missing ${field}`);
      }
      assert.equal(ENABLED_STATUSES.has(capability.enabled_status), true, capability.name);
      assert.equal(EVIDENCE_STATUSES.has(capability.evidence_status), true, capability.name);
      assert.equal(RISK_LEVELS.has(capability.risk_level), true, capability.name);
      assert.equal(Array.isArray(capability.evidence_sources), true, capability.name);
      assert.equal(Array.isArray(capability.saved_material), true, capability.name);
      assert.equal(capability.raw_content_saved, false, capability.name);
      assert.equal(capability.private_content_saved, false, capability.name);
      assert.equal(Array.isArray(capability.intents) && capability.intents.length >= 2, true, capability.name);
    }

    const categories = new Set(capabilities.map((capability) => capability.category));
    for (const category of [
      'timeline',
      'search',
      'profile',
      'post_detail',
      'notifications',
      'bookmarks',
      'lists',
      'direct_messages',
      'write',
    ]) {
      assert.equal(categories.has(category), true, `${category} category should be generated`);
    }

    const highRiskWrites = capabilities.filter((capability) => (
      ['write_high', 'account_security_critical'].includes(capability.risk_level)
    ));
    assert.equal(highRiskWrites.length >= 16, true);
    assert.equal(highRiskWrites.every((capability) => capability.enabled_status === 'disabled'), true);
    assert.equal(highRiskWrites.every((capability) => capability.status !== 'active'), true);
    assert.equal(highRiskWrites.every((capability) => !capability.executionPlan), true);

    const byName = new Map(capabilities.map((capability) => [capability.name, capability]));
    for (const capability of capabilities) {
      assert.match(String(capability.user_facing_name ?? ''), /[\u3400-\u9fff]/u, `${capability.name} should expose a Chinese user-facing label`);
    }
    for (const duplicateGroup of [
      ['list followed users', 'read followed users'],
      ['list followed updates', 'read following timeline'],
      ['list recommended timeline posts', 'read recommended timeline'],
      ['list profile content', 'read profile content'],
      ['list notifications', 'read all notifications summary'],
      ['list bookmarks', 'read bookmarks summary'],
      ['list lists', 'read lists summary'],
      ['list direct messages', 'read direct message conversation summaries'],
    ]) {
      const present = duplicateGroup.filter((name) => byName.has(name));
      assert.equal(present.length <= 1, true, `duplicate semantic capabilities: ${present.join(', ')}`);
    }
    assert.equal(byName.get('read recommended timeline')?.risk_level, 'read_personal_medium');
    assert.equal(byName.get('read recommended timeline')?.enabled_status, 'limited_enabled');
    assert.equal(byName.get('read recommended timeline')?.default_policy, 'limited_enabled');
    assert.equal(byName.get('read recommended timeline')?.executionPlan?.limitedOutputOnly, true);
    assert.equal(byName.get('read recommended timeline')?.routeTemplate, '/home');
    assert.equal(byName.get('read recommended timeline')?.tabState, 'for_you');
    assert.notEqual(byName.get('read recommended timeline')?.risk_level, 'read_public_low');
    assert.equal(byName.get('read following timeline')?.risk_level, 'read_personal_medium');
    assert.equal(['limited_enabled', 'confirmation_required'].includes(byName.get('read following timeline')?.enabled_status), true);
    assert.equal(byName.get('read following timeline')?.routeTemplate, '/home');
    assert.equal(byName.get('read following timeline')?.tabState, 'following');

    for (const [name, tabState] of [
      ['search users', 'people'],
      ['search media posts', 'media'],
    ]) {
      const capability = byName.get(name);
      assert.ok(capability, `${name} should be discovered with a state-specific route`);
      assert.equal(capability.routeTemplate, '/search', `${name} routeTemplate`);
      assert.equal(capability.tabState, tabState, `${name} tabState`);
      assert.equal(capability.executionPlan?.steps?.[0]?.routeTemplate, '/search', `${name} execution routeTemplate`);
      assert.equal(capability.executionPlan?.steps?.[0]?.tabState, tabState, `${name} execution tabState`);
    }

    for (const name of [
      'read followed users',
      'read followers',
      'read all notifications summary',
      'read mentions notifications summary',
      'read verified notifications summary',
      'open notification related post',
      'read bookmarks summary',
      'open bookmarked post',
      'read recent bookmarks by time',
    ]) {
      assert.equal(byName.get(name)?.risk_level, 'read_personal_medium', `${name} risk`);
      assert.equal(byName.get(name)?.enabled_status, 'confirmation_required', `${name} default confirmation`);
    }

    for (const [name, riskLevel] of [
      ['read notification body', 'read_private_high'],
      ['read bookmarked post body', 'read_private_high'],
      ['read direct message conversation summaries', 'read_private_high'],
      ['read direct message detail', 'read_private_high'],
      ['create direct message draft', 'write_high'],
      ['send direct message', 'write_high'],
    ]) {
      const capability = byName.get(name);
      assert.ok(capability, `${name} should be discovered`);
      assert.equal(capability.risk_level, riskLevel, `${name} risk`);
      assert.equal(capability.enabled_status, 'disabled', `${name} disabled`);
      assert.equal(capability.status, 'disabled', `${name} status`);
      assert.equal(capability.executionPlan, undefined, `${name} no plan`);
    }

    for (const name of [
      'publish post',
      'publish reply',
      'send direct message',
      'like post',
      'repost post',
      'follow user',
      'unfollow user',
      'delete post',
      'edit profile',
      'change account security settings',
      'change account email',
      'change account password',
      'change account 2fa',
      'change payment settings',
    ]) {
      assert.equal(byName.get(name)?.enabled_status, 'disabled', `${name} disabled`);
    }

    const drafts = capabilities.filter((capability) => (
      capability.risk_level === 'write_low' && capability.default_policy === 'draft_only'
    ));
    assert.equal(drafts.length >= 3, true);
    for (const draft of drafts) {
      assert.equal(draft.enabled_status, 'draft_only');
      assert.equal(draft.executionPlan.dryRunOnly, true);
      assert.equal(draft.executionPlan.requiresConfirmation, true);
      assert.equal(draft.executionPlan.autoExecute, false);
      assert.equal(draft.executionPlan.steps.every((step) => (
        step.submit === false
        && step.finalSubmit === false
        && step.upload === false
        && step.selectSensitiveRecipient === false
        && step.autoExecute === false
        && step.draftOnly === true
      )), true);
    }

    const disabledIntentIds = new Set(highRiskWrites.flatMap((capability) => (
      capability.intents.map((intent) => intent.id)
    )));
    const disabledGlobalIntents = intentsPayload.intents.filter((intent) => disabledIntentIds.has(intent.id));
    assert.equal(disabledGlobalIntents.length >= highRiskWrites.length * 2, true);
    assert.equal(disabledGlobalIntents.every((intent) => intent.callable === false), true);
    for (const intent of disabledGlobalIntents) {
      const capability = capabilities.find((candidate) => candidate.id === intent.capabilityId);
      assert.ok(intent.safe_remediation_path, `${intent.id} missing safe_remediation_path`);
      assert.ok(capability?.safe_remediation?.path, `${capability?.name ?? intent.capabilityId} missing safe_remediation`);
    }

    const registry = await readJson(result.workspace.registryPath);
    const registeredCapabilityNames = new Set(registry.skills.flatMap((skill) => (
      skill.intents ?? []
    ).map((intent) => intent.capabilityName)));
    for (const capability of highRiskWrites) {
      assert.equal(registeredCapabilityNames.has(capability.name), false, `${capability.name} must not be registered`);
    }

    const userReport = await readJson(path.join(result.artifactDir, 'build_report.user.json'));
    const userCapabilityCards = [
      ...(userReport.enabled_capabilities ?? []),
      ...(userReport.limited_enabled_capabilities ?? []),
      ...(userReport.confirmation_required_capabilities ?? []),
      ...(userReport.disabled_capabilities ?? []),
    ];
    assert.equal(userCapabilityCards.length > 0, true);
    for (const card of userCapabilityCards) {
      assert.equal(Object.hasOwn(card, 'reason_code'), false, `${card.name} should not expose reason_code`);
      assert.doesNotMatch(String(card.reason ?? ''), /forced-action-disabled|default-disabled|disabled-by-policy|confirm_or_limited|draft_only/u);
    }
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
