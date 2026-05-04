// @ts-check

import {
  KERNEL_ALLOWED_RESPONSIBILITY_IDS,
  KERNEL_CONTRACT_SCHEMA_VERSION,
  assertKernelContract,
  listKernelAllowedResponsibilities,
} from './site-capability-kernel-contract.mjs';
import {
  KERNEL_SCHEMA_GOVERNANCE_ENTRYPOINT,
  assertRuntimeVersionFamilyReady,
  listRuntimeVersionFamilies,
} from './site-capability-schema-governance.mjs';

export const KERNEL_RUNTIME_READINESS_SCHEMA_VERSION = 1;

export const KERNEL_RUNTIME_READINESS_ENTRYPOINT = Object.freeze({
  section: 1,
  owner: 'Kernel',
  sourcePath: 'src/kernel/site-capability-runtime-readiness.mjs',
  guard: 'assertSiteCapabilityKernelRuntimeReadiness',
});

const KERNEL_FORBIDDEN_RUNTIME_OWNERSHIP = Object.freeze([
  Object.freeze({
    category: 'concrete site semantics',
    owner: 'SiteAdapter',
  }),
  Object.freeze({
    category: 'raw credential or session material handling',
    owner: 'SecurityGuard/SessionProvider',
  }),
  Object.freeze({
    category: 'downloader execution',
    owner: 'downloader',
  }),
  Object.freeze({
    category: 'API discovery or catalog semantics',
    owner: 'CapabilityService/SiteAdapter',
  }),
]);

const API_CATALOG_OWNERSHIP_SCHEMA_NAMES = Object.freeze(new Set([
  'ApiCandidate',
  'ApiResponseCaptureSummary',
  'ApiCatalogEntry',
  'ApiCatalog',
  'ApiCatalogIndex',
]));

function cloneRuntimeReadinessFamily(family) {
  return {
    key: family.key,
    section: family.section,
    owner: family.owner,
    producerRole: family.producerRole,
    consumerRole: family.consumerRole,
    schemaNames: [...family.schemaNames],
  };
}

function assertKernelRuntimeReadinessFamily(family) {
  if (!family || typeof family !== 'object' || Array.isArray(family)) {
    throw new Error('Kernel runtime readiness family is required');
  }
  if (family.key !== 'RuntimeReadiness') {
    throw new Error(`Kernel runtime readiness must use RuntimeReadiness family: ${family.key ?? '<empty>'}`);
  }
  if (family.owner !== 'Kernel') {
    throw new Error(`Kernel runtime readiness family owner must be Kernel: ${family.owner ?? '<empty>'}`);
  }
  for (const schemaName of family.schemaNames ?? []) {
    if (API_CATALOG_OWNERSHIP_SCHEMA_NAMES.has(schemaName)) {
      throw new Error(`Kernel runtime readiness must not own API catalog schema governance: ${schemaName}`);
    }
  }
}

export function getSiteCapabilityKernelRuntimeReadinessEvidence() {
  const runtimeReadinessFamily = listRuntimeVersionFamilies().RuntimeReadiness;
  assertKernelRuntimeReadinessFamily(runtimeReadinessFamily);
  return {
    schemaVersion: KERNEL_RUNTIME_READINESS_SCHEMA_VERSION,
    ...KERNEL_RUNTIME_READINESS_ENTRYPOINT,
    contract: {
      schemaVersion: KERNEL_CONTRACT_SCHEMA_VERSION,
      sourcePath: 'src/kernel/site-capability-kernel-contract.mjs',
      responsibilityIds: [...KERNEL_ALLOWED_RESPONSIBILITY_IDS],
      responsibilities: listKernelAllowedResponsibilities(),
    },
    schemaGovernance: {
      entrypoint: { ...KERNEL_SCHEMA_GOVERNANCE_ENTRYPOINT },
      runtimeVersionFamily: cloneRuntimeReadinessFamily(runtimeReadinessFamily),
    },
    forbiddenOwnership: KERNEL_FORBIDDEN_RUNTIME_OWNERSHIP.map((entry) => ({ ...entry })),
  };
}

export function assertSiteCapabilityKernelRuntimeReadiness(options = {}) {
  const responsibilities = options.responsibilities ?? listKernelAllowedResponsibilities();
  assertKernelContract(responsibilities);

  const runtimeReadinessFamily = listRuntimeVersionFamilies().RuntimeReadiness;
  assertKernelRuntimeReadinessFamily(runtimeReadinessFamily);
  assertRuntimeVersionFamilyReady(runtimeReadinessFamily.key);
  return true;
}
