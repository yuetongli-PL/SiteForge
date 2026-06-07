import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const REQUIRED_DOCS = [
  'docs/runtime/provider-sdk.md',
  'docs/runtime/skill-invocation-api.md',
  'docs/runtime/capability-package.md',
  'docs/runtime/policy-pack.md',
  'docs/runtime/run-store.md',
  'docs/runtime/regression-harness.md',
  'docs/security/runtime-boundaries.md',
  'docs/security/provider-sandbox-limitations.md',
  'docs/security/payment-destructive-boundaries.md',
];

const DOC_CANARIES = [
  'sf_docs_cookie_secret_123',
  'sf_docs_payment_secret_456',
  'sf_docs_destructive_secret_789',
];

async function readDoc(path) {
  return readFile(new URL(`../../${path}`, import.meta.url), 'utf8');
}

async function readAllDocs() {
  const entries = [];
  for (const path of REQUIRED_DOCS) {
    entries.push([path, await readDoc(path)]);
  }
  return entries;
}

test('required runtime productization docs exist', async () => {
  for (const path of REQUIRED_DOCS) {
    const body = await readDoc(path);
    assert.ok(body.startsWith('# '), `${path} should start with a heading`);
  }
});

test('docs describe required runtime and security boundaries', async () => {
  const combined = (await readAllDocs()).map(([, body]) => body).join('\n').toLowerCase();

  assert.match(combined, /provider sandbox v1 is a provider service boundary, not a full os sandbox/u);
  assert.match(combined, /automatic login is not supported/u);
  assert.match(combined, /arbitrary authenticated browsing is not supported/u);
  assert.match(combined, /payment execution is not implemented/u);
  assert.match(combined, /default destructive execution is blocked/u);
  assert.match(combined, /skill task text is not authorization/u);
  assert.match(combined, /`?dryrun`? does not execute a provider/u);
  assert.match(combined, /`?execute`? still (?:goes through|uses) runtime gates|`?execute`? still uses policy/u);
  assert.match(combined, /providers cannot directly access the session vault/u);
  assert.match(combined, /providers cannot directly launch a browser/u);
  assert.match(combined, /providers cannot directly write audit, report, result, or run-store/u);
  assert.match(combined, /run store, audit query, and replay tooling do not execute provider, browser, vault, or network paths/u);
  assert.match(combined, /packages.*do not carry private session material|they do not carry private session material/u);
});

test('docs reference relevant schema and API names', async () => {
  const combined = (await readAllDocs()).map(([, body]) => body).join('\n');
  for (const schemaName of [
    'PROVIDER_MANIFEST_SCHEMA_VERSION',
    'SKILL_RUNTIME_INVOCATION_SCHEMA_VERSION',
    'CAPABILITY_PACKAGE_SCHEMA_VERSION',
    'POLICY_PACK_SCHEMA_VERSION',
    'RUNTIME_RUN_STORE_SCHEMA_VERSION',
    'RUNTIME_CI_REGRESSION_SNAPSHOT_SCHEMA_VERSION',
    'PROVIDER_SANDBOX_PROTOCOL_SCHEMA_VERSION',
    'PAYMENT_AUTHORIZATION_PLAN_SCHEMA_VERSION',
    'DESTRUCTIVE_EXECUTION_PLAN_SCHEMA_VERSION',
  ]) {
    assert.match(combined, new RegExp(schemaName, 'u'));
  }
});

test('docs do not contain canary secrets or forbidden safety claims', async () => {
  const combined = (await readAllDocs()).map(([, body]) => body).join('\n');
  for (const canary of DOC_CANARIES) {
    assert.equal(combined.includes(canary), false, `${canary} must not appear in docs`);
  }

  for (const forbidden of [
    /automatic login is supported/iu,
    /arbitrary authenticated browsing is supported/iu,
    /payment execution is supported/iu,
    /default destructive execution is supported/iu,
    /sandbox is a full os sandbox/iu,
    /skill .*can .*natural language .*authori[sz]e/iu,
    /raw credentials can be passed/iu,
    /(?:use|copy|paste|supply|provide|send|store)\s+raw\s+(?:cookie|cookies|token|tokens)/iu,
  ]) {
    assert.doesNotMatch(combined, forbidden);
  }
});
