// @ts-check

import {
  createRuntimeProviderRegistryWith,
} from '../provider-registry.mjs';
import {
  attachProviderManifest,
} from '../provider-sdk/index.mjs';
import {
  API_READ_PROVIDER_ID,
  createApiReadProvider,
} from './api-read-provider.mjs';
import {
  DOWNLOAD_PROVIDER_ID,
  createDownloadProvider,
} from './download-provider.mjs';
import {
  BROWSER_ACTION_PROVIDER_ID,
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

/** @param {Record<string, any>} options */
function productionManifest({
  providerId,
  capabilityKinds,
  supportedOperations,
  sideEffects = 'none',
  runtimeServices = {},
  riskProfile = {},
}) {
  return {
    schemaVersion: 'provider.manifest.v1',
    providerId,
    capabilityKinds,
    supportedOperations,
    riskProfile: {
      sideEffects,
      requiresControlledRuntime: riskProfile.requiresControlledRuntime === true,
      requiresAuthAdapter: riskProfile.requiresAuthAdapter === true,
      allowedAuthMaterialTypes: riskProfile.allowedAuthMaterialTypes ?? [],
      allowedInjectionTargets: riskProfile.allowedInjectionTargets ?? [],
    },
    runtimeServices: {
      requiresOutputWriter: runtimeServices.requiresOutputWriter === true,
      requiresBrowserRuntime: runtimeServices.requiresBrowserRuntime === true,
      requiresNetwork: runtimeServices.requiresNetwork === true,
      requiresSessionMaterial: false,
    },
    resultPolicy: {
      allowRawHeaders: false,
      allowRawBody: false,
      allowRawCookies: false,
      allowRawTokens: false,
    },
  };
}

export function createProductionRuntimeProviders(options = {}) {
  return [
    attachProviderManifest(createApiReadProvider(), productionManifest({
      providerId: API_READ_PROVIDER_ID,
      capabilityKinds: ['api', 'read', 'query', 'search'],
      supportedOperations: ['read', 'query'],
      sideEffects: 'none',
      runtimeServices: {
        requiresNetwork: true,
      },
      riskProfile: {
        requiresAuthAdapter: true,
        allowedAuthMaterialTypes: ['ephemeral-http-auth'],
      },
    })),
    attachProviderManifest(createDownloadProvider(), productionManifest({
      providerId: DOWNLOAD_PROVIDER_ID,
      capabilityKinds: ['download', 'export'],
      supportedOperations: ['download', 'export'],
      sideEffects: 'bounded',
      runtimeServices: {
        requiresOutputWriter: true,
        requiresNetwork: true,
      },
      riskProfile: {
        requiresAuthAdapter: true,
        allowedAuthMaterialTypes: ['ephemeral-http-auth'],
      },
    })),
    attachProviderManifest(createBrowserActionProvider({
      browserRuntimeDeps: options.browserRuntimeDeps,
    }), productionManifest({
      providerId: BROWSER_ACTION_PROVIDER_ID,
      capabilityKinds: ['write', 'submit'],
      supportedOperations: ['write', 'submit', 'form_or_action'],
      sideEffects: 'external_write',
      runtimeServices: {
        requiresBrowserRuntime: true,
      },
      riskProfile: {
        requiresControlledRuntime: true,
        requiresAuthAdapter: true,
        allowedAuthMaterialTypes: ['browser-context-cookie-descriptor'],
        allowedInjectionTargets: ['browser_context'],
      },
    })),
  ];
}

export function createProductionRuntimeProviderRegistry(options = {}) {
  return createRuntimeProviderRegistryWith(createProductionRuntimeProviders(options), {
    production: true,
  });
}
