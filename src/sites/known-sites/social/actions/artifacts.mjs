// @ts-check

import path from 'node:path';

import { normalizeArtifactReferenceSet } from '../../../../domain/artifacts/schema.mjs';
import { assertSchemaCompatible } from '../../../../domain/schemas/compatibility-registry.mjs';
import { compactSlug } from '../../../../shared/normalize.mjs';

export function createArtifactSlug(plan) {
  return compactSlug([
    plan.action,
    plan.account || plan.query || plan.routeName || plan.routePath || 'current',
    plan.contentType || '',
    plan.date || plan.fromDate || '',
  ].filter(Boolean).join('-'), 'social-run');
}

export function artifactPathSummary(layout) {
  const artifacts = normalizeArtifactReferenceSet({
    runDir: layout.runDir,
    manifest: layout.manifestPath,
    manifestRedactionAudit: layout.manifestRedactionAuditPath,
    items: layout.itemsJsonlPath,
    mediaDir: layout.mediaDir,
    state: layout.statePath,
    report: layout.reportPath,
    reportRedactionAudit: layout.reportRedactionAuditPath,
    apiCapture: layout.apiCapturePath,
    apiCaptureRedactionAudit: layout.apiCaptureRedactionAuditPath,
    apiDriftSamples: layout.apiDriftSamplesPath,
    apiDriftSamplesRedactionAudit: layout.apiDriftSamplesRedactionAuditPath,
    socialRiskBlockedLifecycleEvent: layout.socialRiskBlockedLifecycleEventPath,
    socialRiskBlockedLifecycleEventRedactionAudit: layout.socialRiskBlockedLifecycleEventRedactionAuditPath,
    downloads: layout.downloadsJsonlPath,
    mediaManifest: layout.mediaHashManifestPath,
    mediaQueue: layout.mediaQueuePath,
    indexCsv: layout.indexCsvPath,
    indexHtml: layout.indexHtmlPath,
  });
  assertSchemaCompatible('ArtifactReferenceSet', artifacts);
  return artifacts;
}

export function buildSocialArtifactLayout(plan, settings) {
  const runDir = settings.runDir
    ? path.resolve(settings.runDir)
    : path.join(settings.outputRoot, `${settings.artifactRunId}-${createArtifactSlug(plan)}`);
  return {
    runDir,
    manifestPath: path.join(runDir, 'manifest.json'),
    manifestRedactionAuditPath: path.join(runDir, 'manifest.redaction-audit.json'),
    itemsJsonlPath: path.join(runDir, 'items.jsonl'),
    mediaDir: path.join(runDir, 'media'),
    statePath: path.join(runDir, 'state.json'),
    reportPath: path.join(runDir, 'report.md'),
    reportRedactionAuditPath: path.join(runDir, 'report.redaction-audit.json'),
    apiCapturePath: path.join(runDir, 'api-capture-debug.json'),
    apiCaptureRedactionAuditPath: path.join(runDir, 'api-capture-debug.redaction-audit.json'),
    apiDriftSamplesPath: path.join(runDir, 'api-drift-samples.json'),
    apiDriftSamplesRedactionAuditPath: path.join(runDir, 'api-drift-samples.redaction-audit.json'),
    socialRiskBlockedLifecycleEventPath: path.join(runDir, 'social-action-risk-blocked.lifecycle-event.json'),
    socialRiskBlockedLifecycleEventRedactionAuditPath: path.join(runDir, 'social-action-risk-blocked.lifecycle-event.redaction-audit.json'),
    downloadsJsonlPath: path.join(runDir, 'downloads.jsonl'),
    mediaHashManifestPath: path.join(runDir, 'media-manifest.json'),
    mediaQueuePath: path.join(runDir, 'media-queue.json'),
    indexCsvPath: path.join(runDir, 'index.csv'),
    indexHtmlPath: path.join(runDir, 'index.html'),
  };
}

const SAFE_ROUTE_SEGMENTS = new Set([
  'account',
  'accessibility',
  'accessibility_display_and_languages',
  'additional_resources',
  'advanced_filters',
  'about',
  'about_your_account',
  'analytics',
  'ads_preferences',
  'audience_and_tagging',
  'autoplay',
  'all',
  'blocked',
  'bookmarks',
  'chat',
  'compose',
  'articles',
  'communities',
  'connected_accounts',
  'content_you_see',
  'connect_people',
  'contacts',
  'contacts_dashboard',
  'creators',
  'data',
  'data_sharing_with_business_partners',
  'data_usage',
  'deactivate',
  'delegate',
  'direct_messages',
  'discoverability_and_contacts',
  'display',
  'download_your_data',
  'email_notifications',
  'filters',
  'explore',
  'for-you',
  'followers',
  'followers_you_follow',
  'following',
  'groups',
  'grok_settings',
  'grok',
  'highlights',
  'home',
  'i',
  'id_verification',
  'jf',
  'jobs',
  'keyboard_shortcuts',
  'languages',
  'likes',
  'login',
  'login_verification',
  'lists',
  'location',
  'location_information',
  'manage_subscriptions',
  'media',
  'members',
  'mentions',
  'messages',
  'monetization',
  'mute_and_block',
  'muted',
  'muted_keywords',
  'news',
  'notifications',
  'off_twitter_activity',
  'passkey',
  'photo',
  'post',
  'premium_sign_up',
  'preferences',
  'privacy_and_safety',
  'profile',
  'push_notifications',
  'quotes',
  'retweets',
  'search',
  'security',
  'security_and_account_access',
  'settings',
  'signup',
  'spaces',
  'status',
  'studio',
  'stories',
  'tabs',
  'trending',
  'verified_followers',
  'verified',
  'with_replies',
  'your_tweets',
  'your_twitter_data',
]);

function safeRouteSegment(segment, index) {
  const decoded = decodeURIComponent(String(segment ?? '')).toLowerCase();
  if (decoded === '{account}' || decoded === ':account') return ':account';
  if (decoded === '{statusid}' || decoded === '{mediaid}' || /^:(?:statusid|mediaid|id)$/u.test(decoded)) return ':id';
  if (decoded === '{spaceid}' || decoded === '{communityid}' || decoded === '{segment}' || /^:(?:spaceid|communityid|segment)$/u.test(decoded)) return ':segment';
  if (/^\d+$/u.test(decoded)) return ':id';
  if (SAFE_ROUTE_SEGMENTS.has(decoded)) return decoded;
  return index === 0 ? ':account' : ':segment';
}

function routeTemplateFromUrl(value, host = null) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw, host ? `https://${host}` : undefined);
    const segments = parsed.pathname.split('/').filter(Boolean).map(safeRouteSegment);
    const pathTemplate = segments.length ? `/${segments.join('/')}` : '/';
    if (pathTemplate !== '/search') {
      return pathTemplate;
    }
    const query = [];
    if (parsed.searchParams.has('q')) query.push('q=:query');
    if (parsed.searchParams.has('src')) query.push('src=:src');
    if (parsed.searchParams.has('f')) query.push('f=:filter');
    return query.length ? `${pathTemplate}?${query.join('&')}` : pathTemplate;
  } catch {
    return null;
  }
}

export function safeUrlForArtifact(value, host = null) {
  const routeTemplate = routeTemplateFromUrl(value, host);
  if (!routeTemplate) return null;
  return host ? `https://${host}${routeTemplate}` : routeTemplate;
}

export function safePlanForArtifact(plan) {
  return {
    siteKey: plan.siteKey,
    host: plan.host,
    action: plan.action,
    contentType: plan.contentType,
    account: plan.account ? ':account' : null,
    query: plan.query ? ':query' : null,
    routePath: plan.routePath ? safeUrlForArtifact(plan.routePath, plan.host) : null,
    routeName: plan.routeName ?? null,
    statusId: plan.statusId ? ':id' : null,
    mediaId: plan.mediaId ? ':id' : null,
    date: plan.date,
    fromDate: plan.fromDate,
    toDate: plan.toDate,
    url: safeUrlForArtifact(plan.url, plan.host),
    plannerNotes: [],
  };
}

export function safeSettingsForArtifact(settings) {
  return {
    maxItems: settings.maxItems,
    maxScrolls: settings.maxScrolls,
    scrollWaitMs: settings.scrollWaitMs,
    fullArchive: settings.fullArchive,
    apiCursor: settings.apiCursor,
    apiCursorSuppressed: settings.apiCursorSuppressed,
    maxApiPages: settings.maxApiPages,
    maxUsers: settings.maxUsers,
    maxDetailPages: settings.maxDetailPages,
    perUserMaxItems: settings.perUserMaxItems,
    apiRetries: settings.apiRetries,
    riskRetries: settings.riskRetries,
    riskBackoffMs: settings.riskBackoffMs,
    followedDateMode: settings.followedDateMode,
    downloadMedia: settings.downloadMedia,
    resume: settings.resume,
    outputRoot: settings.outputRoot,
    runDir: settings.runDir,
  };
}
