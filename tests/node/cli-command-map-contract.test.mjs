import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveCliDispatch } from '../../src/entrypoints/cli/index.mjs';
import {
  buildCliCommand,
  downloadCliCommand,
  unifiedCliCommand,
} from '../../src/infra/cli/command-map.mjs';

function splitCommand(command) {
  return String(command).trim().split(/\s+/u);
}

function assertPublicBuildCommandAccepted(command) {
  const argv = splitCommand(command);
  assert.equal(argv[0], 'siteforge');
  assert.equal(argv[1], 'build');
  const dispatch = resolveCliDispatch(argv.slice(1));
  assert.equal(dispatch.args[0], argv[2]);
  return dispatch;
}

test('command map generated public build commands resolve through the public CLI facade', () => {
  for (const command of [
    buildCliCommand('https://example.com/'),
    unifiedCliCommand(['build', 'https://example.com/', '--auto', '--privacy', 'limited']),
    unifiedCliCommand(['build', 'https://example.com/', '--report', 'debug']),
    downloadCliCommand({ input: 'https://example.com/' }),
    downloadCliCommand({ mode: 'execute', input: 'https://example.com/', args: ['--report', 'user'] }),
  ]) {
    assertPublicBuildCommandAccepted(command);
  }
});

test('command map refuses unsupported public build flags', () => {
  for (const flag of ['--site', '--capability', '--cookie']) {
    assert.throws(
      () => downloadCliCommand({ input: 'https://example.com/', args: [flag, flag === '--site' ? 'x' : 'value'] }),
      new RegExp(flag, 'u'),
    );
  }
});

test('download command map uses internal site action entrypoints for site-specific routes', () => {
  const command = downloadCliCommand({
    input: 'https://x.com/example/status/1',
    site: 'x',
    args: ['--json'],
  });

  assert.equal(
    command,
    'node src/entrypoints/sites/x-action.mjs download https://x.com/example/status/1 --json',
  );
  assert.doesNotMatch(command, /^siteforge build/u);
  assert.doesNotMatch(command, / --site\b/u);
});
