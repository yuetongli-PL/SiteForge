#!/usr/bin/env node
// @ts-check

import path from 'node:path';
import process from 'node:process';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { initializeCliUtf8 } from '../../infra/cli.mjs';
import {
  PUBLIC_BUILD_COMMAND,
  PUBLIC_BUILD_HELP,
  acceptedBooleanBuildFlagSet,
  acceptedEnumValueBuildFlagMap,
  acceptedStringValueBuildFlagSet,
} from './public-build-contract.mjs';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

const HELP = PUBLIC_BUILD_HELP;
const ACCEPTED_BOOLEAN_BUILD_FLAGS = acceptedBooleanBuildFlagSet();
const ACCEPTED_ENUM_VALUE_BUILD_FLAGS = acceptedEnumValueBuildFlagMap();
const ACCEPTED_STRING_VALUE_BUILD_FLAGS = acceptedStringValueBuildFlagSet();

function scriptPath(...segments) {
  return path.resolve(MODULE_DIR, ...segments);
}

function entrypointScriptPath(...segments) {
  return path.resolve(MODULE_DIR, '..', ...segments);
}

function isHelpToken(token) {
  return token === '--help' || token === '-h';
}

function routeScript(route) {
  return route.fromEntrypointsRoot
    ? entrypointScriptPath(...route.script)
    : scriptPath(...route.script);
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

function dispatchForRoute(route, args = /** @type {any[]} */ ([])) {
  return {
    script: routeScript(route),
    args: [...(route.prefixArgs ?? []), ...args],
  };
}

function canonicalEntrypointPath(filePath) {
  const resolved = path.resolve(filePath);
  try {
    return realpathSync.native(resolved);
  } catch {
    return resolved;
  }
}

function isExecutedEntrypoint(argvPath, moduleUrl) {
  if (!argvPath) {
    return false;
  }
  return canonicalEntrypointPath(argvPath) === canonicalEntrypointPath(fileURLToPath(moduleUrl));
}

function splitFlagName(token) {
  return String(token ?? '').split('=')[0];
}

function errorWithHelp(message) {
  throw new Error(`${message}\n\n${HELP}`);
}

function validatePublicBuildUrl(input) {
  let parsed;
  try {
    parsed = new URL(input);
  } catch {
    errorWithHelp(`Invalid URL: ${input}`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    errorWithHelp(`Unsupported URL protocol: ${parsed.protocol}`);
  }
  if (parsed.username || parsed.password) {
    errorWithHelp('URL must not include credentials');
  }
}

function validateBuildFlagValuePresence(flagName, value) {
  if (!value || value.startsWith('-')) {
    errorWithHelp(`Missing value for ${flagName}`);
  }
}

function validateBuildEnumFlagValue(flagName, value) {
  validateBuildFlagValuePresence(flagName, value);
  const allowedValues = ACCEPTED_ENUM_VALUE_BUILD_FLAGS.get(flagName);
  if (!allowedValues.includes(value)) {
    errorWithHelp(`${flagName} must be one of: ${allowedValues.join(', ')}`);
  }
}

function consumeOptionalBuildFlagValue(args, index) {
  const next = args[index + 1];
  return next && !String(next).startsWith('--') ? index + 1 : index;
}

function validateBuildArgs(args) {
  let url = null;
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (isHelpToken(token)) {
      return { help: true };
    }
    if (String(token).startsWith('--')) {
      const flagName = splitFlagName(token);
      if (flagName === '--confirm-destructive') {
        index = String(token).includes('=') ? index : consumeOptionalBuildFlagValue(args, index);
        continue;
      }
      if (ACCEPTED_BOOLEAN_BUILD_FLAGS.has(flagName)) {
        if (String(token).includes('=')) {
          errorWithHelp(`Flag does not take a value: ${flagName}`);
        }
        continue;
      }
      if (ACCEPTED_ENUM_VALUE_BUILD_FLAGS.has(flagName)) {
        if (String(token).includes('=')) {
          validateBuildEnumFlagValue(flagName, String(token).slice(flagName.length + 1));
          continue;
        }
        index += 1;
        if (index >= args.length) {
          errorWithHelp(`Missing value for ${flagName}`);
        }
        validateBuildEnumFlagValue(flagName, String(args[index]));
        continue;
      }
      if (ACCEPTED_STRING_VALUE_BUILD_FLAGS.has(flagName)) {
        if (String(token).includes('=')) {
          validateBuildFlagValuePresence(flagName, String(token).slice(flagName.length + 1));
          continue;
        }
        index += 1;
        if (index >= args.length) {
          errorWithHelp(`Missing value for ${flagName}`);
        }
        validateBuildFlagValuePresence(flagName, String(args[index]));
        continue;
      }
      errorWithHelp(`Unknown flag: ${flagName}`);
    }
    if (String(token).startsWith('-')) {
      errorWithHelp(`Unknown flag: ${token}`);
    }
    if (url !== null) {
      errorWithHelp(`Unsupported argument: ${token}`);
    }
    url = token;
  }
  if (url === null) {
    return { help: true };
  }
  validatePublicBuildUrl(url);
  return { help: false, url };
}

export function resolveCliDispatch(argv) {
  const [command, ...rest] = argv;
  if (!command || isHelpToken(command)) {
    return { help: HELP };
  }
  if (command === PUBLIC_BUILD_COMMAND) {
    const validation = validateBuildArgs(rest);
    if (validation.help) {
      return { help: HELP };
    }
    return dispatchForRoute({ fromEntrypointsRoot: true, script: ['build', 'run-build.mjs'] }, rest);
  }
  throw new Error(`Unknown command: ${command}\n\n${HELP}`);
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

if (isExecutedEntrypoint(process.argv[1], import.meta.url)) {
  main().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    process.stderr.write(`${error?.message ?? String(error)}\n`);
    process.exitCode = 1;
  });
}
