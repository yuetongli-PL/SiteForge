import test from 'node:test';
import assert from 'node:assert/strict';

import {
  deleteWindowsCredential,
  getWindowsCredential,
  resolveWindowsCredentialTarget,
  setWindowsCredential,
} from '../../src/infra/auth/windows-credential-manager.mjs';

test('resolveWindowsCredentialTarget uses explicit targets and shared profile keys', () => {
  assert.equal(
    resolveWindowsCredentialTarget('https://www.douyin.com/?recommend=1'),
    'BrowserWikiSkill:douyin.com',
  );
  assert.equal(
    resolveWindowsCredentialTarget('https://space.bilibili.com/1202350411/video'),
    'BrowserWikiSkill:bilibili.com',
  );
  assert.equal(
    resolveWindowsCredentialTarget('https://www.douyin.com/', { credentialTarget: 'Custom:Douyin' }),
    'Custom:Douyin',
  );
});

test('set/get/delete Windows credentials delegate through the PowerShell executor', async () => {
  const calls = [];
  const executePowerShell = async (_script, payload) => {
    calls.push(payload);
    if (payload.action === 'set') {
      return JSON.stringify({
        ok: true,
        stored: true,
        target: payload.target,
        username: payload.username,
      });
    }
    if (payload.action === 'get') {
      return JSON.stringify({
        ok: true,
        found: true,
        target: payload.target,
        username: 'stored-user',
        password: 'stored-pass',
        comment: 'comment',
      });
    }
    return JSON.stringify({
      ok: true,
      deleted: true,
      found: true,
      target: payload.target,
    });
  };

  const stored = await setWindowsCredential('BrowserWikiSkill:douyin.com', {
    username: 'stored-user',
    password: 'stored-pass',
    comment: 'comment',
  }, {
    executePowerShell,
  });
  const loaded = await getWindowsCredential('BrowserWikiSkill:douyin.com', {
    executePowerShell,
  });
  const deleted = await deleteWindowsCredential('BrowserWikiSkill:douyin.com', {
    executePowerShell,
  });

  assert.equal(stored.stored, true);
  assert.equal(stored.username, 'stored-user');
  assert.equal(loaded.found, true);
  assert.equal(loaded.username, 'stored-user');
  assert.equal(loaded.password, 'stored-pass');
  assert.equal(deleted.deleted, true);
  assert.deepEqual(calls.map((entry) => entry.action), ['set', 'get', 'delete']);
});
