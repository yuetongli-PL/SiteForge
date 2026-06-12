import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import os from 'node:os';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { applyLocalBuildConfig, materializeCookieSourceOptions, parseCliArgs } from '../../src/entrypoints/build/run-build.mjs';
import {
  ACCEPTED_ENUM_VALUE_BUILD_FLAGS,
  PUBLIC_BUILD_HELP,
} from '../../src/entrypoints/cli/public-build-contract.mjs';

const SCRIPT = path.join(process.cwd(), 'src', 'entrypoints', 'build', 'run-build.mjs');
const LEGACY_MOJIBAKE_UNKNOWN_ARGUMENT = /\u93c8\uE046\u7161\u9359\u509b\u669f/u;

function runBuildCli(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
  });
}

test('build CLI rejects missing numeric values before consuming following flags', () => {
  const result = runBuildCli(['https://example.com/', '--timeout', '--json']);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Missing value for --timeout/u);
});

test('build CLI rejects non-finite numeric values', () => {
  for (const value of ['NaN', 'Infinity']) {
    const result = runBuildCli(['https://example.com/', '--timeout', value]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /--timeout must be a finite integer/u);
  }
});

test('internal build parser enum flags stay aligned with public build contract', () => {
  for (const [flag, values] of ACCEPTED_ENUM_VALUE_BUILD_FLAGS) {
    const acceptedValues = Array.isArray(values) ? values : [values];
    for (const value of acceptedValues) {
      const parsed = parseCliArgs(['https://example.com/', flag, value]);
      if (flag === '--privacy') {
        assert.equal(parsed.options.privacyMode, value);
      } else if (flag === '--report') {
        assert.equal(parsed.options.reportMode, value);
      } else if (flag === '--auth') {
        assert.equal(parsed.options.authMode, value);
      } else if (flag === '--progress') {
        assert.equal(parsed.options.progressMode, value);
      } else {
        assert.fail(`Unhandled enum build flag in parser contract test: ${flag}`);
      }
    }
    assert.throws(
      () => parseCliArgs(['https://example.com/', flag, '__invalid__']),
      new RegExp(`${flag} must be one of: ${acceptedValues.join(', ')}`, 'u'),
    );
  }
});

test('internal build CLI help reuses the public help contract', () => {
  const result = runBuildCli(['--help']);

  assert.equal(result.status, 0);
  assert.equal(result.stdout, `${PUBLIC_BUILD_HELP}\n`);
  assert.doesNotMatch(result.stdout, LEGACY_MOJIBAKE_UNKNOWN_ARGUMENT);
});

test('build CLI rejects removed legacy flags as unknown arguments', () => {
  for (const flag of ['--idle-ms', '--max-triggers', '--max-captured-states', '--chapter-fetch-concurrency']) {
    const result = runBuildCli(['https://example.com/', flag, '1']);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, new RegExp(`未知参数: ${flag}`, 'u'));
    assert.doesNotMatch(result.stderr, LEGACY_MOJIBAKE_UNKNOWN_ARGUMENT);
    assert.doesNotMatch(result.stderr, /legacy|retired|pipeline chain/iu);
  }
});

test('build CLI parses cookie auth flags without exposing raw cookie argv support', () => {
  const parsed = parseCliArgs([
    'https://example.com/',
    '--auth',
    'cookie',
    '--cookie-env',
    'SITEFORGE_COOKIE',
    '--cookie-file',
    './cookies.txt',
    '--cookie-stdin',
    '--auth-check-url',
    '/account',
    '--max-sitemaps',
    '7',
  ]);

  assert.equal(parsed.options.authMode, 'cookie');
  assert.equal(parsed.options.cookieEnv, 'SITEFORGE_COOKIE');
  assert.equal(parsed.options.cookieFile, './cookies.txt');
  assert.equal(parsed.options.cookieStdin, true);
  assert.equal(parsed.options.authCheckUrl, '/account');
  assert.equal(parsed.options.maxSitemaps, 7);
  assert.equal(parseCliArgs(['https://example.com/', '--user-authorized-browser-live']).options.userAuthorizedBrowserLive, true);

  assert.equal(parseCliArgs(['https://example.com/', '--auth', 'none']).options.authMode, 'none');
  assert.equal(parseCliArgs(['https://example.com/', '--auth', 'browser']).options.authMode, 'browser');
  assert.throws(() => parseCliArgs(['https://example.com/', '--cookie', 'sid=secret']), /未知参数: --cookie/u);
  assert.throws(() => parseCliArgs(['https://example.com/', '--cookie-env']), /Missing value for --cookie-env/u);
  assert.throws(() => parseCliArgs(['https://example.com/', '--max-sitemaps']), /Missing value for --max-sitemaps/u);
});

test('build CLI materializes cookie env only into the runtime cookie header field', async () => {
  const parsed = parseCliArgs([
    'https://weibo.com/',
    '--task',
    'search posts',
    '--slot',
    'query=openai',
    '--execute',
    '--cookie-env',
    'SITEFORGE_TEST_RUNTIME_COOKIE',
  ]);
  const materialized = await materializeCookieSourceOptions(parsed.options, {
    env: {
      SITEFORGE_TEST_RUNTIME_COOKIE: 'sf_fixture_cookie=synthetic_weibo_cookie',
    },
  });

  assert.equal(materialized.executionTask, 'search posts');
  assert.equal(materialized.runtimeExecutionContext.slotValues.query, 'openai');
  assert.equal(materialized.apiReplayCookieHeader, 'sf_fixture_cookie=synthetic_weibo_cookie');
  assert.equal(materialized.cookieEnv, 'SITEFORGE_TEST_RUNTIME_COOKIE');
  const persistedMaterialized = await materializeCookieSourceOptions(parsed.options, {
    env: {},
    persistedEnvReader: async (name) => (
      name === 'SITEFORGE_TEST_RUNTIME_COOKIE'
        ? 'sf_persisted_fixture_cookie=synthetic_weibo_cookie'
        : ''
    ),
  });
  assert.equal(persistedMaterialized.apiReplayCookieHeader, 'sf_persisted_fixture_cookie=synthetic_weibo_cookie');

  await assert.rejects(
    () => materializeCookieSourceOptions({ cookieEnv: 'MISSING_COOKIE' }, {
      env: {},
      persistedEnvReader: async () => '',
    }),
    (error) => {
      const runtimeError = /** @type {any} */ (error);
      assert.match(runtimeError.message, /Environment variable MISSING_COOKIE is empty or not set/u);
      assert.equal(runtimeError.reasonCode, 'runtime.cookie_env_missing');
      assert.equal(runtimeError.code, 'runtime.cookie_env_missing');
      assert.match(runtimeError.reasonAction, /Set MISSING_COOKIE as a process or Windows User\/Machine environment variable/u);
      return true;
    },
  );
});

test('build CLI reports missing cookie env as a structured runtime failure', () => {
  const result = runBuildCli([
    'https://weibo.com/',
    '--task',
    'search posts',
    '--execute',
    '--slot',
    'query=gaokao',
    '--auth',
    'cookie',
    '--cookie-env',
    'SITEFORGE_TEST_MISSING_RUNTIME_COOKIE',
    '--json',
  ]);

  assert.notEqual(result.status, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.reasonCode, 'runtime.cookie_env_missing');
  assert.equal(
    payload.reason,
    'Environment variable SITEFORGE_TEST_MISSING_RUNTIME_COOKIE is empty or not set',
  );
  assert.match(
    payload.reasonAction,
    /Set SITEFORGE_TEST_MISSING_RUNTIME_COOKIE as a process or Windows User\/Machine environment variable/u,
  );
  const sensitiveCookiePattern = new RegExp([
    'synthetic_weibo_cookie',
    'S' + 'CF=',
    'S' + 'UB=',
    'WBP' + 'SESS=',
  ].join('|'), 'u');
  assert.doesNotMatch(result.stdout, sensitiveCookiePattern);
});

test('explicit browser auth keeps local cookie config on the Browser Bridge path', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-build-cli-browser-cookie-config-'));
  try {
    await writeFile(
      path.join(workspace, 'siteforge.local.json'),
      `\uFEFF${JSON.stringify({
        sites: [
          {
            url: 'https://www.reddit.com/',
            cookie: 'sid=SYNTHETIC_BROWSER_BRIDGE_COOKIE; uid=123',
            auth: {
              mode: 'cookie',
              authCheckUrl: '/',
              authRoutes: ['/subreddits/mine/'],
              publicRevisitRoutes: ['/'],
            },
            build: {
              browserBridgeManaged: true,
              browserBridgeApiReplayManaged: true,
            },
          },
        ],
      })}`,
      'utf8',
    );

    const parsed = parseCliArgs(['https://www.reddit.com/', '--auth', 'browser']);
    const options = await applyLocalBuildConfig('https://www.reddit.com/', parsed.options, { cwd: workspace });

    assert.equal(options.authMode, 'browser');
    assert.equal(options.strictBrowserAuth, true);
    assert.equal(options.strictCookieAuth, undefined);
    assert.equal(options.cookieHeader, undefined);
    assert.equal(options.apiReplayCookieHeader, 'sid=SYNTHETIC_BROWSER_BRIDGE_COOKIE; uid=123');
    assert.equal(options.browserBridgeManaged, true);
    assert.equal(options.browserBridgeApiReplayManaged, true);
    assert.equal(options.localBuildConfig.build.browserBridgeApiReplayManaged, true);
    assert.deepEqual(options.localBuildConfig.authRoutes, ['/subreddits/mine/']);
    assert.deepEqual(options.localBuildConfig.publicRevisitRoutes, ['/']);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('build CLI parses robots remediation plan flag', () => {
  const parsed = parseCliArgs(['https://example.com/', '--robots-plan', '--json']);
  assert.equal(parsed.options.robotsPlan, true);
  assert.equal(parsed.options.json, true);
});

test('build CLI parses repeated runtime task slots without mixing them into task text', () => {
  const parsed = parseCliArgs([
    'https://example.com/',
    '--task',
    'search posts',
    '--slot',
    'query=openai',
    '--slot',
    'section=top',
    '--execute',
  ]);

  assert.equal(parsed.options.executionTask, 'search posts');
  assert.equal(parsed.options.execute, true);
  assert.deepEqual(parsed.options.runtimeExecutionContext.slotValues, {
    query: 'openai',
    section: 'top',
  });
  assert.throws(() => parseCliArgs(['https://example.com/', '--slot', 'query']), /--slot must use name=value/u);
  assert.throws(() => parseCliArgs(['https://example.com/', '--slot', '1query=value']), /--slot name must start with a letter/u);
});

test('internal build entrypoint parses hidden raw network flag', () => {
  const parsed = parseCliArgs(['https://example.com/', '--internal-raw-network']);
  assert.equal(parsed.options.internalRawNetwork, true);
  assert.equal(parsed.options.network, true);
  assert.equal(parsed.options.captureNetwork, true);
  assert.equal(parsed.options.renderJs, true);
  assert.equal(parsed.options.renderJsExplicit, true);
});

test('internal build entrypoint parses hidden Browser Bridge managed flags', () => {
  const parsed = parseCliArgs([
    'https://x.com/',
    '--browser-bridge-managed',
    '--browser-bridge-api-replay-managed',
  ]);

  assert.equal(parsed.options.browserBridgeManaged, true);
  assert.equal(parsed.options.browserBridgeApiReplayManaged, true);
});

test('build CLI parses rendered browser headless flags', () => {
  const visible = parseCliArgs(['https://example.com/', '--no-headless']);
  assert.equal(visible.options.headless, false);

  const headless = parseCliArgs(['https://example.com/', '--headless']);
  assert.equal(headless.options.headless, true);
});

test('build CLI defaults to automatic non-interactive build', () => {
  const parsed = parseCliArgs(['https://example.com/']);
  assert.equal(parsed.options.auto, true);
  assert.equal(parsed.options.manual, undefined);
  assert.equal(parsed.options.setupInteractive, false);
  assert.equal(parsed.options.interactive, false);
  assert.equal(parsed.options.disableManualCapabilityProofPrompt, true);
  assert.equal(parsed.options.network, true);
  assert.equal(parsed.options.captureNetwork, true);
  assert.equal(parsed.options.internalRawNetwork, true);
  assert.equal(parsed.options.renderJs, true);

  const manual = parseCliArgs(['https://example.com/', '--manual']);
  assert.equal(manual.options.auto, true);
  assert.equal(manual.options.manual, false);
  assert.equal(manual.options.setupInteractive, false);
  assert.equal(manual.options.interactive, false);
  assert.equal(manual.options.disableManualCapabilityProofPrompt, true);
  assert.equal(manual.options.manualSupplementalCollection, false);
  assert.equal(manual.options.internalRawNetwork, true);
});

test('build CLI no-render flag disables default API extraction', () => {
  const parsed = parseCliArgs(['https://example.com/', '--no-render-js']);

  assert.equal(parsed.options.renderJs, false);
  assert.equal(parsed.options.renderJsExplicit, true);
  assert.equal(parsed.options.renderJsDisabledExplicit, true);
  assert.equal(parsed.options.network, false);
  assert.equal(parsed.options.captureNetwork, false);
  assert.equal(parsed.options.internalRawNetwork, false);
  assert.equal(parsed.options.apiExtractionDisabledReason, 'render-js-disabled');
});
