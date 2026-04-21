// @ts-check

export * from '../src/entrypoints/sites/site-credentials.mjs';
import * as _module from '../src/entrypoints/sites/site-credentials.mjs';
import { runNodeEntrypointShim } from '../src/entrypoints/node-entrypoint-shim.mjs';

export default _module.default;

runNodeEntrypointShim(import.meta, '../src/entrypoints/sites/site-credentials.mjs');
