// @ts-check
import { createHash } from 'node:crypto';
import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_VERSION = 3;
const DEFAULT_OPTIONS = {
  crawlerScriptsDir: path.resolve(process.cwd(), 'crawler-scripts'),
  knowledgeBaseDir: undefined,
  profilePath: undefined,
};
const HELP = 'Usage:\n  node generate-crawler-script.mjs <url> [--crawler-scripts-dir <dir>] [--knowledge-base-dir <dir>] [--profile-path <path>]';

function normalizeWhitespace(value) {
  return String(value ?? '').replace(/\s+/gu, ' ').trim();
}

function normalizeText(value) {
  return normalizeWhitespace(String(value ?? '').normalize('NFKC'));
}

function normalizeUrlNoFragment(value) {
  if (!value) {
    return null;
  }
  try {
    const parsed = new URL(String(value));
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return String(value).split('#')[0];
  }
}

function sanitizeHost(host) {
  return (host || 'unknown-host').replace(/[^a-zA-Z0-9.-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'unknown-host';
}

function sha(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

async function exists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function readJson(targetPath) {
  return JSON.parse(await readFile(targetPath, 'utf8'));
}

async function writeJson(targetPath, payload) {
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

async function writeText(targetPath, payload) {
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, payload, 'utf8');
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
  if (!await exists(profilePath)) {
    throw new Error(`Missing site profile: ${profilePath}`);
  }
  const raw = await readFile(profilePath, 'utf8');
  return {
    raw,
    json: JSON.parse(raw),
    hash: sha(raw),
  };
}

async function loadHistoricalContext(knowledgeBaseDir) {
  const root = path.join(knowledgeBaseDir, 'raw', 'step-book-content');
  if (!await exists(root)) {
    return null;
  }
  const entries = await readdir(root, { withFileTypes: true });
  const runDirs = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(root, entry.name))
    .sort((left, right) => path.basename(right).localeCompare(path.basename(left), 'en'));
  for (const runDir of runDirs) {
    const booksPath = path.join(runDir, 'books.json');
    if (!await exists(booksPath)) {
      continue;
    }
    const books = await readJson(booksPath);
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
  const registry = await exists(registryPath)
    ? await readJson(registryPath)
    : { generatedAt: new Date().toISOString(), hosts: {} };
  registry.generatedAt = new Date().toISOString();
  registry.hosts = registry.hosts ?? {};
  registry.hosts[host] = { ...(registry.hosts[host] ?? {}), ...patch };
  await writeJson(registryPath, registry);
}

export async function ensureCrawlerScript(inputUrl, options = {}) {
  const settings = mergeOptions(inputUrl, options);
  const profile = await loadProfile(settings.profilePath);
  const historical = await loadHistoricalContext(settings.knowledgeBaseDir);
  const hostDir = path.join(settings.crawlerScriptsDir, sanitizeHost(settings.host));
  const scriptPath = path.join(hostDir, 'crawler.py');
  const metaPath = path.join(hostDir, 'crawler.meta.json');
  const registryPath = path.join(settings.crawlerScriptsDir, 'registry.json');

  if (await exists(scriptPath) && await exists(metaPath)) {
    const meta = await readJson(metaPath);
    if (meta.profileHash === profile.hash && Number(meta.templateVersion) === TEMPLATE_VERSION) {
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
        capabilities: meta.capabilities ?? [],
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

  await writeText(scriptPath, renderPythonScript(generatedContext));
  await writeJson(metaPath, meta);
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
    capabilities: meta.capabilities,
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
  const parsed = parseCliArgs(process.argv.slice(2));
  if (parsed.help) {
    process.stdout.write(`${HELP}\n`);
    return;
  }
  const result = await ensureCrawlerScript(parsed.inputUrl, parsed.options);
  console.log(JSON.stringify(result, null, 2));
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (entryPath && fileURLToPath(import.meta.url) === entryPath) {
  runCli().catch((error) => {
    console.error(error?.message ?? String(error));
    process.exitCode = 1;
  });
}
