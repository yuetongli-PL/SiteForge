// @ts-check

export const SECURITY_GUARD_SCHEMA_VERSION = 1;
export const REDACTION_PLACEHOLDER = '[REDACTED]';

const SENSITIVE_KEY_PATTERNS = Object.freeze([
  /authorization/iu,
  /^cookie$/iu,
  /^set-cookie$/iu,
  /csrf|xsrf/iu,
  /sessdata/iu,
  /xsec[_-]?token/iu,
  /(?:^|[_-])access[_-]?token$/iu,
  /(?:^|[_-])refresh[_-]?token$/iu,
  /(?:^|[_-])session[_-]?id$/iu,
  /browser[_-]?profile/iu,
  /profile[_-]?path/iu,
  /user[_-]?data[_-]?dir/iu,
  /^cookies$/iu,
  /session[_-]?material/iu,
  /raw[_-]?session[_-]?lease/iu,
  /device[_-]?fingerprint/iu,
]);

const FORBIDDEN_VALUE_PATTERNS = Object.freeze([
  {
    name: 'authorization-bearer',
    pattern: /Bearer\s+[A-Za-z0-9._~+/-]+=*/u,
  },
  {
    name: 'sessdata-assignment',
    pattern: /SESSDATA=[^;\s&]+/iu,
  },
  {
    name: 'sensitive-query-assignment',
    pattern: /(?:access_token|refresh_token|xsec_token|csrf(?:_token)?|session(?:_id)?)=(?!\[REDACTED\]|%5BREDACTED%5D)[^&\s;]+/iu,
  },
  {
    name: 'cookie-header',
    pattern: /\bcookie\s*[:=]\s*(?!\[REDACTED\]|%5BREDACTED%5D)[^;\s&]+/iu,
  },
  {
    name: 'session-reference',
    pattern: /\b(?:session[_-]?ref|session[_-]?id|sid)\s*[:=]\s*(?!\[REDACTED\]|%5BREDACTED%5D)[A-Za-z0-9._~+/-]+/iu,
  },
  {
    name: 'profile-reference',
    pattern: /\b(?:profile[_-]?ref|profile[_-]?path|browser[_-]?profile|user[_-]?data[_-]?dir)\s*[:=]\s*(?!\[REDACTED\]|%5BREDACTED%5D)[^,;\r\n]+/iu,
  },
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

export function isSensitiveFieldName(name) {
  const normalized = String(name ?? '').trim();
  return normalized
    ? SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(normalized))
    : false;
}

function createAudit() {
  return {
    schemaVersion: SECURITY_GUARD_SCHEMA_VERSION,
    redactedPaths: [],
    redactions: [],
    findings: [],
  };
}

function appendRedaction(audit, path, {
  reason = 'sensitive-field-name',
  pattern,
} = {}) {
  const entry = {
    path: pathToString(path),
    reason,
  };
  if (pattern) {
    entry.pattern = pattern;
  }
  audit.redactedPaths.push(entry.path);
  audit.redactions.push(entry);
}

function redactSensitiveText(value, path, audit) {
  let text = String(value ?? '');
  for (const { name, pattern } of FORBIDDEN_VALUE_PATTERNS) {
    while (pattern.test(text)) {
      text = text.replace(pattern, REDACTION_PLACEHOLDER);
      audit.findings.push({
        path: pathToString(path),
        pattern: name,
      });
      appendRedaction(audit, path, {
        reason: 'forbidden-pattern',
        pattern: name,
      });
    }
  }
  return text;
}

function redactValueInternal(value, path, audit) {
  if (Array.isArray(value)) {
    return value.map((item, index) => redactValueInternal(item, [...path, String(index)], audit));
  }
  if (!isPlainObject(value)) {
    return typeof value === 'string'
      ? redactSensitiveText(value, path, audit)
      : value;
  }

  const output = {};
  for (const [key, child] of Object.entries(value)) {
    const childPath = [...path, key];
    if (isSensitiveFieldName(key)) {
      output[key] = REDACTION_PLACEHOLDER;
      appendRedaction(audit, childPath);
      continue;
    }
    output[key] = redactValueInternal(child, childPath, audit);
  }
  return output;
}

export function redactValue(value) {
  const audit = createAudit();
  return {
    value: redactValueInternal(value, [], audit),
    audit,
  };
}

export function redactHeaders(headers = {}) {
  const audit = createAudit();
  const output = {};
  for (const [key, value] of Object.entries(headers ?? {})) {
    const path = ['headers', key];
    if (isSensitiveFieldName(key)) {
      output[key] = REDACTION_PLACEHOLDER;
      appendRedaction(audit, path);
      continue;
    }
    output[key] = typeof value === 'string'
      ? redactSensitiveText(value, path, audit)
      : value;
  }
  return {
    headers: output,
    audit,
  };
}

export function redactUrl(input) {
  const audit = createAudit();
  const raw = String(input ?? '');
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return {
      url: redactSensitiveText(raw, ['url'], audit),
      audit,
    };
  }

  if (parsed.username) {
    parsed.username = REDACTION_PLACEHOLDER;
    appendRedaction(audit, ['url', 'username'], {
      reason: 'url-userinfo',
    });
  }
  if (parsed.password) {
    parsed.password = REDACTION_PLACEHOLDER;
    appendRedaction(audit, ['url', 'password'], {
      reason: 'url-userinfo',
    });
  }
  for (const key of [...parsed.searchParams.keys()]) {
    if (!isSensitiveFieldName(key)) {
      continue;
    }
    parsed.searchParams.set(key, REDACTION_PLACEHOLDER);
    appendRedaction(audit, ['url', 'query', key], {
      reason: 'sensitive-query-param',
    });
  }
  return {
    url: parsed.toString(),
    audit,
  };
}

export function redactBody(body) {
  if (typeof body !== 'string') {
    const { value, audit } = redactValue(body);
    return {
      body: value,
      audit,
    };
  }

  const trimmed = body.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(body);
      const { value, audit } = redactValue(parsed);
      return {
        body: JSON.stringify(value),
        audit,
      };
    } catch {
      // Fall back to text redaction below.
    }
  }

  const audit = createAudit();
  return {
    body: redactSensitiveText(body, ['body'], audit),
    audit,
  };
}

export function redactError(error = {}) {
  const { value, audit } = redactValue({
    name: error?.name,
    code: error?.code,
    message: error?.message,
    stack: error?.stack,
  });
  return {
    error: value,
    audit,
  };
}

function scanForbiddenValues(value, path, findings) {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      scanForbiddenValues(item, [...path, String(index)], findings);
    }
    return;
  }
  if (isPlainObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      scanForbiddenValues(child, [...path, key], findings);
    }
    return;
  }
  if (typeof value !== 'string') {
    return;
  }
  for (const { name, pattern } of FORBIDDEN_VALUE_PATTERNS) {
    if (pattern.test(value)) {
      findings.push({
        path: pathToString(path),
        pattern: name,
      });
    }
  }
}

export function scanForbiddenPatterns(value) {
  const findings = [];
  scanForbiddenValues(value, [], findings);
  return findings;
}

export function assertNoForbiddenPatterns(value) {
  const findings = scanForbiddenPatterns(value);
  if (findings.length) {
    const error = new Error('Forbidden sensitive pattern detected');
    error.code = 'redaction-failed';
    error.findings = findings;
    throw error;
  }
  return true;
}

export function prepareRedactedArtifactJson(value, { space = 2 } = {}) {
  const redacted = redactValue(value);
  const json = JSON.stringify(redacted.value, null, space);
  assertNoForbiddenPatterns(json);
  return {
    json,
    value: redacted.value,
    audit: redacted.audit,
  };
}

export function prepareRedactedArtifactJsonWithAudit(value, options = {}) {
  const prepared = prepareRedactedArtifactJson(value, options);
  const preparedAudit = prepareRedactedArtifactJson(prepared.audit, options);
  return {
    ...prepared,
    auditJson: preparedAudit.json,
    auditValue: preparedAudit.value,
  };
}
