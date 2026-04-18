// @ts-check

import { hostFromUrl } from '../normalize.mjs';

export const PROFILE_ARCHETYPES = Object.freeze({
  NAVIGATION_CATALOG: 'navigation-catalog',
  CHAPTER_CONTENT: 'chapter-content',
});

const LEGACY_PROFILE_ARCHETYPE_BY_HOST = Object.freeze({
  'jable.tv': PROFILE_ARCHETYPES.NAVIGATION_CATALOG,
  'moodyz.com': PROFILE_ARCHETYPES.NAVIGATION_CATALOG,
  'www.22biqu.com': PROFILE_ARCHETYPES.CHAPTER_CONTENT,
});

const PROFILE_ARCHETYPE_ALIASES = Object.freeze({
  'navigation-catalog': PROFILE_ARCHETYPES.NAVIGATION_CATALOG,
  'navigation_hub': PROFILE_ARCHETYPES.NAVIGATION_CATALOG,
  'navigation-hub': PROFILE_ARCHETYPES.NAVIGATION_CATALOG,
  'catalog-detail': PROFILE_ARCHETYPES.NAVIGATION_CATALOG,
  'catalog_detail': PROFILE_ARCHETYPES.NAVIGATION_CATALOG,
  'chapter-content': PROFILE_ARCHETYPES.CHAPTER_CONTENT,
  'chapter_content': PROFILE_ARCHETYPES.CHAPTER_CONTENT,
});

const PRIMARY_ARCHETYPE_BY_PROFILE_ARCHETYPE = Object.freeze({
  [PROFILE_ARCHETYPES.NAVIGATION_CATALOG]: 'catalog-detail',
  [PROFILE_ARCHETYPES.CHAPTER_CONTENT]: 'chapter-content',
});

function resolveHostValue(hostOrUrl) {
  if (!hostOrUrl) {
    return null;
  }
  return hostFromUrl(hostOrUrl) ?? (String(hostOrUrl).trim().toLowerCase() || null);
}

export function normalizeProfileArchetype(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = String(value).trim().toLowerCase().replace(/\s+/g, '-');
  return PROFILE_ARCHETYPE_ALIASES[normalized] ?? null;
}

export function resolveLegacyProfileArchetype(hostOrUrl) {
  const host = resolveHostValue(hostOrUrl);
  return host ? (LEGACY_PROFILE_ARCHETYPE_BY_HOST[host] ?? null) : null;
}

export function resolveProfileArchetype(profileOrValue, options = {}) {
  if (profileOrValue && typeof profileOrValue === 'object' && !Array.isArray(profileOrValue)) {
    const direct = normalizeProfileArchetype(profileOrValue.archetype);
    if (direct) {
      return direct;
    }
    return resolveLegacyProfileArchetype(options.host ?? profileOrValue.host ?? null);
  }

  return normalizeProfileArchetype(profileOrValue) ?? resolveLegacyProfileArchetype(options.host ?? profileOrValue);
}

export function resolveProfilePrimaryArchetype(profileOrValue, options = {}) {
  if (profileOrValue && typeof profileOrValue === 'object' && !Array.isArray(profileOrValue)) {
    const explicit = typeof profileOrValue.primaryArchetype === 'string'
      ? profileOrValue.primaryArchetype.trim()
      : '';
    if (explicit) {
      return explicit;
    }
  }

  const archetype = resolveProfileArchetype(profileOrValue, options);
  return archetype ? (PRIMARY_ARCHETYPE_BY_PROFILE_ARCHETYPE[archetype] ?? null) : null;
}
