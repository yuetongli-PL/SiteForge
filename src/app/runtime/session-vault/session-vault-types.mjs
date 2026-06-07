// @ts-check

export const SESSION_VAULT_SCHEMA_VERSION = 'session-vault/v2';

export const SESSION_LIFECYCLE_STATUSES = Object.freeze([
  'active',
  'expired',
  'revoked',
  'rotated',
  'disabled',
  'stale',
  'unknown',
]);

export const SESSION_GRANT_LIFECYCLE_STATUSES = Object.freeze([
  'requested',
  'issued',
  'used',
  'released',
  'release_failed',
  'denied',
  'expired',
]);

export const SESSION_VAULT_LEDGER_EVENTS = Object.freeze([
  'session.inspect.requested',
  'session.inspect.completed',
  'session.inspect.denied',
  'session.grant.requested',
  'session.grant.issued',
  'session.grant.denied',
  'session.grant.released',
  'session.grant.release_failed',
  'session.scope.denied',
  'session.material.unavailable',
  'session.revoked.observed',
  'session.expired.observed',
]);

export const SESSION_VAULT_LEDGER_EVENT_SET = Object.freeze(new Set(SESSION_VAULT_LEDGER_EVENTS));
