import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
  buildReport,
  parseArgs as parseReportArgs,
  writeReport,
} from '../../scripts/social-live-report.mjs';
import {
  buildResumePlan,
  parseArgs as parseResumeArgs,
} from '../../scripts/social-live-resume.mjs';

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
  assert.match(templates.sites[0].productionCommands[0], /x-action\.mjs full-archive openai/u);
  assert.match(templates.sites[0].resumeCommand, /social-live-resume\.mjs --site x/u);
  assert.match(templates.sites[1].kbWatchCommand, /social-kb-refresh\.mjs --site instagram --watch/u);
  for (const site of templates.sites) {
    for (const command of site.productionCommands) {
      assert.match(command, /--session-health-plan/u);
    }
  }
});

test('social-health-watch dry-run plan includes session health, keepalive, auth doctor, and nextSuggestedKeepalive', () => {
  const now = new Date('2026-04-26T00:00:00.000Z');
  const plan = buildHealthPlan(parseHealthArgs(['--site', 'x', '--interval-minutes', '90']), now);

  assert.equal(plan.mode, 'dry-run');
  assert.equal(plan.nextSuggestedKeepalive, '2026-04-26T01:30:00.000Z');
  assert.equal(plan.sites.length, 1);
  assert.deepEqual(plan.sites[0].commands.map((command) => command.type), ['session-health', 'keepalive', 'auth-doctor']);
  assert.match(plan.sites[0].commands[0].commandLine, /session\.mjs health/u);
  assert.match(plan.sites[0].commands[1].commandLine, /site-keepalive\.mjs/u);
  assert.match(plan.sites[0].commands[2].commandLine, /site-doctor\.mjs/u);
  assert.match(plan.sites[0].commands[2].commandLine, /--session-manifest/u);
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
      { id: 'instagram-media-download', site: 'instagram', status: 'passed', artifactSummary: { verdict: 'passed', reason: null }, finishedAt: '2026-04-26T00:03:00.000Z' },
      { id: 'instagram-kb-refresh', site: 'instagram', status: 'passed', artifactSummary: { verdict: 'unexpected-live-status', reason: 'drift' }, finishedAt: '2026-04-26T00:04:00.000Z' },
    ],
  }, null, 2)}\n`, 'utf8');

  const options = parseReportArgs(['--runs-root', rootDir, '--no-write']);
  const report = await buildReport(options);

  assert.deepEqual(report.rows.map((row) => [row.id, row.status]), [
    ['x-auth-doctor', 'blocked'],
    ['x-full-archive', 'failed'],
    ['instagram-full-archive', 'skipped'],
    ['instagram-media-download', 'passed'],
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
  assert.equal(blockedRow.sessionRepairPlan.command, 'session-repair-plan');
  assert.match(blockedRow.sessionRepairPlan.commandText, /session-repair-plan\.mjs --site x --session-gate-reason session-health-manifest-missing/u);
  assert.equal(report.summary.x.sessionGates.passed, 1);
  assert.equal(report.summary.x.sessionGates.blocked, 1);
  assert.match(markdown, /Session Gate/u);
  assert.match(markdown, /passed \(unified-session-health-manifest\)/u);
  assert.match(markdown, /Repair Plan/u);
  assert.match(markdown, /session-repair-plan\.mjs --site x --session-gate-reason session-health-manifest-missing/u);
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
  options.activeProcessCommandLines = [];
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
