import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSessionRepairPlanCommand,
  quoteCommandArg,
} from '../../src/sites/sessions/repair-command.mjs';

test('session repair command builds session gate reason guidance', () => {
  const command = buildSessionRepairPlanCommand({
    site: 'x',
    reason: 'session-health-manifest-missing',
  });

  assert.equal(command.command, 'session-repair-plan');
  assert.deepEqual(command.argv, [
    'node',
    'src/entrypoints/sites/session-repair-plan.mjs',
    '--site',
    'x',
    '--session-gate-reason',
    'session-health-manifest-missing',
  ]);
  assert.equal(
    command.commandText,
    'node src/entrypoints/sites/session-repair-plan.mjs --site x --session-gate-reason session-health-manifest-missing',
  );
});

test('session repair command builds audit manifest guidance with quoting', () => {
  const command = buildSessionRepairPlanCommand({
    site: 'instagram',
    auditManifest: 'runs/download release audit/download-release-audit.json',
  });

  assert.equal(command.auditManifest, 'runs/download release audit/download-release-audit.json');
  assert.deepEqual(command.argv, [
    'node',
    'src/entrypoints/sites/session-repair-plan.mjs',
    '--site',
    'instagram',
    '--audit-manifest',
    'runs/download release audit/download-release-audit.json',
  ]);
  assert.equal(
    command.commandText,
    'node src/entrypoints/sites/session-repair-plan.mjs --site instagram --audit-manifest "runs/download release audit/download-release-audit.json"',
  );
});

test('session repair command returns null without site', () => {
  assert.equal(buildSessionRepairPlanCommand({ reason: 'session-provider-missing' }), null);
});

test('session repair command quotes embedded double quotes', () => {
  assert.equal(quoteCommandArg('runs/"quoted path"/manifest.json'), '"runs/\\"quoted path\\"/manifest.json"');
});
