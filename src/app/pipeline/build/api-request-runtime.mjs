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
import {
  API_READ_ONLY_CHALLENGE_PATTERN,
  apiEndpointLooksWriteLike,
  hasSensitiveApiQueryMaterial,
  hasSubstantiveApiRequestBody,
  isReadOnlyApiMethod,
  normalizeApiMethod,
} from './api-readonly-policy.mjs';
const API_RUNTIME_FRESH_EVIDENCE_MAX_AGE_MS = 5 * 60 * 1000;
const REDDIT_OAUTH_HOST = 'oauth.reddit.com';
const REDDIT_OAUTH_TOKEN_ENV_VARS = Object.freeze([
  'SITEFORGE_REDDIT_BEARER_TOKEN',
  'REDDIT_BEARER_TOKEN',
]);
const REDDIT_OAUTH_USER_AGENT_ENV_VARS = Object.freeze([
  'SITEFORGE_REDDIT_USER_AGENT',
  'REDDIT_USER_AGENT',
]);

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
  return hasSubstantiveApiRequestBody(body);
}

function uniqueSortedStrings(values = []) {
  return [...new Set(values.map((value) => String(value ?? '').trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, 'en'));
}

function applyRuntimePathParameters(rawEndpoint, runtimeParams = /** @type {any} */ ({})) {
  const missing = [];
  const endpoint = String(rawEndpoint ?? '').replace(/\{([A-Za-z_][A-Za-z0-9_.-]*)\}/gu, (match, name) => {
    const value = runtimeParams?.[name];
    if (value === undefined || value === null || String(value).trim() === '') {
      missing.push(name);
      return match;
    }
    return encodeURIComponent(String(value));
  });
  return {
    endpoint,
    missingPathParameters: uniqueSortedStrings(missing),
  };
}

function unresolvedRuntimePathParameters(value) {
  return uniqueSortedStrings([...String(value ?? '').matchAll(/\{([A-Za-z_][A-Za-z0-9_.-]*)\}/gu)]
    .map((match) => match[1]));
}

function resolveEndpointUrl(step, site, runtimeBinding = null, {
  runtimeParams = null,
  requireResolvedParameters = false,
} = /** @type {any} */ ({})) {
  const raw = String(firstValue(runtimeBinding?.endpoint, step?.runtimeEndpoint, step?.endpoint, step?.url) ?? '').trim();
  if (!raw || raw.startsWith('structure-ref:')) {
    return {
      endpoint: null,
      reasonCode: 'endpoint_not_runtime_resolvable',
    };
  }
  const parameterized = runtimeParams
    ? applyRuntimePathParameters(raw, runtimeParams)
    : { endpoint: raw, missingPathParameters: [] };
  const unresolved = unresolvedRuntimePathParameters(parameterized.endpoint);
  if (requireResolvedParameters && (parameterized.missingPathParameters.length > 0 || unresolved.length > 0)) {
    return {
      endpoint: null,
      reasonCode: 'runtime_path_parameters_required',
      missingPathParameters: uniqueSortedStrings([
        ...parameterized.missingPathParameters,
        ...unresolved,
      ]),
    };
  }
  try {
    return {
      endpoint: normalizeUrl(parameterized.endpoint, site?.rootUrl),
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
  const method = normalizeApiMethod(step.method);
  if (!isReadOnlyApiMethod(method)) {
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
  if (apiEndpointLooksWriteLike({ url: resolved.endpoint, method })) {
    return { ok: false, reasonCode: 'write_like_endpoint', method, endpoint: resolved.endpoint };
  }
  if (hasSensitiveApiQueryMaterial(resolved.endpoint, { invalidAsSensitive: true })) {
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

function validateRedditOauthApiRequestPlan({
  lookup,
  capability,
  plan,
  step,
  runtimeBinding = null,
  runtimeParams = null,
  allowedDomains,
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
  if (runtimeMode !== RUNTIME_MODES.redditOauthRead) {
    return { ok: false, reasonCode: 'reddit_oauth_read_runtime_required' };
  }
  const method = normalizeApiMethod(step.method);
  if (!isReadOnlyApiMethod(method)) {
    return { ok: false, reasonCode: 'method_not_read_only', method };
  }
  if (runtimeBinding?.method && String(runtimeBinding.method).trim().toUpperCase() !== method) {
    return { ok: false, reasonCode: 'runtime_binding_method_mismatch', method };
  }
  if (hasRequestBody(step)) {
    return { ok: false, reasonCode: 'request_body_present', method };
  }
  if (!['limited_read', 'read_only'].includes(String(plan.mode ?? step.mode ?? 'limited_read'))) {
    return { ok: false, reasonCode: 'limited_read_plan_required', method };
  }
  if (String(plan.responseMaterial ?? step.responseMaterial ?? '') !== SANITIZED_SUMMARY_ONLY) {
    return { ok: false, reasonCode: 'sanitized_summary_response_required', method };
  }
  const resolved = resolveEndpointUrl(step, site, runtimeBinding, {
    runtimeParams,
    requireResolvedParameters: true,
  });
  if (!resolved.endpoint) {
    return {
      ok: false,
      reasonCode: resolved.reasonCode,
      method,
      missingPathParameters: resolved.missingPathParameters ?? [],
    };
  }
  let parsed = null;
  try {
    parsed = new URL(resolved.endpoint);
  } catch {
    return { ok: false, reasonCode: 'endpoint_not_runtime_resolvable', method };
  }
  if (parsed.hostname !== REDDIT_OAUTH_HOST) {
    return { ok: false, reasonCode: 'reddit_oauth_endpoint_required', method, endpoint: resolved.endpoint };
  }
  const hostAllowed = allowedDomains.includes(REDDIT_OAUTH_HOST)
    || allowedDomains.includes('reddit.com')
    || allowedDomains.includes('www.reddit.com');
  if (!hostAllowed || !isInternalUrl(resolved.endpoint, [REDDIT_OAUTH_HOST])) {
    return { ok: false, reasonCode: 'cross_site_endpoint', method, endpoint: resolved.endpoint };
  }
  if (apiEndpointLooksWriteLike({ url: resolved.endpoint, method })) {
    return { ok: false, reasonCode: 'write_like_endpoint', method, endpoint: resolved.endpoint };
  }
  if (hasSensitiveApiQueryMaterial(resolved.endpoint, { invalidAsSensitive: true })) {
    return { ok: false, reasonCode: 'sensitive_query_material', method, endpoint: resolved.endpoint };
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
  if (typeof headers.entries === 'function') {
    for (const [key, value] of headers.entries()) {
      if (String(key).toLowerCase() === wanted) {
        return String(value ?? '').trim();
      }
    }
    return null;
  }
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
  const challengeLike = API_READ_ONLY_CHALLENGE_PATTERN.test(probeText)
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

function firstEnvValue(env, names = []) {
  for (const name of names) {
    const text = String(name ?? '').trim();
    if (text && String(env?.[text] ?? '').trim()) {
      return {
        envName: text,
        value: String(env[text]).trim(),
      };
    }
  }
  return { envName: null, value: null };
}

function credentialEnvNames(...values) {
  const names = [];
  for (const value of values) {
    if (Array.isArray(value)) {
      names.push(...value);
    } else if (value) {
      names.push(value);
    }
  }
  return names.map((name) => String(name ?? '').trim()).filter(Boolean);
}

function resolveRedditOauthRuntimeCredentials({
  lookup,
  capability,
  plan,
  step,
  runtimeBinding,
  env,
  oauthBearerToken,
  userAgent,
} = /** @type {any} */ ({})) {
  const tokenEnvNames = credentialEnvNames(
    runtimeBinding?.tokenEnvVars,
    runtimeBinding?.tokenEnv,
    step?.tokenEnvVars,
    step?.tokenEnv,
    plan?.tokenEnvVars,
    plan?.tokenEnv,
    capability?.apiAdapter?.tokenEnvVars,
    capability?.apiAdapter?.tokenEnv,
    lookup?.tokenEnvVars,
    REDDIT_OAUTH_TOKEN_ENV_VARS,
  );
  const userAgentEnvNames = credentialEnvNames(
    runtimeBinding?.userAgentEnvVars,
    runtimeBinding?.userAgentEnv,
    step?.userAgentEnvVars,
    step?.userAgentEnv,
    plan?.userAgentEnvVars,
    plan?.userAgentEnv,
    capability?.apiAdapter?.userAgentEnvVars,
    capability?.apiAdapter?.userAgentEnv,
    lookup?.userAgentEnvVars,
    REDDIT_OAUTH_USER_AGENT_ENV_VARS,
  );
  const tokenFromEnv = firstEnvValue(env, tokenEnvNames);
  const userAgentFromEnv = firstEnvValue(env, userAgentEnvNames);
  return {
    token: String(oauthBearerToken ?? '').trim() || tokenFromEnv.value,
    tokenEnv: tokenFromEnv.envName,
    userAgent: String(userAgent ?? '').trim() || userAgentFromEnv.value,
    userAgentEnv: userAgentFromEnv.envName,
  };
}

async function executeRedditOauthReadRequest({
  validation,
  lookup,
  capability,
  plan,
  step,
  runtimeBinding,
  env,
  oauthBearerToken,
  userAgent,
  fetchImpl,
} = /** @type {any} */ ({})) {
  const credentials = resolveRedditOauthRuntimeCredentials({
    lookup,
    capability,
    plan,
    step,
    runtimeBinding,
    env,
    oauthBearerToken,
    userAgent,
  });
  if (!credentials.token) {
    return blockedResult('reddit_oauth_bearer_token_required', {
      lookup,
      capabilityId: capability.id,
      executionPlanId: plan.id,
      endpoint: sanitizeEvidenceRef(validation.endpoint),
      method: validation.method,
      credentialSource: {
        tokenEnv: null,
        userAgentEnv: credentials.userAgentEnv,
        tokenPersisted: false,
      },
    });
  }
  if (!credentials.userAgent) {
    return blockedResult('reddit_user_agent_required', {
      lookup,
      capabilityId: capability.id,
      executionPlanId: plan.id,
      endpoint: sanitizeEvidenceRef(validation.endpoint),
      method: validation.method,
      credentialSource: {
        tokenEnv: credentials.tokenEnv,
        userAgentEnv: null,
        tokenPersisted: false,
      },
    });
  }
  if (typeof fetchImpl !== 'function') {
    return blockedResult('reddit_oauth_fetch_unavailable', {
      lookup,
      capabilityId: capability.id,
      executionPlanId: plan.id,
      endpoint: sanitizeEvidenceRef(validation.endpoint),
      method: validation.method,
    });
  }

  const response = await fetchImpl(validation.endpoint, {
    method: validation.method,
    headers: {
      authorization: `Bearer ${credentials.token}`,
      'user-agent': credentials.userAgent,
      accept: 'application/json',
    },
  });
  const body = typeof response?.text === 'function'
    ? await response.text()
    : response?.body ?? response?.bodyText ?? null;
  const responseSummary = summarizeBridgeResponse({
    statusCode: response?.status ?? response?.statusCode ?? null,
    headers: response?.headers ?? {},
    body,
    responseKind: responseHeader(response?.headers, 'content-type')?.includes('json') ? 'json' : null,
  });
  const common = {
    lookup,
    capabilityId: capability.id,
    executionPlanId: plan.id,
    runtimeBindingId: runtimeBinding?.id ?? step?.runtimeBindingId ?? lookup.runtimeBindingId ?? null,
    endpoint: sanitizeEvidenceRef(validation.endpoint),
    method: validation.method,
    runtimeMode: RUNTIME_MODES.redditOauthRead,
    responseMaterial: SANITIZED_SUMMARY_ONLY,
    credentialSource: {
      tokenEnv: credentials.tokenEnv,
      userAgentEnv: credentials.userAgentEnv,
      tokenPersisted: false,
    },
  };
  if (!responseSummary.ok) {
    return blockedResult(responseSummary.reasonCode, {
      ...common,
      response: responseSummary.summary,
    });
  }
  return {
    status: 'success',
    reasonCode: null,
    ...common,
    autoExecute: false,
    requiresConfirmation: false,
    runtimePolicy: {
      authBoundary: 'oauth_bearer',
      credentials: 'authorization_header',
      genericHttpRuntimeAllowed: false,
      requiresFreshBridgeEvidence: false,
      authorizationPersisted: false,
      cookieMaterialPersisted: false,
      storageMaterialPersisted: false,
      bodyPersisted: false,
    },
    response: responseSummary.summary,
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
  fetchImpl = globalThis.fetch,
  env = process.env,
  oauthBearerToken = null,
  userAgent = null,
  runtimeParams = null,
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
  const runtimeMode = runtimeModeFor(lookup, capability, plan, step);
  if (runtimeMode === RUNTIME_MODES.redditOauthRead) {
    const validation = validateRedditOauthApiRequestPlan({
      lookup,
      capability,
      plan,
      step,
      runtimeBinding,
      runtimeParams,
      allowedDomains: domains,
      site,
    });
    if (!validation.ok) {
      return blockedResult(validation.reasonCode, {
        lookup,
        capabilityId: capability.id,
        executionPlanId: plan.id,
        endpoint: validation.endpoint ? sanitizeEvidenceRef(validation.endpoint) : null,
        method: validation.method ?? null,
        missingPathParameters: validation.missingPathParameters ?? [],
      });
    }
    return await executeRedditOauthReadRequest({
      validation,
      lookup,
      capability,
      plan,
      step,
      runtimeBinding,
      env,
      oauthBearerToken,
      userAgent,
      fetchImpl,
    });
  }
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
    endpointTemplate: firstValue(runtimeBinding?.endpoint, step?.runtimeEndpoint, step?.endpoint, step?.url) ?? validation.endpoint,
    runtimeParameterSource: runtimeBinding?.runtimeParameterSource ?? step?.runtimeParameterSource ?? capability.apiAdapter?.runtimeParameterSource ?? null,
    responseEvidence: runtimeBinding?.responseEvidence ?? step?.responseEvidence ?? capability.apiAdapter?.responseEvidence ?? null,
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
