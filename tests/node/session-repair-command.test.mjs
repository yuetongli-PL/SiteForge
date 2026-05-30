import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSessionRepairPlanCommand,
  quoteCommandArg,
} from '../../src/domain/sessions/repair-command.mjs';

test('session repair command builds session gate reason guidance', () => {
  const command = buildSessionRepairPlanCommand({
    site: 'x',
    reason: 'session-health-manifest-missing',
  });

  assert.equal(command.command, 'siteforge-build');
  assert.deepEqual(command.argv, [
    'siteforge',
    'build',
    '<url>',
  ]);
  assert.equal(command.site, 'x');
  assert.equal(command.reason, 'session-health-manifest-missing');
  assert.equal(
    command.commandText,
    'siteforge build <url>',
  );
});

test('session repair command builds audit manifest guidance with quoting', () => {
  const command = buildSessionRepairPlanCommand({
    site: 'instagram',
    auditManifest: 'runs/download release audit/download-release-audit.json',
  });

  assert.equal(command.auditManifest, 'runs/download release audit/download-release-audit.json');
  assert.deepEqual(command.argv, [
    'siteforge',
    'build',
    '<url>',
  ]);
  assert.equal(
    command.commandText,
    'siteforge build <url>',
  );
});

test('session repair command returns null without site', () => {
  assert.equal(buildSessionRepairPlanCommand({ reason: 'session-provider-missing' }), null);
});

test('session repair command quotes embedded double quotes', () => {
  assert.equal(quoteCommandArg('runs/"quoted path"/manifest.json'), '"runs/\\"quoted path\\"/manifest.json"');
});
