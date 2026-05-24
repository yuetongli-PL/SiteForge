// @ts-check

import { capabilityConfirmationGroup } from './confirmation-flow.mjs';

export const CAPABILITY_DECISION_RECORDS_SCHEMA_VERSION = 1;

const SAFETY_FLAGS = Object.freeze({
  writeActionsEnabled: false,
  finalActionsAllowed: false,
  rawMaterialAllowed: false,
  privateContentAllowed: false,
});

function asText(value) {
  return String(value ?? '').trim();
}

export function createConfirmationLoginStateReuse({ targetRoute = null } = /** @type {any} */ ({})) {
  return {
    strategy: 'reuse_existing_system_browser_login_state',
    status: 'ready_for_sanitized_authorized_recheck',
    reusesExistingLoginState: true,
    requiresNewLogin: false,
    userMustRemainSignedIn: true,
    targetRoute,
    browser: 'system_default_browser',
    evidenceToCollect: 'sanitized_structure_summary_only',
    cookiesPersisted: false,
    tokensPersisted: false,
    credentialsPersisted: false,
    browserProfilePersisted: false,
    rawDomPersisted: false,
    rawHtmlPersisted: false,
    rawContentPersisted: false,
    privateContentPersisted: false,
  };
}

export function createConfirmationLoginStateReuseSummary(options = /** @type {any} */ ({})) {
  const reuse = createConfirmationLoginStateReuse(options);
  return {
    strategy: reuse.strategy,
    status: reuse.status,
    reuses_existing_login_state: reuse.reusesExistingLoginState,
    requires_new_login: reuse.requiresNewLogin,
    user_must_remain_signed_in: reuse.userMustRemainSignedIn,
    target_route: reuse.targetRoute,
    evidence_to_collect: reuse.evidenceToCollect,
    cookies_persisted: reuse.cookiesPersisted,
    tokens_persisted: reuse.tokensPersisted,
    credentials_persisted: reuse.credentialsPersisted,
    browser_profile_persisted: reuse.browserProfilePersisted,
    raw_dom_persisted: reuse.rawDomPersisted,
    raw_html_persisted: reuse.rawHtmlPersisted,
    raw_content_persisted: reuse.rawContentPersisted,
    private_content_persisted: reuse.privateContentPersisted,
  };
}

export function confirmationDecisionForMode(mode) {
  if (mode === 'draft_only') return 'confirmed_draft_only';
  if (mode === 'limited') return 'confirmed_limited';
  if (mode === 'disabled') return 'disabled';
  return 'confirmed_safe_capability';
}

export function confirmationUsablePathForMode(mode, { targetRoute = null } = /** @type {any} */ ({})) {
  const loginStateReuse = createConfirmationLoginStateReuse({ targetRoute });
  if (mode === 'limited') {
    return {
      type: 'limited_sanitized_summary_path',
      readiness: 'immediate_limited_sanitized_summary',
      resultingStatus: 'limited_enabled',
      loginStateReuse,
    };
  }
  if (mode === 'draft_only') {
    return {
      type: 'draft_only_preview_path',
      readiness: 'immediate_draft_only_preview',
      resultingStatus: 'draft_only',
      loginStateReuse,
    };
  }
  return {
    type: 'safe_confirmed_capability_path',
    readiness: 'immediate_confirmed_capability',
    resultingStatus: mode === 'disabled' ? 'disabled' : 'enabled',
    loginStateReuse,
  };
}

export function buildCapabilityConfirmationDecisionRecord({
  capability = /** @type {any} */ ({}),
  mode = 'confirmation',
  decision = confirmationDecisionForMode(mode),
  command = 'siteforge build capability decision record',
  source = null,
  sourceBuildId = null,
  updatedAt = new Date().toISOString(),
  targetRoute = null,
  usableAfterSelection = decision !== 'disabled',
} = /** @type {any} */ ({})) {
  const usablePath = confirmationUsablePathForMode(mode, { targetRoute });
  const capabilityId = asText(capability.id ?? capability.capabilityId ?? capability.name);
  return {
    capabilityId,
    capabilityName: capability.name ?? capability.user_facing_name ?? capability.userFacingName ?? null,
    group: capabilityConfirmationGroup(capability),
    decision,
    mode,
    usableAfterSelection,
    usablePathType: usablePath.type,
    usablePath,
    loginStateReuse: usablePath.loginStateReuse,
    completedBy: usableAfterSelection ? 'reused_user_login_state' : 'disabled_by_user_choice',
    immediateLimitedUse: usableAfterSelection && usablePath.readiness.startsWith('immediate_'),
    requiresSiteAdapterVerificationBeforeUse: false,
    command,
    ...(source ? { source } : {}),
    evidenceStatus: capability.evidence_status ?? capability.evidenceStatus ?? null,
    sourceBuildId,
    ...SAFETY_FLAGS,
    updatedAt,
  };
}

function decisionKey(entry = /** @type {any} */ ({})) {
  return `${entry.capabilityId}:${entry.decision}:${entry.mode}`;
}

export function mergeCapabilityDecisionRecords(existingDecisions = /** @type {any[]} */ ([]), nextDecisions = /** @type {any[]} */ ([])) {
  const decisionByKey = new Map((Array.isArray(existingDecisions) ? existingDecisions : []).map((entry) => [
    decisionKey(entry),
    entry,
  ]));
  for (const decision of nextDecisions) {
    decisionByKey.set(decisionKey(decision), decision);
  }
  return [...decisionByKey.values()].sort((left, right) => (
    String(left.capabilityId).localeCompare(String(right.capabilityId), 'en')
    || String(left.decision).localeCompare(String(right.decision), 'en')
    || String(left.mode).localeCompare(String(right.mode), 'en')
  ));
}
