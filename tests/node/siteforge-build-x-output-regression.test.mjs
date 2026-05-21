import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { access, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import {
  renderSiteForgeBuildSummary,
  stableSiteIdFromUrl,
} from '../../src/app/pipeline/build/index.mjs';
import {
  CAPABILITY_ENABLEMENT_STATUSES,
  capabilityEnablementStatusCounts,
  isCallableEnablementStatus,
} from '../../src/app/pipeline/build/risk-policy.mjs';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIR, '..', '..');
const CLI_PATH = path.join(REPO_ROOT, 'src', 'entrypoints', 'cli', 'index.mjs');
const GOLDEN_DIR = path.join(REPO_ROOT, 'tests', 'golden');
const X_URL = 'https://x.com';

const DEFAULT_REQUIRED_TERMS = [
  '✓ 构建完成',
  '操作：↑↓ 移动',
  'Enter 展开/折叠',
  'Space 确认',
  '/ 搜索',
  '搜索：-',
  '能力统计',
  '自动探索',
  '待确认能力',
  '[ ]',
  '已禁用能力',
  '输出结果',
  '当前输出',
  '本地索引',
  '建议',
  '调试信息',
];

const DEFAULT_FORBIDDEN_PATTERNS = [
  /请粘贴最终 URL/u,
  /最终授权 URL/u,
  /输入可见条数/u,
  /逐项手动补采/u,
  /逐项补采/u,
  /已启用候选/u,
  /policy-evidence-required/u,
  /capability-specific-evidence-required/u,
  /脱敏网络接口候选/u,
  /原始\s*DOM|raw\s*DOM/iu,
  /原始\s*HTML|raw\s*HTML/iu,
  /cookie\s*值/iu,
  /token\s*值/iu,
  /authorization\s*header/iu,
];

const PRIVACY_FORBIDDEN_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~+/-]+=*/u,
  /\b(?:access_token|refresh_token|token|auth|api[_-]?key|secret|password)=(?!\[REDACTED\]|%5BREDACTED%5D)[^&\s;]+/iu,
  /\bcookie\s*[:=]\s*(?!\[REDACTED\]|%5BREDACTED%5D)[^;\s&]+/iu,
  /\bauthorization\s*[:=]\s*(?!\[REDACTED\]|%5BREDACTED%5D)[^\r\n]+/iu,
  /\bsession(?:[_-]?id|[_-]?ref)?\s*[:=]\s*(?!\[REDACTED\]|%5BREDACTED%5D)[A-Za-z0-9._~+/-]+/iu,
  /private\s+body/iu,
  /raw\s*(?:dom|html|body)\s*[:=]|原始\s*(?:DOM|HTML)\s*[：:]|raw\s*(?:DOM|HTML)\s*[:=]/iu,
  /<html[\s>]|<\/html>/iu,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu,
  /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/u,
  /\b1[3-9]\d{9}\b/u,
  /@[A-Za-z0-9_]{2,15}\b/u,
];

const ABSOLUTE_USER_PATH_PATTERNS = [
  /[A-Za-z]:[\\/]+Users[\\/]+/u,
  /\/Users\//u,
  /\/home\//u,
];

async function createWorkspace(t) {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-x-output-'));
  t.after(async () => {
    await rm(workspace, { recursive: true, force: true });
  });
  return workspace;
}

function runSiteforgeBuild(cwd, args, env = {}) {
  return spawnSync(process.execPath, [CLI_PATH, 'build', ...args], {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      FORCE_COLOR: '0',
      NO_COLOR: '1',
      PYTHONIOENCODING: 'utf-8',
      PYTHONUTF8: '1',
      ...env,
    },
  });
}

function assertBuildSucceeded(result) {
  assert.equal(
    result.status,
    0,
    [
      `expected command to exit 0, got ${result.status}`,
      result.stdout ? `stdout:\n${result.stdout}` : '',
      result.stderr ? `stderr:\n${result.stderr}` : '',
    ].filter(Boolean).join('\n\n'),
  );
}

async function pathExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function latestBuildDir(workspace) {
  const buildsDir = path.join(workspace, '.siteforge', 'sites', stableSiteIdFromUrl(X_URL), 'builds');
  const entries = await readdir(buildsDir, { withFileTypes: true });
  const buildIds = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right, 'en'));
  assert.equal(buildIds.length > 0, true, `expected at least one build dir under ${buildsDir}`);
  return path.join(buildsDir, buildIds.at(-1));
}

function assertIncludesAll(text, expectedTerms) {
  for (const term of expectedTerms) {
    assert.equal(text.includes(term), true, `expected terminal output to include ${term}`);
  }
}

function assertExcludesAll(text, forbiddenPatterns, label = 'text') {
  for (const pattern of forbiddenPatterns) {
    assert.doesNotMatch(text, pattern, `${label} leaked or exposed ${pattern}`);
  }
}

function allUserReportCapabilities(report) {
  return [
    ...(report.enabled_capabilities ?? []),
    ...(report.limited_capabilities ?? []),
    ...(report.limited_enabled_capabilities ?? []),
    ...(report.confirmation_required_capabilities ?? []),
    ...(report.disabled_capabilities ?? []),
  ];
}

function isDebugOnlyCapabilityRecord(capability = {}) {
  const values = [
    capability.enabled_status,
    capability.default_policy,
    capability.strategy,
    capability.status,
    capability.reason_code,
  ].map((value) => String(value ?? '').toLowerCase());
  return capability.debug_only === true
    || capability.candidate_debug_only === true
    || values.includes('debug_only')
    || values.includes('candidate_debug_only')
    || values.includes('candidate');
}

function sectionBetween(text, start, end) {
  const startIndex = text.indexOf(start);
  assert.notEqual(startIndex, -1, `missing section start ${start}`);
  const endIndex = text.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `missing section end ${end}`);
  return text.slice(startIndex, endIndex);
}

function countOccurrences(text, pattern) {
  return [...text.matchAll(pattern)].length;
}

function makeReportCapability(name, overrides = {}) {
  return {
    id: `capability:test:${name.toLowerCase().replace(/[^a-z0-9]+/gu, '-')}`,
    name,
    user_facing_name: name,
    risk_level: 'read_public_low',
    enabled_status: 'enabled',
    default_policy: 'enabled',
    status: 'active',
    safety_level: 'read_only',
    ...overrides,
  };
}

function normalizeSnapshotOutput(text, workspace) {
  const slashWorkspace = workspace.replace(/\\/gu, '/');
  const escapedWorkspace = workspace.replace(/[\\^$.*+?()[\]{}|]/gu, '\\$&');
  const escapedSlashWorkspace = slashWorkspace.replace(/[\\^$.*+?()[\]{}|]/gu, '\\$&');
  return text
    .replace(/\r\n/gu, '\n')
    .replace(new RegExp(escapedWorkspace, 'gu'), '<WORKSPACE>')
    .replace(new RegExp(escapedSlashWorkspace, 'gu'), '<WORKSPACE>')
    .replace(/\\/gu, '/')
    .replace(/x\.com-326a6450\/builds\/[A-Za-z0-9._-]+/gu, 'x.com-326a6450/builds/<BUILD_ID>')
    .trimEnd()
    .concat('\n');
}

async function assertGoldenSnapshot(snapshotName, result, workspace) {
  assertBuildSucceeded(result);
  assert.equal(result.stderr.trim(), '', 'successful user-facing builds should not write stderr diagnostics');
  const expected = await readFile(path.join(GOLDEN_DIR, snapshotName), 'utf8');
  assert.equal(normalizeSnapshotOutput(result.stdout, workspace), expected);
}

function extractCounts(...reports) {
  for (const report of reports) {
    const candidates = [
      report?.counts,
      report?.summary,
      report?.coverage,
      report?.result?.counts,
      report?.result?.summary,
    ].filter(Boolean);
    for (const candidate of candidates) {
      const counts = {
        nodes_total: candidate.nodes_total ?? candidate.nodesTotal ?? candidate.nodes,
        actionable_elements: candidate.actionable_elements ?? candidate.actionableElements ?? candidate.affordances,
        capabilities_total: candidate.capabilities_total ?? candidate.capabilitiesTotal ?? candidate.capabilities?.total,
        intents_total: candidate.intents_total ?? candidate.intentsTotal ?? candidate.intents,
      };
      if (Object.values(counts).every((value) => Number.isFinite(Number(value)))) {
        return Object.fromEntries(Object.entries(counts).map(([key, value]) => [key, Number(value)]));
      }
    }
  }
  assert.fail('expected report counts with nodes_total, actionable_elements, capabilities_total, and intents_total');
}

function extractRiskDefaults(...reports) {
  for (const report of reports) {
    const candidate = report?.riskLevelDefaults
      ?? report?.riskPolicy?.defaultByLevel
      ?? report?.policy?.riskLevelDefaults
      ?? report?.policy?.riskLevels
      ?? report?.defaults?.riskLevels;
    if (candidate && typeof candidate === 'object') {
      return candidate;
    }
  }
  assert.fail('expected risk level default policy map in user or debug report');
}

function policyMode(policy) {
  if (typeof policy === 'string') {
    return policy;
  }
  if (policy?.status) {
    return policy.status;
  }
  if (policy?.default) {
    return policy.default;
  }
  if (policy?.enabled === true && policy?.requiresConfirmation === true) {
    return 'needs_confirmation';
  }
  if (policy?.enabled === true) {
    return 'enabled';
  }
  if (policy?.enabled === false) {
    return 'disabled';
  }
  return null;
}

test('siteforge build x.com default terminal output is user-facing and privacy-safe', async (t) => {
  const workspace = await createWorkspace(t);
  const result = runSiteforgeBuild(workspace, [X_URL]);
  assertBuildSucceeded(result);

  assertIncludesAll(result.stdout, DEFAULT_REQUIRED_TERMS);
  assertExcludesAll(result.stdout, DEFAULT_FORBIDDEN_PATTERNS, 'default terminal output');
  assert.equal(result.stdout.includes(workspace), false, 'default output should not expose absolute workspace path');
  assert.equal(result.stdout.includes(workspace.replace(/\\/gu, '/')), false, 'default output should not expose slash-normalized absolute workspace path');
  assert.match(result.stdout, /报告 \.siteforge\/sites\/x\.com-326a6450\/builds\/[A-Za-z0-9._-]+\/build_report\.user\.json/u);
});

test('siteforge build x.com keeps tree sections and final result status consistent', async (t) => {
  const workspace = await createWorkspace(t);
  const result = runSiteforgeBuild(workspace, [X_URL]);
  assertBuildSucceeded(result);

  const statsIndex = result.stdout.indexOf('▶ 能力统计');
  const discoveryIndex = result.stdout.indexOf('▶ 自动探索');
  const pendingIndex = result.stdout.indexOf('▼ 待确认能力');
  const outputIndex = result.stdout.indexOf('▶ 输出结果');

  assert.notEqual(statsIndex, -1, 'default output should include capability stats tree section');
  assert.notEqual(discoveryIndex, -1, 'default output should include auto discovery tree section');
  assert.notEqual(pendingIndex, -1, 'default output should include pending capability tree section');
  assert.notEqual(outputIndex, -1, 'default output should include output tree section');
  assert.equal(statsIndex < discoveryIndex, true, 'capability stats should render before discovery');
  assert.equal(discoveryIndex < pendingIndex, true, 'discovery should render before pending capabilities');
  assert.equal(pendingIndex < outputIndex, true, 'pending capabilities should render before output status');

  assert.match(result.stdout, /▶ 输出结果\s+│ 验证 通过；当前输出 已更新；本地索引 已注册/u);
});

test('siteforge build x.com --manual is the only mode that shows supplemental collection copy', async (t) => {
  const workspace = await createWorkspace(t);
  const result = runSiteforgeBuild(workspace, [X_URL, '--manual']);
  assertBuildSucceeded(result);

  assert.match(result.stdout, /逐项手动补采/u);
  assert.match(result.stdout, /(?:输入可见条数|最终 URL)/u);
  assertExcludesAll(result.stdout, PRIVACY_FORBIDDEN_PATTERNS, 'manual terminal output');
});

test('siteforge build x.com reports required minimum capability coverage counts', async (t) => {
  const workspace = await createWorkspace(t);
  const result = runSiteforgeBuild(workspace, [X_URL, '--auto', '--deep']);
  assertBuildSucceeded(result);

  const buildDir = await latestBuildDir(workspace);
  const userReport = await readJson(path.join(buildDir, 'user.json'));
  const debugReport = await readJson(path.join(buildDir, 'debug.json'));
  const counts = extractCounts(userReport, debugReport);

  assert.equal(counts.nodes_total > 16, true);
  assert.equal(counts.actionable_elements >= 64, true);
  assert.equal(counts.capabilities_total >= 20, true);
  assert.equal(counts.intents_total >= 40, true);
});

test('siteforge build x.com state model separates limited, confirmation, draft, disabled, and debug-only states', async (t) => {
  const syntheticCapabilities = CAPABILITY_ENABLEMENT_STATUSES.map((status) => ({
    id: `capability:test:${status}`,
    name: status,
    status: status === 'candidate_debug_only' ? 'candidate' : 'active',
    enabled_status: status,
    default_policy: status,
    risk_level: status === 'draft_only' ? 'write_low' : 'read_public_low',
  }));
  const syntheticCounts = capabilityEnablementStatusCounts(syntheticCapabilities);
  for (const status of CAPABILITY_ENABLEMENT_STATUSES) {
    assert.equal(syntheticCounts[status], 1, `${status} should be counted by the state model`);
  }
  assert.equal(isCallableEnablementStatus('enabled'), true);
  assert.equal(isCallableEnablementStatus('limited_enabled'), true);
  assert.equal(isCallableEnablementStatus('confirmation_required'), true);
  assert.equal(isCallableEnablementStatus('draft_only'), true);
  assert.equal(isCallableEnablementStatus('debug_only'), false);
  assert.equal(isCallableEnablementStatus('candidate_debug_only'), false);

  const workspace = await createWorkspace(t);
  const result = runSiteforgeBuild(workspace, [X_URL]);
  assertBuildSucceeded(result);

  const buildDir = await latestBuildDir(workspace);
  const capabilitiesPayload = await readJson(path.join(buildDir, 'capabilities.json'));
  const userReport = await readJson(path.join(buildDir, 'user.json'));
  const capabilities = capabilitiesPayload.capabilities;
  const byName = new Map(capabilities.map((capability) => [capability.name, capability]));

  const limitedIds = new Set((userReport.limited_enabled_capabilities ?? []).map((capability) => capability.id));
  const confirmationIds = new Set((userReport.confirmation_required_capabilities ?? []).map((capability) => capability.id));
  assert.equal([...limitedIds].some((id) => confirmationIds.has(id)), false, 'limited capabilities must not enter confirmation list');
  assert.equal(allUserReportCapabilities(userReport).some(isDebugOnlyCapabilityRecord), false, 'debug-only capabilities must not enter user lists');

  assert.equal(byName.get('read recommended timeline')?.risk_level, 'read_personal_medium');
  assert.equal(byName.get('read recommended timeline')?.enabled_status, 'limited_enabled');
  assert.equal(byName.get('read following timeline')?.enabled_status, 'limited_enabled');
  for (const name of ['read followed users', 'read followers', 'read bookmarks summary', 'read all notifications summary']) {
    assert.equal(byName.get(name)?.risk_level, 'read_personal_medium', `${name} should stay personal-read`);
    assert.equal(byName.get(name)?.enabled_status, 'confirmation_required', `${name} should require confirmation without capability-specific proof`);
  }
  assert.equal(byName.get('read direct message detail')?.enabled_status, 'disabled');
  assert.equal(byName.get('create post draft')?.enabled_status, 'draft_only');
  assert.equal(byName.get('create post draft')?.executionPlan?.dryRunOnly, true);
  for (const name of ['publish post', 'send direct message', 'like post', 'follow user']) {
    assert.equal(byName.get(name)?.enabled_status, 'disabled', `${name} should stay disabled`);
    assert.equal(byName.get(name)?.executionPlan, undefined, `${name} should not have an execution plan`);
  }
});

test('siteforge build x.com keeps debug-only candidates out of user capability lists', async (t) => {
  const workspace = await createWorkspace(t);
  const result = runSiteforgeBuild(workspace, [X_URL, '--auto', '--deep']);
  assertBuildSucceeded(result);

  const buildDir = await latestBuildDir(workspace);
  const userReportText = await readFile(path.join(buildDir, 'user.json'), 'utf8');
  const userMarkdownText = await readFile(path.join(buildDir, 'user.md'), 'utf8');
  const userReport = JSON.parse(userReportText);
  const debugReport = await readJson(path.join(buildDir, 'debug.json'));
  const userCapabilities = allUserReportCapabilities(userReport);

  assert.equal(userCapabilities.length > 0, true);
  assert.equal(userCapabilities.some(isDebugOnlyCapabilityRecord), false);
  assert.equal(userCapabilities.some((capability) => /capture network APIs/iu.test(`${capability.name} ${capability.user_facing_name}`)), false);
  assert.equal(debugReport.capabilities.some((capability) => (
    capability.enabled_status === 'candidate_debug_only'
    || capability.status === 'candidate'
    || capability.name === 'capture network APIs'
  )), true);
  assert.equal(Number(userReport.debug_candidate_summary?.count) > 0, true);
  assert.match(result.stdout, /▶ 调试信息\s+│ .*开发者候选 \d+/u);
  assert.doesNotMatch(result.stdout, /capture network APIs|candidate_debug_only/u);
  assert.doesNotMatch(userReportText, /capture network APIs/u);
  assert.doesNotMatch(userMarkdownText, /capture network APIs|candidate_debug_only/u);
});

test('rendered user summary caps lists, sorts by user-facing priority, and hides debug candidates', () => {
  const enabled = [
    makeReportCapability('E Auxiliary Nav', { category: 'navigation' }),
    makeReportCapability('B Lookup', { category: 'search' }),
    makeReportCapability('C Surface', { category: 'profile' }),
    makeReportCapability('D Surface', { category: 'post detail' }),
    makeReportCapability('A Core', { category: 'homepage' }),
    ...Array.from({ length: 7 }, (_, index) => makeReportCapability(`ZZ Enabled Filler ${String(index + 1).padStart(2, '0')}`, {
      category: 'navigation',
    })),
    makeReportCapability('Tail Risk 01', { category: 'account settings', risk_level: 'write_high' }),
    makeReportCapability('Tail Risk 02', { category: 'account settings', risk_level: 'write_high' }),
    makeReportCapability('Hidden Debug Candidate', {
      status: 'candidate',
      enabled_status: 'candidate_debug_only',
      default_policy: 'candidate_debug_only',
    }),
  ];
  const limited = Array.from({ length: 9 }, (_, index) => makeReportCapability(`Limited ${String(index + 1).padStart(2, '0')}`, {
    enabled_status: 'limited_enabled',
    default_policy: 'limited_enabled',
    risk_level: 'read_personal_medium',
  }));
  const confirmation = Array.from({ length: 10 }, (_, index) => makeReportCapability(`Confirm ${String(index + 1).padStart(2, '0')}`, {
    enabled_status: 'confirmation_required',
    default_policy: 'confirm_or_limited',
    risk_level: 'read_personal_medium',
  }));
  const disabled = Array.from({ length: 10 }, (_, index) => makeReportCapability(`Disabled ${String(index + 1).padStart(2, '0')}`, {
    status: 'disabled',
    enabled_status: 'disabled',
    default_policy: 'disabled',
    risk_level: 'write_high',
  }));
  const text = renderSiteForgeBuildSummary({
    status: 'success',
    artifacts: {
      'build_report.user.json': 'C:\\Users\\example\\secret\\build_report.user.json',
    },
    user_report: {
      result_status: 'partial_success',
      site: { root_url: 'https://x.com/@private_handle?token=secret' },
      skill_id: 'x-test',
      counts: { actionable_elements: 1 },
      discovered_nodes_summary: {
        page_nodes: 1,
        content_nodes: 1,
        operation_nodes: 1,
        modal_nodes: 0,
        route_templates: 1,
      },
      capability_summary: {
        read_public_low: enabled.length,
        read_personal_medium: limited.length + confirmation.length,
        debug_only: 2,
      },
      capability_evidence_summary: {
        verified: enabled.length + limited.length,
        inferred: 0,
        confirmation_required: confirmation.length,
        disabled: disabled.length,
        debug_only: 2,
      },
      debug_candidate_summary: { count: 2, report: 'debug' },
      enabled_capabilities: enabled,
      limited_enabled_capabilities: limited,
      confirmation_required_capabilities: confirmation,
      disabled_capabilities: disabled,
    },
  }, { cwd: 'D:\\not-the-workspace' });

  assertExcludesAll(text, ABSOLUTE_USER_PATH_PATTERNS, 'synthetic terminal output');
  assert.doesNotMatch(text, /@private_handle|token=secret|Hidden Debug Candidate|candidate_debug_only|debug_only/u);
  assert.match(text, /▶ 调试信息\s+│ .*开发者候选 2/u);
  assert.equal(text.includes('build_report.user.json'), true);

  assert.match(text, /▶ 能力统计\s+│ 可用 14 \/ 有限脱敏 9 \/ 待确认 10 \/ 禁用阻止 10/u);
  assert.match(text, /▼ 待确认能力 \(10\)/u);
  assert.equal(countOccurrences(text, /^\s+\[ \] Confirm /gmu), 8);
  assert.match(text, /… 另有 2 项\s+│ 详见报告/u);
});

test('siteforge build x.com records default policy for each risk level', async (t) => {
  const workspace = await createWorkspace(t);
  const result = runSiteforgeBuild(workspace, [X_URL, '--auto', '--deep']);
  assertBuildSucceeded(result);

  const buildDir = await latestBuildDir(workspace);
  const userReport = await readJson(path.join(buildDir, 'user.json'));
  const debugReport = await readJson(path.join(buildDir, 'debug.json'));
  const defaults = extractRiskDefaults(userReport, debugReport);

  assert.equal(policyMode(defaults.low), 'enabled');
  assert.equal(policyMode(defaults.medium), 'limited_enabled');
  assert.equal(policyMode(defaults.high), 'disabled');
  assert.equal(policyMode(defaults.critical), 'disabled');
});

test('siteforge build x.com remediation paths keep safe alternatives bounded', async (t) => {
  const workspace = await createWorkspace(t);
  const result = runSiteforgeBuild(workspace, [X_URL, '--auto', '--deep']);
  assertBuildSucceeded(result);

  const buildDir = await latestBuildDir(workspace);
  const userReport = await readJson(path.join(buildDir, 'user.json'));
  const capabilitiesPayload = await readJson(path.join(buildDir, 'capabilities.json'));
  const capabilitiesByName = new Map(capabilitiesPayload.capabilities.map((capability) => [capability.name, capability]));
  const disabledByName = new Map((userReport.disabled_capabilities ?? []).map((capability) => [capability.name, capability]));

  for (const name of ['publish post', 'send direct message', 'like post', 'follow user']) {
    const capability = capabilitiesByName.get(name);
    assert.equal(capability?.enabled_status, 'disabled', `${name} should remain disabled`);
    assert.equal(capability?.status, 'disabled', `${name} should remain disabled`);
    assert.equal(capability?.executionPlan, undefined, `${name} must not gain an execution plan`);

    const card = disabledByName.get(name);
    assert.equal(card?.confirmation_mode, 'blocked', `${name} should only offer blocked review remediation`);
    assert.equal(card?.ordinary_confirmation_allowed, false, `${name} cannot be enabled by ordinary confirmation`);
    assert.equal(card?.confirm_command, null, `${name} must not expose a confirm command`);
    assert.match(card?.next_step ?? '', /safe remediation plan/u);
    assert.match(card?.next_step ?? '', /site-specific adapter path/u);
    assert.doesNotMatch(card?.next_step ?? '', /Keep disabled/u);
  }

  const sensitiveSummary = capabilitiesByName.get('read bookmarks summary');
  assert.equal(sensitiveSummary?.risk_level, 'read_personal_medium');
  assert.equal(sensitiveSummary?.enabled_status, 'confirmation_required');
  assert.equal(sensitiveSummary?.executionPlan?.mode, 'limited_read');
  assert.equal(sensitiveSummary?.executionPlan?.limitedOutputOnly, true);
  assert.equal(sensitiveSummary?.executionPlan?.savedMaterial, 'sanitized_summary_only');

  for (const name of ['read bookmarked post body', 'read notification body']) {
    const capability = capabilitiesByName.get(name);
    assert.equal(capability?.risk_level, 'read_private_high', `${name} should stay private high risk`);
    assert.equal(capability?.enabled_status, 'disabled', `${name} should stay disabled`);
    assert.equal(capability?.executionPlan, undefined, `${name} should not receive a limited read plan`);
  }

  const draft = capabilitiesByName.get('create post draft');
  const draftSteps = draft?.executionPlan?.steps ?? [];
  assert.equal(draft?.enabled_status, 'draft_only');
  assert.equal(draft?.executionPlan?.dryRunOnly, true);
  assert.equal(draft?.executionPlan?.autoExecute, false);
  assert.equal(draftSteps.every((step) => (
    step.submit !== true
    && step.finalSubmit !== true
    && step.upload !== true
    && step.selectSensitiveRecipient !== true
  )), true);

  const remediationText = JSON.stringify({
    confirmation_paths: userReport.confirmation_paths,
    next_steps: userReport.next_steps,
    confirmation_required_capabilities: userReport.confirmation_required_capabilities,
    disabled_capabilities: userReport.disabled_capabilities,
  });
  assertExcludesAll(remediationText, PRIVACY_FORBIDDEN_PATTERNS, 'remediation paths');
  assert.match(userReport.confirmation_paths.sensitive_read.description, /unsanitized\/private material remains unsaved/u);
  assert.match(userReport.confirmation_paths.draft_write.description, /final submit\/send actions remain disabled/u);
  assert.match(userReport.confirmation_paths.disabled.next_step, /capability_remediation_plan\.json/u);
  assert.match(userReport.confirmation_paths.disabled.next_step, /site-specific adapter validation/u);
});

test('siteforge build x.com reports confirmation commands without making manual the default path', async (t) => {
  const workspace = await createWorkspace(t);
  const result = runSiteforgeBuild(workspace, [X_URL]);
  assertBuildSucceeded(result);

  const buildDir = await latestBuildDir(workspace);
  const userReport = await readJson(path.join(buildDir, 'user.json'));
  const confirmation = userReport.confirmation_required_capabilities ?? [];

  assert.equal(confirmation.length > 0, true);
  assert.equal(confirmation.every((capability) => capability.confirm_command || capability.next_step), true);
  assert.equal(confirmation.every((capability) => !/--manual/u.test(`${capability.confirm_command ?? ''} ${capability.next_step ?? ''}`)), true);
  assert.equal(userReport.next_steps.every((step) => !/--manual/u.test(step)), true);
  assert.match(userReport.confirmation_paths.view_confirmation_required_command, /node src\/entrypoints\/operator\/capabilities\.mjs list/u);
  assert.match(userReport.confirmation_paths.sensitive_read.command, /node src\/entrypoints\/operator\/capabilities\.mjs confirm .+ --group sensitive-read --limited/u);
  assert.match(userReport.confirmation_paths.disabled.review_command, /node src\/entrypoints\/operator\/capabilities\.mjs list .+ --status disabled/u);
});

test('siteforge build x.com terminal output and reports do not expose private material', async (t) => {
  const workspace = await createWorkspace(t);
  const result = runSiteforgeBuild(workspace, [X_URL, '--debug']);
  assertBuildSucceeded(result);

  const buildDir = await latestBuildDir(workspace);
  const reportFiles = [
    'build_report.json',
    'user.json',
    'user.md',
    'debug.json',
  ];
  const texts = [
    { label: 'terminal stdout', text: result.stdout },
    { label: 'terminal stderr', text: result.stderr },
  ];
  for (const fileName of reportFiles) {
    texts.push({
      label: fileName,
      text: await readFile(path.join(buildDir, fileName), 'utf8'),
    });
  }

  for (const { label, text } of texts) {
    assertExcludesAll(text, PRIVACY_FORBIDDEN_PATTERNS, label);
  }
});

test('siteforge build x.com partial success output recommends deeper safe collection modes', async (t) => {
  const workspace = await createWorkspace(t);
  const result = runSiteforgeBuild(workspace, [X_URL]);
  assertBuildSucceeded(result);

  assert.match(result.stdout, /✓ 构建完成（部分成功）/u);
  assert.match(result.stdout, /--auto --deep/u);
  assert.match(result.stdout, /--auto --deep --network/u);
});

test('siteforge build x.com writes user and debug report structure with indexed artifacts', async (t) => {
  const workspace = await createWorkspace(t);
  const result = runSiteforgeBuild(workspace, [X_URL, '--auto', '--deep']);
  assertBuildSucceeded(result);

  const buildDir = await latestBuildDir(workspace);
  for (const fileName of ['build_report.json', 'user.json', 'user.md', 'debug.json']) {
    assert.equal(await pathExists(path.join(buildDir, fileName)), true, `${fileName} should exist`);
  }

  const buildReport = await readJson(path.join(buildDir, 'build_report.json'));
  const serializedIndex = JSON.stringify({
    artifacts: buildReport.artifacts,
    index: buildReport.index,
    reports: buildReport.reports,
    outputs: buildReport.outputs,
  });
  assert.match(serializedIndex, /user\.json/u);
  assert.match(serializedIndex, /user\.md/u);
  assert.match(serializedIndex, /debug\.json/u);
});

test('siteforge build x.com default output matches golden snapshot', async (t) => {
  const workspace = await createWorkspace(t);
  await assertGoldenSnapshot(
    'siteforge_build_x_auto_user_output_v2.txt',
    runSiteforgeBuild(workspace, [X_URL]),
    workspace,
  );
});

test('siteforge build x.com auto strict output matches golden snapshot', async (t) => {
  const workspace = await createWorkspace(t);
  await assertGoldenSnapshot(
    'siteforge_build_x_auto_strict_output_v2.txt',
    runSiteforgeBuild(workspace, [X_URL, '--auto', '--privacy', 'strict']),
    workspace,
  );
});

test('siteforge build x.com auto deep output matches golden snapshot', async (t) => {
  const workspace = await createWorkspace(t);
  await assertGoldenSnapshot(
    'siteforge_build_x_auto_deep_output_v2.txt',
    runSiteforgeBuild(workspace, [X_URL, '--auto', '--deep']),
    workspace,
  );
});

test('siteforge build x.com manual output matches golden snapshot', async (t) => {
  const workspace = await createWorkspace(t);
  await assertGoldenSnapshot(
    'siteforge_build_x_manual_output_v2.txt',
    runSiteforgeBuild(workspace, [X_URL, '--manual']),
    workspace,
  );
});

test('siteforge build x.com debug output matches golden snapshot', async (t) => {
  const workspace = await createWorkspace(t);
  await assertGoldenSnapshot(
    'siteforge_build_x_debug_output_v2.txt',
    runSiteforgeBuild(workspace, [X_URL, '--debug']),
    workspace,
  );
});
