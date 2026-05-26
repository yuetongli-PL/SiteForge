import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { listSiteAdapters } from '../../src/sites/adapters/resolver.mjs';
import {
  GENERIC_NAVIGATION_ADAPTER_VERSION,
  SITE_ADAPTER_SEMANTIC_ENTRY_VERSION,
} from '../../src/sites/adapters/generic-navigation.mjs';
import {
  API_CANDIDATE_SCHEMA_VERSION,
  SITE_ADAPTER_CANDIDATE_DECISION_VERSION,
  SITE_ADAPTER_CATALOG_UPGRADE_POLICY_VERSION,
  assertApiCatalogUpgradeDecisionAllowsCatalog,
  createApiCatalogUpgradeDecision,
  normalizeSiteAdapterCandidateDecision,
  writeApiCatalogEntryArtifact,
  writeVerifiedApiCatalogUpgradeFixtureArtifacts,
} from '../../src/domain/capabilities/api-candidates.mjs';
import { assertSchemaCompatible } from '../../src/domain/schemas/compatibility-registry.mjs';
import { requireReasonCodeDefinition } from '../../src/domain/risks/reason-codes.mjs';
import { REDACTION_PLACEHOLDER } from '../../src/domain/sessions/security-guard.mjs';
import { normalizeSiteAdapterHealthSignal } from '../../src/domain/risks/site-health-recovery.mjs';

const ADAPTERS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../src/sites/adapters',
);

const FORBIDDEN_PROMOTION_METHODS = [
  'writeApiCandidateArtifact',
  'writeApiCatalogEntryArtifact',
  'createApiCatalogEntryFromCandidate',
  'persistCatalog',
  'writeArtifact',
];

const FORBIDDEN_SEMANTIC_OUTPUT_FIELDS = [
  'artifactPath',
  'catalogPath',
  'catalogEntry',
  'request',
  'response',
];

const FORBIDDEN_ADAPTER_SOURCE_PATTERNS = [
  /\bwriteApiCatalogEntryArtifact\b/u,
  /\bwriteApiCandidateArtifact\b/u,
  /\bcreateApiCatalogEntryFromCandidate\b/u,
  /\bpersistCatalog\b/u,
  /\bwriteArtifact\b/u,
  /from\s+['"]node:fs(?:\/promises)?['"]/u,
  /\bwriteFile\s*\(/u,
  /\bmkdir\s*\(/u,
];

function assertNoForbiddenSemanticKeys(value, pathLabel = 'semantics') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoForbiddenSemanticKeys(item, `${pathLabel}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') {
    return;
  }

  for (const field of FORBIDDEN_SEMANTIC_OUTPUT_FIELDS) {
    assert.equal(
      Object.hasOwn(value, field),
      false,
      `${pathLabel} must not expose ${field}`,
    );
  }
  for (const [key, nestedValue] of Object.entries(value)) {
    assertNoForbiddenSemanticKeys(nestedValue, `${pathLabel}.${key}`);
  }
}

function resolveAdapterSiteKey(adapter) {
  return typeof adapter.siteKey === 'function'
    ? adapter.siteKey({
      host: 'www.22biqu.com',
      profile: { host: 'www.22biqu.com' },
    })
    : adapter.siteKey;
}

function createSyntheticCandidate(overrides = /** @type {any} */ ({})) {
  return {
    schemaVersion: API_CANDIDATE_SCHEMA_VERSION,
    id: 'candidate-1',
    siteKey: 'example',
    status: 'candidate',
    endpoint: {
      method: 'GET',
      url: 'https://example.invalid/api/items?access_token=synthetic-adapter-token',
    },
    request: {
      headers: {
        authorization: 'Bearer synthetic-adapter-token',
      },
    },
    ...overrides,
  };
}

test('registered SiteAdapters expose the minimum Site Capability contract', () => {
  const adapters = listSiteAdapters();
  assert.equal(adapters.length > 0, true);

  const ids = new Set();
  for (const adapter of adapters) {
    assert.equal(typeof adapter.id, 'string', 'adapter.id must be a string');
    assert.notEqual(adapter.id.trim(), '', 'adapter.id must be non-empty');
    assert.equal(ids.has(adapter.id), false, `adapter id must be unique: ${adapter.id}`);
    ids.add(adapter.id);

    const siteKey = resolveAdapterSiteKey(adapter);
    assert.equal(typeof siteKey, 'string', `${adapter.id}.siteKey must resolve to a string`);
    assert.notEqual(siteKey.trim(), '', `${adapter.id}.siteKey must resolve to a non-empty value`);

    assert.equal(typeof adapter.matches, 'function', `${adapter.id}.matches must be a function`);
    assert.equal(typeof adapter.matches({
      host: 'example.test',
      inputUrl: 'https://example.test/',
      profile: { host: 'example.test' },
    }), 'boolean', `${adapter.id}.matches must return a boolean`);

    assert.equal(typeof adapter.inferPageType, 'function', `${adapter.id}.inferPageType must be a function`);
    assert.doesNotThrow(() => adapter.inferPageType({
      inputUrl: 'https://example.test/',
      pathname: '/',
      profile: { host: 'example.test' },
    }), `${adapter.id}.inferPageType must tolerate a minimal context`);

    assert.equal(typeof adapter.classifyPath, 'function', `${adapter.id}.classifyPath must be a function`);
    const classification = adapter.classifyPath({ pathname: '/', inputUrl: 'https://example.test/' });
    assert.equal(
      classification === null || typeof classification === 'object',
      true,
      `${adapter.id}.classifyPath must return an object or null`,
    );

    if (adapter.version !== undefined) {
      assert.equal(['string', 'number'].includes(typeof adapter.version), true, `${adapter.id}.version must be scalar`);
    }
  }
});

test('registered SiteAdapters expose pure onboarding node and API classification hooks', () => {
  for (const adapter of listSiteAdapters()) {
    assert.equal(typeof adapter.classifyNode, 'function', `${adapter.id}.classifyNode must be a function`);
    assert.equal(typeof adapter.classifyApi, 'function', `${adapter.id}.classifyApi must be a function`);

    const nodeDecision = adapter.classifyNode({
      id: `${adapter.id}-login-state`,
      kind: 'login-state',
      required: true,
      locator: 'https://example.invalid/login?access_token=synthetic-node-token',
      headers: {
        authorization: 'Bearer synthetic-node-token',
      },
    });
    const apiDecision = adapter.classifyApi({
      id: `${adapter.id}-api`,
      required: true,
      method: 'GET',
      url: 'https://example.invalid/api/feed?csrf_token=synthetic-api-token',
      request: {
        headers: {
          cookie: 'SESSDATA=synthetic-api-cookie',
        },
      },
    });

    for (const [label, decision] of [
      [`${adapter.id}.classifyNode`, nodeDecision],
      [`${adapter.id}.classifyApi`, apiDecision],
    ]) {
      assert.equal(decision && typeof decision === 'object' && !Array.isArray(decision), true);
      // @ts-ignore
      assert.equal(['recognized', 'unknown', 'ignored'].includes(decision.classification), true);
      // @ts-ignore
      assert.equal(typeof decision.required, 'boolean');
      // @ts-ignore
      assertNoForbiddenSemanticKeys(decision, label);
      const serialized = JSON.stringify(decision);
      assert.equal(serialized.includes('synthetic-node-token'), false);
      assert.equal(serialized.includes('synthetic-api-token'), false);
      assert.equal(serialized.includes('synthetic-api-cookie'), false);
      assert.equal(serialized.includes('SESSDATA='), false);
      assert.equal(serialized.includes('Bearer '), false);
    }
  }
});

test('risk-aware SiteAdapters map csrf signals to the generic health taxonomy', () => {
  const csrfAwareAdapterIds = new Set([
    'bilibili',
    'douyin',
    'instagram',
    'x',
    'xiaohongshu',
  ]);
  const adapters = listSiteAdapters().filter((adapter) => csrfAwareAdapterIds.has(adapter.id));
  assert.deepEqual(adapters.map((adapter) => adapter.id).sort(), [...csrfAwareAdapterIds].sort());

  for (const adapter of adapters) {
    const normalized = normalizeSiteAdapterHealthSignal(adapter, {
      rawSignal: 'csrf',
      affectedCapability: 'api.auth',
    }, {
      siteId: adapter.id,
    });
    assert.equal(normalized.type, 'csrf-invalid', `${adapter.id} csrf health signal must not normalize to unknown`);
    assert.equal(normalized.autoRecoverable, true, `${adapter.id} csrf health signal should use the generic refresh-token path`);
    assert.equal(normalized.requiresUserAction, false, `${adapter.id} csrf health signal should not require bypass-like user action`);
  }
});

test('risk-aware SiteAdapters keep login-required as manual recovery only', () => {
  const loginAwareAdapterIds = new Set([
    'bilibili',
    'douyin',
    'instagram',
    'x',
    'xiaohongshu',
  ]);
  const adapters = listSiteAdapters().filter((adapter) => loginAwareAdapterIds.has(adapter.id));
  assert.deepEqual(adapters.map((adapter) => adapter.id).sort(), [...loginAwareAdapterIds].sort());

  for (const adapter of adapters) {
    const normalized = normalizeSiteAdapterHealthSignal(adapter, {
      rawSignal: 'login-required',
      affectedCapability: 'auth.session',
    }, {
      siteId: adapter.id,
    });
    assert.equal(normalized.type, 'login-required');
    assert.equal(normalized.autoRecoverable, false, `${adapter.id} login-required must not auto recover`);
    assert.equal(normalized.requiresUserAction, true, `${adapter.id} login-required must require user action`);
  }
});

test('X profile-health-risk adapter mapping is platform risk and not auto-recoverable', () => {
  const adapter = listSiteAdapters().find((candidate) => candidate.id === 'x');
  assert.ok(adapter);
  const normalized = normalizeSiteAdapterHealthSignal(adapter, {
    rawSignal: 'profile-health-risk',
    affectedCapability: 'profile.read',
  }, {
    siteId: 'x',
  });

  assert.equal(normalized.type, 'platform-risk-detected');
  assert.equal(normalized.affectedCapability, 'profile.read');
  assert.equal(normalized.autoRecoverable, false);
  assert.equal(normalized.requiresUserAction, true);
});

test('registered SiteAdapters expose a redacted pure API semantics entry contract', () => {
  for (const adapter of listSiteAdapters()) {
    const siteKey = resolveAdapterSiteKey(adapter);
    assert.equal(
      typeof adapter.describeApiCandidateSemantics,
      'function',
      `${adapter.id}.describeApiCandidateSemantics must be a function`,
    );

    const semantics = adapter.describeApiCandidateSemantics({
      candidate: createSyntheticCandidate({
        id: `${adapter.id}-semantic-candidate`,
        siteKey,
        auth: {
          authorization: 'Bearer synthetic-site-semantics-token',
          cookie: 'SESSDATA=synthetic-site-semantics-cookie',
        },
        pagination: {
          paginationModel: 'cursor',
          cursorParam: 'cursor',
        },
        fieldMapping: {
          itemsPath: 'data.items',
        },
        risk: {
          riskState: 'normal',
        },
      }),
      scope: {
        pageType: 'profile',
        authorization: 'Bearer synthetic-site-semantics-scope-token',
      },
    });

    assert.equal(semantics.contractVersion, SITE_ADAPTER_SEMANTIC_ENTRY_VERSION);
    assert.equal(semantics.adapterId, adapter.id);
    assert.equal(semantics.candidateId, `${adapter.id}-semantic-candidate`);
    assert.equal(semantics.siteKey, siteKey);
    assert.equal(typeof semantics.scope, 'object');
    assert.equal(typeof semantics.auth, 'object');
    assert.equal(typeof semantics.pagination, 'object');
    assert.equal(typeof semantics.fieldMapping, 'object');
    assert.equal(typeof semantics.risk, 'object');
    assert.equal(semantics.auth.authorization, REDACTION_PLACEHOLDER);
    assert.equal(semantics.auth.cookie, REDACTION_PLACEHOLDER);
    assert.equal(semantics.scope.authorization, REDACTION_PLACEHOLDER);

    for (const field of FORBIDDEN_SEMANTIC_OUTPUT_FIELDS) {
      assert.equal(
        Object.hasOwn(semantics, field),
        false,
        `${adapter.id}.describeApiCandidateSemantics must not expose ${field}`,
      );
    }

    const serialized = JSON.stringify(semantics);
    assert.equal(serialized.includes('synthetic-site-semantics'), false);
    assert.equal(serialized.includes('SESSDATA='), false);
    assert.equal(serialized.includes('Bearer '), false);
  }
});

test('registered SiteAdapters do not expose API knowledge promotion writers', () => {
  for (const adapter of listSiteAdapters()) {
    for (const method of FORBIDDEN_PROMOTION_METHODS) {
      assert.equal(
        method in adapter,
        false,
        `${adapter.id} must not expose ${method}; catalog persistence belongs to capability services`,
      );
    }
  }
});

test('SiteAdapter sources do not bypass API knowledge artifact boundaries', async () => {
  const entries = await readdir(ADAPTERS_DIR, { withFileTypes: true });
  const adapterFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.mjs'))
    .map((entry) => path.join(ADAPTERS_DIR, entry.name));

  assert.equal(adapterFiles.length > 0, true);

  for (const filePath of adapterFiles) {
    const source = await readFile(filePath, 'utf8');
    for (const pattern of FORBIDDEN_ADAPTER_SOURCE_PATTERNS) {
      assert.equal(
        pattern.test(source),
        false,
        `${path.basename(filePath)} must not import or call catalog/artifact writer capability: ${pattern}`,
      );
    }
  }
});

test('Xiaohongshu restriction hook returns a safe SiteAdapter risk contract', () => {
  const adapter = listSiteAdapters().find((candidate) => candidate.id === 'xiaohongshu');
  assert.notEqual(adapter, undefined);
  // @ts-ignore
  assert.equal(typeof adapter.detectRestrictionPage, 'function');

  // @ts-ignore
  const restriction = adapter.detectRestrictionPage({
    inputUrl: 'https://www.xiaohongshu.com/explore?access_token=synthetic-xhs-token',
    finalUrl: 'https://www.xiaohongshu.com/website-login/error?error_code=300012&redirectPath=%2Fexplore&access_token=synthetic-xhs-token',
    title: 'security restriction',
    pageType: 'auth-page',
    pageFacts: {
      antiCrawlDetected: true,
      antiCrawlSignals: ['verify'],
      antiCrawlReasonCode: 'anti-crawl-verify',
      riskPageDetected: true,
      riskPageCode: '300012',
      riskPageMessage: 'Authorization: Bearer synthetic-xhs-token',
    },
    runtimeEvidence: {
      antiCrawlDetected: true,
      antiCrawlSignals: ['ip-risk'],
    },
  });

  assert.equal(restriction.restrictionDetected, true);
  assert.equal(restriction.reasonCode, 'anti-crawl-verify');
  assert.equal(restriction.antiCrawlReasonCode, 'anti-crawl-verify');
  assert.equal(requireReasonCodeDefinition(restriction.reasonCode, { family: 'risk' }).code, restriction.reasonCode);
  assert.equal(requireReasonCodeDefinition(restriction.riskCauseCode, { family: 'risk' }).code, restriction.riskCauseCode);
  assert.equal(restriction.finalUrl.includes('synthetic-xhs-token'), false);
  assert.equal(restriction.finalUrl.includes(REDACTION_PLACEHOLDER), true);
  assert.equal(JSON.stringify(restriction).includes('synthetic-xhs-token'), false);
  assert.equal(Object.hasOwn(restriction, 'artifactPath'), false);
  assert.equal(Object.hasOwn(restriction, 'catalogPath'), false);
  assert.equal(Object.hasOwn(restriction, 'catalogEntry'), false);
  assert.equal(Object.hasOwn(restriction, 'request'), false);
  assert.equal(Object.hasOwn(restriction, 'response'), false);
});

test('SiteAdapter candidate validation decisions expose a positive structured contract', () => {
  const decision = normalizeSiteAdapterCandidateDecision({
    adapterId: 'synthetic-adapter',
    adapterVersion: '2026-05-01',
    decision: 'accepted',
    validatedAt: '2026-05-01T00:00:00.000Z',
    scope: {
      pageType: 'profile',
    },
    evidence: {
      authorization: 'Bearer synthetic-adapter-token',
      sampleCount: 1,
    },
  }, {
    candidate: createSyntheticCandidate(),
  });

  assert.equal(decision.contractVersion, SITE_ADAPTER_CANDIDATE_DECISION_VERSION);
  assert.equal(decision.candidateId, 'candidate-1');
  assert.equal(decision.siteKey, 'example');
  assert.equal(decision.adapterId, 'synthetic-adapter');
  assert.equal(decision.adapterVersion, '2026-05-01');
  assert.equal(decision.decision, 'accepted');
  assert.equal(Object.hasOwn(decision, 'reasonCode'), false);
  assert.equal(decision.scope.pageType, 'profile');
  assert.equal(decision.evidence.authorization, REDACTION_PLACEHOLDER);
  assert.equal(decision.evidence.sampleCount, 1);
  assert.equal(Object.hasOwn(decision, 'artifactPath'), false);
  assert.equal(Object.hasOwn(decision, 'catalogPath'), false);
});

test('SiteAdapter candidate validation decisions require API reasonCodes for rejected or blocked results', () => {
  const rejected = normalizeSiteAdapterCandidateDecision({
    adapterId: 'synthetic-adapter',
    decision: 'rejected',
    reasonCode: 'api-verification-failed',
  }, {
    candidate: createSyntheticCandidate(),
  });
  const blocked = normalizeSiteAdapterCandidateDecision({
    adapterId: 'synthetic-adapter',
    decision: 'blocked',
    reasonCode: 'api-catalog-entry-blocked',
  }, {
    candidate: createSyntheticCandidate(),
  });

  assert.equal(rejected.reasonCode, 'api-verification-failed');
  assert.equal(blocked.reasonCode, 'api-catalog-entry-blocked');
  assert.throws(
    () => normalizeSiteAdapterCandidateDecision({
      adapterId: 'synthetic-adapter',
      decision: 'blocked',
    }, {
      candidate: createSyntheticCandidate(),
    }),
    /reasonCode is required/u,
  );
  assert.throws(
    () => normalizeSiteAdapterCandidateDecision({
      adapterId: 'synthetic-adapter',
      decision: 'rejected',
      reasonCode: 'download-failed',
    }, {
      candidate: createSyntheticCandidate(),
    }),
    /belongs to download, not api/u,
  );
});

test('SiteAdapter candidate validation decisions do not bypass verified-only catalog promotion', async () => {
  const candidate = createSyntheticCandidate({ status: 'candidate' });
  const decision = normalizeSiteAdapterCandidateDecision({
    adapterId: 'synthetic-adapter',
    decision: 'accepted',
  }, {
    candidate,
  });

  assert.equal(decision.decision, 'accepted');
  await assert.rejects(
    writeApiCatalogEntryArtifact(candidate, { catalogPath: path.join('unused', 'catalog.json') }),
    /ApiCandidate must be verified before catalog entry/u,
  );
});

test('generic-navigation adapter exposes a pure candidate validation decision method', async () => {
  const adapter = listSiteAdapters().find((candidate) => candidate.id === 'generic-navigation');
  assert.notEqual(adapter, undefined);
  // @ts-ignore
  assert.equal(typeof adapter.validateApiCandidate, 'function');

  const candidate = createSyntheticCandidate({
    id: 'generic-candidate-1',
    siteKey: 'generic-navigation',
  });
  // @ts-ignore
  const decision = adapter.validateApiCandidate({
    candidate,
    validatedAt: '2026-05-01T01:00:00.000Z',
    evidence: {
      authorization: 'Bearer synthetic-generic-adapter-token',
      sampleCount: 1,
    },
  });

  assert.equal(decision.contractVersion, SITE_ADAPTER_CANDIDATE_DECISION_VERSION);
  assert.equal(decision.candidateId, 'generic-candidate-1');
  assert.equal(decision.siteKey, 'generic-navigation');
  assert.equal(decision.adapterId, 'generic-navigation');
  assert.equal(decision.adapterVersion, GENERIC_NAVIGATION_ADAPTER_VERSION);
  assert.equal(decision.decision, 'accepted');
  assert.equal(decision.scope.validationMode, 'synthetic-non-auth');
  assert.equal(decision.evidence.authorization, REDACTION_PLACEHOLDER);
  assert.equal(Object.hasOwn(decision, 'artifactPath'), false);
  assert.equal(Object.hasOwn(decision, 'catalogPath'), false);

  await assert.rejects(
    writeApiCatalogEntryArtifact(candidate, { catalogPath: path.join('unused', 'generic-catalog.json') }),
    /ApiCandidate must be verified before catalog entry/u,
  );
});

test('generic-navigation adapter exposes a pure catalog upgrade policy hook without promotion', () => {
  const adapter = listSiteAdapters().find((candidate) => candidate.id === 'generic-navigation');
  assert.notEqual(adapter, undefined);
  // @ts-ignore
  assert.equal(typeof adapter.getApiCatalogUpgradePolicy, 'function');

  const candidate = createSyntheticCandidate({
    id: 'generic-upgrade-policy-candidate',
    siteKey: 'generic-navigation',
    status: 'verified',
  });
  // @ts-ignore
  const decision = adapter.validateApiCandidate({
    candidate,
    validatedAt: '2026-05-01T15:10:00.000Z',
  });
  // @ts-ignore
  const policy = adapter.getApiCatalogUpgradePolicy({
    candidate,
    siteAdapterDecision: decision,
    decidedAt: '2026-05-01T15:11:00.000Z',
    evidence: {
      authorization: 'Bearer synthetic-generic-policy-token',
      sampleCount: 1,
    },
  });

  assert.equal(policy.contractVersion, SITE_ADAPTER_CATALOG_UPGRADE_POLICY_VERSION);
  assert.equal(policy.candidateId, 'generic-upgrade-policy-candidate');
  assert.equal(policy.siteKey, 'generic-navigation');
  assert.equal(policy.adapterId, 'generic-navigation');
  assert.equal(policy.adapterVersion, GENERIC_NAVIGATION_ADAPTER_VERSION);
  assert.equal(policy.allowCatalogUpgrade, true);
  assert.equal(policy.scope.policyMode, 'synthetic-non-auth');
  assert.equal(policy.evidence.authorization, REDACTION_PLACEHOLDER);
  assert.equal(Object.hasOwn(policy, 'artifactPath'), false);
  assert.equal(Object.hasOwn(policy, 'catalogPath'), false);
  assert.equal(Object.hasOwn(policy, 'catalogEntry'), false);

  const upgradeDecision = createApiCatalogUpgradeDecision({
    candidate,
    siteAdapterDecision: decision,
    policy,
  });
  assert.equal(upgradeDecision.decision, 'allowed');
  assert.equal(assertApiCatalogUpgradeDecisionAllowsCatalog(upgradeDecision), upgradeDecision);

  // @ts-ignore
  const rejectedDecision = adapter.validateApiCandidate({
    candidate: {
      ...candidate,
      id: 'generic-upgrade-policy-rejected',
      siteKey: 'other-site',
    },
  });
  // @ts-ignore
  const blockedPolicy = adapter.getApiCatalogUpgradePolicy({
    candidate: {
      ...candidate,
      id: 'generic-upgrade-policy-rejected',
      siteKey: 'other-site',
    },
    siteAdapterDecision: rejectedDecision,
  });
  assert.equal(blockedPolicy.allowCatalogUpgrade, false);
  assert.equal(blockedPolicy.siteKey, 'other-site');
  assert.equal(blockedPolicy.adapterVersion, GENERIC_NAVIGATION_ADAPTER_VERSION);
  assert.equal(blockedPolicy.reasonCode, 'api-catalog-entry-blocked');
  assert.equal(Object.hasOwn(blockedPolicy, 'artifactPath'), false);
  assert.equal(Object.hasOwn(blockedPolicy, 'catalogPath'), false);
  assert.equal(Object.hasOwn(blockedPolicy, 'catalogEntry'), false);
});

test('generic-navigation adapter blocks accepted but unverified candidates from catalog upgrade', () => {
  const adapter = listSiteAdapters().find((candidate) => candidate.id === 'generic-navigation');
  assert.notEqual(adapter, undefined);

  const candidate = createSyntheticCandidate({
    id: 'generic-unverified-policy-candidate',
    siteKey: 'generic-navigation',
    status: 'candidate',
  });
  // @ts-ignore
  const decision = adapter.validateApiCandidate({
    candidate,
    validatedAt: '2026-05-01T15:20:00.000Z',
  });
  // @ts-ignore
  const policy = adapter.getApiCatalogUpgradePolicy({
    candidate,
    siteAdapterDecision: decision,
    decidedAt: '2026-05-01T15:21:00.000Z',
  });

  assert.equal(decision.decision, 'accepted');
  assert.equal(decision.adapterVersion, GENERIC_NAVIGATION_ADAPTER_VERSION);
  assert.equal(Object.hasOwn(decision, 'reasonCode'), false);
  assert.equal(policy.allowCatalogUpgrade, false);
  assert.equal(policy.adapterVersion, GENERIC_NAVIGATION_ADAPTER_VERSION);
  assert.equal(policy.reasonCode, 'api-catalog-entry-blocked');
  assert.equal(Object.hasOwn(policy, 'catalogPath'), false);
  assert.equal(Object.hasOwn(policy, 'catalogEntry'), false);
});

test('generic-navigation adapter rejects candidates outside its site key with an API reasonCode', () => {
  const adapter = listSiteAdapters().find((candidate) => candidate.id === 'generic-navigation');
  assert.notEqual(adapter, undefined);

  // @ts-ignore
  const decision = adapter.validateApiCandidate({
    candidate: createSyntheticCandidate({
      id: 'other-candidate-1',
      siteKey: 'other-site',
    }),
    evidence: {
      authorization: 'Bearer synthetic-rejected-adapter-token',
    },
  });

  assert.equal(decision.contractVersion, SITE_ADAPTER_CANDIDATE_DECISION_VERSION);
  assert.equal(decision.candidateId, 'other-candidate-1');
  assert.equal(decision.siteKey, 'other-site');
  assert.equal(decision.adapterId, 'generic-navigation');
  assert.equal(decision.adapterVersion, GENERIC_NAVIGATION_ADAPTER_VERSION);
  assert.equal(decision.decision, 'rejected');
  assert.equal(decision.reasonCode, 'api-verification-failed');
  assert.equal(decision.evidence.authorization, REDACTION_PLACEHOLDER);
  assert.equal(Object.hasOwn(decision, 'artifactPath'), false);
  assert.equal(Object.hasOwn(decision, 'catalogPath'), false);
});

test('chapter-content adapter validates observed public page requests without catalog auto-promotion', () => {
  const adapter = listSiteAdapters().find((candidate) => candidate.id === 'chapter-content');
  assert.notEqual(adapter, undefined);
  // @ts-ignore
  assert.equal(typeof adapter.validateApiCandidate, 'function');
  // @ts-ignore
  assert.equal(typeof adapter.getApiCatalogUpgradePolicy, 'function');

  const observedCandidate = createSyntheticCandidate({
    id: '22biqu-home-candidate',
    siteKey: 'www.22biqu.com',
    status: 'observed',
    endpoint: {
      method: 'GET',
      url: 'https://www.22biqu.com/',
    },
  });
  // @ts-ignore
  const decision = adapter.validateApiCandidate({
    candidate: observedCandidate,
    validatedAt: '2026-05-10T00:00:00.000Z',
  });

  assert.equal(decision.contractVersion, SITE_ADAPTER_CANDIDATE_DECISION_VERSION);
  assert.equal(decision.adapterId, 'chapter-content');
  assert.equal(decision.candidateId, '22biqu-home-candidate');
  assert.equal(decision.siteKey, 'www.22biqu.com');
  assert.equal(decision.decision, 'accepted');
  assert.equal(Object.hasOwn(decision, 'artifactPath'), false);
  assert.equal(Object.hasOwn(decision, 'catalogPath'), false);

  // @ts-ignore
  const policy = adapter.getApiCatalogUpgradePolicy({
    candidate: observedCandidate,
    siteAdapterDecision: decision,
    decidedAt: '2026-05-10T00:00:00.000Z',
  });
  assert.equal(policy.contractVersion, SITE_ADAPTER_CATALOG_UPGRADE_POLICY_VERSION);
  assert.equal(policy.adapterId, 'chapter-content');
  assert.equal(policy.siteKey, 'www.22biqu.com');
  assert.equal(policy.allowCatalogUpgrade, false);
  assert.equal(policy.reasonCode, 'api-catalog-entry-blocked');

  // @ts-ignore
  const staticDecision = adapter.validateApiCandidate({
    candidate: createSyntheticCandidate({
      id: '22biqu-static-candidate',
      siteKey: 'www.22biqu.com',
      endpoint: {
        method: 'GET',
        url: 'https://www.22biqu.com/static/app.js',
      },
    }),
  });
  assert.equal(staticDecision.decision, 'rejected');
  assert.equal(staticDecision.reasonCode, 'api-verification-failed');
});

test('jable adapter exposes concrete redacted API candidate semantics evidence', () => {
  const adapter = listSiteAdapters().find((candidate) => candidate.id === 'jable');
  assert.notEqual(adapter, undefined);
  assert.equal(typeof adapter.describeApiCandidateSemantics, 'function');

  const semantics = adapter.describeApiCandidateSemantics({
    candidate: createSyntheticCandidate({
      id: 'jable-semantic-videos-page',
      siteKey: 'jable',
      endpoint: {
        method: 'GET',
        url: 'https://jable.tv/api/v1/videos?page=2&access_token=synthetic-jable-semantic-token',
      },
      auth: {
        authorization: 'Bearer synthetic-jable-semantic-token',
        cookie: 'SESSDATA=synthetic-jable-semantic-cookie',
      },
      request: {
        headers: {
          authorization: 'Bearer synthetic-jable-request-token',
        },
        body: 'synthetic-jable-raw-request-body',
      },
      response: {
        body: 'synthetic-jable-raw-response-body',
      },
    }),
    scope: {
      pageType: 'category-page',
      authorization: 'Bearer synthetic-jable-scope-token',
    },
  });

  assert.equal(Object.getPrototypeOf(semantics), Object.prototype);
  assert.equal(semantics.contractVersion, SITE_ADAPTER_SEMANTIC_ENTRY_VERSION);
  assert.equal(semantics.adapterId, 'jable');
  assert.equal(semantics.candidateId, 'jable-semantic-videos-page');
  assert.equal(semantics.siteKey, 'jable');
  assert.equal(semantics.scope.semanticMode, 'jable-api-candidate');
  assert.equal(semantics.scope.endpointHost, 'jable.tv');
  assert.equal(semantics.scope.endpointPath, '/api/v1/videos');
  assert.equal(semantics.scope.siteSurface, 'catalog-video-api');
  assert.equal(semantics.scope.authorization, REDACTION_PLACEHOLDER);
  assert.equal(semantics.auth.authorization, REDACTION_PLACEHOLDER);
  assert.equal(semantics.auth.cookie, REDACTION_PLACEHOLDER);
  assert.equal(semantics.auth.authenticationRequired, false);
  assert.equal(semantics.auth.credentialPolicy, 'redacted-session-view-only');
  assert.equal(semantics.pagination.model, 'page-number');
  assert.equal(semantics.pagination.pageParam, 'page');
  assert.equal(semantics.pagination.firstPage, 1);
  assert.equal(semantics.fieldMapping.itemsPath, 'data.items');
  assert.equal(semantics.fieldMapping.detailUrlPath, 'url');
  assert.deepEqual(semantics.fieldMapping.actorPaths, ['actors', 'models']);
  assert.equal(semantics.risk.downloaderBoundary, 'resolved resource consumer only');
  assert.equal(semantics.risk.hints.includes('avoid persisting raw request or response bodies'), true);
  assertNoForbiddenSemanticKeys(semantics);

  const serialized = JSON.stringify(semantics);
  assert.equal(serialized.includes('synthetic-jable-semantic'), false);
  assert.equal(serialized.includes('synthetic-jable-request-token'), false);
  assert.equal(serialized.includes('synthetic-jable-raw-request-body'), false);
  assert.equal(serialized.includes('synthetic-jable-raw-response-body'), false);
  assert.equal(serialized.includes('SESSDATA='), false);
  assert.equal(serialized.includes('Bearer '), false);
});

test('jable adapter validates synthetic site API candidates without catalog promotion', async () => {
  const adapter = listSiteAdapters().find((candidate) => candidate.id === 'jable');
  assert.notEqual(adapter, undefined);
  // @ts-ignore
  assert.equal(typeof adapter.validateApiCandidate, 'function');

  const candidate = createSyntheticCandidate({
    id: 'jable-api-candidate-1',
    siteKey: 'jable',
    endpoint: {
      method: 'GET',
      url: 'https://jable.tv/api/v1/videos?access_token=synthetic-jable-token',
    },
  });
  // @ts-ignore
  const decision = adapter.validateApiCandidate({
    candidate,
    validatedAt: '2026-05-01T11:20:00.000Z',
    evidence: {
      authorization: 'Bearer synthetic-jable-token',
      sampleCount: 1,
    },
  });

  assert.equal(decision.contractVersion, SITE_ADAPTER_CANDIDATE_DECISION_VERSION);
  assert.equal(decision.candidateId, 'jable-api-candidate-1');
  assert.equal(decision.siteKey, 'jable');
  assert.equal(decision.adapterId, 'jable');
  assert.equal(decision.decision, 'accepted');
  assert.equal(decision.scope.validationMode, 'jable-api-candidate');
  assert.equal(decision.scope.endpointHost, 'jable.tv');
  assert.equal(decision.scope.endpointPath, '/api/v1/videos');
  assert.equal(decision.evidence.authorization, REDACTION_PLACEHOLDER);
  assert.equal(Object.hasOwn(decision, 'artifactPath'), false);
  assert.equal(Object.hasOwn(decision, 'catalogPath'), false);

  await assert.rejects(
    writeApiCatalogEntryArtifact(candidate, { catalogPath: path.join('unused', 'jable-catalog.json') }),
    /ApiCandidate must be verified before catalog entry/u,
  );
});

test('jable adapter exposes a pure catalog upgrade policy hook without promotion', () => {
  const adapter = listSiteAdapters().find((candidate) => candidate.id === 'jable');
  assert.notEqual(adapter, undefined);
  // @ts-ignore
  assert.equal(typeof adapter.getApiCatalogUpgradePolicy, 'function');

  const candidate = createSyntheticCandidate({
    id: 'jable-upgrade-policy-candidate',
    siteKey: 'jable',
    status: 'verified',
    endpoint: {
      method: 'GET',
      url: 'https://jable.tv/api/v1/videos?access_token=synthetic-jable-policy-token',
    },
  });
  // @ts-ignore
  const decision = adapter.validateApiCandidate({
    candidate,
    validatedAt: '2026-05-01T16:10:00.000Z',
  });
  // @ts-ignore
  const policy = adapter.getApiCatalogUpgradePolicy({
    candidate,
    siteAdapterDecision: decision,
    decidedAt: '2026-05-01T16:11:00.000Z',
    evidence: {
      authorization: 'Bearer synthetic-jable-policy-token',
      sampleCount: 1,
    },
  });

  assert.equal(policy.contractVersion, SITE_ADAPTER_CATALOG_UPGRADE_POLICY_VERSION);
  assert.equal(policy.candidateId, 'jable-upgrade-policy-candidate');
  assert.equal(policy.siteKey, 'jable');
  assert.equal(policy.adapterId, 'jable');
  assert.equal(policy.allowCatalogUpgrade, true);
  assert.equal(policy.scope.policyMode, 'jable-api');
  assert.equal(policy.scope.endpointHost, 'jable.tv');
  assert.equal(policy.scope.endpointPath, '/api/v1/videos');
  assert.equal(policy.evidence.authorization, REDACTION_PLACEHOLDER);
  assert.equal(Object.hasOwn(policy, 'artifactPath'), false);
  assert.equal(Object.hasOwn(policy, 'catalogPath'), false);
  assert.equal(Object.hasOwn(policy, 'catalogEntry'), false);

  const upgradeDecision = createApiCatalogUpgradeDecision({
    candidate,
    siteAdapterDecision: decision,
    policy,
  });
  assert.equal(upgradeDecision.decision, 'allowed');
  assert.equal(assertApiCatalogUpgradeDecisionAllowsCatalog(upgradeDecision), upgradeDecision);

  const wrongPathCandidate = createSyntheticCandidate({
    id: 'jable-upgrade-policy-wrong-path',
    siteKey: 'jable',
    status: 'verified',
    endpoint: {
      method: 'GET',
      url: 'https://jable.tv/videos/abc-123/?access_token=synthetic-jable-policy-token',
    },
  });
  // @ts-ignore
  const rejectedDecision = adapter.validateApiCandidate({
    candidate: wrongPathCandidate,
  });
  // @ts-ignore
  const blockedPolicy = adapter.getApiCatalogUpgradePolicy({
    candidate: wrongPathCandidate,
    siteAdapterDecision: rejectedDecision,
  });
  assert.equal(blockedPolicy.allowCatalogUpgrade, false);
  assert.equal(blockedPolicy.reasonCode, 'api-catalog-entry-blocked');
});

test('jable synthetic verified endpoint fixture catalogs only through explicit allow gate', async () => {
  const adapter = listSiteAdapters().find((candidate) => candidate.id === 'jable');
  assert.notEqual(adapter, undefined);
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'jable-catalog-upgrade-fixture-'));
  try {
    const decisionPath = path.join(runDir, 'allowed', 'decision.json');
    const decisionAuditPath = path.join(runDir, 'allowed', 'decision.redaction-audit.json');
    const catalogPath = path.join(runDir, 'allowed', 'entry.json');
    const catalogAuditPath = path.join(runDir, 'allowed', 'entry.redaction-audit.json');
    const eventPath = path.join(runDir, 'allowed', 'verification-event.json');
    const eventAuditPath = path.join(runDir, 'allowed', 'verification-event.redaction-audit.json');
    const observedDecisionPath = path.join(runDir, 'observed', 'decision.json');
    const observedDecisionAuditPath = path.join(runDir, 'observed', 'decision.redaction-audit.json');
    const observedCatalogPath = path.join(runDir, 'observed', 'entry.json');
    const observedCatalogAuditPath = path.join(runDir, 'observed', 'entry.redaction-audit.json');
    const observedEventPath = path.join(runDir, 'observed', 'verification-event.json');
    const observedEventAuditPath = path.join(runDir, 'observed', 'verification-event.redaction-audit.json');
    const blockedDecisionPath = path.join(runDir, 'blocked', 'decision.json');
    const blockedDecisionAuditPath = path.join(runDir, 'blocked', 'decision.redaction-audit.json');
    const blockedCatalogPath = path.join(runDir, 'blocked', 'entry.json');
    const blockedCatalogAuditPath = path.join(runDir, 'blocked', 'entry.redaction-audit.json');
    const blockedEventPath = path.join(runDir, 'blocked', 'verification-event.json');
    const blockedEventAuditPath = path.join(runDir, 'blocked', 'verification-event.redaction-audit.json');

    const candidate = createSyntheticCandidate({
      id: 'jable-verified-fixture-candidate',
      siteKey: 'jable',
      status: 'verified',
      endpoint: {
        method: 'GET',
        url: 'https://jable.tv/api/v1/videos?access_token=synthetic-jable-fixture-token',
      },
      request: {
        headers: {
          authorization: 'Bearer synthetic-jable-fixture-token',
        },
      },
      auth: {
        authorization: 'Bearer synthetic-jable-fixture-token',
      },
    });
    // @ts-ignore
    const decision = adapter.validateApiCandidate({
      candidate,
      validatedAt: '2026-05-01T18:50:00.000Z',
      evidence: {
        authorization: 'Bearer synthetic-jable-fixture-token',
        sampleCount: 1,
      },
    });
    // @ts-ignore
    const policy = adapter.getApiCatalogUpgradePolicy({
      candidate,
      siteAdapterDecision: decision,
      decidedAt: '2026-05-01T18:51:00.000Z',
      evidence: {
        authorization: 'Bearer synthetic-jable-fixture-token',
        sampleCount: 1,
      },
    });

    const result = await writeVerifiedApiCatalogUpgradeFixtureArtifacts({
      candidate,
      siteAdapterDecision: decision,
      policy,
      decidedAt: '2026-05-01T18:52:00.000Z',
      metadata: {
        version: 'jable-api-v1',
        verifiedAt: '2026-05-01T18:53:00.000Z',
        lastValidatedAt: '2026-05-01T18:54:00.000Z',
      },
    }, {
      decisionPath,
      decisionRedactionAuditPath: decisionAuditPath,
      catalogPath,
      catalogRedactionAuditPath: catalogAuditPath,
      verificationEventPath: eventPath,
      verificationEventRedactionAuditPath: eventAuditPath,
      verificationEventTraceId: 'jable-fixture-trace',
      verificationEventCorrelationId: 'jable-fixture-correlation',
    });

    const persistedDecision = JSON.parse(await readFile(decisionPath, 'utf8'));
    const catalogEntry = JSON.parse(await readFile(catalogPath, 'utf8'));
    const event = JSON.parse(await readFile(eventPath, 'utf8'));
    assert.equal(result.upgradeDecision.decision.decision, 'allowed');
    assert.equal(persistedDecision.requirements.siteAdapterAccepted, true);
    assert.equal(persistedDecision.requirements.policyAllowsCatalogUpgrade, true);
    assert.equal(catalogEntry.candidateId, 'jable-verified-fixture-candidate');
    assert.equal(catalogEntry.version, 'jable-api-v1');
    assert.equal(catalogEntry.auth.authorization, REDACTION_PLACEHOLDER);
    assert.equal(event.eventType, 'api.catalog.verification.written');
    assert.equal(event.traceId, 'jable-fixture-trace');
    assert.equal(event.correlationId, 'jable-fixture-correlation');
    assert.equal(assertSchemaCompatible('LifecycleEvent', event), true);

    for (const filePath of [
      decisionPath,
      decisionAuditPath,
      catalogPath,
      catalogAuditPath,
      eventPath,
      eventAuditPath,
    ]) {
      const text = await readFile(filePath, 'utf8');
      assert.equal(text.includes('synthetic-jable-fixture-token'), false);
    }

    const observedCandidate = {
      ...candidate,
      id: 'jable-observed-fixture-candidate',
      status: 'observed',
    };
    // @ts-ignore
    const observedDecision = adapter.validateApiCandidate({ candidate: observedCandidate });
    // @ts-ignore
    const observedPolicy = adapter.getApiCatalogUpgradePolicy({
      candidate: observedCandidate,
      siteAdapterDecision: observedDecision,
    });
    await assert.rejects(
      writeVerifiedApiCatalogUpgradeFixtureArtifacts({
        candidate: observedCandidate,
        siteAdapterDecision: observedDecision,
        policy: observedPolicy,
      }, {
        decisionPath: observedDecisionPath,
        decisionRedactionAuditPath: observedDecisionAuditPath,
        catalogPath: observedCatalogPath,
        catalogRedactionAuditPath: observedCatalogAuditPath,
        verificationEventPath: observedEventPath,
        verificationEventRedactionAuditPath: observedEventAuditPath,
      }),
      /does not allow catalog entry: api-catalog-entry-blocked/u,
    );

    const blockedCandidate = {
      ...candidate,
      id: 'jable-blocked-fixture-candidate',
      endpoint: {
        method: 'GET',
        url: 'https://jable.tv/videos/abc-123/?access_token=synthetic-jable-fixture-token',
      },
    };
    // @ts-ignore
    const blockedDecision = adapter.validateApiCandidate({ candidate: blockedCandidate });
    // @ts-ignore
    const blockedPolicy = adapter.getApiCatalogUpgradePolicy({
      candidate: blockedCandidate,
      siteAdapterDecision: blockedDecision,
    });
    await assert.rejects(
      writeVerifiedApiCatalogUpgradeFixtureArtifacts({
        candidate: blockedCandidate,
        siteAdapterDecision: blockedDecision,
        policy: blockedPolicy,
      }, {
        decisionPath: blockedDecisionPath,
        decisionRedactionAuditPath: blockedDecisionAuditPath,
        catalogPath: blockedCatalogPath,
        catalogRedactionAuditPath: blockedCatalogAuditPath,
        verificationEventPath: blockedEventPath,
        verificationEventRedactionAuditPath: blockedEventAuditPath,
      }),
      /does not allow catalog entry: api-verification-failed/u,
    );

    for (const filePath of [
      observedDecisionPath,
      observedDecisionAuditPath,
      observedCatalogPath,
      observedCatalogAuditPath,
      observedEventPath,
      observedEventAuditPath,
      blockedDecisionPath,
      blockedDecisionAuditPath,
      blockedCatalogPath,
      blockedCatalogAuditPath,
      blockedEventPath,
      blockedEventAuditPath,
    ]) {
      await assert.rejects(access(filePath), /ENOENT/u);
    }
  } finally {
    await rm(runDir, { force: true, recursive: true });
  }
});

test('jable adapter rejects candidates outside its API scope with an API reasonCode', () => {
  const adapter = listSiteAdapters().find((candidate) => candidate.id === 'jable');
  assert.notEqual(adapter, undefined);

  // @ts-ignore
  const wrongHost = adapter.validateApiCandidate({
    candidate: createSyntheticCandidate({
      id: 'jable-wrong-host',
      siteKey: 'jable',
      endpoint: {
        method: 'GET',
        url: 'https://example.invalid/api/v1/videos?access_token=synthetic-jable-token',
      },
    }),
    evidence: {
      authorization: 'Bearer synthetic-jable-token',
    },
  });
  // @ts-ignore
  const wrongPath = adapter.validateApiCandidate({
    candidate: createSyntheticCandidate({
      id: 'jable-wrong-path',
      siteKey: 'jable',
      endpoint: {
        method: 'GET',
        url: 'https://jable.tv/videos/abc-123/?access_token=synthetic-jable-token',
      },
    }),
  });
  // @ts-ignore
  const wrongSiteKey = adapter.validateApiCandidate({
    candidate: createSyntheticCandidate({
      id: 'jable-wrong-site',
      siteKey: 'other-site',
      endpoint: {
        method: 'GET',
        url: 'https://jable.tv/api/v1/videos?access_token=synthetic-jable-token',
      },
    }),
  });

  assert.equal(wrongHost.decision, 'rejected');
  assert.equal(wrongHost.reasonCode, 'api-verification-failed');
  assert.equal(wrongHost.adapterId, 'jable');
  assert.equal(wrongHost.evidence.authorization, REDACTION_PLACEHOLDER);
  assert.equal(Object.hasOwn(wrongHost, 'catalogPath'), false);
  assert.equal(wrongPath.decision, 'rejected');
  assert.equal(wrongPath.reasonCode, 'api-verification-failed');
  assert.equal(wrongPath.adapterId, 'jable');
  assert.equal(Object.hasOwn(wrongPath, 'catalogPath'), false);
  assert.equal(wrongSiteKey.decision, 'rejected');
  assert.equal(wrongSiteKey.reasonCode, 'api-verification-failed');
  assert.equal(wrongSiteKey.adapterId, 'jable');
  assert.equal(Object.hasOwn(wrongSiteKey, 'catalogPath'), false);
});

test('moodyz adapter validates synthetic site API candidates without catalog promotion', async () => {
  const adapter = listSiteAdapters().find((candidate) => candidate.id === 'moodyz');
  assert.notEqual(adapter, undefined);
  // @ts-ignore
  assert.equal(typeof adapter.validateApiCandidate, 'function');

  const candidate = createSyntheticCandidate({
    id: 'moodyz-api-candidate-1',
    siteKey: 'moodyz',
    endpoint: {
      method: 'GET',
      url: 'https://moodyz.com/api/v1/works?access_token=synthetic-moodyz-token',
    },
  });
  // @ts-ignore
  const decision = adapter.validateApiCandidate({
    candidate,
    validatedAt: '2026-05-01T11:25:00.000Z',
    evidence: {
      authorization: 'Bearer synthetic-moodyz-token',
      sampleCount: 1,
    },
  });

  assert.equal(decision.contractVersion, SITE_ADAPTER_CANDIDATE_DECISION_VERSION);
  assert.equal(decision.candidateId, 'moodyz-api-candidate-1');
  assert.equal(decision.siteKey, 'moodyz');
  assert.equal(decision.adapterId, 'moodyz');
  assert.equal(decision.decision, 'accepted');
  assert.equal(decision.scope.validationMode, 'moodyz-api-candidate');
  assert.equal(decision.scope.endpointHost, 'moodyz.com');
  assert.equal(decision.scope.endpointPath, '/api/v1/works');
  assert.equal(decision.evidence.authorization, REDACTION_PLACEHOLDER);
  assert.equal(Object.hasOwn(decision, 'artifactPath'), false);
  assert.equal(Object.hasOwn(decision, 'catalogPath'), false);

  await assert.rejects(
    writeApiCatalogEntryArtifact(candidate, { catalogPath: path.join('unused', 'moodyz-catalog.json') }),
    /ApiCandidate must be verified before catalog entry/u,
  );
});

test('moodyz adapter exposes a pure catalog upgrade policy hook without promotion', () => {
  const adapter = listSiteAdapters().find((candidate) => candidate.id === 'moodyz');
  assert.notEqual(adapter, undefined);
  // @ts-ignore
  assert.equal(typeof adapter.getApiCatalogUpgradePolicy, 'function');

  const candidate = createSyntheticCandidate({
    id: 'moodyz-upgrade-policy-candidate',
    siteKey: 'moodyz',
    status: 'verified',
    endpoint: {
      method: 'GET',
      url: 'https://moodyz.com/api/v1/works?access_token=synthetic-moodyz-policy-token',
    },
  });
  // @ts-ignore
  const decision = adapter.validateApiCandidate({
    candidate,
    validatedAt: '2026-05-01T16:25:00.000Z',
  });
  // @ts-ignore
  const policy = adapter.getApiCatalogUpgradePolicy({
    candidate,
    siteAdapterDecision: decision,
    decidedAt: '2026-05-01T16:25:01.000Z',
    evidence: {
      authorization: 'Bearer synthetic-moodyz-policy-token',
      sampleCount: 1,
    },
  });

  assert.equal(policy.contractVersion, SITE_ADAPTER_CATALOG_UPGRADE_POLICY_VERSION);
  assert.equal(policy.candidateId, 'moodyz-upgrade-policy-candidate');
  assert.equal(policy.siteKey, 'moodyz');
  assert.equal(policy.adapterId, 'moodyz');
  assert.equal(policy.allowCatalogUpgrade, true);
  assert.equal(policy.scope.policyMode, 'moodyz-api');
  assert.equal(policy.scope.endpointHost, 'moodyz.com');
  assert.equal(policy.scope.endpointPath, '/api/v1/works');
  assert.equal(policy.evidence.authorization, REDACTION_PLACEHOLDER);
  assert.equal(Object.hasOwn(policy, 'artifactPath'), false);
  assert.equal(Object.hasOwn(policy, 'catalogPath'), false);
  assert.equal(Object.hasOwn(policy, 'catalogEntry'), false);

  const upgradeDecision = createApiCatalogUpgradeDecision({
    candidate,
    siteAdapterDecision: decision,
    policy,
  });
  assert.equal(upgradeDecision.decision, 'allowed');
  assert.equal(assertApiCatalogUpgradeDecisionAllowsCatalog(upgradeDecision), upgradeDecision);

  const rejectedCandidate = createSyntheticCandidate({
    id: 'moodyz-blocked-upgrade-policy-candidate',
    siteKey: 'moodyz',
    status: 'verified',
    endpoint: {
      method: 'GET',
      url: 'https://moodyz.com/works/date?access_token=synthetic-moodyz-policy-token',
    },
  });
  // @ts-ignore
  const rejectedDecision = adapter.validateApiCandidate({
    candidate: rejectedCandidate,
  });
  // @ts-ignore
  const blockedPolicy = adapter.getApiCatalogUpgradePolicy({
    candidate: rejectedCandidate,
    siteAdapterDecision: rejectedDecision,
  });
  assert.equal(blockedPolicy.allowCatalogUpgrade, false);
  assert.equal(blockedPolicy.reasonCode, 'api-catalog-entry-blocked');
});

test('moodyz synthetic verified endpoint fixture catalogs only through explicit allow gate', async () => {
  const adapter = listSiteAdapters().find((candidate) => candidate.id === 'moodyz');
  assert.notEqual(adapter, undefined);
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'moodyz-catalog-upgrade-fixture-'));
  try {
    const allowedPaths = {
      decisionPath: path.join(runDir, 'allowed', 'decision.json'),
      decisionRedactionAuditPath: path.join(runDir, 'allowed', 'decision.redaction-audit.json'),
      catalogPath: path.join(runDir, 'allowed', 'entry.json'),
      catalogRedactionAuditPath: path.join(runDir, 'allowed', 'entry.redaction-audit.json'),
      verificationEventPath: path.join(runDir, 'allowed', 'verification-event.json'),
      verificationEventRedactionAuditPath: path.join(runDir, 'allowed', 'verification-event.redaction-audit.json'),
    };
    const observedPaths = {
      decisionPath: path.join(runDir, 'observed', 'decision.json'),
      decisionRedactionAuditPath: path.join(runDir, 'observed', 'decision.redaction-audit.json'),
      catalogPath: path.join(runDir, 'observed', 'entry.json'),
      catalogRedactionAuditPath: path.join(runDir, 'observed', 'entry.redaction-audit.json'),
      verificationEventPath: path.join(runDir, 'observed', 'verification-event.json'),
      verificationEventRedactionAuditPath: path.join(runDir, 'observed', 'verification-event.redaction-audit.json'),
    };
    const blockedPaths = {
      decisionPath: path.join(runDir, 'blocked', 'decision.json'),
      decisionRedactionAuditPath: path.join(runDir, 'blocked', 'decision.redaction-audit.json'),
      catalogPath: path.join(runDir, 'blocked', 'entry.json'),
      catalogRedactionAuditPath: path.join(runDir, 'blocked', 'entry.redaction-audit.json'),
      verificationEventPath: path.join(runDir, 'blocked', 'verification-event.json'),
      verificationEventRedactionAuditPath: path.join(runDir, 'blocked', 'verification-event.redaction-audit.json'),
    };

    const candidate = createSyntheticCandidate({
      id: 'moodyz-verified-fixture-candidate',
      siteKey: 'moodyz',
      status: 'verified',
      endpoint: {
        method: 'GET',
        url: 'https://moodyz.com/api/v1/works?access_token=synthetic-moodyz-fixture-token',
      },
      request: {
        headers: {
          authorization: 'Bearer synthetic-moodyz-fixture-token',
        },
      },
      auth: {
        authorization: 'Bearer synthetic-moodyz-fixture-token',
      },
    });
    // @ts-ignore
    const decision = adapter.validateApiCandidate({
      candidate,
      validatedAt: '2026-05-01T19:10:00.000Z',
      evidence: {
        authorization: 'Bearer synthetic-moodyz-fixture-token',
        sampleCount: 1,
      },
    });
    // @ts-ignore
    const policy = adapter.getApiCatalogUpgradePolicy({
      candidate,
      siteAdapterDecision: decision,
      decidedAt: '2026-05-01T19:11:00.000Z',
      evidence: {
        authorization: 'Bearer synthetic-moodyz-fixture-token',
        sampleCount: 1,
      },
    });

    await writeVerifiedApiCatalogUpgradeFixtureArtifacts({
      candidate,
      siteAdapterDecision: decision,
      policy,
      decidedAt: '2026-05-01T19:12:00.000Z',
      metadata: {
        version: 'moodyz-api-v1',
        verifiedAt: '2026-05-01T19:13:00.000Z',
        lastValidatedAt: '2026-05-01T19:14:00.000Z',
      },
    }, {
      ...allowedPaths,
      verificationEventTraceId: 'moodyz-fixture-trace',
      verificationEventCorrelationId: 'moodyz-fixture-correlation',
    });

    const persistedDecision = JSON.parse(await readFile(allowedPaths.decisionPath, 'utf8'));
    const catalogEntry = JSON.parse(await readFile(allowedPaths.catalogPath, 'utf8'));
    const event = JSON.parse(await readFile(allowedPaths.verificationEventPath, 'utf8'));
    assert.equal(persistedDecision.decision, 'allowed');
    assert.equal(catalogEntry.candidateId, 'moodyz-verified-fixture-candidate');
    assert.equal(catalogEntry.version, 'moodyz-api-v1');
    assert.equal(catalogEntry.auth.authorization, REDACTION_PLACEHOLDER);
    assert.equal(event.eventType, 'api.catalog.verification.written');
    assert.equal(event.traceId, 'moodyz-fixture-trace');
    assert.equal(event.correlationId, 'moodyz-fixture-correlation');
    assert.equal(assertSchemaCompatible('LifecycleEvent', event), true);

    for (const filePath of Object.values(allowedPaths)) {
      const text = await readFile(filePath, 'utf8');
      assert.equal(text.includes('synthetic-moodyz-fixture-token'), false);
    }

    const observedCandidate = {
      ...candidate,
      id: 'moodyz-observed-fixture-candidate',
      status: 'observed',
    };
    // @ts-ignore
    const observedDecision = adapter.validateApiCandidate({ candidate: observedCandidate });
    // @ts-ignore
    const observedPolicy = adapter.getApiCatalogUpgradePolicy({
      candidate: observedCandidate,
      siteAdapterDecision: observedDecision,
    });
    await assert.rejects(
      writeVerifiedApiCatalogUpgradeFixtureArtifacts({
        candidate: observedCandidate,
        siteAdapterDecision: observedDecision,
        policy: observedPolicy,
      }, observedPaths),
      /does not allow catalog entry: api-catalog-entry-blocked/u,
    );

    const blockedCandidate = {
      ...candidate,
      id: 'moodyz-blocked-fixture-candidate',
      endpoint: {
        method: 'GET',
        url: 'https://moodyz.com/works/date?access_token=synthetic-moodyz-fixture-token',
      },
    };
    // @ts-ignore
    const blockedDecision = adapter.validateApiCandidate({ candidate: blockedCandidate });
    // @ts-ignore
    const blockedPolicy = adapter.getApiCatalogUpgradePolicy({
      candidate: blockedCandidate,
      siteAdapterDecision: blockedDecision,
    });
    await assert.rejects(
      writeVerifiedApiCatalogUpgradeFixtureArtifacts({
        candidate: blockedCandidate,
        siteAdapterDecision: blockedDecision,
        policy: blockedPolicy,
      }, blockedPaths),
      /does not allow catalog entry: api-verification-failed/u,
    );

    for (const filePath of [
      ...Object.values(observedPaths),
      ...Object.values(blockedPaths),
    ]) {
      await assert.rejects(access(filePath), /ENOENT/u);
    }
  } finally {
    await rm(runDir, { force: true, recursive: true });
  }
});

test('moodyz adapter rejects candidates outside its API scope with an API reasonCode', () => {
  const adapter = listSiteAdapters().find((candidate) => candidate.id === 'moodyz');
  assert.notEqual(adapter, undefined);

  // @ts-ignore
  const wrongHost = adapter.validateApiCandidate({
    candidate: createSyntheticCandidate({
      id: 'moodyz-wrong-host',
      siteKey: 'moodyz',
      endpoint: {
        method: 'GET',
        url: 'https://example.invalid/api/v1/works?access_token=synthetic-moodyz-token',
      },
    }),
    evidence: {
      authorization: 'Bearer synthetic-moodyz-token',
    },
  });
  // @ts-ignore
  const wrongPath = adapter.validateApiCandidate({
    candidate: createSyntheticCandidate({
      id: 'moodyz-wrong-path',
      siteKey: 'moodyz',
      endpoint: {
        method: 'GET',
        url: 'https://moodyz.com/works/date?access_token=synthetic-moodyz-token',
      },
    }),
  });
  // @ts-ignore
  const wrongSiteKey = adapter.validateApiCandidate({
    candidate: createSyntheticCandidate({
      id: 'moodyz-wrong-site',
      siteKey: 'other-site',
      endpoint: {
        method: 'GET',
        url: 'https://moodyz.com/api/v1/works?access_token=synthetic-moodyz-token',
      },
    }),
  });

  assert.equal(wrongHost.decision, 'rejected');
  assert.equal(wrongHost.reasonCode, 'api-verification-failed');
  assert.equal(wrongHost.adapterId, 'moodyz');
  assert.equal(wrongHost.evidence.authorization, REDACTION_PLACEHOLDER);
  assert.equal(Object.hasOwn(wrongHost, 'catalogPath'), false);
  assert.equal(wrongPath.decision, 'rejected');
  assert.equal(wrongPath.reasonCode, 'api-verification-failed');
  assert.equal(wrongPath.adapterId, 'moodyz');
  assert.equal(Object.hasOwn(wrongPath, 'catalogPath'), false);
  assert.equal(wrongSiteKey.decision, 'rejected');
  assert.equal(wrongSiteKey.reasonCode, 'api-verification-failed');
  assert.equal(wrongSiteKey.adapterId, 'moodyz');
  assert.equal(Object.hasOwn(wrongSiteKey, 'catalogPath'), false);
});

test('x adapter validates synthetic site API candidates without catalog promotion', async () => {
  const adapter = listSiteAdapters().find((candidate) => candidate.id === 'x');
  assert.notEqual(adapter, undefined);
  // @ts-ignore
  assert.equal(typeof adapter.validateApiCandidate, 'function');

  const candidate = createSyntheticCandidate({
    id: 'x-api-candidate-1',
    siteKey: 'x',
    endpoint: {
      method: 'GET',
      url: 'https://x.com/i/api/graphql/syntheticTimeline?access_token=synthetic-x-token',
    },
  });
  // @ts-ignore
  const decision = adapter.validateApiCandidate({
    candidate,
    validatedAt: '2026-05-01T11:30:00.000Z',
    evidence: {
      authorization: 'Bearer synthetic-x-token',
      sampleCount: 1,
    },
  });

  assert.equal(decision.contractVersion, SITE_ADAPTER_CANDIDATE_DECISION_VERSION);
  assert.equal(decision.candidateId, 'x-api-candidate-1');
  assert.equal(decision.siteKey, 'x');
  assert.equal(decision.adapterId, 'x');
  assert.equal(decision.decision, 'accepted');
  assert.equal(decision.scope.validationMode, 'x-api-candidate');
  assert.equal(decision.scope.endpointHost, 'x.com');
  assert.equal(decision.scope.endpointPath, '/i/api/graphql/syntheticTimeline');
  assert.equal(decision.evidence.authorization, REDACTION_PLACEHOLDER);
  assert.equal(Object.hasOwn(decision, 'artifactPath'), false);
  assert.equal(Object.hasOwn(decision, 'catalogPath'), false);

  await assert.rejects(
    writeApiCatalogEntryArtifact(candidate, { catalogPath: path.join('unused', 'x-catalog.json') }),
    /ApiCandidate must be verified before catalog entry/u,
  );
});

test('x adapter exposes a pure catalog upgrade policy hook without promotion', () => {
  const adapter = listSiteAdapters().find((candidate) => candidate.id === 'x');
  assert.notEqual(adapter, undefined);
  // @ts-ignore
  assert.equal(typeof adapter.getApiCatalogUpgradePolicy, 'function');

  const candidate = createSyntheticCandidate({
    id: 'x-upgrade-policy-candidate',
    siteKey: 'x',
    status: 'verified',
    endpoint: {
      method: 'GET',
      url: 'https://x.com/i/api/graphql/syntheticTimeline?access_token=synthetic-x-policy-token',
    },
  });
  // @ts-ignore
  const decision = adapter.validateApiCandidate({
    candidate,
    validatedAt: '2026-05-01T16:40:00.000Z',
  });
  // @ts-ignore
  const policy = adapter.getApiCatalogUpgradePolicy({
    candidate,
    siteAdapterDecision: decision,
    decidedAt: '2026-05-01T16:40:01.000Z',
    evidence: {
      authorization: 'Bearer synthetic-x-policy-token',
      sampleCount: 1,
    },
  });

  assert.equal(policy.contractVersion, SITE_ADAPTER_CATALOG_UPGRADE_POLICY_VERSION);
  assert.equal(policy.candidateId, 'x-upgrade-policy-candidate');
  assert.equal(policy.siteKey, 'x');
  assert.equal(policy.adapterId, 'x');
  assert.equal(policy.allowCatalogUpgrade, true);
  assert.equal(policy.scope.policyMode, 'x-api');
  assert.equal(policy.scope.endpointHost, 'x.com');
  assert.equal(policy.scope.endpointPath, '/i/api/graphql/syntheticTimeline');
  assert.equal(policy.evidence.authorization, REDACTION_PLACEHOLDER);
  assert.equal(Object.hasOwn(policy, 'artifactPath'), false);
  assert.equal(Object.hasOwn(policy, 'catalogPath'), false);
  assert.equal(Object.hasOwn(policy, 'catalogEntry'), false);

  const upgradeDecision = createApiCatalogUpgradeDecision({
    candidate,
    siteAdapterDecision: decision,
    policy,
  });
  assert.equal(upgradeDecision.decision, 'allowed');
  assert.equal(assertApiCatalogUpgradeDecisionAllowsCatalog(upgradeDecision), upgradeDecision);

  const rejectedCandidate = createSyntheticCandidate({
    id: 'x-blocked-upgrade-policy-candidate',
    siteKey: 'x',
    status: 'verified',
    endpoint: {
      method: 'GET',
      url: 'https://x.com/home?access_token=synthetic-x-policy-token',
    },
  });
  // @ts-ignore
  const rejectedDecision = adapter.validateApiCandidate({
    candidate: rejectedCandidate,
  });
  // @ts-ignore
  const blockedPolicy = adapter.getApiCatalogUpgradePolicy({
    candidate: rejectedCandidate,
    siteAdapterDecision: rejectedDecision,
  });
  assert.equal(blockedPolicy.allowCatalogUpgrade, false);
  assert.equal(blockedPolicy.reasonCode, 'api-catalog-entry-blocked');
});

test('x synthetic verified endpoint fixture catalogs only through explicit allow gate', async () => {
  const adapter = listSiteAdapters().find((candidate) => candidate.id === 'x');
  assert.notEqual(adapter, undefined);
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'x-catalog-upgrade-fixture-'));
  try {
    const allowedPaths = {
      decisionPath: path.join(runDir, 'allowed', 'decision.json'),
      decisionRedactionAuditPath: path.join(runDir, 'allowed', 'decision.redaction-audit.json'),
      catalogPath: path.join(runDir, 'allowed', 'entry.json'),
      catalogRedactionAuditPath: path.join(runDir, 'allowed', 'entry.redaction-audit.json'),
      verificationEventPath: path.join(runDir, 'allowed', 'verification-event.json'),
      verificationEventRedactionAuditPath: path.join(runDir, 'allowed', 'verification-event.redaction-audit.json'),
    };
    const observedPaths = {
      decisionPath: path.join(runDir, 'observed', 'decision.json'),
      decisionRedactionAuditPath: path.join(runDir, 'observed', 'decision.redaction-audit.json'),
      catalogPath: path.join(runDir, 'observed', 'entry.json'),
      catalogRedactionAuditPath: path.join(runDir, 'observed', 'entry.redaction-audit.json'),
      verificationEventPath: path.join(runDir, 'observed', 'verification-event.json'),
      verificationEventRedactionAuditPath: path.join(runDir, 'observed', 'verification-event.redaction-audit.json'),
    };

    const candidate = createSyntheticCandidate({
      id: 'x-verified-fixture-candidate',
      siteKey: 'x',
      status: 'verified',
      endpoint: {
        method: 'GET',
        url: 'https://x.com/i/api/graphql/syntheticTimeline',
      },
      request: {
        headers: {
          authorization: 'Bearer synthetic-x-fixture-token',
        },
      },
      auth: {
        authorization: 'Bearer synthetic-x-fixture-token',
      },
    });
    // @ts-ignore
    const decision = adapter.validateApiCandidate({
      candidate,
      validatedAt: '2026-05-01T19:45:00.000Z',
      evidence: {
        authorization: 'Bearer synthetic-x-fixture-token',
        sampleCount: 1,
      },
    });
    // @ts-ignore
    const policy = adapter.getApiCatalogUpgradePolicy({
      candidate,
      siteAdapterDecision: decision,
      decidedAt: '2026-05-01T19:46:00.000Z',
      evidence: {
        authorization: 'Bearer synthetic-x-fixture-token',
        sampleCount: 1,
      },
    });

    await writeVerifiedApiCatalogUpgradeFixtureArtifacts({
      candidate,
      siteAdapterDecision: decision,
      policy,
      decidedAt: '2026-05-01T19:47:00.000Z',
      metadata: {
        version: 'x-api-v1',
        verifiedAt: '2026-05-01T19:48:00.000Z',
        lastValidatedAt: '2026-05-01T19:49:00.000Z',
      },
    }, {
      ...allowedPaths,
      verificationEventTraceId: 'x-fixture-trace',
      verificationEventCorrelationId: 'x-fixture-correlation',
    });

    const persistedDecision = JSON.parse(await readFile(allowedPaths.decisionPath, 'utf8'));
    const catalogEntry = JSON.parse(await readFile(allowedPaths.catalogPath, 'utf8'));
    const event = JSON.parse(await readFile(allowedPaths.verificationEventPath, 'utf8'));
    assert.equal(persistedDecision.decision, 'allowed');
    assert.equal(persistedDecision.requirements.siteAdapterAccepted, true);
    assert.equal(persistedDecision.requirements.policyAllowsCatalogUpgrade, true);
    assert.equal(catalogEntry.candidateId, 'x-verified-fixture-candidate');
    assert.equal(catalogEntry.version, 'x-api-v1');
    assert.equal(catalogEntry.auth.authorization, REDACTION_PLACEHOLDER);
    assert.equal(event.eventType, 'api.catalog.verification.written');
    assert.equal(event.traceId, 'x-fixture-trace');
    assert.equal(event.correlationId, 'x-fixture-correlation');
    assert.equal(assertSchemaCompatible('LifecycleEvent', event), true);

    for (const filePath of Object.values(allowedPaths)) {
      const text = await readFile(filePath, 'utf8');
      assert.equal(text.includes('synthetic-x-fixture-token'), false);
    }

    const observedCandidate = {
      ...candidate,
      id: 'x-observed-fixture-candidate',
      status: 'observed',
    };
    // @ts-ignore
    const observedDecision = adapter.validateApiCandidate({ candidate: observedCandidate });
    // @ts-ignore
    const observedPolicy = adapter.getApiCatalogUpgradePolicy({
      candidate: observedCandidate,
      siteAdapterDecision: observedDecision,
    });
    await assert.rejects(
      writeVerifiedApiCatalogUpgradeFixtureArtifacts({
        candidate: observedCandidate,
        siteAdapterDecision: observedDecision,
        policy: observedPolicy,
      }, observedPaths),
      /does not allow catalog entry: api-catalog-entry-blocked/u,
    );
    for (const filePath of Object.values(observedPaths)) {
      await assert.rejects(access(filePath), /ENOENT/u);
    }
  } finally {
    await rm(runDir, { force: true, recursive: true });
  }
});

test('x adapter rejects candidates outside its API scope with an API reasonCode', () => {
  const adapter = listSiteAdapters().find((candidate) => candidate.id === 'x');
  assert.notEqual(adapter, undefined);

  // @ts-ignore
  const wrongHost = adapter.validateApiCandidate({
    candidate: createSyntheticCandidate({
      id: 'x-wrong-host',
      siteKey: 'x',
      endpoint: {
        method: 'GET',
        url: 'https://example.invalid/i/api/graphql/syntheticTimeline?access_token=synthetic-x-token',
      },
    }),
    evidence: {
      authorization: 'Bearer synthetic-x-token',
    },
  });
  // @ts-ignore
  const wrongPath = adapter.validateApiCandidate({
    candidate: createSyntheticCandidate({
      id: 'x-wrong-path',
      siteKey: 'x',
      endpoint: {
        method: 'GET',
        url: 'https://x.com/home?access_token=synthetic-x-token',
      },
    }),
  });
  // @ts-ignore
  const wrongSiteKey = adapter.validateApiCandidate({
    candidate: createSyntheticCandidate({
      id: 'x-wrong-site',
      siteKey: 'other-site',
      endpoint: {
        method: 'GET',
        url: 'https://x.com/i/api/graphql/syntheticTimeline?access_token=synthetic-x-token',
      },
    }),
  });

  assert.equal(wrongHost.decision, 'rejected');
  assert.equal(wrongHost.reasonCode, 'api-verification-failed');
  assert.equal(wrongHost.adapterId, 'x');
  assert.equal(wrongHost.evidence.authorization, REDACTION_PLACEHOLDER);
  assert.equal(Object.hasOwn(wrongHost, 'catalogPath'), false);
  assert.equal(wrongPath.decision, 'rejected');
  assert.equal(wrongPath.reasonCode, 'api-verification-failed');
  assert.equal(wrongPath.adapterId, 'x');
  assert.equal(Object.hasOwn(wrongPath, 'catalogPath'), false);
  assert.equal(wrongSiteKey.decision, 'rejected');
  assert.equal(wrongSiteKey.reasonCode, 'api-verification-failed');
  assert.equal(wrongSiteKey.adapterId, 'x');
  assert.equal(Object.hasOwn(wrongSiteKey, 'catalogPath'), false);
});

test('instagram adapter validates synthetic site API candidates without catalog promotion', async () => {
  const adapter = listSiteAdapters().find((candidate) => candidate.id === 'instagram');
  assert.notEqual(adapter, undefined);
  // @ts-ignore
  assert.equal(typeof adapter.validateApiCandidate, 'function');

  const candidate = createSyntheticCandidate({
    id: 'instagram-api-candidate-1',
    siteKey: 'instagram',
    endpoint: {
      method: 'GET',
      url: 'https://www.instagram.com/api/v1/feed/user/synthetic/?access_token=synthetic-instagram-token',
    },
  });
  // @ts-ignore
  const decision = adapter.validateApiCandidate({
    candidate,
    validatedAt: '2026-05-01T11:35:00.000Z',
    evidence: {
      authorization: 'Bearer synthetic-instagram-token',
      sampleCount: 1,
    },
  });

  assert.equal(decision.contractVersion, SITE_ADAPTER_CANDIDATE_DECISION_VERSION);
  assert.equal(decision.candidateId, 'instagram-api-candidate-1');
  assert.equal(decision.siteKey, 'instagram');
  assert.equal(decision.adapterId, 'instagram');
  assert.equal(decision.decision, 'accepted');
  assert.equal(decision.scope.validationMode, 'instagram-api-candidate');
  assert.equal(decision.scope.endpointHost, 'www.instagram.com');
  assert.equal(decision.scope.endpointPath, '/api/v1/feed/user/synthetic/');
  assert.equal(decision.evidence.authorization, REDACTION_PLACEHOLDER);
  assert.equal(Object.hasOwn(decision, 'artifactPath'), false);
  assert.equal(Object.hasOwn(decision, 'catalogPath'), false);

  await assert.rejects(
    writeApiCatalogEntryArtifact(candidate, { catalogPath: path.join('unused', 'instagram-catalog.json') }),
    /ApiCandidate must be verified before catalog entry/u,
  );
});

test('instagram adapter exposes a pure catalog upgrade policy hook without promotion', () => {
  const adapter = listSiteAdapters().find((candidate) => candidate.id === 'instagram');
  assert.notEqual(adapter, undefined);
  // @ts-ignore
  assert.equal(typeof adapter.getApiCatalogUpgradePolicy, 'function');

  const candidate = createSyntheticCandidate({
    id: 'instagram-upgrade-policy-candidate',
    siteKey: 'instagram',
    status: 'verified',
    endpoint: {
      method: 'GET',
      url: 'https://www.instagram.com/api/v1/feed/user/synthetic/?access_token=synthetic-instagram-policy-token',
    },
  });
  // @ts-ignore
  const decision = adapter.validateApiCandidate({
    candidate,
    validatedAt: '2026-05-01T16:55:00.000Z',
  });
  // @ts-ignore
  const policy = adapter.getApiCatalogUpgradePolicy({
    candidate,
    siteAdapterDecision: decision,
    decidedAt: '2026-05-01T16:55:01.000Z',
    evidence: {
      authorization: 'Bearer synthetic-instagram-policy-token',
      sampleCount: 1,
    },
  });

  assert.equal(policy.contractVersion, SITE_ADAPTER_CATALOG_UPGRADE_POLICY_VERSION);
  assert.equal(policy.candidateId, 'instagram-upgrade-policy-candidate');
  assert.equal(policy.siteKey, 'instagram');
  assert.equal(policy.adapterId, 'instagram');
  assert.equal(policy.allowCatalogUpgrade, true);
  assert.equal(policy.scope.policyMode, 'instagram-api');
  assert.equal(policy.scope.endpointHost, 'www.instagram.com');
  assert.equal(policy.scope.endpointPath, '/api/v1/feed/user/synthetic/');
  assert.equal(policy.evidence.authorization, REDACTION_PLACEHOLDER);
  assert.equal(Object.hasOwn(policy, 'artifactPath'), false);
  assert.equal(Object.hasOwn(policy, 'catalogPath'), false);
  assert.equal(Object.hasOwn(policy, 'catalogEntry'), false);

  const upgradeDecision = createApiCatalogUpgradeDecision({
    candidate,
    siteAdapterDecision: decision,
    policy,
  });
  assert.equal(upgradeDecision.decision, 'allowed');
  assert.equal(assertApiCatalogUpgradeDecisionAllowsCatalog(upgradeDecision), upgradeDecision);

  const rejectedCandidate = createSyntheticCandidate({
    id: 'instagram-blocked-upgrade-policy-candidate',
    siteKey: 'instagram',
    status: 'verified',
    endpoint: {
      method: 'GET',
      url: 'https://www.instagram.com/explore/?access_token=synthetic-instagram-policy-token',
    },
  });
  // @ts-ignore
  const rejectedDecision = adapter.validateApiCandidate({
    candidate: rejectedCandidate,
  });
  // @ts-ignore
  const blockedPolicy = adapter.getApiCatalogUpgradePolicy({
    candidate: rejectedCandidate,
    siteAdapterDecision: rejectedDecision,
  });
  assert.equal(blockedPolicy.allowCatalogUpgrade, false);
  assert.equal(blockedPolicy.reasonCode, 'api-catalog-entry-blocked');
});

test('instagram synthetic verified endpoint fixture catalogs only through explicit allow gate', async () => {
  const adapter = listSiteAdapters().find((candidate) => candidate.id === 'instagram');
  assert.notEqual(adapter, undefined);
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'instagram-catalog-upgrade-fixture-'));
  try {
    const allowedPaths = {
      decisionPath: path.join(runDir, 'allowed', 'decision.json'),
      decisionRedactionAuditPath: path.join(runDir, 'allowed', 'decision.redaction-audit.json'),
      catalogPath: path.join(runDir, 'allowed', 'entry.json'),
      catalogRedactionAuditPath: path.join(runDir, 'allowed', 'entry.redaction-audit.json'),
      verificationEventPath: path.join(runDir, 'allowed', 'verification-event.json'),
      verificationEventRedactionAuditPath: path.join(runDir, 'allowed', 'verification-event.redaction-audit.json'),
    };
    const observedPaths = {
      decisionPath: path.join(runDir, 'observed', 'decision.json'),
      decisionRedactionAuditPath: path.join(runDir, 'observed', 'decision.redaction-audit.json'),
      catalogPath: path.join(runDir, 'observed', 'entry.json'),
      catalogRedactionAuditPath: path.join(runDir, 'observed', 'entry.redaction-audit.json'),
      verificationEventPath: path.join(runDir, 'observed', 'verification-event.json'),
      verificationEventRedactionAuditPath: path.join(runDir, 'observed', 'verification-event.redaction-audit.json'),
    };

    const candidate = createSyntheticCandidate({
      id: 'instagram-verified-fixture-candidate',
      siteKey: 'instagram',
      status: 'verified',
      endpoint: {
        method: 'GET',
        url: 'https://www.instagram.com/api/v1/feed/user/synthetic/',
      },
      request: {
        headers: {
          authorization: 'Bearer synthetic-instagram-fixture-token',
        },
      },
      auth: {
        authorization: 'Bearer synthetic-instagram-fixture-token',
      },
    });
    // @ts-ignore
    const decision = adapter.validateApiCandidate({
      candidate,
      validatedAt: '2026-05-01T19:54:00.000Z',
      evidence: {
        authorization: 'Bearer synthetic-instagram-fixture-token',
        sampleCount: 1,
      },
    });
    // @ts-ignore
    const policy = adapter.getApiCatalogUpgradePolicy({
      candidate,
      siteAdapterDecision: decision,
      decidedAt: '2026-05-01T19:55:00.000Z',
      evidence: {
        authorization: 'Bearer synthetic-instagram-fixture-token',
        sampleCount: 1,
      },
    });

    await writeVerifiedApiCatalogUpgradeFixtureArtifacts({
      candidate,
      siteAdapterDecision: decision,
      policy,
      decidedAt: '2026-05-01T19:56:00.000Z',
      metadata: {
        version: 'instagram-api-v1',
        verifiedAt: '2026-05-01T19:57:00.000Z',
        lastValidatedAt: '2026-05-01T19:58:00.000Z',
      },
    }, {
      ...allowedPaths,
      verificationEventTraceId: 'instagram-fixture-trace',
      verificationEventCorrelationId: 'instagram-fixture-correlation',
    });

    const persistedDecision = JSON.parse(await readFile(allowedPaths.decisionPath, 'utf8'));
    const catalogEntry = JSON.parse(await readFile(allowedPaths.catalogPath, 'utf8'));
    const event = JSON.parse(await readFile(allowedPaths.verificationEventPath, 'utf8'));
    assert.equal(persistedDecision.decision, 'allowed');
    assert.equal(persistedDecision.requirements.siteAdapterAccepted, true);
    assert.equal(persistedDecision.requirements.policyAllowsCatalogUpgrade, true);
    assert.equal(catalogEntry.candidateId, 'instagram-verified-fixture-candidate');
    assert.equal(catalogEntry.version, 'instagram-api-v1');
    assert.equal(catalogEntry.auth.authorization, REDACTION_PLACEHOLDER);
    assert.equal(event.eventType, 'api.catalog.verification.written');
    assert.equal(event.traceId, 'instagram-fixture-trace');
    assert.equal(event.correlationId, 'instagram-fixture-correlation');
    assert.equal(assertSchemaCompatible('LifecycleEvent', event), true);

    for (const filePath of Object.values(allowedPaths)) {
      const text = await readFile(filePath, 'utf8');
      assert.equal(text.includes('synthetic-instagram-fixture-token'), false);
    }

    const observedCandidate = {
      ...candidate,
      id: 'instagram-observed-fixture-candidate',
      status: 'observed',
    };
    // @ts-ignore
    const observedDecision = adapter.validateApiCandidate({ candidate: observedCandidate });
    // @ts-ignore
    const observedPolicy = adapter.getApiCatalogUpgradePolicy({
      candidate: observedCandidate,
      siteAdapterDecision: observedDecision,
    });
    await assert.rejects(
      writeVerifiedApiCatalogUpgradeFixtureArtifacts({
        candidate: observedCandidate,
        siteAdapterDecision: observedDecision,
        policy: observedPolicy,
      }, observedPaths),
      /does not allow catalog entry: api-catalog-entry-blocked/u,
    );
    for (const filePath of Object.values(observedPaths)) {
      await assert.rejects(access(filePath), /ENOENT/u);
    }
  } finally {
    await rm(runDir, { force: true, recursive: true });
  }
});

test('instagram adapter rejects candidates outside its API scope with an API reasonCode', () => {
  const adapter = listSiteAdapters().find((candidate) => candidate.id === 'instagram');
  assert.notEqual(adapter, undefined);

  // @ts-ignore
  const wrongHost = adapter.validateApiCandidate({
    candidate: createSyntheticCandidate({
      id: 'instagram-wrong-host',
      siteKey: 'instagram',
      endpoint: {
        method: 'GET',
        url: 'https://example.invalid/api/v1/feed/user/synthetic/?access_token=synthetic-instagram-token',
      },
    }),
    evidence: {
      authorization: 'Bearer synthetic-instagram-token',
    },
  });
  // @ts-ignore
  const wrongPath = adapter.validateApiCandidate({
    candidate: createSyntheticCandidate({
      id: 'instagram-wrong-path',
      siteKey: 'instagram',
      endpoint: {
        method: 'GET',
        url: 'https://www.instagram.com/explore/?access_token=synthetic-instagram-token',
      },
    }),
  });
  // @ts-ignore
  const wrongSiteKey = adapter.validateApiCandidate({
    candidate: createSyntheticCandidate({
      id: 'instagram-wrong-site',
      siteKey: 'other-site',
      endpoint: {
        method: 'GET',
        url: 'https://www.instagram.com/api/v1/feed/user/synthetic/?access_token=synthetic-instagram-token',
      },
    }),
  });

  assert.equal(wrongHost.decision, 'rejected');
  assert.equal(wrongHost.reasonCode, 'api-verification-failed');
  assert.equal(wrongHost.adapterId, 'instagram');
  assert.equal(wrongHost.evidence.authorization, REDACTION_PLACEHOLDER);
  assert.equal(Object.hasOwn(wrongHost, 'catalogPath'), false);
  assert.equal(wrongPath.decision, 'rejected');
  assert.equal(wrongPath.reasonCode, 'api-verification-failed');
  assert.equal(wrongPath.adapterId, 'instagram');
  assert.equal(Object.hasOwn(wrongPath, 'catalogPath'), false);
  assert.equal(wrongSiteKey.decision, 'rejected');
  assert.equal(wrongSiteKey.reasonCode, 'api-verification-failed');
  assert.equal(wrongSiteKey.adapterId, 'instagram');
  assert.equal(Object.hasOwn(wrongSiteKey, 'catalogPath'), false);
});

test('douyin adapter validates synthetic site API candidates without catalog promotion', async () => {
  const adapter = listSiteAdapters().find((candidate) => candidate.id === 'douyin');
  assert.notEqual(adapter, undefined);
  // @ts-ignore
  assert.equal(typeof adapter.validateApiCandidate, 'function');

  const candidate = createSyntheticCandidate({
    id: 'douyin-api-candidate-1',
    siteKey: 'douyin',
    endpoint: {
      method: 'GET',
      url: 'https://www.douyin.com/aweme/v1/web/aweme/detail/?aweme_id=synthetic&access_token=synthetic-douyin-token',
    },
  });
  // @ts-ignore
  const decision = adapter.validateApiCandidate({
    candidate,
    validatedAt: '2026-05-01T13:10:00.000Z',
    evidence: {
      authorization: 'Bearer synthetic-douyin-token',
      sampleCount: 1,
    },
  });

  assert.equal(decision.contractVersion, SITE_ADAPTER_CANDIDATE_DECISION_VERSION);
  assert.equal(decision.candidateId, 'douyin-api-candidate-1');
  assert.equal(decision.siteKey, 'douyin');
  assert.equal(decision.adapterId, 'douyin');
  assert.equal(decision.decision, 'accepted');
  assert.equal(decision.scope.validationMode, 'douyin-api-candidate');
  assert.equal(decision.scope.endpointHost, 'www.douyin.com');
  assert.equal(decision.scope.endpointPath, '/aweme/v1/web/aweme/detail/');
  assert.equal(decision.evidence.authorization, REDACTION_PLACEHOLDER);
  assert.equal(Object.hasOwn(decision, 'artifactPath'), false);
  assert.equal(Object.hasOwn(decision, 'catalogPath'), false);

  const observedBuildCandidate = createSyntheticCandidate({
    id: 'douyin-observed-build-candidate',
    siteKey: 'douyin.com-73a07da7',
    endpoint: {
      method: 'GET',
      url: 'https://creator.douyin.com/web/api/media/user/info/',
    },
  });
  // @ts-ignore
  const observedDecision = adapter.validateApiCandidate({
    candidate: observedBuildCandidate,
    validatedAt: '2026-05-01T13:10:01.000Z',
  });
  assert.equal(observedDecision.candidateId, 'douyin-observed-build-candidate');
  assert.equal(observedDecision.siteKey, 'douyin.com-73a07da7');
  assert.equal(observedDecision.adapterId, 'douyin');
  assert.equal(observedDecision.decision, 'accepted');
  assert.equal(observedDecision.scope.endpointHost, 'creator.douyin.com');
  assert.equal(observedDecision.scope.endpointPath, '/web/api/media/user/info/');

  await assert.rejects(
    writeApiCatalogEntryArtifact(candidate, { catalogPath: path.join('unused', 'douyin-catalog.json') }),
    /ApiCandidate must be verified before catalog entry/u,
  );
});

test('douyin adapter exposes a pure catalog upgrade policy hook without promotion', () => {
  const adapter = listSiteAdapters().find((candidate) => candidate.id === 'douyin');
  assert.notEqual(adapter, undefined);
  // @ts-ignore
  assert.equal(typeof adapter.getApiCatalogUpgradePolicy, 'function');

  const candidate = createSyntheticCandidate({
    id: 'douyin-upgrade-policy-candidate',
    siteKey: 'douyin',
    status: 'verified',
    endpoint: {
      method: 'GET',
      url: 'https://www.douyin.com/aweme/v1/web/aweme/detail/?aweme_id=synthetic&access_token=synthetic-douyin-policy-token',
    },
  });
  // @ts-ignore
  const decision = adapter.validateApiCandidate({
    candidate,
    validatedAt: '2026-05-01T17:10:00.000Z',
  });
  // @ts-ignore
  const policy = adapter.getApiCatalogUpgradePolicy({
    candidate,
    siteAdapterDecision: decision,
    decidedAt: '2026-05-01T17:10:01.000Z',
    evidence: {
      authorization: 'Bearer synthetic-douyin-policy-token',
      sampleCount: 1,
    },
  });

  assert.equal(policy.contractVersion, SITE_ADAPTER_CATALOG_UPGRADE_POLICY_VERSION);
  assert.equal(policy.candidateId, 'douyin-upgrade-policy-candidate');
  assert.equal(policy.siteKey, 'douyin');
  assert.equal(policy.adapterId, 'douyin');
  assert.equal(policy.allowCatalogUpgrade, true);
  assert.equal(policy.scope.policyMode, 'douyin-aweme-api');
  assert.equal(policy.scope.endpointHost, 'www.douyin.com');
  assert.equal(policy.scope.endpointPath, '/aweme/v1/web/aweme/detail/');
  assert.equal(policy.evidence.authorization, REDACTION_PLACEHOLDER);
  assert.equal(Object.hasOwn(policy, 'artifactPath'), false);
  assert.equal(Object.hasOwn(policy, 'catalogPath'), false);
  assert.equal(Object.hasOwn(policy, 'catalogEntry'), false);

  const upgradeDecision = createApiCatalogUpgradeDecision({
    candidate,
    siteAdapterDecision: decision,
    policy,
  });
  assert.equal(upgradeDecision.decision, 'allowed');
  assert.equal(assertApiCatalogUpgradeDecisionAllowsCatalog(upgradeDecision), upgradeDecision);

  const rejectedCandidate = createSyntheticCandidate({
    id: 'douyin-blocked-upgrade-policy-candidate',
    siteKey: 'douyin',
    status: 'verified',
    endpoint: {
      method: 'GET',
      url: 'https://www.douyin.com/user/synthetic?access_token=synthetic-douyin-policy-token',
    },
  });
  // @ts-ignore
  const rejectedDecision = adapter.validateApiCandidate({
    candidate: rejectedCandidate,
  });
  // @ts-ignore
  const blockedPolicy = adapter.getApiCatalogUpgradePolicy({
    candidate: rejectedCandidate,
    siteAdapterDecision: rejectedDecision,
  });
  assert.equal(blockedPolicy.allowCatalogUpgrade, false);
  assert.equal(blockedPolicy.reasonCode, 'api-catalog-entry-blocked');
});

test('douyin synthetic verified endpoint fixture catalogs only through explicit allow gate', async () => {
  const adapter = listSiteAdapters().find((candidate) => candidate.id === 'douyin');
  assert.notEqual(adapter, undefined);
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'douyin-catalog-upgrade-fixture-'));
  try {
    const allowedPaths = {
      decisionPath: path.join(runDir, 'allowed', 'decision.json'),
      decisionRedactionAuditPath: path.join(runDir, 'allowed', 'decision.redaction-audit.json'),
      catalogPath: path.join(runDir, 'allowed', 'entry.json'),
      catalogRedactionAuditPath: path.join(runDir, 'allowed', 'entry.redaction-audit.json'),
      verificationEventPath: path.join(runDir, 'allowed', 'verification-event.json'),
      verificationEventRedactionAuditPath: path.join(runDir, 'allowed', 'verification-event.redaction-audit.json'),
    };
    const observedPaths = {
      decisionPath: path.join(runDir, 'observed', 'decision.json'),
      decisionRedactionAuditPath: path.join(runDir, 'observed', 'decision.redaction-audit.json'),
      catalogPath: path.join(runDir, 'observed', 'entry.json'),
      catalogRedactionAuditPath: path.join(runDir, 'observed', 'entry.redaction-audit.json'),
      verificationEventPath: path.join(runDir, 'observed', 'verification-event.json'),
      verificationEventRedactionAuditPath: path.join(runDir, 'observed', 'verification-event.redaction-audit.json'),
    };

    const candidate = createSyntheticCandidate({
      id: 'douyin-verified-fixture-candidate',
      siteKey: 'douyin',
      status: 'verified',
      endpoint: {
        method: 'GET',
        url: 'https://www.douyin.com/aweme/v1/web/aweme/detail/',
      },
      request: {
        headers: {
          authorization: 'Bearer synthetic-douyin-fixture-token',
        },
      },
      auth: {
        authorization: 'Bearer synthetic-douyin-fixture-token',
      },
    });
    // @ts-ignore
    const decision = adapter.validateApiCandidate({
      candidate,
      validatedAt: '2026-05-01T20:00:00.000Z',
      evidence: {
        authorization: 'Bearer synthetic-douyin-fixture-token',
        sampleCount: 1,
      },
    });
    // @ts-ignore
    const policy = adapter.getApiCatalogUpgradePolicy({
      candidate,
      siteAdapterDecision: decision,
      decidedAt: '2026-05-01T20:01:00.000Z',
      evidence: {
        authorization: 'Bearer synthetic-douyin-fixture-token',
        sampleCount: 1,
      },
    });

    await writeVerifiedApiCatalogUpgradeFixtureArtifacts({
      candidate,
      siteAdapterDecision: decision,
      policy,
      decidedAt: '2026-05-01T20:02:00.000Z',
      metadata: {
        version: 'douyin-aweme-api-v1',
        verifiedAt: '2026-05-01T20:03:00.000Z',
        lastValidatedAt: '2026-05-01T20:04:00.000Z',
      },
    }, {
      ...allowedPaths,
      verificationEventTraceId: 'douyin-fixture-trace',
      verificationEventCorrelationId: 'douyin-fixture-correlation',
    });

    const persistedDecision = JSON.parse(await readFile(allowedPaths.decisionPath, 'utf8'));
    const catalogEntry = JSON.parse(await readFile(allowedPaths.catalogPath, 'utf8'));
    const event = JSON.parse(await readFile(allowedPaths.verificationEventPath, 'utf8'));
    assert.equal(persistedDecision.decision, 'allowed');
    assert.equal(persistedDecision.requirements.siteAdapterAccepted, true);
    assert.equal(persistedDecision.requirements.policyAllowsCatalogUpgrade, true);
    assert.equal(catalogEntry.candidateId, 'douyin-verified-fixture-candidate');
    assert.equal(catalogEntry.version, 'douyin-aweme-api-v1');
    assert.equal(catalogEntry.auth.authorization, REDACTION_PLACEHOLDER);
    assert.equal(event.eventType, 'api.catalog.verification.written');
    assert.equal(event.traceId, 'douyin-fixture-trace');
    assert.equal(event.correlationId, 'douyin-fixture-correlation');
    assert.equal(assertSchemaCompatible('LifecycleEvent', event), true);

    for (const filePath of Object.values(allowedPaths)) {
      const text = await readFile(filePath, 'utf8');
      assert.equal(text.includes('synthetic-douyin-fixture-token'), false);
    }

    const observedCandidate = {
      ...candidate,
      id: 'douyin-observed-fixture-candidate',
      status: 'observed',
    };
    // @ts-ignore
    const observedDecision = adapter.validateApiCandidate({ candidate: observedCandidate });
    // @ts-ignore
    const observedPolicy = adapter.getApiCatalogUpgradePolicy({
      candidate: observedCandidate,
      siteAdapterDecision: observedDecision,
    });
    await assert.rejects(
      writeVerifiedApiCatalogUpgradeFixtureArtifacts({
        candidate: observedCandidate,
        siteAdapterDecision: observedDecision,
        policy: observedPolicy,
      }, observedPaths),
      /does not allow catalog entry: api-catalog-entry-blocked/u,
    );
    for (const filePath of Object.values(observedPaths)) {
      await assert.rejects(access(filePath), /ENOENT/u);
    }
  } finally {
    await rm(runDir, { force: true, recursive: true });
  }
});

test('douyin adapter rejects candidates outside its API scope with an API reasonCode', () => {
  const adapter = listSiteAdapters().find((candidate) => candidate.id === 'douyin');
  assert.notEqual(adapter, undefined);

  // @ts-ignore
  const wrongHost = adapter.validateApiCandidate({
    candidate: createSyntheticCandidate({
      id: 'douyin-wrong-host',
      siteKey: 'douyin',
      endpoint: {
        method: 'GET',
        url: 'https://example.invalid/aweme/v1/web/aweme/detail/?access_token=synthetic-douyin-token',
      },
    }),
    evidence: {
      authorization: 'Bearer synthetic-douyin-token',
    },
  });
  // @ts-ignore
  const wrongPath = adapter.validateApiCandidate({
    candidate: createSyntheticCandidate({
      id: 'douyin-wrong-path',
      siteKey: 'douyin',
      endpoint: {
        method: 'GET',
        url: 'https://www.douyin.com/user/synthetic?access_token=synthetic-douyin-token',
      },
    }),
  });
  // @ts-ignore
  const wrongSiteKey = adapter.validateApiCandidate({
    candidate: createSyntheticCandidate({
      id: 'douyin-wrong-site',
      siteKey: 'other-site',
      endpoint: {
        method: 'GET',
        url: 'https://www.douyin.com/aweme/v1/web/aweme/detail/?access_token=synthetic-douyin-token',
      },
    }),
  });

  assert.equal(wrongHost.decision, 'rejected');
  assert.equal(wrongHost.reasonCode, 'api-verification-failed');
  assert.equal(wrongHost.adapterId, 'douyin');
  assert.equal(wrongHost.evidence.authorization, REDACTION_PLACEHOLDER);
  assert.equal(Object.hasOwn(wrongHost, 'catalogPath'), false);
  assert.equal(wrongPath.decision, 'rejected');
  assert.equal(wrongPath.reasonCode, 'api-verification-failed');
  assert.equal(wrongPath.adapterId, 'douyin');
  assert.equal(Object.hasOwn(wrongPath, 'catalogPath'), false);
  assert.equal(wrongSiteKey.decision, 'rejected');
  assert.equal(wrongSiteKey.reasonCode, 'api-verification-failed');
  assert.equal(wrongSiteKey.adapterId, 'douyin');
  assert.equal(Object.hasOwn(wrongSiteKey, 'catalogPath'), false);
});

test('xiaohongshu adapter validates synthetic site API candidates without catalog promotion', async () => {
  const adapter = listSiteAdapters().find((candidate) => candidate.id === 'xiaohongshu');
  assert.notEqual(adapter, undefined);
  // @ts-ignore
  assert.equal(typeof adapter.validateApiCandidate, 'function');

  const candidate = createSyntheticCandidate({
    id: 'xiaohongshu-api-candidate-1',
    siteKey: 'xiaohongshu',
    endpoint: {
      method: 'GET',
      url: 'https://www.xiaohongshu.com/api/sns/web/v1/feed?note_id=synthetic&access_token=synthetic-xiaohongshu-token',
    },
  });
  // @ts-ignore
  const decision = adapter.validateApiCandidate({
    candidate,
    validatedAt: '2026-05-01T13:30:00.000Z',
    evidence: {
      authorization: 'Bearer synthetic-xiaohongshu-token',
      sampleCount: 1,
    },
  });

  assert.equal(decision.contractVersion, SITE_ADAPTER_CANDIDATE_DECISION_VERSION);
  assert.equal(decision.candidateId, 'xiaohongshu-api-candidate-1');
  assert.equal(decision.siteKey, 'xiaohongshu');
  assert.equal(decision.adapterId, 'xiaohongshu');
  assert.equal(decision.decision, 'accepted');
  assert.equal(decision.scope.validationMode, 'xiaohongshu-api-candidate');
  assert.equal(decision.scope.endpointHost, 'www.xiaohongshu.com');
  assert.equal(decision.scope.endpointPath, '/api/sns/web/v1/feed');
  assert.equal(decision.evidence.authorization, REDACTION_PLACEHOLDER);
  assert.equal(Object.hasOwn(decision, 'artifactPath'), false);
  assert.equal(Object.hasOwn(decision, 'catalogPath'), false);

  await assert.rejects(
    writeApiCatalogEntryArtifact(candidate, { catalogPath: path.join('unused', 'xiaohongshu-catalog.json') }),
    /ApiCandidate must be verified before catalog entry/u,
  );
});

test('xiaohongshu adapter exposes a pure catalog upgrade policy hook without promotion', () => {
  const adapter = listSiteAdapters().find((candidate) => candidate.id === 'xiaohongshu');
  assert.notEqual(adapter, undefined);
  // @ts-ignore
  assert.equal(typeof adapter.getApiCatalogUpgradePolicy, 'function');

  const candidate = createSyntheticCandidate({
    id: 'xiaohongshu-upgrade-policy-candidate',
    siteKey: 'xiaohongshu',
    status: 'verified',
    endpoint: {
      method: 'GET',
      url: 'https://www.xiaohongshu.com/api/sns/web/v1/feed?note_id=synthetic&access_token=synthetic-xiaohongshu-policy-token',
    },
  });
  // @ts-ignore
  const decision = adapter.validateApiCandidate({
    candidate,
    validatedAt: '2026-05-01T17:25:00.000Z',
  });
  // @ts-ignore
  const policy = adapter.getApiCatalogUpgradePolicy({
    candidate,
    siteAdapterDecision: decision,
    decidedAt: '2026-05-01T17:25:01.000Z',
    evidence: {
      authorization: 'Bearer synthetic-xiaohongshu-policy-token',
      sampleCount: 1,
    },
  });

  assert.equal(policy.contractVersion, SITE_ADAPTER_CATALOG_UPGRADE_POLICY_VERSION);
  assert.equal(policy.candidateId, 'xiaohongshu-upgrade-policy-candidate');
  assert.equal(policy.siteKey, 'xiaohongshu');
  assert.equal(policy.adapterId, 'xiaohongshu');
  assert.equal(policy.allowCatalogUpgrade, true);
  assert.equal(policy.scope.policyMode, 'xiaohongshu-api');
  assert.equal(policy.scope.endpointHost, 'www.xiaohongshu.com');
  assert.equal(policy.scope.endpointPath, '/api/sns/web/v1/feed');
  assert.equal(policy.evidence.authorization, REDACTION_PLACEHOLDER);
  assert.equal(Object.hasOwn(policy, 'artifactPath'), false);
  assert.equal(Object.hasOwn(policy, 'catalogPath'), false);
  assert.equal(Object.hasOwn(policy, 'catalogEntry'), false);

  const upgradeDecision = createApiCatalogUpgradeDecision({
    candidate,
    siteAdapterDecision: decision,
    policy,
  });
  assert.equal(upgradeDecision.decision, 'allowed');
  assert.equal(assertApiCatalogUpgradeDecisionAllowsCatalog(upgradeDecision), upgradeDecision);

  const rejectedCandidate = createSyntheticCandidate({
    id: 'xiaohongshu-blocked-upgrade-policy-candidate',
    siteKey: 'xiaohongshu',
    status: 'verified',
    endpoint: {
      method: 'GET',
      url: 'https://www.xiaohongshu.com/explore/synthetic?access_token=synthetic-xiaohongshu-policy-token',
    },
  });
  // @ts-ignore
  const rejectedDecision = adapter.validateApiCandidate({
    candidate: rejectedCandidate,
  });
  // @ts-ignore
  const blockedPolicy = adapter.getApiCatalogUpgradePolicy({
    candidate: rejectedCandidate,
    siteAdapterDecision: rejectedDecision,
  });
  assert.equal(blockedPolicy.allowCatalogUpgrade, false);
  assert.equal(blockedPolicy.reasonCode, 'api-catalog-entry-blocked');
});

test('xiaohongshu synthetic verified endpoint fixture catalogs only through explicit allow gate', async () => {
  const adapter = listSiteAdapters().find((candidate) => candidate.id === 'xiaohongshu');
  assert.notEqual(adapter, undefined);
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'xiaohongshu-catalog-upgrade-fixture-'));
  try {
    const allowedPaths = {
      decisionPath: path.join(runDir, 'allowed', 'decision.json'),
      decisionRedactionAuditPath: path.join(runDir, 'allowed', 'decision.redaction-audit.json'),
      catalogPath: path.join(runDir, 'allowed', 'entry.json'),
      catalogRedactionAuditPath: path.join(runDir, 'allowed', 'entry.redaction-audit.json'),
      verificationEventPath: path.join(runDir, 'allowed', 'verification-event.json'),
      verificationEventRedactionAuditPath: path.join(runDir, 'allowed', 'verification-event.redaction-audit.json'),
    };
    const observedPaths = {
      decisionPath: path.join(runDir, 'observed', 'decision.json'),
      decisionRedactionAuditPath: path.join(runDir, 'observed', 'decision.redaction-audit.json'),
      catalogPath: path.join(runDir, 'observed', 'entry.json'),
      catalogRedactionAuditPath: path.join(runDir, 'observed', 'entry.redaction-audit.json'),
      verificationEventPath: path.join(runDir, 'observed', 'verification-event.json'),
      verificationEventRedactionAuditPath: path.join(runDir, 'observed', 'verification-event.redaction-audit.json'),
    };

    const candidate = createSyntheticCandidate({
      id: 'xiaohongshu-verified-fixture-candidate',
      siteKey: 'xiaohongshu',
      status: 'verified',
      endpoint: {
        method: 'GET',
        url: 'https://www.xiaohongshu.com/api/sns/web/v1/feed',
      },
      request: {
        headers: {
          authorization: 'Bearer synthetic-xiaohongshu-fixture-token',
        },
      },
      auth: {
        authorization: 'Bearer synthetic-xiaohongshu-fixture-token',
      },
    });
    // @ts-ignore
    const decision = adapter.validateApiCandidate({
      candidate,
      validatedAt: '2026-05-01T20:05:00.000Z',
      evidence: {
        authorization: 'Bearer synthetic-xiaohongshu-fixture-token',
        sampleCount: 1,
      },
    });
    // @ts-ignore
    const policy = adapter.getApiCatalogUpgradePolicy({
      candidate,
      siteAdapterDecision: decision,
      decidedAt: '2026-05-01T20:06:00.000Z',
      evidence: {
        authorization: 'Bearer synthetic-xiaohongshu-fixture-token',
        sampleCount: 1,
      },
    });

    await writeVerifiedApiCatalogUpgradeFixtureArtifacts({
      candidate,
      siteAdapterDecision: decision,
      policy,
      decidedAt: '2026-05-01T20:07:00.000Z',
      metadata: {
        version: 'xiaohongshu-api-v1',
        verifiedAt: '2026-05-01T20:08:00.000Z',
        lastValidatedAt: '2026-05-01T20:09:00.000Z',
      },
    }, {
      ...allowedPaths,
      verificationEventTraceId: 'xiaohongshu-fixture-trace',
      verificationEventCorrelationId: 'xiaohongshu-fixture-correlation',
    });

    const persistedDecision = JSON.parse(await readFile(allowedPaths.decisionPath, 'utf8'));
    const catalogEntry = JSON.parse(await readFile(allowedPaths.catalogPath, 'utf8'));
    const event = JSON.parse(await readFile(allowedPaths.verificationEventPath, 'utf8'));
    assert.equal(persistedDecision.decision, 'allowed');
    assert.equal(persistedDecision.requirements.siteAdapterAccepted, true);
    assert.equal(persistedDecision.requirements.policyAllowsCatalogUpgrade, true);
    assert.equal(catalogEntry.candidateId, 'xiaohongshu-verified-fixture-candidate');
    assert.equal(catalogEntry.version, 'xiaohongshu-api-v1');
    assert.equal(catalogEntry.auth.authorization, REDACTION_PLACEHOLDER);
    assert.equal(event.eventType, 'api.catalog.verification.written');
    assert.equal(event.traceId, 'xiaohongshu-fixture-trace');
    assert.equal(event.correlationId, 'xiaohongshu-fixture-correlation');
    assert.equal(assertSchemaCompatible('LifecycleEvent', event), true);

    for (const filePath of Object.values(allowedPaths)) {
      const text = await readFile(filePath, 'utf8');
      assert.equal(text.includes('synthetic-xiaohongshu-fixture-token'), false);
    }

    const observedCandidate = {
      ...candidate,
      id: 'xiaohongshu-observed-fixture-candidate',
      status: 'observed',
    };
    // @ts-ignore
    const observedDecision = adapter.validateApiCandidate({ candidate: observedCandidate });
    // @ts-ignore
    const observedPolicy = adapter.getApiCatalogUpgradePolicy({
      candidate: observedCandidate,
      siteAdapterDecision: observedDecision,
    });
    await assert.rejects(
      writeVerifiedApiCatalogUpgradeFixtureArtifacts({
        candidate: observedCandidate,
        siteAdapterDecision: observedDecision,
        policy: observedPolicy,
      }, observedPaths),
      /does not allow catalog entry: api-catalog-entry-blocked/u,
    );
    for (const filePath of Object.values(observedPaths)) {
      await assert.rejects(access(filePath), /ENOENT/u);
    }
  } finally {
    await rm(runDir, { force: true, recursive: true });
  }
});

test('xiaohongshu adapter rejects candidates outside its API scope with an API reasonCode', () => {
  const adapter = listSiteAdapters().find((candidate) => candidate.id === 'xiaohongshu');
  assert.notEqual(adapter, undefined);

  // @ts-ignore
  const wrongHost = adapter.validateApiCandidate({
    candidate: createSyntheticCandidate({
      id: 'xiaohongshu-wrong-host',
      siteKey: 'xiaohongshu',
      endpoint: {
        method: 'GET',
        url: 'https://example.invalid/api/sns/web/v1/feed?access_token=synthetic-xiaohongshu-token',
      },
    }),
    evidence: {
      authorization: 'Bearer synthetic-xiaohongshu-token',
    },
  });
  // @ts-ignore
  const wrongPath = adapter.validateApiCandidate({
    candidate: createSyntheticCandidate({
      id: 'xiaohongshu-wrong-path',
      siteKey: 'xiaohongshu',
      endpoint: {
        method: 'GET',
        url: 'https://www.xiaohongshu.com/explore/synthetic?access_token=synthetic-xiaohongshu-token',
      },
    }),
  });
  // @ts-ignore
  const wrongSiteKey = adapter.validateApiCandidate({
    candidate: createSyntheticCandidate({
      id: 'xiaohongshu-wrong-site',
      siteKey: 'other-site',
      endpoint: {
        method: 'GET',
        url: 'https://www.xiaohongshu.com/api/sns/web/v1/feed?access_token=synthetic-xiaohongshu-token',
      },
    }),
  });

  assert.equal(wrongHost.decision, 'rejected');
  assert.equal(wrongHost.reasonCode, 'api-verification-failed');
  assert.equal(wrongHost.adapterId, 'xiaohongshu');
  assert.equal(wrongHost.evidence.authorization, REDACTION_PLACEHOLDER);
  assert.equal(Object.hasOwn(wrongHost, 'catalogPath'), false);
  assert.equal(wrongPath.decision, 'rejected');
  assert.equal(wrongPath.reasonCode, 'api-verification-failed');
  assert.equal(wrongPath.adapterId, 'xiaohongshu');
  assert.equal(Object.hasOwn(wrongPath, 'catalogPath'), false);
  assert.equal(wrongSiteKey.decision, 'rejected');
  assert.equal(wrongSiteKey.reasonCode, 'api-verification-failed');
  assert.equal(wrongSiteKey.adapterId, 'xiaohongshu');
  assert.equal(Object.hasOwn(wrongSiteKey, 'catalogPath'), false);
});

test('bilibili adapter validates synthetic public API candidates without catalog promotion', async () => {
  const adapter = listSiteAdapters().find((candidate) => candidate.id === 'bilibili');
  assert.notEqual(adapter, undefined);
  // @ts-ignore
  assert.equal(typeof adapter.validateApiCandidate, 'function');

  const candidate = createSyntheticCandidate({
    id: 'bilibili-api-candidate-1',
    siteKey: 'bilibili',
    endpoint: {
      method: 'GET',
      url: 'https://api.bilibili.com/x/web-interface/view?bvid=BV1xx411c7mD&access_key=synthetic-bilibili-token',
    },
  });
  // @ts-ignore
  const decision = adapter.validateApiCandidate({
    candidate,
    validatedAt: '2026-05-01T08:40:00.000Z',
    evidence: {
      authorization: 'Bearer synthetic-bilibili-token',
      sampleCount: 1,
    },
  });

  assert.equal(decision.contractVersion, SITE_ADAPTER_CANDIDATE_DECISION_VERSION);
  assert.equal(decision.candidateId, 'bilibili-api-candidate-1');
  assert.equal(decision.siteKey, 'bilibili');
  assert.equal(decision.adapterId, 'bilibili');
  assert.equal(decision.decision, 'accepted');
  assert.equal(decision.scope.validationMode, 'bilibili-api-candidate');
  assert.equal(decision.scope.endpointHost, 'api.bilibili.com');
  assert.equal(decision.scope.endpointPath, '/x/web-interface/view');
  assert.equal(decision.evidence.authorization, REDACTION_PLACEHOLDER);
  assert.equal(Object.hasOwn(decision, 'artifactPath'), false);
  assert.equal(Object.hasOwn(decision, 'catalogPath'), false);

  await assert.rejects(
    writeApiCatalogEntryArtifact(candidate, { catalogPath: path.join('unused', 'bilibili-catalog.json') }),
    /ApiCandidate must be verified before catalog entry/u,
  );
});

test('bilibili adapter exposes concrete API semantics for UP-space resolver evidence', () => {
  const adapter = listSiteAdapters().find((candidate) => candidate.id === 'bilibili');
  assert.notEqual(adapter, undefined);
  assert.equal(typeof adapter.describeApiCandidateSemantics, 'function');

  const semantics = adapter.describeApiCandidateSemantics({
    candidate: createSyntheticCandidate({
      id: 'bilibili-up-space-semantic-candidate',
      siteKey: 'bilibili',
      endpoint: {
        method: 'GET',
        url: 'https://api.bilibili.com/x/space/wbi/arc/search?mid=123&access_key=synthetic-bilibili-semantic-token',
      },
      auth: {
        cookie: 'SESSDATA=synthetic-bilibili-semantic-cookie',
      },
    }),
    scope: {
      authorization: 'Bearer synthetic-bilibili-semantic-token',
    },
  });

  assert.equal(semantics.contractVersion, SITE_ADAPTER_SEMANTIC_ENTRY_VERSION);
  assert.equal(semantics.adapterId, 'bilibili');
  assert.equal(semantics.siteKey, 'bilibili');
  assert.equal(semantics.candidateId, 'bilibili-up-space-semantic-candidate');
  assert.equal(semantics.scope.semanticMode, 'bilibili-api-candidate');
  assert.equal(semantics.scope.endpointHost, 'api.bilibili.com');
  assert.equal(semantics.scope.endpointPath, '/x/space/wbi/arc/search');
  assert.equal(semantics.scope.apiKind, 'space-archives');
  assert.equal(semantics.scope.resolverRole, 'playlist-list');
  assert.equal(semantics.auth.freshnessEvidenceRequired, true);
  assert.equal(semantics.auth.signatureEvidenceRequired, 'wbi');
  assert.equal(semantics.auth.cookie, REDACTION_PLACEHOLDER);
  assert.equal(semantics.scope.authorization, REDACTION_PLACEHOLDER);
  assert.equal(semantics.pagination.model, 'page-number');
  assert.equal(semantics.pagination.pageParam, 'pn');
  assert.equal(semantics.pagination.pageSizeParam, 'ps');
  assert.equal(semantics.fieldMapping.itemsPath, 'data.list.vlist');
  assert.equal(semantics.risk.riskCodes.includes(-412), true);
  assert.equal(semantics.risk.riskReasonCode, 'bilibili-api-evidence-unavailable');
  assertNoForbiddenSemanticKeys(semantics);

  const serialized = JSON.stringify(semantics);
  assert.equal(serialized.includes('synthetic-bilibili-semantic'), false);
  assert.equal(serialized.includes('SESSDATA='), false);
  assert.equal(serialized.includes('Bearer '), false);
});

test('bilibili adapter exposes a pure catalog upgrade policy hook without promotion', () => {
  const adapter = listSiteAdapters().find((candidate) => candidate.id === 'bilibili');
  assert.notEqual(adapter, undefined);
  // @ts-ignore
  assert.equal(typeof adapter.getApiCatalogUpgradePolicy, 'function');

  const candidate = createSyntheticCandidate({
    id: 'bilibili-upgrade-policy-candidate',
    siteKey: 'bilibili',
    status: 'verified',
    endpoint: {
      method: 'GET',
      url: 'https://api.bilibili.com/x/web-interface/view?bvid=BV1xx411c7mD&access_key=synthetic-bilibili-policy-token',
    },
  });
  // @ts-ignore
  const decision = adapter.validateApiCandidate({
    candidate,
    validatedAt: '2026-05-01T15:50:00.000Z',
  });
  // @ts-ignore
  const policy = adapter.getApiCatalogUpgradePolicy({
    candidate,
    siteAdapterDecision: decision,
    decidedAt: '2026-05-01T15:51:00.000Z',
    evidence: {
      authorization: 'Bearer synthetic-bilibili-policy-token',
      sampleCount: 1,
    },
  });

  assert.equal(policy.contractVersion, SITE_ADAPTER_CATALOG_UPGRADE_POLICY_VERSION);
  assert.equal(policy.candidateId, 'bilibili-upgrade-policy-candidate');
  assert.equal(policy.siteKey, 'bilibili');
  assert.equal(policy.adapterId, 'bilibili');
  assert.equal(policy.allowCatalogUpgrade, true);
  assert.equal(policy.scope.policyMode, 'bilibili-public-api');
  assert.equal(policy.scope.endpointHost, 'api.bilibili.com');
  assert.equal(policy.scope.endpointPath, '/x/web-interface/view');
  assert.equal(policy.evidence.authorization, REDACTION_PLACEHOLDER);
  assert.equal(Object.hasOwn(policy, 'artifactPath'), false);
  assert.equal(Object.hasOwn(policy, 'catalogPath'), false);
  assert.equal(Object.hasOwn(policy, 'catalogEntry'), false);

  const upgradeDecision = createApiCatalogUpgradeDecision({
    candidate,
    siteAdapterDecision: decision,
    policy,
  });
  assert.equal(upgradeDecision.decision, 'allowed');
  assert.equal(assertApiCatalogUpgradeDecisionAllowsCatalog(upgradeDecision), upgradeDecision);

  const wrongHostCandidate = createSyntheticCandidate({
    id: 'bilibili-upgrade-policy-wrong-host',
    siteKey: 'bilibili',
    status: 'verified',
    endpoint: {
      method: 'GET',
      url: 'https://example.invalid/x/web-interface/view?access_key=synthetic-bilibili-policy-token',
    },
  });
  // @ts-ignore
  const rejectedDecision = adapter.validateApiCandidate({
    candidate: wrongHostCandidate,
  });
  // @ts-ignore
  const blockedPolicy = adapter.getApiCatalogUpgradePolicy({
    candidate: wrongHostCandidate,
    siteAdapterDecision: rejectedDecision,
  });
  assert.equal(blockedPolicy.allowCatalogUpgrade, false);
  assert.equal(blockedPolicy.reasonCode, 'api-catalog-entry-blocked');
});

test('bilibili synthetic verified endpoint fixture catalogs only through explicit allow gate', async () => {
  const adapter = listSiteAdapters().find((candidate) => candidate.id === 'bilibili');
  assert.notEqual(adapter, undefined);
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'bilibili-catalog-upgrade-fixture-'));
  try {
    const allowedPaths = {
      decisionPath: path.join(runDir, 'allowed', 'decision.json'),
      decisionRedactionAuditPath: path.join(runDir, 'allowed', 'decision.redaction-audit.json'),
      catalogPath: path.join(runDir, 'allowed', 'entry.json'),
      catalogRedactionAuditPath: path.join(runDir, 'allowed', 'entry.redaction-audit.json'),
      verificationEventPath: path.join(runDir, 'allowed', 'verification-event.json'),
      verificationEventRedactionAuditPath: path.join(runDir, 'allowed', 'verification-event.redaction-audit.json'),
    };
    const observedPaths = {
      decisionPath: path.join(runDir, 'observed', 'decision.json'),
      decisionRedactionAuditPath: path.join(runDir, 'observed', 'decision.redaction-audit.json'),
      catalogPath: path.join(runDir, 'observed', 'entry.json'),
      catalogRedactionAuditPath: path.join(runDir, 'observed', 'entry.redaction-audit.json'),
      verificationEventPath: path.join(runDir, 'observed', 'verification-event.json'),
      verificationEventRedactionAuditPath: path.join(runDir, 'observed', 'verification-event.redaction-audit.json'),
    };

    const candidate = createSyntheticCandidate({
      id: 'bilibili-verified-fixture-candidate',
      siteKey: 'bilibili',
      status: 'verified',
      endpoint: {
        method: 'GET',
        url: 'https://api.bilibili.com/x/web-interface/view?bvid=BV1xx411c7mD',
      },
      request: {
        headers: {
          authorization: 'Bearer synthetic-bilibili-fixture-token',
        },
      },
      auth: {
        authorization: 'Bearer synthetic-bilibili-fixture-token',
      },
    });
    // @ts-ignore
    const decision = adapter.validateApiCandidate({
      candidate,
      validatedAt: '2026-05-01T19:35:00.000Z',
      evidence: {
        authorization: 'Bearer synthetic-bilibili-fixture-token',
        sampleCount: 1,
      },
    });
    // @ts-ignore
    const policy = adapter.getApiCatalogUpgradePolicy({
      candidate,
      siteAdapterDecision: decision,
      decidedAt: '2026-05-01T19:36:00.000Z',
      evidence: {
        authorization: 'Bearer synthetic-bilibili-fixture-token',
        sampleCount: 1,
      },
    });

    await writeVerifiedApiCatalogUpgradeFixtureArtifacts({
      candidate,
      siteAdapterDecision: decision,
      policy,
      decidedAt: '2026-05-01T19:37:00.000Z',
      metadata: {
        version: 'bilibili-public-api-v1',
        verifiedAt: '2026-05-01T19:38:00.000Z',
        lastValidatedAt: '2026-05-01T19:39:00.000Z',
      },
    }, {
      ...allowedPaths,
      verificationEventTraceId: 'bilibili-fixture-trace',
      verificationEventCorrelationId: 'bilibili-fixture-correlation',
    });

    const persistedDecision = JSON.parse(await readFile(allowedPaths.decisionPath, 'utf8'));
    const catalogEntry = JSON.parse(await readFile(allowedPaths.catalogPath, 'utf8'));
    const event = JSON.parse(await readFile(allowedPaths.verificationEventPath, 'utf8'));
    assert.equal(persistedDecision.decision, 'allowed');
    assert.equal(persistedDecision.requirements.siteAdapterAccepted, true);
    assert.equal(persistedDecision.requirements.policyAllowsCatalogUpgrade, true);
    assert.equal(catalogEntry.candidateId, 'bilibili-verified-fixture-candidate');
    assert.equal(catalogEntry.version, 'bilibili-public-api-v1');
    assert.equal(catalogEntry.auth.authorization, REDACTION_PLACEHOLDER);
    assert.equal(event.eventType, 'api.catalog.verification.written');
    assert.equal(event.traceId, 'bilibili-fixture-trace');
    assert.equal(event.correlationId, 'bilibili-fixture-correlation');
    assert.equal(assertSchemaCompatible('LifecycleEvent', event), true);

    for (const filePath of Object.values(allowedPaths)) {
      const text = await readFile(filePath, 'utf8');
      assert.equal(text.includes('synthetic-bilibili-fixture-token'), false);
    }

    const observedCandidate = {
      ...candidate,
      id: 'bilibili-observed-fixture-candidate',
      status: 'observed',
    };
    // @ts-ignore
    const observedDecision = adapter.validateApiCandidate({ candidate: observedCandidate });
    // @ts-ignore
    const observedPolicy = adapter.getApiCatalogUpgradePolicy({
      candidate: observedCandidate,
      siteAdapterDecision: observedDecision,
    });
    await assert.rejects(
      writeVerifiedApiCatalogUpgradeFixtureArtifacts({
        candidate: observedCandidate,
        siteAdapterDecision: observedDecision,
        policy: observedPolicy,
      }, observedPaths),
      /does not allow catalog entry: api-catalog-entry-blocked/u,
    );
    for (const filePath of Object.values(observedPaths)) {
      await assert.rejects(access(filePath), /ENOENT/u);
    }
  } finally {
    await rm(runDir, { force: true, recursive: true });
  }
});

test('bilibili adapter rejects candidates outside its API scope with an API reasonCode', () => {
  const adapter = listSiteAdapters().find((candidate) => candidate.id === 'bilibili');
  assert.notEqual(adapter, undefined);

  // @ts-ignore
  const wrongHost = adapter.validateApiCandidate({
    candidate: createSyntheticCandidate({
      id: 'bilibili-wrong-host',
      siteKey: 'bilibili',
      endpoint: {
        method: 'GET',
        url: 'https://example.invalid/x/web-interface/view?access_key=synthetic-bilibili-token',
      },
    }),
    evidence: {
      authorization: 'Bearer synthetic-bilibili-token',
    },
  });
  // @ts-ignore
  const wrongSiteKey = adapter.validateApiCandidate({
    candidate: createSyntheticCandidate({
      id: 'bilibili-wrong-site',
      siteKey: 'other-site',
      endpoint: {
        method: 'GET',
        url: 'https://api.bilibili.com/x/web-interface/view?access_key=synthetic-bilibili-token',
      },
    }),
  });

  assert.equal(wrongHost.decision, 'rejected');
  assert.equal(wrongHost.reasonCode, 'api-verification-failed');
  assert.equal(wrongHost.adapterId, 'bilibili');
  assert.equal(wrongHost.evidence.authorization, REDACTION_PLACEHOLDER);
  assert.equal(Object.hasOwn(wrongHost, 'catalogPath'), false);
  assert.equal(wrongSiteKey.decision, 'rejected');
  assert.equal(wrongSiteKey.reasonCode, 'api-verification-failed');
  assert.equal(wrongSiteKey.adapterId, 'bilibili');
  assert.equal(Object.hasOwn(wrongSiteKey, 'catalogPath'), false);

  // @ts-ignore
  const unsupportedPath = adapter.validateApiCandidate({
    candidate: createSyntheticCandidate({
      id: 'bilibili-unsupported-api',
      siteKey: 'bilibili',
      endpoint: {
        method: 'GET',
        url: 'https://api.bilibili.com/x/unsupported/path',
      },
    }),
  });
  assert.equal(unsupportedPath.decision, 'rejected');
  assert.equal(unsupportedPath.reasonCode, 'api-verification-failed');
  assert.equal(unsupportedPath.scope.apiKind, 'unsupported');
});
