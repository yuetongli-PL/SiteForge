// @ts-check

import { spawn } from 'node:child_process';
import process from 'node:process';
import { BUILD_SCHEMA_VERSION, isInternalUrl, normalizeUrl } from './models.mjs';
import { sanitizeEvidenceRef } from './risk-policy.mjs';

export const AUTH_STATE_REPORT_FILE = 'auth_state_report.json';
export const CRAWL_AUTHENTICATED_FILE = 'crawl_authenticated.json';
export const AUTH_STATE_ARTIFACT_FAMILY = 'siteforge-auth-state-report';

export const AUTH_LEVELS = Object.freeze(['Blocked', 'L0', 'L1', 'L2', 'L3', 'L4']);
export const AUTH_LEVEL_RANK = Object.freeze({
  Blocked: -1,
  L0: 0,
  L1: 1,
  L2: 2,
  L3: 3,
  L4: 4,
});

export const CAPABILITY_EVIDENCE_LEVEL_RANK = Object.freeze({
  blocked: -1,
  candidate: 0,
  missing_auth_evidence: 0,
  public_verified: 1,
  login_user_confirmed: 2,
  login_route_verified: 3,
  login_page_verified: 4,
  capability_verified: 5,
});

export function normalizeAuthLevel(value, fallback = 'L0') {
  const level = String(value ?? '').trim();
  return Object.hasOwn(AUTH_LEVEL_RANK, level) ? level : fallback;
}

export function authLevelRank(value) {
  return AUTH_LEVEL_RANK[normalizeAuthLevel(value, 'Blocked')] ?? -1;
}

export function evidenceLevelRank(value) {
  return CAPABILITY_EVIDENCE_LEVEL_RANK[String(value ?? '').trim()] ?? 0;
}

export function canRunAuthenticatedLayer(authStateReport = null) {
  return authStateReport?.verified === true && authLevelRank(authStateReport.authLevel) >= AUTH_LEVEL_RANK.L3;
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value ?? '').trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, 'en'));
}

function spawnDetached(command, args = /** @type {string[]} */ ([])) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve({ command, args });
    });
  });
}

export async function openSystemDefaultBrowser(urlValue, options = /** @type {any} */ ({})) {
  const targetUrl = String(urlValue ?? '').trim();
  if (!targetUrl) {
    throw new Error('Default browser URL is required');
  }
  if (typeof options.defaultBrowserLauncher === 'function') {
    return await options.defaultBrowserLauncher(targetUrl);
  }
  if (typeof options.externalBrowserLauncher === 'function') {
    return await options.externalBrowserLauncher(targetUrl);
  }
  if (process.platform === 'win32') {
    return await spawnDetached('rundll32.exe', ['url.dll,FileProtocolHandler', targetUrl]);
  }
  if (process.platform === 'darwin') {
    return await spawnDetached('open', [targetUrl]);
  }
  return await spawnDetached('xdg-open', [targetUrl]);
}

function hostFromSite(site) {
  try {
    return new URL(site.rootUrl).hostname;
  } catch {
    return null;
  }
}

function isLoginLikeUrl(urlValue) {
  try {
    const parsed = new URL(urlValue);
    return /\/(?:login|signin|sign-in|auth|oauth|checkpoint|challenge|mfa|2fa)(?:\/|$)/iu.test(parsed.pathname);
  } catch {
    return false;
  }
}

function safeRouteRef(urlValue, site) {
  if (!urlValue) {
    return null;
  }
  try {
    const normalized = normalizeUrl(urlValue, site.rootUrl);
    if (!isInternalUrl(normalized, site.allowedDomains)) {
      return null;
    }
    const parsed = new URL(normalized);
    return `${parsed.pathname}${parsed.search ? '?[query]' : ''}`;
  } catch {
    return null;
  }
}

function parseUserAuthConfirmation(answer) {
  const text = String(answer ?? '').trim();
  if (!text) {
    return { confirmed: false, finalUrl: null, status: 'empty' };
  }
  const [first, ...rest] = text.split(/\s+/u);
  const normalized = first.toLowerCase();
  if (/^(?:n|no|0|cancel|blocked|failed|fail|否|不|取消|失败|被阻止)$/u.test(normalized)) {
    return { confirmed: false, finalUrl: rest.find((part) => /^https?:\/\//iu.test(part)) ?? null, status: 'declined' };
  }
  if (/^(?:y|yes|1|ok|done|continue|是|已完成|继续)$/u.test(normalized)) {
    return { confirmed: true, finalUrl: rest.find((part) => /^https?:\/\//iu.test(part)) ?? null, status: 'confirmed' };
  }
  if (/^https?:\/\//iu.test(text)) {
    return { confirmed: true, finalUrl: text, status: 'confirmed_with_url' };
  }
  return { confirmed: false, finalUrl: null, status: 'unrecognized' };
}

export function normalizeAuthStateReport(report = /** @type {any} */ ({}), {
  site,
  crawlMode = report.crawlMode ?? 'public_only',
  authChoice = report.authChoice ?? 'declined',
} = /** @type {any} */ ({})) {
  const level = normalizeAuthLevel(report.authLevel, report.verified === true ? 'L3' : 'L0');
  const verified = report.verified === true && authLevelRank(level) >= AUTH_LEVEL_RANK.L3;
  const finalUrl = report.finalUrl && site
    ? (sanitizeEvidenceRef(normalizeUrl(report.finalUrl, site.rootUrl)) ?? null)
    : sanitizeEvidenceRef(report.finalUrl) ?? null;
  const verifiedRoutes = Array.isArray(report.verifiedRoutes)
    ? report.verifiedRoutes.map((route) => String(route ?? '').trim()).filter(Boolean)
    : [];
  return {
    schemaVersion: BUILD_SCHEMA_VERSION,
    artifactFamily: AUTH_STATE_ARTIFACT_FAMILY,
    crawlMode: verified ? 'enhanced_with_login' : crawlMode,
    authChoice,
    authLevel: level,
    verified,
    source: report.source ?? 'default_browser_user_confirmed',
    finalUrl,
    blockingSignals: uniqueStrings(report.blockingSignals ?? []),
    positiveSignals: uniqueStrings(report.positiveSignals ?? []),
    verifiedRoutes: uniqueStrings(verifiedRoutes),
    capabilityProofs: Array.isArray(report.capabilityProofs) ? report.capabilityProofs.map((proof) => ({
      capabilityId: String(proof?.capabilityId ?? proof?.setupCapabilityId ?? '').trim(),
      evidenceLevel: String(proof?.evidenceLevel ?? 'capability_verified').trim(),
      sampleCount: Math.max(0, Number(proof?.sampleCount ?? proof?.visibleItemCount ?? 0) || 0),
      rawMaterialPersisted: false,
    })).filter((proof) => proof.capabilityId && proof.sampleCount > 0) : [],
    rawMaterialPersisted: false,
    sessionMaterialPersisted: false,
    browserProfilePersisted: false,
  };
}

export function createPublicOnlyAuthStateReport({ site = null, authChoice = 'declined', reasonCode = null } = /** @type {any} */ ({})) {
  return normalizeAuthStateReport({
    crawlMode: 'public_only',
    authChoice,
    authLevel: reasonCode === 'auth-blocked' ? 'Blocked' : 'L0',
    verified: false,
    source: authChoice === 'declined' ? 'user_declined_login_enhancement' : 'non_interactive_default_public_only',
    blockingSignals: [reasonCode].filter(Boolean),
    positiveSignals: authChoice === 'declined' ? ['user_selected_public_only'] : ['public_only_default'],
  }, { site, crawlMode: 'public_only', authChoice });
}

export async function runDefaultBrowserAuthStateCheck({
  inputUrl,
  site,
  options = /** @type {any} */ ({}),
  ask,
  writeLine,
} = /** @type {any} */ ({})) {
  if (typeof options.authStateProvider === 'function') {
    const provided = await options.authStateProvider({ inputUrl, site, options });
    return normalizeAuthStateReport(provided, {
      site,
      crawlMode: provided?.verified === true ? 'enhanced_with_login' : 'public_only',
      authChoice: provided?.authChoice ?? 'selected',
    });
  }
  if (typeof ask !== 'function') {
    return createPublicOnlyAuthStateReport({ site, authChoice: 'failed', reasonCode: 'auth-check-unavailable' });
  }
  writeLine?.('SiteForge 将使用系统默认浏览器打开目标站点；请只在浏览器里手动登录。');
  writeLine?.('不会读取 cookie、token、Authorization header、localStorage、sessionStorage，也不会保存浏览器 profile。');
  await openSystemDefaultBrowser(inputUrl, options);
  const answer = await ask('登录完成后回到这里输入 y；如果失败或不想继续，输入 n。可选：y 后面粘贴当前站内 final URL：');
  const confirmation = parseUserAuthConfirmation(answer);
  if (!confirmation.confirmed) {
    return createPublicOnlyAuthStateReport({
      site,
      authChoice: 'failed',
      reasonCode: confirmation.status === 'declined' ? 'user-declined-after-browser-open' : 'user-confirmation-missing',
    });
  }

  const positiveSignals = ['user_confirmed_terminal_y'];
  const blockingSignals = /** @type {string[]} */ ([]);
  let authLevel = 'L1';
  let verified = false;
  let finalUrl = confirmation.finalUrl;
  if (finalUrl) {
    try {
      const normalizedFinalUrl = normalizeUrl(finalUrl, site.rootUrl);
      finalUrl = normalizedFinalUrl;
      if (isInternalUrl(normalizedFinalUrl, site.allowedDomains)) {
        positiveSignals.push('same_site_final_url');
        if (!isLoginLikeUrl(normalizedFinalUrl)) {
          positiveSignals.push('not_login_route');
          positiveSignals.push('authenticated_route_candidate');
          authLevel = 'L2';
        } else {
          blockingSignals.push('login_like_final_url');
        }
      } else {
        blockingSignals.push('cross_site_final_url');
      }
    } catch {
      blockingSignals.push('invalid_final_url');
    }
  } else {
    blockingSignals.push('no_safe_structure_bridge');
  }
  const host = hostFromSite(site);
  return normalizeAuthStateReport({
    crawlMode: 'public_only',
    authChoice: 'selected',
    authLevel,
    verified,
    source: 'default_browser_user_confirmed',
    finalUrl,
    blockingSignals,
    positiveSignals,
    verifiedRoutes: safeRouteRef(finalUrl, site) ? [safeRouteRef(finalUrl, site)] : [],
  }, { site, crawlMode: 'public_only', authChoice: 'selected' });
}

export function createCrawlContract({
  site = null,
  authChoice = 'declined',
  authStateReport = null,
  coverageTargets = /** @type {any} */ ({}),
  sourceMode = null,
} = /** @type {any} */ ({})) {
  const normalizedReport = authStateReport
    ? normalizeAuthStateReport(authStateReport, { site, authChoice })
    : createPublicOnlyAuthStateReport({ site, authChoice });
  const loginEnhanced = canRunAuthenticatedLayer(normalizedReport);
  const crawlMode = loginEnhanced ? 'enhanced_with_login' : 'public_only';
  const normalizedAuthChoice = loginEnhanced
    ? 'verified'
    : authChoice === 'selected'
      ? 'failed'
      : authChoice;
  return {
    schemaVersion: BUILD_SCHEMA_VERSION,
    artifactFamily: 'siteforge-crawl-contract',
    crawlMode,
    sourceMode: sourceMode ?? (loginEnhanced ? 'default_browser_login' : 'live_static'),
    authChoice: normalizedAuthChoice,
    authLevel: normalizedReport.authLevel,
    coverageTargets: {
      publicRoutes: uniqueStrings(coverageTargets.publicRoutes ?? []),
      authRoutes: uniqueStrings(coverageTargets.authRoutes ?? []),
      publicRevisitRoutes: uniqueStrings(coverageTargets.publicRevisitRoutes ?? []),
      candidateCapabilities: uniqueStrings(coverageTargets.candidateCapabilities ?? []),
      requiresLoginCapabilities: uniqueStrings(coverageTargets.requiresLoginCapabilities ?? []),
    },
    evidencePolicy: {
      allowPublicStatic: true,
      allowLoginEnhanced: loginEnhanced,
      allowRawDom: false,
      allowCookies: false,
      allowPrivateBody: false,
      allowBrowserProfile: false,
      allowStorage: false,
      allowRawNetworkPayload: false,
    },
  };
}

export function authSummaryForReport(crawlContract = null, authStateReport = null) {
  const contract = crawlContract ?? createCrawlContract({ authStateReport });
  const report = authStateReport ?? createPublicOnlyAuthStateReport({ authChoice: contract.authChoice });
  return {
    crawlMode: contract.crawlMode,
    authChoice: contract.authChoice,
    authLevel: contract.authLevel,
    verified: report.verified === true,
    sourceMode: contract.sourceMode,
    positiveSignals: report.positiveSignals ?? [],
    blockingSignals: report.blockingSignals ?? [],
    savedMaterial: {
      rawMaterialPersisted: false,
      sessionMaterialPersisted: false,
      browserProfilePersisted: false,
      rawDomPersisted: false,
      rawHtmlPersisted: false,
      privateBodyPersisted: false,
      rawNetworkPayloadPersisted: false,
    },
  };
}
