import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';

import { readJsonFile } from '../../src/infra/io.mjs';
import {
  derivePersistentProfileKey,
  inspectPersistentProfileHealth,
  resolvePersistentUserDataDir,
} from '../../src/infra/browser/profile-store.mjs';
import {
  attemptCredentialLogin,
  resolveAuthKeepaliveUrl,
  resolveAuthVerificationUrl,
  resolveCredentialSource,
  inspectLoginState,
  inspectReusableSiteSession,
  isReusableLoginStateAvailable,
  resolveSiteBrowserSessionOptions,
} from '../../src/infra/auth/site-auth.mjs';

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

test('inspectLoginState forwards profile selectors without infra fallback defaults', async () => {
  let capturedConfig = null;
  const result = await inspectLoginState({
    async callPageFunction(_fn, config) {
      capturedConfig = config;
      return { loggedIn: false };
    },
  }, {
    loginUrl: 'https://www.example.com/login',
    loginIndicatorSelectors: [],
    loggedOutIndicatorSelectors: ['.login'],
    usernameSelectors: [],
    passwordSelectors: [],
    challengeSelectors: [],
  });

  assert.deepEqual(capturedConfig, {
    loginUrl: 'https://www.example.com/login',
    loginIndicatorSelectors: [],
    loggedOutIndicatorSelectors: ['.login'],
    usernameSelectors: [],
    passwordSelectors: [],
    challengeSelectors: [],
  });
  assert.equal(result.loggedIn, false);
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
