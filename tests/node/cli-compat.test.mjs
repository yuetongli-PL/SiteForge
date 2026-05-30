import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { mkdir, mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

import { resolveCliDispatch } from '../../src/entrypoints/cli/index.mjs';
import { resolveSocialSiteConfig } from '../../src/sites/known-sites/social/actions/router.mjs';
import {
  ACCEPTED_BOOLEAN_BUILD_FLAGS,
  ACCEPTED_ENUM_VALUE_BUILD_FLAGS,
  ACCEPTED_STRING_VALUE_BUILD_FLAGS,
  COMPAT_BOOLEAN_BUILD_FLAGS,
  COMPAT_ENUM_VALUE_BUILD_FLAGS,
  COMPAT_STRING_VALUE_BUILD_FLAGS,
  PUBLIC_BOOLEAN_BUILD_FLAGS,
  PUBLIC_BUILD_HELP_FLAGS,
  PUBLIC_ENUM_VALUE_BUILD_FLAGS,
  PUBLIC_STRING_VALUE_BUILD_FLAGS,
} from '../../src/entrypoints/cli/public-build-contract.mjs';

const repoRoot = process.cwd();
const LEGACY_PUBLIC_ROUTES = [
  ['capabilities', 'list', 'x-com-authorized-browser-surface'],
  ['site', 'doctor', 'https://example.com/'],
  ['download', 'plan', 'https://example.com/'],
  ['social', 'templates'],
  ['catalog', 'jable-ranking', 'https://example.com/'],
  ['skill', 'https://example.com/'],
  ['doctor', 'https://example.com/'],
];

function runNodeCli(scriptName, args, options = /** @type {any} */ ({})) {
  return spawnSync(process.execPath, [path.join(repoRoot, scriptName), ...args], {
    cwd: options.cwd ?? repoRoot,
    encoding: 'utf8',
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
  });
}

function assertBuildDispatch(args) {
  const dispatch = resolveCliDispatch(args);
  assert.equal(dispatch.script, path.resolve(repoRoot, 'src', 'entrypoints', 'build', 'run-build.mjs'));
  assert.deepEqual(dispatch.args, args.slice(1));
  return dispatch;
}

function assertResolveError(args, pattern) {
  assert.throws(
    () => resolveCliDispatch(args),
    pattern,
    `${args.join(' ')} should fail with ${pattern}`,
  );
}

test('public SiteForge CLI exposes only build help', () => {
  const help = runNodeCli(path.join('src', 'entrypoints', 'cli', 'index.mjs'), ['--help']);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /siteforge build <url>/u);
  for (const flag of PUBLIC_BUILD_HELP_FLAGS) {
    assert.match(help.stdout, new RegExp(flag.replace(/[|]/gu, '\\$&'), 'u'));
  }
  for (const flag of [
    ...COMPAT_BOOLEAN_BUILD_FLAGS,
    ...COMPAT_ENUM_VALUE_BUILD_FLAGS.map(([flagName]) => flagName),
    ...COMPAT_STRING_VALUE_BUILD_FLAGS,
  ]) {
    assert.doesNotMatch(help.stdout, new RegExp(`${flag}\\b`, 'u'));
  }
  assert.doesNotMatch(help.stdout, /--auth\b|--cookie-env\b|--cookie-file\b|--cookie-stdin\b|--auth-check-url\b|--login-enhanced\b|--public-only\b/u);
  assert.match(help.stdout, /siteforge\.local\.json/u);
  assert.doesNotMatch(help.stdout, /siteforge capabilities/u);
  assert.doesNotMatch(help.stdout, /site doctor|site scaffold|download plan|generate-skill/u);
});

test('public build contract separates user-facing and compatibility flags', () => {
  const publicFlags = new Set([
    ...PUBLIC_BOOLEAN_BUILD_FLAGS,
    ...PUBLIC_ENUM_VALUE_BUILD_FLAGS.map(([flagName]) => flagName),
    ...PUBLIC_STRING_VALUE_BUILD_FLAGS,
  ]);
  const compatFlags = [
    ...COMPAT_BOOLEAN_BUILD_FLAGS,
    ...COMPAT_ENUM_VALUE_BUILD_FLAGS.map(([flagName]) => flagName),
    ...COMPAT_STRING_VALUE_BUILD_FLAGS,
  ];
  const acceptedFlags = new Set([
    ...ACCEPTED_BOOLEAN_BUILD_FLAGS,
    ...ACCEPTED_ENUM_VALUE_BUILD_FLAGS.map(([flagName]) => flagName),
    ...ACCEPTED_STRING_VALUE_BUILD_FLAGS,
  ]);
  const helpFlags = PUBLIC_BUILD_HELP_FLAGS.join('\n');

  for (const flag of compatFlags) {
    assert.equal(publicFlags.has(flag), false, `${flag} must not be user-facing`);
    assert.equal(acceptedFlags.has(flag), true, `${flag} must remain accepted`);
    assert.doesNotMatch(helpFlags, new RegExp(`(^|\\s)${flag}(\\s|$)`, 'u'));
  }
});

test('public SiteForge CLI runs when invoked through an npm link path', async (t) => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-linked-cli-'));
  try {
    const nodeModulesDir = path.join(workspace, 'node_modules');
    const linkedPackageDir = path.join(nodeModulesDir, 'siteforge');
    await mkdir(nodeModulesDir, { recursive: true });
    try {
      await symlink(repoRoot, linkedPackageDir, process.platform === 'win32' ? 'junction' : 'dir');
    } catch (error) {
      if (['EPERM', 'ENOTSUP'].includes(error?.code)) {
        t.skip(`cannot create linked package path on this filesystem: ${error.code}`);
        return;
      }
      throw error;
    }

    const result = spawnSync(
      process.execPath,
      [path.join(linkedPackageDir, 'src', 'entrypoints', 'cli', 'index.mjs'), '--help'],
      {
        cwd: workspace,
        encoding: 'utf8',
        env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
      },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /siteforge build <url>/u);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('public SiteForge CLI help routes stay available', () => {
  for (const args of [
    [],
    ['--help'],
    ['build'],
    ['build', '--help'],
  ]) {
    const dispatch = resolveCliDispatch(args);
    assert.match(dispatch.help, /siteforge build <url>/u);
  }
});

test('internal social action defaults resolve profiles from repository root', () => {
  const xConfig = resolveSocialSiteConfig('x');
  const instagramConfig = resolveSocialSiteConfig('instagram');

  assert.equal(xConfig.defaultProfilePath, path.join(repoRoot, 'profiles', 'x.com.json'));
  assert.equal(instagramConfig.defaultProfilePath, path.join(repoRoot, 'profiles', 'www.instagram.com.json'));
});

test('public SiteForge CLI accepts documented and compatibility build flags', () => {
  assertBuildDispatch(['build', 'https://example.com/']);

  for (const flag of ACCEPTED_BOOLEAN_BUILD_FLAGS) {
    assertBuildDispatch(['build', 'https://example.com/', flag]);
  }

  for (const args of [
    ['build', 'https://example.com/', '--privacy', 'limited'],
    ['build', 'https://example.com/', '--privacy=limited'],
    ['build', 'https://example.com/', '--privacy', 'strict'],
    ['build', 'https://example.com/', '--report', 'user'],
    ['build', 'https://example.com/', '--report=user'],
    ['build', 'https://example.com/', '--report', 'debug'],
    ['build', 'https://example.com/', '--report', 'both'],
    ['build', 'https://example.com/', '--privacy', 'limited', '--report', 'both'],
    ['build', 'https://example.com/', '--auth', 'none'],
    ['build', 'https://example.com/', '--auth=cookie'],
    ['build', 'https://example.com/', '--auth=browser'],
    ['build', 'https://example.com/', '--render-js'],
    ['build', 'https://example.com/', '--no-render-js'],
    ['build', 'https://example.com/', '--browser-path', 'C:/Chrome/chrome.exe'],
    ['build', 'https://example.com/', '--timeout', '30000'],
    ['build', 'https://example.com/', '--max-depth', '4'],
    ['build', 'https://example.com/', '--max-pages', '200'],
    ['build', 'https://example.com/', '--max-seeds', '1000'],
    ['build', 'https://example.com/', '--max-sitemaps', '25'],
    ['build', 'https://example.com/', '--json'],
    ['build', 'https://example.com/', '--quiet'],
    ['build', 'https://example.com/', '--progress', 'plain'],
    ['build', 'https://example.com/', '--progress=auto'],
    ['build', 'https://example.com/', '--no-tty'],
    ['build', 'https://example.com/', '--force-tty'],
    ['build', 'https://example.com/', '--cookie-env', 'SITEFORGE_COOKIE'],
    ['build', 'https://example.com/', '--cookie-file', './cookies.txt'],
    ['build', 'https://example.com/', '--cookie-stdin'],
    ['build', 'https://example.com/', '--auth-check-url', '/account'],
  ]) {
    assertBuildDispatch(args);
  }
});

test('public SiteForge CLI rejects unsupported build arguments before dispatch', () => {
  for (const args of [
    ['build', 'https://example.com/', '--unknown'],
    ['build', 'https://example.com/', '--unknown=value'],
    ['build', 'https://example.com/', '--cookie'],
  ]) {
    assertResolveError(args, /Unknown flag: --/u);
  }

  for (const args of [
    ['build', 'https://example.com/', '--privacy'],
    ['build', 'https://example.com/', '--privacy='],
    ['build', 'https://example.com/', '--privacy', '--debug'],
    ['build', 'https://example.com/', '--cookie-env'],
    ['build', 'https://example.com/', '--cookie-env='],
    ['build', 'https://example.com/', '--cookie-file'],
    ['build', 'https://example.com/', '--auth-check-url'],
    ['build', 'https://example.com/', '--browser-path'],
    ['build', 'https://example.com/', '--timeout'],
    ['build', 'https://example.com/', '--max-pages'],
    ['build', 'https://example.com/', '--max-sitemaps'],
    ['build', 'https://example.com/', '--progress'],
  ]) {
    assertResolveError(args, /Missing value for --(?:privacy|cookie-env|cookie-file|auth-check-url|browser-path|timeout|max-pages|max-sitemaps|progress)/u);
  }

  assertResolveError(['build', 'https://example.com/', '--privacy', 'invalid'], /--privacy must be one of: limited, strict/u);
  assertResolveError(['build', 'https://example.com/', '--report', 'invalid'], /--report must be one of: user, debug, both/u);
  assertResolveError(['build', 'https://example.com/', '--auth', 'invalid'], /--auth must be one of: none, cookie, browser/u);
  assertResolveError(['build', 'https://example.com/', '--progress', 'invalid'], /--progress must be one of: auto, interactive, plain/u);
  assertResolveError(['build', 'https://example.com/', '--auto=false'], /Flag does not take a value: --auto/u);
  assertResolveError(['build', 'https://example.com/', '--manual=true'], /Flag does not take a value: --manual/u);
  assertResolveError(['build', 'https://example.com/', '--deep=1'], /Flag does not take a value: --deep/u);
  assertResolveError(['build', 'https://example.com/', '-x'], /Unknown flag: -x/u);
  assertResolveError(['build', 'https://example.com/', '-bad'], /Unknown flag: -bad/u);
  assertResolveError(['build', 'https://example.com/', 'extra'], /Unsupported argument: extra/u);
});

test('public SiteForge CLI validates build URL shape before dispatch', () => {
  assertResolveError(['build', 'not-a-url'], /Invalid URL: not-a-url/u);
  assertResolveError(['build', 'ftp:\/\/example.com/'], /Unsupported URL protocol: ftp:/u);
  assertResolveError(['build', 'https://user:pass@example.com/'], /URL must not include credentials/u);
});

test('public SiteForge CLI rejects legacy public routes at runtime', () => {
  assert.throws(
    () => resolveCliDispatch([
      'capabilities',
      'confirm',
      'x-com-authorized-browser-surface',
      '--group',
      'sensitive-read',
      '--limited',
    ]),
    /Unknown command: capabilities/u,
  );

  for (const route of LEGACY_PUBLIC_ROUTES) {
    const result = runNodeCli(path.join('src', 'entrypoints', 'cli', 'index.mjs'), route);
    assert.notEqual(result.status, 0, `${route.join(' ')} unexpectedly succeeded`);
    assert.match(result.stderr, new RegExp(`Unknown command: ${route[0]}`, 'u'));
    assert.match(result.stderr, /siteforge build <url>/u);
  }
});

test('public documentation and user-facing copy do not advertise internal CLI surface', async () => {
  const files = [
    'README.md',
    path.join('src', 'entrypoints', 'cli', 'index.mjs'),
    path.join('src', 'entrypoints', 'build', 'run-build.mjs'),
  ];
  const failures = /** @type {any[]} */ ([]);
  for (const file of files) {
    const text = await readFile(path.join(repoRoot, file), 'utf8');
    const lines = text.split(/\r?\n/u);
    for (const [index, line] of lines.entries()) {
      if (/\bsiteforge\s+(?!build\b)[a-z][\w-]*/u.test(line)) {
        failures.push(`${file}:${index + 1}: ${line.trim()}`);
      }
      if (/siteforge build .* --(?:json|quiet|progress|capability)\b/u.test(line)) {
        failures.push(`${file}:${index + 1}: ${line.trim()}`);
      }
    }
  }
  assert.deepEqual(failures, []);
});
