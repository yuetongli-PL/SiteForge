// @ts-check

import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { runXiaohongshuFollowQueryCli } from '../../sites/known-sites/xiaohongshu/queries/follow-query.mjs';

export { runXiaohongshuFollowQueryCli };

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (entryPath && entryPath === fileURLToPath(import.meta.url)) {
  runXiaohongshuFollowQueryCli().catch((error) => {
    console.error(error?.message ?? String(error));
    process.exitCode = 1;
  });
}
