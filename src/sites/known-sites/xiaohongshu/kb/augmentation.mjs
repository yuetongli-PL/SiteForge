// @ts-check

import {
  cleanText,
  normalizeUrlNoFragment,
  toArray,
  uniqueSortedStrings,
} from '../../../../shared/normalize.mjs';

function normalizeCard(card) {
  const normalized = {
    title: cleanText(card?.title) || null,
    url: normalizeUrlNoFragment(card?.url) || null,
    noteId: cleanText(card?.noteId) || null,
    authorName: cleanText(card?.authorName) || null,
    authorUrl: normalizeUrlNoFragment(card?.authorUrl) || null,
    authorUserId: cleanText(card?.authorUserId) || null,
    contentType: cleanText(card?.contentType) || null,
  };
  return Object.values(normalized).some(Boolean) ? normalized : null;
}

function dedupeCards(cards) {
  const seen = new Set();
  const result = /** @type {any[]} */ ([]);
  for (const card of toArray(cards)) {
    const normalized = normalizeCard(card);
    if (!normalized) {
      continue;
    }
    const key = normalized.noteId
      ? `note:${normalized.noteId}`
      : normalized.url
        ? `url:${normalized.url}`
        : `${normalized.title ?? ''}::${normalized.authorUserId ?? ''}`;
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

function cleanStringList(values) {
  return uniqueSortedStrings(toArray(values).map((value) => cleanText(value)).filter(Boolean));
}

export function buildXiaohongshuStateAttributeFacts(pageFacts) {
  if (!pageFacts || typeof pageFacts !== 'object') {
    return null;
  }

  const featuredContentCards = dedupeCards(pageFacts.featuredContentCards).slice(0, 5);
  const facts = {
    noteId: cleanText(pageFacts.noteId) || null,
    noteTitle: cleanText(pageFacts.noteTitle) || null,
    contentTitle: cleanText(pageFacts.contentTitle) || null,
    authorName: cleanText(pageFacts.authorName) || null,
    authorUserId: cleanText(pageFacts.authorUserId ?? pageFacts.userId) || null,
    userName: cleanText(pageFacts.userName) || null,
    queryText: cleanText(pageFacts.queryText) || null,
    resultCount: Number.isFinite(pageFacts.resultCount) ? Number(pageFacts.resultCount) : null,
    resultNoteIds: cleanStringList(pageFacts.resultNoteIds),
    resultAuthorUserIds: cleanStringList(pageFacts.resultAuthorUserIds),
    categoryName: cleanText(pageFacts.categoryName) || null,
    featuredContentCards,
    featuredContentCardCount: Number(pageFacts.featuredContentCount ?? featuredContentCards.length) || 0,
    featuredContentComplete: typeof pageFacts.featuredContentComplete === 'boolean'
      ? pageFacts.featuredContentComplete
      : (featuredContentCards.length > 0 ? true : null),
  };

  return Object.values(facts).some((value) => (
    Array.isArray(value) ? value.length > 0 : value !== null && value !== ''
  )) ? facts : null;
}

function resolveXiaohongshuStateFacts({ state, page }) {
  const pageAttributes = page?.attributes;
  if (pageAttributes?.xiaohongshuFacts) {
    return pageAttributes.xiaohongshuFacts;
  }
  if (state?.attributes?.xiaohongshuFacts) {
    return state.attributes.xiaohongshuFacts;
  }
  return buildXiaohongshuStateAttributeFacts(state?.pageFacts);
}

export function summarizeXiaohongshuKnowledgeFacts(states) {
  const noteIds = new Set();
  const authorUserIds = new Set();
  const queries = new Set();
  const categories = new Set();
  const featuredContentCards = /** @type {any[]} */ ([]);
  const seenFeatured = new Set();

  for (const state of toArray(states)) {
    const facts = resolveXiaohongshuStateFacts({ state, page: null });
    if (!facts) {
      continue;
    }

    if (facts.noteId) {
      noteIds.add(facts.noteId);
    }
    if (facts.authorUserId) {
      authorUserIds.add(facts.authorUserId);
    }
    if (facts.queryText) {
      queries.add(facts.queryText);
    }
    if (facts.categoryName) {
      categories.add(facts.categoryName);
    }
    for (const value of toArray(facts.resultNoteIds)) {
      if (value) {
        noteIds.add(value);
      }
    }
    for (const value of toArray(facts.resultAuthorUserIds)) {
      if (value) {
        authorUserIds.add(value);
      }
    }
    for (const card of toArray(facts.featuredContentCards)) {
      const normalized = normalizeCard(card);
      if (!normalized) {
        continue;
      }
      if (normalized.noteId) {
        noteIds.add(normalized.noteId);
      }
      if (normalized.authorUserId) {
        authorUserIds.add(normalized.authorUserId);
      }
      const key = normalized.noteId
        ? `note:${normalized.noteId}`
        : normalized.url
          ? `url:${normalized.url}`
          : `${normalized.title ?? ''}::${normalized.authorUserId ?? ''}`;
      if (!key || seenFeatured.has(key)) {
        continue;
      }
      seenFeatured.add(key);
      featuredContentCards.push(normalized);
    }
  }

  return {
    noteIds: uniqueSortedStrings([...noteIds]),
    authorUserIds: uniqueSortedStrings([...authorUserIds]),
    searchQueries: uniqueSortedStrings([...queries]),
    categories: uniqueSortedStrings([...categories]),
    featuredContentCards: featuredContentCards.slice(0, 8),
  };
}

export function renderXiaohongshuStateSections({
  state,
  page,
  renderTable,
  mdEscape,
}) {
  const facts = resolveXiaohongshuStateFacts({ state, page });
  if (!facts) {
    return [];
  }

  const factRows = /** @type {any[]} */ ([]);
  if (facts.noteId) {
    factRows.push({ field: 'Note ID', value: `\`${facts.noteId}\`` });
  }
  if (facts.noteTitle) {
    factRows.push({ field: 'Note Title', value: mdEscape(facts.noteTitle) });
  }
  if (facts.contentTitle && facts.contentTitle !== facts.noteTitle) {
    factRows.push({ field: 'Content Title', value: mdEscape(facts.contentTitle) });
  }
  if (facts.authorName) {
    factRows.push({ field: 'Author Name', value: mdEscape(facts.authorName) });
  }
  if (facts.authorUserId) {
    factRows.push({ field: 'Author User ID', value: `\`${facts.authorUserId}\`` });
  }
  if (facts.userName) {
    factRows.push({ field: 'User Name', value: mdEscape(facts.userName) });
  }
  if (facts.queryText) {
    factRows.push({ field: 'Query Text', value: mdEscape(facts.queryText) });
  }
  if (facts.resultCount !== null) {
    factRows.push({ field: 'Result Count', value: String(facts.resultCount) });
  }
  if (facts.resultNoteIds.length > 0) {
    factRows.push({ field: 'Result Note IDs', value: facts.resultNoteIds.map((value) => `\`${value}\``).join(', ') });
  }
  if (facts.resultAuthorUserIds.length > 0) {
    factRows.push({ field: 'Result Author User IDs', value: facts.resultAuthorUserIds.map((value) => `\`${value}\``).join(', ') });
  }
  if (facts.categoryName) {
    factRows.push({ field: 'Category', value: mdEscape(facts.categoryName) });
  }
  if (facts.featuredContentCardCount > 0) {
    factRows.push({ field: 'Featured Note Count', value: String(facts.featuredContentCardCount) });
  }
  if (typeof facts.featuredContentComplete === 'boolean') {
    factRows.push({ field: 'Featured Note Complete', value: facts.featuredContentComplete ? 'yes' : 'no' });
  }

  const featuredRows = toArray(facts.featuredContentCards).map((card) => ({
    title: mdEscape(card.title || '-'),
    noteId: card.noteId ? `\`${card.noteId}\`` : '-',
    author: mdEscape(card.authorName || '-'),
    authorUserId: card.authorUserId ? `\`${card.authorUserId}\`` : '-',
  }));

  if (factRows.length === 0 && featuredRows.length === 0) {
    return [];
  }

  return [
    '## Surfaced Xiaohongshu facts',
    '',
    factRows.length > 0
      ? renderTable(['Field', 'Value'], factRows)
      : '- No state-level Xiaohongshu facts.',
    '',
    '## Featured Note Cards',
    '',
    featuredRows.length > 0
      ? renderTable(['Title', 'Note ID', 'Author', 'Author User ID'], featuredRows)
      : '- No featured note cards.',
    '',
  ];
}

export function renderXiaohongshuOverviewSections({ model, renderTable, mdEscape }) {
  const summary = summarizeXiaohongshuKnowledgeFacts(model.states);
  if (
    summary.noteIds.length === 0
    && summary.authorUserIds.length === 0
    && summary.searchQueries.length === 0
    && summary.categories.length === 0
    && summary.featuredContentCards.length === 0
  ) {
    return [];
  }

  const featuredRows = summary.featuredContentCards.map((card) => ({
    title: mdEscape(card.title || '-'),
    noteId: card.noteId ? `\`${card.noteId}\`` : '-',
    author: mdEscape(card.authorName || '-'),
    authorUserId: card.authorUserId ? `\`${card.authorUserId}\`` : '-',
  }));

  return [
    '## Surfaced Xiaohongshu facts',
    '',
    `- Note IDs: ${summary.noteIds.map((value) => `\`${value}\``).join(', ') || '-'}`,
    `- Author user IDs: ${summary.authorUserIds.map((value) => `\`${value}\``).join(', ') || '-'}`,
    `- Search queries: ${summary.searchQueries.map((value) => mdEscape(value)).join(', ') || '-'}`,
    `- Categories: ${summary.categories.map((value) => mdEscape(value)).join(', ') || '-'}`,
    '',
    '### Featured note cards',
    '',
    featuredRows.length > 0
      ? renderTable(['Title', 'Note ID', 'Author', 'Author User ID'], featuredRows)
      : '- No featured note cards.',
    '',
  ];
}

export const xiaohongshuKnowledgeBaseAugmentation = Object.freeze({
  buildOverviewAttributes(model) {
    return {
      xiaohongshuFacts: summarizeXiaohongshuKnowledgeFacts(model.states),
    };
  },
  buildStateAttributes(state) {
    const xiaohongshuFacts = buildXiaohongshuStateAttributeFacts(state?.pageFacts);
    return xiaohongshuFacts ? { xiaohongshuFacts } : {};
  },
  renderOverviewSections(args) {
    return renderXiaohongshuOverviewSections(args);
  },
  renderStateSections(args) {
    return renderXiaohongshuStateSections(args);
  },
});
