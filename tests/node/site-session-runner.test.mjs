import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile, rm } from 'node:fs/promises';

import {
  SESSION_RUN_MANIFEST_SCHEMA_VERSION,
  normalizeSessionRunManifest,
} from '../../src/sites/sessions/contracts.mjs';
import {
  listSessionSiteDefinitions,
  resolveSessionSiteDefinition,
} from '../../src/sites/sessions/site-modules.mjs';
import {
  sessionOptionsFromRunManifest,
  summarizeSessionRunManifest,
} from '../../src/sites/sessions/manifest-bridge.mjs';
import { runSessionTask } from '../../src/sites/sessions/runner.mjs';
import {
  main,
  parseArgs,
} from '../../src/entrypoints/sites/session.mjs';
import {
  parseCliArgs as parseSiteDoctorArgs,
} from '../../src/entrypoints/sites/site-doctor.mjs';

test('session CLI parser accepts health plan flags', () => {
  const parsed = parseArgs([
    'plan-repair',
    '--site', 'douyin',
    '--purpose', 'download',
    '--session-required',
    '--risk-signal', 'session-invalid',
    '--json',
  ]);

  assert.equal(parsed.action, 'plan-repair');
  assert.equal(parsed.site, 'douyin');
  assert.equal(parsed.purpose, 'download');
  assert.equal(parsed.sessionRequired, true);
  assert.deepEqual(parsed.riskSignals, ['session-invalid']);
  assert.equal(parsed.json, true);
});

test('session manifest normalizer redacts profile paths and auth material', () => {
  const manifest = normalizeSessionRunManifest({
    plan: {
      siteKey: 'douyin',
      host: 'www.douyin.com',
      purpose: 'download',
      sessionRequirement: 'required',
      profilePath: 'C:/private/profiles/www.douyin.com.json',
      browserProfileRoot: 'C:/private/browser-root',
      userDataDir: 'C:/private/user-data',
      dryRun: true,
    },
    health: {
      status: 'manual-required',
      reason: 'session-invalid',
      cookies: [{ name: 'sid', value: 'secret-cookie' }],
      headers: { authorization: 'Bearer secret-token' },
      repairPlan: {
        action: 'site-login',
        command: 'site-login',
        reason: 'session-invalid',
        requiresApproval: true,
      },
    },
    artifacts: {
      manifest: 'C:/tmp/run/manifest.json',
      runDir: 'C:/tmp/run',
    },
  });

  assert.equal(manifest.schemaVersion, SESSION_RUN_MANIFEST_SCHEMA_VERSION);
  assert.equal(manifest.status, 'manual-required');
  assert.equal(manifest.plan.profilePathPresent, true);
  assert.equal(manifest.plan.browserProfileRootPresent, true);
  assert.equal(manifest.plan.userDataDirPresent, true);
  const serialized = JSON.stringify(manifest);
  assert.equal(serialized.includes('C:/private'), false);
  assert.equal(serialized.includes('secret-cookie'), false);
  assert.equal(serialized.includes('secret-token'), false);
});

test('session site modules expose five auth site definitions and profile auth URLs', async () => {
  const definitions = listSessionSiteDefinitions();
  assert.deepEqual(definitions.map((definition) => definition.siteKey), [
    'bilibili',
    'douyin',
    'xiaohongshu',
    'x',
    'instagram',
  ]);

  const resolved = await resolveSessionSiteDefinition({ site: 'xhs' });
  assert.equal(resolved.siteKey, 'xiaohongshu');
  assert.equal(resolved.host, 'www.xiaohongshu.com');
  assert.equal(resolved.verificationUrl, 'https://www.xiaohongshu.com/notification');
  assert.deepEqual(resolved.requiredAuthSurfaces, ['/notification']);
});

test('session runner writes a ready health manifest without executing repair providers', async (t) => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), 'bwk-session-runner-'));
  t.after(() => rm(runRoot, { recursive: true, force: true }));
  const secretProfileRoot = 'C:/secret/browser-root';
  const calls = [];

  const result = await runSessionTask({
    action: 'health',
    site: 'instagram',
    purpose: 'archive',
    outDir: runRoot,
    browserProfileRoot: secretProfileRoot,
  }, {}, {
    maybeLoadValidatedProfileForHost: async () => ({
      json: {
        authSession: {
          verificationUrl: 'https://www.instagram.com/',
          keepaliveUrl: 'https://www.instagram.com/',
          authRequiredPathPrefixes: ['/direct'],
        },
      },
    }),
    inspectSessionHealth: async (siteKey, options) => {
      calls.push({ siteKey, options });
      return {
        siteKey,
        host: options.host,
        status: 'ready',
        mode: 'reusable-profile',
        identityConfirmed: true,
      };
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].siteKey, 'instagram');
  assert.equal(calls[0].options.browserProfileRoot, secretProfileRoot);
  assert.equal(result.manifest.status, 'passed');
  assert.equal(result.manifest.plan.browserProfileRootPresent, true);
  assert.equal(result.manifest.artifacts.manifest.endsWith('manifest.json'), true);
  const persisted = JSON.parse(await readFile(result.manifest.artifacts.manifest, 'utf8'));
  assert.equal(persisted.status, 'passed');
  assert.equal(JSON.stringify(persisted).includes(secretProfileRoot), false);
});

test('session runner records repair plan for unhealthy required sessions', async (t) => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), 'bwk-session-runner-'));
  t.after(() => rm(runRoot, { recursive: true, force: true }));

  const result = await runSessionTask({
    action: 'plan-repair',
    site: 'douyin',
    purpose: 'download',
    outDir: runRoot,
    sessionRequired: true,
    status: 'manual-required',
    reason: 'session-invalid',
  });

  assert.equal(result.manifest.status, 'manual-required');
  assert.equal(result.manifest.reason, 'session-invalid');
  assert.equal(result.manifest.plan.sessionRequirement, 'required');
  assert.equal(result.manifest.repairPlan.action, 'site-login');
  assert.equal(result.manifest.repairPlan.command, 'site-login');
  assert.equal(result.manifest.repairPlan.requiresApproval, true);
});

test('session CLI prints JSON and writes manifest under runs/session layout', async (t) => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), 'bwk-session-cli-'));
  t.after(() => rm(runRoot, { recursive: true, force: true }));
  let output = '';

  const result = await main([
    'health',
    '--site', 'bilibili',
    '--purpose', 'download',
    '--out-dir', runRoot,
    '--status', 'expired',
    '--reason', 'network-identity-drift',
    '--json',
  ], {
    stdout: {
      write(chunk) {
        output += chunk;
      },
    },
  });

  const parsed = JSON.parse(output);
  assert.equal(result.manifest.status, 'expired');
  assert.equal(parsed.repairPlan.action, 'site-keepalive');
  assert.equal(path.basename(parsed.artifacts.manifest), 'manifest.json');
  assert.equal(parsed.artifacts.runDir.includes(`${path.sep}bilibili${path.sep}`), true);
  const persisted = JSON.parse(await readFile(parsed.artifacts.manifest, 'utf8'));
  assert.equal(persisted.status, 'expired');
});

test('session manifest bridge maps health into legacy session options without secrets', () => {
  const manifest = normalizeSessionRunManifest({
    plan: {
      siteKey: 'x',
      host: 'x.com',
      purpose: 'archive',
      sessionRequirement: 'required',
    },
    health: {
      status: 'manual-required',
      reason: 'session-invalid',
      riskSignals: ['session-invalid'],
    },
    repairPlan: {
      action: 'site-login',
      command: 'site-login',
      reason: 'session-invalid',
    },
    artifacts: {
      manifest: 'C:/tmp/session/manifest.json',
      runDir: 'C:/tmp/session',
    },
  });

  const summary = summarizeSessionRunManifest(manifest);
  const options = sessionOptionsFromRunManifest(manifest, { siteKey: 'x', host: 'x.com' });

  assert.equal(summary.healthStatus, 'manual-required');
  assert.equal(options.sessionStatus, 'manual-required');
  assert.equal(options.sessionReason, 'session-invalid');
  assert.deepEqual(options.riskSignals, ['session-invalid']);
  assert.equal(options.sessionHealthManifest.repairPlan.action, 'site-login');
});

test('site-doctor parser accepts unified session manifest input', () => {
  const parsed = parseSiteDoctorArgs([
    'https://x.com/home',
    '--profile-path',
    'profiles/x.com.json',
    '--session-manifest',
    'runs/session/x/manifest.json',
  ]);

  assert.equal(parsed.inputUrl, 'https://x.com/home');
  assert.equal(parsed.options.profilePath, 'profiles/x.com.json');
  assert.equal(parsed.options.sessionManifest, 'runs/session/x/manifest.json');
});
