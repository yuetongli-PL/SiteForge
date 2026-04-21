// @ts-check

import {
  classifyJableModelsPath as classifyJableModelsPathFromAdapter,
  isJableModelsDetailPath as isJableModelsDetailPathFromAdapter,
  isJableModelsListPath as isJableModelsListPathFromAdapter,
} from './adapters/jable.mjs';

export function classifyJableModelsPath(pathname) {
  return classifyJableModelsPathFromAdapter(pathname);
}

export function isJableModelsListPath(pathname) {
  return isJableModelsListPathFromAdapter(pathname);
}

export function isJableModelsDetailPath(pathname) {
  return isJableModelsDetailPathFromAdapter(pathname);
}
