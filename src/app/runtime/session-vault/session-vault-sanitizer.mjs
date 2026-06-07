// @ts-check

import { createHash } from 'node:crypto';

import {
  assertNoExecutionSensitiveMaterial,
} from '../../../domain/policies/execution/index.mjs';
import {
  normalizeAuthScope,
} from '../auth-runtime.mjs';

const SECRET_TEXT_PATTERN =
  /(?:sf_(?:vault|global|test|browser|replay)_[a-z0-9_]*secret[a-z0-9_]*|Bearer\s+|Authorization|Set-Cookie|Cookie\s*[:=]|token|credential|password|api[_-]?key|grant_secret|session_handle_secret)/iu;

function normalizeText(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

export function stableSessionVaultHash(value, prefix = 'session-vault-hash') {
  const digest = createHash('sha256')
    .update(String(value ?? ''), 'utf8')
    .digest('hex')
    .slice(0, 24);
  return `${prefix}:sha256:${digest}`;
}

export function safeSessionVaultRef(value, fallback = null) {
  const text = normalizeText(value);
  if (!text) return fallback;
  if (SECRET_TEXT_PATTERN.test(text) || /[\s"'`<>?&=%#]/u.test(text)) {
    return stableSessionVaultHash(text, 'vault-safe-ref');
  }
  return text
    .replace(/[^a-z0-9._:/-]+/giu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 180) || fallback;
}

export function safeSessionVaultText(value, fallback = '') {
  const text = normalizeText(value, fallback);
  if (!text) return fallback;
  if (SECRET_TEXT_PATTERN.test(text)) {
    return fallback || 'sanitized';
  }
  return text.replace(/[\r\n\t]+/gu, ' ').slice(0, 180);
}

export function sanitizeSessionVaultScopes(scopes = []) {
  return (Array.isArray(scopes) ? scopes : [])
    .map(normalizeAuthScope)
    .filter(Boolean);
}

export function sanitizeMaterialSummary(summary = {}, fallbackMaterials = []) {
  const allowedTypes = new Set(['bearer_token', 'cookie', 'api_key', 'custom_header']);
  const types = Array.isArray(summary?.types)
    ? summary.types
    : Array.isArray(summary?.materialTypes)
      ? summary.materialTypes
      : Array.isArray(fallbackMaterials)
        ? fallbackMaterials.map((entry) => entry?.type ?? entry?.materialType)
        : [];
  const uniqueTypes = [...new Set(types
    .map((type) => normalizeText(type).toLowerCase())
    .filter((type) => allowedTypes.has(type)))]
    .sort();
  const count = Number.isFinite(Number(summary?.count ?? summary?.materialCount))
    ? Math.max(0, Number(summary.count ?? summary.materialCount))
    : Array.isArray(fallbackMaterials)
      ? fallbackMaterials.length
      : uniqueTypes.length;
  return {
    types: uniqueTypes,
    count,
  };
}

export function assertSessionVaultSafeOutput(value) {
  assertNoExecutionSensitiveMaterial(value);
  return value;
}
