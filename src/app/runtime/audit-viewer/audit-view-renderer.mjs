// @ts-check

import {
  renderRuntimeAuditViewJson,
} from './audit-view-renderer-json.mjs';
import {
  renderRuntimeAuditViewText,
} from './audit-view-renderer-text.mjs';

export function renderRuntimeAuditView(view, {
  format = 'text',
  pretty = true,
} = {}) {
  if (format === 'json') {
    return renderRuntimeAuditViewJson(view, { pretty });
  }
  return renderRuntimeAuditViewText(view);
}
