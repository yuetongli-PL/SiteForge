// @ts-check

import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(MODULE_DIR, '..');

const HELP = `Usage:
  node scripts/social-command-templates.mjs [--site x|instagram|all] [options]

Prints reusable X/Instagram production, resume, cooldown, health, and KB refresh command templates.

Options:
  --site <x|instagram|all>          Template site filter. Default: all.
  --account <handle>                Account used by both sites when site-specific account is omitted.
  --x-account <handle>              X account placeholder/default. Default: <x-account>.
  --ig-account <handle>             Instagram account placeholder/default. Default: <ig-account>.
  --date <YYYY-MM-DD>               Followed-date placeholder/default. Default: <YYYY-MM-DD>.
  --max-items <n>                   Default max items. Default: 25.
  --max-users <n>                   Default max followed users. Default: 25.
  --max-media-downloads <n>         Default max media downloads. Default: 25.
  --timeout <ms>                    Live smoke timeout. Default: 120000.
  --case-timeout <ms>               Live smoke outer timeout. Default: 600000.
  --run-root <dir>                  Live smoke run root. Default: runs/social-live-verify.
  --cooldown-minutes <n>            Cooldown template value. Default: 30.
  --format <text|json>              Output format. Default: text.
  -h, --help                        Show this help.
`;

function readValue(argv, index, flag) {
  if (index + 1 >= argv.length) {
    throw new Error(`Missing value for ${flag}`);
  }
  return { value: argv[index + 1], nextIndex: index + 1 };
}

function normalizeHandle(value) {
  return String(value ?? '').trim().replace(/^@/u, '');
}

export function parseArgs(argv) {
  const options = {
    site: 'all',
    account: null,
    xAccount: '<x-account>',
    igAccount: '<ig-account>',
    date: '<YYYY-MM-DD>',
    maxItems: '25',
    maxUsers: '25',
    maxMediaDownloads: '25',
    timeout: '120000',
    caseTimeout: '600000',
    runRoot: path.join('runs', 'social-live-verify'),
    cooldownMinutes: '30',
    format: 'text',
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    switch (token) {
      case '-h':
      case '--help':
        options.help = true;
        break;
      case '--site':
      case '--account':
      case '--x-account':
      case '--ig-account':
      case '--date':
      case '--max-items':
      case '--max-users':
      case '--max-media-downloads':
      case '--timeout':
      case '--case-timeout':
      case '--run-root':
      case '--cooldown-minutes':
      case '--format': {
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
  if (!['text', 'json'].includes(String(options.format))) {
    throw new Error(`Invalid --format: ${options.format}`);
  }
  return options;
}

function shellQuote(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_./:@=\\<>-]+$/u.test(text)) {
    return text;
  }
  return `"${text.replace(/"/gu, '\\"')}"`;
}

function nodeLine(script, args) {
  return ['node', script, ...args].map(shellQuote).join(' ');
}

function siteEntries(options) {
  const sites = [];
  if (options.site === 'x' || options.site === 'all') {
    sites.push({
      site: 'x',
      account: normalizeHandle(options.xAccount),
      verifyCases: ['x-auth-doctor', 'x-full-archive', 'x-media-download'],
      action: path.join('src', 'entrypoints', 'sites', 'x-action.mjs'),
      fullArchive: ['full-archive', normalizeHandle(options.xAccount)],
      media: ['profile-content', normalizeHandle(options.xAccount), '--content-type', 'media', '--download-media'],
    });
  }
  if (options.site === 'instagram' || options.site === 'all') {
    sites.push({
      site: 'instagram',
      account: normalizeHandle(options.igAccount),
      verifyCases: ['instagram-auth-doctor', 'instagram-full-archive', 'instagram-media-download', 'instagram-followed-date'],
      action: path.join('src', 'entrypoints', 'sites', 'instagram-action.mjs'),
      fullArchive: ['full-archive', normalizeHandle(options.igAccount)],
      media: ['profile-content', normalizeHandle(options.igAccount), '--content-type', 'media', '--download-media'],
      followedDate: ['followed-posts-by-date', '--date', options.date, '--max-users', options.maxUsers],
    });
  }
  return sites;
}

export function buildTemplates(options) {
  const common = ['--max-items', String(options.maxItems), '--reuse-login-state', '--no-headless'];
  return {
    repoRoot: REPO_ROOT,
    generatedAt: new Date().toISOString(),
    sites: siteEntries(options).map((site) => {
      const cases = site.verifyCases.flatMap((id) => ['--case', id]);
      const liveSmokeCommon = [
        '--live',
        '--site',
        site.site,
        ...cases,
        site.site === 'x' ? '--x-account' : '--ig-account',
        site.account,
        '--date',
        options.date,
        '--max-items',
        options.maxItems,
        '--max-users',
        options.maxUsers,
        '--max-media-downloads',
        options.maxMediaDownloads,
        '--timeout',
        options.timeout,
        '--case-timeout',
        options.caseTimeout,
        '--run-root',
        options.runRoot,
      ];
      const productionCommands = [
        nodeLine(site.action, [...site.fullArchive, ...common, '--run-dir', `runs/social-production/${site.site}/full-archive`]),
        nodeLine(site.action, [...site.media, ...common, '--run-dir', `runs/social-production/${site.site}/media`]),
      ];
      if (site.followedDate) {
        productionCommands.push(nodeLine(site.action, [...site.followedDate, ...common, '--run-dir', `runs/social-production/${site.site}/followed-date`]));
      }
      return {
        site: site.site,
        account: site.account,
        productionCommands,
        verifyCommand: nodeLine(path.join('scripts', 'social-live-verify.mjs'), liveSmokeCommon),
        executeVerifyCommand: nodeLine(path.join('scripts', 'social-live-verify.mjs'), ['--execute', ...liveSmokeCommon]),
        resumeCommand: nodeLine(path.join('scripts', 'social-live-resume.mjs'), ['--site', site.site, '--state', '<state-or-manifest.json>', '--cooldown-minutes', options.cooldownMinutes, '--max-attempts', '3']),
        cooldownCommand: nodeLine(path.join('scripts', 'social-live-resume.mjs'), ['--site', site.site, '--state', '<state-or-manifest.json>', '--cooldown-minutes', options.cooldownMinutes]),
        healthCommand: nodeLine(path.join('scripts', 'social-health-watch.mjs'), ['--site', site.site]),
        executeHealthCommand: nodeLine(path.join('scripts', 'social-health-watch.mjs'), ['--execute', '--site', site.site]),
        kbRefreshCommand: nodeLine(path.join('scripts', 'social-kb-refresh.mjs'), ['--site', site.site, '--once']),
        kbWatchCommand: nodeLine(path.join('scripts', 'social-kb-refresh.mjs'), ['--site', site.site, '--watch', '--schedule-interval-minutes', '720']),
      };
    }),
  };
}

function printText(templates) {
  process.stdout.write('Social command templates\n\n');
  for (const site of templates.sites) {
    process.stdout.write(`${site.site} (${site.account})\n`);
    for (const command of site.productionCommands) {
      process.stdout.write(`  production: ${command}\n`);
    }
    process.stdout.write(`  verify:     ${site.verifyCommand}\n`);
    process.stdout.write(`  execute:    ${site.executeVerifyCommand}\n`);
    process.stdout.write(`  resume:     ${site.resumeCommand}\n`);
    process.stdout.write(`  cooldown:   ${site.cooldownCommand}\n`);
    process.stdout.write(`  health:     ${site.healthCommand}\n`);
    process.stdout.write(`  kb once:    ${site.kbRefreshCommand}\n`);
    process.stdout.write(`  kb watch:   ${site.kbWatchCommand}\n\n`);
  }
}

export async function main(argv) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(`${HELP}\n`);
    return;
  }
  const templates = buildTemplates(options);
  if (options.format === 'json') {
    process.stdout.write(`${JSON.stringify(templates, null, 2)}\n`);
    return;
  }
  printText(templates);
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (entryPath && entryPath === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error?.message ?? String(error));
    process.exitCode = 1;
  });
}
