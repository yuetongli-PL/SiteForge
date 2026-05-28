// @ts-check

import { uniqueSortedStrings } from '../../../shared/normalize.mjs';
import {
  buildCapabilitySafeRemediationPath,
  capabilityEnablementStatusCounts,
  capabilityEvidenceStatusSummary,
  normalizeCapabilityEnablementStatus,
  normalizeCapabilityEvidenceStatus,
  publicSafeRemediation,
  riskPolicySummary,
} from './risk-policy.mjs';
import { isDebugOnlyCapability } from './collection-outcomes.mjs';
import { sanitizeReportPublicValue } from './user-report-values.mjs';

export function userReportGroupForCapability(capability = /** @type {any} */ ({})) {
  const status = normalizeCapabilityEnablementStatus(capability);
  if (status === 'enabled') return 'enabled';
  if (status === 'limited_enabled') return 'limited_enabled';
  if (status === 'confirmation_required' || status === 'draft_only') return 'confirmation_required';
  return 'disabled';
}

export function userCapabilityReason(capability = /** @type {any} */ ({})) {
  if (capability.user_reason) {
    return capability.user_reason;
  }
  const text = `${capability.name ?? ''} ${capability.object ?? ''}`.toLowerCase();
  if (isDebugOnlyCapability(capability)) {
    return 'Candidate capability only; evidence is incomplete, so it is not enabled by default.';
  }
  if (capability.risk_level === 'account_security_critical') {
    return 'Account security or payment settings are involved, so the capability is disabled by default.';
  }
  if (capability.risk_level === 'write_high') {
    if (/direct message|dm/u.test(text)) {
      return 'Direct messages, recipients, or sending actions are involved, so the capability is disabled by default.';
    }
    return 'Publishing, interaction, deletion, upload, or follow-style write actions are involved, so the capability is disabled by default.';
  }
  if (capability.risk_level === 'read_private_high') {
    return 'Private body text or personal conversations may be involved, so the capability is disabled by default.';
  }
  if (capability.risk_level === 'read_personal_medium') {
    return 'Personalized or login-only information requires limited summaries or explicit confirmation.';
  }
  if (capability.risk_level === 'write_low') {
    return 'Only draft preview is allowed; SiteForge will not submit the action.';
  }
  return 'Only sanitized structural summaries are retained; body text and account-private material are not saved.';
}

export function userCapabilityStrategy(capability = /** @type {any} */ ({})) {
  if (capability.user_strategy) {
    return capability.user_strategy;
  }
  const status = normalizeCapabilityEnablementStatus(capability);
  if (status === 'limited_enabled') {
    return 'Return only limited sanitized summaries.';
  }
  if (status === 'confirmation_required') {
    return 'Require user confirmation before execution.';
  }
  if (status === 'draft_only' || capability.default_policy === 'draft_only') {
    return 'Generate drafts only; do not submit, upload, or select sensitive recipients.';
  }
  if (status === 'disabled' || capability.default_policy === 'disabled' || capability.status !== 'active') {
    return 'Disabled by default and never auto-executed.';
  }
  return 'Read-only by default with sanitized output.';
}

export function safeExecutionPlanRoute(value) {
  if (!value) return null;
  const text = String(value ?? '').trim();
  if (!text) return null;
  if (/^https?:\/\//iu.test(text)) {
    try {
      return new URL(text).pathname || '/';
    } catch {
      return null;
    }
  }
  if (/^[/?#]/u.test(text)) {
    return text.split(/[?#]/u)[0] || '/';
  }
  return /^[A-Za-z0-9_./:@-]{1,160}$/u.test(text) ? text : null;
}

export function executionPlanCard(plan = null) {
  if (!plan || typeof plan !== 'object') return {};
  const steps = Array.isArray(plan.steps) ? plan.steps : [];
  const firstRoute = steps
    .map((step) => safeExecutionPlanRoute(step?.routeTemplate ?? step?.route ?? step?.routePath ?? step?.url ?? step?.href ?? step?.endpoint))
    .find(Boolean);
  const stepKinds = uniqueSortedStrings(steps
    .map((step) => String(step?.kind ?? step?.type ?? '').replace(/[^a-z0-9_.:-]+/giu, '_'))
    .filter(Boolean));
  return {
    execution_plan_id: plan.id ?? null,
    execution_plan_mode: plan.mode ?? null,
    execution_plan_dry_run_only: plan.dryRunOnly === true,
    execution_plan_requires_confirmation: plan.requiresConfirmation === true,
    execution_plan_auto_execute: plan.autoExecute === true,
    execution_plan_requires_user_approval: plan.requiresUserAuthorization === true
      || plan.requiresUserApproval === true
      || steps.some((step) => (
        step?.requiresUserAuthorization === true
        || step?.requiresUserApproval === true
        || step?.reusesExistingLoginState === true
      )),
    execution_plan_step_kinds: stepKinds,
    execution_plan_step_count: steps.length,
    route_template: safeExecutionPlanRoute(plan.routeTemplate ?? plan.route) ?? firstRoute,
  };
}

export function buildCapabilityCard(capability = /** @type {any} */ ({})) {
  const enabledStatus = normalizeCapabilityEnablementStatus(capability);
  const evidenceStatus = normalizeCapabilityEvidenceStatus(capability, enabledStatus);
  const safeRemediation = capability.safe_remediation
    ?? capability.safeRemediation
    ?? publicSafeRemediation(buildCapabilitySafeRemediationPath(capability));
  return {
    id: capability.id ?? null,
    name: capability.name ?? null,
    user_facing_name: capability.user_facing_name ?? capability.userValue ?? capability.name ?? null,
    risk_level: capability.risk_level ?? capability.riskPolicy?.riskLevel ?? null,
    enabled_status: enabledStatus,
    report_group: userReportGroupForCapability(capability),
    default_policy: capability.default_policy ?? null,
    evidence_status: evidenceStatus,
    action: capability.action ?? null,
    status: capability.status ?? null,
    safety_level: capability.safetyLevel ?? capability.safety ?? null,
    selected_by_setup: capability.selectedBySetup === true,
    setup_capability_id: capability.setupCapabilityId ?? null,
    requires_capability_evidence: capability.requiresCapabilityEvidence === true,
    capability_verified: capability.capabilityVerified === true,
    browser_seed_backed: capability.browserSeedBacked === true,
    proof_summary: capability.proofSummary ?? null,
    safe_remediation_path: safeRemediation?.path ?? null,
    safe_remediation: safeRemediation ?? null,
    ...executionPlanCard(capability.executionPlan),
    reason: userCapabilityReason(capability),
    strategy: userCapabilityStrategy(capability),
  };
}

/** @returns {any} */
export function buildCapabilityStateModel(capabilities = /** @type {any[]} */ ([])) {
  const groups = {
    enabled: [],
    limited_enabled: [],
    confirmation_required: [],
    disabled: [],
  };
  for (const capability of Array.isArray(capabilities) ? capabilities : []) {
    const card = buildCapabilityCard(capability);
    groups[card.report_group].push(card);
  }
  return {
    groups,
    enablement_status_counts: capabilityEnablementStatusCounts(capabilities),
    evidence_status_summary: capabilityEvidenceStatusSummary(capabilities),
  };
}

/** @returns {any} */
export function capabilityCounts(capabilities = /** @type {any[]} */ ([])) {
  const enabledStatus = capabilityEnablementStatusCounts(capabilities);
  return sanitizeReportPublicValue({
    active: capabilities.filter((capability) => capability.status === 'active').length,
    candidate: capabilities.filter((capability) => capability.status === 'candidate').length,
    discarded: capabilities.filter((capability) => capability.status === 'discarded').length,
    disabled: capabilities.filter((capability) => capability.status === 'disabled').length,
    total: capabilities.length,
    enabledStatus,
    countedTotal: enabledStatus.countedTotal,
    embeddedIntents: capabilities.reduce((sum, capability) => sum + (capability.intents?.length ?? 0), 0),
    riskPolicy: riskPolicySummary(capabilities),
  });
}

function normalizeStatusToken(value) {
  return String(value ?? '').trim().toLowerCase();
}

function capabilitySortText(capability = /** @type {any} */ ({})) {
  return [
    capability.category,
    capability.name,
    capability.user_facing_name,
    capability.userFacingName,
    capability.userValue,
    capability.description,
    capability.action,
    capability.object,
    capability.setupCapabilityId,
  ].filter(Boolean).join(' ').toLowerCase();
}

export function capabilityUserSortRank(capability = /** @type {any} */ ({})) {
  const text = capabilitySortText(capability);
  const riskLevel = normalizeStatusToken(capability.risk_level ?? capability.riskPolicy?.riskLevel);
  const defaultPolicy = normalizeStatusToken(capability.default_policy);
  const enabledStatus = normalizeStatusToken(capability.enabled_status);
  const status = normalizeStatusToken(capability.status);
  if (
    ['write_high', 'account_security_critical'].includes(riskLevel)
    || (enabledStatus === 'disabled' && /account|security|settings|delete|follow|like|repost|upload|payment|checkout|publish|send/u.test(text))
  ) {
    return 80;
  }
  if (riskLevel === 'write_low' || defaultPolicy === 'draft_only' || /draft|compose|reply draft|quote-post draft|post draft/u.test(text)) {
    return 60;
  }
  if (/notification|bookmark|\blists?\b|direct message|\bdm\b|following|followers|personal|account profile|timeline/u.test(text)) {
    return 50;
  }
  if (/post detail|post thread|reply tree|replies|quote|media|article detail|product detail|detail/u.test(text)) {
    return 40;
  }
  if (/profile|author|creator|homepage content/u.test(text)) {
    return 30;
  }
  if (/search|query|filter/u.test(text)) {
    return 20;
  }
  if (/homepage|home page|view|browse|timeline|feed|article|product|news|content/u.test(text)) {
    return 10;
  }
  if (status === 'disabled' || enabledStatus === 'disabled') {
    return 70;
  }
  if (/nav|navigate|route|menu|tab|modal|external|explore|open/u.test(text)) {
    return 65;
  }
  return 55;
}

export function sortCapabilitiesForUser(capabilities = /** @type {any[]} */ ([])) {
  return [...(Array.isArray(capabilities) ? capabilities : [])]
    .sort((left, right) => (
      capabilityUserSortRank(left) - capabilityUserSortRank(right)
      || String(left.user_facing_name ?? left.userFacingName ?? left.userValue ?? left.name ?? left.id ?? '')
        .localeCompare(String(right.user_facing_name ?? right.userFacingName ?? right.userValue ?? right.name ?? right.id ?? ''), 'zh-Hans')
      || String(left.id ?? '').localeCompare(String(right.id ?? ''), 'en')
    ));
}

export function isHighRiskOrAccountDisabled(card = /** @type {any} */ ({})) {
  return card.report_group === 'disabled'
    && (
      ['write_high', 'account_security_critical'].includes(card.risk_level)
      || ['submit', 'upload', 'book', 'purchase', 'login', 'register', 'manage', 'contact'].includes(card.action)
    );
}
