// @ts-check

export const COMPILER_CONTRACT_EXTRACTION_V2_SCHEMA_VERSION = 1;

const COMPILER_CANARY_PATTERN = /sf_compiler_[a-z0-9_]*secret/iu;
const SENSITIVE_KEY_PATTERN = /(?:raw|cookie|token|authorization|credential|password|secret|session|storageState|localStorage|sessionStorage|IndexedDB|body|dom|screenshot|video|trace)/iu;
const DESTRUCTIVE_PATTERN = /\b(?:delete|destroy|remove|cancel|revoke|reset|clear)\b|删除|取消|撤销/iu;
const PAYMENT_PATTERN = /\b(?:checkout|pay|payment|purchase|billing|amount|currency|card)\b|支付|付款|金额/iu;
const AUTH_PATTERN = /\b(?:login|required login|sign in|auth required|password|credential|private)\b|登录|密码|认证/iu;

function normalizeText(value) {
  return String(value ?? '').trim();
}

function safeText(value, fallback = '') {
  const text = normalizeText(value);
  if (!text || COMPILER_CANARY_PATTERN.test(text) || /authorization:\s*bearer|cookie:|set-cookie:|access[_-]?token|refresh[_-]?token/iu.test(text)) {
    return fallback;
  }
  return text
    .replace(/\s+/gu, ' ')
    .slice(0, 240);
}

function sanitizeBulkTextContent(value) {
  return normalizeText(value)
    .replace(COMPILER_CANARY_PATTERN, ' ')
    .replace(/authorization:\s*bearer\s+\S+/giu, ' ')
    .replace(/set-cookie:\s*\S+/giu, ' ')
    .replace(/cookie:\s*\S+/giu, ' ')
    .replace(/access[_-]?token\s*[:=]\s*\S+/giu, ' ')
    .replace(/refresh[_-]?token\s*[:=]\s*\S+/giu, ' ')
    .replace(/\s+/gu, ' ')
    .slice(0, 2000);
}

function normalizeToken(value, fallback = '') {
  const text = safeText(value, fallback)
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
  return text || fallback;
}

function asHtml(source) {
  if (typeof source === 'string') return source;
  return String(source?.html ?? source?.source ?? '');
}

function sourceUrl(source) {
  const raw = typeof source === 'string' ? '' : source?.url;
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

function siteKeyFromSource(source, options = {}) {
  if (options.siteKey) return normalizeToken(options.siteKey, 'unknown');
  const url = sourceUrl(source);
  return normalizeToken(url?.hostname, 'unknown');
}

function attrMap(tag = '') {
  const attrs = {};
  const attrPattern = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gu;
  for (const match of tag.matchAll(attrPattern)) {
    const key = match[1].toLowerCase();
    if (SENSITIVE_KEY_PATTERN.test(key)) continue;
    const value = safeText(match[2] ?? match[3] ?? match[4]);
    if (value) attrs[key] = value;
  }
  return attrs;
}

function stripTags(html = '') {
  return sanitizeBulkTextContent(String(html).replace(/<[^>]+>/gu, ' '));
}

function selectorForTag(tagName, attrs = {}) {
  if (attrs.id) return `#${normalizeToken(attrs.id)}`;
  if (attrs['data-testid']) return `[data-testid="${normalizeToken(attrs['data-testid'])}"]`;
  if (attrs.name) return `${tagName}[name="${normalizeToken(attrs.name)}"]`;
  if (attrs.action) return `${tagName}[action="${normalizeToken(attrs.action)}"]`;
  return tagName;
}

export function scoreSelectorStability(selector = '', options = {}) {
  const text = normalizeText(selector);
  if (!text) return 0.1;
  if (/^#[a-z0-9_-]+$/iu.test(text)) return 0.92;
  if (/\[data-testid=/iu.test(text)) return 0.88;
  if (/\[name=/iu.test(text)) return 0.78;
  if (/\[action=/iu.test(text)) return 0.66;
  if (/nth-child|:eq\(/iu.test(text)) return 0.25;
  if (/^\.[a-z0-9_-]+$/iu.test(text)) return 0.5;
  return Number.isFinite(options.fallbackScore) ? options.fallbackScore : 0.6;
}

function slotType(inputAttrs = {}) {
  const type = normalizeToken(inputAttrs.type, 'text');
  if (['password', 'hidden', 'file'].includes(type)) return type;
  if (['email', 'number', 'checkbox', 'radio', 'date', 'search', 'tel', 'url'].includes(type)) return type;
  return 'text';
}

function extractInputs(formHtml = '') {
  const slots = [];
  const inputPattern = /<(input|textarea|select)\b([^>]*)>/giu;
  for (const match of formHtml.matchAll(inputPattern)) {
    const tagName = match[1].toLowerCase();
    const attrs = attrMap(match[2]);
    const name = normalizeToken(attrs.name ?? attrs.id ?? attrs['data-testid']);
    if (!name) continue;
    const type = tagName === 'input' ? slotType(attrs) : tagName;
    slots.push({
      name,
      type,
      required: /\brequired\b/iu.test(match[2]),
      source: `${tagName}[name]`,
      savedMaterial: 'schema_only',
    });
  }
  return slots;
}

function completionSignalFromAttrs(attrs = {}, formText = '') {
  const selector = attrs['data-success-selector'] ?? attrs['data-completion-selector'];
  if (selector) {
    return {
      kind: 'selector_visible',
      selector: safeText(selector),
      deterministic: true,
      confidence: 0.9,
    };
  }
  if (/\b(?:success|completed|done|saved)\b|成功|完成/u.test(formText)) {
    return {
      kind: 'text_hint',
      text: 'success',
      deterministic: false,
      confidence: 0.55,
    };
  }
  return null;
}

function riskHintsFromText(text = '') {
  const hints = [];
  if (DESTRUCTIVE_PATTERN.test(text)) {
    hints.push({
      kind: 'destructive',
      severity: 'high',
      reasonCode: 'compiler.destructive_hint_detected',
    });
  }
  if (PAYMENT_PATTERN.test(text)) {
    hints.push({
      kind: 'payment',
      severity: 'critical',
      reasonCode: 'compiler.payment_hint_detected',
    });
  }
  return hints;
}

function authHintsFromText(text = '') {
  if (!AUTH_PATTERN.test(text)) return [];
  return [{
    kind: 'auth_required_hint',
    confidence: 0.75,
    reasonCode: 'compiler.auth_requirement_hint_detected',
    grantsAuthorization: false,
  }];
}

export function scoreContractConcreteness(contract = {}, options = {}) {
  let score = 0.2;
  if (contract.operationKind) score += 0.15;
  if (contract.selectorStabilityScore >= 0.75) score += 0.2;
  if ((contract.slotSchema ?? []).length > 0) score += 0.15;
  if (contract.completionSignal?.deterministic === true) score += 0.2;
  if ((contract.riskHints ?? []).some((hint) => ['destructive', 'payment'].includes(hint.kind))) score -= 0.1;
  if (contract.completionSignal === null || contract.completionSignal === undefined) score -= 0.1;
  const normalized = Math.max(0, Math.min(1, Number(score.toFixed(2))));
  return {
    score: normalized,
    concreteEnough: normalized >= (options.threshold ?? 0.75),
  };
}

export function extractFormActionContractsV2(source, options = {}) {
  const html = asHtml(source);
  const siteKey = siteKeyFromSource(source, options);
  const contracts = [];
  const formPattern = /<form\b([^>]*)>([\s\S]*?)<\/form>/giu;
  for (const match of html.matchAll(formPattern)) {
    const attrs = attrMap(match[1]);
    const formHtml = match[2];
    const text = stripTags(formHtml);
    const selector = selectorForTag('form', attrs);
    const slotSchema = extractInputs(formHtml);
    const completionSignal = completionSignalFromAttrs(attrs, text);
    const riskHints = riskHintsFromText(text);
    const authRequirementHints = authHintsFromText(`${text} ${slotSchema.map((slot) => slot.type).join(' ')}`);
    const selectorStabilityScore = scoreSelectorStability(selector);
    const baseContract = {
      schemaVersion: COMPILER_CONTRACT_EXTRACTION_V2_SCHEMA_VERSION,
      capabilityId: `capability:${siteKey}:${normalizeToken(attrs.id ?? attrs.name ?? attrs.action ?? 'form-action')}`,
      operationKind: 'form_or_action',
      selector,
      selectorStabilityScore,
      slotSchema,
      completionSignal,
      completionSignalConfidence: completionSignal?.confidence ?? 0,
      riskHints,
      authRequirementHints,
      providerCompatibilityHints: ['browser_action_provider'],
      extractionWarnings: completionSignal ? [] : ['compiler.completion_signal_missing'],
      executableByDefault: false,
      autoExecutable: false,
      source: 'static_html_form',
    };
    const concreteness = scoreContractConcreteness(baseContract);
    contracts.push({
      ...baseContract,
      contractConcretenessScore: concreteness.score,
      concreteEnough: concreteness.concreteEnough,
      capabilityConfidenceScore: Math.max(0.1, Math.min(0.95, Number(((selectorStabilityScore + concreteness.score) / 2).toFixed(2)))),
    });
  }
  return contracts;
}

export function extractDownloadExportHintsV2(source, options = {}) {
  const html = asHtml(source);
  const siteKey = siteKeyFromSource(source, options);
  const hints = [];
  const linkPattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/giu;
  for (const match of html.matchAll(linkPattern)) {
    const attrs = attrMap(match[1]);
    const label = stripTags(match[2]).toLowerCase();
    const href = attrs.href ?? '';
    if (!/\bdownload|export\b|下载|导出|\.pdf\b|\.csv\b|\.zip\b/iu.test(`${label} ${href}`)) continue;
    hints.push({
      schemaVersion: COMPILER_CONTRACT_EXTRACTION_V2_SCHEMA_VERSION,
      capabilityId: `capability:${siteKey}:download-export-${hints.length + 1}`,
      operationKind: 'download',
      href: safeText(href),
      label: label ? safeText(label) : 'download',
      providerCompatibilityHints: ['download_provider'],
      executableByDefault: false,
      source: 'static_html_link',
    });
  }
  return hints;
}

export function extractApiEndpointHintsV2(source, options = {}) {
  const html = asHtml(source);
  const hints = [];
  const endpointPattern = /(?:data-api-endpoint|data-endpoint|href|action)\s*=\s*(?:"([^"]*\/api\/[^"]*)"|'([^']*\/api\/[^']*)')/giu;
  for (const match of html.matchAll(endpointPattern)) {
    const endpoint = safeText(match[1] ?? match[2]);
    if (!endpoint) continue;
    hints.push({
      schemaVersion: COMPILER_CONTRACT_EXTRACTION_V2_SCHEMA_VERSION,
      endpointRef: `api-endpoint:${normalizeToken(endpoint, `endpoint-${hints.length + 1}`)}`,
      endpoint,
      methodFamily: /method\s*=\s*["']post["']/iu.test(html) ? 'POST' : 'GET',
      providerCompatibilityHints: ['api_read_provider'],
      executed: false,
      source: 'static_html_endpoint_hint',
    });
  }
  return hints;
}

export function extractAuthRequirementHintsV2(source, options = {}) {
  const html = asHtml(source);
  return authHintsFromText(stripTags(html));
}

export function extractRiskHintsV2(source, options = {}) {
  const html = asHtml(source);
  return riskHintsFromText(stripTags(html));
}

export function sanitizeCompilerExtractionOutput(output = {}, options = {}) {
  const serialized = JSON.stringify(output);
  if (COMPILER_CANARY_PATTERN.test(serialized)) {
    throw Object.assign(new Error('Compiler extraction output contains forbidden canary material'), {
      code: 'compiler.extraction_raw_material_rejected',
    });
  }
  return output;
}

export function extractStaticCapabilityContractsV2(source, options = {}) {
  const formContracts = extractFormActionContractsV2(source, options);
  const downloadExportHints = extractDownloadExportHintsV2(source, options);
  const apiEndpointHints = extractApiEndpointHintsV2(source, options);
  const authRequirementHints = extractAuthRequirementHintsV2(source, options);
  const riskHints = extractRiskHintsV2(source, options);
  const output = {
    schemaVersion: COMPILER_CONTRACT_EXTRACTION_V2_SCHEMA_VERSION,
    extractionKind: 'static_contract_extraction_v2',
    siteKey: siteKeyFromSource(source, options),
    formContracts,
    downloadExportHints,
    apiEndpointHints,
    authRequirementHints,
    riskHints,
    extractionWarnings: [
      ...formContracts.flatMap((contract) => contract.extractionWarnings),
      ...(formContracts.length === 0 ? ['compiler.no_form_action_contracts_detected'] : []),
    ],
    summary: {
      formContractCount: formContracts.length,
      downloadExportHintCount: downloadExportHints.length,
      apiEndpointHintCount: apiEndpointHints.length,
      authRequirementHintCount: authRequirementHints.length,
      riskHintCount: riskHints.length,
      providerCompatibilityHints: [...new Set([
        ...formContracts.flatMap((contract) => contract.providerCompatibilityHints),
        ...downloadExportHints.flatMap((hint) => hint.providerCompatibilityHints),
        ...apiEndpointHints.flatMap((hint) => hint.providerCompatibilityHints),
      ])].sort(),
      executedProvider: false,
      executedBrowser: false,
      executedNetwork: false,
    },
  };
  return sanitizeCompilerExtractionOutput(output);
}
