import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile, rm } from 'node:fs/promises';

import { runSiteForgeBuild } from '../../src/app/pipeline/build/index.mjs';
import { parseCliArgs } from '../../src/entrypoints/build/run-build.mjs';
import { observedRequestFromNetworkCaptureEvent } from '../../src/domain/artifacts/network-capture.mjs';
import {
  testHtmlPage,
  testRobotsTxt,
  testSitemapXml,
  withTestSite,
} from './helpers/test-site-server.mjs';

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function fileExists(filePath) {
  try {
    await readFile(filePath, 'utf8');
    return true;
  } catch {
    return false;
  }
}

function siteRoutes(rootUrl) {
  return {
    '/': testHtmlPage('Internal Raw Network', '<main><a href="/article/1">Article</a></main>'),
    '/article/1': testHtmlPage('Article', '<article>Public article</article>'),
    '/robots.txt': {
      contentType: 'text/plain; charset=utf-8',
      body: testRobotsTxt(rootUrl),
    },
    '/sitemap.xml': {
      contentType: 'application/xml; charset=utf-8',
      body: testSitemapXml(rootUrl, ['/', '/article/1']),
    },
  };
}

function observedApiRequest(rootUrl, siteKey, secret) {
  return observedRequestFromNetworkCaptureEvent({
    method: 'Network.requestWillBeSent',
    params: {
      requestId: 'synthetic-raw-api-request',
      type: 'Fetch',
      documentURL: rootUrl,
      request: {
        method: 'POST',
        url: new URL(`/api/feed?access_token=${secret}`, rootUrl).toString(),
        headers: {
          authorization: `Bearer ${secret}`,
          accept: 'application/json',
        },
        postData: JSON.stringify({ token: secret, page: 1 }),
      },
    },
  }, {
    siteKey,
    observedAt: '2026-05-26T00:00:00.000Z',
  });
}

function rawApiTrace(rootUrl, secret) {
  const responseBody = JSON.stringify({ token: secret, items: [{ id: 1 }] });
  return {
    requestId: 'synthetic-raw-api-request',
    resourceType: 'Fetch',
    wallTime: '2026-05-26T00:00:00.000Z',
    timestamp: 1,
    documentURL: rootUrl,
    initiator: { type: 'script' },
    request: {
      method: 'POST',
      url: new URL(`/api/feed?access_token=${secret}`, rootUrl).toString(),
      headers: {
        authorization: `Bearer ${secret}`,
        accept: 'application/json',
      },
      body: JSON.stringify({ token: secret, page: 1 }),
      bodySizeBytes: Buffer.byteLength(JSON.stringify({ token: secret, page: 1 }), 'utf8'),
      truncated: false,
      hasPostData: true,
    },
    response: {
      url: new URL('/api/feed', rootUrl).toString(),
      status: 200,
      statusText: 'OK',
      mimeType: 'application/json',
      headers: {
        'content-type': 'application/json',
        'set-cookie': `sid=${secret}`,
      },
      encodedDataLength: responseBody.length,
    },
    responseBody: {
      base64Encoded: false,
      body: responseBody,
      bodySizeBytes: Buffer.byteLength(responseBody, 'utf8'),
      truncated: false,
    },
    responseBodyStatus: 'captured',
    loading: {
      status: 'finished',
      encodedDataLength: responseBody.length,
      failedText: null,
    },
  };
}

function observedReadApiRequest(rootUrl, siteKey, secret, { method = 'GET', requestId = 'synthetic-read-api-request' } = {}) {
  return observedRequestFromNetworkCaptureEvent({
    method: 'Network.requestWillBeSent',
    params: {
      requestId,
      type: 'Fetch',
      documentURL: rootUrl,
      request: {
        method,
        url: new URL('/api/feed?page=1', rootUrl).toString(),
        headers: {
          authorization: `Bearer ${secret}`,
          accept: 'application/json',
        },
      },
    },
  }, {
    siteKey,
    observedAt: '2026-05-26T01:00:00.000Z',
  });
}

function observedDynamicReadApiRequest(rootUrl, siteKey) {
  const endpointTemplate = new URL('/api/profile?user_id={self.uid}&sec_user_id={self.secUid}', rootUrl).toString();
  return {
    id: 'synthetic-dynamic-read-api-request',
    siteKey,
    status: 'observed',
    method: 'GET',
    url: endpointTemplate,
    resourceType: 'fetch',
    source: 'test.dynamic-api-seed',
    request: {
      headers: {
        accept: 'application/json',
      },
      body: null,
    },
    runtime: {
      endpointTemplate,
      parameterSource: {
        kind: 'douyin_self_user_render_data',
        pageUrl: rootUrl,
        rawMaterialPersisted: false,
      },
      responseEvidence: {
        statusCode: 0,
        arrayField: 'items',
      },
      rawParameterMaterialPersisted: false,
    },
  };
}

function observedSignedRuntimeApiRequest(rootUrl, siteKey) {
  const endpointTemplate = new URL('/api/signed/user', rootUrl).toString();
  return {
    id: 'synthetic-signed-runtime-api-request',
    siteKey,
    status: 'observed',
    method: 'GET',
    url: endpointTemplate,
    resourceType: 'fetch',
    source: 'test.signed-runtime-api-seed',
    request: {
      headers: {
        accept: 'application/json',
      },
      body: null,
    },
    runtime: {
      endpointTemplate,
      parameterSource: {
        kind: 'qidian_yuew_sign',
      },
      responseEvidence: {
        statusCode: 0,
        objectField: 'data',
      },
      rawParameterMaterialPersisted: false,
    },
  };
}

function observedQidianPublicSignedRuntimeApiRequest(rootUrl, {
  semanticKind = 'read-site-system-time',
  id = 'synthetic-signed-runtime-api-request',
} = {}) {
  const endpointTemplate = new URL('/api/signed/user', rootUrl).toString();
  return {
    id,
    siteKey: 'qidian',
    status: 'observed',
    method: 'GET',
    url: endpointTemplate,
    resourceType: 'fetch',
    source: 'site-adapter.build-api-seed',
    evidence: {
      semanticKind,
      rawMaterialPersisted: false,
    },
    request: {
      headers: {
        accept: 'application/json',
      },
      body: null,
    },
    runtime: {
      semanticKind,
      endpointTemplate,
      parameterSource: {
        kind: 'qidian_yuew_sign',
      },
      responseEvidence: {
        statusCode: 0,
        objectField: 'data',
      },
      rawParameterMaterialPersisted: false,
    },
  };
}

function observedXWebAuthRuntimeApiRequest(rootUrl, endpointPath = '/i/api/1.1/hashflags.json') {
  const endpointTemplate = new URL(endpointPath, rootUrl).toString();
  return {
    id: 'synthetic-x-web-auth-api-request',
    siteKey: 'x',
    status: 'observed',
    method: 'GET',
    url: endpointTemplate,
    resourceType: 'fetch',
    source: 'site-adapter.build-api-seed',
    request: {
      headers: {
        accept: 'application/json',
      },
      body: null,
    },
    runtime: {
      endpointTemplate,
      parameterSource: {
        kind: 'x_web_auth_headers',
        rawMaterialPersisted: false,
      },
      responseEvidence: null,
      rawParameterMaterialPersisted: false,
    },
  };
}

function observedXBrowserContextRuntimeApiRequest(rootUrl) {
  const endpointTemplate = new URL('/i/api/1.1/hashflags.json', rootUrl).toString();
  return {
    id: 'synthetic-x-browser-context-api-request',
    siteKey: 'x',
    status: 'observed',
    method: 'GET',
    url: endpointTemplate,
    resourceType: 'fetch',
    source: 'site-adapter.build-api-seed',
    request: {
      headers: {
        accept: 'application/json',
      },
      body: null,
    },
    evidence: {
      semanticKind: 'read-hashflags',
      rawMaterialPersisted: false,
    },
    runtime: {
      semanticKind: 'read-hashflags',
      endpointTemplate,
      parameterSource: null,
      responseEvidence: null,
      rawParameterMaterialPersisted: false,
    },
  };
}

function rawDynamicReadApiTrace(rootUrl) {
  const endpointTemplate = new URL('/api/profile?user_id={self.uid}&sec_user_id={self.secUid}', rootUrl).toString();
  return {
    requestId: 'synthetic-dynamic-read-api-request',
    resourceType: 'Fetch',
    wallTime: '2026-05-26T01:04:00.000Z',
    timestamp: 1,
    documentURL: rootUrl,
    initiator: { type: 'script' },
    request: {
      method: 'GET',
      url: endpointTemplate,
      headers: {
        accept: 'application/json',
      },
      body: null,
      bodySizeBytes: 0,
      truncated: false,
      hasPostData: false,
    },
  };
}

function rawXWebAuthRuntimeApiTrace(rootUrl, endpointPath = '/i/api/1.1/hashflags.json') {
  const endpointTemplate = new URL(endpointPath, rootUrl).toString();
  return {
    requestId: 'synthetic-x-web-auth-api-request',
    resourceType: 'Fetch',
    wallTime: '2026-05-26T01:04:25.000Z',
    timestamp: 1,
    documentURL: rootUrl,
    initiator: { type: 'script' },
    request: {
      method: 'GET',
      url: endpointTemplate,
      headers: {
        accept: 'application/json',
      },
      body: null,
      bodySizeBytes: 0,
      truncated: false,
      hasPostData: false,
    },
  };
}

function rawXBrowserContextRuntimeApiTrace(rootUrl) {
  return {
    ...rawXWebAuthRuntimeApiTrace(rootUrl),
    requestId: 'synthetic-x-browser-context-api-request',
    wallTime: '2026-05-26T01:04:30.000Z',
  };
}

function rawSignedRuntimeApiTrace(rootUrl) {
  const endpointTemplate = new URL('/api/signed/user', rootUrl).toString();
  return {
    requestId: 'synthetic-signed-runtime-api-request',
    resourceType: 'Fetch',
    wallTime: '2026-05-26T01:04:15.000Z',
    timestamp: 1,
    documentURL: rootUrl,
    initiator: { type: 'script' },
    request: {
      method: 'GET',
      url: endpointTemplate,
      headers: {
        accept: 'application/json',
      },
      body: null,
      bodySizeBytes: 0,
      truncated: false,
      hasPostData: false,
    },
  };
}

function encodedDouyinSelfRenderPage() {
  const encoded = [
    '%7B%22app%22%3A%7B%22user%22%3A%7B%22info%22%3A%7B',
    '%22uid%22%3A%22123456%22%2C',
    '%22secUid%22%3A%22MS4wLjABAAAAfixture%22%2C',
    '%22nickname%22%3A%22%E4%22',
    '%7D%7D%7D%7D',
  ].join('');
  return testHtmlPage('Douyin self', `<main><a href="/article/1">Article</a></main><script id="RENDER_DATA">${encoded}</script>`);
}

function rawReadApiTrace(rootUrl, secret, { method = 'GET', requestId = 'synthetic-read-api-request' } = {}) {
  const responseBody = JSON.stringify({ token: secret, items: [{ id: 1, title: 'Private item' }] });
  return {
    requestId,
    resourceType: 'Fetch',
    wallTime: '2026-05-26T01:00:00.000Z',
    timestamp: 1,
    documentURL: rootUrl,
    initiator: { type: 'script' },
    request: {
      method,
      url: new URL('/api/feed?page=1', rootUrl).toString(),
      headers: {
        authorization: `Bearer ${secret}`,
        accept: 'application/json',
      },
      body: null,
      bodySizeBytes: 0,
      truncated: false,
      hasPostData: false,
    },
    response: {
      url: new URL('/api/feed?page=1', rootUrl).toString(),
      status: 200,
      statusText: 'OK',
      mimeType: 'application/json',
      headers: {
        'content-type': 'application/json',
        'set-cookie': `sid=${secret}`,
      },
      encodedDataLength: responseBody.length,
    },
    responseBody: {
      base64Encoded: false,
      body: responseBody,
      bodySizeBytes: Buffer.byteLength(responseBody, 'utf8'),
      truncated: false,
    },
    responseBodyStatus: 'captured',
    loading: {
      status: 'finished',
      encodedDataLength: responseBody.length,
      failedText: null,
    },
  };
}

function browserVerifiedAuthState(rootUrl) {
  return {
    authMethod: 'browser',
    authVerificationStatus: 'browser_verified',
    verified: true,
    browserBridge: {
      routeCoverageStatus: 'complete',
      routeCount: 1,
      capturedRouteCount: 1,
      missingRouteCount: 0,
      routeResults: [{
        routeId: 'fixture-home',
        status: 'captured',
        captured: true,
        targetUrl: rootUrl,
        targetRoute: '/',
        routeTemplate: '/',
      }],
    },
  };
}

function acceptingFixtureApiAdapter() {
  return {
    id: 'fixture-api-adapter',
    version: 'fixture-v1',
    validateApiCandidate({ candidate, evidence, scope, validatedAt }) {
      return {
        adapterId: 'fixture-api-adapter',
        adapterVersion: 'fixture-v1',
        candidateId: candidate.id,
        siteKey: candidate.siteKey,
        decision: 'accepted',
        validatedAt,
        evidence,
        scope,
      };
    },
    getApiCatalogUpgradePolicy() {
      return {
        adapterId: 'fixture-api-adapter',
        allowCatalogUpgrade: false,
        reasonCode: 'api-catalog-entry-blocked',
      };
    },
  };
}

function catalogAllowingFixtureApiAdapter() {
  const adapter = acceptingFixtureApiAdapter();
  return {
    ...adapter,
    getApiCatalogUpgradePolicy() {
      return {
        adapterId: 'fixture-api-adapter',
        allowCatalogUpgrade: true,
        reasonCode: null,
      };
    },
  };
}

test('plain build keeps raw traces in memory and writes only redacted API candidates', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-internal-raw-network-'));
  const secret = 'synthetic-internal-raw-token';
  try {
    await withTestSite(siteRoutes, async (rootUrl) => {
      const parsed = parseCliArgs([rootUrl]);
      const result = await runSiteForgeBuild(rootUrl, {
        ...parsed.options,
        cwd: workspace,
        buildId: 'internal-raw-network-build',
        now: new Date('2026-05-26T00:00:00.000Z'),
        maxDepth: 1,
        maxPages: 4,
        maxSeeds: 4,
        fetchDelayMs: 0,
        publicRenderedStructureProvider: async ({ context }) => {
          context.internalRawNetworkCapture = {
            status: 'captured',
            rawTraces: [rawApiTrace(rootUrl, secret)],
            observedRequests: [observedApiRequest(rootUrl, context.site.id, secret)],
            observedResponseSummaries: [],
          };
          return {
            publicRenderedPages: [{
              url: rootUrl,
              title: 'Internal Raw Network',
              visibleItemCount: 1,
              links: [{ href: new URL('/article/1', rootUrl).toString(), label: 'Article' }],
            }],
          };
        },
      });

      const rawPath = path.join(result.artifactDir, 'discovery', 'network_traces.raw.json');
      assert.equal(await fileExists(rawPath), false);

      const summaryArtifact = await readJson(path.join(result.artifactDir, 'network_traces.json'));
      assert.equal(summaryArtifact.status, 'success');
      assert.deepEqual(summaryArtifact.traces, []);
      assert.deepEqual(summaryArtifact.observedRequests, []);
      assert.equal(summaryArtifact.sanitizedSummary.rawTracesPersisted, false);
      assert.equal(summaryArtifact.sanitizedSummary.rawArtifactPresent, false);
      assert.equal(summaryArtifact.sanitizedSummary.rawArtifactPath, null);
      assert.equal(summaryArtifact.sanitizedSummary.rawTraceCount, 1);
      assert.equal(summaryArtifact.sanitizedSummary.apiCandidateCount, 1);
      assert.equal(JSON.stringify(summaryArtifact).includes(secret), false);

      const candidatePath = path.join(workspace, summaryArtifact.apiCandidateArtifacts[0]);
      const candidateArtifact = await readJson(candidatePath);
      assert.equal(JSON.stringify(candidateArtifact).includes(secret), false);
      const capabilities = await readJson(path.join(result.artifactDir, 'capabilities.json'));
      const captureCapability = capabilities.capabilities.find((capability) => capability.name === 'capture network APIs');
      assert.equal(captureCapability?.status, 'candidate');
      assert.equal(captureCapability?.apiCandidateCount, 1);
      assert.equal(captureCapability?.evidence.length > 0, true);
      assert.equal(Object.hasOwn(captureCapability, 'executionPlan'), false);

      const userReport = await readJson(path.join(result.artifactDir, 'build_report.user.json'));
      const userReportText = JSON.stringify(userReport);
      assert.equal(userReport.privacy_summary.raw_network_traces_persisted, false);
      assert.equal(userReport.privacy_summary.network_summary_only, true);
      assert.equal(userReportText.includes(secret), false);
      assert.equal(userReportText.includes('network_traces.raw.json'), false);
      assert.equal(userReport.api_discovery_summary.api_candidate_count, 1);
      assert.equal(userReport.api_discovery_summary.raw_network_traces_persisted, false);
      assert.equal(userReport.warnings_user_facing.some((warning) => /in-memory replay only/u.test(warning)), true);

      const debugReport = await readJson(path.join(result.artifactDir, 'build_report.debug.json'));
      assert.equal(debugReport.collector_status.network.raw_traces_persisted, false);
      assert.equal(debugReport.collector_status.network.raw_trace_count, 1);
      assert.equal(JSON.stringify(debugReport).includes('network_traces.raw.json'), false);

      assert.equal(await fileExists(path.join(result.buildContext.workspace.paths.currentDir, 'network_traces.raw.json')), false);
      const registry = await readJson(result.buildContext.workspace.paths.registryPath);
      assert.equal(JSON.stringify(registry).includes('network_traces.raw.json'), false);
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('replay verified browser-auth read-only API becomes active browser bridge API capability', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-api-adapter-replay-'));
  const secret = 'synthetic-internal-raw-token';
  let bridgeReplayRequest = null;
  try {
    await withTestSite(siteRoutes, async (rootUrl) => {
      const parsed = parseCliArgs([rootUrl]);
      const result = await runSiteForgeBuild(rootUrl, {
        ...parsed.options,
        cwd: workspace,
        buildId: 'api-adapter-replay-build',
        now: new Date('2026-05-26T01:00:00.000Z'),
        maxDepth: 1,
        maxPages: 4,
        maxSeeds: 4,
        fetchDelayMs: 0,
        authStateReport: browserVerifiedAuthState(rootUrl),
        apiAdapterResolver: acceptingFixtureApiAdapter,
        browserBridgeApiReplayProvider: async (request) => {
          bridgeReplayRequest = request;
          return {
            status: 'verified',
            httpStatus: 200,
            contentType: 'application/json',
            responseKind: 'json',
            bodyText: JSON.stringify({ token: secret, items: [{ id: 1 }] }),
          };
        },
        publicRenderedStructureProvider: async ({ context }) => {
          context.internalRawNetworkCapture = {
            status: 'captured',
            rawTraces: [rawReadApiTrace(rootUrl, secret)],
            observedRequests: [observedReadApiRequest(rootUrl, context.site.id, secret)],
            observedResponseSummaries: [],
          };
          return {
            publicRenderedPages: [{
              url: rootUrl,
              title: 'Internal Raw Network',
              visibleItemCount: 1,
              links: [{ href: new URL('/article/1', rootUrl).toString(), label: 'Article' }],
            }],
          };
        },
      });

      assert.equal(result.status, 'success');
      const summaryArtifact = await readJson(path.join(result.artifactDir, 'network_traces.json'));
      assert.equal(summaryArtifact.sanitizedSummary.apiCandidateCount, 1);
      assert.equal(summaryArtifact.sanitizedSummary.adapterValidationCount, 1);
      assert.equal(summaryArtifact.sanitizedSummary.replayVerifiedCount, 1);
      assert.equal(summaryArtifact.sanitizedSummary.activatedApiAdapterCount, 1);
      assert.equal(JSON.stringify(summaryArtifact).includes(secret), false);
      assert.equal(bridgeReplayRequest.endpoint, new URL('/api/feed?page=1', rootUrl).toString());
      assert.equal(bridgeReplayRequest.runtimeBoundary, 'browser_bridge_page_context_fetch');
      assert.equal(bridgeReplayRequest.fetchOptions.credentials, 'include');
      assert.equal(bridgeReplayRequest.fetchOptions.persistResponseBody, false);

      const decisionPath = path.join(result.artifactDir, 'discovery', 'api-adapter-decisions', 'decision-0001.json');
      const replayPath = path.join(result.artifactDir, 'discovery', 'api-replay-verifications', 'replay-0001.json');
      const decisionArtifact = await readJson(decisionPath);
      const replayArtifact = await readJson(replayPath);
      assert.equal(decisionArtifact.status, 'accepted');
      assert.equal(replayArtifact.status, 'verified');
      assert.equal(replayArtifact.activated, true);
      assert.equal(JSON.stringify({ decisionArtifact, replayArtifact }).includes(secret), false);

      const capabilities = await readJson(path.join(result.artifactDir, 'capabilities.json'));
      const apiCapability = capabilities.capabilities.find((capability) => capability.apiAdapter?.replayVerificationRef);
      assert.equal(apiCapability?.status, 'active');
      assert.equal(apiCapability?.executionPlan?.mode, 'limited_read');
      assert.equal(apiCapability?.executionPlan?.limitedOutputOnly, true);
      assert.equal(apiCapability?.executionPlan?.steps?.[0]?.kind, 'api_request');
      assert.equal(apiCapability?.runtimeMode, 'browser_bridge_required');
      assert.equal(apiCapability?.requiresFreshBridgeEvidence, true);
      assert.equal(apiCapability?.genericHttpRuntimeAllowed, false);
      assert.equal(apiCapability?.apiAdapter?.responsePolicy, 'sanitized_summary_only');
      assert.ok(apiCapability?.apiAdapter?.runtimeBindingId);
      assert.equal(apiCapability?.executionPlan?.steps?.[0]?.runtimeBindingId, apiCapability.apiAdapter.runtimeBindingId);
      const bindingArtifact = await readJson(path.join(result.artifactDir, 'runtime', 'api-adapter-bindings.internal.json'));
      assert.equal(bindingArtifact.internalOnly, true);
      assert.equal(bindingArtifact.bindings.length, 1);
      assert.equal(bindingArtifact.bindings[0].id, apiCapability.apiAdapter.runtimeBindingId);
      assert.equal(bindingArtifact.bindings[0].endpoint, new URL('/api/feed?page=1', rootUrl).toString());
      assert.equal(bindingArtifact.bindings[0].requestPolicy.persistResponseBody, false);
      assert.equal(JSON.stringify(bindingArtifact).includes(secret), false);
      const promotionGate = await readJson(path.join(result.artifactDir, 'discovery', 'api-catalog-promotion-gates', 'gate-0001.json'));
      assert.equal(promotionGate.status, 'blocked');
      assert.equal(promotionGate.canEnterCatalog, false);
      assert.equal(promotionGate.reasonCode, 'api-catalog-entry-blocked');
      assert.equal(promotionGate.observedApiAutoPromotionAllowed, false);
      assert.equal(promotionGate.requirements.replayVerified, true);
      assert.equal(promotionGate.requirements.policyAllowsCatalogUpgrade, false);
      assert.equal(Object.hasOwn(promotionGate, 'endpoint'), false);
      assert.equal(JSON.stringify(promotionGate).includes(secret), false);

      const intents = await readJson(path.join(result.artifactDir, 'intents.json'));
      assert.equal(intents.intents.some((intent) => intent.capabilityId === apiCapability.id && intent.callable === true), true);
      const registry = await readJson(result.buildContext.workspace.paths.registryPath);
      const record = registry.skills.find((skill) => skill.skillId === result.skillId);
      const registeredIntent = record?.intents.find((intent) => intent.capabilityId === apiCapability.id);
      assert.equal(registeredIntent?.runtimeMode, 'browser_bridge_required');
      assert.equal(registeredIntent?.requiresFreshBridgeEvidence, true);
      assert.equal(registeredIntent?.runtimeBindingId, apiCapability.apiAdapter.runtimeBindingId);

      const userReport = await readJson(path.join(result.artifactDir, 'build_report.user.json'));
      assert.equal(userReport.api_discovery_summary.activated_api_adapter_count, 1);
      assert.equal(userReport.api_discovery_summary.replay_verified_count, 1);
      assert.equal(userReport.api_discovery_summary.catalog_promotion_gate_count, 1);
      assert.equal(userReport.api_discovery_summary.catalog_promotion_ready_count, 0);
      assert.equal(JSON.stringify(userReport).includes(secret), false);
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('HEAD browser-auth API replay becomes active browser bridge API capability', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-api-adapter-head-replay-'));
  const secret = 'synthetic-internal-raw-token';
  let bridgeReplayRequest = null;
  try {
    await withTestSite(siteRoutes, async (rootUrl) => {
      const parsed = parseCliArgs([rootUrl]);
      const result = await runSiteForgeBuild(rootUrl, {
        ...parsed.options,
        cwd: workspace,
        buildId: 'api-adapter-head-replay-build',
        now: new Date('2026-05-26T01:02:00.000Z'),
        maxDepth: 1,
        maxPages: 4,
        maxSeeds: 4,
        fetchDelayMs: 0,
        authStateReport: browserVerifiedAuthState(rootUrl),
        apiAdapterResolver: acceptingFixtureApiAdapter,
        browserBridgeApiReplayProvider: async (request) => {
          bridgeReplayRequest = request;
          return {
            status: 'verified',
            httpStatus: 204,
            contentType: null,
            responseKind: null,
          };
        },
        publicRenderedStructureProvider: async ({ context }) => {
          context.internalRawNetworkCapture = {
            status: 'captured',
            rawTraces: [rawReadApiTrace(rootUrl, secret, { method: 'HEAD', requestId: 'synthetic-head-api-request' })],
            observedRequests: [observedReadApiRequest(rootUrl, context.site.id, secret, { method: 'HEAD', requestId: 'synthetic-head-api-request' })],
            observedResponseSummaries: [],
          };
          return {
            publicRenderedPages: [{
              url: rootUrl,
              title: 'Internal Raw Network',
              visibleItemCount: 1,
              links: [{ href: new URL('/article/1', rootUrl).toString(), label: 'Article' }],
            }],
          };
        },
      });

      assert.equal(result.status, 'success');
      const summaryArtifact = await readJson(path.join(result.artifactDir, 'network_traces.json'));
      assert.equal(summaryArtifact.sanitizedSummary.apiCandidateCount, 1);
      assert.equal(summaryArtifact.sanitizedSummary.replayVerifiedCount, 1);
      assert.equal(summaryArtifact.sanitizedSummary.activatedApiAdapterCount, 1);
      assert.equal(bridgeReplayRequest.method, 'HEAD');
      assert.equal(bridgeReplayRequest.fetchOptions.method, 'HEAD');
      assert.equal(bridgeReplayRequest.fetchOptions.body, null);
      assert.equal(bridgeReplayRequest.fetchOptions.persistResponseBody, false);

      const replayArtifact = await readJson(path.join(result.artifactDir, 'discovery', 'api-replay-verifications', 'replay-0001.json'));
      assert.equal(replayArtifact.status, 'verified');
      assert.equal(replayArtifact.activated, true);
      assert.equal(replayArtifact.method, 'HEAD');

      const capabilities = await readJson(path.join(result.artifactDir, 'capabilities.json'));
      const apiCapability = capabilities.capabilities.find((capability) => capability.apiAdapter?.replayVerificationRef);
      assert.equal(apiCapability?.status, 'active');
      assert.equal(apiCapability?.executionPlan?.steps?.[0]?.method, 'HEAD');
      const bindingArtifact = await readJson(path.join(result.artifactDir, 'runtime', 'api-adapter-bindings.internal.json'));
      assert.equal(bindingArtifact.bindings[0].method, 'HEAD');
      assert.equal(bindingArtifact.bindings[0].requestPolicy.persistResponseBody, false);
      assert.equal(JSON.stringify({ summaryArtifact, replayArtifact, bindingArtifact }).includes(secret), false);
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('browser-auth API replay can use cookie only for build-time verification with bridge runtime evidence', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-api-adapter-cookie-replay-'));
  const rawSecret = 'synthetic-internal-raw-token';
  const cookieSecret = 'synthetic-cookie-replay-secret';
  try {
    await withTestSite((rootUrl) => ({
      ...siteRoutes(rootUrl),
      '/api/feed': {
        contentType: 'text/html; charset=utf-8',
        body: JSON.stringify({ items: [{ id: 1 }] }),
      },
    }), async (rootUrl) => {
      const parsed = parseCliArgs([rootUrl]);
      const result = await runSiteForgeBuild(rootUrl, {
        ...parsed.options,
        cwd: workspace,
        buildId: 'api-adapter-cookie-replay-build',
        now: new Date('2026-05-26T01:02:00.000Z'),
        maxDepth: 1,
        maxPages: 4,
        maxSeeds: 4,
        fetchDelayMs: 0,
        authStateReport: browserVerifiedAuthState(rootUrl),
        apiAdapterResolver: acceptingFixtureApiAdapter,
        apiReplayCookieHeader: `sid=${cookieSecret}`,
        browserBridgeApiReplayProvider: async () => ({
          status: 'skipped',
          reasonCode: 'browser_bridge_replay_timeout',
        }),
        publicRenderedStructureProvider: async ({ context }) => {
          context.internalRawNetworkCapture = {
            status: 'captured',
            rawTraces: [rawReadApiTrace(rootUrl, rawSecret)],
            observedRequests: [observedReadApiRequest(rootUrl, context.site.id, rawSecret)],
            observedResponseSummaries: [],
          };
          return {
            publicRenderedPages: [{
              url: rootUrl,
              title: 'Internal Raw Network',
              visibleItemCount: 1,
              links: [{ href: new URL('/article/1', rootUrl).toString(), label: 'Article' }],
            }],
          };
        },
      });

      assert.equal(result.status, 'success');
      const replayArtifact = await readJson(path.join(result.artifactDir, 'discovery', 'api-replay-verifications', 'replay-0001.json'));
      assert.equal(replayArtifact.status, 'verified');
      assert.equal(replayArtifact.activated, true);
      assert.equal(replayArtifact.replayPolicy.buildTimeAuthBoundary, 'cookie_replay_only');
      assert.equal(replayArtifact.replayPolicy.runtimeRegistration, 'browser_bridge_required');
      assert.equal(replayArtifact.replayPolicy.savedCookieMaterial, false);
      assert.equal(JSON.stringify(replayArtifact).includes(cookieSecret), false);

      const capabilities = await readJson(path.join(result.artifactDir, 'capabilities.json'));
      const apiCapability = capabilities.capabilities.find((capability) => capability.apiAdapter?.replayVerificationRef);
      assert.equal(apiCapability?.status, 'active');
      assert.equal(apiCapability?.runtimeMode, 'browser_bridge_required');
      assert.equal(apiCapability?.requiresFreshBridgeEvidence, true);
      assert.equal(JSON.stringify(apiCapability).includes(cookieSecret), false);

      const userReport = await readJson(path.join(result.artifactDir, 'build_report.user.json'));
      assert.equal(userReport.api_discovery_summary.activated_api_adapter_count, 1);
      assert.equal(JSON.stringify(userReport).includes(cookieSecret), false);
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('setup-blocked browser API discovery can replay read-only APIs with explicit cookie input', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-api-adapter-setup-blocked-cookie-replay-'));
  const rawSecret = 'synthetic-internal-raw-token';
  const cookieSecret = 'synthetic-setup-blocked-cookie-replay-secret';
  try {
    await withTestSite((rootUrl) => ({
      ...siteRoutes(rootUrl),
      '/api/feed': {
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify({ items: [{ id: 1 }] }),
      },
    }), async (rootUrl) => {
      const parsed = parseCliArgs([rootUrl]);
      const result = await runSiteForgeBuild(rootUrl, {
        ...parsed.options,
        cwd: workspace,
        buildId: 'api-adapter-setup-blocked-cookie-replay-build',
        now: new Date('2026-05-26T01:02:30.000Z'),
        maxDepth: 1,
        maxPages: 4,
        maxSeeds: 4,
        fetchDelayMs: 0,
        authMode: 'browser',
        allowSetupBlockedApiDiscovery: true,
        authStateReport: {
          authMethod: 'browser',
          authVerificationStatus: 'browser_bridge_missing',
          verified: false,
          browserBridge: {
            routeCoverageStatus: 'none',
            routeCount: 1,
            capturedRouteCount: 0,
            missingRouteCount: 1,
            routeResults: [{
              routeId: 'fixture-home',
              status: 'timeout',
              captured: false,
              targetUrl: rootUrl,
              targetRoute: '/',
              routeTemplate: '/',
            }],
          },
        },
        apiAdapterResolver: acceptingFixtureApiAdapter,
        apiReplayCookieHeader: `sid=${cookieSecret}`,
        publicRenderedStructureProvider: async ({ context }) => {
          context.internalRawNetworkCapture = {
            status: 'captured',
            rawTraces: [rawReadApiTrace(rootUrl, rawSecret)],
            observedRequests: [observedReadApiRequest(rootUrl, context.site.id, rawSecret)],
            observedResponseSummaries: [],
          };
          return {
            publicRenderedPages: [{
              url: rootUrl,
              title: 'Internal Raw Network',
              visibleItemCount: 1,
              links: [{ href: new URL('/article/1', rootUrl).toString(), label: 'Article' }],
            }],
          };
        },
      });

      assert.equal(result.status, 'success');
      const replayArtifact = await readJson(path.join(result.artifactDir, 'discovery', 'api-replay-verifications', 'replay-0001.json'));
      assert.equal(replayArtifact.status, 'verified');
      assert.equal(replayArtifact.activated, false);
      assert.equal(replayArtifact.authBoundary, 'cookie_replay_only');
      assert.equal(replayArtifact.replayPolicy.buildTimeAuthBoundary, 'cookie_replay_only');
      assert.equal(replayArtifact.replayPolicy.runtimeRegistration, 'not_registered');
      assert.equal(replayArtifact.replayPolicy.savedCookieMaterial, false);
      assert.equal(replayArtifact.response.httpStatus, 200);
      assert.equal(JSON.stringify(replayArtifact).includes(cookieSecret), false);

      const replaySummary = await readJson(path.join(result.artifactDir, 'discovery', 'api_adapter_replay.json'));
      assert.equal(replaySummary.summary.replayVerifiedCount, 1);
      assert.equal(replaySummary.summary.activatedApiAdapterCount, 0);
      assert.equal(JSON.stringify(replaySummary).includes(cookieSecret), false);
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('dynamic API replay uses browser bridge parameter source before cookie fallback', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-api-adapter-dynamic-replay-'));
  let bridgeReplayRequest = null;
  try {
    await withTestSite(siteRoutes, async (rootUrl) => {
      const parsed = parseCliArgs([rootUrl]);
      const result = await runSiteForgeBuild(rootUrl, {
        ...parsed.options,
        cwd: workspace,
        buildId: 'api-adapter-dynamic-replay-build',
        now: new Date('2026-05-26T01:04:00.000Z'),
        maxDepth: 1,
        maxPages: 4,
        maxSeeds: 4,
        fetchDelayMs: 0,
        authStateReport: browserVerifiedAuthState(rootUrl),
        apiAdapterResolver: acceptingFixtureApiAdapter,
        browserBridgeApiReplayProvider: async (request) => {
          bridgeReplayRequest = request;
          return {
            status: 'verified',
            httpStatus: 200,
            contentType: 'application/json',
            responseKind: 'json',
            responseEvidenceStatus: 'matched',
            observedStatusCode: 0,
            observedArrayFieldPresent: true,
          };
        },
        publicRenderedStructureProvider: async ({ context }) => {
          context.internalRawNetworkCapture = {
            status: 'captured',
            rawTraces: [rawDynamicReadApiTrace(rootUrl)],
            observedRequests: [observedDynamicReadApiRequest(rootUrl, context.site.id)],
            observedResponseSummaries: [],
          };
          return {
            publicRenderedPages: [{
              url: rootUrl,
              title: 'Internal Raw Network',
              visibleItemCount: 1,
              links: [{ href: new URL('/article/1', rootUrl).toString(), label: 'Article' }],
            }],
          };
        },
      });

      assert.equal(result.status, 'success');
      assert.equal(bridgeReplayRequest.runtimeParameterSource.kind, 'douyin_self_user_render_data');
      assert.equal(bridgeReplayRequest.responseEvidence.arrayField, 'items');
      assert.equal(bridgeReplayRequest.endpoint.includes('user_id='), true);

      const replayArtifact = await readJson(path.join(result.artifactDir, 'discovery', 'api-replay-verifications', 'replay-0001.json'));
      assert.equal(replayArtifact.status, 'verified');
      assert.equal(replayArtifact.activated, true);
      assert.equal(replayArtifact.replayPolicy.buildTimeAuthBoundary, 'browser_bridge');
      assert.equal(replayArtifact.replayPolicy.runtimeParameterSource.kind, 'douyin_self_user_render_data');
      assert.equal(replayArtifact.replayPolicy.responseEvidence.arrayField, 'items');

      const bindingArtifact = await readJson(path.join(result.artifactDir, 'runtime', 'api-adapter-bindings.internal.json'));
      assert.equal(bindingArtifact.bindings[0].runtimeParameterSource.kind, 'douyin_self_user_render_data');
      assert.equal(bindingArtifact.bindings[0].responseEvidence.arrayField, 'items');
      assert.equal(JSON.stringify(bindingArtifact).includes('synthetic-cookie-replay-secret'), false);
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('signed API replay keeps browser bridge instead of unsupported cookie fallback', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-api-adapter-signed-runtime-replay-'));
  const cookieSecret = 'synthetic-signed-runtime-cookie';
  let bridgeReplayRequest = null;
  try {
    await withTestSite(siteRoutes, async (rootUrl) => {
      const parsed = parseCliArgs([rootUrl]);
      const result = await runSiteForgeBuild(rootUrl, {
        ...parsed.options,
        cwd: workspace,
        buildId: 'api-adapter-signed-runtime-replay-build',
        now: new Date('2026-05-26T01:04:15.000Z'),
        maxDepth: 1,
        maxPages: 4,
        maxSeeds: 4,
        fetchDelayMs: 0,
        authStateReport: browserVerifiedAuthState(rootUrl),
        apiReplayCookieHeader: `sid=${cookieSecret}`,
        apiAdapterResolver: acceptingFixtureApiAdapter,
        browserBridgeApiReplayProvider: async (request) => {
          bridgeReplayRequest = request;
          return {
            status: 'verified',
            httpStatus: 200,
            contentType: 'application/json',
            responseKind: 'json',
            responseEvidenceStatus: 'matched',
            observedStatusCode: 0,
            observedObjectFieldPresent: true,
          };
        },
        publicRenderedStructureProvider: async ({ context }) => {
          context.internalRawNetworkCapture = {
            status: 'captured',
            rawTraces: [rawSignedRuntimeApiTrace(rootUrl)],
            observedRequests: [observedSignedRuntimeApiRequest(rootUrl, context.site.id)],
            observedResponseSummaries: [],
          };
          return {
            publicRenderedPages: [{
              url: rootUrl,
              title: 'Internal Raw Network',
              visibleItemCount: 1,
              links: [{ href: new URL('/article/1', rootUrl).toString(), label: 'Article' }],
            }],
          };
        },
      });

      assert.equal(result.status, 'success');
      assert.equal(bridgeReplayRequest.runtimeParameterSource.kind, 'qidian_yuew_sign');
      assert.equal(bridgeReplayRequest.endpoint, new URL('/api/signed/user', rootUrl).toString());
      assert.equal(bridgeReplayRequest.runtimeEndpoint, new URL('/api/signed/user', rootUrl).toString());
      assert.equal(JSON.stringify(bridgeReplayRequest).includes(cookieSecret), false);

      const replayArtifact = await readJson(path.join(result.artifactDir, 'discovery', 'api-replay-verifications', 'replay-0001.json'));
      assert.equal(replayArtifact.status, 'verified');
      assert.equal(replayArtifact.activated, true);
      assert.equal(replayArtifact.replayPolicy.buildTimeAuthBoundary, 'browser_bridge');
      assert.equal(replayArtifact.replayPolicy.runtimeParameterSource.kind, 'qidian_yuew_sign');
      assert.equal(JSON.stringify(replayArtifact).includes(cookieSecret), false);

      const bindingArtifact = await readJson(path.join(result.artifactDir, 'runtime', 'api-adapter-bindings.internal.json'));
      assert.equal(bindingArtifact.bindings[0].endpoint, new URL('/api/signed/user', rootUrl).toString());
      assert.equal(bindingArtifact.bindings[0].redactedEndpoint, replayArtifact.endpoint);
      assert.equal(JSON.stringify(bindingArtifact).includes(cookieSecret), false);
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('public Qidian signed API replay can use page-context bridge without auth state', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-api-adapter-qidian-public-page-context-'));
  let bridgeReplayRequest = null;
  try {
    await withTestSite(siteRoutes, async (rootUrl) => {
      const parsed = parseCliArgs([rootUrl]);
      const result = await runSiteForgeBuild(rootUrl, {
        ...parsed.options,
        cwd: workspace,
        buildId: 'api-adapter-qidian-public-page-context-build',
        now: new Date('2026-05-26T01:04:17.000Z'),
        maxDepth: 1,
        maxPages: 4,
        maxSeeds: 4,
        fetchDelayMs: 0,
        apiAdapterResolver: acceptingFixtureApiAdapter,
        browserBridgeApiReplayProvider: async (request) => {
          bridgeReplayRequest = request;
          return {
            status: 'verified',
            httpStatus: 200,
            contentType: 'application/json',
            responseKind: 'json',
            responseEvidenceStatus: 'matched',
            observedStatusCode: 0,
            observedObjectFieldPresent: true,
          };
        },
        publicRenderedStructureProvider: async ({ context }) => {
          context.internalRawNetworkCapture = {
            status: 'captured',
            rawTraces: [rawSignedRuntimeApiTrace(rootUrl)],
            observedRequests: [observedQidianPublicSignedRuntimeApiRequest(rootUrl)],
            observedResponseSummaries: [],
          };
          return {
            publicRenderedPages: [{
              url: rootUrl,
              title: 'Internal Raw Network',
              visibleItemCount: 1,
              links: [{ href: new URL('/article/1', rootUrl).toString(), label: 'Article' }],
            }],
          };
        },
      });

      assert.equal(result.status, 'success');
      assert.equal(bridgeReplayRequest.authBoundary, 'public_browser_bridge');
      assert.equal(bridgeReplayRequest.fetchOptions.credentials, 'same-origin');
      assert.equal(bridgeReplayRequest.runtimeParameterSource.kind, 'qidian_yuew_sign');

      const replayArtifact = await readJson(path.join(result.artifactDir, 'discovery', 'api-replay-verifications', 'replay-0001.json'));
      assert.equal(replayArtifact.status, 'verified');
      assert.equal(replayArtifact.activated, true);
      assert.equal(replayArtifact.authBoundary, 'public_browser_bridge');
      assert.equal(replayArtifact.replayPolicy.buildTimeAuthBoundary, 'public_browser_bridge');
      assert.equal(replayArtifact.replayPolicy.credentials, 'same-origin');
      assert.equal(replayArtifact.replayPolicy.publicPageContextOnly, true);
      assert.equal(replayArtifact.replayPolicy.runtimeParameterSource.kind, 'qidian_yuew_sign');

      const bindingArtifact = await readJson(path.join(result.artifactDir, 'runtime', 'api-adapter-bindings.internal.json'));
      assert.equal(bindingArtifact.bindings[0].authBoundary, 'public_browser_bridge');
      assert.equal(bindingArtifact.bindings[0].requestPolicy.credentials, 'same-origin');

      const summaryArtifact = await readJson(path.join(result.artifactDir, 'network_traces.json'));
      assert.equal(summaryArtifact.sanitizedSummary.replayVerifiedCount, 1);
      assert.equal(summaryArtifact.sanitizedSummary.activatedApiAdapterCount, 1);
      assert.doesNotMatch(JSON.stringify({ bridgeReplayRequest, replayArtifact, bindingArtifact }), /sid=|authorization|bearer/iu);
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('public Qidian signed API replay blocks account scoped semantics without auth state', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-api-adapter-qidian-public-account-blocked-'));
  let replayCalled = false;
  try {
    await withTestSite(siteRoutes, async (rootUrl) => {
      const parsed = parseCliArgs([rootUrl]);
      const result = await runSiteForgeBuild(rootUrl, {
        ...parsed.options,
        cwd: workspace,
        buildId: 'api-adapter-qidian-public-account-blocked-build',
        now: new Date('2026-05-26T01:04:17.500Z'),
        maxDepth: 1,
        maxPages: 4,
        maxSeeds: 4,
        fetchDelayMs: 0,
        apiAdapterResolver: acceptingFixtureApiAdapter,
        browserBridgeApiReplayProvider: async () => {
          replayCalled = true;
          return { status: 'verified', httpStatus: 200 };
        },
        publicRenderedStructureProvider: async ({ context }) => {
          context.internalRawNetworkCapture = {
            status: 'captured',
            rawTraces: [rawSignedRuntimeApiTrace(rootUrl)],
            observedRequests: [observedQidianPublicSignedRuntimeApiRequest(rootUrl, {
              semanticKind: 'read-authenticated-user',
            })],
            observedResponseSummaries: [],
          };
          return {
            publicRenderedPages: [{
              url: rootUrl,
              title: 'Internal Raw Network',
              visibleItemCount: 1,
              links: [{ href: new URL('/article/1', rootUrl).toString(), label: 'Article' }],
            }],
          };
        },
      });

      assert.equal(result.status, 'success');
      assert.equal(replayCalled, false);
      const replayArtifact = await readJson(path.join(result.artifactDir, 'discovery', 'api-replay-verifications', 'replay-0001.json'));
      assert.equal(replayArtifact.status, 'skipped');
      assert.equal(replayArtifact.activated, false);
      assert.equal(replayArtifact.reasonCode, 'qidian_api_semantic_requires_account_or_review');
      assert.equal(replayArtifact.authBoundary, 'none');
      const summaryArtifact = await readJson(path.join(result.artifactDir, 'network_traces.json'));
      assert.equal(summaryArtifact.sanitizedSummary.activatedApiAdapterCount, 0);
      assert.equal(summaryArtifact.sanitizedSummary.adapterSkippedReasonCounts.qidian_api_semantic_requires_account_or_review, 1);
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('signed Qidian API replay prefers captured overlay page for runtime signing', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-api-adapter-qidian-overlay-page-'));
  const cookieSecret = 'synthetic-qidian-overlay-cookie';
  let bridgeReplayRequest = null;
  try {
    await withTestSite(siteRoutes, async (rootUrl) => {
      const parsed = parseCliArgs([rootUrl]);
      const authStateReport = {
        ...browserVerifiedAuthState(rootUrl),
        authVerificationStatus: 'browser_verified_partial',
        browserBridge: {
          routeCoverageStatus: 'partial',
          routeCount: 3,
          capturedRouteCount: 2,
          missingRouteCount: 1,
          routeResults: [{
            routeId: 'fixture-root',
            sourceLayer: 'authenticated',
            status: 'challenge_detected',
            captured: false,
            targetUrl: rootUrl,
            targetRoute: '/',
            reasonCode: 'browser-bridge-definite-challenge',
          }, {
            routeId: 'fixture-rank',
            sourceLayer: 'authenticated_overlay',
            status: 'captured',
            captured: true,
            targetUrl: new URL('/rank/', rootUrl).toString(),
            targetRoute: '/rank/',
          }, {
            routeId: 'fixture-search',
            sourceLayer: 'authenticated_overlay',
            status: 'captured',
            captured: true,
            targetUrl: new URL('/soushu/', rootUrl).toString(),
            targetRoute: '/soushu/',
          }],
        },
      };
      const result = await runSiteForgeBuild(rootUrl, {
        ...parsed.options,
        cwd: workspace,
        buildId: 'api-adapter-qidian-overlay-page-build',
        now: new Date('2026-05-26T01:04:18.000Z'),
        maxDepth: 1,
        maxPages: 4,
        maxSeeds: 4,
        fetchDelayMs: 0,
        authStateReport,
        apiReplayCookieHeader: `sid=${cookieSecret}`,
        apiAdapterResolver: acceptingFixtureApiAdapter,
        browserBridgeApiReplayProvider: async (request) => {
          bridgeReplayRequest = request;
          return {
            status: 'verified',
            httpStatus: 200,
            contentType: 'application/json',
            responseKind: 'json',
            responseEvidenceStatus: 'matched',
            observedStatusCode: 0,
            observedObjectFieldPresent: true,
          };
        },
        publicRenderedStructureProvider: async ({ context }) => {
          context.internalRawNetworkCapture = {
            status: 'captured',
            rawTraces: [rawSignedRuntimeApiTrace(rootUrl)],
            observedRequests: [observedSignedRuntimeApiRequest(rootUrl, context.site.id)],
            observedResponseSummaries: [],
          };
          return {
            publicRenderedPages: [{
              url: rootUrl,
              title: 'Internal Raw Network',
              visibleItemCount: 1,
              links: [{ href: new URL('/article/1', rootUrl).toString(), label: 'Article' }],
            }],
          };
        },
      });

      assert.equal(result.status, 'success');
      assert.equal(bridgeReplayRequest.runtimeParameterSource.kind, 'qidian_yuew_sign');
      assert.equal(bridgeReplayRequest.runtimeParameterSource.pageUrl, new URL('/soushu/', rootUrl).toString());
      assert.equal(JSON.stringify(bridgeReplayRequest).includes(cookieSecret), false);

      const replayArtifact = await readJson(path.join(result.artifactDir, 'discovery', 'api-replay-verifications', 'replay-0001.json'));
      assert.equal(replayArtifact.status, 'verified');
      assert.equal(replayArtifact.replayPolicy.runtimeParameterSource.pageUrl, new URL('/soushu/', rootUrl).toString());
      assert.equal(JSON.stringify(replayArtifact).includes(cookieSecret), false);
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('X web-auth API replay can use user-authorized browser bridge behind robots block', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-api-adapter-x-web-auth-robots-'));
  let bridgeReplayRequest = null;
  try {
    await withTestSite((rootUrl) => ({
      ...siteRoutes(rootUrl),
      '/robots.txt': {
        contentType: 'text/plain; charset=utf-8',
        body: testRobotsTxt(rootUrl, { disallow: '/i/api', sitemap: false }),
      },
      '/i/api/1.1/hashflags.json': {
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify({ ok: true }),
      },
    }), async (rootUrl) => {
      const parsed = parseCliArgs([rootUrl]);
      const result = await runSiteForgeBuild(rootUrl, {
        ...parsed.options,
        cwd: workspace,
        buildId: 'api-adapter-x-web-auth-robots-build',
        now: new Date('2026-05-26T01:04:25.000Z'),
        maxDepth: 1,
        maxPages: 4,
        maxSeeds: 4,
        fetchDelayMs: 0,
        authStateReport: browserVerifiedAuthState(rootUrl),
        apiAdapterResolver: acceptingFixtureApiAdapter,
        browserBridgeApiReplayProvider: async (request) => {
          bridgeReplayRequest = request;
          return {
            status: 'verified',
            httpStatus: 200,
            contentType: 'application/json',
            responseKind: 'json',
          };
        },
        publicRenderedStructureProvider: async ({ context }) => {
          context.internalRawNetworkCapture = {
            status: 'captured',
            rawTraces: [rawXWebAuthRuntimeApiTrace(rootUrl)],
            observedRequests: [observedXWebAuthRuntimeApiRequest(rootUrl)],
            observedResponseSummaries: [],
          };
          return {
            publicRenderedPages: [{
              url: rootUrl,
              title: 'Internal Raw Network',
              visibleItemCount: 1,
              links: [{ href: new URL('/article/1', rootUrl).toString(), label: 'Article' }],
            }],
          };
        },
      });

      assert.equal(result.status, 'success');
      assert.equal(bridgeReplayRequest.runtimeParameterSource.kind, 'x_web_auth_headers');
      assert.equal(Object.hasOwn(bridgeReplayRequest.runtimeParameterSource, 'csrfCookieName'), false);
      assert.equal(bridgeReplayRequest.endpoint, new URL('/i/api/1.1/hashflags.json', rootUrl).toString());

      const replayArtifact = await readJson(path.join(result.artifactDir, 'discovery', 'api-replay-verifications', 'replay-0001.json'));
      assert.equal(replayArtifact.status, 'verified');
      assert.equal(replayArtifact.activated, true);
      assert.equal(replayArtifact.endpointPattern, replayArtifact.endpoint);
      assert.equal(replayArtifact.redactedEndpoint, replayArtifact.endpointPattern);
      assert.equal(replayArtifact.endpointExecutable, false);
      assert.match(replayArtifact.endpointOperationRef, /^api-operation:read-hashflags/iu);
      assert.doesNotMatch(replayArtifact.endpointOperationRef, /https?:|ct0|auth_token|authorization|bearer/iu);
      assert.equal(replayArtifact.replayPolicy.buildTimeAuthBoundary, 'browser_bridge');
      assert.equal(replayArtifact.replayPolicy.robotsUserAuthorizedBypass, true);
      assert.equal(replayArtifact.replayPolicy.runtimeParameterSource.kind, 'x_web_auth_headers');
      assert.equal(Object.hasOwn(replayArtifact.replayPolicy.runtimeParameterSource, 'csrfCookieName'), false);
      assert.doesNotMatch(JSON.stringify(replayArtifact), /ct0=|auth_token=|authorization|bearer/iu);
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('X web-auth API replay preserves query keys in redacted endpoint pattern', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-api-adapter-x-web-auth-query-'));
  const endpointPath = '/i/api/2/badge_count/badge_count.json?supports_ntab_urt=1';
  try {
    await withTestSite((rootUrl) => ({
      ...siteRoutes(rootUrl),
      '/robots.txt': {
        contentType: 'text/plain; charset=utf-8',
        body: testRobotsTxt(rootUrl, { disallow: '/i/api', sitemap: false }),
      },
      '/i/api/2/badge_count/badge_count.json': {
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify({ ntab: 0 }),
      },
    }), async (rootUrl) => {
      const parsed = parseCliArgs([rootUrl]);
      const result = await runSiteForgeBuild(rootUrl, {
        ...parsed.options,
        cwd: workspace,
        buildId: 'api-adapter-x-web-auth-query-build',
        now: new Date('2026-05-26T01:04:28.000Z'),
        maxDepth: 1,
        maxPages: 4,
        maxSeeds: 4,
        fetchDelayMs: 0,
        authStateReport: browserVerifiedAuthState(rootUrl),
        apiAdapterResolver: acceptingFixtureApiAdapter,
        browserBridgeApiReplayProvider: async () => ({
          status: 'verified',
          httpStatus: 200,
          contentType: 'application/json',
          responseKind: 'json',
        }),
        publicRenderedStructureProvider: async ({ context }) => {
          context.internalRawNetworkCapture = {
            status: 'captured',
            rawTraces: [rawXWebAuthRuntimeApiTrace(rootUrl, endpointPath)],
            observedRequests: [observedXWebAuthRuntimeApiRequest(rootUrl, endpointPath)],
            observedResponseSummaries: [],
          };
          return {
            publicRenderedPages: [{
              url: rootUrl,
              title: 'Internal Raw Network',
              visibleItemCount: 1,
              links: [{ href: new URL('/article/1', rootUrl).toString(), label: 'Article' }],
            }],
          };
        },
      });

      assert.equal(result.status, 'success');
      const replayArtifact = await readJson(path.join(result.artifactDir, 'discovery', 'api-replay-verifications', 'replay-0001.json'));
      assert.equal(replayArtifact.status, 'verified');
      assert.equal(replayArtifact.endpointPattern.endsWith('?keys=supports_ntab_urt'), true);
      assert.equal(replayArtifact.endpointPattern.includes('?keys=keys'), false);
      assert.match(replayArtifact.endpointOperationRef, /^api-operation:read-badge-count-summary/iu);
      assert.doesNotMatch(JSON.stringify(replayArtifact), /supports_ntab_urt=1|ct0=|auth_token=|authorization|bearer/iu);
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('X browser-context API replay can verify hashflags behind robots block', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-api-adapter-x-browser-context-robots-'));
  let bridgeReplayRequest = null;
  try {
    await withTestSite((rootUrl) => ({
      ...siteRoutes(rootUrl),
      '/robots.txt': {
        contentType: 'text/plain; charset=utf-8',
        body: testRobotsTxt(rootUrl, { disallow: '/i/api', sitemap: false }),
      },
      '/i/api/1.1/hashflags.json': {
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify({ ok: true }),
      },
    }), async (rootUrl) => {
      const parsed = parseCliArgs([rootUrl]);
      const result = await runSiteForgeBuild(rootUrl, {
        ...parsed.options,
        cwd: workspace,
        buildId: 'api-adapter-x-browser-context-robots-build',
        now: new Date('2026-05-26T01:04:30.000Z'),
        maxDepth: 1,
        maxPages: 4,
        maxSeeds: 4,
        fetchDelayMs: 0,
        authStateReport: browserVerifiedAuthState(rootUrl),
        apiAdapterResolver: acceptingFixtureApiAdapter,
        browserBridgeApiReplayProvider: async (request) => {
          bridgeReplayRequest = request;
          return {
            status: 'verified',
            httpStatus: 200,
            contentType: 'application/json',
            responseKind: 'json',
          };
        },
        publicRenderedStructureProvider: async ({ context }) => {
          context.internalRawNetworkCapture = {
            status: 'captured',
            rawTraces: [rawXBrowserContextRuntimeApiTrace(rootUrl)],
            observedRequests: [observedXBrowserContextRuntimeApiRequest(rootUrl)],
            observedResponseSummaries: [],
          };
          return {
            publicRenderedPages: [{
              url: rootUrl,
              title: 'Internal Raw Network',
              visibleItemCount: 1,
              links: [{ href: new URL('/article/1', rootUrl).toString(), label: 'Article' }],
            }],
          };
        },
      });

      const replayArtifact = await readJson(path.join(result.artifactDir, 'discovery', 'api-replay-verifications', 'replay-0001.json'));
      assert.equal(result.status, 'success');
      if (bridgeReplayRequest) {
        assert.equal(bridgeReplayRequest.runtimeParameterSource, null);
        assert.equal(bridgeReplayRequest.endpoint, new URL('/i/api/1.1/hashflags.json', rootUrl).toString());
      }
      assert.equal(replayArtifact.status, 'verified');
      assert.equal(replayArtifact.activated, true);
      assert.equal(replayArtifact.replayPolicy.buildTimeAuthBoundary, 'browser_bridge');
      assert.equal(replayArtifact.replayPolicy.robotsUserAuthorizedBypass, true);
      assert.equal(replayArtifact.replayPolicy.runtimeParameterSource, null);
      assert.doesNotMatch(JSON.stringify(replayArtifact), /ct0=|auth_token=|authorization|bearer/iu);
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('X web-auth API replay records bridge remediation when runtime source is unsupported', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-api-adapter-x-runtime-remediation-'));
  try {
    await withTestSite((rootUrl) => ({
      ...siteRoutes(rootUrl),
      '/robots.txt': {
        contentType: 'text/plain; charset=utf-8',
        body: testRobotsTxt(rootUrl, { disallow: '/i/api', sitemap: false }),
      },
      '/i/api/1.1/hashflags.json': {
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify({ ok: true }),
      },
    }), async (rootUrl) => {
      const parsed = parseCliArgs([rootUrl]);
      const authState = browserVerifiedAuthState(rootUrl);
      authState.browserBridge.extensionStages = [
        'bridge-content-version:route-queue-chinese-semantic-v7',
        'bridge-version:route-queue-chinese-semantic-v7',
        'collector-version:fixture-home:route-queue-chinese-semantic-v7',
      ];
      const result = await runSiteForgeBuild(rootUrl, {
        ...parsed.options,
        cwd: workspace,
        buildId: 'api-adapter-x-runtime-remediation-build',
        now: new Date('2026-05-26T01:04:33.000Z'),
        maxDepth: 1,
        maxPages: 4,
        maxSeeds: 4,
        fetchDelayMs: 0,
        authStateReport: authState,
        apiAdapterResolver: acceptingFixtureApiAdapter,
        browserBridgeApiReplayProvider: async () => ({
          status: 'skipped',
          reasonCode: 'runtime_parameter_source_unsupported',
          httpStatus: null,
          contentType: null,
          responseKind: null,
        }),
        publicRenderedStructureProvider: async ({ context }) => {
          context.internalRawNetworkCapture = {
            status: 'captured',
            rawTraces: [rawXWebAuthRuntimeApiTrace(rootUrl)],
            observedRequests: [observedXWebAuthRuntimeApiRequest(rootUrl)],
            observedResponseSummaries: [],
          };
          return {
            publicRenderedPages: [{
              url: rootUrl,
              title: 'Internal Raw Network',
              visibleItemCount: 1,
              links: [{ href: new URL('/article/1', rootUrl).toString(), label: 'Article' }],
            }],
          };
        },
      });

      assert.equal(result.status, 'success');
      const replayArtifact = await readJson(path.join(result.artifactDir, 'discovery', 'api-replay-verifications', 'replay-0001.json'));
      assert.equal(replayArtifact.status, 'skipped');
      assert.equal(replayArtifact.reasonCode, 'runtime_parameter_source_unsupported');
      assert.equal(replayArtifact.runtimeRemediation.status, 'blocked');
      assert.equal(replayArtifact.runtimeRemediation.reasonCode, 'runtime_parameter_source_unsupported');
      assert.equal(replayArtifact.runtimeRemediation.runtimeParameterSourceKind, 'x_web_auth_headers');
      assert.equal(replayArtifact.runtimeRemediation.expectedBrowserBridgeExtensionVersion, 'route-queue-x-api-runtime-v8');
      assert.deepEqual(replayArtifact.runtimeRemediation.observedBridgeVersions, ['route-queue-chinese-semantic-v7']);
      assert.deepEqual(replayArtifact.runtimeRemediation.observedContentVersions, ['route-queue-chinese-semantic-v7']);
      assert.deepEqual(replayArtifact.runtimeRemediation.observedCollectorVersions, ['route-queue-chinese-semantic-v7']);
      assert.equal(replayArtifact.runtimeRemediation.versionStatus, 'stale_or_incompatible_observed');
      assert.equal(replayArtifact.runtimeRemediation.fallback.authMaterialFallbackSupported, true);
      assert.equal(replayArtifact.runtimeRemediation.fallback.authMaterialFallbackConfigured, false);
      assert.equal(replayArtifact.runtimeRemediation.fallback.authMaterialFallbackAvailable, false);
      assert.equal(replayArtifact.runtimeRemediation.fallback.rawMaterialPersisted, false);
      assert.equal(replayArtifact.runtimeRemediation.requiredAction, 'reload_browser_bridge_extension_or_configure_governed_auth_material_fallback');
      assert.doesNotMatch(JSON.stringify(replayArtifact), /ct0=|auth_token=|authorization|bearer/iu);
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('X web-auth API replay falls back to in-memory cookie CSRF when bridge lacks runtime support', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-api-adapter-x-cookie-fallback-'));
  const cookieSecret = 'synthetic-x-auth-secret';
  const csrfSecret = 'synthetic-x-csrf-secret';
  try {
    await withTestSite((rootUrl) => ({
      ...siteRoutes(rootUrl),
      '/robots.txt': {
        contentType: 'text/plain; charset=utf-8',
        body: testRobotsTxt(rootUrl, { disallow: '/i/api', sitemap: false }),
      },
      '/i/api/1.1/hashflags.json': {
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify({ ok: true }),
      },
    }), async (rootUrl) => {
      const parsed = parseCliArgs([rootUrl]);
      const result = await runSiteForgeBuild(rootUrl, {
        ...parsed.options,
        cwd: workspace,
        buildId: 'api-adapter-x-cookie-fallback-build',
        now: new Date('2026-05-26T01:04:35.000Z'),
        maxDepth: 1,
        maxPages: 4,
        maxSeeds: 4,
        fetchDelayMs: 0,
        authStateReport: browserVerifiedAuthState(rootUrl),
        apiReplayCookieHeader: `ct0=${csrfSecret}; auth_token=${cookieSecret}`,
        apiAdapterResolver: acceptingFixtureApiAdapter,
        browserBridgeApiReplayProvider: async () => ({
          status: 'failed',
          reasonCode: 'runtime_parameter_source_unsupported',
          httpStatus: null,
          contentType: null,
          responseKind: null,
        }),
        publicRenderedStructureProvider: async ({ context }) => {
          context.internalRawNetworkCapture = {
            status: 'captured',
            rawTraces: [rawXWebAuthRuntimeApiTrace(rootUrl)],
            observedRequests: [observedXWebAuthRuntimeApiRequest(rootUrl)],
            observedResponseSummaries: [],
          };
          return {
            publicRenderedPages: [{
              url: rootUrl,
              title: 'Internal Raw Network',
              visibleItemCount: 1,
              links: [{ href: new URL('/article/1', rootUrl).toString(), label: 'Article' }],
            }],
          };
        },
      });

      assert.equal(result.status, 'success');
      const replayArtifact = await readJson(path.join(result.artifactDir, 'discovery', 'api-replay-verifications', 'replay-0001.json'));
      assert.equal(replayArtifact.status, 'verified');
      assert.equal(replayArtifact.activated, true);
      assert.equal(replayArtifact.replayPolicy.buildTimeAuthBoundary, 'cookie_replay_only');
      assert.equal(JSON.stringify(replayArtifact).includes(cookieSecret), false);
      assert.equal(JSON.stringify(replayArtifact).includes(csrfSecret), false);

      const summaryArtifact = await readJson(path.join(result.artifactDir, 'network_traces.json'));
      assert.equal(summaryArtifact.sanitizedSummary.replayVerifiedCount, 1);
      assert.equal(summaryArtifact.sanitizedSummary.activatedApiAdapterCount, 1);
      assert.equal(JSON.stringify(summaryArtifact).includes(cookieSecret), false);
      assert.equal(JSON.stringify(summaryArtifact).includes(csrfSecret), false);
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('X web-auth API replay explains missing cookie CSRF during fallback', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-api-adapter-x-cookie-missing-csrf-'));
  const cookieSecret = 'synthetic-x-auth-secret';
  try {
    await withTestSite((rootUrl) => ({
      ...siteRoutes(rootUrl),
      '/robots.txt': {
        contentType: 'text/plain; charset=utf-8',
        body: testRobotsTxt(rootUrl, { disallow: '/i/api', sitemap: false }),
      },
      '/i/api/1.1/hashflags.json': {
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify({ ok: true }),
      },
    }), async (rootUrl) => {
      const parsed = parseCliArgs([rootUrl]);
      const result = await runSiteForgeBuild(rootUrl, {
        ...parsed.options,
        cwd: workspace,
        buildId: 'api-adapter-x-cookie-missing-csrf-build',
        now: new Date('2026-05-26T01:04:40.000Z'),
        maxDepth: 1,
        maxPages: 4,
        maxSeeds: 4,
        fetchDelayMs: 0,
        authStateReport: browserVerifiedAuthState(rootUrl),
        apiReplayCookieHeader: `auth_token=${cookieSecret}`,
        apiAdapterResolver: acceptingFixtureApiAdapter,
        browserBridgeApiReplayProvider: async () => ({
          status: 'failed',
          reasonCode: 'runtime_parameter_source_unsupported',
          httpStatus: null,
          contentType: null,
          responseKind: null,
        }),
        publicRenderedStructureProvider: async ({ context }) => {
          context.internalRawNetworkCapture = {
            status: 'captured',
            rawTraces: [rawXWebAuthRuntimeApiTrace(rootUrl)],
            observedRequests: [observedXWebAuthRuntimeApiRequest(rootUrl)],
            observedResponseSummaries: [],
          };
          return {
            publicRenderedPages: [{
              url: rootUrl,
              title: 'Internal Raw Network',
              visibleItemCount: 1,
              links: [{ href: new URL('/article/1', rootUrl).toString(), label: 'Article' }],
            }],
          };
        },
      });

      assert.equal(result.status, 'success');
      const replayArtifact = await readJson(path.join(result.artifactDir, 'discovery', 'api-replay-verifications', 'replay-0001.json'));
      assert.equal(replayArtifact.status, 'skipped');
      assert.equal(replayArtifact.reasonCode, 'x_csrf_unavailable');
      assert.equal(replayArtifact.activated, false);
      assert.equal(JSON.stringify(replayArtifact).includes(cookieSecret), false);
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('signed API replay can use managed browser bridge only for API replay cookies', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-api-adapter-signed-managed-cookie-'));
  const cookieSecret = 'synthetic-signed-managed-cookie';
  let managedRequest = null;
  try {
    await withTestSite(siteRoutes, async (rootUrl) => {
      const parsed = parseCliArgs([rootUrl]);
      const result = await runSiteForgeBuild(rootUrl, {
        ...parsed.options,
        cwd: workspace,
        buildId: 'api-adapter-signed-managed-cookie-build',
        now: new Date('2026-05-26T01:04:20.000Z'),
        maxDepth: 1,
        maxPages: 4,
        maxSeeds: 4,
        fetchDelayMs: 0,
        authStateReport: browserVerifiedAuthState(rootUrl),
        apiReplayCookieHeader: `sid=${cookieSecret}`,
        browserBridgeManaged: false,
        browserBridgeApiReplayManaged: true,
        browserBridgeApiReplayTimeoutMs: 1000,
        apiAdapterResolver: acceptingFixtureApiAdapter,
        browserBridgeManagedSessionProvider: async (request) => {
          managedRequest = request;
          const bridge = new URL(request.bridgeUrl);
          const sessionUrl = new URL(`/session.json${bridge.search}`, bridge.origin).toString();
          const session = await (await fetch(sessionUrl)).json();
          await fetch(session.apiReplaySubmitUrl || session.submitUrl, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              nonce: session.nonce,
              apiReplay: {
                status: 'verified',
                httpStatus: 200,
                contentType: 'application/json; charset=utf-8',
                responseKind: 'json',
                responseEvidenceStatus: 'matched',
                observedStatusCode: 0,
                observedObjectFieldPresent: true,
              },
            }),
          });
          return {
            close: async () => {},
          };
        },
        publicRenderedStructureProvider: async ({ context }) => {
          context.internalRawNetworkCapture = {
            status: 'captured',
            rawTraces: [rawSignedRuntimeApiTrace(rootUrl)],
            observedRequests: [observedSignedRuntimeApiRequest(rootUrl, context.site.id)],
            observedResponseSummaries: [],
          };
          return {
            publicRenderedPages: [{
              url: rootUrl,
              title: 'Internal Raw Network',
              visibleItemCount: 1,
              links: [{ href: new URL('/article/1', rootUrl).toString(), label: 'Article' }],
            }],
          };
        },
      });

      assert.equal(result.status, 'success');
      assert.equal(managedRequest?.cookieCount, 1);

      const replayArtifact = await readJson(path.join(result.artifactDir, 'discovery', 'api-replay-verifications', 'replay-0001.json'));
      assert.equal(replayArtifact.status, 'verified');
      assert.equal(replayArtifact.activated, true);
      assert.equal(replayArtifact.replayPolicy.buildTimeAuthBoundary, 'browser_bridge');
      assert.equal(JSON.stringify(replayArtifact).includes(cookieSecret), false);
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('dynamic API replay cookie fallback resolves malformed encoded Douyin render data', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-api-adapter-dynamic-cookie-replay-'));
  const cookieSecret = 'synthetic-dynamic-cookie-replay-secret';
  try {
    await withTestSite((rootUrl) => ({
      ...siteRoutes(rootUrl),
      '/': encodedDouyinSelfRenderPage(),
      '/api/profile': {
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify({ status_code: 0, items: [{ id: 'safe-item' }] }),
      },
    }), async (rootUrl) => {
      const parsed = parseCliArgs([rootUrl]);
      const result = await runSiteForgeBuild(rootUrl, {
        ...parsed.options,
        cwd: workspace,
        buildId: 'api-adapter-dynamic-cookie-replay-build',
        now: new Date('2026-05-26T01:04:30.000Z'),
        maxDepth: 1,
        maxPages: 4,
        maxSeeds: 4,
        fetchDelayMs: 0,
        authStateReport: browserVerifiedAuthState(rootUrl),
        apiReplayCookieHeader: `sid=${cookieSecret}`,
        apiAdapterResolver: acceptingFixtureApiAdapter,
        browserBridgeApiReplayProvider: async () => ({
          status: 'skipped',
          reasonCode: 'browser_bridge_replay_timeout',
          httpStatus: null,
          contentType: null,
          responseKind: null,
        }),
        publicRenderedStructureProvider: async ({ context }) => {
          context.internalRawNetworkCapture = {
            status: 'captured',
            rawTraces: [rawDynamicReadApiTrace(rootUrl)],
            observedRequests: [observedDynamicReadApiRequest(rootUrl, context.site.id)],
            observedResponseSummaries: [],
          };
          return {
            publicRenderedPages: [{
              url: rootUrl,
              title: 'Internal Raw Network',
              visibleItemCount: 1,
              links: [{ href: new URL('/article/1', rootUrl).toString(), label: 'Article' }],
            }],
          };
        },
      });

      assert.equal(result.status, 'success');
      const replayArtifact = await readJson(path.join(result.artifactDir, 'discovery', 'api-replay-verifications', 'replay-0001.json'));
      assert.equal(replayArtifact.status, 'verified');
      assert.equal(replayArtifact.activated, true);
      assert.equal(replayArtifact.replayPolicy.buildTimeAuthBoundary, 'cookie_replay_only');
      assert.equal(replayArtifact.replayPolicy.runtimeRegistration, 'browser_bridge_required');
      assert.equal(JSON.stringify(replayArtifact).includes(cookieSecret), false);

      const capabilities = await readJson(path.join(result.artifactDir, 'capabilities.json'));
      const apiCapability = capabilities.capabilities.find((capability) => capability.apiAdapter?.replayVerificationRef);
      assert.equal(apiCapability?.status, 'active');
      assert.equal(apiCapability?.executionPlan?.steps?.[0]?.kind, 'api_request');
      assert.equal(apiCapability?.apiAdapter?.runtimeParameterSource?.kind, 'douyin_self_user_render_data');
      assert.equal(JSON.stringify(apiCapability).includes(cookieSecret), false);
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('dynamic API replay pre-resolves cookie parameters for browser bridge replay', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-api-adapter-dynamic-bridge-preresolve-'));
  let bridgeReplayRequest = null;
  try {
    await withTestSite((rootUrl) => ({
      ...siteRoutes(rootUrl),
      '/': encodedDouyinSelfRenderPage(),
    }), async (rootUrl) => {
      const parsed = parseCliArgs([rootUrl]);
      const result = await runSiteForgeBuild(rootUrl, {
        ...parsed.options,
        cwd: workspace,
        buildId: 'api-adapter-dynamic-bridge-preresolve-build',
        now: new Date('2026-05-26T01:04:45.000Z'),
        maxDepth: 1,
        maxPages: 4,
        maxSeeds: 4,
        fetchDelayMs: 0,
        authStateReport: browserVerifiedAuthState(rootUrl),
        apiReplayCookieHeader: 'sid=synthetic-parameter-cookie',
        apiAdapterResolver: acceptingFixtureApiAdapter,
        browserBridgeApiReplayProvider: async (request) => {
          bridgeReplayRequest = request;
          return {
            status: 'verified',
            httpStatus: 200,
            contentType: 'application/json',
            responseKind: 'json',
            responseEvidenceStatus: 'matched',
            observedStatusCode: 0,
            observedArrayFieldPresent: true,
          };
        },
        publicRenderedStructureProvider: async ({ context }) => {
          context.internalRawNetworkCapture = {
            status: 'captured',
            rawTraces: [rawDynamicReadApiTrace(rootUrl)],
            observedRequests: [observedDynamicReadApiRequest(rootUrl, context.site.id)],
            observedResponseSummaries: [],
          };
          return {
            publicRenderedPages: [{
              url: rootUrl,
              title: 'Internal Raw Network',
              visibleItemCount: 1,
              links: [{ href: new URL('/article/1', rootUrl).toString(), label: 'Article' }],
            }],
          };
        },
      });

      assert.equal(result.status, 'success');
      assert.equal(bridgeReplayRequest.endpoint.includes('user_id=123456'), true);
      assert.equal(bridgeReplayRequest.endpoint.includes('{self.uid}'), false);
      assert.equal(bridgeReplayRequest.runtimeEndpoint.includes('user_id=123456'), true);
      assert.equal(bridgeReplayRequest.runtimeEndpoint.includes('{self.uid}'), false);
      assert.equal(bridgeReplayRequest.runtimeParameterSource, null);

      const replayArtifact = await readJson(path.join(result.artifactDir, 'discovery', 'api-replay-verifications', 'replay-0001.json'));
      assert.equal(replayArtifact.status, 'verified');
      assert.equal(replayArtifact.activated, true);
      assert.equal(replayArtifact.replayPolicy.buildTimeAuthBoundary, 'browser_bridge');
      assert.equal(replayArtifact.replayPolicy.runtimeParameterSource.kind, 'douyin_self_user_render_data');
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('api catalog promotion gate requires explicit schema policy and test evidence', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-api-catalog-gate-'));
  const secret = 'synthetic-internal-raw-token';
  try {
    await withTestSite(siteRoutes, async (rootUrl) => {
      const parsed = parseCliArgs([rootUrl]);
      const result = await runSiteForgeBuild(rootUrl, {
        ...parsed.options,
        cwd: workspace,
        buildId: 'api-catalog-gate-build',
        now: new Date('2026-05-26T01:05:00.000Z'),
        maxDepth: 1,
        maxPages: 4,
        maxSeeds: 4,
        fetchDelayMs: 0,
        authStateReport: browserVerifiedAuthState(rootUrl),
        apiAdapterResolver: catalogAllowingFixtureApiAdapter,
        apiCatalogPromotion: true,
        apiCatalogPromotionEvidence: {
          schemaEvidenceRef: 'schema:fixture-api-feed-v1',
          policyEvidenceRef: 'policy:fixture-api-catalog-upgrade',
          testEvidenceRefs: ['test:fixture-api-feed-read-only-replay'],
        },
        browserBridgeApiReplayProvider: async () => ({
          status: 'verified',
          httpStatus: 200,
          contentType: 'application/json',
          responseKind: 'json',
          bodyText: JSON.stringify({ token: secret, items: [{ id: 1 }] }),
        }),
        publicRenderedStructureProvider: async ({ context }) => {
          context.internalRawNetworkCapture = {
            status: 'captured',
            rawTraces: [rawReadApiTrace(rootUrl, secret)],
            observedRequests: [observedReadApiRequest(rootUrl, context.site.id, secret)],
            observedResponseSummaries: [],
          };
          return {
            publicRenderedPages: [{
              url: rootUrl,
              title: 'Internal Raw Network',
              visibleItemCount: 1,
              links: [{ href: new URL('/article/1', rootUrl).toString(), label: 'Article' }],
            }],
          };
        },
      });

      assert.equal(result.status, 'success');
      const promotionGate = await readJson(path.join(result.artifactDir, 'discovery', 'api-catalog-promotion-gates', 'gate-0001.json'));
      assert.equal(promotionGate.status, 'ready_for_catalog');
      assert.equal(promotionGate.canEnterCatalog, true);
      assert.equal(promotionGate.reasonCode, null);
      assert.equal(promotionGate.catalogWriteStatus, 'not_written');
      assert.equal(promotionGate.requirements.explicitPromotionGate, true);
      assert.equal(promotionGate.requirements.schemaEvidencePresent, true);
      assert.equal(promotionGate.requirements.policyEvidencePresent, true);
      assert.equal(promotionGate.requirements.testEvidencePresent, true);
      assert.equal(promotionGate.observedApiAutoPromotionAllowed, false);
      assert.equal(JSON.stringify(promotionGate).includes(secret), false);

      const userReport = await readJson(path.join(result.artifactDir, 'build_report.user.json'));
      assert.equal(userReport.api_discovery_summary.catalog_promotion_gate_count, 1);
      assert.equal(userReport.api_discovery_summary.catalog_promotion_ready_count, 1);
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('unsafe API candidates stay candidates and record replay skip reasons', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-api-adapter-skip-'));
  const secret = 'synthetic-internal-raw-token';
  let replayCalled = false;
  try {
    await withTestSite(siteRoutes, async (rootUrl) => {
      const parsed = parseCliArgs([rootUrl]);
      const result = await runSiteForgeBuild(rootUrl, {
        ...parsed.options,
        cwd: workspace,
        buildId: 'api-adapter-skip-build',
        now: new Date('2026-05-26T01:10:00.000Z'),
        maxDepth: 1,
        maxPages: 4,
        maxSeeds: 4,
        fetchDelayMs: 0,
        authStateReport: browserVerifiedAuthState(rootUrl),
        apiAdapterResolver: acceptingFixtureApiAdapter,
        apiAdapterReplayProvider: async () => {
          replayCalled = true;
          return { status: 'verified', httpStatus: 200 };
        },
        publicRenderedStructureProvider: async ({ context }) => {
          context.internalRawNetworkCapture = {
            status: 'captured',
            rawTraces: [rawApiTrace(rootUrl, secret)],
            observedRequests: [observedApiRequest(rootUrl, context.site.id, secret)],
            observedResponseSummaries: [],
          };
          return {
            publicRenderedPages: [{
              url: rootUrl,
              title: 'Internal Raw Network',
              visibleItemCount: 1,
              links: [{ href: new URL('/article/1', rootUrl).toString(), label: 'Article' }],
            }],
          };
        },
      });

      assert.equal(result.status, 'success');
      assert.equal(replayCalled, false);
      const summaryArtifact = await readJson(path.join(result.artifactDir, 'network_traces.json'));
      assert.equal(summaryArtifact.sanitizedSummary.apiCandidateCount, 1);
      assert.equal(summaryArtifact.sanitizedSummary.activatedApiAdapterCount, 0);
      assert.equal(summaryArtifact.sanitizedSummary.adapterSkippedReasonCounts.method_not_read_only, 1);
      const capabilities = await readJson(path.join(result.artifactDir, 'capabilities.json'));
      assert.equal(capabilities.capabilities.some((capability) => capability.name.startsWith('read API endpoint')), false);
      const captureCapability = capabilities.capabilities.find((capability) => capability.name === 'capture network APIs');
      assert.equal(captureCapability?.status, 'candidate');
      assert.equal(Object.hasOwn(captureCapability, 'executionPlan'), false);
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('bodyless POST API candidates stay candidates because method is not read-only', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-api-adapter-bodyless-post-'));
  const secret = 'synthetic-internal-raw-token';
  let replayCalled = false;
  try {
    await withTestSite(siteRoutes, async (rootUrl) => {
      const parsed = parseCliArgs([rootUrl]);
      const result = await runSiteForgeBuild(rootUrl, {
        ...parsed.options,
        cwd: workspace,
        buildId: 'api-adapter-bodyless-post-build',
        now: new Date('2026-05-26T01:12:00.000Z'),
        maxDepth: 1,
        maxPages: 4,
        maxSeeds: 4,
        fetchDelayMs: 0,
        authStateReport: browserVerifiedAuthState(rootUrl),
        apiAdapterResolver: acceptingFixtureApiAdapter,
        apiAdapterReplayProvider: async () => {
          replayCalled = true;
          return { status: 'verified', httpStatus: 200 };
        },
        publicRenderedStructureProvider: async ({ context }) => {
          context.internalRawNetworkCapture = {
            status: 'captured',
            rawTraces: [rawReadApiTrace(rootUrl, secret, { method: 'POST', requestId: 'synthetic-bodyless-post-api-request' })],
            observedRequests: [observedReadApiRequest(rootUrl, context.site.id, secret, { method: 'POST', requestId: 'synthetic-bodyless-post-api-request' })],
            observedResponseSummaries: [],
          };
          return {
            publicRenderedPages: [{
              url: rootUrl,
              title: 'Internal Raw Network',
              visibleItemCount: 1,
              links: [{ href: new URL('/article/1', rootUrl).toString(), label: 'Article' }],
            }],
          };
        },
      });

      assert.equal(result.status, 'success');
      assert.equal(replayCalled, false);
      const summaryArtifact = await readJson(path.join(result.artifactDir, 'network_traces.json'));
      assert.equal(summaryArtifact.sanitizedSummary.apiCandidateCount, 1);
      assert.equal(summaryArtifact.sanitizedSummary.activatedApiAdapterCount, 0);
      assert.equal(summaryArtifact.sanitizedSummary.adapterSkippedReasonCounts.method_not_read_only, 1);
      assert.equal(summaryArtifact.sanitizedSummary.adapterSkippedReasonCounts.request_body_present ?? 0, 0);

      const replayArtifact = await readJson(path.join(result.artifactDir, 'discovery', 'api-replay-verifications', 'replay-0001.json'));
      assert.equal(replayArtifact.status, 'skipped');
      assert.equal(replayArtifact.reasonCode, 'method_not_read_only');
      assert.equal(replayArtifact.method, 'POST');
      assert.equal(replayArtifact.activated, false);

      const capabilities = await readJson(path.join(result.artifactDir, 'capabilities.json'));
      assert.equal(capabilities.capabilities.some((capability) => capability.name.startsWith('read API endpoint')), false);
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('default raw network capture is best effort when the browser is unavailable', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-raw-network-browser-unavailable-'));
  try {
    await withTestSite(siteRoutes, async (rootUrl) => {
      const parsed = parseCliArgs([rootUrl, '--browser-path', path.join(workspace, 'missing-browser.exe')]);
      const result = await runSiteForgeBuild(rootUrl, {
        ...parsed.options,
        cwd: workspace,
        buildId: 'raw-network-browser-unavailable',
        now: new Date('2026-05-26T00:15:00.000Z'),
        maxDepth: 1,
        maxPages: 4,
        maxSeeds: 4,
        fetchDelayMs: 0,
      });

      assert.equal(result.status, 'success');
      const rawPath = path.join(result.artifactDir, 'discovery', 'network_traces.raw.json');
      assert.equal(await fileExists(rawPath), false);
      const summaryArtifact = await readJson(path.join(result.artifactDir, 'network_traces.json'));
      assert.equal(summaryArtifact.status, 'success');
      assert.equal(summaryArtifact.sanitizedSummary.apiCandidateStatus, 'empty');
      assert.equal(summaryArtifact.sanitizedSummary.rawTracesPersisted, false);
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('no-render build skips default API extraction', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-no-render-api-skip-'));
  try {
    await withTestSite(siteRoutes, async (rootUrl) => {
      const parsed = parseCliArgs([rootUrl, '--no-render-js']);
      const result = await runSiteForgeBuild(rootUrl, {
        ...parsed.options,
        cwd: workspace,
        buildId: 'no-render-api-skip',
        now: new Date('2026-05-26T00:20:00.000Z'),
        maxDepth: 1,
        maxPages: 4,
        maxSeeds: 4,
        fetchDelayMs: 0,
      });

      assert.equal(result.status, 'success');
      assert.equal(await fileExists(path.join(result.artifactDir, 'discovery', 'network_traces.raw.json')), false);
      const summaryArtifact = await readJson(path.join(result.artifactDir, 'network_traces.json'));
      assert.equal(summaryArtifact.status, 'skipped');
      assert.equal(summaryArtifact.sanitizedSummary.rawTracesPersisted, false);
      assert.equal(summaryArtifact.sanitizedSummary.apiExtractionDisabledReason, 'render-js-disabled');
      assert.match(summaryArtifact.reason, /API extraction skipped/u);
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('public network capture keeps raw traces disabled', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-public-network-summary-'));
  try {
    await withTestSite(siteRoutes, async (rootUrl) => {
      const result = await runSiteForgeBuild(rootUrl, {
        cwd: workspace,
        buildId: 'public-network-summary-build',
        now: new Date('2026-05-26T00:30:00.000Z'),
        maxDepth: 1,
        maxPages: 4,
        maxSeeds: 4,
        fetchDelayMs: 0,
        network: true,
        captureNetwork: true,
      });

      assert.equal(await fileExists(path.join(result.artifactDir, 'discovery', 'network_traces.raw.json')), false);
      const summaryArtifact = await readJson(path.join(result.artifactDir, 'network_traces.json'));
      assert.equal(summaryArtifact.status, 'skipped');
      assert.equal(summaryArtifact.sanitizedSummary.rawTracesPersisted, false);
      assert.equal(summaryArtifact.sanitizedSummary.savedSummaryOnly, true);
      assert.equal(JSON.stringify(summaryArtifact).includes('authorization'), false);
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
