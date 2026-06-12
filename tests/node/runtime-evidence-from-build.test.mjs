import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';

import {
  generateRuntimeEvidenceFromBuild,
} from '../../scripts/runtime-evidence-from-build.mjs';

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function noAuthRequirement() {
  return {
    required: false,
    mode: 'none',
    scopes: [],
    material: {
      allowedTypes: [],
      injectionTarget: 'http_request',
    },
  };
}

function contract({
  capabilityId,
  name,
  bindingKind,
  providerId,
  gates = [],
  routeTemplate,
}) {
  return {
    schemaVersion: 1,
    id: `execution-contract:${capabilityId}`,
    capabilityId,
    executionPlanId: `plan:${capabilityId}`,
    intentIds: [`intent:${capabilityId}`],
    capabilityKind: 'read',
    operationKind: 'navigate',
    contractKind: 'navigate',
    executionDisposition: gates.length ? 'controlled' : 'allow',
    executionVerdict: gates.length ? 'controlled' : 'allow',
    executionGates: gates,
    destructiveAction: false,
    highRiskAction: false,
    paymentOrFundsAction: false,
    planCallable: true,
    runtimeCallable: true,
    requestSchemaRef: `schema:${capabilityId}:request`,
    responseSchemaRef: `schema:${capabilityId}:response`,
    sessionRequirementRef: gates.includes('session_required') ? `session-requirement:${capabilityId}` : null,
    authRequirementRef: null,
    authRequirement: noAuthRequirement(),
    runtimeBinding: {
      kind: bindingKind,
      providerId,
      credentialMaterialPolicy: 'no_raw_material',
      cookieMaterialPersisted: false,
      sessionViewPersisted: false,
    },
    payloadTemplate: {
      steps: [
        {
          kind: 'site_action',
          routeTemplate,
          savedMaterial: 'sanitized_summary_only',
        },
      ],
    },
    descriptorOnly: true,
    redactionRequired: true,
    name,
  };
}

function decisionFor(executionContract, gates = []) {
  const gateStatus = {};
  for (const gate of gates) {
    gateStatus[gate] = { satisfied: false };
  }
  gateStatus.allSatisfied = gates.length === 0;
  return {
    schemaVersion: 1,
    id: `execution-governance:${executionContract.capabilityId}`,
    contractRef: executionContract.id,
    capabilityId: executionContract.capabilityId,
    executionPlanId: executionContract.executionPlanId,
    verdict: gates.length ? 'controlled' : 'allow',
    gates,
    gateStatus,
    disposition: gates.length ? 'controlled' : 'allow',
    highRiskAction: false,
    destructiveAction: false,
    paymentOrFundsAction: false,
    runtimeDispatchAllowed: gates.length === 0,
    reasonCode: gates.length ? 'execution.required_gates_not_satisfied' : 'execution.runtime_dispatch_allowed',
    auditRequired: false,
  };
}

async function createBuildFixture() {
  const buildDir = await mkdtemp(path.join(os.tmpdir(), 'siteforge-runtime-evidence-'));
  const bridgeCapability = {
    id: 'capability:test-site:list-notifications',
    name: 'list notifications',
    action: 'list',
    object: 'notifications',
    status: 'active',
    enabled_status: 'enabled',
    providerId: 'browser_bridge',
    runtimeProviderId: 'browser_bridge',
  };
  const publicCapability = {
    id: 'capability:test-site:browse-public-navigation',
    name: 'browse public navigation',
    action: 'browse',
    object: 'public navigation',
    status: 'active',
    enabled_status: 'enabled',
    providerId: 'public_http',
    runtimeProviderId: 'public_http',
  };
  const bridgeContract = contract({
    capabilityId: bridgeCapability.id,
    name: bridgeCapability.name,
    bindingKind: 'browser_bridge',
    providerId: 'browser_bridge',
    gates: ['session_required'],
    routeTemplate: '/notifications',
  });
  const publicContract = contract({
    capabilityId: publicCapability.id,
    name: publicCapability.name,
    bindingKind: 'public_http',
    providerId: 'public_http',
    gates: [],
    routeTemplate: '/',
  });
  await Promise.all([
    writeJson(path.join(buildDir, 'site.json'), {
      schemaVersion: 1,
      id: 'test-site',
      rootUrl: 'https://example.test/',
      allowedDomains: ['example.test'],
    }),
    writeJson(path.join(buildDir, 'capabilities.json'), {
      schemaVersion: 1,
      buildId: 'build-runtime-evidence-test',
      capabilities: [bridgeCapability, publicCapability],
    }),
    writeJson(path.join(buildDir, 'intents.json'), {
      schemaVersion: 1,
      buildId: 'build-runtime-evidence-test',
      intents: [
        {
          id: `intent:${bridgeCapability.id}`,
          capabilityId: bridgeCapability.id,
          text: bridgeCapability.name,
        },
        {
          id: `intent:${publicCapability.id}`,
          capabilityId: publicCapability.id,
          text: publicCapability.name,
        },
      ],
    }),
    writeJson(path.join(buildDir, 'execution_contracts.json'), {
      schemaVersion: 1,
      buildId: 'build-runtime-evidence-test',
      siteId: 'test-site',
      executionContracts: [bridgeContract, publicContract],
    }),
    writeJson(path.join(buildDir, 'execution_governance.json'), {
      schemaVersion: 1,
      buildId: 'build-runtime-evidence-test',
      siteId: 'test-site',
      decisions: [
        decisionFor(bridgeContract, ['session_required']),
        decisionFor(publicContract, []),
      ],
    }),
  ]);
  return buildDir;
}

test('runtime evidence runner replays browser bridge contracts from a generated build without material access', async () => {
  const buildDir = await createBuildFixture();
  try {
    const { report, writePath } = await generateRuntimeEvidenceFromBuild({
      buildDir,
      tasks: [],
      allRuntimeCallable: true,
      bindings: ['browser_bridge'],
      execute: true,
      sessionAvailable: true,
      writePath: 'runtime_evidence/browser_bridge.json',
    });

    assert.equal(report.summary.attemptedCapabilities, 1);
    assert.equal(report.summary.providerCompleted, 1);
    assert.equal(report.summary.runtimeExecuted, 1);
    assert.equal(report.summary.unsafeBrowserBridgeSideEffectReports, 0);
    assert.equal(report.safetyBoundary.sessionSignal, 'boolean_only');
    assert.equal(report.safetyBoundary.providerMaterialUse, 'none');
    assert.equal(report.rows[0].dispatchStatus, 'ready_for_controlled_runtime');
    assert.equal(report.rows[0].execution.providerId, 'browser_bridge');
    assert.equal(report.rows[0].execution.providerKind, 'browser_bridge_read_provider');
    assert.equal(report.rows[0].execution.sideEffectAttempted, false);
    assert.equal(report.rows[0].execution.resultSummary.contentMaterial, 'no_raw_page_content');
    assert.equal(report.rows[0].execution.resultSummary.authMaterial, 'not_requested_by_provider');

    const persisted = JSON.parse(await readFile(writePath, 'utf8'));
    assert.equal(persisted.rows[0].execution.status, 'completed');
    assert.doesNotMatch(JSON.stringify(persisted), /Bearer\s+|auth_token=|ct0=|set-cookie\s*:|x-csrf-token\s*:/iu);
  } finally {
    await rm(buildDir, { recursive: true, force: true });
  }
});

test('runtime evidence runner lets public_http resolve through the production read provider', async () => {
  const buildDir = await createBuildFixture();
  try {
    const { report } = await generateRuntimeEvidenceFromBuild({
      buildDir,
      tasks: ['capability:test-site:browse-public-navigation'],
      allRuntimeCallable: false,
      bindings: [],
      execute: true,
      sessionAvailable: false,
    });

    assert.equal(report.summary.attemptedCapabilities, 1);
    assert.equal(report.rows[0].runtimeBinding.kind, 'public_http');
    assert.equal(report.rows[0].runtimeBinding.providerId, null);
    assert.equal(report.rows[0].runtimeDispatchAllowed, true);
    assert.equal(report.rows[0].execution.providerId, 'api_read_provider');
    assert.equal(report.rows[0].execution.providerKind, 'api_read_provider');
    assert.equal(report.rows[0].execution.resultSummary.runtimeMode, 'descriptor_only_read');
  } finally {
    await rm(buildDir, { recursive: true, force: true });
  }
});
