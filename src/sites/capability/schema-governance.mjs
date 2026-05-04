// @ts-check

import {
  assertSchemaCompatible,
  getCompatibilitySchema,
} from './compatibility-registry.mjs';
import {
  getSchemaInventoryEntry,
  listSchemaInventory,
} from './schema-inventory.mjs';
import {
  assertCapabilityServiceInventoryArchitecture,
  assertCapabilityServiceInventoryRuntimeCompatible,
  listCapabilityServiceInventory,
} from './service-inventory.mjs';

export const SCHEMA_GOVERNANCE_SCHEMA_VERSION = 1;

export const DESIGN_SCHEMA_FAMILIES = Object.freeze({
  Manifest: Object.freeze(['DownloadRunManifest', 'SessionRunManifest']),
  reasonCode: Object.freeze(['reasonCode']),
  StandardTaskList: Object.freeze(['StandardTaskList']),
  DownloadPolicy: Object.freeze(['DownloadPolicy']),
  Artifact: Object.freeze(['ArtifactReferenceSet']),
  LifecycleEvent: Object.freeze(['LifecycleEvent']),
  ApiCandidate: Object.freeze(['ApiCandidate']),
  ApiCatalog: Object.freeze(['ApiCatalogEntry', 'ApiCatalog', 'ApiCatalogIndex']),
  SessionView: Object.freeze(['SessionView']),
  RiskState: Object.freeze(['RiskState']),
  CapabilityHook: Object.freeze([
    'CapabilityHook',
    'CapabilityHookEventTypeRegistry',
    'CapabilityHookRegistrySnapshot',
  ]),
});

export const RUNTIME_VERSION_FAMILIES = Object.freeze({
  RuntimeReadiness: Object.freeze({
    key: 'RuntimeReadiness',
    section: 12,
    owner: 'Kernel',
    producerRole: 'Kernel/SiteAdapter/CapabilityService',
    consumerRole: 'downloader/runtime handoff',
    schemaNames: Object.freeze([
      'LifecycleEvent',
      'SiteAdapterCandidateDecision',
      'SiteAdapterCatalogUpgradePolicy',
      'StandardTaskList',
      'DownloadPolicy',
      'SessionView',
      'RiskState',
    ]),
  }),
  ApiCatalog: Object.freeze({
    key: 'ApiCatalog',
    section: 12,
    owner: 'CapabilityService',
    producerRole: 'SiteAdapter',
    consumerRole: 'Kernel/API catalog store',
    schemaNames: Object.freeze([
      'ApiCandidate',
      'ApiResponseCaptureSummary',
      'SiteAdapterCandidateDecision',
      'SiteAdapterCatalogUpgradePolicy',
      'ApiCatalogEntry',
      'ApiCatalog',
      'ApiCatalogIndex',
    ]),
  }),
});

function governedSchemaForInventoryEntry(entry = {}) {
  const compatibility = getCompatibilitySchema(entry.name);
  return {
    ...entry,
    governanceVersion: SCHEMA_GOVERNANCE_SCHEMA_VERSION,
    compatibility: compatibility
      ? {
        version: compatibility.version,
        sourcePath: compatibility.sourcePath,
      }
      : null,
  };
}

function runtimeVersionFamilyDefinition(familyName) {
  const normalizedFamilyName = String(familyName ?? '').trim();
  const family = RUNTIME_VERSION_FAMILIES[normalizedFamilyName];
  if (!family) {
    throw new Error(`Unknown runtime version family: ${normalizedFamilyName || '<empty>'}`);
  }
  return family;
}

function publicRuntimeVersionFamily(family) {
  return {
    key: family.key,
    section: family.section,
    owner: family.owner,
    producerRole: family.producerRole,
    consumerRole: family.consumerRole,
    schemaNames: [...family.schemaNames],
  };
}

export function listGovernedSchemas() {
  return listSchemaInventory().map(governedSchemaForInventoryEntry);
}

export function getGovernedSchema(name) {
  const inventoryEntry = getSchemaInventoryEntry(name);
  return inventoryEntry ? governedSchemaForInventoryEntry(inventoryEntry) : null;
}

export function listDesignSchemaFamilies() {
  return Object.fromEntries(
    Object.entries(DESIGN_SCHEMA_FAMILIES).map(([family, schemaNames]) => [family, [...schemaNames]]),
  );
}

export function listRuntimeVersionFamilies() {
  return Object.fromEntries(
    Object.entries(RUNTIME_VERSION_FAMILIES).map(([familyName, family]) => [
      familyName,
      publicRuntimeVersionFamily(family),
    ]),
  );
}

export function listCapabilityServiceRuntimeRegistry() {
  return listCapabilityServiceInventory().map((entry) => ({
    stableName: entry.stableName,
    serviceKind: entry.serviceKind,
    modulePath: entry.modulePath,
    schemaNames: entry.schemaEvidence.map((evidence) => evidence.schemaName),
    safeBoundaryRole: entry.safeBoundaryRole.role,
  }));
}

export function assertDesignSchemaFamilyGoverned(familyName) {
  const normalizedFamilyName = String(familyName ?? '').trim();
  const schemaNames = DESIGN_SCHEMA_FAMILIES[normalizedFamilyName];
  if (!schemaNames) {
    throw new Error(`Unknown design schema family: ${normalizedFamilyName || '<empty>'}`);
  }
  const governedSchemas = schemaNames.map((schemaName) => getGovernedSchema(schemaName));
  if (governedSchemas.some((schema) => !schema || schema.status === 'missing')) {
    throw new Error(`Design schema family is not fully governed: ${normalizedFamilyName}`);
  }
  return true;
}

export function assertRuntimeVersionFamilyReady(familyName) {
  const family = runtimeVersionFamilyDefinition(familyName);
  if (family.key === 'RuntimeReadiness') {
    assertCapabilityServiceInventoryArchitecture();
  }
  for (const schemaName of family.schemaNames) {
    const schema = getGovernedSchema(schemaName);
    if (!schema || schema.status === 'missing') {
      throw new Error(`Runtime version family schema is not fully governed: ${family.key}.${schemaName}`);
    }
    if (!schema.compatibility) {
      throw new Error(`Runtime version family schema does not have a compatibility guard: ${family.key}.${schemaName}`);
    }
    if (schema.compatibility.version !== schema.version || schema.compatibility.sourcePath !== schema.sourcePath) {
      throw new Error(`Runtime version family compatibility metadata is stale: ${family.key}.${schemaName}`);
    }
  }
  return true;
}

export async function assertCapabilityServicesRuntimeReady(options = {}) {
  await assertCapabilityServiceInventoryRuntimeCompatible(options);
  return true;
}

export function assertRuntimeVersionFamilyCompatible(familyName, payloadsBySchema = {}) {
  const family = runtimeVersionFamilyDefinition(familyName);
  const payloads = payloadsBySchema && typeof payloadsBySchema === 'object' && !Array.isArray(payloadsBySchema)
    ? payloadsBySchema
    : {};
  assertRuntimeVersionFamilyReady(family.key);
  for (const schemaName of family.schemaNames) {
    if (!Object.hasOwn(payloads, schemaName)) {
      throw new Error(`Runtime version family payload is required: ${family.key}.${schemaName}`);
    }
    assertGovernedSchemaCompatible(schemaName, payloads[schemaName]);
  }
  return true;
}

export function assertGovernedSchemaCompatible(name, payload = {}) {
  const schema = getGovernedSchema(name);
  if (!schema) {
    throw new Error(`Unknown governed schema: ${String(name ?? '').trim() || '<empty>'}`);
  }
  if (schema.status === 'missing') {
    throw new Error(`Governed schema is missing: ${schema.name}`);
  }
  if (!schema.compatibility) {
    throw new Error(`Governed schema does not have a compatibility guard: ${schema.name}`);
  }
  assertSchemaCompatible(schema.name, payload);
  return true;
}
