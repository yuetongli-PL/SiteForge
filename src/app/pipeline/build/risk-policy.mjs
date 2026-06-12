// @ts-check

import crypto from 'node:crypto';
import {
  CAPABILITY_EVIDENCE_STATUSES as DOMAIN_CAPABILITY_EVIDENCE_STATUSES,
  CAPABILITY_ENABLEMENT_STATUSES as DOMAIN_CAPABILITY_ENABLEMENT_STATUSES,
  CALLABLE_ENABLEMENT_STATUSES as DOMAIN_CALLABLE_ENABLEMENT_STATUSES,
  capabilityEnablementStatusCounts as domainCapabilityEnablementStatusCounts,
  capabilityEvidenceStatusSummary as domainCapabilityEvidenceStatusSummary,
  isCallableCapabilityEnablementStatus,
  normalizeCapabilityEnablementStatusFromPolicy,
  normalizeCapabilityEvidenceStatus as normalizeDomainCapabilityEvidenceStatus,
} from '../../../domain/status/capability-status.mjs';
import {
  assertNoForbiddenPatterns,
  redactPublicIdentifierText,
  redactUrl,
} from '../../../domain/sessions/security-guard.mjs';
import { uniqueSortedStrings } from '../../../shared/normalize.mjs';

export const RISK_POLICY_SCHEMA_VERSION = 1;
export const SANITIZED_SUMMARY_ONLY = 'sanitized_summary_only';

export const RISK_LEVEL_DEFAULTS = Object.freeze({
  read_public_low: Object.freeze({
    enabled: true,
    defaultAction: 'enabled',
    executionDisposition: 'allow',
    executionGates: Object.freeze([]),
  }),
  read_personal_medium: Object.freeze({
    enabled: true,
    defaultAction: 'enabled',
    executionDisposition: 'controlled',
    executionGates: Object.freeze(['session_required']),
  }),
  read_private_high: Object.freeze({
    enabled: true,
    defaultAction: 'enabled',
    executionDisposition: 'controlled',
    executionGates: Object.freeze(['session_required', 'audit_required']),
  }),
  write_low: Object.freeze({
    enabled: true,
    defaultAction: 'enabled',
    executionDisposition: 'allow',
    executionGates: Object.freeze([]),
  }),
  write_high: Object.freeze({
    enabled: true,
    defaultAction: 'enabled',
    executionDisposition: 'allow',
    executionGates: Object.freeze([]),
  }),
  download_high: Object.freeze({
    enabled: true,
    defaultAction: 'enabled',
    executionDisposition: 'allow',
    executionGates: Object.freeze([]),
  }),
  account_security_critical: Object.freeze({
    enabled: true,
    defaultAction: 'enabled',
    executionDisposition: 'controlled',
    executionGates: Object.freeze(['confirm_required', 'audit_required', 'session_required', 'permission_required']),
  }),
});

export const CAPABILITY_ENABLEMENT_STATUSES = DOMAIN_CAPABILITY_ENABLEMENT_STATUSES;
export const CALLABLE_ENABLEMENT_STATUSES = DOMAIN_CALLABLE_ENABLEMENT_STATUSES;
export const CAPABILITY_EVIDENCE_STATUSES = DOMAIN_CAPABILITY_EVIDENCE_STATUSES;

const CAPABILITY_ENABLEMENT_STATUS_SET = new Set(CAPABILITY_ENABLEMENT_STATUSES);
const EXECUTION_DISPOSITIONS = Object.freeze(['allow', 'controlled', 'confirm_required', 'blocked']);
const EXECUTION_DISPOSITION_SET = new Set(EXECUTION_DISPOSITIONS);
const EXECUTION_GATES = Object.freeze([
  'confirm_required',
  'audit_required',
  'session_required',
  'permission_required',
  'output_path_required',
  'dry_run_required',
]);
const EXECUTION_GATE_SET = new Set(EXECUTION_GATES);

const RISK_LEVEL_SAFETY_LEVELS = Object.freeze({
  read_public_low: 'read_only',
  read_personal_medium: 'read_only',
  read_private_high: 'read_only',
  write_low: 'state_changing',
  write_high: 'state_changing',
  download_high: 'read_only',
  account_security_critical: 'state_changing',
});

export function isCallableEnablementStatus(value) {
  return isCallableCapabilityEnablementStatus(value);
}

export function normalizeCapabilityEnablementStatus(capability = /** @type {any} */ ({}), policy = capability.riskPolicy ?? createCapabilityRiskPolicy(capability)) {
  return normalizeCapabilityEnablementStatusFromPolicy(capability, policy);
}

export function normalizeCapabilityEvidenceStatus(capability = /** @type {any} */ ({}), enablementStatus = normalizeCapabilityEnablementStatus(capability)) {
  return normalizeDomainCapabilityEvidenceStatus(capability, enablementStatus);
}

export function capabilityEvidenceStatusSummary(capabilities = /** @type {any[]} */ ([])) {
  return domainCapabilityEvidenceStatusSummary(capabilities, {
    normalizeEnablementStatus: normalizeCapabilityEnablementStatus,
  });
}

export function capabilityEnablementStatusCounts(capabilities = /** @type {any[]} */ ([])) {
  return domainCapabilityEnablementStatusCounts(capabilities, {
    normalizeEnablementStatus: normalizeCapabilityEnablementStatus,
  });
}

export function riskPolicyForLevel(riskLevel = 'read_public_low') {
  const normalized = RISK_LEVEL_DEFAULTS[riskLevel] ? riskLevel : 'read_public_low';
  const defaults = RISK_LEVEL_DEFAULTS[normalized];
  return {
    schemaVersion: RISK_POLICY_SCHEMA_VERSION,
    riskLevel: normalized,
    safetyLevel: RISK_LEVEL_SAFETY_LEVELS[normalized] ?? 'read_only',
    defaultAction: defaults.defaultAction,
    defaultExecutionDisposition: defaults.executionDisposition,
    executionDisposition: defaults.executionDisposition,
    executionGates: [...(defaults.executionGates ?? [])],
    enabled: defaults.enabled === true,
    limited: defaults.limited === true,
    draftOnly: defaults.draftOnly === true,
    disabled: defaults.enabled === false,
    reasonCode: `${normalized}-${defaults.executionDisposition}`,
    forcedDisabledActions: [],
    savedMaterial: SANITIZED_SUMMARY_ONLY,
    rawContentSaved: false,
    privateContentSaved: false,
  };
}

export const FORCED_DISABLED_ACTIONS = Object.freeze([
  'delete',
  'clear',
  'empty',
  'overwrite',
  'reset',
  'cancel_order',
  'cancel_subscription',
  'void',
  'destroy',
  'purge',
  'erase',
  'revoke',
  'pay',
  'checkout',
  'purchase',
  'change_payment',
  'submit',
  'send',
  'publish',
  'contact',
  'upload',
  'save',
]);

export const EVIDENCE_SOURCE_KINDS = Object.freeze([
  'route',
  'structure',
  'control',
  'adapter',
  'network_summary',
]);

const FORCED_DISABLED_ACTION_SET = new Set(FORCED_DISABLED_ACTIONS);
const EVIDENCE_SOURCE_KIND_SET = new Set(EVIDENCE_SOURCE_KINDS);

const ACCOUNT_SECURITY_PATTERN = /change[-_\s]?(?:password|email|2fa|mfa|payment)|password|2fa|mfa|security settings|payment method|billing settings/iu;
const PRIVATE_READ_PATTERN = /direct[-_\s]?message(?:\s+(?:detail|body|conversation|conversations?|summaries?))?|private[-_\s]?message(?:\s+(?:detail|body|conversation|conversations?|summaries?))?|send[-_\s]?dm|dm conversations?|private inbox|notification (?:body|detail|content)|bookmark(?:ed)? post (?:body|detail|content)|saved item (?:body|detail|content)/iu;
const PERSONAL_READ_PATTERN = /followed|following|followers|recommended timeline|timeline posts|profile content|bookmarks?|saved items?|lists?|notifications?|notification inbox|personal|account profile|user authorized|auth required/iu;
const PRIVATE_MESSAGE_WRITE_PATTERN = /(?:direct[-_\s]?message|private[-_\s]?message|\bdm\b).*(?:draft|compose|create|send|submit)|(?:draft|compose|create|send|submit).*(?:direct[-_\s]?message|private[-_\s]?message|\bdm\b)/iu;
const WRITE_LOW_PATTERN = /contact|support|draft|form submission preview|message draft/iu;
const WRITE_HIGH_PATTERN = /\b(?:payment|purchase|checkout|delete|destructive|upload|submit|send|publish|follow|unfollow|like|repost)\b|edit profile|account mutation/iu;
const DESTRUCTIVE_ACTION_PATTERN = /\b(?:delete|remove|clear|empty|wipe|overwrite|reset|cancel[-_\s]?(?:order|subscription)|void|destroy|purge|erase|revoke|delete_account|delete_file|delete_data|delete_order|delete_record)\b|\u5220\u9664|\u79fb\u9664|\u6e05\u7a7a|\u8986\u76d6|\u91cd\u7f6e|\u6ce8\u9500|\u53d6\u6d88\u8ba2\u5355|\u9500\u6bc1|\u62b9\u9664|\u64a4\u9500|\u4f5c\u5e9f/u;
const PAYMENT_ACTION_PATTERN = /\b(?:pay|payment|checkout|purchase|billing|invoice|charge|recharge|wallet|cart|change[-_\s]?payment|payment[-_\s]?method|funds?)\b|\u652f\u4ed8|\u4ed8\u6b3e|\u4ed8\u8d39|\u5145\u503c|\u7ed3\u8d26|\u4e0b\u5355|\u4ed8\u6b3e\u65b9\u5f0f|\u94f6\u884c\u5361/u;

const ENABLED_STATUS_VALUES = CAPABILITY_ENABLEMENT_STATUS_SET;

function sha256Short(value, length = 12) {
  return crypto.createHash('sha256').update(String(value ?? '')).digest('hex').slice(0, length);
}

function compactText(value, maxLength = 160) {
  const text = String(value ?? '').replace(/\s+/gu, ' ').trim();
  return text.length > maxLength ? text.slice(0, maxLength).trimEnd() : text;
}

export function normalizeRiskToken(value) {
  return String(value ?? '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/gu, '_')
    .replace(/^_+|_+$/gu, '');
}

function joinedCapabilityText(capability = /** @type {any} */ ({})) {
  return [
    capability.action,
    capability.object,
    capability.name,
    capability.description,
    capability.userValue,
    capability.setupCapabilityId,
    capability.intentAction,
    capability.blockedAction,
    capability.safetyLevel,
  ].filter(Boolean).join(' ');
}

function joinedCapabilityActionText(capability = /** @type {any} */ ({})) {
  return [
    capability.action,
    capability.object,
    capability.intentAction,
    capability.blockedAction,
    capability.safetyLevel,
    capability.default_policy,
    capability.enabled_status,
  ].filter(Boolean).join(' ');
}

const READ_ONLY_ACTION_PATTERN = /^(?:view|open|browse|read|list|show|inspect|navigate|search)$/iu;
const FOLLOW_SURFACE_PATTERN = /(?:^|[/?#:_\s-])(?:follow|following|followed|followers)(?=$|[/?#:_\s-])|关注|粉丝/iu;
const FOLLOW_MUTATION_PATTERN = /\b(?:follow account|follow user|unfollow|submit follow|create follow|follow this|add this account|remove follow)\b|关注(?:账号|用户|此人)|取关/iu;

export function isReadOnlyFollowSurface(value = /** @type {any} */ ({})) {
  const text = typeof value === 'string'
    ? value
    : [
      value.kind,
      value.action,
      value.object,
      value.name,
      value.description,
      value.userValue,
      value.label,
      value.elementKind,
      value.href,
      value.endpoint,
      value.routeTemplate,
      value.routePattern,
      value.intentAction,
      value.safety,
      value.safetyLevel,
      value.evidenceModel,
    ].filter(Boolean).join(' ');
  if (!FOLLOW_SURFACE_PATTERN.test(String(text))) {
    return false;
  }
  if (FOLLOW_MUTATION_PATTERN.test(String(text)) || String(value?.blockedAction ?? '').match(/^un?follow$/iu)) {
    return false;
  }
  if (typeof value === 'string') {
    return /\b(?:view|open|browse|read|list|show|route|link|navigation)\b/iu.test(value);
  }
  const kind = String(value.kind ?? '').toLowerCase();
  const elementKind = String(value.elementKind ?? '').toLowerCase();
  if (['button', 'form', 'input', 'select', 'control'].includes(elementKind)) {
    return false;
  }
  const action = String(value.action ?? value.intentAction ?? '').toLowerCase();
  const safety = String(value.safety ?? value.safetyLevel ?? '').toLowerCase();
  const method = String(value.method ?? '').toUpperCase();
  const mode = String(value.executionPlan?.mode ?? '').toLowerCase();
  const readKind = (!kind && !elementKind)
    || ['link', 'route', 'navigation', 'component'].includes(kind)
    || ['link', 'navigation'].includes(elementKind);
  const readAction = !action || READ_ONLY_ACTION_PATTERN.test(action) || action.includes('followed');
  const readSafety = !safety || ['read_only', 'safe'].includes(safety);
  const readMethod = !method || ['GET', 'HEAD', 'OPTIONS'].includes(method);
  const readMode = !mode || ['read_only', 'limited_read'].includes(mode);
  return readKind && readAction && readSafety && readMethod && readMode;
}

function forcedDisabledActionsForCapabilityActionText(capability = /** @type {any} */ ({})) {
  const actions = findForcedDisabledActions(joinedCapabilityActionText(capability));
  return isReadOnlyFollowSurface(capability)
    ? actions.filter((action) => action !== 'follow' && action !== 'unfollow')
    : actions;
}

export function findForcedDisabledActions(value) {
  const text = String(value ?? '').toLowerCase();
  const tokens = new Set([
    normalizeRiskToken(text),
    ...text.split(/[^a-z0-9]+/u).map(normalizeRiskToken),
  ].filter(Boolean));
  const hits = /** @type {any[]} */ ([]);
  for (const action of FORCED_DISABLED_ACTIONS) {
    const normalized = normalizeRiskToken(action);
    const phrase = action.replace(/_/gu, ' ');
    const phrasePattern = new RegExp(`(?:^|[^a-z0-9])${phrase.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}(?:$|[^a-z0-9])`, 'u');
    const actionPattern = new RegExp(`(?:^|[^a-z0-9])${action.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}(?:$|[^a-z0-9])`, 'u');
    if (tokens.has(normalized) || phrasePattern.test(text) || actionPattern.test(text)) {
      hits.push(action);
    }
  }
  const localizedPatterns = /** @type {Array<[string, RegExp]>} */ ([
    ['delete', /\u5220\u9664|\u79fb\u9664|\u6e05\u7a7a|\u6ce8\u9500/u],
    ['clear', /\u6e05\u7a7a/u],
    ['overwrite', /\u8986\u76d6/u],
    ['reset', /\u91cd\u7f6e/u],
    ['cancel_order', /\u53d6\u6d88\u8ba2\u5355/u],
    ['void', /\u4f5c\u5e9f/u],
    ['destroy', /\u9500\u6bc1/u],
    ['erase', /\u62b9\u9664/u],
    ['revoke', /\u64a4\u9500/u],
    ['pay', /\u652f\u4ed8|\u4ed8\u6b3e|\u4ed8\u8d39|\u5145\u503c|\u6253\u8d4f/u],
    ['checkout', /\u7ed3\u8d26|\u4e0b\u5355/u],
    ['change_payment', /\u4fee\u6539\u4ed8\u6b3e\u65b9\u5f0f|\u66f4\u6362\u652f\u4ed8\u65b9\u5f0f|\u6dfb\u52a0\u94f6\u884c\u5361/u],
    ['submit', /\u63d0\u4ea4/u],
    ['send', /\u53d1\u9001/u],
    ['publish', /\u53d1\u5e03/u],
    ['contact', /\u8054\u7cfb|\u806f\u7d61/u],
    ['upload', /\u4e0a\u4f20|\u4e0a\u50b3/u],
    ['save', /\u4fdd\u5b58/u],
  ]);
  for (const [action, pattern] of localizedPatterns) {
    if (pattern.test(String(value ?? ''))) {
      hits.push(action);
    }
  }
  return [...new Set(hits)].sort((left, right) => left.localeCompare(right, 'en'));
}

export function isForcedDisabledAction(value) {
  return findForcedDisabledActions(value).length > 0;
}

const PLAN_ACTION_STRING_FIELDS = new Set([
  'action',
  'blockedAction',
  'buttonAction',
  'controlAction',
  'finalAction',
  'intentAction',
  'kind',
  'mutation',
  'operation',
  'operationKind',
  'submitAction',
]);

const PLAN_ACTION_BOOLEAN_FIELDS = new Set([
  'accountMutation',
  'change2fa',
  'changeEmail',
  'changeMfa',
  'changePassword',
  'changePayment',
  'checkout',
  'delete',
  'deleteAccount',
  'editProfile',
  'follow',
  'finalSubmit',
  'like',
  'pay',
  'publish',
  'repost',
  'selectSensitiveRecipient',
  'send',
  'sendDm',
  'sendDM',
  'send_dm',
  'submit',
  'unfollow',
  'upload',
]);

const PLAN_ACTION_BOOLEAN_FIELD_ALIASES = new Map([
  ['accountMutation', 'edit_profile'],
  ['change2fa', 'change_2fa'],
  ['changeEmail', 'change_email'],
  ['changeMfa', 'change_2fa'],
  ['changePassword', 'change_password'],
  ['changePayment', 'change_payment'],
  ['deleteAccount', 'delete'],
  ['editProfile', 'edit_profile'],
  ['finalSubmit', 'submit'],
  ['sendDm', 'send_dm'],
  ['sendDM', 'send_dm'],
  ['selectSensitiveRecipient', 'select_sensitive_recipient'],
]);

const PLAN_UNSAFE_MATERIAL_BOOLEAN_FIELDS = new Set([
  'bodyTextAllowed',
  'directMessageBodyAllowed',
  'dmBodyAllowed',
  'fullTextAllowed',
  'privateContentAllowed',
  'privateContentSaved',
  'private_content_allowed',
  'private_content_saved',
  'rawContentAllowed',
  'rawContentSaved',
  'rawDomSaved',
  'rawHtmlSaved',
  'rawMaterialAllowed',
  'raw_content_allowed',
  'raw_content_saved',
  'raw_dom_saved',
  'raw_html_saved',
  'raw_material_allowed',
]);

const PLAN_MATERIAL_STRING_FIELDS = new Set([
  'bodyPolicy',
  'contentMaterial',
  'contentPolicy',
  'material',
  'materialPolicy',
  'outputMaterial',
  'savedMaterial',
  'saved_material',
  'storagePolicy',
]);

const UNSAFE_MATERIAL_VALUE_PATTERN = /\b(?:raw|raw_dom|raw_html|raw body|body_text|private|private_content|private message|private_message_body|dm_body|full_text|page_body)\b/iu;

function collectExecutablePlanActions(value, hits = new Set()) {
  if (!value || typeof value !== 'object') {
    return hits;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectExecutablePlanActions(item, hits);
    }
    return hits;
  }
  for (const [key, rawValue] of Object.entries(value)) {
    const normalizedKey = normalizeRiskToken(key);
    if (
      rawValue === true
      && (PLAN_ACTION_BOOLEAN_FIELDS.has(key) || FORCED_DISABLED_ACTION_SET.has(normalizedKey))
    ) {
      hits.add(PLAN_ACTION_BOOLEAN_FIELD_ALIASES.get(key) ?? normalizedKey);
      continue;
    }
    if (typeof rawValue === 'string' && PLAN_ACTION_STRING_FIELDS.has(key)) {
      for (const action of findForcedDisabledActions(rawValue)) {
        hits.add(action);
      }
    }
    if (rawValue && typeof rawValue === 'object') {
      collectExecutablePlanActions(rawValue, hits);
    }
  }
  return hits;
}

export function findForcedExecutablePlanActions(plan = /** @type {any} */ ({})) {
  return [...collectExecutablePlanActions(plan)]
    .filter((action) => FORCED_DISABLED_ACTION_SET.has(action))
    .sort((left, right) => left.localeCompare(right, 'en'));
}

function collectUnsafeExecutionPlanMaterialFlags(value, hits = new Set()) {
  if (!value || typeof value !== 'object') {
    return hits;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectUnsafeExecutionPlanMaterialFlags(item, hits);
    }
    return hits;
  }
  for (const [key, rawValue] of Object.entries(value)) {
    if (rawValue === true && PLAN_UNSAFE_MATERIAL_BOOLEAN_FIELDS.has(key)) {
      hits.add(key);
      continue;
    }
    if (
      typeof rawValue === 'string'
      && (PLAN_MATERIAL_STRING_FIELDS.has(key) || /(?:raw|private|body|material|content)/iu.test(key))
      && UNSAFE_MATERIAL_VALUE_PATTERN.test(rawValue)
    ) {
      hits.add(`${key}:${normalizeRiskToken(rawValue)}`);
      continue;
    }
    if (rawValue && typeof rawValue === 'object') {
      collectUnsafeExecutionPlanMaterialFlags(rawValue, hits);
    }
  }
  return hits;
}

export function findUnsafeExecutionPlanMaterialFlags(plan = /** @type {any} */ ({})) {
  return [...collectUnsafeExecutionPlanMaterialFlags(plan)]
    .sort((left, right) => left.localeCompare(right, 'en'));
}

export const SAFE_REMEDIATION_PATHS = Object.freeze([
  'limited_read_summary',
  'draft_only_preview',
  'user_mediated_safe_action_path',
  'requires_site_specific_adapter',
  'requires_explicit_external_adapter',
  'requires_manual_review',
  'not_supported',
]);

const SAFE_REMEDIATION_PATH_SET = new Set(SAFE_REMEDIATION_PATHS);

const BASE_REMEDIATION_PROHIBITED_ACTIONS = Object.freeze([
  'auto_execute',
  'raw_content_persistence',
  'raw_dom_persistence',
  'raw_html_persistence',
  'private_content_persistence',
  'credential_or_session_material_persistence',
  'final_submit',
  'send',
  'delete',
  'pay',
  'checkout',
  'upload',
]);

const LIMITED_READ_REQUIRED_EVIDENCE = Object.freeze([
  'sanitized_route_or_structure_evidence',
  'bounded_summary_fields',
  'limited_read_execution_plan',
]);

const DRAFT_ONLY_REQUIRED_EVIDENCE = Object.freeze([
  'sanitized_control_or_structure_evidence',
  'dry_run_preview_plan',
  'final_submit_guard',
]);

const SITE_ADAPTER_REQUIRED_EVIDENCE = Object.freeze([
  'site_specific_adapter',
  'capability_specific_evidence',
  'sanitized_route_or_structure_evidence',
]);

const EXPLICIT_EXTERNAL_ADAPTER_REQUIRED_EVIDENCE = Object.freeze([
  'site_specific_adapter',
  'capability_specific_evidence',
  'non_executing_adapter_plan',
  'explicit_operator_approval',
]);

const MANUAL_REVIEW_REQUIRED_EVIDENCE = Object.freeze([
  'manual_security_review',
  'capability_specific_evidence',
  'safe_execution_plan_review',
]);

function lowerText(value) {
  return String(value ?? '').trim().toLowerCase();
}

function capabilityEvidenceValues(capability = /** @type {any} */ ({})) {
  return [
    capability.evidence,
    capability.evidence_sources,
    capability.evidenceSources,
    capability.evidence_refs,
    capability.evidenceRefs,
    capability.entryNodeIds,
    capability.source_nodes,
    capability.sourceNodes,
    capability.source_node_ids,
    capability.sourceNodeIds,
  ];
}

function hasAnyCapabilityEvidence(capability = /** @type {any} */ ({})) {
  return capabilityEvidenceValues(capability).some((value) => {
    if (Array.isArray(value)) return value.length > 0;
    return Boolean(value && typeof value === 'object' && Object.keys(value).length > 0);
  });
}

function capabilityRemediationReasonCode(capability = /** @type {any} */ ({}), riskPolicy = createCapabilityRiskPolicy(capability)) {
  return String(
    capability.activationBlockedReason
    ?? capability.disabledReason
    ?? capability.reasonCode
    ?? capability.reason_code
    ?? capability.confirmation_blocked_reason
    ?? capability.interaction_blocked_reason
    ?? riskPolicy.reasonCode
    ?? 'disabled-by-policy',
  ).trim();
}

function capabilityRemediationReasonText(capability = /** @type {any} */ ({}), reasonCode = null) {
  return String(
    capability.interaction_blocked_reason
    ?? capability.confirmation_blocked_reason
    ?? capability.activationBlockedReason
    ?? capability.disabledReason
    ?? reasonCode
    ?? 'disabled-by-policy',
  ).trim();
}

function capabilityRequiresSiteSpecificAdapter(capability = /** @type {any} */ ({}), reasonText = '') {
  const text = `${reasonText} ${joinedCapabilityText(capability)}`.toLowerCase();
  return /capability-specific-evidence|required.*adapter|site-specific|known-site|adapter|dynamic-unsupported|rendered.*unavailable|user-intent-unresolved|selected_not_active|unsupported.*intent/u.test(text);
}

function capabilityRequiresManualReview(capability = /** @type {any} */ ({}), reasonText = '') {
  const text = `${reasonText} ${joinedCapabilityText(capability)}`.toLowerCase();
  return /manual|review|validation-failed|policy-evidence-required|missing.*evidence|lacks.*evidence|privacy|private.*detail|body/u.test(text);
}

function capabilityHasPrivateBodyRisk(capability = /** @type {any} */ ({})) {
  return /direct[-_\s]?message.*(?:detail|body|conversation)|private[-_\s]?message.*(?:detail|body|conversation)|private inbox|notification (?:body|detail|content)|bookmark(?:ed)? post (?:body|detail|content)|saved item (?:body|detail|content)|body text|raw body|private body/iu
    .test(joinedCapabilityText(capability));
}

function capabilityUnsafeMaterialRequested(capability = /** @type {any} */ ({})) {
  const directFlags = [
    capability.raw_content_saved,
    capability.rawContentSaved,
    capability.raw_dom_saved,
    capability.rawDomSaved,
    capability.raw_html_saved,
    capability.rawHtmlSaved,
    capability.private_content_saved,
    capability.privateContentSaved,
    capability.rawMaterialAllowed,
    capability.privateContentAllowed,
  ];
  return directFlags.some((value) => value === true)
    || findUnsafeExecutionPlanMaterialFlags(capability.executionPlan ?? capability.execution_plan).length > 0
    || findUnsafeExecutionPlanMaterialFlags(capability.remediationPlan ?? capability.remediation_plan ?? capability.remediation?.plan).length > 0;
}

function remediationRequiredEvidence(path) {
  if (path === 'limited_read_summary') return [...LIMITED_READ_REQUIRED_EVIDENCE];
  if (path === 'draft_only_preview') return [...DRAFT_ONLY_REQUIRED_EVIDENCE];
  if (path === 'user_mediated_safe_action_path') return [...EXPLICIT_EXTERNAL_ADAPTER_REQUIRED_EVIDENCE, 'user_final_confirmation_boundary'];
  if (path === 'requires_site_specific_adapter') return [...SITE_ADAPTER_REQUIRED_EVIDENCE];
  if (path === 'requires_explicit_external_adapter') return [...EXPLICIT_EXTERNAL_ADAPTER_REQUIRED_EVIDENCE];
  if (path === 'requires_manual_review') return [...MANUAL_REVIEW_REQUIRED_EVIDENCE];
  return [];
}

function remediationResultingStatus(path) {
  if (path === 'limited_read_summary') return 'limited_enabled';
  if (path === 'draft_only_preview') return 'draft_only';
  if (path === 'user_mediated_safe_action_path') return 'confirmation_required';
  return 'disabled';
}

function remediationLabel(path) {
  if (path === 'limited_read_summary') return 'limited read summary';
  if (path === 'draft_only_preview') return 'draft-only preview';
  if (path === 'user_mediated_safe_action_path') return 'user-mediated safe action path';
  if (path === 'requires_site_specific_adapter') return 'requires site-specific adapter';
  if (path === 'requires_explicit_external_adapter') return 'requires explicit external adapter path';
  if (path === 'requires_manual_review') return 'requires manual review';
  if (path === 'not_supported') return 'not supported';
  return 'keep disabled';
}

function remediationNextStep(path, canAutoPrepare) {
  if (canAutoPrepare === true && path === 'limited_read_summary') {
    return 'Prepare a sanitized limited-read plan; do not read or store body text, unsanitized markup, or private content.';
  }
  if (canAutoPrepare === true && path === 'draft_only_preview') {
    return 'Prepare a dry-run preview plan; do not submit, send, upload, delete, pay, or publish.';
  }
  if (path === 'user_mediated_safe_action_path') {
    return 'Reuse the user-authorized browser boundary to navigate and preview only; the user must perform any final site action manually in the browser.';
  }
  if (path === 'requires_site_specific_adapter') {
    return 'Implement a site-specific adapter with capability-specific sanitized evidence, then rerun validation before use.';
  }
  if (path === 'requires_explicit_external_adapter') {
    return 'Implement a site-adapter-validated non-final safe alternative, rerun validation, and keep prohibited final actions disabled.';
  }
  if (path === 'requires_manual_review') {
    return 'Convert manual security review findings into a separate safe path, then rerun validation before use.';
  }
  return 'Add a reviewed safe alternative path before use; the requested final action stays outside the automatic boundary.';
}

function remediationProhibitedActions(path, forcedActions = /** @type {any[]} */ ([])) {
  const pathSpecific = path === 'limited_read_summary'
    ? ['body_text_persistence', 'private_message_body_read', 'account_mutation']
    : path === 'draft_only_preview'
      ? ['final_submit', 'send', 'publish', 'upload', 'delete', 'pay', 'checkout']
      : path === 'user_mediated_safe_action_path'
        ? ['automatic_final_action', 'silent_submit', 'silent_send', 'silent_delete', 'silent_payment', 'credential_or_session_material_persistence']
      : path === 'requires_explicit_external_adapter'
        ? ['automatic_enablement', 'write_action_execution', 'final_action_execution', 'unverified_adapter_execution']
        : ['automatic_enablement', 'write_action_execution'];
  return [...new Set([
    ...BASE_REMEDIATION_PROHIBITED_ACTIONS,
    ...pathSpecific,
    ...forcedActions,
  ])].sort((left, right) => left.localeCompare(right, 'en'));
}

const PUBLIC_REMEDIATION_ACTIONS = Object.freeze(new Map([
  ['raw_content_persistence', 'unsanitized_material_persistence_blocked'],
  ['raw_dom_persistence', 'page_structure_source_persistence_blocked'],
  ['raw_html_persistence', 'page_markup_source_persistence_blocked'],
  ['private_content_persistence', 'restricted_material_persistence_blocked'],
  ['credential_or_session_material_persistence', 'sign_in_material_persistence_blocked'],
  ['body_text_persistence', 'message_detail_text_persistence_blocked'],
  ['private_message_body_read', 'private_message_detail_read_blocked'],
]));

const PUBLIC_REMEDIATION_REASONS = Object.freeze(new Map([
  ['account_security_critical-default-disabled', 'Account-security actions stay disabled until a separate reviewed safe path exists.'],
  ['write_high-default-disabled', 'High-risk write actions stay disabled until a separate reviewed safe path exists.'],
  ['forced-action-disabled', 'This action is forced disabled and cannot be enabled by ordinary confirmation.'],
  ['read_private_high-default-disabled', 'Private-detail reads require a separate limited path and review before use.'],
  ['read_personal_medium-confirm-or-limited', 'Sensitive read access requires limited sanitized evidence before use.'],
  ['policy-evidence-required', 'Additional sanitized evidence is required before this can be prepared.'],
  ['capability-specific-evidence-required', 'Capability-specific sanitized evidence is required before this can be prepared.'],
  ['disabled-by-policy', 'The current policy keeps this capability disabled.'],
]));

function publicRemediationAction(action) {
  const text = String(action ?? '').trim();
  return PUBLIC_REMEDIATION_ACTIONS.get(text) ?? text;
}

function publicRemediationReason(remediation = /** @type {any} */ ({})) {
  const reasonCode = String(remediation.reasonCode ?? '').trim();
  const reasonText = String(remediation.reason ?? '').trim();
  const mappedByCode = PUBLIC_REMEDIATION_REASONS.get(reasonCode);
  if (mappedByCode) return mappedByCode;
  const normalizedReason = lowerText(reasonText);
  const mappedByReason = PUBLIC_REMEDIATION_REASONS.get(normalizedReason);
  if (mappedByReason) return mappedByReason;
  if (/^[a-z0-9][a-z0-9._-]{2,}$/u.test(reasonText)) {
    return 'The current policy keeps this capability disabled until reviewed safe evidence is available.';
  }
  return reasonText || 'The current policy keeps this capability disabled.';
}

export function publicSafeRemediation(remediation = /** @type {any} */ ({})) {
  return {
    ...remediation,
    reasonCode: undefined,
    reason: publicRemediationReason(remediation),
    prohibitedActions: [...new Set((Array.isArray(remediation.prohibitedActions) ? remediation.prohibitedActions : [])
      .map(publicRemediationAction)
      .filter(Boolean))]
      .sort((left, right) => left.localeCompare(right, 'en')),
  };
}

function selectSafeRemediationPath({
  capability,
  riskPolicy,
  reasonText,
  forcedActions,
  evidenceReady,
}) {
  const riskLevel = lowerText(capability.risk_level ?? riskPolicy.riskLevel);
  const defaultPolicy = lowerText(capability.default_policy ?? riskPolicy.defaultAction);
  if (
    capabilityUnsafeMaterialRequested(capability)
    || capabilityHasPrivateBodyRisk(capability)
    || forcedActions.some((action) => action.startsWith('change_'))
  ) {
    return evidenceReady ? 'user_mediated_safe_action_path' : 'requires_explicit_external_adapter';
  }
  if (riskLevel === 'write_high' || forcedActions.length > 0) {
    return evidenceReady ? 'user_mediated_safe_action_path' : 'requires_explicit_external_adapter';
  }
  if (riskLevel === 'account_security_critical') {
    return evidenceReady ? 'user_mediated_safe_action_path' : 'requires_explicit_external_adapter';
  }
  if (capabilityRequiresSiteSpecificAdapter(capability, reasonText)) {
    return 'requires_site_specific_adapter';
  }
  if (riskLevel === 'read_personal_medium' || riskLevel === 'read_private_high' || defaultPolicy === 'confirm_or_limited' || defaultPolicy === 'disabled_or_confirm_limited') {
    return evidenceReady ? 'limited_read_summary' : 'requires_site_specific_adapter';
  }
  if (riskLevel === 'write_low' || defaultPolicy === 'draft_only') {
    return evidenceReady ? 'draft_only_preview' : 'requires_site_specific_adapter';
  }
  if (capabilityRequiresManualReview(capability, reasonText)) {
    return 'requires_manual_review';
  }
  return 'requires_manual_review';
}

export function buildCapabilitySafeRemediationPath(capability = /** @type {any} */ ({})) {
  const riskPolicy = capability.riskPolicy ?? createCapabilityRiskPolicy(capability);
  const reasonCode = capabilityRemediationReasonCode(capability, riskPolicy);
  const reasonText = capabilityRemediationReasonText(capability, reasonCode);
  const forcedActions = [...new Set([
    ...findForcedDisabledActions(joinedCapabilityActionText(capability)),
    ...findForcedExecutablePlanActions(capability.executionPlan ?? capability.execution_plan),
    ...findForcedExecutablePlanActions(capability.remediationPlan ?? capability.remediation_plan ?? capability.remediation?.plan),
    ...Array.isArray(riskPolicy.forcedDisabledActions) ? riskPolicy.forcedDisabledActions : [],
  ])].sort((left, right) => left.localeCompare(right, 'en'));
  const evidenceReady = hasAnyCapabilityEvidence(capability);
  const path = selectSafeRemediationPath({
    capability,
    riskPolicy,
    reasonText,
    forcedActions,
    evidenceReady,
  });
  const resultingStatus = remediationResultingStatus(path);
  const canAutoPrepare = (
    (path === 'limited_read_summary' || path === 'draft_only_preview')
    && evidenceReady
    && forcedActions.length === 0
    && !capabilityUnsafeMaterialRequested(capability)
    && riskPolicy.riskLevel !== 'write_high'
    && riskPolicy.riskLevel !== 'account_security_critical'
  );
  return {
    path,
    label: remediationLabel(path),
    canAutoPrepare,
    requiredEvidence: remediationRequiredEvidence(path),
    prohibitedActions: remediationProhibitedActions(path, forcedActions),
    resultingStatus,
    nextStep: remediationNextStep(path, canAutoPrepare),
    reasonCode,
    reason: reasonText,
    riskLevel: riskPolicy.riskLevel,
    evidenceReady,
    writeActionsEnabled: false,
    rawMaterialAllowed: false,
    privateContentAllowed: false,
  };
}

export function decorateCapabilitySafeRemediation(capability = /** @type {any} */ ({})) {
  const remediation = buildCapabilitySafeRemediationPath(capability);
  const publicRemediation = publicSafeRemediation(remediation);
  return {
    ...capability,
    safe_remediation_path: publicRemediation.path,
    safe_remediation: publicRemediation,
  };
}

export function validateCapabilitySafeRemediationPath(capability = /** @type {any} */ ({}), remediation = buildCapabilitySafeRemediationPath(capability)) {
  const errors = /** @type {any[]} */ ([]);
  const path = remediation?.path ?? remediation?.type ?? remediation?.safe_remediation_path;
  const riskPolicy = capability.riskPolicy ?? createCapabilityRiskPolicy(capability);
  const forcedActions = [
    ...findForcedDisabledActions(joinedCapabilityActionText(capability)),
    ...findForcedExecutablePlanActions(capability.executionPlan ?? capability.execution_plan),
    ...findForcedExecutablePlanActions(capability.remediationPlan ?? capability.remediation_plan ?? capability.remediation?.plan),
  ];
  if (!SAFE_REMEDIATION_PATH_SET.has(path)) {
    errors.push({
      code: 'capability.safe_remediation_path_invalid',
      message: `Capability ${capability.id} has an invalid safe remediation path.`,
      path,
    });
  }
  if (remediation?.canAutoPrepare === true && !['limited_read_summary', 'draft_only_preview'].includes(path)) {
    errors.push({
      code: 'capability.safe_remediation_auto_prepare_invalid',
      message: `Capability ${capability.id} cannot auto-prepare remediation path ${path}.`,
      path,
    });
  }
  if (
    remediation?.canAutoPrepare === true
    && (riskPolicy.riskLevel === 'write_high' || riskPolicy.riskLevel === 'account_security_critical' || forcedActions.length > 0)
  ) {
    errors.push({
      code: 'capability.safe_remediation_high_risk_write_auto_prepare',
      message: `Capability ${capability.id} must not auto-prepare high-risk write remediation.`,
      path,
      forcedDisabledActions: forcedActions,
    });
  }
  if (remediation?.resultingStatus === 'enabled') {
    errors.push({
      code: 'capability.safe_remediation_resulting_status_enabled',
      message: `Capability ${capability.id} remediation must not directly enable a disabled or blocked capability.`,
      path,
    });
  }
  if (remediation?.writeActionsEnabled === true || remediation?.rawMaterialAllowed === true || remediation?.privateContentAllowed === true) {
    errors.push({
      code: 'capability.safe_remediation_privacy_boundary_invalid',
      message: `Capability ${capability.id} remediation cannot allow write actions, raw material, or private content.`,
      path,
    });
  }
  return errors;
}

export function safeRemediationPathSummary(capabilities = /** @type {any[]} */ ([])) {
  const summary = {
    total: 0,
    canAutoPrepare: 0,
    limited_read_summary: 0,
    draft_only_preview: 0,
    requires_site_specific_adapter: 0,
    requires_explicit_external_adapter: 0,
    requires_manual_review: 0,
    not_supported: 0,
  };
  for (const capability of Array.isArray(capabilities) ? capabilities : []) {
    const remediation = capability.safe_remediation ?? buildCapabilitySafeRemediationPath(capability);
    const path = remediation.path ?? capability.safe_remediation_path;
    summary.total += 1;
    if (remediation.canAutoPrepare === true) summary.canAutoPrepare += 1;
    if (Object.hasOwn(summary, path)) summary[path] += 1;
  }
  return summary;
}

function capabilitySafetyPlans(capability = /** @type {any} */ ({})) {
  return [
    ['executionPlan', capability.executionPlan ?? capability.execution_plan],
    ['remediationPlan', capability.remediationPlan ?? capability.remediation_plan ?? capability.remediation?.plan],
  ]
    .filter(([, plan]) => plan && typeof plan === 'object')
    .map(([label, plan]) => ({ label, plan }));
}

function isGovernedNonAutoPlan(plan = /** @type {any} */ ({})) {
  return plan?.governedExecution === true
    && plan.autoExecute !== true
    && (plan.requiresConfirmation === true
      || plan.dryRunOnly === true
      || ['controlled', 'blocked', 'confirm_required'].includes(plan.executionDisposition));
}

export function classifyEvidenceSourceKind(evidence = /** @type {any} */ ({})) {
  const type = String(evidence.type ?? '').toLowerCase();
  const source = String(evidence.source ?? evidence.source_ref ?? '').toLowerCase();
  if (type === 'network' || source.includes('network')) {
    return 'network_summary';
  }
  if (source.includes('adapter') || source.includes('authorized') || source.includes('known-site')) {
    return 'adapter';
  }
  if (type === 'form' || evidence.selector || evidence.method || evidence.endpoint) {
    return 'control';
  }
  if (type === 'url' || /^https?:\/\//iu.test(String(evidence.source ?? ''))) {
    return 'route';
  }
  return 'structure';
}

function routeTemplateFromUrl(urlValue) {
  let parsed;
  try {
    parsed = new URL(String(urlValue));
  } catch {
    return null;
  }
  const safeSegments = parsed.pathname
    .split('/')
    .filter(Boolean)
    .map((segment) => {
      const decoded = decodeURIComponent(segment).toLowerCase();
      if (/^(?:home|search|explore|article|story|news|channel|feed|products?|catalog|item|detail|contact|support|notifications?|messages?|bookmarks?|following|followers|profile|user|i|ch|ch2|mobile|omn|d|rain|a)$/u.test(decoded)) {
        return decoded;
      }
      if (/^[a-z]{1,8}\d{4,}$/u.test(decoded) || /^\d+$/u.test(decoded) || /^[a-f0-9]{8,}$/u.test(decoded)) {
        return ':id';
      }
      return ':segment';
    });
  const pathTemplate = safeSegments.length ? `/${safeSegments.join('/')}` : '/';
  const queryKeys = [...parsed.searchParams.keys()]
    .map((key) => key.toLowerCase())
    .sort((left, right) => left.localeCompare(right, 'en'));
  return `${parsed.protocol}//${parsed.hostname}${pathTemplate}${queryKeys.length ? `?keys=${queryKeys.join(',')}` : ''}`;
}

export function sanitizeEvidenceRef(value) {
  const text = compactText(value, 240);
  if (!text) {
    return null;
  }
  const routeTemplate = routeTemplateFromUrl(text);
  if (routeTemplate) {
    return redactUrl(routeTemplate).url;
  }
  const redacted = redactPublicIdentifierText(/** @type {any} */ (text), { maxLength: 120 }).value;
  if (/[\\/]/u.test(redacted) || /\.(?:html?|json|xml|mjs|js|css)$/iu.test(redacted)) {
    return `structure-ref:${sha256Short(redacted)}`;
  }
  return redacted || `structure-ref:${sha256Short(text)}`;
}

function sanitizeMethod(value) {
  const method = String(value ?? '').toUpperCase();
  return /^(?:GET|HEAD|OPTIONS|POST|PUT|PATCH|DELETE)$/u.test(method) ? method : null;
}

export function normalizeEvidenceObject(evidence = /** @type {any} */ ({})) {
  const sourceKind = EVIDENCE_SOURCE_KIND_SET.has(evidence.evidence_source)
    ? evidence.evidence_source
    : classifyEvidenceSourceKind(evidence);
  const sourceRef = sanitizeEvidenceRef(evidence.source_ref ?? evidence.source ?? evidence.endpoint ?? evidence.text);
  const selectorHash = evidence.selector ? sha256Short(evidence.selector) : null;
  const structureHash = sha256Short(JSON.stringify({
    type: evidence.type ?? null,
    sourceKind,
    sourceRef,
    selectorHash,
    method: sanitizeMethod(evidence.method),
  }));
  const normalized = {
    type: evidence.type,
    source: sourceKind,
    source_ref: sourceRef,
    evidence_source: sourceKind,
    evidence_status: evidence.evidence_status ?? 'observed_sanitized',
    saved_material: SANITIZED_SUMMARY_ONLY,
    raw_content_saved: false,
    private_content_saved: false,
    structure_hash: structureHash,
    confidence: Number.isFinite(Number(evidence.confidence)) ? Number(evidence.confidence) : 1,
  };
  if (selectorHash) {
    normalized.selector_hash = selectorHash;
  }
  const endpointRef = sanitizeEvidenceRef(evidence.endpoint);
  if (endpointRef) {
    normalized.endpoint_ref = endpointRef;
  }
  const method = sanitizeMethod(evidence.method);
  if (method) {
    normalized.method = method;
  }
  assertNoForbiddenPatterns(normalized);
  return normalized;
}

export function normalizeCapabilityEvidenceList(evidence = /** @type {any[]} */ ([])) {
  return Array.isArray(evidence) ? evidence.map((item) => normalizeEvidenceObject(item)) : [];
}

export function validateCapabilityEvidenceObject(evidence = /** @type {any} */ ({})) {
  const errors = /** @type {any[]} */ ([]);
  if (!EVIDENCE_SOURCE_KIND_SET.has(evidence.evidence_source)) {
    errors.push('missing_or_invalid_evidence_source');
  }
  if (!evidence.evidence_status) {
    errors.push('missing_evidence_status');
  }
  if (evidence.saved_material !== SANITIZED_SUMMARY_ONLY) {
    errors.push('invalid_saved_material');
  }
  if (evidence.raw_content_saved !== false) {
    errors.push('raw_content_saved_must_be_false');
  }
  if (evidence.private_content_saved !== false) {
    errors.push('private_content_saved_must_be_false');
  }
  try {
    assertNoForbiddenPatterns(evidence);
  } catch {
    errors.push('forbidden_sensitive_pattern');
  }
  return errors;
}

export function validateCapabilityEvidenceList(evidence = /** @type {any[]} */ ([])) {
  const errors = /** @type {any[]} */ ([]);
  for (const [index, item] of (Array.isArray(evidence) ? evidence : []).entries()) {
    for (const code of validateCapabilityEvidenceObject(item)) {
      errors.push({ index, code });
    }
  }
  return errors;
}

export function inferCapabilityRiskLevel(capability = /** @type {any} */ ({})) {
  const text = joinedCapabilityText(capability);
  const actionText = joinedCapabilityActionText(capability);
  const forced = forcedDisabledActionsForCapabilityActionText(capability);
  const explicitRiskLevel = lowerText(capability.risk_level ?? capability.riskLevel);
  if (ACCOUNT_SECURITY_PATTERN.test(text) || forced.some((action) => action.startsWith('change_'))) {
    return 'account_security_critical';
  }
  if (PRIVATE_MESSAGE_WRITE_PATTERN.test(text)) {
    return 'write_high';
  }
  if (forced.length || ['payment', 'destructive'].includes(capability.safetyLevel) || (!isReadOnlyFollowSurface(capability) && WRITE_HIGH_PATTERN.test(actionText))) {
    return WRITE_LOW_PATTERN.test(text) && !forced.length ? 'write_low' : 'write_high';
  }
  if (PRIVATE_READ_PATTERN.test(text)) {
    return 'read_private_high';
  }
  if (capability.requiresUserAuthorization === true || capability.authRequired === true || PERSONAL_READ_PATTERN.test(text)) {
    return 'read_personal_medium';
  }
  if (RISK_LEVEL_DEFAULTS[explicitRiskLevel]) {
    return explicitRiskLevel;
  }
  if (capability.safetyLevel === 'state_changing' || capability.safetyLevel === 'requires_confirmation') {
    return WRITE_LOW_PATTERN.test(text) ? 'write_low' : 'write_high';
  }
  return 'read_public_low';
}

function normalizeEnabledStatus(value) {
  const status = String(value ?? '').trim();
  return ENABLED_STATUS_VALUES.has(status) ? status : null;
}

function normalizeDefaultPolicy(value) {
  const policy = String(value ?? '').trim();
  return policy || null;
}

function normalizeExecutionDisposition(value) {
  const disposition = String(value ?? '').trim();
  return EXECUTION_DISPOSITION_SET.has(disposition) ? disposition : null;
}

function uniqueExecutionGates(values = /** @type {any[]} */ ([])) {
  const set = new Set(values.filter((value) => EXECUTION_GATE_SET.has(String(value ?? ''))));
  return EXECUTION_GATES.filter((gate) => set.has(gate));
}

function normalizePrivacyMode(value) {
  return String(value ?? 'limited').toLowerCase() === 'strict' ? 'strict' : 'limited';
}

function capabilityOperationKind(capability = /** @type {any} */ ({})) {
  const text = joinedCapabilityText(capability).toLowerCase();
  const plan = capability.executionPlan ?? capability.execution_plan ?? {};
  const steps = Array.isArray(plan.steps) ? plan.steps : [];
  const stepText = steps.flatMap((step) => [
    step?.kind,
    step?.action,
    step?.operationKind,
    step?.method,
    step?.endpoint,
    step?.routeTemplate,
  ]).filter(Boolean).join(' ').toLowerCase();
  const combined = `${text} ${stepText}`;
  if (/\bdownload\b|\u4e0b\u8f7d/u.test(combined)) {
    return 'download';
  }
  if (/\b(?:login|log in|sign in|auth|authenticate|session materialization|materialize session)\b|\u767b\u5f55|\u6388\u6743/u.test(combined)) {
    return 'auth';
  }
  if (
    /\b(?:post|put|patch|submit|send|publish|follow|unfollow|like|repost|create|edit|update|upload|save|write|form|contact)\b|\u63d0\u4ea4|\u53d1\u5e03|\u53d1\u9001|\u5173\u6ce8|\u53d6\u5173|\u70b9\u8d5e|\u8f6c\u53d1|\u4e0a\u4f20|\u4fdd\u5b58|\u7f16\u8f91/u.test(combined)
  ) {
    return 'write';
  }
  return 'read';
}

function capabilitySessionRequired(capability = /** @type {any} */ ({}), riskPolicy = capability.riskPolicy ?? {}) {
  const riskLevel = riskPolicy.riskLevel ?? capability.risk_level ?? capability.riskLevel;
  return capability.authRequired === true
    || capability.requiresAuth === true
    || capability.requiresSession === true
    || capability.requiresUserAuthorization === true
    || riskLevel === 'read_personal_medium'
    || riskLevel === 'read_private_high'
    || riskLevel === 'account_security_critical'
    || capabilityOperationKind(capability) === 'auth';
}

function capabilityRequiresHighRiskExecutionGovernance(capability = /** @type {any} */ ({}), riskPolicy = capability.riskPolicy ?? {}) {
  const riskLevel = riskPolicy.riskLevel ?? capability.risk_level ?? capability.riskLevel ?? inferCapabilityRiskLevel(capability);
  const safetyLevel = lowerText(capability.safetyLevel ?? capability.safety);
  const text = joinedCapabilityText(capability);
  return capability.highRiskAction === true
    || riskLevel === 'account_security_critical'
    || ['high_risk', 'requires_confirmation', 'account_security', 'security_critical'].includes(safetyLevel)
    || ACCOUNT_SECURITY_PATTERN.test(text)
    || DESTRUCTIVE_ACTION_PATTERN.test(text)
    || PAYMENT_ACTION_PATTERN.test(text)
    || forcedDisabledActionsForCapabilityActionText(capability).length > 0;
}

function controlledRuntimeRequired(capability = /** @type {any} */ ({}), riskPolicy = capability.riskPolicy ?? {}) {
  const riskLevel = riskPolicy.riskLevel ?? capability.risk_level ?? capability.riskLevel ?? inferCapabilityRiskLevel(capability);
  if (riskLevel === 'read_personal_medium' || riskLevel === 'read_private_high' || riskLevel === 'account_security_critical') {
    return true;
  }
  const operationKind = capabilityOperationKind(capability);
  return operationKind === 'auth'
    || (operationKind === 'read' && capabilitySessionRequired(capability, riskPolicy));
}

function executionGatesForCapability(capability = /** @type {any} */ ({}), riskPolicy = capability.riskPolicy ?? {}, disposition = 'allow') {
  if (disposition === 'allow') {
    return [];
  }
  const operationKind = capabilityOperationKind(capability);
  const riskLevel = riskPolicy.riskLevel ?? capability.risk_level ?? capability.riskLevel ?? inferCapabilityRiskLevel(capability);
  const highRisk = capabilityRequiresHighRiskExecutionGovernance(capability, riskPolicy);
  const destructiveOrPayment = disposition === 'blocked'
    && (
      DESTRUCTIVE_ACTION_PATTERN.test(joinedCapabilityText(capability))
      || PAYMENT_ACTION_PATTERN.test(joinedCapabilityText(capability))
      || forcedDisabledActionsForCapabilityActionText(capability).length > 0
    );
  return uniqueExecutionGates([
    ...(Array.isArray(riskPolicy.executionGates) ? riskPolicy.executionGates : []),
    disposition === 'confirm_required' ? 'confirm_required' : null,
    highRisk ? 'confirm_required' : null,
    highRisk ? 'audit_required' : null,
    capabilitySessionRequired(capability, riskPolicy) && disposition !== 'allow' ? 'session_required' : null,
    highRisk || destructiveOrPayment || riskLevel === 'account_security_critical' ? 'permission_required' : null,
    operationKind === 'download' && disposition !== 'allow' ? 'output_path_required' : null,
  ]);
}

function riskPolicyRuntimeDefaults(policy, options = /** @type {any} */ ({})) {
  const overrideStatus = normalizeEnabledStatus(options.enabledStatus);
  const overridePolicy = normalizeDefaultPolicy(options.defaultPolicy);
  if (overrideStatus || overridePolicy) {
    const enabledStatus = overrideStatus ?? (
      policy.disabled
        ? 'disabled'
        : policy.draftOnly
          ? 'draft_only'
          : policy.limited
            ? 'limited_enabled'
            : 'enabled'
    );
    return {
      enabledStatus,
      defaultPolicy: overridePolicy ?? (
        enabledStatus === 'disabled' ? 'disabled' : enabledStatus
      ),
    };
  }
  if (policy.disabled) {
    return {
      enabledStatus: 'disabled',
      defaultPolicy: 'disabled',
    };
  }
  if (policy.draftOnly) {
    return {
      enabledStatus: 'draft_only',
      defaultPolicy: policy.defaultAction,
    };
  }
  if (policy.limited) {
    return {
      enabledStatus: 'limited_enabled',
      defaultPolicy: policy.defaultAction,
    };
  }
  return {
    enabledStatus: 'enabled',
    defaultPolicy: policy.defaultAction,
  };
}

export function createCapabilityRiskPolicy(capability = /** @type {any} */ ({})) {
  const riskLevel = inferCapabilityRiskLevel(capability);
  const defaults = RISK_LEVEL_DEFAULTS[riskLevel] ?? RISK_LEVEL_DEFAULTS.read_public_low;
  const sitePolicyForcedActions = Array.isArray(capability.sitePolicyDisabledActions)
    ? capability.sitePolicyDisabledActions.map(normalizeRiskToken).filter(Boolean)
    : [];
  const forcedActions = uniqueSortedStrings([
    ...forcedDisabledActionsForCapabilityActionText(capability),
    ...sitePolicyForcedActions,
  ]);
  const text = joinedCapabilityText(capability);
  const sitePolicyDisabled = capability.sitePolicyDisabled === true || sitePolicyForcedActions.length > 0;
  const forcedDisabled = sitePolicyDisabled || forcedActions.length > 0 || DESTRUCTIVE_ACTION_PATTERN.test(text) || PAYMENT_ACTION_PATTERN.test(text);
  const highRiskGoverned = !forcedDisabled && capabilityRequiresHighRiskExecutionGovernance(capability, { riskLevel });
  const executionDisposition = forcedDisabled
    ? 'blocked'
    : normalizeExecutionDisposition(capability.executionDisposition)
      ?? (highRiskGoverned ? 'controlled' : null)
      ?? defaults.executionDisposition
      ?? (controlledRuntimeRequired(capability, { riskLevel }) ? 'controlled' : 'allow');
  const disabled = executionDisposition === 'blocked' || defaults.enabled === false;
  const executionGates = executionGatesForCapability(capability, {
    riskLevel,
    executionDisposition,
    executionGates: defaults.executionGates,
  }, executionDisposition);
  const reasonCode = sitePolicyDisabled
    ? 'site-policy-disabled-action'
    : forcedDisabled
      ? 'forced-action-disabled'
    : disabled
      ? `${riskLevel}-default-disabled`
      : `${riskLevel}-${executionDisposition}`;
  return {
    schemaVersion: RISK_POLICY_SCHEMA_VERSION,
    riskLevel,
    defaultAction: defaults.defaultAction,
    defaultExecutionDisposition: defaults.executionDisposition,
    executionDisposition,
    executionGates,
    enabled: !disabled,
    limited: defaults.limited === true,
    draftOnly: defaults.draftOnly === true,
    disabled,
    reasonCode,
    forcedDisabledActions: forcedActions,
    savedMaterial: SANITIZED_SUMMARY_ONLY,
    rawContentSaved: false,
    privateContentSaved: false,
  };
}

function enforceDraftOnlyPlan(plan = /** @type {any} */ ({})) {
  return {
    ...plan,
    governedExecution: true,
    executionDisposition: 'confirm_required',
    mode: 'dry_run',
    dryRunOnly: true,
    requiresConfirmation: true,
    autoExecute: false,
    draftOnly: true,
    steps: (Array.isArray(plan.steps) ? plan.steps : []).map((step) => ({
      ...step,
      governedExecution: true,
      executionDisposition: 'confirm_required',
      submit: false,
      finalSubmit: false,
      autoExecute: false,
      draftOnly: true,
    })),
  };
}

function enforceLimitedReadPlan(plan = /** @type {any} */ ({})) {
  return {
    ...plan,
    governedExecution: true,
    executionDisposition: 'controlled',
    mode: plan.mode === 'dry_run' ? plan.mode : 'limited_read',
    autoExecute: false,
    limitedOutputOnly: true,
    savedMaterial: SANITIZED_SUMMARY_ONLY,
    steps: (Array.isArray(plan.steps) ? plan.steps : []).map((step) => ({
      ...step,
      governedExecution: true,
      executionDisposition: 'controlled',
      submit: false,
      autoExecute: false,
      limitedOutputOnly: true,
      savedMaterial: SANITIZED_SUMMARY_ONLY,
    })),
  };
}

function governedDispositionForCapability(capability = /** @type {any} */ ({}), riskPolicy = createCapabilityRiskPolicy(capability)) {
  const text = joinedCapabilityText(capability);
  if (DESTRUCTIVE_ACTION_PATTERN.test(text) || PAYMENT_ACTION_PATTERN.test(text)) {
    return 'blocked';
  }
  const explicit = normalizeExecutionDisposition(capability.executionDisposition);
  if (explicit && explicit !== 'allow') {
    return explicit;
  }
  const policyDisposition = normalizeExecutionDisposition(riskPolicy.executionDisposition ?? riskPolicy.defaultExecutionDisposition);
  if (policyDisposition && policyDisposition !== 'allow') {
    return policyDisposition;
  }
  if (capabilityRequiresHighRiskExecutionGovernance(capability, riskPolicy)) {
    return 'controlled';
  }
  return controlledRuntimeRequired(capability, riskPolicy) ? 'controlled' : 'allow';
}

function enforceGovernedPlan(plan = /** @type {any} */ ({}), disposition = 'confirm_required') {
  const blocked = disposition === 'blocked';
  const requiresConfirmation = disposition === 'confirm_required';
  return {
    ...plan,
    governedExecution: true,
    executionDisposition: disposition,
    dryRunOnly: plan.dryRunOnly === true || blocked,
    requiresConfirmation: plan.requiresConfirmation === true || requiresConfirmation,
    autoExecute: false,
    savedMaterial: plan.savedMaterial ?? SANITIZED_SUMMARY_ONLY,
    steps: (Array.isArray(plan.steps) ? plan.steps : []).map((step) => ({
      ...step,
      governedExecution: true,
      executionDisposition: disposition,
      submit: blocked ? false : step.submit === true,
      finalSubmit: blocked ? false : step.finalSubmit === true,
      autoExecute: false,
      savedMaterial: step.savedMaterial ?? SANITIZED_SUMMARY_ONLY,
    })),
  };
}

function isSitePolicyDisabledCapability(capability = /** @type {any} */ ({})) {
  return capability.sitePolicyDisabled === true
    || (Array.isArray(capability.sitePolicyDisabledActions) && capability.sitePolicyDisabledActions.length > 0)
    || capability.activationBlockedReason === 'site-policy-disabled-action'
    || capability.disabledReason === 'site-policy-disabled-action';
}

export function applyCapabilityRiskPolicy(capability = /** @type {any} */ ({})) {
  const riskPolicy = createCapabilityRiskPolicy(capability);
  const isCandidate = capability.status === 'candidate';
  const sitePolicyDisabled = isSitePolicyDisabledCapability(capability);
  const enabledStatus = normalizeCapabilityEnablementStatus(capability, riskPolicy);
  const disposition = governedDispositionForCapability(capability, riskPolicy);
  const executionGates = executionGatesForCapability(capability, riskPolicy, disposition);
  const next = {
    ...capability,
    evidence: normalizeCapabilityEvidenceList(capability.evidence),
    riskPolicy: {
      ...riskPolicy,
      executionDisposition: disposition,
      executionGates,
      disabled: disposition === 'blocked',
      enabled: disposition !== 'blocked',
    },
    risk_level: capability.risk_level ?? riskPolicy.riskLevel,
    default_policy: capability.default_policy ?? (isCandidate ? 'candidate_debug_only' : riskPolicy.defaultAction),
    enabled_status: enabledStatus,
    evidence_status: capability.evidence_status ?? normalizeCapabilityEvidenceStatus(capability, enabledStatus),
    executionDisposition: disposition,
    executionGates,
    privacySafety: {
      savedMaterial: SANITIZED_SUMMARY_ONLY,
      rawContentSaved: false,
      privateContentSaved: false,
      evidenceStatus: 'sanitized_summary_only',
    },
  };
  if (enabledStatus === 'debug_only' || enabledStatus === 'candidate_debug_only') {
    const { executionPlan, ...withoutPlan } = next;
    return {
      ...withoutPlan,
      enabled: false,
      evidence_status: 'debug_only',
      displayStatus: enabledStatus,
    };
  }
  if (next.executionPlan && disposition !== 'allow') {
    next.executionPlan = enforceGovernedPlan(next.executionPlan, disposition);
  }
  if (disposition === 'blocked' || enabledStatus === 'disabled') {
    const disabledLifecycle = sitePolicyDisabled || (!next.executionPlan && next.status !== 'candidate');
    const disabledNext = disabledLifecycle
      ? (({ executionPlan: _executionPlan, ...rest }) => rest)(next)
      : next;
    return decorateCapabilitySafeRemediation({
      ...disabledNext,
      status: disabledLifecycle ? 'disabled' : (next.status === 'candidate' ? 'candidate' : 'active'),
      enabled: !disabledLifecycle,
      enabled_status: 'disabled',
      evidence_status: capability.evidence_status ?? normalizeCapabilityEvidenceStatus({ ...capability, enabled_status: 'enabled' }, 'enabled'),
      default_policy: 'disabled',
      disabledByPolicy: true,
      executionDisabledByDefault: true,
      disabledReason: next.riskPolicy.reasonCode,
      displayStatus: 'governed_blocked',
      planCallable: disabledLifecycle ? false : Boolean(disabledNext.executionPlan),
      runtimeCallable: disposition !== 'blocked',
      autoExecutable: false,
      executionDisposition: disposition,
      executionGates,
    });
  }
  if (!next.executionPlan && next.informational !== true && next.status !== 'candidate') {
    return decorateCapabilitySafeRemediation({
      ...next,
      status: 'disabled',
      enabled: false,
      enabled_status: 'disabled',
      evidence_status: capability.evidence_status ?? normalizeCapabilityEvidenceStatus({ ...capability, enabled_status: 'enabled' }, 'enabled'),
      default_policy: 'disabled',
      disabledByPolicy: true,
      executionDisabledByDefault: true,
      disabledReason: 'execution-plan-missing',
      activationBlockedReason: capability.activationBlockedReason ?? 'execution-plan-missing',
      displayStatus: 'governed_blocked',
      planCallable: false,
      runtimeCallable: false,
      autoExecutable: false,
      executionDisposition: 'blocked',
      executionGates: uniqueExecutionGates([...executionGates, 'permission_required']),
    });
  }
  if (disposition !== 'allow') {
    return {
      ...next,
      status: next.status === 'disabled' || next.status === 'discarded' ? 'active' : (next.status ?? 'active'),
      enabled: true,
      displayStatus: 'governed_controlled',
      executionDisabledByDefault: false,
      planCallable: Boolean(next.executionPlan),
      runtimeCallable: Boolean(next.executionPlan),
      autoExecutable: false,
      executionDisposition: disposition,
      executionGates,
    };
  }
  if (next.executionPlan && riskPolicy.draftOnly) {
    next.executionPlan = enforceDraftOnlyPlan(next.executionPlan);
  } else if (next.executionPlan && riskPolicy.limited) {
    next.executionPlan = enforceLimitedReadPlan(next.executionPlan);
  }
  return {
    ...next,
    enabled: true,
    executionDisabledByDefault: false,
    runtimeCallable: next.runtimeCallable ?? Boolean(next.executionPlan),
    autoExecutable: next.autoExecutable ?? (Boolean(next.executionPlan) && disposition === 'allow'),
  };
}

export function applyRiskDefaults(capability = /** @type {any} */ ({}), options = /** @type {any} */ ({})) {
  const riskLevel = options.riskLevel ?? capability.risk_level ?? inferCapabilityRiskLevel(capability);
  const policy = riskPolicyForLevel(riskLevel);
  const sitePolicyDisabled = isSitePolicyDisabledCapability(capability);
  const forceDisabled = options.forceDisabled === true
    && (
      findForcedDisabledActions(joinedCapabilityText(capability)).length > 0
      || capabilityHasPrivateBodyRisk(capability)
      || DESTRUCTIVE_ACTION_PATTERN.test(joinedCapabilityText(capability))
      || PAYMENT_ACTION_PATTERN.test(joinedCapabilityText(capability))
    );
  const executionDisposition = forceDisabled
    ? 'blocked'
    : governedDispositionForCapability(capability, policy);
  const executionGates = executionGatesForCapability(capability, policy, executionDisposition);
  const disabled = executionDisposition === 'blocked' || policy.disabled;
  const runtimeOptions = { ...options };
  if (
    !forceDisabled
    && ['disabled', 'confirmation_required', 'draft_only', 'limited_enabled'].includes(normalizeEnabledStatus(runtimeOptions.enabledStatus) ?? '')
  ) {
    delete runtimeOptions.enabledStatus;
  }
  if (
    !forceDisabled
    && ['disabled', 'confirmation_required', 'draft_only', 'limited_enabled', 'confirm_or_limited', 'disabled_or_confirm_limited'].includes(normalizeDefaultPolicy(runtimeOptions.defaultPolicy) ?? '')
  ) {
    delete runtimeOptions.defaultPolicy;
  }
  const runtimeDefaults = riskPolicyRuntimeDefaults(policy, runtimeOptions);
  const evidenceSources = Array.isArray(options.evidenceSources) && options.evidenceSources.length
    ? options.evidenceSources
    : normalizeCapabilityEvidenceList(capability.evidence).map((item) => item.evidence_source).filter(Boolean);
  const next = {
    ...capability,
    riskPolicy: {
      ...policy,
      disabled,
      enabled: !disabled,
      executionDisposition,
      executionGates,
      reasonCode: forceDisabled ? 'forced-action-disabled' : `${policy.riskLevel}-${executionDisposition}`,
    },
    risk_level: policy.riskLevel,
    default_policy: disabled ? 'disabled' : runtimeDefaults.defaultPolicy,
    evidence: normalizeCapabilityEvidenceList(capability.evidence),
    evidence_sources: [...new Set(evidenceSources.length ? evidenceSources : ['structure'])],
    saved_material: [SANITIZED_SUMMARY_ONLY],
    raw_content_saved: false,
    private_content_saved: false,
    privacySafety: {
      savedMaterial: SANITIZED_SUMMARY_ONLY,
      rawContentSaved: false,
      privateContentSaved: false,
      evidenceStatus: 'sanitized_summary_only',
    },
  };
  if (options.userReason) {
    next.user_reason = options.userReason;
  }
  if (options.userStrategy) {
    next.user_strategy = options.userStrategy;
  }
  next.enabled_status = normalizeCapabilityEnablementStatus({
    ...next,
    enabled_status: disabled ? 'disabled' : runtimeDefaults.enabledStatus,
  }, next.riskPolicy);
  next.evidence_status = capability.evidence_status ?? normalizeCapabilityEvidenceStatus(next, next.enabled_status);
  next.executionDisposition = executionDisposition;
  next.executionGates = executionGates;
  if (disabled) {
    if (next.executionPlan) {
      next.executionPlan = enforceGovernedPlan(next.executionPlan, executionDisposition);
    }
    const disabledLifecycle = sitePolicyDisabled || (!next.executionPlan && next.status !== 'candidate');
    const disabledNext = disabledLifecycle
      ? (({ executionPlan: _executionPlan, ...rest }) => rest)(next)
      : next;
    return {
      ...disabledNext,
      status: disabledLifecycle ? 'disabled' : (next.status === 'candidate' ? 'candidate' : 'active'),
      enabled: !disabledLifecycle,
      disabledByPolicy: true,
      executionDisabledByDefault: true,
      disabledReason: next.riskPolicy.reasonCode,
      displayStatus: 'governed_blocked',
      planCallable: disabledLifecycle ? false : Boolean(disabledNext.executionPlan),
      runtimeCallable: executionDisposition !== 'blocked' && Boolean(disabledNext.executionPlan),
      autoExecutable: false,
      executionDisposition,
      executionGates,
    };
  }
  if (executionDisposition !== 'allow') {
    if (next.executionPlan) {
      next.executionPlan = enforceGovernedPlan(next.executionPlan, executionDisposition);
    }
    return {
      ...next,
      status: next.status === 'disabled' || next.status === 'discarded' ? 'active' : (next.status ?? 'active'),
      enabled: true,
      executionDisabledByDefault: false,
      displayStatus: 'governed_controlled',
      planCallable: Boolean(next.executionPlan),
      runtimeCallable: Boolean(next.executionPlan),
      autoExecutable: false,
      executionDisposition,
      executionGates,
    };
  }
  return {
    ...next,
    status: next.status === 'disabled' || next.status === 'discarded' ? 'active' : (next.status ?? 'active'),
    enabled: true,
    executionDisabledByDefault: false,
    executionDisposition,
    executionGates,
  };
}

export function validateExecutionPlanAgainstRiskPolicy(capability = /** @type {any} */ ({})) {
  const errors = /** @type {any[]} */ ([]);
  const riskPolicy = capability.riskPolicy ?? createCapabilityRiskPolicy(capability);
  const plan = capability.executionPlan;
  if (riskPolicy.disabled && plan && !isGovernedNonAutoPlan(plan)) {
    errors.push({
      code: 'capability.risk_policy_disabled_plan_not_governed',
      message: `Capability ${capability.id} is disabled by default and must carry only a governed non-auto execution plan.`,
    });
  }
  if (riskPolicy.draftOnly && plan && (plan.dryRunOnly !== true || plan.requiresConfirmation !== true)) {
    errors.push({
      code: 'capability.write_low_requires_draft_only',
      message: `Write-low capability ${capability.id} must remain draft-only with confirmation.`,
    });
  }
  if (riskPolicy.limited && plan && plan.limitedOutputOnly !== true && plan.requiresConfirmation !== true) {
    errors.push({
      code: 'capability.sensitive_read_requires_limited_or_confirmed',
      message: `Sensitive read capability ${capability.id} must be limited-output or confirmation-gated.`,
    });
  }
  for (const { label, plan: safetyPlan } of capabilitySafetyPlans(capability)) {
    const forcedPlanActions = findForcedExecutablePlanActions(safetyPlan);
    if ((!isGovernedNonAutoPlan(safetyPlan) && forcedPlanActions.length) || safetyPlan?.autoExecute === true) {
      errors.push({
        code: 'capability.forced_action_execution_blocked',
        message: `Capability ${capability.id} ${label} contains a disabled action.`,
        forcedDisabledActions: forcedPlanActions,
        planField: label,
      });
    }
    const unsafeMaterialFlags = findUnsafeExecutionPlanMaterialFlags(safetyPlan);
    if (unsafeMaterialFlags.length) {
      errors.push({
        code: 'capability.plan_material_privacy_policy_invalid',
        message: `Capability ${capability.id} ${label} allows raw or private material.`,
        unsafeMaterialFlags,
        planField: label,
      });
    }
  }
  return errors;
}

export function riskPolicySummary(capabilities = /** @type {any[]} */ ([])) {
  const summary = {
    read_public_low: 0,
    read_personal_medium: 0,
    read_private_high: 0,
    write_low: 0,
    write_high: 0,
    account_security_critical: 0,
    disabled: 0,
    draftOnly: 0,
    limited: 0,
    enablementStatus: capabilityEnablementStatusCounts(capabilities),
    evidenceStatus: capabilityEvidenceStatusSummary(capabilities),
  };
  for (const capability of Array.isArray(capabilities) ? capabilities : []) {
    const policy = capability.riskPolicy ?? createCapabilityRiskPolicy(capability);
    summary[policy.riskLevel] = (summary[policy.riskLevel] ?? 0) + 1;
    if (policy.disabled || capability.status === 'disabled') {
      summary.disabled += 1;
    }
    if (policy.draftOnly) {
      summary.draftOnly += 1;
    }
    if (policy.limited) {
      summary.limited += 1;
    }
  }
  return summary;
}

export function privacySummary() {
  return {
    schemaVersion: RISK_POLICY_SCHEMA_VERSION,
    savedMaterial: SANITIZED_SUMMARY_ONLY,
    allowedSensitiveReadSummaryFields: [
      'page_type',
      'item_count',
      'time_range_summary',
      'list_presence',
      'unread_marker_presence',
      'route_template',
      'structure_hash',
    ],
    forbiddenMaterial: [
      'body_text',
      'account_identifier',
      'cookie',
      'token',
      'private_message_body',
      'notification_body',
      'raw_dom',
      'raw_html',
    ],
    rawContentSaved: false,
    privateContentSaved: false,
  };
}

export function assertSafeReportValue(value) {
  assertNoForbiddenPatterns(value);
  return true;
}
