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
import { renderKnownSiteDocument } from './lib/render/skill/site-renderers.mjs';
import { resolvePrimaryArchetypeFromSiteContext, resolveSafeActionKindsFromSiteContext, readSiteContext } from './lib/site-context.mjs';
import { isContentDetailPageType, resolveConfiguredPageTypes } from './lib/sites/page-types.mjs';
import { resolveProfilePathForUrl } from './lib/sites/profiles.mjs';
import { displayIntentName as sharedDisplayIntentName, normalizeDisplayLabel, resolveSiteTerminology } from './lib/site-terminology.mjs';
import { upsertSiteCapabilities } from './lib/site-capabilities.mjs';
import { upsertSiteRegistryRecord } from './lib/site-registry.mjs';
import { publishSkill } from './lib/publish/skill/publisher.mjs';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = MODULE_DIR;

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
  const workspaceProfilesDir = path.join(workspaceRoot, 'profiles');
  const fallbackProfilesDir = path.join(REPO_ROOT, 'profiles');
  const liveProfilePath = await pathExists(resolveProfilePathForUrl(url, { profilesDir: workspaceProfilesDir }))
    ? resolveProfilePathForUrl(url, { profilesDir: workspaceProfilesDir })
    : resolveProfilePathForUrl(url, { profilesDir: fallbackProfilesDir });
  const liveSiteProfileDocument = liveProfilePath && await pathExists(liveProfilePath)
    ? await readJsonFile(liveProfilePath)
    : null;
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

  const baseUrl = firstNonEmpty([
    sourcesDocument?.baseUrl,
    sourcesDocument?.inputUrl,
    siteContext?.registryRecord?.canonicalBaseUrl,
    url,
  ]) ?? url;

  return {
    url,
    baseUrl,
    workspaceRoot,
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
    liveSiteProfileDocument,
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
    step3SourceRefs: {
      step: 'step-3-analysis',
      key: 'analysis',
      dir: step3RawDir,
      files: {
        siteProfile: analysisFiles.siteProfile,
      },
    },
    step4SourceRefs: {
      step: 'step-4-abstraction',
      key: 'abstraction',
      dir: step4RawDir,
    },
    step5SourceRefs: {
      step: 'step-5-nl-entry',
      key: 'nl-entry',
      dir: step5RawDir,
    },
    step6SourceRefs: {
      step: 'step-6-docs',
      key: 'docs',
      dir: step6RawDir,
      manifestPath: docsManifestPath,
    },
    step7SourceRefs: {
      step: 'step-7-governance',
      key: 'governance',
      dir: step7RawDir,
    },
    stepBookContentSourceRefs: stepBookContentRawDir ? {
      step: 'step-book-content',
      key: 'book-content',
      dir: stepBookContentRawDir,
      files: bookContentFiles,
    } : null,
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

function isBilibili(context) {
  return /(?:^|\.)bilibili\.com$/iu.test(String(context?.host ?? ''))
    || /(?:^|\.)bilibili\.com$/iu.test(String(context?.baseUrl ?? context?.url ?? ''));
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
    const statePageType = String(state?.pageType ?? '');
    const matchesAllowedPageType = allowedPageTypes.has(statePageType)
      || (allowedPageTypes.has('content-detail-page') && isContentDetailPageType(statePageType))
      || (allowedPageTypes.has('book-detail-page') && statePageType === 'content-detail-page');
    if (!matchesAllowedPageType) {
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

function formatBilibiliCategoryPrefix(prefix) {
  const value = cleanText(prefix);
  switch (value) {
    case '/v/popular/':
      return '热门 (/v/popular/)';
    case '/anime/':
      return '番剧 (/anime/)';
    case '/movie/':
      return '电影 (/movie/)';
    case '/guochuang/':
      return '国创 (/guochuang/)';
    case '/tv/':
      return '电视剧 (/tv/)';
    case '/variety/':
      return '综艺 (/variety/)';
    case '/documentary/':
      return '纪录片 (/documentary/)';
    case '/c/':
      return '分区索引 (/c/)';
    default:
      return value;
  }
}

function uniqueOrderedStrings(values) {
  const seen = new Set();
  const result = [];
  for (const value of values ?? []) {
    const normalized = cleanText(value);
    if (!normalized) {
      continue;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

function bilibiliBvidFromValue(value) {
  const raw = cleanText(value);
  if (!raw) {
    return null;
  }
  const matched = raw.match(/\b(BV[0-9A-Za-z]{10,})\b/u)
    || raw.match(/\/video\/(BV[0-9A-Za-z]{10,})/iu);
  return cleanText(matched?.[1]);
}

function bilibiliMidFromValue(value) {
  const raw = cleanText(value);
  if (!raw) {
    return null;
  }
  const matched = raw.match(/space\.bilibili\.com\/(\d+)/iu)
    || raw.match(/(?:^|\/)(\d{6,})(?:\/video)?$/u);
  return cleanText(matched?.[1]);
}

function formatBilibiliUpSample(value) {
  const mid = bilibiliMidFromValue(value);
  return mid ? `UP ${mid}` : null;
}

function collectBilibiliSamples(context) {
  const validationSamples = {
    ...(context.siteProfileDocument?.validationSamples ?? {}),
    ...(context.liveSiteProfileDocument?.validationSamples ?? {}),
  };
  const categoryPathPrefixes = uniqueSortedStrings([
    ...toArray(context.siteProfileDocument?.navigation?.categoryPathPrefixes),
    ...toArray(context.siteProfileDocument?.pageTypes?.categoryPrefixes),
    ...toArray(context.liveSiteProfileDocument?.navigation?.categoryPathPrefixes),
    ...toArray(context.liveSiteProfileDocument?.pageTypes?.categoryPrefixes),
  ]);
  const states = toArray(context.statesDocument?.states);
  const detailUrls = states
    .map((state) => cleanText(state?.finalUrl))
    .filter(Boolean);
  const videoCodes = uniqueOrderedStrings([
    bilibiliBvidFromValue(validationSamples.videoDetailUrl),
    bilibiliBvidFromValue(validationSamples.videoSearchQuery),
    ...toArray(context.siteProfileDocument?.search?.defaultQueries).map(bilibiliBvidFromValue),
    ...collectIntentTargetLabels(context, ['open-video', 'open-book', 'open-work'], 10).map(bilibiliBvidFromValue),
    ...detailUrls.map(bilibiliBvidFromValue),
    ...states.map((state) => bilibiliBvidFromValue(state?.pageFacts?.bvid)),
  ]).slice(0, 8);
  const videoTitles = uniqueSortedStrings([
    ...collectIntentTargetLabels(context, ['open-video', 'open-book', 'open-work'], 10),
    ...collectStateDisplayTitles(context, ['book-detail-page', 'content-detail-page'], 12),
  ]).filter(Boolean).slice(0, 8);
  const videos = (videoCodes.length ? videoCodes : videoTitles).slice(0, 8);
  const upProfileIds = uniqueOrderedStrings([
    formatBilibiliUpSample(validationSamples.authorUrl),
    formatBilibiliUpSample(validationSamples.authorVideosUrl),
    ...collectIntentTargetLabels(context, ['open-author', 'open-up', 'open-model', 'open-actress'], 10).map(formatBilibiliUpSample),
    ...states.map((state) => formatBilibiliUpSample(state?.pageFacts?.authorUrl)),
    ...states.map((state) => formatBilibiliUpSample(state?.pageFacts?.authorMid)),
    ...detailUrls.map(formatBilibiliUpSample),
  ]).slice(0, 8);
  const upProfileTitles = uniqueSortedStrings([
    ...collectIntentTargetLabels(context, ['open-author', 'open-up', 'open-model', 'open-actress'], 10),
    ...collectStateDisplayTitles(context, ['author-page'], 12),
  ]).filter(Boolean).slice(0, 8);
  const upProfiles = (upProfileIds.length ? upProfileIds : upProfileTitles).slice(0, 8);
  const defaultQueries = toArray(context.siteProfileDocument?.search?.defaultQueries)
    .map((item) => cleanText(item))
    .filter(Boolean);
  const searchQueries = uniqueOrderedStrings([
    cleanText(validationSamples.videoSearchQuery),
    ...defaultQueries,
    ...collectIntentTargetLabels(context, ['search-video', 'search-book', 'search-work'], 10)
      .map((value) => (bilibiliBvidFromValue(value) ? cleanText(value) : null)),
  ]).slice(0, 4);
  const categoryEntries = uniqueSortedStrings([
    ...categoryPathPrefixes.map(formatBilibiliCategoryPrefix),
  ]).filter(Boolean);
  const allowedHosts = uniqueSortedStrings([
    ...toArray(context.siteProfileDocument?.navigation?.allowedHosts),
    ...toArray(context.siteContext?.profile?.navigation?.allowedHosts),
  ]);
  const bangumiEntries = uniqueSortedStrings([
    cleanText(validationSamples.bangumiDetailUrl),
    ...states
      .filter((state) => String(state?.pageFacts?.contentType ?? '') === 'bangumi' || String(state?.finalUrl ?? '').includes('/bangumi/play/'))
      .map((state) => cleanText(state?.finalUrl)),
  ]).filter(Boolean).slice(0, 4);
  const authorSubpages = uniqueSortedStrings([
    cleanText(validationSamples.authorVideosUrl),
    ...states
      .map((state) => cleanText(state?.finalUrl))
      .filter((value) => /space\.bilibili\.com\/\d+\/video/iu.test(String(value || ''))),
  ]).filter(Boolean).slice(0, 4);
  const validatedCategoryUrls = uniqueSortedStrings([
    cleanText(validationSamples.categoryPopularUrl),
    cleanText(validationSamples.categoryAnimeUrl),
  ]).filter(Boolean).slice(0, 6);
  return {
    videos,
    upProfiles,
    searchQueries,
    categoryEntries: (categoryEntries.length ? categoryEntries : [
      '热门 (/v/popular/)',
      '番剧 (/anime/)',
      '电影 (/movie/)',
      '国创 (/guochuang/)',
    ]).slice(0, 8),
    allowedHosts: (allowedHosts.length ? allowedHosts : [
      'www.bilibili.com',
      'search.bilibili.com',
      'space.bilibili.com',
    ]).slice(0, 8),
    bangumiEntries,
    authorSubpages,
    validatedCategoryUrls,
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
  return renderKnownSiteDocument('moodyz', 'skill', buildKnownSiteRenderInput(context, outputs));
}

function renderJableSkillMd(context, outputs) {
  return renderKnownSiteDocument('jable', 'skill', buildKnownSiteRenderInput(context, outputs));
}

function render22BiquSkillMd(context, outputs) {
  return renderKnownSiteDocument('22biqu', 'skill', buildKnownSiteRenderInput(context, outputs));
}

function renderBilibiliSkillMd(context, outputs) {
  return renderKnownSiteDocument('bilibili', 'skill', buildKnownSiteRenderInput(context, outputs));
}

function renderMoodyzIndexReference(context, outputs, docsByIntent) {
  return renderKnownSiteDocument('moodyz', 'index', buildKnownSiteRenderInput(context, outputs, docsByIntent));
}

function renderJableIndexReference(context, outputs, docsByIntent) {
  return renderKnownSiteDocument('jable', 'index', buildKnownSiteRenderInput(context, outputs, docsByIntent));
}

function renderMoodyzFlowsReference(context, outputs, docsByIntent) {
  return renderKnownSiteDocument('moodyz', 'flows', buildKnownSiteRenderInput(context, outputs, docsByIntent));
}

function renderJableFlowsReference(context, outputs, docsByIntent) {
  return renderKnownSiteDocument('jable', 'flows', buildKnownSiteRenderInput(context, outputs, docsByIntent));
}

function renderMoodyzNlIntentsReference(context, outputs) {
  return renderKnownSiteDocument('moodyz', 'nlIntents', buildKnownSiteRenderInput(context, outputs));
}

function renderJableNlIntentsReference(context) {
  return renderKnownSiteDocument('jable', 'nlIntents', buildKnownSiteRenderInput(context, null));
}

function renderMoodyzInteractionModelReference(context, outputs) {
  return renderKnownSiteDocument('moodyz', 'interactionModel', buildKnownSiteRenderInput(context, outputs));
}

function renderJableInteractionModelReference(context) {
  return renderKnownSiteDocument('jable', 'interactionModel', buildKnownSiteRenderInput(context, null));
}

function render22BiquIndexReference(context, outputs) {
  return renderKnownSiteDocument('22biqu', 'index', buildKnownSiteRenderInput(context, outputs));
}

function render22BiquFlowsReference(context, outputs) {
  return renderKnownSiteDocument('22biqu', 'flows', buildKnownSiteRenderInput(context, outputs));
}

function renderBilibiliIndexReference(context, outputs, docsByIntent) {
  return renderKnownSiteDocument('bilibili', 'index', buildKnownSiteRenderInput(context, outputs, docsByIntent));
}

function renderBilibiliFlowsReference(context, outputs, docsByIntent) {
  return renderKnownSiteDocument('bilibili', 'flows', buildKnownSiteRenderInput(context, outputs, docsByIntent));
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
  return renderKnownSiteDocument('22biqu', 'nlIntents', buildKnownSiteRenderInput(context, null));
}

function render22BiquInteractionModelReference(context, outputs) {
  return renderKnownSiteDocument('22biqu', 'interactionModel', buildKnownSiteRenderInput(context, outputs));
}

function renderBilibiliNlIntentsReference(context) {
  return renderKnownSiteDocument('bilibili', 'nlIntents', buildKnownSiteRenderInput(context, null));
}

function renderBilibiliInteractionModelReference(context, outputs) {
  return renderKnownSiteDocument('bilibili', 'interactionModel', buildKnownSiteRenderInput(context, outputs));
}

function buildKnownSiteRenderInput(context, outputs, docsByIntent = new Map()) {
  return {
    context,
    outputs,
    docsByIntent,
    helpers: {
      markdownLink,
      renderTable,
      slugifyAscii,
      normalizeDisplayLabel,
      siteTerminology,
      displayIntentLabel,
      getIntentTypes,
      collectMoodyzSamples,
      collectJableSamples,
      collectBilibiliSamples,
      collect22biquKnownBooks,
      collect22biquKnownAuthors,
      collect22biquCategoryLabels,
      collect22biquUtilityLabels,
      collect22biquAuthLabels,
      intentTitle22Biqu,
      intentSummary22Biqu,
      buildElementsById,
      resolveSafeActions,
      summarizeBookContent,
      resolveContentArtifactPath,
    },
  };
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
  const configuredPageTypes = new Set(resolveConfiguredPageTypes(context.siteProfileDocument));
  const host = String(context.siteContext?.host ?? hostFromUrl(context.url) ?? '').toLowerCase();
  const mappedIntentTypes = new Set(resolveSupportedIntents(context));
  const intentTypes = new Set(
    (context.intentsDocument?.intents ?? [])
      .map((intent) => intent.intentType ?? intent.intentId)
      .filter(Boolean),
  );
  const capabilityFamilies = new Set(context.capabilityMatrixDocument?.capabilityFamilies ?? []);

  if ([...mappedIntentTypes].some((intentType) => String(intentType).startsWith('search-'))) {
    capabilityFamilies.add('search-content');
  }
  if (['open-book', 'open-work', 'open-video'].some((intentType) => mappedIntentTypes.has(intentType) || intentTypes.has(intentType))) {
    capabilityFamilies.add('navigate-to-content');
  }
  if (['open-author', 'open-actress', 'open-model', 'open-up'].some((intentType) => mappedIntentTypes.has(intentType) || intentTypes.has(intentType))) {
    capabilityFamilies.add('navigate-to-author');
  }
  if (mappedIntentTypes.has('open-category') || mappedIntentTypes.has('list-category-videos') || intentTypes.has('open-category') || intentTypes.has('list-category-videos')) {
    capabilityFamilies.add('navigate-to-category');
  }
  if (mappedIntentTypes.has('open-utility-page') || intentTypes.has('open-utility-page')) {
    capabilityFamilies.add('navigate-to-utility-page');
  }
  if (mappedIntentTypes.has('open-chapter') || intentTypes.has('open-chapter')) {
    capabilityFamilies.add('navigate-to-chapter');
  }
  if (mappedIntentTypes.has('download-book') || intentTypes.has('download-book')) {
    capabilityFamilies.add('download-content');
  }

  if (!configuredPageTypes.has('chapter-page')) {
    capabilityFamilies.delete('navigate-to-chapter');
    if (host !== 'jable.tv' && host !== 'moodyz.com' && host !== 'www.bilibili.com') {
      capabilityFamilies.delete('download-content');
    }
  }
  if (!configuredPageTypes.has('category-page')) {
    capabilityFamilies.delete('navigate-to-category');
  }

  return uniqueSortedStrings([...capabilityFamilies]);
}

function remapSupportedIntent(intentType, context) {
  const host = String(context.siteContext?.host ?? hostFromUrl(context.url) ?? '').toLowerCase();
  switch (host) {
    case 'www.bilibili.com':
    case 'search.bilibili.com':
    case 'space.bilibili.com':
      if (intentType === 'search-book' || intentType === 'search-work') {
        return 'search-video';
      }
      if (intentType === 'open-book' || intentType === 'open-work') {
        return 'open-video';
      }
      if (intentType === 'open-actress' || intentType === 'open-model' || intentType === 'open-up') {
        return 'open-author';
      }
      return intentType;
    default:
      return intentType;
  }
}

function resolveSupportedIntents(context) {
  return uniqueSortedStrings(
    (context.intentsDocument?.intents ?? [])
      .map((intent) => intent.intentType ?? intent.intentId)
      .filter(Boolean)
      .map((intentType) => remapSupportedIntent(intentType, context)),
  );
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
  if (isBilibili(context)) {
    return renderBilibiliSkillMd(context, outputs);
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
  if (isBilibili(context)) {
    return renderBilibiliIndexReference(context, outputs, docsByIntent);
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
    return render22BiquFlowsReference(context, outputs);
  }
  if (isBilibili(context)) {
    return renderBilibiliFlowsReference(context, outputs, docsByIntent);
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
  if (isBilibili(context)) {
    return renderBilibiliNlIntentsReference(context);
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
  if (isBilibili(context)) {
    return renderBilibiliInteractionModelReference(context, outputs);
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
  return publishSkill(url, mergedOptions, {
    cwd: process.cwd(),
    resolveSourceInputs,
    buildOutputPaths,
    collectFlowDocs,
    renderSkillMd,
    renderIndexReference,
    renderFlowsReference,
    renderRecoveryReference,
    renderApprovalReference,
    renderNlIntentsReference,
    renderInteractionModelReference,
    rm,
    ensureDir,
    writeTextFile,
    upsertSiteRegistryRecord,
    upsertSiteCapabilities,
    resolvePrimaryArchetype,
    resolveCapabilityFamilies,
    resolveSupportedIntents,
    toPosixPath,
    uniqueSortedStrings,
  });
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
