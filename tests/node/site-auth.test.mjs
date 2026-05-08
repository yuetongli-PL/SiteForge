import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';

import { pathExists, readJsonFile } from '../../src/infra/io.mjs';
import {
  derivePersistentProfileKey,
  inspectPersistentProfileHealth,
  resolvePersistentUserDataDir,
} from '../../src/infra/browser/profile-store.mjs';
import {
  attemptCredentialLogin,
  ensureAuthenticatedSession,
  exportDownloadSessionPassthrough,
  exportSiteDownloadPassthrough,
  isAuthRequiredNavigationTarget,
  shouldEnsureAuthenticatedNavigationSession,
  shouldUsePersistentProfileForNavigation,
  resolveAuthKeepaliveUrl,
  resolveAuthVerificationUrl,
  resolveCredentialSource,
  inspectLoginState,
  inspectReusableSiteSession,
  isReusableLoginStateAvailable,
  pageAssistManualLoginStep,
  resolveSiteBrowserSessionOptions,
  waitForAuthenticatedSession,
} from '../../src/infra/auth/site-auth.mjs';

async function withFakePageDom({ selectorMap = {}, allNodes = [] }, callback) {
  const previous = {
    document: globalThis.document,
    window: globalThis.window,
    Element: globalThis.Element,
    HTMLElement: globalThis.HTMLElement,
    HTMLInputElement: globalThis.HTMLInputElement,
    MouseEvent: globalThis.MouseEvent,
    KeyboardEvent: globalThis.KeyboardEvent,
  };

  class FakeElement {
    constructor(options = {}) {
      const {
      attributes = {},
      children = [],
      className = '',
      height = 24,
      textContent = '',
      width = 120,
      } = options;
      this.attributes = attributes;
      this.className = className;
      this.textContent = textContent;
      this.width = width;
      this.height = height;
      this.dispatchedEvents = [];
      this.clicked = false;
      this.focused = false;
      this.children = children;
    }

    getAttribute(name) {
      return this.attributes[name] ?? null;
    }

    hasAttribute(name) {
      return Object.hasOwn(this.attributes, name);
    }

    getBoundingClientRect() {
      return {
        width: this.width,
        height: this.height,
      };
    }

    focus() {
      this.focused = true;
    }

    contains(node) {
      return this.children.includes(node);
    }
  }

  class FakeHTMLElement extends FakeElement {
    dispatchEvent(event) {
      this.dispatchedEvents.push(event.type);
      return true;
    }

    click() {
      this.clicked = true;
    }
  }

  class FakeInputElement extends FakeHTMLElement {
    constructor(options = {}) {
      super(options);
      this.value = options.value ?? '';
    }
  }

  class FakeEvent {
    constructor(type) {
      this.type = type;
    }
  }

  globalThis.Element = FakeElement;
  globalThis.HTMLElement = FakeHTMLElement;
  globalThis.HTMLInputElement = FakeInputElement;
  globalThis.MouseEvent = FakeEvent;
  globalThis.KeyboardEvent = FakeEvent;
  globalThis.document = {
    querySelector(selector) {
      return selectorMap[selector] ?? null;
    },
    querySelectorAll() {
      return allNodes;
    },
  };
  globalThis.window = {
    getComputedStyle() {
      return {
        display: 'block',
        visibility: 'visible',
        opacity: '1',
      };
    },
  };

  try {
    return await callback({
      FakeElement,
      FakeHTMLElement,
      FakeInputElement,
    });
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete globalThis[key];
      } else {
        globalThis[key] = value;
      }
    }
  }
}

test('derivePersistentProfileKey groups bilibili subdomains under the same persistent profile key', () => {
  assert.equal(derivePersistentProfileKey('https://www.bilibili.com/'), 'bilibili.com');
  assert.equal(derivePersistentProfileKey('https://search.bilibili.com/video?keyword=BV1WjDDBGE3p'), 'bilibili.com');
  assert.equal(derivePersistentProfileKey('https://space.bilibili.com/1202350411/video'), 'bilibili.com');
});

test('derivePersistentProfileKey keeps Douyin URLs on the shared douyin.com profile key', () => {
  assert.equal(derivePersistentProfileKey('https://www.douyin.com/?recommend=1'), 'douyin.com');
  assert.equal(derivePersistentProfileKey('https://www.douyin.com/user/self?showTab=like'), 'douyin.com');
  assert.equal(derivePersistentProfileKey('https://www.douyin.com/follow?tab=user'), 'douyin.com');
});

test('waitForAuthenticatedSession keeps polling through transient page inspection errors', async () => {
  let calls = 0;
  const session = {
    async callPageFunction() {
      calls += 1;
      if (calls === 1) {
        throw new Error('CDP socket closed: transient navigation');
      }
      return {
        currentUrl: 'https://x.com/home',
        title: 'Home / X',
        loggedIn: true,
        loginStateDetected: true,
        identityConfirmed: true,
        identitySource: 'selector:a[data-testid="AppTabBar_Home_Link"]',
      };
    },
  };

  const result = await waitForAuthenticatedSession(session, {
    host: 'x.com',
    loginUrl: 'https://x.com/i/flow/login',
    loginIndicatorSelectors: ['a[data-testid="AppTabBar_Home_Link"]'],
    loggedOutIndicatorSelectors: ['a[href*="/i/flow/login"]'],
    usernameSelectors: [],
    passwordSelectors: [],
    challengeSelectors: [],
  }, {
    timeoutMs: 1000,
    pollMs: 1,
  });

  assert.equal(result.status, 'authenticated');
  assert.equal(calls, 2);
});

test('waitForAuthenticatedSession can assist a manual multi-step login before polling state', async () => {
  const calls = [];
  let inspections = 0;
  const session = {
    async callPageFunction(fn) {
      calls.push(fn.name);
      if (fn.name === 'pageAssistManualLoginStep') {
        return { status: 'next-clicked' };
      }
      inspections += 1;
      return {
        identityConfirmed: inspections >= 2,
      };
    },
  };

  const result = await waitForAuthenticatedSession(session, {
    host: 'x.com',
    loginUrl: 'https://x.com/i/flow/login',
    loginIndicatorSelectors: ['a[data-testid="AppTabBar_Home_Link"]'],
    loggedOutIndicatorSelectors: ['input[autocomplete="username"]'],
    usernameSelectors: ['input[autocomplete="username"]'],
    passwordSelectors: ['input[name="password"]'],
    challengeSelectors: [],
  }, {
    assistManualLogin: true,
    timeoutMs: 1000,
    pollMs: 1,
  });

  assert.equal(result.status, 'authenticated');
  assert.deepEqual(calls, [
    'pageAssistManualLoginStep',
    'pageInspectLoginState',
    'pageAssistManualLoginStep',
    'pageInspectLoginState',
  ]);
});

test('pageAssistManualLoginStep treats X OCF username input as username before challenge', async () => {
  const selectorMap = {};
  const allNodes = [];
  await withFakePageDom({ selectorMap, allNodes }, async ({ FakeElement, FakeHTMLElement, FakeInputElement }) => {
    const usernameInput = new FakeInputElement({
      value: 'YueTongLi_pler',
      attributes: {
        'data-testid': 'ocfEnterTextTextInput',
      },
    });
    const ocfContainer = new FakeElement({
      children: [usernameInput],
    });
    const nextButton = new FakeHTMLElement({
      textContent: '下一步',
    });
    selectorMap['input[data-testid="ocfEnterTextTextInput"]'] = usernameInput;
    selectorMap['[data-testid*="ocf"]'] = ocfContainer;
    allNodes.push(nextButton);
    const result = await pageAssistManualLoginStep({
      usernameSelectors: ['input[data-testid="ocfEnterTextTextInput"]'],
      passwordSelectors: ['input[name="password"]'],
      challengeSelectors: ['[data-testid*="ocf"]'],
    });

    assert.equal(result.status, 'next-clicked');
    assert.equal(nextButton.clicked, true);
    assert.equal(result.buttonText, '下一步');
  });
});

test('pageAssistManualLoginStep still stops for a distinct visible challenge', async () => {
  const selectorMap = {};
  await withFakePageDom({ selectorMap }, async ({ FakeElement, FakeInputElement }) => {
    const usernameInput = new FakeInputElement({
      value: 'YueTongLi_pler',
    });
    const challenge = new FakeElement({
      textContent: 'verification required',
    });
    selectorMap['input[autocomplete="username"]'] = usernameInput;
    selectorMap['[data-testid*="verification"]'] = challenge;
    const result = await pageAssistManualLoginStep({
      usernameSelectors: ['input[autocomplete="username"]'],
      passwordSelectors: ['input[name="password"]'],
      challengeSelectors: ['[data-testid*="verification"]'],
    });

    assert.equal(result.status, 'challenge-visible');
    assert.equal(result.challengeText, 'verification required');
  });
});

test('derivePersistentProfileKey keeps Xiaohongshu URLs on the shared xiaohongshu.com profile key', () => {
  assert.equal(derivePersistentProfileKey('https://www.xiaohongshu.com/explore'), 'xiaohongshu.com');
  assert.equal(derivePersistentProfileKey('https://www.xiaohongshu.com/notification'), 'xiaohongshu.com');
  assert.equal(derivePersistentProfileKey('https://www.xiaohongshu.com/user/profile/5acc62a7e8ac2b04829875e1'), 'xiaohongshu.com');
});

test('resolvePersistentUserDataDir keeps bilibili subdomains on one shared directory', () => {
  const rootDir = path.resolve('tmp-browser-profiles');
  assert.equal(
    resolvePersistentUserDataDir('https://www.bilibili.com/', { rootDir }),
    path.join(rootDir, 'bilibili.com'),
  );
  assert.equal(
    resolvePersistentUserDataDir('https://space.bilibili.com/1202350411/fans/follow', { rootDir }),
    path.join(rootDir, 'bilibili.com'),
  );
});

test('resolveSiteBrowserSessionOptions honors bilibili authSession defaults', async () => {
  const siteProfile = await readJsonFile(path.resolve('profiles/www.bilibili.com.json'));
  const sessionOptions = await resolveSiteBrowserSessionOptions('https://www.bilibili.com/', {
    browserProfileRoot: path.resolve('tmp-browser-profiles'),
  }, {
    siteProfile,
    profilePath: path.resolve('profiles/www.bilibili.com.json'),
  });

  assert.equal(sessionOptions.reuseLoginState, true);
  assert.equal(sessionOptions.userDataDir, path.resolve('tmp-browser-profiles', 'bilibili.com'));
  assert.equal(sessionOptions.cleanupUserDataDirOnShutdown, false);
  assert.equal(sessionOptions.authConfig.loginUrl, 'https://passport.bilibili.com/login');
});

test('resolveSiteBrowserSessionOptions honors Douyin auth session defaults', async () => {
  const siteProfile = await readJsonFile(path.resolve('profiles/www.douyin.com.json'));
  const sessionOptions = await resolveSiteBrowserSessionOptions('https://www.douyin.com/?recommend=1', {
    browserProfileRoot: path.resolve('tmp-browser-profiles'),
  }, {
    siteProfile,
    profilePath: path.resolve('profiles/www.douyin.com.json'),
  });

  assert.equal(sessionOptions.reuseLoginState, true);
  assert.equal(sessionOptions.userDataDir, path.resolve('tmp-browser-profiles', 'douyin.com'));
  assert.equal(sessionOptions.cleanupUserDataDirOnShutdown, false);
  assert.equal(sessionOptions.authConfig.loginUrl, 'https://www.douyin.com/');
  assert.equal(sessionOptions.authConfig.postLoginUrl, 'https://www.douyin.com/');
  assert.equal(sessionOptions.authConfig.verificationUrl, 'https://www.douyin.com/user/self?showTab=like');
  assert.equal(sessionOptions.authConfig.autoLoginByDefault, true);
  assert.equal(sessionOptions.authConfig.credentialTarget, 'BrowserWikiSkill:douyin.com');
  assert.equal(sessionOptions.authConfig.usernameEnv, 'DOUYIN_USERNAME');
  assert.equal(sessionOptions.authConfig.passwordEnv, 'DOUYIN_PASSWORD');
  assert.ok(Array.isArray(sessionOptions.authConfig.loginEntrySelectors));
  assert.ok(sessionOptions.authConfig.loginEntrySelectors.length > 0);
  assert.deepEqual(sessionOptions.authConfig.authRequiredPathPrefixes, ['/user/self', '/follow']);
  assert.equal(sessionOptions.authConfig.keepaliveUrl, 'https://www.douyin.com/user/self?showTab=like');
  assert.equal(sessionOptions.authConfig.keepaliveIntervalMinutes, 120);
  assert.equal(sessionOptions.authConfig.cooldownMinutesAfterRisk, 120);
  assert.equal(sessionOptions.authConfig.preferVisibleBrowserForAuthenticatedFlows, true);
  assert.equal(sessionOptions.authConfig.requireStableNetworkForAuthenticatedFlows, true);
  assert.deepEqual(sessionOptions.authConfig.reusableSessionSignals, [
    'usableForCookies',
    'healthy',
    'loginStateLikelyAvailable',
    'presentWithoutMissingPaths',
  ]);
});

test('resolveSiteBrowserSessionOptions exposes X split-login form selectors', async () => {
  const siteProfile = await readJsonFile(path.resolve('profiles/x.com.json'));
  const sessionOptions = await resolveSiteBrowserSessionOptions('https://x.com/home', {}, {
    siteProfile,
    profilePath: path.resolve('profiles/x.com.json'),
  });

  assert.ok(sessionOptions.authConfig.usernameSelectors.includes('input[autocomplete="username"]'));
  assert.ok(sessionOptions.authConfig.usernameSelectors.includes('input[name="text"]'));
  assert.ok(sessionOptions.authConfig.passwordSelectors.includes('input[name="password"]'));
  assert.ok(sessionOptions.authConfig.submitSelectors.includes('[data-testid="LoginForm_Login_Button"]'));
  assert.ok(sessionOptions.authConfig.loginIndicatorSelectors.includes('a[data-testid="AppTabBar_Home_Link"]'));
  assert.ok(sessionOptions.authConfig.loginIndicatorSelectors.includes('a[data-testid="SideNav_NewTweet_Button"]'));
});

test('isAuthRequiredNavigationTarget distinguishes Xiaohongshu public and authenticated paths', async () => {
  const siteProfile = await readJsonFile(path.resolve('profiles/www.xiaohongshu.com.json'));
  const authConfig = (
    await resolveSiteBrowserSessionOptions('https://www.xiaohongshu.com/explore', {
      browserProfileRoot: path.resolve('tmp-browser-profiles'),
    }, {
      siteProfile,
      profilePath: path.resolve('profiles/www.xiaohongshu.com.json'),
    })
  ).authConfig;

  assert.equal(
    isAuthRequiredNavigationTarget('https://www.xiaohongshu.com/explore', {
      authConfig,
      siteProfile,
    }),
    false,
  );
  assert.equal(
    isAuthRequiredNavigationTarget('https://www.xiaohongshu.com/search_result?keyword=%E7%A9%BF%E6%90%AD', {
      authConfig,
      siteProfile,
    }),
    false,
  );
  assert.equal(
    isAuthRequiredNavigationTarget('https://www.xiaohongshu.com/notification', {
      authConfig,
      siteProfile,
    }),
    true,
  );
});

test('shouldUsePersistentProfileForNavigation isolates Xiaohongshu public navigation from the auth profile by default', async () => {
  const siteProfile = await readJsonFile(path.resolve('profiles/www.xiaohongshu.com.json'));
  const authContext = await resolveSiteBrowserSessionOptions('https://www.xiaohongshu.com/explore', {
    browserProfileRoot: path.resolve('tmp-browser-profiles'),
  }, {
    siteProfile,
    profilePath: path.resolve('profiles/www.xiaohongshu.com.json'),
  });

  assert.equal(
    shouldUsePersistentProfileForNavigation('https://www.xiaohongshu.com/explore', {}, authContext),
    false,
  );
  assert.equal(
    shouldUsePersistentProfileForNavigation('https://www.xiaohongshu.com/notification', {}, authContext),
    true,
  );
  assert.equal(
    shouldUsePersistentProfileForNavigation('https://www.xiaohongshu.com/explore', {
      userDataDir: path.join('C:', 'profiles', 'explicit-xhs'),
    }, authContext),
    true,
  );
});

test('shouldEnsureAuthenticatedNavigationSession skips Xiaohongshu public bootstrap unless auth is required or auto-login is explicit', async () => {
  const siteProfile = await readJsonFile(path.resolve('profiles/www.xiaohongshu.com.json'));
  const authContext = await resolveSiteBrowserSessionOptions('https://www.xiaohongshu.com/explore', {
    browserProfileRoot: path.resolve('tmp-browser-profiles'),
  }, {
    siteProfile,
    profilePath: path.resolve('profiles/www.xiaohongshu.com.json'),
  });

  assert.equal(
    shouldEnsureAuthenticatedNavigationSession('https://www.xiaohongshu.com/explore', {
      autoLogin: false,
    }, authContext),
    false,
  );
  assert.equal(
    shouldEnsureAuthenticatedNavigationSession('https://www.xiaohongshu.com/notification', {
      autoLogin: false,
    }, authContext),
    true,
  );
  assert.equal(
    shouldEnsureAuthenticatedNavigationSession('https://www.xiaohongshu.com/explore', {
      autoLogin: true,
    }, authContext),
    true,
  );
});

test('resolveSiteBrowserSessionOptions honors Xiaohongshu auth session defaults', async () => {
  const siteProfile = await readJsonFile(path.resolve('profiles/www.xiaohongshu.com.json'));
  const sessionOptions = await resolveSiteBrowserSessionOptions('https://www.xiaohongshu.com/explore', {
    browserProfileRoot: path.resolve('tmp-browser-profiles'),
  }, {
    siteProfile,
    profilePath: path.resolve('profiles/www.xiaohongshu.com.json'),
  });

  assert.equal(sessionOptions.reuseLoginState, true);
  assert.equal(sessionOptions.userDataDir, path.resolve('tmp-browser-profiles', 'xiaohongshu.com'));
  assert.equal(sessionOptions.cleanupUserDataDirOnShutdown, false);
  assert.equal(sessionOptions.authConfig.loginUrl, 'https://www.xiaohongshu.com/login?redirectPath=https%3A%2F%2Fwww.xiaohongshu.com%2Fnotification');
  assert.equal(sessionOptions.authConfig.postLoginUrl, 'https://www.xiaohongshu.com/notification');
  assert.equal(sessionOptions.authConfig.verificationUrl, 'https://www.xiaohongshu.com/notification');
  assert.equal(sessionOptions.authConfig.keepaliveUrl, 'https://www.xiaohongshu.com/notification');
  assert.equal(sessionOptions.authConfig.autoLoginByDefault, false);
  assert.equal(sessionOptions.authConfig.credentialTarget, 'BrowserWikiSkill:xiaohongshu.com');
  assert.equal(sessionOptions.authConfig.usernameEnv, null);
  assert.equal(sessionOptions.authConfig.passwordEnv, null);
  assert.ok(Array.isArray(sessionOptions.authConfig.loginEntrySelectors));
  assert.ok(sessionOptions.authConfig.loginEntrySelectors.length > 0);
  assert.deepEqual(sessionOptions.authConfig.loginIndicatorSelectors, [
    '.notification-page .user-avatar img',
    '.notification-page .user-info a[href*="/user/profile/"]',
  ]);
  assert.deepEqual(sessionOptions.authConfig.authRequiredPathPrefixes, ['/notification']);
  assert.equal(sessionOptions.authConfig.keepaliveIntervalMinutes, 180);
  assert.equal(sessionOptions.authConfig.cooldownMinutesAfterRisk, 180);
  assert.equal(sessionOptions.authConfig.preferVisibleBrowserForAuthenticatedFlows, true);
  assert.equal(sessionOptions.authConfig.requireStableNetworkForAuthenticatedFlows, true);
  assert.deepEqual(sessionOptions.authConfig.reusableSessionSignals, [
    'usableForCookies',
    'healthy',
    'loginStateLikelyAvailable',
    'presentWithoutMissingPaths',
  ]);
});

test('isReusableLoginStateAvailable stays strict when the profile requires cookie-backed reuse', () => {
  assert.equal(
    isReusableLoginStateAvailable(
      {
        usableForCookies: false,
        healthy: true,
        exists: true,
        missingPaths: [],
      },
      {
        authConfig: {
          reusableSessionSignals: ['usableForCookies'],
        },
      },
    ),
    false,
  );
  assert.equal(
    isReusableLoginStateAvailable(
      { usableForCookies: true },
      {
        authConfig: {
          reusableSessionSignals: ['usableForCookies'],
        },
      },
    ),
    true,
  );
});

test('isReusableLoginStateAvailable honors profile-configured fallback health signals', () => {
  assert.equal(
    isReusableLoginStateAvailable(
      {
        healthy: true,
        exists: true,
        missingPaths: [],
      },
      {
        authConfig: {
          reusableSessionSignals: ['usableForCookies', 'healthy', 'loginStateLikelyAvailable', 'presentWithoutMissingPaths'],
        },
      },
    ),
    true,
  );
  assert.equal(
    isReusableLoginStateAvailable(
      {
        healthy: false,
        exists: true,
        missingPaths: ['Cookies'],
        loginStateLikelyAvailable: false,
      },
      {
        authConfig: {
          reusableSessionSignals: ['usableForCookies', 'healthy', 'loginStateLikelyAvailable', 'presentWithoutMissingPaths'],
        },
      },
    ),
    false,
  );
});

test('inspectReusableSiteSession reuses shared session inspection and exposes auth availability', async () => {
  const sessionState = await inspectReusableSiteSession('https://www.douyin.com/?recommend=1', {
    browserProfileRoot: path.resolve('tmp-browser-profiles'),
    reuseLoginState: true,
  }, {
    siteProfile: {
      host: 'www.douyin.com',
      authSession: {
        reuseLoginStateByDefault: true,
      },
    },
    profilePath: path.resolve('profiles/www.douyin.com.json'),
  }, {
    async resolveSiteBrowserSessionOptions() {
      return {
        reuseLoginState: true,
        userDataDir: 'C:/profiles/douyin.com',
        cleanupUserDataDirOnShutdown: false,
        authProfile: { filePath: 'profiles/www.douyin.com.json' },
        siteProfile: { host: 'www.douyin.com' },
        authConfig: {
          loginUrl: 'https://www.douyin.com/',
          reusableSessionSignals: ['usableForCookies', 'healthy', 'loginStateLikelyAvailable', 'presentWithoutMissingPaths'],
        },
      };
    },
    async inspectPersistentProfileHealth() {
      return {
        healthy: true,
        exists: true,
        missingPaths: [],
      };
    },
  });

  assert.equal(sessionState.authAvailable, true);
  assert.equal(sessionState.reusableProfile, true);
  assert.equal(sessionState.userDataDir, 'C:/profiles/douyin.com');
  assert.equal(sessionState.profilePath, 'profiles/www.douyin.com.json');
  assert.equal(sessionState.authConfig.loginUrl, 'https://www.douyin.com/');
});

test('exportDownloadSessionPassthrough writes redacted Xiaohongshu auth summaries for reusable downloads', async () => {
  const userDataDir = await mkdtemp(path.join(os.tmpdir(), 'bwk-xhs-download-auth-'));

  try {
    const passthrough = await exportDownloadSessionPassthrough({
      async callPageFunction() {
        return {
          navigatorUserAgent: 'Mozilla/5.0 Test Browser',
          navigatorLanguage: 'zh-CN',
          navigatorLanguages: ['zh-CN', 'zh'],
          navigatorPlatform: 'Win32',
          locationHref: 'https://www.xiaohongshu.com/notification',
          locationOrigin: 'https://www.xiaohongshu.com',
          documentReferrer: 'https://www.xiaohongshu.com/explore',
          documentTitle: '通知',
        };
      },
      async send(method) {
        assert.equal(method, 'Storage.getCookies');
        return {
          cookies: [
            {
              name: 'a1',
              value: 'cookie-a1',
              domain: '.xiaohongshu.com',
              path: '/',
              secure: true,
              httpOnly: true,
              expires: 1_735_689_600,
            },
            {
              name: 'web_session',
              value: 'cookie-session',
              domain: 'www.xiaohongshu.com',
              path: '/',
              secure: true,
              httpOnly: false,
              expires: 1_735_689_600,
            },
            {
              name: 'ignored',
              value: 'skip-me',
              domain: '.example.com',
              path: '/',
            },
          ],
        };
      },
    }, 'https://www.xiaohongshu.com/explore', {
      authProfile: {
        profile: {
          host: 'www.xiaohongshu.com',
        },
      },
      siteProfile: {
        host: 'www.xiaohongshu.com',
      },
      authConfig: {
        loginUrl: 'https://www.xiaohongshu.com/login',
        postLoginUrl: 'https://www.xiaohongshu.com/notification',
        verificationUrl: 'https://www.xiaohongshu.com/notification',
      },
      reuseLoginState: true,
      userDataDir,
    }, {
      siteKey: 'xiaohongshu',
      envToken: 'xiaohongshu',
      artifactStem: 'xiaohongshu-download',
      loginState: {
        loggedIn: true,
        loginStateDetected: true,
        identityConfirmed: false,
        identitySource: 'heuristic:cookie-present',
      },
    });

    assert.equal(passthrough.available, true);
    assert.equal(passthrough.passthroughMode, 'redacted-session-view');
    assert.equal(passthrough.cookieHeaderAvailable, true);
    assert.equal(passthrough.cookieCount, 2);
    assert.deepEqual(passthrough.cookieNames, ['a1', 'web_session']);
    assert.deepEqual(passthrough.cookieDomains, ['.xiaohongshu.com', 'www.xiaohongshu.com']);
    assert.deepEqual(passthrough.headerNames, ['Accept-Language', 'Cookie', 'Origin', 'Referer', 'User-Agent']);
    assert.ok(passthrough.sidecarPath);
    assert.equal(passthrough.cookieFile, null);
    assert.ok(passthrough.sidecarRedactionAuditPath);
    assert.equal(passthrough.userDataDir, null);
    assert.equal(passthrough.userDataDirPresent, true);
    assert.equal(await pathExists(passthrough.sidecarPath), true);
    assert.equal(await pathExists(passthrough.sidecarRedactionAuditPath), true);
    assert.equal(passthrough.env.BWS_XIAOHONGSHU_DOWNLOAD_AUTH_SIDECAR, passthrough.sidecarPath);
    assert.equal(Object.hasOwn(passthrough.env, 'BWS_XIAOHONGSHU_DOWNLOAD_COOKIE_FILE'), false);
    assert.equal(Object.hasOwn(passthrough.env, 'BWS_XIAOHONGSHU_DOWNLOAD_USER_DATA_DIR'), false);
    assert.equal(passthrough.env.BWS_XIAOHONGSHU_DOWNLOAD_PASSTHROUGH_MODE, 'redacted-session-view');

    const sidecar = await readJsonFile(passthrough.sidecarPath);
    const sidecarText = await readFile(passthrough.sidecarPath, 'utf8');
    const auditText = await readFile(passthrough.sidecarRedactionAuditPath, 'utf8');
    assert.equal(sidecar.ok, true);
    assert.equal(sidecar.cookieCount, 2);
    assert.equal(sidecar.passthroughMode, 'redacted-session-view');
    assert.equal(sidecar.rawExportSuppressed, true);
    assert.equal(sidecar.page?.url, 'https://www.xiaohongshu.com/notification');
    assert.equal(sidecar.auth?.loginStateDetected, true);
    assert.deepEqual(sidecar.cookieNames, ['a1', 'web_session']);
    assert.deepEqual(sidecar.headerNames, ['Accept-Language', 'Cookie', 'Origin', 'Referer', 'User-Agent']);
    assert.doesNotMatch(
      `${sidecarText}\n${auditText}`,
      /cookie-a1|cookie-session|a1=cookie-a1|web_session=cookie-session/iu,
    );
  } finally {
    await rm(userDataDir, { recursive: true, force: true });
  }
});

test('exportSiteDownloadPassthrough opens the Xiaohongshu verification URL with the persistent profile', async () => {
  const userDataDir = await mkdtemp(path.join(os.tmpdir(), 'bwk-xhs-download-auth-wrapper-'));
  const observed = {
    openSettings: null,
    navigatedUrl: null,
    closed: false,
  };

  try {
    const passthrough = await exportSiteDownloadPassthrough('https://www.xiaohongshu.com/explore', {
      timeoutMs: 12_000,
      headless: true,
    }, {
      siteKey: 'xiaohongshu',
      envToken: 'xiaohongshu',
      artifactStem: 'xiaohongshu-download',
    }, {
      resolveSiteBrowserSessionOptions: async () => ({
        authProfile: {
          profile: {
            host: 'www.xiaohongshu.com',
          },
        },
        siteProfile: {
          host: 'www.xiaohongshu.com',
        },
        authConfig: {
          loginUrl: 'https://www.xiaohongshu.com/login',
          postLoginUrl: 'https://www.xiaohongshu.com/notification',
          verificationUrl: 'https://www.xiaohongshu.com/notification',
          preferVisibleBrowserForAuthenticatedFlows: true,
        },
        reuseLoginState: true,
        userDataDir,
        cleanupUserDataDirOnShutdown: false,
      }),
      openBrowserSession: async (settings) => {
        observed.openSettings = settings;
        return {
          async navigateAndWait(url) {
            observed.navigatedUrl = url;
          },
          async close() {
            observed.closed = true;
          },
          async callPageFunction() {
            return {
              navigatorUserAgent: 'Mozilla/5.0 Wrapper Test Browser',
              navigatorLanguage: 'zh-CN',
              navigatorLanguages: ['zh-CN'],
              navigatorPlatform: 'Win32',
              locationHref: 'https://www.xiaohongshu.com/notification',
              locationOrigin: 'https://www.xiaohongshu.com',
              documentReferrer: '',
              documentTitle: '通知',
            };
          },
          async send(method) {
            assert.equal(method, 'Storage.getCookies');
            return {
              cookies: [
                {
                  name: 'web_session',
                  value: 'cookie-session',
                  domain: '.xiaohongshu.com',
                  path: '/',
                  secure: true,
                  expires: 1_735_689_600,
                },
              ],
            };
          },
        };
      },
      inspectLoginState: async () => ({
        loggedIn: true,
        loginStateDetected: true,
        identityConfirmed: true,
        identitySource: 'selector:.notification-page',
      }),
    });

    assert.equal(observed.openSettings?.headless, false);
    assert.equal(observed.openSettings?.startupUrl, 'https://www.xiaohongshu.com/notification');
    assert.equal(observed.navigatedUrl, 'https://www.xiaohongshu.com/notification');
    assert.equal(observed.closed, true);
    assert.equal(passthrough.available, true);
    assert.equal(passthrough.identityConfirmed, true);
    assert.equal(passthrough.currentUrl, 'https://www.xiaohongshu.com/notification');
    assert.equal(passthrough.userDataDir, null);
    assert.equal(passthrough.userDataDirPresent, true);
    assert.equal(Object.hasOwn(passthrough.env, 'BWS_XIAOHONGSHU_DOWNLOAD_USER_DATA_DIR'), false);
  } finally {
    await rm(userDataDir, { recursive: true, force: true });
  }
});

test('inspectLoginState forwards profile selectors without infra fallback defaults', async () => {
  let capturedConfig = null;
  const result = await inspectLoginState({
    async callPageFunction(_fn, config) {
      capturedConfig = config;
      return { loggedIn: false };
    },
  }, {
    host: 'www.example.com',
    loginUrl: 'https://www.example.com/login',
    loginIndicatorSelectors: [],
    loggedOutIndicatorSelectors: ['.login'],
    usernameSelectors: [],
    passwordSelectors: [],
    challengeSelectors: [],
  });

  assert.deepEqual(capturedConfig, {
    host: 'www.example.com',
    loginUrl: 'https://www.example.com/login',
    loginIndicatorSelectors: [],
    loggedOutIndicatorSelectors: ['.login'],
    usernameSelectors: [],
    passwordSelectors: [],
    challengeSelectors: [],
  });
  assert.equal(result.loggedIn, false);
});

test('ensureAuthenticatedSession does not treat Xiaohongshu guest probes as already authenticated', async () => {
  let inspectCalls = 0;
  const session = {
    async callPageFunction() {
      inspectCalls += 1;
      return {
        currentUrl: 'https://www.xiaohongshu.com/notification',
        onLoginPage: false,
        loggedIn: false,
        loginStateDetected: false,
        identityConfirmed: false,
        identitySource: 'api:v2-user-me:guest',
        xiaohongshuAuthProbe: {
          ok: true,
          guest: true,
          status: 200,
          userId: null,
        },
      };
    },
    async navigateAndWait() {
      assert.fail('guest state should not navigate to post-login verification');
    },
  };

  const result = await ensureAuthenticatedSession(
    session,
    'https://www.xiaohongshu.com/notification',
    {
      autoLogin: false,
      disableCredentialManager: true,
    },
    {
      authContext: {
        authProfile: {
          filePath: path.resolve('profiles/www.xiaohongshu.com.json'),
        },
        authConfig: {
          host: 'www.xiaohongshu.com',
          loginUrl: 'https://www.xiaohongshu.com/login?redirectPath=https%3A%2F%2Fwww.xiaohongshu.com%2Fnotification',
          postLoginUrl: 'https://www.xiaohongshu.com/notification',
          autoLoginByDefault: false,
          loginIndicatorSelectors: [
            '.notification-page .user-avatar img',
            '.notification-page .user-info a[href*="/user/profile/"]',
          ],
          loggedOutIndicatorSelectors: ['.login-container', '.login-input'],
          usernameSelectors: [],
          passwordSelectors: [],
          challengeSelectors: [],
        },
      },
    },
  );

  assert.equal(inspectCalls, 1);
  assert.equal(result.status, 'credentials-unavailable');
  assert.equal(result.loginState?.identityConfirmed, false);
  assert.equal(result.loginState?.identitySource, 'api:v2-user-me:guest');
});

test('attemptCredentialLogin uses only profile-provided selector families', async () => {
  let capturedConfig = null;
  const result = await attemptCredentialLogin({
    async navigateAndWait() {},
    async callPageFunction(_fn, config) {
      capturedConfig = config;
      return { status: 'fields-not-found' };
    },
  }, {
    loginUrl: 'https://www.example.com/login',
    loginEntrySelectors: [],
    loggedOutIndicatorSelectors: ['.login'],
    passwordLoginTabSelectors: [],
    usernameSelectors: [],
    passwordSelectors: [],
    submitSelectors: [],
    challengeSelectors: [],
    postLoginUrl: 'https://www.example.com/',
  }, {
    username: 'user',
    password: 'pass',
  });

  assert.deepEqual(capturedConfig, {
    loginEntrySelectors: ['.login'],
    loggedOutIndicatorSelectors: ['.login'],
    passwordLoginTabSelectors: [],
    usernameSelectors: [],
    passwordSelectors: [],
    submitSelectors: [],
    challengeSelectors: [],
  });
  assert.equal(result.status, 'fields-not-found');
});

test('resolveCredentialSource prefers Windows Credential Manager before environment variables', async () => {
  process.env.DOUYIN_USERNAME = 'env-user';
  process.env.DOUYIN_PASSWORD = 'env-pass';
  try {
    const credentials = await resolveCredentialSource({
      host: 'www.douyin.com',
      credentialTarget: 'BrowserWikiSkill:douyin.com',
      usernameEnv: 'DOUYIN_USERNAME',
      passwordEnv: 'DOUYIN_PASSWORD',
    }, {}, {
      getWindowsCredential: async () => ({
        found: true,
        username: 'stored-user',
        password: 'stored-pass',
      }),
    });

    assert.equal(credentials.available, true);
    assert.equal(credentials.source, 'wincred:BrowserWikiSkill:douyin.com');
    assert.equal(credentials.username, 'stored-user');
    assert.equal(credentials.password, 'stored-pass');
  } finally {
    delete process.env.DOUYIN_USERNAME;
    delete process.env.DOUYIN_PASSWORD;
  }
});

test('resolveCredentialSource falls back to environment variables when WinCred has no stored secret', async () => {
  process.env.DOUYIN_USERNAME = 'env-user';
  process.env.DOUYIN_PASSWORD = 'env-pass';
  try {
    const credentials = await resolveCredentialSource({
      host: 'www.douyin.com',
      credentialTarget: 'BrowserWikiSkill:douyin.com',
      usernameEnv: 'DOUYIN_USERNAME',
      passwordEnv: 'DOUYIN_PASSWORD',
    }, {}, {
      getWindowsCredential: async () => ({
        found: false,
      }),
    });

    assert.equal(credentials.available, true);
    assert.equal(credentials.source, 'env:DOUYIN_USERNAME/DOUYIN_PASSWORD');
    assert.equal(credentials.username, 'env-user');
    assert.equal(credentials.password, 'env-pass');
  } finally {
    delete process.env.DOUYIN_USERNAME;
    delete process.env.DOUYIN_PASSWORD;
  }
});

test('resolveAuthVerificationUrl supports explicit verification URLs and legacy auth sample fallbacks', () => {
  const douyinProfile = {
    profile: {
      host: 'www.douyin.com',
      authValidationSamples: {
        selfPostsUrl: 'https://www.douyin.com/user/self?showTab=post',
        likesUrl: 'https://www.douyin.com/user/self?showTab=like',
        followFeedUrl: 'https://www.douyin.com/follow?tab=feed',
      },
      authSession: {
        loginUrl: 'https://www.douyin.com/',
        postLoginUrl: 'https://www.douyin.com/',
        verificationUrl: 'https://www.douyin.com/user/self?showTab=like',
      },
    },
  };
  assert.equal(
    resolveAuthVerificationUrl('https://www.douyin.com/?recommend=1', douyinProfile),
    'https://www.douyin.com/user/self?showTab=like',
  );

  const douyinWithoutExplicitVerification = {
    profile: {
      host: 'www.douyin.com',
      authValidationSamples: {
        followFeedUrl: 'https://www.douyin.com/follow?tab=feed',
        selfPostsUrl: 'https://www.douyin.com/user/self?showTab=post',
        likesUrl: 'https://www.douyin.com/user/self?showTab=like',
      },
      authSession: {
        loginUrl: 'https://www.douyin.com/',
        postLoginUrl: 'https://www.douyin.com/',
        validationSamplePriority: ['likesUrl', 'selfPostsUrl', 'followFeedUrl'],
      },
    },
  };
  assert.equal(
    resolveAuthVerificationUrl('https://www.douyin.com/?recommend=1', douyinWithoutExplicitVerification),
    'https://www.douyin.com/user/self?showTab=like',
  );

  const bilibiliProfile = {
    profile: {
      host: 'www.bilibili.com',
      authValidationSamples: {
        watchLaterUrl: 'https://www.bilibili.com/watchlater/#/list',
        dynamicUrl: 'https://space.bilibili.com/1202350411/dynamic',
        followListUrl: 'https://space.bilibili.com/1202350411/fans/follow',
      },
      authSession: {
        loginUrl: 'https://passport.bilibili.com/login',
        postLoginUrl: 'https://www.bilibili.com/',
        validationSamplePriority: ['followListUrl', 'dynamicUrl', 'watchLaterUrl'],
      },
    },
  };
  assert.equal(
    resolveAuthVerificationUrl('https://www.bilibili.com/', bilibiliProfile),
    'https://space.bilibili.com/1202350411/fans/follow',
  );

  const genericFallbackProfile = {
    profile: {
      host: 'www.example.com',
      authValidationSamples: {
        firstUrl: 'https://www.example.com/first',
        secondUrl: 'https://www.example.com/second',
      },
      authSession: {
        loginUrl: 'https://www.example.com/login',
        postLoginUrl: 'https://www.example.com/',
      },
    },
  };
  assert.equal(
    resolveAuthVerificationUrl('https://www.example.com/', genericFallbackProfile),
    'https://www.example.com/first',
  );

  const xiaohongshuProfile = {
    profile: {
      host: 'www.xiaohongshu.com',
      authValidationSamples: {
        notificationUrl: 'https://www.xiaohongshu.com/notification',
      },
      authSession: {
        loginUrl: 'https://www.xiaohongshu.com/login?redirectPath=https%3A%2F%2Fwww.xiaohongshu.com%2Fnotification',
        postLoginUrl: 'https://www.xiaohongshu.com/notification',
        verificationUrl: 'https://www.xiaohongshu.com/notification',
        validationSamplePriority: ['notificationUrl'],
      },
    },
  };
  assert.equal(
    resolveAuthVerificationUrl('https://www.xiaohongshu.com/explore', xiaohongshuProfile),
    'https://www.xiaohongshu.com/notification',
  );
});

test('resolveAuthKeepaliveUrl prefers keepaliveUrl then falls back through verification defaults', () => {
  const douyinWithKeepalive = {
    profile: {
      host: 'www.douyin.com',
      authValidationSamples: {
        selfPostsUrl: 'https://www.douyin.com/user/self?showTab=post',
        likesUrl: 'https://www.douyin.com/user/self?showTab=like',
      },
      authSession: {
        loginUrl: 'https://www.douyin.com/',
        postLoginUrl: 'https://www.douyin.com/',
        verificationUrl: 'https://www.douyin.com/user/self?showTab=like',
        keepaliveUrl: 'https://www.douyin.com/follow?tab=feed',
      },
    },
  };
  assert.equal(
    resolveAuthKeepaliveUrl('https://www.douyin.com/?recommend=1', douyinWithKeepalive),
    'https://www.douyin.com/follow?tab=feed',
  );

  const douyinWithoutKeepalive = {
    profile: {
      host: 'www.douyin.com',
      authValidationSamples: {
        followFeedUrl: 'https://www.douyin.com/follow?tab=feed',
        likesUrl: 'https://www.douyin.com/user/self?showTab=like',
      },
      authSession: {
        loginUrl: 'https://www.douyin.com/',
        postLoginUrl: 'https://www.douyin.com/',
        validationSamplePriority: ['likesUrl', 'followFeedUrl'],
      },
    },
  };
  assert.equal(
    resolveAuthKeepaliveUrl('https://www.douyin.com/?recommend=1', douyinWithoutKeepalive),
    'https://www.douyin.com/user/self?showTab=like',
  );

  const bilibiliWithoutSamples = {
    profile: {
      host: 'www.bilibili.com',
      authSession: {
        loginUrl: 'https://passport.bilibili.com/login',
        postLoginUrl: 'https://www.bilibili.com/',
      },
    },
  };
  assert.equal(
    resolveAuthKeepaliveUrl('https://www.bilibili.com/', bilibiliWithoutSamples),
    'https://www.bilibili.com/',
  );

  const xiaohongshuWithKeepalive = {
    profile: {
      host: 'www.xiaohongshu.com',
      authValidationSamples: {
        notificationUrl: 'https://www.xiaohongshu.com/notification',
      },
      authSession: {
        loginUrl: 'https://www.xiaohongshu.com/login?redirectPath=https%3A%2F%2Fwww.xiaohongshu.com%2Fnotification',
        postLoginUrl: 'https://www.xiaohongshu.com/notification',
        verificationUrl: 'https://www.xiaohongshu.com/notification',
        keepaliveUrl: 'https://www.xiaohongshu.com/notification',
      },
    },
  };
  assert.equal(
    resolveAuthKeepaliveUrl('https://www.xiaohongshu.com/explore', xiaohongshuWithKeepalive),
    'https://www.xiaohongshu.com/notification',
  );
});

test('inspectPersistentProfileHealth flags crashed Chrome profiles as unhealthy', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-profile-health-'));

  try {
    await mkdir(path.join(workspace, 'Default', 'Network'), { recursive: true });
    await mkdir(path.join(workspace, 'Default', 'Sessions'), { recursive: true });
    await writeFile(path.join(workspace, 'Local State'), '{}', 'utf8');
    await writeFile(path.join(workspace, 'Default', 'Preferences'), JSON.stringify({
      profile: {
        exit_type: 'Crashed',
      },
      sessions: {
        session_data_status: 1,
      },
    }), 'utf8');
    await writeFile(path.join(workspace, 'Default', 'Network', 'Cookies'), 'cookie-db', 'utf8');

    const health = await inspectPersistentProfileHealth(workspace);
    assert.equal(health.healthy, false);
    assert.equal(health.lastExitType, 'Crashed');
    assert.match(health.warnings.join('\n'), /last exit type was Crashed/u);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('inspectPersistentProfileHealth classifies first-run incomplete profiles as uninitialized', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-profile-uninitialized-'));

  try {
    await writeFile(path.join(workspace, 'Local State'), '{}', 'utf8');

    const health = await inspectPersistentProfileHealth(workspace);
    assert.equal(health.healthy, false);
    assert.equal(health.profileLifecycle, 'uninitialized');
    assert.equal(health.requiresProfileRebuild, false);
    assert.match(health.warnings.join('\n'), /missing expected paths/u);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
