// @ts-check

export const CANONICAL_SUPPORTED_INTENTS = new Set([
  'account-info',
  'download-book',
  'download-media',
  'download-note',
  'download-video',
  'full-archive',
  'list-author-following',
  'list-account-library',
  'list-chat-messages',
  'list-comment-thread',
  'list-community-collections',
  'list-community-directory',
  'list-community-posts',
  'list-community-rules',
  'list-category-videos',
  'list-followed-updates',
  'list-followed-users',
  'list-inbox-messages',
  'list-modmail-threads',
  'list-moderation-log',
  'list-moderation-queue',
  'list-notifications',
  'list-profile-content',
  'open-actress',
  'open-auth-page',
  'open-author',
  'open-book',
  'open-category',
  'open-chapter',
  'open-comment',
  'open-model',
  'open-media',
  'open-note',
  'open-poll',
  'open-post',
  'open-reel',
  'open-settings-page',
  'open-utility-page',
  'open-video',
  'open-work',
  'profile-content',
  'read-wiki-page',
  'record-disabled-award',
  'record-disabled-comment',
  'record-disabled-modmail',
  'record-disabled-report',
  'record-disabled-save',
  'record-disabled-submit',
  'record-disabled-vote',
  'search-book',
  'search-content',
  'search-note',
  'search-posts',
  'search-video',
  'search-work',
]);

export const CANONICAL_CAPABILITY_FAMILIES = new Set([
  'download-content',
  'disabled-social-mutation',
  'navigate-to-author',
  'navigate-to-category',
  'navigate-to-chapter',
  'navigate-to-content',
  'navigate-to-utility-page',
  'open-auth-page',
  'query-account-profile',
  'query-comment-thread',
  'query-community-metadata',
  'query-media-content',
  'query-moderation-content',
  'query-notifications',
  'query-private-messages',
  'query-social-content',
  'query-social-relations',
  'query-wiki-content',
  'search-content',
  'switch-in-page-state',
]);

const INTENT_FAMILY_CANDIDATES = Object.freeze({
  'account-info': ['query-account-profile'],
  'download-book': ['download-content'],
  'download-media': ['download-content'],
  'download-note': ['download-content'],
  'download-video': ['download-content'],
  'full-archive': ['download-content'],
  'list-account-library': ['query-account-profile'],
  'list-author-following': ['query-social-relations'],
  'list-chat-messages': ['query-private-messages'],
  'list-category-videos': ['navigate-to-category'],
  'list-comment-thread': ['query-comment-thread', 'query-social-content'],
  'list-community-collections': ['query-community-metadata', 'query-social-content'],
  'list-community-directory': ['query-community-metadata', 'navigate-to-category'],
  'list-community-posts': ['query-social-content', 'navigate-to-category'],
  'list-community-rules': ['query-community-metadata'],
  'list-followed-updates': ['query-social-content'],
  'list-followed-users': ['query-social-relations'],
  'list-inbox-messages': ['query-private-messages'],
  'list-modmail-threads': ['query-moderation-content', 'query-private-messages'],
  'list-moderation-log': ['query-moderation-content'],
  'list-moderation-queue': ['query-moderation-content'],
  'list-notifications': ['query-notifications'],
  'list-profile-content': ['query-social-content'],
  'list-recommended-timeline-posts': ['query-social-content'],
  'open-actress': ['navigate-to-author'],
  'open-auth-page': ['open-auth-page'],
  'open-author': ['navigate-to-author'],
  'open-book': ['navigate-to-content'],
  'open-category': ['navigate-to-category'],
  'open-chapter': ['navigate-to-chapter'],
  'open-comment': ['query-comment-thread', 'navigate-to-content'],
  'open-media': ['query-media-content', 'navigate-to-content'],
  'open-model': ['navigate-to-author'],
  'open-note': ['navigate-to-content'],
  'open-poll': ['query-social-content', 'navigate-to-content'],
  'open-post': ['navigate-to-content'],
  'open-reel': ['navigate-to-content'],
  'open-settings-page': ['navigate-to-utility-page'],
  'open-utility-page': ['navigate-to-utility-page'],
  'open-video': ['navigate-to-content'],
  'open-work': ['navigate-to-content'],
  'profile-content': ['query-social-content'],
  'read-wiki-page': ['query-wiki-content'],
  'recommended-timeline-posts': ['query-social-content'],
  'record-disabled-award': ['disabled-social-mutation'],
  'record-disabled-comment': ['disabled-social-mutation'],
  'record-disabled-modmail': ['disabled-social-mutation'],
  'record-disabled-report': ['disabled-social-mutation'],
  'record-disabled-save': ['disabled-social-mutation'],
  'record-disabled-submit': ['disabled-social-mutation'],
  'record-disabled-vote': ['disabled-social-mutation'],
  'search-book': ['search-content'],
  'search-content': ['search-content'],
  'search-note': ['search-content'],
  'search-posts': ['search-content', 'query-social-content'],
  'search-video': ['search-content'],
  'search-work': ['search-content'],
});

function normalizeToken(value) {
  return String(value ?? '').trim();
}

function normalizeList(values = []) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map(normalizeToken)
    .filter(Boolean))];
}

function resolveStrictCapabilityFamily(intent, families) {
  const normalizedIntent = normalizeToken(intent);
  const normalizedFamilies = normalizeList(families);
  if (!normalizedIntent) {
    return null;
  }
  if (normalizedFamilies.includes(normalizedIntent)) {
    return normalizedIntent;
  }
  for (const family of INTENT_FAMILY_CANDIDATES[normalizedIntent] ?? []) {
    if (normalizedFamilies.includes(family)) {
      return family;
    }
  }
  return null;
}

export function resolveCapabilityFamilyForIntent(intent, families = [], { allowFallback = true } = /** @type {any} */ ({})) {
  const normalizedIntent = normalizeToken(intent);
  const normalizedFamilies = normalizeList(families);
  const strict = resolveStrictCapabilityFamily(normalizedIntent, normalizedFamilies);
  if (strict) {
    return strict;
  }
  if (!allowFallback) {
    return null;
  }
  return normalizedFamilies[0] ?? normalizedIntent;
}

export function explainCapabilityIntentMapping(intent, families = []) {
  const normalizedIntent = normalizeToken(intent);
  const normalizedFamilies = normalizeList(families);
  const exact = normalizedFamilies.includes(normalizedIntent);
  const strict = resolveStrictCapabilityFamily(normalizedIntent, normalizedFamilies);
  if (strict) {
    return {
      status: 'mapped',
      intent: normalizedIntent,
      capabilityFamily: strict,
      reason: exact ? 'exact-family-match' : 'canonical-intent-family-map',
    };
  }
  const fallback = resolveCapabilityFamilyForIntent(normalizedIntent, normalizedFamilies, { allowFallback: true });
  return {
    status: fallback ? 'fallback' : 'unmapped',
    intent: normalizedIntent,
    capabilityFamily: fallback || null,
    reason: CANONICAL_SUPPORTED_INTENTS.has(normalizedIntent) ? 'declared-family-missing' : 'unknown-intent',
  };
}

export function policySupportsCapabilityFamily(policy, family) {
  const normalizedFamily = normalizeToken(family);
  if (!normalizedFamily) {
    return false;
  }
  const families = normalizeList(policy?.capabilityFamilies);
  if (families.includes(normalizedFamily)) {
    return true;
  }
  const supportedIntents = normalizeList(policy?.supportedIntents);
  const availableFamilies = families.length ? families : [...CANONICAL_CAPABILITY_FAMILIES];
  return supportedIntents.some((intent) => (
    resolveCapabilityFamilyForIntent(intent, availableFamilies, { allowFallback: false }) === normalizedFamily
  ));
}
