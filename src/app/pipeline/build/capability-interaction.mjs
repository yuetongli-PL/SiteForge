// @ts-check

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';

import {
  capabilityConfirmationGroup,
  decorateCapabilityConfirmation,
  isOrdinaryConfirmationBlocked,
} from './confirmation-flow.mjs';
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
import {
  enterTerminalTui,
  isTerminalCharacterKey,
  isTerminalReturnKey,
  isTerminalSlashKey,
  isTerminalSpaceKey,
  readTerminalKeys,
} from './terminal-tui.mjs';

export const CAPABILITY_INTERACTION_SCHEMA_VERSION = 1;
export const CAPABILITY_REMEDIATION_PLAN_FILE = 'capability_remediation_plan.json';

const CONFIRMABLE_STATUSES = new Set(['limited_enabled', 'confirmation_required', 'draft_only']);
const USABLE_EVIDENCE_STATUSES = new Set(['verified', 'inferred', 'confirmation_required']);
const MAX_INLINE_CAPABILITIES = 12;
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

function shouldUseCapabilityWebInteraction(options = {}) {
  void options;
  return false;
}

function htmlEscape(value) {
  return String(value ?? '')
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    .replace(/'/gu, '&#39;');
}

function capabilityWebDocument(title, bodyHtml) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${htmlEscape(title)}</title>
  <style>
    :root { color-scheme: light dark; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; background: Canvas; color: CanvasText; }
    main { max-width: 980px; margin: 32px auto; padding: 0 20px 40px; }
    h1 { font-size: 1.45rem; margin: 0 0 16px; }
    h2 { font-size: 1rem; margin: 24px 0 8px; }
    p { line-height: 1.5; }
    form { display: grid; gap: 16px; }
    fieldset { border: 1px solid color-mix(in srgb, CanvasText 22%, transparent); border-radius: 8px; padding: 14px 16px; }
    label.option { display: grid; grid-template-columns: auto 1fr; gap: 10px; align-items: start; padding: 7px 0; }
    .actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 8px; }
    button { font: inherit; padding: 9px 13px; border-radius: 7px; border: 1px solid color-mix(in srgb, CanvasText 24%, transparent); cursor: pointer; }
    button.primary { background: #14532d; border-color: #14532d; color: white; }
    button.danger { background: #7f1d1d; border-color: #7f1d1d; color: white; }
    code { overflow-wrap: anywhere; }
    .note { color: color-mix(in srgb, CanvasText 72%, transparent); }
    .empty { color: color-mix(in srgb, CanvasText 62%, transparent); font-style: italic; }
  </style>
</head>
<body>
  <main>
    ${bodyHtml}
  </main>
</body>
</html>`;
}

function readRequestBody(request, maxBytes = 64 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    request.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error('request-body-too-large'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

function sendCapabilityWebHtml(response, statusCode, html) {
  response.writeHead(statusCode, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(html);
}

function listenLocalWebServer(server) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve(server.address());
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(0, '127.0.0.1');
  });
}

async function closeServerQuietly(server) {
  await new Promise((resolve) => {
    server.close(() => resolve());
  }).catch(() => {});
}

function spawnDetached(command, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve({ command, args });
    });
  });
}

async function launchWebInteractionUrl(url, options = {}) {
  if (typeof options.webInteractionLauncher === 'function') {
    return await options.webInteractionLauncher(url);
  }
  if (process.platform === 'win32') {
    return await spawnDetached('rundll32.exe', ['url.dll,FileProtocolHandler', url]);
  }
  if (process.platform === 'darwin') {
    return await spawnDetached('open', [url]);
  }
  return await spawnDetached('xdg-open', [url]);
}

async function runCapabilityWebForm({
  options = {},
  title,
  waitingText,
  renderForm,
  handleForm,
}) {
  if (!shouldUseCapabilityWebInteraction(options)) {
    return null;
  }
  const output = options.output;
  if (typeof output?.write !== 'function') {
    return null;
  }
  const token = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  let resolveResult;
  let rejectResult;
  const resultPromise = new Promise((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });
  const server = createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (request.method === 'GET' && requestUrl.pathname === '/') {
        sendCapabilityWebHtml(response, 200, capabilityWebDocument(title, renderForm({ token })));
        return;
      }
      if (request.method === 'POST' && requestUrl.pathname === '/submit') {
        const body = await readRequestBody(request);
        const form = new URLSearchParams(body);
        if (form.get('token') !== token) {
          sendCapabilityWebHtml(response, 403, capabilityWebDocument('Rejected', '<h1>Rejected</h1><p>Invalid interaction token.</p>'));
          return;
        }
        const result = await handleForm(form);
        sendCapabilityWebHtml(response, 200, capabilityWebDocument('Saved', '<h1>Saved</h1><p>You can return to SiteForge.</p>'));
        resolveResult(result);
        setTimeout(() => closeServerQuietly(server), 25);
        return;
      }
      sendCapabilityWebHtml(response, 404, capabilityWebDocument('Not found', '<h1>Not found</h1>'));
    } catch (error) {
      sendCapabilityWebHtml(response, 500, capabilityWebDocument('Error', `<h1>Error</h1><p>${htmlEscape(error?.message ?? String(error))}</p>`));
      rejectResult(error);
      setTimeout(() => closeServerQuietly(server), 25);
    }
  });

  let address;
  try {
    address = await listenLocalWebServer(server);
  } catch {
    await closeServerQuietly(server);
    return null;
  }
  const url = `http://127.0.0.1:${address.port}/`;
  output.write(`${title}: ${url}\n`);
  output.write(`${waitingText}\n`);
  await launchWebInteractionUrl(url, options).catch(() => {});
  return await resultPromise;
}

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

function capabilityId(capability = {}) {
  return asText(capability.id ?? capability.name);
}

function capabilityName(capability = {}) {
  return asText(capability.user_facing_name ?? capability.userFacingName ?? capability.userValue ?? capability.name ?? capability.id);
}

function capabilitySearchText(capability = {}) {
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

function resultReport(result = {}) {
  return result.user_report ?? result.userReport ?? result;
}

function resultSkillId(result = {}) {
  const report = resultReport(result);
  return asText(report.skill_id ?? report.skillId ?? result.skill_id ?? result.skillId);
}

function resultBuildId(result = {}) {
  const report = resultReport(result);
  return asText(report.build_id ?? report.buildId ?? result.build_id ?? result.buildId);
}

function resultSiteDir(result = {}) {
  return asText(
    result.buildContext?.siteDir
    ?? result.workspace?.siteDir
    ?? result.workspace?.paths?.siteDir
    ?? result.siteDir,
  );
}

function resultSiteUrl(result = {}) {
  const report = resultReport(result);
  return asText(
    report.site?.root_url
    ?? report.site?.input_url
    ?? result.inputUrl
    ?? result.site?.rootUrl
    ?? result.site?.root_url,
  );
}

function resultStatusAllowsInteraction(result = {}) {
  const report = resultReport(result);
  const status = lower(report.result_status ?? result.result_status ?? result.status);
  return status === 'success' || status === 'partial_success';
}

function hasArrayEvidence(capability = {}) {
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

function hasObjectEvidence(capability = {}) {
  const evidence = capability.evidence;
  if (!evidence || typeof evidence !== 'object') return false;
  return Object.keys(evidence).length > 0;
}

function hasUsableEvidence(capability = {}) {
  const status = lower(capability.evidence_status ?? capability.evidenceStatus);
  return USABLE_EVIDENCE_STATUSES.has(status) || hasArrayEvidence(capability) || hasObjectEvidence(capability);
}

function disallowsRawMaterial(capability = {}) {
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

function executionPlan(capability = {}) {
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

function routeTemplateFromCapability(capability = {}, result = {}) {
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

function planDisablesFinalActions(plan = {}) {
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

function hasSafeLimitedReadPlan(capability = {}) {
  const plan = executionPlan(capability);
  if (!plan) return false;
  return planDisablesFinalActions(plan)
    && (
      plan.limitedOutputOnly === true
      || plan.savedMaterial === 'sanitized_summary_only'
      || asArray(plan.steps).some((step) => step?.limitedOutputOnly === true || step?.savedMaterial === 'sanitized_summary_only')
    );
}

function hasSafeDraftPlan(capability = {}) {
  const plan = executionPlan(capability);
  return Boolean(plan && plan.dryRunOnly === true && planDisablesFinalActions(plan));
}

function modeForCapability(capability = {}) {
  const group = capabilityConfirmationGroup(capability);
  if (group === 'sensitive-read') return 'limited';
  if (group === 'draft-write') return 'draft_only';
  return 'confirmed';
}

function riskLevel(capability = {}) {
  return lower(capability.risk_level ?? capability.riskPolicy?.riskLevel);
}

function defaultPolicy(capability = {}) {
  return lower(capability.default_policy ?? capability.riskPolicy?.defaultAction);
}

function hasPrivateBodyRisk(capability = {}) {
  const text = capabilitySearchText(capability);
  return /private message detail|direct message detail|message body|private body|raw body|body text|content body|正文|私信详情|私信正文|通知正文/u.test(text);
}

function hasForcedDisabledActionRisk(capability = {}) {
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

function normalizeSafeRemediationPath(remediation = {}) {
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

function remediationReason(capability = {}) {
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
    return '下一步：准备 limited sanitized summary 计划；只记录数量、类型、入口和结构 hash，然后重新验证。';
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

function enrichSafeRemediation(capability = {}, remediation = buildCapabilitySafeRemediationPath(capability)) {
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

export function buildCapabilityRemediationPath(capability = {}) {
  return enrichSafeRemediation(capability);
}

function attachRemediation(capability = {}) {
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

function remediationTerminalFields(remediation = {}) {
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
    .join('、');
  const useReadiness = remediation.useReadiness ?? remediationUseReadiness(
    normalizeRemediationPathType(remediation.path ?? remediation.type),
    remediation.canAutoPrepare === true,
  );
  const safePath = remediation.canAutoPrepare === true
    ? `${label}；选择后生成可用安全路径，最终敏感动作仍由用户确认。`
    : `${label}；需要补齐验证材料后使用${requiredEvidence ? `：${requiredEvidence}` : ''}。`;
  const reason = asText(remediation.reason);
  const nextStep = asText(remediation.nextStep);
  return {
    safe_path: safePath,
    use_readiness: useReadiness,
    blocked_reason: reason && !hasUnsafeTerminalText(reason)
      ? reason
      : '当前能力没有满足门禁的安全执行路径。',
    next_step: nextStep && !hasUnsafeTerminalText(nextStep)
      ? nextStep
      : '下一步：先实现站点专用安全路径和验证计划，再重新运行构建。',
  };
}

function capabilityValidity(capability = {}) {
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

function decorateList(capabilities = [], skillId) {
  return capabilities.map((capability) => decorateCapabilityConfirmation(capability, { skillId }));
}

function collectConfirmable(capabilities = []) {
  const safe = [];
  const blocked = [];
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

function remediationSummary(capabilities = []) {
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
    const type = normalizeRemediationPathType(remediation.type ?? remediation.path ?? capability.safe_remediation_path);
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

export function capabilityInteractionState(result = {}) {
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
      ?? '已禁用能力不会在普通确认流程中启用；需要额外证据、专用安全路径和重新验证。',
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

export function shouldOfferCapabilityInteraction(result = {}, options = {}) {
  if (options.interactive !== true || options.json === true || options.quiet === true) return false;
  if (options.debug === true || options.verbose === true) return false;
  if (options.manual === true) return false;
  if (!resultStatusAllowsInteraction(result)) return false;
  const state = capabilityInteractionState(result);
  return state.safeConfirmable.length > 0 || state.disabledReview.length > 0 || state.blockedConfirmable.length > 0;
}

function modeLabel(capability = {}) {
  const mode = modeForCapability(capability);
  if (mode === 'limited') return '有限只读';
  if (mode === 'draft_only') return '草稿模式';
  return '确认启用';
}

function capabilityLine(capability, index = null) {
  const prefix = index === null ? '  -' : `  [${index}]`;
  return `${prefix} ${capabilityName(capability)}（${modeLabel(capability)}）`;
}

function firstItems(capabilities, limit = MAX_INLINE_CAPABILITIES) {
  const lines = capabilities.slice(0, limit).map((capability, index) => capabilityLine(capability, index + 1));
  if (capabilities.length > limit) {
    lines.push(`  ... 另有 ${capabilities.length - limit} 项可在报告中查看`);
  }
  return lines;
}

export function renderCapabilityInteractionPrompt(result = {}, options = {}) {
  const state = capabilityInteractionState(result);
  const lines = [
    '',
    '能力启用选择',
    '',
    `  可安全确认：${state.safeConfirmable.length} 项`,
    `  可自动补安全路径计划：${state.remediationCandidates.length} 项`,
    `  需保持禁用或补证据：${state.blockedConfirmable.length + state.disabledReview.length} 项`,
    '',
    '说明',
    '  - 只有已有证据、且有安全执行计划的能力可以确认启用。',
    '  - 自动补的是安全路径和验证计划，不是绕过禁用直接启用。',
    '  - 有限只读只保存脱敏结构摘要，不保存正文或身份材料。',
    '  - 草稿能力只允许生成草稿，不会提交、发送、删除、支付或上传。',
    '  - 高风险写入、私信正文、账号安全操作不会通过这里启用。',
    '  - 自动补安全路径只生成计划和安全替代路径，不会直接更新 current/ 或 registry.json。',
    '  - 真实可用前仍需补实现、跑验证，并由报告显示通过后才算可用。',
  ];

  if (state.safeConfirmable.length) {
    lines.push('', '可确认能力预览', ...firstItems(state.safeConfirmable, options.limit ?? MAX_INLINE_CAPABILITIES));
  }

  lines.push(
    '',
    '可选操作',
    '  1. 保持当前策略（默认）',
    '  2. 确认启用所有可安全确认能力',
    '  3. 逐项选择可安全确认能力',
    '  4. 查看已禁用/已阻断能力的安全路径、不可补原因和下一步',
    '  5. 自动生成安全补路径计划',
    '  6. 全部保持禁用',
    '',
  );
  return `${lines.join('\n')}`;
}

function capabilityWebOptionRows(capabilities, fieldName, extraText = () => '') {
  if (!capabilities.length) {
    return '<p class="empty">No items in this group.</p>';
  }
  return capabilities.map((capability) => {
    const id = capabilityId(capability);
    const name = capabilityName(capability) || id;
    const detail = extraText(capability);
    return `
      <label class="option">
        <input type="checkbox" name="${htmlEscape(fieldName)}" value="${htmlEscape(id)}">
        <span><strong>${htmlEscape(name)}</strong>${detail ? `<br><span class="note">${htmlEscape(detail)}</span>` : ''}</span>
      </label>`;
  }).join('');
}

function renderCapabilityInteractionWebForm(result = {}, state = capabilityInteractionState(result), token) {
  const report = resultReport(result);
  const skillId = state.skillId || resultSkillId(result) || '-';
  const buildId = state.buildId || resultBuildId(result) || '-';
  const remediationDetail = (capability) => {
    const terminalRemediation = capability.terminal_remediation ?? remediationTerminalFields(
      capability.safe_remediation ?? buildCapabilityRemediationPath(capability),
    );
    return terminalRemediation.safe_path ?? capability.safe_remediation_path ?? capability.default_policy ?? '';
  };
  return `
    <h1>Capability Interaction</h1>
    <p class="note">Review post-build capability decisions here. SiteForge will only write confirmation records or safe remediation plans; it will not enable high-risk final actions from this page.</p>
    <p>Skill: <code>${htmlEscape(skillId)}</code><br>Build: <code>${htmlEscape(buildId)}</code><br>Status: <code>${htmlEscape(report.result_status ?? result.status ?? '-')}</code></p>
    <form method="post" action="/submit">
      <input type="hidden" name="token" value="${htmlEscape(token)}">
      <fieldset>
        <legend>Safe confirmations (${state.safeConfirmable.length})</legend>
        ${capabilityWebOptionRows(state.safeConfirmable, 'confirm', (capability) => modeLabel(capability))}
      </fieldset>
      <fieldset>
        <legend>Safe remediation plans (${state.remediationCandidates.length})</legend>
        ${capabilityWebOptionRows(state.remediationCandidates, 'remediate', remediationDetail)}
      </fieldset>
      <div class="actions">
        <button class="primary" type="submit" name="action" value="save_selected">Save selected</button>
        <button type="submit" name="action" value="confirm_all">Confirm all safe</button>
        <button type="submit" name="action" value="remediate_all">Prepare all remediation plans</button>
        <button type="submit" name="action" value="keep">Keep current strategy</button>
        <button class="danger" type="submit" name="action" value="cancel">Cancel interaction</button>
      </div>
    </form>`;
}

async function applyCapabilityInteractionWebForm(result, options, state, form) {
  const action = String(form.get('action') ?? '').trim();
  if (action === 'cancel') {
    return { status: 'cancelled', count: 0 };
  }
  if (action === 'keep') {
    return { status: 'kept', count: 0 };
  }
  const selectedConfirmationIds = new Set(form.getAll('confirm').map(String));
  const selectedRemediationIds = new Set(form.getAll('remediate').map(String));
  const selectedConfirmations = action === 'confirm_all'
    ? state.safeConfirmable
    : state.safeConfirmable.filter((capability) => selectedConfirmationIds.has(capabilityId(capability)));
  const selectedRemediations = action === 'remediate_all'
    ? state.remediationCandidates
    : state.remediationCandidates.filter((capability) => selectedRemediationIds.has(capabilityId(capability)));
  if (!selectedConfirmations.length && !selectedRemediations.length) {
    return { status: 'kept', count: 0 };
  }
  const webOptions = {
    ...options,
    interactionCommand: 'siteforge build web capability selection',
    interactionSource: 'post_build_web_interaction',
  };
  const results = [];
  if (selectedConfirmations.length) {
    results.push(await writeCapabilityInteractionDecisions(result, selectedConfirmations, webOptions));
  }
  if (selectedRemediations.length) {
    results.push(await writeCapabilityRemediationPlan(result, selectedRemediations, webOptions));
  }
  return {
    status: results.some((entry) => entry.status === 'recorded') ? 'recorded' : 'skipped',
    count: results.reduce((sum, entry) => sum + (entry.count ?? 0), 0),
    results,
  };
}

async function promptCapabilityWebInteraction(result = {}, options = {}, state = capabilityInteractionState(result)) {
  try {
    return await runCapabilityWebForm({
      options,
      title: 'SiteForge Web capability interaction',
      waitingText: 'Waiting for post-build capability interaction in the browser...',
      renderForm: ({ token }) => renderCapabilityInteractionWebForm(result, state, token),
      handleForm: (form) => applyCapabilityInteractionWebForm(result, options, state, form),
    });
  } catch {
    return null;
  }
}

async function applyCapabilityWebDecision(result = {}, options = {}, state = capabilityInteractionState(result), decision = {}) {
  if (decision?.status === 'cancelled') {
    return { status: 'cancelled', count: 0 };
  }
  const confirmIds = new Set(asArray(decision.confirmCapabilityIds).map(asText).filter(Boolean));
  const remediationIds = new Set(asArray(decision.remediationCapabilityIds).map(asText).filter(Boolean));
  const selectedConfirmations = state.safeConfirmable.filter((capability) => confirmIds.has(capabilityId(capability)));
  const selectedRemediations = state.remediationCandidates.filter((capability) => remediationIds.has(capabilityId(capability)));
  if (!selectedConfirmations.length && !selectedRemediations.length) {
    return { status: 'kept', count: 0 };
  }
  const webOptions = {
    ...options,
    interactionCommand: 'siteforge build web capability selection',
    interactionSource: 'post_build_web_interaction',
  };
  const results = [];
  if (selectedConfirmations.length) {
    results.push(await writeCapabilityInteractionDecisions(result, selectedConfirmations, webOptions));
  }
  if (selectedRemediations.length) {
    results.push(await writeCapabilityRemediationPlan(result, selectedRemediations, webOptions));
  }
  return {
    status: results.some((entry) => entry.status === 'recorded') ? 'recorded' : 'skipped',
    count: results.reduce((sum, entry) => sum + (entry.count ?? 0), 0),
    results,
  };
}

async function promptCapabilityUnifiedWebInteraction(result = {}, options = {}, state = capabilityInteractionState(result)) {
  if (!shouldUseCapabilityWebInteraction(options)) {
    return null;
  }
  try {
    let session = options.webInteractionSession;
    if (!session) {
      session = await options.startWebInteractionSession?.({
        result,
        cwd: options.cwd ?? process.cwd(),
        phase: 'capabilities',
        status: 'waiting_for_capability_decisions',
      }, {
        cwd: options.cwd ?? process.cwd(),
      });
      options.webInteractionSession = session;
      await session.open();
      options.output?.write?.(`\nSiteForge 已打开本地交互页面：${session.url}\n`);
      options.output?.write?.('请在页面查看能力、意图、执行链路，并保存能力选择。\n');
    } else {
      session.update?.({
        result,
        cwd: options.cwd ?? process.cwd(),
        phase: 'capabilities',
        status: 'waiting_for_capability_decisions',
      });
    }
    session.update?.({
      result,
      cwd: options.cwd ?? process.cwd(),
      phase: 'capabilities',
      status: 'capability_decisions_kept',
    });
    const decision = {
      status: 'kept_continue',
      capabilityIds: [],
      confirmCapabilityIds: [],
      remediationCapabilityIds: [],
      safePathCapabilityIds: [],
      directActivationBlockedCapabilityIds: [],
      remediationActions: [],
    };
    return await applyCapabilityWebDecision(result, options, state, decision);
  } catch {
    return null;
  }
}

export function parseCapabilitySelection(input, count) {
  const value = lower(input);
  if (!value) return [];
  if (['all', 'a', '全部', '全选'].includes(value)) {
    return Array.from({ length: count }, (_, index) => index);
  }
  const selected = new Set();
  const parts = value.split(/[\s,，;；]+/u).filter(Boolean);
  for (const part of parts) {
    const range = part.match(/^(\d+)-(\d+)$/u);
    if (range) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      if (Number.isInteger(start) && Number.isInteger(end)) {
        for (let valueIndex = Math.min(start, end); valueIndex <= Math.max(start, end); valueIndex += 1) {
          if (valueIndex >= 1 && valueIndex <= count) selected.add(valueIndex - 1);
        }
      }
      continue;
    }
    const numeric = Number(part);
    if (Number.isInteger(numeric) && numeric >= 1 && numeric <= count) {
      selected.add(numeric - 1);
    }
  }
  return [...selected].sort((left, right) => left - right);
}

async function readExistingDecisionFile(filePath, skillId) {
  if (!await pathExists(filePath)) {
    return {
      schemaVersion: CAPABILITY_INTERACTION_SCHEMA_VERSION,
      skillId,
      decisions: [],
    };
  }
  try {
    return await readJsonFile(filePath);
  } catch {
    return {
      schemaVersion: CAPABILITY_INTERACTION_SCHEMA_VERSION,
      skillId,
      decisions: [],
    };
  }
}

function confirmationDecisionForMode(mode) {
  if (mode === 'draft_only') return 'confirmed_draft_only';
  if (mode === 'limited') return 'confirmed_limited';
  return 'confirmed_safe_capability';
}

function confirmationUsablePathRecord(capability = {}, result = {}) {
  const mode = modeForCapability(capability);
  const routeTemplate = routeTemplateFromCapability(capability, result);
  const loginStateReuse = {
    strategy: 'reuse_existing_system_browser_login_state',
    status: 'ready_for_sanitized_authorized_recheck',
    reusesExistingLoginState: true,
    requiresNewLogin: false,
    userMustRemainSignedIn: true,
    targetRoute: routeTemplate,
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
    resultingStatus: 'enabled',
    loginStateReuse,
  };
}

export async function writeCapabilityInteractionDecisions(result = {}, capabilities = [], options = {}) {
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
  const decisionByKey = new Map(asArray(existing.decisions).map((entry) => [
    `${entry.capabilityId}:${entry.decision}:${entry.mode}`,
    entry,
  ]));
  const decisions = selected.map((capability) => {
    const group = capabilityConfirmationGroup(capability);
    const mode = modeForCapability(capability);
    const usablePath = confirmationUsablePathRecord(capability, result);
    return {
      capabilityId: capability.id,
      capabilityName: capability.name ?? capability.user_facing_name ?? null,
      group,
      decision: confirmationDecisionForMode(mode),
      mode,
      usableAfterSelection: true,
      usablePathType: usablePath.type,
      usablePath,
      loginStateReuse: usablePath.loginStateReuse,
      completedBy: 'reused_user_login_state',
      immediateLimitedUse: usablePath.readiness.startsWith('immediate_'),
      requiresSiteAdapterVerificationBeforeUse: false,
      command: options.interactionCommand ?? 'siteforge build interactive capability selection',
      source: options.interactionSource ?? 'post_build_terminal_interaction',
      evidenceStatus: capability.evidence_status ?? capability.evidenceStatus ?? null,
      sourceBuildId: state.buildId || null,
      writeActionsEnabled: false,
      finalActionsAllowed: false,
      rawMaterialAllowed: false,
      privateContentAllowed: false,
      updatedAt: now,
    };
  });
  for (const decision of decisions) {
    decisionByKey.set(`${decision.capabilityId}:${decision.decision}:${decision.mode}`, decision);
  }
  const next = {
    schemaVersion: CAPABILITY_INTERACTION_SCHEMA_VERSION,
    skillId: state.skillId,
    updatedAt: now,
    decisions: [...decisionByKey.values()].sort((left, right) => (
      String(left.capabilityId).localeCompare(String(right.capabilityId), 'en')
      || String(left.decision).localeCompare(String(right.decision), 'en')
    )),
  };
  await writeJsonFile(filePath, next);
  return {
    status: 'recorded',
    filePath,
    count: decisions.length,
    decisions,
  };
}

function remediationPlanRecord(capability = {}) {
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

export async function writeCapabilityRemediationPlan(result = {}, capabilities = [], options = {}) {
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

function displayInteractionPath(filePath, cwd = process.cwd()) {
  const value = asText(filePath);
  if (!value) return '-';
  const relativePath = path.relative(cwd, value).replace(/\\/gu, '/');
  if (relativePath && !relativePath.startsWith('..') && !path.isAbsolute(relativePath)) {
    return relativePath;
  }
  return path.basename(value);
}

function renderDecisionResult(result, cwd = process.cwd()) {
  if (result.status !== 'recorded') {
    return '\n已保持当前能力策略。\n原因：没有可记录的安全确认项，或所选能力未通过证据与安全计划校验。\n';
  }
  return [
    '',
    `已记录 ${result.count} 项安全确认。`,
    '这些能力将复用系统浏览器里的既有登录态完成受限验证；不会保存 cookie、token、浏览器 profile、正文或原始页面源码。',
    '这些能力仍受执行计划和安全策略约束：不会执行写入动作。',
    `确认记录：${displayInteractionPath(result.filePath, cwd)}`,
    '',
  ].join('\n');
}

function renderRemediationResult(result, cwd = process.cwd()) {
  if (result.status !== 'recorded') {
    return '\n未生成安全补路径。\n原因：没有可补的安全路径候选，或构建目录不可用于记录计划。\n';
  }
  return [
    '',
    `已生成 ${result.count} 项安全补路径。`,
    `其中 ${result.summary?.immediateLimitedUse ?? result.summary?.autoPreparable ?? 0} 项可立即准备为受限可用路径；${result.summary?.requiresSiteAdapterVerification ?? 0} 项需要站点适配器验证后使用。`,
    '安全边界：不会自动执行高风险最终动作，不保存正文或私密材料；删除、上传、关注、发帖、发送私信、账号修改等必须由用户最终确认。',
    '这些能力会以安全替代方式进入可用路径：受限读取、草稿预览、用户介入安全路径，或显式站点适配器补路径。',
    `补路径计划：${displayInteractionPath(result.filePath, cwd)}`,
    '',
  ].join('\n');
}

function renderDisabledReview(state) {
  const blocked = [...state.blockedConfirmable, ...state.disabledReview];
  const lines = [
    '',
    '已禁用/已阻断能力',
    '  自动补的是安全路径和验证计划，不是绕过禁用直接启用。',
  ];
  for (const capability of blocked.slice(0, MAX_INLINE_CAPABILITIES)) {
    const terminalRemediation = capability.terminal_remediation ?? remediationTerminalFields(
      capability.safe_remediation ?? buildCapabilityRemediationPath(capability),
    );
    lines.push(`  - ${capabilityName(capability)}`);
    lines.push(`    可补安全路径：${terminalRemediation.safe_path}`);
    lines.push(`    不可补原因：${terminalRemediation.blocked_reason}`);
    lines.push(`    下一步：${terminalRemediation.next_step}`);
  }
  if (blocked.length > MAX_INLINE_CAPABILITIES) {
    lines.push(`  ... 另有 ${blocked.length - MAX_INLINE_CAPABILITIES} 项已写入报告`);
  }
  lines.push('');
  return lines.join('\n');
}

async function ask(rl, prompt) {
  return await rl.question(prompt);
}

function wantsRemediationPlan(value) {
  return ['y', 'yes', '是', '生成', '自动生成', '补路径', 'plan', '5'].includes(lower(value));
}

function treePad(value, width = 34) {
  const text = String(value ?? '');
  const length = [...text].length;
  if (length >= width) return text;
  return `${text}${' '.repeat(width - length)}`;
}

function treeRow(left, right = '') {
  return right ? `${treePad(left)} │ ${right}` : left;
}

function isTreeSpaceKey(key = {}) {
  return isTerminalSpaceKey(key);
}

function isTreeSlashKey(key = {}) {
  return isTerminalSlashKey(key);
}

function isTreeCharacterKey(key = {}, character) {
  return isTerminalCharacterKey(key, character);
}

function compactTreeText(value, maxLength = 52) {
  const text = String(value ?? '-').replace(/\s+/gu, ' ').replace(/\|/gu, '/').trim();
  const chars = [...text];
  if (chars.length <= maxLength) return text || '-';
  return `${chars.slice(0, Math.max(0, maxLength - 1)).join('')}…`;
}

function resultUserReport(result = {}) {
  return result.user_report ?? result.userReport ?? {};
}

function treeBuildStatus(result = {}) {
  const report = resultUserReport(result);
  if (report.result_status === 'success' || result.status === 'success') return '成功';
  if (report.result_status === 'failed' || result.status === 'failed') return '失败';
  return '部分成功';
}

function capabilityTreeRightText(capability = {}, state = {}) {
  const id = capabilityId(capability);
  if (state.safeById?.has(id)) {
    const group = capabilityConfirmationGroup(capability);
    if (group === 'sensitive-read') {
      return '确认后复用登录态有限启用：只保存脱敏结构摘要';
    }
    if (group === 'draft-write') {
      return '确认后复用登录态进入草稿模式：不会提交或发送';
    }
    return '确认后复用登录态启用已有安全能力';
  }
  if (state.remediationById?.has(id)) {
    const terminalRemediation = capability.terminal_remediation ?? remediationTerminalFields(
      capability.safe_remediation ?? buildCapabilityRemediationPath(capability),
    );
    return compactTreeText(terminalRemediation.safe_path, 64);
  }
  return compactTreeText(capability.reason ?? capability.default_policy ?? capability.enabled_status, 64);
}

function capabilityTreeBox(capability = {}, state = {}, ui = {}) {
  const id = capabilityId(capability);
  if (state.safeById?.has(id) || state.remediationById?.has(id)) {
    return ui.selected.has(id) ? '[x]' : '[ ]';
  }
  return '[ ]';
}

function treeSections(result, state, ui) {
  const report = resultUserReport(result);
  const nodes = report.discovered_nodes_summary ?? {};
  const counts = report.counts ?? result.summary ?? {};
  const completion = report.build_completion ?? {};
  const pending = [...state.safeConfirmable, ...state.blockedConfirmable];
  const disabled = state.disabledReview;
  const allCapabilities = [
    ...state.enabled,
    ...state.limited,
    ...state.confirmation,
    ...state.disabled,
  ];
  const debugCount = Number(report.debug_candidate_summary?.count ?? report.capability_summary?.debug_only ?? 0);
  return [
    {
      id: 'stats',
      title: '能力统计',
      count: null,
      right: `全部 ${allCapabilities.length} / 已启用 ${state.enabled.length} / 有限 ${state.limited.length} / 待确认 ${pending.length} / 已禁用 ${disabled.length}`,
      children: [
        { left: '    全部用户能力', right: `${allCapabilities.length} 项` },
        { left: '    已启用', right: `${state.enabled.length} 项` },
        { left: '    有限启用', right: `${state.limited.length} 项` },
        { left: '    待确认', right: `${pending.length} 项` },
        { left: '    已禁用', right: `${disabled.length} 项` },
        { left: '    可安全确认', right: `${state.safeConfirmable.length} 项` },
        { left: '    可补安全路径', right: `${state.remediationCandidates.length} 项` },
      ],
    },
    {
      id: 'enabled',
      title: '已启用能力',
      count: state.enabled.length,
      right: '已进入当前 Skill',
      capabilities: state.enabled,
      readonly: true,
    },
    {
      id: 'limited',
      title: '有限启用能力',
      count: state.limited.length,
      right: 'Space 选择确认边界；只保存脱敏结构摘要',
      capabilities: state.limited,
    },
    {
      id: 'discovery',
      title: '自动探索',
      count: null,
      right: `页面 ${nodes.page_nodes ?? 0} / 内容 ${nodes.content_nodes ?? 0} / 操作 ${nodes.operation_nodes ?? 0}`,
      children: [
        { left: '    页面/区域', right: `${nodes.page_nodes ?? 0}` },
        { left: '    内容节点', right: `${nodes.content_nodes ?? 0}` },
        { left: '    操作节点', right: `${nodes.operation_nodes ?? 0}` },
        { left: '    可操作元素', right: `${counts.actionable_elements ?? nodes.actionable_elements ?? 0}` },
      ],
    },
    {
      id: 'pending',
      title: '待确认能力',
      count: pending.length,
      right: 'Space 勾选确认或补安全路径；q 保存退出',
      capabilities: pending,
    },
    {
      id: 'disabled',
      title: '已禁用能力',
      count: disabled.length,
      right: 'Space 勾选补安全路径；不会强行启用高风险动作',
      capabilities: disabled,
      disabled: true,
    },
    {
      id: 'output',
      title: '输出结果',
      count: null,
      right: `验证 ${completion.verification_status === 'passed' ? '通过' : '未通过'}`,
      children: [
        { left: '    current/', right: completion.current_updated === true ? '已更新' : '未更新' },
        { left: '    registry.json', right: completion.registry_registered === true ? '已注册' : '未注册' },
        { left: '    Skill ID', right: report.skill_id ?? result.skillId ?? '-' },
      ],
    },
    {
      id: 'debug',
      title: '调试信息',
      count: null,
      right: `${debugCount} 项 debug 候选`,
      children: [
        { left: '    debug 候选', right: `${debugCount}` },
        { left: '    build 报告', right: result.artifacts?.['build_report.json'] ?? 'build_report.json' },
      ],
    },
  ].filter((section) => {
    if (!ui.search) return true;
    const needle = ui.search.toLowerCase();
    return section.title.toLowerCase().includes(needle)
      || (section.capabilities ?? []).some((capability) => capabilityName(capability).toLowerCase().includes(needle));
  });
}

function visibleTreeRows(result, state, ui) {
  const rows = [];
  for (const section of treeSections(result, state, ui)) {
    rows.push({ type: 'section', section });
    if (!ui.expanded.has(section.id)) continue;
    if (Array.isArray(section.children)) {
      for (const child of section.children) {
        rows.push({ type: 'detail', section, child });
      }
      continue;
    }
    const capabilities = section.capabilities ?? [];
    for (const capability of capabilities) {
      if (ui.search && !capabilityName(capability).toLowerCase().includes(ui.search.toLowerCase())) {
        continue;
      }
      rows.push({ type: 'capability', section, capability });
    }
  }
  return rows;
}

function firstSelectableTreeRowIndex(result, state, ui) {
  const rows = visibleTreeRows(result, state, ui);
  const index = rows.findIndex((row) => (
    row.type === 'capability'
    && (
      state.safeById?.has(capabilityId(row.capability))
      || state.remediationById?.has(capabilityId(row.capability))
    )
  ));
  return index >= 0 ? index : 0;
}

function renderCapabilityTreeTui(result, state, ui) {
  const rows = visibleTreeRows(result, state, ui);
  const lines = [
    `✓ 构建完成（${treeBuildStatus(result)}）`,
    '',
    '↑↓ 移动  Enter 展开/折叠  Space 勾选/取消  / 搜索  q 保存退出  Esc 退出',
    `搜索：${ui.searchMode ? `${ui.search}_` : (ui.search || '-')}`,
    '',
  ];
  rows.forEach((row, index) => {
    const focused = index === ui.focus ? '› ' : '  ';
    if (row.type === 'section') {
      const expanded = ui.expanded.has(row.section.id) ? '▼' : '▶';
      const countText = Number.isInteger(row.section.count) ? ` (${row.section.count})` : '';
      lines.push(treeRow(`${focused}${expanded} ${row.section.title}${countText}`, row.section.right));
      return;
    }
    if (row.type === 'capability') {
      const id = capabilityId(row.capability);
      const box = capabilityTreeBox(row.capability, state, ui);
      lines.push(treeRow(`${focused}  ${box} ${capabilityName(row.capability)}`, capabilityTreeRightText(row.capability, state)));
      return;
    }
    lines.push(treeRow(`${focused}${row.child.left}`, row.child.right));
  });
  const selectedConfirm = [...ui.selected].filter((id) => state.safeById?.has(id)).length;
  const selectedRemediation = [...ui.selected].filter((id) => state.remediationById?.has(id)).length;
  lines.push('', `已选择：确认 ${selectedConfirm} 项；补安全路径 ${selectedRemediation} 项`);
  return `${lines.join('\n')}\n`;
}

function toggleTreeCapabilitySelection(row, ui, safeById, remediationById) {
  if (row?.type !== 'capability') {
    return false;
  }
  const id = capabilityId(row.capability);
  if (!safeById.has(id) && !remediationById.has(id)) {
    return false;
  }
  if (ui.selected.has(id)) {
    ui.selected.delete(id);
  } else {
    ui.selected.add(id);
  }
  return true;
}

async function promptCapabilityTreeInteraction(result, options, state) {
  const input = options.input;
  const output = options.output;
  if (!input?.isTTY || !output?.isTTY || typeof input.setRawMode !== 'function') {
    return null;
  }
  const ui = {
    expanded: new Set(['enabled', 'limited', 'pending', 'disabled']),
    focus: 0,
    selected: new Set(),
    search: '',
    searchMode: false,
  };
  let save = true;
  const safeById = new Map(state.safeConfirmable.map((capability) => [capabilityId(capability), capability]));
  const remediationById = new Map(state.remediationCandidates.map((capability) => [capabilityId(capability), capability]));
  const treeState = {
    ...state,
    safeById,
    remediationById,
  };
  ui.focus = firstSelectableTreeRowIndex(result, treeState, ui);
  const terminal = enterTerminalTui(input, output);
  if (!terminal) {
    return null;
  }
  const render = () => {
    const rows = visibleTreeRows(result, treeState, ui);
    if (ui.focus >= rows.length) ui.focus = Math.max(0, rows.length - 1);
    terminal.render(renderCapabilityTreeTui(result, treeState, ui));
  };
  render();
  try {
    for await (const key of readTerminalKeys(input)) {
      const rows = visibleTreeRows(result, treeState, ui);
      if (key.ctrl && key.name === 'c') {
        save = false;
        break;
      }
      if (ui.searchMode) {
        if (isTerminalReturnKey(key)) {
          ui.searchMode = false;
        } else if (key.name === 'escape') {
          ui.searchMode = false;
          ui.search = '';
        } else if (key.name === 'backspace') {
          ui.search = [...ui.search].slice(0, -1).join('');
        } else if (key.text && [...key.text].length === 1 && !key.ctrl && !key.meta) {
          ui.search += key.text;
        }
        render();
        continue;
      }
      if (isTreeCharacterKey(key, 'q')) break;
      if (key.name === 'escape') {
        save = false;
        break;
      }
      if (key.name === 'up') {
        ui.focus = Math.max(0, ui.focus - 1);
      } else if (key.name === 'down') {
        ui.focus = Math.min(Math.max(0, rows.length - 1), ui.focus + 1);
      } else if (isTerminalReturnKey(key)) {
        const row = rows[ui.focus];
        if (row?.type === 'section') {
          if (ui.expanded.has(row.section.id)) ui.expanded.delete(row.section.id);
          else ui.expanded.add(row.section.id);
        } else {
          toggleTreeCapabilitySelection(row, ui, safeById, remediationById);
        }
      } else if (isTreeSpaceKey(key)) {
        toggleTreeCapabilitySelection(rows[ui.focus], ui, safeById, remediationById);
      } else if (isTreeSlashKey(key)) {
        ui.searchMode = true;
        ui.search = '';
      }
      render();
    }
  } finally {
    terminal.close();
  }
  if (!save) {
    output.write('已退出交互树，未写入新的能力确认。\n');
    return { status: 'cancelled', count: 0 };
  }
  const selectedConfirmations = [...ui.selected].map((id) => safeById.get(id)).filter(Boolean);
  const selectedRemediations = [...ui.selected].map((id) => remediationById.get(id)).filter(Boolean);
  if (!selectedConfirmations.length && !selectedRemediations.length) {
    output.write('已保持当前能力策略。\n');
    return { status: 'kept', count: 0 };
  }
  const results = [];
  if (selectedConfirmations.length) {
    const recorded = await writeCapabilityInteractionDecisions(result, selectedConfirmations, options);
    output.write(renderDecisionResult(recorded, options.cwd ?? process.cwd()));
    results.push(recorded);
  }
  if (selectedRemediations.length) {
    const recorded = await writeCapabilityRemediationPlan(result, selectedRemediations, options);
    output.write(renderRemediationResult(recorded, options.cwd ?? process.cwd()));
    results.push(recorded);
  }
  return {
    status: results.some((entry) => entry.status === 'recorded') ? 'recorded' : 'skipped',
    count: results.reduce((sum, entry) => sum + (entry.count ?? 0), 0),
    results,
  };
}

export async function promptForCapabilityInteraction(result = {}, options = {}) {
  if (!shouldOfferCapabilityInteraction(result, options)) {
    return null;
  }
  const input = options.input;
  const output = options.output;
  if (!input || !output) return null;

  const state = capabilityInteractionState(result);
  const unifiedWebResult = await promptCapabilityUnifiedWebInteraction(result, options, state);
  if (unifiedWebResult) return unifiedWebResult;
  const webResult = options.webInteractionSession
    ? null
    : await promptCapabilityWebInteraction(result, options, state);
  if (webResult) return webResult;
  if (options.treeUi !== false) {
    const treeResult = await promptCapabilityTreeInteraction(result, options, state);
    if (treeResult) return treeResult;
  }
  output.write(renderCapabilityInteractionPrompt(result, options));
  const rl = createInterface({ input, output });
  try {
    const answer = lower(await ask(rl, '选择：'));
    if (!answer || answer === '1') {
      output.write('\n已保持当前能力策略。\n');
      return { status: 'kept', count: 0 };
    }
    if (answer === '2') {
      const recorded = await writeCapabilityInteractionDecisions(result, state.safeConfirmable, options);
      output.write(renderDecisionResult(recorded, options.cwd ?? process.cwd()));
      return recorded;
    }
    if (answer === '3') {
      if (!state.safeConfirmable.length) {
        output.write('\n当前没有可安全确认的能力。\n');
        return { status: 'skipped', count: 0 };
      }
      output.write('\n请选择要确认启用的能力。输入编号、范围或 all；直接按 Enter 保持不变。\n');
      output.write(firstItems(state.safeConfirmable, Math.max(state.safeConfirmable.length, MAX_INLINE_CAPABILITIES)).join('\n'));
      output.write('\n');
      const selectedAnswer = await ask(rl, '能力编号：');
      const indexes = parseCapabilitySelection(selectedAnswer, state.safeConfirmable.length);
      const selected = indexes.map((index) => state.safeConfirmable[index]).filter(Boolean);
      const recorded = await writeCapabilityInteractionDecisions(result, selected, options);
      output.write(renderDecisionResult(recorded, options.cwd ?? process.cwd()));
      return recorded;
    }
    if (answer === '4') {
      output.write(renderDisabledReview(state));
      if (state.remediationCandidates.length) {
        const remediationAnswer = await ask(rl, '是否自动生成安全补路径计划？输入 y 生成，直接回车保持当前策略：');
        if (wantsRemediationPlan(remediationAnswer)) {
          const recorded = await writeCapabilityRemediationPlan(result, state.remediationCandidates, options);
          output.write(renderRemediationResult(recorded, options.cwd ?? process.cwd()));
          return recorded;
        }
      }
      output.write('已保持当前能力策略。\n');
      return { status: 'reviewed_disabled', count: 0 };
    }
    if (answer === '5') {
      const recorded = await writeCapabilityRemediationPlan(result, state.remediationCandidates, options);
      output.write(renderRemediationResult(recorded, options.cwd ?? process.cwd()));
      return recorded;
    }
    if (answer === '6') {
      output.write('\n已保持禁用和需确认状态；未启用额外能力。\n');
      return { status: 'disabled_kept', count: 0 };
    }
    output.write('\n未识别的选择，已保持当前能力策略。\n');
    return { status: 'invalid_choice', count: 0 };
  } finally {
    rl.close();
  }
}
