// @ts-check

import { openBrowserSession } from '../../../infra/browser/session.mjs';
import {
  ensureAuthenticatedSession,
  resolveAuthKeepaliveUrl,
  resolveSiteAuthProfile,
  resolveSiteBrowserSessionOptions,
} from '../../../infra/auth/site-auth.mjs';
import {
  finalizeSiteSessionGovernance,
  prepareSiteSessionGovernance,
  releaseSessionLease,
} from '../../../infra/auth/site-session-governance.mjs';
import { parseDouyinCreateTimeMapFromHtml } from '../queries/follow-query.mjs';
import { buildDouyinDownloadTaskSeed } from '../queries/media-resolver.mjs';
import { inferDouyinPageTypeFromUrl } from '../model/site.mjs';
import { resolveDouyinReadySelectors } from '../model/diagnosis.mjs';

const DEFAULT_TIMEOUT_MS = 30_000;
const QUERY_WAIT_POLL_MS = 200;
const FOLLOW_SCROLL_DELAY_MS = 800;
const AUTHOR_POST_SCROLL_MAX_ROUNDS = 24;
const DEFAULT_VIEWPORT = Object.freeze({
  width: 1440,
  height: 900,
  deviceScaleFactor: 1,
});

function normalizeText(value) {
  return String(value ?? '').replace(/\s+/gu, ' ').trim();
}

export function canonicalizeDouyinVideoUrl(value) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return '';
  }
  try {
    const parsed = new URL(normalized, 'https://www.douyin.com/');
    const videoId = normalizeText(parsed.pathname.match(/\/(?:video|shipin)\/([^/?#]+)/u)?.[1] || '');
    return videoId ? `https://www.douyin.com/video/${videoId}` : normalized;
  } catch {
    return normalized;
  }
}

export function canonicalizeDouyinAuthorUrl(value) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return '';
  }
  try {
    const parsed = new URL(normalized, 'https://www.douyin.com/');
    const userId = normalizeText(parsed.pathname.match(/\/user\/([^/?#]+)/u)?.[1] || '');
    return userId ? `https://www.douyin.com/user/${userId}` : normalized;
  } catch {
    return normalized;
  }
}

function toArray(value) {
  if (Array.isArray(value)) {
    return value;
  }
  return value === undefined || value === null ? [] : [value];
}

function buildQueryWaitPolicy(timeoutMs) {
  return {
    useLoadEvent: false,
    useNetworkIdle: false,
    documentReadyTimeoutMs: timeoutMs,
    domQuietMs: 400,
    domQuietTimeoutMs: timeoutMs,
    idleMs: 200,
  };
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForAnySelector(session, selectors, timeoutMs = 10_000) {
  const normalizedSelectors = toArray(selectors).map((value) => String(value ?? '').trim()).filter(Boolean);
  if (!normalizedSelectors.length) {
    return false;
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const matched = await session.callPageFunction((selectorList) => {
        const isVisible = (node) => {
          if (!(node instanceof Element)) {
            return false;
          }
          const style = window.getComputedStyle(node);
          if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity || '1') === 0) {
            return false;
          }
          const rect = node.getBoundingClientRect();
          return rect.width >= 4 && rect.height >= 4;
        };
        for (const selector of selectorList) {
          try {
            const node = document.querySelector(selector);
            if (isVisible(node)) {
              return true;
            }
          } catch {
            // Ignore invalid selectors.
          }
        }
        return false;
      }, normalizedSelectors);
      if (matched) {
        return true;
      }
    } catch {
      // Ignore transient runtime errors during navigation.
    }
    await sleep(QUERY_WAIT_POLL_MS);
  }
  return false;
}

async function navigateDouyinPage(session, url, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const pageType = inferDouyinPageTypeFromUrl(url);
  await session.navigateAndWait(url, buildQueryWaitPolicy(timeoutMs));
  await waitForAnySelector(
    session,
    resolveDouyinReadySelectors(pageType) ?? ['a[href*="/video/"]', 'a[href*="/user/"]'],
    Math.min(timeoutMs, 12_000),
  );
  return { url, pageType };
}

function normalizeObservedVideo(video = {}, fallbackUser = {}) {
  return {
    title: normalizeText(video?.title) || normalizeText(video?.videoId),
    url: canonicalizeDouyinVideoUrl(video?.url),
    videoId: normalizeText(video?.videoId),
    authorName: normalizeText(video?.authorName) || normalizeText(fallbackUser?.name),
    authorUrl: canonicalizeDouyinAuthorUrl(video?.authorUrl) || canonicalizeDouyinAuthorUrl(fallbackUser?.url),
    userId: normalizeText(video?.userId) || normalizeText(fallbackUser?.userId),
    uid: normalizeText(video?.uid) || normalizeText(fallbackUser?.uid),
    secUid: normalizeText(video?.secUid) || normalizeText(fallbackUser?.secUid),
    source: normalizeText(video?.source),
    createTime: video?.createTime ?? null,
    resolvedMediaUrl: normalizeText(video?.resolvedMediaUrl),
    resolvedTitle: normalizeText(video?.resolvedTitle),
    resolvedFormat: video?.resolvedFormat ?? null,
    resolvedFormats: Array.isArray(video?.resolvedFormats) ? video.resolvedFormats : [],
  };
}

function finalizePostsApiVideo(video = {}) {
  const { awemeData, ...rest } = video ?? {};
  const seed = buildDouyinDownloadTaskSeed(video?.awemeData ?? null, {
    requestedUrl: normalizeText(video?.url) || (normalizeText(video?.videoId) ? `https://www.douyin.com/video/${video.videoId}` : null),
  });
  return {
    ...rest,
    resolvedMediaUrl: normalizeText(video?.resolvedMediaUrl) || seed?.resolvedMediaUrl || null,
    resolvedTitle: normalizeText(video?.resolvedTitle) || seed?.resolvedTitle || null,
    resolvedFormat: video?.resolvedFormat ?? seed?.resolvedFormat ?? null,
    resolvedFormats: [],
  };
}

function sortObservedVideos(videos = []) {
  return toArray(videos)
    .filter((video) => video && typeof video === 'object')
    .slice()
    .sort((left, right) => {
      const leftTime = Number(left?.createTime ?? 0);
      const rightTime = Number(right?.createTime ?? 0);
      if (leftTime !== rightTime) {
        return rightTime - leftTime;
      }
      return String(left?.videoId ?? left?.url ?? '').localeCompare(String(right?.videoId ?? right?.url ?? ''));
    });
}

function dedupeObservedVideos(videos = []) {
  const deduped = [];
  const seen = new Set();
  for (const video of videos) {
    const normalized = normalizeObservedVideo(video);
    const key = normalized.videoId ? `video::${normalized.videoId}` : normalized.url ? `url::${normalized.url}` : null;
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(normalized);
  }
  return sortObservedVideos(deduped);
}

export function isLikelyDouyinAuthorShellSurface(snapshot = {}) {
  const title = normalizeText(snapshot?.title);
  const h1 = normalizeText(snapshot?.h1);
  const body = normalizeText(snapshot?.bodyText || snapshot?.bodySnippet);
  const videoAnchorCount = Number(snapshot?.videoAnchorCount ?? 0);
  const shellMarkers = ['精选', '推荐', '搜索', '关注', '朋友', '我的', '下载抖音精选'];
  const markerCount = shellMarkers.filter((marker) => body.includes(marker)).length;
  return !h1 && videoAnchorCount === 0 && markerCount >= 4 && (!title || /的抖音\s*-\s*抖音$/u.test(title));
}

async function pageResolveDouyinAuthorIdentity(session) {
  return await session.callPageFunction(() => {
    const normalizeTextLocal = (value) => String(value ?? '').replace(/\s+/gu, ' ').trim();
    const renderNode = document.getElementById('RENDER_DATA');
    let renderData = null;
    try {
      renderData = renderNode?.textContent ? JSON.parse(decodeURIComponent(renderNode.textContent)) : null;
    } catch {
      renderData = null;
    }
    const pathUserId = normalizeTextLocal(String(window.location.pathname || '').match(/\/user\/([^/?#]+)/u)?.[1] || '');
    const info = renderData?.app?.user?.info
      ?? renderData?.app?.userInfo
      ?? renderData?.user?.user
      ?? null;
    const secUid = normalizeTextLocal(info?.secUid || info?.sec_uid || pathUserId || '');
    const uid = normalizeTextLocal(info?.uid || '');
    const authorUrl = secUid
      ? `https://www.douyin.com/user/${secUid}`
      : uid
        ? `https://www.douyin.com/user/${uid}`
        : normalizeTextLocal(window.location.href);
    const hasVisibleAuthorHeader = Boolean(normalizeTextLocal(document.querySelector('h1')?.textContent || ''));
    return {
      name: hasVisibleAuthorHeader
        ? normalizeTextLocal(document.querySelector('h1')?.textContent || info?.nickname || document.title)
        : normalizeTextLocal(document.querySelector('h1')?.textContent || ''),
      userId: hasVisibleAuthorHeader ? (secUid || uid || pathUserId || null) : (pathUserId || null),
      secUid: hasVisibleAuthorHeader ? (secUid || null) : (pathUserId || null),
      uid: hasVisibleAuthorHeader ? (uid || null) : null,
      url: hasVisibleAuthorHeader ? (authorUrl || null) : (pathUserId ? `https://www.douyin.com/user/${pathUserId}` : null),
      hasVisibleAuthorHeader,
    };
  });
}

async function pageDescribeCurrentAuthorSurface(session) {
  return await session.callPageFunction(() => ({
    href: String(window.location.href || ''),
    title: String(document.title || ''),
    h1: document.querySelector('h1')?.textContent || null,
    bodyText: (document.body?.innerText || '').slice(0, 1200),
    videoAnchorCount: document.querySelectorAll('a[href*="/video/"], a[href*="/shipin/"]').length,
    userAnchorCount: document.querySelectorAll('a[href*="/user/"]').length,
  }));
}

async function pageFetchDouyinUserPostsPage(session, input = {}) {
  const page = await session.callPageFunction(async (request = {}) => {
    const normalizeTextLocal = (value) => String(value ?? '').replace(/\s+/gu, ' ').trim();
    const compactVideo = (video) => {
      if (!video || typeof video !== 'object') {
        return null;
      }
      return {
        width: Number(video?.width) || 0,
        height: Number(video?.height) || 0,
        duration: Number(video?.duration) || 0,
        format: normalizeTextLocal(video?.format || ''),
        play_addr: video?.play_addr ?? null,
        play_addr_h264: video?.play_addr_h264 ?? video?.playAddrH264 ?? null,
        play_addr_265: video?.play_addr_265 ?? video?.playAddr265 ?? null,
        download_addr: video?.download_addr ?? null,
        bit_rate: Array.isArray(video?.bit_rate)
          ? video.bit_rate.map((entry) => ({
            gear_name: normalizeTextLocal(entry?.gear_name || entry?.gearName || ''),
            quality_type: Number(entry?.quality_type ?? entry?.qualityType) || 0,
            bit_rate: Number(entry?.bit_rate ?? entry?.bitRate) || 0,
            width: Number(entry?.width) || 0,
            height: Number(entry?.height) || 0,
            format: normalizeTextLocal(entry?.format || ''),
            is_h265: entry?.is_h265 ?? entry?.isH265 ?? 0,
            play_addr: entry?.play_addr ?? null,
            play_addr_h264: entry?.play_addr_h264 ?? entry?.playAddrH264 ?? null,
            play_addr_265: entry?.play_addr_265 ?? entry?.playAddr265 ?? null,
          }))
          : [],
      };
    };
    const params = new URLSearchParams({
      device_platform: 'webapp',
      aid: '6383',
      channel: 'channel_pc_web',
      max_cursor: String(Number(request.maxCursor) || 0),
      count: String(Math.max(1, Number(request.count) || 18)),
    });
    const userId = normalizeTextLocal(request.uid || '');
    const secUid = normalizeTextLocal(request.secUid || request.userId || '');
    if (userId) {
      params.set('user_id', userId);
    }
    if (secUid) {
      params.set('sec_user_id', secUid);
    }
    const response = await fetch(`/aweme/v1/web/aweme/post/?${params.toString()}`, {
      credentials: 'include',
    });
    const json = await response.json();
    const videos = Array.isArray(json?.aweme_list)
      ? json.aweme_list
        .filter((aweme) => aweme && typeof aweme === 'object' && aweme.aweme_id)
        .map((aweme) => ({
          title: normalizeTextLocal(aweme?.desc || aweme?.share_info?.share_title || aweme?.aweme_id || ''),
          url: normalizeTextLocal(aweme?.share_url || (aweme?.aweme_id ? `https://www.douyin.com/video/${aweme.aweme_id}` : '')) || null,
          videoId: normalizeTextLocal(aweme?.aweme_id || ''),
          authorName: normalizeTextLocal(aweme?.author?.nickname || ''),
          authorUrl: normalizeTextLocal(
            aweme?.author?.sec_uid
              ? `https://www.douyin.com/user/${aweme.author.sec_uid}`
              : aweme?.author?.uid
                ? `https://www.douyin.com/user/${aweme.author.uid}`
                : '',
          ) || null,
          userId: normalizeTextLocal(aweme?.author?.sec_uid || aweme?.author?.uid || ''),
          uid: normalizeTextLocal(aweme?.author?.uid || ''),
          secUid: normalizeTextLocal(aweme?.author?.sec_uid || ''),
          createTime: aweme?.create_time ?? null,
          source: 'posts-api',
          awemeData: {
            aweme_id: normalizeTextLocal(aweme?.aweme_id || ''),
            desc: normalizeTextLocal(aweme?.desc || ''),
            create_time: aweme?.create_time ?? null,
            share_info: aweme?.share_info
              ? {
                share_title: normalizeTextLocal(aweme?.share_info?.share_title || ''),
              }
              : null,
            author: {
              uid: normalizeTextLocal(aweme?.author?.uid || ''),
              sec_uid: normalizeTextLocal(aweme?.author?.sec_uid || ''),
              nickname: normalizeTextLocal(aweme?.author?.nickname || ''),
            },
            video: compactVideo(aweme?.video),
          },
        }))
      : [];
    return {
      videos,
      hasMore: json?.has_more === true || Number(json?.has_more) === 1,
      nextCursor: Number(json?.max_cursor) || 0,
      error: response.ok ? null : `http-${response.status}`,
    };
  }, input);
  return {
    ...page,
    videos: toArray(page?.videos).map((video) => finalizePostsApiVideo(video)),
  };
}

async function pageCollectDouyinUserPosts(session) {
  return await session.callPageFunction(async () => {
    const normalizeTextLocal = (value) => String(value ?? '').replace(/\s+/gu, ' ').trim();
    const normalizeUrlLocal = (value) => {
      try {
        return new URL(String(value ?? ''), window.location.href).toString();
      } catch {
        return normalizeTextLocal(value);
      }
    };
    const userIdFromUrl = (value) => normalizeTextLocal(String(value ?? '').match(/\/user\/([^/?#]+)/u)?.[1] || '') || null;
    const videoIdFromUrl = (value) => normalizeTextLocal(String(value ?? '').match(/\/(?:video|shipin)\/([^/?#]+)/u)?.[1] || '') || null;
    const isVisible = (node) => {
      if (!(node instanceof Element)) {
        return false;
      }
      const style = window.getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity || '1') === 0) {
        return false;
      }
      const rect = node.getBoundingClientRect();
      return rect.width >= 8 && rect.height >= 8;
    };
    const terminalPatterns = [/没有更多/u, /已经到底了?/u, /暂无内容/u, /暂无作品/u];
    const posts = [];
    const seen = new Set();
    let terminalReached = false;

    for (const anchor of Array.from(document.querySelectorAll('a[href*="/video/"], a[href*="/shipin/"]'))) {
      if (!(anchor instanceof HTMLAnchorElement) || !isVisible(anchor)) {
        continue;
      }
      const url = normalizeUrlLocal(anchor.getAttribute('href') || '');
      const videoId = videoIdFromUrl(url);
      if (!url || !videoId) {
        continue;
      }
      const container = anchor.closest('[data-e2e*="user-post-item"], [data-e2e*="video-feed-item"], li, article, div');
      const title = normalizeTextLocal(
        anchor.getAttribute('title')
        || anchor.textContent
        || container?.querySelector?.('[title]')?.getAttribute?.('title')
        || container?.querySelector?.('img[alt]')?.getAttribute?.('alt')
        || '',
      );
      const key = `video::${videoId}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      posts.push({
        title: title || videoId,
        url,
        videoId,
        source: 'dom-fallback',
      });
    }
    const source = normalizeTextLocal(document.body?.innerText || document.documentElement?.innerText || '');
    terminalReached = terminalPatterns.some((pattern) => pattern.test(source));

    const pathname = String(window.location.pathname || '');
    const finalUrl = window.location.href;
    return {
      finalUrl,
      authorUrl: finalUrl,
      userId: userIdFromUrl(pathname ? `https://www.douyin.com${pathname}` : finalUrl),
      authorName: normalizeTextLocal(document.querySelector('h1')?.textContent || document.title.replace(/\s*-\s*抖音.*$/u, '')),
      posts,
      terminalReached,
    };
  });
}

async function scrollDouyinPage(session) {
  await session.callPageFunction(() => {
    window.scrollTo(0, document.documentElement.scrollHeight || document.body.scrollHeight || 0);
    return true;
  });
  await sleep(FOLLOW_SCROLL_DELAY_MS);
}

export async function enumerateDouyinAuthorVideos(inputUrl, options = {}, deps = {}) {
  const settings = {
    timeoutMs: Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS,
    profilePath: options.profilePath ?? null,
    browserPath: options.browserPath,
    browserProfileRoot: options.browserProfileRoot,
    userDataDir: options.userDataDir,
    reuseLoginState: options.reuseLoginState !== false,
    autoLogin: options.autoLogin !== false,
    headless: options.headless,
    limit: Number.isFinite(Number(options.limit)) && Number(options.limit) > 0 ? Math.trunc(Number(options.limit)) : null,
    viewport: {
      ...DEFAULT_VIEWPORT,
      ...(options.viewport ?? {}),
    },
  };
  const authProfile = await (deps.resolveSiteAuthProfile ?? resolveSiteAuthProfile)(inputUrl, {
    profilePath: settings.profilePath,
  });
  const authContext = await (deps.resolveSiteBrowserSessionOptions ?? resolveSiteBrowserSessionOptions)(inputUrl, settings, {
    profilePath: settings.profilePath,
    authProfile,
  });
  const governance = await (deps.prepareSiteSessionGovernance ?? prepareSiteSessionGovernance)(
    inputUrl,
    authContext,
    settings,
    {
      operation: 'enumerate-douyin-author-videos',
      networkOptions: {
        disableExternalLookup: true,
      },
    },
  );
  if (!governance.policyDecision.allowed) {
    const blockedError = new Error(`Douyin author enumeration blocked by runtime governance: ${governance.policyDecision.riskCauseCode ?? 'unknown-risk'}.`);
    blockedError.code = governance.policyDecision.riskCauseCode ?? 'DOUYIN_AUTHOR_ENUMERATION_BLOCKED';
    if (governance.lease) {
      await (deps.releaseSessionLease ?? releaseSessionLease)(governance.lease);
    }
    throw blockedError;
  }

  let governanceFinalized = false;
/** @type {import('../../../infra/browser/session.mjs').BrowserSession | null} */
  let session = null;
  try {
    const requestedAuthorUrl = canonicalizeDouyinAuthorUrl(inputUrl);
    const requestedAuthorUserId = normalizeText(requestedAuthorUrl.match(/\/user\/([^/?#]+)/u)?.[1] || '') || null;
    const postsUrl = requestedAuthorUserId
      ? `${requestedAuthorUrl}?showTab=post`
      : `${String(inputUrl).split('?')[0]}?showTab=post`;
    session = await (deps.openBrowserSession ?? openBrowserSession)({
      ...settings,
      userDataDir: authContext.userDataDir,
      cleanupUserDataDirOnShutdown: authContext.cleanupUserDataDirOnShutdown,
      startupUrl: requestedAuthorUrl || inputUrl,
    });

    await navigateDouyinPage(session, postsUrl, settings.timeoutMs);
    let surface = await pageDescribeCurrentAuthorSurface(session);
    if (isLikelyDouyinAuthorShellSurface(surface)) {
      await navigateDouyinPage(session, 'https://www.douyin.com/?recommend=1', settings.timeoutMs);
      await navigateDouyinPage(session, postsUrl, settings.timeoutMs);
      surface = await pageDescribeCurrentAuthorSurface(session);
    }
    const author = await pageResolveDouyinAuthorIdentity(session);

    const apiVideos = [];
    const seenApiVideos = new Set();
    let cursor = 0;
    let hasMore = true;
    let apiError = null;
    while (hasMore) {
      const page = await pageFetchDouyinUserPostsPage(session, {
        userId: author?.userId,
        uid: author?.uid,
        secUid: author?.secUid ?? author?.userId,
        maxCursor: cursor,
        count: 18,
      });
      if (page?.error) {
        apiError = page.error;
        break;
      }
      const pageVideos = dedupeObservedVideos(
        toArray(page?.videos).map((video) => normalizeObservedVideo(video, author)),
      );
      if (!pageVideos.length) {
        hasMore = false;
        break;
      }
      let newCount = 0;
      for (const video of pageVideos) {
        const key = video?.videoId ? `video::${video.videoId}` : video?.url ? `url::${video.url}` : null;
        if (!key || seenApiVideos.has(key)) {
          continue;
        }
        seenApiVideos.add(key);
        apiVideos.push(video);
        newCount += 1;
        if (settings.limit && apiVideos.length >= settings.limit) {
          hasMore = false;
          break;
        }
      }
      if (!hasMore) {
        break;
      }
      if (newCount === 0) {
        hasMore = false;
        break;
      }
      hasMore = page?.hasMore === true;
      cursor = Number(page?.nextCursor) || 0;
      if (!hasMore || cursor <= 0) {
        break;
      }
    }

    let videos = dedupeObservedVideos(apiVideos);
    let partial = Boolean(apiError);
    const errors = [];
    if (!videos.length) {
      let observed = [];
      let stableRounds = 0;
      let previousCount = 0;
      for (let round = 0; round < AUTHOR_POST_SCROLL_MAX_ROUNDS; round += 1) {
        const sampled = await pageCollectDouyinUserPosts(session);
        observed = dedupeObservedVideos(
          toArray(sampled?.posts).map((video) => normalizeObservedVideo({
            ...video,
            authorName: sampled?.authorName || author?.name,
            authorUrl: sampled?.authorUrl || author?.url,
            userId: sampled?.userId || author?.userId,
          }, author)),
        );
        if (observed.length === previousCount) {
          stableRounds += 1;
        } else {
          previousCount = observed.length;
          stableRounds = 0;
        }
        if (sampled?.terminalReached === true || stableRounds >= 3 || (settings.limit && observed.length >= settings.limit)) {
          break;
        }
        await scrollDouyinPage(session);
      }
      videos = observed;
      const html = await session.captureHtml();
      const createTimeMap = parseDouyinCreateTimeMapFromHtml(
        html,
        videos.map((video) => normalizeText(video?.videoId)).filter(Boolean),
      );
      videos = dedupeObservedVideos(videos.map((video) => ({
        ...video,
        createTime: createTimeMap.get(normalizeText(video?.videoId)) ?? video?.createTime ?? null,
      })));
      if (!videos.length && isLikelyDouyinAuthorShellSurface(surface)) {
        partial = true;
        errors.push({
          reason: 'author-empty-shell',
          message: 'Public author page loaded as a shell surface without visible works.',
        });
      } else {
        partial = partial || videos.length === 0;
      }
    }

    if (settings.limit) {
      videos = videos.slice(0, settings.limit);
    }

    const governanceSummary = await (deps.finalizeSiteSessionGovernance ?? finalizeSiteSessionGovernance)(governance, {
      antiCrawlSignals: [],
      authRequired: false,
      authAvailable: true,
      loginStateDetected: true,
      identityConfirmed: true,
      persistedHealthySession: true,
      note: 'enumerate-douyin-author-videos',
    });
    governanceFinalized = true;

    return {
      site: {
        url: inputUrl,
        host: authProfile?.profile?.host ?? null,
      },
      auth: {
        verificationUrl: resolveAuthKeepaliveUrl(inputUrl, authProfile, authContext.authConfig) ?? null,
        userDataDir: authContext.userDataDir ?? null,
      },
      runtimeGovernance: governanceSummary,
      result: {
        queryType: 'list-author-videos',
        author: {
          name: author?.name ?? null,
          url: canonicalizeDouyinAuthorUrl(author?.url) || requestedAuthorUrl || postsUrl,
          userId: author?.userId ?? requestedAuthorUserId ?? null,
          secUid: author?.secUid ?? requestedAuthorUserId ?? null,
          uid: author?.uid ?? null,
        },
        totalVideos: videos.length,
        partial,
        errors: [
          ...(apiError ? [{ reason: apiError, message: `Posts API fallback triggered: ${apiError}.` }] : []),
          ...errors,
        ],
        videos,
      },
    };
  } finally {
    await session?.close?.();
    if (!governanceFinalized && governance?.lease) {
      await (deps.releaseSessionLease ?? releaseSessionLease)(governance.lease);
    }
  }
}
