import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  SITE_ONBOARDING_DISCOVERY_SCHEMA_VERSION,
  SITE_ONBOARDING_REQUIRED_COVERAGE_THRESHOLD,
  UNKNOWN_NODE_REPORT_SCHEMA_VERSION,
  assertSiteOnboardingDiscoveryComplete,
  createSiteOnboardingDiscoveryArtifacts,
} from '../../src/sites/capability/site-onboarding-discovery.mjs';
import * as SiteOnboardingDiscoveryModule from '../../src/sites/capability/site-onboarding-discovery.mjs';

function discoveredNode(id, {
  nodeKind = 'dom-node',
  required = false,
  locator = `#${id}`,
} = {}) {
  return {
    id,
    kind: nodeKind,
    required,
    locator,
    label: id,
  };
}

function discoveredApi(id, {
  method = 'GET',
  required = false,
  url = `https://example.invalid/api/${id}`,
  ...rest
} = {}) {
  return {
    id,
    method,
    required,
    url,
    label: id,
    ...rest,
  };
}

function adapterFromDecisions({
  nodes = {},
  apis = {},
  capabilityEvidence = [],
  capabilityEvidenceFixtures = [],
} = {}) {
  return {
    id: 'synthetic-adapter',
    capabilityEvidence,
    metadata: {
      capabilityEvidenceFixtures,
    },
    classifyNode(node) {
      return nodes[node.id] ?? {
        classification: 'unknown',
        required: node.required,
      };
    },
    classifyApi(api) {
      return apis[api.id] ?? {
        classification: 'unknown',
        required: api.required,
      };
    },
  };
}

function createSyntheticCaptureExpandFixture() {
  const profilePath = 'C:/Users/example/AppData/Local/BrowserProfile';
  const homeUrl = 'https://example.invalid/home?access_token=synthetic-capture-token&msToken=synthetic-ms-token';
  const detailUrl = 'https://example.invalid/items/42?token=synthetic-detail-token';
  const loginUrl = `https://example.invalid/login?profile_path=${encodeURIComponent(profilePath)}`;

  return {
    profilePath,
    captureOutput: {
      schemaVersion: 1,
      siteKey: 'synthetic-navigation',
      inputUrl: homeUrl,
      finalUrl: homeUrl,
      title: 'Synthetic Home',
      capturedAt: '2026-05-03T16:00:00.000Z',
      status: 'success',
      pageType: 'home',
      files: {
        manifest: `${profilePath}/capture/manifest.json`,
      },
      pageFacts: {
        loginStateDetected: true,
        restrictionDetected: true,
        riskPageDetected: true,
        antiCrawlDetected: true,
        antiCrawlSignals: ['login-required', 'risk-control'],
      },
      networkRequests: [
        {
          siteKey: 'synthetic-navigation',
          method: 'GET',
          url: 'https://example.invalid/api/items?csrf_token=synthetic-api-csrf&xsec_token=synthetic-xsec-token',
          resourceType: 'xhr',
          source: 'capture-network',
          headers: {
            authorization: 'Bearer synthetic-api-auth',
          },
        },
        {
          siteKey: 'synthetic-navigation',
          method: 'POST',
          url: 'https://example.invalid/graphql?session_id=synthetic-session-id',
          resourceType: 'fetch',
          postData: 'query Viewer { id }',
        },
      ],
    },
    expandOutput: {
      schemaVersion: 1,
      inputUrl: homeUrl,
      baseUrl: homeUrl,
      summary: {
        capturedStates: 2,
        discoveredTriggers: 2,
      },
      states: [
        {
          stateId: 's0000',
          status: 'captured',
          finalUrl: homeUrl,
          title: 'Synthetic Home',
          pageType: 'home',
          pageFacts: {
            loginStateDetected: true,
          },
          trigger: null,
        },
        {
          stateId: 's0001',
          fromState: 's0000',
          status: 'captured',
          finalUrl: detailUrl,
          title: 'Synthetic Detail',
          pageType: 'content-detail',
          pageFacts: {
            riskPageDetected: true,
            antiCrawlDetected: true,
            antiCrawlSignals: ['risk-control'],
          },
          trigger: {
            kind: 'content-link',
            label: 'Open Detail',
            href: detailUrl,
            locator: {
              tagName: 'a',
              role: 'link',
              text: 'Open Detail',
            },
          },
        },
        {
          stateId: 's0002',
          fromState: 's0000',
          status: 'noop',
          finalUrl: loginUrl,
          title: 'Login Gate',
          pageType: 'login',
          pageFacts: {
            loginRequired: true,
            restrictionDetected: true,
          },
          trigger: {
            kind: 'login-form',
            label: 'Login Gate',
            href: loginUrl,
          },
        },
      ],
    },
  };
}

function assertNoSensitiveFixtureMaterial(value) {
  const serialized = JSON.stringify(value);
  for (const sensitive of [
    'synthetic-capture-token',
    'synthetic-ms-token',
    'synthetic-detail-token',
    'synthetic-api-csrf',
    'synthetic-xsec-token',
    'synthetic-api-auth',
    'synthetic-session-id',
    'synthetic-login-token',
    'synthetic-cookie',
    'synthetic-trigger-token',
    'synthetic-trigger-csrf',
    'synthetic-trigger-session',
    'synthetic-websocket-token',
    'synthetic-sse-session',
    'synthetic-preflight-csrf',
    'synthetic-redirect-token',
    'synthetic-redirect-sessdata',
    'synthetic-query-token',
    'synthetic-response-token',
    'synthetic-dom-token',
    'synthetic-dom-auth',
    'synthetic-a11y-session',
    'synthetic-state-token',
    'synthetic-js-token',
    'synthetic-import-token',
    'synthetic-chunk-session',
    'alice@example.com',
    'My Account Alice',
    'Alice',
    '203.0.113.7',
    'BrowserProfile',
    'AppData/Local',
    'profile_path=',
    'Bearer ',
  ]) {
    assert.equal(serialized.includes(sensitive), false, `serialized output leaked ${sensitive}`);
  }
}

function createProducerInputsFromFixture(fixture) {
  const producer = SiteOnboardingDiscoveryModule
    .createSiteOnboardingDiscoveryInputsFromCaptureExpandOutput;
  assert.equal(
    typeof producer,
    'function',
    'createSiteOnboardingDiscoveryInputsFromCaptureExpandOutput must be exported',
  );
  return producer({
    siteKey: 'synthetic-navigation',
    captureOutput: fixture.captureOutput,
    expandOutput: fixture.expandOutput,
  });
}

test('Site onboarding discovery exports versioned schema and coverage constants', () => {
  assert.equal(SITE_ONBOARDING_DISCOVERY_SCHEMA_VERSION, 1);
  assert.equal(UNKNOWN_NODE_REPORT_SCHEMA_VERSION, SITE_ONBOARDING_DISCOVERY_SCHEMA_VERSION);
  assert.equal(SITE_ONBOARDING_REQUIRED_COVERAGE_THRESHOLD, 0.95);
});

test('Discovery coverage plan defines 90-point node, API, and capability target taxonomy', () => {
  const plan = SiteOnboardingDiscoveryModule.createSiteOnboardingDiscoveryCoveragePlan({
    siteKey: 'example',
    requestedCapabilities: ['search-content', 'download-content'],
    capabilityFamilies: ['open-content'],
    supportedIntents: ['open-author'],
    pageTypes: ['custom-list-page'],
  });

  assert.equal(plan.artifactName, 'DISCOVERY_COVERAGE_PLAN');
  assert.equal(plan.targetScoreThreshold, 0.9);
  assert.equal(plan.architecture.pass, true);
  assert.equal(plan.architecture.nodeScore >= 90, true);
  assert.equal(plan.architecture.apiScore >= 90, true);
  assert.equal(plan.architecture.capabilityScore >= 90, true);
  assert.equal(plan.nodeTargets.some((target) => target.targetId === 'login-state'), true);
  assert.equal(plan.nodeTargets.some((target) => target.targetId === 'risk-control'), true);
  assert.equal(plan.apiTargets.some((target) => target.targetId === 'graphql-endpoint'), true);
  assert.equal(plan.apiTargets.some((target) => target.targetId === 'request-protection-endpoint'), true);
  assert.equal(plan.capabilityTargets.some((target) => target.targetId === 'download-content'), true);
  assert.equal(plan.policy.observedApiAutoPromotionAllowed, false);
  assert.equal(plan.policy.siteSpecificInterpretationOwner, 'SiteAdapter');
});

test('Discovery scorecard separates architecture readiness from actual evidence coverage', () => {
  const artifacts = createSiteOnboardingDiscoveryArtifacts({
    siteKey: 'example',
    discoveredNodes: [
      discoveredNode('home-page', { nodeKind: 'home-page', required: true }),
      discoveredNode('search-form', { nodeKind: 'search-form', required: true }),
    ],
    discoveredApis: [
      discoveredApi('api-search', {
        required: true,
        url: 'https://example.invalid/api/search?q=synthetic',
      }),
    ],
    requestedCapabilities: ['search-content', 'download-content'],
    adapter: adapterFromDecisions({
      nodes: {
        'home-page': {
          classification: 'recognized',
          recognizedAs: 'home-page',
          required: true,
        },
        'search-form': {
          classification: 'recognized',
          recognizedAs: 'search-form',
          required: true,
        },
      },
      apis: {
        'api-search': {
          classification: 'recognized',
          recognizedAs: 'search-endpoint',
          required: true,
        },
      },
    }),
  });

  const report = artifacts.objects.SITE_CAPABILITY_REPORT;
  assert.equal(report.discoveryScorecard.architecture.pass, true);
  assert.equal(report.discoveryScorecard.evidence.pass, false);
  assert.equal(report.summary.ninetyPointArchitectureReady, true);
  assert.equal(report.summary.ninetyPointEvidenceReady, false);
  assert.match(artifacts.markdown.SITE_CAPABILITY_REPORT, /90-point architecture ready: yes/u);
  assert.match(artifacts.markdown.SITE_CAPABILITY_REPORT, /90-point evidence ready: no/u);
  assert.match(artifacts.markdown.DISCOVERY_AUDIT, /ninetyPointArchitectureReady\s+\|\s+yes/u);
});

test('Discovery scorecard does not treat requested capabilities as observed evidence', () => {
  const plan = SiteOnboardingDiscoveryModule.createSiteOnboardingDiscoveryCoveragePlan({
    requestedCapabilities: ['search-content'],
  });
  const scorecard = SiteOnboardingDiscoveryModule.createSiteOnboardingDiscoveryScorecard({
    coveragePlan: plan,
    capabilityCoverageSummary: {
      requestedCapabilities: ['search-content', 'download-content'],
      targetedCapabilityCount: 2,
    },
  });

  assert.equal(scorecard.architecture.capabilityScore >= 90, true);
  assert.equal(scorecard.evidence.capabilityScore, 0);
  assert.equal(scorecard.pass, false);
});

test('Capability targets map DOM and API evidence without executable promotion', () => {
  const artifacts = createSiteOnboardingDiscoveryArtifacts({
    siteKey: 'example',
    requestedCapabilities: ['search-content', 'download-content'],
    discoveredNodes: [
      discoveredNode('search-form-node', {
        nodeKind: 'search-form',
        required: true,
        locator: '#search',
      }),
    ],
    discoveredApis: [
      discoveredApi('search-api', {
        method: 'GET',
        required: true,
        url: 'https://example.invalid/api/search?access_token=synthetic-query-token',
        roleHint: 'search',
        endpointKind: 'rest-json',
        responseShapeStatus: 'observed',
        responseShape: {
          type: 'object',
          fieldNames: ['items', 'cursor', 'title'],
          sampleValue: 'synthetic-response-token',
        },
        headers: {
          authorization: 'Bearer synthetic-response-token',
          cookie: 'SESSDATA=synthetic-response-session',
        },
        body: {
          csrf_token: 'synthetic-response-csrf',
        },
        payload: 'synthetic-response-token',
        rawResponse: 'synthetic-response-session',
        browserProfile: 'C:/Users/Alice/AppData/Local/BrowserProfile/Default',
        sourceRef: 'run-handler.mjs',
        responseSchemaHash: `sha256:${'c'.repeat(64)}`,
        multiStepCorrelation: {
          flowId: 'search-flow',
        },
      }),
    ],
    adapter: adapterFromDecisions({
      nodes: {
        'search-form-node': {
          classification: 'recognized',
          recognizedAs: 'search-form',
          required: true,
        },
      },
      apis: {
        'search-api': {
          classification: 'recognized',
          recognizedAs: 'search-endpoint',
          required: true,
        },
      },
    }),
  });

  const searchTarget = artifacts.objects.CAPABILITY_TARGETS.targets
    .find((target) => target.targetId === 'search-content');
  assert.equal(searchTarget.discoveryState, 'observed_only');
  assert.equal(searchTarget.verificationState, 'unverified');
  assert.equal(searchTarget.executableCapabilityAllowed, false);
  assert.equal(searchTarget.observedCapabilityAutoPromotionAllowed, false);
  assert.equal(searchTarget.evidenceKinds.includes('node-inventory'), true);
  assert.equal(searchTarget.evidenceKinds.includes('api-response-evidence'), true);
  assert.deepEqual(
    [...searchTarget.mappingSummary.mappedSourceKinds].sort(),
    ['api-response-evidence', 'node-inventory'],
  );
  assert.equal(searchTarget.mappingSummary.observedEvidenceCount, 2);
  assert.equal(searchTarget.mappingSummary.executableEvidenceCount, 0);
  assert.equal(searchTarget.mappingSummary.evidenceRequirementGapCount, 6);
  assert.deepEqual(
    searchTarget.evidenceRequirementGaps.map((gap) => gap.requiredEvidenceStatus),
    [
      'requires_adapter_evidence',
      'requires_schema_evidence',
      'requires_test_evidence',
      'requires_policy_evidence',
      'requires_risk_evidence',
      'requires_approval_evidence',
    ],
  );
  assert.equal(searchTarget.evidenceRequirementGaps.every((gap) => gap.redactionRequired === true), true);
  assert.equal(searchTarget.evidenceRequirementGaps.every((gap) => gap.requiresManualReview === true), true);
  assert.equal(searchTarget.evidenceCompletionStrategy.strategyKind, 'capability-evidence-completion');
  assert.equal(searchTarget.evidenceCompletionStrategy.nextAction, 'collect-required-execution-evidence');
  assert.equal(searchTarget.evidenceCompletionStrategy.executableCapabilityAllowed, false);
  assert.equal(searchTarget.evidenceCompletionStrategy.observedCapabilityAutoPromotionAllowed, false);
  assert.deepEqual(
    searchTarget.evidenceCompletionStrategy.requiredEvidenceStatuses,
    [
      'requires_adapter_evidence',
      'requires_schema_evidence',
      'requires_test_evidence',
      'requires_policy_evidence',
      'requires_risk_evidence',
      'requires_approval_evidence',
    ],
  );
  assert.equal(searchTarget.evidenceMappings.length, 2);
  assert.equal(searchTarget.evidenceMappings.every((mapping) => mapping.descriptorOnly === true), true);
  assert.equal(searchTarget.evidenceMappings.every((mapping) => mapping.executableEvidence === false), true);
  assert.equal(searchTarget.evidenceMappings.some((mapping) => String(mapping.sourceRef).includes('synthetic-query-token')), false);
  const apiMapping = searchTarget.evidenceMappings
    .find((mapping) => mapping.sourceKind === 'api-response-evidence');
  assert.equal(apiMapping.sourceRef, 'search-api');
  assert.equal(apiMapping.evidenceDetail.descriptorKind, 'capability-api-response-evidence');
  assert.equal(apiMapping.evidenceDetail.targetId, 'search-content');
  assert.equal(apiMapping.evidenceDetail.sourceApiId, 'search-api');
  assert.equal(apiMapping.evidenceDetail.roleHint, 'search');
  assert.equal(apiMapping.evidenceDetail.endpointKind, 'rest-json');
  assert.equal(apiMapping.evidenceDetail.responseShapeStatus, 'observed');
  assert.deepEqual(apiMapping.evidenceDetail.responseFieldHints, ['items', 'cursor', 'title']);
  assert.equal(apiMapping.evidenceDetail.multiStepCorrelationPresent, true);
  assert.equal(apiMapping.evidenceDetail.observedOnly, true);
  assert.equal(apiMapping.evidenceDetail.executableEvidence, false);
  assert.equal(apiMapping.evidenceDetail.redactionRequired, true);
  assert.equal(Object.hasOwn(apiMapping.evidenceDetail, 'headers'), false);
  assert.equal(Object.hasOwn(apiMapping.evidenceDetail, 'body'), false);
  assert.equal(Object.hasOwn(apiMapping.evidenceDetail, 'payload'), false);
  assert.equal(Object.hasOwn(apiMapping.evidenceDetail, 'rawResponse'), false);
  assert.equal(JSON.stringify(artifacts).includes('synthetic-response-token'), false);
  assert.equal(JSON.stringify(artifacts).includes('synthetic-response-session'), false);
  assert.equal(JSON.stringify(artifacts).includes('synthetic-response-csrf'), false);
  assert.equal(JSON.stringify(artifacts).includes('BrowserProfile'), false);
  assert.equal(JSON.stringify(artifacts).includes('run-handler.mjs'), false);
  assert.equal(searchTarget.missingEvidenceKinds.includes('adapter'), true);
  assert.equal(searchTarget.missingEvidenceKinds.includes('schema'), true);
  assert.equal(searchTarget.missingEvidenceKinds.includes('test'), true);
  assert.equal(searchTarget.missingEvidenceKinds.includes('policy'), true);
  assert.equal(searchTarget.missingEvidenceKinds.includes('risk'), true);
  assert.equal(searchTarget.missingEvidenceKinds.includes('approval'), true);
  assert.equal(searchTarget.targetSources.some((source) => source.kind === 'node-inventory'), true);
  assert.equal(searchTarget.targetSources.some((source) => source.kind === 'api-response-evidence'), true);
  assert.equal(searchTarget.targetSources.some((source) => String(source.ref).includes('synthetic-query-token')), false);

  const searchGap = artifacts.objects.CAPABILITY_GAP_REPORT.gaps
    .find((gap) => gap.targetId === 'search-content');
  assert.equal(searchGap.gapStatus, 'UNVERIFIED');
  assert.deepEqual(searchGap.requiredEvidenceStatuses, [
    'requires_adapter_evidence',
    'requires_schema_evidence',
    'requires_test_evidence',
    'requires_policy_evidence',
    'requires_risk_evidence',
    'requires_approval_evidence',
  ]);
  assert.deepEqual(searchGap.mappingGaps.map((gap) => gap.gapKind), ['missing-execution-evidence']);
  assert.equal(searchGap.evidenceRequirementGapCount, 6);
  assert.equal(searchGap.evidenceCompletionStrategy.nextAction, 'collect-required-execution-evidence');
  assert.equal(searchGap.evidenceCompletionStrategy.redactionRequired, true);
  assert.deepEqual(
    searchGap.evidenceRequirementGaps.map((gap) => gap.requiredEvidenceKind),
    ['adapter', 'schema', 'test', 'policy', 'risk', 'approval'],
  );
  assert.equal(
    artifacts.objects.CAPABILITY_GAP_REPORT.totalEvidenceRequirementGaps >= 6,
    true,
  );
  assert.equal(searchGap.evidenceMappings.length, 2);
  assert.equal(searchGap.executableCapabilityAllowed, false);
  assert.match(artifacts.markdown.CAPABILITY_TARGETS, /Evidence kinds/u);
  assert.match(artifacts.markdown.CAPABILITY_TARGETS, /Next evidence action/u);
  assert.match(artifacts.markdown.CAPABILITY_GAP_REPORT, /Missing evidence/u);
  assert.match(artifacts.markdown.CAPABILITY_GAP_REPORT, /collect-required-execution-evidence/u);
  assert.match(artifacts.markdown.CAPABILITY_GAP_REPORT, /Evidence requirement gaps/u);
  assertNoSensitiveFixtureMaterial(artifacts);
});

test('Capability target execution requires explicit adapter schema test policy risk and approval evidence', () => {
  const observedOnlyArtifacts = createSiteOnboardingDiscoveryArtifacts({
    siteKey: 'example',
    requestedCapabilities: ['search-content'],
    capabilityInventory: {
      entries: [
        {
          id: 'observed-search-capability',
          label: 'search-content',
          recognizedAs: 'search-content',
          classification: 'recognized',
          discoveryStatus: 'observed_only',
          verificationState: 'unverified',
          evidenceKind: 'capability-inventory',
          evidenceRef: 'https://example.invalid/api/search?access_token=synthetic-query-token',
        },
      ],
    },
  });
  const observedTarget = observedOnlyArtifacts.objects.CAPABILITY_TARGETS.targets
    .find((target) => target.targetId === 'search-content');
  assert.equal(observedTarget.discoveryState, 'observed_only');
  assert.equal(observedTarget.verificationState, 'unverified');
  assert.equal(observedTarget.executableCapabilityAllowed, false);
  assert.equal(observedTarget.targetSources.some((source) => String(source.ref).includes('synthetic-query-token')), false);
  assert.equal(observedOnlyArtifacts.objects.CAPABILITY_GAP_REPORT.gaps
    .some((gap) => gap.targetId === 'search-content' && gap.missingEvidenceKinds.includes('policy')), true);
  assert.equal(observedOnlyArtifacts.objects.CAPABILITY_GAP_REPORT.gaps
    .some((gap) => gap.targetId === 'search-content' && gap.missingEvidenceKinds.includes('risk')), true);
  assert.equal(observedOnlyArtifacts.objects.CAPABILITY_GAP_REPORT.gaps
    .some((gap) => gap.targetId === 'search-content' && gap.missingEvidenceKinds.includes('approval')), true);

  const verifiedArtifacts = createSiteOnboardingDiscoveryArtifacts({
    siteKey: 'example',
    requestedCapabilities: ['search-content'],
    capabilityInventory: {
      entries: [
        {
          id: 'adapter-search-capability',
          label: 'search-content',
          recognizedAs: 'search-content',
          discoveryStatus: 'verified',
          verificationState: 'verified',
          evidenceKind: 'adapter',
          evidenceRef: 'SiteAdapter.search-content',
        },
        {
          id: 'schema-search-capability',
          label: 'search-content',
          recognizedAs: 'search-content',
          discoveryStatus: 'verified',
          verificationState: 'verified',
          evidenceKind: 'schema',
          evidenceRef: 'CapabilitySchema.search-content',
        },
        {
          id: 'test-search-capability',
          label: 'search-content',
          recognizedAs: 'search-content',
          discoveryStatus: 'verified',
          verificationState: 'verified',
          evidenceKind: 'test',
          evidenceRef: 'tests.search-content',
        },
        {
          id: 'policy-search-capability',
          label: 'search-content',
          recognizedAs: 'search-content',
          discoveryStatus: 'verified',
          verificationState: 'verified',
          evidenceKind: 'policy',
          evidenceRef: 'Policy.search-content',
        },
        {
          id: 'risk-search-capability',
          label: 'search-content',
          recognizedAs: 'search-content',
          discoveryStatus: 'verified',
          verificationState: 'verified',
          evidenceKind: 'risk',
          evidenceRef: 'Risk.search-content',
        },
        {
          id: 'approval-search-capability',
          label: 'search-content',
          recognizedAs: 'search-content',
          discoveryStatus: 'verified',
          verificationState: 'verified',
          evidenceKind: 'approval',
          evidenceRef: 'Approval.search-content',
        },
      ],
    },
  });
  const verifiedTarget = verifiedArtifacts.objects.CAPABILITY_TARGETS.targets
    .find((target) => target.targetId === 'search-content');
  assert.equal(verifiedTarget.discoveryState, 'verified');
  assert.equal(verifiedTarget.verificationState, 'verified');
  assert.equal(verifiedTarget.executableCapabilityAllowed, true);
  assert.equal(verifiedTarget.missingEvidenceKinds.length, 0);
  assert.equal(verifiedTarget.evidenceRequirementGaps.length, 0);
  assert.equal(verifiedArtifacts.objects.CAPABILITY_GAP_REPORT.gaps
    .some((gap) => gap.targetId === 'search-content'), false);
  assertNoSensitiveFixtureMaterial(observedOnlyArtifacts);
  assertNoSensitiveFixtureMaterial(verifiedArtifacts);
});

test('Capability evidence completion strategy records missing verified claim separately', () => {
  const artifacts = createSiteOnboardingDiscoveryArtifacts({
    siteKey: 'example',
    requestedCapabilities: ['search-content'],
    capabilityInventory: {
      entries: [
        {
          id: 'adapter-search-capability',
          label: 'search-content',
          recognizedAs: 'search-content',
          discoveryStatus: 'observed_only',
          verificationState: 'unverified',
          evidenceKind: 'adapter',
          evidenceRef: 'adapter:search-content?access_token=synthetic-query-token',
        },
        {
          id: 'schema-search-capability',
          label: 'search-content',
          recognizedAs: 'search-content',
          discoveryStatus: 'observed_only',
          verificationState: 'unverified',
          evidenceKind: 'schema',
          evidenceRef: 'schema:search-content',
        },
        {
          id: 'test-search-capability',
          label: 'search-content',
          recognizedAs: 'search-content',
          discoveryStatus: 'observed_only',
          verificationState: 'unverified',
          evidenceKind: 'test',
          evidenceRef: 'test:search-content',
        },
        {
          id: 'policy-search-capability',
          label: 'search-content',
          recognizedAs: 'search-content',
          discoveryStatus: 'observed_only',
          verificationState: 'unverified',
          evidenceKind: 'policy',
          evidenceRef: 'policy:search-content',
        },
        {
          id: 'risk-search-capability',
          label: 'search-content',
          recognizedAs: 'search-content',
          discoveryStatus: 'observed_only',
          verificationState: 'unverified',
          evidenceKind: 'risk',
          evidenceRef: 'risk:search-content',
        },
        {
          id: 'approval-search-capability',
          label: 'search-content',
          recognizedAs: 'search-content',
          discoveryStatus: 'observed_only',
          verificationState: 'unverified',
          evidenceKind: 'approval',
          evidenceRef: 'approval:search-content',
        },
      ],
    },
  });

  const target = artifacts.objects.CAPABILITY_TARGETS.targets
    .find((entry) => entry.targetId === 'search-content');
  assert.equal(target.discoveryState, 'observed_only');
  assert.equal(target.verificationState, 'unverified');
  assert.equal(target.executableCapabilityAllowed, false);
  assert.equal(target.missingEvidenceKinds.length, 0);
  assert.deepEqual(
    target.evidenceCompletionStrategy.requiredEvidenceStatuses,
    ['requires_verified_evidence_claim'],
  );
  assert.equal(target.evidenceCompletionStrategy.nextAction, 'collect-required-execution-evidence');

  const gap = artifacts.objects.CAPABILITY_GAP_REPORT.gaps
    .find((entry) => entry.targetId === 'search-content');
  assert.equal(gap.gapStatus, 'UNVERIFIED');
  assert.deepEqual(
    gap.evidenceCompletionStrategy.requiredEvidenceStatuses,
    ['requires_verified_evidence_claim'],
  );
  assert.equal(gap.executableCapabilityAllowed, false);
  assertNoSensitiveFixtureMaterial(artifacts);
});

test('Static SiteAdapter capability evidence can satisfy capability quorum without descriptor promotion', () => {
  const artifacts = createSiteOnboardingDiscoveryArtifacts({
    siteKey: 'example',
    requestedCapabilities: ['search-content'],
    adapter: adapterFromDecisions({
      capabilityEvidence: [
        {
          id: 'adapter-search-content',
          recognizedAs: 'search-content',
          discoveryStatus: 'verified',
          verificationState: 'verified',
          evidenceKind: 'adapter',
          evidenceRef: 'adapter:search-content?access_token=synthetic-query-token',
        },
        {
          id: 'schema-search-content',
          recognizedAs: 'search-content',
          discoveryStatus: 'verified',
          verificationState: 'verified',
          evidenceKind: 'schema',
          evidenceRef: 'schema:search-content',
        },
        {
          id: 'test-search-content',
          recognizedAs: 'search-content',
          discoveryStatus: 'verified',
          verificationState: 'verified',
          evidenceKind: 'test',
          evidenceRef: 'test:search-content',
        },
        {
          id: 'policy-search-content',
          recognizedAs: 'search-content',
          discoveryStatus: 'verified',
          verificationState: 'verified',
          evidenceKind: 'policy',
          evidenceRef: 'policy:search-content',
        },
        {
          id: 'risk-search-content',
          recognizedAs: 'search-content',
          discoveryStatus: 'verified',
          verificationState: 'verified',
          evidenceKind: 'risk',
          evidenceRef: 'risk:search-content',
        },
        {
          id: 'approval-search-content',
          recognizedAs: 'search-content',
          discoveryStatus: 'verified',
          verificationState: 'verified',
          evidenceKind: 'approval',
          evidenceRef: 'approval:search-content',
        },
      ],
    }),
  });

  const target = artifacts.objects.CAPABILITY_TARGETS.targets
    .find((entry) => entry.targetId === 'search-content');
  assert.equal(target.discoveryState, 'verified');
  assert.equal(target.verificationState, 'verified');
  assert.equal(target.executableCapabilityAllowed, true);
  assert.equal(target.mappingSummary.executableEvidenceCount, 6);
  assert.deepEqual(
    [...target.mappingSummary.mappedSourceKinds].sort(),
    ['adapter', 'approval', 'policy', 'risk', 'schema', 'test'],
  );
  assert.equal(target.evidenceRequirementGaps.length, 0);
  assert.equal(
    artifacts.objects.CAPABILITY_GAP_REPORT.gaps
      .some((gap) => gap.targetId === 'search-content'),
    false,
  );
  assert.equal(
    artifacts.objects.SITE_CAPABILITY_REPORT.discoveryScorecard.evidence.raw.capability.matchedTargetIds
      .includes('search-content'),
    true,
  );
  assertNoSensitiveFixtureMaterial(artifacts);
});

test('Fixture-backed SiteAdapter capability evidence can satisfy explicit quorum', () => {
  const artifacts = createSiteOnboardingDiscoveryArtifacts({
    siteKey: 'example',
    requestedCapabilities: ['search-content'],
    adapter: adapterFromDecisions({
      capabilityEvidenceFixtures: [
        {
          id: 'search-fixture-evidence',
          capability: 'search-content',
          discoveryStatus: 'verified',
          verificationState: 'verified',
          evidenceKinds: ['adapter', 'schema', 'test', 'policy', 'risk', 'approval'],
          adapterRef: 'adapter:search-content?access_token=synthetic-query-token',
          schemaRef: 'schema:search-content',
          testEvidenceRefs: ['tests:search-content'],
          policyRef: 'policy:search-content',
          riskRef: 'risk:search-content',
          approvalRef: 'approval:search-content',
        },
      ],
    }),
  });

  const target = artifacts.objects.CAPABILITY_TARGETS.targets
    .find((entry) => entry.targetId === 'search-content');
  assert.equal(target.discoveryState, 'verified');
  assert.equal(target.verificationState, 'verified');
  assert.equal(target.executableCapabilityAllowed, true);
  assert.deepEqual(
    [...target.mappingSummary.mappedSourceKinds].sort(),
    ['adapter', 'approval', 'policy', 'risk', 'schema', 'test'],
  );
  assert.equal(target.targetSources.some((source) => String(source.ref).includes('synthetic-query-token')), false);
  assert.equal(
    artifacts.objects.CAPABILITY_GAP_REPORT.gaps
      .some((gap) => gap.targetId === 'search-content'),
    false,
  );
  assertNoSensitiveFixtureMaterial(artifacts);
});

test('Fixture-backed capability evidence refs drop unsafe executable and identity material', () => {
  const artifacts = createSiteOnboardingDiscoveryArtifacts({
    siteKey: 'example',
    requestedCapabilities: ['search-content'],
    adapter: adapterFromDecisions({
      capabilityEvidenceFixtures: [
        {
          id: 'unsafe-fixture-evidence',
          capability: 'search-content',
          discoveryStatus: 'verified',
          verificationState: 'verified',
          evidenceKinds: ['adapter', 'schema', 'test', 'policy', 'risk', 'approval'],
          adapterRef: 'C:/Users/Alice/AppData/Local/BrowserProfile/Default',
          schemaRef: 'https://example.invalid/schema?access_token=synthetic-query-token',
          testEvidenceRefs: ['run-handler.mjs'],
          policyRef: 'policy:203.0.113.7',
          riskRef: 'https://example.invalid/risk?session_id=synthetic-session-id',
          approvalRef: 'approval:203.0.113.8',
        },
      ],
    }),
  });

  const target = artifacts.objects.CAPABILITY_TARGETS.targets
    .find((entry) => entry.targetId === 'search-content');
  assert.equal(target.discoveryState, 'verified');
  assert.equal(target.verificationState, 'verified');
  assert.equal(target.executableCapabilityAllowed, true);
  assert.equal(
    target.evidenceMappings.every((mapping) => mapping.sourceRef === 'redacted-evidence-ref'),
    true,
  );
  assert.equal(
    target.targetSources
      .filter((source) => ['adapter', 'schema', 'test', 'policy', 'risk', 'approval'].includes(source.kind))
      .every((source) => source.ref === 'redacted-evidence-ref'),
    true,
  );
  assert.equal(JSON.stringify(artifacts).includes('run-handler.mjs'), false);
  assertNoSensitiveFixtureMaterial(artifacts);
});

test('Fixture-backed capability evidence without verified claim stays non-executable', () => {
  const artifacts = createSiteOnboardingDiscoveryArtifacts({
    siteKey: 'example',
    requestedCapabilities: ['search-content'],
    adapter: adapterFromDecisions({
      capabilityEvidenceFixtures: [
        {
          id: 'observed-search-fixture-evidence',
          capability: 'search-content',
          discoveryStatus: 'observed_only',
          verificationState: 'unverified',
          evidenceKinds: ['adapter', 'schema', 'test', 'policy', 'risk', 'approval'],
          adapterRef: 'adapter:search-content?session_id=synthetic-session-id',
          schemaRef: 'schema:search-content',
          testEvidenceRefs: ['tests:search-content'],
          policyRef: 'policy:search-content',
          riskRef: 'risk:search-content',
          approvalRef: 'approval:search-content',
        },
      ],
    }),
  });

  const target = artifacts.objects.CAPABILITY_TARGETS.targets
    .find((entry) => entry.targetId === 'search-content');
  assert.equal(target.discoveryState, 'observed_only');
  assert.equal(target.verificationState, 'unverified');
  assert.equal(target.executableCapabilityAllowed, false);
  assert.equal(target.missingEvidenceKinds.length, 0);
  assert.deepEqual(
    target.evidenceCompletionStrategy.requiredEvidenceStatuses,
    ['requires_verified_evidence_claim'],
  );
  const gap = artifacts.objects.CAPABILITY_GAP_REPORT.gaps
    .find((entry) => entry.targetId === 'search-content');
  assert.equal(gap.gapStatus, 'UNVERIFIED');
  assert.equal(gap.executableCapabilityAllowed, false);
  assertNoSensitiveFixtureMaterial(artifacts);
});

test('Fixture-backed mixed verified and unverified evidence does not satisfy executable quorum', () => {
  const artifacts = createSiteOnboardingDiscoveryArtifacts({
    siteKey: 'example',
    requestedCapabilities: ['search-content'],
    adapter: adapterFromDecisions({
      capabilityEvidenceFixtures: [
        {
          id: 'verified-adapter-fixture-evidence',
          capability: 'search-content',
          discoveryStatus: 'verified',
          verificationState: 'verified',
          evidenceKinds: ['adapter'],
          adapterRef: 'adapter:search-content',
        },
        {
          id: 'unverified-support-fixture-evidence',
          capability: 'search-content',
          discoveryStatus: 'observed_only',
          verificationState: 'unverified',
          evidenceKinds: ['schema', 'test', 'policy', 'risk', 'approval'],
          schemaRef: 'schema:search-content',
          testEvidenceRefs: ['tests:search-content'],
          policyRef: 'policy:search-content',
          riskRef: 'risk:search-content',
          approvalRef: 'approval:search-content',
        },
      ],
    }),
  });

  const target = artifacts.objects.CAPABILITY_TARGETS.targets
    .find((entry) => entry.targetId === 'search-content');
  assert.equal(target.discoveryState, 'observed_only');
  assert.equal(target.verificationState, 'unverified');
  assert.equal(target.executableCapabilityAllowed, false);
  assert.deepEqual(target.mappingSummary.verifiedExecutionEvidenceKinds, ['adapter']);
  assert.equal(target.mappingSummary.executableEvidenceCount, 0);
  assert.deepEqual(
    target.evidenceCompletionStrategy.requiredEvidenceStatuses,
    ['requires_verified_evidence_claim'],
  );

  const gap = artifacts.objects.CAPABILITY_GAP_REPORT.gaps
    .find((entry) => entry.targetId === 'search-content');
  assert.equal(gap.gapStatus, 'UNVERIFIED');
  assert.equal(gap.executableCapabilityAllowed, false);
  assertNoSensitiveFixtureMaterial(artifacts);
});

test('Fixture-backed compound evidence kinds do not satisfy exact executable quorum', () => {
  const artifacts = createSiteOnboardingDiscoveryArtifacts({
    siteKey: 'example',
    requestedCapabilities: ['search-content'],
    adapter: adapterFromDecisions({
      capabilityEvidenceFixtures: [
        {
          id: 'compound-kind-fixture-evidence',
          capability: 'search-content',
          discoveryStatus: 'verified',
          verificationState: 'verified',
          evidenceKinds: ['adapter-schema-test-policy'],
          evidenceRef: 'compound:search-content',
        },
      ],
    }),
  });

  const target = artifacts.objects.CAPABILITY_TARGETS.targets
    .find((entry) => entry.targetId === 'search-content');
  assert.equal(target.discoveryState, 'observed_only');
  assert.equal(target.verificationState, 'unverified');
  assert.equal(target.executableCapabilityAllowed, false);
  assert.deepEqual(target.mappingSummary.verifiedExecutionEvidenceKinds, []);
  assert.deepEqual(
    [...target.missingEvidenceKinds].sort(),
    ['adapter', 'approval', 'policy', 'risk', 'schema', 'test'],
  );
  assert.deepEqual(
    target.evidenceRequirementGaps.map((entry) => entry.requiredEvidenceStatus).sort(),
    [
      'requires_adapter_evidence',
      'requires_approval_evidence',
      'requires_policy_evidence',
      'requires_risk_evidence',
      'requires_schema_evidence',
      'requires_test_evidence',
    ],
  );
  assertNoSensitiveFixtureMaterial(artifacts);
});

test('Partial static SiteAdapter capability evidence leaves missing quorum gaps', () => {
  const artifacts = createSiteOnboardingDiscoveryArtifacts({
    siteKey: 'example',
    requestedCapabilities: ['search-content'],
    adapter: adapterFromDecisions({
      capabilityEvidence: [
        {
          id: 'adapter-search-content',
          recognizedAs: 'search-content',
          discoveryStatus: 'verified',
          verificationState: 'verified',
          evidenceKind: 'adapter',
          evidenceRef: 'https://example.invalid/adapter/search?session_id=synthetic-session-id',
        },
      ],
    }),
  });

  const target = artifacts.objects.CAPABILITY_TARGETS.targets
    .find((entry) => entry.targetId === 'search-content');
  assert.equal(target.discoveryState, 'observed_only');
  assert.equal(target.verificationState, 'unverified');
  assert.equal(target.executableCapabilityAllowed, false);
  assert.equal(target.evidenceKinds.includes('adapter'), true);
  assert.equal(target.missingEvidenceKinds.includes('adapter'), false);
  assert.deepEqual(
    [...target.missingEvidenceKinds].sort(),
    ['approval', 'policy', 'risk', 'schema', 'test'],
  );
  assert.equal(target.mappingSummary.executableEvidenceCount, 0);

  const gap = artifacts.objects.CAPABILITY_GAP_REPORT.gaps
    .find((entry) => entry.targetId === 'search-content');
  assert.equal(gap.gapStatus, 'UNVERIFIED');
  assert.deepEqual(
    [...gap.missingEvidenceKinds].sort(),
    ['approval', 'policy', 'risk', 'schema', 'test'],
  );
  assert.deepEqual(
    gap.evidenceRequirementGaps.map((entry) => entry.requiredEvidenceStatus).sort(),
    [
      'requires_approval_evidence',
      'requires_policy_evidence',
      'requires_risk_evidence',
      'requires_schema_evidence',
      'requires_test_evidence',
    ],
  );
  assertNoSensitiveFixtureMaterial(artifacts);
});

test('Recognized capability summaries do not bypass adapter schema test policy risk and approval quorum', () => {
  const artifacts = createSiteOnboardingDiscoveryArtifacts({
    siteKey: 'example',
    requestedCapabilities: ['search-content'],
    capabilityCoverageSummary: {
      recognizedCapabilities: ['search-content'],
    },
  });

  const target = artifacts.objects.CAPABILITY_TARGETS.targets
    .find((entry) => entry.targetId === 'search-content');
  assert.equal(target.discoveryState, 'observed_only');
  assert.equal(target.verificationState, 'unverified');
  assert.equal(target.executableCapabilityAllowed, false);
  assert.equal(target.evidenceKinds.includes('recognized-summary'), true);
  assert.equal(target.missingEvidenceKinds.includes('adapter'), true);
  assert.equal(target.missingEvidenceKinds.includes('schema'), true);
  assert.equal(target.missingEvidenceKinds.includes('test'), true);
  assert.equal(target.missingEvidenceKinds.includes('policy'), true);
  assert.equal(target.missingEvidenceKinds.includes('risk'), true);
  assert.equal(target.missingEvidenceKinds.includes('approval'), true);

  const gap = artifacts.objects.CAPABILITY_GAP_REPORT.gaps
    .find((entry) => entry.targetId === 'search-content');
  assert.equal(gap.gapStatus, 'UNVERIFIED');
  assert.equal(gap.executableCapabilityAllowed, false);
  assert.deepEqual(gap.mappingGaps.map((mappingGap) => mappingGap.gapKind), ['missing-execution-evidence']);
  assert.deepEqual(
    gap.evidenceRequirementGaps.map((evidenceGap) => evidenceGap.requiredEvidenceStatus),
    [
      'requires_adapter_evidence',
      'requires_schema_evidence',
      'requires_test_evidence',
      'requires_policy_evidence',
      'requires_risk_evidence',
      'requires_approval_evidence',
    ],
  );
});

test('Capability gap requirement details redact unsafe requested capability targets', () => {
  const artifacts = createSiteOnboardingDiscoveryArtifacts({
    siteKey: 'example',
    requestedCapabilities: [
      'https://example.invalid/api/search?access_token=synthetic-query-token&session_id=synthetic-session-id',
      'Authorization: Bearer synthetic-api-auth',
      'C:/Users/Alice/AppData/Local/BrowserProfile',
    ],
  });

  const unsafeTargets = artifacts.objects.CAPABILITY_TARGETS.targets
    .filter((target) => target.targetId.includes('redacted'));
  assert.equal(unsafeTargets.length >= 2, true);
  assert.equal(unsafeTargets.every((target) => target.desiredState === 'required'), true);
  assert.equal(unsafeTargets.every((target) => target.verificationState === 'unverified'), true);
  assert.equal(unsafeTargets.every((target) => target.executableCapabilityAllowed === false), true);
  assert.equal(unsafeTargets.every((target) => target.evidenceRequirementGaps.length === 6), true);
  assert.equal(unsafeTargets.every((target) =>
    target.evidenceRequirementGaps.every((gap) =>
      gap.redactionRequired === true
      && gap.requiresManualReview === true
      && gap.gapKind === 'missing-required-evidence')), true);
  assert.equal(unsafeTargets.every((target) =>
    target.evidenceCompletionStrategy?.redactionRequired === true
    && target.evidenceCompletionStrategy?.descriptorOnly === true
    && target.evidenceCompletionStrategy?.executableCapabilityAllowed === false), true);
  assert.equal(
    unsafeTargets.every((target) =>
      !JSON.stringify(target.evidenceCompletionStrategy).includes('synthetic-query-token')),
    true,
  );

  const unsafeGaps = artifacts.objects.CAPABILITY_GAP_REPORT.gaps
    .filter((gap) => gap.targetId.includes('redacted'));
  assert.equal(unsafeGaps.length, unsafeTargets.length);
  assert.equal(unsafeGaps.every((gap) => gap.evidenceRequirementGapCount === 6), true);
  assert.equal(
    unsafeGaps.every((gap) =>
      gap.evidenceRequirementGaps.every((evidenceGap) =>
        evidenceGap.requiredEvidenceStatus.startsWith('requires_'))),
    true,
  );
  assert.equal(
    unsafeGaps.every((gap) => gap.evidenceCompletionStrategy.nextAction === 'collect-observed-and-required-evidence'),
    true,
  );
  assertNoSensitiveFixtureMaterial(artifacts);
});

test('Capability inference uses descriptor fields without executable promotion', () => {
  const artifacts = createSiteOnboardingDiscoveryArtifacts({
    siteKey: 'example',
    requestedCapabilities: ['search-content', 'open-content'],
    discoveredNodes: [
      {
        id: 'neutral-js-route',
        kind: 'js-route',
        label: 'neutral route',
        routePattern: '/works/:id',
        moduleHint: 'detail-view',
        required: true,
      },
    ],
    discoveredApis: [
      {
        id: 'neutral-api',
        method: 'GET',
        url: 'https://example.invalid/api/v1?access_token=synthetic-query-token',
        endpointKind: 'search-endpoint',
        roleHint: 'search',
        required: true,
      },
    ],
    adapter: adapterFromDecisions(),
  });

  const searchTarget = artifacts.objects.CAPABILITY_TARGETS.targets
    .find((entry) => entry.targetId === 'search-content');
  const contentTarget = artifacts.objects.CAPABILITY_TARGETS.targets
    .find((entry) => entry.targetId === 'open-content');

  assert.equal(searchTarget.discoveryState, 'observed_only');
  assert.equal(searchTarget.evidenceKinds.includes('api-inventory'), true);
  assert.equal(searchTarget.executableCapabilityAllowed, false);
  assert.equal(contentTarget.discoveryState, 'observed_only');
  assert.equal(contentTarget.evidenceKinds.includes('node-inventory'), true);
  assert.equal(contentTarget.executableCapabilityAllowed, false);
  assert.equal(
    artifacts.objects.CAPABILITY_GAP_REPORT.gaps
      .some((gap) => gap.targetId === 'open-content' && gap.gapStatus === 'UNVERIFIED'),
    true,
  );
  assertNoSensitiveFixtureMaterial(artifacts);
});

test('FullDiscoveryMode emits unknown, blocked, and capability gap artifacts', () => {
  const artifacts = createSiteOnboardingDiscoveryArtifacts({
    siteKey: 'example',
    discoveryMode: SiteOnboardingDiscoveryModule.SITE_ONBOARDING_EXHAUSTIVE_DISCOVERY_MODE,
    requestedCapabilities: ['download-content'],
    capabilityCoverageSummary: {
      requestedCapabilities: ['download-content'],
      unconfirmedCapabilities: ['search-content'],
    },
    discoveredNodes: [
      {
        id: 'login-wall',
        kind: 'login-state',
        required: true,
        locator: 'https://example.invalid/login?token=synthetic-login-token',
        status: 'requires_login',
        blockedSurface: 'login-wall',
        gapReason: 'requires login; Cookie: synthetic-cookie',
      },
      {
        id: 'budget-skip',
        kind: 'pagination-control',
        required: true,
        locator: '#next',
        status: 'skipped_by_budget',
        gapReason: 'budget exhausted at trigger 10',
      },
    ],
    discoveredApis: [
      {
        id: 'blocked-api',
        method: 'GET',
        required: true,
        url: 'https://example.invalid/api/private?auth=synthetic-api-auth',
        status: 'blocked',
        blockedSurface: 'permission-risk-endpoint',
        reason: 'paywall blocked',
      },
    ],
    adapter: adapterFromDecisions({
      nodes: {
        'login-wall': {
          classification: 'recognized',
          recognizedAs: 'login-state',
          required: true,
        },
        'budget-skip': {
          classification: 'recognized',
          recognizedAs: 'pagination-control',
          required: true,
        },
      },
      apis: {
        'blocked-api': {
          classification: 'recognized',
          recognizedAs: 'permission-risk-endpoint',
          required: true,
        },
      },
    }),
  });

  for (const artifactName of [
    'NODE_INVENTORY',
    'API_INVENTORY',
    'UNKNOWN_NODE_REPORT',
    'BLOCKED_NODE_REPORT',
    'UNKNOWN_API_REPORT',
    'BLOCKED_API_REPORT',
    'CAPABILITY_TARGETS',
    'CAPABILITY_GAP_REPORT',
    'SITE_CAPABILITY_REPORT',
    'DISCOVERY_AUDIT',
  ]) {
    assert.equal(Object.hasOwn(artifacts.objects, artifactName), true);
    assert.equal(Object.hasOwn(artifacts.markdown, artifactName), true);
  }

  assert.equal(artifacts.discoveryMode, SiteOnboardingDiscoveryModule.SITE_ONBOARDING_EXHAUSTIVE_DISCOVERY_MODE);
  assert.equal(artifacts.objects.BLOCKED_NODE_REPORT.entries.length, 2);
  assert.deepEqual(
    artifacts.objects.BLOCKED_NODE_REPORT.entries.map((entry) => entry.discoveryStatus).sort(),
    ['requires_login', 'skipped_by_budget'],
  );
  assert.equal(artifacts.objects.BLOCKED_API_REPORT.entries.length, 1);
  assert.equal(artifacts.objects.BLOCKED_API_REPORT.entries[0].discoveryStatus, 'blocked');
  for (const artifactName of Object.keys(artifacts.objects)) {
    assert.equal(artifacts.objects[artifactName].redactionRequired, true, `${artifactName} must require redaction`);
  }
  assert.equal(artifacts.objects.CAPABILITY_GAP_REPORT.requiredGaps >= 1, true);
  assert.equal(artifacts.objects.SITE_CAPABILITY_REPORT.summary.fullDiscoveryArtifactReady, true);
  assert.equal(artifacts.objects.SITE_CAPABILITY_REPORT.fullDiscoveryClosure.controlledScopeOnly, true);
  assert.equal(
    artifacts.objects.SITE_CAPABILITY_REPORT.fullDiscoveryClosure.reasonCode,
    'site-onboarding.full_discovery.controlled_scope_accounted',
  );
  assert.equal(artifacts.objects.SITE_CAPABILITY_REPORT.fullDiscoveryClosure.liveCoverageClaimed, false);
  assert.equal(artifacts.objects.SITE_CAPABILITY_REPORT.fullDiscoveryClosure.executionCoverageClaimed, false);
  assert.equal(artifacts.objects.SITE_CAPABILITY_REPORT.fullDiscoveryClosure.promotionAllowed, false);
  assert.equal(artifacts.objects.SITE_CAPABILITY_REPORT.fullDiscoveryClosure.realWorldExhaustiveCrawlClaimed, false);
  assert.equal(artifacts.objects.SITE_CAPABILITY_REPORT.fullDiscoveryClosure.inaccessibleSurfaceBypassAllowed, false);
  assert.equal(
    artifacts.objects.SITE_CAPABILITY_REPORT.fullDiscoveryClosure.artifactRefs
      .every((ref) => !/[\\/]|https?:/iu.test(ref)),
    true,
  );
  assert.equal(
    artifacts.objects.SITE_CAPABILITY_REPORT.fullDiscoveryClosure.unresolvedCounts.capabilityGaps >= 1,
    true,
  );
  assert.equal(
    artifacts.objects.SITE_CAPABILITY_REPORT.fullDiscoveryClosure.blockedCounts.nodes,
    2,
  );
  assert.equal(
    artifacts.objects.SITE_CAPABILITY_REPORT.fullDiscoveryClosure.accountingChecks.noSilentDropWithinControlledScope,
    true,
  );
  assert.equal(
    artifacts.objects.SITE_CAPABILITY_REPORT.fullDiscoveryClosure.accountingChecks.completionAllowed,
    false,
  );
  assert.equal(
    artifacts.objects.DISCOVERY_AUDIT.invariantChecks.controlledScopeClosureReady,
    true,
  );
  assert.equal(
    artifacts.objects.CAPABILITY_TARGETS.targets
      .find((target) => target.targetId === 'download-content')
      .executableCapabilityAllowed,
    false,
  );
  assert.equal(artifacts.objects.SITE_CAPABILITY_REPORT.modeSemantics.unboundedCrawlAllowed, false);
  assert.equal(artifacts.objects.SITE_CAPABILITY_REPORT.modeSemantics.accessControlBypassAllowed, false);
  assert.equal(artifacts.objects.SITE_CAPABILITY_REPORT.modeSemantics.observedApiAutoPromotionAllowed, false);
  assert.equal(artifacts.objects.SITE_CAPABILITY_REPORT.modeSemantics.observedCapabilityAutoPromotionAllowed, false);
  assert.equal(artifacts.gate.failures.includes('login-required-discovery-item'), true);
  assert.equal(artifacts.gate.failures.includes('budget-skipped-required-discovery-item'), true);
  assert.equal(artifacts.gate.failures.includes('blocked-required-discovery-item'), true);
  assertNoSensitiveFixtureMaterial(artifacts);
});

test('Blocked node surfaces carry descriptor-only classifications and category counts', () => {
  const artifacts = createSiteOnboardingDiscoveryArtifacts({
    siteKey: 'example',
    discoveredNodes: [
      {
        id: 'login-wall-node',
        label: 'Login wall',
        status: 'requires_login',
        blockedSurface: 'login wall',
        reason: 'authentication required',
        required: true,
      },
      {
        id: 'challenge-node',
        label: 'Challenge node',
        status: 'blocked',
        blockedSurface: 'CAPTCHA challenge Authorization: Bearer synthetic-node-token at https://example.invalid/private?session_id=synthetic-node-session',
        gapReason: 'Cookie: SESSDATA=synthetic-node-session C:/Users/Alice/AppData/Local/BrowserProfile/Default run-handler.mjs 203.0.113.44',
        required: true,
      },
      {
        id: 'budget-node',
        label: 'Budget skipped node',
        status: 'skipped_by_budget',
        blockedSurface: 'interaction expansion budget',
      },
      {
        id: 'unattempted-node',
        label: 'Unattempted node',
        status: 'unattempted',
        gapReason: 'trigger was not attempted',
      },
    ],
  });

  const blockedEntries = artifacts.objects.BLOCKED_NODE_REPORT.entries;
  const categories = blockedEntries.map((entry) => entry.blockedSurfaceClassification?.category).sort();
  assert.deepEqual(categories, [
    'budget_skipped',
    'captcha_or_challenge',
    'login_wall',
    'unattempted_trigger',
  ]);
  assert.deepEqual(artifacts.objects.BLOCKED_NODE_REPORT.surfaceCategoryCounts, {
    budget_skipped: 1,
    captcha_or_challenge: 1,
    login_wall: 1,
    unattempted_trigger: 1,
  });
  const loginClassification = blockedEntries
    .find((entry) => entry.id === 'login-wall-node')
    .blockedSurfaceClassification;
  assert.equal(loginClassification.accessBoundary, true);
  assert.equal(loginClassification.requiresManualReview, true);
  assert.equal(loginClassification.executableRouteAllowed, false);
  assert.equal(loginClassification.executableCapabilityAllowed, false);
  assert.equal(loginClassification.bypassProhibited, true);
  assert.equal(loginClassification.descriptorOnly, true);
  assert.equal(loginClassification.redactionRequired, true);
  assert.equal(loginClassification.reasonCode, 'site-onboarding.node.login_wall');
  assert.equal(loginClassification.followUpAction, 'record-blocked-surface-and-request-manual-review');

  const unattemptedClassification = blockedEntries
    .find((entry) => entry.id === 'unattempted-node')
    .blockedSurfaceClassification;
  assert.equal(unattemptedClassification.accessBoundary, false);
  assert.equal(unattemptedClassification.followUpAction, 'queue-governed-trigger-attempt');
  assert.equal(JSON.stringify(artifacts).includes('synthetic-node-token'), false);
  assert.equal(JSON.stringify(artifacts).includes('synthetic-node-session'), false);
  assert.equal(JSON.stringify(artifacts).includes('BrowserProfile'), false);
  assert.equal(JSON.stringify(artifacts).includes('run-handler.mjs'), false);
  assert.equal(JSON.stringify(artifacts).includes('203.0.113.44'), false);
  assertNoSensitiveFixtureMaterial(artifacts);
});

test('Site onboarding discovery records recognized, unknown, and ignored node/API states', () => {
  const artifacts = createSiteOnboardingDiscoveryArtifacts({
    siteKey: 'example',
    discoveredNodes: [
      discoveredNode('search-form', { nodeKind: 'form', required: true }),
      discoveredNode('pagination-next', { nodeKind: 'pagination' }),
      discoveredNode('decorative-banner'),
    ],
    discoveredApis: [
      discoveredApi('api-search', { required: true }),
      discoveredApi('api-related'),
      discoveredApi('api-telemetry'),
    ],
    adapter: adapterFromDecisions({
      nodes: {
        'search-form': {
          classification: 'recognized',
          recognizedAs: 'search',
          required: true,
        },
        'decorative-banner': {
          classification: 'ignored',
          reason: 'Decorative content does not provide a site capability.',
        },
      },
      apis: {
        'api-search': {
          classification: 'recognized',
          recognizedAs: 'content-search-api',
          required: true,
        },
        'api-telemetry': {
          classification: 'ignored',
          reason: 'Telemetry endpoint is outside onboarding coverage.',
        },
      },
    }),
  });

  const nodeEntries = artifacts.objects.NODE_INVENTORY.entries;
  const apiEntries = artifacts.objects.API_INVENTORY.entries;

  assert.deepEqual(
    nodeEntries.map((entry) => [entry.id, entry.classification]),
    [
      ['search-form', 'recognized'],
      ['pagination-next', 'unknown'],
      ['decorative-banner', 'ignored'],
    ],
  );
  assert.deepEqual(
    apiEntries.map((entry) => [entry.id, entry.classification]),
    [
      ['api-search', 'recognized'],
      ['api-related', 'unknown'],
      ['api-telemetry', 'ignored'],
    ],
  );
  assert.deepEqual(artifacts.objects.UNKNOWN_NODE_REPORT.nodes.map((entry) => entry.id), ['pagination-next']);
  assert.deepEqual(artifacts.objects.UNKNOWN_NODE_REPORT.apis.map((entry) => entry.id), ['api-related']);
});

test('Site onboarding discovery fails closed when ignored items have no reason', () => {
  assert.throws(
    () => createSiteOnboardingDiscoveryArtifacts({
      siteKey: 'example',
      discoveredNodes: [discoveredNode('footer')],
      adapter: adapterFromDecisions({
        nodes: {
          footer: {
            classification: 'ignored',
          },
        },
      }),
    }),
    /Ignored site onboarding discovery items must include a reason/u,
  );

  assert.throws(
    () => createSiteOnboardingDiscoveryArtifacts({
      siteKey: 'example',
      discoveredApis: [discoveredApi('api-noise')],
      adapter: adapterFromDecisions({
        apis: {
          'api-noise': {
            classification: 'ignored',
          },
        },
      }),
    }),
    /Ignored site onboarding discovery items must include a reason/u,
  );
});

test('Unknown required nodes and APIs enter UNKNOWN_NODE_REPORT and fail the coverage gate', () => {
  const artifacts = createSiteOnboardingDiscoveryArtifacts({
    siteKey: 'example',
    discoveredNodes: [
      discoveredNode('detail-entry', { required: true }),
      discoveredNode('pagination-next', { required: true }),
    ],
    discoveredApis: [
      discoveredApi('api-detail', { required: true }),
    ],
    adapter: adapterFromDecisions({
      nodes: {
        'detail-entry': {
          classification: 'recognized',
          recognizedAs: 'detail-entry',
          required: true,
        },
      },
    }),
  });

  const report = artifacts.objects.UNKNOWN_NODE_REPORT;
  assert.equal(report.schemaVersion, UNKNOWN_NODE_REPORT_SCHEMA_VERSION);
  assert.deepEqual(report.nodes.map((entry) => entry.id), ['pagination-next']);
  assert.deepEqual(report.apis.map((entry) => entry.id), ['api-detail']);
  assert.equal(artifacts.gate.unknownRequiredNodes, 1);
  assert.equal(artifacts.gate.unknownRequiredApis, 1);
  assert.equal(artifacts.gate.passed, false);
  assert.equal(artifacts.gate.failures.includes('unknown-required-node'), true);
  assert.equal(artifacts.gate.failures.includes('unknown-required-api'), true);
});

test('Completion gate requires coverage pass and Agent B acceptance', () => {
  const requiredNodes = Array.from({ length: 95 }, (_, index) =>
    discoveredNode(`required-node-${index + 1}`, { required: true }));
  const ignoredNodes = Array.from({ length: 5 }, (_, index) =>
    discoveredNode(`ignored-node-${index + 1}`, { required: false }));
  const adapter = adapterFromDecisions({
    nodes: Object.fromEntries([
      ...requiredNodes.map((entry) => [entry.id, {
        classification: 'recognized',
        recognizedAs: `capability:${entry.id}`,
        required: true,
      }]),
      ...ignoredNodes.map((entry) => [entry.id, {
        classification: 'ignored',
        reason: 'Not applicable to this site archetype after adapter review.',
        required: false,
      }]),
    ]),
  });
  const artifacts = createSiteOnboardingDiscoveryArtifacts({
    siteKey: 'example',
    discoveredNodes: [...requiredNodes, ...ignoredNodes],
    adapter,
  });

  assert.equal(artifacts.gate.requiredCoverageThreshold, SITE_ONBOARDING_REQUIRED_COVERAGE_THRESHOLD);
  assert.equal(artifacts.gate.requiredCoveragePass, true);
  assert.equal(artifacts.gate.passed, true);
  assert.equal(
    artifacts.objects.SITE_CAPABILITY_REPORT.fullDiscoveryClosure.accountingChecks.completionAllowed,
    true,
  );
  assert.equal(artifacts.markdown.SITE_CAPABILITY_REPORT.includes('controlledScopeClosureReady'), true);
  assert.equal(artifacts.markdown.DISCOVERY_AUDIT.includes('controlledScopeClosureReady'), true);
  assert.throws(
    () => assertSiteOnboardingDiscoveryComplete({ artifacts, acceptedByAgentB: false }),
    /Agent B acceptance is required/u,
  );
  assert.equal(assertSiteOnboardingDiscoveryComplete({ artifacts, acceptedByAgentB: true }), true);
});

test('Completion gate fails closed for required ignored nodes or APIs', () => {
  const artifacts = createSiteOnboardingDiscoveryArtifacts({
    siteKey: 'example',
    discoveredNodes: [discoveredNode('required-sidebar', { required: true })],
    discoveredApis: [discoveredApi('required-widget-api', { required: true })],
    adapter: adapterFromDecisions({
      nodes: {
        'required-sidebar': {
          classification: 'ignored',
          reason: 'Adapter attempted to ignore a required node.',
          required: true,
        },
      },
      apis: {
        'required-widget-api': {
          classification: 'ignored',
          reason: 'Adapter attempted to ignore a required API.',
          required: true,
        },
      },
    }),
  });

  assert.equal(artifacts.gate.requiredIgnoredNodes, 1);
  assert.equal(artifacts.gate.requiredIgnoredApis, 1);
  assert.equal(artifacts.gate.failures.includes('ignored-required-node'), true);
  assert.equal(artifacts.gate.failures.includes('ignored-required-api'), true);
  assert.throws(
    () => assertSiteOnboardingDiscoveryComplete({ artifacts, acceptedByAgentB: true }),
    /ignored-required-node|ignored-required-api/u,
  );
});

test('Completion gate requires the full required artifact set', () => {
  const artifacts = createSiteOnboardingDiscoveryArtifacts({
    siteKey: 'example',
    discoveredNodes: [discoveredNode('search-form', { required: true })],
    adapter: adapterFromDecisions({
      nodes: {
        'search-form': {
          classification: 'recognized',
          recognizedAs: 'search',
          required: true,
        },
      },
    }),
  });
  const incompleteObjects = {
    SITE_CAPABILITY_REPORT: artifacts.objects.SITE_CAPABILITY_REPORT,
    DISCOVERY_AUDIT: artifacts.objects.DISCOVERY_AUDIT,
  };

  assert.throws(
    () => assertSiteOnboardingDiscoveryComplete({
      artifacts: incompleteObjects,
      acceptedByAgentB: true,
    }),
    /missing required artifact NODE_INVENTORY/u,
  );
});

test('Login, permission, risk, restriction, recovery, and manual-risk nodes are not silently skipped', () => {
  const sensitiveNodes = [
    discoveredNode('login-state-banner', { nodeKind: 'login-state', required: true }),
    discoveredNode('permission-denied-page', { nodeKind: 'permission', required: true }),
    discoveredNode('risk-control-challenge', { nodeKind: 'risk-control', required: true }),
    discoveredNode('rate-limit-page', { nodeKind: 'limited-page', required: true }),
    discoveredNode('session-recovery-entry', { nodeKind: 'recovery-entry', required: true }),
    discoveredNode('manual-risk-intervention', { nodeKind: 'manual-risk', required: true }),
  ];
  const artifacts = createSiteOnboardingDiscoveryArtifacts({
    siteKey: 'example',
    discoveredNodes: sensitiveNodes,
    adapter: adapterFromDecisions(),
  });

  assert.deepEqual(
    artifacts.objects.UNKNOWN_NODE_REPORT.nodes.map((entry) => [
      entry.id,
      entry.nodeKind,
      entry.manualReviewRequired,
    ]),
    [
      ['login-state-banner', 'login-state', true],
      ['permission-denied-page', 'permission', true],
      ['risk-control-challenge', 'risk-control', true],
      ['rate-limit-page', 'limited-page', true],
      ['session-recovery-entry', 'recovery-entry', true],
      ['manual-risk-intervention', 'manual-risk', true],
    ],
  );
  assert.equal(artifacts.gate.failures.includes('manual-risk-node-unmapped'), true);
  assert.throws(
    () => assertSiteOnboardingDiscoveryComplete({ artifacts, acceptedByAgentB: true }),
    /manual-risk-node-unmapped/u,
  );
});

test('Discovery artifacts redact sensitive URL, header, and reason material', () => {
  const artifacts = createSiteOnboardingDiscoveryArtifacts({
    siteKey: 'example',
    discoveredNodes: [
      discoveredNode('login', {
        required: true,
        locator: 'https://example.invalid/login?access_token=synthetic-node-token&msToken=synthetic-ms-token&a_bogus=synthetic-abogus',
      }),
    ],
    discoveredApis: [
      discoveredApi('api-auth', {
        required: true,
        url: 'https://example.invalid/api/auth?csrf_token=synthetic-api-csrf&xsec_token=synthetic-xsec-token',
      }),
    ],
    adapter: adapterFromDecisions({
      nodes: {
        login: {
          classification: 'ignored',
          reason: 'Authorization: Bearer synthetic-node-auth profile_path=C:/Users/example/AppData/Local/BrowserProfile',
          required: true,
        },
      },
      apis: {
        'api-auth': {
          classification: 'ignored',
          reason: 'cookie: synthetic-api-cookie user_data_dir=C:/Users/example/AppData/Local/BrowserProfile',
          required: true,
        },
      },
    }),
  });

  const serialized = JSON.stringify(artifacts);
  assert.equal(serialized.includes('synthetic-node-token'), false);
  assert.equal(serialized.includes('synthetic-ms-token'), false);
  assert.equal(serialized.includes('synthetic-abogus'), false);
  assert.equal(serialized.includes('synthetic-api-csrf'), false);
  assert.equal(serialized.includes('synthetic-xsec-token'), false);
  assert.equal(serialized.includes('synthetic-node-auth'), false);
  assert.equal(serialized.includes('synthetic-api-cookie'), false);
  assert.equal(serialized.includes('C:/Users/example/AppData/Local/BrowserProfile'), false);
  assert.equal(serialized.includes(':/Users/example/AppData/Local/BrowserProfile'), false);
  assert.equal(serialized.includes('BrowserProfile'), false);
  assert.equal(serialized.includes('Bearer '), false);
});

test('Discovery service rejects unresolved async SiteAdapter decisions', () => {
  assert.throws(
    () => createSiteOnboardingDiscoveryArtifacts({
      siteKey: 'example',
      discoveredNodes: [discoveredNode('async-node')],
      adapter: {
        classifyNode: async () => ({
          classification: 'recognized',
          recognizedAs: 'async-node',
        }),
      },
    }),
    /adapter decisions must be resolved/u,
  );
});

test('Real capture and expand outputs produce redacted onboarding discovery inputs', () => {
  const fixture = createSyntheticCaptureExpandFixture();
  const inputs = createProducerInputsFromFixture(fixture);

  assert.equal(inputs.siteKey, 'synthetic-navigation');
  assert.equal(Array.isArray(inputs.discoveredNodes), true);
  assert.equal(Array.isArray(inputs.discoveredApis), true);

  const nodeSources = new Set(inputs.discoveredNodes.map((entry) => entry.source));
  assert.equal(nodeSources.has('capture-output'), true);
  assert.equal(nodeSources.has('expand-state'), true);
  assert.equal(nodeSources.has('expand-trigger'), true);
  assert.equal(inputs.discoveredNodes.some((entry) => entry.nodeKind === 'navigation-state'), true);
  assert.equal(inputs.discoveredNodes.some((entry) => entry.label === 'Synthetic Detail'), true);
  assert.equal(inputs.discoveredNodes.some((entry) => entry.label === 'Open Detail'), true);

  assert.deepEqual(
    inputs.discoveredApis.map((entry) => [entry.method, entry.source]),
    [
      ['GET', 'networkRequests'],
      ['POST', 'networkRequests'],
    ],
  );
  assert.equal(inputs.discoveredApis.every((entry) => entry.required === false), true);
  assertNoSensitiveFixtureMaterial(inputs);
});

test('Capture and expand pageFacts become inventory unknowns instead of being skipped', () => {
  const fixture = createSyntheticCaptureExpandFixture();
  const inputs = createProducerInputsFromFixture(fixture);
  const artifacts = createSiteOnboardingDiscoveryArtifacts({
    ...inputs,
    adapter: adapterFromDecisions(),
  });

  const nodeEntries = artifacts.objects.NODE_INVENTORY.entries;
  const unknownNodeEntries = artifacts.objects.UNKNOWN_NODE_REPORT.nodes;
  const factKinds = unknownNodeEntries
    .filter((entry) => entry.source === 'pageFacts')
    .map((entry) => entry.nodeKind)
    .sort();

  assert.deepEqual(factKinds, [
    'login-state',
    'login-state',
    'restriction-page',
    'restriction-page',
    'risk-control',
    'risk-control',
  ]);
  assert.equal(nodeEntries.some((entry) => entry.nodeKind === 'login-state'), true);
  assert.equal(nodeEntries.some((entry) => entry.nodeKind === 'restriction-page'), true);
  assert.equal(nodeEntries.some((entry) => entry.nodeKind === 'risk-control'), true);
  assert.equal(unknownNodeEntries.every((entry) => entry.classification === 'unknown'), true);
  assert.equal(artifacts.gate.failures.includes('unknown-required-node'), true);
  assertNoSensitiveFixtureMaterial(artifacts);
});

test('Runtime evidence, auth/session health, risk recovery, and warnings become discovery nodes', () => {
  const inputs = SiteOnboardingDiscoveryModule.createSiteOnboardingDiscoveryInputFromCaptureExpand({
    siteKey: 'synthetic-navigation',
    captureOutput: {
      finalUrl: 'https://example.invalid/home?access_token=synthetic-runtime-token',
      runtimeEvidence: {
        restrictionDetected: true,
        riskPageCode: 'synthetic-risk',
      },
      authSession: {
        status: 'required',
        browserProfilePath: 'C:/Users/example/AppData/Local/BrowserProfile',
      },
      sessionHealth: {
        status: 'stale',
      },
      riskRecovery: {
        status: 'blocked',
      },
      warnings: [
        'Authorization: Bearer synthetic-runtime-auth',
      ],
    },
    expandOutput: {
      summary: {
        budget: {
          stopReason: 'max-triggers',
        },
      },
      states: [],
    },
  });

  const nodeKinds = inputs.discoveredNodes.map((entry) => entry.nodeKind).sort();
  assert.equal(nodeKinds.includes('runtime-evidence'), true);
  assert.equal(nodeKinds.includes('login-state'), true);
  assert.equal(nodeKinds.includes('session-health'), true);
  assert.equal(nodeKinds.includes('recovery-entry'), true);
  assert.equal(nodeKinds.includes('coverage-budget'), true);
  assert.equal(nodeKinds.includes('empty-error-state'), true);
  const serialized = JSON.stringify(inputs);
  assert.equal(serialized.includes('synthetic-runtime-token'), false);
  assert.equal(serialized.includes('synthetic-runtime-auth'), false);
  assert.equal(serialized.includes('BrowserProfile'), false);
  assertNoSensitiveFixtureMaterial(inputs);
});

test('DOM and accessibility node summaries become redacted node inventory evidence', () => {
  const inputs = SiteOnboardingDiscoveryModule.createSiteOnboardingDiscoveryInputFromCaptureExpand({
    siteKey: 'synthetic-navigation',
    captureOutput: {
      finalUrl: 'https://example.invalid/home',
      domNodes: [
        {
          id: 'dom-search',
          tagName: 'form',
          role: 'search',
          selector: 'form[action="/search?access_token=synthetic-dom-token"]',
          textSnippet: `Authorization: Bearer synthetic-dom-auth ${'x'.repeat(220)}`,
          attributes: {
            action: '/search',
            authorization: 'Bearer synthetic-dom-auth',
            access_token: 'synthetic-dom-token',
          },
        },
      ],
      accessibilityNodes: [
        {
          id: 'a11y-open-settings',
          role: 'button',
          name: 'My Account Alice alice@example.com IP 203.0.113.7',
          locator: {
            role: 'button',
            href: 'https://example.invalid/settings?session_id=synthetic-a11y-session',
            textSnippet: 'Open Settings',
          },
        },
      ],
      unknownDomNodes: [
        {
          id: 'unknown-modal',
          tagName: 'dialog',
          reason: 'not-expanded',
        },
      ],
      blockedAccessibilityNodes: [
        {
          id: 'blocked-login-button',
          role: 'button',
          name: 'Login',
          status: 'requires_login',
          blockedSurface: 'login-wall',
        },
      ],
      budgetSkippedDomNodes: [
        {
          id: 'budget-skipped-panel',
          tagName: 'section',
        },
      ],
      policySkippedDomNodes: [
        {
          id: 'policy-skipped-panel',
          tagName: 'section',
        },
      ],
      unattemptedAccessibilityNodes: [
        {
          id: 'unattempted-tab',
          role: 'tab',
          name: 'Reviews',
        },
      ],
    },
    expandOutput: {
      states: [
        {
          stateId: 's-dom-a11y',
          finalUrl: 'https://example.invalid/detail',
          domNodeSummaries: [
            {
              id: 'state-content-card',
              tagName: 'article',
              selector: 'article[data-id="42"]',
            },
          ],
          a11yNodeSummaries: [
            {
              id: 'state-download-link',
              role: 'link',
              name: 'Download',
              locator: {
                href: 'https://example.invalid/download?token=synthetic-state-token',
              },
              children: [
                {
                  id: 'state-download-icon',
                  role: 'img',
                  name: 'Download icon',
                },
              ],
            },
          ],
        },
      ],
    },
  });

  const artifacts = createSiteOnboardingDiscoveryArtifacts({
    ...inputs,
    adapter: adapterFromDecisions(),
  });

  const entries = artifacts.objects.NODE_INVENTORY.entries
    .filter((entry) => [
      'domNodes',
      'accessibilityNodes',
      'unknownDomNodes',
      'blockedAccessibilityNodes',
      'budgetSkippedDomNodes',
      'policySkippedDomNodes',
      'unattemptedAccessibilityNodes',
    ].includes(entry.source));
  assert.equal(entries.length, 10);
  assert.equal(entries.some((entry) => entry.source === 'domNodes' && entry.tagName === 'form'), true);
  assert.equal(entries.some((entry) => entry.source === 'accessibilityNodes' && entry.role === 'button'), true);
  assert.equal(entries.some((entry) => entry.source === 'unknownDomNodes' && entry.discoveryStatus === 'unknown'), true);
  assert.equal(
    entries.some((entry) => entry.source === 'blockedAccessibilityNodes' && entry.discoveryStatus === 'requires_login'),
    true,
  );
  assert.equal(entries.some((entry) => entry.discoveryStatus === 'skipped_by_budget'), true);
  assert.equal(entries.some((entry) => entry.discoveryStatus === 'skipped_by_policy'), true);
  assert.equal(entries.some((entry) => entry.discoveryStatus === 'unattempted'), true);
  assert.equal(entries.every((entry) => entry.verificationState !== 'verified'), true);
  assert.equal(entries.every((entry) => String(entry.label ?? '').length <= 120), true);
  assert.equal(entries.every((entry) => String(entry.textSnippet ?? '').length <= 120), true);
  assert.equal(entries.some((entry) => entry.attributeNames?.includes('action')), true);
  assert.equal(entries.some((entry) => entry.attributeNames?.includes('authorization')), false);
  assert.equal(entries.some((entry) => entry.attributeNames?.includes('access_token')), false);
  assert.equal(artifacts.objects.UNKNOWN_NODE_REPORT.nodes.length >= entries.length, true);
  assert.equal(
    artifacts.objects.BLOCKED_NODE_REPORT.entries
      .some((entry) => entry.id.includes('blocked-login-button')),
    true,
  );
  assert.equal(artifacts.objects.NODE_INVENTORY.redactionRequired, true);
  assertNoSensitiveFixtureMaterial(inputs);
  assertNoSensitiveFixtureMaterial(artifacts);
});

test('Generic raw DOM node evidence cannot self-promote or persist sensitive attribute names', () => {
  const artifacts = createSiteOnboardingDiscoveryArtifacts({
    siteKey: 'synthetic-navigation',
    discoveredNodes: [
      {
        id: 'raw-dom-node',
        label: 'My Account Alice alice@example.com IP 203.0.113.7',
        locator: 'form[action="/search?access_token=synthetic-dom-token"]',
        nodeEvidenceKind: 'domNodes',
        status: 'verified',
        verificationState: 'verified',
        attributeNames: ['authorization', 'access_token', 'action'],
        required: true,
      },
      {
        id: 'markerless-raw-node',
        label: 'Profile Alice',
        locator: 'button[data-kind="profile"]',
        tagName: 'button',
        role: 'button',
        status: 'verified',
        verificationState: 'verified',
        attributeNames: ['authorization', 'action'],
        required: true,
      },
    ],
    adapter: adapterFromDecisions(),
  });

  const entries = artifacts.objects.NODE_INVENTORY.entries;
  assert.equal(entries.length, 2);
  assert.equal(entries.every((entry) => entry.discoveryStatus === 'observed_only'), true);
  assert.equal(entries.every((entry) => entry.verificationState === 'unverified'), true);
  assert.deepEqual(entries.map((entry) => entry.attributeNames), [['action'], ['action']]);
  assert.equal(artifacts.objects.UNKNOWN_NODE_REPORT.nodes.length, 2);
  assert.equal(artifacts.objects.BLOCKED_NODE_REPORT.entries.length, 0);
  assertNoSensitiveFixtureMaterial(artifacts);
});

test('JS route lazy route and dynamic import summaries become redacted non-executable node evidence', () => {
  const inputs = SiteOnboardingDiscoveryModule.createSiteOnboardingDiscoveryInputFromCaptureExpand({
    siteKey: 'synthetic-navigation',
    captureOutput: {
      finalUrl: 'https://example.invalid/home',
      jsRoutes: [
        {
          id: 'home-route',
          routePath: '/home?access_token=synthetic-js-token',
          routePattern: '/home/:tab',
          label: 'Home Route',
          status: 'verified',
        },
      ],
      dynamicImports: [
        {
          id: 'import-settings',
          importSpecifier: './chunks/settings?token=synthetic-import-token',
          chunkUrl: 'https://example.invalid/assets/settings.js?session_id=synthetic-chunk-session',
          importKind: 'literal',
        },
      ],
      blockedJsRoutes: [
        {
          id: 'vip-route',
          routePath: '/vip',
          status: 'blocked',
          blockedSurface: 'paywall',
        },
      ],
      failedDynamicImports: [
        {
          id: 'failed-import',
          importSpecifier: './chunks/failed',
          reason: 'parse-failed',
        },
      ],
    },
    expandOutput: {
      states: [
        {
          stateId: 's-js-route',
          finalUrl: 'https://example.invalid/app',
          lazyRouteCandidates: [
            {
              id: 'lazy-detail',
              routePath: '/detail/:id',
              moduleId: 'detail-view',
              status: 'observed',
            },
          ],
          unattemptedJsRoutes: [
            {
              id: 'settings-route',
              routePath: '/settings',
              reason: 'not-triggered',
            },
          ],
        },
      ],
    },
  });

  const artifacts = createSiteOnboardingDiscoveryArtifacts({
    ...inputs,
    adapter: adapterFromDecisions(),
  });

  const routeEntries = artifacts.objects.NODE_INVENTORY.entries
    .filter((entry) => [
      'jsRoutes',
      'dynamicImports',
      'blockedJsRoutes',
      'lazyRoutes',
      'unattemptedJsRoutes',
      'failedDynamicImports',
    ].includes(entry.source));

  assert.equal(routeEntries.length, 6);
  assert.equal(routeEntries.some((entry) => entry.nodeKind === 'js-route'), true);
  assert.equal(routeEntries.some((entry) => entry.nodeKind === 'dynamic-import'), true);
  assert.equal(routeEntries.some((entry) => entry.nodeKind === 'lazy-route'), true);
  assert.equal(routeEntries.every((entry) => entry.verificationState !== 'verified'), true);
  assert.equal(
    routeEntries.some((entry) => entry.source === 'jsRoutes' && entry.discoveryStatus === 'observed_only'),
    true,
  );
  assert.equal(
    routeEntries.some((entry) => entry.source === 'blockedJsRoutes' && entry.discoveryStatus === 'blocked'),
    true,
  );
  assert.equal(
    routeEntries.some((entry) => entry.source === 'unattemptedJsRoutes' && entry.discoveryStatus === 'unattempted'),
    true,
  );
  assert.equal(
    routeEntries.some((entry) => entry.source === 'failedDynamicImports' && entry.discoveryStatus === 'failed_trigger'),
    true,
  );
  assert.equal(artifacts.objects.UNKNOWN_NODE_REPORT.nodes.length >= routeEntries.length, true);
  assert.equal(
    artifacts.objects.BLOCKED_NODE_REPORT.entries
      .some((entry) => entry.source === 'blockedJsRoutes'),
    true,
  );
  assert.equal(
    artifacts.objects.BLOCKED_NODE_REPORT.entries
      .some((entry) => entry.source === 'unattemptedJsRoutes'),
    true,
  );
  assert.equal(
    artifacts.objects.SITE_CAPABILITY_REPORT.modeSemantics.observedCapabilityAutoPromotionAllowed,
    false,
  );
  assert.equal(
    artifacts.objects.CAPABILITY_TARGETS.targets
      .some((target) => target.executableCapabilityAllowed === true),
    false,
  );
  assertNoSensitiveFixtureMaterial(inputs);
  assertNoSensitiveFixtureMaterial(artifacts);
});

test('JS route evidence rejects raw source and nested session header material', () => {
  assert.throws(
    () => SiteOnboardingDiscoveryModule.createSiteOnboardingDiscoveryInputFromCaptureExpand({
      siteKey: 'synthetic-navigation',
      captureOutput: {
        finalUrl: 'https://example.invalid/home',
        jsRouteCandidates: [
          {
            id: 'unsafe-route',
            routePath: '/unsafe',
            rawSource: 'import("https://example.invalid/chunk.js?token=synthetic-js-token")',
          },
        ],
      },
    }),
    /Unsafe JS route discovery evidence field: jsRoutes\.rawSource/u,
  );

  assert.throws(
    () => SiteOnboardingDiscoveryModule.createSiteOnboardingDiscoveryInputFromCaptureExpand({
      siteKey: 'synthetic-navigation',
      captureOutput: {
        finalUrl: 'https://example.invalid/home',
        dynamicImportCandidates: [
          {
            id: 'unsafe-import',
            importSpecifier: './chunk',
            request: {
              headers: {
                authorization: 'Bearer synthetic-js-token',
              },
            },
          },
        ],
      },
    }),
    /Unsafe JS route discovery evidence field: dynamicImports\.request\.headers/u,
  );

  for (const forbiddenField of ['sessionCookie', 'sessionMaterial', 'profileRoot', 'profileHandle']) {
    assert.throws(
      () => SiteOnboardingDiscoveryModule.createSiteOnboardingDiscoveryInputFromCaptureExpand({
        siteKey: 'synthetic-navigation',
        captureOutput: {
          finalUrl: 'https://example.invalid/home',
          lazyRouteCandidates: [
            {
              id: `unsafe-${forbiddenField}`,
              routePath: '/unsafe',
              [forbiddenField]: 'synthetic-js-token',
            },
          ],
        },
      }),
      new RegExp(`Unsafe JS route discovery evidence field: lazyRoutes\\.${forbiddenField}`, 'u'),
    );
  }
});

test('Expand trigger outcome inventories become node gap artifacts with distinct statuses', () => {
  const inputs = SiteOnboardingDiscoveryModule.createSiteOnboardingDiscoveryInputFromCaptureExpand({
    siteKey: 'synthetic-navigation',
    expandOutput: {
      states: [],
      candidateTriggers: [
        {
          kind: 'menu-button',
          label: 'Open Menu',
          locator: {
            role: 'button',
            ariaControls: 'menu-panel',
            domPath: 'body > button:nth-of-type(1)',
            textSnippet: 'Open Menu',
          },
        },
      ],
      policySkippedTriggers: [
        {
          kind: 'safe-nav-link',
          label: 'Terms',
          attempted: false,
          attemptCount: 0,
          governedAttempt: true,
          href: 'https://example.invalid/terms?token=synthetic-trigger-token',
          locator: {
            role: 'link',
            href: 'https://example.invalid/terms?token=synthetic-trigger-token',
            textSnippet: 'Terms',
          },
        },
      ],
      budgetSkippedTriggers: [
        {
          kind: 'pagination-link',
          label: 'Next',
          attempted: false,
          attemptCount: 0,
          governedAttempt: true,
          href: 'https://example.invalid/page/2?csrf_token=synthetic-trigger-csrf',
          locator: {
            role: 'link',
            href: 'https://example.invalid/page/2?csrf_token=synthetic-trigger-csrf',
            textSnippet: 'Next',
          },
        },
      ],
      unattemptedTriggers: [
        {
          kind: 'tab',
          label: 'Reviews',
          attempted: false,
          attemptCount: 0,
          locator: {
            role: 'tab',
            ariaControls: 'reviews-panel',
            textSnippet: 'Reviews',
          },
        },
      ],
      failedTriggers: [
        {
          kind: 'dialog-open',
          label: 'Preview',
          status: 'failed_trigger',
          reasonCode: 'TRIGGER_EXECUTION_FAILED',
          reason: 'Authorization: Bearer synthetic-trigger-token',
          attempted: true,
          attemptCount: 1,
          governedAttempt: true,
          retryExecuted: false,
          locator: {
            role: 'button',
            textSnippet: 'Preview',
          },
        },
      ],
      duplicateTriggers: [
        {
          kind: 'content-link',
          label: 'Duplicate Detail',
          attempted: false,
          attemptCount: 0,
          href: 'https://example.invalid/detail/1?session_id=synthetic-trigger-session',
          locator: {
            role: 'link',
            href: 'https://example.invalid/detail/1?session_id=synthetic-trigger-session',
            textSnippet: 'Duplicate Detail',
          },
        },
      ],
    },
  });

  const artifacts = createSiteOnboardingDiscoveryArtifacts({
    ...inputs,
    adapter: adapterFromDecisions(),
  });

  const triggerEntries = artifacts.objects.NODE_INVENTORY.entries
    .filter((entry) => String(entry.source ?? '').includes('trigger'));
  const statuses = new Set(triggerEntries.map((entry) => entry.discoveryStatus));
  assert.equal(statuses.has('discovered'), true);
  assert.equal(statuses.has('skipped_by_policy'), true);
  assert.equal(statuses.has('skipped_by_budget'), true);
  assert.equal(statuses.has('unattempted'), true);
  assert.equal(statuses.has('failed_trigger'), true);
  assert.equal(statuses.has('duplicate_trigger'), true);
  const triggerEntryByStatus = (status) => triggerEntries.find((entry) => entry.discoveryStatus === status);
  assert.deepEqual(
    [
      triggerEntryByStatus('skipped_by_policy').followUpStrategy.action,
      triggerEntryByStatus('skipped_by_budget').followUpStrategy.action,
      triggerEntryByStatus('unattempted').followUpStrategy.action,
      triggerEntryByStatus('failed_trigger').followUpStrategy.action,
      triggerEntryByStatus('duplicate_trigger').followUpStrategy.action,
    ],
    [
      'respect-policy-stop-and-record-gap',
      'retry-with-expanded-controlled-budget',
      'attempt-in-next-controlled-discovery-pass',
      'classify-failure-before-retry',
      'merge-with-existing-trigger-evidence',
    ],
  );
  assert.equal(triggerEntryByStatus('skipped_by_budget').followUpStrategy.retryAllowed, true);
  assert.equal(triggerEntryByStatus('unattempted').followUpStrategy.retryAllowed, true);
  assert.equal(triggerEntryByStatus('failed_trigger').followUpStrategy.requiresManualReview, true);
  assert.equal(triggerEntryByStatus('duplicate_trigger').followUpStrategy.retryAllowed, false);
  assert.equal(triggerEntryByStatus('failed_trigger').attemptResult.attempted, true);
  assert.equal(triggerEntryByStatus('failed_trigger').attemptResult.attemptCount, 1);
  assert.equal(triggerEntryByStatus('failed_trigger').attemptResult.governedAttempt, true);
  assert.equal(triggerEntryByStatus('failed_trigger').attemptResult.retryExecuted, false);
  assert.equal(triggerEntryByStatus('unattempted').attemptResult.attempted, false);
  assert.equal(triggerEntryByStatus('unattempted').attemptResult.lastAttemptStatus, 'unattempted');
  assert.equal(triggerEntryByStatus('skipped_by_budget').attemptResult.lastAttemptStatus, 'skipped_by_budget');
  assert.equal(triggerEntryByStatus('skipped_by_policy').attemptResult.governedAttempt, true);
  assert.equal(
    ['skipped_by_policy', 'skipped_by_budget', 'unattempted', 'failed_trigger', 'duplicate_trigger']
      .every((status) => triggerEntryByStatus(status).followUpStrategy.redactionRequired === true
        && triggerEntryByStatus(status).followUpStrategy.descriptorOnly === true
        && triggerEntryByStatus(status).attemptResult.redactionRequired === true
        && triggerEntryByStatus(status).attemptResult.descriptorOnly === true),
    true,
  );
  assert.equal(artifacts.objects.UNKNOWN_NODE_REPORT.nodes.length >= triggerEntries.length, true);
  assert.equal(
    artifacts.objects.BLOCKED_NODE_REPORT.entries.some((entry) => entry.discoveryStatus === 'unattempted'),
    true,
  );
  assert.equal(
    artifacts.objects.BLOCKED_NODE_REPORT.entries.some((entry) => entry.discoveryStatus === 'failed_trigger'),
    true,
  );
  assert.equal(
    artifacts.objects.BLOCKED_NODE_REPORT.entries
      .some((entry) => entry.followUpStrategy?.action === 'classify-failure-before-retry'),
    true,
  );
  assert.equal(artifacts.gate.failures.includes('unattempted-required-discovery-item'), true);
  assert.equal(artifacts.gate.failures.includes('failed-trigger-required-discovery-item'), true);
  assert.equal(artifacts.gate.failures.includes('duplicate-trigger-required-discovery-item'), true);
  assertNoSensitiveFixtureMaterial(inputs);
  assertNoSensitiveFixtureMaterial(artifacts);
});

test('Trigger follow-up strategies are descriptor-only and drop unsafe runtime refs', () => {
  const nodeInventory = SiteOnboardingDiscoveryModule.createNodeInventory([
    {
      id: 'unsafe-trigger-follow-up',
      kind: 'button',
      label: 'Unsafe Follow Up',
      locator: 'https://example.invalid/action?access_token=synthetic-trigger-token&session_id=synthetic-trigger-session',
      status: 'unattempted',
      discoveryStatus: 'unattempted',
      followUpStrategy: {
        schemaVersion: SITE_ONBOARDING_DISCOVERY_SCHEMA_VERSION,
        gapKind: 'interaction-trigger-gap',
        discoveryStatus: 'unattempted',
        action: 'attempt-in-next-controlled-discovery-pass',
        retryClass: 'safe-trigger-attempt',
        retryAllowed: true,
        requiresManualReview: false,
        reasonCode: 'unattempted',
        descriptorOnly: true,
        redactionRequired: true,
        href: 'https://example.invalid/action?access_token=synthetic-trigger-token',
        headers: {
          authorization: 'Bearer synthetic-trigger-token',
          cookie: 'SESSDATA=synthetic-trigger-session',
        },
        body: {
          csrf_token: 'synthetic-trigger-csrf',
        },
        browserProfile: 'C:/Users/example/AppData/Local/BrowserProfile',
        command: 'run-handler.mjs',
      },
    },
  ], {
    siteKey: 'synthetic-navigation',
    adapter: adapterFromDecisions(),
  });
  const [entry] = nodeInventory.entries;
  const strategy = entry.followUpStrategy;

  assert.equal(strategy.action, 'attempt-in-next-controlled-discovery-pass');
  assert.equal(strategy.retryClass, 'safe-trigger-attempt');
  assert.equal(strategy.retryAllowed, true);
  assert.equal(strategy.descriptorOnly, true);
  assert.equal(strategy.redactionRequired, true);
  assert.equal(Object.hasOwn(strategy, 'href'), false);
  assert.equal(Object.hasOwn(strategy, 'headers'), false);
  assert.equal(Object.hasOwn(strategy, 'body'), false);
  assert.equal(Object.hasOwn(strategy, 'browserProfile'), false);
  assert.equal(Object.hasOwn(strategy, 'command'), false);
  assert.equal(JSON.stringify(nodeInventory).includes('run-handler.mjs'), false);
  assertNoSensitiveFixtureMaterial(nodeInventory);
});

test('Trigger attempt results are descriptor-only and drop unsafe runtime refs', () => {
  const nodeInventory = SiteOnboardingDiscoveryModule.createNodeInventory([
    {
      id: 'unsafe-trigger-attempt',
      kind: 'button',
      label: 'Unsafe Attempt',
      locator: 'https://example.invalid/action?access_token=synthetic-trigger-token&session_id=synthetic-trigger-session',
      status: 'failed_trigger',
      discoveryStatus: 'failed_trigger',
      attemptResult: {
        attempted: true,
        attemptCount: 250,
        lastAttemptStatus: 'failed_trigger',
        reasonCode: 'TRIGGER_EXECUTION_FAILED',
        governedAttempt: true,
        retryExecuted: false,
        href: 'https://example.invalid/action?access_token=synthetic-trigger-token',
        headers: {
          authorization: 'Bearer synthetic-trigger-token',
          cookie: 'SESSDATA=synthetic-trigger-session',
        },
        body: {
          csrf_token: 'synthetic-trigger-csrf',
        },
        browserProfile: 'C:/Users/example/AppData/Local/BrowserProfile',
        command: 'run-handler.mjs',
      },
    },
  ], {
    siteKey: 'synthetic-navigation',
    adapter: adapterFromDecisions(),
  });
  const [entry] = nodeInventory.entries;
  const attempt = entry.attemptResult;

  assert.equal(attempt.attempted, true);
  assert.equal(attempt.attemptCount, 100);
  assert.equal(attempt.lastAttemptStatus, 'failed_trigger');
  assert.equal(attempt.governedAttempt, true);
  assert.equal(attempt.retryExecuted, false);
  assert.equal(attempt.descriptorOnly, true);
  assert.equal(attempt.redactionRequired, true);
  assert.equal(Object.hasOwn(attempt, 'href'), false);
  assert.equal(Object.hasOwn(attempt, 'headers'), false);
  assert.equal(Object.hasOwn(attempt, 'body'), false);
  assert.equal(Object.hasOwn(attempt, 'browserProfile'), false);
  assert.equal(Object.hasOwn(attempt, 'command'), false);
  assert.equal(JSON.stringify(nodeInventory).includes('run-handler.mjs'), false);
  assertNoSensitiveFixtureMaterial(nodeInventory);
});

test('Network requests from capture output become API inventory unknowns with redacted endpoints', () => {
  const fixture = createSyntheticCaptureExpandFixture();
  const inputs = createProducerInputsFromFixture(fixture);
  const artifacts = createSiteOnboardingDiscoveryArtifacts({
    ...inputs,
    adapter: adapterFromDecisions(),
  });

  const apiEntries = artifacts.objects.API_INVENTORY.entries;
  assert.equal(apiEntries.length, 2);
  assert.deepEqual(
    apiEntries.map((entry) => [entry.method, entry.classification, entry.source]),
    [
      ['GET', 'unknown', 'networkRequests'],
      ['POST', 'unknown', 'networkRequests'],
    ],
  );
  assert.equal(artifacts.objects.UNKNOWN_NODE_REPORT.apis.length, 2);
  assert.equal(apiEntries.every((entry) => !String(entry.locator).includes('synthetic-')), true);
  assert.equal(apiEntries.every((entry) => String(entry.locator).includes('[REDACTED]')), true);
  assertNoSensitiveFixtureMaterial(artifacts.markdown.API_INVENTORY);
});

test('Network transport surfaces remain observed-only API inventory evidence', () => {
  const inputs = SiteOnboardingDiscoveryModule.createSiteOnboardingDiscoveryInputFromCaptureExpand({
    siteKey: 'synthetic-navigation',
    networkRequests: [
      {
        id: 'synthetic-websocket',
        method: 'GET',
        url: 'wss://example.invalid/socket?access_token=synthetic-websocket-token',
        transport: 'websocket',
        resourceType: 'WebSocket',
        status: 'observed',
        evidence: {
          transport: 'websocket',
          resourceType: 'WebSocket',
        },
      },
      {
        id: 'synthetic-sse',
        method: 'GET',
        url: 'https://example.invalid/events?session_id=synthetic-sse-session',
        resourceType: 'EventSource',
        status: 'observed',
        evidence: {
          transport: 'sse',
          resourceType: 'EventSource',
        },
      },
      {
        id: 'synthetic-preflight',
        method: 'OPTIONS',
        url: 'https://example.invalid/api/items?csrf_token=synthetic-preflight-csrf',
        resourceType: 'Preflight',
        status: 'observed',
        evidence: {
          transport: 'preflight',
          resourceType: 'Preflight',
          preflight: true,
          preflightCorrelation: {
            status: 'correlated_observed_request',
            canonicalEndpointPathKey: 'synthetic-navigation:example.invalid/api/items',
            followUpCandidateIds: ['synthetic-follow-up'],
            observedOnly: true,
            catalogPromotionAllowed: false,
            redactionRequired: true,
          },
        },
      },
      {
        id: 'synthetic-follow-up',
        method: 'POST',
        url: 'https://example.invalid/api/items?access_token=synthetic-follow-up-token',
        resourceType: 'XHR',
        status: 'observed',
        target: {
          transport: 'http',
          preflightObserved: true,
          preflightCorrelation: {
            status: 'preflight_observed',
            canonicalEndpointPathKey: 'synthetic-navigation:example.invalid/api/items',
            preflightCandidateIds: ['synthetic-preflight'],
            observedOnly: true,
            catalogPromotionAllowed: false,
            redactionRequired: true,
          },
        },
        evidence: {
          transport: 'http',
          resourceType: 'XHR',
        },
      },
      {
        id: 'synthetic-redirect',
        method: 'GET',
        url: 'https://example.invalid/api/redirected',
        transport: 'http',
        resourceType: 'Document',
        status: 'observed',
        evidence: {
          transport: 'http',
          resourceType: 'Document',
          redirect: {
            statusCode: 302,
            url: 'https://example.invalid/login?access_token=synthetic-redirect-token',
            mimeType: 'text/html',
            headers: {
              cookie: 'SESSDATA=synthetic-redirect-sessdata',
            },
          },
        },
      },
    ],
  });
  const artifacts = createSiteOnboardingDiscoveryArtifacts({
    ...inputs,
    adapter: adapterFromDecisions(),
  });

  const entries = artifacts.objects.API_INVENTORY.entries;
  assert.equal(entries.length, 5);
  assert.deepEqual(
    entries.map((entry) => [entry.id, entry.discoveryStatus, entry.verificationState]),
    [
      ['synthetic-websocket', 'observed_only', 'unverified'],
      ['synthetic-sse', 'observed_only', 'unverified'],
      ['synthetic-preflight', 'observed_only', 'unverified'],
      ['synthetic-follow-up', 'observed_only', 'unverified'],
      ['synthetic-redirect', 'observed_only', 'unverified'],
    ],
  );
  assert.deepEqual(
    entries.map((entry) => [entry.transport, entry.resourceType]),
    [
      ['websocket', 'WebSocket'],
      ['sse', 'EventSource'],
      ['preflight', 'Preflight'],
      ['http', 'XHR'],
      ['http', 'Document'],
    ],
  );
  assert.equal(entries[2].preflight, true);
  assert.deepEqual(
    entries[0].shapeGaps.map((gap) => gap.gapKind),
    ['missing-request-shape-evidence', 'missing-response-shape-evidence'],
  );
  assert.deepEqual(
    entries[0].shapeGaps.map((gap) => gap.reasonCode),
    ['api-request-shape-evidence-missing', 'api-response-shape-evidence-missing'],
  );
  assert.equal(entries[0].requestShapeStatus, 'unknown');
  assert.equal(entries[0].responseShapeStatus, 'unknown');
  assert.equal(entries[0].shapeGaps.every((gap) => gap.redactionRequired === true), true);
  assert.equal(entries[0].messageShapeStatus, 'unknown');
  assert.deepEqual(
    entries[0].messageShapeGaps.map((gap) => [gap.gapKind, gap.reasonCode]),
    [['missing-stream-message-shape-evidence', 'api-stream-message-shape-evidence-missing']],
  );
  assert.equal(entries[1].messageShapeStatus, 'unknown');
  assert.equal(entries[1].messageShapeGaps.every((gap) => gap.redactionRequired === true), true);
  assert.equal(entries[2].messageShapeStatus, undefined);
  assert.equal(entries[2].preflightCorrelation.status, 'correlated_observed_request');
  assert.deepEqual(entries[2].preflightCorrelation.followUpCandidateIds, ['synthetic-follow-up']);
  assert.equal(entries[2].preflightCorrelation.catalogPromotionAllowed, false);
  assert.equal(entries[3].preflightObserved, true);
  assert.equal(entries[3].preflightCorrelation.status, 'preflight_observed');
  assert.deepEqual(entries[3].preflightCorrelation.preflightCandidateIds, ['synthetic-preflight']);
  assert.equal(String(entries[3].locator).includes('synthetic-follow-up-token'), false);
  assert.equal(entries[4].redirect.statusCode, 302);
  assert.equal(entries[4].redirect.mimeType, 'text/html');
  assert.equal(String(entries[4].redirect.url).includes('synthetic-redirect-token'), false);
  assert.equal(Object.hasOwn(entries[4].redirect, 'headers'), false);
  assert.equal(artifacts.objects.UNKNOWN_API_REPORT.entries.length, 5);
  assert.equal(artifacts.objects.BLOCKED_API_REPORT.entries.length, 0);
  assert.equal(artifacts.markdown.API_INVENTORY.includes('| ID | Method | Transport | Resource type | Endpoint kind |'), true);
  assertNoSensitiveFixtureMaterial(inputs);
  assertNoSensitiveFixtureMaterial(artifacts);
});

test('API inventory preserves descriptor-only multi-step correlation without promotion', () => {
  const inputs = SiteOnboardingDiscoveryModule.createSiteOnboardingDiscoveryInputFromCaptureExpand({
    siteKey: 'synthetic-navigation',
    networkRequests: [
      {
        id: 'synthetic-search-request',
        method: 'POST',
        url: 'https://example.invalid/api/search?access_token=synthetic-flow-token',
        resourceType: 'XHR',
        status: 'observed',
        multiStepCorrelation: {
          flowId: 'search-flow',
          triggerId: 'trigger-search-button',
          initiatorNodeId: 'search-form',
          sequenceIndex: 1,
          nextRequestIds: [
            'synthetic-detail-request',
            'https://example.invalid/api/detail?session_id=synthetic-flow-session',
          ],
          requestPhase: 'search-submit',
          responsePhase: 'C:/Users/Alice/AppData/Local/BrowserProfile/Default run-handler.mjs 203.0.113.99',
          headers: {
            authorization: 'Bearer synthetic-flow-token',
            cookie: 'SESSDATA=synthetic-flow-session',
          },
          body: {
            csrf_token: 'synthetic-flow-csrf',
          },
          payload: 'synthetic-flow-token',
          rawResponse: 'synthetic-flow-session',
          browserProfile: 'C:/Users/Alice/AppData/Local/BrowserProfile/Default',
          handler: 'run-handler.mjs',
          networkAddress: '203.0.113.99',
        },
      },
      {
        id: 'synthetic-detail-request',
        method: 'GET',
        url: 'https://example.invalid/api/detail?id=1&csrf_token=synthetic-flow-csrf',
        resourceType: 'XHR',
        status: 'observed',
        target: {
          multiStepCorrelation: {
            flowId: 'search-flow',
            triggerId: 'trigger-result-click',
            initiatorNodeId: 'result-card',
            sequenceIndex: 2,
            previousRequestIds: ['synthetic-search-request'],
            requestPhase: 'https://example.invalid/phase?access_token=synthetic-phase-token',
            responsePhase: 'detail-load',
          },
        },
      },
    ],
  });
  const artifacts = createSiteOnboardingDiscoveryArtifacts({
    ...inputs,
    adapter: adapterFromDecisions(),
  });
  const entries = artifacts.objects.API_INVENTORY.entries;
  const [searchEntry, detailEntry] = entries;

  assert.equal(searchEntry.discoveryStatus, 'observed_only');
  assert.equal(searchEntry.verificationState, 'unverified');
  assert.equal(searchEntry.multiStepCorrelation.correlationKind, 'api-multi-step-flow');
  assert.equal(searchEntry.multiStepCorrelation.status, 'observed');
  assert.equal(
    searchEntry.multiStepCorrelation.reasonCode,
    'site-onboarding.api.multi_step_correlation_observed',
  );
  assert.equal(searchEntry.multiStepCorrelation.flowId, 'search-flow');
  assert.equal(searchEntry.multiStepCorrelation.triggerId, 'trigger-search-button');
  assert.equal(searchEntry.multiStepCorrelation.initiatorNodeId, 'search-form');
  assert.equal(searchEntry.multiStepCorrelation.sequenceIndex, 1);
  assert.equal(searchEntry.multiStepCorrelation.requestPhase, 'search-submit');
  assert.equal(searchEntry.multiStepCorrelation.responsePhase, 'redacted-correlation-ref');
  assert.deepEqual(searchEntry.multiStepCorrelation.nextRequestIds, [
    'synthetic-detail-request',
    'redacted-correlation-ref',
  ]);
  assert.equal(searchEntry.multiStepCorrelation.observedOnly, true);
  assert.equal(searchEntry.multiStepCorrelation.catalogPromotionAllowed, false);
  assert.equal(searchEntry.multiStepCorrelation.verifiedCatalogAllowed, false);
  assert.equal(searchEntry.multiStepCorrelation.executionPlanAllowed, false);
  assert.equal(searchEntry.multiStepCorrelation.descriptorOnly, true);
  assert.equal(searchEntry.multiStepCorrelation.redactionRequired, true);
  assert.equal(Object.hasOwn(searchEntry.multiStepCorrelation, 'headers'), false);
  assert.equal(Object.hasOwn(searchEntry.multiStepCorrelation, 'body'), false);
  assert.equal(Object.hasOwn(searchEntry.multiStepCorrelation, 'payload'), false);
  assert.equal(Object.hasOwn(searchEntry.multiStepCorrelation, 'rawResponse'), false);
  assert.equal(Object.hasOwn(searchEntry.multiStepCorrelation, 'browserProfile'), false);
  assert.equal(Object.hasOwn(searchEntry.multiStepCorrelation, 'handler'), false);
  assert.equal(detailEntry.multiStepCorrelation.previousRequestIds[0], 'synthetic-search-request');
  assert.equal(detailEntry.multiStepCorrelation.sequenceIndex, 2);
  assert.equal(detailEntry.multiStepCorrelation.requestPhase, 'redacted-correlation-ref');
  assert.equal(detailEntry.multiStepCorrelation.responsePhase, 'detail-load');
  assert.equal(artifacts.objects.UNKNOWN_API_REPORT.entries.length, 2);
  assert.equal(artifacts.objects.BLOCKED_API_REPORT.entries.length, 0);
  assert.equal(JSON.stringify(artifacts).includes('synthetic-flow-token'), false);
  assert.equal(JSON.stringify(artifacts).includes('synthetic-flow-session'), false);
  assert.equal(JSON.stringify(artifacts).includes('synthetic-flow-csrf'), false);
  assert.equal(JSON.stringify(artifacts).includes('synthetic-phase-token'), false);
  assert.equal(JSON.stringify(artifacts).includes('BrowserProfile'), false);
  assert.equal(JSON.stringify(artifacts).includes('run-handler.mjs'), false);
  assert.equal(JSON.stringify(artifacts).includes('203.0.113.99'), false);
  assertNoSensitiveFixtureMaterial(artifacts);
});

test('API controlled-scope closure accounts for API surface families without promotion', () => {
  const artifacts = createSiteOnboardingDiscoveryArtifacts({
    siteKey: 'synthetic-navigation',
    discoveredApis: [
      discoveredApi('search-api', {
        url: 'https://example.invalid/api/search?access_token=synthetic-query-token',
        status: 'observed_only',
        endpointKind: 'search-endpoint',
        transport: 'fetch',
        resourceType: 'fetch',
        responseShape: {
          type: 'object',
          fieldNames: ['title', 'id'],
        },
      }),
      discoveredApi('unknown-api', {
        url: 'https://example.invalid/api/unknown?session_id=synthetic-session-id',
        status: 'unknown',
        endpointKind: 'related-content-endpoint',
        required: true,
        shapeGaps: [
          {
            gapKind: 'missing-request-shape-evidence',
            reasonCode: 'api-request-shape-evidence-missing',
            evidenceStatus: 'unknown',
            reason: 'request shape unavailable',
            descriptorOnly: true,
          },
        ],
      }),
      discoveredApi('duplicate-api', {
        url: 'https://example.invalid/api/search?token=synthetic-query-token&page=2',
        status: 'duplicate_trigger',
        endpointKind: 'search-endpoint',
        duplicateOf: 'search-api',
      }),
      discoveredApi('websocket-api', {
        url: 'wss://example.invalid/socket?access_token=synthetic-websocket-token',
        status: 'observed_only',
        endpointKind: 'media-metadata-endpoint',
        transport: 'websocket',
        resourceType: 'WebSocket',
        messageShapeGaps: [
          {
            gapKind: 'missing-stream-message-shape-evidence',
            reasonCode: 'api-stream-message-shape-evidence-missing',
            evidenceStatus: 'unknown',
            reason: 'raw payload was not persisted',
            descriptorOnly: true,
          },
        ],
      }),
      discoveredApi('preflight-api', {
        method: 'OPTIONS',
        url: 'https://example.invalid/api/detail?csrf_token=synthetic-preflight-csrf',
        status: 'observed_only',
        endpointKind: 'detail-endpoint',
        preflightCorrelation: {
          status: 'preflight_observed',
          canonicalEndpointPathKey: 'example.invalid:api:detail',
          preflightCandidateIds: ['preflight-api'],
          followUpCandidateIds: ['detail-api'],
          observedOnly: true,
          catalogPromotionAllowed: false,
        },
      }),
      discoveredApi('flow-api', {
        url: 'https://example.invalid/api/flow?token=synthetic-flow-token',
        status: 'observed_only',
        endpointKind: 'list-pagination-endpoint',
        multiStepCorrelation: {
          flowId: 'search-flow',
          triggerId: 'next-page',
          initiatorNodeId: 'pagination-control',
          sequenceIndex: 2,
          previousRequestIds: ['search-api'],
          responsePhase: 'C:/Users/Alice/AppData/Local/BrowserProfile/Default 203.0.113.99',
        },
      }),
    ],
    adapter: adapterFromDecisions({
      apis: {
        'search-api': { classification: 'recognized', recognizedAs: 'search-endpoint' },
        'duplicate-api': { classification: 'recognized', recognizedAs: 'search-endpoint' },
        'websocket-api': { classification: 'recognized', recognizedAs: 'media-metadata-endpoint' },
        'preflight-api': { classification: 'recognized', recognizedAs: 'detail-endpoint' },
        'flow-api': { classification: 'recognized', recognizedAs: 'list-pagination-endpoint' },
      },
    }),
  });

  const apiClosure = artifacts.objects.SITE_CAPABILITY_REPORT.fullDiscoveryClosure.apiControlledScopeClosure;
  assert.equal(apiClosure.closureKind, 'api-controlled-scope-closure');
  assert.equal(apiClosure.reasonCode, 'site-onboarding.api.controlled_scope_accounted');
  assert.equal(apiClosure.controlledScopeOnly, true);
  assert.equal(apiClosure.liveNetworkCoverageClaimed, false);
  assert.equal(apiClosure.verifiedCatalogCoverageClaimed, false);
  assert.equal(apiClosure.observedApiAutoPromotionAllowed, false);
  assert.equal(apiClosure.graphCatalogPromotionAllowed, false);
  assert.equal(apiClosure.plannerRoutePromotionAllowed, false);
  assert.equal(apiClosure.layerExecutionAllowed, false);
  assert.equal(apiClosure.downloaderExecutionAllowed, false);
  assert.equal(apiClosure.artifactRefs.every((ref) => !/[\\/]|https?:/iu.test(ref)), true);
  assert.equal(apiClosure.surfaceCounts.total, 6);
  assert.equal(apiClosure.surfaceCounts.requestShapeGapRows, 1);
  assert.equal(apiClosure.surfaceCounts.messageShapeGapRows, 1);
  assert.equal(apiClosure.surfaceCounts.preflightCorrelationRows, 1);
  assert.equal(apiClosure.surfaceCounts.multiStepCorrelationRows, 1);
  assert.equal(apiClosure.surfaceCounts.streamingEndpointRows, 1);
  assert.equal(apiClosure.surfaceCounts.duplicateTriggerRows, 1);
  assert.equal(apiClosure.reportCounts.unknownApis, 1);
  assert.equal(apiClosure.reportCounts.blockedStatusCounts.duplicate_trigger, 1);
  assert.equal(apiClosure.accountingChecks.noApiSurfaceSilentlyDroppedWithinControlledScope, true);
  assert.equal(apiClosure.accountingChecks.shapeGapsDescriptorOnly, true);
  assert.equal(apiClosure.accountingChecks.messageShapeGapsDescriptorOnly, true);
  assert.equal(apiClosure.accountingChecks.preflightCorrelationsNonPromotional, true);
  assert.equal(apiClosure.accountingChecks.multiStepCorrelationsNonPromotional, true);
  assert.equal(apiClosure.accountingChecks.observedApiAutoPromotionPrevented, true);
  assert.deepEqual(
    artifacts.objects.DISCOVERY_AUDIT.fullDiscoveryClosure.apiControlledScopeClosure.accountingChecks,
    apiClosure.accountingChecks,
  );
  assertNoSensitiveFixtureMaterial(artifacts);
});

test('Capability controlled-scope closure accounts for target and gap surfaces without promotion', () => {
  const artifacts = createSiteOnboardingDiscoveryArtifacts({
    siteKey: 'synthetic-navigation',
    requestedCapabilities: ['download-content'],
    capabilityInventory: {
      entries: [
        {
          id: 'download-observed',
          recognizedAs: 'download-content',
          discoveryStatus: 'observed_only',
          verificationState: 'unverified',
          evidenceKind: 'api-response-evidence',
          evidenceRef:
            'https://example.invalid/api/download?access_token=synthetic-query-token '
            + 'Authorization: Bearer synthetic-api-auth Cookie: SESSDATA=synthetic-session-id '
            + 'C:/Users/Alice/AppData/Local/BrowserProfile/Default run-handler.mjs 203.0.113.7 My Account Alice',
          evidenceDetail: {
            descriptorKind: 'capability-api-response-evidence',
            targetId: 'download-content',
            sourceApiId: 'C:/Users/Alice/AppData/Local/BrowserProfile/Default/run-handler.mjs',
            endpointKind: 'download-resource-endpoint',
            responseShapeStatus: 'observed',
            responseFieldHints: ['downloadUrl', 'metadata'],
            responseSchemaHash: 'schema-hash synthetic-session-id',
            observedOnly: true,
            executableEvidence: false,
            descriptorOnly: true,
          },
        },
      ],
    },
    adapter: adapterFromDecisions({
      capabilityEvidenceFixtures: [
        {
          capability: 'search-content',
          status: 'verified',
          verificationState: 'verified',
          adapterRef: 'search-adapter',
          schemaRef: 'search-schema',
          testEvidenceRef: 'search-test',
          policyRef: 'search-policy',
          riskRef: 'search-risk',
          approvalRef: 'search-approval',
        },
      ],
    }),
  });

  const capabilityClosure =
    artifacts.objects.SITE_CAPABILITY_REPORT.fullDiscoveryClosure.capabilityControlledScopeClosure;
  const searchTarget = artifacts.objects.CAPABILITY_TARGETS.targets
    .find((target) => target.targetId === 'search-content');
  const downloadTarget = artifacts.objects.CAPABILITY_TARGETS.targets
    .find((target) => target.targetId === 'download-content');

  assert.equal(capabilityClosure.closureKind, 'capability-controlled-scope-closure');
  assert.equal(capabilityClosure.reasonCode, 'site-onboarding.capability.controlled_scope_accounted');
  assert.equal(capabilityClosure.controlledScopeOnly, true);
  assert.equal(capabilityClosure.liveCapabilityVerificationClaimed, false);
  assert.equal(capabilityClosure.executableCoverageClaimed, false);
  assert.equal(capabilityClosure.observedCapabilityAutoPromotionAllowed, false);
  assert.equal(capabilityClosure.graphCapabilityPromotionAllowed, false);
  assert.equal(capabilityClosure.plannerCapabilityPlanAllowed, false);
  assert.equal(capabilityClosure.layerExecutionAllowed, false);
  assert.equal(capabilityClosure.downloaderExecutionAllowed, false);
  assert.equal(capabilityClosure.artifactRefs.every((ref) => !/[\\/]|https?:/iu.test(ref)), true);
  assert.equal(capabilityClosure.targetCounts.total, 15);
  assert.equal(capabilityClosure.targetCounts.verifiedTargets, 1);
  assert.equal(capabilityClosure.targetCounts.executableAllowedTargets, 1);
  assert.equal(capabilityClosure.targetCounts.observedNonExecutableTargets >= 1, true);
  assert.equal(capabilityClosure.targetCounts.unknownTargets >= 1, true);
  assert.equal(capabilityClosure.targetCounts.requiredTargets, 1);
  assert.equal(capabilityClosure.evidenceCounts.evidenceKindCounts.adapter, 1);
  assert.equal(capabilityClosure.evidenceCounts.evidenceKindCounts.schema, 1);
  assert.equal(capabilityClosure.evidenceCounts.evidenceKindCounts.test, 1);
  assert.equal(capabilityClosure.evidenceCounts.evidenceKindCounts.policy, 1);
  assert.equal(capabilityClosure.evidenceCounts.evidenceKindCounts.risk, 1);
  assert.equal(capabilityClosure.evidenceCounts.evidenceKindCounts.approval, 1);
  assert.equal(capabilityClosure.evidenceCounts.evidenceKindCounts['api-response-evidence'], 1);
  assert.equal(capabilityClosure.evidenceCounts.missingEvidenceKindCounts.adapter >= 1, true);
  assert.equal(capabilityClosure.reportCounts.capabilityGaps, 14);
  assert.equal(capabilityClosure.reportCounts.requiredCapabilityGaps, 1);
  assert.equal(capabilityClosure.accountingChecks.noCapabilitySurfaceSilentlyDroppedWithinControlledScope, true);
  assert.equal(capabilityClosure.accountingChecks.observedCapabilitiesNonExecutable, true);
  assert.equal(capabilityClosure.accountingChecks.executableCapabilitiesHaveVerifiedQuorum, true);
  assert.equal(capabilityClosure.accountingChecks.executableCapabilitiesHaveNoRequirementGaps, true);
  assert.equal(capabilityClosure.accountingChecks.everyUnverifiedCapabilityHasGapRecord, true);
  assert.equal(capabilityClosure.accountingChecks.capabilityMappingsDescriptorOnly, true);
  assert.equal(capabilityClosure.accountingChecks.gapRecordsDescriptorOnly, true);
  assert.equal(searchTarget.executableCapabilityAllowed, true);
  assert.equal(downloadTarget.discoveryState, 'observed_only');
  assert.equal(downloadTarget.executableCapabilityAllowed, false);
  assert.equal(downloadTarget.observedCapabilityAutoPromotionAllowed, false);
  assert.deepEqual(
    artifacts.objects.DISCOVERY_AUDIT.fullDiscoveryClosure.capabilityControlledScopeClosure.accountingChecks,
    capabilityClosure.accountingChecks,
  );
  assertNoSensitiveFixtureMaterial(artifacts);
});

test('Streaming API inventory preserves redacted message shape summaries', () => {
  const inputs = SiteOnboardingDiscoveryModule.createSiteOnboardingDiscoveryInputFromCaptureExpand({
    siteKey: 'synthetic-navigation',
    networkRequests: [
      {
        id: 'synthetic-websocket-shaped',
        method: 'GET',
        url: 'wss://example.invalid/socket?access_token=synthetic-websocket-token',
        transport: 'websocket',
        resourceType: 'WebSocket',
        messageShape: {
          type: 'object',
          fieldNames: ['event', 'payload', ...Array.from({ length: 25 }, (_, index) => `extra-${index}-${'x'.repeat(200)}`)],
          sampleValue: 'synthetic-response-token',
        },
        messageSchemaHash: `sha256:${'b'.repeat(64)}`,
      },
    ],
  });
  const artifacts = createSiteOnboardingDiscoveryArtifacts({
    ...inputs,
    adapter: adapterFromDecisions(),
  });
  const [entry] = artifacts.objects.API_INVENTORY.entries;

  assert.equal(entry.transport, 'websocket');
  assert.equal(entry.messageShapeStatus, 'observed');
  assert.equal(entry.messageShape.type, 'object');
  assert.deepEqual(entry.messageShape.fieldNames.slice(0, 2), ['event', 'payload']);
  assert.equal(entry.messageShape.fieldNames.length, 20);
  assert.equal(entry.messageShape.fieldNames.every((field) => field.length <= 120), true);
  assert.equal(entry.messageSchemaHash, `sha256:${'b'.repeat(64)}`);
  assert.equal((entry.messageShapeGaps ?? []).length, 0);
  assert.equal(Object.hasOwn(entry.messageShape, 'sampleValue'), false);
  assertNoSensitiveFixtureMaterial(inputs);
  assertNoSensitiveFixtureMaterial(artifacts);
});

test('Streaming message shape gaps are descriptor-only and drop raw payload refs', () => {
  const apiInventory = SiteOnboardingDiscoveryModule.createApiInventory([
    {
      id: 'synthetic-unsafe-stream-gap',
      method: 'GET',
      url: 'wss://example.invalid/socket?access_token=synthetic-websocket-token&session_id=synthetic-sse-session',
      transport: 'websocket',
      resourceType: 'WebSocket',
      status: 'observed',
      messageShapeGaps: [
        {
          gapKind: 'missing-stream-message-shape-evidence',
          reasonCode: 'api-stream-message-shape-evidence-missing',
          evidenceStatus: 'unknown',
          reason: `missing safe stream shape ${'x'.repeat(300)}`,
          descriptorOnly: true,
          redactionRequired: true,
          rawMessage: 'event: token\\ndata: synthetic-websocket-token',
          payload: {
            csrf_token: 'synthetic-preflight-csrf',
            session_id: 'synthetic-sse-session',
          },
          headers: {
            authorization: 'Bearer synthetic-websocket-token',
            cookie: 'SESSDATA=synthetic-redirect-sessdata',
          },
          href: 'wss://example.invalid/socket?access_token=synthetic-websocket-token',
          handler: 'run-handler.mjs',
        },
      ],
    },
  ], {
    siteKey: 'synthetic-navigation',
    adapter: adapterFromDecisions(),
  });
  const [entry] = apiInventory.entries;
  const [gap] = entry.messageShapeGaps;

  assert.equal(gap.gapKind, 'missing-stream-message-shape-evidence');
  assert.equal(gap.reasonCode, 'api-stream-message-shape-evidence-missing');
  assert.equal(gap.descriptorOnly, true);
  assert.equal(gap.redactionRequired, true);
  assert.equal(Object.hasOwn(gap, 'rawMessage'), false);
  assert.equal(Object.hasOwn(gap, 'payload'), false);
  assert.equal(Object.hasOwn(gap, 'headers'), false);
  assert.equal(Object.hasOwn(gap, 'href'), false);
  assert.equal(Object.hasOwn(gap, 'handler'), false);
  assert.equal(JSON.stringify(apiInventory).includes('run-handler.mjs'), false);
  assertNoSensitiveFixtureMaterial(apiInventory);
});

test('Duplicate API endpoint observations are retained as duplicate trigger evidence', () => {
  const inputs = SiteOnboardingDiscoveryModule.createSiteOnboardingDiscoveryInputFromCaptureExpand({
    siteKey: 'synthetic-navigation',
    networkRequests: [
      {
        id: 'api-items-first',
        method: 'GET',
        url: 'https://example.invalid/api/items?page=1&access_token=synthetic-duplicate-token',
        status: 'observed',
        resourceType: 'XHR',
      },
      {
        id: 'run-handler.mjs',
        method: 'GET',
        url: 'https://example.invalid/api/items?page=1&access_token=synthetic-duplicate-token',
        status: 'verified',
        resourceType: 'XHR',
      },
    ],
  });
  const artifacts = createSiteOnboardingDiscoveryArtifacts({
    ...inputs,
    adapter: adapterFromDecisions(),
  });

  const entries = artifacts.objects.API_INVENTORY.entries;
  assert.equal(entries.length, 2);
  assert.equal(entries[0].discoveryStatus, 'observed_only');
  assert.equal(entries[1].discoveryStatus, 'duplicate_trigger');
  assert.equal(entries[1].verificationState, 'unverified');
  assert.equal(entries[1].duplicateOf, 'api-items-first');
  assert.equal(entries[1].duplicateGroupKey, entries[0].duplicateGroupKey);
  assert.equal(entries[1].duplicateGroupKey.includes('?'), false);
  assert.equal(entries[1].duplicateGroupKey.includes('access-token'), false);
  assert.equal(entries[1].duplicateGroupKey.includes('synthetic'), false);
  assert.equal(entries[1].gapReason.includes('duplicate endpoint observation'), true);
  assert.equal(artifacts.objects.BLOCKED_API_REPORT.entries.length, 1);
  assert.equal(artifacts.objects.BLOCKED_API_REPORT.entries[0].discoveryStatus, 'duplicate_trigger');
  assert.equal(artifacts.objects.UNKNOWN_API_REPORT.entries.length, 2);
  assert.equal(JSON.stringify(entries).includes('synthetic-duplicate-token'), false);
  assert.equal(JSON.stringify(entries).includes('run-handler.mjs'), false);
  assertNoSensitiveFixtureMaterial(inputs);
  assertNoSensitiveFixtureMaterial(artifacts);
});

test('API shape gaps are descriptor-only and drop raw request response material', () => {
  const apiInventory = SiteOnboardingDiscoveryModule.createApiInventory([
    {
      id: 'synthetic-api-with-unsafe-gap',
      method: 'POST',
      url: 'https://example.invalid/api/unsafe?access_token=synthetic-shape-gap-token',
      status: 'observed',
      shapeGaps: [
        {
          gapKind: 'missing-request-shape-evidence',
          reasonCode: 'api-request-shape-evidence-missing',
          evidenceStatus: 'unknown',
          reason: `missing safe shape ${'x'.repeat(300)}`,
          descriptorOnly: true,
          redactionRequired: true,
          headers: {
            authorization: 'Bearer synthetic-shape-gap-token',
          },
          body: {
            session_id: 'synthetic-shape-gap-session',
          },
          sampleValue: 'synthetic-shape-gap-token',
          rawResponse: 'synthetic-shape-gap-token',
        },
      ],
    },
  ], {
    siteKey: 'synthetic-navigation',
    adapter: adapterFromDecisions(),
  });
  const [entry] = apiInventory.entries;
  const [gap] = entry.shapeGaps;

  assert.equal(gap.gapKind, 'missing-request-shape-evidence');
  assert.equal(gap.reasonCode, 'api-request-shape-evidence-missing');
  assert.equal(gap.descriptorOnly, true);
  assert.equal(gap.redactionRequired, true);
  assert.equal(Object.hasOwn(gap, 'headers'), false);
  assert.equal(Object.hasOwn(gap, 'body'), false);
  assert.equal(Object.hasOwn(gap, 'sampleValue'), false);
  assert.equal(Object.hasOwn(gap, 'rawResponse'), false);
  assert.equal(JSON.stringify(apiInventory).includes('synthetic-shape-gap-token'), false);
  assert.equal(JSON.stringify(apiInventory).includes('synthetic-shape-gap-session'), false);
});

test('API inventory preserves redacted request and response shape summaries', () => {
  const inputs = SiteOnboardingDiscoveryModule.createSiteOnboardingDiscoveryInputFromCaptureExpand({
    siteKey: 'synthetic-navigation',
    networkRequests: [
      {
        id: 'synthetic-shaped-api',
        siteKey: 'synthetic-navigation',
        status: 'observed',
        method: 'POST',
        url: 'https://example.invalid/api/search?access_token=synthetic-query-token',
        endpointKind: 'rest-json',
        roleHint: 'search',
        riskClass: 'observed-unverified',
        parameterShape: ['query-template', 'body-template'],
        queryKeys: ['access_token', 'safe'],
        request: {
          bodyShape: {
            type: 'object',
            fieldNames: [
              'query',
              'page',
              ...Array.from({ length: 25 }, (_, index) => `extra-${index}-${'x'.repeat(200)}`),
            ],
            sampleValue: 'synthetic-response-token',
          },
        },
      },
    ],
    networkResponseSummaries: [
      {
        candidateId: 'synthetic-shaped-api',
        statusCode: 200,
        contentType: 'application/json',
        headerNames: ['content-type', 'cache-control'],
        bodyShape: {
          type: 'object',
          fieldNames: [
            'items',
            'cursor',
            ...Array.from({ length: 25 }, (_, index) => `extra-${index}-${'x'.repeat(200)}`),
          ],
          sampleValue: 'synthetic-response-token',
        },
        responseSchemaHash: `sha256:${'a'.repeat(64)}`,
      },
    ],
  });
  const artifacts = createSiteOnboardingDiscoveryArtifacts({
    ...inputs,
    adapter: adapterFromDecisions(),
  });
  const [entry] = artifacts.objects.API_INVENTORY.entries;

  assert.equal(entry.discoveryStatus, 'observed_only');
  assert.equal(entry.verificationState, 'unverified');
  assert.equal(entry.endpointKind, 'rest-json');
  assert.equal(entry.roleHint, 'search');
  assert.equal(entry.riskClass, 'observed-unverified');
  assert.deepEqual(entry.parameterShape, ['query-template', 'body-template']);
  assert.deepEqual(entry.queryKeys, ['access_token', 'safe']);
  assert.equal(entry.bodyShape.type, 'object');
  assert.deepEqual(entry.bodyShape.fieldNames.slice(0, 2), ['query', 'page']);
  assert.equal(entry.bodyShape.fieldNames.length, 20);
  assert.equal(entry.bodyShape.fieldNames.every((field) => field.length <= 120), true);
  assert.equal(Object.hasOwn(entry.bodyShape, 'sampleValue'), false);
  assert.equal(entry.responseShape.type, 'object');
  assert.deepEqual(entry.responseShape.fieldNames.slice(0, 2), ['items', 'cursor']);
  assert.equal(entry.responseShape.fieldNames.length, 20);
  assert.equal(entry.responseShape.fieldNames.every((field) => field.length <= 120), true);
  assert.equal(Object.hasOwn(entry.responseShape, 'sampleValue'), false);
  assert.equal(entry.statusCode, 200);
  assert.equal(entry.contentType, 'application/json');
  assert.deepEqual(entry.headerNames, ['content-type', 'cache-control']);
  assert.equal(entry.responseSchemaHash, `sha256:${'a'.repeat(64)}`);
  assert.equal(entry.requestShapeStatus, 'observed');
  assert.equal(entry.responseShapeStatus, 'observed');
  assert.equal((entry.shapeGaps ?? []).length, 0);
  assert.equal(Object.hasOwn(entry, 'headers'), false);
  assert.equal(Object.hasOwn(entry, 'body'), false);
  assert.equal(artifacts.objects.UNKNOWN_API_REPORT.entries.length, 1);
  assert.equal(artifacts.markdown.API_INVENTORY.includes('rest-json'), true);
  assertNoSensitiveFixtureMaterial(inputs);
  assertNoSensitiveFixtureMaterial(artifacts);
});

test('URL-only new-site requests are documented as full onboarding, not skill-only work', async () => {
  const agentGuidance = await readFile(path.resolve('AGENTS.md'), 'utf8');
  const contributorGuidance = await readFile(path.resolve('CONTRIBUTING.md'), 'utf8');
  const onboardingGuidance = `${agentGuidance}\n${contributorGuidance}`;

  assert.match(onboardingGuidance, /URL-Only New-Site Intake Contract/u);
  assert.match(onboardingGuidance, /full onboarding by default/u);
  assert.match(onboardingGuidance, /not a request to\s+only draft a skill/u);
  for (const artifactName of [
    'NODE_INVENTORY',
    'API_INVENTORY',
    'UNKNOWN_NODE_REPORT',
    'BLOCKED_NODE_REPORT',
    'UNKNOWN_API_REPORT',
    'BLOCKED_API_REPORT',
    'CAPABILITY_TARGETS',
    'CAPABILITY_GAP_REPORT',
    'SITE_CAPABILITY_REPORT',
    'DISCOVERY_AUDIT',
  ]) {
    assert.match(onboardingGuidance, new RegExp(artifactName, 'u'));
  }
  for (const gateText of [
    'site-specific onboarding test',
    'onboarding discovery gate',
    'site-doctor artifact gate',
    'SiteAdapter contract test',
    'matrix test',
    'Agent B acceptance',
  ]) {
    assert.match(onboardingGuidance, new RegExp(gateText, 'u'));
  }
  for (const blockedSurface of [
    'paywall',
    'VIP access',
    'CAPTCHA',
    'risk-control',
    'paid/VIP chapter reading',
    'access-control bypass',
  ]) {
    assert.match(onboardingGuidance, new RegExp(blockedSurface, 'u'));
  }
  assert.match(agentGuidance, /A bare new-site URL is full onboarding by default/u);
  assert.match(agentGuidance, /Do not stop after only adding\s+a profile, registry row, or skill/u);
  assert.match(contributorGuidance, /A user-provided new site URL is full onboarding by default/u);
  assert.match(contributorGuidance, /only draft a skill or profile/u);
});
