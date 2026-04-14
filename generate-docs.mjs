// @ts-check

import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { initializeCliUtf8 } from './lib/cli.mjs';

const DEFAULT_OPTIONS = {
  nlEntryManifestPath: undefined,
  nlEntryDir: undefined,
  abstractionDir: undefined,
  analysisDir: undefined,
  expandedStatesDir: undefined,
  outDir: path.resolve(process.cwd(), 'operation-docs'),
};

const NL_ENTRY_MANIFEST_NAME = 'nl-entry-manifest.json';
const ABSTRACTION_MANIFEST_NAME = 'abstraction-manifest.json';
const ANALYSIS_MANIFEST_NAME = 'analysis-manifest.json';
const STATES_MANIFEST_CANDIDATES = ['states-manifest.json', 'state-manifest.json'];

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

const DOC_FILE_NAMES = {
  readme: 'README.md',
  glossary: 'glossary.md',
  stateMap: 'state-map.md',
  actions: 'actions.md',
  recovery: path.join('recovery', 'common-failures.md'),
  intentsDir: 'intents',
  manifest: 'docs-manifest.json',
};

const STATUS_ICON = {
  initial: 'Initial',
  captured: 'Captured',
  duplicate: 'Duplicate',
  noop: 'No-op',
  failed: 'Failed',
};

const INTENT_TITLE_PREFIX = {
  'set-active-member': '切换标签',
  'set-expanded': '切换展开状态',
  'set-open': '切换打开状态',
};

Object.assign(INTENT_TITLE_PREFIX, {
  'switch-tab': '切换标签',
  'expand-panel': '切换展开状态',
  'open-overlay': '切换打开状态',
  'open-category': '打开分类',
  'open-book': '打开书籍',
  'open-work': '打开作品',
  'open-author': '打开作者页',
  'open-actress': '打开女优页',
  'open-utility-page': '打开功能页',
  'open-auth-page': '打开认证页',
  'paginate-content': '翻页',
});

Object.assign(INTENT_TITLE_PREFIX, {
  'open-chapter': '打开章节',
  'search-book': '搜索书籍',
  'search-work': '搜索作品',
  'list-category-videos': '分类榜单查询',
});

INTENT_TITLE_PREFIX['download-book'] = '下载书籍';

function normalizeWhitespace(value) {
  return String(value ?? '').replace(/\s+/gu, ' ').trim();
}

/* moodyz helpers (replaced below)
function isMoodyzContext(context) {
  return /(?:^|\.)moodyz\.com$/iu.test(String(context?.host ?? ''))
    || /(?:^|\/)moodyz\.com(?:\/|$)/iu.test(String(context?.baseUrl ?? context?.url ?? ''));
}

function siteIntentTitlePrefix(context, intentType) {
  if (isMoodyzContext(context)) {
    switch (intentType) {
      case 'search-book':
      case 'search-work':
        return '鎼滅储浣滃搧';
      case 'open-book':
      case 'open-work':
        return '鎵撳紑浣滃搧';
      case 'open-author':
      case 'open-actress':
        return '鎵撳紑濂充紭椤?';
      case 'download-book':
        return '涓嬭浇浣滃搧';
      case 'open-chapter':
        return '鎵撳紑鍐呭椤?';
      case 'open-category':
        return '鎵撳紑鍒嗙被';
      case 'open-utility-page':
        return '鎵撳紑鍔熻兘椤?';
      case 'open-auth-page':
        return '鎵撳紑璁よ瘉椤?';
      case 'paginate-content':
        return '缈婚〉';
      default:
        return String(intentType ?? '');
    }
  }

  return INTENT_TITLE_PREFIX[intentType] ?? intentType;
}

function siteTerminology(context) {
  if (isMoodyzContext(context)) {
    return {
      entityLabel: '浣滃搧',
      entityPlural: '浣滃搧',
      personLabel: '濂充紭',
      personPlural: '濂充紭',
      searchLabel: '鎼滅储浣滃搧',
      openEntityLabel: '鎵撳紑浣滃搧',
      openPersonLabel: '鎵撳紑濂充紭椤?',
      downloadLabel: '涓嬭浇浣滃搧',
    };
  }

  return {
    entityLabel: '涔︾睄',
    entityPlural: '涔︾睄',
    personLabel: '浣滆€?,
    personPlural: '浣滆€?,
    searchLabel: '鎼滅储涔︾睄',
    openEntityLabel: '鎵撳紑涔︾睄',
    openPersonLabel: '鎵撳紑浣滆€呴〉',
    downloadLabel: '涓嬭浇涔︾睄',
  };
}

*/

function isMoodyzContext(context) {
  return /(?:^|\.)moodyz\.com$/iu.test(String(context?.host ?? ''))
    || /(?:^|\.)moodyz\.com$/iu.test(String(context?.baseUrl ?? context?.url ?? ''));
}

function isJableContext(context) {
  return /(?:^|\.)jable\.tv$/iu.test(String(context?.host ?? ''))
    || /(?:^|\.)jable\.tv$/iu.test(String(context?.baseUrl ?? context?.url ?? ''));
}

function siteIntentTitlePrefix(context, intentType) {
  if (isMoodyzContext(context)) {
    switch (intentType) {
      case 'search-book':
      case 'search-work':
        return '\u641c\u7d22\u4f5c\u54c1';
      case 'open-book':
      case 'open-work':
        return '\u6253\u5f00\u4f5c\u54c1';
      case 'open-author':
      case 'open-actress':
        return '\u6253\u5f00\u5973\u4f18\u9875';
      case 'download-book':
        return '\u4e0b\u8f7d\u4f5c\u54c1';
      case 'open-chapter':
        return '\u6253\u5f00\u5185\u5bb9\u9875';
      case 'open-category':
        return '\u6253\u5f00\u5206\u7c7b';
      case 'open-utility-page':
        return '\u6253\u5f00\u529f\u80fd\u9875';
      case 'open-auth-page':
        return '\u6253\u5f00\u8ba4\u8bc1\u9875';
      case 'paginate-content':
        return '\u7ffb\u9875';
      default:
        return String(intentType ?? '');
    }
  }

  if (isJableContext(context)) {
    switch (intentType) {
      case 'search-book':
      case 'search-video':
        return '\u641c\u7d22\u5f71\u7247';
      case 'open-book':
      case 'open-video':
        return '\u6253\u5f00\u5f71\u7247';
      case 'open-author':
      case 'open-model':
        return '\u6253\u5f00\u6f14\u5458\u9875';
      case 'download-book':
        return '\u4e0b\u8f7d\u5f71\u7247';
      case 'open-chapter':
        return '\u6253\u5f00\u5185\u5bb9\u9875';
      case 'open-category':
        return '\u6253\u5f00\u5206\u7c7b';
      case 'list-category-videos':
        return '\u5206\u7c7b\u699c\u5355\u67e5\u8be2';
      case 'open-utility-page':
        return '\u6253\u5f00\u529f\u80fd\u9875';
      case 'open-auth-page':
        return '\u6253\u5f00\u8ba4\u8bc1\u9875';
      case 'paginate-content':
        return '\u7ffb\u9875';
      default:
        return String(intentType ?? '');
    }
  }

  return INTENT_TITLE_PREFIX[intentType] ?? intentType;
}

function siteTerminology(context) {
  if (isMoodyzContext(context)) {
    return {
      entityLabel: '\u4f5c\u54c1',
      entityPlural: '\u4f5c\u54c1',
      personLabel: '\u5973\u4f18',
      personPlural: '\u5973\u4f18',
      searchLabel: '\u641c\u7d22\u4f5c\u54c1',
      openEntityLabel: '\u6253\u5f00\u4f5c\u54c1',
      openPersonLabel: '\u6253\u5f00\u5973\u4f18\u9875',
      downloadLabel: '\u4e0b\u8f7d\u4f5c\u54c1',
    };
  }

  if (isJableContext(context)) {
    return {
      entityLabel: '\u5f71\u7247',
      entityPlural: '\u5f71\u7247',
      personLabel: '\u6f14\u5458',
      personPlural: '\u6f14\u5458',
      searchLabel: '\u641c\u7d22\u5f71\u7247',
      openEntityLabel: '\u6253\u5f00\u5f71\u7247',
      openPersonLabel: '\u6253\u5f00\u6f14\u5458\u9875',
      downloadLabel: '\u4e0b\u8f7d\u5f71\u7247',
    };
  }

  return {
    entityLabel: '\u4e66\u7c4d',
    entityPlural: '\u4e66\u7c4d',
    personLabel: '\u4f5c\u8005',
    personPlural: '\u4f5c\u8005',
    searchLabel: '\u641c\u7d22\u4e66\u7c4d',
    openEntityLabel: '\u6253\u5f00\u4e66\u7c4d',
    openPersonLabel: '\u6253\u5f00\u4f5c\u8005\u9875',
    downloadLabel: '\u4e0b\u8f7d\u4e66\u7c4d',
  };
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

function normalizeText(value) {
  return normalizeWhitespace(String(value ?? '').normalize('NFKC'));
}

function cleanText(value) {
  return normalizeText(value)
    .replace(/^[\s"'“”‘’`~!@#$%^&*()\-_=+\[\]{}\\|;:,.<>/?！？。，“”‘’【】（）《》]+/gu, '')
    .replace(/[\s"'“”‘’`~!@#$%^&*()\-_=+\[\]{}\\|;:,.<>/?！？。，“”‘’【】（）《》]+$/gu, '')
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

async function pathExists(targetPath) {
  if (!targetPath) {
    return false;
  }
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function resolveMaybeRelative(inputPath, baseDir) {
  if (!inputPath) {
    return null;
  }
  return path.isAbsolute(inputPath) ? inputPath : path.resolve(baseDir, inputPath);
}

async function readJsonFile(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function writeJsonFile(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function writeMarkdownFile(filePath, value) {
  await writeFile(filePath, `${String(value).trimEnd()}\n`, 'utf8');
}

async function firstExistingPath(candidates) {
  for (const candidate of candidates) {
    if (!candidate?.value) {
      continue;
    }
    const resolved = resolveMaybeRelative(candidate.value, candidate.baseDir);
    if (await pathExists(resolved)) {
      return resolved;
    }
  }
  return null;
}

function mergeOptions(options) {
  return {
    ...DEFAULT_OPTIONS,
    ...options,
    outDir: path.resolve(options.outDir ?? DEFAULT_OPTIONS.outDir),
  };
}

async function resolveNlEntryInput(options) {
  if (options.nlEntryManifestPath) {
    const nlEntryManifestPath = path.resolve(options.nlEntryManifestPath);
    if (!(await pathExists(nlEntryManifestPath))) {
      throw new Error(`NL entry manifest not found: ${nlEntryManifestPath}`);
    }
    return {
      nlEntryManifestPath,
      nlEntryDir: path.dirname(nlEntryManifestPath),
    };
  }

  if (!options.nlEntryDir) {
    throw new Error('Pass nlEntryManifestPath, --nl-entry-manifest, nlEntryDir, or --nl-entry-dir.');
  }

  const nlEntryDir = path.resolve(options.nlEntryDir);
  if (!(await pathExists(nlEntryDir))) {
    throw new Error(`NL entry directory not found: ${nlEntryDir}`);
  }

  const nlEntryManifestPath = path.join(nlEntryDir, NL_ENTRY_MANIFEST_NAME);
  return {
    nlEntryManifestPath: (await pathExists(nlEntryManifestPath)) ? nlEntryManifestPath : null,
    nlEntryDir,
  };
}

async function resolveChainedArtifacts(inputUrl, options) {
  const warnings = [];
  const { nlEntryManifestPath, nlEntryDir } = await resolveNlEntryInput(options);
  const nlEntryManifest = nlEntryManifestPath ? await readJsonFile(nlEntryManifestPath) : null;

  const aliasLexiconPath = await firstExistingPath([
    { value: nlEntryManifest?.files?.aliasLexicon, baseDir: nlEntryDir },
    { value: path.join(nlEntryDir, NL_ENTRY_FILE_NAMES.aliasLexicon), baseDir: nlEntryDir },
  ]);
  const slotSchemaPath = await firstExistingPath([
    { value: nlEntryManifest?.files?.slotSchema, baseDir: nlEntryDir },
    { value: path.join(nlEntryDir, NL_ENTRY_FILE_NAMES.slotSchema), baseDir: nlEntryDir },
  ]);
  const utterancePatternsPath = await firstExistingPath([
    { value: nlEntryManifest?.files?.utterancePatterns, baseDir: nlEntryDir },
    { value: path.join(nlEntryDir, NL_ENTRY_FILE_NAMES.utterancePatterns), baseDir: nlEntryDir },
  ]);
  const entryRulesPath = await firstExistingPath([
    { value: nlEntryManifest?.files?.entryRules, baseDir: nlEntryDir },
    { value: path.join(nlEntryDir, NL_ENTRY_FILE_NAMES.entryRules), baseDir: nlEntryDir },
  ]);
  const clarificationRulesPath = await firstExistingPath([
    { value: nlEntryManifest?.files?.clarificationRules, baseDir: nlEntryDir },
    { value: path.join(nlEntryDir, NL_ENTRY_FILE_NAMES.clarificationRules), baseDir: nlEntryDir },
  ]);

  if (!aliasLexiconPath || !slotSchemaPath || !utterancePatternsPath || !entryRulesPath || !clarificationRulesPath) {
    throw new Error(`Fifth-step input is incomplete under ${nlEntryDir}`);
  }

  const aliasLexiconDocument = await readJsonFile(aliasLexiconPath);
  const slotSchemaDocument = await readJsonFile(slotSchemaPath);
  const utterancePatternsDocument = await readJsonFile(utterancePatternsPath);
  const entryRulesDocument = await readJsonFile(entryRulesPath);
  const clarificationRulesDocument = await readJsonFile(clarificationRulesPath);

  const abstractionDir = path.resolve(options.abstractionDir ?? resolveMaybeRelative(nlEntryManifest?.source?.abstractionDir, nlEntryDir) ?? nlEntryDir);
  if (!(await pathExists(abstractionDir))) {
    throw new Error(`Abstraction directory not found: ${abstractionDir}`);
  }

  const abstractionManifestPath = await firstExistingPath([
    { value: nlEntryManifest?.source?.abstractionManifest, baseDir: nlEntryDir },
    { value: path.join(abstractionDir, ABSTRACTION_MANIFEST_NAME), baseDir: abstractionDir },
  ]);
  const abstractionManifest = abstractionManifestPath ? await readJsonFile(abstractionManifestPath) : null;

  const intentsPath = await firstExistingPath([
    { value: abstractionManifest?.files?.intents, baseDir: abstractionDir },
    { value: path.join(abstractionDir, ABSTRACTION_FILE_NAMES.intents), baseDir: abstractionDir },
  ]);
  const actionsPath = await firstExistingPath([
    { value: abstractionManifest?.files?.actions, baseDir: abstractionDir },
    { value: path.join(abstractionDir, ABSTRACTION_FILE_NAMES.actions), baseDir: abstractionDir },
  ]);
  const decisionTablePath = await firstExistingPath([
    { value: abstractionManifest?.files?.decisionTable, baseDir: abstractionDir },
    { value: path.join(abstractionDir, ABSTRACTION_FILE_NAMES.decisionTable), baseDir: abstractionDir },
  ]);

  if (!intentsPath || !actionsPath || !decisionTablePath) {
    throw new Error(`Fourth-step input is incomplete under ${abstractionDir}`);
  }

  const intentsDocument = await readJsonFile(intentsPath);
  const actionsDocument = await readJsonFile(actionsPath);
  const decisionTableDocument = await readJsonFile(decisionTablePath);

  const analysisDir = path.resolve(
    options.analysisDir
      ?? resolveMaybeRelative(abstractionManifest?.source?.analysisDir, abstractionDir)
      ?? resolveMaybeRelative(nlEntryManifest?.source?.analysisDir, nlEntryDir)
      ?? abstractionDir,
  );
  if (!(await pathExists(analysisDir))) {
    throw new Error(`Analysis directory not found: ${analysisDir}`);
  }

  const analysisManifestPath = await firstExistingPath([
    { value: abstractionManifest?.source?.analysisManifest, baseDir: abstractionDir },
    { value: path.join(analysisDir, ANALYSIS_MANIFEST_NAME), baseDir: analysisDir },
  ]);
  const analysisManifest = analysisManifestPath ? await readJsonFile(analysisManifestPath) : null;

  const elementsPath = await firstExistingPath([
    { value: analysisManifest?.files?.elements, baseDir: analysisDir },
    { value: path.join(analysisDir, ANALYSIS_FILE_NAMES.elements), baseDir: analysisDir },
  ]);
  const statesPath = await firstExistingPath([
    { value: analysisManifest?.files?.states, baseDir: analysisDir },
    { value: path.join(analysisDir, ANALYSIS_FILE_NAMES.states), baseDir: analysisDir },
  ]);
  const transitionsPath = await firstExistingPath([
    { value: analysisManifest?.files?.transitions, baseDir: analysisDir },
    { value: path.join(analysisDir, ANALYSIS_FILE_NAMES.transitions), baseDir: analysisDir },
  ]);

  if (!elementsPath || !statesPath || !transitionsPath) {
    throw new Error(`Third-step input is incomplete under ${analysisDir}`);
  }

  const elementsDocument = await readJsonFile(elementsPath);
  const statesDocument = await readJsonFile(statesPath);
  const transitionsDocument = await readJsonFile(transitionsPath);

  const expandedStatesDir = options.expandedStatesDir
    ? path.resolve(options.expandedStatesDir)
    : resolveMaybeRelative(abstractionManifest?.source?.expandedStatesDir, abstractionDir)
      ?? resolveMaybeRelative(analysisManifest?.source?.expandedStatesDir, analysisDir)
      ?? null;

  let statesManifestPath = null;
  let statesManifest = null;
  if (expandedStatesDir && (await pathExists(expandedStatesDir))) {
    for (const candidate of STATES_MANIFEST_CANDIDATES) {
      const candidatePath = path.join(expandedStatesDir, candidate);
      if (await pathExists(candidatePath)) {
        statesManifestPath = candidatePath;
        statesManifest = await readJsonFile(candidatePath);
        break;
      }
    }
    if (!statesManifestPath) {
      warnings.push(buildWarning('states_manifest_missing', `No second-step state manifest found under ${expandedStatesDir}`));
    }
  }

  const baseUrl = normalizeUrlNoFragment(firstNonEmpty([
    nlEntryManifest?.baseUrl,
    abstractionManifest?.baseUrl,
    analysisManifest?.baseUrl,
    inputUrl,
  ])) ?? inputUrl;

  return {
    inputUrl,
    baseUrl,
    nlEntryDir,
    nlEntryManifestPath,
    nlEntryManifest,
    aliasLexiconPath,
    slotSchemaPath,
    utterancePatternsPath,
    entryRulesPath,
    clarificationRulesPath,
    aliasLexiconDocument,
    slotSchemaDocument,
    utterancePatternsDocument,
    entryRulesDocument,
    clarificationRulesDocument,
    abstractionDir,
    abstractionManifestPath,
    abstractionManifest,
    intentsPath,
    actionsPath,
    decisionTablePath,
    intentsDocument,
    actionsDocument,
    decisionTableDocument,
    analysisDir,
    analysisManifestPath,
    analysisManifest,
    elementsPath,
    statesPath,
    transitionsPath,
    elementsDocument,
    statesDocument,
    transitionsDocument,
    expandedStatesDir,
    statesManifestPath,
    statesManifest,
    warnings,
  };
}

function buildIndices(artifacts) {
  const lexiconById = new Map();
  const lexiconByCanonicalId = new Map();
  const slotSchemaByIntentId = new Map();
  const patternsByIntentId = new Map();
  const entryRulesByIntentId = new Map();
  const actionsById = new Map();
  const intentsById = new Map();
  const decisionRulesByIntentId = new Map();
  const decisionRulesById = new Map();
  const elementsById = new Map();
  const membersById = new Map();
  const statesById = new Map();
  const elementStateByStateId = new Map();
  const transitionsById = new Map();
  const transitionsByToState = new Map();

  for (const entry of toArray(artifacts.aliasLexiconDocument?.entries)) {
    lexiconById.set(entry.lexiconId, entry);
    const bucket = lexiconByCanonicalId.get(String(entry.canonicalId ?? '')) ?? [];
    bucket.push(entry);
    lexiconByCanonicalId.set(String(entry.canonicalId ?? ''), bucket);
  }

  for (const slotSchema of toArray(artifacts.slotSchemaDocument?.intents)) {
    slotSchemaByIntentId.set(slotSchema.intentId, slotSchema);
  }

  for (const pattern of toArray(artifacts.utterancePatternsDocument?.patterns)) {
    const bucket = patternsByIntentId.get(pattern.intentId) ?? [];
    bucket.push(pattern);
    patternsByIntentId.set(pattern.intentId, bucket);
  }

  for (const rule of toArray(artifacts.entryRulesDocument?.rules)) {
    const bucket = entryRulesByIntentId.get(rule.intentId) ?? [];
    bucket.push(rule);
    entryRulesByIntentId.set(rule.intentId, bucket);
  }

  for (const action of toArray(artifacts.actionsDocument?.actions)) {
    actionsById.set(action.actionId, action);
  }

  for (const intent of toArray(artifacts.intentsDocument?.intents)) {
    intentsById.set(intent.intentId, intent);
  }

  for (const rule of toArray(artifacts.decisionTableDocument?.rules)) {
    decisionRulesById.set(rule.ruleId, rule);
    const bucket = decisionRulesByIntentId.get(rule.intentId) ?? [];
    bucket.push(rule);
    decisionRulesByIntentId.set(rule.intentId, bucket);
  }

  for (const element of toArray(artifacts.elementsDocument?.elements)) {
    elementsById.set(element.elementId, element);
    for (const member of toArray(element.members)) {
      membersById.set(member.memberId, member);
    }
  }

  for (const state of toArray(artifacts.statesDocument?.states)) {
    statesById.set(state.stateId, state);
    const bucket = new Map();
    for (const elementState of toArray(state.elementStates)) {
      bucket.set(elementState.elementId, elementState);
    }
    elementStateByStateId.set(state.stateId, bucket);
  }

  for (const edge of toArray(artifacts.transitionsDocument?.edges)) {
    transitionsById.set(edge.edgeId, edge);
    if (edge.toState) {
      const bucket = transitionsByToState.get(edge.toState) ?? [];
      bucket.push(edge);
      transitionsByToState.set(edge.toState, bucket);
    }
  }

  return {
    lexiconById,
    lexiconByCanonicalId,
    slotSchemaByIntentId,
    patternsByIntentId,
    entryRulesByIntentId,
    actionsById,
    intentsById,
    decisionRulesByIntentId,
    decisionRulesById,
    elementsById,
    membersById,
    statesById,
    elementStateByStateId,
    transitionsById,
    transitionsByToState,
  };
}

function elementStateLabel(intent, state, elementState, indices) {
  if (!elementState?.value) {
    return null;
  }
  if (intent.stateField === 'activeMemberId') {
    return firstNonEmpty([
      elementState.value.activeMemberLabel,
      indices.membersById.get(elementState.value.activeMemberId)?.label,
      elementState.value.activeMemberId,
    ]);
  }
  if (intent.stateField === 'expanded') {
    return elementState.value.expanded === true ? '展开' : elementState.value.expanded === false ? '收起' : null;
  }
  if (intent.stateField === 'open') {
    return elementState.value.open === true ? '打开' : elementState.value.open === false ? '关闭' : null;
  }
  return null;
}

function targetDisplayLabel(intent, value, indices) {
  if (intent.stateField === 'activeMemberId') {
    return firstNonEmpty([
      indices.membersById.get(String(value))?.label,
      String(value),
    ]);
  }
  if (intent.intentType === 'open-overlay' && value === true) {
    return '打开';
  }
  if (intent.intentType === 'open-overlay' && value === false) {
    return '关闭';
  }
  if (value === true) {
    return intent.intentType === 'set-open' ? '打开' : '展开';
  }
  if (value === false) {
    return intent.intentType === 'set-open' ? '关闭' : '收起';
  }
  return String(value);
}

function collectAliasesForCanonicalId(canonicalId, indices) {
  const entries = indices.lexiconByCanonicalId.get(String(canonicalId ?? '')) ?? [];
  const aliases = [];
  for (const entry of entries) {
    for (const alias of toArray(entry.aliases)) {
      aliases.push(alias);
    }
  }
  return aliases.sort((left, right) => compareNullableStrings(left.normalized, right.normalized));
}

function buildIntentDocsModel(artifacts, indices) {
  return toArray(artifacts.intentsDocument?.intents).map((intent) => {
    const element = indices.elementsById.get(intent.elementId) ?? null;
    const action = indices.actionsById.get(intent.actionId) ?? null;
    const slotSchema = indices.slotSchemaByIntentId.get(intent.intentId) ?? null;
    const patterns = toArray(indices.patternsByIntentId.get(intent.intentId)).sort((left, right) => left.priority - right.priority || compareNullableStrings(left.patternId, right.patternId));
    const entryRules = toArray(indices.entryRulesByIntentId.get(intent.intentId)).sort((left, right) => left.priority - right.priority || compareNullableStrings(left.entryRuleId, right.entryRuleId));
    const decisionRules = toArray(indices.decisionRulesByIntentId.get(intent.intentId)).sort((left, right) => left.priority - right.priority || compareNullableStrings(left.ruleId, right.ruleId));
    const stateIds = [...new Set(toArray(intent.evidence?.stateIds))].sort(compareNullableStrings);
    const states = stateIds.map((stateId) => indices.statesById.get(stateId)).filter(Boolean);
    const slotName = intent.targetDomain?.parameter ?? 'targetMemberId';

    const targetRecordsByKey = new Map();
    const ensureTarget = (value, label, extra = {}) => {
      const key = typeof value === 'boolean' ? `bool:${value}` : `str:${String(value)}`;
      const current = targetRecordsByKey.get(key) ?? {
        value,
        label: null,
        candidate: false,
        observed: false,
        actionable: false,
        stateIds: new Set(),
        edgeIds: new Set(),
        decisionRuleIds: new Set(),
        satisfiedRuleIds: [],
        actRuleIds: [],
        entryRuleIds: new Set(),
      };
      current.label = firstNonEmpty([label, current.label, targetDisplayLabel(intent, value, indices)]);
      current.candidate = current.candidate || Boolean(extra.candidate);
      current.observed = current.observed || Boolean(extra.observed);
      current.actionable = current.actionable || Boolean(extra.actionable);
      for (const stateId of toArray(extra.stateIds)) {
        current.stateIds.add(stateId);
      }
      for (const edgeId of toArray(extra.edgeIds)) {
        current.edgeIds.add(edgeId);
      }
      targetRecordsByKey.set(key, current);
      return current;
    };

    for (const candidate of toArray(intent.targetDomain?.candidateValues)) {
      ensureTarget(candidate.value, candidate.label, {
        candidate: true,
        observed: candidate.observed,
      });
    }
    for (const observed of toArray(intent.targetDomain?.observedValues)) {
      ensureTarget(observed.value, observed.label, {
        candidate: true,
        observed: true,
        stateIds: observed.stateIds,
        edgeIds: observed.edgeIds,
      });
    }
    for (const actionableValue of toArray(intent.targetDomain?.actionableValues)) {
      ensureTarget(actionableValue.value, actionableValue.label, {
        candidate: true,
        actionable: true,
        edgeIds: actionableValue.edgeIds,
      });
    }

    for (const rule of decisionRules) {
      const value = rule?.parameterBinding?.[slotName];
      if (value === undefined) {
        continue;
      }
      const target = ensureTarget(value, null);
      target.decisionRuleIds.add(rule.ruleId);
      if (rule.phase === 'satisfied') {
        target.satisfiedRuleIds.push(rule.ruleId);
      } else if (rule.phase === 'act') {
        target.actRuleIds.push(rule.ruleId);
      }
      for (const stateId of toArray(rule?.expected?.toStateIds)) {
        target.stateIds.add(stateId);
      }
      for (const edgeId of toArray(rule?.expected?.edgeIds)) {
        target.edgeIds.add(edgeId);
      }
    }

    for (const entryRule of entryRules) {
      const boundValue = entryRule?.resolution?.slotBindings?.[slotName]?.value;
      if (boundValue === undefined) {
        continue;
      }
      const target = ensureTarget(boundValue, null);
      target.entryRuleIds.add(entryRule.entryRuleId);
    }

    const targets = [...targetRecordsByKey.values()]
      .map((target) => ({
        ...target,
        aliases: collectAliasesForCanonicalId(intent.stateField === 'activeMemberId' ? target.value : String(target.value), indices),
        stateIds: [...target.stateIds].sort(compareNullableStrings),
        edgeIds: [...target.edgeIds].sort(compareNullableStrings),
        decisionRuleIds: [...target.decisionRuleIds].sort(compareNullableStrings),
        entryRuleIds: [...target.entryRuleIds].sort(compareNullableStrings),
        satisfiedRuleIds: [...target.satisfiedRuleIds].sort(compareNullableStrings),
        actRuleIds: [...target.actRuleIds].sort(compareNullableStrings),
      }))
      .sort((left, right) => Number(right.actionable) - Number(left.actionable)
        || Number(right.observed) - Number(left.observed)
        || compareNullableStrings(left.label, right.label));

    const recognizedOnlyTargets = targets.filter((target) => !target.actionable);
    const actionableTargets = targets.filter((target) => target.actionable);
    const startStateRows = states.map((state) => {
      const elementState = indices.elementStateByStateId.get(state.stateId)?.get(intent.elementId);
      return {
        state,
        elementState,
        valueLabel: elementStateLabel(intent, state, elementState, indices),
      };
    });

    return {
      intent,
      element,
      action,
      slotSchema,
      patterns,
      entryRules,
      decisionRules,
      states,
      startStateRows,
      actionableTargets,
      recognizedOnlyTargets,
      allTargets: targets,
    };
  }).sort((left, right) => compareNullableStrings(left.intent.intentId, right.intent.intentId));
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

function renderJsonCodeBlock(value) {
  return `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``;
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
  const finalOutDir = path.join(outDir, `${stamp}_${host}_docs`);
  const intentsDir = path.join(finalOutDir, DOC_FILE_NAMES.intentsDir);
  const recoveryDir = path.join(finalOutDir, path.dirname(DOC_FILE_NAMES.recovery));

  return {
    generatedAt,
    outDir: finalOutDir,
    readmePath: path.join(finalOutDir, DOC_FILE_NAMES.readme),
    glossaryPath: path.join(finalOutDir, DOC_FILE_NAMES.glossary),
    stateMapPath: path.join(finalOutDir, DOC_FILE_NAMES.stateMap),
    actionsPath: path.join(finalOutDir, DOC_FILE_NAMES.actions),
    intentsDir,
    recoveryDir,
    recoveryPath: path.join(finalOutDir, DOC_FILE_NAMES.recovery),
    manifestPath: path.join(finalOutDir, DOC_FILE_NAMES.manifest),
  };
}

function buildIntentDocFileName(intent) {
  const slug = cleanText(intent.intentName ?? intent.intentId)
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gu, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || intent.intentId;
  return `${slug}.md`;
}

function localizedIntentTitle(intent, element) {
  const prefix = INTENT_TITLE_PREFIX[intent.intentType] ?? intent.intentType;
  const elementName = firstNonEmpty([element?.elementName, intent.sourceElementName]);
  return elementName ? `${prefix}：${elementName}` : prefix;
}

function collectEvidenceRefsForState(state) {
  const refs = [];
  if (!state?.files) {
    return refs;
  }
  for (const [kind, filePath] of Object.entries(state.files)) {
    if (filePath) {
      refs.push({
        stateId: state.stateId,
        kind,
        path: filePath,
      });
    }
  }
  return refs;
}

function localizedIntentTitleForContext(context, intent, element) {
  const prefix = siteIntentTitlePrefix(context, intent.intentType);
  const elementName = firstNonEmpty([element?.elementName, intent.sourceElementName]);
  return elementName ? `${prefix}：${elementName}` : prefix;
}

function siteIntentTypeName(context, intentType) {
  if (isMoodyzContext(context)) {
    switch (intentType) {
      case 'search-book':
      case 'search-work':
        return 'search-work';
      case 'open-book':
      case 'open-work':
        return 'open-work';
      case 'open-author':
      case 'open-actress':
        return 'open-actress';
      case 'download-book':
        return 'download-work';
      default:
        return String(intentType ?? '');
    }
  }

  if (isJableContext(context)) {
    switch (intentType) {
      case 'search-book':
      case 'search-video':
        return 'search-video';
      case 'open-book':
      case 'open-video':
        return 'open-video';
      case 'open-author':
      case 'open-model':
        return 'open-model';
      case 'list-category-videos':
        return 'list-category-videos';
      case 'download-book':
        return 'download-video';
      default:
        return String(intentType ?? '');
    }
  }

  return String(intentType ?? '');
}

function renderEvidenceLinks(fromDir, state) {
  if (!state?.files) {
    return '_No evidence files_';
  }
  const links = [
    state.files.manifest ? markdownLink(`${state.stateId} manifest`, fromDir, state.files.manifest) : null,
    state.files.screenshot ? markdownLink(`${state.stateId} screenshot`, fromDir, state.files.screenshot) : null,
    state.files.html ? markdownLink(`${state.stateId} html`, fromDir, state.files.html) : null,
    state.files.snapshot ? markdownLink(`${state.stateId} snapshot`, fromDir, state.files.snapshot) : null,
  ].filter(Boolean);
  return links.length > 0 ? links.join(' | ') : '_No evidence files_';
}

function renderUserExpressionSection(context) {
  const patternLines = context.patterns.map((pattern) => `- \`${pattern.patternType}\`: ${toArray(pattern.examples).join(' / ') || pattern.regex}`);
  const aliasLines = context.allTargets.map((target) => {
    const aliasTexts = [...new Set(target.aliases.map((alias) => alias.text))];
    const label = target.label ?? String(target.value);
    return `- ${label}: ${aliasTexts.join(' / ') || label}`;
  });
  return [
    '## 用户表达',
    '',
    ...patternLines,
    '',
    '支持的目标别名：',
    ...aliasLines,
  ].join('\n');
}

function renderPreconditionsSection(context) {
  const actionable = context.actionableTargets.map((target) => target.label).join('、') || '无';
  const recognizedOnly = context.recognizedOnlyTargets.map((target) => target.label).join('、') || '无';
  return [
    '## 适用前提',
    '',
    `- 页面 URL 基线：\`${context.states[0]?.finalUrl ?? context.intent.elementId}\``,
    `- 需要运行时上下文：\`currentElementState\`${context.slotSchema ? '，可选 \`currentStateId\`' : ''}`,
    `- 作用元素：\`${context.intent.elementId}\` (${context.element?.elementName ?? context.intent.sourceElementName})`,
    `- 可执行目标：${actionable}`,
    `- 可识别但无动作证据：${recognizedOnly}`,
  ].join('\n');
}

function renderStartStatesSection(context) {
  const rows = context.startStateRows.map(({ state, valueLabel }) => [
    state.stateId,
    state.stateName,
    STATUS_ICON[state.sourceStatus] ?? state.sourceStatus,
    valueLabel ?? '-',
    state.finalUrl,
  ]);
  return [
    '## 起始状态',
    '',
    renderTable(['State', 'Name', 'Status', 'Current Value', 'Final URL'], rows),
  ].join('\n');
}

function renderTargetStatesSection(context, fromDir) {
  const rows = context.allTargets.map((target) => {
    const targetStates = target.stateIds.map((stateId) => context.states.find((state) => state.stateId === stateId)).filter(Boolean);
    return [
      target.label,
      target.actionable ? 'actionable' : 'recognition-only',
      targetStates.map((state) => `${state.stateId} (${state.stateName})`).join(', ') || '-',
      targetStates.map((state) => markdownLink(state.stateId, fromDir, state.files?.manifest)).join(', ') || '-',
    ];
  });
  return [
    '## 目标状态',
    '',
    renderTable(['Target', 'Support', 'State IDs', 'Evidence'], rows),
  ].join('\n');
}

function renderMainPathSection(context, fromDir, indices) {
  const sections = ['## 主路径步骤', ''];
  if (context.actionableTargets.length === 0) {
    sections.push('_No actionable targets_');
    return sections.join('\n');
  }

  for (const target of context.actionableTargets) {
    const targetStates = target.stateIds.map((stateId) => indices.statesById.get(stateId)).filter(Boolean);
    const exemplarState = targetStates[0] ?? null;
    const member = context.intent.stateField === 'activeMemberId' ? indices.membersById.get(String(target.value)) : null;
    sections.push(`### 目标：${target.label}`);
    sections.push('');
    sections.push(`1. 解析用户输入，命中意图 \`${context.intent.intentId}\`，并把槽位 \`${context.intent.targetDomain.parameter}\` 绑定为 \`${target.label}\`。`);
    sections.push(`2. 先读取 \`currentElementState.${context.intent.stateField}\`。若已经等于目标值，则转到“已满足规则（noop）”。`);
    sections.push(`3. 否则执行动作原语 \`${context.intent.actionId}\`${member?.locator?.id ? `，优先使用 locator id \`${member.locator.id}\`` : ''}${member?.controlledTarget ? `，受控区域 \`${member.controlledTarget}\`` : ''}。`);
    sections.push(`4. 执行后按 \`decision-table:first-match\` 校验规则：${target.actRuleIds.map((ruleId) => `\`${ruleId}\``).join('、') || '无 act 规则'}`);
    sections.push(`5. 期望落入状态：${targetStates.map((state) => `\`${state.stateId}\``).join('、') || '未知'}。`);
    sections.push(`6. 证据校验：${targetStates.map((state) => renderEvidenceLinks(fromDir, state)).join('；') || '无目标状态证据'}`);
    sections.push('');
    if (exemplarState) {
      sections.push(`成功判定：\`${context.intent.stateField}\` 应变为 \`${target.label}\`，页面 URL 期望为 \`${exemplarState.finalUrl}\`，标题期望为 “${exemplarState.title}”。`);
      sections.push('');
    }
  }

  return sections.join('\n');
}

function renderMoodyzMainPathSection(context, fromDir, indices) {
  const sections = ['## 主路径步骤', ''];
  if (context.actionableTargets.length === 0) {
    sections.push('_No actionable targets_');
    return sections.join('\n');
  }

  const intentLabel = siteIntentTitlePrefix(context, context.intent.intentType);
  for (const target of context.actionableTargets) {
    const targetStates = target.stateIds.map((stateId) => indices.statesById.get(stateId)).filter(Boolean);
    const exemplarState = targetStates[0] ?? null;
    sections.push(`### 目标：${target.label}`);
    sections.push('');
    sections.push(`1. 解析用户输入，命中意图 \`${intentLabel}\`，并将槽位 \`${context.intent.targetDomain.parameter}\` 绑定为 \`${target.label}\`。`);
    sections.push(`2. 先读取 \`currentElementState.${context.intent.stateField}\`。若已经等于目标值，则转到“已满足规则（noop）”。`);
    sections.push(`3. 否则执行动作原语 \`${context.intent.actionId}\`。`);
    sections.push(`4. 执行后按 \`decision-table:first-match\` 校验规则：${target.actRuleIds.map((ruleId) => `\`${ruleId}\``).join('、') || '无 act 规则'}`);
    sections.push(`5. 期望落入状态：${targetStates.map((state) => `\`${state.stateId}\``).join('、') || '未知'}。`);
    sections.push(`6. 证据校验：${targetStates.map((state) => renderEvidenceLinks(fromDir, state)).join('；') || '无目标状态证据'}`);
    sections.push('');
    if (exemplarState) {
      sections.push(`成功判定：\`${context.intent.stateField}\` 应变为 \`${target.label}\`，页面 URL 期望为 \`${exemplarState.finalUrl}\`，标题期望为 “${exemplarState.title}”。`);
      sections.push('');
    }
  }
  return sections.join('\n');
}

function renderNoopSection(context) {
  const rows = context.allTargets
    .filter((target) => target.satisfiedRuleIds.length > 0)
    .map((target) => [
      target.label,
      target.satisfiedRuleIds.join(', '),
      target.actRuleIds.length > 0 ? 'act available' : 'noop only',
    ]);
  return [
    '## 已满足规则（noop）',
    '',
    renderTable(['Target', 'Satisfied Rules', 'Note'], rows),
  ].join('\n');
}

function renderRecoverySection(context, clarificationRules) {
  const lines = ['## 异常恢复', ''];
  const cases = [
    'missing-slot',
    'ambiguous-target',
    'unsupported-target',
    'already-satisfied',
    'unknown-intent',
    'out-of-domain',
  ];
  for (const caseName of cases) {
    const rule = clarificationRules.find((item) => item.case === caseName);
    if (!rule) {
      continue;
    }
    lines.push(`- \`${caseName}\`: ${rule.response?.questionTemplate ?? 'See recovery/common-failures.md'}${rule.response?.candidateSource ? `（候选来源：${rule.response.candidateSource}）` : ''}`);
  }
  lines.push('');
  lines.push('详见 `../recovery/common-failures.md`。');
  return lines.join('\n');
}

function renderSuccessSignalsSection(context, indices) {
  const rows = context.allTargets.map((target) => {
    const firstState = target.stateIds.map((stateId) => indices.statesById.get(stateId)).find(Boolean) ?? null;
    return [
      target.label,
      `${context.intent.stateField} = ${target.label}`,
      firstState?.finalUrl ?? '-',
      firstState?.title ?? '-',
    ];
  });
  return [
    '## 成功信号',
    '',
    renderTable(['Target', 'State Field', 'Observed URL', 'Observed Title'], rows),
  ].join('\n');
}

function renderEvidenceSection(context, fromDir, indices) {
  const lines = ['## 关联证据 / 状态引用', ''];
  for (const state of context.states) {
    const edge = toArray(indices.transitionsByToState.get(state.stateId))[0] ?? null;
    lines.push(`- \`${state.stateId}\` ${state.stateName}${edge?.trigger?.label ? `，触发器：${edge.trigger.label}` : ''}`);
    lines.push(`  证据：${renderEvidenceLinks(fromDir, state)}`);
  }
  return lines.join('\n');
}

function renderIntentDoc(context, artifacts, indices, fromDir) {
  const mainPathSection = isMoodyzContext(context)
    ? renderMoodyzMainPathSection(context, fromDir, indices)
    : renderMainPathSection(context, fromDir, indices);

  return [
    `# ${localizedIntentTitleForContext(context, context.intent, context.element)}`,
    '',
    `- Intent ID: \`${context.intent.intentId}\``,
    `- Intent Type: \`${siteIntentTypeName(context, context.intent.intentType)}\``,
    `- Element: \`${context.intent.elementId}\` (${context.element?.elementName ?? context.intent.sourceElementName})`,
    `- Action Primitive: \`${context.intent.actionId}\``,
    '',
    renderUserExpressionSection(context),
    '',
    renderPreconditionsSection(context),
    '',
    renderStartStatesSection(context),
    '',
    renderTargetStatesSection(context, fromDir),
    '',
    mainPathSection,
    '',
    renderNoopSection(context),
    '',
    renderRecoverySection(context, toArray(artifacts.clarificationRulesDocument?.rules)),
    '',
    renderSuccessSignalsSection(context, indices),
    '',
    renderEvidenceSection(context, fromDir, indices),
  ].join('\n');
}

function renderGlossary(artifacts, contexts) {
  const termRows = [
    ['Intent', '页面级可执行意图族，对应第四步的参数化意图。'],
    ['Action', '可复用动作原语，如 `navigate`、`select-member`、`click-toggle`。'],
    ['State', '第三步 concrete state，带 final URL、title 和证据文件。'],
    ['Entry Rule', '第五步用户语言到意图/槽位/决策表的映射规则。'],
    ['Clarification Rule', '缺槽位、歧义、越界目标时的澄清或拒绝策略。'],
    ['Evidence', 'HTML、DOM snapshot、screenshot、manifest 等状态证据。'],
  ];

  const namingRows = [
    ['`s0000`', '初始状态；后续 `s0001+` 为观测子状态。'],
    ['`el_*`', '状态相关元素组。'],
    ['`mem_*`', '元素成员，如 tab group 下的单个 tab。'],
    ['`rule_*`', '第四步决策规则。'],
    ['`entry_*`', '第五步自然语言入口规则。'],
  ];

  const elementRows = contexts.map((context) => [
    context.intent.elementId,
    context.element?.kind ?? context.intent.elementKind,
    context.element?.elementName ?? context.intent.sourceElementName,
  ]);

  return [
    '# Glossary',
    '',
    '## 术语表',
    '',
    renderTable(['Term', 'Meaning'], termRows),
    '',
    '## 命名约定',
    '',
    renderTable(['Name', 'Convention'], namingRows),
    '',
    '## 页面元素',
    '',
    renderTable(['Element ID', 'Kind', 'Name'], elementRows),
  ].join('\n');
}

function renderActionsDoc(artifacts) {
  const sections = ['# Actions', ''];
  for (const action of toArray(artifacts.actionsDocument?.actions)) {
    sections.push(`## ${action.actionName}`);
    sections.push('');
    sections.push(`- Action ID: \`${action.actionId}\``);
    sections.push(`- Primitive: \`${action.primitive}\``);
    sections.push(`- Applies To: ${toArray(action.appliesTo).map((item) => `\`${item}\``).join(', ') || '-'}`);
    sections.push(`- Reads: ${toArray(action.reads).map((item) => `\`${item}\``).join(', ') || '-'}`);
    sections.push(`- Effects: ${toArray(action.effects).map((item) => `\`${item}\``).join(', ') || '-'}`);
    sections.push(`- Locator Preference: ${toArray(action.locatorPreference).map((item) => `\`${item}\``).join(', ') || '-'}`);
    sections.push('');
    sections.push(renderJsonCodeBlock(action.bindingSchema));
    sections.push('');
  }
  return sections.join('\n');
}

function renderStateMapDoc(artifacts, contexts, layout) {
  const stateRows = toArray(artifacts.statesDocument?.states).map((state) => {
    const keyStates = toArray(state.elementStates).map((elementState) => {
      if (elementState.value?.activeMemberLabel !== undefined) {
        return `${elementState.kind}: ${elementState.value.activeMemberLabel}`;
      }
      if (elementState.value.expanded !== undefined) {
        return `${elementState.kind}: ${elementState.value.expanded ? '展开' : '收起'}`;
      }
      if (elementState.value.open !== undefined) {
        return `${elementState.kind}: ${elementState.value.open ? '打开' : '关闭'}`;
      }
      return `${elementState.kind}: ${JSON.stringify(elementState.value)}`;
    }).join(' / ');
    return [
      state.stateId,
      STATUS_ICON[state.sourceStatus] ?? state.sourceStatus,
      state.stateName,
      keyStates,
      markdownLink('manifest', layout.outDir, state.files?.manifest),
    ];
  });

  const transitionRows = toArray(artifacts.transitionsDocument?.edges).map((edge) => [
    edge.edgeId,
    edge.fromState ?? '-',
    edge.toState ?? '-',
    edge.trigger?.label ?? edge.trigger?.kind ?? '-',
    edge.outcome,
    edge.finalUrl ?? '-',
  ]);

  return [
    '# State Map',
    '',
    '## 状态总览',
    '',
    renderTable(['State', 'Status', 'Name', 'Key Element State', 'Evidence'], stateRows),
    '',
    '## 状态转换摘要',
    '',
    renderTable(['Edge', 'From', 'To', 'Trigger', 'Outcome', 'Final URL'], transitionRows),
  ].join('\n');
}

function renderRecoveryDoc(artifacts) {
  const sections = ['# Common Failures', ''];
  for (const rule of toArray(artifacts.clarificationRulesDocument?.rules)) {
    sections.push(`## ${rule.case}`);
    sections.push('');
    sections.push(`- When: \`${rule.when?.match ?? 'n/a'}\``);
    sections.push(`- Mode: \`${rule.response?.mode ?? 'n/a'}\``);
    sections.push(`- Message: ${rule.response?.questionTemplate ?? '-'}`);
    sections.push(`- Candidate Source: ${rule.response?.candidateSource ?? '-'}`);
    sections.push(`- Recovery: expected \`${rule.recovery?.expectedSlot ?? '-'}\`, resume \`${rule.recovery?.resumeMode ?? '-'}\``);
    sections.push('');
  }
  return sections.join('\n');
}

function renderReadmeDoc(layout, intentDocRecords) {
  const intentLinks = intentDocRecords.map((record) => `- ${markdownLink(record.title, layout.outDir, record.path)}`);
  return [
    '# Web Operation Docs',
    '',
    '## 导航',
    '',
    `- ${markdownLink('Glossary', layout.outDir, layout.glossaryPath)}`,
    `- ${markdownLink('State Map', layout.outDir, layout.stateMapPath)}`,
    `- ${markdownLink('Actions', layout.outDir, layout.actionsPath)}`,
    `- ${markdownLink('Common Failures', layout.outDir, layout.recoveryPath)}`,
    '',
    '## Intent Docs',
    '',
    ...intentLinks,
  ].join('\n');
}

function buildDocsManifest({
  artifacts,
  layout,
  documents,
  warnings,
}) {
  return {
    inputUrl: artifacts.inputUrl,
    baseUrl: artifacts.baseUrl,
    generatedAt: layout.generatedAt,
    outDir: layout.outDir,
    source: {
      nlEntryManifest: artifacts.nlEntryManifestPath,
      nlEntryDir: artifacts.nlEntryDir,
      abstractionManifest: artifacts.abstractionManifestPath,
      abstractionDir: artifacts.abstractionDir,
      analysisManifest: artifacts.analysisManifestPath,
      analysisDir: artifacts.analysisDir,
      expandedStatesDir: artifacts.expandedStatesDir,
      statesManifest: artifacts.statesManifestPath,
    },
    summary: {
      inputIntents: toArray(artifacts.intentsDocument?.intents).length,
      inputStates: toArray(artifacts.statesDocument?.states).length,
      inputEdges: toArray(artifacts.transitionsDocument?.edges).length,
      documents: documents.length,
      intentDocs: documents.filter((doc) => doc.type === 'intent').length,
    },
    files: {
      readme: layout.readmePath,
      glossary: layout.glossaryPath,
      stateMap: layout.stateMapPath,
      actions: layout.actionsPath,
      recovery: layout.recoveryPath,
      intentsDir: layout.intentsDir,
      manifest: layout.manifestPath,
    },
    documents,
    warnings,
  };
}

function summarizeForStdout(manifest) {
  return {
    intents: manifest.summary.inputIntents,
    states: manifest.summary.inputStates,
    documents: manifest.summary.documents,
    outDir: manifest.outDir,
  };
}

export async function generateDocs(inputUrl, options = {}) {
  const settings = mergeOptions(options);
  const artifacts = await resolveChainedArtifacts(inputUrl, settings);
  const warnings = [...artifacts.warnings];
  const indices = buildIndices(artifacts);
  const contexts = buildIntentDocsModel(artifacts, indices);
  const layout = createOutputLayout(artifacts.baseUrl ?? inputUrl, settings.outDir);

  await mkdir(layout.outDir, { recursive: true });
  await mkdir(layout.intentsDir, { recursive: true });
  await mkdir(layout.recoveryDir, { recursive: true });

  const intentDocRecords = [];

  for (const context of contexts) {
    const fileName = buildIntentDocFileName(context.intent);
    const docPath = path.join(layout.intentsDir, fileName);
    const markdown = renderIntentDoc(context, artifacts, indices, path.dirname(docPath));
    await writeMarkdownFile(docPath, markdown);
    intentDocRecords.push({
      docId: `doc_${context.intent.intentId}`,
      type: 'intent',
      title: localizedIntentTitle(context.intent, context.element),
      path: docPath,
      intentId: context.intent.intentId,
      relatedStateIds: [...new Set(context.states.map((state) => state.stateId))].sort(compareNullableStrings),
      evidenceRefs: context.states.flatMap((state) => collectEvidenceRefsForState(state)),
    });
  }

  const readmeMarkdown = renderReadmeDoc(layout, intentDocRecords);
  const glossaryMarkdown = renderGlossary(artifacts, contexts);
  const stateMapMarkdown = renderStateMapDoc(artifacts, contexts, layout);
  const actionsMarkdown = renderActionsDoc(artifacts);
  const recoveryMarkdown = renderRecoveryDoc(artifacts);

  await writeMarkdownFile(layout.readmePath, readmeMarkdown);
  await writeMarkdownFile(layout.glossaryPath, glossaryMarkdown);
  await writeMarkdownFile(layout.stateMapPath, stateMapMarkdown);
  await writeMarkdownFile(layout.actionsPath, actionsMarkdown);
  await writeMarkdownFile(layout.recoveryPath, recoveryMarkdown);

  const documentRecords = [
    {
      docId: 'doc_readme',
      type: 'readme',
      title: 'README',
      path: layout.readmePath,
      intentId: null,
      relatedStateIds: [],
      evidenceRefs: [],
    },
    {
      docId: 'doc_glossary',
      type: 'glossary',
      title: 'Glossary',
      path: layout.glossaryPath,
      intentId: null,
      relatedStateIds: [],
      evidenceRefs: [],
    },
    {
      docId: 'doc_state_map',
      type: 'state-map',
      title: 'State Map',
      path: layout.stateMapPath,
      intentId: null,
      relatedStateIds: toArray(artifacts.statesDocument?.states).map((state) => state.stateId).sort(compareNullableStrings),
      evidenceRefs: toArray(artifacts.statesDocument?.states).flatMap((state) => collectEvidenceRefsForState(state)),
    },
    {
      docId: 'doc_actions',
      type: 'actions',
      title: 'Actions',
      path: layout.actionsPath,
      intentId: null,
      relatedStateIds: [],
      evidenceRefs: [],
    },
    ...intentDocRecords,
    {
      docId: 'doc_recovery',
      type: 'recovery',
      title: 'Common Failures',
      path: layout.recoveryPath,
      intentId: null,
      relatedStateIds: [],
      evidenceRefs: [],
    },
  ];

  const docsManifest = buildDocsManifest({
    artifacts,
    layout,
    documents: documentRecords,
    warnings,
  });
  await writeJsonFile(layout.manifestPath, docsManifest);
  return docsManifest;
}

function printHelp() {
  process.stdout.write(`Usage:
  node generate-docs.mjs <url> --nl-entry-manifest <path>
  node generate-docs.mjs <url> --nl-entry-dir <dir>

Options:
  --nl-entry-manifest <path>  Path to nl-entry-manifest.json
  --nl-entry-dir <dir>        Directory containing fifth-step outputs
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
      case '--nl-entry-manifest': {
        const { value, nextIndex } = readValue(current, index);
        options.nlEntryManifestPath = value;
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

    const manifest = await generateDocs(url, options);
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
