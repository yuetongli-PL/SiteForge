// @ts-check

import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { initializeCliUtf8, writeJsonStdout } from '../../infra/cli.mjs';
import { pathExists, readJsonFile, writeJsonFile, writeTextFile } from '../../infra/io.mjs';
import { sanitizeHost, uniqueSortedStrings } from '../../shared/normalize.mjs';
import { PROFILE_ARCHETYPES, resolveProfilePrimaryArchetype } from '../../sites/core/archetypes.mjs';
import { validateProfileObject } from '../../sites/core/profile-validation.mjs';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(MODULE_DIR, '..', '..', '..');
const DEFAULT_OPTIONS = {
  archetype: null,
  outDir: path.join(REPO_ROOT, 'runs', 'sites', 'site-scaffold'),
  profilesDir: path.join(REPO_ROOT, 'profiles'),
  profilePath: null,
  timeoutMs: 15_000,
};

const HELP = `Usage:
  node src/entrypoints/sites/site-scaffold.mjs <url> --archetype <navigation-catalog|chapter-content> [--profiles-dir <dir>] [--profile-path <path>] [--out-dir <dir>] [--timeout <ms>]
`;

const TEMPLATE_BY_ARCHETYPE = Object.freeze({
  [PROFILE_ARCHETYPES.NAVIGATION_CATALOG]: path.join(REPO_ROOT, 'profiles', 'template.navigation-catalog.json'),
  [PROFILE_ARCHETYPES.CHAPTER_CONTENT]: path.join(REPO_ROOT, 'profiles', 'template.chapter-content.json'),
});

function formatTimestampForDir(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.(\d{3})Z$/, '$1Z');
}

function normalizeArchetype(value) {
  if (value === PROFILE_ARCHETYPES.NAVIGATION_CATALOG || value === PROFILE_ARCHETYPES.CHAPTER_CONTENT) {
    return value;
  }
  return null;
}

function mergeOptions(inputUrl, options = {}) {
  const merged = { ...DEFAULT_OPTIONS, ...options };
  const parsed = new URL(inputUrl);
  const normalizedArchetype = normalizeArchetype(merged.archetype);
  if (!normalizedArchetype) {
    throw new Error('Missing or unsupported --archetype. Use navigation-catalog or chapter-content.');
  }
  merged.archetype = normalizedArchetype;
  merged.host = parsed.hostname;
  merged.baseUrl = parsed.origin.endsWith('/') ? parsed.origin : `${parsed.origin}/`;
  merged.outDir = path.resolve(merged.outDir);
  merged.profilesDir = path.resolve(merged.profilesDir);
  merged.profilePath = merged.profilePath
    ? path.resolve(merged.profilePath)
    : path.join(merged.profilesDir, `${parsed.hostname}.json`);
  merged.timeoutMs = Number(merged.timeoutMs);
  if (!Number.isFinite(merged.timeoutMs) || merged.timeoutMs <= 0) {
    throw new Error(`Invalid --timeout: ${options.timeoutMs}`);
  }
  return merged;
}

function decodeHtmlEntities(value) {
  return String(value ?? '')
    .replace(/&quot;/giu, '"')
    .replace(/&#39;/giu, '\'')
    .replace(/&amp;/giu, '&')
    .replace(/&lt;/giu, '<')
    .replace(/&gt;/giu, '>');
}

function parseAttributes(raw) {
  const attributes = {};
  const pattern = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/gu;
  let match;
  while ((match = pattern.exec(raw)) !== null) {
    const [, name, dq, sq, bare] = match;
    attributes[name.toLowerCase()] = decodeHtmlEntities(dq ?? sq ?? bare ?? '');
  }
  return attributes;
}

function extractForms(html) {
  const forms = [];
  const pattern = /<form\b([^>]*)>([\s\S]*?)<\/form>/giu;
  let match;
  while ((match = pattern.exec(html)) !== null) {
    forms.push({
      attrs: parseAttributes(match[1]),
      body: match[2],
    });
  }
  return forms;
}

function extractAnchors(html, baseUrl) {
  const hrefs = [];
  const pattern = /<a\b([^>]*)>/giu;
  let match;
  while ((match = pattern.exec(html)) !== null) {
    const attrs = parseAttributes(match[1]);
    if (!attrs.href) {
      continue;
    }
    try {
      const parsed = new URL(attrs.href, baseUrl);
      hrefs.push(parsed.toString());
    } catch {
      // Ignore malformed links in scaffold heuristics.
    }
  }
  return hrefs;
}

function extractInputs(formBody) {
  const inputs = [];
  const pattern = /<(input|button)\b([^>]*)>/giu;
  let match;
  while ((match = pattern.exec(formBody)) !== null) {
    inputs.push({
      tagName: String(match[1]).toLowerCase(),
      attrs: parseAttributes(match[2]),
    });
  }
  return inputs;
}

function buildAttributeSelector(tagName, attrs) {
  if (attrs.id) {
    return `${tagName}#${attrs.id}`;
  }
  if (attrs.name) {
    return `${tagName}[name="${attrs.name}"]`;
  }
  if (attrs.type) {
    return `${tagName}[type="${attrs.type}"]`;
  }
  return tagName;
}

function resolvePathPrefix(urlValue, patterns) {
  let pathname = '';
  try {
    pathname = new URL(urlValue).pathname || '/';
  } catch {
    return null;
  }
  const normalized = pathname.replace(/\/+/gu, '/');
  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (!match) {
      continue;
    }
    const prefix = match[1] ?? match[0];
    if (!prefix) {
      continue;
    }
    return prefix.endsWith('/') || prefix.includes('.') ? prefix : `${prefix}/`;
  }
  return null;
}

function inferNavigationPrefixes(urls) {
  const patterns = {
    searchResultsPrefixes: [
      /(\/search(?:\/[^/]+)?)/iu,
      /(\/ss\/?)/iu,
    ],
    contentPathPrefixes: [
      /(\/works\/detail\/)/iu,
      /(\/item\/)/iu,
      /(\/videos\/)/iu,
      /(\/book\/)/iu,
      /(\/novel\/)/iu,
      /(\/biqu\d+\/)/iu,
    ],
    authorPathPrefixes: [
      /(\/author\/)/iu,
      /(\/actress\/detail\/)/iu,
      /(\/models\/)/iu,
      /(\/actor\/)/iu,
    ],
    authorListPathPrefixes: [
      /(\/actress\/?$)/iu,
      /(\/models\/?$)/iu,
      /(\/authors?\/?$)/iu,
    ],
    authorDetailPathPrefixes: [
      /(\/author\/)/iu,
      /(\/actress\/detail\/)/iu,
      /(\/models\/)/iu,
      /(\/actor\/)/iu,
    ],
    categoryPathPrefixes: [
      /(\/category\/)/iu,
      /(\/categories\/)/iu,
      /(\/tags?\/)/iu,
      /(\/works\/date)/iu,
      /(\/works\/list\/)/iu,
      /(\/list\/)/iu,
      /(\/fenlei\/)/iu,
    ],
    utilityPathPrefixes: [
      /(\/help\/?)/iu,
      /(\/about\/?)/iu,
      /(\/privacy\/?)/iu,
      /(\/sitemap\/?)/iu,
      /(\/top\/?)/iu,
    ],
    authPathPrefixes: [
      /(\/login\/?)/iu,
      /(\/signup\/?)/iu,
      /(\/register\/?)/iu,
      /(\/sign-?in\/?)/iu,
      /(\/sign-?up\/?)/iu,
    ],
  };

  const inferred = {};
  for (const [key, patternList] of Object.entries(patterns)) {
    inferred[key] = uniqueSortedStrings(
      urls
        .map((urlValue) => resolvePathPrefix(urlValue, patternList))
        .filter(Boolean),
    );
  }
  return inferred;
}

function inferAllowedHosts(baseUrl, finalUrl) {
  const hosts = [];
  for (const candidate of [baseUrl, finalUrl]) {
    try {
      const parsed = new URL(candidate);
      hosts.push(parsed.hostname);
      if (!parsed.hostname.startsWith('www.')) {
        hosts.push(`www.${parsed.hostname}`);
      }
    } catch {
      // Ignore bad URLs in scaffold inference.
    }
  }
  return uniqueSortedStrings(hosts);
}

function pickSearchForm(forms) {
  return forms.find((form) => {
    const inputs = extractInputs(form.body);
    const hasSearchInput = inputs.some(({ attrs }) => {
      const name = String(attrs.name ?? '').toLowerCase();
      const type = String(attrs.type ?? '').toLowerCase();
      return type === 'search' || ['q', 'keyword', 'searchkey', 'search'].includes(name);
    });
    const action = String(form.attrs.action ?? '').toLowerCase();
    return form.attrs.role === 'search' || hasSearchInput || /search|\/ss\//iu.test(action);
  }) ?? null;
}

function inferSearchConfig(searchForm, baseUrl) {
  if (!searchForm) {
    return {
      formSelectors: [],
      inputSelectors: [],
      submitSelectors: [],
      queryParamNames: [],
      searchResultsPrefixes: [],
      warnings: ['No search form was inferred from the fetched homepage HTML.'],
    };
  }

  const inputs = extractInputs(searchForm.body);
  const searchInputs = inputs.filter(({ attrs }) => {
    const name = String(attrs.name ?? '').toLowerCase();
    const type = String(attrs.type ?? '').toLowerCase();
    return !['submit', 'button', 'hidden', 'reset'].includes(type)
      && (type === 'search' || ['q', 'keyword', 'searchkey', 'search'].includes(name) || attrs.id);
  });
  const submitControls = inputs.filter(({ tagName, attrs }) => {
    const type = String(attrs.type ?? '').toLowerCase();
    return tagName === 'button' || ['submit', 'button'].includes(type);
  });

  const formSelectors = uniqueSortedStrings([
    searchForm.attrs.id ? `form#${searchForm.attrs.id}` : null,
    searchForm.attrs.role === 'search' ? 'form[role="search"]' : null,
    (() => {
      if (!searchForm.attrs.action) {
        return null;
      }
      try {
        const parsed = new URL(searchForm.attrs.action, baseUrl);
        if (!parsed.pathname || parsed.pathname === '/') {
          return null;
        }
        return `form[action*="${parsed.pathname}"]`;
      } catch {
        return null;
      }
    })(),
  ]);

  const inputSelectors = uniqueSortedStrings(searchInputs.map(({ tagName, attrs }) => buildAttributeSelector(tagName, attrs)));
  const submitSelectors = uniqueSortedStrings(submitControls.map(({ tagName, attrs }) => buildAttributeSelector(tagName, attrs)));
  const queryParamNames = uniqueSortedStrings(searchInputs.map(({ attrs }) => attrs.name).filter(Boolean));

  let searchResultsPrefixes = [];
  if (searchForm.attrs.action) {
    try {
      const actionUrl = new URL(searchForm.attrs.action, baseUrl);
      searchResultsPrefixes = uniqueSortedStrings([actionUrl.pathname]);
    } catch {
      // Ignore unresolved form actions in scaffold heuristics.
    }
  }

  return {
    formSelectors,
    inputSelectors,
    submitSelectors,
    queryParamNames,
    searchResultsPrefixes,
    warnings: [],
  };
}

function applyNonEmpty(target, key, values) {
  if (Array.isArray(values) && values.length > 0) {
    target[key] = values;
  }
}

function buildNavigationProfile(template, settings, inference) {
  const profile = structuredClone(template);
  profile.host = settings.host;
  profile.archetype = settings.archetype;
  profile.schemaVersion = 1;
  profile.primaryArchetype = resolveProfilePrimaryArchetype(profile) ?? 'catalog-detail';

  applyNonEmpty(profile.search, 'formSelectors', inference.search.formSelectors);
  applyNonEmpty(profile.search, 'inputSelectors', inference.search.inputSelectors);
  applyNonEmpty(profile.search, 'submitSelectors', inference.search.submitSelectors);
  applyNonEmpty(profile.search, 'queryParamNames', inference.search.queryParamNames);

  applyNonEmpty(profile.pageTypes, 'searchResultsPrefixes', inference.search.searchResultsPrefixes);
  applyNonEmpty(profile.pageTypes, 'contentDetailPrefixes', inference.navigation.contentPathPrefixes);
  applyNonEmpty(profile.pageTypes, 'authorPrefixes', inference.navigation.authorPathPrefixes);
  applyNonEmpty(profile.pageTypes, 'authorListPrefixes', inference.navigation.authorListPathPrefixes);
  applyNonEmpty(profile.pageTypes, 'authorDetailPrefixes', inference.navigation.authorDetailPathPrefixes);
  applyNonEmpty(profile.pageTypes, 'categoryPrefixes', inference.navigation.categoryPathPrefixes);
  applyNonEmpty(profile.pageTypes, 'authPrefixes', inference.navigation.authPathPrefixes);

  applyNonEmpty(profile.navigation, 'allowedHosts', inference.allowedHosts);
  applyNonEmpty(profile.navigation, 'contentPathPrefixes', inference.navigation.contentPathPrefixes);
  applyNonEmpty(profile.navigation, 'authorPathPrefixes', inference.navigation.authorPathPrefixes);
  applyNonEmpty(profile.navigation, 'authorListPathPrefixes', inference.navigation.authorListPathPrefixes);
  applyNonEmpty(profile.navigation, 'authorDetailPathPrefixes', inference.navigation.authorDetailPathPrefixes);
  applyNonEmpty(profile.navigation, 'categoryPathPrefixes', inference.navigation.categoryPathPrefixes);
  applyNonEmpty(profile.navigation, 'utilityPathPrefixes', inference.navigation.utilityPathPrefixes);
  applyNonEmpty(profile.navigation, 'authPathPrefixes', inference.navigation.authPathPrefixes);

  return profile;
}

function buildChapterProfile(template, settings, inference) {
  const profile = structuredClone(template);
  profile.host = settings.host;
  profile.archetype = settings.archetype;
  profile.schemaVersion = 1;
  profile.primaryArchetype = resolveProfilePrimaryArchetype(profile) ?? 'chapter-content';

  applyNonEmpty(profile.search, 'formSelectors', inference.search.formSelectors);
  applyNonEmpty(profile.search, 'inputSelectors', inference.search.inputSelectors);
  applyNonEmpty(profile.search, 'submitSelectors', inference.search.submitSelectors);
  applyNonEmpty(profile.search, 'queryParamNames', inference.search.queryParamNames);

  const inferredDetailPrefixes = uniqueSortedStrings([
    ...inference.navigation.contentPathPrefixes,
    ...inference.navigation.categoryPathPrefixes.filter((value) => /\/biqu\d+\/?/iu.test(value)),
  ]);
  applyNonEmpty(profile.bookDetail, 'directoryLinkSelectors', inference.directoryLinkSelectors);
  applyNonEmpty(profile.bookDetail, 'chapterLinkSelectors', inference.chapterLinkSelectors);
  if (inferredDetailPrefixes.length > 0 && !profile.bookDetail.directoryPageUrlTemplate.includes('{detail_url}')) {
    profile.bookDetail.directoryPageUrlTemplate = '{detail_url}{page}/';
  }

  return profile;
}

function renderMarkdownReport(result) {
  return [
    '# Site Scaffold',
    '',
    `- URL: ${result.url}`,
    `- Host: ${result.host}`,
    `- Archetype: ${result.archetype}`,
    `- Profile path: ${result.profilePath}`,
    `- Final URL: ${result.fetch.finalUrl}`,
    `- Profile valid: ${result.profile.valid ? 'yes' : 'no'}`,
    '',
    '## Warnings',
    '',
    ...(result.warnings.length ? result.warnings.map((warning) => `- ${warning}`) : ['- none']),
    '',
    '## Next actions',
    '',
    ...(result.nextActions.length ? result.nextActions.map((step) => `- ${step}`) : ['- none']),
  ].join('\n');
}

async function fetchHomepageHtml(inputUrl, settings, deps) {
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error('Global fetch is unavailable; pass a fetchImpl dependency.');
  }
  const response = await fetchImpl(inputUrl, {
    redirect: 'follow',
    headers: {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0 Safari/537.36',
    },
    signal: AbortSignal.timeout(settings.timeoutMs),
  });
  if (!response.ok) {
    throw new Error(`Homepage fetch failed: ${response.status} ${response.statusText}`);
  }
  return {
    finalUrl: response.url || inputUrl,
    status: response.status,
    html: await response.text(),
  };
}

function buildInferenceSummary(html, baseUrl, finalUrl) {
  const forms = extractForms(html);
  const search = inferSearchConfig(pickSearchForm(forms), baseUrl);
  const hrefs = extractAnchors(html, finalUrl);
  const navigation = inferNavigationPrefixes(hrefs);
  return {
    allowedHosts: inferAllowedHosts(baseUrl, finalUrl),
    search,
    navigation,
    chapterLinkSelectors: [],
    directoryLinkSelectors: [],
  };
}

export async function scaffoldSite(inputUrl, options = {}, deps = {}) {
  const settings = mergeOptions(inputUrl, options);
  if (await pathExists(settings.profilePath)) {
    throw new Error(`Profile already exists: ${settings.profilePath}`);
  }

  const templatePath = TEMPLATE_BY_ARCHETYPE[settings.archetype];
  const template = await readJsonFile(templatePath);
  const fetch = await fetchHomepageHtml(inputUrl, settings, deps);
  const inference = buildInferenceSummary(fetch.html, settings.baseUrl, fetch.finalUrl);
  const warnings = [...inference.search.warnings];

  const profile = settings.archetype === PROFILE_ARCHETYPES.NAVIGATION_CATALOG
    ? buildNavigationProfile(template, settings, inference)
    : buildChapterProfile(template, settings, inference);
  const validation = validateProfileObject(profile, {
    expectedHost: settings.host,
    source: settings.profilePath,
  });

  const reportDir = path.join(settings.outDir, `${formatTimestampForDir()}_${sanitizeHost(settings.host)}`);
  const reportJsonPath = path.join(reportDir, 'scaffold-report.json');
  const reportMarkdownPath = path.join(reportDir, 'scaffold-report.md');
  const nextActions = [
    inference.search.formSelectors.length ? null : 'Confirm the search form selectors before running site-doctor.',
    inference.navigation.contentPathPrefixes.length ? null : 'Review content/detail path prefixes; scaffold fell back to template defaults.',
    settings.archetype === PROFILE_ARCHETYPES.CHAPTER_CONTENT ? 'Verify chapter selectors and cleanupPatterns on a real chapter page.' : null,
  ].filter(Boolean);

  const result = {
    url: inputUrl,
    host: settings.host,
    archetype: settings.archetype,
    profilePath: settings.profilePath,
    profile: {
      valid: validation.valid,
      schemaId: validation.schemaId,
      warnings: validation.warnings,
    },
    fetch: {
      status: fetch.status,
      finalUrl: fetch.finalUrl,
    },
    inference,
    warnings,
    nextActions,
    reports: {
      json: reportJsonPath,
      markdown: reportMarkdownPath,
    },
  };

  await writeJsonFile(settings.profilePath, profile);
  await writeJsonFile(reportJsonPath, result);
  await writeTextFile(reportMarkdownPath, renderMarkdownReport(result));

  return result;
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
      case '--archetype': {
        const { value, nextIndex } = readValue(index);
        options.archetype = value;
        index = nextIndex;
        break;
      }
      case '--profiles-dir': {
        const { value, nextIndex } = readValue(index);
        options.profilesDir = value;
        index = nextIndex;
        break;
      }
      case '--profile-path': {
        const { value, nextIndex } = readValue(index);
        options.profilePath = value;
        index = nextIndex;
        break;
      }
      case '--out-dir': {
        const { value, nextIndex } = readValue(index);
        options.outDir = value;
        index = nextIndex;
        break;
      }
      case '--timeout': {
        const { value, nextIndex } = readValue(index);
        options.timeoutMs = value;
        index = nextIndex;
        break;
      }
      default:
        throw new Error(`Unknown option: ${token}`);
    }
  }

  return {
    help: false,
    inputUrl,
    options,
  };
}

async function runCli() {
  initializeCliUtf8();
  const parsed = parseCliArgs(process.argv.slice(2));
  if (parsed.help) {
    process.stdout.write(`${HELP}\n`);
    return;
  }
  const result = await scaffoldSite(parsed.inputUrl, parsed.options);
  writeJsonStdout(result);
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (entryPath && entryPath === fileURLToPath(import.meta.url)) {
  runCli().catch((error) => {
    console.error(error?.message ?? String(error));
    process.exitCode = 1;
  });
}
