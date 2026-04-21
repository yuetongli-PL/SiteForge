import test from 'node:test';
import assert from 'node:assert/strict';

import {
  bootstrapReusableSiteSession,
  buildReusableSessionInspectionOptions,
  buildReusableSessionInspectionSettings,
  buildSiteLoginBootstrapOptions,
  didSiteLoginProduceReusableSession,
  inspectRequestReusableSiteSession,
  runSiteLoginBootstrap,
} from '../../src/infra/auth/site-login-service.mjs';

test('buildSiteLoginBootstrapOptions keeps explicit false values and shared defaults', () => {
  const options = buildSiteLoginBootstrapOptions({
    profilePath: 'profiles/www.douyin.com.json',
    reuseLoginState: false,
    allowAutoLoginBootstrap: false,
    headless: false,
    outDir: 'runs/sites/site-login',
  });

  assert.equal(options.profilePath, 'profiles/www.douyin.com.json');
  assert.equal(options.reuseLoginState, false);
  assert.equal(options.autoLogin, false);
  assert.equal(options.headless, false);
  assert.equal(options.outDir, 'runs/sites/site-login');
});

test('buildSiteLoginBootstrapOptions lets overrides win over request defaults', () => {
  const options = buildSiteLoginBootstrapOptions({
    reuseLoginState: false,
    allowAutoLoginBootstrap: false,
    headless: true,
  }, {
    reuseLoginState: true,
    autoLogin: true,
    headless: false,
    waitForManualLogin: true,
  });

  assert.equal(options.reuseLoginState, true);
  assert.equal(options.autoLogin, true);
  assert.equal(options.headless, false);
  assert.equal(options.waitForManualLogin, true);
});

test('buildReusableSessionInspectionSettings keeps explicit false values and shared defaults', () => {
  const settings = buildReusableSessionInspectionSettings({
    browserProfileRoot: 'profiles',
    userDataDir: 'profiles/www.douyin.com',
    reuseLoginState: false,
  });

  assert.equal(settings.browserProfileRoot, 'profiles');
  assert.equal(settings.userDataDir, 'profiles/www.douyin.com');
  assert.equal(settings.reuseLoginState, false);
});

test('buildReusableSessionInspectionOptions keeps caller site context', () => {
  const options = buildReusableSessionInspectionOptions({
    profilePath: 'profiles/www.bilibili.com.json',
    siteProfile: { host: 'www.bilibili.com' },
  });

  assert.equal(options.profilePath, 'profiles/www.bilibili.com.json');
  assert.equal(options.siteProfile.host, 'www.bilibili.com');
});

test('runSiteLoginBootstrap delegates through the injectable siteLogin seam', async () => {
  let captured = null;
  const report = await runSiteLoginBootstrap('https://www.bilibili.com/', {
    profilePath: 'profiles/www.bilibili.com.json',
    reuseLoginState: true,
  }, {
    async siteLogin(url, options, deps) {
      captured = { url, options, deps };
      return {
        auth: {
          status: 'session-reused',
          persistenceVerified: true,
        },
      };
    },
    siteLoginDeps: { source: 'test' },
  }, {
    autoLogin: true,
    headless: false,
  });

  assert.equal(captured.url, 'https://www.bilibili.com/');
  assert.equal(captured.options.profilePath, 'profiles/www.bilibili.com.json');
  assert.equal(captured.options.reuseLoginState, true);
  assert.equal(captured.options.autoLogin, true);
  assert.equal(captured.options.headless, false);
  assert.deepEqual(captured.deps, { source: 'test' });
  assert.equal(report.auth.status, 'session-reused');
});

test('inspectRequestReusableSiteSession delegates through the injectable session inspection seam', async () => {
  let captured = null;
  const report = await inspectRequestReusableSiteSession('https://www.douyin.com/', {
    profilePath: 'profiles/www.douyin.com.json',
    browserProfileRoot: 'profiles',
    userDataDir: 'profiles/www.douyin.com',
    reuseLoginState: true,
    siteProfile: { host: 'www.douyin.com' },
  }, {
    async inspectReusableSiteSession(inputUrl, settings, options, deps) {
      captured = { inputUrl, settings, options, deps };
      return {
        authAvailable: true,
        userDataDir: settings.userDataDir,
        profilePath: options.profilePath,
      };
    },
    marker: 'deps',
  });

  assert.equal(captured.inputUrl, 'https://www.douyin.com/');
  assert.equal(captured.settings.browserProfileRoot, 'profiles');
  assert.equal(captured.settings.userDataDir, 'profiles/www.douyin.com');
  assert.equal(captured.settings.reuseLoginState, true);
  assert.equal(captured.options.profilePath, 'profiles/www.douyin.com.json');
  assert.equal(captured.options.siteProfile.host, 'www.douyin.com');
  assert.equal(captured.deps.marker, 'deps');
  assert.equal(report.authAvailable, true);
});

test('didSiteLoginProduceReusableSession recognizes persistence verification and session reuse', () => {
  assert.equal(
    didSiteLoginProduceReusableSession({
      auth: {
        persistenceVerified: true,
        status: 'authenticated',
      },
    }),
    true,
  );
  assert.equal(
    didSiteLoginProduceReusableSession({
      auth: {
        persistenceVerified: false,
        status: 'session-reused',
      },
    }),
    true,
  );
  assert.equal(
    didSiteLoginProduceReusableSession({
      auth: {
        persistenceVerified: false,
        status: 'challenge-required',
      },
    }),
    false,
  );
});

test('bootstrapReusableSiteSession combines site-login bootstrap and reusable-session verdict', async () => {
  const result = await bootstrapReusableSiteSession('https://www.bilibili.com/', {
    profilePath: 'profiles/www.bilibili.com.json',
  }, {
    async siteLogin() {
      return {
        auth: {
          status: 'session-reused',
          persistenceVerified: true,
        },
      };
    },
  }, {
    autoLogin: true,
  });

  assert.equal(result.ok, true);
  assert.equal(result.report.auth.status, 'session-reused');
});
