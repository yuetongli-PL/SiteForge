// @ts-check

export * from '../../pipeline/stages/expand.mjs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { runCli } from '../../pipeline/stages/expand.mjs';

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (entryPath && entryPath === fileURLToPath(import.meta.url)) {
  await runCli();
}
