// @ts-check

import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { createCliProgressRenderer, parseProgressCliOption } from '../src/infra/cli/progress-cli.mjs';
import { unifiedCliCommandForScript } from '../src/infra/cli/command-map.mjs';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(MODULE_DIR, '..');

const HELP = `Internal script usage:
  node scripts/social-command-templates.mjs [--site x|instagram|all] [options]

Public command:
  siteforge build <url>

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
  --json                            Alias for --format json.
  --quiet                           Suppress human progress and text output.
  --progress <auto|interactive|plain>
  --force-tty                       Force interactive progress rendering.
  --no-tty                          Force plain progress rendering.
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
    json: false,
    quiet: false,
    progressMode: undefined,
    forceTty: false,
    noTty: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const progressOption = parseProgressCliOption(argv, token, index, options);
    if (progressOption.handled) {
      index = progressOption.nextIndex;
      continue;
    }
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
  if (options.json) {
    options.format = 'json';
  }
  if (!['x', 'instagram', 'all'].includes(String(options.site))) {
    throw new Error(`Invalid --site: ${options.site}`);
  }
  if (!['text', 'json'].includes(String(options.format))) {
    throw new Error(`Invalid --format: ${options.format}`);
  }
  return options;
}

function nodeLine(script, args) {
  return unifiedCliCommandForScript(script, args);
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
  const common = ['--max-items', String(options.maxItems), '--session-health-plan', '--reuse-login-state', '--no-headless'];
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
      const verifyCommand = nodeLine(path.join('scripts', 'social-live-verify.mjs'), liveSmokeCommon);
      const planJsonCommand = nodeLine(path.join('scripts', 'social-live-verify.mjs'), ['--plan-json', ...liveSmokeCommon]);
      const executeVerifyCommand = nodeLine(path.join('scripts', 'social-live-verify.mjs'), ['--execute', ...liveSmokeCommon]);
      const resumeCommand = nodeLine(path.join('scripts', 'social-live-resume.mjs'), ['--site', site.site, '--state', '<state-or-manifest.json>', '--cooldown-minutes', options.cooldownMinutes, '--max-attempts', '3']);
      const cooldownCommand = nodeLine(path.join('scripts', 'social-live-resume.mjs'), ['--site', site.site, '--state', '<state-or-manifest.json>', '--cooldown-minutes', options.cooldownMinutes]);
      const healthCommand = nodeLine(path.join('scripts', 'social-health-watch.mjs'), ['--site', site.site]);
      const executeHealthCommand = nodeLine(path.join('scripts', 'social-health-watch.mjs'), ['--execute', '--site', site.site]);
      const kbRefreshCommand = nodeLine(path.join('scripts', 'social-kb-refresh.mjs'), ['--plan-only', '--site', site.site, '--once']);
      const kbPlanJsonCommand = nodeLine(path.join('scripts', 'social-kb-refresh.mjs'), ['--plan-json', '--site', site.site, '--once']);
      const kbExecuteCommand = nodeLine(path.join('scripts', 'social-kb-refresh.mjs'), ['--execute', '--site', site.site, '--once']);
      const kbWatchCommand = nodeLine(path.join('scripts', 'social-kb-refresh.mjs'), ['--execute', '--site', site.site, '--watch', '--schedule-interval-minutes', '720']);
      return {
        site: site.site,
        account: site.account,
        productionCommands,
        verifyCommand,
        planJsonCommand,
        executeVerifyCommand,
        resumeCommand,
        cooldownCommand,
        healthCommand,
        executeHealthCommand,
        kbRefreshCommand,
        kbPlanJsonCommand,
        kbExecuteCommand,
        kbWatchCommand,
        dryRunCommands: [
          { label: 'live smoke text plan', risk: 'dry-run', command: verifyCommand },
          { label: 'live smoke JSON plan', risk: 'dry-run no-write', command: planJsonCommand },
          { label: 'health plan', risk: 'dry-run', command: healthCommand },
          { label: 'KB refresh text plan', risk: 'dry-run no-write', command: kbRefreshCommand },
          { label: 'KB refresh JSON plan', risk: 'dry-run no-write', command: kbPlanJsonCommand },
        ],
        executeCommands: [
          { label: 'live smoke execute', risk: 'execute high-risk', command: executeVerifyCommand },
          { label: 'health execute', risk: 'execute high-risk', command: executeHealthCommand },
          { label: 'KB refresh execute once', risk: 'execute high-risk', command: kbExecuteCommand },
          { label: 'KB refresh scheduled execute', risk: 'execute high-risk', command: kbWatchCommand },
          ...productionCommands.map((command) => ({ label: 'production action', risk: 'execute high-risk', command })),
        ],
      };
    }),
  };
}

function printText(templates) {
  process.stdout.write('Social command templates\n\n');
  for (const site of templates.sites) {
    process.stdout.write(`${site.site} (${site.account})\n`);
    process.stdout.write('  dry-run / no-write:\n');
    for (const item of site.dryRunCommands) {
      process.stdout.write(`    ${item.label} [${item.risk}]: ${item.command}\n`);
    }
    process.stdout.write('  execute / high-risk:\n');
    for (const item of site.executeCommands) {
      process.stdout.write(`    ${item.label} [${item.risk}]: ${item.command}\n`);
    }
    process.stdout.write('  recovery / cooldown:\n');
    process.stdout.write(`    resume: ${site.resumeCommand}\n`);
    process.stdout.write(`    cooldown: ${site.cooldownCommand}\n\n`);
  }
}

export async function main(argv) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(`${HELP}\n`);
    return;
  }
  const templates = buildTemplates(options);
  const progress = createCliProgressRenderer(options);
  const task = progress.task({
    id: 'socialCommandTemplates',
    title: 'Social command templates',
    totalStages: 1,
    item: options.site,
  });
  const stage = task.stage({
    id: 'templates',
    title: 'Build command templates',
    index: 1,
    current: templates.sites.length,
    total: templates.sites.length,
    item: options.site,
  });
  stage.succeed({ message: `Generated ${templates.sites.length} site template(s)` });
  task.succeed({ message: 'Command templates generated' });
  if (options.format === 'json') {
    process.stdout.write(`${JSON.stringify(templates, null, 2)}\n`);
    return;
  }
  if (!options.quiet) {
    printText(templates);
  }
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (entryPath && entryPath === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error?.message ?? String(error));
    process.exitCode = 1;
  });
}
