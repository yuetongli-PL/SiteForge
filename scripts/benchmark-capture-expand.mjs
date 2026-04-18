import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { capture } from '../capture.mjs';
import { expandStates } from '../expand-states.mjs';
import { initializeCliUtf8 } from '../lib/cli.mjs';
import { openBrowserSession } from '../lib/browser-runtime/session.mjs';
import {
  AUTHENTICATED_BILIBILI_BENCHMARKS,
  DEFAULT_CAPTURE_EXPAND_BENCHMARKS,
  buildBenchmarkReport,
  renderBenchmarkMarkdown,
} from '../lib/browser-runtime/benchmark-report.mjs';
import { readJsonFile } from '../lib/io.mjs';
import { inspectLoginState, resolveSiteAuthProfile, resolveSiteBrowserSessionOptions } from '../lib/site-auth.mjs';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(MODULE_DIR, '..');

function formatTimestampForDir(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.(\d{3})Z$/, '$1Z');
}

function normalizeBoolean(value, flagName) {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const lower = value.toLowerCase();
    if (lower === 'true') {
      return true;
    }
    if (lower === 'false') {
      return false;
    }
  }
  throw new Error(`Invalid boolean for ${flagName}: ${value}`);
}

function normalizeNumber(value, flagName) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid number for ${flagName}: ${value}`);
  }
  return parsed;
}

function defaultOutputDir() {
  return path.resolve(process.cwd(), 'archive', 'benchmarks', `${formatTimestampForDir()}_capture-expand`);
}

function defaultOptions() {
  return {
    outDir: defaultOutputDir(),
    browserPath: undefined,
    timeoutMs: 30_000,
    idleMs: 1_000,
    waitUntil: 'load',
    headless: true,
    fullPage: true,
    reuseLoginState: false,
    autoLogin: false,
    browserProfileRoot: undefined,
    userDataDir: undefined,
    maxTriggers: 2,
    maxCapturedStates: 3,
    viewport: {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
    },
  };
}

function mergeOptions(options = {}) {
  const defaults = defaultOptions();
  const merged = {
    ...defaults,
    ...options,
    viewport: {
      ...defaults.viewport,
      ...(options.viewport ?? {}),
    },
  };

  merged.outDir = path.resolve(merged.outDir);
  merged.timeoutMs = normalizeNumber(merged.timeoutMs, 'timeoutMs');
  merged.idleMs = normalizeNumber(merged.idleMs, 'idleMs');
  merged.headless = normalizeBoolean(merged.headless, 'headless');
  merged.fullPage = normalizeBoolean(merged.fullPage, 'fullPage');
  merged.reuseLoginState = normalizeBoolean(merged.reuseLoginState, 'reuseLoginState');
  merged.autoLogin = normalizeBoolean(merged.autoLogin, 'autoLogin');
  merged.browserProfileRoot = merged.browserProfileRoot ? path.resolve(merged.browserProfileRoot) : undefined;
  merged.userDataDir = merged.userDataDir ? path.resolve(merged.userDataDir) : undefined;
  merged.maxTriggers = Math.max(0, Math.floor(normalizeNumber(merged.maxTriggers, 'maxTriggers')));
  merged.maxCapturedStates = Math.max(0, Math.floor(normalizeNumber(merged.maxCapturedStates, 'maxCapturedStates')));
  if (merged.waitUntil !== 'load' && merged.waitUntil !== 'networkidle') {
    throw new Error(`Unsupported waitUntil value: ${merged.waitUntil}`);
  }
  merged.viewport = {
    width: normalizeNumber(merged.viewport.width, 'viewport.width'),
    height: normalizeNumber(merged.viewport.height, 'viewport.height'),
    deviceScaleFactor: normalizeNumber(merged.viewport.deviceScaleFactor, 'viewport.deviceScaleFactor'),
  };

  return merged;
}

function parseBenchmarks(value) {
  if (!value) {
    return DEFAULT_CAPTURE_EXPAND_BENCHMARKS;
  }

  const requested = new Set(
    String(value)
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean),
  );
  const filtered = [...DEFAULT_CAPTURE_EXPAND_BENCHMARKS, ...AUTHENTICATED_BILIBILI_BENCHMARKS]
    .filter((entry) => requested.has(entry.id.toLowerCase()));
  if (filtered.length === 0) {
    throw new Error(`Unknown benchmark selection: ${value}`);
  }
  return filtered;
}

function parseCliArgs(argv) {
  const args = [...argv];
  const options = {};

  const readValue = (current, index) => {
    const eqIndex = current.indexOf('=');
    if (eqIndex !== -1) {
      return { value: current.slice(eqIndex + 1), nextIndex: index };
    }
    if (index + 1 >= args.length) {
      throw new Error(`Missing value for ${current}`);
    }
    return { value: args[index + 1], nextIndex: index + 1 };
  };

  const readOptionalBooleanValue = (current, index) => {
    const eqIndex = current.indexOf('=');
    if (eqIndex !== -1) {
      return { value: current.slice(eqIndex + 1), nextIndex: index };
    }
    const next = args[index + 1];
    if (next && !next.startsWith('--')) {
      return { value: next, nextIndex: index + 1 };
    }
    return { value: true, nextIndex: index };
  };

  for (let index = 0; index < args.length; index += 1) {
    const current = args[index];

    if (current === '--help' || current === '-h') {
      options.help = true;
      continue;
    }

    if (current.startsWith('--out-dir')) {
      const { value, nextIndex } = readValue(current, index);
      options.outDir = value;
      index = nextIndex;
      continue;
    }

    if (current.startsWith('--browser-path')) {
      const { value, nextIndex } = readValue(current, index);
      options.browserPath = value;
      index = nextIndex;
      continue;
    }

    if (current.startsWith('--timeout')) {
      const { value, nextIndex } = readValue(current, index);
      options.timeoutMs = value;
      index = nextIndex;
      continue;
    }

    if (current.startsWith('--idle-ms')) {
      const { value, nextIndex } = readValue(current, index);
      options.idleMs = value;
      index = nextIndex;
      continue;
    }

    if (current.startsWith('--wait-until')) {
      const { value, nextIndex } = readValue(current, index);
      options.waitUntil = value;
      index = nextIndex;
      continue;
    }

    if (current.startsWith('--benchmarks')) {
      const { value, nextIndex } = readValue(current, index);
      options.benchmarks = parseBenchmarks(value);
      index = nextIndex;
      continue;
    }

    if (current.startsWith('--max-triggers')) {
      const { value, nextIndex } = readValue(current, index);
      options.maxTriggers = value;
      index = nextIndex;
      continue;
    }

    if (current.startsWith('--max-captured-states')) {
      const { value, nextIndex } = readValue(current, index);
      options.maxCapturedStates = value;
      index = nextIndex;
      continue;
    }

    if (current === '--full-page' || current.startsWith('--full-page=')) {
      const { value, nextIndex } = readOptionalBooleanValue(current, index);
      options.fullPage = value;
      index = nextIndex;
      continue;
    }

    if (current === '--no-full-page') {
      options.fullPage = false;
      continue;
    }

    if (current === '--headless' || current.startsWith('--headless=')) {
      const { value, nextIndex } = readOptionalBooleanValue(current, index);
      options.headless = value;
      index = nextIndex;
      continue;
    }

    if (current === '--no-headless') {
      options.headless = false;
      continue;
    }

    if (current === '--reuse-login-state' || current.startsWith('--reuse-login-state=')) {
      const { value, nextIndex } = readOptionalBooleanValue(current, index);
      options.reuseLoginState = value;
      index = nextIndex;
      continue;
    }

    if (current === '--no-reuse-login-state') {
      options.reuseLoginState = false;
      continue;
    }

    if (current.startsWith('--browser-profile-root')) {
      const { value, nextIndex } = readValue(current, index);
      options.browserProfileRoot = value;
      index = nextIndex;
      continue;
    }

    if (current.startsWith('--user-data-dir')) {
      const { value, nextIndex } = readValue(current, index);
      options.userDataDir = value;
      index = nextIndex;
      continue;
    }

    throw new Error(`Unknown option: ${current}`);
  }

  return options;
}

function printHelp() {
  process.stdout.write(`Usage:
  node scripts/benchmark-capture-expand.mjs [options]

Options:
  --out-dir <path>           Report output directory
  --browser-path <path>      Explicit Chromium/Chrome executable path
  --timeout <ms>             CDP timeout budget for each phase
  --idle-ms <ms>             Extra delay after readiness
  --wait-until <mode>        load | networkidle
  --benchmarks <ids>         Comma-separated subset: jable,moodyz,bilibili-home-search-video,bilibili-category-popular,bilibili-bangumi,bilibili-author-videos,bilibili-author-follow-list,bilibili-author-fans-list,22biqu
  --max-triggers <n>         Per-page trigger sample limit
  --max-captured-states <n>  Additional captured states sample limit
  --full-page                Force full-page screenshot (default)
  --no-full-page             Disable full-page screenshot
  --headless                 Run headless (default)
  --no-headless              Run with visible browser
  --reuse-login-state        Reuse persistent site login state for authenticated benchmark entries
  --no-reuse-login-state     Disable login-state reuse
  --browser-profile-root <dir>  Persistent browser-profile root
  --user-data-dir <dir>      Explicit persistent user-data-dir
  --help                     Show this help
`);
}

async function resolveBenchmarkEntry(entry) {
  if (!entry?.profilePath) {
    return {
      ...entry,
      searchQueries: Array.isArray(entry.searchQueries) ? entry.searchQueries : [],
    };
  }

  const profilePath = path.resolve(REPO_ROOT, entry.profilePath);
  const profile = await readJsonFile(profilePath);
  const samples = profile?.validationSamples ?? {};
  const authSamples = profile?.authValidationSamples ?? {};
  const resolvedUrl = entry.urlSource === 'profile-host-home'
    ? `https://${profile.host}/`
    : String(
      authSamples?.[entry.authUrlSampleField]
      ?? samples?.[entry.urlSampleField]
      ?? '',
    ).trim();
  const resolvedSearchQueries = entry.searchQuerySampleField
    ? [String(samples?.[entry.searchQuerySampleField] ?? '').trim()].filter(Boolean)
    : Array.isArray(entry.searchQueries) ? entry.searchQueries : [];

  if (!resolvedUrl) {
    throw new Error(`Missing ${entry.authUrlSampleField ?? entry.urlSampleField ?? 'benchmark URL'} in ${entry.profilePath}`);
  }

  return {
    ...entry,
    url: resolvedUrl,
    searchQueries: resolvedSearchQueries,
  };
}

function shouldAppendAuthenticatedBilibiliEntries(options) {
  return options.reuseLoginState === true;
}

async function probeBenchmarkAuthAvailability(entry, rootOptions) {
  try {
    const authProfile = await resolveSiteAuthProfile(entry.url, {
      profilePath: entry.profilePath ? path.resolve(REPO_ROOT, entry.profilePath) : undefined,
    });
    const authContext = await resolveSiteBrowserSessionOptions(entry.url, {
      browserProfileRoot: rootOptions.browserProfileRoot,
      userDataDir: rootOptions.userDataDir,
      reuseLoginState: rootOptions.reuseLoginState,
      autoLogin: false,
    }, {
      profilePath: entry.profilePath ? path.resolve(REPO_ROOT, entry.profilePath) : undefined,
      authProfile,
    });
    if (!authContext.authConfig?.loginUrl || !authContext.userDataDir || !authContext.reuseLoginState) {
      return {
        attempted: false,
        authAvailable: false,
        identityConfirmed: false,
        probeFailed: false,
        reason: 'profile-unavailable',
      };
    }
    const session = await openBrowserSession({
      browserPath: rootOptions.browserPath,
      headless: rootOptions.headless,
      timeoutMs: rootOptions.timeoutMs,
      fullPage: false,
      viewport: rootOptions.viewport,
      userDataDir: authContext.userDataDir,
      cleanupUserDataDirOnShutdown: authContext.cleanupUserDataDirOnShutdown,
    }, {
      userDataDirPrefix: `benchmark-auth-probe-${entry.id}-`,
    });
    try {
      await session.navigateAndWait(entry.url, {
        useLoadEvent: false,
        useNetworkIdle: false,
        documentReadyTimeoutMs: 8_000,
        domQuietTimeoutMs: 8_000,
        domQuietMs: 400,
        idleMs: 250,
      });
      const loginState = await inspectLoginState(session, authContext.authConfig);
      return {
        attempted: true,
        authAvailable: loginState?.identityConfirmed === true,
        identityConfirmed: loginState?.identityConfirmed === true,
        probeFailed: false,
        reason: loginState?.identityConfirmed === true ? null : 'not-logged-in',
      };
    } finally {
      await session.close();
    }
  } catch (error) {
    return {
      attempted: true,
      authAvailable: false,
      identityConfirmed: false,
      probeFailed: true,
      reason: error?.message ?? String(error),
    };
  }
}

async function runPhaseWithMetrics(phaseRunner, settings) {
  let trackedSession = null;
  const runtimeFactory = async (runtimeSettings) => {
    trackedSession = await openBrowserSession(runtimeSettings, {
      browserPath: runtimeSettings.browserPath,
      userDataDirPrefix: runtimeSettings.userDataDirPrefix,
    });
    return trackedSession;
  };

  const startedAt = Date.now();
  const result = await phaseRunner({
    ...settings,
    runtimeFactory,
  });
  const durationMs = Date.now() - startedAt;
  const metrics = trackedSession?.getMetrics?.() ?? null;

  return { result, durationMs, metrics };
}

async function runBenchmarkEntry(entry, rootOptions) {
  const entryDir = path.join(rootOptions.outDir, entry.id);
  const captureOutDir = path.join(entryDir, 'capture');
  const expandOutDir = path.join(entryDir, 'expanded');

  const sharedOptions = {
    browserPath: rootOptions.browserPath,
    browserProfileRoot: rootOptions.browserProfileRoot,
    userDataDir: rootOptions.userDataDir,
    timeoutMs: rootOptions.timeoutMs,
    idleMs: rootOptions.idleMs,
    waitUntil: rootOptions.waitUntil,
    headless: rootOptions.headless,
    fullPage: rootOptions.fullPage,
    reuseLoginState: rootOptions.reuseLoginState,
    autoLogin: rootOptions.autoLogin,
    maxTriggers: entry.maxTriggers ?? rootOptions.maxTriggers,
    maxCapturedStates: entry.maxCapturedStates ?? rootOptions.maxCapturedStates,
    viewport: rootOptions.viewport,
  };

  let authAvailable = null;
  if (entry.authRequired) {
    const authProbe = await probeBenchmarkAuthAvailability(entry, rootOptions);
    authAvailable = authProbe.authAvailable;
    if (!authAvailable) {
      const skippedReason = authProbe.probeFailed
        ? `Reusable logged-in bilibili session probe failed: ${authProbe.reason ?? 'unknown error'}.`
        : authProbe.reason === 'profile-unavailable'
          ? 'Reusable logged-in bilibili session is unavailable for this benchmark.'
          : 'Reusable logged-in bilibili session could not confirm account identity for this benchmark.';
      return {
        id: entry.id,
        label: entry.label,
        url: entry.url,
        searchQueries: entry.searchQueries,
        authRequired: true,
        authAvailable: false,
        skippedReason,
        budget: {
          maxTriggers: sharedOptions.maxTriggers,
          maxCapturedStates: sharedOptions.maxCapturedStates,
          hit: false,
          stopReason: null,
        },
        capture: {
          durationMs: 0,
          status: 'skipped',
          outDir: null,
          finalUrl: null,
          metrics: null,
        },
        expand: {
          durationMs: 0,
          outDir: null,
          capturedStates: 0,
          discoveredTriggers: 0,
          attemptedTriggers: 0,
          duplicateStates: 0,
          noopTriggers: 0,
          failedTriggers: 0,
          metrics: null,
        },
      };
    }
  }

  const capturePhase = await runPhaseWithMetrics(
    async (phaseOptions) => await capture(entry.url, {
      ...phaseOptions,
      outDir: captureOutDir,
      userDataDirPrefix: `capture-benchmark-${entry.id}-`,
    }),
    sharedOptions,
  );

  const expandPhase = await runPhaseWithMetrics(
    async (phaseOptions) => await expandStates(entry.url, {
      ...phaseOptions,
      initialManifestPath: capturePhase.result.files.manifest,
      outDir: expandOutDir,
      searchQueries: entry.searchQueries,
      maxTriggers: phaseOptions.maxTriggers,
      maxCapturedStates: phaseOptions.maxCapturedStates,
      captureChapterArtifacts: false,
      userDataDirPrefix: `expand-benchmark-${entry.id}-`,
    }),
    sharedOptions,
  );

  return {
    id: entry.id,
    label: entry.label,
    url: entry.url,
    searchQueries: entry.searchQueries,
    authRequired: entry.authRequired === true,
    authAvailable,
    budget: {
      maxTriggers: sharedOptions.maxTriggers,
      maxCapturedStates: sharedOptions.maxCapturedStates,
      hit: Boolean(expandPhase.result.budget?.hit),
      stopReason: expandPhase.result.budget?.stopReason ?? null,
    },
    capture: {
      durationMs: capturePhase.durationMs,
      status: capturePhase.result.status,
      outDir: capturePhase.result.outDir,
      finalUrl: capturePhase.result.finalUrl,
      metrics: capturePhase.metrics,
    },
    expand: {
      durationMs: expandPhase.durationMs,
      outDir: expandPhase.result.outDir,
      capturedStates: expandPhase.result.summary?.capturedStates ?? 0,
      discoveredTriggers: expandPhase.result.summary?.discoveredTriggers ?? 0,
      attemptedTriggers: expandPhase.result.summary?.attemptedTriggers ?? 0,
      duplicateStates: expandPhase.result.summary?.duplicateStates ?? 0,
      noopTriggers: expandPhase.result.summary?.noopTriggers ?? 0,
      failedTriggers: expandPhase.result.summary?.failedTriggers ?? 0,
      metrics: expandPhase.metrics,
    },
  };
}

export async function benchmarkCaptureExpand(options = {}) {
  const settings = mergeOptions(options);
  const benchmarkEntries = options.benchmarks
    ?? [
      ...DEFAULT_CAPTURE_EXPAND_BENCHMARKS,
      ...(shouldAppendAuthenticatedBilibiliEntries(settings) ? AUTHENTICATED_BILIBILI_BENCHMARKS : []),
    ];
  const benchmarks = [];

  await mkdir(settings.outDir, { recursive: true });
  for (const entry of benchmarkEntries) {
    benchmarks.push(await resolveBenchmarkEntry(entry));
  }

  const benchmarkResults = [];
  for (const entry of benchmarks) {
    try {
      benchmarkResults.push(await runBenchmarkEntry(entry, settings));
    } catch (error) {
      benchmarkResults.push({
        id: entry.id,
        label: entry.label,
        url: entry.url,
        searchQueries: entry.searchQueries,
        budget: {
          maxTriggers: entry.maxTriggers ?? settings.maxTriggers,
          maxCapturedStates: entry.maxCapturedStates ?? settings.maxCapturedStates,
          hit: false,
          stopReason: null,
        },
        error: error.message,
        capture: { durationMs: 0, status: 'failed', outDir: null, finalUrl: null, metrics: null },
        expand: { durationMs: 0, outDir: null, capturedStates: 0, discoveredTriggers: 0, attemptedTriggers: 0, duplicateStates: 0, noopTriggers: 0, failedTriggers: 0, metrics: null },
      });
    }
  }

  const report = buildBenchmarkReport({
    generatedAt: new Date().toISOString(),
    cwd: process.cwd(),
    outputDir: settings.outDir,
    browserPath: settings.browserPath ?? null,
    benchmarks: benchmarkResults,
  });

  const jsonPath = path.join(settings.outDir, 'benchmark-report.json');
  const markdownPath = path.join(settings.outDir, 'benchmark-report.md');
  await writeFile(jsonPath, JSON.stringify(report, null, 2), 'utf8');
  await writeFile(markdownPath, renderBenchmarkMarkdown(report), 'utf8');

  return {
    ...report,
    files: {
      json: jsonPath,
      markdown: markdownPath,
    },
  };
}

async function runCli() {
  initializeCliUtf8();

  try {
    const rawOptions = parseCliArgs(process.argv.slice(2));
    if (rawOptions.help) {
      printHelp();
      process.exitCode = 0;
      return;
    }

    const result = await benchmarkCaptureExpand(rawOptions);
    process.stdout.write(`${JSON.stringify({
      generatedAt: result.generatedAt,
      outputDir: result.outputDir,
      files: result.files,
      benchmarks: result.benchmarks.map((entry) => ({
        id: entry.id,
        label: entry.label,
        url: entry.url,
        budget: entry.budget,
        captureMs: entry.capture.durationMs,
        expandMs: entry.expand.durationMs,
        totalMs: entry.totals.durationMs,
      })),
    }, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

const isCliEntrypoint = (() => {
  const scriptPath = process.argv[1];
  if (!scriptPath) {
    return false;
  }
  return path.resolve(scriptPath) === fileURLToPath(import.meta.url);
})();

if (isCliEntrypoint) {
  await runCli();
}
