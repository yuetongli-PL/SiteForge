#!/usr/bin/env node
import path from 'node:path';
import process from 'node:process';

import { openBrowserSession } from '../lib/browser-runtime/session.mjs';
import { resolvePersistentUserDataDir } from '../lib/browser-runtime/profile-store.mjs';

const WAIT_POLICY = {
  useLoadEvent: false,
  useNetworkIdle: false,
  documentReadyTimeoutMs: 12_000,
  domQuietTimeoutMs: 12_000,
  domQuietMs: 600,
  idleMs: 400,
};

function parseArgs(argv) {
  if (!argv.length || argv.includes('--help') || argv.includes('-h')) {
    return { help: true };
  }
  const [url, ...rest] = argv;
  const options = {
    url,
    maxItems: 20,
    reuseLoginState: true,
    profileRoot: null,
    browserPath: null,
    nodePath: null,
    headless: true,
    timeoutMs: 20_000,
  };

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    const next = () => {
      index += 1;
      return rest[index];
    };
    switch (token) {
      case '--max-items':
        options.maxItems = Math.max(1, Number.parseInt(next() ?? '20', 10) || 20);
        break;
      case '--profile-root':
        options.profileRoot = next();
        break;
      case '--browser-path':
        options.browserPath = next();
        break;
      case '--timeout':
        options.timeoutMs = Math.max(5_000, Number.parseInt(next() ?? '20000', 10) || 20_000);
        break;
      case '--reuse-login-state':
        options.reuseLoginState = true;
        break;
      case '--no-reuse-login-state':
        options.reuseLoginState = false;
        break;
      case '--headless':
        options.headless = true;
        break;
      case '--no-headless':
        options.headless = false;
        break;
      default:
        throw new Error(`Unknown argument: ${token}`);
    }
  }
  return options;
}

function extractVideoLinks(maxItems) {
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

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write('Usage: node scripts/extract-bilibili-links.mjs <url> [--max-items <n>] [--profile-root <dir>] [--browser-path <path>] [--timeout <ms>] [--reuse-login-state|--no-reuse-login-state] [--headless|--no-headless]\n');
    process.exit(0);
  }
  if (!options.url) {
    throw new Error('A bilibili URL is required.');
  }

  const userDataDir = options.reuseLoginState
    ? resolvePersistentUserDataDir('https://www.bilibili.com/', { rootDir: options.profileRoot ?? undefined })
    : null;

  const session = await openBrowserSession({
    browserPath: options.browserPath,
    userDataDir,
    cleanupUserDataDirOnShutdown: false,
    headless: options.headless,
    timeoutMs: options.timeoutMs,
    startupUrl: options.url,
    viewport: {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
    },
    fullPage: false,
  });

  try {
    await session.waitForSettled(WAIT_POLICY);
    const metadata = await session.getPageMetadata(options.url);
    const entries = await session.callPageFunction(extractVideoLinks, options.maxItems);
    process.stdout.write(`${JSON.stringify({
      url: options.url,
      finalUrl: metadata.url,
      title: metadata.title,
      entries,
    }, null, 2)}\n`);
  } finally {
    await session.close();
  }
}

main().catch((error) => {
  process.stderr.write(`${error?.message ?? String(error)}\n`);
  process.exit(1);
});
