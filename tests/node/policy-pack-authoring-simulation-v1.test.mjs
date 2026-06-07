// @ts-nocheck
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  assertPolicyPackValid,
  createPolicyRegressionSnapshot,
  diffPolicyPacks,
  explainPolicyDecision,
  simulatePolicyPack,
  validatePolicyPack,
} from '../../src/domain/policies/policy-pack/index.mjs';

const FIXTURE_URL = new URL('./fixtures/policy-pack-authoring-simulation-v1/safe-policy-pack.json', import.meta.url);
const POLICY_CANARIES = /sf_policy_cookie_secret_123|sf_policy_token_secret_456|sf_policy_raw_body_secret_789/u;

async function readPolicyPack() {
  return JSON.parse(await readFile(FIXTURE_URL, 'utf8'));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

test('valid policy pack is accepted', async () => {
  const policyPack = await readPolicyPack();
  const report = validatePolicyPack(policyPack);

  assert.equal(report.ok, true);
  assert.equal(report.sanitized.policyPackId, 'policy-pack:siteforge-safe-defaults');
  assert.equal(report.sanitized.rules.length, 4);
});

test('invalid policy pack is rejected with sanitized error', async () => {
  const policyPack = await readPolicyPack();
  const invalid = {
    ...policyPack,
    cookie: 'sf_policy_cookie_secret_123'
  };
  const report = validatePolicyPack(invalid);

  assert.equal(report.ok, false);
  assert.deepEqual(report.errors, ['policy_pack.raw_material_rejected']);
  assert.doesNotMatch(JSON.stringify(report), POLICY_CANARIES);
});

test('policy simulation allows auth read', async () => {
  const policyPack = await readPolicyPack();
  const simulation = simulatePolicyPack(policyPack, {
    packageId: 'sitepkg:example.com',
    capabilityRef: 'sitepkg:example.com/orders-read@1.0.0',
    providerId: 'api_read_provider',
    capabilityKind: 'read',
    operation: 'read',
    authRequirement: { required: true, scopes: ['orders.read'] },
    requestedScopes: ['orders.read'],
    sessionInspection: { active: true, status: 'available', scopes: ['orders.read'] },
    targetOrigin: 'https://example.com',
  });

  assert.equal(simulation.decision.allowed, true);
  assert.equal(simulation.decision.reason, 'policy.auth_read_allowed');
  assert.equal(simulation.decision.providerInvoked, false);
});

test('policy simulation allows controlled browser write', async () => {
  const policyPack = await readPolicyPack();
  const simulation = simulatePolicyPack(policyPack, {
    packageId: 'sitepkg:example.com',
    capabilityRef: 'sitepkg:example.com/contact-submit@1.0.0',
    providerId: 'browser_action_provider',
    capabilityKind: 'form_or_action',
    operation: 'form_or_action',
    authRequirement: { required: false, scopes: [] },
    targetOrigin: 'https://example.com',
  });

  assert.equal(simulation.decision.allowed, true);
  assert.equal(simulation.decision.reason, 'policy.controlled_browser_write_allowed');
});

test('policy simulation denies destructive default', async () => {
  const policyPack = await readPolicyPack();
  const simulation = simulatePolicyPack(policyPack, {
    capabilityKind: 'destructive',
    operation: 'write',
    destructiveRequirement: { required: true },
  });

  assert.equal(simulation.decision.allowed, false);
  assert.equal(simulation.decision.reason, 'runtime.destructive_execution_blocked');
});

test('policy simulation denies payment default', async () => {
  const policyPack = await readPolicyPack();
  const simulation = simulatePolicyPack(policyPack, {
    capabilityKind: 'payment',
    operation: 'write',
    paymentRequirement: { required: true },
  });

  assert.equal(simulation.decision.allowed, false);
  assert.equal(simulation.decision.reason, 'runtime.payment_execution_blocked');
});

test('scope widening policy diff is high risk', async () => {
  const previous = await readPolicyPack();
  const next = clone(previous);
  const rule = next.rules.find((entry) => entry.id === 'allow-auth-read-api');
  rule.match.requestedScopes.push('orders.write');

  const diff = diffPolicyPacks(previous, next);
  assert.ok(diff.changes.some((change) => change.kind === 'scope_widened' && change.severity === 'high'));
});

test('rule effect change deny to allow is high risk', async () => {
  const previous = await readPolicyPack();
  const next = clone(previous);
  const rule = next.rules.find((entry) => entry.id === 'allow-controlled-browser-write');
  rule.effect = 'deny';
  const relaxed = clone(next);
  relaxed.rules.find((entry) => entry.id === 'allow-controlled-browser-write').effect = 'allow';

  const diff = diffPolicyPacks(next, relaxed);
  assert.ok(diff.changes.some((change) => change.kind === 'rule_effect_deny_to_allow' && change.severity === 'high'));
});

test('policy simulator does not execute provider vault browser or network', async () => {
  const policyPack = await readPolicyPack();
  const originalFetch = globalThis.fetch;
  let fetchCalled = false;
  globalThis.fetch = () => {
    fetchCalled = true;
    throw new Error('policy simulation must not fetch');
  };
  try {
    const simulation = simulatePolicyPack(policyPack, {
      providerId: 'api_read_provider',
      capabilityKind: 'read',
      operation: 'read',
      authRequirement: { required: true, scopes: ['orders.read'] },
      requestedScopes: ['orders.read'],
    });
    assert.equal(simulation.decision.providerInvoked, false);
    assert.equal(simulation.decision.browserInvoked, false);
    assert.equal(simulation.decision.vaultAccessed, false);
    assert.equal(simulation.decision.networkInvoked, false);
    assert.equal(fetchCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('policy evaluator does not import provider implementation', async () => {
  const source = await readFile(new URL('../../src/domain/policies/policy-pack/policy-pack-simulator.mjs', import.meta.url), 'utf8');

  assert.doesNotMatch(source, /providers\/|provider-registry|provider-sdk|browser-runtime|session-vault/u);
  assert.doesNotMatch(source, /executeRuntimeInvocation|provider\.run|fetch\(|openBrowserSession/u);
});

test('audit viewer can include policy pack decision summary', async () => {
  const policyPack = await readPolicyPack();
  const simulation = simulatePolicyPack(policyPack, {
    providerId: 'api_read_provider',
    capabilityKind: 'read',
    operation: 'read',
    authRequirement: { required: true, scopes: ['orders.read'] },
    requestedScopes: ['orders.read'],
  });
  const auditSummary = {
    policyDecision: explainPolicyDecision(simulation.decision),
    providerInvoked: false,
  };

  assert.equal(auditSummary.policyDecision.policyId, policyPack.policyPackId);
  assert.equal(auditSummary.providerInvoked, false);
});

test('query API can filter by policyId and reason without executing', async () => {
  const policyPack = await readPolicyPack();
  const simulation = simulatePolicyPack(policyPack, {
    capabilityKind: 'payment',
    paymentRequirement: { required: true },
  });
  const views = [{ policyId: simulation.decision.policyId, reason: simulation.decision.reason }];
  const filtered = views.filter((view) => view.policyId === policyPack.policyPackId && view.reason === 'runtime.payment_execution_blocked');

  assert.equal(filtered.length, 1);
});

test('no raw material appears in policy input output or regression snapshot', async () => {
  const policyPack = await readPolicyPack();
  assert.throws(
    () => simulatePolicyPack(policyPack, {
      providerId: 'api_read_provider',
      capabilityKind: 'read',
      rawBody: 'sf_policy_raw_body_secret_789',
      authRequirement: { required: true, scopes: ['orders.read'] },
    }),
    (error) => error.code === 'policy_pack.raw_material_rejected',
  );
  const snapshot = createPolicyRegressionSnapshot(policyPack, [{
    caseId: 'auth-read',
    input: {
      providerId: 'api_read_provider',
      capabilityKind: 'read',
      operation: 'read',
      authRequirement: { required: true, scopes: ['orders.read'] },
      requestedScopes: ['orders.read'],
    },
  }]);

  assert.doesNotMatch(JSON.stringify(snapshot), POLICY_CANARIES);
});

test('policy pack validation forbids natural language authorization', async () => {
  const policyPack = await readPolicyPack();
  assert.throws(
    () => assertPolicyPackValid({
      ...policyPack,
      naturalLanguageAuthorization: 'sf_policy_token_secret_456',
    }),
    (error) => error.code === 'policy_pack.invalid',
  );
});
