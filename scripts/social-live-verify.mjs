// @ts-check

import { spawn } from 'node:child_process';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(MODULE_DIR, '..');
const DEFAULT_RUN_ROOT = path.join(REPO_ROOT, 'runs', 'social-live-verify');

const HELP = `Usage:
  node scripts/social-live-verify.mjs --live --site x|instagram|all --run-root <dir> [--case <id>] [options]

Defaults to not-run mode. No live plan is emitted unless --live and every live boundary is explicit.
No live commands are executed unless both --live and --execute are present.

Options:
  --live                            Acknowledge live smoke planning. Required before dry-run or execute plans.
  --dry-run                         Emit the bounded command plan without running it. Default after --live.
  --execute                         Run commands sequentially and write a run manifest.
  --fail-fast                       Stop after the first non-zero command. Default: continue and summarize all cases.
  --case <id>                       Run one matrix case. Can be repeated.
  --site <x|instagram|all>          Filter site-specific cases. Required.
  --account <handle>                Account used by both sites when site-specific account is omitted.
  --x-account <handle>              X archive/media account. Required for selected X cases unless --account is set.
  --ig-account <handle>             Instagram archive/media account. Required for selected Instagram cases unless --account is set.
  --date <YYYY-MM-DD>               Date for followed-date verification. Required when that case is selected.
  --max-items <n>                   Per-command item limit. Required.
  --max-users <n>                   Followed-date user scan limit. Required when that case is selected.
  --max-media-downloads <n>         Media download cap for download cases. Required when media cases are selected.
  --media-download-concurrency <n>  Forwarded media download concurrency. Default: action default.
  --media-download-retries <n>      Forwarded media download retry count. Default: action default.
  --media-download-backoff-ms <ms>  Forwarded media download retry backoff. Default: action default.
  --risk-backoff-ms <ms>            Forwarded social runtime risk backoff. Default: action default.
  --risk-retries <n>                Forwarded social runtime risk retry count. Default: action default.
  --api-retries <n>                 Forwarded API cursor retry count. Default: action default.
  --timeout <ms>                    Action timeout flag forwarded to social commands. Required.
  --case-timeout <ms>               Outer timeout per matrix command. Required.
  --run-root <dir>                  Execute manifest/output root. Required.
  --browser-path <path>             Forwarded to site-doctor.
  --browser-profile-root <dir>      Forwarded to action and site-doctor commands.
  --user-data-dir <dir>             Forwarded to site-doctor.
  --headless|--no-headless          Forwarded to site-doctor. Default for matrix: --no-headless.
  -h, --help                        Show this help.

Matrix ids:
  x-full-archive
  instagram-full-archive
  instagram-followed-date
  x-media-download
  instagram-media-download
  x-auth-doctor
  instagram-auth-doctor
  x-kb-refresh
  instagram-kb-refresh
`;

function todayUtcDate() {
  return new Date().toISOString().slice(0, 10);
}

function timestampForDir(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.(\d{3})Z$/u, '$1Z');
}

function normalizeHandle(value) {
  return String(value ?? '').trim().replace(/^@/u, '');
}

function readValue(argv, index, flag) {
  if (index + 1 >= argv.length) {
    throw new Error(`Missing value for ${flag}`);
  }
  return { value: argv[index + 1], nextIndex: index + 1 };
}

export function parseArgs(argv) {
  const options = {
    live: false,
    execute: false,
    failFast: false,
    cases: [],
    site: null,
    account: null,
    xAccount: null,
    igAccount: null,
    date: null,
    maxItems: null,
    maxUsers: null,
    maxMediaDownloads: null,
    mediaDownloadConcurrency: null,
    mediaDownloadRetries: null,
    mediaDownloadBackoffMs: null,
    riskBackoffMs: null,
    riskRetries: null,
    apiRetries: null,
    timeout: null,
    caseTimeout: null,
    runRoot: null,
    browserPath: null,
    browserProfileRoot: null,
    userDataDir: null,
    headless: false,
    help: false,
    explicitOptions: [],
  };
  const explicit = new Set();
  const markExplicit = (name) => {
    explicit.add(name);
    options.explicitOptions = [...explicit].sort();
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    switch (token) {
      case '-h':
      case '--help':
        options.help = true;
        break;
      case '--live':
        options.live = true;
        markExplicit('live');
        break;
      case '--dry-run':
        options.execute = false;
        markExplicit('dryRun');
        break;
      case '--execute':
        options.execute = true;
        markExplicit('execute');
        break;
      case '--fail-fast':
        options.failFast = true;
        break;
      case '--case': {
        const { value, nextIndex } = readValue(argv, index, token);
        options.cases.push(value);
        markExplicit('case');
        index = nextIndex;
        break;
      }
      case '--site': {
        const { value, nextIndex } = readValue(argv, index, token);
        options.site = value;
        markExplicit('site');
        index = nextIndex;
        break;
      }
      case '--account': {
        const { value, nextIndex } = readValue(argv, index, token);
        options.account = value;
        markExplicit('account');
        index = nextIndex;
        break;
      }
      case '--x-account': {
        const { value, nextIndex } = readValue(argv, index, token);
        options.xAccount = value;
        markExplicit('xAccount');
        index = nextIndex;
        break;
      }
      case '--ig-account': {
        const { value, nextIndex } = readValue(argv, index, token);
        options.igAccount = value;
        markExplicit('igAccount');
        index = nextIndex;
        break;
      }
      case '--date':
      case '--max-items':
      case '--max-users':
      case '--max-media-downloads':
      case '--media-download-concurrency':
      case '--media-download-retries':
      case '--media-download-backoff-ms':
      case '--risk-backoff-ms':
      case '--risk-retries':
      case '--api-retries':
      case '--timeout':
      case '--case-timeout':
      case '--run-root':
      case '--browser-path':
      case '--browser-profile-root':
      case '--user-data-dir': {
        const { value, nextIndex } = readValue(argv, index, token);
        const key = token.slice(2).replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase());
        options[key] = value;
        markExplicit(key);
        index = nextIndex;
        break;
      }
      case '--headless':
        options.headless = true;
        markExplicit('headless');
        break;
      case '--no-headless':
        options.headless = false;
        markExplicit('headless');
        break;
      default:
        throw new Error(`Unknown option: ${token}`);
    }
  }

  if (options.account) {
    options.xAccount = options.account;
    options.igAccount = options.account;
  }
  if (options.site !== null && !['x', 'instagram', 'all'].includes(String(options.site))) {
    throw new Error(`Invalid --site: ${options.site}`);
  }
  if (options.date !== null && !/^\d{4}-\d{2}-\d{2}$/u.test(String(options.date))) {
    throw new Error(`Invalid --date: ${options.date}`);
  }
  for (const [name, value] of [
    ['max-items', options.maxItems],
    ['max-users', options.maxUsers],
    ['max-media-downloads', options.maxMediaDownloads],
    ['timeout', options.timeout],
    ['case-timeout', options.caseTimeout],
  ]) {
    if (value === null) {
      continue;
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 1) {
      throw new Error(`Invalid --${name}: ${value}`);
    }
  }
  if (options.execute && !options.live) {
    throw new Error('--execute requires --live');
  }
  return options;
}

function selectedSitesFromOptions(options) {
  if (options.site === 'x') return ['x'];
  if (options.site === 'instagram') return ['instagram'];
  if (options.site === 'all') return ['x', 'instagram'];
  return [];
}

function knownCaseIds() {
  return [
    'x-full-archive',
    'instagram-full-archive',
    'instagram-followed-date',
    'x-media-download',
    'instagram-media-download',
    'x-auth-doctor',
    'instagram-auth-doctor',
    'x-kb-refresh',
    'instagram-kb-refresh',
  ];
}

function selectedCaseIdsFromOptions(options) {
  if (options.cases.length > 0) return [...options.cases];
  return knownCaseIds().filter((id) => {
    const sites = selectedSitesFromOptions(options);
    return sites.some((site) => id === `${site}-kb-refresh` || id.startsWith(`${site}-`));
  });
}

export function evaluateLiveSmokeBoundary(options) {
  const explicit = new Set(options.explicitOptions ?? []);
  const missing = [];
  const selectedSites = selectedSitesFromOptions(options);
  const selectedCases = selectedCaseIdsFromOptions(options);
  const caseScoped = options.cases.length > 0;
  const needsX = caseScoped ? selectedCases.some((id) => id.startsWith('x-')) : selectedSites.includes('x');
  const needsInstagram = caseScoped ? selectedCases.some((id) => id.startsWith('instagram-')) : selectedSites.includes('instagram');
  const needsFollowedDate = selectedCases.includes('instagram-followed-date');
  const needsMedia = selectedCases.includes('x-media-download') || selectedCases.includes('instagram-media-download');

  if (!explicit.has('live') || options.live !== true) missing.push('live');
  if (!explicit.has('site') || !options.site) missing.push('site');
  if (needsX && !explicit.has('account') && !explicit.has('xAccount')) missing.push('x-account');
  if (needsInstagram && !explicit.has('account') && !explicit.has('igAccount')) missing.push('ig-account');
  if (!explicit.has('maxItems') || options.maxItems === null) missing.push('max-items');
  if (needsFollowedDate && (!explicit.has('date') || options.date === null)) missing.push('date');
  if (needsFollowedDate && (!explicit.has('maxUsers') || options.maxUsers === null)) missing.push('max-users');
  if (needsMedia && (!explicit.has('maxMediaDownloads') || options.maxMediaDownloads === null)) missing.push('max-media-downloads');
  if (!explicit.has('timeout') || options.timeout === null) missing.push('timeout');
  if (!explicit.has('caseTimeout') || options.caseTimeout === null) missing.push('case-timeout');
  if (!explicit.has('runRoot') || options.runRoot === null) missing.push('run-root');

  return {
    mode: options.live ? (options.execute ? 'execute' : 'dry-run') : 'not-run',
    ok: missing.length === 0,
    missing,
    selectedSites,
    selectedCases,
  };
}

export function assertLiveSmokeBoundary(options) {
  const boundary = evaluateLiveSmokeBoundary(options);
  if (!boundary.ok) {
    throw new Error(`Live smoke boundary not explicit: missing --${boundary.missing.join(', --')}`);
  }
  return boundary;
}

function nodeCommand(scriptRelativePath, args) {
  return {
    command: process.execPath,
    args: [scriptRelativePath, ...args],
  };
}

function addOptional(args, flag, value) {
  if (value !== null && value !== undefined && String(value).trim() !== '') {
    args.push(flag, String(value));
  }
}

function socialCommonArgs(options, runDir) {
  const args = [
    '--max-items',
    String(options.maxItems),
    '--timeout',
    String(options.timeout),
    '--run-dir',
    runDir,
    '--reuse-login-state',
    options.headless ? '--headless' : '--no-headless',
  ];
  addOptional(args, '--browser-path', options.browserPath);
  addOptional(args, '--browser-profile-root', options.browserProfileRoot);
  addOptional(args, '--user-data-dir', options.userDataDir);
  addOptional(args, '--risk-backoff-ms', options.riskBackoffMs);
  addOptional(args, '--risk-retries', options.riskRetries);
  addOptional(args, '--api-retries', options.apiRetries);
  return args;
}

function mediaDownloadArgs(options) {
  const args = [
    '--max-media-downloads',
    String(options.maxMediaDownloads),
  ];
  addOptional(args, '--media-download-concurrency', options.mediaDownloadConcurrency);
  addOptional(args, '--media-download-retries', options.mediaDownloadRetries);
  addOptional(args, '--media-download-backoff-ms', options.mediaDownloadBackoffMs);
  return args;
}

function siteDoctorArgs(url, profilePath, options, outDir, knowledgeBaseDir) {
  const args = [
    url,
    '--profile-path',
    profilePath,
    '--out-dir',
    outDir,
    '--crawler-scripts-dir',
    path.join(REPO_ROOT, 'crawler-scripts'),
    '--knowledge-base-dir',
    knowledgeBaseDir,
    '--reuse-login-state',
    options.headless ? '--headless' : '--no-headless',
    '--timeout',
    String(options.timeout),
  ];
  addOptional(args, '--browser-path', options.browserPath);
  addOptional(args, '--browser-profile-root', options.browserProfileRoot);
  addOptional(args, '--user-data-dir', options.userDataDir);
  return args;
}

function kbRefreshArgs(site, options, runRoot) {
  const args = [
    '--site',
    site,
    '--run-root',
    runRoot,
    '--x-account',
    normalizeHandle(options.xAccount),
    '--ig-account',
    normalizeHandle(options.igAccount),
    '--timeout',
    String(options.timeout),
    '--case-timeout',
    String(options.caseTimeout),
    '--max-triggers',
    '6',
    '--max-captured-states',
    '3',
    options.headless ? '--headless' : '--no-headless',
  ];
  if (options.execute) {
    args.unshift('--execute');
  }
  addOptional(args, '--browser-path', options.browserPath);
  addOptional(args, '--browser-profile-root', options.browserProfileRoot);
  addOptional(args, '--user-data-dir', options.userDataDir);
  return args;
}

export function buildMatrix(options, runId) {
  assertLiveSmokeBoundary(options);
  const xAccount = normalizeHandle(options.xAccount);
  const igAccount = normalizeHandle(options.igAccount);
  const runRoot = path.resolve(options.runRoot);
  const commandRoot = path.join(runRoot, runId);
  const xAction = path.join('src', 'entrypoints', 'sites', 'x-action.mjs');
  const igAction = path.join('src', 'entrypoints', 'sites', 'instagram-action.mjs');
  const siteDoctor = path.join('src', 'entrypoints', 'sites', 'site-doctor.mjs');
  const kbRefresh = path.join('scripts', 'social-kb-refresh.mjs');
  const xProfile = path.join(REPO_ROOT, 'profiles', 'x.com.json');
  const igProfile = path.join(REPO_ROOT, 'profiles', 'www.instagram.com.json');
  const caseRoot = (id) => path.join(commandRoot, id);

  return [
    {
      id: 'x-full-archive',
      site: 'x',
      category: 'full archive',
      purpose: 'Verify X full account archive via API cursor mode with DOM fallback bounded by limits.',
      artifactType: 'social-action',
      artifactRoot: caseRoot('x-full-archive'),
      ...nodeCommand(xAction, [
        'full-archive',
        xAccount,
        ...socialCommonArgs(options, caseRoot('x-full-archive')),
      ]),
    },
    {
      id: 'instagram-full-archive',
      site: 'instagram',
      category: 'full archive',
      purpose: 'Verify Instagram full account archive via API cursor mode with DOM fallback bounded by limits.',
      artifactType: 'social-action',
      artifactRoot: caseRoot('instagram-full-archive'),
      ...nodeCommand(igAction, [
        'full-archive',
        igAccount,
        ...socialCommonArgs(options, caseRoot('instagram-full-archive')),
      ]),
    },
    {
      id: 'instagram-followed-date',
      site: 'instagram',
      category: 'followed date',
      purpose: 'Verify followed-profile date scan for posts published on the requested date.',
      artifactType: 'social-action',
      artifactRoot: caseRoot('instagram-followed-date'),
      ...nodeCommand(igAction, [
        'followed-posts-by-date',
        '--date',
        String(options.date),
        '--max-users',
        String(options.maxUsers),
        ...socialCommonArgs(options, caseRoot('instagram-followed-date')),
      ]),
    },
    {
      id: 'x-media-download',
      site: 'x',
      category: 'media download',
      purpose: 'Verify X media enumeration and binary download path from profile media content.',
      artifactType: 'social-action',
      artifactRoot: caseRoot('x-media-download'),
      ...nodeCommand(xAction, [
        'profile-content',
        xAccount,
        '--content-type',
        'media',
        '--download-media',
        ...mediaDownloadArgs(options),
        ...socialCommonArgs(options, caseRoot('x-media-download')),
      ]),
    },
    {
      id: 'instagram-media-download',
      site: 'instagram',
      category: 'media download',
      purpose: 'Verify Instagram media enumeration and binary download path from profile media content.',
      artifactType: 'social-action',
      artifactRoot: caseRoot('instagram-media-download'),
      ...nodeCommand(igAction, [
        'profile-content',
        igAccount,
        '--content-type',
        'media',
        '--download-media',
        ...mediaDownloadArgs(options),
        ...socialCommonArgs(options, caseRoot('instagram-media-download')),
      ]),
    },
    {
      id: 'x-auth-doctor',
      site: 'x',
      category: 'auth recovery/site-doctor',
      purpose: 'Verify authenticated X session reuse/recovery surfaces through site-doctor.',
      artifactType: 'site-doctor',
      artifactRoot: caseRoot('x-auth-doctor'),
      ...nodeCommand(siteDoctor, siteDoctorArgs(
        'https://x.com/home',
        xProfile,
        options,
        caseRoot('x-auth-doctor'),
        path.join(REPO_ROOT, 'knowledge-base', 'x.com'),
      )),
    },
    {
      id: 'instagram-auth-doctor',
      site: 'instagram',
      category: 'auth recovery/site-doctor',
      purpose: 'Verify authenticated Instagram session reuse/recovery surfaces through site-doctor.',
      artifactType: 'site-doctor',
      artifactRoot: caseRoot('instagram-auth-doctor'),
      ...nodeCommand(siteDoctor, siteDoctorArgs(
        'https://www.instagram.com/',
        igProfile,
        options,
        caseRoot('instagram-auth-doctor'),
        path.join(REPO_ROOT, 'knowledge-base', 'www.instagram.com'),
      )),
    },
    {
      id: 'x-kb-refresh',
      site: 'x',
      category: 'scenario KB state refresh',
      purpose: 'Refresh X login-wall, challenge, search, author, following, and empty-DOM state artifacts.',
      artifactType: 'kb-refresh',
      artifactRoot: caseRoot('x-kb-refresh'),
      ...nodeCommand(kbRefresh, kbRefreshArgs(
        'x',
        options,
        caseRoot('x-kb-refresh'),
      )),
    },
    {
      id: 'instagram-kb-refresh',
      site: 'instagram',
      category: 'scenario KB state refresh',
      purpose: 'Refresh Instagram login-wall, challenge, search, profile, following dialog, and empty-DOM state artifacts.',
      artifactType: 'kb-refresh',
      artifactRoot: caseRoot('instagram-kb-refresh'),
      ...nodeCommand(kbRefresh, kbRefreshArgs(
        'instagram',
        options,
        caseRoot('instagram-kb-refresh'),
      )),
    },
  ];
}

function filterMatrix(matrix, options) {
  let selected = matrix;
  if (options.site !== 'all') {
    selected = selected.filter((entry) => entry.site === options.site);
  }
  if (options.cases.length > 0) {
    const wanted = new Set(options.cases);
    selected = selected.filter((entry) => wanted.has(entry.id));
    const known = new Set(matrix.map((entry) => entry.id));
    const unknown = [...wanted].filter((id) => !known.has(id));
    if (unknown.length > 0) {
      throw new Error(`Unknown --case id(s): ${unknown.join(', ')}`);
    }
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

function formatCommand(entry) {
  return [entry.command, ...entry.args].map(shellQuote).join(' ');
}

function printPlan(entries, options) {
  const mode = options.execute ? 'execute' : 'dry-run';
  process.stdout.write(`social-live-verify ${mode} plan (${entries.length} command(s))\n\n`);
  for (const [index, entry] of entries.entries()) {
    process.stdout.write(`${index + 1}. ${entry.id} [${entry.category}]\n`);
    process.stdout.write(`   site: ${entry.site}\n`);
    process.stdout.write(`   purpose: ${entry.purpose}\n`);
    process.stdout.write(`   artifacts: ${entry.artifactRoot}\n`);
    process.stdout.write(`   command: ${formatCommand(entry)}\n\n`);
  }
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
      resolve({
        id: entry.id,
        site: entry.site,
        category: entry.category,
        command: formatCommand(entry),
        startedAt,
        finishedAt: new Date().toISOString(),
        exitCode,
        signal: timedOut ? 'timeout' : signal,
        status: exitCode === 0 ? 'passed' : 'failed',
      });
    });
  });
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
  return JSON.parse((await readFile(filePath, 'utf8')).replace(/^\uFEFF/u, ''));
}

async function locateLatestDoctorReport(artifactRoot) {
  if (!await pathExists(artifactRoot)) {
    return null;
  }
  const entries = await readdir(artifactRoot, { withFileTypes: true });
  const reports = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const reportPath = path.join(artifactRoot, entry.name, 'doctor-report.json');
    if (await pathExists(reportPath)) {
      const info = await stat(reportPath);
      reports.push({ reportPath, reportDir: path.dirname(reportPath), mtimeMs: info.mtimeMs });
    }
  }
  reports.sort((left, right) => right.mtimeMs - left.mtimeMs);
  return reports[0] ?? null;
}

async function locateLatestManifest(artifactRoot) {
  const direct = path.join(artifactRoot, 'manifest.json');
  if (await pathExists(direct)) {
    return direct;
  }
  if (!await pathExists(artifactRoot)) {
    return null;
  }
  const entries = await readdir(artifactRoot, { withFileTypes: true });
  const manifests = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const candidate = path.join(artifactRoot, entry.name, 'manifest.json');
    if (await pathExists(candidate)) {
      const info = await stat(candidate);
      manifests.push({ path: candidate, mtimeMs: info.mtimeMs });
    }
  }
  manifests.sort((left, right) => right.mtimeMs - left.mtimeMs);
  return manifests[0]?.path ?? null;
}

function isSkippedReasonCode(value) {
  const reason = String(value ?? '').trim().toLowerCase();
  return [
    'credentials-unavailable',
    'login-required',
    'not-authenticated',
    'not-logged-in',
    'no-reusable-session',
    'manual-login-required',
    'needs-manual-login',
    'unauthenticated',
  ].includes(reason)
    || reason.includes('login-required')
    || reason.includes('not-logged-in')
    || reason.includes('credentials-unavailable')
    || reason.includes('no reusable logged-in')
    || reason.includes('manual login');
}

function isBlockedActionReasonCode(value) {
  const reason = String(value ?? '').trim().toLowerCase();
  return [
    'auth-recovery-needed',
    'browser-fingerprint-risk',
    'challenge',
    'login-wall',
    'rate-limited',
    'session-invalid',
    'timeout',
  ].includes(reason)
    || reason.startsWith('anti-crawl-')
    || reason.includes('challenge')
    || reason.includes('fingerprint')
    || reason.includes('login-wall')
    || reason.includes('rate-limit')
    || reason.includes('rate limited')
    || reason.includes('session-invalid')
    || reason.includes('timeout');
}

function classifyOutcomeStatus(outcome) {
  const status = normalizedStatus(outcome?.status);
  const reason = outcome?.reason ?? outcome?.status ?? null;
  if (status === 'skipped' || isSkippedReasonCode(reason) || isSkippedReasonCode(status)) {
    return { verdict: 'skipped', reason };
  }
  if (status === 'blocked' || /blocked/iu.test(status) || isBlockedActionReasonCode(reason) || isBlockedActionReasonCode(status)) {
    return { verdict: 'blocked', reason };
  }
  if (outcome?.ok === false || status === 'failed' || status === 'error') {
    return { verdict: 'failed', reason };
  }
  if (status === 'bounded' || status === 'completed' || status === 'passed') {
    return { verdict: 'passed', reason: status === 'bounded' ? reason : null };
  }
  if (status === 'degraded') {
    return { verdict: 'unknown', reason };
  }
  return null;
}

export function classifySocialActionManifest(manifest) {
  if (manifest?.outcome?.status) {
    const outcome = classifyOutcomeStatus(manifest.outcome);
    if (outcome) {
      return outcome;
    }
    return { verdict: 'passed', reason: null };
  }
  if (normalizedStatus(manifest?.status) === 'skipped' || isSkippedReasonCode(manifest?.status)) {
    return { verdict: 'skipped', reason: manifest?.reason ?? manifest?.status ?? 'skipped' };
  }
  if (normalizedStatus(manifest?.status) === 'blocked' || isBlockedActionReasonCode(manifest?.status)) {
    return { verdict: 'blocked', reason: manifest?.reason ?? manifest?.status ?? 'blocked' };
  }
  const completeness = manifest?.completeness ?? null;
  const archive = manifest?.archive ?? null;
  const authHealth = manifest?.authHealth ?? null;
  const runtimeRisk = manifest?.runtimeRisk ?? null;
  const authReason = authHealth?.recoveryReason ?? runtimeRisk?.stopReason ?? manifest?.reason ?? null;
  if (isSkippedReasonCode(authHealth?.status) || isSkippedReasonCode(authReason)) {
    return {
      verdict: 'skipped',
      reason: authReason ?? authHealth?.status ?? 'auth-unavailable',
    };
  }
  if (authHealth?.needsRecovery || runtimeRisk?.authExpired) {
    return {
      verdict: 'blocked',
      reason: authReason ?? 'auth-recovery-needed',
    };
  }
  if (runtimeRisk?.rateLimited) {
    return {
      verdict: 'blocked',
      reason: 'rate-limited',
    };
  }
  if (archive && archive.complete === true) {
    return { verdict: 'passed', reason: null };
  }
  if (archive && archive.complete === false) {
    if (isSkippedReasonCode(archive.reason)) {
      return { verdict: 'skipped', reason: archive.reason };
    }
    if (isBlockedActionReasonCode(archive.reason)) {
      return { verdict: 'blocked', reason: archive.reason };
    }
    return { verdict: 'failed', reason: archive.reason ?? 'archive-incomplete' };
  }
  if (manifest?.downloads) {
    if (normalizedStatus(manifest.downloads.status) === 'skipped' || isSkippedReasonCode(manifest.downloads.reason)) {
      return { verdict: 'skipped', reason: manifest.downloads.reason ?? manifest.downloads.status ?? 'media-download-skipped' };
    }
    if (isBlockedActionReasonCode(manifest.downloads.reason)) {
      return { verdict: 'blocked', reason: manifest.downloads.reason };
    }
  }
  if (manifest?.downloads && manifest.downloads.expectedMedia > 0) {
    return manifest.downloads.ok >= manifest.downloads.expectedMedia
      ? { verdict: 'passed', reason: null }
      : { verdict: 'failed', reason: 'media-download-incomplete' };
  }
  if (completeness?.archiveStatus === 'unknown') {
    return { verdict: 'unknown', reason: completeness.archiveReason ?? 'archive-unknown' };
  }
  return { verdict: manifest?.status === 'completed' ? 'passed' : 'unknown', reason: null };
}

async function summarizeSocialActionArtifacts(entry) {
  const manifestPath = path.join(entry.artifactRoot, 'manifest.json');
  if (!await pathExists(manifestPath)) {
    return {
      type: entry.artifactType,
      manifestPath,
      found: false,
      verdict: 'unknown',
      reason: 'manifest-missing',
    };
  }
  const manifest = await readJsonFile(manifestPath);
  const classification = classifySocialActionManifest(manifest);
  return {
    type: entry.artifactType,
    manifestPath,
    found: true,
    verdict: classification.verdict,
    reason: classification.reason,
    status: manifest.status ?? null,
    archive: manifest.archive ? {
      strategy: manifest.archive.strategy ?? null,
      complete: manifest.archive.complete ?? null,
      reason: manifest.archive.reason ?? null,
      pages: manifest.archive.pages ?? null,
    } : null,
    completeness: manifest.completeness ?? null,
    downloads: manifest.downloads ?? null,
    authHealth: manifest.authHealth ? {
      status: manifest.authHealth.status ?? null,
      identityConfirmed: manifest.authHealth.identityConfirmed === true,
      needsRecovery: manifest.authHealth.needsRecovery === true,
      recoveryReason: manifest.authHealth.recoveryReason ?? null,
      recoveryCommand: manifest.authHealth.recoveryCommand ?? null,
    } : null,
    runtimeRisk: manifest.runtimeRisk ?? null,
  };
}

function normalizedStatus(value) {
  return String(value ?? '').trim().toLowerCase();
}

function isDoctorFailureStatus(value) {
  return ['fail', 'failed', 'error', 'errored'].includes(normalizedStatus(value));
}

function isDoctorPassLikeStatus(value) {
  return ['pass', 'passed', 'skipped'].includes(normalizedStatus(value));
}

function isBlockedReasonCode(value) {
  const reason = String(value ?? '').trim().toLowerCase();
  return ['not-logged-in', 'anti-crawl-challenge', 'anti-crawl-rate-limit', 'browser-fingerprint-risk', 'platform-boundary'].includes(reason)
    || reason.startsWith('anti-crawl-')
    || reason.includes('challenge')
    || reason.includes('rate-limit')
    || reason.includes('fingerprint');
}

export function classifyDoctorReport(report) {
  const authHealth = report?.authHealth ?? report?.auth ?? null;
  const scenarios = Array.isArray(report?.scenarios) ? report.scenarios : [];
  const blockedScenario = scenarios.find((scenario) => normalizedStatus(scenario.status) === 'blocked' || isBlockedReasonCode(scenario.reasonCode));
  if (authHealth?.available === false || blockedScenario) {
    return {
      verdict: 'blocked',
      reason: blockedScenario?.reasonCode ?? 'auth-unavailable',
    };
  }
  const failedScenario = scenarios.find((scenario) => isDoctorFailureStatus(scenario.status));
  if (failedScenario) {
    return {
      verdict: 'failed',
      reason: failedScenario.reasonCode ?? failedScenario.id ?? 'scenario-failed',
    };
  }
  if (scenarios.length > 0 && scenarios.every((scenario) => isDoctorPassLikeStatus(scenario.status))) {
    return { verdict: 'passed', reason: null };
  }
  return { verdict: 'unknown', reason: 'doctor-report-unclassified' };
}

async function summarizeSiteDoctorArtifacts(entry) {
  const latest = await locateLatestDoctorReport(entry.artifactRoot);
  if (!latest) {
    return {
      type: entry.artifactType,
      found: false,
      verdict: 'unknown',
      reason: 'doctor-report-missing',
      artifactRoot: entry.artifactRoot,
    };
  }
  const report = await readJsonFile(latest.reportPath);
  const classification = classifyDoctorReport(report);
  return {
    type: entry.artifactType,
    found: true,
    verdict: classification.verdict,
    reason: classification.reason,
    artifactRoot: entry.artifactRoot,
    reportDir: latest.reportDir,
    doctorReportJson: latest.reportPath,
    doctorReportMarkdown: await pathExists(path.join(latest.reportDir, 'doctor-report.md')) ? path.join(latest.reportDir, 'doctor-report.md') : null,
    scenarioCount: Array.isArray(report?.scenarios) ? report.scenarios.length : 0,
    scenarioStatuses: Array.isArray(report?.scenarios)
      ? report.scenarios.map((scenario) => ({
        id: scenario.id ?? null,
        status: scenario.status ?? null,
        reasonCode: scenario.reasonCode ?? null,
        finalUrl: scenario.finalUrl ?? null,
      }))
      : [],
    authHealth: report?.authHealth ?? report?.auth ?? null,
  };
}

async function summarizeKbRefreshArtifacts(entry) {
  const manifestPath = await locateLatestManifest(entry.artifactRoot);
  if (!manifestPath) {
    return {
      type: entry.artifactType,
      manifestPath: path.join(entry.artifactRoot, 'manifest.json'),
      found: false,
      verdict: 'unknown',
      reason: 'kb-refresh-manifest-missing',
    };
  }
  const manifest = await readJsonFile(manifestPath);
  const classification = classifyKbRefreshManifest(manifest);
  const results = classification.results;
  return {
    type: entry.artifactType,
    manifestPath,
    found: true,
    verdict: classification.verdict,
    reason: classification.reason,
    status: manifest.status ?? null,
    caseCount: manifest.commands?.length ?? 0,
    results: results.map((result) => ({
      id: result.id,
      status: result.status,
      exitCode: result.exitCode,
      artifacts: result.artifacts ?? null,
    })),
  };
}

export function classifyKbRefreshManifest(manifest) {
  const results = Array.isArray(manifest?.results) ? manifest.results : [];
  const blocked = results.find((result) => (
    result.status === 'blocked'
    || result.blocked?.status === true
    || result.timeout?.timedOut === true
    || (result.artifacts?.scenarioStatuses ?? []).some((scenario) => normalizedStatus(scenario.status) === 'blocked' || isBlockedReasonCode(scenario.reasonCode))
  ));
  if (blocked) {
    return {
      verdict: 'blocked',
      reason: blocked.blocked?.reason ?? (blocked.timeout?.timedOut ? 'timeout' : 'scenario-blocked'),
      results,
    };
  }
  const failed = results.find((result) => isDoctorFailureStatus(result.status) || (result.exitCode !== 0 && result.exitCode !== null && result.exitCode !== undefined));
  if (failed) {
    return {
      verdict: 'failed',
      reason: 'case-failed',
      results,
    };
  }
  if (manifest?.status === 'passed') {
    return {
      verdict: 'passed',
      reason: null,
      results,
    };
  }
  return {
    verdict: 'unknown',
    reason: 'kb-refresh-unclassified',
    results,
  };
}

async function summarizeCaseArtifacts(entry) {
  try {
    if (entry.artifactType === 'social-action') {
      return await summarizeSocialActionArtifacts(entry);
    }
    if (entry.artifactType === 'site-doctor') {
      return await summarizeSiteDoctorArtifacts(entry);
    }
    if (entry.artifactType === 'kb-refresh') {
      return await summarizeKbRefreshArtifacts(entry);
    }
  } catch (error) {
    return {
      type: entry.artifactType,
      found: false,
      verdict: 'unknown',
      reason: `artifact-parse-failed: ${error?.message ?? String(error)}`,
    };
  }
  return {
    type: entry.artifactType,
    found: false,
    verdict: 'unknown',
    reason: 'unsupported-artifact-type',
  };
}

function aggregateMatrixStatus(results) {
  if (results.some((result) => result.artifactSummary?.verdict === 'failed')) {
    return 'failed';
  }
  if (results.some((result) => result.artifactSummary?.verdict === 'blocked')) {
    return 'blocked';
  }
  if (results.some((result) => result.artifactSummary?.verdict === 'skipped')) {
    return 'skipped';
  }
  if (results.some((result) => result.artifactSummary?.verdict === 'unknown')) {
    return 'unknown';
  }
  if (results.some((result) => !result.artifactSummary)) {
    return 'unknown';
  }
  return 'passed';
}

function printSummary(results) {
  process.stdout.write('\nLive matrix artifact summary\n');
  for (const result of results) {
    const summary = result.artifactSummary ?? {};
    const reason = summary.reason ? ` (${summary.reason})` : '';
    process.stdout.write(`- ${result.id}: command=${result.status}, artifact=${summary.verdict ?? 'unknown'}${reason}\n`);
  }
}

async function executePlan(entries, options, runId) {
  const runDir = path.join(path.resolve(options.runRoot), runId);
  await mkdir(runDir, { recursive: true });
  const manifest = {
    runId,
    mode: 'execute',
    startedAt: new Date().toISOString(),
    repoRoot: REPO_ROOT,
    runDir,
    options: {
      site: options.site,
      cases: options.cases,
      xAccount: normalizeHandle(options.xAccount),
      igAccount: normalizeHandle(options.igAccount),
      date: options.date,
      maxItems: options.maxItems,
      maxUsers: options.maxUsers,
      maxMediaDownloads: options.maxMediaDownloads,
      mediaDownloadConcurrency: options.mediaDownloadConcurrency,
      mediaDownloadRetries: options.mediaDownloadRetries,
      mediaDownloadBackoffMs: options.mediaDownloadBackoffMs,
      timeout: options.timeout,
      caseTimeout: options.caseTimeout,
      riskBackoffMs: options.riskBackoffMs,
      riskRetries: options.riskRetries,
      apiRetries: options.apiRetries,
      headless: options.headless,
      failFast: options.failFast,
    },
    commands: entries.map((entry) => ({
      id: entry.id,
      site: entry.site,
      category: entry.category,
      purpose: entry.purpose,
      artifactType: entry.artifactType,
      artifactRoot: entry.artifactRoot,
      command: formatCommand(entry),
    })),
    results: [],
    status: 'running',
  };
  const manifestPath = path.join(runDir, 'manifest.json');
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  for (const entry of entries) {
    process.stdout.write(`\n[${entry.id}] ${formatCommand(entry)}\n`);
    const result = await runCommand(entry, options);
    result.artifactSummary = await summarizeCaseArtifacts(entry);
    if (result.signal === 'timeout' && result.artifactSummary?.verdict === 'unknown') {
      result.artifactSummary.verdict = 'blocked';
      result.artifactSummary.reason = 'timeout';
    }
    manifest.results.push(result);
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    if (result.exitCode !== 0 && options.failFast) {
      manifest.status = 'failed';
      manifest.finishedAt = new Date().toISOString();
      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
      process.exitCode = result.exitCode ?? 1;
      return manifestPath;
    }
  }

  manifest.status = aggregateMatrixStatus(manifest.results);
  manifest.finishedAt = new Date().toISOString();
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  printSummary(manifest.results);
  if (manifest.status !== 'passed') {
    process.exitCode = 1;
  }
  return manifestPath;
}

async function main(argv) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(`${HELP}\n`);
    return;
  }
  const boundary = evaluateLiveSmokeBoundary(options);
  if (!boundary.ok) {
    process.stdout.write(`social-live-verify not-run: missing explicit boundary flag(s): --${boundary.missing.join(', --')}\n`);
    process.stdout.write('No live commands were planned or executed.\n');
    return;
  }
  const runId = timestampForDir();
  const matrix = buildMatrix(options, runId);
  const selected = filterMatrix(matrix, options);
  if (selected.length === 0) {
    throw new Error('No commands selected.');
  }
  printPlan(selected, options);
  if (!options.execute) {
    process.stdout.write('Dry-run only. Re-run with --execute to run live commands and write a manifest.\n');
    return;
  }
  const manifestPath = await executePlan(selected, options, runId);
  process.stdout.write(`\nManifest: ${manifestPath}\n`);
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (entryPath && entryPath === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error?.message ?? String(error));
    process.exitCode = 1;
  });
}
