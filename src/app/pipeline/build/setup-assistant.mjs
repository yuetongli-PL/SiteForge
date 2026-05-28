// @ts-check

import path from 'node:path';
import process, { stderr as defaultStderr, stdout as defaultStdout } from 'node:process';
import { createInterface as createReadlineInterface } from 'node:readline/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openBrowserSession } from '../../../infra/browser/session.mjs';
import { ensureDir, pathExists, readJsonFile, writeJsonFile } from '../../../infra/io.mjs';
import { jsonClone } from '../../../shared/clone.mjs';
import { uniqueSortedStrings } from '../../../shared/normalize.mjs';
import {
  policySupportsCapabilityFamily,
} from '../../../sites/registry/core/capability-intent-mapping.mjs';
import {
  readSiteCapabilities,
  readSiteRegistry,
} from '../../../sites/registry/catalog/repository.mjs';
import {
  BUILD_SCHEMA_VERSION,
  createSiteRecord,
  DEFAULT_BUILD_POLICY,
  formatBuildId,
  isInternalUrl,
  mergeBuildPolicy,
  normalizeUrl,
} from './models.mjs';
import {
  AUTH_STATE_REPORT_FILE,
  attachAuthRuntimeMaterial,
  authRuntimeMaterialFrom,
  canRunAuthenticatedLayer,
  createCrawlContract,
  createPublicOnlyAuthStateReport,
  normalizeAuthStateReport,
  runDefaultBrowserAuthStateCheck,
  sanitizeRouteTargetForPersistence,
} from './auth-state.mjs';
import {
  canContinueSetupBlockedForApiDiscovery,
  SETUP_BLOCKED_API_DISCOVERY_STATUS,
  setupBlockedApiDiscoveryOptions,
  setupBlockedApiDiscoveryPlan,
} from './api-discovery-setup-fallback.mjs';
import {
  assertBuildProfileSafe,
  isBuildProfileSafe,
} from './build-profile-safety.mjs';
import {
  reusableBuildProfileAuthStateReport,
  reusableBuildProfileCrawlContract,
} from './build-profile-reuse.mjs';
import {
  knownPolicyAllowsUserAuthorizedSetup,
  knownPolicyCapabilityPressure,
  knownPolicyRecommendedCapabilities,
  knownPolicySummary,
} from './known-site-policy.mjs';
import {
  buildCollectionReviewModel,
  capabilityProofMatches,
  collectionReviewLabel,
  hasVerifiedCapabilityProof,
  normalizeUserAuthorizedCapabilityProofs,
} from './setup-collection-review.mjs';
import { normalizeCapabilityId } from './capability-id.mjs';
import {
  AUTO_DISCOVERY_SCHEMA_VERSION,
  createSocialSpaAutoDiscoverySummary,
  mergeAutoDiscoveryPages,
} from './auto-discovery.mjs';
import { isUrlAllowedByRobots, parseHtmlDocument, parseRobotsPolicy, parseSitemapUrls } from './html.mjs';
import { createBuildSource } from './source.mjs';
import {
  SANITIZED_SUMMARY_ONLY,
  sanitizeEvidenceRef,
} from './risk-policy.mjs';
import { createSiteWorkspace, createSiteWorkspacePaths, ensureSiteWorkspace } from './workspace.mjs';

export {
  buildCollectionReviewModel,
  createCollectionReviewModel,
} from './setup-collection-review.mjs';

export const SETUP_ASSISTANT_SCHEMA_VERSION = 1;

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(MODULE_DIR, '..', '..', '..', '..');

const UNSAFE_ACTION_DEFAULTS = Object.freeze({
  login: false,
  comment: false,
  contactSubmit: false,
  payment: false,
  checkout: false,
  delete: false,
  upload: false,
  accountMutation: false,
  registration: false,
  destructive: false,
});

const SKILL_WILL = Object.freeze([
  '使用有证据支持的公开页面和链接。',
  '提供推荐的只读导航和搜索能力。',
  '风险表单操作只生成禁用或需确认的草稿。',
]);

const SKILL_WILL_NOT = Object.freeze([
  '不会登录、注册账号或使用私有会话材料。',
  '不会自动提交评论、联系表单、付款、结账、上传、删除或账号变更。',
  '不会把用户选择当作证据；构建验证仍要求能力有证据支持。',
]);

const ROBOTS_DISALLOWED_SETUP_GUIDANCE = Object.freeze([
  '通用采集器被 robots.txt 阻止。',
  'SiteForge 不会基于这次通用采集生成 Skill。',
  'SiteForge 不会基于这次通用采集更新 current/ 或 registry.json。',
  '只能使用合规的已知站点适配器、API、用户授权路径，或真实网站公开证据路径。',
]);

const USER_AUTHORIZED_SETUP_GUIDANCE = Object.freeze([
  '用户授权证据只能来自显式安全输入或脱敏结构摘要。',
  'SiteForge 不会把终端确认或最终 URL 当作登录成功证明。',
  'SiteForge 只保存受限证据摘要；不会保存凭据、浏览器 profile、页面正文或完整页面源码。',
]);

const clone = jsonClone;

function compactText(value, fallback = '') {
  return String(value ?? fallback).replace(/\s+/gu, ' ').trim();
}

export function parseContinueUncollectedCollectionAnswer(answer) {
  const text = compactText(answer).toLowerCase();
  if (!text) {
    return {
      continue: false,
      explicit: false,
      normalized: 'no',
      reasonCode: 'default-no',
    };
  }
  if (/^(?:y|yes|ok|okay|true|1|continue|go|go ahead|yes please)$/iu.test(text)) {
    return {
      continue: true,
      explicit: true,
      normalized: 'yes',
      reasonCode: 'confirmed',
    };
  }
  if (/^(?:n|no|no thanks|false|0|skip|cancel|stop)$/iu.test(text)
    || /^(?:否|不|不要|不用|不用了|不继续|不采集|跳过|暂不|取消|停止)$/u.test(text)) {
    return {
      continue: false,
      explicit: true,
      normalized: 'no',
      reasonCode: 'declined',
    };
  }
  return {
    continue: false,
    explicit: false,
    normalized: 'unknown',
    reasonCode: 'unrecognized',
  };
}

function firstWords(value, maxLength = 80) {
  const text = compactText(value);
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trimEnd()}...` : text;
}

function sanitizedSetupHint(hint, requested = requestedCapabilityFromHint(hint)) {
  if (!compactText(hint)) {
    return '';
  }
  if (requested?.supported === true && requested.id) {
    return `capability:${normalizeCapabilityId(requested.id)}`;
  }
  if (requested?.reasonCode === 'unmatched-user-hint') {
    return 'unmatched-user-hint';
  }
  return requested?.id ? `unsupported:${normalizeCapabilityId(requested.id)}` : 'unmatched-user-hint';
}

const SETUP_DISPLAY_TEXT_ZH = new Map();

function setupDisplayText(value) {
  const text = String(value ?? '');
  return SETUP_DISPLAY_TEXT_ZH.get(text) ?? text;
}

function spawnDetached(command, args = /** @type {any[]} */ ([])) {
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

export async function launchExternalBrowserUrl(url, options = /** @type {any} */ ({})) {
  const targetUrl = String(url ?? '').trim();
  if (!targetUrl) {
    throw new Error('External browser launch URL is required');
  }
  if (options.externalBrowserLauncher) {
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

async function waitForBrowserAuthorizationConfirmation() {
  return { status: 'blocked', reasonCode: 'browser-auth-disabled' };
}

function setupNow(options = /** @type {any} */ ({})) {
  return options.now instanceof Date ? options.now : new Date();
}

export function buildSetupAssistantPaths(inputUrl, options = /** @type {any} */ ({})) {
  const now = setupNow(options);
  const generatedAt = now.toISOString();
  const site = createSiteRecord(inputUrl, generatedAt);
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const buildId = options.buildId ?? formatBuildId(now);
  const workspacePaths = createSiteWorkspacePaths({
    cwd,
    siteId: site.id,
    buildId,
    workspaceRoot: options.workspaceRoot,
  });
  return {
    cwd,
    generatedAt,
    buildId,
    site,
    workspace: createSiteWorkspace({ cwd, workspaceRoot: options.workspaceRoot, site, buildId, startedAt: generatedAt }),
    artifactDir: workspacePaths.buildDir,
    siteBuildsDir: workspacePaths.buildsDir,
    siteArtifactDir: workspacePaths.siteDir,
    setupDir: workspacePaths.setupDir,
    setupPlanPath: workspacePaths.setupFiles['setup_plan.json'],
    userChoicesPath: workspacePaths.setupFiles['user_choices.json'],
    capabilityHintsPath: workspacePaths.setupFiles['capability_hints.json'],
    authStateReportPath: path.join(workspacePaths.buildDir, AUTH_STATE_REPORT_FILE),
    buildProfilePath: path.join(workspacePaths.buildDirs.inputs, 'build_profile.json'),
    savedBuildProfilePath: workspacePaths.setupFiles['build_profile.json'],
  };
}

async function readJsonOrNull(filePath) {
  return await pathExists(filePath) ? await readJsonFile(filePath) : null;
}

function siteHostCandidates(site) {
  const candidates = new Set(site.allowedDomains ?? []);
  try {
    candidates.add(new URL(site.rootUrl).hostname.toLowerCase());
  } catch {
    // Ignore malformed optional lookup input; createSiteRecord already normalizes rootUrl.
  }
  for (const host of [...candidates]) {
    candidates.add(host.replace(/^www\./u, ''));
    candidates.add(`www.${host.replace(/^www\./u, '')}`);
  }
  return [...candidates].filter(Boolean);
}

function configRecordForSite(config, site) {
  const sites = config?.sites && typeof config.sites === 'object' ? config.sites : {};
  const candidates = siteHostCandidates(site);
  for (const host of candidates) {
    if (sites[host]) {
      return sites[host];
    }
  }
  return Object.values(sites).find((record) => {
    const recordHosts = [
      record?.host,
      hostnameFromOptionalUrl(record?.baseUrl),
      hostnameFromOptionalUrl(record?.canonicalBaseUrl),
    ].filter(Boolean).map((host) => String(host).toLowerCase());
    return recordHosts.some((host) => candidates.includes(host));
  }) ?? null;
}

function hostnameFromOptionalUrl(urlValue) {
  if (!urlValue) {
    return null;
  }
  try {
    return new URL(urlValue).hostname;
  } catch {
    return null;
  }
}

function normalizeAuthorizedControl(control, index) {
  const controlType = firstWords(control?.controlType ?? control?.kind ?? 'control', 80);
  const labelSummary = firstWords(control?.labelSummary ?? controlType, 120);
  const role = firstWords(control?.attrs?.role ?? control?.role ?? '', 40);
  const safeSelector = /^\[data-siteforge-auto=/u.test(String(control?.selector ?? ''))
    ? firstWords(control.selector, 160)
    : `authorized-control:nth-of-type(${index + 1})`;
  return {
    kind: ['input', 'select', 'button', 'link'].includes(control?.kind) ? control.kind : 'button',
    type: firstWords(control?.type ?? '', 40) || null,
    label: labelSummary,
    labelSummary,
    labelHash: firstWords(control?.labelHash ?? '', 80) || null,
    selector: safeSelector,
    safety: ['safe', 'read_only', 'requires_input'].includes(control?.safety) ? control.safety : 'safe',
    controlType,
    attrs: {
      ...(role ? { role } : {}),
      'data-siteforge-auto': controlType,
    },
    evidenceStatus: firstWords(control?.evidenceStatus ?? 'modeled_structure', 80),
    riskLevel: firstWords(control?.riskLevel ?? 'low', 40),
  };
}

function normalizeAuthorizedStructureItem(item, index) {
  const structureType = firstWords(item?.structureType ?? 'structure', 80);
  const labelSummary = firstWords(item?.labelSummary ?? structureType, 120);
  return {
    id: firstWords(item?.id ?? `structure-${index + 1}`, 160),
    structureType,
    nodeType: ['content', 'operation', 'modal'].includes(item?.nodeType) ? item.nodeType : 'content',
    labelSummary,
    structureHash: firstWords(item?.structureHash ?? '', 80) || null,
    listPresent: item?.listPresent === true,
    visibleItemCount: Math.max(0, Number(item?.visibleItemCount ?? 0) || 0),
    evidenceStatus: firstWords(item?.evidenceStatus ?? 'modeled_structure', 80),
    riskLevel: firstWords(item?.riskLevel ?? 'low', 40),
  };
}

function shouldAttemptUserAuthorizedSetup(setupPlan, options = /** @type {any} */ ({})) {
  if (options.allowUserAuthorizedSetup === false || options.noUserAuthorizedSetup === true) {
    return false;
  }
  return setupPlan?.buildReadiness?.buildable === false
    && knownPolicyAllowsUserAuthorizedSetup(setupPlan.knownSitePolicy)
    && setupPlan.evidenceQuality?.knownPolicyCapabilityPressure?.hasPolicyCapabilities === true;
}

function normalizeUserAuthorizedEvidencePage(page, site) {
  const fallbackUrl = site.rootUrl;
  let normalizedUrl;
  try {
    normalizedUrl = normalizeUrl(page?.url ?? page?.finalUrl ?? fallbackUrl, site.rootUrl);
  } catch {
    normalizedUrl = normalizeUrl(fallbackUrl, site.rootUrl);
  }
  if (!isInternalUrl(normalizedUrl, site.allowedDomains)) {
    normalizedUrl = normalizeUrl(fallbackUrl, site.rootUrl);
  }
  const storedUrl = sanitizeEvidenceRef(normalizedUrl) ?? normalizeUrl(fallbackUrl, site.rootUrl);
  const host = new URL(site.rootUrl).hostname;
  const safeTitle = `${host} authorized browser surface`;
  const safeTextSummary = 'User-authorized browser evidence was captured as a bounded summary without persisting raw page, session, or account material.';
  const controls = Array.isArray(page?.controls)
    ? page.controls.map((control, index) => normalizeAuthorizedControl(control, index)).filter(Boolean)
    : [];
  const structureItems = Array.isArray(page?.structureItems)
    ? page.structureItems.map((item, index) => normalizeAuthorizedStructureItem(item, index)).filter(Boolean)
    : [];
  return {
    url: storedUrl,
    normalizedUrl: storedUrl,
    title: safeTitle,
    textSummary: safeTextSummary,
    source: 'user_authorized_browser',
    authRequired: true,
    pageType: firstWords(page?.pageType ?? '', 80) || null,
    routeTemplate: firstWords(page?.routeTemplate ?? '', 120) || null,
    routePath: firstWords(page?.routePath ?? '', 120) || null,
    tabState: firstWords(page?.tabState ?? '', 80) || null,
    stateKey: firstWords(page?.stateKey ?? '', 160) || null,
    visibleItemCount: Math.max(0, Number(page?.visibleItemCount ?? 0) || 0),
    listPresent: page?.listPresent === true,
    structureHash: firstWords(page?.structureHash ?? '', 80) || null,
    evidenceStatus: firstWords(page?.evidenceStatus ?? 'summary', 80),
    riskLevel: firstWords(page?.riskLevel ?? 'low', 40),
    controls,
    structureItems,
  };
}

function normalizeUserAuthorizedBrowserSeeds(seeds, site) {
  if (!Array.isArray(seeds)) {
    return [];
  }
  return seeds.map((seed) => {
    let normalizedUrl;
    try {
      normalizedUrl = normalizeUrl(seed?.normalizedUrl ?? seed?.url ?? site.rootUrl, site.rootUrl);
    } catch {
      return null;
    }
    if (!isInternalUrl(normalizedUrl, site.allowedDomains)) {
      return null;
    }
    const capabilityIds = uniqueSortedStrings([
      ...(Array.isArray(seed?.capabilityIds) ? seed.capabilityIds : []),
      seed?.capabilityId,
      seed?.setupCapabilityId,
      seed?.intentType,
      seed?.action,
    ].map(normalizeCapabilityId).filter(Boolean));
    const visibleItemCount = Math.max(0, Number(
      seed?.visibleItemCount
      ?? seed?.articleLikeCount
      ?? seed?.itemCount
      ?? seed?.sampleCount
      ?? 0,
    ) || 0);
    const storedUrl = sanitizeEvidenceRef(normalizedUrl) ?? normalizeUrl(site.rootUrl);
    return {
      schemaVersion: SETUP_ASSISTANT_SCHEMA_VERSION,
      url: storedUrl,
      normalizedUrl: storedUrl,
      source: firstWords(sanitizeEvidenceRef(seed?.source) ?? 'user-authorized-browser-seed-scan', 120),
      seedType: firstWords(seed?.seedType ?? seed?.pageKind ?? 'authorized-browser-page', 80),
      routeKind: firstWords(seed?.routeKind ?? seed?.pageKind ?? '', 80),
      capabilityIds,
      visibleItemCount,
      articleLikeCount: Math.max(0, Number(seed?.articleLikeCount ?? 0) || 0),
      feedLikeCount: Math.max(0, Number(seed?.feedLikeCount ?? 0) || 0),
      searchInputCount: Math.max(0, Number(seed?.searchInputCount ?? 0) || 0),
      linkCount: Math.max(0, Number(seed?.linkCount ?? 0) || 0),
      rawMaterialPersisted: false,
      rawHtmlPersisted: false,
      rawCookiePersisted: false,
      rawCredentialPersisted: false,
    };
  }).filter(Boolean);
}

function uniqueAuthorizedBrowserSeeds(seeds) {
  const deduped = new Map();
  for (const seed of Array.isArray(seeds) ? seeds : []) {
    const key = [
      seed?.normalizedUrl ?? seed?.url ?? '',
      seed?.routeKind ?? '',
      ...(Array.isArray(seed?.capabilityIds) ? seed.capabilityIds : []),
    ].join('|');
    if (!deduped.has(key)) {
      deduped.set(key, seed);
    }
  }
  return [...deduped.values()];
}

function normalizeAutoDiscoverySummary(autoDiscovery) {
  if (!autoDiscovery || autoDiscovery.status !== 'modeled') {
    return null;
  }
  return {
    schemaVersion: AUTO_DISCOVERY_SCHEMA_VERSION,
    artifactFamily: 'siteforge-auto-discovery-summary',
    status: 'modeled',
    mode: firstWords(autoDiscovery.mode ?? 'default', 40),
    source: firstWords(autoDiscovery.source ?? 'known-social-spa-route-state-model', 120),
    siteKey: firstWords(autoDiscovery.siteKey ?? '', 80) || null,
    host: firstWords(autoDiscovery.host ?? '', 120) || null,
    dynamicEnabled: autoDiscovery.dynamicEnabled === true,
    networkEnabled: autoDiscovery.networkEnabled === true,
    routeTemplates: uniqueSortedStrings(autoDiscovery.routeTemplates ?? []),
    tabStates: uniqueSortedStrings(autoDiscovery.tabStates ?? []),
    controlTypes: uniqueSortedStrings(autoDiscovery.controlTypes ?? []),
    structureTypes: uniqueSortedStrings(autoDiscovery.structureTypes ?? []),
    network: {
      status: firstWords(autoDiscovery.network?.status ?? 'not_enabled', 80),
      allowedFields: uniqueSortedStrings(autoDiscovery.network?.allowedFields ?? []),
      rawRequestMaterialPersisted: false,
      rawSecretMaterialPersisted: false,
      identityValuesPersisted: false,
      bodyValuesPersisted: false,
    },
    summary: clone(autoDiscovery.summary ?? {}),
    safetyBoundary: firstWords(autoDiscovery.safetyBoundary, 240),
  };
}

function normalizeUserAuthorizedEvidence(evidence, site, setupPlan, options = /** @type {any} */ ({})) {
  const autoDiscovery = options.autoDiscovery === false || options.noAutoDiscovery === true
    ? null
    : createSocialSpaAutoDiscoverySummary({
      site,
      knownSitePolicy: setupPlan?.knownSitePolicy,
      evidence,
      options,
    });
  const browserSeeds = uniqueAuthorizedBrowserSeeds(normalizeUserAuthorizedBrowserSeeds(evidence?.browserSeeds, site));
  const rawPages = Array.isArray(evidence?.pages) && evidence.pages.length
    ? evidence.pages
    : [{ url: evidence?.finalUrl ?? site.rootUrl, title: evidence?.title }];
  const mergedRawPages = mergeAutoDiscoveryPages(rawPages, autoDiscovery);
  const pagesByUrl = new Map();
  for (const page of mergedRawPages.map((page) => normalizeUserAuthorizedEvidencePage(page, site))) {
    const pageKey = page.stateKey ? `${page.normalizedUrl}#${page.stateKey}` : page.normalizedUrl;
    pagesByUrl.set(pageKey, page);
  }
  for (const seed of browserSeeds) {
    if (!pagesByUrl.has(seed.normalizedUrl)) {
      pagesByUrl.set(seed.normalizedUrl, normalizeUserAuthorizedEvidencePage({
        url: seed.normalizedUrl,
        title: `${new URL(site.rootUrl).hostname} authorized seed`,
        textSummary: `authorized seed summary: ${seed.seedType || 'page'}; visible items ${seed.visibleItemCount}; raw page material was not saved.`,
      }, site));
    }
  }
  const pages = [...pagesByUrl.values()];
  const capabilityProofs = normalizeUserAuthorizedCapabilityProofs(evidence?.capabilityProofs);
  return {
    schemaVersion: SETUP_ASSISTANT_SCHEMA_VERSION,
    artifactFamily: 'siteforge-user-authorized-evidence',
    status: 'captured',
    capturedAt: evidence?.capturedAt ?? new Date().toISOString(),
    source: 'visible-browser-user-authorized',
    authorizationMode: 'manual-user-input',
    siteId: site.id,
    siteKey: setupPlan?.knownSitePolicy?.siteKey ?? null,
    adapterId: setupPlan?.knownSitePolicy?.adapterId ?? null,
    sessionMaterialPersisted: false,
    browserProfilePersisted: false,
    rawHtmlPersisted: false,
    rawCookiePersisted: false,
    rawCredentialPersisted: false,
    autoDiscovery: normalizeAutoDiscoverySummary(autoDiscovery),
    authState: {
      status: evidence?.authState?.status ?? 'authorized',
      riskSignals: uniqueSortedStrings(evidence?.authState?.riskSignals ?? []),
      hasPasswordInput: evidence?.authState?.hasPasswordInput === true,
      finalPath: sanitizeEvidenceRef(evidence?.authState?.finalPath) ?? null,
    },
    pages,
    browserSeeds,
    capabilityProofs,
    evidenceBoundary: 'User authorization proves access to a bounded browser surface only; capabilities still require validation and safety gates.',
  };
}

function defaultKnownSiteAuthorizedFinalUrl(site) {
  try {
    const url = new URL(site.rootUrl);
    if (/^(?:x\.com|twitter\.com)$/iu.test(url.hostname.replace(/^www\./u, ''))) {
      return new URL('/home', site.rootUrl).toString();
    }
  } catch {
    // Fall back to the site root below.
  }
  return site.rootUrl;
}

function createKnownSiteAutoAuthorizedEvidence(inputUrl, setupPlan, paths, options = /** @type {any} */ ({})) {
  const finalUrl = defaultKnownSiteAuthorizedFinalUrl(paths.site);
  const host = new URL(paths.site.rootUrl).hostname;
  const evidence = {
    capturedAt: new Date().toISOString(),
    finalUrl,
    title: `${host} user-authorized browser surface`,
    authState: {
      status: 'authorized',
      finalUrl,
      finalPath: new URL(finalUrl).pathname,
      riskSignals: [],
      syntheticAutoDiscovery: true,
    },
    pages: [{
      url: finalUrl,
      title: `${host} user-authorized browser surface`,
      pageType: 'home',
      routeTemplate: '/home',
      tabState: 'for_you',
      stateKey: 'home:for_you',
      listPresent: true,
      visibleItemCount: options.deep === true ? 12 : 6,
      textSummary: 'Known-site auto-discovery captured a bounded route and structure summary. No raw page, session, or account material was saved.',
    }],
    browserSeeds: authorizedBrowserRouteSeedsFromFinalUrl(finalUrl, paths.site, setupPlan?.knownSitePolicy),
  };
  return normalizeUserAuthorizedEvidence(evidence, paths.site, setupPlan, {
    ...options,
    autoDiscovery: true,
    autoDiscoveryDeep: options.deep === true || options.autoDiscoveryDeep === true,
    autoDiscoveryNetwork: options.network === true || options.captureNetwork === true,
  });
}

async function persistAutoAuthorizedKnownSiteProfile({ inputUrl, paths, setupPlan, options, mode }) {
  const userAuthorizedEvidence = createKnownSiteAutoAuthorizedEvidence(inputUrl, setupPlan, paths, options);
  const nextSetupPlan = applyUserAuthorizedEvidenceToSetupPlan(setupPlan, userAuthorizedEvidence, paths);
  const userChoices = applyBuildModeChoiceOverrides(defaultChoicesFromPlan(nextSetupPlan, mode), options);
  const proofOptions = {
    ...options,
    disableManualCapabilityProofPrompt: true,
  };
  const proofedSetupPlan = await collectSelectedCapabilityProofs(nextSetupPlan, userChoices, proofOptions);
  const persisted = await persistSetupProfile({
    paths,
    setupPlan: proofedSetupPlan,
    userChoices,
    saveProfile: true,
  });
  return {
    status: 'created',
    paths,
    setupPlan: proofedSetupPlan,
    ...persisted,
    buildOptions: buildOptionsFromFreshSetupProfile(options, paths, persisted.profile, proofedSetupPlan),
  };
}

function userAuthorizedSetupIncompleteError(paths, evidence) {
  const signals = uniqueSortedStrings(evidence?.authState?.riskSignals ?? ['unknown-auth-state']);
  const error = /** @type {Error & Record<string, any>} */ (new Error(
    `user-authorized-setup-incomplete: auth setup is incomplete. signals=${signals.join(',')}`,
  ));
  error.code = 'user-authorized-setup-incomplete';
  error.reasonCode = signals.includes('login-wall')
    ? 'login-wall'
    : signals.includes('identity-provider-blocked-unsafe-browser')
      ? 'identity-provider-blocked-unsafe-browser'
      : signals.includes('external-identity-provider')
        ? 'external-identity-provider'
        : signals.includes('manual-final-url-required')
          ? 'manual-final-url-required'
          : signals.includes('challenge')
            ? 'manual-challenge-required'
            : 'user-authorized-setup-incomplete';
  error.artifactDir = paths.artifactDir;
  error.setupPlanPath = paths.setupPlanPath;
  return error;
}

function assertUserAuthorizedEvidenceReady(paths, evidence) {
  const authState = evidence?.authState ?? {};
  const signals = uniqueSortedStrings(authState.riskSignals ?? []);
  if (authState.status && authState.status !== 'authorized') {
    throw userAuthorizedSetupIncompleteError(paths, evidence);
  }
  if (authState.hasPasswordInput === true || signals.some((signal) => ['login-wall', 'challenge', 'mfa-required'].includes(signal))) {
    throw userAuthorizedSetupIncompleteError(paths, evidence);
  }
}

function detectManualUserAuthorizedAuthState(finalUrlOrStatus, site) {
  const text = compactText(finalUrlOrStatus);
  if (!text) {
    return {
      status: 'incomplete',
      riskSignals: ['manual-final-url-required'],
      hasPasswordInput: false,
      finalPath: null,
    };
  }
  const lowerText = text.toLowerCase();
  if (
    ['blocked', 'refused'].includes(lowerText)
    || /unsafe browser|browser or app may not be secure|not secure|couldn.t sign you in/u.test(lowerText)
  ) {
    return {
      status: 'incomplete',
      riskSignals: ['identity-provider-blocked-unsafe-browser'],
      hasPasswordInput: false,
      finalPath: null,
    };
  }

  let parsed;
  try {
    parsed = new URL(text, site.rootUrl);
  } catch {
    return {
      status: 'incomplete',
      riskSignals: ['manual-final-url-required'],
      hasPasswordInput: false,
      finalPath: null,
    };
  }

  const host = parsed.hostname.toLowerCase();
  const pathName = parsed.pathname.toLowerCase();
  if (/accounts\.google\.com$|google\.com$/iu.test(host)) {
    return {
      status: 'incomplete',
      riskSignals: ['identity-provider-blocked-unsafe-browser'],
      hasPasswordInput: false,
      finalPath: pathName || '/',
    };
  }

  let normalizedUrl;
  try {
    normalizedUrl = normalizeUrl(parsed.href, site.rootUrl);
  } catch {
    normalizedUrl = null;
  }
  if (!normalizedUrl || !isInternalUrl(normalizedUrl, site.allowedDomains)) {
    return {
      status: 'incomplete',
      riskSignals: ['external-identity-provider'],
      hasPasswordInput: false,
      finalPath: pathName || '/',
    };
  }

  if (
    /\/(?:login|signin|signup)(?:\/|$)/u.test(pathName)
    || /\/i\/flow\/(?:login|signup)(?:\/|$)/u.test(pathName)
  ) {
    return {
      status: 'incomplete',
      riskSignals: ['login-wall'],
      hasPasswordInput: true,
      finalPath: pathName || '/',
      finalUrl: normalizedUrl,
    };
  }

  return {
    status: 'authorized',
    riskSignals: [],
    hasPasswordInput: false,
    finalPath: pathName || '/',
    finalUrl: normalizedUrl,
  };
}

export function parseSupplementalCollectionEvidenceInput(answer, site) {
  const text = compactText(answer);
  if (!text) {
    return {
      accepted: false,
      reasonCode: 'empty',
      sampleCount: 0,
      evidenceType: null,
    };
  }

  const countText = text.match(/^(\d+)(?:\s*(?:个|条|项|页|本|篇|items?|visible))?$/iu)?.[1];
  if (countText) {
    const sampleCount = Math.max(0, Number(countText) || 0);
    return sampleCount > 0
      ? {
        accepted: true,
        reasonCode: 'visible-count',
        sampleCount,
        evidenceType: 'manual-visible-browser-count',
      }
      : {
        accepted: false,
        reasonCode: 'zero-count',
        sampleCount: 0,
        evidenceType: null,
      };
  }

  if (!site?.rootUrl || !Array.isArray(site?.allowedDomains)) {
    return {
      accepted: false,
      reasonCode: 'site-context-required',
      sampleCount: 0,
      evidenceType: null,
    };
  }
  if (!/^[a-z][a-z0-9+.-]*:\/\//iu.test(text)) {
    return {
      accepted: false,
      reasonCode: 'not-url-or-count',
      sampleCount: 0,
      evidenceType: null,
    };
  }

  let normalizedUrl;
  try {
    normalizedUrl = normalizeUrl(text, site.rootUrl);
  } catch {
    return {
      accepted: false,
      reasonCode: 'not-url-or-count',
      sampleCount: 0,
      evidenceType: null,
    };
  }

  const authState = detectManualUserAuthorizedAuthState(normalizedUrl, site);
  if (authState.status !== 'authorized' || !isInternalUrl(normalizedUrl, site.allowedDomains)) {
    return {
      accepted: false,
      reasonCode: authState.riskSignals?.[0] ?? 'invalid-final-url',
      sampleCount: 0,
      evidenceType: null,
    };
  }

  return {
    accepted: true,
    reasonCode: 'final-url',
    sampleCount: 1,
    evidenceType: 'manual-visible-browser-final-url',
    normalizedUrl: authState.finalUrl ?? normalizedUrl,
  };
}

async function detectUserAuthorizedAuthState(session) {
  const authState = await session.evaluateValue(`(() => {
    const path = String(location.pathname || '').toLowerCase();
    const title = String(document.title || '');
    const bodyText = String(document.body?.innerText || '').slice(0, 2000);
    const text = (title + ' ' + bodyText).toLowerCase();
    const hasPasswordInput = Boolean(document.querySelector('input[type="password"]'));
    const riskSignals = /** @type {any[]} */ ([]);
    if (
      hasPasswordInput
      || /\\/(?:login|signin|signup)(?:\\/|$)/.test(path)
      || /\\/i\\/flow\\/(?:login|signup)(?:\\/|$)/.test(path)
      || /\\b(?:log in|sign in|login|sign up)\\b|登录|登入/.test(text)
    ) {
      riskSignals.push('login-wall');
    }
    if (/captcha|challenge|verify|verification|mfa|two[- ]?factor|2fa|验证码/.test(text)) {
      riskSignals.push('challenge');
    }
    return {
      status: riskSignals.length ? 'incomplete' : 'authorized',
      riskSignals,
      hasPasswordInput,
      finalPath: path || '/',
    };
  })()`);
  return {
    status: authState?.status === 'authorized' ? 'authorized' : 'incomplete',
    riskSignals: uniqueSortedStrings(authState?.riskSignals ?? []),
    hasPasswordInput: authState?.hasPasswordInput === true,
    finalPath: authState?.finalPath ?? null,
  };
}

const RESERVED_SOCIAL_PROFILE_PATHS = Object.freeze(new Set([
  'about',
  'compose',
  'explore',
  'home',
  'i',
  'jobs',
  'lists',
  'login',
  'messages',
  'notifications',
  'privacy',
  'search',
  'settings',
  'signup',
  'tos',
]));

function normalizedPathName(value) {
  const pathName = String(value ?? '/').toLowerCase().split(/[?#]/u)[0] || '/';
  return pathName.endsWith('/') && pathName !== '/' ? pathName.slice(0, -1) : pathName;
}

function isKnownSocialProfilePath(pathName) {
  const normalized = normalizedPathName(pathName);
  const match = normalized.match(/^\/([a-z0-9_]{1,30})$/iu);
  return Boolean(match && !RESERVED_SOCIAL_PROFILE_PATHS.has(match[1].toLowerCase()));
}

function socialUtilityRouteCapability(pathName) {
  const normalized = normalizedPathName(pathName);
  if (/^\/notifications(?:\/|$)/u.test(normalized)) {
    return {
      routeKind: 'notifications',
      capabilityIds: ['list-notifications'],
    };
  }
  if (/^\/(?:i\/)?bookmarks(?:\/|$)/u.test(normalized)) {
    return {
      routeKind: 'bookmarks',
      capabilityIds: ['list-bookmarks'],
    };
  }
  if (/^\/messages(?:\/|$)/u.test(normalized)) {
    return {
      routeKind: 'direct-messages',
      capabilityIds: ['list-direct-messages'],
    };
  }
  if (/^\/(?:i\/)?lists(?:\/|$)/u.test(normalized) || /^\/[^/]+\/lists(?:\/|$)/u.test(normalized)) {
    return {
      routeKind: 'lists',
      capabilityIds: ['list-lists'],
    };
  }
  return null;
}

function isFollowingRoutePath(pathName) {
  const normalized = normalizedPathName(pathName);
  return /(?:^|\/)(?:follow|following)(?:\/|$)/u.test(normalized);
}

function knownPolicyFollowingRoutePath(knownSitePolicy = null) {
  const siteKey = String(knownSitePolicy?.siteKey ?? knownSitePolicy?.adapterId ?? '').toLowerCase();
  return siteKey === 'douyin' ? '/follow' : '/following';
}

function knownPolicySearchRoutePath(knownSitePolicy = null) {
  const siteKey = String(knownSitePolicy?.siteKey ?? knownSitePolicy?.adapterId ?? '').toLowerCase();
  return siteKey === 'douyin' ? '/search/' : '/search';
}

function authorizedBrowserRouteKindFromPath(pathName) {
  const normalized = normalizedPathName(pathName);
  if (normalized === '/home' || /\/(?:timeline|feed)(?:\/|$)/u.test(normalized)) {
    return 'home-timeline';
  }
  if (isFollowingRoutePath(normalized)) {
    return 'following';
  }
  if (/\/(?:search|explore)(?:\/|$)/u.test(normalized)) {
    return normalized.includes('/explore') ? 'social-discovery' : 'search';
  }
  const utility = socialUtilityRouteCapability(normalized);
  if (utility) {
    return utility.routeKind;
  }
  if (isKnownSocialProfilePath(normalized)) {
    return 'profile';
  }
  return 'authorized-route';
}

function capabilityIdsFromAuthorizedBrowserSeedSummary(summary = /** @type {any} */ ({})) {
  const capabilities = new Set();
  const pathName = normalizedPathName(summary.pathName);
  const articleLikeCount = Number(summary.articleLikeCount ?? 0);
  const feedLikeCount = Number(summary.feedLikeCount ?? 0);
  const searchInputCount = Number(summary.searchInputCount ?? 0);
  const profileLinkCount = Number(summary.profileLinkCount ?? 0);
  const followingLinkCount = Number(summary.followingLinkCount ?? 0);
  if ((pathName === '/home' || /\/(?:home|timeline|feed)(?:\/|$)/u.test(pathName)) && (articleLikeCount > 0 || feedLikeCount > 0)) {
    capabilities.add('recommended-timeline-posts');
  }
  if (followingLinkCount > 0 || (isFollowingRoutePath(pathName) && profileLinkCount > 0)) {
    capabilities.add('list-followed-users');
  }
  if (articleLikeCount > 0 && isFollowingRoutePath(pathName)) {
    capabilities.add('list-followed-updates');
  }
  if (profileLinkCount > 0 || (isKnownSocialProfilePath(pathName) && articleLikeCount > 0)) {
    capabilities.add('list-profile-content');
  }
  if (searchInputCount > 0) {
    capabilities.add('search-posts');
  }
  return [...capabilities];
}

async function collectAuthorizedBrowserSeedsFromSession(session, site) {
  let summary = null;
  try {
    summary = await session.callPageFunction((allowedDomains) => {
      const href = String(globalThis.location?.href || '');
      const pathName = String(globalThis.location?.pathname || '/').toLowerCase();
      const normalizedDomains = Array.isArray(allowedDomains)
        ? allowedDomains.map((domain) => String(domain || '').replace(/^www\./i, '').toLowerCase()).filter(Boolean)
        : [];
      const isAllowedProfileUrl = (url) => {
        try {
          const parsed = new URL(url, href);
          const host = parsed.hostname.replace(/^www\./i, '').toLowerCase();
          return normalizedDomains.includes(host) && /^\/[^/?#]+\/?$/u.test(parsed.pathname);
        } catch {
          return false;
        }
      };
      const articleLikeCount = document.querySelectorAll('article, [role="article"], [data-testid="tweet"], [data-testid*="cellInnerDiv"]').length;
      const feedLikeCount = [
        ...document.querySelectorAll('[role="feed"], main, [data-testid*="primaryColumn"], [data-testid*="timeline"]'),
      ].filter((node) => {
        const element = /** @type {any} */ (node);
        return /timeline|feed|home|primary|main/i.test([
          element.getAttribute?.('aria-label'),
          element.getAttribute?.('data-testid'),
          element.id,
          element.className,
          element.tagName,
        ].join(' '));
      }).length;
      const searchInputCount = [...document.querySelectorAll('input, [role="searchbox"], [aria-label]')]
        .filter((node) => {
          const element = /** @type {any} */ (node);
          return /search|鎼滅储/i.test([
            element.getAttribute?.('aria-label'),
            element.getAttribute?.('placeholder'),
            element.getAttribute?.('role'),
            element.name,
            element.type,
          ].join(' '));
        }).length;
      const links = [...document.querySelectorAll('a[href]')].map((node) => {
        const element = /** @type {any} */ (node);
        return String(element.href || element.getAttribute('href') || '');
      });
      const profileLinkCount = links.filter(isAllowedProfileUrl).length;
      const followingLinkCount = links.filter((url) => /\/(?:follow|following)(?:[/?#]|$)/i.test(url)).length;
      return {
        href,
        pathName,
        articleLikeCount,
        feedLikeCount,
        searchInputCount,
        linkCount: links.length,
        profileLinkCount,
        followingLinkCount,
      };
    }, site.allowedDomains);
  } catch {
    return [];
  }
  if (!summary?.href) {
    return [];
  }
  let normalizedUrl;
  try {
    normalizedUrl = normalizeUrl(summary.href, site.rootUrl);
  } catch {
    return [];
  }
  if (!isInternalUrl(normalizedUrl, site.allowedDomains)) {
    return [];
  }
  const capabilityIds = capabilityIdsFromAuthorizedBrowserSeedSummary(summary);
  const host = new URL(site.rootUrl).hostname;
  const visibleItemCount = Math.max(
    Number(summary.articleLikeCount ?? 0) || 0,
    Number(summary.feedLikeCount ?? 0) || 0,
    Number(summary.searchInputCount ?? 0) || 0,
    Number(summary.profileLinkCount ?? 0) || 0,
    Number(summary.followingLinkCount ?? 0) || 0,
  );
  return [{
    url: normalizedUrl,
    title: `${host} authorized browser surface`,
    source: 'controlled-user-authorized-browser-seed-scan',
    seedType: normalizedPathName(summary.pathName) === '/home' ? 'timeline-home' : 'authorized-browser-page',
    routeKind: authorizedBrowserRouteKindFromPath(summary.pathName),
    capabilityIds,
    visibleItemCount,
    articleLikeCount: Number(summary.articleLikeCount ?? 0) || 0,
    feedLikeCount: Number(summary.feedLikeCount ?? 0) || 0,
    searchInputCount: Number(summary.searchInputCount ?? 0) || 0,
    linkCount: Number(summary.linkCount ?? 0) || 0,
  }];
}

function authorizedBrowserRouteSeedsFromFinalUrl(finalUrl, site, knownSitePolicy = null) {
  let parsed;
  let normalizedUrl;
  try {
    parsed = new URL(finalUrl, site.rootUrl);
    normalizedUrl = normalizeUrl(parsed.href, site.rootUrl);
  } catch {
    return [];
  }
  if (!isInternalUrl(normalizedUrl, site.allowedDomains)) {
    return [];
  }
  const pathName = normalizedPathName(parsed.pathname);
  const hasSocialContent = policySupportsCapabilityFamily(knownSitePolicy, 'query-social-content')
    || policySupportsCapabilityFamily(knownSitePolicy, 'search-content');
  const hasSocialRelations = policySupportsCapabilityFamily(knownSitePolicy, 'query-social-relations');
  const hasAccountProfile = policySupportsCapabilityFamily(knownSitePolicy, 'query-account-profile');
  const hasUtilityRoutes = policySupportsCapabilityFamily(knownSitePolicy, 'navigate-to-utility-page');
  const seeds = /** @type {any[]} */ ([]);
  const addSeed = (urlValue, {
    routeKind = 'authorized-route',
    capabilityIds = /** @type {any[]} */ ([]),
    visibleItemCount = 0,
    searchInputCount = 0,
  } = /** @type {any} */ ({})) => {
    let seedUrl;
    try {
      seedUrl = normalizeUrl(urlValue, site.rootUrl);
    } catch {
      return;
    }
    if (!isInternalUrl(seedUrl, site.allowedDomains) || seeds.some((seed) => seed.normalizedUrl === seedUrl)) {
      return;
    }
    seeds.push({
      url: seedUrl,
      normalizedUrl: seedUrl,
      source: seedUrl === normalizedUrl ? 'user-authorized-normal-browser-route-seed' : 'known-site-authorized-route-expansion',
      seedType: 'authorized-route-seed',
      routeKind,
      capabilityIds: uniqueSortedStrings(capabilityIds.map(normalizeCapabilityId).filter(Boolean)),
      visibleItemCount,
      articleLikeCount: 0,
      feedLikeCount: 0,
      searchInputCount,
      linkCount: 0,
      rawMaterialPersisted: false,
      rawHtmlPersisted: false,
      rawCookiePersisted: false,
      rawCredentialPersisted: false,
    });
  };

  const utilityRoute = socialUtilityRouteCapability(pathName);
  if (/\/(?:home|timeline|feed)(?:\/|$)/u.test(pathName) && hasSocialContent) {
    addSeed(normalizedUrl, {
      routeKind: 'home-timeline',
      capabilityIds: ['recommended-timeline-posts'],
    });
  } else if (isFollowingRoutePath(pathName) && hasSocialRelations) {
    addSeed(normalizedUrl, {
      routeKind: 'following',
      capabilityIds: ['list-followed-users'],
    });
  } else if (/\/(?:search|explore)(?:\/|$)/u.test(pathName) && hasSocialContent) {
    addSeed(normalizedUrl, {
      routeKind: 'search',
      capabilityIds: ['search-posts'],
    });
  } else if (isKnownSocialProfilePath(pathName) && hasAccountProfile) {
    addSeed(normalizedUrl, {
      routeKind: 'profile',
      capabilityIds: ['list-profile-content'],
    });
  } else if (utilityRoute && hasUtilityRoutes) {
    addSeed(normalizedUrl, {
      routeKind: utilityRoute.routeKind,
      capabilityIds: utilityRoute.capabilityIds,
    });
  } else {
    addSeed(normalizedUrl, { routeKind: authorizedBrowserRouteKindFromPath(pathName) });
  }

  if (hasSocialContent) {
    addSeed(new URL('/home', site.rootUrl).toString(), {
      routeKind: 'home-timeline',
      capabilityIds: ['recommended-timeline-posts'],
    });
    addSeed(new URL('/explore', site.rootUrl).toString(), {
      routeKind: 'social-discovery',
      capabilityIds: ['search-posts'],
    });
    addSeed(new URL(knownPolicySearchRoutePath(knownSitePolicy), site.rootUrl).toString(), {
      routeKind: 'search',
      capabilityIds: ['search-posts'],
    });
  }
  if (hasSocialRelations) {
    addSeed(new URL(knownPolicyFollowingRoutePath(knownSitePolicy), site.rootUrl).toString(), {
      routeKind: 'following',
      capabilityIds: ['list-followed-users'],
    });
  }
  if (hasAccountProfile && isKnownSocialProfilePath(pathName)) {
    addSeed(normalizedUrl, {
      routeKind: 'profile',
      capabilityIds: ['list-profile-content'],
    });
  }
  if (hasUtilityRoutes) {
    for (const [routePath, routeKind, capabilityId] of [
      ['/notifications', 'notifications', 'list-notifications'],
      ['/i/bookmarks', 'bookmarks', 'list-bookmarks'],
      ['/messages', 'direct-messages', 'list-direct-messages'],
      ['/i/lists', 'lists', 'list-lists'],
    ]) {
      addSeed(new URL(routePath, site.rootUrl).toString(), {
        routeKind,
        capabilityIds: [capabilityId],
      });
    }
  }
  return seeds;
}

async function defaultUserAuthorizedEvidenceProvider({ paths }) {
  return {
    capturedAt: new Date().toISOString(),
    finalUrl: paths?.site?.rootUrl ?? null,
    status: 'skipped',
    pages: [],
    browserSeeds: [],
    rawMaterialPersisted: false,
    sessionMaterialPersisted: false,
    browserProfilePersisted: false,
  };
}

async function collectUserAuthorizedEvidence({ inputUrl, setupPlan, paths, options }) {
  const provider = options.userAuthorizedEvidenceProvider ?? defaultUserAuthorizedEvidenceProvider;
  const evidence = await provider({ inputUrl, setupPlan, paths, options });
  const defaultAutoDiscovery = !options.userAuthorizedEvidenceProvider
    || options.auto === true
    || options.deep === true
    || options.autoDiscovery === true
    || options.autoDiscoveryDeep === true;
  const normalized = normalizeUserAuthorizedEvidence(evidence, paths.site, setupPlan, {
    ...options,
    autoDiscovery: options.autoDiscovery ?? defaultAutoDiscovery,
    autoDiscoveryDeep: options.autoDiscoveryDeep === true || options.deep === true,
    autoDiscoveryNetwork: options.autoDiscoveryNetwork === true || options.network === true,
  });
  assertUserAuthorizedEvidenceReady(paths, normalized);
  return normalized;
}

function pageInputsFromAuthorizedEvidence(evidence) {
  return (evidence?.pages ?? []).map((page) => ({
    url: page.normalizedUrl ?? page.url,
    title: page.title,
    label: '用户授权浏览器页面',
    source: 'user_authorized_browser',
  }));
}

const USER_AUTHORIZED_CAPABILITY_PROOF_DESCRIPTORS = Object.freeze({
  'list-followed-users': {
    action: 'followed-users',
    intentType: 'list-followed-users',
    prompt: 'Enter only a same-site page URL or visible count; do not paste forms, account data, body text, cookie, token, or private content.',
  },
  'list-followed-updates': {
    action: 'followed-posts-by-date',
    intentType: 'list-followed-updates',
    prompt: 'Enter only a same-site page URL or visible count; do not paste forms, account data, body text, cookie, token, or private content.',
  },
  'list-profile-content': {
    action: 'profile-content',
    intentType: 'list-profile-content',
    prompt: 'Enter only a same-site page URL or visible count; do not paste forms, account data, body text, cookie, token, or private content.',
  },
  'search-posts': {
    action: 'search',
    intentType: 'search-posts',
    prompt: 'Enter only a same-site page URL or visible count; do not paste forms, account data, body text, cookie, token, or private content.',
  },
  'recommended-timeline-posts': {
    action: 'recommended-timeline-posts',
    intentType: 'recommended-timeline-posts',
    prompt: 'Enter only a same-site page URL or visible count; do not paste forms, account data, body text, cookie, token, or private content.',
  },
  'list-notifications': {
    action: 'notifications',
    intentType: 'list-notifications',
    prompt: 'Enter only a same-site page URL or visible count; do not paste forms, account data, body text, cookie, token, or private content.',
  },
  'list-bookmarks': {
    action: 'bookmarks',
    intentType: 'list-bookmarks',
    prompt: 'Enter only a same-site page URL or visible count; do not paste forms, account data, body text, cookie, token, or private content.',
  },
  'list-lists': {
    action: 'lists',
    intentType: 'list-lists',
    prompt: 'Enter only a same-site page URL or visible count; do not paste forms, account data, body text, cookie, token, or private content.',
  },
  'list-direct-messages': {
    action: 'direct-messages',
    intentType: 'list-direct-messages',
    prompt: 'Enter only a same-site page URL or visible count; do not paste forms, account data, body text, cookie, token, or private content.',
  },
});

function userAuthorizedCapabilityProofDescriptor(capabilityId) {
  return USER_AUTHORIZED_CAPABILITY_PROOF_DESCRIPTORS[normalizeCapabilityId(capabilityId)] ?? null;
}

function requestedCapabilityFromHint(hint) {
  const normalized = compactText(hint).toLowerCase();
  if (!normalized) {
    return null;
  }
  const structuredCapability = normalized.match(/^capability:([a-z0-9-]+)$/u)?.[1];
  if (structuredCapability) {
    const label = collectionReviewLabel(structuredCapability);
    return {
      id: structuredCapability,
      label,
      supported: true,
    };
  }
  if (normalized === 'unmatched-user-hint') {
    return {
      id: 'unmatched-user-hint',
      label: '未匹配的用户请求',
      supported: false,
      reasonCode: 'unmatched-user-hint',
      reason: 'The setup hint did not map to a known evidence-backed capability.',
    };
  }
  if (/(?:(?:edit|update|change|modify|修改|编辑|更改).*(?:profile|account profile|bio|homepage|个人资料|账号资料|主页信息|主页)|(?:profile|account profile|bio|homepage|个人资料|账号资料|主页信息|主页).*(?:edit|update|change|modify|修改|编辑|更改))/iu.test(normalized)) {
    return {
      id: 'edit-profile',
      label: '修改账号资料',
      supported: false,
      reasonCode: 'write-intent-disabled',
      reason: 'Profile editing is a write/account-mutation intent and must not map to read-profile capability.',
    };
  }
  if (/(推荐|for you|recommend|recommended).*(时间线|timeline|feed|帖子|posts?)|(?:时间线|timeline).*(推荐|recommend|recommended)/iu.test(normalized)) {
    return {
      id: 'recommended-timeline-posts',
      label: '读取推荐时间线帖子',
      supported: true,
      reasonCode: 'capability-specific-evidence-required',
      reason: 'Recommended timeline content requires capability-specific user-authorized evidence and is not equivalent to followed updates.',
    };
  }
  if (/(关注列表|关注用户|followed users|following accounts|who do i follow)/iu.test(normalized)) {
    return { id: 'list-followed-users', label: '读取关注列表', supported: true };
  }
  if (/(关注动态|关注更新|followed updates|following posts|followed account posts)/iu.test(normalized)) {
    return { id: 'list-followed-updates', label: 'List followed updates', supported: true };
  }
  if (/(个人主页|主页内容|profile content|account posts|profile posts)/iu.test(normalized)) {
    return { id: 'list-profile-content', label: '读取个人主页内容', supported: true };
  }
  if (/(通知|notifications?)/iu.test(normalized)) {
    return { id: 'list-notifications', label: '读取通知摘要', supported: true };
  }
  if (/(书签|bookmarks?)/iu.test(normalized)) {
    return { id: 'list-bookmarks', label: '读取书签摘要', supported: true };
  }
  if (/(列表|lists?)/iu.test(normalized)) {
    return { id: 'list-lists', label: '读取列表摘要', supported: true };
  }
  if (/(私信|direct messages?|messages?|dms?)/iu.test(normalized)) {
    return { id: 'list-direct-messages', label: '读取私信会话列表摘要', supported: true };
  }
  if (/(搜索|search|find posts|query posts)/iu.test(normalized)) {
    return { id: 'search-posts', label: '搜索帖子', supported: true };
  }
  return {
    id: 'unmatched-user-hint',
    label: '未匹配的用户请求',
    supported: false,
    reasonCode: 'unmatched-user-hint',
    reason: 'The setup hint did not map to a known evidence-backed capability.',
  };
}

function evaluateUserIntentCoverage(hints = /** @type {any[]} */ ([]), availableCapabilities = /** @type {any[]} */ ([])) {
  const capabilityById = new Map(availableCapabilities.map((capability) => [normalizeCapabilityId(capability.id), capability]));
  const findAvailableCapability = (requestId) => {
    const normalizedId = normalizeCapabilityId(requestId);
    if (capabilityById.has(normalizedId)) {
      return capabilityById.get(normalizedId);
    }
    if (normalizedId === 'search-posts') {
      return availableCapabilities.find((capability) => /search/iu.test(`${capability.id} ${capability.name}`)) ?? null;
    }
    return null;
  };
  const requested = hints.map((hint) => ({
    hint,
    request: requestedCapabilityFromHint(hint),
  })).filter((entry) => entry.request);
  const supportedRequests = /** @type {any[]} */ ([]);
  const unsupportedRequests = /** @type {any[]} */ ([]);
  const unmatchedRequests = /** @type {any[]} */ ([]);
  for (const entry of requested) {
    const available = findAvailableCapability(entry.request.id);
    const record = {
      hint: entry.hint,
      id: entry.request.id,
      label: entry.request.label,
      reasonCode: entry.request.reasonCode ?? null,
      reason: entry.request.reason ?? null,
      available: Boolean(available),
      selected: available?.selected === true,
      evidenceRequirement: available?.evidenceRequirement ?? null,
    };
    if (entry.request.supported === true && available) {
      supportedRequests.push(record);
    } else if (entry.request.reasonCode === 'unmatched-user-hint') {
      unmatchedRequests.push(record);
    } else {
      unsupportedRequests.push(record);
    }
  }
  return {
    schemaVersion: SETUP_ASSISTANT_SCHEMA_VERSION,
    requested: requested.map((entry) => ({
      hint: entry.hint,
      id: entry.request.id,
      label: entry.request.label,
      supported: entry.request.supported === true,
    })),
    supportedRequests,
    unsupportedRequests,
    unmatchedRequests,
    evidenceBoundary: 'User choices guide setup scope only; unsupported or unproven requests cannot become active capabilities without evidence.',
  };
}

async function readKnownSitePolicy(paths) {
  const configRoots = uniqueSortedStrings([
    paths.cwd,
    PACKAGE_ROOT,
  ].map((root) => path.resolve(root)));
  for (const root of configRoots) {
    const [registry, capabilities] = await Promise.all([
      readSiteRegistry(root),
      readSiteCapabilities(root),
    ]);
    const registryRecord = configRecordForSite(registry, paths.site);
    const capabilityRecord = configRecordForSite(capabilities, paths.site);
    if (registryRecord || capabilityRecord) {
      return knownPolicySummary(registryRecord, capabilityRecord);
    }
  }
  return knownPolicySummary(null, null);
}

function isUsableSavedBuildProfile(profile) {
  return profile?.artifactFamily === 'siteforge-build-profile'
    && profile?.site?.rootUrl
    && profile?.source?.type === 'live_website'
    && isBuildProfileSafe(profile)
    && !profileHasRetiredFixtureSource(profile)
    && !profileHasRetiredAuthenticationModel(profile)
    && profile?.scope
    && profile?.safety
    && hasCurrentSetupEvidenceGate(profile)
    && !isProfileMarkedUnusable(profile);
}

function profileHasRetiredFixtureSource(value) {
  if (value === null || value === undefined) {
    return false;
  }
  if (typeof value === 'string') {
    return /tests[\\/]+fixtures[\\/]+sites/iu.test(value);
  }
  if (Array.isArray(value)) {
    return value.some((item) => profileHasRetiredFixtureSource(item));
  }
  if (typeof value !== 'object') {
    return false;
  }
  for (const [key, item] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase();
    if (normalizedKey === 'sourcemode') {
      if (String(item ?? '').toLowerCase().includes('fixture')) {
        return true;
      }
      continue;
    }
    if (normalizedKey.includes('fixture')) {
      return true;
    }
    if (normalizedKey === 'source' || normalizedKey === 'type') {
      if (String(item ?? '').toLowerCase().includes('fixture')) {
        return true;
      }
    }
    if (profileHasRetiredFixtureSource(item)) {
      return true;
    }
  }
  return false;
}

function profileHasRetiredAuthenticationModel(value) {
  if (value === null || value === undefined) {
    return false;
  }
  if (Array.isArray(value)) {
    return value.some((item) => profileHasRetiredAuthenticationModel(item));
  }
  if (typeof value !== 'object') {
    return false;
  }
  for (const [key, item] of Object.entries(value)) {
    const retiredKeys = new Set([
      `auth${'Level'}`,
      `requiredAuth${'Level'}`,
      `observedAuth${'Level'}`,
    ]);
    if (retiredKeys.has(key)) {
      return true;
    }
    if (profileHasRetiredAuthenticationModel(item)) {
      return true;
    }
  }
  return false;
}

function hasCurrentSetupEvidenceGate(profile) {
  return Boolean(profile?.evidenceQuality && typeof profile.evidenceQuality === 'object')
    && Boolean(profile?.buildReadiness && typeof profile.buildReadiness === 'object')
    && Boolean(profile?.profileUsability && typeof profile.profileUsability === 'object')
    && !hasUnsupportedUserIntentCoverage(profile)
    && profileSelectedCapabilitiesHaveRequiredProofs(profile)
    && (
      !Array.isArray(profile?.userHints)
      || profile.userHints.length === 0
      || Boolean(profile?.userIntentCoverage && typeof profile.userIntentCoverage === 'object')
    );
}

function hasUnsupportedUserIntentCoverage(profile) {
  return (profile?.userIntentCoverage?.unsupportedRequests ?? []).length > 0;
}

function profileSelectedCapabilitiesHaveRequiredProofs(profile) {
  const selected = profile?.capabilityScope?.selectedCapabilities ?? [];
  const proofs = normalizeUserAuthorizedCapabilityProofs(profile?.userAuthorizedEvidence?.capabilityProofs);
  for (const capability of selected) {
    if (
      capability?.evidenceRequirement === 'capability-specific-evidence'
      && userAuthorizedCapabilityProofDescriptor(capability.id ?? capability.name)
      && !proofs.some((proof) => capabilityProofMatches(proof, capability))
    ) {
      return false;
    }
  }
  return true;
}

function isProfileMarkedUnusable(profile) {
  return profile?.profileUsability?.buildable === false
    || profile?.profileUsability?.status === 'unusable'
    || profile?.buildReadiness?.buildable === false
    || profile?.buildReadiness?.status === 'not_ready'
    || (
      profile?.evidenceQuality?.syntheticFallbackOnly === true
      && Number(profile?.evidenceQuality?.actualPageEvidenceCount ?? 0) === 0
    );
}

function resolveSetupInteractive(options = /** @type {any} */ ({})) {
  return Boolean(
    typeof options.setupPrompt === 'function'
    && (options.setupInteractive === true || options.interactive === true)
    && !options.noTty
    && !options.json
    && !options.quiet,
  );
}

async function safeRead(source, urlValue, warnings, label) {
  try {
    return await source.read(urlValue);
  } catch (error) {
    warnings.push(`${label} unavailable: ${error?.message ?? String(error)}`);
    return null;
  }
}

function recordSourceDiagnostic(diagnostics, label, result) {
  if (!result?.request) {
    return;
  }
  diagnostics.push({
    label,
    sourceType: result.sourceType ?? 'live_website',
    sourcePath: result.sourcePath,
    requestedUrl: result.requestedUrl ?? null,
    finalUrl: result.finalUrl ?? result.sourcePath ?? null,
    fetchedAt: result.fetchedAt ?? null,
    method: result.request.method,
    statusCode: result.request.statusCode,
    requestHeaders: clone(result.request.requestHeaders ?? {}),
    proxy: result.request.proxy ?? null,
  });
}

function categoryForPage(page) {
  const haystack = `${page.url} ${page.title ?? ''} ${page.label ?? ''}`.toLowerCase();
  if (page.source === 'user_authorized_browser') {
    return { id: 'authorized', name: 'User-authorized browser surfaces' };
  }
  if (/\/$/u.test(new URL(page.url).pathname) && page.source === 'homepage') {
    return { id: 'home', name: 'Homepage and main navigation' };
  }
  if (/search|query|keyword|q=/u.test(haystack)) {
    return { id: 'search', name: 'Search and discovery pages' };
  }
  if (/product|catalog|shop|item|detail/u.test(haystack)) {
    return { id: 'products', name: 'Product or item pages' };
  }
  if (/news|article|story|channel|feed|rain|omn/iu.test(haystack)) {
    return { id: 'content', name: 'Articles, feeds, and content pages' };
  }
  if (/contact|support|help|message/u.test(haystack)) {
    return { id: 'contact', name: 'Contact and support pages' };
  }
  if (/login|signin|account|register|signup/u.test(haystack)) {
    return { id: 'account', name: 'Login, registration, or account pages' };
  }
  if (/pay|checkout|cart|order|delete|upload/u.test(haystack)) {
    return { id: 'unsafe', name: 'Payment, upload, or mutation pages' };
  }
  return { id: 'general', name: 'General public pages' };
}

function addPageCandidate(pages, site, input, options = /** @type {any} */ ({})) {
  if (!input?.url) {
    return;
  }
  let normalizedUrl;
  try {
    normalizedUrl = normalizeUrl(input.url, site.rootUrl);
  } catch {
    return;
  }
  if (!isInternalUrl(normalizedUrl, site.allowedDomains)) {
    return;
  }
  if (options.robotsPolicy && !isUrlAllowedByRobots(normalizedUrl, options.robotsPolicy)) {
    options.robotsExcludedUrls?.push(normalizedUrl);
    return;
  }
  pages.push({
    url: normalizedUrl,
    title: firstWords(input.title),
    label: firstWords(input.label),
    source: input.source ?? 'link',
  });
}

function groupPages(pages) {
  const byUrl = new Map();
  for (const page of pages) {
    if (!byUrl.has(page.url)) {
      byUrl.set(page.url, page);
    }
  }
  const groups = new Map();
  for (const page of byUrl.values()) {
    const category = categoryForPage(page);
    const group = groups.get(category.id) ?? {
      id: category.id,
      name: category.name,
      count: 0,
      sampleUrls: [],
      sampleLabels: [],
    };
    group.count += 1;
    if (group.sampleUrls.length < 5) {
      group.sampleUrls.push(page.url);
    }
    if (page.title || page.label) {
      group.sampleLabels.push(page.title || page.label);
      group.sampleLabels = uniqueSortedStrings(group.sampleLabels).slice(0, 5);
    }
    groups.set(category.id, group);
  }
  return [...groups.values()].sort((left, right) => {
    if (left.id === 'home') return -1;
    if (right.id === 'home') return 1;
    return left.name.localeCompare(right.name, 'en');
  });
}

function inspectForms(forms = /** @type {any[]} */ ([])) {
  return forms.map((form) => {
    const haystack = `${form.label ?? ''} ${form.action ?? ''} ${form.textSummary ?? ''}`.toLowerCase();
    const method = String(form.method ?? 'GET').toUpperCase();
    const unsafeReason = /login|signin/u.test(haystack)
      ? 'login'
      : /register|signup/u.test(haystack)
        ? 'registration'
        : /comment/u.test(haystack)
          ? 'comment'
          : /contact|support|message/u.test(haystack)
            ? 'contact'
            : /payment|checkout|purchase|order|billing/u.test(haystack)
              ? 'payment'
              : /delete|remove|destroy/u.test(haystack)
                ? 'destructive'
                : /upload|file/u.test(haystack)
                  ? 'upload'
                  : method === 'GET' && /search|query|keyword|q\b/u.test(haystack)
                    ? null
                    : method === 'GET'
                      ? null
                      : 'state_changing';
    return {
      label: firstWords(form.label || form.textSummary || form.action || 'form'),
      method,
      action: form.action ? normalizeUrl(form.action) : null,
      inputCount: Array.isArray(form.inputs) ? form.inputs.length : 0,
      unsafeReason,
    };
  });
}

function recommendedCapabilitiesFor({ pageGroups, forms }) {
  const groups = new Set(pageGroups.map((group) => group.id));
  const capabilities = /** @type {any[]} */ ([]);
  const add = (id, name, reason, safety = 'read_only', recommended = true) => {
    capabilities.push({ id, name, reason, safety, recommended });
  };

  if (groups.has('home')) {
    add('view-homepage', 'View public homepage', 'The site entry page is available and safe to inspect.');
  }
  if (groups.has('content')) {
    add('browse-content', 'Browse public content pages', 'Article, channel, feed, or story pages were discovered.');
  }
  if (groups.has('products')) {
    add('browse-products', 'Browse product or item pages', 'Product-like list or detail pages were discovered.');
  }
  if (groups.has('search') || forms.some((form) => form.method === 'GET' && !form.unsafeReason)) {
    add('search-site', 'Search with public GET forms', 'A read-only search or query pattern was discovered.');
  }
  if (groups.has('contact') || forms.some((form) => form.unsafeReason === 'contact')) {
    add('draft-contact', 'Prepare contact drafts only', 'Contact-like forms are treated as dry-run/confirmation-only.', 'requires_confirmation', false);
  }
  if (groups.has('account') || forms.some((form) => ['login', 'registration'].includes(form.unsafeReason))) {
    add('account-pages-disabled', 'Recognize account surfaces without using them', 'Login and registration surfaces stay disabled by default.', 'requires_confirmation', false);
  }
  if (groups.has('authorized')) {
    add('use-authorized-adapter', 'Use user-authorized known-site adapter', 'A user-controlled browser surface is available for bounded read-only capabilities.');
  }
  if (groups.has('unsafe') || forms.some((form) => ['payment', 'destructive', 'upload', 'state_changing'].includes(form.unsafeReason))) {
    add('unsafe-actions-disabled', 'Keep risky actions disabled', 'Payment, upload, deletion, checkout, and account mutation are not auto-executed.', 'destructive', false);
  }
  if (!capabilities.length) {
    add('view-public-pages', 'View public pages', 'Only a small public page set was visible during setup.');
  }
  return capabilities;
}

function defaultScopeForPlan(pageCount) {
  return {
    maxDepth: DEFAULT_BUILD_POLICY.maxDepth,
    maxPages: Math.max(DEFAULT_BUILD_POLICY.maxPages, pageCount + 5),
    maxSeeds: Math.max(DEFAULT_BUILD_POLICY.maxSeeds, pageCount * 2),
    maxSitemaps: DEFAULT_BUILD_POLICY.maxSitemaps,
    renderJs: false,
    captureNetwork: false,
  };
}

function uniquePageUrls(pages, predicate) {
  return uniqueSortedStrings(
    pages
      .filter(predicate)
      .map((page) => page.url)
      .filter(Boolean),
  );
}

function buildSetupEvidenceQuality({
  robotsAvailable,
  homepageAvailable,
  homepageRobotsBlocked = false,
  sitemapAvailable,
  sitemapUrlsDiscovered,
  sitemapUrlsSampled,
  robotsExcludedUrls = /** @type {any[]} */ ([]),
  knownSitePolicy = null,
  pages,
  userAuthorizedEvidence = null,
  authorizedSources = /** @type {any[]} */ ([]),
}) {
  const actualPageUrls = uniquePageUrls(pages, (page) => page.source !== 'synthetic_fallback');
  const syntheticPageUrls = uniquePageUrls(pages, (page) => page.source === 'synthetic_fallback');
  const userAuthorizedPageUrls = uniqueSortedStrings((userAuthorizedEvidence?.pages ?? [])
    .map((page) => page.normalizedUrl ?? page.url)
    .filter(Boolean));
  const authorizedSourceStructureEvidenceCount = (Array.isArray(authorizedSources) ? authorizedSources : [])
    .reduce((sum, source) => sum + (Array.isArray(source?.structurePages) ? source.structurePages.length : 0), 0);
  const robotsExcludedPageEvidenceUrls = uniqueSortedStrings(robotsExcludedUrls);
  const allPrimarySourcesUnavailable = !robotsAvailable && !homepageAvailable && !sitemapAvailable;
  const syntheticFallbackOnly = actualPageUrls.length === 0 && syntheticPageUrls.length > 0;
  const robotsExcludedAllCandidateEvidence = robotsAvailable
    && actualPageUrls.length === 0
    && robotsExcludedPageEvidenceUrls.length > 0;
  const policyPressure = knownPolicyCapabilityPressure(knownSitePolicy);
  return {
    schemaVersion: SETUP_ASSISTANT_SCHEMA_VERSION,
    sourceAvailability: {
      robots: robotsAvailable,
      homepage: homepageAvailable,
      sitemap: sitemapAvailable,
      userAuthorizedBrowser: userAuthorizedPageUrls.length > 0,
      authorizedSources: authorizedSourceStructureEvidenceCount > 0,
    },
    sourceStatus: {
      robots: robotsAvailable ? 'parsed' : 'unavailable',
      homepage: homepageAvailable ? 'parsed' : homepageRobotsBlocked ? 'robots_disallowed' : 'synthetic_fallback',
      sitemap: sitemapAvailable ? 'parsed' : 'unavailable',
      userAuthorizedBrowser: userAuthorizedPageUrls.length ? 'captured' : 'not_used',
      authorizedSources: authorizedSourceStructureEvidenceCount ? 'configured' : 'not_used',
    },
    actualPageEvidenceCount: actualPageUrls.length,
    userAuthorizedBrowserEvidenceCount: userAuthorizedPageUrls.length,
    authorizedSourceStructureEvidenceCount,
    syntheticPageEvidenceCount: syntheticPageUrls.length,
    actualPageEvidenceUrls: actualPageUrls.slice(0, 10),
    userAuthorizedBrowserEvidenceUrls: userAuthorizedPageUrls.slice(0, 10),
    syntheticFallbackUrls: syntheticPageUrls.slice(0, 10),
    robotsExcludedPageEvidenceCount: robotsExcludedPageEvidenceUrls.length,
    robotsExcludedPageEvidenceUrls: robotsExcludedPageEvidenceUrls.slice(0, 10),
    sitemapUrlsDiscovered,
    sitemapUrlsSampled,
    allPrimarySourcesUnavailable,
    syntheticFallbackOnly,
    robotsExcludedAllCandidateEvidence,
    knownPolicyCapabilityPressure: policyPressure,
  };
}

function buildSetupReadiness(evidenceQuality) {
  if (Number(evidenceQuality.userAuthorizedBrowserEvidenceCount ?? 0) > 0) {
    return {
      schemaVersion: SETUP_ASSISTANT_SCHEMA_VERSION,
      status: 'ready',
      buildable: true,
      reasonCode: 'setup-user-authorized-browser-evidence',
      reason: 'User-authorized browser evidence was captured for a bounded known-site adapter path.',
      guidance: [...USER_AUTHORIZED_SETUP_GUIDANCE],
      requiredEvidence: 'At least one public page source or one user-authorized bounded browser evidence summary.',
    };
  }
  if (Number(evidenceQuality.authorizedSourceStructureEvidenceCount ?? 0) > 0) {
    return {
      schemaVersion: SETUP_ASSISTANT_SCHEMA_VERSION,
      status: 'ready',
      buildable: true,
      reasonCode: 'setup-authorized-source-evidence',
      reason: 'Authorized sanitized structure source evidence was configured for this site.',
      guidance: [
        'Authorized source evidence is treated as a separate evidence layer, not as public crawl success.',
        'Only sanitized structure summaries are accepted; raw page content and session material are not persisted.',
      ],
      requiredEvidence: 'At least one public page source, one authorized sanitized structure source, or one user-authorized bounded browser evidence summary.',
    };
  }
  if (evidenceQuality.actualPageEvidenceCount > 0) {
    return {
      schemaVersion: SETUP_ASSISTANT_SCHEMA_VERSION,
      status: 'ready',
      buildable: true,
      reasonCode: null,
      reason: 'Public homepage or sitemap page evidence was available during setup.',
      requiredEvidence: 'At least one non-synthetic public page source from homepage or sitemap.',
    };
  }
  const knownPolicyRobotsDisallowed = evidenceQuality.robotsExcludedAllCandidateEvidence
    && evidenceQuality.knownPolicyCapabilityPressure?.hasPolicyCapabilities === true;
  const reasonCode = evidenceQuality.allPrimarySourcesUnavailable
    ? 'setup-primary-sources-unavailable'
    : knownPolicyRobotsDisallowed
      ? 'setup-known-policy-robots-disallowed'
      : evidenceQuality.robotsExcludedAllCandidateEvidence
      ? 'setup-robots-disallowed'
      : evidenceQuality.syntheticFallbackOnly
        ? 'setup-synthetic-fallback-only'
        : 'setup-no-page-evidence';
  const reason = evidenceQuality.allPrimarySourcesUnavailable
    ? 'robots.txt, homepage, and sitemap were unavailable during setup.'
    : knownPolicyRobotsDisallowed
      ? 'Known site policy advertises social/download/query capabilities, but robots.txt disallowed all setup page evidence.'
      : evidenceQuality.robotsExcludedAllCandidateEvidence
      ? 'robots.txt disallowed all setup page evidence.'
      : evidenceQuality.syntheticFallbackOnly
        ? 'Setup found only a synthetic fallback URL and no public page evidence.'
        : 'Setup did not find public page evidence that is sufficient for a build.';
  const guidance = reasonCode === 'setup-robots-disallowed' || reasonCode === 'setup-known-policy-robots-disallowed'
    ? [...ROBOTS_DISALLOWED_SETUP_GUIDANCE]
    : [];
  return {
    schemaVersion: SETUP_ASSISTANT_SCHEMA_VERSION,
    status: 'not_ready',
    buildable: false,
    reasonCode,
    reason,
    guidance,
    knownPolicy: evidenceQuality.knownPolicyCapabilityPressure ? {
      siteKey: evidenceQuality.knownPolicyCapabilityPressure.siteKey,
      adapterId: evidenceQuality.knownPolicyCapabilityPressure.adapterId,
      sources: clone(evidenceQuality.knownPolicyCapabilityPressure.sources ?? []),
      hasPolicyCapabilities: evidenceQuality.knownPolicyCapabilityPressure.hasPolicyCapabilities,
    } : null,
    requiredEvidence: 'At least one non-synthetic public page source from homepage or sitemap.',
  };
}

function applyBuildReadinessToCapabilities(capabilities, buildReadiness) {
  if (buildReadiness.buildable) {
    return capabilities;
  }
  return capabilities.map((capability) => ({
    ...capability,
    recommended: false,
    disabledReason: buildReadiness.reasonCode,
  }));
}

function browserBridgeRouteCaptured(result = /** @type {any} */ ({})) {
  return ['captured', 'captured_with_warning'].includes(String(result?.status ?? '').trim())
    && result?.captured !== false;
}

function browserRoutePartialCoverage(authStateReport = /** @type {any} */ ({})) {
  const bridge = authStateReport?.browserBridge ?? {};
  const routeResults = Array.isArray(bridge.routeResults) ? bridge.routeResults : [];
  const capturedRouteCount = Math.max(0, Number(bridge.capturedRouteCount ?? 0) || 0);
  const routeCount = Math.max(0, Number(bridge.routeCount ?? routeResults.length) || 0);
  const missingRouteCount = Math.max(0, Number(bridge.missingRouteCount ?? Math.max(0, routeCount - capturedRouteCount)) || 0);
  if (authStateReport?.authMethod !== 'browser' || capturedRouteCount <= 0 || missingRouteCount <= 0) {
    return null;
  }
  return {
    schemaVersion: SETUP_ASSISTANT_SCHEMA_VERSION,
    reasonCode: 'browser-auth-route-coverage-partial',
    routeCount,
    capturedRouteCount,
    missingRouteCount,
    missingRoutes: routeResults
      .filter((result) => !browserBridgeRouteCaptured(result))
      .map((result) => ({
        routeId: result?.routeId ?? null,
        targetRoute: result?.targetRoute ?? null,
        sourceLayer: result?.sourceLayer === 'authenticated_overlay' ? 'authenticated_overlay' : 'authenticated',
        status: result?.status ?? 'timeout',
        reasonCode: result?.reasonCode ?? result?.status ?? 'browser-auth-route-not-captured',
        initialStatus: result?.initialStatus ?? result?.status ?? 'timeout',
        finalStatus: result?.finalStatus ?? result?.status ?? 'timeout',
        finalReasonCode: result?.finalReasonCode ?? result?.reasonCode ?? result?.status ?? 'browser-auth-route-not-captured',
        retryAttemptCount: Math.max(0, Number(result?.retryAttemptCount ?? 0) || 0),
        retryOutcome: result?.retryOutcome ?? 'not_attempted',
        capabilityGenerated: false,
      })),
  };
}

function isSetupPlanBuildable(setupPlan) {
  return setupPlan?.buildReadiness?.buildable !== false;
}


export async function generateSetupPlan(inputUrl, options = /** @type {any} */ ({})) {
  const paths = buildSetupAssistantPaths(inputUrl, options);
  await ensureDir(paths.siteArtifactDir);
  await ensureDir(paths.siteBuildsDir);
  await ensureDir(paths.artifactDir);
  await ensureDir(paths.setupDir);
  const policy = mergeBuildPolicy(options);
  const source = createBuildSource(inputUrl, {
    ...options,
    fetchDelayMs: policy.fetchDelayMs,
    fetchTimeoutMs: policy.fetchTimeoutMs,
  });
  const warnings = /** @type {any[]} */ ([]);
  const knownSitePolicy = await readKnownSitePolicy(paths);
  if (knownSitePolicy) {
    warnings.push(`known site policy loaded for ${knownSitePolicy.siteKey ?? knownSitePolicy.host}; user choices cannot bypass adapter or evidence constraints.`);
  }
  const sourceDiagnostics = /** @type {any[]} */ ([]);
  const pages = /** @type {any[]} */ ([]);
  const forms = /** @type {any[]} */ ([]);
  const sitemapUrls = new Set();
  const robotsExcludedUrls = /** @type {any[]} */ ([]);
  let sitemapUrlsDiscovered = 0;
  let sitemapUrlsSampled = 0;
  let robotsPolicy = null;
  let robots = {
    status: 'unavailable',
    sitemaps: [],
    disallowPaths: [],
    excludedUrls: [],
  };

  const robotsUrl = new URL('/robots.txt', paths.site.rootUrl).toString();
  const robotsSource = await safeRead(source, robotsUrl, warnings, 'robots.txt');
  recordSourceDiagnostic(sourceDiagnostics, 'robots.txt', robotsSource);
  if (robotsSource?.body) {
    robotsPolicy = parseRobotsPolicy(robotsSource.body, paths.site.rootUrl);
    robots = {
      status: 'parsed',
      sitemaps: robotsPolicy.sitemaps,
      disallowPaths: robotsPolicy.disallowPaths,
      excludedUrls: [],
    };
    for (const sitemapUrl of robotsPolicy.sitemaps) {
      sitemapUrls.add(sitemapUrl);
    }
  }
  sitemapUrls.add(new URL('/sitemap.xml', paths.site.rootUrl).toString());

  const addSetupPageCandidate = (input) => addPageCandidate(pages, paths.site, input, {
    robotsPolicy,
    robotsExcludedUrls,
  });
  const normalizedInputUrl = normalizeUrl(inputUrl, paths.site.rootUrl);
  const inputIsRoot = normalizedInputUrl === normalizeUrl(paths.site.rootUrl, paths.site.rootUrl);
  const inputAllowedByRobots = !robotsPolicy || isUrlAllowedByRobots(normalizedInputUrl, robotsPolicy);
  let inputPageSource = null;
  if (!inputIsRoot) {
    if (inputAllowedByRobots) {
      inputPageSource = await safeRead(source, normalizedInputUrl, warnings, 'input page');
      recordSourceDiagnostic(sourceDiagnostics, 'input page', inputPageSource);
    } else {
      robotsExcludedUrls.push(normalizedInputUrl);
      warnings.push('robots excluded setup input page evidence before setup recommendations.');
    }
    if (inputPageSource?.body) {
      const inputPage = parseHtmlDocument(inputPageSource.body, normalizedInputUrl);
      addSetupPageCandidate({
        url: normalizedInputUrl,
        title: inputPage.title || new URL(normalizedInputUrl).hostname,
        source: 'input',
      });
      for (const link of inputPage.links.slice(0, 50)) {
        addSetupPageCandidate({
          url: link.href,
          label: link.label,
          source: 'input_link',
        });
      }
      forms.push(...inspectForms(inputPage.forms));
    }
  }
  const homepageAllowedByRobots = !robotsPolicy || isUrlAllowedByRobots(paths.site.rootUrl, robotsPolicy);
  let homepageSource = null;
  if (homepageAllowedByRobots) {
    homepageSource = await safeRead(source, paths.site.rootUrl, warnings, 'homepage');
    recordSourceDiagnostic(sourceDiagnostics, 'homepage', homepageSource);
  } else {
    robotsExcludedUrls.push(normalizeUrl(paths.site.rootUrl, paths.site.rootUrl));
    warnings.push('robots excluded setup homepage evidence before setup recommendations.');
  }
  if (homepageSource?.body) {
    const homepage = parseHtmlDocument(homepageSource.body, paths.site.rootUrl);
    addSetupPageCandidate({
      url: paths.site.rootUrl,
      title: homepage.title || new URL(paths.site.rootUrl).hostname,
      source: 'homepage',
    });
    for (const link of homepage.links.slice(0, 50)) {
      addSetupPageCandidate({
        url: link.href,
        label: link.label,
        source: 'homepage_link',
      });
    }
    forms.push(...inspectForms(homepage.forms));
  } else if (homepageAllowedByRobots) {
    addSetupPageCandidate({
      url: paths.site.rootUrl,
      title: new URL(paths.site.rootUrl).hostname,
      source: 'synthetic_fallback',
    });
  }

  for (const sitemapUrl of [...sitemapUrls].sort((left, right) => left.localeCompare(right, 'en')).slice(0, 3)) {
    const sitemap = await safeRead(source, sitemapUrl, warnings, `sitemap ${sitemapUrl}`);
    recordSourceDiagnostic(sourceDiagnostics, `sitemap ${sitemapUrl}`, sitemap);
    if (!sitemap?.body) {
      continue;
    }
    sitemapUrlsSampled += 1;
    const parsedSitemapUrls = parseSitemapUrls(sitemap.body, paths.site.rootUrl);
    sitemapUrlsDiscovered += parsedSitemapUrls.length;
    for (const loc of parsedSitemapUrls.slice(0, 50)) {
      addSetupPageCandidate({
        url: loc,
        source: 'sitemap',
      });
    }
  }
  robots = {
    ...robots,
    excludedUrls: uniqueSortedStrings(robotsExcludedUrls),
  };

  const pageGroups = groupPages(pages);
  const evidenceQuality = buildSetupEvidenceQuality({
    robotsAvailable: Boolean(robotsSource?.body),
    homepageAvailable: Boolean(homepageSource?.body),
    homepageRobotsBlocked: !homepageAllowedByRobots,
    sitemapAvailable: sitemapUrlsSampled > 0,
    sitemapUrlsDiscovered,
    sitemapUrlsSampled,
    robotsExcludedUrls,
    knownSitePolicy,
    pages,
    authorizedSources: options.localBuildConfig?.authorizedSources ?? [],
  });
  const buildReadiness = buildSetupReadiness(evidenceQuality);
  const recommendedCapabilities = applyBuildReadinessToCapabilities(
    recommendedCapabilitiesFor({ pageGroups, forms }),
    buildReadiness,
  );
  const blockedSurfaces = uniqueSortedStrings([
    ...pageGroups.filter((group) => ['account', 'unsafe'].includes(group.id)).map((group) => group.name),
    ...forms.filter((form) => form.unsafeReason).map((form) => form.unsafeReason),
  ]);
  const setupPlan = {
    schemaVersion: SETUP_ASSISTANT_SCHEMA_VERSION,
    artifactFamily: 'siteforge-setup-plan',
    buildSchemaVersion: BUILD_SCHEMA_VERSION,
    buildId: paths.buildId,
    generatedAt: paths.generatedAt,
    site: {
      id: paths.site.id,
      rootUrl: paths.site.rootUrl,
      normalizedUrl: paths.site.normalizedUrl,
      allowedDomains: paths.site.allowedDomains,
    },
    summary: {
      pageGroups: pageGroups.length,
      visiblePageSamples: pageGroups.reduce((sum, group) => sum + group.sampleUrls.length, 0),
      recommendedCapabilities: recommendedCapabilities.filter((capability) => capability.recommended).length,
      unsafeCapabilitiesDisabled: Object.values(UNSAFE_ACTION_DEFAULTS).filter((value) => value === false).length,
      buildable: buildReadiness.buildable,
      readinessStatus: buildReadiness.status,
    },
    robots,
    knownSitePolicy,
    localBuildConfig: options.localBuildConfig ? localBuildConfigForSetup(paths.site, options.localBuildConfig) : null,
    sourceDiagnostics,
    evidenceQuality,
    buildReadiness,
    pageGroups,
    recommendedScope: defaultScopeForPlan(pages.length),
    recommendedCapabilities,
    unsafeActionDefaults: clone(UNSAFE_ACTION_DEFAULTS),
    skillContract: {
      will: [...SKILL_WILL],
      willNot: [...SKILL_WILL_NOT],
    },
    blockedSurfaces,
    warnings,
  };
  setupPlan.authStateReport = createPublicOnlyAuthStateReport({
    site: setupPlan.site,
  });
  setupPlan.crawlContract = createCrawlContract({
    site: setupPlan.site,
    authStateReport: setupPlan.authStateReport,
    coverageTargets: coverageTargetsFromSetupPlan(setupPlan),
  });
  setupPlan.collectionReview = buildCollectionReviewModel({ setupPlan });
  await ensureDir(paths.artifactDir);
  await ensureDir(path.dirname(paths.setupPlanPath));
  await writeJsonFile(paths.setupPlanPath, setupPlan);
  return { paths, setupPlan, robotsPolicy };
}

async function applyCrawlContractChoice({ inputUrl, paths, setupPlan, options, robotsPolicy = null }) {
  const authMode = options.authMode === 'cookie' || options.authMode === 'browser' ? options.authMode : 'none';
  options.authMode = authMode;
  const authOptions = {
    ...options,
  };
  delete authOptions.authRuntime;
  delete authOptions.authenticatedStructureSummary;
  const authStateReport = await runDefaultBrowserAuthStateCheck({
    inputUrl,
    site: setupPlan.site,
    options: authOptions,
    robotsPolicy,
  });
  const nextPlan = {
    ...setupPlan,
    authStateReport,
  };
  if (authMode === 'cookie' && options.strictCookieAuth === true && !canRunAuthenticatedLayer(authStateReport)) {
    const status = authStateReport?.authVerificationStatus ?? 'auth_check_failed';
    const signals = uniqueSortedStrings([status, ...(authStateReport?.blockingSignals ?? [])]);
    nextPlan.buildReadiness = {
      schemaVersion: SETUP_ASSISTANT_SCHEMA_VERSION,
      status: 'not_ready',
      buildable: false,
      reasonCode: status,
      reason: 'Configured cookie authentication did not verify, so SiteForge stopped instead of falling back to a public-only build.',
      guidance: signals.length
        ? signals.map((signal) => `Cookie auth check signal: ${signal}.`)
        : ['Provide a current same-site Cookie value or remove the site cookie from siteforge.local.json.'],
      requiredEvidence: 'A configured Cookie must verify against the same-site auth check URL before build can continue.',
    };
    nextPlan.summary = {
      ...nextPlan.summary,
      buildable: false,
      readinessStatus: 'not_ready',
    };
    nextPlan.recommendedCapabilities = applyBuildReadinessToCapabilities(
      nextPlan.recommendedCapabilities ?? [],
      nextPlan.buildReadiness,
    );
  }
  if (authMode === 'browser' && options.strictBrowserAuth === true && !canRunAuthenticatedLayer(authStateReport)) {
    const status = authStateReport?.authVerificationStatus ?? 'browser_check_failed';
    const signals = uniqueSortedStrings([status, ...(authStateReport?.blockingSignals ?? [])]);
    nextPlan.buildReadiness = {
      schemaVersion: SETUP_ASSISTANT_SCHEMA_VERSION,
      status: 'not_ready',
      buildable: false,
      reasonCode: status,
      reason: 'Configured default-browser authentication bridge did not verify, so SiteForge stopped instead of falling back to a public-only build.',
      guidance: signals.length
        ? signals.map((signal) => `Browser auth bridge signal: ${signal}.`)
        : ['Enable the local browser bridge or remove browser auth from siteforge.local.json.'],
      requiredEvidence: 'A default-browser bridge must return sanitized same-site structure evidence before build can continue.',
    };
    nextPlan.summary = {
      ...nextPlan.summary,
      buildable: false,
      readinessStatus: 'not_ready',
    };
    nextPlan.recommendedCapabilities = applyBuildReadinessToCapabilities(
      nextPlan.recommendedCapabilities ?? [],
      nextPlan.buildReadiness,
    );
  }
  if (
    authMode === 'browser'
    && options.strictBrowserAuth === true
    && canRunAuthenticatedLayer(authStateReport)
    && Number(authStateReport?.browserBridge?.missingRouteCount ?? 0) > 0
  ) {
    const partialCoverage = browserRoutePartialCoverage(authStateReport);
    nextPlan.partialCoverage = partialCoverage;
    nextPlan.buildReadiness = nextPlan.buildReadiness ? {
      ...nextPlan.buildReadiness,
      partialCoverage,
    } : {
      schemaVersion: SETUP_ASSISTANT_SCHEMA_VERSION,
      status: 'ready',
      buildable: true,
      reasonCode: null,
      reason: null,
      guidance: [],
      partialCoverage,
    };
    nextPlan.summary = {
      ...nextPlan.summary,
      buildable: nextPlan.buildReadiness.buildable !== false,
      readinessStatus: nextPlan.buildReadiness.status ?? 'ready',
      partialCoverage,
    };
    nextPlan.warnings = uniqueSortedStrings([
      ...(nextPlan.warnings ?? []),
      'browser-auth-route-coverage-partial',
      ...((partialCoverage?.missingRoutes ?? [])
        .map((route) => route.reasonCode)
        .filter(Boolean)),
    ]);
  }
  nextPlan.crawlContract = createCrawlContract({
    site: nextPlan.site,
    authStateReport,
    coverageTargets: coverageTargetsFromSetupPlan(nextPlan),
  });
  nextPlan.collectionReview = buildCollectionReviewModel({ setupPlan: nextPlan });
  await ensureDir(paths.artifactDir);
  await ensureDir(path.dirname(paths.setupPlanPath));
  await writeJsonFile(paths.authStateReportPath, authStateReport);
  await writeJsonFile(paths.setupPlanPath, nextPlan);
  return nextPlan;
}

async function collectSelectedCapabilityProofs(setupPlan, userChoices, options = /** @type {any} */ ({})) {
  void userChoices;
  void options;
  return setupPlan;
}

async function collectMissingCapabilityProofs(setupPlan, options = /** @type {any} */ ({})) {
  void options;
  return setupPlan;
}

function applyUserAuthorizedEvidenceToSetupPlan(setupPlan, userAuthorizedEvidence, paths) {
  const authorizedPageInputs = pageInputsFromAuthorizedEvidence(userAuthorizedEvidence);
  const pageGroups = groupPages(authorizedPageInputs);
  const evidenceQuality = buildSetupEvidenceQuality({
    robotsAvailable: setupPlan.evidenceQuality?.sourceAvailability?.robots === true,
    homepageAvailable: setupPlan.evidenceQuality?.sourceAvailability?.homepage === true,
    homepageRobotsBlocked: setupPlan.evidenceQuality?.sourceStatus?.homepage === 'robots_disallowed',
    sitemapAvailable: setupPlan.evidenceQuality?.sourceAvailability?.sitemap === true,
    sitemapUrlsDiscovered: setupPlan.evidenceQuality?.sitemapUrlsDiscovered ?? 0,
    sitemapUrlsSampled: setupPlan.evidenceQuality?.sitemapUrlsSampled ?? 0,
    robotsExcludedUrls: setupPlan.robots?.excludedUrls ?? [],
    knownSitePolicy: setupPlan.knownSitePolicy,
    pages: authorizedPageInputs,
    userAuthorizedEvidence,
    authorizedSources: setupPlan.localBuildConfig?.authorizedSources ?? [],
  });
  const buildReadiness = buildSetupReadiness(evidenceQuality);
  const policyCapabilities = knownPolicyRecommendedCapabilities(setupPlan.knownSitePolicy, {
    userAuthorized: true,
    userAuthorizedEvidence,
  });
  const recommendedCapabilities = [
    ...recommendedCapabilitiesFor({ pageGroups, forms: [] }),
    ...policyCapabilities,
  ];
  const nextPlan = {
    ...setupPlan,
    userAuthorizedEvidence,
    authStateReport: setupPlan.authStateReport ?? createPublicOnlyAuthStateReport({
      site: setupPlan.site,
      reasonCode: 'legacy-user-authorized-evidence-not-auth-verification',
    }),
    summary: {
      ...setupPlan.summary,
      pageGroups: pageGroups.length,
      visiblePageSamples: pageGroups.reduce((sum, group) => sum + group.sampleUrls.length, 0),
      recommendedCapabilities: recommendedCapabilities.filter((capability) => capability.recommended).length,
      buildable: buildReadiness.buildable,
      readinessStatus: buildReadiness.status,
    },
    evidenceQuality,
    buildReadiness,
    pageGroups,
    recommendedScope: {
      ...setupPlan.recommendedScope,
      renderJs: true,
      captureNetwork: true,
    },
    recommendedCapabilities,
    skillContract: {
      will: [
        ...setupPlan.skillContract.will,
        'Use a bounded user-authorized browser evidence summary for known-site read-only capabilities.',
      ],
      willNot: setupPlan.skillContract.willNot,
    },
    warnings: uniqueSortedStrings([
      ...(setupPlan.warnings ?? []),
      'user-authorized browser evidence captured; raw session material was not persisted.',
    ]),
    setupAuthorization: {
      schemaVersion: SETUP_ASSISTANT_SCHEMA_VERSION,
      mode: 'user-authorized-browser',
      evidencePath: path.relative(paths.cwd, paths.setupPlanPath).replace(/\\/gu, '/'),
      sessionMaterialPersisted: false,
      browserProfilePersisted: false,
      rawHtmlPersisted: false,
    },
  };
  nextPlan.crawlContract = createCrawlContract({
    site: nextPlan.site,
    authStateReport: nextPlan.authStateReport,
    coverageTargets: coverageTargetsFromSetupPlan(nextPlan),
  });
  nextPlan.collectionReview = buildCollectionReviewModel({
    setupPlan: nextPlan,
    userAuthorizedEvidence,
    knownSitePolicy: nextPlan.knownSitePolicy,
  });
  return nextPlan;
}

function applyHintToChoices(hint, choices) {
  const normalized = compactText(hint).toLowerCase();
  const next = clone(choices);
  if (!normalized) {
    return next;
  }
  const requested = requestedCapabilityFromHint(hint);
  const safeHint = sanitizedSetupHint(hint, requested);
  next.hints = safeHint ? [safeHint] : [];
  if (/\b(?:small|quick|light|shallow)\b/u.test(normalized)) {
    next.scope.maxDepth = 1;
    next.scope.maxPages = Math.min(next.scope.maxPages, 20);
    next.scope.maxSeeds = Math.min(next.scope.maxSeeds, 50);
  }
  if (/\b(?:broad|more|full|deep)\b/u.test(normalized)) {
    next.scope.maxDepth = Math.max(next.scope.maxDepth, DEFAULT_BUILD_POLICY.maxDepth);
    next.scope.maxPages = Math.max(next.scope.maxPages, DEFAULT_BUILD_POLICY.maxPages);
    next.scope.maxSeeds = Math.max(next.scope.maxSeeds, DEFAULT_BUILD_POLICY.maxSeeds);
  }
  for (const capability of next.availableCapabilities) {
    const capabilityText = `${capability.id} ${capability.name}`.toLowerCase();
    if (requested?.supported === true && normalizeCapabilityId(capability.id) === normalizeCapabilityId(requested.id)) {
      capability.selected = true;
      capability.requestedByHint = true;
    }
    if (/search/u.test(normalized) && /search/u.test(capabilityText)) {
      capability.selected = true;
    }
    if (/contact|support|message/u.test(normalized) && /contact|support|draft/u.test(capabilityText)) {
      capability.selected = true;
    }
    if (/product|shop|catalog/u.test(normalized) && /product|item/u.test(capabilityText)) {
      capability.selected = true;
    }
    if (/news|article|content|feed/u.test(normalized) && /content|article|feed/u.test(capabilityText)) {
      capability.selected = true;
    }
  }
  return next;
}

function defaultChoicesFromPlan(setupPlan, mode = 'accept-recommended') {
  const availableCapabilities = setupPlan.recommendedCapabilities.map((capability) => ({
    ...capability,
    selected: capability.recommended === true,
  }));
  return applySetupConfigurationToChoices({
    schemaVersion: SETUP_ASSISTANT_SCHEMA_VERSION,
    artifactFamily: 'siteforge-user-choices',
    buildId: setupPlan.buildId,
    siteId: setupPlan.site.id,
    mode,
    acceptedDefaultRecommendation: true,
    scope: clone(setupPlan.recommendedScope),
    setupConfiguration: defaultSetupConfiguration(),
    availableCapabilities,
    selectedCapabilityIds: availableCapabilities.filter((capability) => capability.selected).map((capability) => capability.id),
    disabledUnsafeActions: clone(setupPlan.unsafeActionDefaults),
    hints: [],
    evidenceValidationBoundary: 'Choices guide scope only; verification still requires evidence-backed capabilities.',
  });
}

function applyBuildModeChoiceOverrides(userChoices, options = /** @type {any} */ ({})) {
  const next = clone(userChoices);
  next.scope = {
    ...(next.scope ?? {}),
  };
  for (const key of ['maxDepth', 'maxPages', 'maxSeeds', 'maxSitemaps']) {
    if (options[key] !== undefined) {
      next.scope[key] = options[key];
    }
  }
  if (options.deep === true) {
    next.scope.maxDepth = Math.max(Number(next.scope.maxDepth ?? 0) || 0, 3);
    next.scope.maxPages = Math.max(Number(next.scope.maxPages ?? 0) || 0, 100);
    next.scope.maxSeeds = Math.max(Number(next.scope.maxSeeds ?? 0) || 0, 200);
    next.scope.renderJs = options.renderJs ?? true;
  } else if (options.renderJs !== undefined) {
    next.scope.renderJs = options.renderJs;
  }
  if (options.captureNetwork !== undefined || options.network === true) {
    next.scope.captureNetwork = options.captureNetwork === true || options.network === true;
  }
  next.mode = options.manual === true ? next.mode : 'auto';
  return applySetupConfigurationToChoices(next);
}

function createCapabilityHints(setupPlan, userChoices) {
  const selected = new Set(userChoices.selectedCapabilityIds);
  const userIntentCoverage = evaluateUserIntentCoverage(userChoices.hints ?? [], userChoices.availableCapabilities ?? []);
  return {
    schemaVersion: SETUP_ASSISTANT_SCHEMA_VERSION,
    artifactFamily: 'siteforge-capability-hints',
    buildId: setupPlan.buildId,
    siteId: setupPlan.site.id,
    recommendedCapabilities: setupPlan.recommendedCapabilities.map((capability) => ({
      id: capability.id,
      name: capability.name,
      safety: capability.safety,
      selected: selected.has(capability.id),
      reason: capability.reason,
      status: capability.status ?? (capability.recommended ? 'recommended' : 'candidate'),
      recommended: capability.recommended === true,
      evidenceRequirement: capability.evidenceRequirement ?? null,
      disabledReason: capability.disabledReason ?? null,
      requestedByHint: capability.requestedByHint === true,
    })),
    disabledUnsafeActions: clone(userChoices.disabledUnsafeActions),
    blockedSurfaces: setupPlan.blockedSurfaces,
    collectionReview: clone(setupPlan.collectionReview ?? buildCollectionReviewModel({ setupPlan })),
    userIntentCoverage,
    validationBoundary: userChoices.evidenceValidationBoundary,
  };
}

function knownPolicyAuthRouteTargets(knownSitePolicy = null) {
  if (!knownSitePolicy) {
    return [];
  }
  const supported = new Set(knownSitePolicy.supportedIntents ?? []);
  const supportsSocialContent = policySupportsCapabilityFamily(knownSitePolicy, 'query-social-content');
  const supportsSocialRelations = policySupportsCapabilityFamily(knownSitePolicy, 'query-social-relations');
  const followingRoutePath = knownPolicyFollowingRoutePath(knownSitePolicy);
  const routes = new Set();
  if (supportsSocialContent) {
    routes.add('/home');
  }
  if (supportsSocialContent) {
    routes.add(followingRoutePath);
  }
  if (supported.has('search-posts') || supported.has('search-content')) {
    routes.add(knownPolicySearchRoutePath(knownSitePolicy));
  }
  if (supportsSocialRelations) {
    routes.add(followingRoutePath);
  }
  if (supported.has('list-notifications')) {
    routes.add('/notifications');
  }
  if (supported.has('list-bookmarks')) {
    routes.add('/i/bookmarks');
  }
  if (supported.has('list-lists')) {
    routes.add('/i/lists');
  }
  if (supported.has('list-direct-messages')) {
    routes.add('/messages');
  }
  return [...routes].sort((left, right) => left.localeCompare(right, 'en'));
}

const KNOWN_POLICY_LOGIN_CAPABILITY_IDS = new Set([
  'list-followed-users',
  'list-followed-updates',
  'recommended-timeline-posts',
  'list-recommended-timeline-posts',
  'list-notifications',
  'notifications',
  'list-bookmarks',
  'bookmarks',
  'list-lists',
  'lists',
  'list-direct-messages',
  'direct-messages',
  'messages',
]);

function knownPolicyRequiresLoginCapabilityIds(knownSitePolicy = null) {
  if (!knownSitePolicy) {
    return [];
  }
  return uniqueSortedStrings(knownPolicyRecommendedCapabilities(knownSitePolicy, { userAuthorized: true })
    .map((capability) => normalizeCapabilityId(capability.id ?? capability.name))
    .filter((id) => KNOWN_POLICY_LOGIN_CAPABILITY_IDS.has(id)));
}

function normalizeConfiguredRouteTargets(site, values = /** @type {any[]} */ ([])) {
  const targets = [];
  for (const value of Array.isArray(values) ? values : []) {
    const normalized = sanitizeRouteTargetForPersistence(value, site, { preserveRelative: false });
    if (normalized && isInternalUrl(normalized, site.allowedDomains)) {
      targets.push(normalized);
    } else {
      // Ignore malformed local route hints; they cannot become crawl seeds.
    }
  }
  return uniqueSortedStrings(targets);
}

function sanitizeAuthorizedSourcesForSetup(sources = /** @type {any[]} */ ([])) {
  const sanitizeLinks = (links = /** @type {any[]} */ ([])) => (Array.isArray(links) ? links : [])
    .slice(0, 160)
    .map((link, linkIndex) => {
      if (!link || typeof link !== 'object') {
        return null;
      }
      return {
        href: sanitizeEvidenceRef(link.href ?? link.url ?? link.path ?? null),
        label: sanitizeEvidenceRef(link.label ?? link.title ?? link.name ?? `authorized-link-${linkIndex + 1}`),
        selector: sanitizeEvidenceRef(link.selector ?? `authorized-link-${linkIndex + 1}`),
        semanticKind: sanitizeEvidenceRef(link.semanticKind ?? link.role ?? null),
        structureType: sanitizeEvidenceRef(link.structureType ?? link.structure_type ?? null),
        routeTemplate: sanitizeEvidenceRef(link.routeTemplate ?? link.routePattern ?? null),
      };
    })
    .filter((link) => link && (link.href || link.routeTemplate));
  return (Array.isArray(sources) ? sources : [])
    .map((source, index) => {
      if (!source || typeof source !== 'object') {
        return null;
      }
      const structurePages = Array.isArray(source.structurePages)
        ? source.structurePages.slice(0, 80).map((page, pageIndex) => ({
          id: sanitizeEvidenceRef(page?.id ?? `authorized-page-${pageIndex + 1}`),
          url: sanitizeEvidenceRef(page?.url ?? null),
          title: sanitizeEvidenceRef(page?.title ?? null),
          pageType: sanitizeEvidenceRef(page?.pageType ?? 'authorized_source_summary'),
          routeTemplate: sanitizeEvidenceRef(page?.routeTemplate ?? null),
          visibleItemCount: Number.isFinite(Number(page?.visibleItemCount)) ? Math.max(0, Number(page.visibleItemCount)) : 0,
          listPresent: page?.listPresent === true,
          emptyStatePresent: page?.emptyStatePresent === true,
          routeTemplates: uniqueSortedStrings(Array.isArray(page?.routeTemplates) ? page.routeTemplates.map((item) => sanitizeEvidenceRef(item)).filter(Boolean) : []),
          links: sanitizeLinks(page?.links),
          structureItems: (Array.isArray(page?.structureItems) ? page.structureItems : []).slice(0, 120).map((item) => ({
            nodeType: sanitizeEvidenceRef(item?.nodeType ?? item?.type ?? 'component'),
            structureType: sanitizeEvidenceRef(item?.structureType ?? item?.kind ?? null),
            labelSummary: sanitizeEvidenceRef(item?.labelSummary ?? item?.label ?? null),
            visibleItemCount: Number.isFinite(Number(item?.visibleItemCount)) ? Math.max(0, Number(item.visibleItemCount)) : 0,
            listPresent: item?.listPresent === true,
            emptyStatePresent: item?.emptyStatePresent === true,
            routeTemplates: uniqueSortedStrings(Array.isArray(item?.routeTemplates) ? item.routeTemplates.map((route) => sanitizeEvidenceRef(route)).filter(Boolean) : []),
          })),
        }))
        : [];
      return {
        id: sanitizeEvidenceRef(source.id ?? `authorized-source-${index + 1}`),
        kind: sanitizeEvidenceRef(source.kind ?? source.type ?? 'authorized_source'),
        url: sanitizeEvidenceRef(source.url ?? null),
        accessBasis: sanitizeEvidenceRef(source.accessBasis ?? source.authorizationBasis ?? 'user_provided_contract'),
        permissionScope: sanitizeEvidenceRef(source.permissionScope ?? 'sanitized_summary_only'),
        allowedEvidence: uniqueSortedStrings(Array.isArray(source.allowedEvidence) ? source.allowedEvidence.map((item) => sanitizeEvidenceRef(item)).filter(Boolean) : []),
        structurePages,
        genericCrawlAllowed: false,
        promotionAllowed: false,
      };
    })
    .filter(Boolean);
}

function localBuildConfigForSetup(site, config = /** @type {any} */ ({})) {
  const build = config.build && typeof config.build === 'object' ? config.build : {};
  return {
    source: config.source === 'home' ? 'home' : config.source === 'cwd' ? 'cwd' : null,
    authMode: ['cookie', 'browser'].includes(config.authMode) ? config.authMode : null,
    authCheckUrl: config.authCheckUrl ? sanitizeEvidenceRef(config.authCheckUrl) : null,
    authRoutes: normalizeConfiguredRouteTargets(site, config.authRoutes),
    publicRevisitRoutes: normalizeConfiguredRouteTargets(site, config.publicRevisitRoutes),
    authorizedSources: sanitizeAuthorizedSourcesForSetup(config.authorizedSources),
    build: {
      deep: build.deep === true,
      renderJs: build.renderJs === true ? true : build.renderJs === false ? false : null,
      maxDepth: Number.isFinite(Number(build.maxDepth)) ? Number(build.maxDepth) : null,
      maxPages: Number.isFinite(Number(build.maxPages)) ? Number(build.maxPages) : null,
      maxSeeds: Number.isFinite(Number(build.maxSeeds)) ? Number(build.maxSeeds) : null,
      maxSitemaps: Number.isFinite(Number(build.maxSitemaps)) ? Number(build.maxSitemaps) : null,
    },
  };
}

function coverageTargetsFromSetupPlan(setupPlan = /** @type {any} */ ({})) {
  const knownPolicyPublicRoutes = (setupPlan.knownSitePolicy?.publicRouteTemplates ?? [])
    .filter((route) => route?.seedable === true && route.path)
    .map((route) => route.path);
  const publicRoutes = uniqueSortedStrings([
    setupPlan.site?.rootUrl,
    ...knownPolicyPublicRoutes,
    ...(setupPlan.pageGroups ?? []).flatMap((group) => group.sampleUrls ?? []),
  ].filter(Boolean));
  const localConfig = setupPlan.localBuildConfig ?? {};
  const verifiedRoutes = canRunAuthenticatedLayer(setupPlan.authStateReport)
    ? normalizeConfiguredRouteTargets(setupPlan.site, setupPlan.authStateReport?.verifiedRoutes ?? [])
      .filter((route) => !/\/api(?:\/|$)/iu.test(new URL(route).pathname))
    : [];
  const authRoutes = uniqueSortedStrings([
    ...knownPolicyAuthRouteTargets(setupPlan.knownSitePolicy),
    ...(localConfig.authRoutes ?? []),
    ...verifiedRoutes,
  ]);
  const requiresLoginCapabilities = knownPolicyRequiresLoginCapabilityIds(setupPlan.knownSitePolicy);
  const localRevisitRoutes = localConfig.publicRevisitRoutes ?? [];
  return {
    publicRoutes,
    authRoutes,
    publicRevisitRoutes: uniqueSortedStrings([
      ...localRevisitRoutes,
      ...publicRoutes.slice(0, 12),
    ]),
    candidateCapabilities: uniqueSortedStrings((setupPlan.recommendedCapabilities ?? [])
      .filter((capability) => capability.recommended !== true)
      .map((capability) => capability.id ?? capability.name)),
    requiresLoginCapabilities,
  };
}

function createBuildProfile(setupPlan, userChoices, capabilityHints, paths) {
  const selectedCapabilities = capabilityHints.recommendedCapabilities.filter((capability) => capability.selected);
  const buildable = setupPlan.buildReadiness?.buildable !== false;
  const homepageSource = (setupPlan.sourceDiagnostics ?? []).find((item) => item?.label === 'homepage')
    ?? (setupPlan.sourceDiagnostics ?? [])[0]
    ?? null;
  const profile = {
    schemaVersion: SETUP_ASSISTANT_SCHEMA_VERSION,
    artifactFamily: 'siteforge-build-profile',
    buildSchemaVersion: BUILD_SCHEMA_VERSION,
    site: clone(setupPlan.site),
    createdAt: paths.generatedAt,
    updatedAt: new Date().toISOString(),
    source: {
      type: 'live_website',
      requestedUrl: setupPlan.site?.inputUrl ?? setupPlan.site?.rootUrl ?? null,
      finalUrl: homepageSource?.finalUrl ?? homepageSource?.sourcePath ?? setupPlan.site?.rootUrl ?? null,
      fetchedAt: homepageSource?.fetchedAt ?? paths.generatedAt,
    },
    setupConfiguration: normalizeSetupConfiguration(userChoices.setupConfiguration),
    scope: clone(userChoices.scope),
    knownSitePolicy: clone(setupPlan.knownSitePolicy ?? null),
    localBuildConfig: clone(setupPlan.localBuildConfig ?? null),
    robots: clone(setupPlan.robots ?? null),
    sourceDiagnostics: clone(setupPlan.sourceDiagnostics ?? []),
    evidenceQuality: clone(setupPlan.evidenceQuality ?? null),
    buildReadiness: clone(setupPlan.buildReadiness ?? null),
    partialCoverage: clone(setupPlan.partialCoverage ?? setupPlan.summary?.partialCoverage ?? null),
    crawlContract: clone(setupPlan.crawlContract ?? createCrawlContract({
      site: setupPlan.site,
      coverageTargets: coverageTargetsFromSetupPlan(setupPlan),
    })),
    authStateReport: normalizeAuthStateReport(setupPlan.authStateReport ?? createPublicOnlyAuthStateReport({
      site: setupPlan.site,
      authMethod: 'none',
    }), {
      site: setupPlan.site,
    }),
    collectionReview: clone(setupPlan.collectionReview ?? buildCollectionReviewModel({ setupPlan })),
    profileUsability: {
      schemaVersion: SETUP_ASSISTANT_SCHEMA_VERSION,
      status: buildable ? 'usable' : 'unusable',
      buildable,
      reasonCode: setupPlan.buildReadiness?.reasonCode ?? null,
      reason: setupPlan.buildReadiness?.reason ?? null,
    },
    capabilityScope: {
      selectedCapabilities,
      disabledCapabilities: capabilityHints.recommendedCapabilities.filter((capability) => !capability.selected),
    },
    safety: {
      submitForms: false,
      allowDestructiveActions: false,
      allowPayment: false,
      allowAccountMutation: false,
      allowContactSubmit: false,
      unsafeActions: clone(userChoices.disabledUnsafeActions),
    },
    skillContract: clone(setupPlan.skillContract),
    userHints: [...(userChoices.hints ?? [])],
    userIntentCoverage: clone(capabilityHints.userIntentCoverage),
    setupRefs: {
      setupPlan: path.relative(paths.cwd, paths.setupPlanPath).replace(/\\/gu, '/'),
      userChoices: path.relative(paths.cwd, paths.userChoicesPath).replace(/\\/gu, '/'),
      capabilityHints: path.relative(paths.cwd, paths.capabilityHintsPath).replace(/\\/gu, '/'),
    },
    authStateReportRef: path.relative(paths.cwd, paths.authStateReportPath).replace(/\\/gu, '/'),
    evidenceValidationBoundary: userChoices.evidenceValidationBoundary,
  };
  if (setupPlan.userAuthorizedEvidence) {
    profile.userAuthorizedEvidence = clone(setupPlan.userAuthorizedEvidence);
  }
  if (setupPlan.setupAuthorization) {
    profile.setupAuthorization = clone(setupPlan.setupAuthorization);
  }
  return profile;
}

async function persistSetupProfile({ paths, setupPlan, userChoices, saveProfile }) {
  userChoices.selectedCapabilityIds = userChoices.availableCapabilities
    .filter((capability) => capability.selected)
    .map((capability) => capability.id);
  const capabilityHints = createCapabilityHints(setupPlan, userChoices);
  const profile = createBuildProfile(setupPlan, userChoices, capabilityHints, paths);
  assertBuildProfileSafe(profile);
  await ensureSiteWorkspace(paths.workspace, paths.site, { nowIso: paths.generatedAt });
  await ensureDir(paths.artifactDir);
  await ensureDir(paths.siteArtifactDir);
  await ensureDir(path.dirname(paths.buildProfilePath));
  await writeJsonFile(paths.setupPlanPath, setupPlan);
  await writeJsonFile(paths.userChoicesPath, userChoices);
  await writeJsonFile(paths.capabilityHintsPath, capabilityHints);
  await writeJsonFile(paths.authStateReportPath, profile.authStateReport ?? createPublicOnlyAuthStateReport({
    site: setupPlan.site,
  }));
  await writeJsonFile(paths.buildProfilePath, profile);
  if (saveProfile) {
    await writeJsonFile(paths.savedBuildProfilePath, profile);
  }
  return { userChoices, capabilityHints, profile };
}

async function persistProfileSnapshot(paths, profile) {
  const selectedCapabilities = profile.capabilityScope?.selectedCapabilities ?? [];
  const capabilityHints = {
    schemaVersion: SETUP_ASSISTANT_SCHEMA_VERSION,
    artifactFamily: 'siteforge-capability-hints',
    buildId: paths.buildId,
    siteId: paths.site.id,
    recommendedCapabilities: selectedCapabilities,
    disabledUnsafeActions: profile.safety?.unsafeActions ?? clone(UNSAFE_ACTION_DEFAULTS),
    blockedSurfaces: [],
    collectionReview: clone(profile.collectionReview ?? null),
    validationBoundary: profile.evidenceValidationBoundary ?? 'Choices guide scope only; verification still requires evidence-backed capabilities.',
  };
  const userChoices = {
    schemaVersion: SETUP_ASSISTANT_SCHEMA_VERSION,
    artifactFamily: 'siteforge-user-choices',
    buildId: paths.buildId,
    siteId: paths.site.id,
    mode: 'reuse-saved-profile',
    acceptedDefaultRecommendation: true,
    setupConfiguration: normalizeSetupConfiguration(profile.setupConfiguration),
    scope: clone(profile.scope ?? defaultScopeForPlan(0)),
    selectedCapabilityIds: selectedCapabilities.map((capability) => capability.id).filter(Boolean),
    disabledUnsafeActions: profile.safety?.unsafeActions ?? clone(UNSAFE_ACTION_DEFAULTS),
    hints: profile.userHints ?? [],
    evidenceValidationBoundary: capabilityHints.validationBoundary,
  };
  const authStateReport = reusableBuildProfileAuthStateReport({
    site: paths.site,
    buildProfile: profile,
  })
    ?? createPublicOnlyAuthStateReport({
      site: profile.site ?? paths.site,
      authMethod: 'none',
    });
  const crawlContract = reusableBuildProfileCrawlContract({
    site: paths.site,
    buildProfile: profile,
    authStateReport,
  })
    ?? createCrawlContract({
      site: profile.site ?? paths.site,
      authStateReport,
      coverageTargets: {
        publicRoutes: [paths.site.rootUrl],
        authRoutes: [],
        publicRevisitRoutes: [paths.site.rootUrl],
        candidateCapabilities: [],
        requiresLoginCapabilities: [],
      },
    });
  const profileSnapshot = {
    ...profile,
    updatedAt: new Date().toISOString(),
    crawlContract,
    authStateReport,
    collectionReview: clone(profile.collectionReview ?? null),
    setupConfiguration: normalizeSetupConfiguration(profile.setupConfiguration),
    setupRefs: {
      userChoices: path.relative(paths.cwd, paths.userChoicesPath).replace(/\\/gu, '/'),
      capabilityHints: path.relative(paths.cwd, paths.capabilityHintsPath).replace(/\\/gu, '/'),
    },
    profileUsability: profile.profileUsability ?? {
      schemaVersion: SETUP_ASSISTANT_SCHEMA_VERSION,
      status: 'usable',
      buildable: true,
      reasonCode: null,
      reason: null,
    },
  };
  assertBuildProfileSafe(profileSnapshot);
  await ensureSiteWorkspace(paths.workspace, paths.site, { nowIso: paths.generatedAt });
  await ensureDir(paths.artifactDir);
  await ensureDir(path.dirname(paths.buildProfilePath));
  await writeJsonFile(paths.userChoicesPath, userChoices);
  await writeJsonFile(paths.capabilityHintsPath, capabilityHints);
  await writeJsonFile(paths.authStateReportPath, profileSnapshot.authStateReport);
  await writeJsonFile(paths.buildProfilePath, profileSnapshot);
  return { userChoices, capabilityHints, profile: profileSnapshot };
}

function writeSetupLine(options, line = '') {
  const output = options.setupOutput ?? defaultStdout;
  output.write(`${line}\n`);
}

async function askSetupQuestion(prompt, options = /** @type {any} */ ({})) {
  if (typeof options.setupPrompt === 'function') {
    return String(await options.setupPrompt(prompt));
  }
  return '';
}

function countAuthorizedActionableElements(evidence) {
  const autoCount = Number(evidence?.autoDiscovery?.summary?.actionable_elements ?? 0) || 0;
  const pageControlCount = (evidence?.pages ?? []).reduce((sum, page) => (
    sum + (Array.isArray(page?.controls) ? page.controls.length : 0)
  ), 0);
  const seedCount = (evidence?.browserSeeds ?? []).reduce((sum, seed) => sum
    + Math.max(0, Number(seed?.linkCount ?? 0) || 0)
    + Math.max(0, Number(seed?.searchInputCount ?? 0) || 0), 0);
  return Math.max(autoCount, pageControlCount, seedCount);
}

function capabilityProofsFromAuthorizedBrowserSeeds(setupPlan, capability = /** @type {any} */ ({})) {
  const targetIds = [
    capability.id,
    capability.name,
    capability.action,
    capability.intentType,
  ].map(normalizeCapabilityId).filter(Boolean);
  if (!targetIds.length) {
    return [];
  }
  return (setupPlan?.userAuthorizedEvidence?.browserSeeds ?? []).filter((seed) => {
    const seedCapabilityIds = [
      ...(seed?.capabilityIds ?? []),
      ...capabilityIdsFromAuthorizedBrowserSeedSummary(seed),
    ].map(normalizeCapabilityId).filter(Boolean);
    return targetIds.some((targetId) => seedCapabilityIds.some((seedId) => (
      seedId === targetId || seedId.includes(targetId) || targetId.includes(seedId)
    )));
  });
}

function collectedUserAuthorizedCapabilityIds(setupPlan) {
  const ids = new Set();
  for (const capability of setupPlan.recommendedCapabilities ?? []) {
    const normalizedId = normalizeCapabilityId(capability.id);
    if (!normalizedId) {
      continue;
    }
    if (capability.recommended === true && !userAuthorizedCapabilityProofDescriptor(normalizedId)) {
      ids.add(normalizedId);
      continue;
    }
    if (hasVerifiedCapabilityProof(setupPlan, capability) || capabilityProofsFromAuthorizedBrowserSeeds(setupPlan, capability).length > 0) {
      ids.add(normalizedId);
    }
  }
  return ids;
}

function userAuthorizedProofTargetCapabilities(setupPlan) {
  return (setupPlan.recommendedCapabilities ?? [])
    .filter((capability) => userAuthorizedCapabilityProofDescriptor(capability?.id));
}

function buildUserAuthorizedCollectionReviewPrompt(setupPlan) {
  void setupPlan;
  return null;
}

function renderUserAuthorizedCollectionReviewPrompt(review, options = /** @type {any} */ ({})) {
  void review;
  void options;
}

function parseContinueUncollectedAnswer(answer) {
  const text = compactText(answer);
  const decision = parseContinueUncollectedCollectionAnswer(answer);
  if (
    decision.reasonCode === 'unrecognized'
    && !/(?:cookie|authorization|bearer|csrf|token|sessdata|session[_-]?id|password|userdatadir|profilepath)/iu.test(text)
    && /[\p{Script=Han}]|search|feed|timeline|follow|profile|news|article|content|product|shop|catalog|recommended|posts|updates/iu.test(text)
  ) {
    return {
      continueUncollected: true,
      nextChoiceHint: text,
      reasonCode: 'forwarded-choice-hint',
    };
  }
  return {
    continueUncollected: decision.continue,
    nextChoiceHint: null,
    reasonCode: decision.reasonCode,
  };
}

async function promptUserAuthorizedCollectionReview(setupPlan, options = /** @type {any} */ ({})) {
  const review = buildUserAuthorizedCollectionReviewPrompt(setupPlan);
  if (!review) {
    return { setupPlan, continueUncollected: true, nextChoiceHint: null };
  }
  const nextSetupPlan = {
    ...setupPlan,
    userAuthorizedCollectionReview: review,
  };
  if (review.status !== 'partial') {
    if (options.manualSupplementalCollection === true || options.auto !== true && options.autoDiscovery !== true) {
      renderUserAuthorizedCollectionReviewPrompt(review, options);
    }
    return { setupPlan: nextSetupPlan, continueUncollected: true, nextChoiceHint: null };
  }
  if (
    setupPlan.userAuthorizedEvidence?.autoDiscovery?.status === 'modeled'
    && options.manualSupplementalCollection !== true
    && (
      options.auto === true
      || options.autoDiscovery === true
      || typeof options.setupPrompt !== 'function'
    )
  ) {
    return { setupPlan: nextSetupPlan, continueUncollected: false, nextChoiceHint: null, reasonCode: 'auto-discovery-default-skip' };
  }
  renderUserAuthorizedCollectionReviewPrompt(review, options);
  const answer = await askSetupQuestion('1/2: ', options);
  const decision = parseContinueUncollectedAnswer(answer);
  if (decision.continueUncollected === false && decision.reasonCode === 'unrecognized') {
    writeSetupLine(options, '未识别为 yes/是/继续；已按安全默认值跳过补充确认。');
  }
  if (decision.continueUncollected === true && !decision.nextChoiceHint) {
    const collectedPlan = await collectMissingCapabilityProofs(nextSetupPlan, {
      ...options,
      skipCapabilityCollectionConfirmation: true,
    });
    const refreshedReview = buildUserAuthorizedCollectionReviewPrompt(collectedPlan);
    if (refreshedReview) {
      writeSetupLine(options, '');
      writeSetupLine(options, '补充确认后结果');
      renderUserAuthorizedCollectionReviewPrompt(refreshedReview, options);
      return {
        setupPlan: {
          ...collectedPlan,
          userAuthorizedCollectionReview: refreshedReview,
        },
        ...decision,
      };
    }
    return {
      setupPlan: collectedPlan,
      ...decision,
    };
  }
  return {
    setupPlan: nextSetupPlan,
    ...decision,
  };
}

function setupKnownAdapterLabel(setupPlan = /** @type {any} */ ({})) {
  const policy = setupPlan.knownSitePolicy ?? {};
  if (policy.adapterId && policy.siteKey) {
    return `${policy.adapterId} (${policy.siteKey})`;
  }
  if (policy.adapterId) {
    return policy.adapterId;
  }
  if (policy.siteKey) {
    return policy.siteKey;
  }
  return '未匹配；使用通用只读预扫描';
}

function setupKnownAdapterDisplayLabel(setupPlan = /** @type {any} */ ({})) {
  const policy = setupPlan.knownSitePolicy ?? {};
  if (policy.adapterId && policy.siteKey) {
    return `${policy.adapterId} (${policy.siteKey})`;
  }
  return setupKnownAdapterLabel(setupPlan);
}

const DEFAULT_SETUP_CONFIGURATION = Object.freeze({
  explorationMode: 'read_only',
  sensitiveCapabilityStrategy: 'record_only',
  scanScope: 'all',
  generationStrategy: {
    nodeGranularity: 'page_region',
    capabilityRecognition: 'explicit_plus_candidates',
    lowConfidenceHandling: 'candidate',
  },
  writeMode: 'promote_verified',
  validationStrategy: 'standard',
});

const SETUP_CONFIGURATION_LABELS = Object.freeze({
  explorationMode: Object.freeze({
    read_only: '只读探索',
    safe_interaction: '安全交互',
    controlled_interaction: '受控交互',
    manual_guided: '手动引导',
  }),
  sensitiveCapabilityStrategy: Object.freeze({
    record_only: '仅记录，不启用',
    limited_enable: '有限启用',
    confirm_each: '逐项确认',
    batch_select: '批量选择',
  }),
  scanScope: Object.freeze({
    all: '全部入口',
    adapter: '适配器入口',
    admin: '后台 / 管理相关入口',
    manual: '手动选择入口',
    custom: '自定义范围',
  }),
  nodeGranularity: Object.freeze({
    page: '页面级',
    page_region: '页面 + 区域级',
    page_region_control: '页面 + 区域 + 控件级',
  }),
  capabilityRecognition: Object.freeze({
    explicit_only: '仅明确能力',
    explicit_plus_candidates: '明确能力 + 低置信候选',
    infer_potential: '尽可能推断潜在能力',
  }),
  lowConfidenceHandling: Object.freeze({
    discard: '丢弃',
    candidate: '标记为候选',
    manual_queue: '进入人工确认队列',
  }),
  writeMode: Object.freeze({
    preview_only: '仅预览，不写入',
    draft_only: '写入草稿 draft/',
    current_only: '更新 current/，不更新 registry.json',
    promote_verified: '验证通过后更新 current/ 和 registry.json',
    backup_promote: '创建备份后更新 current/ 和 registry.json',
  }),
});

function defaultSetupConfiguration() {
  return clone(DEFAULT_SETUP_CONFIGURATION);
}

function normalizeSetupConfiguration(configuration = /** @type {any} */ ({})) {
  const defaults = defaultSetupConfiguration();
  const generationStrategy = {
    ...defaults.generationStrategy,
    ...(configuration.generationStrategy ?? {}),
  };
  return {
    ...defaults,
    ...configuration,
    generationStrategy,
  };
}

function setupConfigurationLabel(group, key, fallback = '-') {
  return SETUP_CONFIGURATION_LABELS[group]?.[key] ?? fallback;
}

function setupGenerationStrategyLabel(configuration) {
  const generation = normalizeSetupConfiguration(configuration).generationStrategy;
  if (generation.customGenerationHint) {
    return '自定义';
  }
  if (
    generation.nodeGranularity === DEFAULT_SETUP_CONFIGURATION.generationStrategy.nodeGranularity
    && generation.capabilityRecognition === DEFAULT_SETUP_CONFIGURATION.generationStrategy.capabilityRecognition
    && generation.lowConfidenceHandling === DEFAULT_SETUP_CONFIGURATION.generationStrategy.lowConfidenceHandling
  ) {
    return setupConfigurationLabel('nodeGranularity', generation.nodeGranularity);
  }
  if (
    generation.nodeGranularity === 'page'
    && generation.capabilityRecognition === 'explicit_only'
    && generation.lowConfidenceHandling === 'discard'
  ) {
    return '精简';
  }
  if (
    generation.nodeGranularity === 'page_region_control'
    && generation.capabilityRecognition === 'infer_potential'
  ) {
    return '详细';
  }
  return setupConfigurationLabel('nodeGranularity', generation.nodeGranularity);
}

function applySetupConfigurationToChoices(userChoices) {
  const next = clone(userChoices);
  const configuration = normalizeSetupConfiguration(next.setupConfiguration);
  next.setupConfiguration = configuration;
  next.scope = {
    ...(next.scope ?? {}),
    explorationMode: configuration.explorationMode,
    scanScope: configuration.scanScope,
    generationStrategy: clone(configuration.generationStrategy),
    sensitiveCapabilityStrategy: configuration.sensitiveCapabilityStrategy,
    writeMode: configuration.writeMode,
    validationStrategy: configuration.validationStrategy,
  };
  if (configuration.explorationMode === 'safe_interaction') {
    next.scope.renderJs = true;
    next.scope.dynamicControls = 'low_risk_only';
  } else if (configuration.explorationMode === 'controlled_interaction') {
    next.scope.renderJs = true;
    next.scope.maxDepth = Math.max(Number(next.scope.maxDepth ?? 0) || 0, 2);
    next.scope.dynamicControls = 'controlled_low_risk';
  } else if (configuration.explorationMode === 'manual_guided') {
    next.scope.manualGuided = true;
  }
  return next;
}

function renderSetupPlan(setupPlan, options = /** @type {any} */ ({})) {
  if (setupPlan.buildReadiness?.buildable === false) {
    writeSetupLine(options, '当前不可构建');
    writeSetupLine(options, `  ! ${setupDisplayText(setupPlan.buildReadiness.reason)}`);
    for (const line of setupPlan.buildReadiness.guidance ?? []) {
      writeSetupLine(options, `  - ${setupDisplayText(line)}`);
    }
    writeSetupLine(options, '');
  }
}

function renderSavedProfileSummary(profile, options = /** @type {any} */ ({})) {
  void profile;
  void options;
}

async function promptAutomaticSetupConfiguration(options, choices, initialAnswer = null) {
  void options;
  void initialAnswer;
  return applySetupConfigurationToChoices(choices);
}

async function promptFirstRunChoices(setupPlan, options = /** @type {any} */ ({}), mode = 'accept-recommended', initialAnswer = null, promptOptions = /** @type {any} */ ({})) {
  void options;
  void initialAnswer;
  if (promptOptions.renderPlan !== false) {
    renderSetupPlan(setupPlan, options);
  }
  return applyBuildModeChoiceOverrides(defaultChoicesFromPlan(setupPlan, mode), options);
}

function buildOptionsFromProfile(options, paths, profile) {
  const scope = profile.scope ?? {};
  const safety = profile.safety ?? {};
  const authStateReport = reusableBuildProfileAuthStateReport({
    options,
    site: paths.site,
    buildProfile: profile,
  });
  const crawlContract = reusableBuildProfileCrawlContract({
    options,
    site: paths.site,
    buildProfile: profile,
    authStateReport,
  });
  const setupProfile = {
    ...profile,
    authStateReport,
    crawlContract,
  };
  return {
    ...options,
    buildId: paths.buildId,
    cwd: paths.cwd,
    buildProfilePath: paths.buildProfilePath,
    savedBuildProfilePath: paths.savedBuildProfilePath,
    setupProfile,
    crawlContract,
    authStateReport,
    authStateReportPath: profile.authStateReportRef
      ? path.resolve(paths.cwd, profile.authStateReportRef)
      : paths.authStateReportPath,
    maxDepth: options.maxDepth ?? scope.maxDepth,
    maxPages: options.maxPages ?? scope.maxPages,
    maxSeeds: options.maxSeeds ?? scope.maxSeeds,
    maxSitemaps: options.maxSitemaps ?? scope.maxSitemaps,
    renderJs: options.renderJs ?? (scope.renderJs === true ? true : undefined),
    captureNetwork: options.captureNetwork ?? scope.captureNetwork,
    submitForms: false,
    allowDestructiveActions: safety.allowDestructiveActions === true ? false : false,
    allowPayment: safety.allowPayment === true ? false : false,
    allowAccountMutation: safety.allowAccountMutation === true ? false : false,
    allowContactSubmit: safety.allowContactSubmit === true ? false : false,
    requestedCapabilities: (profile.capabilityScope?.selectedCapabilities ?? []).map((capability) => capability.name).filter(Boolean),
  };
}

function buildOptionsFromFreshSetupProfile(options, paths, profile, setupPlan) {
  const buildOptions = buildOptionsFromProfile({
    ...options,
    authStateReport: setupPlan.authStateReport ?? profile.authStateReport ?? null,
    crawlContract: setupPlan.crawlContract ?? profile.crawlContract ?? null,
  }, paths, profile);
  attachAuthRuntimeMaterial(buildOptions, authRuntimeMaterialFrom(setupPlan.authStateReport));
  return buildOptions;
}

function firstTimeSetupRequiredError(paths, setupPlan) {
  const error = /** @type {Error & Record<string, any>} */ (new Error(
    `first-time-setup-required: ${setupPlan.site.rootUrl} has no saved build_profile.json. setup_plan.json: ${paths.setupPlanPath}`,
  ));
  error.code = 'first-time-setup-required';
  error.artifactDir = paths.artifactDir;
  error.setupPlanPath = paths.setupPlanPath;
  return error;
}

function setupEvidenceNotBuildableError(paths, setupPlan) {
  const guidance = (setupPlan.buildReadiness?.guidance ?? []).map((line) => setupDisplayText(line)).join(' ');
  const error = /** @type {Error & Record<string, any>} */ (new Error(
    `setup-evidence-not-buildable: SiteForge did not find enough public setup evidence for ${setupPlan.site.rootUrl}. `
    + `${setupDisplayText(setupPlan.buildReadiness?.reason ?? 'setup-not-buildable')} `
    + `${guidance ? `${guidance} ` : ''}`
    + `setup_plan.json: ${paths.setupPlanPath}`,
  ));
  error.code = 'setup-evidence-not-buildable';
  error.reasonCode = setupPlan.buildReadiness?.reasonCode ?? 'setup-no-page-evidence';
  error.guidance = setupPlan.buildReadiness?.guidance ?? [];
  error.artifactDir = paths.artifactDir;
  error.setupPlanPath = paths.setupPlanPath;
  error.userChoicesPath = paths.userChoicesPath;
  error.capabilityHintsPath = paths.capabilityHintsPath;
  error.buildProfilePath = paths.buildProfilePath;
  error.savedBuildProfilePath = paths.savedBuildProfilePath;
  return error;
}

async function persistUnbuildableSetupAndThrow({ paths, setupPlan, options, mode }) {
  renderSetupPlan(setupPlan, options);
  const userChoices = defaultChoicesFromPlan(setupPlan, mode);
  userChoices.acceptedDefaultRecommendation = false;
  await persistSetupProfile({
    paths,
    setupPlan,
    userChoices,
    saveProfile: true,
  });
  throw setupEvidenceNotBuildableError(paths, setupPlan);
}

export async function prepareSiteForgeBuildSetup(inputUrl, options = /** @type {any} */ ({})) {
  const paths = buildSetupAssistantPaths(inputUrl, options);
  const interactive = resolveSetupInteractive(options);
  const savedProfileCandidate = await readJsonOrNull(paths.savedBuildProfilePath);
  const savedProfile = options.strictCookieAuth === true || options.strictBrowserAuth === true
    ? null
    : isUsableSavedBuildProfile(savedProfileCandidate) ? savedProfileCandidate : null;

  if (!savedProfile) {
    let { setupPlan, robotsPolicy } = await generateSetupPlan(inputUrl, { ...options, buildId: paths.buildId, cwd: paths.cwd });
    setupPlan = await applyCrawlContractChoice({ inputUrl, paths, setupPlan, options, robotsPolicy });
    let setupReview = { continueUncollected: true, nextChoiceHint: null };
    let setupPlanRendered = false;
    if (!isSetupPlanBuildable(setupPlan)) {
      // Cookie authentication is governed by crawlContract/auth_state_report.
      // Synthetic or known-site policy evidence must not make setup buildable.
    }
    if (!isSetupPlanBuildable(setupPlan)) {
      if (canContinueSetupBlockedForApiDiscovery(setupPlan, options)) {
        const fallbackSetupPlan = setupBlockedApiDiscoveryPlan(setupPlan);
        const fallbackOptions = setupBlockedApiDiscoveryOptions(options, fallbackSetupPlan);
        const userChoices = applyBuildModeChoiceOverrides(defaultChoicesFromPlan(fallbackSetupPlan, 'auto'), fallbackOptions);
        const persisted = await persistSetupProfile({
          paths,
          setupPlan: fallbackSetupPlan,
          userChoices,
          saveProfile: false,
        });
        return {
          status: SETUP_BLOCKED_API_DISCOVERY_STATUS,
          paths,
          setupPlan: fallbackSetupPlan,
          ...persisted,
          buildOptions: buildOptionsFromFreshSetupProfile(fallbackOptions, paths, persisted.profile, fallbackSetupPlan),
        };
      }
      if (interactive) {
        await persistUnbuildableSetupAndThrow({
          paths,
          setupPlan,
          options,
          mode: 'first-run-unusable',
        });
      }
      throw setupEvidenceNotBuildableError(paths, setupPlan);
    }
    if (!interactive) {
      const userChoices = applyBuildModeChoiceOverrides(defaultChoicesFromPlan(setupPlan, 'auto'), options);
      setupPlan = await collectSelectedCapabilityProofs(setupPlan, userChoices, {
        ...options,
        disableManualCapabilityProofPrompt: true,
      });
      const persisted = await persistSetupProfile({
        paths,
        setupPlan,
        userChoices,
        saveProfile: true,
      });
      return {
        status: 'created',
        paths,
        setupPlan,
        ...persisted,
        buildOptions: buildOptionsFromFreshSetupProfile(options, paths, persisted.profile, setupPlan),
      };
    }
    let userChoices = await promptFirstRunChoices(setupPlan, options, 'first-run', setupReview.nextChoiceHint, {
      renderPlan: !setupPlanRendered,
    });
    userChoices = applyBuildModeChoiceOverrides(userChoices, options);
    setupPlan = await collectSelectedCapabilityProofs(setupPlan, userChoices, {
      ...options,
      disableManualCapabilityProofPrompt: setupReview.continueUncollected === false
        ? true
        : options.disableManualCapabilityProofPrompt,
    });
    const persisted = await persistSetupProfile({
      paths,
      setupPlan,
      userChoices,
      saveProfile: true,
    });
    return {
      status: 'created',
      paths,
      setupPlan,
      ...persisted,
      buildOptions: buildOptionsFromFreshSetupProfile(options, paths, persisted.profile, setupPlan),
    };
  }

  if (interactive) {
    renderSavedProfileSummary(savedProfile, options);
    const answer = await askSetupQuestion('1/2: ', options);
    if (/^(?:edit|e|编辑)$/iu.test(answer) || answer.length > 0 && !/^(?:reset|r|重置)$/iu.test(answer)) {
      let { setupPlan, robotsPolicy } = await generateSetupPlan(inputUrl, { ...options, buildId: paths.buildId, cwd: paths.cwd });
      setupPlan = await applyCrawlContractChoice({ inputUrl, paths, setupPlan, options, robotsPolicy });
      let setupReview = { continueUncollected: true, nextChoiceHint: null };
      let setupPlanRendered = false;
      if (!isSetupPlanBuildable(setupPlan)) {
        await persistUnbuildableSetupAndThrow({
          paths,
          setupPlan,
          options,
          mode: 'edit-saved-profile-unusable',
        });
      }
      let userChoices = answer && !/^(?:edit|e|缂栬緫)$/iu.test(answer)
        ? applyHintToChoices(answer, defaultChoicesFromPlan(setupPlan, 'edit-saved-profile'))
        : await promptFirstRunChoices(setupPlan, options, 'edit-saved-profile', setupReview.nextChoiceHint, {
          renderPlan: !setupPlanRendered,
        });
      userChoices = applyBuildModeChoiceOverrides(userChoices, options);
      setupPlan = await collectSelectedCapabilityProofs(setupPlan, userChoices, {
        ...options,
        disableManualCapabilityProofPrompt: setupReview.continueUncollected === false
          ? true
          : options.disableManualCapabilityProofPrompt,
      });
      const persisted = await persistSetupProfile({
        paths,
        setupPlan,
        userChoices,
        saveProfile: true,
      });
      return {
        status: 'updated',
        paths,
        setupPlan,
        ...persisted,
        buildOptions: buildOptionsFromFreshSetupProfile(options, paths, persisted.profile, setupPlan),
      };
    }
    if (/^(?:reset|r|重置)$/iu.test(answer)) {
      let { setupPlan, robotsPolicy } = await generateSetupPlan(inputUrl, { ...options, buildId: paths.buildId, cwd: paths.cwd });
      setupPlan = await applyCrawlContractChoice({ inputUrl, paths, setupPlan, options, robotsPolicy });
      let setupReview = { continueUncollected: true, nextChoiceHint: null };
      let setupPlanRendered = false;
      if (!isSetupPlanBuildable(setupPlan)) {
        await persistUnbuildableSetupAndThrow({
          paths,
          setupPlan,
          options,
          mode: 'reset-to-recommendations-unusable',
        });
      }
      const userChoices = applyBuildModeChoiceOverrides(defaultChoicesFromPlan(setupPlan, 'reset-to-recommendations'), options);
      setupPlan = await collectSelectedCapabilityProofs(setupPlan, userChoices, {
        ...options,
        disableManualCapabilityProofPrompt: setupReview.continueUncollected === false
          ? true
          : options.disableManualCapabilityProofPrompt,
      });
      const persisted = await persistSetupProfile({
        paths,
        setupPlan,
        userChoices,
        saveProfile: true,
      });
      return {
        status: 'reset',
        paths,
        setupPlan,
        ...persisted,
        buildOptions: buildOptionsFromFreshSetupProfile(options, paths, persisted.profile, setupPlan),
      };
    }
  }

  const persisted = await persistProfileSnapshot(paths, savedProfile);
  return {
    status: 'reused',
    paths,
    setupPlan: null,
    ...persisted,
    buildOptions: buildOptionsFromProfile(options, paths, persisted.profile),
  };
}
