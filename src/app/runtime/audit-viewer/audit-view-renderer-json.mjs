// @ts-check

import {
  sanitizeRuntimeAuditView,
} from './audit-view-builder.mjs';

export function renderRuntimeAuditViewJson(view, {
  pretty = true,
} = {}) {
  const sanitized = sanitizeRuntimeAuditView(view);
  return JSON.stringify(sanitized, null, pretty ? 2 : 0);
}
