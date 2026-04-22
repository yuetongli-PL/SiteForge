// @ts-check

import { readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { pathExists, readJsonFile, readTextFile } from '../../infra/io.mjs';
import { markdownLink, stripKbMeta } from '../../shared/markdown.mjs';
import { firstNonEmpty, relativePath, uniqueSortedStrings } from '../../shared/normalize.mjs';
import {
  findLatestHostKeyedRunDir,
  resolveArtifactLocatorContext,
  resolveHostKeyedDir,
} from '../../sites/core/artifact-locator.mjs';
import { resolveProfilePathForUrl } from '../../sites/core/profiles.mjs';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(MODULE_DIR, '..', '..', '..');

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

export function buildSourceMapper(kbDir, sourcesDocument) {
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

export function buildRawToOriginalMapper(kbDir, sourcesDocument) {
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

export function rewriteMarkdownLinks(markdown, sourceFilePath, outputFilePath, mapToKbPath, warnings) {
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

export function buildSourceNote(title, outputFilePath, sourceLinks) {
  const rows = sourceLinks.filter(Boolean);
  return [
    '## 鏉ユ簮',
    '',
    `- ${title}`,
    ...rows.map((row) => `- ${markdownLink(row.label, outputFilePath, row.path)}`),
  ].join('\n');
}

export function findPageByKind(pagesDocument, kind) {
  return (pagesDocument?.pages ?? []).find((page) => page.kind === kind) ?? null;
}

export function findPageById(pagesDocument, pageId) {
  return (pagesDocument?.pages ?? []).find((page) => page.pageId === pageId) ?? null;
}

export async function resolveSourceInputs(url, options) {
  const warnings = [];
  const workspaceRoot = process.cwd();
  const locator = await resolveArtifactLocatorContext({
    workspaceRoot,
    inputUrl: url,
    siteMetadataOptions: options.siteMetadataOptions ?? null,
  });
  const host = locator.hostKey ?? 'unknown-host';
  const kbDir = path.resolve((await resolveHostKeyedDir(locator, 'knowledge-base', {
    explicitDir: options.kbDir,
    requireExisting: true,
  })).dirPath);
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
  const siteContext = locator.siteContext;
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
  const latestLocalBookContentDir = await findLatestHostKeyedRunDir(locator, 'book-content', { includeRoot: true });
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
