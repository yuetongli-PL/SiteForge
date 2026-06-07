// @ts-check

import { createHash } from 'node:crypto';
import { sanitizeCapabilityPackageManifest } from './capability-package-validator.mjs';

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}

export function stringifyCanonicalCapabilityPackage(manifest = {}) {
  const sanitized = sanitizeCapabilityPackageManifest({
    ...manifest,
    packageDigest: undefined,
    auditMetadata: {
      ...manifest.auditMetadata,
      packageDigest: undefined,
    },
  });
  return JSON.stringify(canonicalize({
    ...sanitized,
    packageDigest: undefined,
    auditMetadata: {
      ...sanitized.auditMetadata,
      packageDigest: undefined,
    },
  }));
}

export function createCapabilityPackageDigest(manifest = {}) {
  return `sha256:${createHash('sha256').update(stringifyCanonicalCapabilityPackage(manifest)).digest('hex')}`;
}
