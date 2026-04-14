// @ts-check
import { createHash } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { initializeCliUtf8, writeJsonStdout } from './lib/cli.mjs';
import { pathExists, readJsonFile, writeJsonFile, writeTextFile } from './lib/io.mjs';
import { normalizeText, normalizeUrlNoFragment, sanitizeHost } from './lib/normalize.mjs';
import { validateProfileFile } from './lib/profile-validation.mjs';
import { readSiteContext, resolveCapabilityFamiliesFromSiteContext, resolvePageTypesFromSiteContext, resolvePrimaryArchetypeFromSiteContext } from './lib/site-context.mjs';
import { upsertSiteRegistryRecord } from './lib/site-registry.mjs';
import { upsertSiteCapabilities } from './lib/site-capabilities.mjs';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_VERSION = 3;
const DEFAULT_OPTIONS = {
  crawlerScriptsDir: path.resolve(process.cwd(), 'crawler-scripts'),
  knowledgeBaseDir: undefined,
  profilePath: undefined,
};
const HELP = 'Usage:\n  node generate-crawler-script.mjs <url> [--crawler-scripts-dir <dir>] [--knowledge-base-dir <dir>] [--profile-path <path>]';

function sha(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function mergeOptions(inputUrl, options = {}) {
  const parsed = new URL(inputUrl);
  const merged = { ...DEFAULT_OPTIONS, ...options };
  merged.host = parsed.host;
  merged.baseUrl = normalizeUrlNoFragment(parsed.origin + '/');
  merged.crawlerScriptsDir = path.resolve(merged.crawlerScriptsDir);
  merged.knowledgeBaseDir = merged.knowledgeBaseDir
    ? path.resolve(merged.knowledgeBaseDir)
    : path.resolve(process.cwd(), 'knowledge-base', sanitizeHost(parsed.host));
  merged.profilePath = merged.profilePath
    ? path.resolve(merged.profilePath)
    : path.join(MODULE_DIR, 'profiles', `${parsed.hostname}.json`);
  return merged;
}

async function loadProfile(profilePath) {
  if (!await pathExists(profilePath)) {
    throw new Error(`Missing site profile: ${profilePath}`);
  }
  const validation = await validateProfileFile(profilePath);
  return {
    raw: validation.raw,
    json: validation.profile,
    hash: sha(validation.raw),
  };
}

async function loadHistoricalContext(knowledgeBaseDir) {
  const root = path.join(knowledgeBaseDir, 'raw', 'step-book-content');
  if (!await pathExists(root)) {
    return null;
  }
  const entries = await readdir(root, { withFileTypes: true });
  const runDirs = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(root, entry.name))
    .sort((left, right) => path.basename(right).localeCompare(path.basename(left), 'en'));
  for (const runDir of runDirs) {
    const booksPath = path.join(runDir, 'books.json');
    if (!await pathExists(booksPath)) {
      continue;
    }
    const books = await readJsonFile(booksPath);
    return {
      dir: runDir,
      books,
    };
  }
  return null;
}

function renderPythonScript(context) {
  const contextJsonBase64 = Buffer.from(JSON.stringify(context, null, 2), 'utf8').toString('base64');
  return [
    '#!/usr/bin/env python3',
    '# -*- coding: utf-8 -*-',
    'from __future__ import annotations',
    '',
    'import base64',
    'import json',
    'import sys',
    'from pathlib import Path',
    '',
    'REPO_ROOT = Path(__file__).resolve().parents[2]',
    'if str(REPO_ROOT) not in sys.path:',
    '    sys.path.insert(0, str(REPO_ROOT))',
    '',
    'from download_book import cli_entry_for_generated',
    '',
    `GENERATED_CONTEXT = json.loads(base64.b64decode(${JSON.stringify(contextJsonBase64)}).decode("utf-8"))`,
    '',
    'if __name__ == "__main__":',
    '    cli_entry_for_generated(GENERATED_CONTEXT)',
    '',
  ].join('\n');
}

async function updateRegistry(registryPath, host, patch) {
  const registry = await pathExists(registryPath)
    ? await readJsonFile(registryPath)
    : { generatedAt: new Date().toISOString(), hosts: {} };
  registry.generatedAt = new Date().toISOString();
  registry.hosts = registry.hosts ?? {};
  registry.hosts[host] = { ...(registry.hosts[host] ?? {}), ...patch };
  await writeJsonFile(registryPath, registry);
}

export async function ensureCrawlerScript(inputUrl, options = {}) {
  const settings = mergeOptions(inputUrl, options);
  const profile = await loadProfile(settings.profilePath);
  const historical = await loadHistoricalContext(settings.knowledgeBaseDir);
  const siteContext = await readSiteContext(process.cwd(), settings.host);
  const hostDir = path.join(settings.crawlerScriptsDir, sanitizeHost(settings.host));
  const scriptPath = path.join(hostDir, 'crawler.py');
  const metaPath = path.join(hostDir, 'crawler.meta.json');
  const registryPath = path.join(settings.crawlerScriptsDir, 'registry.json');
  const resolvedPrimaryArchetype = resolvePrimaryArchetypeFromSiteContext(siteContext, [
    profile.json?.primaryArchetype,
  ]);

  if (await pathExists(scriptPath) && await pathExists(metaPath)) {
    const meta = await readJsonFile(metaPath);
    if (meta.profileHash === profile.hash && Number(meta.templateVersion) === TEMPLATE_VERSION) {
      const resolvedCapabilities = resolveCapabilityFamiliesFromSiteContext(siteContext, [
        meta.capabilities ?? [],
      ]);
      await updateRegistry(registryPath, settings.host, {
        host: settings.host,
        scriptPath,
        metaPath,
        profileHash: profile.hash,
        lastUsedAt: new Date().toISOString(),
        status: 'reused',
        scriptLanguage: 'python',
        interpreterRequired: 'pypy3',
        templateVersion: TEMPLATE_VERSION,
        capabilities: resolvedCapabilities,
      });
      await upsertSiteRegistryRecord(process.cwd(), settings.host, {
        canonicalBaseUrl: settings.baseUrl,
        siteArchetype: resolvedPrimaryArchetype,
        profilePath: settings.profilePath,
        profileVersion: profile.json?.version ?? 1,
        profileHash: profile.hash,
        crawlerScriptPath: scriptPath,
        crawlerMetaPath: metaPath,
        scriptLanguage: 'python',
        interpreterRequired: 'pypy3',
        templateVersion: TEMPLATE_VERSION,
        crawlerStatus: 'reused',
      });
      await upsertSiteCapabilities(process.cwd(), settings.host, {
        baseUrl: settings.baseUrl,
        primaryArchetype: resolvedPrimaryArchetype,
        pageTypes: resolvePageTypesFromSiteContext(siteContext, [profile.json?.pageTypes ?? []]),
        capabilityFamilies: resolvedCapabilities,
      });
      return {
        host: settings.host,
        scriptPath,
        metaPath,
        registryPath,
        status: 'reused',
        meta,
      };
    }
  }

  const generatedContext = {
    host: settings.host,
    baseUrl: settings.baseUrl,
    generatedAt: new Date().toISOString(),
    profilePath: settings.profilePath,
    profile: profile.json,
    profileHash: profile.hash,
    siteContext: {
      registryRecord: siteContext.registryRecord,
      capabilitiesRecord: siteContext.capabilitiesRecord,
    },
    historicalSamples: historical
      ? {
          sourceRunDir: historical.dir,
          books: (historical.books ?? []).slice(0, 8).map((book) => ({
            title: normalizeText(book.title),
            finalUrl: normalizeUrlNoFragment(book.finalUrl),
            authorName: normalizeText(book.authorName),
          })),
        }
      : { sourceRunDir: null, books: [] },
  };
  const meta = {
    host: settings.host,
    baseUrl: settings.baseUrl,
    generatedAt: new Date().toISOString(),
    scriptLanguage: 'python',
    interpreterRequired: 'pypy3',
    templateVersion: TEMPLATE_VERSION,
    profilePath: settings.profilePath,
    profileHash: profile.hash,
    profileVersion: profile.json?.version ?? 1,
    capabilities: [
      'search-content',
      'navigate-to-content',
      'navigate-to-author',
      'navigate-to-chapter',
      'download-content',
    ],
    dependencies: ['httpx', 'selectolax', 'anyio'],
    urlFamily: [settings.baseUrl],
    historicalContext: generatedContext.historicalSamples,
  };
  const resolvedCapabilities = resolveCapabilityFamiliesFromSiteContext(siteContext, [
    meta.capabilities ?? [],
  ]);

  await writeTextFile(scriptPath, renderPythonScript(generatedContext));
  await writeJsonFile(metaPath, meta);
  await updateRegistry(registryPath, settings.host, {
    host: settings.host,
    scriptPath,
    metaPath,
    profileHash: profile.hash,
    lastUsedAt: new Date().toISOString(),
    status: 'generated',
    scriptLanguage: 'python',
    interpreterRequired: 'pypy3',
    templateVersion: TEMPLATE_VERSION,
    capabilities: resolvedCapabilities,
  });
  await upsertSiteRegistryRecord(process.cwd(), settings.host, {
    canonicalBaseUrl: settings.baseUrl,
    siteArchetype: resolvedPrimaryArchetype,
    profilePath: settings.profilePath,
    profileVersion: profile.json?.version ?? 1,
    profileHash: profile.hash,
    crawlerScriptPath: scriptPath,
    crawlerMetaPath: metaPath,
    scriptLanguage: 'python',
    interpreterRequired: 'pypy3',
    templateVersion: TEMPLATE_VERSION,
    crawlerStatus: 'generated',
  });
  await upsertSiteCapabilities(process.cwd(), settings.host, {
    baseUrl: settings.baseUrl,
    primaryArchetype: resolvedPrimaryArchetype,
    pageTypes: resolvePageTypesFromSiteContext(siteContext, [profile.json?.pageTypes ?? []]),
    capabilityFamilies: resolvedCapabilities,
  });

  return {
    host: settings.host,
    scriptPath,
    metaPath,
    registryPath,
    status: 'generated',
    meta,
  };
}

function parseCliArgs(argv) {
  if (!argv.length || argv[0] === '--help' || argv[0] === '-h') {
    return { help: true };
  }
  const [inputUrl, ...rest] = argv;
  const options = {};
  const readValue = (index) => {
    if (index + 1 >= rest.length) {
      throw new Error(`Missing value for ${rest[index]}`);
    }
    return { value: rest[index + 1], nextIndex: index + 1 };
  };
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    switch (token) {
      case '--crawler-scripts-dir': {
        const { value, nextIndex } = readValue(index);
        options.crawlerScriptsDir = value;
        index = nextIndex;
        break;
      }
      case '--knowledge-base-dir': {
        const { value, nextIndex } = readValue(index);
        options.knowledgeBaseDir = value;
        index = nextIndex;
        break;
      }
      case '--profile-path': {
        const { value, nextIndex } = readValue(index);
        options.profilePath = value;
        index = nextIndex;
        break;
      }
      default:
        break;
    }
  }
  return { help: false, inputUrl, options };
}

async function runCli() {
  initializeCliUtf8();
  const parsed = parseCliArgs(process.argv.slice(2));
  if (parsed.help) {
    process.stdout.write(`${HELP}\n`);
    return;
  }
  const result = await ensureCrawlerScript(parsed.inputUrl, parsed.options);
  writeJsonStdout(result);
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (entryPath && fileURLToPath(import.meta.url) === entryPath) {
  runCli().catch((error) => {
    console.error(error?.message ?? String(error));
    process.exitCode = 1;
  });
}
