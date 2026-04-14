// @ts-check

import path from 'node:path';

import { readJsonFile, pathExists } from './io.mjs';
import { cleanText, normalizeText, normalizeUrlNoFragment, sanitizeHost } from './normalize.mjs';
import { readSiteContext } from './site-context.mjs';

const JABLE_DEFAULT_KB_DIR = path.resolve(process.cwd(), 'knowledge-base', 'jable.tv');
const MAX_SUGGESTIONS = 5;

const SORT_MODE_DEFINITIONS = {
  combined: {
    sortMode: 'combined',
    sortParam: 'post_date_and_popularity',
    displayLabel: '综合排序',
    aliases: ['combined', '综合排序', '綜合排序', '推荐', '推薦', '最佳', '近期最佳', '最近最佳'],
  },
  recent: {
    sortMode: 'recent',
    sortParam: 'post_date',
    displayLabel: '最近更新',
    aliases: ['recent', '最近更新', '最近', '近期'],
  },
  'most-viewed': {
    sortMode: 'most-viewed',
    sortParam: 'video_viewed',
    displayLabel: '最多觀看',
    aliases: ['most-viewed', '最多觀看', '最多观看', '最热', '最熱', '热度最高', '觀看最多', '观看最多'],
  },
  'most-favourited': {
    sortMode: 'most-favourited',
    sortParam: 'most_favourited',
    displayLabel: '最高收藏',
    aliases: ['most-favourited', '最高收藏', '收藏最多', '最受收藏', '收藏最高'],
  },
};

const SIMPLIFIED_CHAR_MAP = new Map([
  ['絲', '丝'],
  ['劇', '剧'],
  ['點', '点'],
  ['著', '着'],
  ['過', '过'],
  ['運', '运'],
  ['鏡', '镜'],
  ['獸', '兽'],
  ['漁', '渔'],
  ['長', '长'],
  ['軟', '软'],
  ['髮', '发'],
  ['顏', '颜'],
  ['腳', '脚'],
  ['團', '团'],
  ['綁', '绑'],
  ['調', '调'],
  ['親', '亲'],
  ['屬', '属'],
  ['齡', '龄'],
  ['藥', '药'],
  ['軌', '轨'],
  ['暫', '暂'],
  ['戀', '恋'],
  ['騷', '骚'],
  ['濕', '湿'],
  ['婦', '妇'],
  ['處', '处'],
  ['廳', '厅'],
  ['廁', '厕'],
  ['優', '优'],
  ['體', '体'],
  ['魚', '鱼'],
  ['貧', '贫'],
  ['貓', '猫'],
  ['學', '学'],
  ['氣', '气'],
  ['內', '内'],
  ['雙', '双'],
  ['觸', '触'],
  ['襲', '袭'],
  ['騎', '骑'],
  ['醫', '医'],
  ['樓', '楼'],
  ['車', '车'],
  ['電', '电'],
  ['癡', '痴'],
  ['綑', '捆'],
]);

function convertTraditionalToSimplified(value) {
  return [...String(value ?? '')].map((char) => SIMPLIFIED_CHAR_MAP.get(char) ?? char).join('');
}

export function normalizeJableRankingLabel(value) {
  const normalized = convertTraditionalToSimplified(normalizeText(value))
    .replace(/^#+/u, '')
    .replace(/[：:]/gu, '')
    .replace(/[（）()【】\[\]「」『』、，。！？,.!?]/gu, '')
    .replace(/(?:分类|分類|标签|標籤|标签页|標籤頁|分类页|分類頁|榜单|推薦|推荐|最佳|最近更新|最近|近期|最高收藏|最多觀看|最多观看|最热|最熱|前\d+|前三|前五|前十|三部|五条|十条|條|个|個)/gu, '')
    .replace(/\s+/gu, '')
    .trim()
    .toLowerCase();
  return normalized;
}

function normalizeSortText(value) {
  return convertTraditionalToSimplified(normalizeText(value))
    .replace(/[：:#（）()【】\[\]「」『』、，。！？,.!?]/gu, '')
    .replace(/\s+/gu, '')
    .trim()
    .toLowerCase();
}

export function resolveJableSortMode(input) {
  const normalized = normalizeSortText(input);
  for (const definition of Object.values(SORT_MODE_DEFINITIONS)) {
    for (const alias of definition.aliases) {
      if (normalizeSortText(alias) === normalized) {
        return definition;
      }
    }
  }
  if (/(推荐|推薦|最佳)/u.test(String(input ?? ''))) {
    return SORT_MODE_DEFINITIONS.combined;
  }
  if (/(最多觀看|最多观看|最热|最熱)/u.test(String(input ?? ''))) {
    return SORT_MODE_DEFINITIONS['most-viewed'];
  }
  if (/(最高收藏|收藏最多)/u.test(String(input ?? ''))) {
    return SORT_MODE_DEFINITIONS['most-favourited'];
  }
  if (/(最近更新|最近|近期)/u.test(String(input ?? ''))) {
    return SORT_MODE_DEFINITIONS.recent;
  }
  return SORT_MODE_DEFINITIONS.combined;
}

function decodeHtmlEntities(value) {
  return String(value ?? '')
    .replace(/&nbsp;/gu, ' ')
    .replace(/&amp;/gu, '&')
    .replace(/&quot;/gu, '"')
    .replace(/&#39;/gu, '\'')
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>');
}

function stripHtml(value) {
  return decodeHtmlEntities(String(value ?? '').replace(/<[^>]+>/gu, ' '));
}

function parseMetricNumber(value) {
  const digits = String(value ?? '').replace(/[^\d]/gu, '');
  return digits ? Number.parseInt(digits, 10) : null;
}

function normalizeTagHref(href, baseUrl) {
  const normalized = normalizeUrlNoFragment(href);
  if (!normalized) {
    return null;
  }
  try {
    return new URL(normalized, baseUrl).toString();
  } catch {
    return normalized;
  }
}

export function parseJableVideoCardsFromHtml(html, sourcePage, siteBaseUrl = 'https://jable.tv/') {
  const cards = [];
  const cardPattern = /<div class="video-img-box[\s\S]*?<h6 class="title">\s*<a href="([^"]+)">([\s\S]*?)<\/a>\s*<\/h6>\s*<p class="sub-title">([\s\S]*?)<\/p>/giu;
  let match;
  let rank = 0;
  while ((match = cardPattern.exec(html)) !== null) {
    rank += 1;
    const [, href, rawTitle, metricHtml] = match;
    const title = cleanText(stripHtml(rawTitle));
    const videoUrl = normalizeTagHref(href, siteBaseUrl);
    if (!title || !videoUrl) {
      continue;
    }
    const eyeMatch = metricHtml.match(/icon-eye[\s\S]*?<\/svg>\s*([\d\s]+)/iu);
    const heartMatch = metricHtml.match(/icon-heart-inline[\s\S]*?<\/svg>\s*([\d\s]+)/iu);
    const views = parseMetricNumber(eyeMatch?.[1]);
    const favourites = parseMetricNumber(heartMatch?.[1]);
    cards.push({
      rank,
      title,
      videoUrl,
      actorNames: [],
      views,
      favourites,
      sourcePage,
    });
  }
  return cards;
}

export function extractJableCategoryTaxonomy(statesDocument) {
  const states = statesDocument?.states ?? [];
  const taxonomyState = states.find((state) => Array.isArray(state?.pageFacts?.categoryTaxonomy));
  const taxonomy = taxonomyState?.pageFacts?.categoryTaxonomy ?? [];
  const categoryGroups = taxonomy.map((group) => ({
    groupLabel: cleanText(group.groupLabel),
    tags: (group.tags ?? [])
      .map((tag) => ({
        label: cleanText(tag.label),
        href: normalizeTagHref(tag.href, statesDocument?.baseUrl ?? 'https://jable.tv/'),
      }))
      .filter((tag) => tag.label && tag.href),
  })).filter((group) => group.groupLabel && group.tags.length);
  return {
    categoryGroups,
    categoryTagCount: categoryGroups.reduce((sum, group) => sum + group.tags.length, 0),
  };
}

export function buildJableTaxonomyIndex(categoryGroups) {
  const allLabels = [];
  const tagEntries = [];
  const groupEntries = [];
  for (const group of categoryGroups ?? []) {
    const groupCanonical = normalizeJableRankingLabel(group.groupLabel);
    const groupEntry = {
      scopeType: 'group',
      displayLabel: group.groupLabel,
      canonicalLabel: groupCanonical,
      targetUrl: 'https://jable.tv/categories/',
      groupLabel: group.groupLabel,
      tags: group.tags ?? [],
      aliases: [group.groupLabel, convertTraditionalToSimplified(group.groupLabel)],
    };
    groupEntries.push(groupEntry);
    allLabels.push(groupEntry);
    for (const tag of group.tags ?? []) {
      const tagCanonical = normalizeJableRankingLabel(tag.label);
      const slug = (() => {
        try {
          return new URL(tag.href).pathname.split('/').filter(Boolean).at(-1) ?? '';
        } catch {
          return '';
        }
      })();
      const tagEntry = {
        scopeType: 'tag',
        displayLabel: tag.label,
        canonicalLabel: tagCanonical,
        targetUrl: tag.href,
        groupLabel: group.groupLabel,
        aliases: [tag.label, convertTraditionalToSimplified(tag.label), slug],
      };
      tagEntries.push(tagEntry);
      allLabels.push(tagEntry);
    }
  }
  return {
    tagEntries,
    groupEntries,
    allLabels,
  };
}

function rankSuggestionScore(queryCanonical, entry) {
  const aliases = [...new Set([entry.canonicalLabel, ...(entry.aliases ?? []).map((value) => normalizeJableRankingLabel(value))].filter(Boolean))];
  let score = Number.POSITIVE_INFINITY;
  for (const alias of aliases) {
    if (alias === queryCanonical) {
      return 0;
    }
    if (alias.includes(queryCanonical) || queryCanonical.includes(alias)) {
      score = Math.min(score, Math.abs(alias.length - queryCanonical.length) + 1);
    }
  }
  return score;
}

export function resolveJableRankingTarget(queryOrLabel, taxonomyIndex) {
  const input = String(queryOrLabel ?? '');
  const canonicalQuery = normalizeJableRankingLabel(input);
  if (!canonicalQuery) {
    return {
      target: null,
      suggestions: [],
    };
  }
  const matches = [];
  for (const entry of taxonomyIndex?.allLabels ?? []) {
    const aliases = [...new Set([entry.canonicalLabel, ...(entry.aliases ?? []).map((value) => normalizeJableRankingLabel(value))].filter(Boolean))];
    for (const alias of aliases) {
      if (!alias) {
        continue;
      }
      if (canonicalQuery === alias || canonicalQuery.includes(alias) || alias.includes(canonicalQuery)) {
        matches.push({
          entry,
          alias,
          exact: canonicalQuery === alias,
          length: alias.length,
        });
        break;
      }
    }
  }
  matches.sort((left, right) => {
    if (left.exact !== right.exact) {
      return left.exact ? -1 : 1;
    }
    if (left.length !== right.length) {
      return right.length - left.length;
    }
    if (left.entry.scopeType !== right.entry.scopeType) {
      return left.entry.scopeType === 'tag' ? -1 : 1;
    }
    return String(left.entry.displayLabel).localeCompare(String(right.entry.displayLabel), 'zh-Hans');
  });
  if (matches.length) {
    return {
      target: matches[0].entry,
      suggestions: matches.slice(0, MAX_SUGGESTIONS).map((match) => ({
        displayLabel: match.entry.displayLabel,
        scopeType: match.entry.scopeType,
        groupLabel: match.entry.groupLabel ?? null,
        targetUrl: match.entry.targetUrl,
      })),
    };
  }
  const suggestions = (taxonomyIndex?.allLabels ?? [])
    .map((entry) => ({ entry, score: rankSuggestionScore(canonicalQuery, entry) }))
    .filter((item) => Number.isFinite(item.score))
    .sort((left, right) => left.score - right.score || String(left.entry.displayLabel).localeCompare(String(right.entry.displayLabel), 'zh-Hans'))
    .slice(0, MAX_SUGGESTIONS)
    .map((item) => ({
      displayLabel: item.entry.displayLabel,
      scopeType: item.entry.scopeType,
      groupLabel: item.entry.groupLabel ?? null,
      targetUrl: item.entry.targetUrl,
    }));
  return {
    target: null,
    suggestions,
  };
}

async function loadStatesDocumentFromKb(kbDir) {
  const sourcesPath = path.join(kbDir, 'index', 'sources.json');
  if (!await pathExists(sourcesPath)) {
    throw new Error(`Knowledge base sources not found: ${sourcesPath}`);
  }
  const sources = await readJsonFile(sourcesPath);
  const analysisSource = (sources.activeSources ?? []).find((source) => source.step === 'step-3-analysis');
  if (!analysisSource) {
    throw new Error(`No step-3-analysis source registered in ${sourcesPath}`);
  }
  const candidateStatesPaths = [
    analysisSource.originalDir ? path.join(analysisSource.originalDir, 'states.json') : null,
    analysisSource.rawDir ? path.join(kbDir, analysisSource.rawDir, 'states.json') : null,
  ].filter(Boolean);
  for (const statesPath of candidateStatesPaths) {
    if (await pathExists(statesPath)) {
      return {
        statesPath,
        statesDocument: await readJsonFile(statesPath),
      };
    }
  }
  throw new Error(`states.json not found for analysis source ${analysisSource.runId}`);
}

export async function loadJableTaxonomy(workspaceRoot = process.cwd(), host = 'jable.tv') {
  const siteContext = await readSiteContext(workspaceRoot, host);
  const kbDir = siteContext.registryRecord?.knowledgeBaseDir
    ? path.resolve(siteContext.registryRecord.knowledgeBaseDir)
    : JABLE_DEFAULT_KB_DIR;
  const { statesPath, statesDocument } = await loadStatesDocumentFromKb(kbDir);
  const taxonomy = extractJableCategoryTaxonomy(statesDocument);
  return {
    kbDir,
    statesPath,
    statesDocument,
    ...taxonomy,
    taxonomyIndex: buildJableTaxonomyIndex(taxonomy.categoryGroups),
  };
}

export function normalizeJableLimit(input, defaultLimit = 3) {
  if (input === undefined || input === null || input === '') {
    return defaultLimit;
  }
  const direct = Number.parseInt(String(input), 10);
  if (Number.isFinite(direct) && direct > 0) {
    return direct;
  }
  const chineseMap = new Map([
    ['一', 1], ['二', 2], ['两', 2], ['三', 3], ['四', 4], ['五', 5],
    ['六', 6], ['七', 7], ['八', 8], ['九', 9], ['十', 10],
  ]);
  for (const [text, value] of chineseMap.entries()) {
    if (String(input).includes(text)) {
      return value;
    }
  }
  return defaultLimit;
}
