// @ts-check

import { createHash } from 'node:crypto';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { initializeCliUtf8 } from '../../infra/cli.mjs';
import { ensureDir, pathExists, readJsonFile, writeJsonFile } from '../../infra/io.mjs';
import {
  loadOptionalManifest,
  resolveStageFiles,
  resolveStageInput,
} from '../artifacts/index.mjs';
import { buildRunManifest, getManifestArtifactDir } from '../engine/run-manifest.mjs';
import { resolveMaybeRelative } from '../../shared/wiki.mjs';
import { resolveSiteNlSemantics } from '../../sites/core/nl-site-semantics.mjs';

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

Object.assign(ZH_STATUS_QUERY_EXAMPLES, {
  'content-link-group': ['当前打开的是哪个作品', '现在在看哪个作品'],
  'author-link-group': ['当前打开的是哪个女优页', '现在在哪个女优页'],
});

Object.assign(INTENT_LANGUAGE_LABELS, {
  'search-work': {
    canonical: '搜索作品',
    aliases: ['搜索作品', '搜索影片', '搜索番号', '查找作品'],
  },
  'open-work': {
    canonical: '打开作品',
    aliases: ['打开作品', '查看作品', '打开影片', '查看影片', '打开番号'],
  },
  'open-actress': {
    canonical: '打开女优页',
    aliases: ['打开女优页', '查看女优', '进入女优页', '打开演员页'],
  },
  'list-category-videos': {
    canonical: '分类榜单查询',
    aliases: ['分类榜单查询', '标签榜单查询', '分类推荐查询', '标签推荐查询', '分类前几条', '标签前几条'],
  },
});

Object.assign(ELEMENT_KIND_LABELS, {
  'content-link-group': {
    canonical: '作品',
    aliases: ['作品', '影片', '番号', '详情', '书籍', '小说'],
  },
  'author-link-group': {
    canonical: '女优',
    aliases: ['女优', '演员', '女优页', '作者', '作者页'],
  },
});

ZH_OPEN_VERBS.push('下载', '导出');
INTENT_LANGUAGE_LABELS['download-book'] = {
  canonical: '下载书籍',
  aliases: ['下载书籍', '下载小说', '导出小说', '保存整本', '保存全文'],
};

function getHostnameFromUrl(inputUrl) {
  try {
    const parsed = new URL(inputUrl);
    return parsed.hostname.toLowerCase();
  } catch {
    return '';
  }
}

function isMoodyzHost(inputUrl) {
  const host = getHostnameFromUrl(inputUrl).replace(/^www\./i, '');
  return host === 'moodyz.com';
}

function isJableHost(inputUrl) {
  const host = getHostnameFromUrl(inputUrl).replace(/^www\./i, '');
  return host === 'jable.tv';
}

const DEFAULT_SITE_SEMANTICS = {
  siteKey: 'generic',
  intentLabels: INTENT_LANGUAGE_LABELS,
  elementLabels: ELEMENT_KIND_LABELS,
  statusExamples: ZH_STATUS_QUERY_EXAMPLES,
  searchQueryNouns: ['搜索', '查找', '搜'],
  clarificationRules: [],
};

const MOODYZ_SITE_SEMANTICS = {
  siteKey: 'moodyz',
  intentLabels: {
    ...INTENT_LANGUAGE_LABELS,
    'search-work': {
      canonical: '搜索作品',
      aliases: ['搜索作品', '查找作品', '搜作品', '找作品', '搜索番号', '查找番号'],
    },
    'open-work': {
      canonical: '打开作品',
      aliases: ['打开作品', '查看作品', '进入作品', '打开影片', '查看影片', '打开番号'],
    },
    'open-actress': {
      canonical: '打开女优页',
      aliases: ['打开女优页', '查看女优', '进入女优页', '打开演员页', '查看女优页'],
    },
  },
  elementLabels: {
    ...ELEMENT_KIND_LABELS,
    'content-link-group': {
      canonical: '作品',
      aliases: ['作品', '影片', '番号', '作品详情', '作品页'],
    },
    'author-link-group': {
      canonical: '女优',
      aliases: ['女优', '演员', '女优页', '女优详情', '演员页'],
    },
    'search-form-group': {
      canonical: '搜索作品',
      aliases: ['搜索作品', '查找作品', '搜作品', '找作品'],
    },
    'category-link-group': {
      canonical: '作品列表',
      aliases: ['作品列表', '按日期', '按分类', '列表', '搜索结果', '分类'],
    },
    'utility-link-group': {
      canonical: '功能页',
      aliases: ['首页', '功能页', '返回首页', '阅读记录'],
    },
  },
  statusExamples: {
    ...ZH_STATUS_QUERY_EXAMPLES,
    'content-link-group': ['现在打开的是哪部作品', '当前在看哪部作品', '当前页是哪部作品详情'],
    'author-link-group': ['现在打开的是哪个女优页', '当前在看哪个女优', '当前页是哪位女优详情'],
    'search-form-group': ['当前搜索的是哪部作品', '现在的搜索词是什么', '现在检索的是哪部作品'],
  },
  searchQueryNouns: ['作品', '女优', '演员', '番号'],
  clarificationRules: [
    {
      clarificationRuleId: `clar_${createSha256('moodyz-search-target-ambiguous').slice(0, 12)}`,
      case: 'search-target-ambiguous',
      when: {
        match: 'moodyz-search-target-could-be-work-or-actress',
      },
      response: {
        mode: 'ask',
        questionTemplate: '这个名字既可能是作品，也可能是女优。你要继续按“作品”还是“女优”处理？',
        candidateLimit: 5,
        candidateSource: 'observed-values',
      },
      recovery: {
        expectedSlot: 'queryText|targetMemberId',
        resumeMode: 're-run-entry-rules',
      },
    },
    {
      clarificationRuleId: `clar_${createSha256('moodyz-search-results-disambiguation').slice(0, 12)}`,
      case: 'search-result-disambiguation',
      when: {
        match: 'moodyz-search-result-needs-disambiguation',
      },
      response: {
        mode: 'ask',
        questionTemplate: '搜索结果里同时有作品和女优候选。你想优先筛作品还是女优？',
        candidateLimit: 5,
        candidateSource: 'observed-values',
      },
      recovery: {
        expectedSlot: 'queryText',
        resumeMode: 're-run-entry-rules',
      },
    },
    {
      clarificationRuleId: `clar_${createSha256('moodyz-work-actress-ambiguous').slice(0, 12)}`,
      case: 'work-actress-ambiguous',
      when: {
        match: 'moodyz-target-matches-work-and-actress',
      },
      response: {
        mode: 'ask',
        questionTemplate: '这个词同时可能指向作品和女优，请明确你要打开哪一类。',
        candidateLimit: 5,
        candidateSource: 'observed-values',
      },
      recovery: {
        expectedSlot: 'targetMemberId|queryText',
        resumeMode: 're-run-entry-rules',
      },
    },
  ],
};

const JABLE_SITE_SEMANTICS = {
  siteKey: 'jable',
  intentLabels: {
    ...INTENT_LANGUAGE_LABELS,
    'search-video': {
      canonical: '搜索影片',
      aliases: ['搜索影片', '搜索视频', '查找影片', '搜索番号', '搜番号', '找影片'],
    },
    'open-video': {
      canonical: '打开影片',
      aliases: ['打开影片', '查看影片', '打开视频', '查看视频', '打开番号', '进入影片'],
    },
    'open-model': {
      canonical: '打开演员页',
      aliases: ['打开演员页', '查看演员页', '打开女優页', '查看女優页', '打开模特页'],
    },
    'open-category': {
      canonical: '打开分类页',
      aliases: ['打开分类', '查看分类', '打开标签', '查看标签', '打开热门', '查看热门', '打开最新更新', '查看最新更新', '打开演员列表', '查看演员列表'],
    },
    'list-category-videos': {
      canonical: '分类榜单查询',
      aliases: [
        '分类榜单查询',
        '标签榜单查询',
        '分类推荐',
        '标签推荐',
        '分类前几条',
        '标签前几条',
        '近期最佳推荐',
        '最近更新前几条',
        '最多观看前几条',
        '最高收藏前几条',
      ],
    },
  },
  elementLabels: {
    ...ELEMENT_KIND_LABELS,
    'content-link-group': {
      canonical: '影片',
      aliases: ['影片', '视频', '番号', '影片详情', '视频页'],
    },
    'author-link-group': {
      canonical: '演员',
      aliases: ['演员', '女優', '模特', '演员页', '女優页'],
    },
    'search-form-group': {
      canonical: '搜索影片',
      aliases: ['搜索影片', '搜索视频', '搜番号', '搜索'],
    },
    'category-link-group': {
      canonical: '分类列表',
      aliases: ['分类', '分类页', '标签', '标签页', '热门', '最新更新', '演员列表', '搜索结果'],
    },
    'utility-link-group': {
      canonical: '功能页',
      aliases: ['功能页', '搜索页'],
    },
  },
  statusExamples: {
    ...ZH_STATUS_QUERY_EXAMPLES,
    'category-link-group': ['当前打开的是哪个分类页', '现在是在标签页还是热门页', '当前是在演员列表还是最新更新'],
    'content-link-group': ['当前打开的是哪部影片', '现在在看哪个番号', '当前页是哪部视频详情'],
    'author-link-group': ['当前打开的是哪个演员页', '现在在看哪个女優', '当前页是哪位演员详情'],
    'search-form-group': ['当前搜索的是哪部影片', '现在的搜索词是什么', '现在检索的是哪个番号'],
  },
  searchQueryNouns: ['影片', '视频', '番号', '演员', '女優', '分类', '标签', '热门', '最新更新'],
  clarificationRules: [
    {
      clarificationRuleId: `clar_${createSha256('jable-category-target-unknown').slice(0, 12)}`,
      case: 'category-target-unknown',
      when: {
        match: 'jable-taxonomy-target-not-found',
      },
      response: {
        mode: 'ask',
        questionTemplate: '这个分类或标签当前不在已抽取 taxonomy 里。要不要换成更接近的已知标签或一级分类组？',
        candidateLimit: 8,
        candidateSource: 'observed-values',
      },
      recovery: {
        expectedSlot: 'targetMemberId',
        resumeMode: 're-run-entry-rules',
      },
    },
  ],
};

export function resolveSiteSemantics(baseUrl, siteProfileDocument = null) {
  return resolveSiteNlSemantics({
    baseUrl,
    siteProfileDocument,
    deps: {
      INTENT_LANGUAGE_LABELS,
      ELEMENT_KIND_LABELS,
      ZH_STATUS_QUERY_EXAMPLES,
      ZH_SEARCH_VERBS,
      ZH_OPEN_VERBS,
      createSha256,
      cleanDisplayText,
    },
  }) ?? DEFAULT_SITE_SEMANTICS;
}

function siteAwareIntentLabel(intentType, semantics = DEFAULT_SITE_SEMANTICS) {
  return semantics.intentLabels?.[intentType] ?? INTENT_LANGUAGE_LABELS[intentType] ?? null;
}

function siteAwareElementLabel(elementKind, semantics = DEFAULT_SITE_SEMANTICS) {
  return semantics.elementLabels?.[elementKind] ?? ELEMENT_KIND_LABELS[elementKind] ?? null;
}

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

const JABLE_TRADITIONAL_TO_SIMPLIFIED = new Map([
  ['絲', '丝'], ['過', '过'], ['襪', '袜'], ['運', '运'], ['裝', '装'], ['鏡', '镜'], ['獸', '兽'],
  ['漁', '渔'], ['紗', '纱'], ['僕', '仆'], ['帶', '带'], ['點', '点'], ['電', '电'], ['處', '处'],
  ['獄', '狱'], ['溫', '温'], ['圖', '图'], ['書', '书'], ['館', '馆'], ['顏', '颜'], ['腳', '脚'],
  ['風', '风'], ['醫', '医'], ['護', '护'], ['隊', '队'], ['經', '经'], ['屬', '属'], ['貞', '贞'],
  ['復', '复'], ['齡', '龄'], ['藥', '药'], ['體', '体'], ['貧', '贫'], ['紋', '纹'], ['髮', '发'],
  ['調', '调'], ['綑', '捆'], ['劇', '剧'], ['婦', '妇'], ['優', '优'], ['藝', '艺'], ['視', '视'],
]);

const JABLE_SIMPLIFIED_TO_TRADITIONAL = new Map(
  [...JABLE_TRADITIONAL_TO_SIMPLIFIED.entries()].map(([traditional, simplified]) => [simplified, traditional]),
);

function mapCharacters(value, mapping) {
  return [...String(value ?? '')].map((char) => mapping.get(char) ?? char).join('');
}

function buildJableTargetAliases(label, scopeType = 'tag') {
  const base = cleanDisplayText(String(label ?? '').replace(/^#+/u, ''));
  if (!base) {
    return [];
  }
  const aliases = new Set([base]);
  if (scopeType === 'tag') {
    aliases.add(`#${base}`);
    aliases.add(`${base}标签`);
    aliases.add(`${base}分类`);
    aliases.add(`${base}分類`);
  } else if (scopeType === 'group') {
    aliases.add(`${base}分类`);
    aliases.add(`${base}分類`);
    aliases.add(`按${base}`);
  }
  const simplified = cleanDisplayText(mapCharacters(base, JABLE_TRADITIONAL_TO_SIMPLIFIED));
  const traditional = cleanDisplayText(mapCharacters(base, JABLE_SIMPLIFIED_TO_TRADITIONAL));
  for (const variant of [simplified, traditional]) {
    if (!variant || variant === base) {
      continue;
    }
    aliases.add(variant);
    if (scopeType === 'tag') {
      aliases.add(`#${variant}`);
      aliases.add(`${variant}标签`);
      aliases.add(`${variant}分类`);
      aliases.add(`${variant}分類`);
    } else if (scopeType === 'group') {
      aliases.add(`${variant}分类`);
      aliases.add(`${variant}分類`);
      aliases.add(`按${variant}`);
    }
  }
  if (/^cosplay$/iu.test(base)) {
    aliases.add('Cosplay');
    aliases.add('cosplay');
    aliases.add('#Cosplay');
    aliases.add('#cosplay');
    aliases.add('Cosplay标签');
  }
  return [...aliases].filter(Boolean);
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
  const { manifestPath: abstractionManifestPath, dir: abstractionDir } = await resolveStageInput(options, {
    manifestOption: 'abstractionManifestPath',
    dirOption: 'abstractionDir',
    manifestName: ABSTRACTION_MANIFEST_NAME,
    missingArgsMessage: 'Pass abstractionManifestPath, --abstraction-manifest, abstractionDir, or --abstraction-dir.',
    missingManifestMessagePrefix: 'Abstraction manifest not found: ',
    missingDirMessagePrefix: 'Abstraction directory not found: ',
  });
  return {
    abstractionManifestPath,
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
      siteProfilePath: null,
      siteProfileDocument: null,
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
      siteProfilePath: null,
      siteProfileDocument: null,
      elementsDocument: { elements: [] },
      statesDocument: { states: [] },
    };
  }

  const analysisManifestPath = path.join(analysisDir, ANALYSIS_MANIFEST_NAME);
  const analysisManifest = (await pathExists(analysisManifestPath)) ? await readJsonFile(analysisManifestPath) : null;

  const files = await resolveStageFiles({
    manifest: analysisManifest,
    manifestDir: baseDir,
    dir: analysisDir,
    files: {
      elementsPath: { manifestField: 'elements', defaultFileName: ELEMENTS_FILE_NAME },
      statesPath: { manifestField: 'states', defaultFileName: STATES_FILE_NAME },
      siteProfilePath: { manifestField: 'siteProfile', defaultFileName: 'site-profile.json' },
    },
  });

  if (!files.elementsPath) {
    warnings.push(buildWarning('analysis_elements_missing', `Missing ${ELEMENTS_FILE_NAME} in ${analysisDir}`));
  }
  if (!files.statesPath) {
    warnings.push(buildWarning('analysis_states_missing', `Missing ${STATES_FILE_NAME} in ${analysisDir}`));
  }

  return {
    analysisDir,
    analysisManifestPath: (await pathExists(analysisManifestPath)) ? analysisManifestPath : null,
    analysisManifest,
    siteProfilePath: files.siteProfilePath ?? null,
    siteProfileDocument: files.siteProfilePath ? await readJsonFile(files.siteProfilePath) : null,
    elementsDocument: files.elementsPath ? await readJsonFile(files.elementsPath) : { elements: [] },
    statesDocument: files.statesPath ? await readJsonFile(files.statesPath) : { states: [] },
  };
}

async function loadAbstractionArtifacts(inputUrl, options) {
  const warnings = [];
  const { abstractionManifestPath, abstractionDir } = await resolveAbstractionInput(options);
  const abstractionManifest = await loadOptionalManifest(abstractionManifestPath);

  const abstractionFiles = await resolveStageFiles({
    manifest: abstractionManifest,
    manifestDir: abstractionDir,
    dir: abstractionDir,
    files: {
      intentsPath: { manifestField: 'intents', defaultFileName: INTENTS_FILE_NAME },
      actionsPath: { manifestField: 'actions', defaultFileName: ACTIONS_FILE_NAME },
      decisionTablePath: { manifestField: 'decisionTable', defaultFileName: DECISION_TABLE_FILE_NAME },
    },
  });

  if (!abstractionFiles.intentsPath || !abstractionFiles.actionsPath || !abstractionFiles.decisionTablePath) {
    throw new Error(`Abstraction input is incomplete under ${abstractionDir}`);
  }

  const intentsDocument = await readJsonFile(abstractionFiles.intentsPath);
  const actionsDocument = await readJsonFile(abstractionFiles.actionsPath);
  const decisionTableDocument = await readJsonFile(abstractionFiles.decisionTablePath);

  const derivedAnalysisDir = getManifestArtifactDir(abstractionManifest, 'analysis', abstractionDir);
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
    intentsPath: abstractionFiles.intentsPath,
    actionsPath: abstractionFiles.actionsPath,
    decisionTablePath: abstractionFiles.decisionTablePath,
    intentsDocument,
    actionsDocument,
    decisionTableDocument,
    analysisDir: analysisArtifacts.analysisDir,
    analysisManifestPath: analysisArtifacts.analysisManifestPath,
    analysisManifest: analysisArtifacts.analysisManifest,
    siteProfilePath: analysisArtifacts.siteProfilePath,
    siteProfileDocument: analysisArtifacts.siteProfileDocument,
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

function resolveIntentLabel(intent, element, semantics = DEFAULT_SITE_SEMANTICS) {
  const localized = siteAwareIntentLabel(intent.intentType, semantics);
  return firstNonEmpty([localized?.canonical, intent.intentName, element?.elementName, intent.intentId]) || intent.intentId;
}

function resolveElementCanonical(intent, element, semantics = DEFAULT_SITE_SEMANTICS) {
  const localized = siteAwareElementLabel(intent.elementKind, semantics);
  return firstNonEmpty([
    localized?.canonical,
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

function buildIntentContexts(artifacts, indices, semantics = DEFAULT_SITE_SEMANTICS) {
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
      localizedIntentName: resolveIntentLabel(intent, element, semantics),
      localizedElementName: resolveElementCanonical(intent, element, semantics),
      localizedElementAliases: [...new Set([
        ...toArray(siteAwareElementLabel(intent.elementKind, semantics)?.aliases),
        cleanDisplayText(intent.sourceElementName),
        cleanDisplayText(element?.elementName),
      ].filter(Boolean))],
      extraSlots: intent.intentType === 'list-category-videos'
        ? [
            { slotName: 'sortMode', valueType: 'enum', required: false, source: 'intent-derived', defaultValue: intent.defaults?.sortMode ?? 'combined' },
            { slotName: 'limit', valueType: 'number', required: false, source: 'intent-derived', defaultValue: intent.defaults?.limit ?? 3 },
            { slotName: 'scopeType', valueType: 'enum', required: false, source: 'taxonomy', defaultValue: 'tag' },
          ]
        : [],
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

function buildLexicon(artifacts, contexts, exampleContext, semantics = DEFAULT_SITE_SEMANTICS) {
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
    for (const alias of toArray(siteAwareIntentLabel(intent.intentType, semantics)?.aliases)) {
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
    for (const alias of toArray(siteAwareElementLabel(intent.elementKind, semantics)?.aliases)) {
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
        if (typeof semantics.targetAliases === 'function' && ['open-category', 'list-category-videos'].includes(intent.intentType)) {
          for (const alias of semantics.targetAliases(valueRecord.label, valueRecord.scopeType ?? 'tag', { intent, valueRecord })) {
            builder.addAlias(entry, alias, 'generated', 5);
          }
        }
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
        ...toArray(context.extraSlots).map((slot) => ({
          slotName: slot.slotName,
          valueType: slot.valueType,
          required: Boolean(slot.required),
          source: slot.source,
          defaultValue: slot.defaultValue,
          ...(slot.slotName === 'sortMode'
            ? { allowedValues: ['combined', 'recent', 'most-viewed', 'most-favourited'] }
            : {}),
        })),
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

  if (semantics.siteKey === 'jable' && context.intent.intentType === 'list-category-videos') {
    return fallbackValues.map((valueRecord, index) => {
      const label = valueRecord.label ?? String(valueRecord.value);
      const examples = [
        `${label}分类，近期最佳推荐三部`,
        `${label}标签最近更新前五条`,
        `${label}最高收藏前三`,
      ];
      return patternType === 'explicit-intent' ? examples[index % examples.length] : label;
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
          ...(context.intent.intentType === 'list-category-videos'
            ? {
                sortMode: {
                  from: 'sortText',
                  normalizeAs: 'jable-sort-mode',
                  defaultValue: context.intent.defaults?.sortMode ?? 'combined',
                },
                limit: {
                  from: 'limitText',
                  normalizeAs: 'zh-number',
                  defaultValue: context.intent.defaults?.limit ?? 3,
                },
                scopeType: {
                  from: 'taxonomy',
                  value: valueRecord.scopeType ?? 'tag',
                },
              }
            : {}),
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
        : context.intent.intentType === 'list-category-videos'
          ? 'Resolve the taxonomy target, open the visible category or tag page, apply the requested sort mode, and extract the top-ranked video cards.'
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

function buildGeneratedPatternExamplesV3(context, patternType, semantics = DEFAULT_SITE_SEMANTICS) {
  const firstActionable = context.valueRecords.filter((valueRecord) => valueRecord.actionable).slice(0, 3);
  const fallbackValues = (firstActionable.length > 0 ? firstActionable : context.valueRecords).slice(0, 3);
  const siteSpecificExamples = typeof semantics.buildGeneratedPatternExamples === 'function'
    ? semantics.buildGeneratedPatternExamples(context, patternType, fallbackValues)
    : null;
  if (Array.isArray(siteSpecificExamples) && siteSpecificExamples.length > 0) {
    return siteSpecificExamples;
  }

  if (patternType === 'status-query') {
    return semantics.statusExamples?.[context.intent.elementKind] ?? ZH_STATUS_QUERY_EXAMPLES[context.intent.elementKind] ?? ['当前状态是什么'];
  }

  if (context.slotName === 'desiredValue') {
    return fallbackValues.map((valueRecord) => {
      const label = BOOLEAN_ALIASES[context.intent.intentType]?.[valueRecord.value]?.canonical ?? String(valueRecord.value);
      if (patternType !== 'explicit-intent') {
        return label;
      }
      return `${label}${context.localizedElementAliases[0] ?? context.localizedElementName}`;
    });
  }

  if (context.slotName === 'queryText') {
    return fallbackValues.map((valueRecord) => {
      const label = valueRecord.label ?? String(valueRecord.value);
      if (semantics.siteKey === 'moodyz' || semantics.siteKey === 'jable') {
        if (context.intent.intentType === 'search-work') {
          return patternType === 'explicit-intent' ? `搜索作品${label}` : label;
        }
        if (context.intent.intentType === 'search-video') {
          return patternType === 'explicit-intent' ? `搜索影片${label}` : label;
        }
        return patternType === 'explicit-intent' ? `搜索${label}` : label;
      }
      return patternType === 'explicit-intent' ? `搜索${label}` : label;
    });
  }

  return fallbackValues.map((valueRecord) => {
    const label = valueRecord.label ?? String(valueRecord.value);
    if (semantics.siteKey === 'moodyz') {
      if (context.intent.intentType === 'open-actress') {
        return patternType === 'explicit-intent' ? `打开女优页${label}` : label;
      }
      if (context.intent.intentType === 'open-work') {
        return patternType === 'explicit-intent' ? `打开作品${label}` : label;
      }
      if (context.intent.intentType === 'search-work') {
        return patternType === 'explicit-intent' ? `搜索作品${label}` : label;
      }
    }
    if (semantics.siteKey === 'jable') {
      if (context.intent.intentType === 'open-model') {
        return patternType === 'explicit-intent' ? `打开演员页${label}` : label;
      }
      if (context.intent.intentType === 'open-video') {
        return patternType === 'explicit-intent' ? `打开影片${label}` : label;
      }
      if (context.intent.intentType === 'search-video') {
        return patternType === 'explicit-intent' ? `搜索影片${label}` : label;
      }
    }
    return patternType === 'explicit-intent' ? `打开${label}` : label;
  });
}

function buildUtterancePatternsV3(artifacts, contexts, exampleContext, generatedAt, semantics = DEFAULT_SITE_SEMANTICS) {
  const patterns = [];
  const patternRefs = new Map();

  for (const context of contexts) {
    if (context.evidenceEdgeIds.length === 0 && context.valueRecords.every((valueRecord) => valueRecord.actRuleIds.length === 0)) {
      continue;
    }

    const elementTerms = elementRegexTerms(context);
    const nounTerms = Array.isArray(semantics.searchQueryNouns) && semantics.searchQueryNouns.length > 0
      ? `(?:${(semantics.searchQueryNouns ?? ['作品', '影片', '视频', '女优', '演员', '番号']).map(escapeRegex).join('|')})`
      : '';
    const searchVerbTerms = semantics.siteKey === 'moodyz'
      ? [...ZH_SEARCH_VERBS, '搜索作品', '搜索女优', '查找作品', '查找女优', '搜作品', '搜女优']
      : semantics.siteKey === 'jable'
        ? [...ZH_SEARCH_VERBS, '搜索影片', '搜索视频', '搜索番号', '查找影片', '查找视频', '搜番号']
      : ZH_SEARCH_VERBS;
    const openVerbTerms = semantics.siteKey === 'moodyz'
      ? [...ZH_OPEN_VERBS, '打开作品', '查看作品', '打开女优页', '查看女优', '进入作品', '进入女优页']
      : semantics.siteKey === 'jable'
        ? [...ZH_OPEN_VERBS, '打开影片', '查看影片', '打开视频', '查看视频', '打开演员页', '查看演员', '打开女優页', '查看女優']
      : [...ZH_OPEN_VERBS, ...ZH_SWITCH_VERBS];
    const explicitZhRegex = context.intent.intentType === 'list-category-videos'
      ? '^(?:请\\s*)?(?<targetText>.+?)(?:\\s*(?:标签|分類|分类|分类页|标签页))?(?:\\s*[,，]\\s*|\\s+)?(?:(?<sortText>近期最佳推荐|最佳推荐|推荐|最近更新|最近|近期|最多观看|最热|最高收藏|收藏最多)\\s*)?(?:(?:前)?(?<limitText>[0-9一二三四五六七八九十两]+)(?:部|条|個|个))?$'
      : context.slotName === 'queryText'
      ? `^(?:请\\s*)?(?<verb>${searchVerbTerms.map(escapeRegex).join('|')})\\s*(?:${nounTerms}\\s*)?(?<targetText>.+?)$`
      : context.slotName === 'targetMemberId'
        ? `^(?:请\\s*)?(?<verb>${openVerbTerms.map(escapeRegex).join('|')})(?:\\s*(?:到|去|打开)?\\s*(?:${elementTerms}\\s*)?(?<targetText>.+?)\\s*(?:${elementTerms})?)$`
        : `^(?:请\\s*)?(?:(?<verb>${[...ZH_OPEN_VERBS, ...ZH_SWITCH_VERBS, '设置', '切换', '变为', '设为', '调整为'].map(escapeRegex).join('|')})\\s*)?(?<stateWord>${booleanRegexTerms(context.intent.intentType)})\\s*(?:${elementTerms})?$`;
    const implicitRegex = context.intent.intentType === 'list-category-videos'
      ? '^(?<targetText>.+?)(?:\\s*(?:标签|分類|分类))?$'
      : context.slotName === 'targetMemberId'
      ? `^(?<targetText>.+?)(?:\\s*(?:${elementTerms}))?$`
      : context.slotName === 'queryText'
        ? `^(?:${nounTerms})?\\s*(?<targetText>.+?)$`
        : `^(?<stateWord>${booleanRegexTerms(context.intent.intentType)})$`;
    const statusRegex = context.intent.elementKind === 'tab-group'
      ? '^(?:现在|当前)?(?:是|在)?(?:哪个(?:标签|栏目|分类)|当前(?:是|在)?哪个(?:标签|栏目|分类)?)$'
      : `^(?:当前|现在).*(?:状态|是否|打开|关闭|展开|收起)|^(?:${elementTerms}).*(?:状态|是否)$`;

    const patternDescriptors = [
      {
        patternType: 'explicit-intent',
        lang: 'zh',
        regex: explicitZhRegex,
        captures: context.intent.intentType === 'list-category-videos'
          ? [
              { name: 'targetText', slotName: context.slotName },
              { name: 'sortText', slotName: 'sortMode' },
              { name: 'limitText', slotName: 'limit' },
            ]
          : context.slotName === 'targetMemberId' || context.slotName === 'queryText'
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
            name: context.slotName === 'targetMemberId' || context.slotName === 'queryText' ? 'targetText' : 'stateWord',
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
        ...buildGeneratedPatternExamplesV3(context, descriptor.patternType, semantics),
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

function buildClarificationRulesDocumentV2(artifacts, generatedAt, semantics = DEFAULT_SITE_SEMANTICS) {
  const baseDocument = buildClarificationRulesDocument(artifacts, generatedAt);
  const seen = new Set();
  const rules = baseDocument.rules.map((rule) => {
    const cloned = {
      ...rule,
      response: {
        ...rule.response,
      },
      recovery: {
        ...rule.recovery,
      },
    };

    if (semantics.siteKey === 'moodyz') {
      if (cloned.case === 'missing-slot') {
        cloned.response.questionTemplate = '你要找哪部作品或哪个女优？我可以列出当前有动作证据的候选项。';
      } else if (cloned.case === 'ambiguous-target') {
        cloned.response.questionTemplate = '这个说法可能对应多部作品或多个女优，请给我更具体的作品名或女优名。';
      } else if (cloned.case === 'unsupported-target') {
        cloned.response.questionTemplate = '这个作品或女优可以识别，但当前没有可执行的动作证据。要不要换一个已观察到可打开的目标？';
      } else if (cloned.case === 'book-ambiguous') {
        cloned.response.questionTemplate = '这个名字既可能是作品，也可能是女优，请明确你要打开哪一类。';
      } else if (cloned.case === 'search-no-results') {
        cloned.response.questionTemplate = '站内没有命中该作品结果，可以换一个更具体的作品名，或者改为女优名继续搜索。';
      } else if (cloned.case === 'chapter-not-found') {
        cloned.response.questionTemplate = '没有匹配到目标章节，请提供更完整的章节标题或章节序号。';
      }
    }
    if (semantics.siteKey === 'jable') {
      if (cloned.case === 'missing-slot') {
        cloned.response.questionTemplate = '你要找哪部影片或哪个演员？我可以列出当前有动作证据的候选项。';
      } else if (cloned.case === 'ambiguous-target') {
        cloned.response.questionTemplate = '这个说法可能对应多部影片或多个演员，请给我更具体的番号、片名或演员名。';
      } else if (cloned.case === 'unsupported-target') {
        cloned.response.questionTemplate = '这个影片或演员可以识别，但当前没有可执行的动作证据。要不要换一个已观察到可打开的目标？';
      } else if (cloned.case === 'search-no-results') {
        cloned.response.questionTemplate = '站内没有命中该影片结果，可以换一个更具体的番号、片名或演员名继续搜索。';
      }
    }

    if (typeof semantics.rewriteClarificationRule === 'function') {
      semantics.rewriteClarificationRule(cloned);
    }
    seen.add(cloned.clarificationRuleId);
    return cloned;
  });

  const extraRules = [];
  for (const rule of toArray(semantics.clarificationRules)) {
    if (!seen.has(rule.clarificationRuleId)) {
      extraRules.push(rule);
      seen.add(rule.clarificationRuleId);
    }
  }

  return {
    inputUrl: baseDocument.inputUrl,
    baseUrl: baseDocument.baseUrl,
    generatedAt: baseDocument.generatedAt,
    rules: [...rules, ...extraRules],
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
  return buildRunManifest({
    inputUrl: artifacts.inputUrl,
    baseUrl: artifacts.baseUrl,
    generatedAt: layout.generatedAt,
    outDir: layout.outDir,
    upstream: {
      abstraction: {
        manifest: artifacts.abstractionManifestPath,
        dir: artifacts.abstractionDir,
      },
      analysis: {
        dir: artifacts.analysisDir,
      },
      examples: {
        path: artifacts.examplesPath,
        used: artifacts.usedExamples,
      },
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
  });
}

export async function buildNlEntry(inputUrl, options = {}) {
  const settings = mergeOptions(options);
  const artifacts = await loadAbstractionArtifacts(inputUrl, settings);
  const warnings = [...artifacts.warnings];
  const semantics = resolveSiteSemantics(artifacts.baseUrl ?? inputUrl, artifacts.siteProfileDocument);
  const indices = buildIndices(artifacts);
  const contexts = buildIntentContexts(artifacts, indices, semantics);
  const exampleContext = mapExamplesToContexts(contexts, artifacts.examples, warnings);
  const layout = createOutputLayout(artifacts.baseUrl ?? inputUrl, settings.outDir);

  await ensureDir(layout.outDir);

  const lexicon = buildLexicon(artifacts, contexts, exampleContext, semantics);
  lexicon.document.generatedAt = layout.generatedAt;

  const slotSchemaDocument = buildSlotSchemaDocument(artifacts, contexts, lexicon.refs.values, layout.generatedAt);
  const utterancePatterns = buildUtterancePatternsV3(artifacts, contexts, exampleContext, layout.generatedAt, semantics);
  const entryRulesDocument = buildEntryRules(artifacts, contexts, lexicon.refs, utterancePatterns.refs, warnings, layout.generatedAt);
  const clarificationRulesDocument = buildClarificationRulesDocumentV2(artifacts, layout.generatedAt, semantics);

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

export function printHelp() {
  process.stdout.write(`Usage:
  node src/entrypoints/pipeline/nl-entry.mjs <url> --abstraction-manifest <path>
  node src/entrypoints/pipeline/nl-entry.mjs <url> --abstraction-dir <dir>

Options:
  --abstraction-manifest <path>  Path to abstraction-manifest.json
  --abstraction-dir <dir>        Directory containing fourth-step outputs
  --analysis-dir <dir>           Optional third-step output directory override
  --examples <path>              Optional example utterance JSON file
  --out-dir <dir>                Root output directory
  --help                         Show this help
`);
}

export function parseCliArgs(argv) {
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

export async function runCli() {
  initializeCliUtf8();
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

