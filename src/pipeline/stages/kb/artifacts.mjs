// @ts-check

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathExists, readJsonFile } from '../../../infra/io.mjs';
import { firstNonEmpty, normalizeUrlNoFragment, toArray } from '../../../shared/normalize.mjs';
import { firstExistingPath, listDirectories, resolveMaybeRelative } from '../../../shared/wiki.mjs';
import {
  artifactUrlMatchesLocator,
  buildHostKeyedDirCandidates,
  resolveArtifactLocatorContext,
} from '../../../sites/core/artifact-locator.mjs';
import { MANIFEST_NAMES, ROOT_DIRS, candidateSortKey } from './layout.mjs';

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

async function discoverCapture(locator) {
  const parent = path.join(locator.workspaceRoot, ROOT_DIRS.captures);
  const candidates = [];
  for (const dirPath of await listDirectories(parent)) {
    try {
      const capture = await loadCaptureFromDir(dirPath);
      if (!artifactUrlMatchesLocator(locator, capture.baseUrl)) {
        continue;
      }
      capture.sortKey = await candidateSortKey(dirPath, capture.generatedAt);
      candidates.push(capture);
    } catch {
      // Ignore invalid capture artifacts.
    }
  }
  candidates.sort((left, right) => right.sortKey - left.sortKey);
  const exact = candidates.find(
    (candidate) => normalizeUrlNoFragment(candidate.manifest.finalUrl) === normalizeUrlNoFragment(locator.baseUrl ?? locator.inputUrl),
  );
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

async function discoverExpanded(locator) {
  const parent = path.join(locator.workspaceRoot, ROOT_DIRS.expanded);
  const candidates = [];
  for (const dirPath of await listDirectories(parent)) {
    try {
      const expanded = await loadExpandedFromDir(dirPath);
      if (!artifactUrlMatchesLocator(locator, expanded.baseUrl)) {
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

async function discoverBookContent(locator) {
  const candidates = [];
  const parentCandidates = buildHostKeyedDirCandidates(locator, ROOT_DIRS.bookContent, { includeRoot: true });
  for (const parentCandidate of parentCandidates) {
    const parent = parentCandidate.dirPath;
    for (const dirPath of await listDirectories(parent)) {
      try {
        const artifact = await loadBookContentFromDir(dirPath);
        if (!artifactUrlMatchesLocator(locator, artifact.baseUrl)) {
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

async function discoverDocs(locator) {
  const parent = path.join(locator.workspaceRoot, ROOT_DIRS.operationDocs);
  const candidates = [];
  for (const dirPath of await listDirectories(parent)) {
    try {
      const docs = await loadDocsFromDir(dirPath);
      if (!artifactUrlMatchesLocator(locator, docs.baseUrl)) {
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
  };
}

function governanceMatchesChain(governance, docsDir, knownActionIds, knownEdgeIds) {
  if (!governance || !docsDir) {
    return false;
  }
  const approvalRules = toArray(governance.approvalRulesDocument?.rules);
  const recoveryRules = toArray(governance.recoveryRulesDocument?.rules);
  const approvalActionIds = uniqueStrings(approvalRules.flatMap((rule) => toArray(rule.appliesTo?.actionIds)));
  const evidenceEdgeIds = uniqueStrings([
    ...approvalRules.flatMap((rule) => toArray(rule.evidence?.edgeIds)),
    ...recoveryRules.flatMap((rule) => toArray(rule.evidence?.edgeIds)),
  ]);
  const evidenceDocPaths = uniquePaths([
    ...approvalRules.flatMap((rule) => toArray(rule.evidence?.docPaths)),
    ...recoveryRules.flatMap((rule) => toArray(rule.evidence?.docPaths)),
  ]);

  const actionMatch = approvalActionIds.every((actionId) => knownActionIds.has(actionId));
  const edgeMatch = evidenceEdgeIds.every((edgeId) => knownEdgeIds.has(edgeId));
  const docMatch = evidenceDocPaths.every((docPath) => docPath.startsWith(path.resolve(docsDir)));
  return actionMatch && edgeMatch && docMatch;
}

function uniqueStrings(values = []) {
  return [...new Set(values.filter(Boolean).map((value) => String(value)))];
}

function uniquePaths(values = []) {
  return [...new Set(values.filter(Boolean).map((value) => path.resolve(String(value))))];
}

async function discoverGovernance(locator, docsDir, knownActionIds, knownEdgeIds) {
  const parent = path.join(locator.workspaceRoot, ROOT_DIRS.governance);
  const validCandidates = [];
  const fallbackCandidates = [];

  for (const dirPath of await listDirectories(parent)) {
    try {
      const governance = await loadGovernanceFromDir(dirPath);
      if (!artifactUrlMatchesLocator(locator, governance.baseUrl)) {
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

export async function resolveCompileArtifacts(inputUrl, options) {
  const workspaceRoot = process.cwd();
  const warnings = [];
  const inputLocator = await resolveArtifactLocatorContext({
    workspaceRoot,
    inputUrl,
    siteMetadataOptions: options.siteMetadataOptions ?? null,
  });

  const docs = options.docsManifestPath
    ? await loadDocsFromDir(path.dirname(path.resolve(options.docsManifestPath)))
    : options.docsDir
      ? await loadDocsFromDir(path.resolve(options.docsDir))
      : await discoverDocs(inputLocator);

  if (!docs) {
    throw new Error('Unable to resolve step-6 docs artifacts.');
  }

  const baseUrl = normalizeUrlNoFragment(docs.baseUrl ?? inputUrl);
  const artifactLocator = await resolveArtifactLocatorContext({
    workspaceRoot,
    inputUrl,
    baseUrl,
    siteContext: inputLocator.siteContext ?? null,
    siteMetadataOptions: options.siteMetadataOptions ?? null,
  });
  const host = inputLocator.hostKey ?? artifactLocator.hostKey ?? 'unknown-host';

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
      : await discoverExpanded(artifactLocator);

  if (!expanded) {
    throw new Error('Unable to resolve step-2 expanded-state artifacts.');
  }

  const bookContent = options.skipBookContent
    ? null
    : options.bookContentDir
      ? await loadBookContentFromDir(path.resolve(options.bookContentDir))
      : await discoverBookContent(artifactLocator);

  const capture = options.captureDir
    ? await loadCaptureFromDir(path.resolve(options.captureDir))
    : await discoverCapture(artifactLocator);

  if (!capture) {
    throw new Error('Unable to resolve step-1 capture artifacts.');
  }

  const knownActionIds = new Set(toArray(abstraction.actionsDocument?.actions).map((action) => action.actionId));
  const knownEdgeIds = new Set(toArray(analysis.transitionsDocument?.edges).map((edge) => edge.edgeId));

  const governance = options.governanceDir
    ? await loadGovernanceFromDir(path.resolve(options.governanceDir))
    : await discoverGovernance(artifactLocator, docs.dir, knownActionIds, knownEdgeIds);

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
