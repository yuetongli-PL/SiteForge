import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';

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
  siteSessionGovernanceRedactionAuditPath,
  summarizeAuthSessionState,
  writeAuthSessionState,
  writeHealthyNetworkFingerprint,
  writeProfileQuarantine,
} from '../../src/infra/auth/site-session-governance.mjs';
import {
  buildSessionRepairPlan,
  inspectSessionHealth as inspectDownloadSessionHealth,
} from '../../src/domain/sessions/session-manager.mjs';
import { assertSchemaCompatible } from '../../src/domain/schemas/compatibility-registry.mjs';
import { requireReasonCodeDefinition } from '../../src/domain/risks/reason-codes.mjs';
import { RISK_STATE_SCHEMA_VERSION } from '../../src/domain/risks/risk-state.mjs';
import { REDACTION_PLACEHOLDER } from '../../src/domain/sessions/security-guard.mjs';

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

test('risk governance outputs consume the reasonCode catalog while preserving unknown legacy causes', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-risk-reason-codes-'));
  try {
    // @ts-ignore
    const requestBurst = requireReasonCodeDefinition('request-burst', { family: 'risk' }).code;
    // @ts-ignore
    const concurrentProfileUse = requireReasonCodeDefinition('concurrent-profile-use', { family: 'risk' }).code;
    // @ts-ignore
    const browserFingerprintRisk = requireReasonCodeDefinition('browser-fingerprint-risk', { family: 'risk' }).code;

    assert.equal(
      classifyRiskFromContext({ antiCrawlSignals: ['rate-limit'] }).riskCauseCode,
      requestBurst,
    );
    const concurrentDecision = evaluateSessionPolicy({
      operation: 'pipeline',
      concurrentProfileUse: true,
      networkFingerprint: 'synthetic-concurrent-network',
      now: new Date('2026-05-01T00:00:00+08:00'),
    });
    assert.equal(concurrentDecision.riskCauseCode, concurrentProfileUse);
    assert.equal(concurrentDecision.riskState.schemaVersion, RISK_STATE_SCHEMA_VERSION);
    assert.equal(concurrentDecision.riskState.state, 'cooldown');
    assert.equal(concurrentDecision.riskState.reasonCode, concurrentProfileUse);
    assert.equal(concurrentDecision.riskState.scope, 'profile');
    assert.equal(concurrentDecision.riskState.taskId, 'pipeline');
    assert.equal(concurrentDecision.riskState.transition.from, 'normal');
    assert.equal(concurrentDecision.riskState.transition.to, 'cooldown');
    assert.equal(concurrentDecision.riskState.transition.observedAt, '2026-04-30T16:00:00.000Z');
    // @ts-ignore
    const concurrentReason = requireReasonCodeDefinition('concurrent-profile-use', { family: 'risk' });
    assert.equal(concurrentDecision.riskState.recovery.retryable, concurrentReason.retryable);
    assert.equal(concurrentDecision.riskState.recovery.cooldownNeeded, concurrentReason.cooldownNeeded);
    assert.equal(concurrentDecision.riskState.recovery.isolationNeeded, concurrentReason.isolationNeeded);
    assert.equal(concurrentDecision.riskState.recovery.manualRecoveryNeeded, concurrentReason.manualRecoveryNeeded);
    assert.equal(concurrentDecision.riskState.recovery.artifactWriteAllowed, concurrentReason.artifactWriteAllowed);
    assert.equal(Object.hasOwn(concurrentDecision.riskState, 'profile'), false);
    assert.equal(Object.hasOwn(concurrentDecision.riskState, 'session'), false);
    assert.equal(Object.hasOwn(concurrentDecision.riskState, 'lease'), false);
    assert.equal(Object.hasOwn(concurrentDecision.riskState, 'networkFingerprint'), false);
    assert.equal(JSON.stringify(concurrentDecision.riskState).includes('synthetic-concurrent-network'), false);
    assert.equal(assertSchemaCompatible('RiskState', concurrentDecision.riskState), true);

    const quarantine = await writeProfileQuarantine(workspace, {
      riskCauseCode: 'browser-fingerprint-risk',
      riskAction: 'cooldown-and-retry-later',
      antiCrawlSignals: ['verify'],
      cooldownMinutes: 5,
    });
    assert.equal(quarantine.riskCauseCode, browserFingerprintRisk);
    const quarantineDecision = evaluateSessionPolicy({
      operation: 'pipeline',
      quarantine,
      networkFingerprint: 'synthetic-network-fingerprint',
      now: new Date('2026-05-01T00:00:00+08:00'),
    });
    assert.equal(quarantineDecision.allowed, false);
    assert.equal(quarantineDecision.riskCauseCode, browserFingerprintRisk);
    assert.equal(quarantineDecision.riskState.schemaVersion, RISK_STATE_SCHEMA_VERSION);
    assert.equal(quarantineDecision.riskState.state, 'isolated');
    assert.equal(quarantineDecision.riskState.reasonCode, browserFingerprintRisk);
    assert.equal(quarantineDecision.riskState.scope, 'profile');
    assert.equal(quarantineDecision.riskState.taskId, 'pipeline');
    assert.equal(quarantineDecision.riskState.transition.from, 'normal');
    assert.equal(quarantineDecision.riskState.transition.to, 'isolated');
    assert.equal(quarantineDecision.riskState.transition.observedAt, '2026-04-30T16:00:00.000Z');
    // @ts-ignore
    const browserFingerprintReason = requireReasonCodeDefinition('browser-fingerprint-risk', { family: 'risk' });
    assert.equal(quarantineDecision.riskState.recovery.retryable, browserFingerprintReason.retryable);
    assert.equal(quarantineDecision.riskState.recovery.cooldownNeeded, browserFingerprintReason.cooldownNeeded);
    assert.equal(quarantineDecision.riskState.recovery.isolationNeeded, browserFingerprintReason.isolationNeeded);
    assert.equal(quarantineDecision.riskState.recovery.manualRecoveryNeeded, browserFingerprintReason.manualRecoveryNeeded);
    assert.equal(quarantineDecision.riskState.recovery.artifactWriteAllowed, browserFingerprintReason.artifactWriteAllowed);
    assert.equal(Object.hasOwn(quarantineDecision.riskState, 'profile'), false);
    assert.equal(Object.hasOwn(quarantineDecision.riskState, 'session'), false);
    assert.equal(Object.hasOwn(quarantineDecision.riskState, 'networkFingerprint'), false);
    assert.equal(Object.hasOwn(quarantineDecision.riskState, 'quarantine'), false);
    assert.equal(Object.hasOwn(quarantineDecision.riskState, 'antiCrawlSignals'), false);
    assert.equal(JSON.stringify(quarantineDecision.riskState).includes('synthetic-network-fingerprint'), false);
    assert.equal(JSON.stringify(quarantineDecision.riskState).includes('verify'), false);
    assert.equal(assertSchemaCompatible('RiskState', quarantineDecision.riskState), true);

    const legacyQuarantine = await writeProfileQuarantine(workspace, {
      riskCauseCode: 'legacy-risk-provider-cause',
      riskAction: 'manual-investigation',
      antiCrawlSignals: ['legacy-signal'],
      cooldownMinutes: 5,
    });
    assert.equal(legacyQuarantine.riskCauseCode, 'legacy-risk-provider-cause');
    assert.equal(evaluateSessionPolicy({
      operation: 'pipeline',
      quarantine: legacyQuarantine,
      now: new Date('2026-05-01T00:00:00+08:00'),
    }).riskState, undefined);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
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
    now: new Date('2026-05-01T00:00:00+08:00'),
  });
  assert.equal(pipelineDecision.allowed, false);
  assert.equal(pipelineDecision.riskCauseCode, 'network-identity-drift');
  assert.equal(pipelineDecision.riskAction, 'run-keepalive-before-auth');
  assert.equal(pipelineDecision.riskState.schemaVersion, RISK_STATE_SCHEMA_VERSION);
  assert.equal(pipelineDecision.riskState.state, 'cooldown');
  assert.equal(pipelineDecision.riskState.reasonCode, 'network-identity-drift');
  assert.equal(pipelineDecision.riskState.scope, 'profile');
  assert.equal(pipelineDecision.riskState.taskId, 'pipeline');
  assert.equal(pipelineDecision.riskState.transition.from, 'normal');
  assert.equal(pipelineDecision.riskState.transition.to, 'cooldown');
  assert.equal(pipelineDecision.riskState.transition.observedAt, '2026-04-30T16:00:00.000Z');
  // @ts-ignore
  const networkDriftReason = requireReasonCodeDefinition('network-identity-drift', { family: 'risk' });
  assert.equal(pipelineDecision.riskState.recovery.retryable, networkDriftReason.retryable);
  assert.equal(pipelineDecision.riskState.recovery.cooldownNeeded, networkDriftReason.cooldownNeeded);
  assert.equal(pipelineDecision.riskState.recovery.isolationNeeded, networkDriftReason.isolationNeeded);
  assert.equal(pipelineDecision.riskState.recovery.manualRecoveryNeeded, networkDriftReason.manualRecoveryNeeded);
  assert.equal(pipelineDecision.riskState.recovery.artifactWriteAllowed, networkDriftReason.artifactWriteAllowed);
  assert.equal(Object.hasOwn(pipelineDecision.riskState, 'profile'), false);
  assert.equal(Object.hasOwn(pipelineDecision.riskState, 'session'), false);
  assert.equal(Object.hasOwn(pipelineDecision.riskState, 'networkFingerprint'), false);
  assert.equal(Object.hasOwn(pipelineDecision.riskState, 'networkDrift'), false);
  assert.equal(JSON.stringify(pipelineDecision.riskState).includes('network-a'), false);
  assert.equal(JSON.stringify(pipelineDecision.riskState).includes('public-ip-changed'), false);
  assert.equal(assertSchemaCompatible('RiskState', pipelineDecision.riskState), true);

  const keepaliveDecision = evaluateSessionPolicy({
    operation: 'site-keepalive',
    authConfig,
    networkFingerprint,
    networkDrift,
    now: new Date('2026-05-01T00:00:00+08:00'),
  });
  assert.equal(keepaliveDecision.allowed, true);
  assert.equal(keepaliveDecision.riskAction, 'keepalive-only');
  assert.equal(keepaliveDecision.riskState, undefined);
});

test('download session preflight maps governance risk to a sanitized quarantine lease', async (t) => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-download-governance-risk-'));
  t.after(() => rm(workspace, { recursive: true, force: true }));

  const released = /** @type {any[]} */ ([]);
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
  assert.deepEqual(health.repairPlan, {
    action: 'site-keepalive',
    command: 'site-keepalive',
    reason: 'network-identity-drift',
    riskSignals: [
      'network-identity-drift',
      'run-keepalive-before-auth',
      'public-ip-changed',
    ],
    requiresApproval: true,
  });
  assert.equal(health.userDataDir, undefined);
  assert.equal(health.headers, undefined);
  assert.equal(health.cookies, undefined);
  assert.deepEqual(released, ['risk-preflight-lease']);
});

test('writeAuthSessionState persists redacted state and audit sidecar', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-auth-session-redaction-'));
  try {
    const statePath = await writeAuthSessionState(workspace, {
      updatedAt: '2026-05-03T00:00:00.000Z',
      userDataDir: workspace,
      profilePath: path.join(workspace, 'browser-profile'),
      sessionId: 'synthetic-auth-session-id',
      headers: {
        authorization: 'Bearer synthetic-auth-session-token',
        Cookie: 'SESSDATA=synthetic-auth-session-cookie',
        accept: 'application/json',
      },
      cookies: [{
        name: 'SESSDATA',
        value: 'synthetic-auth-session-cookie',
      }],
      note: 'refresh_token=synthetic-auth-session-refresh',
      safeValue: 'kept',
    });
    const auditPath = siteSessionGovernanceRedactionAuditPath(statePath);
    const persistedText = await readFile(statePath, 'utf8');
    const auditText = await readFile(auditPath, 'utf8');
    const persisted = JSON.parse(persistedText);
    const audit = JSON.parse(auditText);

    assert.equal(persisted.safeValue, 'kept');
    assert.equal(persisted.userDataDir, REDACTION_PLACEHOLDER);
    assert.equal(persisted.profilePath, REDACTION_PLACEHOLDER);
    assert.equal(persisted.sessionId, REDACTION_PLACEHOLDER);
    assert.equal(persisted.headers.authorization, REDACTION_PLACEHOLDER);
    assert.equal(persisted.headers.Cookie, REDACTION_PLACEHOLDER);
    assert.equal(persisted.cookies, REDACTION_PLACEHOLDER);
    assert.equal(persisted.note, REDACTION_PLACEHOLDER);
    assert.doesNotMatch(
      `${persistedText}\n${auditText}`,
      /synthetic-auth-session|SESSDATA=|Bearer|refresh_token=|bwk-auth-session-redaction/iu,
    );
    assert.equal(audit.redactedPaths.includes('userDataDir'), true);
    assert.equal(audit.redactedPaths.includes('profilePath'), true);
    assert.equal(audit.redactedPaths.includes('sessionId'), true);
    assert.equal(audit.redactedPaths.includes('headers.authorization'), true);
    assert.equal(audit.redactedPaths.includes('headers.Cookie'), true);
    assert.equal(audit.redactedPaths.includes('cookies'), true);
    assert.equal(audit.redactedPaths.includes('note'), true);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('writeAuthSessionState fails closed when its audit sidecar cannot be written', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-auth-session-audit-fail-'));
  try {
    const statePath = path.join(workspace, '.bws', 'auth-session-state.json');
    const auditPath = siteSessionGovernanceRedactionAuditPath(statePath);
    await mkdir(auditPath, { recursive: true });

    await assert.rejects(() => writeAuthSessionState(workspace, {
      updatedAt: '2026-05-03T00:00:00.000Z',
      sessionId: 'synthetic-auth-session-id',
    }));
    await assert.rejects(() => readFile(statePath, 'utf8'), /ENOENT/u);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('appendRiskLedgerEvent writes redacted structured entries and audit sidecar', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-risk-ledger-'));
  try {
    const filePath = await appendRiskLedgerEvent(workspace, {
      riskCauseCode: 'request-burst',
      riskAction: 'cooldown-and-retry-later',
      antiCrawlSignals: [
        'rate-limit',
        'Authorization: Bearer synthetic-risk-ledger-token',
        'SESSDATA=synthetic-risk-ledger-cookie',
      ],
      sessionMaterial: {
        userDataDir: workspace,
        sessionId: 'synthetic-risk-ledger-session-id',
      },
    });
    assert.match(filePath, /\.bws[\\\/]risk-ledger\.jsonl$/u);
    const auditPath = siteSessionGovernanceRedactionAuditPath(filePath);
    const ledgerText = await readFile(filePath, 'utf8');
    const auditText = await readFile(auditPath, 'utf8');
    const entry = JSON.parse(ledgerText.trim());
    const audit = JSON.parse(auditText.trim());

    assert.deepEqual(entry.antiCrawlSignals, [
      'rate-limit',
      'Authorization: [REDACTED]',
      REDACTION_PLACEHOLDER,
    ]);
    assert.equal(entry.sessionMaterial, REDACTION_PLACEHOLDER);
    assert.doesNotMatch(
      `${ledgerText}\n${auditText}`,
      /synthetic-risk-ledger|SESSDATA=|Authorization: Bearer|bwk-risk-ledger/iu,
    );
    assert.equal(audit.redactedPaths.includes('antiCrawlSignals.1'), true);
    assert.equal(audit.redactedPaths.includes('antiCrawlSignals.2'), true);
    assert.equal(audit.redactedPaths.includes('sessionMaterial'), true);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('appendRiskLedgerEvent fails closed when its audit sidecar cannot be written', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-risk-ledger-audit-fail-'));
  try {
    const ledgerPath = path.join(workspace, '.bws', 'risk-ledger.jsonl');
    const auditPath = siteSessionGovernanceRedactionAuditPath(ledgerPath);
    await mkdir(auditPath, { recursive: true });

    await assert.rejects(() => appendRiskLedgerEvent(workspace, {
      riskCauseCode: 'request-burst',
      antiCrawlSignals: ['SESSDATA=synthetic-risk-ledger-cookie'],
    }));
    await assert.rejects(() => readFile(ledgerPath, 'utf8'), /ENOENT/u);
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

test('finalizeSiteSessionGovernance does not reclassify recovered profile health as active risk', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-auth-session-profile-health-recovery-'));
  try {
    const summary = await finalizeSiteSessionGovernance({
      operation: 'site-keepalive',
      userDataDir: workspace,
      authConfig: {
        verificationUrl: 'https://x.com/home',
        keepaliveUrl: 'https://x.com/home',
        keepaliveIntervalMinutes: 180,
        cooldownMinutesAfterRisk: 180,
        preferVisibleBrowserForAuthenticatedFlows: true,
        requireStableNetworkForAuthenticatedFlows: true,
      },
      networkDrift: {
        driftDetected: false,
        reasons: [],
      },
      policyDecision: {
        allowed: true,
        riskCauseCode: 'profile-health-risk',
        riskAction: 'rebuild-profile',
        profileQuarantined: false,
      },
      lease: null,
    }, {
      authRequired: true,
      authAvailable: true,
      identityConfirmed: true,
      loginStateDetected: true,
      persistedHealthySession: true,
      sessionReuseVerified: true,
      profileHealth: {
        exists: true,
        healthy: false,
        usableForCookies: true,
        warnings: ['Persistent browser profile last exit type was Crashed.'],
      },
      warmupSummary: {
        attempted: true,
        completed: true,
        urls: ['https://x.com/home'],
      },
    }, {
      now: new Date('2026-05-03T18:26:23.711Z'),
    });

    const persistedState = await readAuthSessionState(workspace);
    assert.equal(summary.riskCauseCode, null);
    assert.equal(summary.riskAction, null);
    assert.equal(summary.profileQuarantined, false);
    assert.equal(persistedState?.lastRiskCauseCode, null);
    assert.equal(persistedState?.lastRiskAction, null);
    assert.equal(persistedState?.lastSessionReuseVerifiedAt, '2026-05-03T18:26:23.711Z');
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('uninitialized profiles require login instead of dangerous profile rebuild', async () => {
  const risk = classifyRiskFromContext({
    profileHealth: {
      exists: true,
      healthy: false,
      profileLifecycle: 'uninitialized',
      warnings: ['Persistent browser profile is missing expected paths.'],
    },
  });

  assert.equal(risk.riskCauseCode, null);
  assert.equal(risk.riskAction, null);

  const repairPlan = buildSessionRepairPlan({
    siteKey: 'x',
    host: 'x.com',
    status: 'manual-required',
    reason: 'profile-uninitialized',
    riskSignals: ['profile-uninitialized'],
  });
  assert.equal(repairPlan.action, 'site-login');
  assert.equal(repairPlan.command, 'site-login');

  const health = await inspectDownloadSessionHealth('x', {
    host: 'x.com',
    sessionRequirement: 'required',
    profile: {
      host: 'x.com',
      authSession: {
        loginUrl: 'https://x.com/i/flow/login',
        verificationUrl: 'https://x.com/home',
      },
    },
    reuseLoginState: true,
  }, {
    async inspectReusableSiteSession() {
      return {
        authAvailable: false,
        reusableProfile: false,
        reuseLoginState: true,
        userDataDir: path.join(os.tmpdir(), 'bwk-x-profile-uninitialized'),
        profileHealth: {
          exists: true,
          healthy: false,
          profileLifecycle: 'uninitialized',
          warnings: ['Persistent browser profile is missing expected paths.'],
        },
        authConfig: {
          loginUrl: 'https://x.com/i/flow/login',
          verificationUrl: 'https://x.com/home',
        },
        sessionOptions: {
          authConfig: {
            loginUrl: 'https://x.com/i/flow/login',
            verificationUrl: 'https://x.com/home',
          },
          reuseLoginState: true,
          userDataDir: path.join(os.tmpdir(), 'bwk-x-profile-uninitialized'),
        },
      };
    },
    async prepareSiteSessionGovernance() {
      return {
        policyDecision: {
          allowed: true,
          riskCauseCode: null,
          riskAction: null,
        },
        networkDrift: {
          driftDetected: false,
          reasons: [],
        },
        authSessionSummary: {},
        lease: null,
      };
    },
  });

  assert.equal(health.status, 'manual-required');
  assert.equal(health.reason, 'profile-uninitialized');
  assert.equal(health.repairPlan.action, 'site-login');
  assert.equal(health.repairPlan.command, 'site-login');
});
