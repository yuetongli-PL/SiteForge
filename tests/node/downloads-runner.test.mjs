import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { readJsonFile, writeJsonFile } from '../../src/infra/io.mjs';
import { main as runDownloadCli, parseArgs } from '../../src/entrypoints/sites/download.mjs';
import {
  DOWNLOAD_RUN_MANIFEST_SCHEMA_VERSION,
  normalizeDownloadRunManifest,
  normalizeDownloadTaskPlan,
} from '../../src/sites/downloads/contracts.mjs';
import { executeResolvedDownloadTask } from '../../src/sites/downloads/executor.mjs';
import { executeLegacyDownloadTask } from '../../src/sites/downloads/legacy-executor.mjs';
import { listDownloadSiteDefinitions } from '../../src/sites/downloads/registry.mjs';
import { runDownloadTask } from '../../src/sites/downloads/runner.mjs';
import { normalizeSessionRunManifest } from '../../src/sites/sessions/contracts.mjs';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIR, '..', '..');

const NATIVE_22BIQU_CHAPTERS = [
  { chapterIndex: 1, href: '1.html', title: 'Chapter One' },
  { chapterIndex: 2, href: '2.html', title: 'Chapter Two' },
];

function native22BiquRequest(overrides = {}) {
  return {
    site: '22biqu',
    input: 'https://www.22biqu.com/biqu123/',
    chapters: NATIVE_22BIQU_CHAPTERS,
    retries: 0,
    retryBackoffMs: 0,
    ...overrides,
  };
}

function native22BiquSessionLease(purpose = 'download:book') {
  return {
    siteKey: '22biqu',
    host: 'www.22biqu.com',
    mode: 'anonymous',
    status: 'ready',
    riskSignals: [],
    purpose,
  };
}

async function readJsonLinesFile(filePath) {
  const text = await readFile(filePath, 'utf8');
  return text.trim()
    ? text.trimEnd().split(/\r?\n/u).map((line) => JSON.parse(line))
    : [];
}

async function assertDownloadRunArtifactBundle(manifest) {
  const runDir = path.dirname(manifest.artifacts.manifest);
  const paths = {
    manifest: manifest.artifacts.manifest,
    queue: manifest.artifacts.queue,
    downloadsJsonl: manifest.artifacts.downloadsJsonl,
    reportMarkdown: manifest.artifacts.reportMarkdown,
    plan: manifest.artifacts.plan ?? path.join(runDir, 'plan.json'),
    resolvedTask: manifest.artifacts.resolvedTask ?? path.join(runDir, 'resolved-task.json'),
  };

  for (const [name, filePath] of Object.entries(paths)) {
    assert.equal(Boolean(filePath), true, `${name} artifact path is present`);
    await readFile(filePath, 'utf8');
  }

  return {
    paths,
    persistedManifest: await readJsonFile(paths.manifest),
    plan: await readJsonFile(paths.plan),
    resolvedTask: await readJsonFile(paths.resolvedTask),
    queue: await readJsonFile(paths.queue),
    downloads: await readJsonLinesFile(paths.downloadsJsonl),
    report: await readFile(paths.reportMarkdown, 'utf8'),
  };
}

test('download run manifest schema shape is stable', () => {
  const manifest = normalizeDownloadRunManifest({
    runId: 'run-1',
    planId: 'plan-1',
    siteKey: 'example',
    status: 'success',
    reason: 'success',
    counts: {
      expected: 1,
      attempted: 1,
      downloaded: 1,
      skipped: 0,
      failed: 0,
    },
    files: [{
      resourceId: 'resource-1',
      filePath: 'C:/tmp/run/files/0001-file.txt',
    }],
    failedResources: [],
    artifacts: {
      manifest: 'C:/tmp/run/manifest.json',
      queue: 'C:/tmp/run/queue.json',
      downloadsJsonl: 'C:/tmp/run/downloads.jsonl',
      reportMarkdown: 'C:/tmp/run/report.md',
      plan: 'C:/tmp/run/plan.json',
      resolvedTask: 'C:/tmp/run/resolved-task.json',
      runDir: 'C:/tmp/run',
      filesDir: 'C:/tmp/run/files',
      source: {
        manifest: 'C:/tmp/legacy/manifest.json',
        mediaManifest: 'C:/tmp/legacy/media-manifest.json',
      },
    },
    createdAt: '2026-04-27T00:00:00.000Z',
    finishedAt: '2026-04-27T00:00:01.000Z',
  });

  assert.equal(manifest.schemaVersion, DOWNLOAD_RUN_MANIFEST_SCHEMA_VERSION);
  assert.equal(manifest.status, 'passed');
  assert.equal(manifest.reason, undefined);
  assert.deepEqual(Object.keys(manifest), [
    'schemaVersion',
    'runId',
    'planId',
    'siteKey',
    'status',
    'reason',
    'counts',
    'files',
    'failedResources',
    'resumeCommand',
    'artifacts',
    'legacy',
    'liveValidation',
    'session',
    'createdAt',
    'finishedAt',
  ]);
  assert.deepEqual(Object.keys(manifest.artifacts), [
    'manifest',
    'queue',
    'downloadsJsonl',
    'reportMarkdown',
    'plan',
    'resolvedTask',
    'runDir',
    'filesDir',
    'source',
  ]);
  assert.deepEqual(manifest.artifacts.source, {
    manifest: 'C:/tmp/legacy/manifest.json',
    mediaManifest: 'C:/tmp/legacy/media-manifest.json',
  });
});

test('download CLI parser accepts resume flags emitted by manifests', () => {
  const resumeArgs = parseArgs([
    '--site',
    'bilibili',
    '--input',
    'BV1resume',
    '--execute',
    '--run-dir',
    path.join(os.tmpdir(), 'bwk-download-resume'),
    '--resume',
  ]);
  assert.equal(resumeArgs.resume, true);
  assert.equal(resumeArgs.dryRun, false);

  const retryFailedArgs = parseArgs([
    '--site',
    'bilibili',
    '--input',
    'BV1resume',
    '--execute',
    '--retry-failed',
  ]);
  assert.equal(retryFailedArgs.resume, true);
  assert.equal(retryFailedArgs.retryFailedOnly, true);

  const freshArgs = parseArgs([
    '--site',
    'bilibili',
    '--input',
    'BV1resume',
    '--execute',
    '--no-resume',
  ]);
  assert.equal(freshArgs.resume, false);
});

test('download CLI parser exposes native network, mux, and live validation gates', () => {
  const args = parseArgs([
    '--site',
    'bilibili',
    '--input',
    'BV1live',
    '--resolve-network',
    '--enable-derived-mux',
    '--live-validation',
    'bilibili-dash-mux',
    '--live-approval-id',
    'approval-123',
  ]);

  assert.equal(args.resolveNetwork, true);
  assert.equal(args.enableDerivedMux, true);
  assert.deepEqual(args.liveValidation, {
    status: 'planned',
    scenario: 'bilibili-dash-mux',
    requiresApproval: true,
    approvalId: 'approval-123',
  });
});

test('download CLI parser accepts unified session manifest input', () => {
  const manifestPath = path.join(os.tmpdir(), 'bwk-session-health', 'manifest.json');
  const args = parseArgs([
    '--site',
    'x',
    '--input',
    'openai',
    '--session-required',
    '--session-manifest',
    manifestPath,
  ]);

  assert.equal(args.sessionRequirement, 'required');
  assert.equal(args.sessionManifest, manifestPath);
});

test('download CLI consumes session manifests without requiring an explicit host', async (t) => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-session-manifest-'));
  t.after(() => rm(runRoot, { recursive: true, force: true }));
  const sessionManifest = path.join(runRoot, 'session', 'manifest.json');
  await mkdir(path.dirname(sessionManifest), { recursive: true });
  await writeJsonFile(sessionManifest, normalizeSessionRunManifest({
    siteKey: 'bilibili',
    host: 'www.bilibili.com',
    purpose: 'download',
    status: 'ready',
    health: {
      siteKey: 'bilibili',
      host: 'www.bilibili.com',
      status: 'ready',
      authStatus: 'authenticated',
    },
    artifacts: {
      manifest: sessionManifest,
      runDir: path.dirname(sessionManifest),
    },
  }));

  let output = '';
  const originalWrite = process.stdout.write;
  process.stdout.write = (chunk, ...args) => {
    output += String(chunk);
    if (typeof args.at(-1) === 'function') args.at(-1)();
    return true;
  };
  try {
    await runDownloadCli([
      '--site',
      'bilibili',
      '--input',
      'BV1sessionManifest',
      '--session-optional',
      '--session-manifest',
      sessionManifest,
      '--run-dir',
      path.join(runRoot, 'download'),
      '--json',
    ]);
  } finally {
    process.stdout.write = originalWrite;
  }

  const result = JSON.parse(output);
  assert.equal(result.manifest.status, 'skipped');
  assert.equal(result.manifest.reason, 'dry-run');
  assert.equal(result.plan.host, 'www.bilibili.com');
});

test('download CLI keeps explicit host checks for session manifests', async (t) => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-session-host-mismatch-'));
  t.after(() => rm(runRoot, { recursive: true, force: true }));
  const sessionManifest = path.join(runRoot, 'session', 'manifest.json');
  await mkdir(path.dirname(sessionManifest), { recursive: true });
  await writeJsonFile(sessionManifest, normalizeSessionRunManifest({
    siteKey: 'bilibili',
    host: 'www.bilibili.com',
    purpose: 'download',
    status: 'ready',
    health: {
      siteKey: 'bilibili',
      host: 'www.bilibili.com',
      status: 'ready',
    },
    artifacts: {
      manifest: sessionManifest,
      runDir: path.dirname(sessionManifest),
    },
  }));

  await assert.rejects(
    () => runDownloadCli([
      '--site',
      'bilibili',
      '--host',
      'm.bilibili.com',
      '--input',
      'BV1sessionManifest',
      '--session-manifest',
      sessionManifest,
      '--run-dir',
      path.join(runRoot, 'download'),
      '--json',
    ]),
    /Session manifest host mismatch: expected m.bilibili.com, got www.bilibili.com/u,
  );
});

test('download CLI parser accepts generated unified session health plans', () => {
  const args = parseArgs([
    '--site',
    'instagram',
    '--input',
    'openai',
    '--session-required',
    '--session-health-plan',
  ]);

  assert.equal(args.sessionRequirement, 'required');
  assert.equal(args.useUnifiedSessionHealth, true);
});

test('download CLI parser defaults required sessions to unified health plans and keeps legacy opt-out', () => {
  const requiredArgs = parseArgs([
    '--site',
    'instagram',
    '--input',
    'openai',
    '--session-required',
  ]);
  const legacyArgs = parseArgs([
    '--site',
    'instagram',
    '--input',
    'openai',
    '--session-required',
    '--no-session-health-plan',
  ]);

  assert.equal(requiredArgs.useUnifiedSessionHealth, true);
  assert.equal(legacyArgs.useUnifiedSessionHealth, false);
});

test('download CLI help exposes unified session flags without running tasks', async () => {
  let output = '';
  const originalWrite = process.stdout.write;
  process.stdout.write = (chunk, ...args) => {
    output += String(chunk);
    if (typeof args.at(-1) === 'function') args.at(-1)();
    return true;
  };
  try {
    await runDownloadCli(['--help']);
  } finally {
    process.stdout.write = originalWrite;
  }

  assert.match(output, /--session-manifest <path>/u);
  assert.match(output, /--session-health-plan/u);
  assert.match(output, /--no-session-health-plan/u);
  assert.doesNotMatch(output, /^Status:/mu);
  assert.doesNotMatch(output, /^Manifest:/mu);
});

test('download CLI parser accepts derived mux compatibility aliases', () => {
  assert.equal(parseArgs(['--site', 'bilibili', '--input', 'BV1mux', '--mux-derived-media']).enableDerivedMux, true);
  assert.equal(parseArgs(['--site', 'bilibili', '--input', 'BV1mux', '--dash-mux']).enableDerivedMux, true);
});

test('download registry exposes dry-run plans for every configured download site', async (t) => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-dry-run-'));
  t.after(() => rm(runRoot, { recursive: true, force: true }));

  const definitions = await listDownloadSiteDefinitions(REPO_ROOT);
  const siteKeys = definitions.map((definition) => definition.siteKey).sort();
  assert.deepEqual(siteKeys, [
    '22biqu',
    'bilibili',
    'douyin',
    'instagram',
    'x',
    'xiaohongshu',
  ]);

  for (const definition of definitions) {
    const result = await runDownloadTask({
      site: definition.siteKey,
      input: definition.canonicalBaseUrl ?? `https://${definition.host}/`,
      dryRun: true,
    }, {
      workspaceRoot: REPO_ROOT,
      runRoot,
    });
    assert.equal(result.plan.siteKey, definition.siteKey);
    assert.equal(result.manifest.status, 'skipped');
    assert.equal(result.manifest.reason, 'dry-run');
    assert.equal(result.manifest.artifacts.manifest.endsWith('manifest.json'), true);
    assert.equal((await readJsonFile(result.manifest.artifacts.manifest)).planId, result.plan.id);
  }
});

test('download runner normalizes unhealthy session leases as blocked manifests', async (t) => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-blocked-'));
  t.after(() => rm(runRoot, { recursive: true, force: true }));

  const result = await runDownloadTask({
    site: 'instagram',
    input: 'instagram',
    dryRun: true,
  }, {
    workspaceRoot: REPO_ROOT,
    runRoot,
    sessionStatus: 'expired',
  });

  assert.equal(result.sessionLease.status, 'expired');
  assert.equal(result.manifest.status, 'blocked');
  assert.equal(result.manifest.reason, 'expired');
});

test('download runner preflight blocks required sessions before legacy spawn', async (t) => {
  for (const status of ['blocked', 'manual-required', 'expired', 'quarantine']) {
    await t.test(status, async (t) => {
      const runRoot = await mkdtemp(path.join(os.tmpdir(), `bwk-download-required-${status}-`));
      t.after(() => rm(runRoot, { recursive: true, force: true }));

      let legacyInvoked = false;
      const result = await runDownloadTask({
        site: 'instagram',
        input: 'openai',
        dryRun: false,
      }, {
        workspaceRoot: REPO_ROOT,
        runRoot,
      }, {
        inspectSessionHealth: async () => ({
          siteKey: 'instagram',
          host: 'www.instagram.com',
          status,
          reason: status === 'expired' ? undefined : `${status}-preflight`,
          riskSignals: status === 'expired' ? ['session-expired'] : [],
        }),
        acquireSessionLease: async () => {
          throw new Error('lease acquisition should not run after failed required preflight');
        },
        executeLegacyDownloadTask: async () => {
          legacyInvoked = true;
          throw new Error('legacy adapter should not execute after failed required preflight');
        },
      });

      assert.equal(legacyInvoked, false);
      assert.equal(result.sessionLease.status, status);
      assert.equal(result.manifest.status, 'blocked');
      assert.equal(result.manifest.reason, status === 'expired' ? 'session-expired' : `${status}-preflight`);
    });
  }
});

test('download runner writes sanitized session metadata to manifests', async (t) => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-session-sanitized-'));
  t.after(() => rm(runRoot, { recursive: true, force: true }));

  const result = await runDownloadTask({
    site: 'instagram',
    input: 'openai',
    dryRun: true,
  }, {
    workspaceRoot: REPO_ROOT,
    runRoot,
  }, {
    inspectSessionHealth: async () => ({
      siteKey: 'instagram',
      host: 'www.instagram.com',
      status: 'ready',
      mode: 'authenticated',
      riskSignals: [],
    }),
    acquireSessionLease: async () => ({
      siteKey: 'instagram',
      host: 'www.instagram.com',
      mode: 'authenticated',
      status: 'ready',
      browserProfileRoot: 'C:/Users/example/profiles',
      userDataDir: 'C:/Users/example/profiles/instagram',
      headers: {
        Cookie: 'sessionid=secret',
        Authorization: 'Bearer secret',
      },
      cookies: [{ name: 'sessionid', value: 'secret' }],
      riskSignals: ['profile-warmed'],
      quarantineKey: 'www.instagram.com:download',
      purpose: 'download:social-archive',
    }),
    resolveDownloadResources: async () => ({
      resources: [{
        id: 'media-1',
        url: 'https://cdn.example.test/openai.jpg',
        fileName: 'openai.jpg',
        mediaType: 'image',
      }],
    }),
  });

  assert.equal(result.sessionLease.headers.Cookie, 'sessionid=secret');
  assert.equal(result.manifest.status, 'skipped');
  assert.equal(result.manifest.session.status, 'ready');
  assert.equal(result.manifest.session.mode, 'authenticated');
  assert.deepEqual(result.manifest.session.riskSignals, ['profile-warmed']);
  assert.equal(result.manifest.session.quarantineKey, 'www.instagram.com:download');
  assert.equal(result.manifest.session.headers, undefined);
  assert.equal(result.manifest.session.cookies, undefined);
  assert.equal(result.manifest.session.browserProfileRoot, undefined);
  assert.equal(result.manifest.session.userDataDir, undefined);

  const persisted = await readJsonFile(result.manifest.artifacts.manifest);
  assert.equal(persisted.session.headers, undefined);
  assert.equal(persisted.session.cookies, undefined);
  assert.equal(persisted.session.userDataDir, undefined);
});

test('download runner maps reusable profile governance health to sanitized session manifests', async (t) => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-governance-session-'));
  const userDataDir = path.join(runRoot, 'profile', 'instagram');
  t.after(() => rm(runRoot, { recursive: true, force: true }));

  const governanceLeases = [];
  const releasedGovernanceLeases = [];
  let resolverSawProfileLease = false;
  const result = await runDownloadTask({
    site: 'instagram',
    input: 'openai',
    dryRun: false,
    profile: {
      host: 'www.instagram.com',
      authSession: {
        loginUrl: 'https://www.instagram.com/accounts/login/',
        verificationUrl: 'https://www.instagram.com/',
        reuseLoginStateByDefault: true,
      },
    },
  }, {
    workspaceRoot: REPO_ROOT,
    runRoot,
  }, {
    sessionDeps: {
      inspectReusableSiteSession: async (_inputUrl, settings) => ({
        authAvailable: true,
        reusableProfile: true,
        reuseLoginState: true,
        userDataDir,
        profileHealth: {
          exists: true,
          healthy: true,
          warnings: [],
        },
        authConfig: {
          keepaliveIntervalMinutes: 120,
          requireStableNetworkForAuthenticatedFlows: true,
        },
        sessionOptions: {
          authConfig: {
            keepaliveIntervalMinutes: 120,
            requireStableNetworkForAuthenticatedFlows: true,
          },
          reuseLoginState: settings.reuseLoginState,
          userDataDir,
          cleanupUserDataDirOnShutdown: false,
        },
      }),
      prepareSiteSessionGovernance: async (_inputUrl, authContext, _settings, options) => {
        assert.equal(options.networkOptions.disableExternalLookup, true);
        const lease = {
          leaseId: `governance-${governanceLeases.length + 1}`,
          userDataDir: authContext.userDataDir,
        };
        governanceLeases.push(lease);
        return {
          operation: options.operation,
          userDataDir: authContext.userDataDir,
          lease,
          policyDecision: {
            allowed: true,
            riskCauseCode: null,
            riskAction: null,
            profileQuarantined: false,
          },
          authSessionSummary: {
            lastHealthyAt: '2026-04-28T00:00:00.000Z',
            nextSuggestedKeepaliveAt: '2026-04-28T02:00:00.000Z',
            keepaliveDue: false,
          },
          networkDrift: {
            driftDetected: false,
            reasons: [],
          },
        };
      },
      releaseGovernanceSessionLease: async (lease) => {
        releasedGovernanceLeases.push(lease.leaseId);
      },
    },
    resolveDownloadResources: async (_plan, sessionLease) => {
      resolverSawProfileLease = true;
      assert.equal(sessionLease.status, 'ready');
      assert.equal(sessionLease.mode, 'authenticated');
      assert.equal(sessionLease.userDataDir, userDataDir);
      assert.equal(sessionLease.headers.Cookie, undefined);
      assert.deepEqual(sessionLease.cookies, []);
      return {
        resources: [{
          id: 'media-1',
          url: 'https://cdn.example.test/openai.jpg',
          fileName: 'openai.jpg',
          mediaType: 'image',
        }],
      };
    },
    fetchImpl: async () => {
      const payload = Buffer.from('image body', 'utf8');
      return {
        ok: true,
        status: 200,
        async arrayBuffer() {
          return payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength);
        },
      };
    },
  });

  assert.equal(resolverSawProfileLease, true);
  assert.equal(governanceLeases.length, 2);
  assert.deepEqual(releasedGovernanceLeases.sort(), ['governance-1', 'governance-2']);
  assert.equal(result.manifest.status, 'passed');
  assert.equal(result.manifest.session.status, 'ready');
  assert.equal(result.manifest.session.mode, 'authenticated');
  assert.equal(result.manifest.session.userDataDir, undefined);
  assert.equal(result.manifest.session.headers, undefined);
  assert.equal(result.manifest.session.cookies, undefined);

  const persisted = await readJsonFile(result.manifest.artifacts.manifest);
  assert.equal(persisted.session.userDataDir, undefined);
  assert.equal(persisted.session.headers, undefined);
  assert.equal(persisted.session.cookies, undefined);
});

test('download runner uses lease risk reason when required lease is not ready', async (t) => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-required-lease-risk-'));
  t.after(() => rm(runRoot, { recursive: true, force: true }));

  const result = await runDownloadTask({
    site: 'instagram',
    input: 'openai',
    dryRun: false,
  }, {
    workspaceRoot: REPO_ROOT,
    runRoot,
  }, {
    inspectSessionHealth: async () => ({
      siteKey: 'instagram',
      host: 'www.instagram.com',
      status: 'ready',
      mode: 'authenticated',
      riskSignals: [],
    }),
    acquireSessionLease: async () => ({
      siteKey: 'instagram',
      host: 'www.instagram.com',
      mode: 'reusable-profile',
      status: 'blocked',
      riskSignals: ['login-wall'],
    }),
    executeLegacyDownloadTask: async () => {
      throw new Error('legacy adapter should not execute after failed required lease');
    },
  });

  assert.equal(result.sessionLease.status, 'blocked');
  assert.equal(result.manifest.status, 'blocked');
  assert.equal(result.manifest.reason, 'login-wall');
});

test('download runner continues optional sites anonymously when health is not ready', async (t) => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-optional-anon-'));
  t.after(() => rm(runRoot, { recursive: true, force: true }));

  let resolverSawAnonymous = false;
  const result = await runDownloadTask({
    site: 'bilibili',
    input: 'BV1optionalAnon',
    dryRun: true,
  }, {
    workspaceRoot: REPO_ROOT,
    runRoot,
  }, {
    inspectSessionHealth: async () => ({
      siteKey: 'bilibili',
      host: 'www.bilibili.com',
      status: 'manual-required',
      reason: 'not-logged-in',
      riskSignals: ['not-logged-in'],
    }),
    acquireSessionLease: async () => {
      throw new Error('optional anonymous preflight should not acquire an unhealthy lease');
    },
    resolveDownloadResources: async (_plan, sessionLease) => {
      resolverSawAnonymous = true;
      assert.equal(sessionLease.status, 'ready');
      assert.equal(sessionLease.mode, 'anonymous');
      return {
        resources: [{
          id: 'resource-1',
          url: 'https://example.com/public.mp4',
          fileName: 'public.mp4',
          mediaType: 'video',
        }],
      };
    },
    executeResolvedDownloadTask: async (_resolvedTask, _plan, sessionLease) => ({
      status: 'skipped',
      reason: 'dry-run',
      session: sessionLease,
    }),
    executeLegacyDownloadTask: async () => {
      throw new Error('legacy adapter should not execute during dry-run');
    },
  });

  assert.equal(resolverSawAnonymous, true);
  assert.equal(result.sessionLease.status, 'ready');
  assert.equal(result.sessionLease.mode, 'anonymous');
  assert.equal(result.manifest.status, 'skipped');
});

test('download runner blocks live validation when optional session health is not ready', async (t) => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-live-session-blocked-'));
  t.after(() => rm(runRoot, { recursive: true, force: true }));

  const result = await runDownloadTask({
    site: 'bilibili',
    input: 'BV1liveSessionBlocked',
    dryRun: false,
  }, {
    workspaceRoot: REPO_ROOT,
    runRoot,
    liveValidation: {
      status: 'planned',
      scenario: 'bilibili-dash-mux',
      requiresApproval: true,
      approvalId: 'approval-live-session-blocked',
    },
  }, {
    inspectSessionHealth: async () => ({
      siteKey: 'bilibili',
      host: 'www.bilibili.com',
      status: 'blocked',
      reason: 'profile-health-risk',
      riskSignals: ['profile-crashed'],
    }),
    acquireSessionLease: async () => {
      throw new Error('live validation should not acquire a lease after blocked session health');
    },
    resolveDownloadResources: async () => {
      throw new Error('live validation resolver should not run after blocked session health');
    },
    executeLegacyDownloadTask: async () => {
      throw new Error('live validation legacy adapter should not run after blocked session health');
    },
  });

  assert.equal(result.resolvedTask, null);
  assert.equal(result.sessionLease.status, 'blocked');
  assert.equal(result.manifest.status, 'blocked');
  assert.equal(result.manifest.reason, 'profile-health-risk');
  assert.equal(result.manifest.liveValidation.scenario, 'bilibili-dash-mux');
  assert.equal(result.manifest.liveValidation.approvalId, 'approval-live-session-blocked');
});

test('download runner blocks optional downloads marked login-required when health is not ready', async (t) => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-optional-login-required-'));
  t.after(() => rm(runRoot, { recursive: true, force: true }));

  const result = await runDownloadTask({
    site: 'bilibili',
    input: 'https://www.bilibili.com/watchlater/',
    dryRun: false,
    downloadRequiresAuth: true,
  }, {
    workspaceRoot: REPO_ROOT,
    runRoot,
  }, {
    inspectSessionHealth: async () => ({
      siteKey: 'bilibili',
      host: 'www.bilibili.com',
      status: 'manual-required',
      reason: 'login-required',
      riskSignals: ['not-logged-in'],
    }),
    acquireSessionLease: async () => {
      throw new Error('lease acquisition should not run after failed login-required preflight');
    },
    executeLegacyDownloadTask: async () => {
      throw new Error('legacy adapter should not execute after failed login-required preflight');
    },
  });

  assert.equal(result.plan.sessionRequirement, 'optional');
  assert.equal(result.sessionLease.status, 'manual-required');
  assert.equal(result.manifest.status, 'blocked');
  assert.equal(result.manifest.reason, 'login-required');
});

test('download runner forwards injected resolver deps with network gate disabled by default', async (t) => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-runner-resolver-deps-off-'));
  t.after(() => rm(runRoot, { recursive: true, force: true }));

  let resolverCalled = false;
  const result = await runDownloadTask({
    site: 'bilibili',
    input: 'https://www.bilibili.com/video/BV1runnerGateOff/',
    dryRun: true,
  }, {
    workspaceRoot: REPO_ROOT,
    runRoot,
  }, {
    acquireSessionLease: async (_siteKey, purpose) => ({
      siteKey: 'bilibili',
      host: 'www.bilibili.com',
      mode: 'anonymous',
      status: 'ready',
      riskSignals: [],
      purpose,
    }),
    releaseSessionLease: async () => {},
    resolveBilibiliApiEvidence: async (evidenceRequest, options) => {
      resolverCalled = true;
      assert.equal(evidenceRequest.contractVersion, 'bilibili-native-api-evidence-v1');
      assert.equal(evidenceRequest.bvid, 'BV1runnerGateOff');
      assert.equal(evidenceRequest.allowNetworkResolve, false);
      assert.equal(options.allowNetworkResolve, false);
      return {
        viewPayload: {
          data: {
            bvid: 'BV1runnerGateOff',
            pages: [{ cid: 5101, page: 1 }],
          },
        },
        playUrlPayloads: {
          5101: { cid: 5101, data: { durl: [{ url: 'https://upos.example.test/runner/gate-off.flv' }] } },
        },
      };
    },
    executeLegacyDownloadTask: async () => {
      throw new Error('legacy adapter should not run after injected native evidence resolves');
    },
  });

  assert.equal(resolverCalled, true);
  assert.equal(result.resolvedTask.resources.length, 1);
  assert.equal(result.resolvedTask.resources[0].url, 'https://upos.example.test/runner/gate-off.flv');
  assert.equal(result.manifest.status, 'skipped');
  assert.equal(result.manifest.reason, 'dry-run');
});

test('download runner only enables injected resolver network gate with resolveNetwork', async (t) => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-runner-resolver-deps-on-'));
  t.after(() => rm(runRoot, { recursive: true, force: true }));

  const result = await runDownloadTask({
    site: 'bilibili',
    input: 'https://www.bilibili.com/video/BV1runnerGateOn/',
    dryRun: true,
  }, {
    workspaceRoot: REPO_ROOT,
    runRoot,
    resolveNetwork: true,
  }, {
    acquireSessionLease: async (_siteKey, purpose) => ({
      siteKey: 'bilibili',
      host: 'www.bilibili.com',
      mode: 'anonymous',
      status: 'ready',
      riskSignals: [],
      purpose,
    }),
    releaseSessionLease: async () => {},
    resolveBilibiliApiEvidence: async (evidenceRequest, options) => {
      assert.equal(evidenceRequest.bvid, 'BV1runnerGateOn');
      assert.equal(evidenceRequest.allowNetworkResolve, true);
      assert.equal(options.allowNetworkResolve, true);
      return {
        viewPayload: {
          data: {
            bvid: 'BV1runnerGateOn',
            pages: [{ cid: 5201, page: 1 }],
          },
        },
        playUrlPayloads: {
          5201: { cid: 5201, data: { durl: [{ url: 'https://upos.example.test/runner/gate-on.flv' }] } },
        },
      };
    },
  });

  assert.equal(result.resolvedTask.resources.length, 1);
  assert.equal(result.resolvedTask.resources[0].url, 'https://upos.example.test/runner/gate-on.flv');
});

test('download runner blocks required unhealthy sessions before resolver deps run', async (t) => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-runner-resolver-preflight-'));
  t.after(() => rm(runRoot, { recursive: true, force: true }));

  const result = await runDownloadTask({
    site: 'bilibili',
    input: 'https://www.bilibili.com/video/BV1blockedGate/',
    dryRun: false,
    downloadRequiresAuth: true,
  }, {
    workspaceRoot: REPO_ROOT,
    runRoot,
    resolveNetwork: true,
  }, {
    inspectSessionHealth: async () => ({
      siteKey: 'bilibili',
      host: 'www.bilibili.com',
      status: 'manual-required',
      reason: 'login-required',
      riskSignals: ['not-logged-in'],
      repairPlan: {
        action: 'site-login',
        command: 'site-login',
        reason: 'login-required',
        riskSignals: ['not-logged-in'],
        requiresApproval: true,
      },
    }),
    resolveBilibiliApiEvidence: async () => {
      throw new Error('resolver deps should not run before required session preflight passes');
    },
    executeLegacyDownloadTask: async () => {
      throw new Error('legacy adapter should not run after failed required session preflight');
    },
  });

  assert.equal(result.resolvedTask, null);
  assert.equal(result.manifest.status, 'blocked');
  assert.equal(result.manifest.reason, 'login-required');
  assert.deepEqual(result.manifest.session.repairPlan, {
    action: 'site-login',
    command: 'site-login',
    reason: 'login-required',
    requiresApproval: true,
    riskSignals: ['not-logged-in'],
  });
});

test('download runner can generate and consume unified session health before resolver work', async (t) => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-unified-session-'));
  t.after(() => rm(runRoot, { recursive: true, force: true }));
  let sessionHealthRequested = false;
  let inspectedStatus = null;
  let resolverCalled = false;
  const sessionManifestPath = path.join(runRoot, 'session-health', 'manifest.json');

  const result = await runDownloadTask({
    site: 'instagram',
    input: 'openai',
    sessionRequirement: 'required',
    dryRun: true,
  }, {
    workspaceRoot: REPO_ROOT,
    runRoot,
    useUnifiedSessionHealth: true,
  }, {
    runSessionTask: async () => {
      sessionHealthRequested = true;
      return {
        manifest: normalizeSessionRunManifest({
          plan: {
            siteKey: 'instagram',
            host: 'www.instagram.com',
            purpose: 'download',
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
            manifest: sessionManifestPath,
            runDir: path.dirname(sessionManifestPath),
          },
        }),
      };
    },
    inspectSessionHealth: async (_siteKey, options) => {
      inspectedStatus = options.sessionStatus;
      return {
        siteKey: 'instagram',
        host: 'www.instagram.com',
        status: options.sessionStatus,
        reason: options.sessionReason,
        riskSignals: options.riskSignals,
      };
    },
    resolveDownloadResources: async () => {
      resolverCalled = true;
      return null;
    },
  });

  assert.equal(sessionHealthRequested, true);
  assert.equal(inspectedStatus, 'manual-required');
  assert.equal(resolverCalled, false);
  assert.equal(result.manifest.status, 'blocked');
  assert.equal(result.manifest.session.provider, 'unified-session-runner');
  assert.equal(result.manifest.session.healthManifest, sessionManifestPath);
  const report = await readFile(result.manifest.artifacts.reportMarkdown, 'utf8');
  assert.match(report, /Session provider: unified-session-runner/u);
  assert.match(report, /Session traceability gate: passed \(unified-session-health-manifest\)/u);
  assert.match(report, new RegExp(sessionManifestPath.replace(/[\\^$.*+?()[\]{}|]/gu, '\\$&'), 'u'));
});

test('legacy executor normalizes successful action stdout into a download manifest', async (t) => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-legacy-success-'));
  t.after(() => rm(runRoot, { recursive: true, force: true }));

  const plan = normalizeDownloadTaskPlan({
    siteKey: 'bilibili',
    host: 'www.bilibili.com',
    taskType: 'video',
    source: { input: 'BV1legacySuccess' },
    policy: { dryRun: false, concurrency: 2, skipExisting: true },
    output: { root: runRoot },
    legacy: {
      entrypoint: 'src/entrypoints/sites/bilibili-action.mjs',
      executorKind: 'node',
    },
  });
  let capturedCommand = null;
  let capturedArgs = null;
  const nativeFallback = {
    reason: 'bilibili-playurl-evidence-missing',
    resolver: {
      adapterId: 'bilibili',
      method: 'native-bilibili-page-seeds',
    },
    completeness: {
      expectedCount: 1,
      resolvedCount: 0,
      complete: false,
      reason: 'bilibili-playurl-evidence-missing',
    },
  };
  const manifest = await executeLegacyDownloadTask(plan, {
    siteKey: 'bilibili',
    host: 'www.bilibili.com',
    status: 'ready',
    mode: 'reusable-profile',
    riskSignals: [],
  }, {
    input: 'BV1legacySuccess',
  }, {
    workspaceRoot: REPO_ROOT,
    runRoot,
    nativeFallback,
  }, {
    spawnJsonCommand: async (command, args) => {
      capturedCommand = command;
      capturedArgs = args;
      return {
        code: 0,
        stderr: '',
        stdout: JSON.stringify({
          ok: true,
          action: 'download',
          reasonCode: 'download-started',
          downloadResult: {
            manifest: {
              runDir: path.join(runRoot, 'legacy-bilibili-run'),
              summary: {
                total: 1,
                successful: 1,
                failed: 0,
                skipped: 0,
                planned: 0,
              },
              results: [{
                status: 'success',
                finalUrl: 'https://www.bilibili.com/video/BV1legacySuccess/',
                outputPath: path.join(runRoot, 'legacy-bilibili-run', 'video.mp4'),
              }],
            },
          },
        }),
      };
    },
  });

  assert.equal(capturedCommand, process.execPath);
  assert.equal(capturedArgs.includes(path.join(REPO_ROOT, 'src', 'entrypoints', 'sites', 'bilibili-action.mjs')), true);
  assert.equal(capturedArgs.includes('download'), true);
  assert.equal(capturedArgs.includes('BV1legacySuccess'), true);
  assert.equal(capturedArgs.includes('--out-dir'), true);
  assert.equal(capturedArgs.includes('--skip-existing'), true);
  assert.equal(manifest.status, 'passed');
  assert.equal(manifest.counts.downloaded, 1);
  assert.equal(manifest.files.length, 1);
  assert.equal(manifest.legacy.exitCode, 0);
  assert.deepEqual(manifest.legacy.nativeFallback, nativeFallback);
  assert.equal(manifest.schemaVersion, DOWNLOAD_RUN_MANIFEST_SCHEMA_VERSION);
  assert.equal(manifest.artifacts.source.runDir, path.join(runRoot, 'legacy-bilibili-run'));
  const resolvedTask = await readJsonFile(manifest.artifacts.resolvedTask);
  assert.equal(resolvedTask.completeness.reason, 'legacy-downloader-required');
  assert.deepEqual(resolvedTask.metadata.nativeFallback, nativeFallback);
  assert.equal((await readJsonFile(manifest.artifacts.manifest)).planId, plan.id);
});

test('legacy executor normalizes action stdout source artifacts into manifest refs', async (t) => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-legacy-action-artifacts-'));
  t.after(() => rm(runRoot, { recursive: true, force: true }));

  const legacyRunDir = path.join(runRoot, 'legacy-x-run');
  const plan = normalizeDownloadTaskPlan({
    siteKey: 'x',
    host: 'x.com',
    taskType: 'social-archive',
    source: { input: 'openai' },
    policy: { dryRun: false, maxItems: 2 },
    output: { root: runRoot },
    legacy: {
      entrypoint: 'src/entrypoints/sites/x-action.mjs',
      executorKind: 'node',
    },
  });

  const manifest = await executeLegacyDownloadTask(plan, {
    siteKey: 'x',
    host: 'x.com',
    status: 'ready',
    mode: 'reusable-profile',
    riskSignals: [],
  }, {
    input: 'openai',
    account: 'openai',
    downloadMedia: true,
  }, {
    workspaceRoot: REPO_ROOT,
    runRoot,
  }, {
    spawnJsonCommand: async () => ({
      code: 0,
      stderr: '',
      stdout: JSON.stringify({
        ok: true,
        status: 'degraded',
        reason: 'soft-cursor-exhausted',
        artifacts: {
          runDir: legacyRunDir,
          manifest: path.join(legacyRunDir, 'manifest.json'),
          items: path.join(legacyRunDir, 'items.jsonl'),
          downloadsJsonl: path.join(legacyRunDir, 'downloads.jsonl'),
          mediaHashManifestPath: path.join(legacyRunDir, 'media-manifest.json'),
          mediaQueuePath: path.join(legacyRunDir, 'media-queue.json'),
          reportPath: path.join(legacyRunDir, 'report.md'),
        },
        counts: {
          rows: 2,
          failed: 0,
          skipped: 0,
        },
      }),
    }),
  });

  assert.equal(manifest.status, 'partial');
  assert.equal(manifest.reason, 'soft-cursor-exhausted');
  assert.equal(manifest.counts.expected, 2);
  assert.equal(manifest.counts.downloaded, 2);
  assert.equal(manifest.artifacts.manifest.endsWith('manifest.json'), true);
  assert.equal(manifest.artifacts.queue.endsWith('queue.json'), true);
  assert.equal(manifest.artifacts.downloadsJsonl.endsWith('downloads.jsonl'), true);
  assert.deepEqual(manifest.artifacts.source, {
    runDir: legacyRunDir,
    manifest: path.join(legacyRunDir, 'manifest.json'),
    itemsJsonl: path.join(legacyRunDir, 'items.jsonl'),
    downloadsJsonl: path.join(legacyRunDir, 'downloads.jsonl'),
    mediaManifest: path.join(legacyRunDir, 'media-manifest.json'),
    mediaQueue: path.join(legacyRunDir, 'media-queue.json'),
    reportMarkdown: path.join(legacyRunDir, 'report.md'),
  });
  assert.deepEqual(manifest.legacy.artifacts, manifest.artifacts.source);
  const report = await readFile(manifest.artifacts.reportMarkdown, 'utf8');
  assert.match(report, /Status explanation:/u);
  assert.match(report, /Next resume command: .*--resume/u);
  assert.match(report, /Next retry-failed command: .*--retry-failed/u);
  assert.match(report, /Source artifact mediaQueue:/u);
  assert.match(report, /Source artifact indexCsv:|Source artifact manifest:/u);
});

test('legacy executor maps blocked legacy failures into blocked manifests', async (t) => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-legacy-blocked-'));
  t.after(() => rm(runRoot, { recursive: true, force: true }));

  const plan = normalizeDownloadTaskPlan({
    siteKey: 'bilibili',
    host: 'www.bilibili.com',
    taskType: 'video',
    source: { input: 'https://www.bilibili.com/festival/private' },
    policy: { dryRun: false },
    output: { root: runRoot },
    legacy: {
      entrypoint: 'src/entrypoints/sites/bilibili-action.mjs',
      executorKind: 'node',
    },
  });
  const manifest = await executeLegacyDownloadTask(plan, {
    siteKey: 'bilibili',
    host: 'www.bilibili.com',
    status: 'ready',
    mode: 'reusable-profile',
    riskSignals: [],
  }, {}, {
    workspaceRoot: REPO_ROOT,
    runRoot,
  }, {
    spawnJsonCommand: async () => ({
      code: 1,
      stderr: 'login is required',
      stdout: JSON.stringify({
        ok: false,
        reasonCode: 'login-bootstrap-failed',
      }),
    }),
  });

  assert.equal(manifest.status, 'blocked');
  assert.equal(manifest.reason, 'login-bootstrap-failed');
  assert.equal(manifest.resumeCommand.includes('--execute'), true);
});

test('legacy executor converts spawn errors into failed manifests', async (t) => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-legacy-spawn-error-'));
  t.after(() => rm(runRoot, { recursive: true, force: true }));

  const plan = normalizeDownloadTaskPlan({
    siteKey: 'bilibili',
    host: 'www.bilibili.com',
    taskType: 'video',
    source: { input: 'BV1spawnError' },
    policy: { dryRun: false },
    output: { root: runRoot },
    legacy: {
      entrypoint: 'src/entrypoints/sites/bilibili-action.mjs',
      executorKind: 'node',
    },
  });
  const manifest = await executeLegacyDownloadTask(plan, {
    siteKey: 'bilibili',
    host: 'www.bilibili.com',
    status: 'ready',
    mode: 'reusable-profile',
    riskSignals: [],
  }, {}, {
    workspaceRoot: REPO_ROOT,
    runRoot,
  }, {
    spawnJsonCommand: async () => {
      throw new Error('spawn ENOENT');
    },
  });

  assert.equal(manifest.status, 'failed');
  assert.equal(manifest.reason, 'spawn ENOENT');
  assert.equal(manifest.legacy.exitCode, 1);
});

test('download runner executes bilibili legacy adapter when no resources are resolved', async (t) => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-runner-legacy-'));
  t.after(() => rm(runRoot, { recursive: true, force: true }));

  let invoked = false;
  const result = await runDownloadTask({
    site: 'bilibili',
    input: 'BV1runnerLegacy',
    dryRun: false,
  }, {
    workspaceRoot: REPO_ROOT,
    runRoot,
  }, {
    spawnJsonCommand: async (command, args) => {
      invoked = true;
      assert.equal(command, process.execPath);
      assert.equal(args.includes('BV1runnerLegacy'), true);
      return {
        code: 0,
        stderr: '',
        stdout: JSON.stringify({
          ok: true,
          reasonCode: 'download-started',
          actionSummary: {
            total: 1,
            successful: 1,
            failed: 0,
            skipped: 0,
          },
        }),
      };
    },
  });

  assert.equal(invoked, true);
  assert.equal(result.manifest.status, 'passed');
  assert.equal(result.manifest.counts.downloaded, 1);
  assert.equal(result.manifest.legacy.entrypoint.endsWith(path.join('src', 'entrypoints', 'sites', 'bilibili-action.mjs')), true);
});

test('download runner passes native miss trace into legacy fallback options', async (t) => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-runner-native-miss-'));
  t.after(() => rm(runRoot, { recursive: true, force: true }));

  let capturedNativeFallback = null;
  const result = await runDownloadTask({
    site: 'bilibili',
    input: 'https://www.bilibili.com/video/BV1nativeMissTrace/',
    dryRun: false,
  }, {
    workspaceRoot: REPO_ROOT,
    runRoot,
  }, {
    acquireSessionLease: async () => ({
      siteKey: 'bilibili',
      host: 'www.bilibili.com',
      status: 'ready',
      mode: 'anonymous',
      riskSignals: [],
    }),
    releaseSessionLease: async () => {},
    resolveDownloadResources: async (plan) => ({
      planId: plan.id,
      siteKey: plan.siteKey,
      taskType: plan.taskType,
      resources: [],
      metadata: {
        resolver: {
          adapterId: 'bilibili',
          method: 'native-bilibili-page-seeds',
        },
      },
      completeness: {
        expectedCount: 1,
        resolvedCount: 0,
        complete: false,
        reason: 'bilibili-playurl-evidence-missing',
      },
    }),
    executeLegacyDownloadTask: async (_plan, _sessionLease, _request, options) => {
      capturedNativeFallback = options.nativeFallback;
      return normalizeDownloadRunManifest({
        status: 'passed',
        siteKey: 'bilibili',
        counts: {
          expected: 1,
          downloaded: 1,
          skipped: 0,
          failed: 0,
        },
        legacy: {
          entrypoint: _plan.legacy.entrypoint,
          nativeFallback: options.nativeFallback,
        },
      });
    },
  });

  assert.equal(result.resolvedTask.resources.length, 0);
  assert.equal(capturedNativeFallback.reason, 'bilibili-playurl-evidence-missing');
  assert.equal(capturedNativeFallback.resolver.adapterId, 'bilibili');
  assert.equal(capturedNativeFallback.resolver.method, 'native-bilibili-page-seeds');
  assert.deepEqual(capturedNativeFallback.completeness, {
    expectedCount: 1,
    resolvedCount: 0,
    complete: false,
    reason: 'bilibili-playurl-evidence-missing',
  });
  assert.deepEqual(result.manifest.legacy.nativeFallback, capturedNativeFallback);
});

test('download runner maps social requests to legacy action argv and source artifacts', async (t) => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-runner-social-'));
  t.after(() => rm(runRoot, { recursive: true, force: true }));

  const legacyRunDir = path.join(runRoot, 'legacy-social-search');
  let capturedCommand = null;
  let capturedArgs = null;
  const result = await runDownloadTask({
    site: 'x',
    input: 'https://x.com/search?q=codex',
    dryRun: false,
    date: '2026-04-26',
    maxItems: 4,
    downloadMedia: true,
  }, {
    workspaceRoot: REPO_ROOT,
    runRoot,
  }, {
    inspectSessionHealth: async () => ({
      siteKey: 'x',
      host: 'x.com',
      status: 'ready',
      mode: 'reusable-profile',
      riskSignals: [],
    }),
    acquireSessionLease: async () => ({
      siteKey: 'x',
      host: 'x.com',
      status: 'ready',
      mode: 'reusable-profile',
      riskSignals: [],
    }),
    releaseSessionLease: async () => {},
    spawnJsonCommand: async (command, args) => {
      capturedCommand = command;
      capturedArgs = args;
      return {
        code: 0,
        stderr: '',
        stdout: JSON.stringify({
          ok: true,
          status: 'complete',
          artifacts: {
            runDir: legacyRunDir,
            manifestPath: path.join(legacyRunDir, 'manifest.json'),
            itemsJsonlPath: path.join(legacyRunDir, 'items.jsonl'),
            downloadsJsonlPath: path.join(legacyRunDir, 'downloads.jsonl'),
            mediaQueuePath: path.join(legacyRunDir, 'media-queue.json'),
            mediaHashManifestPath: path.join(legacyRunDir, 'media-manifest.json'),
          },
          counts: {
            rows: 1,
            failed: 0,
            skipped: 0,
          },
        }),
      };
    },
  });

  assert.equal(capturedCommand, process.execPath);
  assert.equal(capturedArgs.includes(path.join(REPO_ROOT, 'src', 'entrypoints', 'sites', 'x-action.mjs')), true);
  assert.equal(capturedArgs[1], 'search');
  assert.equal(capturedArgs[capturedArgs.indexOf('--query') + 1], 'codex');
  assert.equal(capturedArgs[capturedArgs.indexOf('--date') + 1], '2026-04-26');
  assert.equal(capturedArgs[capturedArgs.indexOf('--max-items') + 1], '4');
  assert.equal(capturedArgs.includes('--download-media'), true);
  assert.equal(result.manifest.status, 'passed');
  assert.deepEqual(result.manifest.artifacts.source, {
    runDir: legacyRunDir,
    manifest: path.join(legacyRunDir, 'manifest.json'),
    itemsJsonl: path.join(legacyRunDir, 'items.jsonl'),
    downloadsJsonl: path.join(legacyRunDir, 'downloads.jsonl'),
    mediaManifest: path.join(legacyRunDir, 'media-manifest.json'),
    mediaQueue: path.join(legacyRunDir, 'media-queue.json'),
  });
  assert.deepEqual(result.manifest.legacy.artifacts, result.manifest.artifacts.source);
});

test('download runner executes gated social native resources without spawning legacy', async (t) => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-runner-social-native-'));
  t.after(() => rm(runRoot, { recursive: true, force: true }));

  let executorInvoked = false;
  let legacyInvoked = false;
  const result = await runDownloadTask({
    site: 'x',
    input: 'https://x.com/openai',
    nativeResolver: true,
    dryRun: false,
    mediaItems: [{
      tweetId: 'tweet-native',
      media: [{
        id: 'media-native',
        type: 'video',
        variants: [{ contentType: 'video/mp4', bitrate: 1024, url: 'https://video.twimg.example.test/native.mp4' }],
      }],
    }],
  }, {
    workspaceRoot: REPO_ROOT,
    runRoot,
  }, {
    acquireSessionLease: async () => ({
      siteKey: 'x',
      host: 'x.com',
      status: 'ready',
      mode: 'reusable-profile',
      riskSignals: [],
    }),
    releaseSessionLease: async () => {},
    executeResolvedDownloadTask: async (resolvedTask, plan) => {
      executorInvoked = true;
      assert.equal(resolvedTask.resources.length, 1);
      assert.equal(resolvedTask.resources[0].url, 'https://video.twimg.example.test/native.mp4');
      assert.equal(resolvedTask.metadata.resolver.method, 'native-x-social-resource-seeds');
      return normalizeDownloadRunManifest({
        runId: 'social-native',
        planId: plan.id,
        siteKey: plan.siteKey,
        status: 'passed',
        counts: {
          expected: 1,
          attempted: 1,
          downloaded: 1,
          skipped: 0,
          failed: 0,
        },
        artifacts: {
          manifest: path.join(runRoot, 'manifest.json'),
          queue: path.join(runRoot, 'queue.json'),
          downloadsJsonl: path.join(runRoot, 'downloads.jsonl'),
          reportMarkdown: path.join(runRoot, 'report.md'),
        },
      });
    },
    executeLegacyDownloadTask: async () => {
      legacyInvoked = true;
      throw new Error('legacy adapter should not execute for gated native social resources');
    },
    spawnJsonCommand: async () => {
      legacyInvoked = true;
      throw new Error('legacy spawn should not run for gated native social resources');
    },
  });

  assert.equal(executorInvoked, true);
  assert.equal(legacyInvoked, false);
  assert.equal(result.manifest.status, 'passed');
  assert.equal(result.manifest.legacy, undefined);
});

test('download runner dry-run does not execute legacy adapters', async (t) => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-runner-legacy-dry-'));
  t.after(() => rm(runRoot, { recursive: true, force: true }));

  const result = await runDownloadTask({
    site: 'bilibili',
    input: 'BV1runnerDryRun',
    dryRun: true,
  }, {
    workspaceRoot: REPO_ROOT,
    runRoot,
  }, {
    spawnJsonCommand: async () => {
      throw new Error('legacy adapter should not execute during dry-run');
    },
  });

  assert.equal(result.manifest.status, 'skipped');
  assert.equal(result.manifest.reason, 'dry-run');
  assert.equal(result.manifest.legacy, undefined);
});

test('download runner dry-run routes native resolved resources through the generic executor', async (t) => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-runner-native-dry-'));
  t.after(() => rm(runRoot, { recursive: true, force: true }));

  let genericExecutorInvoked = false;
  let legacyInvoked = false;
  let fetchInvoked = false;
  const result = await runDownloadTask(native22BiquRequest({ dryRun: true }), {
    workspaceRoot: REPO_ROOT,
    runRoot,
  }, {
    acquireSessionLease: async (_siteKey, purpose) => native22BiquSessionLease(purpose),
    releaseSessionLease: async () => {},
    executeResolvedDownloadTask: async (resolvedTask, plan, sessionLease, options, executorDeps) => {
      genericExecutorInvoked = true;
      return await executeResolvedDownloadTask(resolvedTask, plan, sessionLease, options, executorDeps);
    },
    executeLegacyDownloadTask: async () => {
      legacyInvoked = true;
      throw new Error('legacy adapter should not execute when native resources are resolved');
    },
    spawnJsonCommand: async () => {
      legacyInvoked = true;
      throw new Error('legacy spawn should not run when native resources are resolved');
    },
    fetchImpl: async () => {
      fetchInvoked = true;
      throw new Error('dry-run should not fetch native resources');
    },
  });

  assert.equal(genericExecutorInvoked, true);
  assert.equal(legacyInvoked, false);
  assert.equal(fetchInvoked, false);
  assert.equal(result.plan.legacy.entrypoint.endsWith(path.join('src', 'sites', 'chapter-content', 'download', 'python', 'book.py')), true);
  assert.equal(result.resolvedTask.metadata.resolver.method, 'native-22biqu-chapters');
  assert.equal(result.resolvedTask.resources.length, 2);
  assert.equal(result.manifest.status, 'skipped');
  assert.equal(result.manifest.reason, 'dry-run');
  assert.equal(result.manifest.legacy, undefined);

  const artifacts = await assertDownloadRunArtifactBundle(result.manifest);
  assert.equal(artifacts.persistedManifest.planId, result.plan.id);
  assert.equal(artifacts.plan.id, result.plan.id);
  assert.equal(artifacts.resolvedTask.planId, result.plan.id);
  assert.equal(artifacts.resolvedTask.resources.length, 2);
  assert.deepEqual(artifacts.queue.map((entry) => entry.status), ['pending', 'pending']);
  assert.deepEqual(artifacts.downloads, []);
  assert.match(artifacts.report, /Status: skipped/u);
  assert.match(artifacts.report, /Reason: dry-run/u);
});

test('download runner execute downloads native resolved resources through the generic executor', async (t) => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-runner-native-exec-'));
  t.after(() => rm(runRoot, { recursive: true, force: true }));

  let genericExecutorInvoked = false;
  let legacyInvoked = false;
  const fetchedUrls = [];
  const result = await runDownloadTask(native22BiquRequest({ dryRun: false }), {
    workspaceRoot: REPO_ROOT,
    runRoot,
  }, {
    acquireSessionLease: async (_siteKey, purpose) => native22BiquSessionLease(purpose),
    releaseSessionLease: async () => {},
    executeResolvedDownloadTask: async (resolvedTask, plan, sessionLease, options, executorDeps) => {
      genericExecutorInvoked = true;
      return await executeResolvedDownloadTask(resolvedTask, plan, sessionLease, options, executorDeps);
    },
    executeLegacyDownloadTask: async () => {
      legacyInvoked = true;
      throw new Error('legacy adapter should not execute when native resources are resolved');
    },
    spawnJsonCommand: async () => {
      legacyInvoked = true;
      throw new Error('legacy spawn should not run when native resources are resolved');
    },
    fetchImpl: async (url) => {
      fetchedUrls.push(String(url));
      const payload = Buffer.from(`chapter body for ${url}`, 'utf8');
      return {
        ok: true,
        status: 200,
        async arrayBuffer() {
          return payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength);
        },
      };
    },
  });

  assert.equal(genericExecutorInvoked, true);
  assert.equal(legacyInvoked, false);
  assert.deepEqual(fetchedUrls.sort(), [
    'https://www.22biqu.com/biqu123/1.html',
    'https://www.22biqu.com/biqu123/2.html',
  ]);
  assert.equal(result.plan.legacy.entrypoint.endsWith(path.join('src', 'sites', 'chapter-content', 'download', 'python', 'book.py')), true);
  assert.equal(result.resolvedTask.metadata.resolver.method, 'native-22biqu-chapters');
  assert.equal(result.manifest.status, 'passed');
  assert.equal(result.manifest.reason, undefined);
  assert.equal(result.manifest.counts.expected, 2);
  assert.equal(result.manifest.counts.downloaded, 2);
  assert.equal(result.manifest.counts.failed, 0);
  assert.equal(result.manifest.legacy, undefined);
  assert.equal(result.manifest.files.length, 2);
  assert.match(await readFile(result.manifest.files[0].filePath, 'utf8'), /chapter body for/u);

  const artifacts = await assertDownloadRunArtifactBundle(result.manifest);
  assert.equal(artifacts.persistedManifest.planId, result.plan.id);
  assert.equal(artifacts.plan.id, result.plan.id);
  assert.equal(artifacts.plan.policy.dryRun, false);
  assert.equal(artifacts.resolvedTask.resources.length, 2);
  assert.deepEqual(artifacts.queue.map((entry) => entry.status), ['downloaded', 'downloaded']);
  assert.equal(artifacts.downloads.length, 2);
  assert.equal(artifacts.downloads.every((entry) => entry.ok === true), true);
  assert.match(artifacts.report, /Status: passed/u);
  assert.match(artifacts.report, /Manifest:/u);
  assert.match(artifacts.report, /Queue:/u);
  assert.match(artifacts.report, /Downloads JSONL:/u);
});

test('download executor consumes resolved resources without site-specific logic', async (t) => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-executor-'));
  t.after(() => rm(runRoot, { recursive: true, force: true }));

  const plan = normalizeDownloadTaskPlan({
    siteKey: 'example',
    host: 'example.com',
    taskType: 'generic-resource',
    source: { input: 'https://example.com/file.txt' },
    policy: { dryRun: false, verify: true, retries: 0 },
    output: { root: runRoot },
  });
  const payload = Buffer.from('download body', 'utf8');
  const manifest = await executeResolvedDownloadTask({
    planId: plan.id,
    siteKey: plan.siteKey,
    taskType: plan.taskType,
    resources: [{
      id: 'resource-1',
      url: 'https://example.com/file.txt',
      fileName: 'file.txt',
      mediaType: 'text',
      expectedBytes: payload.length,
    }],
  }, plan, {
    siteKey: 'example',
    host: 'example.com',
    status: 'ready',
    mode: 'anonymous',
    riskSignals: [],
  }, {
    workspaceRoot: REPO_ROOT,
    runRoot,
    dryRun: false,
  }, {
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      async arrayBuffer() {
        return payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength);
      },
    }),
  });

  assert.equal(manifest.status, 'passed');
  assert.equal(manifest.counts.downloaded, 1);
  assert.equal(await readFile(manifest.files[0].filePath, 'utf8'), 'download body');
});

test('download executor muxes completed audio and video resources as a derived artifact', async (t) => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-executor-mux-'));
  t.after(() => rm(runRoot, { recursive: true, force: true }));

  const plan = normalizeDownloadTaskPlan({
    siteKey: 'bilibili',
    host: 'www.bilibili.com',
    taskType: 'video',
    source: { input: 'https://www.bilibili.com/video/BV1muxFixture/' },
    policy: { dryRun: false, concurrency: 2, retries: 0, retryBackoffMs: 0 },
    output: { root: runRoot },
  });
  const resolvedTask = {
    planId: plan.id,
    siteKey: 'bilibili',
    taskType: 'video',
    resources: [{
      id: 'dash-video',
      url: 'https://upos.example.test/mux/video.m4s',
      fileName: 'dash-video.m4s',
      mediaType: 'video',
      groupId: 'bilibili:BV1muxFixture:p1',
      metadata: {
        muxRole: 'video',
        muxKind: 'dash-audio-video',
      },
    }, {
      id: 'dash-audio',
      url: 'https://upos.example.test/mux/audio.m4s',
      fileName: 'dash-audio.m4s',
      mediaType: 'audio',
      groupId: 'bilibili:BV1muxFixture:p1',
      metadata: {
        muxRole: 'audio',
        muxKind: 'dash-audio-video',
      },
    }],
  };
  const fetchUrls = [];
  const muxCalls = [];
  const manifest = await executeResolvedDownloadTask(resolvedTask, plan, null, {
    runRoot,
    dryRun: false,
  }, {
    fetchImpl: async (url) => {
      fetchUrls.push(String(url));
      const payload = Buffer.from(String(url).includes('video') ? 'video stream' : 'audio stream', 'utf8');
      return {
        ok: true,
        status: 200,
        async arrayBuffer() {
          return payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength);
        },
      };
    },
    muxMediaPair: async ({ videoFile, audioFile, outputFile, groupId }) => {
      muxCalls.push({ videoFile, audioFile, outputFile, groupId });
      const video = await readFile(videoFile, 'utf8');
      const audio = await readFile(audioFile, 'utf8');
      await writeFile(outputFile, `${video}+${audio}`, 'utf8');
      return { ok: true };
    },
  });

  assert.deepEqual(fetchUrls.sort(), [
    'https://upos.example.test/mux/audio.m4s',
    'https://upos.example.test/mux/video.m4s',
  ]);
  assert.equal(muxCalls.length, 1);
  assert.equal(muxCalls[0].groupId, 'bilibili:BV1muxFixture:p1');
  assert.equal(manifest.counts.expected, 2);
  assert.equal(manifest.counts.downloaded, 2);
  assert.equal(manifest.counts.failed, 0);
  assert.equal(manifest.files.length, 3);
  const muxFile = manifest.files.find((entry) => entry.derived === true);
  assert.equal(Boolean(muxFile), true);
  assert.equal(muxFile.resourceId, 'mux:bilibili:BV1muxFixture:p1');
  assert.equal(muxFile.groupId, 'bilibili:BV1muxFixture:p1');
  assert.equal(await readFile(muxFile.filePath, 'utf8'), 'video stream+audio stream');

  const artifacts = await assertDownloadRunArtifactBundle(manifest);
  assert.equal(artifacts.queue.length, 2);
  assert.equal(artifacts.downloads.length, 3);
  assert.equal(artifacts.downloads[2].derived, true);
});

test('download executor reports incomplete mux groups as derived failures', async (t) => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-executor-mux-missing-'));
  t.after(() => rm(runRoot, { recursive: true, force: true }));

  const plan = normalizeDownloadTaskPlan({
    siteKey: 'bilibili',
    host: 'www.bilibili.com',
    taskType: 'video',
    source: { input: 'https://www.bilibili.com/video/BV1muxMissing/' },
    policy: { dryRun: false, concurrency: 1, retries: 0, retryBackoffMs: 0 },
    output: { root: runRoot },
  });
  const manifest = await executeResolvedDownloadTask({
    planId: plan.id,
    siteKey: 'bilibili',
    taskType: 'video',
    resources: [{
      id: 'dash-video-only',
      url: 'https://upos.example.test/mux/video-only.m4s',
      fileName: 'dash-video-only.m4s',
      mediaType: 'video',
      groupId: 'bilibili:BV1muxMissing:p1',
      metadata: {
        muxRole: 'video',
        muxKind: 'dash-audio-video',
      },
    }],
  }, plan, null, {
    runRoot,
    dryRun: false,
    enableDerivedMux: true,
  }, {
    fetchImpl: async () => ({
      ok: true,
      async arrayBuffer() {
        return Buffer.from('video stream').buffer;
      },
    }),
  });

  assert.equal(manifest.status, 'partial');
  assert.equal(manifest.counts.downloaded, 1);
  assert.equal(manifest.counts.failed, 1);
  assert.equal(manifest.failedResources[0].resourceId, 'mux:bilibili:BV1muxMissing:p1');
  assert.equal(manifest.failedResources[0].reason, 'mux-missing-audio');
  assert.equal(manifest.failedResources[0].derived, true);
  const report = await readFile(manifest.artifacts.reportMarkdown, 'utf8');
  assert.match(report, /Derived Mux Diagnostics/u);
  assert.match(report, /mux-missing-audio/u);
});

test('download executor treats retries zero as a single attempt', async (t) => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-retries-zero-'));
  t.after(() => rm(runRoot, { recursive: true, force: true }));

  const plan = normalizeDownloadTaskPlan({
    siteKey: 'example',
    host: 'example.com',
    taskType: 'generic-resource',
    source: { input: 'https://example.com/fails.txt' },
    policy: { dryRun: false, retries: 0, retryBackoffMs: 0 },
    output: { root: runRoot },
  });
  let calls = 0;
  const manifest = await executeResolvedDownloadTask({
    planId: plan.id,
    siteKey: plan.siteKey,
    taskType: plan.taskType,
    resources: [{
      id: 'resource-1',
      url: 'https://example.com/fails.txt',
      fileName: 'fails.txt',
      mediaType: 'text',
    }],
  }, plan, null, {
    workspaceRoot: REPO_ROOT,
    runRoot,
    dryRun: false,
  }, {
    fetchImpl: async () => {
      calls += 1;
      return {
        ok: false,
        status: 500,
      };
    },
  });

  assert.equal(calls, 1);
  assert.equal(manifest.status, 'failed');
  assert.equal(manifest.failedResources[0].reason, 'http-500');
  assert.equal(manifest.resumeCommand.includes('--resume'), true);
  assert.doesNotThrow(() => parseArgs([
    '--site',
    manifest.siteKey,
    '--input',
    plan.source.input,
    '--execute',
    '--run-dir',
    path.dirname(manifest.artifacts.manifest),
    '--resume',
  ]));
});

test('download executor retries failed resources when configured', async (t) => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-retries-one-'));
  t.after(() => rm(runRoot, { recursive: true, force: true }));

  const plan = normalizeDownloadTaskPlan({
    siteKey: 'example',
    host: 'example.com',
    taskType: 'generic-resource',
    source: { input: 'https://example.com/retry.txt' },
    policy: { dryRun: false, retries: 1, retryBackoffMs: 0 },
    output: { root: runRoot },
  });
  const payload = Buffer.from('retry body', 'utf8');
  let calls = 0;
  const manifest = await executeResolvedDownloadTask({
    planId: plan.id,
    siteKey: plan.siteKey,
    taskType: plan.taskType,
    resources: [{
      id: 'resource-1',
      url: 'https://example.com/retry.txt',
      fileName: 'retry.txt',
      mediaType: 'text',
    }],
  }, plan, null, {
    workspaceRoot: REPO_ROOT,
    runRoot,
    dryRun: false,
  }, {
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) {
        return {
          ok: false,
          status: 500,
        };
      }
      return {
        ok: true,
        status: 200,
        async arrayBuffer() {
          return payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength);
        },
      };
    },
  });

  assert.equal(calls, 2);
  assert.equal(manifest.status, 'passed');
  assert.equal(await readFile(manifest.files[0].filePath, 'utf8'), 'retry body');
});

test('download executor resumes fixed run directories and retries incomplete resources', async (t) => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-resume-run-'));
  t.after(() => rm(runDir, { recursive: true, force: true }));

  const plan = normalizeDownloadTaskPlan({
    siteKey: 'example',
    host: 'example.com',
    taskType: 'generic-resource',
    source: { input: 'https://example.com/resume' },
    policy: { dryRun: false, retries: 0, retryBackoffMs: 0 },
    output: { runDir },
  });
  const resolvedTask = {
    planId: plan.id,
    siteKey: plan.siteKey,
    taskType: plan.taskType,
    resources: [
      {
        id: 'done',
        url: 'https://example.com/done.txt',
        fileName: 'done.txt',
        mediaType: 'text',
      },
      {
        id: 'failed',
        url: 'https://example.com/failed.txt',
        fileName: 'failed.txt',
        mediaType: 'text',
      },
    ],
  };

  let firstRunCalls = 0;
  const firstManifest = await executeResolvedDownloadTask(resolvedTask, plan, null, {
    workspaceRoot: REPO_ROOT,
    runDir,
    dryRun: false,
  }, {
    fetchImpl: async (url) => {
      firstRunCalls += 1;
      if (String(url).includes('failed')) {
        return { ok: false, status: 500 };
      }
      const payload = Buffer.from('already downloaded', 'utf8');
      return {
        ok: true,
        status: 200,
        async arrayBuffer() {
          return payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength);
        },
      };
    },
  });
  assert.equal(firstRunCalls, 2);
  assert.equal(firstManifest.status, 'partial');

  const secondRunUrls = [];
  const secondManifest = await executeResolvedDownloadTask(resolvedTask, plan, null, {
    workspaceRoot: REPO_ROOT,
    runDir,
    dryRun: false,
    resume: true,
  }, {
    fetchImpl: async (url) => {
      secondRunUrls.push(String(url));
      if (String(url).includes('done')) {
        throw new Error('completed resource should be skipped during resume');
      }
      const payload = Buffer.from('retried body', 'utf8');
      return {
        ok: true,
        status: 200,
        async arrayBuffer() {
          return payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength);
        },
      };
    },
  });

  assert.deepEqual(secondRunUrls, ['https://example.com/failed.txt']);
  assert.equal(secondManifest.status, 'passed');
  assert.equal(secondManifest.counts.downloaded, 1);
  assert.equal(secondManifest.counts.skipped, 1);
  assert.equal(secondManifest.files.find((entry) => entry.resourceId === 'done').skipped, true);
  assert.equal(await readFile(secondManifest.files.find((entry) => entry.resourceId === 'failed').filePath, 'utf8'), 'retried body');
});

test('download executor reports manifest queue mismatch as a stable recovery reason', async (t) => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-recovery-mismatch-'));
  t.after(() => rm(runDir, { recursive: true, force: true }));

  const plan = normalizeDownloadTaskPlan({
    siteKey: 'example',
    host: 'example.com',
    taskType: 'generic-resource',
    source: { input: 'https://example.com/recovery-mismatch' },
    policy: { dryRun: false, retries: 0, retryBackoffMs: 0 },
    output: { runDir },
  });
  const resolvedTask = {
    planId: plan.id,
    siteKey: plan.siteKey,
    taskType: plan.taskType,
    resources: [
      {
        id: 'one',
        url: 'https://example.com/one.txt',
        fileName: 'one.txt',
        mediaType: 'text',
      },
      {
        id: 'two',
        url: 'https://example.com/two.txt',
        fileName: 'two.txt',
        mediaType: 'text',
      },
    ],
  };

  await writeJsonFile(path.join(runDir, 'manifest.json'), {
    runId: 'old-run',
    planId: plan.id,
    siteKey: plan.siteKey,
    status: 'partial',
    counts: {
      expected: 2,
      attempted: 1,
      downloaded: 0,
      skipped: 0,
      failed: 1,
    },
    files: [],
    failedResources: [],
  });
  await writeJsonFile(path.join(runDir, 'queue.json'), [{
    id: 'one',
    status: 'failed',
    url: 'https://example.com/one.txt',
    filePath: path.join(runDir, 'files', '0001-one.txt'),
  }]);
  await writeFile(path.join(runDir, 'downloads.jsonl'), '', 'utf8');

  const manifest = await executeResolvedDownloadTask(resolvedTask, plan, null, {
    workspaceRoot: REPO_ROOT,
    runDir,
    dryRun: false,
    retryFailedOnly: true,
  }, {
    fetchImpl: async () => {
      throw new Error('recovery mismatch should not fetch resources');
    },
  });

  assert.equal(manifest.status, 'failed');
  assert.equal(manifest.reason, 'manifest-queue-count-mismatch');
  assert.equal(manifest.counts.failed, 2);
  assert.equal(manifest.failedResources[0].reason, 'manifest-queue-count-mismatch');
  assert.match(await readFile(manifest.artifacts.reportMarkdown, 'utf8'), /manifest-queue-count-mismatch/u);
});

test('download executor retry-failed without failed queue entries skips and reuses successes', async (t) => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-retry-none-'));
  t.after(() => rm(runDir, { recursive: true, force: true }));

  const filesDir = path.join(runDir, 'files');
  await mkdir(filesDir, { recursive: true });
  const filePath = path.join(filesDir, '0001-done.txt');
  await writeFile(filePath, 'already done', 'utf8');

  const plan = normalizeDownloadTaskPlan({
    siteKey: 'example',
    host: 'example.com',
    taskType: 'generic-resource',
    source: { input: 'https://example.com/retry-none' },
    policy: { dryRun: false, retries: 0, retryBackoffMs: 0 },
    output: { runDir },
  });
  const resolvedTask = {
    planId: plan.id,
    siteKey: plan.siteKey,
    taskType: plan.taskType,
    resources: [{
      id: 'done',
      url: 'https://example.com/done.txt',
      fileName: 'done.txt',
      mediaType: 'text',
    }],
  };
  await writeJsonFile(path.join(runDir, 'manifest.json'), {
    runId: 'old-run',
    planId: plan.id,
    siteKey: plan.siteKey,
    status: 'passed',
    counts: {
      expected: 1,
      attempted: 1,
      downloaded: 1,
      skipped: 0,
      failed: 0,
    },
    files: [{
      resourceId: 'done',
      url: 'https://example.com/done.txt',
      filePath,
      bytes: 'already done'.length,
      mediaType: 'text',
      skipped: false,
    }],
    failedResources: [],
  });
  await writeJsonFile(path.join(runDir, 'queue.json'), [{
    id: 'done',
    status: 'downloaded',
    url: 'https://example.com/done.txt',
    filePath,
    bytes: 'already done'.length,
    mediaType: 'text',
  }]);
  await writeFile(path.join(runDir, 'downloads.jsonl'), `${JSON.stringify({
    ok: true,
    resourceId: 'done',
    url: 'https://example.com/done.txt',
    filePath,
    bytes: 'already done'.length,
    mediaType: 'text',
  })}\n`, 'utf8');

  const manifest = await executeResolvedDownloadTask(resolvedTask, plan, null, {
    workspaceRoot: REPO_ROOT,
    runDir,
    dryRun: false,
    retryFailedOnly: true,
  }, {
    fetchImpl: async () => {
      throw new Error('retry-failed with no failures should not fetch');
    },
  });

  assert.equal(manifest.status, 'skipped');
  assert.equal(manifest.reason, 'retry-failed-none');
  assert.equal(manifest.counts.skipped, 1);
  assert.equal(manifest.files.length, 1);
  assert.equal(manifest.files[0].resourceId, 'done');
  assert.equal(manifest.files[0].skipped, true);
});

test('download executor report includes next recovery commands and artifact paths', async (t) => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-report-commands-'));
  t.after(() => rm(runRoot, { recursive: true, force: true }));

  const plan = normalizeDownloadTaskPlan({
    siteKey: 'example',
    host: 'example.com',
    taskType: 'generic-resource',
    source: { input: 'https://example.com/report.txt' },
    policy: { dryRun: false, retries: 0, retryBackoffMs: 0 },
    output: { root: runRoot },
  });
  const manifest = await executeResolvedDownloadTask({
    planId: plan.id,
    siteKey: plan.siteKey,
    taskType: plan.taskType,
    resources: [{
      id: 'report',
      url: 'https://example.com/report.txt',
      fileName: 'report.txt',
      mediaType: 'text',
    }],
  }, plan, null, {
    workspaceRoot: REPO_ROOT,
    runRoot,
    dryRun: false,
  }, {
    fetchImpl: async () => ({
      ok: false,
      status: 503,
    }),
  });

  const report = await readFile(manifest.artifacts.reportMarkdown, 'utf8');
  assert.equal(manifest.status, 'failed');
  assert.equal(manifest.resumeCommand.includes('--resume'), true);
  assert.match(report, /Status explanation:/u);
  assert.match(report, /Next resume command: .*--resume/u);
  assert.match(report, /Next retry-failed command: .*--retry-failed/u);
  assert.match(report, new RegExp(`Manifest: ${manifest.artifacts.manifest.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}`, 'u'));
  assert.match(report, new RegExp(`Queue: ${manifest.artifacts.queue.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}`, 'u'));
  assert.match(report, new RegExp(`Downloads JSONL: ${manifest.artifacts.downloadsJsonl.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}`, 'u'));
});

test('download executor retry-failed only reattempts previous failures', async (t) => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-retry-failed-run-'));
  t.after(() => rm(runDir, { recursive: true, force: true }));

  const plan = normalizeDownloadTaskPlan({
    siteKey: 'example',
    host: 'example.com',
    taskType: 'generic-resource',
    source: { input: 'https://example.com/retry-failed' },
    policy: { dryRun: false, retries: 0, retryBackoffMs: 0 },
    output: { runDir },
  });
  const resolvedTask = {
    planId: plan.id,
    siteKey: plan.siteKey,
    taskType: plan.taskType,
    resources: [
      {
        id: 'pending',
        url: 'https://example.com/pending.txt',
        fileName: 'pending.txt',
        mediaType: 'text',
      },
      {
        id: 'failed',
        url: 'https://example.com/failed.txt',
        fileName: 'failed.txt',
        mediaType: 'text',
      },
    ],
  };

  await executeResolvedDownloadTask(resolvedTask, plan, null, {
    workspaceRoot: REPO_ROOT,
    runDir,
    dryRun: false,
  }, {
    fetchImpl: async (url) => {
      if (String(url).includes('failed')) {
        return { ok: false, status: 500 };
      }
      const payload = Buffer.from('already successful', 'utf8');
      return {
        ok: true,
        status: 200,
        async arrayBuffer() {
          return payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength);
        },
      };
    },
  });

  const retriedUrls = [];
  const retryManifest = await executeResolvedDownloadTask(resolvedTask, plan, null, {
    workspaceRoot: REPO_ROOT,
    runDir,
    dryRun: false,
    retryFailedOnly: true,
  }, {
    fetchImpl: async (url) => {
      retriedUrls.push(String(url));
      if (String(url).includes('pending')) {
        throw new Error('successful resources should be reused, not retried');
      }
      const payload = Buffer.from('retry failed only', 'utf8');
      return {
        ok: true,
        status: 200,
        async arrayBuffer() {
          return payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength);
        },
      };
    },
  });

  assert.deepEqual(retriedUrls, ['https://example.com/failed.txt']);
  assert.equal(retryManifest.status, 'passed');
  assert.equal(retryManifest.counts.downloaded, 1);
  assert.equal(retryManifest.counts.skipped, 1);
  assert.equal(retryManifest.files.find((entry) => entry.resourceId === 'pending').skipped, true);
});

test('download executor retry-failed recognizes media queue state', async (t) => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-media-queue-retry-'));
  t.after(() => rm(runDir, { recursive: true, force: true }));

  const mediaDir = path.join(runDir, 'media');
  await mkdir(mediaDir, { recursive: true });
  const donePath = path.join(mediaDir, 'done.jpg');
  await writeFile(donePath, 'done-media', 'utf8');

  const plan = normalizeDownloadTaskPlan({
    siteKey: 'x',
    host: 'x.com',
    taskType: 'media-bundle',
    source: { input: 'https://x.com/openai/status/1' },
    policy: { dryRun: false, retries: 0, retryBackoffMs: 0 },
    output: { runDir },
  });
  const resolvedTask = {
    planId: plan.id,
    siteKey: plan.siteKey,
    taskType: plan.taskType,
    resources: [
      {
        id: 'done-media',
        url: 'https://pbs.twimg.com/media/done.jpg',
        fileName: 'done.jpg',
        mediaType: 'image',
      },
      {
        id: 'failed-media',
        url: 'https://pbs.twimg.com/media/failed.jpg',
        fileName: 'failed.jpg',
        mediaType: 'image',
      },
    ],
  };

  await writeJsonFile(path.join(runDir, 'media-queue.json'), {
    schemaVersion: 1,
    queue: [
      {
        key: 'image:https://pbs.twimg.com/media/done.jpg',
        status: 'done',
        url: 'https://pbs.twimg.com/media/done.jpg',
        type: 'image',
        result: {
          ok: true,
          url: 'https://pbs.twimg.com/media/done.jpg',
          filePath: donePath,
          bytes: 'done-media'.length,
          type: 'image',
        },
      },
      {
        key: 'image:https://pbs.twimg.com/media/failed.jpg',
        status: 'failed',
        url: 'https://pbs.twimg.com/media/failed.jpg',
        type: 'image',
        result: {
          ok: false,
          url: 'https://pbs.twimg.com/media/failed.jpg',
          reason: 'http-503',
        },
      },
    ],
  });

  const retriedUrls = [];
  const manifest = await executeResolvedDownloadTask(resolvedTask, plan, null, {
    workspaceRoot: REPO_ROOT,
    runDir,
    dryRun: false,
    retryFailedOnly: true,
  }, {
    fetchImpl: async (url) => {
      retriedUrls.push(String(url));
      if (String(url).includes('done.jpg')) {
        throw new Error('completed media should be reused from media-queue.json');
      }
      const payload = Buffer.from('retried-media', 'utf8');
      return {
        ok: true,
        status: 200,
        async arrayBuffer() {
          return payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength);
        },
      };
    },
  });

  assert.deepEqual(retriedUrls, ['https://pbs.twimg.com/media/failed.jpg']);
  assert.equal(manifest.status, 'passed');
  assert.equal(manifest.counts.downloaded, 1);
  assert.equal(manifest.counts.skipped, 1);
  assert.equal(manifest.files.find((entry) => entry.resourceId === 'done-media').skipped, true);
});

test('legacy executor returns stable recovery reason for missing source media queue', async (t) => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-legacy-source-missing-'));
  t.after(() => rm(runDir, { recursive: true, force: true }));

  const sourceRunDir = path.join(runDir, 'source-action-run');
  const missingMediaQueue = path.join(sourceRunDir, 'media-queue.json');
  await writeJsonFile(path.join(runDir, 'manifest.json'), {
    runId: 'old-legacy-run',
    planId: 'old-plan',
    siteKey: 'x',
    status: 'partial',
    counts: {
      expected: 1,
      attempted: 1,
      downloaded: 0,
      skipped: 0,
      failed: 1,
    },
    files: [],
    failedResources: [],
    artifacts: {
      source: {
        runDir: sourceRunDir,
        mediaQueue: missingMediaQueue,
      },
    },
  });

  const plan = normalizeDownloadTaskPlan({
    siteKey: 'x',
    host: 'x.com',
    taskType: 'social-archive',
    source: { input: 'openai' },
    policy: { dryRun: false },
    output: { runDir },
    legacy: {
      entrypoint: 'src/entrypoints/sites/x-action.mjs',
      executorKind: 'node',
    },
  });
  let spawned = false;
  const manifest = await executeLegacyDownloadTask(plan, null, {
    input: 'openai',
    retryFailedOnly: true,
  }, {
    workspaceRoot: REPO_ROOT,
    runDir,
    retryFailedOnly: true,
  }, {
    spawnJsonCommand: async () => {
      spawned = true;
      throw new Error('legacy command should not spawn when source recovery artifacts are missing');
    },
  });

  assert.equal(spawned, false);
  assert.equal(manifest.status, 'failed');
  assert.equal(manifest.reason, 'source-media-queue-missing');
  assert.equal(manifest.legacy.recovery.problems[0].reason, 'source-media-queue-missing');
});

test('download recovery reports missing and corrupt artifacts without fetching', async (t) => {
  const missingRunDir = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-recovery-missing-'));
  const corruptRunDir = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-recovery-corrupt-'));
  t.after(async () => {
    await rm(missingRunDir, { recursive: true, force: true });
    await rm(corruptRunDir, { recursive: true, force: true });
  });

  const missingPlan = normalizeDownloadTaskPlan({
    siteKey: 'example',
    host: 'example.com',
    taskType: 'generic-resource',
    source: { input: 'https://example.com/missing-state' },
    policy: { dryRun: false, retries: 0, retryBackoffMs: 0 },
    output: { runDir: missingRunDir },
  });
  const resolvedTask = {
    planId: missingPlan.id,
    siteKey: missingPlan.siteKey,
    taskType: missingPlan.taskType,
    resources: [{
      id: 'resource-1',
      url: 'https://example.com/resource-1.txt',
      fileName: 'resource-1.txt',
      mediaType: 'text',
    }],
  };

  const missingManifest = await executeResolvedDownloadTask(resolvedTask, missingPlan, null, {
    workspaceRoot: REPO_ROOT,
    runDir: missingRunDir,
    dryRun: false,
    retryFailedOnly: true,
  }, {
    fetchImpl: async () => {
      throw new Error('missing retry state should not fetch');
    },
  });
  assert.equal(missingManifest.status, 'skipped');
  assert.equal(missingManifest.reason, 'retry-state-missing');

  const corruptPlan = normalizeDownloadTaskPlan({
    ...missingPlan,
    output: { runDir: corruptRunDir },
  });
  await writeFile(path.join(corruptRunDir, 'media-queue.json'), '{not json', 'utf8');
  const corruptManifest = await executeResolvedDownloadTask({
    ...resolvedTask,
    planId: corruptPlan.id,
  }, corruptPlan, null, {
    workspaceRoot: REPO_ROOT,
    runDir: corruptRunDir,
    dryRun: false,
    retryFailedOnly: true,
  }, {
    fetchImpl: async () => {
      throw new Error('corrupt retry state should not fetch');
    },
  });
  assert.equal(corruptManifest.status, 'failed');
  assert.equal(corruptManifest.reason, 'media-queue-invalid-json');
});

test('download executor stays independent from concrete site routers', async () => {
  const source = await readFile(path.join(REPO_ROOT, 'src', 'sites', 'downloads', 'executor.mjs'), 'utf8');
  assert.equal(/src\/sites\/(?:bilibili|douyin|xiaohongshu|social)\//u.test(source), false);
  assert.equal(/\\.\\.\/(?:bilibili|douyin|xiaohongshu|social)\//u.test(source), false);
});
