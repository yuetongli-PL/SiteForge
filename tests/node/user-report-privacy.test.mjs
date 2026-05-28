import test from 'node:test';
import assert from 'node:assert/strict';

import { summarizePrivacy } from '../../src/app/pipeline/build/user-report-privacy.mjs';

test('user report privacy summary defaults to sanitized no-raw material state', () => {
  assert.deepEqual(summarizePrivacy({ options: {}, policy: {} }, { summary: {} }), {
    mode: 'limited',
    credential_material_persisted: false,
    runtime_sensitive_material_persisted: false,
    browser_state_material_persisted: false,
    public_page_material_persisted: false,
    public_page_material_pages: 0,
    public_page_material_redacted: false,
    private_page_material_persisted: false,
    raw_network_traces_persisted: false,
    sanitized_reports: true,
    network_capture_requested: false,
    network_summary_only: false,
    redaction_required: true,
    warning_codes: [],
  });
});

test('user report privacy summary records requested network and raw public page material', () => {
  assert.deepEqual(summarizePrivacy(
    { options: { privacy: 'strict', network: true }, policy: {} },
    {
      warningCodes: ['network-summary-only'],
      summary: {
        rawPageMaterial: { pages: 2 },
        network: { sanitizedSummary: { rawTracesPersisted: false } },
      },
    },
  ), {
    mode: 'strict',
    credential_material_persisted: false,
    runtime_sensitive_material_persisted: false,
    browser_state_material_persisted: false,
    public_page_material_persisted: true,
    public_page_material_pages: 2,
    public_page_material_redacted: true,
    private_page_material_persisted: false,
    raw_network_traces_persisted: false,
    sanitized_reports: true,
    network_capture_requested: true,
    network_summary_only: true,
    redaction_required: true,
    warning_codes: ['network-summary-only'],
  });
});
