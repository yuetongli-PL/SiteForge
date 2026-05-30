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
  bridgeRuntimeMetadata,
  createEmptySkillRegistry,
  executeApiRequestIntent,
  genericHttpRuntimeMetadata,
  lookupSkillIntent,
  lookupSkillIntentFromRegistry,
  providerRuntimeMode,
  providerRuntimeRequirements,
  runSiteForgeBuild,
  runtimeProviderBundleRequirements,
  runtimeProviderDescriptor,
  runtimeProviderPromotionMetadata,
  registryIntentRuntimeMetadata,
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

async function writeJsonFile(filePath, payload) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8');
}

async function writeApiRequestRuntimeFixture(workspace, {
  endpoint = 'https://fixture.local/api/profile?view=summary',
  method = 'GET',
  stepOverrides = {},
  capabilityOverrides = {},
  planOverrides = {},
  recordOverrides = {},
  runtimeBinding = null,
} = /** @type {any} */ ({})) {
  const siteDir = path.join(workspace, '.siteforge', 'sites', 'fixture-local');
  const skillDir = path.join(siteDir, 'current');
  const registryPath = path.join(siteDir, 'registry.json');
  const capabilityId = 'capability:fixture-local:read-api-profile';
  const executionPlanId = 'plan:fixture-local:read-api-profile';
  const intentId = 'intent:fixture-local:read-api-profile';
  const step = {
    kind: 'api_request',
    method,
    endpoint,
    authBoundary: 'browser_bridge',
    mode: 'limited_read',
    autoExecute: false,
    requiresConfirmation: false,
    responseMaterial: 'sanitized_summary_only',
    requiresFreshBridgeEvidence: true,
    genericHttpRuntimeAllowed: false,
    runtimeMode: 'browser_bridge_required',
    ...stepOverrides,
  };
  const plan = {
    id: executionPlanId,
    capabilityId,
    mode: 'limited_read',
    autoExecute: false,
    requiresConfirmation: false,
    limitedOutputOnly: true,
    responseMaterial: 'sanitized_summary_only',
    runtimeMode: 'browser_bridge_required',
    requiresFreshBridgeEvidence: true,
    genericHttpRuntimeAllowed: false,
    steps: [step],
    ...planOverrides,
  };
  const capability = {
    id: capabilityId,
    siteId: 'fixture-local',
    name: 'read API endpoint /api/profile',
    action: 'view',
    safetyLevel: 'read_only',
    status: 'active',
    entryNodeIds: ['node:fixture-local:home'],
    evidence: [{ type: 'network', source: 'discovery/api-candidates/candidate-0001.json' }],
    confidence: 0.86,
    runtimeMode: 'browser_bridge_required',
    promotionClass: 'browser_bridge_runtime',
    requiresFreshBridgeEvidence: true,
    genericHttpRuntimeAllowed: false,
    apiAdapter: {
      runtime: 'browser_bridge_required',
      requiresFreshBridgeEvidence: true,
      genericHttpRuntimeAllowed: false,
      responsePolicy: 'sanitized_summary_only',
    },
    executionPlan: plan,
    ...capabilityOverrides,
  };
  const registry = upsertSkillRegistryRecord(createEmptySkillRegistry('2026-05-27T00:00:00.000Z'), passedRecord({
    skillId: 'fixture-api-runtime',
    siteId: 'fixture-local',
    domains: ['fixture.local'],
    skillDir: '.siteforge/sites/fixture-local/current',
    artifactDir: '.siteforge/sites/fixture-local/builds/runtime',
    verificationStatus: 'bridge_runtime_passed',
    promotionClass: 'browser_bridge_runtime',
    runtimeMode: 'browser_bridge_required',
    requiresFreshBridgeEvidence: true,
    genericHttpRuntimeAllowed: false,
    runtimeRequirements: {
      authMethod: 'browser',
      requiresFreshBridgeEvidence: true,
      genericHttpRuntimeAllowed: false,
    },
    intents: [{
      intentId,
      name: 'read API endpoint /api/profile',
      capabilityId,
      capabilityName: 'read API endpoint /api/profile',
      capabilityAction: 'view',
      executionPlanId,
      canonicalUtterance: 'read API endpoint /api/profile',
      utteranceExamples: ['read API endpoint /api/profile', 'call profile API'],
      safetyLevel: 'read_only',
      invocationScore: 1,
      runtimeMode: 'browser_bridge_required',
      requiresFreshBridgeEvidence: true,
      genericHttpRuntimeAllowed: false,
    }],
    ...recordOverrides,
  }), '2026-05-27T00:00:01.000Z');

  await writeJsonFile(registryPath, registry);
  await writeJsonFile(path.join(skillDir, 'capabilities.json'), {
    schemaVersion: 1,
    capabilities: [capability],
  });
  await writeJsonFile(path.join(skillDir, 'execution_plans.json'), {
    schemaVersion: 1,
    executionPlans: [plan],
  });
  if (runtimeBinding) {
    await writeJsonFile(path.join(siteDir, 'builds', 'runtime', 'runtime', 'api-adapter-bindings.internal.json'), {
      schemaVersion: 1,
      artifactFamily: 'siteforge-api-adapter-runtime-bindings',
      internalOnly: true,
      containsSensitiveMaterial: true,
      bindings: [runtimeBinding],
    });
  }
  return {
    registryPath,
    capability,
    plan,
    step,
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
  const authStateReport = {
    authVerificationStatus: 'browser_verified_partial',
    browserBridge: {
      routeCount: 3,
      capturedRouteCount: 2,
      missingRouteCount: 1,
      routeCoverageStatus: 'partial',
    },
  };
  const bridgeMetadata = runtimeProviderPromotionMetadata('browser_bridge', {
    authStateReport,
  });

  assert.deepEqual(bridgeRuntimeMetadata(authStateReport), bridgeMetadata);
  assert.deepEqual(genericHttpRuntimeMetadata(), runtimeProviderPromotionMetadata('public_http'));
  assert.deepEqual(registryIntentRuntimeMetadata(
    {
      runtimeMode: 'intent_runtime',
      requiresFreshBridgeEvidence: false,
      runtimeRequirements: { source: 'intent' },
    },
    {
      promotionClass: 'capability_class',
      runtimeMode: 'capability_runtime',
      genericHttpRuntimeAllowed: true,
      coverageStatus: 'capability_coverage',
    },
    {
      promotionClass: 'fallback_class',
      runtimeMode: 'fallback_runtime',
      requiresFreshBridgeEvidence: true,
      runtimeRequirements: { source: 'fallback' },
    },
  ), {
    promotionClass: 'capability_class',
    runtimeMode: 'intent_runtime',
    requiresFreshBridgeEvidence: false,
    genericHttpRuntimeAllowed: true,
    coverageStatus: 'capability_coverage',
    runtimeRequirements: { source: 'intent' },
  });
  assert.equal(registryIntentRuntimeMetadata({}, {}, null), null);

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

test('api_request runtime executes only through fresh browser bridge evidence', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-api-runtime-'));
  try {
    const { registryPath } = await writeApiRequestRuntimeFixture(workspace);
    let request = /** @type {any} */ (null);
    const result = await executeApiRequestIntent({
      registryPath,
      cwd: workspace,
      domain: 'fixture.local',
      utterance: 'read API endpoint /api/profile',
      freshBridgeEvidence: {
        status: 'verified',
        capturedAt: '2026-05-27T00:00:00.000Z',
      },
      now: new Date('2026-05-27T00:01:00.000Z'),
      browserBridgeFetch: async (input) => {
        request = input;
        return {
          statusCode: 200,
          headers: { 'content-type': 'application/json' },
          body: {
            items: [{ id: 1, name: 'Ada', access_token: 'synthetic-secret-token' }],
            nextToken: 'synthetic-secret-token',
          },
        };
      },
    });

    assert.equal(result.status, 'success');
    assert.equal(result.runtimeMode, 'browser_bridge_required');
    assert.equal(result.method, 'GET');
    assert.equal(result.response.responseMaterial, 'sanitized_summary_only');
    assert.equal(result.response.bodyPersisted, false);
    assert.equal(result.runtimePolicy.genericHttpRuntimeAllowed, false);
    assert.deepEqual(request, {
      endpoint: 'https://fixture.local/api/profile?view=summary',
      endpointTemplate: 'https://fixture.local/api/profile?view=summary',
      runtimeParameterSource: null,
      responseEvidence: null,
      method: 'GET',
      credentials: 'include',
      body: null,
      persistCookies: false,
      persistStorage: false,
      persistResponseBody: false,
      responseMaterial: 'sanitized_summary_only',
    });
    const serialized = JSON.stringify(result);
    assert.equal(serialized.includes('synthetic-secret-token'), false);
    assert.equal(serialized.includes('access_token'), false);
    assert.equal(serialized.includes('nextToken'), false);

    await writeApiRequestRuntimeFixture(workspace, {
      endpoint: 'https://fixture.local/api/profile-head?view=summary',
      method: 'HEAD',
    });
    request = null;
    const head = await executeApiRequestIntent({
      registryPath,
      cwd: workspace,
      domain: 'fixture.local',
      utterance: 'read API endpoint /api/profile',
      freshBridgeEvidence: true,
      browserBridgeFetch: async (input) => {
        request = input;
        return {
          statusCode: 204,
          headers: {},
          body: null,
        };
      },
    });

    assert.equal(head.status, 'success');
    assert.equal(head.runtimeMode, 'browser_bridge_required');
    assert.equal(head.method, 'HEAD');
    assert.equal(request.method, 'HEAD');
    assert.equal(request.body, null);
    assert.equal(request.persistResponseBody, false);
    assert.equal(request.endpoint, 'https://fixture.local/api/profile-head?view=summary');
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('api_request runtime executes Reddit OAuth read plans without Browser Bridge or cookie material', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-api-runtime-reddit-'));
  try {
    const capabilityId = 'capability:fixture-local:read-api-profile';
    const executionPlanId = 'plan:fixture-local:read-api-profile';
    const intentId = 'intent:reddit:read-account-api';
    const { registryPath } = await writeApiRequestRuntimeFixture(workspace, {
      endpoint: 'https://oauth.reddit.com/api/v1/me',
      stepOverrides: {
        authBoundary: 'oauth_bearer_token_required',
        runtimeMode: RUNTIME_MODES.redditOauthRead,
        requiresFreshBridgeEvidence: false,
        tokenEnvVars: ['SITEFORGE_REDDIT_BEARER_TOKEN'],
        userAgentEnvVars: ['SITEFORGE_REDDIT_USER_AGENT'],
      },
      planOverrides: {
        runtimeMode: RUNTIME_MODES.redditOauthRead,
        requiresFreshBridgeEvidence: false,
      },
      capabilityOverrides: {
        name: 'read Reddit account API',
        runtimeMode: RUNTIME_MODES.redditOauthRead,
        promotionClass: 'reddit_oauth_read_runtime',
        requiresFreshBridgeEvidence: false,
        apiAdapter: {
          runtime: RUNTIME_MODES.redditOauthRead,
          requiresFreshBridgeEvidence: false,
          genericHttpRuntimeAllowed: false,
          responsePolicy: 'sanitized_summary_only',
          tokenEnvVars: ['SITEFORGE_REDDIT_BEARER_TOKEN'],
          userAgentEnvVars: ['SITEFORGE_REDDIT_USER_AGENT'],
        },
      },
      recordOverrides: {
        domains: ['oauth.reddit.com', 'reddit.com'],
        verificationStatus: 'passed',
        promotionClass: 'reddit_oauth_read_runtime',
        runtimeMode: RUNTIME_MODES.redditOauthRead,
        requiresFreshBridgeEvidence: false,
        runtimeRequirements: {
          authMethod: 'oauth_bearer',
          allowedMethods: ['GET'],
          requiresFreshBridgeEvidence: false,
          tokenPersisted: false,
        },
        intents: [{
          intentId,
          name: 'read Reddit account API',
          capabilityId,
          capabilityName: 'read Reddit account API',
          capabilityAction: 'view',
          executionPlanId,
          canonicalUtterance: 'read Reddit account API',
          utteranceExamples: ['read Reddit account API'],
          safetyLevel: 'read_only',
          invocationScore: 1,
          runtimeMode: RUNTIME_MODES.redditOauthRead,
          requiresFreshBridgeEvidence: false,
          genericHttpRuntimeAllowed: false,
        }],
      },
    });

    let fetchRequest = null;
    let bridgeFetchCalled = false;
    const result = await executeApiRequestIntent({
      registryPath,
      cwd: workspace,
      domain: 'oauth.reddit.com',
      utterance: 'read Reddit account API',
      env: {},
      oauthBearerToken: 'synthetic-reddit-token',
      userAgent: 'SiteForgeTest/0.1',
      browserBridgeFetch: async () => {
        bridgeFetchCalled = true;
        return { statusCode: 200, body: {} };
      },
      fetchImpl: async (url, options) => {
        fetchRequest = { url, options };
        return {
          status: 200,
          headers: new Map([['content-type', 'application/json']]),
          text: async () => JSON.stringify({
            name: 'tester',
            access_token: 'body-token-is-not-persisted',
          }),
        };
      },
    });

    assert.equal(result.status, 'success');
    assert.equal(result.runtimeMode, RUNTIME_MODES.redditOauthRead);
    assert.equal(result.method, 'GET');
    assert.equal(result.runtimePolicy.authBoundary, 'oauth_bearer');
    assert.equal(result.runtimePolicy.authorizationPersisted, false);
    assert.equal(result.runtimePolicy.cookieMaterialPersisted, false);
    assert.equal(bridgeFetchCalled, false);
    assert.equal(fetchRequest.url, 'https://oauth.reddit.com/api/v1/me');
    assert.equal(fetchRequest.options.headers.authorization, 'Bearer synthetic-reddit-token');
    assert.equal(fetchRequest.options.headers['user-agent'], 'SiteForgeTest/0.1');
    const serialized = JSON.stringify(result);
    assert.equal(serialized.includes('synthetic-reddit-token'), false);
    assert.equal(serialized.includes('body-token-is-not-persisted'), false);
    assert.equal(serialized.includes('access_token'), false);

    let fetchCalled = false;
    const blocked = await executeApiRequestIntent({
      registryPath,
      cwd: workspace,
      domain: 'oauth.reddit.com',
      utterance: 'read Reddit account API',
      env: {},
      userAgent: 'SiteForgeTest/0.1',
      fetchImpl: async () => {
        fetchCalled = true;
        return { status: 200, text: async () => '{}' };
      },
    });
    assert.equal(blocked.status, 'blocked');
    assert.equal(blocked.reasonCode, 'reddit_oauth_bearer_token_required');
    assert.equal(fetchCalled, false);

    await writeApiRequestRuntimeFixture(workspace, {
      endpoint: 'https://oauth.reddit.com/comments/{article}',
      stepOverrides: {
        authBoundary: 'oauth_bearer_token_required',
        runtimeMode: RUNTIME_MODES.redditOauthRead,
        requiresFreshBridgeEvidence: false,
        requiresRuntimeParams: true,
        runtimePathParameters: ['article'],
      },
      planOverrides: {
        runtimeMode: RUNTIME_MODES.redditOauthRead,
        requiresFreshBridgeEvidence: false,
        runtimePathParameters: ['article'],
      },
      capabilityOverrides: {
        name: 'read Reddit comments API',
        runtimeMode: RUNTIME_MODES.redditOauthRead,
        promotionClass: 'reddit_oauth_read_runtime',
        requiresFreshBridgeEvidence: false,
        apiAdapter: {
          runtime: RUNTIME_MODES.redditOauthRead,
          requiresFreshBridgeEvidence: false,
          genericHttpRuntimeAllowed: false,
          responsePolicy: 'sanitized_summary_only',
        },
      },
      recordOverrides: {
        domains: ['oauth.reddit.com', 'reddit.com'],
        verificationStatus: 'passed',
        promotionClass: 'reddit_oauth_read_runtime',
        runtimeMode: RUNTIME_MODES.redditOauthRead,
        requiresFreshBridgeEvidence: false,
        intents: [{
          intentId: 'intent:reddit:read-comments-api',
          name: 'read Reddit comments API',
          capabilityId,
          capabilityName: 'read Reddit comments API',
          capabilityAction: 'view',
          executionPlanId,
          canonicalUtterance: 'read Reddit comments API',
          utteranceExamples: ['read Reddit comments API'],
          safetyLevel: 'read_only',
          invocationScore: 1,
          runtimeMode: RUNTIME_MODES.redditOauthRead,
          requiresFreshBridgeEvidence: false,
          genericHttpRuntimeAllowed: false,
        }],
      },
    });

    fetchCalled = false;
    const missingParam = await executeApiRequestIntent({
      registryPath,
      cwd: workspace,
      domain: 'oauth.reddit.com',
      utterance: 'read Reddit comments API',
      oauthBearerToken: 'synthetic-reddit-token',
      userAgent: 'SiteForgeTest/0.1',
      env: {},
      fetchImpl: async () => {
        fetchCalled = true;
        return { status: 200, text: async () => '{}' };
      },
    });
    assert.equal(missingParam.status, 'blocked');
    assert.equal(missingParam.reasonCode, 'runtime_path_parameters_required');
    assert.deepEqual(missingParam.missingPathParameters, ['article']);
    assert.equal(fetchCalled, false);

    let parameterizedUrl = null;
    const parameterized = await executeApiRequestIntent({
      registryPath,
      cwd: workspace,
      domain: 'oauth.reddit.com',
      utterance: 'read Reddit comments API',
      oauthBearerToken: 'synthetic-reddit-token',
      userAgent: 'SiteForgeTest/0.1',
      runtimeParams: { article: 'abc123' },
      env: {},
      fetchImpl: async (url) => {
        parameterizedUrl = url;
        return {
          status: 200,
          headers: new Map([['content-type', 'application/json']]),
          text: async () => JSON.stringify({ comments: [] }),
        };
      },
    });
    assert.equal(parameterized.status, 'success');
    assert.equal(parameterizedUrl, 'https://oauth.reddit.com/comments/abc123');
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('api_request runtime allows replay-verified Douyin profile video read path with runtime parameters', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-api-runtime-douyin-'));
  try {
    const endpointTemplate = 'https://www.douyin.com/aweme/v1/web/aweme/post/?device_platform=webapp&aid=6383&channel=channel_pc_web&max_cursor=0&count=18&user_id={self.uid}&sec_user_id={self.secUid}';
    const runtimeParameterSource = {
      kind: 'douyin_self_user_render_data',
      pageUrl: 'https://www.douyin.com/user/self',
      fields: {
        user_id: 'uid',
        sec_user_id: 'secUid',
      },
      rawMaterialPersisted: false,
    };
    const { registryPath } = await writeApiRequestRuntimeFixture(workspace, {
      endpoint: endpointTemplate,
      capabilityOverrides: {
        name: 'list profile videos API',
        object: 'profile videos',
        userValue: 'List Douyin profile video posts without account mutation.',
        apiAdapter: {
          runtime: 'browser_bridge_required',
          requiresFreshBridgeEvidence: true,
          genericHttpRuntimeAllowed: false,
          responsePolicy: 'sanitized_summary_only',
          runtimeParameterSource,
          responseEvidence: {
            statusCode: 0,
            arrayField: 'aweme_list',
          },
        },
      },
      stepOverrides: {
        runtimeParameterSource,
        responseEvidence: {
          statusCode: 0,
          arrayField: 'aweme_list',
        },
      },
      recordOverrides: {
        domains: ['www.douyin.com'],
        intents: [{
          intentId: 'intent:douyin:list-profile-videos-api',
          name: 'list profile videos API',
          capabilityId: 'capability:fixture-local:read-api-profile',
          capabilityName: 'list profile videos API',
          capabilityAction: 'view',
          executionPlanId: 'plan:fixture-local:read-api-profile',
          canonicalUtterance: 'list Douyin profile videos',
          utteranceExamples: ['list Douyin profile videos', 'read Douyin video posts'],
          safetyLevel: 'read_only',
          invocationScore: 1,
          runtimeMode: 'browser_bridge_required',
          requiresFreshBridgeEvidence: true,
          genericHttpRuntimeAllowed: false,
        }],
      },
    });
    let request = /** @type {any} */ (null);
    const result = await executeApiRequestIntent({
      registryPath,
      cwd: workspace,
      domain: 'www.douyin.com',
      utterance: 'list Douyin profile videos',
      freshBridgeEvidence: true,
      browserBridgeFetch: async (input) => {
        request = input;
        return {
          statusCode: 200,
          headers: { 'content-type': 'application/json' },
          body: { status_code: 0, aweme_list: [] },
        };
      },
    });

    assert.equal(result.status, 'success');
    assert.equal(request.endpoint.includes('/aweme/v1/web/aweme/post/'), true);
    assert.equal(request.endpointTemplate, endpointTemplate);
    assert.equal(request.runtimeParameterSource.kind, 'douyin_self_user_render_data');
    assert.equal(request.responseEvidence.arrayField, 'aweme_list');
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('api_request runtime resolves opaque runtime binding before browser bridge fetch', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-api-runtime-binding-'));
  try {
    const { registryPath } = await writeApiRequestRuntimeFixture(workspace, {
      endpoint: 'structure-ref:redacted-api-profile',
      stepOverrides: { runtimeBindingId: 'api-binding-1' },
      runtimeBinding: {
        id: 'api-binding-1',
        method: 'GET',
        endpoint: 'https://fixture.local/api/profile?view=summary',
        redactedEndpoint: 'structure-ref:redacted-api-profile',
        authBoundary: 'browser_bridge',
        runtimeMode: 'browser_bridge_required',
        responseMaterial: 'sanitized_summary_only',
      },
      recordOverrides: {
        intents: [{
          intentId: 'intent:fixture-local:read-api-profile',
          name: 'read API endpoint /api/profile',
          capabilityId: 'capability:fixture-local:read-api-profile',
          capabilityName: 'read API endpoint /api/profile',
          capabilityAction: 'view',
          executionPlanId: 'plan:fixture-local:read-api-profile',
          runtimeBindingId: 'api-binding-1',
          canonicalUtterance: 'read API endpoint /api/profile',
          utteranceExamples: ['read API endpoint /api/profile'],
          safetyLevel: 'read_only',
          invocationScore: 1,
          runtimeMode: 'browser_bridge_required',
          requiresFreshBridgeEvidence: true,
          genericHttpRuntimeAllowed: false,
        }],
      },
    });
    let endpoint = null;
    const result = await executeApiRequestIntent({
      registryPath,
      cwd: workspace,
      domain: 'fixture.local',
      utterance: 'read API endpoint /api/profile',
      freshBridgeEvidence: true,
      browserBridgeFetch: async (request) => {
        endpoint = request.endpoint;
        return {
          statusCode: 200,
          headers: { 'content-type': 'application/json' },
          body: { items: [{ id: 1 }] },
        };
      },
    });

    assert.equal(result.status, 'success');
    assert.equal(result.runtimeBindingId, 'api-binding-1');
    assert.equal(endpoint, 'https://fixture.local/api/profile?view=summary');
    assert.equal(JSON.stringify(result).includes('structure-ref:redacted-api-profile'), false);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('api_request runtime blocks stale bridge evidence and unsafe plans before fetch', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-api-runtime-guards-'));
  try {
    const { registryPath } = await writeApiRequestRuntimeFixture(workspace);
    let fetchCalled = false;
    const stale = await executeApiRequestIntent({
      registryPath,
      cwd: workspace,
      domain: 'fixture.local',
      utterance: 'read API endpoint /api/profile',
      freshBridgeEvidence: {
        status: 'verified',
        capturedAt: '2026-05-27T00:00:00.000Z',
      },
      now: new Date('2026-05-27T00:10:01.000Z'),
      browserBridgeFetch: async () => {
        fetchCalled = true;
        return { statusCode: 200, body: {} };
      },
    });

    assert.equal(stale.status, 'blocked');
    assert.equal(stale.reasonCode, 'fresh_browser_bridge_evidence_required');
    assert.equal(fetchCalled, false);

    await writeApiRequestRuntimeFixture(workspace, {
      endpoint: 'https://fixture.local/api/profile',
      method: 'POST',
    });
    const bodylessPost = await executeApiRequestIntent({
      registryPath,
      cwd: workspace,
      domain: 'fixture.local',
      utterance: 'read API endpoint /api/profile',
      freshBridgeEvidence: true,
      browserBridgeFetch: async () => {
        fetchCalled = true;
        return { statusCode: 200, body: {} };
      },
    });
    assert.equal(bodylessPost.status, 'blocked');
    assert.equal(bodylessPost.reasonCode, 'method_not_read_only');
    assert.equal(bodylessPost.method, 'POST');
    assert.equal(fetchCalled, false);

    await writeApiRequestRuntimeFixture(workspace, {
      endpoint: 'https://fixture.local/api/update-profile',
      method: 'POST',
      stepOverrides: { body: { name: 'Ada' } },
    });
    const post = await executeApiRequestIntent({
      registryPath,
      cwd: workspace,
      domain: 'fixture.local',
      utterance: 'read API endpoint /api/profile',
      freshBridgeEvidence: true,
      browserBridgeFetch: async () => {
        fetchCalled = true;
        return { statusCode: 200, body: {} };
      },
    });
    assert.equal(post.status, 'blocked');
    assert.equal(post.reasonCode, 'method_not_read_only');
    assert.equal(fetchCalled, false);

    await writeApiRequestRuntimeFixture(workspace, {
      endpoint: 'https://evil.example/api/profile',
    });
    const crossSite = await executeApiRequestIntent({
      registryPath,
      cwd: workspace,
      domain: 'fixture.local',
      utterance: 'read API endpoint /api/profile',
      freshBridgeEvidence: true,
      browserBridgeFetch: async () => {
        fetchCalled = true;
        return { statusCode: 200, body: {} };
      },
    });
    assert.equal(crossSite.status, 'blocked');
    assert.equal(crossSite.reasonCode, 'cross_site_endpoint');
    assert.equal(fetchCalled, false);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
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
