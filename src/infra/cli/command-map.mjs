// @ts-check

import {
  publicBooleanBuildFlagSet,
  publicValueBuildFlagMap,
} from './public-build-contract.mjs';

export const UNIFIED_CLI_ENTRYPOINT = 'siteforge';

const PUBLIC_BOOLEAN_BUILD_FLAGS = publicBooleanBuildFlagSet();
const PUBLIC_VALUE_BUILD_FLAGS = publicValueBuildFlagMap();

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
  return [UNIFIED_CLI_ENTRYPOINT, ...args.map((arg) => String(arg))];
}

export function unifiedCliCommand(args = []) {
  const normalizedArgs = args.map((arg) => String(arg));
  if (normalizedArgs[0] === 'build' && normalizedArgs.length >= 2 && !normalizedArgs[1].startsWith('-')) {
    return formatCommand(unifiedCliArgv(normalizedArgs));
  }
  throw new Error('Public SiteForge CLI only supports: siteforge build <url> [flags]');
}

export function capabilitiesCliCommand(args = []) {
  return formatCommand(['node', 'src/entrypoints/operator/capabilities.mjs', ...args.map((arg) => String(arg))]);
}

export function capabilityConfirmCommand(skillId, args = []) {
  return capabilitiesCliCommand(['confirm', skillId, ...args]);
}

export function capabilityListCommand(skillId, args = []) {
  return capabilitiesCliCommand(['list', skillId, ...args]);
}

export function capabilityDisableCommand(skillId, args = []) {
  return capabilitiesCliCommand(['disable', skillId, ...args]);
}

export function buildCliCommand(inputUrl) {
  return unifiedCliCommand(['build', inputUrl]);
}

function validatePublicBuildCommandArgs(args = []) {
  for (let index = 0; index < args.length; index += 1) {
    const token = String(args[index]);
    if (!token.startsWith('--')) {
      continue;
    }
    const flagName = token.split('=')[0];
    if (PUBLIC_BOOLEAN_BUILD_FLAGS.has(flagName)) {
      if (token.includes('=')) {
        throw new Error(`Public build flag does not take a value: ${flagName}`);
      }
      continue;
    }
    const allowedValues = PUBLIC_VALUE_BUILD_FLAGS.get(flagName);
    if (allowedValues) {
      const inlineValue = token.includes('=') ? token.slice(flagName.length + 1) : null;
      const value = inlineValue ?? args[index + 1];
      if (!value || String(value).startsWith('--')) {
        throw new Error(`Missing value for public build flag: ${flagName}`);
      }
      if (!allowedValues.includes(String(value))) {
        throw new Error(`${flagName} must be one of: ${allowedValues.join(', ')}`);
      }
      if (inlineValue === null) {
        index += 1;
      }
      continue;
    }
    throw new Error(`Command map cannot generate unsupported public build flag: ${flagName}`);
  }
}

export function unifiedCliArgsForScript(scriptPath) {
  const normalized = normalizeScriptPath(scriptPath);
  if (normalized === 'src/entrypoints/pipeline/run-pipeline.mjs') {
    return ['build'];
  }
  return null;
}

export function unifiedCliCommandForScript(scriptPath, args = []) {
  const normalizedScript = normalizeScriptPath(scriptPath);
  const prefix = unifiedCliArgsForScript(normalizedScript);
  if (prefix) {
    return unifiedCliCommand([...prefix, ...args]);
  }
  return formatCommand(['node', normalizedScript, ...args]);
}

export function displayCommandForExecutable(command, args = []) {
  const executable = String(command ?? '');
  const normalizedArgs = args.map((arg) => String(arg));
  const scriptArg = normalizedArgs[0];
  if (!scriptArg || !/node(?:\.exe)?$/iu.test(executable.replace(/\\/gu, '/'))) {
    return formatCommand([executable, ...normalizedArgs]);
  }
  return unifiedCliCommandForScript(scriptArg, normalizedArgs.slice(1));
}

export function siteDoctorCommand(inputUrl, args = []) {
  return formatCommand(['node', 'src/entrypoints/sites/site-doctor.mjs', inputUrl, ...args]);
}

export function siteLoginCommand(inputUrl, args = []) {
  return formatCommand(['node', 'src/entrypoints/sites/site-login.mjs', inputUrl, ...args]);
}

export function sessionRepairPlanCommand(args = []) {
  return formatCommand(['node', 'src/entrypoints/sites/session-repair-plan.mjs', ...args]);
}

export function siteCapabilityCompileCommand(args = []) {
  return formatCommand(['node', 'src/entrypoints/sites/site-capability-compile.mjs', ...args]);
}

export function downloadCliCommand({
  mode = 'plan',
  input = null,
  site = null,
  args = [],
} = {}) {
  const normalizedArgs = args.map((arg) => String(arg));
  if (site !== null && site !== undefined && String(site) !== '') {
    return actionCliCommand(site, [
      'download',
      ...(input !== null && input !== undefined && String(input) !== '' ? [String(input)] : []),
      ...normalizedArgs,
    ]);
  }
  const commandArgs = ['build'];
  if (input !== null && input !== undefined && String(input) !== '') {
    commandArgs.push(String(input));
  }
  if (mode === 'execute') {
    commandArgs.push('--auto');
  }
  commandArgs.push(...normalizedArgs);
  validatePublicBuildCommandArgs(commandArgs.slice(1));
  return unifiedCliCommand(commandArgs);
}

export function actionCliCommand(site, args = []) {
  const siteKey = String(site ?? '').toLowerCase();
  const script = siteKey === 'instagram'
    ? 'src/entrypoints/sites/instagram-action.mjs'
    : siteKey === 'x'
      ? 'src/entrypoints/sites/x-action.mjs'
      : `src/entrypoints/sites/${siteKey}-action.mjs`;
  return formatCommand(['node', script, ...args]);
}
