import assert from 'node:assert/strict';
import test from 'node:test';

import { parseSocialActionArgs } from '../../src/sites/known-sites/social/actions/cli.mjs';
import {
  parseSocialRelationApiPayload,
} from '../../src/sites/known-sites/social/actions/router.mjs';
import { parseBrowserCookieFileText } from '../../src/infra/auth/browser-cookie-file.mjs';

test('instagram cookie file parser summarizes browser table rows without persisting values', () => {
  const parsed = parseBrowserCookieFileText([
    'csrftoken\tsecret-csrf\t.instagram.com\t/\t2027-07-14T07:54:42.591Z\t41\t\t✓\tLax',
    'sessionid\tsecret-session\t.instagram.com\t/\t2027-06-09T07:54:42.592Z\t88\t✓\t✓\tNone',
    'external\tignored\texample.com\t/\t2027-06-09T07:54:42.592Z',
  ].join('\n'), {
    targetUrl: 'https://www.instagram.com/openai/',
  });

  assert.equal(parsed.cookies.length, 2);
  assert.equal(parsed.summary.source, 'user-provided-login-state-file');
  assert.equal(parsed.summary.matchedItemCount, 2);
  assert.equal(parsed.summary.filePathPersisted, false);
  assert.equal(parsed.summary.valuesPersisted, false);
  assert.doesNotMatch(JSON.stringify(parsed.summary), /secret-csrf|secret-session|csrftoken|sessionid/u);
});

test('social action CLI parses transient instagram cookie file option', () => {
  const parsed = parseSocialActionArgs([
    'profile-content',
    '--site',
    'instagram',
    '--account',
    'openai',
    '--cookie-file',
    'C:/Users/example/ig-cookies.txt',
  ]);

  assert.equal(parsed.site, 'instagram');
  assert.equal(parsed.action, 'profile-content');
  assert.equal(parsed.cookieFile, 'C:/Users/example/ig-cookies.txt');
});

test('instagram relation API payload parser extracts relation users and cursor', () => {
  const parsed = parseSocialRelationApiPayload('instagram', {
    users: [
      { pk: '1', username: 'openai', full_name: 'OpenAI', is_verified: true },
      { id: '2', username: 'codex', full_name: 'Codex' },
      { username: 'openai', full_name: 'Duplicate' },
    ],
    next_max_id: 'cursor-1',
  });

  assert.equal(parsed.users.length, 2);
  assert.equal(parsed.users[0].handle, 'openai');
  assert.equal(parsed.users[0].verified, true);
  assert.equal(parsed.nextCursor, 'cursor-1');
});
