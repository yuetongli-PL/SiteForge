import test from 'node:test';
import assert from 'node:assert/strict';

import { authorizedSourcesSummaryForReport } from '../../src/app/pipeline/build/authorized-sources-report.mjs';

test('authorized sources summary defaults to empty report', () => {
  assert.deepEqual(authorizedSourcesSummaryForReport({}), {
    configured: 0,
    sources: [],
    note: null,
  });
});

test('authorized sources summary sanitizes configured sources and forces non-promotion flags', () => {
  const summary = authorizedSourcesSummaryForReport({
    options: {
      authorizedSources: [{
        id: 'feed-1',
        type: 'rss',
        url: 'https://example.test/feed?token=synthetic-secret',
        authorizationBasis: 'site docs',
        permissionScope: 'public metadata',
        allowedEvidence: ['schema_hash', 'schema_hash', 'response_shape'],
        genericCrawlAllowed: true,
        promotionAllowed: true,
      }],
    },
  });

  assert.equal(summary.configured, 1);
  assert.equal(summary.sources[0].kind, 'rss');
  assert.equal(summary.sources[0].genericCrawlAllowed, false);
  assert.equal(summary.sources[0].promotionAllowed, false);
  assert.deepEqual(summary.sources[0].allowedEvidence, ['response_shape', 'schema_hash']);
  assert.equal(JSON.stringify(summary).includes('synthetic-secret'), false);
  assert.match(summary.note, /not robots\/challenge bypasses/u);
});

test('authorized sources summary reads setup profile fallback', () => {
  const summary = authorizedSourcesSummaryForReport({
    setupProfile: {
      localBuildConfig: {
        authorizedSources: [{
          id: 'setup-source',
          kind: 'user_sanitized_summary',
        }],
      },
    },
  });

  assert.equal(summary.configured, 1);
  assert.equal(summary.sources[0].id, 'setup-source');
  assert.equal(summary.sources[0].kind, 'user_sanitized_summary');
});
