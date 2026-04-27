// @ts-check

import { runNodeEntrypointShim } from '../src/entrypoints/node-entrypoint-shim.mjs';

runNodeEntrypointShim(import.meta, '../src/entrypoints/sites/download.mjs');
