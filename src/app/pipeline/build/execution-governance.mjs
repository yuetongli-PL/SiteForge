// @ts-check

import { BUILD_SCHEMA_VERSION, sha256Short } from './models.mjs';
import { SANITIZED_SUMMARY_ONLY, findForcedDisabledActions } from './risk-policy.mjs';
import { createRuntimeInvocationRequest } from '../../planner/index.mjs';
import { evaluateRuntimeInvocationDispatch } from '../../runtime/index.mjs';
import {
  SITE_CAPABILITY_EXECUTION_SCHEMA_VERSION,
  SITE_CAPABILITY_EXECUTION_VERSION,
  createGovernedExecutionPolicyDecision,
} from '../../../domain/policies/execution/index.mjs';

export const EXECUTION_CONTRACTS_ARTIFACT = 'execution_contracts.json';
export const EXECUTION_GOVERNANCE_ARTIFACT = 'execution_governance.json';
export const RUNTIME_DISPATCH_REPORT_ARTIFACT = 'runtime_dispatch_report.json';
export const RUNTIME_EXECUTION_REPORT_ARTIFACT = 'runtime_execution_report.json';
export const AUDIT_LOG_ARTIFACT = 'audit_log.json';

export const EXECUTION_DISPOSITIONS = Object.freeze([
  'allow',
  'controlled',
  'confirm_required',
  'blocked',
]);

export const EXECUTION_VERDICTS = Object.freeze([
  'allow',
  'controlled',
  'blocked',
]);

export const EXECUTION_GATES = Object.freeze([
  'confirm_required',
  'audit_required',
  'session_required',
  'permission_required',
  'output_path_required',
  'dry_run_required',
]);

/**
 * @typedef {'allow' | 'controlled' | 'confirm_required' | 'blocked'} ExecutionDisposition
 * @typedef {'allow' | 'controlled' | 'blocked'} ExecutionVerdict
 */

const DEFAULT_DESTRUCTIVE_ACTION_PATTERN =
  /\b(?:delete|remove|clear|empty|wipe|overwrite|reset|cancel[-_\s]?(?:order|subscription)|void|destroy|purge|erase|revoke|delete_account|delete_file|delete_data|delete_order|delete_record)\b|\u5220\u9664|\u79fb\u9664|\u6e05\u7a7a|\u8986\u76d6|\u91cd\u7f6e|\u6ce8\u9500|\u53d6\u6d88\u8ba2\u5355|\u9500\u6bc1|\u62b9\u9664|\u64a4\u9500|\u4f5c\u5e9f/u;
const PAYMENT_ACTION_PATTERN =
  /\b(?:pay|payment|checkout|purchase|billing|invoice|charge|recharge|wallet|cart|change[-_\s]?payment|payment[-_\s]?method|funds?)\b|\u652f\u4ed8|\u4ed8\u6b3e|\u4ed8\u8d39|\u5145\u503c|\u7ed3\u8d26|\u4e0b\u5355|\u4ed8\u6b3e\u65b9\u5f0f|\u94f6\u884c\u5361/u;
const ACCOUNT_SECURITY_PATTERN =
  /\b(?:change[-_\s]?(?:password|email|2fa|mfa)|password|2fa|mfa|security settings|account security|credential)\b|\u5bc6\u7801|\u8d26\u53f7\u5b89\u5168/u;

const DESTRUCTIVE_ACTION_PATTERN =
  /\b(?:delete|remove|clear|empty|wipe|overwrite|reset|cancel|void|destroy|purge|erase|delete_account|delete_file|delete_data|delete_order|delete_record)\b|删除|移除|清空|覆盖|重置|注销|取消订单|销毁|抹除/u;

const STRONG_DESTRUCTIVE_CONFIRMATION_PHRASE = 'CONFIRM_DESTRUCTIVE_EXECUTION';
const STRONG_PAYMENT_CONFIRMATION_PHRASE = 'CONFIRM_PAYMENT_EXECUTION';

const CONTROLLED_EXECUTION_AUDIT_FIELDS = Object.freeze([
  'buildId',
  'siteId',
  'contractRef',
  'capabilityId',
  'executionPlanId',
  'operationKind',
  'impactScope',
  'riskLevel',
  'executionDisposition',
  'runtimeDecision',
  'strongConfirmationRef',
  'sitePolicyRef',
  'runtimeConstraints',
  'resultStatus',
]);

function normalizeToken(value) {
  return String(value ?? '').trim().toLowerCase();
}

function normalizeDispatchText(value) {
  return normalizeToken(value)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function dispatchTextTokens(value) {
  const text = normalizeDispatchText(value);
  if (!text) {
    return [];
  }
  const tokens = new Set(text.split(/\s+/u).filter((token) => token.length >= 2));
  for (const [chunk] of text.matchAll(/[\p{Script=Han}]+/gu)) {
    if (chunk.length >= 2) {
      tokens.add(chunk);
    }
    for (let index = 0; index < chunk.length - 1; index += 1) {
      tokens.add(chunk.slice(index, index + 2));
    }
  }
  return [...tokens];
}

function dispatchTextScore(task, candidate) {
  const normalizedTask = normalizeDispatchText(task);
  const normalizedCandidate = normalizeDispatchText(candidate);
  if (!normalizedTask || !normalizedCandidate) {
    return 0;
  }
  if (normalizedTask === normalizedCandidate) {
    return 1000;
  }
  if (normalizedCandidate.length >= 3 && normalizedTask.includes(normalizedCandidate)) {
    return 850 - Math.min(100, normalizedTask.length - normalizedCandidate.length);
  }
  if (normalizedTask.length >= 3 && normalizedCandidate.includes(normalizedTask)) {
    return 825 - Math.min(100, normalizedCandidate.length - normalizedTask.length);
  }
  const taskTokens = dispatchTextTokens(normalizedTask);
  const candidateTokens = dispatchTextTokens(normalizedCandidate);
  if (taskTokens.length === 0 || candidateTokens.length === 0) {
    return 0;
  }
  const candidateSet = new Set(candidateTokens);
  const overlap = taskTokens.filter((token) => candidateSet.has(token)).length;
  if (overlap === 0) {
    return 0;
  }
  const precision = overlap / candidateTokens.length;
  const recall = overlap / taskTokens.length;
  return Math.round((precision * 0.4 + recall * 0.6) * 600);
}

function safeIdPart(value, fallback = 'item') {
  const text = String(value ?? '').trim();
  const normalized = text
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 96);
  return normalized || `${fallback}-${sha256Short(text || fallback, 8)}`;
}

function safeRefIdPart(value, fallback = 'item') {
  return safeIdPart(value, fallback)
    .replace(/\b(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\b/gu, '$1-$2-$3-$4');
}

function runtimeContractRefForSelection(selected = /** @type {any} */ ({})) {
  return `execution-contract:${safeRefIdPart(selected.id ?? selected.capabilityId, 'contract')}`;
}

function planSteps(plan = /** @type {any} */ ({})) {
  return Array.isArray(plan?.steps) ? plan.steps : [];
}

function isPlainObject(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function safeDescriptorText(value) {
  const text = String(value ?? '').trim();
  if (!text || /(?:cookie|token|authorization|credential|password|secret|session[_-]?id|csrf)/iu.test(text)) {
    return null;
  }
  return text.replace(/[?&](?:token|auth|sid|session|cookie|csrf|access_token|refresh_token)=[^&\s"']+/giu, '');
}

function safeDescriptorStringList(value) {
  return Array.isArray(value)
    ? value.map(safeDescriptorText).filter(Boolean)
    : [];
}

function sanitizedDownloaderTaskDescriptor(capability = /** @type {any} */ ({}), plan = /** @type {any} */ ({}), disposition = 'blocked') {
  const stepDescriptor = planSteps(plan)
    .map((step) => step?.downloaderTaskDescriptor)
    .find(isPlainObject);
  const source = isPlainObject(capability.downloaderTaskDescriptor)
    ? capability.downloaderTaskDescriptor
    : stepDescriptor;
  const descriptor = {
    material: 'descriptor_only',
    networkResolveAllowedAtRuntime: disposition !== 'blocked',
    savedMaterial: SANITIZED_SUMMARY_ONLY,
  };
  if (!source) {
    return descriptor;
  }
  for (const key of ['siteKey', 'adapterId', 'taskType', 'entrypoint', 'scriptLanguage', 'interpreter', 'sessionRequirement', 'artifactMaterial', 'reportMaterial', 'bodyTextPersistence']) {
    const value = safeDescriptorText(source[key]);
    if (value) {
      descriptor[key] = value;
    }
  }
  for (const key of ['acceptsBookTitle', 'acceptsBookUrl', 'acceptsSearchResult', 'redactionRequired']) {
    if (source[key] === true || source[key] === false) {
      descriptor[key] = source[key] === true;
    }
  }
  const inputSlots = safeDescriptorStringList(source.inputSlots);
  if (inputSlots.length) {
    descriptor.inputSlots = inputSlots;
  }
  const outputFields = safeDescriptorStringList(source.outputFields);
  if (outputFields.length) {
    descriptor.outputFields = outputFields;
  }
  descriptor.networkResolveAllowedAtRuntime = disposition !== 'blocked' && source.networkResolveAllowedAtRuntime !== false;
  descriptor.savedMaterial = SANITIZED_SUMMARY_ONLY;
  descriptor.reportMaterial = SANITIZED_SUMMARY_ONLY;
  descriptor.redactionRequired = true;
  return descriptor;
}

function runtimeProviderIdForCapability(context = null, capability = /** @type {any} */ ({}), operationKind = 'navigate') {
  if (operationKind === 'download') {
    return safeDescriptorText(capability.downloaderTaskDescriptor?.providerId) ?? 'known_site_downloader';
  }
  if (isWeiboReadonlyCapability(context, capability)) {
    return 'weibo_readonly_provider';
  }
  if (isZhihuReadonlyCapability(context, capability)) {
    return 'zhihu_readonly_provider';
  }
  return capability?.providerId ?? null;
}

function joinedCapabilityText(capability = /** @type {any} */ ({})) {
  return [
    capability.name,
    capability.description,
    capability.action,
    capability.object,
    capability.userValue,
    capability.user_facing_name,
    capability.userFacingName,
    capability.blockedAction,
    capability.risk_level,
    capability.riskPolicy?.riskLevel,
    ...planSteps(capability.executionPlan).flatMap((step) => [
      step?.kind,
      step?.operationKind,
      step?.action,
      step?.blockedAction,
      step?.routeTemplate,
      step?.routePath,
      step?.endpoint,
    ]),
  ].filter(Boolean).join(' ');
}

export function isDestructiveCapability(capability = /** @type {any} */ ({})) {
  const text = joinedCapabilityText(capability);
  return DEFAULT_DESTRUCTIVE_ACTION_PATTERN.test(text);
}

export function isPaymentCapability(capability = /** @type {any} */ ({})) {
  const text = joinedCapabilityText(capability);
  return PAYMENT_ACTION_PATTERN.test(text);
}

function isHighRiskCapability(capability = /** @type {any} */ ({})) {
  const riskLevel = riskLevelOf(capability);
  const safetyLevel = normalizeToken(capability.safetyLevel ?? capability.safety);
  return capability.highRiskAction === true
    || isDestructiveCapability(capability)
    || isPaymentCapability(capability)
    || riskLevel === 'account_security_critical'
    || ['high_risk', 'requires_confirmation', 'account_security', 'security_critical'].includes(safetyLevel)
    || ACCOUNT_SECURITY_PATTERN.test(joinedCapabilityText(capability));
}

function riskLevelOf(capability = /** @type {any} */ ({})) {
  return normalizeToken(capability.risk_level ?? capability.riskLevel ?? capability.riskPolicy?.riskLevel ?? 'read_public_low');
}

function statusOf(capability = /** @type {any} */ ({})) {
  return normalizeToken(capability.status);
}

function enabledStatusOf(capability = /** @type {any} */ ({})) {
  return normalizeToken(capability.enabled_status ?? capability.enabledStatus);
}

/**
 * @returns {ExecutionDisposition}
 */
export function executionDispositionForCapability(capability = /** @type {any} */ ({})) {
  const status = statusOf(capability);
  const enabledStatus = enabledStatusOf(capability);
  const safetyLevel = normalizeToken(capability.safetyLevel ?? capability.safety);
  const explicitDisposition = normalizeToken(capability.executionDisposition ?? capability.executionPlan?.executionDisposition);

  if (status === 'candidate' || status === 'discarded' || enabledStatus === 'candidate_debug_only' || enabledStatus === 'debug_only') {
    return 'blocked';
  }
  if (['controlled', 'confirm_required', 'blocked'].includes(explicitDisposition)) {
    return /** @type {ExecutionDisposition} */ (explicitDisposition);
  }
  if (isDestructiveCapability(capability)) {
    return 'blocked';
  }
  if (isPaymentCapability(capability) || safetyLevel === 'payment') {
    return 'blocked';
  }
  if (enabledStatus === 'disabled') {
    return 'blocked';
  }
  const riskLevel = riskLevelOf(capability);
  const operationText = joinedCapabilityText(capability).toLowerCase();
  const operationKind = operationKindForPlan(capability, capability.executionPlan ?? {});
  const controlledRisk = [
    'read_personal_medium',
    'read_private_high',
    'account_security_critical',
  ].includes(riskLevel);
  const controlledOperation = /\b(?:login|log in|sign in|auth|authenticate|session materialization|materialize session)\b|\u767b\u5f55|\u6388\u6743/u.test(operationText);
  if (
    controlledRisk
    || controlledOperation
    || isHighRiskCapability(capability)
    || (
      operationKind === 'navigate'
      && (
        capability.authRequired === true
        || capability.requiresAuth === true
        || capability.requiresSession === true
        || capability.requiresUserAuthorization === true
      )
    )
  ) {
    return 'controlled';
  }
  return 'allow';
}

/**
 * @returns {ExecutionVerdict}
 */
function executionVerdictForDisposition(disposition = 'blocked') {
  if (disposition === 'confirm_required') {
    return 'controlled';
  }
  return EXECUTION_VERDICTS.includes(disposition)
    ? /** @type {ExecutionVerdict} */ (disposition)
    : 'blocked';
}

function uniqueExecutionGates(values = /** @type {any[]} */ ([])) {
  const set = new Set(values.filter((value) => EXECUTION_GATES.includes(value)));
  return EXECUTION_GATES.filter((gate) => set.has(gate));
}

function executionGatesForContract({
  disposition = 'allow',
  destructive = false,
  payment = false,
  highRisk = false,
  sessionRequired = false,
  operationKind = 'navigate',
  riskLevel = 'read_public_low',
} = {}) {
  const governedRisk = destructive === true || payment === true || highRisk === true || riskLevel === 'account_security_critical';
  if (disposition === 'allow') {
    return uniqueExecutionGates([
      sessionRequired === true ? 'session_required' : null,
    ]);
  }
  return uniqueExecutionGates([
    disposition === 'confirm_required' || governedRisk ? 'confirm_required' : null,
    governedRisk || riskLevel === 'read_private_high' ? 'audit_required' : null,
    sessionRequired === true ? 'session_required' : null,
    governedRisk ? 'permission_required' : null,
  ]);
}

function operationKindForPlan(capability = /** @type {any} */ ({}), plan = /** @type {any} */ ({})) {
  const firstKind = normalizeToken(planSteps(plan)[0]?.kind);
  if (firstKind.includes('api')) return 'api_request';
  if (firstKind.includes('download') || capability.action === 'download') return 'download';
  if (firstKind.includes('form') || firstKind.includes('draft') || ['submit', 'contact', 'create', 'upload', 'purchase', 'book', 'manage'].includes(capability.action)) {
    return 'form_or_action';
  }
  if (firstKind.includes('adapter')) return 'adapter_action';
  return 'navigate';
}

function runtimeKindForCapability(capability = /** @type {any} */ ({}), plan = /** @type {any} */ ({})) {
  const providerId = normalizeToken(capability.providerId ?? capability.runtimeProviderId ?? capability.runtimeMode);
  const operationKind = operationKindForPlan(capability, plan);
  if (providerId === 'authorized_summary') {
    return 'authorized_summary';
  }
  if (providerId.includes('browser') || planSteps(plan).some((step) => step?.runtimeBindingId)) {
    return 'browser_bridge';
  }
  if (operationKind === 'download') {
    return 'downloader';
  }
  if (capability.apiAdapter) {
    return 'site_adapter';
  }
  if (operationKind === 'api_request') {
    return 'api_adapter';
  }
  return 'public_http';
}

function sanitizeStepTemplate(step = /** @type {any} */ ({})) {
  const method = step.method ? String(step.method).toUpperCase() : null;
  const selector = step.selector ?? step.targetSelector ?? null;
  const actionRef = step.actionRef ?? step.actionId ?? step.action ?? null;
  const routeRef = step.routeRef ?? step.routeId ?? null;
  return {
    kind: step.kind ?? 'operation',
    method,
    nodeId: step.nodeId ?? null,
    selector: selector ? String(selector).replace(/[?&](?:token|auth|sid|session|cookie|csrf|access_token|refresh_token)=[^"'\]\s&]+/giu, '') : null,
    actionRef: actionRef ? String(actionRef) : null,
    routeRef: routeRef ? String(routeRef) : null,
    routeTemplate: step.routeTemplate ?? step.routePath ?? null,
    pageKind: step.pageKind ?? step.pageType ?? null,
    endpointTemplate: step.endpoint ? String(step.endpoint).replace(/[?&](?:token|auth|sid|session|cookie|csrf|access_token|refresh_token)=[^&]+/giu, '') : null,
    slotNames: [
      ...(Array.isArray(step.slotNames) ? step.slotNames : []),
      step.querySlot,
      step.inputSlot,
      step.payloadSlot,
    ].filter(Boolean),
    submit: step.submit === true,
    finalSubmit: step.finalSubmit === true,
    autoExecute: false,
    savedMaterial: SANITIZED_SUMMARY_ONLY,
  };
}

function payloadTemplateForCapability(capability = /** @type {any} */ ({}), plan = /** @type {any} */ ({})) {
  return {
    schemaVersion: BUILD_SCHEMA_VERSION,
    material: 'template_only',
    redactionRequired: true,
    savedMaterial: SANITIZED_SUMMARY_ONLY,
    slotBindings: (Array.isArray(capability.inputs) ? capability.inputs : []).map((input) => ({
      name: input?.name ?? null,
      type: input?.type ?? 'string',
      required: input?.required === true,
    })).filter((slot) => slot.name),
    steps: planSteps(plan).map((step) => sanitizeStepTemplate(step)),
  };
}

function uniqueStrings(values = /** @type {any[]} */ ([])) {
  return [...new Set(values.map((value) => String(value ?? '').trim()).filter(Boolean))];
}

function capabilityTextMatches(capability, pattern) {
  return pattern.test(joinedCapabilityText(capability));
}

function impactScopeKindsForCapability(capability = /** @type {any} */ ({}), {
  destructive = false,
  payment = false,
} = {}) {
  const kinds = [];
  if (payment || capabilityTextMatches(capability, /\b(?:pay|payment|checkout|purchase|billing|invoice|charge|wallet|funds?)\b|\u652f\u4ed8|\u4ed8\u6b3e|\u94f6\u884c\u5361/u)) {
    kinds.push('payment_or_funds');
  }
  if (capabilityTextMatches(capability, /\b(?:account|profile|password|security|2fa|mfa|credential|login|user)\b|\u8d26\u53f7|\u8d26\u6237|\u5bc6\u7801|\u6ce8\u9500/u)) {
    kinds.push('account_or_profile');
  }
  if (capabilityTextMatches(capability, /\b(?:order|subscription|booking|cart|invoice)\b|\u8ba2\u5355|\u8ba2\u9605/u)) {
    kinds.push('order_or_subscription');
  }
  if (capabilityTextMatches(capability, /\b(?:file|asset|media|image|document|download|upload)\b|\u6587\u4ef6|\u8d44\u4ea7|\u4e0b\u8f7d|\u4e0a\u4f20/u)) {
    kinds.push('file_or_asset');
  }
  if (capabilityTextMatches(capability, /\b(?:data|record|post|comment|message|entry|item)\b|\u6570\u636e|\u8bb0\u5f55|\u5e16\u5b50|\u6d88\u606f/u)) {
    kinds.push('record_or_data');
  }
  if (!kinds.length && destructive) {
    kinds.push('site_state');
  }
  return uniqueStrings(kinds.length ? kinds : ['requested_resource']);
}

function affectedResourceRefsForCapability(capability = /** @type {any} */ ({})) {
  const plan = capability.executionPlan ?? {};
  return uniqueStrings([
    capability.id ? `capability:${safeIdPart(capability.id, 'capability')}` : null,
    ...planSteps(plan).map((step) => step?.nodeId ? String(step.nodeId) : null),
  ]);
}

/**
 * @param {any} capability
 * @param {{ operationKind?: string | null, destructive?: boolean, payment?: boolean, highRisk?: boolean }} [options]
 */
function impactScopeForCapability(capability = /** @type {any} */ ({}), {
  operationKind,
  destructive = false,
  payment = false,
  highRisk = false,
} = {}) {
  return {
    material: 'descriptor_only',
    level: destructive ? 'destructive' : payment ? 'funds_or_payment' : 'standard',
    destructive: destructive === true,
    highRisk: highRisk === true,
    paymentOrFunds: payment === true,
    operationKind: operationKind ?? null,
    scopeKinds: impactScopeKindsForCapability(capability, { destructive, payment }),
    affectedResourceRefs: affectedResourceRefsForCapability(capability),
    reversibility: destructive || payment ? 'irreversible_or_site_defined' : 'site_defined',
    savedMaterial: SANITIZED_SUMMARY_ONLY,
  };
}

function confirmationPolicyForContract({
  destructive = false,
  payment = false,
  highRisk = false,
  disposition = 'allow',
  gates = /** @type {any[]} */ ([]),
} = {}) {
  const strongConfirmationRequired = destructive === true || payment === true;
  const highRiskConfirmationRequired = highRisk === true || strongConfirmationRequired;
  return {
    material: 'descriptor_only',
    required: highRiskConfirmationRequired || disposition === 'confirm_required' || gates.includes('confirm_required'),
    strongConfirmationRequired,
    destructiveConfirmationRequired: destructive === true,
    paymentConfirmationRequired: payment === true,
    acceptedConfirmationRefs: highRiskConfirmationRequired ? ['execution_contract_id', 'capability_id'] : [],
    requiredPhrase: destructive
      ? STRONG_DESTRUCTIVE_CONFIRMATION_PHRASE
      : payment
        ? STRONG_PAYMENT_CONFIRMATION_PHRASE
        : null,
    naturalLanguageRequestGrantsExecution: false,
    savedMaterial: SANITIZED_SUMMARY_ONLY,
  };
}

function auditPolicyForContract({
  destructive = false,
  payment = false,
  highRisk = false,
  disposition = 'allow',
  riskLevel = 'read_public_low',
} = {}) {
  const required = destructive === true || payment === true || highRisk === true || riskLevel === 'read_private_high';
  return {
    material: 'redacted_descriptor_only',
    required,
    redactionRequired: true,
    sensitiveMaterialPersisted: false,
    replayableDecision: true,
    fields: required ? [...CONTROLLED_EXECUTION_AUDIT_FIELDS] : [
      'buildId',
      'siteId',
      'contractRef',
      'capabilityId',
      'runtimeDecision',
    ],
    excludedMaterial: [
      'cookie',
      'token',
      'credential',
      'browser_profile',
      'raw_headers',
      'authenticated_raw_body',
      'session_secret',
      'personal_sensitive_data',
    ],
  };
}

function executionPrerequisitesForCapability(capability = /** @type {any} */ ({}), {
  destructive = false,
  payment = false,
  highRisk = false,
  sessionRequired = false,
  authRequired = false,
} = {}) {
  return {
    material: 'descriptor_only',
    sitePolicyExplicitAllowRequired: destructive || payment,
    strongConfirmationRequired: destructive || payment,
    auditRequired: highRisk,
    runtimeConstraintRequired: highRisk || sessionRequired || authRequired,
    sessionRequired,
    authRequired,
    requiredPolicyFlags: destructive
      ? ['allowDestructiveActions']
      : payment
        ? ['allowPaymentActions']
        : [],
    requiredRuntimeChecks: [
      destructive || payment ? 'site_capability_config_explicit_allow' : null,
      highRisk ? 'confirmation' : null,
      highRisk ? 'complete_redacted_audit' : null,
      highRisk || sessionRequired || authRequired ? 'runtime_constraints_satisfied' : null,
    ].filter(Boolean),
    naturalLanguageRequestGrantsExecution: false,
    savedMaterial: SANITIZED_SUMMARY_ONLY,
  };
}

function highRiskTags({ destructive = false, payment = false, highRisk = false } = {}) {
  return [
    destructive ? 'destructive' : null,
    payment ? 'payment_or_funds' : null,
    highRisk ? 'high_risk' : null,
  ].filter(Boolean);
}

function hostFromMaybeUrl(value) {
  try {
    return new URL(String(value ?? '')).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function contextSiteHostTokens(context = null) {
  return [
    context?.site?.host,
    context?.site?.hostname,
    hostFromMaybeUrl(context?.site?.rootUrl),
    hostFromMaybeUrl(context?.site?.normalizedUrl),
    hostFromMaybeUrl(context?.site?.inputUrl),
    ...(Array.isArray(context?.site?.allowedDomains) ? context.site.allowedDomains : []),
  ]
    .map((value) => String(value ?? '').trim().toLowerCase())
    .filter(Boolean);
}

function isWeiboContext(context = null) {
  const siteKey = normalizeToken(context?.setupProfile?.knownSitePolicy?.siteKey ?? context?.site?.siteKey ?? context?.site?.key);
  const adapterId = normalizeToken(context?.setupProfile?.knownSitePolicy?.adapterId ?? context?.site?.adapterId);
  const hosts = contextSiteHostTokens(context);
  return siteKey === 'weibo'
    || adapterId === 'weibo'
    || hosts.some((host) => host === 'weibo.com' || host === 's.weibo.com' || host.endsWith('.weibo.com'));
}

function isXContext(context = null) {
  const siteKey = normalizeToken(context?.setupProfile?.knownSitePolicy?.siteKey ?? context?.site?.siteKey ?? context?.site?.key);
  const adapterId = normalizeToken(context?.setupProfile?.knownSitePolicy?.adapterId ?? context?.site?.adapterId);
  const hosts = contextSiteHostTokens(context);
  return siteKey === 'x'
    || siteKey === 'twitter'
    || adapterId === 'x'
    || adapterId === 'twitter'
    || hosts.some((host) => host === 'x.com' || host === 'twitter.com' || host.endsWith('.x.com') || host.endsWith('.twitter.com'));
}

function isRedditContext(context = null) {
  const siteKey = normalizeToken(context?.setupProfile?.knownSitePolicy?.siteKey ?? context?.site?.siteKey ?? context?.site?.key);
  const adapterId = normalizeToken(context?.setupProfile?.knownSitePolicy?.adapterId ?? context?.site?.adapterId);
  const hosts = contextSiteHostTokens(context);
  return siteKey === 'reddit'
    || adapterId === 'reddit'
    || hosts.some((host) => host === 'reddit.com' || host === 'www.reddit.com' || host.endsWith('.reddit.com'));
}

function isSocialBrowserBridgeReadonlyContext(context = null) {
  return isXContext(context) || isRedditContext(context);
}

function isWeiboSearchCapability(context = null, capability = /** @type {any} */ ({})) {
  const text = joinedCapabilityText(capability).toLowerCase();
  const searchLike = /\bsearch\b/u.test(text)
    && /\b(?:posts?|content|public)\b/u.test(text)
    && !/\b(?:users?|profiles?|accounts?|people)\b/u.test(text);
  return isWeiboContext(context)
    && searchLike
    && !/\b(?:delete|destroy|clear|reset|cancel|revoke|pay|payment|purchase|checkout|billing|download|export|write|submit|update|create|publish|follow|unfollow|like|repost|send|upload)\b/u.test(text);
}

function isWeiboFollowedUsersCapability(context = null, capability = /** @type {any} */ ({})) {
  const text = joinedCapabilityText(capability).toLowerCase();
  const followedUsersLike = /\b(?:list|read|show)\b/u.test(text)
    && /\b(?:followed-users|followed\s+users|following\s+(?:accounts|list)|who\s+do\s+i\s+follow)\b/u.test(text)
    && !/\b(?:updates?|timeline|posts?|feed|followers?|fans?)\b/u.test(text);
  return isWeiboContext(context)
    && followedUsersLike
    && !/\b(?:delete|destroy|clear|reset|cancel|revoke|pay|payment|purchase|checkout|billing|download|export|write|submit|update|create|publish|follow account|follow user|unfollow|like|repost|send|upload)\b/u.test(text);
}

function isWeiboUserPostsCapability(context = null, capability = /** @type {any} */ ({})) {
  const text = joinedCapabilityText(capability).toLowerCase();
  const postsLike = /\b(?:list|read|show)\b/u.test(text)
    && /\b(?:user-posts|user\s+posts|profile\s+posts|mymblog)\b/u.test(text);
  return isWeiboContext(context)
    && postsLike
    && !/\b(?:delete|destroy|clear|reset|cancel|revoke|pay|payment|purchase|checkout|billing|download|export|write|submit|update|create|publish|follow account|follow user|unfollow|like|repost|send|upload)\b/u.test(text);
}

function isWeiboUserAlbumsCapability(context = null, capability = /** @type {any} */ ({})) {
  const text = joinedCapabilityText(capability).toLowerCase();
  const albumsLike = /\b(?:list|read|show)\b/u.test(text)
    && /\b(?:user-albums|user-photos|user\s+(?:albums|photos)|photos\/get_all)\b/u.test(text);
  return isWeiboContext(context)
    && albumsLike
    && !/\b(?:delete|destroy|clear|reset|cancel|revoke|pay|payment|purchase|checkout|billing|download|export|write|submit|update|create|publish|follow account|follow user|unfollow|like|repost|send|upload)\b/u.test(text);
}

function isWeiboUserVideosCapability(context = null, capability = /** @type {any} */ ({})) {
  const text = joinedCapabilityText(capability).toLowerCase();
  const videosLike = /\b(?:list|read|show)\b/u.test(text)
    && /\b(?:user-videos|user\s+videos|profile\s+videos|feature=3)\b/u.test(text);
  return isWeiboContext(context)
    && videosLike
    && !/\b(?:delete|destroy|clear|reset|cancel|revoke|pay|payment|purchase|checkout|billing|download|export|write|submit|update|create|publish|follow account|follow user|unfollow|like|repost|send|upload)\b/u.test(text);
}

function isWeiboUserArticlesCapability(context = null, capability = /** @type {any} */ ({})) {
  const text = joinedCapabilityText(capability).toLowerCase();
  const articlesLike = /\b(?:list|read|show)\b/u.test(text)
    && /\b(?:user-articles|user\s+articles|profile\s+articles|feature=7)\b/u.test(text);
  return isWeiboContext(context)
    && articlesLike
    && !/\b(?:delete|destroy|clear|reset|cancel|revoke|pay|payment|purchase|checkout|billing|download|export|write|submit|update|create|publish|follow account|follow user|unfollow|like|repost|send|upload)\b/u.test(text);
}

function isWeiboUserAudioCapability(context = null, capability = /** @type {any} */ ({})) {
  const text = joinedCapabilityText(capability).toLowerCase();
  const audioLike = /\b(?:list|read|show)\b/u.test(text)
    && /\b(?:user-audio|user\s+audio|profile\s+audio|getaudiolist|tabtype=audio)\b/u.test(text);
  return isWeiboContext(context)
    && audioLike
    && !/\b(?:delete|destroy|clear|reset|cancel|revoke|pay|payment|purchase|checkout|billing|download|export|write|submit|update|create|publish|follow account|follow user|unfollow|like|repost|send|upload)\b/u.test(text);
}

function isWeiboHotSearchCapability(context = null, capability = /** @type {any} */ ({})) {
  const text = joinedCapabilityText(capability).toLowerCase();
  const hotSearchLike = /\b(?:list|read|show)\b/u.test(text)
    && /\b(?:hot-search|hot\s+search(?:es)?|realtime\s+hot\s+search|side\/hotsearch)\b/u.test(text);
  return isWeiboContext(context)
    && hotSearchLike
    && !/\b(?:delete|destroy|clear|reset|cancel|revoke|pay|payment|purchase|checkout|billing|download|export|write|submit|update|create|publish|follow account|follow user|unfollow|like|repost|send|upload)\b/u.test(text);
}

function isWeiboHotRankHourCapability(context = null, capability = /** @type {any} */ ({})) {
  const text = joinedCapabilityText(capability).toLowerCase();
  const hotRankHourLike = /\b(?:list|read|show)\b/u.test(text)
    && /\b(?:hot-rank-hour|hourly\s+hot\s+rank|hot_band|hot-band)\b/u.test(text);
  return isWeiboContext(context)
    && hotRankHourLike
    && !/\b(?:delete|destroy|clear|reset|cancel|revoke|pay|payment|purchase|checkout|billing|download|export|write|submit|update|create|publish|follow account|follow user|unfollow|like|repost|send|upload)\b/u.test(text);
}

function isWeiboHotTimelineCapability(context = null, capability = /** @type {any} */ ({})) {
  const text = joinedCapabilityText(capability).toLowerCase();
  const hotTimelineLike = /\b(?:list|read|show)\b/u.test(text)
    && /\b(?:hot-timeline|hottimeline|hot\s+timeline|popular\s+(?:weibo\s+)?posts?|hot-rank-(?:yesterday|day-before-yesterday|week|male|female)|(?:yesterday|weekly?|male|female)\s+hot\s+rank|day-before-yesterday\s+hot\s+rank|day\s+before\s+yesterday\s+hot\s+rank)\b/u.test(text);
  return isWeiboContext(context)
    && hotTimelineLike
    && !/\b(?:delete|destroy|clear|reset|cancel|revoke|pay|payment|purchase|checkout|billing|download|export|write|submit|update|create|publish|follow account|follow user|unfollow|like|repost|send|upload)\b/u.test(text);
}

function isWeiboReadonlyCapability(context = null, capability = /** @type {any} */ ({})) {
  return isWeiboSearchCapability(context, capability)
    || isWeiboFollowedUsersCapability(context, capability)
    || isWeiboUserPostsCapability(context, capability)
    || isWeiboUserAlbumsCapability(context, capability)
    || isWeiboUserVideosCapability(context, capability)
    || isWeiboUserArticlesCapability(context, capability)
    || isWeiboUserAudioCapability(context, capability)
    || isWeiboHotSearchCapability(context, capability)
    || isWeiboHotRankHourCapability(context, capability)
    || isWeiboHotTimelineCapability(context, capability);
}

function isZhihuContext(context = null) {
  const siteKey = normalizeToken(context?.setupProfile?.knownSitePolicy?.siteKey ?? context?.site?.siteKey ?? context?.site?.key);
  const adapterId = normalizeToken(context?.setupProfile?.knownSitePolicy?.adapterId ?? context?.site?.adapterId);
  const hosts = contextSiteHostTokens(context);
  return siteKey === 'zhihu'
    || adapterId === 'zhihu'
    || hosts.some((host) => host === 'www.zhihu.com' || host === 'zhihu.com' || host.endsWith('.zhihu.com'));
}

function zhihuReadonlyTextAllowed(text) {
  return !/\b(?:delete|destroy|clear|reset|cancel|revoke|pay|payment|purchase|checkout|billing|download|export|write|submit|update|create|publish|follow account|follow user|unfollow|vote|like|collect|message|send|upload)\b/u.test(text);
}

function isZhihuSearchCapability(context = null, capability = /** @type {any} */ ({})) {
  const text = joinedCapabilityText(capability).toLowerCase();
  const searchLike = (text.includes('search-posts') || /\bsearch\b/u.test(text))
    && /\b(?:posts?|content|question|answer|public|zhihu)\b/u.test(text);
  return isZhihuContext(context)
    && searchLike
    && zhihuReadonlyTextAllowed(text);
}

function isZhihuFollowedUsersCapability(context = null, capability = /** @type {any} */ ({})) {
  const text = joinedCapabilityText(capability).toLowerCase();
  const followedUsersLike = /\b(?:list|read|show)\b/u.test(text)
    && /\b(?:followed-users|followed\s+users|following\s+(?:accounts|list)|who\s+do\s+i\s+follow)\b/u.test(text);
  return isZhihuContext(context)
    && followedUsersLike
    && !/\b(?:list-user-following|user\s+following)\b/u.test(text)
    && !/\b(?:delete|destroy|clear|reset|cancel|revoke|pay|payment|purchase|checkout|billing|download|export|write|submit|update|create|publish|follow account|follow user|unfollow|vote|like|collect|message|send|upload)\b/u.test(text);
}

function isZhihuFeedCapability(context = null, capability = /** @type {any} */ ({})) {
  const text = joinedCapabilityText(capability).toLowerCase();
  const feedLike = /\b(?:list|read|show)\b/u.test(text)
    && /\b(?:followed-updates|followed\s+updates|recommended-timeline|timeline|feed|homepage)\b/u.test(text);
  return isZhihuContext(context)
    && feedLike
    && zhihuReadonlyTextAllowed(text);
}

function isZhihuNotificationsCapability(context = null, capability = /** @type {any} */ ({})) {
  const text = joinedCapabilityText(capability).toLowerCase();
  const notificationsLike = /\b(?:list|read|show)\b/u.test(text)
    && /\bnotifications?\b/u.test(text);
  return isZhihuContext(context)
    && notificationsLike
    && zhihuReadonlyTextAllowed(text);
}

function isZhihuProfileCapability(context = null, capability = /** @type {any} */ ({})) {
  const text = joinedCapabilityText(capability).toLowerCase();
  const profileLike = /\b(?:profile-content|list-profile-content|account-info|profile)\b/u.test(text);
  return isZhihuContext(context)
    && profileLike
    && zhihuReadonlyTextAllowed(text);
}

function isZhihuProfileTabCapability(context = null, capability = /** @type {any} */ ({})) {
  const text = joinedCapabilityText(capability).toLowerCase();
  const profileTabLike = /\b(?:list-user-(?:activities|answers|questions|articles|columns|pins|collections|videos|following)|user\s+(?:activities|answers|questions|articles|columns|pins|collections|videos|following))\b/u.test(text);
  return isZhihuContext(context)
    && profileTabLike
    && zhihuReadonlyTextAllowed(text);
}

function isZhihuHotCapability(context = null, capability = /** @type {any} */ ({})) {
  const text = joinedCapabilityText(capability).toLowerCase();
  const hotLike = /\b(?:list|read|show|view|open)\b/u.test(text)
    && /\b(?:list-hot-posts|hot-posts|hot\s+posts|hot\s+list|hot\s+ranking|zhihu\s+hot)\b/u.test(text);
  return isZhihuContext(context)
    && hotLike
    && !/\b(?:list-hot-broadcasts|hot-broadcasts|hot\s+broadcasts?|drama\s+feed|live\s+feed)\b/u.test(text)
    && zhihuReadonlyTextAllowed(text);
}

function isZhihuHotBroadcastCapability(context = null, capability = /** @type {any} */ ({})) {
  const text = joinedCapabilityText(capability).toLowerCase();
  const hotBroadcastLike = /\b(?:list|read|show|view|open)\b/u.test(text)
    && /\b(?:list-hot-broadcasts|hot-broadcasts|hot\s+broadcasts?|drama\s+feed|live\s+feed)\b/u.test(text);
  return isZhihuContext(context)
    && hotBroadcastLike
    && zhihuReadonlyTextAllowed(text);
}

function isZhihuTopicCapability(context = null, capability = /** @type {any} */ ({})) {
  const text = joinedCapabilityText(capability).toLowerCase();
  const topicLike = /\b(?:list|read|show|view|open)\b/u.test(text)
    && /\b(?:list-topic-(?:discussions|featured)|topic-(?:discussions|featured)|topic\s+(?:discussions|featured|top\s+answers?))\b/u.test(text);
  return isZhihuContext(context)
    && topicLike
    && zhihuReadonlyTextAllowed(text);
}

function isZhihuQuestionCapability(context = null, capability = /** @type {any} */ ({})) {
  const text = joinedCapabilityText(capability).toLowerCase();
  const questionLike = /\b(?:view|open|read|show)\b/u.test(text)
    && /\b(?:view-question-detail|question-detail|question\s+detail)\b/u.test(text);
  return isZhihuContext(context)
    && questionLike
    && zhihuReadonlyTextAllowed(text);
}

function isZhihuAnswerCapability(context = null, capability = /** @type {any} */ ({})) {
  const text = joinedCapabilityText(capability).toLowerCase();
  const answerLike = /\b(?:view|open|read|show)\b/u.test(text)
    && /\b(?:view-answer-detail|answer-detail|answer\s+detail)\b/u.test(text);
  return isZhihuContext(context)
    && answerLike
    && zhihuReadonlyTextAllowed(text);
}

function isZhihuReadonlyCapability(context = null, capability = /** @type {any} */ ({})) {
  return isZhihuSearchCapability(context, capability)
    || isZhihuFollowedUsersCapability(context, capability)
    || isZhihuFeedCapability(context, capability)
    || isZhihuNotificationsCapability(context, capability)
    || isZhihuProfileCapability(context, capability)
    || isZhihuProfileTabCapability(context, capability)
    || isZhihuHotCapability(context, capability)
    || isZhihuHotBroadcastCapability(context, capability)
    || isZhihuTopicCapability(context, capability)
    || isZhihuQuestionCapability(context, capability)
    || isZhihuAnswerCapability(context, capability);
}

function contextSiteOrigin(context = null) {
  for (const value of [
    context?.site?.rootUrl,
    context?.site?.normalizedUrl,
    context?.site?.inputUrl,
  ]) {
    try {
      const origin = new URL(String(value ?? '')).origin;
      if (origin && origin !== 'null') return origin;
    } catch {
      // Continue to host/domain fallbacks.
    }
  }
  for (const host of contextSiteHostTokens(context)) {
    try {
      const origin = new URL(`https://${host}`).origin;
      if (origin && origin !== 'null') return origin;
    } catch {
      // Continue to the final sentinel fallback.
    }
  }
  return 'https://example.invalid';
}

function isBrowserBridgeReadonlyCapability(context = null, capability = /** @type {any} */ ({}), plan = /** @type {any} */ ({}), operationKind = null) {
  const providerId = normalizeToken(capability.providerId ?? capability.runtimeProviderId);
  const runtimeMode = normalizeToken(capability.runtimeMode ?? capability.executionPlan?.runtimeMode ?? plan?.runtimeMode);
  const bindingKind = runtimeKindForCapability(capability, plan);
  const operation = normalizeToken(operationKind ?? operationKindForPlan(capability, plan));
  return isSocialBrowserBridgeReadonlyContext(context)
    && (providerId === 'browser_bridge' || bindingKind === 'browser_bridge' || runtimeMode === 'browser_bridge_required')
    && !['download', 'form_or_action', 'adapter_action'].includes(operation)
    && !isDestructiveCapability(capability)
    && !isPaymentCapability(capability);
}

function isAuthorizedSummaryReadonlyCapability(capability = /** @type {any} */ ({}), plan = /** @type {any} */ ({}), operationKind = null) {
  const providerId = normalizeToken(capability.providerId ?? capability.runtimeProviderId);
  const bindingKind = runtimeKindForCapability(capability, plan);
  const operation = normalizeToken(operationKind ?? operationKindForPlan(capability, plan));
  const planStepsUseAuthorizedSummary = planSteps(plan).some((step) => (
    normalizeToken(step?.routeState?.source) === 'authorized-source-structure-summary'
    || normalizeToken(step?.source) === 'authorized-source-structure-summary'
  ));
  return (providerId === 'authorized_summary' || bindingKind === 'authorized_summary' || planStepsUseAuthorizedSummary)
    && !['download', 'form_or_action', 'adapter_action', 'write', 'submit'].includes(operation)
    && !isDestructiveCapability(capability)
    && !isPaymentCapability(capability);
}

function runtimeAuthRequiredForCapability(context = null, capability = /** @type {any} */ ({})) {
  return capability?.authRequired === true
    || capability?.requiresAuth === true
    || capability?.requiresSession === true
    || capability?.requiresUserAuthorization === true
    || ['read_personal_medium', 'read_private_high', 'account_security_critical'].includes(riskLevelOf(capability))
    || isWeiboReadonlyCapability(context, capability)
    || isZhihuReadonlyCapability(context, capability);
}

function authRequirementForCapability(context = null, capability = /** @type {any} */ ({}), operationKind = null, {
  materialRequired = runtimeAuthRequiredForCapability(context, capability),
} = {}) {
  if (!materialRequired) {
    return {
      required: false,
      mode: 'none',
      scopes: [],
      material: {
        allowedTypes: [],
        injectionTarget: 'http_request',
      },
      policy: {
        requireGovernanceGate: true,
        allowCredentialForwarding: false,
        allowRawHeaderAudit: false,
        allowRawCookieAudit: false,
        allowRawBodyAudit: false,
      },
    };
  }
  const weiboSearch = isWeiboSearchCapability(context, capability);
  const weiboFollowedUsers = isWeiboFollowedUsersCapability(context, capability);
  const weiboUserPosts = isWeiboUserPostsCapability(context, capability);
  const weiboUserAlbums = isWeiboUserAlbumsCapability(context, capability);
  const weiboUserVideos = isWeiboUserVideosCapability(context, capability);
  const weiboUserArticles = isWeiboUserArticlesCapability(context, capability);
  const weiboUserAudio = isWeiboUserAudioCapability(context, capability);
  const weiboHotSearch = isWeiboHotSearchCapability(context, capability);
  const weiboHotRankHour = isWeiboHotRankHourCapability(context, capability);
  const weiboHotTimeline = isWeiboHotTimelineCapability(context, capability);
  const weiboReadonly = weiboSearch || weiboFollowedUsers || weiboUserPosts || weiboUserAlbums || weiboUserVideos || weiboUserArticles || weiboUserAudio || weiboHotSearch || weiboHotRankHour || weiboHotTimeline;
  const weiboRequiredSlots = weiboSearch
    ? ['query']
    : (weiboFollowedUsers || weiboUserPosts || weiboUserAlbums || weiboUserVideos || weiboUserArticles || weiboUserAudio)
      ? ['uid']
      : null;
  const zhihuSearch = isZhihuSearchCapability(context, capability);
  const zhihuFollowedUsers = isZhihuFollowedUsersCapability(context, capability);
  const zhihuFeed = isZhihuFeedCapability(context, capability);
  const zhihuNotifications = isZhihuNotificationsCapability(context, capability);
  const zhihuProfile = isZhihuProfileCapability(context, capability);
  const zhihuProfileTab = isZhihuProfileTabCapability(context, capability);
  const zhihuHot = isZhihuHotCapability(context, capability);
  const zhihuHotBroadcast = isZhihuHotBroadcastCapability(context, capability);
  const zhihuTopic = isZhihuTopicCapability(context, capability);
  const zhihuQuestion = isZhihuQuestionCapability(context, capability);
  const zhihuAnswer = isZhihuAnswerCapability(context, capability);
  const zhihuReadonly = zhihuSearch
    || zhihuFollowedUsers
    || zhihuFeed
    || zhihuNotifications
    || zhihuProfile
    || zhihuProfileTab
    || zhihuHot
    || zhihuHotBroadcast
    || zhihuTopic
    || zhihuQuestion
    || zhihuAnswer;
  let scopeOrigin = contextSiteOrigin(context);
  let scopeResources = null;
  if (weiboSearch) {
    scopeOrigin = 'https://s.weibo.com';
    scopeResources = ['/weibo'];
  } else if (weiboUserAlbums) {
    scopeOrigin = 'https://photo.weibo.com';
    scopeResources = ['/photos/get_all'];
  } else if (weiboFollowedUsers) {
    scopeOrigin = 'https://weibo.com';
    scopeResources = ['/ajax/friendships/friends'];
  } else if (weiboUserPosts || weiboUserVideos || weiboUserArticles) {
    scopeOrigin = 'https://weibo.com';
    scopeResources = ['/ajax/statuses/mymblog'];
  } else if (weiboUserAudio) {
    scopeOrigin = 'https://weibo.com';
    scopeResources = ['/ajax/profile/getAudioList'];
  } else if (weiboHotSearch) {
    scopeOrigin = 'https://weibo.com';
    scopeResources = ['/ajax/side/hotSearch'];
  } else if (weiboHotRankHour) {
    scopeOrigin = 'https://weibo.com';
    scopeResources = ['/ajax/statuses/hot_band'];
  } else if (weiboHotTimeline) {
    scopeOrigin = 'https://weibo.com';
    scopeResources = ['/ajax/feed/hottimeline'];
  } else if (zhihuReadonly) {
    scopeOrigin = 'https://www.zhihu.com';
    scopeResources = zhihuSearch
      ? ['/search']
      : zhihuProfileTab
        ? ['/people/{account}/activities', '/people/{account}/answers', '/people/{account}/asks', '/people/{account}/posts', '/people/{account}/columns', '/people/{account}/pins', '/people/{account}/collections', '/people/{account}/zvideos', '/people/{account}/following']
        : zhihuFollowedUsers
          ? ['/follow']
          : zhihuNotifications
            ? ['/notifications']
            : zhihuProfile
              ? ['/people/{account}']
              : zhihuHotBroadcast
                ? ['/drama/feed']
                : zhihuHot
                  ? ['/hot']
                  : zhihuTopic
                    ? ['/topic/{topic_id}/hot', '/topic/{topic_id}/top-answers']
                    : zhihuQuestion
                      ? ['/question/{question_id}']
                      : zhihuAnswer
                        ? ['/question/{question_id}/answer/{answer_id}', '/answer/{answer_id}']
                        : zhihuFeed
                          ? ['/']
                          : null;
  }
  return {
    required: true,
    mode: 'session_handle',
    scopes: [
      {
        origin: scopeOrigin,
        operations: operationKind === 'download' ? ['download'] : ['read', 'query'],
        ...(scopeResources ? { resources: scopeResources } : {}),
      },
    ],
    material: {
      allowedTypes: ['cookie'],
      injectionTarget: 'http_request',
    },
    policy: {
      requireGovernanceGate: true,
      allowCredentialForwarding: false,
      allowRawHeaderAudit: false,
      allowRawCookieAudit: false,
      allowRawBodyAudit: false,
      ...(weiboReadonly && weiboRequiredSlots ? { requireExplicitSlots: weiboRequiredSlots } : {}),
      ...(zhihuReadonly && (zhihuSearch || zhihuProfile || zhihuProfileTab || zhihuTopic || zhihuQuestion || zhihuAnswer)
        ? {
          requireExplicitSlots: zhihuSearch
            ? ['query']
            : zhihuProfile || zhihuProfileTab
              ? ['account']
              : zhihuTopic
                ? ['topic_id']
                : zhihuQuestion
                ? ['question_id']
                : ['answer_id'],
        }
        : {}),
    },
  };
}

export function buildExecutionContract({
  context,
  capability,
  intents = /** @type {any[]} */ ([]),
} = /** @type {any} */ ({})) {
  const plan = capability?.executionPlan ?? null;
  const disposition = executionDispositionForCapability(capability);
  const destructive = isDestructiveCapability(capability);
  const payment = isPaymentCapability(capability) || normalizeToken(capability?.safetyLevel ?? capability?.safety) === 'payment';
  const highRiskAction = isHighRiskCapability(capability);
  const planCallable = capability?.status === 'active' && Boolean(plan);
  const sessionRequired = runtimeAuthRequiredForCapability(context, capability);
  const executionVerdict = executionVerdictForDisposition(disposition);
  const operationKind = operationKindForPlan(capability, plan ?? {});
  const riskLevel = riskLevelOf(capability);
  const browserBridgeReadonly = isBrowserBridgeReadonlyCapability(context, capability, plan ?? {}, operationKind);
  const authorizedSummaryReadonly = isAuthorizedSummaryReadonlyCapability(capability, plan ?? {}, operationKind);
  const authMaterialRequired = sessionRequired && !browserBridgeReadonly && !authorizedSummaryReadonly;
  const authRequirement = authRequirementForCapability(context, capability, operationKind, {
    materialRequired: authMaterialRequired,
  });
  const executionGates = executionGatesForContract({
    disposition,
    destructive,
    payment,
    highRisk: highRiskAction,
    sessionRequired,
    operationKind,
    riskLevel,
  });
  const runtimeCallable = planCallable && executionVerdict !== 'blocked';
  const autoExecutable = runtimeCallable && executionVerdict === 'allow' && plan?.autoExecute !== true && plan?.requiresConfirmation !== true;
  const contractId = `execution-contract:${safeIdPart(capability?.id ?? capability?.name, 'capability')}`;
  const runtimeBindingId = `runtime-binding:${safeIdPart(capability?.id ?? capability?.name, 'capability')}`;
  const riskPolicyId = `governance-policy:${safeIdPart(capability?.id ?? capability?.name, 'capability')}`;
  const impactScope = impactScopeForCapability(capability, {
    operationKind,
    destructive,
    payment,
    highRisk: highRiskAction,
  });
  const confirmationPolicy = confirmationPolicyForContract({
    destructive,
    payment,
    highRisk: highRiskAction,
    disposition,
    gates: executionGates,
  });
  const auditPolicy = auditPolicyForContract({
    destructive,
    payment,
    highRisk: highRiskAction,
    disposition,
    riskLevel,
  });
  const executionPrerequisites = executionPrerequisitesForCapability(capability, {
    destructive,
    payment,
    highRisk: highRiskAction,
    sessionRequired,
    authRequired: sessionRequired,
  });
  return {
    schemaVersion: BUILD_SCHEMA_VERSION,
    id: contractId,
    artifactFamily: 'siteforge-execution-contract',
    siteId: context?.site?.id ?? capability?.siteId ?? null,
    capabilityId: capability?.id ?? null,
    executionPlanId: plan?.id ?? null,
    intentIds: intents.map((intent) => intent.id).filter(Boolean),
    operationKind,
    riskLevel,
    executionDisposition: disposition,
    executionVerdict,
    executionGates,
    destructiveAction: destructive,
    highRiskAction,
    paymentOrFundsAction: payment,
    riskTags: highRiskTags({ destructive, payment, highRisk: highRiskAction }),
    impactScope,
    planCallable,
    runtimeCallable,
    autoExecutable,
    requiresConfirmation: confirmationPolicy.required,
    requiresDestructiveConfirmation: destructive,
    requiresStrongConfirmation: confirmationPolicy.strongConfirmationRequired,
    redactionRequired: true,
    requestSchemaRef: `schema:${safeIdPart(capability?.id ?? capability?.name, 'capability')}:request`,
    responseSchemaRef: `schema:${safeIdPart(capability?.id ?? capability?.name, 'capability')}:response`,
    runtimeBindingRef: runtimeBindingId,
    sessionRequirementRef: sessionRequired
      ? `session-requirement:${safeIdPart(capability?.id ?? capability?.name, 'capability')}`
      : null,
    authRequirementRef: authMaterialRequired
      ? `auth-requirement:${safeIdPart(capability?.id ?? capability?.name, 'capability')}`
      : null,
    authRequirement,
    riskPolicyRef: riskPolicyId,
    approvalPolicyRef: disposition === 'allow' ? null : `approval-policy:${safeIdPart(capability?.id ?? capability?.name, 'capability')}`,
    auditPolicyRef: disposition === 'allow' ? null : `audit-policy:${safeIdPart(capability?.id ?? capability?.name, 'capability')}`,
    executionPrerequisites,
    confirmationPolicy,
    auditPolicy,
    runtimeBinding: {
      id: runtimeBindingId,
      kind: runtimeKindForCapability(capability, plan ?? {}),
      providerId: runtimeProviderIdForCapability(context, capability, operationKind),
      adapterRef: capability?.apiAdapter?.adapterDecisionRef ?? capability?.siteAdapterRef ?? null,
      downloaderTaskDescriptor: operationKind === 'download'
        ? sanitizedDownloaderTaskDescriptor(capability, plan ?? {}, disposition)
        : null,
      credentialMaterialPolicy: 'no_raw_material',
      cookieMaterialPersisted: false,
      sessionViewPersisted: false,
    },
    payloadTemplate: payloadTemplateForCapability(capability, plan ?? {}),
    governancePolicy: {
      id: riskPolicyId,
      disposition,
      verdict: executionVerdict,
      gates: executionGates,
      auditRequired: auditPolicy.required,
      confirmationRequired: confirmationPolicy.required,
      destructiveConfirmationRequired: destructive,
      paymentConfirmationRequired: payment,
      strongConfirmationRequired: confirmationPolicy.strongConfirmationRequired,
      sitePolicyExplicitAllowRequired: destructive || payment,
      runtimeConstraintRequired: executionPrerequisites.runtimeConstraintRequired,
      naturalLanguageRequestGrantsExecution: false,
      impactScope,
      auditPolicy,
      confirmationPolicy,
      executionPrerequisites,
      sensitiveDataPolicy: 'redact_do_not_export_to_untrusted_target',
      forcedActions: findForcedDisabledActions(joinedCapabilityText(capability)),
      defaultRuntimeDispatchAllowed: highRiskAction ? false : executionVerdict === 'allow' || executionVerdict === 'controlled',
    },
  };
}

export function buildExecutionContracts({
  context,
  capabilities = /** @type {any[]} */ ([]),
  intents = /** @type {any[]} */ ([]),
} = /** @type {any} */ ({})) {
  const intentsByCapability = new Map();
  for (const intent of intents) {
    if (!intent?.capabilityId) continue;
    const rows = intentsByCapability.get(intent.capabilityId) ?? [];
    rows.push(intent);
    intentsByCapability.set(intent.capabilityId, rows);
  }
  const contracts = capabilities
    .filter((capability) => capability?.executionPlan)
    .map((capability) => buildExecutionContract({
      context,
      capability,
      intents: intentsByCapability.get(capability.id) ?? [],
    }))
    .sort((left, right) => left.id.localeCompare(right.id, 'en'));
  const byCapabilityId = new Map(contracts.map((contract) => [contract.capabilityId, contract]));
  return { contracts, byCapabilityId };
}

export function attachExecutionContractRefs({
  capabilities = /** @type {any[]} */ ([]),
  intents = /** @type {any[]} */ ([]),
  contractsByCapabilityId = new Map(),
} = /** @type {any} */ ({})) {
  const nextCapabilities = capabilities.map((capability) => {
    const contract = contractsByCapabilityId.get(capability.id);
    if (!contract) {
      return {
        ...capability,
        planCallable: false,
        runtimeCallable: false,
        autoExecutable: false,
        executionDisposition: executionDispositionForCapability(capability),
        executionVerdict: executionVerdictForDisposition(executionDispositionForCapability(capability)),
        executionGates: [],
        executionContractRef: null,
      };
    }
    return {
      ...capability,
      planCallable: contract.planCallable,
      runtimeCallable: contract.runtimeCallable,
      autoExecutable: contract.autoExecutable,
      executionDisposition: contract.executionDisposition,
      executionVerdict: contract.executionVerdict,
      executionGates: contract.executionGates,
      executionContractRef: contract.id,
      requestSchemaRef: contract.requestSchemaRef,
      runtimeBindingRef: contract.runtimeBindingRef,
    };
  });
  const nextIntents = intents.map((intent) => {
    const contract = intent?.capabilityId ? contractsByCapabilityId.get(intent.capabilityId) : null;
    if (!contract) {
      return intent;
    }
    return {
      ...intent,
      callable: contract.planCallable,
      planCallable: contract.planCallable,
      runtimeCallable: contract.runtimeCallable,
      autoExecutable: contract.autoExecutable,
      executionDisposition: contract.executionDisposition,
      executionVerdict: contract.executionVerdict,
      executionGates: contract.executionGates,
      executionContractRef: contract.id,
    };
  });
  return { capabilities: nextCapabilities, intents: nextIntents };
}

export function summarizeExecutionGovernance(contracts = /** @type {any[]} */ ([])) {
  /** @type {Record<string, any>} */
  const summary = Object.fromEntries(EXECUTION_DISPOSITIONS.map((disposition) => [disposition, 0]));
  summary.verdicts = Object.fromEntries(EXECUTION_VERDICTS.map((verdict) => [verdict, 0]));
  summary.total = 0;
  summary.planCallable = 0;
  summary.runtimeCallable = 0;
  summary.autoExecutable = 0;
  summary.highRisk = 0;
  summary.destructiveBlocked = 0;
  summary.paymentBlocked = 0;
  for (const contract of contracts) {
    const disposition = EXECUTION_DISPOSITIONS.includes(contract.executionDisposition) ? contract.executionDisposition : 'blocked';
    const verdict = executionVerdictForDisposition(contract.executionVerdict ?? disposition);
    summary[disposition] += 1;
    summary.verdicts[verdict] += 1;
    summary.total += 1;
    if (contract.planCallable === true) summary.planCallable += 1;
    if (contract.runtimeCallable === true) summary.runtimeCallable += 1;
    if (contract.autoExecutable === true) summary.autoExecutable += 1;
    if (contract.highRiskAction === true) summary.highRisk += 1;
    if (contract.destructiveAction === true && contract.executionDisposition === 'blocked') summary.destructiveBlocked += 1;
    if (contract.paymentOrFundsAction === true && contract.executionDisposition === 'blocked') summary.paymentBlocked += 1;
  }
  return summary;
}

function confirmationSatisfied(context = /** @type {any} */ ({}), contract = /** @type {any} */ ({})) {
  const requiresConfirmation = contract.executionDisposition === 'confirm_required'
    || contract.confirmationPolicy?.required === true
    || (Array.isArray(contract.executionGates) && contract.executionGates.includes('confirm_required'));
  if (!requiresConfirmation) {
    return true;
  }
  const confirm = String(context.options?.confirmRisk ?? '').trim();
  return confirm && (confirm === contract.id || confirm === contract.capabilityId || confirm === 'all');
}

function highRiskPolicyFlag(contract = /** @type {any} */ ({})) {
  if (contract.destructiveAction === true) return 'allowDestructiveActions';
  if (contract.paymentOrFundsAction === true) return 'allowPaymentActions';
  return null;
}

function hasExplicitSitePolicyAllow(context = /** @type {any} */ ({}), contract = /** @type {any} */ ({})) {
  const flag = highRiskPolicyFlag(contract);
  if (!flag) {
    return { satisfied: true, source: null, requiredFlag: null };
  }
  if (contract.paymentOrFundsAction === true) {
    return {
      satisfied: false,
      source: null,
      requiredFlag: 'payment_authorization_policy_unavailable',
    };
  }
  const candidates = [
    ['context.policy', context.policy?.[flag]],
    ['context.siteCapabilityConfig', context.siteCapabilityConfig?.[flag]],
    ['context.capabilityConfig', context.capabilityConfig?.[flag]],
    ['context.setupProfile.safety', context.setupProfile?.safety?.[flag]],
  ];
  const match = candidates.find(([, value]) => value === true);
  return {
    satisfied: Boolean(match),
    source: match?.[0] ?? null,
    requiredFlag: flag,
  };
}

function exactConfirmationRefSatisfied(value, contract = /** @type {any} */ ({})) {
  const confirm = String(value ?? '').trim();
  return Boolean(confirm) && (confirm === contract.id || confirm === contract.capabilityId);
}

function destructiveConfirmationInputSatisfied(context = /** @type {any} */ ({}), contract = /** @type {any} */ ({})) {
  return context.options?.confirmDestructive === true
    || exactConfirmationRefSatisfied(context.options?.confirmDestructive, contract);
}

function hasStrongHighRiskConfirmation(context = /** @type {any} */ ({}), contract = /** @type {any} */ ({})) {
  if (contract.highRiskAction !== true && contract.destructiveAction !== true && contract.paymentOrFundsAction !== true) {
    return { satisfied: true, source: null, phraseAccepted: false };
  }
  const destructive = contract.destructiveAction === true;
  const payment = contract.paymentOrFundsAction === true;
  const refSatisfied = destructive
    ? destructiveConfirmationInputSatisfied(context, contract)
    : exactConfirmationRefSatisfied(payment ? context.options?.confirmPayment : context.options?.confirmRisk, contract);
  if (!destructive && !payment) {
    return {
      satisfied: refSatisfied,
      source: refSatisfied ? 'confirm_risk_exact_ref' : null,
      phraseAccepted: false,
    };
  }
  const phrase = String(
    context.options?.confirmExecutionPhrase
      ?? (destructive ? context.options?.confirmDestructivePhrase : context.options?.confirmPaymentPhrase)
      ?? '',
  ).trim();
  const expectedPhrase = destructive ? STRONG_DESTRUCTIVE_CONFIRMATION_PHRASE : STRONG_PAYMENT_CONFIRMATION_PHRASE;
  const phraseAccepted = phrase === expectedPhrase;
  const runtimeFlag = destructive
    ? context.options?.allowDestructiveExecution === true
    : context.options?.allowPaymentExecution === true;
  return {
    satisfied: destructive ? refSatisfied : refSatisfied && (runtimeFlag || phraseAccepted),
    source: refSatisfied
      ? destructive
        ? 'confirm_destructive_flag'
        : runtimeFlag ? 'runtime_flag_and_exact_ref' : phraseAccepted ? 'phrase_and_exact_ref' : 'exact_ref_only'
      : null,
    phraseAccepted,
  };
}

function hasCompleteAudit(context = /** @type {any} */ ({}), contract = /** @type {any} */ ({})) {
  if (contract.auditPolicy?.required !== true && contract.governancePolicy?.auditRequired !== true) {
    return { satisfied: true, source: null };
  }
  const satisfied = context.audit?.complete === true
    || context.options?.auditExecution === true
    || context.policy?.fullExecutionAudit === true
    || (context.policy?.executionAuditRequired === true && context.policy?.redactedAuditLog === true);
  return {
    satisfied,
    source: context.audit?.complete === true
      ? 'context.audit.complete'
      : context.options?.auditExecution === true
        ? 'context.options.auditExecution'
        : context.policy?.fullExecutionAudit === true
          ? 'context.policy.fullExecutionAudit'
          : context.policy?.executionAuditRequired === true && context.policy?.redactedAuditLog === true
            ? 'context.policy.executionAuditRequired'
            : null,
  };
}

function authStateSatisfiesRuntimeConstraint(authStateReport = /** @type {any} */ ({})) {
  const status = normalizeToken(
    authStateReport.authVerificationStatus
      ?? authStateReport.status
      ?? authStateReport.verificationStatus
      ?? authStateReport.sessionStatus,
  );
  return authStateReport.verified === true
    || authStateReport.authenticated === true
    || authStateReport.canUseAuthenticatedRuntime === true
    || ['verified', 'passed', 'authenticated', 'browser_verified', 'cookie_verified', 'session_available'].includes(status);
}

function hasRuntimeConstraintsSatisfied(context = /** @type {any} */ ({}), contract = /** @type {any} */ ({})) {
  const sessionRequired = Boolean(contract.sessionRequirementRef);
  const authRequired = Boolean(contract.authRequirementRef);
  const runtimeSessionAvailable = Boolean(
    context.runtimeSessionAuth?.sessionHandle
    && context.runtimeExecutionContext?.sessionVault,
  );
  const sessionSatisfied = !sessionRequired
    || context.session?.available === true
    || runtimeSessionAvailable
    || context.runtimeConstraints?.sessionSatisfied === true
    || authStateSatisfiesRuntimeConstraint(context.authStateReport);
  const authSatisfied = !authRequired
    || runtimeSessionAvailable
    || context.runtimeConstraints?.authSatisfied === true
    || authStateSatisfiesRuntimeConstraint(context.authStateReport);
  const executionGrantSatisfied = contract.highRiskAction !== true
    || context.runtimeConstraints?.executionGrantSatisfied === true
    || context.options?.highRiskExecutionGrant === true
    || (contract.destructiveAction === true && context.options?.destructiveExecutionGrant === true)
    || (
      contract.destructiveAction === true
      && context.options?.execute === true
      && destructiveConfirmationInputSatisfied(context, contract)
    );
  return {
    satisfied: sessionSatisfied && authSatisfied && executionGrantSatisfied,
    sessionSatisfied,
    authSatisfied,
    executionGrantSatisfied,
    sessionRequired,
    authRequired,
  };
}

function evaluateHighRiskGovernanceGates(context = /** @type {any} */ ({}), contract = /** @type {any} */ ({})) {
  const sitePolicy = hasExplicitSitePolicyAllow(context, contract);
  const strongConfirmation = hasStrongHighRiskConfirmation(context, contract);
  const audit = hasCompleteAudit(context, contract);
  const runtimeConstraints = hasRuntimeConstraintsSatisfied(context, contract);
  const planCallable = { satisfied: contract.planCallable === true };
  const gates = {
    sitePolicyExplicitAllow: sitePolicy,
    strongConfirmation,
    completeAudit: audit,
    runtimeConstraints,
    planCallable,
    naturalLanguageRequestGrantsExecution: false,
  };
  return {
    ...gates,
    allSatisfied: sitePolicy.satisfied === true
      && strongConfirmation.satisfied === true
      && audit.satisfied === true
      && runtimeConstraints.satisfied === true
      && planCallable.satisfied === true,
  };
}

function highRiskBlockedReasonCode(contract = /** @type {any} */ ({}), gates = /** @type {any} */ ({})) {
  if (gates.planCallable?.satisfied !== true) return 'execution.plan_not_callable';
  if (gates.sitePolicyExplicitAllow?.satisfied !== true) {
    return contract.destructiveAction === true
      ? 'execution.destructive_default_blocked'
      : 'execution.payment_default_blocked';
  }
  if (gates.strongConfirmation?.satisfied !== true) return 'execution.strong_confirmation_required';
  if (gates.completeAudit?.satisfied !== true) return 'execution.audit_required';
  if (gates.runtimeConstraints?.satisfied !== true) return 'execution.runtime_constraints_required';
  return 'execution.policy_blocked';
}

function gateStatusForDecision({
  gates = /** @type {string[]} */ ([]),
  highRiskGates = null,
  confirmationRequired = false,
} = {}) {
  const status = {};
  for (const gate of gates) {
    if (gate === 'confirm_required') {
      status[gate] = {
        satisfied: highRiskGates
          ? highRiskGates.strongConfirmation?.satisfied === true
          : confirmationRequired !== true,
      };
      continue;
    }
    if (gate === 'audit_required') {
      status[gate] = {
        satisfied: highRiskGates ? highRiskGates.completeAudit?.satisfied === true : false,
      };
      continue;
    }
    if (gate === 'session_required') {
      status[gate] = {
        satisfied: highRiskGates
          ? highRiskGates.runtimeConstraints?.sessionSatisfied === true
            && highRiskGates.runtimeConstraints?.authSatisfied !== false
          : false,
      };
      continue;
    }
    if (gate === 'permission_required') {
      status[gate] = {
        satisfied: highRiskGates
          ? highRiskGates.sitePolicyExplicitAllow?.satisfied === true
            && highRiskGates.runtimeConstraints?.executionGrantSatisfied === true
          : false,
      };
      continue;
    }
    if (gate === 'dry_run_required') {
      status[gate] = { satisfied: false };
    }
  }
  return {
    ...status,
    allSatisfied: gates.every((gate) => status[gate]?.satisfied === true),
  };
}

export function evaluateExecutionGovernance({
  context,
  contracts = /** @type {any[]} */ ([]),
} = /** @type {any} */ ({})) {
  const decisions = contracts.map((contract) => {
    const highRisk = contract.highRiskAction === true
      || contract.destructiveAction === true
      || contract.paymentOrFundsAction === true;
    const highRiskGates = highRisk ? evaluateHighRiskGovernanceGates(context, contract) : null;
    const confirmationRequired = !confirmationSatisfied(context, contract);
    const contractVerdict = executionVerdictForDisposition(contract.executionVerdict ?? contract.executionDisposition);
    const contractGates = Array.isArray(contract.executionGates)
      ? contract.executionGates
      : executionGatesForContract({
        disposition: contract.executionDisposition,
        destructive: contract.destructiveAction === true,
        payment: contract.paymentOrFundsAction === true,
        sessionRequired: Boolean(contract.sessionRequirementRef),
        operationKind: contract.operationKind,
        riskLevel: contract.riskLevel,
      });
    const highRiskCanEnterControlledPath = highRiskGates?.planCallable?.satisfied === true
      && highRiskGates?.sitePolicyExplicitAllow?.satisfied === true;
    const effectiveVerdict = highRisk
      ? highRiskCanEnterControlledPath ? 'controlled' : 'blocked'
      : contract.planCallable === true ? contractVerdict : 'blocked';
    const gateStatus = gateStatusForDecision({
      gates: contractGates,
      highRiskGates,
      confirmationRequired,
    });
    const baseRuntimeDispatchAllowed = contract.planCallable === true && (
      effectiveVerdict === 'allow'
      || (effectiveVerdict === 'controlled' && gateStatus.allSatisfied === true)
    );
    const runtimeDispatchAllowed = highRisk
      ? effectiveVerdict === 'controlled' && highRiskGates?.allSatisfied === true
      : baseRuntimeDispatchAllowed;
    const effectiveDisposition = effectiveVerdict;
    const decisionReasonCode = highRisk
      ? runtimeDispatchAllowed
        ? 'execution.high_risk_controlled_dispatch_allowed'
        : highRiskBlockedReasonCode(contract, highRiskGates)
      : confirmationRequired
        ? 'execution.confirmation_required'
        : runtimeDispatchAllowed
          ? 'execution.runtime_dispatch_allowed'
          : 'execution.policy_blocked';
    return {
      schemaVersion: BUILD_SCHEMA_VERSION,
      id: `execution-governance:${safeIdPart(contract.capabilityId ?? contract.id, 'capability')}`,
      artifactFamily: 'siteforge-execution-governance-decision',
      contractRef: contract.id,
      capabilityId: contract.capabilityId,
      executionPlanId: contract.executionPlanId,
      verdict: effectiveVerdict,
      gates: contractGates,
      gateStatus,
      disposition: effectiveDisposition,
      requestedNaturalLanguageTask: context?.options?.executionTask ? 'present_not_authorization' : 'absent',
      naturalLanguageRequestGrantsExecution: false,
      highRiskAction: highRisk,
      destructiveAction: contract.destructiveAction === true,
      paymentOrFundsAction: contract.paymentOrFundsAction === true,
      impactScope: contract.impactScope ?? null,
      runtimeDispatchAllowed,
      siteAdapterInvocationAllowed: runtimeDispatchAllowed && ['site_adapter', 'api_adapter', 'browser_bridge'].includes(contract.runtimeBinding?.kind),
      downloaderInvocationAllowed: runtimeDispatchAllowed && contract.runtimeBinding?.kind === 'downloader',
      sessionContextUseAllowed: runtimeDispatchAllowed && Boolean(contract.sessionRequirementRef),
      sessionMaterializationAllowed: false,
      artifactWriteAllowed: true,
      auditRequired: contract.governancePolicy?.auditRequired === true,
      confirmationRequired,
      strongConfirmationRequired: highRisk ? highRiskGates?.strongConfirmation?.satisfied !== true : false,
      destructiveConfirmationRequired: contract.destructiveAction === true && highRiskGates?.strongConfirmation?.satisfied !== true,
      paymentConfirmationRequired: contract.paymentOrFundsAction === true && highRiskGates?.strongConfirmation?.satisfied !== true,
      sitePolicyExplicitAllowRequired: highRisk ? highRiskGates?.sitePolicyExplicitAllow?.satisfied !== true : false,
      completeAuditRequired: highRisk ? highRiskGates?.completeAudit?.satisfied !== true : false,
      runtimeConstraintsRequired: highRisk ? highRiskGates?.runtimeConstraints?.satisfied !== true : false,
      governanceGates: highRiskGates,
      auditPolicy: contract.auditPolicy ?? null,
      executionPrerequisites: contract.executionPrerequisites ?? null,
      sensitiveMaterialPolicy: 'no_raw_material_persistence',
      reasonCode: decisionReasonCode,
    };
  });
  return {
    schemaVersion: BUILD_SCHEMA_VERSION,
    artifactFamily: 'siteforge-execution-governance',
    buildId: context?.buildId ?? null,
    siteId: context?.site?.id ?? null,
    decisions,
    summary: summarizeExecutionGovernance(contracts),
  };
}

function intentTexts(intent = /** @type {any} */ ({})) {
  return [
    intent.id,
    intent.name,
    intent.description,
    intent.canonicalUtterance,
    ...(Array.isArray(intent.utteranceExamples) ? intent.utteranceExamples : []),
  ].map((value) => String(value ?? '').trim()).filter(Boolean);
}

function contractIntentTexts(contract = /** @type {any} */ ({}), intentIndex = /** @type {any} */ ({})) {
  const byId = intentIndex.byId ?? new Map();
  const byCapabilityId = intentIndex.byCapabilityId ?? new Map();
  const texts = [
    contract.id,
    contract.capabilityId,
    contract.executionPlanId,
    contract.operationKind,
    contract.contractKind,
  ].map((value) => String(value ?? '').trim()).filter(Boolean);
  for (const intentId of Array.isArray(contract.intentIds) ? contract.intentIds : []) {
    const intent = byId.get(intentId);
    if (intent) {
      texts.push(...intentTexts(intent));
    }
  }
  for (const intent of byCapabilityId.get(contract.capabilityId) ?? []) {
    texts.push(...intentTexts(intent));
  }
  return [...new Set(texts)];
}

function buildIntentIndex(intents = /** @type {any[]} */ ([])) {
  const byId = new Map();
  const byCapabilityId = new Map();
  for (const intent of Array.isArray(intents) ? intents : []) {
    if (!intent || typeof intent !== 'object') {
      continue;
    }
    if (intent.id) {
      byId.set(intent.id, intent);
    }
    if (intent.capabilityId) {
      const group = byCapabilityId.get(intent.capabilityId) ?? [];
      group.push(intent);
      byCapabilityId.set(intent.capabilityId, group);
    }
  }
  return { byId, byCapabilityId };
}

function capabilityIntentTexts(capability = /** @type {any} */ ({}), intentIndex = /** @type {any} */ ({})) {
  const byCapabilityId = intentIndex.byCapabilityId ?? new Map();
  const texts = [
    capability.id,
    capability.name,
    capability.user_facing_name,
    capability.userFacingName,
    capability.description,
    capability.action,
    capability.object,
  ].map((value) => String(value ?? '').trim()).filter(Boolean);
  for (const intent of byCapabilityId.get(capability.id) ?? []) {
    texts.push(...intentTexts(intent));
  }
  return [...new Set(texts)];
}

function isBlockedTaskCapability(capability = /** @type {any} */ ({})) {
  return capability.status === 'disabled'
    || capability.enabled_status === 'disabled'
    || capability.executionDisposition === 'blocked'
    || capability.runtimeCallable === false
    || capability.callable === false;
}

function selectBlockedCapabilityForTask(task, capabilities = /** @type {any[]} */ ([]), intents = /** @type {any[]} */ ([])) {
  const normalizedTask = normalizeToken(task);
  if (!normalizedTask || !Array.isArray(capabilities) || capabilities.length === 0) {
    return null;
  }
  const intentIndex = buildIntentIndex(intents);
  const scored = capabilities
    .filter(isBlockedTaskCapability)
    .map((capability) => {
      const score = capabilityIntentTexts(capability, intentIndex)
        .reduce((best, text) => Math.max(best, dispatchTextScore(task, text)), 0);
      return { capability, score };
    })
    .filter((entry) => entry.score >= 800)
    .sort((left, right) => right.score - left.score);
  return scored[0] ?? null;
}

function contractTaskScore(task, contract = /** @type {any} */ ({}), intents = /** @type {any[]} */ ([])) {
  if (!contract) {
    return 0;
  }
  const normalizedTask = normalizeToken(task);
  if (
    normalizedTask
    && (
      normalizeToken(contract.capabilityId) === normalizedTask
      || normalizeToken(contract.id) === normalizedTask
      || contract.intentIds?.some((intentId) => normalizeToken(intentId) === normalizedTask)
    )
  ) {
    return Number.POSITIVE_INFINITY;
  }
  const intentIndex = buildIntentIndex(intents);
  return contractIntentTexts(contract, intentIndex)
    .reduce((best, text) => Math.max(best, dispatchTextScore(task, text)), 0);
}

function selectContractForTask(task, contracts = /** @type {any[]} */ ([]), intents = /** @type {any[]} */ ([])) {
  const normalizedTask = normalizeToken(task);
  if (!normalizedTask) {
    return null;
  }
  const exactMatch = contracts.find((contract) => (
    normalizeToken(contract.capabilityId) === normalizedTask
    || normalizeToken(contract.id) === normalizedTask
    || contract.intentIds?.some((intentId) => normalizeToken(intentId) === normalizedTask)
  ));
  if (exactMatch) {
    return exactMatch;
  }
  const idMatch = contracts.find((contract) => (
    normalizeToken(contract.capabilityId).includes(normalizedTask)
    || normalizeToken(contract.id).includes(normalizedTask)
  ));
  if (idMatch) {
    return idMatch;
  }
  const intentIndex = buildIntentIndex(intents);
  const scored = contracts
    .map((contract) => {
      const score = contractIntentTexts(contract, intentIndex)
        .reduce((best, text) => Math.max(best, dispatchTextScore(task, text)), 0);
      return { contract, score };
    })
    .filter((entry) => entry.score >= 250)
    .sort((left, right) => right.score - left.score);
  if (scored.length > 0) {
    return scored[0].contract;
  }
  return contracts.find((contract) => downloadBookTaskMatchesContract(task, contract)) ?? null;
}

function taskCompositionSegments(task) {
  const text = String(task ?? '').trim();
  if (!text) {
    return [];
  }
  const normalized = text
    .replace(/\s*(?:->|=>|＞|→)\s*/gu, ' then ')
    .replace(/\b(?:and\s+then|then)\b/giu, ' then ')
    .replace(/(?:然后|接着|再|并且随后|随后)/gu, ' then ');
  const segments = normalized
    .split(/\bthen\b/giu)
    .map((segment) => segment.trim())
    .filter(Boolean);
  return segments.length > 1 ? segments : [];
}

function buildRuntimeStepForSelection({
  context,
  taskSegment,
  selected,
  governance,
  executeRequested,
}) {
  const decision = selected
    ? governance?.decisions?.find((candidate) => candidate.contractRef === selected.id) ?? null
    : null;
  const requiredGates = selected && decision ? runtimeTaskGatesForContract(selected, decision) : [];
  const runtimeVerdict = selected && decision ? runtimeTaskVerdictForContract(selected, decision, requiredGates) : null;
  const stepContext = {
    ...context,
    options: {
      ...(context?.options ?? {}),
      executionTask: taskSegment,
    },
  };
  const runtimeGateStatus = selected && decision
    ? runtimeGateStatusForContract(stepContext, selected, decision, requiredGates)
    : null;
  const runtimeInvocationRequest = selected && decision
    ? createRuntimeRequestForSelection({
      context: stepContext,
      selected,
      decision,
      runtimeVerdict,
      requiredGates,
    })
    : null;
  const runtimePolicyDecision = executeRequested && runtimeInvocationRequest && selected && decision
    ? createRuntimePolicyDecision({
      context: stepContext,
      selected,
      decision,
      runtimeVerdict,
      requiredGates,
      runtimeGateStatus,
      executeRequested,
    })
    : null;
  const runtimeDecision = runtimeInvocationRequest && runtimePolicyDecision
    ? evaluateRuntimeInvocationDispatch({
      invocationRequest: runtimeInvocationRequest,
      policyDecision: runtimePolicyDecision,
      gateStatus: runtimeGateStatus,
    })
    : null;
  return {
    selected,
    decision,
    requiredGates,
    runtimeVerdict,
    runtimeGateStatus,
    runtimeInvocationRequest,
    runtimePolicyDecision,
    runtimeDecision,
    runtimeDispatchAllowed: runtimeDecision?.runtimeDispatchAllowed === true,
  };
}

function buildTaskCompositionPlan({
  context,
  contracts = /** @type {any[]} */ ([]),
  intents = /** @type {any[]} */ ([]),
  governance,
  executeRequested = false,
}) {
  const task = context?.options?.executionTask ?? null;
  const segments = taskCompositionSegments(task);
  if (segments.length < 2) {
    return null;
  }
  const steps = segments.map((segment, index) => {
    const selected = selectContractForTask(segment, contracts, intents);
    const runtime = buildRuntimeStepForSelection({
      context,
      taskSegment: segment,
      selected,
      governance,
      executeRequested,
    });
    return {
      index: index + 1,
      taskSegment: segment,
      selectedContractRef: selected?.id ?? null,
      selectedCapabilityId: selected?.capabilityId ?? null,
      selectedVerdict: runtime.runtimeVerdict ?? runtime.decision?.verdict ?? null,
      selectedGates: runtime.requiredGates,
      selectedGateStatus: runtime.runtimeGateStatus ?? runtime.decision?.gateStatus ?? null,
      runtimeDispatchAllowed: runtime.runtimeDispatchAllowed,
      runtimeInvocationRequest: runtime.runtimeInvocationRequest,
      runtimePolicyDecision: runtime.runtimePolicyDecision,
      runtimeDecision: runtime.runtimeDecision,
      status: !selected
        ? 'blocked_step_not_resolved'
        : executeRequested
          ? runtime.runtimeDecision?.status ?? 'blocked_by_runtime'
          : 'planned_no_execute_flag',
      contextTransfer: {
        inputFromPreviousStep: index === 0 ? null : {
          stepIndex: index,
          fields: [
            'capabilityId',
            'executionContractRef',
            'resultSummary',
            'artifactRefs',
          ],
        },
        outputToNextStep: index === segments.length - 1 ? null : {
          stepIndex: index + 2,
          fields: [
            'capabilityId',
            'executionContractRef',
            'resultSummary',
            'artifactRefs',
          ],
        },
      },
    };
  });
  const unresolved = steps.filter((step) => !step.selectedContractRef);
  const blocked = steps.filter((step) => step.selectedContractRef && executeRequested && step.runtimeDispatchAllowed !== true);
  const allResolved = unresolved.length === 0;
  const allDispatchAllowed = allResolved && (!executeRequested || blocked.length === 0);
  return {
    plan: {
      schemaVersion: BUILD_SCHEMA_VERSION,
      artifactFamily: 'siteforge-task-composition-plan',
      task,
      status: !allResolved
        ? 'blocked_composition_step_not_resolved'
        : !executeRequested
          ? 'planned_composition_no_execute_flag'
          : allDispatchAllowed
            ? 'ready_for_composed_runtime'
            : 'blocked_composition_runtime',
      stepCount: steps.length,
      steps,
      contextTransfer: {
        status: allResolved ? 'modeled' : 'blocked_by_unresolved_step',
        requiredFields: [
          'capabilityId',
          'executionContractRef',
          'resultSummary',
          'artifactRefs',
        ],
      },
      summary: {
        resolvedSteps: steps.filter((step) => step.selectedContractRef).length,
        unresolvedSteps: unresolved.length,
        runtimeDispatchAllowedSteps: steps.filter((step) => step.runtimeDispatchAllowed === true).length,
        blockedSteps: blocked.length,
      },
    },
    primaryContract: steps.at(-1)?.selectedContractRef
      ? contracts.find((contract) => contract.id === steps.at(-1).selectedContractRef) ?? null
      : null,
  };
}

function downloadBookTaskMatchesContract(task, contract = /** @type {any} */ ({})) {
  const taskText = String(task ?? '');
  if (!taskText) return false;
  const descriptor = contract.runtimeBinding?.downloaderTaskDescriptor ?? {};
  if (
    contract.operationKind !== 'download'
    || contract.runtimeBinding?.kind !== 'downloader'
    || descriptor.taskType !== 'book'
  ) {
    return false;
  }
  return /下载|导出|提取|保存|正文|小说|作品|全书|txt|download|export|extract|book|novel|text/iu.test(taskText);
}

function allGateStatusSatisfied(gates = /** @type {string[]} */ ([]), gateStatus = /** @type {any} */ ({})) {
  return gates.every((gate) => gateStatus?.[gate]?.satisfied === true);
}

function runtimeTaskGatesForContract(contract = /** @type {any} */ ({}), decision = /** @type {any} */ ({})) {
  return uniqueExecutionGates([
    ...(Array.isArray(decision.gates) ? decision.gates : []),
    contract.confirmationPolicy?.required === true && contract.highRiskAction !== true ? 'confirm_required' : null,
  ]);
}

function runtimeTaskVerdictForContract(contract = /** @type {any} */ ({}), decision = /** @type {any} */ ({}), gates = /** @type {string[]} */ ([])) {
  if (contract.paymentOrFundsAction === true) {
    return 'blocked';
  }
  const verdict = EXECUTION_VERDICTS.includes(decision?.verdict) ? decision.verdict : 'blocked';
  if (verdict === 'allow' && gates.length > 0) {
    return 'controlled';
  }
  return verdict;
}

function runtimeGateStatusForContract(context = /** @type {any} */ ({}), contract = /** @type {any} */ ({}), decision = /** @type {any} */ ({}), gates = /** @type {string[]} */ ([])) {
  const status = { ...(decision.gateStatus ?? {}) };
  const executeRequested = context.options?.execute === true;
  const taskSelected = Boolean(context.options?.executionTask);
  for (const gate of gates) {
    if (status[gate]?.satisfied === true) {
      continue;
    }
    if (gate === 'audit_required' && contract.highRiskAction !== true) {
      status[gate] = { satisfied: executeRequested === true, source: executeRequested ? 'runtime_dispatch_audit' : null };
      continue;
    }
    if (gate === 'permission_required' && contract.highRiskAction !== true) {
      status[gate] = { satisfied: executeRequested === true && taskSelected, source: executeRequested && taskSelected ? 'task_execute_request' : null };
      continue;
    }
    if (gate === 'output_path_required') {
      status[gate] = {
        satisfied: executeRequested === true && Boolean(context.artifactStore?.buildDir ?? context.buildDir),
        source: executeRequested === true ? 'siteforge_artifact_store' : null,
      };
      continue;
    }
    if (gate === 'session_required') {
      const runtimeConstraints = hasRuntimeConstraintsSatisfied(context, contract);
      status[gate] = {
        satisfied: runtimeConstraints.sessionSatisfied === true && runtimeConstraints.authSatisfied !== false,
        source: runtimeConstraints.sessionSatisfied === true ? 'runtime_session_context' : null,
      };
      continue;
    }
    if (gate === 'confirm_required' && contract.highRiskAction !== true) {
      const confirm = String(context.options?.confirmRisk ?? '').trim();
      status[gate] = {
        satisfied: contract.confirmationPolicy?.required !== true
          || confirm === contract.id
          || confirm === contract.capabilityId,
        source: confirm ? 'confirm_risk_ref' : null,
      };
    }
  }
  return {
    ...status,
    allSatisfied: allGateStatusSatisfied(gates, status),
  };
}

function runtimeDispatchStatus({
  executeRequested = false,
  task = null,
  selected = null,
  runtimeDecision = null,
} = {}) {
  if (!task) {
    return executeRequested ? 'blocked_task_required' : 'compiled_no_task';
  }
  if (!selected) {
    return 'blocked_task_not_resolved';
  }
  if (!executeRequested) {
    return 'planned_no_execute_flag';
  }
  return runtimeDecision?.status ?? 'blocked_by_runtime';
}

function runtimeExecutionReason(status) {
  if (status === 'compiled_no_task') {
    return 'build compiled capabilities and did not request task execution';
  }
  if (status === 'planned_no_execute_flag') {
    return 'task plan and RuntimeInvocationRequest generated; --execute was not provided';
  }
  if (status === 'blocked_task_required') {
    return '--execute requires --task';
  }
  if (status === 'blocked_task_not_resolved') {
    return 'task did not resolve to a compiled execution contract';
  }
  if (status === 'blocked_task_policy_disabled') {
    return 'task matched a disabled capability and cannot be dispatched to runtime';
  }
  if (status === 'ready_for_direct_runtime' || status === 'ready_for_controlled_runtime') {
    return 'runtime decision allows dispatch; side-effect provider execution remains inside app/runtime boundary';
  }
  return status ?? 'runtime_not_requested';
}

function blockedTaskRuntimeReason(blockedSelection = null) {
  const capability = blockedSelection?.capability ?? null;
  if (!capability) {
    return 'task matched a disabled capability and cannot be dispatched to runtime';
  }
  const reason = capability.activationBlockedReason
    ?? capability.disabledReason
    ?? capability.riskPolicy?.reasonCode
    ?? capability.safe_remediation_path
    ?? capability.enabled_status
    ?? 'disabled';
  return `task matched disabled capability ${capability.id}; runtime dispatch blocked by ${reason}`;
}

function createRuntimeRequestForSelection({
  context,
  selected,
  decision,
  runtimeVerdict,
  requiredGates,
}) {
  if (!selected || !decision) {
    return null;
  }
  const runtimeContractRef = runtimeContractRefForSelection(selected);
  const runtimeSessionAuth = context?.runtimeSessionAuth ?? null;
  const requestAuth = selected.authRequirement?.required === true && runtimeSessionAuth?.sessionHandle
    ? {
      sessionHandle: runtimeSessionAuth.sessionHandle,
      authGate: {
        satisfied: true,
        source: runtimeSessionAuth.source ?? 'ephemeral_runtime_session',
      },
    }
    : undefined;
  return createRuntimeInvocationRequest({
    capabilityPlan: {
      siteId: safeRefIdPart(selected.siteId ?? context?.site?.id ?? 'site', 'site'),
      capabilityId: selected.capabilityId,
      executionContractRef: runtimeContractRef,
      planId: `plan:${safeRefIdPart(selected.executionPlanId ?? selected.capabilityId, 'plan')}`,
    },
    executionIntent: selected.intentIds?.[0]
      ? {
        id: safeRefIdPart(selected.intentIds[0], 'intent'),
        capabilityId: selected.capabilityId,
        executionContractRef: runtimeContractRef,
      }
      : null,
    executionContractRef: runtimeContractRef,
    policyDecisionRef: `policy:${safeRefIdPart(decision.id, 'decision')}`,
    verdictHint: runtimeVerdict,
    requiredGates,
    taskId: context?.options?.executionTask ? `task:${safeRefIdPart(context.options.executionTask, 'task')}` : undefined,
    traceId: context?.buildId ? `trace:${safeRefIdPart(context.buildId, 'build')}` : undefined,
    correlationId: context?.buildId ? `correlation:${safeRefIdPart(context.buildId, 'build')}` : undefined,
    auth: requestAuth,
  });
}

function createRuntimePolicyDecision({
  context,
  selected,
  decision,
  runtimeVerdict,
  requiredGates,
  runtimeGateStatus,
  executeRequested,
}) {
  if (!selected || !decision) {
    return null;
  }
  const runtimeDispatchAllowed = executeRequested === true
    && runtimeVerdict !== 'blocked'
    && runtimeGateStatus.allSatisfied === true;
  return createGovernedExecutionPolicyDecision({
    executionId: `execution:${safeRefIdPart(context?.buildId ?? selected.id, 'build')}:${safeRefIdPart(selected.capabilityId, 'capability')}`,
    capabilityId: selected.capabilityId,
    executionContractRef: runtimeContractRefForSelection(selected),
    verdict: runtimeVerdict,
    gates: requiredGates,
    gateStatus: runtimeGateStatus,
    runtimeDispatchAllowed,
    siteAdapterInvocationAllowed: runtimeDispatchAllowed && ['site_adapter', 'api_adapter', 'browser_bridge', 'public_http'].includes(selected.runtimeBinding?.kind),
    downloaderInvocationAllowed: runtimeDispatchAllowed && selected.runtimeBinding?.kind === 'downloader',
    sessionContextUseAllowed: runtimeDispatchAllowed && Boolean(selected.sessionRequirementRef),
    sessionRequired: requiredGates.includes('session_required'),
    confirmationRequired: requiredGates.includes('confirm_required'),
    destructiveConfirmationRequired: selected.destructiveAction === true && requiredGates.includes('confirm_required'),
    strongConfirmationRequired: selected.highRiskAction === true && requiredGates.includes('confirm_required'),
    permissionRequired: requiredGates.includes('permission_required'),
    outputPathRequired: requiredGates.includes('output_path_required'),
    highRiskAction: selected.highRiskAction === true,
    destructiveAction: selected.destructiveAction === true,
    paymentOrFundsAction: selected.paymentOrFundsAction === true,
    governanceGates: decision.governanceGates ?? null,
    naturalLanguageRequestGrantsExecution: false,
    auditRequired: requiredGates.includes('audit_required') || decision.auditRequired === true,
    reasonCode: runtimeVerdict === 'blocked'
      ? decision.reasonCode ?? 'execution.policy_blocked'
      : runtimeDispatchAllowed
        ? 'execution.runtime_dispatch_allowed'
        : 'execution.required_gates_not_satisfied',
  });
}

export function buildRuntimeDispatchReport({
  context,
  contracts = /** @type {any[]} */ ([]),
  intents = /** @type {any[]} */ ([]),
  capabilities = /** @type {any[]} */ ([]),
  governance,
} = /** @type {any} */ ({})) {
  const executeRequested = context?.options?.execute === true;
  const task = context?.options?.executionTask ?? null;
  const composition = buildTaskCompositionPlan({
    context,
    contracts,
    intents,
    governance,
    executeRequested,
  });
  const taskCompositionPlan = composition?.plan ?? null;
  const selected = composition?.primaryContract ?? selectContractForTask(task, contracts, intents);
  const blockedSelection = selectBlockedCapabilityForTask(task, capabilities, intents);
  const selectedScore = selected ? contractTaskScore(task, selected, intents) : 0;
  if (
    blockedSelection
    && taskCompositionPlan?.status !== 'ready_for_composed_runtime'
    && (!selected || blockedSelection.score > selectedScore)
  ) {
    const capability = blockedSelection.capability;
    return {
      schemaVersion: BUILD_SCHEMA_VERSION,
      artifactFamily: 'siteforge-runtime-dispatch-report',
      buildId: context?.buildId ?? null,
      siteId: context?.site?.id ?? null,
      executeRequested,
      taskPlanningRequested: Boolean(task),
      runtimeExecutionRequested: executeRequested && Boolean(task),
      task,
      status: 'blocked_task_policy_disabled',
      taskCompositionPlan,
      runtimeInvocationRequest: null,
      runtimePolicyDecision: null,
      runtimeDecision: null,
      selectedContractRef: null,
      selectedCapabilityId: capability.id ?? null,
      selectedVerdict: 'blocked',
      selectedGates: [],
      selectedGateStatus: null,
      selectedHighRiskAction: ['write_high', 'download_high', 'account_security_critical'].includes(capability.risk_level)
        || capability.safetyLevel === 'state_changing',
      selectedImpactScope: null,
      runtimeExecuted: false,
      sideEffectAttempted: false,
      runtimeDispatchAllowed: false,
      runtimeExecutionReason: blockedTaskRuntimeReason(blockedSelection),
      decision: null,
      blockedTask: {
        capabilityId: capability.id ?? null,
        name: capability.name ?? null,
        status: capability.status ?? null,
        enabled_status: capability.enabled_status ?? null,
        executionDisposition: capability.executionDisposition ?? null,
        reasonCode: capability.activationBlockedReason
          ?? capability.disabledReason
          ?? capability.riskPolicy?.reasonCode
          ?? null,
        safe_remediation_path: capability.safe_remediation_path ?? capability.safe_remediation?.path ?? null,
        matchScore: blockedSelection.score,
      },
      executionConsent: {
        naturalLanguageRequestGrantsExecution: false,
        verdict: 'blocked',
        gates: [],
        gateStatus: null,
        sitePolicyExplicitAllowSatisfied: false,
        strongConfirmationSatisfied: false,
        completeAuditSatisfied: false,
        runtimeConstraintsSatisfied: false,
        allGovernanceGatesSatisfied: false,
        allRuntimeGatesSatisfied: false,
      },
      audit: {
        auditRequired: true,
        requiredFields: [],
        materialPersistence: {
          auth: false,
          browserState: false,
          payload: false,
        },
        replayableDecision: true,
      },
    };
  }
  const decision = selected
    ? governance?.decisions?.find((candidate) => candidate.contractRef === selected.id) ?? null
    : null;
  const requiredGates = selected && decision ? runtimeTaskGatesForContract(selected, decision) : [];
  const runtimeVerdict = selected && decision ? runtimeTaskVerdictForContract(selected, decision, requiredGates) : null;
  const runtimeGateStatus = selected && decision
    ? runtimeGateStatusForContract(context, selected, decision, requiredGates)
    : null;
  const runtimeInvocationRequest = task && selected && decision
    ? createRuntimeRequestForSelection({
      context,
      selected,
      decision,
      runtimeVerdict,
      requiredGates,
    })
    : null;
  const runtimePolicyDecision = executeRequested && runtimeInvocationRequest && selected && decision
    ? createRuntimePolicyDecision({
      context,
      selected,
      decision,
      runtimeVerdict,
      requiredGates,
      runtimeGateStatus,
      executeRequested,
    })
    : null;
  const runtimeDecision = runtimeInvocationRequest && runtimePolicyDecision
    ? evaluateRuntimeInvocationDispatch({
      invocationRequest: runtimeInvocationRequest,
      policyDecision: runtimePolicyDecision,
      gateStatus: runtimeGateStatus,
    })
    : null;
  const status = runtimeDispatchStatus({
    executeRequested,
    task,
    selected,
    runtimeDecision,
  });
  const effectiveStatus = taskCompositionPlan?.status === 'ready_for_composed_runtime'
    ? 'ready_for_composed_runtime'
    : taskCompositionPlan?.status?.startsWith?.('blocked_composition')
      ? taskCompositionPlan.status
      : status;
  const runtimeDispatchAllowed = taskCompositionPlan
    ? taskCompositionPlan.status === 'ready_for_composed_runtime'
    : runtimeDecision?.runtimeDispatchAllowed === true;
  return {
    schemaVersion: BUILD_SCHEMA_VERSION,
    artifactFamily: 'siteforge-runtime-dispatch-report',
    buildId: context?.buildId ?? null,
    siteId: context?.site?.id ?? null,
    executeRequested,
    taskPlanningRequested: Boolean(task),
    runtimeExecutionRequested: executeRequested && Boolean(task),
    task,
    status: effectiveStatus,
    taskCompositionPlan,
    runtimeInvocationRequest,
    runtimePolicyDecision,
    runtimeDecision,
    selectedContractRef: selected?.id ?? null,
    selectedCapabilityId: selected?.capabilityId ?? null,
    selectedVerdict: runtimeVerdict ?? decision?.verdict ?? null,
    selectedGates: requiredGates,
    selectedGateStatus: runtimeGateStatus ?? decision?.gateStatus ?? null,
    selectedHighRiskAction: selected
      ? selected.highRiskAction === true || selected.destructiveAction === true || selected.paymentOrFundsAction === true
      : false,
    selectedImpactScope: selected?.impactScope ?? null,
    runtimeExecuted: false,
    sideEffectAttempted: false,
    runtimeDispatchAllowed,
    runtimeExecutionReason: taskCompositionPlan?.status === 'ready_for_composed_runtime'
      ? 'runtime decision allows all composition steps; app/runtime will execute the governed read-only chain'
      : runtimeExecutionReason(effectiveStatus),
    decision,
    executionConsent: {
      naturalLanguageRequestGrantsExecution: false,
      verdict: runtimeVerdict ?? decision?.verdict ?? null,
      gates: requiredGates,
      gateStatus: runtimeGateStatus ?? decision?.gateStatus ?? null,
      sitePolicyExplicitAllowSatisfied: decision?.governanceGates?.sitePolicyExplicitAllow?.satisfied ?? null,
      strongConfirmationSatisfied: decision?.governanceGates?.strongConfirmation?.satisfied ?? null,
      completeAuditSatisfied: decision?.governanceGates?.completeAudit?.satisfied ?? null,
      runtimeConstraintsSatisfied: decision?.governanceGates?.runtimeConstraints?.satisfied ?? null,
      allGovernanceGatesSatisfied: decision?.governanceGates?.allSatisfied ?? null,
      allRuntimeGatesSatisfied: runtimeDecision?.gateEvaluation?.allSatisfied ?? runtimeGateStatus?.allSatisfied ?? null,
    },
    audit: {
      auditRequired: Boolean(decision?.auditRequired),
      requiredFields: decision?.auditPolicy?.fields ?? [],
      materialPersistence: {
        auth: false,
        browserState: false,
        payload: false,
      },
      replayableDecision: Boolean(decision),
    },
  };
}

export function buildRuntimeExecutionReport({
  context,
  dispatchReport,
  executionReport = null,
} = /** @type {any} */ ({})) {
  if (executionReport) {
    return {
      ...executionReport,
      artifactFamily: 'siteforge-runtime-execution-report',
      buildId: context?.buildId ?? executionReport.buildId ?? null,
      siteId: context?.site?.id ?? executionReport.siteId ?? null,
    };
  }
  const runtimeDecision = dispatchReport?.runtimeDecision ?? null;
  const invocationRequest = dispatchReport?.runtimeInvocationRequest ?? null;
  const gates = runtimeDecision?.gates ?? dispatchReport?.selectedGates ?? [];
  const gateStatus = runtimeDecision?.gateEvaluation?.gateStatus
    ?? dispatchReport?.selectedGateStatus
    ?? {};
  const blockedReason = dispatchReport?.status === 'compiled_no_task'
    ? 'runtime.task_not_requested'
    : dispatchReport?.status === 'planned_no_execute_flag'
      ? 'runtime.execute_flag_not_provided'
      : dispatchReport?.status === 'blocked_task_required'
        ? 'runtime.task_required'
      : dispatchReport?.status === 'blocked_task_not_resolved'
        ? 'runtime.task_not_resolved'
        : dispatchReport?.status === 'blocked_task_policy_disabled'
          ? 'runtime.policy_disabled_task'
          : dispatchReport?.runtimeDispatchAllowed === true
            ? null
            : 'runtime.dispatch_not_allowed';
  return {
    schemaVersion: invocationRequest?.schemaVersion ?? SITE_CAPABILITY_EXECUTION_SCHEMA_VERSION,
    executionVersion: invocationRequest?.executionVersion ?? SITE_CAPABILITY_EXECUTION_VERSION,
    artifactFamily: 'siteforge-runtime-execution-report',
    reportType: 'RuntimeExecutionReport',
    runtimeBoundary: 'app/runtime',
    buildId: context?.buildId ?? null,
    siteId: context?.site?.id ?? null,
    requestId: invocationRequest?.requestId ?? null,
    executionId: dispatchReport?.runtimePolicyDecision?.executionId ?? null,
    capabilityId: dispatchReport?.selectedCapabilityId ?? invocationRequest?.capabilityId ?? null,
    executionContractRef: dispatchReport?.selectedContractRef ?? invocationRequest?.executionContractRef ?? null,
    policyDecisionRef: invocationRequest?.policyDecisionRef ?? null,
    status: dispatchReport?.status ?? 'runtime_not_requested',
    verdict: runtimeDecision?.verdict ?? dispatchReport?.selectedVerdict ?? null,
    gates,
    gateStatus,
    runtimeDispatchAllowed: dispatchReport?.runtimeDispatchAllowed === true,
    providerId: null,
    providerKind: null,
    providerInvoked: false,
    executionAttempted: false,
    runtimeExecuted: false,
    sideEffectAttempted: false,
    sideEffectSucceeded: false,
    sideEffectFailed: false,
    blockedReason,
    resultSummary: null,
    sanitizedError: null,
    artifactRefs: [],
    auditRef: null,
    redactionRequired: true,
  };
}

export function buildExecutionAuditLog({
  context,
  governance,
  dispatchReport,
  runtimeExecutionReport = null,
} = /** @type {any} */ ({})) {
  return {
    schemaVersion: BUILD_SCHEMA_VERSION,
    artifactFamily: 'siteforge-execution-audit-log',
    buildId: context?.buildId ?? null,
    siteId: context?.site?.id ?? null,
    generatedAt: new Date().toISOString(),
    redactionRequired: true,
    materialPersistence: {
      auth: false,
      browserState: false,
      payload: false,
    },
    decisions: governance?.decisions?.map((decision) => ({
      id: decision.id,
      contractRef: decision.contractRef,
      capabilityId: decision.capabilityId,
      verdict: decision.verdict,
      gates: decision.gates ?? [],
      gateStatus: decision.gateStatus ?? null,
      disposition: decision.disposition,
      runtimeDispatchAllowed: decision.runtimeDispatchAllowed,
      reasonCode: decision.reasonCode,
      auditRequired: decision.auditRequired,
      highRiskAction: decision.highRiskAction === true,
      destructiveAction: decision.destructiveAction === true,
      paymentOrFundsAction: decision.paymentOrFundsAction === true,
      impactScope: decision.impactScope ?? null,
      naturalLanguageRequestGrantsExecution: false,
      governanceGates: decision.governanceGates ?? null,
      auditFields: decision.auditPolicy?.fields ?? [],
    })) ?? [],
    dispatch: {
      status: dispatchReport?.status ?? null,
      selectedContractRef: dispatchReport?.selectedContractRef ?? null,
      runtimeInvocationRequestRef: dispatchReport?.runtimeInvocationRequest?.requestId ?? null,
      runtimeDecisionStatus: dispatchReport?.runtimeDecision?.status ?? null,
      runtimeDecisionVerdict: dispatchReport?.runtimeDecision?.verdict ?? null,
      runtimeDecisionGates: dispatchReport?.runtimeDecision?.gates ?? [],
      runtimeDispatchAllowed: dispatchReport?.runtimeDispatchAllowed === true,
      runtimeExecuted: dispatchReport?.runtimeExecuted === true,
      sideEffectAttempted: dispatchReport?.sideEffectAttempted === true,
    },
    execution: runtimeExecutionReport
      ? {
        status: runtimeExecutionReport.status ?? null,
        executionId: runtimeExecutionReport.executionId ?? null,
        requestId: runtimeExecutionReport.requestId ?? null,
        providerId: runtimeExecutionReport.providerId ?? null,
        verdict: runtimeExecutionReport.verdict ?? null,
        gates: runtimeExecutionReport.gates ?? [],
        gateStatus: runtimeExecutionReport.gateStatus ?? null,
        runtimeDispatchAllowed: runtimeExecutionReport.runtimeDispatchAllowed === true,
        executionAttempted: runtimeExecutionReport.executionAttempted === true,
        sideEffectAttempted: runtimeExecutionReport.sideEffectAttempted === true,
        sideEffectSucceeded: runtimeExecutionReport.sideEffectSucceeded === true,
        sideEffectFailed: runtimeExecutionReport.sideEffectFailed === true,
        blockedReason: runtimeExecutionReport.blockedReason ?? null,
        artifactRefs: runtimeExecutionReport.artifactRefs ?? [],
        auditRef: runtimeExecutionReport.auditRef ?? null,
      }
      : null,
  };
}
