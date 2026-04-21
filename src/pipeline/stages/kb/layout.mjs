// @ts-check

import path from 'node:path';
import process from 'node:process';
import { stat } from 'node:fs/promises';
import { relativeToKb } from '../../../shared/wiki.mjs';
import { hostFromUrl, sanitizeHost } from '../../../shared/normalize.mjs';

export const ROOT_DIRS = Object.freeze({
  captures: 'captures',
  expanded: 'expanded-states',
  bookContent: 'book-content',
  operationDocs: 'operation-docs',
  governance: 'governance',
  knowledgeBase: 'knowledge-base',
});

export const MANIFEST_NAMES = Object.freeze({
  capture: 'manifest.json',
  expanded: ['states-manifest.json', 'state-manifest.json'],
  bookContent: 'book-content-manifest.json',
  analysis: 'analysis-manifest.json',
  abstraction: 'abstraction-manifest.json',
  nlEntry: 'nl-entry-manifest.json',
  docs: 'docs-manifest.json',
});

export const KB_DIRS = Object.freeze({
  raw: 'raw',
  wiki: 'wiki',
  schema: 'schema',
  index: 'index',
  log: 'log',
  reports: 'reports',
});

export const KB_FILES = Object.freeze({
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
});

export const REQUIRED_DIRS = Object.freeze([
  KB_DIRS.raw,
  KB_DIRS.wiki,
  KB_DIRS.schema,
  KB_DIRS.index,
  KB_DIRS.log,
  KB_DIRS.reports,
]);

export const REQUIRED_FILES = Object.freeze([
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
]);

export function formatTimestampForDir(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.(\d{3})Z$/, '$1Z');
}

export async function candidateSortKey(dirPath, generatedAt) {
  if (generatedAt) {
    const timestamp = Date.parse(generatedAt);
    if (!Number.isNaN(timestamp)) {
      return timestamp;
    }
  }
  const fileStat = await stat(dirPath);
  return fileStat.mtimeMs;
}

export function mergeCompileOptions(defaults, options) {
  return {
    ...defaults,
    ...options,
  };
}

export function mergeLintOptions(defaults, options) {
  return {
    ...defaults,
    ...options,
  };
}

export function buildKbLayout(baseUrl, explicitKbDir) {
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

export function buildSourceRunIds(sources) {
  const sourceRunIds = {};
  for (const source of sources.filter(Boolean)) {
    sourceRunIds[source.key] = source.runId;
  }
  return sourceRunIds;
}

export function buildSourceIndexDocument(kbDir, inputUrl, baseUrl, generatedAt, copiedSources) {
  return {
    inputUrl,
    baseUrl,
    generatedAt,
    activeSources: copiedSources.map((source) => ({
      step: source.step,
      key: source.key,
      runId: source.runId,
      originalDir: source.dir,
      rawDir: source.rawDirRelative ?? relativeToKb(kbDir, source.rawDir),
      manifestPath: source.manifestPath,
      generatedAt: source.generatedAt,
      reused: source.reused,
    })),
  };
}
