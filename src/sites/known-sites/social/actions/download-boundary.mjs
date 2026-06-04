// @ts-check

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.m4v', '.webm']);
const MEDIA_EXTENSIONS = new Set([...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS]);
const DEFAULT_MEDIA_FETCH_TIMEOUT_MS = 10_000;
const DEFAULT_CURL_MEDIA_FETCH_TIMEOUT_MS = 30_000;
const DEFAULT_MEDIA_DOWNLOAD_CONCURRENCY = 4;

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeText(value) {
  return String(value ?? '').trim();
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function slugPart(value, fallback = 'media') {
  return normalizeText(value)
    .replace(/^https?:\/\//iu, '')
    .replace(/[^A-Za-z0-9._-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 80)
    || fallback;
}

function mediaContainerPaths(item) {
  return [
    item?.media,
    item?.extended_entities?.media,
    item?.entities?.media,
    item?.attachments?.media,
    item?.legacy?.extended_entities?.media,
    item?.legacy?.entities?.media,
    item?.tweet?.extended_entities?.media,
    item?.tweet?.entities?.media,
    item?.raw?.extended_entities?.media,
    item?.raw?.entities?.media,
  ];
}

function mediaEntriesForItem(item) {
  const entries = [];
  for (const value of mediaContainerPaths(item)) {
    entries.push(...toArray(value));
  }
  return entries;
}

function extensionFromMedia(url, contentType = '', type = '') {
  const normalizedType = normalizeText(type).toLowerCase();
  const normalizedContentType = normalizeText(contentType).toLowerCase();
  if (normalizedContentType.includes('jpeg') || normalizedContentType.includes('jpg')) return '.jpg';
  if (normalizedContentType.includes('png')) return '.png';
  if (normalizedContentType.includes('gif')) return '.gif';
  if (normalizedContentType.includes('webp')) return '.webp';
  if (normalizedContentType.includes('mp4')) return '.mp4';
  if (normalizedType === 'video') return '.mp4';
  try {
    const parsed = new URL(url);
    const ext = path.extname(parsed.pathname).toLowerCase();
    if (MEDIA_EXTENSIONS.has(ext)) return ext;
    const format = parsed.searchParams.get('format');
    if (format && IMAGE_EXTENSIONS.has(`.${format.toLowerCase()}`)) {
      return `.${format.toLowerCase() === 'jpeg' ? 'jpg' : format.toLowerCase()}`;
    }
  } catch {
    // Data URLs and malformed media URLs fall back to a stable binary extension.
  }
  if (normalizedType === 'image' || normalizedType === 'photo') return '.jpg';
  return '.bin';
}

function normalizeMediaType(entry = {}, candidate = {}) {
  const text = normalizeText(candidate.type || entry.type || entry.mediaType || entry.content_type || entry.contentType).toLowerCase();
  const url = normalizeText(candidate.url || entry.url || entry.media_url_https || entry.media_url);
  if (text.includes('video') || /(?:^|\.)video\.twimg\.com\//iu.test(url) || /\/(?:ext_tw_video|amplify_video|tweet_video)\//iu.test(url)) {
    return 'video';
  }
  return 'image';
}

function normalizeXImageUrl(url) {
  try {
    const parsed = new URL(url);
    if (!/(^|\.)twimg\.com$/iu.test(parsed.hostname) || !/\/media\//iu.test(parsed.pathname)) {
      return url;
    }
    if (!parsed.searchParams.has('format')) {
      const ext = path.extname(parsed.pathname).replace(/^\./u, '');
      if (ext) parsed.searchParams.set('format', ext === 'jpeg' ? 'jpg' : ext);
    }
    parsed.searchParams.set('name', 'orig');
    return parsed.toString();
  } catch {
    return url;
  }
}

function isLikelyMediaUrl(url) {
  const text = normalizeText(url);
  if (/^data:/iu.test(text)) return true;
  try {
    const parsed = new URL(text);
    if (!/^https?:$/iu.test(parsed.protocol)) return false;
    if (/(^|\.)twimg\.com$/iu.test(parsed.hostname)) return true;
    const ext = path.extname(parsed.pathname).toLowerCase();
    return MEDIA_EXTENSIONS.has(ext);
  } catch {
    return false;
  }
}

function finiteNumber(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function videoVariantScore(variant = {}) {
  return (finiteNumber(variant.bitrate, 0) || 0)
    + ((finiteNumber(variant.width, 0) || 0) * (finiteNumber(variant.height, 0) || 0));
}

function selectBestVideoVariant(variants) {
  return toArray(variants)
    .filter((variant) => variant?.url && /video\/mp4|\.mp4(?:[?#]|$)|video\.twimg\.com/iu.test(`${variant.content_type || ''} ${variant.url || ''}`))
    .sort((left, right) => videoVariantScore(right) - videoVariantScore(left))[0] || null;
}

export function mediaCandidateRecordsForEntry(entry = {}) {
  const candidates = [];
  const variants = toArray(entry.video_info?.variants || entry.variants);
  const bestVideo = selectBestVideoVariant(variants);
  if (bestVideo?.url) {
    candidates.push({
      url: bestVideo.url,
      type: 'video',
      contentType: bestVideo.content_type || bestVideo.contentType || 'video/mp4',
      width: finiteNumber(bestVideo.width, null),
      height: finiteNumber(bestVideo.height, null),
      bitrate: finiteNumber(bestVideo.bitrate, null),
      durationMillis: finiteNumber(entry.video_info?.duration_millis ?? entry.durationMillis, null),
      variantCount: variants.length,
      source: 'video-variant',
    });
    return candidates;
  }

  for (const key of ['url', 'mediaUrl', 'media_url', 'media_url_https', 'preview_image_url']) {
    const url = entry[key];
    if (!url || !isLikelyMediaUrl(url)) continue;
    const type = normalizeMediaType(entry, { url });
    candidates.push({
      url: type === 'image' ? normalizeXImageUrl(String(url)) : String(url),
      type,
      contentType: entry.content_type || entry.contentType || null,
      width: finiteNumber(entry.width, null),
      height: finiteNumber(entry.height, null),
      bitrate: finiteNumber(entry.bitrate, null),
      durationMillis: finiteNumber(entry.durationMillis, null),
      variantCount: variants.length,
      source: key,
      fallbackFrom: entry.type === 'video' && type === 'image' ? 'poster-only-video-fallback' : null,
    });
  }
  return candidates;
}

export function mediaUrlCandidates(entry) {
  return mediaCandidateRecordsForEntry(entry).map((candidate) => candidate.url);
}

export function mediaAssetRecordsFromItems(items, { mediaDir }) {
  const records = [];
  const seen = new Set();
  for (const item of toArray(items)) {
    const itemId = item.id || item.itemId || item.restId || null;
    const itemUrl = item.url || item.link || item.permalink || null;
    const sourceBucketId = item._bucketId || null;
    const entries = mediaEntriesForItem(item);
    entries.forEach((mediaEntry, mediaIndex) => {
      for (const candidate of mediaCandidateRecordsForEntry(mediaEntry)) {
        const key = sha256(`${candidate.type}:${candidate.url}`);
        if (seen.has(key)) continue;
        seen.add(key);
        const ext = extensionFromMedia(candidate.url, candidate.contentType || '', candidate.type);
        const directory = candidate.type === 'video' ? 'videos' : 'images';
        const sourcePart = slugPart(itemId || itemUrl || sourceBucketId || key.slice(0, 12));
        const localPath = path.join(mediaDir, directory, `${sourcePart}-${mediaIndex + 1}-${key.slice(0, 12)}${ext}`);
        records.push({
          id: key,
          url: candidate.url,
          type: candidate.type,
          expectedType: candidate.type,
          contentType: null,
          sourceContentType: candidate.contentType || null,
          sourceItemId: itemId,
          sourceItemUrl: itemUrl,
          sourceBucketId,
          pageUrl: itemUrl,
          mediaIndex,
          localPath,
          status: 'planned',
          ok: false,
          bytes: 0,
          error: null,
          width: candidate.width,
          height: candidate.height,
          bitrate: candidate.bitrate,
          durationMillis: candidate.durationMillis,
          variantCount: candidate.variantCount,
          source: candidate.source,
          fallbackFrom: /** @type {any} */ (candidate).fallbackFrom || null,
        });
      }
    });
  }
  return records;
}

async function existingDownloadedRecord(record) {
  try {
    const stat = await fs.stat(record.localPath);
    if (stat.size <= 0) return null;
    const buffer = await fs.readFile(record.localPath);
    const currentSha256 = sha256(buffer);
    const expected = await previousChecksumForPath(record.localPath);
    if (expected?.sha256 && expected.sha256 !== currentSha256) {
      return null;
    }
    return {
      ...record,
      ok: true,
      skipped: true,
      status: 'downloaded',
      bytes: stat.size,
      sha256: currentSha256,
      downloadedAt: record.downloadedAt || new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

async function previousChecksumForPath(localPath) {
  const resolved = path.resolve(localPath);
  let dir = path.dirname(resolved);
  for (let depth = 0; depth < 6; depth += 1) {
    const manifestPath = path.join(dir, 'checksum_manifest.json');
    try {
      const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
      const records = Array.isArray(manifest.files) ? manifest.files : [];
      const match = records.find((record) => {
        const candidates = [
          record.filePath ? path.resolve(record.filePath) : null,
          record.absolutePath ? path.resolve(record.absolutePath) : null,
          record.relativePath ? path.resolve(path.dirname(manifestPath), record.relativePath) : null,
          record.path ? path.resolve(path.dirname(manifestPath), record.path) : null,
        ].filter(Boolean);
        return candidates.includes(resolved);
      });
      if (match) return match;
    } catch {
      // Missing or stale checksum manifests should not block normal reuse.
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function contentTypeMatchesExpected(contentType, expectedType, url) {
  const type = normalizeText(contentType).toLowerCase();
  if (!type) return null;
  if (expectedType === 'video') {
    return type.startsWith('video/') || /\.mp4(?:[?#]|$)/iu.test(url);
  }
  return type.startsWith('image/') || /^data:image\//iu.test(url);
}

function runCurlDownload(url, localPath, timeoutMs) {
  return new Promise((resolve) => {
    const command = process.platform === 'win32' ? 'curl.exe' : 'curl';
    const seconds = Math.max(1, Math.ceil(Number(timeoutMs || DEFAULT_CURL_MEDIA_FETCH_TIMEOUT_MS) / 1000));
    const child = spawn(command, [
      '--silent',
      '--show-error',
      '--location',
      '--fail',
      '--max-time',
      String(seconds),
      '--output',
      localPath,
      url,
    ], {
      shell: false,
      windowsHide: true,
    });
    let stderr = '';
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      resolve({
        ok: false,
        error: error?.message || String(error),
      });
    });
    child.on('close', (code) => {
      resolve({
        ok: code === 0,
        exitCode: code,
        error: code === 0 ? null : stderr.trim() || `curl-exit-${code}`,
      });
    });
  });
}

async function downloadMediaAssetWithCurl(record, fetchError) {
  if (!/^https?:\/\//iu.test(String(record.url || ''))) return null;
  const ext = extensionFromMedia(record.url, record.sourceContentType || '', record.expectedType || record.type);
  const localPath = record.localPath.replace(/\.[^.\\/:*?"<>|\r\n]+$/u, ext);
  await fs.mkdir(path.dirname(localPath), { recursive: true });
  const curl = await runCurlDownload(record.url, localPath, record.curlTimeoutMs || DEFAULT_CURL_MEDIA_FETCH_TIMEOUT_MS);
  if (!curl.ok) {
    try {
      await fs.rm(localPath, { force: true });
    } catch {
      // Ignore cleanup errors; the validation layer will report any unusable file.
    }
    return {
      ...record,
      localPath,
      ok: false,
      status: 'failed',
      error: `curl-fallback-failed: ${curl.error || 'unknown'}; fetch=${fetchError}`,
    };
  }
  const stat = await fs.stat(localPath);
  if (stat.size <= 0) {
    return {
      ...record,
      localPath,
      ok: false,
      status: 'failed',
      error: `curl-fallback-empty; fetch=${fetchError}`,
    };
  }
  const buffer = await fs.readFile(localPath);
  return {
    ...record,
    localPath,
    ok: true,
    status: 'downloaded',
    bytes: stat.size,
    contentType: record.sourceContentType || null,
    contentTypeMatchesExpected: null,
    sha256: sha256(buffer),
    downloadedAt: new Date().toISOString(),
    downloader: 'curl-fallback',
    fetchError,
  };
}

export async function downloadMediaAsset(record) {
  const existing = await existingDownloadedRecord(record);
  if (existing) return existing;
  const timeoutMs = Number(record.timeoutMs || DEFAULT_MEDIA_FETCH_TIMEOUT_MS);
  const controller = new AbortController();
  const timeout = Number.isFinite(timeoutMs) && timeoutMs > 0
    ? setTimeout(() => controller.abort(), timeoutMs)
    : null;
  try {
    const response = await fetch(record.url, { signal: controller.signal });
    if (!response.ok) {
      return {
        ...record,
        ok: false,
        status: 'failed',
        error: `http-${response.status}`,
      };
    }
    const contentType = response.headers.get('content-type') || record.sourceContentType || '';
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length <= 0) {
      return {
        ...record,
        ok: false,
        status: 'failed',
        contentType,
        error: 'empty-media-response',
      };
    }
    const ext = extensionFromMedia(record.url, contentType, record.expectedType || record.type);
    const localPath = record.localPath.replace(/\.[^.\\/:*?"<>|\r\n]+$/u, ext);
    await fs.mkdir(path.dirname(localPath), { recursive: true });
    await fs.writeFile(localPath, buffer);
    const matches = contentTypeMatchesExpected(contentType, record.expectedType || record.type, record.url);
    return {
      ...record,
      localPath,
      ok: true,
      status: 'downloaded',
      bytes: buffer.length,
      contentType,
      contentTypeMatchesExpected: matches,
      sha256: sha256(buffer),
      downloadedAt: new Date().toISOString(),
    };
  } catch (error) {
    const fetchError = error?.name === 'AbortError' ? 'media-download-timeout' : error?.message || String(error);
    const curlFallback = await downloadMediaAssetWithCurl(record, fetchError);
    if (curlFallback) return curlFallback;
    return {
      ...record,
      ok: false,
      status: 'failed',
      error: fetchError,
    };
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function mapWithConcurrency(items, concurrency, worker) {
  const output = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(Number(concurrency) || 1, items.length || 1));
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      output[index] = await worker(items[index], index);
    }
  }));
  return output;
}

export async function buildSocialMediaDownloadReport({ items = [], mediaDir, limit = 50, concurrency = DEFAULT_MEDIA_DOWNLOAD_CONCURRENCY }) {
  const records = mediaAssetRecordsFromItems(items, { mediaDir });
  const normalizedLimit = Number(limit);
  const unlimited = normalizedLimit === 0;
  const queue = [];
  const maxDownloads = Number.isFinite(normalizedLimit) && normalizedLimit >= 0 ? normalizedLimit : 50;
  const attemptRecords = [];
  for (const record of records) {
    if (unlimited || attemptRecords.length < maxDownloads) {
      attemptRecords.push(record);
    } else {
      queue.push({ ...record, status: 'pending', reason: 'media-download-limit' });
    }
  }
  const downloads = await mapWithConcurrency(attemptRecords, concurrency, downloadMediaAsset);
  for (const download of downloads) {
    queue.push({
      ...download,
      status: download.status === 'downloaded' ? 'done' : 'failed',
    });
  }
  const downloaded = downloads.filter((record) => record.status === 'downloaded');
  const failed = downloads.filter((record) => record.status === 'failed');
  const pending = queue.filter((record) => record.status === 'pending');
  return {
    downloads,
    queue,
    candidates: records,
    expectedMedia: records,
    skippedMedia: pending.length,
    skippedCandidates: pending.length,
    status: failed.length ? 'partial' : pending.length ? 'bounded' : 'complete',
    supported: true,
    blocked: false,
    reason: failed.length ? 'media-download-incomplete' : pending.length ? 'media-download-limit' : null,
    counts: {
      total: records.length,
      attempted: downloads.length,
      downloaded: downloaded.length,
      failed: failed.length,
      pending: pending.length,
    },
  };
}

function payloadItemsForDownload(payload = {}) {
  const items = [...toArray(payload.items)];
  if (toArray(payload.media).length) {
    items.push({
      id: 'payload-media',
      url: payload.finalUrl || null,
      media: payload.media,
    });
  }
  return items;
}

export async function createSocialMediaDownloadReport(options = {}) {
  return buildSocialMediaDownloadReport({
    items: options.items || payloadItemsForDownload(options.payload || {}),
    mediaDir: options.mediaDir || options.outDir || 'media',
    limit: options.limit ?? options.mediaDownloadLimit ?? 50,
  });
}

export const createBlockedMediaDownloadReport = createSocialMediaDownloadReport;
