// @ts-check
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { initializeCliUtf8, writeJsonStdout } from '../../infra/cli.mjs';
import {
  parseProgressCliOption,
  runSingleStageCliWithProgress,
} from '../../infra/cli/progress-cli.mjs';
import { pathExists, readJsonFile, writeJsonFile, writeTextFile } from '../../infra/io.mjs';
import { normalizeText, normalizeUrlNoFragment, sanitizeHost } from '../../shared/normalize.mjs';
import {
  readSiteContext,
  resolveCapabilityFamiliesFromSiteContext,
  resolvePrimaryArchetypeFromSiteContext,
} from '../../sites/registry/core/context.mjs';
import { PROFILE_ARCHETYPES, resolveProfileArchetype, resolveProfilePrimaryArchetype } from '../../sites/registry/core/archetypes.mjs';
import { resolveConfiguredPageTypes } from '../../sites/registry/core/page-types.mjs';
import { loadValidatedProfileForUrl } from '../../sites/registry/core/profiles.mjs';
import { upsertSiteCapabilities, upsertSiteRegistryRecord } from '../../sites/registry/catalog/repository.mjs';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(MODULE_DIR, '..', '..', '..');
const TEMPLATE_VERSION = 3;
const DEFAULT_OPTIONS = {
  crawlerScriptsDir: path.resolve(process.cwd(), 'crawler-scripts'),
  knowledgeBaseDir: undefined,
  profilePath: undefined,
};
const HELP = 'Usage:\n  node src/entrypoints/pipeline/generate-crawler-script.mjs <url> [--crawler-scripts-dir <dir>] [--knowledge-base-dir <dir>] [--profile-path <path>] [--json] [--quiet] [--progress auto|interactive|plain]';

function mergeOptions(inputUrl, options = /** @type {any} */ ({})) {
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
    : path.join(REPO_ROOT, 'profiles', `${parsed.hostname}.json`);
  return merged;
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
    'import importlib.util',
    'import json',
    'import sys',
    'from pathlib import Path',
    '',
    'REPO_ROOT = Path(__file__).resolve().parents[2]',
    'BOOK_MODULE_PATH = REPO_ROOT / "src" / "sites" / "known-sites" / "chapter-content" / "download" / "python" / "book.py"',
    '',
    'spec = importlib.util.spec_from_file_location("bws_chapter_content_book_generated", BOOK_MODULE_PATH)',
    'if spec is None or spec.loader is None:',
    '    raise RuntimeError(f"Unable to load generated crawler entrypoint from {BOOK_MODULE_PATH}")',
    'module = importlib.util.module_from_spec(spec)',
    'spec.loader.exec_module(module)',
    '',
    `GENERATED_CONTEXT = json.loads(base64.b64decode(${JSON.stringify(contextJsonBase64)}).decode("utf-8"))`,
    '',
    'if __name__ == "__main__":',
    '    module.cli_entry_for_generated(GENERATED_CONTEXT)',
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

function deriveCrawlerCapabilities(profile) {
  const resolvedArchetype = resolveProfileArchetype(profile);
  if (resolvedArchetype === PROFILE_ARCHETYPES.CHAPTER_CONTENT) {
    return [
      'search-content',
      'navigate-to-content',
      'navigate-to-author',
      'navigate-to-chapter',
      'download-content',
    ];
  }

  const capabilities = ['search-content'];
  if ((profile?.navigation?.contentPathPrefixes ?? []).length || (profile?.pageTypes?.contentDetailPrefixes ?? []).length) {
    capabilities.push('navigate-to-content');
  }
  if (
    (profile?.navigation?.authorPathPrefixes ?? []).length
    || (profile?.navigation?.authorDetailPathPrefixes ?? []).length
    || (profile?.pageTypes?.authorPrefixes ?? []).length
    || (profile?.pageTypes?.authorDetailPrefixes ?? []).length
  ) {
    capabilities.push('navigate-to-author');
  }
  if ((profile?.navigation?.categoryPathPrefixes ?? []).length || (profile?.pageTypes?.categoryPrefixes ?? []).length) {
    capabilities.push('navigate-to-category');
  }
  if ((profile?.navigation?.utilityPathPrefixes ?? []).length) {
    capabilities.push('navigate-to-utility-page');
  }
  if (profile?.downloader) {
    capabilities.push('download-content');
  }
  if (profile?.social) {
    capabilities.push('query-account-profile', 'query-social-content', 'query-social-relations');
  }
  capabilities.push('switch-in-page-state');
  return [...new Set(capabilities)];
}

function deriveCrawlerPageTypes(profile) {
  return resolveConfiguredPageTypes(profile);
}

function deriveSupportedIntents(profile, host) {
  const resolvedArchetype = resolveProfileArchetype(profile);
  const normalizedHost = String(host ?? profile?.host ?? '').toLowerCase();
  if (resolvedArchetype === PROFILE_ARCHETYPES.CHAPTER_CONTENT) {
    return ['download-book'];
  }

  const intents = /** @type {any[]} */ ([]);
  if (normalizedHost === 'www.bilibili.com' || normalizedHost === 'search.bilibili.com' || normalizedHost === 'space.bilibili.com') {
    intents.push('search-video', 'open-video', 'open-author');
  } else if (normalizedHost === 'www.douyin.com') {
    intents.push('search-video', 'open-video', 'open-author');
  } else if (normalizedHost === 'x.com' || normalizedHost === 'www.x.com') {
    intents.push('search-posts', 'open-post', 'open-author');
  } else if (normalizedHost === 'www.instagram.com' || normalizedHost === 'instagram.com') {
    intents.push('search-content', 'open-post', 'open-reel', 'open-author');
  } else if (normalizedHost === 'jable.tv') {
    intents.push('search-video', 'open-video', 'open-model');
  } else if (normalizedHost === 'moodyz.com') {
    intents.push('search-work', 'open-work', 'open-actress');
  } else {
    intents.push('search-book', 'open-book', 'open-author');
  }

  if ((profile?.navigation?.categoryPathPrefixes ?? []).length || (profile?.pageTypes?.categoryPrefixes ?? []).length) {
    intents.push('open-category');
  }
  if ((profile?.navigation?.utilityPathPrefixes ?? []).length) {
    intents.push('open-utility-page');
  }
  if (profile?.downloader) {
    intents.push('download-book');
  }
  if (profile?.social) {
    intents.push(
      'account-info',
      'profile-content',
      'full-archive',
      'list-profile-content',
      'list-author-following',
      'list-followed-users',
      'list-followed-updates',
    );
  }
  return [...new Set(intents)];
}

function deriveSafeActionKinds() {
  return ['navigate'];
}

function deriveApprovalActionKinds(profile) {
  return Array.isArray(profile?.search?.formSelectors) && profile.search.formSelectors.length ? ['search-submit'] : [];
}

export async function ensureCrawlerScript(inputUrl, options = /** @type {any} */ ({})) {
  const settings = mergeOptions(inputUrl, options);
  const profile = await loadValidatedProfileForUrl(inputUrl, {
    profilePath: settings.profilePath,
  });
  const historical = await loadHistoricalContext(settings.knowledgeBaseDir);
  const siteContext = await readSiteContext(process.cwd(), settings.host, settings.siteMetadataOptions ?? {});
  const hostDir = path.join(settings.crawlerScriptsDir, sanitizeHost(settings.host));
  const scriptPath = path.join(hostDir, 'crawler.py');
  const metaPath = path.join(hostDir, 'crawler.meta.json');
  const registryPath = path.join(settings.crawlerScriptsDir, 'registry.json');
  const resolvedPrimaryArchetype = resolvePrimaryArchetypeFromSiteContext(siteContext, [
    resolveProfilePrimaryArchetype(profile.json),
  ]);
  const derivedCapabilities = deriveCrawlerCapabilities(profile.json);
  const derivedPageTypes = deriveCrawlerPageTypes(profile.json);
  const derivedSupportedIntents = deriveSupportedIntents(profile.json, settings.host);
  const derivedSafeActionKinds = deriveSafeActionKinds();
  const derivedApprovalActionKinds = deriveApprovalActionKinds(profile.json);

  if (await pathExists(scriptPath) && await pathExists(metaPath)) {
    const meta = await readJsonFile(metaPath);
    if (meta.profileHash === profile.hash && Number(meta.templateVersion) === TEMPLATE_VERSION) {
      if (JSON.stringify(meta.capabilities ?? []) !== JSON.stringify(derivedCapabilities)) {
        meta.capabilities = derivedCapabilities;
        meta.generatedAt = new Date().toISOString();
        await writeJsonFile(metaPath, meta);
      }
      const resolvedCapabilities = resolveCapabilityFamiliesFromSiteContext(siteContext, [derivedCapabilities]);
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
      }, settings.siteMetadataOptions ?? {});
      await upsertSiteCapabilities(process.cwd(), settings.host, {
        baseUrl: settings.baseUrl,
        primaryArchetype: resolvedPrimaryArchetype,
        pageTypes: derivedPageTypes,
        capabilityFamilies: resolvedCapabilities,
        supportedIntents: derivedSupportedIntents,
        safeActionKinds: derivedSafeActionKinds,
        approvalActionKinds: derivedApprovalActionKinds,
      }, settings.siteMetadataOptions ?? {});
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
    capabilities: derivedCapabilities,
    dependencies: ['httpx', 'selectolax', 'anyio'],
    urlFamily: [settings.baseUrl],
    historicalContext: generatedContext.historicalSamples,
  };
  const resolvedCapabilities = resolveCapabilityFamiliesFromSiteContext(siteContext, [derivedCapabilities]);

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
  }, settings.siteMetadataOptions ?? {});
  await upsertSiteCapabilities(process.cwd(), settings.host, {
    baseUrl: settings.baseUrl,
    primaryArchetype: resolvedPrimaryArchetype,
    pageTypes: derivedPageTypes,
    capabilityFamilies: resolvedCapabilities,
    supportedIntents: derivedSupportedIntents,
    safeActionKinds: derivedSafeActionKinds,
    approvalActionKinds: derivedApprovalActionKinds,
  }, settings.siteMetadataOptions ?? {});

  return {
    host: settings.host,
    scriptPath,
    metaPath,
    registryPath,
    status: 'generated',
    meta,
  };
}

export function parseCliArgs(argv) {
  if (!argv.length || argv[0] === '--help' || argv[0] === '-h') {
    return { help: true };
  }
  const [inputUrl, ...rest] = argv;
  const options = /** @type {any} */ ({});
  const readValue = (index) => {
    if (index + 1 >= rest.length) {
      throw new Error(`Missing value for ${rest[index]}`);
    }
    return { value: rest[index + 1], nextIndex: index + 1 };
  };
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    const progressOption = parseProgressCliOption(rest, token, index, options);
    if (progressOption.handled) {
      index = progressOption.nextIndex;
      continue;
    }
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

function crawlerArtifacts(result) {
  return [
    result?.scriptPath ? { label: 'Crawler', path: result.scriptPath } : null,
    result?.metaPath ? { label: 'Metadata', path: result.metaPath } : null,
    result?.registryPath ? { label: 'Registry', path: result.registryPath } : null,
  ].filter(Boolean);
}

async function runCli() {
  initializeCliUtf8();
  const parsed = parseCliArgs(process.argv.slice(2));
  if (parsed.help) {
    process.stdout.write(`${HELP}\n`);
    return;
  }
  const result = await runSingleStageCliWithProgress({
    inputUrl: parsed.inputUrl,
    options: parsed.options,
    taskId: 'crawlerScript',
    title: 'Generate crawler script',
    stageId: 'crawlerScript',
    stageTitle: '生成站点爬虫脚本',
    run: (stageOptions) => ensureCrawlerScript(parsed.inputUrl, stageOptions),
    successMessage: (stageResult) => `crawler script ${stageResult?.status ?? 'ready'}`,
    artifacts: crawlerArtifacts,
    failureTitle: 'Crawler script generation failed',
    nextStep: 'Run site-doctor for the URL and repair the site profile before regenerating the crawler script.',
  });
  writeJsonStdout(result);
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (entryPath && fileURLToPath(import.meta.url) === entryPath) {
  runCli().catch((error) => {
    console.error(error?.message ?? String(error));
    process.exitCode = 1;
  });
}
