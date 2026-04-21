import test from 'node:test';
import assert from 'node:assert/strict';

import { displayIntentName, resolveSiteTerminology } from '../../src/sites/core/terminology.mjs';

test('terminology resolves through canonical adapter identity when host is unreliable', () => {
  const canonicalContext = {
    host: 'example.invalid',
    capabilitiesRecord: {
      siteKey: 'bilibili',
      adapterId: 'bilibili',
    },
  };
  const expectedTerms = resolveSiteTerminology({ host: 'www.bilibili.com' }, 'https://www.bilibili.com/');

  assert.deepEqual(
    resolveSiteTerminology(canonicalContext, 'https://example.invalid/'),
    expectedTerms,
  );
  assert.equal(
    displayIntentName('open-author', canonicalContext, 'https://example.invalid/'),
    displayIntentName('open-author', { host: 'www.bilibili.com' }, 'https://www.bilibili.com/'),
  );
});
