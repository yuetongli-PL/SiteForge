// @ts-check

import path from 'node:path';
import process from 'node:process';
import { readFile } from 'node:fs/promises';
import { isUrlAllowedByRobots } from './html.mjs';
import { isInternalUrl, normalizeUrl } from './models.mjs';
import { lookupSkillIntent } from './skill-registry.mjs';
import { RUNTIME_MODES } from './runtime-provider.mjs';
import {
  SANITIZED_SUMMARY_ONLY,
  sanitizeEvidenceRef,
} from './risk-policy.mjs';
import {
  assertNoForbiddenPatterns,
  isSensitiveFieldName,
  redactPublicIdentifierText,
} from '../../../domain/sessions/security-guard.mjs';

const API_RUNTIME_SAFE_METHODS = new Set(['GET', 'HEAD']);
const API_RUNTIME_WRITE_PATH_PATTERN = /(?:^|[/_.-])(?:create|delete|destroy|remove|update|edit|mutate|mutation|post|publish|submit|send|upload|follow|unfollow|like|repost|checkout|pay|order|login|logout|signin|signout)(?:$|[/_.-])/iu;
const API_RUNTIME_CHALLENGE_PATTERN = /(?:captcha|challenge|verify|verification|required login|login required|sign in|signin|log in|forbidden|access denied|permission denied|risk|anti[- ]?bot|blocked)/iu;
const API_RUNTIME_FRESH_EVIDENCE_MAX_AGE_MS = 5 * 60 * 1000;

function sanitizeText(value, maxLength = 160) {
  return redactPublicIdentifierText(String(value ?? ''), { maxLength }).value;
}

async function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return fallback;
    }
    throw error;
  }
}

function normalizeSkillDir(cwd, skillDir) {
  const raw = String(skillDir ?? '').trim();
  if (!raw) {
    return null;
  }
  return path.isAbsolute(raw) ? raw : path.resolve(cwd, raw);
}

function arrayOf(value) {
  return Array.isArray(value) ? value : [];
}

function firstValue(...values) {
  return values.find((value) => value !== undefined && value !== null && String(value).trim() !== '');
}

function allowedDomainsForExecution({
  allowedDomains,
  domain,
  lookup,
  site,
} = /** @type {any} */ ({})) {
  const domains = new Set();
  for (const item of arrayOf(allowedDomains)) {
    const text = String(item ?? '').trim().toLowerCase();
    if (text) {
      domains.add(text);
    }
  }
  for (const item of [domain, lookup?.domain, site?.domain]) {
    const text = String(item ?? '').trim().toLowerCase();
    if (text) {
      domains.add(text);
    }
  }
  for (const item of arrayOf(site?.allowedDomains)) {
    const text = String(item ?? '').trim().toLowerCase();
    if (text) {
      domains.add(text);
    }
  }
  return [...domains].sort((left, right) => left.localeCompare(right, 'en'));
}

function runtimeModeFor(lookup, capability, plan, step) {
  return firstValue(
    step?.runtimeMode,
    plan?.runtimeMode,
    capability?.runtimeMode,
    lookup?.runtimeMode,
    capability?.apiAdapter?.runtime,
  );
}

function hasFreshBridgeEvidence(value, now = new Date()) {
  if (value === true) {
    return true;
  }
  if (!value || typeof value !== 'object') {
    return false;
  }
  if (value.requiresFreshBridgeEvidence === false) {
    return false;
  }
  const status = String(value.status ?? value.authVerificationStatus ?? value.bridgeStatus ?? '').trim().toLowerCase();
  const statusFresh = [
    'available',
    'captured',
    'fresh',
    'ready',
    'verified',
    'browser_verified',
    'browser_verified_partial',
  ].includes(status);
  if (!statusFresh && value.fresh !== true && value.captured !== true && value.verified !== true) {
    return false;
  }
  const capturedAt = value.capturedAt ?? value.verifiedAt ?? value.generatedAt ?? null;
  if (!capturedAt) {
    return true;
  }
  const capturedMs = Date.parse(String(capturedAt));
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(String(now));
  return Number.isFinite(capturedMs)
    && Number.isFinite(nowMs)
    && nowMs - capturedMs >= 0
    && nowMs - capturedMs <= API_RUNTIME_FRESH_EVIDENCE_MAX_AGE_MS;
}

function hasRequestBody(step = /** @type {any} */ ({})) {
  const body = step.body ?? step.requestBody ?? step.payload ?? null;
  if (body === null || body === undefined) {
    return false;
  }
  if (typeof body === 'string') {
    return body.trim().length > 0;
  }
  if (Array.isArray(body)) {
    return body.length > 0;
  }
  if (typeof body === 'object') {
    return Object.keys(body).length > 0;
  }
  return true;
}

function hasSensitiveQuery(urlValue) {
  let parsed;
  try {
    parsed = new URL(String(urlValue ?? ''));
  } catch {
    return true;
  }
  for (const key of parsed.searchParams.keys()) {
    if (isSensitiveFieldName(key) || /^(?:auth|authorization|sid|sessdata|csrf|xsrf|secret|password|pass|signature|sign|access[_-]?token|refresh[_-]?token|session(?:[_-]?id)?|api[_-]?key|xsec[_-]?token)$/iu.test(key)) {
      return true;
    }
  }
  return /(?:%5Bredacted%5D|\[redacted\]|redacted)/iu.test(parsed.search);
}

function resolveEndpointUrl(step, site, runtimeBinding = null) {
  const raw = String(firstValue(runtimeBinding?.endpoint, step?.runtimeEndpoint, step?.endpoint, step?.url) ?? '').trim();
  if (!raw || raw.startsWith('structure-ref:')) {
    return {
      endpoint: null,
      reasonCode: 'endpoint_not_runtime_resolvable',
    };
  }
  try {
    return {
      endpoint: normalizeUrl(raw, site?.rootUrl),
      reasonCode: null,
    };
  } catch {
    return {
      endpoint: null,
      reasonCode: 'endpoint_not_runtime_resolvable',
    };
  }
}

function validateApiRequestPlan({
  lookup,
  capability,
  plan,
  step,
  runtimeBinding = null,
  allowedDomains,
  robotsPolicy,
  site,
} = /** @type {any} */ ({})) {
  if (!capability || capability.status !== 'active') {
    return { ok: false, reasonCode: 'active_capability_required' };
  }
  if (!plan || plan.autoExecute === true || plan.requiresConfirmation === true) {
    return { ok: false, reasonCode: 'limited_read_plan_required' };
  }
  if (!step || String(step.kind ?? '').trim() !== 'api_request') {
    return { ok: false, reasonCode: 'api_request_step_required' };
  }
  const runtimeMode = runtimeModeFor(lookup, capability, plan, step);
  if (runtimeMode !== RUNTIME_MODES.browserBridgeRequired) {
    return { ok: false, reasonCode: 'browser_bridge_runtime_required' };
  }
  if (
    lookup?.genericHttpRuntimeAllowed === true
    || capability.genericHttpRuntimeAllowed === true
    || plan.genericHttpRuntimeAllowed === true
    || step.genericHttpRuntimeAllowed === true
  ) {
    return { ok: false, reasonCode: 'generic_http_runtime_not_allowed' };
  }
  if (
    lookup?.requiresFreshBridgeEvidence !== true
    && capability.requiresFreshBridgeEvidence !== true
    && plan.requiresFreshBridgeEvidence !== true
    && step.requiresFreshBridgeEvidence !== true
    && capability.apiAdapter?.requiresFreshBridgeEvidence !== true
  ) {
    return { ok: false, reasonCode: 'fresh_browser_bridge_evidence_required' };
  }
  const method = String(step.method ?? 'GET').trim().toUpperCase();
  if (!API_RUNTIME_SAFE_METHODS.has(method)) {
    return { ok: false, reasonCode: 'method_not_read_only', method };
  }
  if (runtimeBinding?.method && String(runtimeBinding.method).trim().toUpperCase() !== method) {
    return { ok: false, reasonCode: 'runtime_binding_method_mismatch', method };
  }
  if (hasRequestBody(step)) {
    return { ok: false, reasonCode: 'request_body_present', method };
  }
  if (String(plan.mode ?? step.mode ?? 'limited_read') !== 'limited_read') {
    return { ok: false, reasonCode: 'limited_read_plan_required', method };
  }
  if (String(plan.responseMaterial ?? step.responseMaterial ?? '') !== SANITIZED_SUMMARY_ONLY) {
    return { ok: false, reasonCode: 'sanitized_summary_response_required', method };
  }
  const resolved = resolveEndpointUrl(step, site, runtimeBinding);
  if (!resolved.endpoint) {
    return { ok: false, reasonCode: resolved.reasonCode, method };
  }
  if (!allowedDomains.length || !isInternalUrl(resolved.endpoint, allowedDomains)) {
    return { ok: false, reasonCode: 'cross_site_endpoint', method, endpoint: resolved.endpoint };
  }
  const parsed = new URL(resolved.endpoint);
  if (API_RUNTIME_WRITE_PATH_PATTERN.test(`${parsed.pathname} ${parsed.search}`)) {
    return { ok: false, reasonCode: 'write_like_endpoint', method, endpoint: resolved.endpoint };
  }
  if (hasSensitiveQuery(resolved.endpoint)) {
    return { ok: false, reasonCode: 'sensitive_query_material', method, endpoint: resolved.endpoint };
  }
  if (robotsPolicy && !isUrlAllowedByRobots(resolved.endpoint, robotsPolicy)) {
    return { ok: false, reasonCode: 'robots_disallowed', method, endpoint: resolved.endpoint };
  }
  return {
    ok: true,
    method,
    endpoint: resolved.endpoint,
  };
}

function safeObjectKeys(value, limit = 24) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [];
  }
  return Object.keys(value)
    .filter((key) => !isSensitiveFieldName(key) && !/(?:token|secret|password|cookie|authorization|session|sid|csrf|xsrf)/iu.test(key))
    .map((key) => sanitizeText(key, 80))
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right, 'en'))
    .slice(0, limit);
}

function parseBodyMaybe(body) {
  if (body === null || body === undefined) {
    return null;
  }
  if (typeof body !== 'string') {
    return body;
  }
  const text = body.trim();
  if (!text) {
    return '';
  }
  if ((text.startsWith('{') && text.endsWith('}')) || (text.startsWith('[') && text.endsWith(']'))) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return text;
}

function summarizeResponseBody(body) {
  const parsed = parseBodyMaybe(body);
  if (Array.isArray(parsed)) {
    const sampleObject = parsed.find((item) => item && typeof item === 'object' && !Array.isArray(item)) ?? null;
    return {
      kind: 'json_array',
      itemCount: parsed.length,
      itemKeys: safeObjectKeys(sampleObject),
    };
  }
  if (parsed && typeof parsed === 'object') {
    const keys = safeObjectKeys(parsed);
    const arrays = Object.entries(parsed)
      .filter(([, value]) => Array.isArray(value))
      .map(([key, value]) => ({
        key: sanitizeText(key, 80),
        itemCount: value.length,
      }))
      .filter((entry) => entry.key && !isSensitiveFieldName(entry.key))
      .slice(0, 8);
    return {
      kind: 'json_object',
      keys,
      arrays,
    };
  }
  if (typeof parsed === 'string') {
    return {
      kind: 'text',
      textLength: parsed.length,
    };
  }
  return {
    kind: parsed === null ? 'empty' : typeof parsed,
  };
}

function responseHeader(headers, name) {
  if (!headers || typeof headers !== 'object') {
    return null;
  }
  const wanted = String(name).toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (String(key).toLowerCase() === wanted) {
      return String(Array.isArray(value) ? value.join(', ') : value ?? '').trim();
    }
  }
  return null;
}

function summarizeBridgeResponse(response = /** @type {any} */ ({})) {
  const httpStatus = Number(response.httpStatus ?? response.statusCode ?? response.status ?? response.response?.status ?? 0) || null;
  const headers = response.headers ?? response.response?.headers ?? {};
  const contentType = String(response.contentType ?? responseHeader(headers, 'content-type') ?? '').trim() || null;
  const body = response.body ?? response.bodyText ?? response.text ?? response.response?.body ?? null;
  const probeText = [
    response.statusText,
    response.reason,
    response.reasonCode,
    response.responseKind,
    typeof body === 'string' ? body.slice(0, 600) : '',
  ].filter(Boolean).join(' ');
  const challengeLike = API_RUNTIME_CHALLENGE_PATTERN.test(probeText)
    || [401, 403, 407, 419, 429].includes(Number(httpStatus));
  const ok = !challengeLike && (httpStatus === null || (httpStatus >= 200 && httpStatus < 300) || httpStatus === 304);
  const summary = {
    responseMaterial: SANITIZED_SUMMARY_ONLY,
    httpStatus,
    contentType,
    responseKind: String(response.responseKind ?? '').trim() || (contentType?.includes('json') ? 'json' : null),
    bodySummary: summarizeResponseBody(body),
    bodyPersisted: false,
    cookieMaterialPersisted: false,
    storageMaterialPersisted: false,
  };
  assertNoForbiddenPatterns(summary.bodySummary);
  return {
    ok,
    reasonCode: challengeLike ? 'challenge_or_login_wall_response' : (ok ? null : 'api_request_http_failed'),
    summary,
  };
}

function blockedResult(reasonCode, details = /** @type {any} */ ({})) {
  return {
    status: 'blocked',
    reasonCode,
    responseMaterial: SANITIZED_SUMMARY_ONLY,
    ...details,
  };
}

export async function loadApiRequestRuntimeArtifacts({
  cwd = process.cwd(),
  lookup,
} = /** @type {any} */ ({})) {
  const skillDir = normalizeSkillDir(cwd, lookup?.skillDir);
  if (!skillDir) {
    return {
      status: 'missing',
      reasonCode: 'skill_dir_required',
      skillDir: null,
      capability: null,
      plan: null,
    };
  }
  const capabilitiesPayload = await readJson(path.join(skillDir, 'capabilities.json'), { capabilities: [] });
  const executionPlansPayload = await readJson(path.join(skillDir, 'execution_plans.json'), { executionPlans: [] });
  const capability = arrayOf(capabilitiesPayload?.capabilities)
    .find((candidate) => candidate?.id === lookup?.capabilityId) ?? null;
  const plan = arrayOf(executionPlansPayload?.executionPlans)
    .find((candidate) => candidate?.id === lookup?.executionPlanId)
    ?? capability?.executionPlan
    ?? null;
  return {
    status: capability && plan ? 'loaded' : 'missing',
    reasonCode: !capability ? 'capability_not_found' : (!plan ? 'execution_plan_not_found' : null),
    skillDir,
    capability,
    plan,
  };
}

export async function loadApiRequestRuntimeBinding({
  cwd = process.cwd(),
  lookup,
  step,
} = /** @type {any} */ ({})) {
  const runtimeBindingId = String(firstValue(step?.runtimeBindingId, lookup?.runtimeBindingId) ?? '').trim();
  const artifactDir = normalizeSkillDir(cwd, lookup?.artifactDir);
  if (!runtimeBindingId || !artifactDir) {
    return null;
  }
  const payload = await readJson(path.join(artifactDir, 'runtime', 'api-adapter-bindings.internal.json'), null);
  const binding = arrayOf(payload?.bindings).find((candidate) => candidate?.id === runtimeBindingId) ?? null;
  return binding ? { ...binding, sourceArtifact: path.join(artifactDir, 'runtime', 'api-adapter-bindings.internal.json') } : null;
}

export async function executeApiRequestIntent({
  registryPath,
  cwd = process.cwd(),
  domain,
  utterance,
  lookup: suppliedLookup = null,
  allowedDomains = null,
  site = null,
  robotsPolicy = null,
  freshBridgeEvidence = null,
  browserBridgeFetch = null,
  now = new Date(),
} = /** @type {any} */ ({})) {
  const lookup = suppliedLookup ?? await lookupSkillIntent({ registryPath, domain, utterance });
  if (lookup?.status !== 'found') {
    return {
      status: 'not_found',
      reasonCode: lookup?.reason ?? 'intent_not_found',
      lookup,
    };
  }

  const artifacts = await loadApiRequestRuntimeArtifacts({ cwd, lookup });
  if (artifacts.status !== 'loaded') {
    return blockedResult(artifacts.reasonCode, { lookup });
  }

  const capability = artifacts.capability;
  const plan = artifacts.plan;
  const step = arrayOf(plan?.steps).find((candidate) => String(candidate?.kind ?? '').trim() === 'api_request') ?? null;
  const runtimeBinding = await loadApiRequestRuntimeBinding({ cwd, lookup, step });
  const domains = allowedDomainsForExecution({
    allowedDomains,
    domain,
    lookup,
    site,
  });
  const validation = validateApiRequestPlan({
    lookup,
    capability,
    plan,
    step,
    runtimeBinding,
    allowedDomains: domains,
    robotsPolicy,
    site,
  });
  if (!validation.ok) {
    return blockedResult(validation.reasonCode, {
      lookup,
      capabilityId: capability.id,
      executionPlanId: plan.id,
      endpoint: validation.endpoint ? sanitizeEvidenceRef(validation.endpoint) : null,
      method: validation.method ?? null,
    });
  }
  if (!hasFreshBridgeEvidence(freshBridgeEvidence, now)) {
    return blockedResult('fresh_browser_bridge_evidence_required', {
      lookup,
      capabilityId: capability.id,
      executionPlanId: plan.id,
      endpoint: sanitizeEvidenceRef(validation.endpoint),
      method: validation.method,
    });
  }
  if (typeof browserBridgeFetch !== 'function') {
    return blockedResult('browser_bridge_fetch_unavailable', {
      lookup,
      capabilityId: capability.id,
      executionPlanId: plan.id,
      endpoint: sanitizeEvidenceRef(validation.endpoint),
      method: validation.method,
    });
  }

  const bridgeResponse = await browserBridgeFetch({
    endpoint: validation.endpoint,
    method: validation.method,
    credentials: 'include',
    body: null,
    persistCookies: false,
    persistStorage: false,
    persistResponseBody: false,
    responseMaterial: SANITIZED_SUMMARY_ONLY,
  });
  const response = summarizeBridgeResponse(bridgeResponse);
  if (!response.ok) {
    return blockedResult(response.reasonCode, {
      lookup,
      capabilityId: capability.id,
      executionPlanId: plan.id,
      endpoint: sanitizeEvidenceRef(validation.endpoint),
      method: validation.method,
      response: response.summary,
    });
  }
  return {
    status: 'success',
    reasonCode: null,
    runtimeMode: RUNTIME_MODES.browserBridgeRequired,
    capabilityId: capability.id,
    executionPlanId: plan.id,
    runtimeBindingId: runtimeBinding?.id ?? step?.runtimeBindingId ?? lookup.runtimeBindingId ?? null,
    endpoint: sanitizeEvidenceRef(validation.endpoint),
    method: validation.method,
    autoExecute: false,
    requiresConfirmation: false,
    responseMaterial: SANITIZED_SUMMARY_ONLY,
    runtimePolicy: {
      authBoundary: 'browser_bridge',
      credentials: 'include',
      genericHttpRuntimeAllowed: false,
      requiresFreshBridgeEvidence: true,
      cookieMaterialPersisted: false,
      storageMaterialPersisted: false,
      bodyPersisted: false,
    },
    response: response.summary,
  };
}
