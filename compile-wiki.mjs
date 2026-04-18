// @ts-check

import {
  access,
  cp,
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { enrichBilibiliPageFactsForState, summarizeBilibiliKnowledgeFacts } from './lib/bilibili-surfacing.mjs';
import { initializeCliUtf8, writeJsonStdout } from './lib/cli.mjs';
import { appendJsonLine, appendTextFile, ensureDir, pathExists, readJsonFile, writeJsonFile, writeJsonLines, writeTextFile } from './lib/io.mjs';
import { markdownLink, renderTable as sharedRenderTable } from './lib/markdown.mjs';
import { mdEscape } from './lib/markdown_escape.mjs';
import { cleanText, compactSlug, compareNullableStrings, firstNonEmpty, normalizeUrlNoFragment, normalizeWhitespace, relativePath, sanitizeHost, toArray, toPosixPath, uniqueSortedPaths, uniqueSortedStrings } from './lib/normalize.mjs';
import { buildError, buildWarning } from './lib/wiki-report.mjs';
import { firstExistingPath, kbAbsolute, listDirectories, relativeToKb, resolveMaybeRelative } from './lib/wiki-paths.mjs';
import { readSiteContext } from './lib/site-context.mjs';
import { displayIntentName, normalizeDisplayLabel } from './lib/site-terminology.mjs';
import { writeKnowledgeBaseSchemaFiles } from './lib/kb-build/schema-files.mjs';
import { buildLintSummary, classifyGapWarnings, writeKnowledgeBaseLintReports } from './lib/kb-build/lint-report.mjs';
import { syncKnowledgeBaseSiteMetadata } from './lib/kb-build/site-metadata.mjs';
import { publishKnowledgeBase } from './lib/publish/kb/publisher.mjs';

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

const ROOT_DIRS = {
  captures: 'captures',
  expanded: 'expanded-states',
  bookContent: 'book-content',
  operationDocs: 'operation-docs',
  governance: 'governance',
  knowledgeBase: 'knowledge-base',
};

const MANIFEST_NAMES = {
  capture: 'manifest.json',
  expanded: ['states-manifest.json', 'state-manifest.json'],
  bookContent: 'book-content-manifest.json',
  analysis: 'analysis-manifest.json',
  abstraction: 'abstraction-manifest.json',
  nlEntry: 'nl-entry-manifest.json',
  docs: 'docs-manifest.json',
};

const KB_DIRS = {
  raw: 'raw',
  wiki: 'wiki',
  schema: 'schema',
  index: 'index',
  log: 'log',
  reports: 'reports',
};

const KB_FILES = {
  readme: path.join(KB_DIRS.wiki, 'README.md'),
  siteOverview: path.join(KB_DIRS.wiki, 'overview', 'site-overview.md'),
  interactionModel: path.join(KB_DIRS.wiki, 'concepts', 'interaction-model.md'),
  nlEntry: path.join(KB_DIRS.wiki, 'concepts', 'nl-entry.md'),
  governance: path.join(KB_DIRS.wiki, 'concepts', 'governance.md'),
  stateCoverage: path.join(KB_DIRS.wiki, 'comparisons', 'state-coverage.md'),
  agents: path.join(KB_DIRS.schema, 'AGENTS.md'),
  intentTemplate: path.join(KB_DIRS.schema, 'page-template.intent.md'),
  stateTemplate: path.join(KB_DIRS.schema, 'page-template.state.md'),
  riskTemplate: path.join(KB_DIRS.schema, 'page-template.risk.md'),
  namingRules: path.join(KB_DIRS.schema, 'naming-rules.json'),
  evidenceRules: path.join(KB_DIRS.schema, 'evidence-rules.json'),
  indexSchema: path.join(KB_DIRS.schema, 'index-entry.schema.json'),
  wikiSchema: path.join(KB_DIRS.schema, 'wiki-page.schema.json'),
  lintSchema: path.join(KB_DIRS.schema, 'lint-report.schema.json'),
  siteMap: path.join(KB_DIRS.index, 'site-map.json'),
  pages: path.join(KB_DIRS.index, 'pages.json'),
  pagesJsonl: path.join(KB_DIRS.index, 'pages.jsonl'),
  states: path.join(KB_DIRS.index, 'states.json'),
  elements: path.join(KB_DIRS.index, 'elements.json'),
  intents: path.join(KB_DIRS.index, 'intents.json'),
  flows: path.join(KB_DIRS.index, 'flows.json'),
  risks: path.join(KB_DIRS.index, 'risks.json'),
  sources: path.join(KB_DIRS.index, 'sources.json'),
  events: path.join(KB_DIRS.log, 'events.jsonl'),
  activity: path.join(KB_DIRS.log, 'activity.log'),
  lintReportJson: path.join(KB_DIRS.reports, 'lint-report.json'),
  lintReportMd: path.join(KB_DIRS.reports, 'lint-report.md'),
  gapReportJson: path.join(KB_DIRS.reports, 'gap-report.json'),
  gapReportMd: path.join(KB_DIRS.reports, 'gap-report.md'),
};

const KBMETA_REGEX = /<!--\s*KBMETA\s*([\s\S]*?)-->/u;
const MARKDOWN_LINK_REGEX = /\[[^\]]*?\]\(([^)]+)\)/gu;

const REQUIRED_DIRS = [
  KB_DIRS.raw,
  KB_DIRS.wiki,
  KB_DIRS.schema,
  KB_DIRS.index,
  KB_DIRS.log,
  KB_DIRS.reports,
];

const REQUIRED_FILES = [
  KB_FILES.readme,
  KB_FILES.siteOverview,
  KB_FILES.interactionModel,
  KB_FILES.nlEntry,
  KB_FILES.governance,
  KB_FILES.stateCoverage,
  KB_FILES.agents,
  KB_FILES.intentTemplate,
  KB_FILES.stateTemplate,
  KB_FILES.riskTemplate,
  KB_FILES.namingRules,
  KB_FILES.evidenceRules,
  KB_FILES.indexSchema,
  KB_FILES.wikiSchema,
  KB_FILES.lintSchema,
  KB_FILES.siteMap,
  KB_FILES.pages,
  KB_FILES.pagesJsonl,
  KB_FILES.states,
  KB_FILES.elements,
  KB_FILES.intents,
  KB_FILES.flows,
  KB_FILES.risks,
  KB_FILES.sources,
  KB_FILES.events,
  KB_FILES.activity,
  KB_FILES.lintReportJson,
  KB_FILES.lintReportMd,
  KB_FILES.gapReportJson,
  KB_FILES.gapReportMd,
];

function formatTimestampForDir(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.(\d{3})Z$/, '$1Z');
}

function renderTable(headers, rows) {
  if (!rows.length) {
    return '_None_';
  }
  return sharedRenderTable(headers, rows);
}

async function candidateSortKey(dirPath, generatedAt) {
  if (generatedAt) {
    const timestamp = Date.parse(generatedAt);
    if (!Number.isNaN(timestamp)) {
      return timestamp;
    }
  }
  const fileStat = await stat(dirPath);
  return fileStat.mtimeMs;
}

function mergeCompileOptions(options) {
  return {
    ...DEFAULT_COMPILE_OPTIONS,
    ...options,
  };
}

function mergeLintOptions(options) {
  return {
    ...DEFAULT_LINT_OPTIONS,
    ...options,
  };
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

function hostFromUrl(input) {
  try {
    return new URL(input).hostname;
  } catch {
    return null;
  }
}

function sameHost(left, right) {
  return sanitizeHost(hostFromUrl(left) ?? '') === sanitizeHost(hostFromUrl(right) ?? '');
}

function isBilibiliKnowledgeBase(baseUrl) {
  return sanitizeHost(hostFromUrl(baseUrl) ?? '') === 'www.bilibili.com';
}

async function loadCaptureFromDir(dirPath) {
  const manifestPath = path.join(dirPath, MANIFEST_NAMES.capture);
  if (!(await pathExists(manifestPath))) {
    throw new Error(`Capture manifest not found: ${manifestPath}`);
  }
  const manifest = await readJsonFile(manifestPath);
  const files = manifest.files ?? {};
  const htmlPath = resolveMaybeRelative(files.html, dirPath);
  const snapshotPath = resolveMaybeRelative(files.snapshot, dirPath);
  const screenshotPath = resolveMaybeRelative(files.screenshot, dirPath);
  if (!(await pathExists(htmlPath)) || !(await pathExists(snapshotPath)) || !(await pathExists(screenshotPath))) {
    throw new Error(`Capture files are incomplete under ${dirPath}`);
  }
  return {
    step: 'step-1-capture',
    key: 'capture',
    dir: path.resolve(dirPath),
    manifestPath,
    manifest,
    generatedAt: manifest.capturedAt ?? manifest.generatedAt ?? null,
    baseUrl: normalizeUrlNoFragment(manifest.finalUrl ?? manifest.inputUrl),
    runId: path.basename(dirPath),
  };
}

async function discoverCapture(workspaceRoot, baseUrl) {
  const parent = path.join(workspaceRoot, ROOT_DIRS.captures);
  const candidates = [];
  for (const dirPath of await listDirectories(parent)) {
    try {
      const capture = await loadCaptureFromDir(dirPath);
      if (!sameHost(capture.baseUrl, baseUrl)) {
        continue;
      }
      capture.sortKey = await candidateSortKey(dirPath, capture.generatedAt);
      candidates.push(capture);
    } catch {
      // Ignore invalid capture artifacts.
    }
  }
  candidates.sort((left, right) => right.sortKey - left.sortKey);
  const exact = candidates.find((candidate) => normalizeUrlNoFragment(candidate.manifest.finalUrl) === normalizeUrlNoFragment(baseUrl));
  return exact ?? candidates[0] ?? null;
}

async function loadExpandedFromDir(dirPath) {
  const manifestPath = await firstExistingPath(
    MANIFEST_NAMES.expanded.map((name) => ({ value: path.join(dirPath, name), baseDir: dirPath })),
  );
  if (!manifestPath) {
    throw new Error(`Expanded-state manifest not found under ${dirPath}`);
  }
  const manifest = await readJsonFile(manifestPath);
  const states = toArray(manifest.states);
  if (states.length === 0) {
    throw new Error(`Expanded-state manifest has no states: ${manifestPath}`);
  }
  for (const state of states) {
    for (const filePath of [
      state.files?.html,
      state.files?.snapshot,
      state.files?.screenshot,
      state.files?.manifest,
    ].filter(Boolean)) {
      const resolved = resolveMaybeRelative(filePath, dirPath);
      if (!(await pathExists(resolved))) {
        throw new Error(`Expanded-state file missing: ${resolved}`);
      }
    }
  }
  return {
    step: 'step-2-expanded',
    key: 'expanded',
    dir: path.resolve(dirPath),
    manifestPath,
    manifest,
    generatedAt: manifest.generatedAt ?? states[0]?.capturedAt ?? null,
    baseUrl: normalizeUrlNoFragment(manifest.baseUrl ?? states[0]?.finalUrl),
    runId: path.basename(dirPath),
  };
}

async function discoverExpanded(workspaceRoot, baseUrl) {
  const parent = path.join(workspaceRoot, ROOT_DIRS.expanded);
  const candidates = [];
  for (const dirPath of await listDirectories(parent)) {
    try {
      const expanded = await loadExpandedFromDir(dirPath);
      if (!sameHost(expanded.baseUrl, baseUrl)) {
        continue;
      }
      expanded.sortKey = await candidateSortKey(dirPath, expanded.generatedAt);
      candidates.push(expanded);
    } catch {
      // Ignore invalid expanded artifacts.
    }
  }
  candidates.sort((left, right) => right.sortKey - left.sortKey);
  return candidates[0] ?? null;
}

async function loadBookContentFromDir(dirPath) {
  const artifact = await loadManifestArtifactFromDir(dirPath, MANIFEST_NAMES.bookContent, 'Book content', ['books', 'authors', 'searchResults', 'manifest']);
  const booksPath = resolveMaybeRelative(artifact.manifest.files.books, dirPath);
  const authorsPath = resolveMaybeRelative(artifact.manifest.files.authors, dirPath);
  const searchResultsPath = resolveMaybeRelative(artifact.manifest.files.searchResults, dirPath);
  const downloadsDir = artifact.manifest.files.downloadsDir ? resolveMaybeRelative(artifact.manifest.files.downloadsDir, dirPath) : path.join(dirPath, 'downloads');
  return {
    step: 'step-book-content',
    key: 'bookContent',
    ...artifact,
    booksPath,
    authorsPath,
    searchResultsPath,
    downloadsDir: await pathExists(downloadsDir) ? downloadsDir : null,
    booksDocument: await readJsonFile(booksPath),
    authorsDocument: await readJsonFile(authorsPath),
    searchResultsDocument: await readJsonFile(searchResultsPath),
  };
}

async function discoverBookContent(workspaceRoot, baseUrl) {
  const candidates = [];
  const hostRoots = [...new Set([
    path.join(workspaceRoot, ROOT_DIRS.bookContent, sanitizeHost(hostFromUrl(baseUrl) ?? '')),
    path.join(workspaceRoot, ROOT_DIRS.bookContent),
  ].filter(Boolean))];
  for (const parent of hostRoots) {
    for (const dirPath of await listDirectories(parent)) {
      try {
        const artifact = await loadBookContentFromDir(dirPath);
        if (!sameHost(artifact.baseUrl, baseUrl)) {
          continue;
        }
        artifact.sortKey = await candidateSortKey(dirPath, artifact.generatedAt);
        candidates.push(artifact);
      } catch {
        // Ignore invalid book-content artifacts.
      }
    }
  }
  candidates.sort((left, right) => right.sortKey - left.sortKey);
  return candidates[0] ?? null;
}

async function loadManifestArtifactFromDir(dirPath, manifestName, label, requiredFileKeys) {
  const manifestPath = path.join(dirPath, manifestName);
  if (!(await pathExists(manifestPath))) {
    throw new Error(`${label} manifest not found: ${manifestPath}`);
  }
  const manifest = await readJsonFile(manifestPath);
  for (const key of requiredFileKeys) {
    const targetPath = resolveMaybeRelative(manifest.files?.[key], dirPath);
    if (!(await pathExists(targetPath))) {
      throw new Error(`${label} file missing for ${key}: ${targetPath}`);
    }
  }
  return {
    dir: path.resolve(dirPath),
    manifestPath,
    manifest,
    generatedAt: manifest.generatedAt ?? null,
    baseUrl: normalizeUrlNoFragment(manifest.baseUrl ?? manifest.inputUrl),
    runId: path.basename(dirPath),
  };
}

async function loadAnalysisFromDir(dirPath) {
  const artifact = await loadManifestArtifactFromDir(dirPath, MANIFEST_NAMES.analysis, 'Analysis', ['elements', 'states', 'transitions', 'manifest']);
  const elementsPath = resolveMaybeRelative(artifact.manifest.files.elements, dirPath);
  const statesPath = resolveMaybeRelative(artifact.manifest.files.states, dirPath);
  const transitionsPath = resolveMaybeRelative(artifact.manifest.files.transitions, dirPath);
  const siteProfilePath = artifact.manifest.files.siteProfile ? resolveMaybeRelative(artifact.manifest.files.siteProfile, dirPath) : path.join(dirPath, 'site-profile.json');
  return {
    step: 'step-3-analysis',
    key: 'analysis',
    ...artifact,
    elementsPath,
    statesPath,
    transitionsPath,
    siteProfilePath: await pathExists(siteProfilePath) ? siteProfilePath : null,
    elementsDocument: await readJsonFile(elementsPath),
    statesDocument: await readJsonFile(statesPath),
    transitionsDocument: await readJsonFile(transitionsPath),
    siteProfileDocument: await pathExists(siteProfilePath) ? await readJsonFile(siteProfilePath) : null,
  };
}

async function loadAbstractionFromDir(dirPath) {
  const artifact = await loadManifestArtifactFromDir(dirPath, MANIFEST_NAMES.abstraction, 'Abstraction', ['intents', 'actions', 'decisionTable', 'manifest']);
  const intentsPath = resolveMaybeRelative(artifact.manifest.files.intents, dirPath);
  const actionsPath = resolveMaybeRelative(artifact.manifest.files.actions, dirPath);
  const decisionTablePath = resolveMaybeRelative(artifact.manifest.files.decisionTable, dirPath);
  const capabilityMatrixPath = artifact.manifest.files.capabilityMatrix ? resolveMaybeRelative(artifact.manifest.files.capabilityMatrix, dirPath) : path.join(dirPath, 'capability-matrix.json');
  return {
    step: 'step-4-abstraction',
    key: 'abstraction',
    ...artifact,
    intentsPath,
    actionsPath,
    decisionTablePath,
    capabilityMatrixPath: await pathExists(capabilityMatrixPath) ? capabilityMatrixPath : null,
    intentsDocument: await readJsonFile(intentsPath),
    actionsDocument: await readJsonFile(actionsPath),
    decisionTableDocument: await readJsonFile(decisionTablePath),
    capabilityMatrixDocument: await pathExists(capabilityMatrixPath) ? await readJsonFile(capabilityMatrixPath) : null,
  };
}

async function loadNlEntryFromDir(dirPath) {
  const artifact = await loadManifestArtifactFromDir(dirPath, MANIFEST_NAMES.nlEntry, 'NL entry', ['aliasLexicon', 'slotSchema', 'utterancePatterns', 'entryRules', 'clarificationRules', 'manifest']);
  const aliasLexiconPath = resolveMaybeRelative(artifact.manifest.files.aliasLexicon, dirPath);
  const slotSchemaPath = resolveMaybeRelative(artifact.manifest.files.slotSchema, dirPath);
  const utterancePatternsPath = resolveMaybeRelative(artifact.manifest.files.utterancePatterns, dirPath);
  const entryRulesPath = resolveMaybeRelative(artifact.manifest.files.entryRules, dirPath);
  const clarificationRulesPath = resolveMaybeRelative(artifact.manifest.files.clarificationRules, dirPath);
  return {
    step: 'step-5-nl-entry',
    key: 'nlEntry',
    ...artifact,
    aliasLexiconPath,
    slotSchemaPath,
    utterancePatternsPath,
    entryRulesPath,
    clarificationRulesPath,
    aliasLexiconDocument: await readJsonFile(aliasLexiconPath),
    slotSchemaDocument: await readJsonFile(slotSchemaPath),
    utterancePatternsDocument: await readJsonFile(utterancePatternsPath),
    entryRulesDocument: await readJsonFile(entryRulesPath),
    clarificationRulesDocument: await readJsonFile(clarificationRulesPath),
  };
}

async function loadDocsFromDir(dirPath) {
  const artifact = await loadManifestArtifactFromDir(dirPath, MANIFEST_NAMES.docs, 'Docs', ['readme', 'glossary', 'stateMap', 'actions', 'recovery', 'manifest']);
  const docsManifest = artifact.manifest;
  const documents = toArray(docsManifest.documents);
  const docsWithContent = [];
  for (const document of documents) {
    const documentPath = resolveMaybeRelative(document.path, dirPath);
    if (!(await pathExists(documentPath))) {
      throw new Error(`Doc file missing: ${documentPath}`);
    }
    docsWithContent.push({
      ...document,
      path: path.resolve(documentPath),
      content: /\.md$/i.test(documentPath) ? await readFile(documentPath, 'utf8') : null,
    });
  }
  return {
    step: 'step-6-docs',
    key: 'docs',
    ...artifact,
    documents: docsWithContent,
  };
}

async function discoverDocs(workspaceRoot, inputUrl) {
  const parent = path.join(workspaceRoot, ROOT_DIRS.operationDocs);
  const candidates = [];
  for (const dirPath of await listDirectories(parent)) {
    try {
      const docs = await loadDocsFromDir(dirPath);
      if (!sameHost(docs.baseUrl, inputUrl)) {
        continue;
      }
      docs.sortKey = await candidateSortKey(dirPath, docs.generatedAt);
      candidates.push(docs);
    } catch {
      // Ignore invalid docs artifacts.
    }
  }
  candidates.sort((left, right) => right.sortKey - left.sortKey);
  return candidates[0] ?? null;
}

async function loadGovernanceFromDir(dirPath) {
  const riskTaxonomyPath = path.join(dirPath, 'risk-taxonomy.json');
  const approvalRulesPath = path.join(dirPath, 'approval-rules.json');
  const recoveryRulesPath = path.join(dirPath, 'recovery-rules.json');
  const recoveryMarkdownPath = path.join(dirPath, 'recovery.md');
  const approvalMarkdownPath = path.join(dirPath, 'approval-checkpoints.md');

  for (const filePath of [riskTaxonomyPath, approvalRulesPath, recoveryRulesPath, recoveryMarkdownPath, approvalMarkdownPath]) {
    if (!(await pathExists(filePath))) {
      throw new Error(`Governance file missing: ${filePath}`);
    }
  }

  const riskTaxonomyDocument = await readJsonFile(riskTaxonomyPath);
  const approvalRulesDocument = await readJsonFile(approvalRulesPath);
  const recoveryRulesDocument = await readJsonFile(recoveryRulesPath);

  return {
    step: 'step-7-governance',
    key: 'governance',
    dir: path.resolve(dirPath),
    manifestPath: null,
    manifest: null,
    generatedAt: firstNonEmpty([
      riskTaxonomyDocument.generatedAt,
      approvalRulesDocument.generatedAt,
      recoveryRulesDocument.generatedAt,
    ]),
    baseUrl: normalizeUrlNoFragment(firstNonEmpty([
      riskTaxonomyDocument.baseUrl,
      approvalRulesDocument.baseUrl,
      recoveryRulesDocument.baseUrl,
    ])),
    runId: path.basename(dirPath),
    riskTaxonomyPath,
    approvalRulesPath,
    recoveryRulesPath,
    recoveryMarkdownPath,
    approvalMarkdownPath,
    riskTaxonomyDocument,
    approvalRulesDocument,
    recoveryRulesDocument,
    recoveryMarkdown: await readFile(recoveryMarkdownPath, 'utf8'),
    approvalMarkdown: await readFile(approvalMarkdownPath, 'utf8'),
  };
}

function governanceMatchesChain(governance, docsDir, knownActionIds, knownEdgeIds) {
  if (!governance || !docsDir) {
    return false;
  }
  const approvalRules = toArray(governance.approvalRulesDocument?.rules);
  const recoveryRules = toArray(governance.recoveryRulesDocument?.rules);
  const approvalActionIds = uniqueSortedStrings(approvalRules.flatMap((rule) => toArray(rule.appliesTo?.actionIds)));
  const evidenceEdgeIds = uniqueSortedStrings([
    ...approvalRules.flatMap((rule) => toArray(rule.evidence?.edgeIds)),
    ...recoveryRules.flatMap((rule) => toArray(rule.evidence?.edgeIds)),
  ]);
  const evidenceDocPaths = uniqueSortedPaths([
    ...approvalRules.flatMap((rule) => toArray(rule.evidence?.docPaths)),
    ...recoveryRules.flatMap((rule) => toArray(rule.evidence?.docPaths)),
  ]);

  const actionMatch = approvalActionIds.every((actionId) => knownActionIds.has(actionId));
  const edgeMatch = evidenceEdgeIds.every((edgeId) => knownEdgeIds.has(edgeId));
  const docMatch = evidenceDocPaths.every((docPath) => docPath.startsWith(path.resolve(docsDir)));
  return actionMatch && edgeMatch && docMatch;
}

async function discoverGovernance(workspaceRoot, baseUrl, docsDir, knownActionIds, knownEdgeIds) {
  const parent = path.join(workspaceRoot, ROOT_DIRS.governance);
  const validCandidates = [];
  const fallbackCandidates = [];

  for (const dirPath of await listDirectories(parent)) {
    try {
      const governance = await loadGovernanceFromDir(dirPath);
      if (!sameHost(governance.baseUrl, baseUrl)) {
        continue;
      }
      governance.sortKey = await candidateSortKey(dirPath, governance.generatedAt);
      if (governanceMatchesChain(governance, docsDir, knownActionIds, knownEdgeIds)) {
        validCandidates.push(governance);
      } else {
        fallbackCandidates.push(governance);
      }
    } catch {
      // Ignore invalid governance artifacts.
    }
  }

  validCandidates.sort((left, right) => right.sortKey - left.sortKey);
  fallbackCandidates.sort((left, right) => right.sortKey - left.sortKey);
  return validCandidates[0] ?? fallbackCandidates[0] ?? null;
}

async function resolveCompileArtifacts(inputUrl, options) {
  const workspaceRoot = process.cwd();
  const warnings = [];

  const docs = options.docsManifestPath
    ? await loadDocsFromDir(path.dirname(path.resolve(options.docsManifestPath)))
    : options.docsDir
      ? await loadDocsFromDir(path.resolve(options.docsDir))
      : await discoverDocs(workspaceRoot, inputUrl);

  if (!docs) {
    throw new Error('Unable to resolve step-6 docs artifacts. Pass --docs-dir or --docs-manifest.');
  }

  const baseUrl = normalizeUrlNoFragment(firstNonEmpty([docs.baseUrl, inputUrl])) ?? inputUrl;
  const host = sanitizeHost(hostFromUrl(baseUrl) ?? hostFromUrl(inputUrl) ?? 'unknown-host');

  const analysis = options.analysisManifestPath
    ? await loadAnalysisFromDir(path.dirname(path.resolve(options.analysisManifestPath)))
    : options.analysisDir
      ? await loadAnalysisFromDir(path.resolve(options.analysisDir))
      : await loadAnalysisFromDir(path.resolve(docs.manifest.source?.analysisDir ?? path.dirname(path.resolve(docs.manifest.source?.analysisManifest ?? ''))));

  const abstraction = options.abstractionManifestPath
    ? await loadAbstractionFromDir(path.dirname(path.resolve(options.abstractionManifestPath)))
    : options.abstractionDir
      ? await loadAbstractionFromDir(path.resolve(options.abstractionDir))
      : await loadAbstractionFromDir(path.resolve(docs.manifest.source?.abstractionDir ?? path.dirname(path.resolve(docs.manifest.source?.abstractionManifest ?? ''))));

  const nlEntry = options.nlEntryManifestPath
    ? await loadNlEntryFromDir(path.dirname(path.resolve(options.nlEntryManifestPath)))
    : options.nlEntryDir
      ? await loadNlEntryFromDir(path.resolve(options.nlEntryDir))
      : await loadNlEntryFromDir(path.resolve(docs.manifest.source?.nlEntryDir ?? path.dirname(path.resolve(docs.manifest.source?.nlEntryManifest ?? ''))));

  const expanded = options.expandedStatesDir
    ? await loadExpandedFromDir(path.resolve(options.expandedStatesDir))
    : docs.manifest.source?.expandedStatesDir
      ? await loadExpandedFromDir(path.resolve(docs.manifest.source.expandedStatesDir))
      : await discoverExpanded(workspaceRoot, baseUrl);

  if (!expanded) {
    throw new Error('Unable to resolve step-2 expanded-state artifacts.');
  }

  const bookContent = options.skipBookContent
    ? null
    : options.bookContentDir
      ? await loadBookContentFromDir(path.resolve(options.bookContentDir))
      : await discoverBookContent(workspaceRoot, baseUrl);

  const capture = options.captureDir
    ? await loadCaptureFromDir(path.resolve(options.captureDir))
    : await discoverCapture(workspaceRoot, baseUrl);

  if (!capture) {
    throw new Error('Unable to resolve step-1 capture artifacts.');
  }

  const knownActionIds = new Set(toArray(abstraction.actionsDocument?.actions).map((action) => action.actionId));
  const knownEdgeIds = new Set(toArray(analysis.transitionsDocument?.edges).map((edge) => edge.edgeId));

  const governance = options.governanceDir
    ? await loadGovernanceFromDir(path.resolve(options.governanceDir))
    : await discoverGovernance(workspaceRoot, baseUrl, docs.dir, knownActionIds, knownEdgeIds);

  if (!governance) {
    throw new Error('Unable to resolve step-7 governance artifacts.');
  }

  return {
    inputUrl,
    baseUrl,
    host,
    workspaceRoot,
    warnings,
    capture,
    expanded,
    bookContent,
    analysis,
    abstraction,
    nlEntry,
    docs,
    governance,
  };
}

function buildKbLayout(baseUrl, explicitKbDir) {
  const host = sanitizeHost(hostFromUrl(baseUrl) ?? 'unknown-host');
  const kbDir = explicitKbDir
    ? path.resolve(explicitKbDir)
    : path.join(process.cwd(), ROOT_DIRS.knowledgeBase, host);
  return {
    kbDir,
    rawDir: path.join(kbDir, KB_DIRS.raw),
    wikiDir: path.join(kbDir, KB_DIRS.wiki),
    schemaDir: path.join(kbDir, KB_DIRS.schema),
    indexDir: path.join(kbDir, KB_DIRS.index),
    logDir: path.join(kbDir, KB_DIRS.log),
    reportsDir: path.join(kbDir, KB_DIRS.reports),
  };
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
  const sourceRunIds = {};
  for (const source of sources.filter(Boolean)) {
    sourceRunIds[source.key] = source.runId;
  }
  return sourceRunIds;
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
  return {
    inputUrl,
    baseUrl,
    generatedAt,
    activeSources: copiedSources.map((source) => ({
      step: source.step,
      key: source.key,
      runId: source.runId,
      originalDir: source.dir,
      rawDir: source.rawDirRelative,
      manifestPath: source.manifestPath,
      generatedAt: source.generatedAt,
      reused: source.reused,
    })),
  };
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

function collectDocByIntent(documents) {
  const map = new Map();
  for (const document of toArray(documents)) {
    if (document?.intentId) {
      map.set(document.intentId, document);
    }
  }
  return map;
}

function summarizeRiskEvidence(rule) {
  return {
    stateIds: uniqueSortedStrings(rule?.evidence?.stateIds),
    edgeIds: uniqueSortedStrings(rule?.evidence?.edgeIds),
    docPaths: uniqueSortedPaths(rule?.evidence?.docPaths),
  };
}

function buildDataModel(artifacts) {
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

  if (isBilibiliKnowledgeBase(artifacts.baseUrl)) {
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

function finalizeDataModel(model) {
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

function buildPageDescriptors(context) {
  const {
    generatedAt,
    artifacts,
    model,
    rawResolver,
    siteContext,
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
    attributes: isBilibiliKnowledgeBase(artifacts.baseUrl)
      ? {
          bilibiliFacts: summarizeBilibiliKnowledgeFacts(model.states),
        }
      : {},
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
        bilibiliFacts: buildBilibiliStateAttributeFacts(state.pageFacts),
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

function buildPagesById(pages) {
  return new Map(pages.map((page) => [page.pageId, page]));
}

function collectPageIdsByKind(pages, kind) {
  return pages.filter((page) => page.kind === kind).map((page) => page.pageId);
}

function renderSourceRefList(page, currentPagePath) {
  if (!page.sourceRefs.length) {
    return '- 无';
  }
  return page.sourceRefs
    .map((ref) => `- ${markdownLink(ref.label ?? ref.kind, currentPagePath, ref.path)} (${ref.kind})`)
    .join('\n');
}

function renderRelatedPageList(page, pagesById, currentPagePath) {
  if (!page.relatedIds.length) {
    return '- 无';
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

function buildBilibiliStateAttributeFacts(pageFacts) {
  if (!pageFacts) {
    return null;
  }
  const featuredAuthorCards = toArray(pageFacts.featuredAuthorCards).slice(0, 5).map((author) => ({
    name: author?.name ?? null,
    url: author?.url ?? null,
    mid: author?.mid ?? null,
    authorSubpage: author?.authorSubpage ?? null,
    cardKind: author?.cardKind ?? null,
  }));
  const featuredContentCards = toArray(pageFacts.featuredContentCards).slice(0, 5).map((card) => ({
    title: card?.title ?? null,
    url: card?.url ?? null,
    bvid: card?.bvid ?? null,
    authorMid: card?.authorMid ?? null,
    contentType: card?.contentType ?? null,
  }));
  const featuredAuthors = (featuredAuthorCards.length > 0 ? featuredAuthorCards : toArray(pageFacts.featuredAuthors)).slice(0, 5).map((author) => ({
    name: author?.name ?? null,
    url: author?.url ?? null,
    mid: author?.mid ?? null,
  }));
  const facts = {
    bv: pageFacts.bv ?? pageFacts.bvid ?? null,
    authorMid: pageFacts.authorMid ?? null,
    searchFamily: pageFacts.searchFamily ?? null,
    queryText: pageFacts.queryText ?? null,
    contentType: pageFacts.contentType ?? null,
    firstResultContentType: pageFacts.firstResultContentType ?? pageFacts.resultContentTypes?.[0] ?? null,
    authorSubpage: pageFacts.authorSubpage ?? null,
    authenticatedReadOnlySurface: pageFacts.authenticatedReadOnlySurface === true,
    categoryName: pageFacts.categoryName ?? null,
    categoryPath: pageFacts.categoryPath ?? null,
    featuredAuthorCount: Number(pageFacts.featuredAuthorCount ?? featuredAuthors.length ?? 0) || 0,
    featuredAuthorCards,
    featuredAuthors,
    featuredContentCount: Number(pageFacts.featuredContentCount ?? featuredContentCards.length ?? 0) || 0,
    featuredContentCards,
  };
  return Object.values(facts).some((value) => (
    Array.isArray(value) ? value.length > 0 : value !== null && value !== ''
  )) ? facts : null;
}

function renderBilibiliOverviewFacts(model) {
  const summary = summarizeBilibiliKnowledgeFacts(model.states);
  if (
    summary.videoCodes.length === 0
    && summary.authorMids.length === 0
    && summary.searchFamilies.length === 0
    && summary.featuredAuthors.length === 0
    && summary.authenticatedSurfaceKinds.length === 0
    && summary.featuredContentCards.length === 0
  ) {
    return [];
  }
  const featuredCardSummary = summary.featuredContentCards
    .slice(0, 5)
    .map((card) => {
      const parts = [
        card.title ?? null,
        card.bvid ? `BV ${card.bvid}` : null,
        card.authorMid ? `MID ${card.authorMid}` : null,
      ].filter(Boolean);
      return parts.join(' | ');
    })
    .filter(Boolean);
  const featuredAuthorSummary = summary.featuredAuthors
    .slice(0, 5)
    .map((author) => {
      const parts = [
        author.name ?? null,
        author.mid ? `MID ${author.mid}` : null,
      ].filter(Boolean);
      return parts.join(' | ');
    })
    .filter(Boolean);
  const authenticatedSurfaceRows = toArray(summary.authenticatedSurfaceSummaries)
    .slice(0, 5)
    .map((surface) => ({
      authorSubpage: mdEscape(cleanText(surface.authorSubpage) || '-'),
      featuredAuthors: String(Number.isFinite(surface.featuredAuthorCount) ? surface.featuredAuthorCount : 0),
      featuredContent: String(Number.isFinite(surface.featuredContentCount) ? surface.featuredContentCount : 0),
      antiCrawlSignals: toArray(surface.antiCrawlSignals).map((value) => cleanText(value)).filter(Boolean).join(', ') || '-',
      state: mdEscape(cleanText(surface.stateId) || '-'),
    }));
  return [
    '## Surfaced bilibili facts',
    '',
    `- Video codes: ${summary.videoCodes.join(', ') || '-'}`,
    `- Author mids: ${summary.authorMids.join(', ') || '-'}`,
    `- Search families: ${summary.searchFamilies.join(', ') || '-'}`,
    `- Authenticated session active during compilation: ${summary.authenticatedSessionObserved ? 'yes' : 'no'}`,
    `- Authenticated read-only surfaces: ${summary.authenticatedSurfaceKinds.join(', ') || '-'}`,
    `- Featured authors: ${featuredAuthorSummary.join(' ; ') || '-'}`,
    `- Featured content cards: ${featuredCardSummary.join(' ; ') || '-'}`,
    '',
    '### Authenticated surface summaries',
    '',
    authenticatedSurfaceRows.length > 0
      ? renderTable(['Author Subpage', 'Featured Authors', 'Featured Content', 'Anti-crawl Signals', 'State'], authenticatedSurfaceRows)
      : '- No authenticated surface summaries.',
    '',
  ];
}

function renderBilibiliStateFacts(pageFacts) {
  if (!pageFacts) {
    return [];
  }
  const rows = [];
  if (pageFacts.bv ?? pageFacts.bvid) {
    rows.push(`- BV: \`${pageFacts.bv ?? pageFacts.bvid}\``);
  }
  if (pageFacts.authorMid) {
    rows.push(`- Author MID: \`${pageFacts.authorMid}\``);
  }
  if (pageFacts.queryText) {
    rows.push(`- Search query: ${mdEscape(pageFacts.queryText)}`);
  }
  if (pageFacts.searchFamily) {
    rows.push(`- Search family: \`${pageFacts.searchFamily}\``);
  }
  if (pageFacts.authenticatedReadOnlySurface) {
    rows.push('- Authenticated read-only surface: yes');
  }
  if (pageFacts.authorSubpage) {
    rows.push(`- Author subpage: \`${pageFacts.authorSubpage}\``);
  }
  const featuredAuthors = toArray(pageFacts.featuredAuthors);
  if (featuredAuthors.length > 0) {
    rows.push(`- Featured authors: ${featuredAuthors.map((author) => {
      const parts = [
        author?.name ?? null,
        author?.mid ? `MID ${author.mid}` : null,
      ].filter(Boolean);
      return mdEscape(parts.join(' | '));
    }).join(' ; ')}`);
  }
  const featuredCards = toArray(pageFacts.featuredContentCards);
  if (featuredCards.length > 0) {
    rows.push(`- Featured content cards: ${featuredCards.map((card) => {
      const parts = [
        card?.title ?? null,
        card?.bvid ? `BV ${card.bvid}` : null,
        card?.authorMid ? `MID ${card.authorMid}` : null,
      ].filter(Boolean);
      return mdEscape(parts.join(' | '));
    }).join(' ; ')}`);
  }
  if (Number.isFinite(pageFacts.resultCount)) {
    rows.push(`- Result count: ${pageFacts.resultCount}`);
  }
  return rows.length > 0 ? ['## Page facts', '', ...rows, ''] : [];
}

function renderReadmePage(page, context, pagesById) {
  const { model, artifacts } = context;
  const sections = [
    '# 知识库总览',
    '',
    '这个知识库将 1-7 步的分析产物编译为可维护、可导航、可追溯的本地知识底座。',
    '',
    '## 站点摘要',
    '',
    `- 入口 URL：\`${artifacts.inputUrl}\``,
    `- 基准 URL：\`${artifacts.baseUrl}\``,
    `- 状态数：${model.states.length}`,
    `- 元素数：${model.elements.length}`,
    `- 意图数：${model.intents.length}`,
    `- 风险分类数：${model.riskCategories.length}`,
    '',
    '## 导航',
    '',
    `- ${pageRefById(pagesById, 'page_overview_site', page.path)}`,
    `- ${pageRefById(pagesById, 'page_concept_interaction_model', page.path)}`,
    `- ${pageRefById(pagesById, 'page_concept_nl_entry', page.path)}`,
    `- ${pageRefById(pagesById, 'page_concept_governance', page.path)}`,
    `- ${pageRefById(pagesById, 'page_comparison_state_coverage', page.path)}`,
    '',
    '## 类别入口',
    `- 状态页：${collectPageIdsByKind([...pagesById.values()], 'state').length} 个`,
    `- 元素页：${collectPageIdsByKind([...pagesById.values()], 'element').length} 个`,
    `- 意图页：${collectPageIdsByKind([...pagesById.values()], 'intent').length} 个`,
    `- 流程页：${collectPageIdsByKind([...pagesById.values()], 'flow').length} 个`,
    `- 风险页：${collectPageIdsByKind([...pagesById.values()], 'risk').length} 个`,
    '',
    '## 证据引用',
    '',
    renderSourceRefList(page, page.path),
    '',
    '## 关联页面',
    '',
    renderRelatedPageList(page, pagesById, page.path),
  ];
  return sections.join('\n');
}

function renderOverviewPage(page, context, pagesById) {
  const { model, artifacts } = context;
  const initialState = model.states.find((state) => state.sourceStatus === 'initial') ?? model.states[0];
  const actionables = model.intents.flatMap((intent) => toArray(intent.targetDomain?.actionableValues)).length;
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
    .filter((state) => toArray(state.pageFactHighlights?.featuredContentCards).length > 0)
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
      count: String(state.pageFactHighlights?.featuredContentCardCount ?? toArray(state.pageFactHighlights?.featuredContentCards).length),
    }));
  return [
    '# 站点总览',
    '',
    '## 站点信息',
    '',
    `- Host：\`${sanitizeHost(hostFromUrl(artifacts.baseUrl) ?? 'unknown-host')}\``,
    `- 基准 URL：\`${artifacts.baseUrl}\``,
    `- 初始标题：${mdEscape(initialState?.title ?? artifacts.capture.manifest?.title ?? '-')}`,
    '',
    '## 规模摘要',
    '',
    `- concrete states：${model.states.length}`,
    `- observed edges：${model.edges.length}`,
    `- 元素组：${model.elements.length}`,
    `- 动作原语：${model.actions.length}`,
    `- 意图：${model.intents.length}`,
    `- 可执行目标值：${actionables}`,
    '',
    '## 意图总览',
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
      ? renderTable(['State', 'Featured Cards', 'Count'], featuredCardRows)
      : '- No featured content cards observed.',
    '',
    ...renderBilibiliOverviewFacts(model),
    '## 关键入口',
    '',
    `- ${pageRefById(pagesById, 'page_comparison_state_coverage', page.path)}`,
    `- ${pageRefById(pagesById, 'page_concept_interaction_model', page.path)}`,
    '',
    '## 证据引用',
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
    '# 交互模型',
    '',
    '本页说明从 DOM/状态证据到元素、状态、转移、意图和动作原语的建模链路。',
    '',
    '## 元素',
    '',
    renderTable(['Element', 'Kind', 'Members', 'Evidence States'], elementRows),
    '',
    '## 意图映射',
    '',
    renderTable(['Intent', 'State Field', 'Action', 'Evidence Edges'], intentRows),
    '',
    '## 相关页面',
    '',
    renderRelatedPageList(page, pagesById, page.path),
    '',
    '## 证据引用',
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
    '# 交互模型',
    '',
    '本页汇总站点原型、能力矩阵、元素组、意图和动作原语，说明当前站点的可执行交互边界。',
    '',
    '## Site Profile',
    '',
    siteProfileRows.length > 0
      ? renderTable(['Primary Archetype', 'Archetypes', 'Capability Families', 'Page Types', 'Semantic Page Types', 'Confidence'], siteProfileRows)
      : 'No site-profile.json available.',
    '',
    '## 元素',
    '',
    renderTable(['Element', 'Kind', 'Members', 'Evidence States'], elementRows),
    '',
    '## 意图映射',
    '',
    renderTable(['Intent', 'State Field', 'Action', 'Evidence Edges'], intentRows),
    '',
    '## Capability Matrix',
    '',
    capabilityRows.length > 0
      ? renderTable(['Intent', 'Capability Family', 'Primitive', 'Actionable Targets'], capabilityRows)
      : 'No capability-matrix.json available.',
    '',
    '## 相关页面',
    '',
    renderRelatedPageList(page, pagesById, page.path),
    '',
    '## 证据引用',
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
    '# 自然语言入口',
    '',
    '本页汇总别名词典、槽位定义、表达模式与入口规则，说明用户语句如何被映射到可执行计划。',
    '',
    '## 表达模式',
    '',
    renderTable(['Intent', 'Pattern Type', 'Priority', 'Regex'], patternRows),
    '',
    '## 入口规则',
    '',
    renderTable(['Intent', 'Mode', 'Target Resolution', 'Decision Rules'], ruleRows),
    '',
    '## 澄清规则',
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
    '## 证据引用',
    '',
    renderSourceRefList(page, page.path),
  ].join('\n');
}

function renderGovernanceConceptPage(page, context) {
  const { model } = context;
  return [
    '# 治理与恢复',
    '',
    '本页汇总恢复规则、审批规则和风险分类，定义执行时的安全边界。',
    '',
    '## 风险分类',
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
    '## 恢复规则',
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
    '## 审批规则',
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
    '## 证据引用',
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
    '# 状态覆盖对比',
    '',
    '## States',
    '',
    renderTable(['State', 'Type', 'Final URL', 'Element States'], stateRows),
    '',
    '## Observed Transitions',
    '',
    renderTable(['From', 'To', 'Outcome', 'Trigger'], edgeRows),
    '',
    '## 证据引用',
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
  const featuredCards = toArray(state.pageFactHighlights?.featuredContentCards).map((card) => ({
    title: mdEscape(cleanText(card?.title) || cleanText(card?.bvid) || cleanText(card?.url) || '-'),
    contentType: cleanText(card?.contentType) || '-',
    bvid: cleanText(card?.bvid) || '-',
    authorMid: cleanText(card?.authorMid) || '-',
  }));
  return [
    `# ${mdEscape(page.title)}`,
    '',
    '## 状态信息',
    '',
    `- Source Status：\`${state.sourceStatus}\``,
    `- Final URL：\`${state.finalUrl}\``,
    `- Title：${mdEscape(state.title ?? '-')}`,
    `- Captured At：\`${state.capturedAt ?? '-'}\``,
    edge ? `- 进入触发：${mdEscape(edge.trigger?.label ?? edge.stateName ?? edge.observedStateId)}` : '- 进入触发：初始状态',
    '',
    '## 元素状态',
    '',
    renderTable(['Element', 'Kind', 'Value'], elementRows),
    '',
    '## 关联页面',
    '',
    renderRelatedPageList(page, pagesById, page.path),
    '',
    '## 证据引用',
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
    '## 状态信息',
    '',
    `- Source Status：\`${state.sourceStatus}\``,
    `- Final URL：\`${state.finalUrl}\``,
    `- Title：${mdEscape(state.title ?? '-')}`,
    `- Captured At：\`${state.capturedAt ?? '-'}\``,
    edge ? `- 进入触发：${mdEscape(edge.trigger?.label ?? edge.stateName ?? edge.observedStateId)}` : '- 进入触发：初始状态',
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
    '## 元素状态',
    '',
    renderTable(['Element', 'Kind', 'Value'], elementRows),
    '',
    '## 关联页面',
    '',
    renderRelatedPageList(page, pagesById, page.path),
    '',
    '## 证据引用',
    '',
    renderSourceRefList(page, page.path),
  ].join('\n');
}

function renderStatePageEnhanced(page, context, pagesById) {
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
  if (Number.isFinite(state.pageFacts?.resultCount)) {
    factRows.push({ field: 'Result Count', value: String(state.pageFacts.resultCount) });
  }
  const featuredCards = toArray(state.pageFactHighlights?.featuredContentCards).map((card) => ({
    title: mdEscape(cleanText(card?.title) || cleanText(card?.bvid) || cleanText(card?.url) || '-'),
    contentType: cleanText(card?.contentType) || '-',
    bvid: cleanText(card?.bvid) || '-',
    authorMid: cleanText(card?.authorMid) || '-',
  }));
  const featuredAuthorCards = toArray(state.pageFactHighlights?.featuredAuthorCards).map((author) => ({
    name: mdEscape(cleanText(author?.name) || '-'),
    mid: cleanText(author?.mid) || '-',
    url: mdEscape(cleanText(author?.url) || '-'),
    authorSubpage: cleanText(author?.authorSubpage) || cleanText(state.pageFactHighlights?.authorSubpage) || '-',
  }));

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
    '## Featured Content Cards',
    '',
    featuredCards.length > 0
      ? renderTable(['Title', 'Content Type', 'BV', 'UP Mid'], featuredCards)
      : '- No featured content cards.',
    '',
    '## Featured Author Cards',
    '',
    featuredAuthorCards.length > 0
      ? renderTable(['Name', 'MID', 'Author URL', 'Author Subpage'], featuredAuthorCards)
      : '- No featured author cards.',
    '',
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
    '## 元素信息',
    '',
    `- Kind：\`${element.kind}\``,
    `- Group Key：\`${element.groupKey}\``,
    `- Trigger Kinds：${uniqueSortedStrings(element.evidence?.triggerKinds).join(', ') || '-'}`,
    '',
    '## 成员',
    '',
    renderTable(['Member ID', 'Label', 'Controlled Target', 'Source States'], memberRows),
    '',
    '## 关联页面',
    '',
    renderRelatedPageList(page, pagesById, page.path),
    '',
    '## 证据引用',
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
    '## 意图定义',
    '',
    `- Intent Type：\`${intent.intentType}\``,
    `- Action：\`${intent.actionId}\``,
    `- State Field：\`${intent.stateField}\``,
    `- Source Element：${pageRefById(pagesById, `page_element_${intent.elementId}`, page.path)}`,
    '',
    '## 槽位',
    '',
    slotRows.length ? renderTable(['Slot', 'Value Type', 'Required', 'Source'], slotRows) : '- 无',
    '',
    '## 表达模式',
    '',
    patternRows.length ? renderTable(['Pattern Type', 'Priority', 'Regex'], patternRows) : '- 无',
    '',
    '## 值域',
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
    '## 关联页面',
    '',
    renderRelatedPageList(page, pagesById, page.path),
    '',
    '## 证据引用',
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
    '## 用户表达',
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
    '## 适用前提',
    `- Current page must resolve source element ${pageRefById(pagesById, `page_element_${intent.elementId}`, page.path)}.`,
    '- Runtime must provide `currentElementState`.',
    `- 运行时需要提供 \`currentElementState\`。`,
    '',
    '## 起始状态',
    '',
    uniqueSortedStrings(intent.evidence?.stateIds).map((stateId) => `- ${pageRefById(pagesById, `page_state_${stateId}`, page.path)}`).join('\n') || '- 无',
    '',
    '## 目标状态',
    '',
    renderTable(['Target', 'To States', 'Edges', 'Observed'], buildIntentSuccessRows(intent, model)),
    '',
    '## 主路径步骤',
    '',
    mainPathRows.length ? renderTable(['Target', 'Action', 'To States', 'Edge IDs'], mainPathRows) : '- 无已观测动作路径',
    '',
    '## 已满足规则（noop）',
    '',
    noopRows.length ? renderTable(['Target', 'When', 'To States'], noopRows) : '- 无',
    '',
    '## 异常恢复',
    '',
    recoveryRows.length ? renderTable(['Exception', 'Strategy', 'Retryable', 'Approval'], recoveryRows) : '- 无',
    '',
    '## 成功信号',
    '',
    renderTable(['Target', 'To States', 'Edges', 'Observed'], buildIntentSuccessRows(intent, model)),
    '',
    '## 审批要求',
    '',
    approvalRows.length ? renderTable(['Risk', 'Checkpoint', 'Rationale'], approvalRows) : '- 当前意图在已观测 in-domain 模型中无需审批。',
    '',
    '## 入口规则',
    '',
    entryRows.length ? renderTable(['Mode', 'Resolution', 'Decision Rules'], entryRows) : '- 无',
    '## 关联证据 / 状态引用',
    '',
    (() => {
      const docRef = page.sourceRefs.find((ref) => ref.label === '第六步流程文档');
      return docRef
        ? `- 第六步流程文档：${markdownLink(intentDoc?.title ?? docRef.label ?? '第六步流程文档', page.path, docRef.path)}`
        : '- 第六步流程文档：无';
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
    '## 风险定义',
    '',
    `- Severity：\`${risk.severity}\``,
    `- Approval Required：\`${String(Boolean(risk.approvalRequired))}\``,
    `- Default Recovery：\`${risk.defaultRecovery}\``,
    `- Description：${mdEscape(risk.description ?? '-')}`,
    '',
    '## 触发条件',
    '',
    renderTable(['Field', 'Values'], [
      { field: 'Action IDs', values: uniqueSortedStrings(risk.triggers?.actionIds).join(', ') || '-' },
      { field: 'Intent Types', values: uniqueSortedStrings(risk.triggers?.intentTypes).join(', ') || '-' },
      { field: 'Keywords', values: uniqueSortedStrings(risk.triggers?.keywords).join(', ') || '-' },
      { field: 'URL Patterns', values: uniqueSortedStrings(risk.triggers?.urlPatterns).join(', ') || '-' },
    ]),
    '',
    '## 审批检查点',
    '',
    approvalRules.length
      ? approvalRules.map((rule) => [
        `### ${mdEscape(rule.approval?.checkpointLabel ?? rule.approvalRuleId)}`,
        '',
        `- 审批原因：${mdEscape(rule.approval?.rationale ?? '-')}`,
        `- 审批人：\`${rule.approval?.approver ?? '-'}\``,
        `- 默认拒绝：\`${String(Boolean(rule.approval?.denyByDefault))}\``,
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
      : '当前样本中没有直接命中的审批规则，但该风险类型仍保留为治理字典。',
    '',
    '## 当前页面观测情况',
    '',
    `- Observed States：${observedStateIds.length}`,
    `- Observed Edges：${observedEdgeIds.length}`,
    '',
    '## 证据引用',
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
    syncKnowledgeBaseSiteMetadata,
  });
}

function printHelp() {
  console.log([
    'Usage:',
    '  node compile-wiki.mjs compile <url> [--kb-dir <dir>] [--capture-dir <dir>] [--expanded-states-dir <dir>] [--book-content-dir <dir>] [--analysis-dir <dir>] [--analysis-manifest <path>] [--abstraction-dir <dir>] [--abstraction-manifest <path>] [--nl-entry-dir <dir>] [--nl-entry-manifest <path>] [--docs-dir <dir>] [--docs-manifest <path>] [--governance-dir <dir>] [--strict <true|false>]',
    '  node compile-wiki.mjs lint --kb-dir <dir> [--report-dir <dir>] [--fail-on-warnings <true|false>]',
  ].join('\n'));
}

function parseCliArgs(argv) {
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

async function runCli() {
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

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (entryPath && fileURLToPath(import.meta.url) === entryPath) {
  runCli().catch((error) => {
    console.error(error?.message ?? String(error));
    process.exitCode = 1;
  });
}
