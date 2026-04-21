// @ts-check

import path from 'node:path';
import { buildBilibiliStateAttributeFacts } from '../../../sites/bilibili/kb/augmentation.mjs';
import { enrichBilibiliPageFactsForState } from '../../../sites/bilibili/model/surfacing.mjs';
import { resolveCanonicalSiteKey } from '../../../sites/core/site-identity.mjs';
import { displayIntentName, normalizeDisplayLabel } from '../../../sites/core/terminology.mjs';
import {
  cleanText,
  compactSlug,
  compareNullableStrings,
  toArray,
  toPosixPath,
  uniqueSortedPaths,
  uniqueSortedStrings,
} from '../../../shared/normalize.mjs';
import { KB_DIRS, KB_FILES } from './layout.mjs';

export function isBilibiliKnowledgeBase(baseUrl, options = {}) {
  return resolveCanonicalSiteKey({
    baseUrl,
    inputUrl: baseUrl,
    siteContext: options.siteContext ?? null,
    siteProfile: options.siteProfile ?? null,
    siteProfileDocument: options.siteProfile ?? null,
    host: options.host ?? null,
  }) === 'bilibili';
}

function collectDocByIntent(documents) {
  const map = new Map();
  for (const document of toArray(documents)) {
    if (document?.intentId) {
      map.set(document.intentId, document);
    }
  }
  return map;
}

export function summarizeRiskEvidence(rule) {
  return {
    stateIds: uniqueSortedStrings(rule?.evidence?.stateIds),
    edgeIds: uniqueSortedStrings(rule?.evidence?.edgeIds),
    docPaths: uniqueSortedPaths(rule?.evidence?.docPaths),
  };
}

function kbSourceRef(rawResolver, absolutePath, step, kind, label) {
  const relative = rawResolver(absolutePath);
  if (!relative) {
    return null;
  }
  return {
    step,
    kind,
    label,
    path: relative,
  };
}

function createPageDescriptor({
  pageId,
  kind,
  title,
  summary,
  pagePath,
  sourceRefs = [],
  relatedIds = [],
  attributes = {},
}) {
  return {
    pageId,
    kind,
    title,
    summary,
    path: toPosixPath(pagePath),
    sourceRefs: sourceRefs.filter(Boolean).sort((left, right) => compareNullableStrings(left.path, right.path)),
    relatedIds: uniqueSortedStrings(relatedIds),
    attributes,
  };
}

export function buildDataModel(artifacts, options = {}) {
  const elements = toArray(artifacts.analysis.elementsDocument?.elements);
  const states = toArray(artifacts.analysis.statesDocument?.states).map((state) => ({
    ...state,
    pageFacts: state?.pageFacts ? { ...state.pageFacts } : state?.pageFacts ?? null,
  }));
  const transitionNodes = toArray(artifacts.analysis.transitionsDocument?.nodes);
  const edges = toArray(artifacts.analysis.transitionsDocument?.edges);
  const siteProfile = artifacts.analysis.siteProfileDocument ?? null;
  const intents = toArray(artifacts.abstraction.intentsDocument?.intents);
  const actions = toArray(artifacts.abstraction.actionsDocument?.actions);
  const decisionRules = toArray(artifacts.abstraction.decisionTableDocument?.rules);
  const capabilityMatrix = artifacts.abstraction.capabilityMatrixDocument ?? null;
  const aliasEntries = toArray(artifacts.nlEntry.aliasLexiconDocument?.entries);
  const slotIntents = toArray(artifacts.nlEntry.slotSchemaDocument?.intents);
  const utterancePatterns = toArray(artifacts.nlEntry.utterancePatternsDocument?.patterns);
  const entryRules = toArray(artifacts.nlEntry.entryRulesDocument?.rules);
  const clarificationRules = toArray(artifacts.nlEntry.clarificationRulesDocument?.rules);
  const documents = toArray(artifacts.docs.manifest?.documents);
  const riskCategories = toArray(artifacts.governance.riskTaxonomyDocument?.categories);
  const approvalRules = toArray(artifacts.governance.approvalRulesDocument?.rules);
  const recoveryRules = toArray(artifacts.governance.recoveryRulesDocument?.rules);

  if (isBilibiliKnowledgeBase(artifacts.baseUrl, {
    siteContext: options.siteContext ?? null,
    siteProfile: siteProfile,
  })) {
    const statesById = new Map(states.map((state) => [state.stateId, state]));
    const outgoingEdgesByStateId = new Map();
    for (const edge of edges) {
      if (!edge?.fromState) {
        continue;
      }
      if (!outgoingEdgesByStateId.has(edge.fromState)) {
        outgoingEdgesByStateId.set(edge.fromState, []);
      }
      outgoingEdgesByStateId.get(edge.fromState).push(edge);
    }
    for (const state of states) {
      state.pageFacts = enrichBilibiliPageFactsForState(state, {
        outgoingEdges: outgoingEdgesByStateId.get(state.stateId) ?? [],
        statesById,
      });
      state.pageFactHighlights = buildBilibiliStateAttributeFacts(state.pageFacts);
    }
  }

  return {
    elements,
    states,
    transitionNodes,
    edges,
    siteProfile,
    intents,
    actions,
    decisionRules,
    capabilityMatrix,
    aliasEntries,
    slotIntents,
    utterancePatterns,
    entryRules,
    clarificationRules,
    documents,
    riskCategories,
    approvalRules,
    recoveryRules,
  };
}

export function finalizeDataModel(model) {
  const elementsById = new Map(model.elements.map((element) => [element.elementId, element]));
  const statesById = new Map(model.states.map((state) => [state.stateId, state]));
  const intentsById = new Map(model.intents.map((intent) => [intent.intentId, intent]));
  const actionsById = new Map(model.actions.map((action) => [action.actionId, action]));
  const edgesByObservedStateId = new Map(model.edges.map((edge) => [edge.observedStateId, edge]));
  const decisionRulesByIntentId = new Map();
  const entryRulesByIntentId = new Map();
  const patternsByIntentId = new Map();
  const slotSchemasByIntentId = new Map();
  const docsByIntentId = collectDocByIntent(model.documents);
  const pageTitleTokens = new Set();
  const membersById = new Map();
  const elementStatesByStateId = new Map();
  const edgeIdsByIntentId = new Map();

  for (const aliasEntry of model.aliasEntries) {
    if (aliasEntry.type === 'page') {
      for (const alias of toArray(aliasEntry.aliases)) {
        if (alias?.text) {
          pageTitleTokens.add(cleanText(alias.text));
        }
      }
    }
  }

  for (const element of model.elements) {
    for (const member of toArray(element.members)) {
      membersById.set(member.memberId, { ...member, elementId: element.elementId, elementKind: element.kind });
    }
  }

  for (const state of model.states) {
    const map = new Map();
    for (const elementState of toArray(state.elementStates)) {
      map.set(elementState.elementId, elementState);
    }
    elementStatesByStateId.set(state.stateId, map);
  }

  for (const rule of model.decisionRules) {
    const list = decisionRulesByIntentId.get(rule.intentId) ?? [];
    list.push(rule);
    decisionRulesByIntentId.set(rule.intentId, list);
  }
  for (const list of decisionRulesByIntentId.values()) {
    list.sort((left, right) => compareNullableStrings(left.ruleId, right.ruleId));
  }

  for (const entryRule of model.entryRules) {
    const list = entryRulesByIntentId.get(entryRule.intentId) ?? [];
    list.push(entryRule);
    entryRulesByIntentId.set(entryRule.intentId, list);
  }
  for (const list of entryRulesByIntentId.values()) {
    list.sort((left, right) => (left.priority ?? 0) - (right.priority ?? 0) || compareNullableStrings(left.entryRuleId, right.entryRuleId));
  }

  for (const pattern of model.utterancePatterns) {
    const list = patternsByIntentId.get(pattern.intentId) ?? [];
    list.push(pattern);
    patternsByIntentId.set(pattern.intentId, list);
  }
  for (const list of patternsByIntentId.values()) {
    list.sort((left, right) => (left.priority ?? 0) - (right.priority ?? 0) || compareNullableStrings(left.patternId, right.patternId));
  }

  for (const slotSchema of model.slotIntents) {
    slotSchemasByIntentId.set(slotSchema.intentId, slotSchema);
  }

  for (const intent of model.intents) {
    edgeIdsByIntentId.set(intent.intentId, new Set(uniqueSortedStrings(intent?.evidence?.edgeIds)));
  }

  const approvalRulesByRiskCode = new Map();
  for (const rule of model.approvalRules) {
    const list = approvalRulesByRiskCode.get(rule.riskCode) ?? [];
    list.push(rule);
    approvalRulesByRiskCode.set(rule.riskCode, list);
  }
  for (const list of approvalRulesByRiskCode.values()) {
    list.sort((left, right) => compareNullableStrings(left.approvalRuleId, right.approvalRuleId));
  }

  const recoveryRulesByType = new Map();
  for (const rule of model.recoveryRules) {
    const list = recoveryRulesByType.get(rule.exceptionType) ?? [];
    list.push(rule);
    recoveryRulesByType.set(rule.exceptionType, list);
  }
  for (const list of recoveryRulesByType.values()) {
    list.sort((left, right) => compareNullableStrings(left.recoveryRuleId, right.recoveryRuleId));
  }

  return {
    ...model,
    elementsById,
    statesById,
    intentsById,
    actionsById,
    edgesByObservedStateId,
    decisionRulesByIntentId,
    entryRulesByIntentId,
    patternsByIntentId,
    slotSchemasByIntentId,
    docsByIntentId,
    membersById,
    elementStatesByStateId,
    edgeIdsByIntentId,
    approvalRulesByRiskCode,
    recoveryRulesByType,
    pageTitleTokens: uniqueSortedStrings([...pageTitleTokens]),
  };
}

export function buildPageDescriptors(context) {
  const {
    generatedAt,
    artifacts,
    model,
    rawResolver,
    siteContext,
    kbAugmentation,
  } = context;

  const inputUrl = model.inputUrl ?? model.baseUrl ?? null;
  const elementsById = new Map(toArray(model.elements).map((element) => [element.elementId, element]));
  const normalizeSiteLabel = (value, options = {}) => normalizeDisplayLabel(value, {
    siteContext,
    inputUrl,
    ...options,
  }) || cleanText(value);

  const pages = [];
  const addPage = (descriptor) => {
    pages.push({
      ...descriptor,
      updatedAt: generatedAt,
    });
  };

  addPage(createPageDescriptor({
    pageId: 'page_readme',
    kind: 'readme',
    title: '知识库总览',
    summary: '知识库入口页，概览站点、状态、意图、风险与索引入口。',
    pagePath: KB_FILES.readme,
    sourceRefs: [
      kbSourceRef(rawResolver, artifacts.docs.manifestPath, 'step-6-docs', 'manifest', '第六步文档清单'),
      kbSourceRef(rawResolver, artifacts.governance.riskTaxonomyPath, 'step-7-governance', 'json', '第七步风险分类'),
    ],
    relatedIds: ['page_overview_site', 'page_concept_interaction_model', 'page_concept_governance'],
  }));

  addPage(createPageDescriptor({
    pageId: 'page_overview_site',
    kind: 'overview',
    title: '站点总览',
    summary: '站点级知识页，汇总页面范围、状态规模、意图数量和活跃证据集。',
    pagePath: KB_FILES.siteOverview,
    sourceRefs: [
      kbSourceRef(rawResolver, artifacts.capture.manifestPath, 'step-1-capture', 'manifest', '初始采集清单'),
      kbSourceRef(rawResolver, artifacts.analysis.manifestPath, 'step-3-analysis', 'manifest', '状态分析清单'),
      kbSourceRef(rawResolver, artifacts.docs.manifestPath, 'step-6-docs', 'manifest', '文档清单'),
    ],
    relatedIds: ['page_comparison_state_coverage'],
    attributes: kbAugmentation?.buildOverviewAttributes?.(model, context) ?? {},
  }));

  addPage(createPageDescriptor({
    pageId: 'page_concept_interaction_model',
    kind: 'concept',
    title: '交互模型',
    summary: '解释元素、状态、转移、意图与动作原语之间的建模关系。',
    pagePath: KB_FILES.interactionModel,
    sourceRefs: [
      kbSourceRef(rawResolver, artifacts.analysis.elementsPath, 'step-3-analysis', 'json', 'elements.json'),
      kbSourceRef(rawResolver, artifacts.analysis.statesPath, 'step-3-analysis', 'json', 'states.json'),
      kbSourceRef(rawResolver, artifacts.abstraction.intentsPath, 'step-4-abstraction', 'json', 'intents.json'),
    ],
    relatedIds: ['page_concept_nl_entry', 'page_comparison_state_coverage'],
  }));

  addPage(createPageDescriptor({
    pageId: 'page_concept_nl_entry',
    kind: 'concept',
    title: '自然语言入口',
    summary: '解释用户表达如何解析为意图、槽位、规则与计划。',
    pagePath: KB_FILES.nlEntry,
    sourceRefs: [
      kbSourceRef(rawResolver, artifacts.nlEntry.manifestPath, 'step-5-nl-entry', 'manifest', '自然语言入口清单'),
      kbSourceRef(rawResolver, artifacts.nlEntry.entryRulesPath, 'step-5-nl-entry', 'json', 'entry-rules.json'),
    ],
    relatedIds: ['page_concept_interaction_model', 'page_concept_governance'],
  }));

  addPage(createPageDescriptor({
    pageId: 'page_concept_governance',
    kind: 'concept',
    title: '治理与恢复',
    summary: '解释恢复规则、审批规则、风险分类与安全边界。',
    pagePath: KB_FILES.governance,
    sourceRefs: [
      kbSourceRef(rawResolver, artifacts.governance.riskTaxonomyPath, 'step-7-governance', 'json', 'risk-taxonomy.json'),
      kbSourceRef(rawResolver, artifacts.governance.recoveryRulesPath, 'step-7-governance', 'json', 'recovery-rules.json'),
      kbSourceRef(rawResolver, artifacts.governance.approvalRulesPath, 'step-7-governance', 'json', 'approval-rules.json'),
    ],
    relatedIds: ['page_concept_interaction_model', 'page_concept_nl_entry'],
  }));

  addPage(createPageDescriptor({
    pageId: 'page_comparison_state_coverage',
    kind: 'comparison',
    title: '状态覆盖对比',
    summary: '汇总 concrete states、观测边、已建模意图和风险治理覆盖情况。',
    pagePath: KB_FILES.stateCoverage,
    sourceRefs: [
      kbSourceRef(rawResolver, artifacts.analysis.transitionsPath, 'step-3-analysis', 'json', 'transitions.json'),
      kbSourceRef(rawResolver, artifacts.abstraction.decisionTablePath, 'step-4-abstraction', 'json', 'decision-table.json'),
      kbSourceRef(rawResolver, artifacts.docs.manifestPath, 'step-6-docs', 'manifest', '文档清单'),
    ],
    relatedIds: ['page_overview_site', 'page_concept_interaction_model'],
  }));

  for (const state of model.states) {
    const stateSlug = compactSlug(`${state.stateId}-${state.stateName}`, state.stateId, 72);
    const stateLabel = normalizeSiteLabel(cleanText(state.stateName) || cleanText(state.title), {
      url: state.finalUrl,
      pageType: state.pageType,
      queryText: state.trigger?.queryText,
    });
    addPage(createPageDescriptor({
      pageId: `page_state_${state.stateId}`,
      kind: 'state',
      title: `${state.stateId} ${stateLabel}`,
      summary: `${state.sourceStatus === 'initial' ? 'Initial state' : 'Captured state'}, URL: ${state.finalUrl}`,
      pagePath: path.join(KB_DIRS.wiki, 'states', `${stateSlug}.md`),
      sourceRefs: [
        kbSourceRef(rawResolver, state.files?.html, 'step-2-expanded', 'html', `${state.stateId} HTML`),
        kbSourceRef(rawResolver, state.files?.snapshot, 'step-2-expanded', 'snapshot', `${state.stateId} snapshot`),
        kbSourceRef(rawResolver, state.files?.screenshot, 'step-2-expanded', 'screenshot', `${state.stateId} screenshot`),
        kbSourceRef(rawResolver, state.files?.manifest, 'step-2-expanded', 'manifest', `${state.stateId} manifest`),
      ],
      relatedIds: uniqueSortedStrings(
        toArray(state.elementStates).map((elementState) => `page_element_${elementState.elementId}`)
      ),
      attributes: {
        stateId: state.stateId,
        finalUrl: state.finalUrl,
        sourceStatus: state.sourceStatus,
        dedupKey: state.dedupKey,
        ...(kbAugmentation?.buildStateAttributes?.(state, model, context) ?? {}),
      },
    }));
  }

  for (const element of model.elements) {
    const elementSlug = compactSlug(`${element.elementId}-${element.elementName}`, element.elementId, 96);
    const elementLabel = normalizeSiteLabel(cleanText(element.elementName), {
      kind: element.kind,
    });
    addPage(createPageDescriptor({
      kind: 'element',
      pageId: `page_element_${element.elementId}`,
      title: elementLabel,
      summary: `${element.kind}, members ${toArray(element.members).length}.`,
      pagePath: path.join(KB_DIRS.wiki, 'elements', `${elementSlug}.md`),
      sourceRefs: [
        kbSourceRef(rawResolver, artifacts.analysis.elementsPath, 'step-3-analysis', 'json', 'elements.json'),
      ],
      relatedIds: uniqueSortedStrings(toArray(element.evidence?.stateIds).map((stateId) => `page_state_${stateId}`)),
      attributes: {
        elementId: element.elementId,
        elementKind: element.kind,
        memberCount: toArray(element.members).length,
      },
    }));
  }

  for (const intent of model.intents) {
    const intentSlug = compactSlug(`${intent.intentId}-${intent.intentName}`, intent.intentId, 96);
    const intentDoc = model.docsByIntentId.get(intent.intentId);
    const intentLabel = displayIntentName(intent.intentType, siteContext, inputUrl);
    const sourceElementLabel = normalizeSiteLabel(intent.sourceElementName, {
      kind: elementsById.get(intent.elementId)?.kind,
    });
    addPage(createPageDescriptor({
      pageId: `page_intent_${intent.intentId}`,
      kind: 'intent',
      title: intentLabel,
      summary: `${intentLabel}, applies to ${sourceElementLabel}.`,
      pagePath: path.join(KB_DIRS.wiki, 'intents', `${intentSlug}.md`),
      sourceRefs: [
        kbSourceRef(rawResolver, artifacts.abstraction.intentsPath, 'step-4-abstraction', 'json', 'intents.json'),
        kbSourceRef(rawResolver, intentDoc?.path, 'step-6-docs', 'markdown', '第六步意图文档'),
      ],
      relatedIds: [
        `page_element_${intent.elementId}`,
        `page_flow_${intent.intentId}`,
        ...uniqueSortedStrings(toArray(intent.evidence?.stateIds).map((stateId) => `page_state_${stateId}`)),
      ],
      attributes: {
        intentId: intent.intentId,
        intentType: intent.intentType,
        actionId: intent.actionId,
        stateField: intent.stateField,
      },
    }));

    addPage(createPageDescriptor({
      pageId: `page_flow_${intent.intentId}`,
      kind: 'flow',
      title: `${intentLabel}流程`,
      summary: '汇总入口表达、状态约束、主路径步骤、成功判定、异常恢复与审批要求。',
      pagePath: path.join(KB_DIRS.wiki, 'flows', `${intentSlug}.md`),
      sourceRefs: [
        kbSourceRef(rawResolver, artifacts.nlEntry.entryRulesPath, 'step-5-nl-entry', 'json', 'entry-rules.json'),
        kbSourceRef(rawResolver, artifacts.abstraction.decisionTablePath, 'step-4-abstraction', 'json', 'decision-table.json'),
        kbSourceRef(rawResolver, intentDoc?.path, 'step-6-docs', 'markdown', '第六步流程文档'),
        kbSourceRef(rawResolver, artifacts.governance.recoveryRulesPath, 'step-7-governance', 'json', 'recovery-rules.json'),
        kbSourceRef(rawResolver, artifacts.governance.approvalRulesPath, 'step-7-governance', 'json', 'approval-rules.json'),
      ],
      relatedIds: [
        `page_intent_${intent.intentId}`,
        `page_element_${intent.elementId}`,
        ...uniqueSortedStrings(toArray(intent.evidence?.stateIds).map((stateId) => `page_state_${stateId}`)),
      ],
      attributes: {
        intentId: intent.intentId,
        intentType: intent.intentType,
        actionId: intent.actionId,
      },
    }));
  }

  for (const risk of model.riskCategories) {
    const approvalRules = model.approvalRulesByRiskCode.get(risk.riskCode) ?? [];
    const evidence = approvalRules.flatMap((rule) => summarizeRiskEvidence(rule).stateIds);
    addPage(createPageDescriptor({
      pageId: `page_risk_${risk.riskCode}`,
      kind: 'risk',
      title: `${cleanText(risk.title)} risk`,
      summary: `${risk.severity} risk; default recovery: ${risk.defaultRecovery}.`,
      pagePath: path.join(KB_DIRS.wiki, 'risks', `${compactSlug(risk.riskCode, 'risk', 64)}.md`),
      sourceRefs: [
        kbSourceRef(rawResolver, artifacts.governance.riskTaxonomyPath, 'step-7-governance', 'json', 'risk-taxonomy.json'),
        kbSourceRef(rawResolver, artifacts.governance.approvalRulesPath, 'step-7-governance', 'json', 'approval-rules.json'),
      ],
      relatedIds: uniqueSortedStrings(evidence.map((stateId) => `page_state_${stateId}`)),
      attributes: {
        riskCode: risk.riskCode,
        severity: risk.severity,
        approvalRequired: risk.approvalRequired,
        observedStateCount: uniqueSortedStrings(evidence).length,
        observedEdgeCount: uniqueSortedStrings(approvalRules.flatMap((rule) => summarizeRiskEvidence(rule).edgeIds)).length,
      },
    }));
  }

  pages.sort((left, right) => compareNullableStrings(left.path, right.path));
  return pages;
}
