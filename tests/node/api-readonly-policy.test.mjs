import test from 'node:test';
import assert from 'node:assert/strict';

import {
  apiEndpointLooksWriteLike,
  hasSensitiveApiQueryMaterial,
  hasSubstantiveApiRequestBody,
  isKnownReadOnlyApiEndpoint,
  isReadOnlyApiMethod,
  normalizeApiMethod,
} from '../../src/app/pipeline/build/api-readonly-policy.mjs';

test('API read-only policy normalizes methods and request bodies', () => {
  assert.equal(normalizeApiMethod(' head '), 'HEAD');
  assert.equal(isReadOnlyApiMethod('GET'), true);
  assert.equal(isReadOnlyApiMethod('HEAD'), true);
  assert.equal(isReadOnlyApiMethod('POST'), false);
  assert.equal(hasSubstantiveApiRequestBody(null), false);
  assert.equal(hasSubstantiveApiRequestBody('[REDACTED]'), false);
  assert.equal(hasSubstantiveApiRequestBody({}), false);
  assert.equal(hasSubstantiveApiRequestBody({ page: 1 }), true);
});

test('API read-only policy classifies sensitive query and write-like endpoints', () => {
  assert.equal(hasSensitiveApiQueryMaterial('https://example.test/api/feed?page=1'), false);
  assert.equal(hasSensitiveApiQueryMaterial('https://example.test/api/feed?access_token=secret'), true);
  assert.equal(hasSensitiveApiQueryMaterial('not a url', { invalidAsSensitive: true }), true);
  assert.equal(apiEndpointLooksWriteLike({ url: 'https://example.test/api/feed?page=1', method: 'POST' }), false);
  assert.equal(apiEndpointLooksWriteLike({ url: 'https://example.test/api/update-profile', method: 'GET' }), true);
  assert.equal(isKnownReadOnlyApiEndpoint('https://www.douyin.com/aweme/v1/web/aweme/post/', 'GET'), true);
  assert.equal(apiEndpointLooksWriteLike({
    url: 'https://www.douyin.com/aweme/v1/web/aweme/post/',
    method: 'GET',
  }), false);
});
