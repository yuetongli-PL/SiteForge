import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  buildAudit,
  parseArgs,
  writeAudit,
} from '../../scripts/download-release-audit.mjs';

test('download-release-audit parses explicit manifests and no-write flag', () => {
  const parsed = parseArgs([
    '--manifest',
    'runs/downloads/x/manifest.json',
    '--manifest',
    'runs/social/x/manifest.json',
    '--no-write',
  ]);

  assert.deepEqual(parsed.manifests, [
    'runs/downloads/x/manifest.json',
    'runs/social/x/manifest.json',
  ]);
  assert.equal(parsed.write, false);
});

test('download-release-audit audits download and social matrix session gates offline', async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'bwk-release-audit-'));
  t.after(() => rm(rootDir, { recursive: true, force: true }));
  const downloadDir = path.join(rootDir, 'downloads', 'x');
  const matrixDir = path.join(rootDir, 'social-live');
  const socialDir = path.join(rootDir, 'social-action');
  await mkdir(downloadDir, { recursive: true });
  await mkdir(matrixDir, { recursive: true });
  await mkdir(socialDir, { recursive: true });
  const healthManifest = path.join(rootDir, 'session', 'manifest.json');

  await writeFile(path.join(downloadDir, 'manifest.json'), `${JSON.stringify({
    runId: 'download-run',
    siteKey: 'x',
    liveValidation: { authenticated: true },
    session: {
      provider: 'unified-session-runner',
      healthManifest,
      mode: 'authenticated',
      status: 'ready',
    },
  }, null, 2)}\n`, 'utf8');
  await writeFile(path.join(matrixDir, 'manifest.json'), `${JSON.stringify({
    runId: 'matrix-run',
    results: [{
      id: 'x-full-archive',
      site: 'x',
      artifactSummary: {
        verdict: 'blocked',
        reason: 'session-health-manifest-missing',
        sessionGate: {
          ok: false,
          status: 'blocked',
          reason: 'session-health-manifest-missing',
          provider: 'unified-session-runner',
        },
      },
    }],
  }, null, 2)}\n`, 'utf8');
  await writeFile(path.join(socialDir, 'manifest.json'), `${JSON.stringify({
    runId: 'social-run',
    siteKey: 'instagram',
    authHealth: { required: true },
  }, null, 2)}\n`, 'utf8');

  const outDir = path.join(rootDir, 'audit');
  const audit = await buildAudit(parseArgs(['--runs-root', rootDir, '--out-dir', outDir]));
  const outputs = await writeAudit(parseArgs(['--runs-root', rootDir, '--out-dir', outDir]), audit);
  const markdown = await readFile(outputs.markdownPath, 'utf8');

  assert.equal(audit.summary.total, 3);
  assert.equal(audit.summary.statuses.passed, 1);
  assert.equal(audit.summary.statuses.blocked, 2);
  assert.equal(audit.rows.find((row) => row.id === 'download-run').healthManifest, healthManifest);
  assert.equal(audit.rows.find((row) => row.id === 'social-run').reason, 'session-provider-missing');
  const blockedMatrix = audit.rows.find((row) => row.id === 'x-full-archive');
  assert.equal(blockedMatrix.repairPlan.command, 'session-repair-plan');
  assert.equal(blockedMatrix.repairPlan.auditManifest, path.join(outDir, 'download-release-audit.json'));
  assert.match(blockedMatrix.repairPlan.commandText, /session-repair-plan\.mjs/u);
  assert.match(blockedMatrix.repairPlan.commandText, /--site x/u);
  assert.equal(audit.rows.find((row) => row.id === 'download-run').repairPlan, undefined);
  assert.match(markdown, /Download Release Audit/u);
  assert.match(markdown, /session-health-manifest-missing/u);
  assert.match(markdown, /Repair Plan/u);
  assert.match(markdown, /session-repair-plan\.mjs/u);
});

test('download-release-audit no-write guidance avoids unwritten audit manifest paths', async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'bwk-release-audit-no-write-'));
  t.after(() => rm(rootDir, { recursive: true, force: true }));
  const runDir = path.join(rootDir, 'social-live');
  await mkdir(runDir, { recursive: true });
  await writeFile(path.join(runDir, 'manifest.json'), `${JSON.stringify({
    runId: 'matrix-run',
    results: [{
      id: 'x-full-archive',
      site: 'x',
      artifactSummary: {
        verdict: 'blocked',
        reason: 'session-provider-missing',
        sessionGate: {
          ok: false,
          status: 'blocked',
          reason: 'session-provider-missing',
        },
      },
    }],
  }, null, 2)}\n`, 'utf8');

  const audit = await buildAudit(parseArgs(['--runs-root', rootDir, '--no-write']));
  const blocked = audit.rows.find((row) => row.id === 'x-full-archive');

  assert.equal(blocked.repairPlan.auditManifest, undefined);
  assert.match(blocked.repairPlan.commandText, /--session-gate-reason session-provider-missing/u);
  assert.doesNotMatch(blocked.repairPlan.commandText, /--audit-manifest/u);
});
