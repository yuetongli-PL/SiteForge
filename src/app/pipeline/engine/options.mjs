import path from 'node:path';
import process from 'node:process';
import { isXiaohongshuUrl } from '../../../shared/xiaohongshu-risk.mjs';
import { parseBoolean } from '../../../shared/boolean.mjs';
import { hostFromUrl, normalizeWhitespace, sanitizeHost, slugifyAscii } from '../../../shared/normalize.mjs';
import { isDouyinSiteProfile, resolveDouyinHeadlessDefault } from '../../../sites/known-sites/douyin/model/site.mjs';

const DEFAULT_PIPELINE_OPTIONS = {
  browserPath: undefined,
  browserProfileRoot: undefined,
  userDataDir: undefined,
  headless: true,
  reuseLoginState: undefined,
  autoLogin: undefined,
  timeoutMs: 30_000,
  waitUntil: 'load',
  idleMs: 1_000,
  fullPage: true,
  viewport: undefined,
  userAgent: undefined,
  maxTriggers: 12,
  maxCapturedStates: undefined,
  searchQueries: [],
  targetBookTitle: undefined,
  targetBookUrl: undefined,
  skipFallback: false,
  chapterFetchConcurrency: undefined,
  examplesPath: undefined,
  captureOutDir: path.resolve(process.cwd(), 'runs', 'pipeline', 'captures'),
  expandedOutDir: path.resolve(process.cwd(), 'runs', 'pipeline', 'expanded-states'),
  bookContentOutDir: path.resolve(process.cwd(), 'book-content'),
  analysisOutDir: path.resolve(process.cwd(), 'runs', 'pipeline', 'state-analysis'),
  abstractionOutDir: path.resolve(process.cwd(), 'runs', 'pipeline', 'interaction-abstraction'),
  nlEntryOutDir: path.resolve(process.cwd(), 'runs', 'pipeline', 'nl-entry'),
  docsOutDir: path.resolve(process.cwd(), 'runs', 'pipeline', 'operation-docs'),
  governanceOutDir: path.resolve(process.cwd(), 'runs', 'pipeline', 'governance'),
  capabilityCompileOutDir: undefined,
  capabilityCompileIntent: undefined,
  requestedCapabilities: [],
  kbDir: undefined,
  skillOutDir: undefined,
  skillName: undefined,
  siteMetadataOptions: undefined,
  strict: true,
};

export function toBoolean(value, flagName) {
  return parseBoolean(value, {
    mode: 'strict',
    onInvalid: () => {
      throw new Error(`Invalid boolean for ${flagName}: ${value}`);
    },
  });
}

export function resolveSkillName(inputUrl, explicitSkillName) {
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

export function mergePipelineOptions(options = {}) {
  const merged = {
    ...DEFAULT_PIPELINE_OPTIONS,
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
    'capabilityCompileOutDir',
    'kbDir',
    'skillOutDir',
    'examplesPath',
    'browserPath',
    'browserProfileRoot',
    'userDataDir',
  ];

  for (const key of pathKeys) {
    if (merged[key]) {
      merged[key] = path.resolve(merged[key]);
    }
  }
  if (merged.siteMetadataOptions && typeof merged.siteMetadataOptions === 'object') {
    merged.siteMetadataOptions = {
      ...merged.siteMetadataOptions,
      ...(merged.siteMetadataOptions.configDir
        ? { configDir: path.resolve(merged.siteMetadataOptions.configDir) }
        : {}),
      ...(merged.siteMetadataOptions.runtimeDir
        ? { runtimeDir: path.resolve(merged.siteMetadataOptions.runtimeDir) }
        : {}),
    };
  }

  merged.timeoutMs = Number(merged.timeoutMs);
  merged.idleMs = Number(merged.idleMs);
  merged.maxTriggers = Number(merged.maxTriggers);
  if (merged.maxCapturedStates !== undefined && merged.maxCapturedStates !== null) {
    merged.maxCapturedStates = Number(merged.maxCapturedStates);
  }
  merged.searchQueries = Array.isArray(merged.searchQueries)
    ? merged.searchQueries.map((value) => normalizeWhitespace(value)).filter(Boolean)
    : (merged.searchQueries ? [normalizeWhitespace(merged.searchQueries)].filter(Boolean) : []);
  merged.requestedCapabilities = Array.isArray(merged.requestedCapabilities)
    ? merged.requestedCapabilities.map((value) => normalizeWhitespace(value)).filter(Boolean)
    : (merged.requestedCapabilities ? [normalizeWhitespace(merged.requestedCapabilities)].filter(Boolean) : []);
  merged.targetBookTitle = normalizeWhitespace(merged.targetBookTitle);
  merged.targetBookUrl = normalizeWhitespace(merged.targetBookUrl);
  merged.skipFallback = toBoolean(merged.skipFallback, 'skipFallback');
  if (merged.chapterFetchConcurrency !== undefined && merged.chapterFetchConcurrency !== null) {
    merged.chapterFetchConcurrency = Number(merged.chapterFetchConcurrency);
  }
  merged.headless = toBoolean(merged.headless, 'headless');
  merged.fullPage = toBoolean(merged.fullPage, 'fullPage');
  merged.strict = toBoolean(merged.strict, 'strict');
  if (merged.reuseLoginState !== undefined) {
    merged.reuseLoginState = toBoolean(merged.reuseLoginState, 'reuseLoginState');
  }
  if (merged.autoLogin !== undefined) {
    merged.autoLogin = toBoolean(merged.autoLogin, 'autoLogin');
  }
  merged.capabilityCompileIntent = normalizeWhitespace(merged.capabilityCompileIntent);
  if (!merged.capabilityCompileOutDir) {
    const hostKey = sanitizeHost(hostFromUrl(options.url ?? '') ?? options.url ?? 'unknown-host');
    merged.capabilityCompileOutDir = path.resolve(process.cwd(), 'runs', 'sites', 'site-capability-compile', hostKey);
  }
  merged.skillName = resolveSkillName(options.url ?? '', merged.skillName);
  return merged;
}

export function normalizePipelineOptions(inputUrl, options = {}) {
  const mergedOptions = { ...options, url: inputUrl };
  if (!Object.prototype.hasOwnProperty.call(options, 'headless')) {
    mergedOptions.headless = isXiaohongshuUrl(inputUrl)
      ? false
      : resolveDouyinHeadlessDefault(inputUrl, DEFAULT_PIPELINE_OPTIONS.headless);
  }
  return mergePipelineOptions(mergedOptions);
}
