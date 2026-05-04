import test from 'node:test';
import assert from 'node:assert/strict';

import {
  KERNEL_ALLOWED_RESPONSIBILITY_IDS,
  KERNEL_CONTRACT_SCHEMA_VERSION,
  assertKernelContract,
  listKernelAllowedResponsibilities,
  normalizeKernelResponsibility,
} from '../../src/kernel/site-capability-kernel-contract.mjs';
import {
  KERNEL_RUNTIME_READINESS_SCHEMA_VERSION,
  assertSiteCapabilityKernelRuntimeReadiness,
  getSiteCapabilityKernelRuntimeReadinessEvidence,
} from '../../src/kernel/site-capability-runtime-readiness.mjs';

test('Kernel contract allows only lightweight orchestration and governance responsibilities', () => {
  assert.equal(KERNEL_CONTRACT_SCHEMA_VERSION, 1);
  assert.deepEqual(
    listKernelAllowedResponsibilities().map((entry) => entry.id),
    KERNEL_ALLOWED_RESPONSIBILITY_IDS,
  );
  assert.equal(assertKernelContract(), true);

  for (const responsibility of [
    'orchestration',
    'context',
    'artifact',
    'schema',
    'reason',
    'lifecycle',
  ]) {
    const normalized = normalizeKernelResponsibility(responsibility);
    assert.equal(normalized.owner, 'Kernel');
    assert.equal(normalized.allowed, true);
    assert.equal(normalized.boundary, 'lightweight-orchestrator');
  }
});

test('Kernel contract rejects concrete site semantics and site-specific interpretation', () => {
  assert.throws(
    () => normalizeKernelResponsibility({
      id: 'bilibili-page-type-interpretation',
      description: 'bilibili page type interpretation',
    }),
    /Kernel must not own concrete site semantics/u,
  );
  assert.throws(
    () => normalizeKernelResponsibility({
      id: 'site-specific-semantics',
      description: 'site-specific site semantics classification',
    }),
    /SiteAdapter owns/u,
  );
});

test('Kernel contract rejects raw credentials, raw sessions, and browser profile handling', () => {
  for (const proposed of [
    {
      id: 'raw-cookie-reader',
      cookie: 'SESSDATA=synthetic-value',
    },
    {
      id: 'raw-session-material-governance',
      description: 'raw session material handling',
    },
    {
      id: 'browser-profile-owner',
      description: 'browser profile path owner',
    },
  ]) {
    assert.throws(
      () => normalizeKernelResponsibility(proposed),
      /Kernel must not own raw credential or session material handling/u,
    );
  }
});

test('Kernel contract rejects downloader execution and API discovery/catalog semantics', () => {
  assert.throws(
    () => normalizeKernelResponsibility({
      id: 'downloader-execution',
      description: 'downloader execution',
    }),
    /Kernel must not own downloader execution/u,
  );
  assert.throws(
    () => normalizeKernelResponsibility({
      id: 'api-catalog-semantics',
      description: 'api catalog semantics',
    }),
    /Kernel must not own API discovery or catalog semantics/u,
  );
});

test('Kernel contract fails closed for unknown responsibilities', () => {
  assert.throws(
    () => normalizeKernelResponsibility('plugin-registration'),
    /Unknown Kernel responsibility/u,
  );
  assert.throws(
    () => normalizeKernelResponsibility({}),
    /Unknown Kernel responsibility/u,
  );
  assert.throws(
    () => assertKernelContract([]),
    /must declare at least one responsibility/u,
  );
});

test('Kernel runtime readiness guard composes Kernel contract with schema-governance readiness evidence', () => {
  const evidence = getSiteCapabilityKernelRuntimeReadinessEvidence();
  assert.equal(evidence.schemaVersion, KERNEL_RUNTIME_READINESS_SCHEMA_VERSION);
  assert.equal(evidence.owner, 'Kernel');
  assert.equal(evidence.guard, 'assertSiteCapabilityKernelRuntimeReadiness');
  assert.deepEqual(evidence.contract.responsibilityIds, KERNEL_ALLOWED_RESPONSIBILITY_IDS);
  assert.deepEqual(
    evidence.contract.responsibilities.map((entry) => entry.id),
    KERNEL_ALLOWED_RESPONSIBILITY_IDS,
  );
  assert.deepEqual(evidence.schemaGovernance.runtimeVersionFamily, {
    key: 'RuntimeReadiness',
    section: 12,
    owner: 'Kernel',
    producerRole: 'Kernel/SiteAdapter/CapabilityService',
    consumerRole: 'downloader/runtime handoff',
    schemaNames: [
      'LifecycleEvent',
      'SiteAdapterCandidateDecision',
      'SiteAdapterCatalogUpgradePolicy',
      'StandardTaskList',
      'DownloadPolicy',
      'SessionView',
      'RiskState',
    ],
  });
  assert.doesNotMatch(
    evidence.schemaGovernance.runtimeVersionFamily.schemaNames.join(' '),
    /\b(?:ApiCandidate|ApiResponseCaptureSummary|ApiCatalogEntry|ApiCatalog|ApiCatalogIndex)\b/u,
  );

  assert.equal(assertSiteCapabilityKernelRuntimeReadiness(), true);
});

test('Kernel runtime readiness guard rejects forbidden Kernel ownership at runtime boundary', () => {
  for (const responsibility of [
    {
      id: 'bilibili-page-type-interpretation',
      description: 'bilibili page type interpretation',
    },
    {
      id: 'raw-cookie-reader',
      cookie: 'synthetic-cookie-value',
    },
    {
      id: 'downloader-execution',
      description: 'downloader execution',
    },
    {
      id: 'api-catalog-semantics',
      description: 'api catalog semantics',
    },
  ]) {
    assert.throws(
      () => assertSiteCapabilityKernelRuntimeReadiness({
        responsibilities: [
          ...listKernelAllowedResponsibilities(),
          responsibility,
        ],
      }),
      /Kernel must not own/u,
    );
  }
});
