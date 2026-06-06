// @ts-check

import { createHash } from 'node:crypto';

import {
  assertNoExecutionSensitiveMaterial,
} from '../../../domain/policies/execution/index.mjs';

export const SANITIZED_SUMMARY_ONLY = 'sanitized_summary_only';

function normalizeText(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

export function safeRuntimeRef(value, fallback = null) {
  const text = normalizeText(value);
  if (!text) return fallback;
  return text
    .replace(/[^a-z0-9._:/-]+/giu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 180) || fallback;
}

export function stableRuntimeHash(value, prefix = 'hash') {
  const digest = createHash('sha256')
    .update(String(value ?? ''), 'utf8')
    .digest('hex')
    .slice(0, 24);
  return `${prefix}:${digest}`;
}

export function safeOriginHash(value) {
  let origin = '';
  try {
    origin = new URL(String(value ?? '')).origin;
  } catch {
    origin = String(value ?? '');
  }
  return stableRuntimeHash(origin, 'origin-hash');
}

export function safePathHash(value) {
  let path = '';
  try {
    const parsed = new URL(String(value ?? ''));
    path = parsed.pathname;
  } catch {
    path = String(value ?? '').split(/[?#]/u)[0] ?? '';
  }
  return stableRuntimeHash(path, 'path-hash');
}

export function sanitizeBrowserRuntimeError(reasonCode, message = 'Controlled browser runtime failed') {
  const sanitized = {
    name: 'ControlledBrowserRuntimeError',
    code: safeRuntimeRef(reasonCode, 'runtime.browser_runtime_unavailable')?.replace(/:/gu, '.'),
    message,
    redactionRequired: true,
  };
  assertNoExecutionSensitiveMaterial(sanitized);
  return sanitized;
}

export function assertSafeBrowserRuntimeSummary(value) {
  assertNoExecutionSensitiveMaterial(value);
  return value;
}
