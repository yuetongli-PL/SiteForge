import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';

import { ensureCrawlerScript } from '../../generate-crawler-script.mjs';
import {
  ProfileValidationError,
  validateProfileFile,
  validateProfileObject,
} from '../../lib/profile-validation.mjs';

test('validateProfileFile accepts the checked-in profiles', async () => {
  const twentyTwoBiqu = await validateProfileFile(path.resolve('profiles/www.22biqu.com.json'));
  const moodyz = await validateProfileFile(path.resolve('profiles/moodyz.com.json'));

  assert.equal(twentyTwoBiqu.valid, true);
  assert.equal(twentyTwoBiqu.host, 'www.22biqu.com');
  assert.equal(moodyz.valid, true);
  assert.equal(moodyz.host, 'moodyz.com');
});

test('validateProfileObject rejects missing required fields with path details', () => {
  assert.throws(() => validateProfileObject({
    host: 'moodyz.com',
    version: 2,
    pageTypes: {
      homeExact: ['/'],
      homePrefixes: [],
      searchResultsPrefixes: ['/search/list'],
      contentDetailPrefixes: ['/works/detail/'],
      authorPrefixes: ['/actress/detail/'],
      chapterPrefixes: [],
      historyPrefixes: [],
      authPrefixes: [],
      categoryPrefixes: ['/works/date'],
    },
    search: {
      formSelectors: ['form[action*="/search/list"]'],
      inputSelectors: [],
      submitSelectors: ['button[type="submit"]'],
      resultTitleSelectors: ['title'],
      resultBookSelectors: ['a[href*="/works/detail/"]'],
      knownQueries: [],
    },
    sampling: {
      searchResultContentLimit: 4,
      authorContentLimit: 10,
      categoryContentLimit: 10,
      fallbackContentLimitWithSearch: 8,
    },
    navigation: {
      allowedHosts: ['moodyz.com'],
      contentPathPrefixes: ['/works/detail/'],
      authorPathPrefixes: ['/actress/detail/'],
      categoryPathPrefixes: ['/works/date'],
      utilityPathPrefixes: ['/top'],
      authPathPrefixes: [],
      categoryLabelKeywords: ['WORKS'],
    },
    contentDetail: {
      titleSelectors: ['h2'],
      authorNameSelectors: ['a[href*="/actress/detail/"]'],
      authorLinkSelectors: ['a[href*="/actress/detail/"]'],
    },
    author: {
      titleSelectors: ['h2'],
    },
  }), (error) => {
    assert.ok(error instanceof ProfileValidationError);
    assert.match(error.message, /profile\.search\.inputSelectors: must contain at least 1 item\(s\)/);
    assert.match(error.message, /profile\.author\.workLinkSelectors: is required/);
    return true;
  });
});

test('ensureCrawlerScript fails fast when profile validation fails', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-profile-validation-'));
  const invalidProfilePath = path.join(workspace, 'moodyz.com.json');

  try {
    await writeFile(invalidProfilePath, `${JSON.stringify({
      host: 'moodyz.com',
      version: 2,
      search: {
        formSelectors: ['form[action*="/search/list"]'],
        inputSelectors: ['input[name="keyword"]'],
        submitSelectors: ['button[type="submit"]'],
        resultTitleSelectors: ['title'],
        resultBookSelectors: ['a[href*="/works/detail/"]'],
        knownQueries: [],
      },
    }, null, 2)}\n`, 'utf8');

    await assert.rejects(
      ensureCrawlerScript('https://moodyz.com/works/date', {
        profilePath: invalidProfilePath,
        crawlerScriptsDir: path.join(workspace, 'crawler-scripts'),
        knowledgeBaseDir: path.join(workspace, 'knowledge-base'),
      }),
      /profile\.pageTypes: is required/,
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
