// @ts-check

import {
  DOWNLOAD_RUN_MANIFEST_SCHEMA_VERSION,
  normalizeDownloadRunManifest,
} from '../sites/downloads/contracts.mjs';
import {
  SESSION_RUN_MANIFEST_SCHEMA_VERSION,
  assertManifestIsSanitized,
  normalizeSessionRunManifest,
} from '../sites/sessions/contracts.mjs';
import {
  SCHEMA_GOVERNANCE_SCHEMA_VERSION,
  assertDesignSchemaFamilyGoverned,
  assertGovernedSchemaCompatible,
  assertRuntimeVersionFamilyCompatible,
  assertRuntimeVersionFamilyReady,
  getGovernedSchema,
  listDesignSchemaFamilies,
  listGovernedSchemas,
  listRuntimeVersionFamilies,
} from '../sites/capability/schema-governance.mjs';
import {
  getCompatibilitySchema,
  listCompatibilitySchemas,
} from '../sites/capability/compatibility-registry.mjs';
import {
  getSchemaInventoryEntry,
  listKernelSchemaGovernanceInventory,
  listSchemaInventory,
} from '../sites/capability/schema-inventory.mjs';

export {
  SCHEMA_GOVERNANCE_SCHEMA_VERSION,
  assertDesignSchemaFamilyGoverned,
  assertRuntimeVersionFamilyCompatible,
  assertRuntimeVersionFamilyReady,
  getCompatibilitySchema,
  getGovernedSchema,
  getSchemaInventoryEntry,
  listCompatibilitySchemas,
  listDesignSchemaFamilies,
  listGovernedSchemas,
  listKernelSchemaGovernanceInventory,
  listRuntimeVersionFamilies,
  listSchemaInventory,
};

export const KERNEL_SCHEMA_GOVERNANCE_ENTRYPOINT = Object.freeze({
  section: 11,
  owner: 'Kernel',
  sourcePath: 'src/kernel/site-capability-schema-governance.mjs',
  delegatedModules: Object.freeze([
    'src/sites/capability/schema-inventory.mjs',
    'src/sites/capability/compatibility-registry.mjs',
    'src/sites/capability/schema-governance.mjs',
  ]),
});

const KERNEL_MANIFEST_COMPATIBILITY = Object.freeze({
  DownloadRunManifest: Object.freeze({
    name: 'DownloadRunManifest',
    version: DOWNLOAD_RUN_MANIFEST_SCHEMA_VERSION,
    sourcePath: 'src/sites/downloads/contracts.mjs',
    normalize: normalizeDownloadRunManifest,
  }),
  SessionRunManifest: Object.freeze({
    name: 'SessionRunManifest',
    version: SESSION_RUN_MANIFEST_SCHEMA_VERSION,
    sourcePath: 'src/sites/sessions/contracts.mjs',
    normalize: normalizeSessionRunManifest,
  }),
});

function schemaVersion(value, schemaName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${schemaName}.schemaVersion is required`);
  }
  if (!Object.hasOwn(value, 'schemaVersion')) {
    throw new Error(`${schemaName}.schemaVersion is required`);
  }
  return Number(value.schemaVersion);
}

function assertExactSchemaVersion(schemaName, payload, expectedVersion) {
  const receivedVersion = schemaVersion(payload, schemaName);
  if (receivedVersion !== expectedVersion) {
    throw new Error(`${schemaName} schemaVersion is not compatible: expected ${expectedVersion}, received ${receivedVersion}`);
  }
}

function getKernelManifestCompatibilitySchema(name) {
  const normalizedName = String(name ?? '').trim();
  const entry = KERNEL_MANIFEST_COMPATIBILITY[normalizedName];
  if (!entry) {
    return null;
  }
  return {
    name: entry.name,
    version: entry.version,
    sourcePath: entry.sourcePath,
  };
}

function assertManifestSchemaCompatible(name, payload = {}) {
  const entry = KERNEL_MANIFEST_COMPATIBILITY[name];
  if (!entry) {
    return false;
  }
  assertExactSchemaVersion(entry.name, payload, entry.version);
  const normalized = entry.normalize(payload);
  if (normalized.schemaVersion !== entry.version) {
    throw new Error(`${entry.name} normalizer emitted incompatible schemaVersion: ${normalized.schemaVersion}`);
  }
  if (entry.name === 'SessionRunManifest') {
    assertManifestIsSanitized(normalized);
  }
  return true;
}

export function listKernelGovernedSchemas() {
  return listGovernedSchemas().map((entry) => {
    const manifestCompatibility = getKernelManifestCompatibilitySchema(entry.name);
    return {
      ...entry,
      kernelGovernance: {
        section: KERNEL_SCHEMA_GOVERNANCE_ENTRYPOINT.section,
        owner: KERNEL_SCHEMA_GOVERNANCE_ENTRYPOINT.owner,
        entrypoint: KERNEL_SCHEMA_GOVERNANCE_ENTRYPOINT.sourcePath,
      },
      compatibility: manifestCompatibility ?? entry.compatibility,
    };
  });
}

export function getKernelGovernedSchema(name) {
  const normalizedName = String(name ?? '').trim();
  return listKernelGovernedSchemas().find((entry) => entry.name === normalizedName) ?? null;
}

export function listKernelSchemaFamilies() {
  return listDesignSchemaFamilies();
}

export function assertKernelDesignSchemaFamilyGoverned(familyName) {
  const normalizedFamilyName = String(familyName ?? '').trim();
  const families = listKernelSchemaFamilies();
  const schemaNames = families[normalizedFamilyName];
  if (!schemaNames) {
    throw new Error(`Unknown Kernel schema family: ${normalizedFamilyName || '<empty>'}`);
  }
  assertDesignSchemaFamilyGoverned(normalizedFamilyName);
  for (const schemaName of schemaNames) {
    const schema = getKernelGovernedSchema(schemaName);
    if (!schema || schema.status === 'missing') {
      throw new Error(`Kernel schema family is not fully governed: ${normalizedFamilyName}.${schemaName}`);
    }
    if (!schema.compatibility) {
      throw new Error(`Kernel schema does not have a compatibility guard: ${normalizedFamilyName}.${schemaName}`);
    }
  }
  return true;
}

export function assertKernelGovernedSchemaCompatible(name, payload = {}) {
  const normalizedName = String(name ?? '').trim();
  if (assertManifestSchemaCompatible(normalizedName, payload)) {
    return true;
  }
  const schema = getKernelGovernedSchema(normalizedName);
  if (!schema) {
    throw new Error(`Unknown Kernel governed schema: ${normalizedName || '<empty>'}`);
  }
  if (schema.status === 'missing') {
    throw new Error(`Kernel governed schema is missing: ${schema.name}`);
  }
  if (!schema.compatibility) {
    throw new Error(`Kernel governed schema does not have a compatibility guard: ${schema.name}`);
  }
  assertGovernedSchemaCompatible(schema.name, payload);
  return true;
}
