import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  buildTemplates,
  parseArgs as parseTemplateArgs,
} from '../../scripts/social-command-templates.mjs';
import {
  buildHealthPlan,
  parseArgs as parseHealthArgs,
} from '../../scripts/social-health-watch.mjs';
import {
  buildManifest as buildAuthRecoverManifest,
  buildRecoveryPlan,
  parseArgs as parseAuthRecoverArgs,
} from '../../scripts/social-auth-recover.mjs';
import {
  prepareSocialManifestJsonWithAudit,
} from '../../tools/social-redaction.mjs';
import { REDACTION_PLACEHOLDER } from '../../src/domain/sessions/security-guard.mjs';
import {
  buildReport,
  parseArgs as parseReportArgs,
  writeReport,
} from '../../scripts/social-live-report.mjs';
import {
  buildResumePlan,
  parseArgs as parseResumeArgs,
} from '../../scripts/social-live-resume.mjs';
import { SOCIAL_OPERATOR_SCRIPT_STATUS } from '../../scripts/social-script-status.mjs';
import { buildRecoveryRunbook } from '../../src/sites/known-sites/social/actions/router.mjs';

test('social operator scripts are classified as internal-only maintained scripts', async () => {
  const scriptDir = path.resolve('scripts');
  const entries = await readdir(scriptDir);
  const socialScripts = entries
    .filter((entry) => /^social-[\w-]+\.mjs$/u.test(entry) && entry !== 'social-script-status.mjs')
    .map((entry) => `scripts/${entry}`)
    .sort();

  assert.deepEqual(Object.keys(SOCIAL_OPERATOR_SCRIPT_STATUS).sort(), socialScripts);
  for (const [script, status] of Object.entries(SOCIAL_OPERATOR_SCRIPT_STATUS)) {
    assert.equal(status.visibility, 'internal-operator-only', script);
    assert.match(status.status, /^(active-tested|stale|archived|removed)$/u, script);
  }
  assert.equal(SOCIAL_OPERATOR_SCRIPT_STATUS['scripts/social-live-verify.mjs'].downloadBoundary, 'blocked-report-only');
});

test('social recovery runbook does not suggest media resume when download layer is blocked', () => {
  const runbook = buildRecoveryRunbook({
    siteKey: 'x',
    plan: {
      siteKey: 'x',
      action: 'profile-content',
      account: 'openai',
      contentType: 'media',
    },
    settings: {
      downloadMedia: true,
      maxItems: 10,
      timeoutMs: 30_000,
    },
    download: {
      blocked: true,
      supported: false,
      status: 'blocked',
      reason: 'download-layer-removed',
    },
    outcome: {
      reason: 'media-download-incomplete',
    },
    completeness: {
      download: {
        failedCount: 1,
        contentTypeMismatchCount: 0,
      },
    },
  }, {
    runDir: 'runs/social-action/x-media',
    manifestPath: 'runs/social-action/x-media/manifest.json',
    apiCapturePath: 'runs/social-action/x-media/api-capture.json',
    apiDriftSamplesPath: 'runs/social-action/x-media/api-drift.json',
  });

  assert.equal(runbook.commands.some((command) => command.id === 'resume-media-downloads'), false);
  assert.equal(runbook.commands.some((command) => command.command.includes('--download-media')), false);
});

test('social-command-templates emits unified X and Instagram commands', () => {
  const templates = buildTemplates(parseTemplateArgs([
    '--x-account',
    'openai',
    '--ig-account',
    'instagram',
    '--date',
    '2026-04-26',
  ]));

  assert.deepEqual(templates.sites.map((site) => site.site), ['x', 'instagram']);
  assert.match(templates.sites[0].productionCommands[0], /src\/entrypoints\/sites\/x-action\.mjs full-archive openai/u);
  assert.match(templates.sites[0].resumeCommand, /scripts\/social-live-resume\.mjs --site x/u);
  assert.match(templates.sites[1].kbWatchCommand, /scripts\/social-kb-refresh\.mjs --execute --site instagram --watch/u);
  for (const site of templates.sites) {
    assert.ok(site.dryRunCommands.every((command) => command.risk.includes('dry-run')));
    assert.ok(site.executeCommands.every((command) => command.risk.includes('execute')));
    assert.match(site.planJsonCommand, /scripts\/social-live-verify\.mjs --plan-json/u);
    assert.match(site.kbRefreshCommand, /scripts\/social-kb-refresh\.mjs --plan-only/u);
    assert.match(site.kbPlanJsonCommand, /scripts\/social-kb-refresh\.mjs --plan-json/u);
    assert.match(site.kbExecuteCommand, /scripts\/social-kb-refresh\.mjs --execute/u);
    for (const command of site.productionCommands) {
      assert.match(command, /--session-health-plan/u);
      assert.doesNotMatch(command, /--download-media/u);
    }
    assert.doesNotMatch(site.verifyCommand, /--max-media-downloads/u);
  }
});

test('social-health-watch dry-run plan includes session health, keepalive, auth doctor, and nextSuggestedKeepalive', () => {
  const now = new Date('2026-04-26T00:00:00.000Z');
  const plan = buildHealthPlan(parseHealthArgs(['--site', 'x', '--interval-minutes', '90']), now);

  assert.equal(plan.mode, 'dry-run');
  assert.equal(plan.nextSuggestedKeepalive, '2026-04-26T01:30:00.000Z');
  assert.equal(plan.sites.length, 1);
  assert.deepEqual(plan.sites[0].commands.map((command) => command.type), ['session-health', 'keepalive', 'auth-doctor']);
  assert.match(plan.sites[0].commands[0].commandLine, /src\/entrypoints\/sites\/session\.mjs health/u);
  assert.match(plan.sites[0].commands[1].commandLine, /src\/entrypoints\/sites\/site-keepalive\.mjs/u);
  assert.match(plan.sites[0].commands[2].commandLine, /src\/entrypoints\/sites\/site-doctor\.mjs/u);
  assert.match(plan.sites[0].commands[2].commandLine, /--session-manifest/u);
});

test('social auth recovery and health watch manifests redact path-bearing commands before persistence', () => {
  const rawProfileRoot = path.join(os.tmpdir(), 'bwk social profile root');
  const rawUserDataDir = path.join(rawProfileRoot, 'x.com');
  const rawRunRoot = path.join(os.tmpdir(), 'bwk social runs');
  const now = new Date('2026-04-26T00:00:00.000Z');

  const healthPlan = buildHealthPlan(parseHealthArgs([
    '--site', 'x',
    '--run-root', rawRunRoot,
    '--browser-profile-root', rawProfileRoot,
    '--user-data-dir', rawUserDataDir,
  ]), now);
  const healthPrepared = prepareSocialManifestJsonWithAudit(healthPlan);
  assert.equal(healthPrepared.json.includes(rawProfileRoot), false);
  assert.equal(healthPrepared.json.includes(rawUserDataDir), false);
  assert.equal(healthPrepared.json.includes(path.resolve('profiles', 'x.com.json')), false);
  assert.equal(healthPrepared.auditJson.includes(rawProfileRoot), false);

  const persistedHealth = JSON.parse(healthPrepared.json);
  assert.equal(persistedHealth.runDir, REDACTION_PLACEHOLDER);
  assert.equal(persistedHealth.sites[0].commands[1].args[1], 'https://x.com/home');
  assert.equal(persistedHealth.sites[0].commands[0].commandLine, REDACTION_PLACEHOLDER);
  assert.equal(persistedHealth.sites[0].commands[0].args.includes(REDACTION_PLACEHOLDER), true);

  const recoverOptions = parseAuthRecoverArgs([
    '--site', 'x',
    '--manual',
    '--verify',
    '--run-root', rawRunRoot,
    '--browser-profile-root', rawProfileRoot,
    '--user-data-dir', rawUserDataDir,
  ]);
  const recoveryPlan = buildRecoveryPlan(recoverOptions, '20260426T000000000Z');
  const recoveryManifest = buildAuthRecoverManifest(
    recoveryPlan,
    recoverOptions,
    path.join(recoveryPlan.runDir, 'manifest.json'),
  );
  const recoveryPrepared = prepareSocialManifestJsonWithAudit(recoveryManifest);
  assert.equal(recoveryPrepared.json.includes(rawProfileRoot), false);
  assert.equal(recoveryPrepared.json.includes(rawUserDataDir), false);
  assert.equal(recoveryPrepared.json.includes(path.resolve('profiles', 'x.com.json')), false);

  const persistedRecovery = JSON.parse(recoveryPrepared.json);
  assert.equal(persistedRecovery.repoRoot, REDACTION_PLACEHOLDER);
  assert.equal(persistedRecovery.runDir, REDACTION_PLACEHOLDER);
  assert.equal(persistedRecovery.sites[0].url, 'https://x.com/home');
  assert.equal(persistedRecovery.sites[0].profilePath, REDACTION_PLACEHOLDER);
  assert.equal(persistedRecovery.sites[0].commands.manualLogin.command, REDACTION_PLACEHOLDER);
  assert.equal(persistedRecovery.sites[0].commands.manualLogin.commandArray.includes(REDACTION_PLACEHOLDER), true);
});

test('social-live-report aggregates latest X and Instagram manifests and writes JSON/Markdown', async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'bwk-social-report-'));
  t.after(() => rm(rootDir, { recursive: true, force: true }));

  const runDir = path.join(rootDir, 'run-1');
  await mkdir(runDir, { recursive: true });
  await writeFile(path.join(runDir, 'manifest.json'), `${JSON.stringify({
    runId: 'run-1',
    status: 'blocked',
    results: [
      { id: 'x-full-archive', site: 'x', status: 'failed', artifactSummary: { verdict: 'blocked', reason: 'rate-limited', manifestPath: path.join(runDir, 'x', 'manifest.json') }, finishedAt: '2026-04-26T00:00:00.000Z' },
      { id: 'instagram-full-archive', site: 'instagram', status: 'passed', artifactSummary: { verdict: 'passed', reason: 'max-items', manifestPath: path.join(runDir, 'ig', 'manifest.json') }, finishedAt: '2026-04-26T00:01:00.000Z' },
    ],
  }, null, 2)}\n`, 'utf8');

  const outDir = path.join(rootDir, 'report');
  const report = await buildReport(parseReportArgs(['--runs-root', rootDir, '--out-dir', outDir]));
  const outputs = await writeReport(parseReportArgs(['--runs-root', rootDir, '--out-dir', outDir]), report);
  const markdown = await readFile(outputs.markdownPath, 'utf8');

  assert.equal(report.totalRows, 2);
  assert.equal(report.summary.x.statuses.blocked, 1);
  assert.equal(report.summary.instagram.statuses.passed, 1);
  assert.match(markdown, /x-full-archive/u);
});

test('social-live-report classifies live smoke rows from artifact verdicts, not exit status alone', async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'bwk-social-report-artifacts-'));
  t.after(() => rm(rootDir, { recursive: true, force: true }));

  const runDir = path.join(rootDir, 'run-1');
  await mkdir(runDir, { recursive: true });
  await writeFile(path.join(runDir, 'manifest.json'), `${JSON.stringify({
    runId: 'run-1',
    status: 'failed',
    results: [
      { id: 'x-auth-doctor', site: 'x', status: 'failed', artifactSummary: { verdict: 'blocked', reason: 'rate-limited' }, finishedAt: '2026-04-26T00:00:00.000Z' },
      { id: 'x-full-archive', site: 'x', status: 'passed', artifactSummary: { verdict: 'failed', reason: 'archive-incomplete' }, finishedAt: '2026-04-26T00:01:00.000Z' },
      { id: 'instagram-full-archive', site: 'instagram', status: 'failed', artifactSummary: { verdict: 'skipped', reason: 'not-logged-in' }, finishedAt: '2026-04-26T00:02:00.000Z' },
      { id: 'instagram-media-download-blocked-boundary', site: 'instagram', status: 'passed', artifactSummary: { verdict: 'passed', reason: null }, finishedAt: '2026-04-26T00:03:00.000Z' },
      { id: 'instagram-kb-refresh', site: 'instagram', status: 'passed', artifactSummary: { verdict: 'unexpected-live-status', reason: 'drift' }, finishedAt: '2026-04-26T00:04:00.000Z' },
    ],
  }, null, 2)}\n`, 'utf8');

  const options = parseReportArgs(['--runs-root', rootDir, '--no-write']);
  const report = await buildReport(options);

  assert.deepEqual(report.rows.map((row) => [row.id, row.status]), [
    ['x-auth-doctor', 'blocked'],
    ['x-full-archive', 'failed'],
    ['instagram-full-archive', 'skipped'],
    ['instagram-media-download-blocked-boundary', 'passed'],
    ['instagram-kb-refresh', 'unknown'],
  ]);
  assert.equal(report.summary.x.statuses.blocked, 1);
  assert.equal(report.summary.x.statuses.failed, 1);
  assert.equal(report.summary.instagram.statuses.skipped, 1);
  assert.equal(report.summary.instagram.statuses.passed, 1);
  assert.equal(report.summary.instagram.statuses.unknown, 1);
});

test('social-live-report surfaces social action session gate summaries', async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'bwk-social-report-session-gate-'));
  t.after(() => rm(rootDir, { recursive: true, force: true }));

  const runDir = path.join(rootDir, 'x-action-run');
  const blockedRunDir = path.join(rootDir, 'x-blocked-action-run');
  await mkdir(runDir, { recursive: true });
  await mkdir(blockedRunDir, { recursive: true });
  await writeFile(path.join(runDir, 'manifest.json'), `${JSON.stringify({
    runId: 'x-action-run',
    siteKey: 'x',
    status: 'passed',
    reason: 'completed',
    sessionProvider: 'unified-session-runner',
    sessionGate: {
      ok: true,
      status: 'passed',
      reason: 'unified-session-health-manifest',
      provider: 'unified-session-runner',
      healthManifest: path.join(rootDir, 'session', 'manifest.json'),
    },
    generatedAt: '2026-04-26T00:00:00.000Z',
  }, null, 2)}\n`, 'utf8');
  await writeFile(path.join(blockedRunDir, 'manifest.json'), `${JSON.stringify({
    runId: 'x-blocked-action-run',
    siteKey: 'x',
    status: 'blocked',
    reason: 'session-health-manifest-missing',
    sessionProvider: 'unified-session-runner',
    sessionGate: {
      ok: false,
      status: 'blocked',
      reason: 'session-health-manifest-missing',
      provider: 'unified-session-runner',
      healthManifest: null,
    },
    generatedAt: '2026-04-26T00:01:00.000Z',
  }, null, 2)}\n`, 'utf8');

  const outDir = path.join(rootDir, 'report');
  const report = await buildReport(parseReportArgs(['--runs-root', rootDir, '--out-dir', outDir]));
  const outputs = await writeReport(parseReportArgs(['--runs-root', rootDir, '--out-dir', outDir]), report);
  const markdown = await readFile(outputs.markdownPath, 'utf8');

  assert.equal(report.totalRows, 2);
  const passedRow = report.rows.find((row) => row.id === 'x-action-run');
  const blockedRow = report.rows.find((row) => row.id === 'x-blocked-action-run');
  assert.equal(passedRow.sessionGate.status, 'passed');
  assert.equal(passedRow.sessionGate.reason, 'unified-session-health-manifest');
  assert.equal(passedRow.sessionRepairPlan, undefined);
  assert.equal(blockedRow.sessionGate.status, 'blocked');
  assert.equal(blockedRow.sessionRepairPlan.command, 'siteforge-build');
  assert.match(blockedRow.sessionRepairPlan.commandText, /siteforge build <url>/u);
  assert.equal(report.summary.x.sessionGates.passed, 1);
  assert.equal(report.summary.x.sessionGates.blocked, 1);
  assert.match(markdown, /Session Gate/u);
  assert.match(markdown, /passed \(unified-session-health-manifest\)/u);
  assert.match(markdown, /Repair Plan/u);
  assert.match(markdown, /siteforge build <url>/u);
});

test('social-live-report surfaces state-only started runs as stale when no process owns them', async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'bwk-social-report-stale-'));
  t.after(() => rm(rootDir, { recursive: true, force: true }));

  const runDir = path.join(rootDir, 'instagram-stale-run');
  await mkdir(runDir, { recursive: true });
  await writeFile(path.join(runDir, 'state.json'), `${JSON.stringify({
    status: 'started',
    startedAt: '2026-04-26T00:00:00.000Z',
    updatedAt: '2026-04-26T00:00:00.000Z',
    siteKey: 'instagram',
    plan: { siteKey: 'instagram', action: 'followed-users', account: 'me' },
    artifacts: { runDir },
  }, null, 2)}\n`, 'utf8');

  const options = parseReportArgs(['--runs-root', rootDir, '--no-write']);
  options.activeProcessCommandLines = /** @type {any[]} */ ([]);
  const report = await buildReport(options);

  assert.equal(report.totalRows, 1);
  assert.equal(report.rows[0].site, 'instagram');
  assert.equal(report.rows[0].status, 'stale');
  assert.equal(report.rows[0].reason, 'process-missing');
  assert.equal(report.summary.instagram.statuses.stale, 1);
});

test('social-live-report keeps state-only started runs active when a process owns them', async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'bwk-social-report-active-'));
  t.after(() => rm(rootDir, { recursive: true, force: true }));

  const runDir = path.join(rootDir, 'instagram-active-run');
  await mkdir(runDir, { recursive: true });
  await writeFile(path.join(runDir, 'state.json'), `${JSON.stringify({
    status: 'started',
    startedAt: '2026-04-26T00:00:00.000Z',
    updatedAt: '2026-04-26T00:00:00.000Z',
    siteKey: 'instagram',
    plan: { siteKey: 'instagram', action: 'followed-users', account: 'me' },
    artifacts: { runDir },
  }, null, 2)}\n`, 'utf8');

  const options = parseReportArgs(['--runs-root', rootDir, '--no-write']);
  options.activeProcessCommandLines = [`node src/entrypoints/sites/instagram-action.mjs followed-users me --run-dir "${runDir}"`];
  const report = await buildReport(options);

  assert.equal(report.totalRows, 1);
  assert.equal(report.rows[0].site, 'instagram');
  assert.equal(report.rows[0].status, 'running');
  assert.equal(report.rows[0].reason, 'process-active');
  assert.equal(report.summary.instagram.statuses.running, 1);
});

test('social-live-resume honors cooldown and max-attempts from manifests', async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'bwk-social-resume-'));
  t.after(() => rm(rootDir, { recursive: true, force: true }));
  const manifestPath = path.join(rootDir, 'manifest.json');
  await writeFile(manifestPath, `${JSON.stringify({
    runId: 'run-1',
    results: [{
      id: 'x-full-archive',
      site: 'x',
      status: 'passed',
      command: 'node src/entrypoints/sites/x-action.mjs full-archive openai --run-dir runs/x',
      finishedAt: '2026-04-26T00:00:00.000Z',
      artifactSummary: {
        verdict: 'passed',
        reason: 'max-items',
        archive: { complete: false, reason: 'max-items' },
      },
    }],
  }, null, 2)}\n`, 'utf8');

  const cooling = await buildResumePlan(parseResumeArgs([
    '--state',
    manifestPath,
    '--cooldown-minutes',
    '30',
    '--max-attempts',
    '3',
  ]), new Date('2026-04-26T00:10:00.000Z'));
  assert.equal(cooling.candidates[0].ready, false);
  assert.equal(cooling.candidates[0].blockedReason, 'cooldown');

  const ready = await buildResumePlan(parseResumeArgs([
    '--state',
    manifestPath,
    '--cooldown-minutes',
    '5',
    '--max-attempts',
    '3',
  ]), new Date('2026-04-26T00:10:00.000Z'));
  assert.equal(ready.candidates[0].ready, true);
  assert.match(ready.candidates[0].resumeCommand, /full-archive openai/u);
  assert.match(ready.candidates[0].resumeCommand, /--session-health-plan/u);

  const blocked = await buildResumePlan(parseResumeArgs([
    '--state',
    manifestPath,
    '--cooldown-minutes',
    '0',
    '--max-attempts',
    '1',
  ]), new Date('2026-04-26T00:10:00.000Z'));
  assert.equal(blocked.candidates[0].ready, false);
  assert.equal(blocked.candidates[0].blockedReason, 'max-attempts');
});

test('social-live-resume preserves explicit session manifest resume commands', async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'bwk-social-resume-manifest-'));
  t.after(() => rm(rootDir, { recursive: true, force: true }));
  const manifestPath = path.join(rootDir, 'manifest.json');
  await writeFile(manifestPath, `${JSON.stringify({
    runId: 'run-1',
    results: [{
      id: 'instagram-full-archive',
      site: 'instagram',
      status: 'passed',
      command: 'node src/entrypoints/sites/instagram-action.mjs full-archive instagram --run-dir runs/ig --session-manifest runs/session/instagram/manifest.json',
      finishedAt: '2026-04-26T00:00:00.000Z',
      artifactSummary: {
        verdict: 'passed',
        reason: 'max-items',
        archive: { complete: false, reason: 'max-items' },
      },
    }],
  }, null, 2)}\n`, 'utf8');

  const plan = await buildResumePlan(parseResumeArgs([
    '--state',
    manifestPath,
    '--site',
    'instagram',
    '--cooldown-minutes',
    '0',
    '--max-attempts',
    '3',
  ]), new Date('2026-04-26T00:10:00.000Z'));

  assert.match(plan.candidates[0].resumeCommand, /--session-manifest runs\/session\/instagram\/manifest\.json/u);
  assert.doesNotMatch(plan.candidates[0].resumeCommand, /--session-health-plan/u);
});
