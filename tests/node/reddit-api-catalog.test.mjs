import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  buildRedditApiEndpointUrl,
  buildRedditApiReadBatchReport,
  buildRedditApiRequestPlan,
  buildRedditAuthorizedSourceConfig,
  buildRedditAuthorizedSourceManifest,
  buildRedditBrowserBridgeRouteQueue,
  buildRedditComprehensiveCoverageReport,
  buildRedditCoverageAudit,
  buildRedditLiveReadinessReport,
  buildRedditRuntimePlanIndex,
  countRedditRegisteredRuntimePlans,
  executeRedditApiReadPlan,
  findRedditApiOperation,
  parseRedditOfficialApiCatalog,
  renderRedditLiveReadinessReportMarkdown,
  renderRedditComprehensiveCoverageReportMarkdown,
  writeRedditRuntimeSkillRegistration,
} from '../../src/sites/known-sites/reddit/api-catalog.mjs';
import { listSiteAdapters, resolveSiteAdapter } from '../../src/sites/adapters/resolver.mjs';
import { API_CANDIDATE_SCHEMA_VERSION } from '../../src/domain/capabilities/api-candidates.mjs';
import { REDACTION_PLACEHOLDER } from '../../src/domain/sessions/security-guard.mjs';
import { parseRedditActionArgs } from '../../src/entrypoints/sites/reddit-action.mjs';

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

test('Reddit action parser accepts latest doctor report directory input', () => {
  const parsed = parseRedditActionArgs([
    'comprehensive-report',
    '--doctor-report-dir',
    'runs/reddit/site-doctor',
    '--session-manifest',
    'runs/reddit/session/manifest.json',
  ]);

  assert.equal(parsed.action, 'comprehensive-report');
  assert.equal(parsed.doctorReportDir, 'runs/reddit/site-doctor');
  assert.equal(parsed.sessionManifestPath, 'runs/reddit/session/manifest.json');
});

test('Reddit action parser accepts explicit API batch mode', () => {
  const parsed = parseRedditActionArgs([
    'api-read-batch',
    '--include-parameterized',
    '--batch-mode',
    'execute-all',
  ]);

  assert.equal(parsed.action, 'api-read-batch');
  assert.equal(parsed.includeParameterized, true);
  assert.equal(parsed.batchMode, 'execute-all');
});

test('Reddit action parser accepts cumulative Browser Bridge report input', () => {
  const parsed = parseRedditActionArgs([
    'live-readiness',
    '--browser-cumulative-report',
    'runs/reddit/reddit_browser_bridge_live_cumulative_report.json',
  ]);

  assert.equal(parsed.action, 'live-readiness');
  assert.equal(parsed.browserCumulativeReportPath, 'runs/reddit/reddit_browser_bridge_live_cumulative_report.json');
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

test('Reddit API read batch blocks concrete GET plans without credentials and does not fetch', async () => {
  const catalog = parseRedditOfficialApiCatalog(FIXTURE_HTML);
  const runtimeIndex = buildRedditRuntimePlanIndex(catalog);
  let fetchCalled = false;
  const report = await buildRedditApiReadBatchReport(catalog, {
    runtimeIndex,
    execute: true,
    fetchImpl: async () => {
      fetchCalled = true;
      throw new Error('fetch should not run without credentials');
    },
    env: {},
  });

  assert.equal(fetchCalled, false);
  assert.equal(report.summary.selectedConcretePlanCount, 1);
  assert.equal(report.summary.selectedParameterizedPlanCount, 0);
  assert.equal(report.summary.executedCount, 0);
  assert.equal(report.summary.blockedCount, 1);
  assert.equal(report.summary.missingCredentialBlockedCount, 1);
  assert.equal(report.summary.concreteBlockedCount, 1);
  assert.equal(report.summary.parameterizedBlockedCount, 0);
  assert.equal(report.status.apiBatchReadExecution, 'blocked_oauth_or_user_agent_missing');
  assert.equal(report.status.concreteBatchReadExecution, 'blocked_oauth_or_user_agent_missing');
  assert.equal(report.status.parameterizedBatchReadExecution, 'not_selected');
  assert.equal(report.credentialSource.tokenPersisted, false);
  assert.equal(JSON.stringify(report).includes('Bearer '), false);
  assert.equal(JSON.stringify(report).includes('reddit_session='), false);
});

test('Reddit API read batch requires User-Agent after token is present without persisting token value', async () => {
  const catalog = parseRedditOfficialApiCatalog(FIXTURE_HTML);
  const report = await buildRedditApiReadBatchReport(catalog, {
    runtimeIndex: buildRedditRuntimePlanIndex(catalog),
    execute: true,
    fetchImpl: async () => {
      throw new Error('fetch should not run without User-Agent');
    },
    env: {
      SITEFORGE_REDDIT_BEARER_TOKEN: 'synthetic-reddit-token',
    },
  });

  assert.equal(report.credentialSource.tokenProvided, true);
  assert.equal(report.credentialSource.userAgentProvided, false);
  assert.equal(report.results[0].execution.reasonCode, 'reddit_user_agent_required');
  assert.equal(JSON.stringify(report).includes('synthetic-reddit-token'), false);
});

test('Reddit API read batch executes sanitized concrete summaries with OAuth inputs', async () => {
  const catalog = parseRedditOfficialApiCatalog(FIXTURE_HTML);
  let requestedUrl = null;
  const report = await buildRedditApiReadBatchReport(catalog, {
    runtimeIndex: buildRedditRuntimePlanIndex(catalog),
    execute: true,
    fetchImpl: async (url) => {
      requestedUrl = url;
      return {
        ok: true,
        status: 200,
        headers: new Map([['content-type', 'application/json']]),
        text: async () => JSON.stringify({ name: 'tester', token: 'body-token-is-not-persisted' }),
      };
    },
    env: {
      SITEFORGE_REDDIT_BEARER_TOKEN: 'synthetic-reddit-token',
      SITEFORGE_REDDIT_USER_AGENT: 'SiteForgeTest/0.1',
    },
  });

  assert.equal(requestedUrl, 'https://oauth.reddit.com/api/v1/me');
  assert.equal(report.summary.executedCount, 1);
  assert.equal(report.summary.successCount, 1);
  assert.equal(report.results[0].execution.bodySummary.kind, 'json_object');
  assert.equal(report.results[0].execution.bodyPersisted, false);
  assert.equal(JSON.stringify(report).includes('synthetic-reddit-token'), false);
  assert.equal(JSON.stringify(report).includes('body-token-is-not-persisted'), false);
});

test('Reddit API read batch can seed parameterized templates without persisting values', async () => {
  const catalog = parseRedditOfficialApiCatalog(FIXTURE_HTML);
  const report = await buildRedditApiReadBatchReport(catalog, {
    runtimeIndex: buildRedditRuntimePlanIndex(catalog),
    includeParameterized: true,
    execute: false,
  });
  const parameterized = report.results.find((result) => result.parameterized);

  assert.ok(parameterized);
  assert.deepEqual(parameterized.parameterNames, ['article']);
  assert.equal(parameterized.parameterSeedStatus, 'provided');
  assert.equal(parameterized.parameterSeedSources.article, 'synthetic_public_seed');
  assert.equal(parameterized.parameterSeedSourceStatus.article, 'placeholder_only');
  assert.equal(parameterized.seedConfidence.article, 'synthetic_placeholder');
  assert.equal(parameterized.seedPrivacyBoundary.article, 'unknown');
  assert.equal(parameterized.endpointSeedPolicy.article, 'placeholder_resolution_only');
  assert.equal(parameterized.endpointVariantStatus, 'global_variant_selected');
  assert.equal(parameterized.selectedEndpointTemplateIndex, 0);
  assert.equal(parameterized.resolvedEndpointHost, 'oauth.reddit.com');
  assert.equal(parameterized.resolvedPathTemplate, '[/r/:subreddit]/comments/:article');
  assert.equal(parameterized.runtimeParamValuePersisted, false);
  assert.equal(parameterized.seedValuePersisted, false);
  assert.deepEqual(parameterized.parameterBindingsSummary, [{
    name: 'article',
    source: 'synthetic_public_seed',
    sourceStatus: 'placeholder_only',
    seedConfidence: 'synthetic_placeholder',
    seedPrivacyBoundary: 'unknown',
    endpointSeedPolicy: 'placeholder_resolution_only',
    valuePersisted: false,
  }]);
  assert.equal(report.summary.selectedParameterizedPlanCount, 1);
  assert.equal(report.summary.concretePlannedCount, 1);
  assert.equal(report.summary.parameterizedPlannedCount, 1);
  assert.equal(report.summary.parameterizedPlaceholderOnlyCount, 1);
  assert.equal(report.summary.parameterizedPlanOnlyCount, 1);
  assert.equal(report.summary.parameterizedLiveExecutableCount, 0);
  assert.deepEqual(report.summary.parameterizedSeedSourceStatusCounts, { placeholder_only: 1 });
  assert.deepEqual(report.summary.parameterizedSeedConfidenceCounts, { synthetic_placeholder: 1 });
  assert.deepEqual(report.summary.parameterizedPrivacyBoundaryCounts, { unknown: 1 });
  assert.equal(report.status.parameterizedBatchReadExecution, 'planned_not_executed');
  assert.equal(report.status.parameterizedTemplateCoverage, 'seeded_for_plan_resolution');
  assert.deepEqual(report.parameterSeedSummary.providedParameterNames, ['article']);
  assert.deepEqual(report.parameterSeedSummary.sourceStatusValues, ['placeholder_only']);
  assert.deepEqual(report.parameterSeedSummary.seedConfidenceValues, ['synthetic_placeholder']);
  assert.deepEqual(report.parameterSeedSummary.seedPrivacyBoundaryValues, ['unknown']);
  assert.deepEqual(report.parameterSeedSummary.endpointSeedPolicyValues, ['placeholder_resolution_only']);
  assert.equal(report.parameterSeedSummary.valuesPersisted, false);
  assert.equal(JSON.stringify(report).includes('abc123'), false);
});

test('Reddit API read batch records endpoint-specific seed policy without values', async () => {
  const catalog = parseRedditOfficialApiCatalog(`
    <html><body>
    <h2 id="section_messages">messages</h2>
    <div class="endpoint" id="GET_message_{where}"><div class="links"><a href="#GET_message_{where}">#</a></div>
    <h3><span class="method">GET&nbsp;</span>/message/<em class="placeholder">where</em><span class="oauth-scope-list"><a><span class="api-badge oauth-scope">privatemessages</span></a></span></h3>
    <div class="info"><div class="md"><p>Message listing.</p></div></div></div>
    </body></html>
  `);
  const report = await buildRedditApiReadBatchReport(catalog, {
    runtimeIndex: buildRedditRuntimePlanIndex(catalog),
    includeParameterized: true,
    execute: false,
  });
  const parameterized = report.results.find((result) => result.parameterized);

  assert.ok(parameterized);
  assert.deepEqual(parameterized.parameterNames, ['where']);
  assert.equal(parameterized.parameterSeedStatus, 'provided');
  assert.equal(parameterized.parameterSeedSources.where, 'synthetic_public_seed');
  assert.equal(parameterized.parameterSeedSourceStatus.where, 'synthetic_public_seed');
  assert.equal(parameterized.seedConfidence.where, 'synthetic_likely');
  assert.equal(parameterized.seedPrivacyBoundary.where, 'auth_private');
  assert.equal(parameterized.endpointSeedPolicy.where, 'endpoint_specific_synthetic_seed');
  assert.equal(parameterized.endpointVariantStatus, 'single_endpoint_template');
  assert.equal(parameterized.seedValuePersisted, false);
  assert.equal(parameterized.runtimeParamValuePersisted, false);
  assert.equal(report.summary.parameterizedPlaceholderOnlyCount, 0);
  assert.equal(report.summary.parameterizedPlanOnlyCount, 0);
  assert.equal(report.summary.parameterizedLiveExecutableCount, 1);
  assert.deepEqual(report.summary.parameterizedSeedSourceStatusCounts, { synthetic_public_seed: 1 });
  assert.deepEqual(report.summary.parameterizedSeedConfidenceCounts, { synthetic_likely: 1 });
  assert.deepEqual(report.summary.parameterizedPrivacyBoundaryCounts, { auth_private: 1 });
  assert.deepEqual(parameterized.parameterBindingsSummary, [{
    name: 'where',
    source: 'synthetic_public_seed',
    sourceStatus: 'synthetic_public_seed',
    seedConfidence: 'synthetic_likely',
    seedPrivacyBoundary: 'auth_private',
    endpointSeedPolicy: 'endpoint_specific_synthetic_seed',
    valuePersisted: false,
  }]);
  assert.equal(JSON.stringify(report).includes('messaging'), false);
});

test('Reddit API read batch does not execute parameterized plans without explicit batch mode', async () => {
  const catalog = parseRedditOfficialApiCatalog(FIXTURE_HTML);
  const requestedUrls = [];
  const report = await buildRedditApiReadBatchReport(catalog, {
    runtimeIndex: buildRedditRuntimePlanIndex(catalog),
    includeParameterized: true,
    execute: true,
    fetchImpl: async (url) => {
      requestedUrls.push(url);
      return {
        ok: true,
        status: 200,
        headers: new Map([['content-type', 'application/json']]),
        text: async () => JSON.stringify({ ok: true }),
      };
    },
    env: {
      SITEFORGE_REDDIT_BEARER_TOKEN: 'synthetic-reddit-token',
      SITEFORGE_REDDIT_USER_AGENT: 'SiteForgeTest/0.1',
    },
  });

  assert.deepEqual(requestedUrls, ['https://oauth.reddit.com/api/v1/me']);
  assert.equal(report.mode, 'execute-concrete');
  assert.equal(report.summary.concreteExecutedCount, 1);
  assert.equal(report.summary.concreteSuccessCount, 1);
  assert.equal(report.summary.parameterizedExecutedCount, 0);
  assert.equal(report.summary.parameterizedBlockedCount, 0);
  assert.equal(report.summary.parameterizedPlannedCount, 1);
  assert.equal(report.status.concreteBatchReadExecution, 'executed_success');
  assert.equal(report.status.parameterizedBatchReadExecution, 'planned_not_executed');
  assert.equal(
    report.results.find((result) => result.parameterized)?.execution.reasonCode,
    'reddit_parameterized_execution_requires_explicit_batch_mode',
  );
  assert.equal(JSON.stringify(report).includes('synthetic-reddit-token'), false);
});

test('Reddit API read batch keeps concrete and parameterized credential blocks separate', async () => {
  const catalog = parseRedditOfficialApiCatalog(FIXTURE_HTML);
  let fetchCalled = false;
  const report = await buildRedditApiReadBatchReport(catalog, {
    runtimeIndex: buildRedditRuntimePlanIndex(catalog),
    includeParameterized: true,
    batchMode: 'execute-all',
    execute: true,
    fetchImpl: async () => {
      fetchCalled = true;
      throw new Error('fetch should not run without credentials');
    },
    env: {},
  });

  assert.equal(fetchCalled, false);
  assert.equal(report.summary.selectedConcretePlanCount, 1);
  assert.equal(report.summary.selectedParameterizedPlanCount, 1);
  assert.equal(report.summary.blockedCount, 2);
  assert.equal(report.summary.concreteBlockedCount, 1);
  assert.equal(report.summary.parameterizedBlockedCount, 1);
  assert.equal(report.summary.missingCredentialBlockedCount, 2);
  assert.equal(report.summary.concreteMissingCredentialBlockedCount, 1);
  assert.equal(report.summary.parameterizedMissingCredentialBlockedCount, 1);
  assert.equal(report.summary.parameterizedPlanOnlyCount, 1);
  assert.equal(report.summary.parameterizedLiveExecutableCount, 0);
  assert.equal(report.status.concreteBatchReadExecution, 'blocked_oauth_or_user_agent_missing');
  assert.equal(report.status.parameterizedBatchReadExecution, 'blocked_oauth_or_user_agent_missing');
  assert.equal(report.status.parameterizedTemplateCoverage, 'seeded_for_plan_resolution');
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
  assert.ok(config.summary.siteSurfacePages >= 23);
  assert.ok(config.summary.siteSurfaceForms >= 16);
  assert.ok(config.summary.siteSurfaceControls >= 60);
  assert.equal(config.siteforgeLocalConfig.sites.length, 1);
  assert.equal(config.siteforgeLocalConfig.sites[0].url, 'https://www.reddit.com/');
  assert.equal(config.siteforgeLocalConfig.sites[0].auth.mode, 'none');
  assert.equal(config.siteforgeLocalConfig.sites[0].authorizedSources.length, 2);
  assert.equal(config.siteforgeLocalConfig.sites[0].authorizedSources[0].genericCrawlAllowed, undefined);
  const surfaceRouteTemplates = new Set(config.siteforgeLocalConfig.sites[0].authorizedSources[0].structurePages
    .flatMap((page) => [page.routeTemplate, ...(page.routeTemplates ?? [])]));
  for (const routeTemplate of [
    '/rising',
    '/login',
    '/register',
    '/password',
    '/account-activity',
    '/r/all',
    '/r/popular',
    '/r/random',
    '/r/mod',
    '/domain/:domain',
    '/domain/:domain/search',
    '/duplicates/:article',
    '/r/:subreddit/duplicates/:article',
    '/comments/:article',
    '/by_id/:thing',
    '/subreddits',
    '/subreddits/search',
    '/user/:username/overview',
    '/r/:subreddit/about',
    '/r/:subreddit/about/rules',
    '/wiki/:page',
    '/user/:username/saved',
    '/user/:username/hidden',
    '/user/:username/upvoted',
    '/user/:username/downvoted',
    '/user/:username/gilded',
    '/message/compose',
    '/message/comments',
    '/message/mentions',
    '/message/moderator',
    '/r/:subreddit/about/modmail',
    '/chat',
    '/chat/channel/:channel',
    '/user/:username/m/:multipath',
    '/me/m/:multipath',
    '/r/:multipath',
    '/gallery/:id',
    '/poll/:id',
    '/r/:subreddit/predictions',
    '/r/:subreddit/collection/:collectionId',
    '/awards',
    '/framedGild',
    '/r/:subreddit/about/unmoderated',
    '/r/:subreddit/about/edited',
    '/r/:subreddit/about/banned',
    '/r/:subreddit/about/muted',
    '/r/:subreddit/about/wikicontributors',
    '/r/:subreddit/about/postrequirements',
    '/r/:subreddit/about/flair',
    '/r/:subreddit/about/emojis',
    '/r/:subreddit/about/communityappearance',
    '/r/:subreddit/about/removal',
    '/r/:subreddit/wiki/settings/:page',
  ]) {
    assert.equal(surfaceRouteTemplates.has(routeTemplate), true, `${routeTemplate} is covered by the Reddit surface model`);
  }
  const surfaceForms = config.siteforgeLocalConfig.sites[0].authorizedSources[0].structurePages
    .flatMap((page) => page.forms ?? []);
  const surfaceControls = config.siteforgeLocalConfig.sites[0].authorizedSources[0].structurePages
    .flatMap((page) => page.controls ?? []);
  assert.equal(surfaceForms.some((form) => form.name === 'reddit_search' && form.bodyPersisted === false), true);
  assert.equal(surfaceForms.some((form) => form.name === 'submit_post_disabled' && form.safety === 'state_changing_disabled'), true);
  assert.equal(surfaceForms.some((form) => form.name === 'login_disabled' && form.bodyPersisted === false), true);
  assert.equal(surfaceForms.some((form) => form.name === 'post_requirements_disabled' && form.safety === 'state_changing_disabled'), true);
  assert.equal(surfaceControls.some((control) => control.name === 'upvote_disabled' && control.disabled === true), true);
  assert.equal(surfaceControls.some((control) => control.name === 'approve_disabled' && control.semanticKind === 'moderation_write_disabled'), true);
  assert.equal(surfaceControls.some((control) => control.name === 'edit_flair_disabled' && control.disabled === true), true);
  assert.equal(surfaceControls.some((control) => control.name === 'open_duplicate_discussion'), true);
  const manifest = buildRedditAuthorizedSourceManifest(config);
  assert.equal(manifest.pages.length, config.summary.structurePages);
  assert.equal(manifest.pages.reduce((sum, page) => sum + (page.forms ?? []).length, 0), config.summary.siteSurfaceForms);
  assert.equal(manifest.pages.reduce((sum, page) => sum + (page.controls ?? []).length, 0), config.summary.siteSurfaceControls);
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

test('Reddit Browser Bridge route queue classifies cookie-backed route candidates without secrets', () => {
  const catalog = parseRedditOfficialApiCatalog(FIXTURE_HTML, {
    generatedAt: '2026-05-30T00:00:00.000Z',
  });
  const config = buildRedditAuthorizedSourceConfig(catalog, {
    generatedAt: '2026-05-30T00:00:00.000Z',
  });
  const routeQueue = buildRedditBrowserBridgeRouteQueue({
    authorizedSourceManifest: buildRedditAuthorizedSourceManifest(config),
    generatedAt: '2026-05-30T00:00:00.000Z',
  });

  assert.ok(routeQueue.summary.totalCandidateRoutes >= config.summary.siteSurfacePages);
  assert.ok(routeQueue.summary.browserBridgeEligibleRoutes > 0);
  assert.ok(routeQueue.summary.authPrivateCandidateRoutes > 0);
  assert.ok(routeQueue.summary.moderatorLimitedCandidateRoutes > 0);
  assert.ok(routeQueue.summary.writeDisabledCandidateRoutes > 0);
  assert.ok(routeQueue.summary.apiDisabledRoutes > 0);
  assert.equal(
    routeQueue.routeQueue.some((route) => route.routeTemplate === '/login' && route.accessClass === 'auth_entry'),
    true,
  );
  assert.equal(
    routeQueue.routeQueue.some((route) => route.routeTemplate === '/r/:subreddit/about/modqueue' && route.accessClass === 'moderator_limited'),
    true,
  );
  assert.equal(
    routeQueue.routeQueue.some((route) => route.routeTemplate === '/api/vote' && route.accessClass === 'write_disabled' && route.browserBridgeEligible === false),
    true,
  );
  assert.equal(
    routeQueue.routeQueue.some((route) => route.routeTemplate === '/awards' && route.accessClass === 'browser_boundary' && route.browserBridgeEligible === false),
    true,
  );
  assert.ok(routeQueue.summary.browserBoundaryCandidateRoutes > 0);
  const serialized = JSON.stringify(routeQueue);
  assert.equal(serialized.includes('reddit_session='), false);
  assert.equal(serialized.includes('Bearer '), false);
  assert.equal(serialized.includes('access_token='), false);
});

test('Reddit live readiness reports executable gates without persisting runtime secrets', () => {
  const apiReadBatchReport = {
    summary: {
      selectedPlanCount: 2,
      blockedCount: 2,
      successCount: 0,
    },
    status: {
      apiBatchReadExecution: 'blocked_oauth_or_user_agent_missing',
      oauthCredentialInput: 'missing',
    },
    credentialSource: {
      tokenProvided: false,
      userAgentProvided: false,
      tokenPersisted: false,
      userAgentPersisted: false,
    },
    results: [],
  };
  const browserBridgeRouteQueueReport = {
    summary: {
      totalCandidateRoutes: 12,
      browserBridgeEligibleRoutes: 8,
      authPrivateCandidateRoutes: 4,
      moderatorLimitedCandidateRoutes: 2,
      writeDisabledCandidateRoutes: 1,
      apiDisabledRoutes: 3,
    },
  };
  const browserBuildReport = {
    status: 'failed',
    result_status: 'failed',
    reasonCode: 'browser_blocked',
    authStateReport: {
      authMethod: 'browser',
      authVerificationStatus: 'browser_blocked',
      blockingSignals: ['robots-disallowed', 'browser-bridge-robots-disallowed'],
      browserBridge: {
        routeCount: 8,
        capturedRouteCount: 0,
        missingRouteCount: 8,
      },
      cookieMaterialPersisted: false,
    },
  };
  const cookieBuildReport = {
    status: 'failed',
    result_status: 'failed',
    reasonCode: 'cookie_blocked',
    authStateReport: {
      authMethod: 'cookie',
      authVerificationStatus: 'cookie_blocked',
      cookieMaterialPersisted: false,
    },
  };
  const missingInputs = buildRedditLiveReadinessReport({
    apiReadBatchReport,
    browserBridgeRouteQueueReport,
    cookieBuildReport,
    browserBuildReport,
    coverageAudit: {
      status: { genericLiveCrawl: 'blocked_by_robots' },
    },
    robots: { disallowAllForGenericUserAgent: true },
    env: {},
    generatedAt: '2026-05-30T00:00:00.000Z',
  });

  assert.equal(missingInputs.summary.liveSuccessCount, 0);
  assert.equal(missingInputs.summary.canExecuteOauthReadBatch, false);
  assert.equal(missingInputs.status.fullSiteLiveReadiness, 'blocked_external_access_boundary');
  assert.equal(missingInputs.status.oauthReadBatch, 'blocked_missing_oauth_input');
  assert.equal(missingInputs.status.cookieCrawl, 'blocked_cookie_not_verified');
  assert.equal(missingInputs.blockers.some((blocker) => blocker.reasonCode === 'reddit_oauth_credential_and_user_agent_required'), true);
  assert.equal(missingInputs.blockers.some((blocker) => blocker.reasonCode === 'cookie_blocked'), true);
  assert.equal(missingInputs.nextSteps.some((step) => step.id === 'provide-oauth-inputs' && step.status === 'required'), true);
  assert.equal(missingInputs.commands.readOnlyApiBatch, null);
  assert.equal(missingInputs.commands.readOnlyApiBatchAfterOauthArgs.includes('--limit'), true);
  assert.equal(missingInputs.commands.readOnlyApiBatchAfterOauthArgs.includes('2'), true);
  const missingMarkdown = renderRedditLiveReadinessReportMarkdown(missingInputs);
  assert.match(missingMarkdown, /Live successes: 0/u);
  assert.match(missingMarkdown, /provide-oauth-inputs: required/u);
  assert.match(missingMarkdown, /readOnlyApiBatch: blocked_until_oauth_inputs/u);
  assert.match(missingMarkdown, /api-read-batch/u);

  const readyInputs = buildRedditLiveReadinessReport({
    apiReadBatchReport,
    browserBridgeRouteQueueReport,
    browserBuildReport,
    robots: { disallowAllForGenericUserAgent: true },
    commandContext: {
      sourcePath: 'runs/reddit/reddit_dev_api.html',
      runtimeIndexPath: 'runs/reddit/reddit_oauth_api_runtime_plan_index.json',
      outDir: 'runs/reddit',
    },
    env: {
      SITEFORGE_REDDIT_BEARER_TOKEN: 'synthetic-live-readiness-secret',
      SITEFORGE_REDDIT_USER_AGENT: 'SiteForgeTest/1.0',
    },
    generatedAt: '2026-05-30T00:00:00.000Z',
  });
  assert.equal(readyInputs.summary.canExecuteOauthReadBatch, true);
  assert.equal(readyInputs.status.oauthReadBatch, 'ready_to_execute_read_only_api_batch');
  assert.equal(readyInputs.nextSteps.some((step) => step.id === 'execute-oauth-read-batch' && step.status === 'ready'), true);
  assert.equal(readyInputs.commands.readOnlyApiBatchArgs.includes('--source'), true);
  assert.equal(readyInputs.commands.readOnlyApiBatchArgs.includes('--runtime-index'), true);
  assert.equal(readyInputs.commands.readOnlyApiBatchArgs.includes('--out-dir'), true);
  assert.equal(readyInputs.commands.readOnlyApiBatchArgs.includes('--limit'), true);
  assert.equal(readyInputs.commands.readOnlyApiBatchArgs.includes('2'), true);
  assert.equal(readyInputs.commands.readOnlyApiBatchAfterOauth, null);
  const serialized = JSON.stringify(readyInputs);
  assert.equal(serialized.includes('synthetic-live-readiness-secret'), false);
  assert.equal(serialized.includes('Authorization'), false);
  assert.equal(serialized.includes('Cookie:'), false);
});

test('Reddit live readiness preserves cumulative Browser Bridge live evidence', () => {
  const report = buildRedditLiveReadinessReport({
    apiReadBatchReport: {
      summary: {
        selectedPlanCount: 78,
        blockedCount: 78,
        successCount: 0,
      },
      status: {
        apiBatchReadExecution: 'blocked_oauth_or_user_agent_missing',
        oauthCredentialInput: 'missing',
      },
      credentialSource: {
        tokenProvided: false,
        userAgentProvided: false,
      },
    },
    browserBridgeRouteQueueReport: {
      summary: {
        browserBridgeEligibleRoutes: 365,
      },
    },
    browserBridgeCumulativeReport: {
      sourceBuilds: [{ buildId: 'batch-1' }, { buildId: 'batch-2' }],
      summary: {
        attemptedUniqueRoutes: 113,
        capturedUniqueRoutes: 99,
        missingUniqueRoutes: 14,
        remainingEligibleUniqueRoutes: 13,
        remainingLiteralTemplateKeysCoveredByConcreteRoutes: 13,
        remainingLiteralTemplateKeysUncovered: 0,
        remainingEligibleByKind: {
          coveredByConcreteRoute: 13,
          uncoveredResiduals: 0,
        },
        cookiePersisted: false,
      },
      missingByReason: {
        'browser-bridge-definite-challenge': 13,
        'login-wall': 1,
      },
      latestAttempt: {
        buildId: 'batch-2',
        authVerificationStatus: 'browser_blocked',
      },
    },
    commandContext: {
      browserCumulativeReportPath: 'runs/reddit/reddit_browser_bridge_live_cumulative_report.json',
    },
    env: {},
    generatedAt: '2026-05-30T00:00:00.000Z',
  });

  assert.equal(report.summary.liveSuccessCount, 99);
  assert.equal(report.summary.browserBridgeCapturedRoutes, 99);
  assert.equal(report.summary.browserBridgeMissingRoutes, 14);
  assert.equal(report.summary.browserBridgeRemainingUncoveredTemplateRoutes, 0);
  assert.equal(report.status.fullSiteLiveReadiness, 'partial_live_evidence');
  assert.equal(report.status.browserBridgeRoutes, 'challenge_retry_boundary');
  assert.equal(report.commands.cumulativeBrowserBridgeLiveReport, 'runs/reddit/reddit_browser_bridge_live_cumulative_report.json');
  assert.equal(report.blockers.some((blocker) => blocker.id === 'reddit-browser-bridge-partial-route-coverage'), true);
  assert.equal(report.nextSteps.some((step) => step.id === 'continue-browser-bridge-route-queue' && step.status === 'challenge_retry_boundary'), true);
  assert.equal(JSON.stringify(report).includes('Cookie:'), false);
});

test('Reddit live readiness treats contextual awards route as a non-retry live boundary', () => {
  const report = buildRedditLiveReadinessReport({
    apiReadBatchReport: {
      summary: {
        selectedPlanCount: 78,
        blockedCount: 78,
        successCount: 0,
      },
      status: {
        apiBatchReadExecution: 'blocked_oauth_or_user_agent_missing',
        oauthCredentialInput: 'missing',
      },
      credentialSource: {
        tokenProvided: false,
        userAgentProvided: false,
      },
    },
    browserBridgeRouteQueueReport: {
      summary: {
        browserBridgeEligibleRoutes: 362,
        browserBoundaryCandidateRoutes: 3,
      },
    },
    browserBridgeCumulativeReport: {
      sourceBuilds: [{ buildId: 'batch-1' }],
      summary: {
        attemptedUniqueRoutes: 114,
        capturedUniqueRoutes: 113,
        missingUniqueRoutes: 1,
      },
      missingRoutes: [{
        targetRoute: '/awards',
        attempts: 13,
        lastStatus: 'blocked',
        lastReasonCode: 'host-mismatch',
        reasonCodes: {
          'browser-bridge-definite-challenge': 8,
          'host-mismatch': 2,
        },
      }],
    },
    env: {},
    generatedAt: '2026-06-01T00:00:00.000Z',
  });

  assert.equal(report.summary.liveSuccessCount, 113);
  assert.equal(report.summary.browserBridgeMissingRoutes, 0);
  assert.equal(report.summary.browserBridgeRawMissingRoutes, 1);
  assert.equal(report.summary.browserBridgeBoundaryDispositionRoutes, 1);
  assert.equal(report.summary.canRetryBrowserBridgeRoutes, false);
  assert.equal(report.status.browserBridgeRoutes, 'captured_with_boundary_disposition');
  assert.equal(report.boundaries[0].targetRoute, '/awards');
  assert.equal(report.blockers.some((blocker) => blocker.id === 'reddit-browser-bridge-partial-route-coverage'), false);
  assert.equal(report.nextSteps.some((step) => step.id === 'browser-bridge-boundary-disposition' && step.status === 'recorded'), true);
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
  assert.equal(capabilityPolicy.capabilityFamilies.includes('query-comment-thread'), true);
  assert.equal(capabilityPolicy.capabilityFamilies.includes('query-community-metadata'), true);
  assert.equal(capabilityPolicy.capabilityFamilies.includes('query-private-messages'), true);
  assert.equal(capabilityPolicy.capabilityFamilies.includes('query-moderation-content'), true);
  assert.equal(capabilityPolicy.capabilityFamilies.includes('disabled-social-mutation'), true);
  assert.equal(capabilityPolicy.supportedIntents.includes('search-posts'), true);
  assert.equal(capabilityPolicy.supportedIntents.includes('open-post'), true);
  assert.equal(capabilityPolicy.supportedIntents.includes('open-comment'), true);
  assert.equal(capabilityPolicy.supportedIntents.includes('list-comment-thread'), true);
  assert.equal(capabilityPolicy.supportedIntents.includes('list-community-directory'), true);
  assert.equal(capabilityPolicy.supportedIntents.includes('read-wiki-page'), true);
  assert.equal(capabilityPolicy.supportedIntents.includes('list-inbox-messages'), true);
  assert.equal(capabilityPolicy.supportedIntents.includes('list-moderation-queue'), true);
  assert.equal(capabilityPolicy.supportedIntents.includes('record-disabled-submit'), true);
  assert.equal(capabilityPolicy.supportedIntents.includes('record-disabled-vote'), true);
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
    apiReadBatchReport: {
      mode: 'execute',
      status: {
        apiBatchReadExecution: 'blocked_oauth_or_user_agent_missing',
        oauthCredentialInput: 'missing',
        parameterizedTemplateCoverage: 'not_selected',
      },
      credentialSource: {
        tokenProvided: false,
        userAgentProvided: false,
        tokenPersisted: false,
        userAgentPersisted: false,
      },
      summary: {
        selectedPlanCount: 2,
        selectedConcretePlanCount: 2,
        selectedParameterizedPlanCount: 0,
        plannedCount: 0,
        executedCount: 0,
        successCount: 0,
        blockedCount: 2,
        missingCredentialBlockedCount: 2,
        parameterSeedMissingCount: 0,
      },
      results: [{
        execution: {
          status: 'blocked',
          reasonCode: 'reddit_oauth_bearer_token_required',
          bodyPersisted: false,
          authorizationPersisted: false,
          cookieMaterialPersisted: false,
        },
      }],
    },
    browserBridgeRouteQueueReport: {
      summary: {
        totalCandidateRoutes: 320,
        selectedRoutes: 320,
        uniqueRouteTemplates: 181,
        concreteRouteCount: 140,
        routeTemplateOnlyCount: 180,
        browserBridgeEligibleRoutes: 210,
        publicCandidateRoutes: 90,
        authPrivateCandidateRoutes: 42,
        authEntryCandidateRoutes: 4,
        moderatorLimitedCandidateRoutes: 16,
        writeDisabledCandidateRoutes: 58,
        apiDisabledRoutes: 52,
        cookiePersisted: false,
        tokenPersisted: false,
        rawHtmlPersisted: false,
        browserProfilePersisted: false,
      },
    },
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
  assert.equal(report.summary.apiBatchReportPresent, 1);
  assert.equal(report.summary.apiConcreteGetBatchPlans, 2);
  assert.equal(report.summary.apiConcreteGetBatchAttempted, 0);
  assert.equal(report.summary.apiConcreteGetBatchBlocked, 2);
  assert.equal(report.summary.authorizedSourcePages, 213);
  assert.equal(report.summary.authorizedSourceLinks, 203);
  assert.equal(report.summary.publicOnlyBuildCapabilities, 94);
  assert.equal(report.summary.authorizedSourceBuildCapabilities, 123);
  assert.equal(report.summary.authorizedSourceBuildIntents, 446);
  assert.equal(report.summary.authorizedSourceBuildNodes, 1465);
  assert.equal(report.summary.browserBridgeRouteCount, 4);
  assert.equal(report.summary.browserBridgeCapturedRouteCount, 0);
  assert.equal(report.summary.browserBridgeMissingRouteCount, 4);
  assert.equal(report.summary.browserBridgeRouteQueueCandidates, 320);
  assert.equal(report.summary.browserBridgeRouteQueueEligible, 210);
  assert.equal(report.summary.browserBridgeRouteQueueAuthPrivate, 42);
  assert.equal(report.summary.browserBridgeRouteQueueModeratorLimited, 16);
  assert.equal(report.summary.browserBridgeRouteQueueWriteDisabled, 58);
  assert.equal(report.summary.browserBridgeRouteQueueApiDisabled, 52);
  assert.equal(report.summary.fullSiteLiveSuccessCount, 0);
  assert.equal(report.summary.fullSiteLiveBlockerCount, 4);
  assert.equal(report.evidence.effectiveAuthorizedSource.pageCount, 213);
  assert.equal(report.evidence.effectiveRuntimeSummary.registeredInCurrentSiteForgeRuntime, 2);
  assert.equal(report.evidence.effectiveRuntimeSummary.registrationEvidence, 'registry');
  assert.equal(report.evidence.effectiveAuthorizedSource.sources.manifest.pageCount, 1);
  assert.equal(report.evidence.effectiveAuthorizedSource.sources.authorizedSourceBuild.pageCount, 213);
  assert.equal(report.evidence.effectiveAuthorizedSource.sources.coverageAudit.uniqueLinkCount, 203);
  assert.equal(report.status.authorizedSourceBuild, 'success');
  assert.equal(report.status.cookieCrawl, 'blocked_cookie_not_verified');
  assert.equal(report.status.browserBridgeAuthenticatedRoute, 'blocked_by_robots');
  assert.equal(report.status.browserBridgeRouteQueue, 'present');
  assert.equal(report.status.apiConcreteGetBatch, 'blocked_oauth_or_user_agent_missing');
  assert.equal(report.status.apiBatchCredentialBoundary, 'missing_token_and_user_agent');
  assert.equal(report.status.fullSiteLiveReadiness, 'blocked_external_access_boundary');
  assert.equal(report.status.fullSiteAllLinksAndFunctions, 'not_complete');
  assert.equal(report.evidence.fullSiteLive.successCount, 0);
  assert.equal(report.evidence.fullSiteLive.blockers.some((blocker) => blocker.layer === 'generic_live_crawl'), true);
  assert.equal(report.evidence.fullSiteLive.blockers.some((blocker) => blocker.layer === 'browser_bridge'), true);
  assert.equal(report.evidence.fullSiteLive.blockers.some((blocker) => blocker.layer === 'reddit_oauth_api_runtime'), true);
  assert.equal(
    report.evidence.fullSiteLive.nextSteps.some((step) => step.id === 'execute-reddit-oauth-read-batch' && step.status === 'available_after_oauth_credential_and_user_agent'),
    true,
  );
  assert.equal(
    report.evidence.fullSiteLive.nextSteps.some((step) => step.id === 'retry-browser-bridge-eligible-route-batch' && step.status === 'available_after_verified_browser_bridge_session_and_robots_allowed_routes'),
    true,
  );
  assert.equal(report.evidence.browserBuild.coverage.browserBridgeRouteCount, 4);
  assert.equal(report.evidence.browserBuild.coverage.browserBridgeMissingRouteCount, 4);
  assert.equal(
    report.requirementAudit.find((item) => item.requirement === 'Run Reddit through X-style session health and site-doctor mode')?.status,
    'attempted',
  );
  assert.equal(
    report.requirementAudit.find((item) => item.requirement === 'Enumerate Browser Bridge route queue from Reddit authorized structure')?.status,
    'covered_from_route_queue',
  );
  assert.equal(
    report.requirementAudit.find((item) => item.requirement === 'Use configured Reddit cookie / Browser Bridge path')?.status,
    'blocked_by_robots',
  );
  assert.equal(
    report.requirementAudit.find((item) => item.requirement === 'Preflight Reddit OAuth concrete GET batch')?.status,
    'blocked_oauth_or_user_agent_missing',
  );
  assert.equal(
    report.requirementAudit.find((item) => item.requirement === 'Keep Reddit API batch sanitized')?.status,
    'passed',
  );
  assert.equal(
    report.requirementAudit.find((item) => item.requirement === 'Resolve full-site live crawl access blockers')?.status,
    'blocked_external_access_boundary',
  );
  assert.equal(
    report.requirementAudit.find((item) => item.requirement === 'Full live crawl of all reddit.com links and functions')?.status,
    'not_complete',
  );
  const markdown = renderRedditComprehensiveCoverageReportMarkdown(report);
  assert.match(markdown, /Full-site live successes: 0/u);
  assert.match(markdown, /generic_live_crawl: robots-disallowed/u);
  assert.match(markdown, /execute-reddit-oauth-read-batch: available_after_oauth_credential_and_user_agent/u);
});

test('Reddit comprehensive report uses cumulative Browser Bridge live evidence', () => {
  const catalog = parseRedditOfficialApiCatalog(FIXTURE_HTML, {
    generatedAt: '2026-05-30T00:00:00.000Z',
  });
  const report = buildRedditComprehensiveCoverageReport(catalog, {
    generatedAt: '2026-05-30T00:00:00.000Z',
    apiReadBatchReport: {
      status: {
        apiBatchReadExecution: 'blocked_oauth_or_user_agent_missing',
        oauthCredentialInput: 'missing',
      },
      summary: {
        selectedPlanCount: 3,
        blockedCount: 3,
        successCount: 0,
        selectedConcretePlanCount: 2,
        concreteBlockedCount: 2,
      },
      credentialSource: {
        tokenProvided: false,
        userAgentProvided: false,
      },
      results: [],
    },
    browserBridgeRouteQueueReport: {
      summary: {
        totalCandidateRoutes: 1042,
        browserBridgeEligibleRoutes: 365,
      },
    },
    browserBridgeCumulativeReport: {
      sourceBuilds: [{ buildId: 'batch-1' }, { buildId: 'batch-2' }],
      summary: {
        attemptedUniqueRoutes: 113,
        capturedUniqueRoutes: 99,
        missingUniqueRoutes: 14,
        remainingEligibleUniqueRoutes: 13,
        remainingLiteralTemplateKeysUncovered: 0,
        remainingEligibleByKind: {
          coveredByConcreteRoute: 13,
          uncoveredResiduals: 0,
        },
      },
      missingByReason: {
        'browser-bridge-definite-challenge': 13,
        'login-wall': 1,
      },
      latestAttempt: {
        buildId: 'batch-2',
        authVerificationStatus: 'browser_blocked',
      },
    },
    browserBridgeCumulativeReportPath: 'runs/reddit/reddit_browser_bridge_live_cumulative_report.json',
    robots: { disallowAllForGenericUserAgent: true },
  });

  assert.equal(report.summary.fullSiteLiveSuccessCount, 99);
  assert.equal(report.summary.browserBridgeRouteCount, 113);
  assert.equal(report.summary.browserBridgeCapturedRouteCount, 99);
  assert.equal(report.summary.browserBridgeMissingRouteCount, 14);
  assert.equal(report.status.browserBridgeAuthenticatedRoute, 'partial_captured');
  assert.equal(report.evidence.fullSiteLive.browserBridge.cumulativeReportPath, 'runs/reddit/reddit_browser_bridge_live_cumulative_report.json');
  assert.equal(report.evidence.fullSiteLive.browserBridge.remainingUncoveredTemplateRoutes, 0);
  assert.equal(report.evidence.fullSiteLive.blockers.some((blocker) => blocker.id === 'reddit-browser-bridge-partial-route-coverage'), true);
  assert.match(
    report.requirementAudit.find((item) => item.requirement === 'Full live crawl of all reddit.com links and functions')?.evidence ?? '',
    /Browser Bridge cumulative captured 99; missing 14; uncovered templates 0/u,
  );
});

test('Reddit comprehensive report records awards route boundary without blocking Browser Bridge completion', () => {
  const catalog = parseRedditOfficialApiCatalog(FIXTURE_HTML, {
    generatedAt: '2026-06-01T00:00:00.000Z',
  });
  const report = buildRedditComprehensiveCoverageReport(catalog, {
    generatedAt: '2026-06-01T00:00:00.000Z',
    apiReadBatchReport: {
      status: {
        apiBatchReadExecution: 'blocked_oauth_or_user_agent_missing',
        oauthCredentialInput: 'missing',
      },
      summary: {
        selectedPlanCount: 3,
        blockedCount: 3,
        successCount: 0,
        selectedConcretePlanCount: 2,
        concreteBlockedCount: 2,
      },
      credentialSource: {
        tokenProvided: false,
        userAgentProvided: false,
      },
      results: [],
    },
    browserBridgeRouteQueueReport: {
      summary: {
        totalCandidateRoutes: 1042,
        browserBridgeEligibleRoutes: 362,
        browserBoundaryCandidateRoutes: 3,
      },
    },
    browserBridgeCumulativeReport: {
      sourceBuilds: [{ buildId: 'batch-1' }],
      summary: {
        attemptedUniqueRoutes: 114,
        capturedUniqueRoutes: 113,
        missingUniqueRoutes: 1,
        remainingEligibleUniqueRoutes: 1,
        remainingLiteralTemplateKeysUncovered: 0,
      },
      missingRoutes: [{
        targetRoute: '/awards',
        attempts: 13,
        lastStatus: 'blocked',
        lastReasonCode: 'host-mismatch',
      }],
      missingByReason: {
        'host-mismatch': 1,
      },
    },
    browserBridgeCumulativeReportPath: 'runs/reddit/reddit_browser_bridge_live_cumulative_report.json',
    robots: { disallowAllForGenericUserAgent: true },
  });

  assert.equal(report.summary.fullSiteLiveSuccessCount, 113);
  assert.equal(report.summary.fullSiteLiveResolvedRouteCount, 114);
  assert.equal(report.summary.browserBridgeCapturedRouteCount, 113);
  assert.equal(report.summary.browserBridgeMissingRouteCount, 0);
  assert.equal(report.summary.browserBridgeRawMissingRouteCount, 1);
  assert.equal(report.summary.browserBridgeBoundaryDispositionRouteCount, 1);
  assert.equal(report.status.browserBridgeAuthenticatedRoute, 'captured_with_boundary_disposition');
  assert.equal(report.evidence.fullSiteLive.blockers.some((blocker) => blocker.id === 'reddit-browser-bridge-partial-route-coverage'), false);
  assert.equal(report.evidence.fullSiteLive.boundaries[0].targetRoute, '/awards');
  assert.match(
    report.requirementAudit.find((item) => item.requirement === 'Full live crawl of all reddit.com links and functions')?.evidence ?? '',
    /boundary dispositions 1/u,
  );
});

test('Reddit comprehensive coverage report keeps mixed API batch counts separate', () => {
  const catalog = parseRedditOfficialApiCatalog(FIXTURE_HTML, {
    generatedAt: '2026-05-30T00:00:00.000Z',
  });
  const index = buildRedditRuntimePlanIndex(catalog, {
    generatedAt: '2026-05-30T00:00:00.000Z',
  });
  const report = buildRedditComprehensiveCoverageReport(catalog, {
    generatedAt: '2026-05-30T00:00:00.000Z',
    runtimeIndex: index,
    apiReadBatchReport: {
      mode: 'execute',
      status: {
        apiBatchReadExecution: 'blocked_oauth_or_user_agent_missing',
        concreteBatchReadExecution: 'blocked_oauth_or_user_agent_missing',
        parameterizedBatchReadExecution: 'blocked_oauth_or_user_agent_missing',
        oauthCredentialInput: 'missing',
        parameterizedTemplateCoverage: 'seeded_for_plan_resolution',
      },
      credentialSource: {
        tokenProvided: false,
        userAgentProvided: false,
        tokenPersisted: false,
        userAgentPersisted: false,
      },
      summary: {
        selectedPlanCount: 2,
        selectedConcretePlanCount: 1,
        selectedParameterizedPlanCount: 1,
        plannedCount: 0,
        executedCount: 0,
        successCount: 0,
        blockedCount: 2,
        missingCredentialBlockedCount: 2,
        parameterSeedMissingCount: 0,
        concretePlannedCount: 0,
        concreteExecutedCount: 0,
        concreteSuccessCount: 0,
        concreteBlockedCount: 1,
        concreteMissingCredentialBlockedCount: 1,
        parameterizedPlannedCount: 0,
        parameterizedExecutedCount: 0,
        parameterizedSuccessCount: 0,
        parameterizedBlockedCount: 1,
        parameterizedMissingCredentialBlockedCount: 1,
        parameterizedSeedMissingCount: 0,
        parameterizedPlaceholderOnlyCount: 1,
        parameterizedPlanOnlyCount: 1,
        parameterizedLiveExecutableCount: 0,
      },
      results: [
        {
          execution: {
            status: 'blocked',
            reasonCode: 'reddit_oauth_bearer_token_required',
            bodyPersisted: false,
            authorizationPersisted: false,
            cookieMaterialPersisted: false,
          },
        },
        {
          parameterized: true,
          execution: {
            status: 'blocked',
            reasonCode: 'reddit_oauth_bearer_token_required',
            bodyPersisted: false,
            authorizationPersisted: false,
            cookieMaterialPersisted: false,
          },
        },
      ],
    },
    robots: { disallowAllForGenericUserAgent: true },
  });

  assert.equal(report.summary.apiBatchTotalBlocked, 2);
  assert.equal(report.summary.apiConcreteGetBatchBlocked, 1);
  assert.equal(report.summary.apiConcreteGetBatchBlockedByCredential, 1);
  assert.equal(report.summary.apiParameterizedGetBatchPlans, 1);
  assert.equal(report.summary.apiParameterizedGetBatchSeededForResolution, 1);
  assert.equal(report.summary.apiParameterizedGetBatchBlocked, 1);
  assert.equal(report.summary.apiParameterizedGetBatchBlockedByCredential, 1);
  assert.equal(report.summary.apiParameterizedGetBatchPlaceholderOnly, 1);
  assert.equal(report.summary.apiParameterizedGetBatchPlanOnly, 1);
  assert.equal(report.summary.apiParameterizedGetBatchLiveExecutable, 0);
  assert.equal(report.summary.apiParameterizedGetTemplatesPendingParams, 0);
  assert.equal(report.status.apiConcreteGetBatch, 'blocked_oauth_or_user_agent_missing');
  assert.equal(report.status.apiParameterizedGetBatch, 'seeded_for_plan_resolution');
  assert.equal(report.status.apiParameterizedGetExecution, 'blocked_oauth_or_user_agent_missing');
});

test('Reddit comprehensive coverage report falls back to coverage audit build counts', () => {
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
    coverageAudit: {
      summary: {
        authorizedSourcePages: 213,
        authorizedSourceUniqueLinks: 232,
        authorizedSourceRouteTemplates: 353,
        buildGraphNodeCount: 1390,
        buildCapabilityCount: 167,
        buildIntentCount: 501,
      },
    },
    robots: { disallowAllForGenericUserAgent: true },
  });

  assert.equal(report.summary.authorizedSourceBuildCapabilities, 167);
  assert.equal(report.summary.authorizedSourceBuildIntents, 501);
  assert.equal(report.summary.authorizedSourceBuildNodes, 1390);
  assert.equal(report.summary.registeredApiRequestPlans, 2);
  assert.equal(report.status.oauthReadRuntime, 'registered');
  assert.equal(report.status.authorizedSourceBuild, 'covered_from_coverage_audit');
  assert.equal(report.evidence.effectiveAuthorizedSource.sources.coverageAudit.capabilityCount, 167);
});

test('Reddit comprehensive coverage report reads user-wrapped browser build evidence', () => {
  const catalog = parseRedditOfficialApiCatalog(FIXTURE_HTML, {
    generatedAt: '2026-05-30T00:00:00.000Z',
  });
  const report = buildRedditComprehensiveCoverageReport(catalog, {
    generatedAt: '2026-05-30T00:00:00.000Z',
    browserBuildReport: {
      user: {
        result_status: 'failed',
        reason_code: 'robots-disallowed',
        authMethod: 'browser',
        authVerificationStatus: 'browser_blocked',
        auth_summary: {
          blockingSignals: [
            'browser-bridge-all-routes-robots-disallowed',
            'browser-bridge-robots-disallowed',
            'robots-disallowed',
          ],
          cookieInput: {
            provided: true,
            source: 'browser_bridge',
            pairCount: 4,
            persisted: false,
            redacted: true,
          },
          browserBridge: {
            used: false,
            routeCount: 4,
            capturedRouteCount: 0,
            missingRouteCount: 4,
            routeCoverageStatus: 'none',
          },
        },
      },
    },
    robots: { disallowAllForGenericUserAgent: true },
  });

  assert.equal(report.status.browserBridgeAuthenticatedRoute, 'blocked_by_robots');
  assert.equal(report.requirementAudit.find((item) => item.requirement === 'Use configured Reddit cookie / Browser Bridge path')?.status, 'blocked_by_robots');
  assert.equal(report.evidence.browserBuild.cookieInput.provided, true);
  assert.equal(report.evidence.browserBuild.cookieInput.pairCount, 4);
  assert.equal(report.evidence.browserBuild.coverage.browserBridgeRouteCount, 4);
});

test('Reddit comprehensive coverage report classifies reason-only robot blocked browser builds', () => {
  const catalog = parseRedditOfficialApiCatalog(FIXTURE_HTML, {
    generatedAt: '2026-05-30T00:00:00.000Z',
  });
  const blockedBrowserReport = {
    result_status: 'failed',
    reasonCode: 'robots-disallowed',
    authMethod: 'browser',
    authVerificationStatus: 'browser_blocked',
    coverage: {
      browserBridge: {
        used: false,
        routeCount: 4,
        capturedRouteCount: 0,
        missingRouteCount: 4,
      },
    },
  };
  const report = buildRedditComprehensiveCoverageReport(catalog, {
    generatedAt: '2026-05-30T00:00:00.000Z',
    cookieBuildReport: blockedBrowserReport,
    browserBuildReport: blockedBrowserReport,
    robots: { disallowAllForGenericUserAgent: true },
  });

  assert.equal(report.status.cookieCrawl, 'blocked_by_robots');
  assert.equal(report.status.browserBridgeAuthenticatedRoute, 'blocked_by_robots');
  assert.equal(report.requirementAudit.find((item) => item.requirement === 'Use configured Reddit cookie / Browser Bridge path')?.status, 'blocked_by_robots');
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
