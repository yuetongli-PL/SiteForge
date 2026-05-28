import test from 'node:test';
import assert from 'node:assert/strict';

import { buildUserFacingWarnings } from '../../src/app/pipeline/build/user-report-warnings.mjs';

test('user report warnings translate build warnings and include partial success reasons', () => {
  assert.deepEqual(buildUserFacingWarnings(
    { warnings: ['network-fetch-failed', 'robots-disallowed'] },
    'partial_success',
    null,
    ['Some capabilities still need evidence.'],
  ), [
    'Network fetch failed; raw error details were not saved.',
    'robots.txt blocked the candidate crawl scope.',
    'Some capabilities still need evidence.',
  ]);
});

test('user report warnings add modeled auto-discovery and raw-network notices', () => {
  const warnings = buildUserFacingWarnings(
    { warnings: ['network-fetch-failed'] },
    'success',
    {
      options: { internalRawNetwork: true },
      setupProfile: {
        userAuthorizedEvidence: {
          autoDiscovery: {
            status: 'modeled',
            dynamicEnabled: false,
            networkEnabled: true,
          },
        },
      },
    },
  );

  assert.equal(warnings.includes('Auto-discovery used sanitized SPA route/state summaries; browser-rendered crawl and raw network tracing are not enabled in this public build path.'), true);
  assert.equal(warnings.includes('Raw network capture was enabled; raw artifacts are kept out of generated Skill, current outputs, and registry.'), true);
});

test('user report warnings include failure reason only for failed results', () => {
  assert.equal(buildUserFacingWarnings({ reason: 'Fix robots and rerun.' }, 'success').includes('Fix robots and rerun.'), false);
  assert.equal(buildUserFacingWarnings({ reason: 'Fix robots and rerun.' }, 'failed').includes('Fix robots and rerun.'), true);
});
