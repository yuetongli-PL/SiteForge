// @ts-check

import path from 'node:path';
import process from 'node:process';

import { openBrowserSession } from '../../../infra/browser/session.mjs';
import { initializeCliUtf8, writeJsonStdout } from '../../../infra/cli.mjs';
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
import {
  inferDouyinPageTypeFromUrl,
  resolveDouyinHeadlessDefault,
} from '../model/site.mjs';
import { resolveDouyinReadySelectors } from '../model/diagnosis.mjs';
import { resolveProfilePathForUrl } from '../../core/profiles.mjs';

const DEFAULT_TIMEOUT_MS = 30_000;
const QUERY_WAIT_POLL_MS = 200;
const DETAIL_FETCH_COUNT = 1;
const DEFAULT_VIEWPORT = {
  width: 1440,
  height: 900,
  deviceScaleFactor: 1,
};
const VIDEO_ID_PATTERN = /^\d{10,20}$/u;
const VIDEO_URL_PATTERN = /\/(?:video|shipin)\/([^/?#]+)/iu;

function normalizeText(value) {
  return String(value ?? '').replace(/\s+/gu, ' ').trim();
}

function toArray(value) {
  if (Array.isArray(value)) {
    return value;
  }
  return value === undefined || value === null ? [] : [value];
}

function toPositiveInteger(value, fallback = null) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.trunc(parsed);
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

function extractDouyinVideoId(value) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return null;
  }
  if (VIDEO_ID_PATTERN.test(normalized)) {
    return normalized;
  }
  try {
    const parsed = new URL(normalized);
    if (!/(^|\.)douyin\.com$/iu.test(parsed.hostname) && !/(^|\.)iesdouyin\.com$/iu.test(parsed.hostname)) {
      return null;
    }
    if (/(^|\.)iesdouyin\.com$/iu.test(parsed.hostname)) {
      return normalizeText(parsed.pathname.match(/\/share\/video\/(\d{10,20})/iu)?.[1] ?? '') || null;
    }
    return normalizeText(parsed.pathname.match(VIDEO_URL_PATTERN)?.[1] ?? '') || null;
  } catch {
    return null;
  }
}

function normalizeDouyinVideoInput(value) {
  const normalized = normalizeText(value);
  const videoId = extractDouyinVideoId(normalized);
  if (!videoId) {
    throw new Error(`Unsupported Douyin video input: ${value}`);
  }
  return {
    input: value,
    videoId,
    normalizedUrl: `https://www.douyin.com/video/${videoId}`,
  };
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
            // Ignore invalid selectors during a best-effort wait.
          }
        }
        return false;
      }, normalizedSelectors);
      if (matched) {
        return true;
      }
    } catch {
      // Ignore transient navigation/runtime errors.
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

function normalizeUrlValue(value) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return null;
  }
  try {
    return new URL(normalized).toString();
  } catch {
    return null;
  }
}

function collectUrlList(value) {
  const results = [];
  const seen = new Set();
  const append = (candidate) => {
    const normalized = normalizeUrlValue(candidate);
    if (!normalized || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    results.push(normalized);
  };
  const walk = (candidate) => {
    if (!candidate) {
      return;
    }
    if (typeof candidate === 'string') {
      append(candidate);
      return;
    }
    if (Array.isArray(candidate)) {
      for (const item of candidate) {
        walk(item);
      }
      return;
    }
    if (typeof candidate !== 'object') {
      return;
    }
    if ('src' in candidate) {
      append(candidate.src);
    }
    if ('url' in candidate) {
      append(candidate.url);
    }
    if ('uri' in candidate) {
      append(candidate.uri);
    }
    walk(candidate.url_list ?? candidate.urlList ?? candidate.playAddr ?? candidate.play_addr ?? candidate.urls);
  };
  walk(value);
  return results;
}

function normalizeNumeric(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return parsed;
}

function normalizeFormatEntry(sourceType, rawEntry, video, codecHint = null) {
  const urls = collectUrlList(
    rawEntry?.play_addr
      ?? rawEntry?.playAddr
      ?? rawEntry?.download_addr
      ?? rawEntry?.downloadAddr
      ?? rawEntry,
  );
  if (!urls.length) {
    return null;
  }
  const width = normalizeNumeric(rawEntry?.width ?? video?.width, 0);
  const height = normalizeNumeric(rawEntry?.height ?? video?.height, 0);
  const bitRate = normalizeNumeric(rawEntry?.bit_rate ?? rawEntry?.bitRate ?? rawEntry?.realBitrate ?? rawEntry?.real_bitrate, 0);
  const dataSize = normalizeNumeric(rawEntry?.data_size ?? rawEntry?.dataSize ?? rawEntry?.playAddrSize ?? rawEntry?.downloadAddrSize, 0);
  const qualityType = normalizeNumeric(rawEntry?.quality_type ?? rawEntry?.qualityType, 0);
  const isH265 = rawEntry?.is_h265 === 1 || rawEntry?.isH265 === 1;
  const codec = normalizeText(
    (rawEntry?.video_format ?? rawEntry?.videoFormat)
      || codecHint
      || (isH265 ? 'h265' : 'h264'),
  ) || null;
  return {
    sourceType,
    width,
    height,
    bitRate,
    dataSize,
    qualityType,
    codec,
    formatId: normalizeText(rawEntry?.gear_name ?? rawEntry?.gearName ?? rawEntry?.format ?? rawEntry?.qualityType ?? sourceType) || sourceType,
    urls,
    url: urls[0],
  };
}

function buildFormatEntries(video = {}) {
  const entries = [];
  const pushEntry = (entry) => {
    if (!entry?.url) {
      return;
    }
    entries.push(entry);
  };
  for (const rawEntry of toArray(video?.bit_rate ?? video?.bitRate ?? video?.bitRateList)) {
    pushEntry(normalizeFormatEntry('bit-rate', rawEntry, video));
  }
  pushEntry(normalizeFormatEntry('play-addr-h264', video?.play_addr_h264 ?? video?.playAddrH264, video, 'h264'));
  pushEntry(normalizeFormatEntry('play-addr-h265', video?.play_addr_h265 ?? video?.playAddrH265, video, 'h265'));
  pushEntry(normalizeFormatEntry('play-addr', video?.play_addr ?? video?.playAddr, video));
  pushEntry(normalizeFormatEntry('download-addr', video?.download_addr ?? video?.downloadAddr, video));

  const seen = new Set();
  return entries.filter((entry) => {
    const key = `${entry.url}::${entry.height}::${entry.bitRate}::${entry.formatId}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function formatSourceRank(sourceType) {
  switch (sourceType) {
    case 'bit-rate':
      return 5;
    case 'play-addr-h264':
      return 4;
    case 'play-addr-h265':
      return 4;
    case 'play-addr':
      return 3;
    case 'download-addr':
      return 2;
    default:
      return 1;
  }
}

export function selectBestDouyinFormat(formats = []) {
  return [...toArray(formats)]
    .filter((item) => item?.url)
    .sort((left, right) => {
      return normalizeNumeric(right?.height, 0) - normalizeNumeric(left?.height, 0)
        || normalizeNumeric(right?.bitRate, 0) - normalizeNumeric(left?.bitRate, 0)
        || normalizeNumeric(right?.dataSize, 0) - normalizeNumeric(left?.dataSize, 0)
        || formatSourceRank(right?.sourceType) - formatSourceRank(left?.sourceType)
        || String(left?.formatId ?? '').localeCompare(String(right?.formatId ?? ''), 'en');
    })[0] ?? null;
}

export function normalizeDouyinVideoDownloadMetadata(detail = {}, options = {}) {
  const awemeDetail = detail?.aweme_detail ?? detail?.awemeDetail ?? detail?.data?.aweme_detail ?? detail?.data?.awemeDetail ?? detail;
  if (!awemeDetail || typeof awemeDetail !== 'object') {
    return null;
  }
  const awemeId = normalizeText(
    awemeDetail?.aweme_id
      ?? awemeDetail?.awemeId
      ?? awemeDetail?.group_id
      ?? awemeDetail?.groupId
      ?? options.videoId,
  ) || null;
  const video = awemeDetail?.video ?? awemeDetail?.video_info ?? {};
  const author = awemeDetail?.author ?? {};
  const authorSecUid = normalizeText(author?.sec_uid ?? author?.secUid) || null;
  const authorUid = normalizeText(author?.uid) || null;
  const authorUrl = authorSecUid
    ? `https://www.douyin.com/user/${authorSecUid}`
    : authorUid
      ? `https://www.douyin.com/user/${authorUid}`
      : null;
  const formats = buildFormatEntries(video);
  const bestFormat = selectBestDouyinFormat(formats);
  if (!bestFormat?.url) {
    return null;
  }
  return {
    requestedUrl: normalizeText(options.requestedUrl) || (awemeId ? `https://www.douyin.com/video/${awemeId}` : null),
    videoId: awemeId,
    bestUrl: bestFormat.url,
    bestFormat,
    formats,
    title: normalizeText(
      awemeDetail?.desc
        ?? awemeDetail?.share_info?.share_title
        ?? awemeDetail?.item_title
        ?? awemeId,
    ) || awemeId,
    createTime: normalizeNumeric(awemeDetail?.create_time ?? awemeDetail?.createTime, 0) || null,
    authorName: normalizeText(author?.nickname) || null,
    authorUrl,
    coverUrl: collectUrlList(
      video?.cover
        ?? video?.cover_url
        ?? video?.coverUrl
        ?? video?.origin_cover
        ?? video?.originCover,
    )[0] ?? null,
  };
}

export function buildDouyinDownloadTaskSeed(detail = {}, options = {}) {
  const metadata = normalizeDouyinVideoDownloadMetadata(detail, options);
  if (!metadata?.bestUrl) {
    return null;
  }
  return {
    finalUrl: metadata.requestedUrl ?? null,
    videoId: metadata.videoId ?? null,
    resolvedMediaUrl: metadata.bestUrl,
    resolvedTitle: metadata.title ?? null,
    resolvedFormat: metadata.bestFormat ?? null,
    resolvedFormats: metadata.formats ?? [],
    resolvedAuthorName: metadata.authorName ?? null,
    resolvedAuthorUrl: metadata.authorUrl ?? null,
    resolvedCoverUrl: metadata.coverUrl ?? null,
    resolvedCreateTime: metadata.createTime ?? null,
  };
}

function userIdFromDouyinAuthorUrl(value) {
  return normalizeText(String(value ?? '').match(/\/user\/([^/?#]+)/u)?.[1] ?? '') || null;
}

function buildPageContextHeaders(pageContext = {}, requestedUrl = '') {
  const headers = {};
  const userAgent = normalizeText(pageContext?.userAgent);
  const acceptLanguage = normalizeText(pageContext?.acceptLanguage);
  const referer = normalizeText(requestedUrl) || normalizeText(pageContext?.pageUrl);
  const origin = normalizeText(pageContext?.origin) || 'https://www.douyin.com';
  if (userAgent) {
    headers['User-Agent'] = userAgent;
  }
  if (acceptLanguage) {
    headers['Accept-Language'] = acceptLanguage;
  }
  if (referer) {
    headers.Referer = referer;
  }
  if (origin) {
    headers.Origin = origin;
  }
  return headers;
}

async function pageFetchDouyinVideoDetail(session, input = {}) {
  return await session.callPageFunction(async (request = {}) => {
    const normalizeTextLocal = (value) => String(value ?? '').replace(/\s+/gu, ' ').trim();
    const awemeId = normalizeTextLocal(request.awemeId || '');
    if (!awemeId) {
      return { ok: false, error: 'missing-aweme-id' };
    }
    const params = new URLSearchParams({
      device_platform: 'webapp',
      aid: '6383',
      channel: 'channel_pc_web',
      aweme_id: awemeId,
      item_type: '0',
      count: String(Math.max(1, Number(request.count) || 1)),
    });
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timeoutMs = Math.max(2_000, Number(request.timeoutMs) || 12_000);
    const timeoutHandle = controller
      ? setTimeout(() => {
        try {
          controller.abort();
        } catch {
          // Ignore abort failures.
        }
      }, timeoutMs)
      : null;
    let response = null;
    let text = '';
    let fetchError = null;
    try {
      response = await fetch(`/aweme/v1/web/aweme/detail/?${params.toString()}`, {
        credentials: 'include',
        signal: controller?.signal,
        headers: {
          accept: 'application/json, text/plain, */*',
        },
      });
      text = await response.text();
    } catch (error) {
      fetchError = normalizeTextLocal(error?.message || String(error));
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return {
      ok: response?.ok === true,
      status: Number(response?.status) || null,
      responseUrl: normalizeTextLocal(response?.url || ''),
      json,
      textSnippet: text.slice(0, 800),
      error: fetchError,
      pageContext: {
        userAgent: normalizeTextLocal(navigator.userAgent || ''),
        acceptLanguage: normalizeTextLocal(
          Array.isArray(navigator.languages) && navigator.languages.length
            ? navigator.languages.join(',')
            : navigator.language || '',
        ),
        pageUrl: normalizeTextLocal(location.href || ''),
        origin: normalizeTextLocal(location.origin || ''),
      },
    };
  }, input);
}

async function pageReadDouyinDetailContext(session) {
  return await session.callPageFunction(() => {
    const normalizeTextLocal = (value) => String(value ?? '').replace(/\s+/gu, ' ').trim();
    const safeDecode = (value) => {
      try {
        return decodeURIComponent(String(value ?? ''));
      } catch {
        return normalizeTextLocal(value);
      }
    };
    const normalizeUrlLocal = (value) => {
      const text = normalizeTextLocal(value);
      if (!text) {
        return null;
      }
      try {
        return new URL(text, window.location.href).toString();
      } catch {
        return null;
      }
    };
    const renderDataText = safeDecode(document.getElementById('RENDER_DATA')?.textContent || '').slice(0, 400_000);
    const ssrVideoDetail = (() => {
      try {
        return window?.SSR_RENDER_DATA?.app?.videoDetail ?? null;
      } catch {
        return null;
      }
    })();
    const detailPayload = ssrVideoDetail?.itemInfo?.itemStruct
      ?? ssrVideoDetail?.itemInfo?.aweme_detail
      ?? ssrVideoDetail?.aweme_detail
      ?? ssrVideoDetail?.detail
      ?? null;
    const authorPayload = detailPayload?.author ?? {};
    const readPattern = (patterns = [], sources = []) => {
      for (const source of sources) {
        if (!source) {
          continue;
        }
        for (const pattern of patterns) {
          const matched = String(source).match(pattern);
          if (matched?.[1]) {
            return normalizeTextLocal(safeDecode(matched[1]));
          }
        }
      }
      return '';
    };
    const errorText = normalizeTextLocal(document.querySelector('[data-e2e="error-page"]')?.textContent || '');
    const bodySnippet = normalizeTextLocal(document.body?.innerText || '').slice(0, 400);
    const authorAnchor = Array.from(document.querySelectorAll('a[href*="/user/"]'))
      .map((anchor) => ({
        href: normalizeUrlLocal(anchor?.getAttribute?.('href') || anchor?.href || ''),
        text: normalizeTextLocal(anchor?.textContent || anchor?.getAttribute?.('title') || ''),
      }))
      .find((entry) => entry.href && !/\/user\/self(?:[/?#]|$)/iu.test(entry.href));
    const sourceCandidates = [renderDataText];
    const secUid = normalizeTextLocal(authorPayload?.sec_uid || authorPayload?.secUid || '') || readPattern([
      /"sec_uid"\s*:\s*"([^"]+)"/u,
      /sec_uid%22%3A%22([^"%&<]+?)(?:%22|&|<)/iu,
      /sec_uid%3D(MS4wLjAB[^%&<"]+)/iu,
      /(MS4wLjAB[^"%&<]+?)%22%2C%22(?:shortId|realName|nickname)/iu,
    ], sourceCandidates);
    const uid = normalizeTextLocal(authorPayload?.uid || '') || readPattern([
      /"uid"\s*:\s*"(\d{6,30})"/u,
      /uid%22%3A%22(\d{6,30})/iu,
    ], sourceCandidates);
    const authorName = authorAnchor?.text || normalizeTextLocal(authorPayload?.nickname || '') || readPattern([
      /"nickname"\s*:\s*"([^"]+)"/u,
      /nickname%22%3A%22([^"%&<]+?)(?:%22|&|<)/iu,
      /"realName"\s*:\s*"([^"]+)"/u,
      /realName%22%3A%22([^"%&<]+?)(?:%22|&|<)/iu,
    ], sourceCandidates);
    const authorUrl = authorAnchor?.href
      || (secUid ? normalizeUrlLocal(`https://www.douyin.com/user/${secUid}`) : null)
      || (uid ? normalizeUrlLocal(`https://www.douyin.com/user/${uid}`) : null);
    return {
      pageUrl: normalizeTextLocal(window.location.href || ''),
      title: normalizeTextLocal(document.title || ''),
      errorText,
      bodySnippet,
      authorName: authorName || null,
      authorUrl: authorUrl || null,
      userId: normalizeTextLocal(String(authorUrl || '').match(/\/user\/([^/?#]+)/u)?.[1] || '') || secUid || uid || null,
      secUid: secUid || null,
      uid: uid || null,
      pageContext: {
        userAgent: normalizeTextLocal(navigator.userAgent || ''),
        acceptLanguage: normalizeTextLocal(
          Array.isArray(navigator.languages) && navigator.languages.length
            ? navigator.languages.join(',')
            : navigator.language || '',
        ),
        pageUrl: normalizeTextLocal(window.location.href || ''),
        origin: normalizeTextLocal(window.location.origin || ''),
      },
    };
  });
}

async function pageFetchDouyinUserPostsPage(session, input = {}) {
  return await session.callPageFunction(async (request = {}) => {
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
}

function finalizePostsApiVideo(video = {}) {
  const metadata = buildDouyinDownloadTaskSeed(video?.awemeData ?? null, {
    requestedUrl: normalizeText(video?.url) || (normalizeText(video?.videoId) ? `https://www.douyin.com/video/${video.videoId}` : null),
  });
  return {
    ...video,
    resolvedMediaUrl: metadata?.resolvedMediaUrl ?? null,
    resolvedTitle: metadata?.resolvedTitle ?? null,
    resolvedFormat: metadata?.resolvedFormat ?? null,
    resolvedFormats: metadata?.resolvedFormats ?? [],
  };
}

async function resolveSingleVideoViaAuthorPosts(session, item, settings, detailContext = null) {
  const pageContext = detailContext?.pageContext ?? {};
  const authorUrl = normalizeText(detailContext?.authorUrl);
  const userId = normalizeText(detailContext?.userId) || userIdFromDouyinAuthorUrl(authorUrl);
  const secUid = normalizeText(detailContext?.secUid) || (/^MS4wLjAB/iu.test(userId) ? userId : '');
  const uid = normalizeText(detailContext?.uid) || (/^\d{6,30}$/u.test(userId) ? userId : '');
  if (!authorUrl && !secUid && !uid) {
    return {
      requestedUrl: item.normalizedUrl,
      videoId: item.videoId,
      resolved: false,
      error: 'author-unavailable',
      detailStatus: null,
      textSnippet: normalizeText(detailContext?.errorText || detailContext?.bodySnippet || '') || null,
      headers: buildPageContextHeaders(pageContext, item.normalizedUrl),
    };
  }

  const seenCursors = new Set();
  let cursor = 0;
  let pagesScanned = 0;
  while (pagesScanned < 30 && !seenCursors.has(String(cursor))) {
    seenCursors.add(String(cursor));
    const page = await pageFetchDouyinUserPostsPage(session, {
      userId,
      uid,
      secUid: secUid || userId,
      maxCursor: cursor,
      count: 18,
    });
    if (page?.error) {
      return {
        requestedUrl: item.normalizedUrl,
        videoId: item.videoId,
        resolved: false,
        error: page.error,
        detailStatus: null,
        textSnippet: null,
        headers: buildPageContextHeaders(pageContext, item.normalizedUrl),
      };
    }
    const pageVideos = toArray(page?.videos).map((video) => finalizePostsApiVideo(video));
    const matched = pageVideos.find((video) => normalizeText(video?.videoId) === item.videoId && normalizeText(video?.resolvedMediaUrl));
    if (matched) {
      return {
        requestedUrl: item.normalizedUrl,
        videoId: item.videoId,
        resolved: true,
        title: normalizeText(matched?.resolvedTitle) || normalizeText(matched?.title) || item.videoId,
        createTime: matched?.createTime ?? null,
        authorName: normalizeText(matched?.authorName) || normalizeText(detailContext?.authorName) || null,
        authorUrl: normalizeText(matched?.authorUrl) || authorUrl || null,
        coverUrl: matched?.resolvedCoverUrl ?? null,
        bestUrl: matched?.resolvedMediaUrl,
        bestFormat: matched?.resolvedFormat ?? null,
        formats: matched?.resolvedFormats ?? [],
        headers: buildPageContextHeaders(pageContext, item.normalizedUrl),
      };
    }
    pagesScanned += 1;
    if (page?.hasMore !== true || !Number.isFinite(Number(page?.nextCursor)) || Number(page?.nextCursor) <= 0) {
      break;
    }
    cursor = Number(page.nextCursor);
  }

  return {
    requestedUrl: item.normalizedUrl,
    videoId: item.videoId,
    resolved: false,
    error: 'video-not-found-in-author-posts',
    detailStatus: null,
    textSnippet: normalizeText(detailContext?.bodySnippet || '') || null,
    headers: buildPageContextHeaders(pageContext, item.normalizedUrl),
  };
}

async function resolveSingleVideoMetadata(session, item, settings) {
  const requestedUrl = item.normalizedUrl;
  await navigateDouyinPage(session, requestedUrl, settings.timeoutMs);
  const detailContext = await pageReadDouyinDetailContext(session);
  if (/不存在|已删除|不可见/u.test(`${detailContext?.errorText ?? ''} ${detailContext?.bodySnippet ?? ''}`)) {
    return {
      requestedUrl,
      videoId: item.videoId,
      resolved: false,
      error: 'video-unavailable',
      detailStatus: null,
      textSnippet: normalizeText(detailContext?.errorText || detailContext?.bodySnippet || '') || null,
      headers: buildPageContextHeaders(detailContext?.pageContext ?? {}, requestedUrl),
    };
  }
  let detailResponse = await pageFetchDouyinVideoDetail(session, {
    awemeId: item.videoId,
    count: DETAIL_FETCH_COUNT,
    timeoutMs: Math.min(settings.timeoutMs, 12_000),
  });
  const metadata = normalizeDouyinVideoDownloadMetadata(detailResponse?.json, {
    requestedUrl,
    videoId: item.videoId,
  });
  if (metadata?.bestUrl) {
    return {
      requestedUrl,
      videoId: item.videoId,
      resolved: true,
      title: metadata.title,
      createTime: metadata.createTime,
      authorName: metadata.authorName,
      authorUrl: metadata.authorUrl,
      coverUrl: metadata.coverUrl,
      bestUrl: metadata.bestUrl,
      bestFormat: metadata.bestFormat,
      formats: metadata.formats,
      headers: buildPageContextHeaders(detailResponse?.pageContext ?? detailContext?.pageContext ?? {}, requestedUrl),
    };
  }
  return await resolveSingleVideoViaAuthorPosts(session, item, settings, detailContext);
}

async function resolveSingleVideoMetadataStable(session, item, settings) {
  const requestedUrl = item.normalizedUrl;
  const detailResponse = await pageFetchDouyinVideoDetail(session, {
    awemeId: item.videoId,
    count: DETAIL_FETCH_COUNT,
    timeoutMs: Math.min(settings.timeoutMs, 12_000),
  });
  const metadata = normalizeDouyinVideoDownloadMetadata(detailResponse?.json, {
    requestedUrl,
    videoId: item.videoId,
  });
  if (metadata?.bestUrl) {
    return {
      requestedUrl,
      videoId: item.videoId,
      resolved: true,
      title: metadata.title,
      createTime: metadata.createTime,
      authorName: metadata.authorName,
      authorUrl: metadata.authorUrl,
      coverUrl: metadata.coverUrl,
      bestUrl: metadata.bestUrl,
      bestFormat: metadata.bestFormat,
      formats: metadata.formats,
      headers: buildPageContextHeaders(detailResponse?.pageContext ?? {}, requestedUrl),
    };
  }
  await navigateDouyinPage(session, requestedUrl, settings.timeoutMs);
  const detailContext = await pageReadDouyinDetailContext(session);
  if (/视频不存在|已删除|不可见|无法观看/u.test(`${detailContext?.errorText ?? ''} ${detailContext?.bodySnippet ?? ''}`)) {
    return {
      requestedUrl,
      videoId: item.videoId,
      resolved: false,
      error: 'video-unavailable',
      detailStatus: detailResponse?.status ?? null,
      textSnippet: normalizeText(detailContext?.errorText || detailContext?.bodySnippet || '') || null,
      headers: buildPageContextHeaders(detailContext?.pageContext ?? detailResponse?.pageContext ?? {}, requestedUrl),
    };
  }
  return await resolveSingleVideoViaAuthorPosts(session, item, settings, detailContext);
}

function isTransientResolverError(error) {
  const text = normalizeText(error?.message || error || '');
  if (!text) {
    return false;
  }
  return /CDP timeout for Runtime\.evaluate|Target closed|Session closed|Execution context was destroyed|Browser exited before DevTools became ready/iu.test(text);
}

function mergeResolverOptions(inputUrl, options = {}) {
  const merged = {
    profilePath: null,
    browserPath: undefined,
    browserProfileRoot: undefined,
    userDataDir: undefined,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    headless: undefined,
    reuseLoginState: true,
    autoLogin: true,
    workspaceRoot: process.cwd(),
    viewport: {
      ...DEFAULT_VIEWPORT,
    },
    ...options,
  };
  merged.profilePath = merged.profilePath
    ? path.resolve(merged.profilePath)
    : resolveProfilePathForUrl(inputUrl, { profilesDir: path.resolve(process.cwd(), 'profiles') });
  merged.timeoutMs = toPositiveInteger(merged.timeoutMs, DEFAULT_TIMEOUT_MS);
  merged.headless = typeof merged.headless === 'boolean'
    ? merged.headless
    : resolveDouyinHeadlessDefault(inputUrl, false, null);
  merged.workspaceRoot = path.resolve(merged.workspaceRoot ?? process.cwd());
  merged.viewport = {
    ...DEFAULT_VIEWPORT,
    ...(merged.viewport ?? {}),
  };
  return merged;
}

export async function resolveDouyinMediaBatch(inputs, options = {}, deps = {}) {
  const normalizedInputs = toArray(inputs).map((value) => normalizeDouyinVideoInput(value));
  if (!normalizedInputs.length) {
    return {
      site: { url: 'https://www.douyin.com/', host: 'www.douyin.com' },
      auth: { status: 'not-started', verificationUrl: null, userDataDir: null },
      runtimeGovernance: null,
      results: [],
      summary: { total: 0, resolved: 0, failed: 0 },
    };
  }

  const inputUrl = normalizedInputs[0].normalizedUrl;
  const settings = mergeResolverOptions(inputUrl, options);
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
      operation: 'resolve-douyin-media',
      networkOptions: {
        disableExternalLookup: true,
      },
    },
  );
  if (!governance.policyDecision.allowed) {
    const blockedError = new Error(`Douyin media resolver blocked by runtime governance: ${governance.policyDecision.riskCauseCode ?? 'unknown-risk'}.`);
    blockedError.code = governance.policyDecision.riskCauseCode ?? 'DOUYIN_MEDIA_RESOLVER_BLOCKED';
    if (governance.lease) {
      await (deps.releaseSessionLease ?? releaseSessionLease)(governance.lease);
    }
    throw blockedError;
  }

  let governanceFinalized = false;
  let session = null;
  try {
    session = await (deps.openBrowserSession ?? openBrowserSession)({
      ...settings,
      userDataDir: authContext.userDataDir,
      cleanupUserDataDirOnShutdown: authContext.cleanupUserDataDirOnShutdown,
      startupUrl: resolveAuthKeepaliveUrl(inputUrl, authProfile, authContext.authConfig) ?? 'https://www.douyin.com/',
    });

    const authResult = await (deps.ensureAuthenticatedSession ?? ensureAuthenticatedSession)(session, inputUrl, settings, {
      authContext,
    });
    const authenticated = ['already-authenticated', 'authenticated'].includes(String(authResult?.status ?? ''))
      && (authResult?.loginState?.identityConfirmed === true || authResult?.loginState?.loginStateDetected === true || authResult?.loginState?.loggedIn === true);

    if (!authenticated) {
      const governanceSummary = await (deps.finalizeSiteSessionGovernance ?? finalizeSiteSessionGovernance)(governance, {
        antiCrawlSignals: [],
        authRequired: true,
        authAvailable: false,
        persistedHealthySession: false,
      });
      governanceFinalized = true;
      return {
        site: {
          url: inputUrl,
          host: authProfile?.profile?.host ?? null,
        },
        auth: {
          status: authResult?.status ?? 'unauthenticated',
          verificationUrl: resolveAuthKeepaliveUrl(inputUrl, authProfile, authContext.authConfig) ?? null,
          userDataDir: authContext.userDataDir ?? null,
        },
        runtimeGovernance: governanceSummary,
        results: normalizedInputs.map((item) => ({
          requestedUrl: item.normalizedUrl,
          videoId: item.videoId,
          resolved: false,
          error: 'unauthenticated',
          bestUrl: null,
          bestFormat: null,
          formats: [],
          headers: {},
        })),
        summary: {
          total: normalizedInputs.length,
          resolved: 0,
          failed: normalizedInputs.length,
        },
      };
    }

    await navigateDouyinPage(
      session,
      resolveAuthKeepaliveUrl(inputUrl, authProfile, authContext.authConfig) ?? 'https://www.douyin.com/',
      settings.timeoutMs,
    );

    const results = [];
    for (const item of normalizedInputs) {
      let resolved = null;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          resolved = await resolveSingleVideoMetadataStable(session, item, settings);
          break;
        } catch (error) {
          if (!isTransientResolverError(error) || attempt >= 1) {
            throw error;
          }
          await navigateDouyinPage(
            session,
            resolveAuthKeepaliveUrl(inputUrl, authProfile, authContext.authConfig) ?? 'https://www.douyin.com/',
            settings.timeoutMs,
          );
        }
      }
      results.push(resolved);
    }

    const governanceSummary = await (deps.finalizeSiteSessionGovernance ?? finalizeSiteSessionGovernance)(governance, {
      antiCrawlSignals: [],
      authRequired: true,
      authAvailable: true,
      identityConfirmed: true,
      loginStateDetected: true,
      persistedHealthySession: true,
    });
    governanceFinalized = true;

    return {
      site: {
        url: inputUrl,
        host: authProfile?.profile?.host ?? null,
      },
      auth: {
        status: authResult?.status ?? 'authenticated',
        verificationUrl: resolveAuthKeepaliveUrl(inputUrl, authProfile, authContext.authConfig) ?? null,
        userDataDir: authContext.userDataDir ?? null,
      },
      runtimeGovernance: governanceSummary,
      results,
      summary: {
        total: results.length,
        resolved: results.filter((item) => item.resolved === true && item.bestUrl).length,
        failed: results.filter((item) => item.resolved !== true || !item.bestUrl).length,
      },
    };
  } finally {
    await session?.close?.();
    if (!governanceFinalized && governance?.lease) {
      await (deps.releaseSessionLease ?? releaseSessionLease)(governance.lease);
    }
  }
}

export function parseDouyinMediaResolverArgs(argv) {
  const args = [...argv];
  const positionals = [];
  const flags = {};
  const appendFlag = (key, value) => {
    if (!(key in flags)) {
      flags[key] = value;
      return;
    }
    if (Array.isArray(flags[key])) {
      flags[key].push(value);
      return;
    }
    flags[key] = [flags[key], value];
  };
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }
    const [key, inlineValue] = token.split('=', 2);
    const normalizedKey = key.replace(/^--/, '');
    if (inlineValue !== undefined) {
      appendFlag(normalizedKey, inlineValue);
      continue;
    }
    const next = args[index + 1];
    if (next && !next.startsWith('--')) {
      appendFlag(normalizedKey, next);
      index += 1;
    } else {
      appendFlag(normalizedKey, true);
    }
  }
  return {
    items: positionals,
    options: {
      inputFile: flags['input-file'] ? String(flags['input-file']) : null,
      profilePath: flags['profile-path'] ? String(flags['profile-path']) : null,
      browserPath: flags['browser-path'] ? String(flags['browser-path']) : undefined,
      browserProfileRoot: flags['browser-profile-root'] ? String(flags['browser-profile-root']) : undefined,
      userDataDir: flags['user-data-dir'] ? String(flags['user-data-dir']) : undefined,
      timeoutMs: flags.timeout ? Number(flags.timeout) : DEFAULT_TIMEOUT_MS,
      headless: flags.headless === true ? true : flags['no-headless'] === true ? false : undefined,
      reuseLoginState: flags['no-reuse-login-state'] === true ? false : true,
      autoLogin: flags['no-auto-login'] === true ? false : true,
    },
  };
}

export async function runDouyinMediaResolverCli(argv = process.argv.slice(2)) {
  initializeCliUtf8();
  const parsed = parseDouyinMediaResolverArgs(argv);
  let items = parsed.items;
  if (parsed.options.inputFile) {
    const { readFile } = await import('node:fs/promises');
    const raw = await readFile(parsed.options.inputFile, 'utf8');
    items = raw
      .split(/\r?\n/gu)
      .map((value) => normalizeText(value))
      .filter(Boolean);
  }
  const report = await resolveDouyinMediaBatch(items, parsed.options);
  writeJsonStdout(report);
  if (report?.summary?.failed > 0) {
    process.exitCode = 1;
  }
}
