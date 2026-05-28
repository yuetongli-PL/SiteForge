import test from 'node:test';
import assert from 'node:assert/strict';

import {
  browserBridgeMissingRouteTemplateSet,
  browserBridgePageWasCaptured,
  browserBridgeRouteCaptured,
  browserBridgeRouteRetryable,
  configuredAuthRouteTemplateSet,
  matchesBrowserBridgeMissingNonRootRoute,
  matchesBrowserBridgeMissingRoute,
  matchesConfiguredAuthRoute,
  routeCapturePlanFromAuthState,
  routeTemplateComparisonValues,
} from '../../src/app/pipeline/build/browser-bridge-route-coverage.mjs';

function context(overrides = {}) {
  return {
    site: {
      id: 'site:example',
      rootUrl: 'https://example.test/',
    },
    buildId: 'build-route-coverage',
    crawlContract: {
      coverageTargets: {
        authRoutes: ['/account/settings'],
      },
    },
    options: {},
    ...overrides,
  };
}

test('browser bridge route coverage normalizes configured auth route variants', () => {
  const configured = configuredAuthRouteTemplateSet(context({
    options: {
      authRoutes: ['https://example.test/member/orders?tab=all'],
      localBuildConfig: {
        authRoutes: ['/profile/'],
      },
    },
  }));

  assert.equal(configured.has('/account/settings'), true);
  assert.equal(configured.has('/account/settings/'), true);
  assert.equal(configured.has('/member/orders'), true);
  assert.equal(configured.has('/member/orders/'), true);
  assert.equal(configured.has('/profile'), true);
  assert.equal(configured.has('/profile/'), true);
  assert.equal(matchesConfiguredAuthRoute(context(), configured, ['https://example.test/account/settings?from=home']), true);
  assert.equal(matchesConfiguredAuthRoute(context(), configured, ['/public']), false);
});

test('browser bridge route coverage separates captured and missing pages', () => {
  const routeContext = context({
    authStateReport: {
      authMethod: 'browser',
      browserBridge: {
        routeResults: [
          { routeId: 'captured-route', status: 'captured', targetRoute: '/profile' },
          { routeId: 'missing-route', status: 'timeout', targetUrl: 'https://example.test/messages?tab=1' },
          { routeId: 'warning-route', status: 'captured_with_warning', captured: false, routeTemplate: '/drafts' },
        ],
      },
    },
  });
  const missing = browserBridgeMissingRouteTemplateSet(routeContext);

  assert.equal(browserBridgeRouteCaptured({ status: 'captured_with_warning' }), true);
  assert.equal(browserBridgeRouteCaptured({ status: 'captured_with_warning', captured: false }), false);
  assert.equal(matchesBrowserBridgeMissingRoute(routeContext, missing, ['/messages/']), true);
  assert.equal(matchesBrowserBridgeMissingNonRootRoute(routeContext, missing, ['/']), false);
  assert.equal(browserBridgePageWasCaptured(routeContext, { routeId: 'captured-route' }), true);
  assert.equal(browserBridgePageWasCaptured(routeContext, { routeId: 'missing-route' }), false);
  assert.equal(browserBridgePageWasCaptured(routeContext, { routeTemplate: '/messages' }), false);
  assert.equal(browserBridgePageWasCaptured(context(), { routeTemplate: '/messages' }), true);
});

test('browser bridge route capture plan models retry policy and sanitized counts', () => {
  const routeContext = context();
  const authStateReport = {
    authMethod: 'browser',
    authVerificationStatus: 'browser_verified_partial',
    browserBridge: {
      routeCoverageStatus: 'partial',
      capturedRouteCount: 1,
      routeCount: 3,
      missingRouteCount: 2,
      routeQueueTruncated: true,
      routeResults: [
        { routeId: 'home', status: 'captured', targetRoute: '/' },
        {
          routeId: 'retryable',
          status: 'blocked',
          reasonCode: 'browser-bridge-route-open-failed',
          targetRoute: '/messages',
          retryAttemptCount: 2,
        },
        {
          routeId: 'limited',
          status: 'blocked',
          finalReasonCode: 'browser-bridge-route-limit-exceeded',
          targetRoute: '/orders',
        },
      ],
    },
  };

  const plan = routeCapturePlanFromAuthState(routeContext, authStateReport);

  assert.equal(plan.artifactFamily, 'siteforge-route-capture-plan');
  assert.equal(plan.status, 'partial');
  assert.equal(plan.capturedRouteCount, 1);
  assert.equal(plan.missingRouteCount, 2);
  assert.equal(plan.unattemptedRouteCount, 1);
  assert.equal(plan.routeQueueStatus, 'truncated');
  assert.deepEqual(
    plan.missingRoutes.map((route) => [route.routeId, route.retryable, route.recommendedRetryMode]),
    [
      ['retryable', true, 'browser_bridge_missing_route_retry'],
      ['limited', false, 'split_browser_bridge_route_batch'],
    ],
  );
  assert.equal(plan.safety.rawHtmlPersisted, false);
});

test('browser bridge route retry policy treats definite challenges as access boundaries', () => {
  assert.equal(browserBridgeRouteRetryable({ status: 'timeout' }), true);
  assert.equal(browserBridgeRouteRetryable({
    status: 'challenge_detected',
    reasonCode: 'browser-bridge-definite-challenge',
  }), false);
  assert.equal(browserBridgeRouteRetryable({
    status: 'blocked',
    reasonCode: 'execute-script-failed',
  }), true);
  assert.equal(routeTemplateComparisonValues(context(), ['https://example.test/a/b?x=1']).includes('/a/b'), true);
  assert.equal(routeCapturePlanFromAuthState(context(), { authMethod: 'cookie' }), null);
});
