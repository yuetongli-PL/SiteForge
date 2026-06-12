// @ts-check

import { uniqueSortedStrings } from '../../../shared/normalize.mjs';
import { BUILD_SCHEMA_VERSION, normalizeUrl } from './models.mjs';
import { sanitizeEvidenceRef } from './risk-policy.mjs';
import { sanitizedStructureText } from './structure-sanitizer.mjs';

export function reconciliationRouteKey(urlValue, rootUrl = null) {
  try {
    const normalized = rootUrl ? normalizeUrl(urlValue, rootUrl) : normalizeUrl(urlValue);
    const parsed = new URL(normalized);
    parsed.hash = '';
    parsed.search = '';
    return parsed.toString().replace(/\/$/u, '');
  } catch {
    return String(urlValue ?? '').trim().replace(/[?#].*$/u, '').replace(/\/$/u, '');
  }
}

function reconciliationLinkUrl(link) {
  return link?.normalizedHref ?? link?.normalizedUrl ?? link?.href ?? link?.url ?? null;
}

function reconciliationLinkLabel(link) {
  return String(link?.text ?? link?.label ?? link?.title ?? '').trim();
}

function isConcreteReconciliationUrl(urlValue) {
  const text = String(urlValue ?? '').trim();
  let decodedText = text;
  try {
    decodedText = decodeURIComponent(text);
  } catch {
    decodedText = text;
  }
  const placeholderRoutePattern = /(?:^|\/)(?::[A-Za-z_][A-Za-z0-9_-]*|\{[^}/]+\})(?:\/|$|[?#])/u;
  return Boolean(text)
    && !placeholderRoutePattern.test(text)
    && !placeholderRoutePattern.test(decodedText);
}

function isPlaceholderReconciliationUrl(urlValue) {
  return !isConcreteReconciliationUrl(urlValue);
}

function hasInformativeCategoryLabel(value) {
  const text = String(value ?? '').trim();
  return Boolean(text)
    && text !== '-'
    && !/^link-\d+$/iu.test(text)
    && !/^item-\d+$/iu.test(text);
}

function isActionableMissingCategoryLink(link) {
  const label = reconciliationLinkLabel(link);
  const url = reconciliationLinkUrl(link);
  if (hasInformativeCategoryLabel(label)) {
    return true;
  }
  return !isPlaceholderReconciliationUrl(url);
}

function reconciliationRouteTemplateKey(urlValue, rootUrl = null) {
  const exactKey = reconciliationRouteKey(urlValue, rootUrl);
  const templateKey = sanitizeEvidenceRef(exactKey);
  return templateKey && /^https?:\/\//iu.test(templateKey)
    ? templateKey.replace(/\/$/u, '')
    : null;
}

function isReconciliationContentDetailLink(link) {
  const url = String(reconciliationLinkUrl(link) ?? '').toLowerCase();
  const kind = String(link?.kind ?? link?.semanticKind ?? link?.structureType ?? '').toLowerCase();
  if (/\/(?:book|chapter)\/|\/:segment\/:id\/:id(?:$|[/?#])/iu.test(url)) {
    return true;
  }
  return /(book|chapter|content)[-_ ]?(link|detail|item|card|group)/iu.test(kind)
    || /\b(?:book|chapter|content)-link\b/iu.test(kind);
}

export function isReconciliationCategoryLink(link) {
  if (isReconciliationContentDetailLink(link)) {
    return false;
  }
  const url = String(reconciliationLinkUrl(link) ?? '');
  const label = reconciliationLinkLabel(link);
  const kind = String(link?.kind ?? link?.semanticKind ?? link?.structureType ?? '').toLowerCase();
  const haystack = `${url} ${label} ${kind}`.toLowerCase();
  return /category|categories|genre|genres|channel|channels|section|sections|classify|\bcat\b|分类|类目|類別|频道|頻道|分区|标签|榜单/u.test(haystack);
}

function hasExplicitChallengeSignal(page) {
  const text = [
    page?.normalizedUrl,
    page?.url,
    page?.title,
    page?.pageType,
    page?.publicEvidenceStatus,
    page?.blockerCategory,
  ].join(' ');
  return /楠岃瘉鐮亅楠岃瘉|椋庢帶|瀹夊叏鏍￠獙|涓棿椤祙captcha|challenge|turnstile|verify|checkpoint|cf-mitigated|cdn-cgi\/challenge-platform|cloudflare/iu.test(text);
}

function isChallengeLikePage(page) {
  const text = [
    page?.title,
    page?.pageType,
    page?.publicEvidenceStatus,
    page?.blockerCategory,
    page?.diagnostics?.publicEvidenceStatus,
    page?.diagnostics?.blockerCategory,
    ...(Array.isArray(page?.diagnostics?.warnings) ? page.diagnostics.warnings : []),
  ].join(' ');
  return /验证码|验证|风控|安全校验|中间页|captcha|challenge|turnstile|verify|checkpoint|cf-mitigated|cdn-cgi\/challenge-platform|cloudflare/iu.test(text);
}

export function classifyPageReconciliationOutcome(reasonCodes = /** @type {string[]} */ ([]), challengePages = /** @type {any[]} */ ([])) {
  const codes = new Set(reasonCodes);
  if (codes.has('challenge_or_probe_detected')) {
    const challengeText = challengePages.map((page) => `${page.url ?? ''} ${page.title ?? ''}`).join(' ');
    const primaryReasonCode = /cloudflare|cf-mitigated|cdn-cgi\/challenge-platform/iu.test(challengeText)
      ? 'blocked-by-cloudflare-challenge'
      : 'anti-crawl-verify';
    return {
      status: 'blocked',
      blockerClass: 'external_challenge',
      primaryReasonCode,
      retryDisposition: 'blocked_no_bypass',
    };
  }
  const internalMissingCodes = [
    'category_links_missing_from_graph',
    'category_capability_missing',
    'category_intent_missing',
  ];
  if (internalMissingCodes.some((code) => codes.has(code))) {
    return {
      status: 'failed',
      blockerClass: 'internal_missing',
      primaryReasonCode: 'page-reconciliation-failed',
      retryDisposition: 'retryable_internal',
    };
  }
  if (reasonCodes.length) {
    return {
      status: 'warning',
      blockerClass: 'none',
      primaryReasonCode: null,
      retryDisposition: 'no_retry',
    };
  }
  return {
    status: 'passed',
    blockerClass: 'none',
    primaryReasonCode: null,
    retryDisposition: 'no_retry',
  };
}

function reconciliationGraphUrlSet(graph, context) {
  const urls = { exact: new Set(), templates: new Set() };
  const addGraphUrl = (urlValue) => {
    const exactKey = reconciliationRouteKey(urlValue, context.site.rootUrl);
    urls.exact.add(exactKey);
    const templateKey = reconciliationRouteTemplateKey(urlValue, context.site.rootUrl);
    if (templateKey) {
      urls.templates.add(templateKey);
    }
  };
  for (const node of graph?.nodes ?? []) {
    const urlValue = node.normalizedUrl ?? node.url ?? null;
    if (urlValue) {
      addGraphUrl(urlValue);
    }
    const route = node.routePattern ?? node.routeTemplate ?? null;
    if (route && String(route).startsWith('/')) {
      addGraphUrl(route);
    }
  }
  return urls;
}

function hasChineseText(value) {
  return /[\u3400-\u9fff]/u.test(String(value ?? ''));
}

const PAGE_RECONCILIATION_CATEGORY_TEXT_PATTERN = /categor|category|categories|channel|genre|tag|topic|section|navigation|collections?|lists?|rankings?|classif|book_categories|catalog categories|\u5206\u7c7b|\u6807\u7b7e|\u9891\u9053|\u985e\u5225|\u983b\u9053/iu;

export function buildPageReconciliationReport(context, stageResults, report = /** @type {any} */ ({})) {
  const staticPages = stageResults.crawlStatic?.pages ?? [];
  const renderedPages = stageResults.crawlRendered?.publicRenderedPages ?? stageResults.crawlRendered?.pages ?? [];
  const authPages = stageResults.crawlAuthenticated?.authenticatedPages ?? [];
  const overlayPages = stageResults.crawlAuthenticated?.authenticatedOverlayPages ?? [];
  const allPages = [...staticPages, ...renderedPages, ...authPages, ...overlayPages];
  const challengePages = allPages.filter(isChallengeLikePage).map((page) => ({
    url: sanitizeEvidenceRef(page.normalizedUrl ?? page.url ?? page.sourcePath ?? context.site.rootUrl) ?? null,
    title: sanitizedStructureText(page.title ?? page.pageType ?? 'challenge-like-page', 80, 'challenge-like-page'),
    sourceLayer: page.sourceLayer ?? null,
    reasonCode: 'challenge_or_probe_detected',
    diagnosticOnly: !hasExplicitChallengeSignal(page),
  }));
  const expectedCategoryLinks = [];
  const seenCategoryKeys = new Set();
  const addExpectedCategoryLink = (urlValue, labelValue = '-') => {
    if (!isConcreteReconciliationUrl(urlValue)) {
      return;
    }
    const key = reconciliationRouteKey(urlValue, context.site.rootUrl);
    if (seenCategoryKeys.has(key)) {
      return;
    }
    seenCategoryKeys.add(key);
    expectedCategoryLinks.push({
      url: sanitizeEvidenceRef(urlValue) ?? null,
      routeKey: key,
      routeTemplateKey: reconciliationRouteTemplateKey(urlValue, context.site.rootUrl),
      label: sanitizedStructureText(labelValue, 80, '-'),
    });
  };
  for (const page of allPages) {
    const pageUrl = page.normalizedUrl ?? page.url ?? null;
    const pageLabel = page.pageType ?? page.routeTemplate ?? page.title ?? '-';
    if (pageUrl && isReconciliationCategoryLink({ href: pageUrl, label: pageLabel, kind: page.pageType })) {
      addExpectedCategoryLink(pageUrl, pageLabel);
    }
    for (const link of page.links ?? []) {
      const urlValue = reconciliationLinkUrl(link);
      if (!urlValue || !isReconciliationCategoryLink(link)) {
        continue;
      }
      addExpectedCategoryLink(urlValue, reconciliationLinkLabel(link));
    }
  }
  const graph = stageResults.classifyNodes?.graph ?? stageResults.buildSiteGraph?.graph ?? null;
  const graphUrls = reconciliationGraphUrlSet(graph, context);
  const missingCategoryLinks = expectedCategoryLinks
    .filter((link) => !graphUrls.exact.has(link.routeKey)
      && !(link.routeTemplateKey && graphUrls.templates.has(link.routeTemplateKey)))
    .map(({ routeKey, routeTemplateKey, ...link }) => link);
  const blockingMissingCategoryLinks = missingCategoryLinks.filter(isActionableMissingCategoryLink);
  const capabilities = stageResults.discoverCapabilities?.capabilities ?? [];
  const intents = stageResults.generateIntents?.intents ?? [];
  const categoryCapabilityRecords = capabilities.filter((capability) => PAGE_RECONCILIATION_CATEGORY_TEXT_PATTERN.test([
    capability.name,
    capability.user_facing_name,
    capability.userFacingName,
    capability.userValue,
    capability.object,
    capability.category,
  ].join(' ')));
  const categoryCapabilityIds = new Set(categoryCapabilityRecords
    .map((capability) => capability.id ?? capability.capabilityId)
    .filter(Boolean));
  const categoryCapabilities = categoryCapabilityRecords.map((capability) => ({
    id: capability.id ?? capability.capabilityId ?? null,
    name: sanitizedStructureText(capability.user_facing_name ?? capability.userFacingName ?? capability.userValue ?? capability.name, 100, '-'),
    status: capability.status ?? null,
    enabled_status: capability.enabled_status ?? capability.enabledStatus ?? null,
    hasChineseName: hasChineseText(capability.user_facing_name ?? capability.userFacingName ?? capability.userValue ?? capability.name),
  }));
  const categoryIntentRows = intents.filter((intent) => (
    categoryCapabilityIds.has(intent.capabilityId ?? intent.capability_id)
    || PAGE_RECONCILIATION_CATEGORY_TEXT_PATTERN.test([
      intent.canonicalUtterance,
      intent.canonical_utterance,
      intent.capabilityName,
      intent.capabilityId,
    ].join(' '))
  )).map((intent) => ({
    id: intent.intentId ?? intent.id ?? null,
    capabilityId: intent.capabilityId ?? intent.capability_id ?? null,
    canonicalUtterance: sanitizedStructureText(intent.canonicalUtterance ?? intent.canonical_utterance, 100, '-'),
    callable: intent.callable === true,
    hasChineseUtterance: hasChineseText(intent.canonicalUtterance ?? intent.canonical_utterance),
  }));
  const categoryClosureSatisfied = expectedCategoryLinks.length > 0
    && blockingMissingCategoryLinks.length === 0
    && categoryCapabilities.length > 0
    && categoryIntentRows.length > 0
    && categoryCapabilities.some((capability) => capability.hasChineseName)
    && categoryIntentRows.some((intent) => intent.hasChineseUtterance);
  const explicitChallengePages = challengePages.filter((page) => page.diagnosticOnly !== true);
  const coveredDiagnosticChallengeSignals = categoryClosureSatisfied
    ? challengePages.length - explicitChallengePages.length
    : 0;
  const reasonCodes = [];
  if (explicitChallengePages.length || (challengePages.length && !categoryClosureSatisfied)) reasonCodes.push('challenge_or_probe_detected');
  if (expectedCategoryLinks.length && blockingMissingCategoryLinks.length) reasonCodes.push('category_links_missing_from_graph');
  if (expectedCategoryLinks.length && !categoryCapabilities.length) reasonCodes.push('category_capability_missing');
  if (expectedCategoryLinks.length && categoryCapabilities.length && !categoryIntentRows.length) reasonCodes.push('category_intent_missing');
  if (categoryCapabilities.length && !categoryCapabilities.some((capability) => capability.hasChineseName)) reasonCodes.push('category_capability_missing_chinese_name');
  if (categoryIntentRows.length && !categoryIntentRows.some((intent) => intent.hasChineseUtterance)) reasonCodes.push('category_intent_missing_chinese_utterance');
  if (challengePages.length && !expectedCategoryLinks.length && !categoryCapabilities.length) reasonCodes.push('category_links_not_observed');
  const outcome = classifyPageReconciliationOutcome(reasonCodes, challengePages);
  const { status } = outcome;
  const summary = {
    status,
    blockerClass: outcome.blockerClass,
    primaryReasonCode: outcome.primaryReasonCode,
    retryDisposition: outcome.retryDisposition,
    challengeLikePages: challengePages.length,
    coveredDiagnosticChallengeSignals,
    expectedCategoryLinks: expectedCategoryLinks.length,
    missingCategoryLinks: missingCategoryLinks.length,
    blockingMissingCategoryLinks: blockingMissingCategoryLinks.length,
    categoryCapabilities: categoryCapabilities.length,
    categoryIntents: categoryIntentRows.length,
    reasonCodes: uniqueSortedStrings(reasonCodes),
    needsRerun: outcome.retryDisposition === 'retryable_internal',
    rerunBlocked: outcome.status === 'blocked',
  };
  return {
    schemaVersion: BUILD_SCHEMA_VERSION,
    artifactFamily: 'siteforge-page-reconciliation-report',
    buildId: context.buildId,
    siteId: context.site.id,
    inputUrl: sanitizeEvidenceRef(context.inputUrl ?? context.site.rootUrl) ?? null,
    status,
    resultStatus: report.result_status ?? report.status ?? null,
    summary,
    challengePages,
    expectedCategoryLinks: expectedCategoryLinks.map(({ routeKey, routeTemplateKey, ...link }) => link),
    missingCategoryLinks,
    blockingMissingCategoryLinks,
    categoryCapabilities,
    categoryIntents: categoryIntentRows,
    safety: {
      rawHtmlPersisted: false,
      bodyTextPersisted: false,
      cookiePersisted: false,
      tokenPersisted: false,
      browserProfilePersisted: false,
    },
  };
}
