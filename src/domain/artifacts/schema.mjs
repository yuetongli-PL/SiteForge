// @ts-check

export const ARTIFACT_REFERENCE_SET_SCHEMA_VERSION = 1;
export const ARTIFACT_REFERENCE_SET_COMPATIBLE_SCHEMA_VERSIONS = Object.freeze([
  ARTIFACT_REFERENCE_SET_SCHEMA_VERSION,
]);
export const ARTIFACT_REFERENCE_SET_SCHEMA_COMPATIBILITY = Object.freeze({
  name: 'ArtifactReferenceSet',
  currentVersion: ARTIFACT_REFERENCE_SET_SCHEMA_VERSION,
  compatibleVersions: ARTIFACT_REFERENCE_SET_COMPATIBLE_SCHEMA_VERSIONS,
});
export const MANIFEST_ARTIFACT_BUNDLE_SCHEMA_VERSION = 1;
export const MANIFEST_ARTIFACT_BUNDLE_COMPATIBLE_SCHEMA_VERSIONS = Object.freeze([
  MANIFEST_ARTIFACT_BUNDLE_SCHEMA_VERSION,
]);
export const MANIFEST_ARTIFACT_BUNDLE_SCHEMA_COMPATIBILITY = Object.freeze({
  name: 'ManifestArtifactBundle',
  currentVersion: MANIFEST_ARTIFACT_BUNDLE_SCHEMA_VERSION,
  compatibleVersions: MANIFEST_ARTIFACT_BUNDLE_COMPATIBLE_SCHEMA_VERSIONS,
});

function isPlainObject(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function normalizeArtifactReferenceMap(value = {}) {
  const result = {};
  if (!isPlainObject(value)) {
    return result;
  }
  for (const [key, raw] of Object.entries(value)) {
    if (key === 'schemaVersion' || raw === undefined || raw === null || raw === '') {
      continue;
    }
    if (isPlainObject(raw)) {
      const nested = normalizeArtifactReferenceMap(raw);
      if (Object.keys(nested).length > 0) {
        result[key] = nested;
      }
      continue;
    }
    if (Array.isArray(raw)) {
      continue;
    }
    result[key] = String(raw);
  }
  return result;
}

function assertArtifactReferenceMapCompatible(value = {}, path = 'artifacts') {
  if (!isPlainObject(value)) {
    throw new Error(`${path} must be an object`);
  }
  for (const [key, entry] of Object.entries(value)) {
    if (key === 'schemaVersion') {
      continue;
    }
    const entryPath = `${path}.${key}`;
    if (isPlainObject(entry)) {
      assertArtifactReferenceMapCompatible(entry, entryPath);
      continue;
    }
    if (typeof entry !== 'string') {
      throw new Error(`${entryPath} must be a string artifact reference`);
    }
  }
}

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizePositiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : undefined;
}

export function normalizeArtifactReferenceSet(value = {}) {
  return {
    schemaVersion: ARTIFACT_REFERENCE_SET_SCHEMA_VERSION,
    ...normalizeArtifactReferenceMap(value),
  };
}

export function isArtifactReferenceSetSchemaVersionCompatible(value) {
  const version = Number(value);
  return Number.isInteger(version)
    && ARTIFACT_REFERENCE_SET_COMPATIBLE_SCHEMA_VERSIONS.includes(version);
}

export function assertArtifactReferenceSetCompatible(value = {}) {
  if (!isPlainObject(value)) {
    throw new Error('ArtifactReferenceSet must be an object');
  }
  if (value.schemaVersion === undefined || value.schemaVersion === null) {
    throw new Error('ArtifactReferenceSet schemaVersion is required');
  }
  if (!isArtifactReferenceSetSchemaVersionCompatible(value.schemaVersion)) {
    throw new Error(
      `ArtifactReferenceSet schemaVersion ${value.schemaVersion} is not compatible with ${ARTIFACT_REFERENCE_SET_SCHEMA_VERSION}`,
    );
  }
  assertArtifactReferenceMapCompatible(value);
  return true;
}

export function normalizeManifestArtifactBundle(value = {}) {
  const source = isPlainObject(value) ? value : {};
  const manifestName = normalizeText(source.manifestName ?? source.name);
  const manifestPath = normalizeText(source.manifestPath ?? source.manifest);
  const manifestSchemaVersion = normalizePositiveInteger(source.manifestSchemaVersion);
  const artifacts = normalizeArtifactReferenceSet(source.artifacts);
  const result = {
    schemaVersion: MANIFEST_ARTIFACT_BUNDLE_SCHEMA_VERSION,
    manifestName,
    manifestSchemaVersion,
    manifestPath,
    artifacts,
  };
  return Object.fromEntries(
    Object.entries(result).filter(([, entry]) => entry !== undefined && entry !== ''),
  );
}

export function normalizeManifestArtifactBundleFromManifest(manifest = {}, options = {}) {
  const source = isPlainObject(manifest) ? manifest : {};
  const overrides = isPlainObject(options) ? options : {};
  return normalizeManifestArtifactBundle({
    manifestName: overrides.manifestName ?? overrides.name ?? source.manifestName ?? source.name,
    manifestSchemaVersion: overrides.manifestSchemaVersion ?? source.schemaVersion,
    manifestPath: overrides.manifestPath ?? overrides.manifest ?? source.artifacts?.manifest,
    artifacts: overrides.artifacts ?? source.artifacts,
  });
}

export function isManifestArtifactBundleSchemaVersionCompatible(value) {
  const version = Number(value);
  return Number.isInteger(version)
    && MANIFEST_ARTIFACT_BUNDLE_COMPATIBLE_SCHEMA_VERSIONS.includes(version);
}

export function assertManifestArtifactBundleCompatible(value = {}) {
  if (!isPlainObject(value)) {
    throw new Error('ManifestArtifactBundle must be an object');
  }
  if (value.schemaVersion === undefined || value.schemaVersion === null) {
    throw new Error('ManifestArtifactBundle schemaVersion is required');
  }
  if (!isManifestArtifactBundleSchemaVersionCompatible(value.schemaVersion)) {
    throw new Error(
      `ManifestArtifactBundle schemaVersion ${value.schemaVersion} is not compatible with ${MANIFEST_ARTIFACT_BUNDLE_SCHEMA_VERSION}`,
    );
  }
  if (normalizeText(value.manifestName) === '') {
    throw new Error('ManifestArtifactBundle manifestName is required');
  }
  if (!Number.isInteger(Number(value.manifestSchemaVersion)) || Number(value.manifestSchemaVersion) <= 0) {
    throw new Error('ManifestArtifactBundle manifestSchemaVersion must be a positive integer');
  }
  if (normalizeText(value.manifestPath) === '') {
    throw new Error('ManifestArtifactBundle manifestPath is required');
  }
  assertArtifactReferenceSetCompatible(value.artifacts);
  return true;
}
