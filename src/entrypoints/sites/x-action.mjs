// @ts-check

import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { runSocialActionCli } from '../../sites/known-sites/social/actions/router.mjs';

export { runSocialActionCli as runXActionCli };

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (entryPath && entryPath === fileURLToPath(import.meta.url)) {
  runSocialActionCli(process.argv.slice(2), { site: 'x' }).catch((error) => {
    console.error(error?.message ?? String(error));
    process.exitCode = 1;
  });
}
