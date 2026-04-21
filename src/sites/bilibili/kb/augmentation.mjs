// @ts-check

import { cleanText, toArray } from '../../../shared/normalize.mjs';
import { summarizeBilibiliKnowledgeFacts } from '../model/surfacing.mjs';

export function buildBilibiliStateAttributeFacts(pageFacts) {
  if (!pageFacts) {
    return null;
  }
  const featuredAuthorCards = toArray(pageFacts.featuredAuthorCards).slice(0, 5).map((author) => ({
    name: author?.name ?? null,
    url: author?.url ?? null,
    mid: author?.mid ?? null,
    authorSubpage: author?.authorSubpage ?? null,
    cardKind: author?.cardKind ?? null,
  }));
  const featuredContentCards = toArray(pageFacts.featuredContentCards).slice(0, 5).map((card) => ({
    title: card?.title ?? null,
    url: card?.url ?? null,
    bvid: card?.bvid ?? null,
    authorMid: card?.authorMid ?? null,
    contentType: card?.contentType ?? null,
  }));
  const featuredAuthors = (featuredAuthorCards.length > 0 ? featuredAuthorCards : toArray(pageFacts.featuredAuthors)).slice(0, 5).map((author) => ({
    name: author?.name ?? null,
    url: author?.url ?? null,
    mid: author?.mid ?? null,
  }));
  const facts = {
    bv: pageFacts.bv ?? pageFacts.bvid ?? null,
    authorMid: pageFacts.authorMid ?? null,
    searchFamily: pageFacts.searchFamily ?? null,
    queryText: pageFacts.queryText ?? null,
    contentType: pageFacts.contentType ?? null,
    firstResultContentType: pageFacts.firstResultContentType ?? pageFacts.resultContentTypes?.[0] ?? null,
    authorSubpage: pageFacts.authorSubpage ?? null,
    authenticatedReadOnlySurface: pageFacts.authenticatedReadOnlySurface === true,
    categoryName: pageFacts.categoryName ?? null,
    categoryPath: pageFacts.categoryPath ?? null,
    featuredAuthorCount: Number(pageFacts.featuredAuthorCount ?? featuredAuthors.length ?? 0) || 0,
    featuredAuthorCards,
    featuredAuthors,
    featuredContentCount: Number(pageFacts.featuredContentCount ?? featuredContentCards.length ?? 0) || 0,
    featuredContentCards,
  };
  return Object.values(facts).some((value) => (
    Array.isArray(value) ? value.length > 0 : value !== null && value !== ''
  )) ? facts : null;
}

function resolveBilibiliStateFacts({ state, page }) {
  const pageAttributes = page?.attributes;
  if (pageAttributes?.bilibiliFacts) {
    return pageAttributes.bilibiliFacts;
  }
  if (state?.attributes?.bilibiliFacts) {
    return state.attributes.bilibiliFacts;
  }
  return buildBilibiliStateAttributeFacts(state?.pageFacts);
}

function renderBilibiliAuthorSummary(authors, mdEscape) {
  return toArray(authors)
    .map((author) => {
      const parts = [
        cleanText(author?.name) || null,
        author?.mid ? `MID ${author.mid}` : null,
      ].filter(Boolean);
      return parts.join(' | ');
    })
    .filter(Boolean)
    .map((value) => mdEscape(value))
    .join(' ; ');
}

export function renderBilibiliStateSections({
  state,
  page,
  renderTable,
  mdEscape,
}) {
  const bilibiliFacts = resolveBilibiliStateFacts({ state, page });
  if (!bilibiliFacts) {
    return [];
  }

  const factRows = [];
  if (bilibiliFacts.searchFamily) {
    factRows.push({ field: 'Search Family', value: `\`${cleanText(bilibiliFacts.searchFamily)}\`` });
  }
  if (bilibiliFacts.bv) {
    factRows.push({ field: 'BV', value: `\`${cleanText(bilibiliFacts.bv)}\`` });
  }
  if (bilibiliFacts.authorMid) {
    factRows.push({ field: 'UP Mid', value: `\`${cleanText(bilibiliFacts.authorMid)}\`` });
  }
  if (bilibiliFacts.contentType) {
    factRows.push({ field: 'Content Type', value: `\`${cleanText(bilibiliFacts.contentType)}\`` });
  }
  if (bilibiliFacts.firstResultContentType) {
    factRows.push({ field: 'First Result Type', value: `\`${cleanText(bilibiliFacts.firstResultContentType)}\`` });
  }
  if (bilibiliFacts.authorSubpage) {
    factRows.push({ field: 'Author Subpage', value: `\`${cleanText(bilibiliFacts.authorSubpage)}\`` });
  }
  if (bilibiliFacts.authenticatedReadOnlySurface) {
    factRows.push({ field: 'Authenticated Read-only Surface', value: 'yes' });
  }
  if (Number.isFinite(bilibiliFacts.featuredAuthorCount) && bilibiliFacts.featuredAuthorCount > 0) {
    factRows.push({ field: 'Featured Author Count', value: String(bilibiliFacts.featuredAuthorCount) });
  }
  const featuredAuthorSummary = renderBilibiliAuthorSummary(bilibiliFacts.featuredAuthors, mdEscape);
  if (featuredAuthorSummary) {
    factRows.push({ field: 'Featured Authors', value: featuredAuthorSummary });
  }
  if (Number.isFinite(bilibiliFacts.featuredContentCount) && bilibiliFacts.featuredContentCount > 0) {
    factRows.push({ field: 'Featured Content Count', value: String(bilibiliFacts.featuredContentCount) });
  }
  if (bilibiliFacts.categoryName) {
    factRows.push({ field: 'Category', value: mdEscape(String(bilibiliFacts.categoryName)) });
  }
  if (bilibiliFacts.categoryPath) {
    factRows.push({ field: 'Category Path', value: `\`${String(bilibiliFacts.categoryPath).trim()}\`` });
  }

  const featuredCards = toArray(bilibiliFacts.featuredContentCards).map((card) => ({
    title: mdEscape(cleanText(card?.title) || cleanText(card?.bvid) || cleanText(card?.url) || '-'),
    contentType: cleanText(card?.contentType) || '-',
    bvid: cleanText(card?.bvid) || '-',
    authorMid: cleanText(card?.authorMid) || '-',
  }));
  const featuredAuthorCards = toArray(bilibiliFacts.featuredAuthorCards).map((author) => ({
    name: mdEscape(cleanText(author?.name) || '-'),
    mid: cleanText(author?.mid) || '-',
    url: mdEscape(cleanText(author?.url) || '-'),
    authorSubpage: cleanText(author?.authorSubpage) || cleanText(bilibiliFacts.authorSubpage) || '-',
  }));

  if (factRows.length === 0 && featuredCards.length === 0 && featuredAuthorCards.length === 0) {
    return [];
  }

  const sections = [];
  if (factRows.length > 0) {
    sections.push(
      '## Surfaced bilibili facts',
      '',
      renderTable(['Field', 'Value'], factRows),
      '',
    );
  }
  sections.push(
    '## Featured Content Cards',
    '',
    featuredCards.length > 0
      ? renderTable(['Title', 'Content Type', 'BV', 'UP Mid'], featuredCards)
      : '- No featured content cards.',
    '',
  );
  sections.push(
    '## Featured Author Cards',
    '',
    featuredAuthorCards.length > 0
      ? renderTable(['Name', 'MID', 'Author URL', 'Author Subpage'], featuredAuthorCards)
      : '- No featured author cards.',
    '',
  );
  return sections;
}

export function renderBilibiliOverviewSections({ model, renderTable, mdEscape }) {
  const summary = summarizeBilibiliKnowledgeFacts(model.states);
  if (
    summary.videoCodes.length === 0
    && summary.authorMids.length === 0
    && summary.searchFamilies.length === 0
    && summary.featuredAuthors.length === 0
    && summary.authenticatedSurfaceKinds.length === 0
    && summary.featuredContentCards.length === 0
  ) {
    return [];
  }
  const featuredCardSummary = summary.featuredContentCards
    .slice(0, 5)
    .map((card) => {
      const parts = [
        card.title ?? null,
        card.bvid ? `BV ${card.bvid}` : null,
        card.authorMid ? `MID ${card.authorMid}` : null,
      ].filter(Boolean);
      return parts.join(' | ');
    })
    .filter(Boolean);
  const featuredAuthorSummary = summary.featuredAuthors
    .slice(0, 5)
    .map((author) => {
      const parts = [
        author.name ?? null,
        author.mid ? `MID ${author.mid}` : null,
      ].filter(Boolean);
      return parts.join(' | ');
    })
    .filter(Boolean);
  const authenticatedSurfaceRows = toArray(summary.authenticatedSurfaceSummaries)
    .slice(0, 5)
    .map((surface) => ({
      authorSubpage: mdEscape(cleanText(surface.authorSubpage) || '-'),
      featuredAuthors: String(Number.isFinite(surface.featuredAuthorCount) ? surface.featuredAuthorCount : 0),
      featuredContent: String(Number.isFinite(surface.featuredContentCount) ? surface.featuredContentCount : 0),
      antiCrawlSignals: toArray(surface.antiCrawlSignals).map((value) => cleanText(value)).filter(Boolean).join(', ') || '-',
      state: mdEscape(cleanText(surface.stateId) || '-'),
    }));
  return [
    '## Surfaced bilibili facts',
    '',
    `- Video codes: ${summary.videoCodes.join(', ') || '-'}`,
    `- Author mids: ${summary.authorMids.join(', ') || '-'}`,
    `- Search families: ${summary.searchFamilies.join(', ') || '-'}`,
    `- Authenticated session active during compilation: ${summary.authenticatedSessionObserved ? 'yes' : 'no'}`,
    `- Authenticated read-only surfaces: ${summary.authenticatedSurfaceKinds.join(', ') || '-'}`,
    `- Featured authors: ${featuredAuthorSummary.join(' ; ') || '-'}`,
    `- Featured content cards: ${featuredCardSummary.join(' ; ') || '-'}`,
    '',
    '### Authenticated surface summaries',
    '',
    authenticatedSurfaceRows.length > 0
      ? renderTable(['Author Subpage', 'Featured Authors', 'Featured Content', 'Anti-crawl Signals', 'State'], authenticatedSurfaceRows)
      : '- No authenticated surface summaries.',
    '',
  ];
}

export const bilibiliKnowledgeBaseAugmentation = Object.freeze({
  buildOverviewAttributes(model) {
    return {
      bilibiliFacts: summarizeBilibiliKnowledgeFacts(model.states),
    };
  },
  buildStateAttributes(state) {
    const bilibiliFacts = buildBilibiliStateAttributeFacts(state?.pageFacts);
    return bilibiliFacts ? { bilibiliFacts } : {};
  },
  renderOverviewSections(args) {
    return renderBilibiliOverviewSections(args);
  },
  renderStateSections(args) {
    return renderBilibiliStateSections(args);
  },
});
