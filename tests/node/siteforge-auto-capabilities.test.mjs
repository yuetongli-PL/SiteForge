import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';

import {
  runSiteForgeBuild,
} from '../../src/app/pipeline/build/index.mjs';
import {
  createProductionRuntimeProviderRegistry,
} from '../../src/app/runtime/index.mjs';
import {
  prepareSiteForgeBuildSetup,
} from '../../src/app/pipeline/build/setup-assistant.mjs';
import {
  buildExecutionContract,
} from '../../src/app/pipeline/build/execution-governance.mjs';
import {
  generateAutoCapabilities,
  generateAutoIntentRecords,
} from '../../src/app/pipeline/build/auto-capabilities.mjs';
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

test('generic social search intent seeds do not leak X branding into non-X sites', () => {
  const intents = generateAutoIntentRecords({
    skillId: 'zhihu',
  }, [{
    id: 'capability:zhihu:search-posts',
    name: 'search posts',
    status: 'active',
    enabled_status: 'enabled',
    executionPlan: { id: 'plan:zhihu:search-posts' },
    runtimeCallable: true,
    autoExecutable: false,
    inputs: [{ name: 'query', type: 'string', required: true }],
  }]);
  const text = JSON.stringify(intents);
  assert.doesNotMatch(text, /search X posts/u);
  assert.equal(intents.some((intent) => intent.canonicalUtterance === 'search social posts'), true);
});

test('zhihu authenticated route model discovers comprehensive social read surfaces', () => {
  const page = (routeTemplate, pageType, tabState, visibleItemCount = 4) => ({
    id: `node:zhihu:${routeTemplate}:${tabState}`,
    type: 'page',
    normalizedUrl: `https://www.zhihu.com${routeTemplate.replace(/\{[^/}]+\}/gu, '19550228') === '/' ? '/' : routeTemplate.replace(/\{urlToken\}/gu, 'zhihuadmin').replace(/\{questionId\}/gu, '19550228').replace(/\{answerId\}/gu, '25354498')}`,
    routeTemplate,
    pageType,
    tabState,
    visibleItemCount,
    listPresent: true,
    emptyStatePresent: false,
    sourceLayer: 'authenticated',
    evidenceLevel: 'capability_verified',
    evidenceStatus: 'structure_summary_present',
    routeState: {
      source: 'authenticated-structure-summary',
      stateId: `authenticated:${routeTemplate}:${tabState}`,
      routeTemplate,
      routePath: routeTemplate,
      tabState,
      pageKind: pageType,
    },
    evidence: [{
      type: 'text',
      source: `https://www.zhihu.com${routeTemplate}`,
      text: 'sanitized authenticated structure summary',
      confidence: 0.84,
    }],
  });
  const capabilities = generateAutoCapabilities({
    site: {
      id: 'zhihu.com-c98e39a3',
      rootUrl: 'https://www.zhihu.com/',
      allowedDomains: ['www.zhihu.com', 'zhihu.com'],
    },
    options: {
      privacy: 'limited',
    },
    setupProfile: {
      knownSitePolicy: {
        siteKey: 'zhihu',
        adapterId: 'zhihu',
        siteArchetype: 'social-content',
        capabilityFamilies: [
          'query-social-content',
          'query-social-relations',
          'query-account-profile',
          'query-notifications',
          'query-comment-thread',
          'query-media-content',
          'search-content',
          'navigate-to-category',
          'navigate-to-content',
        ],
        supportedIntents: [
          'list-hot-posts',
          'list-hot-broadcasts',
          'list-profile-content',
          'list-recommended-timeline-posts',
          'list-topic-discussions',
          'list-topic-featured',
          'list-user-activities',
          'list-user-answers',
          'list-user-questions',
          'list-user-articles',
          'list-user-columns',
          'list-user-pins',
          'list-user-collections',
          'list-user-videos',
          'list-user-following',
          'search-posts',
          'search-users',
          'search-media-posts',
          'view-question-detail',
          'view-answer-detail',
        ],
      },
    },
  }, {
    graph: {
      nodes: [
        page('/', 'home', 'recommended', 8),
        page('/follow', 'author-list-page', 'following', 6),
        page('/hot', 'category-page', 'hot', 10),
        page('/drama/feed', 'category-page', 'hot', 6),
        page('/topic/{topicId}/hot', 'category-page', 'discussions', 7),
        page('/topic/{topicId}/top-answers', 'category-page', 'featured', 7),
        page('/search', 'search-results-page', 'content', 5),
        page('/search', 'search-results-page', 'people', 5),
        page('/search', 'search-results-page', 'media', 5),
        page('/people/{urlToken}', 'author-page', 'profile', 4),
        page('/people/{urlToken}/activities', 'author-page', 'activities', 5),
        page('/people/{urlToken}/answers', 'author-page', 'answers', 4),
        page('/people/{urlToken}/asks', 'author-page', 'questions', 4),
        page('/people/{urlToken}/posts', 'author-page', 'articles', 4),
        page('/people/{urlToken}/columns', 'author-page', 'columns', 3),
        page('/people/{urlToken}/pins', 'author-page', 'pins', 5),
        page('/people/{urlToken}/collections', 'author-page', 'collections', 3),
        page('/people/{urlToken}/zvideos', 'author-page', 'videos', 3),
        page('/people/{urlToken}/following', 'author-list-page', 'following', 6),
        page('/question/{questionId}', 'content-detail-page', 'detail', 3),
        page('/question/{questionId}/answer/{answerId}', 'content-detail-page', 'detail', 3),
        page('/notifications', 'notification-page', 'all', 4),
      ],
    },
  });

  const byName = new Map(capabilities.map((capability) => [capability.name, capability]));
  for (const [name, routeTemplate, tabState] of [
    ['read recommended timeline', '/', 'recommended'],
    ['read following timeline', '/follow', 'following'],
    ['list hot posts', '/hot', 'hot'],
    ['list hot broadcasts', '/drama/feed', 'hot'],
    ['list topic discussions', '/topic/{topicId}/hot', 'discussions'],
    ['list topic featured', '/topic/{topicId}/top-answers', 'featured'],
    ['search users', '/search', 'people'],
    ['search media posts', '/search', 'media'],
    ['read profile content', '/people/{urlToken}', 'profile'],
    ['list user activities', '/people/{urlToken}/activities', 'activities'],
    ['list user answers', '/people/{urlToken}/answers', 'answers'],
    ['list user questions', '/people/{urlToken}/asks', 'questions'],
    ['list user articles', '/people/{urlToken}/posts', 'articles'],
    ['list user columns', '/people/{urlToken}/columns', 'columns'],
    ['list user pins', '/people/{urlToken}/pins', 'pins'],
    ['list user collections', '/people/{urlToken}/collections', 'collections'],
    ['list user videos', '/people/{urlToken}/zvideos', 'videos'],
    ['list user following', '/people/{urlToken}/following', 'following'],
    ['read post detail', '/question/{questionId}', 'detail'],
    ['read all notifications summary', '/notifications', 'all'],
  ]) {
    const capability = byName.get(name);
    assert.ok(capability, `${name} should be generated`);
    assert.equal(capability.status, 'active', `${name} status`);
    assert.equal(capability.routeTemplate, routeTemplate, `${name} routeTemplate`);
    assert.equal(capability.tabState, tabState, `${name} tabState`);
    assert.ok(capability.executionPlan, `${name} execution plan`);
  }
});

async function writeKnownXPolicyConfig(workspace, baseUrl = X_URL) {
  const host = new URL(baseUrl).hostname;
  const disabledActionKinds = [
    'change_2fa',
    'change_email',
    'change_password',
    'change_payment',
    'change_security_settings',
    'create_dm_draft',
    'create_post_draft',
    'create_reply_draft',
    'delete',
    'edit_profile',
    'follow',
    'like',
    'payment',
    'publish',
    'publish_reply',
    'read_dm',
    'repost',
    'send_dm',
    'unfollow',
    'upload',
  ];
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
        downloadSessionRequirement: 'required',
        capabilityFamilies: [
          'download-content',
          'query-account-profile',
          'query-social-content',
          'query-social-relations',
        ],
        disabledActionKinds,
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
        disabledActionKinds,
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

async function writeKnownWeiboPolicyConfig(workspace, baseUrl) {
  const host = new URL(baseUrl).hostname;
  const disabledActionKinds = [
    'change_2fa',
    'change_email',
    'change_password',
    'change_payment',
    'change_security_settings',
    'create_dm_draft',
    'create_post_draft',
    'create_reply_draft',
    'delete',
    'edit_profile',
    'follow',
    'like',
    'payment',
    'publish',
    'publish_reply',
    'read_dm',
    'repost',
    'send_dm',
    'unfollow',
    'upload',
  ];
  const configDir = path.join(workspace, 'config');
  await mkdir(configDir, { recursive: true });
  await writeFile(path.join(configDir, 'site-registry.json'), `${JSON.stringify({
    version: 1,
    sites: {
      [host]: {
        canonicalBaseUrl: baseUrl,
        host,
        siteKey: 'weibo',
        adapterId: 'weibo',
        repoSkillDir: 'skills/weibo',
        siteArchetype: 'social-content',
        siteAccessStatus: 'blocked_live_robots_disallowed',
        genericLiveBuild: {
          status: 'blocked',
          reasonCode: 'robots-disallowed',
          reason: 'weibo.com robots.txt disallows generic public collection.',
          alternativeAccessPaths: [
            'official/API or platform-authorized integration',
            'user-authorized bounded Weibo structure summaries',
            'sanitized local validation',
          ],
        },
        capabilityFamilies: [
          'navigate-to-author',
          'navigate-to-content',
          'navigate-to-utility-page',
          'open-auth-page',
          'query-account-profile',
          'query-notifications',
          'query-social-content',
          'query-social-relations',
          'search-content',
        ],
        disabledActionKinds,
      },
    },
  }, null, 2)}\n`, 'utf8');
  await writeFile(path.join(configDir, 'site-capabilities.json'), `${JSON.stringify({
    version: 1,
    sites: {
      [host]: {
        baseUrl,
        host,
        siteKey: 'weibo',
        adapterId: 'weibo',
        primaryArchetype: 'social-content',
        capabilityFamilies: [
          'navigate-to-author',
          'navigate-to-content',
          'navigate-to-utility-page',
          'open-auth-page',
          'query-account-profile',
          'query-notifications',
          'query-social-content',
          'query-social-relations',
          'search-content',
        ],
        supportedIntents: [
          'account-info',
          'list-followed-updates',
          'list-followed-users',
          'list-notifications',
          'list-profile-content',
          'open-author',
          'open-post',
          'open-utility-page',
          'profile-content',
          'search-posts',
        ],
        safeActionKinds: ['navigate'],
        approvalActionKinds: ['search-submit'],
        disabledActionKinds,
        siteAccessStatus: 'blocked_live_robots_disallowed',
        genericLiveBuild: {
          status: 'blocked',
          reasonCode: 'robots-disallowed',
          reason: 'weibo.com robots.txt disallows generic public collection.',
          alternativeAccessPaths: [
            'official/API or platform-authorized integration',
            'user-authorized bounded Weibo structure summaries',
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
      page(url('/example'), '/:account', 'profile', 'posts', 4),
      page(url('/example/with_replies'), '/:account/with_replies', 'profile', 'replies', 4),
      page(url('/example/media'), '/:account/media', 'profile', 'media', 4),
      page(url('/example/status/123'), '/:account/status/:id', 'post_detail', 'detail', 4),
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

test('instagram authorized summary route preferences bind semantic capabilities to matching pages', () => {
  const routeNode = (routeTemplate, pageType, title) => ({
    id: `node:${pageType}`,
    type: 'page',
    routeTemplate,
    pageType,
    title,
    routeState: {
      stateId: `authorized_source:instagram:${routeTemplate}`,
      pageKind: pageType,
      routeTemplate,
      routePath: routeTemplate,
      source: 'authorized-source-structure-summary',
    },
    evidence: [{ source: 'authorized_source', selector: pageType }],
  });
  const capabilities = generateAutoCapabilities({
    site: {
      id: 'instagram.com-ea2ecfbf',
      rootUrl: 'https://www.instagram.com/',
      allowedDomains: ['www.instagram.com', 'instagram.com'],
    },
    options: {
      privacy: 'strict',
    },
    setupProfile: {
      knownSitePolicy: {
        siteKey: 'instagram',
        adapterId: 'instagram',
        siteArchetype: 'social',
        capabilityFamilies: ['search-posts', 'profile-content'],
      },
    },
  }, {
    graph: {
      nodes: [
        routeNode('/accounts/activity/', 'notification-page', 'Instagram notifications summary'),
        routeNode('/explore/search/', 'search-results-page', 'Instagram search summary'),
        routeNode('/p/{shortcode}/', 'content-detail-page', 'Instagram post detail summary'),
        routeNode('/{account}/', 'author-page', 'Instagram profile summary'),
      ],
    },
  });

  const byName = new Map(capabilities.map((capability) => [capability.name, capability]));
  assert.equal(byName.get('search posts')?.routeTemplate, '/explore/search/');
  assert.equal(byName.get('search posts')?.executionPlan?.steps?.[0]?.routeTemplate, '/explore/search/');
  assert.equal(byName.get('read post detail')?.routeTemplate, '/p/{shortcode}/');
  assert.equal(byName.get('read profile content')?.routeTemplate, '/{account}/');
  assert.equal(byName.has('read user replies'), false);
});

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

    const writeAndAccountCapabilities = capabilities.filter((capability) => (
      ['write_high', 'account_security_critical'].includes(capability.risk_level)
    ));
    assert.equal(writeAndAccountCapabilities.length >= 16, true);
    assert.deepEqual(writeAndAccountCapabilities
      .filter((capability) => capability.status !== 'disabled')
      .map((capability) => [capability.name, capability.status]), []);
    assert.deepEqual(writeAndAccountCapabilities
      .filter((capability) => capability.planCallable !== false)
      .map((capability) => [capability.name, capability.planCallable]), []);
    assert.deepEqual(writeAndAccountCapabilities
      .filter((capability) => (
        capability.enabled_status !== 'disabled'
        || capability.runtimeCallable !== false
        || capability.autoExecutable !== false
        || capability.executionDisposition !== 'blocked'
        || capability.activationBlockedReason !== 'site-policy-disabled-action'
      ))
      .map((capability) => [
        capability.name,
        capability.enabled_status,
        capability.runtimeCallable,
        capability.autoExecutable,
        capability.executionDisposition,
        capability.activationBlockedReason,
      ]), []);

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
    assert.equal(byName.get('read recommended timeline')?.enabled_status, 'enabled');
    assert.equal(byName.get('read recommended timeline')?.default_policy, 'enabled');
    assert.notEqual(byName.get('read recommended timeline')?.executionPlan?.limitedOutputOnly, true);
    assert.equal(byName.get('read recommended timeline')?.routeTemplate, '/home');
    assert.equal(byName.get('read recommended timeline')?.tabState, 'for_you');
    assert.notEqual(byName.get('read recommended timeline')?.risk_level, 'read_public_low');
    assert.equal(byName.get('read following timeline')?.risk_level, 'read_personal_medium');
    assert.equal(byName.get('read following timeline')?.enabled_status, 'enabled');
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

    for (const [name, routeTemplate, tabState] of [
      ['read profile content', '/:account', 'posts'],
      ['read user media', '/:account/media', 'media'],
      ['read post detail', '/:account/status/:id', 'detail'],
    ]) {
      const capability = byName.get(name);
      assert.ok(capability, `${name} should be discovered with parameter-equivalent X route evidence`);
      assert.equal(capability.routeTemplate, routeTemplate, `${name} routeTemplate`);
      assert.equal(capability.tabState, tabState, `${name} tabState`);
      assert.equal(capability.executionPlan?.steps?.[0]?.routeTemplate, routeTemplate, `${name} execution routeTemplate`);
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
      assert.equal(byName.get(name)?.enabled_status, 'enabled', `${name} default enabled`);
    }

    for (const [name, riskLevel] of [
      ['read notification body', 'read_private_high'],
      ['read bookmarked post body', 'read_private_high'],
    ]) {
      const capability = byName.get(name);
      assert.ok(capability, `${name} should be discovered`);
      assert.equal(capability.risk_level, riskLevel, `${name} risk`);
      assert.equal(capability.status, 'disabled', `${name} status`);
      assert.equal(capability.enabled_status, 'disabled', `${name} disabled status`);
      assert.equal(capability.planCallable, false, `${name} not plan callable`);
      assert.equal(capability.runtimeCallable, false, `${name} not runtime callable`);
      assert.equal(capability.autoExecutable, false, `${name} not auto executable`);
      assert.equal(capability.executionPlan, undefined, `${name} no execution plan`);
    }

    for (const [name, riskLevel] of [
      ['read direct message conversation summaries', 'read_private_high'],
      ['read direct message detail', 'read_private_high'],
      ['create direct message draft', 'write_high'],
      ['send direct message', 'write_high'],
    ]) {
      const capability = byName.get(name);
      assert.ok(capability, `${name} should be discovered`);
      assert.equal(capability.risk_level, riskLevel, `${name} risk`);
      assert.equal(capability.status, 'disabled', `${name} lifecycle status`);
      assert.equal(capability.enabled_status, 'disabled', `${name} disabled status`);
      assert.equal(capability.executionDisposition, 'blocked', `${name} blocked`);
      assert.equal(capability.runtimeCallable, false, `${name} runtime blocked`);
      assert.equal(capability.activationBlockedReason, 'site-policy-disabled-action', `${name} policy reason`);
    }

    const optionalPublishAction = byName.get('publish action');
    if (optionalPublishAction) {
      assert.equal(optionalPublishAction.status, 'disabled', 'publish action lifecycle disabled');
      assert.equal(optionalPublishAction.enabled_status, 'disabled', 'publish action disabled');
      assert.equal(optionalPublishAction.executionDisposition, 'blocked', 'publish action blocked');
      assert.equal(optionalPublishAction.autoExecutable, false, 'publish action not auto executable');
      assert.equal(optionalPublishAction.runtimeCallable, false, 'publish action runtime blocked');
    }

    for (const name of [
      'publish post',
      'publish reply',
      'send direct message',
      'like post',
      'repost post',
      'follow user',
      'unfollow user',
    ]) {
      assert.equal(byName.get(name)?.status, 'disabled', `${name} lifecycle disabled`);
      assert.equal(byName.get(name)?.enabled_status, 'disabled', `${name} disabled`);
      assert.equal(byName.get(name)?.executionDisposition, 'blocked', `${name} blocked`);
      assert.equal(byName.get(name)?.autoExecutable, false, `${name} not auto executable`);
      assert.equal(byName.get(name)?.runtimeCallable, false, `${name} runtime blocked`);
    }
    for (const name of [
      'edit profile',
      'change account settings',
      'change account security settings',
      'change account email',
      'change account password',
      'change account 2fa',
    ]) {
      assert.equal(byName.get(name)?.status, 'disabled', `${name} lifecycle disabled`);
      assert.equal(byName.get(name)?.enabled_status, 'disabled', `${name} disabled`);
      assert.equal(byName.get(name)?.executionDisposition, 'blocked', `${name} blocked`);
      assert.equal(byName.get(name)?.autoExecutable, false, `${name} not auto executable`);
      assert.equal(byName.get(name)?.runtimeCallable, false, `${name} runtime blocked`);
    }
    for (const name of [
      'delete post',
      'change payment settings',
    ]) {
      assert.equal(byName.get(name)?.status, 'disabled', `${name} lifecycle disabled`);
      assert.equal(byName.get(name)?.enabled_status, 'disabled', `${name} disabled`);
      assert.equal(byName.get(name)?.executionDisposition, 'blocked', `${name} blocked`);
    }

    const drafts = capabilities.filter((capability) => (
      capability.risk_level === 'write_low'
    ));
    assert.equal(drafts.length >= 3, true);
    for (const draft of drafts) {
      assert.equal(draft.enabled_status, 'disabled', `${draft.name} disabled`);
      assert.equal(draft.status, 'disabled', `${draft.name} lifecycle disabled`);
      assert.equal(draft.executionDisposition, 'blocked', `${draft.name} blocked`);
      assert.equal(draft.runtimeCallable, false, `${draft.name} runtime blocked`);
      assert.equal(draft.autoExecutable, false, `${draft.name} not auto executable`);
      assert.equal(draft.activationBlockedReason, 'site-policy-disabled-action', `${draft.name} policy reason`);
    }

    const writeIntentIds = new Set(writeAndAccountCapabilities.flatMap((capability) => (
      capability.intents.map((intent) => intent.id)
    )));
    const writeGlobalIntents = intentsPayload.intents.filter((intent) => writeIntentIds.has(intent.id));
    assert.equal(writeGlobalIntents.length >= writeAndAccountCapabilities.length * 2, true);
    assert.equal(writeGlobalIntents.every((intent) => intent.callable === false), true);
    assert.equal(writeGlobalIntents.every((intent) => intent.planCallable === false), true);
    assert.equal(writeGlobalIntents.filter((intent) => intent.executionDisposition === 'allow').every((intent) => intent.autoExecutable === true), true);
    assert.equal(writeGlobalIntents.filter((intent) => intent.executionDisposition === 'controlled').every((intent) => intent.autoExecutable === false), true);
    assert.equal(writeGlobalIntents.every((intent) => intent.executionDisposition === 'blocked'), true);
    assert.equal(writeGlobalIntents.filter((intent) => intent.executionDisposition === 'blocked').every((intent) => intent.autoExecutable === false), true);
    for (const intent of writeGlobalIntents.filter((candidate) => candidate.executionDisposition === 'blocked')) {
      const capability = capabilities.find((candidate) => candidate.id === intent.capabilityId);
      assert.ok(capability?.safe_remediation?.path, `${capability?.name ?? intent.capabilityId} missing safe_remediation`);
    }

    const executionContracts = await readJson(path.join(result.artifactDir, 'execution_contracts.json'));
    const executionGovernance = await readJson(path.join(result.artifactDir, 'execution_governance.json'));
    const runtimeDispatchReport = await readJson(path.join(result.artifactDir, 'runtime_dispatch_report.json'));
    assert.equal(executionGovernance.decisions.some((decision) => decision.disposition === 'allow' && decision.runtimeDispatchAllowed === true), true);
    const destructiveContract = executionContracts.executionContracts.find((contract) => contract.destructiveAction === true);
    if (destructiveContract) {
      assert.equal(destructiveContract.highRiskAction, true);
      assert.equal(destructiveContract.executionDisposition, 'blocked');
      assert.equal(destructiveContract.executionVerdict, 'blocked');
      assert.equal(destructiveContract.executionGates.includes('confirm_required'), true);
      assert.equal(destructiveContract.executionGates.includes('audit_required'), true);
      assert.equal(destructiveContract.executionGates.includes('permission_required'), true);
      assert.equal(destructiveContract.impactScope.level, 'destructive');
      assert.equal(destructiveContract.requiresStrongConfirmation, true);
      assert.equal(destructiveContract.confirmationPolicy.strongConfirmationRequired, true);
      assert.equal(destructiveContract.confirmationPolicy.naturalLanguageRequestGrantsExecution, false);
      assert.equal(destructiveContract.auditPolicy.required, true);
      assert.equal(destructiveContract.executionPrerequisites.sitePolicyExplicitAllowRequired, true);
      assert.equal(destructiveContract.executionPrerequisites.auditRequired, true);
      const destructiveDecision = executionGovernance.decisions.find((decision) => (
        decision.contractRef === destructiveContract.id
      ));
      assert.ok(destructiveDecision, 'destructive governance decision should be retained');
      assert.equal(destructiveDecision.runtimeDispatchAllowed, false);
      assert.equal(destructiveDecision.verdict, 'blocked');
      assert.equal(destructiveDecision.gates.includes('confirm_required'), true);
      assert.equal(destructiveDecision.naturalLanguageRequestGrantsExecution, false);
      assert.equal(destructiveDecision.governanceGates.sitePolicyExplicitAllow.satisfied, false);
      assert.equal(destructiveDecision.governanceGates.strongConfirmation.satisfied, false);
    } else {
      assert.equal(writeAndAccountCapabilities.every((capability) => (
        capability.status === 'disabled'
        && capability.planCallable === false
        && capability.runtimeCallable === false
      )), true);
    }
    assert.equal(runtimeDispatchReport.status, 'compiled_no_task');
    assert.equal(runtimeDispatchReport.runtimeInvocationRequest, null);
    assert.equal(runtimeDispatchReport.runtimeDecision, null);
    assert.equal(runtimeDispatchReport.runtimeExecuted, false);

    const registry = await readJson(result.workspace.registryPath);
    const registeredCapabilityNames = new Set(registry.skills.flatMap((skill) => (
      skill.intents ?? []
    ).map((intent) => intent.capabilityName)));
    for (const capability of writeAndAccountCapabilities) {
      assert.equal(registeredCapabilityNames.has(capability.name), false, `${capability.name} must stay out of default registry`);
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

test('weibo known-site policy blocks mutation, account, payment, and direct-message capabilities', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-weibo-policy-capabilities-'));
  try {
    await withTestSite(xPublicRoutes, async (rootUrl) => {
      await writeKnownWeiboPolicyConfig(workspace, rootUrl);
      const setup = await prepareSiteForgeBuildSetup(rootUrl, {
        cwd: workspace,
        buildId: 'weibo-policy-capability-profile',
        now: new Date('2026-06-09T00:00:00.000Z'),
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
        buildId: 'weibo-policy-capability-build',
        now: new Date('2026-06-09T00:00:10.000Z'),
        fetchDelayMs: 0,
        authenticatedStructureProvider: async () => xAuthenticatedStructureSummary(rootUrl),
      });

      assert.equal(result.status, 'success');

      const capabilitiesPayload = await readJson(path.join(result.artifactDir, 'capabilities.json'));
      const capabilities = capabilitiesPayload.capabilities;
      const byName = new Map(capabilities.map((capability) => [capability.name, capability]));

      for (const name of [
        'change account 2fa',
        'change account email',
        'change account password',
        'change account security settings',
        'change payment settings',
        'create direct message draft',
        'create post draft',
        'create reply draft',
        'delete post',
        'edit profile',
        'follow user',
        'like post',
        'publish post',
        'publish reply',
        'read direct message conversation summaries',
        'read direct message detail',
        'repost post',
        'send direct message',
        'unfollow user',
      ]) {
        const capability = byName.get(name);
        assert.ok(capability, `${name} should be generated for policy evaluation`);
        assert.equal(capability.status, 'disabled', `${name} lifecycle disabled`);
        assert.equal(capability.enabled_status, 'disabled', `${name} disabled`);
        assert.equal(capability.default_policy, 'disabled', `${name} default disabled`);
        assert.equal(capability.executionDisposition, 'blocked', `${name} blocked`);
        assert.equal(capability.runtimeCallable, false, `${name} not runtime callable`);
        assert.equal(capability.autoExecutable, false, `${name} not auto executable`);
        assert.equal(capability.riskPolicy?.reasonCode, 'site-policy-disabled-action', `${name} policy reason`);
        assert.equal(capability.activationBlockedReason, 'site-policy-disabled-action', `${name} activation reason`);
      }

      for (const names of [
        ['search posts'],
        ['read user recent posts'],
        ['read timeline post summaries'],
        ['read post detail', 'view post detail'],
      ]) {
        const capability = names.map((name) => byName.get(name)).find(Boolean);
        const label = names.join(' or ');
        assert.ok(capability, `${label} should remain available`);
        assert.notEqual(capability.enabled_status, 'disabled', `${label} should not be disabled by Weibo write policy`);
        assert.notEqual(capability.executionDisposition, 'blocked', `${label} should not be blocked by Weibo write policy`);
      }
      const notificationsReadCapability = byName.get('read all notifications summary') ?? byName.get('list notifications');
      assert.ok(notificationsReadCapability, 'notification summary read capability should remain available');
      assert.notEqual(notificationsReadCapability.enabled_status, 'disabled', 'notification summary read capability should not be disabled by Weibo write policy');
      assert.notEqual(notificationsReadCapability.executionDisposition, 'blocked', 'notification summary read capability should not be blocked by Weibo write policy');

      const executionContracts = await readJson(path.join(result.artifactDir, 'execution_contracts.json'));
      const searchPostsContract = executionContracts.executionContracts.find((contract) => (
        contract.capabilityId === byName.get('search posts')?.id
      ));
      assert.ok(searchPostsContract, 'search posts should have an execution contract');
      assert.equal(searchPostsContract.authRequirement?.required, true);
      assert.equal(searchPostsContract.authRequirement?.material?.injectionTarget, 'http_request');
      assert.deepEqual(searchPostsContract.authRequirement?.material?.allowedTypes, ['cookie']);
      assert.equal(searchPostsContract.authRequirement?.scopes?.[0]?.origin, new URL('https://s.weibo.com/').origin);
      assert.deepEqual(searchPostsContract.authRequirement?.scopes?.[0]?.operations, ['read', 'query']);
      assert.deepEqual(searchPostsContract.authRequirement?.scopes?.[0]?.resources, ['/weibo']);
      assert.deepEqual(searchPostsContract.executionGates, ['session_required']);

      assert.equal(capabilitiesPayload.summary.riskPolicy.disabled >= 19, true);
      assert.equal(capabilitiesPayload.summary.riskPolicy.enablementStatus.disabled >= 19, true);

      const fetchCalls = [];
      const taskResult = await runSiteForgeBuild(rootUrl, {
        ...setup.buildOptions,
        cwd: workspace,
        buildId: 'weibo-policy-capability-runtime-auth-build',
        now: new Date('2026-06-09T00:00:20.000Z'),
        fetchDelayMs: 0,
        authenticatedStructureProvider: async () => xAuthenticatedStructureSummary(rootUrl),
        executionTask: 'search posts',
        execute: true,
        apiReplayCookieHeader: 'sf_fixture_cookie=synthetic_weibo_cookie; sf_fixture_csrf=synthetic_weibo_csrf',
        runtimeProviderRegistry: createProductionRuntimeProviderRegistry(),
        runtimeExecutionContext: {
          slotValues: { query: 'openai' },
          fetchImpl: async (url, init) => {
            fetchCalls.push({ url, headers: init?.headers });
            return {
              status: 200,
              ok: true,
              headers: { get: () => 'text/html; charset=utf-8' },
              text: async () => '<html><div class="card-wrap"></div><div class="card-feed"></div></html>',
            };
          },
        },
      });
      const runtimeExecution = await readJson(path.join(taskResult.artifactDir, 'runtime_execution_report.json'));
      assert.equal(runtimeExecution.status, 'completed');
      assert.equal(runtimeExecution.providerId, 'weibo_readonly_provider');
      assert.equal(runtimeExecution.providerInvoked, true);
      assert.equal(runtimeExecution.resultSummary.outcome, 'weibo_search_read_completed');
      assert.equal(runtimeExecution.resultSummary.response.bodySummary.resultContainerSignals, 2);
      assert.equal(runtimeExecution.authSummary.used, true);
      assert.equal(fetchCalls.length, 1);
      assert.equal(fetchCalls[0].headers.cookie, 'sf_fixture_cookie=synthetic_weibo_cookie; sf_fixture_csrf=synthetic_weibo_csrf');
      const runtimeExecutionText = await readFile(path.join(taskResult.artifactDir, 'runtime_execution_report.json'), 'utf8');
      const dispatchText = await readFile(path.join(taskResult.artifactDir, 'runtime_dispatch_report.json'), 'utf8');
      assert.doesNotMatch(runtimeExecutionText, /synthetic_weibo_cookie|synthetic_weibo_csrf|sf_fixture_cookie|sf_fixture_csrf/iu);
      assert.doesNotMatch(dispatchText, /synthetic_weibo_cookie|synthetic_weibo_csrf|sf_fixture_cookie|sf_fixture_csrf/iu);
      const dispatchReport = JSON.parse(dispatchText);
      assert.match(dispatchReport.selectedContractRef, /search-posts/u);
      assert.equal(dispatchReport.selectedGateStatus?.session_required?.satisfied, true);
      assert.equal(dispatchReport.selectedGateStatus?.session_required?.source, 'runtime_session_context');

      const followedFetchCalls = [];
      const followedTaskResult = await runSiteForgeBuild(rootUrl, {
        ...setup.buildOptions,
        cwd: workspace,
        buildId: 'weibo-policy-followed-users-runtime-auth-build',
        now: new Date('2026-06-09T00:00:30.000Z'),
        fetchDelayMs: 0,
        authenticatedStructureProvider: async () => xAuthenticatedStructureSummary(rootUrl),
        executionTask: 'read followed users',
        execute: true,
        apiReplayCookieHeader: 'sf_fixture_cookie=synthetic_weibo_cookie; sf_fixture_csrf=synthetic_weibo_csrf',
        runtimeProviderRegistry: createProductionRuntimeProviderRegistry(),
        runtimeExecutionContext: {
          slotValues: { uid: '1234567890' },
          fetchImpl: async (url, init) => {
            followedFetchCalls.push({ url, headers: init?.headers });
            return {
              status: 200,
              ok: true,
              headers: { get: () => 'application/json; charset=utf-8' },
              json: async () => ({
                ok: 1,
                total_number: 1,
                users: [{ idstr: '22334455' }],
              }),
            };
          },
        },
      });
      const followedRuntimeExecution = await readJson(path.join(followedTaskResult.artifactDir, 'runtime_execution_report.json'));
      assert.equal(followedRuntimeExecution.status, 'completed', followedRuntimeExecution.reasonCode);
      assert.equal(followedRuntimeExecution.providerId, 'weibo_readonly_provider');
      assert.equal(followedRuntimeExecution.providerInvoked, true);
      assert.equal(followedRuntimeExecution.resultSummary.outcome, 'weibo_followed_users_read_completed');
      assert.equal(followedRuntimeExecution.authSummary.used, true);
      assert.equal(followedFetchCalls.length, 1);
      assert.equal(followedFetchCalls[0].headers.cookie, 'sf_fixture_cookie=synthetic_weibo_cookie; sf_fixture_csrf=synthetic_weibo_csrf');
      const followedRuntimeText = await readFile(path.join(followedTaskResult.artifactDir, 'runtime_execution_report.json'), 'utf8');
      const followedDispatchText = await readFile(path.join(followedTaskResult.artifactDir, 'runtime_dispatch_report.json'), 'utf8');
      assert.doesNotMatch(followedRuntimeText, /synthetic_weibo_cookie|synthetic_weibo_csrf|sf_fixture_cookie|sf_fixture_csrf/iu);
      assert.doesNotMatch(followedDispatchText, /synthetic_weibo_cookie|synthetic_weibo_csrf|sf_fixture_cookie|sf_fixture_csrf/iu);
      const followedDispatchReport = JSON.parse(followedDispatchText);
      assert.match(followedDispatchReport.selectedContractRef, /read-followed-users/u);
      assert.equal(followedDispatchReport.selectedGateStatus?.session_required?.satisfied, true);
      assert.equal(followedDispatchReport.selectedGateStatus?.session_required?.source, 'runtime_session_context');
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('weibo search contract binds auth and readonly provider from host fallback', () => {
  const contract = buildExecutionContract({
    context: {
      site: {
        id: 'weibo.com-a7b18273',
        rootUrl: 'https://weibo.com/',
        allowedDomains: ['weibo.com'],
      },
      setupProfile: {
        knownSitePolicy: {},
      },
    },
    capability: {
      id: 'capability:weibo.com-a7b18273:search-posts',
      name: 'search posts',
      status: 'active',
      action: 'search',
      object: 'posts',
      risk_level: 'read_public_low',
      inputs: [{ name: 'query', type: 'string', required: true }],
      executionPlan: {
        id: 'plan:weibo.com-a7b18273:search-posts',
        steps: [
          { kind: 'read_sanitized_summary', querySlot: 'query', pageKind: 'search-results-page' },
        ],
      },
    },
    intents: [],
  });

  assert.equal(contract.authRequirement?.required, true);
  assert.equal(contract.authRequirementRef, 'auth-requirement:capability:weibo.com-a7b18273:search-posts');
  assert.equal(contract.authRequirement?.scopes?.[0]?.origin, 'https://s.weibo.com');
  assert.deepEqual(contract.authRequirement?.scopes?.[0]?.resources, ['/weibo']);
  assert.deepEqual(contract.executionGates, ['session_required']);
  assert.equal(contract.runtimeBinding?.providerId, 'weibo_readonly_provider');
  assert.equal(contract.payloadTemplate?.slotBindings?.[0]?.name, 'query');
  assert.equal(contract.payloadTemplate?.steps?.[0]?.pageKind, 'search-results-page');
});

test('x browser-bridge readonly contract keeps session gate without requesting raw auth material', () => {
  const contract = buildExecutionContract({
    context: {
      site: {
        id: 'x.com-326a6450',
        rootUrl: 'https://x.com/',
        allowedDomains: ['x.com'],
      },
      setupProfile: {
        knownSitePolicy: {
          siteKey: 'x',
          adapterId: 'x',
        },
      },
    },
    capability: {
      id: 'capability:x.com-326a6450:list-notifications',
      name: 'list notifications',
      status: 'active',
      action: 'list',
      object: 'notifications',
      providerId: 'browser_bridge',
      runtimeMode: 'browser_bridge_required',
      authRequired: true,
      risk_level: 'read_public_low',
      executionPlan: {
        id: 'plan:x.com-326a6450:list-notifications',
        runtimeMode: 'browser_bridge_required',
        steps: [
          {
            kind: 'site_action',
            routeTemplate: '/notifications',
            savedMaterial: 'sanitized_summary_only',
          },
        ],
      },
    },
    intents: [],
  });

  assert.equal(contract.sessionRequirementRef, 'session-requirement:capability:x.com-326a6450:list-notifications');
  assert.equal(contract.authRequirementRef, null);
  assert.equal(contract.authRequirement?.required, false);
  assert.deepEqual(contract.authRequirement?.material?.allowedTypes, []);
  assert.deepEqual(contract.executionGates, ['session_required']);
  assert.equal(contract.runtimeBinding?.kind, 'browser_bridge');
  assert.equal(contract.runtimeBinding?.providerId, 'browser_bridge');
  assert.equal(contract.runtimeBinding?.credentialMaterialPolicy, 'no_raw_material');
  assert.equal(contract.runtimeBinding?.cookieMaterialPersisted, false);
});

test('instagram authorized-summary readonly contract keeps session gate without requesting raw auth material', () => {
  const contract = buildExecutionContract({
    context: {
      site: {
        id: 'instagram.com-ea2ecfbf',
        rootUrl: 'https://www.instagram.com/',
        allowedDomains: ['www.instagram.com', 'instagram.com'],
      },
      setupProfile: {
        knownSitePolicy: {
          siteKey: 'instagram',
          adapterId: 'instagram',
        },
      },
    },
    capability: {
      id: 'capability:instagram.com-ea2ecfbf:search-posts',
      name: 'search posts',
      status: 'active',
      action: 'search',
      object: 'posts',
      providerId: 'authorized_summary',
      authRequired: true,
      risk_level: 'read_public_low',
      executionPlan: {
        id: 'plan:instagram.com-ea2ecfbf:search-posts',
        steps: [
          {
            kind: 'read_sanitized_summary',
            routeTemplate: '/explore/search/',
            savedMaterial: 'sanitized_summary_only',
            routeState: {
              source: 'authorized-source-structure-summary',
            },
          },
        ],
      },
    },
    intents: [],
  });

  assert.equal(contract.sessionRequirementRef, 'session-requirement:capability:instagram.com-ea2ecfbf:search-posts');
  assert.equal(contract.authRequirementRef, null);
  assert.equal(contract.authRequirement?.required, false);
  assert.deepEqual(contract.authRequirement?.material?.allowedTypes, []);
  assert.deepEqual(contract.executionGates, ['session_required']);
  assert.equal(contract.runtimeBinding?.providerId, 'authorized_summary');
  assert.equal(contract.runtimeBinding?.credentialMaterialPolicy, 'no_raw_material');
  assert.equal(contract.runtimeBinding?.cookieMaterialPersisted, false);
});

test('reddit browser-bridge readonly contract keeps session gate without requesting raw auth material', () => {
  const contract = buildExecutionContract({
    context: {
      site: {
        id: 'reddit.com-14830d0f',
        rootUrl: 'https://www.reddit.com/',
        allowedDomains: ['www.reddit.com', 'reddit.com'],
      },
      setupProfile: {
        knownSitePolicy: {
          siteKey: 'reddit',
          adapterId: 'reddit',
        },
      },
    },
    capability: {
      id: 'capability:reddit.com-14830d0f:read-timeline-post-summaries',
      name: 'read timeline post summaries',
      status: 'active',
      action: 'read',
      object: 'timeline post summaries',
      providerId: 'browser_bridge',
      runtimeMode: 'browser_bridge_required',
      authRequired: true,
      risk_level: 'read_personal_medium',
      executionPlan: {
        id: 'plan:reddit.com-14830d0f:read-timeline-post-summaries',
        runtimeMode: 'browser_bridge_required',
        steps: [
          {
            kind: 'site_action',
            routeTemplate: '/',
            savedMaterial: 'sanitized_summary_only',
          },
        ],
      },
    },
    intents: [],
  });

  assert.equal(contract.sessionRequirementRef, 'session-requirement:capability:reddit.com-14830d0f:read-timeline-post-summaries');
  assert.equal(contract.authRequirementRef, null);
  assert.equal(contract.authRequirement?.required, false);
  assert.deepEqual(contract.authRequirement?.material?.allowedTypes, []);
  assert.deepEqual(contract.executionGates, ['session_required']);
  assert.equal(contract.runtimeBinding?.kind, 'browser_bridge');
  assert.equal(contract.runtimeBinding?.providerId, 'browser_bridge');
  assert.equal(contract.runtimeBinding?.credentialMaterialPolicy, 'no_raw_material');
  assert.equal(contract.runtimeBinding?.cookieMaterialPersisted, false);
});

test('weibo followed-users contract binds auth and readonly provider from host fallback', () => {
  const contract = buildExecutionContract({
    context: {
      site: {
        id: 'weibo.com-a7b18273',
        rootUrl: 'https://weibo.com/',
        allowedDomains: ['weibo.com'],
      },
      setupProfile: {
        knownSitePolicy: {},
      },
    },
    capability: {
      id: 'capability:weibo.com-a7b18273:read-followed-users',
      name: 'read followed users',
      status: 'active',
      action: 'read',
      object: 'followed users',
      risk_level: 'read_personal_medium',
      inputs: [
        { name: 'uid', type: 'string', required: true },
        { name: 'page', type: 'number', required: false },
      ],
      executionPlan: {
        id: 'plan:weibo.com-a7b18273:read-followed-users',
        steps: [
          { kind: 'read_sanitized_summary', inputSlot: 'uid' },
        ],
      },
    },
    intents: [],
  });

  assert.equal(contract.authRequirement?.required, true);
  assert.equal(contract.authRequirement?.scopes?.[0]?.origin, 'https://weibo.com');
  assert.deepEqual(contract.authRequirement?.scopes?.[0]?.resources, ['/ajax/friendships/friends']);
  assert.deepEqual(contract.authRequirement?.policy?.requireExplicitSlots, ['uid']);
  assert.deepEqual(contract.executionGates, ['session_required']);
  assert.equal(contract.runtimeBinding?.providerId, 'weibo_readonly_provider');
  assert.equal(contract.payloadTemplate?.slotBindings?.[0]?.name, 'uid');
});

test('weibo hot-timeline contract binds scoped readonly provider from host fallback', () => {
  const contract = buildExecutionContract({
    context: {
      site: {
        id: 'weibo.com-a7b18273',
        rootUrl: 'https://weibo.com/',
        allowedDomains: ['weibo.com'],
      },
      setupProfile: {
        knownSitePolicy: {},
      },
    },
    capability: {
      id: 'capability:weibo.com-a7b18273:hot-timeline',
      name: 'read hot-timeline',
      status: 'active',
      action: 'read',
      object: 'hot timeline posts',
      risk_level: 'read_public_low',
      executionPlan: {
        id: 'plan:weibo.com-a7b18273:hot-timeline',
        steps: [
          { kind: 'read_sanitized_summary', routeTemplate: '/hot/hottimeline' },
        ],
      },
    },
    intents: [],
  });

  assert.equal(contract.authRequirement?.required, true);
  assert.equal(contract.authRequirement?.scopes?.[0]?.origin, 'https://weibo.com');
  assert.deepEqual(contract.authRequirement?.scopes?.[0]?.resources, ['/ajax/feed/hottimeline']);
  assert.equal(contract.authRequirement?.policy?.requireExplicitSlots, undefined);
  assert.deepEqual(contract.executionGates, ['session_required']);
  assert.equal(contract.runtimeBinding?.providerId, 'weibo_readonly_provider');
});

test('weibo split hot-rank contract binds scoped readonly provider without uid slot', () => {
  const contract = buildExecutionContract({
    context: {
      site: {
        id: 'weibo.com-a7b18273',
        rootUrl: 'https://weibo.com/',
        allowedDomains: ['weibo.com'],
      },
      setupProfile: {
        knownSitePolicy: {},
      },
    },
    capability: {
      id: 'capability:weibo.com-a7b18273:hot-rank-week',
      name: 'read hot-rank-week',
      status: 'active',
      action: 'read',
      object: 'weekly hot rank posts',
      risk_level: 'read_public_low',
      executionPlan: {
        id: 'plan:weibo.com-a7b18273:hot-rank-week',
        steps: [
          { kind: 'read_sanitized_summary', routeTemplate: '/hot/hottimeline', query: { ranking_type: 'week' } },
        ],
      },
    },
    intents: [],
  });

  assert.equal(contract.authRequirement?.required, true);
  assert.equal(contract.authRequirement?.scopes?.[0]?.origin, 'https://weibo.com');
  assert.deepEqual(contract.authRequirement?.scopes?.[0]?.resources, ['/ajax/feed/hottimeline']);
  assert.equal(contract.authRequirement?.policy?.requireExplicitSlots, undefined);
  assert.deepEqual(contract.executionGates, ['session_required']);
  assert.equal(contract.runtimeBinding?.providerId, 'weibo_readonly_provider');
});

test('weibo user content contracts bind scoped readonly provider from host fallback', () => {
  const cases = [
    {
      id: 'user-posts',
      name: 'read user posts',
      object: 'user posts',
      expectedOrigin: 'https://weibo.com',
      expectedResources: ['/ajax/statuses/mymblog'],
    },
    {
      id: 'user-articles',
      name: 'read user articles',
      object: 'user articles',
      expectedOrigin: 'https://weibo.com',
      expectedResources: ['/ajax/statuses/mymblog'],
    },
    {
      id: 'user-albums',
      name: 'read user albums',
      object: 'user albums',
      expectedOrigin: 'https://photo.weibo.com',
      expectedResources: ['/photos/get_all'],
    },
    {
      id: 'user-videos',
      name: 'read user videos',
      object: 'user videos',
      expectedOrigin: 'https://weibo.com',
      expectedResources: ['/ajax/statuses/mymblog'],
    },
    {
      id: 'user-audio',
      name: 'read user audio',
      object: 'user audio',
      expectedOrigin: 'https://weibo.com',
      expectedResources: ['/ajax/profile/getAudioList'],
    },
  ];
  for (const testCase of cases) {
    const contract = buildExecutionContract({
      context: {
        site: {
          id: 'weibo.com-a7b18273',
          rootUrl: 'https://weibo.com/',
          allowedDomains: ['weibo.com'],
        },
        setupProfile: {
          knownSitePolicy: {},
        },
      },
      capability: {
        id: `capability:weibo.com-a7b18273:${testCase.id}`,
        name: testCase.name,
        status: 'active',
        action: 'read',
        object: testCase.object,
        risk_level: 'read_personal_medium',
        inputs: [
          { name: 'uid', type: 'string', required: true },
          { name: 'page', type: 'number', required: false },
        ],
        executionPlan: {
          id: `plan:weibo.com-a7b18273:${testCase.id}`,
          steps: [
            { kind: 'read_sanitized_summary', inputSlot: 'uid' },
          ],
        },
      },
      intents: [],
    });

    assert.equal(contract.authRequirement?.required, true);
    assert.equal(contract.authRequirement?.scopes?.[0]?.origin, testCase.expectedOrigin);
    assert.deepEqual(contract.authRequirement?.scopes?.[0]?.resources, testCase.expectedResources);
    assert.deepEqual(contract.authRequirement?.policy?.requireExplicitSlots, ['uid']);
    assert.deepEqual(contract.executionGates, ['session_required']);
    assert.equal(contract.runtimeBinding?.providerId, 'weibo_readonly_provider');
    assert.equal(contract.payloadTemplate?.slotBindings?.[0]?.name, 'uid');
  }
});

test('zhihu search contract binds auth and readonly provider from host fallback', () => {
  const contract = buildExecutionContract({
    context: {
      site: {
        id: 'www.zhihu.com-6d8935fb',
        rootUrl: 'https://www.zhihu.com/',
        allowedDomains: ['www.zhihu.com'],
      },
      setupProfile: {
        knownSitePolicy: {},
      },
    },
    capability: {
      id: 'capability:www.zhihu.com-6d8935fb:search-posts',
      name: 'search posts',
      status: 'active',
      action: 'search',
      object: 'posts',
      risk_level: 'read_public_low',
      inputs: [{ name: 'query', type: 'string', required: true }],
      executionPlan: {
        id: 'plan:www.zhihu.com-6d8935fb:search-posts',
        steps: [
          { kind: 'read_sanitized_summary', querySlot: 'query' },
        ],
      },
    },
    intents: [],
  });

  assert.equal(contract.authRequirement?.required, true);
  assert.equal(contract.authRequirementRef, 'auth-requirement:capability:www.zhihu.com-6d8935fb:search-posts');
  assert.equal(contract.authRequirement?.scopes?.[0]?.origin, 'https://www.zhihu.com');
  assert.deepEqual(contract.authRequirement?.scopes?.[0]?.resources, ['/search']);
  assert.deepEqual(contract.authRequirement?.policy?.requireExplicitSlots, ['query']);
  assert.deepEqual(contract.executionGates, ['session_required']);
  assert.equal(contract.runtimeBinding?.providerId, 'zhihu_readonly_provider');
  assert.equal(contract.payloadTemplate?.slotBindings?.[0]?.name, 'query');
});

test('zhihu followed-users contract binds auth and readonly provider from host fallback', () => {
  const contract = buildExecutionContract({
    context: {
      site: {
        id: 'www.zhihu.com-6d8935fb',
        rootUrl: 'https://www.zhihu.com/',
        allowedDomains: ['www.zhihu.com'],
      },
      setupProfile: {
        knownSitePolicy: {},
      },
    },
    capability: {
      id: 'capability:www.zhihu.com-6d8935fb:read-followed-users',
      name: 'read followed users',
      status: 'active',
      action: 'read',
      object: 'followed users',
      risk_level: 'read_personal_medium',
      executionPlan: {
        id: 'plan:www.zhihu.com-6d8935fb:read-followed-users',
        steps: [
          { kind: 'read_sanitized_summary' },
        ],
      },
    },
    intents: [],
  });

  assert.equal(contract.authRequirement?.required, true);
  assert.equal(contract.authRequirement?.scopes?.[0]?.origin, 'https://www.zhihu.com');
  assert.deepEqual(contract.authRequirement?.scopes?.[0]?.resources, ['/follow']);
  assert.deepEqual(contract.executionGates, ['session_required']);
  assert.equal(contract.runtimeBinding?.providerId, 'zhihu_readonly_provider');
});

test('zhihu hot question and answer contracts bind readonly provider and route scopes', () => {
  const context = {
    site: {
      id: 'www.zhihu.com-6d8935fb',
      rootUrl: 'https://www.zhihu.com/',
      allowedDomains: ['www.zhihu.com'],
    },
    setupProfile: {
      knownSitePolicy: {},
    },
  };

  const hotContract = buildExecutionContract({
    context,
    capability: {
      id: 'capability:www.zhihu.com-6d8935fb:list-hot-posts',
      name: 'list hot posts',
      status: 'active',
      action: 'view',
      object: 'hot posts',
      risk_level: 'read_public_low',
      executionPlan: {
        id: 'plan:www.zhihu.com-6d8935fb:list-hot-posts',
        steps: [{ kind: 'read_sanitized_summary', routeTemplate: '/hot' }],
      },
    },
    intents: [],
  });
  assert.equal(hotContract.runtimeBinding?.providerId, 'zhihu_readonly_provider');
  assert.deepEqual(hotContract.authRequirement?.scopes?.[0]?.resources, ['/hot']);

  const questionContract = buildExecutionContract({
    context,
    capability: {
      id: 'capability:www.zhihu.com-6d8935fb:view-question-detail',
      name: 'view question detail',
      status: 'active',
      action: 'view',
      object: 'question detail',
      risk_level: 'read_public_low',
      inputs: [{ name: 'question_id', type: 'string', required: true }],
      executionPlan: {
        id: 'plan:www.zhihu.com-6d8935fb:view-question-detail',
        steps: [{ kind: 'read_sanitized_summary', routeTemplate: '/question/{question_id}' }],
      },
    },
    intents: [],
  });
  assert.equal(questionContract.runtimeBinding?.providerId, 'zhihu_readonly_provider');
  assert.deepEqual(questionContract.authRequirement?.scopes?.[0]?.resources, ['/question/{question_id}']);
  assert.deepEqual(questionContract.authRequirement?.policy?.requireExplicitSlots, ['question_id']);

  const answerContract = buildExecutionContract({
    context,
    capability: {
      id: 'capability:www.zhihu.com-6d8935fb:view-answer-detail',
      name: 'view answer detail',
      status: 'active',
      action: 'view',
      object: 'answer detail',
      risk_level: 'read_public_low',
      inputs: [
        { name: 'question_id', type: 'string', required: false },
        { name: 'answer_id', type: 'string', required: true },
      ],
      executionPlan: {
        id: 'plan:www.zhihu.com-6d8935fb:view-answer-detail',
        steps: [{ kind: 'read_sanitized_summary', routeTemplate: '/question/{question_id}/answer/{answer_id}' }],
      },
    },
    intents: [],
  });
  assert.equal(answerContract.runtimeBinding?.providerId, 'zhihu_readonly_provider');
  assert.deepEqual(answerContract.authRequirement?.scopes?.[0]?.resources, ['/question/{question_id}/answer/{answer_id}', '/answer/{answer_id}']);
  assert.deepEqual(answerContract.authRequirement?.policy?.requireExplicitSlots, ['answer_id']);
});
