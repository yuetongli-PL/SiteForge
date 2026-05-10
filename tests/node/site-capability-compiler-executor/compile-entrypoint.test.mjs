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
  assert.equal(result.coverageCompleteness, 'partial');
  assert.equal(result.unknownNodeCount, 0);
  assert.equal(result.capabilityCount > 0, true);
  assert.equal(result.capabilityIntake.inquiryRequired, true);
  assert.equal(result.capabilityCoverageSummary.unconfirmedCapabilityPolicy, 'best_effort_full_coverage');
  assert.equal(result.bestEffortUnconfirmedCount > 0, true);
  assert.equal(result.routeCount > 0, true);
  assert.equal(result.executionPathCount > 0, true);
  assert.match(result.sourceDigest, /^sha256:[a-f0-9]{64}$/u);
});

test('site-capability compile entrypoint accepts targeted capability intake', async () => {
  const result = await runSiteCapabilityCompile({
    site: 'qidian',
    intent: 'open-book',
    requestedCapabilities: ['open-book'],
  });

  assert.equal(result.command, 'site-capability-compile');
  assert.equal(result.graphValidationResult, 'passed');
  assert.deepEqual(result.requestedCapabilities, ['open-book']);
  assert.equal(result.capabilityIntake.intakeMode, 'user_requested');
  assert.equal(result.capabilityIntake.inquiryRequired, false);
  assert.equal(result.targetedCapabilityCount >= 1, true);
  assert.equal(result.executionAttempted, false);
  assert.equal(result.downloaderInvocationAllowed, false);
});

test('site-capability compile entrypoint blocks unrelated handoff for missing requested capability', async () => {
  const result = await runSiteCapabilityCompile({
    site: 'qidian',
    requestedCapabilities: ['missing-capability'],
  });

  assert.equal(result.command, 'site-capability-compile');
  assert.equal(result.graphValidationResult, 'passed');
  assert.deepEqual(result.requestedCapabilities, ['missing-capability']);
  assert.deepEqual(result.missingRequestedCapabilities, ['missing-capability']);
  assert.equal(result.missingRequestedCapabilityCount, 1);
  assert.equal(result.capabilityGapStatus, 'missing_requested_capability');
  assert.equal(result.targetedCapabilityCount, 0);
  assert.equal(result.capabilityGapBlocksPlannerHandoff, true);
  assert.equal(result.normalizedIntent, 'missing-capability');
  assert.equal(result.planStatus, 'blocked');
  assert.equal(result.plannerHandoffReady, false);
  assert.equal(result.executionPolicyStatus, 'blocked_by_compile_gap');
  assert.equal(result.reasonCode, 'compiler.capability_inventory_invalid');
  assert.equal(result.executionAttempted, false);
  assert.equal(result.liveCaptureAttempted, false);
  assert.equal(result.siteAdapterInvocationAllowed, false);
  assert.equal(result.downloaderInvocationAllowed, false);
  assert.equal(result.sessionMaterializationAllowed, false);
});

test('site-capability compile entrypoint blocks missing requested capability even when intent matches it', async () => {
  const result = await runSiteCapabilityCompile({
    site: 'qidian',
    intent: 'missing-capability',
    requestedCapabilities: ['missing-capability'],
  });

  assert.equal(result.graphValidationResult, 'passed');
  assert.deepEqual(result.missingRequestedCapabilities, ['missing-capability']);
  assert.equal(result.normalizedIntent, 'missing-capability');
  assert.equal(result.planStatus, 'blocked');
  assert.equal(result.plannerHandoffReady, false);
  assert.equal(result.capabilityGapBlocksPlannerHandoff, true);
  assert.equal(result.reasonCode, 'compiler.capability_inventory_invalid');
  assert.equal(Object.hasOwn(result, 'capabilityPlan'), false);
  assert.equal(Object.hasOwn(result, 'selectedRoute'), false);
  assert.equal(Object.hasOwn(result, 'plannerHandoff'), false);
  assert.equal(result.executionAttempted, false);
  assert.equal(result.downloaderInvocationAllowed, false);
});

test('site-capability compile entrypoint can return a capability intake questionnaire', async () => {
  const result = await runSiteCapabilityCompile({
    site: 'qidian',
    askCapabilities: true,
  });

  assert.equal(result.command, 'site-capability-compile');
  assert.equal(result.descriptorOnly, true);
  assert.equal(result.inquiryRequired, true);
  assert.equal(result.capabilityIntakeQuestionnaire.questionId, 'site-capability-intake');
  assert.equal(result.capabilityIntakeQuestionnaire.redactionRequired, true);
  assert.equal(result.executionAttempted, false);
  assert.equal(result.liveCaptureAttempted, false);
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

test('site-capability compile CLI accepts requested capabilities', () => {
  const run = spawnSync(process.execPath, [
    'src/entrypoints/sites/site-capability-compile.mjs',
    '--site',
    'qidian',
    '--intent',
    'open-book',
    '--capabilities',
    'open-book,search',
    '--json',
  ], {
    cwd: root,
    encoding: 'utf8',
  });

  assert.equal(run.status, 0, run.stderr);
  const payload = JSON.parse(run.stdout);
  assert.equal(payload.graphValidationResult, 'passed');
  assert.deepEqual(payload.requestedCapabilities, ['open-book', 'search']);
  assert.equal(payload.capabilityIntake.intakeMode, 'user_requested');
  assert.equal(payload.capabilityIntake.inquiryRequired, false);
  assert.equal(payload.targetedCapabilityCount >= 1, true);
  assert.equal(payload.executionAttempted, false);
  assert.equal(payload.downloaderInvocationAllowed, false);
});

test('site-capability compile CLI prints JSON capability questionnaire', () => {
  const run = spawnSync(process.execPath, [
    'src/entrypoints/sites/site-capability-compile.mjs',
    '--site',
    'qidian',
    '--ask-capabilities',
    '--json',
  ], {
    cwd: root,
    encoding: 'utf8',
  });

  assert.equal(run.status, 0, run.stderr);
  const payload = JSON.parse(run.stdout);
  assert.equal(payload.inquiryRequired, true);
  assert.equal(payload.capabilityIntakeQuestionnaire.questionId, 'site-capability-intake');
  assert.equal(payload.executionAttempted, false);
  assert.equal(payload.downloaderInvocationAllowed, false);
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
