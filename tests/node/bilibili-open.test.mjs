import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';

import { resolveBilibiliOpenDecision } from '../../src/sites/bilibili/navigation/open.mjs';
import { openBilibiliPage } from '../../scripts/open-bilibili-page.mjs';

function createAuthProfile() {
  return {
    profile: {
      host: 'www.bilibili.com',
      pageTypes: {
        homeExact: ['/'],
        homePrefixes: [],
        searchResultsPrefixes: ['/all', '/video', '/bangumi', '/upuser'],
        contentDetailPrefixes: ['/video/', '/bangumi/play/'],
        authorPrefixes: ['/space/'],
        authorListExact: [],
        authorListPrefixes: ['/video', '/upload/video', '/dynamic', '/fans/follow', '/fans/fans'],
        authorDetailPrefixes: ['/space/'],
        chapterPrefixes: [],
        historyPrefixes: [],
        authPrefixes: ['/login'],
        categoryPrefixes: ['/v/', '/anime/'],
      },
      authSession: {
        loginUrl: 'https://passport.bilibili.com/login',
        postLoginUrl: 'https://www.bilibili.com/',
        authRequiredAuthorSubpages: ['dynamic', 'fans/follow', 'fans/fans'],
        authRequiredPathPrefixes: ['/watchlater', '/favlist'],
      },
    },
    filePath: path.resolve('profiles/www.bilibili.com.json'),
    warnings: [],
  };
}

test('resolveBilibiliOpenDecision keeps public bilibili pages in the built-in browser', async () => {
  const decision = await resolveBilibiliOpenDecision('https://www.bilibili.com/video/BV1WjDDBGE3p', {}, {
    async resolveSiteAuthProfile() {
      return createAuthProfile();
    },
  });

  assert.equal(decision.authRequired, false);
  assert.equal(decision.openMode, 'builtin-browser');
  assert.equal(decision.pageType, 'book-detail-page');
});

test('resolveBilibiliOpenDecision routes authenticated bilibili author subpages to the local profile browser', async () => {
  const decision = await resolveBilibiliOpenDecision('https://space.bilibili.com/1202350411/fans/follow', {}, {
    async resolveSiteAuthProfile() {
      return createAuthProfile();
    },
  });

  assert.equal(decision.authRequired, true);
  assert.equal(decision.openMode, 'local-profile-browser');
  assert.equal(decision.pageType, 'author-list-page');
});

test('resolveBilibiliOpenDecision recognizes authenticated non-author bilibili surfaces from profile samples', async () => {
  const profile = createAuthProfile();

  const watchLaterDecision = await resolveBilibiliOpenDecision('https://www.bilibili.com/watchlater/#/list', {}, {
    async resolveSiteAuthProfile() {
      return profile;
    },
  });
  const favoriteDecision = await resolveBilibiliOpenDecision('https://space.bilibili.com/99887766/favlist?fid=622146', {}, {
    async resolveSiteAuthProfile() {
      return profile;
    },
  });

  assert.equal(watchLaterDecision.authRequired, true);
  assert.equal(watchLaterDecision.openMode, 'local-profile-browser');
  assert.equal(favoriteDecision.authRequired, true);
  assert.equal(favoriteDecision.openMode, 'local-profile-browser');
});

test('openBilibiliPage triggers interactive login bootstrap when reusable auth is missing', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-bilibili-open-'));
  const siteLoginCalls = [];
  const openCalls = [];

  try {
    const report = await openBilibiliPage('https://space.bilibili.com/1202350411/dynamic', {
      outDir: workspace,
      allowAutoLoginBootstrap: true,
    }, {
      async resolveBilibiliOpenDecision() {
        return {
          targetUrl: 'https://space.bilibili.com/1202350411/dynamic',
          pageType: 'author-list-page',
          authRequired: true,
          openMode: 'local-profile-browser',
          reason: 'auth-required',
          profilePath: path.resolve('profiles/www.bilibili.com.json'),
          warnings: [],
        };
      },
      async siteLogin(_inputUrl, options) {
        siteLoginCalls.push(options);
        if (siteLoginCalls.length === 1) {
          return {
            auth: {
              status: 'credentials-unavailable',
              persistenceVerified: false,
            },
            site: {
              userDataDir: 'C:/profiles/bilibili.com',
            },
          };
        }
        return {
          auth: {
            status: 'manual-login-complete',
            persistenceVerified: true,
          },
          site: {
            userDataDir: 'C:/profiles/bilibili.com',
          },
        };
      },
      async openBilibiliPageInLocalBrowser(targetUrl) {
        openCalls.push(targetUrl);
        return {
          opened: true,
          openedTargetUrl: targetUrl,
          browserAttachedVia: 'existing-target',
          reusedBrowserInstance: true,
          userDataDir: 'C:/profiles/bilibili.com',
          browserPath: 'C:/Chrome/chrome.exe',
        };
      },
    });

    assert.equal(siteLoginCalls.length, 2);
    assert.equal(siteLoginCalls[0].headless, true);
    assert.equal(siteLoginCalls[0].waitForManualLogin, false);
    assert.equal(siteLoginCalls[1].headless, false);
    assert.equal(siteLoginCalls[1].waitForManualLogin, true);
    assert.deepEqual(openCalls, ['https://space.bilibili.com/1202350411/dynamic']);
    assert.equal(report.site.openMode, 'local-profile-browser');
    assert.equal(report.authBootstrap.triggeredInteractiveLogin, true);
    assert.equal(report.result.opened, true);
    assert.equal(report.result.reasonCode, 'opened-authenticated-page');
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('openBilibiliPage does not trigger local login for public pages', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-bilibili-open-public-'));

  try {
    const report = await openBilibiliPage('https://www.bilibili.com/anime/', {
      outDir: workspace,
    }, {
      async resolveBilibiliOpenDecision() {
        return {
          targetUrl: 'https://www.bilibili.com/anime/',
          pageType: 'category-page',
          authRequired: false,
          openMode: 'builtin-browser',
          reason: 'public-page',
          profilePath: path.resolve('profiles/www.bilibili.com.json'),
          warnings: [],
        };
      },
      async siteLogin() {
        throw new Error('siteLogin should not run for public bilibili pages');
      },
      async openBilibiliPageInLocalBrowser() {
        return {
          opened: true,
          openedTargetUrl: 'https://www.bilibili.com/anime/',
          browserAttachedVia: 'created-target',
          reusedBrowserInstance: false,
          userDataDir: 'C:/profiles/bilibili.com',
          browserPath: 'C:/Chrome/chrome.exe',
          localFallbackUsed: true,
        };
      },
    });

    assert.equal(report.site.openMode, 'builtin-browser');
    assert.equal(report.authBootstrap.attempted, false);
    assert.equal(report.result.opened, true);
    assert.equal(report.result.localFallbackUsed, true);
    assert.equal(report.result.reasonCode, 'opened-public-page');
    assert.match(report.warnings.join('\n'), /built-in browser directly/u);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('openBilibiliPage reports structured bootstrap failure reasons', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-bilibili-open-fail-'));

  try {
    const report = await openBilibiliPage('https://space.bilibili.com/1202350411/fans/follow', {
      outDir: workspace,
      allowAutoLoginBootstrap: true,
    }, {
      async resolveBilibiliOpenDecision() {
        return {
          targetUrl: 'https://space.bilibili.com/1202350411/fans/follow',
          pageType: 'author-list-page',
          authRequired: true,
          openMode: 'local-profile-browser',
          reason: 'auth-required',
          profilePath: path.resolve('profiles/www.bilibili.com.json'),
          warnings: [],
        };
      },
      async siteLogin() {
        return {
          auth: {
            status: 'challenge-required',
            persistenceVerified: false,
          },
          site: {
            userDataDir: 'C:/profiles/bilibili.com',
          },
        };
      },
    });

    assert.equal(report.result.opened, false);
    assert.equal(report.result.reasonCode, 'login-bootstrap-challenge-required');
    assert.equal(report.authBootstrap.attempted, false);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
