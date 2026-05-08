import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';

import { writeCaptureManifest } from '../../src/pipeline/stages/capture.mjs';
import { API_RESPONSE_CAPTURE_SUMMARY_SCHEMA_VERSION } from '../../src/sites/capability/api-candidates.mjs';
import {
  LIFECYCLE_EVENT_SCHEMA_VERSION,
  assertLifecycleEventObservabilityFields,
  assertLifecycleEventProducerObservability,
} from '../../src/sites/capability/lifecycle-events.mjs';
import { assertSchemaCompatible } from '../../src/sites/capability/compatibility-registry.mjs';
import { createCapabilityHookRegistry } from '../../src/sites/capability/capability-hook.mjs';
import {
  REDACTION_PLACEHOLDER,
  assertNoForbiddenPatterns,
} from '../../src/sites/capability/security-guard.mjs';

function createManifest(filePath, overrides = {}) {
  return {
    inputUrl: 'https://example.invalid/path?safe=1',
    finalUrl: 'https://example.invalid/path?safe=1',
    title: 'Synthetic Capture',
    capturedAt: '2026-04-30T00:00:00.000Z',
    status: 'success',
    outDir: path.dirname(filePath),
    files: {
      html: path.join(path.dirname(filePath), 'page.html'),
      snapshot: path.join(path.dirname(filePath), 'dom-snapshot.json'),
      screenshot: path.join(path.dirname(filePath), 'screenshot.png'),
      manifest: filePath,
    },
    page: {
      viewportWidth: 1280,
      viewportHeight: 720,
    },
    pageFacts: null,
    runtimeEvidence: null,
    error: null,
    ...overrides,
  };
}

test('writeCaptureManifest redacts synthetic sensitive fields before writing', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-capture-manifest-redaction-'));
  try {
    const manifestPath = path.join(workspace, 'manifest.json');
    const manifest = createManifest(manifestPath, {
      traceId: 'capture-trace-synthetic-1',
      correlationId: 'capture-correlation-synthetic-1',
      taskType: 'capture-manifest',
      adapterVersion: 'capture-adapter-v1',
      diagnostics: {
        authorization: 'Bearer synthetic-capture-token',
        csrf: 'synthetic-capture-csrf',
        safe: 'kept',
      },
    });
    const hookRegistry = createCapabilityHookRegistry([{
      id: 'capture-manifest-written-observer',
      phase: 'after_capture',
      subscriber: {
        name: 'capture-manifest-written-observer',
        modulePath: 'src/sites/capability/lifecycle-events.mjs',
        entrypoint: 'observe',
        order: 1,
      },
      filters: {
        eventTypes: ['capture.manifest.written'],
      },
    }]);

    await writeCaptureManifest(manifest, {
      capabilityHookRegistry: hookRegistry,
    });

    const written = JSON.parse(await readFile(manifestPath, 'utf8'));
    assert.equal(written.diagnostics.authorization, REDACTION_PLACEHOLDER);
    assert.equal(written.diagnostics.csrf, REDACTION_PLACEHOLDER);
    assert.equal(written.diagnostics.safe, 'kept');
    assert.equal(typeof written.files.redactionAudit, 'string');
    assert.equal(typeof written.files.lifecycleEvent, 'string');
    assert.equal(typeof written.files.lifecycleEventRedactionAudit, 'string');
    const audit = JSON.parse(await readFile(written.files.redactionAudit, 'utf8'));
    assert.equal(JSON.stringify(audit).includes('synthetic-capture-token'), false);
    assert.deepEqual(audit.redactedPaths, ['diagnostics.authorization', 'diagnostics.csrf']);
    const lifecycleEvent = JSON.parse(await readFile(written.files.lifecycleEvent, 'utf8'));
    assert.equal(lifecycleEvent.schemaVersion, LIFECYCLE_EVENT_SCHEMA_VERSION);
    assert.equal(assertSchemaCompatible('LifecycleEvent', lifecycleEvent), true);
    assert.equal(assertLifecycleEventProducerObservability(lifecycleEvent), true);
    assert.equal(assertLifecycleEventObservabilityFields(lifecycleEvent, {
      requiredFields: [
        'traceId',
        'correlationId',
        'taskId',
        'siteKey',
        'taskType',
        'adapterVersion',
      ],
      requiredDetailFields: [
        'status',
        'capabilityHookMatches',
      ],
    }), true);
    assert.equal(lifecycleEvent.eventType, 'capture.manifest.written');
    assert.equal(lifecycleEvent.traceId, 'capture-trace-synthetic-1');
    assert.equal(lifecycleEvent.correlationId, 'capture-correlation-synthetic-1');
    assert.equal(lifecycleEvent.taskId, manifestPath);
    assert.equal(lifecycleEvent.siteKey, 'example.invalid');
    assert.equal(lifecycleEvent.taskType, 'capture-manifest');
    assert.equal(lifecycleEvent.adapterVersion, 'capture-adapter-v1');
    assert.equal(lifecycleEvent.details.status, 'success');
    assert.deepEqual(lifecycleEvent.details.capabilityHookMatches.phases, ['after_capture']);
    assert.equal(lifecycleEvent.details.capabilityHookMatches.matchCount, 1);
    assert.equal(
      lifecycleEvent.details.capabilityHookMatches.matches[0].id,
      'capture-manifest-written-observer',
    );
    assert.equal(
      Object.hasOwn(lifecycleEvent.details.capabilityHookMatches.matches[0].subscriber, 'modulePath'),
      false,
    );
    assert.equal(
      Object.hasOwn(lifecycleEvent.details.capabilityHookMatches.matches[0].subscriber, 'entrypoint'),
      false,
    );
    assert.equal(JSON.stringify(lifecycleEvent).includes('synthetic-capture-token'), false);
    assert.equal(JSON.stringify(lifecycleEvent).includes('synthetic-capture-csrf'), false);
    const lifecycleAudit = JSON.parse(await readFile(written.files.lifecycleEventRedactionAudit, 'utf8'));
    assert.equal(JSON.stringify(lifecycleAudit).includes('synthetic-capture-token'), false);
    assert.equal(JSON.stringify(lifecycleAudit).includes('synthetic-capture-csrf'), false);
    assert.equal(manifest.diagnostics.authorization, 'Bearer synthetic-capture-token');
    assert.equal(manifest.diagnostics.csrf, 'synthetic-capture-csrf');
    assert.equal(manifest.files.redactionAudit, written.files.redactionAudit);
    assert.equal(manifest.files.lifecycleEvent, written.files.lifecycleEvent);
    assert.equal(manifest.files.lifecycleEventRedactionAudit, written.files.lifecycleEventRedactionAudit);
    assert.equal(assertNoForbiddenPatterns(written), true);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('writeCaptureManifest writes redacted api candidates from capture networkRequests', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-capture-api-candidates-'));
  try {
    const manifestPath = path.join(workspace, 'manifest.json');
    const manifest = createManifest(manifestPath, {
      traceId: 'capture-trace-synthetic-candidates',
      correlationId: 'capture-correlation-synthetic-candidates',
      taskType: 'capture-api-candidates',
      adapterVersion: 'capture-adapter-v1',
      networkRequests: [
        {
          siteKey: 'bilibili',
          method: 'POST',
          url: 'https://api.bilibili.com/x/web-interface/view?access_token=synthetic-capture-api-token&safe=1',
          headers: {
            authorization: 'Bearer synthetic-capture-api-token',
            cookie: 'SESSDATA=synthetic-capture-sessdata',
            accept: 'application/json',
          },
          body: {
            csrf: 'synthetic-capture-csrf',
            safe: true,
          },
          source: 'capture-manifest-networkRequests',
        },
      ],
    });
    const hookRegistry = createCapabilityHookRegistry([{
      id: 'capture-api-candidates-observer',
      phase: 'after_candidate_write',
      subscriber: {
        name: 'capture-api-candidates-observer',
        modulePath: 'src/sites/capability/lifecycle-events.mjs',
        entrypoint: 'observe',
        order: 1,
      },
      filters: {
        eventTypes: ['capture.api_candidates.written'],
        siteKeys: ['bilibili'],
      },
    }]);

    await writeCaptureManifest(manifest, {
      capabilityHookRegistry: hookRegistry,
    });

    const written = JSON.parse(await readFile(manifestPath, 'utf8'));
    assert.equal(written.files.apiCandidates.length, 1);
    assert.equal(written.files.apiCandidateRedactionAudits.length, 1);
    assert.equal(written.files.apiCandidateDecisions.length, 1);
    assert.equal(written.files.apiCandidateDecisionRedactionAudits.length, 1);
    assert.equal(written.networkRequests[0].headers.authorization, REDACTION_PLACEHOLDER);
    assert.equal(written.networkRequests[0].headers.cookie, REDACTION_PLACEHOLDER);
    assert.equal(written.networkRequests[0].body.csrf, REDACTION_PLACEHOLDER);
    assert.equal(JSON.stringify(written).includes('synthetic-capture-api-token'), false);
    assert.equal(JSON.stringify(written).includes('synthetic-capture-sessdata'), false);
    assert.equal(JSON.stringify(written).includes('synthetic-capture-csrf'), false);

    const candidateText = await readFile(written.files.apiCandidates[0], 'utf8');
    const candidate = JSON.parse(candidateText);
    assert.equal(candidate.status, 'observed');
    assert.equal(candidate.source, 'capture-manifest-networkRequests');
    assert.equal(candidate.siteKey, 'bilibili');
    assert.equal(candidate.request.headers.authorization, REDACTION_PLACEHOLDER);
    assert.equal(candidate.request.headers.cookie, REDACTION_PLACEHOLDER);
    assert.equal(candidate.request.body.csrf, REDACTION_PLACEHOLDER);
    assert.equal(Object.hasOwn(candidate, 'candidateId'), false);
    assert.equal(Object.hasOwn(candidate, 'version'), false);
    assert.equal(candidateText.includes('synthetic-capture-api-token'), false);
    assert.equal(candidateText.includes('synthetic-capture-sessdata'), false);
    assert.equal(candidateText.includes('synthetic-capture-csrf'), false);

    const candidateAuditText = await readFile(written.files.apiCandidateRedactionAudits[0], 'utf8');
    assert.equal(candidateAuditText.includes('synthetic-capture-api-token'), false);
    const decisionText = await readFile(written.files.apiCandidateDecisions[0], 'utf8');
    const decision = JSON.parse(decisionText);
    assert.equal(decision.adapterId, 'bilibili');
    assert.equal(decision.siteKey, 'bilibili');
    assert.equal(decision.candidateId, candidate.id);
    assert.equal(decision.decision, 'accepted');
    assert.equal(decision.scope.validationMode, 'capture-observed-candidate');
    assert.equal(decision.scope.candidateArtifact, written.files.apiCandidates[0]);
    assert.equal(decision.scope.endpointHost, 'api.bilibili.com');
    assert.equal(decision.scope.endpointPath, '/x/web-interface/view');
    assert.equal(decision.evidence.source, 'capture-api-candidate-artifact');
    assert.equal(decision.evidence.artifactPath, written.files.apiCandidates[0]);
    assert.equal(Object.hasOwn(decision, 'catalogPath'), false);
    assert.equal(decisionText.includes('synthetic-capture-api-token'), false);
    assert.equal(decisionText.includes('synthetic-capture-sessdata'), false);
    assert.equal(decisionText.includes('synthetic-capture-csrf'), false);
    const decisionAuditText = await readFile(written.files.apiCandidateDecisionRedactionAudits[0], 'utf8');
    assert.equal(decisionAuditText.includes('synthetic-capture-api-token'), false);
    assert.equal(written.files.apiCandidateCatalogUpgradeDecisions.length, 1);
    assert.equal(written.files.apiCandidateCatalogUpgradeDecisionRedactionAudits.length, 1);
    assert.equal(written.files.apiCandidateCatalogUpgradeDecisionLifecycleEvents.length, 1);
    assert.equal(written.files.apiCandidateCatalogUpgradeDecisionLifecycleEventRedactionAudits.length, 1);
    const upgradeDecisionText = await readFile(written.files.apiCandidateCatalogUpgradeDecisions[0], 'utf8');
    const upgradeDecisionAuditText = await readFile(
      written.files.apiCandidateCatalogUpgradeDecisionRedactionAudits[0],
      'utf8',
    );
    const upgradeEventText = await readFile(written.files.apiCandidateCatalogUpgradeDecisionLifecycleEvents[0], 'utf8');
    const upgradeEventAuditText = await readFile(
      written.files.apiCandidateCatalogUpgradeDecisionLifecycleEventRedactionAudits[0],
      'utf8',
    );
    const upgradeDecision = JSON.parse(upgradeDecisionText);
    const upgradeEvent = JSON.parse(upgradeEventText);
    assert.equal(upgradeDecision.candidateId, candidate.id);
    assert.equal(upgradeDecision.siteKey, 'bilibili');
    assert.equal(upgradeDecision.adapterId, 'bilibili');
    assert.equal(upgradeDecision.decision, 'blocked');
    assert.equal(upgradeDecision.canEnterCatalog, false);
    assert.equal(upgradeDecision.reasonCode, 'api-catalog-entry-blocked');
    assert.equal(upgradeDecision.requirements.candidateStatus, 'observed');
    assert.equal(upgradeDecision.requirements.candidateVerified, false);
    assert.equal(upgradeDecision.requirements.siteAdapterDecision, 'accepted');
    assert.equal(upgradeDecision.requirements.siteAdapterAccepted, true);
    assert.equal(upgradeDecision.requirements.policyAllowsCatalogUpgrade, true);
    assert.equal(Object.hasOwn(upgradeDecision, 'endpoint'), false);
    assert.equal(Object.hasOwn(upgradeDecision, 'request'), false);
    assert.equal(Object.hasOwn(upgradeDecision, 'candidate'), false);
    assert.equal(Object.hasOwn(upgradeDecision, 'catalogEntry'), false);
    assert.equal(upgradeEvent.eventType, 'api.catalog.upgrade_decision.written');
    assert.equal(upgradeEvent.traceId, 'capture-trace-synthetic-candidates');
    assert.equal(upgradeEvent.correlationId, 'capture-correlation-synthetic-candidates');
    assert.equal(upgradeEvent.details.candidateId, candidate.id);
    assert.equal(upgradeEvent.details.decision, 'blocked');
    assert.equal(upgradeEvent.details.canEnterCatalog, false);
    assert.equal(upgradeDecisionText.includes('synthetic-capture-api-token'), false);
    assert.equal(upgradeDecisionText.includes('synthetic-capture-sessdata'), false);
    assert.equal(upgradeDecisionText.includes('synthetic-capture-csrf'), false);
    assert.equal(upgradeDecisionAuditText.includes('synthetic-capture-api-token'), false);
    assert.equal(upgradeEventText.includes('synthetic-capture-api-token'), false);
    assert.equal(upgradeEventAuditText.includes('synthetic-capture-api-token'), false);
    assert.equal(typeof written.files.apiCandidateLifecycleEvent, 'string');
    assert.equal(typeof written.files.apiCandidateLifecycleEventRedactionAudit, 'string');
    const manifestLifecycleEvent = JSON.parse(await readFile(written.files.lifecycleEvent, 'utf8'));
    const candidateLifecycleEventText = await readFile(written.files.apiCandidateLifecycleEvent, 'utf8');
    const candidateLifecycleEvent = JSON.parse(candidateLifecycleEventText);
    assert.equal(candidateLifecycleEvent.eventType, 'capture.api_candidates.written');
    assert.equal(assertLifecycleEventProducerObservability(candidateLifecycleEvent), true);
    assert.equal(assertLifecycleEventObservabilityFields(candidateLifecycleEvent, {
      requiredFields: [
        'traceId',
        'correlationId',
        'taskId',
        'siteKey',
        'taskType',
        'adapterVersion',
      ],
      requiredDetailFields: [
        'count',
        'apiCandidates',
        'apiCandidateRedactionAudits',
        'apiCandidateDecisions',
        'apiCandidateDecisionRedactionAudits',
        'apiCandidateCatalogUpgradeDecisions',
        'apiCandidateCatalogUpgradeDecisionRedactionAudits',
        'apiCandidateCatalogUpgradeDecisionLifecycleEvents',
        'apiCandidateCatalogUpgradeDecisionLifecycleEventRedactionAudits',
        'capabilityHookMatches',
      ],
    }), true);
    assert.equal(manifestLifecycleEvent.eventType, 'capture.manifest.written');
    assert.equal(candidateLifecycleEvent.traceId, 'capture-trace-synthetic-candidates');
    assert.equal(candidateLifecycleEvent.correlationId, 'capture-correlation-synthetic-candidates');
    assert.equal(candidateLifecycleEvent.traceId, manifestLifecycleEvent.traceId);
    assert.equal(candidateLifecycleEvent.correlationId, manifestLifecycleEvent.correlationId);
    assert.equal(manifestLifecycleEvent.taskType, 'capture-api-candidates');
    assert.equal(manifestLifecycleEvent.adapterVersion, 'capture-adapter-v1');
    assert.equal(candidateLifecycleEvent.taskType, 'capture-api-candidates');
    assert.equal(candidateLifecycleEvent.adapterVersion, 'capture-adapter-v1');
    assert.equal(candidateLifecycleEvent.siteKey, 'bilibili');
    assert.equal(candidateLifecycleEvent.details.count, 1);
    assert.deepEqual(candidateLifecycleEvent.details.capabilityHookMatches.phases, [
      'after_capture',
      'after_candidate_write',
    ]);
    assert.equal(candidateLifecycleEvent.details.capabilityHookMatches.matchCount, 1);
    assert.equal(
      candidateLifecycleEvent.details.capabilityHookMatches.matches[0].id,
      'capture-api-candidates-observer',
    );
    assert.equal(
      Object.hasOwn(candidateLifecycleEvent.details.capabilityHookMatches.matches[0].subscriber, 'modulePath'),
      false,
    );
    assert.equal(
      Object.hasOwn(candidateLifecycleEvent.details.capabilityHookMatches.matches[0].subscriber, 'entrypoint'),
      false,
    );
    assert.deepEqual(candidateLifecycleEvent.details.apiCandidates, written.files.apiCandidates);
    assert.deepEqual(
      candidateLifecycleEvent.details.apiCandidateRedactionAudits,
      written.files.apiCandidateRedactionAudits,
    );
    assert.deepEqual(candidateLifecycleEvent.details.apiCandidateDecisions, written.files.apiCandidateDecisions);
    assert.deepEqual(
      candidateLifecycleEvent.details.apiCandidateDecisionRedactionAudits,
      written.files.apiCandidateDecisionRedactionAudits,
    );
    assert.deepEqual(
      candidateLifecycleEvent.details.apiCandidateCatalogUpgradeDecisions,
      written.files.apiCandidateCatalogUpgradeDecisions,
    );
    assert.deepEqual(
      candidateLifecycleEvent.details.apiCandidateCatalogUpgradeDecisionRedactionAudits,
      written.files.apiCandidateCatalogUpgradeDecisionRedactionAudits,
    );
    assert.deepEqual(
      candidateLifecycleEvent.details.apiCandidateCatalogUpgradeDecisionLifecycleEvents,
      written.files.apiCandidateCatalogUpgradeDecisionLifecycleEvents,
    );
    assert.deepEqual(
      candidateLifecycleEvent.details.apiCandidateCatalogUpgradeDecisionLifecycleEventRedactionAudits,
      written.files.apiCandidateCatalogUpgradeDecisionLifecycleEventRedactionAudits,
    );
    assert.equal(written.apiCandidateDataFlowRefs.length, 1);
    assert.deepEqual(candidateLifecycleEvent.details.apiCandidateDataFlowRefs, written.apiCandidateDataFlowRefs);
    assert.equal(written.apiCandidateDataFlowRefs[0].index, 0);
    assert.equal(written.apiCandidateDataFlowRefs[0].apiCandidate, written.files.apiCandidates[0]);
    assert.equal(
      written.apiCandidateDataFlowRefs[0].apiCandidateRedactionAudit,
      written.files.apiCandidateRedactionAudits[0],
    );
    assert.equal(
      written.apiCandidateDataFlowRefs[0].apiCandidateLifecycleEvent,
      written.files.apiCandidateLifecycleEvent,
    );
    assert.equal(
      written.apiCandidateDataFlowRefs[0].apiCandidateLifecycleEventRedactionAudit,
      written.files.apiCandidateLifecycleEventRedactionAudit,
    );
    assert.equal(written.apiCandidateDataFlowRefs[0].siteAdapterDecision, written.files.apiCandidateDecisions[0]);
    assert.equal(
      written.apiCandidateDataFlowRefs[0].siteAdapterDecisionRedactionAudit,
      written.files.apiCandidateDecisionRedactionAudits[0],
    );
    assert.equal(
      written.apiCandidateDataFlowRefs[0].catalogUpgradeDecision,
      written.files.apiCandidateCatalogUpgradeDecisions[0],
    );
    assert.equal(
      written.apiCandidateDataFlowRefs[0].catalogUpgradeDecisionRedactionAudit,
      written.files.apiCandidateCatalogUpgradeDecisionRedactionAudits[0],
    );
    assert.equal(
      written.apiCandidateDataFlowRefs[0].catalogUpgradeDecisionLifecycleEvent,
      written.files.apiCandidateCatalogUpgradeDecisionLifecycleEvents[0],
    );
    assert.equal(
      written.apiCandidateDataFlowRefs[0].catalogUpgradeDecisionLifecycleEventRedactionAudit,
      written.files.apiCandidateCatalogUpgradeDecisionLifecycleEventRedactionAudits[0],
    );
    assert.deepEqual(candidateLifecycleEvent.details.apiCandidateCatalogUpgradeDecisionSummary, {
      count: 1,
      byDecision: {
        blocked: 1,
      },
      reasonCodes: {
        'api-catalog-entry-blocked': 1,
      },
    });
    assert.equal(candidateLifecycleEventText.includes('synthetic-capture-api-token'), false);
    assert.equal(candidateLifecycleEventText.includes('synthetic-capture-sessdata'), false);
    assert.equal(candidateLifecycleEventText.includes('synthetic-capture-csrf'), false);
    const candidateLifecycleAuditText = await readFile(written.files.apiCandidateLifecycleEventRedactionAudit, 'utf8');
    assert.equal(candidateLifecycleAuditText.includes('synthetic-capture-api-token'), false);
    assert.equal(assertNoForbiddenPatterns(candidate), true);
    assert.equal(assertNoForbiddenPatterns(JSON.parse(candidateAuditText)), true);
    assert.equal(assertNoForbiddenPatterns(decision), true);
    assert.equal(assertNoForbiddenPatterns(JSON.parse(decisionAuditText)), true);
    assert.equal(assertNoForbiddenPatterns(upgradeDecision), true);
    assert.equal(assertNoForbiddenPatterns(JSON.parse(upgradeDecisionAuditText)), true);
    assert.equal(assertNoForbiddenPatterns(upgradeEvent), true);
    assert.equal(assertNoForbiddenPatterns(JSON.parse(upgradeEventAuditText)), true);
    assert.equal(assertNoForbiddenPatterns(candidateLifecycleEvent), true);
    assert.equal(assertNoForbiddenPatterns(JSON.parse(candidateLifecycleAuditText)), true);
    await assert.rejects(
      () => access(path.join(workspace, 'api-catalog', 'candidate-0001.json')),
      /ENOENT/u,
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('writeCaptureManifest fails closed before api candidate writes when lifecycle refs are not distinct', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-capture-api-candidate-ref-collision-'));
  try {
    const manifestPath = path.join(workspace, 'manifest.json');
    const collisionPath = path.join(workspace, 'api-candidates-lifecycle-collision.json');
    const manifest = createManifest(manifestPath, {
      networkRequests: [
        {
          siteKey: 'bilibili',
          method: 'GET',
          url: 'https://api.bilibili.com/x/web-interface/view?safe=1',
          source: 'capture-manifest-networkRequests',
        },
      ],
    });
    manifest.files.apiCandidateLifecycleEvent = collisionPath;
    manifest.files.apiCandidateLifecycleEventRedactionAudit = collisionPath;

    await assert.rejects(
      () => writeCaptureManifest(manifest),
      /lifecycle event and redaction audit paths must be distinct/u,
    );
    await assert.rejects(
      () => access(manifestPath),
      /ENOENT/u,
    );
    await assert.rejects(
      () => access(collisionPath),
      /ENOENT/u,
    );
    await assert.rejects(
      () => access(path.join(workspace, 'api-candidates', 'candidate-0001.json')),
      /ENOENT/u,
    );
    await assert.rejects(
      () => access(path.join(workspace, 'api-candidate-decisions', 'decision-0001.json')),
      /ENOENT/u,
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('writeCaptureManifest fails closed before partial writes for unsafe response summaries', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-capture-response-summary-invalid-'));
  try {
    const manifestPath = path.join(workspace, 'manifest.json');
    const manifest = createManifest(manifestPath, {
      networkResponseSummaries: [
        {
          schemaVersion: API_RESPONSE_CAPTURE_SUMMARY_SCHEMA_VERSION,
          candidateId: 'synthetic-response-summary-candidate',
          siteKey: 'example',
          statusCode: 200,
          headerNames: ['content-type'],
          headers: {
            authorization: 'Bearer synthetic-response-summary-token',
          },
          body: {
            access_token: 'synthetic-response-summary-body-token',
          },
        },
      ],
    });

    await assert.rejects(
      () => writeCaptureManifest(manifest),
      (error) => {
        assert.match(error.message, /must not contain headers/u);
        assert.equal(String(error).includes('synthetic-response-summary-token'), false);
        assert.equal(String(error).includes('synthetic-response-summary-body-token'), false);
        return true;
      },
    );
    await assert.rejects(
      () => access(manifestPath),
      /ENOENT/u,
    );
    await assert.rejects(
      () => access(manifest.files.redactionAudit),
      /ENOENT/u,
    );
    await assert.rejects(
      () => access(manifest.files.lifecycleEvent),
      /ENOENT/u,
    );
    await assert.rejects(
      () => access(manifest.files.lifecycleEventRedactionAudit),
      /ENOENT/u,
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('writeCaptureManifest writes explicit response schema verification from response summaries without catalog promotion', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-capture-response-schema-verification-'));
  try {
    const manifestPath = path.join(workspace, 'manifest.json');
    const candidateId = 'synthetic-response-schema-candidate';
    const responseSchemaHash = `sha256:${'a'.repeat(64)}`;
    const manifest = createManifest(manifestPath, {
      traceId: 'capture-trace-synthetic-response-schema',
      correlationId: 'capture-correlation-synthetic-response-schema',
      taskType: 'capture-response-schema-verification',
      adapterVersion: 'capture-adapter-v1',
      responseSchemaVerification: {
        enabled: true,
        verifierId: 'synthetic-capture-response-schema-verifier',
        verifiedAt: '2026-05-02T05:20:00.000Z',
        candidateIds: [candidateId],
        metadata: {
          fixture: 'synthetic-capture-response-summary',
        },
      },
      networkRequests: [
        {
          id: candidateId,
          siteKey: 'bilibili',
          method: 'GET',
          url: 'https://api.bilibili.com/x/web-interface/view?safe=1',
          headers: {
            accept: 'application/json',
          },
          source: 'capture-manifest-networkRequests',
        },
      ],
      networkResponseSummaries: [
        {
          schemaVersion: API_RESPONSE_CAPTURE_SUMMARY_SCHEMA_VERSION,
          candidateId,
          siteKey: 'bilibili',
          capturedAt: '2026-05-02T05:19:59.000Z',
          source: 'cdp.Network.responseReceived',
          statusCode: 200,
          contentType: 'application/json',
          headerNames: ['content-type'],
          bodyShape: {
            type: 'object',
            fields: {
              code: { type: 'number' },
              data: { type: 'object' },
            },
          },
          responseSchemaHash,
          metadata: {
            requestId: candidateId,
            resourceType: 'XHR',
          },
        },
      ],
    });

    await writeCaptureManifest(manifest);

    const written = JSON.parse(await readFile(manifestPath, 'utf8'));
    assert.equal(written.files.apiResponseSchemaVerifications.length, 1);
    assert.equal(written.files.apiResponseSchemaVerificationRedactionAudits.length, 1);
    const verificationText = await readFile(written.files.apiResponseSchemaVerifications[0], 'utf8');
    const verification = JSON.parse(verificationText);
    assert.equal(verification.status, 'passed');
    assert.equal(verification.verifierId, 'synthetic-capture-response-schema-verifier');
    assert.equal(verification.verifiedAt, '2026-05-02T05:20:00.000Z');
    assert.equal(verification.metadata.evidenceType, 'response-schema');
    assert.equal(verification.metadata.candidateId, candidateId);
    assert.equal(verification.metadata.siteKey, 'bilibili');
    assert.equal(verification.metadata.responseSchemaHash, responseSchemaHash);
    assert.equal(verification.metadata.source, 'capture.networkResponseSummaries');
    assert.equal(JSON.stringify(verification).includes('"headers"'), false);
    assert.equal(JSON.stringify(verification).includes('"body"'), false);
    assert.equal(JSON.stringify(verification).includes('"endpoint"'), false);
    assert.equal(assertNoForbiddenPatterns(verification), true);

    const verificationAuditText = await readFile(written.files.apiResponseSchemaVerificationRedactionAudits[0], 'utf8');
    assert.equal(verificationAuditText.includes('synthetic-capture-token'), false);
    const candidateLifecycleEvent = JSON.parse(await readFile(written.files.apiCandidateLifecycleEvent, 'utf8'));
    assert.deepEqual(
      candidateLifecycleEvent.details.apiResponseSchemaVerifications,
      written.files.apiResponseSchemaVerifications,
    );
    assert.deepEqual(candidateLifecycleEvent.details.apiResponseSchemaVerificationSummary, {
      count: 1,
      byStatus: {
        passed: 1,
      },
    });
    assert.equal(Object.hasOwn(written.files, 'apiCatalog'), false);
    assert.equal(Object.hasOwn(written.files, 'apiCatalogEntry'), false);
    await assert.rejects(
      () => access(path.join(workspace, 'api-catalog')),
      /ENOENT/u,
    );
    await assert.rejects(
      () => access(path.join(workspace, 'catalog')),
      /ENOENT/u,
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('writeCaptureManifest writes explicit multi-aspect verified evidence without catalog promotion', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-capture-multi-aspect-verification-'));
  try {
    const manifestPath = path.join(workspace, 'manifest.json');
    const candidateId = 'synthetic-multi-aspect-candidate';
    const responseSchemaHash = `sha256:${'b'.repeat(64)}`;
    const manifest = createManifest(manifestPath, {
      traceId: 'capture-trace-synthetic-multi-aspect',
      correlationId: 'capture-correlation-synthetic-multi-aspect',
      taskType: 'capture-multi-aspect-verification',
      adapterVersion: 'capture-adapter-v1',
      responseSchemaVerification: {
        enabled: true,
        verifierId: 'synthetic-capture-response-schema-verifier',
        verifiedAt: '2026-05-02T05:30:00.000Z',
        candidateIds: [candidateId],
      },
      apiCandidateVerification: {
        enabled: true,
        verifierId: 'synthetic-capture-multi-aspect-verifier',
        verifiedAt: '2026-05-02T05:31:00.000Z',
        candidateIds: [candidateId],
        auth: {
          passed: true,
          authRequirement: 'session-view',
          requestProtectionRequirement: 'csrf-required',
        },
        pagination: {
          passed: true,
          paginationModel: 'single-page',
        },
        risk: {
          passed: true,
          riskState: 'normal',
          riskLevel: 'low',
        },
      },
      networkRequests: [
        {
          id: candidateId,
          siteKey: 'bilibili',
          method: 'GET',
          url: 'https://api.bilibili.com/x/web-interface/view?safe=1',
          headers: {
            accept: 'application/json',
          },
          source: 'capture-manifest-networkRequests',
        },
      ],
      networkResponseSummaries: [
        {
          schemaVersion: API_RESPONSE_CAPTURE_SUMMARY_SCHEMA_VERSION,
          candidateId,
          siteKey: 'bilibili',
          capturedAt: '2026-05-02T05:29:59.000Z',
          source: 'cdp.Network.responseReceived',
          statusCode: 200,
          contentType: 'application/json',
          headerNames: ['content-type'],
          bodyShape: {
            type: 'object',
            fields: {
              code: { type: 'number' },
              data: { type: 'object' },
            },
          },
          responseSchemaHash,
        },
      ],
    });

    await writeCaptureManifest(manifest);

    const written = JSON.parse(await readFile(manifestPath, 'utf8'));
    assert.equal(written.files.apiCandidateVerifiedEvidence.length, 1);
    assert.equal(written.files.apiCandidateVerifiedEvidenceRedactionAudits.length, 1);
    assert.equal(written.files.apiCandidateVerificationLifecycleEvents.length, 1);
    assert.equal(written.files.apiCandidateVerificationLifecycleEventRedactionAudits.length, 1);
    const evidenceText = await readFile(written.files.apiCandidateVerifiedEvidence[0], 'utf8');
    const evidence = JSON.parse(evidenceText);
    assert.equal(evidence.candidate.status, 'verified');
    assert.equal(evidence.candidate.source, 'verified-evidence');
    assert.equal(evidence.verification.metadata.evidenceType, 'multi-aspect');
    assert.equal(evidence.verification.metadata.aspects.responseSchemaHash, responseSchemaHash);
    assert.equal(evidence.verification.metadata.aspects.authRequirement, 'session-view');
    assert.equal(evidence.verification.metadata.aspects.requestProtectionRequirement, 'csrf-required');
    assert.equal(evidence.verification.metadata.aspects.paginationModel, 'single-page');
    assert.equal(evidence.verification.metadata.aspects.riskState, 'normal');
    assert.equal(Object.hasOwn(evidence, 'catalogEntry'), false);
    assert.equal(Object.hasOwn(evidence, 'catalogPath'), false);
    assert.equal(JSON.stringify(evidence).includes('synthetic-capture-token'), false);
    assert.equal(JSON.stringify(evidence).includes('synthetic-capture-csrf'), false);
    assert.equal(assertNoForbiddenPatterns(evidence), true);

    const verificationEvent = JSON.parse(await readFile(
      written.files.apiCandidateVerificationLifecycleEvents[0],
      'utf8',
    ));
    assert.equal(verificationEvent.eventType, 'api.candidate.verified');
    assert.equal(verificationEvent.traceId, 'capture-trace-synthetic-multi-aspect');
    assert.equal(verificationEvent.correlationId, 'capture-correlation-synthetic-multi-aspect');
    assert.equal(verificationEvent.details.candidateId, candidateId);
    assert.equal(verificationEvent.details.verifierId, 'synthetic-capture-multi-aspect-verifier');
    const candidateLifecycleEvent = JSON.parse(await readFile(written.files.apiCandidateLifecycleEvent, 'utf8'));
    assert.deepEqual(candidateLifecycleEvent.details.apiCandidateVerifiedEvidenceSummary, {
      count: 1,
      byStatus: {
        passed: 1,
      },
      byEvidenceType: {
        'multi-aspect': 1,
      },
    });
    assert.equal(Object.hasOwn(written.files, 'apiCatalog'), false);
    assert.equal(Object.hasOwn(written.files, 'apiCatalogEntry'), false);
    await assert.rejects(
      () => access(path.join(workspace, 'api-catalog')),
      /ENOENT/u,
    );
    await assert.rejects(
      () => access(path.join(workspace, 'catalog')),
      /ENOENT/u,
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('writeCaptureManifest fails closed before multi-aspect writes when an explicit aspect is missing', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-capture-multi-aspect-missing-'));
  try {
    const manifestPath = path.join(workspace, 'manifest.json');
    const candidateId = 'synthetic-missing-auth-candidate';
    const manifest = createManifest(manifestPath, {
      responseSchemaVerification: {
        enabled: true,
        verifierId: 'synthetic-capture-response-schema-verifier',
        verifiedAt: '2026-05-02T05:32:00.000Z',
        candidateIds: [candidateId],
      },
      apiCandidateVerification: {
        enabled: true,
        verifierId: 'synthetic-capture-multi-aspect-verifier',
        verifiedAt: '2026-05-02T05:33:00.000Z',
        candidateIds: [candidateId],
        pagination: {
          passed: true,
          paginationModel: 'single-page',
        },
        risk: {
          passed: true,
          riskState: 'normal',
        },
      },
      networkRequests: [
        {
          id: candidateId,
          siteKey: 'bilibili',
          method: 'GET',
          url: 'https://api.bilibili.com/x/web-interface/view?safe=1',
          source: 'capture-manifest-networkRequests',
        },
      ],
      networkResponseSummaries: [
        {
          schemaVersion: API_RESPONSE_CAPTURE_SUMMARY_SCHEMA_VERSION,
          candidateId,
          siteKey: 'bilibili',
          statusCode: 200,
          contentType: 'application/json',
          headerNames: ['content-type'],
          bodyShape: {
            type: 'object',
            fields: {
              code: { type: 'number' },
            },
          },
          responseSchemaHash: `sha256:${'c'.repeat(64)}`,
        },
      ],
    });

    await assert.rejects(
      () => writeCaptureManifest(manifest),
      (error) => {
        assert.match(error.message, /multi-aspect verification auth input is required/u);
        assert.equal(String(error).includes('synthetic-capture-multi-aspect-verifier'), false);
        assert.equal(String(error).includes('https://api.bilibili.com'), false);
        return true;
      },
    );
    await assert.rejects(
      () => access(manifestPath),
      /ENOENT/u,
    );
    await assert.rejects(
      () => access(manifest.files.redactionAudit),
      /ENOENT/u,
    );
    await assert.rejects(
      () => access(manifest.files.lifecycleEvent),
      /ENOENT/u,
    );
    await assert.rejects(
      () => access(manifest.files.lifecycleEventRedactionAudit),
      /ENOENT/u,
    );
    await assert.rejects(
      () => access(path.join(workspace, 'api-response-schema-verifications')),
      /ENOENT/u,
    );
    await assert.rejects(
      () => access(path.join(workspace, 'api-response-schema-verification-redaction-audits')),
      /ENOENT/u,
    );
    await assert.rejects(
      () => access(path.join(workspace, 'api-candidates')),
      /ENOENT/u,
    );
    await assert.rejects(
      () => access(path.join(workspace, 'api-candidate-verified-evidence')),
      /ENOENT/u,
    );
    await assert.rejects(
      () => access(path.join(workspace, 'api-candidate-verification-lifecycle-events')),
      /ENOENT/u,
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('writeCaptureManifest rejects multi-aspect verified evidence for rejected SiteAdapter decisions', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-capture-multi-aspect-rejected-adapter-'));
  try {
    const manifestPath = path.join(workspace, 'manifest.json');
    const candidateId = 'synthetic-rejected-multi-aspect-candidate';
    const manifest = createManifest(manifestPath, {
      traceId: 'capture-trace-synthetic-rejected-multi-aspect',
      correlationId: 'capture-correlation-synthetic-rejected-multi-aspect',
      responseSchemaVerification: {
        enabled: true,
        verifierId: 'synthetic-capture-response-schema-verifier',
        verifiedAt: '2026-05-02T05:34:00.000Z',
        candidateIds: [candidateId],
      },
      apiCandidateVerification: {
        enabled: true,
        verifierId: 'synthetic-capture-multi-aspect-verifier',
        verifiedAt: '2026-05-02T05:35:00.000Z',
        candidateIds: [candidateId],
        auth: {
          passed: true,
          authRequirement: 'session-view',
          requestProtectionRequirement: 'csrf-required',
        },
        pagination: {
          passed: true,
          paginationModel: 'cursor',
        },
        risk: {
          passed: true,
          riskState: 'normal',
        },
      },
      networkRequests: [
        {
          id: candidateId,
          siteKey: 'x',
          method: 'GET',
          url: 'https://x.com/not-api/graphql/synthetic/HomeTimeline?safe=1',
          headers: {
            accept: 'application/json',
          },
          source: 'capture-manifest-networkRequests',
        },
      ],
      networkResponseSummaries: [
        {
          schemaVersion: API_RESPONSE_CAPTURE_SUMMARY_SCHEMA_VERSION,
          candidateId,
          siteKey: 'x',
          statusCode: 200,
          contentType: 'application/json',
          headerNames: ['content-type'],
          bodyShape: {
            type: 'object',
            fields: {
              data: { type: 'object' },
            },
          },
          responseSchemaHash: `sha256:${'d'.repeat(64)}`,
        },
      ],
    });

    await assert.rejects(
      () => writeCaptureManifest(manifest),
      (error) => {
        assert.match(error.message, /requires accepted SiteAdapter decision/u);
        assert.equal(String(error).includes('synthetic-capture-multi-aspect-verifier'), false);
        assert.equal(String(error).includes('https://x.com/not-api/graphql/synthetic/HomeTimeline'), false);
        return true;
      },
    );
    await assert.rejects(
      () => access(manifestPath),
      /ENOENT/u,
    );
    await assert.rejects(
      () => access(manifest.files.redactionAudit),
      /ENOENT/u,
    );
    await assert.rejects(
      () => access(manifest.files.lifecycleEvent),
      /ENOENT/u,
    );
    await assert.rejects(
      () => access(manifest.files.lifecycleEventRedactionAudit),
      /ENOENT/u,
    );

    const candidatePath = path.join(workspace, 'api-candidates', 'candidate-0001.json');
    const decisionPath = path.join(workspace, 'api-candidate-decisions', 'decision-0001.json');
    const responseVerificationPath = path.join(
      workspace,
      'api-response-schema-verifications',
      'response-schema-verification-0001.json',
    );
    await access(candidatePath);
    await access(decisionPath);
    await access(responseVerificationPath);

    const decision = JSON.parse(await readFile(decisionPath, 'utf8'));
    assert.equal(decision.decision, 'rejected');
    assert.equal(decision.reasonCode, 'api-verification-failed');
    assert.equal(Object.hasOwn(decision, 'catalogEntry'), false);

    await assert.rejects(
      () => access(path.join(workspace, 'api-candidate-verified-evidence')),
      /ENOENT/u,
    );
    await assert.rejects(
      () => access(path.join(workspace, 'api-candidate-verification-lifecycle-events')),
      /ENOENT/u,
    );
    await assert.rejects(
      () => access(path.join(workspace, 'api-candidate-verification-lifecycle-event-redaction-audits')),
      /ENOENT/u,
    );
    await assert.rejects(
      () => access(path.join(workspace, 'api-candidates-lifecycle-event.json')),
      /ENOENT/u,
    );
    await assert.rejects(
      () => access(path.join(workspace, 'api-candidates-lifecycle-event-redaction-audit.json')),
      /ENOENT/u,
    );
    await assert.rejects(
      () => access(path.join(workspace, 'api-catalog')),
      /ENOENT/u,
    );
    await assert.rejects(
      () => access(path.join(workspace, 'catalog')),
      /ENOENT/u,
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('writeCaptureManifest fails closed before response schema verification writes for incomplete summaries', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-capture-response-schema-verification-invalid-'));
  try {
    const manifestPath = path.join(workspace, 'manifest.json');
    const candidateId = 'synthetic-incomplete-response-schema-candidate';
    const manifest = createManifest(manifestPath, {
      responseSchemaVerification: {
        enabled: true,
        verifierId: 'synthetic-capture-response-schema-verifier',
        verifiedAt: '2026-05-02T05:21:00.000Z',
        candidateIds: [candidateId],
      },
      networkRequests: [
        {
          id: candidateId,
          siteKey: 'bilibili',
          method: 'GET',
          url: 'https://api.bilibili.com/x/web-interface/view?safe=1',
          source: 'capture-manifest-networkRequests',
        },
      ],
      networkResponseSummaries: [
        {
          schemaVersion: API_RESPONSE_CAPTURE_SUMMARY_SCHEMA_VERSION,
          candidateId,
          siteKey: 'bilibili',
          statusCode: 200,
          contentType: 'application/json',
          headerNames: ['content-type'],
        },
      ],
    });

    await assert.rejects(
      () => writeCaptureManifest(manifest),
      (error) => {
        assert.match(error.message, /lacks bodyShape or responseSchemaHash/u);
        assert.equal(String(error).includes('synthetic-capture-response-schema-verifier'), false);
        assert.equal(String(error).includes('https://api.bilibili.com'), false);
        return true;
      },
    );
    await assert.rejects(
      () => access(manifestPath),
      /ENOENT/u,
    );
    await assert.rejects(
      () => access(manifest.files.redactionAudit),
      /ENOENT/u,
    );
    await assert.rejects(
      () => access(manifest.files.lifecycleEvent),
      /ENOENT/u,
    );
    await assert.rejects(
      () => access(manifest.files.lifecycleEventRedactionAudit),
      /ENOENT/u,
    );
    await assert.rejects(
      () => access(path.join(workspace, 'api-response-schema-verifications')),
      /ENOENT/u,
    );
    await assert.rejects(
      () => access(path.join(workspace, 'api-response-schema-verification-redaction-audits')),
      /ENOENT/u,
    );
    await assert.rejects(
      () => access(path.join(workspace, 'api-candidates')),
      /ENOENT/u,
    );
    await assert.rejects(
      () => access(path.join(workspace, 'api-candidate-redaction-audits')),
      /ENOENT/u,
    );
    await assert.rejects(
      () => access(path.join(workspace, 'api-candidate-decisions')),
      /ENOENT/u,
    );
    await assert.rejects(
      () => access(path.join(workspace, 'api-candidate-decision-redaction-audits')),
      /ENOENT/u,
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('writeCaptureManifest writes Jable SiteAdapter decision artifacts without catalog promotion', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-capture-jable-api-decision-'));
  try {
    const manifestPath = path.join(workspace, 'manifest.json');
    const manifest = createManifest(manifestPath, {
      traceId: 'capture-trace-synthetic-jable-candidates',
      correlationId: 'capture-correlation-synthetic-jable-candidates',
      taskType: 'capture-catalog-upgrade',
      adapterVersion: 'capture-jable-adapter-v1',
      networkRequests: [
        {
          siteKey: 'jable',
          method: 'GET',
          url: 'https://jable.tv/api/v1/videos?access_token=synthetic-jable-capture-token&safe=1',
          headers: {
            authorization: 'Bearer synthetic-jable-capture-token',
            cookie: 'SESSDATA=synthetic-jable-capture-sessdata',
            accept: 'application/json',
          },
          body: {
            csrf: 'synthetic-jable-capture-csrf',
            safe: true,
          },
          source: 'capture-manifest-networkRequests',
        },
      ],
    });

    await writeCaptureManifest(manifest);

    const written = JSON.parse(await readFile(manifestPath, 'utf8'));
    assert.equal(written.files.apiCandidates.length, 1);
    assert.equal(written.files.apiCandidateRedactionAudits.length, 1);
    assert.equal(written.files.apiCandidateDecisions.length, 1);
    assert.equal(written.files.apiCandidateDecisionRedactionAudits.length, 1);
    assert.equal(written.files.apiCandidateCatalogUpgradeDecisions.length, 1);
    assert.equal(written.files.apiCandidateCatalogUpgradeDecisionRedactionAudits.length, 1);
    assert.equal(written.files.apiCandidateCatalogUpgradeDecisionLifecycleEvents.length, 1);
    assert.equal(written.files.apiCandidateCatalogUpgradeDecisionLifecycleEventRedactionAudits.length, 1);
    assert.equal(JSON.stringify(written).includes('synthetic-jable-capture-token'), false);
    assert.equal(JSON.stringify(written).includes('synthetic-jable-capture-sessdata'), false);
    assert.equal(JSON.stringify(written).includes('synthetic-jable-capture-csrf'), false);

    const candidateText = await readFile(written.files.apiCandidates[0], 'utf8');
    const candidate = JSON.parse(candidateText);
    assert.equal(candidate.status, 'observed');
    assert.equal(candidate.siteKey, 'jable');
    assert.equal(candidate.request.headers.authorization, REDACTION_PLACEHOLDER);
    assert.equal(candidate.request.headers.cookie, REDACTION_PLACEHOLDER);
    assert.equal(candidate.request.body.csrf, REDACTION_PLACEHOLDER);
    assert.equal(candidateText.includes('synthetic-jable-capture-token'), false);
    assert.equal(candidateText.includes('synthetic-jable-capture-sessdata'), false);
    assert.equal(candidateText.includes('synthetic-jable-capture-csrf'), false);

    const decisionText = await readFile(written.files.apiCandidateDecisions[0], 'utf8');
    const decision = JSON.parse(decisionText);
    assert.equal(decision.adapterId, 'jable');
    assert.equal(decision.siteKey, 'jable');
    assert.equal(decision.candidateId, candidate.id);
    assert.equal(decision.decision, 'accepted');
    assert.equal(decision.scope.validationMode, 'capture-observed-candidate');
    assert.equal(decision.scope.endpointHost, 'jable.tv');
    assert.equal(decision.scope.endpointPath, '/api/v1/videos');
    assert.equal(Object.hasOwn(decision, 'catalogPath'), false);
    assert.equal(decisionText.includes('synthetic-jable-capture-token'), false);
    assert.equal(decisionText.includes('synthetic-jable-capture-sessdata'), false);
    assert.equal(decisionText.includes('synthetic-jable-capture-csrf'), false);
    const decisionAuditText = await readFile(written.files.apiCandidateDecisionRedactionAudits[0], 'utf8');
    assert.equal(decisionAuditText.includes('synthetic-jable-capture-token'), false);

    const upgradeDecisionText = await readFile(written.files.apiCandidateCatalogUpgradeDecisions[0], 'utf8');
    const upgradeDecision = JSON.parse(upgradeDecisionText);
    assert.equal(upgradeDecision.adapterId, 'jable');
    assert.equal(upgradeDecision.siteKey, 'jable');
    assert.equal(upgradeDecision.candidateId, candidate.id);
    assert.equal(upgradeDecision.decision, 'blocked');
    assert.equal(upgradeDecision.canEnterCatalog, false);
    assert.equal(upgradeDecision.reasonCode, 'api-catalog-entry-blocked');
    assert.equal(upgradeDecision.requirements.candidateStatus, 'observed');
    assert.equal(upgradeDecision.requirements.siteAdapterAccepted, true);
    assert.equal(upgradeDecision.requirements.policyAllowsCatalogUpgrade, true);
    assert.equal(Object.hasOwn(upgradeDecision, 'endpoint'), false);
    assert.equal(Object.hasOwn(upgradeDecision, 'request'), false);
    assert.equal(Object.hasOwn(upgradeDecision, 'candidate'), false);
    assert.equal(Object.hasOwn(upgradeDecision, 'catalogEntry'), false);
    assert.equal(upgradeDecisionText.includes('synthetic-jable-capture-token'), false);
    assert.equal(upgradeDecisionText.includes('synthetic-jable-capture-sessdata'), false);
    assert.equal(upgradeDecisionText.includes('synthetic-jable-capture-csrf'), false);
    const upgradeDecisionAuditText = await readFile(
      written.files.apiCandidateCatalogUpgradeDecisionRedactionAudits[0],
      'utf8',
    );
    assert.equal(upgradeDecisionAuditText.includes('synthetic-jable-capture-token'), false);

    const upgradeDecisionEventText = await readFile(
      written.files.apiCandidateCatalogUpgradeDecisionLifecycleEvents[0],
      'utf8',
    );
    const upgradeDecisionEvent = JSON.parse(upgradeDecisionEventText);
    assert.equal(assertSchemaCompatible('LifecycleEvent', upgradeDecisionEvent), true);
    assert.equal(upgradeDecisionEvent.eventType, 'api.catalog.upgrade_decision.written');
    assert.equal(upgradeDecisionEvent.traceId, 'capture-trace-synthetic-jable-candidates');
    assert.equal(upgradeDecisionEvent.correlationId, 'capture-correlation-synthetic-jable-candidates');
    assert.equal(upgradeDecisionEvent.taskType, 'capture-catalog-upgrade');
    assert.equal(upgradeDecisionEvent.adapterVersion, 'capture-jable-adapter-v1');
    assert.equal(upgradeDecisionEvent.siteKey, 'jable');
    assert.equal(upgradeDecisionEvent.reasonCode, 'api-catalog-entry-blocked');
    assert.equal(upgradeDecisionEvent.details.candidateId, candidate.id);
    assert.equal(upgradeDecisionEvent.details.decision, 'blocked');
    assert.equal(upgradeDecisionEvent.details.canEnterCatalog, false);
    assert.equal(Object.hasOwn(upgradeDecisionEvent.details, 'endpoint'), false);
    assert.equal(Object.hasOwn(upgradeDecisionEvent.details, 'request'), false);
    assert.equal(Object.hasOwn(upgradeDecisionEvent.details, 'candidate'), false);
    assert.equal(upgradeDecisionEventText.includes('synthetic-jable-capture-token'), false);
    const upgradeDecisionEventAuditText = await readFile(
      written.files.apiCandidateCatalogUpgradeDecisionLifecycleEventRedactionAudits[0],
      'utf8',
    );
    assert.equal(upgradeDecisionEventAuditText.includes('synthetic-jable-capture-token'), false);

    const candidateLifecycleEvent = JSON.parse(await readFile(written.files.apiCandidateLifecycleEvent, 'utf8'));
    assert.equal(assertSchemaCompatible('LifecycleEvent', candidateLifecycleEvent), true);
    assert.equal(candidateLifecycleEvent.eventType, 'capture.api_candidates.written');
    assert.equal(candidateLifecycleEvent.traceId, 'capture-trace-synthetic-jable-candidates');
    assert.equal(candidateLifecycleEvent.correlationId, 'capture-correlation-synthetic-jable-candidates');
    assert.equal(candidateLifecycleEvent.siteKey, 'jable');
    assert.equal(candidateLifecycleEvent.details.count, 1);
    assert.deepEqual(candidateLifecycleEvent.details.apiCandidateDecisions, written.files.apiCandidateDecisions);
    assert.deepEqual(
      candidateLifecycleEvent.details.apiCandidateCatalogUpgradeDecisions,
      written.files.apiCandidateCatalogUpgradeDecisions,
    );
    assert.deepEqual(
      candidateLifecycleEvent.details.apiCandidateCatalogUpgradeDecisionLifecycleEvents,
      written.files.apiCandidateCatalogUpgradeDecisionLifecycleEvents,
    );
    assert.equal(candidateLifecycleEvent.details.apiCandidateCatalogUpgradeDecisionSummary.count, 1);
    assert.equal(candidateLifecycleEvent.details.apiCandidateCatalogUpgradeDecisionSummary.byDecision.blocked, 1);
    assert.equal(
      candidateLifecycleEvent.details.apiCandidateCatalogUpgradeDecisionSummary.reasonCodes['api-catalog-entry-blocked'],
      1,
    );
    assert.equal(candidateLifecycleEvent.details.apiCandidateCatalogUpgradeRiskStates.length, 1);
    const catalogRiskState = candidateLifecycleEvent.details.apiCandidateCatalogUpgradeRiskStates[0];
    assert.equal(catalogRiskState.source, 'api-catalog-upgrade-decision');
    assert.equal(catalogRiskState.candidateIndex, 0);
    assert.equal(catalogRiskState.reasonCode, 'api-catalog-entry-blocked');
    assert.equal(catalogRiskState.reasonRecovery.catalogAction, 'block');
    assert.equal(catalogRiskState.riskState.state, 'blocked');
    assert.equal(catalogRiskState.riskState.reasonCode, 'api-catalog-entry-blocked');
    assert.equal(catalogRiskState.riskState.scope, 'capture-api-catalog-upgrade');
    assert.equal(catalogRiskState.riskState.transition.from, 'normal');
    assert.equal(catalogRiskState.riskState.transition.to, 'blocked');
    assert.equal(catalogRiskState.riskState.recovery.artifactWriteAllowed, false);
    assert.equal(JSON.stringify(catalogRiskState).includes('/api/v1/videos'), false);
    assert.equal(JSON.stringify(candidateLifecycleEvent).includes('synthetic-jable-capture-token'), false);

    await assert.rejects(
      () => access(path.join(workspace, 'api-catalog', 'candidate-0001.json')),
      /ENOENT/u,
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('writeCaptureManifest writes Moodyz SiteAdapter decision artifacts without catalog promotion', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-capture-moodyz-api-decision-'));
  try {
    const manifestPath = path.join(workspace, 'manifest.json');
    const manifest = createManifest(manifestPath, {
      traceId: 'capture-trace-synthetic-moodyz-candidates',
      correlationId: 'capture-correlation-synthetic-moodyz-candidates',
      networkRequests: [
        {
          siteKey: 'moodyz',
          method: 'GET',
          url: 'https://moodyz.com/api/v1/works?access_token=synthetic-moodyz-capture-token&safe=1',
          headers: {
            authorization: 'Bearer synthetic-moodyz-capture-token',
            cookie: 'SESSDATA=synthetic-moodyz-capture-sessdata',
            accept: 'application/json',
          },
          body: {
            csrf: 'synthetic-moodyz-capture-csrf',
            safe: true,
          },
          source: 'capture-manifest-networkRequests',
        },
      ],
    });

    await writeCaptureManifest(manifest);

    const written = JSON.parse(await readFile(manifestPath, 'utf8'));
    assert.equal(written.files.apiCandidates.length, 1);
    assert.equal(written.files.apiCandidateRedactionAudits.length, 1);
    assert.equal(written.files.apiCandidateDecisions.length, 1);
    assert.equal(written.files.apiCandidateDecisionRedactionAudits.length, 1);
    assert.equal(JSON.stringify(written).includes('synthetic-moodyz-capture-token'), false);
    assert.equal(JSON.stringify(written).includes('synthetic-moodyz-capture-sessdata'), false);
    assert.equal(JSON.stringify(written).includes('synthetic-moodyz-capture-csrf'), false);

    const candidateText = await readFile(written.files.apiCandidates[0], 'utf8');
    const candidate = JSON.parse(candidateText);
    assert.equal(candidate.status, 'observed');
    assert.equal(candidate.siteKey, 'moodyz');
    assert.equal(candidate.request.headers.authorization, REDACTION_PLACEHOLDER);
    assert.equal(candidate.request.headers.cookie, REDACTION_PLACEHOLDER);
    assert.equal(candidate.request.body.csrf, REDACTION_PLACEHOLDER);
    assert.equal(candidateText.includes('synthetic-moodyz-capture-token'), false);
    assert.equal(candidateText.includes('synthetic-moodyz-capture-sessdata'), false);
    assert.equal(candidateText.includes('synthetic-moodyz-capture-csrf'), false);

    const decisionText = await readFile(written.files.apiCandidateDecisions[0], 'utf8');
    const decision = JSON.parse(decisionText);
    assert.equal(decision.adapterId, 'moodyz');
    assert.equal(decision.siteKey, 'moodyz');
    assert.equal(decision.candidateId, candidate.id);
    assert.equal(decision.decision, 'accepted');
    assert.equal(decision.scope.validationMode, 'capture-observed-candidate');
    assert.equal(decision.scope.endpointHost, 'moodyz.com');
    assert.equal(decision.scope.endpointPath, '/api/v1/works');
    assert.equal(Object.hasOwn(decision, 'catalogPath'), false);
    assert.equal(decisionText.includes('synthetic-moodyz-capture-token'), false);
    assert.equal(decisionText.includes('synthetic-moodyz-capture-sessdata'), false);
    assert.equal(decisionText.includes('synthetic-moodyz-capture-csrf'), false);
    const decisionAuditText = await readFile(written.files.apiCandidateDecisionRedactionAudits[0], 'utf8');
    assert.equal(decisionAuditText.includes('synthetic-moodyz-capture-token'), false);

    const candidateLifecycleEvent = JSON.parse(await readFile(written.files.apiCandidateLifecycleEvent, 'utf8'));
    assert.equal(candidateLifecycleEvent.eventType, 'capture.api_candidates.written');
    assert.equal(candidateLifecycleEvent.traceId, 'capture-trace-synthetic-moodyz-candidates');
    assert.equal(candidateLifecycleEvent.correlationId, 'capture-correlation-synthetic-moodyz-candidates');
    assert.equal(candidateLifecycleEvent.siteKey, 'moodyz');
    assert.equal(candidateLifecycleEvent.details.count, 1);
    assert.deepEqual(candidateLifecycleEvent.details.apiCandidateDecisions, written.files.apiCandidateDecisions);
    assert.equal(JSON.stringify(candidateLifecycleEvent).includes('synthetic-moodyz-capture-token'), false);

    await assert.rejects(
      () => access(path.join(workspace, 'api-catalog', 'candidate-0001.json')),
      /ENOENT/u,
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('writeCaptureManifest writes X SiteAdapter decision artifacts without catalog promotion', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-capture-x-api-decision-'));
  try {
    const manifestPath = path.join(workspace, 'manifest.json');
    const manifest = createManifest(manifestPath, {
      traceId: 'capture-trace-synthetic-x-candidates',
      correlationId: 'capture-correlation-synthetic-x-candidates',
      networkRequests: [
        {
          siteKey: 'x',
          method: 'GET',
          url: 'https://x.com/i/api/graphql/synthetic/HomeTimeline?access_token=synthetic-x-capture-token&safe=1',
          headers: {
            authorization: 'Bearer synthetic-x-capture-token',
            cookie: 'SESSDATA=synthetic-x-capture-sessdata',
            accept: 'application/json',
          },
          body: {
            csrf: 'synthetic-x-capture-csrf',
            safe: true,
          },
          source: 'capture-manifest-networkRequests',
        },
      ],
    });

    await writeCaptureManifest(manifest);

    const written = JSON.parse(await readFile(manifestPath, 'utf8'));
    assert.equal(written.files.apiCandidates.length, 1);
    assert.equal(written.files.apiCandidateRedactionAudits.length, 1);
    assert.equal(written.files.apiCandidateDecisions.length, 1);
    assert.equal(written.files.apiCandidateDecisionRedactionAudits.length, 1);
    assert.equal(JSON.stringify(written).includes('synthetic-x-capture-token'), false);
    assert.equal(JSON.stringify(written).includes('synthetic-x-capture-sessdata'), false);
    assert.equal(JSON.stringify(written).includes('synthetic-x-capture-csrf'), false);

    const candidateText = await readFile(written.files.apiCandidates[0], 'utf8');
    const candidate = JSON.parse(candidateText);
    assert.equal(candidate.status, 'observed');
    assert.equal(candidate.siteKey, 'x');
    assert.equal(candidate.request.headers.authorization, REDACTION_PLACEHOLDER);
    assert.equal(candidate.request.headers.cookie, REDACTION_PLACEHOLDER);
    assert.equal(candidate.request.body.csrf, REDACTION_PLACEHOLDER);
    assert.equal(candidateText.includes('synthetic-x-capture-token'), false);
    assert.equal(candidateText.includes('synthetic-x-capture-sessdata'), false);
    assert.equal(candidateText.includes('synthetic-x-capture-csrf'), false);

    const decisionText = await readFile(written.files.apiCandidateDecisions[0], 'utf8');
    const decision = JSON.parse(decisionText);
    assert.equal(decision.adapterId, 'x');
    assert.equal(decision.siteKey, 'x');
    assert.equal(decision.candidateId, candidate.id);
    assert.equal(decision.decision, 'accepted');
    assert.equal(decision.scope.validationMode, 'capture-observed-candidate');
    assert.equal(decision.scope.endpointHost, 'x.com');
    assert.equal(decision.scope.endpointPath, '/i/api/graphql/synthetic/HomeTimeline');
    assert.equal(Object.hasOwn(decision, 'catalogPath'), false);
    assert.equal(decisionText.includes('synthetic-x-capture-token'), false);
    assert.equal(decisionText.includes('synthetic-x-capture-sessdata'), false);
    assert.equal(decisionText.includes('synthetic-x-capture-csrf'), false);
    const decisionAuditText = await readFile(written.files.apiCandidateDecisionRedactionAudits[0], 'utf8');
    assert.equal(decisionAuditText.includes('synthetic-x-capture-token'), false);

    const candidateLifecycleEvent = JSON.parse(await readFile(written.files.apiCandidateLifecycleEvent, 'utf8'));
    assert.equal(candidateLifecycleEvent.eventType, 'capture.api_candidates.written');
    assert.equal(candidateLifecycleEvent.traceId, 'capture-trace-synthetic-x-candidates');
    assert.equal(candidateLifecycleEvent.correlationId, 'capture-correlation-synthetic-x-candidates');
    assert.equal(candidateLifecycleEvent.siteKey, 'x');
    assert.equal(candidateLifecycleEvent.details.count, 1);
    assert.deepEqual(candidateLifecycleEvent.details.apiCandidateDecisions, written.files.apiCandidateDecisions);
    assert.equal(JSON.stringify(candidateLifecycleEvent).includes('synthetic-x-capture-token'), false);

    await assert.rejects(
      () => access(path.join(workspace, 'api-catalog', 'candidate-0001.json')),
      /ENOENT/u,
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('writeCaptureManifest writes Instagram SiteAdapter decision artifacts without catalog promotion', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-capture-instagram-api-decision-'));
  try {
    const manifestPath = path.join(workspace, 'manifest.json');
    const manifest = createManifest(manifestPath, {
      traceId: 'capture-trace-synthetic-instagram-candidates',
      correlationId: 'capture-correlation-synthetic-instagram-candidates',
      networkRequests: [
        {
          siteKey: 'instagram',
          method: 'GET',
          url: 'https://www.instagram.com/api/v1/feed/user/?access_token=synthetic-instagram-capture-token&safe=1',
          headers: {
            authorization: 'Bearer synthetic-instagram-capture-token',
            cookie: 'SESSDATA=synthetic-instagram-capture-sessdata',
            accept: 'application/json',
          },
          body: {
            csrf: 'synthetic-instagram-capture-csrf',
            safe: true,
          },
          source: 'capture-manifest-networkRequests',
        },
      ],
    });

    await writeCaptureManifest(manifest);

    const written = JSON.parse(await readFile(manifestPath, 'utf8'));
    assert.equal(written.files.apiCandidates.length, 1);
    assert.equal(written.files.apiCandidateRedactionAudits.length, 1);
    assert.equal(written.files.apiCandidateDecisions.length, 1);
    assert.equal(written.files.apiCandidateDecisionRedactionAudits.length, 1);
    assert.equal(JSON.stringify(written).includes('synthetic-instagram-capture-token'), false);
    assert.equal(JSON.stringify(written).includes('synthetic-instagram-capture-sessdata'), false);
    assert.equal(JSON.stringify(written).includes('synthetic-instagram-capture-csrf'), false);

    const candidateText = await readFile(written.files.apiCandidates[0], 'utf8');
    const candidate = JSON.parse(candidateText);
    assert.equal(candidate.status, 'observed');
    assert.equal(candidate.siteKey, 'instagram');
    assert.equal(candidate.request.headers.authorization, REDACTION_PLACEHOLDER);
    assert.equal(candidate.request.headers.cookie, REDACTION_PLACEHOLDER);
    assert.equal(candidate.request.body.csrf, REDACTION_PLACEHOLDER);
    assert.equal(candidateText.includes('synthetic-instagram-capture-token'), false);
    assert.equal(candidateText.includes('synthetic-instagram-capture-sessdata'), false);
    assert.equal(candidateText.includes('synthetic-instagram-capture-csrf'), false);

    const decisionText = await readFile(written.files.apiCandidateDecisions[0], 'utf8');
    const decision = JSON.parse(decisionText);
    assert.equal(decision.adapterId, 'instagram');
    assert.equal(decision.siteKey, 'instagram');
    assert.equal(decision.candidateId, candidate.id);
    assert.equal(decision.decision, 'accepted');
    assert.equal(decision.scope.validationMode, 'capture-observed-candidate');
    assert.equal(decision.scope.endpointHost, 'www.instagram.com');
    assert.equal(decision.scope.endpointPath, '/api/v1/feed/user/');
    assert.equal(Object.hasOwn(decision, 'catalogPath'), false);
    assert.equal(decisionText.includes('synthetic-instagram-capture-token'), false);
    assert.equal(decisionText.includes('synthetic-instagram-capture-sessdata'), false);
    assert.equal(decisionText.includes('synthetic-instagram-capture-csrf'), false);
    const decisionAuditText = await readFile(written.files.apiCandidateDecisionRedactionAudits[0], 'utf8');
    assert.equal(decisionAuditText.includes('synthetic-instagram-capture-token'), false);

    const candidateLifecycleEvent = JSON.parse(await readFile(written.files.apiCandidateLifecycleEvent, 'utf8'));
    assert.equal(candidateLifecycleEvent.eventType, 'capture.api_candidates.written');
    assert.equal(candidateLifecycleEvent.traceId, 'capture-trace-synthetic-instagram-candidates');
    assert.equal(candidateLifecycleEvent.correlationId, 'capture-correlation-synthetic-instagram-candidates');
    assert.equal(candidateLifecycleEvent.siteKey, 'instagram');
    assert.equal(candidateLifecycleEvent.details.count, 1);
    assert.deepEqual(candidateLifecycleEvent.details.apiCandidateDecisions, written.files.apiCandidateDecisions);
    assert.equal(JSON.stringify(candidateLifecycleEvent).includes('synthetic-instagram-capture-token'), false);

    await assert.rejects(
      () => access(path.join(workspace, 'api-catalog', 'candidate-0001.json')),
      /ENOENT/u,
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('writeCaptureManifest writes Douyin SiteAdapter decision artifacts without catalog promotion', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-capture-douyin-api-decision-'));
  try {
    const manifestPath = path.join(workspace, 'manifest.json');
    const manifest = createManifest(manifestPath, {
      traceId: 'capture-trace-synthetic-douyin-candidates',
      correlationId: 'capture-correlation-synthetic-douyin-candidates',
      networkRequests: [
        {
          siteKey: 'douyin',
          method: 'GET',
          url: 'https://www.douyin.com/aweme/v1/web/aweme/detail/?aweme_id=synthetic&access_token=synthetic-douyin-capture-token&safe=1',
          headers: {
            authorization: 'Bearer synthetic-douyin-capture-token',
            cookie: 'SESSDATA=synthetic-douyin-capture-sessdata',
            accept: 'application/json',
          },
          body: {
            csrf: 'synthetic-douyin-capture-csrf',
            safe: true,
          },
          source: 'capture-manifest-networkRequests',
        },
      ],
    });

    await writeCaptureManifest(manifest);

    const written = JSON.parse(await readFile(manifestPath, 'utf8'));
    assert.equal(written.files.apiCandidates.length, 1);
    assert.equal(written.files.apiCandidateRedactionAudits.length, 1);
    assert.equal(written.files.apiCandidateDecisions.length, 1);
    assert.equal(written.files.apiCandidateDecisionRedactionAudits.length, 1);
    assert.equal(JSON.stringify(written).includes('synthetic-douyin-capture-token'), false);
    assert.equal(JSON.stringify(written).includes('synthetic-douyin-capture-sessdata'), false);
    assert.equal(JSON.stringify(written).includes('synthetic-douyin-capture-csrf'), false);

    const candidateText = await readFile(written.files.apiCandidates[0], 'utf8');
    const candidate = JSON.parse(candidateText);
    assert.equal(candidate.status, 'observed');
    assert.equal(candidate.siteKey, 'douyin');
    assert.equal(candidate.request.headers.authorization, REDACTION_PLACEHOLDER);
    assert.equal(candidate.request.headers.cookie, REDACTION_PLACEHOLDER);
    assert.equal(candidate.request.body.csrf, REDACTION_PLACEHOLDER);
    assert.equal(candidateText.includes('synthetic-douyin-capture-token'), false);
    assert.equal(candidateText.includes('synthetic-douyin-capture-sessdata'), false);
    assert.equal(candidateText.includes('synthetic-douyin-capture-csrf'), false);
    const candidateAuditText = await readFile(written.files.apiCandidateRedactionAudits[0], 'utf8');
    assert.equal(candidateAuditText.includes('synthetic-douyin-capture-token'), false);
    assert.equal(candidateAuditText.includes('synthetic-douyin-capture-sessdata'), false);
    assert.equal(candidateAuditText.includes('synthetic-douyin-capture-csrf'), false);

    const decisionText = await readFile(written.files.apiCandidateDecisions[0], 'utf8');
    const decision = JSON.parse(decisionText);
    assert.equal(decision.adapterId, 'douyin');
    assert.equal(decision.siteKey, 'douyin');
    assert.equal(decision.candidateId, candidate.id);
    assert.equal(decision.decision, 'accepted');
    assert.equal(decision.scope.validationMode, 'capture-observed-candidate');
    assert.equal(decision.scope.endpointHost, 'www.douyin.com');
    assert.equal(decision.scope.endpointPath, '/aweme/v1/web/aweme/detail/');
    assert.equal(Object.hasOwn(decision, 'catalogPath'), false);
    assert.equal(decisionText.includes('synthetic-douyin-capture-token'), false);
    assert.equal(decisionText.includes('synthetic-douyin-capture-sessdata'), false);
    assert.equal(decisionText.includes('synthetic-douyin-capture-csrf'), false);
    const decisionAuditText = await readFile(written.files.apiCandidateDecisionRedactionAudits[0], 'utf8');
    assert.equal(decisionAuditText.includes('synthetic-douyin-capture-token'), false);
    assert.equal(decisionAuditText.includes('synthetic-douyin-capture-sessdata'), false);
    assert.equal(decisionAuditText.includes('synthetic-douyin-capture-csrf'), false);

    const candidateLifecycleEvent = JSON.parse(await readFile(written.files.apiCandidateLifecycleEvent, 'utf8'));
    assert.equal(candidateLifecycleEvent.eventType, 'capture.api_candidates.written');
    assert.equal(candidateLifecycleEvent.traceId, 'capture-trace-synthetic-douyin-candidates');
    assert.equal(candidateLifecycleEvent.correlationId, 'capture-correlation-synthetic-douyin-candidates');
    assert.equal(candidateLifecycleEvent.siteKey, 'douyin');
    assert.equal(candidateLifecycleEvent.details.count, 1);
    assert.deepEqual(candidateLifecycleEvent.details.apiCandidateDecisions, written.files.apiCandidateDecisions);
    assert.equal(JSON.stringify(candidateLifecycleEvent).includes('synthetic-douyin-capture-token'), false);

    await assert.rejects(
      () => access(path.join(workspace, 'api-catalog', 'candidate-0001.json')),
      /ENOENT/u,
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('writeCaptureManifest writes Xiaohongshu SiteAdapter decision artifacts without catalog promotion', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-capture-xiaohongshu-api-decision-'));
  try {
    const manifestPath = path.join(workspace, 'manifest.json');
    const manifest = createManifest(manifestPath, {
      traceId: 'capture-trace-synthetic-xiaohongshu-candidates',
      correlationId: 'capture-correlation-synthetic-xiaohongshu-candidates',
      networkRequests: [
        {
          siteKey: 'xiaohongshu',
          method: 'GET',
          url: 'https://www.xiaohongshu.com/api/sns/web/v1/feed?note_id=synthetic&access_token=synthetic-xiaohongshu-capture-token&safe=1',
          headers: {
            authorization: 'Bearer synthetic-xiaohongshu-capture-token',
            cookie: 'SESSDATA=synthetic-xiaohongshu-capture-sessdata',
            accept: 'application/json',
          },
          body: {
            csrf: 'synthetic-xiaohongshu-capture-csrf',
            safe: true,
          },
          source: 'capture-manifest-networkRequests',
        },
      ],
    });

    await writeCaptureManifest(manifest);

    const written = JSON.parse(await readFile(manifestPath, 'utf8'));
    assert.equal(written.files.apiCandidates.length, 1);
    assert.equal(written.files.apiCandidateRedactionAudits.length, 1);
    assert.equal(written.files.apiCandidateDecisions.length, 1);
    assert.equal(written.files.apiCandidateDecisionRedactionAudits.length, 1);
    assert.equal(JSON.stringify(written).includes('synthetic-xiaohongshu-capture-token'), false);
    assert.equal(JSON.stringify(written).includes('synthetic-xiaohongshu-capture-sessdata'), false);
    assert.equal(JSON.stringify(written).includes('synthetic-xiaohongshu-capture-csrf'), false);

    const candidateText = await readFile(written.files.apiCandidates[0], 'utf8');
    const candidate = JSON.parse(candidateText);
    assert.equal(candidate.status, 'observed');
    assert.equal(candidate.siteKey, 'xiaohongshu');
    assert.equal(candidate.request.headers.authorization, REDACTION_PLACEHOLDER);
    assert.equal(candidate.request.headers.cookie, REDACTION_PLACEHOLDER);
    assert.equal(candidate.request.body.csrf, REDACTION_PLACEHOLDER);
    assert.equal(candidateText.includes('synthetic-xiaohongshu-capture-token'), false);
    assert.equal(candidateText.includes('synthetic-xiaohongshu-capture-sessdata'), false);
    assert.equal(candidateText.includes('synthetic-xiaohongshu-capture-csrf'), false);
    const candidateAuditText = await readFile(written.files.apiCandidateRedactionAudits[0], 'utf8');
    assert.equal(candidateAuditText.includes('synthetic-xiaohongshu-capture-token'), false);
    assert.equal(candidateAuditText.includes('synthetic-xiaohongshu-capture-sessdata'), false);
    assert.equal(candidateAuditText.includes('synthetic-xiaohongshu-capture-csrf'), false);

    const decisionText = await readFile(written.files.apiCandidateDecisions[0], 'utf8');
    const decision = JSON.parse(decisionText);
    assert.equal(decision.adapterId, 'xiaohongshu');
    assert.equal(decision.siteKey, 'xiaohongshu');
    assert.equal(decision.candidateId, candidate.id);
    assert.equal(decision.decision, 'accepted');
    assert.equal(decision.scope.validationMode, 'capture-observed-candidate');
    assert.equal(decision.scope.endpointHost, 'www.xiaohongshu.com');
    assert.equal(decision.scope.endpointPath, '/api/sns/web/v1/feed');
    assert.equal(Object.hasOwn(decision, 'catalogPath'), false);
    assert.equal(decisionText.includes('synthetic-xiaohongshu-capture-token'), false);
    assert.equal(decisionText.includes('synthetic-xiaohongshu-capture-sessdata'), false);
    assert.equal(decisionText.includes('synthetic-xiaohongshu-capture-csrf'), false);
    const decisionAuditText = await readFile(written.files.apiCandidateDecisionRedactionAudits[0], 'utf8');
    assert.equal(decisionAuditText.includes('synthetic-xiaohongshu-capture-token'), false);
    assert.equal(decisionAuditText.includes('synthetic-xiaohongshu-capture-sessdata'), false);
    assert.equal(decisionAuditText.includes('synthetic-xiaohongshu-capture-csrf'), false);

    const candidateLifecycleEvent = JSON.parse(await readFile(written.files.apiCandidateLifecycleEvent, 'utf8'));
    assert.equal(candidateLifecycleEvent.eventType, 'capture.api_candidates.written');
    assert.equal(candidateLifecycleEvent.traceId, 'capture-trace-synthetic-xiaohongshu-candidates');
    assert.equal(candidateLifecycleEvent.correlationId, 'capture-correlation-synthetic-xiaohongshu-candidates');
    assert.equal(candidateLifecycleEvent.siteKey, 'xiaohongshu');
    assert.equal(candidateLifecycleEvent.details.count, 1);
    assert.deepEqual(candidateLifecycleEvent.details.apiCandidateDecisions, written.files.apiCandidateDecisions);
    assert.equal(JSON.stringify(candidateLifecycleEvent).includes('synthetic-xiaohongshu-capture-token'), false);

    await assert.rejects(
      () => access(path.join(workspace, 'api-catalog', 'candidate-0001.json')),
      /ENOENT/u,
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('writeCaptureManifest writes rejected SiteAdapter decision artifacts without catalog promotion', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-capture-x-api-rejected-decision-'));
  try {
    const manifestPath = path.join(workspace, 'manifest.json');
    const manifest = createManifest(manifestPath, {
      traceId: 'capture-trace-synthetic-x-rejected-candidates',
      correlationId: 'capture-correlation-synthetic-x-rejected-candidates',
      networkRequests: [
        {
          siteKey: 'x',
          method: 'GET',
          url: 'https://x.com/not-api/graphql/synthetic/HomeTimeline?access_token=synthetic-x-rejected-token&safe=1',
          headers: {
            authorization: 'Bearer synthetic-x-rejected-token',
            cookie: 'SESSDATA=synthetic-x-rejected-sessdata',
            accept: 'application/json',
          },
          body: {
            csrf: 'synthetic-x-rejected-csrf',
            safe: true,
          },
          source: 'capture-manifest-networkRequests',
        },
      ],
    });

    await writeCaptureManifest(manifest);

    const written = JSON.parse(await readFile(manifestPath, 'utf8'));
    assert.equal(written.files.apiCandidates.length, 1);
    assert.equal(written.files.apiCandidateRedactionAudits.length, 1);
    assert.equal(written.files.apiCandidateDecisions.length, 1);
    assert.equal(written.files.apiCandidateDecisionRedactionAudits.length, 1);
    assert.equal(JSON.stringify(written).includes('synthetic-x-rejected-token'), false);
    assert.equal(JSON.stringify(written).includes('synthetic-x-rejected-sessdata'), false);
    assert.equal(JSON.stringify(written).includes('synthetic-x-rejected-csrf'), false);

    const candidateText = await readFile(written.files.apiCandidates[0], 'utf8');
    const candidate = JSON.parse(candidateText);
    assert.equal(candidate.status, 'observed');
    assert.equal(candidate.siteKey, 'x');
    assert.equal(candidate.request.headers.authorization, REDACTION_PLACEHOLDER);
    assert.equal(candidate.request.headers.cookie, REDACTION_PLACEHOLDER);
    assert.equal(candidate.request.body.csrf, REDACTION_PLACEHOLDER);
    assert.equal(candidateText.includes('synthetic-x-rejected-token'), false);
    assert.equal(candidateText.includes('synthetic-x-rejected-sessdata'), false);
    assert.equal(candidateText.includes('synthetic-x-rejected-csrf'), false);

    const decisionText = await readFile(written.files.apiCandidateDecisions[0], 'utf8');
    const decision = JSON.parse(decisionText);
    assert.equal(decision.adapterId, 'x');
    assert.equal(decision.siteKey, 'x');
    assert.equal(decision.candidateId, candidate.id);
    assert.equal(decision.decision, 'rejected');
    assert.equal(decision.reasonCode, 'api-verification-failed');
    assert.equal(decision.scope.validationMode, 'capture-observed-candidate');
    assert.equal(decision.scope.endpointHost, 'x.com');
    assert.equal(decision.scope.endpointPath, '/not-api/graphql/synthetic/HomeTimeline');
    assert.equal(Object.hasOwn(decision, 'catalogPath'), false);
    assert.equal(decisionText.includes('synthetic-x-rejected-token'), false);
    assert.equal(decisionText.includes('synthetic-x-rejected-sessdata'), false);
    assert.equal(decisionText.includes('synthetic-x-rejected-csrf'), false);
    const decisionAuditText = await readFile(written.files.apiCandidateDecisionRedactionAudits[0], 'utf8');
    assert.equal(decisionAuditText.includes('synthetic-x-rejected-token'), false);

    const candidateLifecycleEvent = JSON.parse(await readFile(written.files.apiCandidateLifecycleEvent, 'utf8'));
    assert.equal(candidateLifecycleEvent.eventType, 'capture.api_candidates.written');
    assert.equal(candidateLifecycleEvent.traceId, 'capture-trace-synthetic-x-rejected-candidates');
    assert.equal(candidateLifecycleEvent.correlationId, 'capture-correlation-synthetic-x-rejected-candidates');
    assert.equal(candidateLifecycleEvent.siteKey, 'x');
    assert.equal(candidateLifecycleEvent.details.count, 1);
    assert.deepEqual(candidateLifecycleEvent.details.apiCandidateDecisions, written.files.apiCandidateDecisions);
    assert.deepEqual(candidateLifecycleEvent.details.apiCandidateDecisionSummary, {
      count: 1,
      byDecision: {
        rejected: 1,
      },
      reasonCodes: {
        'api-verification-failed': 1,
      },
    });
    assert.equal(candidateLifecycleEvent.details.apiCandidateRiskStates.length, 1);
    const decisionRiskState = candidateLifecycleEvent.details.apiCandidateRiskStates[0];
    assert.equal(decisionRiskState.source, 'site-adapter-decision');
    assert.equal(decisionRiskState.candidateIndex, 0);
    assert.equal(decisionRiskState.adapterId, 'x');
    assert.equal(decisionRiskState.decision, 'rejected');
    assert.equal(decisionRiskState.reasonCode, 'api-verification-failed');
    assert.equal(decisionRiskState.reasonRecovery.retryable, true);
    assert.equal(decisionRiskState.reasonRecovery.catalogAction, 'deprecate');
    assert.equal(decisionRiskState.riskState.state, 'suspicious');
    assert.equal(decisionRiskState.riskState.reasonCode, 'api-verification-failed');
    assert.equal(decisionRiskState.riskState.siteKey, 'x');
    assert.equal(decisionRiskState.riskState.scope, 'capture-site-adapter-decision');
    assert.equal(decisionRiskState.riskState.transition.from, 'normal');
    assert.equal(decisionRiskState.riskState.transition.to, 'suspicious');
    assert.equal(decisionRiskState.riskState.recovery.catalogAction, 'deprecate');
    assert.equal(JSON.stringify(decisionRiskState).includes('/not-api/graphql/synthetic/HomeTimeline'), false);
    assert.equal(JSON.stringify(candidateLifecycleEvent).includes('/not-api/graphql/synthetic/HomeTimeline'), false);
    assert.equal(JSON.stringify(candidateLifecycleEvent).includes('synthetic-x-rejected-token'), false);

    await assert.rejects(
      () => access(path.join(workspace, 'api-catalog', 'candidate-0001.json')),
      /ENOENT/u,
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('writeCaptureManifest fails closed when capture networkRequests try promoted candidate status', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-capture-api-candidates-invalid-'));
  try {
    const manifestPath = path.join(workspace, 'manifest.json');
    const manifest = createManifest(manifestPath, {
      networkRequests: [
        {
          siteKey: 'example',
          status: 'verified',
          url: 'https://example.invalid/api/items',
        },
      ],
    });

    await assert.rejects(
      () => writeCaptureManifest(manifest),
      /status must be observed/u,
    );
    await assert.rejects(
      () => access(manifestPath),
      /ENOENT/u,
    );
    await assert.rejects(
      () => access(path.join(workspace, 'lifecycle-event.json')),
      /ENOENT/u,
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('writeCaptureManifest preflights capture networkRequests before any candidate artifact write', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-capture-api-candidates-batch-invalid-'));
  try {
    const manifestPath = path.join(workspace, 'manifest.json');
    const manifest = createManifest(manifestPath, {
      networkRequests: [
        {
          siteKey: 'example',
          url: 'https://example.invalid/api/valid?access_token=synthetic-capture-batch-token',
          headers: {
            authorization: 'Bearer synthetic-capture-batch-token',
          },
        },
        {
          siteKey: 'example',
          status: 'verified',
          url: 'https://example.invalid/api/promoted',
        },
      ],
    });

    await assert.rejects(
      () => writeCaptureManifest(manifest),
      /status must be observed/u,
    );
    await assert.rejects(
      () => access(manifestPath),
      /ENOENT/u,
    );
    await assert.rejects(
      () => access(path.join(workspace, 'api-candidates', 'candidate-0001.json')),
      /ENOENT/u,
    );
    await assert.rejects(
      () => access(path.join(workspace, 'api-candidate-redaction-audits', 'candidate-0001.redaction-audit.json')),
      /ENOENT/u,
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('writeCaptureManifest fails closed when lifecycle subscriber fails', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-capture-manifest-lifecycle-fail-'));
  try {
    const manifestPath = path.join(workspace, 'manifest.json');
    const manifest = createManifest(manifestPath);

    await assert.rejects(
      () => writeCaptureManifest(manifest, {
        lifecycleEventSubscribers: [async () => {
          throw new Error('synthetic-capture-lifecycle-failure');
        }],
      }),
      /synthetic-capture-lifecycle-failure/u,
    );
    await assert.rejects(
      () => readFile(manifestPath, 'utf8'),
      /ENOENT/u,
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('writeCaptureManifest fails closed when serialization would reintroduce a synthetic forbidden pattern', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-capture-manifest-redaction-fail-'));
  try {
    const manifestPath = path.join(workspace, 'manifest.json');
    const manifest = createManifest(manifestPath, {
      diagnostics: {
        safeWrapper: {
          toJSON() {
            return 'refresh_token=synthetic-refresh-token';
          },
        },
      },
    });

    await assert.rejects(
      () => writeCaptureManifest(manifest),
      /Forbidden sensitive pattern/u,
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
