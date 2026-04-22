// @ts-check

import {
  access,
  cp,
  mkdir,
  readdir,
  readFile,
  rm,
} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { initializeCliUtf8, writeJsonStdout } from '../../../infra/cli.mjs';
import { appendJsonLine, appendTextFile, ensureDir, pathExists, readJsonFile, writeJsonFile, writeJsonLines, writeTextFile } from '../../../infra/io.mjs';
import { markdownLink, renderTable as sharedRenderTable } from '../../../shared/markdown.mjs';
import { mdEscape } from '../../../shared/markdown.mjs';
import { cleanText, compactSlug, compareNullableStrings, firstNonEmpty, hostFromUrl, normalizeUrlNoFragment, normalizeWhitespace, relativePath, sanitizeHost, toArray, toPosixPath, uniqueSortedStrings } from '../../../shared/normalize.mjs';
import { buildError, buildWarning } from '../../../shared/wiki.mjs';
import { firstExistingPath, kbAbsolute, listDirectories, relativeToKb, resolveMaybeRelative } from '../../../shared/wiki.mjs';
import { readSiteContext } from '../../../sites/catalog/context.mjs';
import { writeKnowledgeBaseSchemaFiles } from './schema-files.mjs';
import { buildLintSummary, classifyGapWarnings, writeKnowledgeBaseLintReports } from './lint-report.mjs';
import { resolveCompileArtifacts } from './artifacts.mjs';
import { buildDataModel, buildPageDescriptors, finalizeDataModel, summarizeRiskEvidence } from './data-model.mjs';
import { resolveKnowledgeBaseAugmentation } from '../../../sites/core/kb-augmentation.mjs';
import {
  buildKbLayout as buildKbLayoutImpl,
  buildSourceIndexDocument as buildSourceIndexDocumentImpl,
  buildSourceRunIds as buildSourceRunIdsImpl,
  candidateSortKey as candidateSortKeyImpl,
  formatTimestampForDir as formatTimestampForDirImpl,
  KB_DIRS,
  KB_FILES,
  MANIFEST_NAMES,
  mergeCompileOptions as mergeCompileOptionsImpl,
  mergeLintOptions as mergeLintOptionsImpl,
  REQUIRED_DIRS,
  REQUIRED_FILES,
  ROOT_DIRS,
} from './layout.mjs';
import { syncKnowledgeBaseSiteMetadata } from './site-metadata.mjs';
import { publishKnowledgeBase } from './publish-kb.mjs';

const DEFAULT_COMPILE_OPTIONS = {
  kbDir: undefined,
  captureDir: undefined,
  expandedStatesDir: undefined,
  bookContentDir: undefined,
  analysisDir: undefined,
  analysisManifestPath: undefined,
  abstractionDir: undefined,
  abstractionManifestPath: undefined,
  nlEntryDir: undefined,
  nlEntryManifestPath: undefined,
  docsDir: undefined,
  docsManifestPath: undefined,
  governanceDir: undefined,
  strict: true,
};

const DEFAULT_LINT_OPTIONS = {
  kbDir: undefined,
  reportDir: undefined,
  failOnWarnings: false,
};

const KBMETA_REGEX = /<!--\s*KBMETA\s*([\s\S]*?)-->/u;
const MARKDOWN_LINK_REGEX = /\[[^\]]*?\]\(([^)]+)\)/gu;

function renderTable(headers, rows) {
  if (!rows.length) {
    return '_None_';
  }
  return sharedRenderTable(headers, rows);
}

function formatTimestampForDir(date = new Date()) {
  return formatTimestampForDirImpl(date);
}

async function candidateSortKey(dirPath, generatedAt) {
  return candidateSortKeyImpl(dirPath, generatedAt);
}

function mergeCompileOptions(options) {
  return mergeCompileOptionsImpl(DEFAULT_COMPILE_OPTIONS, options);
}

function mergeLintOptions(options) {
  return mergeLintOptionsImpl(DEFAULT_LINT_OPTIONS, options);
}

function parseBooleanFlag(value, current) {
  if (value === undefined) {
    return current;
  }
  if (value === 'true' || value === '1') {
    return true;
  }
  if (value === 'false' || value === '0') {
    return false;
  }
  return current;
}

function buildKbLayout(baseUrl, explicitKbDir) {
  return buildKbLayoutImpl(baseUrl, explicitKbDir);
}

async function initializeKnowledgeBaseDirs(layout) {
  await ensureDir(layout.kbDir);
  await ensureDir(layout.rawDir);
  await ensureDir(layout.logDir);
  await rm(layout.wikiDir, { recursive: true, force: true });
  await rm(layout.schemaDir, { recursive: true, force: true });
  await rm(layout.indexDir, { recursive: true, force: true });
  await rm(layout.reportsDir, { recursive: true, force: true });
  await ensureDir(layout.wikiDir);
  await ensureDir(layout.schemaDir);
  await ensureDir(layout.indexDir);
  await ensureDir(layout.reportsDir);
}

function buildSourceRunIds(sources) {
  return buildSourceRunIdsImpl(sources);
}

async function appendKbEvent(kbDir, eventType, status, message, extra = {}) {
  const timestamp = new Date().toISOString();
  const event = {
    prefix: 'KBLOG',
    timestamp,
    eventType,
    status,
    kbDir,
    sourceRunIds: extra.sourceRunIds ?? {},
    message,
    ...extra,
  };
  await appendJsonLine(path.join(kbDir, KB_FILES.events), event);
  await appendTextFile(path.join(kbDir, KB_FILES.activity), `KBLOG|${timestamp}|${eventType}|${status}|${message}\n`);
  return event;
}

async function copyRawSources(kbDir, sources) {
  const copies = [];
  for (const source of sources) {
    const stepDir = path.join(kbDir, KB_DIRS.raw, source.step, source.runId);
    const reused = await pathExists(stepDir);
    if (!reused) {
      await ensureDir(path.dirname(stepDir));
      await cp(source.dir, stepDir, { recursive: true });
    }
    copies.push({
      ...source,
      rawDir: stepDir,
      rawDirRelative: relativeToKb(kbDir, stepDir),
      reused,
    });
  }
  return copies;
}

function createRawResolver(kbDir, copiedSources) {
  const sorted = [...copiedSources].sort((left, right) => right.dir.length - left.dir.length);
  return (absolutePath) => {
    if (!absolutePath) {
      return null;
    }
    const resolved = path.resolve(String(absolutePath));
    for (const source of sorted) {
      if (resolved === source.dir || resolved.startsWith(`${source.dir}${path.sep}`)) {
        return relativeToKb(kbDir, path.join(source.rawDir, path.relative(source.dir, resolved)));
      }
    }
    return null;
  };
}

function buildSourceIndexDocument(inputUrl, baseUrl, generatedAt, copiedSources) {
  const copiedSourceItems = copiedSources.map((source) => ({
    ...source,
    rawDir: source.rawDirRelative,
  }));
  return buildSourceIndexDocumentImpl(null, inputUrl, baseUrl, generatedAt, copiedSourceItems);
}

function describeElementState(elementState) {
  if (!elementState) {
    return '-';
  }
  if (elementState.kind === 'tab-group') {
    return elementState.value?.activeMemberLabel ?? elementState.value?.activeMemberId ?? '-';
  }
  if (elementState.kind === 'expanded-toggle') {
    return `expanded=${elementState.value?.expanded}; targetVisible=${elementState.value?.targetVisible}`;
  }
  if (elementState.kind === 'details-toggle' || elementState.kind === 'menu-button' || elementState.kind === 'dialog-open') {
    return `open=${elementState.value?.open}; targetVisible=${elementState.value?.targetVisible}`;
  }
  return JSON.stringify(elementState.value ?? {});
}

function createKbMeta(meta) {
  return `<!-- KBMETA\n${JSON.stringify(meta, null, 2)}\n-->`;
}

function pageRefById(pagesById, pageId, fromPath) {
  const page = pagesById.get(pageId);
  if (!page) {
    return `\`${pageId}\``;
  }
  if (!page.path || !fromPath) {
    return mdEscape(page.title);
  }
  return markdownLink(page.title, fromPath, page.path);
}

function buildPagesById(pages) {
  return new Map(pages.map((page) => [page.pageId, page]));
}

function collectPageIdsByKind(pages, kind) {
  return pages.filter((page) => page.kind === kind).map((page) => page.pageId);
}

function renderSourceRefList(page, currentPagePath) {
  if (!page.sourceRefs.length) {
    return '- \u65e0';
  }
  return page.sourceRefs
    .map((ref) => `- ${markdownLink(ref.label ?? ref.kind, currentPagePath, ref.path)} (${ref.kind})`)
    .join('\n');
}

function renderRelatedPageList(page, pagesById, currentPagePath) {
  if (!page.relatedIds.length) {
    return '- \u65e0';
  }
  return page.relatedIds.map((pageId) => `- ${pageRefById(pagesById, pageId, currentPagePath)}`).join('\n');
}

function renderAliasesList(model, memberId) {
  const aliases = [];
  for (const entry of model.aliasEntries) {
    if (entry.canonicalId === memberId) {
      for (const alias of toArray(entry.aliases)) {
        if (alias?.text) {
          aliases.push(alias.text);
        }
      }
    }
  }
  return uniqueSortedStrings(aliases);
}

function renderReadmePage(page, context, pagesById) {
  const { model, artifacts } = context;
  const sections = [
    '# \u77e5\u8bc6\u5e93\u603b\u89c8',
    '',
    '\u8fd9\u4e2a\u77e5\u8bc6\u5e93\u5c06 1-7 \u6b65\u7684\u5206\u6790\u4ea7\u7269\u7f16\u8bd1\u4e3a\u53ef\u7ef4\u62a4\u3001\u53ef\u5bfc\u822a\u3001\u53ef\u8ffd\u6eaf\u7684\u672c\u5730\u77e5\u8bc6\u5e95\u5ea7\u3002',
    '',
    '## \u7ad9\u70b9\u6458\u8981',
    '',
    `- \u5165\u53e3 URL\uff1a\`${artifacts.inputUrl}\``,
    `- \u57fa\u51c6 URL\uff1a\`${artifacts.baseUrl}\``,
    `- \u72b6\u6001\u6570\uff1a${model.states.length}`,
    `- \u5143\u7d20\u6570\uff1a${model.elements.length}`,
    `- \u610f\u56fe\u6570\uff1a${model.intents.length}`,
    `- \u98ce\u9669\u5206\u7c7b\u6570\uff1a${model.riskCategories.length}`,
    '',
    '## \u5bfc\u822a',
    '',
    `- ${pageRefById(pagesById, 'page_overview_site', page.path)}`,
    `- ${pageRefById(pagesById, 'page_concept_interaction_model', page.path)}`,
    `- ${pageRefById(pagesById, 'page_concept_nl_entry', page.path)}`,
    `- ${pageRefById(pagesById, 'page_concept_governance', page.path)}`,
    `- ${pageRefById(pagesById, 'page_comparison_state_coverage', page.path)}`,
    '',
    '## \u7c7b\u522b\u5165\u53e3',
    `- \u72b6\u6001\u9875\uff1a${collectPageIdsByKind([...pagesById.values()], 'state').length} \u9879`,
    `- \u5143\u7d20\u9875\uff1a${collectPageIdsByKind([...pagesById.values()], 'element').length} \u9879`,
    `- \u610f\u56fe\u9875\uff1a${collectPageIdsByKind([...pagesById.values()], 'intent').length} \u9879`,
    `- \u6d41\u7a0b\u9875\uff1a${collectPageIdsByKind([...pagesById.values()], 'flow').length} \u9879`,
    `- \u98ce\u9669\u9875\uff1a${collectPageIdsByKind([...pagesById.values()], 'risk').length} \u9879`,
    '',
    '## \u8bc1\u636e\u5f15\u7528',
    '',
    renderSourceRefList(page, page.path),
    '',
    '## \u5173\u8054\u9875\u9762',
    '',
    renderRelatedPageList(page, pagesById, page.path),
  ];
  return sections.join('\n');
}

function renderOverviewPage(page, context, pagesById) {
  const { model, artifacts, kbAugmentation } = context;
  const initialState = model.states.find((state) => state.sourceStatus === 'initial') ?? model.states[0];
  const actionables = model.intents.flatMap((intent) => toArray(intent.targetDomain?.actionableValues)).length;
  const augmentationSections = kbAugmentation?.renderOverviewSections?.({
    model,
    page,
    pagesById,
    renderTable,
    mdEscape,
  }) ?? [];
  const rows = model.intents.map((intent) => ({
    intent: pageRefById(pagesById, `page_intent_${intent.intentId}`, page.path),
    type: intent.intentType,
    element: pageRefById(pagesById, `page_element_${intent.elementId}`, page.path),
    actionableTargets: toArray(intent.targetDomain?.actionableValues).length,
  }));
  const searchFactRows = model.states
    .filter((state) => state.pageFactHighlights?.searchFamily)
    .map((state) => ({
      state: pageRefById(pagesById, `page_state_${state.stateId}`, page.path),
      family: state.pageFactHighlights.searchFamily,
      query: cleanText(state.pageFacts?.queryText) || '-',
      firstResultType: cleanText(state.pageFactHighlights.firstResultContentType) || '-',
    }));
  const identityFactRows = model.states
    .filter((state) => state.pageFactHighlights?.bvid || state.pageFactHighlights?.authorMid)
    .map((state) => ({
      state: pageRefById(pagesById, `page_state_${state.stateId}`, page.path),
      semanticPageType: cleanText(state.semanticPageType ?? state.pageType) || '-',
      bvid: cleanText(state.pageFactHighlights?.bvid) || '-',
      authorMid: cleanText(state.pageFactHighlights?.authorMid) || '-',
      contentType: cleanText(state.pageFactHighlights?.contentType) || '-',
    }));
  const featuredCardRows = model.states
    .filter((state) => (
      toArray(state.pageFactHighlights?.featuredContentCards).length > 0
      || Number.isFinite(state.pageFactHighlights?.featuredAuthorCount)
      || toArray(state.pageFactHighlights?.featuredAuthors).length > 0
    ))
    .map((state) => ({
      state: pageRefById(pagesById, `page_state_${state.stateId}`, page.path),
      cards: toArray(state.pageFactHighlights?.featuredContentCards)
        .map((card) => {
          const title = cleanText(card?.title) || cleanText(card?.bvid) || cleanText(card?.url) || '-';
          const suffix = [cleanText(card?.contentType), cleanText(card?.authorMid)].filter(Boolean).join(' / ');
          return suffix ? `${title} (${suffix})` : title;
        })
        .slice(0, 3)
        .join('; '),
      contentCount: String(state.pageFactHighlights?.featuredContentCardCount ?? toArray(state.pageFactHighlights?.featuredContentCards).length),
      contentComplete: state.pageFactHighlights?.featuredContentComplete === true ? 'yes' : 'no',
      authors: toArray(state.pageFactHighlights?.featuredAuthorCards)
        .map((author) => cleanText(author?.name) || cleanText(author?.mid) || cleanText(author?.url) || '-')
        .filter(Boolean)
        .slice(0, 3)
        .join('; '),
      authorCount: String(state.pageFactHighlights?.featuredAuthorCount ?? toArray(state.pageFactHighlights?.featuredAuthors).length),
      authorComplete: state.pageFactHighlights?.featuredAuthorComplete === true ? 'yes' : 'no',
    }));
  return [
    '# \u7ad9\u70b9\u603b\u89c8',
    '',
    '## \u7ad9\u70b9\u4fe1\u606f',
    '',
    `- Host\uff1a\`${sanitizeHost(hostFromUrl(artifacts.baseUrl) ?? 'unknown-host')}\``,
    `- \u57fa\u51c6 URL\uff1a\`${artifacts.baseUrl}\``,
    `- \u521d\u59cb\u6807\u9898\uff1a${mdEscape(initialState?.title ?? artifacts.capture.manifest?.title ?? '-')}`,
    '',
    '## \u89c4\u6a21\u6458\u8981',
    '',
    `- concrete states\uff1a${model.states.length}`,
    `- observed edges\uff1a${model.edges.length}`,
    `- \u5143\u7d20\u7ec4\uff1a${model.elements.length}`,
    `- \u52a8\u4f5c\u539f\u8bed\uff1a${model.actions.length}`,
    `- \u610f\u56fe\uff1a${model.intents.length}`,
    `- \u53ef\u6267\u884c\u76ee\u6807\u503c\uff1a${actionables}`,
    '',
    '## \u610f\u56fe\u603b\u89c8',
    '',
    renderTable(['Intent', 'Type', 'Element', 'Actionable Targets'], rows),
    '',
    '## Observed Page Facts',
    '',
    searchFactRows.length > 0
      ? renderTable(['State', 'Search Family', 'Query', 'First Result Type'], searchFactRows)
      : '- No search-family facts observed.',
    '',
    identityFactRows.length > 0
      ? renderTable(['State', 'Semantic Page Type', 'BV', 'UP Mid', 'Content Type'], identityFactRows)
      : '- No identity facts observed.',
    '',
    featuredCardRows.length > 0
      ? renderTable(['State', 'Featured Cards', 'Content Count', 'Content Complete', 'Featured Authors', 'Author Count', 'Author Complete'], featuredCardRows)
      : '- No featured content cards observed.',
    '',
    ...augmentationSections,
    '## \u5173\u952e\u5165\u53e3',
    '',
    `- ${pageRefById(pagesById, 'page_comparison_state_coverage', page.path)}`,
    `- ${pageRefById(pagesById, 'page_concept_interaction_model', page.path)}`,
    '',
    '## \u8bc1\u636e\u5f15\u7528',
    '',
    renderSourceRefList(page, page.path),
  ].join('\n');
}

function renderInteractionModelPage(page, context, pagesById) {
  const { model } = context;
  const elementRows = model.elements.map((element) => ({
    element: pageRefById(pagesById, `page_element_${element.elementId}`, page.path),
    kind: element.kind,
    members: toArray(element.members).length,
    states: uniqueSortedStrings(element.evidence?.stateIds).length,
  }));
  const intentRows = model.intents.map((intent) => ({
    intent: pageRefById(pagesById, `page_intent_${intent.intentId}`, page.path),
    stateField: intent.stateField,
    action: intent.actionId,
    evidenceEdges: uniqueSortedStrings(intent.evidence?.edgeIds).length,
  }));
  return [
    '# \u4ea4\u4e92\u6a21\u578b',
    '',
    '\u672c\u9875\u8bf4\u660e\u4ece DOM / \u72b6\u6001\u8bc1\u636e\u5230\u5143\u7d20\u3001\u72b6\u6001\u3001\u8f6c\u79fb\u3001\u610f\u56fe\u548c\u52a8\u4f5c\u539f\u8bed\u7684\u5efa\u6a21\u94fe\u8def\u3002',
    '',
    '## \u5143\u7d20',
    '',
    renderTable(['Element', 'Kind', 'Members', 'Evidence States'], elementRows),
    '',
    '## \u610f\u56fe\u6620\u5c04',
    '',
    renderTable(['Intent', 'State Field', 'Action', 'Evidence Edges'], intentRows),
    '',
    '## \u76f8\u5173\u9875\u9762',
    '',
    renderRelatedPageList(page, pagesById, page.path),
    '',
    '## \u8bc1\u636e\u5f15\u7528',
    '',
    renderSourceRefList(page, page.path),
  ].join('\n');
}

function renderInteractionModelPageEnhanced(page, context, pagesById) {
  const { model } = context;
  const elementRows = model.elements.map((element) => ({
    element: pageRefById(pagesById, `page_element_${element.elementId}`, page.path),
    kind: element.kind,
    members: toArray(element.members).length,
    states: uniqueSortedStrings(element.evidence?.stateIds).length,
  }));
  const intentRows = model.intents.map((intent) => ({
    intent: pageRefById(pagesById, `page_intent_${intent.intentId}`, page.path),
    stateField: intent.stateField,
    action: intent.actionId,
    evidenceEdges: uniqueSortedStrings(intent.evidence?.edgeIds).length,
  }));
  const siteProfileRows = model.siteProfile
    ? [{
      primaryArchetype: model.siteProfile.primaryArchetype ?? '-',
      archetypes: uniqueSortedStrings(model.siteProfile.archetypes).join(', ') || '-',
      capabilities: uniqueSortedStrings(model.siteProfile.capabilityFamilies).join(', ') || '-',
      pageTypes: uniqueSortedStrings(model.siteProfile.pageTypes).join(', ') || '-',
      semanticPageTypes: uniqueSortedStrings(model.siteProfile.semanticPageTypes).join(', ') || '-',
      confidence: model.siteProfile.confidence ?? '-',
    }]
    : [];
  const capabilityRows = toArray(model.capabilityMatrix?.capabilities).map((capability) => ({
    intent: capability.intentId ?? '-',
    family: capability.capabilityFamily ?? '-',
    primitive: capability.actionId ?? '-',
    actionableTargets: toArray(capability.actionableTargets).length,
  }));
  return [
    '# \u4ea4\u4e92\u6a21\u578b',
    '',
    '\u672c\u9875\u6c47\u603b\u7ad9\u70b9\u539f\u578b\u3001\u80fd\u529b\u77e9\u9635\u3001\u5143\u7d20\u7ec4\u3001\u610f\u56fe\u548c\u52a8\u4f5c\u539f\u8bed\uff0c\u8bf4\u660e\u5f53\u524d\u7ad9\u70b9\u7684\u53ef\u6267\u884c\u4ea4\u4e92\u8fb9\u754c\u3002',
    '',
    '## Site Profile',
    '',
    siteProfileRows.length > 0
      ? renderTable(['Primary Archetype', 'Archetypes', 'Capability Families', 'Page Types', 'Semantic Page Types', 'Confidence'], siteProfileRows)
      : 'No site-profile.json available.',
    '',
    '## \u5143\u7d20',
    '',
    renderTable(['Element', 'Kind', 'Members', 'Evidence States'], elementRows),
    '',
    '## \u610f\u56fe\u6620\u5c04',
    '',
    renderTable(['Intent', 'State Field', 'Action', 'Evidence Edges'], intentRows),
    '',
    '## Capability Matrix',
    '',
    capabilityRows.length > 0
      ? renderTable(['Intent', 'Capability Family', 'Primitive', 'Actionable Targets'], capabilityRows)
      : 'No capability-matrix.json available.',
    '',
    '## \u76f8\u5173\u9875\u9762',
    '',
    renderRelatedPageList(page, pagesById, page.path),
    '',
    '## \u8bc1\u636e\u5f15\u7528',
    '',
    renderSourceRefList(page, page.path),
  ].join('\n');
}

function renderNlEntryPage(page, context) {
  const { model } = context;
  const patternRows = model.utterancePatterns.map((pattern) => ({
    intentId: pattern.intentId ?? '-',
    type: pattern.patternType,
    priority: pattern.priority ?? '-',
    regex: `\`${pattern.regex}\``,
  }));
  const ruleRows = model.entryRules.map((rule) => ({
    intentId: rule.intentId,
    mode: rule.outcome?.mode ?? '-',
    targetResolution: rule.resolution?.targetResolution ?? '-',
    decisionRules: toArray(rule.outcome?.decisionRuleIds).length,
  }));
  return [
    '# \u81ea\u7136\u8bed\u8a00\u5165\u53e3',
    '',
    '\u672c\u9875\u6c47\u603b\u522b\u540d\u8bcd\u5178\u3001\u69fd\u4f4d\u5b9a\u4e49\u3001\u8868\u8fbe\u6a21\u5f0f\u4e0e\u5165\u53e3\u89c4\u5219\uff0c\u8bf4\u660e\u7528\u6237\u8bed\u53e5\u5982\u4f55\u88ab\u6620\u5c04\u5230\u53ef\u6267\u884c\u8ba1\u5212\u3002',
    '',
    '## \u8868\u8fbe\u6a21\u5f0f',
    '',
    renderTable(['Intent', 'Pattern Type', 'Priority', 'Regex'], patternRows),
    '',
    '## \u5165\u53e3\u89c4\u5219',
    '',
    renderTable(['Intent', 'Mode', 'Target Resolution', 'Decision Rules'], ruleRows),
    '',
    '## \u6f84\u6e05\u89c4\u5219',
    '',
    renderTable(
      ['Exception', 'Strategy', 'Approval'],
      model.clarificationRules.map((rule) => ({
        exception: rule.case,
        strategy: rule.response?.mode ?? '-',
        approval: 'false',
      }))
    ),
    '',
    '## \u8bc1\u636e\u5f15\u7528',
    '',
    renderSourceRefList(page, page.path),
  ].join('\n');
}

function renderGovernanceConceptPage(page, context) {
  const { model } = context;
  return [
    '# \u6cbb\u7406\u4e0e\u6062\u590d',
    '',
    '\u672c\u9875\u6c47\u603b\u6062\u590d\u89c4\u5219\u3001\u5ba1\u6279\u89c4\u5219\u548c\u98ce\u9669\u5206\u7c7b\uff0c\u5b9a\u4e49\u6267\u884c\u65f6\u7684\u5b89\u5168\u8fb9\u754c\u3002',
    '',
    '## \u98ce\u9669\u5206\u7c7b',
    '',
    renderTable(
      ['Risk', 'Severity', 'Approval Required', 'Default Recovery'],
      model.riskCategories.map((risk) => ({
        risk: risk.riskCode,
        severity: risk.severity,
        approvalRequired: String(risk.approvalRequired),
        defaultRecovery: risk.defaultRecovery,
      }))
    ),
    '',
    '## \u6062\u590d\u89c4\u5219',
    '',
    renderTable(
      ['Exception', 'Severity', 'Strategy', 'Retryable'],
      model.recoveryRules.map((rule) => ({
        exception: rule.exceptionType,
        severity: rule.severity,
        strategy: rule.recover?.strategy ?? '-',
        retryable: String(Boolean(rule.recover?.retryable)),
      }))
    ),
    '',
    '## \u5ba1\u6279\u89c4\u5219',
    '',
    renderTable(
      ['Risk', 'Checkpoint', 'Approver', 'Deny By Default'],
      model.approvalRules.map((rule) => ({
        risk: rule.riskCode,
        checkpoint: rule.approval?.checkpointLabel ?? '-',
        approver: rule.approval?.approver ?? '-',
        denyByDefault: String(Boolean(rule.approval?.denyByDefault)),
      }))
    ),
    '',
    '## \u8bc1\u636e\u5f15\u7528',
    '',
    renderSourceRefList(page, page.path),
  ].join('\n');
}

function renderStateCoveragePage(page, context, pagesById) {
  const { model } = context;
  const stateRows = model.states.map((state) => ({
    state: pageRefById(pagesById, `page_state_${state.stateId}`, page.path),
    type: state.sourceStatus,
    url: `\`${state.finalUrl}\``,
    elementStates: toArray(state.elementStates).length,
  }));
  const edgeRows = model.edges.map((edge) => ({
    from: pageRefById(pagesById, `page_state_${edge.fromState}`, page.path),
    to: edge.toState ? pageRefById(pagesById, `page_state_${edge.toState}`, page.path) : '-',
    outcome: edge.outcome,
    trigger: cleanText(edge.trigger?.label ?? edge.stateName ?? edge.observedStateId),
  }));
  return [
    '# \u72b6\u6001\u8986\u76d6\u5bf9\u6bd4',
    '',
    '## States',
    '',
    renderTable(['State', 'Type', 'Final URL', 'Element States'], stateRows),
    '',
    '## Observed Transitions',
    '',
    renderTable(['From', 'To', 'Outcome', 'Trigger'], edgeRows),
    '',
    '## \u8bc1\u636e\u5f15\u7528',
    '',
    renderSourceRefList(page, page.path),
  ].join('\n');
}

function renderStatePage(page, context, pagesById) {
  const { model } = context;
  const stateId = page.attributes.stateId;
  const state = model.statesById.get(stateId);
  const edge = model.edgesByObservedStateId.get(stateId);
  const elementRows = toArray(state.elementStates).map((elementState) => ({
    element: pageRefById(pagesById, `page_element_${elementState.elementId}`, page.path),
    kind: elementState.kind,
    value: describeElementState(elementState),
  }));
  const factRows = [];
  if (state.semanticPageType) {
    factRows.push({ field: 'Semantic Page Type', value: `\`${state.semanticPageType}\`` });
  }
  if (state.pageFactHighlights?.searchFamily) {
    factRows.push({ field: 'Search Family', value: `\`${state.pageFactHighlights.searchFamily}\`` });
  }
  if (state.pageFactHighlights?.bvid) {
    factRows.push({ field: 'BV', value: `\`${state.pageFactHighlights.bvid}\`` });
  }
  if (state.pageFactHighlights?.authorMid) {
    factRows.push({ field: 'UP Mid', value: `\`${state.pageFactHighlights.authorMid}\`` });
  }
  if (state.pageFactHighlights?.contentType) {
    factRows.push({ field: 'Content Type', value: `\`${state.pageFactHighlights.contentType}\`` });
  }
  if (state.pageFactHighlights?.authorSubpage) {
    factRows.push({ field: 'Author Subpage', value: `\`${state.pageFactHighlights.authorSubpage}\`` });
  }
  if (state.pageFactHighlights?.featuredAuthorCount) {
    factRows.push({ field: 'Featured Author Count', value: String(state.pageFactHighlights.featuredAuthorCount) });
  }
  if (typeof state.pageFactHighlights?.featuredAuthorComplete === 'boolean') {
    factRows.push({ field: 'Featured Author Complete', value: state.pageFactHighlights.featuredAuthorComplete ? 'yes' : 'no' });
  }
  const featuredAuthors = toArray(state.pageFactHighlights?.featuredAuthors).map((author) => {
    const parts = [
      author?.name ?? null,
      author?.mid ? `MID ${author.mid}` : null,
    ].filter(Boolean);
    return parts.join(' | ');
  }).filter(Boolean);
  if (featuredAuthors.length > 0) {
    factRows.push({ field: 'Featured Authors', value: featuredAuthors.map((value) => mdEscape(value)).join(' ; ') });
  }
  const featuredAuthorCards = toArray(state.pageFactHighlights?.featuredAuthorCards).map((author) => ({
    name: mdEscape(cleanText(author?.name) || '-'),
    mid: cleanText(author?.mid) || '-',
    url: mdEscape(cleanText(author?.url) || '-'),
    authorSubpage: cleanText(author?.authorSubpage) || cleanText(state.pageFactHighlights?.authorSubpage) || '-',
  }));
  if (state.pageFactHighlights?.categoryName) {
    factRows.push({ field: 'Category', value: mdEscape(state.pageFactHighlights.categoryName) });
  }
  if (state.pageFactHighlights?.categoryPath) {
    factRows.push({ field: 'Category Path', value: `\`${state.pageFactHighlights.categoryPath}\`` });
  }
  if (state.pageFactHighlights?.featuredContentCardCount) {
    factRows.push({ field: 'Featured Content Count', value: String(state.pageFactHighlights.featuredContentCardCount) });
  }
  if (typeof state.pageFactHighlights?.featuredContentComplete === 'boolean') {
    factRows.push({ field: 'Featured Content Complete', value: state.pageFactHighlights.featuredContentComplete ? 'yes' : 'no' });
  }
  const featuredCards = toArray(state.pageFactHighlights?.featuredContentCards).map((card) => ({
    title: mdEscape(cleanText(card?.title) || cleanText(card?.bvid) || cleanText(card?.url) || '-'),
    contentType: cleanText(card?.contentType) || '-',
    bvid: cleanText(card?.bvid) || '-',
    authorMid: cleanText(card?.authorMid) || '-',
  }));
  return [
    `# ${mdEscape(page.title)}`,
    '',
    '## \u72b6\u6001\u4fe1\u606f',
    '',
    `- Source Status\uff1a\`${state.sourceStatus}\``,
    `- Final URL\uff1a\`${state.finalUrl}\``,
    `- Title\uff1a${mdEscape(state.title ?? '-')}`,
    `- Captured At\uff1a\`${state.capturedAt ?? '-'}\``,
    edge ? `- \u8fdb\u5165\u89e6\u53d1\uff1a${mdEscape(edge.trigger?.label ?? edge.stateName ?? edge.observedStateId)}` : '- \u8fdb\u5165\u89e6\u53d1\uff1a\u521d\u59cb\u72b6\u6001',
    '',
    '## \u5143\u7d20\u72b6\u6001',
    '',
    renderTable(['Element', 'Kind', 'Value'], elementRows),
    '',
    '## \u5173\u8054\u9875\u9762',
    '',
    renderRelatedPageList(page, pagesById, page.path),
    '',
    '## \u8bc1\u636e\u5f15\u7528',
    '',
    renderSourceRefList(page, page.path),
  ].join('\n');
}

function renderStatePageEnhancedDraft(page, context, pagesById) {
  const { model } = context;
  const stateId = page.attributes.stateId;
  const state = model.statesById.get(stateId);
  const edge = model.edgesByObservedStateId.get(stateId);
  const elementRows = toArray(state.elementStates).map((elementState) => ({
    element: pageRefById(pagesById, `page_element_${elementState.elementId}`, page.path),
    kind: elementState.kind,
    value: describeElementState(elementState),
  }));
  const factRows = [];
  if (state.semanticPageType) {
    factRows.push({ field: 'Semantic Page Type', value: `\`${state.semanticPageType}\`` });
  }
  if (state.pageFactHighlights?.searchFamily) {
    factRows.push({ field: 'Search Family', value: `\`${state.pageFactHighlights.searchFamily}\`` });
  }
  if (state.pageFacts?.queryText) {
    factRows.push({ field: 'Search Query', value: mdEscape(state.pageFacts.queryText) });
  }
  if (state.pageFactHighlights?.bvid) {
    factRows.push({ field: 'BV', value: `\`${state.pageFactHighlights.bvid}\`` });
  }
  if (state.pageFactHighlights?.authorMid) {
    factRows.push({ field: 'UP Mid', value: `\`${state.pageFactHighlights.authorMid}\`` });
  }
  if (state.pageFactHighlights?.contentType) {
    factRows.push({ field: 'Content Type', value: `\`${state.pageFactHighlights.contentType}\`` });
  }
  if (state.pageFactHighlights?.authorSubpage) {
    factRows.push({ field: 'Author Subpage', value: `\`${state.pageFactHighlights.authorSubpage}\`` });
  }
  if (state.pageFactHighlights?.featuredAuthorCount) {
    factRows.push({ field: 'Featured Author Count', value: String(state.pageFactHighlights.featuredAuthorCount) });
  }
  if (typeof state.pageFactHighlights?.featuredAuthorComplete === 'boolean') {
    factRows.push({ field: 'Featured Author Complete', value: state.pageFactHighlights.featuredAuthorComplete ? 'yes' : 'no' });
  }
  const featuredAuthors = toArray(state.pageFactHighlights?.featuredAuthors).map((author) => {
    const parts = [
      author?.name ?? null,
      author?.mid ? `MID ${author.mid}` : null,
    ].filter(Boolean);
    return parts.join(' | ');
  }).filter(Boolean);
  if (featuredAuthors.length > 0) {
    factRows.push({ field: 'Featured Authors', value: featuredAuthors.map((value) => mdEscape(value)).join(' ; ') });
  }
  if (state.pageFactHighlights?.categoryName) {
    factRows.push({ field: 'Category', value: mdEscape(state.pageFactHighlights.categoryName) });
  }
  if (state.pageFactHighlights?.categoryPath) {
    factRows.push({ field: 'Category Path', value: `\`${state.pageFactHighlights.categoryPath}\`` });
  }
  if (state.pageFactHighlights?.featuredContentCardCount) {
    factRows.push({ field: 'Featured Content Count', value: String(state.pageFactHighlights.featuredContentCardCount) });
  }
  if (typeof state.pageFactHighlights?.featuredContentComplete === 'boolean') {
    factRows.push({ field: 'Featured Content Complete', value: state.pageFactHighlights.featuredContentComplete ? 'yes' : 'no' });
  }
  if (Number.isFinite(state.pageFacts?.resultCount)) {
    factRows.push({ field: 'Result Count', value: String(state.pageFacts.resultCount) });
  }
  const featuredCards = toArray(state.pageFactHighlights?.featuredContentCards).map((card) => ({
    title: mdEscape(cleanText(card?.title) || cleanText(card?.bvid) || cleanText(card?.url) || '-'),
    contentType: cleanText(card?.contentType) || '-',
    bvid: cleanText(card?.bvid) || '-',
    authorMid: cleanText(card?.authorMid) || '-',
  }));
  return [
    `# ${mdEscape(page.title)}`,
    '',
    '## \u72b6\u6001\u4fe1\u606f',
    '',
    `- Source Status\uff1a\`${state.sourceStatus}\``,
    `- Final URL\uff1a\`${state.finalUrl}\``,
    `- Title\uff1a${mdEscape(state.title ?? '-')}`,
    `- Captured At\uff1a\`${state.capturedAt ?? '-'}\``,
    edge ? `- \u8fdb\u5165\u89e6\u53d1\uff1a${mdEscape(edge.trigger?.label ?? edge.stateName ?? edge.observedStateId)}` : '- \u8fdb\u5165\u89e6\u53d1\uff1a\u521d\u59cb\u72b6\u6001',
    '',
    ...(factRows.length > 0
      ? [
          '## Page facts',
          '',
          renderTable(['Field', 'Value'], factRows),
          '',
        ]
      : []),
    ...(featuredCards.length > 0
      ? [
          '## Featured content cards',
          '',
          renderTable(['Title', 'Content Type', 'BV', 'UP Mid'], featuredCards),
          '',
        ]
      : []),
    '## \u5143\u7d20\u72b6\u6001',
    '',
    renderTable(['Element', 'Kind', 'Value'], elementRows),
    '',
    '## \u5173\u8054\u9875\u9762',
    '',
    renderRelatedPageList(page, pagesById, page.path),
    '',
    '## 璇佹嵁寮曠敤',
    '',
    renderSourceRefList(page, page.path),
  ].join('\n');
}

function renderObservedFeaturedCardSections(pageFactHighlights, renderTable, mdEscape) {
  const authorRows = toArray(pageFactHighlights?.featuredAuthorCards).map((author) => ({
    name: mdEscape(cleanText(author?.name) || '-'),
    mid: cleanText(author?.mid) || '-',
    url: mdEscape(cleanText(author?.url) || '-'),
    authorSubpage: cleanText(author?.authorSubpage) || cleanText(pageFactHighlights?.authorSubpage) || '-',
  }));
  const contentRows = toArray(pageFactHighlights?.featuredContentCards).map((card) => ({
    title: mdEscape(cleanText(card?.title) || cleanText(card?.bvid) || cleanText(card?.url) || '-'),
    contentType: cleanText(card?.contentType) || '-',
    bvid: cleanText(card?.bvid) || '-',
    authorMid: cleanText(card?.authorMid) || '-',
  }));

  return [
    ...(contentRows.length > 0
      ? [
          '## Featured content cards',
          '',
          renderTable(['Title', 'Content Type', 'BV', 'UP Mid'], contentRows),
          '',
        ]
      : []),
    ...(authorRows.length > 0
      ? [
          '## Featured author cards',
          '',
          renderTable(['Name', 'MID', 'Author URL', 'Author Subpage'], authorRows),
          '',
        ]
      : []),
  ];
}

function renderStatePageEnhanced(page, context, pagesById) {
  const { model, kbAugmentation } = context;
  const stateId = page.attributes.stateId;
  const state = model.statesById.get(stateId);
  const edge = model.edgesByObservedStateId.get(stateId);
  const elementRows = toArray(state.elementStates).map((elementState) => ({
    element: pageRefById(pagesById, `page_element_${elementState.elementId}`, page.path),
    kind: elementState.kind,
    value: describeElementState(elementState),
  }));
  const factRows = [];
  if (state.semanticPageType) {
    factRows.push({ field: 'Semantic Page Type', value: `\`${state.semanticPageType}\`` });
  }
  if (state.pageFactHighlights?.searchFamily) {
    factRows.push({ field: 'Search Family', value: `\`${state.pageFactHighlights.searchFamily}\`` });
  }
  if (state.pageFacts?.queryText) {
    factRows.push({ field: 'Search Query', value: mdEscape(state.pageFacts.queryText) });
  }
  if (Number.isFinite(state.pageFacts?.resultCount)) {
    factRows.push({ field: 'Result Count', value: String(state.pageFacts.resultCount) });
  }
  if (state.pageFactHighlights?.bvid) {
    factRows.push({ field: 'BV', value: `\`${state.pageFactHighlights.bvid}\`` });
  }
  if (state.pageFactHighlights?.authorMid) {
    factRows.push({ field: 'UP Mid', value: `\`${state.pageFactHighlights.authorMid}\`` });
  }
  if (state.pageFactHighlights?.contentType) {
    factRows.push({ field: 'Content Type', value: `\`${state.pageFactHighlights.contentType}\`` });
  }
  if (state.pageFactHighlights?.authorSubpage) {
    factRows.push({ field: 'Author Subpage', value: `\`${state.pageFactHighlights.authorSubpage}\`` });
  }
  if (state.pageFactHighlights?.featuredAuthorCount) {
    factRows.push({ field: 'Featured Author Count', value: String(state.pageFactHighlights.featuredAuthorCount) });
  }
  if (typeof state.pageFactHighlights?.featuredAuthorComplete === 'boolean') {
    factRows.push({ field: 'Featured Author Complete', value: state.pageFactHighlights.featuredAuthorComplete ? 'yes' : 'no' });
  }
  const featuredAuthors = toArray(state.pageFactHighlights?.featuredAuthors).map((author) => {
    const parts = [
      author?.name ?? null,
      author?.mid ? `MID ${author.mid}` : null,
    ].filter(Boolean);
    return parts.join(' | ');
  }).filter(Boolean);
  if (featuredAuthors.length > 0) {
    factRows.push({ field: 'Featured Authors', value: featuredAuthors.map((value) => mdEscape(value)).join(' ; ') });
  }
  if (state.pageFactHighlights?.featuredContentCardCount) {
    factRows.push({ field: 'Featured Content Count', value: String(state.pageFactHighlights.featuredContentCardCount) });
  }
  if (typeof state.pageFactHighlights?.featuredContentComplete === 'boolean') {
    factRows.push({ field: 'Featured Content Complete', value: state.pageFactHighlights.featuredContentComplete ? 'yes' : 'no' });
  }
  const observedFeaturedCardSections = renderObservedFeaturedCardSections(
    state.pageFactHighlights,
    renderTable,
    mdEscape,
  );
  const augmentationSections = kbAugmentation?.renderStateSections?.({
    model,
    state,
    edge,
    page,
    pagesById,
    renderTable,
    mdEscape,
  }) ?? [];

  return [
    `# ${mdEscape(page.title)}`,
    '',
    '## State Information',
    '',
    `- Source Status: \`${state.sourceStatus}\``,
    `- Final URL: \`${state.finalUrl}\``,
    `- Title: ${mdEscape(state.title ?? '-')}`,
    `- Captured At: \`${state.capturedAt ?? '-'}\``,
    edge ? `- Entry Trigger: ${mdEscape(edge.trigger?.label ?? edge.stateName ?? edge.observedStateId)}` : '- Entry Trigger: initial state',
    '',
    '## Observed Page Facts',
    '',
    factRows.length > 0
      ? renderTable(['Field', 'Value'], factRows)
      : '- No surfaced page facts.',
    '',
    ...observedFeaturedCardSections,
    ...augmentationSections,
    '## Element States',
    '',
    renderTable(['Element', 'Kind', 'Value'], elementRows),
    '',
    '## Related Pages',
    '',
    renderRelatedPageList(page, pagesById, page.path),
    '',
    '## Source References',
    '',
    renderSourceRefList(page, page.path),
  ].join('\n');
}

function renderElementPage(page, context, pagesById) {
  const { model } = context;
  const element = model.elementsById.get(page.attributes.elementId);
  const memberRows = toArray(element.members).map((member) => ({
    memberId: `\`${member.memberId}\``,
    label: mdEscape(member.label ?? '-'),
    controlledTarget: member.controlledTarget ?? '-',
    sourceStates: uniqueSortedStrings(member.sourceStateIds).map((stateId) => pageRefById(pagesById, `page_state_${stateId}`, page.path)).join(', '),
  }));
  return [
    `# ${mdEscape(page.title)}`,
    '',
    '## \u5143\u7d20\u4fe1\u606f',
    '',
    `- Kind\uff1a\`${element.kind}\``,
    `- Group Key\uff1a\`${element.groupKey}\``,
    `- Trigger Kinds\uff1a${uniqueSortedStrings(element.evidence?.triggerKinds).join(', ') || '-'}`,
    '',
    '## \u6210\u5458',
    '',
    renderTable(['Member ID', 'Label', 'Controlled Target', 'Source States'], memberRows),
    '',
    '## \u5173\u8054\u9875\u9762',
    '',
    renderRelatedPageList(page, pagesById, page.path),
    '',
    '## \u8bc1\u636e\u5f15\u7528',
    '',
    renderSourceRefList(page, page.path),
  ].join('\n');
}

function renderIntentPage(page, context, pagesById) {
  const { model } = context;
  const intent = model.intentsById.get(page.attributes.intentId);
  const slotSchema = model.slotSchemasByIntentId.get(intent.intentId);
  const patternRows = (model.patternsByIntentId.get(intent.intentId) ?? []).map((pattern) => ({
    patternType: pattern.patternType,
    priority: pattern.priority ?? '-',
    regex: `\`${pattern.regex}\``,
  }));
  const slotRows = toArray(slotSchema?.slots).map((slot) => ({
    slot: slot.slotName,
    valueType: slot.valueType,
    required: String(Boolean(slot.required)),
    source: slot.source,
  }));
  return [
    `# ${mdEscape(page.title)}`,
    '',
    '## \u610f\u56fe\u5b9a\u4e49',
    '',
    `- Intent Type\uff1a\`${intent.intentType}\``,
    `- Action\uff1a\`${intent.actionId}\``,
    `- State Field\uff1a\`${intent.stateField}\``,
    `- Source Element\uff1a${pageRefById(pagesById, `page_element_${intent.elementId}`, page.path)}`,
    '',
    '## \u69fd\u4f4d',
    '',
    slotRows.length ? renderTable(['Slot', 'Value Type', 'Required', 'Source'], slotRows) : '- \u65e0',
    '',
    '## \u8868\u8fbe\u6a21\u5f0f',
    '',
    patternRows.length ? renderTable(['Pattern Type', 'Priority', 'Regex'], patternRows) : '- \u65e0',
    '',
    '## \u503c\u57df',
    '',
    renderTable(
      ['Value', 'Label', 'Observed', 'Actionable'],
      toArray(intent.targetDomain?.candidateValues).map((value) => ({
        value: `\`${value.value}\``,
        label: mdEscape(value.label ?? '-'),
        observed: String(Boolean(value.observed)),
        actionable: String(toArray(intent.targetDomain?.actionableValues).some((candidate) => candidate.value === value.value)),
      }))
    ),
    '',
    '## \u5173\u8054\u9875\u9762',
    '',
    renderRelatedPageList(page, pagesById, page.path),
    '',
    '## \u8bc1\u636e\u5f15\u7528',
    '',
    renderSourceRefList(page, page.path),
  ].join('\n');
}

function buildIntentSuccessRows(intent, model) {
  const rows = [];
  for (const value of toArray(intent.targetDomain?.observedValues)) {
    rows.push({
      target: value.label ?? String(value.value),
      toStates: uniqueSortedStrings(value.stateIds).join(', ') || '-',
      edges: uniqueSortedStrings(value.edgeIds).join(', ') || '-',
      observed: 'true',
    });
  }
  for (const value of toArray(intent.targetDomain?.candidateValues)) {
    if (rows.some((row) => row.target === (value.label ?? String(value.value)))) {
      continue;
    }
    rows.push({
      target: value.label ?? String(value.value),
      toStates: '-',
      edges: '-',
      observed: String(Boolean(value.observed)),
    });
  }
  rows.sort((left, right) => compareNullableStrings(left.target, right.target));
  return rows;
}

function renderFlowPage(page, context, pagesById) {
  const { model } = context;
  const intentId = page.attributes.intentId;
  const intent = model.intentsById.get(intentId);
  const intentDoc = model.docsByIntentId.get(intentId);
  const decisionRules = model.decisionRulesByIntentId.get(intentId) ?? [];
  const entryRules = model.entryRulesByIntentId.get(intentId) ?? [];
  const actionableValues = toArray(intent.targetDomain?.actionableValues);
  const supportedEdgeIds = new Set(uniqueSortedStrings(intent.evidence?.edgeIds));
  const recoveryRules = model.recoveryRules.filter((rule) => {
    const fallbackIntentIds = uniqueSortedStrings(rule.recover?.fallbackIntentIds);
    return fallbackIntentIds.includes(intentId) || uniqueSortedStrings(rule.evidence?.edgeIds).some((edgeId) => supportedEdgeIds.has(edgeId));
  });
  const approvalRules = model.approvalRules.filter((rule) => {
    const applies = uniqueSortedStrings(rule.appliesTo?.intentIds);
    return applies.includes(intentId);
  });

  const mainPathRows = actionableValues.map((target) => {
    const rulesForTarget = decisionRules.filter((rule) => rule.parameterBinding?.targetMemberId === target.value || rule.parameterBinding?.desiredValue === target.value);
    const actRule = rulesForTarget.find((rule) => rule.phase === 'act');
    const toStateIds = uniqueSortedStrings(actRule?.expected?.toStateIds);
    return {
      target: mdEscape(target.label ?? String(target.value)),
      action: actRule?.then?.actionId ?? intent.actionId,
      toStates: toStateIds.map((stateId) => pageRefById(pagesById, `page_state_${stateId}`, page.path)).join(', ') || '-',
      edgeIds: uniqueSortedStrings(actRule?.expected?.edgeIds).join(', ') || '-',
    };
  });

  const noopRows = decisionRules
    .filter((rule) => rule.phase === 'satisfied')
    .map((rule) => ({
      target: mdEscape(
        toArray(intent.targetDomain?.candidateValues).find((value) =>
          value.value === (rule.parameterBinding?.targetMemberId ?? rule.parameterBinding?.desiredValue)
        )?.label ?? String(rule.parameterBinding?.targetMemberId ?? rule.parameterBinding?.desiredValue ?? '-')
      ),
      when: `${rule.when?.all?.[0]?.field ?? '-'} ${rule.when?.all?.[0]?.op ?? '-'} ${rule.when?.all?.[0]?.value ?? '-'}`,
      toStates: uniqueSortedStrings(rule.expected?.toStateIds).map((stateId) => pageRefById(pagesById, `page_state_${stateId}`, page.path)).join(', ') || '-',
    }));

  const entryRows = entryRules.map((rule) => ({
    mode: rule.outcome?.mode ?? '-',
    resolution: rule.resolution?.targetResolution ?? '-',
    decisionRules: toArray(rule.outcome?.decisionRuleIds).join(', ') || '-',
  }));

  const recoveryRows = recoveryRules.map((rule) => ({
    exception: rule.exceptionType,
    strategy: rule.recover?.strategy ?? '-',
    retryable: String(Boolean(rule.recover?.retryable)),
    approval: String(Boolean(rule.recover?.requiresApproval)),
  }));

  const approvalRows = approvalRules.map((rule) => ({
    riskCode: rule.riskCode,
    checkpoint: rule.approval?.checkpointLabel ?? '-',
    rationale: mdEscape(rule.approval?.rationale ?? '-'),
  }));

  return [
    `# ${mdEscape(page.title)}`,
    '',
    '## \u7528\u6237\u8868\u8fbe',
    '',
    renderTable(
      ['Pattern Type', 'Priority', 'Regex'],
      (model.patternsByIntentId.get(intentId) ?? []).map((pattern) => ({
        patternType: pattern.patternType,
        priority: pattern.priority ?? '-',
        regex: `\`${pattern.regex}\``,
      }))
    ),
    '',
    '## \u9002\u7528\u524d\u63d0',
    `- Current page must resolve source element ${pageRefById(pagesById, `page_element_${intent.elementId}`, page.path)}.`,
    '- Runtime must provide `currentElementState`.',
    '- \u8fd0\u884c\u65f6\u9700\u8981\u63d0\u4f9b `currentElementState`\u3002',
    '',
    '## \u8d77\u59cb\u72b6\u6001',
    '',
    uniqueSortedStrings(intent.evidence?.stateIds).map((stateId) => `- ${pageRefById(pagesById, `page_state_${stateId}`, page.path)}`).join('\n') || '- \u65e0',
    '',
    '## \u76ee\u6807\u72b6\u6001',
    '',
    renderTable(['Target', 'To States', 'Edges', 'Observed'], buildIntentSuccessRows(intent, model)),
    '',
    '## \u4e3b\u8def\u5f84\u6b65\u9aa4',
    '',
    mainPathRows.length ? renderTable(['Target', 'Action', 'To States', 'Edge IDs'], mainPathRows) : '- \u65e0\u5df2\u89c2\u6d4b\u52a8\u4f5c\u8def\u5f84',
    '',
    '## \u5df2\u6ee1\u8db3\u89c4\u5219\uff08noop\uff09',
    '',
    noopRows.length ? renderTable(['Target', 'When', 'To States'], noopRows) : '- \u65e0',
    '',
    '## \u5f02\u5e38\u6062\u590d',
    '',
    recoveryRows.length ? renderTable(['Exception', 'Strategy', 'Retryable', 'Approval'], recoveryRows) : '- \u65e0',
    '',
    '## \u6210\u529f\u4fe1\u53f7',
    '',
    renderTable(['Target', 'To States', 'Edges', 'Observed'], buildIntentSuccessRows(intent, model)),
    '',
    '## \u5ba1\u6279\u8981\u6c42',
    '',
    approvalRows.length ? renderTable(['Risk', 'Checkpoint', 'Rationale'], approvalRows) : '- \u5f53\u524d\u610f\u56fe\u5728\u5df2\u89c2\u6d4b in-domain \u6a21\u578b\u4e2d\u65e0\u9700\u5ba1\u6279\u3002',
    '',
    '## \u5165\u53e3\u89c4\u5219',
    '',
    entryRows.length ? renderTable(['Mode', 'Resolution', 'Decision Rules'], entryRows) : '- \u65e0',
    '## \u5173\u8054\u8bc1\u636e / \u72b6\u6001\u5f15\u7528',
    '',
    (() => {
      const docRef = page.sourceRefs.find((ref) => ref.label === '\u7b2c\u516d\u6b65\u6d41\u7a0b\u6587\u6863');
      return docRef
        ? `- \u7b2c\u516d\u6b65\u6d41\u7a0b\u6587\u6863\uff1a${markdownLink(intentDoc?.title ?? docRef.label ?? '\u7b2c\u516d\u6b65\u6d41\u7a0b\u6587\u6863', page.path, docRef.path)}`
        : '- \u7b2c\u516d\u6b65\u6d41\u7a0b\u6587\u6863\uff1a\u65e0';
    })(),
    '',
    renderSourceRefList(page, page.path),
  ].join('\n');
}

function renderRiskPage(page, context) {
  const { model } = context;
  const riskCode = page.attributes.riskCode;
  const risk = model.riskCategories.find((item) => item.riskCode === riskCode);
  const approvalRules = model.approvalRulesByRiskCode.get(riskCode) ?? [];
  const observedStateIds = uniqueSortedStrings(approvalRules.flatMap((rule) => summarizeRiskEvidence(rule).stateIds));
  const observedEdgeIds = uniqueSortedStrings(approvalRules.flatMap((rule) => summarizeRiskEvidence(rule).edgeIds));
  return [
    `# ${mdEscape(page.title)}`,
    '',
    '## \u98ce\u9669\u5b9a\u4e49',
    '',
    `- Severity\uff1a\`${risk.severity}\``,
    `- Approval Required\uff1a\`${String(Boolean(risk.approvalRequired))}\``,
    `- Default Recovery\uff1a\`${risk.defaultRecovery}\``,
    `- Description\uff1a${mdEscape(risk.description ?? '-')}`,
    '',
    '## \u89e6\u53d1\u6761\u4ef6',
    '',
    renderTable(['Field', 'Values'], [
      { field: 'Action IDs', values: uniqueSortedStrings(risk.triggers?.actionIds).join(', ') || '-' },
      { field: 'Intent Types', values: uniqueSortedStrings(risk.triggers?.intentTypes).join(', ') || '-' },
      { field: 'Keywords', values: uniqueSortedStrings(risk.triggers?.keywords).join(', ') || '-' },
      { field: 'URL Patterns', values: uniqueSortedStrings(risk.triggers?.urlPatterns).join(', ') || '-' },
    ]),
    '',
    '## \u5ba1\u6279\u68c0\u67e5\u70b9',
    '',
    approvalRules.length
      ? approvalRules.map((rule) => [
        `### ${mdEscape(rule.approval?.checkpointLabel ?? rule.approvalRuleId)}`,
        '',
        `- \u5ba1\u6279\u539f\u56e0\uff1a${mdEscape(rule.approval?.rationale ?? '-')}`,
        `- \u5ba1\u6279\u4eba\uff1a\`${rule.approval?.approver ?? '-'}\``,
        `- \u9ed8\u8ba4\u62d2\u7edd\uff1a\`${String(Boolean(rule.approval?.denyByDefault))}\``,
        '',
        renderTable(
          ['Field', 'Op', 'Value'],
          toArray(rule.detect?.any).map((item) => ({
            field: item.field ?? '-',
            op: item.op ?? '-',
            value: Array.isArray(item.value) ? item.value.join(', ') : String(item.value ?? '-'),
          }))
        ),
      ].join('\n')).join('\n\n')
      : '\u5f53\u524d\u6837\u672c\u4e2d\u6ca1\u6709\u76f4\u63a5\u547d\u4e2d\u7684\u5ba1\u6279\u89c4\u5219\uff0c\u4f46\u8be5\u98ce\u9669\u7c7b\u578b\u4ecd\u4fdd\u7559\u4e3a\u6cbb\u7406\u5b57\u5178\u3002',
    '',
    '## \u5f53\u524d\u9875\u9762\u89c2\u6d4b\u60c5\u51b5',
    '',
    `- Observed States\uff1a${observedStateIds.length}`,
    `- Observed Edges\uff1a${observedEdgeIds.length}`,
    '',
    '## \u8bc1\u636e\u5f15\u7528',
    '',
    renderSourceRefList(page, page.path),
  ].join('\n');
}

function renderPageContent(page, context, pagesById) {
  const meta = createKbMeta({
    pageId: page.pageId,
    kind: page.kind,
    title: page.title,
    summary: page.summary,
    path: page.path,
    sourceRefs: page.sourceRefs,
    relatedIds: page.relatedIds,
    updatedAt: page.updatedAt,
    attributes: page.attributes,
  });

  let body = '';
  if (page.pageId === 'page_readme') {
    body = renderReadmePage(page, context, pagesById);
  } else if (page.pageId === 'page_overview_site') {
    body = renderOverviewPage(page, context, pagesById);
  } else if (page.pageId === 'page_concept_interaction_model') {
    body = renderInteractionModelPageEnhanced(page, context, pagesById);
  } else if (page.pageId === 'page_concept_nl_entry') {
    body = renderNlEntryPage(page, context);
  } else if (page.pageId === 'page_concept_governance') {
    body = renderGovernanceConceptPage(page, context);
  } else if (page.pageId === 'page_comparison_state_coverage') {
    body = renderStateCoveragePage(page, context, pagesById);
  } else if (page.kind === 'state') {
    body = renderStatePageEnhanced(page, context, pagesById);
  } else if (page.kind === 'element') {
    body = renderElementPage(page, context, pagesById);
  } else if (page.kind === 'intent') {
    body = renderIntentPage(page, context, pagesById);
  } else if (page.kind === 'flow') {
    body = renderFlowPage(page, context, pagesById);
  } else if (page.kind === 'risk') {
    body = renderRiskPage(page, context);
  } else {
    body = `# ${mdEscape(page.title)}\n\n${mdEscape(page.summary)}`;
  }

  return `${meta}\n\n${body}\n`;
}

function buildPageIndexes(inputUrl, baseUrl, generatedAt, pages) {
  const entries = pages.map((page) => ({
    pageId: page.pageId,
    kind: page.kind,
    title: page.title,
    summary: page.summary,
    path: page.path,
    updatedAt: page.updatedAt ?? generatedAt,
    sourceRefs: page.sourceRefs,
    relatedIds: page.relatedIds,
    attributes: page.attributes ?? {},
  }));
  return {
    inputUrl,
    baseUrl,
    generatedAt,
    pages: entries,
  };
}

function buildSiteMapDocument(inputUrl, baseUrl, generatedAt, pages, sourcesDocument, lintSummary = null) {
  const counts = {};
  for (const page of pages) {
    counts[page.kind] = (counts[page.kind] ?? 0) + 1;
  }
  return {
    inputUrl,
    baseUrl,
    generatedAt,
    totalPages: pages.length,
    counts,
    entryPages: {
      readme: KB_FILES.readme,
      overview: KB_FILES.siteOverview,
    },
    activeSources: toArray(sourcesDocument.activeSources).length,
    orphanPageCount: lintSummary?.orphanPageCount ?? null,
    latestLint: lintSummary,
  };
}

async function writePagesAndIndexes(context, pages, sourcesDocument) {
  const { kbDir, generatedAt, artifacts } = context;
  const pagesById = buildPagesById(pages);
  for (const page of pages) {
    const content = renderPageContent(page, context, pagesById);
    await writeTextFile(path.join(kbDir, page.path), content);
  }

  const pagesIndex = buildPageIndexes(artifacts.inputUrl, artifacts.baseUrl, generatedAt, pages);
  await writeJsonFile(path.join(kbDir, KB_FILES.pages), pagesIndex);
  await writeJsonLines(path.join(kbDir, KB_FILES.pagesJsonl), pagesIndex.pages);
  await writeJsonFile(path.join(kbDir, KB_FILES.states), {
    inputUrl: artifacts.inputUrl,
    baseUrl: artifacts.baseUrl,
    generatedAt,
    pages: pagesIndex.pages.filter((page) => page.kind === 'state'),
  });
  await writeJsonFile(path.join(kbDir, KB_FILES.elements), {
    inputUrl: artifacts.inputUrl,
    baseUrl: artifacts.baseUrl,
    generatedAt,
    pages: pagesIndex.pages.filter((page) => page.kind === 'element'),
  });
  await writeJsonFile(path.join(kbDir, KB_FILES.intents), {
    inputUrl: artifacts.inputUrl,
    baseUrl: artifacts.baseUrl,
    generatedAt,
    pages: pagesIndex.pages.filter((page) => page.kind === 'intent'),
  });
  await writeJsonFile(path.join(kbDir, KB_FILES.flows), {
    inputUrl: artifacts.inputUrl,
    baseUrl: artifacts.baseUrl,
    generatedAt,
    pages: pagesIndex.pages.filter((page) => page.kind === 'flow'),
  });
  await writeJsonFile(path.join(kbDir, KB_FILES.risks), {
    inputUrl: artifacts.inputUrl,
    baseUrl: artifacts.baseUrl,
    generatedAt,
    pages: pagesIndex.pages.filter((page) => page.kind === 'risk'),
  });
  await writeJsonFile(path.join(kbDir, KB_FILES.sources), sourcesDocument);
  await writeJsonFile(
    path.join(kbDir, KB_FILES.siteMap),
    buildSiteMapDocument(artifacts.inputUrl, artifacts.baseUrl, generatedAt, pages, sourcesDocument, null)
  );
}

async function loadKnowledgeBase(kbDir) {
  const pagesIndex = await readJsonFile(path.join(kbDir, KB_FILES.pages));
  const pagesJsonlRaw = await readFile(path.join(kbDir, KB_FILES.pagesJsonl), 'utf8');
  const pagesJsonl = pagesJsonlRaw
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const siteMap = await readJsonFile(path.join(kbDir, KB_FILES.siteMap));
  const sources = await readJsonFile(path.join(kbDir, KB_FILES.sources));
  const categoryIndexes = {
    state: await readJsonFile(path.join(kbDir, KB_FILES.states)),
    element: await readJsonFile(path.join(kbDir, KB_FILES.elements)),
    intent: await readJsonFile(path.join(kbDir, KB_FILES.intents)),
    flow: await readJsonFile(path.join(kbDir, KB_FILES.flows)),
    risk: await readJsonFile(path.join(kbDir, KB_FILES.risks)),
  };
  return {
    kbDir,
    pagesIndex,
    pagesJsonl,
    siteMap,
    sources,
    categoryIndexes,
  };
}

function parseKbMeta(markdown) {
  const match = KBMETA_REGEX.exec(markdown);
  if (!match) {
    return null;
  }
  try {
    return JSON.parse(match[1].trim());
  } catch {
    return null;
  }
}

function resolveMarkdownTarget(currentFile, href) {
  if (!href) {
    return null;
  }
  const trimmed = String(href).trim().replace(/^<|>$/gu, '');
  if (!trimmed || trimmed.startsWith('#')) {
    return null;
  }
  if (/^(?:[a-z]+:)?\/\//iu.test(trimmed) || trimmed.startsWith('mailto:')) {
    return null;
  }
  const withoutFragment = trimmed.split('#')[0];
  const withoutQuery = withoutFragment.split('?')[0];
  return path.resolve(path.dirname(currentFile), withoutQuery);
}

function comparePageSets(expectedEntries, actualEntries) {
  const expectedIds = new Set(expectedEntries.map((entry) => entry.pageId));
  const actualIds = new Set(actualEntries.map((entry) => entry.pageId));
  return {
    missing: [...expectedIds].filter((pageId) => !actualIds.has(pageId)).sort(compareNullableStrings),
    extra: [...actualIds].filter((pageId) => !expectedIds.has(pageId)).sort(compareNullableStrings),
  };
}

function validateCategoryIndex(kind, indexEntries, pageEntries, errors, indexPath) {
  const comparison = comparePageSets(pageEntries, indexEntries);
  for (const pageId of comparison.missing) {
    errors.push(buildError('index-mismatch', `${kind} index is missing page ${pageId}.`, indexPath));
  }
  for (const pageId of comparison.extra) {
    errors.push(buildError('index-mismatch', `${kind} index has unexpected page ${pageId}.`, indexPath));
  }
}

export async function lintKnowledgeBase(kbDir, options = {}) {
  const mergedOptions = mergeLintOptions({ ...options, kbDir });
  const resolvedKbDir = path.resolve(mergedOptions.kbDir);
  const reportDir = mergedOptions.reportDir ? path.resolve(mergedOptions.reportDir) : path.join(resolvedKbDir, KB_DIRS.reports);
  const generatedAt = new Date().toISOString();
  const errors = [];
  const warnings = [];

  for (const dirPath of REQUIRED_DIRS) {
    if (!await pathExists(path.join(resolvedKbDir, dirPath))) {
      errors.push(buildError('missing-dir', `Missing required directory ${dirPath}.`, path.join(resolvedKbDir, dirPath)));
    }
  }

  for (const filePath of REQUIRED_FILES) {
    if (toPosixPath(filePath).startsWith(`${KB_DIRS.reports}/`)) {
      continue;
    }
    if (!await pathExists(path.join(resolvedKbDir, filePath))) {
      errors.push(buildError('missing-file', `Missing required file ${filePath}.`, path.join(resolvedKbDir, filePath)));
    }
  }

  let kb = null;
  if (!errors.length) {
    try {
      kb = await loadKnowledgeBase(resolvedKbDir);
    } catch (error) {
      errors.push(buildError('json-parse-failed', `Failed to load knowledge base indexes: ${error.message}`, resolvedKbDir));
    }
  }

  let pageEntries = [];
  if (kb) {
    pageEntries = toArray(kb.pagesIndex?.pages);
    const jsonlEntries = toArray(kb.pagesJsonl);
    const comparison = comparePageSets(pageEntries, jsonlEntries);
    for (const pageId of comparison.missing) {
      errors.push(buildError('index-mismatch', `pages.jsonl is missing ${pageId}.`, path.join(resolvedKbDir, KB_FILES.pagesJsonl)));
    }
    for (const pageId of comparison.extra) {
      errors.push(buildError('index-mismatch', `pages.jsonl has unexpected ${pageId}.`, path.join(resolvedKbDir, KB_FILES.pagesJsonl)));
    }

    validateCategoryIndex('state', toArray(kb.categoryIndexes.state?.pages), pageEntries.filter((entry) => entry.kind === 'state'), errors, path.join(resolvedKbDir, KB_FILES.states));
    validateCategoryIndex('element', toArray(kb.categoryIndexes.element?.pages), pageEntries.filter((entry) => entry.kind === 'element'), errors, path.join(resolvedKbDir, KB_FILES.elements));
    validateCategoryIndex('intent', toArray(kb.categoryIndexes.intent?.pages), pageEntries.filter((entry) => entry.kind === 'intent'), errors, path.join(resolvedKbDir, KB_FILES.intents));
    validateCategoryIndex('flow', toArray(kb.categoryIndexes.flow?.pages), pageEntries.filter((entry) => entry.kind === 'flow'), errors, path.join(resolvedKbDir, KB_FILES.flows));
    validateCategoryIndex('risk', toArray(kb.categoryIndexes.risk?.pages), pageEntries.filter((entry) => entry.kind === 'risk'), errors, path.join(resolvedKbDir, KB_FILES.risks));

    const inboundCounts = new Map(pageEntries.map((entry) => [entry.pageId, 0]));

    for (const entry of pageEntries) {
      const absolutePagePath = path.join(resolvedKbDir, entry.path);
      if (!await pathExists(absolutePagePath)) {
        errors.push(buildError('missing-page-file', `Page file is missing for ${entry.pageId}.`, absolutePagePath));
        continue;
      }

      const markdown = await readFile(absolutePagePath, 'utf8');
      const meta = parseKbMeta(markdown);
      if (!meta) {
        errors.push(buildError('missing-kbmeta', `Page ${entry.pageId} is missing valid KBMETA.`, absolutePagePath));
        continue;
      }

      for (const field of ['pageId', 'kind', 'title', 'summary', 'path', 'updatedAt', 'sourceRefs', 'relatedIds']) {
        if (meta[field] === undefined) {
          errors.push(buildError('invalid-kbmeta', `Page ${entry.pageId} is missing KBMETA field ${field}.`, absolutePagePath));
        }
      }

      if (meta.pageId !== entry.pageId) {
        errors.push(buildError('kbmeta-mismatch', `KBMETA pageId mismatch for ${entry.pageId}.`, absolutePagePath));
      }
      if (toPosixPath(meta.path) !== toPosixPath(entry.path)) {
        errors.push(buildError('kbmeta-mismatch', `KBMETA path mismatch for ${entry.pageId}.`, absolutePagePath));
      }
      if (!cleanText(meta.summary)) {
        warnings.push(buildWarning('missing-summary', `Page ${entry.pageId} is missing summary text.`, absolutePagePath));
      }
      if (entry.kind === 'concept') {
        const body = markdown.replace(KBMETA_REGEX, '').trim();
        if (body.length < 180) {
          warnings.push(buildWarning('thin-concept-page', `Concept page ${entry.pageId} is thin and should be expanded.`, absolutePagePath));
        }
      }

      if (!toArray(meta.sourceRefs).length) {
        warnings.push(buildWarning('missing-source-refs', `Page ${entry.pageId} has no source refs.`, absolutePagePath));
      }

      for (const ref of toArray(meta.sourceRefs)) {
        const refPath = ref?.path ? path.join(resolvedKbDir, ref.path) : null;
        if (!ref?.path || !toPosixPath(ref.path).startsWith('raw/')) {
          errors.push(buildError('invalid-evidence-ref', `Evidence refs must point into raw/: ${entry.pageId}.`, absolutePagePath));
          continue;
        }
        if (!await pathExists(refPath)) {
          errors.push(buildError('missing-evidence-ref', `Evidence target does not exist for ${entry.pageId}.`, refPath ?? absolutePagePath));
        }
      }

      for (const match of markdown.matchAll(MARKDOWN_LINK_REGEX)) {
        const target = resolveMarkdownTarget(absolutePagePath, match[1]);
        if (!target) {
          continue;
        }
        if (!await pathExists(target)) {
          errors.push(buildError('broken-markdown-link', `Broken markdown link in ${entry.pageId}: ${match[1]}`, absolutePagePath));
          continue;
        }
        if (target.startsWith(path.join(resolvedKbDir, KB_DIRS.wiki))) {
          const targetRelative = relativeToKb(resolvedKbDir, target);
          const targetEntry = pageEntries.find((candidate) => toPosixPath(candidate.path) === targetRelative);
          if (targetEntry) {
            inboundCounts.set(targetEntry.pageId, (inboundCounts.get(targetEntry.pageId) ?? 0) + 1);
          }
        }
      }

      if (entry.kind === 'risk' && Number(entry.attributes?.observedStateCount ?? 0) === 0) {
        warnings.push(buildWarning('risk-context-thin', `Risk page ${entry.pageId} has no observed in-domain evidence.`, absolutePagePath));
      }
    }

    for (const entry of pageEntries) {
      if (entry.pageId === 'page_readme') {
        continue;
      }
      if ((inboundCounts.get(entry.pageId) ?? 0) === 0) {
        warnings.push(buildWarning('orphan-page', `Page ${entry.pageId} is not linked from any other wiki page.`, path.join(resolvedKbDir, entry.path)));
      }
    }
  }

  const summary = buildLintSummary(errors, warnings);
  const lintReport = {
    kbDir: resolvedKbDir,
    generatedAt,
    summary,
    errors,
    warnings,
  };
  const gapReport = {
    kbDir: resolvedKbDir,
    generatedAt,
    groups: classifyGapWarnings(warnings),
  };

  await ensureDir(reportDir);
  await writeKnowledgeBaseLintReports(reportDir, KB_FILES, lintReport, gapReport);

  if (kb) {
    const updatedSiteMap = buildSiteMapDocument(
      kb.pagesIndex.inputUrl,
      kb.pagesIndex.baseUrl,
      kb.pagesIndex.generatedAt,
      toArray(kb.pagesIndex.pages),
      kb.sources,
      summary
    );
    await writeJsonFile(path.join(resolvedKbDir, KB_FILES.siteMap), updatedSiteMap);
    const sourceRunIds = {};
    for (const source of toArray(kb.sources.activeSources)) {
      sourceRunIds[source.key] = source.runId;
    }
    await appendKbEvent(resolvedKbDir, 'lint_complete', summary.passed ? 'success' : 'failed', `Lint finished with ${summary.errorCount} errors and ${summary.warningCount} warnings.`, { sourceRunIds });
  }

  if (summary.errorCount > 0 || (mergedOptions.failOnWarnings && summary.warningCount > 0)) {
    const error = new Error(`Knowledge base lint failed for ${resolvedKbDir}.`);
    error.lintReport = lintReport;
    throw error;
  }
  return { lintReport, gapReport };
}

export async function compileKnowledgeBase(inputUrl, options = {}) {
  const mergedOptions = mergeCompileOptions(options);
  return publishKnowledgeBase(inputUrl, mergedOptions, {
    cwd: process.cwd(),
    kbFiles: KB_FILES,
    resolveCompileArtifacts,
    readSiteContext,
    buildKbLayout,
    initializeKnowledgeBaseDirs,
    buildSourceRunIds,
    appendKbEvent,
    copyRawSources,
    createRawResolver,
    buildSourceIndexDocument,
    buildDataModel,
    finalizeDataModel,
    writeKnowledgeBaseSchemaFiles,
    buildPageDescriptors,
    writePagesAndIndexes,
    lintKnowledgeBase,
    resolveKnowledgeBaseAugmentation,
    syncKnowledgeBaseSiteMetadata,
  });
}

export function printHelp() {
  console.log([
    'Usage:',
    '  node src/entrypoints/pipeline/compile-wiki.mjs compile <url> [--kb-dir <dir>] [--capture-dir <dir>] [--expanded-states-dir <dir>] [--book-content-dir <dir>] [--analysis-dir <dir>] [--analysis-manifest <path>] [--abstraction-dir <dir>] [--abstraction-manifest <path>] [--nl-entry-dir <dir>] [--nl-entry-manifest <path>] [--docs-dir <dir>] [--docs-manifest <path>] [--governance-dir <dir>] [--strict <true|false>]',
    '  node src/entrypoints/pipeline/compile-wiki.mjs lint --kb-dir <dir> [--report-dir <dir>] [--fail-on-warnings <true|false>]',
  ].join('\n'));
}

export function parseCliArgs(argv) {
  const [command, maybeUrl, ...rest] = argv;
  if (!command || command === '--help' || command === '-h') {
    return { command: 'help' };
  }

  const flags = {};
  const positionals = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }
    const flag = token.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      flags[flag] = next;
      index += 1;
    } else {
      flags[flag] = true;
    }
  }

  if (positionals[0] === 'compile') {
    return {
      command: 'compile',
      inputUrl: positionals[1],
      options: {
        kbDir: flags['kb-dir'],
        captureDir: flags['capture-dir'],
        expandedStatesDir: flags['expanded-states-dir'] ?? flags['expanded-dir'],
        bookContentDir: flags['book-content-dir'],
        analysisDir: flags['analysis-dir'],
        analysisManifestPath: flags['analysis-manifest'],
        abstractionDir: flags['abstraction-dir'],
        abstractionManifestPath: flags['abstraction-manifest'],
        nlEntryDir: flags['nl-entry-dir'],
        nlEntryManifestPath: flags['nl-entry-manifest'],
        docsDir: flags['docs-dir'],
        docsManifestPath: flags['docs-manifest'],
        governanceDir: flags['governance-dir'],
        strict: parseBooleanFlag(flags.strict, true),
      },
    };
  }

  if (positionals[0] === 'lint') {
    return {
      command: 'lint',
      kbDir: flags['kb-dir'],
      options: {
        reportDir: flags['report-dir'],
        failOnWarnings: parseBooleanFlag(flags['fail-on-warnings'], false),
      },
    };
  }

  return { command: 'help' };
}

export async function runCli() {
  initializeCliUtf8();
  const parsed = parseCliArgs(process.argv.slice(2));
  if (parsed.command === 'help') {
    printHelp();
    return;
  }

  if (parsed.command === 'compile') {
    if (!parsed.inputUrl) {
      throw new Error('compile requires <url>.');
    }
    const result = await compileKnowledgeBase(parsed.inputUrl, parsed.options);
    writeJsonStdout({
      kbDir: result.kbDir,
      pages: result.pages,
      lintErrors: result.lintSummary.errorCount,
      lintWarnings: result.lintSummary.warningCount,
    });
    return;
  }

  if (parsed.command === 'lint') {
    if (!parsed.kbDir) {
      throw new Error('lint requires --kb-dir <dir>.');
    }
    const result = await lintKnowledgeBase(parsed.kbDir, parsed.options);
    writeJsonStdout({
      kbDir: parsed.kbDir,
      errors: result.lintReport.summary.errorCount,
      warnings: result.lintReport.summary.warningCount,
      passed: result.lintReport.summary.passed,
    });
  }
}



