// @ts-check

import { createHash } from 'node:crypto';

function normalizeIdPart(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .replace(/[^a-z0-9:_.-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .replace(/-{2,}/gu, '-');
}

export function createStableCapabilityId(input = {}, options = {}) {
  const existing = normalizeIdPart(input.capabilityId ?? input.id);
  if (existing.startsWith('capability:')) return existing;

  const siteKey = normalizeIdPart(input.siteKey ?? input.siteId ?? options.siteKey);
  const capabilityKey = normalizeIdPart(
    input.capabilityKey
    ?? input.key
    ?? input.name
    ?? input.operationKind
    ?? input.capabilityFamily,
  );
  if (siteKey && capabilityKey) return `capability:${siteKey}:${capabilityKey}`;

  const digest = createHash('sha256')
    .update(JSON.stringify({
      siteKey,
      capabilityKey,
      capabilityFamily: input.capabilityFamily ?? '',
      operationKind: input.operationKind ?? '',
    }))
    .digest('hex')
    .slice(0, 16);
  return `capability:${siteKey || 'unknown'}:${capabilityKey || digest}`;
}
