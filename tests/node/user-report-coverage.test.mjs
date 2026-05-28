import test from 'node:test';
import assert from 'node:assert/strict';

import { RUNTIME_MODES } from '../../src/app/pipeline/build/runtime-provider.mjs';
import {
  browserBridgeCoverageGaps,
  buildCoverageReport,
  summarizeNodes,
} from '../../src/app/pipeline/build/user-report-coverage.mjs';

test('user report node summary counts types, classifications, layers, and actions', () => {
  assert.deepEqual(summarizeNodes({
    classifyNodes: {
      graph: {
        nodes: [
          { type: 'page', classification: 'landing', sourceLayer: 'public' },
          { type: 'content', classification: 'detail', sourceLayer: 'public_rendered' },
          { type: 'component', classification: 'menu', sourceLayer: 'authenticated_overlay', authRequired: true },
          { type: 'route_template', classification: 'authorized', sourceLayer: 'authorized_source' },
        ],
      },
    },
    extractAffordances: { affordances: [{}, {}] },
  }), {
    total: 4,
    nodes_total: 4,
    page_nodes: 1,
    content_nodes: 1,
    operation_nodes: 1,
    modal_nodes: 0,
    route_templates: 1,
    actionable_elements: 2,
    by_type: {
      page: 1,
      content: 1,
      component: 1,
      route_template: 1,
    },
    by_classification: {
      landing: 1,
      detail: 1,
      menu: 1,
      authorized: 1,
    },
    by_source_layer: {
      public: 1,
      public_rendered: 1,
      authenticated_overlay: 1,
      authorized_source: 1,
    },
    auth_required: 1,
  });
});

test('browser bridge coverage gaps report only uncaptured route summaries', () => {
  assert.deepEqual(browserBridgeCoverageGaps({
    browserBridge: {
      routeResults: [
        { routeId: 'home', targetRoute: '/home', status: 'captured' },
        { routeId: 'settings', targetRoute: '/settings', status: 'timeout', reasonCode: 'route-timeout', sourceLayer: 'authenticated_overlay' },
      ],
    },
  }), [{
    id: 'settings',
    name: '/settings',
    authRequired: true,
    routeTemplate: '/settings',
    sourceLayer: 'authenticated_overlay',
    status: 'timeout',
    reason: 'route-timeout',
    missingEvidence: ['browser_structure_summary'],
  }]);
});

test('user report coverage model separates public, authenticated, risk, and runtime coverage', () => {
  const coverage = buildCoverageReport(
    {
      crawlContract: {
        crawlMode: 'mixed',
        authMethod: 'browser',
        authVerificationStatus: 'browser_verified',
      },
      authStateReport: {
        authMethod: 'browser',
        authVerificationStatus: 'browser_verified',
        browserBridge: {
          routeResults: [
            { routeId: 'profile', targetRoute: '/profile', status: 'captured' },
            { routeId: 'dm', targetRoute: '/messages', status: 'timeout', reasonCode: 'browser-route-timeout' },
          ],
        },
      },
    },
    {
      classifyNodes: {
        graph: {
          nodes: [
            { type: 'page', sourceLayer: 'public' },
            { type: 'content', sourceLayer: 'public_rendered' },
            { type: 'route_template', sourceLayer: 'authorized_source' },
            { type: 'page', sourceLayer: 'authenticated', authRequired: true },
            { type: 'component', sourceLayer: 'authenticated_overlay', authRequired: true },
          ],
        },
      },
      crawlStatic: {
        pages: [
          { sourceLayer: 'public' },
          { sourceLayer: 'authenticated', authRequired: true },
        ],
        summary: { authorizedSourcePages: 1 },
      },
      crawlRendered: { publicRenderedPages: [{}] },
      crawlAuthenticated: {
        authenticatedPages: [{}, {}],
        authenticatedOverlayPages: [{}],
      },
      extractAffordances: {
        affordances: [
          { sourceLayer: 'authenticated_overlay' },
          { sourceLayer: 'public' },
        ],
      },
    },
    [
      { id: 'read-public', name: 'Read public', status: 'active', sourceLayer: 'public', runtimeMode: RUNTIME_MODES.genericHttpRead },
      { id: 'rendered', name: 'Rendered', status: 'active', sourceLayer: 'public_rendered', runtimeMode: RUNTIME_MODES.genericHttpRead },
      { id: 'authorized', name: 'Authorized', status: 'active', sourceLayer: 'authorized_source' },
      { id: 'profile', name: 'Profile', status: 'active', authRequired: true, sourceLayer: 'authenticated', runtimeMode: RUNTIME_MODES.browserBridgeRequired },
      { id: 'missing', name: 'Missing auth', status: 'candidate', authRequired: true, activationBlockedReason: 'missing_auth_evidence', evidenceMatrix: { missingEvidence: ['login_page'] } },
      { id: 'delete', name: 'Delete', status: 'disabled', risk_level: 'write_high', enabled_status: 'disabled', activationBlockedReason: 'risk-policy-disabled' },
    ],
  );

  assert.equal(coverage.crawlMode, 'mixed');
  assert.equal(coverage.authMethod, 'browser');
  assert.equal(coverage.public.pages, 1);
  assert.equal(coverage.public.nodes, 2);
  assert.equal(coverage.public.capabilities, 2);
  assert.equal(coverage.publicRendered.pages, 1);
  assert.equal(coverage.publicRendered.nodes, 1);
  assert.equal(coverage.authorizedSource.pages, 1);
  assert.equal(coverage.authorizedSource.nodes, 1);
  assert.equal(coverage.authorizedSource.capabilities, 1);
  assert.equal(coverage.authenticated.pages, 2);
  assert.equal(coverage.authenticated.nodes, 1);
  assert.equal(coverage.authenticated.capabilities, 1);
  assert.equal(coverage.overlay.pagesRevisited, 1);
  assert.equal(coverage.overlay.newNodes, 1);
  assert.equal(coverage.overlay.newAffordances, 1);
  assert.deepEqual(coverage.requiresLoginButMissing, [{
    id: 'missing',
    name: 'Missing auth',
    missingEvidence: ['login_page'],
  }]);
  assert.deepEqual(coverage.blockedByRisk, [{
    id: 'delete',
    name: 'Delete',
    riskLevel: 'write_high',
    enabledStatus: 'disabled',
    reason: 'risk-policy-disabled',
  }]);
  assert.equal(coverage.blockedByAuth.length, 2);
  assert.deepEqual(coverage.blockedByAuth.map((gap) => gap.id), ['dm', 'missing']);
  assert.equal(coverage.runtime.httpRuntimeCapabilities, 2);
  assert.equal(coverage.runtime.browserBridgeRuntimeCapabilities, 1);
  assert.equal(coverage.runtime.runtimeIneligibleCapabilities, 1);
  assert.equal(coverage.runtime.blockedChallengeOrRuntimeIneligible, 3);
});
