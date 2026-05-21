import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import {
  API_CANDIDATE_SCHEMA_VERSION,
  SITE_ADAPTER_CANDIDATE_DECISION_VERSION,
  SITE_ADAPTER_CATALOG_UPGRADE_POLICY_VERSION,
  writeApiCatalogEntryArtifact,
} from '../../src/domain/capabilities/api-candidates.mjs';
import { REDACTION_PLACEHOLDER } from '../../src/domain/sessions/security-guard.mjs';
import { moodyzAdapter } from '../../src/sites/adapters/moodyz.mjs';

function createMoodyzCandidate(overrides = /** @type {any} */ ({})) {
  return {
    schemaVersion: API_CANDIDATE_SCHEMA_VERSION,
    id: 'moodyz-local-validation-candidate',
    siteKey: 'moodyz',
    status: 'candidate',
    endpoint: {
      method: 'GET',
      url: 'https://moodyz.com/api/v1/works?access_token=synthetic-moodyz-local-token',
    },
    request: {
      headers: {
        authorization: 'Bearer synthetic-moodyz-local-token',
      },
    },
    ...overrides,
  };
}

test('moodyz local validation accepts only moodyz API candidates without writing catalog metadata', async () => {
  const candidate = createMoodyzCandidate();
  // @ts-ignore
  const decision = moodyzAdapter.validateApiCandidate({
    candidate,
    validatedAt: '2026-05-03T00:00:00.000Z',
    evidence: {
      authorization: 'Bearer synthetic-moodyz-local-token',
      sampleCount: 1,
    },
  });

  assert.equal(decision.contractVersion, SITE_ADAPTER_CANDIDATE_DECISION_VERSION);
  assert.equal(decision.decision, 'accepted');
  assert.equal(decision.adapterId, 'moodyz');
  assert.equal(decision.scope.validationMode, 'moodyz-api-candidate');
  assert.equal(decision.scope.endpointHost, 'moodyz.com');
  assert.equal(decision.scope.endpointPath, '/api/v1/works');
  assert.equal(decision.evidence.authorization, REDACTION_PLACEHOLDER);
  assert.equal(Object.hasOwn(decision, 'catalogPath'), false);
  assert.equal(Object.hasOwn(decision, 'catalogEntry'), false);

  await assert.rejects(
    writeApiCatalogEntryArtifact(candidate, { catalogPath: path.join('unused', 'moodyz-local-catalog.json') }),
    /ApiCandidate must be verified before catalog entry/u,
  );
});

test('moodyz local validation rejects wrong host, path, and site key with API reason codes', () => {
  const cases = [
    createMoodyzCandidate({
      id: 'moodyz-local-wrong-host',
      endpoint: {
        method: 'GET',
        url: 'https://example.invalid/api/v1/works?access_token=synthetic-moodyz-local-token',
      },
    }),
    createMoodyzCandidate({
      id: 'moodyz-local-wrong-path',
      endpoint: {
        method: 'GET',
        url: 'https://moodyz.com/works/date?access_token=synthetic-moodyz-local-token',
      },
    }),
    createMoodyzCandidate({
      id: 'moodyz-local-wrong-site',
      siteKey: 'other-site',
    }),
  ];

  for (const candidate of cases) {
    // @ts-ignore
    const decision = moodyzAdapter.validateApiCandidate({
      candidate,
      evidence: {
        authorization: 'Bearer synthetic-moodyz-local-token',
      },
    });

    assert.equal(decision.decision, 'rejected');
    assert.equal(decision.reasonCode, 'api-verification-failed');
    assert.equal(decision.adapterId, 'moodyz');
    assert.equal(decision.evidence.authorization, REDACTION_PLACEHOLDER);
    assert.equal(Object.hasOwn(decision, 'catalogPath'), false);
    assert.equal(Object.hasOwn(decision, 'catalogEntry'), false);
  }
});

test('moodyz local catalog upgrade policy is pure and explicitly gated', () => {
  const candidate = createMoodyzCandidate({
    id: 'moodyz-local-verified-candidate',
    status: 'verified',
  });
  // @ts-ignore
  const decision = moodyzAdapter.validateApiCandidate({ candidate });
  // @ts-ignore
  const policy = moodyzAdapter.getApiCatalogUpgradePolicy({
    candidate,
    siteAdapterDecision: decision,
    decidedAt: '2026-05-03T00:01:00.000Z',
    evidence: {
      authorization: 'Bearer synthetic-moodyz-local-token',
      sampleCount: 1,
    },
  });

  assert.equal(policy.contractVersion, SITE_ADAPTER_CATALOG_UPGRADE_POLICY_VERSION);
  assert.equal(policy.allowCatalogUpgrade, true);
  assert.equal(policy.adapterId, 'moodyz');
  assert.equal(policy.scope.policyMode, 'moodyz-api');
  assert.equal(policy.evidence.authorization, REDACTION_PLACEHOLDER);
  assert.equal(Object.hasOwn(policy, 'artifactPath'), false);
  assert.equal(Object.hasOwn(policy, 'catalogPath'), false);
  assert.equal(Object.hasOwn(policy, 'catalogEntry'), false);

  const blockedCandidate = createMoodyzCandidate({
    id: 'moodyz-local-blocked-candidate',
    status: 'verified',
    endpoint: {
      method: 'GET',
      url: 'https://moodyz.com/works/date?access_token=synthetic-moodyz-local-token',
    },
  });
  // @ts-ignore
  const blockedDecision = moodyzAdapter.validateApiCandidate({ candidate: blockedCandidate });
  // @ts-ignore
  const blockedPolicy = moodyzAdapter.getApiCatalogUpgradePolicy({
    candidate: blockedCandidate,
    siteAdapterDecision: blockedDecision,
  });

  assert.equal(blockedPolicy.allowCatalogUpgrade, false);
  assert.equal(blockedPolicy.reasonCode, 'api-catalog-entry-blocked');
  assert.equal(Object.hasOwn(blockedPolicy, 'catalogPath'), false);
  assert.equal(Object.hasOwn(blockedPolicy, 'catalogEntry'), false);
});
