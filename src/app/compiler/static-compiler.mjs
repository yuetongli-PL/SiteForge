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
  createCapabilityCoverageSummary,
  createCapabilityIntake,
} from './capability-intake.mjs';
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

/** @param {Record<string, any>} [request] */
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

/** @param {Record<string, any>} [request] */
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

function normalizeCapabilityAlias(value) {
  const text = String(value ?? '').trim().toLowerCase();
  if (!text) {
    return null;
  }
  return text
    .replace(/[^a-z0-9._:-]+/gu, '-')
    .replace(/^-+|-+$/gu, '') || null;
}

/** @param {Record<string, any>} [capability] */
function capabilityAliases(capability = {}) {
  return [
    capability.capabilityKey,
    capability.normalizedIntent,
    capability.capabilityFamily,
    ...(Array.isArray(capability.supportedTaskTypes) ? capability.supportedTaskTypes : []),
  ].map(normalizeCapabilityAlias).filter(Boolean);
}

/** @param {Record<string, any>} options */
function unresolvedRequestedCapabilityNodes({
  siteKey,
  capabilities = [],
  capabilityIntake = null,
} = {}) {
  const requestedCapabilities = capabilityIntake?.requestedCapabilities ?? [];
  if (!requestedCapabilities.length) {
    return [];
  }
  const knownAliases = new Set(capabilities.flatMap(capabilityAliases));
  return requestedCapabilities
    .filter((capability) => !knownAliases.has(capability))
    .map((capability) => ({
      id: `unknown:${siteKey}:requested-capability:${capability}`,
      requestedCapability: capability,
      reasonCode: 'compiler.capability_inventory_invalid',
      redactionRequired: true,
    }));
}

/** @param {Record<string, any>} options */
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
  const capabilityIntake = request.capabilityIntake ?? createCapabilityIntake({
    candidateCapabilities: capabilityConfig.capabilityFamilies,
  });
  const unknownNodes = capabilities.length === 0
    ? [{
      id: `unknown:${siteKey}:capability-inventory`,
      reasonCode: 'compiler.capability_inventory_invalid',
      redactionRequired: true,
    }]
    : [];
  unknownNodes.push(...unresolvedRequestedCapabilityNodes({
    siteKey,
    capabilities,
    capabilityIntake,
  }));
  const blockedReasonCodes = unknownNodes.length ? ['compiler.coverage_incomplete'] : [];
  const capabilityCoverageSummary = createCapabilityCoverageSummary({
    capabilityIntake,
    capabilities,
  });
  const coverageReport = createCompileCoverageReport({
    coverageCompleteness: request.compileScope.coverageCompleteness,
    unknownNodes,
    blockedReasonCodes,
    evidenceRefs: sourceRefs.map((ref) => ref.ref),
    capabilityCoverageSummary,
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
    capabilityIntake,
    capabilityCoverageSummary,
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
        capabilityIntake,
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
