import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile, rm } from 'node:fs/promises';

import {
  capabilityInteractionState,
  writeCapabilityInteractionDecisions,
  writeCapabilityRemediationPlan,
} from '../../src/app/pipeline/build/capability-interaction.mjs';
import {
  buildCapabilityConfirmationDecisionRecord,
} from '../../src/app/pipeline/build/capability-decision-records.mjs';

async function createSiteDir(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'siteforge-capability-interaction-'));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  return root;
}

function safeReadPlan(capabilityId) {
  return {
    id: `plan:${capabilityId}`,
    capabilityId,
    mode: 'limited_read',
    autoExecute: false,
    limitedOutputOnly: true,
    savedMaterial: 'sanitized_summary_only',
    steps: [
      {
        kind: 'read_sanitized_summary',
        autoExecute: false,
        submit: false,
        finalSubmit: false,
        upload: false,
        limitedOutputOnly: true,
        savedMaterial: 'sanitized_summary_only',
      },
    ],
  };
}

function safeLimitedReadSummaryPlan(capabilityId) {
  return {
    id: `plan:${capabilityId}`,
    capabilityId,
    mode: 'limited_read_summary',
    autoExecute: false,
    requiresConfirmation: true,
    limitedOutputOnly: true,
    savedMaterial: 'sanitized_summary_only',
    steps: [
      {
        kind: 'read_sanitized_summary',
        autoExecute: false,
        submit: false,
        finalSubmit: false,
        upload: false,
        selectSensitiveRecipient: false,
        limitedOutputOnly: true,
        savedMaterial: 'sanitized_summary_only',
      },
    ],
  };
}

function safeDraftPlan(capabilityId) {
  return {
    id: `plan:${capabilityId}`,
    capabilityId,
    mode: 'draft_only',
    dryRunOnly: true,
    autoExecute: false,
    steps: [
      {
        kind: 'prepare_draft',
        autoExecute: false,
        submit: false,
        finalSubmit: false,
        upload: false,
      },
    ],
  };
}

function unsafeSubmittingDraftPlan(capabilityId) {
  return {
    id: `plan:${capabilityId}`,
    capabilityId,
    mode: 'draft_only',
    dryRunOnly: true,
    autoExecute: false,
    steps: [
      {
        kind: 'submit_draft',
        autoExecute: false,
        submit: true,
        finalSubmit: true,
      },
    ],
  };
}

let capabilitySequence = 0;

function capability(name, overrides = /** @type {any} */ ({})) {
  capabilitySequence += 1;
  const id = `capability:test:${capabilitySequence}`;
  return {
    id,
    name,
    user_facing_name: name,
    status: 'active',
    enabled_status: 'confirmation_required',
    default_policy: 'confirmation_required',
    risk_level: 'read_personal_medium',
    evidence_status: 'confirmation_required',
    source_nodes: ['node:test'],
    raw_content_saved: false,
    private_content_saved: false,
    executionPlan: safeReadPlan(id),
    ...overrides,
  };
}

function remediationPathType(entry = /** @type {any} */ ({})) {
  const remediation = entry.safe_remediation
    ?? entry.safeRemediation
    ?? entry.safe_remediation_path
    ?? entry.safeRemediationPath;
  if (typeof remediation === 'string') {
    return remediation;
  }
  return entry.pathType ?? entry.type ?? remediation?.path ?? remediation?.type ?? null;
}

const ALLOWED_PUBLIC_REMEDIATION_TYPES = [
  'limited_sanitized_summary_path',
  'draft_only_preview_path',
  'explicit_external_adapter_path',
  'user_mediated_safe_action_path',
  'manual_review_task',
  'site_adapter_required_note',
];

function isLimitedReadRemediation(type) {
  return type === 'limited_sanitized_summary_path';
}

function isDisabledReviewRemediation(type) {
  return ['explicit_external_adapter_path', 'user_mediated_safe_action_path', 'manual_review_task', 'site_adapter_required_note'].includes(type);
}

function result(siteDir) {
  const limited = capability('读取推荐时间线', {
    enabled_status: 'limited_enabled',
    default_policy: 'limited_enabled',
  });
  const confirmation = capability('读取通知摘要');
  const draft = capability('创建发帖草稿', {
    enabled_status: 'confirmation_required',
    default_policy: 'draft_only',
    risk_level: 'write_low',
    executionPlan: safeDraftPlan('capability:test:create-post-draft'),
  });
  const missingPlan = capability('读取缺少计划的能力', {
    executionPlan: undefined,
  });
  const disabled = capability('删除帖子', {
    status: 'disabled',
    enabled_status: 'disabled',
    default_policy: 'disabled',
    risk_level: 'write_high',
    executionPlan: {
      id: 'plan:test:delete',
      autoExecute: true,
      steps: [{ kind: 'delete', finalSubmit: true }],
    },
  });
  return {
    status: 'success',
    result_status: 'partial_success',
    build_id: 'build-test',
    buildContext: { siteDir },
    user_report: {
      result_status: 'partial_success',
      skill_id: 'x-com-authorized-browser-surface',
      build_id: 'build-test',
      limited_enabled_capabilities: [limited],
      confirmation_required_capabilities: [confirmation, draft, missingPlan],
      disabled_capabilities: [disabled],
    },
  };
}

test('capability interaction offers only evidence-backed safe confirmations', async (t) => {
  const siteDir = await createSiteDir(t);
  const buildResult = result(siteDir);

  const state = capabilityInteractionState(buildResult);
  assert.equal(state.safeConfirmable.length, 3);
  assert.equal(state.blockedConfirmable.length, 1);
  assert.equal(state.disabledReview.length, 1);
  assert.equal(state.safeConfirmable.some((entry) => entry.user_facing_name === '删除帖子'), false);

  const recorded = await writeCapabilityInteractionDecisions(
    buildResult,
    [...state.safeConfirmable, ...state.disabledReview],
    { siteDir },
  );
  assert.equal(recorded.status, 'recorded');
  assert.equal(recorded.count, 3);

  const decisions = JSON.parse(await readFile(path.join(siteDir, 'capability_confirmations.json'), 'utf8'));
  assert.equal(decisions.skillId, 'x-com-authorized-browser-surface');
  assert.equal(decisions.decisions.length, 3);
  assert.equal(decisions.decisions.some((entry) => /delete/u.test(entry.capabilityId)), false);
  assert.equal(decisions.decisions.every((entry) => entry.usableAfterSelection === true), true);
  assert.equal(decisions.decisions.every((entry) => entry.usablePathType && entry.usablePath?.readiness), true);
  assert.equal(decisions.decisions.every((entry) => entry.completedBy === 'reused_user_login_state'), true);
  assert.equal(decisions.decisions.every((entry) => entry.loginStateReuse?.reusesExistingLoginState === true), true);
  assert.equal(decisions.decisions.every((entry) => entry.loginStateReuse?.requiresNewLogin === false), true);
  assert.equal(decisions.decisions.every((entry) => entry.loginStateReuse?.cookiesPersisted === false), true);
  assert.equal(decisions.decisions.every((entry) => entry.loginStateReuse?.tokensPersisted === false), true);
  assert.equal(decisions.decisions.every((entry) => entry.loginStateReuse?.browserProfilePersisted === false), true);
  assert.equal(decisions.decisions.every((entry) => entry.loginStateReuse?.rawDomPersisted === false), true);
  assert.equal(decisions.decisions.every((entry) => entry.loginStateReuse?.rawHtmlPersisted === false), true);
  assert.equal(decisions.decisions.every((entry) => entry.requiresSiteAdapterVerificationBeforeUse === false), true);
  assert.equal(decisions.decisions.every((entry) => entry.writeActionsEnabled === false), true);
  assert.equal(decisions.decisions.every((entry) => entry.finalActionsAllowed === false), true);
  assert.equal(decisions.decisions.every((entry) => entry.rawMaterialAllowed === false), true);
  assert.equal(decisions.decisions.every((entry) => entry.privateContentAllowed === false), true);
  assert.equal(decisions.decisions.some((entry) => entry.mode === 'draft_only'), true);
  assert.equal(decisions.decisions.some((entry) => entry.mode === 'limited'), true);
  const limitedDecision = decisions.decisions.find((entry) => entry.mode === 'limited');
  const limitedCapability = state.safeConfirmable.find((entry) => entry.id === limitedDecision.capabilityId);
  assert.deepEqual(limitedDecision, buildCapabilityConfirmationDecisionRecord({
    capability: limitedCapability,
    mode: 'limited',
    command: 'siteforge build capability decision record',
    source: 'siteforge_build_capability_record',
    sourceBuildId: 'build-test',
    updatedAt: limitedDecision.updatedAt,
  }));
});

test('capability interaction writes remediation plans without enabling disabled capabilities', async (t) => {
  const siteDir = await createSiteDir(t);
  const buildResult = result(siteDir);
  const state = capabilityInteractionState(buildResult);

  assert.equal(state.remediationCandidates.length, 2);
  assert.equal(state.remediationSummary.total, 2);
  assert.equal(state.remediationSummary.autoPreparable, 2);
  assert.equal(state.remediationSummary.immediateLimitedUse, 2);
  assert.equal(state.remediationSummary.requiresSiteAdapterVerification, 0);
  assert.equal(state.remediationSummary.limitedSanitizedSummaryPath, 1);
  assert.equal(state.remediationSummary.explicitExternalAdapterPath, 0);
  assert.equal(state.remediationSummary.userMediatedSafeActionPath ?? 0, 1);
  assert.equal(state.remediationSummary.manualReviewTask + state.remediationSummary.siteAdapterRequiredNote, 0);
  assert.equal(Object.hasOwn(state.remediationSummary, 'limitedReadSummary'), false);
  assert.equal(Object.hasOwn(state.remediationSummary, 'notSupported'), false);
  assert.equal(state.remediationCandidates.some((entry) => isLimitedReadRemediation(remediationPathType(entry))), true);
  assert.equal(state.remediationCandidates.some((entry) => isDisabledReviewRemediation(remediationPathType(entry))), true);

  const recorded = await writeCapabilityRemediationPlan(buildResult, state.remediationCandidates, { siteDir });
  assert.equal(recorded.status, 'recorded');
  assert.equal(recorded.count, 2);
  assert.equal(recorded.summary.total, 2);
  assert.equal(recorded.summary.autoPreparable, 2);
  assert.equal(recorded.summary.immediateLimitedUse, 2);
  assert.equal(recorded.summary.requiresSiteAdapterVerification, 0);
  assert.equal(recorded.summary.explicitExternalAdapterPath, 0);
  assert.equal(recorded.summary.userMediatedSafeActionPath ?? 0, 1);

  const plan = JSON.parse(await readFile(path.join(siteDir, 'capability_remediation_plan.json'), 'utf8'));
  assert.equal(plan.skillId, 'x-com-authorized-browser-surface');
  assert.equal(plan.safetyBoundary.updatesCurrent, false);
  assert.equal(plan.safetyBoundary.updatesRegistry, false);
  assert.equal(Array.isArray(plan.safetyBoundary.allowedPathTypes), true);
  assert.deepEqual(
    [...plan.safetyBoundary.allowedPathTypes].sort(),
    [...ALLOWED_PUBLIC_REMEDIATION_TYPES].sort(),
  );
  assert.equal(plan.safetyBoundary.directEnableDisabledHighRisk, false);
  assert.equal(plan.safetyBoundary.writeActionsEnabled, false);
  assert.equal(plan.safetyBoundary.finalActionsAllowed, false);
  assert.equal(plan.safetyBoundary.rawMaterialAllowed, false);
  assert.equal(plan.safetyBoundary.privateContentAllowed, false);
  assert.equal(plan.safetyBoundary.immediateLimitedUseCount, 2);
  assert.equal(plan.safetyBoundary.userMediatedSafeActionCount, 1);
  assert.equal(plan.safetyBoundary.requiresSiteAdapterVerificationCount, 0);
  assert.equal(plan.plans.some((entry) => isDisabledReviewRemediation(remediationPathType(entry))), true);
  assert.equal(plan.plans.some((entry) => isLimitedReadRemediation(remediationPathType(entry))), true);
  assert.equal(plan.plans.every((entry) => plan.safetyBoundary.allowedPathTypes.includes(entry.pathType)), true);
  assert.equal(plan.plans.every((entry) => ALLOWED_PUBLIC_REMEDIATION_TYPES.includes(entry.pathType)), true);
  assert.equal(plan.plans.some((entry) => ['limited_read_summary', 'draft_only_preview', 'requires_site_specific_adapter', 'requires_explicit_external_adapter', 'requires_manual_review', 'not_supported'].includes(entry.pathType)), false);
  assert.equal(plan.plans.every((entry) => entry.directEnableAllowed === false), true);
  assert.equal(plan.plans.every((entry) => entry.usableAfterSelection === true), true);
  assert.equal(plan.plans.some((entry) => entry.pathType === 'user_mediated_safe_action_path'), true);
  assert.equal(plan.plans.every((entry) => entry.writeActionsEnabled === false), true);
  assert.equal(plan.plans.every((entry) => entry.finalActionsAllowed === false), true);
  assert.equal(plan.plans.every((entry) => entry.rawMaterialAllowed === false), true);
  assert.equal(plan.plans.every((entry) => entry.privateContentAllowed === false), true);
  assert.equal(plan.plans.some((entry) => entry.immediateLimitedUse === true && entry.requiresVerificationBeforeUse === false), true);
  assert.equal(plan.plans.some((entry) => entry.pathType === 'user_mediated_safe_action_path' && entry.requiresSiteAdapterVerificationBeforeUse === false), true);
  assert.equal(plan.plans.some((entry) => entry.pathType === 'user_mediated_safe_action_path' && entry.resultingStatus === 'confirmation_required'), true);
});

test('capability interaction blocks unsafe write and raw-material plans from confirmation', async (t) => {
  const siteDir = await createSiteDir(t);
  const unsafeFollow = capability('误判为只读的关注动作', {
    executionPlan: {
      ...safeReadPlan('capability:test:unsafe-follow'),
      steps: [{
        kind: 'read_sanitized_summary',
        autoExecute: false,
        follow: true,
        limitedOutputOnly: true,
        savedMaterial: 'sanitized_summary_only',
      }],
    },
  });
  const unsafeRaw = capability('误判为只读的私信正文', {
    executionPlan: {
      ...safeReadPlan('capability:test:unsafe-raw'),
      rawMaterialAllowed: true,
      privateContentAllowed: true,
      steps: [{
        kind: 'read_sanitized_summary',
        autoExecute: false,
        limitedOutputOnly: true,
        savedMaterial: 'private_message_body',
      }],
    },
  });
  const buildResult = {
    status: 'success',
    result_status: 'partial_success',
    build_id: 'build-test',
    buildContext: { siteDir },
    user_report: {
      result_status: 'partial_success',
      skill_id: 'x-com-authorized-browser-surface',
      build_id: 'build-test',
      limited_enabled_capabilities: [unsafeFollow, unsafeRaw],
      confirmation_required_capabilities: [],
      disabled_capabilities: [],
    },
  };

  const state = capabilityInteractionState(buildResult);
  assert.equal(state.safeConfirmable.length, 0);
  assert.equal(state.blockedConfirmable.length, 2);
  assert.equal(state.blockedConfirmable.every((entry) => /不能启用/u.test(entry.interaction_blocked_reason)), true);

  const recorded = await writeCapabilityInteractionDecisions(buildResult, [unsafeFollow, unsafeRaw], { siteDir });
  assert.equal(recorded.status, 'skipped');
  assert.equal(recorded.count, 0);
  assert.equal(recorded.decisions.length, 0);
});

test('disabled high-risk capabilities get review remediation without becoming confirmable', async () => {
  const disabledHighRisk = capability('自动删除帖子', {
    id: 'capability:x:delete-post',
    status: 'disabled',
    enabled_status: 'disabled',
    default_policy: 'disabled',
    risk_level: 'write_high',
    evidence_status: 'disabled',
    executionPlan: undefined,
  });
  const buildResult = {
    user_report: {
      skill_id: 'x-com-authorized-browser-surface',
      disabled_capabilities: [disabledHighRisk],
      confirmation_required_capabilities: [],
      limited_enabled_capabilities: [],
    },
  };

  const state = capabilityInteractionState(buildResult);
  assert.equal(state.safeConfirmable.length, 0);
  assert.equal(state.blockedConfirmable.length, 0);
  assert.equal(state.disabledReview.length, 1);
  assert.equal(state.disabledReview[0].confirmation_mode, 'blocked');
  assert.equal(state.disabledReview[0].ordinary_confirmation_allowed, false);
  assert.equal(state.disabledReview[0].confirm_command, null);
  assert.match(state.disabledReview[0].interaction_blocked_reason, /普通确认不能开启|禁用项不会/u);
  assert.equal(isDisabledReviewRemediation(remediationPathType(state.disabledReview[0])), true);
  assert.equal(remediationPathType(state.disabledReview[0]), 'user_mediated_safe_action_path');
  assert.equal(state.disabledReview[0].safe_remediation.canAutoPrepare, true);
  assert.equal(state.disabledReview[0].safe_remediation.useReadiness, 'immediate_user_mediated_safe_action');
  assert.equal(state.disabledReview[0].safe_remediation.requiresSiteAdapterVerificationBeforeUse, false);
  assert.equal(state.disabledReview[0].safe_remediation.writeActionsEnabled, false);
});

test('sensitive reads require declared evidence before limited sanitized summary is offered', async (t) => {
  const siteDir = await createSiteDir(t);
  const safeSensitive = capability('读取通知摘要', {
    id: 'capability:x:notification-summary',
    risk_level: 'read_personal_medium',
    evidence_status: 'confirmation_required',
    source_nodes: ['node:x:notifications'],
    evidence_requirements: ['sanitized_summary_only', 'no_raw_content', 'no_private_content'],
    executionPlan: safeLimitedReadSummaryPlan('capability:x:notification-summary'),
  });
  const noEvidence = capability('读取无证据个人摘要', {
    id: 'capability:x:missing-evidence-summary',
    risk_level: 'read_personal_medium',
    evidence_status: 'missing',
    source_nodes: [],
    evidence_requirements: [],
    executionPlan: safeLimitedReadSummaryPlan('capability:x:missing-evidence-summary'),
  });
  const unsafeDetailPlan = capability('读取通知正文', {
    id: 'capability:x:notification-body',
    risk_level: 'read_personal_medium',
    evidence_status: 'confirmation_required',
    source_nodes: ['node:x:notifications'],
    evidence_requirements: ['sanitized_summary_only'],
    executionPlan: {
      id: 'plan:unsafe-notification-body',
      mode: 'read_full_detail',
      autoExecute: false,
      steps: [{ kind: 'read_body', submit: false, finalSubmit: false }],
    },
  });
  const buildResult = {
    build_id: 'build-limited-read-summary',
    buildContext: { siteDir },
    user_report: {
      skill_id: 'x-com-authorized-browser-surface',
      build_id: 'build-limited-read-summary',
      confirmation_required_capabilities: [safeSensitive, noEvidence, unsafeDetailPlan],
      disabled_capabilities: [],
    },
  };

  const state = capabilityInteractionState(buildResult);
  assert.deepEqual(state.safeConfirmable.map((entry) => entry.id), ['capability:x:notification-summary']);
  assert.equal(state.safeConfirmable[0].executionPlan.mode, 'limited_read_summary');
  assert.equal(state.safeConfirmable[0].executionPlan.savedMaterial, 'sanitized_summary_only');
  assert.equal(state.blockedConfirmable.length, 2);
  assert.equal(state.blockedConfirmable.some((entry) => /缺少可验证证据/u.test(entry.interaction_blocked_reason)), true);
  assert.equal(state.blockedConfirmable.some((entry) => /缺少受限只读执行计划/u.test(entry.interaction_blocked_reason)), true);

  const recorded = await writeCapabilityInteractionDecisions(buildResult, state.safeConfirmable, { siteDir });
  assert.equal(recorded.count, 1);
  assert.equal(recorded.decisions[0].mode, 'limited');
  assert.equal(recorded.decisions[0].writeActionsEnabled, false);
  assert.equal(recorded.decisions[0].rawMaterialAllowed, false);
  assert.equal(recorded.decisions[0].privateContentAllowed, false);
});

test('draft-only remediation refuses plans that can submit', async () => {
  const safeDraft = capability('创建回复草稿', {
    id: 'capability:x:create-reply-draft',
    enabled_status: 'draft_only',
    default_policy: 'draft_only',
    risk_level: 'write_low',
    executionPlan: safeDraftPlan('capability:x:create-reply-draft'),
  });
  const submittingDraft = capability('创建会提交的回复草稿', {
    id: 'capability:x:create-submitting-reply-draft',
    enabled_status: 'draft_only',
    default_policy: 'draft_only',
    risk_level: 'write_low',
    executionPlan: unsafeSubmittingDraftPlan('capability:x:create-submitting-reply-draft'),
  });
  const buildResult = {
    user_report: {
      skill_id: 'x-com-authorized-browser-surface',
      confirmation_required_capabilities: [safeDraft, submittingDraft],
      disabled_capabilities: [],
    },
  };

  const state = capabilityInteractionState(buildResult);
  assert.deepEqual(state.safeConfirmable.map((entry) => entry.id), ['capability:x:create-reply-draft']);
  assert.equal(state.safeConfirmable[0].confirmation_mode, 'draft_only');
  assert.equal(state.safeConfirmable[0].executionPlan.steps.every((step) => (
    step.submit !== true
    && step.finalSubmit !== true
    && step.upload !== true
    && step.selectSensitiveRecipient !== true
  )), true);
  assert.equal(state.blockedConfirmable.length, 1);
  assert.match(state.blockedConfirmable[0].interaction_blocked_reason, /dry-run 草稿执行计划/u);
});
