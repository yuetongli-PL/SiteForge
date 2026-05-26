// @ts-check

import { jsonClone } from '../../../shared/clone.mjs';
import {
  canRunAuthenticatedLayer,
  createCrawlContract,
  createPublicOnlyAuthStateReport,
  normalizeAuthStateReport,
} from './auth-state.mjs';

const AUTHENTICATED_CRAWL_MODES = new Set(['authenticated_cookie', 'authenticated_browser']);
const AUTHENTICATED_SOURCE_MODES = new Set(['cookie_verified', 'browser_bridge_verified', 'browser_bridge_partial']);
const AUTH_VERIFIED_STATUSES = new Set(['cookie_verified', 'browser_verified', 'browser_verified_partial']);
const SAVED_AUTH_REVERIFY_REASON = 'saved-auth-reverify-required';

const clone = jsonClone;

export function buildProfileAuthRequiresFreshVerification(buildProfile = /** @type {any} */ ({})) {
  const profile = buildProfile ?? {};
  const authStateReport = profile.authStateReport ?? null;
  const crawlContract = profile.crawlContract ?? null;
  return canRunAuthenticatedLayer(authStateReport)
    || AUTH_VERIFIED_STATUSES.has(String(authStateReport?.authVerificationStatus ?? ''))
    || AUTHENTICATED_CRAWL_MODES.has(String(crawlContract?.crawlMode ?? ''))
    || AUTHENTICATED_SOURCE_MODES.has(String(crawlContract?.sourceMode ?? ''));
}

export function reusableBuildProfileAuthStateReport({
  options = /** @type {any} */ ({}),
  site = null,
  buildProfile = /** @type {any} */ ({}),
  fallbackAuthStateReport = null,
} = /** @type {any} */ ({})) {
  const profile = buildProfile ?? {};
  const profileSite = profile.site ?? site;
  if (options.authStateReport) {
    return normalizeAuthStateReport(options.authStateReport, { site: profileSite });
  }
  if (!buildProfileAuthRequiresFreshVerification(profile)) {
    const report = profile.authStateReport ?? fallbackAuthStateReport ?? null;
    return report ? normalizeAuthStateReport(report, { site: profileSite }) : null;
  }
  return createPublicOnlyAuthStateReport({
    site: profileSite,
    authMethod: 'none',
    reasonCode: SAVED_AUTH_REVERIFY_REASON,
  });
}

export function reusableBuildProfileCrawlContract({
  options = /** @type {any} */ ({}),
  site = null,
  buildProfile = /** @type {any} */ ({}),
  authStateReport = null,
  fallbackCrawlContract = null,
} = /** @type {any} */ ({})) {
  const profile = buildProfile ?? {};
  const profileSite = profile.site ?? site;
  if (options.crawlContract) {
    return clone(options.crawlContract);
  }
  if (!buildProfileAuthRequiresFreshVerification(profile)) {
    const contract = profile.crawlContract ?? fallbackCrawlContract ?? null;
    return contract ? clone(contract) : null;
  }
  return createCrawlContract({
    site: profileSite,
    authStateReport,
    coverageTargets: clone(profile.crawlContract?.coverageTargets ?? {}),
  });
}
