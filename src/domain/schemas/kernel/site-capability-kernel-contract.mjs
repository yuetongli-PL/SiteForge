// @ts-check

export const KERNEL_CONTRACT_SCHEMA_VERSION = 1;

export const KERNEL_ALLOWED_RESPONSIBILITY_IDS = Object.freeze([
  'task-lifecycle-orchestration',
  'execution-context-governance',
  'artifact-governance',
  'schema-governance',
  'reason-code-governance',
  'lifecycle-governance',
]);

const KERNEL_ALLOWED_RESPONSIBILITIES = Object.freeze([
  responsibility({
    id: 'task-lifecycle-orchestration',
    label: 'Task lifecycle orchestration',
    domain: 'orchestration',
  }),
  responsibility({
    id: 'execution-context-governance',
    label: 'Execution context governance',
    domain: 'context',
  }),
  responsibility({
    id: 'artifact-governance',
    label: 'Artifact governance',
    domain: 'artifact',
  }),
  responsibility({
    id: 'schema-governance',
    label: 'Schema governance',
    domain: 'schema',
  }),
  responsibility({
    id: 'reason-code-governance',
    label: 'Reason code governance',
    domain: 'reason',
  }),
  responsibility({
    id: 'lifecycle-governance',
    label: 'Lifecycle governance',
    domain: 'lifecycle',
  }),
]);

const ALLOWED_BY_ID = new Map(
  KERNEL_ALLOWED_RESPONSIBILITIES.map((entry) => [entry.id, entry]),
);

const RESPONSIBILITY_ALIASES = Object.freeze(new Map([
  ['orchestration', 'task-lifecycle-orchestration'],
  ['task-lifecycle', 'task-lifecycle-orchestration'],
  ['task-lifecycle-orchestration', 'task-lifecycle-orchestration'],
  ['execution-context', 'execution-context-governance'],
  ['execution-context-governance', 'execution-context-governance'],
  ['context', 'execution-context-governance'],
  ['context-governance', 'execution-context-governance'],
  ['artifact', 'artifact-governance'],
  ['artifact-governance', 'artifact-governance'],
  ['schema', 'schema-governance'],
  ['schema-governance', 'schema-governance'],
  ['reason', 'reason-code-governance'],
  ['reason-code', 'reason-code-governance'],
  ['reason-code-governance', 'reason-code-governance'],
  ['reasoncode', 'reason-code-governance'],
  ['lifecycle', 'lifecycle-governance'],
  ['lifecycle-governance', 'lifecycle-governance'],
]));

const FORBIDDEN_KERNEL_RESPONSIBILITY_CHECKS = Object.freeze([
  forbiddenCheck({
    category: 'concrete site semantics',
    owner: 'SiteAdapter',
    patterns: [
      /\b(?:22biqu|bilibili|douyin|instagram|jable|moodyz|xiaohongshu)\b/iu,
      /\b(?:concrete|specific|per-site|site-specific)\s+site\s+(?:semantic|semantics|meaning|business\s+logic)\b/iu,
      /\b(?:page\s*type|auth\s*state|risk\s*signal|site\s*signature|business\s*interface)\s+(?:interpretation|classification|meaning|judgment|handling)\b/iu,
    ],
  }),
  forbiddenCheck({
    category: 'raw credential or session material handling',
    owner: 'SecurityGuard/SessionProvider',
    keyPatterns: [
      /^(?:cookie|cookies|csrf|csrftoken|token|accesstoken|refreshtoken|authorization|authheader|sessdata|sessionid|sessionids)$/iu,
      /^(?:rawcredential|rawcredentials|rawcookiejar|rawsession|rawsessionmaterial|sessionmaterial|browserprofile|browserprofilepath)$/iu,
    ],
    patterns: [
      /\b(?:raw\s+)?(?:cookie|cookies|csrf|token|authorization\s+header|sessdata|session\s+id|session\s+material|credential|credentials)\s+(?:handling|reader|read|manager|storage|owner|governance)\b/iu,
      /\bbrowser\s+profile\s+(?:handling|reader|path|owner|storage|governance)\b/iu,
    ],
  }),
  forbiddenCheck({
    category: 'downloader execution',
    owner: 'downloader',
    patterns: [
      /\bdownloader\s+(?:execution|executor|run|runner|download|media\s+fetch)\b/iu,
      /\b(?:execute|run|perform|fetch)\s+(?:the\s+)?(?:download|downloader|media\s+download)\b/iu,
    ],
  }),
  forbiddenCheck({
    category: 'API discovery or catalog semantics',
    owner: 'CapabilityService/SiteAdapter',
    patterns: [
      /\bapi[-_\s]*(?:discovery|catalog)\s+(?:semantic|semantics|meaning|classification|rules?|endpoint\s+meaning)\b/iu,
      /\b(?:discover|classify|interpret|maintain)\s+(?:site\s+)?api\s+(?:endpoint|catalog|rules?|semantics|meaning)\b/iu,
    ],
  }),
]);

function responsibility({
  id,
  label,
  domain,
}) {
  return Object.freeze({
    schemaVersion: KERNEL_CONTRACT_SCHEMA_VERSION,
    id,
    label,
    owner: 'Kernel',
    domain,
    allowed: true,
    boundary: 'lightweight-orchestrator',
  });
}

function forbiddenCheck({
  category,
  owner,
  patterns = [],
  keyPatterns = [],
}) {
  return Object.freeze({
    category,
    owner,
    patterns: Object.freeze([...patterns]),
    keyPatterns: Object.freeze([...keyPatterns]),
  });
}

function cloneResponsibility(entry) {
  return {
    schemaVersion: entry.schemaVersion,
    id: entry.id,
    label: entry.label,
    owner: entry.owner,
    domain: entry.domain,
    allowed: entry.allowed,
    boundary: entry.boundary,
  };
}

function normalizeResponsibilityId(value) {
  return String(value ?? '')
    .trim()
    .replace(/([a-z0-9])([A-Z])/gu, '$1-$2')
    .replace(/[_\s.]+/gu, '-')
    .replace(/-+/gu, '-')
    .toLowerCase();
}

function candidateResponsibilityId(input) {
  if (typeof input === 'string') {
    return input;
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Kernel responsibility must be a string or object');
  }
  return input.id
    ?? input.responsibility
    ?? input.kind
    ?? input.domain
    ?? input.name
    ?? '';
}

function scanFields(input) {
  if (typeof input === 'string') {
    return [{ path: '<input>', key: '<input>', value: input }];
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return [];
  }
  const fields = [];
  const stack = [{ value: input, path: '' }];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || !current.value || typeof current.value !== 'object') {
      continue;
    }
    for (const [key, value] of Object.entries(current.value)) {
      const path = current.path ? `${current.path}.${key}` : key;
      fields.push({ path, key, value });
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        stack.push({ value, path });
      }
    }
  }
  return fields;
}

function assertNoForbiddenKernelResponsibility(input) {
  for (const field of scanFields(input)) {
    const normalizedKey = normalizeResponsibilityId(field.key).replace(/-/gu, '');
    const normalizedValue = String(field.value ?? '');
    for (const check of FORBIDDEN_KERNEL_RESPONSIBILITY_CHECKS) {
      if (check.keyPatterns.some((pattern) => pattern.test(normalizedKey))) {
        throw new Error(
          `Kernel must not own ${check.category}; ${check.owner} owns ${field.path}`,
        );
      }
      if (check.patterns.some((pattern) => pattern.test(normalizedValue))) {
        throw new Error(
          `Kernel must not own ${check.category}; ${check.owner} owns ${field.path}`,
        );
      }
    }
  }
}

export function listKernelAllowedResponsibilities() {
  return KERNEL_ALLOWED_RESPONSIBILITIES.map(cloneResponsibility);
}

export function normalizeKernelResponsibility(input) {
  assertNoForbiddenKernelResponsibility(input);
  const rawId = candidateResponsibilityId(input);
  const normalizedId = normalizeResponsibilityId(rawId);
  const allowedId = RESPONSIBILITY_ALIASES.get(normalizedId) ?? normalizedId;
  const entry = ALLOWED_BY_ID.get(allowedId);
  if (!entry) {
    throw new Error(`Unknown Kernel responsibility: ${normalizedId || '<empty>'}`);
  }
  return cloneResponsibility(entry);
}

export function assertKernelContract(input = listKernelAllowedResponsibilities()) {
  const entries = Array.isArray(input) ? input : [input];
  if (entries.length === 0) {
    throw new Error('Kernel contract must declare at least one responsibility');
  }
  const seen = new Set();
  for (const entry of entries) {
    const normalized = normalizeKernelResponsibility(entry);
    if (seen.has(normalized.id)) {
      throw new Error(`Duplicate Kernel responsibility: ${normalized.id}`);
    }
    seen.add(normalized.id);
  }
  return true;
}
