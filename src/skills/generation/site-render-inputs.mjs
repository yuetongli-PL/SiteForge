// @ts-check

import { markdownLink, renderTable } from '../../shared/markdown.mjs';
import { slugifyAscii, toArray, uniqueSortedStrings } from '../../shared/normalize.mjs';
import { resolveSemanticSiteKey } from '../../sites/core/site-semantics.mjs';
import { displayIntentName as sharedDisplayIntentName, normalizeDisplayLabel } from '../../sites/core/terminology.mjs';
import {
  buildElementsById,
} from './context-indexes.mjs';
import { renderKnownSiteDocument } from './render/site-renderers.mjs';
import {
  resolveSafeActions as resolveSafeActionsImpl,
  siteTerminology as resolveSkillTerminology,
} from './site-capabilities.mjs';
import {
  collect22biquAuthLabels,
  collect22biquCategoryLabels,
  collect22biquKnownAuthors,
  collect22biquKnownBooks,
  collect22biquUtilityLabels,
  collectBilibiliSamples,
  collectDouyinSamples,
  collectJableSamples,
  collectMoodyzSamples,
  getIntentTypes,
} from './site-samples.mjs';

export function resolveKnownSiteKey(context) {
  return resolveSemanticSiteKey(context);
}

export function siteTerminology(context) {
  return resolveSkillTerminology(context);
}

function resolveSafeActions(context) {
  return resolveSafeActionsImpl(context);
}

function displayIntentLabel(context, intentType) {
  const shared = sharedDisplayIntentName(intentType, context.siteContext, context.url);
  if (shared && shared !== String(intentType ?? '')) {
    return shared;
  }
  if (resolveKnownSiteKey(context) === 'moodyz') {
    switch (intentType) {
      case 'download-book':
        return 'download-work';
      case 'open-chapter':
        return 'open-chapter';
      default:
        return String(intentType ?? '');
    }
  }
  return String(intentType ?? '');
}

function intentTitle22Biqu(intentType) {
  switch (intentType) {
    case 'search-book':
      return 'Search book';
    case 'open-book':
      return 'Open book directory';
    case 'open-author':
      return 'Open author page';
    case 'open-chapter':
      return 'Open chapter text';
    case 'download-book':
      return 'Download full book';
    case 'open-category':
      return 'Open category page';
    case 'open-utility-page':
      return 'Open utility page';
    case 'open-auth-page':
      return 'Open auth page';
    default:
      return intentType;
  }
}

function intentSummary22Biqu(intentType) {
  switch (intentType) {
    case 'search-book':
      return 'Submit a book title or author query into the site search box and enter the /ss/ result page.';
    case 'open-book':
      return 'Open a verified book directory page from the home page or a search result.';
    case 'open-author':
      return 'Open the author page linked from a verified book directory.';
    case 'open-chapter':
      return 'Open a verified chapter page and read the public text.';
    case 'download-book':
      return 'Return a local full-book TXT if present; otherwise reuse or generate the host crawler and download the whole public book.';
    case 'open-category':
      return 'Open a verified category page from the site navigation.';
    case 'open-utility-page':
      return 'Open a low-risk utility page such as reading history.';
    case 'open-auth-page':
      return 'Open a login or register page without submitting credentials.';
    default:
      return 'Run only within the observed 22biqu navigation space.';
  }
}

function summarizeBookContent(context) {
  const books = context.booksContentDocument ?? [];
  const authors = context.authorsContentDocument ?? [];
  const matchedQueries = (context.searchResultsDocument ?? []).filter((item) => Number(item.resultCount ?? 0) > 0);
  const noResultQueries = (context.searchResultsDocument ?? [])
    .filter((item) => Number(item.resultCount ?? 0) === 0)
    .map((item) => item.queryText)
    .filter(Boolean);
  const chapterCount = books.reduce((sum, book) => {
    const chapterCountValue = Number(book.chapterCount ?? 0);
    return sum + (Number.isFinite(chapterCountValue) ? chapterCountValue : 0);
  }, 0);
  return {
    books,
    authors,
    matchedQueries,
    noResultQueries: uniqueSortedStrings(noResultQueries),
    chapterCount,
    downloadFiles: books.map((book) => book.downloadFile).filter(Boolean),
  };
}

function resolveContentArtifactPath(context, filePath) {
  return context.mapToKbPath(filePath) ?? filePath;
}

function buildKnownSiteRenderInput(context, outputs, docsByIntent = new Map()) {
  return {
    context,
    outputs,
    docsByIntent,
    helpers: {
      markdownLink,
      renderTable,
      slugifyAscii,
      normalizeDisplayLabel,
      siteTerminology,
      displayIntentLabel,
      getIntentTypes,
      collectMoodyzSamples,
      collectJableSamples,
      collectBilibiliSamples,
      collectDouyinSamples,
      collect22biquKnownBooks,
      collect22biquKnownAuthors,
      collect22biquCategoryLabels,
      collect22biquUtilityLabels,
      collect22biquAuthLabels,
      intentTitle22Biqu,
      intentSummary22Biqu,
      buildElementsById,
      resolveSafeActions,
      summarizeBookContent,
      resolveContentArtifactPath,
    },
  };
}

function renderKnownSiteDocumentFor(context, kind, outputs, docsByIntent = new Map()) {
  const siteKey = resolveKnownSiteKey(context);
  if (!siteKey) {
    return null;
  }
  const resolvedOutputs = resolveKnownSiteOutputs(siteKey, kind, outputs);
  return renderKnownSiteDocument(siteKey, kind, buildKnownSiteRenderInput(context, resolvedOutputs, docsByIntent));
}

function resolveKnownSiteOutputs(siteKey, kind, outputs) {
  if (kind === 'nlIntents') {
    return siteKey === 'moodyz' ? outputs : null;
  }
  if (kind === 'interactionModel') {
    return siteKey === 'jable' ? null : outputs;
  }
  return outputs;
}

export function renderKnownSiteSkillMd(context, outputs) {
  return renderKnownSiteDocumentFor(context, 'skill', outputs);
}

export function renderKnownSiteIndexReference(context, outputs, docsByIntent) {
  return renderKnownSiteDocumentFor(context, 'index', outputs, docsByIntent);
}

export function renderKnownSiteFlowsReference(context, outputs, docsByIntent) {
  return renderKnownSiteDocumentFor(context, 'flows', outputs, docsByIntent);
}

export function renderKnownSiteNlIntentsReference(context, outputs) {
  return renderKnownSiteDocumentFor(context, 'nlIntents', outputs);
}

export function renderKnownSiteInteractionModelReference(context, outputs) {
  return renderKnownSiteDocumentFor(context, 'interactionModel', outputs);
}

export function renderKnownSiteRecoveryReference(context) {
  if (resolveKnownSiteKey(context) !== '22biqu') {
    return null;
  }
  return [
    '# Recovery',
    '',
    '## Common failures',
    '',
    '| Failure | Trigger | Recovery |',
    '| --- | --- | --- |',
    '| missing-slot | User asks to open a book or chapter without enough identifying text. | Ask for the missing book title, author name, or chapter reference. |',
    '| ambiguous-target | More than one candidate matches the given title or author. | Ask the user to disambiguate. |',
    '| search-no-results | Search result count is zero. | Suggest a shorter query, an author name, or a different title. |',
    '| stale-search-cache | A search snippet or older paginated page shows outdated author/latest-chapter/update-time metadata. | Re-fetch the live book directory root URL and, if needed, the final directory page; trust `og:novel:lastest_chapter_name` and `og:novel:update_time` over search snippets. |',
    '| chapter-not-found | The book exists but the requested chapter cannot be mapped. | Return to the directory page and retry with an exact chapter title or a `Chapter N` reference. |',
    '| artifact-stale | A local TXT exists but is incomplete or in an old format. | Recrawl and regenerate the full-book artifact. |',
    '| approval-required | The request would submit auth data or leave the verified site boundary. | Stop and request human approval. |',
    '',
    '## Runtime guidance',
    '',
    '- Retry search with a shorter query or the author name if the first query returns no results.',
    '- Search results are for locating the book only; verify fresh metadata from the live `/biqu.../` directory page before answering author/latest/update-time questions.',
    '- If a chapter lookup fails, confirm the book title first, then the chapter title or number.',
    '- If download is interrupted, rerun the same command; a valid local full-book artifact will be reused on later runs.',
  ].join('\n');
}

export function renderKnownSiteApprovalReference(context) {
  if (resolveKnownSiteKey(context) !== '22biqu') {
    return null;
  }
  const safeActions = resolveSafeActions(context);
  return [
    '# Approval',
    '',
    '## Safe action allowlist',
    '',
    `- \`${safeActions.join('`, `')}\``,
    '',
    '## Approval-required cases',
    '',
    '- Login or register form submission',
    '- Any unknown form submission',
    '- Leaving the verified `www.22biqu.com` URL family',
    '- Any side-effect action that is not on the safe allowlist',
    '',
    '## Current site boundary',
    '',
    '- Searching books, opening directories, opening author pages, reading chapter text, and downloading public book content are low-risk flows.',
    '- Navigation to login or register pages is allowed, but credential submission is not automatic.',
  ].join('\n');
}
