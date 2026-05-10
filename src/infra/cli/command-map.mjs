// @ts-check

export const UNIFIED_CLI_ENTRYPOINT = 'src/entrypoints/cli.mjs';

const SCRIPT_TO_UNIFIED_ARGS = new Map([
  ['src/entrypoints/pipeline/run-pipeline.mjs', ['build']],
  ['src/entrypoints/pipeline/generate-skill.mjs', ['skill']],
  ['src/entrypoints/sites/download.mjs', ['download']],
  ['src/entrypoints/sites/site-doctor.mjs', ['site', 'doctor']],
  ['src/entrypoints/sites/site-capability-compile.mjs', ['site', 'capability-compile']],
  ['src/entrypoints/sites/site-login.mjs', ['site', 'login']],
  ['src/entrypoints/sites/site-keepalive.mjs', ['site', 'keepalive']],
  ['src/entrypoints/sites/site-scaffold.mjs', ['site', 'scaffold']],
  ['src/entrypoints/sites/site-credentials.mjs', ['site', 'credentials']],
  ['src/entrypoints/sites/nl-site-login.mjs', ['site', 'nl-login']],
  ['src/entrypoints/sites/session-repair-plan.mjs', ['site', 'repair-plan']],
  ['src/entrypoints/sites/session.mjs', ['session']],
  ['scripts/social-live-verify.mjs', ['social', 'live-verify']],
  ['scripts/social-kb-refresh.mjs', ['social', 'kb-refresh']],
  ['scripts/social-live-resume.mjs', ['social', 'resume']],
  ['scripts/social-live-report.mjs', ['social', 'report']],
  ['scripts/social-live-dashboard.mjs', ['social', 'dashboard']],
  ['scripts/social-auth-recover.mjs', ['social', 'auth-recover']],
  ['scripts/social-health-watch.mjs', ['social', 'health-watch']],
  ['scripts/social-command-templates.mjs', ['social', 'templates']],
  ['src/entrypoints/sites/social-auth-import.mjs', ['social', 'auth-import']],
  ['src/entrypoints/sites/jable-ranking.mjs', ['catalog', 'jable-ranking']],
  ['src/entrypoints/sites/jp-av-release-catalog.mjs', ['catalog', 'jp-av-release']],
  ['src/entrypoints/sites/moodyz-month-catalog.mjs', ['catalog', 'moodyz-month']],
  ['src/entrypoints/sites/bilibili-action.mjs', ['bilibili', 'action']],
  ['src/entrypoints/sites/bilibili-open-page.mjs', ['bilibili', 'open']],
  ['src/entrypoints/sites/bilibili-extract-links.mjs', ['bilibili', 'extract-links']],
  ['src/entrypoints/sites/douyin-action.mjs', ['douyin', 'action']],
  ['src/entrypoints/sites/douyin-query-follow.mjs', ['douyin', 'follow']],
  ['src/entrypoints/sites/douyin-resolve-media.mjs', ['douyin', 'resolve-media']],
  ['src/entrypoints/sites/douyin-export-cookies.mjs', ['douyin', 'export-cookies']],
  ['src/entrypoints/sites/xiaohongshu-action.mjs', ['xiaohongshu', 'action']],
  ['src/entrypoints/sites/xiaohongshu-query-follow.mjs', ['xiaohongshu', 'follow']],
  ['src/entrypoints/sites/x-action.mjs', ['x', 'action']],
  ['src/entrypoints/sites/instagram-action.mjs', ['instagram', 'action']],
]);

function normalizeScriptPath(scriptPath) {
  return String(scriptPath ?? '').replace(/\\/gu, '/').replace(/^\.\//u, '');
}

export function quoteCommandArg(value) {
  const text = String(value ?? '');
  if (/^[A-Za-z0-9_./:@=\\<>-]+$/u.test(text)) {
    return text;
  }
  return `"${text.replace(/"/gu, '\\"')}"`;
}

export function formatCommand(argv = []) {
  return argv.map(quoteCommandArg).join(' ');
}

export function unifiedCliArgv(args = []) {
  return ['node', UNIFIED_CLI_ENTRYPOINT, ...args.map((arg) => String(arg))];
}

export function unifiedCliCommand(args = []) {
  return formatCommand(unifiedCliArgv(args));
}

export function unifiedCliArgsForScript(scriptPath) {
  return SCRIPT_TO_UNIFIED_ARGS.get(normalizeScriptPath(scriptPath)) ?? null;
}

export function unifiedCliCommandForScript(scriptPath, args = []) {
  const prefix = unifiedCliArgsForScript(scriptPath);
  if (!prefix) {
    return formatCommand(['node', normalizeScriptPath(scriptPath), ...args]);
  }
  if (normalizeScriptPath(scriptPath) === 'src/entrypoints/sites/download.mjs') {
    return downloadCliCommandFromLegacyArgs(args);
  }
  if (normalizeScriptPath(scriptPath) === 'src/entrypoints/sites/session.mjs') {
    return sessionCliCommandFromLegacyArgs(args);
  }
  return unifiedCliCommand([...prefix, ...args]);
}

export function siteDoctorCommand(inputUrl, args = []) {
  return unifiedCliCommand(['site', 'doctor', inputUrl, ...args]);
}

export function siteLoginCommand(inputUrl, args = []) {
  return unifiedCliCommand(['site', 'login', inputUrl, ...args]);
}

export function sessionRepairPlanCommand(args = []) {
  return unifiedCliCommand(['site', 'repair-plan', ...args]);
}

export function siteCapabilityCompileCommand(args = []) {
  return unifiedCliCommand(['site', 'capability-compile', ...args]);
}

export function downloadCliCommand({
  mode = 'plan',
  input = null,
  site = null,
  args = [],
} = {}) {
  const normalizedMode = mode === 'execute' ? 'execute' : 'plan';
  const commandArgs = ['download', normalizedMode];
  if (input !== null && input !== undefined && String(input) !== '') {
    commandArgs.push(String(input));
  }
  if (site !== null && site !== undefined && String(site) !== '') {
    commandArgs.push('--site', String(site));
  }
  commandArgs.push(...args.map((arg) => String(arg)));
  return unifiedCliCommand(commandArgs);
}

export function actionCliCommand(site, args = []) {
  const siteKey = String(site ?? '').toLowerCase();
  if (siteKey === 'x') return unifiedCliCommand(['x', 'action', ...args]);
  if (siteKey === 'instagram') return unifiedCliCommand(['instagram', 'action', ...args]);
  return unifiedCliCommand([siteKey, 'action', ...args]);
}

export function displayCommandForExecutable(command, args = []) {
  const executable = String(command ?? '');
  const normalizedArgs = args.map((arg) => String(arg));
  const scriptArg = normalizedArgs[0];
  if (!scriptArg || !/node(?:\.exe)?$/iu.test(executable.replace(/\\/gu, '/'))) {
    return formatCommand([executable, ...normalizedArgs]);
  }
  if (normalizeScriptPath(scriptArg) === 'src/entrypoints/sites/download.mjs') {
    return unifiedCliCommandForScript(scriptArg, normalizedArgs.slice(1));
  }
  if (normalizeScriptPath(scriptArg) === 'src/entrypoints/sites/session.mjs') {
    return unifiedCliCommandForScript(scriptArg, normalizedArgs.slice(1));
  }
  const unifiedPrefix = unifiedCliArgsForScript(scriptArg);
  if (!unifiedPrefix) {
    return formatCommand(['node', ...normalizedArgs]);
  }
  return unifiedCliCommand([...unifiedPrefix, ...normalizedArgs.slice(1)]);
}

function downloadCliCommandFromLegacyArgs(args = []) {
  const rest = args.map((arg) => String(arg));
  let input = null;
  let site = null;
  let mode = rest.includes('--execute') ? 'execute' : 'plan';
  const passthrough = [];
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === '--execute') {
      mode = 'execute';
      continue;
    }
    if (arg === '--input') {
      input = rest[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (arg === '--site') {
      site = rest[index + 1] ?? null;
      index += 1;
      continue;
    }
    passthrough.push(arg);
  }
  return downloadCliCommand({ mode, input, site, args: passthrough });
}

function sessionCliCommandFromLegacyArgs(args = []) {
  const rest = args.map((arg) => String(arg));
  const [mode, ...passthrough] = rest;
  if (!mode || mode.startsWith('-') || mode === 'health') {
    const commandArgs = mode === 'health' ? passthrough : rest;
    return unifiedCliCommand(['session', 'health', ...commandArgs]);
  }
  if (mode === 'plan-repair') {
    return unifiedCliCommand(['session', 'repair-plan', ...passthrough]);
  }
  return unifiedCliCommand(['session', ...rest]);
}
