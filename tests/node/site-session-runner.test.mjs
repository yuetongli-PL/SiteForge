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
import { evaluateAuthenticatedSessionReleaseGate } from '../../src/sites/sessions/release-gate.mjs';
import { runSessionTask } from '../../src/sites/sessions/runner.mjs';
import {
  main,
  parseArgs,
} from '../../src/entrypoints/sites/session.mjs';
import {
  parseCliArgs as parseSiteDoctorArgs,
  siteDoctor,
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

test('session CLI text output includes repair command guidance', async (t) => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), 'bwk-session-cli-text-'));
  t.after(() => rm(runRoot, { recursive: true, force: true }));
  let output = '';

  await main([
    'plan-repair',
    '--site', 'douyin',
    '--purpose', 'download',
    '--out-dir', runRoot,
    '--session-required',
    '--status', 'manual-required',
    '--reason', 'session-invalid',
  ], {
    stdout: {
      write(chunk) {
        output += chunk;
      },
    },
  });

  assert.match(output, /Repair action: site-login/u);
  assert.match(output, /Repair command: site-login/u);
  assert.match(output, /Repair requires approval: true/u);
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

test('site-doctor parser accepts generated unified session health plans', () => {
  const parsed = parseSiteDoctorArgs([
    'https://x.com/home',
    '--profile-path',
    'profiles/x.com.json',
    '--session-health-plan',
  ]);

  assert.equal(parsed.options.useUnifiedSessionHealth, true);
});

test('site-doctor parser defaults to unified session health and keeps legacy opt-out', () => {
  const defaultParsed = parseSiteDoctorArgs([
    'https://x.com/home',
    '--profile-path',
    'profiles/x.com.json',
  ]);
  const legacyParsed = parseSiteDoctorArgs([
    'https://x.com/home',
    '--profile-path',
    'profiles/x.com.json',
    '--no-session-health-plan',
  ]);

  assert.equal(defaultParsed.options.useUnifiedSessionHealth, true);
  assert.equal(legacyParsed.options.useUnifiedSessionHealth, false);
});

test('site-doctor can generate unified session health before legacy probes', async (t) => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), 'bwk-site-doctor-session-'));
  t.after(() => rm(runRoot, { recursive: true, force: true }));
  let sessionHealthRequested = false;

  const report = await siteDoctor('https://x.com/home', {
    outDir: runRoot,
    profilePath: path.join(runRoot, 'x.com.json'),
    useUnifiedSessionHealth: true,
  }, {
    pathExists: async () => true,
    validateProfileFile: async (profilePath) => ({
      filePath: profilePath,
      schemaId: 'test-profile',
      warnings: [],
      profile: {
        host: 'x.com',
        archetype: 'navigation-catalog',
        validationSamples: {},
        search: { knownQueries: [] },
      },
    }),
    runSessionTask: async () => {
      sessionHealthRequested = true;
      return {
        manifest: normalizeSessionRunManifest({
          plan: {
            siteKey: 'x',
            host: 'x.com',
            purpose: 'doctor',
            sessionRequirement: 'required',
          },
          health: {
            status: 'manual-required',
            reason: 'session-invalid',
          },
          repairPlan: {
            action: 'site-login',
            command: 'site-login',
            reason: 'session-invalid',
          },
          artifacts: {
            manifest: path.join(runRoot, 'session-health', 'manifest.json'),
            runDir: path.join(runRoot, 'session-health'),
          },
        }),
      };
    },
    resolveSite: async () => ({
      host: 'x.com',
      siteContext: { siteKey: 'x' },
      adapter: { id: 'x' },
    }),
    ensureCrawlerScript: async () => ({
      status: 'skipped',
      scriptPath: null,
      metaPath: null,
    }),
    capture: async () => ({
      status: 'failed',
      error: { message: 'offline fixture capture skipped' },
      files: {},
    }),
  });

  assert.equal(sessionHealthRequested, true);
  assert.equal(report.sessionProvider, 'unified-session-runner');
  assert.equal(report.sessionHealth.healthStatus, 'manual-required');
  assert.equal(report.sessionHealth.repairPlan.action, 'site-login');
});

test('download release gate documents unified session manifest traceability', async () => {
  const releaseGate = await readFile(path.join(process.cwd(), 'docs', 'DOWNLOAD_RELEASE_GATE.md'), 'utf8');

  assert.match(releaseGate, /## Session Manifest Gate/u);
  assert.match(releaseGate, /unified-session-runner/u);
  assert.match(releaseGate, /legacy-session-provider/u);
  assert.match(releaseGate, /--session-health-plan/u);
  assert.match(releaseGate, /--session-manifest <path>/u);
  assert.match(releaseGate, /scripts\/download-release-audit\.mjs/u);
  assert.match(releaseGate, /Blocked audit rows include a `repairPlan` guidance object/u);
  assert.match(releaseGate, /Repair Plan/u);
  assert.match(releaseGate, /Next session repair command/u);
  assert.match(releaseGate, /session-repair-plan\.mjs --site/u);
  assert.match(releaseGate, /Offline only; no live\/login\/download side effects/u);
  assert.match(releaseGate, /## Current Local Evidence/u);
  assert.match(releaseGate, /clean worktree\s+verified before evidence capture/u);
  assert.match(releaseGate, /Re-check the current ahead count before\s+any publication step/u);
  assert.match(releaseGate, /node --test tests\\node\\\*\.test\.mjs`: 671 passed, 0 failed/u);
  assert.match(releaseGate, /python -m unittest discover -s tests\\python -p "test_\*\.py"`: 46 tests OK/u);
  assert.match(releaseGate, /Real download: `not-run`/u);
});

test('download runner docs describe hybrid native migration without live claims', async () => {
  const runnerDoc = await readFile(path.join(process.cwd(), 'docs', 'DOWNLOAD_RUNNER.md'), 'utf8');

  assert.match(runnerDoc, /`bilibili` \| `www\.bilibili\.com` \| Hybrid native \+ legacy fallback/u);
  assert.match(runnerDoc, /`douyin` \| `www\.douyin\.com` \| Hybrid native \+ legacy fallback/u);
  assert.match(runnerDoc, /`xiaohongshu` \| `www\.xiaohongshu\.com` \| Hybrid native \+ legacy fallback/u);
  assert.match(runnerDoc, /`x` \| `x\.com` \| Hybrid native \+ legacy fallback/u);
  assert.match(runnerDoc, /`instagram` \| `www\.instagram\.com` \| Hybrid native \+ legacy fallback/u);
  assert.match(runnerDoc, /Hybrid native status is not a live-capability claim/u);
  assert.match(runnerDoc, /live smoke, real login, and real download validation remain/u);
});

test('legacy reduction matrix preserves fallback and live-claim guardrails', async () => {
  const matrix = await readFile(path.join(process.cwd(), 'docs', 'DOWNLOAD_LEGACY_REDUCTION_MIGRATION_MATRIX.md'), 'utf8');

  assert.match(matrix, /Current policy: do not delete or bypass legacy fallback paths/u);
  assert.match(matrix, /Bilibili .* Native .*native-bilibili-page-seeds/u);
  assert.match(matrix, /Douyin .* Native .*native-douyin-resource-seeds/u);
  assert.match(matrix, /Xiaohongshu .* Native .*native-xiaohongshu-resource-seeds/u);
  assert.match(matrix, /X .* Native .*native-x-social-resource-seeds/u);
  assert.match(matrix, /Instagram .* Native .*native-instagram-social-resource-seeds/u);
  assert.match(matrix, /X .* Relation, followed-date, follower\/following, checkpoint, resume, or cursor discovery inputs\. \| Legacy/u);
  assert.match(matrix, /Instagram .* Relation, follower\/following, followed-users, checkpoint, resume, or authenticated feed discovery inputs\. \| Legacy/u);
  assert.match(matrix, /does not prove live crawling/u);
  assert.match(matrix, /authenticated social archive capability/u);
  assert.match(matrix, /safe fallback removal/u);
});

test('download runner next steps keep work on local main without new branches', async () => {
  const nextSteps = await readFile(path.join(process.cwd(), 'docs', 'DOWNLOAD_RUNNER_NEXT_STEPS.md'), 'utf8');

  assert.match(nextSteps, /continues\s+on local `main` in the current project directory/u);
  assert.match(nextSteps, /Do not create new branches or\s+extra worktrees unless the operator explicitly asks/u);
  assert.match(nextSteps, /## Local Main Workstreams/u);
  assert.match(nextSteps, /1\. Native resolvers/u);
  assert.match(nextSteps, /2\. Legacy reduction/u);
  assert.match(nextSteps, /3\. Session governance/u);
  assert.doesNotMatch(nextSteps, /## Branch Plan/u);
  assert.doesNotMatch(nextSteps, /codex\/download-native-resolvers/u);
});

test('authenticated release gate blocks missing session traceability', () => {
  assert.deepEqual(evaluateAuthenticatedSessionReleaseGate({
    plan: { sessionRequirement: 'required' },
  }), {
    ok: false,
    status: 'blocked',
    reason: 'session-provider-missing',
    requiresAuth: true,
    provider: null,
    healthManifest: null,
  });

  assert.equal(evaluateAuthenticatedSessionReleaseGate({
    plan: { sessionRequirement: 'required' },
    sessionProvider: 'unified-session-runner',
  }).reason, 'session-health-manifest-missing');
  assert.equal(evaluateAuthenticatedSessionReleaseGate({
    plan: { sessionRequirement: 'required' },
    sessionProvider: 'legacy-session-provider',
  }).ok, true);
  assert.equal(evaluateAuthenticatedSessionReleaseGate({
    plan: { sessionRequirement: 'required' },
    sessionProvider: 'unified-session-runner',
    sessionHealth: { artifacts: { manifest: 'runs/session/x/manifest.json' } },
  }).ok, true);
});
