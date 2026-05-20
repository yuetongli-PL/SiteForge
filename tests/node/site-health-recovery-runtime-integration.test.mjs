import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile, rm } from 'node:fs/promises';

import { runSessionTask } from '../../src/domain/sessions/runner.mjs';
import { summarizeSessionRunManifest } from '../../src/domain/sessions/manifest-bridge.mjs';
import {
  REDACTION_PLACEHOLDER,
  assertNoForbiddenPatterns,
} from '../../src/domain/sessions/security-guard.mjs';
import {
  prepareSiteDoctorReportArtifacts,
  writeSiteDoctorReportArtifacts,
} from '../../src/entrypoints/sites/site-doctor.mjs';

function minimalSiteDoctorReport(overrides = {}) {
  return {
    site: {
      id: 'x',
      url: 'https://x.com/home',
      host: 'x.com',
      archetype: 'social-feed',
      profilePath: 'C:/Users/example/AppData/Local/Browser/User Data/Profile 7',
    },
    sample: null,
    profile: { status: 'pass' },
    crawler: { status: 'pass' },
    capture: { status: 'pass' },
    expand: { status: 'pass' },
    search: { status: 'skipped' },
    detail: { status: 'skipped' },
    author: null,
    chapter: null,
    download: null,
    sessionReuseWorked: null,
    authSession: null,
    sessionHealth: null,
    sessionProvider: 'unified-session-runner',
    antiCrawlSignals: [],
    antiCrawlReasonCode: null,
    riskCauseCode: null,
    riskAction: null,
    networkIdentityFingerprint: null,
    profileQuarantined: false,
    recoveryAttempted: false,
    recoveryStatus: null,
    riskRecovery: null,
    scenarios: [],
    missingFields: [],
    nextActions: [],
    warnings: [],
    reports: {},
    ...overrides,
  };
}

test('session health runtime exposes site healthRecovery for X profile-health-risk', async (t) => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'bwk-session-health-recovery-'));
  t.after(() => rm(runDir, { recursive: true, force: true }));

  const result = await runSessionTask({
    action: 'health',
    site: 'x',
    host: 'x.com',
    purpose: 'doctor',
    sessionRequired: true,
    runDir,
  }, {}, {
    inspectSessionHealth: async () => ({
      siteKey: 'x',
      host: 'x.com',
      status: 'blocked',
      reason: 'profile-health-risk',
      riskCauseCode: 'profile-health-risk',
      riskSignals: ['profile-health-risk'],
    }),
  });

  assert.equal(result.manifest.status, 'blocked');
  assert.equal(result.manifest.healthRecovery.schemaVersion, 1);
  assert.equal(result.manifest.healthRecovery.report.siteId, 'x');
  assert.equal(result.manifest.healthRecovery.report.risks[0].rawSignal, 'profile-health-risk');
  assert.equal(result.manifest.healthRecovery.report.risks[0].type, 'platform-risk-detected');
  assert.equal(result.manifest.healthRecovery.report.risks[0].requiresUserAction, true);
  assert.equal(result.manifest.healthRecovery.report.risks[0].autoRecoverable, false);
  assert.deepEqual(result.manifest.healthRecovery.report.recommendedActions, [
    'switch-to-readonly-mode',
    'quarantine-site-profile',
    'require-user-action',
    'safe-stop',
  ]);
  assert.equal(result.manifest.healthRecovery.report.capabilityHealth.some(
    (entry) => entry.capability === 'profile.read' && entry.status === 'disabled',
  ), true);
  assert.equal(Array.isArray(result.manifest.healthRecovery.recovery.auditLog), true);
  assertNoForbiddenPatterns(result.manifest.healthRecovery);

  const persisted = JSON.parse(await readFile(path.join(runDir, 'manifest.json'), 'utf8'));
  const persistedAudit = JSON.parse(await readFile(path.join(runDir, 'redaction-audit.json'), 'utf8'));
  assert.equal(persisted.healthRecovery.report.risks[0].type, 'platform-risk-detected');
  assert.doesNotMatch(
    `${JSON.stringify(persisted)}\n${JSON.stringify(persistedAudit)}`,
    /synthetic-health-|SESSDATA=|Authorization: Bearer|Profile 7|User Data/iu,
  );
});

test('session manifest summaries carry redacted healthRecovery across site-doctor boundary', () => {
  const summary = summarizeSessionRunManifest({
    plan: {
      siteKey: 'x',
      host: 'x.com',
      purpose: 'doctor',
      sessionRequirement: 'required',
    },
    health: {
      status: 'blocked',
      reason: 'profile-health-risk',
      riskCauseCode: 'profile-health-risk',
      riskSignals: ['profile-health-risk'],
    },
    healthRecovery: {
      schemaVersion: 1,
      report: {
        schemaVersion: 1,
        siteId: 'x',
        status: 'blocked',
        risks: [{
          siteId: 'x',
          rawSignal: 'profile-health-risk',
          type: 'platform-risk-detected',
          severity: 'high',
          affectedCapability: 'profile.read',
          autoRecoverable: false,
          requiresUserAction: true,
          prohibitedAutoActions: ['refresh-session'],
          metadata: {},
        }],
        affectedCapabilities: ['profile.read'],
        capabilityHealth: [{
          capability: 'profile.read',
          status: 'disabled',
          risks: ['platform-risk-detected'],
          actions: ['switch-to-readonly-mode', 'quarantine-site-profile', 'require-user-action', 'safe-stop'],
        }],
        recommendedActions: ['switch-to-readonly-mode', 'quarantine-site-profile', 'require-user-action', 'safe-stop'],
      },
      recovery: {
        actions: [
          { action: 'require-user-action', status: 'deferred' },
          { action: 'safe-stop', status: 'deferred' },
        ],
        auditLog: [{
          event: 'site-health-recovery.evaluated',
          siteId: 'x',
          rawSignal: 'profile-health-risk',
          riskType: 'platform-risk-detected',
          affectedCapability: 'profile.read',
          requiresUserAction: true,
          fallbackMode: 'quarantined',
          result: 'manual-or-safe-stop',
        }],
      },
    },
  });

  assert.equal(summary.healthRecovery.report.risks[0].type, 'platform-risk-detected');
  assert.deepEqual(summary.healthRecovery.report.recommendedActions, [
    'switch-to-readonly-mode',
    'quarantine-site-profile',
    'require-user-action',
    'safe-stop',
  ]);
  assertNoForbiddenPatterns(summary);
});

test('healthRecovery policy blocks captcha and MFA bypass while preserving healthy capabilities', () => {
  const prepared = prepareSiteDoctorReportArtifacts(minimalSiteDoctorReport({
    sessionHealth: {
      siteKey: 'x',
      status: 'blocked',
      reason: 'captcha-required',
    },
    healthRecovery: {
      report: {
        siteId: 'x',
        status: 'blocked',
        risks: [
          {
            siteId: 'x',
            rawSignal: 'captcha',
            type: 'captcha-required',
            affectedCapability: 'authenticated.feed',
            autoRecoverable: false,
            requiresUserAction: true,
            metadata: {
              cookie: 'SESSDATA=synthetic-report-cookie',
              authorization: 'Bearer synthetic-report-token',
            },
          },
          {
            siteId: 'x',
            rawSignal: 'mfa',
            type: 'mfa-required',
            affectedCapability: 'post.write',
            autoRecoverable: false,
            requiresUserAction: true,
          },
          {
            siteId: 'x',
            rawSignal: 'capability-disabled',
            type: 'capability-disabled',
            affectedCapability: 'authenticated.feed',
          },
        ],
        capabilityHealth: [
          {
            capability: 'authenticated.feed',
            status: 'disabled',
            risks: ['captcha-required', 'capability-disabled'],
            actions: ['require-user-action', 'safe-stop'],
          },
          {
            capability: 'profile.read',
            status: 'healthy',
            risks: [],
            actions: [],
          },
        ],
        recommendedActions: ['require-user-action', 'safe-stop'],
      },
      recovery: {
        actions: [
          { action: 'require-user-action', status: 'deferred' },
          { action: 'safe-stop', status: 'deferred' },
        ],
        auditLog: [{
          event: 'site-health-recovery.evaluated',
          fallbackMode: 'disabled',
          allowedActions: ['require-user-action', 'safe-stop'],
        }],
      },
    },
  }));

  const persisted = JSON.parse(prepared.json);
  const audit = JSON.parse(prepared.jsonAudit);
  const actions = persisted.healthRecovery.recovery.actions.map((entry) => entry.action);
  assert.deepEqual(actions, ['require-user-action', 'safe-stop']);
  assert.equal(actions.includes('refresh-session'), false);
  assert.equal(actions.includes('rebuild-browser-context'), false);
  assert.equal(
    persisted.healthRecovery.report.capabilityHealth.find((entry) => entry.capability === 'profile.read').status,
    'healthy',
  );
  assert.equal(persisted.site.profilePath, REDACTION_PLACEHOLDER);
  assert.equal(audit.redactedPaths.includes('site.profilePath'), true);
  assert.doesNotMatch(
    `${prepared.json}\n${prepared.jsonAudit}\n${prepared.markdown}\n${prepared.markdownAudit}`,
    /synthetic-report-|SESSDATA=|Bearer|Profile 7|User Data/iu,
  );
});

test('site-doctor report writer persists redacted healthRecovery audit and report files', async (t) => {
  const reportDir = await mkdtemp(path.join(os.tmpdir(), 'bwk-site-doctor-health-recovery-'));
  t.after(() => rm(reportDir, { recursive: true, force: true }));
  const paths = {
    reportDir,
    jsonPath: path.join(reportDir, 'doctor-report.json'),
    jsonAuditPath: path.join(reportDir, 'doctor-report.redaction-audit.json'),
    markdownPath: path.join(reportDir, 'doctor-report.md'),
    markdownAuditPath: path.join(reportDir, 'doctor-report.md.redaction-audit.json'),
  };

  await writeSiteDoctorReportArtifacts(minimalSiteDoctorReport({
    healthRecovery: {
      report: {
        siteId: 'x',
        status: 'degraded',
        risks: [{
          siteId: 'x',
          rawSignal: 'capability-disabled',
          type: 'capability-disabled',
          affectedCapability: 'authenticated.feed',
          metadata: {
            profilePath: 'C:/Users/example/AppData/Local/Browser/User Data/Profile 7',
            cookie: 'SESSDATA=synthetic-writer-cookie',
            authorization: 'Bearer synthetic-writer-token',
          },
        }],
        capabilityHealth: [
          { capability: 'authenticated.feed', status: 'disabled', risks: ['capability-disabled'], actions: ['disable-risky-capability'] },
          { capability: 'profile.read', status: 'healthy', risks: [], actions: [] },
        ],
        recommendedActions: ['disable-risky-capability'],
      },
      recovery: {
        actions: [{ action: 'disable-risky-capability', status: 'planned' }],
        auditLog: [{
          event: 'site-health-recovery.evaluated',
          fallbackMode: 'reduced',
          result: 'manual-or-safe-stop',
        }],
      },
    },
  }), paths);

  const reportText = await readFile(paths.jsonPath, 'utf8');
  const auditText = await readFile(paths.jsonAuditPath, 'utf8');
  const markdownText = await readFile(paths.markdownPath, 'utf8');
  const markdownAuditText = await readFile(paths.markdownAuditPath, 'utf8');
  const report = JSON.parse(reportText);
  const audit = JSON.parse(auditText);

  assert.equal(report.healthRecovery.report.status, 'degraded');
  assert.equal(report.healthRecovery.report.capabilityHealth.find((entry) => entry.capability === 'profile.read').status, 'healthy');
  assert.equal(audit.redactedPaths.includes('site.profilePath'), true);
  assert.doesNotMatch(
    `${reportText}\n${auditText}\n${markdownText}\n${markdownAuditText}`,
    /synthetic-writer-|SESSDATA=|Bearer|Profile 7|User Data/iu,
  );
});
