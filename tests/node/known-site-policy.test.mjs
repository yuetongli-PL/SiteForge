import test from 'node:test';
import assert from 'node:assert/strict';

import {
  knownGenericLiveBuildSummary,
  knownPolicyBusinessCoverageModel,
  knownPolicyBusinessCoverageSeedRoutes,
  knownPolicyAllowsUserAuthorizedSetup,
  knownPolicyCapabilityPressure,
  knownPolicyPublicRouteTemplatePattern,
  knownPolicyPublicRouteTemplatePatterns,
  knownPolicyPublicSeedRoutes,
  knownPolicyPublicRouteTemplates,
  knownPolicyRecommendedCapabilities,
  knownPolicySummary,
} from '../../src/app/pipeline/build/known-site-policy.mjs';

test('known site policy summary merges registry and capability records without mutating inputs', () => {
  const registryRecord = {
    host: 'books.example',
    siteKey: 'books',
    adapterId: 'chapter-content',
    repoSkillDir: 'skills/books',
    siteArchetype: 'chapter-content',
    capabilityFamilies: ['navigate-to-content'],
    downloadTaskTypes: ['chapter-download'],
    genericLiveBuild: {
      status: 'blocked',
      reasonCode: 'robots-disallowed',
      alternativeAccessPaths: ['official-api'],
    },
  };
  const capabilityRecord = {
    host: 'books.example',
    siteKey: 'books',
    primaryArchetype: 'chapter-content',
    capabilityFamilies: ['navigate-to-chapter', 'search-content'],
    supportedIntents: ['search-content'],
    safeActionKinds: ['navigate'],
    approvalActionKinds: ['search-submit'],
    publicRouteTemplates: [{
      id: 'custom-search',
      pathTemplate: '/find/{query}',
      capabilityFamilies: ['search-content'],
    }],
  };

  const summary = knownPolicySummary(registryRecord, capabilityRecord);

  assert.equal(summary.status, 'matched');
  assert.equal(summary.siteKey, 'books');
  assert.equal(summary.repoSkillDir, 'skills/books');
  assert.deepEqual(summary.sources, ['config/site-registry.json', 'config/site-capabilities.json']);
  assert.deepEqual(summary.capabilityFamilies, [
    'navigate-to-chapter',
    'navigate-to-content',
    'search-content',
  ]);
  assert.deepEqual(summary.supportedIntents, ['search-content']);
  assert.deepEqual(summary.genericLiveBuild, {
    status: 'blocked',
    reasonCode: 'robots-disallowed',
    reason: null,
    alternativeAccessPaths: ['official-api'],
  });
  assert.equal(summary.publicRouteTemplates.some((route) => route.id === 'custom-search'), true);
  assert.equal(summary.publicRouteTemplates.some((route) => route.id === 'chapter-content-chapter-template'), true);

  summary.downloadTaskTypes.push('mutated');
  assert.deepEqual(registryRecord.downloadTaskTypes, ['chapter-download']);
});

test('known site policy generic live build summary preserves precedence and alternatives', () => {
  assert.equal(knownGenericLiveBuildSummary(null, null), null);

  assert.deepEqual(
    knownGenericLiveBuildSummary(
      {
        siteAccessStatus: 'blocked',
        unsupportedLiveReasonCode: 'registry-code',
        alternativeAccessPaths: ['registry-alt'],
      },
      {
        liveAccessStatus: 'available',
        liveAccessReasonCode: 'capability-code',
        alternativeAccessPaths: ['capability-alt', 'registry-alt'],
      },
    ),
    {
      status: 'blocked',
      reasonCode: 'registry-code',
      reason: null,
      alternativeAccessPaths: ['capability-alt', 'registry-alt'],
    },
  );
});

test('known site policy public route templates infer chapter-content routes', () => {
  assert.deepEqual(
    knownPolicyPublicRouteTemplates(
      {
        adapterId: 'chapter-content',
        capabilityFamilies: ['navigate-to-category', 'navigate-to-content'],
      },
      {
        capabilityFamilies: ['navigate-to-chapter', 'search-content'],
        supportedIntents: ['search-content'],
      },
    ).map((route) => route.id),
    [
      'chapter-content-book-template',
      'chapter-content-category-template',
      'chapter-content-chapter-template',
      'chapter-content-search-template',
    ],
  );
});

test('known site policy business coverage model groups seedable public routes by business area', () => {
  const model = knownPolicyBusinessCoverageModel({
    siteKey: 'catalog',
    adapterId: 'catalog-adapter',
    publicRouteTemplates: [
      { id: 'home', path: '/', pageType: 'home', capabilityFamilies: ['navigate-to-category'], seedable: true },
      { id: 'release', path: '/works/list/release', pageType: 'category-page', capabilityFamilies: ['navigate-to-category'], seedable: true },
      { id: 'genre', path: '/works/genre', pageType: 'category-page', capabilityFamilies: ['navigate-to-category'], seedable: true },
      { id: 'series', path: '/works/series', pageType: 'category-page', capabilityFamilies: ['navigate-to-category'], seedable: true },
      { id: 'label', path: '/works/label', pageType: 'category-page', capabilityFamilies: ['navigate-to-category'], seedable: true },
      { id: 'actress', path: '/actress', pageType: 'author-list-page', capabilityFamilies: ['navigate-to-author'], seedable: true },
      { id: 'detail-template', pathTemplate: '/works/detail/{workId}', pageType: 'book-detail-page', capabilityFamilies: ['navigate-to-content'], seedable: false },
      { id: 'privacy', path: '/privacy', pageType: 'utility-page', capabilityFamilies: ['navigate-to-utility-page'], seedable: true },
    ],
  });

  assert.equal(model.status, 'configured');
  assert.deepEqual(model.requiredGroupIds.sort(), [
    'genre-directory',
    'home',
    'label-directory',
    'person-directory',
    'policy-pages',
    'release-listings',
    'series-directory',
  ]);
  assert.deepEqual(model.templateOnlyGroupIds, ['detail-pages']);
  assert.equal(model.groups.some((group) => group.id === 'release-listings' && group.seedableRouteCount === 1), true);
});

test('known site policy public route projection keeps only sanitized same-site seeds', () => {
  const context = {
    site: {
      rootUrl: 'https://example.test/',
      allowedDomains: ['example.test'],
    },
    setupProfile: {
      knownSitePolicy: {
        publicRouteTemplates: [
          { path: '/category/1?token=secret', pageType: 'category-page', seedable: true },
          { path: 'https://evil.test/outside', pageType: 'external-page', seedable: true },
        ],
      },
    },
    crawlContract: {
      coverageTargets: {
        publicRoutes: ['/covered#section', 'https://example.test/category/1?sid=secret'],
      },
    },
  };

  assert.deepEqual(knownPolicyPublicSeedRoutes(context), [
    {
      path: '/category/1?token=secret',
      pageType: 'category-page',
      source: 'known_site_public_route_template',
      reasonCode: 'known-site-public-route',
      normalizedUrl: 'https://example.test/category/1',
    },
    {
      path: '/covered#section',
      pageType: null,
      source: 'coverage_target_public_route',
      reasonCode: 'coverage-target-public-route',
      normalizedUrl: 'https://example.test/covered',
    },
  ]);
});

test('known site policy public route template projection rejects unsafe templates', () => {
  const context = {
    setupProfile: {
      knownSitePolicy: {
        publicRouteTemplates: [
          { pathTemplate: '/book/{bookId}/', pageType: 'book-detail-page', seedable: false },
          { routeTemplate: '/category/{categoryId}//', pageType: 'category-page', seedable: true },
          { pathTemplate: '/session/{sessionId}', pageType: 'private-page', seedable: false },
          { pathTemplate: 'relative/{id}', pageType: 'relative-page', seedable: false },
        ],
      },
    },
  };

  assert.equal(knownPolicyPublicRouteTemplatePattern({ pathTemplate: '/book/{bookId}/' }), '/book/:id');
  assert.equal(knownPolicyPublicRouteTemplatePattern({ pathTemplate: '/session/{sessionId}' }), null);
  assert.deepEqual(knownPolicyPublicRouteTemplatePatterns(context), [
    {
      pattern: '/book/:id',
      pageType: 'book-detail-page',
      source: 'known_site_public_route_template',
      seedable: false,
    },
    {
      pattern: '/category/:id',
      pageType: 'category-page',
      source: 'known_site_public_seed_route_template',
      seedable: true,
    },
  ]);
});

test('known site policy pressure and user authorization gate stay deterministic', () => {
  const policy = knownPolicySummary(
    {
      siteKey: 'blocked-social',
      adapterId: 'blocked-social-adapter',
      capabilityFamilies: ['download-content'],
      downloadTaskTypes: ['social-archive'],
      downloadSessionRequirement: 'optional',
    },
    {
      capabilityFamilies: ['query-social-relations'],
      supportedIntents: ['query-social-content'],
      safeActionKinds: ['navigate'],
    },
  );

  assert.deepEqual(knownPolicyCapabilityPressure(policy), {
    schemaVersion: 1,
    siteKey: 'blocked-social',
    adapterId: 'blocked-social-adapter',
    sources: ['config/site-registry.json', 'config/site-capabilities.json'],
    hasPolicyCapabilities: true,
    matchedCapabilityFamilies: ['download-content', 'query-social-relations'],
    matchedSupportedIntents: ['query-social-content'],
    matchedDownloadTaskTypes: ['social-archive'],
  });
  assert.equal(knownPolicyAllowsUserAuthorizedSetup(policy), false);
  assert.equal(knownPolicyAllowsUserAuthorizedSetup({
    ...policy,
    downloadSessionRequirement: 'required',
  }), true);
  assert.equal(knownPolicyAllowsUserAuthorizedSetup({
    ...policy,
    routingNotes: ['Manual user login session is required.'],
  }), true);
});

test('known site policy recommended capabilities derive social candidates from policy and evidence', () => {
  assert.deepEqual(knownPolicyRecommendedCapabilities(null, { userAuthorized: true }), []);
  assert.deepEqual(
    knownPolicyRecommendedCapabilities({
      capabilityFamilies: ['query-social-content', 'query-social-relations', 'download-content'],
      supportedIntents: ['search-posts', 'list-notifications'],
    }, {
      userAuthorized: true,
      userAuthorizedEvidence: {
        browserSeeds: [{
          capabilityIds: ['list-bookmarks'],
        }],
      },
    }).map((capability) => [capability.id, capability.safety, capability.evidenceRequirement]),
    [
      ['list-followed-users', 'read_only', 'capability-specific-evidence'],
      ['list-followed-updates', 'read_only', 'capability-specific-evidence'],
      ['recommended-timeline-posts', 'read_only', 'capability-specific-evidence'],
      ['list-hot-posts', 'read_only', 'capability-specific-evidence'],
      ['list-profile-content', 'read_only', 'capability-specific-evidence'],
      ['search-posts', 'read_only', 'capability-specific-evidence'],
      ['list-notifications', 'read_only', 'capability-specific-evidence'],
      ['list-bookmarks', 'read_only', 'capability-specific-evidence'],
      ['download-content-candidate', 'requires_confirmation', 'capability-specific-evidence'],
    ],
  );
});

test('known site business coverage model emits sample seed routes for dynamic templates', () => {
  const summary = knownPolicySummary(
    {
      siteKey: 'zhihu',
      adapterId: 'zhihu',
      publicRouteTemplates: [
        {
          id: 'zhihu-hot',
          path: '/hot',
          pageType: 'category-page',
          businessArea: 'hot-ranking',
          capabilityIds: ['list-hot-posts'],
          tabStates: ['hot'],
          seedable: false,
        },
        {
          id: 'zhihu-question-template',
          samplePath: '/question/19550228',
          pathTemplate: '/question/{questionId}',
          pageType: 'content-detail-page',
          businessArea: 'question-detail',
          capabilityIds: ['view-question-detail'],
          tabStates: ['detail'],
          seedable: false,
        },
      ],
    },
    {
      supportedIntents: ['list-hot-posts', 'view-question-detail'],
      capabilityFamilies: ['query-social-content', 'navigate-to-category', 'navigate-to-content', 'query-comment-thread'],
    },
  );

  assert.equal(summary.businessCoverageModel.groupCount, 2);
  assert.deepEqual(knownPolicyBusinessCoverageSeedRoutes(summary).map((route) => [
    route.path,
    route.businessArea,
    route.capabilityIds,
    route.tabStates,
  ]), [
    ['/hot', 'hot-ranking', ['list-hot-posts'], ['hot']],
    ['/question/19550228', 'question-detail', ['view-question-detail'], ['detail']],
  ]);
});

test('known site policy recommends Zhihu-specific topic and profile tab candidates only for Zhihu', () => {
  const recommended = knownPolicyRecommendedCapabilities({
    siteKey: 'zhihu',
    capabilityFamilies: ['query-social-content', 'query-account-profile', 'query-social-relations', 'query-media-content'],
    supportedIntents: [
      'list-hot-broadcasts',
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
    ],
  }, { userAuthorized: true }).map((capability) => capability.id);

  for (const id of [
    'list-hot-broadcasts',
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
  ]) {
    assert.equal(recommended.includes(id), true, `${id} should be recommended for Zhihu`);
  }
});
