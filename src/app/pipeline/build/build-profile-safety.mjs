// @ts-check

const SENSITIVE_BUILD_PROFILE_KEYS = new Set([
  'access_token',
  'accesstoken',
  'authorization',
  'authorizationheader',
  'authheader',
  'authheaders',
  'authruntime',
  'browserprofile',
  'browserprofileroot',
  'cookie',
  'cookieenv',
  'cookiefile',
  'cookieheader',
  'cookies',
  'cookiestdin',
  'csrf',
  'header',
  'headers',
  'localstorage',
  'pathprofile',
  'profilepath',
  'refresh_token',
  'refreshtoken',
  'session_id',
  'sessionid',
  'sessionstorage',
  'setcookie',
  'sessdata',
  'sid',
  'token',
  'tokens',
  'user_data_dir',
  'userdatadir',
]);

const SENSITIVE_BUILD_PROFILE_VALUE_PATTERN = /\b(?:authorization\s*:|cookie\s*:|bearer\s+[a-z0-9._~+/=-]{6,}|(?:sid|session|sessionid|uid|token|access_token|refresh_token|cookie)\s*=\s*[^;\s]+)/iu;
const STORAGE_OR_PROFILE_VALUE_PATTERN = /\b(?:localStorage|sessionStorage|userDataDir)\b/u;

function normalizeKey(key) {
  return String(key ?? '').replace(/[-_\s]/gu, '').toLowerCase();
}

function pathFor(parts) {
  return parts.length ? parts.join('.') : '<root>';
}

export function findSensitiveBuildProfileKeys(value, pathParts = /** @type {string[]} */ ([])) {
  if (!value || typeof value !== 'object') {
    return [];
  }
  const hits = /** @type {string[]} */ ([]);
  for (const [key, item] of Object.entries(value)) {
    const nextPath = [...pathParts, key];
    if (SENSITIVE_BUILD_PROFILE_KEYS.has(normalizeKey(key))) {
      hits.push(pathFor(nextPath));
      continue;
    }
    hits.push(...findSensitiveBuildProfileKeys(item, nextPath));
  }
  return hits;
}

export function findSensitiveBuildProfileValues(value, pathParts = /** @type {string[]} */ ([])) {
  if (typeof value === 'string') {
    return SENSITIVE_BUILD_PROFILE_VALUE_PATTERN.test(value) || STORAGE_OR_PROFILE_VALUE_PATTERN.test(value)
      ? [pathFor(pathParts)]
      : [];
  }
  if (!value || typeof value !== 'object') {
    return [];
  }
  const hits = /** @type {string[]} */ ([]);
  for (const [key, item] of Object.entries(value)) {
    hits.push(...findSensitiveBuildProfileValues(item, [...pathParts, key]));
  }
  return hits;
}

export function findSensitiveBuildProfileMaterial(profile) {
  return {
    keys: findSensitiveBuildProfileKeys(profile),
    values: findSensitiveBuildProfileValues(profile),
  };
}

export function assertBuildProfileSafe(profile) {
  const sensitive = findSensitiveBuildProfileMaterial(profile);
  if (sensitive.keys.length) {
    throw new Error(`build_profile.json contains sensitive fields: ${sensitive.keys.join(', ')}`);
  }
  if (sensitive.values.length) {
    throw new Error(`build_profile.json contains sensitive values at: ${sensitive.values.join(', ')}`);
  }
}

export function isBuildProfileSafe(profile) {
  try {
    assertBuildProfileSafe(profile);
    return true;
  } catch {
    return false;
  }
}
