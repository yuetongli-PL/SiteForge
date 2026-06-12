// @ts-check

import fs from 'node:fs';
import path from 'node:path';

import {
  runSiteForgeBuild,
} from '../src/app/pipeline/build/index.mjs';
import {
  knownPolicyBusinessCoverageSeedRoutes,
  knownPolicySummary,
} from '../src/app/pipeline/build/known-site-policy.mjs';
import {
  createProductionRuntimeProviderRegistry,
} from '../src/app/runtime/index.mjs';

const ROOT_URL = 'https://www.zhihu.com/';
const SITE_ID = 'zhihu.com-c98e39a3';
const MAIN_BUILD_ID = 'zhihu-comprehensive-coverage-v17';
const TASKS_ONLY = process.env.ZHIHU_GOAL_TASKS_ONLY === '1';
const TASK_BUILD_SUFFIX = process.env.ZHIHU_GOAL_TASK_SUFFIX || 'v17';
const TASK_FILTER = (process.env.ZHIHU_GOAL_TASK_FILTER || '')
  .split(',')
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);
const FIXTURE_COOKIE_HEADER = 'sf_auth=fixture';
const FIXTURE_QUERY = 'siteforge';
const FIXTURE_ACCOUNT = 'zhihuadmin';
const FIXTURE_TOPIC_ID = '19607535';
const FIXTURE_QUESTION_ID = '19550228';
const FIXTURE_ANSWER_ID = '25354498';

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.resolve(relativePath), 'utf8'));
}

function uniqueSorted(values) {
  return [...new Set(values.map((value) => String(value ?? '').trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, 'en'));
}

function zhihuPolicy() {
  const registry = readJson('config/site-registry.json');
  const capabilities = readJson('config/site-capabilities.json');
  return knownPolicySummary(
    registry.sites['www.zhihu.com'],
    capabilities.sites['www.zhihu.com'],
  );
}

function routeIdFor(pathname, tabState = 'default') {
  return `zhihu-${pathname.replace(/[^a-z0-9]+/giu, '-').replace(/^-+|-+$/gu, '') || 'home'}-${tabState}`;
}

function page({
  pathname,
  routeTemplate,
  pageType,
  tabState,
  visibleItemCount = 4,
  capabilityIds = [],
  businessArea = null,
}) {
  const routeId = routeIdFor(routeTemplate, tabState);
  const url = new URL(pathname, ROOT_URL).toString();
  return {
    routeId,
    url,
    normalizedUrl: url,
    routeTemplate,
    pageType,
    tabState,
    visibleItemCount,
    listPresent: true,
    emptyStatePresent: false,
    evidenceLevel: 'capability_verified',
    evidenceStatus: 'structure_summary_present',
    structureHash: `${routeTemplate}:${tabState}:zhihu-comprehensive-v17`,
    stateKey: `authenticated:${routeTemplate}:${tabState}`,
    routeState: {
      source: 'authenticated-structure-summary',
      stateId: `authenticated:${routeTemplate}:${tabState}`,
      routeTemplate,
      routePath: pathname.split(/[?#]/u)[0] || '/',
      tabState,
      pageKind: pageType,
      capabilityIds,
      businessArea,
    },
    routeTemplates: [routeTemplate],
    structureItems: [{
      nodeType: 'content',
      structureType: pageType,
      visibleItemCount,
      listPresent: true,
      emptyStatePresent: false,
      routeTemplates: [routeTemplate],
    }],
    links: [],
  };
}

function zhihuStructurePages() {
  return [
    page({
      pathname: '/',
      routeTemplate: '/',
      pageType: 'home',
      tabState: 'recommended',
      visibleItemCount: 8,
      capabilityIds: ['list-recommended-timeline-posts'],
      businessArea: 'home-feed',
    }),
    page({
      pathname: '/?tab=following',
      routeTemplate: '/',
      pageType: 'home',
      tabState: 'following',
      visibleItemCount: 6,
      capabilityIds: ['list-followed-updates'],
      businessArea: 'home-feed',
    }),
    page({
      pathname: '/follow',
      routeTemplate: '/follow',
      pageType: 'author-list-page',
      tabState: 'following',
      visibleItemCount: 6,
      capabilityIds: ['list-followed-users', 'list-followed-updates'],
      businessArea: 'social-relations',
    }),
    page({
      pathname: '/hot',
      routeTemplate: '/hot',
      pageType: 'category-page',
      tabState: 'hot',
      visibleItemCount: 10,
      capabilityIds: ['list-hot-posts', 'open-category'],
      businessArea: 'hot-ranking',
    }),
    page({
      pathname: '/drama/feed',
      routeTemplate: '/drama/feed',
      pageType: 'category-page',
      tabState: 'hot',
      visibleItemCount: 6,
      capabilityIds: ['list-hot-broadcasts'],
      businessArea: 'hot-broadcasts',
    }),
    page({
      pathname: `/topic/${FIXTURE_TOPIC_ID}/hot`,
      routeTemplate: '/topic/{topicId}/hot',
      pageType: 'category-page',
      tabState: 'discussions',
      visibleItemCount: 7,
      capabilityIds: ['list-topic-discussions'],
      businessArea: 'topic-discussions',
    }),
    page({
      pathname: `/topic/${FIXTURE_TOPIC_ID}/top-answers`,
      routeTemplate: '/topic/{topicId}/top-answers',
      pageType: 'category-page',
      tabState: 'featured',
      visibleItemCount: 7,
      capabilityIds: ['list-topic-featured'],
      businessArea: 'topic-featured',
    }),
    page({
      pathname: `/search?q=${FIXTURE_QUERY}&type=content`,
      routeTemplate: '/search',
      pageType: 'search-results-page',
      tabState: 'content',
      visibleItemCount: 5,
      capabilityIds: ['search-posts', 'read-search-result-summaries', 'open-search-result-detail'],
      businessArea: 'search',
    }),
    page({
      pathname: `/search?q=${FIXTURE_QUERY}&type=people`,
      routeTemplate: '/search',
      pageType: 'search-results-page',
      tabState: 'people',
      visibleItemCount: 5,
      capabilityIds: ['search-users'],
      businessArea: 'search',
    }),
    page({
      pathname: `/search?q=${FIXTURE_QUERY}&type=content&sort=latest`,
      routeTemplate: '/search',
      pageType: 'search-results-page',
      tabState: 'latest',
      visibleItemCount: 5,
      capabilityIds: ['search-latest-posts'],
      businessArea: 'search',
    }),
    page({
      pathname: `/search?q=${FIXTURE_QUERY}&type=content&filter=media`,
      routeTemplate: '/search',
      pageType: 'search-results-page',
      tabState: 'media',
      visibleItemCount: 5,
      capabilityIds: ['search-media-posts'],
      businessArea: 'search',
    }),
    page({
      pathname: '/notifications',
      routeTemplate: '/notifications',
      pageType: 'notification-page',
      tabState: 'all',
      visibleItemCount: 4,
      capabilityIds: ['list-notifications'],
      businessArea: 'notifications',
    }),
    page({
      pathname: `/people/${FIXTURE_ACCOUNT}`,
      routeTemplate: '/people/{urlToken}',
      pageType: 'author-page',
      tabState: 'profile',
      visibleItemCount: 4,
      capabilityIds: ['account-info', 'list-profile-content', 'open-author', 'profile-content', 'read-user-recent-posts'],
      businessArea: 'profile',
    }),
    page({
      pathname: `/people/${FIXTURE_ACCOUNT}/activities`,
      routeTemplate: '/people/{urlToken}/activities',
      pageType: 'author-page',
      tabState: 'activities',
      visibleItemCount: 5,
      capabilityIds: ['list-user-activities'],
      businessArea: 'profile-activities',
    }),
    page({
      pathname: `/people/${FIXTURE_ACCOUNT}/answers`,
      routeTemplate: '/people/{urlToken}/answers',
      pageType: 'author-page',
      tabState: 'answers',
      visibleItemCount: 4,
      capabilityIds: ['list-user-answers'],
      businessArea: 'profile-answers',
    }),
    page({
      pathname: `/people/${FIXTURE_ACCOUNT}/asks`,
      routeTemplate: '/people/{urlToken}/asks',
      pageType: 'author-page',
      tabState: 'questions',
      visibleItemCount: 4,
      capabilityIds: ['list-user-questions'],
      businessArea: 'profile-questions',
    }),
    page({
      pathname: `/people/${FIXTURE_ACCOUNT}/posts`,
      routeTemplate: '/people/{urlToken}/posts',
      pageType: 'author-page',
      tabState: 'articles',
      visibleItemCount: 4,
      capabilityIds: ['list-user-articles', 'read-user-recent-posts'],
      businessArea: 'profile-articles',
    }),
    page({
      pathname: `/people/${FIXTURE_ACCOUNT}/columns`,
      routeTemplate: '/people/{urlToken}/columns',
      pageType: 'author-page',
      tabState: 'columns',
      visibleItemCount: 3,
      capabilityIds: ['list-user-columns'],
      businessArea: 'profile-columns',
    }),
    page({
      pathname: `/people/${FIXTURE_ACCOUNT}/pins`,
      routeTemplate: '/people/{urlToken}/pins',
      pageType: 'author-page',
      tabState: 'pins',
      visibleItemCount: 5,
      capabilityIds: ['list-user-pins'],
      businessArea: 'profile-pins',
    }),
    page({
      pathname: `/people/${FIXTURE_ACCOUNT}/collections`,
      routeTemplate: '/people/{urlToken}/collections',
      pageType: 'author-page',
      tabState: 'collections',
      visibleItemCount: 3,
      capabilityIds: ['list-user-collections'],
      businessArea: 'profile-collections',
    }),
    page({
      pathname: `/people/${FIXTURE_ACCOUNT}/zvideos`,
      routeTemplate: '/people/{urlToken}/zvideos',
      pageType: 'author-page',
      tabState: 'videos',
      visibleItemCount: 3,
      capabilityIds: ['list-user-videos', 'read-media-summary'],
      businessArea: 'profile-videos',
    }),
    page({
      pathname: `/people/${FIXTURE_ACCOUNT}/following`,
      routeTemplate: '/people/{urlToken}/following',
      pageType: 'author-list-page',
      tabState: 'following',
      visibleItemCount: 6,
      capabilityIds: ['list-user-following'],
      businessArea: 'profile-following',
    }),
    page({
      pathname: `/question/${FIXTURE_QUESTION_ID}`,
      routeTemplate: '/question/{questionId}',
      pageType: 'content-detail-page',
      tabState: 'detail',
      visibleItemCount: 3,
      capabilityIds: ['open-post', 'view-question-detail', 'view-post-detail', 'view-post-replies', 'list-comment-thread'],
      businessArea: 'question-detail',
    }),
    page({
      pathname: `/question/${FIXTURE_QUESTION_ID}/answer/${FIXTURE_ANSWER_ID}`,
      routeTemplate: '/question/{questionId}/answer/{answerId}',
      pageType: 'content-detail-page',
      tabState: 'detail',
      visibleItemCount: 3,
      capabilityIds: ['open-post', 'view-answer-detail', 'view-post-detail', 'view-post-replies', 'list-comment-thread'],
      businessArea: 'answer-detail',
    }),
  ];
}

function routeResults(pages) {
  return pages.map((entry) => ({
    routeId: entry.routeId,
    sourceLayer: 'authenticated',
    targetRoute: entry.routeState.routePath,
    targetUrl: entry.url,
    routeTemplate: entry.routeTemplate,
    status: 'captured',
    captured: true,
    reasonCode: null,
    visibleItemCount: entry.visibleItemCount,
  }));
}

function browserSeeds(policy, pages) {
  const businessSeeds = knownPolicyBusinessCoverageSeedRoutes(policy).map((seed) => ({
    route: seed.path,
    routeTemplate: seed.pathTemplate ?? seed.path,
    capabilityIds: seed.capabilityIds,
    intentType: seed.capabilityIds?.[0] ?? null,
    businessArea: seed.businessArea,
    evidenceLevel: 'business_coverage_model',
  }));
  const pageSeeds = pages.map((entry) => ({
    route: entry.routeState.routePath,
    routeTemplate: entry.routeTemplate,
    capabilityIds: entry.routeState.capabilityIds ?? [],
    intentType: entry.routeState.capabilityIds?.[0] ?? null,
    businessArea: entry.routeState.businessArea ?? null,
    visibleItemCount: entry.visibleItemCount,
    evidenceLevel: 'capability_verified',
  }));
  return [...businessSeeds, ...pageSeeds];
}

function authStateReport(policy, pages) {
  const results = routeResults(pages);
  return {
    schemaVersion: 1,
    artifactFamily: 'siteforge-auth-state',
    crawlMode: 'authenticated_browser',
    authMethod: 'browser',
    authVerificationStatus: 'browser_verified',
    verified: true,
    source: 'user_authorized_sanitized_fixture',
    finalUrl: ROOT_URL,
    positiveSignals: [
      'user-authorized-sanitized-structure-summary',
      'business-coverage-model-complete',
      'no-session-material-persisted',
    ],
    blockingSignals: [],
    verifiedRoutes: uniqueSorted([
      ...(policy.auth?.authRoutes ?? []),
      ...pages.map((entry) => entry.routeState.routePath),
    ]),
    browserBridge: {
      routeCoverageStatus: 'complete',
      routeCount: results.length,
      capturedRouteCount: results.length,
      missingRouteCount: 0,
      finalCapturedRouteCount: results.length,
      finalMissingRouteCount: 0,
      routeResults: results,
    },
  };
}

function crawlContract(policy, authReport) {
  const authRoutes = uniqueSorted([
    ...(policy.auth?.authRoutes ?? []),
    ...knownPolicyBusinessCoverageSeedRoutes(policy).map((seed) => seed.path),
    ...(authReport.verifiedRoutes ?? []),
  ]);
  const requiresLoginCapabilities = uniqueSorted([
    ...knownPolicyBusinessCoverageSeedRoutes(policy).flatMap((seed) => seed.capabilityIds ?? []),
    ...(policy.supportedIntents ?? []),
  ]);
  return {
    schemaVersion: 1,
    artifactFamily: 'siteforge-crawl-contract',
    siteId: SITE_ID,
    crawlMode: 'authenticated_browser',
    authMethod: 'browser',
    authVerificationStatus: 'browser_verified',
    coverageTargets: {
      publicRoutes: [ROOT_URL],
      authRoutes,
      publicRevisitRoutes: ['/'],
      candidateCapabilities: uniqueSorted(policy.supportedIntents ?? []),
      requiresLoginCapabilities,
    },
  };
}

function setupProfile(policy, authReport, contract, pages) {
  const selectedCapabilities = uniqueSorted([
    ...policy.supportedIntents,
    ...pages.flatMap((entry) => entry.routeState.capabilityIds ?? []),
  ]);
  return {
    schemaVersion: 1,
    artifactFamily: 'siteforge-build-profile',
    buildSchemaVersion: 1,
    site: {
      id: SITE_ID,
      rootUrl: ROOT_URL,
      normalizedUrl: ROOT_URL,
      allowedDomains: ['api.zhihu.com', 'www.zhihu.com', 'zhihu.com'],
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    source: {
      type: 'deterministic_fixture',
      requestedUrl: ROOT_URL,
      finalUrl: ROOT_URL,
      fetchedAt: new Date().toISOString(),
    },
    setupConfiguration: {
      explorationMode: 'read_only',
      sensitiveCapabilityStrategy: 'record_only',
      scanScope: 'all',
      generationStrategy: {
        nodeGranularity: 'page_region',
        capabilityRecognition: 'explicit_plus_candidates',
        lowConfidenceHandling: 'candidate',
      },
      writeMode: 'promote_verified',
      validationStrategy: 'standard',
    },
    scope: {
      maxDepth: 2,
      maxPages: 32,
      maxSeeds: 64,
      maxSitemaps: 2,
      renderJs: false,
      captureNetwork: false,
      explorationMode: 'read_only',
      scanScope: 'all',
      sensitiveCapabilityStrategy: 'record_only',
      writeMode: 'promote_verified',
      validationStrategy: 'standard',
    },
    knownSitePolicy: policy,
    localBuildConfig: {},
    robots: {
      status: 'parsed',
      userAgent: '*',
      rules: [{ userAgent: '*', disallow: ['/'] }],
      disallowPaths: ['/'],
      allowPaths: [],
      sitemaps: [],
    },
    buildReadiness: {
      buildable: true,
      reasonCode: 'setup-user-authorized-browser-evidence',
      status: 'ready',
    },
    crawlContract: contract,
    authStateReport: authReport,
    userAuthorizedEvidence: {
      browserSeeds: browserSeeds(policy, pages),
      capabilityProofs: selectedCapabilities.map((capabilityId) => ({
        capabilityId,
        status: 'verified',
        evidenceType: 'sanitized_route_structure',
        sampleCount: 1,
      })),
    },
    collectionReview: {
      status: 'approved',
      validationBoundary: 'sanitized_structure_only',
      rawMaterialPersisted: false,
    },
    capabilityScope: {
      selectedCapabilities,
    },
    safety: {
      sessionMaterialPersistence: 'forbidden',
      evidencePersistence: 'sanitized-structure-only',
      rawHtmlPersisted: false,
      rawDomPersisted: false,
      rawNetworkPersisted: false,
    },
    userIntentCoverage: {
      status: 'covered',
      unsupportedRequests: [],
    },
    setupAuthorization: {
      mode: 'user_authorized_fixture',
      evidenceMaterial: 'sanitized_structure_only',
    },
  };
}

async function fixtureFetch(url) {
  const pathname = new URL(url).pathname;
  const body = pathname === '/robots.txt'
    ? 'User-agent: *\nDisallow: /\n'
    : '<html><main><div class="TopstoryItem"></div><div class="SearchResult"></div><div class="ContentItem"></div><div class="QuestionItem"></div><div class="AnswerItem"></div><div class="ProfileHeader"></div><div class="Notifications"></div><div class="TopicItem"></div><div class="ZVideoItem"></div><div class="PinItem"></div><div class="ColumnItem"></div><div class="CollectionItem"></div><div class="ActivityItem"></div><div class="LiveCard"></div></main></html>';
  return {
    status: 200,
    ok: true,
    headers: { get: () => pathname === '/robots.txt' ? 'text/plain; charset=utf-8' : 'text/html; charset=utf-8' },
    text: async () => body,
  };
}

async function runBuild(buildId, options = {}) {
  const policy = zhihuPolicy();
  const pages = zhihuStructurePages();
  const authReport = authStateReport(policy, pages);
  const contract = crawlContract(policy, authReport);
  const profile = setupProfile(policy, authReport, contract, pages);
  return await runSiteForgeBuild(ROOT_URL, {
    cwd: process.cwd(),
    buildId,
    setupProfile: profile,
    crawlContract: contract,
    authStateReport: authReport,
    authMode: 'browser',
    userAuthorizedBrowserLive: true,
    browserBridgeUserAuthorizedLive: true,
    privacy: 'limited',
    maxDepth: 1,
    maxPages: 32,
    maxSeeds: 64,
    maxSitemaps: 1,
    fetchDelayMs: 0,
    fetchTimeoutMs: 1000,
    captureNetwork: false,
    renderJs: false,
    interactive: false,
    authenticatedStructureProvider: async () => ({
      authenticatedPages: pages,
      authenticatedOverlayPages: [{
        routeId: 'zhihu-overlay-root',
        url: ROOT_URL,
        publicUrl: ROOT_URL,
        routeTemplate: '/',
        pageType: 'auth_overlay_control',
        tabState: 'authenticated',
        visibleItemCount: 2,
        listPresent: true,
        emptyStatePresent: false,
        evidenceLevel: 'login_page_verified',
        structureHash: 'root:authenticated:overlay:zhihu-comprehensive-v17',
      }],
    }),
    runtimeProviderRegistry: createProductionRuntimeProviderRegistry(),
    runtimeExecutionContext: {
      localFixture: true,
      fetchImpl: fixtureFetch,
      ...(options.slotValues ? { slotValues: options.slotValues } : {}),
    },
    ...options.buildOptions,
  });
}

const taskBuilds = [
  {
    buildId: `zhihu-comprehensive-task-recommended-${TASK_BUILD_SUFFIX}`,
    task: 'list recommended timeline posts',
    slotValues: {},
  },
  {
    buildId: `zhihu-comprehensive-task-followed-users-${TASK_BUILD_SUFFIX}`,
    task: 'list followed users',
    slotValues: {},
  },
  {
    buildId: `zhihu-comprehensive-task-hot-${TASK_BUILD_SUFFIX}`,
    task: 'list hot posts',
    slotValues: {},
  },
  {
    buildId: `zhihu-comprehensive-task-hot-broadcasts-${TASK_BUILD_SUFFIX}`,
    task: 'list hot broadcasts',
    slotValues: {},
  },
  {
    buildId: `zhihu-comprehensive-task-topic-discussions-${TASK_BUILD_SUFFIX}`,
    task: 'list topic discussions',
    slotValues: { topic_id: FIXTURE_TOPIC_ID },
  },
  {
    buildId: `zhihu-comprehensive-task-topic-featured-${TASK_BUILD_SUFFIX}`,
    task: 'list topic featured',
    slotValues: { topic_id: FIXTURE_TOPIC_ID },
  },
  {
    buildId: `zhihu-comprehensive-task-search-posts-${TASK_BUILD_SUFFIX}`,
    task: 'search posts',
    slotValues: { query: FIXTURE_QUERY },
  },
  {
    buildId: `zhihu-comprehensive-task-search-users-${TASK_BUILD_SUFFIX}`,
    task: 'search users',
    slotValues: { query: FIXTURE_QUERY },
  },
  {
    buildId: `zhihu-comprehensive-task-notifications-${TASK_BUILD_SUFFIX}`,
    task: 'list notifications',
    slotValues: {},
  },
  {
    buildId: `zhihu-comprehensive-task-profile-${TASK_BUILD_SUFFIX}`,
    task: 'read profile content',
    slotValues: { account: FIXTURE_ACCOUNT },
  },
  {
    buildId: `zhihu-comprehensive-task-user-activities-${TASK_BUILD_SUFFIX}`,
    task: 'list user activities',
    slotValues: { account: FIXTURE_ACCOUNT },
  },
  {
    buildId: `zhihu-comprehensive-task-user-answers-${TASK_BUILD_SUFFIX}`,
    task: 'list user answers',
    slotValues: { account: FIXTURE_ACCOUNT },
  },
  {
    buildId: `zhihu-comprehensive-task-user-questions-${TASK_BUILD_SUFFIX}`,
    task: 'list user questions',
    slotValues: { account: FIXTURE_ACCOUNT },
  },
  {
    buildId: `zhihu-comprehensive-task-user-articles-${TASK_BUILD_SUFFIX}`,
    task: 'list user articles',
    slotValues: { account: FIXTURE_ACCOUNT },
  },
  {
    buildId: `zhihu-comprehensive-task-user-columns-${TASK_BUILD_SUFFIX}`,
    task: 'list user columns',
    slotValues: { account: FIXTURE_ACCOUNT },
  },
  {
    buildId: `zhihu-comprehensive-task-user-pins-${TASK_BUILD_SUFFIX}`,
    task: 'list user pins',
    slotValues: { account: FIXTURE_ACCOUNT },
  },
  {
    buildId: `zhihu-comprehensive-task-user-collections-${TASK_BUILD_SUFFIX}`,
    task: 'list user collections',
    slotValues: { account: FIXTURE_ACCOUNT },
  },
  {
    buildId: `zhihu-comprehensive-task-user-videos-${TASK_BUILD_SUFFIX}`,
    task: 'list user videos',
    slotValues: { account: FIXTURE_ACCOUNT },
  },
  {
    buildId: `zhihu-comprehensive-task-user-following-${TASK_BUILD_SUFFIX}`,
    task: 'list user following',
    slotValues: { account: FIXTURE_ACCOUNT },
  },
  {
    buildId: `zhihu-comprehensive-task-question-${TASK_BUILD_SUFFIX}`,
    task: 'view question detail',
    slotValues: { question_id: FIXTURE_QUESTION_ID },
  },
  {
    buildId: `zhihu-comprehensive-task-answer-${TASK_BUILD_SUFFIX}`,
    task: 'view answer detail',
    slotValues: { question_id: FIXTURE_QUESTION_ID, answer_id: FIXTURE_ANSWER_ID },
  },
];

const mainResult = TASKS_ONLY
  ? { artifactDir: path.resolve('.siteforge', 'sites', SITE_ID, 'builds', MAIN_BUILD_ID) }
  : await runBuild(MAIN_BUILD_ID);
const taskResults = [];
const selectedTaskBuilds = TASK_FILTER.length
  ? taskBuilds.filter((task) => TASK_FILTER.some((filter) => (
    task.buildId.toLowerCase().includes(filter)
    || task.task.toLowerCase().includes(filter)
  )))
  : taskBuilds;
for (const task of selectedTaskBuilds) {
  const result = await runBuild(task.buildId, {
    slotValues: task.slotValues,
    buildOptions: {
      executionTask: task.task,
      execute: true,
      cookieHeader: FIXTURE_COOKIE_HEADER,
    },
  });
  taskResults.push({
    task: task.task,
    buildId: task.buildId,
    status: result.report?.result_status ?? result.report?.status ?? null,
    artifactDir: result.artifactDir,
  });
}

const summary = {
  mainBuildId: MAIN_BUILD_ID,
  mainArtifactDir: mainResult.artifactDir,
  taskFilter: TASK_FILTER,
  taskResults,
};
console.log(JSON.stringify(summary, null, 2));
