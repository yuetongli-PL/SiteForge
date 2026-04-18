import path from 'node:path';
import { writeJsonFile, writeTextFile } from '../io.mjs';

function buildNamingRulesDocument() {
  return {
    titleLanguage: 'zh-primary',
    slugMode: 'ascii',
    pageIdPattern: '^page_[a-z0-9_]+$',
    fileRules: {
      wiki: 'Markdown files under wiki/, slug uses ASCII and hyphen.',
      raw: 'Copied immutable source artifacts under raw/.',
      indexes: 'Derived from pages.json only; do not hand-edit category indexes.',
    },
  };
}

function buildEvidenceRulesDocument() {
  return {
    evidenceRoot: 'raw/',
    allowedKinds: ['html', 'snapshot', 'screenshot', 'manifest', 'json', 'markdown'],
    linkPolicy: {
      rawOnly: true,
      forbidUpstreamAbsolutePaths: true,
      requireExistingTargets: true,
    },
    pagePolicy: {
      requireKbMeta: true,
      requireSourceRefs: false,
      requireUpdatedAt: true,
    },
  };
}

function buildIndexEntrySchema() {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    required: ['pageId', 'kind', 'title', 'summary', 'path', 'updatedAt', 'sourceRefs', 'relatedIds'],
    properties: {
      pageId: { type: 'string' },
      kind: { type: 'string' },
      title: { type: 'string' },
      summary: { type: 'string' },
      path: { type: 'string' },
      updatedAt: { type: 'string' },
      sourceRefs: { type: 'array' },
      relatedIds: { type: 'array' },
      attributes: { type: 'object' },
    },
  };
}

function buildWikiPageSchema() {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    required: ['pageId', 'kind', 'title', 'summary', 'path', 'updatedAt', 'sourceRefs', 'relatedIds'],
    properties: {
      pageId: { type: 'string' },
      kind: { type: 'string' },
      title: { type: 'string' },
      summary: { type: 'string' },
      path: { type: 'string' },
      updatedAt: { type: 'string' },
      sourceRefs: { type: 'array' },
      relatedIds: { type: 'array' },
      attributes: { type: 'object' },
    },
  };
}

function buildLintReportSchema() {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    required: ['kbDir', 'generatedAt', 'summary', 'errors', 'warnings'],
    properties: {
      kbDir: { type: 'string' },
      generatedAt: { type: 'string' },
      summary: { type: 'object' },
      errors: { type: 'array' },
      warnings: { type: 'array' },
    },
  };
}

function renderAgentsMd() {
  return [
    '# AGENTS.md',
    '',
    '## Rules',
    '',
    '- `raw/` is immutable evidence. Read it, but do not modify it.',
    '- Start with `index/` when answering questions; drill into `wiki/` and `raw/` only as needed.',
    '- Every wiki update must preserve evidence traceability back to `raw/`.',
    '- After any wiki maintenance, run `node compile-wiki.mjs lint --kb-dir <kb-dir>`.',
    '- Category indexes are projections of `index/pages.json`; do not hand-edit them independently.',
  ].join('\n');
}

function renderTemplateIntent() {
  return [
    '# Intent Page Template',
    '',
    '## 鎰忓浘瀹氫箟',
    '',
    '## 妲戒綅',
    '',
    '## 琛ㄨ揪妯″紡',
    '',
    '## 鍊煎煙',
    '',
    '## 璇佹嵁寮曠敤',
  ].join('\n');
}

function renderTemplateState() {
  return [
    '# State Page Template',
    '',
    '## 鐘舵€佷俊鎭?',
    '',
    '## 鍏冪礌鐘舵€?',
    '',
    '## 璇佹嵁寮曠敤',
  ].join('\n');
}

function renderTemplateRisk() {
  return [
    '# Risk Page Template',
    '',
    '## 椋庨櫓瀹氫箟',
    '',
    '## 瑙﹀彂鏉′欢',
    '',
    '## 瀹℃壒妫€鏌ョ偣',
    '',
    '## 璇佹嵁寮曠敤',
  ].join('\n');
}

export async function writeKnowledgeBaseSchemaFiles(kbDir, kbFiles) {
  await writeTextFile(path.join(kbDir, kbFiles.agents), renderAgentsMd());
  await writeTextFile(path.join(kbDir, kbFiles.intentTemplate), renderTemplateIntent());
  await writeTextFile(path.join(kbDir, kbFiles.stateTemplate), renderTemplateState());
  await writeTextFile(path.join(kbDir, kbFiles.riskTemplate), renderTemplateRisk());
  await writeJsonFile(path.join(kbDir, kbFiles.namingRules), buildNamingRulesDocument());
  await writeJsonFile(path.join(kbDir, kbFiles.evidenceRules), buildEvidenceRulesDocument());
  await writeJsonFile(path.join(kbDir, kbFiles.indexSchema), buildIndexEntrySchema());
  await writeJsonFile(path.join(kbDir, kbFiles.wikiSchema), buildWikiPageSchema());
  await writeJsonFile(path.join(kbDir, kbFiles.lintSchema), buildLintReportSchema());
}
