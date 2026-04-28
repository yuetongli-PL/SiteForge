// @ts-check

import { spawn } from 'node:child_process';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(MODULE_DIR, '..');
const DEFAULT_RUN_ROOT = path.join(REPO_ROOT, 'runs', 'social-auth-recover');

const SITE_CONFIGS = Object.freeze({
  x: {
    site: 'x',
    label: 'X',
    url: 'https://x.com/home',
    profilePath: path.join(REPO_ROOT, 'profiles', 'x.com.json'),
    defaultAccount: 'opensource',
    authCase: 'x-auth-doctor',
  },
  instagram: {
    site: 'instagram',
    label: 'Instagram',
    url: 'https://www.instagram.com/',
    profilePath: path.join(REPO_ROOT, 'profiles', 'www.instagram.com.json'),
    defaultAccount: 'instagram',
    authCase: 'instagram-auth-doctor',
  },
});

const HELP = `Usage:
  node scripts/social-auth-recover.mjs [--execute] [--site x|instagram|all] [--manual] [--verify] [options]

Defaults to dry-run plan mode. Use --execute to run keepalive/auth checks.

Options:
  --execute                         Run the recovery plan.
  --site <x|instagram|all>          Target site. Default: x.
  --manual                          If keepalive fails, open visible site-login and wait for manual login.
  --verify                          After recovery, run the site's social-live auth case.
  --verify-case <id>                Additional social-live case to run after recovery. Repeatable.
  --account <handle>                Account used for both sites when site-specific account is omitted.
  --x-account <handle>              X account forwarded to verification. Default: opensource.
  --ig-account <handle>             Instagram account forwarded to verification. Default: instagram.
  --timeout <ms>                    Browser command timeout. Default: 30000.
  --manual-timeout <ms>             Manual login wait timeout. Default: 600000.
  --case-timeout <ms>               Verification command timeout. Default: 600000.
  --run-root <dir>                  Manifest/output root. Default: runs/social-auth-recover.
  --browser-path <path>             Forwarded to site-login/site-keepalive/social-live-verify.
  --browser-profile-root <dir>      Forwarded to site-login/site-keepalive/social-live-verify.
  --user-data-dir <dir>             Forwarded to site-login/site-keepalive/social-live-verify.
  --headless|--no-headless          Forwarded to keepalive checks. Default: --no-headless.
  --auto-login|--no-auto-login      Allow credential-based login attempts. Default: --no-auto-login.
  -h, --help                        Show this help.
`;

function timestampForDir(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.(\d{3})Z$/u, '$1Z');
}

function normalizeHandle(value) {
  return String(value ?? '').trim().replace(/^@/u, '').replace(/^\/+|\/+$/gu, '');
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
    site: 'x',
    manual: false,
    verify: false,
    verifyCases: [],
    account: null,
    xAccount: SITE_CONFIGS.x.defaultAccount,
    igAccount: SITE_CONFIGS.instagram.defaultAccount,
    timeout: '30000',
    manualTimeout: '600000',
    caseTimeout: '600000',
    runRoot: DEFAULT_RUN_ROOT,
    browserPath: null,
    browserProfileRoot: null,
    userDataDir: null,
    headless: false,
    autoLogin: false,
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
      case '--dry-run':
        options.execute = false;
        break;
      case '--manual':
        options.manual = true;
        break;
      case '--verify':
        options.verify = true;
        break;
      case '--auto-login':
        options.autoLogin = true;
        break;
      case '--no-auto-login':
        options.autoLogin = false;
        break;
      case '--headless':
        options.headless = true;
        break;
      case '--no-headless':
        options.headless = false;
        break;
      case '--verify-case': {
        const { value, nextIndex } = readValue(argv, index, token);
        options.verifyCases.push(value);
        index = nextIndex;
        break;
      }
      case '--site':
      case '--account':
      case '--x-account':
      case '--ig-account':
      case '--timeout':
      case '--manual-timeout':
      case '--case-timeout':
      case '--run-root':
      case '--browser-path':
      case '--browser-profile-root':
      case '--user-data-dir': {
        const { value, nextIndex } = readValue(argv, index, token);
        const key = token.slice(2).replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase());
        options[key] = value;
        index = nextIndex;
        break;
      }
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
  for (const [flag, value] of [
    ['timeout', options.timeout],
    ['manual-timeout', options.manualTimeout],
    ['case-timeout', options.caseTimeout],
  ]) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw new Error(`Invalid --${flag}: ${value}`);
    }
  }
  return options;
}

function selectedSites(options) {
  if (options.site === 'all') {
    return [SITE_CONFIGS.x, SITE_CONFIGS.instagram];
  }
  return [SITE_CONFIGS[options.site]];
}

function addOptional(args, flag, value) {
  if (value !== null && value !== undefined && String(value).trim() !== '') {
    args.push(flag, String(value));
  }
}

function siteAccount(config, options) {
  return config.site === 'x' ? normalizeHandle(options.xAccount) : normalizeHandle(options.igAccount);
}

function nodeCommand(scriptRelativePath, args) {
  return {
    command: process.execPath,
    args: [scriptRelativePath, ...args],
  };
}

function keepaliveCommand(config, options, outDir) {
  const args = [
    config.url,
    '--profile-path',
    config.profilePath,
    '--out-dir',
    outDir,
    '--timeout',
    String(options.timeout),
    '--reuse-login-state',
    options.headless ? '--headless' : '--no-headless',
    options.autoLogin ? '--auto-login' : '--no-auto-login',
  ];
  addOptional(args, '--browser-path', options.browserPath);
  addOptional(args, '--browser-profile-root', options.browserProfileRoot);
  addOptional(args, '--user-data-dir', options.userDataDir);
  return nodeCommand(path.join('src', 'entrypoints', 'sites', 'site-keepalive.mjs'), args);
}

function manualLoginCommand(config, options, outDir) {
  const args = [
    config.url,
    '--profile-path',
    config.profilePath,
    '--out-dir',
    outDir,
    '--timeout',
    String(options.timeout),
    '--manual-timeout',
    String(options.manualTimeout),
    '--reuse-login-state',
    '--wait-for-manual-login',
    '--no-headless',
    options.autoLogin ? '--auto-login' : '--no-auto-login',
  ];
  addOptional(args, '--browser-path', options.browserPath);
  addOptional(args, '--browser-profile-root', options.browserProfileRoot);
  addOptional(args, '--user-data-dir', options.userDataDir);
  return nodeCommand(path.join('src', 'entrypoints', 'sites', 'site-login.mjs'), args);
}

function verifyCommand(config, options, outDir, caseId) {
  const args = [
    '--live',
    '--execute',
    '--site',
    config.site,
    '--case',
    caseId,
    '--run-root',
    outDir,
    '--x-account',
    normalizeHandle(options.xAccount),
    '--ig-account',
    normalizeHandle(options.igAccount),
    '--timeout',
    String(options.timeout),
    '--case-timeout',
    String(options.caseTimeout),
    '--max-items',
    '5',
    '--max-users',
    '5',
    '--max-media-downloads',
    '5',
    options.headless ? '--headless' : '--no-headless',
  ];
  addOptional(args, '--browser-path', options.browserPath);
  addOptional(args, '--browser-profile-root', options.browserProfileRoot);
  addOptional(args, '--user-data-dir', options.userDataDir);
  return nodeCommand(path.join('scripts', 'social-live-verify.mjs'), args);
}

function shellQuote(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_./:@=\\-]+$/u.test(text)) {
    return text;
  }
  return `"${text.replace(/"/gu, '\\"')}"`;
}

export function formatCommand(command) {
  return [command.command, ...command.args].map(shellQuote).join(' ');
}

export function buildRecoveryPlan(options, runId = timestampForDir()) {
  const runRoot = path.resolve(options.runRoot);
  const runDir = path.join(runRoot, runId);
  const sites = selectedSites(options).map((config) => {
    const siteDir = path.join(runDir, config.site);
    const verifyCases = [...new Set([
      config.authCase,
      ...(options.verifyCases ?? []),
    ])].filter((caseId) => caseId.startsWith(`${config.site === 'x' ? 'x' : 'instagram'}-`));
    const entry = {
      site: config.site,
      label: config.label,
      account: siteAccount(config, options),
      url: config.url,
      profilePath: config.profilePath,
      artifactRoot: siteDir,
      commands: {
        keepalive: keepaliveCommand(config, options, path.join(siteDir, 'keepalive')),
        manualLogin: manualLoginCommand(config, options, path.join(siteDir, 'manual-login')),
        verify: verifyCases.map((caseId) => ({
          caseId,
          ...verifyCommand(config, options, path.join(siteDir, 'live-verify', caseId), caseId),
        })),
      },
    };
    return {
      ...entry,
      commandLines: {
        keepalive: formatCommand(entry.commands.keepalive),
        manualLogin: formatCommand(entry.commands.manualLogin),
        verify: entry.commands.verify.map((command) => ({
          caseId: command.caseId,
          command: formatCommand(command),
        })),
      },
    };
  });
  return {
    runId,
    runDir,
    options: {
      site: options.site,
      manual: options.manual,
      verify: options.verify,
      verifyCases: options.verifyCases,
      xAccount: normalizeHandle(options.xAccount),
      igAccount: normalizeHandle(options.igAccount),
      timeout: options.timeout,
      manualTimeout: options.manualTimeout,
      caseTimeout: options.caseTimeout,
      headless: options.headless,
      autoLogin: options.autoLogin,
    },
    sites,
  };
}

function commandManifest(command) {
  return {
    command: formatCommand(command),
    commandArray: [command.command, ...command.args],
  };
}

function buildManifest(plan, options, manifestPath) {
  return {
    runId: plan.runId,
    mode: options.execute ? 'execute' : 'dry-run',
    status: options.execute ? 'running' : 'planned',
    startedAt: new Date().toISOString(),
    finishedAt: options.execute ? null : new Date().toISOString(),
    repoRoot: REPO_ROOT,
    runDir: plan.runDir,
    manifestPath,
    options: plan.options,
    sites: plan.sites.map((site) => ({
      site: site.site,
      label: site.label,
      account: site.account,
      url: site.url,
      profilePath: site.profilePath,
      artifactRoot: site.artifactRoot,
      commands: {
        keepalive: commandManifest(site.commands.keepalive),
        manualLogin: commandManifest(site.commands.manualLogin),
        verify: site.commands.verify.map((command) => ({
          caseId: command.caseId,
          ...commandManifest(command),
        })),
      },
    })),
    results: [],
  };
}

function parseJsonFromStdout(stdout) {
  const text = String(stdout ?? '').trim().replace(/^\uFEFF/u, '');
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(text.slice(start, end + 1));
    }
    throw new Error('Command did not emit parseable JSON.');
  }
}

export function classifyAuthRecoveryReport(report) {
  const keepalive = report?.keepalive ?? null;
  const auth = report?.auth ?? null;
  const status = String(keepalive?.status ?? auth?.status ?? report?.status ?? 'unknown');
  const persistenceVerified = report?.auth?.persistenceVerified === true
    || report?.keepalive?.persistenceVerified === true
    || report?.recovered === true;
  const identityConfirmed = auth?.identityConfirmed === true
    || auth?.loginState?.identityConfirmed === true
    || report?.keepalive?.identityConfirmed === true;
  if (persistenceVerified || ['kept-alive', 'session-reused', 'manual-login-complete', 'authenticated'].includes(status)) {
    return {
      status: 'recovered',
      reason: status,
      reusable: true,
      identityConfirmed,
    };
  }
  if (auth?.challengeRequired === true || keepalive?.challengeRequired === true || status === 'challenge-required') {
    return {
      status: 'blocked',
      reason: 'challenge-required',
      reusable: false,
      identityConfirmed,
    };
  }
  if (status === 'credentials-unavailable' || auth?.waitStatus === 'timeout' || status === 'manual-login-timeout') {
    return {
      status: 'needs-manual-login',
      reason: status,
      reusable: false,
      identityConfirmed,
    };
  }
  return {
    status: 'unknown',
    reason: status,
    reusable: false,
    identityConfirmed,
  };
}

function runCommand(command, options) {
  return new Promise((resolve) => {
    const startedAt = new Date().toISOString();
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    const child = spawn(command.command, command.args, {
      cwd: REPO_ROOT,
      env: process.env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
      process.stdout.write(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      process.stderr.write(chunk);
    });
    const timeoutMs = Number(options.timeoutMs);
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
        command: formatCommand(command),
        startedAt,
        finishedAt: new Date().toISOString(),
        exitCode,
        signal: timedOut ? 'timeout' : signal,
        stdout,
        stderr,
        timedOut,
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

async function readJsonIfExists(filePath) {
  if (!await pathExists(filePath)) {
    return null;
  }
  return JSON.parse((await readFile(filePath, 'utf8')).replace(/^\uFEFF/u, ''));
}

async function locateLatestManifest(runRoot) {
  const direct = path.join(runRoot, 'manifest.json');
  if (await pathExists(direct)) {
    return direct;
  }
  if (!await pathExists(runRoot)) {
    return null;
  }
  const entries = await readdir(runRoot, { withFileTypes: true });
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const candidate = path.join(runRoot, entry.name, 'manifest.json');
    if (await pathExists(candidate)) {
      const info = await stat(candidate);
      candidates.push({ path: candidate, mtimeMs: info.mtimeMs });
    }
  }
  candidates.sort((left, right) => right.mtimeMs - left.mtimeMs);
  return candidates[0]?.path ?? null;
}

async function writeManifest(manifestPath, manifest) {
  await mkdir(path.dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

async function executeSiteRecovery(site, options) {
  const result = {
    site: site.site,
    label: site.label,
    account: site.account,
    status: 'running',
    reason: null,
    keepalive: null,
    manualLogin: null,
    verification: [],
    recommendedCommands: [],
  };

  const keepaliveRun = await runCommand(site.commands.keepalive, { timeoutMs: Number(options.timeout) + 10_000 });
  let keepaliveReport = null;
  let keepaliveClassification = { status: 'unknown', reason: 'no-json', reusable: false };
  try {
    keepaliveReport = parseJsonFromStdout(keepaliveRun.stdout);
    keepaliveClassification = classifyAuthRecoveryReport(keepaliveReport);
  } catch (error) {
    keepaliveClassification = {
      status: keepaliveRun.timedOut ? 'blocked' : 'unknown',
      reason: keepaliveRun.timedOut ? 'timeout' : `keepalive-json-parse-failed: ${error?.message ?? String(error)}`,
      reusable: false,
    };
  }
  result.keepalive = {
    ...keepaliveRun,
    stdout: undefined,
    stderr: keepaliveRun.stderr ? keepaliveRun.stderr.slice(-4000) : '',
    report: keepaliveReport,
    classification: keepaliveClassification,
  };

  let finalClassification = keepaliveClassification;
  if (keepaliveClassification.status !== 'recovered' && options.manual) {
    const manualRun = await runCommand(site.commands.manualLogin, { timeoutMs: Number(options.manualTimeout) + 30_000 });
    let manualReport = null;
    let manualClassification = { status: 'unknown', reason: 'no-json', reusable: false };
    try {
      manualReport = parseJsonFromStdout(manualRun.stdout);
      manualClassification = classifyAuthRecoveryReport(manualReport);
    } catch (error) {
      manualClassification = {
        status: manualRun.timedOut ? 'needs-manual-login' : 'unknown',
        reason: manualRun.timedOut ? 'manual-login-timeout' : `manual-json-parse-failed: ${error?.message ?? String(error)}`,
        reusable: false,
      };
    }
    result.manualLogin = {
      ...manualRun,
      stdout: undefined,
      stderr: manualRun.stderr ? manualRun.stderr.slice(-4000) : '',
      report: manualReport,
      classification: manualClassification,
    };
    finalClassification = manualClassification;
  }

  if (finalClassification.status === 'recovered' && options.verify) {
    for (const command of site.commands.verify) {
      const verificationRun = await runCommand(command, { timeoutMs: Number(options.caseTimeout) + 10_000 });
      const runRoot = command.args[command.args.indexOf('--run-root') + 1];
      const liveManifestPath = await locateLatestManifest(runRoot);
      result.verification.push({
        caseId: command.caseId,
        ...verificationRun,
        stdout: undefined,
        stderr: verificationRun.stderr ? verificationRun.stderr.slice(-4000) : '',
        artifactManifestPath: liveManifestPath,
        artifactManifest: liveManifestPath ? await readJsonIfExists(liveManifestPath) : null,
      });
      if (verificationRun.exitCode !== 0) {
        finalClassification = {
          status: 'verify-failed',
          reason: command.caseId,
          reusable: true,
        };
        break;
      }
    }
  }

  result.status = finalClassification.status;
  result.reason = finalClassification.reason;
  if (result.status !== 'recovered') {
    result.recommendedCommands.push(site.commandLines.manualLogin);
    if (result.verification.length === 0) {
      result.recommendedCommands.push(...site.commandLines.verify.map((entry) => entry.command));
    }
  }
  return result;
}

async function executePlan(plan, options, manifest, manifestPath) {
  await writeManifest(manifestPath, manifest);
  for (const site of plan.sites) {
    const result = await executeSiteRecovery(site, options);
    manifest.results.push(result);
    await writeManifest(manifestPath, manifest);
  }
  manifest.status = manifest.results.every((result) => result.status === 'recovered') ? 'passed' : 'blocked';
  manifest.finishedAt = new Date().toISOString();
  await writeManifest(manifestPath, manifest);
  if (manifest.status !== 'passed') {
    process.exitCode = 1;
  }
  return manifestPath;
}

function printPlan(plan, options, manifestPath) {
  process.stdout.write(`social-auth-recover ${options.execute ? 'execute' : 'dry-run'} plan (${plan.sites.length} site(s))\n`);
  process.stdout.write(`Manifest: ${manifestPath}\n\n`);
  for (const site of plan.sites) {
    process.stdout.write(`${site.label} (${site.site})\n`);
    process.stdout.write(`  keepalive: ${site.commandLines.keepalive}\n`);
    process.stdout.write(`  manual:    ${site.commandLines.manualLogin}\n`);
    if (site.commandLines.verify.length) {
      for (const verify of site.commandLines.verify) {
        process.stdout.write(`  verify ${verify.caseId}: ${verify.command}\n`);
      }
    }
    process.stdout.write('\n');
  }
}

export async function main(argv) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(`${HELP}\n`);
    return;
  }
  const runId = timestampForDir();
  const plan = buildRecoveryPlan(options, runId);
  const manifestPath = path.join(plan.runDir, 'manifest.json');
  const manifest = buildManifest(plan, options, manifestPath);
  await writeManifest(manifestPath, manifest);
  printPlan(plan, options, manifestPath);
  if (!options.execute) {
    process.stdout.write('Dry-run only. Re-run with --execute to run keepalive/auth recovery.\n');
    return;
  }
  await executePlan(plan, options, manifest, manifestPath);
  process.stdout.write(`\nManifest: ${manifestPath}\n`);
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (entryPath && entryPath === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error?.message ?? String(error));
    process.exitCode = 1;
  });
}
