// @ts-check

import { stableNodeId } from './models.mjs';
import { sanitizeEvidenceRef } from './risk-policy.mjs';

export function sanitizedStructureText(value, maxLength = 80, fallback = null) {
  const raw = String(value ?? '').trim();
  if (!raw) {
    return fallback;
  }
  if (/[<>{}]|=|\b(?:authorization|bearer|cookie|sid|uid|user[_-]?id|account[_-]?id|token|secret|session|password|localStorage|sessionStorage|userDataDir|raw\s+dom|raw\s+html|html|script)\b/iu.test(raw)) {
    return '[REDACTED]';
  }
  const safe = sanitizeEvidenceRef(value);
  if (!safe) {
    return fallback;
  }
  if (/\b(?:authorization|bearer|cookie|sid|uid|token|secret|session|password|localStorage|sessionStorage|userDataDir)\b/iu.test(String(safe))) {
    return '[REDACTED]';
  }
  return String(safe).slice(0, maxLength);
}

export function safeStructureHash(prefix, providedValue, fallbackValue) {
  const provided = String(providedValue ?? '').trim();
  if (/^(?:[a-z][a-z0-9_-]*:)?[a-f0-9]{12,128}$/iu.test(provided)) {
    return provided.slice(0, 160);
  }
  return stableNodeId(prefix, fallbackValue);
}
