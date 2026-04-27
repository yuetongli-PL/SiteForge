// @ts-check

import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdir, stat, writeFile } from 'node:fs/promises';

import { ensureDir, writeJsonFile } from '../../infra/io.mjs';
import { compactSlug } from '../../shared/normalize.mjs';

const DEFAULT_MEDIA_DOWNLOAD_CONCURRENCY = 6;
const DEFAULT_MEDIA_DOWNLOAD_RETRIES = 2;
const DEFAULT_MEDIA_DOWNLOAD_BACKOFF_MS = 2_000;
const ARTIFACT_SCHEMA_VERSION = 1;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extensionFromUrlOrContentType(url, contentType, fallback = 'bin') {
  const normalizedType = String(contentType ?? '').split(';')[0].trim().toLowerCase();
  if (normalizedType.includes('jpeg')) {
    return 'jpg';
  }
  if (normalizedType.includes('png')) {
    return 'png';
  }
  if (normalizedType.includes('webp')) {
    return 'webp';
  }
  if (normalizedType.includes('gif')) {
    return 'gif';
  }
  if (normalizedType.includes('mp4')) {
    return 'mp4';
  }
  try {
    const parsed = new URL(url);
    const ext = path.extname(parsed.pathname).replace(/^\./u, '').toLowerCase();
    return ext || fallback;
  } catch {
    return fallback;
  }
}

function isLikelyDecorativeMedia(entry = {}) {
  const url = String(entry.url ?? '').toLowerCase();
  const alt = String(entry.alt ?? '').toLowerCase();
  return /(?:\/profile_images\/|\/profile_banners\/|\/emoji\/)/iu.test(url)
    || /(?:profile picture|square profile picture|avatar|highlight cover|story highlight)/iu.test(alt);
}

function isDownloadableMediaUrl(url) {
  const value = String(url ?? '').trim();
  return /^https?:\/\//iu.test(value) && !/^blob:/iu.test(value) && !/^data:/iu.test(value);
}

function isLikelyXVideoPosterUrl(url) {
  const value = String(url ?? '').toLowerCase();
  return /\/(?:ext_tw_video|amplify_video|tweet_video)_thumb\//u.test(value)
    || /[?&]format=(?:jpg|jpeg|png|webp)\b/u.test(value) && /(?:ext_tw_video|amplify_video|tweet_video)/u.test(value);
}

function shortHash(value) {
  return createHash('sha1').update(String(value ?? '')).digest('hex').slice(0, 10);
}

function mediaReference(entry = {}, index = 0) {
  return {
    itemId: entry.itemId ?? entry.id ?? null,
    pageUrl: entry.pageUrl ?? null,
    mediaIndex: entry.mediaIndex ?? index,
    url: entry.url ?? null,
    type: entry.type ?? null,
  };
}

function normalizeDownloadableMediaEntry(entry, index = 0) {
  if (!entry || typeof entry !== 'object') {
    return null;
  }
  if (isDownloadableMediaUrl(entry.url)) {
    if (isLikelyXVideoPosterUrl(entry.url)) {
      return {
        ...entry,
        type: 'image',
        mediaIndex: entry.mediaIndex ?? index,
        fallbackFrom: entry.fallbackFrom ?? 'poster-only-video-fallback',
        expectedType: entry.expectedType ?? 'video',
        alt: entry.alt || 'video poster',
      };
    }
    return {
      ...entry,
      mediaIndex: entry.mediaIndex ?? index,
      fallbackFrom: entry.fallbackFrom,
      expectedType: entry.expectedType,
    };
  }
  if (isDownloadableMediaUrl(entry.posterUrl)) {
    return {
      ...entry,
      type: 'image',
      url: entry.posterUrl,
      mediaIndex: entry.mediaIndex ?? index,
      alt: entry.alt || 'video poster',
      fallbackFrom: isLikelyXVideoPosterUrl(entry.posterUrl) ? 'poster-only-video-fallback' : 'posterUrl',
      expectedType: entry.type === 'video' || isLikelyXVideoPosterUrl(entry.posterUrl) ? 'video' : entry.expectedType,
    };
  }
  return null;
}

export function buildDownloadableMediaPlan(media, maxItems = Infinity) {
  const expectedMedia = [];
  const byDownloadKey = new Map();
  for (const [index, originalEntry] of (Array.isArray(media) ? media : []).entries()) {
    const entry = normalizeDownloadableMediaEntry(originalEntry, index);
    if (!entry || isLikelyDecorativeMedia(entry)) {
      continue;
    }
    const reference = mediaReference(entry, index);
    expectedMedia.push({
      ...reference,
      width: entry.width ?? null,
      height: entry.height ?? null,
      bitrate: entry.bitrate ?? null,
      durationMillis: entry.durationMillis ?? null,
      posterUrl: entry.posterUrl ?? null,
      variantCount: Array.isArray(entry.variants) ? entry.variants.length : 0,
      fallbackFrom: entry.fallbackFrom ?? null,
      expectedType: entry.expectedType ?? null,
    });
    const key = `${entry.type}:${entry.url}`;
    if (!byDownloadKey.has(key)) {
      byDownloadKey.set(key, {
        ...entry,
        downloadKey: key,
        urlHash: shortHash(entry.url),
        references: [],
      });
    }
    byDownloadKey.get(key).references.push(reference);
  }
  const uniqueCandidates = [...byDownloadKey.values()];
  const limitedCandidates = uniqueCandidates.slice(0, Math.max(0, Number(maxItems) || 0));
  const attemptedReferenceKeys = new Set(limitedCandidates.flatMap((entry) => entry.references || [])
    .map((entry) => `${entry.itemId ?? ''}|${entry.pageUrl ?? ''}|${entry.mediaIndex ?? ''}|${entry.url ?? ''}|${entry.type ?? ''}`));
  const skippedMedia = expectedMedia.filter((entry) => !attemptedReferenceKeys.has(`${entry.itemId ?? ''}|${entry.pageUrl ?? ''}|${entry.mediaIndex ?? ''}|${entry.url ?? ''}|${entry.type ?? ''}`)).length;
  return {
    expectedMedia,
    uniqueCandidates,
    candidates: limitedCandidates,
    skippedMedia,
    skippedCandidates: Math.max(0, uniqueCandidates.length - limitedCandidates.length),
  };
}

export function selectDownloadableMediaCandidates(media, maxItems) {
  return buildDownloadableMediaPlan(media, maxItems).candidates;
}

function downloadQueueKey(entry = {}) {
  return entry.downloadKey || `${entry.type ?? ''}:${entry.url ?? ''}`;
}

function normalizeDownloadQueueEntry(entry = {}, index = 0, previous = null) {
  const key = downloadQueueKey(entry);
  const previousStatus = previous?.status && previous.status !== 'pending' ? previous.status : null;
  return {
    key,
    index,
    status: previousStatus || 'pending',
    url: entry.url ?? previous?.url ?? null,
    type: entry.type ?? previous?.type ?? null,
    fallbackFrom: entry.fallbackFrom ?? previous?.fallbackFrom ?? null,
    expectedType: entry.expectedType ?? previous?.expectedType ?? null,
    itemId: entry.itemId ?? entry.id ?? previous?.itemId ?? null,
    pageUrl: entry.pageUrl ?? previous?.pageUrl ?? null,
    mediaIndex: entry.mediaIndex ?? previous?.mediaIndex ?? null,
    referenceCount: entry.references?.length ?? previous?.referenceCount ?? 1,
    references: entry.references ?? previous?.references ?? [mediaReference(entry, index)],
    result: previous?.result ?? null,
    updatedAt: previous?.updatedAt ?? null,
  };
}

function buildDownloadQueue(candidates = [], previousQueue = []) {
  const previousByKey = new Map((Array.isArray(previousQueue) ? previousQueue : [])
    .map((entry) => [entry?.key || downloadQueueKey(entry), entry])
    .filter(([key]) => key && key !== ':'));
  return candidates.map((entry, index) => normalizeDownloadQueueEntry(entry, index, previousByKey.get(downloadQueueKey(entry))));
}

async function writeDownloadQueue(queuePath, queue) {
  if (!queuePath) {
    return;
  }
  await writeJsonFile(queuePath, {
    schemaVersion: ARTIFACT_SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    counts: {
      total: queue.length,
      pending: queue.filter((entry) => entry.status === 'pending').length,
      done: queue.filter((entry) => entry.status === 'done').length,
      failed: queue.filter((entry) => entry.status === 'failed').length,
      skipped: queue.filter((entry) => entry.status === 'skipped').length,
    },
    queue,
  });
}

function previousQueueResults(previousQueue = []) {
  return (Array.isArray(previousQueue) ? previousQueue : [])
    .filter((entry) => ['done', 'skipped'].includes(entry?.status) && entry?.result?.ok === true)
    .map((entry) => ({
      ...entry.result,
      skipped: entry.status === 'skipped' || entry.result.skipped === true,
    }));
}

function buildMediaDownloadFileName(entry, index, { siteKey, account, contentType }) {
  const firstReference = Array.isArray(entry.references) && entry.references.length ? entry.references[0] : entry;
  const itemSlugSource = firstReference.itemId || firstReference.pageUrl || account || 'media';
  const itemSlug = compactSlug(String(itemSlugSource).replace(/^https?:\/\//iu, ''), 'item').slice(0, 48);
  const mediaIndex = firstReference.mediaIndex ?? entry.mediaIndex ?? index;
  const ext = extensionFromUrlOrContentType(entry.url, contentType, entry.type === 'video' ? 'mp4' : 'jpg');
  const stem = compactSlug([
    String(index + 1).padStart(4, '0'),
    siteKey,
    account || 'media',
    itemSlug,
    `m${mediaIndex}`,
    entry.type || 'media',
    entry.urlHash || shortHash(entry.url),
  ].filter(Boolean).join('-'), 'media');
  return `${stem}.${ext}`;
}

async function uniqueFilePath(filePath) {
  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      return filePath;
    }
  } catch {
    return filePath;
  }
  const parsed = path.parse(filePath);
  for (let counter = 2; counter < 10_000; counter += 1) {
    const candidate = path.join(parsed.dir, `${parsed.name}-${counter}${parsed.ext}`);
    try {
      await stat(candidate);
    } catch {
      return candidate;
    }
  }
  return path.join(parsed.dir, `${parsed.name}-${Date.now()}${parsed.ext}`);
}

async function findExistingMediaFile(outDir, fileName) {
  const stem = path.parse(fileName).name;
  try {
    const names = await readdir(outDir);
    const candidate = names
      .filter((name) => name === fileName || name.startsWith(`${stem}.`) || name.startsWith(`${stem}-`))
      .sort()[0];
    return candidate ? path.join(outDir, candidate) : null;
  } catch {
    return null;
  }
}

async function existingDownloadEntryForCandidate(candidate, previousDownloads = []) {
  const match = (Array.isArray(previousDownloads) ? previousDownloads : [])
    .find((entry) => entry?.ok === true && entry?.url === candidate.url && entry?.filePath);
  if (!match) {
    return null;
  }
  try {
    const fileStat = await stat(match.filePath);
    if (!fileStat.isFile() || fileStat.size <= 0) {
      return null;
    }
    return {
      ...match,
      skipped: true,
      transport: match.transport || 'existing-download-manifest',
      bytes: match.bytes ?? fileStat.size,
    };
  } catch {
    return null;
  }
}

function retryableDownloadStatus(status) {
  return status === 408 || status === 409 || status === 425 || status === 429 || (Number(status) >= 500 && Number(status) <= 599);
}

function mediaResultBase(entry, index) {
  return {
    url: entry.url,
    type: entry.type ?? null,
    fallbackFrom: entry.fallbackFrom ?? null,
    expectedType: entry.expectedType ?? null,
    itemId: entry.itemId ?? entry.id ?? null,
    pageUrl: entry.pageUrl ?? null,
    mediaIndex: entry.mediaIndex ?? null,
    referenceCount: entry.references?.length ?? 1,
    references: entry.references ?? [mediaReference(entry, index)],
    width: entry.width ?? null,
    height: entry.height ?? null,
    bitrate: entry.bitrate ?? null,
  };
}

async function downloadOneMediaCandidate({
  entry,
  index,
  headers,
  outDir,
  siteKey,
  account,
  contentHashIndex,
  previousDownloads,
  skipExisting,
  retries,
  retryBackoffMs,
  fetchImpl,
  curlDownload,
}) {
  const fallbackFileName = buildMediaDownloadFileName(entry, index, { siteKey, account, contentType: '' });
  if (skipExisting) {
    const previous = await existingDownloadEntryForCandidate(entry, previousDownloads);
    if (previous) {
      return previous;
    }
    const existingFilePath = await findExistingMediaFile(outDir, fallbackFileName);
    if (existingFilePath) {
      const fileStat = await stat(existingFilePath);
      return {
        ok: true,
        ...mediaResultBase(entry, index),
        status: null,
        contentType: '',
        contentTypeMatchesExpected: null,
        filePath: existingFilePath,
        bytes: fileStat.size,
        skipped: true,
        transport: 'existing-file',
      };
    }
  }

  let lastError = null;
  const maxAttempts = Math.max(1, Number(retries ?? 0) + 1);
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const fallbackFilePath = await uniqueFilePath(path.join(outDir, fallbackFileName));
    try {
      const response = await fetchImpl(entry.url, {
        headers,
        signal: AbortSignal.timeout(45_000),
      });
      if (!response.ok) {
        const curlResult = await curlDownload({
          url: entry.url,
          headers,
          filePath: fallbackFilePath,
        });
        if (curlResult.ok) {
          const fileStat = await stat(fallbackFilePath);
          return {
            ok: true,
            ...mediaResultBase(entry, index),
            status: response.status,
            contentType: '',
            filePath: fallbackFilePath,
            bytes: fileStat.size,
            attempts: attempt + 1,
            transport: 'curl-fallback',
          };
        }
        lastError = {
          status: response.status,
          error: curlResult.error,
        };
        if (attempt < maxAttempts - 1 && retryableDownloadStatus(response.status)) {
          await sleep(Math.min(60_000, Math.max(0, Number(retryBackoffMs) || 0) * (2 ** attempt)));
          continue;
        }
        return {
          ok: false,
          ...mediaResultBase(entry, index),
          status: response.status,
          attempts: attempt + 1,
          error: curlResult.error,
          filePath: null,
        };
      }
      const contentType = response.headers.get('content-type') || '';
      const fileName = buildMediaDownloadFileName(entry, index, { siteKey, account, contentType });
      let filePath = skipExisting ? await findExistingMediaFile(outDir, fileName) : null;
      if (filePath) {
        const fileStat = await stat(filePath);
        return {
          ok: true,
          ...mediaResultBase(entry, index),
          status: response.status,
          contentType,
          contentTypeMatchesExpected: entry.type === 'video' ? /video\//iu.test(contentType) : entry.type === 'image' ? /image\//iu.test(contentType) : null,
          filePath,
          bytes: fileStat.size,
          attempts: attempt + 1,
          skipped: true,
          transport: 'existing-file',
        };
      }
      filePath = await uniqueFilePath(path.join(outDir, fileName));
      const bytes = Buffer.from(await response.arrayBuffer());
      const contentHash = createHash('sha256').update(bytes).digest('hex');
      const duplicate = contentHashIndex.get(contentHash);
      if (duplicate) {
        filePath = duplicate.filePath;
      } else {
        await writeFile(filePath, bytes);
        contentHashIndex.set(contentHash, { filePath, url: entry.url });
      }
      return {
        ok: true,
        ...mediaResultBase(entry, index),
        status: response.status,
        contentType,
        contentTypeMatchesExpected: entry.type === 'video' ? /video\//iu.test(contentType) : entry.type === 'image' ? /image\//iu.test(contentType) : null,
        filePath,
        bytes: bytes.length,
        contentHash,
        duplicateOf: duplicate?.url ?? null,
        attempts: attempt + 1,
        transport: duplicate ? 'fetch-content-dedupe' : 'fetch',
      };
    } catch (error) {
      const curlResult = await curlDownload({
        url: entry.url,
        headers,
        filePath: fallbackFilePath,
      });
      if (curlResult.ok) {
        const fileStat = await stat(fallbackFilePath);
        return {
          ok: true,
          ...mediaResultBase(entry, index),
          status: null,
          contentType: '',
          filePath: fallbackFilePath,
          bytes: fileStat.size,
          attempts: attempt + 1,
          transport: 'curl-fallback',
        };
      }
      lastError = {
        status: null,
        error: `${error?.message ?? String(error)}; curl fallback: ${curlResult.error ?? 'failed'}`,
      };
      if (attempt < maxAttempts - 1) {
        await sleep(Math.min(60_000, Math.max(0, Number(retryBackoffMs) || 0) * (2 ** attempt)));
      }
    }
  }
  return {
    ok: false,
    ...mediaResultBase(entry, index),
    status: lastError?.status ?? null,
    attempts: maxAttempts,
    error: lastError?.error ?? 'download failed',
    filePath: null,
  };
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(items.length, Math.floor(Number(concurrency) || 1)));
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
    }
  }));
  return results;
}

export async function downloadMediaFiles({
  media,
  headers,
  outDir,
  siteKey,
  account,
  maxItems,
  concurrency = DEFAULT_MEDIA_DOWNLOAD_CONCURRENCY,
  retries = DEFAULT_MEDIA_DOWNLOAD_RETRIES,
  retryBackoffMs = DEFAULT_MEDIA_DOWNLOAD_BACKOFF_MS,
  skipExisting = true,
  previousDownloads = [],
  previousQueue = [],
  queuePath = null,
  fetchImpl = globalThis.fetch,
  curlDownload = runCurlDownload,
}) {
  const downloadPlan = buildDownloadableMediaPlan(media, maxItems);
  const candidates = downloadPlan.candidates;
  await ensureDir(outDir);
  const queue = buildDownloadQueue(candidates, previousQueue);
  let queueWrite = Promise.resolve();
  const persistQueue = async () => {
    const snapshot = queue.map((entry) => ({ ...entry }));
    queueWrite = queueWrite.then(() => writeDownloadQueue(queuePath, snapshot));
    await queueWrite;
  };
  await persistQueue();
  const contentHashIndex = new Map();
  const restorableDownloads = [
    ...previousQueueResults(previousQueue),
    ...(Array.isArray(previousDownloads) ? previousDownloads : []),
  ];
  for (const entry of restorableDownloads) {
    if (entry?.ok === true && entry?.contentHash && entry?.filePath) {
      contentHashIndex.set(entry.contentHash, { filePath: entry.filePath, url: entry.url });
    }
  }
  const downloads = await mapWithConcurrency(candidates, concurrency, async (entry, index) => {
    const result = await downloadOneMediaCandidate({
      entry,
      index,
      headers,
      outDir,
      siteKey,
      account,
      contentHashIndex,
      previousDownloads: restorableDownloads,
      skipExisting,
      retries,
      retryBackoffMs,
      fetchImpl,
      curlDownload,
    });
    queue[index] = {
      ...queue[index],
      status: result.ok ? (result.skipped ? 'skipped' : 'done') : 'failed',
      result,
      updatedAt: new Date().toISOString(),
    };
    await persistQueue();
    return result;
  });
  await queueWrite;
  await writeDownloadQueue(queuePath, queue);
  return {
    downloads,
    queue,
    candidates,
    expectedMedia: downloadPlan.expectedMedia,
    skippedMedia: downloadPlan.skippedMedia,
    skippedCandidates: downloadPlan.skippedCandidates,
    concurrency: Math.max(1, Math.min(candidates.length || 1, Math.floor(Number(concurrency) || 1))),
    retries: Math.max(0, Number(retries) || 0),
    retryBackoffMs: Math.max(0, Number(retryBackoffMs) || 0),
  };
}

export function runCurlDownload({ url, headers, filePath }) {
  return new Promise((resolve) => {
    const args = [
      '-L',
      '--fail',
      '--silent',
      '--show-error',
      '--connect-timeout',
      '20',
      '--max-time',
      '90',
      '--output',
      filePath,
    ];
    for (const [name, value] of Object.entries(headers || {})) {
      if (value === undefined || value === null || String(value).length === 0) {
        continue;
      }
      args.push('-H', `${name}: ${value}`);
    }
    args.push(url);
    const child = spawn('curl.exe', args, {
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
    });
    let stderr = '';
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-4_096);
    });
    child.once('error', (error) => {
      resolve({
        ok: false,
        error: error?.message ?? String(error),
      });
    });
    child.once('exit', (code) => {
      resolve({
        ok: code === 0,
        code,
        error: code === 0 ? null : stderr.trim() || `curl exited with code ${code}`,
      });
    });
  });
}
