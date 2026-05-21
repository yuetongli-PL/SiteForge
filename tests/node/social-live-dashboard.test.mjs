import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  buildDashboard,
  parseArgs,
  writeDashboard,
} from '../../scripts/social-live-dashboard.mjs';

test('social-live-dashboard renders summary, drift classes, and manifest rows', async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'bwk-social-dashboard-'));
  t.after(() => rm(rootDir, { recursive: true, force: true }));

  const runDir = path.join(rootDir, 'run-1');
  await mkdir(runDir, { recursive: true });
  await writeFile(path.join(runDir, 'manifest.json'), `${JSON.stringify({
    runId: 'run-1',
    status: 'blocked',
    results: [
      {
        id: 'x-auth-doctor',
        site: 'x',
        category: 'auth recovery/site-doctor',
        status: 'failed',
        artifactSummary: {
          verdict: 'blocked',
          reason: 'rate-limited',
          manifestPath: path.join(runDir, 'x-auth-doctor', 'manifest.json'),
        },
        finishedAt: '2026-04-26T00:00:00.000Z',
      },
      {
        id: 'instagram-media-download-blocked-boundary',
        site: 'instagram',
        category: 'media download blocked boundary',
        status: 'passed',
        artifactSummary: {
          verdict: 'passed',
          reason: 'max-items',
          manifestPath: path.join(runDir, 'instagram-media-download-blocked-boundary', 'manifest.json'),
        },
        finishedAt: '2026-04-26T00:01:00.000Z',
      },
      {
        id: 'x-kb-refresh',
        site: 'x',
        category: 'scenario KB state refresh',
        status: 'failed',
        artifactSummary: {
          verdict: 'failed',
          reason: 'selector-drift',
          manifestPath: path.join(runDir, 'x-kb-refresh', 'manifest.json'),
        },
        finishedAt: '2026-04-26T00:02:00.000Z',
      },
    ],
  }, null, 2)}\n`, 'utf8');

  const options = parseArgs(['--runs-root', rootDir, '--out-dir', path.join(rootDir, 'dashboard')]);
  const dashboard = await buildDashboard(options);
  const outputs = await writeDashboard(options, dashboard.html);
  const html = await readFile(outputs.htmlPath, 'utf8');

  assert.equal(dashboard.report.totalRows, 3);
  assert.match(html, /Social Live Dashboard/u);
  assert.match(html, /Total rows/u);
  assert.match(html, /Rate-limit/u);
  assert.match(html, /Download quality/u);
  assert.match(html, /x-auth-doctor/u);
  assert.match(html, /instagram-media-download-blocked-boundary/u);
  assert.match(html, /x-kb-refresh/u);
  assert.match(html, /rate-limit/u);
  assert.match(html, /download-ok/u);
  assert.match(html, /surface-drift/u);
});
