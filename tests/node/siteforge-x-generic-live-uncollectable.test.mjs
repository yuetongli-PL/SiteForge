import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import {
  lookupSkillIntent,
  renderSiteForgeBuildSummary,
  resolveFixtureForUrl,
  runSiteForgeBuild,
  stableSiteIdFromUrl,
} from '../../src/app/pipeline/build/index.mjs';
import {
  buildSetupAssistantPaths,
  parseContinueUncollectedCollectionAnswer,
  parseSupplementalCollectionEvidenceInput,
  prepareSiteForgeBuildSetup,
} from '../../src/app/pipeline/build/setup-assistant.mjs';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIR, '..', '..');
const CLI_PATH = path.join(REPO_ROOT, 'src', 'entrypoints', 'cli', 'index.mjs');
const X_URL = 'https://x.com/';

async function listBuildDirs(siteBuildsRoot) {
  const entries = await readdir(siteBuildsRoot, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(siteBuildsRoot, entry.name))
    .sort();
}

function siteBuildsDir(workspace, inputUrl) {
  return buildSetupAssistantPaths(inputUrl, {
    cwd: workspace,
    buildId: 'probe-build',
  }).siteBuildsDir;
}

test('setup assistant parses uncollected-collection yes/no safely', () => {
  for (const answer of ['', 'no', 'n', '否', '不继续', 'skip', 'maybe']) {
    assert.equal(parseContinueUncollectedCollectionAnswer(answer).continue, false, answer);
  }
  for (const answer of ['yes', 'y', 'continue', '是', '继续', '补采']) {
    assert.equal(parseContinueUncollectedCollectionAnswer(answer).continue, true, answer);
  }
});

test('setup assistant accepts only sanitized final URL or visible count for supplemental collection', () => {
  const site = { rootUrl: X_URL, allowedDomains: ['x.com'] };
  const count = parseSupplementalCollectionEvidenceInput('3 条', site);
  assert.equal(count.accepted, true);
  assert.equal(count.evidenceType, 'manual-visible-browser-count');
  assert.equal(count.sampleCount, 3);

  const finalUrl = parseSupplementalCollectionEvidenceInput('https://x.com/home?access_token=example&utm_source=test', site);
  assert.equal(finalUrl.accepted, true);
  assert.equal(finalUrl.evidenceType, 'manual-visible-browser-final-url');
  assert.equal(finalUrl.sampleCount, 1);
  assert.equal(finalUrl.normalizedUrl, 'https://x.com/home');

  assert.equal(parseSupplementalCollectionEvidenceInput('https://evil.example/home', site).accepted, false);
  assert.equal(parseSupplementalCollectionEvidenceInput('yes', site).accepted, false);
});

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function pathExists(filePath) {
  try {
    await readFile(filePath, 'utf8');
    return true;
  } catch {
    return false;
  }
}

async function writeKnownXPolicyConfig(workspace) {
  const configDir = path.join(workspace, 'config');
  await mkdir(configDir, { recursive: true });
  await writeFile(path.join(configDir, 'site-registry.json'), `${JSON.stringify({
    version: 1,
    sites: {
      'x.com': {
        canonicalBaseUrl: X_URL,
        host: 'x.com',
        siteKey: 'x',
        adapterId: 'x',
        repoSkillDir: 'skills/x',
        siteArchetype: 'social-content',
        siteAccessStatus: 'blocked_live_robots_disallowed',
        genericLiveBuild: {
          status: 'blocked',
          reasonCode: 'robots-disallowed',
          reason: 'x.com robots.txt disallows the generic SiteForge live crawler from root-level public collection.',
          alternativeAccessPaths: [
            'official/API or platform-authorized integration',
            'user-authorized bounded SiteAdapter workflow',
            'fixture-only validation',
          ],
        },
        downloadSessionRequirement: 'optional',
        capabilityFamilies: [
          'download-content',
          'query-account-profile',
          'query-social-content',
          'query-social-relations',
        ],
        routingNotes: [
          'Generic static SiteForge build must not claim live social collection.',
        ],
      },
    },
  }, null, 2)}\n`, 'utf8');
  await writeFile(path.join(configDir, 'site-capabilities.json'), `${JSON.stringify({
    version: 1,
    sites: {
      'x.com': {
        baseUrl: X_URL,
        host: 'x.com',
        siteKey: 'x',
        adapterId: 'x',
        primaryArchetype: 'social-content',
        capabilityFamilies: [
          'navigate-to-author',
          'query-account-profile',
          'query-social-content',
          'query-social-relations',
          'search-content',
        ],
        supportedIntents: [
          'profile-content',
          'search-posts',
          'list-followed-updates',
        ],
        safeActionKinds: ['navigate'],
        approvalActionKinds: ['search-submit'],
        siteAccessStatus: 'blocked_live_robots_disallowed',
        genericLiveBuild: {
          status: 'blocked',
          reasonCode: 'robots-disallowed',
          reason: 'x.com robots.txt disallows the generic SiteForge live crawler from root-level public collection.',
          alternativeAccessPaths: [
            'official/API or platform-authorized integration',
            'user-authorized bounded SiteAdapter workflow',
            'fixture-only validation',
          ],
        },
      },
    },
  }, null, 2)}\n`, 'utf8');
}

function assertKnownXPolicy(setupPlan) {
  assert.equal(setupPlan.knownSitePolicy.status, 'matched');
  assert.equal(setupPlan.knownSitePolicy.host, 'x.com');
  assert.equal(setupPlan.knownSitePolicy.siteKey, 'x');
  assert.equal(setupPlan.knownSitePolicy.adapterId, 'x');
  assert.equal(setupPlan.knownSitePolicy.siteAccessStatus, 'blocked_live_robots_disallowed');
  assert.equal(setupPlan.knownSitePolicy.setupConstraints.userChoicesBypassPolicy, false);
  assert.equal(setupPlan.knownSitePolicy.setupConstraints.genericLiveBuildStatus, 'blocked');
  assert.equal(setupPlan.knownSitePolicy.setupConstraints.genericLiveBuildReasonCode, 'robots-disallowed');
  assert.equal(setupPlan.knownSitePolicy.genericLiveBuild.status, 'blocked');
  assert.equal(setupPlan.knownSitePolicy.genericLiveBuild.reasonCode, 'robots-disallowed');
  assert.match(setupPlan.knownSitePolicy.genericLiveBuild.reason, /generic SiteForge live crawler/u);
  assert.equal(setupPlan.knownSitePolicy.genericLiveBuild.alternativeAccessPaths.some((entry) => /fixture-only validation/u.test(entry)), true);
  assert.equal(setupPlan.knownSitePolicy.capabilityFamilies.includes('query-social-content'), true);
  assert.equal(setupPlan.knownSitePolicy.capabilityFamilies.includes('query-social-relations'), true);
  assert.equal(setupPlan.knownSitePolicy.supportedIntents.includes('search-posts'), true);
  assert.equal(setupPlan.warnings.some((warning) => warning.includes('known site policy loaded for x')), true);
}

function siteRegistryPath(workspace) {
  return path.join(workspace, '.siteforge', 'sites', stableSiteIdFromUrl(X_URL), 'registry.json');
}

test('repo x.com policy explicitly marks generic live build as robots-blocked with alternatives', async () => {
  const registry = await readJson(path.join(REPO_ROOT, 'config', 'site-registry.json'));
  const capabilities = await readJson(path.join(REPO_ROOT, 'config', 'site-capabilities.json'));
  const registryRecord = registry.sites['x.com'];
  const capabilityRecord = capabilities.sites['x.com'];

  assert.equal(registryRecord.siteAccessStatus, 'blocked_live_robots_disallowed');
  assert.equal(registryRecord.genericLiveBuild.status, 'blocked');
  assert.equal(registryRecord.genericLiveBuild.reasonCode, 'robots-disallowed');
  assert.match(registryRecord.genericLiveBuild.reason, /robots\.txt disallows the generic SiteForge live crawler/u);
  assert.equal(registryRecord.genericLiveBuild.alternativeAccessPaths.some((pathValue) => /official\/API|platform-authorized/u.test(pathValue)), true);
  assert.equal(registryRecord.genericLiveBuild.alternativeAccessPaths.some((pathValue) => /user-authorized bounded X SiteAdapter/u.test(pathValue)), true);
  assert.equal(registryRecord.genericLiveBuild.alternativeAccessPaths.some((pathValue) => /fixture-only validation/u.test(pathValue)), true);
  assert.equal(registryRecord.accessSignals.restrictionSignals.includes('robots.txt Disallow: / for generic crawlers'), true);

  assert.equal(capabilityRecord.siteAccessStatus, 'blocked_live_robots_disallowed');
  assert.equal(capabilityRecord.genericLiveBuild.status, 'blocked');
  assert.equal(capabilityRecord.genericLiveBuild.reasonCode, 'robots-disallowed');
  assert.equal(capabilityRecord.routingNotes.some((note) => /do not promote profile, timeline, search, media, archive, account, or API capabilities/u.test(note)), true);
});

test('x.com generic live fixture resolves without real network access', () => {
  const fixture = resolveFixtureForUrl(X_URL);
  assert.equal(fixture?.name, 'x-com-generic-live-uncollectable');
  assert.equal(fixture?.rootUrl, X_URL);
  assert.equal(path.basename(fixture?.fixtureDir ?? ''), 'x-com-generic-live-uncollectable');
});

test('x.com generic static build stops at robots Disallow before crawl, skill, or runtime registration', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-x-robots-build-'));
  try {
    await writeKnownXPolicyConfig(workspace);
    let failure;
    await assert.rejects(
      async () => {
        try {
          await runSiteForgeBuild(X_URL, {
            cwd: workspace,
            buildId: 'x-robots-disallowed-build',
            now: new Date('2026-05-16T08:00:00.000Z'),
            fetchDelayMs: 0,
          });
        } catch (error) {
          failure = error;
          throw error;
        }
      },
      /robots\.txt disallows all planned seed URLs/u,
    );

    assert.equal(failure.code, 'robots-disallowed');
    assert.equal(failure.stage, 'discoverSeeds');
    assert.ok(failure.artifactDir);

    const seeds = await readJson(path.join(failure.artifactDir, 'seeds.json'));
    const buildReport = await readJson(path.join(failure.artifactDir, 'build_report.json'));
    assert.equal(seeds.status, 'blocked');
    assert.equal(seeds.robots.status, 'parsed');
    assert.deepEqual(seeds.robots.disallowPaths, ['/']);
    assert.deepEqual(seeds.seeds, []);
    assert.equal(buildReport.status, 'blocked');
    assert.equal(buildReport.failedStage, 'discoverSeeds');
    assert.equal(buildReport.failureClass, 'robots');
    assert.equal(buildReport.reasonCode, 'robots-disallowed');
    assert.equal(buildReport.summary.registryStatus, null);
    assert.equal(buildReport.stages.crawlStatic.status, 'skipped');
    assert.equal(buildReport.stages.generateSkill.status, 'skipped');
    assert.equal(await pathExists(path.join(failure.artifactDir, 'crawl_static.json')), false);
    assert.equal(await pathExists(path.join(failure.artifactDir, 'skill', 'skill.yaml')), false);
    assert.equal(await pathExists(path.join(failure.artifactDir, 'verification_report.json')), false);

    const registry = await readJson(siteRegistryPath(workspace));
    assert.deepEqual(registry.skills, []);
    const lookup = await lookupSkillIntent({
      registryPath: siteRegistryPath(workspace),
      domain: 'x.com',
      utterance: 'search posts',
    });
    assert.equal(lookup.status, 'not_found');
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('x.com known social policy and robots Disallow make noninteractive setup not buildable without prompting', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-x-setup-noninteractive-'));
  try {
    await writeKnownXPolicyConfig(workspace);
    let prompted = false;
    let failure;
    await assert.rejects(
      async () => {
        try {
          await prepareSiteForgeBuildSetup(X_URL, {
            cwd: workspace,
            buildId: 'x-setup-noninteractive',
            now: new Date('2026-05-16T08:10:00.000Z'),
            setupInteractive: false,
            interactive: false,
            noTty: true,
            setupPrompt: async () => {
              prompted = true;
              return '';
            },
            fetchDelayMs: 0,
          });
        } catch (error) {
          failure = error;
          throw error;
        }
      },
      /setup-evidence-not-buildable/u,
    );

    assert.equal(prompted, false);
    assert.equal(failure.code, 'setup-evidence-not-buildable');
    assert.equal(failure.reasonCode, 'setup-known-policy-robots-disallowed');
    assert.equal(await pathExists(failure.setupPlanPath), true);
    assert.equal(await pathExists(failure.buildProfilePath), false);
    assert.equal(await pathExists(failure.savedBuildProfilePath), false);

    const setupPlan = await readJson(failure.setupPlanPath);
    assertKnownXPolicy(setupPlan);
    assert.equal(setupPlan.summary.buildable, false);
    assert.equal(setupPlan.buildReadiness.reasonCode, 'setup-known-policy-robots-disallowed');
    assert.equal(setupPlan.evidenceQuality.knownPolicyCapabilityPressure.hasPolicyCapabilities, true);
    assert.equal(setupPlan.evidenceQuality.robotsExcludedAllCandidateEvidence, true);
    assert.equal(setupPlan.evidenceQuality.actualPageEvidenceCount, 0);
    assert.equal(setupPlan.evidenceQuality.robotsExcludedPageEvidenceUrls.includes(X_URL), true);
    assert.equal(setupPlan.collectionReview.artifactFamily, 'siteforge-collection-review');
    assert.equal(setupPlan.collectionReview.summary.seeds.missing > 0, true);
    assert.equal(setupPlan.collectionReview.capabilities.missing.some((item) => item.id === 'query-social-content'), true);
    assert.equal(setupPlan.collectionReview.intents.missing.some((item) => item.id === 'search-posts'), true);
    assert.equal(setupPlan.recommendedCapabilities.every((capability) => capability.recommended === false), true);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('interactive x.com setup can use user-authorized browser evidence without persisting session material', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-x-authorized-setup-'));
  try {
    await writeKnownXPolicyConfig(workspace);
    let providerCalls = 0;
    const setup = await prepareSiteForgeBuildSetup(X_URL, {
      cwd: workspace,
      buildId: 'x-authorized-setup',
      now: new Date('2026-05-16T08:12:00.000Z'),
      setupInteractive: true,
      interactive: true,
      auto: true,
      fetchDelayMs: 0,
      setupPrompt: async () => '',
      setupOutput: { write() {} },
      userAuthorizedEvidenceProvider: async ({ setupPlan }) => {
        providerCalls += 1;
        assert.equal(setupPlan.buildReadiness.reasonCode, 'setup-known-policy-robots-disallowed');
        return {
          capturedAt: '2026-05-16T08:12:01.000Z',
          finalUrl: 'https://x.com/home',
          title: 'Private account title with unread DM from synthetic-user',
          pages: [{
            url: 'https://x.com/home',
            title: 'Private account title with unread DM from synthetic-user',
            textSummary: 'Private timeline text from synthetic-user should not persist.',
          }],
        };
      },
    });

    assert.equal(providerCalls, 1);
    assert.equal(setup.status, 'created');
    assert.equal(setup.setupPlan.buildReadiness.reasonCode, 'setup-user-authorized-browser-evidence');
    assert.equal(setup.setupPlan.summary.buildable, true);
    assert.equal(setup.setupPlan.userAuthorizedEvidence.status, 'captured');
    assert.equal(setup.setupPlan.userAuthorizedEvidence.sessionMaterialPersisted, false);
    assert.equal(setup.setupPlan.userAuthorizedEvidence.browserProfilePersisted, false);
    assert.equal(setup.setupPlan.userAuthorizedEvidence.rawHtmlPersisted, false);
    const followedCandidate = setup.setupPlan.recommendedCapabilities.find((capability) => capability.id === 'list-followed-users');
    assert.ok(followedCandidate);
    assert.equal(followedCandidate.recommended, false);
    assert.equal(followedCandidate.status, 'candidate');
    assert.equal(followedCandidate.evidenceRequirement, 'capability-specific-evidence');
    assert.equal(await pathExists(setup.paths.savedBuildProfilePath), true);

    const savedProfile = JSON.parse(await readFile(setup.paths.savedBuildProfilePath, 'utf8'));
    assert.equal(savedProfile.userAuthorizedEvidence.status, 'captured');
    assert.equal(savedProfile.userAuthorizedEvidence.sessionMaterialPersisted, false);
    assert.equal(savedProfile.userAuthorizedEvidence.browserProfilePersisted, false);
    assert.equal(savedProfile.userAuthorizedEvidence.rawHtmlPersisted, false);
    assert.equal(savedProfile.userAuthorizedEvidence.rawCookiePersisted, false);
    assert.equal(savedProfile.userAuthorizedEvidence.rawCredentialPersisted, false);
    assert.equal(Object.hasOwn(savedProfile.userAuthorizedEvidence, 'cookies'), false);
    assert.equal(Object.hasOwn(savedProfile.userAuthorizedEvidence, 'headers'), false);
    assert.equal(Object.hasOwn(savedProfile.userAuthorizedEvidence, 'userDataDir'), false);
    const savedProfileText = JSON.stringify(savedProfile);
    assert.equal(savedProfileText.includes('synthetic-user'), false);
    assert.equal(savedProfileText.includes('Private timeline text'), false);
    assert.equal(savedProfile.profileUsability.buildable, true);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('interactive x.com setup uses normal browser handoff by default for user authorization', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-x-external-browser-setup-'));
  try {
    await writeKnownXPolicyConfig(workspace);
    const openedUrls = [];
    const prompts = [];
    let outputText = '';
    let authorizationChoiceUsed = false;
    const setup = await prepareSiteForgeBuildSetup(X_URL, {
      cwd: workspace,
      buildId: 'x-external-browser-setup',
      now: new Date('2026-05-16T08:12:10.000Z'),
      setupInteractive: true,
      interactive: true,
      auto: true,
      fetchDelayMs: 0,
      setupPrompt: async (question) => {
        prompts.push(question);
        if (/选择：/u.test(question) && !authorizationChoiceUsed) {
          authorizationChoiceUsed = true;
          return '1';
        }
        return '';
      },
      setupOutput: { write(chunk) { outputText += String(chunk); } },
      externalBrowserLauncher: async (url) => {
        openedUrls.push(url);
        return { opened: true };
      },
    });

    assert.deepEqual(openedUrls, [X_URL]);
    assert.equal(prompts.some((question) => /完成后回终端按 Enter/u.test(question)), false);
    assert.equal(prompts.some((question) => /最终授权 URL|最终授权后的站点 URL|可见条数|逐项补采/u.test(question)), false);
    assert.match(outputText, /访问确认/u);
    assert.match(outputText, /▼ 授权范围\s+│ 目标站点：https:\/\/x\.com\//u);
    assert.match(outputText, /\[ \] 打开目标站点\s+│ 已在系统默认浏览器中打开/u);
    assert.match(outputText, /\[ \] 完成登录、MFA 或授权\s+│ 只需要在浏览器里操作/u);
    assert.match(outputText, /\[ \] 确认可以访问目标页面\s+│ 终端只记录授权边界/u);
    assert.match(outputText, /▶ 隐私边界\s+│ 不保存 cookie、token、浏览器 profile、页面正文或完整页面源码/u);
    assert.match(outputText, /▶ 操作选项\s+│ Enter\/1 已完成登录；2 登录被拒绝；3 取消/u);
    assert.match(outputText, /✓ 浏览器确认已收到/u);
    assert.match(outputText, /✓ 访问确认完成/u);
    assert.match(outputText, /▶ 操作选项.+\n\n✓ 浏览器确认已收到/us);
    assert.match(outputText, /✓ 访问确认完成\n\n准备开始自动构建/u);
    assert.doesNotMatch(outputText, /完成后回终端按 Enter/u);
    assert.equal(setup.status, 'created');
    assert.equal(setup.setupPlan.buildReadiness.reasonCode, 'setup-user-authorized-browser-evidence');
    assert.equal(setup.setupPlan.userAuthorizedEvidence.authState.status, 'authorized');
    assert.equal(setup.setupPlan.userAuthorizedEvidence.pages[0].normalizedUrl, 'https://x.com/home');
    assert.equal(setup.setupPlan.userAuthorizedEvidence.browserSeeds[0].routeKind, 'home-timeline');
    assert.deepEqual(setup.setupPlan.userAuthorizedEvidence.browserSeeds[0].capabilityIds, ['recommended-timeline-posts']);
    assert.ok(setup.setupPlan.userAuthorizedEvidence.browserSeeds.length >= 4);
    assert.equal(setup.setupPlan.userAuthorizedEvidence.browserSeeds.some((seed) => seed.normalizedUrl === 'https://x.com/explore'), true);
    assert.equal(setup.setupPlan.userAuthorizedEvidence.browserSeeds.some((seed) => seed.normalizedUrl === 'https://x.com/search'), true);
    const savedProfile = JSON.parse(await readFile(setup.paths.savedBuildProfilePath, 'utf8'));
    assert.equal(savedProfile.userAuthorizedEvidence.sessionMaterialPersisted, false);
    assert.equal(savedProfile.userAuthorizedEvidence.browserProfilePersisted, false);
    assert.equal(Object.hasOwn(savedProfile.userAuthorizedEvidence, 'userDataDir'), false);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('interactive x.com setup reviews authorized collection status before missing proof collection', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-x-authorized-review-'));
  try {
    await writeKnownXPolicyConfig(workspace);
    const prompts = [];
    const output = [];
    const setup = await prepareSiteForgeBuildSetup(X_URL, {
      cwd: workspace,
      buildId: 'x-authorized-review-setup',
      now: new Date('2026-05-16T08:12:15.000Z'),
      setupInteractive: true,
      interactive: true,
      auto: true,
      fetchDelayMs: 0,
      setupPrompt: async (question) => {
        prompts.push(question);
        assert.doesNotMatch(question, /可见数量|看得到的条数|逐项补采/u);
        return '读取时间线上被推荐的帖子';
      },
      setupOutput: { write(chunk) { output.push(String(chunk)); } },
      userAuthorizedEvidenceProvider: async () => ({
        capturedAt: '2026-05-16T08:12:16.000Z',
        finalUrl: 'https://x.com/home',
        title: 'X home',
        pages: [{ url: 'https://x.com/home', title: 'X home' }],
        browserSeeds: [{
          url: 'https://x.com/home',
          source: 'user-authorized-normal-browser-route-seed',
          seedType: 'timeline-home',
          routeKind: 'home-timeline',
          capabilityIds: ['recommended-timeline-posts'],
          visibleItemCount: 0,
        }],
      }),
    });

    const outputText = output.join('');
    assert.match(outputText, /准备开始自动构建/u);
    assert.match(outputText, /当前配置/u);
    assert.match(outputText, /可修改配置/u);
    assert.match(outputText, /安全限制/u);
    assert.match(outputText, /操作说明/u);
    assert.match(outputText, /快捷示例/u);
    assert.match(outputText, /输入 项=值 快速修改/u);
    assert.doesNotMatch(outputText, /\n自动探索\n|能力摘要|已启用候选|需确认能力|已禁用或受限能力|\n结果\n/u);
    assert.doesNotMatch(outputText, /SiteForge 首次设置|能力候选与默认选择|默认构建会启用|采集现状|未完成能力|是否现在逐项补采/u);
    assert.equal(prompts.some((question) => /是否现在逐项补采未完成能力|可见数量|看得到的条数/u.test(question)), false);
    assert.equal(setup.profile.userIntentCoverage.supportedRequests[0].id, 'recommended-timeline-posts');
    assert.equal(setup.profile.userAuthorizedEvidence.capabilityProofs.length, 0);
    assert.equal(setup.setupPlan.userAuthorizedCollectionReview.summary.seedCount, 1);
    assert.equal(setup.setupPlan.userAuthorizedCollectionReview.summary.rawMaterialPersisted, false);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('interactive x.com setup loads installed repo policy outside the repository cwd', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-x-installed-policy-'));
  try {
    const openedUrls = [];
    const prompts = [];
    const setup = await prepareSiteForgeBuildSetup(X_URL, {
      cwd: workspace,
      buildId: 'x-installed-policy-setup',
      now: new Date('2026-05-16T08:12:20.000Z'),
      setupInteractive: true,
      interactive: true,
      auto: true,
      fetchDelayMs: 0,
      setupPrompt: async (question) => {
        prompts.push(question);
        return /请选择：1/u.test(question) ? '1' : '';
      },
      setupOutput: { write() {} },
      externalBrowserLauncher: async (url) => {
        openedUrls.push(url);
        return { opened: true };
      },
    });

    assert.deepEqual(openedUrls, [X_URL]);
    assert.equal(prompts.some((question) => /完成后回终端按 Enter/u.test(question)), false);
    assert.equal(prompts.some((question) => /最终授权 URL|最终授权后的站点 URL|可见条数|逐项补采/u.test(question)), false);
    assertKnownXPolicy(setup.setupPlan);
    assert.equal(setup.status, 'created');
    assert.equal(setup.setupPlan.buildReadiness.reasonCode, 'setup-user-authorized-browser-evidence');
    assert.equal(setup.profile.knownSitePolicy.siteKey, 'x');
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('interactive x.com setup rejects unfinished user-authorized login surfaces', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-x-authorized-incomplete-'));
  try {
    await writeKnownXPolicyConfig(workspace);
    let failure;
    await assert.rejects(
      async () => {
        try {
          await prepareSiteForgeBuildSetup(X_URL, {
            cwd: workspace,
            buildId: 'x-authorized-incomplete',
            now: new Date('2026-05-16T08:12:30.000Z'),
            setupInteractive: true,
            interactive: true,
            fetchDelayMs: 0,
            setupPrompt: async () => '',
            setupOutput: { write() {} },
            userAuthorizedEvidenceProvider: async () => ({
              capturedAt: '2026-05-16T08:12:31.000Z',
              finalUrl: 'https://x.com/i/flow/login',
              title: 'Log in to X',
              authState: {
                status: 'incomplete',
                riskSignals: ['login-wall'],
                hasPasswordInput: true,
                finalPath: '/i/flow/login',
              },
              pages: [{ url: 'https://x.com/i/flow/login', title: 'Log in to X' }],
            }),
          });
        } catch (error) {
          failure = error;
          throw error;
        }
      },
      /user-authorized-setup-incomplete/u,
    );

    assert.equal(failure.code, 'user-authorized-setup-incomplete');
    assert.equal(failure.reasonCode, 'login-wall');
    const setupPaths = buildSetupAssistantPaths(X_URL, {
      cwd: workspace,
      buildId: 'x-authorized-incomplete',
      now: new Date('2026-05-16T08:12:30.000Z'),
    });
    assert.equal(await pathExists(setupPaths.savedBuildProfilePath), false);
    assert.equal(await pathExists(setupPaths.buildProfilePath), false);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('interactive x.com setup reports blocked Google identity-provider handoff clearly', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-x-google-blocked-setup-'));
  try {
    await writeKnownXPolicyConfig(workspace);
    let failure;
    await assert.rejects(
      async () => {
        try {
          await prepareSiteForgeBuildSetup(X_URL, {
            cwd: workspace,
            buildId: 'x-google-blocked-setup',
            now: new Date('2026-05-16T08:12:40.000Z'),
            setupInteractive: true,
            interactive: true,
            fetchDelayMs: 0,
            setupPrompt: async () => '',
            setupOutput: { write() {} },
            userAuthorizedEvidenceProvider: async () => ({
              capturedAt: '2026-05-16T08:12:41.000Z',
              finalUrl: 'https://accounts.google.com/signin',
              title: 'Google sign in',
              authState: {
                status: 'incomplete',
                riskSignals: ['identity-provider-blocked-unsafe-browser'],
                hasPasswordInput: false,
                finalPath: '/signin',
              },
              pages: [{ url: 'https://accounts.google.com/signin', title: 'Google sign in' }],
            }),
          });
        } catch (error) {
          failure = error;
          throw error;
        }
      },
      /identity-provider-blocked-unsafe-browser/u,
    );

    assert.equal(failure.code, 'user-authorized-setup-incomplete');
    assert.equal(failure.reasonCode, 'identity-provider-blocked-unsafe-browser');
    const setupPaths = buildSetupAssistantPaths(X_URL, {
      cwd: workspace,
      buildId: 'x-google-blocked-setup',
      now: new Date('2026-05-16T08:12:40.000Z'),
    });
    assert.equal(await pathExists(setupPaths.savedBuildProfilePath), false);
    assert.equal(await pathExists(setupPaths.buildProfilePath), false);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('x.com build with surface-only user-authorized setup gates followed-users as confirmation-required limited read', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-x-authorized-build-'));
  try {
    await writeKnownXPolicyConfig(workspace);
    const setup = await prepareSiteForgeBuildSetup(X_URL, {
      cwd: workspace,
      buildId: 'x-authorized-profile',
      now: new Date('2026-05-16T08:13:00.000Z'),
      setupInteractive: true,
      interactive: true,
      auto: true,
      fetchDelayMs: 0,
      setupPrompt: async () => '',
      setupOutput: { write() {} },
      userAuthorizedEvidenceProvider: async () => ({
        capturedAt: '2026-05-16T08:13:01.000Z',
        finalUrl: 'https://x.com/home',
        title: 'X home',
        pages: [{ url: 'https://x.com/home', title: 'X home' }],
      }),
    });

    const result = await runSiteForgeBuild(X_URL, {
      ...setup.buildOptions,
      cwd: workspace,
      buildId: 'x-authorized-build',
      now: new Date('2026-05-16T08:14:00.000Z'),
      fetchDelayMs: 0,
    });

    assert.equal(result.status, 'success');
    assert.equal(result.summary.verificationStatus, 'passed');
    assert.equal(result.summary.registryStatus, 'registered');
    const capabilities = await readJson(path.join(result.artifactDir, 'capabilities', 'capabilities.json'));
    const legacyFollowed = capabilities.capabilities.find((capability) => capability.name === 'list followed users');
    assert.equal(legacyFollowed, undefined);

    const followed = capabilities.capabilities.find((capability) => capability.name === 'read followed users');
    assert.ok(followed);
    assert.equal(followed.status, 'active');
    assert.equal(followed.enabled_status, 'confirmation_required');
    assert.equal(followed.default_policy, 'confirmation_required');
    assert.equal(followed.executionPlan.autoExecute, false);
    assert.equal(JSON.stringify(followed).includes('cookie'), false);
    assert.equal(JSON.stringify(followed).includes('token'), false);

    const lookup = await lookupSkillIntent({
      registryPath: siteRegistryPath(workspace),
      domain: 'x.com',
      utterance: 'list followed users',
    });
    assert.equal(lookup.status, 'found');
    assert.equal(lookup.capabilityName, 'read followed users');
    assert.equal(result.summary.registryStatus, 'registered');
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('x.com user-authorized build models requested recommended timeline through bounded auto evidence', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-x-recommended-timeline-gap-'));
  try {
    await writeKnownXPolicyConfig(workspace);
    const answers = ['读取时间线上推荐的帖子'];
    const setup = await prepareSiteForgeBuildSetup(X_URL, {
      cwd: workspace,
      buildId: 'x-recommended-timeline-profile',
      now: new Date('2026-05-16T08:14:10.000Z'),
      setupInteractive: true,
      interactive: true,
      auto: true,
      fetchDelayMs: 0,
      setupPrompt: async (question) => {
        assert.doesNotMatch(question, /逐项补采|可见条数/u);
        return answers.shift() ?? '';
      },
      setupOutput: { write() {} },
      userAuthorizedEvidenceProvider: async () => ({
        capturedAt: '2026-05-16T08:14:11.000Z',
        finalUrl: 'https://x.com/home',
        title: 'X home',
        pages: [{ url: 'https://x.com/home', title: 'X home' }],
      }),
    });

    assert.equal(setup.profile.userIntentCoverage.supportedRequests[0].id, 'recommended-timeline-posts');
    assert.equal(setup.profile.userIntentCoverage.unsupportedRequests.length, 0);
    const result = await runSiteForgeBuild(X_URL, {
      ...setup.buildOptions,
      cwd: workspace,
      buildId: 'x-recommended-timeline-build',
      now: new Date('2026-05-16T08:14:20.000Z'),
      fetchDelayMs: 0,
    });
    assert.equal(result.status, 'success');
    const lookup = await lookupSkillIntent({
      registryPath: siteRegistryPath(workspace),
      domain: 'x.com',
      utterance: '读取时间线上推荐的帖子',
    });
    assert.equal(lookup.status, 'found');
    assert.equal(lookup.capabilityName, 'read recommended timeline');
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('x.com user-authorized build activates recommended timeline from sanitized auto discovery evidence', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-x-recommended-timeline-proof-'));
  try {
    await writeKnownXPolicyConfig(workspace);
    const setup = await prepareSiteForgeBuildSetup(X_URL, {
      cwd: workspace,
      buildId: 'x-recommended-timeline-proof-profile',
      now: new Date('2026-05-16T08:14:30.000Z'),
      setupInteractive: true,
      interactive: true,
      fetchDelayMs: 0,
      auto: true,
      setupPrompt: async (question) => {
        assert.doesNotMatch(question, /可见数量|看得到的条数|逐项补采/u);
        return '';
      },
      setupOutput: { write() {} },
      userAuthorizedEvidenceProvider: async () => ({
        capturedAt: '2026-05-16T08:14:31.000Z',
        finalUrl: 'https://x.com/home',
        title: 'X home',
        pages: [{ url: 'https://x.com/home', title: 'X home' }],
      }),
    });

    assert.equal(setup.profile.userAuthorizedEvidence.autoDiscovery.status, 'modeled');
    assert.equal(setup.profile.userAuthorizedEvidence.autoDiscovery.summary.route_templates > 0, true);
    assert.equal(JSON.stringify(setup.profile.userAuthorizedEvidence).includes('cookie'), false);
    assert.equal(JSON.stringify(setup.profile.userAuthorizedEvidence).includes('token'), false);

    const result = await runSiteForgeBuild(X_URL, {
      ...setup.buildOptions,
      cwd: workspace,
      buildId: 'x-recommended-timeline-proof-build',
      now: new Date('2026-05-16T08:14:40.000Z'),
      fetchDelayMs: 0,
    });

    assert.equal(result.status, 'success');
    assert.equal(result.summary.verificationStatus, 'passed');
    assert.equal(result.summary.registryStatus, 'registered');
    const capabilities = await readJson(path.join(result.artifactDir, 'capabilities', 'capabilities.json'));
    const timeline = capabilities.capabilities.find((capability) => capability.name === 'read recommended timeline');
    assert.ok(timeline);
    assert.equal(timeline.status, 'active');
    assert.equal(timeline.executionPlan.autoExecute, false);

    const lookup = await lookupSkillIntent({
      registryPath: siteRegistryPath(workspace),
      domain: 'x.com',
      utterance: '读取时间线上被推荐的帖子',
    });
    assert.equal(lookup.status, 'found');
    assert.equal(lookup.capabilityName, 'read recommended timeline');
    assert.match(lookup.executionPlanId, /read-recommended-timeline/u);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('x.com supplemental collection accepts final URL after explicit continue', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-x-recommended-timeline-url-proof-'));
  try {
    await writeKnownXPolicyConfig(workspace);
    const answers = [
      'yes',
      '读取时间线上被推荐的帖子',
      '继续',
      'https://x.com/home?access_token=example&utm_source=test',
    ];
    const setup = await prepareSiteForgeBuildSetup(X_URL, {
      cwd: workspace,
      buildId: 'x-recommended-timeline-url-proof-profile',
      now: new Date('2026-05-16T08:14:35.000Z'),
      setupInteractive: true,
      interactive: true,
      fetchDelayMs: 0,
      setupPrompt: async () => answers.shift() ?? '',
      setupOutput: { write() {} },
      userAuthorizedEvidenceProvider: async () => ({
        capturedAt: '2026-05-16T08:14:36.000Z',
        finalUrl: 'https://x.com/home',
        title: 'X home',
        pages: [{ url: 'https://x.com/home', title: 'X home' }],
      }),
    });

    const proof = setup.profile.userAuthorizedEvidence.capabilityProofs[0];
    assert.equal(proof.setupCapabilityId, 'recommended-timeline-posts');
    assert.equal(proof.evidenceType, 'manual-visible-browser-final-url');
    assert.equal(proof.sampleCount, 1);
    assert.equal(JSON.stringify(setup.profile.userAuthorizedEvidence).includes('access_token'), false);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('x.com user-authorized browser seed scan activates recommended timeline without manual count prompt', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-x-recommended-timeline-seed-'));
  try {
    await writeKnownXPolicyConfig(workspace);
    const setup = await prepareSiteForgeBuildSetup(X_URL, {
      cwd: workspace,
      buildId: 'x-recommended-timeline-seed-profile',
      now: new Date('2026-05-16T08:14:50.000Z'),
      setupInteractive: true,
      interactive: true,
      auto: true,
      fetchDelayMs: 0,
      setupPrompt: async (question) => {
        assert.doesNotMatch(question, /可见条数/u);
        return '读取时间线上被推荐的帖子';
      },
      setupOutput: { write() {} },
      userAuthorizedEvidenceProvider: async () => ({
        capturedAt: '2026-05-16T08:14:51.000Z',
        finalUrl: 'https://x.com/home',
        title: 'X home',
        pages: [{ url: 'https://x.com/home', title: 'X home' }],
        browserSeeds: [{
          url: 'https://x.com/home',
          source: 'controlled-user-authorized-browser-seed-scan',
          seedType: 'timeline-home',
          routeKind: 'home-timeline',
          capabilityIds: ['recommended-timeline-posts'],
          visibleItemCount: 4,
          articleLikeCount: 4,
          feedLikeCount: 1,
        }],
      }),
    });

    assert.equal(setup.profile.userAuthorizedEvidence.browserSeeds[0].seedType, 'timeline-home');
    assert.equal(setup.profile.userAuthorizedEvidence.capabilityProofs[0].setupCapabilityId, 'recommended-timeline-posts');
    assert.equal(setup.profile.userAuthorizedEvidence.capabilityProofs[0].evidenceType, 'authorized-browser-seed-scan');
    assert.equal(setup.profile.userAuthorizedEvidence.capabilityProofs[0].sampleCount, 4);
    assert.equal(JSON.stringify(setup.profile.userAuthorizedEvidence).includes('cookie'), false);
    assert.equal(JSON.stringify(setup.profile.userAuthorizedEvidence).includes('token'), false);

    const result = await runSiteForgeBuild(X_URL, {
      ...setup.buildOptions,
      cwd: workspace,
      buildId: 'x-recommended-timeline-seed-build',
      now: new Date('2026-05-16T08:14:55.000Z'),
      fetchDelayMs: 0,
    });

    assert.equal(result.status, 'success');
    assert.equal(result.summary.verificationStatus, 'passed');
    const capabilities = await readJson(path.join(result.artifactDir, 'capabilities', 'capabilities.json'));
    const timeline = capabilities.capabilities.find((capability) => capability.name === 'list recommended timeline posts');
    assert.ok(timeline);
    assert.equal(timeline.status, 'active');
    assert.equal(timeline.evidence_status, 'verified');

    const lookup = await lookupSkillIntent({
      registryPath: siteRegistryPath(workspace),
      domain: 'x.com',
      utterance: '读取时间线上被推荐的帖子',
    });
    assert.equal(lookup.status, 'found');
    assert.equal(lookup.capabilityName, 'list recommended timeline posts');
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('x.com normal browser route seed auto-registers bounded recommended timeline without visible-count prompt', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-x-normal-browser-route-seed-'));
  try {
    await writeKnownXPolicyConfig(workspace);
    const openedUrls = [];
    let sawManualPrompt = false;
    const setup = await prepareSiteForgeBuildSetup(X_URL, {
      cwd: workspace,
      buildId: 'x-normal-browser-route-seed-profile',
      now: new Date('2026-05-16T08:15:10.000Z'),
      setupInteractive: true,
      interactive: true,
      fetchDelayMs: 0,
      setupPrompt: async (question) => {
        if (/最终授权后的站点 URL|可见|逐项补采/u.test(question)) {
          sawManualPrompt = true;
        }
        return /请选择：1/u.test(question) ? '1' : '';
      },
      setupOutput: { write() {} },
      externalBrowserLauncher: async (url) => {
        openedUrls.push(url);
        return { opened: true };
      },
    });

    assert.deepEqual(openedUrls, [X_URL]);
    assert.equal(sawManualPrompt, false);
    assert.equal(setup.profile.userAuthorizedEvidence.browserSeeds[0].source, 'user-authorized-normal-browser-route-seed');
    assert.ok(setup.profile.userAuthorizedEvidence.browserSeeds.length >= 4);
    assert.equal(setup.profile.userAuthorizedEvidence.browserSeeds.every((seed) => Number(seed.visibleItemCount ?? 0) === 0), true);
    const timelineProof = setup.profile.userAuthorizedEvidence.capabilityProofs
      .find((proof) => proof.setupCapabilityId === 'recommended-timeline-posts');
    assert.equal(timelineProof, undefined);

    const result = await runSiteForgeBuild(X_URL, {
      ...setup.buildOptions,
      cwd: workspace,
      buildId: 'x-normal-browser-route-seed-build',
      now: new Date('2026-05-16T08:15:20.000Z'),
      fetchDelayMs: 0,
    });

    assert.equal(result.status, 'success');
    assert.ok(result.summary.seeds >= 4);
    assert.ok(result.summary.nodes >= 8);
    assert.ok(result.summary.affordances >= 6);
    assert.ok(result.summary.capabilities.active >= 2);
    assert.ok(result.summary.capabilities.candidate >= 1);
    assert.ok(result.summary.unsuccessfulCollections >= 1);
    const capabilities = await readJson(result.artifacts['capabilities.json']);
    const candidateCapabilities = capabilities.capabilities.filter((capability) => capability.status === 'candidate');
    const candidateNames = new Set(candidateCapabilities.map((capability) => capability.name));
    const expectedCandidateNames = [
      'capture network APIs',
    ];
    for (const candidateName of expectedCandidateNames) {
      assert.equal(candidateNames.has(candidateName), true, `${candidateName} should remain candidate-only`);
    }
    assert.equal(candidateCapabilities.every((capability) => !capability.executionPlan), true);
    const registry = await readJson(siteRegistryPath(workspace));
    const registeredCapabilityIds = new Set(registry.skills.flatMap((skill) => (
      skill.intents ?? []
    ).map((intent) => intent.capabilityId)));
    const registeredCapabilityNames = new Set(registry.skills.flatMap((skill) => (
      skill.intents ?? []
    ).map((intent) => intent.capabilityName)));
    for (const candidate of candidateCapabilities) {
      assert.equal(registeredCapabilityIds.has(candidate.id), false, `${candidate.name} candidate must not be registered by id`);
    }
    for (const candidateName of expectedCandidateNames) {
      assert.equal(registeredCapabilityNames.has(candidateName), false, `${candidateName} candidate must not be registered by name`);
    }
    assert.ok(result.collectionOutcomes.unsuccessful.some((item) => (
      item.kind === 'capability'
      && item.target === 'capture network APIs'
      && item.status === 'candidate'
    )));
    for (const candidateName of expectedCandidateNames) {
      assert.ok(result.collectionOutcomes.unsuccessful.some((item) => (
        item.kind === 'capability'
        && item.target === candidateName
        && item.status === 'candidate'
      )), `${candidateName} candidate should be listed as unsuccessful collection`);
    }
    assert.ok(result.collectionOutcomes.unsuccessful.some((item) => (
      item.kind === 'stage'
      && item.target === 'captureNetworkTraces'
      && item.status === 'skipped'
    )));
    const summaryText = renderSiteForgeBuildSummary(result, { cwd: workspace });
    assert.match(summaryText, /✓ 构建完成/u);
    assert.match(summaryText, /▶ 能力统计/u);
    assert.doesNotMatch(summaryText, /\u672a\u6210\u529f\u91c7\u96c6|逐项补采/u);
    const treeLines = summaryText.split(/\r?\n/u).filter((line) => /[▶▼]\s/u.test(line));
    assert.equal(treeLines.length > 0, true);
    const lookup = await lookupSkillIntent({
      registryPath: siteRegistryPath(workspace),
      domain: 'x.com',
      utterance: '读取时间线上被推荐的帖子',
    });
    assert.equal(lookup.status, 'found');
    assert.equal(lookup.capabilityName, 'read recommended timeline');
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('x.com build activates followed-users only with sanitized capability proof', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-x-authorized-proof-build-'));
  try {
    await writeKnownXPolicyConfig(workspace);
    const setup = await prepareSiteForgeBuildSetup(X_URL, {
      cwd: workspace,
      buildId: 'x-authorized-proof-profile',
      now: new Date('2026-05-16T08:15:00.000Z'),
      setupInteractive: true,
      interactive: true,
      fetchDelayMs: 0,
      setupPrompt: async () => '关注列表',
      setupOutput: { write() {} },
      userAuthorizedEvidenceProvider: async () => ({
        capturedAt: '2026-05-16T08:15:01.000Z',
        finalUrl: 'https://x.com/home',
        title: 'X home',
        pages: [{ url: 'https://x.com/home', title: 'X home' }],
        capabilityProofs: [{
          setupCapabilityId: 'list-followed-users',
          action: 'followed-users',
          status: 'verified',
          evidenceType: 'redacted-count-summary',
          sampleCount: 3,
          source: 'authorized adapter dry-run summary',
        }],
      }),
    });

    const result = await runSiteForgeBuild(X_URL, {
      ...setup.buildOptions,
      cwd: workspace,
      buildId: 'x-authorized-proof-build',
      now: new Date('2026-05-16T08:16:00.000Z'),
      fetchDelayMs: 0,
    });

    assert.equal(result.status, 'success');
    const capabilities = await readJson(path.join(result.artifactDir, 'capabilities', 'capabilities.json'));
    const followed = capabilities.capabilities.find((capability) => capability.name === 'list followed users');
    assert.ok(followed);
    assert.equal(followed.status, 'active');
    assert.equal(followed.capabilityVerified, true);
    assert.equal(followed.proofSummary.sampleCount, 3);
    assert.equal(JSON.stringify(followed).includes('cookie'), false);

    const lookup = await lookupSkillIntent({
      registryPath: siteRegistryPath(workspace),
      domain: 'x.com',
      utterance: 'list followed users',
    });
    assert.equal(lookup.status, 'found');
    assert.equal(lookup.capabilityName, 'list followed users');
    assert.match(lookup.executionPlanId, /list-followed-users/u);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('public SiteForge build x.com uses known-site auto discovery without generic live collection prompts', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-x-cli-setup-'));
  try {
    await writeKnownXPolicyConfig(workspace);
    const result = spawnSync(process.execPath, [CLI_PATH, 'build', X_URL], {
      cwd: workspace,
      encoding: 'utf8',
      env: {
        ...process.env,
        ALL_PROXY: '',
        all_proxy: '',
        HTTP_PROXY: '',
        http_proxy: '',
        HTTPS_PROXY: '',
        https_proxy: '',
        NO_PROXY: '*',
        no_proxy: '*',
        PYTHONIOENCODING: 'utf-8',
        PYTHONUTF8: '1',
      },
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /✓ 构建完成/u);
    assert.match(result.stdout, /▶ 自动探索/u);
    assert.match(result.stdout, /▶ 能力统计/u);
    assert.match(result.stdout, /▼ 待确认能力/u);
    assert.doesNotMatch(result.stdout, /请粘贴最终 URL|输入可见条数|逐项补采|setup-evidence-not-buildable/u);

    const buildDirs = await listBuildDirs(siteBuildsDir(workspace, X_URL));
    assert.equal(buildDirs.length, 1);
    const buildReport = await readJson(path.join(buildDirs[0], 'build_report.json'));
    const setupPaths = buildSetupAssistantPaths(X_URL, {
      cwd: workspace,
      buildId: path.basename(buildDirs[0]),
    });
    const setupPlan = await readJson(setupPaths.setupPlanPath);
    assertKnownXPolicy(setupPlan);
    assert.equal(setupPlan.robots.disallowPaths.includes('/'), true);
    assert.equal(setupPlan.sourceDiagnostics.length, 0);
    assert.equal(buildReport.status, 'success');
    assert.equal(buildReport.summary.registryStatus, 'registered');
    assert.equal(buildReport.summary.highRiskAutoExecuted, false);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('x.com legacy saved setup profile cannot bypass current evidence gates or create runtime lookup', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-x-legacy-profile-'));
  try {
    await writeKnownXPolicyConfig(workspace);
    const setupPaths = buildSetupAssistantPaths(X_URL, {
      cwd: workspace,
      buildId: 'x-legacy-profile-seed',
      now: new Date('2026-05-16T08:20:00.000Z'),
    });
    await mkdir(setupPaths.setupDir, { recursive: true });
    await writeFile(setupPaths.savedBuildProfilePath, `${JSON.stringify({
      artifactFamily: 'siteforge-build-profile',
      site: {
        rootUrl: X_URL,
        normalizedUrl: X_URL,
      },
      source: 'legacy-test-fixture',
      scope: {
        maxDepth: 1,
        maxPages: 1,
        maxSeeds: 1,
        maxSitemaps: 1,
      },
      safety: {
        submitForms: false,
        allowDestructiveActions: false,
        allowPayment: false,
        allowAccountMutation: false,
        allowContactSubmit: false,
      },
      capabilityScope: {
        selectedCapabilities: [{ id: 'search-posts', name: 'search posts' }],
        disabledCapabilities: [],
      },
    }, null, 2)}\n`, 'utf8');

    let failure;
    await assert.rejects(
      async () => {
        try {
          await prepareSiteForgeBuildSetup(X_URL, {
            cwd: workspace,
            buildId: 'x-legacy-profile-rejected',
            now: new Date('2026-05-16T08:21:00.000Z'),
            setupInteractive: false,
            interactive: false,
            noTty: true,
            fetchDelayMs: 0,
          });
        } catch (error) {
          failure = error;
          throw error;
        }
      },
      /setup-evidence-not-buildable/u,
    );

    assert.equal(failure.code, 'setup-evidence-not-buildable');
    assert.equal(failure.reasonCode, 'setup-known-policy-robots-disallowed');
    assert.equal(await pathExists(failure.buildProfilePath), false);
    assert.equal(await pathExists(path.join(failure.artifactDir, 'skill', 'skill.yaml')), false);
    const setupPlan = await readJson(failure.setupPlanPath);
    assertKnownXPolicy(setupPlan);

    const lookup = await lookupSkillIntent({
      registryPath: siteRegistryPath(workspace),
      domain: 'x.com',
      utterance: 'search posts',
    });
    assert.equal(lookup.status, 'not_found');
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('x.com saved profile with user hints must include userIntentCoverage before reuse', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-x-legacy-hint-profile-'));
  try {
    await writeKnownXPolicyConfig(workspace);
    const setupPaths = buildSetupAssistantPaths(X_URL, {
      cwd: workspace,
      buildId: 'x-legacy-hint-profile-seed',
      now: new Date('2026-05-16T08:22:00.000Z'),
    });
    await mkdir(setupPaths.setupDir, { recursive: true });
    await writeFile(setupPaths.savedBuildProfilePath, `${JSON.stringify({
      artifactFamily: 'siteforge-build-profile',
      site: {
        id: 'x.com-326a6450',
        rootUrl: X_URL,
        normalizedUrl: X_URL,
        allowedDomains: ['x.com'],
      },
      source: 'legacy-hint-test-fixture',
      scope: {
        maxDepth: 2,
        maxPages: 10,
        maxSeeds: 25,
        maxSitemaps: 10,
        renderJs: true,
        captureNetwork: true,
      },
      safety: {
        submitForms: false,
        allowDestructiveActions: false,
        allowPayment: false,
        allowAccountMutation: false,
        allowContactSubmit: false,
      },
      evidenceQuality: {
        sourceAvailability: { robots: true, homepage: false, sitemap: false, userAuthorizedBrowser: true },
        sourceStatus: { robots: 'parsed', homepage: 'robots_disallowed', sitemap: 'unavailable', userAuthorizedBrowser: 'captured' },
        userAuthorizedBrowserEvidenceCount: 1,
        actualPageEvidenceCount: 1,
      },
      buildReadiness: {
        status: 'ready',
        buildable: true,
        reasonCode: 'setup-user-authorized-browser-evidence',
        reason: 'User-authorized browser evidence was captured for a bounded known-site adapter path.',
      },
      profileUsability: {
        status: 'usable',
        buildable: true,
      },
      capabilityScope: {
        selectedCapabilities: [{ id: 'list-followed-updates', name: 'List followed updates', evidenceRequirement: 'capability-specific-evidence' }],
        disabledCapabilities: [],
      },
      userHints: ['读取时间线上推荐的帖子'],
      userAuthorizedEvidence: {
        status: 'captured',
        pages: [{ url: 'https://x.com/home', normalizedUrl: 'https://x.com/home', title: 'X home' }],
        sessionMaterialPersisted: false,
        browserProfilePersisted: false,
        rawHtmlPersisted: false,
        rawCookiePersisted: false,
        rawCredentialPersisted: false,
      },
    }, null, 2)}\n`, 'utf8');

    let failure;
    await assert.rejects(
      async () => {
        try {
          await prepareSiteForgeBuildSetup(X_URL, {
            cwd: workspace,
            buildId: 'x-legacy-hint-profile-rejected',
            now: new Date('2026-05-16T08:23:00.000Z'),
            setupInteractive: false,
            interactive: false,
            noTty: true,
            fetchDelayMs: 0,
          });
        } catch (error) {
          failure = error;
          throw error;
        }
      },
      /setup-evidence-not-buildable/u,
    );

    assert.equal(failure.code, 'setup-evidence-not-buildable');
    assert.equal(failure.reasonCode, 'setup-known-policy-robots-disallowed');
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('x.com stale saved profile with unsupported recommended timeline hint re-enters setup for proof', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-x-stale-recommended-profile-'));
  try {
    await writeKnownXPolicyConfig(workspace);
    const setupPaths = buildSetupAssistantPaths(X_URL, {
      cwd: workspace,
      buildId: 'x-stale-recommended-profile-seed',
      now: new Date('2026-05-16T08:24:00.000Z'),
    });
    await mkdir(setupPaths.setupDir, { recursive: true });
    await writeFile(setupPaths.savedBuildProfilePath, `${JSON.stringify({
      artifactFamily: 'siteforge-build-profile',
      site: {
        id: 'x.com-326a6450',
        rootUrl: X_URL,
        normalizedUrl: X_URL,
        allowedDomains: ['x.com'],
      },
      source: 'stale-recommended-timeline-profile',
      scope: {
        maxDepth: 2,
        maxPages: 10,
        maxSeeds: 25,
        maxSitemaps: 10,
        renderJs: true,
        captureNetwork: true,
      },
      safety: {
        submitForms: false,
        allowDestructiveActions: false,
        allowPayment: false,
        allowAccountMutation: false,
        allowContactSubmit: false,
      },
      evidenceQuality: {
        sourceAvailability: { robots: true, homepage: false, sitemap: false, userAuthorizedBrowser: true },
        sourceStatus: { robots: 'parsed', homepage: 'robots_disallowed', sitemap: 'unavailable', userAuthorizedBrowser: 'captured' },
        userAuthorizedBrowserEvidenceCount: 1,
        actualPageEvidenceCount: 1,
      },
      buildReadiness: {
        status: 'ready',
        buildable: true,
        reasonCode: 'setup-user-authorized-browser-evidence',
        reason: 'User-authorized browser evidence was captured for a bounded known-site adapter path.',
      },
      profileUsability: {
        status: 'usable',
        buildable: true,
      },
      capabilityScope: {
        selectedCapabilities: [{ id: 'recommended-timeline-posts', name: 'List recommended timeline posts', evidenceRequirement: 'capability-specific-evidence' }],
        disabledCapabilities: [],
      },
      userHints: ['读取时间线上推荐的帖子'],
      userIntentCoverage: {
        unsupportedRequests: [{ id: 'recommended-timeline-posts', label: 'recommended timeline posts' }],
        supportedRequests: [],
        unmatchedRequests: [],
      },
      userAuthorizedEvidence: {
        status: 'captured',
        pages: [{ url: 'https://x.com/home', normalizedUrl: 'https://x.com/home', title: 'X home' }],
        capabilityProofs: [],
        sessionMaterialPersisted: false,
        browserProfilePersisted: false,
        rawHtmlPersisted: false,
        rawCookiePersisted: false,
        rawCredentialPersisted: false,
      },
    }, null, 2)}\n`, 'utf8');

    const setup = await prepareSiteForgeBuildSetup(X_URL, {
      cwd: workspace,
      buildId: 'x-stale-recommended-profile-rebuilt',
      now: new Date('2026-05-16T08:25:00.000Z'),
      setupInteractive: true,
      interactive: true,
      auto: true,
      manualSupplementalCollection: true,
      fetchDelayMs: 0,
      setupPrompt: async (question) => {
        if (/yes\/y/u.test(question)) {
          return 'yes';
        }
        if (/推荐时间线|数量|URL/u.test(question)) {
          return '2';
        }
        return '';
      },
      setupOutput: { write() {} },
      userAuthorizedEvidenceProvider: async () => ({
        capturedAt: '2026-05-16T08:25:01.000Z',
        finalUrl: 'https://x.com/home',
        title: 'X home',
        pages: [{ url: 'https://x.com/home', title: 'X home' }],
      }),
    });

    assert.equal(setup.status, 'created');
    assert.notEqual(setup.profile.source, 'stale-recommended-timeline-profile');
    assert.equal(setup.profile.userAuthorizedEvidence.autoDiscovery.status, 'modeled');
    assert.equal(setup.profile.userAuthorizedEvidence.sessionMaterialPersisted, false);
    assert.equal(setup.profile.userAuthorizedEvidence.rawHtmlPersisted, false);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
