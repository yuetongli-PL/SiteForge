// @ts-check

import { createHash } from 'node:crypto';

import {
  assertNoCompilerSensitiveMaterial,
} from './validator.mjs';

function stableJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableJson(entry)).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${stableJson(value[key])}`
    )).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function createCompilerDigest(value, {
  algorithm = 'sha256',
  prefix = 'sha256',
} = {}) {
  assertNoCompilerSensitiveMaterial(value);
  const digest = createHash(algorithm).update(stableJson(value)).digest('hex');
  return `${prefix}:${digest}`;
}

export function createCompilerSourceDigest({
  sourceRefs = [],
  registrySite = {},
  capabilityConfig = {},
  adapterMetadata = {},
} = {}) {
  return createCompilerDigest({
    sourceRefs,
    registrySite,
    capabilityConfig,
    adapterMetadata,
  });
}

export function createIncrementalCompileSummary({
  previousSourceDigest,
  sourceDigest,
  sourceRefs = [],
} = {}) {
  const changed = Boolean(previousSourceDigest && previousSourceDigest !== sourceDigest);
  return {
    sourceDigest,
    previousSourceDigest,
    changed,
    changedSourceRefs: changed ? sourceRefs.map((ref) => ref.ref) : [],
    unchanged: Boolean(previousSourceDigest && previousSourceDigest === sourceDigest),
    redactionRequired: true,
  };
}
