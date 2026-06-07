import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  COMPILER_CONTRACT_EXTRACTION_V2_SCHEMA_VERSION,
  extractApiEndpointHintsV2,
  extractDownloadExportHintsV2,
  extractFormActionContractsV2,
  extractStaticCapabilityContractsV2,
  scoreContractConcreteness,
  scoreSelectorStability,
} from '../../src/app/compiler/index.mjs';

const FIXTURE_URL = new URL('./fixtures/site-capability-compiler-hardening-v2/static-capability-page.html', import.meta.url);
const COMPILER_CANARIES = /sf_compiler_private_form_secret_123|sf_compiler_cookie_secret_456|sf_compiler_login_secret_789/u;

async function readFixture() {
  return readFile(FIXTURE_URL, 'utf8');
}

test('static form extraction produces slot schema', async () => {
  const html = await readFixture();
  const contracts = extractFormActionContractsV2({ html, url: 'https://synthetic.example/settings' });
  const contact = contracts.find((contract) => contract.capabilityId.includes('contact-form'));

  assert.ok(contact);
  assert.equal(contact.schemaVersion, COMPILER_CONTRACT_EXTRACTION_V2_SCHEMA_VERSION);
  assert.deepEqual(contact.slotSchema.map((slot) => slot.name).sort(), ['email', 'message']);
  assert.ok(contact.slotSchema.every((slot) => slot.savedMaterial === 'schema_only'));
});

test('submit action extraction produces form_or_action capability descriptors', async () => {
  const html = await readFixture();
  const contracts = extractFormActionContractsV2({ html, url: 'https://synthetic.example/settings' });

  assert.equal(contracts.length, 3);
  assert.ok(contracts.every((contract) => contract.operationKind === 'form_or_action'));
  assert.ok(contracts.every((contract) => contract.executableByDefault === false));
  assert.ok(contracts.every((contract) => contract.autoExecutable === false));
});

test('download and export links are detected without execution', async () => {
  const html = await readFixture();
  const hints = extractDownloadExportHintsV2({ html, url: 'https://synthetic.example/settings' });

  assert.equal(hints.length, 2);
  assert.deepEqual([...new Set(hints.map((hint) => hint.operationKind))], ['download']);
  assert.ok(hints.every((hint) => hint.providerCompatibilityHints.includes('download_provider')));
  assert.ok(hints.every((hint) => hint.executableByDefault === false));
});

test('API endpoint hints are detected without executing endpoints', async () => {
  const html = await readFixture();
  const hints = extractApiEndpointHintsV2({ html, url: 'https://synthetic.example/settings' });

  assert.ok(hints.some((hint) => hint.endpoint === '/api/orders/search'));
  assert.ok(hints.some((hint) => hint.endpoint === '/api/contact'));
  assert.ok(hints.every((hint) => hint.executed === false));
  assert.ok(hints.every((hint) => hint.providerCompatibilityHints.includes('api_read_provider')));
});

test('auth-required hints are detected without collecting credentials', async () => {
  const html = await readFixture();
  const result = extractStaticCapabilityContractsV2({ html, url: 'https://synthetic.example/settings' });

  assert.equal(result.authRequirementHints.length >= 1, true);
  assert.ok(result.authRequirementHints.every((hint) => hint.grantsAuthorization === false));
  assert.doesNotMatch(JSON.stringify(result), COMPILER_CANARIES);
});

test('destructive and payment hints are detected from static text', async () => {
  const html = await readFixture();
  const result = extractStaticCapabilityContractsV2({ html, url: 'https://synthetic.example/settings' });
  const kinds = result.riskHints.map((hint) => hint.kind);
  const perContractKinds = result.formContracts.flatMap((contract) => contract.riskHints.map((hint) => hint.kind));

  assert.ok(kinds.includes('destructive'));
  assert.ok(kinds.includes('payment'));
  assert.ok(perContractKinds.includes('destructive'));
  assert.ok(perContractKinds.includes('payment'));
});

test('selector stability score is generated', () => {
  assert.equal(scoreSelectorStability('#contact-form') > 0.9, true);
  assert.equal(scoreSelectorStability('form[action="/account/delete"]') < scoreSelectorStability('#contact-form'), true);
  assert.equal(scoreSelectorStability('div:nth-child(3)') < 0.5, true);
});

test('completion signal is extracted when deterministic', async () => {
  const html = await readFixture();
  const contact = extractFormActionContractsV2({ html, url: 'https://synthetic.example/settings' })
    .find((contract) => contract.capabilityId.includes('contact-form'));

  assert.equal(contact.completionSignal.kind, 'selector_visible');
  assert.equal(contact.completionSignal.deterministic, true);
  assert.equal(contact.completionSignalConfidence, 0.9);
});

test('missing completion signal lowers concreteness', async () => {
  const html = await readFixture();
  const contracts = extractFormActionContractsV2({ html, url: 'https://synthetic.example/settings' });
  const contact = contracts.find((contract) => contract.capabilityId.includes('contact-form'));
  const deleteContract = contracts.find((contract) => contract.capabilityId.includes('account-delete'));

  assert.equal(contact.contractConcretenessScore > deleteContract.contractConcretenessScore, true);
  assert.ok(deleteContract.extractionWarnings.includes('compiler.completion_signal_missing'));
});

test('low-confidence contract is not executable by default', async () => {
  const html = await readFixture();
  const deleteContract = extractFormActionContractsV2({ html, url: 'https://synthetic.example/settings' })
    .find((contract) => contract.capabilityId.includes('account-delete'));

  assert.equal(deleteContract.concreteEnough, false);
  assert.equal(deleteContract.executableByDefault, false);
  assert.equal(deleteContract.autoExecutable, false);
});

test('contract concreteness scorer keeps runtime gate authority separate', () => {
  const score = scoreContractConcreteness({
    operationKind: 'form_or_action',
    selectorStabilityScore: 0.3,
    slotSchema: [{ name: 'email' }],
    completionSignal: null,
    riskHints: [],
  });

  assert.equal(score.concreteEnough, false);
  assert.equal(score.score < 0.75, true);
});

test('compiler extraction does not import provider implementation or runtime services', async () => {
  const source = await readFile(new URL('../../src/app/compiler/contract-extraction-v2.mjs', import.meta.url), 'utf8');

  assert.doesNotMatch(source, /providers\/|provider-registry|provider-sdk|browser-runtime|session-vault/u);
  assert.doesNotMatch(source, /executeRuntimeInvocation|provider\.run|fetch\(|openBrowserSession/u);
});

test('compiler extraction does not execute browser provider or network hooks', async () => {
  const html = await readFixture();
  const originalFetch = globalThis.fetch;
  let fetchCalled = false;
  globalThis.fetch = () => {
    fetchCalled = true;
    throw new Error('fetch should not be called by compiler extraction');
  };
  try {
    const result = extractStaticCapabilityContractsV2({ html, url: 'https://synthetic.example/settings' });
    assert.equal(result.summary.executedProvider, false);
    assert.equal(result.summary.executedBrowser, false);
    assert.equal(result.summary.executedNetwork, false);
    assert.equal(fetchCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('compiler extraction output does not retain raw private fixture values', async () => {
  const html = await readFixture();
  const result = extractStaticCapabilityContractsV2({ html, url: 'https://synthetic.example/settings' });
  const serialized = JSON.stringify(result);

  assert.doesNotMatch(serialized, COMPILER_CANARIES);
  assert.doesNotMatch(serialized, /value=|raw|cookie_secret|private_form_secret|login_secret/u);
});
