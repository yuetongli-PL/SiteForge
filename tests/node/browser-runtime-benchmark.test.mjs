import test from 'node:test';
import assert from 'node:assert/strict';

import { BrowserSession } from '../../lib/browser-runtime/session.mjs';
import {
  AUTHENTICATED_BILIBILI_BENCHMARKS,
  DEFAULT_CAPTURE_EXPAND_BENCHMARKS,
  buildBenchmarkReport,
  renderBenchmarkMarkdown,
  summarizeSessionMetrics,
} from '../../lib/browser-runtime/benchmark-report.mjs';

test('BrowserSession metrics count protocol and helper activity without changing caller APIs', async () => {
  const sentMethods = [];
  const fakeClient = {
    async send(method, params) {
      sentMethods.push(method);
      if (method === 'Runtime.evaluate') {
        const expression = String(params.expression || '');
        if (expression.includes('__BENCH__')) {
          return { result: { value: true } };
        }
        if (expression.includes('globalThis["__BENCH__"]["method"](')) {
          return { result: { value: { helper: true } } };
        }
        return { result: { value: 'ok' } };
      }
      if (method === 'Page.navigate') {
        return {};
      }
      if (method === 'Page.captureScreenshot') {
        return { data: Buffer.from('image').toString('base64') };
      }
      if (method === 'DOMSnapshot.captureSnapshot') {
        return { documents: [] };
      }
      if (method === 'Page.getFrameTree') {
        return { frameTree: { frame: { url: 'https://example.com/' } } };
      }
      if (method === 'Target.closeTarget') {
        return {};
      }
      throw new Error(`Unexpected method: ${method}`);
    },
    on() {
      return () => undefined;
    },
    waitForEvent() {
      return Promise.resolve({});
    },
    close() {},
  };

  const session = new BrowserSession({
    client: fakeClient,
    sessionId: 'session-1',
    targetId: 'target-1',
    networkTracker: {
      dispose() {},
      async waitForIdle() {},
    },
  });

  await session.navigateAndWait('https://example.com/', {
    useLoadEvent: true,
    useNetworkIdle: false,
    documentReadyTimeoutMs: 100,
    idleMs: 0,
  });
  await session.captureHtml();
  await session.captureSnapshot();
  await session.captureScreenshot();
  await session.invokeHelperMethod('method', [], {
    namespace: '__BENCH__',
    bundleSource: '(() => { globalThis["__BENCH__"] = { __version: 1, method: () => ({ helper: true }) }; return globalThis["__BENCH__"]; })()',
    fallbackFn: () => ({ helper: false }),
  });
  await session.close();

  const metrics = session.getMetrics();
  assert.equal(metrics.counts.navigateAndWait, 1);
  assert.equal(metrics.counts.captureHtml, 1);
  assert.equal(metrics.counts.captureSnapshot, 1);
  assert.equal(metrics.counts.captureScreenshot, 1);
  assert.equal(metrics.counts.helperEnsure, 1);
  assert.equal(metrics.counts.helperInvoke, 1);
  assert.equal(metrics.protocol.byMethod['Page.navigate'], 1);
  assert.ok(sentMethods.includes('Runtime.evaluate'));
});

test('benchmark report builders keep stable JSON summary and markdown table output', () => {
  const report = buildBenchmarkReport({
    generatedAt: '2026-04-15T12:00:00.000Z',
    cwd: 'C:/repo',
    outputDir: 'C:/repo/archive/benchmarks/run-1',
    browserPath: null,
    benchmarks: [
      {
        id: 'jable',
        label: 'jable.tv',
        url: 'https://jable.tv/',
        searchQueries: ['IPX-001'],
        budget: {
          maxTriggers: 2,
          maxCapturedStates: 3,
          hit: true,
          stopReason: 'Expansion stopped after reaching maxCapturedStates=3',
        },
        capture: {
          durationMs: 1250,
          status: 'success',
          outDir: 'C:/repo/archive/benchmarks/run-1/jable/capture',
          finalUrl: 'https://jable.tv/',
          metrics: {
            counts: {
              navigateAndWait: 1,
              evaluate: 4,
              captureSnapshot: 1,
              captureScreenshot: 1,
            },
            protocol: {
              total: 10,
              byMethod: {
                'Page.navigate': 1,
                'Runtime.evaluate': 4,
              },
            },
          },
        },
        expand: {
          durationMs: 2150,
          outDir: 'C:/repo/archive/benchmarks/run-1/jable/expanded',
          capturedStates: 3,
          discoveredTriggers: 8,
          attemptedTriggers: 5,
          duplicateStates: 1,
          noopTriggers: 1,
          failedTriggers: 0,
          metrics: {
            counts: {
              navigateAndWait: 4,
              evaluate: 12,
              captureSnapshot: 3,
              captureScreenshot: 3,
              helperEnsure: 1,
              helperInvoke: 7,
            },
            protocol: {
              total: 36,
              byMethod: {
                'Page.navigate': 4,
                'Runtime.evaluate': 12,
              },
            },
            waitPolicies: [{ useLoadEvent: false, useNetworkIdle: false }],
          },
        },
      },
    ],
  });

  const captureMetrics = report.benchmarks[0].capture.metrics;
  assert.equal(captureMetrics.protocolTotal, 10);
  assert.equal(report.benchmarks[0].totals.protocolTotal, 46);
  assert.equal(report.benchmarks[0].totals.navigateAndWait, 5);
  assert.deepEqual(report.benchmarks[0].budget, {
    maxTriggers: 2,
    maxCapturedStates: 3,
    hit: true,
    stopReason: 'Expansion stopped after reaching maxCapturedStates=3',
  });
  assert.equal(report.benchmarks[0].outcome.code, 'budget-hit');
  assert.match(report.benchmarks[0].outcome.summary, /stopped by configured budget/u);
  assert.match(report.benchmarks[0].outcome.observations.join('\n'), /Only 5 of 8 discovered triggers were attempted\./u);

  const markdown = renderBenchmarkMarkdown(report);
  assert.match(markdown, /# Capture \+ Expand Benchmark/u);
  assert.match(markdown, /\| Site \| Outcome \| Capture \| Expand \| Total \|/u);
  assert.match(markdown, /\| jable\.tv \| stopped by configured budget \| 1\.25 s \| 2\.15 s \| 3\.40 s \| 5 \| 16 \| 4 \| 4 \|/u);
  assert.match(markdown, /Outcome: stopped by configured budget \(budget-hit\)/u);
  assert.match(markdown, /Budget: maxTriggers=2, maxCapturedStates=3, hit=yes, reason=Expansion stopped after reaching maxCapturedStates=3/u);
  assert.match(markdown, /Helper calls: ensure=1, invoke=7, retry=0, fallback=0/u);
  assert.match(markdown, /Observations: Budget was exhausted: Expansion stopped after reaching maxCapturedStates=3 ; Only 5 of 8 discovered triggers were attempted\./u);
});

test('default benchmark set includes bilibili scenario baselines with stable budgets', () => {
  const bilibiliEntries = DEFAULT_CAPTURE_EXPAND_BENCHMARKS.filter((entry) => entry.id.startsWith('bilibili-'));

  assert.deepEqual(bilibiliEntries.map((entry) => entry.id), [
    'bilibili-home-search-video',
    'bilibili-category-popular',
    'bilibili-bangumi',
    'bilibili-author-videos',
  ]);
  assert.ok(bilibiliEntries.every((entry) => entry.profilePath === 'profiles/www.bilibili.com.json'));
  assert.deepEqual(bilibiliEntries.map((entry) => [entry.maxTriggers, entry.maxCapturedStates]), [
    [5, 5],
    [4, 4],
    [3, 3],
    [4, 4],
  ]);
  assert.equal(bilibiliEntries[0].urlSource, 'profile-host-home');
  assert.equal(bilibiliEntries[0].searchQuerySampleField, 'videoSearchQuery');
  assert.equal(bilibiliEntries[1].urlSampleField, 'categoryPopularUrl');
  assert.equal(bilibiliEntries[2].urlSampleField, 'bangumiDetailUrl');
  assert.equal(bilibiliEntries[3].urlSampleField, 'authorVideosUrl');
  assert.deepEqual(AUTHENTICATED_BILIBILI_BENCHMARKS.map((entry) => entry.id), [
    'bilibili-author-follow-list',
    'bilibili-author-fans-list',
  ]);
  assert.ok(AUTHENTICATED_BILIBILI_BENCHMARKS.every((entry) => entry.authRequired === true));
});

test('benchmark report renders failed benchmark entries without metrics crashes', () => {
  const report = buildBenchmarkReport({
    generatedAt: '2026-04-15T12:00:00.000Z',
    cwd: 'C:/repo',
    outputDir: 'C:/repo/archive/benchmarks/run-2',
    browserPath: null,
    benchmarks: [
      {
        id: '22biqu',
        label: '22biqu.com',
        url: 'https://www.22biqu.com/',
        searchQueries: ['query'],
        maxTriggers: 2,
        maxCapturedStates: 3,
        error: 'network timeout',
        capture: { durationMs: 0, status: 'failed', outDir: null, finalUrl: null, metrics: null },
        expand: { durationMs: 0, outDir: null, capturedStates: 0, discoveredTriggers: 0, attemptedTriggers: 0, duplicateStates: 0, noopTriggers: 0, failedTriggers: 0, metrics: null },
      },
    ],
  });

  assert.equal(report.benchmarks[0].budget.hit, false);
  assert.equal(report.benchmarks[0].capture.metrics.protocolTotal, 0);
  assert.equal(report.benchmarks[0].outcome.code, 'error');
  const markdown = renderBenchmarkMarkdown(report);
  assert.match(markdown, /Error: network timeout/u);
  assert.match(markdown, /Outcome: benchmark failed \(error\)/u);
  assert.match(markdown, /Budget: maxTriggers=2, maxCapturedStates=3, hit=no/u);
});

test('benchmark report classifies no-trigger-progress scenarios clearly', () => {
  const report = buildBenchmarkReport({
    generatedAt: '2026-04-15T12:00:00.000Z',
    cwd: 'C:/repo',
    outputDir: 'C:/repo/archive/benchmarks/run-3',
    browserPath: null,
    benchmarks: [
      {
        id: 'bilibili-author-videos',
        label: 'bilibili.com author videos',
        url: 'https://space.bilibili.com/1202350411/video',
        searchQueries: [],
        maxTriggers: 4,
        maxCapturedStates: 4,
        capture: {
          durationMs: 4805,
          status: 'success',
          outDir: 'C:/repo/archive/benchmarks/run-3/author/capture',
          finalUrl: 'https://space.bilibili.com/1202350411/video',
          metrics: null,
        },
        expand: {
          durationMs: 8490,
          outDir: 'C:/repo/archive/benchmarks/run-3/author/expand',
          capturedStates: 0,
          discoveredTriggers: 2,
          attemptedTriggers: 0,
          duplicateStates: 0,
          noopTriggers: 0,
          failedTriggers: 0,
          metrics: null,
        },
      },
    ],
  });

  assert.equal(report.benchmarks[0].outcome.code, 'no-trigger-progress');
  assert.match(report.benchmarks[0].outcome.observations.join('\n'), /Expand did not advance beyond the starting page\./u);
  const markdown = renderBenchmarkMarkdown(report);
  assert.match(markdown, /Outcome: no trigger progress \(no-trigger-progress\)/u);
  assert.match(markdown, /Observations: Only 0 of 2 discovered triggers were attempted\. ; Expand did not advance beyond the starting page\./u);
});

test('benchmark report renders skipped authenticated entries clearly', () => {
  const report = buildBenchmarkReport({
    generatedAt: '2026-04-15T12:00:00.000Z',
    cwd: 'C:/repo',
    outputDir: 'C:/repo/archive/benchmarks/run-4',
    browserPath: null,
    benchmarks: [
      {
        id: 'bilibili-author-follow-list',
        label: 'bilibili.com author follow list',
        url: 'https://space.bilibili.com/1202350411/fans/follow',
        searchQueries: [],
        authRequired: true,
        authAvailable: false,
        skippedReason: 'Reusable logged-in bilibili session is unavailable for this benchmark.',
        maxTriggers: 3,
        maxCapturedStates: 3,
        capture: { durationMs: 0, status: 'skipped', outDir: null, finalUrl: null, metrics: null },
        expand: { durationMs: 0, outDir: null, capturedStates: 0, discoveredTriggers: 0, attemptedTriggers: 0, duplicateStates: 0, noopTriggers: 0, failedTriggers: 0, metrics: null },
      },
    ],
  });

  assert.equal(report.benchmarks[0].outcome.code, 'skipped');
  assert.equal(report.benchmarks[0].authRequired, true);
  assert.equal(report.benchmarks[0].authAvailable, false);
  const markdown = renderBenchmarkMarkdown(report);
  assert.match(markdown, /Auth: required, available=no/u);
  assert.match(markdown, /Outcome: skipped \(skipped\)/u);
  assert.match(markdown, /Reusable logged-in bilibili session is unavailable/u);
});
