import test from 'node:test';
import assert from 'node:assert/strict';

import {
  HTML_REPORT_FORBIDDEN_PATTERNS,
  HTML_REPORT_MAX_EXAMPLES,
  escapeHtml,
  htmlAuthBadge,
  htmlBadge,
  htmlCell,
  htmlList,
  htmlRiskBadge,
  htmlStatusBadge,
  sanitizeCapabilityIntentHtmlPayload,
  sanitizeHtmlReportString,
  sanitizeHtmlReportUrl,
  sanitizeHtmlReportValue,
} from '../../src/app/pipeline/build/capability-intent-html-values.mjs';

test('capability intent HTML values strip sensitive URLs and browser material', () => {
  assert.equal(
    sanitizeHtmlReportUrl('https://example.test/path?token=secret#hash'),
    'https://example.test/path',
  );
  assert.equal(
    sanitizeHtmlReportString('open https://example.test/path?token=secret#hash with localStorage and browser profile'),
    'open https://example.test/path with [REDACTED_BROWSER_STORAGE] and [REDACTED_BROWSER_STATE]',
  );
});

test('capability intent HTML value sanitizer drops forbidden object keys recursively', () => {
  assert.deepEqual(sanitizeHtmlReportValue({
    safe: 'https://example.test/a?token=x#h',
    token: 'secret',
    headers: { authorization: 'secret' },
    nested: {
      localStorage: 'secret',
      label: 'uses localStorage and sessionStorage',
    },
  }), {
    safe: 'https://example.test/a',
    nested: {
      label: 'uses [REDACTED_BROWSER_STORAGE] and [REDACTED_BROWSER_STORAGE]',
    },
  });
});

test('capability intent HTML payload sanitizer composes report and HTML redaction', () => {
  assert.deepEqual(sanitizeCapabilityIntentHtmlPayload({
    email: 'alice@example.test',
    url: 'https://example.test/a?session=secret#x',
    authorization: 'Bearer secret',
    label: 'raw html and browser profile',
  }), {
    email: '[REDACTED_EMAIL]',
    url: 'https://example.test/a',
    label: '[REDACTED_HTML] and [REDACTED_BROWSER_STATE]',
  });
});

test('capability intent HTML render helpers escape cells, lists, and badges', () => {
  assert.equal(escapeHtml('a <b>"&\''), 'a &lt;b&gt;&quot;&amp;&#39;');
  assert.equal(htmlCell('<id>', { code: true }), '<code>&lt;id&gt;</code>');
  assert.equal(
    htmlList(['<a>', '', null, 'b', 'c'], { code: false, limit: 2 }),
    '<span>&lt;a&gt;</span> <span>b</span> <span class="muted">+1</span>',
  );
  assert.equal(htmlBadge('<ok>', 'bad kind!'), '<span class="badge badge-muted">&lt;ok&gt;</span>');
  assert.match(htmlStatusBadge('active'), /badge-success/u);
  assert.match(htmlStatusBadge('partial_success'), /badge-warning/u);
  assert.match(htmlStatusBadge('blocked'), /badge-danger/u);
  assert.match(htmlRiskBadge('write_high'), /badge-risk/u);
  assert.match(htmlRiskBadge('read_public_low'), /badge-success/u);
  assert.match(htmlAuthBadge('required'), /badge-auth/u);
});

test('capability intent HTML safety constants cover expected scan limits', () => {
  assert.equal(HTML_REPORT_MAX_EXAMPLES, 3);
  assert.deepEqual(HTML_REPORT_FORBIDDEN_PATTERNS.map((entry) => entry.code), [
    'authorization',
    'bearer',
    'local-storage',
    'session-storage',
    'user-data-dir',
    'browser-profile',
    'secret-fixture',
    'session-id',
    'cookie-value',
    'script-tag',
  ]);
});
