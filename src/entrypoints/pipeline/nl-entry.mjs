// @ts-check

export * from '../../app/pipeline/stages/nl.mjs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { runCli } from '../../app/pipeline/stages/nl.mjs';

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (entryPath && entryPath === fileURLToPath(import.meta.url)) {
  await runCli();
}
