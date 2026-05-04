import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';

import {
  SITE_CAPABILITY_DATA_FLOW_EVIDENCE_SCHEMA_VERSION,
  assertSiteCapabilityDataFlowEvidenceCompatible,
  createSiteCapabilityDataFlowEvidence,
  writeSiteCapabilityDataFlowEvidenceArtifacts,
} from '../../src/sites/capability/data-flow-evidence.mjs';
import {
  API_CANDIDATE_SCHEMA_VERSION,
  API_CATALOG_ENTRY_SCHEMA_VERSION,
} from '../../src/sites/capability/api-candidates.mjs';
import { DOWNLOAD_POLICY_SCHEMA_VERSION } from '../../src/sites/capability/download-policy.mjs';
import { LIFECYCLE_EVENT_SCHEMA_VERSION } from '../../src/sites/capability/lifecycle-events.mjs';
import { REASON_CODE_SCHEMA_VERSION } from '../../src/sites/capability/reason-codes.mjs';
import { REDACTION_PLACEHOLDER } from '../../src/sites/capability/security-guard.mjs';
import { STANDARD_TASK_LIST_SCHEMA_VERSION } from '../../src/sites/capability/standard-task-list.mjs';

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

test('Section 6 data-flow evidence links redacted capture to low-permission handoff', () => {
  const evidence = createSiteCapabilityDataFlowEvidence();

  assert.equal(evidence.schemaVersion, SITE_CAPABILITY_DATA_FLOW_EVIDENCE_SCHEMA_VERSION);
  assert.equal(assertSiteCapabilityDataFlowEvidenceCompatible(evidence), true);
  assert.equal(evidence.apiCandidate.schemaVersion, API_CANDIDATE_SCHEMA_VERSION);
  assert.equal(evidence.apiCandidate.status, 'candidate');
  assert.equal(evidence.verifiedApiCandidate.schemaVersion, API_CANDIDATE_SCHEMA_VERSION);
  assert.equal(evidence.verifiedApiCandidate.status, 'verified');
  assert.equal(evidence.catalogEntry.schemaVersion, API_CATALOG_ENTRY_SCHEMA_VERSION);
  assert.equal(evidence.catalogEntry.status, 'cataloged');
  assert.equal(evidence.catalogEntry.invalidationStatus, 'active');
  assert.equal(evidence.handoff.downloadPolicy.schemaVersion, DOWNLOAD_POLICY_SCHEMA_VERSION);
  assert.equal(evidence.handoff.downloadPolicy.dryRun, true);
  assert.equal(evidence.handoff.downloadPolicy.allowNetworkResolve, false);
  assert.equal(evidence.handoff.taskList.schemaVersion, STANDARD_TASK_LIST_SCHEMA_VERSION);
  assert.equal(evidence.handoff.taskList.items[0].kind, 'request');
  assert.equal(evidence.handoff.taskList.items[0].endpoint.includes('synthetic-section6-token'), false);
  assert.equal(evidence.lifecycle.candidateVerified.schemaVersion, LIFECYCLE_EVENT_SCHEMA_VERSION);
  assert.equal(evidence.lifecycle.catalogVerified.schemaVersion, LIFECYCLE_EVENT_SCHEMA_VERSION);
  assert.equal(evidence.lifecycle.candidateVerified.traceId, 'trace-section6-data-flow');
  assert.deepEqual(
    evidence.trustBoundaries.map(({ from, to, controls }) => ({ from, to, controls })),
    [
      {
        from: 'api-candidates',
        to: 'api-catalog',
        controls: ['minimized', 'permission-checked', 'redacted'],
      },
      {
        from: 'api-catalog',
        to: 'downloader',
        controls: ['minimized', 'permission-checked', 'redacted'],
      },
    ],
  );
  assert.equal(evidence.reasonCodes.schemaVersion, REASON_CODE_SCHEMA_VERSION);
  assert.deepEqual(
    evidence.reasonCodes.summaries.map(({ code }) => code),
    [
      'api-verification-failed',
      'schema-version-incompatible',
      'redaction-failed',
      'download-policy-generation-failed',
    ],
  );
  assert.equal(evidence.redactedCaptureEvidence.observedRequest.headers.authorization, REDACTION_PLACEHOLDER);
  assert.equal(evidence.redactedCaptureEvidence.observedRequest.body.csrf, REDACTION_PLACEHOLDER);
  assert.ok(evidence.redactionEvidence.capture.redactedPathCount >= 2);
  assert.doesNotMatch(
    JSON.stringify(evidence),
    /synthetic-section6-token|synthetic-section6-csrf|Bearer\s+|csrf=synthetic|access_token=synthetic/iu,
  );
});

test('Section 6 data-flow evidence keeps custom synthetic capture redacted', () => {
  const evidence = createSiteCapabilityDataFlowEvidence({
    siteKey: 'section6-custom',
    candidateId: 'section6-custom-candidate',
    captureFixture: {
      observedRequest: {
        method: 'POST',
        url: 'https://section6.example.invalid/api/custom?csrf=synthetic-custom-csrf&safe=1',
        headers: {
          cookie: 'SESSDATA=synthetic-custom-session',
          accept: 'application/json',
        },
        body: {
          accessToken: 'synthetic-custom-access-token',
          safe: true,
        },
      },
    },
  });

  assert.equal(assertSiteCapabilityDataFlowEvidenceCompatible(evidence), true);
  assert.equal(evidence.siteKey, 'section6-custom');
  assert.equal(evidence.apiCandidate.endpoint.method, 'POST');
  assert.equal(evidence.redactedCaptureEvidence.observedRequest.headers.cookie, REDACTION_PLACEHOLDER);
  assert.equal(evidence.redactedCaptureEvidence.observedRequest.body.accessToken, REDACTION_PLACEHOLDER);
  assert.doesNotMatch(
    JSON.stringify(evidence),
    /synthetic-custom-csrf|synthetic-custom-session|synthetic-custom-access-token|SESSDATA=/iu,
  );
});

test('Section 6 data-flow compatibility fails closed on schema and raw-sensitive drift', () => {
  const evidence = createSiteCapabilityDataFlowEvidence();

  assert.throws(
    () => assertSiteCapabilityDataFlowEvidenceCompatible({
      ...evidence,
      schemaVersion: SITE_CAPABILITY_DATA_FLOW_EVIDENCE_SCHEMA_VERSION + 1,
    }),
    /DataFlowEvidence schemaVersion 2 is not compatible/u,
  );
  assert.throws(
    () => assertSiteCapabilityDataFlowEvidenceCompatible({
      ...evidence,
      handoff: {
        ...evidence.handoff,
        diagnostic: 'Bearer synthetic-leaked-token',
      },
    }),
    /raw sensitive material|Forbidden sensitive pattern/u,
  );
  assert.throws(
    () => assertSiteCapabilityDataFlowEvidenceCompatible({
      ...evidence,
      reasonCodes: {
        ...evidence.reasonCodes,
        summaries: [
          ...evidence.reasonCodes.summaries,
          { code: 'unknown-section6-reason' },
        ],
      },
    }),
    /Unknown reasonCode/u,
  );
});

test('Section 6 data-flow artifact writer persists redacted handoff checkpoint and audit sidecar', async (t) => {
  const outputDir = await mkdtemp(path.join(process.cwd(), '.tmp-section6-data-flow-'));
  t.after(async () => {
    await rm(outputDir, { recursive: true, force: true });
  });

  const result = await writeSiteCapabilityDataFlowEvidenceArtifacts({
    siteKey: 'section6-artifacts',
    candidateId: 'section6-artifact-candidate',
    captureFixture: {
      observedRequest: {
        method: 'POST',
        url: 'https://section6.example.invalid/api/artifacts?access_token=synthetic-artifact-token&cursor=1',
        headers: {
          authorization: 'Bearer synthetic-artifact-token',
          accept: 'application/json',
        },
        body: {
          csrf: 'synthetic-artifact-csrf',
          safe: true,
        },
      },
    },
  }, { outputDir });

  assert.deepEqual(
    Object.keys(result.artifacts).sort(),
    ['handoff', 'lifecycle', 'manifest', 'redactionAudit'],
  );
  const manifest = await readJson(result.artifacts.manifest);
  const lifecycle = await readJson(result.artifacts.lifecycle);
  const handoff = await readJson(result.artifacts.handoff);
  const audit = await readJson(result.artifacts.redactionAudit);

  assert.equal(assertSiteCapabilityDataFlowEvidenceCompatible(manifest), true);
  assert.equal(manifest.siteKey, 'section6-artifacts');
  assert.equal(manifest.redactedCaptureEvidence.observedRequest.headers.authorization, REDACTION_PLACEHOLDER);
  assert.equal(manifest.redactedCaptureEvidence.observedRequest.body.csrf, REDACTION_PLACEHOLDER);
  assert.equal(lifecycle.evidenceType, 'site-capability-data-flow-lifecycle');
  assert.equal(lifecycle.lifecycle.candidateVerified.traceId, 'trace-section6-data-flow');
  assert.equal(handoff.evidenceType, 'site-capability-data-flow-handoff');
  assert.equal(handoff.handoff.downloadPolicy.dryRun, true);
  assert.equal(handoff.handoff.downloadPolicy.allowNetworkResolve, false);
  assert.equal(handoff.handoff.taskList.items[0].endpoint.includes('synthetic-artifact-token'), false);
  assert.equal(audit.evidenceType, 'site-capability-data-flow-redaction-audit');
  assert.equal(audit.artifacts.manifest.fileName, 'site-capability-data-flow-manifest.json');
  assert.equal(audit.artifacts.handoff.fileName, 'site-capability-data-flow-handoff.json');
  assert.ok(audit.artifacts.manifest.redactionSummary.redactedPathCount >= 1);
  assert.ok(audit.redactionAudits.manifest.redactedPaths.length >= 1);

  const artifactBundle = JSON.stringify({ manifest, lifecycle, handoff, audit });
  assert.doesNotMatch(
    artifactBundle,
    /synthetic-artifact-token|synthetic-artifact-csrf|Bearer\s+|access_token=synthetic|csrf=synthetic/iu,
  );
});

test('Section 6 data-flow artifact writer fails closed before artifact write on raw-sensitive evidence', async (t) => {
  const outputDir = await mkdtemp(path.join(process.cwd(), '.tmp-section6-data-flow-fail-'));
  t.after(async () => {
    await rm(outputDir, { recursive: true, force: true });
  });
  const evidence = createSiteCapabilityDataFlowEvidence();

  await assert.rejects(
    () => writeSiteCapabilityDataFlowEvidenceArtifacts({
      evidence: {
        ...evidence,
        diagnostic: 'Bearer synthetic-leaked-token',
      },
    }, { outputDir }),
    /raw sensitive material|Forbidden sensitive pattern/u,
  );

  await assert.rejects(
    () => readFile(path.join(outputDir, 'site-capability-data-flow-manifest.json'), 'utf8'),
    /ENOENT/u,
  );
});
