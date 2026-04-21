// @ts-check

import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export function runNodeEntrypointShim(importMeta, relativeTargetPath, { fallbackExitCode = 1 } = {}) {
  const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
  if (!entryPath || entryPath !== fileURLToPath(importMeta.url)) {
    return false;
  }

  const targetPath = fileURLToPath(new URL(relativeTargetPath, importMeta.url));
  const child = spawn(process.execPath, [targetPath, ...process.argv.slice(2)], {
    stdio: 'inherit',
    cwd: process.cwd(),
  });

  child.on('error', (error) => {
    console.error(error?.message ?? String(error));
    process.exitCode = 1;
  });

  child.on('exit', (code, signal) => {
    if (typeof code === 'number') {
      process.exitCode = code;
      return;
    }
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exitCode = fallbackExitCode;
  });

  return true;
}
