import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';

import { siteLogin } from '../../scripts/site-login.mjs';

function createResolvedProfile(workspace) {
  return {
    profile: {
      host: 'www.bilibili.com',
      authSession: {
        loginUrl: 'https://passport.bilibili.com/login',
        postLoginUrl: 'https://www.bilibili.com/',
      },
    },
    warnings: [],
    filePath: path.resolve('profiles/www.bilibili.com.json'),
  };
}

function createResolvedBrowserOptions(workspace) {
  return {
    reuseLoginState: true,
    userDataDir: path.join(workspace, 'profiles', 'bilibili.com'),
    cleanupUserDataDirOnShutdown: false,
    authConfig: {
      loginUrl: 'https://passport.bilibili.com/login',
      postLoginUrl: 'https://www.bilibili.com/',
    },
  };
}

test('siteLogin writes identity-aware report fields for authenticated sessions', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-site-login-'));
  let closed = false;
  let openCalls = 0;
  const startupUrls = [];

  try {
    const report = await siteLogin('https://www.bilibili.com/', {
      outDir: workspace,
      profilePath: path.resolve('profiles/www.bilibili.com.json'),
      manualLoginTimeoutMs: 1_000,
      waitForManualLogin: false,
      autoLogin: true,
    }, {
      async resolveSiteAuthProfile() {
        const resolved = createResolvedProfile(workspace);
        resolved.warnings = ['compat warning'];
        return resolved;
      },
      async resolveSiteBrowserSessionOptions() {
        return createResolvedBrowserOptions(workspace);
      },
      async inspectPersistentProfileHealth() {
        return {
          healthy: true,
          warnings: [],
        };
      },
      async openBrowserSession() {
        openCalls += 1;
        startupUrls.push(arguments[0]?.startupUrl ?? null);
        return {
          browserStartUrl: arguments[0]?.startupUrl ?? null,
          browserAttachedVia: 'existing-target',
          async navigateAndWait() {},
          async close() {
            closed = true;
            return {
              shutdownMode: 'graceful',
              profileFlush: { stable: true },
            };
          },
        };
      },
      async ensureAuthenticatedSession() {
        return {
          status: 'authenticated',
          credentials: {
            source: 'env:BILIBILI_USERNAME/BILIBILI_PASSWORD',
          },
          challengeRequired: false,
          loginState: {
            currentUrl: 'https://www.bilibili.com/',
            title: 'bilibili',
            loggedIn: true,
            loginStateDetected: true,
            identityConfirmed: true,
            identitySource: 'selector:.bili-avatar img',
          },
          waitedForManualLogin: false,
        };
      },
      async inspectLoginState() {
        return {
          currentUrl: 'https://www.bilibili.com/',
          title: 'bilibili',
          loggedIn: true,
          loginStateDetected: true,
          identityConfirmed: true,
          identitySource: 'selector:.bili-avatar img',
        };
      },
      async waitForAuthenticatedSession() {
        throw new Error('manual wait should not be used when waitForManualLogin=false');
      },
    });

    assert.equal(report.auth.status, 'authenticated');
    assert.equal(report.auth.credentialsSource, 'env:BILIBILI_USERNAME/BILIBILI_PASSWORD');
    assert.equal(report.auth.loginStateDetected, true);
    assert.equal(report.auth.identityConfirmed, true);
    assert.equal(report.auth.identitySource, 'selector:.bili-avatar img');
    assert.equal(report.auth.reopenVerificationPassed, true);
    assert.equal(report.auth.persistenceVerified, true);
    assert.equal(report.auth.shutdownMode, 'graceful');
    assert.equal(report.site.userDataDir, path.join(workspace, 'profiles', 'bilibili.com'));
    assert.equal(report.site.browserStartUrl, 'https://www.bilibili.com/');
    assert.equal(report.site.browserAttachedVia, 'existing-target');
    assert.equal(report.warnings.includes('compat warning'), true);
    assert.equal(report.reports.json.endsWith('site-login-report.json'), true);
    assert.equal(closed, true);
    assert.equal(openCalls, 2);
    assert.deepEqual(startupUrls, [
      'https://www.bilibili.com/',
      'https://www.bilibili.com/',
    ]);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('siteLogin uses the login URL as startup page when interactive manual login is expected', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-site-login-manual-start-'));
  const startupUrls = [];

  try {
    await siteLogin('https://www.bilibili.com/', {
      outDir: workspace,
      profilePath: path.resolve('profiles/www.bilibili.com.json'),
      headless: false,
      waitForManualLogin: true,
      autoLogin: false,
    }, {
      async resolveSiteAuthProfile() {
        return createResolvedProfile(workspace);
      },
      async resolveSiteBrowserSessionOptions() {
        return createResolvedBrowserOptions(workspace);
      },
      async inspectPersistentProfileHealth() {
        return {
          healthy: true,
          warnings: [],
        };
      },
      async openBrowserSession() {
        startupUrls.push(arguments[0]?.startupUrl ?? null);
        return {
          browserStartUrl: arguments[0]?.startupUrl ?? null,
          browserAttachedVia: 'existing-target',
          async navigateAndWait() {},
          async close() {
            return {
              shutdownMode: 'graceful',
              profileFlush: { stable: true },
            };
          },
        };
      },
      async ensureAuthenticatedSession() {
        return {
          status: 'already-authenticated',
          credentials: null,
          challengeRequired: false,
          loginState: {
            currentUrl: 'https://www.bilibili.com/',
            title: 'bilibili',
            loggedIn: true,
            loginStateDetected: true,
            identityConfirmed: true,
            identitySource: 'selector:.header-entry-mini img',
          },
        };
      },
      async inspectLoginState() {
        return {
          currentUrl: 'https://www.bilibili.com/',
          title: 'bilibili',
          loggedIn: true,
          loginStateDetected: true,
          identityConfirmed: true,
          identitySource: 'selector:.header-entry-mini img',
        };
      },
      async waitForAuthenticatedSession() {
        throw new Error('manual wait should not be used');
      },
    });

    assert.equal(startupUrls[0], 'https://passport.bilibili.com/login');
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('siteLogin reports session-reused when persisted session is already authenticated', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-site-login-reused-'));
  const startupUrls = [];
  try {
    const report = await siteLogin('https://www.bilibili.com/', {
      outDir: workspace,
      profilePath: path.resolve('profiles/www.bilibili.com.json'),
      waitForManualLogin: false,
      autoLogin: false,
    }, {
      async resolveSiteAuthProfile() {
        return createResolvedProfile(workspace);
      },
      async resolveSiteBrowserSessionOptions() {
        return createResolvedBrowserOptions(workspace);
      },
      async inspectPersistentProfileHealth() {
        return {
          healthy: true,
          warnings: [],
        };
      },
      async openBrowserSession() {
        startupUrls.push(arguments[0]?.startupUrl ?? null);
        return {
          browserStartUrl: arguments[0]?.startupUrl ?? null,
          browserAttachedVia: 'existing-target',
          async navigateAndWait() {},
          async close() {
            return {
              shutdownMode: 'graceful',
              profileFlush: { stable: true },
            };
          },
        };
      },
      async ensureAuthenticatedSession() {
        return {
          status: 'already-authenticated',
          credentials: null,
          challengeRequired: false,
          loginState: {
            currentUrl: 'https://www.bilibili.com/',
            title: 'bilibili',
            loggedIn: true,
            loginStateDetected: true,
            identityConfirmed: true,
            identitySource: 'selector:.header-entry-mini img',
          },
        };
      },
      async inspectLoginState() {
        return {
          currentUrl: 'https://www.bilibili.com/',
          title: 'bilibili',
          loggedIn: true,
          loginStateDetected: true,
          identityConfirmed: true,
          identitySource: 'selector:.header-entry-mini img',
        };
      },
      async waitForAuthenticatedSession() {
        throw new Error('manual wait should not be used');
      },
    });

    assert.equal(report.auth.status, 'session-reused');
    assert.equal(report.auth.identityConfirmed, true);
    assert.equal(report.auth.identitySource, 'selector:.header-entry-mini img');
    assert.equal(report.auth.persistenceVerified, true);
    assert.deepEqual(startupUrls, [
      'https://www.bilibili.com/',
      'https://www.bilibili.com/',
    ]);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('siteLogin suppresses historical crashed-profile warning after successful graceful persistence verification', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-site-login-warning-suppression-'));
  try {
    const report = await siteLogin('https://www.bilibili.com/', {
      outDir: workspace,
      profilePath: path.resolve('profiles/www.bilibili.com.json'),
      waitForManualLogin: false,
      autoLogin: false,
    }, {
      async resolveSiteAuthProfile() {
        return createResolvedProfile(workspace);
      },
      async resolveSiteBrowserSessionOptions() {
        return createResolvedBrowserOptions(workspace);
      },
      async inspectPersistentProfileHealth() {
        return {
          healthy: false,
          warnings: ['Persistent browser profile last exit type was Crashed.'],
        };
      },
      async openBrowserSession() {
        return {
          browserStartUrl: arguments[0]?.startupUrl ?? null,
          browserAttachedVia: 'existing-target',
          async navigateAndWait() {},
          async close() {
            return {
              shutdownMode: 'graceful',
              profileFlush: { stable: true },
            };
          },
        };
      },
      async ensureAuthenticatedSession() {
        return {
          status: 'already-authenticated',
          credentials: null,
          challengeRequired: false,
          loginState: {
            currentUrl: 'https://www.bilibili.com/',
            title: 'bilibili',
            loggedIn: true,
            loginStateDetected: true,
            identityConfirmed: true,
            identitySource: 'selector:.header-entry-mini img',
          },
        };
      },
      async inspectLoginState() {
        return {
          currentUrl: 'https://www.bilibili.com/',
          title: 'bilibili',
          loggedIn: true,
          loginStateDetected: true,
          identityConfirmed: true,
          identitySource: 'selector:.header-entry-mini img',
        };
      },
      async waitForAuthenticatedSession() {
        throw new Error('manual wait should not be used');
      },
    });

    assert.equal(report.auth.status, 'session-reused');
    assert.equal(report.auth.persistenceVerified, true);
    assert.equal(report.warnings.includes('Persistent browser profile last exit type was Crashed.'), false);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('siteLogin does not report session-reused when reopen verification fails', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-site-login-reopen-fail-'));
  let openCalls = 0;

  try {
    const report = await siteLogin('https://www.bilibili.com/', {
      outDir: workspace,
      profilePath: path.resolve('profiles/www.bilibili.com.json'),
      waitForManualLogin: false,
      autoLogin: false,
    }, {
      async resolveSiteAuthProfile() {
        return createResolvedProfile(workspace);
      },
      async resolveSiteBrowserSessionOptions() {
        return createResolvedBrowserOptions(workspace);
      },
      async inspectPersistentProfileHealth() {
        return {
          healthy: true,
          warnings: [],
        };
      },
      async openBrowserSession() {
        openCalls += 1;
        return {
          async navigateAndWait() {},
          async close() {
            return {
              shutdownMode: 'graceful',
              profileFlush: { stable: true },
            };
          },
        };
      },
      async ensureAuthenticatedSession() {
        return {
          status: 'already-authenticated',
          credentials: null,
          challengeRequired: false,
          loginState: {
            currentUrl: 'https://www.bilibili.com/',
            title: 'bilibili',
            loggedIn: true,
            loginStateDetected: true,
            identityConfirmed: true,
            identitySource: 'selector:.header-entry-mini img',
          },
        };
      },
      async inspectLoginState() {
        if (openCalls === 1) {
          return {
            currentUrl: 'https://www.bilibili.com/',
            title: 'bilibili',
            loggedIn: true,
            loginStateDetected: true,
            identityConfirmed: true,
            identitySource: 'selector:.header-entry-mini img',
          };
        }
        return {
          currentUrl: 'https://space.bilibili.com/1202350411/dynamic',
          title: 'dynamic',
          loggedIn: false,
          loginStateDetected: false,
          identityConfirmed: false,
          identitySource: null,
        };
      },
      async waitForAuthenticatedSession() {
        throw new Error('manual wait should not be used');
      },
    });

    assert.equal(report.auth.status, 'authenticated');
    assert.equal(report.auth.reopenVerificationPassed, false);
    assert.equal(report.auth.persistenceVerified, false);
    assert.match(report.warnings.join('\n'), /could not confirm bilibili login persistence/u);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('siteLogin does not treat heuristic logged-in state as reusable without confirmed identity', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-site-login-heuristic-only-'));
  let openCalls = 0;

  try {
    const report = await siteLogin('https://www.bilibili.com/', {
      outDir: workspace,
      profilePath: path.resolve('profiles/www.bilibili.com.json'),
      waitForManualLogin: false,
      autoLogin: false,
    }, {
      async resolveSiteAuthProfile() {
        return createResolvedProfile(workspace);
      },
      async resolveSiteBrowserSessionOptions() {
        return createResolvedBrowserOptions(workspace);
      },
      async inspectPersistentProfileHealth() {
        return {
          healthy: true,
          warnings: [],
        };
      },
      async openBrowserSession() {
        openCalls += 1;
        return {
          async navigateAndWait() {},
          async close() {
            return {
              shutdownMode: 'graceful',
              profileFlush: { stable: true },
            };
          },
        };
      },
      async ensureAuthenticatedSession() {
        return {
          status: 'already-authenticated',
          credentials: null,
          challengeRequired: false,
          loginState: {
            currentUrl: 'https://www.bilibili.com/',
            title: 'bilibili',
            loggedIn: true,
            loginStateDetected: true,
            identityConfirmed: true,
            identitySource: 'selector:.header-entry-mini img',
          },
        };
      },
      async inspectLoginState() {
        if (openCalls === 1) {
          return {
            currentUrl: 'https://www.bilibili.com/',
            title: 'bilibili',
            loggedIn: true,
            loginStateDetected: true,
            identityConfirmed: true,
            identitySource: 'selector:.header-entry-mini img',
          };
        }
        return {
          currentUrl: 'https://space.bilibili.com/1202350411/dynamic',
          title: 'dynamic',
          loggedIn: true,
          loginStateDetected: true,
          identityConfirmed: false,
          identitySource: 'heuristic:no-login-form-or-logged-out-indicator',
        };
      },
      async waitForAuthenticatedSession() {
        throw new Error('manual wait should not be used');
      },
    });

    assert.notEqual(report.auth.status, 'session-reused');
    assert.equal(report.auth.reopenVerificationPassed, false);
    assert.equal(report.auth.persistenceVerified, false);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('siteLogin reports challenge-required without claiming identity confirmation', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-site-login-challenge-'));
  try {
    const report = await siteLogin('https://www.bilibili.com/', {
      outDir: workspace,
      profilePath: path.resolve('profiles/www.bilibili.com.json'),
      waitForManualLogin: false,
      autoLogin: true,
    }, {
      async resolveSiteAuthProfile() {
        return createResolvedProfile(workspace);
      },
      async resolveSiteBrowserSessionOptions() {
        return createResolvedBrowserOptions(workspace);
      },
      async inspectPersistentProfileHealth() {
        return {
          healthy: true,
          warnings: [],
        };
      },
      async openBrowserSession() {
        return {
          async close() {
            return {
              shutdownMode: 'graceful',
              profileFlush: { stable: true },
            };
          },
        };
      },
      async ensureAuthenticatedSession() {
        return {
          status: 'challenge-required',
          credentials: {
            source: 'env:BILIBILI_USERNAME/BILIBILI_PASSWORD',
          },
          challengeRequired: true,
          challengeText: 'slide verify',
          loginState: {
            currentUrl: 'https://passport.bilibili.com/login',
            title: 'login',
            loggedIn: false,
            loginStateDetected: false,
            identityConfirmed: false,
            identitySource: null,
          },
        };
      },
      async inspectLoginState() {
        return {
          currentUrl: 'https://passport.bilibili.com/login',
          title: 'login',
          loggedIn: false,
          loginStateDetected: false,
          identityConfirmed: false,
          identitySource: null,
        };
      },
      async waitForAuthenticatedSession() {
        throw new Error('manual wait should not be used');
      },
    });

    assert.equal(report.auth.status, 'challenge-required');
    assert.equal(report.auth.identityConfirmed, false);
    assert.match(report.warnings.join('\n'), /additional verification/u);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
