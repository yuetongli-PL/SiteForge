import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPageReconciliationReport,
  classifyPageReconciliationOutcome,
  isReconciliationCategoryLink,
  reconciliationRouteKey,
} from '../../src/app/pipeline/build/page-reconciliation-report.mjs';

const context = {
  buildId: 'build-1',
  inputUrl: 'https://example.test/?token=synthetic-secret',
  site: {
    id: 'example-test',
    rootUrl: 'https://example.test/',
  },
};

test('page reconciliation helpers normalize routes and classify category links', () => {
  assert.equal(
    reconciliationRouteKey('/categories?token=synthetic-secret#top', context.site.rootUrl),
    'https://example.test/categories',
  );
  assert.equal(isReconciliationCategoryLink({ href: '/categories', label: 'Categories', kind: 'navigation' }), true);
  assert.deepEqual(classifyPageReconciliationOutcome([]), {
    status: 'passed',
    blockerClass: 'none',
    primaryReasonCode: null,
    retryDisposition: 'no_retry',
  });
});

test('page reconciliation report passes when category routes, capabilities, and intents line up', () => {
  const report = buildPageReconciliationReport(context, {
    crawlStatic: {
      pages: [{
        normalizedUrl: 'https://example.test/',
        title: 'Home',
        links: [{ href: 'https://example.test/categories?token=synthetic-secret', label: 'Categories' }],
      }],
    },
    classifyNodes: {
      graph: {
        nodes: [{ id: 'node-category', normalizedUrl: 'https://example.test/categories' }],
      },
    },
    discoverCapabilities: {
      capabilities: [{
        id: 'cap-category',
        name: '分类列表',
        status: 'active',
        enabled_status: 'enabled',
      }],
    },
    generateIntents: {
      intents: [{
        id: 'intent-category',
        capabilityId: 'cap-category',
        canonicalUtterance: '查看分类',
        callable: true,
      }],
    },
  }, { status: 'success' });

  assert.equal(report.artifactFamily, 'siteforge-page-reconciliation-report');
  assert.equal(report.status, 'passed');
  assert.equal(report.summary.expectedCategoryLinks, 1);
  assert.equal(report.summary.missingCategoryLinks, 0);
  assert.equal(report.summary.categoryCapabilities, 1);
  assert.equal(report.summary.categoryIntents, 1);
  assert.deepEqual(report.summary.reasonCodes, []);
  assert.equal(JSON.stringify(report).includes('synthetic-secret'), false);
});

test('page reconciliation report blocks external challenge pages without raw material', () => {
  const report = buildPageReconciliationReport(context, {
    crawlStatic: {
      pages: [{
        normalizedUrl: 'https://example.test/cdn-cgi/challenge-platform/h/g?token=synthetic-secret',
        title: 'Cloudflare challenge',
        pageType: 'challenge',
        sourceLayer: 'public',
      }],
    },
  }, { status: 'failed' });

  assert.equal(report.status, 'blocked');
  assert.equal(report.summary.blockerClass, 'external_challenge');
  assert.equal(report.summary.primaryReasonCode, 'blocked-by-cloudflare-challenge');
  assert.equal(report.summary.rerunBlocked, true);
  assert.equal(report.challengePages.length, 1);
  assert.equal(report.safety.cookiePersisted, false);
  assert.equal(JSON.stringify(report).includes('synthetic-secret'), false);
});
