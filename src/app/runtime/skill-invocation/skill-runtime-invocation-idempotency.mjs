// @ts-check

import {
  SKILL_RUNTIME_INVOCATION_IDEMPOTENCY_SCHEMA_VERSION,
} from './skill-runtime-invocation-schema.mjs';
import {
  assertNoSkillInvocationRawMaterial,
  safeSkillInvocationRef,
} from './skill-runtime-invocation-sanitizer.mjs';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function createSkillInvocationIdempotencyLedger({ ledgerId = 'skill-invocation-idempotency:memory' } = {}) {
  const entries = new Map();
  return {
    schemaVersion: SKILL_RUNTIME_INVOCATION_IDEMPOTENCY_SCHEMA_VERSION,
    ledgerId: safeSkillInvocationRef(ledgerId, 'skill-invocation-idempotency:memory'),
    material: 'metadata_only',
    has(idempotencyKey) {
      return entries.has(safeSkillInvocationRef(idempotencyKey, ''));
    },
    get(idempotencyKey) {
      const key = safeSkillInvocationRef(idempotencyKey, '');
      return entries.has(key) ? clone(entries.get(key)) : null;
    },
    record(request, result) {
      assertNoSkillInvocationRawMaterial({ request, result });
      const key = safeSkillInvocationRef(request.idempotencyKey, '');
      if (entries.has(key)) {
        const existing = clone(entries.get(key));
        return {
          duplicate: true,
          result: {
            ...existing,
            status: 'duplicate',
            idempotencyStatus: 'duplicate',
            providerInvoked: false,
            browserInvoked: false,
            vaultAccessed: false,
            networkInvoked: false,
          },
        };
      }
      const stored = clone({
        ...result,
        idempotencyStatus: 'recorded',
      });
      assertNoSkillInvocationRawMaterial(stored);
      entries.set(key, stored);
      return {
        duplicate: false,
        result: clone(stored),
      };
    },
    size() {
      return entries.size;
    },
  };
}
