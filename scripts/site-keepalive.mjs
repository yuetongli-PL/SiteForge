// @ts-check

export * from '../src/entrypoints/sites/site-keepalive.mjs';
import * as _module from '../src/entrypoints/sites/site-keepalive.mjs';
import { runNodeEntrypointShim } from '../src/entrypoints/node-entrypoint-shim.mjs';

export default _module.default;

runNodeEntrypointShim(import.meta, '../src/entrypoints/sites/site-keepalive.mjs');
