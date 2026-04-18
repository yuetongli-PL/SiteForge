// @ts-check

import { createHash } from 'node:crypto';
import { mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { initializeCliUtf8 } from './lib/cli.mjs';
import { pathExists, readJsonFile, writeJsonFile } from './lib/io.mjs';
import {
  loadOptionalManifest,
  resolveStageFile,
  resolveStageFiles,
  resolveStageInput,
} from './lib/pipeline/artifacts/index.mjs';
import {
  buildRunManifest,
  getManifestArtifactDir,
  getManifestArtifactPath,
  getManifestRunContext,
} from './lib/pipeline/run-manifest.mjs';
import { displayIntentName } from './lib/site-terminology.mjs';
import { firstExistingPath } from './lib/wiki-paths.mjs';

const DEFAULT_OPTIONS = {
  analysisManifestPath: undefined,
  analysisDir: undefined,
  expandedStatesDir: undefined,
  outDir: path.resolve(process.cwd(), 'interaction-abstraction'),
};

const ANALYSIS_MANIFEST_NAME = 'analysis-manifest.json';
const ELEMENTS_FILE_NAME = 'elements.json';
const STATES_FILE_NAME = 'states.json';
const TRANSITIONS_FILE_NAME = 'transitions.json';
const SITE_PROFILE_FILE_NAME = 'site-profile.json';
const STATE_MANIFEST_FILE_NAME = 'manifest.json';
const CAPABILITY_MATRIX_FILE_NAME = 'capability-matrix.json';
const BOOK_CONTENT_MANIFEST_NAME = 'book-content-manifest.json';
const BOOK_CONTENT_FILE_NAMES = {
  books: 'books.json',
  authors: 'authors.json',
  searchResults: 'search-results.json',
};

const ACTION_DEFINITIONS = [
  {
    actionId: 'noop',
    primitive: 'noop',
    actionName: 'No Operation',
    appliesTo: [
      'tab-group',
      'details-toggle',
      'expanded-toggle',
      'menu-button',
      'dialog-open',
      'category-link-group',
      'content-link-group',
      'author-link-group',
      'chapter-link-group',
      'utility-link-group',
      'auth-link-group',
      'pagination-link-group',
      'form-submit-group',
      'search-form-group',
    ],
    bindingSchema: {
      elementId: 'string',
      targetMemberId: 'string | undefined',
      desiredValue: 'boolean | undefined',
      queryText: 'string | undefined',
    },
    reads: [],
    effects: [],
    locatorPreference: [],
  },
  {
    actionId: 'navigate',
    primitive: 'click',
    actionName: 'Navigate',
    appliesTo: ['category-link-group', 'content-link-group', 'author-link-group', 'chapter-link-group', 'utility-link-group', 'auth-link-group', 'pagination-link-group'],
    bindingSchema: {
      elementId: 'string',
      targetMemberId: 'string | undefined',
      desiredValue: 'boolean | undefined',
      queryText: 'string | undefined',
    },
    reads: ['activeMemberId'],
    effects: ['activeMemberId = targetMemberId'],
    locatorPreference: ['locator.id', 'controlledTarget', 'label', 'locator.domPath'],
  },
  {
    actionId: 'click-toggle',
    primitive: 'click',
    actionName: 'Click Toggle',
    appliesTo: ['details-toggle', 'expanded-toggle', 'menu-button', 'dialog-open'],
    bindingSchema: {
      elementId: 'string',
      targetMemberId: 'string | undefined',
      desiredValue: 'boolean | undefined',
      queryText: 'string | undefined',
    },
    reads: ['expanded', 'open'],
    effects: ['expanded = desiredValue', 'open = desiredValue'],
    locatorPreference: ['locator.id', 'controlledTarget', 'label', 'locator.domPath'],
  },
  {
    actionId: 'select-member',
    primitive: 'click',
    actionName: 'Select Member',
    appliesTo: ['tab-group'],
    bindingSchema: {
      elementId: 'string',
      targetMemberId: 'string | undefined',
      desiredValue: 'boolean | undefined',
      queryText: 'string | undefined',
    },
    reads: ['activeMemberId'],
    effects: ['activeMemberId = targetMemberId'],
    locatorPreference: ['locator.id', 'controlledTarget', 'label', 'locator.domPath'],
  },
  {
    actionId: 'submit',
    primitive: 'click',
    actionName: 'Submit',
    appliesTo: ['form-submit-group'],
    bindingSchema: {
      elementId: 'string',
      targetMemberId: 'string | undefined',
      desiredValue: 'boolean | undefined',
      queryText: 'string | undefined',
    },
    reads: [],
    effects: ['submit form'],
    locatorPreference: ['locator.id', 'controlledTarget', 'label', 'locator.domPath'],
  },
  {
    actionId: 'search-submit',
    primitive: 'submit',
    actionName: 'Search Submit',
    appliesTo: ['search-form-group'],
    bindingSchema: {
      elementId: 'string',
      targetMemberId: 'string | undefined',
      desiredValue: 'boolean | undefined',
      queryText: 'string | undefined',
    },
    reads: ['queryText'],
    effects: ['queryText = queryText', 'submit search form'],
    locatorPreference: ['locator.id', 'label', 'locator.domPath'],
  },
  {
    actionId: 'download-book',
    primitive: 'read-artifact-or-crawl',
    actionName: 'Download Book',
    appliesTo: ['content-link-group'],
    bindingSchema: {
      elementId: 'string',
      targetMemberId: 'string | undefined',
      desiredValue: 'boolean | undefined',
      queryText: 'string | undefined',
    },
    reads: ['activeMemberId'],
    effects: ['prefer local collected novel artifact for targetMemberId', 'generate or reuse site crawler script when artifact missing'],
    locatorPreference: ['member.downloadFile', 'member.label'],
  },
  {
    actionId: 'query-ranking',
    primitive: 'extract-ranked-list',
    actionName: 'Query Ranking',
    appliesTo: ['category-link-group'],
    bindingSchema: {
      elementId: 'string',
      targetMemberId: 'string',
      sortMode: 'string | undefined',
      limit: 'number | undefined',
      scopeType: 'string | undefined',
    },
    reads: ['activeMemberId'],
    effects: [
      'open category or tag page for targetMemberId',
      'apply visible sort mode',
      'extract ranked video cards',
    ],
    locatorPreference: ['label', 'locator.href', 'locator.domPath'],
  },
];

/**
 * @typedef {{
 *   intentId: string,
 *   intentType: string,
 *   intentName: string,
 *   elementId: string,
 *   elementKind: string,
 *   sourceElementName: string,
 *   stateField: string,
 *   actionId: string,
 *   targetDomain: {
 *     parameter: string,
 *     observedValues: Array<{ value: string | boolean, label: string | null, stateIds: string[], edgeIds: string[] }>,
 *     candidateValues: Array<{ value: string | boolean, label: string | null, observed: boolean }>,
 *     actionableValues: Array<{ value: string | boolean, label: string | null, edgeIds: string[] }>
 *   },
 *   evidence: {
 *     stateIds: string[],
 *     edgeIds: string[]
 *   }
 * }} IntentRecord
 */

function createSha256(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function normalizeWhitespace(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeText(value) {
  return normalizeWhitespace(String(value ?? '').normalize('NFKC'));
}

function normalizeLabel(value) {
  return normalizeText(value).toLowerCase();
}

function hostFromUrl(input) {
  try {
    return new URL(String(input ?? '')).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function isMoodyzSite(siteProfileDocument, baseUrl) {
  const host = hostFromUrl(baseUrl);
  return host === 'moodyz.com' || host === 'www.moodyz.com' || String(siteProfileDocument?.host ?? '').toLowerCase() === 'moodyz.com';
}

function isJableSite(siteProfileDocument, baseUrl) {
  const host = hostFromUrl(baseUrl);
  return host === 'jable.tv' || host === 'www.jable.tv' || String(siteProfileDocument?.host ?? '').toLowerCase() === 'jable.tv';
}

function normalizeUrlNoFragment(input) {
  if (!input) {
    return null;
  }

  try {
    const parsed = new URL(input);
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return String(input).split('#')[0];
  }
}

function formatTimestampForDir(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.(\d{3})Z$/, '$1Z');
}

function sanitizeHost(host) {
  return (host || 'unknown-host').replace(/[^a-zA-Z0-9.-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'unknown-host';
}

function compareNullableStrings(left, right) {
  return String(left ?? '').localeCompare(String(right ?? ''), 'en');
}

function compareValue(left, right) {
  const leftKey = typeof left === 'boolean' ? Number(left) : String(left ?? '');
  const rightKey = typeof right === 'boolean' ? Number(right) : String(right ?? '');
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function firstNonEmpty(values) {
  for (const value of values) {
    if (value === undefined || value === null) {
      continue;
    }
    const normalized = normalizeWhitespace(value);
    if (normalized) {
      return normalized;
    }
  }
  return null;
}

function buildWarning(code, message, details = {}) {
  return {
    code,
    message,
    ...details,
  };
}

function summarizeForStdout(manifest) {
  return {
    intents: manifest.summary.intents,
    actions: manifest.summary.actions,
    decisionRules: manifest.summary.decisionRules,
    actionableElements: manifest.summary.actionableElements,
    primaryArchetype: manifest.summary.primaryArchetype,
    outDir: manifest.outDir,
  };
}

function serializeDecisionValue(value) {
  return typeof value === 'boolean' ? String(value) : String(value ?? '');
}

function stableValueKey(value) {
  return typeof value === 'boolean' ? `bool:${value}` : `str:${String(value ?? '')}`;
}

async function resolveAnalysisInput(options) {
  const { manifestPath: analysisManifestPath, dir: analysisDir } = await resolveStageInput(options, {
    manifestOption: 'analysisManifestPath',
    dirOption: 'analysisDir',
    manifestName: ANALYSIS_MANIFEST_NAME,
    missingArgsMessage: 'Pass analysisManifestPath, --analysis-manifest, analysisDir, or --analysis-dir.',
    missingManifestMessagePrefix: 'Analysis manifest not found: ',
    missingDirMessagePrefix: 'Analysis directory not found: ',
  });
  return {
    analysisManifestPath,
    analysisDir,
  };
}

async function resolveAnalysisFiles(analysisDir, analysisManifest) {
  const manifestDir = analysisManifest ? path.dirname(analysisManifest.__path) : analysisDir;
  const files = await resolveStageFiles({
    manifest: analysisManifest,
    manifestDir,
    dir: analysisDir,
    files: {
      elementsPath: { manifestField: 'elements', defaultFileName: ELEMENTS_FILE_NAME },
      statesPath: { manifestField: 'states', defaultFileName: STATES_FILE_NAME },
      transitionsPath: { manifestField: 'transitions', defaultFileName: TRANSITIONS_FILE_NAME },
      siteProfilePath: { manifestField: 'siteProfile', defaultFileName: SITE_PROFILE_FILE_NAME },
    },
  });

  if (!files.elementsPath || !files.statesPath || !files.transitionsPath) {
    throw new Error(`Analysis artifacts missing under ${analysisDir}`);
  }

  return files;
}

async function loadAnalysisArtifacts(options) {
  const { analysisManifestPath, analysisDir } = await resolveAnalysisInput(options);
  const warnings = [];

  let analysisManifest = await loadOptionalManifest(analysisManifestPath);
  if (analysisManifest) {
    analysisManifest.__path = analysisManifestPath;
  }

  const files = await resolveAnalysisFiles(analysisDir, analysisManifest);
  const [elementsDocument, statesDocument, transitionsDocument] = await Promise.all([
    readJsonFile(files.elementsPath),
    readJsonFile(files.statesPath),
    readJsonFile(files.transitionsPath),
  ]);
  const siteProfileDocument = files.siteProfilePath ? await readJsonFile(files.siteProfilePath).catch(() => null) : null;

  const manifestRun = getManifestRunContext(analysisManifest, { inputUrl: options.url ?? null });
  const baseUrl = manifestRun.baseUrl ?? statesDocument.baseUrl ?? elementsDocument.baseUrl ?? transitionsDocument.baseUrl ?? options.url ?? null;
  const inputUrl = manifestRun.inputUrl ?? statesDocument.inputUrl ?? elementsDocument.inputUrl ?? transitionsDocument.inputUrl ?? options.url;

  let expandedStatesDir = null;
  if (options.expandedStatesDir) {
    expandedStatesDir = path.resolve(options.expandedStatesDir);
  } else {
    expandedStatesDir = getManifestArtifactDir(analysisManifest, 'expandedStates', analysisDir);
  }

  if (expandedStatesDir && !(await pathExists(expandedStatesDir))) {
    warnings.push(buildWarning('expanded_states_dir_missing', `Expanded states directory not found: ${expandedStatesDir}`, {
      expandedStatesDir,
    }));
    expandedStatesDir = null;
  }

  let bookContentDir = null;
  let bookContentManifestPath = null;
  let bookContentManifest = null;
  let bookContentBooksDocument = [];
  bookContentDir = getManifestArtifactDir(analysisManifest, 'bookContent', analysisDir);
  bookContentManifestPath = getManifestArtifactPath(analysisManifest, 'bookContent', 'manifest', analysisDir);
  if (!bookContentManifestPath && bookContentDir) {
    const candidateManifest = path.join(bookContentDir, BOOK_CONTENT_MANIFEST_NAME);
    if (await pathExists(candidateManifest)) {
      bookContentManifestPath = candidateManifest;
    }
  }
  if (bookContentManifestPath && await pathExists(bookContentManifestPath)) {
    try {
      bookContentManifest = await readJsonFile(bookContentManifestPath);
      const booksPath = await resolveStageFile({
        manifest: bookContentManifest,
        manifestDir: bookContentDir ?? path.dirname(bookContentManifestPath),
        dir: bookContentDir ?? path.dirname(bookContentManifestPath),
        manifestField: 'books',
        defaultFileName: BOOK_CONTENT_FILE_NAMES.books,
      });
      if (booksPath) {
        bookContentBooksDocument = await readJsonFile(booksPath);
      }
    } catch (error) {
      warnings.push(buildWarning('book_content_parse_failed', `Failed to parse book-content artifacts: ${error.message}`, {
        bookContentManifestPath,
      }));
      bookContentDir = null;
      bookContentManifestPath = null;
      bookContentManifest = null;
      bookContentBooksDocument = [];
    }
  }

  return {
    analysisDir,
    analysisManifestPath,
    analysisManifest,
    files,
    inputUrl,
    baseUrl,
    elementsDocument,
    statesDocument,
    transitionsDocument,
    siteProfileDocument,
    expandedStatesDir,
    bookContentDir,
    bookContentManifestPath,
    bookContentManifest,
    bookContentBooksDocument,
    warnings,
  };
}

async function createOutputLayout(baseUrl, rootOutDir) {
  const generatedAt = new Date().toISOString();
  const host = (() => {
    try {
      return new URL(baseUrl).host;
    } catch {
      return 'unknown-host';
    }
  })();
  const outDir = path.join(path.resolve(rootOutDir), `${formatTimestampForDir(new Date(generatedAt))}_${sanitizeHost(host)}_abstraction`);
  await mkdir(outDir, { recursive: true });
  return {
    generatedAt,
    outDir,
    intentsPath: path.join(outDir, 'intents.json'),
    actionsPath: path.join(outDir, 'actions.json'),
    decisionTablePath: path.join(outDir, 'decision-table.json'),
    capabilityMatrixPath: path.join(outDir, CAPABILITY_MATRIX_FILE_NAME),
    manifestPath: path.join(outDir, 'abstraction-manifest.json'),
  };
}

function mergeOptions(options = {}) {
  return {
    ...DEFAULT_OPTIONS,
    ...options,
    analysisManifestPath: options.analysisManifestPath ?? DEFAULT_OPTIONS.analysisManifestPath,
    analysisDir: options.analysisDir ?? DEFAULT_OPTIONS.analysisDir,
    expandedStatesDir: options.expandedStatesDir ?? DEFAULT_OPTIONS.expandedStatesDir,
    outDir: options.outDir ? path.resolve(options.outDir) : DEFAULT_OPTIONS.outDir,
  };
}

function buildStateFieldSpec(elementKind, siteProfileDocument = null, baseUrl = null) {
  const moodyzSite = isMoodyzSite(siteProfileDocument, baseUrl);
  const jableSite = isJableSite(siteProfileDocument, baseUrl);
  switch (elementKind) {
    case 'tab-group':
      return {
        intentType: 'switch-tab',
        stateField: 'activeMemberId',
        actionId: 'select-member',
        parameter: 'targetMemberId',
        capabilityFamily: 'switch-in-page-state',
      };
    case 'details-toggle':
    case 'expanded-toggle':
      return {
        intentType: 'expand-panel',
        stateField: 'expanded',
        actionId: 'click-toggle',
        parameter: 'desiredValue',
        capabilityFamily: 'switch-in-page-state',
      };
    case 'menu-button':
    case 'dialog-open':
      return {
        intentType: 'open-overlay',
        stateField: 'open',
        actionId: 'click-toggle',
        parameter: 'desiredValue',
        capabilityFamily: 'switch-in-page-state',
      };
    case 'category-link-group':
      return {
        intentType: 'open-category',
        stateField: 'activeMemberId',
        actionId: 'navigate',
        parameter: 'targetMemberId',
        capabilityFamily: 'navigate-to-category',
      };
    case 'content-link-group':
      return {
        intentType: jableSite ? 'open-video' : moodyzSite ? 'open-work' : 'open-book',
        stateField: 'activeMemberId',
        actionId: 'navigate',
        parameter: 'targetMemberId',
        capabilityFamily: 'navigate-to-content',
      };
    case 'author-link-group':
      return {
        intentType: jableSite ? 'open-model' : moodyzSite ? 'open-actress' : 'open-author',
        stateField: 'activeMemberId',
        actionId: 'navigate',
        parameter: 'targetMemberId',
        capabilityFamily: 'navigate-to-author',
      };
    case 'chapter-link-group':
      return {
        intentType: 'open-chapter',
        stateField: 'activeMemberId',
        actionId: 'navigate',
        parameter: 'targetMemberId',
        capabilityFamily: 'navigate-to-chapter',
      };
    case 'utility-link-group':
      return {
        intentType: 'open-utility-page',
        stateField: 'activeMemberId',
        actionId: 'navigate',
        parameter: 'targetMemberId',
        capabilityFamily: 'navigate-to-utility-page',
      };
    case 'auth-link-group':
      return {
        intentType: 'open-auth-page',
        stateField: 'activeMemberId',
        actionId: 'navigate',
        parameter: 'targetMemberId',
        capabilityFamily: 'open-auth-page',
      };
    case 'pagination-link-group':
      return {
        intentType: 'paginate-content',
        stateField: 'activeMemberId',
        actionId: 'navigate',
        parameter: 'targetMemberId',
        capabilityFamily: 'navigate-to-utility-page',
      };
    case 'search-form-group':
      return {
        intentType: jableSite ? 'search-video' : moodyzSite ? 'search-work' : 'search-book',
        stateField: 'queryText',
        actionId: 'search-submit',
        parameter: 'queryText',
        capabilityFamily: 'search-content',
      };
    default:
      return null;
  }
}

function normalizeElementStateValue(elementKind, elementState) {
  if (!elementState) {
    return null;
  }

  switch (elementKind) {
    case 'tab-group':
    case 'category-link-group':
    case 'content-link-group':
    case 'author-link-group':
    case 'chapter-link-group':
    case 'utility-link-group':
    case 'auth-link-group':
    case 'pagination-link-group':
      return elementState.value?.activeMemberId ?? null;
    case 'search-form-group':
      return elementState.value?.queryText ?? null;
    case 'details-toggle':
      return Boolean(elementState.value?.open);
    case 'expanded-toggle':
      return Boolean(elementState.value?.expanded);
    case 'menu-button':
    case 'dialog-open':
      return Boolean(elementState.value?.open);
    default:
      return null;
  }
}

function buildIndices(elementsDocument, statesDocument, transitionsDocument) {
  const elementsById = new Map();
  const membersById = new Map();
  const statesById = new Map();
  const elementStatesByStateId = new Map();
  const transitionsByObservedStateId = new Map();

  for (const element of toArray(elementsDocument.elements)) {
    elementsById.set(element.elementId, element);
    for (const member of toArray(element.members)) {
      membersById.set(member.memberId, {
        ...member,
        elementId: element.elementId,
        elementKind: element.kind,
      });
    }
  }

  for (const state of toArray(statesDocument.states)) {
    statesById.set(state.stateId, state);
    const perStateMap = new Map();
    for (const elementState of toArray(state.elementStates)) {
      perStateMap.set(elementState.elementId, elementState);
    }
    elementStatesByStateId.set(state.stateId, perStateMap);
  }

  for (const edge of toArray(transitionsDocument.edges)) {
    transitionsByObservedStateId.set(edge.observedStateId, edge);
  }

  return {
    elementsById,
    membersById,
    statesById,
    elementStatesByStateId,
    transitionsByObservedStateId,
  };
}

async function indexExpandedStateManifests(expandedStatesDir) {
  const result = new Map();
  if (!expandedStatesDir) {
    return result;
  }

  const statesDir = path.join(expandedStatesDir, 'states');
  if (!(await pathExists(statesDir))) {
    return result;
  }

  const entries = await readdir(statesDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const [stateId] = entry.name.split('_');
    if (!stateId || result.has(stateId)) {
      continue;
    }
    const manifestPath = path.join(statesDir, entry.name, STATE_MANIFEST_FILE_NAME);
    if (await pathExists(manifestPath)) {
      result.set(stateId, manifestPath);
    }
  }
  return result;
}

function compareTriggerLocatorPath(fullPath, locatorPath) {
  if (!fullPath || !locatorPath) {
    return false;
  }
  return fullPath === locatorPath || fullPath.endsWith(locatorPath) || locatorPath.endsWith(fullPath);
}

function triggerKindToElementKind(triggerKind) {
  switch (triggerKind) {
    case 'tab':
      return 'tab-group';
    case 'details-toggle':
      return 'details-toggle';
    case 'expanded-toggle':
      return 'expanded-toggle';
    case 'menu-button':
      return 'menu-button';
    case 'dialog-open':
      return 'dialog-open';
    default:
      return null;
  }
}

function triggerToExpectedElementKind(trigger) {
  if (!trigger?.kind) {
    return null;
  }
  if (trigger.kind === 'safe-nav-link') {
    if (trigger.semanticRole === 'category') {
      return 'category-link-group';
    }
    if (trigger.semanticRole === 'author') {
      return 'author-link-group';
    }
    return 'utility-link-group';
  }
  if (trigger.kind === 'content-link') {
    return 'content-link-group';
  }
  if (trigger.kind === 'chapter-link') {
    return 'chapter-link-group';
  }
  if (trigger.kind === 'auth-link') {
    return 'auth-link-group';
  }
  if (trigger.kind === 'pagination-link') {
    return 'pagination-link-group';
  }
  if (trigger.kind === 'search-form') {
    return 'search-form-group';
  }
  if (trigger.kind === 'form-submit') {
    return 'form-submit-group';
  }
  return triggerKindToElementKind(trigger.kind);
}

function buildFallbackStateManifestList(paths) {
  const unique = [...new Set(paths.filter(Boolean))].sort(compareNullableStrings);
  return unique.length > 0 ? unique : undefined;
}

async function createFallbackContext(artifacts, indices, warnings) {
  const manifestPathsByStateId = await indexExpandedStateManifests(artifacts.expandedStatesDir);
  const manifestCache = new Map();
  let usedFallbackEvidence = false;

  async function loadStateManifest(stateId) {
    if (manifestCache.has(stateId)) {
      return manifestCache.get(stateId);
    }

    const stateRecord = indices.statesById.get(stateId) ?? null;
    const preferredPath = stateRecord?.files?.manifest ?? null;
    const fallbackPath = manifestPathsByStateId.get(stateId) ?? null;
    const manifestPath = await firstExistingPath([
      { value: preferredPath, baseDir: artifacts.analysisDir },
      { value: fallbackPath, baseDir: artifacts.analysisDir },
    ]);

    if (!manifestPath) {
      manifestCache.set(stateId, null);
      return null;
    }

    try {
      const manifest = await readJsonFile(manifestPath);
      const record = { manifest, manifestPath };
      manifestCache.set(stateId, record);
      usedFallbackEvidence = true;
      return record;
    } catch (error) {
      warnings.push(buildWarning('fallback_manifest_parse_failed', `Failed to parse fallback manifest for ${stateId}: ${error.message}`, {
        stateId,
        manifestPath,
      }));
      manifestCache.set(stateId, null);
      return null;
    }
  }

  return {
    loadStateManifest,
    get usedFallbackEvidence() {
      return usedFallbackEvidence;
    },
  };
}

async function resolveEdgeTrigger(edge, fallbackContext) {
  if (edge?.trigger?.locator && (edge.trigger.label || edge.trigger.locator.id || edge.trigger.controlledTarget)) {
    return {
      trigger: edge.trigger,
      fallbackManifestPath: null,
    };
  }

  if (!fallbackContext) {
    return {
      trigger: edge?.trigger ?? null,
      fallbackManifestPath: null,
    };
  }

  const fallbackRecord = await fallbackContext.loadStateManifest(edge.observedStateId);
  if (!fallbackRecord?.manifest?.trigger) {
    return {
      trigger: edge?.trigger ?? null,
      fallbackManifestPath: fallbackRecord?.manifestPath ?? null,
    };
  }

  const mergedTrigger = {
    ...(edge.trigger ?? {}),
    ...fallbackRecord.manifest.trigger,
    locator: {
      ...(edge.trigger?.locator ?? {}),
      ...(fallbackRecord.manifest.trigger.locator ?? {}),
    },
  };

  return {
    trigger: mergedTrigger,
    fallbackManifestPath: fallbackRecord.manifestPath,
  };
}

function findTabTarget(element, trigger) {
  const locator = trigger?.locator ?? {};
  const normalizedLabel = normalizeLabel(trigger?.label || locator.label || locator.textSnippet);

  return toArray(element.members).find((member) => locator.id && member.matchKey === `id:${locator.id}`)
    ?? toArray(element.members).find((member) => locator.ariaControls && member.controlledTarget === locator.ariaControls)
    ?? toArray(element.members).find((member) => normalizedLabel && normalizeLabel(member.label) === normalizedLabel)
    ?? toArray(element.members).find((member) => compareTriggerLocatorPath(member.domPath, locator.domPath));
}

function findMemberTarget(element, trigger) {
  const locator = trigger?.locator ?? {};
  const normalizedLabel = normalizeLabel(trigger?.label || locator.label || locator.textSnippet);
  const normalizedHref = normalizeUrlNoFragment(trigger?.href || locator.href);

  return toArray(element.members).find((member) => locator.id && member.matchKey === `id:${locator.id}`)
    ?? toArray(element.members).find((member) => normalizedHref && normalizeUrlNoFragment(member.href || member.locator?.href) === normalizedHref)
    ?? toArray(element.members).find((member) => locator.ariaControls && member.controlledTarget === locator.ariaControls)
    ?? toArray(element.members).find((member) => normalizedLabel && normalizeLabel(member.label) === normalizedLabel)
    ?? toArray(element.members).find((member) => compareTriggerLocatorPath(member.domPath, locator.domPath));
}

function findSingleElementMatch(element, trigger) {
  const locator = trigger?.locator ?? {};
  const member = toArray(element.members)[0] ?? null;
  if (!member) {
    return false;
  }

  const normalizedLabel = normalizeLabel(trigger?.label || locator.label || locator.textSnippet);
  return Boolean(
    (locator.id && member.matchKey === `id:${locator.id}`)
      || (locator.ariaControls && member.controlledTarget === locator.ariaControls)
      || (normalizedLabel && normalizeLabel(member.label) === normalizedLabel)
      || compareTriggerLocatorPath(member.domPath, locator.domPath)
      || (!locator.id && !locator.ariaControls && !normalizedLabel && !locator.domPath && element.kind === triggerKindToElementKind(trigger?.kind))
  );
}

async function attributeEdgesToTargets(artifacts, indices, fallbackContext, warnings) {
  const attributed = [];

  for (const edge of toArray(artifacts.transitionsDocument.edges)) {
    if (!['captured', 'duplicate'].includes(edge.outcome) || !edge.toState) {
      continue;
    }

    const toState = indices.statesById.get(edge.toState);
    if (!toState) {
      warnings.push(buildWarning('edge_target_state_missing', `Transition target state missing for ${edge.observedStateId}`, {
        observedStateId: edge.observedStateId,
        toState: edge.toState,
      }));
      continue;
    }

    const { trigger, fallbackManifestPath } = await resolveEdgeTrigger(edge, fallbackContext);
    const expectedKind = triggerToExpectedElementKind(trigger);
    if (!expectedKind) {
      warnings.push(buildWarning('edge_trigger_kind_unmapped', `Unable to map trigger kind for ${edge.observedStateId}`, {
        observedStateId: edge.observedStateId,
        triggerKind: trigger?.kind ?? null,
      }));
      continue;
    }

    if ([
      'tab-group',
      'category-link-group',
      'content-link-group',
      'author-link-group',
      'chapter-link-group',
      'utility-link-group',
      'auth-link-group',
      'pagination-link-group',
    ].includes(expectedKind)) {
      let matched = null;
      for (const element of indices.elementsById.values()) {
        if (element.kind !== expectedKind) {
          continue;
        }
        const member = expectedKind === 'tab-group' ? findTabTarget(element, trigger) : findMemberTarget(element, trigger);
        if (!member) {
          continue;
        }
        matched = { element, member };
        break;
      }

      if (!matched) {
        warnings.push(buildWarning('edge_tab_target_unresolved', `Unable to resolve tab target for ${edge.observedStateId}`, {
          observedStateId: edge.observedStateId,
        }));
        continue;
      }

      const targetElementState = indices.elementStatesByStateId.get(toState.stateId)?.get(matched.element.elementId) ?? null;
      const targetValue = normalizeElementStateValue(matched.element.kind, targetElementState) ?? matched.member.memberId;
      attributed.push({
        edgeId: edge.edgeId,
        observedStateId: edge.observedStateId,
        toStateId: toState.stateId,
        elementId: matched.element.elementId,
        elementKind: matched.element.kind,
        targetValue,
        targetLabel: matched.member.label,
        fallbackManifestPath,
      });
      continue;
    }

    if (expectedKind === 'search-form-group') {
      const element = [...indices.elementsById.values()].find((candidate) => candidate.kind === expectedKind) ?? null;
      if (!element) {
        warnings.push(buildWarning('edge_element_unresolved', `Unable to resolve search form for ${edge.observedStateId}`, {
          observedStateId: edge.observedStateId,
          triggerKind: trigger?.kind ?? null,
        }));
        continue;
      }

      const targetValue = normalizeWhitespace(trigger?.queryText || toState.pageFacts?.queryText || '');
      if (!targetValue) {
        warnings.push(buildWarning('edge_target_value_missing', `Unable to resolve search query for ${edge.observedStateId}`, {
          observedStateId: edge.observedStateId,
          elementId: element.elementId,
        }));
        continue;
      }

      attributed.push({
        edgeId: edge.edgeId,
        observedStateId: edge.observedStateId,
        toStateId: toState.stateId,
        elementId: element.elementId,
        elementKind: element.kind,
        targetValue,
        targetLabel: targetValue,
        fallbackManifestPath,
      });
      continue;
    }

    const candidates = [...indices.elementsById.values()].filter((element) => element.kind === expectedKind);
    const element = candidates.find((candidate) => findSingleElementMatch(candidate, trigger)) ?? null;
    if (!element) {
      warnings.push(buildWarning('edge_element_unresolved', `Unable to resolve element for ${edge.observedStateId}`, {
        observedStateId: edge.observedStateId,
        triggerKind: trigger?.kind ?? null,
      }));
      continue;
    }

    const targetElementState = indices.elementStatesByStateId.get(toState.stateId)?.get(element.elementId) ?? null;
    const targetValue = normalizeElementStateValue(element.kind, targetElementState);
    if (targetValue === null) {
      warnings.push(buildWarning('edge_target_value_missing', `Unable to resolve target value for ${edge.observedStateId}`, {
        observedStateId: edge.observedStateId,
        elementId: element.elementId,
      }));
      continue;
    }

    attributed.push({
      edgeId: edge.edgeId,
      observedStateId: edge.observedStateId,
      toStateId: toState.stateId,
      elementId: element.elementId,
      elementKind: element.kind,
      targetValue,
      targetLabel: null,
      fallbackManifestPath,
    });
  }

  return attributed;
}

function buildElementValueObservations(element, statesDocument, indices) {
  const observations = new Map();
  const allStateIds = [];

  for (const state of toArray(statesDocument.states)) {
    const elementState = indices.elementStatesByStateId.get(state.stateId)?.get(element.elementId) ?? null;
    if (!elementState) {
      continue;
    }

    const value = normalizeElementStateValue(element.kind, elementState);
    if (value === null) {
      continue;
    }

    allStateIds.push(state.stateId);
    const key = stableValueKey(value);
    let record = observations.get(key);
    if (!record) {
      record = {
        value,
        label: null,
        stateIds: [],
      };
      observations.set(key, record);
    }
    record.stateIds.push(state.stateId);
  }

  return {
    observations,
    allStateIds: allStateIds.sort(compareNullableStrings),
  };
}

function buildEdgeObservationsForElement(element, attributedEdges) {
  const byValue = new Map();
  const edgeIds = [];

  for (const edge of attributedEdges.filter((item) => item.elementId === element.elementId)) {
    edgeIds.push(edge.edgeId);
    const key = stableValueKey(edge.targetValue);
    let record = byValue.get(key);
    if (!record) {
      record = {
        value: edge.targetValue,
        edgeIds: [],
        fallbackManifestPaths: [],
      };
      byValue.set(key, record);
    }
    record.edgeIds.push(edge.edgeId);
    if (edge.fallbackManifestPath) {
      record.fallbackManifestPaths.push(edge.fallbackManifestPath);
    }
  }

  for (const record of byValue.values()) {
    record.edgeIds.sort(compareNullableStrings);
    record.fallbackManifestPaths = [...new Set(record.fallbackManifestPaths)].sort(compareNullableStrings);
  }

  return {
    byValue,
    edgeIds: [...new Set(edgeIds)].sort(compareNullableStrings),
  };
}

function buildIntentName(intentType, element, targetParameter, siteProfileDocument = null, baseUrl = null) {
  const displayName = displayIntentName(intentType, siteProfileDocument, baseUrl);
  switch (intentType) {
      case 'switch-tab':
        return `Set Active Member: ${element.elementName}`;
      case 'expand-panel':
        return `Expand Panel: ${element.elementName}`;
      case 'open-overlay':
        return `Open Overlay: ${element.elementName}`;
      case 'open-category':
        return `${displayName || 'Open Category'}: ${element.elementName}`;
      case 'list-category-videos':
        return `${displayName || 'List Category Videos'}: ${element.elementName}`;
      case 'open-book':
        return `${displayName || 'Open Book'}: ${element.elementName}`;
      case 'open-video':
        return `${displayName || 'Open Video'}: ${element.elementName}`;
      case 'open-work':
        return `${displayName || 'Open Work'}: ${element.elementName}`;
      case 'open-author':
        return `${displayName || 'Open Author'}: ${element.elementName}`;
      case 'open-model':
        return `${displayName || 'Open Model'}: ${element.elementName}`;
      case 'open-actress':
        return `${displayName || 'Open Actress'}: ${element.elementName}`;
      case 'open-chapter':
        return `Open Chapter: ${element.elementName}`;
      case 'open-utility-page':
        return `${displayName || 'Open Utility Page'}: ${element.elementName}`;
      case 'open-auth-page':
        return `${displayName || 'Open Auth Page'}: ${element.elementName}`;
      case 'paginate-content':
        return `Paginate Content: ${element.elementName}`;
      case 'search-book':
        return `Search Book: ${element.elementName}`;
      case 'search-video':
        return `${displayName || 'Search Video'}: ${element.elementName}`;
      case 'search-work':
        return `${displayName || 'Search Work'}: ${element.elementName}`;
      case 'download-book':
        return `Download Book: ${element.elementName}`;
    default:
      return displayName ? `${displayName}: ${element.elementName}` : `${intentType}: ${element.elementName} (${targetParameter})`;
    }
}

function buildJableCategoryCanonicalLabel(label) {
  return normalizeLabel(String(label ?? '').replace(/^#+/u, ''));
}

function collectJableCategoryTaxonomy(statesDocument) {
  const groups = new Map();
  for (const state of toArray(statesDocument?.states)) {
    for (const group of toArray(state?.pageFacts?.categoryTaxonomy)) {
      const groupLabel = normalizeWhitespace(group?.groupLabel);
      if (!groupLabel) {
        continue;
      }
      const groupEntry = groups.get(groupLabel) ?? {
        groupLabel,
        canonicalLabel: buildJableCategoryCanonicalLabel(groupLabel),
        tags: new Map(),
        stateIds: new Set(),
      };
      groupEntry.stateIds.add(state.stateId);
      for (const tag of toArray(group?.tags)) {
        const tagLabel = normalizeWhitespace(tag?.label);
        const tagHref = normalizeUrlNoFragment(tag?.href);
        if (!tagLabel || !tagHref) {
          continue;
        }
        const tagEntry = groupEntry.tags.get(tagLabel) ?? {
          label: tagLabel,
          canonicalLabel: buildJableCategoryCanonicalLabel(tagLabel),
          href: tagHref,
        };
        groupEntry.tags.set(tagLabel, tagEntry);
      }
      groups.set(groupLabel, groupEntry);
    }
  }
  return [...groups.values()]
    .map((group) => ({
      groupLabel: group.groupLabel,
      canonicalLabel: group.canonicalLabel,
      stateIds: [...group.stateIds].sort(compareNullableStrings),
      tags: [...group.tags.values()].sort((left, right) => compareNullableStrings(left.label, right.label)),
    }))
    .sort((left, right) => compareNullableStrings(left.groupLabel, right.groupLabel));
}

function findElementMemberByHref(element, href) {
  const normalizedHref = normalizeUrlNoFragment(href);
  if (!normalizedHref) {
    return null;
  }
  return toArray(element?.members).find((member) => {
    const locatorHref = normalizeUrlNoFragment(member?.locator?.href);
    return locatorHref && locatorHref === normalizedHref;
  }) ?? null;
}

function buildJableCategoryRankingIntent(elementsDocument, statesDocument, intents, siteProfileDocument = null, baseUrl = null) {
  if (!isJableSite(siteProfileDocument, baseUrl)) {
    return null;
  }

  const categoryIntent = intents.find((intent) => intent.intentType === 'open-category' && intent.elementKind === 'category-link-group');
  if (!categoryIntent) {
    return null;
  }

  const categoryElement = toArray(elementsDocument?.elements).find((element) => element.elementId === categoryIntent.elementId) ?? null;
  if (!categoryElement) {
    return null;
  }

  const taxonomyGroups = collectJableCategoryTaxonomy(statesDocument);
  if (taxonomyGroups.length === 0) {
    return null;
  }

  const recordsByValue = new Map();
  const addRecord = (record) => {
    const key = stableValueKey(record.value);
    const current = recordsByValue.get(key) ?? {
      value: record.value,
      label: record.label ?? null,
      displayLabel: record.displayLabel ?? record.label ?? null,
      canonicalLabel: record.canonicalLabel ?? buildJableCategoryCanonicalLabel(record.label),
      scopeType: record.scopeType ?? null,
      groupLabel: record.groupLabel ?? null,
      targetUrl: record.targetUrl ?? null,
      stateIds: new Set(),
      edgeIds: new Set(),
      observed: false,
      actionable: false,
    };
    current.label = firstNonEmpty([record.label, current.label]);
    current.displayLabel = firstNonEmpty([record.displayLabel, current.displayLabel, current.label]);
    current.canonicalLabel = firstNonEmpty([record.canonicalLabel, current.canonicalLabel]);
    current.scopeType = firstNonEmpty([record.scopeType, current.scopeType]);
    current.groupLabel = firstNonEmpty([record.groupLabel, current.groupLabel]);
    current.targetUrl = firstNonEmpty([record.targetUrl, current.targetUrl]);
    current.observed = current.observed || Boolean(record.observed);
    current.actionable = current.actionable || Boolean(record.actionable);
    for (const stateId of toArray(record.stateIds)) {
      current.stateIds.add(stateId);
    }
    for (const edgeId of toArray(record.edgeIds)) {
      current.edgeIds.add(edgeId);
    }
    recordsByValue.set(key, current);
  };

  for (const group of taxonomyGroups) {
    addRecord({
      value: `group:${group.groupLabel}`,
      label: group.groupLabel,
      displayLabel: group.groupLabel,
      canonicalLabel: group.canonicalLabel,
      scopeType: 'group',
      groupLabel: group.groupLabel,
      targetUrl: normalizeUrlNoFragment(`${baseUrl ? new URL('/categories/', baseUrl).toString() : 'https://jable.tv/categories/'}`),
      stateIds: group.stateIds,
      observed: true,
      actionable: true,
      edgeIds: [],
    });

    for (const tag of group.tags) {
      const member = findElementMemberByHref(categoryElement, tag.href);
      const observedRecord = toArray(categoryIntent.targetDomain?.observedValues).find((item) => {
        const memberLabel = normalizeWhitespace(item?.label);
        return memberLabel === tag.label;
      }) ?? null;
      const actionableRecord = toArray(categoryIntent.targetDomain?.actionableValues).find((item) => {
        const memberLabel = normalizeWhitespace(item?.label);
        return memberLabel === tag.label;
      }) ?? null;
      addRecord({
        value: member?.memberId ?? `tag:${tag.href}`,
        label: tag.label,
        displayLabel: tag.label,
        canonicalLabel: tag.canonicalLabel,
        scopeType: 'tag',
        groupLabel: group.groupLabel,
        targetUrl: tag.href,
        stateIds: [...group.stateIds, ...toArray(observedRecord?.stateIds)],
        edgeIds: toArray(actionableRecord?.edgeIds),
        observed: true,
        actionable: true,
      });
    }
  }

  const observedValues = [];
  const candidateValues = [];
  const actionableValues = [];
  const evidenceStateIds = new Set(categoryIntent.evidence?.stateIds ?? []);
  const evidenceEdgeIds = new Set(categoryIntent.evidence?.edgeIds ?? []);

  for (const record of recordsByValue.values()) {
    const stateIds = [...record.stateIds].sort(compareNullableStrings);
    const edgeIds = [...record.edgeIds].sort(compareNullableStrings);
    for (const stateId of stateIds) {
      evidenceStateIds.add(stateId);
    }
    for (const edgeId of edgeIds) {
      evidenceEdgeIds.add(edgeId);
    }
    observedValues.push({
      value: record.value,
      label: record.label,
      displayLabel: record.displayLabel,
      canonicalLabel: record.canonicalLabel,
      scopeType: record.scopeType,
      groupLabel: record.groupLabel,
      targetUrl: record.targetUrl,
      stateIds,
      edgeIds,
    });
    candidateValues.push({
      value: record.value,
      label: record.label,
      displayLabel: record.displayLabel,
      canonicalLabel: record.canonicalLabel,
      scopeType: record.scopeType,
      groupLabel: record.groupLabel,
      targetUrl: record.targetUrl,
      observed: true,
    });
    actionableValues.push({
      value: record.value,
      label: record.label,
      displayLabel: record.displayLabel,
      canonicalLabel: record.canonicalLabel,
      scopeType: record.scopeType,
      groupLabel: record.groupLabel,
      targetUrl: record.targetUrl,
      edgeIds,
    });
  }

  const sortRecords = (left, right) => (
    compareNullableStrings(left.scopeType, right.scopeType)
      || compareNullableStrings(left.groupLabel, right.groupLabel)
      || compareNullableStrings(left.label, right.label)
      || compareValue(left.value, right.value)
  );

  return {
    intentId: `intent_${createSha256(`${categoryIntent.elementId}::list-category-videos`).slice(0, 12)}`,
    intentType: 'list-category-videos',
    intentName: buildIntentName('list-category-videos', categoryElement, 'targetMemberId', siteProfileDocument, baseUrl),
    elementId: categoryIntent.elementId,
    elementKind: categoryIntent.elementKind,
    sourceElementName: categoryIntent.sourceElementName,
    stateField: categoryIntent.stateField,
    actionId: 'query-ranking',
    defaults: {
      sortMode: 'combined',
      limit: 3,
    },
    rankingModes: ['combined', 'recent', 'most-viewed', 'most-favourited'],
    targetDomain: {
      parameter: 'targetMemberId',
      observedValues: observedValues.sort(sortRecords),
      candidateValues: candidateValues.sort(sortRecords),
      actionableValues: actionableValues.sort(sortRecords),
    },
    evidence: {
      stateIds: [...evidenceStateIds].sort(compareNullableStrings),
      edgeIds: [...evidenceEdgeIds].sort(compareNullableStrings),
    },
  };
}

function buildMemberTargetDomain(element, valueObservations, edgeObservations, siteProfileDocument = null, baseUrl = null) {
  const observedKeys = new Set(valueObservations.observations.keys());
  const observedValues = [...valueObservations.observations.values()]
    .map((record) => {
      const member = toArray(element.members).find((item) => item.memberId === record.value) ?? null;
      const edgeRecord = edgeObservations.byValue.get(stableValueKey(record.value));
      return {
        value: record.value,
        label: member?.label ?? record.label ?? null,
        stateIds: [...record.stateIds].sort(compareNullableStrings),
        edgeIds: edgeRecord?.edgeIds ?? [],
      };
    })
    .sort((left, right) => compareNullableStrings(left.label, right.label) || compareValue(left.value, right.value));

  const candidateValues = toArray(element.members)
    .map((member) => ({
      value: member.memberId,
      label: member.label ?? null,
      observed: observedKeys.has(stableValueKey(member.memberId)),
    }))
    .sort((left, right) => compareNullableStrings(left.label, right.label) || compareValue(left.value, right.value));

  const actionableValues = [...edgeObservations.byValue.values()]
    .map((record) => {
      const member = toArray(element.members).find((item) => item.memberId === record.value) ?? null;
      return {
        value: record.value,
        label: member?.label ?? null,
        edgeIds: record.edgeIds,
      };
    })
    .sort((left, right) => compareNullableStrings(left.label, right.label) || compareValue(left.value, right.value));

  if (isJableSite(siteProfileDocument, baseUrl) && element.kind === 'category-link-group') {
    const actionableKeys = new Set(actionableValues.map((record) => stableValueKey(record.value)));
    for (const candidate of candidateValues) {
      const candidateKey = stableValueKey(candidate.value);
      if (!actionableKeys.has(candidateKey)) {
        actionableValues.push({
          value: candidate.value,
          label: candidate.label ?? null,
          edgeIds: [],
        });
        actionableKeys.add(candidateKey);
      }
      if (!observedKeys.has(candidateKey)) {
        observedValues.push({
          value: candidate.value,
          label: candidate.label ?? null,
          stateIds: [],
          edgeIds: [],
        });
        observedKeys.add(candidateKey);
      }
    }
    observedValues.sort((left, right) => compareNullableStrings(left.label, right.label) || compareValue(left.value, right.value));
    actionableValues.sort((left, right) => compareNullableStrings(left.label, right.label) || compareValue(left.value, right.value));
  }

  return {
    parameter: 'targetMemberId',
    observedValues,
    candidateValues,
    actionableValues,
  };
}

function isMemberTargetElementKind(elementKind) {
  return [
    'tab-group',
    'category-link-group',
    'content-link-group',
    'author-link-group',
    'chapter-link-group',
    'utility-link-group',
    'auth-link-group',
    'pagination-link-group',
  ].includes(elementKind);
}

function buildStringTargetDomain(valueObservations, edgeObservations) {
  const observedValues = [...valueObservations.observations.values()]
    .filter((record) => !/^[?？]+$/.test(String(record.value ?? '').trim()))
    .map((record) => {
      const edgeRecord = edgeObservations.byValue.get(stableValueKey(record.value));
      return {
        value: String(record.value ?? ''),
        label: record.label ?? String(record.value ?? ''),
        stateIds: [...record.stateIds].sort(compareNullableStrings),
        edgeIds: edgeRecord?.edgeIds ?? [],
      };
    })
    .sort((left, right) => compareNullableStrings(left.label, right.label) || compareValue(left.value, right.value));

  const observedKeys = new Set(observedValues.map((record) => stableValueKey(record.value)));
  const candidateValues = observedValues.map((record) => ({
    value: record.value,
    label: record.label,
    observed: true,
  }));

  const actionableValues = [...edgeObservations.byValue.values()]
    .filter((record) => !/^[?？]+$/.test(String(record.value ?? '').trim()))
    .map((record) => ({
      value: String(record.value ?? ''),
      label: String(record.value ?? ''),
      edgeIds: record.edgeIds,
    }))
    .filter((record) => record.value)
    .sort((left, right) => compareNullableStrings(left.label, right.label) || compareValue(left.value, right.value));

  for (const actionable of actionableValues) {
    if (!observedKeys.has(stableValueKey(actionable.value))) {
      candidateValues.push({
        value: actionable.value,
        label: actionable.label,
        observed: false,
      });
    }
  }

  candidateValues.sort((left, right) => compareNullableStrings(left.label, right.label) || compareValue(left.value, right.value));

  return {
    parameter: 'queryText',
    observedValues,
    candidateValues,
    actionableValues,
  };
}

function buildBooleanTargetDomain(valueObservations, edgeObservations) {
  const observedValues = [...valueObservations.observations.values()]
    .map((record) => {
      const edgeRecord = edgeObservations.byValue.get(stableValueKey(record.value));
      return {
        value: Boolean(record.value),
        label: null,
        stateIds: [...record.stateIds].sort(compareNullableStrings),
        edgeIds: edgeRecord?.edgeIds ?? [],
      };
    })
    .sort((left, right) => compareValue(left.value, right.value));

  const candidateValues = observedValues.map((record) => ({
    value: record.value,
    label: null,
    observed: true,
  }));

  const actionableValues = [...edgeObservations.byValue.values()]
    .map((record) => ({
      value: Boolean(record.value),
      label: null,
      edgeIds: record.edgeIds,
    }))
    .sort((left, right) => compareValue(left.value, right.value));

  return {
    parameter: 'desiredValue',
    observedValues,
    candidateValues,
    actionableValues,
  };
}

function buildIntents(elementsDocument, statesDocument, indices, attributedEdges, warnings, siteProfileDocument = null, baseUrl = null) {
  const intents = [];
  const skippedElements = [];

  for (const element of toArray(elementsDocument.elements).sort((left, right) => compareNullableStrings(left.elementId, right.elementId))) {
    const spec = buildStateFieldSpec(element.kind, siteProfileDocument, baseUrl);
    if (!spec) {
      skippedElements.push(element.elementId);
      warnings.push(buildWarning('element_kind_unmapped', `Skipping ${element.elementId}; unsupported element kind ${element.kind}`, {
        elementId: element.elementId,
        elementKind: element.kind,
      }));
      continue;
    }

    const valueObservations = buildElementValueObservations(element, statesDocument, indices);
    const edgeObservations = buildEdgeObservationsForElement(element, attributedEdges);
    const distinctObservedValues = [...valueObservations.observations.values()];

    if (distinctObservedValues.length === 0) {
      skippedElements.push(element.elementId);
      warnings.push(buildWarning('element_missing_state_values', `Skipping ${element.elementId}; no concrete state values found`, {
        elementId: element.elementId,
      }));
      continue;
    }

    let targetDomain;
    if (spec.parameter === 'queryText') {
      targetDomain = buildStringTargetDomain(valueObservations, edgeObservations);
    } else if (isMemberTargetElementKind(element.kind)) {
      targetDomain = buildMemberTargetDomain(element, valueObservations, edgeObservations, siteProfileDocument, baseUrl);
    } else {
      targetDomain = buildBooleanTargetDomain(valueObservations, edgeObservations);
    }

    if (targetDomain.actionableValues.length === 0) {
      skippedElements.push(element.elementId);
      warnings.push(buildWarning('element_not_actionable', `Skipping ${element.elementId}; no attributable action evidence found`, {
        elementId: element.elementId,
      }));
      continue;
    }

    /** @type {IntentRecord} */
    const intent = {
      intentId: `intent_${createSha256(`${element.elementId}::${spec.intentType}`).slice(0, 12)}`,
      intentType: spec.intentType,
      intentName: buildIntentName(spec.intentType, element, spec.parameter, siteProfileDocument, baseUrl),
      elementId: element.elementId,
      elementKind: element.kind,
      sourceElementName: element.elementName,
      stateField: spec.stateField,
      actionId: spec.actionId,
      targetDomain,
      evidence: {
        stateIds: valueObservations.allStateIds,
        edgeIds: edgeObservations.edgeIds,
      },
    };

    intents.push(intent);
  }

  const jableRankingIntent = buildJableCategoryRankingIntent(elementsDocument, statesDocument, intents, siteProfileDocument, baseUrl);
  if (jableRankingIntent) {
    intents.push(jableRankingIntent);
  }

  intents.sort((left, right) => compareNullableStrings(left.elementKind, right.elementKind) || compareNullableStrings(left.elementId, right.elementId));
  skippedElements.sort(compareNullableStrings);

  return { intents, skippedElements };
}

function buildDownloadIntent(artifacts, intents, indices, warnings) {
  const books = toArray(artifacts.bookContentBooksDocument);
  if (books.length === 0) {
    return null;
  }

  const contentIntent = intents.find((intent) => intent.elementKind === 'content-link-group' && (
    intent.intentType === 'open-book'
      || intent.intentType === 'open-work'
  )) ?? null;
  if (!contentIntent) {
    warnings.push(buildWarning('download_intent_skipped', 'Skipping download-book intent; no content-link-group intent available.', {}));
    return null;
  }

  const contentElement = indices.elementsById.get(contentIntent.elementId);
  if (!contentElement) {
    warnings.push(buildWarning('download_intent_skipped', 'Skipping download-book intent; content-link-group element missing.', {
      elementId: contentIntent.elementId,
    }));
    return null;
  }

  const actionableValues = [];
  const observedValues = [];
  const candidateValues = [];
  const stateIds = new Set();
  const booksByLabel = new Map(
    books.map((book) => [normalizeLabel(book.title), book]),
  );

  for (const candidate of toArray(contentIntent.targetDomain?.candidateValues)) {
    const label = firstNonEmpty([candidate.label, toArray(contentElement.members).find((member) => member.memberId === candidate.value)?.label]) ?? null;
    const normalized = normalizeLabel(label);
    const book = booksByLabel.get(normalized) ?? null;
    candidateValues.push({
      value: candidate.value,
      label,
      observed: Boolean(candidate.observed),
    });
    if (!book?.downloadFile) {
      continue;
    }
    actionableValues.push({
      value: candidate.value,
      label,
      edgeIds: [],
      downloadFile: book.downloadFile,
      bookUrl: book.finalUrl,
    });
    const observedRecord = toArray(contentIntent.targetDomain?.observedValues).find((record) => record.value === candidate.value) ?? null;
    observedValues.push({
      value: candidate.value,
      label,
      stateIds: toArray(observedRecord?.stateIds).sort(compareNullableStrings),
      edgeIds: [],
    });
    for (const stateId of toArray(observedRecord?.stateIds)) {
      stateIds.add(stateId);
    }
  }

  if (actionableValues.length === 0) {
    warnings.push(buildWarning('download_intent_skipped', 'Skipping download-book intent; no collected download artifacts matched book targets.', {}));
    return null;
  }

  return {
    intentId: `intent_${createSha256(`${contentIntent.elementId}::download-book`).slice(0, 12)}`,
    intentType: 'download-book',
    intentName: buildIntentName('download-book', contentElement, 'targetMemberId'),
    elementId: contentIntent.elementId,
    elementKind: contentIntent.elementKind,
    sourceElementName: contentIntent.sourceElementName,
    stateField: 'activeMemberId',
    actionId: 'download-book',
    targetDomain: {
      parameter: 'targetMemberId',
      observedValues: observedValues.sort((left, right) => compareNullableStrings(left.label, right.label) || compareValue(left.value, right.value)),
      candidateValues: candidateValues.sort((left, right) => compareNullableStrings(left.label, right.label) || compareValue(left.value, right.value)),
      actionableValues: actionableValues.sort((left, right) => compareNullableStrings(left.label, right.label) || compareValue(left.value, right.value)),
    },
    evidence: {
      stateIds: [...stateIds].sort(compareNullableStrings),
      edgeIds: [],
    },
  };
}

function buildRuleBindings(parameterName, value, elementId) {
  if (parameterName === 'targetMemberId') {
    return {
      elementId,
      targetMemberId: String(value),
    };
  }
  if (parameterName === 'queryText') {
    return {
      elementId,
      queryText: String(value ?? ''),
    };
  }
  return {
    elementId,
    desiredValue: Boolean(value),
  };
}

function buildElementStatePatch(stateField, value) {
  return {
    [stateField]: value,
  };
}

function buildDecisionRules(intents, statesDocument, attributedEdges) {
  const rules = [];

  for (const intent of intents) {
    const allElementStateIds = toArray(intent.evidence.stateIds);
    const actionableByKey = new Map(intent.targetDomain.actionableValues.map((record) => [stableValueKey(record.value), record]));
    const observedByKey = new Map(intent.targetDomain.observedValues.map((record) => [stableValueKey(record.value), record]));

    for (const observedValue of intent.targetDomain.observedValues) {
      const targetKey = stableValueKey(observedValue.value);
      const parameterBinding = intent.targetDomain.parameter === 'targetMemberId'
        ? { targetMemberId: String(observedValue.value) }
        : intent.targetDomain.parameter === 'queryText'
          ? { queryText: String(observedValue.value ?? '') }
          : { desiredValue: Boolean(observedValue.value) };
      const satisfiedRule = {
        ruleId: `rule_${createSha256(`${intent.intentId}::satisfied::${serializeDecisionValue(observedValue.value)}`).slice(0, 12)}`,
        intentId: intent.intentId,
        priority: 10,
        phase: 'satisfied',
        parameterBinding,
        when: {
          elementId: intent.elementId,
          elementKind: intent.elementKind,
          all: [
            {
              field: intent.stateField,
              op: 'eq',
              value: observedValue.value,
            },
          ],
        },
        then: {
          actionId: 'noop',
          bindings: buildRuleBindings(intent.targetDomain.parameter, observedValue.value, intent.elementId),
        },
        expected: {
          elementStatePatch: buildElementStatePatch(intent.stateField, observedValue.value),
          toStateIds: [...observedValue.stateIds].sort(compareNullableStrings),
          edgeIds: [...observedValue.edgeIds].sort(compareNullableStrings),
        },
        evidence: {
          stateIds: [...observedValue.stateIds].sort(compareNullableStrings),
          edgeIds: [...observedValue.edgeIds].sort(compareNullableStrings),
        },
      };

      rules.push(satisfiedRule);

      const actionable = actionableByKey.get(targetKey);
      if (actionable) {
        const targetStateIds = observedByKey.get(targetKey)?.stateIds ?? [];
        const applicableStateIds = allElementStateIds.filter((stateId) => !targetStateIds.includes(stateId));
        const fallbackStateManifests = buildFallbackStateManifestList(
          attributedEdges
            .filter((edge) => edge.elementId === intent.elementId && stableValueKey(edge.targetValue) === targetKey)
            .map((edge) => edge.fallbackManifestPath),
        );
        const actRule = {
          ruleId: `rule_${createSha256(`${intent.intentId}::act::${serializeDecisionValue(observedValue.value)}`).slice(0, 12)}`,
          intentId: intent.intentId,
          priority: 20,
          phase: 'act',
          parameterBinding,
          when: {
            elementId: intent.elementId,
            elementKind: intent.elementKind,
            all: [
              {
                field: intent.stateField,
                op: 'neq',
                value: observedValue.value,
              },
            ],
          },
          then: {
            actionId: intent.actionId,
            bindings: buildRuleBindings(intent.targetDomain.parameter, observedValue.value, intent.elementId),
          },
          expected: {
            elementStatePatch: buildElementStatePatch(intent.stateField, observedValue.value),
            toStateIds: [...targetStateIds].sort(compareNullableStrings),
            edgeIds: [...actionable.edgeIds].sort(compareNullableStrings),
          },
          evidence: {
            stateIds: applicableStateIds.sort(compareNullableStrings),
            edgeIds: [...actionable.edgeIds].sort(compareNullableStrings),
            ...(fallbackStateManifests ? { fallbackStateManifests } : {}),
          },
        };
        rules.push(actRule);
      }
    }
  }

  rules.sort((left, right) => (
    compareNullableStrings(left.intentId, right.intentId)
      || left.priority - right.priority
      || compareValue(
        left.parameterBinding.targetMemberId ?? left.parameterBinding.queryText ?? left.parameterBinding.desiredValue,
        right.parameterBinding.targetMemberId ?? right.parameterBinding.queryText ?? right.parameterBinding.desiredValue,
      )
  ));
  return rules;
}

function buildDownloadDecisionRules(downloadIntent) {
  if (!downloadIntent) {
    return [];
  }
  const rules = [];
  for (const target of toArray(downloadIntent.targetDomain?.actionableValues)) {
    rules.push({
      ruleId: `rule_${createSha256(`${downloadIntent.intentId}::download::${serializeDecisionValue(target.value)}`).slice(0, 12)}`,
      intentId: downloadIntent.intentId,
      priority: 20,
      phase: 'act',
      parameterBinding: {
        targetMemberId: String(target.value),
      },
      when: {
        elementId: downloadIntent.elementId,
        elementKind: downloadIntent.elementKind,
        all: [
          {
            field: downloadIntent.stateField,
            op: 'neq',
            value: target.value,
          },
        ],
      },
      then: {
        actionId: downloadIntent.actionId,
        bindings: {
          elementId: downloadIntent.elementId,
          targetMemberId: String(target.value),
        },
      },
      expected: {
        elementStatePatch: buildElementStatePatch(downloadIntent.stateField, target.value),
        toStateIds: [],
        edgeIds: [],
        artifactPath: target.downloadFile ?? null,
      },
      evidence: {
        stateIds: [],
        edgeIds: [],
      },
    });
  }
  return rules;
}

function buildIntentsDocument(inputUrl, baseUrl, generatedAt, intents) {
  return {
    inputUrl,
    baseUrl,
    generatedAt,
    intents,
  };
}

function buildCapabilityMatrixDocument(inputUrl, baseUrl, generatedAt, siteProfileDocument, intents) {
  return {
    inputUrl,
    baseUrl,
    generatedAt,
    primaryArchetype: siteProfileDocument?.primaryArchetype ?? 'unknown',
    archetypes: toArray(siteProfileDocument?.archetypes),
    capabilityFamilies: toArray(siteProfileDocument?.capabilityFamilies),
    pageTypes: toArray(siteProfileDocument?.pageTypes),
    capabilities: intents.map((intent) => ({
      intentId: intent.intentId,
      intentType: intent.intentType,
      elementId: intent.elementId,
      elementKind: intent.elementKind,
      actionId: intent.actionId,
      stateField: intent.stateField,
      capabilityFamily: intent.intentType === 'download-book'
        ? 'download-content'
        : intent.intentType === 'list-category-videos'
          ? 'query-ranked-content'
        : buildStateFieldSpec(intent.elementKind)?.capabilityFamily ?? null,
      actionableTargets: toArray(intent.targetDomain?.actionableValues).map((value) => ({
        value: value.value,
        label: value.label ?? null,
        edgeIds: toArray(value.edgeIds),
      })),
      candidateTargets: toArray(intent.targetDomain?.candidateValues).map((value) => ({
        value: value.value,
        label: value.label ?? null,
        observed: Boolean(value.observed),
      })),
    })),
  };
}

export async function abstractInteractions(inputUrl, options = {}) {
  const settings = mergeOptions(options);
  const artifacts = await loadAnalysisArtifacts({ ...settings, url: inputUrl });
  const warnings = [...artifacts.warnings];
  const indices = buildIndices(artifacts.elementsDocument, artifacts.statesDocument, artifacts.transitionsDocument);
  const fallbackContext = await createFallbackContext(artifacts, indices, warnings);
  const attributedEdges = await attributeEdgesToTargets(artifacts, indices, fallbackContext, warnings);
  const { intents, skippedElements } = buildIntents(
    artifacts.elementsDocument,
    artifacts.statesDocument,
    indices,
    attributedEdges,
    warnings,
    artifacts.siteProfileDocument,
    artifacts.baseUrl,
  );
  const downloadIntent = buildDownloadIntent(artifacts, intents, indices, warnings);
  if (downloadIntent) {
    intents.push(downloadIntent);
  }
  intents.sort((left, right) => compareNullableStrings(left.elementKind, right.elementKind) || compareNullableStrings(left.elementId, right.elementId) || compareNullableStrings(left.intentType, right.intentType));
  const rules = [
    ...buildDecisionRules(intents.filter((intent) => intent.intentType !== 'download-book'), artifacts.statesDocument, attributedEdges),
    ...buildDownloadDecisionRules(downloadIntent),
  ];
  rules.sort((left, right) => (
    compareNullableStrings(left.intentId, right.intentId)
      || left.priority - right.priority
      || compareValue(
        left.parameterBinding.targetMemberId ?? left.parameterBinding.queryText ?? left.parameterBinding.desiredValue,
        right.parameterBinding.targetMemberId ?? right.parameterBinding.queryText ?? right.parameterBinding.desiredValue,
      )
  ));
  const layout = await createOutputLayout(artifacts.baseUrl ?? inputUrl, settings.outDir);

  const intentsDocument = buildIntentsDocument(artifacts.inputUrl, artifacts.baseUrl, layout.generatedAt, intents);
  const actionsDocument = buildActionsDocument(artifacts.inputUrl, artifacts.baseUrl, layout.generatedAt);
  const decisionTableDocument = buildDecisionTableDocument(artifacts.inputUrl, artifacts.baseUrl, layout.generatedAt, rules);
  const capabilityMatrixDocument = buildCapabilityMatrixDocument(
    artifacts.inputUrl,
    artifacts.baseUrl,
    layout.generatedAt,
    artifacts.siteProfileDocument,
    intents,
  );
  const abstractionManifest = buildAbstractionManifest({
    inputUrl: artifacts.inputUrl,
    baseUrl: artifacts.baseUrl,
    generatedAt: layout.generatedAt,
    outDir: layout.outDir,
    artifacts,
    intents,
    rules,
    skippedElements,
    usedFallbackEvidence: fallbackContext.usedFallbackEvidence,
    warnings,
  });

  await writeJsonFile(layout.intentsPath, intentsDocument);
  await writeJsonFile(layout.actionsPath, actionsDocument);
  await writeJsonFile(layout.decisionTablePath, decisionTableDocument);
  await writeJsonFile(layout.capabilityMatrixPath, capabilityMatrixDocument);
  await writeJsonFile(layout.manifestPath, abstractionManifest);

  return abstractionManifest;
}

function printHelp() {
  process.stdout.write(`Usage:
  node abstract-interactions.mjs <url> --analysis-manifest <path>
  node abstract-interactions.mjs <url> --analysis-dir <dir>

Options:
  --analysis-manifest <path>  Path to analysis-manifest.json
  --analysis-dir <dir>        Directory containing third-step outputs
  --expanded-dir <dir>        Optional second-step output directory for fallback evidence
  --out-dir <dir>             Root output directory
  --help                      Show this help
`);
}

function parseCliArgs(argv) {
  const args = [...argv];
  const options = {};
  let url = null;

  const readValue = (current, index) => {
    const eqIndex = current.indexOf('=');
    if (eqIndex !== -1) {
      return { value: current.slice(eqIndex + 1), nextIndex: index };
    }
    if (index + 1 >= args.length) {
      throw new Error(`Missing value for ${current}`);
    }
    return { value: args[index + 1], nextIndex: index + 1 };
  };

  for (let index = 0; index < args.length; index += 1) {
    const current = args[index];
    if (!current.startsWith('--')) {
      if (url !== null) {
        throw new Error(`Unexpected argument: ${current}`);
      }
      url = current;
      continue;
    }

    switch (current.split('=')[0]) {
      case '--analysis-manifest': {
        const { value, nextIndex } = readValue(current, index);
        options.analysisManifestPath = value;
        index = nextIndex;
        break;
      }
      case '--analysis-dir': {
        const { value, nextIndex } = readValue(current, index);
        options.analysisDir = value;
        index = nextIndex;
        break;
      }
      case '--expanded-dir': {
        const { value, nextIndex } = readValue(current, index);
        options.expandedStatesDir = value;
        index = nextIndex;
        break;
      }
      case '--out-dir': {
        const { value, nextIndex } = readValue(current, index);
        options.outDir = value;
        index = nextIndex;
        break;
      }
      case '--help':
        options.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${current}`);
    }
  }

  return { url, options };
}

async function runCli() {
  initializeCliUtf8();
  try {
    const { url, options } = parseCliArgs(process.argv.slice(2));
    if (options.help || !url) {
      printHelp();
      process.exitCode = options.help ? 0 : 1;
      return;
    }

    const manifest = await abstractInteractions(url, options);
    process.stdout.write(`${JSON.stringify(summarizeForStdout(manifest), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

const isCliEntrypoint = (() => {
  if (!process.argv[1]) {
    return false;
  }
  return path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
})();

if (isCliEntrypoint) {
  await runCli();
}

function buildActionsDocument(inputUrl, baseUrl, generatedAt) {
  return {
    inputUrl,
    baseUrl,
    generatedAt,
    actions: ACTION_DEFINITIONS,
  };
}

function buildDecisionTableDocument(inputUrl, baseUrl, generatedAt, rules) {
  return {
    inputUrl,
    baseUrl,
    generatedAt,
    evaluationMode: 'first-match',
    rules,
  };
}

function buildAbstractionManifest({
  inputUrl,
  baseUrl,
  generatedAt,
  outDir,
  artifacts,
  intents,
  rules,
  skippedElements,
  usedFallbackEvidence,
  warnings,
}) {
  return buildRunManifest({
    inputUrl,
    baseUrl,
    generatedAt,
    outDir,
    upstream: {
      analysis: {
        manifest: artifacts.analysisManifestPath,
        dir: artifacts.analysisDir,
      },
      expandedStates: {
        dir: artifacts.expandedStatesDir,
      },
      bookContent: {
        manifest: artifacts.bookContentManifestPath,
        dir: artifacts.bookContentDir,
      },
      flags: {
        usedFallbackEvidence,
      },
    },
    summary: {
      inputElements: toArray(artifacts.elementsDocument.elements).length,
      inputStates: toArray(artifacts.statesDocument.states).length,
      inputEdges: toArray(artifacts.transitionsDocument.edges).length,
      actionableElements: intents.length,
      skippedElements: skippedElements.length,
      intents: intents.length,
      actions: ACTION_DEFINITIONS.length,
      decisionRules: rules.length,
      noopRules: rules.filter((rule) => rule.phase === 'satisfied').length,
      actRules: rules.filter((rule) => rule.phase === 'act').length,
      primaryArchetype: artifacts.siteProfileDocument?.primaryArchetype ?? 'unknown',
    },
    files: {
      intents: path.join(outDir, 'intents.json'),
      actions: path.join(outDir, 'actions.json'),
      decisionTable: path.join(outDir, 'decision-table.json'),
      capabilityMatrix: path.join(outDir, CAPABILITY_MATRIX_FILE_NAME),
      manifest: path.join(outDir, 'abstraction-manifest.json'),
    },
    warnings,
  });
}
