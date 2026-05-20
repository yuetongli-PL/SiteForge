// @ts-check

import { normalizeUrlNoFragment, normalizeWhitespace } from '../../../../shared/normalize.mjs';

const DEFAULT_BASE_URL = 'https://moodyz.com';
const DATE_LIST_PATH_RE = /\/works\/list\/date\/(?<date>\d{4}-\d{2}-\d{2})(?:\/)?$/u;
const DETAIL_HREF_RE = /href="(?<url>https:\/\/moodyz\.com\/works\/detail\/[^"]+)".*?<p class="text">(?<title>.*?)<\/p>/gsu;
const TAG_RE = /<[^>]+>/gu;

function pad2(value) {
  return String(value).padStart(2, '0');
}

function assertValidMonth(year, month) {
  if (!Number.isInteger(year) || year < 1970 || year > 9999) {
    throw new Error(`Invalid Moodyz catalog year: ${year}`);
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error(`Invalid Moodyz catalog month: ${month}`);
  }
}

function decodeHtmlEntities(value) {
  return String(value ?? '')
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&amp;/gu, '&')
    .replace(/&quot;/gu, '"')
    .replace(/&#39;/gu, "'")
    .replace(/&#x([0-9a-f]+);/giu, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/gu, (_, code) => String.fromCodePoint(Number.parseInt(code, 10)));
}

function extractDateFromDateListUrl(sourceUrl) {
  try {
    const parsed = new URL(sourceUrl);
    const match = parsed.pathname.match(DATE_LIST_PATH_RE);
    return match?.groups?.date ?? null;
  } catch {
    return null;
  }
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

  const workerCount = Math.min(Math.max(Number(concurrency) || 1, 1), values.length || 1);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

export function buildMoodyzDateListUrl({ year, month, day, baseUrl = DEFAULT_BASE_URL } = {}) {
  assertValidMonth(year, month);
  if (!Number.isInteger(day) || day < 1 || day > 31) {
    throw new Error(`Invalid Moodyz catalog day: ${day}`);
  }
  const parsed = new URL(baseUrl);
  parsed.pathname = `/works/list/date/${year}-${pad2(month)}-${pad2(day)}`;
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString();
}

export function buildMoodyzMonthDateListUrls({ year, month, baseUrl = DEFAULT_BASE_URL } = {}) {
  assertValidMonth(year, month);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Array.from({ length: daysInMonth }, (_, index) => buildMoodyzDateListUrl({
    year,
    month,
    day: index + 1,
    baseUrl,
  }));
}

export function parseMoodyzDateListHtml(html, { sourceUrl } = {}) {
  const date = extractDateFromDateListUrl(sourceUrl);
  const works = [];
  for (const match of String(html ?? '').matchAll(DETAIL_HREF_RE)) {
    const url = normalizeUrlNoFragment(match.groups?.url);
    const title = normalizeWhitespace(decodeHtmlEntities(
      String(match.groups?.title ?? '').replace(TAG_RE, ''),
    ));
    if (!url || !title) {
      continue;
    }
    works.push({
      date,
      title,
      url,
      sourceUrl: sourceUrl ? normalizeUrlNoFragment(sourceUrl) : null,
    });
  }
  return works;
}

export async function collectMoodyzMonthCatalog({
  year,
  month,
  baseUrl = DEFAULT_BASE_URL,
  fetchHtml,
  concurrency = 6,
  allowPartial = false,
} = {}) {
  assertValidMonth(year, month);
  if (typeof fetchHtml !== 'function') {
    throw new Error('collectMoodyzMonthCatalog requires fetchHtml(url).');
  }

  const urls = buildMoodyzMonthDateListUrls({ year, month, baseUrl });

  const probeResults = await mapLimit(urls, concurrency, async (url) => {
    let html = '';
    let error = null;
    try {
      html = await fetchHtml(url);
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    }
    const works = error ? [] : parseMoodyzDateListHtml(html, { sourceUrl: url });
    return {
      url,
      date: extractDateFromDateListUrl(url),
      ok: !error,
      workCount: works.length,
      works,
      ...(error ? { error } : {}),
    };
  });

  const failedProbes = probeResults.filter((probe) => !probe.ok);
  if (failedProbes.length && !allowPartial) {
    throw new Error(`Moodyz month catalog incomplete: ${failedProbes.length} daily probes failed.`);
  }

  const worksByUrl = new Map();
  for (const probe of probeResults) {
    for (const work of probe.works) {
      if (!worksByUrl.has(work.url)) {
        worksByUrl.set(work.url, work);
      }
    }
  }

  const works = [...worksByUrl.values()].sort((left, right) => (
    String(left.date ?? '').localeCompare(String(right.date ?? ''), 'en')
    || String(left.url).localeCompare(String(right.url), 'en')
  ));
  const byDate = {};
  for (const work of works) {
    const date = work.date ?? 'unknown';
    byDate[date] ??= [];
    byDate[date].push(work);
  }

  return {
    year,
    month,
    monthKey: `${year}-${pad2(month)}`,
    strategy: 'daily-date-list-probe',
    total: works.length,
    dates: Object.fromEntries(Object.entries(byDate).map(([date, items]) => [date, items.length])),
    works,
    probes: probeResults.map(({ works: _works, ...probe }) => probe),
  };
}
