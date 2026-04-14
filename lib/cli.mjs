// @ts-check

import process from 'node:process';

export function initializeCliUtf8() {
  process.env.PYTHONIOENCODING ??= 'utf-8';
  process.env.PYTHONUTF8 ??= '1';
  for (const stream of [process.stdout, process.stderr]) {
    if (typeof stream?.setDefaultEncoding === 'function') {
      try {
        stream.setDefaultEncoding('utf8');
      } catch {
        // Ignore unsupported streams.
      }
    }
  }
}

export function writeJsonStdout(payload) {
  initializeCliUtf8();
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}
