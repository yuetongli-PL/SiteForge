// @ts-check

import {
  createRuntimeProviderRegistryWith,
} from '../provider-registry.mjs';
import {
  createApiReadProvider,
} from './api-read-provider.mjs';
import {
  createDownloadProvider,
} from './download-provider.mjs';
import {
  createBrowserActionProvider,
} from './browser-action-provider.mjs';

export {
  API_READ_PROVIDER_ID,
  createApiReadProvider,
} from './api-read-provider.mjs';
export {
  DOWNLOAD_PROVIDER_ID,
  createDownloadProvider,
} from './download-provider.mjs';
export {
  BROWSER_ACTION_PROVIDER_ID,
  createBrowserActionProvider,
} from './browser-action-provider.mjs';

export function createProductionRuntimeProviders(options = {}) {
  return [
    createApiReadProvider(),
    createDownloadProvider(),
    createBrowserActionProvider({
      browserRuntimeDeps: options.browserRuntimeDeps,
    }),
  ];
}

export function createProductionRuntimeProviderRegistry(options = {}) {
  return createRuntimeProviderRegistryWith(createProductionRuntimeProviders(options));
}
