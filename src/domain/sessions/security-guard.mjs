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
  /^token$/iu,
  /(?:^|[_-])token$/iu,
  /^x[_-]?auth[_-]?token$/iu,
  /^x[_-]?api[_-]?key$/iu,
  /^api[_-]?key$/iu,
  /secret/iu,
  /^password$/iu,
  /raw[_-]?(?:body|headers?)/iu,
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

const SENSITIVE_BODY_KEY_PATTERNS = Object.freeze([
  /^auth$/iu,
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
    pattern: /(?:access_token|refresh_token|xsec_token|csrf(?:_token)?|session(?:_id)?|token|auth|api[_-]?key|secret|password)=(?!\[REDACTED\]|%5BREDACTED%5D)[^&\s;]+/iu,
  },
  {
    name: 'sensitive-json-assignment',
    pattern: /"(?:token|api[_-]?key|secret|password|raw[_-]?body)"\s*:\s*"(?!\[REDACTED\]|%5BREDACTED%5D)[^"]+"/iu,
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

const IPV4_HOST_PATTERN = /^(?:\d{1,3}\.){3}\d{1,3}$/u;
const PUBLIC_IDENTIFIER_TEXT_PATTERNS = Object.freeze([
  {
    name: 'email-address',
    pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu,
    replacement: '[REDACTED_EMAIL]',
  },
  {
    name: 'ip-address',
    pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/gu,
    replacement: '[REDACTED_IP]',
  },
  {
    name: 'profile-path',
    pattern: /(?:[A-Za-z]:\\|\/Users\/|\/home\/|AppData\\|BrowserProfile|browser[_-]?profile|user[_-]?data[_-]?dir)[^\s?#'"]*/giu,
    replacement: '[REDACTED_PATH]',
  },
  {
    name: 'account-label',
    pattern: /\b(?:my\s+account|profile|signed\s+in\s+as|logged\s+in\s+as|account\s+for|user\s+account)\s*[:=-]?\s*[^/?#&|,;]{1,80}/giu,
    replacement: '[REDACTED_ACCOUNT]',
  },
  {
    name: 'script-reference',
    pattern: /\b[\w.-]+\.(?:mjs|cjs|cmd|bat|ps1|sh|exe|dll)\b/giu,
    replacement: '[REDACTED_REF]',
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

function redactBodySpecificKeys(value, path, audit) {
  if (Array.isArray(value)) {
    return value.map((item, index) => redactBodySpecificKeys(item, [...path, String(index)], audit));
  }
  if (!isPlainObject(value)) {
    return value;
  }
  const output = {};
  for (const [key, child] of Object.entries(value)) {
    const childPath = [...path, key];
    if (SENSITIVE_BODY_KEY_PATTERNS.some((pattern) => pattern.test(key))) {
      output[key] = REDACTION_PLACEHOLDER;
      appendRedaction(audit, childPath);
      continue;
    }
    output[key] = redactBodySpecificKeys(child, childPath, audit);
  }
  return output;
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

export function redactPublicIdentifierText(value, {
  path = ['text'],
  maxLength,
} = {}) {
  const audit = createAudit();
  let text = redactSensitiveText(String(value ?? ''), path, audit);
  for (const { name, pattern, replacement } of PUBLIC_IDENTIFIER_TEXT_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) {
      pattern.lastIndex = 0;
      text = text.replace(pattern, replacement);
      audit.findings.push({
        path: pathToString(path),
        pattern: name,
      });
      appendRedaction(audit, path, {
        reason: 'public-identifier-pattern',
        pattern: name,
      });
    }
  }
  const boundedLength = Number(maxLength);
  return {
    value: Number.isFinite(boundedLength) && boundedLength > 0
      ? text.slice(0, boundedLength)
      : text,
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
  if (IPV4_HOST_PATTERN.test(parsed.hostname)) {
    parsed.hostname = 'redacted-ip.invalid';
    appendRedaction(audit, ['url', 'hostname'], {
      reason: 'url-ip-host',
    });
  }
  for (const key of [...parsed.searchParams.keys()]) {
    if (!isSensitiveFieldName(key) && !/^auth$/iu.test(key)) {
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
    const bodyValue = redactBodySpecificKeys(value, ['body'], audit);
    return {
      body: bodyValue,
      audit,
    };
  }

  const trimmed = body.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(body);
      const { value, audit } = redactValue(parsed);
      const bodyValue = redactBodySpecificKeys(value, ['body'], audit);
      return {
        body: JSON.stringify(bodyValue),
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
  const normalizedPath = path.map((part) => String(part ?? '').toLowerCase());
  const lastPath = normalizedPath.at(-1) ?? '';
  const hasBodyContainer = normalizedPath.some((part) => /^(?:body|rawbody|raw_body)$/u.test(part));
  if (
    hasBodyContainer
    && lastPath === 'auth'
    && value !== REDACTION_PLACEHOLDER
    && value !== encodeURIComponent(REDACTION_PLACEHOLDER)
  ) {
    findings.push({
      path: pathToString(path),
      pattern: 'sensitive-body-auth-field',
    });
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
  assertNoForbiddenPatterns(redacted.value);
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
