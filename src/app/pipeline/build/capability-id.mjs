// @ts-check

export function normalizeCapabilityId(value) {
  return String(value ?? '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
}

const CAPABILITY_SEMANTIC_ALIASES = Object.freeze(new Map([
  ['followed-users', 'list-followed-users'],
  ['read-followed-users', 'list-followed-users'],
  ['following-accounts', 'list-followed-users'],
  ['followed-posts-by-date', 'list-followed-updates'],
  ['followed-updates', 'list-followed-updates'],
  ['following-posts', 'list-followed-updates'],
  ['read-following-timeline', 'list-followed-updates'],
  ['list-recommended-timeline-posts', 'recommended-timeline-posts'],
  ['recommended-timeline', 'recommended-timeline-posts'],
  ['read-recommended-timeline', 'recommended-timeline-posts'],
  ['profile-content', 'list-profile-content'],
  ['read-profile-content', 'list-profile-content'],
  ['account-posts', 'list-profile-content'],
  ['read-followers', 'read-followers'],
  ['list-account-followers', 'read-followers'],
  ['notifications', 'list-notifications'],
  ['notification-summaries', 'list-notifications'],
  ['list-notifications', 'list-notifications'],
  ['read-all-notifications-summary', 'list-notifications'],
  ['bookmarks', 'list-bookmarks'],
  ['bookmark-summaries', 'list-bookmarks'],
  ['list-bookmarks', 'list-bookmarks'],
  ['read-bookmarks-summary', 'list-bookmarks'],
  ['lists', 'list-lists'],
  ['list-summaries', 'list-lists'],
  ['list-lists', 'list-lists'],
  ['read-lists-summary', 'list-lists'],
  ['direct-messages', 'list-direct-messages'],
  ['message-conversation-summaries', 'list-direct-messages'],
  ['list-direct-messages', 'list-direct-messages'],
  ['read-direct-message-conversation-summaries', 'list-direct-messages'],
  ['view-post-detail', 'read-post-detail'],
  ['read-post-detail', 'read-post-detail'],
  ['view-post-replies', 'read-reply-tree-summary'],
  ['read-reply-tree-summary', 'read-reply-tree-summary'],
  ['view-post-media', 'read-media-summary'],
  ['read-media-summary', 'read-media-summary'],
  ['draft-post', 'create-post-draft'],
  ['create-post-draft', 'create-post-draft'],
  ['draft-reply', 'create-reply-draft'],
  ['create-reply-draft', 'create-reply-draft'],
  ['follow-user', 'follow-account'],
  ['follow-account', 'follow-account'],
  ['unfollow-user', 'unfollow-account'],
  ['unfollow-account', 'unfollow-account'],
]));

export function normalizeSetupCapabilityId(value) {
  return String(value ?? '')
    .toLowerCase()
    .trim()
    .replace(/^capability:[^:]+:/u, '')
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
}

export function canonicalCapabilitySemanticToken(value) {
  const normalized = normalizeSetupCapabilityId(value);
  if (!normalized) {
    return null;
  }
  return CAPABILITY_SEMANTIC_ALIASES.get(normalized) ?? normalized;
}
