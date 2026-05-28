import test from 'node:test';
import assert from 'node:assert/strict';
import {
  relativeReportPath,
  sanitizeReportPublicValue,
  sanitizeReportString,
} from '../../src/app/pipeline/build/user-report-values.mjs';

test('user report value sanitizer redacts sensitive public report strings recursively', () => {
  assert.deepEqual(sanitizeReportPublicValue({
    contact: 'email alice@example.com phone 415-555-0123',
    auth: 'Bearer abc.def token=secret cookie=session authorization: Basic secret',
    handle: 'owned by @private_user',
    nested: ['<html>secret'],
  }), {
    contact: 'email [REDACTED_EMAIL] phone [REDACTED_PHONE]',
    auth: '[REDACTED_AUTH] [REDACTED_SECRET] cookie=[REDACTED] authorization=[REDACTED]',
    handle: 'owned by [REDACTED_HANDLE]',
    nested: ['[REDACTED_HTML]secret'],
  });
});

test('user report path helper keeps workspace paths relative and external paths normalized', () => {
  const cwd = 'C:\\Users\\lyt-p\\Desktop\\SiteForge';
  assert.equal(
    relativeReportPath(cwd, 'C:\\Users\\lyt-p\\Desktop\\SiteForge\\siteforge-sites\\example.com\\build_report.json'),
    'siteforge-sites/example.com/build_report.json',
  );
  assert.equal(relativeReportPath(cwd, ''), null);
  assert.equal(
    relativeReportPath(cwd, 'D:\\reports\\build_report.json'),
    'D:/reports/build_report.json',
  );
});

test('user report string sanitizer preserves already redacted secret assignments', () => {
  assert.equal(
    sanitizeReportString('token=[REDACTED] auth=%5BREDACTED%5D'),
    'token=[REDACTED] auth=%5BREDACTED%5D',
  );
});
