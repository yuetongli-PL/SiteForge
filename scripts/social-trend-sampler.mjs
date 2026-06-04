#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const SCHEMA_VERSION = 2;
const DEFAULT_FROM = '2025-12-02';
const DEFAULT_TO = '2026-06-03';
const DEFAULT_RUNS_ROOT = path.join('.siteforge', 'x-live-runs-skill');
const DEFAULT_OUT_DIR = path.join('.siteforge', 'x-trend-analysis');
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_COOLDOWN_MINUTES = 30;
const DEFAULT_DELAY_MS = 0;
const DEFAULT_MAX_API_PAGES = 10;
const DEFAULT_COLLECTION_MODE = 'page';
const DEFAULT_PAGE_MAX_SCROLLS = 60;
const DEFAULT_PAGE_SCROLL_WAIT_MS = 1_000;
const DEFAULT_PROBE_ITEMS = 5;
const DEFAULT_MAX_ITEMS = 150;
const DEFAULT_TARGET_SAMPLES = 12_000;
const DEFAULT_EFFECTIVE_MIN_TOTAL = 10_000;
const DEFAULT_MIN_LANGUAGE_SAMPLES = 5_000;
const DEFAULT_MAX_BUCKETS_PER_RUN = 1;
const DEFAULT_RECENT_RATE_LIMIT_WINDOW_MINUTES = 120;
const DEFAULT_POST_COOLDOWN_THROTTLE_MS = 0;
const DEFAULT_API_RATE_LIMIT_FALLBACK = 'page';
const DEFAULT_LANGUAGES = Object.freeze(['zh', 'en']);

const DEFAULT_SUBJECTS = Object.freeze([
  {
    id: 'codex-product',
    label: 'Codex product',
    compareGroup: 'openai-product',
    query: {
      zh: '("OpenAI Codex" OR "ChatGPT Codex" OR "Codex CLI" OR Codex)',
      en: '("OpenAI Codex" OR "ChatGPT Codex" OR "Codex CLI" OR Codex)',
    },
  },
  {
    id: 'claude-code-product',
    label: 'Claude Code product',
    compareGroup: 'anthropic-product',
    query: {
      zh: '("Claude Code" OR ClaudeCode)',
      en: '("Claude Code" OR ClaudeCode)',
    },
  },
  {
    id: 'chatgpt-product',
    label: 'ChatGPT product',
    compareGroup: 'openai-product',
    query: {
      zh: '(ChatGPT OR "ChatGPT app")',
      en: '(ChatGPT OR "ChatGPT app")',
    },
  },
  {
    id: 'claude-product',
    label: 'Claude product',
    compareGroup: 'anthropic-product',
    query: {
      zh: '(Claude OR "Claude AI") -"Claude Code" -ClaudeCode',
      en: '(Claude OR "Claude AI") -"Claude Code" -ClaudeCode',
    },
  },
  {
    id: 'gpt-model-family',
    label: 'GPT model family',
    compareGroup: 'openai-model',
    query: {
      zh: '("GPT-5" OR "GPT 5" OR "GPT-4o" OR "GPT-4.5" OR "GPT-4" OR "GPT 4" OR "GPT 模型")',
      en: '("GPT-5" OR "GPT 5" OR "GPT-4o" OR "GPT-4.5" OR "GPT-4" OR "GPT 4")',
    },
  },
  {
    id: 'claude-model-family',
    label: 'Claude model family',
    compareGroup: 'anthropic-model',
    query: {
      zh: '("Claude Opus" OR "Claude Sonnet" OR "Claude Haiku" OR "Opus 4" OR "Sonnet 4" OR "Haiku 4" OR "Claude 模型")',
      en: '("Claude Opus" OR "Claude Sonnet" OR "Claude Haiku" OR "Opus 4" OR "Sonnet 4" OR "Haiku 4")',
    },
  },
]);

const DEFAULT_TOPICS = Object.freeze([
  {
    id: 'ux-love',
    label: 'User experience and user love',
    terms: '',
  },
]);

const SIGNAL_KEYWORDS = Object.freeze({
  ux: [
    'user experience',
    'ux',
    'ui',
    'workflow',
    'easy to use',
    'ease of use',
    'smooth',
    'fast',
    'responsive',
    'stable',
    'reliable',
    'context',
    'migration',
    'switching',
    'daily driver',
    '体验',
    '用户体验',
    '易用',
    '好上手',
    '上手',
    '顺手',
    '流畅',
    '稳定',
    '响应',
    '上下文',
    '界面',
    '工作流',
    '迁移',
    '替代',
    '日常',
  ],
  lovePositive: [
    'love',
    'like',
    'favorite',
    'recommend',
    'delightful',
    'impressed',
    'amazing',
    'awesome',
    'great',
    'excellent',
    'useful',
    'productive',
    'can\'t live without',
    'cannot live without',
    'depend on',
    'dependable',
    'prefer',
    'switched to',
    'sticking with',
    '喜欢',
    '爱用',
    '真香',
    '推荐',
    '离不开',
    '好用',
    '惊艳',
    '爽',
    '舒服',
    '省心',
    '高效',
    '依赖',
    '偏好',
    '换成',
    '转向',
  ],
  frustratedNegative: [
    'hate',
    'frustrating',
    'frustrated',
    'disappointed',
    'disappointing',
    'unusable',
    'slow',
    'buggy',
    'broken',
    'annoying',
    'worse',
    'ditch',
    'ditched',
    'switched away',
    'gave up',
    'not worth using',
    'bad experience',
    '难用',
    '不好用',
    '讨厌',
    '弃用',
    '放弃',
    '失望',
    '崩溃',
    '卡顿',
    '很卡',
    '慢',
    '烦',
    '垃圾',
    '不稳定',
    '劝退',
    '翻车',
    '不如',
    '换回',
  ],
  recommendation: [
    'recommend',
    'would recommend',
    'tell people to use',
    'daily driver',
    '推荐',
    '安利',
    '日常用',
    '主力',
  ],
  migration: [
    'switched',
    'switching',
    'migrated',
    'replace',
    'replaced',
    'ditch',
    'ditched',
    '换到',
    '换成',
    '迁移',
    '替代',
    '弃用',
    '换回',
  ],
  comparison: [
    'vs',
    'versus',
    'compared to',
    'better than',
    'worse than',
    'prefer',
    'beats',
    '不如',
    '比',
    '对比',
    '更好',
    '更差',
    '偏好',
  ],
});

const EXCLUSION_KEYWORDS = Object.freeze({
  pricingOnly: [
    'pricing',
    'price',
    'cost',
    'expensive',
    'subscription',
    'quota',
    'rate limit',
    'usage cap',
    '额度',
    '价格',
    '定价',
    '订阅',
    '会员',
    '收费',
    '太贵',
    '限额',
  ],
  safetyLegalPolicy: [
    'safety',
    'privacy',
    'policy',
    'regulation',
    'lawsuit',
    'legal',
    'copyright',
    'data leak',
    'compliance',
    '安全',
    '隐私',
    '政策',
    '监管',
    '诉讼',
    '法律',
    '合规',
    '版权',
  ],
  businessFinanceGovernance: [
    'funding',
    'valuation',
    'ipo',
    'revenue',
    'profit',
    'board',
    'governance',
    'acquisition',
    '融资',
    '估值',
    '上市',
    '收入',
    '利润',
    '董事会',
    '治理',
    '收购',
  ],
  newsNoEvaluation: [
    'breaking',
    'announced',
    'launches',
    'released',
    'report says',
    'according to',
    'new model',
    '招聘',
    '招人',
    '岗位',
    '广告',
    '推广',
    '新闻',
    '发布',
    '报道称',
    '据称',
    '工具列表',
  ],
});

function usage() {
  return `Usage:
  node scripts/social-trend-sampler.mjs [--from YYYY-MM-DD --to YYYY-MM-DD] [options]

Defaults:
  Time range: ${DEFAULT_FROM} to ${DEFAULT_TO} UTC
  Subjects: codex-product, claude-code-product, chatgpt-product, claude-product, gpt-model-family, claude-model-family
  Languages: zh,en
  Buckets: 6 subjects x 2 languages x monthly date buckets

Options:
  --execute                         Run pending X searches. Omitted by default for plan-only mode.
  --resume                          Resume from --state if it exists.
  --refresh-summary                 Rebuild output summaries from an existing state without live execution.
  --state <path>                    Trend run state path. Default: <out-dir>/trend-run-state.json.
  --out-dir <path>                  Output directory. Default: ${DEFAULT_OUT_DIR}
  --runs-root <path>                X action run root to scan and write into. Default: ${DEFAULT_RUNS_ROOT}
  --subjects <ids>                  Comma-separated subject ids. Default: all six product/model subjects.
  --topics <ids>                    Only ux-love is supported; overall aliases to ux-love.
  --all-topics                      Same as ux-love; topic-level live splitting is intentionally disabled.
  --languages <ids>                 Comma-separated X lang filters. Default: ${DEFAULT_LANGUAGES.join(',')}
  --language <id>                   Backward-compatible alias for one language.
  --target-samples <n>              Raw sampling target used for refill planning. Default: ${DEFAULT_TARGET_SAMPLES}
  --effective-min-total <n>         Deduped UX/love acceptance minimum. Default: ${DEFAULT_EFFECTIVE_MIN_TOTAL}
  --min-language-samples <n>        Deduped UX/love minimum per language. Default: ${DEFAULT_MIN_LANGUAGE_SAMPLES}
  --probe-items <n>                 Items per bucket in probe mode. Default: ${DEFAULT_PROBE_ITEMS}
  --max-items <n>                   Items per bucket in full mode. Default: ${DEFAULT_MAX_ITEMS}
  --max-api-pages <n>               X SearchTimeline API page limit. Default: ${DEFAULT_MAX_API_PAGES}
  --max-scrolls <n>                 Page/DOM scroll limit passed to x-action. Page default: ${DEFAULT_PAGE_MAX_SCROLLS}
  --scroll-wait-ms <n>              Page/DOM scroll wait passed to x-action. Page default: ${DEFAULT_PAGE_SCROLL_WAIT_MS}
  --collection-mode <api|page>      api uses API cursor; page uses Browser Bridge/page DOM collection. Default: ${DEFAULT_COLLECTION_MODE}
  --api-rate-limit-fallback <page|none> Immediately switch API-local cursor limits to page collection. Default: ${DEFAULT_API_RATE_LIMIT_FALLBACK}
  --cooldown-minutes <n>            Same-surface cooldown guard. Default: ${DEFAULT_COOLDOWN_MINUTES}
  --delay-ms <n>                    Optional pacing between executed buckets. Default: ${DEFAULT_DELAY_MS}
  --max-buckets-per-run <n>         Stop after executing n live buckets in this invocation. Default: ${DEFAULT_MAX_BUCKETS_PER_RUN}
  --recent-rate-limit-window-minutes <n> Treat recent hard-stops in this window as elevated risk. Default: ${DEFAULT_RECENT_RATE_LIMIT_WINDOW_MINUTES}
  --post-cooldown-throttle-ms <n>   Optional proactive pacing after a recent hard-stop. Default: ${DEFAULT_POST_COOLDOWN_THROTTLE_MS}
  --no-adaptive-throttle            Disable post-cooldown proactive throttling.
  --mode <probe|full>               Probe uses --probe-items; full uses --max-items. Default: full.
  --dry-run                         Alias for plan-only output.
  --help                            Show this message.
`;
}

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    from: DEFAULT_FROM,
    to: DEFAULT_TO,
    execute: false,
    resume: false,
    refreshSummary: false,
    outDir: DEFAULT_OUT_DIR,
    runsRoot: DEFAULT_RUNS_ROOT,
    statePath: null,
    subjects: null,
    topics: ['ux-love'],
    allTopics: false,
    languages: [...DEFAULT_LANGUAGES],
    targetSamples: DEFAULT_TARGET_SAMPLES,
    effectiveMinTotal: DEFAULT_EFFECTIVE_MIN_TOTAL,
    minLanguageSamples: DEFAULT_MIN_LANGUAGE_SAMPLES,
    probeItems: DEFAULT_PROBE_ITEMS,
    maxItems: DEFAULT_MAX_ITEMS,
    maxApiPages: DEFAULT_MAX_API_PAGES,
    maxScrolls: null,
    scrollWaitMs: null,
    collectionMode: DEFAULT_COLLECTION_MODE,
    cooldownMinutes: DEFAULT_COOLDOWN_MINUTES,
    delayMs: DEFAULT_DELAY_MS,
    maxBucketsPerRun: DEFAULT_MAX_BUCKETS_PER_RUN,
    recentRateLimitWindowMinutes: DEFAULT_RECENT_RATE_LIMIT_WINDOW_MINUTES,
    postCooldownThrottleMs: DEFAULT_POST_COOLDOWN_THROTTLE_MS,
    apiRateLimitFallback: DEFAULT_API_RATE_LIMIT_FALLBACK,
    adaptiveThrottle: true,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    mode: 'full',
    dryRun: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    switch (arg) {
      case '--from':
        options.from = next;
        i += 1;
        break;
      case '--to':
        options.to = next;
        i += 1;
        break;
      case '--execute':
        options.execute = true;
        break;
      case '--resume':
        options.resume = true;
        break;
      case '--refresh-summary':
        options.refreshSummary = true;
        options.execute = false;
        break;
      case '--out-dir':
        options.outDir = next;
        i += 1;
        break;
      case '--runs-root':
        options.runsRoot = next;
        i += 1;
        break;
      case '--state':
        options.statePath = next;
        i += 1;
        break;
      case '--subjects':
        options.subjects = splitCsv(next);
        i += 1;
        break;
      case '--topics':
        options.topics = splitCsv(next);
        i += 1;
        break;
      case '--all-topics':
        options.allTopics = true;
        break;
      case '--languages':
        options.languages = splitCsv(next);
        i += 1;
        break;
      case '--language':
        options.languages = [next];
        i += 1;
        break;
      case '--target-samples':
        options.targetSamples = positiveInteger(next, '--target-samples');
        i += 1;
        break;
      case '--effective-min-total':
        options.effectiveMinTotal = positiveInteger(next, '--effective-min-total');
        i += 1;
        break;
      case '--min-language-samples':
        options.minLanguageSamples = positiveInteger(next, '--min-language-samples');
        i += 1;
        break;
      case '--probe-items':
        options.probeItems = positiveInteger(next, '--probe-items');
        i += 1;
        break;
      case '--max-items':
        options.maxItems = positiveInteger(next, '--max-items');
        i += 1;
        break;
      case '--max-api-pages':
        options.maxApiPages = positiveInteger(next, '--max-api-pages');
        i += 1;
        break;
      case '--max-scrolls':
        options.maxScrolls = nonNegativeInteger(next, '--max-scrolls');
        i += 1;
        break;
      case '--scroll-wait-ms':
      case '--scroll-wait':
        options.scrollWaitMs = nonNegativeInteger(next, arg);
        i += 1;
        break;
      case '--collection-mode':
        options.collectionMode = next;
        i += 1;
        break;
      case '--api-rate-limit-fallback':
        options.apiRateLimitFallback = next;
        i += 1;
        break;
      case '--cooldown-minutes':
        options.cooldownMinutes = positiveInteger(next, '--cooldown-minutes');
        i += 1;
        break;
      case '--delay-ms':
        options.delayMs = nonNegativeInteger(next, '--delay-ms');
        i += 1;
        break;
      case '--max-buckets-per-run':
        options.maxBucketsPerRun = positiveInteger(next, '--max-buckets-per-run');
        i += 1;
        break;
      case '--recent-rate-limit-window-minutes':
        options.recentRateLimitWindowMinutes = positiveInteger(next, '--recent-rate-limit-window-minutes');
        i += 1;
        break;
      case '--post-cooldown-throttle-ms':
        options.postCooldownThrottleMs = nonNegativeInteger(next, '--post-cooldown-throttle-ms');
        i += 1;
        break;
      case '--no-adaptive-throttle':
        options.adaptiveThrottle = false;
        break;
      case '--timeout':
      case '--timeout-ms':
        options.timeoutMs = positiveInteger(next, arg);
        i += 1;
        break;
      case '--mode':
        options.mode = next;
        i += 1;
        break;
      case '--dry-run':
        options.dryRun = true;
        options.execute = false;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }
  if (!['probe', 'full'].includes(options.mode)) {
    throw new Error('--mode must be probe or full');
  }
  if (!['api', 'page'].includes(options.collectionMode)) {
    throw new Error('--collection-mode must be api or page');
  }
  if (!['page', 'none'].includes(options.apiRateLimitFallback)) {
    throw new Error('--api-rate-limit-fallback must be page or none');
  }
  if (!options.languages.length) {
    throw new Error('--languages must contain at least one language');
  }
  return options;
}

function splitCsv(value) {
  return String(value || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

function positiveInteger(value, name) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return number;
}

function nonNegativeInteger(value, name) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return number;
}

function parseDateOnly(value, name) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(String(value))) {
    throw new Error(`${name} must be YYYY-MM-DD`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error(`${name} must be a valid calendar date`);
  }
  return date;
}

function dateOnly(date) {
  return date.toISOString().slice(0, 10);
}

function addUtcMonth(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
}

function buildCalendarBuckets(from, to) {
  if (from >= to) {
    throw new Error('--from must be before --to');
  }
  const buckets = [];
  let cursor = new Date(from.getTime());
  while (cursor < to) {
    const nextMonth = addUtcMonth(cursor);
    const until = nextMonth < to ? nextMonth : to;
    buckets.push({
      since: dateOnly(cursor),
      until: dateOnly(until),
      month: dateOnly(cursor).slice(0, 7),
    });
    cursor = until;
  }
  return buckets;
}

function selectedSubjects(ids = null) {
  if (!ids || !ids.length) {
    return [...DEFAULT_SUBJECTS];
  }
  const byId = new Map(DEFAULT_SUBJECTS.map((subject) => [subject.id, subject]));
  return ids.map((id) => {
    const subject = byId.get(id);
    if (!subject) {
      throw new Error(`Unknown subject id: ${id}`);
    }
    return subject;
  });
}

function selectedTopics(ids = ['ux-love'], allTopics = false) {
  if (allTopics) {
    return [...DEFAULT_TOPICS];
  }
  const normalized = ids.map((id) => (id === 'overall' ? 'ux-love' : id));
  const byId = new Map(DEFAULT_TOPICS.map((topic) => [topic.id, topic]));
  return normalized.map((id) => {
    const topic = byId.get(id);
    if (!topic) {
      throw new Error(`Unknown topic id: ${id}. Only ux-love is supported for this sampler.`);
    }
    return topic;
  });
}

function compactSlug(value, fallback = 'bucket') {
  const slug = String(value || '')
    .toLowerCase()
    .replace(/["']/gu, '')
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 96);
  return slug || fallback;
}

function subjectQueryForLanguage(subject, language) {
  if (typeof subject.query === 'string') {
    return subject.query;
  }
  return subject.query?.[language] || subject.query?.en || Object.values(subject.query || {})[0] || '';
}

function buildSearchQuery(subject, topic, bucket, language) {
  const parts = [
    subjectQueryForLanguage(subject, language),
    topic?.terms || '',
    language ? `lang:${language}` : '',
    '-is:retweet',
    `since:${bucket.since}`,
    `until:${bucket.until}`,
  ].filter(Boolean);
  return parts.join(' ').replace(/\s+/gu, ' ').trim();
}

function buildXActionCommand(bucket, options) {
  const collectionMode = effectiveCollectionMode(options);
  const command = [
    'node',
    'src/entrypoints/sites/x-action.mjs',
    'search',
    '--query',
    bucket.query,
    '--reuse-login-state',
    '--no-session-health-plan',
    '--no-headless',
    '--max-items',
    String(bucket.maxItems),
    '--timeout',
    String(options.timeoutMs),
    '--out-dir',
    options.runsRoot,
    '--artifact-run-id',
    bucket.artifactRunId,
    '--json',
    '--quiet',
    '--progress',
    'plain',
    '--no-tty',
  ];
  if (collectionMode === 'page') {
    command.push('--no-api-cursor');
  } else {
    command.push('--api-cursor', 'true', '--max-api-pages', String(options.maxApiPages));
  }
  const maxScrolls = effectiveMaxScrolls(options);
  const scrollWaitMs = effectiveScrollWaitMs(options);
  if (maxScrolls !== null && maxScrolls !== undefined) {
    command.push('--max-scrolls', String(maxScrolls));
  }
  if (scrollWaitMs !== null && scrollWaitMs !== undefined) {
    command.push('--scroll-wait', String(scrollWaitMs));
  }
  return command;
}

function effectiveCollectionMode(options) {
  return options.collectionMode || DEFAULT_COLLECTION_MODE;
}

function effectiveMaxScrolls(options) {
  return effectiveCollectionMode(options) === 'page'
    ? options.maxScrolls ?? DEFAULT_PAGE_MAX_SCROLLS
    : options.maxScrolls;
}

function effectiveScrollWaitMs(options) {
  return effectiveCollectionMode(options) === 'page'
    ? options.scrollWaitMs ?? DEFAULT_PAGE_SCROLL_WAIT_MS
    : options.scrollWaitMs;
}

function inferCollectionModeFromCommand(command = []) {
  if (!Array.isArray(command)) {
    return null;
  }
  if (command.includes('--no-api-cursor')) {
    return 'page';
  }
  if (command.includes('--api-cursor')) {
    return 'api';
  }
  return null;
}

function buildTrendBuckets(options) {
  const from = parseDateOnly(options.from, '--from');
  const to = parseDateOnly(options.to, '--to');
  const periods = buildCalendarBuckets(from, to);
  const subjects = selectedSubjects(options.subjects);
  const topics = selectedTopics(options.topics, options.allTopics);
  const languages = options.languages || DEFAULT_LANGUAGES;
  const maxItems = options.mode === 'probe' ? options.probeItems : options.maxItems;
  const buckets = [];
  for (const period of periods) {
    for (const subject of subjects) {
      for (const language of languages) {
        for (const topic of topics) {
          const query = buildSearchQuery(subject, topic, period, language);
          const artifactRunId = compactSlug(
            `x-trend-${subject.id}-${language}-${topic.id}-${period.since}-${period.until}-${options.mode}`,
            'x-trend',
          );
          buckets.push({
            id: `${subject.id}:${language}:${topic.id}:${period.since}:${period.until}`,
            period,
            subject,
            language,
            topic,
            collectionMode: effectiveCollectionMode(options),
            query,
            maxItems,
            artifactRunId,
            status: 'pending',
            attempts: 0,
          });
        }
      }
    }
  }
  return buckets;
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function writeJsonl(filePath, items) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const lines = items.map((item) => JSON.stringify(item)).join('\n');
  await fs.writeFile(filePath, lines ? `${lines}\n` : '', 'utf8');
}

async function listManifestPaths(runsRoot) {
  let entries = [];
  try {
    entries = await fs.readdir(runsRoot, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
  const paths = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const manifestPath = path.join(runsRoot, entry.name, 'manifest.json');
    try {
      await fs.access(manifestPath);
      paths.push(manifestPath);
    } catch {
      // Not every directory under runsRoot is a social action run.
    }
  }
  return paths;
}

function manifestIsSearchRateLimited(manifest) {
  const runtimeRisk = manifest?.runtimeRisk || {};
  const riskState = runtimeRisk.riskState || {};
  const action = manifest?.plan?.action || manifest?.action || null;
  const taskId = riskState.taskId || null;
  return action === 'search'
    && (runtimeRisk.rateLimited === true || runtimeRisk.hardStop === true)
    && (
      runtimeRisk.stopReason === 'rate-limited'
      || manifest?.outcome?.reason === 'rate-limited'
      || riskState.state === 'rate_limited'
      || taskId === 'x:search'
    );
}

function runtimeRiskText(parsed, summarized) {
  const runtimeRisk = summarized?.runtimeRisk || parsed?.runtimeRisk || {};
  const riskState = runtimeRisk.riskState || {};
  return [
    parsed?.outcome?.status,
    parsed?.outcome?.reason,
    runtimeRisk.stopReason,
    runtimeRisk.suggestedAction,
    riskState.taskId,
    riskState.state,
    ...(Array.isArray(runtimeRisk.riskSignals) ? runtimeRisk.riskSignals : []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function isSameSurfaceSearchHardStop(parsed, summarized) {
  const runtimeRisk = summarized?.runtimeRisk || parsed?.runtimeRisk || {};
  const riskState = runtimeRisk.riskState || {};
  const taskId = riskState.taskId || null;
  if (taskId === 'x:search') {
    return true;
  }
  const text = runtimeRiskText(parsed, summarized);
  const hasApiLocalMarker = /\bapi\b|api-cursor|api cursor|cursor-rate|searchtimeline|search timeline|x:api/u.test(text);
  return runtimeRisk.hardStop === true
    && runtimeRisk.rateLimited === true
    && !hasApiLocalMarker;
}

function isApiLocalRateLimit(parsed, summarized) {
  const runtimeRisk = summarized?.runtimeRisk || parsed?.runtimeRisk || {};
  const riskState = runtimeRisk.riskState || {};
  const text = runtimeRiskText(parsed, summarized);
  const hasRateLimit = runtimeRisk.rateLimited === true
    || runtimeRisk.hardStop === true
    || parsed?.outcome?.status === 'blocked-risk';
  if (!hasRateLimit || isSameSurfaceSearchHardStop(parsed, summarized)) {
    return false;
  }
  const hasApiLocalMarker = /\bapi\b|api-cursor|api cursor|cursor-rate|searchtimeline|search timeline|x:api/u.test(text)
    || /api|cursor|searchtimeline/ui.test(String(riskState.taskId || ''));
  if (hasApiLocalMarker) {
    return true;
  }
  return runtimeRisk.rateLimited === true
    && runtimeRisk.hardStop !== true
    && parsed?.outcome?.status === 'blocked-risk';
}

function shouldFallbackApiRateLimitToPage({ parsed, summarized, options }) {
  return effectiveCollectionMode(options) === 'api'
    && options.apiRateLimitFallback === 'page'
    && isApiLocalRateLimit(parsed, summarized);
}

async function findSearchCooldownBlocker({ runsRoot, cooldownMinutes, now = new Date() }) {
  const manifestPaths = await listManifestPaths(runsRoot);
  let latest = null;
  for (const manifestPath of manifestPaths) {
    const manifest = await readJsonIfExists(manifestPath);
    if (!manifest || !manifestIsSearchRateLimited(manifest)) {
      continue;
    }
    const observedAt = new Date(manifest.generatedAt || manifest.finishedAt || 0);
    if (!Number.isFinite(observedAt.getTime())) {
      continue;
    }
    if (!latest || observedAt > latest.observedAt) {
      latest = {
        manifestPath,
        observedAt,
        manifest,
      };
    }
  }
  if (!latest) {
    return {
      blocked: false,
    };
  }
  const cooldownMs = cooldownMinutes * 60_000;
  const cooldownUntil = new Date(latest.observedAt.getTime() + cooldownMs);
  const remainingMs = Math.max(0, cooldownUntil.getTime() - now.getTime());
  return {
    blocked: remainingMs > 0,
    reason: 'search-rate-limited',
    manifestPath: latest.manifestPath,
    observedAt: latest.observedAt.toISOString(),
    cooldownUntil: cooldownUntil.toISOString(),
    remainingMs,
    taskId: latest.manifest.runtimeRisk?.riskState?.taskId || 'x:search',
  };
}

function createLanguageQuotas(options) {
  return Object.fromEntries((options.languages || DEFAULT_LANGUAGES).map((language) => [
    language,
    options.minLanguageSamples,
  ]));
}

function createInitialState(options, buckets) {
  const targetPerBucket = Math.ceil(options.targetSamples / Math.max(1, buckets.length));
  const collectionMode = effectiveCollectionMode(options);
  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: 'planned',
    request: {
      from: options.from,
      to: options.to,
      mode: options.mode,
      languages: [...(options.languages || DEFAULT_LANGUAGES)],
      targetSamples: options.targetSamples,
      effectiveMinTotal: options.effectiveMinTotal,
      languageQuotas: createLanguageQuotas(options),
      targetPerBucket,
      collectionMode,
      maxApiPages: options.maxApiPages,
      maxScrolls: effectiveMaxScrolls(options),
      scrollWaitMs: effectiveScrollWaitMs(options),
      probeItems: options.probeItems,
      maxItems: options.maxItems,
      cooldownMinutes: options.cooldownMinutes,
      delayMs: options.delayMs,
      maxBucketsPerRun: options.maxBucketsPerRun,
      adaptiveThrottle: options.adaptiveThrottle,
      recentRateLimitWindowMinutes: options.recentRateLimitWindowMinutes,
      postCooldownThrottleMs: options.postCooldownThrottleMs,
      apiRateLimitFallback: options.apiRateLimitFallback,
      subjects: buckets.length ? [...new Set(buckets.map((bucket) => bucket.subject.id))] : [],
      topics: ['ux-love'],
    },
    summary: null,
    cooldown: {
      blocked: false,
    },
    buckets,
  };
}

function mergeResumeState(existing, planned) {
  if (!existing) {
    return planned;
  }
  const existingById = new Map((existing.buckets || []).map((bucket) => [bucket.id, bucket]));
  return {
    ...planned,
    generatedAt: existing.generatedAt || planned.generatedAt,
    updatedAt: new Date().toISOString(),
    status: existing.status === 'complete' ? 'complete' : 'planned',
    cooldown: existing.cooldown || planned.cooldown,
    buckets: planned.buckets.map((bucket) => {
      const existingBucket = existingById.get(bucket.id) || {};
      return {
        ...bucket,
        ...existingBucket,
        query: bucket.query,
        maxItems: bucket.maxItems,
        artifactRunId: bucket.artifactRunId,
        collectionMode: existingBucket.collectionMode || inferCollectionModeFromCommand(existingBucket.command) || bucket.collectionMode,
        subject: bucket.subject,
        topic: bucket.topic,
        language: bucket.language,
        period: bucket.period,
      };
    }),
  };
}

function summarizeRuntimeResult(result) {
  return {
    ok: result?.ok === true,
    outcome: result?.outcome || null,
    completeness: result?.completeness || null,
    runtimeRisk: result?.runtimeRisk
      ? {
          rateLimited: result.runtimeRisk.rateLimited === true,
          hardStop: result.runtimeRisk.hardStop === true,
          stopReason: result.runtimeRisk.stopReason || null,
          riskSignals: Array.isArray(result.runtimeRisk.riskSignals) ? result.runtimeRisk.riskSignals : [],
          suggestedAction: result.runtimeRisk.suggestedAction || null,
          riskState: result.runtimeRisk.riskState || null,
        }
      : null,
    artifacts: result?.artifacts
      ? {
          runDir: result.artifacts.runDir || null,
          manifest: result.artifacts.manifest || null,
          items: result.artifacts.items || null,
          report: result.artifacts.report || null,
        }
      : null,
    itemCount: Array.isArray(result?.result?.items) ? result.result.items.length : null,
  };
}

function executeCommand(command, args, { cwd = process.cwd() } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('close', (exitCode) => {
      resolve({
        exitCode,
        stdout,
        stderr,
      });
    });
  });
}

function parseXActionJson(stdout) {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return null;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new Error('x-action did not produce parseable JSON');
  }
}

function keywordCount(text, keywords) {
  const lower = String(text || '').toLowerCase();
  return keywords.reduce((count, keyword) => count + (keywordMatches(lower, keyword) ? 1 : 0), 0);
}

function keywordHits(text, keywords) {
  const lower = String(text || '').toLowerCase();
  return keywords.filter((keyword) => keywordMatches(lower, keyword));
}

function keywordMatches(lowerText, keyword) {
  const lowerKeyword = String(keyword || '').toLowerCase();
  if (/[^\u0000-\u007f]/u.test(lowerKeyword)) {
    return lowerText.includes(lowerKeyword);
  }
  const escaped = lowerKeyword.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&').replace(/\s+/gu, '\\s+');
  const prefix = /^[a-z0-9]/u.test(lowerKeyword) ? '(^|[^a-z0-9])' : '';
  const suffix = /[a-z0-9]$/u.test(lowerKeyword) ? '([^a-z0-9]|$)' : '';
  return new RegExp(`${prefix}${escaped}${suffix}`, 'u').test(lowerText);
}

function classifyItem(itemOrText) {
  const text = typeof itemOrText === 'string' ? itemOrText : extractText(itemOrText);
  const scores = Object.fromEntries(Object.entries(SIGNAL_KEYWORDS).map(([signal, keywords]) => [
    signal,
    keywordCount(text, keywords),
  ]));
  const exclusionMatches = Object.fromEntries(Object.entries(EXCLUSION_KEYWORDS).map(([reason, keywords]) => [
    reason,
    keywordHits(text, keywords),
  ]).filter(([, hits]) => hits.length > 0));
  const exclusionReasons = Object.keys(exclusionMatches);
  const dimensions = [];
  if (scores.ux > 0 || scores.migration > 0 || scores.comparison > 0) {
    dimensions.push('userExperience');
  }
  if (
    scores.lovePositive > 0
    || scores.frustratedNegative > 0
    || scores.recommendation > 0
    || scores.migration > 0
  ) {
    dimensions.push('userLove');
  }
  const hasUxLoveSignal = dimensions.length > 0;
  const hasExperienceContext = scores.ux > 0
    || scores.recommendation > 0
    || scores.migration > 0
    || scores.comparison > 0;
  const sentiment = scores.lovePositive > 0 && scores.frustratedNegative > 0
    ? 'mixed'
    : scores.frustratedNegative > 0
      ? 'frustrated/negative'
      : scores.lovePositive > 0 || scores.recommendation > 0
        ? 'love/positive'
        : 'neutral/weak-signal';
  const exclusionDominant = exclusionReasons.length > 0 && !hasExperienceContext;
  const excluded = !hasUxLoveSignal || exclusionDominant;
  return {
    isUxLove: !excluded,
    excluded,
    exclusionReasons: excluded
      ? [...(!hasUxLoveSignal ? ['no-ux-love-signal'] : []), ...(exclusionDominant ? ['excluded-topic-dominant'] : []), ...exclusionReasons]
      : exclusionReasons,
    sentiment,
    dimensions,
    signals: Object.entries(scores).filter(([, count]) => count > 0).map(([signal]) => signal),
    scores,
    exclusionMatches,
  };
}

function extractText(item) {
  if (!item || typeof item !== 'object') {
    return '';
  }
  return String(
    item.text
      || item.fullText
      || item.full_text
      || item.content
      || item.rawContent
      || item.note
      || item.tweet?.text
      || item.legacy?.full_text
      || '',
  );
}

function extractItemId(item) {
  return item?.id
    || item?.rest_id
    || item?.tweetId
    || item?.tweet_id
    || item?.url
    || item?.permalink
    || item?.legacy?.id_str
    || null;
}

function extractUrl(item) {
  return item?.url
    || item?.permalink
    || item?.tweetUrl
    || item?.tweet_url
    || null;
}

function extractCreatedAt(item) {
  return item?.createdAt
    || item?.created_at
    || item?.date
    || item?.timestamp
    || item?.legacy?.created_at
    || null;
}

function extractAuthor(item) {
  return item?.author
    || item?.username
    || item?.user?.screen_name
    || item?.user?.username
    || item?.core?.user_results?.result?.legacy?.screen_name
    || null;
}

function normalizeTextForDedupe(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/https?:\/\/\S+/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

function dedupeKeyForItem(item) {
  const id = item.itemId || extractItemId(item.raw);
  if (id) {
    return `id:${id}`;
  }
  const url = item.url || extractUrl(item.raw);
  if (url) {
    return `url:${url}`;
  }
  return `text:${normalizeTextForDedupe(item.text).slice(0, 500)}:${item.createdAt || ''}`;
}

function resolveMaybeRelative(filePath) {
  if (!filePath) {
    return null;
  }
  return path.isAbsolute(filePath) ? filePath : path.resolve(filePath);
}

async function readItemsJsonl(itemsPath) {
  const resolvedPath = resolveMaybeRelative(itemsPath);
  if (!resolvedPath) {
    return [];
  }
  try {
    const text = await fs.readFile(resolvedPath, 'utf8');
    return text
      .split(/\r?\n/u)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

function incrementCounter(object, key, amount = 1) {
  object[key] = (object[key] || 0) + amount;
}

async function collectRawItems(state) {
  const rawItems = [];
  for (const bucket of state.buckets || []) {
    const itemsPath = bucket.result?.artifacts?.items || bucket.artifacts?.items || null;
    const items = await readItemsJsonl(itemsPath);
    for (const item of items) {
      const text = extractText(item);
      rawItems.push({
        sourceBucketId: bucket.id,
        subjectId: bucket.subject?.id || null,
        subjectLabel: bucket.subject?.label || null,
        compareGroup: bucket.subject?.compareGroup || null,
        language: bucket.language || null,
        collectionMode: bucket.collectionMode || inferCollectionModeFromCommand(bucket.command) || state.request?.collectionMode || null,
        topicId: bucket.topic?.id || 'ux-love',
        since: bucket.period?.since || null,
        until: bucket.period?.until || null,
        month: bucket.period?.month || bucket.period?.since?.slice(0, 7) || null,
        query: bucket.query || null,
        itemId: extractItemId(item),
        url: extractUrl(item),
        createdAt: extractCreatedAt(item),
        author: extractAuthor(item),
        text,
        raw: item,
      });
    }
  }
  return rawItems;
}

function dedupeItems(rawItems) {
  const seen = new Map();
  for (const item of rawItems) {
    const key = dedupeKeyForItem(item);
    if (seen.has(key)) {
      continue;
    }
    seen.set(key, {
      ...item,
      dedupeKey: key,
    });
  }
  return [...seen.values()];
}

function filterUxLoveItems(dedupedItems) {
  return dedupedItems
    .map((item) => {
      const classification = classifyItem(item);
      return {
        ...item,
        classification,
        sentiment: classification.sentiment,
        dimensions: classification.dimensions,
        signals: classification.signals,
      };
    })
    .filter((item) => item.classification.isUxLove);
}

function emptySentimentCounts() {
  return {
    'love/positive': 0,
    'frustrated/negative': 0,
    mixed: 0,
    'neutral/weak-signal': 0,
  };
}

function summarizeItems(items) {
  const sentiment = emptySentimentCounts();
  const dimensions = {};
  const signals = {};
  for (const item of items) {
    incrementCounter(sentiment, item.sentiment || item.classification?.sentiment || 'neutral/weak-signal');
    for (const dimension of item.dimensions || item.classification?.dimensions || []) {
      incrementCounter(dimensions, dimension);
    }
    for (const signal of item.signals || item.classification?.signals || []) {
      incrementCounter(signals, signal);
    }
  }
  const count = items.length;
  return {
    count,
    sentiment,
    dimensions,
    signals,
    loveRate: count ? roundRate((sentiment['love/positive'] + sentiment.mixed * 0.5) / count) : null,
    frustrationRate: count ? roundRate((sentiment['frustrated/negative'] + sentiment.mixed * 0.5) / count) : null,
  };
}

function roundRate(value) {
  return Math.round(value * 1000) / 1000;
}

function groupItems(items, keyFn) {
  const groups = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(item);
  }
  return groups;
}

function buildBucketSummaryRows(state, rawItems, dedupedItems, uxLoveItems) {
  const rawByBucket = groupItems(rawItems, (item) => item.sourceBucketId);
  const dedupedByBucket = groupItems(dedupedItems, (item) => item.sourceBucketId);
  const uxByBucket = groupItems(uxLoveItems, (item) => item.sourceBucketId);
  return (state.buckets || []).map((bucket) => {
    const bucketUxItems = uxByBucket.get(bucket.id) || [];
    const itemSummary = summarizeItems(bucketUxItems);
    return {
      bucketId: bucket.id,
      status: bucket.status,
      subjectId: bucket.subject?.id || null,
      subjectLabel: bucket.subject?.label || null,
      compareGroup: bucket.subject?.compareGroup || null,
      language: bucket.language || null,
      collectionMode: bucket.collectionMode || inferCollectionModeFromCommand(bucket.command) || state.request?.collectionMode || null,
      topicId: bucket.topic?.id || 'ux-love',
      since: bucket.period?.since || null,
      until: bucket.period?.until || null,
      month: bucket.period?.month || bucket.period?.since?.slice(0, 7) || null,
      query: bucket.query || null,
      maxItems: bucket.maxItems || null,
      rawItems: (rawByBucket.get(bucket.id) || []).length,
      dedupedItems: (dedupedByBucket.get(bucket.id) || []).length,
      uxLoveItems: bucketUxItems.length,
      sentiment: itemSummary.sentiment,
      loveRate: itemSummary.loveRate,
      frustrationRate: itemSummary.frustrationRate,
      outcome: bucket.result?.outcome || null,
      runtimeRisk: bucket.result?.runtimeRisk || null,
      artifacts: bucket.result?.artifacts || null,
    };
  });
}

function buildGroupRows(items, keys) {
  const groups = groupItems(items, (item) => keys.map((key) => item[key] || '').join('|'));
  return [...groups.entries()]
    .map(([groupKey, groupItemsValue]) => {
      const row = {};
      const parts = groupKey.split('|');
      keys.forEach((key, index) => {
        row[key] = parts[index] || null;
      });
      return {
        ...row,
        ...summarizeItems(groupItemsValue),
      };
    })
    .sort((a, b) => keys.map((key) => String(a[key] || '').localeCompare(String(b[key] || ''))).find((value) => value !== 0) || 0);
}

function buildPairComparison(label, aId, bId, items) {
  const aItems = items.filter((item) => item.subjectId === aId);
  const bItems = items.filter((item) => item.subjectId === bId);
  return {
    label,
    a: {
      subjectId: aId,
      ...summarizeItems(aItems),
    },
    b: {
      subjectId: bId,
      ...summarizeItems(bItems),
    },
    directionalRead: compareSummaries(aId, summarizeItems(aItems), bId, summarizeItems(bItems)),
  };
}

function compareSummaries(aId, aSummary, bId, bSummary) {
  if (!aSummary.count || !bSummary.count) {
    return 'insufficient valid UX/love samples for one or both sides';
  }
  if (aSummary.loveRate === bSummary.loveRate) {
    return `${aId} and ${bId} have similar observed love rates`;
  }
  const winner = aSummary.loveRate > bSummary.loveRate ? aId : bId;
  return `${winner} has the higher observed love rate in this directional sample`;
}

function buildRefillPlan(summary, bucketRows, state) {
  const neededTotal = Math.max(0, (summary.acceptance.effectiveMinTotal || 0) - summary.totals.uxLoveItems);
  const languageNeeds = {};
  for (const [language, quota] of Object.entries(summary.acceptance.languageQuotas || {})) {
    const count = summary.totals.byLanguage[language] || 0;
    if (count < quota) {
      languageNeeds[language] = quota - count;
    }
  }
  const selectedSubjectsSet = new Set((state.buckets || []).map((bucket) => bucket.subject?.id).filter(Boolean));
  const perSubjectTarget = selectedSubjectsSet.size
    ? Math.ceil(summary.acceptance.effectiveMinTotal / selectedSubjectsSet.size)
    : 0;
  const subjectNeeds = {};
  for (const subjectId of selectedSubjectsSet) {
    const count = summary.totals.bySubject[subjectId] || 0;
    if (count < perSubjectTarget) {
      subjectNeeds[subjectId] = perSubjectTarget - count;
    }
  }
  const needsRefill = neededTotal > 0 || Object.keys(languageNeeds).length > 0;
  const rankedRows = bucketRows
    .filter((row) => needsRefill && (
      Object.prototype.hasOwnProperty.call(languageNeeds, row.language)
      || Object.prototype.hasOwnProperty.call(subjectNeeds, row.subjectId)
      || neededTotal > 0
    ))
    .sort((a, b) => (a.uxLoveItems - b.uxLoveItems) || String(a.bucketId).localeCompare(String(b.bucketId)));
  const recommendedCollectionMode = state.request?.collectionMode || DEFAULT_COLLECTION_MODE;
  const recommendedMaxScrolls = state.request?.maxScrolls ?? (
    recommendedCollectionMode === 'page' ? DEFAULT_PAGE_MAX_SCROLLS : null
  );
  const recommendedScrollWaitMs = state.request?.scrollWaitMs ?? (
    recommendedCollectionMode === 'page' ? DEFAULT_PAGE_SCROLL_WAIT_MS : null
  );
  return {
    neededTotal,
    languageNeeds,
    subjectNeeds,
    suggestedBuckets: rankedRows.slice(0, 30).map((row, index) => ({
      refillBucketId: `${row.bucketId}:refill:${index + 1}`,
      sourceBucketId: row.bucketId,
      subjectId: row.subjectId,
      language: row.language,
      since: row.since,
      until: row.until,
      reason: refillReason(row, languageNeeds, subjectNeeds, neededTotal),
      recommendedCollectionMode,
      recommendedMaxItems: row.maxItems || null,
      recommendedMaxScrolls,
      recommendedScrollWaitMs,
      query: row.query,
    })),
  };
}

function refillReason(row, languageNeeds, subjectNeeds, neededTotal) {
  const reasons = [];
  if (neededTotal > 0) {
    reasons.push('total-effective-samples-under-minimum');
  }
  if (Object.prototype.hasOwnProperty.call(languageNeeds, row.language)) {
    reasons.push(`${row.language}-language-quota-under-minimum`);
  }
  if (Object.prototype.hasOwnProperty.call(subjectNeeds, row.subjectId)) {
    reasons.push(`${row.subjectId}-subject-under-distributed-target`);
  }
  return reasons.join(';');
}

function buildTrendSummary(state, artifacts) {
  const { rawItems, dedupedItems, uxLoveItems, bucketRows } = artifacts;
  const totals = {
    buckets: bucketRows.length,
    completed: bucketRows.filter((row) => bucketStatusIsComplete(row.status)).length,
    blocked: bucketRows.filter((row) => row.status === 'blocked').length,
    pending: bucketRows.filter((row) => row.status === 'pending').length,
    failed: bucketRows.filter((row) => row.status === 'failed').length,
    rawItems: rawItems.length,
    dedupedItems: dedupedItems.length,
    uxLoveItems: uxLoveItems.length,
    rawByLanguage: {},
    dedupedByLanguage: {},
    byLanguage: {},
    rawBySubject: {},
    dedupedBySubject: {},
    bySubject: {},
    byCollectionMode: {},
    rawByCollectionMode: {},
    sentiment: emptySentimentCounts(),
  };
  for (const item of rawItems) {
    incrementCounter(totals.rawByLanguage, item.language || 'unknown');
    incrementCounter(totals.rawBySubject, item.subjectId || 'unknown');
    incrementCounter(totals.rawByCollectionMode, item.collectionMode || 'unknown');
  }
  for (const item of dedupedItems) {
    incrementCounter(totals.dedupedByLanguage, item.language || 'unknown');
    incrementCounter(totals.dedupedBySubject, item.subjectId || 'unknown');
  }
  for (const item of uxLoveItems) {
    incrementCounter(totals.byLanguage, item.language || 'unknown');
    incrementCounter(totals.bySubject, item.subjectId || 'unknown');
    incrementCounter(totals.byCollectionMode, item.collectionMode || 'unknown');
    incrementCounter(totals.sentiment, item.sentiment || 'neutral/weak-signal');
  }
  const acceptance = {
    effectiveMinTotal: state.request?.effectiveMinTotal || DEFAULT_EFFECTIVE_MIN_TOTAL,
    languageQuotas: state.request?.languageQuotas || {},
    totalOk: uxLoveItems.length >= (state.request?.effectiveMinTotal || DEFAULT_EFFECTIVE_MIN_TOTAL),
    languageOk: Object.entries(state.request?.languageQuotas || {}).every(([language, quota]) => (
      (totals.byLanguage[language] || 0) >= quota
    )),
  };
  acceptance.ok = acceptance.totalOk && acceptance.languageOk;
  const summary = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    status: state.status,
    request: state.request || null,
    totals,
    acceptance,
    bucketRows,
    monthly: buildGroupRows(uxLoveItems, ['month', 'language']),
    subjectMonthly: buildGroupRows(uxLoveItems, ['subjectId', 'month', 'language']),
    subjectTotals: buildGroupRows(uxLoveItems, ['subjectId', 'language']),
    comparisons: [
      buildPairComparison('Codex vs Claude Code UX', 'codex-product', 'claude-code-product', uxLoveItems),
      buildPairComparison('ChatGPT vs Claude User Love', 'chatgpt-product', 'claude-product', uxLoveItems),
      buildPairComparison('GPT Family vs Claude Family Model Experience', 'gpt-model-family', 'claude-model-family', uxLoveItems),
    ],
  };
  summary.yieldProjection = buildYieldProjection(summary, bucketRows);
  summary.refillPlan = buildRefillPlan(summary, bucketRows, state);
  return summary;
}

function buildYieldProjection(summary, bucketRows) {
  const completedRows = bucketRows.filter((row) => bucketStatusIsComplete(row.status));
  const rawToUxLoveRate = summary.totals.rawItems
    ? roundRate(summary.totals.uxLoveItems / summary.totals.rawItems)
    : 0;
  const dedupedToUxLoveRate = summary.totals.dedupedItems
    ? roundRate(summary.totals.uxLoveItems / summary.totals.dedupedItems)
    : 0;
  const avgRawPerCompletedBucket = completedRows.length
    ? roundRate(summary.totals.rawItems / completedRows.length)
    : 0;
  const neededEffectiveTotal = Math.max(0, summary.acceptance.effectiveMinTotal - summary.totals.uxLoveItems);
  const estimatedRawNeededTotal = rawToUxLoveRate > 0
    ? Math.ceil(neededEffectiveTotal / rawToUxLoveRate)
    : null;
  const estimatedBucketsNeededTotal = estimatedRawNeededTotal !== null && avgRawPerCompletedBucket > 0
    ? Math.ceil(estimatedRawNeededTotal / avgRawPerCompletedBucket)
    : null;
  const languages = Object.keys(summary.acceptance.languageQuotas || {});
  const byLanguage = {};
  for (const language of languages) {
    const raw = summary.totals.rawByLanguage[language] || 0;
    const uxLove = summary.totals.byLanguage[language] || 0;
    const quota = summary.acceptance.languageQuotas[language] || 0;
    const rate = raw ? roundRate(uxLove / raw) : 0;
    const neededUxLove = Math.max(0, quota - uxLove);
    byLanguage[language] = {
      raw,
      deduped: summary.totals.dedupedByLanguage[language] || 0,
      uxLove,
      quota,
      rawToUxLoveRate: rate,
      neededUxLove,
      estimatedRawNeeded: rate > 0 ? Math.ceil(neededUxLove / rate) : null,
    };
  }
  return {
    rawToUxLoveRate,
    dedupedToUxLoveRate,
    avgRawPerCompletedBucket,
    neededEffectiveTotal,
    estimatedRawNeededTotal,
    estimatedBucketsNeededTotal,
    byLanguage,
  };
}

function bucketStatusIsComplete(status) {
  return status === 'completed' || status === 'captured_with_warning';
}

function hasIncompleteBuckets(state) {
  return (state.buckets || []).some((bucket) => !bucketStatusIsComplete(bucket.status) && bucket.status !== 'failed');
}

function blockedBucketHasUsableItems(bucket) {
  return bucket?.status === 'blocked' && Boolean(bucket.result?.artifacts?.items);
}

async function markBucketCapturedWithWarning(bucket, options, reason, extra = {}) {
  const now = new Date().toISOString();
  const existingArtifacts = bucket.result?.artifacts || null;
  let artifacts = existingArtifacts;
  let source = 'partial-artifact';
  if (!artifacts?.items) {
    source = extra.source || 'empty-degraded-terminal';
    const runDir = path.join(options.outDir, 'no-wait-fallback', compactSlug(bucket.id), source);
    const itemsPath = path.join(runDir, 'items.jsonl');
    await writeJsonl(itemsPath, []);
    artifacts = {
      runDir,
      manifest: null,
      items: itemsPath,
      report: null,
    };
  }
  bucket.status = 'captured_with_warning';
  bucket.warning = reason;
  bucket.noWaitFallback = {
    source,
    reason,
    blocker: extra.blocker || null,
    observedAt: now,
  };
  bucket.result = {
    ...(bucket.result || {}),
    ok: true,
    outcome: {
      status: 'captured_with_warning',
      reason,
      resumable: false,
    },
    artifacts,
    itemCount: bucket.result?.itemCount ?? 0,
  };
  if (bucket.fallback) {
    bucket.fallback.status = 'captured_with_warning';
  }
  return bucket;
}

function renderCountRate(row) {
  if (!row || row.count === 0) {
    return '0 samples';
  }
  const love = row.loveRate === null ? '-' : `${Math.round(row.loveRate * 100)}%`;
  const frustration = row.frustrationRate === null ? '-' : `${Math.round(row.frustrationRate * 100)}%`;
  return `${row.count} samples, love ${love}, frustration ${frustration}`;
}

function renderComparison(comparison) {
  return [
    `- ${comparison.a.subjectId}: ${renderCountRate(comparison.a)}`,
    `- ${comparison.b.subjectId}: ${renderCountRate(comparison.b)}`,
    `- Directional read: ${comparison.directionalRead}`,
  ].join('\n');
}

function renderSummaryMarkdown(summary) {
  const languageRows = Object.keys(summary.acceptance.languageQuotas || {}).map((language) => {
    const count = summary.totals.byLanguage[language] || 0;
    const quota = summary.acceptance.languageQuotas[language];
    return `- ${language}: ${count}/${quota}`;
  });
  const monthlyRows = summary.monthly.length
    ? summary.monthly.map((row) => `- ${row.month} ${row.language}: ${renderCountRate(row)}`)
    : ['- No valid UX/love samples collected yet.'];
  const collectionRows = Object.entries(summary.totals.byCollectionMode || {}).length
    ? Object.entries(summary.totals.byCollectionMode).map(([mode, count]) => `- ${mode}: ux-love=${count}, raw=${summary.totals.rawByCollectionMode?.[mode] || 0}`)
    : ['- No collected samples yet.'];
  const projectionRows = [
    `- Raw to UX/love rate: ${Math.round((summary.yieldProjection?.rawToUxLoveRate || 0) * 100)}%`,
    `- Deduped to UX/love rate: ${Math.round((summary.yieldProjection?.dedupedToUxLoveRate || 0) * 100)}%`,
    `- Avg raw per completed bucket: ${summary.yieldProjection?.avgRawPerCompletedBucket ?? 0}`,
    `- Estimated raw still needed: ${summary.yieldProjection?.estimatedRawNeededTotal ?? 'unknown'}`,
    `- Estimated completed buckets still needed: ${summary.yieldProjection?.estimatedBucketsNeededTotal ?? 'unknown'}`,
  ];
  const languageProjectionRows = Object.entries(summary.yieldProjection?.byLanguage || {}).map(([language, projection]) => (
    `- ${language}: need ${projection.neededUxLove} UX/love, estimated raw needed ${projection.estimatedRawNeeded ?? 'unknown'}, current raw->UX/love ${Math.round((projection.rawToUxLoveRate || 0) * 100)}%`
  ));
  const subjectMonthlyRows = summary.subjectMonthly.length
    ? summary.subjectMonthly.slice(0, 80).map((row) => `| ${row.subjectId} | ${row.month} | ${row.language} | ${row.count} | ${row.sentiment['love/positive']} | ${row.sentiment['frustrated/negative']} | ${row.sentiment.mixed} | ${row.sentiment['neutral/weak-signal']} | ${row.loveRate ?? '-'} |`)
    : ['| - | - | - | 0 | 0 | 0 | 0 | 0 | - |'];
  const lines = [
    '# X UX and User Love Trend Summary',
    '',
    `Generated: ${summary.generatedAt}`,
    `Status: ${summary.status}`,
    `Buckets: ${summary.totals.completed}/${summary.totals.buckets} completed, ${summary.totals.blocked} blocked, ${summary.totals.failed} failed, ${summary.totals.pending} pending`,
    `Samples: raw=${summary.totals.rawItems}, deduped=${summary.totals.dedupedItems}, ux-love=${summary.totals.uxLoveItems}`,
    `Acceptance: total ${summary.totals.uxLoveItems}/${summary.acceptance.effectiveMinTotal}, ok=${summary.acceptance.ok}`,
    '',
    '## Collection mode and yield',
    ...collectionRows,
    ...projectionRows,
    ...(languageProjectionRows.length ? languageProjectionRows : ['- No language projection available.']),
    '',
    '## Overall love trend',
    ...monthlyRows,
    '',
    '## Chinese vs English differences',
    ...(languageRows.length ? languageRows : ['- No language quota configured.']),
    `- Sentiment: love/positive=${summary.totals.sentiment['love/positive']}, frustrated/negative=${summary.totals.sentiment['frustrated/negative']}, mixed=${summary.totals.sentiment.mixed}, neutral/weak-signal=${summary.totals.sentiment['neutral/weak-signal']}`,
    '',
    '## Subject monthly changes',
    '| Subject | Month | Language | Samples | Love/positive | Frustrated/negative | Mixed | Neutral/weak | Love rate |',
    '| - | - | - | -: | -: | -: | -: | -: | -: |',
    ...subjectMonthlyRows,
    '',
    '## Codex vs Claude Code UX',
    renderComparison(summary.comparisons[0]),
    '',
    '## ChatGPT vs Claude User Love',
    renderComparison(summary.comparisons[1]),
    '',
    '## GPT Family vs Claude Family Model Experience',
    renderComparison(summary.comparisons[2]),
    '',
    '## Refill Plan',
    `- Needed total effective samples: ${summary.refillPlan.neededTotal}`,
    `- Language needs: ${Object.entries(summary.refillPlan.languageNeeds).map(([key, value]) => `${key}=${value}`).join(', ') || 'none'}`,
    `- Suggested refill buckets: ${summary.refillPlan.suggestedBuckets.length}`,
    '',
    '## Sample Boundaries',
    '- X latest-search samples are directional signals from collected public posts, not a statistically representative poll.',
    '- Live queries are split only by subject, language, and month; pricing, safety, legal, funding, governance, advertising, recruiting, and news-only samples are excluded unless they explicitly carry UX or user-love signals.',
    '',
  ];
  return lines.join('\n');
}

function renderBucketCsv(rows) {
  const headers = [
    'bucketId',
    'status',
    'subjectId',
    'collectionMode',
    'language',
    'since',
    'until',
    'rawItems',
    'dedupedItems',
    'uxLoveItems',
    'lovePositive',
    'frustratedNegative',
    'mixed',
    'neutralWeakSignal',
    'loveRate',
    'frustrationRate',
    'query',
  ];
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((header) => csvValue(bucketCsvValue(row, header))).join(','));
  }
  return `${lines.join('\n')}\n`;
}

function bucketCsvValue(row, header) {
  switch (header) {
    case 'lovePositive':
      return row.sentiment['love/positive'];
    case 'frustratedNegative':
      return row.sentiment['frustrated/negative'];
    case 'neutralWeakSignal':
      return row.sentiment['neutral/weak-signal'];
    default:
      return row[header] ?? '';
  }
}

function csvValue(value) {
  const stringValue = String(value ?? '');
  if (/[",\n\r]/u.test(stringValue)) {
    return `"${stringValue.replace(/"/gu, '""')}"`;
  }
  return stringValue;
}

async function buildAnalysisArtifacts(state) {
  const rawItems = await collectRawItems(state);
  const dedupedItems = dedupeItems(rawItems);
  const uxLoveItems = filterUxLoveItems(dedupedItems);
  const bucketRows = buildBucketSummaryRows(state, rawItems, dedupedItems, uxLoveItems);
  const summary = buildTrendSummary(state, {
    rawItems,
    dedupedItems,
    uxLoveItems,
    bucketRows,
  });
  return {
    rawItems,
    dedupedItems,
    uxLoveItems,
    bucketRows,
    summary,
  };
}

async function writeSummaryFiles(state, outDir) {
  const artifacts = await buildAnalysisArtifacts(state);
  await writeJsonl(path.join(outDir, 'raw-items.jsonl'), artifacts.rawItems);
  await writeJsonl(path.join(outDir, 'deduped-items.jsonl'), artifacts.dedupedItems);
  await writeJsonl(path.join(outDir, 'ux-love-items.jsonl'), artifacts.uxLoveItems);
  await writeJson(path.join(outDir, 'bucket-summary.json'), artifacts.bucketRows);
  await fs.writeFile(path.join(outDir, 'bucket-summary.csv'), renderBucketCsv(artifacts.bucketRows), 'utf8');
  await writeJson(path.join(outDir, 'trend-summary.json'), artifacts.summary);
  await fs.writeFile(path.join(outDir, 'trend-summary.md'), renderSummaryMarkdown(artifacts.summary), 'utf8');
  await writeJson(path.join(outDir, 'partial-trend-summary.json'), artifacts.summary);
  await fs.writeFile(path.join(outDir, 'partial-trend-summary.md'), renderSummaryMarkdown(artifacts.summary), 'utf8');
  return artifacts.summary;
}

function recentRateLimitAgeMs(blocker, now = new Date()) {
  if (!blocker?.observedAt) {
    return null;
  }
  const observedAt = new Date(blocker.observedAt);
  if (!Number.isFinite(observedAt.getTime())) {
    return null;
  }
  return Math.max(0, now.getTime() - observedAt.getTime());
}

function shouldApplyAdaptiveThrottle(blocker, options, now = new Date()) {
  if (options.adaptiveThrottle !== true || blocker?.blocked === true || !blocker?.observedAt) {
    return false;
  }
  const ageMs = recentRateLimitAgeMs(blocker, now);
  if (ageMs === null) {
    return false;
  }
  const windowMs = Math.max(0, Number(options.recentRateLimitWindowMinutes || 0)) * 60_000;
  return windowMs > 0 && ageMs <= windowMs && Number(options.postCooldownThrottleMs || 0) > 0;
}

async function maybeApplyAdaptiveThrottle({ blocker, options, state, bucket, statePath, sleep }) {
  if (!shouldApplyAdaptiveThrottle(blocker, options)) {
    return null;
  }
  const delayMs = Number(options.postCooldownThrottleMs || 0);
  const throttle = {
    active: true,
    reason: 'recent-search-rate-limit',
    delayMs,
    bucketId: bucket.id,
    observedAt: blocker.observedAt || null,
    cooldownUntil: blocker.cooldownUntil || null,
    appliedAt: new Date().toISOString(),
  };
  state.throttle = throttle;
  state.updatedAt = new Date().toISOString();
  await writeJson(statePath, state);
  await sleep(delayMs);
  state.throttle = {
    ...throttle,
    active: false,
    completedAt: new Date().toISOString(),
  };
  state.updatedAt = new Date().toISOString();
  await writeJson(statePath, state);
  return throttle;
}

async function runTrendSampler(rawOptions, deps = {}) {
  if (rawOptions.help) {
    return {
      ok: true,
      help: usage(),
    };
  }
  const options = {
    ...rawOptions,
    from: rawOptions.from || DEFAULT_FROM,
    to: rawOptions.to || DEFAULT_TO,
    outDir: path.resolve(rawOptions.outDir),
    runsRoot: path.resolve(rawOptions.runsRoot),
  };
  const statePath = path.resolve(rawOptions.statePath || path.join(options.outDir, 'trend-run-state.json'));
  if (options.refreshSummary) {
    const state = await readJsonIfExists(statePath);
    if (!state) {
      throw new Error(`Cannot refresh summary because state does not exist: ${statePath}`);
    }
    await fs.mkdir(options.outDir, { recursive: true });
    state.summary = await writeSummaryFiles(state, options.outDir);
    state.summaryRefreshedAt = new Date().toISOString();
    await writeJson(statePath, state);
    return {
      ok: true,
      status: state.status || 'summary-refreshed',
      statePath,
      summaryPath: path.join(options.outDir, 'trend-summary.json'),
      refreshed: true,
    };
  }
  const plannedState = createInitialState(options, buildTrendBuckets(options));
  const existing = rawOptions.resume ? await readJsonIfExists(statePath) : null;
  const state = mergeResumeState(existing, plannedState);
  state.status = options.execute ? 'running' : 'planned';
  state.updatedAt = new Date().toISOString();

  const findBlocker = deps.findSearchCooldownBlocker || findSearchCooldownBlocker;
  const execute = deps.executeCommand || executeCommand;
  const sleep = deps.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));

  await fs.mkdir(options.outDir, { recursive: true });

  if (!options.execute) {
    for (const bucket of state.buckets) {
      bucket.command = buildXActionCommand(bucket, options);
    }
    state.summary = await writeSummaryFiles(state, options.outDir);
    await writeJson(statePath, state);
    return {
      ok: true,
      status: 'planned',
      statePath,
      summaryPath: path.join(options.outDir, 'trend-summary.json'),
      buckets: state.buckets.length,
    };
  }

  let executedBuckets = 0;
  for (const bucket of state.buckets) {
    if (bucketStatusIsComplete(bucket.status)) {
      continue;
    }
    if (options.resume && blockedBucketHasUsableItems(bucket)) {
      await markBucketCapturedWithWarning(
        bucket,
        options,
        bucket.blockedReason || bucket.result?.runtimeRisk?.stopReason || 'blocked-risk',
      );
      bucket.resumedAfterBlockedAt = new Date().toISOString();
      state.updatedAt = new Date().toISOString();
      state.summary = await writeSummaryFiles(state, options.outDir);
      await writeJson(statePath, state);
      continue;
    }
    const blocker = await findBlocker({
      runsRoot: options.runsRoot,
      cooldownMinutes: options.cooldownMinutes,
    });
    state.cooldown = blocker;
    if (blocker.blocked) {
      bucket.blockedReason = blocker.reason;
      bucket.blocker = blocker;
      await markBucketCapturedWithWarning(bucket, options, blocker.reason || 'search-rate-limited', {
        source: 'empty-degraded-terminal',
        blocker,
      });
      state.updatedAt = new Date().toISOString();
      state.summary = await writeSummaryFiles(state, options.outDir);
      await writeJson(statePath, state);
      continue;
    }

    await maybeApplyAdaptiveThrottle({
      blocker,
      options,
      state,
      bucket,
      statePath,
      sleep,
    });

    let command = buildXActionCommand(bucket, options);
    bucket.collectionMode = effectiveCollectionMode(options);
    bucket.command = command;
    bucket.status = 'running';
    bucket.startedAt = new Date().toISOString();
    bucket.attempts = (bucket.attempts || 0) + 1;
    await writeJson(statePath, state);

    let result = await execute(command[0], command.slice(1), { cwd: process.cwd() });
    bucket.exitCode = result.exitCode;
    bucket.finishedAt = new Date().toISOString();
    let parsed = null;
    try {
      parsed = parseXActionJson(result.stdout);
    } catch (error) {
      bucket.status = 'failed';
      bucket.error = error?.message || String(error);
      bucket.stderrTail = result.stderr.slice(-2000);
      state.status = 'partial';
      state.summary = await writeSummaryFiles(state, options.outDir);
      await writeJson(statePath, state);
      return {
        ok: false,
        status: 'failed',
        reason: bucket.error,
        statePath,
      };
    }
    bucket.result = summarizeRuntimeResult(parsed);
    if (shouldFallbackApiRateLimitToPage({ parsed, summarized: bucket.result, options })) {
      const apiAttempt = {
        collectionMode: 'api',
        command,
        exitCode: result.exitCode,
        finishedAt: bucket.finishedAt,
        blockedReason: parsed?.outcome?.reason || bucket.result.runtimeRisk?.stopReason || 'api-local-rate-limit',
        result: bucket.result,
      };
      const fallbackOptions = {
        ...options,
        collectionMode: 'page',
      };
      const fallbackBucket = {
        ...bucket,
        artifactRunId: `${bucket.artifactRunId}-page-fallback`,
        collectionMode: 'page',
      };
      command = buildXActionCommand(fallbackBucket, fallbackOptions);
      bucket.apiAttempt = apiAttempt;
      bucket.fallback = {
        from: 'api',
        to: 'page',
        reason: 'api-local-rate-limit',
        startedAt: new Date().toISOString(),
        artifactRunId: fallbackBucket.artifactRunId,
        command,
      };
      bucket.collectionMode = 'page';
      bucket.command = command;
      await writeJson(statePath, state);

      result = await execute(command[0], command.slice(1), { cwd: process.cwd() });
      bucket.exitCode = result.exitCode;
      bucket.finishedAt = new Date().toISOString();
      try {
        parsed = parseXActionJson(result.stdout);
      } catch (error) {
        bucket.status = 'failed';
        bucket.error = error?.message || String(error);
        bucket.stderrTail = result.stderr.slice(-2000);
        bucket.fallback.exitCode = result.exitCode;
        bucket.fallback.finishedAt = bucket.finishedAt;
        bucket.fallback.error = bucket.error;
        state.status = 'partial';
        state.summary = await writeSummaryFiles(state, options.outDir);
        await writeJson(statePath, state);
        return {
          ok: false,
          status: 'failed',
          reason: bucket.error,
          statePath,
        };
      }
      bucket.result = summarizeRuntimeResult(parsed);
      bucket.fallback.exitCode = result.exitCode;
      bucket.fallback.finishedAt = bucket.finishedAt;
      bucket.fallback.result = bucket.result;
    }
    if (bucket.result.runtimeRisk?.rateLimited || bucket.result.runtimeRisk?.hardStop || parsed?.outcome?.status === 'blocked-risk') {
      bucket.blockedReason = parsed?.outcome?.reason || bucket.result.runtimeRisk?.stopReason || 'blocked-risk';
      await markBucketCapturedWithWarning(bucket, options, bucket.blockedReason, {
        source: 'empty-degraded-terminal',
      });
      state.updatedAt = new Date().toISOString();
      state.summary = await writeSummaryFiles(state, options.outDir);
      await writeJson(statePath, state);
      executedBuckets += 1;
      if (options.maxBucketsPerRun && executedBuckets >= options.maxBucketsPerRun && hasIncompleteBuckets(state)) {
        state.status = 'partial';
        state.updatedAt = new Date().toISOString();
        state.summary = await writeSummaryFiles(state, options.outDir);
        await writeJson(statePath, state);
        return {
          ok: true,
          status: 'partial',
          reason: 'max-buckets-per-run',
          statePath,
          summaryPath: path.join(options.outDir, 'trend-summary.json'),
          executedBuckets,
        };
      }
      continue;
    }
    bucket.status = parsed?.ok === true ? 'completed' : 'failed';
    if (bucket.fallback) {
      bucket.fallback.status = bucket.status;
    }
    if (bucket.status === 'failed') {
      bucket.error = parsed?.outcome?.reason || `x-action exited ${result.exitCode}`;
      state.status = 'partial';
      state.summary = await writeSummaryFiles(state, options.outDir);
      await writeJson(statePath, state);
      return {
        ok: false,
        status: 'failed',
        reason: bucket.error,
        statePath,
      };
    }
    state.updatedAt = new Date().toISOString();
    state.summary = await writeSummaryFiles(state, options.outDir);
    await writeJson(statePath, state);
    executedBuckets += 1;
    if (options.maxBucketsPerRun && executedBuckets >= options.maxBucketsPerRun && hasIncompleteBuckets(state)) {
      state.status = 'partial';
      state.updatedAt = new Date().toISOString();
      state.summary = await writeSummaryFiles(state, options.outDir);
      await writeJson(statePath, state);
      return {
        ok: true,
        status: 'partial',
        reason: 'max-buckets-per-run',
        statePath,
        summaryPath: path.join(options.outDir, 'trend-summary.json'),
        executedBuckets,
      };
    }
    if (options.delayMs > 0) {
      await sleep(options.delayMs);
    }
  }

  state.status = 'complete';
  state.updatedAt = new Date().toISOString();
  state.summary = await writeSummaryFiles(state, options.outDir);
  await writeJson(statePath, state);
  return {
    ok: true,
    status: 'complete',
    statePath,
    summaryPath: path.join(options.outDir, 'trend-summary.json'),
  };
}

async function main() {
  const options = parseArgs();
  const result = await runTrendSampler(options);
  if (result.help) {
    process.stdout.write(result.help);
    return;
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) {
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exitCode = 1;
  });
}

export {
  DEFAULT_SUBJECTS,
  DEFAULT_TOPICS,
  buildAnalysisArtifacts,
  buildCalendarBuckets,
  buildSearchQuery,
  buildTrendBuckets,
  buildTrendSummary,
  classifyItem,
  createInitialState,
  dedupeItems,
  filterUxLoveItems,
  findSearchCooldownBlocker,
  manifestIsSearchRateLimited,
  parseArgs,
  renderSummaryMarkdown,
  runTrendSampler,
};
