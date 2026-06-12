import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyCapabilityEvidenceMatrix,
  buildCapabilityEvidenceMatrix,
} from '../../src/app/pipeline/build/capability-evidence-matrix.mjs';
import {
  evidenceLevelRank,
} from '../../src/app/pipeline/build/auth-state.mjs';

function publicContext(overrides = {}) {
  return {
    crawlContract: { coverageTargets: {} },
    authStateReport: null,
    ...overrides,
  };
}

function graph(nodes) {
  return { nodes };
}

test('capability evidence matrix activates public structured read capabilities', () => {
  const capability = {
    id: 'capability:fixture:ranking',
    name: 'read ranking',
    status: 'active',
    enabled_status: 'enabled',
    evidence: [{ type: 'page', source: 'public' }],
    entryNodeIds: ['node:ranking'],
    executionPlan: { mode: 'read_only', autoExecute: false },
  };
  const nodesById = new Map([[
    'node:ranking',
    {
      id: 'node:ranking',
      type: 'page',
      sourceLayer: 'public',
      normalizedUrl: 'https://example.test/rank',
      evidenceStatus: 'structure_summary_present',
      listPresent: true,
    },
  ]]);

  const matrix = buildCapabilityEvidenceMatrix(publicContext(), capability, nodesById);
  assert.equal(matrix.authRequired, false);
  assert.equal(matrix.providerId, 'public_http');
  assert.equal(matrix.activationDecision, 'active');
  assert.deepEqual(matrix.missingEvidence, []);
  assert.equal(matrix.observedEvidence.includes('public_structure_present'), true);

  const applied = applyCapabilityEvidenceMatrix(publicContext(), capability, graph([...nodesById.values()]));
  assert.equal(applied.status, 'active');
  assert.equal(applied.evidenceMatrix.activationDecision, 'active');
  assert.equal(applied.executionPlan.mode, 'read_only');
});

test('capability evidence matrix keeps authenticated capabilities controlled without fresh auth evidence', () => {
  const capability = {
    id: 'capability:fixture:notifications',
    name: 'list notifications',
    setupCapabilityId: 'list-notifications',
    status: 'active',
    enabled_status: 'enabled',
    evidence: [{ type: 'browser-route', source: 'auth' }],
    entryNodeIds: ['node:notifications'],
    executionPlan: { mode: 'read_only', autoExecute: false },
  };
  const nodes = [{
    id: 'node:notifications',
    type: 'page',
    sourceLayer: 'authenticated',
    authRequired: true,
    listPresent: true,
    visibleItemCount: 2,
  }];

  const applied = applyCapabilityEvidenceMatrix(publicContext(), capability, graph(nodes));
  assert.equal(applied.status, 'active');
  assert.equal(applied.enabled_status, 'enabled');
  assert.equal(applied.activationBlockedReason, 'missing_auth_evidence');
  assert.equal(applied.executionPlan.governedExecution, true);
  assert.equal(applied.executionPlan.executionDisposition, 'controlled');
  assert.equal(applied.executionPlan.autoExecute, false);
  assert.equal(applied.planCallable, true);
  assert.equal(applied.runtimeCallable, true);
  assert.equal(applied.autoExecutable, false);
  assert.equal(applied.executionDisposition, 'controlled');
  assert.equal(applied.executionGates.includes('session_required'), true);
  assert.equal(applied.evidenceMatrix.activationDecision, 'requires_login');
});

test('capability evidence matrix limits authenticated capabilities after browser verification', () => {
  const context = publicContext({
    authStateReport: {
      authMethod: 'browser',
      authVerificationStatus: 'browser_verified_partial',
      verified: true,
      browserBridge: {
        routeResults: [{ routeId: 'route-1', status: 'captured' }],
      },
      capabilityProofs: [{ capabilityId: 'list-notifications' }],
    },
  });
  const capability = {
    id: 'capability:fixture:notifications',
    name: 'list notifications',
    setupCapabilityId: 'list-notifications',
    status: 'active',
    enabled_status: 'enabled',
    evidence: [{ type: 'browser-route', source: 'auth' }],
    entryNodeIds: ['node:notifications'],
    executionPlan: { mode: 'read_only', autoExecute: false },
  };
  const nodes = [{
    id: 'node:notifications',
    type: 'page',
    sourceLayer: 'authenticated',
    authRequired: true,
    listPresent: true,
    visibleItemCount: 2,
  }];

  const applied = applyCapabilityEvidenceMatrix(context, capability, graph(nodes));
  assert.equal(applied.status, 'active');
  assert.equal(applied.enabled_status, 'enabled');
  assert.equal(applied.default_policy, 'enabled');
  assert.equal(applied.evidence_status, 'verified');
  assert.deepEqual(applied.evidenceMatrix.missingEvidence, []);
});

test('authenticated search results pages satisfy read-only social search evidence', () => {
  const context = publicContext({
    authStateReport: {
      authMethod: 'browser',
      authVerificationStatus: 'browser_verified',
      verified: true,
    },
  });
  const capability = {
    id: 'capability:fixture:search-posts',
    name: 'search posts',
    setupCapabilityId: 'search-posts',
    action: 'search',
    status: 'active',
    enabled_status: 'enabled',
    evidence: [{ type: 'browser-route', source: 'auth' }],
    entryNodeIds: ['node:search'],
    executionPlan: { mode: 'read_only', autoExecute: false },
  };
  const nodes = [{
    id: 'node:search',
    type: 'page',
    sourceLayer: 'authenticated',
    authRequired: true,
    pageType: 'search-results',
    evidenceStatus: 'structure_summary_present',
    visibleItemCount: 4,
  }];

  const applied = applyCapabilityEvidenceMatrix(context, capability, graph(nodes));
  assert.equal(applied.status, 'active');
  assert.equal(applied.enabled_status, 'enabled');
  assert.equal(applied.evidence_status, 'verified');
  assert.deepEqual(applied.evidenceMatrix.missingEvidence, []);
  assert.equal(applied.runtimeCallable, undefined);
  assert.equal(applied.executionPlan.mode, 'read_only');
});

test('browser bridge structure evidence satisfies authenticated route-level capabilities', () => {
  const context = publicContext({
    authStateReport: {
      authMethod: 'browser',
      authVerificationStatus: 'browser_verified',
      verified: true,
    },
  });
  const capability = {
    id: 'capability:fixture:authenticated-route',
    name: 'open authenticated route',
    status: 'active',
    enabled_status: 'enabled',
    evidenceModel: 'authenticated_route_only',
    evidence: [{ type: 'browser-route', source: 'auth' }],
    entryNodeIds: ['node:account'],
    executionPlan: { mode: 'read_only', autoExecute: false },
  };
  const nodesById = new Map([[
    'node:account',
    {
      id: 'node:account',
      type: 'page',
      sourceLayer: 'authenticated',
      authRequired: true,
      evidenceLevel: 'browser_structure_verified',
    },
  ]]);

  const matrix = buildCapabilityEvidenceMatrix(context, capability, nodesById);
  assert.equal(matrix.requiredEvidenceLevel, 'login_route_verified');
  assert.equal(matrix.observedEvidenceLevel, 'browser_structure_verified');
  assert.equal(evidenceLevelRank(matrix.observedEvidenceLevel) >= evidenceLevelRank(matrix.requiredEvidenceLevel), true);
});

test('capability evidence matrix keeps forced-risk capabilities governed', () => {
  const capability = {
    id: 'capability:fixture:delete',
    name: 'delete post',
    object: 'post',
    action: 'delete',
    risk_level: 'write_high',
    status: 'active',
    enabled_status: 'enabled',
    evidence: [{ type: 'page', source: 'public' }],
    entryNodeIds: ['node:delete'],
    executionPlan: { mode: 'read_only', autoExecute: false },
  };
  const nodes = [{
    id: 'node:delete',
    type: 'page',
    sourceLayer: 'public',
    normalizedUrl: 'https://example.test/delete',
    evidenceStatus: 'structure_summary_present',
    listPresent: true,
  }];

  const applied = applyCapabilityEvidenceMatrix(publicContext(), capability, graph(nodes));
  assert.equal(applied.status, 'active');
  assert.equal(applied.enabled_status, 'disabled');
  assert.equal(applied.evidence_status, 'disabled');
  assert.equal(applied.activationBlockedReason, 'forced-action-disabled');
  assert.equal(applied.planCallable, true);
  assert.equal(applied.autoExecutable, false);
  assert.equal(applied.executionDisposition, 'blocked');
  assert.equal(applied.executionPlan.governedExecution, true);
  assert.equal(applied.executionPlan.autoExecute, false);
});

test('capability evidence matrix keeps site-policy disabled forced-risk capabilities disabled', () => {
  const capability = {
    id: 'capability:fixture:change-payment',
    name: 'change payment settings',
    object: 'payment settings',
    action: 'manage',
    risk_level: 'account_security_critical',
    status: 'disabled',
    enabled_status: 'disabled',
    default_policy: 'disabled',
    evidence_status: 'disabled',
    activationBlockedReason: 'site-policy-disabled-action',
    disabledReason: 'site-policy-disabled-action',
    sitePolicyDisabled: true,
    sitePolicyDisabledActions: ['change_payment'],
    evidence: [{ type: 'page', source: 'public' }],
    entryNodeIds: ['node:settings'],
  };
  const nodes = [{
    id: 'node:settings',
    type: 'page',
    sourceLayer: 'public',
    normalizedUrl: 'https://example.test/settings',
    evidenceStatus: 'structure_summary_present',
    listPresent: true,
  }];

  const applied = applyCapabilityEvidenceMatrix(publicContext(), capability, graph(nodes));
  assert.equal(applied.status, 'disabled');
  assert.equal(applied.enabled_status, 'disabled');
  assert.equal(applied.default_policy, 'disabled');
  assert.equal(applied.activationBlockedReason, 'site-policy-disabled-action');
  assert.equal(applied.planCallable, false);
  assert.equal(applied.runtimeCallable, false);
  assert.equal(applied.autoExecutable, false);
  assert.equal(applied.executionPlan, undefined);
});
