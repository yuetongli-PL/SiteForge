// @ts-check

import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { initializeCliUtf8 } from '../infra/cli.mjs';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

const TOP_LEVEL_ROUTES = Object.freeze({
  build: {
    summary: 'Run the full site pipeline.',
    script: ['pipeline', 'run-pipeline.mjs'],
  },
  skill: {
    summary: 'Generate a repo-local skill from existing site knowledge.',
    script: ['pipeline', 'generate-skill.mjs'],
  },
  doctor: {
    summary: 'Compatibility alias for site doctor.',
    script: ['sites', 'site-doctor.mjs'],
  },
});

const DOMAIN_ROUTES = Object.freeze({
  site: {
    summary: 'Site onboarding, login, health, and repair commands.',
    commands: {
      doctor: { summary: 'Inspect a site and write onboarding/health artifacts.', script: ['sites', 'site-doctor.mjs'] },
      'capability-compile': { summary: 'Compile descriptor-only Site Capability Graph and Planner dry-run evidence.', script: ['sites', 'site-capability-compile.mjs'] },
      'recompile-preview': { summary: 'Build descriptor-only recompile preview summary for repo-local skills.', script: ['sites', 'site-recompile-preview-summary.mjs'] },
      login: { summary: 'Run site login flow.', script: ['sites', 'site-login.mjs'] },
      keepalive: { summary: 'Check or refresh a reusable site session.', script: ['sites', 'site-keepalive.mjs'] },
      scaffold: { summary: 'Create a new site scaffold.', script: ['sites', 'site-scaffold.mjs'] },
      credentials: { summary: 'Manage Windows Credential Manager entries.', script: ['sites', 'site-credentials.mjs'] },
      'nl-login': { summary: 'Parse and run a natural-language login request.', script: ['sites', 'nl-site-login.mjs'] },
      'repair-plan': { summary: 'Build a session repair plan for a site.', script: ['sites', 'session-repair-plan.mjs'] },
    },
  },
  session: {
    summary: 'Sanitized session health and repair planning.',
    commands: {
      health: { summary: 'Write a sanitized session health manifest.', script: ['sites', 'session.mjs'], prefixArgs: ['health'] },
      'repair-plan': { summary: 'Plan session repair without executing login or live actions.', script: ['sites', 'session.mjs'], prefixArgs: ['plan-repair'] },
    },
  },
  social: {
    summary: 'X/Instagram live ops, recovery, reports, and templates.',
    commands: {
      'live-verify': { summary: 'Plan or run live acceptance verification.', script: ['..', '..', 'scripts', 'social-live-verify.mjs'] },
      'kb-refresh': { summary: 'Plan or run social scenario KB refresh.', script: ['..', '..', 'scripts', 'social-kb-refresh.mjs'] },
      resume: { summary: 'Plan or run social full-archive resume.', script: ['..', '..', 'scripts', 'social-live-resume.mjs'] },
      report: { summary: 'Aggregate social live run reports.', script: ['..', '..', 'scripts', 'social-live-report.mjs'] },
      dashboard: { summary: 'Build social live dashboard artifacts.', script: ['..', '..', 'scripts', 'social-live-dashboard.mjs'] },
      'auth-recover': { summary: 'Plan or run social auth recovery.', script: ['..', '..', 'scripts', 'social-auth-recover.mjs'] },
      'health-watch': { summary: 'Plan or run social session health watch.', script: ['..', '..', 'scripts', 'social-health-watch.mjs'] },
      templates: { summary: 'Print reusable social command templates.', script: ['..', '..', 'scripts', 'social-command-templates.mjs'] },
      'auth-import': { summary: 'Import social auth material with explicit approval flags.', script: ['sites', 'social-auth-import.mjs'] },
    },
  },
  catalog: {
    summary: 'Catalog query commands.',
    commands: {
      'jable-ranking': { summary: 'Query Jable ranking pages.', script: ['sites', 'jable-ranking.mjs'] },
      'jp-av-release': { summary: 'Collect JP AV release catalogs.', script: ['sites', 'jp-av-release-catalog.mjs'] },
      'moodyz-month': { summary: 'Collect Moodyz month catalog.', script: ['sites', 'moodyz-month-catalog.mjs'] },
    },
  },
  bilibili: {
    summary: 'Bilibili actions and navigation helpers.',
    commands: {
      action: { summary: 'Run Bilibili action router.', script: ['sites', 'bilibili-action.mjs'] },
      open: { summary: 'Open and inspect a Bilibili page.', script: ['sites', 'bilibili-open-page.mjs'] },
      'extract-links': { summary: 'Extract links from Bilibili navigation.', script: ['sites', 'bilibili-extract-links.mjs'] },
    },
  },
  douyin: {
    summary: 'Douyin actions and query helpers.',
    commands: {
      action: { summary: 'Run Douyin action router.', script: ['sites', 'douyin-action.mjs'] },
      follow: { summary: 'Query followed users or updates.', script: ['sites', 'douyin-query-follow.mjs'] },
      'resolve-media': { summary: 'Resolve Douyin media resources.', script: ['sites', 'douyin-resolve-media.mjs'] },
      'export-cookies': { summary: 'Explicitly export Douyin cookies.', script: ['sites', 'douyin-export-cookies.mjs'] },
    },
  },
  xiaohongshu: {
    summary: 'Xiaohongshu actions and query helpers.',
    commands: {
      action: { summary: 'Run Xiaohongshu action router.', script: ['sites', 'xiaohongshu-action.mjs'] },
      follow: { summary: 'Query followed users or updates.', script: ['sites', 'xiaohongshu-query-follow.mjs'] },
    },
  },
  x: {
    summary: 'X social action router.',
    commands: {
      action: { summary: 'Run X action router.', script: ['sites', 'x-action.mjs'] },
    },
  },
  instagram: {
    summary: 'Instagram social action router.',
    commands: {
      action: { summary: 'Run Instagram action router.', script: ['sites', 'instagram-action.mjs'] },
    },
  },
});

const HELP = `Usage:
  node src/entrypoints/cli.mjs build <url> [options]
  node src/entrypoints/cli.mjs skill <url> [options]
  node src/entrypoints/cli.mjs doctor <url> [options]
  node src/entrypoints/cli.mjs download plan <url-or-input> [options]
  node src/entrypoints/cli.mjs download execute <url-or-input> [options]
  node src/entrypoints/cli.mjs <domain> <command> [options]

Domains:
${Object.entries(DOMAIN_ROUTES).map(([name, route]) => `  ${name.padEnd(12)} ${route.summary}`).join('\n')}

Examples:
  node src/entrypoints/cli.mjs site doctor https://www.22biqu.com/
  node src/entrypoints/cli.mjs site capability-compile --site qidian --json
  node src/entrypoints/cli.mjs social templates --site all
  node src/entrypoints/cli.mjs catalog jp-av-release --start 2026-01-01 --end 2026-05-04
  node src/entrypoints/cli.mjs bilibili action download BV1... --dry-run
`;

function scriptPath(...segments) {
  return path.resolve(MODULE_DIR, ...segments);
}

function isHelpToken(token) {
  return token === '--help' || token === '-h';
}

function routeScript(route) {
  return scriptPath(...route.script);
}

function runNode(script, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd: process.cwd(),
      stdio: 'inherit',
      env: process.env,
      windowsHide: true,
    });
    child.once('error', reject);
    child.once('exit', (code) => resolve(code ?? 1));
  });
}

function formatDomainHelp(domainName, domain) {
  return `Usage:
  node src/entrypoints/cli.mjs ${domainName} <command> [options]

${domain.summary}

Commands:
${Object.entries(domain.commands).map(([name, route]) => `  ${name.padEnd(20)} ${route.summary}`).join('\n')}
`;
}

function dispatchForRoute(route, args = []) {
  return {
    script: routeScript(route),
    args: [...(route.prefixArgs ?? []), ...args],
  };
}

function resolveDownloadDispatch(rest) {
  const [mode, input, ...downloadRest] = rest;
  if (isHelpToken(mode)) {
    return dispatchForRoute({ script: ['sites', 'download.mjs'] }, ['--help']);
  }
  if (!mode || !['plan', 'execute'].includes(mode)) {
    throw new Error('Usage: download plan|execute <url-or-input> [options]');
  }
  if (!input || isHelpToken(input)) {
    if (isHelpToken(input)) {
      return dispatchForRoute({ script: ['sites', 'download.mjs'] }, ['--help']);
    }
    throw new Error('Usage: download plan|execute <url-or-input> [options]');
  }
  return dispatchForRoute({ script: ['sites', 'download.mjs'] }, [
    '--input',
    input,
    ...(mode === 'execute' ? ['--execute'] : []),
    ...downloadRest,
  ]);
}

function resolveDomainDispatch(domainName, rest) {
  const domain = DOMAIN_ROUTES[domainName];
  if (!domain) {
    return null;
  }
  const [command, ...args] = rest;
  if (isHelpToken(command)) {
    return { help: formatDomainHelp(domainName, domain) };
  }
  if (!command) {
    throw new Error(`Missing command for domain: ${domainName}\n\n${formatDomainHelp(domainName, domain)}`);
  }
  const route = domain.commands[command];
  if (!route) {
    throw new Error(`Unknown ${domainName} command: ${command}\n\n${formatDomainHelp(domainName, domain)}`);
  }
  return dispatchForRoute(route, args);
}

export function resolveCliDispatch(argv) {
  const [command, ...rest] = argv;
  if (!command || isHelpToken(command)) {
    return { help: HELP };
  }
  if (command === 'download') {
    return resolveDownloadDispatch(rest);
  }
  const topLevel = TOP_LEVEL_ROUTES[command];
  if (topLevel) {
    return dispatchForRoute(topLevel, rest);
  }
  const domainDispatch = resolveDomainDispatch(command, rest);
  if (domainDispatch) {
    return domainDispatch;
  }
  throw new Error(`Unknown command or domain: ${command}\n\n${HELP}`);
}

export async function main(argv = process.argv.slice(2)) {
  initializeCliUtf8();
  const dispatch = resolveCliDispatch(argv);
  if (dispatch.help) {
    process.stdout.write(`${dispatch.help}\n`);
    return 0;
  }
  return await runNode(dispatch.script, dispatch.args);
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (entryPath && entryPath === fileURLToPath(import.meta.url)) {
  main().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    process.stderr.write(`${error?.message ?? String(error)}\n`);
    process.exitCode = 1;
  });
}
