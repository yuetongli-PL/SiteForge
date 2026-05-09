// @ts-check

import {
  SITE_CAPABILITY_COMPILER_SCHEMA_VERSION,
  SITE_CAPABILITY_COMPILER_VERSION,
} from './schema.mjs';
import {
  assertNoCompilerSensitiveMaterial,
  assertSiteCompileManifestCompatible,
  assertSiteCompileRequestCompatible,
} from './validator.mjs';
import {
  createCapabilityInventory,
  createExecutionPathInventory,
  createNodeInventory,
  createRequirementInventory,
} from './inventory.mjs';
import {
  assertCompileCoverageReportConsistent,
  createCompileCoverageReport,
  createUnknownNodeReport,
} from './coverage-report.mjs';
import {
  createCompilerDigest,
  createCompilerSourceDigest,
  createIncrementalCompileSummary,
} from './digest.mjs';

function siteIdFromRequest(request = {}) {
  if (request.siteId) {
    return request.siteId;
  }
  if (request.siteKey) {
    return `site:${request.siteKey}`;
  }
  try {
    return `site:${new URL(request.url).hostname}`;
  } catch {
    return 'site:unknown';
  }
}

function siteKeyFromRequest(request = {}) {
  if (request.siteKey) {
    return request.siteKey;
  }
  if (request.siteId?.startsWith('site:')) {
    return request.siteId.slice('site:'.length);
  }
  try {
    return new URL(request.url).hostname;
  } catch {
    return 'unknown';
  }
}

function defaultSourceRefs() {
  return [
    {
      type: 'site-registry',
      ref: 'config/site-registry.json',
      redactionRequired: true,
    },
    {
      type: 'site-capabilities',
      ref: 'config/site-capabilities.json',
      redactionRequired: true,
    },
  ];
}

export function createStaticSiteCompileManifest({
  request,
  registrySite = {},
  capabilityConfig = {},
  adapterMetadata = {},
  sourceRefs = defaultSourceRefs(),
  previousSourceDigest,
} = {}) {
  assertSiteCompileRequestCompatible(request);
  assertNoCompilerSensitiveMaterial({
    registrySite,
    capabilityConfig,
    adapterMetadata,
    sourceRefs,
  });
  const siteId = siteIdFromRequest(request);
  const siteKey = registrySite.siteKey ?? capabilityConfig.siteKey ?? siteKeyFromRequest(request);
  const capabilities = Array.isArray(capabilityConfig.capabilities)
    ? capabilityConfig.capabilities
    : [];
  const unknownNodes = capabilities.length === 0
    ? [{
      id: `unknown:${siteKey}:capability-inventory`,
      reasonCode: 'compiler.capability_inventory_invalid',
      redactionRequired: true,
    }]
    : [];
  const blockedReasonCodes = unknownNodes.length ? ['compiler.coverage_incomplete'] : [];
  const coverageReport = createCompileCoverageReport({
    coverageCompleteness: request.compileScope.coverageCompleteness,
    unknownNodes,
    blockedReasonCodes,
    evidenceRefs: sourceRefs.map((ref) => ref.ref),
  });
  assertCompileCoverageReportConsistent(request.compileScope, coverageReport);
  const sourceDigest = createCompilerSourceDigest({
    sourceRefs,
    registrySite,
    capabilityConfig,
    adapterMetadata,
  });
  const normalizedSourceRefs = sourceRefs.map((sourceRef) => ({
    ...sourceRef,
    digestAlgorithm: 'sha256',
    digest: sourceRef.digest ?? sourceRef.sourceDigest ?? sourceDigest,
    sourceDigest: sourceRef.sourceDigest ?? sourceDigest,
  }));
  const incrementalCompile = createIncrementalCompileSummary({
    previousSourceDigest,
    sourceDigest,
    sourceRefs: normalizedSourceRefs,
  });

  const manifest = {
    schemaVersion: SITE_CAPABILITY_COMPILER_SCHEMA_VERSION,
    compilerVersion: SITE_CAPABILITY_COMPILER_VERSION,
    compileId: `compile:${siteKey}:static:${sourceDigest.slice('sha256:'.length, 'sha256:'.length + 12)}`,
    siteId,
    siteKey,
    adapterId: adapterMetadata.adapterId ?? registrySite.adapterId ?? `${siteKey}-adapter`,
    compileScope: request.compileScope,
    sourceRefs: normalizedSourceRefs,
    sourceDigest,
    incrementalCompile,
    inventories: {
      nodes: createNodeInventory({
        siteId,
        siteKey,
        adapterId: adapterMetadata.adapterId ?? registrySite.adapterId,
        capabilities,
        capabilityConfig,
        registrySite,
      }),
      capabilities: createCapabilityInventory({
        siteId,
        siteKey,
        capabilities,
        capabilityConfig,
        registrySite,
      }),
      executionPaths: createExecutionPathInventory({ siteId, siteKey, capabilities }),
      requirements: createRequirementInventory({
        siteId,
        siteKey,
        capabilities,
        capabilityConfig,
        registrySite,
      }),
      unknownNodes,
    },
    unknownNodeReport: createUnknownNodeReport({
      siteId,
      unknownNodes,
      blockedReasonCodes,
    }),
    coverageReport,
    redactionRequired: true,
  };
  manifest.manifestDigest = createCompilerDigest({
    ...manifest,
    manifestDigest: undefined,
  });
  assertSiteCompileManifestCompatible(manifest);
  return manifest;
}
