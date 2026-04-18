import path from 'node:path';
import process from 'node:process';

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

export function toBoolean(value, flagName) {
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

  merged.timeoutMs = Number(merged.timeoutMs);
  merged.idleMs = Number(merged.idleMs);
  merged.maxTriggers = Number(merged.maxTriggers);
  if (merged.maxCapturedStates !== undefined && merged.maxCapturedStates !== null) {
    merged.maxCapturedStates = Number(merged.maxCapturedStates);
  }
  merged.searchQueries = Array.isArray(merged.searchQueries)
    ? merged.searchQueries.map((value) => normalizeWhitespace(value)).filter(Boolean)
    : (merged.searchQueries ? [normalizeWhitespace(merged.searchQueries)].filter(Boolean) : []);
  merged.headless = toBoolean(merged.headless, 'headless');
  merged.fullPage = toBoolean(merged.fullPage, 'fullPage');
  merged.strict = toBoolean(merged.strict, 'strict');
  if (merged.reuseLoginState !== undefined) {
    merged.reuseLoginState = toBoolean(merged.reuseLoginState, 'reuseLoginState');
  }
  if (merged.autoLogin !== undefined) {
    merged.autoLogin = toBoolean(merged.autoLogin, 'autoLogin');
  }
  merged.skillName = resolveSkillName(options.url ?? '', merged.skillName);
  return merged;
}

export function normalizePipelineOptions(inputUrl, options = {}) {
  return mergePipelineOptions({ ...options, url: inputUrl });
}
