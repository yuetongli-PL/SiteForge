#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const catalogPath = path.join(skillRoot, 'references', 'x-live-catalog.json');
const DEFAULT_MAX_API_PAGES = '1';
const DEFAULT_MAX_READ_PAGES = '20';
const DEFAULT_MAX_ITEMS = '20';
const FULL_RELATION_MAX_API_PAGES = '250';
const FULL_RELATION_MAX_ITEMS = '5000';

function parseArgs(argv) {
  const args = {};
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) {
      args.request = args.request ? `${args.request} ${arg}` : arg;
      continue;
    }
    const key = arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    const next = argv[index + 1];
    if (next === undefined || next.startsWith('--')) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    index += 1;
  }
  return args;
}

function tokenize(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/twitter/g, 'x')
    .split(/[^a-z0-9_]+/i)
    .filter(Boolean);
}

const phraseBoosts = [
  [/\u5168\u90e8|\u5168\u91cf|\u5b8c\u6574|\u6240\u6709/iu, ['all', 'full', 'complete']],
  [/\u5173\u6ce8\u5217\u8868|\u6b63\u5728\u5173\u6ce8|\u5173\u6ce8(?:\u7684)?(?:\u4eba|\u8d26\u53f7|\u8d26\u6237|\u7528\u6237)?/iu, ['following', 'profile', 'account', 'user', 'relation-list']],
  [/\u7c89\u4e1d\u5217\u8868|\u7c89\u4e1d|\u5173\u6ce8\u8005/iu, ['followers', 'profile', 'account', 'user', 'relation-list']],
  [/following\s+(?:list|accounts?|users?)/iu, ['following', 'profile', 'account', 'user', 'relation-list']],
  [/followers?\s+(?:list|accounts?|users?)/iu, ['followers', 'profile', 'account', 'user', 'relation-list']],
  [/全部|全量|完整|所有|\ball\b|\bfull\b|\bcomplete\b|\bentire\b|\bexhaustive\b/i, ['all', 'full', 'complete']],
  [/关注列表|正在关注|关注(?:的)?(?:人|账号|账户|用户)|following\s+(?:list|accounts?|users?)/i, ['following', 'profile', 'account', 'user']],
  [/粉丝列表|粉丝|关注者|followers?\s+(?:list|accounts?|users?)/i, ['followers', 'profile', 'account', 'user']],
  [/互相关注|共同关注/i, ['followers-you-follow', 'followers_you_follow', 'mutuals']],
  [/followers?\s+you\s+follow|mutual/i, ['followers-you-follow', 'followers_you_follow', 'mutuals']],
  [/verified\s+followers?/i, ['verified', 'followers']],
  [/liked?|likes?/i, ['likes', 'liked']],
  [/lists?/i, ['lists']],
  [/bookmarks?|saved/i, ['bookmarks', 'saved']],
  [/communities?|community/i, ['communities', 'community']],
  [/notifications?|mentions?/i, ['notifications', 'mentions']],
  [/home|timeline|feed/i, ['home', 'timeline', 'feed']],
  [/search|query|find/i, ['search', 'query', 'find']],
  [/profile|account|user/i, ['profile', 'account', 'user']],
  [/following|follows/i, ['following']],
  [/followers?/i, ['followers']],
  [/spaces?|audio/i, ['spaces', 'audio']],
  [/tweet|post|status/i, ['tweet', 'post', 'status']],
  [/quotes?/i, ['quotes']],
  [/retweets?|reposts?/i, ['retweets', 'reposts']],
  [/media|photos?|images?/i, ['media', 'photo', 'images']],
  [/replies?/i, ['replies']],
  [/highlights?/i, ['highlights']],
  [/settings?|privacy|security/i, ['settings', 'privacy', 'security']],
  [/grok/i, ['grok']],
  [/explore/i, ['explore']],
  [/trending/i, ['trending']],
  [/news/i, ['news']],
];

function requestTokens(request) {
  const tokens = new Set(tokenize(request));
  for (const [pattern, boosts] of phraseBoosts) {
    if (pattern.test(String(request || ''))) {
      for (const boost of boosts) tokens.add(boost);
    }
  }
  return tokens;
}

function surfaceText(surface) {
  return [
    surface.surface,
    surface.intent,
    surface.capability,
    surface.action,
    surface.contentType,
    surface.routeTemplate,
    ...(surface.aliases || []),
    ...(surface.api?.verifiedOperations || []),
    ...(surface.api?.targetOperations || []),
  ].join(' ');
}

function scoreSurface(surface, tokens, args = {}) {
  const text = surfaceText(surface).toLowerCase();
  let score = 0;
  for (const token of tokens) {
    if (text.includes(token)) score += token.length > 4 ? 3 : 2;
    if ((surface.intent || '').toLowerCase().includes(token)) score += 3;
    if ((surface.capability || '').toLowerCase().includes(token)) score += 2;
    if ((surface.surface || '').toLowerCase().includes(token)) score += 2;
  }
  if (surface.api?.verified) score += 2;
  if (surface.siteFallback?.verified) score += 1;
  const intent = String(surface.intent || '');
  const route = String(surface.routeTemplate || '');
  const has = (token) => tokens.has(token);
  if ((has('likes') || has('liked')) && intent === 'inspect_profile_likes') score += 12;
  if ((has('likes') || has('liked')) && intent === 'inspect_status_likes' && !args.statusId && !has('status') && !has('tweet') && !has('post')) score -= 6;
  const wantsPlainProfile = (has('profile') || has('account') || has('user') || Boolean(args.account))
    && !has('about')
    && !has('media')
    && !has('photo')
    && !has('articles')
    && !has('communities')
    && !has('followers')
    && !has('following')
    && !has('lists')
    && !has('likes')
    && !has('posts')
    && !has('replies')
    && !has('highlights')
    && !has('settings')
    && !args.statusId;
  if (wantsPlainProfile && intent === 'inspect_account_profile') score += 24;
  if (wantsPlainProfile && /^inspect_account_.*_route$/u.test(intent)) score -= 12;
  const requestText = String(args.request || '');
  const explicitStatusReference = /\bstatus\b|\bstatus\s*id\b|\/status\/|\b(?:tweet|post)\s+(?:id\s*)?\d{4,}/iu.test(requestText);
  const wantsProfilePostArchive = (has('post') || has('posts') || has('tweet') || has('tweets') || has('timeline'))
    && (has('profile') || has('account') || has('user') || Boolean(args.account))
    && !args.statusId
    && !explicitStatusReference;
  if (wantsProfilePostArchive && intent === 'archive_profile_posts') score += 28;
  if (wantsProfilePostArchive && /status/.test(route) && !args.statusId) score -= 18;
  const wantsProfileMediaArchive = (has('media') || has('photos') || has('images'))
    && (has('profile') || has('account') || has('user') || Boolean(args.account))
    && !args.statusId
    && !explicitStatusReference;
  if (wantsProfileMediaArchive && intent === 'archive_profile_media') score += 28;
  if (wantsProfileMediaArchive && intent === 'inspect_account_photo_route') score -= 14;
  if (has('lists') && intent === 'inspect_lists_surface') score += 14;
  if (has('lists') && intent === 'inspect_profile_lists') score += 12;
  if (has('lists') && intent === 'inspect_profile_lists' && !args.account && !has('profile') && !has('account')) score -= 14;
  const wantsSpecificList = Boolean(args.listId) && (has('detail') || has('members') || has('followers'));
  if (wantsSpecificList && intent === 'inspect_lists_surface') score -= 18;
  if (args.listId && has('detail') && intent === 'inspect_list_detail') score += 24;
  if (args.listId && has('members') && intent === 'inspect_list_members') score += 24;
  if (args.listId && has('followers') && intent === 'inspect_list_followers') score += 24;
  if ((has('following') || has('followers')) && has('relation-list') && intent === 'inspect_profile_lists') score -= 18;
  if ((has('followers-you-follow') || has('followers_you_follow') || has('mutuals')) && intent === 'inspect_followers_you_follow') score += 14;
  if (has('followers') && intent === 'archive_follower_accounts') score += has('relation-list') ? 20 : 10;
  if (has('following') && intent === 'archive_following_accounts') score += has('relation-list') ? 20 : 10;
  if (args.account && has('profile') && intent === 'archive_following_accounts') score += 8;
  if (args.account && has('profile') && intent === 'archive_follower_accounts') score += 8;
  if (has('bookmarks') && intent === 'inspect_bookmarks') score += 12;
  if (has('notifications') && intent === 'inspect_notifications') score += 14;
  if (has('notifications') && route.startsWith('/notifications')) score += 8;
  if (has('notifications') && !has('mentions') && intent === 'inspect_notification_mentions') score -= 10;
  if (has('home') && route === '/home') score += 8;
  if (has('explore') && intent === 'inspect_explore_surface') score += 12;
  if (has('trending') && intent === 'inspect_trending_explore_surface') score += 16;
  if (has('news') && intent === 'inspect_news_explore_surface') score += 12;
  if ((has('search') || has('query') || has('find')) && intent === 'archive_search_results') score += 28;
  if (args.query && intent === 'archive_search_results') score += 18;
  if ((has('search') || has('query') || has('find')) && /status/.test(route) && !args.statusId) score -= 24;
  if ((has('tweet') || has('status') || has('post')) && /status/.test(route)) score += 6;
  return score;
}

function requestHasFullQualifier(request) {
  if (/\u5168\u90e8|\u5168\u91cf|\u5b8c\u6574|\u6240\u6709/iu.test(String(request || ''))) {
    return true;
  }
  return /全部|全量|完整|所有|\ball\b|\bfull\b|\bcomplete\b|\bentire\b|\bexhaustive\b/i.test(String(request || ''));
}

function requestHasRelationListPhrase(request) {
  if (/\u5173\u6ce8\u5217\u8868|\u6b63\u5728\u5173\u6ce8|\u5173\u6ce8(?:\u7684)?(?:\u4eba|\u8d26\u53f7|\u8d26\u6237|\u7528\u6237)?|\u7c89\u4e1d\u5217\u8868|\u7c89\u4e1d|\u5173\u6ce8\u8005|following\s+(?:list|accounts?|users?)|followers?\s+(?:list|accounts?|users?)/iu.test(String(request || ''))) {
    return true;
  }
  return /关注列表|正在关注|关注(?:的)?(?:人|账号|账户|用户)|粉丝列表|粉丝|关注者|following\s+(?:list|accounts?|users?)|followers?\s+(?:list|accounts?|users?)/i.test(String(request || ''));
}

function isRelationArchiveSurface(surface) {
  const intent = String(surface?.intent || '');
  return intent === 'archive_following_accounts'
    || intent === 'archive_follower_accounts'
    || intent === 'archive_current_followed_accounts';
}

function inferFullRelationArchive(request, surface) {
  return isRelationArchiveSurface(surface)
    && (requestHasFullQualifier(request) || requestHasRelationListPhrase(request));
}

function hasExplicitValue(value) {
  return value !== undefined && value !== null && value !== true && String(value).length > 0;
}

function truthyFlag(value) {
  return value === true || /^(1|true|yes|on)$/iu.test(String(value || ''));
}

function fileTimeMs(filePath) {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return 0;
  }
}

function timeMs(value) {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function latestLocalReportPath(cwd = process.cwd()) {
  const siteforgeDir = path.join(cwd, '.siteforge');
  if (!fs.existsSync(siteforgeDir)) {
    return null;
  }
  const candidates = fs.readdirSync(siteforgeDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^x-live-report-/u.test(entry.name))
    .map((entry) => path.join(siteforgeDir, entry.name, 'social-live-report.json'))
    .filter((reportPath) => fs.existsSync(reportPath))
    .sort((left, right) => fileTimeMs(right) - fileTimeMs(left));
  return candidates[0] || null;
}

function timestampForPath(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
    'T',
    pad(date.getUTCHours()),
    pad(date.getUTCMinutes()),
    pad(date.getUTCSeconds()),
  ].join('');
}

function refreshLocalReport(args = {}, cwd = process.cwd()) {
  if (hasExplicitValue(args.report)) {
    return {
      status: 'skipped',
      reason: 'explicit-report',
      reportPath: path.resolve(String(args.report)),
    };
  }
  if (truthyFlag(args.noRefreshReport)) {
    return {
      status: 'skipped',
      reason: 'no-refresh-report',
      reportPath: latestLocalReportPath(cwd),
    };
  }
  const reportScript = path.join(cwd, 'scripts', 'social-live-report.mjs');
  const siteforgeDir = path.join(cwd, '.siteforge');
  if (!fs.existsSync(reportScript) || !fs.existsSync(siteforgeDir)) {
    return {
      status: 'skipped',
      reason: 'siteforge-report-script-not-found',
      reportPath: latestLocalReportPath(cwd),
    };
  }

  const outDir = path.join('.siteforge', `x-live-report-${timestampForPath()}`);
  const timeoutMs = Number(args.refreshReportTimeoutMs || args.reportRefreshTimeoutMs || 120000);
  const result = spawnSync(process.execPath, [
    reportScript,
    '--runs-root',
    '.siteforge',
    '--site',
    'x',
    '--limit',
    String(args.reportLimit || 1000),
    '--out-dir',
    outDir,
    '--progress',
    'plain',
    '--no-tty',
  ], {
    cwd,
    encoding: 'utf8',
    timeout: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 120000,
  });
  const reportPath = path.join(cwd, outDir, 'social-live-report.json');
  if (result.status === 0 && fs.existsSync(reportPath)) {
    return {
      status: 'refreshed',
      reason: null,
      reportPath,
      outDir: path.join(cwd, outDir),
    };
  }
  return {
    status: 'failed',
    reason: result.error?.message || result.stderr?.trim() || `exit-${result.status ?? 'unknown'}`,
    reportPath: latestLocalReportPath(cwd),
    attemptedOutDir: path.join(cwd, outDir),
  };
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function compactBoundaryBlocker(blocker) {
  if (!blocker) return null;
  return {
    id: blocker.id ?? null,
    surface: blocker.surface ?? null,
    status: blocker.status ?? null,
    reason: blocker.reason ?? blocker.runtimeRisk?.stopReason ?? null,
    finishedAt: blocker.finishedAt ?? null,
    manifestPath: blocker.manifestPath ?? null,
  };
}

function catalogWithLocalReportOverride(catalog, args = {}, preflightReport = null) {
  const reportPath = hasExplicitValue(args.report)
    ? path.resolve(String(args.report))
    : preflightReport?.reportPath || latestLocalReportPath();
  if (!reportPath) {
    return catalog;
  }
  let report;
  try {
    report = readJsonFile(reportPath);
  } catch {
    return catalog;
  }
  const reportGeneratedAt = report.generatedAt || null;
  const catalogReportTime = timeMs(catalog.sourceReportGeneratedAt || catalog.generatedAt);
  const reportTime = timeMs(reportGeneratedAt) || fileTimeMs(reportPath);
  if (!hasExplicitValue(args.report) && catalogReportTime && reportTime && reportTime < catalogReportTime) {
    return catalog;
  }

  const siteSummary = report.summary?.x || {};
  const coverage = report.coverage?.x || {};
  const rateLimitBoundary = coverage.rateLimitBoundary || {};
  const fullSiteBoundary = coverage.fullSiteBoundary || {};
  const hasRateLimitState = typeof rateLimitBoundary.activeRateLimitBlocker === 'boolean'
    || typeof fullSiteBoundary.activeRateLimitBlocker === 'boolean';
  if (!hasRateLimitState) {
    return catalog;
  }
  const activeRateLimitBlocker = Boolean(
    rateLimitBoundary.activeRateLimitBlocker ?? fullSiteBoundary.activeRateLimitBlocker,
  );
  const activeBlockedSurfaces = Array.isArray(rateLimitBoundary.activeBlockedSurfaces)
    ? rateLimitBoundary.activeBlockedSurfaces
    : Array.isArray(fullSiteBoundary.rateLimitActiveBlockedSurfaces)
      ? fullSiteBoundary.rateLimitActiveBlockedSurfaces
      : [];
  return {
    ...catalog,
    sourceReport: path.relative(process.cwd(), reportPath) || reportPath,
    sourceReportGeneratedAt: reportGeneratedAt || catalog.sourceReportGeneratedAt,
    summary: {
      ...(catalog.summary || {}),
      totalRows: report.totalRows ?? siteSummary.total ?? catalog.summary?.totalRows,
      statuses: siteSummary.statuses ?? catalog.summary?.statuses,
      sessionGates: siteSummary.sessionGates ?? catalog.summary?.sessionGates,
      latestFinishedAt: siteSummary.latestFinishedAt ?? catalog.summary?.latestFinishedAt,
      controlledScopeClosureReady: fullSiteBoundary.controlledScopeClosureReady ?? catalog.summary?.controlledScopeClosureReady,
      fullSiteExhaustiveClaim: fullSiteBoundary.fullSiteExhaustiveClaim ?? catalog.summary?.fullSiteExhaustiveClaim,
    },
    boundaries: {
      ...(catalog.boundaries || {}),
      activeRateLimitBlocker,
      activeBlockedSurfaces,
      latestBlocker: compactBoundaryBlocker(rateLimitBoundary.latestBlocker || fullSiteBoundary.latestRateLimitBlocker),
      latestRecoveredAt: rateLimitBoundary.latestRecoveredAt ?? fullSiteBoundary.latestRateLimitRecoveredAt ?? null,
      nextEvidence: activeRateLimitBlocker
        ? (catalog.boundaries?.nextEvidence || 'reuse-local-evidence-or-non-conflicting-surface')
        : null,
    },
    localReportOverride: {
      reportPath: path.relative(process.cwd(), reportPath) || reportPath,
      generatedAt: reportGeneratedAt,
    },
    preflightReport,
  };
}

function inferAccount(request) {
  const match = String(request || '').match(/(?:^|[^A-Za-z0-9_])@([A-Za-z0-9_]{1,15})(?=$|[^A-Za-z0-9_])/);
  return match?.[1] || null;
}

function replaceTemplate(template, values) {
  return String(template || '')
    .replaceAll('<account>', values.account || '<account>')
    .replaceAll('<query>', values.query || '<query>')
    .replaceAll('<statusId>', values.statusId || '<statusId>')
    .replaceAll('<mediaId>', values.mediaId || '<mediaId>')
    .replaceAll('<listId>', values.listId || '<listId>')
    .replaceAll('<communityId>', values.communityId || '<communityId>')
    .replaceAll('<spaceId>', values.spaceId || '<spaceId>')
    .replaceAll('<maxApiPages>', values.maxApiPages || '1')
    .replaceAll('<maxReadPages>', values.maxReadPages || '20')
    .replaceAll('<maxItems>', values.maxItems || '20')
    .replaceAll('<timeoutMs>', values.timeoutMs || '120000')
    .replaceAll('<outDir>', values.outDir || '.siteforge/x-live-runs-skill')
    .replaceAll('<artifactRunId>', values.artifactRunId || 'x-live-actions-skill-run');
}

function compactSlug(value, fallback = 'run', maxLength = 96) {
  const slug = String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
  const compact = slug || fallback;
  return compact.length <= maxLength ? compact : compact.slice(0, maxLength).replace(/-+$/g, '') || fallback;
}

function shellQuote(value) {
  const text = String(value ?? '');
  if (/^[A-Za-z0-9_./:@=-]+$/u.test(text)) {
    return text;
  }
  return `"${text.replace(/"/gu, '\\"')}"`;
}

function stripKnownTaskWords(value) {
  return String(value || '')
    .replace(/@[A-Za-z0-9_]{1,15}/gu, ' ')
    .replace(/X|x\.com|twitter/giu, ' ')
    .replace(/账号|账户|用户|指定|相关|基于|画像|综合|分析|发现|相似|历史|全量|完整|归档|文章|帖子|图片|视频|关键词|趋势|使用|行业|周报|月报|事件|时间线|重建|舆情|评价|对比|在|中|的/gu, ' ')
    .replace(/\b(?:account|profile|archive|full|history|keyword|trend|analysis|industry|weekly|monthly|report|event|timeline|similar|discover|x|twitter|user|usage)\b/giu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function inferResearchQuery(request, args = {}) {
  if (hasExplicitValue(args.query)) {
    return String(args.query).trim();
  }
  const text = String(request || '');
  const gptMatch = text.match(/\bgpt\s*-?\s*5(?:[._-]?\s*6)?\b/iu);
  if (gptMatch) {
    return gptMatch[0].replace(/\s+/gu, '');
  }
  const agentMatch = text.match(/\bAI\s*agents?\b|\bagents?\b/iu);
  if (agentMatch) {
    return agentMatch[0];
  }
  const codexClaude = /codex/iu.test(text) && /claude/iu.test(text);
  if (codexClaude) {
    return 'codex claude';
  }
  return stripKnownTaskWords(text);
}

function inferResearchSubjects(request, args = {}) {
  if (hasExplicitValue(args.subjects)) {
    return String(args.subjects).split(',').map((entry) => entry.trim()).filter(Boolean);
  }
  const text = String(request || '');
  const subjects = [];
  if (/codex/iu.test(text)) subjects.push('codex');
  if (/claude/iu.test(text)) subjects.push('claude');
  return subjects;
}

function inferResearchTask(request, args = {}) {
  const text = String(request || '');
  const account = args.account || inferAccount(text);
  const lower = text.toLowerCase();
  const hasAny = (...patterns) => patterns.some((pattern) => pattern.test(text));
  const routeBrowseOnly = /\b(?:show|open|inspect|browse|view|get)\b[\s\S]*\b(?:home|timeline|feed|explore|trending|news|lists?|bookmarks?|notifications?|messages?|communities?|settings)\b/iu.test(text)
    && !/\b(?:analysis|analy[sz]e|report|sentiment|opinion|trend\s+analysis|event\s+timeline|timeline\s+reconstruction|reconstruct\s+(?:an?\s+)?timeline)\b/iu.test(text);
  if (routeBrowseOnly) return null;
  if (hasAny(/(?:\u76f8\u4f3c\u8d26\u53f7|\u7c7b\u4f3c\u8d26\u53f7|\u76f8\u5173\u8d26\u53f7|\u76f8\u4f3c\u8d26\u6237|\u7c7b\u4f3c\u8d26\u6237|\u76f8\u5173\u8d26\u6237|similar\s+accounts?|account\s+similar)/iu)) {
    return {
      task: 'similar-account-discovery',
      account,
      query: hasExplicitValue(args.query) ? inferResearchQuery(request, args) : null,
      reason: 'seed-account-similar-discovery',
    };
  }
  if (hasAny(/(?:\u7efc\u5408\u753b\u50cf|\u8d26\u53f7\u753b\u50cf|\u8d26\u6237\u753b\u50cf|\u7528\u6237\u753b\u50cf|\u53d1\u5e03\u5185\u5bb9\u753b\u50cf|\u5173\u6ce8(?:\u5173\u7cfb)?\u753b\u50cf|profile\s+analysis|composite\s+profile)/iu) && account) {
    return {
      task: 'account-composite-profile',
      account,
      query: null,
      reason: 'specified-account-composite-profile',
    };
  }
  if (hasAny(/(?:\u5386\u53f2\u5168\u91cf|\u5168\u91cf\u5f52\u6863|\u5b8c\u6574\u5f52\u6863|\u5386\u53f2\u5f52\u6863|\u6570\u636e\u5f52\u6863|full\s+archive|historical\s+archive|archive\s+history)/iu) && account) {
    return {
      task: 'account-full-archive',
      account,
      query: null,
      reason: 'specified-account-full-archive',
    };
  }
  if (hasAny(/(?:\u884c\u4e1a.*(?:\u5468\u62a5|\u6708\u62a5)|(?:\u5468\u62a5|\u6708\u62a5).*\u884c\u4e1a|weekly\s+report|monthly\s+report|industry\s+report)/iu)) {
    return {
      task: 'industry-report',
      account: null,
      query: inferResearchQuery(request, args),
      reason: 'industry-weekly-monthly-report',
    };
  }
  if (hasAny(/(?:\u4e8b\u4ef6.*\u65f6\u95f4\u7ebf|\u65f6\u95f4\u7ebf.*\u4e8b\u4ef6|\u65f6\u95f4\u7ebf\u91cd\u5efa|event\s+timeline|timeline\s+reconstruction|reconstruct\s+(?:an?\s+)?timeline)/iu)) {
    return {
      task: 'event-timeline',
      account: null,
      query: inferResearchQuery(request, args),
      reason: 'event-timeline-reconstruction',
    };
  }
  if (hasAny(/(?:\u8d8b\u52bf|\u8206\u60c5|\u8bc4\u4ef7|\u4f7f\u7528\u8d8b\u52bf|trend|sentiment|opinion)/iu) || (lower.includes('codex') && lower.includes('claude'))) {
    return {
      task: 'keyword-trend',
      account: null,
      query: inferResearchQuery(request, args),
      subjects: inferResearchSubjects(request, args),
      reason: 'keyword-trend-analysis',
    };
  }
  if (hasAny(/相似账号|类似账号|相关账号|similar\s+accounts?|account\s+similar/iu)) {
    return {
      task: 'similar-account-discovery',
      account,
      query: hasExplicitValue(args.query) ? inferResearchQuery(request, args) : null,
      reason: 'seed-account-similar-discovery',
    };
  }
  if (hasAny(/综合画像|账号画像|账户画像|用户画像|profile\s+analysis|composite\s+profile/iu) && account) {
    return {
      task: 'account-composite-profile',
      account,
      query: null,
      reason: 'specified-account-composite-profile',
    };
  }
  if (hasAny(/历史全量|全量归档|完整归档|历史归档|full\s+archive|historical\s+archive|archive\s+history|full\s+account\s+history|account\s+full\s+history|account\s+history\s+archive|archive\s+.*full\s+account|complete\s+account\s+history|entire\s+account\s+history/iu) && account) {
    return {
      task: 'account-full-archive',
      account,
      query: null,
      reason: 'specified-account-full-archive',
    };
  }
  if (hasAny(/行业.*(?:周报|月报)|(?:周报|月报).*行业|weekly\s+report|monthly\s+report|industry\s+report/iu)) {
    return {
      task: 'industry-report',
      account: null,
      query: inferResearchQuery(request, args),
      reason: 'industry-weekly-monthly-report',
    };
  }
  if (hasAny(/事件.*时间线|时间线.*事件|时间线重建|event\s+timeline|timeline\s+reconstruction|reconstruct\s+(?:an?\s+)?timeline/iu)) {
    return {
      task: 'event-timeline',
      account: null,
      query: inferResearchQuery(request, args),
      reason: 'event-timeline-reconstruction',
    };
  }
  if (hasAny(/趋势|trend|sentiment|opinion|舆情|评价/iu) || (lower.includes('codex') && lower.includes('claude'))) {
    return {
      task: 'keyword-trend',
      account: null,
      query: inferResearchQuery(request, args),
      subjects: inferResearchSubjects(request, args),
      reason: 'keyword-trend-analysis',
    };
  }
  return null;
}

function researchTaskCommand(taskPlan, args = {}, mode = 'execute') {
  const searchTasks = new Set(['keyword-trend', 'industry-report', 'event-timeline']);
  const parts = [
    'node',
    'scripts/x-research-task-runner.mjs',
    '--task',
    taskPlan.task,
  ];
  if (taskPlan.account) {
    parts.push('--account', taskPlan.account);
  }
  if (taskPlan.query) {
    parts.push('--query', taskPlan.query);
  }
  if (Array.isArray(taskPlan.subjects) && taskPlan.subjects.length) {
    parts.push('--subjects', taskPlan.subjects.join(','));
  }
  if (hasExplicitValue(args.from)) {
    parts.push('--from', String(args.from));
  }
  if (hasExplicitValue(args.to)) {
    parts.push('--to', String(args.to));
  }
  if (hasExplicitValue(args.languages)) {
    parts.push('--languages', String(args.languages));
  }
  if (hasExplicitValue(args.mode)) {
    parts.push('--mode', String(args.mode));
  }
  if (hasExplicitValue(args.collectionMode)) {
    parts.push('--collection-mode', String(args.collectionMode));
  }
  if (hasExplicitValue(args.maxItems)) {
    parts.push('--max-items', String(args.maxItems));
  }
  if (hasExplicitValue(args.maxApiPages)) {
    parts.push('--max-api-pages', String(args.maxApiPages));
  }
  if (hasExplicitValue(args.timeoutMs)) {
    parts.push('--timeout', String(args.timeoutMs));
  }
  if (hasExplicitValue(args.maxBucketsPerRun)) {
    parts.push('--max-buckets-per-run', String(args.maxBucketsPerRun));
  } else if (searchTasks.has(taskPlan.task)) {
    parts.push('--max-buckets-per-run', '1');
  }
  if (hasExplicitValue(args.bucketDelayMs)) {
    parts.push('--bucket-delay-ms', String(args.bucketDelayMs));
  }
  if (taskPlan.task === 'account-full-archive') {
    parts.push('--download-media', '--media-download-limit', hasExplicitValue(args.mediaDownloadLimit) ? String(args.mediaDownloadLimit) : '0');
  }
  parts.push(
    '--out-dir',
    args.outDir || `.siteforge/x-research-tasks/${compactSlug(`${taskPlan.task}-${taskPlan.account || taskPlan.query || 'task'}`)}`,
    '--runs-root',
    args.runsRoot || '.siteforge/x-live-runs-skill',
  );
  if (mode === 'execute') {
    parts.push('--execute', '--resume');
  } else {
    parts.push('--dry-run');
  }
  parts.push('--json');
  return parts.map(shellQuote).join(' ');
}

function stripReadSurfaceCrawl(command) {
  return String(command || '')
    .replace(/\s+--crawl-read-surfaces\s+--max-read-crawl-depth\s+\S+\s+--max-read-crawl-pages\s+\S+/giu, '')
    .replace(/\s+--crawl-read-surfaces\b/giu, '')
    .replace(/\s{2,}/gu, ' ')
    .trim();
}

function commandFromTemplate(template, values, { skipReadSurfaceCrawl = false } = {}) {
  const command = replaceTemplate(template, values);
  return skipReadSurfaceCrawl ? stripReadSurfaceCrawl(command) : command;
}

function requestFromArgs(args = {}) {
  if (hasExplicitValue(args.requestFile)) {
    return fs.readFileSync(path.resolve(String(args.requestFile)), 'utf8').replace(/^\uFEFF/u, '').trim();
  }
  if (hasExplicitValue(args.requestBase64)) {
    return Buffer.from(String(args.requestBase64), 'base64').toString('utf8').replace(/^\uFEFF/u, '').trim();
  }
  return String(args.request || args.r || '').trim();
}

function mutationBlockForRequest(request) {
  const text = String(request || '').trim();
  if (!text) return null;
  const mutationPatterns = [
    [/\b(?:publish|send|create|draft|delete|remove|edit|update|change|upload|pay|purchase|checkout)\b/iu, 'site-policy-disabled-action'],
    [/\bpost\s+(?:a|an|this|the|new)\b/iu, 'site-policy-disabled-action'],
    [/\b(?:like|unlike|retweet|repost|quote|reply)\s+(?:a\s+|an\s+|this\s+|the\s+|to\s+)?(?:post|tweet|status|reply)\b/iu, 'site-policy-disabled-action'],
    [/\bfollow\s+(?!ers\b|ing\b|ed\b)\S+/iu, 'site-policy-disabled-action'],
    [/\bunfollow\s+\S+/iu, 'site-policy-disabled-action'],
    [/\b(?:dm|direct\s+message)\s+(?:to\s+)?\S+/iu, 'site-policy-disabled-action'],
    [/发布|发帖|发推|回复|点赞|取消点赞|转发|关注|取关|删除|私信|发送私信|发送|修改|更新|上传|支付|购买/iu, 'site-policy-disabled-action'],
  ];
  for (const [pattern, reason] of mutationPatterns) {
    if (pattern.test(text)) {
      return {
        reason,
        safetyLevel: 'mutation_or_sensitive_action',
      };
    }
  }
  return null;
}

function missingParameters(surface, values) {
  return (surface.parameters || []).filter((name) => !values[name]);
}

function plan(catalog, args) {
  const request = requestFromArgs(args);
  if (!request) {
    return {
      ok: false,
      error: 'missing-request',
      usage: 'node plan-x-action.mjs --request "search OpenAI" [--request-base64 <utf8-base64>] [--request-file <path>] [--account OpenAI] [--query OpenAI] --json',
    };
  }

  const mutationBlock = mutationBlockForRequest(request);
  if (mutationBlock) {
    return {
      ok: true,
      request,
      matched: {
        score: 0,
        surface: 'blocked-mutation-action',
        intent: 'blocked_mutation_action',
        capability: 'mutation.write.blocked',
        routeTemplate: null,
        status: 'disabled',
        latestStatus: 'disabled',
        reason: mutationBlock.reason,
        latestReason: mutationBlock.reason,
      },
      missingParameters: [],
      blocked: true,
      blocker: {
        reason: mutationBlock.reason,
        suggestedAction: 'Use read-only inspection, archive, search, or analysis tasks only.',
        safetyLevel: mutationBlock.safetyLevel,
      },
      limits: {
        mode: 'blocked',
        inferredFullRelationArchive: false,
        maxItems: null,
        maxApiPages: null,
        maxReadPages: null,
        explicit: {
          maxItems: hasExplicitValue(args.maxItems),
          maxApiPages: hasExplicitValue(args.maxApiPages),
          maxReadPages: hasExplicitValue(args.maxReadPages),
        },
        readSurfaceCrawl: 'not-applicable',
      },
      primary: null,
      fallback: null,
      evidence: {
        policy: 'write, mutation, payment, DM, account-changing, and upload actions are blocked by the X live skill.',
      },
      alternatives: [],
      catalog: {
        generatedAt: catalog.generatedAt,
        sourceReport: catalog.sourceReport,
        localReportOverride: catalog.localReportOverride || null,
        preflightReport: catalog.preflightReport || null,
        activeRateLimitBlocker: catalog.boundaries?.activeRateLimitBlocker,
        activeBlockedSurfaces: Array.isArray(catalog.boundaries?.activeBlockedSurfaces)
          ? catalog.boundaries.activeBlockedSurfaces
          : [],
      },
    };
  }

  const researchTask = truthyFlag(args.forceSurfacePlan) ? null : inferResearchTask(request, args);
  if (researchTask) {
    const missing = [];
    if ((researchTask.task === 'account-full-archive'
      || researchTask.task === 'account-composite-profile'
      || researchTask.task === 'similar-account-discovery') && !researchTask.account) {
      missing.push('account');
    }
    if ((researchTask.task === 'keyword-trend'
      || researchTask.task === 'industry-report'
      || researchTask.task === 'event-timeline') && !researchTask.query) {
      missing.push('query');
    }
    return {
      ok: true,
      request,
      kind: 'research-task',
      matched: {
        task: researchTask.task,
        reason: researchTask.reason,
      },
      missingParameters: missing,
      blocked: false,
      blocker: null,
      noStallPolicy: {
        apiLocalStallFallback: 'immediate-browser-bridge-page-fallback',
        sameSurfaceHardStop: 'no-wait-local-cache-alternate-surface-or-empty-degraded-terminal',
        note: 'External X limits cannot be removed. The runner must not wait for cooldown; it preserves partial evidence, reuses local cache, uses alternate verified surfaces, or marks empty degraded coverage.',
      },
      noWaitResolver: {
        localEvidence: ['task-state.json', 'raw-items.jsonl', 'deduped-items.jsonl', 'accounts.jsonl', '.siteforge/x-live-runs-skill/**/items.jsonl'],
        liveAlternatives: ['api-local-page-fallback', 'profile-backfill', 'verified-non-conflicting-read-surface'],
        terminalStatuses: ['completed', 'captured-with-warning', 'degraded-complete'],
      },
      primary: {
        kind: 'research-task',
        verified: true,
        command: researchTaskCommand(researchTask, args, 'execute'),
      },
      dryRun: {
        kind: 'research-task-plan',
        command: researchTaskCommand(researchTask, args, 'dry-run'),
      },
      catalog: {
        generatedAt: catalog.generatedAt,
        sourceReport: catalog.sourceReport,
        localReportOverride: catalog.localReportOverride || null,
        preflightReport: catalog.preflightReport || null,
        activeRateLimitBlocker: catalog.boundaries?.activeRateLimitBlocker,
        activeBlockedSurfaces: Array.isArray(catalog.boundaries?.activeBlockedSurfaces)
          ? catalog.boundaries.activeBlockedSurfaces
          : [],
      },
    };
  }

  const inferredAccount = args.account || inferAccount(request);
  const tokens = requestTokens(request);
  const ranked = catalog.surfaces
    .map((surface) => ({ surface, score: scoreSurface(surface, tokens, { ...args, account: inferredAccount, request }) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || String(a.surface.intent).localeCompare(String(b.surface.intent)));

  const selected = ranked[0]?.surface || null;
  if (!selected) {
    return {
      ok: false,
      error: 'no-matching-x-surface',
      request,
      suggestions: catalog.surfaces.slice(0, 12).map((surface) => ({
        intent: surface.intent,
        capability: surface.capability,
        surface: surface.surface,
      })),
    };
  }

  const values = {
    account: inferredAccount || null,
    query: args.query || null,
    statusId: args.statusId || null,
    mediaId: args.mediaId || null,
    listId: args.listId || null,
    communityId: args.communityId || null,
    spaceId: args.spaceId || null,
    maxApiPages: args.maxApiPages || (inferFullRelationArchive(request, selected) ? FULL_RELATION_MAX_API_PAGES : DEFAULT_MAX_API_PAGES),
    maxReadPages: args.maxReadPages || DEFAULT_MAX_READ_PAGES,
    maxItems: args.maxItems || (inferFullRelationArchive(request, selected) ? FULL_RELATION_MAX_ITEMS : DEFAULT_MAX_ITEMS),
    timeoutMs: args.timeoutMs || '120000',
    outDir: args.outDir || '.siteforge/x-live-runs-skill',
    artifactRunId: compactSlug(args.artifactRunId || `x-live-actions-${selected.intent || selected.surface}`, 'x-live-actions-skill-run'),
  };

  const missing = missingParameters(selected, values);
  const fullRelationArchive = inferFullRelationArchive(request, selected);
  const selectedBlocked = Boolean(selected.risk?.activeRateLimitBlocked || selected.risk?.hardStop);
  const activeBlockedSurfaces = Array.isArray(catalog.boundaries?.activeBlockedSurfaces)
    ? catalog.boundaries.activeBlockedSurfaces
    : [];
  const targetSurfaceBlockedByCatalogRateLimit = Boolean(catalog.boundaries?.activeRateLimitBlocker)
    && activeBlockedSurfaces.includes(selected.surface);
  const fullRelationBlockedByCatalogRateLimit = fullRelationArchive && targetSurfaceBlockedByCatalogRateLimit;
  const blocked = selectedBlocked || fullRelationBlockedByCatalogRateLimit;
  const primaryKind = selected.api?.verified ? 'api' : 'site';
  const primaryTemplate = primaryKind === 'api'
    ? selected.api.apiFirstCommandTemplate
    : selected.siteFallback.commandTemplate;
  const fallbackAvailable = primaryKind === 'api' && selected.siteFallback?.verified;
  const skipReadSurfaceCrawl = fullRelationArchive
    && !truthyFlag(args.crawlReadSurfaces)
    && !truthyFlag(args.readSurfaceCrawl);

  return {
    ok: true,
    request,
    matched: {
      score: ranked[0].score,
      surface: selected.surface,
      intent: selected.intent,
      capability: selected.capability,
      routeTemplate: selected.routeTemplate,
      status: selected.status,
      latestStatus: selected.latestStatus,
      reason: selected.reason,
      latestReason: selected.latestReason,
    },
    missingParameters: missing,
    blocked,
    blocker: blocked ? {
      reason: selectedBlocked
        ? (selected.risk?.stopReason || selected.latestReason || selected.reason)
        : 'catalog-active-rate-limit-blocker',
      suggestedAction: selectedBlocked
        ? (selected.risk?.suggestedAction || catalog.boundaries?.nextEvidence || 'reuse-local-evidence-or-non-conflicting-surface')
        : 'reuse-local-evidence-or-non-conflicting-surface',
      activeRateLimitBlocker: catalog.boundaries?.activeRateLimitBlocker,
      activeBlockedSurfaces,
      latestBlocker: catalog.boundaries?.latestBlocker || null,
      fullRelationBlockedByCatalogRateLimit,
      targetSurfaceBlockedByCatalogRateLimit,
      noWaitAlternative: fullRelationBlockedByCatalogRateLimit ? {
        kind: 'local-or-alternate-surface',
        surface: selected.surface,
        sameSurfaceProbeCommand: null,
        useWhen: 'Do not wait or probe the same blocked surface. Reuse saved relation artifacts/cursors or choose a non-conflicting verified relation/page surface.',
      } : null,
    } : null,
    limits: {
      mode: fullRelationArchive ? 'full-relation-archive' : 'preview',
      inferredFullRelationArchive: fullRelationArchive,
      maxItems: values.maxItems,
      maxApiPages: values.maxApiPages,
      maxReadPages: values.maxReadPages,
      explicit: {
        maxItems: hasExplicitValue(args.maxItems),
        maxApiPages: hasExplicitValue(args.maxApiPages),
        maxReadPages: hasExplicitValue(args.maxReadPages),
      },
      readSurfaceCrawl: skipReadSurfaceCrawl ? 'skipped-for-fast-relation-archive' : 'enabled',
    },
    primary: {
      kind: primaryKind,
      verified: primaryKind === 'api' ? selected.api.verified : selected.siteFallback.verified,
      operations: primaryKind === 'api' ? selected.api.verifiedOperations : [],
      command: commandFromTemplate(primaryTemplate, values, { skipReadSurfaceCrawl }),
    },
    fallback: fallbackAvailable ? {
      kind: 'site',
      verified: selected.siteFallback.verified,
      command: commandFromTemplate(selected.siteFallback.commandTemplate, values, { skipReadSurfaceCrawl }),
      useWhen: 'Run only if the API command is unavailable or fails without rate-limit/auth/mutation hard gates.',
    } : null,
    evidence: selected.evidence,
    alternatives: ranked.slice(1, 6).map((entry) => ({
      score: entry.score,
      surface: entry.surface.surface,
      intent: entry.surface.intent,
      capability: entry.surface.capability,
      apiVerified: entry.surface.api?.verified,
      siteVerified: entry.surface.siteFallback?.verified,
      blocked: Boolean(entry.surface.risk?.activeRateLimitBlocked || entry.surface.risk?.hardStop),
    })),
    catalog: {
      generatedAt: catalog.generatedAt,
      sourceReport: catalog.sourceReport,
      localReportOverride: catalog.localReportOverride || null,
      preflightReport: catalog.preflightReport || null,
      fullSiteExhaustiveClaim: catalog.summary?.fullSiteExhaustiveClaim,
      controlledScopeClosureReady: catalog.summary?.controlledScopeClosureReady,
      activeRateLimitBlocker: catalog.boundaries?.activeRateLimitBlocker,
      activeBlockedSurfaces,
    },
    artifacts: {
      artifactRunId: values.artifactRunId,
      expectedRunDirPrefix: `${values.outDir}/${values.artifactRunId}-`,
    },
  };
}

const args = parseArgs(process.argv);
const preflightReport = refreshLocalReport(args);
const catalog = catalogWithLocalReportOverride(JSON.parse(fs.readFileSync(catalogPath, 'utf8')), args, preflightReport);
const result = plan(catalog, args);

if (args.json || args.format === 'json') {
  console.log(JSON.stringify(result, null, 2));
} else if (!result.ok) {
  console.error(result.error);
  if (result.usage) console.error(result.usage);
  process.exitCode = 1;
} else {
  console.log(`Intent: ${result.matched.intent}`);
  console.log(`Capability: ${result.matched.capability}`);
  console.log(`Surface: ${result.matched.surface}`);
  if (result.missingParameters.length) {
    console.log(`Missing parameters: ${result.missingParameters.join(', ')}`);
  }
  if (result.blocked) {
    console.log(`Blocked: ${result.blocker.reason}`);
    console.log(`Suggested action: ${result.blocker.suggestedAction}`);
    if (result.blocker.noWaitAlternative?.useWhen) console.log(`No-wait alternative: ${result.blocker.noWaitAlternative.useWhen}`);
  }
  if (result.artifacts?.expectedRunDirPrefix) console.log(`Expected run dir prefix: ${result.artifacts.expectedRunDirPrefix}`);
  if (result.primary) console.log(`Primary (${result.primary.kind}): ${result.primary.command}`);
  if (result.fallback) console.log(`Fallback (${result.fallback.kind}): ${result.fallback.command}`);
}
