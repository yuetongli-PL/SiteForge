import test from 'node:test';
import assert from 'node:assert/strict';

import {
  setupProfileBlockCode,
  setupProfileBuildBlock,
  setupProfileSummary,
} from '../../src/app/pipeline/build/setup-profile-report.mjs';

test('setup profile summary keeps report-facing fields and evidence counts', () => {
  const profile = {
    artifactFamily: 'siteforge-build-profile',
    source: 'setup-assistant',
    knownSitePolicy: {
      status: 'matched',
      host: 'example.test',
      siteKey: 'example',
      adapterId: 'example-adapter',
      siteArchetype: 'catalog',
      primaryArchetype: 'catalog',
      sources: ['config/site-registry.json'],
      pageTypes: ['catalog'],
      publicRouteTemplates: ['/catalog'],
      capabilityFamilies: ['query-catalog'],
      supportedIntents: ['open-category'],
      downloadTaskTypes: ['none'],
      downloadSupport: { status: 'unsupported' },
      downloader: { id: 'none' },
    },
    evidenceQuality: {
      sourceAvailability: { public: 'available' },
      sourceStatus: { public: 'ok' },
      actualPageEvidenceCount: 2,
      syntheticPageEvidenceCount: 1,
      robotsExcludedPageEvidenceCount: 0,
      allPrimarySourcesUnavailable: false,
      syntheticFallbackOnly: true,
      robotsExcludedAllCandidateEvidence: false,
      knownPolicyCapabilityPressure: { status: 'low' },
    },
    crawlContract: {
      crawlMode: 'public',
      sourceMode: 'static',
      authMethod: 'none',
      authVerificationStatus: 'not_required',
      coverageTargets: { routes: 2 },
      evidencePolicy: { rawPageMaterial: false },
    },
    authStateReport: {
      crawlMode: 'public',
      authMethod: 'none',
      authVerificationStatus: 'not_required',
      verified: false,
      source: 'public-only',
      rawMaterialPersisted: false,
      sessionMaterialPersisted: false,
      browserProfilePersisted: false,
    },
    userAuthorizedEvidence: {
      status: 'captured',
      source: 'browser-summary',
      authorizationMode: 'manual',
      pages: [{ title: 'redacted page title' }],
      browserSeeds: [{ routeKind: 'catalog' }],
      capabilityProofs: [{ capabilityId: 'open-category' }],
      sessionMaterialPersisted: false,
      browserProfilePersisted: false,
      rawHtmlPersisted: false,
    },
    buildReadiness: { status: 'ready', buildable: true },
    partialCoverage: { status: 'partial' },
    profileUsability: { status: 'usable' },
    scope: { maxPages: 4 },
    safety: {
      submitForms: false,
      allowDestructiveActions: false,
      allowPayment: false,
      allowAccountMutation: false,
      allowContactSubmit: false,
    },
    capabilityScope: {
      selectedCapabilities: ['open-category', 'search-catalog'],
    },
  };

  const summary = setupProfileSummary(profile);

  assert.equal(summary.artifactFamily, 'siteforge-build-profile');
  assert.equal(summary.knownSitePolicy.siteKey, 'example');
  assert.deepEqual(summary.evidenceQuality.sourceAvailability, { public: 'available' });
  assert.equal(summary.userAuthorizedEvidence.pageCount, 1);
  assert.equal(summary.userAuthorizedEvidence.browserSeedCount, 1);
  assert.equal(summary.userAuthorizedEvidence.capabilityProofCount, 1);
  assert.equal(summary.selectedCapabilityCount, 2);
  assert.equal(JSON.stringify(summary).includes('redacted page title'), false);
});

test('setup profile summary returns detached report collections', () => {
  const profile = {
    knownSitePolicy: {
      sources: ['config/site-registry.json'],
      pageTypes: ['catalog'],
      publicRouteTemplates: ['/catalog'],
      capabilityFamilies: ['query-catalog'],
      supportedIntents: ['open-category'],
      downloadTaskTypes: [],
      downloadSupport: { status: 'unsupported' },
      downloader: { id: 'none' },
    },
    evidenceQuality: {
      sourceAvailability: { public: 'available' },
      sourceStatus: { public: 'ok' },
      knownPolicyCapabilityPressure: { status: 'low' },
    },
    crawlContract: {
      coverageTargets: { routes: 2 },
      evidencePolicy: { rawPageMaterial: false },
    },
  };

  const summary = setupProfileSummary(profile);
  profile.knownSitePolicy.sources.push('mutated');
  profile.evidenceQuality.sourceAvailability.public = 'mutated';
  profile.crawlContract.coverageTargets.routes = 99;

  assert.deepEqual(summary.knownSitePolicy.sources, ['config/site-registry.json']);
  assert.deepEqual(summary.evidenceQuality.sourceAvailability, { public: 'available' });
  assert.deepEqual(summary.crawlContract.coverageTargets, { routes: 2 });
});

test('setup profile summary sanitizes cloned report-only profile fields', () => {
  const profile = {
    source: 'C:\\Users\\tester\\profiles\\siteforge?access_token=synthetic-profile-token',
    knownSitePolicy: {
      sources: ['https://example.test/policy?token=synthetic-policy-token'],
      pageTypes: ['raw-html'],
      publicRouteTemplates: ['/account?session_id=synthetic-session-id'],
      capabilityFamilies: ['query-catalog'],
      supportedIntents: ['open-category'],
      downloadTaskTypes: [],
      downloadSupport: {
        notes: 'authorization: Bearer synthetic-download-token',
      },
      downloader: {
        configPath: 'C:\\Users\\tester\\downloads\\cookies.txt',
      },
    },
    evidenceQuality: {
      sourceAvailability: {
        private: 'cookie=synthetic-cookie',
      },
      sourceStatus: {
        html: '<html><body>raw body</body></html>',
      },
      knownPolicyCapabilityPressure: {
        detail: 'contact me at owner@example.test',
      },
    },
    crawlContract: {
      coverageTargets: {
        privateRoute: 'https://example.test/private?api_key=synthetic-api-key',
      },
      evidencePolicy: {
        rawDomPath: '/home/tester/raw-dom.html',
      },
    },
    authStateReport: {
      source: 'authorization: Bearer synthetic-auth-token',
    },
    userAuthorizedEvidence: {
      status: 'captured',
      source: 'https://example.test/following?refresh_token=synthetic-refresh-token',
      authorizationMode: 'manual',
      pages: [{ title: '<html>raw page</html>' }],
      browserSeeds: [],
      capabilityProofs: [],
    },
    buildReadiness: {
      reason: 'blocked by token=synthetic-readiness-token in C:\\Users\\tester\\profile',
    },
    partialCoverage: {
      note: 'raw html body leaked',
    },
    profileUsability: {
      reason: 'email owner@example.test',
    },
    scope: {
      note: 'cookie=synthetic-scope-cookie',
    },
  };

  const summaryText = JSON.stringify(setupProfileSummary(profile));

  for (const unsafe of [
    'synthetic-profile-token',
    'synthetic-policy-token',
    'synthetic-session-id',
    'synthetic-download-token',
    'synthetic-cookie',
    'synthetic-api-key',
    'synthetic-auth-token',
    'synthetic-refresh-token',
    'synthetic-readiness-token',
    'synthetic-scope-cookie',
    'owner@example.test',
    'C:\\Users\\tester',
    '/home/tester',
    '<html>',
  ]) {
    assert.equal(summaryText.includes(unsafe), false, `${unsafe} should be redacted from setup profile summary`);
  }
  assert.match(summaryText, /\[REDACTED/u);
});

test('setup profile summary preserves null profile compatibility', () => {
  assert.equal(setupProfileSummary(null), null);
});

test('setup profile block maps unusable profiles to build block reports', () => {
  const profile = {
    buildReadiness: {
      status: 'not_ready',
      buildable: false,
      reasonCode: 'setup-primary-sources-unavailable',
      reason: 'primary sources unavailable',
    },
    profileUsability: {
      reasonCode: 'setup-profile-unusable',
    },
    knownSitePolicy: {
      siteKey: 'example',
      adapterId: 'example-adapter',
      sources: ['config/site-registry.json'],
    },
  };

  const block = setupProfileBuildBlock(profile);
  profile.knownSitePolicy.sources.push('mutated');

  assert.equal(block.code, 'robots-unavailable');
  assert.equal(block.setupReasonCode, 'setup-primary-sources-unavailable');
  assert.deepEqual(block.reasonCodes, ['setup-primary-sources-unavailable', 'setup-profile-unusable']);
  assert.deepEqual(block.summary.knownSitePolicy.sources, ['config/site-registry.json']);
  assert.match(block.message, /primary sources unavailable/u);
  assert.match(block.warnings[0], /setup-primary-sources-unavailable/u);
});

test('setup profile block sanitizes unsafe public reason fields', () => {
  const block = setupProfileBuildBlock({
    buildReadiness: {
      status: 'not_ready',
      buildable: false,
      reasonCode: 'setup-primary-sources-unavailable',
      reason: 'blocked by token=synthetic-block-token in C:\\Users\\tester\\profile',
    },
    knownSitePolicy: {
      sources: ['https://example.test/source?access_token=synthetic-source-token'],
    },
  });

  const blockText = JSON.stringify(block);

  assert.equal(blockText.includes('synthetic-block-token'), false);
  assert.equal(blockText.includes('synthetic-source-token'), false);
  assert.equal(blockText.includes('C:\\Users\\tester'), false);
  assert.match(block.message, /\[REDACTED_SECRET\]/u);
});

test('setup profile block preserves API discovery fallback escape hatch', () => {
  const profile = {
    buildReadiness: {
      status: 'not_ready',
      buildable: false,
      reasonCode: 'browser_auth_routes_uncovered',
    },
  };

  assert.equal(setupProfileBuildBlock(profile, {
    allowSetupBlockedApiDiscovery: true,
    renderJs: true,
    captureNetwork: true,
  }), null);
  assert.notEqual(setupProfileBuildBlock(profile, {
    allowSetupBlockedApiDiscovery: true,
    renderJs: false,
    captureNetwork: true,
  }), null);
});

test('setup profile block code keeps public reason compatibility', () => {
  assert.equal(setupProfileBlockCode('robots-disallowed'), 'robots-disallowed');
  assert.equal(setupProfileBlockCode('known-robots-disallowed'), 'robots-disallowed');
  assert.equal(setupProfileBlockCode('setup-primary-sources-unavailable'), 'robots-unavailable');
  assert.equal(setupProfileBlockCode('setup-profile-unusable'), 'siteforge-seed-discovery-empty');
  assert.equal(setupProfileBuildBlock({ buildReadiness: { status: 'ready', buildable: true } }), null);
});
