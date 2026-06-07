// @ts-check

import { jsonClone } from '../../shared/clone.mjs';
import { createCapabilityPackageDigest } from './capability-package-digest.mjs';
import {
  assertCapabilityPackageManifestValid,
  sanitizeCapabilityPackageManifest,
} from './capability-package-validator.mjs';
import { CAPABILITY_PACKAGE_REGISTRY_ENTRY_SCHEMA_VERSION } from './capability-package-schema.mjs';

const clone = jsonClone;

export function createCapabilityPackageRegistry(options = {}) {
  const entries = new Map();
  return {
    register(manifest = {}, metadata = {}) {
      const safeManifest = assertCapabilityPackageManifestValid({
        ...sanitizeCapabilityPackageManifest(manifest),
        packageDigest: manifest.packageDigest ?? createCapabilityPackageDigest(manifest),
        auditMetadata: {
          ...manifest.auditMetadata,
          packageDigest: manifest.packageDigest ?? createCapabilityPackageDigest(manifest),
        },
      });
      const entry = {
        schemaVersion: CAPABILITY_PACKAGE_REGISTRY_ENTRY_SCHEMA_VERSION,
        packageId: safeManifest.packageId,
        version: safeManifest.version,
        packageDigest: safeManifest.packageDigest,
        graphDigest: safeManifest.graphDigest,
        manifest: clone(safeManifest),
        registeredAt: String(metadata.registeredAt ?? options.registeredAt ?? 'unknown'),
        provenance: {
          source: String(metadata.source ?? 'local'),
          material: 'descriptor_only',
        },
        redactionRequired: true,
      };
      entries.set(`${safeManifest.packageId}@${safeManifest.version}`, entry);
      return clone(entry);
    },
    get(packageId, version) {
      const entry = entries.get(`${packageId}@${version}`);
      return entry ? clone(entry) : null;
    },
    list() {
      return [...entries.values()]
        .sort((left, right) => `${left.packageId}@${left.version}`.localeCompare(`${right.packageId}@${right.version}`))
        .map(clone);
    },
    exportSafeJson(packageId, version) {
      const entry = entries.get(`${packageId}@${version}`);
      if (!entry) return null;
      return JSON.stringify(entry.manifest, null, 2);
    },
  };
}
