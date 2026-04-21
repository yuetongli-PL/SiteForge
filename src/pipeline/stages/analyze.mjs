import { createHash } from 'node:crypto';
import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { enrichBilibiliPageFactsForState } from '../../sites/bilibili/model/surfacing.mjs';
import { initializeCliUtf8 } from '../../infra/cli.mjs';
import { cleanText } from '../../shared/normalize.mjs';
import { buildRunManifest } from '../engine/run-manifest.mjs';
import { inferPageTypeFromUrl, isContentDetailPageType, toSemanticPageType } from '../../sites/core/page-types.mjs';
import { normalizeDisplayLabel } from '../../sites/core/terminology.mjs';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_OPTIONS = {
  statesManifestPath: undefined,
  expandedStatesDir: undefined,
  bookContentManifestPath: undefined,
  bookContentDir: undefined,
  outDir: path.resolve(process.cwd(), 'state-analysis'),
};

const TOP_LEVEL_MANIFEST_NAMES = ['states-manifest.json', 'state-manifest.json'];
const SNAPSHOT_FILE_NAMES = ['dom-snapshot.json', 'dom_snapshot.json'];
const HTML_FILE_NAME = 'page.html';
const SCREENSHOT_FILE_NAME = 'screenshot.png';
const STATE_MANIFEST_FILE_NAME = 'manifest.json';
const BOOK_CONTENT_MANIFEST_NAME = 'book-content-manifest.json';
const BOOK_CONTENT_FILE_NAMES = {
  books: 'books.json',
  authors: 'authors.json',
  searchResults: 'search-results.json',
};
const CONCRETE_STATUSES = new Set(['initial', 'captured']);
const EDGE_STATUSES = new Set(['captured', 'duplicate', 'noop', 'failed']);
const MENU_POPUP_VALUES = new Set(['menu', 'listbox']);
const NAVIGATION_ELEMENT_KINDS = new Set([
  'category-link-group',
  'content-link-group',
  'author-link-group',
  'chapter-link-group',
  'utility-link-group',
  'auth-link-group',
  'pagination-link-group',
  'form-submit-group',
  'search-form-group',
]);
let ACTIVE_SITE_PROFILE = null;

function createSha256(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function normalizeWhitespace(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeText(value) {
  return normalizeWhitespace(String(value ?? '').normalize('NFKC'));
}

function normalizeLabel(value) {
  return normalizeText(value).toLowerCase();
}

function formatTimestampForDir(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.(\d{3})Z$/, '$1Z');
}

function sanitizeHost(host) {
  return (host || 'unknown-host').replace(/[^a-zA-Z0-9.-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'unknown-host';
}

function compareNullableStrings(left, right) {
  return String(left ?? '').localeCompare(String(right ?? ''), 'en');
}

function firstNonEmpty(values) {
  for (const value of values) {
    if (value === undefined || value === null) {
      continue;
    }
    const normalized = normalizeWhitespace(value);
    if (normalized) {
      return normalized;
    }
  }
  return null;
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function hasHiddenStyle(style) {
  return /\bdisplay\s*:\s*none\b/i.test(style) || /\bvisibility\s*:\s*hidden\b/i.test(style);
}

function resolveMaybeRelative(inputPath, baseDir) {
  if (!inputPath) {
    return null;
  }
  return path.isAbsolute(inputPath) ? inputPath : path.resolve(baseDir, inputPath);
}

async function pathExists(targetPath) {
  if (!targetPath) {
    return false;
  }

  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonFile(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function writeJsonFile(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function buildWarning(code, message, details = {}) {
  return {
    code,
    message,
    ...details,
  };
}

function buildGroupIdentity({ id, controlledTarget, label, domPath }) {
  if (id) {
    return `id:${id}`;
  }
  if (controlledTarget) {
    return `target:${controlledTarget}`;
  }
  const normalized = normalizeLabel(label);
  if (normalized) {
    return `label:${normalized}`;
  }
  return `path:${domPath}`;
}

function buildMemberMatchKey({ id, controlledTarget, label, domPath }) {
  return buildGroupIdentity({ id, controlledTarget, label, domPath });
}

function compareStates(left, right) {
  return compareNullableStrings(left.stateId, right.stateId);
}

function compareElements(left, right) {
  return compareNullableStrings(left.kind, right.kind)
    || compareNullableStrings(left.elementName, right.elementName)
    || compareNullableStrings(left.elementId, right.elementId);
}

function compareMembers(left, right) {
  return (left.order ?? Number.MAX_SAFE_INTEGER) - (right.order ?? Number.MAX_SAFE_INTEGER)
    || compareNullableStrings(left.label, right.label)
    || compareNullableStrings(left.memberId, right.memberId);
}

function compareEdges(left, right) {
  return compareNullableStrings(left.fromState, right.fromState)
    || compareNullableStrings(left.observedStateId, right.observedStateId);
}

function boolFromAriaValue(value) {
  return String(value ?? '').toLowerCase() === 'true';
}

function kindTitle(kind) {
  const siteHost = String(ACTIVE_SITE_PROFILE?.host ?? '').toLowerCase();
  if (siteHost === 'jable.tv') {
    switch (kind) {
      case 'category-link-group':
        return '分类链接';
      case 'content-link-group':
        return '影片链接';
      case 'author-link-group':
        return '演员链接';
      case 'utility-link-group':
        return '功能入口';
      case 'search-form-group':
        return '搜索表单';
      default:
        break;
    }
  }
  switch (kind) {
    case 'tab-group':
      return 'Tab Group';
    case 'details-toggle':
      return 'Details Toggle';
    case 'expanded-toggle':
      return 'Expanded Toggle';
    case 'menu-button':
      return 'Menu Button';
    case 'dialog-open':
      return 'Dialog Open';
    case 'category-link-group':
      return 'Category Links';
    case 'content-link-group':
      return 'Content Links';
    case 'author-link-group':
      return 'Author Links';
    case 'chapter-link-group':
      return 'Chapter Links';
    case 'utility-link-group':
      return 'Utility Links';
    case 'auth-link-group':
      return 'Auth Links';
    case 'pagination-link-group':
      return 'Pagination Links';
    case 'form-submit-group':
      return 'Form Submit';
    case 'search-form-group':
      return 'Search Form';
    default:
      return 'Element';
  }
}

function normalizeUrlNoFragment(input) {
  if (!input) {
    return null;
  }
  try {
    const parsed = new URL(input);
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return String(input).split('#')[0];
  }
}

function normalizePathname(input) {
  const normalized = normalizeUrlNoFragment(input);
  if (!normalized) {
    return '/';
  }
  try {
    const parsed = new URL(normalized);
    return parsed.pathname || '/';
  } catch {
    return String(normalized || '/');
  }
}

function decodeHtmlEntities(input) {
  return String(input ?? '')
    .replace(/&nbsp;/giu, ' ')
    .replace(/&amp;/giu, '&')
    .replace(/&quot;/giu, '"')
    .replace(/&#39;/giu, '\'')
    .replace(/&lt;/giu, '<')
    .replace(/&gt;/giu, '>');
}

function stripHtmlTags(input) {
  return String(input ?? '').replace(/<[^>]+>/gu, ' ');
}

function normalizeJableTaxonomyLabel(value) {
  let text = cleanText(decodeHtmlEntities(stripHtmlTags(value)));
  if (/(按主題|按女優|新片優先|熱度優先|藍光無碼|成人直播|色網大全|更多好站|裸聊|無修正動画)/u.test(text) && /\s/u.test(text)) {
    text = text.split(/\s+/u).filter(Boolean).at(-1) ?? text;
  }
  return normalizeDisplayLabel(text, {
    siteContext: ACTIVE_SITE_PROFILE,
    inputUrl: ACTIVE_SITE_PROFILE?.baseUrl ?? ACTIVE_SITE_PROFILE?.inputUrl ?? null,
    url: ACTIVE_SITE_PROFILE?.baseUrl ?? ACTIVE_SITE_PROFILE?.inputUrl ?? null,
    pageType: 'category-page',
    kind: 'category-link-group',
  }) || text;
}

function extractJableCategoryTaxonomyFromHtml(html, pageUrl) {
  if (!html || !/jable\.tv\/categories\//iu.test(String(pageUrl ?? ''))) {
    return [];
  }

  const groups = [];
  const groupPattern = /<div class="title-box">\s*<h2 class="h3-md">([\s\S]*?)<\/h2>\s*<\/div>\s*<div class="row gutter-20 pb-3">([\s\S]*?)(?=<div class="title-box">|<\/nav>)/giu;
  for (const match of html.matchAll(groupPattern)) {
    const groupLabel = normalizeJableTaxonomyLabel(match[1]);
    if (!groupLabel || groupLabel === '選片') {
      continue;
    }

    const tags = [];
    const tagPattern = /<a class="tag text-light" href="([^"]+)">([\s\S]*?)<\/a>/giu;
    for (const tagMatch of match[2].matchAll(tagPattern)) {
      const href = normalizeUrlNoFragment(new URL(decodeHtmlEntities(tagMatch[1]), pageUrl).toString());
      const label = normalizeJableTaxonomyLabel(tagMatch[2]);
      if (!href || !label) {
        continue;
      }
      tags.push({
        label,
        href,
      });
    }

    const dedupedTags = [];
    const seenHrefs = new Set();
    for (const tag of tags) {
      if (seenHrefs.has(tag.href)) {
        continue;
      }
      seenHrefs.add(tag.href);
      dedupedTags.push(tag);
    }
    if (dedupedTags.length === 0) {
      continue;
    }

    groups.push({
      groupLabel,
      tags: dedupedTags,
    });
  }

  return groups;
}

async function loadSiteProfile(baseUrl) {
  try {
    const parsed = new URL(baseUrl);
    const hostnames = [parsed.hostname];
    if (parsed.hostname.startsWith('www.')) {
      hostnames.push(parsed.hostname.slice(4));
    } else {
      hostnames.push(`www.${parsed.hostname}`);
    }
    for (const hostname of hostnames) {
      const profilePath = path.join(MODULE_DIR, 'profiles', `${hostname}.json`);
      if (await pathExists(profilePath)) {
        return await readJsonFile(profilePath);
      }
    }
    return null;
  } catch {
    return null;
  }
}

function inferStateType(pageType, elementStates) {
  if (pageType === 'auth-page') {
    return 'auth-form';
  }
  if (pageType === 'home' || pageType === 'category-page' || pageType === 'author-list-page' || isContentDetailPageType(pageType) || pageType === 'author-page' || pageType === 'history-page' || pageType === 'search-results-page' || pageType === 'chapter-page') {
    return 'navigation';
  }
  if (toArray(elementStates).some((elementState) => ['tab-group', 'details-toggle', 'expanded-toggle', 'menu-button', 'dialog-open'].includes(elementState.kind))) {
    return 'in-page-state';
  }
  return 'unknown';
}

function safeNodeLabel(value, fallback) {
  return firstNonEmpty([value, fallback]) || null;
}

function cleanupCanonicalTitleChunk(value) {
  const normalized = normalizeWhitespace(value);
  if (!normalized) {
    return null;
  }

  let result = normalized
    .replace(/^[\s"'“”‘’《》【】\[\](){}<>]+|[\s"'“”‘’《》【】\[\](){}<>]+$/g, '')
    .replace(/[（(][^)）]{1,40}[）)]$/u, '')
    .trim();

  const openParenIndex = result.search(/[（(]/u);
  if (openParenIndex > 0) {
    const prefix = result.slice(0, openParenIndex).trim();
    if (prefix.length >= 2) {
      result = prefix;
    }
  }

  if (!result) {
    return null;
  }

  if (result.length > 48) {
    result = result.slice(0, 48).trim();
  }

  return result || null;
}

function extractTitleLead(title) {
  const normalized = normalizeWhitespace(title);
  if (!normalized) {
    return null;
  }

  const separators = ['_', '|', '｜', '丨', ' - ', ' – ', ' — ', '——', '－'];
  for (const separator of separators) {
    if (normalized.includes(separator)) {
      return cleanupCanonicalTitleChunk(normalized.split(separator)[0]);
    }
  }

  return cleanupCanonicalTitleChunk(normalized);
}

function extractCanonicalLabelFromState(stateRecord, kind) {
  const pageType = inferPageTypeFromUrl(stateRecord?.finalUrl, ACTIVE_SITE_PROFILE);
  if (String(ACTIVE_SITE_PROFILE?.host ?? '').toLowerCase() === 'jable.tv') {
    const normalizedFromState = normalizeDisplayLabel(stateRecord?.title, {
      siteContext: ACTIVE_SITE_PROFILE,
      inputUrl: stateRecord?.inputUrl ?? stateRecord?.finalUrl ?? null,
      url: stateRecord?.finalUrl ?? null,
      pageType,
      queryText: stateRecord?.pageFacts?.queryText ?? null,
      kind,
    });
    if (kind === 'category-link-group' && pageType === 'author-list-page') {
      return normalizedFromState ?? '演员列表';
    }
    if (normalizedFromState && ['category-link-group', 'author-link-group', 'content-link-group'].includes(kind)) {
      return normalizedFromState;
    }
  }
  if (kind === 'content-link-group' && isContentDetailPageType(pageType)) {
    return extractTitleLead(stateRecord?.title);
  }

  if (kind === 'author-link-group' && pageType === 'author-page') {
    return extractTitleLead(stateRecord?.title);
  }

  if (kind === 'category-link-group' && pageType === 'category-page') {
    const lead = extractTitleLead(stateRecord?.title);
    if (lead && !/好看的/i.test(lead)) {
      return lead;
    }
  }

  if (kind === 'auth-link-group' && pageType === 'auth-page') {
    const lead = extractTitleLead(stateRecord?.title);
    if (lead && !/笔趣阁|绗旇叮闃?/i.test(lead)) {
      return lead;
    }
  }

  return null;
}

function summarizeForStdout(analysisManifest) {
  return {
    analyzedStates: analysisManifest.summary.analyzedStates,
    elementGroups: analysisManifest.summary.elementGroups,
    elementMembers: analysisManifest.summary.elementMembers,
    transitionEdges: analysisManifest.summary.transitionEdges,
    primaryArchetype: analysisManifest.summary.primaryArchetype,
    outDir: analysisManifest.outDir,
  };
}

class SnapshotContext {
  constructor(snapshot, stateId) {
    const strings = Array.isArray(snapshot?.strings) ? snapshot.strings : null;
    const document = Array.isArray(snapshot?.documents) ? snapshot.documents[0] : null;
    const nodes = document?.nodes;

    if (!strings || !document || !nodes || !Array.isArray(nodes.nodeName) || !Array.isArray(nodes.parentIndex)) {
      throw new Error(`State ${stateId} snapshot is missing DOMSnapshot documents[0].nodes`);
    }

    this.stateId = stateId;
    this.strings = strings;
    this.document = document;
    this.nodes = nodes;
    this.nodeCount = nodes.nodeName.length;
    this.children = Array.from({ length: this.nodeCount }, () => []);
    this.attrsCache = new Array(this.nodeCount);
    this.textCache = new Array(this.nodeCount);
    this.domPathCache = new Array(this.nodeCount);
    this.idIndex = new Map();

    for (let index = 0; index < this.nodeCount; index += 1) {
      const parentIndex = this.parentIndexOf(index);
      if (parentIndex >= 0 && parentIndex < this.nodeCount) {
        this.children[parentIndex].push(index);
      }
    }

    for (let index = 0; index < this.nodeCount; index += 1) {
      const attrs = this.attrsAt(index);
      if (attrs.id && !this.idIndex.has(attrs.id)) {
        this.idIndex.set(attrs.id, index);
      }
    }
  }

  stringAt(index) {
    return typeof index === 'number' && index >= 0 ? this.strings[index] ?? '' : '';
  }

  nodeNameAt(index) {
    return this.stringAt(this.nodes.nodeName[index]);
  }

  nodeValueAt(index) {
    return this.stringAt(this.nodes.nodeValue?.[index]);
  }

  parentIndexOf(index) {
    return this.nodes.parentIndex?.[index] ?? -1;
  }

  attrsAt(index) {
    if (this.attrsCache[index]) {
      return this.attrsCache[index];
    }

    const encoded = this.nodes.attributes?.[index] ?? [];
    const attrs = {};
    for (let position = 0; position < encoded.length; position += 2) {
      const name = this.stringAt(encoded[position]);
      const value = this.stringAt(encoded[position + 1]);
      if (name) {
        attrs[name] = value;
      }
    }

    this.attrsCache[index] = attrs;
    return attrs;
  }

  childrenOf(index) {
    return this.children[index] ?? [];
  }

  textOf(index) {
    if (this.textCache[index] !== undefined) {
      return this.textCache[index];
    }

    const pieces = [];
    const ownValue = normalizeWhitespace(this.nodeValueAt(index));
    if (ownValue) {
      pieces.push(ownValue);
    }

    for (const childIndex of this.childrenOf(index)) {
      const childText = this.textOf(childIndex);
      if (childText) {
        pieces.push(childText);
      }
    }

    const result = normalizeWhitespace(pieces.join(' '));
    this.textCache[index] = result;
    return result;
  }

  domPathOf(index) {
    if (this.domPathCache[index]) {
      return this.domPathCache[index];
    }

    const segments = [];
    let current = index;
    while (current >= 0) {
      const nodeName = this.nodeNameAt(current);
      if (nodeName && !nodeName.startsWith('#')) {
        const parentIndex = this.parentIndexOf(current);
        let nth = 1;
        if (parentIndex >= 0) {
          for (const siblingIndex of this.childrenOf(parentIndex)) {
            if (this.nodeNameAt(siblingIndex) === nodeName) {
              if (siblingIndex === current) {
                break;
              }
              nth += 1;
            }
          }
        }
        segments.push(`${nodeName.toLowerCase()}:nth-of-type(${nth})`);
      }
      current = this.parentIndexOf(current);
    }

    const pathValue = segments.reverse().join(' > ');
    this.domPathCache[index] = pathValue;
    return pathValue;
  }

  findById(id) {
    return id ? this.idIndex.get(id) ?? null : null;
  }

  firstControlledId(attrs) {
    const raw = attrs?.['aria-controls'];
    if (!raw) {
      return null;
    }
    const [firstId] = String(raw).split(/\s+/).filter(Boolean);
    return firstId || null;
  }

  nearestAncestor(index, predicate) {
    let current = this.parentIndexOf(index);
    while (current >= 0) {
      if (predicate(current, this.attrsAt(current))) {
        return current;
      }
      current = this.parentIndexOf(current);
    }
    return null;
  }

  isNodeVisible(index) {
    if (index === null || index === undefined || index < 0 || index >= this.nodeCount) {
      return false;
    }

    let current = index;
    while (current >= 0) {
      const attrs = this.attrsAt(current);
      if (Object.hasOwn(attrs, 'hidden')) {
        return false;
      }
      if (String(attrs['aria-hidden'] ?? '').toLowerCase() === 'true') {
        return false;
      }
      if (hasHiddenStyle(String(attrs.style ?? ''))) {
        return false;
      }
      current = this.parentIndexOf(current);
    }

    return true;
  }

  isTargetVisible(index) {
    if (index === null || index === undefined || index < 0 || index >= this.nodeCount) {
      return false;
    }
    if (!this.isNodeVisible(index)) {
      return false;
    }
    const attrs = this.attrsAt(index);
    const nodeName = this.nodeNameAt(index);
    const role = attrs.role ?? '';
    if (nodeName === 'DIALOG') {
      return Object.hasOwn(attrs, 'open');
    }
    if (Object.hasOwn(attrs, 'popover')) {
      return true;
    }
    if (role === 'menu' || role === 'listbox' || role === 'tabpanel') {
      return true;
    }
    return true;
  }
}

async function detectTopLevelManifest(expandedStatesDir) {
  for (const name of TOP_LEVEL_MANIFEST_NAMES) {
    const candidate = path.join(expandedStatesDir, name);
    if (await pathExists(candidate)) {
      return candidate;
    }
  }
  return null;
}

async function indexStateDirectories(expandedStatesDir) {
  const statesDir = path.join(expandedStatesDir, 'states');
  const result = new Map();
  if (!(await pathExists(statesDir))) {
    return result;
  }

  const entries = await readdir(statesDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const [stateId] = entry.name.split('_');
    if (!stateId || result.has(stateId)) {
      continue;
    }
    result.set(stateId, path.join(statesDir, entry.name));
  }
  return result;
}

async function firstExistingPath(candidates) {
  for (const candidate of candidates) {
    if (!candidate?.value) {
      continue;
    }
    const resolved = resolveMaybeRelative(candidate.value, candidate.baseDir);
    if (await pathExists(resolved)) {
      return resolved;
    }
  }
  return null;
}

async function resolveManifestInput(options) {
  const statesManifestPath = options.statesManifestPath || options.stateManifestPath;
  if (statesManifestPath) {
    const manifestPath = path.resolve(statesManifestPath);
    if (!(await pathExists(manifestPath))) {
      throw new Error(`States manifest not found: ${manifestPath}`);
    }
    return {
      manifestPath,
      expandedStatesDir: path.dirname(manifestPath),
    };
  }

  if (!options.expandedStatesDir) {
    throw new Error('Pass statesManifestPath, stateManifestPath, --states-manifest, --state-manifest, or --expanded-dir.');
  }

  const expandedStatesDir = path.resolve(options.expandedStatesDir);
  if (!(await pathExists(expandedStatesDir))) {
    throw new Error(`Expanded states directory not found: ${expandedStatesDir}`);
  }

  const manifestPath = await detectTopLevelManifest(expandedStatesDir);
  if (!manifestPath) {
    throw new Error(`No states-manifest.json or state-manifest.json found under ${expandedStatesDir}`);
  }

  return {
    manifestPath,
    expandedStatesDir,
  };
}

async function resolveBookContentInput(options, warnings) {
  const explicitManifest = options.bookContentManifestPath;
  const explicitDir = options.bookContentDir;
  if (!explicitManifest && !explicitDir) {
    return null;
  }

  let bookContentManifestPath = null;
  let bookContentDir = null;

  if (explicitManifest) {
    bookContentManifestPath = path.resolve(explicitManifest);
    if (!(await pathExists(bookContentManifestPath))) {
      warnings.push(buildWarning('book_content_manifest_missing', `Book content manifest not found: ${bookContentManifestPath}`));
      return null;
    }
    bookContentDir = path.dirname(bookContentManifestPath);
  } else {
    bookContentDir = path.resolve(explicitDir);
    if (!(await pathExists(bookContentDir))) {
      warnings.push(buildWarning('book_content_dir_missing', `Book content directory not found: ${bookContentDir}`));
      return null;
    }
    const candidateManifest = path.join(bookContentDir, BOOK_CONTENT_MANIFEST_NAME);
    if (!(await pathExists(candidateManifest))) {
      warnings.push(buildWarning('book_content_manifest_missing', `Missing ${BOOK_CONTENT_MANIFEST_NAME} under ${bookContentDir}`));
      return null;
    }
    bookContentManifestPath = candidateManifest;
  }

  try {
    const manifest = await readJsonFile(bookContentManifestPath);
    const booksPath = await firstExistingPath([
      { value: manifest?.files?.books, baseDir: bookContentDir },
      { value: path.join(bookContentDir, BOOK_CONTENT_FILE_NAMES.books), baseDir: bookContentDir },
    ]);
    const authorsPath = await firstExistingPath([
      { value: manifest?.files?.authors, baseDir: bookContentDir },
      { value: path.join(bookContentDir, BOOK_CONTENT_FILE_NAMES.authors), baseDir: bookContentDir },
    ]);
    const searchResultsPath = await firstExistingPath([
      { value: manifest?.files?.searchResults, baseDir: bookContentDir },
      { value: path.join(bookContentDir, BOOK_CONTENT_FILE_NAMES.searchResults), baseDir: bookContentDir },
    ]);

    return {
      bookContentDir,
      bookContentManifestPath,
      manifest,
      booksPath,
      authorsPath,
      searchResultsPath,
      booksDocument: booksPath ? await readJsonFile(booksPath) : [],
      authorsDocument: authorsPath ? await readJsonFile(authorsPath) : [],
      searchResultsDocument: searchResultsPath ? await readJsonFile(searchResultsPath) : [],
    };
  } catch (error) {
    warnings.push(buildWarning('book_content_parse_failed', `Failed to parse book content artifacts: ${error.message}`, {
      bookContentManifestPath,
    }));
    return null;
  }
}

function mergeStateMetadata(topLevelState, perStateManifest) {
  return {
    stateId: topLevelState.state_id ?? perStateManifest?.state_id ?? null,
    fromState: topLevelState.from_state ?? perStateManifest?.from_state ?? null,
    stateName: topLevelState.state_name ?? perStateManifest?.state_name ?? null,
    dedupKey: topLevelState.dedup_key ?? perStateManifest?.dedup_key ?? null,
    trigger: topLevelState.trigger ?? perStateManifest?.trigger ?? null,
    finalUrl: topLevelState.finalUrl ?? topLevelState.final_url ?? perStateManifest?.finalUrl ?? perStateManifest?.final_url ?? null,
    title: topLevelState.title ?? perStateManifest?.title ?? null,
    capturedAt: topLevelState.capturedAt ?? topLevelState.captured_at ?? perStateManifest?.capturedAt ?? perStateManifest?.captured_at ?? null,
    status: topLevelState.status ?? perStateManifest?.status ?? null,
    outDir: topLevelState.outDir ?? topLevelState.out_dir ?? perStateManifest?.outDir ?? perStateManifest?.out_dir ?? null,
    pageFacts: topLevelState.pageFacts ?? topLevelState.page_facts ?? perStateManifest?.pageFacts ?? perStateManifest?.page_facts ?? null,
  };
}

async function loadPerStateManifest(topLevelState, topManifestDir, stateDir, warnings, stateId) {
  const manifestPath = await firstExistingPath([
    { value: topLevelState?.files?.manifest, baseDir: topManifestDir },
    { value: path.join(stateDir ?? '', STATE_MANIFEST_FILE_NAME), baseDir: stateDir ?? topManifestDir },
  ]);

  if (!manifestPath) {
    return { manifestPath: null, manifest: null };
  }

  try {
    return {
      manifestPath,
      manifest: await readJsonFile(manifestPath),
    };
  } catch (error) {
    warnings.push(buildWarning('state_manifest_parse_failed', `Failed to parse state manifest for ${stateId}: ${error.message}`, {
      stateId,
      manifestPath,
    }));
    return { manifestPath, manifest: null };
  }
}

async function resolveStateFiles({ topLevelState, perStateManifest, topManifestDir, stateDir }) {
  const perStateDir = stateDir ?? (perStateManifest?.outDir ? path.resolve(perStateManifest.outDir) : null);
  const perStateBaseDir = perStateDir ?? topManifestDir;

  const manifestPath = await firstExistingPath([
    { value: topLevelState?.files?.manifest, baseDir: topManifestDir },
    { value: perStateManifest?.files?.manifest, baseDir: perStateBaseDir },
    { value: path.join(perStateDir ?? '', STATE_MANIFEST_FILE_NAME), baseDir: perStateBaseDir },
  ]);

  const htmlPath = await firstExistingPath([
    { value: topLevelState?.files?.html, baseDir: topManifestDir },
    { value: perStateManifest?.files?.html, baseDir: perStateBaseDir },
    { value: path.join(perStateDir ?? '', HTML_FILE_NAME), baseDir: perStateBaseDir },
  ]);

  const snapshotPath = await firstExistingPath([
    { value: topLevelState?.files?.snapshot, baseDir: topManifestDir },
    { value: perStateManifest?.files?.snapshot, baseDir: perStateBaseDir },
    ...SNAPSHOT_FILE_NAMES.map((fileName) => ({
      value: path.join(perStateDir ?? '', fileName),
      baseDir: perStateBaseDir,
    })),
  ]);

  const screenshotPath = await firstExistingPath([
    { value: topLevelState?.files?.screenshot, baseDir: topManifestDir },
    { value: perStateManifest?.files?.screenshot, baseDir: perStateBaseDir },
    { value: path.join(perStateDir ?? '', SCREENSHOT_FILE_NAME), baseDir: perStateBaseDir },
  ]);

  return {
    html: htmlPath,
    snapshot: snapshotPath,
    screenshot: screenshotPath,
    manifest: manifestPath,
  };
}

function isConcreteStateRecord(stateRecord) {
  return CONCRETE_STATUSES.has(stateRecord.status);
}

function hasCompleteEvidence(stateRecord) {
  return Boolean(
    stateRecord.files.html
      && stateRecord.files.snapshot
      && stateRecord.files.screenshot
      && stateRecord.finalUrl
      && stateRecord.title
      && stateRecord.capturedAt,
  );
}

async function normalizeSourceStates(topManifest, manifestPath, expandedStatesDir, warnings) {
  const topManifestDir = path.dirname(manifestPath);
  const stateDirs = await indexStateDirectories(expandedStatesDir);
  const normalized = [];

  for (const topLevelState of toArray(topManifest.states)) {
    const stateId = topLevelState.state_id ?? topLevelState.stateId;
    const stateDir = stateId ? stateDirs.get(stateId) ?? null : null;
    const { manifest: perStateManifest, manifestPath: perStateManifestPath } = await loadPerStateManifest(
      topLevelState,
      topManifestDir,
      stateDir,
      warnings,
      stateId,
    );
    const metadata = mergeStateMetadata(topLevelState, perStateManifest);
    const files = await resolveStateFiles({
      topLevelState,
      perStateManifest,
      topManifestDir,
      stateDir,
    });

    normalized.push({
      ...metadata,
      stateDir,
      files: {
        ...files,
        manifest: files.manifest ?? perStateManifestPath,
      },
      rawState: topLevelState,
    });
  }

  return normalized;
}

function candidateMatchesTrigger(trigger, candidate) {
  const locator = trigger?.locator;
  if (!locator) {
    return false;
  }
  if (locator.id && (locator.id === candidate.nodeId || locator.id === candidate.controlledTarget)) {
    return true;
  }
  if (locator.ariaControls && locator.ariaControls === candidate.controlledTarget) {
    return true;
  }
  const triggerLabel = normalizeLabel(trigger.label || locator.label || locator.textSnippet);
  if (triggerLabel && triggerLabel === candidate.labelNormalized) {
    return true;
  }
  return locator.domPath ? locator.domPath === candidate.domPath : false;
}

function buildTabGroupKey(context, index) {
  const tablistIndex = context.nearestAncestor(index, (_ancestorIndex, attrs) => attrs.role === 'tablist');
  if (tablistIndex !== null) {
    const attrs = context.attrsAt(tablistIndex);
    if (attrs.id) {
      return `tab-group::tablist-id:${attrs.id}`;
    }
    return `tab-group::tablist-path:${context.domPathOf(tablistIndex)}`;
  }

  const parentIndex = context.parentIndexOf(index);
  const parentPath = parentIndex >= 0 ? context.domPathOf(parentIndex) : context.domPathOf(index);
  return `tab-group::parent-path:${parentPath}`;
}

function buildTabCandidate(stateRecord, context, index) {
  const attrs = context.attrsAt(index);
  const controlledTarget = context.firstControlledId(attrs);
  const targetIndex = context.findById(controlledTarget);
  const label = safeNodeLabel(
    firstNonEmpty([context.textOf(index), attrs['aria-label'], attrs.title]),
    attrs.id || context.domPathOf(index),
  );

  const candidate = {
    kind: 'tab-group',
    nodeId: attrs.id || null,
    label,
    labelNormalized: normalizeLabel(label),
    groupKey: buildTabGroupKey(context, index),
    matchKey: buildMemberMatchKey({
      id: attrs.id || null,
      controlledTarget,
      label,
      domPath: context.domPathOf(index),
    }),
    controlledTarget,
    domPath: context.domPathOf(index),
    locator: null,
    matchedTriggerKind: null,
    sourceStateId: stateRecord.stateId,
    order: index,
    isActive: boolFromAriaValue(attrs['aria-selected']),
    targetVisible: context.isTargetVisible(targetIndex),
  };

  if (candidateMatchesTrigger(stateRecord.trigger, candidate)) {
    candidate.locator = stateRecord.trigger?.locator ?? null;
    candidate.matchedTriggerKind = stateRecord.trigger?.kind ?? null;
  }

  return candidate;
}

function buildDetailsCandidate(stateRecord, context, detailsIndex, summaryIndex) {
  const detailsAttrs = context.attrsAt(detailsIndex);
  const summaryAttrs = context.attrsAt(summaryIndex);
  const label = safeNodeLabel(
    firstNonEmpty([context.textOf(summaryIndex), summaryAttrs['aria-label'], detailsAttrs['aria-label']]),
    summaryAttrs.id || detailsAttrs.id || context.domPathOf(summaryIndex),
  );
  const controlledTarget = detailsAttrs.id || null;
  const domPath = context.domPathOf(summaryIndex);

  const candidate = {
    kind: 'details-toggle',
    nodeId: summaryAttrs.id || detailsAttrs.id || null,
    label,
    labelNormalized: normalizeLabel(label),
    groupKey: `details-toggle::${buildGroupIdentity({
      id: summaryAttrs.id || detailsAttrs.id || null,
      controlledTarget,
      label,
      domPath,
    })}`,
    matchKey: buildGroupIdentity({
      id: summaryAttrs.id || detailsAttrs.id || null,
      controlledTarget,
      label,
      domPath,
    }),
    controlledTarget,
    domPath,
    locator: null,
    matchedTriggerKind: null,
    sourceStateId: stateRecord.stateId,
    order: summaryIndex,
    open: Object.hasOwn(detailsAttrs, 'open'),
    targetVisible: Object.hasOwn(detailsAttrs, 'open') && context.isNodeVisible(detailsIndex),
  };

  if (candidateMatchesTrigger(stateRecord.trigger, candidate)) {
    candidate.locator = stateRecord.trigger?.locator ?? null;
    candidate.matchedTriggerKind = stateRecord.trigger?.kind ?? null;
  }

  return candidate;
}

function classifyControlKind(context, index, attrs) {
  if (!context.isNodeVisible(index)) {
    return null;
  }

  const nodeName = context.nodeNameAt(index);
  if (nodeName === 'SUMMARY' || attrs.role === 'tab') {
    return null;
  }

  const controlledTarget = context.firstControlledId(attrs);
  const targetIndex = context.findById(controlledTarget);
  const targetAttrs = targetIndex !== null ? context.attrsAt(targetIndex) : {};
  const hasPopup = String(attrs['aria-haspopup'] ?? '').toLowerCase();
  const targetRole = String(targetAttrs.role ?? '').toLowerCase();
  const targetNodeName = targetIndex !== null ? context.nodeNameAt(targetIndex) : '';

  if (hasPopup === 'dialog' || targetNodeName === 'DIALOG') {
    return 'dialog-open';
  }

  if (
    MENU_POPUP_VALUES.has(hasPopup)
    || targetRole === 'menu'
    || targetRole === 'listbox'
    || Object.hasOwn(targetAttrs, 'popover')
  ) {
    return 'menu-button';
  }

  if (Object.hasOwn(attrs, 'aria-expanded') || Object.hasOwn(attrs, 'aria-controls')) {
    return 'expanded-toggle';
  }

  return null;
}

function buildGenericCandidate(stateRecord, context, index, kind) {
  const attrs = context.attrsAt(index);
  const controlledTarget = context.firstControlledId(attrs);
  const targetIndex = context.findById(controlledTarget);
  const targetAttrs = targetIndex !== null ? context.attrsAt(targetIndex) : {};
  const label = safeNodeLabel(
    firstNonEmpty([context.textOf(index), attrs['aria-label'], attrs.title]),
    attrs.id || controlledTarget || context.domPathOf(index),
  );
  const domPath = context.domPathOf(index);
  const identity = buildGroupIdentity({
    id: attrs.id || null,
    controlledTarget,
    label,
    domPath,
  });

  const candidate = {
    kind,
    nodeId: attrs.id || null,
    label,
    labelNormalized: normalizeLabel(label),
    groupKey: `${kind}::${identity}`,
    matchKey: identity,
    controlledTarget,
    domPath,
    locator: null,
    matchedTriggerKind: null,
    sourceStateId: stateRecord.stateId,
    order: index,
    expanded: boolFromAriaValue(attrs['aria-expanded']),
    targetVisible: context.isTargetVisible(targetIndex),
    open: false,
  };

  if (kind === 'menu-button') {
    candidate.open = candidate.targetVisible;
  } else if (kind === 'dialog-open') {
    candidate.open = targetIndex !== null ? Object.hasOwn(targetAttrs, 'open') || candidate.targetVisible : false;
  }

  if (candidateMatchesTrigger(stateRecord.trigger, candidate)) {
    candidate.locator = stateRecord.trigger?.locator ?? null;
    candidate.matchedTriggerKind = stateRecord.trigger?.kind ?? null;
  }

  return candidate;
}

function preferCandidate(left, right) {
  if (!left) {
    return right;
  }
  if (right.locator && !left.locator) {
    return right;
  }
  if (right.targetVisible && !left.targetVisible) {
    return right;
  }
  if (right.open && !left.open) {
    return right;
  }
  if (right.expanded && !left.expanded) {
    return right;
  }
  if (right.order < left.order) {
    return right;
  }
  return left;
}

function collectStateObservations(stateRecord, snapshotContext) {
  const tabGroups = new Map();
  const genericGroups = new Map();
  const seenDetails = new Set();

  for (let index = 0; index < snapshotContext.nodeCount; index += 1) {
    const nodeName = snapshotContext.nodeNameAt(index);
    const attrs = snapshotContext.attrsAt(index);

    if (attrs.role === 'tab' && snapshotContext.isNodeVisible(index)) {
      const candidate = buildTabCandidate(stateRecord, snapshotContext, index);
      const groupMembers = tabGroups.get(candidate.groupKey) ?? new Map();
      groupMembers.set(candidate.matchKey, preferCandidate(groupMembers.get(candidate.matchKey), candidate));
      tabGroups.set(candidate.groupKey, groupMembers);
      continue;
    }

    if (nodeName === 'SUMMARY') {
      const detailsIndex = snapshotContext.parentIndexOf(index);
      if (
        detailsIndex >= 0
        && snapshotContext.nodeNameAt(detailsIndex) === 'DETAILS'
        && !seenDetails.has(detailsIndex)
        && snapshotContext.isNodeVisible(index)
      ) {
        const candidate = buildDetailsCandidate(stateRecord, snapshotContext, detailsIndex, index);
        genericGroups.set(candidate.groupKey, preferCandidate(genericGroups.get(candidate.groupKey), candidate));
        seenDetails.add(detailsIndex);
      }
      continue;
    }

    const kind = classifyControlKind(snapshotContext, index, attrs);
    if (!kind) {
      continue;
    }

    const candidate = buildGenericCandidate(stateRecord, snapshotContext, index, kind);
    genericGroups.set(candidate.groupKey, preferCandidate(genericGroups.get(candidate.groupKey), candidate));
  }

  return {
    stateId: stateRecord.stateId,
    stateRecord,
    snapshotContext,
    tabGroups: new Map([...tabGroups.entries()].map(([groupKey, members]) => [groupKey, [...members.values()]])),
    genericGroups,
  };
}

function buildElementName(kind, members) {
  if (kind === 'tab-group') {
    const labels = members.map((member) => member.label).filter(Boolean).slice(0, 3);
    if (labels.length === 0) {
      return 'Tab Group';
    }
    return `Tab Group (${labels.join(', ')}${members.length > 3 ? ', ...' : ''})`;
  }

  if (NAVIGATION_ELEMENT_KINDS.has(kind)) {
    const labels = members.map((member) => member.label).filter(Boolean).slice(0, 3);
    if (labels.length === 0) {
      return kindTitle(kind);
    }
    return `${kindTitle(kind)} (${labels.join(', ')}${members.length > 3 ? ', ...' : ''})`;
  }

  const label = firstNonEmpty([members[0]?.label, members[0]?.controlledTarget, members[0]?.domPath]);
  return label ? `${kindTitle(kind)}: ${label}` : kindTitle(kind);
}

function addMemberToElement(group, candidate, forceMatchKey = null) {
  const matchKey = forceMatchKey ?? candidate.matchKey;
  let member = group.membersByKey.get(matchKey);
  if (!member) {
    member = {
      matchKey,
      label: candidate.label,
      locator: candidate.locator ?? null,
      controlledTarget: candidate.controlledTarget ?? null,
      href: candidate.href ?? null,
      domPath: candidate.domPath,
      sourceStateIds: new Set(),
      order: candidate.order,
    };
    group.membersByKey.set(matchKey, member);
  }

  member.label = firstNonEmpty([member.label, candidate.label]);
  member.locator = member.locator ?? candidate.locator ?? null;
  member.controlledTarget = member.controlledTarget ?? candidate.controlledTarget ?? null;
  member.href = member.href ?? candidate.href ?? null;
  member.domPath = member.domPath || candidate.domPath;
  member.sourceStateIds.add(candidate.sourceStateId);
  member.order = Math.min(member.order ?? candidate.order, candidate.order);
}

function ensureElementGroup(elementsByKey, kind, groupKey) {
  let group = elementsByKey.get(groupKey);
  if (!group) {
    group = {
      kind,
      groupKey,
      membersByKey: new Map(),
      evidenceStateIds: new Set(),
      evidenceTriggerKinds: new Set(),
    };
    elementsByKey.set(groupKey, group);
  }
  return group;
}

function groupMemberSignature(group) {
  return [...group.membersByKey.values()]
    .map((member) => `${member.matchKey}::${normalizeLabel(member.label)}`)
    .sort(compareNullableStrings)
    .join('|');
}

function mergeElementGroupData(target, source) {
  for (const stateId of source.evidenceStateIds) {
    target.evidenceStateIds.add(stateId);
  }
  for (const triggerKind of source.evidenceTriggerKinds) {
    target.evidenceTriggerKinds.add(triggerKind);
  }
  for (const member of source.membersByKey.values()) {
    addMemberToElement(target, {
      matchKey: member.matchKey,
      label: member.label,
      locator: member.locator,
      controlledTarget: member.controlledTarget,
      href: member.href,
      domPath: member.domPath,
      sourceStateId: [...member.sourceStateIds][0],
      order: member.order,
    }, member.matchKey);
    const targetMember = target.membersByKey.get(member.matchKey);
    for (const stateId of member.sourceStateIds) {
      targetMember.sourceStateIds.add(stateId);
    }
  }
}

function collapseEquivalentTabGroups(elementsByKey) {
  const groups = [...elementsByKey.values()].filter((group) => group.kind === 'tab-group');
  const signatures = new Map();

  for (const group of groups) {
    const signature = groupMemberSignature(group);
    const existing = signatures.get(signature);
    if (!existing) {
      signatures.set(signature, group);
      continue;
    }

    const preferred = existing.evidenceStateIds.size >= group.evidenceStateIds.size ? existing : group;
    const redundant = preferred === existing ? group : existing;
    mergeElementGroupData(preferred, redundant);
    elementsByKey.delete(redundant.groupKey);
    signatures.set(signature, preferred);
  }
}

function finalizeElements(elementsByKey) {
  const finalized = [];
  const lookup = new Map();

  for (const group of elementsByKey.values()) {
    const elementId = `el_${createSha256(group.groupKey).slice(0, 12)}`;
    const members = [...group.membersByKey.values()].map((member) => ({
      memberId: `mem_${createSha256(`${elementId}::${member.matchKey}`).slice(0, 12)}`,
      label: member.label,
      matchKey: member.matchKey,
      locator: member.locator,
      controlledTarget: member.controlledTarget,
      href: member.href ?? null,
      domPath: member.domPath,
      sourceStateIds: [...member.sourceStateIds].sort(compareNullableStrings),
      order: member.order,
    }));

    members.sort(compareMembers);
    const memberMap = new Map(members.map((member) => [member.matchKey, member]));
    const chapterGroupLabel = group.kind === 'chapter-link-group'
      ? firstNonEmpty([group.groupKey.split('::')[1]?.replace(/-/g, ' ').trim(), 'Chapter Links'])
      : null;
    const element = {
      elementId,
      kind: group.kind,
      elementName: group.kind === 'search-form-group'
        ? kindTitle('search-form-group')
        : chapterGroupLabel
          ? `Chapter Links (${chapterGroupLabel})`
          : buildElementName(group.kind, members),
      groupKey: group.groupKey,
      members: members.map(({ order, ...member }) => member),
      evidence: {
        stateIds: [...group.evidenceStateIds].sort(compareNullableStrings),
        triggerKinds: [...group.evidenceTriggerKinds].sort(compareNullableStrings),
      },
    };

    finalized.push(element);
    lookup.set(group.groupKey, {
      ...element,
      memberMap,
    });
  }

  finalized.sort(compareElements);
  return { elements: finalized, lookup };
}

function buildTriggerDrivenCandidate(stateRecord) {
  const trigger = stateRecord?.trigger;
  if (!trigger) {
    return null;
  }

  let kind = null;
  if (trigger.kind === 'content-link') {
    kind = 'content-link-group';
  } else if (trigger.kind === 'chapter-link') {
    kind = 'chapter-link-group';
  } else if (trigger.kind === 'auth-link') {
    kind = 'auth-link-group';
  } else if (trigger.kind === 'pagination-link') {
    kind = 'pagination-link-group';
  } else if (trigger.kind === 'form-submit') {
    kind = 'form-submit-group';
  } else if (trigger.kind === 'search-form') {
    kind = 'search-form-group';
  } else if (trigger.kind === 'safe-nav-link') {
    if (trigger.semanticRole === 'category') {
      kind = 'category-link-group';
    } else if (trigger.semanticRole === 'author') {
      kind = 'author-link-group';
    } else {
      kind = 'utility-link-group';
    }
  }

  if (!kind) {
    return null;
  }

  const href = normalizeUrlNoFragment(trigger.href ?? trigger.locator?.href);
  const sourceBookTitle = stateRecord?.pageFacts?.bookTitle ?? null;
  const canonicalLabel = extractCanonicalLabelFromState(stateRecord, kind);
  const rawLabel = safeNodeLabel(
    firstNonEmpty([canonicalLabel, trigger.label, trigger.locator?.label, trigger.locator?.textSnippet]),
    href || trigger.locator?.domPath || `${kind}-member`,
  );
  const label = normalizeDisplayLabel(rawLabel, {
    siteContext: ACTIVE_SITE_PROFILE,
    inputUrl: stateRecord?.inputUrl ?? stateRecord?.finalUrl ?? href ?? null,
    url: href ?? stateRecord?.finalUrl ?? null,
    pageType: href ? inferPageTypeFromUrl(href, ACTIVE_SITE_PROFILE) : stateRecord?.pageType ?? null,
    queryText: stateRecord?.pageFacts?.queryText ?? trigger.queryText ?? null,
    kind,
  }) || rawLabel;
  const domPath = trigger.locator?.domPath || '';
  return {
    kind,
    label,
    labelNormalized: normalizeLabel(label),
    groupKey: kind === 'chapter-link-group'
      ? `${kind}::${normalizeLabel(sourceBookTitle || href || 'site')}`
      : kind === 'search-form-group'
        ? `${kind}::search`
        : `${kind}::site`,
    matchKey: kind === 'search-form-group'
      ? `query:${normalizeLabel(trigger.queryText || label || 'search')}`
      : href
        ? `href:${href}`
        : buildMemberMatchKey({
      id: trigger.locator?.id ?? null,
      controlledTarget: trigger.controlledTarget ?? trigger.locator?.ariaControls ?? null,
      label,
      domPath,
        }),
    locator: trigger.locator ?? null,
    controlledTarget: trigger.controlledTarget ?? trigger.locator?.ariaControls ?? null,
    href,
    domPath,
    sourceStateId: stateRecord.stateId,
    order: trigger.ordinal ?? 0,
    matchedTriggerKind: trigger.kind,
  };
}

function aggregateElements(stateObservations, sourceStates) {
  const elementsByKey = new Map();

  for (const observation of stateObservations) {
    for (const [groupKey, candidates] of observation.tabGroups) {
      const group = ensureElementGroup(elementsByKey, 'tab-group', groupKey);
      group.evidenceStateIds.add(observation.stateId);
      for (const candidate of candidates) {
        addMemberToElement(group, candidate);
        if (candidate.matchedTriggerKind) {
          group.evidenceTriggerKinds.add(candidate.matchedTriggerKind);
        }
      }
    }

    for (const [groupKey, candidate] of observation.genericGroups) {
      const group = ensureElementGroup(elementsByKey, candidate.kind, groupKey);
      group.evidenceStateIds.add(observation.stateId);
      addMemberToElement(group, candidate, candidate.matchKey);
      if (candidate.matchedTriggerKind) {
        group.evidenceTriggerKinds.add(candidate.matchedTriggerKind);
      }
    }
  }

  for (const stateRecord of sourceStates) {
    if (!['captured', 'duplicate'].includes(stateRecord.status)) {
      continue;
    }
    const candidate = buildTriggerDrivenCandidate(stateRecord);
    if (!candidate) {
      continue;
    }
    const group = ensureElementGroup(elementsByKey, candidate.kind, candidate.groupKey);
    group.evidenceStateIds.add(stateRecord.stateId);
    addMemberToElement(group, candidate, candidate.matchKey);
    if (candidate.matchedTriggerKind) {
      group.evidenceTriggerKinds.add(candidate.matchedTriggerKind);
    }
  }

  collapseEquivalentTabGroups(elementsByKey);
  return finalizeElements(elementsByKey);
}

function navigationMemberMatchesState(element, stateRecord) {
  const stateUrl = normalizeUrlNoFragment(stateRecord.finalUrl);
  if (!stateUrl) {
    return null;
  }

  const byHref = toArray(element.members).find((member) => member.href && normalizeUrlNoFragment(member.href) === stateUrl);
  if (byHref) {
    return byHref;
  }

  const trigger = stateRecord.trigger ?? null;
  if (!trigger) {
    if (element.kind === 'utility-link-group' && inferPageTypeFromUrl(stateRecord.finalUrl, ACTIVE_SITE_PROFILE) === 'home') {
      return toArray(element.members).find((member) => normalizeLabel(member.label) === '首页' || normalizeUrlNoFragment(member.href) === stateUrl) ?? null;
    }
    return null;
  }

  return toArray(element.members).find((member) => {
    if (member.href && normalizeUrlNoFragment(member.href) === normalizeUrlNoFragment(trigger.href ?? trigger.locator?.href)) {
      return true;
    }
    if (trigger.locator?.id && member.matchKey === `id:${trigger.locator.id}`) {
      return true;
    }
    if (trigger.controlledTarget && member.controlledTarget === trigger.controlledTarget) {
      return true;
    }
    if (trigger.label && normalizeLabel(member.label) === normalizeLabel(trigger.label)) {
      return true;
    }
    return Boolean(trigger.locator?.domPath && member.domPath === trigger.locator.domPath);
  }) ?? null;
}

function selectActiveTabCandidate(candidates, stateRecord) {
  return candidates.find((candidate) => candidate.isActive)
    ?? candidates.find((candidate) => candidate.targetVisible)
    ?? candidates.find((candidate) => candidateMatchesTrigger(stateRecord.trigger, candidate))
    ?? null;
}

function buildElementStateForGeneric(element, candidate) {
  switch (element.kind) {
    case 'details-toggle':
      return {
        elementId: element.elementId,
        kind: element.kind,
        value: {
          open: candidate.open,
          targetVisible: candidate.targetVisible,
        },
      };
    case 'expanded-toggle':
      return {
        elementId: element.elementId,
        kind: element.kind,
        value: {
          expanded: candidate.expanded,
          targetVisible: candidate.targetVisible,
        },
      };
    case 'menu-button':
    case 'dialog-open':
      return {
        elementId: element.elementId,
        kind: element.kind,
        value: {
          open: candidate.open,
          targetVisible: candidate.targetVisible,
        },
      };
    default:
      return null;
  }
}

function buildFeaturedContentCards(pageFacts, {
  entryField = 'resultEntries',
  titleField = 'featuredContentTitles',
  urlField = 'featuredContentUrls',
  typeField = 'featuredContentTypes',
  bvidField = 'featuredContentBvids',
  authorMidField = 'resultAuthorMids',
  limit = 3,
} = {}) {
  const explicitEntries = toArray(pageFacts?.[entryField])
    .map((entry) => ({
      title: cleanText(entry?.title),
      url: cleanText(entry?.url),
      contentType: cleanText(entry?.contentType),
      bvid: cleanText(entry?.bvid),
      authorMid: cleanText(entry?.authorMid),
    }))
    .filter((entry) => entry.title || entry.url || entry.bvid || entry.authorMid || entry.contentType)
    .slice(0, limit);
  if (explicitEntries.length > 0) {
    return explicitEntries;
  }

  const titles = toArray(pageFacts?.[titleField]);
  const urls = toArray(pageFacts?.[urlField]);
  const contentTypes = toArray(pageFacts?.[typeField]);
  const bvids = toArray(pageFacts?.[bvidField]);
  const authorMids = toArray(pageFacts?.[authorMidField]);
  const size = Math.max(titles.length, urls.length, contentTypes.length, bvids.length, authorMids.length);
  const cards = [];
  for (let index = 0; index < size && cards.length < limit; index += 1) {
    const card = {
      title: cleanText(titles[index]),
      url: cleanText(urls[index]),
      contentType: cleanText(contentTypes[index]),
      bvid: cleanText(bvids[index]),
      authorMid: cleanText(authorMids[index]),
    };
    if (card.title || card.url || card.contentType || card.bvid || card.authorMid) {
      cards.push(card);
    }
  }
  return cards;
}

function buildPageFactHighlights(pageType, pageFacts) {
  if (!pageFacts || typeof pageFacts !== 'object') {
    return null;
  }

  const highlights = {};
  const contentCards = buildFeaturedContentCards(pageFacts);
  const featuredCards = buildFeaturedContentCards(pageFacts, {
    entryField: 'featuredContentCards',
  });
  const mergedCards = [...contentCards, ...featuredCards]
    .filter((card, index, array) => array.findIndex((candidate) => {
      const candidateKey = [candidate.url, candidate.bvid, candidate.title, candidate.authorMid].map((value) => cleanText(value)).join('::');
      const cardKey = [card.url, card.bvid, card.title, card.authorMid].map((value) => cleanText(value)).join('::');
      return candidateKey === cardKey;
    }) === index)
    .slice(0, 3);

  if (pageType === 'search-results-page') {
    const searchFamily = cleanText(pageFacts.searchSection);
    if (searchFamily) {
      highlights.searchFamily = searchFamily;
    }
    const firstResultContentType = cleanText(pageFacts.firstResultContentType);
    if (firstResultContentType) {
      highlights.firstResultContentType = firstResultContentType;
    }
    if (mergedCards.length > 0) {
      highlights.featuredContentCards = mergedCards;
    }
    const resultBvid = cleanText(pageFacts.bvid ?? toArray(pageFacts.resultBvids)[0] ?? mergedCards[0]?.bvid);
    if (resultBvid) {
      highlights.bvid = resultBvid;
    }
    const resultAuthorMid = cleanText(pageFacts.authorMid ?? toArray(pageFacts.resultAuthorMids)[0] ?? mergedCards[0]?.authorMid);
    if (resultAuthorMid) {
      highlights.authorMid = resultAuthorMid;
    }
  }

  if (isContentDetailPageType(pageType)) {
    const contentType = cleanText(pageFacts.contentType);
    if (contentType) {
      highlights.contentType = contentType;
    }
    const bvid = cleanText(pageFacts.bvid);
    if (bvid) {
      highlights.bvid = bvid;
    }
    const authorMid = cleanText(pageFacts.authorMid);
    if (authorMid) {
      highlights.authorMid = authorMid;
    }
  }

  if (pageType === 'author-page' || pageType === 'author-list-page') {
    const authorMid = cleanText(pageFacts.authorMid);
    if (authorMid) {
      highlights.authorMid = authorMid;
    }
    const authorSubpage = cleanText(pageFacts.authorSubpage);
    if (authorSubpage) {
      highlights.authorSubpage = authorSubpage;
    }
    const featuredAuthorCards = toArray(pageFacts.featuredAuthorCards)
      .map((author) => ({
        name: cleanText(author?.name),
        url: cleanText(author?.url),
        mid: cleanText(author?.mid),
        authorSubpage: cleanText(author?.authorSubpage),
        cardKind: cleanText(author?.cardKind),
      }))
      .filter((author) => author.name || author.url || author.mid)
      .slice(0, 5);
    const featuredAuthors = (featuredAuthorCards.length > 0 ? featuredAuthorCards : toArray(pageFacts.featuredAuthors))
      .map((author) => ({
        name: cleanText(author?.name),
        url: cleanText(author?.url),
        mid: cleanText(author?.mid),
      }))
      .filter((author) => author.name || author.url || author.mid)
      .slice(0, 5);
    if (featuredAuthors.length > 0) {
      highlights.featuredAuthors = featuredAuthors;
      highlights.featuredAuthorCount = Number(pageFacts.featuredAuthorCount ?? featuredAuthors.length) || featuredAuthors.length;
      highlights.featuredAuthorMids = featuredAuthors.map((author) => author.mid).filter(Boolean);
    }
    if (featuredAuthorCards.length > 0) {
      highlights.featuredAuthorCards = featuredAuthorCards;
    }
    if (mergedCards.length > 0) {
      highlights.featuredContentCards = mergedCards;
      highlights.featuredContentCardCount = Number(pageFacts.featuredContentCount ?? mergedCards.length) || mergedCards.length;
    }
  }

  if (pageType === 'category-page') {
    const categoryName = cleanText(pageFacts.categoryName);
    if (categoryName) {
      highlights.categoryName = categoryName;
    }
    const categoryPath = cleanText(pageFacts.categoryPath);
    if (categoryPath) {
      highlights.categoryPath = categoryPath;
    }
    if (mergedCards.length > 0) {
      highlights.featuredContentCards = mergedCards;
      highlights.featuredContentCardCount = Number(pageFacts.featuredContentCount ?? mergedCards.length) || mergedCards.length;
    }
  }

  return Object.keys(highlights).length > 0 ? highlights : null;
}

function buildStateOutputs(stateObservations, elementsLookup) {
  const states = [];
  const nodes = [];
  const sortedElements = [...elementsLookup.values()].sort(compareElements);

  for (const observation of [...stateObservations].sort((left, right) => compareStates(left.stateRecord, right.stateRecord))) {
    const elementStates = [];

    for (const element of sortedElements) {
      if (element.kind === 'tab-group') {
        const candidates = observation.tabGroups.get(element.groupKey);
        if (!candidates || candidates.length === 0) {
          continue;
        }
        const activeCandidate = selectActiveTabCandidate(candidates, observation.stateRecord);
        const activeMember = activeCandidate ? element.memberMap.get(activeCandidate.matchKey) ?? null : null;
        elementStates.push({
          elementId: element.elementId,
          kind: element.kind,
          value: {
            activeMemberId: activeMember?.memberId ?? null,
            activeMemberLabel: activeMember?.label ?? null,
          },
        });
        continue;
      }

      if (element.kind === 'search-form-group') {
        const queryText = firstNonEmpty([
          observation.stateRecord.pageFacts?.queryText,
          observation.stateRecord.trigger?.queryText,
        ]);
        if (!queryText) {
          continue;
        }
        const queryKey = `query:${normalizeLabel(queryText)}`;
        const matchedMember = element.memberMap.get(queryKey)
          ?? toArray(element.members).find((member) => normalizeLabel(member.label) === normalizeLabel(queryText))
          ?? null;
        elementStates.push({
          elementId: element.elementId,
          kind: element.kind,
          value: {
            queryText,
            activeMemberId: matchedMember?.memberId ?? null,
            activeMemberLabel: matchedMember?.label ?? queryText,
          },
        });
        continue;
      }

      if (NAVIGATION_ELEMENT_KINDS.has(element.kind)) {
        const activeMember = navigationMemberMatchesState(element, observation.stateRecord);
        if (!activeMember) {
          continue;
        }
        elementStates.push({
          elementId: element.elementId,
          kind: element.kind,
          value: {
            activeMemberId: activeMember.memberId,
            activeMemberLabel: activeMember.label ?? null,
          },
        });
        continue;
      }

      const candidate = observation.genericGroups.get(element.groupKey);
      if (!candidate) {
        continue;
      }
      const elementState = buildElementStateForGeneric(element, candidate);
      if (elementState) {
        elementStates.push(elementState);
      }
    }

    elementStates.sort((left, right) => compareNullableStrings(left.elementId, right.elementId));

    const stateOutput = {
      stateId: observation.stateRecord.stateId,
      sourceStatus: observation.stateRecord.status,
      fromState: observation.stateRecord.fromState,
      stateName: observation.stateRecord.stateName,
      dedupKey: observation.stateRecord.dedupKey,
      finalUrl: observation.stateRecord.finalUrl,
      title: observation.stateRecord.title,
      capturedAt: observation.stateRecord.capturedAt,
      pageType: inferPageTypeFromUrl(observation.stateRecord.finalUrl, ACTIVE_SITE_PROFILE),
      stateType: null,
      semanticPageType: null,
      pageFacts: observation.stateRecord.pageFacts ?? null,
      pageFactHighlights: null,
      trigger: observation.stateRecord.trigger ?? null,
      files: observation.stateRecord.files,
      elementStates,
    };
    stateOutput.stateType = inferStateType(stateOutput.pageType, elementStates);
    stateOutput.semanticPageType = toSemanticPageType(stateOutput.pageType);
    stateOutput.pageFactHighlights = buildPageFactHighlights(stateOutput.pageType, stateOutput.pageFacts);

    states.push(stateOutput);
    nodes.push({
      stateId: stateOutput.stateId,
      sourceStatus: stateOutput.sourceStatus,
      finalUrl: stateOutput.finalUrl,
      title: stateOutput.title,
      dedupKey: stateOutput.dedupKey,
      pageType: stateOutput.pageType,
      semanticPageType: stateOutput.semanticPageType,
      stateType: stateOutput.stateType,
      pageFactHighlights: stateOutput.pageFactHighlights,
    });
  }

  return { states, nodes };
}

function buildTransitionEdges(sourceStates) {
  const edges = [];
  for (const state of sourceStates) {
    if (!EDGE_STATUSES.has(state.status)) {
      continue;
    }

    let toState = null;
    if (state.status === 'captured') {
      toState = state.stateId;
    } else if (state.status === 'duplicate') {
      toState = state.rawState?.duplicate_of ?? state.rawState?.duplicateOf ?? state.duplicateOf ?? null;
    }

    edges.push({
      edgeId: `edge_${createSha256(`${state.fromState ?? 'null'}::${state.stateId}`).slice(0, 12)}`,
      fromState: state.fromState,
      toState,
      observedStateId: state.stateId,
      trigger: state.trigger ?? null,
      outcome: state.status,
      stateName: state.stateName,
      dedupKey: state.dedupKey,
      finalUrl: state.finalUrl,
      title: state.title,
      error: state.rawState?.error ?? null,
    });
  }

  edges.sort(compareEdges);
  return edges;
}

async function createOutputLayout(baseUrl, rootOutDir) {
  const generatedAt = new Date().toISOString();
  const host = (() => {
    try {
      return new URL(baseUrl).host;
    } catch {
      return 'unknown-host';
    }
  })();
  const outDir = path.join(path.resolve(rootOutDir), `${formatTimestampForDir(new Date(generatedAt))}_${sanitizeHost(host)}_analysis`);
  await mkdir(outDir, { recursive: true });

  return {
    generatedAt,
    outDir,
    elementsPath: path.join(outDir, 'elements.json'),
    statesPath: path.join(outDir, 'states.json'),
    transitionsPath: path.join(outDir, 'transitions.json'),
    siteProfilePath: path.join(outDir, 'site-profile.json'),
    manifestPath: path.join(outDir, 'analysis-manifest.json'),
  };
}

function mergeOptions(options = {}) {
  return {
    ...DEFAULT_OPTIONS,
    ...options,
    statesManifestPath: options.statesManifestPath ?? options.stateManifestPath ?? DEFAULT_OPTIONS.statesManifestPath,
    expandedStatesDir: options.expandedStatesDir ?? DEFAULT_OPTIONS.expandedStatesDir,
    bookContentManifestPath: options.bookContentManifestPath ?? DEFAULT_OPTIONS.bookContentManifestPath,
    bookContentDir: options.bookContentDir ?? DEFAULT_OPTIONS.bookContentDir,
    outDir: options.outDir ? path.resolve(options.outDir) : DEFAULT_OPTIONS.outDir,
  };
}

async function loadSnapshotObservations(stateRecord, warnings) {
  try {
    const snapshot = await readJsonFile(stateRecord.files.snapshot);
    const context = new SnapshotContext(snapshot, stateRecord.stateId);
    return collectStateObservations(stateRecord, context);
  } catch (error) {
    warnings.push(buildWarning('snapshot_parse_failed', `Failed to parse snapshot for ${stateRecord.stateId}: ${error.message}`, {
      stateId: stateRecord.stateId,
      snapshotPath: stateRecord.files.snapshot,
    }));
    return null;
  }
}

async function buildConcreteStateObservations(sourceStates, warnings) {
  const analyzed = [];
  const analyzedStateIds = [];
  const skippedStateIds = [];

  for (const stateRecord of sourceStates) {
    if (!isConcreteStateRecord(stateRecord)) {
      skippedStateIds.push(stateRecord.stateId);
      continue;
    }

    if (!hasCompleteEvidence(stateRecord)) {
      const missing = [
        !stateRecord.files.html ? 'html' : null,
        !stateRecord.files.snapshot ? 'snapshot' : null,
        !stateRecord.files.screenshot ? 'screenshot' : null,
        !stateRecord.finalUrl ? 'finalUrl' : null,
        !stateRecord.title ? 'title' : null,
        !stateRecord.capturedAt ? 'capturedAt' : null,
      ].filter(Boolean);
      warnings.push(buildWarning('incomplete_state_evidence', `Skipping ${stateRecord.stateId}; missing ${missing.join(', ')}`, {
        stateId: stateRecord.stateId,
        missing,
      }));
      skippedStateIds.push(stateRecord.stateId);
      continue;
    }

    const observation = await loadSnapshotObservations(stateRecord, warnings);
    if (!observation) {
      skippedStateIds.push(stateRecord.stateId);
      continue;
    }

    analyzed.push(observation);
    analyzedStateIds.push(stateRecord.stateId);
  }

  analyzed.sort((left, right) => compareStates(left.stateRecord, right.stateRecord));
  analyzedStateIds.sort(compareNullableStrings);
  skippedStateIds.sort(compareNullableStrings);

  return { analyzed, analyzedStateIds, skippedStateIds };
}

function capabilityFamiliesFromElements(elements) {
  const families = new Set();
  for (const element of elements) {
    switch (element.kind) {
      case 'tab-group':
      case 'details-toggle':
      case 'expanded-toggle':
      case 'menu-button':
      case 'dialog-open':
        families.add('switch-in-page-state');
        break;
      case 'category-link-group':
        families.add('navigate-to-category');
        break;
      case 'content-link-group':
        families.add('navigate-to-content');
        break;
      case 'author-link-group':
        families.add('navigate-to-author');
        break;
      case 'chapter-link-group':
        families.add('navigate-to-chapter');
        break;
      case 'utility-link-group':
      case 'pagination-link-group':
        families.add('navigate-to-utility-page');
        break;
      case 'auth-link-group':
        families.add('open-auth-page');
        break;
      case 'search-form-group':
        families.add('search-content');
        break;
      case 'form-submit-group':
        families.add('submit-form');
        break;
      default:
        break;
    }
  }
  return [...families].sort(compareNullableStrings);
}

function inferArchetypes(elements, states) {
  const scores = new Map([
    ['in-page-stateful', 0],
    ['navigation-hub', 0],
    ['catalog-detail', 0],
    ['auth-form', 0],
  ]);

  for (const element of elements) {
    switch (element.kind) {
      case 'tab-group':
      case 'details-toggle':
      case 'expanded-toggle':
      case 'menu-button':
      case 'dialog-open':
        scores.set('in-page-stateful', scores.get('in-page-stateful') + 2);
        break;
      case 'category-link-group':
      case 'utility-link-group':
      case 'pagination-link-group':
        scores.set('navigation-hub', scores.get('navigation-hub') + 2);
        break;
      case 'content-link-group':
      case 'author-link-group':
      case 'chapter-link-group':
        scores.set('catalog-detail', scores.get('catalog-detail') + 2);
        break;
      case 'search-form-group':
        scores.set('navigation-hub', scores.get('navigation-hub') + 1);
        scores.set('catalog-detail', scores.get('catalog-detail') + 1);
        break;
      case 'auth-link-group':
      case 'form-submit-group':
        scores.set('auth-form', scores.get('auth-form') + 2);
        break;
      default:
        break;
    }
  }

  for (const state of states) {
    if (state.pageType === 'home' || state.pageType === 'category-page' || state.pageType === 'history-page') {
      scores.set('navigation-hub', scores.get('navigation-hub') + 1);
    }
    if (state.pageType === 'search-results-page') {
      scores.set('navigation-hub', scores.get('navigation-hub') + 1);
      scores.set('catalog-detail', scores.get('catalog-detail') + 1);
    }
    if (isContentDetailPageType(state.pageType) || state.pageType === 'author-page' || state.pageType === 'chapter-page') {
      scores.set('catalog-detail', scores.get('catalog-detail') + 1);
    }
    if (state.pageType === 'auth-page') {
      scores.set('auth-form', scores.get('auth-form') + 1);
    }
  }

  const archetypes = [...scores.entries()]
    .filter(([, score]) => score > 0)
    .sort((left, right) => right[1] - left[1] || compareNullableStrings(left[0], right[0]))
    .map(([name]) => name);

  return {
    primaryArchetype: archetypes[0] ?? 'unknown',
    archetypes,
    maxScore: archetypes.length > 0 ? scores.get(archetypes[0]) : 0,
  };
}

function buildSiteProfile(inputUrl, baseUrl, generatedAt, elements, states, bookContentArtifacts = null) {
  const pageTypes = [...new Set(states.map((state) => state.pageType).filter(Boolean))].sort(compareNullableStrings);
  const semanticPageTypes = [...new Set(pageTypes.map((pageType) => toSemanticPageType(pageType)).filter(Boolean))].sort(compareNullableStrings);
  const capabilityFamilies = capabilityFamiliesFromElements(elements);
  if (bookContentArtifacts?.booksDocument?.length) {
    capabilityFamilies.push('download-content');
  }
  const uniqueCapabilityFamilies = [...new Set(capabilityFamilies)].sort(compareNullableStrings);
  const archetypeInfo = inferArchetypes(elements, states);
  const confidence = archetypeInfo.maxScore >= 6 ? 'high' : archetypeInfo.maxScore >= 3 ? 'medium' : 'low';
  const safeActionKinds = [];
  const approvalActionKinds = [];

  if (uniqueCapabilityFamilies.some((family) => family === 'switch-in-page-state')) {
    safeActionKinds.push('select-member', 'click-toggle');
  }
  if (uniqueCapabilityFamilies.some((family) => family.startsWith('navigate-to-'))) {
    safeActionKinds.push('navigate');
  }
  if (uniqueCapabilityFamilies.includes('search-content')) {
    safeActionKinds.push('search-submit');
  }
  if (uniqueCapabilityFamilies.includes('download-content')) {
    safeActionKinds.push('download-book');
  }
  if (uniqueCapabilityFamilies.includes('open-auth-page') || uniqueCapabilityFamilies.includes('submit-form')) {
    approvalActionKinds.push('navigate', 'submit');
  }

  const gaps = [];
  if (elements.length === 0) {
    gaps.push('No actionable or state-related elements were identified from observed evidence.');
  }
  if (confidence === 'low') {
    gaps.push('Archetype confidence is low; generate a limited/query-only skill if no stronger evidence appears.');
  }

  return {
    inputUrl,
    baseUrl,
    generatedAt,
    primaryArchetype: archetypeInfo.primaryArchetype,
    archetypes: archetypeInfo.archetypes,
    capabilityFamilies: uniqueCapabilityFamilies,
    pageTypes,
    semanticPageTypes,
    safeActionKinds: [...new Set(safeActionKinds)].sort(compareNullableStrings),
    approvalActionKinds: [...new Set(approvalActionKinds)].sort(compareNullableStrings),
    confidence,
    gaps,
  };
}

function buildElementsDocument(inputUrl, baseUrl, generatedAt, elements) {
  return {
    inputUrl,
    baseUrl,
    generatedAt,
    elements,
  };
}

function buildStatesDocument(inputUrl, baseUrl, generatedAt, states) {
  return {
    inputUrl,
    baseUrl,
    generatedAt,
    states,
  };
}

function buildTransitionsDocument(inputUrl, baseUrl, generatedAt, nodes, edges) {
  return {
    inputUrl,
    baseUrl,
    generatedAt,
    nodes,
    edges,
  };
}

function slugifyAscii(value, fallback = 'item') {
  return normalizeText(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase() || fallback;
}

function buildSyntheticStateId(prefix, value) {
  return `${prefix}_${createSha256(value).slice(0, 12)}`;
}

function buildSyntheticDedupKey(prefix, value) {
  return `${prefix}_${createSha256(value).slice(0, 24)}`;
}

function ensureSyntheticElement(elements, kind, elementName, groupKey) {
  const existing = elements.find((element) => element.kind === kind);
  if (existing) {
    return existing;
  }

  const element = {
    elementId: `el_${createSha256(groupKey).slice(0, 12)}`,
    kind,
    elementName,
    groupKey,
    members: [],
    evidence: {
      stateIds: [],
      triggerKinds: [],
    },
  };
  elements.push(element);
  return element;
}

function appendMemberToElement(element, {
  memberId,
  label,
  matchKey,
  locator = null,
  controlledTarget = null,
  domPath = null,
  sourceStateIds = [],
}) {
  if (element.members.some((member) => member.memberId === memberId || member.matchKey === matchKey)) {
    return;
  }
  element.members.push({
    memberId,
    label,
    matchKey,
    locator,
    controlledTarget,
    domPath,
    sourceStateIds: [...new Set(toArray(sourceStateIds))].sort(compareNullableStrings),
  });
}

function pushElementEvidence(element, stateId, triggerKind) {
  if (stateId && !element.evidence.stateIds.includes(stateId)) {
    element.evidence.stateIds.push(stateId);
    element.evidence.stateIds.sort(compareNullableStrings);
  }
  if (triggerKind && !element.evidence.triggerKinds.includes(triggerKind)) {
    element.evidence.triggerKinds.push(triggerKind);
    element.evidence.triggerKinds.sort(compareNullableStrings);
  }
}

function buildBookContentMemberId(elementId, value) {
  return `mem_${createSha256(`${elementId}::${value}`).slice(0, 12)}`;
}

function buildElementStateValue(kind, value, label) {
  if (kind === 'search-form-group') {
    return {
      queryText: String(value ?? ''),
      activeMemberId: label ? String(value ?? '') : null,
      activeMemberLabel: label ?? String(value ?? ''),
    };
  }
  return {
    activeMemberId: String(value ?? ''),
    activeMemberLabel: label ?? String(value ?? ''),
  };
}

function appendSyntheticState(states, nodes, stateRecord) {
  if (states.some((state) => state.stateId === stateRecord.stateId)) {
    return;
  }
  states.push(stateRecord);
  nodes.push({
    stateId: stateRecord.stateId,
    sourceStatus: stateRecord.sourceStatus,
    finalUrl: stateRecord.finalUrl,
    title: stateRecord.title,
    dedupKey: stateRecord.dedupKey,
    pageType: stateRecord.pageType,
    stateType: stateRecord.stateType,
  });
}

function appendSyntheticEdge(edges, edge) {
  if (edges.some((candidate) => candidate.edgeId === edge.edgeId)) {
    return;
  }
  edges.push(edge);
}

function ensureStatePageFacts(state, pageFactsPatch, pageType) {
  state.pageFacts = {
    ...(state.pageFacts ?? {}),
    ...pageFactsPatch,
  };
  if (pageType && state.pageType === 'unknown-page') {
    state.pageType = pageType;
  }
  if (!state.stateType || state.stateType === 'unknown') {
    state.stateType = inferStateType(state.pageType, state.elementStates);
  }
}

function findStateByFinalUrl(states, targetUrl) {
  const normalizedTarget = normalizeUrlNoFragment(targetUrl);
  return states.find((state) => normalizeUrlNoFragment(state.finalUrl) === normalizedTarget) ?? null;
}

async function augmentWithJableCategoryTaxonomy({ elements, states, warnings }) {
  const siteHost = String(ACTIVE_SITE_PROFILE?.host ?? '').toLowerCase();
  if (siteHost !== 'jable.tv') {
    return;
  }

  const categoryState = states.find((state) => normalizePathname(state.finalUrl) === '/categories/');
  if (!categoryState?.files?.html || !await pathExists(categoryState.files.html)) {
    return;
  }

  let html = null;
  try {
    html = await readFile(categoryState.files.html, 'utf8');
  } catch (error) {
    warnings.push(buildWarning('jable_category_taxonomy_read_failed', `Failed to read jable category HTML: ${error.message}`, {
      stateId: categoryState.stateId,
      htmlPath: categoryState.files.html,
    }));
    return;
  }

  const categoryTaxonomy = extractJableCategoryTaxonomyFromHtml(html, categoryState.finalUrl);
  if (categoryTaxonomy.length === 0) {
    warnings.push(buildWarning('jable_category_taxonomy_empty', 'No category taxonomy links were extracted from the jable /categories/ page.', {
      stateId: categoryState.stateId,
      htmlPath: categoryState.files.html,
    }));
    return;
  }

  const flattenedTags = [];
  for (const group of categoryTaxonomy) {
    for (const tag of group.tags) {
      flattenedTags.push({
        ...tag,
        groupLabel: group.groupLabel,
      });
    }
  }

  ensureStatePageFacts(categoryState, {
    categoryTaxonomy,
    categoryGroups: categoryTaxonomy.map((group) => group.groupLabel),
    categoryTagCount: flattenedTags.length,
    categoryTags: flattenedTags.map((tag) => ({
      groupLabel: tag.groupLabel,
      label: tag.label,
      href: tag.href,
    })),
  }, 'category-page');

  const categoryElement = ensureSyntheticElement(elements, 'category-link-group', '分类链接', 'site-category-links');
  pushElementEvidence(categoryElement, categoryState.stateId, 'safe-nav-link');
  for (const tag of flattenedTags) {
    appendMemberToElement(categoryElement, {
      memberId: buildBookContentMemberId(categoryElement.elementId, `href:${tag.href}`),
      label: tag.label,
      matchKey: `href:${tag.href}`,
      locator: {
        primary: 'href',
        role: 'link',
        href: tag.href,
        label: tag.label,
        textSnippet: `${tag.groupLabel} ${tag.label}`,
        domPath: `nav.categories > section:${tag.groupLabel} > a:${tag.label}`,
      },
      domPath: `nav.categories > section:${tag.groupLabel} > a:${tag.label}`,
      sourceStateIds: [categoryState.stateId],
    });
  }

  categoryElement.members.sort(compareMembers);
  categoryElement.evidence.stateIds.sort(compareNullableStrings);
  categoryElement.evidence.triggerKinds.sort(compareNullableStrings);
}

function augmentWithBilibiliKnowledgeFacts({ states, edges }) {
  const statesById = new Map(states.map((state) => [state.stateId, state]));
  const outgoingEdgesByStateId = new Map();
  for (const edge of edges) {
    if (!edge?.fromState) {
      continue;
    }
    if (!outgoingEdgesByStateId.has(edge.fromState)) {
      outgoingEdgesByStateId.set(edge.fromState, []);
    }
    outgoingEdgesByStateId.get(edge.fromState).push(edge);
  }

  for (const state of states) {
    const enrichedPageFacts = enrichBilibiliPageFactsForState(state, {
      outgoingEdges: outgoingEdgesByStateId.get(state.stateId) ?? [],
      statesById,
    });
    if (enrichedPageFacts) {
      state.pageFacts = enrichedPageFacts;
    }
  }
}

async function loadChaptersForBook(book) {
  if (!book?.chaptersFile || !(await pathExists(book.chaptersFile))) {
    return [];
  }
  try {
    return toArray(await readJsonFile(book.chaptersFile));
  } catch {
    return [];
  }
}

function buildChapterExcerpt(downloadText, chapterTitle) {
  const text = normalizeWhitespace(downloadText);
  if (!text) {
    return null;
  }
  const withoutHeader = chapterTitle ? text.replace(new RegExp(`^#\\s*${chapterTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*`, 'u'), '') : text;
  return withoutHeader.slice(0, 160) || null;
}

async function readDownloadText(downloadFile) {
  if (!downloadFile || !(await pathExists(downloadFile))) {
    return null;
  }
  try {
    return await readFile(downloadFile, 'utf8');
  } catch {
    return null;
  }
}

async function augmentWithBookContent({ elements, states, nodes, edges, bookContentArtifacts, generatedAt }) {
  if (!bookContentArtifacts) {
    return;
  }

  const rootStateId = states.find((state) => state.pageType === 'home')?.stateId ?? states[0]?.stateId ?? 's0000';
  const booksByUrl = new Map();
  const bookStateIdsByUrl = new Map();

  const searchElement = ensureSyntheticElement(elements, 'search-form-group', 'Book Search', 'site-search-form');
  const contentElement = ensureSyntheticElement(elements, 'content-link-group', 'Books', 'book-content-books');
  const authorElement = ensureSyntheticElement(elements, 'author-link-group', 'Authors', 'book-content-authors');
  const chapterElement = ensureSyntheticElement(elements, 'chapter-link-group', 'Chapters', 'book-content-chapters');

  for (const searchResult of toArray(bookContentArtifacts.searchResultsDocument)) {
    const queryText = firstNonEmpty([searchResult.queryText]);
    if (!queryText) {
      continue;
    }
    const searchStateId = buildSyntheticStateId('search', queryText);
    const queryMemberId = buildBookContentMemberId(searchElement.elementId, `query:${queryText}`);
    appendMemberToElement(searchElement, {
      memberId: queryMemberId,
      label: queryText,
      matchKey: `query:${normalizeLabel(queryText)}`,
      locator: { id: 'searchkey', domPath: 'input#searchkey' },
      sourceStateIds: [searchStateId],
    });
    pushElementEvidence(searchElement, searchStateId, 'search-form');
    appendSyntheticState(states, nodes, {
      stateId: searchStateId,
      sourceStatus: 'captured',
      fromState: rootStateId,
      stateName: `Search Results: ${queryText}`,
      dedupKey: buildSyntheticDedupKey('search', `${queryText}::${searchResult.searchUrl ?? ''}`),
      finalUrl: normalizeUrlNoFragment(searchResult.searchUrl) ?? normalizeUrlNoFragment(searchResult.results?.[0]?.url) ?? null,
      title: firstNonEmpty([`搜索 ${queryText}`, searchResult.searchUrl]),
      capturedAt: generatedAt,
      pageType: 'search-results-page',
      stateType: 'navigation',
      pageFacts: {
        queryText,
        resultCount: Number(searchResult.resultCount ?? 0),
        resultTitles: toArray(searchResult.results).map((item) => firstNonEmpty([item.title])).filter(Boolean),
      },
      trigger: {
        kind: 'search-form',
        label: `Search ${queryText}`,
        queryText,
        locator: { id: 'searchkey', domPath: 'input#searchkey' },
        ordinal: 0,
      },
      files: {
        html: null,
        snapshot: null,
        screenshot: null,
        manifest: bookContentArtifacts.bookContentManifestPath,
      },
      elementStates: [
        {
          elementId: searchElement.elementId,
          kind: searchElement.kind,
          value: buildElementStateValue(searchElement.kind, queryText, queryText),
        },
      ],
    });
    appendSyntheticEdge(edges, {
      edgeId: `edge_${createSha256(`${rootStateId}::${searchStateId}`).slice(0, 12)}`,
      fromState: rootStateId,
      toState: searchStateId,
      observedStateId: searchStateId,
      trigger: {
        kind: 'search-form',
        label: `Search ${queryText}`,
        queryText,
        locator: { id: 'searchkey', domPath: 'input#searchkey' },
        ordinal: 0,
      },
      outcome: 'captured',
      stateName: `Search Results: ${queryText}`,
      dedupKey: buildSyntheticDedupKey('search', `${queryText}::${searchResult.searchUrl ?? ''}`),
      finalUrl: normalizeUrlNoFragment(searchResult.searchUrl) ?? normalizeUrlNoFragment(searchResult.results?.[0]?.url) ?? null,
      title: firstNonEmpty([`搜索 ${queryText}`, searchResult.searchUrl]),
      error: null,
    });
  }

  for (const book of toArray(bookContentArtifacts.booksDocument)) {
    const normalizedBookUrl = normalizeUrlNoFragment(book.finalUrl);
    if (!normalizedBookUrl) {
      continue;
    }

    const bookStateId = findStateByFinalUrl(states, normalizedBookUrl)?.stateId ?? buildSyntheticStateId('book', normalizedBookUrl);
    const bookMemberId = buildBookContentMemberId(contentElement.elementId, normalizedBookUrl);
    appendMemberToElement(contentElement, {
      memberId: bookMemberId,
      label: firstNonEmpty([book.title, normalizedBookUrl]) ?? normalizedBookUrl,
      matchKey: `url:${normalizedBookUrl}`,
      locator: { id: null, domPath: null, href: normalizedBookUrl },
      sourceStateIds: [bookStateId],
    });
    pushElementEvidence(contentElement, bookStateId, 'content-link');
    booksByUrl.set(normalizedBookUrl, book);
    bookStateIdsByUrl.set(normalizedBookUrl, bookStateId);

    const existingBookState = findStateByFinalUrl(states, normalizedBookUrl);
    if (existingBookState) {
      ensureStatePageFacts(existingBookState, {
        bookTitle: firstNonEmpty([book.title]),
        authorName: firstNonEmpty([book.authorName]),
        authorUrl: normalizeUrlNoFragment(book.authorUrl),
        chapterCount: Number(book.chapterCount ?? 0),
        latestChapterUrl: normalizeUrlNoFragment(book.latestChapterUrl),
        queryText: firstNonEmpty([book.queryText]),
        downloadFile: book.downloadFile ?? null,
      }, 'book-detail-page');
      const hasBookElementState = toArray(existingBookState.elementStates).some((elementState) => elementState.elementId === contentElement.elementId);
      if (!hasBookElementState) {
        existingBookState.elementStates.push({
          elementId: contentElement.elementId,
          kind: contentElement.kind,
          value: buildElementStateValue(contentElement.kind, bookMemberId, book.title),
        });
      }
      continue;
    }

    appendSyntheticState(states, nodes, {
      stateId: bookStateId,
      sourceStatus: 'captured',
      fromState: rootStateId,
      stateName: `Book Detail: ${book.title ?? normalizedBookUrl}`,
      dedupKey: buildSyntheticDedupKey('book', normalizedBookUrl),
      finalUrl: normalizedBookUrl,
      title: firstNonEmpty([book.title, normalizedBookUrl]),
      capturedAt: generatedAt,
      pageType: 'book-detail-page',
      stateType: 'navigation',
      pageFacts: {
        bookTitle: firstNonEmpty([book.title]),
        authorName: firstNonEmpty([book.authorName]),
        authorUrl: normalizeUrlNoFragment(book.authorUrl),
        chapterCount: Number(book.chapterCount ?? 0),
        latestChapterUrl: normalizeUrlNoFragment(book.latestChapterUrl),
        queryText: firstNonEmpty([book.queryText]),
        downloadFile: book.downloadFile ?? null,
      },
      trigger: {
        kind: 'content-link',
        label: firstNonEmpty([book.title, normalizedBookUrl]),
        href: normalizedBookUrl,
        ordinal: 0,
      },
      files: {
        html: book.bookFile ?? null,
        snapshot: null,
        screenshot: null,
        manifest: book.bookFile ?? bookContentArtifacts.bookContentManifestPath,
      },
      elementStates: [
        {
          elementId: contentElement.elementId,
          kind: contentElement.kind,
          value: buildElementStateValue(contentElement.kind, bookMemberId, book.title),
        },
      ],
    });

    appendSyntheticEdge(edges, {
      edgeId: `edge_${createSha256(`${rootStateId}::${bookStateId}`).slice(0, 12)}`,
      fromState: rootStateId,
      toState: bookStateId,
      observedStateId: bookStateId,
      trigger: {
        kind: 'content-link',
        label: firstNonEmpty([book.title, normalizedBookUrl]),
        href: normalizedBookUrl,
        ordinal: 0,
      },
      outcome: 'captured',
      stateName: `Book Detail: ${book.title ?? normalizedBookUrl}`,
      dedupKey: buildSyntheticDedupKey('book', normalizedBookUrl),
      finalUrl: normalizedBookUrl,
      title: firstNonEmpty([book.title, normalizedBookUrl]),
      error: null,
    });
  }

  for (const author of toArray(bookContentArtifacts.authorsDocument)) {
    const normalizedAuthorUrl = normalizeUrlNoFragment(author.finalUrl);
    if (!normalizedAuthorUrl) {
      continue;
    }
    const authorStateId = findStateByFinalUrl(states, normalizedAuthorUrl)?.stateId ?? buildSyntheticStateId('author', normalizedAuthorUrl);
    const authorMemberId = buildBookContentMemberId(authorElement.elementId, normalizedAuthorUrl);
    appendMemberToElement(authorElement, {
      memberId: authorMemberId,
      label: firstNonEmpty([author.authorName, normalizedAuthorUrl]) ?? normalizedAuthorUrl,
      matchKey: `url:${normalizedAuthorUrl}`,
      locator: { id: null, domPath: null, href: normalizedAuthorUrl },
      sourceStateIds: [authorStateId],
    });
    pushElementEvidence(authorElement, authorStateId, 'safe-nav-link');

    const existingAuthorState = findStateByFinalUrl(states, normalizedAuthorUrl);
    if (existingAuthorState) {
      ensureStatePageFacts(existingAuthorState, {
        authorName: firstNonEmpty([author.authorName]),
      }, 'author-page');
      const hasAuthorElementState = toArray(existingAuthorState.elementStates).some((elementState) => elementState.elementId === authorElement.elementId);
      if (!hasAuthorElementState) {
        existingAuthorState.elementStates.push({
          elementId: authorElement.elementId,
          kind: authorElement.kind,
          value: buildElementStateValue(authorElement.kind, authorMemberId, author.authorName),
        });
      }
      continue;
    }

    const sourceBook = toArray(bookContentArtifacts.booksDocument).find((book) => normalizeUrlNoFragment(book.authorUrl) === normalizedAuthorUrl) ?? null;
    const fromState = sourceBook ? bookStateIdsByUrl.get(normalizeUrlNoFragment(sourceBook.finalUrl)) ?? rootStateId : rootStateId;

    appendSyntheticState(states, nodes, {
      stateId: authorStateId,
      sourceStatus: 'captured',
      fromState,
      stateName: `Author Page: ${author.authorName ?? normalizedAuthorUrl}`,
      dedupKey: buildSyntheticDedupKey('author', normalizedAuthorUrl),
      finalUrl: normalizedAuthorUrl,
      title: firstNonEmpty([author.authorName, author.title, normalizedAuthorUrl]),
      capturedAt: generatedAt,
      pageType: 'author-page',
      stateType: 'navigation',
      pageFacts: {
        authorName: firstNonEmpty([author.authorName]),
      },
      trigger: {
        kind: 'safe-nav-link',
        semanticRole: 'author',
        label: firstNonEmpty([author.authorName, normalizedAuthorUrl]),
        href: normalizedAuthorUrl,
        ordinal: 0,
      },
      files: {
        html: null,
        snapshot: null,
        screenshot: null,
        manifest: bookContentArtifacts.authorsPath ?? bookContentArtifacts.bookContentManifestPath,
      },
      elementStates: [
        {
          elementId: authorElement.elementId,
          kind: authorElement.kind,
          value: buildElementStateValue(authorElement.kind, authorMemberId, author.authorName),
        },
      ],
    });

    appendSyntheticEdge(edges, {
      edgeId: `edge_${createSha256(`${fromState}::${authorStateId}`).slice(0, 12)}`,
      fromState,
      toState: authorStateId,
      observedStateId: authorStateId,
      trigger: {
        kind: 'safe-nav-link',
        semanticRole: 'author',
        label: firstNonEmpty([author.authorName, normalizedAuthorUrl]),
        href: normalizedAuthorUrl,
        ordinal: 0,
      },
      outcome: 'captured',
      stateName: `Author Page: ${author.authorName ?? normalizedAuthorUrl}`,
      dedupKey: buildSyntheticDedupKey('author', normalizedAuthorUrl),
      finalUrl: normalizedAuthorUrl,
      title: firstNonEmpty([author.authorName, author.title, normalizedAuthorUrl]),
      error: null,
    });
  }

  for (const book of toArray(bookContentArtifacts.booksDocument)) {
    const normalizedBookUrl = normalizeUrlNoFragment(book.finalUrl);
    if (!normalizedBookUrl) {
      continue;
    }
    const fromState = bookStateIdsByUrl.get(normalizedBookUrl) ?? rootStateId;
    const downloadText = await readDownloadText(book.downloadFile);
    const chapters = await loadChaptersForBook(book);
    for (const chapter of chapters) {
      const chapterUrl = normalizeUrlNoFragment(firstNonEmpty([chapter.finalUrl, chapter.href]));
      if (!chapterUrl) {
        continue;
      }
      const chapterStateId = findStateByFinalUrl(states, chapterUrl)?.stateId ?? buildSyntheticStateId('chapter', chapterUrl);
      const chapterLabel = firstNonEmpty([
        `${book.title ?? 'Book'} ${chapter.title ?? chapterUrl}`,
        chapter.title,
        chapterUrl,
      ]) ?? chapterUrl;
      const chapterMemberId = buildBookContentMemberId(chapterElement.elementId, chapterUrl);
      appendMemberToElement(chapterElement, {
        memberId: chapterMemberId,
        label: chapterLabel,
        matchKey: `url:${chapterUrl}`,
        locator: { id: null, domPath: null, href: chapterUrl },
        sourceStateIds: [chapterStateId],
      });
      pushElementEvidence(chapterElement, chapterStateId, 'chapter-link');

      const existingChapterState = findStateByFinalUrl(states, chapterUrl);
      const pageFacts = {
        bookTitle: firstNonEmpty([book.title]),
        authorName: firstNonEmpty([book.authorName]),
        authorUrl: normalizeUrlNoFragment(book.authorUrl),
        chapterTitle: firstNonEmpty([chapter.title]),
        chapterHref: normalizeUrlNoFragment(chapter.href),
        chapterIndex: Number(chapter.chapterIndex ?? 0) || null,
        bodyTextLength: Number(chapter.bodyTextLength ?? 0) || null,
        bodyExcerpt: buildChapterExcerpt(downloadText, chapter.title),
        downloadFile: book.downloadFile ?? null,
      };

      if (existingChapterState) {
        ensureStatePageFacts(existingChapterState, pageFacts, 'chapter-page');
        const hasChapterElementState = toArray(existingChapterState.elementStates).some((elementState) => elementState.elementId === chapterElement.elementId);
        if (!hasChapterElementState) {
          existingChapterState.elementStates.push({
            elementId: chapterElement.elementId,
            kind: chapterElement.kind,
            value: buildElementStateValue(chapterElement.kind, chapterMemberId, chapterLabel),
          });
        }
        continue;
      }

      appendSyntheticState(states, nodes, {
        stateId: chapterStateId,
        sourceStatus: 'captured',
        fromState,
        stateName: `Chapter Page: ${chapter.title ?? chapterUrl}`,
        dedupKey: buildSyntheticDedupKey('chapter', chapterUrl),
        finalUrl: chapterUrl,
        title: firstNonEmpty([chapter.title, chapterUrl]),
        capturedAt: generatedAt,
        pageType: 'chapter-page',
        stateType: 'navigation',
        pageFacts,
        trigger: {
          kind: 'chapter-link',
          label: firstNonEmpty([chapter.title, chapterUrl]),
          href: chapterUrl,
          ordinal: Number(chapter.chapterIndex ?? 0) || 0,
        },
        files: {
          html: book.chaptersFile ?? null,
          snapshot: null,
          screenshot: null,
          manifest: book.downloadFile ?? book.chaptersFile ?? bookContentArtifacts.bookContentManifestPath,
        },
        elementStates: [
          {
            elementId: chapterElement.elementId,
            kind: chapterElement.kind,
            value: buildElementStateValue(chapterElement.kind, chapterMemberId, chapterLabel),
          },
          {
            elementId: contentElement.elementId,
            kind: contentElement.kind,
            value: buildElementStateValue(contentElement.kind, buildBookContentMemberId(contentElement.elementId, normalizedBookUrl), book.title),
          },
        ],
      });

      appendSyntheticEdge(edges, {
        edgeId: `edge_${createSha256(`${fromState}::${chapterStateId}`).slice(0, 12)}`,
        fromState,
        toState: chapterStateId,
        observedStateId: chapterStateId,
        trigger: {
          kind: 'chapter-link',
          label: firstNonEmpty([chapter.title, chapterUrl]),
          href: chapterUrl,
          ordinal: Number(chapter.chapterIndex ?? 0) || 0,
        },
        outcome: 'captured',
        stateName: `Chapter Page: ${chapter.title ?? chapterUrl}`,
        dedupKey: buildSyntheticDedupKey('chapter', chapterUrl),
        finalUrl: chapterUrl,
        title: firstNonEmpty([chapter.title, chapterUrl]),
        error: null,
      });
    }
  }

  for (const element of [searchElement, contentElement, authorElement, chapterElement]) {
    element.members.sort(compareMembers);
    element.evidence.stateIds.sort(compareNullableStrings);
    element.evidence.triggerKinds.sort(compareNullableStrings);
  }

  states.sort(compareStates);
  nodes.sort((left, right) => compareNullableStrings(left.stateId, right.stateId));
  edges.sort(compareEdges);
}

function buildAnalysisManifest({
  inputUrl,
  baseUrl,
  generatedAt,
  outDir,
  statesManifestPath,
  expandedStatesDir,
  bookContentManifestPath,
  bookContentDir,
  analyzedStateIds,
  skippedStateIds,
  elementsPath,
  statesPath,
  transitionsPath,
  siteProfilePath,
  manifestPath,
  elements,
  states,
  edges,
  siteProfile,
  sourceStateCount,
  warnings,
}) {
  return buildRunManifest({
    inputUrl,
    baseUrl,
    generatedAt,
    outDir,
    upstream: {
      expandedStates: {
        manifest: statesManifestPath,
        dir: expandedStatesDir,
      },
      bookContent: {
        manifest: bookContentManifestPath ?? null,
        dir: bookContentDir ?? null,
      },
      stateSelection: {
        analyzedStateIds,
        skippedStateIds,
      },
    },
    summary: {
      inputStates: sourceStateCount,
      analyzedStates: states.length,
      skippedStates: skippedStateIds.length,
      elementGroups: elements.length,
      elementMembers: elements.reduce((sum, element) => sum + element.members.length, 0),
      transitionEdges: edges.length,
      duplicateEdges: edges.filter((edge) => edge.outcome === 'duplicate').length,
      noopEdges: edges.filter((edge) => edge.outcome === 'noop').length,
      failedEdges: edges.filter((edge) => edge.outcome === 'failed').length,
      primaryArchetype: siteProfile.primaryArchetype,
    },
    files: {
      elements: elementsPath,
      states: statesPath,
      transitions: transitionsPath,
      siteProfile: siteProfilePath,
      manifest: manifestPath,
    },
    warnings,
  });
}

export async function analyzeStates(inputUrl, options = {}) {
  const settings = mergeOptions(options);
  const warnings = [];
  const { manifestPath, expandedStatesDir } = await resolveManifestInput(settings);
  const topManifest = await readJsonFile(manifestPath);

  if (!Array.isArray(topManifest?.states)) {
    throw new Error(`Top-level manifest does not contain a states array: ${manifestPath}`);
  }

  const baseUrl = topManifest.baseUrl ?? topManifest.inputUrl ?? inputUrl;
  ACTIVE_SITE_PROFILE = await loadSiteProfile(baseUrl);
  const layout = await createOutputLayout(baseUrl, settings.outDir);
  const sourceStates = await normalizeSourceStates(topManifest, manifestPath, expandedStatesDir, warnings);
  const { analyzed, analyzedStateIds, skippedStateIds } = await buildConcreteStateObservations(sourceStates, warnings);
  const { elements, lookup } = aggregateElements(analyzed, sourceStates);
  const { states, nodes } = buildStateOutputs(analyzed, lookup);
  const edges = buildTransitionEdges(sourceStates);
  const bookContentArtifacts = await resolveBookContentInput(settings, warnings);
  await augmentWithBookContent({
    elements,
    states,
    nodes,
    edges,
    bookContentArtifacts,
    generatedAt: layout.generatedAt,
  });
  await augmentWithJableCategoryTaxonomy({
    elements,
    states,
    warnings,
  });
  augmentWithBilibiliKnowledgeFacts({
    states,
    edges,
  });
  const siteProfile = buildSiteProfile(inputUrl, baseUrl, layout.generatedAt, elements, states, bookContentArtifacts);

  const elementsDocument = buildElementsDocument(inputUrl, baseUrl, layout.generatedAt, elements);
  const statesDocument = buildStatesDocument(inputUrl, baseUrl, layout.generatedAt, states);
  const transitionsDocument = buildTransitionsDocument(inputUrl, baseUrl, layout.generatedAt, nodes, edges);
  const analysisManifest = buildAnalysisManifest({
    inputUrl,
    baseUrl,
    generatedAt: layout.generatedAt,
    outDir: layout.outDir,
    statesManifestPath: manifestPath,
    expandedStatesDir,
    bookContentManifestPath: bookContentArtifacts?.bookContentManifestPath ?? null,
    bookContentDir: bookContentArtifacts?.bookContentDir ?? null,
    analyzedStateIds,
    skippedStateIds,
    elementsPath: layout.elementsPath,
    statesPath: layout.statesPath,
    transitionsPath: layout.transitionsPath,
    siteProfilePath: layout.siteProfilePath,
    manifestPath: layout.manifestPath,
    elements,
    states,
    edges,
    siteProfile,
    sourceStateCount: sourceStates.length,
    warnings,
  });

  await writeJsonFile(layout.elementsPath, elementsDocument);
  await writeJsonFile(layout.statesPath, statesDocument);
  await writeJsonFile(layout.transitionsPath, transitionsDocument);
  await writeJsonFile(layout.siteProfilePath, siteProfile);
  await writeJsonFile(layout.manifestPath, analysisManifest);

  return analysisManifest;
}

export function printHelp() {
  process.stdout.write(`Usage:
  node src/entrypoints/pipeline/analyze-states.mjs <url> --states-manifest <path>
  node src/entrypoints/pipeline/analyze-states.mjs <url> --state-manifest <path>
  node src/entrypoints/pipeline/analyze-states.mjs <url> --expanded-dir <dir>

Options:
  --states-manifest <path>  Path to states-manifest.json
  --state-manifest <path>   Alias for --states-manifest
  --expanded-dir <dir>      Directory containing expanded states output
  --book-content-dir <dir>  Optional book-content output directory
  --book-content-manifest <path> Optional book-content-manifest.json path
  --out-dir <dir>           Root output directory
  --help                    Show this help
`);
}

export function parseCliArgs(argv) {
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
      case '--states-manifest': {
        const { value, nextIndex } = readValue(current, index);
        options.statesManifestPath = value;
        index = nextIndex;
        break;
      }
      case '--state-manifest': {
        const { value, nextIndex } = readValue(current, index);
        options.stateManifestPath = value;
        index = nextIndex;
        break;
      }
      case '--expanded-dir': {
        const { value, nextIndex } = readValue(current, index);
        options.expandedStatesDir = value;
        index = nextIndex;
        break;
      }
      case '--book-content-dir': {
        const { value, nextIndex } = readValue(current, index);
        options.bookContentDir = value;
        index = nextIndex;
        break;
      }
      case '--book-content-manifest': {
        const { value, nextIndex } = readValue(current, index);
        options.bookContentManifestPath = value;
        index = nextIndex;
        break;
      }
      case '--out-dir': {
        const { value, nextIndex } = readValue(current, index);
        options.outDir = value;
        index = nextIndex;
        break;
      }
      case '--help':
        options.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${current}`);
    }
  }

  return { url, options };
}

export async function runCli() {
  initializeCliUtf8();
  try {
    const { url, options } = parseCliArgs(process.argv.slice(2));
    if (options.help || !url) {
      printHelp();
      process.exitCode = options.help ? 0 : 1;
      return;
    }

    const analysisManifest = await analyzeStates(url, options);
    process.stdout.write(`${JSON.stringify(summarizeForStdout(analysisManifest), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

