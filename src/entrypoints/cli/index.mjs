#!/usr/bin/env node
// @ts-check

import path from 'node:path';
import process from 'node:process';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { initializeCliUtf8 } from '../../infra/cli.mjs';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

const HELP = `Usage:
  siteforge build <url> [flags]

Examples:
  siteforge build https://example.com/
  siteforge build https://example.com/ --auto --privacy limited --report user

Flags:
  --auto
  --manual
  --deep
  --network
  --privacy limited|strict
  --explain
  --report user|debug|both
  --verbose
  --debug
`;

const BUILD_FLAGS_WITH_VALUE = new Set([
  '--privacy',
  '--report',
  '--progress',
  '--capability',
  '--capabilities',
  '--browser-path',
  '--browser-profile-root',
  '--user-data-dir',
  '--timeout',
  '--wait-until',
  '--idle-ms',
  '--max-triggers',
  '--max-captured-states',
  '--search-query',
  '--book-title',
  '--book-url',
  '--chapter-fetch-concurrency',
  '--examples',
  '--capture-out-dir',
  '--expanded-out-dir',
  '--book-content-out-dir',
  '--analysis-out-dir',
  '--abstraction-out-dir',
  '--nl-entry-out-dir',
  '--docs-out-dir',
  '--governance-out-dir',
  '--capability-compile-out-dir',
  '--capability-intent',
  '--kb-dir',
  '--skill-out-dir',
  '--skill-name',
  '--metadata-config-dir',
  '--site-metadata-config-dir',
  '--metadata-runtime-dir',
  '--site-metadata-runtime-dir',
  '--strict',
]);

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

function dispatchForRoute(route, args = []) {
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

function validateBuildArgs(args) {
  let url = null;
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (isHelpToken(token)) {
      return { help: true };
    }
    if (String(token).startsWith('--')) {
      const flagName = splitFlagName(token);
      if (BUILD_FLAGS_WITH_VALUE.has(flagName) && !String(token).includes('=')) {
        index += 1;
        if (index >= args.length) {
          throw new Error(`Missing value for ${flagName}\n\n${HELP}`);
        }
      }
      continue;
    }
    if (url !== null) {
      throw new Error(`Unsupported argument: ${token}\n\n${HELP}`);
    }
    url = token;
  }
  if (!url) {
    return { help: true };
  }
  return { help: false, url };
}

export function resolveCliDispatch(argv) {
  const [command, ...rest] = argv;
  if (!command || isHelpToken(command)) {
    return { help: HELP };
  }
  if (command === 'build') {
    const validation = validateBuildArgs(rest);
    if (validation.help) {
      return { help: HELP };
    }
    return dispatchForRoute({ fromEntrypointsRoot: true, script: ['pipeline', 'run-pipeline.mjs'] }, rest);
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
