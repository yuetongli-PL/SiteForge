// @ts-check

import {
  readdir,
  rm,
} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { initializeCliUtf8, writeJsonStdout } from './lib/cli.mjs';
import { ensureDir, findLatestRunDir, pathExists, readJsonFile, readTextFile, writeTextFile } from './lib/io.mjs';
import { markdownLink, normalizeImportedMarkdown, renderTable, stripKbMeta } from './lib/markdown.mjs';
import { cleanText, firstNonEmpty, hostFromUrl, normalizeWhitespace, relativePath, sanitizeHost, slugifyAscii, toArray, toPosixPath, uniqueSortedStrings } from './lib/normalize.mjs';
import { resolveCapabilityFamiliesFromSiteContext, resolvePageTypesFromSiteContext, resolvePrimaryArchetypeFromSiteContext, resolveSafeActionKindsFromSiteContext, resolveSupportedIntentsFromSiteContext, readSiteContext } from './lib/site-context.mjs';
import { displayIntentName as sharedDisplayIntentName, normalizeDisplayLabel, resolveSiteTerminology } from './lib/site-terminology.mjs';
import { upsertSiteCapabilities } from './lib/site-capabilities.mjs';
import { upsertSiteRegistryRecord } from './lib/site-registry.mjs';

const DEFAULT_OPTIONS = {
  kbDir: undefined,
  outDir: undefined,
  skillName: undefined,
  wikiIndexPath: undefined,
  wikiSchemaPath: undefined,
  flowsDir: undefined,
  recoveryPath: undefined,
  approvalPath: undefined,
  nlIntentsPath: undefined,
  interactionModelPath: undefined,
};

function resolveSkillName(inputUrl, explicitSkillName) {
  if (explicitSkillName) {
    return slugifyAscii(explicitSkillName, 'site-skill');
  }
  try {
    const parsed = new URL(inputUrl);
    const hostLabels = parsed.hostname
      .split('.')
      .map((label) => normalizeWhitespace(label).toLowerCase())
      .filter(Boolean)
      .filter((label) => !['www', 'm'].includes(label));
    const baseLabel = slugifyAscii(hostLabels[0], 'site');
    const firstSegment = parsed.pathname
      .split('/')
      .map((segment) => normalizeWhitespace(segment))
      .find(Boolean);
    const segmentSlug = firstSegment ? slugifyAscii(firstSegment, '') : '';
    return segmentSlug ? `${baseLabel}-${segmentSlug}` : baseLabel;
  } catch {
    return 'site-skill';
  }
}

function mergeOptions(options) {
  const merged = { ...DEFAULT_OPTIONS };
  for (const [key, value] of Object.entries(options ?? {})) {
    if (value !== undefined) {
      merged[key] = value;
    }
  }
  merged.skillName = resolveSkillName(options?.url ?? '', merged.skillName);
  return merged;
}

async function listMarkdownFiles(dirPath) {
  if (!dirPath || !await pathExists(dirPath)) {
    return [];
  }
  const entries = await readdir(dirPath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && /\.md$/iu.test(entry.name))
    .map((entry) => path.join(dirPath, entry.name))
    .sort((left, right) => left.localeCompare(right, 'en'));
}

function buildSourceMapper(kbDir, sourcesDocument) {
  const mappings = [];
  for (const source of sourcesDocument?.activeSources ?? []) {
    const rawAbsolute = path.resolve(kbDir, source.rawDir);
    if (source.originalDir) {
      mappings.push({
        originalDir: path.resolve(source.originalDir),
        rawDir: rawAbsolute,
      });
    }
    mappings.push({
      originalDir: rawAbsolute,
      rawDir: rawAbsolute,
    });
  }
  return (absoluteTarget) => {
    if (!absoluteTarget) {
      return null;
    }
    const resolved = path.resolve(absoluteTarget);
    if (resolved.startsWith(path.resolve(kbDir))) {
      return resolved;
    }
    for (const mapping of mappings) {
      if (resolved === mapping.originalDir || resolved.startsWith(`${mapping.originalDir}${path.sep}`)) {
        return path.join(mapping.rawDir, path.relative(mapping.originalDir, resolved));
      }
    }
    return null;
  };
}

function buildRawToOriginalMapper(kbDir, sourcesDocument) {
  const mappings = [];
  for (const source of sourcesDocument?.activeSources ?? []) {
    if (!source.originalDir || !source.rawDir) {
      continue;
    }
    mappings.push({
      rawDir: path.resolve(kbDir, source.rawDir),
      originalDir: path.resolve(source.originalDir),
    });
  }
  return (absolutePath) => {
    if (!absolutePath) {
      return null;
    }
    const resolved = path.resolve(absolutePath);
    for (const mapping of mappings) {
      if (resolved === mapping.rawDir || resolved.startsWith(`${mapping.rawDir}${path.sep}`)) {
        return path.join(mapping.originalDir, path.relative(mapping.rawDir, resolved));
      }
    }
    return null;
  };
}

function rewriteMarkdownLinks(markdown, sourceFilePath, outputFilePath, mapToKbPath, warnings) {
  return String(markdown ?? '').replace(/\[([^\]]+)\]\(([^)]+)\)/gu, (fullMatch, label, href) => {
    const rawHref = String(href).trim();
    if (!rawHref || rawHref.startsWith('#') || /^(?:[a-z]+:)?\/\//iu.test(rawHref) || rawHref.startsWith('mailto:')) {
      return fullMatch;
    }
    const [hrefWithoutFragment, fragment = ''] = rawHref.split('#');
    const resolvedTarget = path.resolve(path.dirname(sourceFilePath), hrefWithoutFragment);
    const mappedTarget = mapToKbPath(resolvedTarget);
    if (!mappedTarget) {
      warnings.push(`Unmapped markdown link preserved: ${rawHref} from ${path.basename(sourceFilePath)}`);
      return fullMatch;
    }
    const fragmentSuffix = fragment ? `#${fragment}` : '';
    return `[${label}](${relativePath(outputFilePath, mappedTarget)}${fragmentSuffix})`;
  });
}

function buildSourceNote(title, outputFilePath, sourceLinks) {
  const rows = sourceLinks.filter(Boolean);
  return [
    '## 鏉ユ簮',
    '',
    `- ${title}`,
    ...rows.map((row) => `- ${markdownLink(row.label, outputFilePath, row.path)}`),
  ].join('\n');
}

function findPageByKind(pagesDocument, kind) {
  return (pagesDocument?.pages ?? []).find((page) => page.kind === kind) ?? null;
}

function findPageById(pagesDocument, pageId) {
  return (pagesDocument?.pages ?? []).find((page) => page.pageId === pageId) ?? null;
}

async function resolveSourceInputs(url, options) {
  const warnings = [];
  const workspaceRoot = process.cwd();
  const host = sanitizeHost(hostFromUrl(url));
  const kbDir = path.resolve(options.kbDir ?? path.join(workspaceRoot, 'knowledge-base', host));
  if (!await pathExists(kbDir)) {
    throw new Error(`Knowledge base not found: ${kbDir}`);
  }

  const sourcesPath = path.join(kbDir, 'index', 'sources.json');
  const pagesPath = path.join(kbDir, 'index', 'pages.json');
  if (!await pathExists(sourcesPath)) {
    throw new Error(`Knowledge base sources index not found: ${sourcesPath}`);
  }
  if (!await pathExists(pagesPath)) {
    throw new Error(`Knowledge base pages index not found: ${pagesPath}`);
  }

  const sourcesDocument = await readJsonFile(sourcesPath);
  const pagesDocument = await readJsonFile(pagesPath);
  const siteContext = await readSiteContext(workspaceRoot, host);
  const mapToKbPath = buildSourceMapper(kbDir, sourcesDocument);
  const rawToOriginalPath = buildRawToOriginalMapper(kbDir, sourcesDocument);
  const activeSources = new Map((sourcesDocument.activeSources ?? []).map((source) => [source.step, source]));

  const step3RawDir = activeSources.get('step-3-analysis') ? path.resolve(kbDir, activeSources.get('step-3-analysis').rawDir) : null;
  const step4RawDir = activeSources.get('step-4-abstraction') ? path.resolve(kbDir, activeSources.get('step-4-abstraction').rawDir) : null;
  const step5RawDir = activeSources.get('step-5-nl-entry') ? path.resolve(kbDir, activeSources.get('step-5-nl-entry').rawDir) : null;
  const step6RawDir = activeSources.get('step-6-docs') ? path.resolve(kbDir, activeSources.get('step-6-docs').rawDir) : null;
  const step7RawDir = activeSources.get('step-7-governance') ? path.resolve(kbDir, activeSources.get('step-7-governance').rawDir) : null;
  const latestLocalBookContentDir = await findLatestRunDir(path.join(workspaceRoot, 'book-content', host))
    ?? await findLatestRunDir(path.join(workspaceRoot, 'book-content'));
  const stepBookContentRawDir = latestLocalBookContentDir
    ?? (activeSources.get('step-book-content') ? path.resolve(kbDir, activeSources.get('step-book-content').rawDir) : null);

  const docsManifestPath = step6RawDir ? path.join(step6RawDir, 'docs-manifest.json') : null;
  const docsManifest = docsManifestPath && await pathExists(docsManifestPath) ? await readJsonFile(docsManifestPath) : { documents: [] };

  const resolutionKinds = new Set();
  const markResolution = (kind) => resolutionKinds.add(kind);

  async function resolvePath(name, explicitPath, idealCandidates, fallbackPath) {
    if (explicitPath) {
      const resolved = path.resolve(explicitPath);
      if (!await pathExists(resolved)) {
        throw new Error(`${name} not found: ${resolved}`);
      }
      markResolution('explicit');
      return resolved;
    }
    for (const candidate of idealCandidates) {
      if (candidate && await pathExists(candidate)) {
        markResolution('ideal');
        return candidate;
      }
    }
    if (fallbackPath && await pathExists(fallbackPath)) {
      markResolution('fallback');
      return fallbackPath;
    }
    return null;
  }

  const wikiIndexPath = await resolvePath(
    'wiki index',
    options.wikiIndexPath,
    [path.join(workspaceRoot, 'wiki', 'index.md')],
    path.join(kbDir, 'wiki', 'README.md')
  );

  const explicitWikiSchemaPath = options.wikiSchemaPath ? path.resolve(options.wikiSchemaPath) : null;
  const idealWikiSchemaPath = path.join(workspaceRoot, 'wiki', 'schema.md');
  let wikiSchema = null;
  if (explicitWikiSchemaPath) {
    if (!await pathExists(explicitWikiSchemaPath)) {
      throw new Error(`wiki schema not found: ${explicitWikiSchemaPath}`);
    }
    markResolution('explicit');
    wikiSchema = {
      mode: 'file',
      path: explicitWikiSchemaPath,
      text: await readTextFile(explicitWikiSchemaPath),
    };
  } else if (await pathExists(idealWikiSchemaPath)) {
    markResolution('ideal');
    wikiSchema = {
      mode: 'file',
      path: idealWikiSchemaPath,
      text: await readTextFile(idealWikiSchemaPath),
    };
  } else {
    markResolution('fallback');
    const schemaFiles = [
      path.join(kbDir, 'schema', 'AGENTS.md'),
      path.join(kbDir, 'schema', 'naming-rules.json'),
      path.join(kbDir, 'schema', 'evidence-rules.json'),
    ];
    const missing = [];
    for (const filePath of schemaFiles) {
      if (!await pathExists(filePath)) {
        missing.push(filePath);
      }
    }
    if (missing.length) {
      warnings.push(`Schema inputs missing; synthesized schema will be partial: ${missing.join(', ')}`);
    }
    const agents = await readTextFile(schemaFiles[0]);
    const naming = await readJsonFile(schemaFiles[1]);
    const evidence = await readJsonFile(schemaFiles[2]);
    wikiSchema = {
      mode: 'synthesized',
      path: null,
      sourcePaths: schemaFiles,
      text: [
        '# Wiki Schema',
        '',
        '## AGENTS',
        '',
        stripKbMeta(agents).trim(),
        '',
        '## Naming Rules',
        '',
        '```json',
        JSON.stringify(naming, null, 2),
        '```',
        '',
        '## Evidence Rules',
        '',
        '```json',
        JSON.stringify(evidence, null, 2),
        '```',
      ].join('\n'),
    };
  }

  let flowsDir = null;
  if (options.flowsDir) {
    flowsDir = path.resolve(options.flowsDir);
    if (!await pathExists(flowsDir)) {
      throw new Error(`flows directory not found: ${flowsDir}`);
    }
    markResolution('explicit');
  } else {
    const idealFlowsDir = path.join(workspaceRoot, 'flows');
    const kbFlowsDir = path.join(kbDir, 'wiki', 'flows');
    const rawFlowsDir = step6RawDir ? path.join(step6RawDir, 'intents') : null;
    if (await pathExists(idealFlowsDir)) {
      flowsDir = idealFlowsDir;
      markResolution('ideal');
    } else if (rawFlowsDir && (await listMarkdownFiles(rawFlowsDir)).length) {
      flowsDir = rawFlowsDir;
      markResolution('fallback');
    } else if ((await listMarkdownFiles(kbFlowsDir)).length) {
      flowsDir = kbFlowsDir;
      markResolution('fallback');
    }
  }
  if (!flowsDir) {
    warnings.push('No flows directory found. The skill will be generated with a no-actionable-flow reference page.');
  }

  const recoveryPath = await resolvePath(
    'recovery markdown',
    options.recoveryPath,
    [path.join(workspaceRoot, 'recovery.md')],
    step7RawDir ? path.join(step7RawDir, 'recovery.md') : null
  );
  const approvalPath = await resolvePath(
    'approval markdown',
    options.approvalPath,
    [path.join(workspaceRoot, 'approval-checkpoints.md')],
    step7RawDir ? path.join(step7RawDir, 'approval-checkpoints.md') : null
  );
  const nlIntentsPath = await resolvePath(
    'nl intents markdown',
    options.nlIntentsPath,
    [path.join(workspaceRoot, 'nl-intents.md')],
    path.join(kbDir, 'wiki', 'concepts', 'nl-entry.md')
  );
  const interactionModelPath = await resolvePath(
    'interaction model markdown',
    options.interactionModelPath,
    [path.join(workspaceRoot, 'interaction-model.md')],
    path.join(kbDir, 'wiki', 'concepts', 'interaction-model.md')
  );

  if (!recoveryPath) {
    throw new Error('No recovery.md found.');
  }
  if (!approvalPath) {
    throw new Error('No approval-checkpoints.md found.');
  }
  if (!interactionModelPath) {
    throw new Error('No interaction-model.md found.');
  }

  const abstractionFiles = {
    intents: path.join(step4RawDir, 'intents.json'),
    actions: path.join(step4RawDir, 'actions.json'),
    decisionTable: path.join(step4RawDir, 'decision-table.json'),
    capabilityMatrix: path.join(step4RawDir, 'capability-matrix.json'),
  };
  const analysisFiles = {
    elements: path.join(step3RawDir, 'elements.json'),
    states: path.join(step3RawDir, 'states.json'),
    transitions: path.join(step3RawDir, 'transitions.json'),
    siteProfile: path.join(step3RawDir, 'site-profile.json'),
  };
  const nlFiles = {
    aliasLexicon: path.join(step5RawDir, 'alias-lexicon.json'),
    slotSchema: path.join(step5RawDir, 'slot-schema.json'),
    utterancePatterns: path.join(step5RawDir, 'utterance-patterns.json'),
    entryRules: path.join(step5RawDir, 'entry-rules.json'),
    clarificationRules: path.join(step5RawDir, 'clarification-rules.json'),
  };
  const bookContentFiles = stepBookContentRawDir ? {
    manifest: path.join(stepBookContentRawDir, 'book-content-manifest.json'),
    books: path.join(stepBookContentRawDir, 'books.json'),
    authors: path.join(stepBookContentRawDir, 'authors.json'),
    searchResults: path.join(stepBookContentRawDir, 'search-results.json'),
  } : null;

  for (const [label, filePath] of Object.entries({ ...abstractionFiles, ...analysisFiles, ...nlFiles })) {
    if ((label === 'capabilityMatrix' || label === 'siteProfile') && !await pathExists(filePath)) {
      continue;
    }
    if (!await pathExists(filePath)) {
      throw new Error(`Required structured input missing: ${label} at ${filePath}`);
    }
  }

  const intentsDocument = await readJsonFile(abstractionFiles.intents);
  const actionsDocument = await readJsonFile(abstractionFiles.actions);
  const decisionTableDocument = await readJsonFile(abstractionFiles.decisionTable);
  const capabilityMatrixDocument = await pathExists(abstractionFiles.capabilityMatrix) ? await readJsonFile(abstractionFiles.capabilityMatrix) : null;
  const elementsDocument = await readJsonFile(analysisFiles.elements);
  const statesDocument = await readJsonFile(analysisFiles.states);
  const transitionsDocument = await readJsonFile(analysisFiles.transitions);
  const siteProfileDocument = await pathExists(analysisFiles.siteProfile) ? await readJsonFile(analysisFiles.siteProfile) : null;
  const aliasLexiconDocument = await readJsonFile(nlFiles.aliasLexicon);
  const slotSchemaDocument = await readJsonFile(nlFiles.slotSchema);
  const utterancePatternsDocument = await readJsonFile(nlFiles.utterancePatterns);
  const entryRulesDocument = await readJsonFile(nlFiles.entryRules);
  const clarificationRulesDocument = await readJsonFile(nlFiles.clarificationRules);
  const bookContentManifest = bookContentFiles?.manifest && await pathExists(bookContentFiles.manifest) ? await readJsonFile(bookContentFiles.manifest) : null;
  const booksContentDocument = bookContentFiles?.books && await pathExists(bookContentFiles.books) ? await readJsonFile(bookContentFiles.books) : [];
  const authorsContentDocument = bookContentFiles?.authors && await pathExists(bookContentFiles.authors) ? await readJsonFile(bookContentFiles.authors) : [];
  const searchResultsDocument = bookContentFiles?.searchResults && await pathExists(bookContentFiles.searchResults) ? await readJsonFile(bookContentFiles.searchResults) : [];

  const sourceLayout = resolutionKinds.size === 1
    ? [...resolutionKinds][0]
    : `mixed:${[...resolutionKinds].sort().join('+')}`;

  return {
    url,
    host,
    kbDir,
    wikiIndexPath,
    wikiSchema,
    flowsDir,
    recoveryPath,
    approvalPath,
    nlIntentsPath,
    interactionModelPath,
    sourcesDocument,
    pagesDocument,
    siteContext,
    siteRegistryRecord: siteContext.registryRecord,
    siteCapabilitiesRecord: siteContext.capabilitiesRecord,
    docsManifest,
    mapToKbPath,
    rawToOriginalPath,
    sourceLayout,
    warnings,
    intentsDocument,
    actionsDocument,
    decisionTableDocument,
    capabilityMatrixDocument,
    elementsDocument,
    statesDocument,
    transitionsDocument,
    siteProfileDocument,
    aliasLexiconDocument,
    slotSchemaDocument,
    utterancePatternsDocument,
    entryRulesDocument,
    clarificationRulesDocument,
    bookContentManifest,
    booksContentDocument,
    authorsContentDocument,
    searchResultsDocument,
    bookContentRawDir: stepBookContentRawDir,
  };
}

function buildIntentLookup(context) {
  return new Map((context.intentsDocument.intents ?? []).map((intent) => [intent.intentId, intent]));
}

function buildDecisionRulesByIntent(context) {
  const map = new Map();
  for (const rule of context.decisionTableDocument.rules ?? []) {
    const list = map.get(rule.intentId) ?? [];
    list.push(rule);
    map.set(rule.intentId, list);
  }
  for (const list of map.values()) {
    list.sort((left, right) => String(left.ruleId).localeCompare(String(right.ruleId), 'en'));
  }
  return map;
}

function buildEntryRulesByIntent(context) {
  const map = new Map();
  for (const rule of context.entryRulesDocument.rules ?? []) {
    const list = map.get(rule.intentId) ?? [];
    list.push(rule);
    map.set(rule.intentId, list);
  }
  for (const list of map.values()) {
    list.sort((left, right) => (left.priority ?? 0) - (right.priority ?? 0) || String(left.entryRuleId).localeCompare(String(right.entryRuleId), 'en'));
  }
  return map;
}

function buildPatternsByIntent(context) {
  const map = new Map();
  for (const pattern of context.utterancePatternsDocument.patterns ?? []) {
    const list = map.get(pattern.intentId) ?? [];
    list.push(pattern);
    map.set(pattern.intentId, list);
  }
  for (const list of map.values()) {
    list.sort((left, right) => (left.priority ?? 0) - (right.priority ?? 0) || String(left.patternId).localeCompare(String(right.patternId), 'en'));
  }
  return map;
}

function buildSlotsByIntent(context) {
  return new Map((context.slotSchemaDocument.intents ?? []).map((intent) => [intent.intentId, intent]));
}

function buildElementsById(context) {
  return new Map((context.elementsDocument.elements ?? []).map((element) => [element.elementId, element]));
}

function buildStatesById(context) {
  return new Map((context.statesDocument.states ?? []).map((state) => [state.stateId, state]));
}

function collectAliasesForCanonicalId(context, canonicalId) {
  const entry = (context.aliasLexiconDocument.entries ?? []).find((item) => item.canonicalId === canonicalId);
  return uniqueSortedStrings((entry?.aliases ?? []).map((alias) => alias.text));
}

function collectFlowDocs(context) {
  const docsByIntent = new Map();
  for (const document of context.docsManifest.documents ?? []) {
    if (document.intentId && document.path) {
      const originalPath = path.resolve(document.path);
      const mappedPath = context.mapToKbPath(originalPath) ?? originalPath;
      docsByIntent.set(document.intentId, {
        ...document,
        originalPath,
        mappedPath,
      });
    }
  }
  return docsByIntent;
}

function buildOutputPaths(skillDir) {
  const referencesDir = path.join(skillDir, 'references');
  return {
    skillDir,
    skillMd: path.join(skillDir, 'SKILL.md'),
    referencesDir,
    indexMd: path.join(referencesDir, 'index.md'),
    flowsMd: path.join(referencesDir, 'flows.md'),
    recoveryMd: path.join(referencesDir, 'recovery.md'),
    approvalMd: path.join(referencesDir, 'approval.md'),
    nlIntentsMd: path.join(referencesDir, 'nl-intents.md'),
    interactionModelMd: path.join(referencesDir, 'interaction-model.md'),
  };
}

function is22Biqu(context) {
  return context.host === 'www.22biqu.com';
}

function isMoodyz(context) {
  return /(?:^|\.)moodyz\.com$/iu.test(String(context?.host ?? ''))
    || /(?:^|\.)moodyz\.com$/iu.test(String(context?.baseUrl ?? context?.url ?? ''));
}

function isJable(context) {
  return /(?:^|\.)jable\.tv$/iu.test(String(context?.host ?? ''))
    || /(?:^|\.)jable\.tv$/iu.test(String(context?.baseUrl ?? context?.url ?? ''));
}

function siteTerminology(context) {
  return resolveSiteTerminology(context.siteContext, context.url);
}

function displayIntentLabel(context, intentType) {
  const shared = sharedDisplayIntentName(intentType, context.siteContext, context.url);
  if (shared && shared !== String(intentType ?? '')) {
    return shared;
  }
  if (isMoodyz(context)) {
    switch (intentType) {
      case 'download-book':
        return 'download-work';
      case 'open-chapter':
        return 'open-chapter';
      default:
        return String(intentType ?? '');
    }
  }
  return String(intentType ?? '');
}

function pickRecordText(record, candidateKeys) {
  if (!record || typeof record !== 'object') {
    return null;
  }
  for (const key of candidateKeys) {
    const value = key.split('.').reduce((current, part) => current?.[part], record);
    const text = firstNonEmpty([value]);
    if (text) {
      return text;
    }
  }
  return null;
}

function collectNamedSamples(records, candidateKeys, limit = 6) {
  const values = [];
  for (const record of toArray(records)) {
    const text = pickRecordText(record, candidateKeys);
    if (text) {
      values.push(text);
    }
  }
  return uniqueSortedStrings(values).slice(0, limit);
}

function collectSearchQueries(records, limit = 6) {
  const values = [];
  for (const record of toArray(records)) {
    const text = pickRecordText(record, ['queryText', 'query', 'keyword', 'title', 'name']);
    if (text) {
      values.push(text);
    }
  }
  return uniqueSortedStrings(values).slice(0, limit);
}

function collectStateDisplayTitles(context, pageTypes, limit = 8) {
  const allowedPageTypes = new Set(toArray(pageTypes));
  const values = [];
  for (const state of toArray(context.statesDocument?.states)) {
    if (!allowedPageTypes.has(state?.pageType)) {
      continue;
    }
    const normalized = normalizeDisplayLabel(state?.title, {
      siteContext: context.siteContext,
      inputUrl: context.url,
      url: state?.finalUrl,
      pageType: state?.pageType,
      queryText: state?.pageFacts?.queryText,
    });
    if (normalized) {
      values.push(normalized);
    }
  }
  return uniqueSortedStrings(values).slice(0, limit);
}

function collectIntentTargetLabels(context, intentTypes, limit = 8) {
  const allowed = new Set(toArray(intentTypes));
  const values = [];
  for (const intent of toArray(context.intentsDocument?.intents)) {
    if (!allowed.has(intent.intentType)) {
      continue;
    }
    for (const candidate of toArray(intent.targetDomain?.actionableValues)) {
      if (candidate?.label) {
        values.push(candidate.label);
      }
    }
    for (const candidate of toArray(intent.targetDomain?.candidateValues)) {
      if (candidate?.label) {
        values.push(candidate.label);
      }
    }
  }
  return uniqueSortedStrings(values.map((value) => normalizeDisplayLabel(value, {
    siteContext: context.siteContext,
    inputUrl: context.url,
  }))).slice(0, limit);
}

function getIntentTypes(context) {
  return new Set(toArray(context.intentsDocument?.intents).map((intent) => intent.intentType));
}

function collectMoodyzSamples(context) {
  const works = collectIntentTargetLabels(context, ['open-work', 'open-book'], 8);
  const actresses = collectIntentTargetLabels(context, ['open-actress', 'open-author'], 8);
  const searchQueries = uniqueSortedStrings([
    ...collectIntentTargetLabels(context, ['search-work', 'search-book'], 8),
    ...collectSearchQueries(context.searchResultsDocument, 8),
  ]).slice(0, 8);
  return {
    works,
    actresses,
    searchQueries,
  };
}

function collectJableSamples(context) {
  const taxonomyGroups = collectJableCategoryTaxonomy(context);
  const videos = uniqueSortedStrings([
    ...collectIntentTargetLabels(context, ['open-video', 'open-book', 'open-work'], 10),
    ...collectStateDisplayTitles(context, ['book-detail-page'], 12),
  ]).slice(0, 10);
  const models = uniqueSortedStrings([
    ...collectIntentTargetLabels(context, ['open-model', 'open-author', 'open-actress'], 20),
    ...collectStateDisplayTitles(context, ['author-page'], 20),
  ]).filter((value) => value && value !== '演员列表' && !/^演员：[0-9a-f]{16,}$/iu.test(value)).slice(0, 10);
  const categories = uniqueSortedStrings([
    ...taxonomyGroups.flatMap((group) => group.tags),
    ...collectIntentTargetLabels(context, ['open-category'], 10),
    ...collectStateDisplayTitles(context, ['category-page', 'author-list-page'], 10),
  ]).filter(Boolean).slice(0, 16);
  const defaultQueries = toArray(context.siteProfileDocument?.search?.defaultQueries)
    .map((item) => cleanText(item))
    .filter(Boolean);
  const searchQueries = uniqueSortedStrings([
    ...defaultQueries,
    ...collectIntentTargetLabels(context, ['search-video', 'search-book', 'search-work'], 10),
    ...collectSearchQueries(context.searchResultsDocument, 10),
  ]).slice(0, 10);
  return {
    videos,
    models,
    categories,
    categoryGroups: taxonomyGroups,
    searchQueries,
  };
}

function collectJableCategoryTaxonomy(context) {
  const groupMap = new Map();
  for (const state of toArray(context.statesDocument?.states)) {
    for (const group of toArray(state.pageFacts?.categoryTaxonomy)) {
      const groupLabel = cleanText(group.groupLabel);
      if (!groupLabel) {
        continue;
      }
      const entry = groupMap.get(groupLabel) ?? { groupLabel, tags: [] };
      for (const tag of toArray(group.tags)) {
        const tagLabel = cleanText(tag.label);
        if (!tagLabel || entry.tags.includes(tagLabel)) {
          continue;
        }
        entry.tags.push(tagLabel);
      }
      groupMap.set(groupLabel, entry);
    }
  }
  return [...groupMap.values()]
    .map((entry) => ({ groupLabel: entry.groupLabel, tags: uniqueSortedStrings(entry.tags) }))
    .sort((left, right) => String(left.groupLabel).localeCompare(String(right.groupLabel), 'zh-Hans-CN'));
}

function intentTitle22Biqu(intentType) {
  switch (intentType) {
    case 'search-book':
      return 'Search book';
    case 'open-book':
      return 'Open book directory';
    case 'open-author':
      return 'Open author page';
    case 'open-chapter':
      return 'Open chapter text';
    case 'download-book':
      return 'Download full book';
    case 'open-category':
      return 'Open category page';
    case 'open-utility-page':
      return 'Open utility page';
    case 'open-auth-page':
      return 'Open auth page';
    default:
      return intentType;
  }
}

function intentSummary22Biqu(intentType) {
  switch (intentType) {
    case 'search-book':
      return 'Submit a book title or author query into the site search box and enter the /ss/ result page.';
    case 'open-book':
      return 'Open a verified book directory page from the home page or a search result.';
    case 'open-author':
      return 'Open the author page linked from a verified book directory.';
    case 'open-chapter':
      return 'Open a verified chapter page and read the public text.';
    case 'download-book':
      return 'Return a local full-book TXT if present; otherwise reuse or generate the host crawler and download the whole public book.';
    case 'open-category':
      return 'Open a verified category page from the site navigation.';
    case 'open-utility-page':
      return 'Open a low-risk utility page such as reading history.';
    case 'open-auth-page':
      return 'Open a login or register page without submitting credentials.';
    default:
      return 'Run only within the observed 22biqu navigation space.';
  }
}

function collect22biquKnownBooks(context) {
  return ['玄鉴仙族'];
}

function collect22biquKnownAuthors(context) {
  return ['季越人'];
}

function collect22biquCategoryLabels() {
  return ['玄幻小说', '武侠小说', '都市小说', '历史小说'];
}

function collect22biquUtilityLabels() {
  return ['阅读记录'];
}

function collect22biquAuthLabels() {
  return ['用户登录', '用户注册'];
}

function renderMoodyzSkillMd(context, outputs) {
  const safeActions = resolveSafeActions(context);
  const terms = siteTerminology(context);
  const samples = collectMoodyzSamples(context);
  const intentTypes = getIntentTypes(context);
  const supportedTasks = [
    intentTypes.has('search-work') || intentTypes.has('search-book') ? `search ${terms.entityPlural}` : null,
    intentTypes.has('open-work') || intentTypes.has('open-book') ? `open ${terms.entityLabel} pages` : null,
    intentTypes.has('open-actress') || intentTypes.has('open-author') ? `open ${terms.personLabel} pages` : null,
    intentTypes.has('open-category') ? 'open category and list pages' : null,
    intentTypes.has('open-utility-page') ? 'open utility pages' : null,
  ].filter(Boolean);
  return [
    '---',
    `name: ${context.skillName}`,
    `description: Instruction-only Skill for ${context.url}. Use when Codex needs to search works, open verified work or actress pages, and navigate the approved moodyz URL family.`,
    '---',
    '',
    '# moodyz Skill',
    '',
    '## Scope',
    '',
    `- Site: \`${context.url}\``,
    '- Stay inside the verified `moodyz.com` URL family.',
    `- Safe actions: \`${safeActions.join('`, `')}\``,
    `- Supported tasks: ${supportedTasks.join(', ') || 'query and navigate within the observed site space'}.`,
    '',
    '## Sample coverage',
    '',
    `- Works: ${samples.works.join(', ') || 'none'}`,
    `- Actresses: ${samples.actresses.join(', ') || 'none'}`,
    `- Search queries: ${samples.searchQueries.join(', ') || 'none'}`,
    '',
    '## Reading order',
    '',
    `1. Start with ${markdownLink('references/index.md', outputs.skillMd, outputs.indexMd)}.`,
    `2. For task execution details, read ${markdownLink('references/flows.md', outputs.skillMd, outputs.flowsMd)}.`,
    `3. For user utterances and slot mapping, read ${markdownLink('references/nl-intents.md', outputs.skillMd, outputs.nlIntentsMd)}.`,
    `4. For failure handling, read ${markdownLink('references/recovery.md', outputs.skillMd, outputs.recoveryMd)}.`,
    `5. For approval boundaries, read ${markdownLink('references/approval.md', outputs.skillMd, outputs.approvalMd)}.`,
    `6. For the structured site model, read ${markdownLink('references/interaction-model.md', outputs.skillMd, outputs.interactionModelMd)}.`,
    '',
    '## Safety boundary',
    '',
    '- Search and public navigation are low-risk actions.',
    '- Login or register pages may be opened, but credential submission is out of scope.',
    '',
    '## Do not do',
    '',
    '- Do not leave the verified moodyz URL family.',
    '- Do not invent unobserved actions or side-effect flows.',
    '- Do not submit auth forms, uploads, payments, or unknown forms without approval.',
  ].join('\n');
}

function renderJableSkillMd(context, outputs) {
  const safeActions = resolveSafeActions(context);
  const terms = siteTerminology(context);
  const samples = collectJableSamples(context);
  const intentTypes = getIntentTypes(context);
  const supportedTasks = [
    intentTypes.has('search-video') || intentTypes.has('search-book') ? '搜索影片' : null,
    intentTypes.has('open-video') || intentTypes.has('open-book') ? '打开影片页' : null,
    intentTypes.has('open-model') || intentTypes.has('open-author') ? '打开演员页' : null,
    intentTypes.has('open-category') ? '打开分类或标签页' : null,
    intentTypes.has('list-category-videos') ? '按分类或标签提取前 N 条榜单' : null,
    intentTypes.has('open-utility-page') ? '打开功能页' : null,
  ].filter(Boolean);
  return [
    '---',
    `name: ${context.skillName}`,
    `description: Instruction-only Skill for ${context.url}. Use when Codex needs to search videos, open verified video or actor pages, navigate the approved jable URL family, or extract objective top-N lists from verified category and tag pages.`,
    '---',
    '',
    '# jable Skill',
    '',
    '## Scope',
    '',
    `- Site: \`${context.url}\``,
    '- Stay inside the verified `jable.tv` URL family.',
    `- Safe actions: \`${safeActions.join('`, `')}\``,
    `- Supported tasks: ${supportedTasks.join('、') || '在已观测站点空间内查询和导航'}.`,
    '- Ranking query entrypoint: `node query-jable-ranking.mjs <url> --query "<自然语言请求>"`.',
    '',
    '## Sample coverage',
    '',
    `- 影片样本: ${samples.videos.join(', ') || 'none'}`,
    `- 演员样本: ${samples.models.join(', ') || 'none'}`,
    `- 搜索样本: ${samples.searchQueries.join(', ') || 'none'}`,
    `- 分类组: ${samples.categoryGroups.map((group) => `${group.groupLabel}(${group.tags.length})`).join('、') || 'none'}`,
    '',
    '## Reading order',
    '',
    `1. Start with ${markdownLink('references/index.md', outputs.skillMd, outputs.indexMd)}.`,
    `2. For task execution details, read ${markdownLink('references/flows.md', outputs.skillMd, outputs.flowsMd)}.`,
    `3. For user utterances and slot mapping, read ${markdownLink('references/nl-intents.md', outputs.skillMd, outputs.nlIntentsMd)}.`,
    `4. For failure handling, read ${markdownLink('references/recovery.md', outputs.skillMd, outputs.recoveryMd)}.`,
    `5. For approval boundaries, read ${markdownLink('references/approval.md', outputs.skillMd, outputs.approvalMd)}.`,
    `6. For the structured site model, read ${markdownLink('references/interaction-model.md', outputs.skillMd, outputs.interactionModelMd)}.`,
    '',
    '## Safety boundary',
    '',
    '- Search and public navigation are low-risk actions.',
    '- “推荐/最佳”统一解释为站内公开排序结果，不做主观推荐。',
    '- 一级分类组查询默认按组内所有标签页聚合、去重后取前 N 条。',
    '- Keep answers inside verified video, actor, category, tag, and search pages.',
    '- No downloads, purchases, auth submission, or off-site navigation are in scope.',
    '',
    '## Do not do',
    '',
    '- Do not leave the verified jable URL family.',
    '- Do not invent unobserved actions or side-effect flows.',
    '- Do not submit auth forms, uploads, payments, or unknown forms without approval.',
  ].join('\n');
}

function render22BiquSkillMd(context, outputs) {
  const safeActions = resolveSafeActions(context);
  return [
    '---',
    `name: ${context.skillName}`,
    `description: Instruction-only Skill for ${context.url}. Use when Codex needs to search books, open verified book or author pages, read chapter text, or download a full public novel while staying inside the approved 22biqu URL family.`,
    '---',
    '',
    '# 22biqu Skill',
    '',
    '## Scope',
    '',
    `- Site: \`${context.url}\``,
    '- Stay inside the verified `www.22biqu.com` URL family.',
    `- Safe actions: \`${safeActions.join('`, `')}\``,
    '- Supported tasks: search books, open book directories, open author pages, open chapter pages, and download full public novels.',
    '- Download entrypoint: `pypy3 download_book.py`.',
    '',
    '## Reading order',
    '',
    `1. Start with ${markdownLink('references/index.md', outputs.skillMd, outputs.indexMd)}.`,
    `2. For task execution details, read ${markdownLink('references/flows.md', outputs.skillMd, outputs.flowsMd)}.`,
    `3. For user utterances and slot mapping, read ${markdownLink('references/nl-intents.md', outputs.skillMd, outputs.nlIntentsMd)}.`,
    `4. For failure handling, read ${markdownLink('references/recovery.md', outputs.skillMd, outputs.recoveryMd)}.`,
    `5. For approval boundaries, read ${markdownLink('references/approval.md', outputs.skillMd, outputs.approvalMd)}.`,
    `6. For the structured site model, read ${markdownLink('references/interaction-model.md', outputs.skillMd, outputs.interactionModelMd)}.`,
    '',
    '## Safety boundary',
    '',
    '- Search and public chapter fetching are low-risk actions.',
    '- Login or register pages may be opened, but credential submission is out of scope.',
    '- Prefer returning a local full-book TXT if one already exists.',
    '- If no valid local artifact exists, reuse or generate the host crawler and download again.',
    '',
    '## Do not do',
    '',
    '- Do not leave the verified 22biqu URL family.',
    '- Do not invent unobserved actions or side-effect flows.',
    '- Do not submit auth forms, uploads, payments, or unknown forms without approval.',
  ].join('\n');
}

function renderMoodyzIndexReference(context, outputs, docsByIntent) {
  const samples = collectMoodyzSamples(context);
  const intents = context.intentsDocument.intents ?? [];
  const intentTypes = getIntentTypes(context);
  const verifiedTasks = [
    intentTypes.has('search-work') || intentTypes.has('search-book') ? 'search works' : null,
    intentTypes.has('open-work') || intentTypes.has('open-book') ? 'open work pages' : null,
    intentTypes.has('open-actress') || intentTypes.has('open-author') ? 'open actress pages' : null,
    intentTypes.has('open-category') ? 'open category and list pages' : null,
    intentTypes.has('open-utility-page') ? 'open utility pages' : null,
  ].filter(Boolean);
  const rows = intents.map((intent) => ({
    intent: displayIntentLabel(context, intent.intentType),
    flow: docsByIntent.get(intent.intentId)
      ? markdownLink(docsByIntent.get(intent.intentId).title ?? displayIntentLabel(context, intent.intentType), outputs.indexMd, docsByIntent.get(intent.intentId).mappedPath)
      : '-',
    actionableTargets: (intent.targetDomain?.actionableValues ?? []).map((value) => value.label).join(', ') || '-',
    recognitionOnly: (intent.targetDomain?.candidateValues ?? [])
      .filter((value) => !(intent.targetDomain?.actionableValues ?? []).some((candidate) => candidate.value === value.value))
      .map((value) => value.label)
      .join(', ') || '-',
  }));
  return [
    '# moodyz Index',
    '',
    '## Site summary',
    '',
    `- Entry URL: \`${context.url}\``,
    '- Site type: navigation hub + catalog detail.',
    `- Verified tasks: ${verifiedTasks.join(', ') || 'query and navigate within the observed site space'}.`,
    `- Work samples: ${samples.works.join(', ') || 'none'}`,
    `- Actress samples: ${samples.actresses.join(', ') || 'none'}`,
    `- Search samples: ${samples.searchQueries.join(', ') || 'none'}`,
    '',
    '## Reference navigation',
    '',
    `- ${markdownLink('flows.md', outputs.indexMd, outputs.flowsMd)}`,
    `- ${markdownLink('recovery.md', outputs.indexMd, outputs.recoveryMd)}`,
    `- ${markdownLink('approval.md', outputs.indexMd, outputs.approvalMd)}`,
    `- ${markdownLink('nl-intents.md', outputs.indexMd, outputs.nlIntentsMd)}`,
    `- ${markdownLink('interaction-model.md', outputs.indexMd, outputs.interactionModelMd)}`,
    '',
    '## Sample intent coverage',
    '',
    renderTable(['Intent', 'Flow Source', 'Actionable Targets', 'Recognition-only Targets'], rows),
    '',
    '## Download notes',
    '',
    '- This site skill is currently navigation-centric: it covers search, work pages, actress pages, category/list pages, and utility pages.',
    '- There is no verified chapter-reading or full-download flow in the current observed moodyz model.',
  ].join('\n');
}

function renderJableIndexReference(context, outputs, docsByIntent) {
  const samples = collectJableSamples(context);
  const intents = context.intentsDocument.intents ?? [];
  const intentTypes = getIntentTypes(context);
  const verifiedTasks = [
    intentTypes.has('search-video') || intentTypes.has('search-book') ? '搜索影片' : null,
    intentTypes.has('open-video') || intentTypes.has('open-book') ? '打开影片页' : null,
    intentTypes.has('open-model') || intentTypes.has('open-author') ? '打开演员页' : null,
    intentTypes.has('open-category') ? '打开分类或标签页' : null,
    intentTypes.has('list-category-videos') ? '按分类或标签提取榜单' : null,
    intentTypes.has('open-utility-page') ? '打开功能页' : null,
  ].filter(Boolean);
  const jableDisplayTargetsByIntent = new Map([
    ['open-video', samples.videos],
    ['open-book', samples.videos],
    ['open-work', samples.videos],
    ['open-model', samples.models],
    ['open-author', samples.models],
    ['open-actress', samples.models],
    ['open-category', samples.categories],
    ['list-category-videos', samples.categories],
    ['search-video', samples.searchQueries],
    ['search-book', samples.searchQueries],
    ['search-work', samples.searchQueries],
  ]);
  const rows = intents.map((intent) => ({
    intent: displayIntentLabel(context, intent.intentType),
    flow: docsByIntent.get(intent.intentId)
      ? markdownLink(displayIntentLabel(context, intent.intentType), outputs.indexMd, docsByIntent.get(intent.intentId).mappedPath)
      : '-',
    actionableTargets: (jableDisplayTargetsByIntent.get(intent.intentType) ?? (intent.targetDomain?.actionableValues ?? []).map((value) => normalizeDisplayLabel(value.label, {
      siteContext: context.siteContext,
      inputUrl: context.url,
    }))).join(', ') || '-',
    recognitionOnly: (intent.targetDomain?.candidateValues ?? [])
      .filter((value) => !(intent.targetDomain?.actionableValues ?? []).some((candidate) => candidate.value === value.value))
      .map((value) => normalizeDisplayLabel(value.label, {
        siteContext: context.siteContext,
        inputUrl: context.url,
      }))
      .join(', ') || '-',
  }));
  return [
    '# jable Index',
    '',
    '## Site summary',
    '',
    `- Entry URL: \`${context.url}\``,
    '- Site type: navigation hub + catalog detail.',
    `- Verified tasks: ${verifiedTasks.join('、') || '在已观测站点空间内查询和导航'}.`,
    `- 影片样本: ${samples.videos.join(', ') || 'none'}`,
    `- 演员样本: ${samples.models.join(', ') || 'none'}`,
    `- 分类样本: ${samples.categories.join(', ') || 'none'}`,
    ...(
      samples.categoryGroups.length > 0
        ? [
            '- 分类树摘要:',
            ...samples.categoryGroups.map((group) => `  - ${group.groupLabel}: ${group.tags.slice(0, 8).join(', ')}${group.tags.length > 8 ? ` 等 ${group.tags.length} 个标签` : ''}`),
          ]
        : []
    ),
    `- 搜索样本: ${samples.searchQueries.join(', ') || 'none'}`,
    '',
    '## Reference navigation',
    '',
    `- ${markdownLink('flows.md', outputs.indexMd, outputs.flowsMd)}`,
    `- ${markdownLink('recovery.md', outputs.indexMd, outputs.recoveryMd)}`,
    `- ${markdownLink('approval.md', outputs.indexMd, outputs.approvalMd)}`,
    `- ${markdownLink('nl-intents.md', outputs.indexMd, outputs.nlIntentsMd)}`,
    `- ${markdownLink('interaction-model.md', outputs.indexMd, outputs.interactionModelMd)}`,
    '',
    '## Sample intent coverage',
    '',
    renderTable(['Intent', 'Flow Source', 'Actionable Targets', 'Recognition-only Targets'], rows),
    '',
    '## Notes',
    '',
    '- 当前站点 Skill 以导航为主：覆盖搜索、影片页、演员页、分类/标签页和功能页。',
    '- 新增榜单型查询：可以按任一已抽取 taxonomy 标签或一级分类组，返回站内前 N 条公开结果。',
    '- 实际执行入口：`node query-jable-ranking.mjs https://jable.tv/ --query "<请求>"`。',
    '- “推荐/最佳”默认解释为站内综合排序，不输出主观推荐话术。',
    '- 当前已观测的 jable 模型里，没有已验证的下载或长文本阅读流程。',
  ].join('\n');
}

function renderMoodyzFlowsReference(context, outputs, docsByIntent) {
  const samples = collectMoodyzSamples(context);
  const intents = [...(context.intentsDocument.intents ?? [])].sort((left, right) => String(left.intentId).localeCompare(String(right.intentId), 'en'));
  const sections = ['# Flows', '', '## Table of contents', ''];
  for (const intent of intents) {
    sections.push(`- [${displayIntentLabel(context, intent.intentType)}](#${slugifyAscii(displayIntentLabel(context, intent.intentType), intent.intentType)})`);
  }
  sections.push('');
  for (const intent of intents) {
    sections.push(`## ${displayIntentLabel(context, intent.intentType)}`);
    sections.push('');
    sections.push(`- Intent ID: \`${intent.intentId}\``);
    sections.push(`- Intent Type: \`${displayIntentLabel(context, intent.intentType)}\``);
    sections.push(`- Action: \`${intent.actionId}\``);
    sections.push(`- Summary: ${displayIntentLabel(context, intent.intentType)}`);
    sections.push('');
    if (['search-work', 'search-book'].includes(displayIntentLabel(context, intent.intentType))) {
      const queries = samples.searchQueries.length ? samples.searchQueries : samples.works.slice(0, 3);
      sections.push(`- Example user requests: ${queries.map((query) => `\`搜索《${query}》\``).join(', ') || '`搜索作品`'}`);
      sections.push('- Start state: any verified public page.');
      sections.push('- Target state: a `/search/list` results page or a directly resolved work page.');
      sections.push('- Main path: fill the search box -> submit -> open the matching result if needed.');
      sections.push('- Success signal: the result page mentions the query or the final URL is a `/works/detail/...` page.');
    } else if (['open-work', 'open-book'].includes(displayIntentLabel(context, intent.intentType))) {
      const works = samples.works.slice(0, 4);
      sections.push(`- Example user requests: ${works.map((work) => `\`打开《${work}》\``).join(', ') || '`打开作品`'}`);
      sections.push('- Start state: home page, search results page, category page, or any verified public page.');
      sections.push('- Target state: a work detail page.');
      sections.push('- Main path: open the matching work link.');
      sections.push('- Success signal: the URL matches `/works/detail/...` and the page shows the work metadata.');
    } else if (['open-actress', 'open-author'].includes(displayIntentLabel(context, intent.intentType))) {
      const actresses = samples.actresses.slice(0, 4);
      sections.push(`- Example user requests: ${actresses.map((actress) => `\`打开${actress}女优页\``).join(', ') || '`打开女优页`'}`);
      sections.push('- Start state: a work detail page or a verified public page.');
      sections.push('- Target state: the linked actress page.');
      sections.push('- Main path: read the actress link -> open the actress page.');
      sections.push('- Success signal: the actress name and URL match the selected actress.');
    }
    sections.push('');
  }
  sections.push('## Notes');
  sections.push('');
  sections.push('- This site flow set is currently navigation-first, not chapter-download oriented.');
  sections.push('- For live metadata questions, trust the current work detail HTML over search-engine snippets or stale cached result pages.');
  sections.push('- Search disambiguation should separate work titles from actress names before opening a result.');
  return sections.join('\n');
}

function renderJableFlowsReference(context, outputs, docsByIntent) {
  const samples = collectJableSamples(context);
  const intents = [...(context.intentsDocument.intents ?? [])].sort((left, right) => String(left.intentId).localeCompare(String(right.intentId), 'en'));
  const sections = ['# Flows', '', '## Table of contents', ''];
  for (const intent of intents) {
    sections.push(`- [${displayIntentLabel(context, intent.intentType)}](#${slugifyAscii(displayIntentLabel(context, intent.intentType), intent.intentType)})`);
  }
  sections.push('');
  for (const intent of intents) {
    const label = displayIntentLabel(context, intent.intentType);
    sections.push(`## ${label}`);
    sections.push('');
    sections.push(`- Intent ID: \`${intent.intentId}\``);
    sections.push(`- Intent Type: \`${label}\``);
    sections.push(`- Action: \`${intent.actionId}\``);
    sections.push(`- Summary: ${label}`);
    sections.push('');
    if (label === '搜索影片') {
      const queries = samples.searchQueries.length ? samples.searchQueries : samples.videos.slice(0, 3);
      sections.push(`- Example user requests: ${queries.map((query) => `\`搜索${query}\``).join(', ') || '`搜索影片`'}`);
      sections.push('- Start state: any verified public page.');
      sections.push('- Target state: a `/search/` results page or a directly resolved `/videos/...` page.');
      sections.push('- Main path: fill the search box -> submit -> open the matching video result if needed.');
      sections.push('- Success signal: the result page mentions the query or the final URL matches `/videos/...`.');
      sections.push('- Disambiguation rule: prefer exact code matches such as `JUR-652` over fuzzy title fragments.');
    } else if (label === '打开影片') {
      const videos = samples.videos.slice(0, 4);
      sections.push(`- Example user requests: ${videos.map((video) => `\`打开${video}\``).join(', ') || '`打开影片`'}`);
      sections.push('- Start state: home page, search results page, category page, or any verified public page.');
      sections.push('- Target state: a `/videos/...` detail page.');
      sections.push('- Main path: open the matching video link.');
      sections.push('- Success signal: the final URL matches `/videos/...` and the page shows video metadata.');
    } else if (label === '打开演员页') {
      const models = samples.models.slice(0, 4);
      sections.push(`- Example user requests: ${models.map((model) => `\`打开${model}演员页\``).join(', ') || '`打开演员页`'}`);
      sections.push('- Start state: a video detail page or a verified public page.');
      sections.push('- Target state: the linked `/models/...` page.');
      sections.push('- Main path: read the model link -> open the model page.');
      sections.push('- Success signal: the model name and URL match the selected model.');
    } else if (label === '打开分类页') {
      const categories = samples.categories.slice(0, 4);
      sections.push(`- Example user requests: ${categories.map((item) => `\`打开${item}\``).join(', ') || '`打开标签页`, `进入热门列表`, `打开分类页`'}`);
      sections.push('- Start state: home page or a verified public page.');
      sections.push('- Target state: a category, tag, hot, or list page.');
      sections.push('- Main path: open the matching navigation link.');
      sections.push('- Success signal: the final URL stays inside `/categories/`, `/tags/`, `/hot/`, or `/latest-updates/`.');
      if (samples.categoryGroups.length > 0) {
        sections.push(`- Known taxonomy groups: ${samples.categoryGroups.map((group) => `${group.groupLabel}(${group.tags.length})`).join('、')}`);
      }
    } else if (label === '分类榜单查询') {
      const groups = samples.categoryGroups.slice(0, 3).map((group) => group.groupLabel);
      const tags = samples.categories.slice(0, 3);
      sections.push(`- Example user requests: ${[
        tags[0] ? `\`${tags[0]}分类，近期最佳推荐三部\`` : null,
        tags[1] ? `\`${tags[1]}标签最近更新前五条\`` : null,
        groups[0] ? `\`${groups[0]}分类最高收藏前三\`` : null,
      ].filter(Boolean).join(', ') || '`黑丝分类，近期最佳推荐三部`'}`);
      sections.push('- Start state: home page, category page, tag page, or any verified public page.');
      sections.push('- Target state: a ranked result list extracted from a verified tag page or a taxonomy group aggregate.');
      sections.push('- Main path: resolve the taxonomy target -> open the visible tag or category page -> switch to the requested on-site sort mode -> extract the top N cards.');
      sections.push('- Sort semantics: “推荐/最佳/近期最佳” => 综合排序; “最近/近期” => 最近更新; “最多观看/最热” => 最多觀看; “最高收藏/收藏最多” => 最高收藏。');
      sections.push('- Group aggregation: when the user targets a first-level category group, aggregate the visible top cards from all tags in that group, dedupe by video URL, then rank the merged set.');
      sections.push('- Success signal: return the requested number of ranked cards with title, link, actor names, and any visible metric.');
    } else if (label === '打开功能页') {
      sections.push('- Example user requests: `打开搜索页`, `进入搜索结果页`');
      sections.push('- Start state: any verified public page.');
      sections.push('- Target state: a low-risk utility page such as `/search/`.');
      sections.push('- Main path: open the utility link.');
      sections.push('- Success signal: the requested utility page opens without side effects.');
    }
    sections.push('');
  }
  sections.push('## Notes');
  sections.push('');
  sections.push('- 这组流程以导航为主，不包含下载动作。');
  sections.push('- 搜索消歧时，优先区分番号、影片标题和演员名称。');
  sections.push('- 询问元数据时，以实时 `/videos/...` 和 `/models/...` 页面为准。');
  return sections.join('\n');
}

function renderMoodyzNlIntentsReference(context, outputs) {
  const samples = collectMoodyzSamples(context);
  const intentTypes = getIntentTypes(context);
  const sections = ['# NL Intents', ''];
  const workExamples = samples.works.slice(0, 4);
  const actressExamples = samples.actresses.slice(0, 4);
  const searchExamples = samples.searchQueries.slice(0, 4);
  if (intentTypes.has('search-work') || intentTypes.has('search-book')) {
    sections.push('## search-work', '');
    sections.push('- Slots: `queryText`');
    sections.push(`- Examples: ${searchExamples.map((item) => `\`搜索《${item}》\``).join(', ') || workExamples.map((item) => `\`搜索《${item}》\``).join(', ') || '`搜索作品`'}`);
    sections.push('');
  }
  if (intentTypes.has('open-work') || intentTypes.has('open-book')) {
    sections.push('## open-work', '');
    sections.push('- Slots: `workTitle`');
    sections.push(`- Examples: ${workExamples.map((item) => `\`打开《${item}》\``).join(', ') || '`打开作品`'}`);
    sections.push('');
  }
  if (intentTypes.has('open-actress') || intentTypes.has('open-author')) {
    sections.push('## open-actress', '');
    sections.push('- Slots: `actressName`');
    sections.push(`- Examples: ${actressExamples.map((item) => `\`打开${item}女优页\``).join(', ') || '`打开女优页`'}`);
    sections.push('');
  }
  if (intentTypes.has('open-category')) {
    sections.push('## open-category', '');
    sections.push('- Slots: `targetLabel`');
    sections.push('- Examples: `打开発売作品`, `打开作品検索`, `进入女優列表`');
    sections.push('');
  }
  if (intentTypes.has('open-utility-page')) {
    sections.push('## open-utility-page', '');
    sections.push('- Slots: `targetLabel`');
    sections.push('- Examples: `打开トップ`, `打开WEBディレクター募集`');
  }
  return sections.join('\n');
}

function renderJableNlIntentsReference(context) {
  const samples = collectJableSamples(context);
  const intentTypes = getIntentTypes(context);
  const sections = ['# NL Intents', ''];
  const videoExamples = samples.videos.slice(0, 4);
  const modelExamples = samples.models.slice(0, 4);
  const searchExamples = samples.searchQueries.slice(0, 4);
  if (intentTypes.has('search-video') || intentTypes.has('search-book')) {
    sections.push('## 搜索影片', '');
    sections.push('- Slots: `queryText`');
    sections.push(`- Examples: ${searchExamples.map((item) => `\`搜索${item}\``).join(', ') || videoExamples.map((item) => `\`搜索${item}\``).join(', ') || '`搜索影片`'}`);
    sections.push('- Notes: prefer exact video codes or exact titles when available.');
    sections.push('');
  }
  if (intentTypes.has('open-video') || intentTypes.has('open-book')) {
    sections.push('## 打开影片', '');
    sections.push('- Slots: `videoTitle`');
    sections.push(`- Examples: ${videoExamples.map((item) => `\`打开${item}\``).join(', ') || '`打开影片`'}`);
    sections.push('');
  }
  if (intentTypes.has('open-model') || intentTypes.has('open-author')) {
    sections.push('## 打开演员页', '');
    sections.push('- Slots: `actorName`');
    sections.push(`- Examples: ${modelExamples.map((item) => `\`打开${item}演员页\``).join(', ') || '`打开演员页`'}`);
    sections.push('');
  }
  if (intentTypes.has('open-category')) {
    sections.push('## 打开分类页', '');
    sections.push('- Slots: `targetLabel`');
    sections.push(`- Examples: ${samples.categories.slice(0, 4).map((item) => `\`打开${item}\``).join(', ') || '`打开热门列表`, `进入标签页`, `打开分类页`'}`);
    if (samples.categoryGroups.length > 0) {
      sections.push(`- Groups: ${samples.categoryGroups.map((group) => `${group.groupLabel}（${group.tags.slice(0, 5).join('、')}${group.tags.length > 5 ? '…' : ''}）`).join('；')}`);
    }
    sections.push('');
  }
  if (intentTypes.has('list-category-videos')) {
    sections.push('## 分类榜单查询', '');
    sections.push('- Slots: `targetLabel`, `sortMode`, `limit`, `scopeType`');
    sections.push(`- Examples: ${[
      samples.categories[0] ? `\`${samples.categories[0]}分类，近期最佳推荐三部\`` : null,
      samples.categories[1] ? `\`${samples.categories[1]}标签最近更新前五条\`` : null,
      samples.categoryGroups[0] ? `\`${samples.categoryGroups[0].groupLabel}分类最高收藏前三\`` : null,
    ].filter(Boolean).join(', ') || '`黑丝分类，近期最佳推荐三部`'}`);
    sections.push('- Sort defaults: `推荐/最佳/近期最佳 => 综合排序`; `最近/近期 => 最近更新`; `最多观看/最热 => 最多觀看`; `最高收藏/收藏最多 => 最高收藏`。');
    sections.push('- Scope: supports all extracted taxonomy tags and all first-level category groups.');
    sections.push('- Execution: `node query-jable-ranking.mjs https://jable.tv/ --query "<请求>"`.');
    sections.push('');
  }
  if (intentTypes.has('open-utility-page')) {
    sections.push('## 打开功能页', '');
    sections.push('- Slots: `targetLabel`');
    sections.push('- Examples: `打开搜索页`, `进入搜索结果页`');
  }
  return sections.join('\n');
}

function renderMoodyzInteractionModelReference(context, outputs) {
  const samples = collectMoodyzSamples(context);
  const elementsById = buildElementsById(context);
  const rows = (context.intentsDocument.intents ?? []).map((intent) => ({
    intent: displayIntentLabel(context, intent.intentType),
    element: `${intent.elementId} (${elementsById.get(intent.elementId)?.kind ?? '-'})`,
    action: intent.actionId,
    stateField: intent.stateField,
  }));
  return [
    '# Interaction Model',
    '',
    '## Capability summary',
    '',
    `- Works: ${samples.works.join(', ') || 'none'}`,
    `- Actresses: ${samples.actresses.join(', ') || 'none'}`,
    `- Search queries: ${samples.searchQueries.join(', ') || 'none'}`,
    '',
    renderTable(['Intent', 'Element', 'Action', 'State Field'], rows),
  ].join('\n');
}

function renderJableInteractionModelReference(context) {
  const samples = collectJableSamples(context);
  const elementsById = buildElementsById(context);
  const rows = (context.intentsDocument.intents ?? []).map((intent) => ({
    intent: displayIntentLabel(context, intent.intentType),
    element: `${intent.elementId} (${elementsById.get(intent.elementId)?.kind ?? '-'})`,
    action: intent.actionId,
    stateField: intent.stateField,
  }));
  return [
    '# Interaction Model',
    '',
    '## Capability summary',
    '',
    `- 影片样本: ${samples.videos.join(', ') || 'none'}`,
    `- 演员样本: ${samples.models.join(', ') || 'none'}`,
    `- 搜索样本: ${samples.searchQueries.join(', ') || 'none'}`,
    `- 分类组: ${samples.categoryGroups.map((group) => `${group.groupLabel}(${group.tags.length})`).join('、') || 'none'}`,
    '',
    renderTable(['Intent', 'Element', 'Action', 'State Field'], rows),
  ].join('\n');
}

function render22BiquIndexReference(context, outputs) {
  const books = collect22biquKnownBooks(context);
  const authors = collect22biquKnownAuthors(context);
  const categories = collect22biquCategoryLabels();
  const utility = collect22biquUtilityLabels();
  const auth = collect22biquAuthLabels();
  const bookContent = summarizeBookContent(context);
  return [
    '# 22biqu Index',
    '',
    '## Site summary',
    '',
    `- Entry URL: \`${context.url}\``,
    '- Site type: navigation hub + catalog detail.',
    '- Verified tasks: search books, open directories, open author pages, open chapter text, download full public novels.',
    `- Category examples: ${categories.join(', ')}`,
    `- Utility pages: ${utility.join(', ')}`,
    `- Auth pages: ${auth.join(', ')}`,
    `- Known books: ${books.join(', ') || 'none'}`,
    `- Known authors: ${authors.join(', ') || 'none'}`,
    `- Latest full-book coverage: ${bookContent.books.length ? `${bookContent.books.length} book(s), ${bookContent.chapterCount} chapter(s)` : 'none'}`,
    '',
    '## Reference navigation',
    '',
    `- ${markdownLink('flows.md', outputs.indexMd, outputs.flowsMd)}`,
    `- ${markdownLink('recovery.md', outputs.indexMd, outputs.recoveryMd)}`,
    `- ${markdownLink('approval.md', outputs.indexMd, outputs.approvalMd)}`,
    `- ${markdownLink('nl-intents.md', outputs.indexMd, outputs.nlIntentsMd)}`,
    `- ${markdownLink('interaction-model.md', outputs.indexMd, outputs.interactionModelMd)}`,
    '',
    '## Download notes',
    '',
    '- First try a local full-book TXT.',
    '- If no valid local artifact exists, reuse or generate `crawler-scripts/www.22biqu.com/crawler.py`.',
    '- Download now uses full paginated directory parsing plus concurrent chapter fetches.',
    '- The downloader writes `.part` files during execution and finalizes the TXT and JSON files at the end.',
  ].join('\n');
}

function render22BiquFlowsReference(context) {
  const intents = [...(context.intentsDocument.intents ?? [])]
    .sort((left, right) => String(left.intentType).localeCompare(String(right.intentType), 'en'));
  const books = collect22biquKnownBooks(context);
  const authors = collect22biquKnownAuthors(context);
  const categories = collect22biquCategoryLabels();
  const bookExample = books[0] ?? '玄鉴仙族';
  const authorExample = authors[0] ?? '季越人';
  const sections = [
    '# Flows',
    '',
    '## Table of contents',
    '',
    ...intents.map((intent) => `- [${intentTitle22Biqu(intent.intentType)}](#${slugifyAscii(intentTitle22Biqu(intent.intentType), intent.intentType)})`),
    '',
  ];
  for (const intent of intents) {
    sections.push(`## ${intentTitle22Biqu(intent.intentType)}`);
    sections.push('');
    sections.push(`- Intent ID: \`${intent.intentId}\``);
    sections.push(`- Intent Type: \`${intent.intentType}\``);
    sections.push(`- Action: \`${intent.actionId}\``);
    sections.push(`- Summary: ${intentSummary22Biqu(intent.intentType)}`);
    sections.push('');
    if (intent.intentType === 'search-book') {
      sections.push(`- Example user requests: \`搜索《${bookExample}》\`, \`搜索${authorExample}\``);
      sections.push('- Start state: any verified public page.');
      sections.push('- Target state: a `/ss/` search results page or a directly resolved book directory.');
      sections.push('- Main path: fill the search box -> submit -> open the matching result if needed.');
      sections.push('- Success signal: the result page mentions the query or the final URL is a `/biqu.../` directory page.');
      sections.push('- Freshness rule: search results are only for discovery; if the user asks for author, latest chapter, update time, or "多久更新", fetch the live `/biqu.../` directory page before answering.');
    } else if (intent.intentType === 'open-book') {
      sections.push(`- Example user requests: \`打开《${bookExample}》\``);
      sections.push('- Start state: home page, search results page, or any verified public page.');
      sections.push('- Target state: a book directory page.');
      sections.push('- Main path: open the matching book link.');
      sections.push('- Success signal: the URL matches `/biqu.../` and the page shows a chapter directory.');
    } else if (intent.intentType === 'open-author') {
      sections.push(`- Example user requests: \`打开${authorExample}作者页\``);
      sections.push(`- Start state: the directory page for \`${bookExample}\`.`);
      sections.push('- Target state: the linked author page.');
      sections.push('- Main path: read the author link -> open the author page.');
      sections.push('- Success signal: the author name and URL match the selected author.');
    } else if (intent.intentType === 'open-chapter') {
      sections.push(`- Example user requests: \`打开《${bookExample}》第一章\`, \`读取《${bookExample}》第1454章正文\``);
      sections.push(`- Start state: the directory page for \`${bookExample}\`.`);
      sections.push('- Target state: a chapter page with readable public text.');
      sections.push('- Main path: locate the chapter link -> open the chapter page -> read the body text.');
      sections.push('- Success signal: chapter title matches the target and body text length is positive.');
    } else if (intent.intentType === 'download-book') {
      sections.push(`- Example user requests: \`下载《${bookExample}》\``);
      sections.push('- Start state: any verified public page, or a known book directory page.');
      sections.push('- Target state: a local full-book TXT exists.');
      sections.push('- Main path: check local artifact -> if missing, run `pypy3 download_book.py` -> parse the paginated directory -> fetch chapters concurrently -> output a pretty TXT.');
      sections.push('- No-op rule: if a complete local TXT already exists, return it directly.');
      sections.push('- Success signal: `book-content/<run>/downloads/<book-title>.txt` exists.');
    } else if (intent.intentType === 'open-category') {
      sections.push(`- Example user requests: \`打开${categories[0]}\`, \`进入${categories[1]}\``);
      sections.push('- Start state: home page.');
      sections.push('- Target state: a category page.');
      sections.push('- Main path: click the category navigation link.');
      sections.push('- Success signal: the final URL matches the chosen category path.');
    } else if (intent.intentType === 'open-utility-page') {
      sections.push('- Example user requests: `打开阅读记录`');
      sections.push('- Start state: home page.');
      sections.push('- Target state: a low-risk utility page.');
      sections.push('- Main path: click the utility link.');
      sections.push('- Success signal: the utility page is open without triggering auth submission.');
    } else if (intent.intentType === 'open-auth-page') {
      sections.push('- Example user requests: `打开登录页`, `打开注册页`');
      sections.push('- Start state: home page.');
      sections.push('- Target state: a login or register page.');
      sections.push('- Main path: navigate only; do not submit credentials.');
      sections.push('- Success signal: the auth page opens.');
    }
    sections.push('');
  }
  sections.push('## Notes');
  sections.push('');
  sections.push('- Download now prefers full paginated directory parsing and concurrent chapter fetches.');
  sections.push('- `.part` files are written during download so progress is visible before finalization.');
  sections.push('- For live metadata questions, trust the current book directory HTML over search-engine snippets or cached result pages.');
  sections.push('- Prefer `og:novel:lastest_chapter_name` and `og:novel:update_time` from the directory page when present.');
  return sections.join('\n');
}

function render22BiquRecoveryReference() {
  return [
    '# Recovery',
    '',
    '## Common failures',
    '',
    '| Failure | Trigger | Recovery |',
    '| --- | --- | --- |',
    '| missing-slot | User asks to open a book or chapter without enough identifying text. | Ask for the missing book title, author name, or chapter reference. |',
    '| ambiguous-target | More than one candidate matches the given title or author. | Ask the user to disambiguate. |',
    '| search-no-results | Search result count is zero. | Suggest a shorter query, an author name, or a different title. |',
    '| stale-search-cache | A search snippet or older paginated page shows outdated author/latest-chapter/update-time metadata. | Re-fetch the live book directory root URL and, if needed, the final directory page; trust `og:novel:lastest_chapter_name` and `og:novel:update_time` over search snippets. |',
    '| chapter-not-found | The book exists but the requested chapter cannot be mapped. | Return to the directory page and retry with an exact chapter title or a `Chapter N` reference. |',
    '| artifact-stale | A local TXT exists but is incomplete or in an old format. | Recrawl and regenerate the full-book artifact. |',
    '| approval-required | The request would submit auth data or leave the verified site boundary. | Stop and request human approval. |',
    '',
    '## Runtime guidance',
    '',
    '- Retry search with a shorter query or the author name if the first query returns no results.',
    '- Search results are for locating the book only; verify fresh metadata from the live `/biqu.../` directory page before answering author/latest/update-time questions.',
    '- If a chapter lookup fails, confirm the book title first, then the chapter title or number.',
    '- If download is interrupted, rerun the same command; a valid local full-book artifact will be reused on later runs.',
  ].join('\n');
}

function render22BiquApprovalReference(context) {
  const safeActions = resolveSafeActions(context);
  return [
    '# Approval',
    '',
    '## Safe action allowlist',
    '',
    `- \`${safeActions.join('`, `')}\``,
    '',
    '## Approval-required cases',
    '',
    '- Login or register form submission',
    '- Any unknown form submission',
    '- Leaving the verified `www.22biqu.com` URL family',
    '- Any side-effect action that is not on the safe allowlist',
    '',
    '## Current site boundary',
    '',
    '- Searching books, opening directories, opening author pages, reading chapter text, and downloading public book content are low-risk flows.',
    '- Navigation to login or register pages is allowed, but credential submission is not automatic.',
  ].join('\n');
}

function render22BiquNlIntentsReference(context) {
  const books = collect22biquKnownBooks(context);
  const authors = collect22biquKnownAuthors(context);
  const bookExample = books[0] ?? '玄鉴仙族';
  const authorExample = authors[0] ?? '季越人';
  const categories = collect22biquCategoryLabels();
  return [
    '# NL Intents',
    '',
    '## search-book',
    '',
    '- Slots: `queryText`',
    `- Examples: \`搜索《${bookExample}》\`, \`搜索夜无疆\`, \`搜索${authorExample}\``,
    '',
    '## open-book',
    '',
    '- Slots: `bookTitle`',
    `- Examples: \`打开《${bookExample}》\``,
    '',
    '## open-author',
    '',
    '- Slots: `authorName`',
    `- Examples: \`打开${authorExample}作者页\``,
    '',
    '## open-chapter',
    '',
    '- Slots: `bookTitle` + `chapterRef`',
    `- Examples: \`打开《${bookExample}》第一章\`, \`读取《${bookExample}》第1454章正文\``,
    '',
    '## download-book',
    '',
    '- Slots: `bookTitle`',
    `- Examples: \`下载《${bookExample}》\``,
    '- Behavior: return a local full-book TXT when available; otherwise call the PyPy downloader.',
    '',
    '## open-category',
    '',
    `- Examples: \`打开${categories[0]}\`, \`进入${categories[1]}\``,
    '',
    '## open-utility-page',
    '',
    '- Examples: `打开阅读记录`',
    '',
    '## open-auth-page',
    '',
    '- Examples: `打开登录页`, `打开注册页`',
    '- Navigation only; auth form submission is out of scope.',
  ].join('\n');
}

function render22BiquInteractionModelReference(context, outputs) {
  const safeActions = resolveSafeActions(context);
  const books = collect22biquKnownBooks(context);
  const authors = collect22biquKnownAuthors(context);
  const bookContent = summarizeBookContent(context);
  const latestDownload = bookContent.books.length
    ? markdownLink('latest full-book artifact', outputs.interactionModelMd, resolveContentArtifactPath(context, bookContent.books[0].downloadFile))
    : 'none';
  return [
    '# Interaction Model',
    '',
    '## Site profile',
    '',
    '- Archetype: `navigation-hub` + `catalog-detail`',
    '- URL family: `https://www.22biqu.com/`',
    `- Safe actions: \`${safeActions.join('`, `')}\``,
    '',
    '## Verified capabilities',
    '',
    '| Capability | Description |',
    '| --- | --- |',
    '| search-book | Submit a site search and enter the `/ss/` result page. |',
    '| open-book | Open a `/biqu.../` book directory page. |',
    '| open-author | Open the linked author page from a book directory. |',
    '| open-chapter | Open a chapter page and read the body text. |',
    '| download-book | Download a full public novel and emit a pretty TXT. |',
    '| live-book-metadata | Read author/latest chapter/update time from the live directory HTML. |',
    '',
    '## Download path',
    '',
    '- Entrypoint: `pypy3 download_book.py`',
    '- Metadata path: `pypy3 download_book.py <url> --book-title "<title>" --metadata-only`',
    '- Directory strategy: parse paginated directory pages first, then fetch chapters concurrently.',
    '- Concurrency: chapter fetch concurrency is currently `64`; chapter sub-pages are still ordered serially inside each chapter.',
    '- Output strategy: write `.part` files during execution, then finalize TXT and JSON outputs.',
    '- Freshness rule: for author/latest chapter/update time, trust the live `/biqu.../` directory page and its `og:novel:*` metadata over search-engine snippets.',
    '',
    '## Verified examples',
    '',
    `- Books: ${books.join(', ') || 'none'}`,
    `- Authors: ${authors.join(', ') || 'none'}`,
    `- Latest download: ${latestDownload}`,
  ].join('\n');
}

function resolvePrimaryArchetype(context) {
  const resolved = resolvePrimaryArchetypeFromSiteContext(context.siteContext, [
    context.siteProfileDocument?.primaryArchetype,
  ]);
  if (resolved) {
    return resolved;
  }
  const intentTypes = new Set((context.intentsDocument.intents ?? []).map((intent) => intent.intentType));
  if ([...intentTypes].some((intentType) => ['open-category', 'open-book', 'open-work', 'open-author', 'open-actress', 'open-chapter', 'open-utility-page', 'open-auth-page', 'paginate-content', 'search-book', 'search-work'].includes(intentType))) {
    return 'navigation-hub';
  }
  if ([...intentTypes].some((intentType) => ['switch-tab', 'expand-panel', 'open-overlay', 'set-active-member', 'set-expanded', 'set-open'].includes(intentType))) {
    return 'in-page-stateful';
  }
  return 'unknown';
}

function resolveSafeActions(context) {
  const intentTypes = new Set((context.intentsDocument.intents ?? []).map((intent) => intent.intentType));
  const siteActions = resolveSafeActionKindsFromSiteContext(context.siteContext, []);
  if (siteActions.length) {
    return siteActions.filter((actionId) => {
      if (actionId === 'download-book') {
        return intentTypes.has('download-book');
      }
      if (actionId === 'search-submit') {
        return [...intentTypes].some((intentType) => intentType.startsWith('search-'));
      }
      return true;
    });
  }

  const profileActions = uniqueSortedStrings([...(context.siteProfileDocument?.safeActionKinds ?? [])]);
  if (profileActions.length) {
    return profileActions.filter((actionId) => {
      if (actionId === 'download-book') {
        return intentTypes.has('download-book');
      }
      if (actionId === 'search-submit') {
        return [...intentTypes].some((intentType) => intentType.startsWith('search-'));
      }
      return true;
    });
  }

  const actionableActions = uniqueSortedStrings((context.intentsDocument.intents ?? []).map((intent) => intent.actionId));
  if (actionableActions.length) {
    return actionableActions;
  }

  return uniqueSortedStrings((context.actionsDocument.actions ?? []).map((action) => action.actionId));
}

function resolveCapabilityFamilies(context) {
  return resolveCapabilityFamiliesFromSiteContext(context.siteContext, [
    context.capabilityMatrixDocument?.capabilityFamilies ?? [],
    context.siteProfileDocument?.capabilityFamilies ?? [],
  ]);
}

function resolveSupportedIntents(context) {
  return resolveSupportedIntentsFromSiteContext(context.siteContext, [
    (context.intentsDocument?.intents ?? []).map((intent) => intent.intentType ?? intent.intentId),
  ]);
}

function hasBookContentCoverage(context) {
  return Array.isArray(context.booksContentDocument) && context.booksContentDocument.length > 0;
}

function summarizeBookContent(context) {
  const books = context.booksContentDocument ?? [];
  const authors = context.authorsContentDocument ?? [];
  const matchedQueries = (context.searchResultsDocument ?? []).filter((item) => Number(item.resultCount ?? 0) > 0);
  const noResultQueries = (context.searchResultsDocument ?? []).filter((item) => Number(item.resultCount ?? 0) === 0).map((item) => item.queryText).filter(Boolean);
  const chapterCount = books.reduce((sum, book) => {
    const chapterCountValue = Number(book.chapterCount ?? 0);
    return sum + (Number.isFinite(chapterCountValue) ? chapterCountValue : 0);
  }, 0);
  return {
    books,
    authors,
    matchedQueries,
    noResultQueries: uniqueSortedStrings(noResultQueries),
    chapterCount,
    downloadFiles: books.map((book) => book.downloadFile).filter(Boolean),
  };
}

function resolveContentArtifactPath(context, filePath) {
  return context.mapToKbPath(filePath) ?? filePath;
}

function renderSkillMd(context, outputs) {
  if (isJable(context)) {
    return renderJableSkillMd(context, outputs);
  }
  if (isMoodyz(context)) {
    return renderMoodyzSkillMd(context, outputs);
  }
  if (is22Biqu(context)) {
    return render22BiquSkillMd(context, outputs);
  }

  const intents = context.intentsDocument.intents ?? [];
  const actionableLabels = uniqueSortedStrings(intents.flatMap((intent) => (intent.targetDomain?.actionableValues ?? []).map((value) => value.label)));
  const primaryArchetype = resolvePrimaryArchetype(context);
  const capabilityFamilies = resolveCapabilityFamilies(context);
  const supportedIntents = resolveSupportedIntents(context);
  const safeActions = resolveSafeActions(context);
  const description = primaryArchetype === 'navigation-hub' || primaryArchetype === 'catalog-detail'
    ? `Instruction-only Skill for the observed ${context.url} navigation space.`
    : `Instruction-only Skill for the observed ${context.url} state space.`;
  return [
    '---',
    `name: ${context.skillName}`,
    `description: ${description}`,
    '---',
    '',
    `# ${context.siteDisplayName} Skill`,
    '',
    '## Scope',
    '',
    `- Site: \`${context.url}\``,
    `- Primary archetype: \`${primaryArchetype}\``,
    `- Capability families: ${capabilityFamilies.join(', ') || 'none'}`,
    `- Supported intents: ${supportedIntents.join(', ') || 'none'}`,
    `- Safe actions: \`${safeActions.join('`, `')}\``,
    `- Actionable targets: ${actionableLabels.join(', ') || 'none'}`,
    '',
    '## Reading order',
    '',
    `1. ${markdownLink('references/index.md', outputs.skillMd, outputs.indexMd)}`,
    `2. ${markdownLink('references/flows.md', outputs.skillMd, outputs.flowsMd)}`,
    `3. ${markdownLink('references/nl-intents.md', outputs.skillMd, outputs.nlIntentsMd)}`,
    `4. ${markdownLink('references/recovery.md', outputs.skillMd, outputs.recoveryMd)}`,
    `5. ${markdownLink('references/approval.md', outputs.skillMd, outputs.approvalMd)}`,
    `6. ${markdownLink('references/interaction-model.md', outputs.skillMd, outputs.interactionModelMd)}`,
  ].join('\n');
}

function renderIndexReference(context, outputs, docsByIntent) {
  if (isJable(context)) {
    return renderJableIndexReference(context, outputs, docsByIntent);
  }
  if (isMoodyz(context)) {
    return renderMoodyzIndexReference(context, outputs, docsByIntent);
  }
  if (is22Biqu(context)) {
    return render22BiquIndexReference(context, outputs);
  }

  const intents = context.intentsDocument.intents ?? [];
  const flowLinks = intents.map((intent) => {
    const doc = docsByIntent.get(intent.intentId);
    return {
      intent: intent.intentName,
      link: doc ? markdownLink(doc.title ?? intent.intentName, outputs.indexMd, doc.mappedPath) : '-',
      actionableTargets: (intent.targetDomain?.actionableValues ?? []).map((value) => value.label).join(', ') || '-',
      recognitionOnly: (intent.targetDomain?.candidateValues ?? []).filter((value) => !(intent.targetDomain?.actionableValues ?? []).some((candidate) => candidate.value === value.value)).map((value) => value.label).join(', ') || '-',
    };
  });
  return [
    `# ${context.siteDisplayName} Index`,
    '',
    `- Entry URL: \`${context.url}\``,
    `- Intent count: ${intents.length}`,
    `- State count: ${(context.statesDocument.states ?? []).length}`,
    '',
    renderTable(['Intent', 'Flow Source', 'Actionable Targets', 'Recognition-only Targets'], flowLinks),
  ].join('\n');
}

async function renderFlowsReference(context, outputs, docsByIntent) {
  if (isJable(context)) {
    return renderJableFlowsReference(context, outputs, docsByIntent);
  }
  if (isMoodyz(context)) {
    return renderMoodyzFlowsReference(context, outputs, docsByIntent);
  }
  if (is22Biqu(context)) {
    return render22BiquFlowsReference(context);
  }

  const intents = [...(context.intentsDocument.intents ?? [])].sort((left, right) => String(left.intentId).localeCompare(String(right.intentId), 'en'));
  const sections = ['# Flows', ''];
  if (!intents.length) {
    sections.push('No executable flows are currently documented.');
    return sections.join('\n');
  }
  for (const intent of intents) {
    const flowDoc = docsByIntent.get(intent.intentId);
    sections.push(`## ${intent.intentName}`);
    sections.push('');
    sections.push(`- Intent ID: \`${intent.intentId}\``);
    sections.push(`- Intent Type: \`${intent.intentType}\``);
    sections.push(`- Action: \`${intent.actionId}\``);
    const flowSourcePath = flowDoc
      ? (flowDoc.originalPath && await pathExists(flowDoc.originalPath) ? flowDoc.originalPath : flowDoc.mappedPath)
      : null;
    if (flowSourcePath) {
      const imported = await readTextFile(flowSourcePath);
      sections.push('');
      sections.push(rewriteMarkdownLinks(normalizeImportedMarkdown(imported), flowSourcePath, outputs.flowsMd, context.mapToKbPath, context.warnings));
    }
    sections.push('');
  }
  return sections.join('\n');
}

async function renderRecoveryReference(context, outputs) {
  if (is22Biqu(context)) {
    return render22BiquRecoveryReference();
  }

  const originalPath = context.rawToOriginalPath(context.recoveryPath);
  const sourcePath = originalPath && await pathExists(originalPath) ? originalPath : context.recoveryPath;
  const text = await readTextFile(sourcePath);
  return ['# Recovery', '', rewriteMarkdownLinks(normalizeImportedMarkdown(text), sourcePath, outputs.recoveryMd, context.mapToKbPath, context.warnings)].join('\n');
}

async function renderApprovalReference(context, outputs) {
  if (is22Biqu(context)) {
    return render22BiquApprovalReference(context);
  }

  const originalPath = context.rawToOriginalPath(context.approvalPath);
  const sourcePath = originalPath && await pathExists(originalPath) ? originalPath : context.approvalPath;
  const text = await readTextFile(sourcePath);
  return ['# Approval', '', rewriteMarkdownLinks(normalizeImportedMarkdown(text), sourcePath, outputs.approvalMd, context.mapToKbPath, context.warnings)].join('\n');
}

async function renderNlIntentsReference(context, outputs) {
  if (isJable(context)) {
    return renderJableNlIntentsReference(context);
  }
  if (isMoodyz(context)) {
    return renderMoodyzNlIntentsReference(context, outputs);
  }
  if (is22Biqu(context)) {
    return render22BiquNlIntentsReference(context);
  }

  const patternsByIntent = buildPatternsByIntent(context);
  const sections = ['# NL Intents', ''];
  for (const intent of [...(context.intentsDocument.intents ?? [])].sort((left, right) => String(left.intentId).localeCompare(String(right.intentId), 'en'))) {
    const patterns = patternsByIntent.get(intent.intentId) ?? [];
    sections.push(`## ${intent.intentName}`);
    sections.push('');
    sections.push(renderTable(
      ['Pattern Type', 'Examples', 'Regex'],
      patterns.map((pattern) => ({
        patternType: pattern.patternType,
        examples: (pattern.examples ?? []).join(' / ') || '-',
        regex: `\`${pattern.regex}\``,
      }))
    ));
    sections.push('');
  }
  return sections.join('\n');
}

async function renderInteractionModelReference(context, outputs) {
  if (isJable(context)) {
    return renderJableInteractionModelReference(context);
  }
  if (isMoodyz(context)) {
    return renderMoodyzInteractionModelReference(context, outputs);
  }
  if (is22Biqu(context)) {
    return render22BiquInteractionModelReference(context, outputs);
  }

  const elementsById = buildElementsById(context);
  return [
    '# Interaction Model',
    '',
    renderTable(
      ['Intent ID', 'Intent Type', 'Element', 'Action', 'State Field'],
      (context.intentsDocument.intents ?? []).map((intent) => ({
        intentId: intent.intentId,
        intentType: intent.intentType,
        element: `${intent.elementId} (${elementsById.get(intent.elementId)?.kind ?? '-'})`,
        action: intent.actionId,
        stateField: intent.stateField,
      }))
    ),
  ].join('\n');
}

export async function generateSkill(url, options = {}) {
  const mergedOptions = mergeOptions({ ...options, url });
  const context = await resolveSourceInputs(url, mergedOptions);
  context.skillName = mergedOptions.skillName;
  context.siteDisplayName = mergedOptions.skillName;
  const skillDir = path.resolve(mergedOptions.outDir ?? path.join(process.cwd(), 'skills', mergedOptions.skillName));
  const outputs = buildOutputPaths(skillDir);
  await rm(skillDir, { recursive: true, force: true });
  await ensureDir(outputs.referencesDir);

  const docsByIntent = collectFlowDocs(context);

  await writeTextFile(outputs.skillMd, renderSkillMd(context, outputs));
  await writeTextFile(outputs.indexMd, renderIndexReference(context, outputs, docsByIntent));
  await writeTextFile(outputs.flowsMd, await renderFlowsReference(context, outputs, docsByIntent));
  await writeTextFile(outputs.recoveryMd, await renderRecoveryReference(context, outputs));
  await writeTextFile(outputs.approvalMd, await renderApprovalReference(context, outputs));
  await writeTextFile(outputs.nlIntentsMd, await renderNlIntentsReference(context, outputs));
  await writeTextFile(outputs.interactionModelMd, await renderInteractionModelReference(context, outputs));
  await upsertSiteRegistryRecord(process.cwd(), context.host, {
    canonicalBaseUrl: context.baseUrl ?? url,
    repoSkillDir: skillDir,
    latestSkillGeneratedAt: new Date().toISOString(),
    profilePath: context.step3SourceRefs?.siteProfile ?? null,
    knowledgeBaseDir: context.kbDir,
  });
  await upsertSiteCapabilities(process.cwd(), context.host, {
    baseUrl: context.baseUrl ?? url,
    primaryArchetype: resolvePrimaryArchetype(context),
    pageTypes: resolvePageTypesFromSiteContext(context.siteContext, [context.siteProfileDocument?.pageTypes ?? []]),
    capabilityFamilies: resolveCapabilityFamilies(context),
    supportedIntents: resolveSupportedIntents(context),
  });

  return {
    skillDir,
    skillName: mergedOptions.skillName,
    references: [
      toPosixPath(path.relative(skillDir, outputs.indexMd)),
      toPosixPath(path.relative(skillDir, outputs.flowsMd)),
      toPosixPath(path.relative(skillDir, outputs.recoveryMd)),
      toPosixPath(path.relative(skillDir, outputs.approvalMd)),
      toPosixPath(path.relative(skillDir, outputs.nlIntentsMd)),
      toPosixPath(path.relative(skillDir, outputs.interactionModelMd)),
    ],
    sourceLayout: context.sourceLayout,
    warnings: uniqueSortedStrings(context.warnings),
  };
}
function parseCliArgs(argv) {
  if (!argv.length || argv[0] === '--help' || argv[0] === '-h') {
    return { command: 'help' };
  }
  const [inputUrl, ...rest] = argv;
  const flags = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith('--')) {
      continue;
    }
    const key = token.slice(2);
    const next = rest[index + 1];
    if (next && !next.startsWith('--')) {
      flags[key] = next;
      index += 1;
    } else {
      flags[key] = true;
    }
  }
  return {
    command: 'generate',
    inputUrl,
    options: {
      kbDir: flags['kb-dir'],
      outDir: flags['out-dir'],
      skillName: flags['skill-name'],
      wikiIndexPath: flags['wiki-index'],
      wikiSchemaPath: flags['wiki-schema'],
      flowsDir: flags['flows-dir'],
      recoveryPath: flags.recovery,
      approvalPath: flags.approval,
      nlIntentsPath: flags['nl-intents'],
      interactionModelPath: flags['interaction-model'],
    },
  };
}

function printHelp() {
  console.log([
    'Usage:',
    '  node generate-skill.mjs <url> [--kb-dir <dir>] [--out-dir <dir>] [--skill-name <name>] [--wiki-index <path>] [--wiki-schema <path>] [--flows-dir <dir>] [--recovery <path>] [--approval <path>] [--nl-intents <path>] [--interaction-model <path>]',
  ].join('\n'));
}

async function runCli() {
  initializeCliUtf8();
  const parsed = parseCliArgs(process.argv.slice(2));
  if (parsed.command === 'help') {
    printHelp();
    return;
  }
  if (!parsed.inputUrl) {
    throw new Error('Missing <url>.');
  }
  const result = await generateSkill(parsed.inputUrl, parsed.options);
  writeJsonStdout(result);
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (entryPath && fileURLToPath(import.meta.url) === entryPath) {
  runCli().catch((error) => {
    console.error(error?.message ?? String(error));
    process.exitCode = 1;
  });
}
