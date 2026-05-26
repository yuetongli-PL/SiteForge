// @ts-check

export const CANONICAL_SUPPORTED_INTENTS = new Set([
  'account-info',
  'download-book',
  'download-media',
  'download-note',
  'download-video',
  'full-archive',
  'list-author-following',
  'list-category-videos',
  'list-followed-updates',
  'list-followed-users',
  'list-profile-content',
  'open-actress',
  'open-auth-page',
  'open-author',
  'open-book',
  'open-category',
  'open-chapter',
  'open-model',
  'open-note',
  'open-post',
  'open-reel',
  'open-utility-page',
  'open-video',
  'open-work',
  'profile-content',
  'search-book',
  'search-content',
  'search-note',
  'search-posts',
  'search-video',
  'search-work',
]);

export const CANONICAL_CAPABILITY_FAMILIES = new Set([
  'download-content',
  'navigate-to-author',
  'navigate-to-category',
  'navigate-to-chapter',
  'navigate-to-content',
  'navigate-to-utility-page',
  'open-auth-page',
  'query-account-profile',
  'query-social-content',
  'query-social-relations',
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
  'list-author-following': ['query-social-relations'],
  'list-category-videos': ['navigate-to-category'],
  'list-followed-updates': ['query-social-content'],
  'list-followed-users': ['query-social-relations'],
  'list-profile-content': ['query-social-content'],
  'list-recommended-timeline-posts': ['query-social-content'],
  'open-actress': ['navigate-to-author'],
  'open-auth-page': ['open-auth-page'],
  'open-author': ['navigate-to-author'],
  'open-book': ['navigate-to-content'],
  'open-category': ['navigate-to-category'],
  'open-chapter': ['navigate-to-chapter'],
  'open-model': ['navigate-to-author'],
  'open-note': ['navigate-to-content'],
  'open-post': ['navigate-to-content'],
  'open-reel': ['navigate-to-content'],
  'open-utility-page': ['navigate-to-utility-page'],
  'open-video': ['navigate-to-content'],
  'open-work': ['navigate-to-content'],
  'profile-content': ['query-social-content'],
  'recommended-timeline-posts': ['query-social-content'],
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
