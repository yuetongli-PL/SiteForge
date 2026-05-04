// @ts-check

import {
  REDACTION_PLACEHOLDER,
  isSensitiveFieldName,
  scanForbiddenPatterns,
} from './security-guard.mjs';

export const NON_GOALS_BOUNDARY_SCHEMA_VERSION = 1;

export const NON_GOALS_BOUNDARY_OWNERS = Object.freeze([
  'Kernel',
  'CapabilityService',
  'SiteAdapter',
  'downloader',
]);

const OWNER_SET = new Set(NON_GOALS_BOUNDARY_OWNERS);

const RAW_SENSITIVE_KEY_PATTERNS = Object.freeze([
  /credential/iu,
  /authorization/iu,
  /^cookie$/iu,
  /^cookies$/iu,
  /^set-cookie$/iu,
  /csrf|xsrf/iu,
  /sessdata/iu,
  /(?:^|[_-])access[_-]?token$/iu,
  /(?:^|[_-])refresh[_-]?token$/iu,
  /(?:^|[_-])session[_-]?id$/iu,
  /session[_-]?material/iu,
  /raw[_-]?session/iu,
  /browser[_-]?profile/iu,
  /profile[_-]?path/iu,
  /user[_-]?data[_-]?dir/iu,
]);

const RAW_SENSITIVE_TEXT_PATTERNS = Object.freeze([
  /\b(?:raw\s+)?(?:credential|credentials|cookie|cookies|csrf|token|authorization\s+header|sessdata|session\s+id|session\s+material)\b/iu,
  /\b(?:browser\s+profile|browserProfile|userDataDir|profile\s+path)\b/iu,
]);

const CONCRETE_SITE_NAME_PATTERN =
  /\b(?:22biqu|bilibili|douyin|instagram|jable|moodyz|xiaohongshu|x\.com|api\.bilibili\.com|www\.douyin\.com)\b/iu;

const SITE_SEMANTIC_TEXT_PATTERN =
  /\b(?:page\s*type|endpoint|selector|parser|interpret(?:ation|er)?|classif(?:y|ication)|business\s+logic|risk\s+signal|site\s+signature|api\s+shape|field\s+mapping|pagination\s+model|semantic|semantics|meaning|validation)\b/iu;

const GENERIC_SITE_SEMANTIC_TEXT_PATTERN =
  /\b(?:concrete|specific|per-site|site-specific)\s+site\s+(?:semantic|semantics|meaning|business\s+logic|interpretation|validation)\b/iu;

const CONCRETE_SITE_IMPORT_PATTERN =
  /(?:^|[\\/])src[\\/]sites[\\/]core[\\/]adapters[\\/](?:22biqu|bilibili|douyin|instagram|jable|moodyz|x|xiaohongshu)\.mjs$/iu;

const API_AUTO_PROMOTION_TEXT_PATTERN =
  /\b(?:api|candidate|catalog|endpoint)\b.*\bauto[-_\s]?promot(?:e|ion|ed|ing)\b|\bauto[-_\s]?promot(?:e|ion|ed|ing)\b.*\b(?:api|candidate|catalog|endpoint)\b/iu;

const API_AUTO_PROMOTION_KEY_PATTERN =
  /^(?:api)?auto[-_]?promot(?:e|ion)$|^auto[-_]?promot(?:e|ion)(?:api|candidate|catalog|endpoint)$/iu;

const DOWNLOADER_RAW_SESSION_IMPORT_PATTERN =
  /(?:^|[\\/])src[\\/](?:infra[\\/]browser[\\/]session|infra[\\/]auth[\\/]site-session-governance|sites[\\/]sessions[\\/]runner|sites[\\/]downloads[\\/]session-manager)\.mjs$/iu;

const DOWNLOADER_RAW_SESSION_IMPORT_NAME_PATTERN =
  /\b(?:raw|cookie|credential|browserProfile|browser_profile|profilePath|userDataDir|sessionMaterial|rawSession)\b/iu;

const SITE_SEMANTICS_FORBIDDEN_OWNERS = new Set([
  'Kernel',
  'CapabilityService',
  'downloader',
]);

function isPlainObject(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function pathToString(path = []) {
  return path.length ? path.join('.') : '$';
}

function isRedactedValue(value) {
  if (value === undefined || value === null || value === '') {
    return true;
  }
  if (typeof value === 'string') {
    return value === REDACTION_PLACEHOLDER || value === encodeURIComponent(REDACTION_PLACEHOLDER);
  }
  if (Array.isArray(value)) {
    return value.every(isRedactedValue);
  }
  if (isPlainObject(value)) {
    return Object.values(value).every(isRedactedValue);
  }
  return false;
}

function normalizeOwner(value) {
  const owner = String(value ?? '').trim();
  if (!owner) {
    throw new Error('NonGoalsBoundary owner is required');
  }
  if (!OWNER_SET.has(owner)) {
    throw new Error(`Unknown NonGoalsBoundary owner: ${owner}`);
  }
  return owner;
}

function normalizeArray(value) {
  if (value === undefined || value === null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function normalizeImportDescriptor(value, index) {
  if (typeof value === 'string') {
    return {
      specifier: value,
      imported: [],
      path: ['imports', String(index)],
    };
  }
  if (!isPlainObject(value)) {
    return {
      specifier: '',
      imported: [],
      path: ['imports', String(index)],
    };
  }
  const imported = normalizeArray(value.imported ?? value.imports ?? value.names)
    .map((entry) => String(entry ?? '').trim())
    .filter(Boolean);
  return {
    specifier: String(value.specifier ?? value.source ?? value.from ?? value.path ?? '').trim(),
    imported,
    path: ['imports', String(index)],
  };
}

function collectWalkFields(value, path = [], fields = []) {
  if (Array.isArray(value)) {
    for (const [index, child] of value.entries()) {
      collectWalkFields(child, [...path, String(index)], fields);
    }
    return fields;
  }
  if (isPlainObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      const childPath = [...path, key];
      if (isPlainObject(child) || Array.isArray(child)) {
        fields.push({
          path: childPath,
          key,
          value: child,
        });
      }
      collectWalkFields(child, childPath, fields);
    }
    return fields;
  }
  fields.push({
    path,
    key: path[path.length - 1] ?? '<input>',
    value,
  });
  return fields;
}

function appendFinding(findings, owner, rule, path, pattern) {
  findings.push({
    owner,
    rule,
    path: pathToString(path),
    ...(pattern ? { pattern } : {}),
  });
}

function isRawSensitiveKey(key) {
  const normalized = String(key ?? '').trim();
  return isSensitiveFieldName(normalized)
    || RAW_SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(normalized));
}

function textHasRawSensitiveMaterial(text) {
  const value = String(text ?? '');
  return RAW_SENSITIVE_TEXT_PATTERNS.some((pattern) => pattern.test(value));
}

function textHasConcreteSiteSemantics(text) {
  const value = String(text ?? '');
  return GENERIC_SITE_SEMANTIC_TEXT_PATTERN.test(value)
    || (CONCRETE_SITE_NAME_PATTERN.test(value) && SITE_SEMANTIC_TEXT_PATTERN.test(value))
    || CONCRETE_SITE_IMPORT_PATTERN.test(value);
}

function keyValueIndicatesApiAutoPromotion(key, value) {
  const normalizedKey = String(key ?? '').trim();
  if (API_AUTO_PROMOTION_KEY_PATTERN.test(normalizedKey) && value === true) {
    return true;
  }
  return API_AUTO_PROMOTION_TEXT_PATTERN.test(normalizedKey)
    || (typeof value === 'string' && API_AUTO_PROMOTION_TEXT_PATTERN.test(value));
}

function scanFields({ owner, root, basePath, findings }) {
  for (const field of collectWalkFields(root, basePath)) {
    const value = field.value;
    if (isRawSensitiveKey(field.key) && !isRedactedValue(value)) {
      appendFinding(findings, owner, 'raw-sensitive-material', field.path, 'sensitive-field-name');
      continue;
    }

    if (typeof value === 'string' && textHasRawSensitiveMaterial(value) && !isRedactedValue(value)) {
      appendFinding(findings, owner, 'raw-sensitive-material', field.path, 'raw-sensitive-text');
    }

    if (
      SITE_SEMANTICS_FORBIDDEN_OWNERS.has(owner)
      && (textHasConcreteSiteSemantics(field.key) || textHasConcreteSiteSemantics(value))
    ) {
      appendFinding(findings, owner, 'concrete-site-semantics', field.path, 'site-semantics');
    }

    if (keyValueIndicatesApiAutoPromotion(field.key, value)) {
      appendFinding(findings, owner, 'api-auto-promotion', field.path, 'api-auto-promotion');
    }
  }

  for (const finding of scanForbiddenPatterns(root)) {
    appendFinding(
      findings,
      owner,
      'raw-sensitive-material',
      [...basePath, ...String(finding.path ?? '').split('.').filter(Boolean)],
      finding.pattern ?? 'forbidden-sensitive-pattern',
    );
  }
}

function scanImports({ owner, imports, findings }) {
  for (const [index, rawImport] of normalizeArray(imports).entries()) {
    const entry = normalizeImportDescriptor(rawImport, index);
    if (!entry.specifier) {
      appendFinding(findings, owner, 'invalid-import-descriptor', entry.path, 'missing-specifier');
      continue;
    }

    if (
      SITE_SEMANTICS_FORBIDDEN_OWNERS.has(owner)
      && textHasConcreteSiteSemantics(entry.specifier)
    ) {
      appendFinding(findings, owner, 'concrete-site-semantics', [...entry.path, 'specifier'], 'site-import');
    }

    if (
      owner === 'downloader'
      && DOWNLOADER_RAW_SESSION_IMPORT_PATTERN.test(entry.specifier)
    ) {
      appendFinding(findings, owner, 'downloader-raw-session-read', [...entry.path, 'specifier'], 'raw-session-import');
    }

    for (const [nameIndex, importedName] of entry.imported.entries()) {
      const namePath = [...entry.path, 'imported', String(nameIndex)];
      if (owner === 'downloader' && DOWNLOADER_RAW_SESSION_IMPORT_NAME_PATTERN.test(importedName)) {
        appendFinding(findings, owner, 'downloader-raw-session-read', namePath, 'raw-session-import-name');
      }
      if (keyValueIndicatesApiAutoPromotion(importedName, importedName)) {
        appendFinding(findings, owner, 'api-auto-promotion', namePath, 'api-auto-promotion-import');
      }
    }
  }
}

export function scanNonGoalBoundary(descriptor = {}) {
  if (!isPlainObject(descriptor)) {
    throw new Error('NonGoalsBoundary descriptor must be an object');
  }
  const owner = normalizeOwner(descriptor.owner ?? descriptor.layer ?? descriptor.boundary);
  const findings = [];

  scanFields({
    owner,
    root: normalizeArray(descriptor.responsibility ?? descriptor.responsibilities),
    basePath: ['responsibilities'],
    findings,
  });
  scanFields({
    owner,
    root: descriptor.payload ?? {},
    basePath: ['payload'],
    findings,
  });
  scanImports({
    owner,
    imports: descriptor.imports ?? [],
    findings,
  });

  return {
    schemaVersion: NON_GOALS_BOUNDARY_SCHEMA_VERSION,
    owner,
    findings,
    allowed: findings.length === 0,
  };
}

export function assertNonGoalBoundary(descriptor = {}) {
  const result = scanNonGoalBoundary(descriptor);
  if (!result.allowed) {
    const error = new Error(
      `NonGoalsBoundary violation: ${result.findings.map((finding) => finding.rule).join(', ')}`,
    );
    error.code = 'non-goal-boundary-violation';
    error.owner = result.owner;
    error.findings = result.findings;
    throw error;
  }
  return result;
}
