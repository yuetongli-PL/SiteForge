// @ts-check

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  createCliProgressRenderer,
  parseProgressCliOption,
  stripProgressCliOptions,
} from '../../infra/cli/progress-cli.mjs';
import { readCliValue } from '../../infra/cli/internal-options.mjs';
import { openBrowserSession } from '../../infra/browser/session.mjs';
import { resolveSiteBrowserSessionOptions, inspectLoginState } from '../../infra/auth/site-auth.mjs';
import { ensureDir, readJsonFile, writeTextFile } from '../../infra/io.mjs';
import {
  REDACTION_PLACEHOLDER,
  assertNoForbiddenPatterns,
  prepareRedactedArtifactJsonWithAudit,
  redactValue,
} from '../../domain/sessions/security-guard.mjs';
import { reasonCodeSummary } from '../../domain/risks/reason-codes.mjs';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(MODULE_DIR, '..', '..', '..');

const SITE_CONFIG = {
  x: {
    label: 'X',
    url: 'https://x.com/home',
    origin: 'https://x.com',
    defaultDomain: '.x.com',
    profilePath: path.join(REPO_ROOT, 'profiles', 'x.com.json'),
    requiredCookieNames: ['auth_token', 'ct0'],
  },
  instagram: {
    label: 'Instagram',
    url: 'https://www.instagram.com/',
    origin: 'https://www.instagram.com',
    defaultDomain: '.instagram.com',
    profilePath: path.join(REPO_ROOT, 'profiles', 'www.instagram.com.json'),
    requiredCookieNames: ['sessionid'],
  },
};

const DEFAULT_COOKIE_TTL_DAYS = 30;

function usage() {
  return `Internal script usage:
  node src/entrypoints/sites/social-auth-import.mjs --site x [options]
  node src/entrypoints/sites/social-auth-import.mjs --site instagram [options]

Public command:
  siteforge build <url>

Options:
  --site x|instagram        Target site. Default: x.
  --cookie-file <path>      Cookie source file. Supports JSON, Netscape cookies.txt, raw Cookie header, or Set-Cookie lines.
  --cookie-header <value>   Raw Cookie header. Blocked unless --allow-argv-cookie-header is also set.
  --cookie-header-env <var> Read a raw Cookie header from an environment variable.
  --allow-argv-cookie-header Allow --cookie-header after explicit acknowledgement. Prefer --cookie-header-env.
  --domain <domain>         Default cookie domain for header-only cookies. Default comes from --site.
  --run-root <dir>          Output root. Default: runs/social-auth-import.
  --execute                 Actually import cookies. Without this, only writes a dry-run manifest.
  --headless|--no-headless  Browser visibility. Default: --headless.
  --timeout <ms>            Browser timeout. Default: 30000.
  --user-data-dir <dir>     Override the persistent browser profile directory.
  --browser-path <path>     Override Chrome/Chromium executable.
  --browser-profile-root <dir> Override SiteForge profile root.
  --json                    Keep stdout as JSON and suppress progress.
  --quiet                   Suppress human progress on stderr.
  --progress <mode>         auto | interactive | plain.
  --force-tty               Force interactive progress.
  --no-tty                  Force plain progress.`;
}

export function socialAuthImportRedactionAuditPath(manifestPath) {
  const resolved = path.resolve(manifestPath);
  const ext = path.extname(resolved);
  const base = ext ? resolved.slice(0, -ext.length) : resolved;
  return `${base}.redaction-audit.json`;
}

function toSocialAuthImportRedactionFailure(error) {
  const recovery = reasonCodeSummary('redaction-failed');
  const failure = /** @type {Error & Record<string, any>} */ (new Error('Social auth import manifest redaction failed'));
  failure.name = 'SocialAuthImportManifestRedactionFailure';
  failure.code = 'redaction-failed';
  failure.reasonCode = 'redaction-failed';
  failure.retryable = recovery.retryable;
  failure.cooldownNeeded = recovery.cooldownNeeded;
  failure.isolationNeeded = recovery.isolationNeeded;
  failure.manualRecoveryNeeded = recovery.manualRecoveryNeeded;
  failure.degradable = recovery.degradable;
  failure.artifactWriteAllowed = recovery.artifactWriteAllowed;
  failure.catalogAction = recovery.catalogAction;
  failure.causeSummary = {
    name: error?.name ?? 'Error',
    code: error?.code ?? null,
  };
  return failure;
}

export function prepareSocialAuthImportManifestArtifact(manifest) {
  try {
    const safeManifest = {
      ...manifest,
      userDataDir: manifest.userDataDir ? REDACTION_PLACEHOLDER : manifest.userDataDir,
    };
    return prepareRedactedArtifactJsonWithAudit(safeManifest);
  } catch (error) {
    throw toSocialAuthImportRedactionFailure(error);
  }
}

export async function writeSocialAuthImportManifest(manifestPath, manifest) {
  const resolvedManifestPath = path.resolve(manifestPath);
  const redactionAudit = socialAuthImportRedactionAuditPath(resolvedManifestPath);
  const prepared = prepareSocialAuthImportManifestArtifact({
    ...manifest,
    artifacts: {
      ...(manifest.artifacts ?? {}),
      redactionAudit,
    },
  });
  await writeTextFile(redactionAudit, prepared.auditJson);
  await writeTextFile(resolvedManifestPath, prepared.json);
  return {
    manifestPath: resolvedManifestPath,
    redactionAudit,
    value: prepared.value,
    audit: prepared.auditValue,
  };
}

export function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    site: 'x',
    cookieFile: null,
    cookieHeader: null,
    cookieHeaderEnv: null,
    domain: null,
    runRoot: path.join(REPO_ROOT, 'runs', 'social-auth-import'),
    execute: false,
    headless: true,
    timeoutMs: 30_000,
    userDataDir: null,
    browserPath: null,
    browserProfileRoot: null,
    allowArgvCookieHeader: false,
    json: false,
    quiet: false,
    progressMode: undefined,
    forceTty: false,
    noTty: false,
  };

  const readValue = (index) => readCliValue(argv, index, argv[index]);

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const progressOption = parseProgressCliOption(argv, arg, index, options);
    if (progressOption.handled) {
      index = progressOption.nextIndex;
      continue;
    }
    switch (arg) {
      case '--help':
      case '-h':
        options.help = true;
        break;
      case '--site': {
        const parsed = readValue(index);
        options.site = parsed.value;
        index = parsed.nextIndex;
        break;
      }
      case '--cookie-file': {
        const parsed = readValue(index);
        options.cookieFile = parsed.value;
        index = parsed.nextIndex;
        break;
      }
      case '--cookie-header': {
        const parsed = readValue(index);
        options.cookieHeader = parsed.value;
        index = parsed.nextIndex;
        break;
      }
      case '--allow-argv-cookie-header':
        options.allowArgvCookieHeader = true;
        break;
      case '--cookie-header-env': {
        const parsed = readValue(index);
        options.cookieHeaderEnv = parsed.value;
        index = parsed.nextIndex;
        break;
      }
      case '--domain': {
        const parsed = readValue(index);
        options.domain = parsed.value;
        index = parsed.nextIndex;
        break;
      }
      case '--run-root': {
        const parsed = readValue(index);
        options.runRoot = path.resolve(parsed.value);
        index = parsed.nextIndex;
        break;
      }
      case '--timeout': {
        const parsed = readValue(index);
        options.timeoutMs = Number(parsed.value);
        index = parsed.nextIndex;
        break;
      }
      case '--user-data-dir': {
        const parsed = readValue(index);
        options.userDataDir = parsed.value;
        index = parsed.nextIndex;
        break;
      }
      case '--browser-path': {
        const parsed = readValue(index);
        options.browserPath = parsed.value;
        index = parsed.nextIndex;
        break;
      }
      case '--browser-profile-root': {
        const parsed = readValue(index);
        options.browserProfileRoot = parsed.value;
        index = parsed.nextIndex;
        break;
      }
      case '--execute':
        options.execute = true;
        break;
      case '--headless':
        options.headless = true;
        break;
      case '--no-headless':
        options.headless = false;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!SITE_CONFIG[options.site]) {
    throw new Error(`Unsupported site: ${options.site}`);
  }
  if (options.cookieHeader && options.allowArgvCookieHeader !== true) {
    throw new Error(
      'Raw --cookie-header is blocked because argv can be persisted by shells/process listings; use --cookie-header-env or add --allow-argv-cookie-header for an explicit bounded import.',
    );
  }
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new Error('--timeout must be a positive number');
  }
  return options;
}

function parseJsonCookies(text) {
  const payload = JSON.parse(text);
  if (Array.isArray(payload)) {
    return payload;
  }
  if (Array.isArray(payload?.cookies)) {
    return payload.cookies;
  }
  if (Array.isArray(payload?.data?.cookies)) {
    return payload.data.cookies;
  }
  throw new Error('JSON cookie input must be an array or contain a cookies array');
}

function parseNetscapeCookies(text) {
  const cookies = /** @type {any[]} */ ([]);
  for (const line of text.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const parts = line.split('\t');
    if (parts.length < 7) {
      continue;
    }
    const [domain, , cookiePath, secure, expires, name, ...valueParts] = parts;
    cookies.push({
      domain,
      path: cookiePath || '/',
      secure: /^true$/iu.test(secure),
      expires: Number(expires) || undefined,
      name,
      value: valueParts.join('\t'),
    });
  }
  return cookies;
}

function parseCookieDate(value) {
  const millis = Date.parse(String(value ?? ''));
  return Number.isFinite(millis) ? Math.trunc(millis / 1000) : undefined;
}

function defaultCookieExpires() {
  return Math.trunc(Date.now() / 1000) + DEFAULT_COOKIE_TTL_DAYS * 24 * 60 * 60;
}

function parseSetCookieLine(line, defaultDomain) {
  const parts = String(line ?? '').split(';').map((part) => part.trim()).filter(Boolean);
  const [first, ...attributes] = parts;
  const equalsIndex = first?.indexOf('=') ?? -1;
  if (equalsIndex <= 0) {
    return null;
  }
  const cookie = {
    name: first.slice(0, equalsIndex).trim(),
    value: first.slice(equalsIndex + 1),
    domain: defaultDomain,
    path: '/',
    secure: true,
    expires: defaultCookieExpires(),
  };
  for (const attribute of attributes) {
    const attrIndex = attribute.indexOf('=');
    const key = (attrIndex >= 0 ? attribute.slice(0, attrIndex) : attribute).trim().toLowerCase();
    const value = attrIndex >= 0 ? attribute.slice(attrIndex + 1).trim() : '';
    if (key === 'domain' && value) {
      cookie.domain = value;
    } else if (key === 'path' && value) {
      cookie.path = value;
    } else if (key === 'expires' && value) {
      cookie.expires = parseCookieDate(value);
    } else if (key === 'max-age' && Number(value) > 0) {
      cookie.expires = Math.trunc(Date.now() / 1000) + Number(value);
    } else if (key === 'secure') {
      cookie.secure = true;
    } else if (key === 'httponly') {
      cookie.httpOnly = true;
    } else if (key === 'samesite' && value) {
      cookie.sameSite = value;
    }
  }
  return cookie;
}

function parseHeaderCookies(text, defaultDomain) {
  const source = String(text ?? '').trim();
  if (!source) {
    return [];
  }
  const lines = source.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  if (lines.length > 1 || /;\s*(domain|path|expires|max-age|samesite|secure|httponly)\b/iu.test(source)) {
    return lines
      .map((line) => line.replace(/^set-cookie:\s*/iu, ''))
      .map((line) => parseSetCookieLine(line, defaultDomain))
      .filter(Boolean);
  }

  return source.split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const equalsIndex = part.indexOf('=');
      if (equalsIndex <= 0) {
        return null;
      }
      return {
        name: part.slice(0, equalsIndex).trim(),
        value: part.slice(equalsIndex + 1),
        domain: defaultDomain,
        path: '/',
        secure: true,
        expires: defaultCookieExpires(),
      };
    })
    .filter(Boolean);
}

function mapSameSite(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized || normalized === 'unspecified') {
    return undefined;
  }
  if (['no_restriction', 'none'].includes(normalized)) {
    return 'None';
  }
  if (normalized === 'lax') {
    return 'Lax';
  }
  if (normalized === 'strict') {
    return 'Strict';
  }
  return undefined;
}

function normalizeCookie(cookie, defaults = /** @type {any} */ ({})) {
  const name = String(cookie?.name ?? '').trim();
  if (!name) {
    return null;
  }
  const domain = String(cookie?.domain ?? cookie?.host ?? defaults.domain ?? '').trim() || defaults.domain;
  const expires = Number(cookie?.expires ?? cookie?.expirationDate ?? cookie?.expiry);
  const normalized = {
    name,
    value: String(cookie?.value ?? ''),
    domain,
    path: String(cookie?.path ?? '/').trim() || '/',
    secure: cookie?.secure === undefined ? true : Boolean(cookie.secure),
    httpOnly: Boolean(cookie?.httpOnly),
  };
  const sameSite = mapSameSite(cookie?.sameSite ?? cookie?.same_site);
  if (sameSite) {
    normalized.sameSite = sameSite;
  }
  if (Number.isFinite(expires) && expires > 0) {
    normalized.expires = Math.trunc(expires);
  }
  return normalized;
}

export function parseCookieInput(text, { defaultDomain = '.x.com' } = /** @type {any} */ ({})) {
  const source = String(text ?? '').trim();
  if (!source) {
    return [];
  }
  let rawCookies;
  if (/^[\[{]/u.test(source)) {
    rawCookies = parseJsonCookies(source);
  } else if (source.split(/\r?\n/u).some((line) => line.split('\t').length >= 7)) {
    rawCookies = parseNetscapeCookies(source);
  } else {
    rawCookies = parseHeaderCookies(source, defaultDomain);
  }
  return rawCookies
    .map((cookie) => normalizeCookie(cookie, { domain: defaultDomain }))
    .filter(Boolean);
}

export function summarizeCookies(cookies, requiredCookieNames = /** @type {any[]} */ ([])) {
  const names = [...new Set(cookies.map((cookie) => cookie.name))].sort((left, right) => left.localeCompare(right, 'en'));
  const missingRequired = requiredCookieNames.filter((name) => !names.includes(name));
  return {
    count: cookies.length,
    names,
    domains: [...new Set(cookies.map((cookie) => cookie.domain))].sort((left, right) => left.localeCompare(right, 'en')),
    missingRequired,
  };
}

function cookieIdentity(cookie) {
  return [
    String(cookie?.name ?? '').trim().toLowerCase(),
    String(cookie?.domain ?? '').trim().toLowerCase(),
    String(cookie?.path ?? '/').trim() || '/',
  ].join('|');
}

export function validateCookieImportPlan(cookies, cookieSummary = /** @type {any} */ ({}), siteConfig = /** @type {any} */ ({})) {
  const errors = /** @type {any[]} */ ([]);
  if (!Array.isArray(cookies) || cookies.length === 0) {
    errors.push({
      code: 'empty-cookie-input',
      message: 'No cookies were parsed from the provided source.',
    });
  }

  if (Array.isArray(cookieSummary.missingRequired) && cookieSummary.missingRequired.length > 0) {
    errors.push({
      code: 'missing-required-cookies',
      message: `Missing required ${siteConfig.label ?? 'site'} cookie names: ${cookieSummary.missingRequired.join(', ')}`,
      cookieNames: [...cookieSummary.missingRequired],
    });
  }

  const counts = new Map();
  for (const cookie of cookies ?? []) {
    const identity = cookieIdentity(cookie);
    counts.set(identity, (counts.get(identity) ?? 0) + 1);
  }
  const duplicateKeys = [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([identity]) => {
      const [name, domain, cookiePath] = identity.split('|');
      return { name, domain, path: cookiePath };
    });
  if (duplicateKeys.length > 0) {
    errors.push({
      code: 'duplicate-cookie-input',
      message: 'Duplicate cookie name/domain/path entries would make the import order-dependent.',
      cookies: duplicateKeys,
    });
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}

export async function loadCookieSource(options, siteConfig = SITE_CONFIG[options.site]) {
  if (options.cookieHeaderEnv) {
    const value = process.env[options.cookieHeaderEnv];
    if (!value) {
      throw new Error(`Environment variable ${options.cookieHeaderEnv} is empty or not set`);
    }
    return { source: `env:${options.cookieHeaderEnv}`, text: value };
  }
  if (options.cookieHeader) {
    return { source: 'argv:cookie-header', text: options.cookieHeader };
  }
  if (options.cookieFile) {
    const filePath = path.resolve(options.cookieFile);
    return { source: filePath, text: await readFile(filePath, 'utf8') };
  }
  throw new Error('Provide --cookie-file, --cookie-header-env, or --cookie-header');
}

function toCookieParam(cookie, origin) {
  const payload = {
    url: origin,
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    path: cookie.path,
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
  };
  if (cookie.sameSite) {
    payload.sameSite = cookie.sameSite;
  }
  if (cookie.expires) {
    payload.expires = cookie.expires;
  }
  return payload;
}

function createCookieApiRejectedError(imported) {
  const failed = imported.filter((entry) => entry.success !== true);
  const error = /** @type {Error & Record<string, any>} */ (new Error(`Cookie API rejected ${failed.length} of ${imported.length} cookie(s)`));
  error.code = 'cookie-api-rejected';
  error.failedCookieNames = [...new Set(failed.map((entry) => entry.name).filter(Boolean))];
  return error;
}

async function importCookiesIntoSession(session, cookies, origin) {
  const results = /** @type {any[]} */ ([]);
  for (const cookie of cookies) {
    const params = toCookieParam(cookie, origin);
    const result = await session.send('Network.setCookie', params);
    results.push({
      name: cookie.name,
      domain: cookie.domain,
      success: result?.success === true,
    });
  }
  return results;
}

export async function runImport(options = /** @type {any} */ ({}), deps = /** @type {any} */ ({})) {
  const siteConfig = deps.siteConfig ?? SITE_CONFIG[options.site ?? 'x'];
  if (!siteConfig) {
    throw new Error(`Unsupported site: ${options.site ?? 'x'}`);
  }
  const loadCookieSourceImpl = deps.loadCookieSource ?? loadCookieSource;
  const readJsonFileImpl = deps.readJsonFile ?? readJsonFile;
  const resolveSiteBrowserSessionOptionsImpl = deps.resolveSiteBrowserSessionOptions ?? resolveSiteBrowserSessionOptions;
  const openBrowserSessionImpl = deps.openBrowserSession ?? openBrowserSession;
  const inspectLoginStateImpl = deps.inspectLoginState ?? inspectLoginState;
  const writeManifestImpl = deps.writeSocialAuthImportManifest ?? writeSocialAuthImportManifest;
  const runId = new Date().toISOString().replace(/[-:.]/gu, '').replace(/Z$/u, 'Z');
  const runDir = path.join(path.resolve(options.runRoot ?? path.join(REPO_ROOT, 'runs', 'social-auth-import')), runId);
  await ensureDir(runDir);

  const cookieSource = await loadCookieSourceImpl(options, siteConfig);
  const cookies = parseCookieInput(cookieSource.text, {
    defaultDomain: options.domain ?? siteConfig.defaultDomain,
  });
  const cookieSummary = summarizeCookies(cookies, siteConfig.requiredCookieNames);
  const validation = validateCookieImportPlan(cookies, cookieSummary, siteConfig);
  const manifestPath = path.join(runDir, 'manifest.json');
  const manifest = {
    runId,
    mode: options.execute ? 'execute' : 'plan',
    site: options.site ?? 'x',
    status: 'planned',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    cookieSource: cookieSource.source === 'argv:cookie-header' ? 'argv:cookie-header' : cookieSource.source,
    cookieSummary,
    imported: [],
    auth: null,
    userDataDir: null,
    manifestPath,
    validation,
  };

  if (!validation.ok) {
    manifest.status = 'invalid-input';
    manifest.reason = validation.errors[0]?.code ?? 'invalid-cookie-input';
    manifest.finishedAt = new Date().toISOString();
    await writeManifestImpl(manifestPath, manifest);
    return manifest;
  }

  if (!options.execute) {
    await writeManifestImpl(manifestPath, manifest);
    return manifest;
  }

  let session = null;
  try {
    const siteProfile = await readJsonFileImpl(siteConfig.profilePath);
    const authContext = await resolveSiteBrowserSessionOptionsImpl(siteConfig.url, {
      profilePath: siteConfig.profilePath,
      browserPath: options.browserPath ?? undefined,
      browserProfileRoot: options.browserProfileRoot ?? undefined,
      userDataDir: options.userDataDir ?? undefined,
      reuseLoginState: true,
    }, {
      siteProfile,
      profilePath: siteConfig.profilePath,
    });
    manifest.userDataDir = authContext.userDataDir;
    session = await openBrowserSessionImpl({
      browserPath: options.browserPath ?? undefined,
      headless: options.headless,
      timeoutMs: options.timeoutMs,
      userDataDir: authContext.userDataDir,
      cleanupUserDataDirOnShutdown: false,
      startupUrl: siteConfig.origin,
      fullPage: false,
      viewport: {
        width: 1440,
        height: 900,
        deviceScaleFactor: 1,
      },
    });

    manifest.imported = await importCookiesIntoSession(session, cookies, siteConfig.origin);
    if (manifest.imported.some((entry) => entry.success !== true)) {
      throw createCookieApiRejectedError(manifest.imported);
    }
    await session.navigateAndWait(siteConfig.url, {
      useLoadEvent: false,
      useNetworkIdle: false,
      documentReadyTimeoutMs: options.timeoutMs,
      domQuietTimeoutMs: options.timeoutMs,
      domQuietMs: 800,
      idleMs: 1000,
    });
    const authState = await inspectLoginStateImpl(session, authContext.authConfig);
    manifest.auth = {
      status: authState?.identityConfirmed === true ? 'authenticated' : 'not-authenticated',
      loginStateDetected: authState?.loginStateDetected === true || authState?.loggedIn === true,
      identityConfirmed: authState?.identityConfirmed === true,
      identitySource: authState?.identitySource ?? null,
      currentUrl: authState?.currentUrl ?? null,
      title: authState?.title ?? null,
      hasLoginForm: authState?.hasLoginForm === true,
      hasChallenge: authState?.hasChallenge === true,
      challengeText: authState?.challengeText ?? null,
    };
    manifest.status = manifest.auth.identityConfirmed ? 'authenticated' : 'imported-not-authenticated';
  } catch (error) {
    manifest.status = 'failed';
    manifest.reason = error?.code ?? 'social-auth-import-failed';
    manifest.error = {
      message: error?.message ?? String(error),
      code: error?.code ?? null,
      failedCookieNames: Array.isArray(error?.failedCookieNames) ? error.failedCookieNames : undefined,
    };
  } finally {
    if (session) {
      manifest.shutdown = await session.close();
    }
    manifest.finishedAt = new Date().toISOString();
    await writeManifestImpl(manifestPath, manifest);
  }
  return manifest;
}

function toSocialAuthImportCliSummaryRedactionFailure(error) {
  const recovery = reasonCodeSummary('redaction-failed');
  const failure = /** @type {Error & Record<string, any>} */ (new Error('Social auth import CLI summary redaction failed'));
  failure.name = 'SocialAuthImportCliSummaryRedactionFailure';
  failure.code = 'redaction-failed';
  failure.reasonCode = 'redaction-failed';
  failure.retryable = recovery.retryable;
  failure.cooldownNeeded = recovery.cooldownNeeded;
  failure.isolationNeeded = recovery.isolationNeeded;
  failure.manualRecoveryNeeded = recovery.manualRecoveryNeeded;
  failure.degradable = recovery.degradable;
  failure.artifactWriteAllowed = recovery.artifactWriteAllowed;
  failure.catalogAction = recovery.catalogAction;
  failure.causeSummary = {
    name: error?.name ?? 'Error',
    code: error?.code ?? null,
  };
  return failure;
}

export function socialAuthImportCliSummary(manifest) {
  try {
    const summary = {
      status: manifest.status,
      mode: manifest.mode,
      site: manifest.site,
      cookieSummary: manifest.cookieSummary,
      auth: manifest.auth,
      manifestPath: manifest.manifestPath,
      userDataDir: manifest.userDataDir ? REDACTION_PLACEHOLDER : manifest.userDataDir,
    };
    const redacted = redactValue(summary).value;
    assertNoForbiddenPatterns(JSON.stringify(redacted));
    return redacted;
  } catch (error) {
    throw toSocialAuthImportCliSummaryRedactionFailure(error);
  }
}

function isFailedImportStatus(status) {
  return ['failed', 'imported-not-authenticated', 'invalid-input'].includes(status);
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(usage());
    return 0;
  }
  const progress = createCliProgressRenderer({
    ...options,
    json: options.json,
  });
  const task = progress.task({
    id: 'socialAuthImport',
    title: 'Social auth import',
    totalStages: 1,
    item: options.site,
  });
  const stage = task.stage({
    id: 'import',
    title: 'Import governed auth state',
    index: 1,
    total: 1,
    item: options.site,
  });
  let manifest;
  try {
    manifest = await runImport(stripProgressCliOptions(options));
    const message = `${manifest.status ?? 'unknown'} ${manifest.mode ?? ''}`.trim();
    if (isFailedImportStatus(manifest.status)) {
      stage.fail({ message });
      task.fail({ message });
      progress.failure({
        taskId: 'socialAuthImport',
        title: 'Social auth import failed',
        stage: 'Import governed auth state',
        reason: manifest.reason ?? manifest.status ?? 'auth import failed',
        report: manifest.manifestPath,
      });
    } else {
      stage.succeed({ message });
      task.succeed({
        message,
        artifacts: manifest.manifestPath ? [{ label: 'manifest', path: manifest.manifestPath }] : [],
      });
    }
  } catch (error) {
    const reason = error?.message ?? String(error);
    stage.fail({ message: reason });
    task.fail({ message: reason });
    progress.failure({
      taskId: 'socialAuthImport',
      title: 'Social auth import failed',
      stage: 'Import governed auth state',
      reason,
    });
    throw error;
  }
  console.log(JSON.stringify(socialAuthImportCliSummary(manifest), null, 2));
  return isFailedImportStatus(manifest.status) ? 1 : 0;
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (entryPath && entryPath === fileURLToPath(import.meta.url)) {
  main().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    console.error(error?.stack ?? error?.message ?? String(error));
    process.exitCode = 1;
  });
}
