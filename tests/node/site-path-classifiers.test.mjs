import test from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyJableModelsPath,
  isJableModelsDetailPath,
  isJableModelsListPath,
} from '../../src/sites/core/site-path-classifiers.mjs';

test('classifyJableModelsPath distinguishes list and detail pages', () => {
  assert.equal(classifyJableModelsPath('/models/'), 'list');
  assert.equal(classifyJableModelsPath('/models'), 'list');
  assert.equal(classifyJableModelsPath('/models/2/'), 'list');
  assert.equal(classifyJableModelsPath('/models/206/'), 'list');
  assert.equal(classifyJableModelsPath('/models/momo/'), 'detail');
  assert.equal(classifyJableModelsPath('/models/06bfdb4435a64f0d14ba8371dfef4ad2/'), 'detail');
});

test('isJableModelsListPath and isJableModelsDetailPath expose stable booleans', () => {
  assert.equal(isJableModelsListPath('/models/2/'), true);
  assert.equal(isJableModelsDetailPath('/models/2/'), false);
  assert.equal(isJableModelsListPath('/models/momo/'), false);
  assert.equal(isJableModelsDetailPath('/models/momo/'), true);
});
