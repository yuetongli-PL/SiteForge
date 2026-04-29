import test from 'node:test';
import assert from 'node:assert/strict';

import { renderSessionTraceabilityLines } from '../../src/sites/downloads/session-report.mjs';

test('download session report suggests repair plan command only for blocked gates', () => {
  const blockedLines = renderSessionTraceabilityLines({
    siteKey: 'x',
    session: {
      provider: 'unified-session-runner',
      mode: 'authenticated',
    },
  }, {
    plan: { sessionRequirement: 'required' },
  });

  assert.match(
    blockedLines.join('\n'),
    /Next session repair command: node src\/entrypoints\/sites\/session-repair-plan\.mjs --site x --session-gate-reason session-health-manifest-missing/u,
  );

  const passedLines = renderSessionTraceabilityLines({
    siteKey: 'x',
    session: {
      provider: 'unified-session-runner',
      mode: 'authenticated',
      healthManifest: 'runs/session/x/manifest.json',
    },
  }, {
    plan: { sessionRequirement: 'required' },
  });

  assert.equal(passedLines.some((line) => line.includes('Next session repair command')), false);
});
