// @ts-check

import path from 'node:path';
import process, { stdin as defaultStdin, stderr as defaultStderr, stdout as defaultStdout } from 'node:process';
import { createInterface as createReadlineInterface } from 'node:readline/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openBrowserSession } from '../../../infra/browser/session.mjs';
import { ensureDir, pathExists, readJsonFile, writeJsonFile } from '../../../infra/io.mjs';
import { jsonClone } from '../../../shared/clone.mjs';
import { uniqueSortedStrings } from '../../../shared/normalize.mjs';
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
import {
  enterTerminalTui,
  isTerminalCharacterKey,
  isTerminalReturnKey,
  isTerminalSlashKey,
  isTerminalSpaceKey,
  readTerminalKeys,
} from './terminal-tui.mjs';
import { createSiteWorkspace, createSiteWorkspacePaths, ensureSiteWorkspace } from './workspace.mjs';

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
  '只能使用合规的已知站点适配器/API、用户授权浏览器路径，或 fixture 证据路径。',
]);

const USER_AUTHORIZED_SETUP_GUIDANCE = Object.freeze([
  '可以打开你的系统默认浏览器来获取用户授权设置证据。',
  '你必须在该浏览器中手动完成登录、MFA、授权或验证。',
  'SiteForge 只保存受限证据摘要；不会保存凭据值、浏览器 profile、页面正文或完整页面源码。',
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
  if (/^(?:y|yes|ok|okay|true|1|continue|go|go ahead|yes please)$/iu.test(text)
    || /^(?:是|是的|继续|继续采集|采集|补采|可以|好|好的|确认|要)$/u.test(text)) {
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

const SETUP_DISPLAY_TEXT_ZH = new Map([
  ['User-authorized browser surfaces', '用户授权浏览器页面'],
  ['Homepage and main navigation', '首页和主导航'],
  ['Search and discovery pages', '搜索和发现页面'],
  ['Product or item pages', '产品或条目页面'],
  ['Articles, feeds, and content pages', '文章、信息流和内容页面'],
  ['Contact and support pages', '联系和支持页面'],
  ['Login, registration, or account pages', '登录、注册或账号页面'],
  ['Payment, upload, or mutation pages', '付款、上传或变更页面'],
  ['General public pages', '通用公开页面'],
  ['List followed users', '读取关注列表'],
  ['List followed updates', '读取关注动态'],
  ['List profile content', '读取个人主页内容'],
  ['Search posts', '搜索帖子'],
  ['List recommended timeline posts', '读取推荐时间线帖子'],
  ['List notifications', '读取通知摘要'],
  ['List bookmarks', '读取书签摘要'],
  ['List lists', '读取列表摘要'],
  ['List direct messages', '读取私信会话摘要'],
  ['Prepare media download candidate', '准备媒体下载候选项'],
  ['View public homepage', '查看公开首页'],
  ['Browse public content pages', '浏览公开内容页面'],
  ['Browse product or item pages', '浏览产品或条目页面'],
  ['Search with public GET forms', '使用公开 GET 表单搜索'],
  ['Prepare contact drafts only', '仅准备联系草稿'],
  ['Recognize account surfaces without using them', '识别账号页面但不使用'],
  ['Use user-authorized known-site adapter', '使用用户授权的已知站点适配器'],
  ['Keep risky actions disabled', '保持风险操作禁用'],
  ['View public pages', '查看公开页面'],
  ['Use a bounded user-authorized browser evidence summary for known-site read-only capabilities.', '使用受限的用户授权浏览器证据摘要生成已知站点只读能力。'],
  ['User-authorized browser evidence was captured for a bounded known-site adapter path.', '已为受限的已知站点适配器路径捕获用户授权浏览器证据。'],
  ['Capability-specific evidence is required before this requested ability can become active.', '该请求能力需要能力级证据，验证通过后才会激活。'],
  ['Public homepage or sitemap page evidence was available during setup.', '设置期间发现了公开首页或站点地图页面证据。'],
  ['robots.txt, homepage, and sitemap were unavailable during setup.', '设置期间无法获取 robots.txt、首页和站点地图。'],
  ['Known site policy advertises social/download/query capabilities, but robots.txt disallowed all setup page evidence.', '已知站点策略声明了社交、下载或查询能力，但 robots.txt 阻止了所有设置页面证据。'],
  ['robots.txt disallowed all setup page evidence.', 'robots.txt 阻止了所有设置页面证据。'],
  ['Setup found only a synthetic fallback URL and no public page evidence.', '设置过程只找到合成兜底 URL，没有公开页面证据。'],
  ['Setup did not find public page evidence that is sufficient for a build.', '设置过程没有找到足以构建的公开页面证据。'],
  ['Setup is not ready to build.', '设置尚未就绪，不能构建。'],
  ['User-authorized browser evidence was captured without persisting raw session material.', '已捕获用户授权浏览器证据，未保存原始会话材料。'],
  ['public pages', '公开页面'],
]);

function setupDisplayText(value) {
  const text = String(value ?? '');
  return SETUP_DISPLAY_TEXT_ZH.get(text) ?? text;
}

function spawnDetached(command, args = []) {
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

export async function launchExternalBrowserUrl(url, options = {}) {
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

function parseBrowserAuthorizationConfirmationChoice(answer) {
  const text = compactText(answer).toLowerCase();
  if (!text || ['1', 'y', 'yes', 'ok', 'done', '完成', '已完成', '我已完成登录', '登录完成', '可以访问', '是'].includes(text)) {
    return { status: 'authorized' };
  }
  if (['2', 'blocked', 'refused', '拒绝', '被拒绝', '登录被拒绝', '无法登录'].includes(text)) {
    return { status: 'blocked' };
  }
  if (['3', 'cancel', 'c', '取消', '退出'].includes(text)) {
    return { status: 'cancel' };
  }
  return { status: 'cancel', reasonCode: 'unrecognized-terminal-confirmation' };
}

function browserAuthRows(ui, targetUrl) {
  const rows = [
    { type: 'section', id: 'scope', title: '授权范围', right: `目标站点：${targetUrl}` },
  ];
  if (ui.expanded.has('scope')) {
    rows.push(
      { type: 'detail', left: '    [ ] 打开目标站点', right: '已在系统默认浏览器中打开' },
      { type: 'detail', left: '    [ ] 完成登录、MFA 或授权', right: '只需要在浏览器里操作，SiteForge 不接收密码' },
      { type: 'detail', left: '    [ ] 确认可以访问目标页面', right: '终端只记录授权边界，不保存会话材料' },
    );
  }
  rows.push(
    { type: 'section', id: 'privacy', title: '隐私边界', right: '不保存 cookie、token、浏览器 profile、页面正文或完整页面源码' },
    { type: 'action', id: 'authorized', left: '我已完成登录', right: 'Enter 或 Space 确认' },
    { type: 'action', id: 'blocked', left: '登录被拒绝', right: '记录为未授权，不继续构建' },
    { type: 'action', id: 'cancel', left: '取消', right: '退出本次构建' },
  );
  return rows;
}

function renderBrowserAuthTui(ui, targetUrl) {
  const rows = browserAuthRows(ui, targetUrl);
  const lines = [
    '访问确认',
    '',
    '↑↓ 移动  Enter 展开/确认  Space 确认  Esc 取消',
    '',
  ];
  rows.forEach((row, index) => {
    const focused = index === ui.focus ? '› ' : '  ';
    if (row.type === 'section') {
      const expanded = ui.expanded.has(row.id) ? '▼' : '▶';
      lines.push(setupTuiRow(`${focused}${expanded} ${row.title}`, row.right));
      return;
    }
    if (row.type === 'action') {
      const marker = index === ui.focus ? '[x]' : '[ ]';
      lines.push(setupTuiRow(`${focused}${marker} ${row.left}`, row.right));
      return;
    }
    lines.push(setupTuiRow(`${focused}${row.left}`, row.right));
  });
  return `${lines.join('\n')}\n`;
}

async function promptBrowserAuthorizationConfirmationTui({ targetUrl, options = {} }) {
  if (!canUseSetupTui(options)) {
    return null;
  }
  const input = options.setupInput ?? defaultStdin;
  const output = options.setupOutput ?? defaultStdout;
  const ui = {
    expanded: new Set(['scope']),
    focus: 5,
  };
  const terminal = enterTerminalTui(input, output);
  if (!terminal) {
    return null;
  }
  const render = () => {
    const rows = browserAuthRows(ui, targetUrl);
    if (ui.focus >= rows.length) {
      ui.focus = Math.max(0, rows.length - 1);
    }
    terminal.render(renderBrowserAuthTui(ui, targetUrl));
  };
  render();
  try {
    for await (const key of readTerminalKeys(input)) {
      const rows = browserAuthRows(ui, targetUrl);
      if (key.ctrl && key.name === 'c') {
        return { status: 'cancel' };
      }
      if (key.name === 'escape') {
        return { status: 'cancel' };
      }
      if (key.name === 'up') {
        ui.focus = Math.max(0, ui.focus - 1);
      } else if (key.name === 'down') {
        ui.focus = Math.min(Math.max(0, rows.length - 1), ui.focus + 1);
      } else if (isTerminalReturnKey(key) || isSetupTuiSpaceKey(key)) {
        const row = rows[ui.focus];
        if (row?.type === 'section') {
          if (ui.expanded.has(row.id)) ui.expanded.delete(row.id);
          else ui.expanded.add(row.id);
        } else if (row?.type === 'action') {
          if (row.id === 'authorized') return { status: 'authorized' };
          if (row.id === 'blocked') return { status: 'blocked' };
          return { status: 'cancel' };
        }
      }
      render();
    }
  } finally {
    terminal.close();
  }
  return { status: 'cancel' };
}

async function waitForBrowserAuthorizationConfirmation({ targetUrl, options = {} }) {
  if (typeof options.browserAuthorizationConfirmationProvider === 'function') {
    return await options.browserAuthorizationConfirmationProvider({ targetUrl, options });
  }
  const tuiChoice = await promptBrowserAuthorizationConfirmationTui({ targetUrl, options });
  if (tuiChoice) {
    return tuiChoice;
  }
  const answer = await askSetupQuestion('选择：', options);
  return parseBrowserAuthorizationConfirmationChoice(answer);
}

function setupNow(options = {}) {
  return options.now instanceof Date ? options.now : new Date();
}

export function buildSetupAssistantPaths(inputUrl, options = {}) {
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

function cloneIfPresent(value) {
  return value === undefined ? undefined : clone(value);
}

function firstPresent(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '') ?? null;
}

function asStringList(value) {
  return Array.isArray(value) ? value.map((entry) => String(entry)).filter(Boolean) : [];
}

function knownGenericLiveBuildSummary(registryRecord, capabilityRecord) {
  const registryGeneric = registryRecord?.genericLiveBuild && typeof registryRecord.genericLiveBuild === 'object'
    ? registryRecord.genericLiveBuild
    : {};
  const capabilityGeneric = capabilityRecord?.genericLiveBuild && typeof capabilityRecord.genericLiveBuild === 'object'
    ? capabilityRecord.genericLiveBuild
    : {};
  const registryDownloadSupport = registryRecord?.downloadSupport && typeof registryRecord.downloadSupport === 'object'
    ? registryRecord.downloadSupport
    : {};
  const capabilityDownloader = capabilityRecord?.downloader && typeof capabilityRecord.downloader === 'object'
    ? capabilityRecord.downloader
    : {};
  const alternativeAccessPaths = uniqueSortedStrings([
    ...asStringList(registryGeneric.alternativeAccessPaths),
    ...asStringList(capabilityGeneric.alternativeAccessPaths),
    ...asStringList(registryRecord?.alternativeAccessPaths),
    ...asStringList(capabilityRecord?.alternativeAccessPaths),
  ]);
  const status = firstPresent(
    registryGeneric.status,
    capabilityGeneric.status,
    registryRecord?.siteAccessStatus,
    capabilityRecord?.siteAccessStatus,
    registryDownloadSupport.liveAccessStatus,
    capabilityDownloader.liveAccessStatus,
    capabilityRecord?.liveAccessStatus,
  );
  const reasonCode = firstPresent(
    registryDownloadSupport.reasonCode,
    capabilityDownloader.reasonCode,
    registryGeneric.reasonCode,
    capabilityGeneric.reasonCode,
    registryRecord?.unsupportedLiveReasonCode,
    capabilityRecord?.unsupportedLiveReasonCode,
    registryDownloadSupport.unsupportedLiveReasonCode,
    capabilityDownloader.liveAccessReasonCode,
    capabilityDownloader.unsupportedLiveReasonCode,
    capabilityRecord?.liveAccessReasonCode,
  );
  const reason = firstPresent(
    registryDownloadSupport.reason,
    capabilityDownloader.reason,
    registryGeneric.reason,
    capabilityGeneric.reason,
    registryRecord?.unsupportedLiveReason,
    capabilityRecord?.unsupportedLiveReason,
    registryDownloadSupport.unsupportedLiveReason,
    capabilityDownloader.liveAccessReason,
    capabilityDownloader.unsupportedLiveReason,
    capabilityRecord?.liveAccessReason,
  );
  if (!status && !reasonCode && !reason && alternativeAccessPaths.length === 0) {
    return null;
  }
  return {
    status,
    reasonCode,
    reason,
    alternativeAccessPaths,
  };
}

function knownPolicySummary(registryRecord, capabilityRecord) {
  if (!registryRecord && !capabilityRecord) {
    return null;
  }
  const capabilityFamilies = uniqueSortedStrings([
    ...(registryRecord?.capabilityFamilies ?? []),
    ...(capabilityRecord?.capabilityFamilies ?? []),
  ]);
  const supportedIntents = uniqueSortedStrings(capabilityRecord?.supportedIntents ?? []);
  const safeActionKinds = uniqueSortedStrings(capabilityRecord?.safeActionKinds ?? []);
  const approvalActionKinds = uniqueSortedStrings(capabilityRecord?.approvalActionKinds ?? []);
  const genericLiveBuild = knownGenericLiveBuildSummary(registryRecord, capabilityRecord);
  return {
    schemaVersion: SETUP_ASSISTANT_SCHEMA_VERSION,
    status: 'matched',
    host: registryRecord?.host ?? capabilityRecord?.host ?? null,
    siteKey: registryRecord?.siteKey ?? capabilityRecord?.siteKey ?? null,
    adapterId: registryRecord?.adapterId ?? capabilityRecord?.adapterId ?? null,
    repoSkillDir: registryRecord?.repoSkillDir ?? null,
    siteArchetype: registryRecord?.siteArchetype ?? capabilityRecord?.primaryArchetype ?? null,
    siteAccessStatus: registryRecord?.siteAccessStatus ?? capabilityRecord?.siteAccessStatus ?? null,
    capabilityFamilies,
    supportedIntents,
    safeActionKinds,
    approvalActionKinds,
    downloadSessionRequirement: registryRecord?.downloadSessionRequirement ?? null,
    downloadTaskTypes: cloneIfPresent(registryRecord?.downloadTaskTypes) ?? [],
    downloadSupport: cloneIfPresent(registryRecord?.downloadSupport) ?? null,
    downloader: cloneIfPresent(capabilityRecord?.downloader) ?? null,
    accessSignals: cloneIfPresent(registryRecord?.accessSignals ?? capabilityRecord?.accessSignals) ?? null,
    routingNotes: cloneIfPresent(registryRecord?.routingNotes ?? capabilityRecord?.routingNotes) ?? [],
    genericLiveBuild,
    setupConstraints: {
      userChoicesBypassPolicy: false,
      requiresEvidenceForCapabilities: capabilityFamilies,
      approvalActionKinds,
      safeActionKinds,
      downloadSessionRequirement: registryRecord?.downloadSessionRequirement ?? null,
      genericLiveBuildStatus: genericLiveBuild?.status ?? null,
      genericLiveBuildReasonCode: genericLiveBuild?.reasonCode ?? null,
      downloadReasonCode: registryRecord?.downloadSupport?.reasonCode ?? capabilityRecord?.downloader?.reasonCode ?? null,
      alternativeAccessPaths: cloneIfPresent(genericLiveBuild?.alternativeAccessPaths) ?? [],
    },
    sources: [
      registryRecord ? 'config/site-registry.json' : null,
      capabilityRecord ? 'config/site-capabilities.json' : null,
    ].filter(Boolean),
  };
}

function policyCapabilityMatches(value) {
  const text = String(value ?? '').toLowerCase();
  return text.includes('download') || text.includes('social') || text.includes('query');
}

function knownPolicyCapabilityPressure(knownSitePolicy) {
  if (!knownSitePolicy) {
    return null;
  }
  const matchedCapabilityFamilies = uniqueSortedStrings(
    (knownSitePolicy.capabilityFamilies ?? []).filter(policyCapabilityMatches),
  );
  const matchedSupportedIntents = uniqueSortedStrings(
    (knownSitePolicy.supportedIntents ?? []).filter(policyCapabilityMatches),
  );
  const matchedDownloadTaskTypes = uniqueSortedStrings(
    (knownSitePolicy.downloadTaskTypes ?? []).filter(policyCapabilityMatches),
  );
  return {
    schemaVersion: SETUP_ASSISTANT_SCHEMA_VERSION,
    siteKey: knownSitePolicy.siteKey ?? null,
    adapterId: knownSitePolicy.adapterId ?? null,
    sources: clone(knownSitePolicy.sources ?? []),
    hasPolicyCapabilities: matchedCapabilityFamilies.length > 0
      || matchedSupportedIntents.length > 0
      || matchedDownloadTaskTypes.length > 0,
    matchedCapabilityFamilies,
    matchedSupportedIntents,
    matchedDownloadTaskTypes,
  };
}

function knownPolicyAllowsUserAuthorizedSetup(knownSitePolicy) {
  if (!knownSitePolicy) {
    return false;
  }
  const alternatives = [
    ...(knownSitePolicy.genericLiveBuild?.alternativeAccessPaths ?? []),
    ...(knownSitePolicy.setupConstraints?.alternativeAccessPaths ?? []),
    ...(knownSitePolicy.routingNotes ?? []),
    ...(knownSitePolicy.accessSignals?.restrictionSignals ?? []),
    ...(knownSitePolicy.accessSignals?.notes ?? []),
  ].join(' ');
  return knownSitePolicy.downloadSessionRequirement === 'required'
    || /user-authori[sz]ed|authorized|login|session|consent|manual user/iu.test(alternatives);
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

function shouldAttemptUserAuthorizedSetup(setupPlan, options = {}) {
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

function normalizeUserAuthorizedCapabilityProofs(proofs) {
  if (!Array.isArray(proofs)) {
    return [];
  }
  return proofs.map((proof) => ({
    status: proof?.status === 'verified' ? 'verified' : 'candidate',
    capabilityId: firstWords(proof?.capabilityId, 80),
    setupCapabilityId: firstWords(proof?.setupCapabilityId, 80),
    intentType: firstWords(proof?.intentType, 80),
    action: firstWords(proof?.action, 80),
    evidenceType: firstWords(proof?.evidenceType ?? proof?.type ?? 'summary', 80),
    sampleCount: Math.max(0, Number(proof?.sampleCount ?? proof?.itemCount ?? proof?.evidenceCount ?? 0) || 0),
    source: firstWords(sanitizeEvidenceRef(proof?.source) ?? 'user-authorized-capability-proof', 160),
    rawMaterialPersisted: false,
  })).filter((proof) => (
    proof.status === 'verified'
    && proof.sampleCount > 0
    && [proof.capabilityId, proof.setupCapabilityId, proof.intentType, proof.action].some(Boolean)
  ));
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

function normalizeUserAuthorizedEvidence(evidence, site, setupPlan, options = {}) {
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
        title: `${new URL(site.rootUrl).hostname} 授权浏览器 seed`,
        textSummary: `用户授权浏览器 seed 摘要：${seed.seedType || 'page'}；可见条数=${seed.visibleItemCount}；未保存原始页面材料。`,
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

function createKnownSiteAutoAuthorizedEvidence(inputUrl, setupPlan, paths, options = {}) {
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
    buildOptions: buildOptionsFromProfile(options, paths, persisted.profile),
  };
}

function userAuthorizedSetupIncompleteError(paths, evidence) {
  const signals = uniqueSortedStrings(evidence?.authState?.riskSignals ?? ['unknown-auth-state']);
  const error = new Error(
    `user-authorized-setup-incomplete: 用户授权设置尚未完成。` +
    `风险信号=${signals.join(',')}。请手动完成登录、MFA、授权或验证后，重新运行 siteforge build <url>。`,
  );
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
    ['blocked', '被拒绝', '拒绝', '登录被拒绝', '无法登录'].includes(lowerText)
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

  const countText = text.match(/^(\d+)(?:\s*(?:个|条|项|则|件|篇|items?|visible))?$/iu)?.[1];
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
    const riskSignals = [];
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

function authorizedBrowserRouteKindFromPath(pathName) {
  const normalized = normalizedPathName(pathName);
  if (normalized === '/home' || /\/(?:timeline|feed)(?:\/|$)/u.test(normalized)) {
    return 'home-timeline';
  }
  if (/(?:^|\/)following(?:\/|$)/u.test(normalized)) {
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

function capabilityIdsFromAuthorizedBrowserSeedSummary(summary = {}) {
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
  if (followingLinkCount > 0 || (/(?:^|\/)following(?:\/|$)/u.test(pathName) && profileLinkCount > 0)) {
    capabilities.add('list-followed-users');
  }
  if (articleLikeCount > 0 && /(?:^|\/)following(?:\/|$)/u.test(pathName)) {
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
      ].filter((node) => /timeline|feed|home|primary|main/i.test([
        node.getAttribute?.('aria-label'),
        node.getAttribute?.('data-testid'),
        node.id,
        node.className,
        node.tagName,
      ].join(' '))).length;
      const searchInputCount = [...document.querySelectorAll('input, [role="searchbox"], [aria-label]')]
        .filter((node) => /search|搜索/i.test([
          node.getAttribute?.('aria-label'),
          node.getAttribute?.('placeholder'),
          node.getAttribute?.('role'),
          node.name,
          node.type,
        ].join(' '))).length;
      const links = [...document.querySelectorAll('a[href]')].map((node) => String(node.href || node.getAttribute('href') || ''));
      const profileLinkCount = links.filter(isAllowedProfileUrl).length;
      const followingLinkCount = links.filter((url) => /\/following(?:[/?#]|$)/i.test(url)).length;
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
  const families = new Set(knownSitePolicy?.capabilityFamilies ?? []);
  const supported = new Set(knownSitePolicy?.supportedIntents ?? []);
  const hasSocialContent = families.has('query-social-content')
    || supported.has('recommended-timeline-posts')
    || supported.has('list-recommended-timeline-posts')
    || supported.has('search-posts')
    || supported.has('search-content');
  const hasSocialRelations = families.has('query-social-relations')
    || supported.has('list-followed-users');
  const hasAccountProfile = families.has('query-account-profile')
    || supported.has('profile-content')
    || supported.has('list-profile-content');
  const hasUtilityRoutes = families.has('navigate-to-utility-page')
    || supported.has('open-utility-page');
  const seeds = [];
  const addSeed = (urlValue, {
    routeKind = 'authorized-route',
    capabilityIds = [],
    visibleItemCount = 0,
    searchInputCount = 0,
  } = {}) => {
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
  } else if (/(?:^|\/)following(?:\/|$)/u.test(pathName) && hasSocialRelations) {
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
    addSeed(new URL('/search', site.rootUrl).toString(), {
      routeKind: 'search',
      capabilityIds: ['search-posts'],
    });
  }
  if (hasSocialRelations) {
    addSeed(new URL('/following', site.rootUrl).toString(), {
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

async function externalBrowserUserAuthorizedEvidenceProvider({ inputUrl, setupPlan, paths, options }) {
  let authState;
  if (options.manual === true) {
    writeSetupLine(options, '正在打开系统默认浏览器完成授权边界确认。');
    writeSetupLine(options, '请在浏览器中完成登录、MFA 或授权。');
    await launchExternalBrowserUrl(inputUrl, options);
    const answer = await askSetupQuestion('请粘贴最终授权 URL；如果登录被拒绝，请输入“被拒绝”：', options);
    authState = detectManualUserAuthorizedAuthState(answer, paths.site);
  } else {
    if (!canUseSetupTui(options)) {
      writeSetupLine(options, '访问确认');
      writeSetupLine(options, '');
      writeSetupTreeRow(options, '▼ 授权范围', `目标站点：${paths.site.rootUrl}`);
      writeSetupTreeRow(options, '    [ ] 打开目标站点', '已在系统默认浏览器中打开');
      writeSetupTreeRow(options, '    [ ] 完成登录、MFA 或授权', '只需要在浏览器里操作，SiteForge 不接收密码');
      writeSetupTreeRow(options, '    [ ] 确认可以访问目标页面', '终端只记录授权边界，不保存会话材料');
      writeSetupLine(options, '');
      writeSetupTreeRow(options, '▶ 隐私边界', '不保存 cookie、token、浏览器 profile、页面正文或完整页面源码');
      writeSetupTreeRow(options, '▶ 操作选项', 'Enter/1 已完成登录；2 登录被拒绝；3 取消');
      writeSetupLine(options, '');
    }
    await launchExternalBrowserUrl(inputUrl, options);
    const confirmation = await waitForBrowserAuthorizationConfirmation({ targetUrl: inputUrl, options });
    if (confirmation.status === 'authorized') {
      writeSetupLine(options, '✓ 浏览器确认已收到');
      writeSetupLine(options, '  正在验证访问状态...');
      authState = {
        status: 'authorized',
        finalUrl: defaultKnownSiteAuthorizedFinalUrl(paths.site),
        finalPath: new URL(defaultKnownSiteAuthorizedFinalUrl(paths.site)).pathname,
        riskSignals: [],
      };
      writeSetupLine(options, '✓ 访问确认完成');
      writeSetupLine(options, '');
    } else {
      authState = {
        status: 'incomplete',
        finalPath: null,
        hasPasswordInput: false,
        riskSignals: [confirmation.status === 'blocked' ? 'login-refused' : 'browser-confirmation-cancelled'],
      };
    }
  }
  const finalUrl = authState.finalUrl ?? defaultKnownSiteAuthorizedFinalUrl(paths.site);
  return {
    capturedAt: new Date().toISOString(),
    finalUrl,
    title: `${new URL(paths.site.rootUrl).hostname} 用户授权浏览器页面`,
    authState,
    pages: [{
      url: finalUrl,
      title: `${new URL(paths.site.rootUrl).hostname} 用户授权浏览器页面`,
      textSummary: '用户已在系统默认浏览器中完成授权；SiteForge 未保存原始会话材料。',
    }],
    browserSeeds: authorizedBrowserRouteSeedsFromFinalUrl(finalUrl, paths.site, setupPlan?.knownSitePolicy),
  };
}

async function controlledBrowserUserAuthorizedEvidenceProvider({ inputUrl, setupPlan, paths, options }) {
  const timeoutMs = Math.max(5_000, Number(options.browserAuthorizationTimeoutMs ?? options.timeoutMs ?? 120_000));
  writeSetupLine(options, '正在打开可见浏览器，用于获取用户授权设置证据...');
  writeSetupLine(options, '请手动完成登录或授权，然后回到这里按 Enter。');
  const session = await openBrowserSession({
    browserPath: options.browserPath,
    headless: false,
    timeoutMs,
    fullPage: false,
    viewport: {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
    },
    startupUrl: inputUrl,
    cleanupUserDataDirOnShutdown: true,
  }, {
    userDataDirPrefix: `${setupPlan.knownSitePolicy?.siteKey ?? paths.site.id}-siteforge-authorized-`,
  });
  try {
    await askSetupQuestion('浏览器显示授权后的页面后，请按 Enter 继续：', options);
    const metadata = await session.getPageMetadata(inputUrl);
    const authState = await detectUserAuthorizedAuthState(session);
    const finalUrl = metadata.finalUrl ?? inputUrl;
    const browserSeeds = authState.status === 'authorized'
      ? uniqueAuthorizedBrowserSeeds([
        ...await collectAuthorizedBrowserSeedsFromSession(session, paths.site),
        ...authorizedBrowserRouteSeedsFromFinalUrl(finalUrl, paths.site, setupPlan?.knownSitePolicy),
      ])
      : [];
    return {
      capturedAt: new Date().toISOString(),
      finalUrl,
      title: metadata.title || `${new URL(paths.site.rootUrl).hostname} 授权浏览器页面`,
      authState,
      pages: [{
        url: finalUrl,
        title: metadata.title || `${new URL(paths.site.rootUrl).hostname} 授权浏览器页面`,
      }],
      browserSeeds,
    };
  } finally {
    await session.close().catch(() => {});
  }
}

async function defaultUserAuthorizedEvidenceProvider(request) {
  if (
    request.options?.userAuthorizedEvidenceMode === 'controlled-browser'
    || request.options?.useControlledAuthorizationBrowser === true
  ) {
    return await controlledBrowserUserAuthorizedEvidenceProvider(request);
  }
  return await externalBrowserUserAuthorizedEvidenceProvider(request);
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

function capabilityIdsFromUserAuthorizedEvidence(evidence) {
  const seeds = Array.isArray(evidence?.browserSeeds) ? evidence.browserSeeds : [];
  return new Set(seeds
    .flatMap((seed) => [
      seed?.capabilityId,
      seed?.setupCapabilityId,
      seed?.intentType,
      seed?.action,
      ...(Array.isArray(seed?.capabilityIds) ? seed.capabilityIds : []),
    ])
    .map(normalizeCapabilityId)
    .filter(Boolean));
}

function knownPolicyRecommendedCapabilities(knownSitePolicy, { userAuthorized = false, userAuthorizedEvidence = null } = {}) {
  if (!knownSitePolicy || !userAuthorized) {
    return [];
  }
  const supported = new Set(knownSitePolicy.supportedIntents ?? []);
  const families = new Set(knownSitePolicy.capabilityFamilies ?? []);
  const observed = capabilityIdsFromUserAuthorizedEvidence(userAuthorizedEvidence);
  const capabilities = [];
  const add = (id, name, reason, safety = 'read_only', recommended = false, extra = {}) => {
    if (!capabilities.some((capability) => capability.id === id)) {
      capabilities.push({
        id,
        name,
        reason,
        safety,
        recommended,
        status: recommended ? 'recommended' : 'candidate',
        evidenceRequirement: extra.evidenceRequirement ?? 'capability-specific-evidence',
        disabledReason: recommended ? null : (extra.disabledReason ?? 'capability-specific-evidence-required'),
      });
    }
  };
  const hasIntent = (...ids) => ids.some((id) => supported.has(id) || observed.has(normalizeCapabilityId(id)));
  if (supported.has('list-followed-users') || families.has('query-social-relations')) {
    add('list-followed-users', 'List followed users', 'Candidate only until SiteForge captures capability-specific followed-user evidence.');
  }
  if (supported.has('list-followed-updates') || families.has('query-social-content')) {
    add('list-followed-updates', 'List followed updates', 'Candidate only until SiteForge captures capability-specific followed-update evidence.');
  }
  if (supported.has('recommended-timeline-posts') || supported.has('list-recommended-timeline-posts') || families.has('query-social-content')) {
    add('recommended-timeline-posts', 'List recommended timeline posts', 'Candidate only until SiteForge captures capability-specific recommended timeline evidence.');
  }
  if (supported.has('profile-content') || supported.has('list-profile-content') || families.has('query-social-content')) {
    add('list-profile-content', 'List profile content', 'Candidate only until SiteForge captures capability-specific profile evidence.');
  }
  if (supported.has('search-posts') || supported.has('search-content')) {
    add('search-posts', 'Search posts', 'Candidate only until SiteForge captures capability-specific search evidence.');
  }
  if (hasIntent('list-notifications', 'notifications')) {
    add('list-notifications', 'List notifications', 'Candidate only until SiteForge captures capability-specific notification evidence.');
  }
  if (hasIntent('list-bookmarks', 'bookmarks')) {
    add('list-bookmarks', 'List bookmarks', 'Candidate only until SiteForge captures capability-specific bookmark evidence.');
  }
  if (hasIntent('list-lists', 'lists')) {
    add('list-lists', 'List lists', 'Candidate only until SiteForge captures capability-specific list evidence.');
  }
  if (hasIntent('list-direct-messages', 'direct-messages', 'messages')) {
    add('list-direct-messages', 'List direct messages', 'Candidate only until SiteForge captures explicit message-list evidence.', 'requires_confirmation');
  }
  if (families.has('download-content')) {
    add('download-content-candidate', 'Prepare media download candidate', 'Downloads require a separate approved bounded action path.', 'requires_confirmation', false);
  }
  return capabilities;
}

function normalizeCapabilityId(value) {
  return String(value ?? '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
}

const USER_AUTHORIZED_CAPABILITY_PROOF_DESCRIPTORS = Object.freeze({
  'list-followed-users': {
    action: 'followed-users',
    intentType: 'list-followed-users',
    prompt: '请只在已打开的正常浏览器中访问关注列表页。填写站内页面地址或看到的数量；不要提交表单，不要粘贴账号、正文、cookie、token 或私密内容。站内页面地址或数量（回车跳过）：',
  },
  'list-followed-updates': {
    action: 'followed-posts-by-date',
    intentType: 'list-followed-updates',
    prompt: '请只在已打开的正常浏览器中访问关注动态页。填写站内页面地址或看到的动态数量；不要提交表单，不要粘贴正文、账号、cookie、token 或私密内容。站内页面地址或数量（回车跳过）：',
  },
  'list-profile-content': {
    action: 'profile-content',
    intentType: 'list-profile-content',
    prompt: '请只在已打开的正常浏览器中访问个人主页内容页。填写站内页面地址或看到的内容数量；不要提交表单，不要粘贴正文、账号、cookie、token 或私密内容。站内页面地址或数量（回车跳过）：',
  },
  'search-posts': {
    action: 'search',
    intentType: 'search-posts',
    prompt: '请只在已打开的正常浏览器中访问搜索结果页。填写站内页面地址或看到的结果数量；不要提交表单，不要粘贴正文、账号、cookie、token 或私密内容。站内页面地址或数量（回车跳过）：',
  },
  'recommended-timeline-posts': {
    action: 'recommended-timeline-posts',
    intentType: 'recommended-timeline-posts',
    prompt: '请只在已打开的正常浏览器中访问推荐时间线页。填写站内页面地址或看到的推荐帖子数量；不要提交表单，不要粘贴正文、账号、cookie、token 或私密内容。站内页面地址或数量（回车跳过）：',
  },
  'list-notifications': {
    action: 'notifications',
    intentType: 'list-notifications',
    prompt: '请只在已打开的正常浏览器中访问通知页。填写站内页面地址或看到的通知数量；不要提交表单，不要粘贴正文、账号、cookie、token 或私密内容。站内页面地址或数量（回车跳过）：',
  },
  'list-bookmarks': {
    action: 'bookmarks',
    intentType: 'list-bookmarks',
    prompt: '请只在已打开的正常浏览器中访问书签页。填写站内页面地址或看到的书签数量；不要提交表单，不要粘贴正文、账号、cookie、token 或私密内容。站内页面地址或数量（回车跳过）：',
  },
  'list-lists': {
    action: 'lists',
    intentType: 'list-lists',
    prompt: '请只在已打开的正常浏览器中访问列表页。填写站内页面地址或看到的列表数量；不要提交表单，不要粘贴正文、账号、cookie、token 或私密内容。站内页面地址或数量（回车跳过）：',
  },
  'list-direct-messages': {
    action: 'direct-messages',
    intentType: 'list-direct-messages',
    prompt: '请只在已打开的正常浏览器中访问私信会话列表页。填写站内页面地址或看到的会话数量；不要提交表单，不要粘贴私信正文、账号、cookie、token 或私密内容。站内页面地址或数量（回车跳过）：',
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
    return { id: 'list-followed-updates', label: '读取关注动态', supported: true };
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

function evaluateUserIntentCoverage(hints = [], availableCapabilities = []) {
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
  const supportedRequests = [];
  const unsupportedRequests = [];
  const unmatchedRequests = [];
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
    const registry = await readJsonOrNull(path.join(root, 'config', 'site-registry.json'));
    const capabilities = await readJsonOrNull(path.join(root, 'config', 'site-capabilities.json'));
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
    && profile?.scope
    && profile?.safety
    && hasCurrentSetupEvidenceGate(profile)
    && !isProfileMarkedUnusable(profile);
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

function resolveSetupInteractive(options = {}) {
  if (typeof options.setupInteractive === 'boolean') {
    return options.setupInteractive && !options.json && !options.quiet;
  }
  if (typeof options.interactive === 'boolean') {
    return options.interactive && !options.noTty && !options.json && !options.quiet;
  }
  if (options.forceTty) {
    return !options.noTty && !options.json && !options.quiet;
  }
  return Boolean(defaultStdin.isTTY && (defaultStdout.isTTY || defaultStderr.isTTY) && !options.noTty && !options.json && !options.quiet);
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
    sourcePath: result.sourcePath,
    fixtureName: result.fixtureName,
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

function addPageCandidate(pages, site, input, options = {}) {
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

function inspectForms(forms = []) {
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
  const capabilities = [];
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
  robotsExcludedUrls = [],
  knownSitePolicy = null,
  pages,
  userAuthorizedEvidence = null,
}) {
  const actualPageUrls = uniquePageUrls(pages, (page) => page.source !== 'synthetic_fallback');
  const syntheticPageUrls = uniquePageUrls(pages, (page) => page.source === 'synthetic_fallback');
  const userAuthorizedPageUrls = uniqueSortedStrings((userAuthorizedEvidence?.pages ?? [])
    .map((page) => page.normalizedUrl ?? page.url)
    .filter(Boolean));
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
    },
    sourceStatus: {
      robots: robotsAvailable ? 'parsed' : 'unavailable',
      homepage: homepageAvailable ? 'parsed' : homepageRobotsBlocked ? 'robots_disallowed' : 'synthetic_fallback',
      sitemap: sitemapAvailable ? 'parsed' : 'unavailable',
      userAuthorizedBrowser: userAuthorizedPageUrls.length ? 'captured' : 'not_used',
    },
    actualPageEvidenceCount: actualPageUrls.length,
    userAuthorizedBrowserEvidenceCount: userAuthorizedPageUrls.length,
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

function isSetupPlanBuildable(setupPlan) {
  return setupPlan?.buildReadiness?.buildable !== false;
}

const COLLECTION_REVIEW_KINDS = Object.freeze([
  'seeds',
  'nodes',
  'affordances',
  'capabilities',
  'intents',
]);

const COLLECTION_REVIEW_GENERIC_TOKENS = Object.freeze(new Set([
  'a',
  'an',
  'and',
  'by',
  'candidate',
  'capability',
  'content',
  'for',
  'from',
  'list',
  'navigate',
  'open',
  'page',
  'pages',
  'policy',
  'public',
  'query',
  'read',
  'site',
  'to',
  'use',
  'view',
  'with',
]));

function collectionReviewBucket() {
  return {
    collected: [],
    missing: [],
  };
}

function collectionReviewLabel(value) {
  const text = String(value ?? '').trim();
  if (/^https?:\/\//iu.test(text)) {
    return firstWords(sanitizeEvidenceRef(text) ?? 'route-template', 120);
  }
  return firstWords(text
    .replace(/^policy-(?:family|intent)-/u, '')
    .replace(/[-_]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim(), 120);
}

function collectionReviewTokens(value) {
  return normalizeCapabilityId(value)
    .split('-')
    .filter((token) => token.length > 1);
}

function collectionReviewDistinctiveTokens(value) {
  const tokens = collectionReviewTokens(value);
  const distinctive = tokens.filter((token) => !COLLECTION_REVIEW_GENERIC_TOKENS.has(token));
  return distinctive.length ? distinctive : tokens;
}

function collectionReviewSignalCovers(value, signals) {
  const target = normalizeCapabilityId(value);
  if (!target) {
    return false;
  }
  const normalizedSignals = signals
    .map(normalizeCapabilityId)
    .filter(Boolean);
  if (normalizedSignals.some((signal) => signal === target || signal.includes(target) || target.includes(signal))) {
    return true;
  }
  const targetTokens = collectionReviewDistinctiveTokens(target);
  return normalizedSignals.some((signal) => {
    const signalTokens = new Set(collectionReviewTokens(signal));
    return targetTokens.some((token) => signalTokens.has(token));
  });
}

function addCollectionReviewItem(bucket, status, item) {
  const list = status === 'missing' ? bucket.missing : bucket.collected;
  const normalizedId = normalizeCapabilityId(item.id ?? item.label);
  if (!normalizedId) {
    return;
  }
  if (list.some((existing) => existing.id === normalizedId)) {
    return;
  }
  const next = {
    id: normalizedId,
    label: collectionReviewLabel(item.label ?? item.id),
    status,
    source: item.source ?? null,
    reasonCode: item.reasonCode ?? null,
    reason: item.reason ? firstWords(item.reason, 180) : null,
    evidenceRefs: uniqueSortedStrings((item.evidenceRefs ?? [])
      .map((ref) => sanitizeEvidenceRef(ref))
      .filter(Boolean)),
    evidence_status: item.evidenceStatus ?? 'observed_sanitized',
    saved_material: SANITIZED_SUMMARY_ONLY,
    raw_content_saved: false,
    private_content_saved: false,
    requiresUserGrant: item.requiresUserAuthorization === true,
    requiresCapabilityEvidence: item.requiresCapabilityEvidence === true,
    rawMaterialPersisted: false,
  };
  for (const [key, value] of Object.entries(item.extra ?? {})) {
    if (value !== undefined) {
      next[key] = value;
    }
  }
  list.push(next);
}

function finalizeCollectionReviewBucket(bucket) {
  const sortEntries = (entries) => entries.sort((left, right) => (
    `${left.label}:${left.id}`.localeCompare(`${right.label}:${right.id}`, 'en')
  ));
  return {
    collected: sortEntries(bucket.collected),
    missing: sortEntries(bucket.missing),
  };
}

function collectionReviewVerifiedProofs(userAuthorizedEvidence = null) {
  return normalizeUserAuthorizedCapabilityProofs(userAuthorizedEvidence?.capabilityProofs);
}

function collectionReviewProofCovers(value, proofs) {
  const target = normalizeCapabilityId(value);
  return proofs.some((proof) => [
    proof.capabilityId,
    proof.setupCapabilityId,
    proof.intentType,
    proof.action,
  ].map(normalizeCapabilityId).some((id) => id && (id === target || id.includes(target) || target.includes(id))));
}

function collectionReviewPolicyCapabilities(knownSitePolicy, userAuthorizedEvidence = null) {
  if (!knownSitePolicy) {
    return [];
  }
  const knownPolicyCapabilities = knownPolicyRecommendedCapabilities(knownSitePolicy, {
    userAuthorized: true,
    userAuthorizedEvidence,
  });
  const genericCapabilities = [
    ...(knownSitePolicy.capabilityFamilies ?? []).map((family) => ({
      id: family,
      name: collectionReviewLabel(family),
      reason: 'Known site policy declares this capability family; setup must collect matching evidence before activation.',
      safety: 'read_only',
      recommended: false,
      status: 'candidate',
      evidenceRequirement: 'policy-evidence',
      disabledReason: 'policy-evidence-required',
      policyValue: family,
    })),
    ...(knownSitePolicy.downloadTaskTypes ?? []).map((taskType) => ({
      id: `download-${taskType}`,
      name: collectionReviewLabel(`download ${taskType}`),
      reason: 'Known site policy declares this download task type; downloader activation requires a separate bounded evidence path.',
      safety: 'requires_confirmation',
      recommended: false,
      status: 'candidate',
      evidenceRequirement: 'policy-evidence',
      disabledReason: 'policy-evidence-required',
      policyValue: taskType,
    })),
  ];
  const byId = new Map();
  for (const capability of [...knownPolicyCapabilities, ...genericCapabilities]) {
    const id = normalizeCapabilityId(capability.id ?? capability.name);
    if (!id || byId.has(id)) {
      continue;
    }
    byId.set(id, capability);
  }
  return [...byId.values()];
}

function collectionReviewCapabilityEvidenceStatus(setupPlan, capability, collectedSignals, proofs) {
  const id = capability.id ?? capability.name;
  const requiresCapabilityEvidence = capability.evidenceRequirement === 'capability-specific-evidence';
  const verified = collectionReviewProofCovers(id, proofs) || hasVerifiedCapabilityProof(setupPlan, capability);
  const coveredBySignal = collectionReviewSignalCovers(id, collectedSignals);
  if (verified) {
    return {
      collected: true,
      reasonCode: null,
      requiresCapabilityEvidence,
    };
  }
  if (requiresCapabilityEvidence) {
    return {
      collected: false,
      reasonCode: 'capability-specific-evidence-required',
      requiresCapabilityEvidence: true,
    };
  }
  if (capability.recommended === true || capability.status === 'recommended' || coveredBySignal) {
    return {
      collected: true,
      reasonCode: null,
      requiresCapabilityEvidence: false,
    };
  }
  return {
    collected: false,
    reasonCode: capability.disabledReason ?? setupPlan?.buildReadiness?.reasonCode ?? 'policy-evidence-required',
    requiresCapabilityEvidence,
  };
}

export function buildCollectionReviewModel({
  setupPlan = {},
  userAuthorizedEvidence = setupPlan?.userAuthorizedEvidence ?? null,
  knownSitePolicy = setupPlan?.knownSitePolicy ?? null,
} = {}) {
  const buckets = Object.fromEntries(COLLECTION_REVIEW_KINDS.map((kind) => [kind, collectionReviewBucket()]));
  const proofs = collectionReviewVerifiedProofs(userAuthorizedEvidence);
  const collectedSignals = [];
  const addSignal = (...values) => {
    collectedSignals.push(...values.filter(Boolean));
  };

  for (const group of setupPlan.pageGroups ?? []) {
    if (Number(group?.count ?? 0) < 1) {
      continue;
    }
    addCollectionReviewItem(buckets.nodes, 'collected', {
      id: `page-group-${group.id}`,
      label: group.name ?? group.id,
      source: 'setup-plan-page-group',
      evidenceRefs: group.sampleUrls ?? [],
      extra: {
        count: Number(group.count ?? 0),
        groupId: group.id ?? null,
      },
    });
    addCollectionReviewItem(buckets.affordances, 'collected', {
      id: `navigate-${group.id}`,
      label: `Navigate ${group.name ?? group.id}`,
      source: 'setup-plan-page-group',
      evidenceRefs: group.sampleUrls ?? [],
      extra: {
        affordanceType: 'navigation',
        groupId: group.id ?? null,
      },
    });
    addSignal(group.id, group.name, ...(group.sampleLabels ?? []));
    for (const sampleUrl of group.sampleUrls ?? []) {
      addCollectionReviewItem(buckets.seeds, 'collected', {
        id: `setup-page-${sampleUrl}`,
        label: sampleUrl,
        source: 'setup-plan-page-sample',
        evidenceRefs: [sampleUrl],
        extra: {
          url: sampleUrl,
          groupId: group.id ?? null,
        },
      });
      addSignal(sampleUrl);
    }
  }

  for (const page of userAuthorizedEvidence?.pages ?? []) {
    const pageUrl = page.normalizedUrl ?? page.url;
    addCollectionReviewItem(buckets.seeds, 'collected', {
      id: `user-authorized-page-${pageUrl}`,
      label: pageUrl,
      source: 'user-authorized-browser-page',
      evidenceRefs: [pageUrl].filter(Boolean),
      requiresUserAuthorization: true,
      extra: {
        url: pageUrl ?? null,
      },
    });
    addCollectionReviewItem(buckets.nodes, 'collected', {
      id: `user-authorized-node-${pageUrl}`,
      label: page.title ?? pageUrl ?? 'User-authorized browser page',
      source: 'user-authorized-browser-page',
      evidenceRefs: [pageUrl].filter(Boolean),
      requiresUserAuthorization: true,
      extra: {
        nodeType: 'user-authorized-page',
        url: pageUrl ?? null,
      },
    });
    addSignal(pageUrl, page.title, page.textSummary);
  }

  for (const seed of userAuthorizedEvidence?.browserSeeds ?? []) {
    const seedUrl = seed.normalizedUrl ?? seed.url;
    const capabilityIds = uniqueSortedStrings([
      ...(seed.capabilityIds ?? []),
      seed.capabilityId,
      seed.setupCapabilityId,
      seed.intentType,
      seed.action,
    ].map(normalizeCapabilityId).filter(Boolean));
    addCollectionReviewItem(buckets.seeds, 'collected', {
      id: `user-authorized-seed-${seed.routeKind || seed.seedType}-${seedUrl}`,
      label: `${seed.routeKind || seed.seedType || 'authorized route'} ${seedUrl ?? ''}`,
      source: seed.source ?? 'user-authorized-browser-seed',
      evidenceRefs: [seedUrl].filter(Boolean),
      requiresUserAuthorization: true,
      extra: {
        url: seedUrl ?? null,
        routeKind: seed.routeKind ?? null,
        seedType: seed.seedType ?? null,
        capabilityIds,
        visibleItemCount: Number(seed.visibleItemCount ?? 0) || 0,
      },
    });
    addCollectionReviewItem(buckets.affordances, 'collected', {
      id: `authorized-route-${seed.routeKind || seed.seedType || seedUrl}`,
      label: seed.routeKind || seed.seedType || 'authorized route',
      source: seed.source ?? 'user-authorized-browser-seed',
      evidenceRefs: [seedUrl].filter(Boolean),
      requiresUserAuthorization: true,
      extra: {
        affordanceType: 'authorized-route',
        capabilityIds,
        visibleItemCount: Number(seed.visibleItemCount ?? 0) || 0,
      },
    });
    if (Number(seed.visibleItemCount ?? 0) < 1 && capabilityIds.length) {
      for (const capabilityId of capabilityIds) {
        addCollectionReviewItem(buckets.nodes, 'missing', {
          id: `authorized-content-${capabilityId}`,
          label: capabilityId,
          source: seed.source ?? 'user-authorized-browser-seed',
          reasonCode: 'authorized-route-seed-only',
          reason: 'A bounded authorized route seed exists, but setup has not collected visible item evidence for this capability.',
          requiresUserAuthorization: true,
          requiresCapabilityEvidence: true,
          evidenceRefs: [seedUrl].filter(Boolean),
        });
      }
    }
    addSignal(seedUrl, seed.routeKind, seed.seedType, ...capabilityIds);
  }

  const autoDiscoverySummary = userAuthorizedEvidence?.autoDiscovery?.summary;
  if (autoDiscoverySummary) {
    addCollectionReviewItem(buckets.nodes, 'collected', {
      id: 'auto-discovery-structure-summary',
      label: 'auto discovery structure summary',
      source: userAuthorizedEvidence.autoDiscovery?.source ?? 'auto-discovery',
      requiresUserAuthorization: true,
      extra: {
        nodeType: 'auto-discovery-summary',
        nodesTotal: Number(autoDiscoverySummary.nodes_total ?? 0) || 0,
        routeTemplates: Number(autoDiscoverySummary.route_templates ?? 0) || 0,
        evidenceStatus: autoDiscoverySummary.evidenceStatus ?? 'modeled_structure',
      },
    });
    addCollectionReviewItem(buckets.affordances, 'collected', {
      id: 'auto-discovery-actionable-summary',
      label: 'auto discovery actionable summary',
      source: userAuthorizedEvidence.autoDiscovery?.source ?? 'auto-discovery',
      requiresUserAuthorization: true,
      extra: {
        affordanceType: 'auto-discovery-summary',
        actionableElements: Number(autoDiscoverySummary.actionable_elements ?? 0) || 0,
        evidenceStatus: autoDiscoverySummary.evidenceStatus ?? 'modeled_structure',
      },
    });
    addSignal('auto-discovery', 'route-template', 'spa-state', 'structure-summary');
  }

  for (const proof of proofs) {
    const proofIds = uniqueSortedStrings([
      proof.capabilityId,
      proof.setupCapabilityId,
      proof.intentType,
      proof.action,
    ].map(normalizeCapabilityId).filter(Boolean));
    for (const proofId of proofIds) {
      addCollectionReviewItem(buckets.affordances, 'collected', {
        id: `capability-proof-${proofId}`,
        label: proofId,
        source: proof.source ?? 'user-authorized-capability-proof',
        requiresUserAuthorization: true,
        requiresCapabilityEvidence: true,
        extra: {
          affordanceType: 'capability-proof',
          evidenceType: proof.evidenceType,
          sampleCount: proof.sampleCount,
        },
      });
      addSignal(proofId, proof.evidenceType, proof.source);
    }
  }

  const expectedCapabilities = [
    ...(setupPlan.recommendedCapabilities ?? []),
    ...collectionReviewPolicyCapabilities(knownSitePolicy, userAuthorizedEvidence),
  ];
  const seenCapabilities = new Set();
  for (const capability of expectedCapabilities) {
    const id = normalizeCapabilityId(capability.id ?? capability.name);
    if (!id || seenCapabilities.has(id)) {
      continue;
    }
    seenCapabilities.add(id);
    const evidenceStatus = collectionReviewCapabilityEvidenceStatus(setupPlan, capability, collectedSignals, proofs);
    const targetStatus = evidenceStatus.collected ? 'collected' : 'missing';
    addCollectionReviewItem(buckets.capabilities, targetStatus, {
      id,
      label: capability.name ?? capability.id,
      source: capability.policyValue ? 'known-site-policy' : 'setup-plan-recommendation',
      reasonCode: evidenceStatus.reasonCode,
      reason: evidenceStatus.reasonCode ? capability.reason : null,
      requiresUserAuthorization: capability.evidenceRequirement === 'capability-specific-evidence',
      requiresCapabilityEvidence: evidenceStatus.requiresCapabilityEvidence,
      extra: {
        safety: capability.safety ?? null,
        recommended: capability.recommended === true,
        evidenceRequirement: capability.evidenceRequirement ?? null,
        policyValue: capability.policyValue ?? null,
      },
    });
    if (evidenceStatus.collected) {
      addSignal(id, capability.name, capability.policyValue);
    }
  }

  const expectedIntents = uniqueSortedStrings([
    ...(knownSitePolicy?.supportedIntents ?? []),
    ...proofs.flatMap((proof) => [proof.intentType, proof.action]),
    ...(setupPlan.recommendedCapabilities ?? [])
      .filter((capability) => capability.recommended === true)
      .map((capability) => capability.id ?? capability.name),
  ].map(normalizeCapabilityId).filter(Boolean));
  for (const intent of expectedIntents) {
    const proofed = collectionReviewProofCovers(intent, proofs);
    const covered = proofed || collectionReviewSignalCovers(intent, collectedSignals);
    addCollectionReviewItem(buckets.intents, covered ? 'collected' : 'missing', {
      id: intent,
      label: intent,
      source: proofed ? 'user-authorized-capability-proof' : 'known-site-policy',
      reasonCode: covered ? null : (
        userAuthorizedEvidence?.status === 'captured'
          ? 'capability-specific-evidence-required'
          : setupPlan.buildReadiness?.reasonCode ?? 'policy-intent-not-collected'
      ),
      reason: covered ? null : 'Known site policy or user request advertises this intent, but setup has not collected matching sanitized evidence.',
      requiresUserAuthorization: Boolean(knownSitePolicy),
      requiresCapabilityEvidence: !covered,
    });
  }

  if (buckets.seeds.collected.length === 0) {
    addCollectionReviewItem(buckets.seeds, 'missing', {
      id: 'setup-page-evidence',
      label: 'setup page evidence',
      source: 'setup-readiness',
      reasonCode: setupPlan.buildReadiness?.reasonCode ?? 'setup-no-page-evidence',
      reason: setupPlan.buildReadiness?.reason ?? 'Setup did not collect public page or bounded user-authorized evidence.',
    });
  }
  for (const excludedUrl of setupPlan.evidenceQuality?.robotsExcludedPageEvidenceUrls ?? []) {
    addCollectionReviewItem(buckets.seeds, 'missing', {
      id: `robots-excluded-${excludedUrl}`,
      label: excludedUrl,
      source: 'robots.txt',
      reasonCode: 'robots-disallowed',
      reason: 'robots.txt excluded this candidate setup seed; SiteForge did not crawl it.',
      evidenceRefs: [excludedUrl],
    });
  }
  if (
    knownSitePolicy
    && userAuthorizedEvidence?.status !== 'captured'
    && knownPolicyAllowsUserAuthorizedSetup(knownSitePolicy)
  ) {
    addCollectionReviewItem(buckets.seeds, 'missing', {
      id: 'user-authorized-browser-evidence',
      label: 'user-authorized browser evidence',
      source: 'known-site-policy',
      reasonCode: 'user-authorized-evidence-required',
      reason: 'Known site policy allows a bounded user-authorized setup path, but no sanitized browser evidence was collected.',
      requiresUserAuthorization: true,
    });
  }

  const finalized = Object.fromEntries(Object.entries(buckets)
    .map(([kind, bucket]) => [kind, finalizeCollectionReviewBucket(bucket)]));
  return {
    schemaVersion: SETUP_ASSISTANT_SCHEMA_VERSION,
    artifactFamily: 'siteforge-collection-review',
    buildId: setupPlan.buildId ?? null,
    siteId: setupPlan.site?.id ?? null,
    knownSitePolicy: knownSitePolicy ? {
      status: knownSitePolicy.status ?? null,
      siteKey: knownSitePolicy.siteKey ?? null,
      adapterId: knownSitePolicy.adapterId ?? null,
      sources: clone(knownSitePolicy.sources ?? []),
    } : null,
    userAuthorizedEvidence: userAuthorizedEvidence ? {
      status: userAuthorizedEvidence.status ?? null,
      pageCount: userAuthorizedEvidence.pages?.length ?? 0,
      browserSeedCount: userAuthorizedEvidence.browserSeeds?.length ?? 0,
      capabilityProofCount: proofs.length,
      sessionMaterialPersisted: userAuthorizedEvidence.sessionMaterialPersisted === true,
      browserProfilePersisted: userAuthorizedEvidence.browserProfilePersisted === true,
      rawHtmlPersisted: userAuthorizedEvidence.rawHtmlPersisted === true,
    } : null,
    safetyBoundary: 'Collection review uses sanitized setup summaries only; it does not persist sensitive browser or session material, and it does not bypass robots, login, or access controls.',
    summary: Object.fromEntries(COLLECTION_REVIEW_KINDS.map((kind) => [kind, {
      collected: finalized[kind].collected.length,
      missing: finalized[kind].missing.length,
    }])),
    ...finalized,
  };
}

export const createCollectionReviewModel = buildCollectionReviewModel;

export async function generateSetupPlan(inputUrl, options = {}) {
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
  const warnings = [];
  const knownSitePolicy = await readKnownSitePolicy(paths);
  if (knownSitePolicy) {
    warnings.push(`known site policy loaded for ${knownSitePolicy.siteKey ?? knownSitePolicy.host}; user choices cannot bypass adapter or evidence constraints.`);
  }
  const sourceDiagnostics = [];
  const pages = [];
  const forms = [];
  const sitemapUrls = new Set();
  const robotsExcludedUrls = [];
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
  setupPlan.collectionReview = buildCollectionReviewModel({ setupPlan });
  await ensureDir(paths.artifactDir);
  await ensureDir(path.dirname(paths.setupPlanPath));
  await writeJsonFile(paths.setupPlanPath, setupPlan);
  return { paths, setupPlan };
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

function applyBuildModeChoiceOverrides(userChoices, options = {}) {
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

function createBuildProfile(setupPlan, userChoices, capabilityHints, paths) {
  const selectedCapabilities = capabilityHints.recommendedCapabilities.filter((capability) => capability.selected);
  const buildable = setupPlan.buildReadiness?.buildable !== false;
  const profile = {
    schemaVersion: SETUP_ASSISTANT_SCHEMA_VERSION,
    artifactFamily: 'siteforge-build-profile',
    buildSchemaVersion: BUILD_SCHEMA_VERSION,
    site: clone(setupPlan.site),
    createdAt: paths.generatedAt,
    updatedAt: new Date().toISOString(),
    source: 'setup-assistant',
    setupConfiguration: normalizeSetupConfiguration(userChoices.setupConfiguration),
    scope: clone(userChoices.scope),
    knownSitePolicy: clone(setupPlan.knownSitePolicy ?? null),
    sourceDiagnostics: clone(setupPlan.sourceDiagnostics ?? []),
    evidenceQuality: clone(setupPlan.evidenceQuality ?? null),
    buildReadiness: clone(setupPlan.buildReadiness ?? null),
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
  await ensureSiteWorkspace(paths.workspace, paths.site, { nowIso: paths.generatedAt });
  await ensureDir(paths.artifactDir);
  await ensureDir(paths.siteArtifactDir);
  await ensureDir(path.dirname(paths.buildProfilePath));
  await writeJsonFile(paths.setupPlanPath, setupPlan);
  await writeJsonFile(paths.userChoicesPath, userChoices);
  await writeJsonFile(paths.capabilityHintsPath, capabilityHints);
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
  const profileSnapshot = {
    ...profile,
    updatedAt: new Date().toISOString(),
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
  await ensureSiteWorkspace(paths.workspace, paths.site, { nowIso: paths.generatedAt });
  await ensureDir(paths.artifactDir);
  await ensureDir(path.dirname(paths.buildProfilePath));
  await writeJsonFile(paths.userChoicesPath, userChoices);
  await writeJsonFile(paths.capabilityHintsPath, capabilityHints);
  await writeJsonFile(paths.buildProfilePath, profileSnapshot);
  return { userChoices, capabilityHints, profile: profileSnapshot };
}

function writeSetupLine(options, line = '') {
  const output = options.setupOutput ?? defaultStdout;
  output.write(`${line}\n`);
}

function compactSetupCell(value, maxLength = 56) {
  const text = String(value ?? '-')
    .replace(/\r?\n/gu, ' ')
    .replace(/\s+/gu, ' ')
    .replace(/\|/gu, '/')
    .trim();
  if (!text) return '-';
  const chars = [...text];
  if (chars.length <= maxLength) return text;
  return `${chars.slice(0, Math.max(0, maxLength - 1)).join('')}…`;
}

function writeSetupTable(options, columns, rows) {
  writeSetupLine(options, `  | ${columns.map((column) => column.label).join(' | ')} |`);
  writeSetupLine(options, `  | ${columns.map(() => '---').join(' | ')} |`);
  const displayRows = rows.length ? rows : [Object.fromEntries(columns.map((column) => [column.key, '-']))];
  for (const row of displayRows) {
    writeSetupLine(options, `  | ${columns.map((column) => {
      const value = typeof column.value === 'function' ? column.value(row) : row[column.key];
      return compactSetupCell(value, column.maxLength ?? 56);
    }).join(' | ')} |`);
  }
}

function writeSetupTreeRow(options, left, right = '') {
  const leftText = String(left ?? '');
  const width = 34;
  const padding = Math.max(0, width - [...leftText].length);
  writeSetupLine(options, right ? `${leftText}${' '.repeat(padding)} │ ${right}` : leftText);
}

function canUseSetupTui(options = {}) {
  if (typeof options.setupPrompt === 'function' || options.setupTui === false) {
    return false;
  }
  const input = options.setupInput ?? defaultStdin;
  const output = options.setupOutput ?? defaultStdout;
  return Boolean(input?.isTTY && output?.isTTY && typeof input.setRawMode === 'function');
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
  const evidence = setupPlan.userAuthorizedEvidence;
  if (evidence?.status !== 'captured') {
    return null;
  }
  const seeds = Array.isArray(evidence.browserSeeds) ? evidence.browserSeeds : [];
  const pages = Array.isArray(evidence.pages) ? evidence.pages : [];
  const actionableElementCount = countAuthorizedActionableElements(evidence);
  const proofTargets = userAuthorizedProofTargetCapabilities(setupPlan);
  const collectedCapabilityIds = collectedUserAuthorizedCapabilityIds(setupPlan);
  const uncollectedCapabilities = proofTargets.filter((capability) => !collectedCapabilityIds.has(normalizeCapabilityId(capability.id)));
  const collectedIntentIds = new Set();
  const uncollectedIntentIds = new Set();
  for (const capability of proofTargets) {
    const descriptor = userAuthorizedCapabilityProofDescriptor(capability.id);
    const intentId = normalizeCapabilityId(descriptor?.intentType ?? capability.id);
    if (!intentId) {
      continue;
    }
    if (collectedCapabilityIds.has(normalizeCapabilityId(capability.id))) {
      collectedIntentIds.add(intentId);
    } else {
      uncollectedIntentIds.add(intentId);
    }
  }
  const rows = [
    {
      label: '页面入口',
      collectedCount: seeds.length,
      uncollectedCount: seeds.length > 0 ? 0 : 1,
      unit: '个',
      detail: seeds.length > 0 ? '已记录可访问入口，不保存页面正文' : '尚未获得可访问入口',
    },
    {
      label: '页面摘要',
      collectedCount: pages.length,
      uncollectedCount: pages.length > 0 ? 0 : 1,
      unit: '个',
      detail: pages.length > 0 ? '已记录页面级摘要' : '尚未获得页面级摘要',
    },
    {
      label: '可点击/可输入入口',
      collectedCount: actionableElementCount,
      uncollectedCount: actionableElementCount > 0 ? 0 : 1,
      unit: '个',
      detail: actionableElementCount > 0 ? '已记录入口数量，不保存控件明细' : '未保存原始页面结构或控件明细',
    },
    {
      label: '可用能力',
      collectedCount: collectedCapabilityIds.size,
      uncollectedCount: uncollectedCapabilities.length,
      unit: '项',
      detail: uncollectedCapabilities.length > 0 ? '未完成项需要你打开对应页面并提供可见数量或站内 URL' : '当前候选能力已有证明',
    },
    {
      label: '用户指令',
      collectedCount: collectedIntentIds.size,
      uncollectedCount: uncollectedIntentIds.size,
      unit: '项',
      detail: uncollectedIntentIds.size > 0 ? '未完成项不会进入可调用 Skill' : '当前用户指令已有证明',
    },
  ];
  const collectionReview = setupPlan.collectionReview ?? buildCollectionReviewModel({ setupPlan });
  const missingCapabilities = (collectionReview.capabilities?.missing ?? [])
    .filter((item) => userAuthorizedCapabilityProofDescriptor(item.id))
    .slice(0, 12)
    .map((item) => ({
      id: item.id,
      label: setupDisplayText(item.label ?? item.id),
      reasonCode: item.reasonCode ?? 'capability-specific-evidence-required',
    }));
  return {
    schemaVersion: SETUP_ASSISTANT_SCHEMA_VERSION,
    artifactFamily: 'siteforge-user-authorized-collection-review',
    status: rows.some((row) => row.uncollectedCount > 0) ? 'partial' : 'complete',
    rows,
    missingCapabilities,
    summary: {
      seedCount: seeds.length,
      nodeCount: pages.length,
      actionableElementCount,
      collectedCapabilityCount: collectedCapabilityIds.size,
      uncollectedCapabilityCount: uncollectedCapabilities.length,
      collectedIntentCount: collectedIntentIds.size,
      uncollectedIntentCount: uncollectedIntentIds.size,
      rawMaterialPersisted: false,
    },
  };
}

function renderUserAuthorizedCollectionReviewPrompt(review, options = {}) {
  if (!review) {
    return;
  }
  writeSetupLine(options, '');
  writeSetupLine(options, '采集现状');
  writeSetupLine(options, '  已复用你授权后的浏览器页面，只保存入口、摘要和数量，不保存账号、正文、cookie、token 或浏览器资料。');
  for (const row of review.rows) {
    writeSetupLine(
      options,
      `  - ${row.label}：已完成 ${row.collectedCount}${row.unit}；未完成 ${row.uncollectedCount}${row.unit}。${row.detail}。`,
    );
  }
  if (review.missingCapabilities?.length) {
    writeSetupLine(options, '');
    writeSetupLine(options, '未完成能力');
    writeSetupLine(options, '  | 能力 | 当前状态 | 需要你做什么 |');
    writeSetupLine(options, '  | --- | --- | --- |');
    for (const item of review.missingCapabilities) {
      writeSetupLine(
        options,
        `  | ${item.label} | 待确认 | 打开对应页面后提供站内页面地址，或填写看到的数量 |`,
      );
    }
  }
  writeSetupLine(options, '');
  writeSetupLine(options, '当前结论：已发现页面入口；还缺少部分能力的内容证明。未补齐的能力会保留为候选，不会自动启用。');
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

async function promptUserAuthorizedCollectionReview(setupPlan, options = {}) {
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
  const answer = await askSetupQuestion('是否现在补充确认未完成能力？按 Enter 或输入 no/否 跳过；输入 yes/y/是/继续 开始确认：', options);
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

function setupKnownAdapterLabel(setupPlan = {}) {
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

function setupKnownAdapterDisplayLabel(setupPlan = {}) {
  const policy = setupPlan.knownSitePolicy ?? {};
  if (policy.adapterId && policy.siteKey) {
    return `${policy.adapterId}（匹配：${policy.siteKey}）`;
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
    explicit_plus_candidates: '明确能力 + 低置信度候选',
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

function normalizeSetupConfiguration(configuration = {}) {
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

function renderCurrentSetupConfiguration(configuration, options = {}) {
  const normalized = normalizeSetupConfiguration(configuration);
  writeSetupLine(options, '当前配置');
  writeSetupTable(options, [
    { key: 'index', label: '#', maxLength: 4 },
    { key: 'item', label: '配置项', maxLength: 18 },
    { key: 'value', label: '当前值', maxLength: 64 },
  ], [
    { index: 1, item: '探索模式', value: setupConfigurationLabel('explorationMode', normalized.explorationMode) },
    { index: 2, item: '敏感能力', value: setupConfigurationLabel('sensitiveCapabilityStrategy', normalized.sensitiveCapabilityStrategy) },
    { index: 3, item: '扫描范围', value: setupConfigurationLabel('scanScope', normalized.scanScope) },
    { index: 4, item: '生成策略', value: setupGenerationStrategyLabel(normalized) },
    { index: 5, item: '写入方式', value: setupConfigurationLabel('writeMode', normalized.writeMode) },
  ]);
}

function renderSetupSafetyLimits(options = {}) {
  writeSetupLine(options, '安全限制');
  writeSetupTable(options, [
    { key: 'index', label: '#', maxLength: 4 },
    { key: 'rule', label: '限制', maxLength: 72 },
  ], [
    { index: 1, rule: '不提交表单' },
    { index: 2, rule: '不保存、删除、支付、发布或审批' },
    { index: 3, rule: '不修改权限、角色或系统配置' },
    { index: 4, rule: '敏感能力默认保持“需确认”' },
    { index: 5, rule: '写入前必须先通过验证门禁' },
  ]);
}

function renderSetupConfigurationMenu(options = {}) {
  writeSetupLine(options, '可修改配置');
  writeSetupTable(options, [
    { key: 'index', label: '#', maxLength: 4 },
    { key: 'item', label: '配置项', maxLength: 18 },
    { key: 'choices', label: '可选值', maxLength: 72 },
  ], [
    { index: 1, item: '探索模式', choices: '只读探索 / 安全交互 / 受控交互 / 手动引导' },
    { index: 2, item: '敏感能力策略', choices: '仅记录 / 有限启用 / 逐项确认 / 批量选择' },
    { index: 3, item: '扫描范围', choices: '全部入口 / 适配器入口 / 后台入口 / 手动选择 / 自定义范围' },
    { index: 4, item: '生成策略', choices: '默认 / 精简 / 标准 / 详细 / 自定义' },
    { index: 5, item: '写入方式', choices: '仅预览 / 写入草稿 / 更新 current/ / 更新 registry.json / 备份后更新' },
  ]);
}

function renderSetupOperationHelp(options = {}) {
  writeSetupLine(options, '操作说明');
  writeSetupTable(options, [
    { key: 'input', label: '输入', maxLength: 18 },
    { key: 'meaning', label: '作用', maxLength: 72 },
  ], [
    { input: 'Enter', meaning: '使用当前配置并开始' },
    { input: '1-5', meaning: '进入对应配置项修改' },
    { input: '项=值', meaning: '快速修改配置，例如 1=2' },
    { input: 'show', meaning: '重新显示当前配置' },
    { input: 'reset', meaning: '恢复默认配置' },
    { input: 'help', meaning: '查看可用命令' },
    { input: 'cancel', meaning: '取消并退出' },
  ]);
}

function renderSetupShortcutExamples(options = {}) {
  writeSetupLine(options, '快捷示例');
  writeSetupTable(options, [
    { key: 'input', label: '输入', maxLength: 18 },
    { key: 'effect', label: '效果', maxLength: 72 },
  ], [
    { input: '1=2', effect: '将探索模式改为“安全交互”' },
    { input: '2=4', effect: '将敏感能力策略改为“批量选择”' },
    { input: '3=5', effect: '输入自定义扫描范围' },
    { input: '5=1', effect: '仅预览，不写入' },
  ]);
}

function renderSetupConfigurationScreen(configuration, options = {}) {
  const normalized = normalizeSetupConfiguration(configuration);
  writeSetupLine(options, '准备开始自动构建');
  writeSetupLine(options, '');
  writeSetupLine(options, '操作：↑↓ 移动  Enter 展开/折叠  Space 确认  / 搜索');
  writeSetupLine(options, '提示：当前配置页可用编号或“项=值”快速修改；构建完成后进入动态能力树。');
  writeSetupLine(options, '');
  writeSetupTreeRow(options, '▼ 当前配置', '直接按 Enter 使用当前配置并开始');
  writeSetupTreeRow(options, `    [x] 1. 探索模式：${setupConfigurationLabel('explorationMode', normalized.explorationMode)}`);
  writeSetupTreeRow(options, `    [x] 2. 敏感能力：${setupConfigurationLabel('sensitiveCapabilityStrategy', normalized.sensitiveCapabilityStrategy)}`);
  writeSetupTreeRow(options, `    [x] 3. 扫描范围：${setupConfigurationLabel('scanScope', normalized.scanScope)}`);
  writeSetupTreeRow(options, `    [x] 4. 生成策略：${setupGenerationStrategyLabel(normalized)}`);
  writeSetupTreeRow(options, `    [x] 5. 写入方式：${setupConfigurationLabel('writeMode', normalized.writeMode)}`);
  writeSetupLine(options, '');
  writeSetupTreeRow(options, '▶ 安全限制', '不提交、不保存、不删除、不支付、不发布；敏感能力需确认');
  writeSetupTreeRow(options, '▶ 可修改配置', '1 探索模式 / 2 敏感能力 / 3 扫描范围 / 4 生成策略 / 5 写入方式');
  writeSetupTreeRow(options, '▶ 快捷示例', '1=2 安全交互；2=4 批量选择；3=5 自定义范围；5=1 仅预览');
  writeSetupTreeRow(options, '▶ 操作说明', 'Enter 开始；输入 项=值 快速修改；show 重显；reset 默认；help 命令；cancel 取消');
  writeSetupLine(options, '');
}

function setupTuiPad(value, width = 34) {
  const text = String(value ?? '');
  const length = [...text].length;
  if (length >= width) {
    return text;
  }
  return `${text}${' '.repeat(width - length)}`;
}

function setupTuiRow(left, right = '') {
  return right ? `${setupTuiPad(left)} │ ${right}` : left;
}

function isSetupTuiSpaceKey(key = {}) {
  return isTerminalSpaceKey(key);
}

function isSetupTuiSlashKey(key = {}) {
  return isTerminalSlashKey(key);
}

function isSetupTuiCharacterKey(key = {}, character) {
  return isTerminalCharacterKey(key, character);
}

function setupGenerationPreset(configuration) {
  const generation = normalizeSetupConfiguration(configuration).generationStrategy;
  if (generation.customGenerationHint !== undefined) {
    return 'custom';
  }
  if (
    generation.nodeGranularity === 'page'
    && generation.capabilityRecognition === 'explicit_only'
    && generation.lowConfidenceHandling === 'discard'
  ) {
    return 'compact';
  }
  if (
    generation.nodeGranularity === 'page_region_control'
    && generation.capabilityRecognition === 'infer_potential'
  ) {
    return 'detailed';
  }
  return 'standard';
}

function setupTuiFieldDefinitions() {
  return [
    {
      section: '1',
      label: '探索模式',
      get: (configuration) => normalizeSetupConfiguration(configuration).explorationMode,
      set: (configuration, value) => ({ ...configuration, explorationMode: value }),
      choices: [
        ['read_only', '只读探索'],
        ['safe_interaction', '安全交互'],
        ['controlled_interaction', '受控交互'],
        ['manual_guided', '手动引导'],
      ],
    },
    {
      section: '2',
      label: '敏感能力',
      get: (configuration) => normalizeSetupConfiguration(configuration).sensitiveCapabilityStrategy,
      set: (configuration, value) => ({ ...configuration, sensitiveCapabilityStrategy: value }),
      choices: [
        ['record_only', '仅记录，不启用'],
        ['limited_enable', '有限启用'],
        ['confirm_each', '逐项确认'],
        ['batch_select', '批量选择'],
      ],
    },
    {
      section: '3',
      label: '扫描范围',
      get: (configuration) => normalizeSetupConfiguration(configuration).scanScope,
      set: (configuration, value) => ({ ...configuration, scanScope: value }),
      choices: [
        ['all', '全部入口'],
        ['adapter', '适配器入口'],
        ['admin', '后台 / 管理相关入口'],
        ['manual', '手动选择入口'],
        ['custom', '自定义范围'],
      ],
    },
    {
      section: '4',
      label: '生成策略',
      get: setupGenerationPreset,
      set: (configuration, value) => {
        if (value === 'compact') {
          return {
            ...configuration,
            generationStrategy: {
              nodeGranularity: 'page',
              capabilityRecognition: 'explicit_only',
              lowConfidenceHandling: 'discard',
            },
          };
        }
        if (value === 'detailed') {
          return {
            ...configuration,
            generationStrategy: {
              nodeGranularity: 'page_region_control',
              capabilityRecognition: 'infer_potential',
              lowConfidenceHandling: 'manual_queue',
            },
          };
        }
        if (value === 'custom') {
          return {
            ...configuration,
            generationStrategy: {
              ...clone(DEFAULT_SETUP_CONFIGURATION.generationStrategy),
              customGenerationHint: configuration.generationStrategy?.customGenerationHint ?? '',
            },
          };
        }
        return {
          ...configuration,
          generationStrategy: clone(DEFAULT_SETUP_CONFIGURATION.generationStrategy),
        };
      },
      choices: [
        ['standard', '页面 + 区域级'],
        ['compact', '精简'],
        ['detailed', '详细'],
        ['custom', '自定义'],
      ],
    },
    {
      section: '5',
      label: '写入方式',
      get: (configuration) => normalizeSetupConfiguration(configuration).writeMode,
      set: (configuration, value) => ({ ...configuration, writeMode: value }),
      choices: [
        ['preview_only', '仅预览，不写入'],
        ['draft_only', '写入草稿 draft/'],
        ['current_only', '更新 current/，不更新 registry.json'],
        ['promote_verified', '验证通过后更新 current/ 和 registry.json'],
        ['backup_promote', '创建备份后更新 current/ 和 registry.json'],
      ],
    },
  ];
}

function setupTuiFieldValueLabel(field, configuration) {
  const value = field.get(configuration);
  return field.choices.find(([candidate]) => candidate === value)?.[1] ?? String(value ?? '-');
}

function cycleSetupTuiField(configuration, field, direction = 1) {
  const normalized = normalizeSetupConfiguration(configuration);
  const current = field.get(normalized);
  const index = Math.max(0, field.choices.findIndex(([value]) => value === current));
  const nextIndex = (index + direction + field.choices.length) % field.choices.length;
  return normalizeSetupConfiguration(field.set(normalized, field.choices[nextIndex][0]));
}

function setupTuiRows(configuration, ui) {
  const fields = setupTuiFieldDefinitions();
  const rows = [
    { type: 'section', id: 'config', title: '当前配置', right: 'Space 切换选中配置项' },
  ];
  if (ui.expanded.has('config')) {
    for (const field of fields) {
      rows.push({
        type: 'field',
        id: `field-${field.section}`,
        field,
        left: `    [ ] ${field.section}. ${field.label}：${setupTuiFieldValueLabel(field, configuration)}`,
        right: 'Enter 展开选项；Space 切换',
      });
      if (ui.expanded.has(`field-${field.section}`)) {
        for (const [value, label] of field.choices) {
          rows.push({
            type: 'choice',
            id: `choice-${field.section}-${value}`,
            field,
            value,
            left: `        ${field.get(configuration) === value ? '[x]' : '[ ]'} ${label}`,
            right: field.get(configuration) === value ? '当前值' : 'Space 选择',
          });
        }
      }
    }
  }
  rows.push({ type: 'section', id: 'safety', title: '安全限制', right: '不提交、不保存、不删除、不支付、不发布' });
  if (ui.expanded.has('safety')) {
    rows.push(
      { type: 'detail', left: '    - 不提交表单', right: '' },
      { type: 'detail', left: '    - 不保存、删除、支付、发布或审批', right: '' },
      { type: 'detail', left: '    - 不修改权限、角色或系统配置', right: '' },
      { type: 'detail', left: '    - 敏感能力默认保持“需确认”', right: '' },
      { type: 'detail', left: '    - 写入前必须先通过验证门禁', right: '' },
    );
  }
  rows.push({ type: 'section', id: 'commands', title: '操作说明', right: '↑↓ 移动；Enter 展开；Space 选择；/ 搜索' });
  if (ui.expanded.has('commands')) {
    rows.push(
      { type: 'detail', left: '    - 在“开始构建”上按 Enter：使用当前配置并开始', right: '' },
      { type: 'detail', left: '    - 输入 1-5：跳到对应配置项', right: '' },
      { type: 'detail', left: '    - r：恢复默认配置', right: '' },
      { type: 'detail', left: '    - /：搜索配置项', right: '' },
      { type: 'detail', left: '    - Esc 或 Ctrl+C：取消', right: '' },
    );
  }
  rows.push({ type: 'action', id: 'start', left: '✓ 开始构建', right: 'Enter 使用当前配置；Space 不会误开始' });
  if (!ui.search) {
    return rows;
  }
  const needle = ui.search.toLowerCase();
  return rows.filter((row) => {
    if (row.type === 'action') {
      return true;
    }
    const text = `${row.title ?? ''} ${row.left ?? ''} ${row.right ?? ''}`.toLowerCase();
    return text.includes(needle);
  });
}

function renderSetupConfigurationTui(configuration, ui) {
  const rows = setupTuiRows(configuration, ui);
  const lines = [
    '准备开始自动构建',
    '',
    '↑↓ 移动  Enter 展开/开始  Space 确认/切换  / 搜索  r 重置  Esc 取消',
    `搜索：${ui.searchMode ? `${ui.search}_` : (ui.search || '-')}`,
    '',
  ];
  rows.forEach((row, index) => {
    const focused = index === ui.focus ? '› ' : '  ';
    if (row.type === 'section') {
      const expanded = ui.expanded.has(row.id) ? '▼' : '▶';
      lines.push(setupTuiRow(`${focused}${expanded} ${row.title}`, row.right));
      return;
    }
    if (row.type === 'field') {
      const selected = index === ui.focus ? '[x]' : '[ ]';
      lines.push(setupTuiRow(`${focused}  ${selected} ${row.field.section}. ${row.field.label}：${setupTuiFieldValueLabel(row.field, configuration)}`, row.right));
      return;
    }
    if (row.type === 'choice') {
      lines.push(setupTuiRow(`${focused}${row.left}`, row.right));
      return;
    }
    lines.push(setupTuiRow(`${focused}${row.left}`, row.right));
  });
  lines.push('', '提示：非交互终端会回退为“选择：”文本模式。');
  return `${lines.join('\n')}\n`;
}

async function promptSetupConfigurationTui(options = {}, configuration = defaultSetupConfiguration()) {
  if (typeof options.setupPrompt === 'function' || options.setupTui === false) {
    return null;
  }
  const input = options.setupInput ?? defaultStdin;
  const output = options.setupOutput ?? defaultStdout;
  if (!input?.isTTY || !output?.isTTY || typeof input.setRawMode !== 'function') {
    return null;
  }
  let next = normalizeSetupConfiguration(configuration);
  let changed = false;
  const ui = {
    expanded: new Set(['config']),
    focus: 0,
    search: '',
    searchMode: false,
  };
  ui.focus = Math.max(0, setupTuiRows(next, ui).findIndex((row) => row.type === 'action' && row.id === 'start'));
  const terminal = enterTerminalTui(input, output);
  if (!terminal) {
    return null;
  }
  const render = () => {
    const rows = setupTuiRows(next, ui);
    if (ui.focus >= rows.length) {
      ui.focus = Math.max(0, rows.length - 1);
    }
    terminal.render(renderSetupConfigurationTui(next, ui));
  };
  render();
  try {
    for await (const key of readTerminalKeys(input)) {
      const rows = setupTuiRows(next, ui);
      if (key.ctrl && key.name === 'c') {
        throw setupCancelledError();
      }
      if (ui.searchMode) {
        if (isTerminalReturnKey(key)) {
          ui.searchMode = false;
        } else if (key.name === 'escape') {
          ui.searchMode = false;
          ui.search = '';
        } else if (key.name === 'backspace') {
          ui.search = [...ui.search].slice(0, -1).join('');
        } else if (key.text && [...key.text].length === 1 && !key.ctrl && !key.meta) {
          ui.search += key.text;
        }
        render();
        continue;
      }
      if (key.name === 'escape') {
        throw setupCancelledError();
      }
      if (isSetupTuiCharacterKey(key, 'q')) {
        return { configuration: next, changed };
      }
      if (key.name === 'up') {
        ui.focus = Math.max(0, ui.focus - 1);
      } else if (key.name === 'down') {
        ui.focus = Math.min(Math.max(0, rows.length - 1), ui.focus + 1);
      } else if (isTerminalReturnKey(key)) {
        const row = rows[ui.focus];
        if (row?.type === 'action') {
          return { configuration: next, changed };
        }
        if (row?.type === 'section') {
          if (ui.expanded.has(row.id)) {
            ui.expanded.delete(row.id);
          } else {
            ui.expanded.add(row.id);
          }
        } else if (row?.type === 'field') {
          const id = `field-${row.field.section}`;
          if (ui.expanded.has(id)) ui.expanded.delete(id);
          else ui.expanded.add(id);
        } else if (row?.type === 'choice') {
          next = normalizeSetupConfiguration(row.field.set(next, row.value));
          changed = true;
        }
      } else if (isSetupTuiSpaceKey(key)) {
        const row = rows[ui.focus];
        if (row?.type === 'field') {
          next = cycleSetupTuiField(next, row.field);
          changed = true;
        } else if (row?.type === 'choice') {
          next = normalizeSetupConfiguration(row.field.set(next, row.value));
          changed = true;
        }
      } else if (isSetupTuiSlashKey(key)) {
        ui.searchMode = true;
        ui.search = '';
      } else if (isSetupTuiCharacterKey(key, 'r')) {
        next = defaultSetupConfiguration();
        changed = true;
      } else if (/^[1-5]$/u.test(key.text ?? key.sequence ?? '')) {
        const wanted = key.text ?? key.sequence;
        const index = rows.findIndex((row) => row.type === 'field' && row.field.section === wanted);
        if (index >= 0) {
          ui.focus = index;
        }
      }
      render();
    }
  } finally {
    terminal.close();
  }
  return { configuration: next, changed };
}

async function completeSetupConfigurationCustomPrompts(configuration, options = {}) {
  let next = normalizeSetupConfiguration(configuration);
  if (next.scanScope === 'custom' && !next.customScopeHint) {
    const customScope = await askSetupQuestion('范围说明：', options);
    next = {
      ...next,
      customScopeHint: sanitizedSetupHint(customScope, requestedCapabilityFromHint(customScope)),
    };
  }
  if (next.generationStrategy?.customGenerationHint === '') {
    const customGeneration = await askSetupQuestion('生成策略说明：', options);
    next = {
      ...next,
      generationStrategy: {
        ...next.generationStrategy,
        customGenerationHint: sanitizedSetupHint(customGeneration, requestedCapabilityFromHint(customGeneration)),
      },
    };
  }
  return normalizeSetupConfiguration(next);
}

function renderSetupPlan(setupPlan, options = {}) {
  const configuration = defaultSetupConfiguration();
  renderSetupConfigurationScreen(configuration, options);
  if (setupPlan.buildReadiness?.buildable === false) {
    writeSetupLine(options, '当前不可构建');
    writeSetupLine(options, `  ! ${setupDisplayText(setupPlan.buildReadiness.reason)}`);
    for (const line of setupPlan.buildReadiness.guidance ?? []) {
      writeSetupLine(options, `  - ${setupDisplayText(line)}`);
    }
    writeSetupLine(options, '');
  }
  return;
}

function renderSavedProfileSummary(profile, options = {}) {
  const selectedCapabilities = profile.capabilityScope?.selectedCapabilities ?? [];
  writeSetupLine(options, 'SiteForge 已保存设置');
  writeSetupLine(options, `站点：${profile.site?.rootUrl ?? '-'}`);
  writeSetupLine(options, `范围：深度=${profile.scope?.maxDepth ?? '-'} 页面=${profile.scope?.maxPages ?? '-'} 种子=${profile.scope?.maxSeeds ?? '-'}`);
  writeSetupLine(options, `能力：${selectedCapabilities.map((capability) => setupDisplayText(capability.name)).join('，') || '公开页面'}`);
  writeSetupLine(options, '默认：复用已保存设置。');
  writeSetupLine(options, '');
}

async function askSetupQuestion(message, options = {}) {
  if (typeof options.setupPrompt === 'function') {
    return compactText(await options.setupPrompt(message));
  }
  const input = options.setupInput ?? defaultStdin;
  const output = options.setupOutput ?? defaultStdout;
  const rl = createReadlineInterface({ input, output });
  try {
    return compactText(await rl.question(message));
  } finally {
    rl.close();
  }
}

function selectedCapabilityProofTargets(userChoices) {
  return (userChoices.availableCapabilities ?? [])
    .filter((capability) => (
      capability?.selected === true
      && capability.evidenceRequirement === 'capability-specific-evidence'
      && userAuthorizedCapabilityProofDescriptor(capability.id)
    ));
}

function capabilityProofMatches(proof, capability) {
  const descriptor = userAuthorizedCapabilityProofDescriptor(capability.id ?? capability.name);
  const wanted = new Set([
    normalizeCapabilityId(capability.id ?? capability.name),
    normalizeCapabilityId(descriptor?.intentType),
    normalizeCapabilityId(descriptor?.action),
  ].filter(Boolean));
  return [
    proof.capabilityId,
    proof.setupCapabilityId,
    proof.intentType,
    proof.action,
  ].map(normalizeCapabilityId).some((id) => wanted.has(id));
}

function hasVerifiedCapabilityProof(setupPlan, capability) {
  return (setupPlan.userAuthorizedEvidence?.capabilityProofs ?? [])
    .some((proof) => proof?.status === 'verified'
      && Number(proof.sampleCount ?? 0) > 0
      && capabilityProofMatches(proof, capability));
}

function browserSeedMatchesCapability(seed, capability, descriptor) {
  if ([
    'user-authorized-normal-browser-route-seed',
    'known-site-authorized-route-expansion',
  ].includes(seed?.source)) {
    return false;
  }
  const wanted = new Set([
    normalizeCapabilityId(capability.id ?? capability.name),
    normalizeCapabilityId(descriptor?.intentType),
    normalizeCapabilityId(descriptor?.action),
  ].filter(Boolean));
  const seedIds = (seed.capabilityIds ?? []).map(normalizeCapabilityId).filter(Boolean);
  const route = `${seed.seedType ?? ''} ${seed.routeKind ?? ''} ${seed.normalizedUrl ?? ''}`.toLowerCase();
  const visibleItemCount = Number(seed.visibleItemCount ?? seed.articleLikeCount ?? seed.itemCount ?? seed.sampleCount ?? 0) || 0;
  const searchInputCount = Number(seed.searchInputCount ?? 0) || 0;
  const seedIdMatches = seedIds.some((id) => wanted.has(id));
  if (wanted.has('recommended-timeline-posts')) {
    return (seedIdMatches || /timeline|feed|\/home(?:[/?#]|$)/u.test(route)) && visibleItemCount > 0;
  }
  if (wanted.has('search-posts')) {
    return (seedIdMatches || searchInputCount > 0 || /search/u.test(route)) && visibleItemCount > 0;
  }
  if (wanted.has('list-profile-content')) {
    return (seedIdMatches || /profile|author|user/u.test(route)) && visibleItemCount > 0;
  }
  if (wanted.has('list-followed-users')) {
    return (seedIdMatches || /following/u.test(route)) && visibleItemCount > 0;
  }
  if (wanted.has('list-followed-updates')) {
    return (seedIdMatches || /following/u.test(route)) && visibleItemCount > 0;
  }
  if (
    wanted.has('list-notifications')
    || wanted.has('list-bookmarks')
    || wanted.has('list-lists')
    || wanted.has('list-direct-messages')
  ) {
    return seedIdMatches && visibleItemCount > 0;
  }
  return seedIdMatches && visibleItemCount > 0;
}

function capabilityProofsFromAuthorizedBrowserSeeds(setupPlan, capability) {
  const descriptor = userAuthorizedCapabilityProofDescriptor(capability.id ?? capability.name);
  if (!descriptor) {
    return [];
  }
  const proofs = [];
  for (const seed of setupPlan.userAuthorizedEvidence?.browserSeeds ?? []) {
    if (!browserSeedMatchesCapability(seed, capability, descriptor)) {
      continue;
    }
    const sampleCount = Math.max(1, Number(seed.visibleItemCount ?? seed.articleLikeCount ?? 0) || 0);
    proofs.push({
      setupCapabilityId: capability.id,
      intentType: descriptor.intentType,
      action: descriptor.action,
      status: 'verified',
      evidenceType: 'authorized-browser-seed-scan',
      sampleCount,
      source: seed.source ?? 'user-authorized-browser-seed-scan',
    });
  }
  return normalizeUserAuthorizedCapabilityProofs(proofs);
}

async function collectProofForCapability(setupPlan, userChoices, capability, options = {}) {
  const descriptor = userAuthorizedCapabilityProofDescriptor(capability.id);
  if (!descriptor) {
    return [];
  }
  const seedProofs = capabilityProofsFromAuthorizedBrowserSeeds(setupPlan, capability);
  if (seedProofs.length) {
    return seedProofs;
  }
  if (typeof options.capabilityProofProvider === 'function') {
    const provided = await options.capabilityProofProvider({
      setupPlan,
      userChoices,
      capability,
      descriptor,
      options,
    });
    const providedProofs = Array.isArray(provided) ? provided : [provided].filter(Boolean);
    const normalized = normalizeUserAuthorizedCapabilityProofs(providedProofs);
    if (normalized.length) {
      return normalized;
    }
  }
  if (options.disableManualCapabilityProofPrompt === true) {
    return [];
  }
  writeSetupLine(options, '');
  writeSetupLine(options, `确认能力：${setupDisplayText(capability.name)}`);
  writeSetupLine(options, '请只在已打开的正常浏览器里手动访问对应页面。SiteForge 不会自动提交表单，也不会采集正文、账号或会话材料。');
  if (options.skipCapabilityCollectionConfirmation !== true) {
    writeSetupLine(options, '默认安全：按 Enter 或输入 no/否 跳过。');
    const continueAnswer = await askSetupQuestion(
      `是否继续确认“${setupDisplayText(capability.name)}”？输入 yes/y/是/继续 才继续：`,
      options,
    );
    const continueDecision = parseContinueUncollectedCollectionAnswer(continueAnswer);
    if (!continueDecision.continue) {
      if (continueDecision.reasonCode === 'unrecognized') {
        writeSetupLine(options, '未识别为 yes/是/继续；已按安全默认值跳过补充确认。');
      }
      return [];
    }
  }
  writeSetupLine(options, '只保存能力名称、站内页面地址或数量；不要粘贴正文、账号、cookie、token、验证码、私信内容或其他私密内容。');
  const answer = await askSetupQuestion(descriptor.prompt, options);
  const evidenceInput = parseSupplementalCollectionEvidenceInput(answer, setupPlan.site);
  if (!evidenceInput.accepted || evidenceInput.sampleCount < 1) {
    if (evidenceInput.reasonCode !== 'empty') {
      writeSetupLine(options, `补充信息未被接受（${evidenceInput.reasonCode}）；已跳过该未抓取项。`);
    }
    return [];
  }
  return normalizeUserAuthorizedCapabilityProofs([{
    setupCapabilityId: capability.id,
    intentType: descriptor.intentType,
    action: descriptor.action,
    status: 'verified',
    evidenceType: evidenceInput.evidenceType,
    sampleCount: evidenceInput.sampleCount,
    source: evidenceInput.reasonCode === 'final-url'
      ? 'user-authorized-normal-browser-manual-final-url'
      : 'user-authorized-normal-browser-manual-proof',
  }]);
}

function mergeCapabilityProofsIntoSetupPlan(setupPlan, proofs) {
  const normalized = normalizeUserAuthorizedCapabilityProofs(proofs);
  if (!normalized.length || !setupPlan.userAuthorizedEvidence) {
    return setupPlan;
  }
  const existing = normalizeUserAuthorizedCapabilityProofs(setupPlan.userAuthorizedEvidence.capabilityProofs);
  const merged = [];
  const seen = new Set();
  for (const proof of [...existing, ...normalized]) {
    const key = [
      normalizeCapabilityId(proof.setupCapabilityId),
      normalizeCapabilityId(proof.intentType),
      normalizeCapabilityId(proof.action),
      proof.evidenceType,
    ].join('|');
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(proof);
  }
  const nextPlan = {
    ...setupPlan,
    userAuthorizedEvidence: {
      ...setupPlan.userAuthorizedEvidence,
      capabilityProofs: merged,
      evidenceBoundary: 'User authorization proves access to a bounded browser surface only; selected capabilities still require sanitized capability-specific proof and safety gates.',
    },
  };
  const proofedIds = new Set(merged.flatMap((proof) => [
    proof.capabilityId,
    proof.setupCapabilityId,
    proof.intentType,
    proof.action,
  ]).map(normalizeCapabilityId).filter(Boolean));
  nextPlan.recommendedCapabilities = (nextPlan.recommendedCapabilities ?? []).map((capability) => {
    const capabilityId = normalizeCapabilityId(capability.id ?? capability.name);
    if (
      capabilityId
      && proofedIds.has(capabilityId)
      && capability.evidenceRequirement === 'capability-specific-evidence'
      && capability.safety === 'read_only'
    ) {
      return {
        ...capability,
        recommended: true,
        status: 'recommended',
        disabledReason: null,
        reason: 'Capability-specific user-authorized evidence was collected during setup.',
      };
    }
    return capability;
  });
  nextPlan.collectionReview = buildCollectionReviewModel({
    setupPlan: nextPlan,
    userAuthorizedEvidence: nextPlan.userAuthorizedEvidence,
    knownSitePolicy: nextPlan.knownSitePolicy,
  });
  return nextPlan;
}

async function collectMissingCapabilityProofs(setupPlan, options = {}) {
  if (!setupPlan.userAuthorizedEvidence) {
    return setupPlan;
  }
  const targets = userAuthorizedProofTargetCapabilities(setupPlan)
    .filter((capability) => !hasVerifiedCapabilityProof(setupPlan, capability));
  if (!targets.length) {
    return setupPlan;
  }
  writeSetupLine(options, '');
  writeSetupLine(options, '开始补充确认。每一项都只需要站内页面地址或看到的数量；不需要的项直接按 Enter 跳过。');
  const collected = [];
  const userChoices = {
    availableCapabilities: targets.map((capability) => ({ ...capability, selected: true })),
    selectedCapabilityIds: targets.map((capability) => capability.id),
  };
  for (const capability of targets) {
    collected.push(...await collectProofForCapability(setupPlan, userChoices, capability, {
      ...options,
      skipCapabilityCollectionConfirmation: true,
    }));
  }
  return mergeCapabilityProofsIntoSetupPlan(setupPlan, collected);
}

async function collectSelectedCapabilityProofs(setupPlan, userChoices, options = {}) {
  if (!setupPlan.userAuthorizedEvidence) {
    return setupPlan;
  }
  const collected = [];
  for (const capability of selectedCapabilityProofTargets(userChoices)) {
    if (hasVerifiedCapabilityProof(setupPlan, capability)) {
      continue;
    }
    collected.push(...await collectProofForCapability(setupPlan, userChoices, capability, options));
  }
  return mergeCapabilityProofsIntoSetupPlan(setupPlan, collected);
}

function setupCancelledError() {
  const error = new Error('setup-cancelled: 用户取消了首次设置。');
  error.code = 'setup-cancelled';
  return error;
}

function isSetupCancelAnswer(answer) {
  return /^(?:cancel|取消|退出|quit|q)$/iu.test(compactText(answer));
}

function isSetupShowAnswer(answer) {
  return /^(?:show|显示|查看)$/iu.test(compactText(answer));
}

function isSetupResetAnswer(answer) {
  return /^(?:reset|重置|恢复默认)$/iu.test(compactText(answer));
}

function isSetupHelpAnswer(answer) {
  return /^(?:help|帮助|\?)$/iu.test(compactText(answer));
}

function parseSetupQuickConfigurationAnswer(answer) {
  const match = compactText(answer).match(/^([1-5])\s*=\s*([1-5])$/u);
  if (!match) {
    return null;
  }
  return {
    section: match[1],
    value: match[2],
  };
}

function isSetupConfigurationMenuAnswer(answer) {
  return /^[1-5]$/u.test(compactText(answer))
    || parseSetupQuickConfigurationAnswer(answer) !== null
    || isSetupCancelAnswer(answer)
    || isSetupShowAnswer(answer)
    || isSetupResetAnswer(answer)
    || isSetupHelpAnswer(answer);
}

function setupConfigurationStartPrompt() {
  return '选择：';
}

function setupConfigurationContinuePrompt() {
  return '选择：';
}

function renderExplorationModeMenu(options = {}) {
  writeSetupLine(options, '');
  writeSetupLine(options, '探索模式');
  writeSetupLine(options, '');
  writeSetupLine(options, '  1. 只读探索（默认）');
  writeSetupLine(options, '     仅读取页面、路由、结构和静态控件，不触发业务操作。');
  writeSetupLine(options, '');
  writeSetupLine(options, '  2. 安全交互');
  writeSetupLine(options, '     可点击导航、菜单、分页、筛选、标签页；不提交表单。');
  writeSetupLine(options, '');
  writeSetupLine(options, '  3. 受控交互');
  writeSetupLine(options, '     可探索低风险流程；敏感能力会暂停等待确认。');
  writeSetupLine(options, '');
  writeSetupLine(options, '  4. 手动引导');
  writeSetupLine(options, '     每发现新页面、新能力或不确定操作，先询问你。');
  writeSetupLine(options, '');
}

function renderSensitiveCapabilityStrategyMenu(options = {}) {
  writeSetupLine(options, '');
  writeSetupLine(options, '敏感能力策略');
  writeSetupLine(options, '');
  writeSetupLine(options, '  1. 仅记录，不启用（默认）');
  writeSetupLine(options, '     发现后写入能力清单，状态保持“需确认”。');
  writeSetupLine(options, '');
  writeSetupLine(options, '  2. 有限启用');
  writeSetupLine(options, '     允许读取页面和表单结构，但不提交、不保存、不确认。');
  writeSetupLine(options, '');
  writeSetupLine(options, '  3. 逐项确认');
  writeSetupLine(options, '     每发现一个敏感能力，都暂停询问。');
  writeSetupLine(options, '');
  writeSetupLine(options, '  4. 批量选择');
  writeSetupLine(options, '     扫描完成后展示敏感能力列表，由你批量确认。');
  writeSetupLine(options, '');
}

function renderScanScopeMenu(options = {}) {
  writeSetupLine(options, '');
  writeSetupLine(options, '扫描范围');
  writeSetupLine(options, '');
  writeSetupLine(options, '  1. 全部入口（默认）');
  writeSetupLine(options, '  2. 仅扫描已知适配器覆盖的入口');
  writeSetupLine(options, '  3. 仅扫描后台 / 管理相关入口');
  writeSetupLine(options, '  4. 手动选择入口');
  writeSetupLine(options, '  5. 输入自定义范围');
  writeSetupLine(options, '');
}

function renderGenerationStrategyMenu(options = {}) {
  writeSetupLine(options, '');
  writeSetupLine(options, '生成策略');
  writeSetupLine(options, '');
  writeSetupLine(options, '  1. 默认');
  writeSetupLine(options, '     页面 + 区域级节点；明确能力 + 低置信度候选。');
  writeSetupLine(options, '');
  writeSetupLine(options, '  2. 精简');
  writeSetupLine(options, '     页面级节点；仅识别明确能力；低置信度结果丢弃。');
  writeSetupLine(options, '');
  writeSetupLine(options, '  3. 标准');
  writeSetupLine(options, '     页面 + 区域级节点；明确能力 + 低置信度候选。');
  writeSetupLine(options, '');
  writeSetupLine(options, '  4. 详细');
  writeSetupLine(options, '     页面 + 区域 + 控件级节点；尽可能推断潜在能力。');
  writeSetupLine(options, '');
  writeSetupLine(options, '  5. 自定义');
  writeSetupLine(options, '     输入一句话描述节点粒度、能力识别或低置信度处理。');
  writeSetupLine(options, '');
}

function renderWriteModeMenu(options = {}) {
  writeSetupLine(options, '');
  writeSetupLine(options, '写入方式');
  writeSetupLine(options, '');
  writeSetupLine(options, '  1. 仅预览，不写入');
  writeSetupLine(options, '  2. 写入草稿 draft/');
  writeSetupLine(options, '  3. 更新 current/，不更新 registry.json');
  writeSetupLine(options, '  4. 更新 current/ 和 registry.json（默认）');
  writeSetupLine(options, '  5. 创建备份后更新 current/ 和 registry.json');
  writeSetupLine(options, '');
  writeSetupLine(options, '当前实现会始终先执行验证门禁；验证失败不会更新 current/ 或 registry.json。');
  writeSetupLine(options, '');
}

function selectionOrDefault(answer, defaultValue) {
  const text = compactText(answer);
  if (!text) return defaultValue;
  if (isSetupCancelAnswer(text)) throw setupCancelledError();
  return text;
}

async function updateSetupConfigurationSection(section, configuration, options = {}, presetAnswer = null) {
  const next = normalizeSetupConfiguration(configuration);
  if (section === '1') {
    if (presetAnswer === null) {
      renderExplorationModeMenu(options);
    }
    const answer = selectionOrDefault(
      presetAnswer ?? await askSetupQuestion('选择探索模式 [1/2/3/4]，默认 1：', options),
      '1',
    );
    const values = {
      1: 'read_only',
      2: 'safe_interaction',
      3: 'controlled_interaction',
      4: 'manual_guided',
    };
    if (values[answer]) next.explorationMode = values[answer];
  } else if (section === '2') {
    if (presetAnswer === null) {
      renderSensitiveCapabilityStrategyMenu(options);
    }
    const answer = selectionOrDefault(
      presetAnswer ?? await askSetupQuestion('选择敏感能力策略 [1/2/3/4]，默认 1：', options),
      '1',
    );
    const values = {
      1: 'record_only',
      2: 'limited_enable',
      3: 'confirm_each',
      4: 'batch_select',
    };
    if (values[answer]) next.sensitiveCapabilityStrategy = values[answer];
  } else if (section === '3') {
    if (presetAnswer === null) {
      renderScanScopeMenu(options);
    }
    const answer = selectionOrDefault(
      presetAnswer ?? await askSetupQuestion('扫描范围 [1/2/3/4/5]，默认 1：', options),
      '1',
    );
    const values = {
      1: 'all',
      2: 'adapter',
      3: 'admin',
      4: 'manual',
      5: 'custom',
    };
    if (values[answer]) next.scanScope = values[answer];
    if (answer === '5') {
      const customScope = await askSetupQuestion('范围说明：', options);
      next.customScopeHint = sanitizedSetupHint(customScope, requestedCapabilityFromHint(customScope));
    }
  } else if (section === '4') {
    if (presetAnswer === null) {
      renderGenerationStrategyMenu(options);
    }
    const answer = selectionOrDefault(
      presetAnswer ?? await askSetupQuestion('选择生成策略 [1/2/3/4/5]，默认 1：', options),
      '1',
    );
    if (answer === '2') {
      next.generationStrategy = {
        nodeGranularity: 'page',
        capabilityRecognition: 'explicit_only',
        lowConfidenceHandling: 'discard',
      };
    } else if (answer === '4') {
      next.generationStrategy = {
        nodeGranularity: 'page_region_control',
        capabilityRecognition: 'infer_potential',
        lowConfidenceHandling: 'manual_queue',
      };
    } else if (answer === '5') {
      const customGeneration = await askSetupQuestion('生成策略说明：', options);
      next.generationStrategy = {
        ...clone(DEFAULT_SETUP_CONFIGURATION.generationStrategy),
        customGenerationHint: sanitizedSetupHint(customGeneration, requestedCapabilityFromHint(customGeneration)),
      };
    } else {
      next.generationStrategy = clone(DEFAULT_SETUP_CONFIGURATION.generationStrategy);
    }
  } else if (section === '5') {
    if (presetAnswer === null) {
      renderWriteModeMenu(options);
    }
    const answer = selectionOrDefault(
      presetAnswer ?? await askSetupQuestion('写入方式 [1/2/3/4/5]，默认 4：', options),
      '4',
    );
    const values = {
      1: 'preview_only',
      2: 'draft_only',
      3: 'current_only',
      4: 'promote_verified',
      5: 'backup_promote',
    };
    if (values[answer]) next.writeMode = values[answer];
  }
  return normalizeSetupConfiguration(next);
}

function renderUpdatedSetupConfiguration(configuration, options = {}) {
  const normalized = normalizeSetupConfiguration(configuration);
  writeSetupLine(options, '');
  writeSetupLine(options, '已更新配置');
  writeSetupLine(options, `  探索模式：${setupConfigurationLabel('explorationMode', normalized.explorationMode)}`);
  writeSetupLine(options, `  敏感能力：${setupConfigurationLabel('sensitiveCapabilityStrategy', normalized.sensitiveCapabilityStrategy)}`);
  writeSetupLine(options, `  扫描范围：${setupConfigurationLabel('scanScope', normalized.scanScope)}`);
  writeSetupLine(options, `  生成策略：${setupGenerationStrategyLabel(normalized)}`);
  writeSetupLine(options, `  写入方式：${setupConfigurationLabel('writeMode', normalized.writeMode)}`);
  writeSetupLine(options, '');
}

async function promptAutomaticSetupConfiguration(options, choices, initialAnswer = null) {
  let nextChoices = applySetupConfigurationToChoices(choices);
  if (initialAnswer === null) {
    const tuiResult = await promptSetupConfigurationTui(options, nextChoices.setupConfiguration);
    if (tuiResult) {
      nextChoices.setupConfiguration = await completeSetupConfigurationCustomPrompts(tuiResult.configuration, options);
      nextChoices.acceptedDefaultRecommendation = tuiResult.changed !== true;
      return applySetupConfigurationToChoices(nextChoices);
    }
  }
  let answer = initialAnswer === null
    ? await askSetupQuestion(setupConfigurationStartPrompt(), options)
    : compactText(initialAnswer);
  while (true) {
    if (isSetupCancelAnswer(answer)) {
      throw setupCancelledError();
    }
    if (!answer) {
      nextChoices.acceptedDefaultRecommendation = nextChoices.acceptedDefaultRecommendation !== false;
      return applySetupConfigurationToChoices(nextChoices);
    }
    if (!isSetupConfigurationMenuAnswer(answer)) {
      const hintedChoices = applyHintToChoices(answer, nextChoices);
      hintedChoices.acceptedDefaultRecommendation = false;
      return applySetupConfigurationToChoices(hintedChoices);
    }
    if (isSetupShowAnswer(answer)) {
      writeSetupLine(options, '');
      renderCurrentSetupConfiguration(nextChoices.setupConfiguration, options);
      writeSetupLine(options, '');
      answer = await askSetupQuestion(setupConfigurationContinuePrompt(), options);
      continue;
    }
    if (isSetupResetAnswer(answer)) {
      nextChoices.setupConfiguration = defaultSetupConfiguration();
      nextChoices.acceptedDefaultRecommendation = true;
      renderUpdatedSetupConfiguration(nextChoices.setupConfiguration, options);
      answer = await askSetupQuestion(setupConfigurationContinuePrompt(), options);
      continue;
    }
    if (isSetupHelpAnswer(answer)) {
      writeSetupLine(options, '');
      renderSetupOperationHelp(options);
      writeSetupLine(options, '');
      renderSetupShortcutExamples(options);
      writeSetupLine(options, '');
      answer = await askSetupQuestion(setupConfigurationContinuePrompt(), options);
      continue;
    }
    const quickConfig = parseSetupQuickConfigurationAnswer(answer);
    if (quickConfig) {
      nextChoices.setupConfiguration = await updateSetupConfigurationSection(
        quickConfig.section,
        nextChoices.setupConfiguration,
        options,
        quickConfig.value,
      );
    } else {
      nextChoices.setupConfiguration = await updateSetupConfigurationSection(answer, nextChoices.setupConfiguration, options);
    }
    nextChoices.acceptedDefaultRecommendation = false;
    renderUpdatedSetupConfiguration(nextChoices.setupConfiguration, options);
    answer = await askSetupQuestion(setupConfigurationContinuePrompt(), options);
  }
}

async function promptFirstRunChoices(setupPlan, options = {}, mode = 'accept-recommended', initialAnswer = null, promptOptions = {}) {
  if (promptOptions.renderPlan !== false) {
    renderSetupPlan(setupPlan, options);
  }
  if (options.manual !== true) {
    const choices = defaultChoicesFromPlan(setupPlan, mode);
    return await promptAutomaticSetupConfiguration(options, choices, initialAnswer);
  }
  const defaultPrompt = options.manual === true
    ? '按 Enter 使用默认设置并开始构建；或输入你想要的能力/范围，例如“读取推荐时间线帖子”：'
    : '按 Enter 开始自动构建；如需限定范围，可输入一句话说明（可选）：';
  const answer = initialAnswer === null
    ? await askSetupQuestion(defaultPrompt, options)
    : compactText(initialAnswer);
  const choices = applyHintToChoices(answer, defaultChoicesFromPlan(setupPlan, mode));
  choices.acceptedDefaultRecommendation = answer.length === 0;
  return choices;
}

function buildOptionsFromProfile(options, paths, profile) {
  const scope = profile.scope ?? {};
  const safety = profile.safety ?? {};
  return {
    ...options,
    buildId: paths.buildId,
    cwd: paths.cwd,
    buildProfilePath: paths.buildProfilePath,
    savedBuildProfilePath: paths.savedBuildProfilePath,
    setupProfile: profile,
    maxDepth: options.maxDepth ?? scope.maxDepth,
    maxPages: options.maxPages ?? scope.maxPages,
    maxSeeds: options.maxSeeds ?? scope.maxSeeds,
    maxSitemaps: options.maxSitemaps ?? scope.maxSitemaps,
    renderJs: options.renderJs ?? scope.renderJs,
    captureNetwork: options.captureNetwork ?? scope.captureNetwork,
    submitForms: false,
    allowDestructiveActions: safety.allowDestructiveActions === true ? false : false,
    allowPayment: safety.allowPayment === true ? false : false,
    allowAccountMutation: safety.allowAccountMutation === true ? false : false,
    allowContactSubmit: safety.allowContactSubmit === true ? false : false,
    requestedCapabilities: (profile.capabilityScope?.selectedCapabilities ?? []).map((capability) => capability.name).filter(Boolean),
  };
}

function firstTimeSetupRequiredError(paths, setupPlan) {
  const error = new Error(
    `first-time-setup-required: ${setupPlan.site.rootUrl} 还没有已保存的 build_profile.json。` +
    `请先在交互式终端运行一次 siteforge build <url>，接受或编辑设置。` +
    `setup_plan.json 已写入 ${paths.setupPlanPath}`,
  );
  error.code = 'first-time-setup-required';
  error.artifactDir = paths.artifactDir;
  error.setupPlanPath = paths.setupPlanPath;
  return error;
}

function setupEvidenceNotBuildableError(paths, setupPlan) {
  const guidance = (setupPlan.buildReadiness?.guidance ?? []).map((line) => setupDisplayText(line)).join(' ');
  const error = new Error(
    `setup-evidence-not-buildable: SiteForge 没有找到足够的公开设置证据，站点为 ${setupPlan.site.rootUrl}。` +
    `${setupDisplayText(setupPlan.buildReadiness?.reason ?? '设置尚未就绪，不能构建。')} ` +
    `${guidance ? `${guidance} ` : ''}` +
    `setup_plan.json 已写入 ${paths.setupPlanPath}`,
  );
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

export async function prepareSiteForgeBuildSetup(inputUrl, options = {}) {
  const paths = buildSetupAssistantPaths(inputUrl, options);
  const interactive = resolveSetupInteractive(options);
  const savedProfileCandidate = await readJsonOrNull(paths.savedBuildProfilePath);
  const savedProfile = isUsableSavedBuildProfile(savedProfileCandidate) ? savedProfileCandidate : null;

  if (!savedProfile) {
    let { setupPlan } = await generateSetupPlan(inputUrl, { ...options, buildId: paths.buildId, cwd: paths.cwd });
    let setupReview = { continueUncollected: true, nextChoiceHint: null };
    let setupPlanRendered = false;
    const canUseKnownSiteAutoDiscovery = shouldAttemptUserAuthorizedSetup(setupPlan, options)
      && (
        (options.auto === true && interactive !== true)
        || (
          options.manual === true
          && typeof options.setupPrompt !== 'function'
          && defaultStdin.isTTY !== true
        )
      );
    if (!isSetupPlanBuildable(setupPlan) && canUseKnownSiteAutoDiscovery) {
      return await persistAutoAuthorizedKnownSiteProfile({
        inputUrl,
        paths,
        setupPlan,
        options,
        mode: options.manual === true ? 'manual-noninteractive-auto-discovery' : 'auto',
      });
    }
    if (!isSetupPlanBuildable(setupPlan)) {
      if (interactive && shouldAttemptUserAuthorizedSetup(setupPlan, options)) {
        const userAuthorizedEvidence = await collectUserAuthorizedEvidence({ inputUrl, setupPlan, paths, options });
        setupPlan = applyUserAuthorizedEvidenceToSetupPlan(setupPlan, userAuthorizedEvidence, paths);
        renderSetupPlan(setupPlan, options);
        setupPlanRendered = true;
        setupReview = await promptUserAuthorizedCollectionReview(setupPlan, options);
        setupPlan = setupReview.setupPlan;
        await writeJsonFile(paths.setupPlanPath, setupPlan);
      }
    }
    if (!isSetupPlanBuildable(setupPlan)) {
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
        buildOptions: buildOptionsFromProfile(options, paths, persisted.profile),
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
      buildOptions: buildOptionsFromProfile(options, paths, persisted.profile),
    };
  }

  if (interactive) {
    renderSavedProfileSummary(savedProfile, options);
    const answer = await askSetupQuestion('按 Enter 复用；输入“编辑”重新编辑；输入“重置”重置推荐：', options);
    if (/^(?:edit|e|编辑)$/iu.test(answer) || answer.length > 0 && !/^(?:reset|r|重置)$/iu.test(answer)) {
      let { setupPlan } = await generateSetupPlan(inputUrl, { ...options, buildId: paths.buildId, cwd: paths.cwd });
      let setupReview = { continueUncollected: true, nextChoiceHint: null };
      let setupPlanRendered = false;
      if (!isSetupPlanBuildable(setupPlan) && shouldAttemptUserAuthorizedSetup(setupPlan, options)) {
        const userAuthorizedEvidence = await collectUserAuthorizedEvidence({ inputUrl, setupPlan, paths, options });
        setupPlan = applyUserAuthorizedEvidenceToSetupPlan(setupPlan, userAuthorizedEvidence, paths);
        renderSetupPlan(setupPlan, options);
        setupPlanRendered = true;
        setupReview = await promptUserAuthorizedCollectionReview(setupPlan, options);
        setupPlan = setupReview.setupPlan;
        await writeJsonFile(paths.setupPlanPath, setupPlan);
      }
      if (!isSetupPlanBuildable(setupPlan)) {
        await persistUnbuildableSetupAndThrow({
          paths,
          setupPlan,
          options,
          mode: 'edit-saved-profile-unusable',
        });
      }
      let userChoices = answer && !/^(?:edit|e|编辑)$/iu.test(answer)
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
        buildOptions: buildOptionsFromProfile(options, paths, persisted.profile),
      };
    }
    if (/^(?:reset|r|重置)$/iu.test(answer)) {
      let { setupPlan } = await generateSetupPlan(inputUrl, { ...options, buildId: paths.buildId, cwd: paths.cwd });
      let setupReview = { continueUncollected: true, nextChoiceHint: null };
      let setupPlanRendered = false;
      if (!isSetupPlanBuildable(setupPlan) && shouldAttemptUserAuthorizedSetup(setupPlan, options)) {
        const userAuthorizedEvidence = await collectUserAuthorizedEvidence({ inputUrl, setupPlan, paths, options });
        setupPlan = applyUserAuthorizedEvidenceToSetupPlan(setupPlan, userAuthorizedEvidence, paths);
        renderSetupPlan(setupPlan, options);
        setupPlanRendered = true;
        setupReview = await promptUserAuthorizedCollectionReview(setupPlan, options);
        setupPlan = setupReview.setupPlan;
        await writeJsonFile(paths.setupPlanPath, setupPlan);
      }
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
        buildOptions: buildOptionsFromProfile(options, paths, persisted.profile),
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
