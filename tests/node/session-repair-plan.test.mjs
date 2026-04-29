import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';

import {
  buildSessionRepairPlanResult,
  main,
  parseArgs,
} from '../../src/entrypoints/sites/session-repair-plan.mjs';

test('session repair plan parser defaults to dry-run guidance', () => {
  const parsed = parseArgs([
    '--site', 'douyin',
    '--status', 'quarantine',
    '--reason', 'network-identity-drift',
    '--risk-signal', 'run-keepalive-before-auth',
    '--json',
  ]);

  assert.equal(parsed.site, 'douyin');
  assert.equal(parsed.status, 'quarantine');
  assert.equal(parsed.reason, 'network-identity-drift');
  assert.deepEqual(parsed.riskSignals, ['run-keepalive-before-auth']);
  assert.equal(parsed.execute, false);
});

test('session repair plan parser accepts release audit guidance inputs', () => {
  const parsed = parseArgs([
    '--site', 'x',
    '--session-gate-reason', 'session-health-manifest-missing',
    '--audit-manifest', 'runs/download-release-audit/download-release-audit.json',
  ]);

  assert.equal(parsed.site, 'x');
  assert.equal(parsed.sessionGateReason, 'session-health-manifest-missing');
  assert.equal(parsed.auditManifest, 'runs/download-release-audit/download-release-audit.json');
});

test('session repair plan maps injected unhealthy health without executing ops', async () => {
  const result = await buildSessionRepairPlanResult({
    site: 'douyin',
    host: 'www.douyin.com',
    status: 'quarantine',
    reason: 'network-identity-drift',
    riskSignals: ['network-identity-drift'],
  });

  assert.equal(result.dryRun, true);
  assert.equal(result.repairPlan.action, 'site-keepalive');
  assert.equal(result.repairPlan.command, 'site-keepalive');
  assert.equal(result.repairPlan.requiresApproval, true);
});

test('session repair plan execute mode blocks without matching approval', async () => {
  const result = await buildSessionRepairPlanResult({
    site: 'douyin',
    host: 'www.douyin.com',
    execute: true,
    status: 'manual-required',
    reason: 'login-required',
  });

  assert.equal(result.dryRun, false);
  assert.equal(result.execution.status, 'blocked');
  assert.equal(result.execution.reason, 'approval-required');
  assert.equal(result.execution.command.command, 'site-login');
  assert.deepEqual(result.execution.command.argv, [
    'node',
    'src/entrypoints/sites/site-login.mjs',
    'https://www.douyin.com/',
  ]);
});

test('session repair plan maps session gate reason to dry-run guidance', async () => {
  const result = await buildSessionRepairPlanResult({
    site: 'x',
    host: 'x.com',
    sessionGateReason: 'session-health-manifest-missing',
  });

  assert.equal(result.dryRun, true);
  assert.equal(result.status, 'blocked');
  assert.equal(result.reason, 'session-health-manifest-missing');
  assert.equal(result.riskSignals.includes('session-gate-blocked'), true);
  assert.equal(result.repairPlan.action, 'inspect-session-health');
  assert.equal(result.repairPlan.command, 'site-doctor');
});

test('session repair plan maps blocked audit rows without executing ops', async (t) => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), 'bwk-session-repair-audit-'));
  t.after(() => rm(runRoot, { recursive: true, force: true }));
  const auditManifest = path.join(runRoot, 'download-release-audit.json');
  await writeFile(auditManifest, `${JSON.stringify({
    rows: [
      {
        site: 'instagram',
        id: 'ig-ok',
        status: 'passed',
        reason: 'unified-session-health-manifest',
      },
      {
        site: 'x',
        id: 'x-blocked',
        kind: 'social-live-matrix',
        status: 'blocked',
        reason: 'session-provider-missing',
        provider: null,
      },
    ],
  }, null, 2)}\n`, 'utf8');

  const result = await buildSessionRepairPlanResult({
    site: 'x',
    host: 'x.com',
    auditManifest,
  });

  assert.equal(result.status, 'blocked');
  assert.equal(result.reason, 'session-provider-missing');
  assert.equal(result.audit.rowId, 'x-blocked');
  assert.equal(result.repairPlan.action, 'inspect-session-health');
  assert.equal(result.execution.status, 'not-run');
});

test('session repair plan text output includes audit source', async (t) => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), 'bwk-session-repair-audit-render-'));
  t.after(() => rm(runRoot, { recursive: true, force: true }));
  const auditManifest = path.join(runRoot, 'download-release-audit.json');
  await writeFile(auditManifest, `${JSON.stringify({
    rows: [
      {
        site: 'x',
        id: 'x-blocked',
        kind: 'social-live-matrix',
        status: 'blocked',
        reason: 'session-provider-missing',
        provider: 'unified-session-runner',
      },
    ],
  }, null, 2)}\n`, 'utf8');

  let output = '';
  await main([
    '--site', 'x',
    '--host', 'x.com',
    '--audit-manifest', auditManifest,
  ], {
    stdout: {
      write(chunk) {
        output += chunk;
      },
    },
  });

  assert.match(output, /Audit manifest: /);
  assert.match(output, /Audit row: x-blocked/);
  assert.match(output, /Audit kind: social-live-matrix/);
  assert.match(output, /Audit provider: unified-session-runner/);
});

test('session repair plan main prints JSON and does not spawn child commands', async () => {
  let output = '';
  const result = await main([
    '--site', 'x',
    '--status', 'manual-required',
    '--reason', 'login-required',
    '--json',
  ], {
    stdout: {
      write(chunk) {
        output += chunk;
      },
    },
  });

  const parsed = JSON.parse(output);
  assert.equal(result.repairPlan.command, 'site-login');
  assert.equal(parsed.repairPlan.command, 'site-login');
  assert.equal(parsed.dryRun, true);
});

test('session repair plan entrypoint stays command-construction only', async () => {
  const source = await readFile(
    path.join(process.cwd(), 'src', 'entrypoints', 'sites', 'session-repair-plan.mjs'),
    'utf8',
  );

  assert.doesNotMatch(source, /node:child_process/u);
  assert.doesNotMatch(source, /\bspawn\s*\(/u);
  assert.doesNotMatch(source, /\bexec\s*\(/u);
  assert.doesNotMatch(source, /\bexecFile\s*\(/u);
  assert.match(source, /approved-not-run/u);
  assert.match(source, /command-construction-only/u);
});

test('session repair plan execute mode records approved command without spawning', async (t) => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), 'bwk-session-repair-plan-'));
  t.after(() => rm(runRoot, { recursive: true, force: true }));
  const outFile = path.join(runRoot, 'repair-plan.json');

  const result = await buildSessionRepairPlanResult({
    site: 'instagram',
    host: 'www.instagram.com',
    execute: true,
    approveAction: 'site-keepalive',
    status: 'quarantine',
    reason: 'network-identity-drift',
    outFile,
  });

  assert.equal(result.execution.status, 'approved-not-run');
  assert.equal(result.execution.reason, 'command-construction-only');
  assert.deepEqual(result.execution.command.argv, [
    'node',
    'src/entrypoints/sites/site-keepalive.mjs',
    'https://www.instagram.com/',
  ]);
  const persisted = JSON.parse(await readFile(outFile, 'utf8'));
  assert.equal(persisted.execution.status, 'approved-not-run');
  assert.equal(typeof persisted.createdAt, 'string');
});

test('session repair plan execute mode blocks dangerous repair actions', async () => {
  const result = await buildSessionRepairPlanResult({
    site: 'douyin',
    host: 'www.douyin.com',
    execute: true,
    approveAction: 'rebuild-profile',
    status: 'blocked',
    reason: 'profile-health-risk',
  });

  assert.equal(result.repairPlan.action, 'rebuild-profile');
  assert.equal(result.execution.status, 'blocked');
  assert.equal(result.execution.reason, 'dangerous-action-requires-human-runbook');
  assert.equal(result.execution.command, null);
});

