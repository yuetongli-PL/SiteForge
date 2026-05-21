import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import {
  renderSiteForgeBuildSummary,
  stableSiteIdFromUrl,
} from '../../src/app/pipeline/build/index.mjs';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIR, '..', '..');
const CLI_PATH = path.join(REPO_ROOT, 'src', 'entrypoints', 'cli', 'index.mjs');
const X_URL = 'https://x.com';

const PRIVACY_FORBIDDEN_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~+/-]+=*/u,
  /\b(?:access_token|refresh_token|token|auth|api[_-]?key|secret|password)=(?!\[REDACTED\]|%5BREDACTED%5D)[^&\s;]+/iu,
  /\bcookie\s*[:=]\s*(?!\[REDACTED\]|%5BREDACTED%5D)[^;\s&]+/iu,
  /\bauthorization\s*[:=]\s*(?!\[REDACTED\]|%5BREDACTED%5D)[^\r\n]+/iu,
  /\bsession(?:[_-]?id|[_-]?ref)?\s*[:=]\s*(?!\[REDACTED\]|%5BREDACTED%5D)[A-Za-z0-9._~+/-]+/iu,
  /private\s+body/iu,
  /raw\s*(?:dom|html|body)\s*[:=]|原始\s*(?:DOM|HTML)\s*[：:]|raw\s*(?:DOM|HTML)\s*[:=]/iu,
  /<html[\s>]|<\/html>/iu,
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

function runSiteforgeBuild(cwd, args, env = /** @type {any} */ ({})) {
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

function assertExcludesAll(text, forbiddenPatterns, label = 'text') {
  for (const pattern of forbiddenPatterns) {
    assert.doesNotMatch(text, pattern, `${label} leaked or exposed ${pattern}`);
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

function makeReportCapability(name, overrides = /** @type {any} */ ({})) {
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

function countOccurrences(text, pattern) {
  return [...text.matchAll(pattern)].length;
}

test('siteforge build x.com noninteractive run fails closed in public_only without private material', async (t) => {
  const workspace = await createWorkspace(t);
  const result = runSiteforgeBuild(workspace, [X_URL]);

  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /SiteForge 构建状态：failed/u);
  assert.equal(result.stderr.trim(), '');
  assertExcludesAll(`${result.stdout}\n${result.stderr}`, PRIVACY_FORBIDDEN_PATTERNS, 'x.com failed output');
  assert.equal(result.stdout.includes(workspace), false, 'output should not expose absolute workspace path');

  const setupPlanPath = path.join(workspace, '.siteforge', 'sites', stableSiteIdFromUrl(X_URL), 'setup', 'setup_plan.json');
  const setupPlan = await readJson(setupPlanPath);
  assert.equal(setupPlan.summary.buildable, false);
  assert.equal(setupPlan.buildReadiness.reasonCode, 'setup-known-policy-robots-disallowed');
  assert.equal(setupPlan.crawlContract.crawlMode, 'public_only');
  assert.equal(setupPlan.crawlContract.authChoice, 'declined');
  assert.equal(setupPlan.authStateReport.verified, false);
  assert.equal(setupPlan.authStateReport.sessionMaterialPersisted, false);
  assert.equal(setupPlan.authStateReport.browserProfilePersisted, false);

  const buildDir = await latestBuildDir(workspace);
  const authReport = await readJson(path.join(buildDir, 'auth_state_report.json'));
  assert.equal(authReport.crawlMode, 'public_only');
  assert.equal(authReport.verified, false);
  assert.equal(authReport.rawMaterialPersisted, false);
});

test('siteforge build x.com --public-only keeps login capabilities out of active build promotion', async (t) => {
  const workspace = await createWorkspace(t);
  const result = runSiteforgeBuild(workspace, [X_URL, '--public-only']);

  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /SiteForge 构建状态：failed/u);
  const setupPlan = await readJson(path.join(workspace, '.siteforge', 'sites', stableSiteIdFromUrl(X_URL), 'setup', 'setup_plan.json'));
  assert.equal(setupPlan.crawlContract.crawlMode, 'public_only');
  assert.equal(setupPlan.crawlContract.evidencePolicy.allowLoginEnhanced, false);
  assert.equal(setupPlan.authStateReport.source, 'user_declined_login_enhancement');
});

test('siteforge build x.com --manual shows login enhancement choice before supplemental collection', async (t) => {
  const workspace = await createWorkspace(t);
  const result = runSiteforgeBuild(workspace, [X_URL, '--manual']);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /SiteForge 可以使用登录态增强抓取，以发现登录后页面和能力。/u);
  assert.match(result.stdout, /1\. 不使用登录态，只抓公开能力/u);
  assert.match(result.stdout, /2\. 使用登录态，打开系统默认浏览器/u);
  assert.doesNotMatch(result.stdout, /逐项手动补采/u);
  assertExcludesAll(result.stdout, PRIVACY_FORBIDDEN_PATTERNS, 'manual login prompt output');
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
  assert.match(text, /调试信息/u);
  assert.equal(text.includes('build_report.user.json'), true);

  assert.match(text, /能力统计/u);
  assert.equal(countOccurrences(text, /^\s+\[ \] Confirm /gmu), 8);
  assert.match(text, /另有 2 项\s+│ 详见报告/u);
});
