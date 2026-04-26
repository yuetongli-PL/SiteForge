// @ts-check

import { spawn } from 'node:child_process';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(MODULE_DIR, '..');
const DEFAULT_RUN_ROOT = path.join(REPO_ROOT, 'runs', 'social-kb-refresh');
const CRAWLER_SCRIPTS_DIR = path.join(REPO_ROOT, 'crawler-scripts');
const SITE_DOCTOR = path.join('src', 'entrypoints', 'sites', 'site-doctor.mjs');
const SURFACE_IDS = Object.freeze([
  'login-wall',
  'challenge',
  'search',
  'author-page',
  'following-modal',
  'empty-dom',
]);
const BLOCKED_REASON_CODES = new Set([
  'not-logged-in',
  'anti-crawl-challenge',
  'anti-crawl-rate-limit',
  'browser-fingerprint-risk',
  'platform-boundary',
]);

const HELP = `Usage:
  node scripts/social-kb-refresh.mjs [--execute] [--fail-fast] [--case <id>] [--site x|instagram|all] [--surface <name>] [options]

Defaults to dry-run plan mode. Dry-run writes a manifest with commands and expected artifacts, but does not touch live sites.

Options:
  --execute                         Run selected site-doctor commands sequentially.
  --fail-fast                       Stop after the first failed, blocked, or timed-out scenario. Default: continue.
  --case <id>                       Run one scenario refresh case. Can be repeated.
  --site <x|instagram|all>          Filter site-specific cases. Default: all.
  --surface <name|all>              Filter by surface. Repeatable. Names: ${SURFACE_IDS.join(', ')}.
  --account <handle>                Account used by both sites when site-specific account is omitted.
  --x-account <handle>              X account sample. Default: opensource.
  --ig-account <handle>             Instagram account sample. Default: instagram.
  --query <text>                    Search sample for search state refresh. Default: open source.
  --max-triggers <n>                Forwarded to site-doctor expansion. Default: 6.
  --max-captured-states <n>         Forwarded to site-doctor expansion. Default: 3.
  --timeout <ms>                    Forwarded to site-doctor. Default: 120000.
  --case-timeout <ms>               Outer timeout per scenario command. Default: 600000.
  --run-root <dir>                  Manifest/output root. Default: runs/social-kb-refresh.
  --schedule-interval-minutes <n>   Record automatic refresh cadence. Default: 0/off.
  --watch                           Schedule mode. Dry-run records the plan; execute loops until stopped.
  --once                            Run or plan one scheduled iteration. Default unless --watch is present.
  --max-watch-iterations <n>        Bound execute --watch for automation/tests. Default: unbounded.
  --browser-path <path>             Forwarded to site-doctor.
  --browser-profile-root <dir>      Forwarded to site-doctor.
  --user-data-dir <dir>             Forwarded to site-doctor.
  --headless|--no-headless          Forwarded to site-doctor. Default: --no-headless.
  -h, --help                        Show this help.

Case ids:
  x-login-wall
  x-challenge
  x-search
  x-author-page
  x-following-modal
  x-empty-dom
  instagram-login-wall
  instagram-challenge
  instagram-search
  instagram-author-page
  instagram-following-modal
  instagram-empty-dom
`;

function timestampForDir(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.(\d{3})Z$/u, '$1Z');
}

function normalizeHandle(value) {
  return String(value ?? '').trim().replace(/^@/u, '').replace(/^\/+|\/+$/gu, '');
}

function encodePathSegment(value) {
  return encodeURIComponent(normalizeHandle(value));
}

function buildSearchUrl(site, query) {
  const params = new URLSearchParams();
  params.set('q', String(query ?? ''));
  if (site === 'x') {
    params.set('src', 'typed_query');
    params.set('f', 'live');
    return `https://x.com/search?${params.toString()}`;
  }
  return `https://www.instagram.com/explore/search/?${params.toString()}`;
}

function readValue(argv, index, flag) {
  if (index + 1 >= argv.length) {
    throw new Error(`Missing value for ${flag}`);
  }
  return { value: argv[index + 1], nextIndex: index + 1 };
}

export function parseArgs(argv) {
  const options = {
    execute: false,
    failFast: false,
    cases: [],
    site: 'all',
    surfaces: [],
    account: null,
    xAccount: 'opensource',
    igAccount: 'instagram',
    query: 'open source',
    maxTriggers: '6',
    maxCapturedStates: '3',
    timeout: '120000',
    caseTimeout: '600000',
    runRoot: DEFAULT_RUN_ROOT,
    scheduleIntervalMinutes: '0',
    watch: false,
    once: false,
    maxWatchIterations: null,
    browserPath: null,
    browserProfileRoot: null,
    userDataDir: null,
    headless: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    switch (token) {
      case '-h':
      case '--help':
        options.help = true;
        break;
      case '--execute':
        options.execute = true;
        break;
      case '--fail-fast':
        options.failFast = true;
        break;
      case '--dry-run':
        options.execute = false;
        break;
      case '--watch':
        options.watch = true;
        options.once = false;
        break;
      case '--once':
        options.once = true;
        options.watch = false;
        break;
      case '--case': {
        const { value, nextIndex } = readValue(argv, index, token);
        options.cases.push(value);
        index = nextIndex;
        break;
      }
      case '--site': {
        const { value, nextIndex } = readValue(argv, index, token);
        options.site = value;
        index = nextIndex;
        break;
      }
      case '--surface': {
        const { value, nextIndex } = readValue(argv, index, token);
        options.surfaces.push(value);
        index = nextIndex;
        break;
      }
      case '--account': {
        const { value, nextIndex } = readValue(argv, index, token);
        options.account = value;
        index = nextIndex;
        break;
      }
      case '--x-account': {
        const { value, nextIndex } = readValue(argv, index, token);
        options.xAccount = value;
        index = nextIndex;
        break;
      }
      case '--ig-account': {
        const { value, nextIndex } = readValue(argv, index, token);
        options.igAccount = value;
        index = nextIndex;
        break;
      }
      case '--query':
      case '--max-triggers':
      case '--max-captured-states':
      case '--timeout':
      case '--case-timeout':
      case '--run-root':
      case '--schedule-interval-minutes':
      case '--max-watch-iterations':
      case '--browser-path':
      case '--browser-profile-root':
      case '--user-data-dir': {
        const { value, nextIndex } = readValue(argv, index, token);
        const key = token.slice(2).replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase());
        options[key] = value;
        index = nextIndex;
        break;
      }
      case '--headless':
        options.headless = true;
        break;
      case '--no-headless':
        options.headless = false;
        break;
      default:
        throw new Error(`Unknown option: ${token}`);
    }
  }

  if (options.account) {
    options.xAccount = options.account;
    options.igAccount = options.account;
  }
  if (!['x', 'instagram', 'all'].includes(String(options.site))) {
    throw new Error(`Invalid --site: ${options.site}`);
  }
  const invalidSurfaces = options.surfaces.filter((surface) => surface !== 'all' && !SURFACE_IDS.includes(surface));
  if (invalidSurfaces.length > 0) {
    throw new Error(`Invalid --surface value(s): ${invalidSurfaces.join(', ')}`);
  }
  for (const [name, value] of [
    ['max-triggers', options.maxTriggers],
    ['max-captured-states', options.maxCapturedStates],
    ['timeout', options.timeout],
    ['case-timeout', options.caseTimeout],
    ['schedule-interval-minutes', options.scheduleIntervalMinutes],
  ]) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw new Error(`Invalid --${name}: ${value}`);
    }
  }
  if (options.maxWatchIterations !== null) {
    const parsed = Number(options.maxWatchIterations);
    if (!Number.isFinite(parsed) || parsed < 1) {
      throw new Error(`Invalid --max-watch-iterations: ${options.maxWatchIterations}`);
    }
  }
  if (!String(options.query ?? '').trim()) {
    throw new Error('Invalid --query: value must not be empty');
  }
  return options;
}

function addOptional(args, flag, value) {
  if (value !== null && value !== undefined && String(value).trim() !== '') {
    args.push(flag, String(value));
  }
}

function siteConfig(site) {
  if (site === 'x') {
    return {
      host: 'x.com',
      profilePath: path.join(REPO_ROOT, 'profiles', 'x.com.json'),
      knowledgeBaseDir: path.join(REPO_ROOT, 'knowledge-base', 'x.com'),
    };
  }
  return {
    host: 'www.instagram.com',
    profilePath: path.join(REPO_ROOT, 'profiles', 'www.instagram.com.json'),
    knowledgeBaseDir: path.join(REPO_ROOT, 'knowledge-base', 'www.instagram.com'),
  };
}

function buildCaseDefinitions(options) {
  const xAccount = encodePathSegment(options.xAccount);
  const igAccount = encodePathSegment(options.igAccount);
  const query = String(options.query);

  return [
    {
      id: 'x-login-wall',
      site: 'x',
      surface: 'login-wall',
      startUrl: 'https://x.com/i/flow/login',
      authRequired: false,
      expectedSemanticPageType: 'auth-page',
      stateSignals: ['auth-page', 'logged-out-indicator', 'not-logged-in'],
      purpose: 'Refresh X login wall state artifacts and detect logged-out auth boundaries.',
    },
    {
      id: 'x-challenge',
      site: 'x',
      surface: 'challenge',
      startUrl: 'https://x.com/home',
      authRequired: true,
      expectedSemanticPageType: 'home or auth-page',
      stateSignals: ['challengeRequired', 'anti-crawl-challenge', 'browser-fingerprint-risk'],
      purpose: 'Refresh X challenge/risk state artifacts from an authenticated home probe.',
    },
    {
      id: 'x-search',
      site: 'x',
      surface: 'search',
      startUrl: buildSearchUrl('x', query),
      query,
      authRequired: true,
      expectedSemanticPageType: 'search-results-page',
      stateSignals: ['search-results-page', 'featuredContentCards', 'empty-shell'],
      purpose: 'Refresh X search result state artifacts for the configured query.',
    },
    {
      id: 'x-author-page',
      site: 'x',
      surface: 'author-page',
      startUrl: `https://x.com/${xAccount}`,
      authRequired: false,
      expectedSemanticPageType: 'author-page',
      stateSignals: ['author-page', 'featuredContentCards', 'featuredAuthorCards'],
      purpose: 'Refresh X public author/profile state artifacts.',
    },
    {
      id: 'x-following-modal',
      site: 'x',
      surface: 'following-modal',
      startUrl: `https://x.com/${xAccount}/following`,
      authRequired: true,
      expectedSemanticPageType: 'author-list-page',
      stateSignals: ['author-list-page', 'following', 'not-logged-in'],
      purpose: 'Refresh X following-list state artifacts for authenticated account relationship surfaces.',
    },
    {
      id: 'x-empty-dom',
      site: 'x',
      surface: 'empty-dom',
      startUrl: 'https://x.com/',
      authRequired: false,
      expectedSemanticPageType: 'home or auth-page',
      stateSignals: ['emptyShell', 'empty-shell', 'client-rendered-shell'],
      purpose: 'Refresh X empty DOM/app-shell detection artifacts from the root surface.',
    },
    {
      id: 'instagram-login-wall',
      site: 'instagram',
      surface: 'login-wall',
      startUrl: 'https://www.instagram.com/accounts/login/',
      authRequired: false,
      expectedSemanticPageType: 'auth-page',
      stateSignals: ['auth-page', 'logged-out-indicator', 'not-logged-in'],
      purpose: 'Refresh Instagram login wall state artifacts and detect logged-out auth boundaries.',
    },
    {
      id: 'instagram-challenge',
      site: 'instagram',
      surface: 'challenge',
      startUrl: 'https://www.instagram.com/challenge/',
      authRequired: true,
      expectedSemanticPageType: 'auth-page',
      stateSignals: ['challengeRequired', 'anti-crawl-challenge', 'browser-fingerprint-risk'],
      purpose: 'Refresh Instagram challenge/risk state artifacts from the challenge surface.',
    },
    {
      id: 'instagram-search',
      site: 'instagram',
      surface: 'search',
      startUrl: buildSearchUrl('instagram', query),
      query,
      authRequired: true,
      expectedSemanticPageType: 'search-results-page',
      stateSignals: ['search-results-page', 'featuredContentCards', 'empty-shell'],
      purpose: 'Refresh Instagram search state artifacts for the configured query.',
    },
    {
      id: 'instagram-author-page',
      site: 'instagram',
      surface: 'author-page',
      startUrl: `https://www.instagram.com/${igAccount}/`,
      authRequired: false,
      expectedSemanticPageType: 'author-page',
      stateSignals: ['author-page', 'featuredContentCards', 'privateAccount', 'unavailableContent'],
      purpose: 'Refresh Instagram public profile state artifacts.',
    },
    {
      id: 'instagram-following-modal',
      site: 'instagram',
      surface: 'following-modal',
      startUrl: `https://www.instagram.com/${igAccount}/following/`,
      authRequired: true,
      expectedSemanticPageType: 'author-list-page',
      stateSignals: ['author-list-page', 'following dialog', 'not-logged-in'],
      purpose: 'Refresh Instagram following dialog/list state artifacts.',
    },
    {
      id: 'instagram-empty-dom',
      site: 'instagram',
      surface: 'empty-dom',
      startUrl: 'https://www.instagram.com/',
      authRequired: false,
      expectedSemanticPageType: 'home or auth-page',
      stateSignals: ['emptyShell', 'empty-shell', 'client-rendered-shell'],
      purpose: 'Refresh Instagram empty DOM/app-shell detection artifacts from the root surface.',
    },
  ];
}

function expectedArtifacts(outDir, host) {
  const doctorRunDir = `<timestamp>_${host}`;
  return {
    artifactRoot: outDir,
    doctorReportJson: path.join(outDir, doctorRunDir, 'doctor-report.json'),
    doctorReportMarkdown: path.join(outDir, doctorRunDir, 'doctor-report.md'),
    captureManifest: path.join(outDir, doctorRunDir, 'capture', '<capture-run>', 'manifest.json'),
    expandManifest: path.join(outDir, doctorRunDir, 'expand', '<expand-run>', 'states-manifest.json'),
    scenarioArtifacts: path.join(outDir, doctorRunDir, 'scenarios', '<scenario-id>'),
  };
}

function siteDoctorArgs(entry, options) {
  const args = [
    entry.startUrl,
    '--profile-path',
    entry.profilePath,
    '--out-dir',
    entry.artifactRoot,
    '--crawler-scripts-dir',
    CRAWLER_SCRIPTS_DIR,
    '--knowledge-base-dir',
    entry.knowledgeBaseDir,
    '--reuse-login-state',
    options.headless ? '--headless' : '--no-headless',
    '--timeout',
    String(options.timeout),
    '--max-triggers',
    String(options.maxTriggers),
    '--max-captured-states',
    String(options.maxCapturedStates),
  ];
  if (entry.query) {
    args.push('--query', String(entry.query));
  }
  addOptional(args, '--browser-path', options.browserPath);
  addOptional(args, '--browser-profile-root', options.browserProfileRoot);
  addOptional(args, '--user-data-dir', options.userDataDir);
  return args;
}

export function buildMatrix(options, runId = timestampForDir()) {
  const runRoot = path.resolve(options.runRoot);
  const commandRoot = path.join(runRoot, runId);
  return buildCaseDefinitions(options).map((definition) => {
    const config = siteConfig(definition.site);
    const artifactRoot = path.join(commandRoot, definition.id);
    const entry = {
      ...definition,
      host: config.host,
      profilePath: config.profilePath,
      knowledgeBaseDir: config.knowledgeBaseDir,
      artifactRoot,
      expectedArtifacts: expectedArtifacts(artifactRoot, config.host),
      command: process.execPath,
      args: [],
    };
    entry.args = [SITE_DOCTOR, ...siteDoctorArgs(entry, options)];
    entry.commandLine = formatCommand(entry);
    return entry;
  });
}

export function filterMatrix(matrix, options) {
  let selected = matrix;
  if (options.site !== 'all') {
    selected = selected.filter((entry) => entry.site === options.site);
  }
  const surfaces = new Set(options.surfaces.filter((surface) => surface !== 'all'));
  if (surfaces.size > 0) {
    selected = selected.filter((entry) => surfaces.has(entry.surface));
  }
  if (options.cases.length > 0) {
    const wanted = new Set(options.cases);
    const known = new Set(matrix.map((entry) => entry.id));
    const unknown = [...wanted].filter((id) => !known.has(id));
    if (unknown.length > 0) {
      throw new Error(`Unknown --case id(s): ${unknown.join(', ')}`);
    }
    selected = selected.filter((entry) => wanted.has(entry.id));
  }
  return selected;
}

function shellQuote(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_./:@=\\-]+$/u.test(text)) {
    return text;
  }
  return `"${text.replace(/"/gu, '\\"')}"`;
}

export function formatCommand(entry) {
  return [entry.command, ...entry.args].map(shellQuote).join(' ');
}

function timeoutPolicyForOptions(options) {
  const forwardedTimeoutMs = Number(options.timeout);
  const caseTimeoutMs = Number(options.caseTimeout);
  return {
    forwardedTimeoutMs,
    caseTimeoutMs,
    outerTimeoutEnabled: Number.isFinite(caseTimeoutMs) && caseTimeoutMs > 0,
  };
}

export function schedulePolicyForOptions(options) {
  const intervalMinutes = Number(options.scheduleIntervalMinutes);
  const enabled = Boolean(options.watch || intervalMinutes > 0);
  return {
    enabled,
    mode: options.watch ? 'watch' : 'once',
    intervalMinutes,
    dryRunOnly: !options.execute,
    maxWatchIterations: options.maxWatchIterations === null ? null : Number(options.maxWatchIterations),
  };
}

function commandManifestEntry(entry, options) {
  return {
    id: entry.id,
    site: entry.site,
    surface: entry.surface,
    purpose: entry.purpose,
    startUrl: entry.startUrl,
    authRequired: entry.authRequired,
    expectedSemanticPageType: entry.expectedSemanticPageType,
    stateSignals: entry.stateSignals,
    profilePath: entry.profilePath,
    knowledgeBaseDir: entry.knowledgeBaseDir,
    artifactRoot: entry.artifactRoot,
    expectedArtifacts: entry.expectedArtifacts,
    timeoutPolicy: timeoutPolicyForOptions(options),
    command: formatCommand(entry),
    commandArray: [entry.command, ...entry.args],
  };
}

export function buildRunManifest(entries, options, runId, manifestPath) {
  const runDir = path.dirname(manifestPath);
  return {
    runId,
    mode: options.execute ? 'execute' : 'dry-run',
    status: options.execute ? 'running' : 'planned',
    startedAt: new Date().toISOString(),
    finishedAt: options.execute ? null : new Date().toISOString(),
    repoRoot: REPO_ROOT,
    runDir,
    manifestPath,
    timeoutPolicy: timeoutPolicyForOptions(options),
    schedulePolicy: schedulePolicyForOptions(options),
    failFast: {
      enabled: Boolean(options.failFast),
      triggered: false,
      stoppedAfter: null,
      skipped: [],
    },
    options: {
      site: options.site,
      surfaces: options.surfaces,
      cases: options.cases,
      xAccount: normalizeHandle(options.xAccount),
      igAccount: normalizeHandle(options.igAccount),
      query: options.query,
      maxTriggers: options.maxTriggers,
      maxCapturedStates: options.maxCapturedStates,
      timeout: options.timeout,
      caseTimeout: options.caseTimeout,
      headless: options.headless,
      failFast: Boolean(options.failFast),
      scheduleIntervalMinutes: options.scheduleIntervalMinutes,
      watch: Boolean(options.watch),
      once: Boolean(options.once || !options.watch),
      maxWatchIterations: options.maxWatchIterations,
    },
    commands: entries.map((entry) => commandManifestEntry(entry, options)),
    results: [],
  };
}

async function writeManifest(manifestPath, manifest) {
  await mkdir(path.dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

function printPlan(entries, options, manifestPath) {
  const mode = options.execute ? 'execute' : 'dry-run';
  process.stdout.write(`social-kb-refresh ${mode} plan (${entries.length} command(s))\n`);
  process.stdout.write(`Manifest: ${manifestPath}\n\n`);
  const schedule = schedulePolicyForOptions(options);
  if (schedule.enabled) {
    process.stdout.write(`Schedule: ${schedule.mode}, interval=${schedule.intervalMinutes} minute(s), maxWatchIterations=${schedule.maxWatchIterations ?? 'unbounded'}\n\n`);
  }
  for (const [index, entry] of entries.entries()) {
    process.stdout.write(`${index + 1}. ${entry.id} [${entry.surface}]\n`);
    process.stdout.write(`   site: ${entry.site}\n`);
    process.stdout.write(`   purpose: ${entry.purpose}\n`);
    process.stdout.write(`   artifacts: ${entry.expectedArtifacts.artifactRoot}\n`);
    process.stdout.write(`   report: ${entry.expectedArtifacts.doctorReportJson}\n`);
    process.stdout.write(`   command: ${formatCommand(entry)}\n\n`);
  }
}

async function pathExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonFile(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function locateDoctorArtifacts(artifactRoot) {
  const artifacts = {
    artifactRoot,
    reportDir: null,
    doctorReportJson: null,
    doctorReportMarkdown: null,
    captureManifest: null,
    expandManifest: null,
    scenarioRoot: null,
    scenarioCount: null,
    scenarioStatuses: [],
  };
  if (!await pathExists(artifactRoot)) {
    return artifacts;
  }

  const entries = await readdir(artifactRoot, { withFileTypes: true });
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const reportDir = path.join(artifactRoot, entry.name);
    const doctorReportJson = path.join(reportDir, 'doctor-report.json');
    if (await pathExists(doctorReportJson)) {
      const info = await stat(doctorReportJson);
      candidates.push({ reportDir, doctorReportJson, mtimeMs: info.mtimeMs });
    }
  }
  candidates.sort((left, right) => right.mtimeMs - left.mtimeMs);
  const latest = candidates[0];
  if (!latest) {
    return artifacts;
  }

  artifacts.reportDir = latest.reportDir;
  artifacts.doctorReportJson = latest.doctorReportJson;
  const doctorReportMarkdown = path.join(latest.reportDir, 'doctor-report.md');
  artifacts.doctorReportMarkdown = await pathExists(doctorReportMarkdown) ? doctorReportMarkdown : null;
  artifacts.scenarioRoot = path.join(latest.reportDir, 'scenarios');

  try {
    const report = await readJsonFile(latest.doctorReportJson);
    artifacts.captureManifest = report?.capture?.manifestPath ?? null;
    artifacts.expandManifest = report?.expand?.manifestPath ?? null;
    artifacts.scenarioCount = Array.isArray(report?.scenarios) ? report.scenarios.length : null;
    artifacts.scenarioStatuses = Array.isArray(report?.scenarios)
      ? report.scenarios.map((scenario) => ({
        id: scenario.id ?? null,
        status: scenario.status ?? null,
        reasonCode: scenario.reasonCode ?? null,
        finalUrl: scenario.finalUrl ?? null,
      }))
      : [];
  } catch (error) {
    artifacts.scenarioStatuses = [{
      id: 'doctor-report',
      status: 'parse-failed',
      reasonCode: error?.message ?? String(error),
      finalUrl: null,
    }];
  }

  return artifacts;
}

function runCommand(entry, options) {
  return new Promise((resolve) => {
    const startedAt = new Date().toISOString();
    let settled = false;
    let timedOut = false;
    const child = spawn(entry.command, entry.args, {
      cwd: REPO_ROOT,
      env: process.env,
      stdio: 'inherit',
      shell: false,
    });
    const timeoutMs = Number(options.caseTimeout);
    const timer = Number.isFinite(timeoutMs) && timeoutMs > 0
      ? setTimeout(() => {
        if (settled) {
          return;
        }
        timedOut = true;
        child.kill('SIGTERM');
        setTimeout(() => {
          if (!settled) {
            child.kill('SIGKILL');
          }
        }, 5_000).unref?.();
      }, timeoutMs)
      : null;
    timer?.unref?.();
    child.on('close', (exitCode, signal) => {
      settled = true;
      if (timer) {
        clearTimeout(timer);
      }
      const commandStatus = exitCode === 0 ? 'passed' : 'failed';
      resolve({
        id: entry.id,
        site: entry.site,
        surface: entry.surface,
        command: formatCommand(entry),
        startedAt,
        finishedAt: new Date().toISOString(),
        exitCode,
        signal: timedOut ? 'timeout' : signal,
        commandStatus,
        status: timedOut ? 'blocked' : commandStatus,
        timeout: {
          outerTimeoutMs: timeoutMs,
          timedOut,
        },
        blocked: {
          status: timedOut,
          reason: timedOut ? 'timeout' : null,
        },
      });
    });
  });
}

function blockedReasonFromArtifacts(artifacts) {
  const statuses = Array.isArray(artifacts?.scenarioStatuses) ? artifacts.scenarioStatuses : [];
  const blocked = statuses.find((scenario) => {
    const status = String(scenario?.status ?? '').toLowerCase();
    const reasonCode = String(scenario?.reasonCode ?? '').toLowerCase();
    return status === 'blocked'
      || BLOCKED_REASON_CODES.has(reasonCode)
      || reasonCode.startsWith('anti-crawl-')
      || reasonCode.includes('challenge')
      || reasonCode.includes('rate-limit')
      || reasonCode.includes('fingerprint');
  });
  if (!blocked) {
    return null;
  }
  return blocked.reasonCode ?? blocked.status ?? blocked.id ?? 'blocked';
}

function markBlockedResult(result, artifacts) {
  const blockedReason = result.timeout?.timedOut ? 'timeout' : blockedReasonFromArtifacts(artifacts);
  result.blocked = {
    status: Boolean(blockedReason),
    reason: blockedReason,
  };
  if (blockedReason) {
    result.status = 'blocked';
  }
  return result;
}

export function aggregateRefreshStatus(results) {
  if (results.some((result) => result.status === 'failed')) {
    return 'failed';
  }
  if (results.some((result) => result.status === 'blocked' || result.blocked?.status)) {
    return 'blocked';
  }
  if (results.some((result) => result.status !== 'passed')) {
    return 'unknown';
  }
  return 'passed';
}

function printSummary(results) {
  process.stdout.write('\nKB refresh summary\n');
  for (const result of results) {
    const reason = result.blocked?.reason ? ` (${result.blocked.reason})` : '';
    process.stdout.write(`- ${result.id}: ${result.status}${reason}\n`);
  }
}

export async function executePlan(entries, manifest, manifestPath) {
  await writeManifest(manifestPath, manifest);
  for (const [index, entry] of entries.entries()) {
    process.stdout.write(`\n[${entry.id}] ${formatCommand(entry)}\n`);
    const result = await runCommand(entry, manifest.options);
    result.artifacts = await locateDoctorArtifacts(entry.artifactRoot);
    markBlockedResult(result, result.artifacts);
    manifest.results.push(result);
    await writeManifest(manifestPath, manifest);
    if (result.status !== 'passed' && manifest.failFast.enabled) {
      manifest.status = aggregateRefreshStatus(manifest.results);
      manifest.finishedAt = new Date().toISOString();
      manifest.failFast.triggered = true;
      manifest.failFast.stoppedAfter = entry.id;
      manifest.failFast.skipped = entries.slice(index + 1).map((remaining) => remaining.id);
      await writeManifest(manifestPath, manifest);
      process.exitCode = result.exitCode ?? 1;
      printSummary(manifest.results);
      return manifestPath;
    }
  }

  manifest.status = aggregateRefreshStatus(manifest.results);
  manifest.finishedAt = new Date().toISOString();
  await writeManifest(manifestPath, manifest);
  printSummary(manifest.results);
  if (manifest.status !== 'passed') {
    process.exitCode = 1;
  }
  return manifestPath;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function executeScheduledPlan(options) {
  const maxIterations = options.maxWatchIterations === null ? Infinity : Number(options.maxWatchIterations);
  const intervalMs = Number(options.scheduleIntervalMinutes) * 60_000;
  let iteration = 0;
  let lastManifestPath = null;
  do {
    const runId = timestampForDir();
    const matrix = buildMatrix(options, runId);
    const selected = filterMatrix(matrix, options);
    const runDir = path.join(path.resolve(options.runRoot), runId);
    const manifestPath = path.join(runDir, 'manifest.json');
    const manifest = buildRunManifest(selected, options, runId, manifestPath);
    manifest.schedulePolicy.iteration = iteration + 1;
    manifest.schedulePolicy.nextRunAt = options.watch && intervalMs > 0
      ? new Date(Date.now() + intervalMs).toISOString()
      : null;
    printPlan(selected, options, manifestPath);
    await executePlan(selected, manifest, manifestPath);
    lastManifestPath = manifestPath;
    iteration += 1;
    if (!options.watch || iteration >= maxIterations) {
      break;
    }
    if (intervalMs <= 0) {
      throw new Error('--watch requires --schedule-interval-minutes > 0 unless --max-watch-iterations is 1');
    }
    await sleep(intervalMs);
  } while (true);
  return lastManifestPath;
}

export async function main(argv) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(`${HELP}\n`);
    return;
  }
  const runId = timestampForDir();
  const matrix = buildMatrix(options, runId);
  const selected = filterMatrix(matrix, options);
  if (selected.length === 0) {
    throw new Error('No commands selected.');
  }

  const runDir = path.join(path.resolve(options.runRoot), runId);
  const manifestPath = path.join(runDir, 'manifest.json');
  const manifest = buildRunManifest(selected, options, runId, manifestPath);
  await writeManifest(manifestPath, manifest);
  printPlan(selected, options, manifestPath);
  if (!options.execute) {
    process.stdout.write('Dry-run only. Re-run with --execute to run live commands; the manifest above is the planned artifact contract.\n');
    return;
  }
  if (options.watch) {
    const scheduledManifestPath = await executeScheduledPlan(options);
    process.stdout.write(`\nLast manifest: ${scheduledManifestPath}\n`);
    return;
  }
  await executePlan(selected, manifest, manifestPath);
  process.stdout.write(`\nManifest: ${manifestPath}\n`);
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (entryPath && entryPath === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error?.message ?? String(error));
    process.exitCode = 1;
  });
}
