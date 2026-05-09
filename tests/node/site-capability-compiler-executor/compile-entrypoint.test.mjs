import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import {
  runSiteCapabilityCompile,
} from '../../../src/entrypoints/sites/site-capability-compile.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));

test('site-capability compile entrypoint returns descriptor-only dry-run summary', async () => {
  const result = await runSiteCapabilityCompile({
    site: 'qidian',
    intent: 'open-book',
  });

  assert.equal(result.command, 'site-capability-compile');
  assert.equal(result.descriptorOnly, true);
  assert.equal(result.graphValidationResult, 'passed');
  assert.equal(result.planStatus, 'ready');
  assert.equal(result.executionAttempted, false);
  assert.equal(result.downloaderInvocationAllowed, false);
  assert.match(result.sourceDigest, /^sha256:[a-f0-9]{64}$/u);
});

test('site-capability compile CLI prints JSON without executing runtime paths', () => {
  const run = spawnSync(process.execPath, [
    'src/entrypoints/sites/site-capability-compile.mjs',
    '--site',
    'qidian',
    '--intent',
    'open-book',
    '--json',
  ], {
    cwd: root,
    encoding: 'utf8',
  });

  assert.equal(run.status, 0, run.stderr);
  const payload = JSON.parse(run.stdout);
  assert.equal(payload.graphValidationResult, 'passed');
  assert.equal(payload.liveCaptureAttempted, false);
  assert.equal(payload.siteAdapterInvocationAllowed, false);
  assert.equal(payload.sessionMaterializationAllowed, false);
});

test('site-capability compile artifact writes are redacted and audited', async () => {
  const outDir = await mkdtemp(join(tmpdir(), 'bwk-site-capability-compile-'));
  const result = await runSiteCapabilityCompile({
    site: 'qidian',
    intent: 'open-book',
    writeArtifacts: true,
    outDir,
  });
  const manifestJson = await readFile(join(outDir, 'site-compile-manifest.json'), 'utf8');
  const auditJson = await readFile(join(outDir, 'site-compile-manifest.audit.json'), 'utf8');

  assert.equal(result.artifactWrite.redactionApplied, true);
  assert.doesNotMatch(manifestJson, /SESSDATA|Authorization|browserProfilePath|userDataDir/u);
  assert.match(auditJson, /"redactions": \[\]/u);
});
