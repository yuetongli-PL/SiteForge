import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';

import {
  acquireSessionLease,
  appendRiskLedgerEvent,
  classifyRiskFromContext,
  clearProfileQuarantine,
  collectNetworkIdentityFingerprint,
  compareNetworkIdentityFingerprints,
  evaluateSessionPolicy,
  finalizeSiteSessionGovernance,
  prepareSiteSessionGovernance,
  readAuthSessionState,
  readHealthyNetworkFingerprint,
  readProfileQuarantine,
  releaseSessionLease,
  resolveAuthSessionPolicy,
  summarizeAuthSessionState,
  writeHealthyNetworkFingerprint,
  writeProfileQuarantine,
} from '../../src/infra/auth/site-session-governance.mjs';
import {
  inspectSessionHealth as inspectDownloadSessionHealth,
} from '../../src/sites/downloads/session-manager.mjs';

test('resolveAuthSessionPolicy applies keepalive and stable-network defaults', () => {
  const policy = resolveAuthSessionPolicy({
    loginUrl: 'https://www.douyin.com/',
    verificationUrl: 'https://www.douyin.com/user/self?showTab=like',
    keepaliveIntervalMinutes: 240,
    cooldownMinutesAfterRisk: 180,
    preferVisibleBrowserForAuthenticatedFlows: true,
    requireStableNetworkForAuthenticatedFlows: true,
  });

  assert.equal(policy.keepaliveUrl, 'https://www.douyin.com/user/self?showTab=like');
  assert.equal(policy.keepaliveIntervalMinutes, 240);
  assert.equal(policy.cooldownMinutesAfterRisk, 180);
  assert.equal(policy.preferVisibleBrowserForAuthenticatedFlows, true);
  assert.equal(policy.requireStableNetworkForAuthenticatedFlows, true);
});

test('collectNetworkIdentityFingerprint builds a stable fingerprint from public and interface data', async () => {
  const fingerprint = await collectNetworkIdentityFingerprint({
    forceRefresh: true,
  }, {
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return {
          ip: '203.0.113.25',
          connection: {
            asn: 'AS9808',
            org: 'China Mobile',
          },
        };
      },
    }),
    networkInterfaces: () => ({
      Ethernet: [
        {
          family: 'IPv4',
          cidr: '192.168.1.4/24',
          mac: '00:11:22:33:44:55',
          internal: false,
        },
      ],
    }),
  });

  assert.equal(fingerprint.publicIp, '203.0.113.25');
  assert.equal(fingerprint.asn, 'AS9808');
  assert.equal(fingerprint.org, 'China Mobile');
  assert.ok(typeof fingerprint.fingerprint === 'string' && fingerprint.fingerprint.length > 10);
  assert.equal(Array.isArray(fingerprint.interfaceSummary), true);
  assert.equal(fingerprint.interfaceSummary.length, 1);
});

test('compareNetworkIdentityFingerprints detects public-ip drift', () => {
  const comparison = compareNetworkIdentityFingerprints(
    {
      fingerprint: 'a',
      publicIp: '203.0.113.25',
      asn: 'AS9808',
      interfaceSummary: [],
    },
    {
      fingerprint: 'b',
      publicIp: '203.0.113.26',
      asn: 'AS9808',
      interfaceSummary: [],
    },
  );

  assert.equal(comparison.driftDetected, true);
  assert.deepEqual(comparison.reasons, ['public-ip-changed']);
});

test('session leases are reentrant in-process and block concurrent external holders', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-session-lease-'));
  try {
    const first = await acquireSessionLease(workspace, { command: 'capture' });
    assert.equal(first.acquired, true);

    const second = await acquireSessionLease(workspace, { command: 'expand' });
    assert.equal(second.acquired, true);
    assert.equal(second.reason, 'reentrant');

    await releaseSessionLease(second.lease);
    await releaseSessionLease(first.lease);

    const blocked = await acquireSessionLease(workspace, { command: 'doctor' });
    assert.equal(blocked.acquired, true);
    await releaseSessionLease(blocked.lease);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('acquireSessionLease waits for the profile lease to clear when waitForAvailabilityMs is set', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-session-lease-wait-'));
  try {
    const leaseFile = path.join(workspace, '.bws', 'session-lease.json');
    await mkdir(path.dirname(leaseFile), { recursive: true });
    await writeFile(leaseFile, JSON.stringify({
      leaseId: 'external-lease',
      userDataDir: workspace,
      pid: process.pid,
      createdAt: new Date().toISOString(),
      command: 'external-holder',
    }), 'utf8');
    const releasePromise = new Promise((resolve) => {
      setTimeout(async () => {
        await rm(leaseFile, { force: true });
        resolve();
      }, 120);
    });

    const second = await acquireSessionLease(workspace, {
      command: 'expand',
      waitForAvailabilityMs: 1_000,
      pollIntervalMs: 25,
    });
    await releasePromise;

    assert.equal(second.acquired, true);
    assert.equal(second.reason, 'acquired-after-wait');
    assert.ok(Number(second.waitedMs) >= 100);
    await releaseSessionLease(second.lease);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('healthy network fingerprint and quarantine state persist under the profile runtime directory', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-session-state-'));
  try {
    await writeHealthyNetworkFingerprint(workspace, {
      fingerprint: 'stable-fp',
      publicIp: '203.0.113.25',
    });
    const stored = await readHealthyNetworkFingerprint(workspace);
    assert.equal(stored?.fingerprint, 'stable-fp');

    const quarantine = await writeProfileQuarantine(workspace, {
      riskCauseCode: 'browser-fingerprint-risk',
      riskAction: 'cooldown-and-retry-later',
      antiCrawlSignals: ['verify'],
      cooldownMinutes: 5,
    });
    assert.equal(quarantine.riskCauseCode, 'browser-fingerprint-risk');
    assert.equal((await readProfileQuarantine(workspace))?.riskAction, 'cooldown-and-retry-later');

    await clearProfileQuarantine(workspace);
    assert.equal(await readProfileQuarantine(workspace), null);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('classifyRiskFromContext maps anti-crawl and network drift to the new risk cause codes', () => {
  assert.deepEqual(
    classifyRiskFromContext({
      antiCrawlSignals: ['verify', 'captcha'],
      authRequired: true,
      identityConfirmed: false,
      loginStateDetected: false,
    }),
    {
      riskCauseCode: 'session-invalid',
      riskAction: 'run-keepalive-or-auto-login',
    },
  );

  assert.deepEqual(
    classifyRiskFromContext({
      antiCrawlSignals: ['rate-limit'],
    }),
    {
      riskCauseCode: 'request-burst',
      riskAction: 'cooldown-and-retry-later',
    },
  );

  assert.deepEqual(
    classifyRiskFromContext({
      networkDrift: {
        driftDetected: true,
        reasons: ['public-ip-changed'],
      },
    }),
    {
      riskCauseCode: 'network-identity-drift',
      riskAction: 'run-keepalive-before-auth',
    },
  );
});

test('evaluateSessionPolicy blocks pipeline on drift but still allows keepalive', () => {
  const authConfig = {
    verificationUrl: 'https://www.douyin.com/user/self?showTab=like',
    requireStableNetworkForAuthenticatedFlows: true,
  };
  const networkFingerprint = {
    fingerprint: 'network-a',
  };
  const networkDrift = {
    driftDetected: true,
    reasons: ['public-ip-changed'],
  };

  const pipelineDecision = evaluateSessionPolicy({
    operation: 'pipeline',
    authConfig,
    networkFingerprint,
    networkDrift,
  });
  assert.equal(pipelineDecision.allowed, false);
  assert.equal(pipelineDecision.riskCauseCode, 'network-identity-drift');
  assert.equal(pipelineDecision.riskAction, 'run-keepalive-before-auth');

  const keepaliveDecision = evaluateSessionPolicy({
    operation: 'site-keepalive',
    authConfig,
    networkFingerprint,
    networkDrift,
  });
  assert.equal(keepaliveDecision.allowed, true);
  assert.equal(keepaliveDecision.riskAction, 'keepalive-only');
});

test('download session preflight maps governance risk to a sanitized quarantine lease', async (t) => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-governance-risk-'));
  t.after(() => rm(workspace, { recursive: true, force: true }));

  const released = [];
  const health = await inspectDownloadSessionHealth('x', {
    host: 'x.com',
    userDataDir: workspace,
    sessionRequirement: 'required',
    profile: {
      host: 'x.com',
      authSession: {
        loginUrl: 'https://x.com/i/flow/login',
        verificationUrl: 'https://x.com/home',
        reuseLoginStateByDefault: true,
      },
    },
  }, {
    inspectReusableSiteSession: async () => ({
      authAvailable: true,
      reusableProfile: true,
      reuseLoginState: true,
      userDataDir: workspace,
      profileHealth: {
        exists: true,
        healthy: true,
        warnings: [],
      },
      authConfig: {
        requireStableNetworkForAuthenticatedFlows: true,
      },
      sessionOptions: {
        authConfig: {
          requireStableNetworkForAuthenticatedFlows: true,
        },
        reuseLoginState: true,
        userDataDir: workspace,
      },
    }),
    prepareSiteSessionGovernance: async (_inputUrl, authContext, _settings, options) => {
      assert.equal(authContext.userDataDir, workspace);
      assert.equal(options.networkOptions.disableExternalLookup, true);
      return {
        lease: {
          leaseId: 'risk-preflight-lease',
          userDataDir: workspace,
        },
        policyDecision: {
          allowed: false,
          riskCauseCode: 'network-identity-drift',
          riskAction: 'run-keepalive-before-auth',
          profileQuarantined: false,
          driftReasons: ['public-ip-changed'],
        },
        networkDrift: {
          driftDetected: true,
          reasons: ['public-ip-changed'],
        },
      };
    },
    releaseGovernanceSessionLease: async (lease) => {
      released.push(lease.leaseId);
    },
  });

  assert.equal(health.status, 'quarantine');
  assert.equal(health.reason, 'network-identity-drift');
  assert.deepEqual(health.riskSignals, [
    'network-identity-drift',
    'run-keepalive-before-auth',
    'public-ip-changed',
  ]);
  assert.equal(health.userDataDir, undefined);
  assert.equal(health.headers, undefined);
  assert.equal(health.cookies, undefined);
  assert.deepEqual(released, ['risk-preflight-lease']);
});

test('appendRiskLedgerEvent writes structured entries without throwing', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-risk-ledger-'));
  try {
    const filePath = await appendRiskLedgerEvent(workspace, {
      riskCauseCode: 'request-burst',
      riskAction: 'cooldown-and-retry-later',
      antiCrawlSignals: ['rate-limit'],
    });
    assert.match(filePath, /\.bws[\\\/]risk-ledger\.jsonl$/u);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('finalizeSiteSessionGovernance persists auth session state and exposes a session summary', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-auth-session-state-'));
  try {
    const governance = await prepareSiteSessionGovernance(
      'https://www.douyin.com/',
      {
        authConfig: {
          loginUrl: 'https://www.douyin.com/',
          postLoginUrl: 'https://www.douyin.com/',
          verificationUrl: 'https://www.douyin.com/user/self?showTab=like',
          keepaliveUrl: 'https://www.douyin.com/user/self?showTab=like',
          keepaliveIntervalMinutes: 120,
          cooldownMinutesAfterRisk: 120,
          requireStableNetworkForAuthenticatedFlows: true,
        },
        userDataDir: workspace,
      },
      {
        reuseLoginState: true,
        userDataDir: workspace,
      },
      {
        operation: 'site-keepalive',
        now: new Date('2026-04-18T14:27:48.215Z'),
        networkOptions: {
          disableExternalLookup: true,
        },
      },
    );

    const summary = await finalizeSiteSessionGovernance(governance, {
      authRequired: true,
      authAvailable: true,
      identityConfirmed: true,
      loginStateDetected: true,
      persistedHealthySession: true,
      sessionReuseVerified: true,
      warmupSummary: {
        attempted: true,
        completed: true,
        urls: [
          'https://www.douyin.com/',
          'https://www.douyin.com/user/self?showTab=like',
        ],
      },
    }, {
      now: new Date('2026-04-18T14:27:48.215Z'),
    });

    const persistedState = await readAuthSessionState(workspace);
    assert.equal(persistedState?.lastHealthyAt, '2026-04-18T14:27:48.215Z');
    assert.equal(persistedState?.lastKeepaliveAt, '2026-04-18T14:27:48.215Z');
    assert.equal(persistedState?.lastSessionReuseVerifiedAt, '2026-04-18T14:27:48.215Z');
    assert.deepEqual(persistedState?.lastWarmupUrls, [
      'https://www.douyin.com/',
      'https://www.douyin.com/user/self?showTab=like',
    ]);
    assert.equal(persistedState?.counts?.successfulKeepalives, 1);
    assert.equal(summary.authSessionStateSummary?.successfulKeepalives, 1);
    assert.equal(summary.authSessionStateSummary?.keepaliveDue, false);
    assert.equal(summary.authSessionStateSummary?.lastWarmupCompleted, true);

    const summarized = summarizeAuthSessionState(persistedState, {
      keepaliveUrl: 'https://www.douyin.com/user/self?showTab=like',
      keepaliveIntervalMinutes: 120,
    }, {
      now: new Date('2026-04-18T15:00:00.000Z'),
    });
    assert.equal(summarized.keepaliveDue, false);
    assert.equal(summarized.minutesSinceLastHealthy, 32);
    assert.equal(summarized.minutesUntilSuggestedKeepalive, 88);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('finalizeSiteSessionGovernance clears active quarantine after a healthy authenticated recovery', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-auth-session-recovery-'));
  try {
    await writeProfileQuarantine(workspace, {
      riskCauseCode: 'browser-fingerprint-risk',
      riskAction: 'use-visible-browser-warmup',
      antiCrawlSignals: ['verify'],
      cooldownMinutes: 180,
    }, {
      now: new Date('2026-04-23T15:56:24.006Z'),
    });

    const governance = await prepareSiteSessionGovernance(
      'https://www.xiaohongshu.com/notification',
      {
        authConfig: {
          loginUrl: 'https://www.xiaohongshu.com/login?redirectPath=https%3A%2F%2Fwww.xiaohongshu.com%2Fnotification',
          postLoginUrl: 'https://www.xiaohongshu.com/notification',
          verificationUrl: 'https://www.xiaohongshu.com/notification',
          keepaliveUrl: 'https://www.xiaohongshu.com/notification',
          keepaliveIntervalMinutes: 180,
          cooldownMinutesAfterRisk: 180,
          preferVisibleBrowserForAuthenticatedFlows: true,
          requireStableNetworkForAuthenticatedFlows: true,
        },
        userDataDir: workspace,
      },
      {
        reuseLoginState: true,
        userDataDir: workspace,
      },
      {
        operation: 'site-login',
        now: new Date('2026-04-23T16:05:00.000Z'),
        networkOptions: {
          disableExternalLookup: true,
        },
      },
    );

    assert.equal(governance.policyDecision.allowed, true);
    assert.equal(governance.policyDecision.profileQuarantined, true);

    const summary = await finalizeSiteSessionGovernance(governance, {
      authRequired: true,
      authAvailable: true,
      identityConfirmed: true,
      loginStateDetected: true,
      persistedHealthySession: true,
      sessionReuseVerified: true,
      warmupSummary: {
        attempted: false,
        completed: false,
        urls: [],
      },
    }, {
      now: new Date('2026-04-23T16:05:00.000Z'),
    });

    const persistedState = await readAuthSessionState(workspace);
    assert.equal(summary.riskCauseCode, null);
    assert.equal(summary.riskAction, null);
    assert.equal(summary.profileQuarantined, false);
    assert.equal(persistedState?.profileQuarantined, false);
    assert.equal(await readProfileQuarantine(workspace, {
      now: new Date('2026-04-23T16:05:00.000Z'),
    }), null);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
