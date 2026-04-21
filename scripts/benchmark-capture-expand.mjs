// @ts-check

export * from '../tools/benchmark-capture-expand.mjs';
import * as _module from '../tools/benchmark-capture-expand.mjs';
import { runNodeEntrypointShim } from '../src/entrypoints/node-entrypoint-shim.mjs';

export default _module.default;

runNodeEntrypointShim(import.meta, '../tools/benchmark-capture-expand.mjs');
