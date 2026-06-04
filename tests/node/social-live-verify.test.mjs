import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  assertLiveSmokeBoundary,
  buildMatrix,
  buildPlanJson,
  classifyAuthDoctorReport,
  classifyDoctorReport,
  classifyKbRefreshManifest,
  classifySocialActionManifest,
  evaluateLiveSmokeBoundary,
  filterMatrix,
  parseArgs,
  summarizeSocialActionArtifacts,
} from '../../scripts/social-live-verify.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'social-live-verify.mjs');

function execNode(args, options = /** @type {any} */ ({})) {
  return new Promise((resolve, reject) => {
    const child = execFile(process.execPath, [SCRIPT, ...args], {
      cwd: REPO_ROOT,
      windowsHide: true,
      ...options,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (exitCode) => {
      if (exitCode === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(`node exited ${exitCode}\n${stderr}`));
    });
  });
}

function boundedArgs(extra = /** @type {any[]} */ ([])) {
  return [
    '--live',
    '--site',
    'all',
    '--x-account',
    'openai',
    '--ig-account',
    'instagram',
    '--date',
    '2026-04-26',
    '--max-items',
    '10',
    '--max-users',
    '5',
    '--timeout',
    '120000',
    '--case-timeout',
    '600000',
    '--run-root',
    'C:\\tmp\\social-live-verify',
    ...extra,
  ];
}

function boundedRedditArgs(extra = /** @type {any[]} */ ([])) {
  return [
    '--live',
    '--site',
    'reddit',
    '--max-items',
    '10',
    '--timeout',
    '120000',
    '--case-timeout',
    '600000',
    '--run-root',
    'C:\\tmp\\social-live-verify',
    ...extra,
  ];
}

test('social-live-verify defaults to not-run until live boundaries are explicit', () => {
  const boundary = evaluateLiveSmokeBoundary(parseArgs([]));

  assert.equal(boundary.mode, 'not-run');
  assert.equal(boundary.ok, false);
  assert.deepEqual(boundary.missing, [
    'live',
    'site',
    'max-items',
    'timeout',
    'case-timeout',
    'run-root',
  ]);
});

test('social-live-verify requires explicit live, site, account, limit, timeout, and run root before planning', () => {
  assert.throws(
    () => assertLiveSmokeBoundary(parseArgs([
      '--live',
      '--site',
      'x',
      '--x-account',
      'openai',
      '--timeout',
      '120000',
      '--case-timeout',
      '600000',
      '--run-root',
      'C:\\tmp\\social-live-verify',
    ])),
    /missing --max-items/u,
  );
});

test('social-live-verify refuses execute without explicit live acknowledgement', () => {
  assert.throws(
    () => parseArgs([
      '--execute',
      '--site',
      'x',
      '--x-account',
      'openai',
      '--max-items',
      '10',
      '--timeout',
      '120000',
      '--case-timeout',
      '600000',
      '--run-root',
      'C:\\tmp\\social-live-verify',
    ]),
    /--execute requires --live/u,
  );
});

test('social-live-verify forwards case timeout into KB refresh commands', () => {
  const options = parseArgs(boundedArgs(['--case-timeout', '1234']));
  const matrix = buildMatrix(options, 'run-1');
  const xKbRefresh = matrix.find((entry) => entry.id === 'x-kb-refresh');

  assert.ok(xKbRefresh);
  assert.equal(xKbRefresh.args.includes('--plan-only'), true);
  const timeoutIndex = xKbRefresh.args.indexOf('--case-timeout');
  assert.notEqual(timeoutIndex, -1);
  assert.equal(xKbRefresh.args[timeoutIndex + 1], '1234');
});

test('social-live-verify emits machine-readable no-write plan metadata', () => {
  const options = parseArgs(boundedArgs(['--plan-json', '--approval-id', 'codex-live-ok', '--case', 'x-kb-refresh']));
  const selected = buildMatrix(options, 'run-json').filter((entry) => entry.id === 'x-kb-refresh');
  const plan = buildPlanJson(selected, options, 'run-json');

  assert.equal(plan.mode, 'dry-run');
  assert.equal(plan.noWrite, true);
  assert.equal(plan.options.approvalId, 'codex-live-ok');
  assert.equal(plan.status, 'planned');
  assert.equal(plan.commands.length, 1);
  assert.equal(plan.commands[0].id, 'x-kb-refresh');
  assert.equal(plan.commands[0].commandArray.includes('--plan-only'), true);
  assert.equal(plan.commands[0].commandArray.includes('codex-live-ok'), false);
});

test('social-live-verify --plan-json writes no run artifact', async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'bwk-social-live-plan-json-'));
  t.after(() => rm(rootDir, { recursive: true, force: true }));

  const { stdout } = await execNode(boundedArgs(['--plan-json', '--case', 'x-full-archive', '--run-root', rootDir]));
  const plan = JSON.parse(stdout);

  assert.equal(plan.noWrite, true);
  assert.deepEqual(await readdir(rootDir), []);
});

test('social-live-verify supports explicit Reddit report-only planning without social account handles', () => {
  const options = parseArgs(boundedRedditArgs());
  const boundary = assertLiveSmokeBoundary(options);
  const selected = filterMatrix(buildMatrix(options, 'run-1'), options);

  assert.deepEqual(boundary.selectedSites, ['reddit']);
  assert.deepEqual(selected.map((entry) => entry.id), [
    'reddit-session-health',
    'reddit-auth-doctor',
    'reddit-comprehensive-report',
  ]);
  assert.equal(selected.every((entry) => entry.site === 'reddit'), true);
});

test('social-live-verify only includes Reddit API read batch when explicitly scoped', () => {
  const defaultOptions = parseArgs(boundedRedditArgs());
  const scopedOptions = parseArgs(boundedRedditArgs([
    '--case',
    'reddit-api-read-batch',
    '--reddit-source',
    'runs/reddit/reddit_dev_api.html',
    '--reddit-runtime-index',
    'runs/reddit/reddit_oauth_api_runtime_plan_index.json',
  ]));
  const defaultIds = filterMatrix(buildMatrix(defaultOptions, 'run-1'), defaultOptions).map((entry) => entry.id);
  const scoped = filterMatrix(buildMatrix(scopedOptions, 'run-1'), scopedOptions);
  const batch = scoped.find((entry) => entry.id === 'reddit-api-read-batch');

  assert.equal(defaultIds.includes('reddit-api-read-batch'), false);
  assert.deepEqual(scoped.map((entry) => entry.id), ['reddit-api-read-batch']);
  assert.ok(batch);
  assert.match(batch.args.join(' '), /reddit-action\.mjs api-read-batch/u);
  assert.match(batch.args.join(' '), /--runtime-index runs\/reddit\/reddit_oauth_api_runtime_plan_index\.json/u);
  assert.match(batch.args.join(' '), /--batch-mode plan/u);
  assert.equal(batch.args.includes('api-read-batch'), true);
});

test('social-live-verify execute mode keeps Reddit API batch concrete-only', () => {
  const options = parseArgs(boundedRedditArgs([
    '--execute',
    '--case',
    'reddit-api-read-batch',
    '--reddit-source',
    'runs/reddit/reddit_dev_api.html',
    '--reddit-runtime-index',
    'runs/reddit/reddit_oauth_api_runtime_plan_index.json',
  ]));
  const scoped = filterMatrix(buildMatrix(options, 'run-1'), options);
  const batch = scoped.find((entry) => entry.id === 'reddit-api-read-batch');

  assert.ok(batch);
  assert.match(batch.args.join(' '), /--batch-mode execute-concrete/u);
  assert.equal(batch.args.includes('--execute'), true);
  assert.equal(batch.args.includes('--include-parameterized'), false);
});

test('social-live-verify keeps Reddit out of all-site planning unless explicitly selected', () => {
  const options = parseArgs(boundedArgs());
  const selected = filterMatrix(buildMatrix(options, 'run-1'), options);

  assert.equal(selected.some((entry) => entry.site === 'reddit'), false);
});

test('social-live-verify honors explicit Reddit cases under all-site planning', () => {
  const options = parseArgs(boundedArgs(['--case', 'reddit-comprehensive-report']));
  const selected = filterMatrix(buildMatrix(options, 'run-1'), options);

  assert.deepEqual(selected.map((entry) => entry.id), [
    'reddit-session-health',
    'reddit-auth-doctor',
    'reddit-comprehensive-report',
  ]);
  assert.equal(selected.every((entry) => entry.site === 'reddit'), true);
});

test('social-live-verify auto-selects Reddit session and doctor dependencies for comprehensive report', () => {
  const options = parseArgs(boundedRedditArgs([
    '--case',
    'reddit-comprehensive-report',
    '--reddit-api-batch-report',
    'runs/reddit/reddit_api_read_batch_report.json',
    '--reddit-browser-cumulative-report',
    'runs/reddit/reddit_browser_bridge_live_cumulative_report.json',
  ]));
  const selected = filterMatrix(buildMatrix(options, 'run-1'), options);
  const ids = selected.map((entry) => entry.id);
  const report = selected.find((entry) => entry.id === 'reddit-comprehensive-report');

  assert.deepEqual(ids, [
    'reddit-session-health',
    'reddit-auth-doctor',
    'reddit-comprehensive-report',
  ]);
  assert.ok(report);
  assert.match(report.args.join(' '), /reddit-action\.mjs comprehensive-report/u);
  assert.match(report.args.join(' '), /--doctor-report-dir .*reddit-auth-doctor/u);
  assert.match(report.args.join(' '), /--session-manifest .*reddit-session-health.*manifest\.json/u);
  assert.match(report.args.join(' '), /--api-batch-report runs\/reddit\/reddit_api_read_batch_report\.json/u);
  assert.match(report.args.join(' '), /--browser-cumulative-report runs\/reddit\/reddit_browser_bridge_live_cumulative_report\.json/u);
});

test('social-live-verify Reddit plan stays report-only and avoids read/write API execution', () => {
  const options = parseArgs(boundedRedditArgs(['--plan-json']));
  const selected = filterMatrix(buildMatrix(options, 'run-json'), options);
  const plan = buildPlanJson(selected, options, 'run-json');
  const commands = plan.commands.map((command) => command.commandArray.join(' ')).join('\n');

  assert.equal(plan.noWrite, true);
  assert.equal(commands.includes(' api-read '), false);
  assert.equal(commands.includes(' api-runtime-register '), false);
  assert.equal(commands.includes('siteforge build'), false);
  assert.equal(commands.includes('--download-media'), false);
  assert.equal(commands.includes('comprehensive-report'), true);
});

test('social-live-verify includes unified session health before auth doctor cases', () => {
  const options = parseArgs(boundedArgs(['--case', 'x-session-health', '--case', 'x-auth-doctor']));
  const matrix = buildMatrix(options, 'run-1');
  const sessionHealth = matrix.find((entry) => entry.id === 'x-session-health');
  const authDoctor = matrix.find((entry) => entry.id === 'x-auth-doctor');

  assert.ok(sessionHealth);
  assert.ok(authDoctor);
  assert.match(sessionHealth.args.join(' '), /session\.mjs health --site x/u);
  assert.match(sessionHealth.args.join(' '), /--run-dir .*x-session-health/u);
  assert.match(authDoctor.args.join(' '), /--session-manifest .*x-session-health.*manifest\.json/u);
});

test('social-live-verify auto-selects session health dependency for scoped auth doctor cases', () => {
  const options = parseArgs(boundedArgs(['--case', 'x-auth-doctor']));
  const selected = filterMatrix(buildMatrix(options, 'run-1'), options);
  const ids = selected.map((entry) => entry.id);
  const authDoctor = selected.find((entry) => entry.id === 'x-auth-doctor');

  assert.deepEqual(ids, ['x-session-health', 'x-auth-doctor']);
  assert.ok(authDoctor);
  assert.match(authDoctor.args.join(' '), /--session-manifest .*x-session-health.*manifest\.json/u);
});

test('social-live-verify selected default matrix includes social session health cases', () => {
  const options = parseArgs(boundedArgs());
  const ids = buildMatrix(options, 'run-1').map((entry) => entry.id);

  assert.equal(ids.includes('x-session-health'), true);
  assert.equal(ids.includes('instagram-session-health'), true);
});

test('social-live-verify adds unified session health plan to social action cases', () => {
  const options = parseArgs(boundedArgs());
  const matrix = buildMatrix(options, 'run-1');
  const actionCaseIds = [
    'x-full-archive',
    'instagram-full-archive',
    'instagram-followed-date',
    'x-media-download-blocked-boundary',
    'instagram-media-download-blocked-boundary',
  ];

  for (const id of actionCaseIds) {
    const entry = matrix.find((candidate) => candidate.id === id);
    assert.ok(entry, id);
    assert.equal(entry.args.includes('--session-health-plan'), true, id);
  }
});

test('social-live-verify media cases are local download checks, not download tuning paths', () => {
  const options = parseArgs(boundedArgs(['--case', 'x-media-download-blocked-boundary']));
  const matrix = buildMatrix(options, 'run-1');
  const mediaCase = matrix.find((entry) => entry.id === 'x-media-download-blocked-boundary');

  assert.ok(mediaCase);
  assert.equal(mediaCase.args.includes('--download-media'), true);
  assert.equal(mediaCase.args.includes('--max-media-downloads'), false);
  assert.equal(mediaCase.args.includes('--media-download-concurrency'), false);
  assert.equal(mediaCase.purpose.includes('save discovered media binaries locally'), true);
});

test('social-live-verify classifies site-doctor fail statuses as failed', () => {
  const classification = classifyDoctorReport({
    authHealth: { available: true },
    scenarios: [
      { id: 'home-search-post-detail-profile', status: 'fail', reasonCode: null },
      { id: 'profile-post-detail', status: 'pass', reasonCode: 'ok' },
    ],
  });

  assert.deepEqual(classification, {
    verdict: 'failed',
    reason: 'home-search-post-detail-profile',
  });
});

test('social-live-verify classifies auth doctor from authenticated scenarios', () => {
  const classification = classifyAuthDoctorReport({
    authHealth: { available: true },
    scenarios: [
      { id: 'home-search-post-detail-author', status: 'fail', reasonCode: null, authRequired: false },
      { id: 'home-auth', status: 'pass', reasonCode: 'ok', authRequired: true },
      { id: 'notifications', status: 'pass', reasonCode: 'ok', authRequired: true },
      { id: 'bookmarks', status: 'pass', reasonCode: 'ok', authRequired: true },
    ],
  });

  assert.deepEqual(classification, {
    verdict: 'passed',
    reason: null,
  });
});

test('social-live-verify classifies auth-only skipped scenarios as blocked', () => {
  const classification = classifyDoctorReport({
    authHealth: { available: true },
    scenarios: [
      { id: 'home-auth', status: 'skipped', reasonCode: 'not-logged-in' },
    ],
  });

  assert.deepEqual(classification, {
    verdict: 'blocked',
    reason: 'not-logged-in',
  });
});

test('social-live-verify keeps auth doctor blocked when authenticated scenarios lose login', () => {
  const classification = classifyAuthDoctorReport({
    authHealth: { available: true },
    scenarios: [
      { id: 'home-search-post-detail-author', status: 'pass', reasonCode: 'ok', authRequired: false },
      { id: 'home-auth', status: 'skipped', reasonCode: 'not-logged-in', authRequired: true },
    ],
  });

  assert.deepEqual(classification, {
    verdict: 'blocked',
    reason: 'not-logged-in',
  });
});

test('social-live-verify classifies KB refresh timeout manifest as blocked', () => {
  const classification = classifyKbRefreshManifest({
    status: 'blocked',
    results: [{
      id: 'instagram-kb-refresh',
      status: 'blocked',
      exitCode: 1,
      timeout: { timedOut: true },
      blocked: { status: true, reason: 'timeout' },
    }],
  });

  assert.equal(classification.verdict, 'blocked');
  assert.equal(classification.reason, 'timeout');
});

test('social-live-verify classifies social action rate limits as blocked', () => {
  assert.deepEqual(classifySocialActionManifest({
    runtimeRisk: {
      rateLimited: true,
      stopReason: 'request-burst',
    },
  }), { verdict: 'blocked', reason: 'rate-limited' });
});

test('social-live-verify classifies Instagram action missing login as skipped', () => {
  assert.deepEqual(classifySocialActionManifest({
    status: 'failed',
    outcome: {
      status: 'credentials-unavailable',
      ok: false,
      reason: 'not-logged-in',
    },
  }), {
    verdict: 'skipped',
    reason: 'not-logged-in',
  });
});

test('social-live-verify classifies Instagram auth recovery needs as blocked', () => {
  assert.deepEqual(classifySocialActionManifest({
    status: 'completed',
    authHealth: {
      status: 'authenticated',
      needsRecovery: true,
      recoveryReason: 'login-wall',
    },
    runtimeRisk: {
      authExpired: true,
      stopReason: 'session-invalid',
    },
  }), {
    verdict: 'blocked',
    reason: 'login-wall',
  });
});

test('social-live-verify classifies media blocked-boundary skipped by login as skipped', () => {
  assert.deepEqual(classifySocialActionManifest({
    status: 'completed',
    downloads: {
      status: 'skipped',
      reason: 'no-reusable-session',
      expectedMedia: 0,
      ok: 0,
    },
  }), {
    verdict: 'skipped',
    reason: 'no-reusable-session',
  });
});

test('social-live-verify copies social action session gate into artifact summary', async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'bwk-social-live-session-gate-'));
  t.after(() => rm(rootDir, { recursive: true, force: true }));
  const artifactRoot = path.join(rootDir, 'x-full-archive');
  const sessionManifest = path.join(rootDir, 'session', 'manifest.json');
  await mkdir(artifactRoot, { recursive: true });
  await writeFile(path.join(artifactRoot, 'manifest.json'), `${JSON.stringify({
    siteKey: 'x',
    status: 'passed',
    sessionProvider: 'unified-session-runner',
    sessionHealth: {
      healthStatus: 'ready',
      authStatus: 'authenticated',
      identityConfirmed: true,
      artifacts: { manifest: sessionManifest },
    },
    sessionGate: {
      ok: true,
      status: 'passed',
      reason: 'unified-session-health-manifest',
      provider: 'unified-session-runner',
      healthManifest: sessionManifest,
    },
  }, null, 2)}\n`, 'utf8');

  const summary = await summarizeSocialActionArtifacts({
    artifactType: 'social-action',
    artifactRoot,
  });

  assert.equal(summary.sessionProvider, 'unified-session-runner');
  assert.equal(summary.sessionHealth.status, 'ready');
  assert.equal(summary.sessionHealth.manifestPath, sessionManifest);
  assert.deepEqual(summary.sessionGate, {
    ok: true,
    status: 'passed',
    reason: 'unified-session-health-manifest',
    provider: 'unified-session-runner',
    healthManifest: sessionManifest,
  });
});
