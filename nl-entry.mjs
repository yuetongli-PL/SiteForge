// @ts-check

import { createHash } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const DEFAULT_OPTIONS = {
  abstractionManifestPath: undefined,
  abstractionDir: undefined,
  analysisDir: undefined,
  examplesPath: undefined,
  outDir: path.resolve(process.cwd(), 'nl-entry'),
};

const ABSTRACTION_MANIFEST_NAME = 'abstraction-manifest.json';
const ANALYSIS_MANIFEST_NAME = 'analysis-manifest.json';
const INTENTS_FILE_NAME = 'intents.json';
const ACTIONS_FILE_NAME = 'actions.json';
const DECISION_TABLE_FILE_NAME = 'decision-table.json';
const ELEMENTS_FILE_NAME = 'elements.json';
const STATES_FILE_NAME = 'states.json';

const SOURCE_PRIORITY = {
  example: 0,
  generated: 1,
  generic: 2,
};

const ZH_SWITCH_VERBS = ['切换到', '切到', '进入', '去', '选中', '显示'];
const ZH_OPEN_VERBS = ['打开', '显示', '看看'];
const EN_GENERIC_VERBS = ['open', 'show', 'switch to', 'go to', 'select'];
const ZH_SEARCH_VERBS = ['搜索', '搜', '搜一下', '查找', '找书', '搜书', '查书'];
const ZH_STATUS_QUERY_EXAMPLES = {
  'tab-group': ['当前是哪个标签', '现在在哪个分类', '现在在哪个栏目'],
  'details-toggle': ['当前是展开还是收起', '现在详情是展开的吗'],
  'expanded-toggle': ['当前是展开还是收起', '现在面板是展开的吗'],
  'menu-button': ['当前菜单打开了吗', '现在是打开状态吗'],
  'dialog-open': ['当前弹窗打开了吗', '现在对话框是开着的吗'],
};

const FILLER_PREFIXES = ['请', '麻烦', '麻烦你', '帮我', '给我', '帮忙', '我想', '我要', '我想要'];
const FILLER_SUFFIXES = ['一下', '看一下', '看下', '看一看', '看看', '吧'];

const BOOLEAN_ALIASES = {
  'set-expanded': {
    true: {
      canonical: '展开',
      aliases: ['展开', '打开', '显示'],
      enAliases: ['expand', 'open', 'show'],
    },
    false: {
      canonical: '收起',
      aliases: ['收起', '折叠', '隐藏'],
      enAliases: ['collapse', 'close', 'hide'],
    },
  },
  'set-open': {
    true: {
      canonical: '打开',
      aliases: ['打开', '开启', '显示'],
      enAliases: ['open', 'show'],
    },
    false: {
      canonical: '关闭',
      aliases: ['关闭', '收起', '隐藏'],
      enAliases: ['close', 'hide'],
    },
  },
};

const INTENT_LANGUAGE_LABELS = {
  'set-active-member': {
    canonical: '切换标签',
    aliases: ['切换标签', '切换栏目', '切换分类', '切换到', '选择标签'],
  },
  'set-expanded': {
    canonical: '切换展开状态',
    aliases: ['展开', '收起', '展开区域', '切换展开'],
  },
  'set-open': {
    canonical: '切换打开状态',
    aliases: ['打开', '关闭', '打开菜单', '打开对话框'],
  },
};

const ELEMENT_KIND_LABELS = {
  'tab-group': {
    canonical: '标签',
    aliases: ['标签', '栏目', '分类', '页签'],
  },
  'details-toggle': {
    canonical: '详情',
    aliases: ['详情', '详情项', '折叠项'],
  },
  'expanded-toggle': {
    canonical: '展开项',
    aliases: ['展开项', '筛选', '面板'],
  },
  'menu-button': {
    canonical: '菜单',
    aliases: ['菜单', '下拉菜单'],
  },
  'dialog-open': {
    canonical: '对话框',
    aliases: ['对话框', '弹窗'],
  },
};

Object.assign(ZH_STATUS_QUERY_EXAMPLES, {
  'category-link-group': ['当前在哪个分类', '现在是哪个分类页'],
  'content-link-group': ['当前打开的是哪本书', '现在在看哪本书'],
  'author-link-group': ['当前打开的是哪个作者页', '现在在哪个作者页'],
  'utility-link-group': ['当前在首页还是阅读记录', '现在在哪个功能页'],
  'auth-link-group': ['当前是登录页还是注册页', '现在打开的是哪个认证页'],
  'pagination-link-group': ['当前翻到了哪一页', '现在在哪个分页位置'],
});

BOOLEAN_ALIASES['expand-panel'] = BOOLEAN_ALIASES['set-expanded'];
BOOLEAN_ALIASES['open-overlay'] = BOOLEAN_ALIASES['set-open'];

Object.assign(ZH_STATUS_QUERY_EXAMPLES, {
  'chapter-link-group': ['当前在哪一章', '现在打开的是哪一章'],
  'search-form-group': ['当前搜索的是什么', '现在的搜索词是什么'],
});

Object.assign(INTENT_LANGUAGE_LABELS, {
  'open-chapter': {
    canonical: '打开章节',
    aliases: ['打开章节', '查看章节', '进入章节', '阅读章节'],
  },
  'search-book': {
    canonical: '搜索书籍',
    aliases: ['搜索书籍', '搜索小说', '查找书籍', '搜书', '找书'],
  },
});

Object.assign(ELEMENT_KIND_LABELS, {
  'chapter-link-group': {
    canonical: '章节',
    aliases: ['章节', '正文', '目录', '章节目录'],
  },
  'search-form-group': {
    canonical: '搜索',
    aliases: ['搜索', '搜书', '搜索框', '查找'],
  },
});

Object.assign(INTENT_LANGUAGE_LABELS, {
  'switch-tab': INTENT_LANGUAGE_LABELS['set-active-member'],
  'expand-panel': INTENT_LANGUAGE_LABELS['set-expanded'],
  'open-overlay': INTENT_LANGUAGE_LABELS['set-open'],
  'open-category': {
    canonical: '打开分类',
    aliases: ['打开分类', '进入分类', '切到分类', '查看分类'],
  },
  'open-book': {
    canonical: '打开书籍',
    aliases: ['打开书籍', '进入书籍', '查看小说', '打开小说', '进入详情'],
  },
  'open-author': {
    canonical: '打开作者页',
    aliases: ['打开作者页', '查看作者', '进入作者页'],
  },
  'open-utility-page': {
    canonical: '打开功能页',
    aliases: ['打开功能页', '回首页', '查看阅读记录', '进入功能页'],
  },
  'open-auth-page': {
    canonical: '打开认证页',
    aliases: ['打开登录页', '打开注册页', '进入登录', '进入注册'],
  },
  'paginate-content': {
    canonical: '翻页',
    aliases: ['翻页', '下一页', '上一页', '翻到下一页'],
  },
});

Object.assign(ELEMENT_KIND_LABELS, {
  'category-link-group': {
    canonical: '分类',
    aliases: ['分类', '栏目', '题材', '频道'],
  },
  'content-link-group': {
    canonical: '书籍',
    aliases: ['书籍', '小说', '作品', '详情'],
  },
  'author-link-group': {
    canonical: '作者',
    aliases: ['作者', '作者页'],
  },
  'utility-link-group': {
    canonical: '功能页',
    aliases: ['首页', '阅读记录', '功能页'],
  },
  'auth-link-group': {
    canonical: '认证页',
    aliases: ['登录页', '注册页', '认证页'],
  },
  'pagination-link-group': {
    canonical: '分页',
    aliases: ['分页', '上一页', '下一页'],
  },
});

ZH_OPEN_VERBS.push('下载', '导出');
INTENT_LANGUAGE_LABELS['download-book'] = {
  canonical: '下载书籍',
  aliases: ['下载书籍', '下载小说', '导出小说', '保存整本', '保存全文'],
};

/**
 * @typedef {{
 *   text: string,
 *   intentId?: string,
 *   targetLabel?: string,
 *   aliases?: string[]
 * }} ExampleUtterance
 */

function createSha256(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function normalizeWhitespace(value) {
  return String(value ?? '').replace(/\s+/gu, ' ').trim();
}

function normalizeText(value) {
  return normalizeWhitespace(String(value ?? '').normalize('NFKC'));
}

function cleanDisplayText(value) {
  return normalizeText(value)
    .replace(/^[\s"'“”‘’`~!@#$%^&*()\-_=+\[\]{}\\|;:,.<>/?！？。，“”‘’【】（）《》]+/gu, '')
    .replace(/[\s"'“”‘’`~!@#$%^&*()\-_=+\[\]{}\\|;:,.<>/?！？。，“”‘’【】（）《》]+$/gu, '')
    .trim();
}

function normalizeAliasText(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[，。！？、；：,.!?;:()[\]{}<>《》【】“”‘’"'`~]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function normalizeMatchText(value) {
  let text = normalizeAliasText(value);
  let changed = true;

  while (changed) {
    changed = false;
    for (const prefix of FILLER_PREFIXES) {
      const normalizedPrefix = normalizeAliasText(prefix);
      if (text.startsWith(`${normalizedPrefix} `)) {
        text = text.slice(normalizedPrefix.length).trim();
        changed = true;
      } else if (text === normalizedPrefix) {
        text = '';
        changed = true;
      }
    }
    for (const suffix of FILLER_SUFFIXES) {
      const normalizedSuffix = normalizeAliasText(suffix);
      if (text.endsWith(` ${normalizedSuffix}`)) {
        text = text.slice(0, -normalizedSuffix.length).trim();
        changed = true;
      } else if (text === normalizedSuffix) {
        text = '';
        changed = true;
      }
    }
  }

  return text;
}

function extractExampleTargetAlias(text) {
  let cleaned = normalizeMatchText(text);
  const removablePrefixes = [
    ...ZH_SWITCH_VERBS,
    ...ZH_OPEN_VERBS,
    ...EN_GENERIC_VERBS,
    '设置',
    '切换',
    '变为',
    '设为',
    '调整为',
  ]
    .map((value) => normalizeAliasText(value))
    .sort((left, right) => right.length - left.length);

  for (const prefix of removablePrefixes) {
    if (cleaned.startsWith(`${prefix} `)) {
      cleaned = cleaned.slice(prefix.length).trim();
      break;
    }
    if (cleaned.startsWith(prefix)) {
      cleaned = cleaned.slice(prefix.length).trim();
      break;
    }
  }

  cleaned = cleaned.replace(/^(?:到|去)\s*/u, '');
  cleaned = cleaned.replace(/\s*(?:标签|栏目|分类|页签|菜单|对话框|弹窗|tab|tabs|menu|dialog)$/iu, '');
  cleaned = cleaned.replace(/\s+/gu, ' ').trim();
  return cleaned;
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

function stableValueKey(value) {
  return typeof value === 'boolean' ? `bool:${value}` : `str:${String(value ?? '')}`;
}

function serializeValue(value) {
  return typeof value === 'boolean' ? String(value) : String(value ?? '');
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

function escapeRegex(value) {
  return String(value ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildWarning(code, message, details = {}) {
  return {
    code,
    message,
    ...details,
  };
}

function resolveMaybeRelative(inputPath, baseDir) {
  if (!inputPath) {
    return null;
  }
  return path.isAbsolute(inputPath) ? inputPath : path.resolve(baseDir, inputPath);
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

async function readJsonFile(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function writeJsonFile(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
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

function summarizeForStdout(manifest) {
  return {
    lexiconEntries: manifest.summary.lexiconEntries,
    intents: manifest.summary.inputIntents,
    patterns: manifest.summary.utterancePatterns,
    entryRules: manifest.summary.entryRules,
    clarificationRules: manifest.summary.clarificationRules,
    outDir: manifest.outDir,
  };
}

async function resolveAbstractionInput(options) {
  if (options.abstractionManifestPath) {
    const abstractionManifestPath = path.resolve(options.abstractionManifestPath);
    if (!(await pathExists(abstractionManifestPath))) {
      throw new Error(`Abstraction manifest not found: ${abstractionManifestPath}`);
    }
    return {
      abstractionManifestPath,
      abstractionDir: path.dirname(abstractionManifestPath),
    };
  }

  if (!options.abstractionDir) {
    throw new Error('Pass abstractionManifestPath, --abstraction-manifest, abstractionDir, or --abstraction-dir.');
  }

  const abstractionDir = path.resolve(options.abstractionDir);
  if (!(await pathExists(abstractionDir))) {
    throw new Error(`Abstraction directory not found: ${abstractionDir}`);
  }

  const abstractionManifestPath = path.join(abstractionDir, ABSTRACTION_MANIFEST_NAME);
  return {
    abstractionManifestPath: (await pathExists(abstractionManifestPath)) ? abstractionManifestPath : null,
    abstractionDir,
  };
}

async function loadExamplesDocument(examplesPath) {
  if (!examplesPath) {
    return {
      examplesPath: null,
      examples: [],
      usedExamples: false,
    };
  }

  const resolvedPath = path.resolve(examplesPath);
  if (!(await pathExists(resolvedPath))) {
    throw new Error(`Examples file not found: ${resolvedPath}`);
  }

  const payload = await readJsonFile(resolvedPath);
  /** @type {ExampleUtterance[]} */
  let examples = [];

  if (Array.isArray(payload)) {
    examples = payload.map((text) => ({ text: String(text) }));
  } else if (Array.isArray(payload?.utterances)) {
    examples = payload.utterances.map((item) => ({
      text: String(item?.text ?? ''),
      intentId: item?.intentId ? String(item.intentId) : undefined,
      targetLabel: item?.targetLabel ? String(item.targetLabel) : undefined,
      aliases: Array.isArray(item?.aliases) ? item.aliases.map((alias) => String(alias)) : undefined,
    }));
  } else {
    throw new Error(`Unsupported examples format in ${resolvedPath}`);
  }

  examples = examples
    .map((example) => ({
      ...example,
      text: cleanDisplayText(example.text),
      targetLabel: example.targetLabel ? cleanDisplayText(example.targetLabel) : undefined,
      aliases: toArray(example.aliases).map((alias) => cleanDisplayText(alias)).filter(Boolean),
    }))
    .filter((example) => example.text);

  return {
    examplesPath: resolvedPath,
    examples,
    usedExamples: examples.length > 0,
  };
}

async function loadAnalysisArtifacts(analysisDirInput, baseDir, warnings) {
  if (!analysisDirInput) {
    return {
      analysisDir: null,
      analysisManifestPath: null,
      analysisManifest: null,
      elementsDocument: { elements: [] },
      statesDocument: { states: [] },
    };
  }

  const analysisDir = path.resolve(analysisDirInput);
  if (!(await pathExists(analysisDir))) {
    warnings.push(buildWarning('analysis_dir_missing', `Analysis directory not found: ${analysisDir}`));
    return {
      analysisDir: null,
      analysisManifestPath: null,
      analysisManifest: null,
      elementsDocument: { elements: [] },
      statesDocument: { states: [] },
    };
  }

  const analysisManifestPath = path.join(analysisDir, ANALYSIS_MANIFEST_NAME);
  const analysisManifest = (await pathExists(analysisManifestPath)) ? await readJsonFile(analysisManifestPath) : null;

  const elementsPath = await firstExistingPath([
    { value: analysisManifest?.files?.elements, baseDir },
    { value: path.join(analysisDir, ELEMENTS_FILE_NAME), baseDir: analysisDir },
  ]);
  const statesPath = await firstExistingPath([
    { value: analysisManifest?.files?.states, baseDir },
    { value: path.join(analysisDir, STATES_FILE_NAME), baseDir: analysisDir },
  ]);

  if (!elementsPath) {
    warnings.push(buildWarning('analysis_elements_missing', `Missing ${ELEMENTS_FILE_NAME} in ${analysisDir}`));
  }
  if (!statesPath) {
    warnings.push(buildWarning('analysis_states_missing', `Missing ${STATES_FILE_NAME} in ${analysisDir}`));
  }

  return {
    analysisDir,
    analysisManifestPath: (await pathExists(analysisManifestPath)) ? analysisManifestPath : null,
    analysisManifest,
    elementsDocument: elementsPath ? await readJsonFile(elementsPath) : { elements: [] },
    statesDocument: statesPath ? await readJsonFile(statesPath) : { states: [] },
  };
}

async function loadAbstractionArtifacts(inputUrl, options) {
  const warnings = [];
  const { abstractionManifestPath, abstractionDir } = await resolveAbstractionInput(options);
  const abstractionManifest = abstractionManifestPath ? await readJsonFile(abstractionManifestPath) : null;

  const intentsPath = await firstExistingPath([
    { value: abstractionManifest?.files?.intents, baseDir: abstractionDir },
    { value: path.join(abstractionDir, INTENTS_FILE_NAME), baseDir: abstractionDir },
  ]);
  const actionsPath = await firstExistingPath([
    { value: abstractionManifest?.files?.actions, baseDir: abstractionDir },
    { value: path.join(abstractionDir, ACTIONS_FILE_NAME), baseDir: abstractionDir },
  ]);
  const decisionTablePath = await firstExistingPath([
    { value: abstractionManifest?.files?.decisionTable, baseDir: abstractionDir },
    { value: path.join(abstractionDir, DECISION_TABLE_FILE_NAME), baseDir: abstractionDir },
  ]);

  if (!intentsPath || !actionsPath || !decisionTablePath) {
    throw new Error(`Abstraction input is incomplete under ${abstractionDir}`);
  }

  const intentsDocument = await readJsonFile(intentsPath);
  const actionsDocument = await readJsonFile(actionsPath);
  const decisionTableDocument = await readJsonFile(decisionTablePath);

  const derivedAnalysisDir = resolveMaybeRelative(abstractionManifest?.source?.analysisDir, abstractionDir);
  const explicitAnalysisDir = options.analysisDir ? path.resolve(options.analysisDir) : null;
  const analysisArtifacts = await loadAnalysisArtifacts(explicitAnalysisDir ?? derivedAnalysisDir, abstractionDir, warnings);
  const examplesArtifacts = await loadExamplesDocument(options.examplesPath);

  const baseUrl = normalizeUrlNoFragment(firstNonEmpty([
    abstractionManifest?.baseUrl,
    intentsDocument?.baseUrl,
    decisionTableDocument?.baseUrl,
    inputUrl,
  ])) ?? inputUrl;

  return {
    inputUrl,
    baseUrl,
    abstractionManifestPath,
    abstractionDir,
    abstractionManifest,
    intentsPath,
    actionsPath,
    decisionTablePath,
    intentsDocument,
    actionsDocument,
    decisionTableDocument,
    analysisDir: analysisArtifacts.analysisDir,
    analysisManifestPath: analysisArtifacts.analysisManifestPath,
    analysisManifest: analysisArtifacts.analysisManifest,
    elementsDocument: analysisArtifacts.elementsDocument,
    statesDocument: analysisArtifacts.statesDocument,
    examplesPath: examplesArtifacts.examplesPath,
    examples: examplesArtifacts.examples,
    usedExamples: examplesArtifacts.usedExamples,
    warnings,
  };
}

function buildIndices(artifacts) {
  const intentsById = new Map();
  const actionsById = new Map();
  const decisionRulesByIntentId = new Map();
  const elementsById = new Map();
  const membersById = new Map();
  const memberIdToElementId = new Map();
  const statesById = new Map();
  const elementStateByStateId = new Map();

  for (const intent of toArray(artifacts.intentsDocument?.intents)) {
    intentsById.set(intent.intentId, intent);
  }

  for (const action of toArray(artifacts.actionsDocument?.actions)) {
    actionsById.set(action.actionId, action);
  }

  for (const rule of toArray(artifacts.decisionTableDocument?.rules)) {
    const bucket = decisionRulesByIntentId.get(rule.intentId) ?? [];
    bucket.push(rule);
    decisionRulesByIntentId.set(rule.intentId, bucket);
  }

  for (const element of toArray(artifacts.elementsDocument?.elements)) {
    elementsById.set(element.elementId, element);
    for (const member of toArray(element.members)) {
      membersById.set(member.memberId, member);
      memberIdToElementId.set(member.memberId, element.elementId);
    }
  }

  for (const state of toArray(artifacts.statesDocument?.states)) {
    statesById.set(state.stateId, state);
    const byElement = new Map();
    for (const elementState of toArray(state.elementStates)) {
      byElement.set(elementState.elementId, elementState);
    }
    elementStateByStateId.set(state.stateId, byElement);
  }

  return {
    intentsById,
    actionsById,
    decisionRulesByIntentId,
    elementsById,
    membersById,
    memberIdToElementId,
    statesById,
    elementStateByStateId,
  };
}

function resolveIntentLabel(intent, element) {
  const localized = INTENT_LANGUAGE_LABELS[intent.intentType];
  return firstNonEmpty([localized?.canonical, intent.intentName, element?.elementName, intent.intentId]) || intent.intentId;
}

function resolveElementCanonical(intent, element) {
  return firstNonEmpty([
    ELEMENT_KIND_LABELS[intent.elementKind]?.canonical,
    element?.elementName,
    intent.sourceElementName,
    intent.elementKind,
  ]) || intent.elementKind;
}

function collectStateDerivedLabels(intent, indices) {
  const labels = new Set();
  for (const stateId of toArray(intent.evidence?.stateIds)) {
    const state = indices.statesById.get(stateId);
    const elementState = state ? indices.elementStateByStateId.get(state.stateId)?.get(intent.elementId) : null;
    if (!elementState?.value) {
      continue;
    }
    if (intent.stateField === 'activeMemberId') {
      const activeLabel = cleanDisplayText(elementState.value.activeMemberLabel);
      if (activeLabel) {
        labels.add(activeLabel);
      }
    }
  }
  return [...labels];
}

function buildIntentContexts(artifacts, indices) {
  const contexts = [];

  for (const intent of toArray(artifacts.intentsDocument?.intents)) {
    const element = indices.elementsById.get(intent.elementId) ?? null;
    const slotName = intent.targetDomain?.parameter ?? 'targetMemberId';
    const rules = toArray(indices.decisionRulesByIntentId.get(intent.intentId));
    const targetRulesByKey = new Map();

    for (const rule of rules) {
      const targetValue = rule?.parameterBinding?.[slotName];
      if (targetValue === undefined) {
        continue;
      }
      const key = stableValueKey(targetValue);
      const bucket = targetRulesByKey.get(key) ?? {
        value: targetValue,
        satisfiedRuleIds: [],
        actRuleIds: [],
        stateIds: new Set(),
        edgeIds: new Set(),
      };
      if (rule.phase === 'satisfied') {
        bucket.satisfiedRuleIds.push(rule.ruleId);
      } else if (rule.phase === 'act') {
        bucket.actRuleIds.push(rule.ruleId);
      }
      for (const stateId of toArray(rule?.expected?.toStateIds)) {
        bucket.stateIds.add(stateId);
      }
      for (const edgeId of toArray(rule?.expected?.edgeIds)) {
        bucket.edgeIds.add(edgeId);
      }
      targetRulesByKey.set(key, bucket);
    }

    const valueRecordsByKey = new Map();
    const seedValueRecord = (value, label, extra = {}) => {
      const key = stableValueKey(value);
      const current = valueRecordsByKey.get(key) ?? {
        value,
        label: null,
        observed: false,
        actionable: false,
        candidate: false,
        stateIds: new Set(),
        edgeIds: new Set(),
        satisfiedRuleIds: [],
        actRuleIds: [],
      };
      current.label = firstNonEmpty([label, current.label]);
      current.observed = current.observed || Boolean(extra.observed);
      current.actionable = current.actionable || Boolean(extra.actionable);
      current.candidate = current.candidate || Boolean(extra.candidate);
      for (const stateId of toArray(extra.stateIds)) {
        current.stateIds.add(stateId);
      }
      for (const edgeId of toArray(extra.edgeIds)) {
        current.edgeIds.add(edgeId);
      }
      valueRecordsByKey.set(key, current);
      return current;
    };

    for (const candidate of toArray(intent.targetDomain?.candidateValues)) {
      seedValueRecord(candidate.value, candidate.label, {
        candidate: true,
        observed: candidate.observed,
      });
    }

    for (const observed of toArray(intent.targetDomain?.observedValues)) {
      seedValueRecord(observed.value, observed.label, {
        candidate: true,
        observed: true,
        stateIds: observed.stateIds,
        edgeIds: observed.edgeIds,
      });
    }

    for (const actionable of toArray(intent.targetDomain?.actionableValues)) {
      seedValueRecord(actionable.value, actionable.label, {
        candidate: true,
        actionable: true,
        edgeIds: actionable.edgeIds,
      });
    }

    if (intent.elementKind === 'tab-group') {
      for (const member of toArray(element?.members)) {
        seedValueRecord(member.memberId, member.label, {
          candidate: true,
          stateIds: member.sourceStateIds,
        });
      }
    }

    for (const stateLabel of collectStateDerivedLabels(intent, indices)) {
      const matching = [...valueRecordsByKey.values()].find((record) => normalizeAliasText(record.label) === normalizeAliasText(stateLabel));
      if (matching && !matching.label) {
        matching.label = stateLabel;
      }
    }

    for (const record of valueRecordsByKey.values()) {
      const bucket = targetRulesByKey.get(stableValueKey(record.value));
      if (bucket) {
        record.satisfiedRuleIds = [...bucket.satisfiedRuleIds].sort(compareNullableStrings);
        record.actRuleIds = [...bucket.actRuleIds].sort(compareNullableStrings);
        for (const stateId of bucket.stateIds) {
          record.stateIds.add(stateId);
        }
        for (const edgeId of bucket.edgeIds) {
          record.edgeIds.add(edgeId);
        }
      }
      if (intent.stateField === 'activeMemberId') {
        const member = indices.membersById.get(String(record.value));
        record.label = firstNonEmpty([record.label, member?.label]);
      } else if (typeof record.value === 'boolean') {
        record.label = null;
      }
    }

    const valueRecords = [...valueRecordsByKey.values()]
      .map((record) => ({
        ...record,
        label: firstNonEmpty([record.label]),
        stateIds: [...record.stateIds].sort(compareNullableStrings),
        edgeIds: [...record.edgeIds].sort(compareNullableStrings),
      }))
      .sort((left, right) => {
        return Number(right.actionable) - Number(left.actionable)
          || Number(right.observed) - Number(left.observed)
          || compareNullableStrings(left.label, right.label)
          || compareNullableStrings(serializeValue(left.value), serializeValue(right.value));
      });

    contexts.push({
      intent,
      element,
      slotName,
      slotValueType: slotName === 'targetMemberId'
        ? 'member-id'
        : slotName === 'queryText'
          ? 'query-string'
          : 'boolean',
      action: indices.actionsById.get(intent.actionId) ?? null,
      localizedIntentName: resolveIntentLabel(intent, element),
      localizedElementName: resolveElementCanonical(intent, element),
      localizedElementAliases: [...new Set([
        ...toArray(ELEMENT_KIND_LABELS[intent.elementKind]?.aliases),
        cleanDisplayText(intent.sourceElementName),
        cleanDisplayText(element?.elementName),
      ].filter(Boolean))],
      valueRecords,
      rules,
      evidenceStateIds: toArray(intent.evidence?.stateIds).sort(compareNullableStrings),
      evidenceEdgeIds: toArray(intent.evidence?.edgeIds).sort(compareNullableStrings),
    });
  }

  return contexts.sort((left, right) => compareNullableStrings(left.intent.intentId, right.intent.intentId));
}

function createLexiconBuilder() {
  const entries = new Map();

  return {
    addEntry(type, canonical, canonicalId, lang) {
      const displayCanonical = cleanDisplayText(canonical) || canonicalId || type;
      const key = [type, canonicalId ?? '', lang ?? '', normalizeAliasText(displayCanonical)].join('::');
      if (!entries.has(key)) {
        entries.set(key, {
          lexiconId: `lex_${createSha256(key).slice(0, 12)}`,
          type,
          canonical: displayCanonical,
          canonicalId: canonicalId ?? null,
          lang: lang ?? 'neutral',
          aliasesMap: new Map(),
        });
      }
      return entries.get(key);
    },
    addAlias(entry, text, source, weight) {
      const displayText = cleanDisplayText(text);
      if (!displayText) {
        return;
      }
      const normalized = normalizeAliasText(displayText);
      if (!normalized) {
        return;
      }
      const current = entry.aliasesMap.get(normalized);
      const candidate = {
        text: displayText,
        normalized,
        source,
        weight,
      };
      if (!current) {
        entry.aliasesMap.set(normalized, candidate);
        return;
      }

      const currentPriority = SOURCE_PRIORITY[current.source] ?? Number.MAX_SAFE_INTEGER;
      const candidatePriority = SOURCE_PRIORITY[candidate.source] ?? Number.MAX_SAFE_INTEGER;
      if (candidatePriority < currentPriority || (candidatePriority === currentPriority && candidate.weight > current.weight)) {
        entry.aliasesMap.set(normalized, candidate);
      }
    },
    finalize() {
      return [...entries.values()]
        .map((entry) => ({
          lexiconId: entry.lexiconId,
          type: entry.type,
          canonical: entry.canonical,
          canonicalId: entry.canonicalId,
          lang: entry.lang,
          aliases: [...entry.aliasesMap.values()].sort((left, right) => {
            return (SOURCE_PRIORITY[left.source] ?? Number.MAX_SAFE_INTEGER) - (SOURCE_PRIORITY[right.source] ?? Number.MAX_SAFE_INTEGER)
              || right.weight - left.weight
              || compareNullableStrings(left.text, right.text);
          }),
        }))
        .sort((left, right) => {
          return compareNullableStrings(left.type, right.type)
            || compareNullableStrings(left.canonical, right.canonical)
            || compareNullableStrings(left.lexiconId, right.lexiconId);
        });
    },
  };
}

function mapExamplesToContexts(contexts, examples, warnings) {
  const singleIntentId = contexts.length === 1 ? contexts[0].intent.intentId : null;
  const byIntent = new Map();
  const byIntentValueKey = new Map();

  for (const example of examples) {
    const resolvedIntentId = example.intentId ?? singleIntentId ?? null;
    if (resolvedIntentId) {
      const bucket = byIntent.get(resolvedIntentId) ?? [];
      bucket.push(example);
      byIntent.set(resolvedIntentId, bucket);
    }

    const normalizedTarget = normalizeAliasText(example.targetLabel);
    if (!normalizedTarget) {
      continue;
    }

    let matched = false;
    for (const context of contexts) {
      if (resolvedIntentId && resolvedIntentId !== context.intent.intentId) {
        continue;
      }
      for (const valueRecord of context.valueRecords) {
        if (normalizeAliasText(valueRecord.label) !== normalizedTarget) {
          continue;
        }
        const key = `${context.intent.intentId}::${stableValueKey(valueRecord.value)}`;
        const bucket = byIntentValueKey.get(key) ?? [];
        bucket.push(example);
        byIntentValueKey.set(key, bucket);
        matched = true;
      }
    }

    if (!matched) {
      warnings.push(buildWarning(
        'example_target_unmatched',
        `Could not match example target "${example.targetLabel}"`,
        { targetLabel: example.targetLabel, intentId: resolvedIntentId },
      ));
    }
  }

  return {
    byIntent,
    byIntentValueKey,
  };
}

function derivePageLexiconTokens(baseUrl, statesDocument) {
  const aliases = new Set();

  try {
    const parsed = new URL(baseUrl);
    const host = parsed.hostname.replace(/^www\./i, '');
    if (host) {
      aliases.add(host);
    }
    for (const segment of parsed.pathname.split('/').filter(Boolean)) {
      aliases.add(segment);
    }
  } catch {
    // ignore invalid url
  }

  const title = firstNonEmpty(toArray(statesDocument?.states).map((state) => state.title));
  if (title) {
    for (const token of title.split(/[\s|_|-]+/u)) {
      const cleaned = cleanDisplayText(token);
      if (cleaned && cleaned.length >= 2) {
        aliases.add(cleaned);
      }
    }
  }

  return [...aliases].sort(compareNullableStrings);
}

function buildLexicon(artifacts, contexts, exampleContext) {
  const builder = createLexiconBuilder();
  const lexiconRefs = {
    verbs: new Map(),
    intents: new Map(),
    elements: new Map(),
    values: new Map(),
    pages: [],
  };

  const addVerbEntry = (canonical, aliases, lang) => {
    const entry = builder.addEntry('verb', canonical, null, lang);
    builder.addAlias(entry, canonical, 'generic', 4);
    for (const alias of aliases) {
      builder.addAlias(entry, alias, 'generic', 3);
    }
    lexiconRefs.verbs.set(`${lang}:${canonical}`, entry.lexiconId);
  };

  addVerbEntry('切换到', ZH_SWITCH_VERBS, 'zh');
  addVerbEntry('打开', ZH_OPEN_VERBS, 'zh');
  addVerbEntry('open', EN_GENERIC_VERBS, 'en');

  for (const context of contexts) {
    const intent = context.intent;
    const intentEntry = builder.addEntry('intent', context.localizedIntentName, intent.intentId, 'zh');
    for (const alias of toArray(INTENT_LANGUAGE_LABELS[intent.intentType]?.aliases)) {
      builder.addAlias(intentEntry, alias, 'generated', 4);
    }
    builder.addAlias(intentEntry, context.localizedIntentName, 'generated', 5);
    builder.addAlias(intentEntry, intent.intentName, 'generated', 3);
    lexiconRefs.intents.set(intent.intentId, intentEntry.lexiconId);

    const intentExamples = exampleContext.byIntent.get(intent.intentId) ?? [];
    for (const example of intentExamples) {
      if (example.targetLabel) {
        continue;
      }
      for (const alias of toArray(example.aliases)) {
        builder.addAlias(intentEntry, alias, 'example', 5);
      }
      builder.addAlias(intentEntry, normalizeMatchText(example.text), 'example', 4);
    }

    const elementEntry = builder.addEntry('element', context.localizedElementName, intent.elementId, 'zh');
    for (const alias of toArray(ELEMENT_KIND_LABELS[intent.elementKind]?.aliases)) {
      builder.addAlias(elementEntry, alias, 'generated', 4);
    }
    for (const alias of context.localizedElementAliases) {
      builder.addAlias(elementEntry, alias, 'generated', 5);
    }
    lexiconRefs.elements.set(intent.elementId, elementEntry.lexiconId);

    for (const valueRecord of context.valueRecords) {
      let canonical;
      let canonicalId;
      if (context.slotName === 'desiredValue') {
        const boolAliases = BOOLEAN_ALIASES[intent.intentType]?.[valueRecord.value];
        canonical = boolAliases?.canonical ?? String(valueRecord.value);
        canonicalId = String(valueRecord.value);
      } else {
        canonical = firstNonEmpty([valueRecord.label, String(valueRecord.value)]);
        canonicalId = String(valueRecord.value);
      }

      const entry = builder.addEntry('value', canonical, canonicalId, 'zh');
      builder.addAlias(entry, canonical, 'generated', 5);
      if (context.slotName === 'desiredValue') {
        const boolAliases = BOOLEAN_ALIASES[intent.intentType]?.[valueRecord.value];
        for (const alias of toArray(boolAliases?.aliases)) {
          builder.addAlias(entry, alias, 'generated', 5);
        }
        for (const alias of toArray(boolAliases?.enAliases)) {
          builder.addAlias(entry, alias, 'generated', 2);
        }
      } else {
        const member = context.element?.members?.find((item) => item.memberId === valueRecord.value);
        builder.addAlias(entry, valueRecord.label, 'generated', valueRecord.actionable ? 5 : 4);
        builder.addAlias(entry, member?.label, 'generated', 4);
      }

      const exampleKey = `${intent.intentId}::${stableValueKey(valueRecord.value)}`;
      const valueExamples = exampleContext.byIntentValueKey.get(exampleKey) ?? [];
      for (const example of valueExamples) {
        for (const alias of toArray(example.aliases)) {
          builder.addAlias(entry, alias, 'example', 5);
        }
        const exampleDerived = extractExampleTargetAlias(example.text);
        if (exampleDerived) {
          builder.addAlias(entry, exampleDerived, 'example', 4);
        }
      }

      lexiconRefs.values.set(`${intent.intentId}::${stableValueKey(valueRecord.value)}`, entry.lexiconId);
    }
  }

  const pageTokens = derivePageLexiconTokens(artifacts.baseUrl, artifacts.statesDocument);
  for (const token of pageTokens) {
    const pageEntry = builder.addEntry('page', token, null, /[a-z]/i.test(token) ? 'neutral' : 'zh');
    builder.addAlias(pageEntry, token, 'generated', 3);
    lexiconRefs.pages.push(pageEntry.lexiconId);
  }

  return {
    document: {
      inputUrl: artifacts.inputUrl,
      baseUrl: artifacts.baseUrl,
      generatedAt: null,
      languageMode: 'zh-primary',
      entries: builder.finalize(),
    },
    refs: lexiconRefs,
  };
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
  const finalOutDir = path.join(outDir, `${stamp}_${host}_nl-entry`);

  return {
    generatedAt,
    outDir: finalOutDir,
    aliasLexiconPath: path.join(finalOutDir, 'alias-lexicon.json'),
    slotSchemaPath: path.join(finalOutDir, 'slot-schema.json'),
    utterancePatternsPath: path.join(finalOutDir, 'utterance-patterns.json'),
    entryRulesPath: path.join(finalOutDir, 'entry-rules.json'),
    clarificationRulesPath: path.join(finalOutDir, 'clarification-rules.json'),
    manifestPath: path.join(finalOutDir, 'nl-entry-manifest.json'),
  };
}

function buildSlotSchemaDocument(artifacts, contexts, valueLexiconRefs, generatedAt) {
  return {
    inputUrl: artifacts.inputUrl,
    baseUrl: artifacts.baseUrl,
    generatedAt,
    intents: contexts.map((context) => ({
      intentId: context.intent.intentId,
      intentType: context.intent.intentType,
      slots: [
        {
          slotName: context.slotName,
          valueType: context.slotValueType,
          required: true,
          source: context.slotName === 'desiredValue'
            ? 'literal-boolean'
            : context.slotName === 'queryText'
              ? 'free-text'
              : 'alias-lexicon',
          domainRef: context.valueRecords
            .map((valueRecord) => valueLexiconRefs.get(`${context.intent.intentId}::${stableValueKey(valueRecord.value)}`))
            .filter(Boolean)
            .sort(compareNullableStrings),
        },
      ],
      context: [
        {
          name: 'currentElementState',
          required: true,
          provider: 'runtime-state',
        },
        {
          name: 'currentStateId',
          required: false,
          provider: 'optional',
        },
      ],
    })),
  };
}

function elementRegexTerms(context) {
  const aliases = [...new Set(context.localizedElementAliases.map((alias) => cleanDisplayText(alias)).filter(Boolean))];
  if (aliases.length === 0) {
    return '标签|栏目|分类|菜单|对话框|弹窗|详情|面板';
  }
  return aliases.map(escapeRegex).sort((left, right) => right.length - left.length).join('|');
}

function booleanRegexTerms(intentType) {
  const source = BOOLEAN_ALIASES[intentType] ?? {};
  const values = [
    ...toArray(source.true?.aliases),
    ...toArray(source.false?.aliases),
  ];
  return [...new Set(values)].map(escapeRegex).sort((left, right) => right.length - left.length).join('|');
}

function buildGeneratedPatternExamples(context, patternType) {
  const firstActionable = context.valueRecords.filter((valueRecord) => valueRecord.actionable).slice(0, 3);
  const fallbackValues = (firstActionable.length > 0 ? firstActionable : context.valueRecords).slice(0, 3);

  if (patternType === 'status-query') {
    return ZH_STATUS_QUERY_EXAMPLES[context.intent.elementKind] ?? ['当前状态是什么'];
  }

  if (context.slotName === 'desiredValue') {
    return fallbackValues.map((valueRecord) => {
      const label = BOOLEAN_ALIASES[context.intent.intentType]?.[valueRecord.value]?.canonical ?? String(valueRecord.value);
      if (patternType === 'explicit-intent') {
        return `${label}${context.localizedElementAliases[0] ?? context.localizedElementName}`;
      }
      return label;
    });
  }

  return fallbackValues.map((valueRecord) => {
    const label = valueRecord.label ?? String(valueRecord.value);
    if (patternType === 'explicit-intent') {
      return `切到${label}`;
    }
    return label;
  });
}

function buildUtterancePatterns(artifacts, contexts, exampleContext, generatedAt) {
  const patterns = [];
  const patternRefs = new Map();

  for (const context of contexts) {
    if (context.evidenceEdgeIds.length === 0 && context.valueRecords.every((valueRecord) => valueRecord.actRuleIds.length === 0)) {
      continue;
    }

    const elementTerms = elementRegexTerms(context);
    const explicitZhRegex = context.slotName === 'targetMemberId'
      ? `^(?:请\\s*)?(?<verb>${[...ZH_SWITCH_VERBS, ...ZH_OPEN_VERBS].map(escapeRegex).join('|')})(?:\\s*一下)?(?:\\s*(?:到|去))?\\s*(?:${elementTerms}\\s*)?(?<targetText>.+?)\\s*(?:${elementTerms})?$`
      : `^(?:请\\s*)?(?:(?<verb>${[...ZH_OPEN_VERBS, ...ZH_SWITCH_VERBS, '设置', '切换', '变为', '设为', '调整为'].map(escapeRegex).join('|')})\\s*)?(?<stateWord>${booleanRegexTerms(context.intent.intentType)})\\s*(?:${elementTerms})?$`;
    const implicitRegex = context.slotName === 'targetMemberId'
      ? `^(?<targetText>.+?)(?:\\s*(?:${elementTerms}))?$`
      : `^(?<stateWord>${booleanRegexTerms(context.intent.intentType)})$`;
    const statusRegex = context.intent.elementKind === 'tab-group'
      ? '^(?:现在|当前)?(?:在|是)?哪个(?:标签|栏目|分类)|^(?:当前|现在)(?:是)?哪个(?:标签|栏目|分类)?$'
      : `^(?:当前|现在).*(?:状态|是否|打开|关闭|展开|收起)|^(?:${elementTerms}).*(?:状态|是否)$`;

    const patternDescriptors = [
      {
        patternType: 'explicit-intent',
        lang: 'zh',
        regex: explicitZhRegex,
        captures: context.slotName === 'targetMemberId'
          ? [
            { name: 'verb', slotName: null },
            { name: 'targetText', slotName: context.slotName },
          ]
          : [
            { name: 'verb', slotName: null },
            { name: 'stateWord', slotName: context.slotName },
          ],
        priority: 10,
      },
      {
        patternType: 'implicit-target',
        lang: 'zh',
        regex: implicitRegex,
        captures: [
          {
            name: context.slotName === 'targetMemberId' ? 'targetText' : 'stateWord',
            slotName: context.slotName,
          },
        ],
        priority: 20,
      },
      {
        patternType: 'status-query',
        lang: 'zh',
        regex: statusRegex,
        captures: [],
        priority: 30,
      },
    ];

    const exampleTexts = exampleContext.byIntent.get(context.intent.intentId) ?? [];
    for (const descriptor of patternDescriptors) {
      const patternId = `pat_${createSha256([
        context.intent.intentId,
        descriptor.patternType,
        descriptor.lang,
        descriptor.regex,
      ].join('::')).slice(0, 12)}`;

      const examples = [
        ...buildGeneratedPatternExamples(context, descriptor.patternType),
        ...exampleTexts.map((item) => item.text),
      ]
        .map((text) => cleanDisplayText(text))
        .filter(Boolean)
        .filter((value, index, array) => array.indexOf(value) === index)
        .slice(0, 8);

      patterns.push({
        patternId,
        intentId: context.intent.intentId,
        patternType: descriptor.patternType,
        lang: descriptor.lang,
        regex: descriptor.regex,
        captures: descriptor.captures,
        examples,
        priority: descriptor.priority,
      });
      patternRefs.set(`${context.intent.intentId}::${descriptor.patternType}`, patternId);
    }
  }

  return {
    document: {
      inputUrl: artifacts.inputUrl,
      baseUrl: artifacts.baseUrl,
      generatedAt,
      patterns: patterns.sort((left, right) => {
        return compareNullableStrings(left.intentId, right.intentId)
          || left.priority - right.priority
          || compareNullableStrings(left.patternId, right.patternId);
      }),
    },
    refs: patternRefs,
  };
}

function buildGeneratedPatternExamplesV2(context, patternType) {
  const firstActionable = context.valueRecords.filter((valueRecord) => valueRecord.actionable).slice(0, 3);
  const fallbackValues = (firstActionable.length > 0 ? firstActionable : context.valueRecords).slice(0, 3);

  if (patternType === 'status-query') {
    return ZH_STATUS_QUERY_EXAMPLES[context.intent.elementKind] ?? ['当前状态是什么'];
  }

  if (context.slotName === 'desiredValue') {
    return fallbackValues.map((valueRecord) => {
      const label = BOOLEAN_ALIASES[context.intent.intentType]?.[valueRecord.value]?.canonical ?? String(valueRecord.value);
      return patternType === 'explicit-intent'
        ? `${label}${context.localizedElementAliases[0] ?? context.localizedElementName}`
        : label;
    });
  }

  if (context.slotName === 'queryText') {
    return fallbackValues.map((valueRecord) => {
      const label = valueRecord.label ?? String(valueRecord.value);
      return patternType === 'explicit-intent' ? `搜索${label}` : label;
    });
  }

  return fallbackValues.map((valueRecord) => {
    const label = valueRecord.label ?? String(valueRecord.value);
    return patternType === 'explicit-intent' ? `切到${label}` : label;
  });
}

function buildUtterancePatternsV2(artifacts, contexts, exampleContext, generatedAt) {
  const patterns = [];
  const patternRefs = new Map();

  for (const context of contexts) {
    if (context.evidenceEdgeIds.length === 0 && context.valueRecords.every((valueRecord) => valueRecord.actRuleIds.length === 0)) {
      continue;
    }

    const elementTerms = elementRegexTerms(context);
    const explicitZhRegex = context.slotName === 'targetMemberId'
      ? `^(?:请\\s*)?(?<verb>${[...ZH_SWITCH_VERBS, ...ZH_OPEN_VERBS].map(escapeRegex).join('|')})(?:\\s*(?:到|去|打开)?\\s*(?:${elementTerms}\\s*)?(?<targetText>.+?)\\s*(?:${elementTerms})?)$`
      : context.slotName === 'queryText'
        ? `^(?:请\\s*)?(?<verb>${ZH_SEARCH_VERBS.map(escapeRegex).join('|')})\\s*(?<targetText>.+?)$`
        : `^(?:请\\s*)?(?:(?<verb>${[...ZH_OPEN_VERBS, ...ZH_SWITCH_VERBS, '设置', '切换', '变为', '设为', '调整为'].map(escapeRegex).join('|')})\\s*)?(?<stateWord>${booleanRegexTerms(context.intent.intentType)})\\s*(?:${elementTerms})?$`;
    const implicitRegex = context.slotName === 'desiredValue'
      ? `^(?<stateWord>${booleanRegexTerms(context.intent.intentType)})$`
      : `^(?<targetText>.+?)(?:\\s*(?:${elementTerms}))?$`;
    const statusRegex = context.slotName === 'queryText'
      ? '^(?:当前|现在).*(?:搜索|查询).*(?:什么|关键词)|^(?:当前|现在).*(?:搜索词|查询词)$'
      : context.intent.elementKind === 'tab-group'
        ? '^(?:当前|现在).*(?:标签|栏目|分类)'
        : `^(?:当前|现在).*(?:状态|是否|打开|关闭|展开|收起)|^(?:${elementTerms}).*(?:状态|是否)$`;

    const patternDescriptors = [
      {
        patternType: 'explicit-intent',
        lang: 'zh',
        regex: explicitZhRegex,
        captures: context.slotName === 'desiredValue'
          ? [
            { name: 'verb', slotName: null },
            { name: 'stateWord', slotName: context.slotName },
          ]
          : [
            { name: 'verb', slotName: null },
            { name: 'targetText', slotName: context.slotName },
          ],
        priority: 10,
      },
      {
        patternType: 'implicit-target',
        lang: 'zh',
        regex: implicitRegex,
        captures: [
          {
            name: context.slotName === 'desiredValue' ? 'stateWord' : 'targetText',
            slotName: context.slotName,
          },
        ],
        priority: 20,
      },
      {
        patternType: 'status-query',
        lang: 'zh',
        regex: statusRegex,
        captures: [],
        priority: 30,
      },
    ];

    const exampleTexts = exampleContext.byIntent.get(context.intent.intentId) ?? [];
    for (const descriptor of patternDescriptors) {
      const patternId = `pat_${createSha256([
        context.intent.intentId,
        descriptor.patternType,
        descriptor.lang,
        descriptor.regex,
      ].join('::')).slice(0, 12)}`;

      const examples = [
        ...buildGeneratedPatternExamplesV2(context, descriptor.patternType),
        ...exampleTexts.map((item) => item.text),
      ]
        .map((text) => cleanDisplayText(text))
        .filter(Boolean)
        .filter((value, index, array) => array.indexOf(value) === index)
        .slice(0, 8);

      patterns.push({
        patternId,
        intentId: context.intent.intentId,
        patternType: descriptor.patternType,
        lang: descriptor.lang,
        regex: descriptor.regex,
        captures: descriptor.captures,
        examples,
        priority: descriptor.priority,
      });
      patternRefs.set(`${context.intent.intentId}::${descriptor.patternType}`, patternId);
    }
  }

  return {
    document: {
      inputUrl: artifacts.inputUrl,
      baseUrl: artifacts.baseUrl,
      generatedAt,
      patterns: patterns.sort((left, right) => {
        return compareNullableStrings(left.intentId, right.intentId)
          || left.priority - right.priority
          || compareNullableStrings(left.patternId, right.patternId);
      }),
    },
    refs: patternRefs,
  };
}

function buildEntryRules(artifacts, contexts, lexiconRefs, patternRefs, warnings, generatedAt) {
  const rules = [];

  for (const context of contexts) {
    const explicitPatternId = patternRefs.get(`${context.intent.intentId}::explicit-intent`);
    const implicitPatternId = patternRefs.get(`${context.intent.intentId}::implicit-target`);
    const statusPatternId = patternRefs.get(`${context.intent.intentId}::status-query`);
    const intentLexiconId = lexiconRefs.intents.get(context.intent.intentId);
    const elementLexiconId = lexiconRefs.elements.get(context.intent.elementId);
    const slotCapture = context.slotName === 'desiredValue' ? 'stateWord' : 'targetText';

    for (const valueRecord of context.valueRecords) {
      const valueLexiconId = lexiconRefs.values.get(`${context.intent.intentId}::${stableValueKey(valueRecord.value)}`);
      const decisionRuleIds = [...valueRecord.satisfiedRuleIds, ...valueRecord.actRuleIds];
      if (decisionRuleIds.length === 0) {
        continue;
      }

      const commonResolution = {
        slotBindings: {
          [context.slotName]: {
            from: slotCapture,
            value: valueRecord.value,
          },
        },
        targetResolution: context.slotName === 'desiredValue'
          ? 'boolean-literal'
          : context.slotName === 'queryText'
            ? 'free-text'
            : 'alias-exact',
      };
      const commonExpectedRuleIds = decisionRuleIds.sort(compareNullableStrings);
      const note = valueRecord.actRuleIds.length === 0
        ? 'No observed transition action for this target; only satisfied state recognition is supported.'
        : null;

      for (const variant of [
        { name: 'explicit', patternId: explicitPatternId, priority: 10 },
        { name: 'implicit', patternId: implicitPatternId, priority: 20 },
      ]) {
        if (!variant.patternId) {
          continue;
        }
        rules.push({
          entryRuleId: `entry_${createSha256([
            context.intent.intentId,
            variant.name,
            stableValueKey(valueRecord.value),
          ].join('::')).slice(0, 12)}`,
          intentId: context.intent.intentId,
          triggerRefs: {
            patternIds: [variant.patternId],
            lexiconIds: [intentLexiconId, elementLexiconId, valueLexiconId].filter(Boolean),
          },
          resolution: commonResolution,
          contextRequirements: ['currentElementState'],
          outcome: {
            mode: 'plan',
            decisionRuleIds: commonExpectedRuleIds,
            planTemplate: {
              actionId: valueRecord.actRuleIds.length > 0 ? context.intent.actionId : 'noop',
              parameterSlot: context.slotName,
              evaluateBy: 'decision-table:first-match',
              note,
            },
          },
          priority: variant.priority,
        });
      }

      if (statusPatternId && valueRecord.satisfiedRuleIds.length > 0) {
        rules.push({
          entryRuleId: `entry_${createSha256([
            context.intent.intentId,
            'status-query',
            stableValueKey(valueRecord.value),
          ].join('::')).slice(0, 12)}`,
          intentId: context.intent.intentId,
          triggerRefs: {
            patternIds: [statusPatternId],
            lexiconIds: [intentLexiconId, elementLexiconId, valueLexiconId].filter(Boolean),
          },
          resolution: {
            slotBindings: {
              [context.slotName]: {
                from: 'currentElementState',
                value: valueRecord.value,
              },
            },
            targetResolution: 'alias-exact',
          },
          contextRequirements: ['currentElementState'],
          outcome: {
            mode: 'plan',
            decisionRuleIds: [...valueRecord.satisfiedRuleIds].sort(compareNullableStrings),
            planTemplate: {
              actionId: 'noop',
              parameterSlot: context.slotName,
              evaluateBy: 'decision-table:first-match',
              note: 'Status query resolves against the current runtime state.',
            },
          },
          priority: 25,
        });
      }
    }

    rules.push({
      entryRuleId: `entry_${createSha256([context.intent.intentId, 'clarify-missing-slot'].join('::')).slice(0, 12)}`,
      intentId: context.intent.intentId,
      triggerRefs: {
        patternIds: [explicitPatternId, implicitPatternId].filter(Boolean),
        lexiconIds: [intentLexiconId, elementLexiconId].filter(Boolean),
      },
      resolution: {
        slotBindings: {},
        targetResolution: context.slotName === 'desiredValue'
          ? 'boolean-literal'
          : context.slotName === 'queryText'
            ? 'free-text'
            : 'alias-exact',
      },
      contextRequirements: ['currentElementState'],
      outcome: {
        mode: 'clarify',
        decisionRuleIds: [],
        planTemplate: null,
      },
      priority: 30,
    });

    if (context.valueRecords.every((valueRecord) => valueRecord.actRuleIds.length === 0)) {
      warnings.push(buildWarning(
        'intent_without_observed_act',
        `Intent ${context.intent.intentId} has no observed act rules`,
        { intentId: context.intent.intentId },
      ));
    }
  }

  return {
    inputUrl: artifacts.inputUrl,
    baseUrl: artifacts.baseUrl,
    generatedAt,
    rules: rules.sort((left, right) => {
      return compareNullableStrings(left.intentId, right.intentId)
        || left.priority - right.priority
        || compareNullableStrings(left.entryRuleId, right.entryRuleId);
    }),
  };
}

function buildClarificationRulesDocument(artifacts, generatedAt) {
  const rules = [
    {
      clarificationRuleId: `clar_${createSha256('missing-slot').slice(0, 12)}`,
      case: 'missing-slot',
      when: {
        match: 'intent-recognized-slot-missing',
      },
      response: {
        mode: 'ask',
        questionTemplate: '你想切换到哪个目标？我可以列出当前有动作证据的候选项。',
        candidateLimit: 5,
        candidateSource: 'observed-values',
      },
      recovery: {
        expectedSlot: 'targetMemberId|desiredValue|queryText',
        resumeMode: 're-run-entry-rules',
      },
    },
    {
      clarificationRuleId: `clar_${createSha256('ambiguous-target').slice(0, 12)}`,
      case: 'ambiguous-target',
      when: {
        match: 'target-alias-matched-multiple-candidates',
      },
      response: {
        mode: 'ask',
        questionTemplate: '这个说法命中了多个候选项，请选择一个更具体的目标。',
        candidateLimit: 5,
        candidateSource: 'observed-values',
      },
      recovery: {
        expectedSlot: 'targetMemberId|desiredValue|queryText',
        resumeMode: 're-run-entry-rules',
      },
    },
    {
      clarificationRuleId: `clar_${createSha256('unsupported-target').slice(0, 12)}`,
      case: 'unsupported-target',
      when: {
        match: 'target-is-recognized-but-has-no-observed-action-evidence',
      },
      response: {
        mode: 'ask',
        questionTemplate: '这个目标可以识别，但当前没有可执行的动作证据。要不要改成一个已观测到可切换的目标？',
        candidateLimit: 5,
        candidateSource: 'candidate-values',
      },
      recovery: {
        expectedSlot: 'targetMemberId|desiredValue|queryText',
        resumeMode: 're-run-entry-rules',
      },
    },
    {
      clarificationRuleId: `clar_${createSha256('already-satisfied').slice(0, 12)}`,
      case: 'already-satisfied',
      when: {
        match: 'current-state-already-satisfies-target',
      },
      response: {
        mode: 'recover',
        questionTemplate: '当前状态已经满足目标，将返回 noop 计划。',
        candidateLimit: 0,
        candidateSource: 'observed-values',
      },
      recovery: {
        expectedSlot: 'targetMemberId|desiredValue|queryText',
        resumeMode: 're-run-entry-rules',
      },
    },
    {
      clarificationRuleId: `clar_${createSha256('unknown-intent').slice(0, 12)}`,
      case: 'unknown-intent',
      when: {
        match: 'no-intent-lexicon-hit',
      },
      response: {
        mode: 'reject',
        questionTemplate: '我只支持页面内安全的切换、展开、打开类操作。',
        candidateLimit: 0,
        candidateSource: null,
      },
      recovery: {
        expectedSlot: null,
        resumeMode: 're-run-entry-rules',
      },
    },
    {
      clarificationRuleId: `clar_${createSha256('out-of-domain').slice(0, 12)}`,
      case: 'out-of-domain',
      when: {
        match: 'input-is-out-of-supported-domain',
      },
      response: {
        mode: 'reject',
        questionTemplate: '当前页面入口只覆盖安全的切换/展开类意图，不支持提交、删除、购买、上传等高风险动作。',
        candidateLimit: 0,
        candidateSource: null,
      },
      recovery: {
        expectedSlot: null,
        resumeMode: 're-run-entry-rules',
      },
    },
    {
      clarificationRuleId: `clar_${createSha256('search-no-results').slice(0, 12)}`,
      case: 'search-no-results',
      when: {
        match: 'search-returned-no-results',
      },
      response: {
        mode: 'recover',
        questionTemplate: '站内搜索没有命中结果，可以改一个书名继续搜索，或退回站内已发现书籍。',
        candidateLimit: 5,
        candidateSource: 'candidate-values',
      },
      recovery: {
        expectedSlot: 'queryText',
        resumeMode: 're-run-entry-rules',
      },
    },
    {
      clarificationRuleId: `clar_${createSha256('book-ambiguous').slice(0, 12)}`,
      case: 'book-ambiguous',
      when: {
        match: 'book-title-matched-multiple-candidates',
      },
      response: {
        mode: 'ask',
        questionTemplate: '这本书命中了多个候选，请指定更完整的书名。',
        candidateLimit: 5,
        candidateSource: 'observed-values',
      },
      recovery: {
        expectedSlot: 'targetMemberId|queryText',
        resumeMode: 're-run-entry-rules',
      },
    },
    {
      clarificationRuleId: `clar_${createSha256('chapter-not-found').slice(0, 12)}`,
      case: 'chapter-not-found',
      when: {
        match: 'chapter-reference-unmatched',
      },
      response: {
        mode: 'ask',
        questionTemplate: '没有匹配到目标章节，请改用更完整的章节标题或章节序号。',
        candidateLimit: 5,
        candidateSource: 'observed-values',
      },
      recovery: {
        expectedSlot: 'targetMemberId',
        resumeMode: 're-run-entry-rules',
      },
    },
  ];

  return {
    inputUrl: artifacts.inputUrl,
    baseUrl: artifacts.baseUrl,
    generatedAt,
    rules,
  };
}

function buildNlEntryManifest({
  artifacts,
  layout,
  aliasLexiconDocument,
  slotSchemaDocument,
  utterancePatternsDocument,
  entryRulesDocument,
  clarificationRulesDocument,
  warnings,
}) {
  return {
    inputUrl: artifacts.inputUrl,
    baseUrl: artifacts.baseUrl,
    generatedAt: layout.generatedAt,
    outDir: layout.outDir,
    source: {
      abstractionManifest: artifacts.abstractionManifestPath,
      abstractionDir: artifacts.abstractionDir,
      analysisDir: artifacts.analysisDir,
      examplesPath: artifacts.examplesPath,
      usedExamples: artifacts.usedExamples,
    },
    summary: {
      inputIntents: toArray(artifacts.intentsDocument?.intents).length,
      inputActions: toArray(artifacts.actionsDocument?.actions).length,
      inputDecisionRules: toArray(artifacts.decisionTableDocument?.rules).length,
      lexiconEntries: aliasLexiconDocument.entries.length,
      slotSchemas: slotSchemaDocument.intents.length,
      utterancePatterns: utterancePatternsDocument.patterns.length,
      entryRules: entryRulesDocument.rules.length,
      clarificationRules: clarificationRulesDocument.rules.length,
    },
    files: {
      aliasLexicon: layout.aliasLexiconPath,
      slotSchema: layout.slotSchemaPath,
      utterancePatterns: layout.utterancePatternsPath,
      entryRules: layout.entryRulesPath,
      clarificationRules: layout.clarificationRulesPath,
      manifest: layout.manifestPath,
    },
    warnings,
  };
}

export async function buildNlEntry(inputUrl, options = {}) {
  const settings = mergeOptions(options);
  const artifacts = await loadAbstractionArtifacts(inputUrl, settings);
  const warnings = [...artifacts.warnings];
  const indices = buildIndices(artifacts);
  const contexts = buildIntentContexts(artifacts, indices);
  const exampleContext = mapExamplesToContexts(contexts, artifacts.examples, warnings);
  const layout = createOutputLayout(artifacts.baseUrl ?? inputUrl, settings.outDir);

  await mkdir(layout.outDir, { recursive: true });

  const lexicon = buildLexicon(artifacts, contexts, exampleContext);
  lexicon.document.generatedAt = layout.generatedAt;

  const slotSchemaDocument = buildSlotSchemaDocument(artifacts, contexts, lexicon.refs.values, layout.generatedAt);
  const utterancePatterns = buildUtterancePatternsV2(artifacts, contexts, exampleContext, layout.generatedAt);
  const entryRulesDocument = buildEntryRules(artifacts, contexts, lexicon.refs, utterancePatterns.refs, warnings, layout.generatedAt);
  const clarificationRulesDocument = buildClarificationRulesDocument(artifacts, layout.generatedAt);

  const nlEntryManifest = buildNlEntryManifest({
    artifacts,
    layout,
    aliasLexiconDocument: lexicon.document,
    slotSchemaDocument,
    utterancePatternsDocument: utterancePatterns.document,
    entryRulesDocument,
    clarificationRulesDocument,
    warnings,
  });

  await writeJsonFile(layout.aliasLexiconPath, lexicon.document);
  await writeJsonFile(layout.slotSchemaPath, slotSchemaDocument);
  await writeJsonFile(layout.utterancePatternsPath, utterancePatterns.document);
  await writeJsonFile(layout.entryRulesPath, entryRulesDocument);
  await writeJsonFile(layout.clarificationRulesPath, clarificationRulesDocument);
  await writeJsonFile(layout.manifestPath, nlEntryManifest);

  return nlEntryManifest;
}

function printHelp() {
  process.stdout.write(`Usage:
  node nl-entry.mjs <url> --abstraction-manifest <path>
  node nl-entry.mjs <url> --abstraction-dir <dir>

Options:
  --abstraction-manifest <path>  Path to abstraction-manifest.json
  --abstraction-dir <dir>        Directory containing fourth-step outputs
  --analysis-dir <dir>           Optional third-step output directory override
  --examples <path>              Optional example utterance JSON file
  --out-dir <dir>                Root output directory
  --help                         Show this help
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
      case '--abstraction-manifest': {
        const { value, nextIndex } = readValue(current, index);
        options.abstractionManifestPath = value;
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
      case '--examples': {
        const { value, nextIndex } = readValue(current, index);
        options.examplesPath = value;
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
  try {
    const { url, options } = parseCliArgs(process.argv.slice(2));
    if (options.help || !url) {
      printHelp();
      process.exitCode = options.help ? 0 : 1;
      return;
    }

    const manifest = await buildNlEntry(url, options);
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
