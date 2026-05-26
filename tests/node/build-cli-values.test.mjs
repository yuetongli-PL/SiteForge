import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { parseCliArgs } from '../../src/entrypoints/build/run-build.mjs';

const SCRIPT = path.join(process.cwd(), 'src', 'entrypoints', 'build', 'run-build.mjs');

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

test('build CLI rejects removed legacy flags as unknown arguments', () => {
  for (const flag of ['--idle-ms', '--max-triggers', '--max-captured-states', '--chapter-fetch-concurrency']) {
    const result = runBuildCli(['https://example.com/', flag, '1']);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, new RegExp(`未知参数: ${flag}`, 'u'));
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

  assert.equal(parseCliArgs(['https://example.com/', '--auth', 'none']).options.authMode, 'none');
  assert.equal(parseCliArgs(['https://example.com/', '--auth', 'browser']).options.authMode, 'browser');
  assert.throws(() => parseCliArgs(['https://example.com/', '--cookie', 'sid=secret']), /未知参数: --cookie|鏈煡鍙傛暟: --cookie/u);
  assert.throws(() => parseCliArgs(['https://example.com/', '--cookie-env']), /Missing value for --cookie-env/u);
  assert.throws(() => parseCliArgs(['https://example.com/', '--max-sitemaps']), /Missing value for --max-sitemaps/u);
});

test('build CLI parses robots remediation plan flag', () => {
  const parsed = parseCliArgs(['https://example.com/', '--robots-plan', '--json']);
  assert.equal(parsed.options.robotsPlan, true);
  assert.equal(parsed.options.json, true);
});

test('internal build entrypoint parses hidden raw network flag', () => {
  const parsed = parseCliArgs(['https://example.com/', '--internal-raw-network']);
  assert.equal(parsed.options.internalRawNetwork, true);
  assert.equal(parsed.options.network, true);
  assert.equal(parsed.options.captureNetwork, true);
  assert.equal(parsed.options.renderJs, true);
  assert.equal(parsed.options.renderJsExplicit, true);
});

test('build CLI defaults to automatic non-interactive build', () => {
  const parsed = parseCliArgs(['https://example.com/']);
  assert.equal(parsed.options.auto, true);
  assert.equal(parsed.options.manual, undefined);
  assert.equal(parsed.options.setupInteractive, false);
  assert.equal(parsed.options.interactive, false);
  assert.equal(parsed.options.disableManualCapabilityProofPrompt, true);

  const manual = parseCliArgs(['https://example.com/', '--manual']);
  assert.equal(manual.options.auto, true);
  assert.equal(manual.options.manual, false);
  assert.equal(manual.options.setupInteractive, false);
  assert.equal(manual.options.interactive, false);
  assert.equal(manual.options.disableManualCapabilityProofPrompt, true);
  assert.equal(manual.options.manualSupplementalCollection, false);
});
