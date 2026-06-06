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
  if (disposition === 'allow') {
    return [];
  }
  const governedRisk = destructive === true || payment === true || highRisk === true || riskLevel === 'account_security_critical';
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
    endpointTemplate: step.endpoint ? String(step.endpoint).replace(/[?&](?:token|auth|sid|session|cookie|csrf|access_token|refresh_token)=[^&]+/giu, '') : null,
    slotNames: [
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
  const sessionRequired = capability?.authRequired === true
    || capability?.requiresAuth === true
    || capability?.requiresSession === true
    || capability?.requiresUserAuthorization === true
    || ['read_personal_medium', 'read_private_high', 'account_security_critical'].includes(riskLevelOf(capability));
  const executionVerdict = executionVerdictForDisposition(disposition);
  const operationKind = operationKindForPlan(capability, plan ?? {});
  const riskLevel = riskLevelOf(capability);
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
    authRequirementRef: sessionRequired
      ? `auth-requirement:${safeIdPart(capability?.id ?? capability?.name, 'capability')}`
      : null,
    riskPolicyRef: riskPolicyId,
    approvalPolicyRef: disposition === 'allow' ? null : `approval-policy:${safeIdPart(capability?.id ?? capability?.name, 'capability')}`,
    auditPolicyRef: disposition === 'allow' ? null : `audit-policy:${safeIdPart(capability?.id ?? capability?.name, 'capability')}`,
    executionPrerequisites,
    confirmationPolicy,
    auditPolicy,
    runtimeBinding: {
      id: runtimeBindingId,
      kind: runtimeKindForCapability(capability, plan ?? {}),
      providerId: capability?.providerId ?? null,
      adapterRef: capability?.apiAdapter?.adapterDecisionRef ?? capability?.siteAdapterRef ?? null,
      downloaderTaskDescriptor: operationKind === 'download' ? {
        material: 'descriptor_only',
        networkResolveAllowedAtRuntime: disposition !== 'blocked',
        savedMaterial: SANITIZED_SUMMARY_ONLY,
      } : null,
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
  const sessionSatisfied = !sessionRequired
    || context.session?.available === true
    || context.runtimeConstraints?.sessionSatisfied === true
    || authStateSatisfiesRuntimeConstraint(context.authStateReport);
  const authSatisfied = !authRequired
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

function selectContractForTask(task, contracts = /** @type {any[]} */ ([])) {
  const normalizedTask = normalizeToken(task);
  if (!normalizedTask) {
    return null;
  }
  return contracts.find((contract) => (
    normalizeToken(contract.capabilityId) === normalizedTask
    || normalizeToken(contract.id) === normalizedTask
    || contract.intentIds?.some((intentId) => normalizeToken(intentId) === normalizedTask)
  )) ?? contracts.find((contract) => (
    normalizeToken(contract.capabilityId).includes(normalizedTask)
    || normalizeToken(contract.id).includes(normalizedTask)
  )) ?? null;
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
  if (status === 'ready_for_direct_runtime' || status === 'ready_for_controlled_runtime') {
    return 'runtime decision allows dispatch; side-effect provider execution remains inside app/runtime boundary';
  }
  return status ?? 'runtime_not_requested';
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
  governance,
} = /** @type {any} */ ({})) {
  const executeRequested = context?.options?.execute === true;
  const task = context?.options?.executionTask ?? null;
  const selected = selectContractForTask(task, contracts);
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
  return {
    schemaVersion: BUILD_SCHEMA_VERSION,
    artifactFamily: 'siteforge-runtime-dispatch-report',
    buildId: context?.buildId ?? null,
    siteId: context?.site?.id ?? null,
    executeRequested,
    taskPlanningRequested: Boolean(task),
    runtimeExecutionRequested: executeRequested && Boolean(task),
    task,
    status,
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
    runtimeDispatchAllowed: runtimeDecision?.runtimeDispatchAllowed === true,
    runtimeExecutionReason: runtimeExecutionReason(status),
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
