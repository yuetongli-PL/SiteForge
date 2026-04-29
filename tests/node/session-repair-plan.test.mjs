import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile, rm } from 'node:fs/promises';

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

