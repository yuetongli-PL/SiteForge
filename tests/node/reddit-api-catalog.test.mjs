import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  buildRedditApiEndpointUrl,
  buildRedditApiRequestPlan,
  buildRedditAuthorizedSourceConfig,
  buildRedditComprehensiveCoverageReport,
  buildRedditCoverageAudit,
  buildRedditRuntimePlanIndex,
  countRedditRegisteredRuntimePlans,
  executeRedditApiReadPlan,
  findRedditApiOperation,
  parseRedditOfficialApiCatalog,
  writeRedditRuntimeSkillRegistration,
} from '../../src/sites/known-sites/reddit/api-catalog.mjs';
import { listSiteAdapters, resolveSiteAdapter } from '../../src/sites/adapters/resolver.mjs';
import { API_CANDIDATE_SCHEMA_VERSION } from '../../src/domain/capabilities/api-candidates.mjs';
import { REDACTION_PLACEHOLDER } from '../../src/domain/sessions/security-guard.mjs';

const FIXTURE_HTML = `
<html><body>
<h2 id="section_account">account</h2>
<div class="endpoint" id="GET_api_v1_me"><div class="links"><a href="#GET_api_v1_me">#</a></div>
<h3><span class="method">GET&nbsp;</span>/api/v1/me<span class="oauth-scope-list"><a href="https://github.com/reddit/reddit/wiki/OAuth2"><span class="api-badge oauth-scope">identity</span></a></span></h3>
<div class="info"><div class="md"><p>Get the current user.</p></div></div></div>
<h2 id="section_listings">listings</h2>
<div class="endpoint" id="GET_comments_{article}"><div class="links"><a href="#GET_comments_{article}">#</a></div>
<h3><span class="method">GET&nbsp;</span>[/r/<em class="placeholder">subreddit</em>]/comments/<em class="placeholder">article</em><span class="oauth-scope-list"><a href="https://github.com/reddit/reddit/wiki/OAuth2"><span class="api-badge oauth-scope">read</span></a></span><a href="https://www.reddit.com/wiki/rss"><span class="api-badge rss-support">rss support</span></a></h3>
<div class="info"><div class="md"><p><em>This endpoint is <a href="#listings">a listing</a>.</em></p></div>
<table class="parameters"><tr><th scope="row">limit</th><td><p>integer</p></td></tr></table></div></div>
<h2 id="section_links_and_comments">links &amp; comments</h2>
<div class="endpoint" id="POST_api_submit"><div class="links"><a href="#POST_api_submit">#</a></div>
<h3><span class="method">POST&nbsp;</span>/api/submit<span class="oauth-scope-list"><a href="https://github.com/reddit/reddit/wiki/OAuth2"><span class="api-badge oauth-scope">submit</span></a></span></h3>
<div class="info"><table class="parameters"><tr><th scope="row">title</th><td><p>title</p></td></tr></table></div></div>
</body></html>`;

function createSyntheticCandidate(overrides = {}) {
  return {
    schemaVersion: API_CANDIDATE_SCHEMA_VERSION,
    id: 'candidate-1',
    siteKey: 'reddit',
    status: 'candidate',
    endpoint: {
      method: 'GET',
      url: 'https://oauth.reddit.com/api/v1/me?access_token=synthetic-reddit-token',
    },
    request: {
      headers: {
        authorization: 'Bearer synthetic-reddit-token',
      },
    },
    ...overrides,
  };
}

test('Reddit official API catalog parses scopes, optional subreddit routes, and disabled writes', () => {
  const catalog = parseRedditOfficialApiCatalog(FIXTURE_HTML, {
    generatedAt: '2026-05-30T00:00:00.000Z',
  });

  assert.equal(catalog.operationCount, 3);
  assert.deepEqual(catalog.methodCounts, { GET: 2, POST: 1 });
  assert.equal(catalog.oauthScopeCounts.identity, 1);
  assert.equal(catalog.oauthScopeCounts.read, 1);
  assert.equal(catalog.oauthScopeCounts.submit, 1);
  assert.equal(catalog.executableSummary.getTemplates, 2);
  assert.equal(catalog.executableSummary.runtimeReadyApiRequestPlans, 2);
  assert.equal(catalog.executableSummary.writeTemplatesRecordedDisabled, 1);

  const comments = findRedditApiOperation(catalog, {
    method: 'GET',
    pathTemplate: '[/r/:subreddit]/comments/:article',
  });
  assert.notEqual(comments, null);
  assert.deepEqual(comments.oauthEndpointTemplates, [
    'https://oauth.reddit.com/comments/{article}',
    'https://oauth.reddit.com/r/{subreddit}/comments/{article}',
  ]);
  assert.equal(comments.parameters.find((param) => param.name === 'subreddit')?.required, false);
  assert.equal(comments.parameters.find((param) => param.name === 'article')?.required, true);
});

test('Reddit API request plans resolve GET URLs and keep writes disabled', () => {
  const catalog = parseRedditOfficialApiCatalog(FIXTURE_HTML);
  const comments = findRedditApiOperation(catalog, {
    method: 'GET',
    pathTemplate: '[/r/:subreddit]/comments/:article',
  });
  const submit = findRedditApiOperation(catalog, {
    method: 'POST',
    pathTemplate: '/api/submit',
  });

  assert.equal(buildRedditApiEndpointUrl(comments, {
    pathParams: { article: 'abc123' },
    query: { limit: 10 },
  }), 'https://oauth.reddit.com/comments/abc123?limit=10');
  assert.equal(buildRedditApiEndpointUrl(comments, {
    pathParams: { subreddit: 'siteforge', article: 'abc123' },
    templateIndex: 1,
  }), 'https://oauth.reddit.com/r/siteforge/comments/abc123');

  const readPlan = buildRedditApiRequestPlan(comments, {
    pathParams: { subreddit: 'siteforge', article: 'abc123' },
    templateIndex: 1,
  });
  assert.equal(readPlan.executable, true);
  assert.equal(readPlan.method, 'GET');
  assert.equal(readPlan.persistAuthorization, false);

  const writePlan = buildRedditApiRequestPlan(submit);
  assert.equal(writePlan.executable, false);
  assert.equal(writePlan.blockedReason, 'write_method_disabled_by_default');
});

test('Reddit API read execution requires explicit OAuth token and summarizes responses only', async () => {
  const catalog = parseRedditOfficialApiCatalog(FIXTURE_HTML);
  const me = findRedditApiOperation(catalog, { method: 'GET', pathTemplate: '/api/v1/me' });
  const plan = buildRedditApiRequestPlan(me);

  const blocked = await executeRedditApiReadPlan(plan, {
    fetchImpl: async () => {
      throw new Error('fetch should not run without credentials');
    },
  });
  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.reasonCode, 'reddit_oauth_bearer_token_required');

  let authHeader = null;
  const result = await executeRedditApiReadPlan(plan, {
    bearerToken: 'synthetic-reddit-token',
    userAgent: 'SiteForgeTest/0.1',
    fetchImpl: async (_url, options) => {
      authHeader = options.headers.authorization;
      return {
        ok: true,
        status: 200,
        headers: new Map([['content-type', 'application/json']]),
        text: async () => JSON.stringify({ name: 'tester', token: 'body-token-is-not-persisted' }),
      };
    },
  });

  assert.equal(authHeader, 'Bearer synthetic-reddit-token');
  assert.equal(result.status, 'success');
  assert.equal(result.bodySummary.kind, 'json_object');
  assert.equal(JSON.stringify(result).includes('synthetic-reddit-token'), false);
  assert.equal(JSON.stringify(result).includes('body-token-is-not-persisted'), false);
});

test('Reddit adapter validates read-only official API candidates and rejects writes', () => {
  const adapter = listSiteAdapters().find((candidate) => candidate.id === 'reddit');
  assert.notEqual(adapter, undefined);
  assert.equal(resolveSiteAdapter({ host: 'oauth.reddit.com' }).id, 'reddit');

  const accepted = adapter.validateApiCandidate({
    candidate: createSyntheticCandidate(),
    evidence: {
      authorization: 'Bearer synthetic-reddit-token',
    },
  });
  assert.equal(accepted.decision, 'accepted');
  assert.equal(accepted.adapterId, 'reddit');
  assert.equal(accepted.scope.validationMode, 'reddit-official-api-read-candidate');
  assert.equal(accepted.evidence.authorization, REDACTION_PLACEHOLDER);

  const rejectedWrite = adapter.validateApiCandidate({
    candidate: createSyntheticCandidate({
      id: 'reddit-write-candidate',
      endpoint: {
        method: 'POST',
        url: 'https://oauth.reddit.com/api/submit',
      },
    }),
  });
  assert.equal(rejectedWrite.decision, 'rejected');
  assert.equal(rejectedWrite.reasonCode, 'api-verification-failed');
});

test('Reddit coverage audit separates official API coverage from live crawl gaps', () => {
  const catalog = parseRedditOfficialApiCatalog(FIXTURE_HTML, {
    generatedAt: '2026-05-30T00:00:00.000Z',
  });
  const audit = buildRedditCoverageAudit(catalog, {
    generatedAt: '2026-05-30T00:00:00.000Z',
    robots: { disallowAllForGenericUserAgent: true },
    authorizedSourceManifest: {
      pages: [
        {
          routeTemplate: '/dev/api',
          pageType: 'api_documentation_index',
          routeTemplates: ['/dev/api/:section'],
          links: [
            {
              href: 'https://www.reddit.com/dev/api/account',
              normalizedHref: 'https://www.reddit.com/dev/api/account',
              label: 'account',
              semanticKind: 'api_section',
              routeTemplate: '/dev/api/:section',
            },
          ],
          forms: [
            {
              label: 'reddit search',
              method: 'GET',
              action: 'https://www.reddit.com/search',
              inputs: [{ name: 'q' }],
            },
          ],
          controls: [
            { kind: 'button', name: 'log_in', label: 'log in' },
          ],
        },
      ],
    },
  });

  assert.equal(audit.summary.apiOperations, 3);
  assert.equal(audit.summary.apiReadTemplatesExecutableWithOauth, 2);
  assert.equal(audit.summary.runtimeReadyApiRequestPlans, 2);
  assert.equal(audit.summary.apiWriteTemplatesDisabled, 1);
  assert.equal(audit.summary.authorizedSourceUniqueLinks, 1);
  assert.equal(audit.summary.authorizedSourceForms, 1);
  assert.equal(audit.status.genericLiveCrawl, 'blocked_by_robots');
  assert.equal(audit.status.siteActionApiReadRuntime, 'template_ready_needs_oauth');
  assert.equal(audit.status.siteforgeOauthApiRequestRuntime, 'runtime_ready_needs_registry_binding');
  assert.equal(audit.status.siteforgeGenericApiRequestRuntime, 'not_registered');
  assert.equal(
    audit.apiOperationCoverage.find((operation) => operation.pathTemplate === '/api/submit')?.coverageStatus,
    'write_or_state_change_disabled_by_default',
  );
  assert.equal(
    audit.requirementAudit.find((item) => item.requirement === 'Generic live crawl all reddit.com links')?.status,
    'blocked_by_robots',
  );

  const partialAudit = buildRedditCoverageAudit(catalog, {
    registeredRuntimePlanCount: 1,
  });
  assert.equal(partialAudit.status.siteforgeOauthApiRequestRuntime, 'registered_partial_runtime_templates_remaining');
  assert.equal(
    partialAudit.requirementAudit.find((item) => item.requirement === 'Register executable api_request plans in generic SiteForge runtime')?.evidenceCount,
    1,
  );
});

test('Reddit authorized source config expands site surfaces and official API operation pages without secrets', () => {
  const catalog = parseRedditOfficialApiCatalog(FIXTURE_HTML, {
    generatedAt: '2026-05-30T00:00:00.000Z',
  });
  const config = buildRedditAuthorizedSourceConfig(catalog, {
    generatedAt: '2026-05-30T00:00:00.000Z',
  });

  assert.equal(config.summary.officialApiOperationPages, 3);
  assert.equal(config.summary.readOperationPages, 2);
  assert.equal(config.summary.writeOperationPagesDisabled, 1);
  assert.ok(config.summary.siteSurfacePages >= 8);
  assert.equal(config.siteforgeLocalConfig.sites.length, 1);
  assert.equal(config.siteforgeLocalConfig.sites[0].url, 'https://www.reddit.com/');
  assert.equal(config.siteforgeLocalConfig.sites[0].auth.mode, 'none');
  assert.equal(config.siteforgeLocalConfig.sites[0].authorizedSources.length, 2);
  assert.equal(config.siteforgeLocalConfig.sites[0].authorizedSources[0].genericCrawlAllowed, undefined);
  assert.equal(config.siteforgeLocalConfig.sites[0].authorizedSources[1].structurePages.length, 3);
  assert.equal(
    config.siteforgeLocalConfig.sites[0].authorizedSources[1].structurePages
      .every((page) => page.routeTemplate.startsWith('/dev/api/operation/reddit-api-')),
    true,
  );
  assert.equal(
    config.siteforgeLocalConfig.sites[0].authorizedSources[1].structurePages
      .some((page) => page.pageType === 'official_api_write_operation_disabled'),
    true,
  );
  const writePage = config.siteforgeLocalConfig.sites[0].authorizedSources[1].structurePages
    .find((page) => page.pageType === 'official_api_write_operation_disabled');
  assert.notEqual(writePage, undefined);
  assert.deepEqual(writePage.routeTemplates, [writePage.routeTemplate]);
  assert.equal(writePage.routeTemplates.includes('/api/submit'), false);
  assert.deepEqual(writePage.disabledOperationPathTemplates, ['/api/submit']);
  assert.equal(writePage.links[0].routeTemplate, writePage.routeTemplate);
  const serialized = JSON.stringify(config);
  assert.equal(serialized.includes('reddit_session='), false);
  assert.equal(serialized.includes('Bearer '), false);
  assert.equal(serialized.includes('access_token='), false);
});

test('Reddit repo policy uses social discussion semantics instead of book catalog semantics', async () => {
  const registry = JSON.parse(await readFile(path.resolve('config/site-registry.json'), 'utf8'));
  const capabilities = JSON.parse(await readFile(path.resolve('config/site-capabilities.json'), 'utf8'));
  const registryPolicy = registry.sites['www.reddit.com'];
  const capabilityPolicy = capabilities.sites['www.reddit.com'];

  assert.equal(registryPolicy.siteKey, 'reddit');
  assert.equal(registryPolicy.adapterId, 'reddit');
  assert.equal(registryPolicy.siteArchetype, 'social-content');
  assert.equal(capabilityPolicy.primaryArchetype, 'social-content');
  assert.equal(capabilityPolicy.capabilityFamilies.includes('query-social-content'), true);
  assert.equal(capabilityPolicy.capabilityFamilies.includes('query-social-relations'), true);
  assert.equal(capabilityPolicy.supportedIntents.includes('search-posts'), true);
  assert.equal(capabilityPolicy.supportedIntents.includes('open-post'), true);
  assert.equal(capabilityPolicy.supportedIntents.includes('open-book'), false);
  assert.equal(capabilityPolicy.supportedIntents.includes('search-book'), false);
});

test('Reddit comprehensive coverage report merges execution-mode evidence without overstating completion', () => {
  const catalog = parseRedditOfficialApiCatalog(FIXTURE_HTML, {
    generatedAt: '2026-05-30T00:00:00.000Z',
  });
  const index = buildRedditRuntimePlanIndex(catalog, {
    generatedAt: '2026-05-30T00:00:00.000Z',
    registeredRuntimePlanCount: 2,
  });
  const report = buildRedditComprehensiveCoverageReport(catalog, {
    generatedAt: '2026-05-30T00:00:00.000Z',
    runtimeIndex: index,
    registry: {
      skills: [{
        skillId: 'reddit-oauth-api-runtime',
        verificationStatus: 'passed',
        runtimeModes: ['reddit_oauth_read_runtime'],
        runtimeSummary: { redditOauthReadIntents: 2 },
        intents: [
          { runtimeMode: 'reddit_oauth_read_runtime', executionPlanId: 'plan:reddit-oauth:api-v1-me' },
          { runtimeMode: 'reddit_oauth_read_runtime', executionPlanId: 'plan:reddit-oauth:comments-article' },
        ],
      }],
    },
    coverageAudit: {
      summary: {
        authorizedSourcePages: 19,
        authorizedSourceUniqueLinks: 203,
        authorizedSourceRouteTemplates: 181,
        authorizedSourceForms: 8,
        authorizedSourceControls: 173,
      },
    },
    authorizedSourceManifest: {
      pages: [{
        routeTemplate: '/dev/api',
        routeTemplates: ['/dev/api/:section'],
        links: [{ normalizedHref: 'https://www.reddit.com/dev/api/account' }],
      }],
    },
    cookieBuildReport: {
      status: 'failed',
      result_status: 'failed',
      reasonCode: 'cookie_blocked',
      authStateReport: {
        browserBridge: { used: false },
        cookieMaterialPersisted: false,
      },
    },
    browserBuildReport: {
      status: 'failed',
      result_status: 'failed',
      reasonCode: 'browser_blocked',
      authStateReport: {
        authMethod: 'browser',
        authVerificationStatus: 'browser_blocked',
        blockingSignals: [
          'browser-bridge-all-routes-robots-disallowed',
          'browser-bridge-robots-disallowed',
          'robots-disallowed',
        ],
        browserBridge: {
          used: false,
          routeCount: 4,
          capturedRouteCount: 0,
          missingRouteCount: 4,
          routeCoverageStatus: 'none',
        },
        cookieMaterialPersisted: false,
      },
    },
    publicBuildReport: {
      status: 'failed',
      result_status: 'failed',
      reasonCode: 'validation-failed',
      counts: {
        capabilities_total: 94,
        intents_total: 337,
      },
      coverage: {
        authorizedSource: { pages: 8, nodes: 112, capabilities: 63 },
        browserBridge: { used: false },
      },
    },
    authorizedSourceBuildReport: {
      status: 'success',
      result_status: 'partial_success',
      counts: {
        nodes_total: 1465,
        capabilities_total: 123,
        intents_total: 446,
      },
      summary: {
        coverage: {
          authorizedSource: { pages: 213, nodes: 1465, capabilities: 116 },
        },
      },
    },
    sessionManifest: {
      siteKey: 'reddit',
      host: 'www.reddit.com',
      purpose: 'doctor',
      status: 'manual-required',
      reason: 'profile-missing',
      plan: { sessionRequirement: 'required', profilePathPresent: true },
      repairPlan: { action: 'site-login', command: 'site-login', requiresApproval: true },
    },
    doctorReport: {
      profile: { status: 'pass' },
      crawler: { status: 'pass' },
      capture: { status: 'fail', error: { message: 'capture runtime removed' } },
      adapterRecommendation: 'site-specific-adapter:reddit',
      sessionProvider: 'unified-session-runner',
      sessionReuseWorked: true,
      sessionHealth: { status: 'manual-required', reason: 'profile-missing' },
      authSession: { loginStateDetected: true, identityConfirmed: false },
    },
    robots: { disallowAllForGenericUserAgent: true },
  });

  assert.equal(report.summary.officialApiOperations, 3);
  assert.equal(report.summary.registeredApiRequestPlans, 2);
  assert.equal(report.summary.authorizedSourcePages, 213);
  assert.equal(report.summary.authorizedSourceLinks, 203);
  assert.equal(report.summary.publicOnlyBuildCapabilities, 94);
  assert.equal(report.summary.authorizedSourceBuildCapabilities, 123);
  assert.equal(report.summary.authorizedSourceBuildIntents, 446);
  assert.equal(report.summary.authorizedSourceBuildNodes, 1465);
  assert.equal(report.summary.browserBridgeRouteCount, 4);
  assert.equal(report.summary.browserBridgeCapturedRouteCount, 0);
  assert.equal(report.summary.browserBridgeMissingRouteCount, 4);
  assert.equal(report.evidence.effectiveAuthorizedSource.pageCount, 213);
  assert.equal(report.evidence.effectiveRuntimeSummary.registeredInCurrentSiteForgeRuntime, 2);
  assert.equal(report.evidence.effectiveRuntimeSummary.registrationEvidence, 'registry');
  assert.equal(report.evidence.effectiveAuthorizedSource.sources.manifest.pageCount, 1);
  assert.equal(report.evidence.effectiveAuthorizedSource.sources.authorizedSourceBuild.pageCount, 213);
  assert.equal(report.evidence.effectiveAuthorizedSource.sources.coverageAudit.uniqueLinkCount, 203);
  assert.equal(report.status.authorizedSourceBuild, 'success');
  assert.equal(report.status.cookieCrawl, 'blocked_cookie_not_verified');
  assert.equal(report.status.browserBridgeAuthenticatedRoute, 'blocked_by_robots');
  assert.equal(report.status.fullSiteAllLinksAndFunctions, 'not_complete');
  assert.equal(report.evidence.browserBuild.coverage.browserBridgeRouteCount, 4);
  assert.equal(report.evidence.browserBuild.coverage.browserBridgeMissingRouteCount, 4);
  assert.equal(
    report.requirementAudit.find((item) => item.requirement === 'Run Reddit through X-style session health and site-doctor mode')?.status,
    'attempted',
  );
  assert.equal(
    report.requirementAudit.find((item) => item.requirement === 'Use configured Reddit cookie / Browser Bridge path')?.status,
    'blocked_by_robots',
  );
  assert.equal(
    report.requirementAudit.find((item) => item.requirement === 'Full live crawl of all reddit.com links and functions')?.status,
    'not_complete',
  );
});

test('Reddit runtime plan index separates concrete OAuth reads from parameterized templates', () => {
  const catalog = parseRedditOfficialApiCatalog(FIXTURE_HTML);
  const index = buildRedditRuntimePlanIndex(catalog, {
    generatedAt: '2026-05-30T00:00:00.000Z',
    registeredRuntimePlanCount: 2,
  });
  const unregisteredIndex = buildRedditRuntimePlanIndex(catalog, {
    generatedAt: '2026-05-30T00:00:00.000Z',
  });

  assert.equal(index.summary.readTemplateCount, 2);
  assert.equal(index.summary.concreteRuntimePlanCount, 1);
  assert.equal(index.summary.parameterizedRuntimeTemplateCount, 1);
  assert.equal(index.summary.writeTemplatesDisabled, 1);
  assert.equal(index.summary.registeredInCurrentSiteForgeRuntime, 2);
  assert.equal(unregisteredIndex.summary.registeredInCurrentSiteForgeRuntime, 0);
  assert.equal(index.runtimeMode, 'reddit_oauth_read_runtime');

  const concrete = index.plans.find((plan) => plan.pathTemplate === '/api/v1/me');
  assert.equal(concrete.status, 'runtime_plan_ready');
  assert.equal(concrete.executionPlan.steps[0].endpoint, 'https://oauth.reddit.com/api/v1/me');
  assert.equal(concrete.executionPlan.steps[0].persistAuthorization, false);

  const parameterized = index.plans.find((plan) => plan.pathTemplate === '[/r/:subreddit]/comments/:article');
  assert.equal(parameterized.status, 'runtime_plan_ready_requires_path_parameters');
  assert.deepEqual(parameterized.missingPathParameters, ['article']);
  assert.equal(parameterized.executionPlan.steps[0].endpoint, 'https://oauth.reddit.com/comments/{article}');
  assert.deepEqual(parameterized.executionPlan.steps[0].runtimePathParameters, ['article']);
});

test('Reddit runtime registration writes a callable OAuth skill package without credentials', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'reddit-runtime-registration-'));
  try {
    const catalog = parseRedditOfficialApiCatalog(FIXTURE_HTML);
    const index = buildRedditRuntimePlanIndex(catalog, {
      generatedAt: '2026-05-30T00:00:00.000Z',
    });
    const siteDir = path.join(workspace, '.siteforge', 'sites', 'reddit.com-14830d0f');
    const registration = await writeRedditRuntimeSkillRegistration({
      index,
      siteDir,
      limit: 1,
    });

    assert.equal(registration.registeredPlanCount, 1);
    assert.equal(registration.registeredRuntimePlanCount, 1);
    const registry = JSON.parse(await readFile(registration.registryPath, 'utf8'));
    const capabilities = JSON.parse(await readFile(path.join(registration.skillDir, 'capabilities.json'), 'utf8'));
    const executionPlans = JSON.parse(await readFile(path.join(registration.skillDir, 'execution_plans.json'), 'utf8'));
    const intents = JSON.parse(await readFile(path.join(registration.skillDir, 'intents.json'), 'utf8'));

    assert.equal(countRedditRegisteredRuntimePlans(registry), 1);
    assert.equal(registry.skills[0].runtimeMode, 'reddit_oauth_read_runtime');
    assert.equal(registry.skills[0].intents[0].executionPlanId, executionPlans.executionPlans[0].id);
    assert.equal(capabilities.capabilities[0].executionPlan.steps[0].endpoint, 'https://oauth.reddit.com/api/v1/me');
    assert.equal(intents.intents[0].runtimeMode, 'reddit_oauth_read_runtime');
    const serialized = JSON.stringify({ registry, capabilities, executionPlans, intents });
    assert.equal(serialized.includes('reddit_session='), false);
    assert.equal(serialized.includes('Bearer '), false);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('Reddit runtime registration includes parameterized templates when unbounded', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'reddit-runtime-registration-all-'));
  try {
    const catalog = parseRedditOfficialApiCatalog(FIXTURE_HTML);
    const index = buildRedditRuntimePlanIndex(catalog, {
      generatedAt: '2026-05-30T00:00:00.000Z',
    });
    const siteDir = path.join(workspace, '.siteforge', 'sites', 'reddit.com-14830d0f');
    const registration = await writeRedditRuntimeSkillRegistration({
      index,
      siteDir,
    });

    assert.equal(registration.registeredPlanCount, 2);
    assert.equal(registration.registeredRuntimePlanCount, 2);
    const capabilities = JSON.parse(await readFile(path.join(registration.skillDir, 'capabilities.json'), 'utf8'));
    const parameterized = capabilities.capabilities.find((capability) => capability.name.includes('comments/:article'));
    assert.deepEqual(parameterized.inputs, [{
      name: 'article',
      type: 'string',
      required: true,
      source: 'runtimeParams',
    }]);
    assert.equal(parameterized.executionPlan.steps[0].requiresRuntimeParams, true);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
