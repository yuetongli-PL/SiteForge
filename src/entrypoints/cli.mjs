// @ts-check

import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { initializeCliUtf8 } from '../infra/cli.mjs';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

const HELP = `Usage:
  node src/entrypoints/cli.mjs build <url> [options]
  node src/entrypoints/cli.mjs skill <url> [options]
  node src/entrypoints/cli.mjs doctor <url> [options]
  node src/entrypoints/cli.mjs download plan <url-or-input> [options]
  node src/entrypoints/cli.mjs download execute <url-or-input> [options]
`;

function scriptPath(...segments) {
  return path.join(MODULE_DIR, ...segments);
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

export function resolveCliDispatch(argv) {
  const [command, ...rest] = argv;
  if (!command || command === '--help' || command === '-h') {
    return { help: true };
  }
  if (command === 'build') {
    return {
      script: scriptPath('pipeline', 'run-pipeline.mjs'),
      args: rest,
    };
  }
  if (command === 'skill') {
    return {
      script: scriptPath('pipeline', 'generate-skill.mjs'),
      args: rest,
    };
  }
  if (command === 'doctor') {
    return {
      script: scriptPath('sites', 'site-doctor.mjs'),
      args: rest,
    };
  }
  if (command === 'download') {
    const [mode, input, ...downloadRest] = rest;
    if (!['plan', 'execute'].includes(mode) || !input) {
      throw new Error('Usage: download plan|execute <url-or-input> [options]');
    }
    return {
      script: scriptPath('sites', 'download.mjs'),
      args: [
        '--input',
        input,
        ...(mode === 'execute' ? ['--execute'] : []),
        ...downloadRest,
      ],
    };
  }
  throw new Error(`Unknown command: ${command}`);
}

export async function main(argv = process.argv.slice(2)) {
  initializeCliUtf8();
  const dispatch = resolveCliDispatch(argv);
  if (dispatch.help) {
    process.stdout.write(`${HELP}\n`);
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
