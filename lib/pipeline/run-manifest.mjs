import path from 'node:path';

const LEGACY_SOURCE_FIELD_MAP = Object.freeze({
  analysis: Object.freeze({ manifest: 'analysisManifest', dir: 'analysisDir' }),
  abstraction: Object.freeze({ manifest: 'abstractionManifest', dir: 'abstractionDir' }),
  docs: Object.freeze({ manifest: 'docsManifest', dir: 'docsDir' }),
  nlEntry: Object.freeze({ manifest: 'nlEntryManifest', dir: 'nlEntryDir' }),
  expandedStates: Object.freeze({ manifest: 'statesManifest', dir: 'expandedStatesDir' }),
  bookContent: Object.freeze({ manifest: 'bookContentManifest', dir: 'bookContentDir' }),
  examples: Object.freeze({ path: 'examplesPath', used: 'usedExamples' }),
  stateSelection: Object.freeze({ analyzedStateIds: 'analyzedStateIds', skippedStateIds: 'skippedStateIds' }),
  flags: Object.freeze({ usedFallbackEvidence: 'usedFallbackEvidence' }),
});

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function omitUndefinedEntries(record) {
  if (!isPlainObject(record)) {
    return {};
  }
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined));
}

function normalizeArtifactEntry(entry) {
  const normalized = omitUndefinedEntries(entry);
  return Object.keys(normalized).length ? normalized : null;
}

function normalizeUpstream(upstream) {
  if (!isPlainObject(upstream)) {
    return {};
  }

  const normalized = {};
  for (const [key, entry] of Object.entries(upstream)) {
    const normalizedEntry = normalizeArtifactEntry(entry);
    if (normalizedEntry) {
      normalized[key] = normalizedEntry;
    }
  }
  return normalized;
}

function buildLegacySourceFromUpstream(upstream) {
  const legacySource = {};

  for (const [artifactName, artifact] of Object.entries(upstream)) {
    const fieldMap = LEGACY_SOURCE_FIELD_MAP[artifactName];
    if (!fieldMap || !isPlainObject(artifact)) {
      continue;
    }
    for (const [field, legacyKey] of Object.entries(fieldMap)) {
      if (artifact[field] !== undefined) {
        legacySource[legacyKey] = artifact[field];
      }
    }
  }

  return legacySource;
}

function resolveMaybeRelativePath(value, baseDir) {
  if (!value) {
    return null;
  }
  if (path.isAbsolute(value)) {
    return value;
  }
  return path.resolve(baseDir ?? '.', value);
}

export function buildRunManifest({
  inputUrl = null,
  baseUrl = null,
  generatedAt = null,
  outDir,
  summary,
  files,
  warnings = [],
  upstream = {},
  legacySource = {},
  extra = {},
}) {
  const run = omitUndefinedEntries({ inputUrl, baseUrl, generatedAt });
  const normalizedUpstream = normalizeUpstream(upstream);
  const source = omitUndefinedEntries({
    ...buildLegacySourceFromUpstream(normalizedUpstream),
    ...legacySource,
  });

  return omitUndefinedEntries({
    ...omitUndefinedEntries(extra),
    run: Object.keys(run).length ? run : undefined,
    inputUrl,
    baseUrl,
    generatedAt,
    outDir,
    upstream: Object.keys(normalizedUpstream).length ? normalizedUpstream : undefined,
    source: Object.keys(source).length ? source : undefined,
    summary,
    files,
    warnings,
  });
}

export function getManifestRunContext(manifest, fallback = {}) {
  return {
    inputUrl: manifest?.run?.inputUrl ?? manifest?.inputUrl ?? fallback.inputUrl ?? null,
    baseUrl: manifest?.run?.baseUrl ?? manifest?.baseUrl ?? fallback.baseUrl ?? null,
    generatedAt: manifest?.run?.generatedAt ?? manifest?.generatedAt ?? fallback.generatedAt ?? null,
  };
}

export function getManifestArtifact(manifest, artifactName) {
  const upstream = normalizeArtifactEntry(manifest?.upstream?.[artifactName]) ?? {};
  const fieldMap = LEGACY_SOURCE_FIELD_MAP[artifactName];
  const legacy = {};

  if (fieldMap && isPlainObject(manifest?.source)) {
    for (const [field, legacyKey] of Object.entries(fieldMap)) {
      if (manifest.source[legacyKey] !== undefined) {
        legacy[field] = manifest.source[legacyKey];
      }
    }
  }

  const merged = { ...legacy, ...upstream };
  return Object.keys(merged).length ? merged : null;
}

export function getManifestArtifactValue(manifest, artifactName, field, fallback = null) {
  return getManifestArtifact(manifest, artifactName)?.[field] ?? fallback;
}

export function getManifestArtifactPath(manifest, artifactName, field, baseDir) {
  return resolveMaybeRelativePath(getManifestArtifactValue(manifest, artifactName, field), baseDir);
}

export function getManifestArtifactDir(manifest, artifactName, baseDir) {
  const explicitDir = getManifestArtifactPath(manifest, artifactName, 'dir', baseDir);
  if (explicitDir) {
    return explicitDir;
  }

  const manifestPath = getManifestArtifactPath(manifest, artifactName, 'manifest', baseDir);
  return manifestPath ? path.dirname(manifestPath) : null;
}
