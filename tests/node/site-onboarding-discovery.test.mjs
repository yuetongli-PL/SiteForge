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
} = {}) {
  return {
    id,
    method,
    required,
    url,
    label: id,
  };
}

function adapterFromDecisions({
  nodes = {},
  apis = {},
} = {}) {
  return {
    id: 'synthetic-adapter',
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
