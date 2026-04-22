// @ts-check

import process from 'node:process';
import path from 'node:path';
import { execFile as execFileCallback } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { initializeCliUtf8, writeJsonStdout } from '../../infra/cli.mjs';
import { upsertSiteCapabilities } from '../../sites/catalog/capabilities.mjs';
import { upsertSiteRegistryRecord } from '../../sites/catalog/registry.mjs';
import {
  loadJableTaxonomy,
  normalizeJableLimit,
  parseJableVideoCardsFromHtml,
  resolveJableRankingTarget,
  resolveJableSortMode,
} from '../../sites/jable/queries/ranking.mjs';
import { normalizeUrlNoFragment } from '../../shared/normalize.mjs';

const DEFAULT_OPTIONS = {
  limit: 3,
  sortMode: 'combined',
  workspaceRoot: process.cwd(),
  maxTagPages: 4,
  groupConcurrency: 6,
};
const SUPPORTED_RANKING_MODES = ['combined', 'recent', 'most-viewed', 'most-favourited'];

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0 Safari/537.36';
const execFile = promisify(execFileCallback);

function parseArgs(argv) {
  const args = [...argv];
  const positionals = [];
  const flags = {};
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }
    const [key, inlineValue] = token.split('=', 2);
    const normalizedKey = key.replace(/^--/, '');
    if (inlineValue !== undefined) {
      flags[normalizedKey] = inlineValue;
      continue;
    }
    const next = args[index + 1];
    if (next && !next.startsWith('--')) {
      flags[normalizedKey] = next;
      index += 1;
    } else {
      flags[normalizedKey] = true;
    }
  }
  return {
    url: positionals[0] ?? 'https://jable.tv/',
    query: flags.query ? String(flags.query) : null,
    targetLabel: flags['target-label'] ? String(flags['target-label']) : null,
    sortMode: flags.sort ? String(flags.sort) : DEFAULT_OPTIONS.sortMode,
    limit: normalizeJableLimit(flags.limit, DEFAULT_OPTIONS.limit),
    workspaceRoot: flags['workspace-root'] ? path.resolve(String(flags['workspace-root'])) : DEFAULT_OPTIONS.workspaceRoot,
    maxTagPages: normalizeJableLimit(flags['max-tag-pages'], DEFAULT_OPTIONS.maxTagPages),
    groupConcurrency: normalizeJableLimit(flags['group-concurrency'], DEFAULT_OPTIONS.groupConcurrency),
  };
}

function extractLimitFromQuery(queryText) {
  const value = String(queryText ?? '');
  const direct = value.match(/前\s*(\d{1,2})/u) ?? value.match(/(\d{1,2})\s*(?:条|條|部|个|個)/u);
  if (direct) {
    return normalizeJableLimit(direct[1]);
  }
  const chinese = value.match(/前([一二两三四五六七八九十])/u) ?? value.match(/([一二两三四五六七八九十])(?:条|條|部|个|個)/u);
  if (chinese) {
    return normalizeJableLimit(chinese[1]);
  }
  return DEFAULT_OPTIONS.limit;
}

function resolveSortModeFromQuery(queryText, explicitSortMode) {
  if (explicitSortMode && explicitSortMode !== DEFAULT_OPTIONS.sortMode) {
    return resolveJableSortMode(explicitSortMode);
  }
  return resolveJableSortMode(queryText ?? explicitSortMode);
}

function buildPageUrl(targetUrl, pageNumber, sortMode) {
  const parsed = new URL(targetUrl);
  if (pageNumber > 1) {
    const segments = parsed.pathname.split('/').filter(Boolean);
    if (!/^\d+$/u.test(segments.at(-1) ?? '')) {
      segments.push(String(pageNumber));
    } else {
      segments[segments.length - 1] = String(pageNumber);
    }
    parsed.pathname = `/${segments.join('/')}/`;
  }
  if (sortMode?.sortParam) {
    parsed.searchParams.set('sort_by', sortMode.sortParam);
  }
  return parsed.toString();
}

async function fetchHtml(url) {
  try {
    const response = await fetch(url, {
      headers: {
        'user-agent': USER_AGENT,
        'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'cache-control': 'no-cache',
      },
    });
    if (!response.ok) {
      throw new Error(`Fetch failed: ${url} -> ${response.status}`);
    }
    return await response.text();
  } catch (error) {
    const { stdout } = await execFile('curl.exe', [
      '--silent',
      '--show-error',
      '--location',
      '--compressed',
      '--user-agent',
      USER_AGENT,
      '--header',
      'Accept-Language: zh-CN,zh;q=0.9,en;q=0.8',
      url,
    ], {
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    });
    if (!stdout?.trim()) {
      throw error;
    }
    return stdout;
  }
}

async function fetchTagResults(targetUrl, sortMode, limit, maxPages) {
  const rows = [];
  const visited = new Set();
  for (let pageNumber = 1; pageNumber <= maxPages && rows.length < limit; pageNumber += 1) {
    const pageUrl = buildPageUrl(targetUrl, pageNumber, sortMode);
    const html = await fetchHtml(pageUrl);
    const pageRows = parseJableVideoCardsFromHtml(html, pageUrl);
    if (!pageRows.length) {
      break;
    }
    for (const row of pageRows) {
      if (visited.has(row.videoUrl)) {
        continue;
      }
      visited.add(row.videoUrl);
      rows.push({
        ...row,
        pageNumber,
        rankInSource: row.rank,
      });
      if (rows.length >= limit) {
        break;
      }
    }
    if (pageRows.length < 4) {
      break;
    }
  }
  return rows.slice(0, limit);
}

async function mapLimit(items, concurrency, mapper) {
  const values = [...items];
  const results = new Array(values.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < values.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(values[currentIndex], currentIndex);
    }
  }
  const workers = Array.from({ length: Math.min(Math.max(concurrency, 1), values.length || 1) }, () => worker());
  await Promise.all(workers);
  return results;
}

function dedupeCards(cards) {
  const map = new Map();
  for (const card of cards) {
    const key = normalizeUrlNoFragment(card.videoUrl);
    if (!key) {
      continue;
    }
    const previous = map.get(key);
    if (!previous) {
      map.set(key, card);
      continue;
    }
    if ((card.rankInSource ?? Number.POSITIVE_INFINITY) < (previous.rankInSource ?? Number.POSITIVE_INFINITY)) {
      map.set(key, card);
    }
  }
  return [...map.values()];
}

function sortGroupCards(cards, sortMode) {
  const rows = [...cards];
  switch (sortMode.sortMode) {
    case 'most-viewed':
      rows.sort((left, right) => (right.views ?? -1) - (left.views ?? -1)
        || (right.favourites ?? -1) - (left.favourites ?? -1)
        || (left.rankInSource ?? Number.POSITIVE_INFINITY) - (right.rankInSource ?? Number.POSITIVE_INFINITY));
      break;
    case 'most-favourited':
      rows.sort((left, right) => (right.favourites ?? -1) - (left.favourites ?? -1)
        || (right.views ?? -1) - (left.views ?? -1)
        || (left.rankInSource ?? Number.POSITIVE_INFINITY) - (right.rankInSource ?? Number.POSITIVE_INFINITY));
      break;
    case 'recent':
    case 'combined':
    default:
      rows.sort((left, right) => (left.rankInSource ?? Number.POSITIVE_INFINITY) - (right.rankInSource ?? Number.POSITIVE_INFINITY)
        || (right.favourites ?? -1) - (left.favourites ?? -1)
        || String(left.title).localeCompare(String(right.title), 'zh-Hans'));
      break;
  }
  return rows;
}

async function fetchGroupResults(target, sortMode, limit, options) {
  const sampleLimit = Math.max(limit, 12);
  const perTagRows = await mapLimit(target.tags ?? [], options.groupConcurrency, async (tag) => {
    const rows = await fetchTagResults(tag.href, sortMode, sampleLimit, 1);
    return rows.map((row) => ({
      ...row,
      sourceTag: tag.label,
    }));
  });
  const deduped = dedupeCards(perTagRows.flat());
  return sortGroupCards(deduped, sortMode).slice(0, limit);
}

function normalizeResultMetrics(card, sortMode) {
  if (sortMode.sortMode === 'most-viewed') {
    return {
      metricLabel: '最多觀看',
      metricValue: card.views,
    };
  }
  if (sortMode.sortMode === 'most-favourited') {
    return {
      metricLabel: '最高收藏',
      metricValue: card.favourites,
    };
  }
  if (sortMode.sortMode === 'recent') {
    return {
      metricLabel: '最近更新',
      metricValue: card.rankInSource,
    };
  }
  return {
    metricLabel: '综合排序',
    metricValue: card.rankInSource,
  };
}

function normalizeQueryIntent(queryText, taxonomyIndex) {
  const sortMode = resolveSortModeFromQuery(queryText, null);
  const limit = extractLimitFromQuery(queryText);
  const { target, suggestions } = resolveJableRankingTarget(queryText, taxonomyIndex);
  return {
    sortMode,
    limit,
    target,
    suggestions,
  };
}

export async function queryJableRanking(url, options = {}) {
  const runtimeOptions = {
    ...DEFAULT_OPTIONS,
    ...options,
  };
  const parsedOptions = {
    ...runtimeOptions,
    sortMode: resolveSortModeFromQuery(runtimeOptions.query, runtimeOptions.sortMode),
    limit: runtimeOptions.query && !runtimeOptions.targetLabel ? extractLimitFromQuery(runtimeOptions.query) : runtimeOptions.limit,
  };
  const taxonomyBundle = await loadJableTaxonomy(runtimeOptions.workspaceRoot, 'jable.tv');
  const targetResolution = runtimeOptions.query && !runtimeOptions.targetLabel
    ? normalizeQueryIntent(runtimeOptions.query, taxonomyBundle.taxonomyIndex)
    : {
        sortMode: parsedOptions.sortMode,
        limit: parsedOptions.limit,
        ...resolveJableRankingTarget(runtimeOptions.targetLabel, taxonomyBundle.taxonomyIndex),
      };
  const target = targetResolution.target;
  if (!target) {
    return {
      ok: false,
      code: 'target-not-found',
      query: runtimeOptions.query ?? runtimeOptions.targetLabel ?? null,
      suggestions: targetResolution.suggestions,
      supportedGroupCount: taxonomyBundle.categoryGroups.length,
      supportedTagCount: taxonomyBundle.categoryTagCount,
    };
  }
  const sortMode = targetResolution.sortMode ?? parsedOptions.sortMode;
  const limit = targetResolution.limit ?? parsedOptions.limit;
  let cards;
  let aggregationMode;
  if (target.scopeType === 'group') {
    cards = await fetchGroupResults(target, sortMode, limit, parsedOptions);
    aggregationMode = sortMode.sortMode === 'recent' || sortMode.sortMode === 'combined'
      ? 'group-tag-page-order'
      : 'group-metric-order';
  } else {
    cards = await fetchTagResults(target.targetUrl, sortMode, limit, parsedOptions.maxTagPages);
    aggregationMode = 'tag-page-order';
  }
  const results = cards.map((card, index) => ({
    rank: index + 1,
    title: card.title,
    videoUrl: card.videoUrl,
    actorNames: card.actorNames ?? [],
    ...normalizeResultMetrics(card, sortMode),
    sourcePage: card.sourcePage,
    sourceTag: card.sourceTag ?? target.displayLabel,
  }));
  const host = new URL(url).host;
  const entrypointPath = path.resolve(runtimeOptions.workspaceRoot, 'src', 'entrypoints', 'sites', 'jable-ranking.mjs');
  await upsertSiteRegistryRecord(runtimeOptions.workspaceRoot, host, {
    canonicalBaseUrl: 'https://jable.tv/',
    latestRankingQueryAt: new Date().toISOString(),
    rankingQueryEntrypoint: entrypointPath,
    knowledgeBaseDir: taxonomyBundle.kbDir,
  }, runtimeOptions.siteMetadataOptions ?? {});
  await upsertSiteCapabilities(runtimeOptions.workspaceRoot, host, {
    baseUrl: 'https://jable.tv/',
    primaryArchetype: 'catalog-detail',
    pageTypes: ['author-list-page', 'author-page', 'book-detail-page', 'category-page', 'home', 'search-results-page'],
    capabilityFamilies: ['navigate-to-author', 'navigate-to-category', 'navigate-to-content', 'search-content', 'switch-in-page-state'],
    supportedIntents: ['list-category-videos', 'open-category', 'open-model', 'open-video', 'search-video'],
    safeActionKinds: ['navigate', 'query-ranking'],
    approvalActionKinds: ['search-submit'],
    rankingSupported: true,
    rankingModes: SUPPORTED_RANKING_MODES,
    categoryTaxonomySupported: true,
    rankingQueryEntrypoint: entrypointPath,
  }, runtimeOptions.siteMetadataOptions ?? {});
  return {
    ok: true,
    baseUrl: 'https://jable.tv/',
    resolvedTarget: {
      scopeType: target.scopeType,
      displayLabel: target.displayLabel,
      canonicalLabel: target.canonicalLabel,
      targetUrl: target.targetUrl,
      groupLabel: target.groupLabel ?? null,
      tagCount: target.scopeType === 'group' ? (target.tags?.length ?? 0) : undefined,
    },
    sortMode: sortMode.sortMode,
    sortLabel: sortMode.displayLabel,
    limit,
    aggregationMode,
    results,
  };
}

function printHelp() {
  process.stdout.write([
    'Usage:',
    '  node src/entrypoints/sites/jable-ranking.mjs <url> --query "<natural language>"',
    '  node src/entrypoints/sites/jable-ranking.mjs <url> --target-label "<label>" --sort combined --limit 3',
    '',
    'Options:',
    '  --query <text>           Natural-language query, e.g. "黑丝分类，近期最佳推荐三部"',
    '  --target-label <label>   Exact or normalized taxonomy label/group',
    '  --sort <mode>            combined | recent | most-viewed | most-favourited',
    '  --limit <n>              Default 3',
    '  --workspace-root <dir>   Override workspace root',
  ].join('\n') + '\n');
}

async function main() {
  initializeCliUtf8();
  const args = parseArgs(process.argv.slice(2));
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    printHelp();
    return;
  }
  if (!args.query && !args.targetLabel) {
    throw new Error('Provide either --query or --target-label.');
  }
  const result = await queryJableRanking(args.url, args);
  writeJsonStdout(result);
}

const modulePath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === modulePath) {
  main().catch((error) => {
    initializeCliUtf8();
    process.stderr.write(`${error?.stack ?? error?.message ?? String(error)}\n`);
    process.exitCode = 1;
  });
}
