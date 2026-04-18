// @ts-check

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { initializeCliUtf8 } from './lib/cli.mjs';
import { ensureDir, pathExists, readJsonFile, writeJsonFile, writeTextFile } from './lib/io.mjs';
import {
  loadOptionalManifest,
  resolveLinkedArtifactManifest,
  resolveNamedManifest,
  resolveStageFiles,
  resolveStageInput,
} from './lib/pipeline/artifacts/index.mjs';
import {
  getManifestArtifactDir,
  getManifestRunContext,
} from './lib/pipeline/run-manifest.mjs';
import { resolveMaybeRelative } from './lib/wiki-paths.mjs';

const DEFAULT_OPTIONS = {
  interactionModelPath: undefined,
  docsManifestPath: undefined,
  docsDir: undefined,
  nlEntryDir: undefined,
  abstractionDir: undefined,
  analysisDir: undefined,
  expandedStatesDir: undefined,
  outDir: path.resolve(process.cwd(), 'governance'),
};

const DOCS_MANIFEST_NAME = 'docs-manifest.json';
const NL_ENTRY_MANIFEST_NAME = 'nl-entry-manifest.json';
const ABSTRACTION_MANIFEST_NAME = 'abstraction-manifest.json';
const ANALYSIS_MANIFEST_NAME = 'analysis-manifest.json';
const STATES_MANIFEST_NAMES = ['states-manifest.json', 'state-manifest.json'];

const NL_ENTRY_FILE_NAMES = {
  aliasLexicon: 'alias-lexicon.json',
  slotSchema: 'slot-schema.json',
  utterancePatterns: 'utterance-patterns.json',
  entryRules: 'entry-rules.json',
  clarificationRules: 'clarification-rules.json',
};

const ABSTRACTION_FILE_NAMES = {
  intents: 'intents.json',
  actions: 'actions.json',
  decisionTable: 'decision-table.json',
};

const ANALYSIS_FILE_NAMES = {
  elements: 'elements.json',
  states: 'states.json',
  transitions: 'transitions.json',
};

const SAFE_ACTION_WHITELIST = ['noop', 'activate-member', 'set-expanded', 'set-open', 'navigate', 'search-submit', 'download-book'];

const RISK_TAXONOMY = [
  {
    riskCode: 'submit-or-commit',
    title: 'Submit Or Commit',
    severity: 'high',
    description: 'Submitting, confirming, publishing, or otherwise committing user-visible changes requires explicit approval.',
    approvalRequired: true,
    triggers: {
      actionIds: ['submit', 'commit', 'publish', 'confirm'],
      intentTypes: ['submit', 'commit'],
      keywords: ['提交', '确认', '发布', 'commit', 'submit', 'publish', 'confirm'],
      urlPatterns: [],
    },
    defaultRecovery: 'ask-approval',
    examples: ['提交表单', '确认发布', 'commit changes'],
  },
  {
    riskCode: 'destructive',
    title: 'Destructive',
    severity: 'critical',
    description: 'Deleting, removing, clearing, or otherwise destructive actions require approval.',
    approvalRequired: true,
    triggers: {
      actionIds: ['delete', 'remove', 'clear', 'destroy'],
      intentTypes: ['delete', 'remove'],
      keywords: ['删除', '移除', '清空', '销毁', 'delete', 'remove', 'clear', 'destroy'],
      urlPatterns: [],
    },
    defaultRecovery: 'ask-approval',
    examples: ['删除记录', 'remove item', 'clear cart'],
  },
  {
    riskCode: 'financial',
    title: 'Financial',
    severity: 'critical',
    description: 'Purchasing, paying, ordering, or any financial transaction requires approval.',
    approvalRequired: true,
    triggers: {
      actionIds: ['buy', 'purchase', 'pay', 'checkout', 'order'],
      intentTypes: ['purchase', 'payment'],
      keywords: ['购买', '支付', '付款', '结算', '下单', 'buy', 'purchase', 'pay', 'checkout', 'order'],
      urlPatterns: [],
    },
    defaultRecovery: 'ask-approval',
    examples: ['购买商品', 'pay now', 'checkout'],
  },
  {
    riskCode: 'upload',
    title: 'Upload',
    severity: 'high',
    description: 'Uploading or importing user content requires approval.',
    approvalRequired: true,
    triggers: {
      actionIds: ['upload', 'import', 'attach'],
      intentTypes: ['upload', 'import'],
      keywords: ['上传', '导入', '附件', 'upload', 'import', 'attach'],
      urlPatterns: [],
    },
    defaultRecovery: 'ask-approval',
    examples: ['上传文件', 'import data'],
  },
  {
    riskCode: 'auth-change',
    title: 'Auth Change',
    severity: 'high',
    description: 'Logging in, logging out, authorizing, or changing identity context requires approval.',
    approvalRequired: true,
    triggers: {
      actionIds: ['login', 'logout', 'authorize', 'grant'],
      intentTypes: ['auth', 'login'],
      keywords: ['登录', '退出', '授权', '连接账户', 'login', 'logout', 'authorize', 'sign in', 'sign out'],
      urlPatterns: [],
    },
    defaultRecovery: 'ask-approval',
    examples: ['登录账号', 'authorize app', 'sign out'],
  },
  {
    riskCode: 'unverified-navigation',
    title: 'Unverified Navigation',
    severity: 'high',
    description: 'Navigating outside the observed URL family requires approval.',
    approvalRequired: true,
    triggers: {
      actionIds: [],
      intentTypes: [],
      keywords: [],
      urlPatterns: ['cross-origin', 'outside-observed-url-family'],
    },
    defaultRecovery: 'reject',
    examples: ['跳到未验证页面', 'navigate outside observed state space'],
  },
  {
    riskCode: 'unknown-side-effect',
    title: 'Unknown Side Effect',
    severity: 'high',
    description: 'Any action outside the safe whitelist is treated as side-effectful and requires approval.',
    approvalRequired: true,
    triggers: {
      actionIds: [],
      intentTypes: [],
      keywords: [],
      urlPatterns: [],
    },
    defaultRecovery: 'ask-approval',
    examples: ['new unclassified action', 'future side-effect action'],
  },
];

function normalizeWhitespace(value) {
  return String(value ?? '').replace(/\s+/gu, ' ').trim();
}

function normalizeText(value) {
  return normalizeWhitespace(String(value ?? '').normalize('NFKC'));
}

function cleanText(value) {
  return normalizeText(value)
    .replace(/^[\s"'“”‘’`~!@#$%^&*()\-_=+\[\]{}\\|;:,.<>/?！？。，“”‘’【】（）《》]+/gu, '')
    .replace(/[\s"'“”‘’`~!@#$%^&*()\-_=+\[\]{}\\|;:,.<>/?！？。，“”‘’【】（）《》]+$/gu, '')
    .trim();
}

function normalizeAlias(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[，。！？、；：,.!?;:()[\]{}<>《》【】“”‘’"'`~]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
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

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function compareNullableStrings(left, right) {
  return String(left ?? '').localeCompare(String(right ?? ''), 'en');
}

function uniqueSortedStrings(values) {
  return [...new Set(
    toArray(values)
      .filter((value) => value !== undefined && value !== null)
      .map((value) => String(value))
      .filter(Boolean),
  )].sort(compareNullableStrings);
}

function uniqueSortedPaths(values) {
  return [...new Set(
    toArray(values)
      .filter(Boolean)
      .map((value) => path.resolve(String(value))),
  )].sort(compareNullableStrings);
}

function formatTimestampForDir(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.(\d{3})Z$/, '$1Z');
}

function sanitizeHost(host) {
  return (host || 'unknown-host').replace(/[^a-zA-Z0-9.-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'unknown-host';
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

function buildWarning(code, message, details = {}) {
  return {
    code,
    message,
    ...details,
  };
}

function mergeOptions(options) {
  return {
    ...DEFAULT_OPTIONS,
    ...options,
    outDir: path.resolve(options.outDir ?? DEFAULT_OPTIONS.outDir),
  };
}

async function resolveDocsInput(options) {
  const { manifestPath: docsManifestPath, dir: docsDir } = await resolveStageInput(options, {
    manifestOption: 'docsManifestPath',
    dirOption: 'docsDir',
    manifestName: DOCS_MANIFEST_NAME,
    missingArgsMessage: 'Pass docsManifestPath, --docs-manifest, docsDir, or --docs-dir.',
    missingManifestMessagePrefix: 'Docs manifest not found: ',
    missingDirMessagePrefix: 'Docs directory not found: ',
  });
  return {
    docsManifestPath,
    docsDir,
  };
}

async function loadDocContents(documents, docsDir, warnings) {
  const records = [];
  for (const document of documents) {
    const docPath = resolveMaybeRelative(document.path, docsDir);
    const exists = await pathExists(docPath);
    let content = null;
    if (exists && /\.md$/i.test(docPath)) {
      content = await readFile(docPath, 'utf8');
    } else if (!exists) {
      warnings.push(buildWarning('doc_missing', `Document file not found: ${docPath}`, { docId: document.docId, path: docPath }));
    }
    records.push({
      ...document,
      path: docPath,
      content,
    });
  }
  return records;
}

async function loadSupplementalFlowDocs(docsDir, existingDocs) {
  const existingPaths = new Set(existingDocs.map((doc) => path.resolve(doc.path)));
  const result = [];

  for (const folderName of ['flows', 'intents']) {
    const dirPath = path.join(docsDir, folderName);
    if (!(await pathExists(dirPath))) {
      continue;
    }
    const names = await readdir(dirPath);
    for (const name of names) {
      if (!/\.md$/i.test(name)) {
        continue;
      }
      const docPath = path.resolve(dirPath, name);
      if (existingPaths.has(docPath)) {
        continue;
      }
      result.push({
        docId: `doc_${folderName}_${name.replace(/\.md$/i, '')}`,
        type: 'intent',
        title: name.replace(/\.md$/i, ''),
        path: docPath,
        intentId: null,
        relatedStateIds: [],
        evidenceRefs: [],
        content: await readFile(docPath, 'utf8'),
      });
      existingPaths.add(docPath);
    }
  }

  return result.sort((left, right) => compareNullableStrings(left.path, right.path));
}

async function resolveStateManifest(expandedStatesDir, warnings) {
  if (!expandedStatesDir || !(await pathExists(expandedStatesDir))) {
    return {
      expandedStatesDir: null,
      statesManifestPath: null,
      statesManifest: null,
    };
  }

  const candidatePath = await resolveNamedManifest(expandedStatesDir, STATES_MANIFEST_NAMES);
  if (candidatePath) {
    return {
      expandedStatesDir,
      statesManifestPath: candidatePath,
      statesManifest: await readJsonFile(candidatePath),
    };
  }

  warnings.push(buildWarning('states_manifest_missing', `No second-step state manifest found under ${expandedStatesDir}`));
  return {
    expandedStatesDir,
    statesManifestPath: null,
    statesManifest: null,
  };
}

async function loadArtifacts(inputUrl, options) {
  const warnings = [];
  const { docsManifestPath, docsDir } = await resolveDocsInput(options);
  const docsManifest = await loadOptionalManifest(docsManifestPath);
  if (!docsManifest) {
    throw new Error(`Missing ${DOCS_MANIFEST_NAME} under ${docsDir}`);
  }

  const docs = await loadDocContents(toArray(docsManifest.documents), docsDir, warnings);
  const supplementalDocs = await loadSupplementalFlowDocs(docsDir, docs);
  docs.push(...supplementalDocs);

  const nlEntryDir = path.resolve(options.nlEntryDir ?? getManifestArtifactDir(docsManifest, 'nlEntry', docsDir) ?? docsDir);
  if (!(await pathExists(nlEntryDir))) {
    throw new Error(`NL entry directory not found: ${nlEntryDir}`);
  }
  const nlEntryManifestPath = await resolveLinkedArtifactManifest({
    manifest: docsManifest,
    artifactName: 'nlEntry',
    baseDir: docsDir,
    artifactDir: nlEntryDir,
    manifestName: NL_ENTRY_MANIFEST_NAME,
  });
  const nlEntryManifest = await loadOptionalManifest(nlEntryManifestPath);
  if (!nlEntryManifest) {
    throw new Error(`Missing ${NL_ENTRY_MANIFEST_NAME} under ${nlEntryDir}`);
  }

  const nlEntryFiles = await resolveStageFiles({
    manifest: nlEntryManifest,
    manifestDir: nlEntryDir,
    dir: nlEntryDir,
    files: {
      aliasLexiconPath: { manifestField: 'aliasLexicon', defaultFileName: NL_ENTRY_FILE_NAMES.aliasLexicon },
      slotSchemaPath: { manifestField: 'slotSchema', defaultFileName: NL_ENTRY_FILE_NAMES.slotSchema },
      utterancePatternsPath: { manifestField: 'utterancePatterns', defaultFileName: NL_ENTRY_FILE_NAMES.utterancePatterns },
      entryRulesPath: { manifestField: 'entryRules', defaultFileName: NL_ENTRY_FILE_NAMES.entryRules },
      clarificationRulesPath: { manifestField: 'clarificationRules', defaultFileName: NL_ENTRY_FILE_NAMES.clarificationRules },
    },
  });
  if (!nlEntryFiles.aliasLexiconPath || !nlEntryFiles.slotSchemaPath || !nlEntryFiles.utterancePatternsPath || !nlEntryFiles.entryRulesPath || !nlEntryFiles.clarificationRulesPath) {
    throw new Error(`Fifth-step input is incomplete under ${nlEntryDir}`);
  }

  const abstractionDir = path.resolve(options.abstractionDir ?? getManifestArtifactDir(docsManifest, 'abstraction', docsDir) ?? nlEntryDir);
  if (!(await pathExists(abstractionDir))) {
    throw new Error(`Abstraction directory not found: ${abstractionDir}`);
  }
  const abstractionManifestPath = await resolveLinkedArtifactManifest({
    manifest: docsManifest,
    artifactName: 'abstraction',
    baseDir: docsDir,
    artifactDir: abstractionDir,
    manifestName: ABSTRACTION_MANIFEST_NAME,
  });
  const abstractionManifest = await loadOptionalManifest(abstractionManifestPath);
  if (!abstractionManifest) {
    throw new Error(`Missing ${ABSTRACTION_MANIFEST_NAME} under ${abstractionDir}`);
  }

  const abstractionFiles = await resolveStageFiles({
    manifest: abstractionManifest,
    manifestDir: abstractionDir,
    dir: abstractionDir,
    files: {
      intentsPath: { manifestField: 'intents', defaultFileName: ABSTRACTION_FILE_NAMES.intents },
      actionsPath: { manifestField: 'actions', defaultFileName: ABSTRACTION_FILE_NAMES.actions },
      decisionTablePath: { manifestField: 'decisionTable', defaultFileName: ABSTRACTION_FILE_NAMES.decisionTable },
    },
  });
  if (!abstractionFiles.intentsPath || !abstractionFiles.actionsPath || !abstractionFiles.decisionTablePath) {
    throw new Error(`Fourth-step input is incomplete under ${abstractionDir}`);
  }

  const analysisDir = path.resolve(options.analysisDir ?? getManifestArtifactDir(docsManifest, 'analysis', docsDir) ?? abstractionDir);
  if (!(await pathExists(analysisDir))) {
    throw new Error(`Analysis directory not found: ${analysisDir}`);
  }
  const analysisManifestPath = await resolveLinkedArtifactManifest({
    manifest: docsManifest,
    artifactName: 'analysis',
    baseDir: docsDir,
    artifactDir: analysisDir,
    manifestName: ANALYSIS_MANIFEST_NAME,
  });
  const analysisManifest = await loadOptionalManifest(analysisManifestPath);
  if (!analysisManifest) {
    throw new Error(`Missing ${ANALYSIS_MANIFEST_NAME} under ${analysisDir}`);
  }

  const analysisFiles = await resolveStageFiles({
    manifest: analysisManifest,
    manifestDir: analysisDir,
    dir: analysisDir,
    files: {
      elementsPath: { manifestField: 'elements', defaultFileName: ANALYSIS_FILE_NAMES.elements },
      statesPath: { manifestField: 'states', defaultFileName: ANALYSIS_FILE_NAMES.states },
      transitionsPath: { manifestField: 'transitions', defaultFileName: ANALYSIS_FILE_NAMES.transitions },
    },
  });
  if (!analysisFiles.elementsPath || !analysisFiles.statesPath || !analysisFiles.transitionsPath) {
    throw new Error(`Third-step input is incomplete under ${analysisDir}`);
  }

  const interactionModelPath = options.interactionModelPath ? path.resolve(options.interactionModelPath) : null;
  const interactionModel = interactionModelPath ? await readJsonFile(interactionModelPath) : null;

  const stateManifestArtifacts = await resolveStateManifest(
    options.expandedStatesDir
      ? path.resolve(options.expandedStatesDir)
      : getManifestArtifactDir(docsManifest, 'expandedStates', docsDir),
    warnings,
  );

  const docsRun = getManifestRunContext(docsManifest);
  const nlEntryRun = getManifestRunContext(nlEntryManifest);
  const abstractionRun = getManifestRunContext(abstractionManifest);
  const analysisRun = getManifestRunContext(analysisManifest);

  return {
    inputUrl,
    baseUrl: normalizeUrlNoFragment(firstNonEmpty([docsRun.baseUrl, nlEntryRun.baseUrl, abstractionRun.baseUrl, analysisRun.baseUrl, inputUrl])) ?? inputUrl,
    docsDir,
    docsManifestPath,
    docsManifest,
    docs,
    nlEntryDir,
    nlEntryManifestPath,
    nlEntryManifest,
    aliasLexiconPath: nlEntryFiles.aliasLexiconPath,
    slotSchemaPath: nlEntryFiles.slotSchemaPath,
    utterancePatternsPath: nlEntryFiles.utterancePatternsPath,
    entryRulesPath: nlEntryFiles.entryRulesPath,
    clarificationRulesPath: nlEntryFiles.clarificationRulesPath,
    aliasLexiconDocument: await readJsonFile(nlEntryFiles.aliasLexiconPath),
    slotSchemaDocument: await readJsonFile(nlEntryFiles.slotSchemaPath),
    utterancePatternsDocument: await readJsonFile(nlEntryFiles.utterancePatternsPath),
    entryRulesDocument: await readJsonFile(nlEntryFiles.entryRulesPath),
    clarificationRulesDocument: await readJsonFile(nlEntryFiles.clarificationRulesPath),
    abstractionDir,
    abstractionManifestPath,
    abstractionManifest,
    intentsPath: abstractionFiles.intentsPath,
    actionsPath: abstractionFiles.actionsPath,
    decisionTablePath: abstractionFiles.decisionTablePath,
    intentsDocument: await readJsonFile(abstractionFiles.intentsPath),
    actionsDocument: await readJsonFile(abstractionFiles.actionsPath),
    decisionTableDocument: await readJsonFile(abstractionFiles.decisionTablePath),
    analysisDir,
    analysisManifestPath,
    analysisManifest,
    elementsPath: analysisFiles.elementsPath,
    statesPath: analysisFiles.statesPath,
    transitionsPath: analysisFiles.transitionsPath,
    elementsDocument: await readJsonFile(analysisFiles.elementsPath),
    statesDocument: await readJsonFile(analysisFiles.statesPath),
    transitionsDocument: await readJsonFile(analysisFiles.transitionsPath),
    interactionModelPath,
    interactionModel,
    ...stateManifestArtifacts,
    warnings,
  };
}

function normalizeInteractionModel(artifacts) {
  const model = artifacts.interactionModel ?? {};
  const docs = artifacts.docs;
  return {
    inputUrl: artifacts.inputUrl,
    baseUrl: artifacts.baseUrl,
    intents: toArray(model.intents ?? artifacts.intentsDocument?.intents),
    actions: toArray(model.actions ?? artifacts.actionsDocument?.actions),
    decisionRules: toArray(model.decisionRules ?? model.rules ?? artifacts.decisionTableDocument?.rules),
    states: toArray(model.states ?? artifacts.statesDocument?.states),
    edges: toArray(model.edges ?? model.transitions ?? artifacts.transitionsDocument?.edges),
    entryRules: toArray(model.entryRules ?? artifacts.entryRulesDocument?.rules),
    clarificationRules: toArray(model.clarificationRules ?? artifacts.clarificationRulesDocument?.rules),
    patterns: toArray(model.utterancePatterns ?? model.patterns ?? artifacts.utterancePatternsDocument?.patterns),
    lexiconEntries: toArray(model.aliasLexicon ?? model.lexiconEntries ?? artifacts.aliasLexiconDocument?.entries),
    elements: toArray(model.elements ?? artifacts.elementsDocument?.elements),
    docs,
  };
}

function buildIndices(model) {
  const intentsById = new Map();
  const actionsById = new Map();
  const decisionRulesById = new Map();
  const decisionRulesByIntentId = new Map();
  const statesById = new Map();
  const elementsById = new Map();
  const membersById = new Map();
  const entryRulesById = new Map();
  const entryRulesByIntentId = new Map();
  const patternsById = new Map();
  const patternsByIntentId = new Map();
  const docsById = new Map();
  const docsByIntentId = new Map();
  const edgesById = new Map();
  const edgesByToState = new Map();
  const elementStateByStateId = new Map();

  for (const intent of model.intents) {
    intentsById.set(intent.intentId, intent);
  }
  for (const action of model.actions) {
    actionsById.set(action.actionId, action);
  }
  for (const rule of model.decisionRules) {
    decisionRulesById.set(rule.ruleId, rule);
    const bucket = decisionRulesByIntentId.get(rule.intentId) ?? [];
    bucket.push(rule);
    decisionRulesByIntentId.set(rule.intentId, bucket);
  }
  for (const state of model.states) {
    statesById.set(state.stateId, state);
    const elementBucket = new Map();
    for (const elementState of toArray(state.elementStates)) {
      elementBucket.set(elementState.elementId, elementState);
    }
    elementStateByStateId.set(state.stateId, elementBucket);
  }
  for (const element of model.elements) {
    elementsById.set(element.elementId, element);
    for (const member of toArray(element.members)) {
      membersById.set(member.memberId, member);
    }
  }
  for (const entryRule of model.entryRules) {
    entryRulesById.set(entryRule.entryRuleId, entryRule);
    const bucket = entryRulesByIntentId.get(entryRule.intentId) ?? [];
    bucket.push(entryRule);
    entryRulesByIntentId.set(entryRule.intentId, bucket);
  }
  for (const pattern of model.patterns) {
    patternsById.set(pattern.patternId, pattern);
    const bucket = patternsByIntentId.get(pattern.intentId) ?? [];
    bucket.push(pattern);
    patternsByIntentId.set(pattern.intentId, bucket);
  }
  for (const doc of model.docs) {
    docsById.set(doc.docId, doc);
    if (doc.intentId) {
      const bucket = docsByIntentId.get(doc.intentId) ?? [];
      bucket.push(doc);
      docsByIntentId.set(doc.intentId, bucket);
    }
  }
  for (const edge of model.edges) {
    edgesById.set(edge.edgeId, edge);
    if (edge.toState) {
      const bucket = edgesByToState.get(edge.toState) ?? [];
      bucket.push(edge);
      edgesByToState.set(edge.toState, bucket);
    }
  }

  return {
    intentsById,
    actionsById,
    decisionRulesById,
    decisionRulesByIntentId,
    statesById,
    elementsById,
    membersById,
    entryRulesById,
    entryRulesByIntentId,
    patternsById,
    patternsByIntentId,
    docsById,
    docsByIntentId,
    edgesById,
    edgesByToState,
    elementStateByStateId,
  };
}

function buildObservedUrlFamily(model) {
  const urls = [...new Set(model.states.map((state) => normalizeUrlNoFragment(state.finalUrl)).filter(Boolean))].sort(compareNullableStrings);
  const origins = [...new Set(urls.map((urlValue) => {
    try {
      return new URL(urlValue).origin;
    } catch {
      return null;
    }
  }).filter(Boolean))].sort(compareNullableStrings);
  const pathPrefixes = [...new Set(urls.map((urlValue) => {
    try {
      const parsed = new URL(urlValue);
      const segments = parsed.pathname.split('/').filter(Boolean);
      if (segments.length === 0) {
        return '/';
      }
      return `/${segments.slice(0, Math.min(2, segments.length)).join('/')}`;
    } catch {
      return null;
    }
  }).filter(Boolean))].sort(compareNullableStrings);
  return {
    sameOriginRequired: true,
    origins,
    urls,
    pathPrefixes,
  };
}

function collectObservedActionIds(model) {
  const ids = new Set();
  for (const rule of model.decisionRules) {
    if (rule.phase === 'act' && rule.then?.actionId) {
      ids.add(rule.then.actionId);
    }
  }
  return [...ids].sort(compareNullableStrings);
}

function collectTextCorpus(model) {
  const items = [];
  for (const intent of model.intents) {
    items.push(intent.intentName, intent.intentType, intent.sourceElementName);
  }
  for (const action of model.actions) {
    items.push(action.actionId, action.actionName);
  }
  for (const entry of model.lexiconEntries) {
    items.push(entry.canonical);
    for (const alias of toArray(entry.aliases)) {
      items.push(alias.text);
    }
  }
  for (const pattern of model.patterns) {
    items.push(pattern.regex);
    for (const example of toArray(pattern.examples)) {
      items.push(example);
    }
  }
  for (const rule of model.entryRules) {
    items.push(rule.outcome?.planTemplate?.note);
  }
  for (const doc of model.docs) {
    items.push(doc.title, doc.content);
  }
  return items.map((item) => String(item ?? '')).filter(Boolean);
}

function matchesAnyKeyword(text, keywords) {
  const normalized = normalizeAlias(text);
  return keywords.some((keyword) => normalized.includes(normalizeAlias(keyword)));
}

function detectRiskHits(risk, model, indices, observedUrlFamily) {
  const textCorpus = collectTextCorpus(model);
  const entryRuleHits = [];
  const patternHits = [];
  const docHits = [];
  const extraStateIds = [];
  const extraEdgeIds = [];

  for (const entryRule of model.entryRules) {
    const serialized = JSON.stringify(entryRule);
    if (matchesAnyKeyword(serialized, risk.triggers.keywords)) {
      entryRuleHits.push(entryRule.entryRuleId);
    }
  }
  for (const pattern of model.patterns) {
    const serialized = `${pattern.regex} ${toArray(pattern.examples).join(' ')}`;
    if (matchesAnyKeyword(serialized, risk.triggers.keywords)) {
      patternHits.push(pattern.patternId);
    }
  }
  for (const doc of model.docs) {
    const serialized = `${doc.title ?? ''}\n${doc.content ?? ''}`;
    if (matchesAnyKeyword(serialized, risk.triggers.keywords)) {
      docHits.push(doc.docId);
    }
  }

  const actionHits = model.actions
    .filter((action) => risk.triggers.actionIds.some((keyword) => normalizeAlias(action.actionId).includes(normalizeAlias(keyword)) || normalizeAlias(action.actionName).includes(normalizeAlias(keyword))))
    .map((action) => action.actionId);

  const intentHits = model.intents
    .filter((intent) => risk.triggers.intentTypes.some((keyword) => normalizeAlias(intent.intentType).includes(normalizeAlias(keyword)) || normalizeAlias(intent.intentName).includes(normalizeAlias(keyword))))
    .map((intent) => intent.intentId);

  if (risk.riskCode === 'unknown-side-effect') {
    for (const actionId of collectObservedActionIds(model)) {
      if (!SAFE_ACTION_WHITELIST.includes(actionId)) {
        actionHits.push(actionId);
      }
    }
    for (const rule of model.decisionRules) {
      if (rule.phase === 'act' && rule.then?.actionId && !SAFE_ACTION_WHITELIST.includes(rule.then.actionId)) {
        extraStateIds.push(...toArray(rule.evidence?.stateIds));
        extraEdgeIds.push(...toArray(rule.expected?.edgeIds), ...toArray(rule.evidence?.edgeIds));
      }
    }
  }

  const escapedEdges = risk.riskCode === 'unverified-navigation'
    ? model.edges.filter((edge) => {
      const normalized = normalizeUrlNoFragment(edge.finalUrl);
      return normalized && !observedUrlFamily.urls.includes(normalized);
    })
    : [];
  const hasObservedUrlEscape = escapedEdges.length > 0;
  if (risk.riskCode === 'unverified-navigation') {
    extraEdgeIds.push(...escapedEdges.map((edge) => edge.edgeId));
    extraStateIds.push(...escapedEdges.flatMap((edge) => [edge.fromState, edge.toState]));
  }

  const stateIds = [...new Set([
    ...intentHits.flatMap((intentId) => toArray(indices.intentsById.get(intentId)?.evidence?.stateIds)),
    ...docHits.flatMap((docId) => toArray(indices.docsById.get(docId)?.relatedStateIds)),
    ...extraStateIds,
  ])].sort(compareNullableStrings);
  const edgeIds = [...new Set([
    ...intentHits.flatMap((intentId) => toArray(indices.intentsById.get(intentId)?.evidence?.edgeIds)),
    ...stateIds.flatMap((stateId) => toArray(indices.edgesByToState.get(stateId)).map((edge) => edge.edgeId)),
    ...extraEdgeIds,
  ])].sort(compareNullableStrings);

  return {
    actionIds: [...new Set(actionHits)].sort(compareNullableStrings),
    intentIds: [...new Set(intentHits)].sort(compareNullableStrings),
    entryRuleIds: [...new Set(entryRuleHits)].sort(compareNullableStrings),
    patternIds: [...new Set(patternHits)].sort(compareNullableStrings),
    docIds: [...new Set(docHits)].sort(compareNullableStrings),
    stateIds,
    edgeIds,
    observedTextHit: textCorpus.some((text) => matchesAnyKeyword(text, risk.triggers.keywords)),
    hasObservedUrlEscape,
  };
}

function buildRiskTaxonomyDocument(inputUrl, baseUrl, generatedAt, observedUrlFamily) {
  return {
    inputUrl,
    baseUrl,
    generatedAt,
    policyMode: 'conservative-high-risk',
    categories: RISK_TAXONOMY.map((risk) => ({
      ...risk,
      triggers: {
        ...risk.triggers,
        urlPatterns: risk.riskCode === 'unverified-navigation'
          ? [{ type: 'observed-url-family', value: observedUrlFamily }]
          : risk.triggers.urlPatterns,
      },
    })),
  };
}

function buildApprovalRulesDocument(inputUrl, baseUrl, generatedAt, model, indices, observedUrlFamily, riskTaxonomyDocument) {
  const rules = riskTaxonomyDocument.categories.map((risk) => {
    const hits = detectRiskHits(risk, model, indices, observedUrlFamily);
    const detectAny = [];

    if (risk.riskCode === 'unknown-side-effect') {
      detectAny.push({
        field: 'actionId',
        op: 'not_in_set',
        value: SAFE_ACTION_WHITELIST,
      });
    } else if (risk.riskCode === 'unverified-navigation') {
      detectAny.push({
        field: 'finalUrl',
        op: 'not_in_family',
        value: observedUrlFamily,
      });
    } else {
      if (risk.triggers.keywords.length > 0) {
        detectAny.push({
          field: 'utteranceText',
          op: 'regex',
          value: risk.triggers.keywords.join('|'),
        });
        detectAny.push({
          field: 'targetLabel',
          op: 'regex',
          value: risk.triggers.keywords.join('|'),
        });
      }
      if (risk.triggers.actionIds.length > 0) {
        detectAny.push({
          field: 'actionId',
          op: 'in',
          value: risk.triggers.actionIds,
        });
      }
      if (risk.triggers.intentTypes.length > 0) {
        detectAny.push({
          field: 'intentType',
          op: 'in',
          value: risk.triggers.intentTypes,
        });
      }
    }

    return {
      approvalRuleId: `approval_${risk.riskCode}`,
      riskCode: risk.riskCode,
      appliesTo: {
        actionIds: hits.actionIds,
        intentIds: hits.intentIds,
        entryRuleIds: hits.entryRuleIds,
        patternIds: hits.patternIds,
        docIds: hits.docIds,
      },
      detect: {
        any: detectAny,
      },
      approval: {
        required: true,
        checkpointLabel: `${risk.title} Approval`,
        rationale: risk.description,
        approver: 'human',
        denyByDefault: true,
        allowWhen: 'explicit-human-approval',
      },
      evidence: {
        stateIds: uniqueSortedStrings(hits.stateIds),
        edgeIds: uniqueSortedStrings(hits.edgeIds),
        docPaths: uniqueSortedPaths(hits.docIds.map((docId) => indices.docsById.get(docId)?.path).filter(Boolean)),
      },
    };
  }).sort((left, right) => compareNullableStrings(left.riskCode, right.riskCode));

  return {
    inputUrl,
    baseUrl,
    generatedAt,
    rules,
  };
}

function buildClarificationRecoveryRule(clarificationRule, model) {
  const stateIds = uniqueSortedStrings(model.states.map((state) => state.stateId));
  const edgeIds = uniqueSortedStrings(model.edges.map((edge) => edge.edgeId));
  const docPaths = uniqueSortedPaths(model.docs.filter((doc) => doc.intentId).map((doc) => doc.path));
  const mapping = {
    'missing-slot': {
      severity: 'low',
      strategy: 'clarify-slot',
      retryable: false,
      maxRetries: 0,
      requiresApproval: false,
    },
    'ambiguous-target': {
      severity: 'low',
      strategy: 'clarify-target',
      retryable: false,
      maxRetries: 0,
      requiresApproval: false,
    },
    'unsupported-target': {
      severity: 'medium',
      strategy: 'fall-back-to-safe-targets',
      retryable: false,
      maxRetries: 0,
      requiresApproval: false,
    },
    'already-satisfied': {
      severity: 'low',
      strategy: 'noop-return',
      retryable: false,
      maxRetries: 0,
      requiresApproval: false,
    },
    'unknown-intent': {
      severity: 'medium',
      strategy: 'reject',
      retryable: false,
      maxRetries: 0,
      requiresApproval: false,
    },
    'out-of-domain': {
      severity: 'high',
      strategy: 'reject',
      retryable: false,
      maxRetries: 0,
      requiresApproval: false,
    },
  };
  const config = mapping[clarificationRule.case];
  if (!config) {
    return null;
  }
  return {
    recoveryRuleId: `recovery_${clarificationRule.case}`,
    exceptionType: clarificationRule.case,
    severity: config.severity,
    detect: {
      any: [
        {
          field: 'resolution.status',
          op: 'eq',
          value: clarificationRule.case,
        },
      ],
    },
    recover: {
      strategy: config.strategy,
      steps: [
        clarificationRule.response?.questionTemplate ?? 'Follow clarification policy.',
        `Resume with ${clarificationRule.recovery?.resumeMode ?? 're-run-entry-rules'}.`,
      ],
      retryable: config.retryable,
      maxRetries: config.maxRetries,
      requiresApproval: config.requiresApproval,
      fallbackIntentIds: uniqueSortedStrings(model.intents.map((intent) => intent.intentId)),
      fallbackStateIds: stateIds,
    },
    successCriteria: {
      stateField: clarificationRule.case === 'already-satisfied' ? 'currentElementState' : 'resolution.status',
      expectedValues: clarificationRule.case === 'already-satisfied' ? ['already-satisfied', 'noop'] : ['resolved'],
      stateIds,
      urlFamily: buildObservedUrlFamily(model),
    },
    evidence: {
      stateIds,
      edgeIds,
      docPaths,
    },
  };
}

function buildRecoveryRulesDocument(inputUrl, baseUrl, generatedAt, model, approvalRulesDocument, observedUrlFamily) {
  const stateIds = uniqueSortedStrings(model.states.map((state) => state.stateId));
  const edgeIds = uniqueSortedStrings(model.edges.map((edge) => edge.edgeId));
  const toStateIds = uniqueSortedStrings(model.edges.map((edge) => edge.toState).filter(Boolean));
  const intentIds = uniqueSortedStrings(model.intents.map((intent) => intent.intentId));
  const docPaths = uniqueSortedPaths(model.docs.filter((doc) => doc.intentId).map((doc) => doc.path));
  const titles = uniqueSortedStrings(model.states.map((state) => state.title));
  const finalUrls = uniqueSortedStrings(model.states.map((state) => normalizeUrlNoFragment(state.finalUrl)).filter(Boolean));
  const rules = [];
  for (const clarificationRule of model.clarificationRules) {
    const mapped = buildClarificationRecoveryRule(clarificationRule, model);
    if (mapped) {
      rules.push(mapped);
    }
  }

  rules.push({
    recoveryRuleId: 'recovery_stale-state',
    exceptionType: 'stale-state',
    severity: 'medium',
    detect: {
      any: [
        { field: 'currentStateId', op: 'unmatched', value: stateIds },
        { field: 'currentElementState', op: 'not_in_set', value: stateIds },
      ],
    },
    recover: {
      strategy: 're-anchor-state',
      steps: [
        'Compare currentElementState against analyzed concrete states.',
        'Re-anchor to the nearest matching analyzed state within the observed URL family.',
        'If no direct match exists, fall back to the base URL and re-evaluate intent rules.',
      ],
      retryable: true,
      maxRetries: 1,
      requiresApproval: false,
      fallbackIntentIds: intentIds,
      fallbackStateIds: stateIds,
    },
    successCriteria: {
      stateField: 'currentStateId',
      expectedValues: stateIds,
      stateIds,
      urlFamily: observedUrlFamily,
    },
    evidence: {
      stateIds,
      edgeIds,
      docPaths,
    },
  });

  rules.push({
    recoveryRuleId: 'recovery_evidence-mismatch',
    exceptionType: 'evidence-mismatch',
    severity: 'medium',
    detect: {
      any: [
        { field: 'finalUrl', op: 'not_in_set', value: finalUrls },
        { field: 'title', op: 'unmatched', value: titles },
        { field: 'currentElementState', op: 'neq', value: 'decision-rule.expected' },
      ],
    },
    recover: {
      strategy: 'retry-once',
      steps: [
        'Re-check the expected decision rule and target state.',
        'Retry the same action once if the mismatch is transient.',
        'If the mismatch persists, fall back to re-anchor-state.',
      ],
      retryable: true,
      maxRetries: 1,
      requiresApproval: false,
      fallbackIntentIds: intentIds,
      fallbackStateIds: stateIds,
    },
    successCriteria: {
      stateField: 'currentElementState',
      expectedValues: ['decision-rule.expected'],
      stateIds,
      urlFamily: observedUrlFamily,
    },
    evidence: {
      stateIds,
      edgeIds,
      docPaths,
    },
  });

  rules.push({
    recoveryRuleId: 'recovery_transition-failed',
    exceptionType: 'transition-failed',
    severity: 'high',
    detect: {
      any: [
        { field: 'actionOutcome', op: 'eq', value: 'failed' },
        { field: 'toStateId', op: 'not_in_set', value: toStateIds },
      ],
    },
    recover: {
      strategy: 're-anchor-state',
      steps: [
        'Stop automatic progression after the failed act rule.',
        'Re-anchor the runtime state to the nearest analyzed state.',
        'Offer a safe actionable target set before retrying.',
      ],
      retryable: true,
      maxRetries: 1,
      requiresApproval: false,
      fallbackIntentIds: intentIds,
      fallbackStateIds: stateIds,
    },
    successCriteria: {
      stateField: 'toStateId',
      expectedValues: toStateIds,
      stateIds,
      urlFamily: observedUrlFamily,
    },
    evidence: {
      stateIds,
      edgeIds,
      docPaths,
    },
  });

  rules.push({
    recoveryRuleId: 'recovery_approval-required',
    exceptionType: 'approval-required',
    severity: 'high',
    detect: {
      any: approvalRulesDocument.rules.map((rule) => ({
        field: 'approvalRuleId',
        op: 'eq',
        value: rule.approvalRuleId,
      })),
    },
    recover: {
      strategy: 'ask-approval',
      steps: [
        'Pause automation before executing the risky step.',
        'Present the matching approval checkpoint and rationale.',
        'Resume only after explicit human approval.',
      ],
      retryable: false,
      maxRetries: 0,
      requiresApproval: true,
      fallbackIntentIds: [],
      fallbackStateIds: stateIds,
    },
    successCriteria: {
      stateField: 'approval.status',
      expectedValues: ['approved'],
      stateIds,
      urlFamily: observedUrlFamily,
    },
    evidence: {
      stateIds: uniqueSortedStrings(approvalRulesDocument.rules.flatMap((rule) => rule.evidence.stateIds)),
      edgeIds: uniqueSortedStrings(approvalRulesDocument.rules.flatMap((rule) => rule.evidence.edgeIds)),
      docPaths: uniqueSortedPaths(approvalRulesDocument.rules.flatMap((rule) => rule.evidence.docPaths)),
    },
  });

  return {
    inputUrl,
    baseUrl,
    generatedAt,
    rules: rules.sort((left, right) => compareNullableStrings(left.exceptionType, right.exceptionType)),
  };
}

function toPosixPath(value) {
  return String(value ?? '').split(path.sep).join('/');
}

function relativeDocPath(fromDir, targetPath) {
  return toPosixPath(path.relative(fromDir, targetPath) || path.basename(targetPath));
}

function markdownLink(label, fromDir, targetPath) {
  if (!targetPath) {
    return label;
  }
  return `[${label}](${relativeDocPath(fromDir, targetPath)})`;
}

function mdEscape(value) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, '<br>');
}

function renderTable(headers, rows) {
  if (!rows.length) {
    return '_None_';
  }
  const head = `| ${headers.join(' | ')} |`;
  const divider = `| ${headers.map(() => '---').join(' | ')} |`;
  const body = rows.map((row) => `| ${row.map((cell) => mdEscape(cell)).join(' | ')} |`);
  return [head, divider, ...body].join('\n');
}

function createOutputLayout(baseUrl, outDir) {
  const parsed = (() => {
    try {
      return new URL(baseUrl);
    } catch {
      return null;
    }
  })();
  const generatedAt = new Date().toISOString();
  const stamp = formatTimestampForDir(new Date(generatedAt));
  const host = sanitizeHost(parsed?.hostname ?? 'unknown-host');
  const finalOutDir = path.join(outDir, `${stamp}_${host}_governance`);
  return {
    generatedAt,
    outDir: finalOutDir,
    recoveryRulesPath: path.join(finalOutDir, 'recovery-rules.json'),
    approvalRulesPath: path.join(finalOutDir, 'approval-rules.json'),
    riskTaxonomyPath: path.join(finalOutDir, 'risk-taxonomy.json'),
    recoveryMarkdownPath: path.join(finalOutDir, 'recovery.md'),
    approvalMarkdownPath: path.join(finalOutDir, 'approval-checkpoints.md'),
  };
}

function renderRecoveryMarkdown(recoveryRulesDocument, fromDir) {
  const sections = ['# Recovery', ''];
  for (const rule of recoveryRulesDocument.rules) {
    sections.push(`## ${rule.exceptionType}`);
    sections.push('');
    sections.push(`- Severity: \`${rule.severity}\``);
    sections.push(`- Strategy: \`${rule.recover.strategy}\``);
    sections.push(`- Retryable: \`${rule.recover.retryable}\` (max retries: ${rule.recover.maxRetries})`);
    sections.push(`- Requires Approval: \`${rule.recover.requiresApproval}\``);
    sections.push('');
    sections.push('### 触发条件');
    sections.push('');
    sections.push(renderTable(
      ['Field', 'Op', 'Value'],
      rule.detect.any.map((condition) => [condition.field, condition.op, JSON.stringify(condition.value)]),
    ));
    sections.push('');
    sections.push('### 恢复动作');
    sections.push('');
    for (const step of toArray(rule.recover.steps)) {
      sections.push(`- ${step}`);
    }
    sections.push('');
    sections.push('### 成功判定');
    sections.push('');
    sections.push(renderTable(
      ['State Field', 'Expected Values', 'State IDs'],
      [[rule.successCriteria.stateField, toArray(rule.successCriteria.expectedValues).join(', '), toArray(rule.successCriteria.stateIds).join(', ')]],
    ));
    sections.push('');
    sections.push('### 关联状态 / 证据');
    sections.push('');
    const evidenceRows = [
      ['State IDs', toArray(rule.evidence.stateIds).join(', ') || '-'],
      ['Edge IDs', toArray(rule.evidence.edgeIds).join(', ') || '-'],
      ['Doc Paths', toArray(rule.evidence.docPaths).map((docPath) => markdownLink(path.basename(docPath), fromDir, docPath)).join(', ') || '-'],
    ];
    sections.push(renderTable(['Kind', 'Value'], evidenceRows));
    sections.push('');
  }
  return sections.join('\n');
}

function renderApprovalMarkdown(riskTaxonomyDocument, approvalRulesDocument, model, observedActionIds, fromDir) {
  const sections = ['# Approval Checkpoints', ''];
  sections.push('## Safe Action Whitelist');
  sections.push('');
  sections.push(`- Safe actions: ${SAFE_ACTION_WHITELIST.map((actionId) => `\`${actionId}\``).join(', ')}`);
  sections.push(`- Observed executable actions in current model: ${observedActionIds.length > 0 ? observedActionIds.map((actionId) => `\`${actionId}\``).join(', ') : 'none'}`);
  sections.push(`- Current page status: ${observedActionIds.every((actionId) => SAFE_ACTION_WHITELIST.includes(actionId)) ? '当前已观测模型中无必须审批的 in-domain 动作。' : '当前模型中存在需审批动作。'}`);
  sections.push('');

  for (const category of riskTaxonomyDocument.categories) {
    const rule = approvalRulesDocument.rules.find((item) => item.riskCode === category.riskCode);
    sections.push(`## ${category.title}`);
    sections.push('');
    sections.push(`- Severity: \`${category.severity}\``);
    sections.push(`- Why approval: ${category.description}`);
    sections.push(`- Default recovery: \`${category.defaultRecovery}\``);
    sections.push('');
    sections.push('### 触发点');
    sections.push('');
    sections.push(renderTable(
      ['Trigger Type', 'Values'],
      [
        ['Action IDs', toArray(category.triggers.actionIds).join(', ') || '-'],
        ['Intent Types', toArray(category.triggers.intentTypes).join(', ') || '-'],
        ['Keywords', toArray(category.triggers.keywords).join(', ') || '-'],
        ['URL Patterns', JSON.stringify(category.triggers.urlPatterns)],
      ],
    ));
    sections.push('');
    sections.push('### 命中条件');
    sections.push('');
    sections.push(renderTable(
      ['Field', 'Op', 'Value'],
      toArray(rule?.detect?.any).map((condition) => [condition.field, condition.op, JSON.stringify(condition.value)]),
    ));
    sections.push('');
    sections.push(`### 当前页面是否已有该类动作\n\n- ${toArray(rule?.appliesTo?.actionIds).length > 0 || toArray(rule?.appliesTo?.entryRuleIds).length > 0 || toArray(rule?.appliesTo?.patternIds).length > 0 ? '有潜在命中证据。' : '当前已观测模型中没有该类 in-domain 动作。'}`);
    sections.push('');
    sections.push('### 审批通过后');
    sections.push('');
    sections.push('- 仅在显式人工批准后继续执行对应动作。');
    sections.push('- 执行完成后仍需按 recovery-rules 校验 URL、状态与证据。');
    sections.push('');
    sections.push('### 审批拒绝后');
    sections.push('');
    sections.push('- 退回到安全意图集合。');
    sections.push(`- 建议回到这些文档：${toArray(rule?.evidence?.docPaths).map((docPath) => markdownLink(path.basename(docPath), fromDir, docPath)).join(', ') || '无直接文档命中，退回 README / intents 文档'}`);
    sections.push('');
  }
  return sections.join('\n');
}

function summarizeForStdout(layout, riskTaxonomyDocument, approvalRulesDocument, recoveryRulesDocument) {
  return {
    riskCategories: riskTaxonomyDocument.categories.length,
    approvalRules: approvalRulesDocument.rules.length,
    recoveryRules: recoveryRulesDocument.rules.length,
    outDir: layout.outDir,
  };
}

export async function buildGovernance(inputUrl, options = {}) {
  const settings = mergeOptions(options);
  const artifacts = await loadArtifacts(inputUrl, settings);
  const model = normalizeInteractionModel(artifacts);
  const indices = buildIndices(model);
  const observedUrlFamily = buildObservedUrlFamily(model);
  const observedActionIds = collectObservedActionIds(model);
  const layout = createOutputLayout(artifacts.baseUrl ?? inputUrl, settings.outDir);

  await ensureDir(layout.outDir);

  const riskTaxonomyDocument = buildRiskTaxonomyDocument(artifacts.inputUrl, artifacts.baseUrl, layout.generatedAt, observedUrlFamily);
  const approvalRulesDocument = buildApprovalRulesDocument(artifacts.inputUrl, artifacts.baseUrl, layout.generatedAt, model, indices, observedUrlFamily, riskTaxonomyDocument);
  const recoveryRulesDocument = buildRecoveryRulesDocument(artifacts.inputUrl, artifacts.baseUrl, layout.generatedAt, model, approvalRulesDocument, observedUrlFamily);
  const recoveryMarkdown = renderRecoveryMarkdown(recoveryRulesDocument, layout.outDir);
  const approvalMarkdown = renderApprovalMarkdown(riskTaxonomyDocument, approvalRulesDocument, model, observedActionIds, layout.outDir);

  await writeJsonFile(layout.riskTaxonomyPath, riskTaxonomyDocument);
  await writeJsonFile(layout.approvalRulesPath, approvalRulesDocument);
  await writeJsonFile(layout.recoveryRulesPath, recoveryRulesDocument);
  await writeTextFile(layout.recoveryMarkdownPath, recoveryMarkdown);
  await writeTextFile(layout.approvalMarkdownPath, approvalMarkdown);

  return {
    inputUrl: artifacts.inputUrl,
    baseUrl: artifacts.baseUrl,
    generatedAt: layout.generatedAt,
    outDir: layout.outDir,
    files: {
      riskTaxonomy: layout.riskTaxonomyPath,
      approvalRules: layout.approvalRulesPath,
      recoveryRules: layout.recoveryRulesPath,
      recovery: layout.recoveryMarkdownPath,
      approvalCheckpoints: layout.approvalMarkdownPath,
    },
    warnings: artifacts.warnings,
    summary: summarizeForStdout(layout, riskTaxonomyDocument, approvalRulesDocument, recoveryRulesDocument),
  };
}

function printHelp() {
  process.stdout.write(`Usage:
  node govern-interactions.mjs <url> --docs-manifest <path>
  node govern-interactions.mjs <url> --docs-dir <dir>

Options:
  --interaction-model <path>  Optional interaction-model.json override
  --docs-manifest <path>      Path to docs-manifest.json
  --docs-dir <dir>            Directory containing sixth-step docs outputs
  --nl-entry-dir <dir>        Optional fifth-step output directory override
  --abstraction-dir <dir>     Optional fourth-step output directory override
  --analysis-dir <dir>        Optional third-step output directory override
  --expanded-dir <dir>        Optional second-step output directory override
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
      case '--interaction-model': {
        const { value, nextIndex } = readValue(current, index);
        options.interactionModelPath = value;
        index = nextIndex;
        break;
      }
      case '--docs-manifest': {
        const { value, nextIndex } = readValue(current, index);
        options.docsManifestPath = value;
        index = nextIndex;
        break;
      }
      case '--docs-dir': {
        const { value, nextIndex } = readValue(current, index);
        options.docsDir = value;
        index = nextIndex;
        break;
      }
      case '--nl-entry-dir': {
        const { value, nextIndex } = readValue(current, index);
        options.nlEntryDir = value;
        index = nextIndex;
        break;
      }
      case '--abstraction-dir': {
        const { value, nextIndex } = readValue(current, index);
        options.abstractionDir = value;
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
    const manifest = await buildGovernance(url, options);
    process.stdout.write(`${JSON.stringify(manifest.summary, null, 2)}\n`);
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
