import {
  SITE_CAPABILITY_COMPILER_SCHEMA_VERSION,
  createStaticSiteCompileManifest,
} from '../../../src/app/compiler/index.mjs';

export function createCompileScope(overrides = /** @type {any} */ ({})) {
  return {
    schemaVersion: SITE_CAPABILITY_COMPILER_SCHEMA_VERSION,
    coverageMode: 'declared_only',
    coverageCompleteness: 'partial',
    allowedCaptureModes: ['static'],
    sourceTypes: ['site-registry', 'site-capabilities', 'synthetic-fixture'],
    redactionRequired: true,
    ...overrides,
  };
}

export function createCompileRequest(overrides = /** @type {any} */ ({})) {
  return {
    schemaVersion: SITE_CAPABILITY_COMPILER_SCHEMA_VERSION,
    siteId: 'site:synthetic.example',
    siteKey: 'synthetic.example',
    url: 'https://synthetic.example/public/123',
    compileScope: createCompileScope(),
    sourceTypes: ['site-registry', 'site-capabilities', 'synthetic-fixture'],
    redactionRequired: true,
    ...overrides,
  };
}

export function createSyntheticCapabilityConfig(overrides = /** @type {any} */ ({})) {
  return {
    siteKey: 'synthetic.example',
    capabilities: [
      {
        capabilityKey: 'open-public-page',
        normalizedIntent: 'open-page',
        capabilityFamily: 'navigate-to-author',
        supportedTaskTypes: ['open-page'],
        routeKey: 'public-page',
        routeKind: 'page',
        urlPattern: 'https://synthetic.example/public/:id',
        pageType: 'public-detail',
        mode: 'readOnly',
        agentExposed: true,
        requiresApproval: false,
        priority: 10,
      },
    ],
    ...overrides,
  };
}

export function createSyntheticCompileManifest(overrides = /** @type {any} */ ({})) {
  return createStaticSiteCompileManifest({
    request: createCompileRequest(),
    registrySite: {
      siteKey: 'synthetic.example',
      adapterId: 'synthetic-adapter',
    },
    capabilityConfig: createSyntheticCapabilityConfig(),
    adapterMetadata: {
      adapterId: 'synthetic-adapter',
    },
    ...overrides,
  });
}
