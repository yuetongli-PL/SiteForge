// @ts-check

import path from 'node:path';
import {
  capabilityConfirmationGroup,
  decorateCapabilityConfirmation,
  isOrdinaryConfirmationBlocked,
} from './confirmation-flow.mjs';
import {
  CAPABILITY_DECISION_RECORDS_SCHEMA_VERSION,
  buildCapabilityConfirmationDecisionRecord,
  mergeCapabilityDecisionRecords,
} from './capability-decision-records.mjs';
import {
  pathExists,
  readJsonFile,
  writeJsonFile,
} from '../../../infra/io.mjs';
import {
  buildCapabilitySafeRemediationPath,
  findForcedExecutablePlanActions,
  findUnsafeExecutionPlanMaterialFlags,
  publicSafeRemediation,
} from './risk-policy.mjs';

export const CAPABILITY_INTERACTION_SCHEMA_VERSION = 1;
export const CAPABILITY_REMEDIATION_PLAN_FILE = 'capability_remediation_plan.json';

const CONFIRMABLE_STATUSES = new Set(['limited_enabled', 'confirmation_required', 'draft_only']);
const USABLE_EVIDENCE_STATUSES = new Set(['verified', 'inferred', 'confirmation_required']);
const ALLOWED_REMEDIATION_TYPES = Object.freeze([
  'limited_sanitized_summary_path',
  'draft_only_preview_path',
  'explicit_external_adapter_path',
  'user_mediated_safe_action_path',
  'manual_review_task',
  'site_adapter_required_note',
]);
const AUTO_PREPARABLE_REMEDIATION_TYPES = new Set([
  'limited_sanitized_summary_path',
  'draft_only_preview_path',
  'user_mediated_safe_action_path',
]);
const ADAPTER_VERIFIED_REMEDIATION_TYPES = new Set([
  'explicit_external_adapter_path',
  'manual_review_task',
  'site_adapter_required_note',
]);
const FORCED_DISABLED_REMEDIATION_ACTIONS = Object.freeze([
  'submit',
  'send',
  'delete',
  'pay',
  'checkout',
  'upload',
  'change_password',
  'change_email',
  'change_2fa',
  'change_payment',
  'edit_profile',
  'follow',
  'unfollow',
  'like',
  'repost',
  'send_dm',
]);

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asText(value) {
  return String(value ?? '').trim();
}

function lower(value) {
  return asText(value).toLowerCase();
}

function hasCjk(value) {
  return /[\u3400-\u9fff]/u.test(asText(value));
}

function hasUnsafeTerminalText(value) {
  return /[A-Za-z]:\\|\/Users\/|\/home\/|cookie|token|authorization|csrf|raw dom|raw html|原始 DOM|原始 HTML|session id|userDataDir/iu.test(asText(value));
}

function capabilityId(capability = /** @type {any} */ ({})) {
  return asText(capability.id ?? capability.name);
}

function capabilityName(capability = /** @type {any} */ ({})) {
  return asText(capability.user_facing_name ?? capability.userFacingName ?? capability.userValue ?? capability.name ?? capability.id);
}

function capabilitySearchText(capability = /** @type {any} */ ({})) {
  return [
    capability.id,
    capability.name,
    capability.user_facing_name,
    capability.userFacingName,
    capability.description,
    capability.action,
    capability.object,
    capability.category,
    capability.reason,
    capability.reason_code,
    capability.reasonCode,
    capability.confirmation_blocked_reason,
    capability.interaction_blocked_reason,
  ].map(lower).join(' ');
}

function resultReport(result = /** @type {any} */ ({})) {
  return result.user_report ?? result.userReport ?? result;
}

function resultSkillId(result = /** @type {any} */ ({})) {
  const report = resultReport(result);
  return asText(report.skill_id ?? report.skillId ?? result.skill_id ?? result.skillId);
}

function resultBuildId(result = /** @type {any} */ ({})) {
  const report = resultReport(result);
  return asText(report.build_id ?? report.buildId ?? result.build_id ?? result.buildId);
}

function resultSiteDir(result = /** @type {any} */ ({})) {
  return asText(
    result.buildContext?.siteDir
    ?? result.workspace?.siteDir
    ?? result.workspace?.paths?.siteDir
    ?? result.siteDir,
  );
}

function resultSiteUrl(result = /** @type {any} */ ({})) {
  const report = resultReport(result);
  return asText(
    report.site?.root_url
    ?? report.site?.input_url
    ?? result.inputUrl
    ?? result.site?.rootUrl
    ?? result.site?.root_url,
  );
}

function resultStatusAllowsInteraction(result = /** @type {any} */ ({})) {
  const report = resultReport(result);
  const status = lower(report.result_status ?? result.result_status ?? result.status);
  return status === 'success' || status === 'partial_success';
}

function hasArrayEvidence(capability = /** @type {any} */ ({})) {
  const evidenceArrays = [
    capability.evidence_sources,
    capability.evidenceSources,
    capability.evidence_refs,
    capability.evidenceRefs,
    capability.source_nodes,
    capability.sourceNodes,
    capability.entryNodeIds,
    capability.source_node_ids,
    capability.sourceNodeIds,
  ];
  return evidenceArrays.some((value) => Array.isArray(value) && value.length > 0);
}

function hasObjectEvidence(capability = /** @type {any} */ ({})) {
  const evidence = capability.evidence;
  if (!evidence || typeof evidence !== 'object') return false;
  return Object.keys(evidence).length > 0;
}

function hasUsableEvidence(capability = /** @type {any} */ ({})) {
  const status = lower(capability.evidence_status ?? capability.evidenceStatus);
  return USABLE_EVIDENCE_STATUSES.has(status) || hasArrayEvidence(capability) || hasObjectEvidence(capability);
}

function disallowsRawMaterial(capability = /** @type {any} */ ({})) {
  const plan = executionPlan(capability);
  const remediationPlan = capability.remediationPlan ?? capability.remediation_plan ?? capability.remediation?.plan;
  return capability.raw_content_saved === true
    || capability.rawContentSaved === true
    || capability.raw_dom_saved === true
    || capability.rawDomSaved === true
    || capability.raw_html_saved === true
    || capability.rawHtmlSaved === true
    || capability.private_content_saved === true
    || capability.privateContentSaved === true
    || findUnsafeExecutionPlanMaterialFlags(plan).length > 0
    || findUnsafeExecutionPlanMaterialFlags(remediationPlan).length > 0;
}

function executionPlan(capability = /** @type {any} */ ({})) {
  const plan = capability.executionPlan ?? capability.execution_plan;
  return plan && typeof plan === 'object' ? plan : null;
}

function sameSiteSafeRouteTarget(value, baseUrl) {
  const text = asText(value);
  const siteUrl = asText(baseUrl);
  if (!text) return null;
  if (text.startsWith('/') && !text.includes('..') && !/[?#]/u.test(text)) {
    return text;
  }
  if (!siteUrl) return null;
  try {
    const site = new URL(siteUrl);
    const url = new URL(text, site);
    if (url.hostname !== site.hostname) {
      return null;
    }
    url.hash = '';
    url.search = '';
    return `${url.pathname || '/'}${url.pathname.endsWith('/') ? '' : ''}`;
  } catch {
    return text.startsWith('/') && !text.includes('..') && !/[?#]/u.test(text) ? text : null;
  }
}

function routeTemplateFromCapability(capability = /** @type {any} */ ({}), result = /** @type {any} */ ({})) {
  const plan = executionPlan(capability);
  const candidates = [
    capability.routeTemplate,
    capability.route_template,
    capability.routePattern,
    capability.route_pattern,
    capability.path,
    plan?.routeTemplate,
    plan?.route_template,
    plan?.routePattern,
    plan?.route_pattern,
    ...asArray(plan?.steps).flatMap((step) => [
      step?.routeTemplate,
      step?.route_template,
      step?.routePattern,
      step?.route_pattern,
      step?.path,
    ]),
  ];
  const baseUrl = resultSiteUrl(result);
  for (const candidate of candidates) {
    const target = sameSiteSafeRouteTarget(candidate, baseUrl);
    if (target) return target;
  }
  return null;
}

function planDisablesFinalActions(plan = /** @type {any} */ ({})) {
  const steps = asArray(plan.steps);
  return plan.autoExecute !== true
    && plan.finalSubmit !== true
    && plan.submit !== true
    && plan.upload !== true
    && findForcedExecutablePlanActions(plan).length === 0
    && steps.every((step) => (
      step?.autoExecute !== true
      && step?.finalSubmit !== true
      && step?.submit !== true
      && step?.upload !== true
      && step?.selectSensitiveRecipient !== true
    ));
}

function hasSafeLimitedReadPlan(capability = /** @type {any} */ ({})) {
  const plan = executionPlan(capability);
  if (!plan) return false;
  return planDisablesFinalActions(plan)
    && (
      plan.limitedOutputOnly === true
      || plan.savedMaterial === 'sanitized_summary_only'
      || asArray(plan.steps).some((step) => step?.limitedOutputOnly === true || step?.savedMaterial === 'sanitized_summary_only')
    );
}

function hasSafeDraftPlan(capability = /** @type {any} */ ({})) {
  const plan = executionPlan(capability);
  return Boolean(plan && plan.dryRunOnly === true && planDisablesFinalActions(plan));
}

function modeForCapability(capability = /** @type {any} */ ({})) {
  const group = capabilityConfirmationGroup(capability);
  if (group === 'sensitive-read') return 'limited';
  if (group === 'draft-write') return 'draft_only';
  return 'confirmed';
}

function riskLevel(capability = /** @type {any} */ ({})) {
  return lower(capability.risk_level ?? capability.riskPolicy?.riskLevel);
}

function defaultPolicy(capability = /** @type {any} */ ({})) {
  return lower(capability.default_policy ?? capability.riskPolicy?.defaultAction);
}

function hasPrivateBodyRisk(capability = /** @type {any} */ ({})) {
  const text = capabilitySearchText(capability);
  return /private message detail|direct message detail|message body|private body|raw body|body text|content body|正文|私信详情|私信正文|通知正文/u.test(text);
}

function hasForcedDisabledActionRisk(capability = /** @type {any} */ ({})) {
  const text = capabilitySearchText(capability);
  const explicitAction = lower(capability.action);
  return FORCED_DISABLED_REMEDIATION_ACTIONS.some((action) => (
    explicitAction === action || text.includes(action.replace(/_/gu, ' '))
  ))
    || /删除|上传|支付|付款|结账|关注|取关|点赞|转发|发送私信|修改密码|修改邮箱|修改账号|账号安全/u.test(text);
}

function remediationLabel(type) {
  if (type === 'limited_sanitized_summary_path') return '启用受限脱敏摘要路径';
  if (type === 'draft_only_preview_path') return '启用草稿预览路径';
  if (type === 'explicit_external_adapter_path') return '启用站点适配器安全路径';
  if (type === 'user_mediated_safe_action_path') return '启用用户介入安全路径';
  if (type === 'manual_review_task') return '启用人工确认安全路径';
  if (type === 'site_adapter_required_note') return '启用站点适配器安全路径';
  return '保持当前策略';
}

function normalizeRemediationPathType(type) {
  if (type === 'limited_read_summary' || type === 'limited_sanitized_summary_path') {
    return 'limited_sanitized_summary_path';
  }
  if (type === 'draft_only_preview' || type === 'draft_only_preview_path') {
    return 'draft_only_preview_path';
  }
  if (
    type === 'requires_site_specific_adapter'
    || type === 'requires_explicit_external_adapter'
    || type === 'explicit_external_adapter_path'
    || type === 'site_adapter_required_note'
  ) {
    return 'explicit_external_adapter_path';
  }
  if (type === 'user_mediated_safe_action' || type === 'user_mediated_safe_action_path') {
    return 'user_mediated_safe_action_path';
  }
  if (type === 'requires_manual_review' || type === 'not_supported' || type === 'manual_review_task') {
    return 'explicit_external_adapter_path';
  }
  return 'explicit_external_adapter_path';
}

function remediationUseReadiness(type, canAutoPrepare) {
  if (canAutoPrepare === true && type === 'limited_sanitized_summary_path') {
    return 'immediate_limited_sanitized_summary';
  }
  if (canAutoPrepare === true && type === 'draft_only_preview_path') {
    return 'immediate_draft_only_preview';
  }
  if (canAutoPrepare === true && type === 'user_mediated_safe_action_path') {
    return 'immediate_user_mediated_safe_action';
  }
  if (ADAPTER_VERIFIED_REMEDIATION_TYPES.has(type)) {
    return 'requires_site_adapter_verification';
  }
  return 'requires_site_adapter_verification';
}

function remediationResultingStatusForType(type, canAutoPrepare) {
  if (canAutoPrepare !== true) return 'disabled';
  if (type === 'limited_sanitized_summary_path') return 'limited_enabled';
  if (type === 'draft_only_preview_path') return 'draft_only';
  if (type === 'user_mediated_safe_action_path') return 'confirmation_required';
  return 'disabled';
}

function normalizeSafeRemediationPath(remediation = /** @type {any} */ ({})) {
  const type = normalizeRemediationPathType(remediation.path ?? remediation.type);
  const canAutoPrepare = (
    remediation.canAutoPrepare === true
    && AUTO_PREPARABLE_REMEDIATION_TYPES.has(type)
  ) || type === 'user_mediated_safe_action_path';
  const useReadiness = remediationUseReadiness(type, canAutoPrepare);
  return {
    ...remediation,
    path: type,
    type,
    remediationType: type,
    label: remediationLabel(type),
    canAutoPrepare,
    useReadiness,
    immediateLimitedUse: useReadiness.startsWith('immediate_'),
    requiresSiteAdapterVerificationBeforeUse: useReadiness === 'requires_site_adapter_verification',
    resultingStatus: remediationResultingStatusForType(type, canAutoPrepare),
    directEnableAllowed: false,
    writeActionsEnabled: false,
    finalActionsAllowed: false,
    rawMaterialAllowed: false,
    privateContentAllowed: false,
    requiresVerificationBeforeUse: useReadiness === 'requires_site_adapter_verification',
  };
}

function remediationReason(capability = /** @type {any} */ ({})) {
  const explicitReason = asText(capability.interaction_blocked_reason ?? capability.confirmation_blocked_reason);
  if (explicitReason && hasCjk(explicitReason) && !hasUnsafeTerminalText(explicitReason)) {
    return explicitReason;
  }
  const risk = riskLevel(capability);
  if (risk === 'account_security_critical') return '涉及账号安全或付款设置，不能自动启用。';
  if (risk === 'write_high') return '涉及发布、删除、关注、点赞、上传或发送等写入动作，不能直接启用。';
  if (risk === 'read_private_high') return '可能包含私密正文或私人会话内容，不能按默认路径读取。';
  if (!hasUsableEvidence(capability)) return '缺少可验证的脱敏能力证据。';
  return '当前能力没有可直接启用的安全执行路径。';
}

function remediationNextStep(pathType) {
  if (pathType === 'limited_sanitized_summary_path') {
    return '下一步：准备受限脱敏摘要计划；只记录数量、类型、入口和结构 hash，然后重新验证。';
  }
  if (pathType === 'draft_only_preview_path') {
    return '下一步：准备 draft-only preview 计划；只生成草稿预览，最终提交、发送、上传、删除和关注仍保持关闭。';
  }
  if (pathType === 'explicit_external_adapter_path') {
    return '下一步：实现站点适配器验证的非最终动作安全替代路径，重新运行验证；验证通过前只记录计划，不启用高风险动作。';
  }
  if (pathType === 'user_mediated_safe_action_path') {
    return '下一步：生成用户介入安全路径；SiteForge 只负责打开位置、准备草稿、展示确认页或受限摘要，最终提交、删除、上传、关注、发送和账号修改必须由用户亲自完成。';
  }
  if (pathType === 'manual_review_task') {
    return '下一步：把人工复核结论转成站点适配器验证的安全替代路径，再重新运行验证。';
  }
  if (pathType === 'site_adapter_required_note') {
    return '下一步：补站点适配器、能力级脱敏证据和验证计划，然后重新运行验证。';
  }
  return '下一步：先实现站点专用安全路径和验证计划，再重新运行构建。';
}

function enrichSafeRemediation(capability = /** @type {any} */ ({}), remediation = buildCapabilitySafeRemediationPath(capability)) {
  const pathType = normalizeRemediationPathType(remediation.path ?? remediation.type ?? remediation.safe_remediation_path);
  const canAutoPrepare = (
    remediation.canAutoPrepare === true
    && AUTO_PREPARABLE_REMEDIATION_TYPES.has(pathType)
  ) || pathType === 'user_mediated_safe_action_path';
  const useReadiness = remediationUseReadiness(pathType, canAutoPrepare);
  return {
    ...remediation,
    path: pathType,
    type: pathType,
    remediationType: pathType,
    label: remediationLabel(pathType),
    reason: remediationReason(capability),
    nextStep: remediationNextStep(pathType),
    canAutoPrepare,
    useReadiness,
    usableAfterSelection: canAutoPrepare === true,
    usablePathType: pathType,
    safeUseMode: pathType === 'limited_sanitized_summary_path'
      ? 'limited_sanitized_summary'
      : pathType === 'draft_only_preview_path'
        ? 'draft_only_preview'
        : pathType === 'user_mediated_safe_action_path'
          ? 'user_mediated_safe_action'
          : 'adapter_verified_safe_path',
    userFinalActionRequired: pathType === 'user_mediated_safe_action_path',
    immediateLimitedUse: useReadiness.startsWith('immediate_'),
    requiresSiteAdapterVerificationBeforeUse: useReadiness === 'requires_site_adapter_verification',
    resultingStatus: remediationResultingStatusForType(pathType, canAutoPrepare),
    directEnableAllowed: false,
    writeActionsEnabled: false,
    finalActionsAllowed: false,
    rawMaterialAllowed: false,
    privateContentAllowed: false,
    requiresVerificationBeforeUse: useReadiness === 'requires_site_adapter_verification',
    executionBoundary: pathType === 'user_mediated_safe_action_path'
      ? 'SiteForge can open the location, prepare a draft, show a confirmation surface, or produce a sanitized summary. The user must perform any final sensitive action manually.'
      : 'SiteForge cannot execute final sensitive actions automatically.',
  };
}

export function buildCapabilityRemediationPath(capability = /** @type {any} */ ({})) {
  return enrichSafeRemediation(capability);
}

function attachRemediation(capability = /** @type {any} */ ({})) {
  const safeRemediation = buildCapabilityRemediationPath(capability);
  const safeRemediationPath = safeRemediation.path ?? safeRemediation.type;
  const publicRemediation = publicSafeRemediation({
    ...safeRemediation,
    path: safeRemediationPath,
  });
  return {
    ...capability,
    safe_remediation_path: safeRemediationPath,
    safe_remediation: publicRemediation,
    terminal_remediation: remediationTerminalFields(publicRemediation),
  };
}

function remediationTerminalFields(remediation = /** @type {any} */ ({})) {
  const label = asText(remediation.label) || '保持当前策略';
  const requiredEvidence = asArray(remediation.requiredEvidence)
    .map((item) => asText(item))
    .map((item) => {
      if (item === 'sanitized route evidence') return '脱敏路由证据';
      if (item === 'sanitized_route_or_structure_evidence') return '脱敏路由或结构证据';
      if (item === 'bounded visible count evidence') return '有限可见数量证据';
      if (item === 'bounded_summary_fields') return '受限摘要字段';
      if (item === 'limited read execution plan') return '受限只读执行计划';
      if (item === 'limited_read_execution_plan') return '受限只读执行计划';
      if (item === 'source node evidence') return '来源节点证据';
      if (item === 'form structure evidence') return '表单结构证据';
      if (item === 'sanitized_control_or_structure_evidence') return '脱敏控件或结构证据';
      if (item === 'dry-run execution plan') return 'dry-run 执行计划';
      if (item === 'dry_run_preview_plan') return 'dry-run 预览计划';
      if (item === 'final submit guard') return '最终提交保护';
      if (item === 'final_submit_guard') return '最终提交保护';
      if (item === 'site-specific safe adapter') return '站点专用安全适配器';
      if (item === 'site_specific_adapter') return '站点专用安全适配器';
      if (item === 'capability_specific_evidence') return '能力级脱敏证据';
      if (item === 'non_executing_adapter_plan') return '非执行适配器计划';
      if (item === 'explicit_operator_approval') return '显式操作员批准';
      if (item === 'non-submitting dry run proof') return '非提交式 dry-run 证明';
      if (item === 'human security review') return '人工安全复核';
      if (item === 'manual_security_review') return '人工安全复核';
      if (item === 'human privacy review') return '人工隐私复核';
      if (item === 'stronger site-specific evidence') return '更强的站点专用证据';
      if (item === 'safe_execution_plan_review') return '安全执行计划复核';
      if (item === 'manual review') return '人工复核';
      return null;
    })
    .filter((item) => item && !hasUnsafeTerminalText(item))
    .slice(0, 3)
    .join(',');
  const useReadiness = remediation.useReadiness ?? remediationUseReadiness(
    normalizeRemediationPathType(remediation.path ?? remediation.type),
    remediation.canAutoPrepare === true,
  );
  const safePath = remediation.canAutoPrepare === true
    ? `${label}; safe path can be prepared, final sensitive actions remain user-controlled.`
    : `${label}; more verification is required${requiredEvidence ? `: ${requiredEvidence}` : ''}.`;
  const reason = asText(remediation.reason);
  const nextStep = asText(remediation.nextStep);
  return {
    safe_path: safePath,
    use_readiness: useReadiness,
    blocked_reason: reason && !hasUnsafeTerminalText(reason)
      ? reason
      : 'No gated safe execution path is available.',
    next_step: nextStep && !hasUnsafeTerminalText(nextStep)
      ? nextStep
      : 'Implement a site-specific safe path and verification plan, then rebuild.',
  };
}

function capabilityValidity(capability = /** @type {any} */ ({})) {
  const decorated = decorateCapabilityConfirmation(capability, { skillId: null });
  const status = lower(capability.enabled_status ?? capability.enabledStatus ?? capability.status);
  if (!CONFIRMABLE_STATUSES.has(status)) {
    return { ok: false, reason: '当前状态不能通过普通确认启用。', capability: decorated };
  }
  if (isOrdinaryConfirmationBlocked(capability)) {
    return { ok: false, reason: '高风险、私密正文、账号或写入动作不能通过普通确认启用。', capability: decorated };
  }
  if (!hasUsableEvidence(capability)) {
    return { ok: false, reason: '缺少可验证证据，不能启用。', capability: decorated };
  }
  if (disallowsRawMaterial(capability)) {
    return { ok: false, reason: '该能力需要原始或私密材料，不能启用。', capability: decorated };
  }
  const group = capabilityConfirmationGroup(capability);
  if (group === 'sensitive-read' && !hasSafeLimitedReadPlan(capability)) {
    return { ok: false, reason: '缺少受限只读执行计划，不能启用。', capability: decorated };
  }
  if (group === 'draft-write' && !hasSafeDraftPlan(capability)) {
    return { ok: false, reason: '缺少 dry-run 草稿执行计划，不能启用。', capability: decorated };
  }
  return { ok: true, reason: null, capability: decorated };
}

function decorateList(capabilities = /** @type {any[]} */ ([]), skillId) {
  return capabilities.map((capability) => decorateCapabilityConfirmation(capability, { skillId }));
}

function collectConfirmable(capabilities = /** @type {any[]} */ ([])) {
  const safe = /** @type {any[]} */ ([]);
  const blocked = /** @type {any[]} */ ([]);
  for (const capability of capabilities) {
    const validity = capabilityValidity(capability);
    if (validity.ok) {
      safe.push(validity.capability);
    } else {
      blocked.push({
          ...attachRemediation(validity.capability),
          interaction_blocked_reason: validity.reason,
        });
    }
  }
  return { safe, blocked };
}

function remediationSummary(capabilities = /** @type {any[]} */ ([])) {
  const summary = {
    total: 0,
    autoPreparable: 0,
    immediateLimitedUse: 0,
    requiresSiteAdapterVerification: 0,
    limitedSanitizedSummaryPath: 0,
    draftOnlyPreviewPath: 0,
    explicitExternalAdapterPath: 0,
    userMediatedSafeActionPath: 0,
    manualReviewTask: 0,
    siteAdapterRequiredNote: 0,
  };
  for (const capability of Array.isArray(capabilities) ? capabilities : []) {
    const remediation = capability.safe_remediation
      ?? (typeof capability.safe_remediation_path === 'object' ? capability.safe_remediation_path : null)
      ?? buildCapabilityRemediationPath(capability);
    const type = /** @type {any} */ (normalizeRemediationPathType(remediation.type ?? remediation.path ?? capability.safe_remediation_path));
    summary.total += 1;
    const canAutoPrepare = (
      remediation.canAutoPrepare === true
      && AUTO_PREPARABLE_REMEDIATION_TYPES.has(type)
    ) || type === 'user_mediated_safe_action_path';
    const useReadiness = remediation.useReadiness ?? remediationUseReadiness(type, canAutoPrepare);
    if (canAutoPrepare) {
      summary.autoPreparable += 1;
    }
    if (useReadiness.startsWith('immediate_')) summary.immediateLimitedUse += 1;
    if (useReadiness === 'requires_site_adapter_verification') summary.requiresSiteAdapterVerification += 1;
    if (type === 'limited_sanitized_summary_path') summary.limitedSanitizedSummaryPath += 1;
    if (type === 'draft_only_preview_path') summary.draftOnlyPreviewPath += 1;
    if (type === 'explicit_external_adapter_path') summary.explicitExternalAdapterPath += 1;
    if (type === 'user_mediated_safe_action_path') summary.userMediatedSafeActionPath += 1;
    if (type === 'manual_review_task') summary.manualReviewTask += 1;
    if (type === 'site_adapter_required_note') summary.siteAdapterRequiredNote += 1;
  }
  return {
    total: summary.total,
    autoPreparable: summary.autoPreparable,
    immediateLimitedUse: summary.immediateLimitedUse,
    requiresSiteAdapterVerification: summary.requiresSiteAdapterVerification,
    limitedSanitizedSummaryPath: summary.limitedSanitizedSummaryPath,
    draftOnlyPreviewPath: summary.draftOnlyPreviewPath,
    explicitExternalAdapterPath: summary.explicitExternalAdapterPath,
    userMediatedSafeActionPath: summary.userMediatedSafeActionPath,
    manualReviewTask: summary.manualReviewTask,
    siteAdapterRequiredNote: summary.siteAdapterRequiredNote,
  };
}

export function capabilityInteractionState(result = /** @type {any} */ ({})) {
  const report = resultReport(result);
  const skillId = resultSkillId(result);
  const enabled = decorateList(report.enabled_capabilities ?? [], skillId);
  const limited = decorateList(report.limited_capabilities ?? report.limited_enabled_capabilities ?? [], skillId);
  const confirmation = decorateList(report.confirmation_required_capabilities ?? [], skillId);
  const disabled = decorateList(report.disabled_capabilities ?? [], skillId);
  const confirmable = collectConfirmable([...limited, ...confirmation]);
  const disabledReviewForRemediation = disabled.map((capability) => attachRemediation({
    ...capability,
    interaction_blocked_reason: capability.confirmation_blocked_reason
      ?? '禁用项不会在普通确认流程中启用；需要额外证据、专用安全路径和重新验证。',
  }));
  const remediationCandidates = [...confirmable.blocked, ...disabledReviewForRemediation];
  return {
    schemaVersion: CAPABILITY_INTERACTION_SCHEMA_VERSION,
    skillId,
    buildId: resultBuildId(result),
    siteDir: resultSiteDir(result),
    enabled,
    limited,
    confirmation,
    disabled,
    safeConfirmable: confirmable.safe,
    blockedConfirmable: confirmable.blocked,
    disabledReview: disabledReviewForRemediation,
    remediationCandidates,
    remediationSummary: remediationSummary(remediationCandidates),
  };
}

async function readExistingDecisionFile(filePath, skillId) {
  if (!await pathExists(filePath)) {
    return {
      schemaVersion: CAPABILITY_DECISION_RECORDS_SCHEMA_VERSION,
      skillId,
      decisions: [],
    };
  }
  try {
    return await readJsonFile(filePath);
  } catch {
    return {
      schemaVersion: CAPABILITY_DECISION_RECORDS_SCHEMA_VERSION,
      skillId,
      decisions: [],
    };
  }
}

export async function writeCapabilityInteractionDecisions(result = /** @type {any} */ ({}), capabilities = /** @type {any[]} */ ([]), options = /** @type {any} */ ({})) {
  const state = capabilityInteractionState(result);
  const siteDir = asText(options.siteDir ?? state.siteDir);
  if (!siteDir) {
    return {
      status: 'skipped',
      reason: 'siteDir is unavailable; confirmation decisions were not persisted.',
      filePath: null,
      count: 0,
      decisions: [],
    };
  }
  const safeById = new Map(state.safeConfirmable.map((capability) => [capabilityId(capability), capability]));
  const selected = capabilities
    .map((capability) => safeById.get(capabilityId(capability)))
    .filter(Boolean);
  if (!selected.length) {
    return {
      status: 'skipped',
      reason: 'No selected capability passed evidence and safety validation.',
      filePath: null,
      count: 0,
      decisions: [],
    };
  }

  const filePath = path.join(siteDir, 'capability_confirmations.json');
  const existing = await readExistingDecisionFile(filePath, state.skillId);
  const now = new Date().toISOString();
  const decisions = selected.map((capability) => {
    const mode = modeForCapability(capability);
    return buildCapabilityConfirmationDecisionRecord({
      capability,
      mode,
      command: options.interactionCommand ?? 'siteforge build capability decision record',
      source: options.interactionSource ?? 'siteforge_build_capability_record',
      sourceBuildId: state.buildId || null,
      targetRoute: routeTemplateFromCapability(capability, result),
      updatedAt: now,
    });
  });
  const next = {
    schemaVersion: CAPABILITY_DECISION_RECORDS_SCHEMA_VERSION,
    skillId: state.skillId,
    updatedAt: now,
    decisions: mergeCapabilityDecisionRecords(asArray(existing.decisions), decisions),
  };
  await writeJsonFile(filePath, next);
  return {
    status: 'recorded',
    filePath,
    count: decisions.length,
    decisions,
  };
}

function remediationPlanRecord(capability = /** @type {any} */ ({})) {
  const remediation = capability.safe_remediation
    ?? (typeof capability.safe_remediation_path === 'object' ? capability.safe_remediation_path : null)
    ?? buildCapabilityRemediationPath(capability);
  const publicRemediation = publicSafeRemediation(remediation);
  const pathType = normalizeRemediationPathType(
    publicRemediation.path ?? publicRemediation.type ?? capability.safe_remediation_path,
  );
  if (!ALLOWED_REMEDIATION_TYPES.includes(pathType)) {
    throw new Error(`Unsupported remediation path type: ${pathType}`);
  }
  const canAutoPrepare = (
    publicRemediation.canAutoPrepare === true
    && AUTO_PREPARABLE_REMEDIATION_TYPES.has(pathType)
  ) || pathType === 'user_mediated_safe_action_path';
  const useReadiness = publicRemediation.useReadiness ?? remediationUseReadiness(pathType, canAutoPrepare);
  return {
    capabilityId: capabilityId(capability),
    capabilityName: capabilityName(capability),
    currentStatus: capability.enabled_status ?? capability.status ?? null,
    riskLevel: publicRemediation.riskLevel ?? riskLevel(capability) ?? null,
    reason: publicRemediation.reason,
    pathType,
    remediationType: pathType,
    pathLabel: remediationLabel(pathType),
    canAutoPrepare,
    useReadiness,
    usableAfterSelection: true,
    immediateLimitedUse: useReadiness.startsWith('immediate_'),
    requiresSiteAdapterVerificationBeforeUse: useReadiness === 'requires_site_adapter_verification',
    resultingStatus: remediationResultingStatusForType(pathType, canAutoPrepare),
    requiredEvidence: publicRemediation.requiredEvidence,
    prohibitedActions: publicRemediation.prohibitedActions,
    nextStep: remediationNextStep(pathType),
    directEnableAllowed: false,
    writeActionsEnabled: false,
    finalActionsAllowed: false,
    rawMaterialAllowed: false,
    privateContentAllowed: false,
    requiresVerificationBeforeUse: useReadiness === 'requires_site_adapter_verification',
  };
}

export async function writeCapabilityRemediationPlan(result = /** @type {any} */ ({}), capabilities = /** @type {any[]} */ ([]), options = /** @type {any} */ ({})) {
  const state = capabilityInteractionState(result);
  const siteDir = asText(options.siteDir ?? state.siteDir);
  if (!siteDir) {
    return {
      status: 'skipped',
      reason: 'siteDir is unavailable; remediation plan was not persisted.',
      filePath: null,
      count: 0,
      plans: [],
    };
  }
  const candidateById = new Map(state.remediationCandidates.map((candidate) => [capabilityId(candidate), candidate]));
  const sourceCapabilities = capabilities.length
    ? capabilities.map((capability) => candidateById.get(capabilityId(capability))).filter(Boolean)
    : state.remediationCandidates;
  const plans = sourceCapabilities.map(remediationPlanRecord);
  if (!plans.length) {
    return {
      status: 'skipped',
      reason: 'No disabled or blocked capability can receive a remediation plan.',
      filePath: null,
      count: 0,
      plans: [],
    };
  }
  const now = new Date().toISOString();
  const payload = {
    schemaVersion: CAPABILITY_INTERACTION_SCHEMA_VERSION,
    skillId: state.skillId,
    buildId: state.buildId || null,
    generatedAt: now,
    status: plans.some((plan) => plan.canAutoPrepare) ? 'prepared' : 'review_required',
    summary: remediationSummary(plans.map((plan) => ({
      safe_remediation: {
        path: plan.pathType,
        canAutoPrepare: plan.canAutoPrepare,
        useReadiness: plan.useReadiness,
      },
    }))),
    safetyBoundary: {
      updatesCurrent: false,
      updatesRegistry: false,
      allowedPathTypes: [...ALLOWED_REMEDIATION_TYPES],
      directEnableDisabledHighRisk: false,
      writeActionsEnabled: false,
      finalActionsAllowed: false,
      rawMaterialAllowed: false,
      privateContentAllowed: false,
      requiresVerificationBeforeUse: plans.some((plan) => plan.requiresSiteAdapterVerificationBeforeUse === true),
      immediateLimitedUseCount: plans.filter((plan) => plan.immediateLimitedUse === true).length,
      userMediatedSafeActionCount: plans.filter((plan) => plan.pathType === 'user_mediated_safe_action_path').length,
      requiresSiteAdapterVerificationCount: plans.filter((plan) => plan.requiresSiteAdapterVerificationBeforeUse === true).length,
      explicitExternalAdapterPathCount: plans.filter((plan) => plan.pathType === 'explicit_external_adapter_path').length,
    },
    plans,
  };
  const filePath = path.join(siteDir, CAPABILITY_REMEDIATION_PLAN_FILE);
  await writeJsonFile(filePath, payload);
  return {
    status: 'recorded',
    filePath,
    count: plans.length,
    plans,
    summary: payload.summary,
  };
}
