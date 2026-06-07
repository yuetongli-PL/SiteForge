// @ts-check

import { createHash } from 'node:crypto';
import { sanitizeRunStoreManifest } from './run-store-sanitizer.mjs';

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

export function createRunStoreIntegrityDigest(manifest = {}) {
  const sanitized = sanitizeRunStoreManifest({
    ...manifest,
    integrityDigest: '',
  });
  return `sha256:${createHash('sha256').update(JSON.stringify(canonicalize(sanitized))).digest('hex')}`;
}

export function createContentDigest(content = '') {
  return `sha256:${createHash('sha256').update(String(content)).digest('hex')}`;
}
