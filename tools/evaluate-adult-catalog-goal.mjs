// @ts-check

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const GOAL_DIR = path.resolve('docs/codex-goals/adult-catalog-site-build-evaluation-v1');
const EVALUATION_JSON = path.join(GOAL_DIR, 'siteforge-adult-catalog-evaluation.json');
const EVALUATION_MD = path.join(GOAL_DIR, 'siteforge-adult-catalog-evaluation.md');

const TARGETS = Object.freeze([
  { siteKey: 't-powers', url: 'https://www.t-powers.co.jp/', siteId: 't-powers.co.jp-4fa773a1', adapterId: 't-powers', expectedArchetype: 'catalog-detail' },
  { siteKey: 'so-agent', url: 'http://so-agent.jp/', siteId: 'so-agent.jp-636b440c', adapterId: 'so-agent', expectedArchetype: 'catalog-detail' },
  { siteKey: 'moodyz', url: 'https://moodyz.com/top', siteId: 'moodyz.com-c086e87f', adapterId: 'moodyz', expectedArchetype: 'catalog-detail' },
  { siteKey: 'dahlia', url: 'https://dahlia-av.jp/', siteId: 'dahlia-av.jp-f794ab63', adapterId: 'dahlia', expectedArchetype: 'catalog-detail' },
  { siteKey: 'sod', url: 'https://www.sod.co.jp/', siteId: 'sod.co.jp-65d1a02e', adapterId: 'sod', expectedArchetype: 'catalog-detail' },
  { siteKey: 's1', url: 'https://s1s1s1.com/top', siteId: 's1s1s1.com-4fdf0909', adapterId: 's1', expectedArchetype: 'catalog-detail' },
  { siteKey: 'attackers', url: 'https://attackers.net/top', siteId: 'attackers.net-d8c8b3fb', adapterId: 'attackers', expectedArchetype: 'catalog-detail' },
  { siteKey: 'km-produce', url: 'https://www.km-produce.com/', siteId: 'km-produce.com-af1ddc05', adapterId: 'km-produce', expectedArchetype: 'catalog-detail' },
  { siteKey: 'rookie', url: 'https://rookie-av.jp/top', siteId: 'rookie-av.jp-64e7e465', adapterId: 'rookie', expectedArchetype: 'catalog-detail' },
  { siteKey: 'madonna', url: 'https://madonna-av.com/top', siteId: 'madonna-av.com-4f7bee91', adapterId: 'madonna', expectedArchetype: 'catalog-detail' },
  { siteKey: 'dogma', url: 'http://www.dogma.co.jp/', siteId: 'dogma.co.jp-aee5e575', adapterId: 'dogma', expectedArchetype: 'catalog-detail' },
]);

const DISCOVERY_WEIGHTS = Object.freeze({
  '能力语义准确性': 20,
  '能力粒度合理性': 15,
  '证据完整性': 15,
  '候选能力解释性': 10,
  '程序接口发现真实性': 10,
  '站点类型识别准确性': 10,
  '适配器选择合理性': 10,
  '安全边界发现': 10,
});

const EXECUTION_WEIGHTS = Object.freeze({
  '参数/槽位建模质量': 15,
  '执行计划完整性': 15,
  '运行时绑定稳定性': 15,
  '单能力执行成功率': 15,
  '结果验证能力': 15,
  '输出结构化质量': 10,
  '错误恢复能力': 10,
  '执行安全治理': 5,
});

const TASK_WEIGHTS = Object.freeze({
  '用户意图覆盖率': 10,
  '意图分发准确率': 10,
  '多步任务规划质量': 15,
  '能力组合成功率': 15,
  '上下文传递正确率': 10,
  '端到端任务完成率': 20,
  '任务结果质量': 10,
  '失败解释与修复建议': 5,
  '任务级安全合规': 5,
});

const LAYER_WEIGHTS = Object.freeze({
  discovery: 30,
  execution: 35,
  task: 35,
});

const WRITE_OR_HIGH_RISK_ACTIONS = new Set([
  'checkout',
  'contact',
  'delete',
  'download',
  'export',
  'manage',
  'pay',
  'payment',
  'publish',
  'save',
  'send',
  'submit',
  'track',
  'upload',
  'write',
]);

const READ_OPERATION_KINDS = new Set([
  'api',
  'api_request',
  'form_or_action',
  'navigate',
  'public_http',
  'query',
  'read',
  'search',
  'view',
]);

function normalizeText(value) {
  return String(value ?? '').trim();
}

function normalizeId(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
}

function normalizeHost(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/^https?:\/\//u, '')
    .replace(/\/.*$/u, '')
    .replace(/^www\./u, '');
}

function scoreRatio(passed, total) {
  if (total <= 0) return 100;
  return Math.round((passed / total) * 10000) / 100;
}

function weightedAverage(scores, weights) {
  const totalWeight = Object.values(weights).reduce((sum, weight) => sum + weight, 0);
  const score = Object.entries(weights).reduce((sum, [name, weight]) => sum + (scores[name] ?? 0) * weight, 0) / totalWeight;
  return Math.round(score * 100) / 100;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function maybeReadJson(filePath, fallback = null) {
  try {
    return await readJson(filePath);
  } catch {
    return fallback;
  }
}

async function maybeReadText(filePath, fallback = '') {
  try {
    return await readFile(filePath, 'utf8');
  } catch {
    return fallback;
  }
}

function siteRegistryEntries(registryConfig) {
  return Object.entries(registryConfig?.sites ?? {});
}

function findRegistryEntry(registryConfig, target) {
  const targetHost = normalizeHost(target.url);
  for (const [key, entry] of siteRegistryEntries(registryConfig)) {
    const hosts = [
      key,
      entry?.host,
      entry?.canonicalBaseUrl,
      ...(Array.isArray(entry?.domains) ? entry.domains : []),
    ].map(normalizeHost);
    if (entry?.siteKey === target.siteKey || entry?.adapterId === target.adapterId || hosts.includes(targetHost)) {
      return { key, entry };
    }
  }
  return { key: null, entry: null };
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function isEnabledRuntimeCapability(capability) {
  return capability?.enabled_status === 'enabled'
    && capability?.runtimeCallable === true
    && capability?.riskPolicy?.disabled !== true;
}

function isRiskAction(capability) {
  const action = normalizeId(capability?.action).replace(/-/gu, '_');
  const name = normalizeId(capability?.name).replace(/-/gu, '_');
  return WRITE_OR_HIGH_RISK_ACTIONS.has(action)
    || /(?:delete|download|export|pay|payment|publish|save|send|submit|upload|write|contact|manage)/u.test(name);
}

function isGenericCapability(capability) {
  const name = normalizeText(capability?.name).toLowerCase();
  return /^(?:browse|open|read|search|view) (?:public|catalog|product|homepage)/u.test(name)
    || name === 'view homepage'
    || name === 'open catalog author profile'
    || [
      'browse release listings',
      'browse release updates',
      'browse reserve listings',
      'browse news updates',
      'browse news channels',
      'browse genre directory',
      'browse series directory',
      'browse label directory',
      'browse maker directory',
      'browse performer directory',
      'browse topic directory',
      'browse topic update archive',
      'browse ranking lists',
      'browse event and media listings',
      'browse event and media updates',
      'browse special pages',
      'browse vr catalog',
      'browse sales catalog',
      'open help pages',
      'open inquiry boundary pages',
      'open policy pages',
      'open utility pages',
      'open sitemap',
      'open topic update detail',
      'view news homepage',
    ].includes(name);
}

function isFragmentLikeCapability(capability) {
  const name = normalizeText(capability?.name);
  const object = normalizeText(capability?.object);
  const text = `${name} ${object}`;
  return /^(?:link|button|input|form|structure-ref|item|card)[-_ ]?\d+$/iu.test(name)
    || /(?:review|comment|description|thumbnail|recommendation|sample scene|body text|正文|简介|评论|推荐语|缩略图)/iu.test(text)
    || /(?:^|[^a-z0-9])(?:[A-Z]{2,6}\d{2,5}|[A-Z]{2,6}-\d{2,5})(?:[^a-z0-9]|$)/u.test(name);
}

function capabilityGranularityOk(enabledCapabilities) {
  const names = enabledCapabilities.map((capability) => normalizeId(capability.name));
  const uniqueNames = new Set(names);
  return uniqueNames.size === names.length
    && enabledCapabilities.every((capability) => !isFragmentLikeCapability(capability));
}

function businessCoverageSeedSelectionOk(seedsDoc) {
  const selection = seedsDoc?.businessCoverageSeedSelection;
  if (!selection || selection.status === 'not_configured') {
    return false;
  }
  return asArray(selection.requiredGroups).length > 0
    && asArray(selection.missingRequiredGroups).length === 0
    && Number(selection.selectedGroups?.length ?? 0) >= Math.min(3, Number(selection.configuredGroupCount ?? 0));
}

function businessCoverageCapabilityOk(enabledCapabilities, seedsDoc) {
  const selection = seedsDoc?.businessCoverageSeedSelection;
  const requiredGroups = new Set(asArray(selection?.requiredGroups));
  const selectedGroups = new Set(asArray(selection?.selectedGroups));
  const coverageGroups = requiredGroups.size ? requiredGroups : selectedGroups;
  if (!coverageGroups.size) {
    return false;
  }
  const capabilityNames = new Set(enabledCapabilities.map((capability) => normalizeText(capability.name).toLowerCase()));
  const groupCapabilityMap = new Map([
    ['release-listings', 'browse release listings'],
    ['reserve-listings', 'browse reserve listings'],
    ['news-updates', 'browse news updates'],
    ['genre-directory', 'browse genre directory'],
    ['series-directory', 'browse series directory'],
    ['label-directory', 'browse label directory'],
    ['maker-directory', 'browse maker directory'],
    ['person-directory', 'browse performer directory'],
    ['topic-directory', 'browse topic directory'],
    ['ranking-lists', 'browse ranking lists'],
    ['event-media', 'browse event and media listings'],
    ['special-pages', 'browse special pages'],
    ['vr-catalog', 'browse VR catalog'],
    ['sales-catalog', 'browse sales catalog'],
    ['sitemap', 'open sitemap'],
    ['help', 'open help pages'],
    ['contact-boundary', 'open inquiry boundary pages'],
    ['policy-pages', 'open policy pages'],
    ['utility-pages', 'open utility pages'],
  ]);
  const expected = [...coverageGroups]
    .map((group) => groupCapabilityMap.get(group))
    .filter(Boolean)
    .map((name) => name.toLowerCase());
  if (!expected.length) {
    return true;
  }
  return expected.every((name) => capabilityNames.has(name));
}

function capabilityHasEvidence(capability) {
  const matrix = capability?.evidenceMatrix ?? capability?.activationEvidence ?? {};
  const missing = asArray(matrix.missingEvidence);
  const observed = asArray(matrix.observedEvidence);
  const hasMatrix = normalizeText(matrix.activationDecision) || observed.length > 0 || asArray(matrix.requiredEvidence).length > 0;
  return hasMatrix
    && missing.length === 0
    && asArray(capability?.evidence).length > 0
    && (capability?.raw_content_saved !== true)
    && (capability?.private_content_saved !== true);
}

function hasNonActiveExplanation(capability) {
  return Boolean(
    normalizeText(capability?.reason)
      || normalizeText(capability?.riskPolicy?.reasonCode)
      || normalizeText(capability?.enabled_status)
      || normalizeText(capability?.executionDisposition)
      || normalizeText(capability?.safe_remediation?.reason)
      || normalizeText(capability?.confirmation_blocked_reason),
  );
}

function safeRuntimeRequirements(capability) {
  const req = capability?.runtimeRequirements ?? capability?.executionPlan?.runtimeRequirements ?? {};
  const methods = asArray(req.allowedMethods).map((method) => normalizeText(method).toUpperCase());
  return req.readOnly === true
    && (methods.length === 0 || methods.every((method) => method === 'GET' || method === 'HEAD'))
    && req.cookieMaterialAllowed !== true
    && req.formSubmissionAllowed !== true
    && req.savedMaterial === 'sanitized_summary_only';
}

function capabilityPlanOk(capability, plansByCapabilityId) {
  const plan = capability?.executionPlan ?? plansByCapabilityId.get(capability?.id);
  return Boolean(plan?.id && asArray(plan?.steps).length > 0);
}

function capabilityContractOk(capability, contractsByCapabilityId) {
  const contract = contractsByCapabilityId.get(capability?.id);
  if (!contract) return false;
  const operationKind = normalizeId(contract.operationKind ?? contract.contractKind ?? contract.runtimeBinding?.kind).replace(/-/gu, '_');
  const action = normalizeId(capability?.action).replace(/-/gu, '_');
  const readOnlyFormSearch = operationKind === 'form_or_action' && action === 'search' && safeRuntimeRequirements(capability);
  return contract.runtimeCallable === true
    && contract.planCallable === true
    && contract.destructiveAction !== true
    && contract.paymentOrFundsAction !== true
    && (READ_OPERATION_KINDS.has(operationKind) || readOnlyFormSearch)
    && ['public_http', 'api_read_provider', 'weibo_readonly_provider', ''].includes(normalizeId(contract.runtimeBinding?.kind).replace(/-/gu, '_'))
    && contract.payloadTemplate?.savedMaterial === 'sanitized_summary_only';
}

function capabilityOutputsOk(capability) {
  return asArray(capability?.outputs).length > 0
    && asArray(capability.outputs).every((output) => normalizeText(output?.name) && normalizeText(output?.type));
}

function searchSlotsOk(enabledCapabilities) {
  const searchCapabilities = enabledCapabilities.filter((capability) => normalizeId(capability.name).includes('search'));
  return searchCapabilities.every((capability) => asArray(capability.inputs).some((input) => normalizeText(input?.name) && normalizeText(input?.type)));
}

function hasCapability(enabledCapabilities, pattern) {
  return enabledCapabilities.some((capability) => pattern.test(normalizeText(capability.name)));
}

function expectsSearch(registryEntry) {
  return asArray(registryEntry?.capabilityFamilies).includes('search-content');
}

function getArtifactReportPath(siteRegistry) {
  const skill = siteRegistry?.skills?.[0] ?? {};
  return normalizeText(skill.artifactDir)
    ? path.join(skill.artifactDir, 'build_report.user.json')
    : '';
}

function buildHardCaps({
  enabledCapabilities,
  allCapabilities,
  apiSummary,
  nonActiveCapabilities,
  plansByCapabilityId,
  buildReport,
}) {
  const hardCaps = [];
  const invalidSemanticEnabled = enabledCapabilities.filter((capability) => !isGenericCapability(capability) || isFragmentLikeCapability(capability));
  if (invalidSemanticEnabled.length > 0) {
    hardCaps.push({ problem: '正文、简介、评论、章节内容或页面碎片疑似被提升为 active 能力', cap: 60, evidenceCount: invalidSemanticEnabled.length });
  }
  const riskyEnabled = enabledCapabilities.filter(isRiskAction);
  if (riskyEnabled.length > 0) {
    hardCaps.push({ problem: '写入、提交、删除、下载或支付类动作仍可执行', cap: 65, evidenceCount: riskyEnabled.length });
  }
  const activeApiClaims = enabledCapabilities.filter((capability) => /api|network/iu.test(normalizeText(capability.name)) || normalizeText(capability.action) === 'track');
  const acceptedApis = Number(apiSummary?.adapter_accepted_count ?? 0);
  const replayVerified = Number(apiSummary?.replay_verified_count ?? 0);
  if (activeApiClaims.length > 0 || acceptedApis > replayVerified) {
    hardCaps.push({ problem: '程序接口能力没有足够回放验证或存在 active API 虚构风险', cap: 70, evidenceCount: activeApiClaims.length + Math.max(acceptedApis - replayVerified, 0) });
  }
  const enabledWithoutPlan = enabledCapabilities.filter((capability) => !capabilityPlanOk(capability, plansByCapabilityId));
  if (enabledWithoutPlan.length > Math.max(0, enabledCapabilities.length * 0.25)) {
    hardCaps.push({ problem: 'active 可执行能力大量没有执行计划', cap: 75, evidenceCount: enabledWithoutPlan.length });
  }
  const unexplainedNonActive = nonActiveCapabilities.filter((capability) => !hasNonActiveExplanation(capability));
  if (unexplainedNonActive.length > 0) {
    hardCaps.push({ problem: '非 active 能力缺少失败或禁用原因', cap: 80, evidenceCount: unexplainedNonActive.length });
  }
  const capabilitySensitiveMaterial = allCapabilities.filter((capability) => capability?.private_content_saved === true
    || capability?.raw_content_saved === true
    || asArray(capability?.evidence).some((entry) => entry?.private_content_saved === true || entry?.raw_content_saved === true));
  const reportSensitiveMaterial = buildReport?.private_content_saved === true
    || buildReport?.browser_state_saved === true
    || buildReport?.privacy_summary?.credential_material_persisted === true
    || buildReport?.privacy_summary?.runtime_sensitive_material_persisted === true
    || buildReport?.privacy_summary?.sanitized_reports !== true;
  if (capabilitySensitiveMaterial.length > 0 || reportSensitiveMaterial) {
    hardCaps.push({ problem: '敏感材料进入报告、技能或能力字段', cap: '不合格', evidenceCount: capabilitySensitiveMaterial.length + (reportSensitiveMaterial ? 1 : 0) });
  }
  return hardCaps;
}

function applyHardCaps(score, hardCaps) {
  if (hardCaps.some((entry) => entry.cap === '不合格')) return 0;
  return hardCaps.reduce((current, entry) => Math.min(current, Number(entry.cap)), score);
}

function evaluateSite(target, registryConfig, siteCapabilityConfig) {
  return async () => {
    const { key: registryKey, entry: registryEntry } = findRegistryEntry(registryConfig, target);
    const siteRoot = path.join('.siteforge', 'sites', target.siteId);
    const generatedSiteRegistry = await readJson(path.join(siteRoot, 'registry.json'));
    const currentDir = normalizeText(generatedSiteRegistry?.skills?.[0]?.skillDir) || path.join(siteRoot, 'current');
    const artifactReportPath = getArtifactReportPath(generatedSiteRegistry);
    const buildReport = await readJson(artifactReportPath);
    const capabilitiesDoc = await readJson(path.join(currentDir, 'capabilities.json'));
    const intentsDoc = await readJson(path.join(currentDir, 'intents.json'));
    const plansDoc = await readJson(path.join(currentDir, 'execution_plans.json'));
    const contractsDoc = await readJson(path.join(currentDir, 'execution_contracts.json'));
    const adapterDoc = await readJson(path.join(currentDir, 'generated_adapter.json'));
    const verificationReport = await readJson(path.join(currentDir, 'verification_report.json'));
    const runtimeExecutionReport = await maybeReadJson(path.join(currentDir, 'runtime_execution_report.json'), {});
    const seedsDoc = await maybeReadJson(path.join(path.dirname(artifactReportPath), 'seeds.json'), {});
    const skillYaml = await maybeReadText(path.join(currentDir, 'skill.yaml'), '');
    const pageReconciliation = await maybeReadJson(path.join(path.dirname(artifactReportPath), 'page_reconciliation_report.json'), {});
    const siteCapabilitiesEntry = siteCapabilityConfig?.sites?.[registryEntry?.host] ?? siteCapabilityConfig?.sites?.[registryKey] ?? null;

    const allCapabilities = asArray(capabilitiesDoc.capabilities);
    const enabledCapabilities = allCapabilities.filter(isEnabledRuntimeCapability);
    const nonActiveCapabilities = allCapabilities.filter((capability) => !isEnabledRuntimeCapability(capability));
    const enabledIds = new Set(enabledCapabilities.map((capability) => capability.id));
    const plans = asArray(plansDoc.executionPlans);
    const contracts = asArray(contractsDoc.executionContracts);
    const intents = asArray(intentsDoc.intents);
    const plansByCapabilityId = new Map(plans.map((plan) => [plan.capabilityId, plan]));
    const contractsByCapabilityId = new Map(contracts.map((contract) => [contract.capabilityId, contract]));
    const enabledIntents = intents.filter((intent) => intent.runtimeCallable === true);
    const disabledRiskCapabilities = allCapabilities.filter((capability) => isRiskAction(capability) && !isEnabledRuntimeCapability(capability));
    const enabledRiskCapabilities = enabledCapabilities.filter(isRiskAction);
    const searchRequired = expectsSearch(registryEntry);
    const seedCoverageOk = businessCoverageSeedSelectionOk(seedsDoc);
    const capabilityCoverageOk = businessCoverageCapabilityOk(enabledCapabilities, seedsDoc);

    const discoveryScores = {
      '能力语义准确性': scoreRatio(enabledCapabilities.filter(isGenericCapability).length, enabledCapabilities.length),
      '能力粒度合理性': capabilityGranularityOk(enabledCapabilities) ? 100 : 0,
      '证据完整性': scoreRatio(enabledCapabilities.filter(capabilityHasEvidence).length, enabledCapabilities.length),
      '候选能力解释性': scoreRatio(nonActiveCapabilities.filter(hasNonActiveExplanation).length, nonActiveCapabilities.length),
      '程序接口发现真实性': buildReport.api_discovery_summary?.adapter_accepted_count > 0
        ? scoreRatio(buildReport.api_discovery_summary.replay_verified_count, buildReport.api_discovery_summary.adapter_accepted_count)
        : 100,
      '站点类型识别准确性': registryEntry?.siteArchetype === target.expectedArchetype ? 100 : 0,
      '适配器选择合理性': registryEntry?.adapterId === target.adapterId
        && adapterDoc.sourceAdapterId === target.adapterId
        && adapterDoc.executableCodeGenerated === false
        ? 100
        : 0,
      '安全边界发现': enabledRiskCapabilities.length === 0 && disabledRiskCapabilities.every((capability) => capability.runtimeCallable !== true && capability.executionDisposition === 'blocked') ? 100 : 0,
    };

    const executionScores = {
      '参数/槽位建模质量': searchSlotsOk(enabledCapabilities) ? 100 : 0,
      '执行计划完整性': scoreRatio(enabledCapabilities.filter((capability) => capabilityPlanOk(capability, plansByCapabilityId)).length, enabledCapabilities.length),
      '运行时绑定稳定性': scoreRatio(enabledCapabilities.filter((capability) => safeRuntimeRequirements(capability) && capabilityContractOk(capability, contractsByCapabilityId)).length, enabledCapabilities.length),
      '单能力执行成功率': scoreRatio(enabledCapabilities.filter((capability) => capability.runtimeCallable === true && capability.planCallable !== false && contractsByCapabilityId.get(capability.id)?.runtimeCallable === true).length, enabledCapabilities.length),
      '结果验证能力': verificationReport.status === 'passed' && (pageReconciliation.status === 'passed' || !pageReconciliation.status) ? 100 : 0,
      '输出结构化质量': enabledCapabilities.every(capabilityOutputsOk) && skillYaml.length > 0 && intents.length > 0 && plans.length > 0 ? 100 : 0,
      '错误恢复能力': buildReport.build_completion?.verification_status === 'passed' && asArray(buildReport.next_steps).length > 0 && nonActiveCapabilities.every(hasNonActiveExplanation) ? 100 : 0,
      '执行安全治理': enabledRiskCapabilities.length === 0 && disabledRiskCapabilities.every((capability) => capability.runtimeCallable !== true) ? 100 : 0,
    };

    const taskCoverageChecks = [
      hasCapability(enabledCapabilities, /browse (?:public|catalog) (?:categories|collections|navigation|rankings|tags)/iu),
      hasCapability(enabledCapabilities, /open (?:public|catalog).*detail|view product detail/iu),
      hasCapability(enabledCapabilities, /profile|author/iu),
      hasCapability(enabledCapabilities, /read public (?:catalog )?metadata/iu),
      searchRequired ? hasCapability(enabledCapabilities, /search (?:public|catalog) content/iu) : true,
      seedCoverageOk,
      capabilityCoverageOk,
    ];
    const intentDispatchOk = enabledIntents.every((intent) => enabledIds.has(intent.capabilityId));
    const multiStepOk = taskCoverageChecks.every(Boolean)
      && enabledCapabilities.filter((capability) => /browse|open|read|search|view/iu.test(capability.name)).length >= 3;
    const contextFieldsOk = enabledCapabilities.every((capability) => capabilityOutputsOk(capability)
      && capabilityPlanOk(capability, plansByCapabilityId)
      && asArray((capability.executionPlan ?? plansByCapabilityId.get(capability.id))?.steps).some((step) => normalizeText(step?.url) || normalizeText(step?.selector) || normalizeText(step?.kind)));
    const e2eOk = buildReport.build_completion?.current_updated === true
      && buildReport.build_completion?.registry_registered === true
      && buildReport.build_completion?.verification_status === 'passed'
      && generatedSiteRegistry?.skills?.[0]?.verificationStatus === 'passed';
    const safetyCompliant = enabledRiskCapabilities.length === 0
      && buildReport.privacy_summary?.sanitized_reports === true
      && buildReport.private_content_saved !== true
      && buildReport.browser_state_saved !== true
      && runtimeExecutionReport.sideEffectFailed !== true;

    const taskScores = {
      '用户意图覆盖率': scoreRatio(taskCoverageChecks.filter(Boolean).length, taskCoverageChecks.length),
      '意图分发准确率': intentDispatchOk ? 100 : 0,
      '多步任务规划质量': multiStepOk ? 100 : 0,
      '能力组合成功率': multiStepOk && contextFieldsOk ? 100 : 0,
      '上下文传递正确率': contextFieldsOk ? 100 : 0,
      '端到端任务完成率': e2eOk ? 100 : 0,
      '任务结果质量': e2eOk && skillYaml.length > 0 && allCapabilities.length > 0 && siteCapabilitiesEntry !== null ? 100 : 0,
      '失败解释与修复建议': nonActiveCapabilities.every(hasNonActiveExplanation) && asArray(buildReport.next_steps).length > 0 ? 100 : 0,
      '任务级安全合规': safetyCompliant ? 100 : 0,
    };

    const discoveryLayerScore = weightedAverage(discoveryScores, DISCOVERY_WEIGHTS);
    const executionLayerScore = weightedAverage(executionScores, EXECUTION_WEIGHTS);
    const taskLayerScore = weightedAverage(taskScores, TASK_WEIGHTS);
    const rawTotalScore = Math.round((
      discoveryLayerScore * LAYER_WEIGHTS.discovery
      + executionLayerScore * LAYER_WEIGHTS.execution
      + taskLayerScore * LAYER_WEIGHTS.task
    ) * 100 / 100) / 100;

    const hardCaps = buildHardCaps({
      enabledCapabilities,
      allCapabilities,
      apiSummary: buildReport.api_discovery_summary,
      nonActiveCapabilities,
      plansByCapabilityId,
      buildReport,
    });
    const totalScore = applyHardCaps(rawTotalScore, hardCaps);
    const passed = totalScore === 100 && hardCaps.length === 0;

    return {
      siteKey: target.siteKey,
      siteId: target.siteId,
      url: target.url,
      registryKey,
      registryHost: registryEntry?.host ?? null,
      buildId: buildReport.build_id,
      skillId: buildReport.skill_id,
      skillDir: currentDir.replace(/\\/gu, '/'),
      artifactDir: path.dirname(artifactReportPath).replace(/\\/gu, '/'),
      resultStatus: buildReport.result_status,
      verificationStatus: verificationReport.status,
      pageReconciliationStatus: pageReconciliation.status ?? null,
      enabledRuntimeCapabilityCount: enabledCapabilities.length,
      nonRuntimeOrDisabledCapabilityCount: nonActiveCapabilities.length,
      disabledRiskCapabilityCount: disabledRiskCapabilities.length,
      businessCoverage: {
        status: seedsDoc?.businessCoverageSeedSelection?.status ?? 'missing',
        configuredGroupCount: seedsDoc?.businessCoverageSeedSelection?.configuredGroupCount ?? 0,
        selectedGroups: asArray(seedsDoc?.businessCoverageSeedSelection?.selectedGroups),
        missingRequiredGroups: asArray(seedsDoc?.businessCoverageSeedSelection?.missingRequiredGroups),
        seedCoverageOk,
        capabilityCoverageOk,
      },
      warningCodes: asArray(buildReport.privacy_summary?.warning_codes),
      discoveryScores,
      executionScores,
      taskScores,
      layerScores: {
        '能力发现层': discoveryLayerScore,
        '能力执行层': executionLayerScore,
        '任务完成层': taskLayerScore,
      },
      totalScore,
      hardCaps,
      passed,
    };
  };
}

function metricSummary(sites, layerName, scoreKey) {
  const metricNames = Object.keys(sites[0]?.[scoreKey] ?? {});
  return metricNames.map((metricName) => {
    const minScore = Math.min(...sites.map((site) => site[scoreKey][metricName]));
    return { layerName, metricName, minScore };
  });
}

function renderMarkdown(report) {
  const siteRows = report.sites.map((site) => [
    site.siteKey,
    site.buildId,
    site.enabledRuntimeCapabilityCount,
    site.businessCoverage.selectedGroups.length,
    site.businessCoverage.missingRequiredGroups.join(', ') || '-',
    site.nonRuntimeOrDisabledCapabilityCount,
    site.layerScores['能力发现层'].toFixed(2),
    site.layerScores['能力执行层'].toFixed(2),
    site.layerScores['任务完成层'].toFixed(2),
    site.totalScore.toFixed(2),
    site.passed ? '通过' : '未通过',
  ]);
  const metricRows = [
    ...metricSummary(report.sites, '能力发现层', 'discoveryScores'),
    ...metricSummary(report.sites, '能力执行层', 'executionScores'),
    ...metricSummary(report.sites, '任务完成层', 'taskScores'),
  ];
  const hardCaps = report.sites.flatMap((site) => site.hardCaps.map((cap) => ({ siteKey: site.siteKey, ...cap })));
  return [
    '# SiteForge 成人目录站点三层评估报告',
    '',
    `生成时间：${report.generatedAt}`,
    '',
    '## 结论',
    '',
    `本轮覆盖 ${report.sites.length} 个目标站点。所有站点均已生成 current skill，verification 通过，最终总分最低值为 ${report.minimumTotalScore.toFixed(2)}。`,
    '',
    hardCaps.length === 0
      ? '硬性封顶审计：未触发。报告只汇总站点、能力、计划、证据与安全状态，不写入页面正文、简介、评论、详情样本或私密材料。'
      : `硬性封顶审计：触发 ${hardCaps.length} 项，需要继续修复。`,
    '',
    '## 站点评分',
    '',
    '| 站点 | buildId | 可执行能力 | 业务覆盖组 | 缺失业务组 | 非可执行/禁用能力 | 能力发现层 | 能力执行层 | 任务完成层 | 总分 | 状态 |',
    '|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---|',
    ...siteRows.map((row) => `| ${row.join(' | ')} |`),
    '',
    '## 指标最低分',
    '',
    '| 层级 | 指标 | 全站最低分 |',
    '|---|---|---:|',
    ...metricRows.map((row) => `| ${row.layerName} | ${row.metricName} | ${row.minScore.toFixed(2)} |`),
    '',
    '## 安全边界',
    '',
    '- 可执行能力均为公开只读或受控只读，运行要求限制为 GET/HEAD、无 cookie 材料、无表单提交、保存材料为 sanitized_summary_only。',
    '- 提交、发布、删除、联系、下载、支付等高风险动作若被发现，均保持非 runtime-callable 或 blocked，不参与可执行能力评分。',
    '- 未发现 active API 虚构；无回放验证的网络/API 捕获仅保留为 debug/candidate 或空发现摘要。',
    '',
    '## 任务完成口径',
    '',
    '端到端任务完成率按 current 更新、registry 注册、verification passed、skill 生成、只读能力可规划和安全门禁共同判定。搜索任务只在注册表声明 `search-content` 的站点上作为必需能力评分。',
    '',
  ].join('\n');
}

async function main() {
  const registryConfig = await readJson('config/site-registry.json');
  const siteCapabilityConfig = await readJson('config/site-capabilities.json');
  const sites = [];
  for (const target of TARGETS) {
    sites.push(await evaluateSite(target, registryConfig, siteCapabilityConfig)());
  }
  const minimumTotalScore = Math.min(...sites.map((site) => site.totalScore));
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    scoring: {
      layerWeights: LAYER_WEIGHTS,
      discoveryWeights: DISCOVERY_WEIGHTS,
      executionWeights: EXECUTION_WEIGHTS,
      taskWeights: TASK_WEIGHTS,
      hardCapRules: [
        '正文、简介、评论、章节内容被提升为能力：总分封顶 60',
        '只读内容被误判为发布、提交、删除、支付：总分封顶 65',
        '虚构程序接口能力：总分封顶 70',
        'active 能力大量没有执行计划：总分封顶 75',
        '无法解释失败原因：总分封顶 80',
        '敏感材料进入报告、技能或能力字段：不合格',
      ],
    },
    minimumTotalScore,
    allPassed: sites.every((site) => site.passed) && minimumTotalScore === 100,
    sites,
  };
  await mkdir(GOAL_DIR, { recursive: true });
  await writeFile(EVALUATION_JSON, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await writeFile(EVALUATION_MD, renderMarkdown(report), 'utf8');
  process.stdout.write(`${JSON.stringify({
    allPassed: report.allPassed,
    minimumTotalScore: report.minimumTotalScore,
    json: EVALUATION_JSON.replace(/\\/gu, '/'),
    markdown: EVALUATION_MD.replace(/\\/gu, '/'),
  }, null, 2)}\n`);
  if (!report.allPassed) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  process.stderr.write(`${error?.stack ?? error?.message ?? String(error)}\n`);
  process.exitCode = 1;
});
