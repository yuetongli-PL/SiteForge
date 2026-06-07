// @ts-check

export const CAPABILITY_PACKAGE_SCHEMA_VERSION = 'site.capability_package.v1';
export const CAPABILITY_PACKAGE_REGISTRY_ENTRY_SCHEMA_VERSION = 1;
export const CAPABILITY_PACKAGE_DIFF_SCHEMA_VERSION = 1;
export const CAPABILITY_PACKAGE_COMPATIBILITY_SCHEMA_VERSION = 1;
export const CAPABILITY_PACKAGE_PROVENANCE_SCHEMA_VERSION = 1;
export const SITE_ADAPTER_REGISTRY_SCHEMA_VERSION = 1;

export const CAPABILITY_PACKAGE_OPERATION_KINDS = Object.freeze([
  'navigate',
  'api_read',
  'download',
  'form_or_action',
]);

export const CAPABILITY_PACKAGE_RISK_LEVELS = Object.freeze([
  'public_read',
  'auth_read',
  'ordinary_write',
  'destructive',
  'payment',
]);

export const CAPABILITY_PACKAGE_PROVIDER_COMPATIBILITY_VALUES = Object.freeze([
  'api_read_provider',
  'download_provider',
  'browser_action_provider',
]);

export const CAPABILITY_PACKAGE_SCHEMA_DEFINITIONS = Object.freeze([
  Object.freeze({
    name: 'SiteCapabilityPackageManifest',
    version: CAPABILITY_PACKAGE_SCHEMA_VERSION,
    sourcePath: 'src/domain/capability-packages/capability-package-schema.mjs',
  }),
  Object.freeze({
    name: 'CapabilityPackageRegistryEntry',
    version: CAPABILITY_PACKAGE_REGISTRY_ENTRY_SCHEMA_VERSION,
    sourcePath: 'src/domain/capability-packages/capability-package-schema.mjs',
  }),
  Object.freeze({
    name: 'CapabilityPackageDiff',
    version: CAPABILITY_PACKAGE_DIFF_SCHEMA_VERSION,
    sourcePath: 'src/domain/capability-packages/capability-package-schema.mjs',
  }),
  Object.freeze({
    name: 'CapabilityPackageCompatibility',
    version: CAPABILITY_PACKAGE_COMPATIBILITY_SCHEMA_VERSION,
    sourcePath: 'src/domain/capability-packages/capability-package-schema.mjs',
  }),
  Object.freeze({
    name: 'SiteAdapterRegistry',
    version: SITE_ADAPTER_REGISTRY_SCHEMA_VERSION,
    sourcePath: 'src/domain/capability-packages/capability-package-schema.mjs',
  }),
]);

export function listCapabilityPackageSchemaDefinitions() {
  return CAPABILITY_PACKAGE_SCHEMA_DEFINITIONS.map((definition) => ({ ...definition }));
}
