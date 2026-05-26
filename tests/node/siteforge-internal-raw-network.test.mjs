import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile, rm } from 'node:fs/promises';

import { runSiteForgeBuild } from '../../src/app/pipeline/build/index.mjs';
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

test('internal raw network flag writes raw traces while keeping public summaries sanitized', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-internal-raw-network-'));
  const secret = 'synthetic-internal-raw-token';
  try {
    await withTestSite(siteRoutes, async (rootUrl) => {
      const result = await runSiteForgeBuild(rootUrl, {
        cwd: workspace,
        buildId: 'internal-raw-network-build',
        now: new Date('2026-05-26T00:00:00.000Z'),
        maxDepth: 1,
        maxPages: 4,
        maxSeeds: 4,
        fetchDelayMs: 0,
        internalRawNetwork: true,
        network: true,
        captureNetwork: true,
        renderJs: true,
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
      const rawArtifact = await readJson(rawPath);
      assert.equal(rawArtifact.artifactFamily, 'siteforge-internal-raw-network-traces');
      assert.equal(rawArtifact.internalOnly, true);
      assert.equal(rawArtifact.redactionApplied, false);
      assert.equal(rawArtifact.containsSensitiveMaterial, true);
      assert.equal(rawArtifact.captureScope, 'api-json-text');
      assert.equal(JSON.stringify(rawArtifact).includes(secret), true);

      const summaryArtifact = await readJson(path.join(result.artifactDir, 'network_traces.json'));
      assert.equal(summaryArtifact.status, 'success');
      assert.deepEqual(summaryArtifact.traces, []);
      assert.deepEqual(summaryArtifact.observedRequests, []);
      assert.equal(summaryArtifact.sanitizedSummary.rawTracesPersisted, true);
      assert.equal(summaryArtifact.sanitizedSummary.rawTraceCount, 1);
      assert.equal(summaryArtifact.sanitizedSummary.apiCandidateCount, 1);
      assert.equal(JSON.stringify(summaryArtifact).includes(secret), false);

      const candidatePath = path.join(workspace, summaryArtifact.apiCandidateArtifacts[0]);
      const candidateArtifact = await readJson(candidatePath);
      assert.equal(JSON.stringify(candidateArtifact).includes(secret), false);

      const userReport = await readJson(path.join(result.artifactDir, 'build_report.user.json'));
      const userReportText = JSON.stringify(userReport);
      assert.equal(userReport.privacy_summary.raw_network_traces_persisted, true);
      assert.equal(userReport.privacy_summary.network_summary_only, false);
      assert.equal(userReportText.includes(secret), false);
      assert.equal(userReportText.includes('network_traces.raw.json'), false);
      assert.equal(userReport.warnings_user_facing.some((warning) => /Internal raw network capture was enabled/u.test(warning)), true);

      const debugReport = await readJson(path.join(result.artifactDir, 'build_report.debug.json'));
      assert.equal(debugReport.collector_status.network.raw_traces_persisted, true);
      assert.equal(debugReport.collector_status.network.raw_trace_count, 1);
      assert.match(JSON.stringify(debugReport), /network_traces\.raw\.json/u);

      assert.equal(await fileExists(path.join(result.buildContext.workspace.paths.currentDir, 'network_traces.raw.json')), false);
      const registry = await readJson(result.buildContext.workspace.paths.registryPath);
      assert.equal(JSON.stringify(registry).includes('network_traces.raw.json'), false);
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
