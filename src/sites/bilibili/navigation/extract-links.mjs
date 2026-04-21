// @ts-check

import { openBrowserSession } from '../../../infra/browser/session.mjs';
import { resolvePersistentUserDataDir } from '../../../infra/browser/profile-store.mjs';

export const BILIBILI_EXTRACT_WAIT_POLICY = {
  useLoadEvent: false,
  useNetworkIdle: false,
  documentReadyTimeoutMs: 12_000,
  domQuietTimeoutMs: 12_000,
  domQuietMs: 600,
  idleMs: 400,
};

export function extractVideoLinks(maxItems) {
  const selectors = [
    'a[href*="/video/"]',
    'a[href*="/bangumi/play/"]',
  ];
  const seen = new Set();
  const entries = [];
  const absolutize = (href) => {
    try {
      return new URL(href, location.href).toString();
    } catch {
      return null;
    }
  };
  for (const selector of selectors) {
    for (const anchor of document.querySelectorAll(selector)) {
      const href = absolutize(anchor.getAttribute('href'));
      if (!href || seen.has(href)) {
        continue;
      }
      seen.add(href);
      const text = String(anchor.textContent || '').trim().replace(/\s+/g, ' ');
      entries.push({
        webpage_url: href,
        title: text || null,
      });
      if (entries.length >= maxItems) {
        return entries;
      }
    }
  }
  return entries;
}

export async function extractBilibiliLinks(url, options = {}) {
  const userDataDir = options.reuseLoginState
    ? resolvePersistentUserDataDir('https://www.bilibili.com/', { rootDir: options.profileRoot ?? undefined })
    : null;

  const session = await openBrowserSession({
    browserPath: options.browserPath ?? null,
    userDataDir,
    cleanupUserDataDirOnShutdown: false,
    headless: options.headless !== false,
    timeoutMs: options.timeoutMs ?? 20_000,
    startupUrl: url,
    viewport: {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
    },
    fullPage: false,
  });

  try {
    await session.waitForSettled(BILIBILI_EXTRACT_WAIT_POLICY);
    const metadata = await session.getPageMetadata(url);
    const entries = await session.callPageFunction(extractVideoLinks, options.maxItems ?? 20);
    return {
      url,
      finalUrl: metadata.url,
      title: metadata.title,
      entries,
    };
  } finally {
    await session.close();
  }
}
