import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';

import {
  buildSessionRepairPlanResult,
  main,
  parseArgs,
  sessionRepairPlanCliJson,
  sessionRepairPlanRedactionAuditPath,
  writeSessionRepairPlanResult,
} from '../../src/entrypoints/sites/session-repair-plan.mjs';
import { REDACTION_PLACEHOLDER } from '../../src/domain/sessions/security-guard.mjs';
import { reasonCodeSummary } from '../../src/domain/risks/reason-codes.mjs';

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

test('session repair plan JSON stdout redacts sensitive diagnostics', async () => {
  let output = '';
  const result = await main([
    '--site', 'x',
    '--status', 'blocked',
    '--reason', 'session-provider-missing',
    '--risk-signal', 'access_token=synthetic-session-repair-stdout-access',
    '--risk-signal', 'Authorization: Bearer synthetic-session-repair-stdout-auth',
    '--json',
  ], {
    stdout: {
      write(chunk) {
        output += chunk;
      },
    },
  });

  assert.deepEqual(result.riskSignals, [
    'access_token=synthetic-session-repair-stdout-access',
    'Authorization: Bearer synthetic-session-repair-stdout-auth',
  ]);
  assert.doesNotMatch(
    output,
    /synthetic-session-repair-stdout-|access_token=|Authorization: Bearer/iu,
  );
  const parsed = JSON.parse(output);
  assert.deepEqual(parsed.riskSignals, ['[REDACTED]', 'Authorization: [REDACTED]']);
});

test('session repair plan JSON stdout fails closed without raw cause exposure', () => {
  const recovery = reasonCodeSummary('redaction-failed');
  const payload = {
    toJSON() {
      throw new Error(
        'Cookie: synthetic-session-repair-stdout-cookie csrf=synthetic-session-repair-stdout-csrf',
      );
    },
  };

  assert.throws(
    () => sessionRepairPlanCliJson(payload),
    (error) => {
      assert.equal(error.name, 'SessionRepairPlanCliSummaryRedactionFailure');
      assert.equal(error.reasonCode, 'redaction-failed');
      assert.equal(error.retryable, recovery.retryable);
      assert.equal(error.cooldownNeeded, recovery.cooldownNeeded);
      assert.equal(error.isolationNeeded, recovery.isolationNeeded);
      assert.equal(error.manualRecoveryNeeded, recovery.manualRecoveryNeeded);
      assert.equal(error.degradable, recovery.degradable);
      assert.equal(error.artifactWriteAllowed, recovery.artifactWriteAllowed);
      assert.equal(error.catalogAction, recovery.catalogAction);
      assert.equal(error.diagnosticWriteAllowed, false);
      assert.equal(Object.hasOwn(error, 'cause'), false);
      assert.deepEqual(error.causeSummary, {
        name: 'Error',
        code: null,
      });
      assert.doesNotMatch(
        `${error.message}\n${JSON.stringify(error)}`,
        /synthetic-session-repair-stdout-|Cookie:|csrf=/iu,
      );
      return true;
    },
  );
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
  assert.equal(typeof persisted.artifacts.redactionAudit, 'string');
  assert.equal(persisted.artifacts.redactionAudit, sessionRepairPlanRedactionAuditPath(outFile));
  const audit = JSON.parse(await readFile(persisted.artifacts.redactionAudit, 'utf8'));
  assert.equal(Array.isArray(audit.redactedPaths), true);
});

test('session repair plan out-file writer redacts sensitive diagnostics with audit sidecar', async (t) => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), 'bwk-session-repair-redaction-'));
  t.after(() => rm(runRoot, { recursive: true, force: true }));
  const outFile = path.join(runRoot, 'repair-plan.json');

  const result = await buildSessionRepairPlanResult({
    site: 'x',
    host: 'x.com',
    status: 'blocked',
    reason: 'session-provider-missing',
    riskSignals: [
      'access_token=synthetic-session-repair-access-token',
      'Authorization: Bearer synthetic-session-repair-authorization',
    ],
    outFile,
  });

  assert.equal(result.riskSignals.length, 2);
  const persistedText = await readFile(outFile, 'utf8');
  const auditPath = sessionRepairPlanRedactionAuditPath(outFile);
  const auditText = await readFile(auditPath, 'utf8');
  assert.doesNotMatch(
    `${persistedText}\n${auditText}`,
    /synthetic-session-repair-|access_token=|Authorization: Bearer/iu,
  );
  const persisted = JSON.parse(persistedText);
  assert.equal(persisted.artifacts.redactionAudit, auditPath);
  assert.deepEqual(persisted.riskSignals, ['[REDACTED]', 'Authorization: [REDACTED]']);
  const audit = JSON.parse(auditText);
  assert.equal(audit.redactedPaths.includes('riskSignals.0'), true);
  assert.equal(audit.redactedPaths.includes('riskSignals.1'), true);
});

test('session repair plan out-file writer redacts browser profile references with audit evidence', async (t) => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), 'bwk-session-repair-profile-redaction-'));
  t.after(() => rm(runRoot, { recursive: true, force: true }));
  const outFile = path.join(runRoot, 'repair-plan.json');
  const profilePath = path.join(runRoot, 'browser-profiles', 'x.com.json');
  const userDataDir = path.join(runRoot, 'browser-profiles', 'x.com');
  const browserProfileRoot = path.join(runRoot, 'browser-profiles');

  await buildSessionRepairPlanResult({
    site: 'x',
    host: 'x.com',
    outFile,
  }, {
    async inspectSessionHealth() {
      return {
        siteKey: 'x',
        host: 'x.com',
        status: 'blocked',
        reason: 'profile-health-risk',
        riskSignals: ['synthetic-profile-health-risk'],
        audit: {
          profilePath,
          userDataDir,
          browserProfileRoot,
        },
      };
    },
  });

  const persistedText = await readFile(outFile, 'utf8');
  const auditPath = sessionRepairPlanRedactionAuditPath(outFile);
  const auditText = await readFile(auditPath, 'utf8');
  for (const sensitivePath of [profilePath, userDataDir, browserProfileRoot]) {
    assert.equal(persistedText.includes(sensitivePath), false);
    assert.equal(auditText.includes(sensitivePath), false);
  }
  const persisted = JSON.parse(persistedText);
  assert.equal(persisted.audit.profilePath, REDACTION_PLACEHOLDER);
  assert.equal(persisted.audit.userDataDir, REDACTION_PLACEHOLDER);
  assert.equal(persisted.audit.browserProfileRoot, REDACTION_PLACEHOLDER);
  const audit = JSON.parse(auditText);
  assert.equal(audit.redactedPaths.includes('audit.profilePath'), true);
  assert.equal(audit.redactedPaths.includes('audit.userDataDir'), true);
  assert.equal(audit.redactedPaths.includes('audit.browserProfileRoot'), true);
});

test('session repair plan out-file writer fails closed before writing artifacts', async (t) => {
  const recovery = reasonCodeSummary('redaction-failed');
  const runRoot = await mkdtemp(path.join(os.tmpdir(), 'bwk-session-repair-fail-closed-'));
  t.after(() => rm(runRoot, { recursive: true, force: true }));
  const outFile = path.join(runRoot, 'repair-plan.json');
  const circular = {
    riskSignals: ['refresh_token=synthetic-session-repair-fail-closed-token'],
  };
  circular.self = circular;

  await assert.rejects(
    () => writeSessionRepairPlanResult(outFile, circular),
    (error) => {
      assert.equal(error.name, 'SessionRepairPlanRedactionFailure');
      assert.equal(error.reasonCode, 'redaction-failed');
      assert.equal(error.retryable, recovery.retryable);
      assert.equal(error.cooldownNeeded, recovery.cooldownNeeded);
      assert.equal(error.isolationNeeded, recovery.isolationNeeded);
      assert.equal(error.manualRecoveryNeeded, recovery.manualRecoveryNeeded);
      assert.equal(error.degradable, recovery.degradable);
      assert.equal(error.artifactWriteAllowed, recovery.artifactWriteAllowed);
      assert.equal(error.catalogAction, recovery.catalogAction);
      assert.equal(String(error.message).includes('synthetic-session-repair-fail-closed-token'), false);
      return true;
    },
  );
  assert.deepEqual(await readdir(runRoot), []);
});

test('session repair plan out-file writer preserves existing artifacts when redaction fails closed', async (t) => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), 'bwk-session-repair-preserve-'));
  t.after(() => rm(runRoot, { recursive: true, force: true }));
  const outFile = path.join(runRoot, 'repair-plan.json');
  const auditPath = sessionRepairPlanRedactionAuditPath(outFile);
  const sentinelFiles = [
    [outFile, '{"status":"before"}\n'],
    [auditPath, '{"audit":"before"}\n'],
  ];
  const circular = {
    riskSignals: ['Authorization: Bearer synthetic-session-repair-preserve-auth'],
  };
  circular.self = circular;

  await Promise.all(sentinelFiles.map(([filePath, content]) => writeFile(filePath, content)));

  await assert.rejects(
    () => writeSessionRepairPlanResult(outFile, circular),
    (error) => {
      assert.equal(error.name, 'SessionRepairPlanRedactionFailure');
      assert.equal(error.reasonCode, 'redaction-failed');
      assert.equal(error.artifactWriteAllowed, false);
      assert.equal(JSON.stringify(error).includes('synthetic-session-repair-preserve'), false);
      return true;
    },
  );

  for (const [filePath, content] of sentinelFiles) {
    assert.equal(await readFile(filePath, 'utf8'), content);
  }
});

test('session repair plan out-file writer does not expose raw redaction failure causes', async (t) => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), 'bwk-session-repair-safe-cause-'));
  t.after(() => rm(runRoot, { recursive: true, force: true }));
  const outFile = path.join(runRoot, 'repair-plan.json');
  const payload = {
    toJSON() {
      throw new Error(
        'Authorization: Bearer synthetic-session-repair-cause-token access_token=synthetic-session-repair-cause-access',
      );
    },
  };

  await assert.rejects(
    () => writeSessionRepairPlanResult(outFile, payload),
    (error) => {
      assert.equal(error.name, 'SessionRepairPlanRedactionFailure');
      assert.equal(error.reasonCode, 'redaction-failed');
      assert.equal(error.artifactWriteAllowed, false);
      assert.equal(Object.hasOwn(error, 'cause'), false);
      assert.deepEqual(error.causeSummary, {
        name: 'Error',
        code: null,
      });
      assert.doesNotMatch(
        `${error.message}\n${JSON.stringify(error)}`,
        /synthetic-session-repair-cause-|Authorization: Bearer|access_token=/iu,
      );
      return true;
    },
  );
  assert.deepEqual(await readdir(runRoot), []);
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
