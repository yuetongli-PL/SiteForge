import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';

import {
  EVIDENCE_PROVIDER_IDS,
  RUNTIME_MODES,
  RUNTIME_PROMOTION_CLASSES,
  RUNTIME_PROVIDER_IDS,
  createEmptySkillRegistry,
  lookupSkillIntent,
  lookupSkillIntentFromRegistry,
  providerRuntimeMode,
  providerRuntimeRequirements,
  runSiteForgeBuild,
  runtimeProviderBundleRequirements,
  runtimeProviderDescriptor,
  runtimeProviderPromotionMetadata,
  upsertSkillRegistryRecord,
} from '../../src/app/pipeline/build/index.mjs';
import {
  buildSetupAssistantPaths,
  prepareSiteForgeBuildSetup,
} from '../../src/app/pipeline/build/setup-assistant.mjs';
import {
  simpleShopRoutes,
  testHtmlPage,
  testRobotsTxt,
  withTestSite,
} from './helpers/test-site-server.mjs';

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function pathExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function localServerPort(server) {
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return address.port;
}

function passedRecord(overrides = /** @type {any} */ ({})) {
  return {
    skillId: 'simple-shop',
    siteId: 'fixture-local',
    domains: ['fixture.local'],
    skillDir: '.siteforge/sites/fixture-local/current',
    artifactDir: '.siteforge/sites/fixture-local/builds/success-build',
    verificationStatus: 'passed',
    intents: [{
      intentId: 'intent:fixture-local:search-products',
      name: 'search products',
      capabilityId: 'capability:fixture-local:search-products',
      capabilityName: 'search products',
      capabilityAction: 'search',
      executionPlanId: 'plan:fixture-local:search-products',
      canonicalUtterance: 'search products',
      utteranceExamples: ['search for wireless headphones'],
      safetyLevel: 'read_only',
      invocationScore: 1,
    }],
    ...overrides,
  };
}

test('runtime provider descriptors cover evidence provider compatibility surface', () => {
  assert.deepEqual(RUNTIME_PROVIDER_IDS, [
    'public_http',
    'cookie_http',
    'browser_bridge',
    'authorized_summary',
    'public_rendered',
  ]);
  assert.deepEqual(EVIDENCE_PROVIDER_IDS, RUNTIME_PROVIDER_IDS);

  const descriptors = Object.fromEntries(
    RUNTIME_PROVIDER_IDS.map((providerId) => [providerId, runtimeProviderDescriptor(providerId)]),
  );

  assert.equal(descriptors.public_http.runtimeMode, RUNTIME_MODES.genericHttpRead);
  assert.equal(descriptors.public_http.promotionClass, RUNTIME_PROMOTION_CLASSES.genericHttpRead);
  assert.equal(descriptors.public_http.sourceLayer, 'public');
  assert.equal(descriptors.public_rendered.runtimeMode, RUNTIME_MODES.genericHttpRead);
  assert.equal(descriptors.public_rendered.sourceLayer, 'public_rendered');
  assert.equal(descriptors.browser_bridge.runtimeMode, RUNTIME_MODES.browserBridgeRequired);
  assert.equal(descriptors.browser_bridge.promotionClass, RUNTIME_PROMOTION_CLASSES.browserBridge);
  assert.equal(descriptors.browser_bridge.authMethod, 'browser');
  assert.equal(descriptors.cookie_http.runtimeMode, null);
  assert.equal(descriptors.authorized_summary.runtimeMode, null);
});

test('runtime provider preserves legacy evidence provider requirements', () => {
  assert.equal(providerRuntimeMode('public_http'), 'generic_http_read');
  assert.equal(providerRuntimeMode('public_rendered'), 'generic_http_read');
  assert.equal(providerRuntimeMode('browser_bridge'), 'browser_bridge_required');
  assert.equal(providerRuntimeMode('authorized_summary'), null);
  assert.equal(providerRuntimeMode('public_http', { runtimeMode: 'custom_runtime' }), 'custom_runtime');

  assert.deepEqual(providerRuntimeRequirements('public_http'), {
    runtimeMode: 'generic_http_read',
    readOnly: true,
    allowedMethods: ['GET'],
    cookieMaterialAllowed: false,
    crossSiteNavigationAllowed: false,
    formSubmissionAllowed: false,
  });
  assert.deepEqual(runtimeProviderBundleRequirements('public_http'), providerRuntimeRequirements('public_http'));
  assert.deepEqual(providerRuntimeRequirements('browser_bridge'), {
    runtimeMode: 'browser_bridge_required',
    readOnly: true,
    requiresFreshBridgeEvidence: true,
    cookieMaterialAllowed: false,
    browserProfileMaterialAllowed: false,
    storageMaterialAllowed: false,
  });
  assert.deepEqual(providerRuntimeRequirements('cookie_http'), {
    runtimeMode: null,
    readOnly: true,
    requiresFreshCookieInput: true,
    cookieMaterialPersisted: false,
    crossSiteCookieAllowed: false,
  });
});

test('runtime provider promotion metadata preserves registry wire shape', () => {
  const bridgeMetadata = runtimeProviderPromotionMetadata('browser_bridge', {
    authStateReport: {
      authVerificationStatus: 'browser_verified_partial',
      browserBridge: {
        routeCount: 3,
        capturedRouteCount: 2,
        missingRouteCount: 1,
        routeCoverageStatus: 'partial',
      },
    },
  });

  assert.equal(bridgeMetadata.promotionClass, 'browser_bridge_runtime');
  assert.equal(bridgeMetadata.runtimeMode, 'browser_bridge_required');
  assert.equal(bridgeMetadata.requiresFreshBridgeEvidence, true);
  assert.equal(bridgeMetadata.genericHttpRuntimeAllowed, false);
  assert.equal(bridgeMetadata.coverageStatus, 'partial');
  assert.equal(bridgeMetadata.runtimeRequirements.authMethod, 'browser');
  assert.equal(bridgeMetadata.runtimeRequirements.authVerificationStatus, 'browser_verified_partial');
  assert.equal(bridgeMetadata.runtimeRequirements.savedMaterial, 'sanitized_summary_only');
  assert.equal(bridgeMetadata.runtimeRequirements.capturedRouteCount, 2);

  const httpMetadata = runtimeProviderPromotionMetadata('public_http');
  assert.equal(httpMetadata.promotionClass, 'generic_http_read_runtime');
  assert.equal(httpMetadata.runtimeMode, 'generic_http_read');
  assert.equal(httpMetadata.requiresFreshBridgeEvidence, false);
  assert.equal(httpMetadata.genericHttpRuntimeAllowed, true);
  assert.equal(httpMetadata.runtimeRequirements.cookieMaterialAllowed, false);
  assert.equal(runtimeProviderPromotionMetadata('authorized_summary'), null);
});

test('runtime registry lookup ignores stale failed generated skill records', () => {
  let registry = createEmptySkillRegistry('2026-05-16T00:00:00.000Z');
  registry = upsertSkillRegistryRecord(registry, passedRecord(), '2026-05-16T00:00:01.000Z');
  registry = upsertSkillRegistryRecord(registry, passedRecord({
    skillId: 'failed-draft-shop',
    skillDir: '.siteforge/sites/fixture-local/builds/failed-build/skill',
    artifactDir: '.siteforge/sites/fixture-local/builds/failed-build',
    verificationStatus: 'failed',
    intents: [{
      intentId: 'intent:fixture-local:failed-search-products',
      name: 'search products',
      capabilityId: 'capability:fixture-local:failed-search-products',
      capabilityName: 'failed search products',
      capabilityAction: 'search',
      executionPlanId: 'plan:fixture-local:failed-search-products',
      canonicalUtterance: 'search products',
      utteranceExamples: ['search for wireless headphones'],
      safetyLevel: 'read_only',
      invocationScore: 100,
    }],
  }), '2026-05-16T00:00:02.000Z');

  const lookup = lookupSkillIntentFromRegistry(registry, {
    domain: 'FIXTURE.LOCAL',
    utterance: 'search for wireless headphones',
  });

  assert.equal(lookup.status, 'found');
  assert.equal(lookup.skillId, 'simple-shop');
  // @ts-ignore
  assert.equal(lookup.skillDir, '.siteforge/sites/fixture-local/current');
  assert.equal(lookup.capabilityId, 'capability:fixture-local:search-products');
  // @ts-ignore
  assert.equal(lookup.executionPlanId, 'plan:fixture-local:search-products');

  const failedOnly = createEmptySkillRegistry('2026-05-16T00:00:03.000Z');
  failedOnly.skills.push(passedRecord({
    skillId: 'failed-only',
    verificationStatus: 'failed',
  }));
  assert.equal(
    lookupSkillIntentFromRegistry(failedOnly, {
      domain: 'fixture.local',
      utterance: 'search for wireless headphones',
    }).status,
    'not_found',
  );
});

test('runtime registry lookup returns browser bridge runtime restrictions', () => {
  let registry = createEmptySkillRegistry('2026-05-24T00:00:00.000Z');
  registry = upsertSkillRegistryRecord(registry, passedRecord({
    verificationStatus: 'bridge_runtime_passed',
    promotionClass: 'browser_bridge_runtime',
    runtimeMode: 'browser_bridge_required',
    requiresFreshBridgeEvidence: true,
    genericHttpRuntimeAllowed: false,
    coverageStatus: 'partial',
    runtimeRequirements: {
      authMethod: 'browser',
      authVerificationStatus: 'browser_verified',
      requiresFreshBridgeEvidence: true,
      genericHttpRuntimeAllowed: false,
      routeCount: 3,
      capturedRouteCount: 2,
      missingRouteCount: 1,
    },
    intents: [passedRecord().intents[0]],
  }), '2026-05-24T00:00:01.000Z');

  const lookup = lookupSkillIntentFromRegistry(registry, {
    domain: 'fixture.local',
    utterance: 'search for wireless headphones',
  });

  assert.equal(lookup.status, 'found');
  const foundLookup = /** @type {any} */ (lookup);
  assert.equal(foundLookup.verificationStatus, undefined);
  assert.equal(foundLookup.runtimeMode, 'browser_bridge_required');
  assert.equal(foundLookup.promotionClass, 'browser_bridge_runtime');
  assert.equal(foundLookup.requiresFreshBridgeEvidence, true);
  assert.equal(foundLookup.genericHttpRuntimeAllowed, false);
  assert.equal(foundLookup.coverageStatus, 'partial');
  assert.equal(foundLookup.runtimeRequirements.capturedRouteCount, 2);
});

test('runtime registry lookup does not resolve unrelated utterances from invocation score alone', () => {
  let registry = createEmptySkillRegistry('2026-05-16T00:00:04.000Z');
  registry = upsertSkillRegistryRecord(registry, passedRecord({
    intents: [{
      intentId: 'intent:fixture-local:view-homepage',
      name: 'view homepage',
      capabilityId: 'capability:fixture-local:view-homepage',
      capabilityName: 'view homepage',
      capabilityAction: 'view',
      executionPlanId: 'plan:fixture-local:view-homepage',
      canonicalUtterance: 'view homepage',
      utteranceExamples: ['open homepage'],
      safetyLevel: 'read_only',
      invocationScore: 100,
    }],
  }), '2026-05-16T00:00:05.000Z');

  const lookup = lookupSkillIntentFromRegistry(registry, {
    domain: 'fixture.local',
    utterance: 'list followed users',
  });

  assert.equal(lookup.status, 'not_found');
});

test('runtime registry lookup does not map profile-edit write intents to read-profile capability', () => {
  let registry = createEmptySkillRegistry('2026-05-16T00:00:06.000Z');
  registry = upsertSkillRegistryRecord(registry, passedRecord({
    intents: [{
      intentId: 'intent:fixture-local:list-profile-content',
      name: 'list profile content',
      capabilityId: 'capability:fixture-local:list-profile-content',
      capabilityName: 'list profile content',
      capabilityAction: 'view',
      executionPlanId: 'plan:fixture-local:list-profile-content',
      canonicalUtterance: 'list profile content',
      utteranceExamples: ['show account posts', 'open profile posts'],
      safetyLevel: 'read_only',
      invocationScore: 100,
    }],
  }), '2026-05-16T00:00:07.000Z');

  for (const utterance of ['edit profile', 'change account profile', '淇敼涓汉璧勬枡', '缂栬緫璐﹀彿涓婚〉淇℃伅']) {
    const lookup = lookupSkillIntentFromRegistry(registry, {
      domain: 'fixture.local',
      utterance,
    });
    assert.equal(lookup.status, 'not_found', utterance);
    const missedLookup = /** @type {any} */ (lookup);
    if (missedLookup.reason !== undefined) {
      assert.equal(missedLookup.reason, 'action_mismatch', utterance);
    }
  }
});

test('generated skill is callable from domain and utterance through active current registry', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-runtime-registry-'));
  try {
    await withTestSite(simpleShopRoutes, async (rootUrl) => {
    const result = await runSiteForgeBuild(rootUrl, {
      cwd: workspace,
      buildId: 'runtime-registry-success',
      now: new Date('2026-05-16T03:10:00.000Z'),
      fetchDelayMs: 0,
    });

    assert.equal(result.status, 'success');
    assert.equal(result.summary.verificationStatus, 'passed');
    assert.equal(result.summary.registryStatus, 'registered');
    assert.equal(result.summary.highRiskAutoExecuted, false);

    const lookup = await lookupSkillIntent({
      registryPath: result.workspace.registryPath,
      domain: new URL(rootUrl).hostname.toUpperCase(),
      utterance: 'search for wireless headphones',
    });
    assert.equal(lookup.status, 'found');
    assert.equal(lookup.skillId, 'simple-shop');
    // @ts-ignore
    assert.equal(lookup.intentName, 'search products');
    // @ts-ignore
    assert.equal(lookup.capabilityName, 'search products');
    assert.ok(lookup.intentId);
    assert.ok(lookup.capabilityId);
    // @ts-ignore
    assert.ok(lookup.executionPlanId);

    const registry = await readJson(result.workspace.registryPath);
    const record = registry.skills.find((skill) => skill.skillId === lookup.skillId);
    assert.ok(record);
    assert.equal(record.verificationStatus, 'passed');
    assert.equal(record.siteId, result.siteId);
    assert.equal(record.skillDir, `.siteforge/sites/${result.siteId}/current`);
    assert.equal(record.artifactDir, `.siteforge/sites/${result.siteId}/builds/runtime-registry-success`);
    assert.equal(record.domains.includes(new URL(rootUrl).hostname), true);
    assert.equal(record.skillDir.includes('/builds/'), false);
    assert.equal(record.runtimeModes.includes('generic_http_read'), true);
    assert.equal(record.runtimeSummary.genericHttpReadIntents > 0, true);

    const activeSkillDir = path.join(workspace, record.skillDir);
    const intents = await readJson(path.join(activeSkillDir, 'intents.json'));
    const capabilities = await readJson(path.join(activeSkillDir, 'capabilities.json'));
    const plans = await readJson(path.join(activeSkillDir, 'execution_plans.json'));
    const safetyPolicy = await readJson(path.join(activeSkillDir, 'safety_policy.json'));
    const invocationTest = await readJson(path.join(activeSkillDir, 'tests', 'invocation.test.json'));
    const verificationReport = await readJson(path.join(activeSkillDir, 'verification_report.json'));

    const intent = intents.intents.find((candidate) => candidate.id === lookup.intentId);
    assert.ok(intent);
    assert.equal(intent.capabilityId, lookup.capabilityId);
    // @ts-ignore
    assert.equal(intent.safetyLevel, lookup.safetyLevel);

    const capability = capabilities.capabilities.find((candidate) => candidate.id === intent.capabilityId);
    assert.ok(capability);
    assert.equal(capability.status, 'active');
    // @ts-ignore
    assert.equal(capability.executionPlan.id, lookup.executionPlanId);

    // @ts-ignore
    const plan = plans.executionPlans.find((candidate) => candidate.id === lookup.executionPlanId);
    assert.ok(plan);
    assert.equal(plan.capabilityId, capability.id);
    assert.equal(plan.autoExecute, false);
    assert.equal(plan.steps.every((step) => step.autoExecute !== true), true);

    const httpCapability = capabilities.capabilities.find((candidate) => candidate.runtimeMode === 'generic_http_read');
    assert.ok(httpCapability);
    assert.equal(httpCapability.genericHttpRuntimeAllowed, true);
    assert.equal(httpCapability.requiresFreshBridgeEvidence, false);
    const httpIntent = intents.intents.find((candidate) => candidate.capabilityId === httpCapability.id && candidate.runtimeMode === 'generic_http_read');
    assert.ok(httpIntent);
    const httpPlan = plans.executionPlans.find((candidate) => candidate.capabilityId === httpCapability.id);
    assert.ok(httpPlan);
    assert.equal(httpPlan.runtimeMode, 'generic_http_read');
    assert.equal(httpPlan.runtimeRequirements.cookieMaterialAllowed, false);

    assert.equal(safetyPolicy.policy.submitForms, false);
    assert.equal(safetyPolicy.policy.allowDestructiveActions, false);
    assert.equal(safetyPolicy.policy.allowPayment, false);
    assert.equal(safetyPolicy.policy.allowAccountMutation, false);
    assert.match(safetyPolicy.riskPolicy.highRiskRule, /High-risk capabilities/u);
    assert.equal(safetyPolicy.riskPolicy.rawContentSaved, false);
    assert.equal(safetyPolicy.riskPolicy.privateContentSaved, false);

    assert.equal(invocationTest.domain, new URL(rootUrl).hostname);
    assert.equal(invocationTest.skillId ?? invocationTest.expectedSkill, 'simple-shop');
    assert.equal(invocationTest.capabilityId, lookup.capabilityId);
    assert.equal(verificationReport.status, 'passed');
    assert.equal(verificationReport.gates.safety.passed, true);
    assert.equal(verificationReport.gates.registryLookup.status, 'found');
    // @ts-ignore
    assert.equal(verificationReport.gates.registryLookup.executionPlanId, lookup.executionPlanId);
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('failed verification is not registered and does not replace active current skill', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-runtime-failure-'));
  try {
    let mode = 'success';
    let routes = {};
    await new Promise((resolve, reject) => {
      const server = createServer((request, response) => {
        const requestPath = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
        if (mode === 'failed') {
          if (requestPath === '/robots.txt') {
            response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
            response.end('User-agent: *\nAllow: /\n');
            return;
          }
          response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
          response.end('Not found');
          return;
        }
        const route = routes[requestPath] ?? routes[requestPath.replace(/\/$/u, '')] ?? null;
        if (!route) {
          response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
          response.end('Not found');
          return;
        }
        response.writeHead(200, { 'content-type': route.contentType ?? 'text/html; charset=utf-8' });
        response.end(route.body ?? route);
      });
      server.listen(0, '127.0.0.1', async () => {
        const port = localServerPort(server);
        const rootUrl = `http://127.0.0.1:${port}/`;
        routes = simpleShopRoutes(rootUrl);
        try {
          const success = await runSiteForgeBuild(rootUrl, {
            cwd: workspace,
            buildId: 'runtime-success',
            now: new Date('2026-05-16T03:11:00.000Z'),
            fetchDelayMs: 0,
          });
          const registryBefore = await readJson(success.workspace.registryPath);
          const siteDir = success.workspace.siteDir;
          const currentVerificationBefore = await readJson(path.join(siteDir, 'current', 'verification_report.json'));
          const lastSuccessfulBefore = await readJson(path.join(siteDir, 'last_successful_build.json'));

          mode = 'failed';
          let failure = /** @type {any} */ (null);
          await assert.rejects(
            async () => {
              try {
                await runSiteForgeBuild(rootUrl, {
                  cwd: workspace,
                  buildId: 'runtime-failed',
                  now: new Date('2026-05-16T03:12:00.000Z'),
                  fetchDelayMs: 0,
                });
              } catch (error) {
                failure = error;
                throw error;
              }
            },
            /Static crawl produced no pages with evidence/u,
          );

          assert.ok(failure?.artifactDir);
          const failedReport = await readJson(path.join(failure.artifactDir, 'build_report.json'));
          assert.equal(failedReport.status, 'blocked');
          assert.equal(failedReport.summary.registryStatus, null);
          assert.deepEqual(await readJson(success.workspace.registryPath), registryBefore);
          assert.deepEqual(await readJson(path.join(siteDir, 'current', 'verification_report.json')), currentVerificationBefore);
          assert.deepEqual(await readJson(path.join(siteDir, 'last_successful_build.json')), lastSuccessfulBefore);

          const lookup = await lookupSkillIntent({
            registryPath: success.workspace.registryPath,
            domain: new URL(rootUrl).hostname,
            utterance: 'search for wireless headphones',
          });
          assert.equal(lookup.status, 'found');
          assert.equal(lookup.skillId, success.skillId);
          server.close((error) => error ? reject(error) : resolve());
        } catch (error) {
          server.close(() => reject(error));
        }
      });
      server.once('error', reject);
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
test('robots-blocked setup cannot create runtime-loadable current skill or registry record', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-robots-setup-'));
  try {
    await withTestSite((rootUrl) => ({
      '/robots.txt': { contentType: 'text/plain; charset=utf-8', body: testRobotsTxt(rootUrl, { disallow: '/', sitemap: false }) },
      '/': testHtmlPage('Blocked', '<main>Public content is blocked by robots policy.</main>'),
    }), async (rootUrl) => {
      const setupPaths = buildSetupAssistantPaths(rootUrl, {
        cwd: workspace,
        buildId: 'robots-setup',
        now: new Date('2026-05-16T04:00:00.000Z'),
      });

      let setupFailure = /** @type {any} */ (null);
      await assert.rejects(
        () => prepareSiteForgeBuildSetup(rootUrl, {
          cwd: workspace,
          buildId: 'robots-setup',
          now: new Date('2026-05-16T04:00:00.000Z'),
          setupInteractive: true,
          setupOutput: { write() {} },
          setupPrompt: async () => '',
          noUserAuthorizedSetup: true,
          fetchDelayMs: 0,
        }),
        (error) => {
          setupFailure = /** @type {any} */ (error);
          return setupFailure?.code === 'setup-evidence-not-buildable'
            && setupFailure?.reasonCode === 'setup-robots-disallowed';
        },
      );

      assert.equal(setupFailure.setupPlanPath, setupPaths.setupPlanPath);
      assert.equal(await pathExists(setupPaths.setupPlanPath), true);
      assert.equal(await pathExists(setupPaths.savedBuildProfilePath), true);

      const setupPlan = await readJson(setupPaths.setupPlanPath);
      const savedProfile = await readJson(setupPaths.savedBuildProfilePath);
      assert.equal(setupPlan.site.rootUrl, rootUrl);
      assert.equal(setupPlan.buildReadiness.buildable, false);
      assert.equal(setupPlan.buildReadiness.reasonCode, 'setup-robots-disallowed');
      assert.equal(savedProfile.profileUsability.buildable, false);
      assert.equal(savedProfile.profileUsability.reasonCode, 'setup-robots-disallowed');

      const registry = await readJson(path.join(setupPaths.siteArtifactDir, 'registry.json'));
      const lastSuccessful = await readJson(path.join(setupPaths.siteArtifactDir, 'last_successful_build.json'));
      assert.deepEqual(registry.skills, []);
      assert.equal(lastSuccessful.status, 'none');
      assert.equal(lastSuccessful.buildId, null);
      assert.equal(await pathExists(path.join(setupPaths.siteArtifactDir, 'current', 'skill.yaml')), false);

      const lookup = await lookupSkillIntent({
        registryPath: path.join(setupPaths.siteArtifactDir, 'registry.json'),
        domain: new URL(rootUrl).hostname,
        utterance: 'open home',
      });
      assert.equal(lookup.status, 'not_found');
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('robots-blocked build preserves blocked artifacts without promotion or runtime lookup', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-robots-build-'));
  try {
    await withTestSite((rootUrl) => ({
      '/robots.txt': { contentType: 'text/plain; charset=utf-8', body: testRobotsTxt(rootUrl, { disallow: '/', sitemap: false }) },
      '/': testHtmlPage('Blocked', '<main>Public content is blocked by robots policy.</main>'),
    }), async (rootUrl) => {
      let buildFailure = /** @type {any} */ (null);
      await assert.rejects(
        () => runSiteForgeBuild(rootUrl, {
          cwd: workspace,
          buildId: 'robots-build',
          now: new Date('2026-05-16T04:05:00.000Z'),
          fetchDelayMs: 0,
        }),
        (error) => {
          buildFailure = /** @type {any} */ (error);
          return buildFailure?.reasonCode === 'robots-disallowed'
            && /robots-disallowed/u.test(String(buildFailure?.message ?? ''));
        },
      );

      const buildReport = await readJson(path.join(buildFailure.artifactDir, 'build_report.json'));
      const siteDir = buildReport.workspace.siteDir;
      assert.equal(buildReport.status, 'blocked');
      assert.equal(buildReport.failureClass, 'robots');
      assert.equal(buildReport.reasonCode, 'robots-disallowed');
      assert.equal(buildReport.summary.registryStatus, null);
      assert.equal(buildReport.summary.verificationStatus, null);

      const seeds = await readJson(path.join(buildFailure.artifactDir, 'seeds.json'));
      assert.equal(seeds.status, 'blocked');
      assert.equal(seeds.robots.status, 'parsed');
      assert.deepEqual(seeds.robots.disallowPaths, ['/']);
      assert.deepEqual(seeds.seeds, []);

      assert.equal(await pathExists(path.join(buildFailure.artifactDir, 'skill.yaml')), false);
      assert.equal(await pathExists(path.join(buildFailure.artifactDir, 'skill', 'skill.yaml')), false);
      assert.equal(await pathExists(path.join(buildFailure.artifactDir, 'verification_report.json')), false);
      assert.equal(await pathExists(path.join(siteDir, 'current', 'skill.yaml')), false);

      const registry = await readJson(buildReport.workspace.registryPath);
      const lastSuccessful = await readJson(buildReport.workspace.lastSuccessfulBuildPath);
      assert.deepEqual(registry.skills, []);
      assert.equal(lastSuccessful.status, 'none');
      assert.equal(lastSuccessful.buildId, null);
      assert.equal(JSON.stringify(registry).includes('robots-build'), false);
      assert.equal(JSON.stringify(lastSuccessful).includes('robots-build'), false);

      const lookup = await lookupSkillIntent({
        registryPath: buildReport.workspace.registryPath,
        domain: new URL(rootUrl).hostname,
        utterance: 'open home',
      });
      assert.equal(lookup.status, 'not_found');
      assert.equal(lookup.skillId, null);
      assert.equal(lookup.intentId, null);
      assert.equal(lookup.capabilityId, null);
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
