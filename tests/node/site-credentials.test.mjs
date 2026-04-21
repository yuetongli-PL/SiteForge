import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { siteCredentials } from '../../scripts/site-credentials.mjs';

function createDouyinProfile() {
  return {
    profile: {
      host: 'www.douyin.com',
      authSession: {
        credentialTarget: 'BrowserWikiSkill:douyin.com',
      },
    },
    warnings: [],
    filePath: path.resolve('profiles/www.douyin.com.json'),
  };
}

test('siteCredentials set stores WinCred secrets using the profile target', async () => {
  const calls = [];
  const report = await siteCredentials('set', 'https://www.douyin.com/', {
    profilePath: path.resolve('profiles/www.douyin.com.json'),
    username: 'douyin-user',
    password: 'douyin-pass',
  }, {
    resolveSiteAuthProfile: async () => createDouyinProfile(),
    setWindowsCredential: async (target, payload) => {
      calls.push({ target, payload });
      return {
        stored: true,
        target,
        username: payload.username,
      };
    },
  });

  assert.equal(report.stored, true);
  assert.equal(report.target, 'BrowserWikiSkill:douyin.com');
  assert.equal(report.username, 'douyin-user');
  assert.equal(calls.length, 1);
});

test('siteCredentials show and delete surface WinCred metadata without leaking the password', async () => {
  const shown = await siteCredentials('show', 'https://www.douyin.com/', {
    profilePath: path.resolve('profiles/www.douyin.com.json'),
  }, {
    resolveSiteAuthProfile: async () => createDouyinProfile(),
    getWindowsCredential: async () => ({
      found: true,
      username: 'douyin-user',
      password: 'secret',
      comment: 'saved',
    }),
  });
  const removed = await siteCredentials('delete', 'https://www.douyin.com/', {
    profilePath: path.resolve('profiles/www.douyin.com.json'),
  }, {
    resolveSiteAuthProfile: async () => createDouyinProfile(),
    deleteWindowsCredential: async () => ({
      deleted: true,
      found: true,
    }),
  });

  assert.equal(shown.found, true);
  assert.equal(shown.username, 'douyin-user');
  assert.equal(Object.prototype.hasOwnProperty.call(shown, 'password'), false);
  assert.equal(removed.deleted, true);
  assert.equal(removed.target, 'BrowserWikiSkill:douyin.com');
});
