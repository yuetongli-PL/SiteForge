import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  aggregateRefreshStatus,
  buildMatrix,
  buildRunManifest,
  executePlan,
  filterMatrix,
  parseArgs,
  schedulePolicyForOptions,
} from '../../scripts/social-kb-refresh.mjs';

function fakeEntry(rootDir, id, args) {
  const artifactRoot = path.join(rootDir, id);
  return {
    id,
    site: 'x',
    surface: 'search',
    purpose: `fake ${id}`,
    startUrl: 'https://x.com/search?q=fake',
    authRequired: false,
    expectedSemanticPageType: 'search-results-page',
    stateSignals: [],
    profilePath: path.join(rootDir, 'profile.json'),
    knowledgeBaseDir: path.join(rootDir, 'knowledge-base'),
    artifactRoot,
    expectedArtifacts: {
      artifactRoot,
      doctorReportJson: path.join(artifactRoot, '<run>', 'doctor-report.json'),
      doctorReportMarkdown: path.join(artifactRoot, '<run>', 'doctor-report.md'),
      captureManifest: path.join(artifactRoot, '<run>', 'capture', '<capture-run>', 'manifest.json'),
      expandManifest: path.join(artifactRoot, '<run>', 'expand', '<expand-run>', 'states-manifest.json'),
      scenarioArtifacts: path.join(artifactRoot, '<run>', 'scenarios', '<scenario-id>'),
    },
    command: process.execPath,
    args,
  };
}

async function withExitCodeReset(callback) {
  const previousExitCode = process.exitCode;
  try {
    return await callback();
  } finally {
    process.exitCode = previousExitCode;
  }
}

test('social-kb-refresh builds explicit X and Instagram scenario refresh cases', () => {
  const runRoot = path.join(os.tmpdir(), 'bwk-social-kb-refresh-test');
  const options = parseArgs([
    '--run-root',
    runRoot,
    '--x-account',
    '@opensource',
    '--ig-account',
    'instagram',
    '--query',
    'open source',
  ]);

  const matrix = buildMatrix(options, 'run-1');
  assert.deepEqual(matrix.map((entry) => entry.id), [
    'x-login-wall',
    'x-challenge',
    'x-search',
    'x-author-page',
    'x-following-modal',
    'x-empty-dom',
    'instagram-login-wall',
    'instagram-challenge',
    'instagram-search',
    'instagram-author-page',
    'instagram-following-modal',
    'instagram-empty-dom',
  ]);

  const xSearch = matrix.find((entry) => entry.id === 'x-search');
  assert.ok(xSearch);
  assert.equal(xSearch.surface, 'search');
  assert.match(xSearch.startUrl, /^https:\/\/x\.com\/search\?/u);
  assert.ok(xSearch.args.includes('--query'));
  assert.ok(xSearch.args.includes('--knowledge-base-dir'));
  assert.ok(xSearch.args.includes('--reuse-login-state'));
  assert.ok(xSearch.args.includes('--no-headless'));
  assert.match(xSearch.expectedArtifacts.doctorReportJson, /doctor-report\.json$/u);

  const instagramFollowing = matrix.find((entry) => entry.id === 'instagram-following-modal');
  assert.ok(instagramFollowing);
  assert.equal(instagramFollowing.authRequired, true);
  assert.equal(instagramFollowing.expectedSemanticPageType, 'author-list-page');
  assert.match(instagramFollowing.startUrl, /\/instagram\/following\/$/u);
});

test('social-kb-refresh filters by site, surface, and explicit case', () => {
  const options = parseArgs([
    '--site',
    'instagram',
    '--surface',
    'search',
    '--surface',
    'empty-dom',
  ]);
  const selected = filterMatrix(buildMatrix(options, 'run-2'), options);

  assert.deepEqual(selected.map((entry) => entry.id), [
    'instagram-search',
    'instagram-empty-dom',
  ]);

  const caseOptions = parseArgs(['--case', 'x-login-wall']);
  assert.deepEqual(
    filterMatrix(buildMatrix(caseOptions, 'run-3'), caseOptions).map((entry) => entry.id),
    ['x-login-wall'],
  );
});

test('social-kb-refresh dry-run manifest records artifact contract without execution results', () => {
  const runRoot = path.join(os.tmpdir(), 'bwk-social-kb-refresh-test');
  const options = parseArgs(['--run-root', runRoot, '--case', 'instagram-challenge', '--case-timeout', '300000', '--fail-fast']);
  const selected = filterMatrix(buildMatrix(options, 'run-4'), options);
  const manifestPath = path.join(runRoot, 'run-4', 'manifest.json');
  const manifest = buildRunManifest(selected, options, 'run-4', manifestPath);

  assert.equal(manifest.mode, 'dry-run');
  assert.equal(manifest.status, 'planned');
  assert.equal(manifest.results.length, 0);
  assert.equal(manifest.commands.length, 1);
  assert.equal(manifest.commands[0].id, 'instagram-challenge');
  assert.equal(manifest.commands[0].surface, 'challenge');
  assert.match(manifest.commands[0].expectedArtifacts.scenarioArtifacts, /scenarios/u);
  assert.equal(manifest.timeoutPolicy.caseTimeoutMs, 300000);
  assert.equal(manifest.commands[0].timeoutPolicy.outerTimeoutEnabled, true);
  assert.deepEqual(manifest.failFast, {
    enabled: true,
    triggered: false,
    stoppedAfter: null,
    skipped: [],
  });
  assert.deepEqual(manifest.options.cases, ['instagram-challenge']);
  assert.equal(manifest.options.failFast, true);
  assert.equal(manifest.options.caseTimeout, '300000');
});

test('social-kb-refresh continues after failures by default and aggregates final status', async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'bwk-social-kb-refresh-exec-'));
  t.after(() => rm(rootDir, { recursive: true, force: true }));

  await withExitCodeReset(async () => {
    const options = parseArgs(['--execute', '--run-root', rootDir, '--case-timeout', '1000']);
    const entries = [
      fakeEntry(rootDir, 'failing-case', ['-e', 'process.exit(7)']),
      fakeEntry(rootDir, 'passing-case', ['-e', 'process.exit(0)']),
    ];
    const manifestPath = path.join(rootDir, 'run-continue', 'manifest.json');
    const manifest = buildRunManifest(entries, options, 'run-continue', manifestPath);

    await executePlan(entries, manifest, manifestPath);
    const saved = JSON.parse(await readFile(manifestPath, 'utf8'));

    assert.equal(saved.status, 'failed');
    assert.equal(saved.failFast.triggered, false);
    assert.deepEqual(saved.results.map((result) => result.id), ['failing-case', 'passing-case']);
    assert.equal(saved.results[0].exitCode, 7);
    assert.equal(saved.results[0].status, 'failed');
    assert.equal(saved.results[1].status, 'passed');
  });
});

test('social-kb-refresh fail-fast stops remaining cases and records skipped ids', async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'bwk-social-kb-refresh-fast-'));
  t.after(() => rm(rootDir, { recursive: true, force: true }));

  await withExitCodeReset(async () => {
    const options = parseArgs(['--execute', '--fail-fast', '--run-root', rootDir, '--case-timeout', '1000']);
    const entries = [
      fakeEntry(rootDir, 'failing-case', ['-e', 'process.exit(3)']),
      fakeEntry(rootDir, 'skipped-case', ['-e', 'process.exit(0)']),
    ];
    const manifestPath = path.join(rootDir, 'run-fast', 'manifest.json');
    const manifest = buildRunManifest(entries, options, 'run-fast', manifestPath);

    await executePlan(entries, manifest, manifestPath);
    const saved = JSON.parse(await readFile(manifestPath, 'utf8'));

    assert.equal(saved.status, 'failed');
    assert.equal(saved.results.length, 1);
    assert.equal(saved.failFast.triggered, true);
    assert.equal(saved.failFast.stoppedAfter, 'failing-case');
    assert.deepEqual(saved.failFast.skipped, ['skipped-case']);
  });
});

test('social-kb-refresh marks outer timeouts as blocked manifest results', async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'bwk-social-kb-refresh-timeout-'));
  t.after(() => rm(rootDir, { recursive: true, force: true }));

  await withExitCodeReset(async () => {
    const options = parseArgs(['--execute', '--run-root', rootDir, '--case-timeout', '50']);
    const entries = [
      fakeEntry(rootDir, 'hanging-case', ['-e', 'setTimeout(() => {}, 10_000)']),
    ];
    const manifestPath = path.join(rootDir, 'run-timeout', 'manifest.json');
    const manifest = buildRunManifest(entries, options, 'run-timeout', manifestPath);

    await executePlan(entries, manifest, manifestPath);
    const saved = JSON.parse(await readFile(manifestPath, 'utf8'));

    assert.equal(saved.status, 'blocked');
    assert.equal(saved.results[0].status, 'blocked');
    assert.equal(saved.results[0].signal, 'timeout');
    assert.equal(saved.results[0].timeout.timedOut, true);
    assert.equal(saved.results[0].timeout.outerTimeoutMs, 50);
    assert.deepEqual(saved.results[0].blocked, {
      status: true,
      reason: 'timeout',
    });
  });
});

test('social-kb-refresh aggregate status distinguishes failed and blocked results', () => {
  assert.equal(aggregateRefreshStatus([{ status: 'passed' }]), 'passed');
  assert.equal(aggregateRefreshStatus([{ status: 'blocked', blocked: { status: true } }]), 'blocked');
  assert.equal(aggregateRefreshStatus([{ status: 'blocked' }, { status: 'failed' }]), 'failed');
});

test('social-kb-refresh records scheduled dry-run policy without executing a watch loop', () => {
  const options = parseArgs([
    '--watch',
    '--schedule-interval-minutes',
    '720',
    '--max-watch-iterations',
    '2',
    '--site',
    'x',
  ]);
  const selected = filterMatrix(buildMatrix(options, 'run-schedule'), options);
  const manifest = buildRunManifest(selected, options, 'run-schedule', path.join(os.tmpdir(), 'manifest.json'));

  assert.equal(options.execute, false);
  assert.deepEqual(schedulePolicyForOptions(options), {
    enabled: true,
    mode: 'watch',
    intervalMinutes: 720,
    dryRunOnly: true,
    maxWatchIterations: 2,
  });
  assert.equal(manifest.schedulePolicy.mode, 'watch');
  assert.equal(manifest.schedulePolicy.intervalMinutes, 720);
  assert.equal(manifest.options.watch, true);
});
