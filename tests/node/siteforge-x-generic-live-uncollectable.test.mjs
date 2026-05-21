import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import {
  createBuildSource,
  lookupSkillIntent,
  runSiteForgeBuild,
  stableSiteIdFromUrl,
} from '../../src/app/pipeline/build/index.mjs';
import {
  buildSetupAssistantPaths,
  parseContinueUncollectedCollectionAnswer,
  parseSupplementalCollectionEvidenceInput,
  prepareSiteForgeBuildSetup,
} from '../../src/app/pipeline/build/setup-assistant.mjs';
import {
  testHtmlPage,
  testRobotsTxt,
  withTestSite,
} from './helpers/test-site-server.mjs';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIR, '..', '..');
const X_URL = 'https://x.com/';

test('setup assistant parses uncollected-collection yes/no safely', () => {
  for (const answer of ['', 'no', 'n', 'skip', 'maybe']) {
    assert.equal(parseContinueUncollectedCollectionAnswer(answer).continue, false, answer);
  }
  for (const answer of ['yes', 'y', 'continue']) {
    assert.equal(parseContinueUncollectedCollectionAnswer(answer).continue, true, answer);
  }
});

test('setup assistant accepts only sanitized final URL or visible count for supplemental collection', () => {
  const site = { rootUrl: X_URL, allowedDomains: ['x.com'] };
  const count = parseSupplementalCollectionEvidenceInput('3 items', site);
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

async function writeKnownXPolicyConfig(workspace, baseUrl = X_URL) {
  const host = new URL(baseUrl).hostname;
  const configDir = path.join(workspace, 'config');
  await mkdir(configDir, { recursive: true });
  await writeFile(path.join(configDir, 'site-registry.json'), `${JSON.stringify({
    version: 1,
    sites: {
      [host]: {
        canonicalBaseUrl: baseUrl,
        host,
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
            'user-authorized bounded X SiteAdapter workflow',
            'deterministic local HTTP validation',
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
      [host]: {
        baseUrl,
        host,
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
            'user-authorized bounded X SiteAdapter workflow',
            'deterministic local HTTP validation',
          ],
        },
      },
    },
  }, null, 2)}\n`, 'utf8');
}

function assertKnownXPolicy(setupPlan, expectedHost = 'x.com') {
  assert.equal(setupPlan.knownSitePolicy.status, 'matched');
  assert.equal(setupPlan.knownSitePolicy.host, expectedHost);
  assert.equal(setupPlan.knownSitePolicy.siteKey, 'x');
  assert.equal(setupPlan.knownSitePolicy.adapterId, 'x');
  assert.equal(setupPlan.knownSitePolicy.siteAccessStatus, 'blocked_live_robots_disallowed');
  assert.equal(setupPlan.knownSitePolicy.setupConstraints.userChoicesBypassPolicy, false);
  assert.equal(setupPlan.knownSitePolicy.setupConstraints.genericLiveBuildStatus, 'blocked');
  assert.equal(setupPlan.knownSitePolicy.setupConstraints.genericLiveBuildReasonCode, 'robots-disallowed');
  assert.equal(setupPlan.knownSitePolicy.genericLiveBuild.status, 'blocked');
  assert.equal(setupPlan.knownSitePolicy.genericLiveBuild.reasonCode, 'robots-disallowed');
  assert.match(setupPlan.knownSitePolicy.genericLiveBuild.reason, /generic SiteForge live crawler/u);
  assert.equal(setupPlan.knownSitePolicy.genericLiveBuild.alternativeAccessPaths.some((entry) => /deterministic local HTTP validation/u.test(entry)), true);
  assert.equal(setupPlan.knownSitePolicy.capabilityFamilies.includes('query-social-content'), true);
  assert.equal(setupPlan.knownSitePolicy.capabilityFamilies.includes('query-social-relations'), true);
  assert.equal(setupPlan.knownSitePolicy.supportedIntents.includes('search-posts'), true);
  assert.equal(setupPlan.warnings.some((warning) => warning.includes('known site policy loaded for x')), true);
}

function siteRegistryPath(workspace, baseUrl = X_URL) {
  return path.join(workspace, '.siteforge', 'sites', stableSiteIdFromUrl(baseUrl), 'registry.json');
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
  assert.equal(registryRecord.genericLiveBuild.alternativeAccessPaths.some((pathValue) => /deterministic local HTTP validation/u.test(pathValue)), true);
  assert.equal(registryRecord.accessSignals.restrictionSignals.includes('robots.txt Disallow: / for generic crawlers'), true);

  assert.equal(capabilityRecord.siteAccessStatus, 'blocked_live_robots_disallowed');
  assert.equal(capabilityRecord.genericLiveBuild.status, 'blocked');
  assert.equal(capabilityRecord.genericLiveBuild.reasonCode, 'robots-disallowed');
  assert.equal(capabilityRecord.routingNotes.some((note) => /do not promote profile, timeline, search, media, archive, account, or API capabilities/u.test(note)), true);
});

test('createBuildSource reads only through live HTTP source', async () => {
  await withTestSite((rootUrl) => ({
    '/robots.txt': testRobotsTxt(rootUrl),
    '/': testHtmlPage('Live source only', '<main><a href="/profile">Profile</a></main>'),
  }), async (rootUrl) => {
    const source = createBuildSource(rootUrl, { fetchDelayMs: 0 });
    const response = await source.read(rootUrl);

    assert.equal(source.type, 'live_website');
    assert.equal(source.requestedUrl, rootUrl);
    assert.equal(response.sourceType, 'live_website');
    assert.equal(response.requestedUrl, rootUrl);
    assert.equal(response.finalUrl, rootUrl);
    assert.match(response.body, /Live source only/u);
  });
});

test('known social policy generic static build stops at robots Disallow before crawl, skill, or runtime registration', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-x-robots-build-'));
  try {
    let failure;
    let liveRootUrl = '';
    await withTestSite((rootUrl) => ({
      '/robots.txt': testRobotsTxt(rootUrl, { disallow: '/', sitemap: false }),
      '/': testHtmlPage('Blocked social home', '<main>blocked</main>'),
    }), async (rootUrl) => {
      liveRootUrl = rootUrl;
      await writeKnownXPolicyConfig(workspace, rootUrl);
      await assert.rejects(
        async () => {
          try {
            await runSiteForgeBuild(rootUrl, {
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
    });

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

    const registry = await readJson(siteRegistryPath(workspace, liveRootUrl));
    assert.deepEqual(registry.skills, []);
    const lookup = await lookupSkillIntent({
      registryPath: siteRegistryPath(workspace, liveRootUrl),
      domain: new URL(liveRootUrl).hostname,
      utterance: 'search posts',
    });
    assert.equal(lookup.status, 'not_found');
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('known social policy and robots Disallow make noninteractive setup not buildable without prompting', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-x-setup-noninteractive-'));
  try {
    let prompted = false;
    let failure;
    let liveRootUrl = '';
    await withTestSite((rootUrl) => ({
      '/robots.txt': testRobotsTxt(rootUrl, { disallow: '/', sitemap: false }),
      '/': testHtmlPage('Blocked social setup', '<main>blocked</main>'),
    }), async (rootUrl) => {
      liveRootUrl = rootUrl;
      await writeKnownXPolicyConfig(workspace, rootUrl);
      await assert.rejects(
        async () => {
          try {
            await prepareSiteForgeBuildSetup(rootUrl, {
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
    });

    assert.equal(prompted, false);
    assert.equal(failure.code, 'setup-evidence-not-buildable');
    assert.equal(failure.reasonCode, 'setup-known-policy-robots-disallowed');
    assert.equal(await pathExists(failure.setupPlanPath), true);
    assert.equal(await pathExists(failure.buildProfilePath), false);
    assert.equal(await pathExists(failure.savedBuildProfilePath), false);

    const setupPlan = await readJson(failure.setupPlanPath);
    assertKnownXPolicy(setupPlan, new URL(liveRootUrl).hostname);
    assert.equal(setupPlan.summary.buildable, false);
    assert.equal(setupPlan.buildReadiness.reasonCode, 'setup-known-policy-robots-disallowed');
    assert.equal(setupPlan.evidenceQuality.knownPolicyCapabilityPressure.hasPolicyCapabilities, true);
    assert.equal(setupPlan.evidenceQuality.robotsExcludedAllCandidateEvidence, true);
    assert.equal(setupPlan.evidenceQuality.actualPageEvidenceCount, 0);
    assert.equal(setupPlan.evidenceQuality.robotsExcludedPageEvidenceUrls.includes(liveRootUrl), true);
    assert.equal(setupPlan.collectionReview.artifactFamily, 'siteforge-collection-review');
    assert.equal(setupPlan.collectionReview.summary.seeds.missing > 0, true);
    assert.equal(setupPlan.collectionReview.capabilities.missing.some((item) => item.id === 'query-social-content'), true);
    assert.equal(setupPlan.collectionReview.intents.missing.some((item) => item.id === 'search-posts'), true);
    assert.equal(setupPlan.recommendedCapabilities.every((capability) => capability.recommended === false), true);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('legacy userAuthorizedEvidenceProvider cannot verify login or bypass setup gates', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-x-legacy-provider-'));
  try {
    let paths;
    let liveRootUrl = '';
    let providerCalls = 0;
    let failure;
    await withTestSite((rootUrl) => ({
      '/robots.txt': testRobotsTxt(rootUrl, { disallow: '/', sitemap: false }),
      '/': testHtmlPage('Blocked social provider', '<main>blocked</main>'),
    }), async (rootUrl) => {
      liveRootUrl = rootUrl;
      await writeKnownXPolicyConfig(workspace, rootUrl);
      paths = buildSetupAssistantPaths(rootUrl, {
        cwd: workspace,
        buildId: 'x-legacy-provider-rejected',
        now: new Date('2026-05-16T08:11:00.000Z'),
      });
      await assert.rejects(
        async () => {
          try {
            await prepareSiteForgeBuildSetup(rootUrl, {
              cwd: workspace,
              buildId: 'x-legacy-provider-rejected',
              now: new Date('2026-05-16T08:11:00.000Z'),
              setupInteractive: false,
              interactive: false,
              noTty: true,
              fetchDelayMs: 0,
              userAuthorizedEvidenceProvider: async () => {
                providerCalls += 1;
                return {
                  capturedAt: '2026-05-16T08:11:01.000Z',
                  finalUrl: new URL('/home', rootUrl).toString(),
                  pages: [{ url: new URL('/home', rootUrl).toString(), title: 'private title must be ignored' }],
                };
              },
            });
          } catch (error) {
            failure = error;
            throw error;
          }
        },
        /setup-evidence-not-buildable/u,
      );
    });

    assert.equal(providerCalls, 0);
    assert.equal(failure.code, 'setup-evidence-not-buildable');
    assert.equal(failure.reasonCode, 'setup-known-policy-robots-disallowed');

    const setupPlan = await readJson(failure.setupPlanPath);
    const authReport = await readJson(paths.authStateReportPath);
    assertKnownXPolicy(setupPlan, new URL(liveRootUrl).hostname);
    assert.equal(setupPlan.crawlContract.crawlMode, 'public_only');
    assert.equal(setupPlan.crawlContract.authChoice, 'declined');
    assert.equal(setupPlan.authStateReport.verified, false);
    assert.equal(authReport.verified, false);
    assert.equal(authReport.rawMaterialPersisted, false);
    assert.equal(authReport.sessionMaterialPersisted, false);
    assert.equal(authReport.browserProfilePersisted, false);
    assert.equal(JSON.stringify(setupPlan).includes('private title must be ignored'), false);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('retired saved setup profile cannot bypass current evidence gates or create runtime lookup', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-x-legacy-profile-'));
  try {
    let failure;
    let liveRootUrl = '';
    await withTestSite((rootUrl) => ({
      '/robots.txt': testRobotsTxt(rootUrl, { disallow: '/', sitemap: false }),
      '/': testHtmlPage('Blocked social legacy profile', '<main>blocked</main>'),
    }), async (rootUrl) => {
      liveRootUrl = rootUrl;
      await writeKnownXPolicyConfig(workspace, rootUrl);
      const setupPaths = buildSetupAssistantPaths(rootUrl, {
        cwd: workspace,
        buildId: 'x-legacy-profile-seed',
        now: new Date('2026-05-16T08:20:00.000Z'),
      });
      await mkdir(setupPaths.setupDir, { recursive: true });
      await writeFile(setupPaths.savedBuildProfilePath, `${JSON.stringify({
        artifactFamily: 'siteforge-build-profile',
        site: {
          rootUrl,
          normalizedUrl: rootUrl,
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

      await assert.rejects(
        async () => {
          try {
            await prepareSiteForgeBuildSetup(rootUrl, {
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
    });

    assert.equal(failure.code, 'setup-evidence-not-buildable');
    assert.equal(failure.reasonCode, 'setup-known-policy-robots-disallowed');
    assert.equal(await pathExists(failure.buildProfilePath), false);
    assert.equal(await pathExists(path.join(failure.artifactDir, 'skill', 'skill.yaml')), false);
    const setupPlan = await readJson(failure.setupPlanPath);
    assertKnownXPolicy(setupPlan, new URL(liveRootUrl).hostname);

    const lookup = await lookupSkillIntent({
      registryPath: siteRegistryPath(workspace, liveRootUrl),
      domain: new URL(liveRootUrl).hostname,
      utterance: 'search posts',
    });
    assert.equal(lookup.status, 'not_found');
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('saved profile with user hints must include userIntentCoverage before reuse', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-x-legacy-hint-profile-'));
  try {
    let failure;
    await withTestSite((rootUrl) => ({
      '/robots.txt': testRobotsTxt(rootUrl, { disallow: '/', sitemap: false }),
      '/': testHtmlPage('Blocked social hint profile', '<main>blocked</main>'),
    }), async (rootUrl) => {
      await writeKnownXPolicyConfig(workspace, rootUrl);
      const setupPaths = buildSetupAssistantPaths(rootUrl, {
        cwd: workspace,
        buildId: 'x-legacy-hint-profile-seed',
        now: new Date('2026-05-16T08:22:00.000Z'),
      });
      await mkdir(setupPaths.setupDir, { recursive: true });
      await writeFile(setupPaths.savedBuildProfilePath, `${JSON.stringify({
        artifactFamily: 'siteforge-build-profile',
        site: {
          id: stableSiteIdFromUrl(rootUrl),
          rootUrl,
          normalizedUrl: rootUrl,
          allowedDomains: [new URL(rootUrl).hostname],
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
        userHints: ['read recommended timeline posts'],
        userAuthorizedEvidence: {
          status: 'captured',
          pages: [{ url: new URL('/home', rootUrl).toString(), normalizedUrl: new URL('/home', rootUrl).toString(), title: 'X home' }],
          sessionMaterialPersisted: false,
          browserProfilePersisted: false,
          rawHtmlPersisted: false,
          rawCookiePersisted: false,
          rawCredentialPersisted: false,
        },
      }, null, 2)}\n`, 'utf8');

      await assert.rejects(
        async () => {
          try {
            await prepareSiteForgeBuildSetup(rootUrl, {
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
    });

    assert.equal(failure.code, 'setup-evidence-not-buildable');
    assert.equal(failure.reasonCode, 'setup-known-policy-robots-disallowed');
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
