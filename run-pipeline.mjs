import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { capture } from './capture.mjs';
import { expandStates } from './expand-states.mjs';
import { collectBookContent } from './collect-book-content.mjs';
import { analyzeStates } from './analyze-states.mjs';
import { abstractInteractions } from './abstract-interactions.mjs';
import { buildNlEntry } from './nl-entry.mjs';
import { generateDocs } from './generate-docs.mjs';
import { buildGovernance } from './govern-interactions.mjs';
import { compileKnowledgeBase } from './compile-wiki.mjs';
import { generateSkill } from './generate-skill.mjs';

const DEFAULT_OPTIONS = {
  browserPath: undefined,
  headless: true,
  timeoutMs: 30_000,
  waitUntil: 'load',
  idleMs: 1_000,
  fullPage: true,
  viewport: undefined,
  userAgent: undefined,
  maxTriggers: 12,
  searchQueries: [],
  examplesPath: undefined,
  captureOutDir: path.resolve(process.cwd(), 'captures'),
  expandedOutDir: path.resolve(process.cwd(), 'expanded-states'),
  bookContentOutDir: path.resolve(process.cwd(), 'book-content'),
  analysisOutDir: path.resolve(process.cwd(), 'state-analysis'),
  abstractionOutDir: path.resolve(process.cwd(), 'interaction-abstraction'),
  nlEntryOutDir: path.resolve(process.cwd(), 'nl-entry'),
  docsOutDir: path.resolve(process.cwd(), 'operation-docs'),
  governanceOutDir: path.resolve(process.cwd(), 'governance'),
  kbDir: undefined,
  skillOutDir: undefined,
  skillName: undefined,
  strict: true,
};

function normalizeWhitespace(value) {
  return String(value ?? '').replace(/\s+/gu, ' ').trim();
}

function slugifyAscii(value, fallback = '') {
  const normalized = normalizeWhitespace(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
  return normalized || fallback;
}

function toBoolean(value, flagName) {
  if (typeof value === 'boolean') {
    return value;
  }
  const normalized = normalizeWhitespace(value).toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['false', '0', 'no', 'off'].includes(normalized)) {
    return false;
  }
  throw new Error(`Invalid boolean for ${flagName}: ${value}`);
}

function resolveSkillName(inputUrl, explicitSkillName) {
  if (explicitSkillName) {
    return slugifyAscii(explicitSkillName, 'site-skill');
  }

  try {
    const parsed = new URL(inputUrl);
    const hostLabels = parsed.hostname
      .split('.')
      .map((label) => normalizeWhitespace(label).toLowerCase())
      .filter(Boolean)
      .filter((label) => !['www', 'm'].includes(label));

    const baseLabel = slugifyAscii(hostLabels[0], 'site');
    const firstSegment = parsed.pathname
      .split('/')
      .map((segment) => normalizeWhitespace(segment))
      .find(Boolean);
    const segmentSlug = firstSegment ? slugifyAscii(firstSegment, '') : '';
    return segmentSlug ? `${baseLabel}-${segmentSlug}` : baseLabel;
  } catch {
    return 'site-skill';
  }
}

function mergeOptions(options = {}) {
  const merged = {
    ...DEFAULT_OPTIONS,
    ...Object.fromEntries(Object.entries(options).filter(([, value]) => value !== undefined)),
  };

  const pathKeys = [
    'captureOutDir',
    'expandedOutDir',
    'bookContentOutDir',
    'analysisOutDir',
    'abstractionOutDir',
    'nlEntryOutDir',
    'docsOutDir',
    'governanceOutDir',
    'kbDir',
    'skillOutDir',
    'examplesPath',
    'browserPath',
  ];

  for (const key of pathKeys) {
    if (merged[key]) {
      merged[key] = path.resolve(merged[key]);
    }
  }

  merged.timeoutMs = Number(merged.timeoutMs);
  merged.idleMs = Number(merged.idleMs);
  merged.maxTriggers = Number(merged.maxTriggers);
  merged.searchQueries = Array.isArray(merged.searchQueries)
    ? merged.searchQueries.map((value) => normalizeWhitespace(value)).filter(Boolean)
    : (merged.searchQueries ? [normalizeWhitespace(merged.searchQueries)].filter(Boolean) : []);
  merged.headless = toBoolean(merged.headless, 'headless');
  merged.fullPage = toBoolean(merged.fullPage, 'fullPage');
  merged.strict = toBoolean(merged.strict, 'strict');
  merged.skillName = resolveSkillName(options.url ?? '', merged.skillName);
  return merged;
}

function summarizeCapture(manifest) {
  return {
    status: 'success',
    outDir: manifest.outDir,
    finalUrl: manifest.finalUrl,
    title: manifest.title,
    capturedAt: manifest.capturedAt,
  };
}

function summarizeExpanded(manifest) {
  return {
    status: 'success',
    outDir: manifest.outDir,
    discoveredTriggers: manifest.summary?.discoveredTriggers ?? 0,
    attemptedTriggers: manifest.summary?.attemptedTriggers ?? 0,
    capturedStates: manifest.summary?.capturedStates ?? 0,
    duplicateStates: manifest.summary?.duplicateStates ?? 0,
    noopTriggers: manifest.summary?.noopTriggers ?? 0,
    failedTriggers: manifest.summary?.failedTriggers ?? 0,
  };
}

function summarizeManifestStage(manifest) {
  return {
    status: 'success',
    outDir: manifest.outDir,
    summary: manifest.summary ?? {},
  };
}

function summarizeBookContent(manifest) {
  return {
    status: 'success',
    outDir: manifest.outDir,
    summary: manifest.summary ?? {},
    negativeQueries: manifest.negativeQueries ?? [],
  };
}

function summarizeKnowledgeBase(result) {
  return {
    status: 'success',
    kbDir: result.kbDir,
    pages: result.pages,
    lintSummary: result.lintSummary,
    gapGroups: result.gapGroups,
  };
}

function summarizeSkill(result) {
  return {
    status: 'success',
    skillDir: result.skillDir,
    skillName: result.skillName,
    references: result.references,
    warnings: result.warnings,
  };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientLockError(error) {
  const message = error?.message ? String(error.message) : String(error);
  return /EBUSY|resource busy or locked|lockfile/i.test(message);
}

async function runStage(stageName, action) {
  try {
    return await action();
  } catch (error) {
    const message = error?.message ? String(error.message) : String(error);
    throw new Error(`[${stageName}] ${message}`);
  }
}

async function runStageWithRetry(stageName, action, { attempts = 2, retryDelayMs = 1_500 } = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await runStage(stageName, action);
    } catch (error) {
      lastError = error;
      if (attempt >= attempts || !isTransientLockError(error)) {
        throw error;
      }
      await delay(retryDelayMs);
    }
  }
  throw lastError;
}

function ensureCaptureSucceeded(manifest) {
  if (manifest?.status !== 'success') {
    const errorCode = manifest?.error?.code ? `${manifest.error.code}: ` : '';
    const errorMessage = manifest?.error?.message ?? `Capture returned status ${manifest?.status ?? 'unknown'}`;
    throw new Error(`${errorCode}${errorMessage}`);
  }
}

export async function runPipeline(inputUrl, options = {}) {
  const settings = mergeOptions({ ...options, url: inputUrl });
  const generatedAt = new Date().toISOString();

  const captureManifest = await runStageWithRetry('capture', async () => {
    const manifest = await capture(inputUrl, {
      outDir: settings.captureOutDir,
      browserPath: settings.browserPath,
      headless: settings.headless,
      timeoutMs: settings.timeoutMs,
      waitUntil: settings.waitUntil,
      idleMs: settings.idleMs,
      fullPage: settings.fullPage,
      viewport: settings.viewport,
      userAgent: settings.userAgent,
    });
    ensureCaptureSucceeded(manifest);
    return manifest;
  });

  const expandedManifest = await runStageWithRetry('expanded', async () => expandStates(inputUrl, {
    initialManifestPath: captureManifest.files.manifest,
    outDir: settings.expandedOutDir,
    browserPath: settings.browserPath,
    headless: settings.headless,
    timeoutMs: settings.timeoutMs,
    waitUntil: settings.waitUntil,
    idleMs: settings.idleMs,
    fullPage: settings.fullPage,
    viewport: settings.viewport,
    userAgent: settings.userAgent,
    maxTriggers: settings.maxTriggers,
    searchQueries: settings.searchQueries,
  }));

  const bookContentManifest = await runStage('bookContent', async () => collectBookContent(inputUrl, {
    expandedStatesDir: expandedManifest.outDir,
    outDir: settings.bookContentOutDir,
    searchQueries: settings.searchQueries,
  }));

  const analysisManifest = await runStage('analysis', async () => analyzeStates(inputUrl, {
    expandedStatesDir: expandedManifest.outDir,
    bookContentDir: bookContentManifest.outDir,
    outDir: settings.analysisOutDir,
  }));

  const abstractionManifest = await runStage('abstraction', async () => abstractInteractions(inputUrl, {
    analysisDir: analysisManifest.outDir,
    expandedStatesDir: expandedManifest.outDir,
    outDir: settings.abstractionOutDir,
  }));

  const nlEntryManifest = await runStage('nlEntry', async () => buildNlEntry(inputUrl, {
    abstractionDir: abstractionManifest.outDir,
    analysisDir: analysisManifest.outDir,
    examplesPath: settings.examplesPath,
    outDir: settings.nlEntryOutDir,
  }));

  const docsManifest = await runStage('docs', async () => generateDocs(inputUrl, {
    nlEntryDir: nlEntryManifest.outDir,
    abstractionDir: abstractionManifest.outDir,
    analysisDir: analysisManifest.outDir,
    expandedStatesDir: expandedManifest.outDir,
    outDir: settings.docsOutDir,
  }));

  const governanceResult = await runStage('governance', async () => buildGovernance(inputUrl, {
    docsDir: docsManifest.outDir,
    nlEntryDir: nlEntryManifest.outDir,
    abstractionDir: abstractionManifest.outDir,
    analysisDir: analysisManifest.outDir,
    expandedStatesDir: expandedManifest.outDir,
    outDir: settings.governanceOutDir,
  }));

  const knowledgeBaseResult = await runStage('knowledgeBase', async () => compileKnowledgeBase(inputUrl, {
    captureDir: captureManifest.outDir,
    expandedStatesDir: expandedManifest.outDir,
    bookContentDir: bookContentManifest.outDir,
    analysisDir: analysisManifest.outDir,
    abstractionDir: abstractionManifest.outDir,
    nlEntryDir: nlEntryManifest.outDir,
    docsDir: docsManifest.outDir,
    governanceDir: governanceResult.outDir,
    kbDir: settings.kbDir,
    strict: settings.strict,
  }));

  const skillResult = await runStage('skill', async () => generateSkill(inputUrl, {
    kbDir: knowledgeBaseResult.kbDir,
    outDir: settings.skillOutDir,
    skillName: settings.skillName,
  }));

  return {
    inputUrl,
    generatedAt,
    kbDir: knowledgeBaseResult.kbDir,
    skillDir: skillResult.skillDir,
    skillName: skillResult.skillName,
    stages: {
      capture: summarizeCapture(captureManifest),
      expanded: summarizeExpanded(expandedManifest),
      bookContent: summarizeBookContent(bookContentManifest),
      analysis: summarizeManifestStage(analysisManifest),
      abstraction: summarizeManifestStage(abstractionManifest),
      nlEntry: summarizeManifestStage(nlEntryManifest),
      docs: summarizeManifestStage(docsManifest),
      governance: {
        status: 'success',
        outDir: governanceResult.outDir,
        summary: governanceResult.summary ?? {},
      },
      knowledgeBase: summarizeKnowledgeBase(knowledgeBaseResult),
      skill: summarizeSkill(skillResult),
    },
  };
}

function printHelp() {
  process.stdout.write(`Usage:
  node run-pipeline.mjs <url> [options]

Options:
  --browser-path <path>        Explicit Chromium/Chrome executable path
  --timeout <ms>               Overall timeout for browser steps
  --wait-until <mode>          load | networkidle
  --idle-ms <ms>               Extra delay after readiness before capture
  --max-triggers <n>           Maximum discovered triggers to expand
  --search-query <text>        Repeatable search query seed for site search
  --examples <path>            Optional example utterance JSON file
  --capture-out-dir <dir>      Root output directory for step 1
  --expanded-out-dir <dir>     Root output directory for step 2
  --book-content-out-dir <dir> Root output directory for chapter/book content collection
  --analysis-out-dir <dir>     Root output directory for step 3
  --abstraction-out-dir <dir>  Root output directory for step 4
  --nl-entry-out-dir <dir>     Root output directory for step 5
  --docs-out-dir <dir>         Root output directory for step 6
  --governance-out-dir <dir>   Root output directory for step 7
  --kb-dir <dir>               Final knowledge base directory
  --skill-out-dir <dir>        Final skill directory
  --skill-name <name>          Override default skill name
  --strict <true|false>        Strict mode for compileKnowledgeBase
  --headless                   Run browser headless (default)
  --no-headless                Run browser with a visible window
  --full-page                  Force full-page screenshot (default)
  --no-full-page               Disable full-page screenshot
  --help                       Show this help
`);
}

function parseCliArgs(argv) {
  const args = [...argv];
  const options = {};
  let url = null;

  const readValue = (current, index) => {
    const eqIndex = current.indexOf('=');
    if (eqIndex !== -1) {
      return { value: current.slice(eqIndex + 1), nextIndex: index };
    }
    if (index + 1 >= args.length) {
      throw new Error(`Missing value for ${current}`);
    }
    return { value: args[index + 1], nextIndex: index + 1 };
  };

  for (let index = 0; index < args.length; index += 1) {
    const current = args[index];
    if (!current.startsWith('--')) {
      if (url !== null) {
        throw new Error(`Unexpected argument: ${current}`);
      }
      url = current;
      continue;
    }

    switch (current.split('=')[0]) {
      case '--browser-path': {
        const { value, nextIndex } = readValue(current, index);
        options.browserPath = value;
        index = nextIndex;
        break;
      }
      case '--timeout': {
        const { value, nextIndex } = readValue(current, index);
        options.timeoutMs = Number(value);
        index = nextIndex;
        break;
      }
      case '--wait-until': {
        const { value, nextIndex } = readValue(current, index);
        options.waitUntil = value;
        index = nextIndex;
        break;
      }
      case '--idle-ms': {
        const { value, nextIndex } = readValue(current, index);
        options.idleMs = Number(value);
        index = nextIndex;
        break;
      }
      case '--max-triggers': {
        const { value, nextIndex } = readValue(current, index);
        options.maxTriggers = Number(value);
        index = nextIndex;
        break;
      }
      case '--search-query': {
        const { value, nextIndex } = readValue(current, index);
        options.searchQueries = [...(options.searchQueries ?? []), value];
        index = nextIndex;
        break;
      }
      case '--examples': {
        const { value, nextIndex } = readValue(current, index);
        options.examplesPath = value;
        index = nextIndex;
        break;
      }
      case '--capture-out-dir': {
        const { value, nextIndex } = readValue(current, index);
        options.captureOutDir = value;
        index = nextIndex;
        break;
      }
      case '--expanded-out-dir': {
        const { value, nextIndex } = readValue(current, index);
        options.expandedOutDir = value;
        index = nextIndex;
        break;
      }
      case '--analysis-out-dir': {
        const { value, nextIndex } = readValue(current, index);
        options.analysisOutDir = value;
        index = nextIndex;
        break;
      }
      case '--book-content-out-dir': {
        const { value, nextIndex } = readValue(current, index);
        options.bookContentOutDir = value;
        index = nextIndex;
        break;
      }
      case '--abstraction-out-dir': {
        const { value, nextIndex } = readValue(current, index);
        options.abstractionOutDir = value;
        index = nextIndex;
        break;
      }
      case '--nl-entry-out-dir': {
        const { value, nextIndex } = readValue(current, index);
        options.nlEntryOutDir = value;
        index = nextIndex;
        break;
      }
      case '--docs-out-dir': {
        const { value, nextIndex } = readValue(current, index);
        options.docsOutDir = value;
        index = nextIndex;
        break;
      }
      case '--governance-out-dir': {
        const { value, nextIndex } = readValue(current, index);
        options.governanceOutDir = value;
        index = nextIndex;
        break;
      }
      case '--kb-dir': {
        const { value, nextIndex } = readValue(current, index);
        options.kbDir = value;
        index = nextIndex;
        break;
      }
      case '--skill-out-dir': {
        const { value, nextIndex } = readValue(current, index);
        options.skillOutDir = value;
        index = nextIndex;
        break;
      }
      case '--skill-name': {
        const { value, nextIndex } = readValue(current, index);
        options.skillName = value;
        index = nextIndex;
        break;
      }
      case '--strict': {
        const { value, nextIndex } = readValue(current, index);
        options.strict = toBoolean(value, '--strict');
        index = nextIndex;
        break;
      }
      case '--headless':
        options.headless = true;
        break;
      case '--no-headless':
        options.headless = false;
        break;
      case '--full-page':
        options.fullPage = true;
        break;
      case '--no-full-page':
        options.fullPage = false;
        break;
      case '--help':
        options.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${current}`);
    }
  }

  return { url, options };
}

async function runCli() {
  const { url, options } = parseCliArgs(process.argv.slice(2));
  if (options.help || !url) {
    printHelp();
    if (!options.help && !url) {
      process.exitCode = 1;
    }
    return;
  }

  const result = await runPipeline(url, options);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (entryPath && fileURLToPath(import.meta.url) === entryPath) {
  runCli().catch((error) => {
    process.stderr.write(`${error?.message ?? String(error)}\n`);
    process.exitCode = 1;
  });
}
