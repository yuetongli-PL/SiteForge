import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createCrawlContract,
} from '../../src/app/pipeline/build/auth-state.mjs';
import {
  assertBuildProfileSafe,
  isBuildProfileSafe,
} from '../../src/app/pipeline/build/build-profile-safety.mjs';
import {
  buildProfileAuthRequiresFreshVerification,
  reusableBuildProfileAuthStateReport,
  reusableBuildProfileCrawlContract,
} from '../../src/app/pipeline/build/build-profile-reuse.mjs';

const site = Object.freeze({
  id: 'example-test',
  rootUrl: 'https://example.test/',
  allowedDomains: ['example.test'],
});

function publicAuthStateReport(extra = {}) {
  return {
    authMethod: 'none',
    authVerificationStatus: 'not_requested',
    verified: false,
    source: 'public_only',
    blockingSignals: [],
    positiveSignals: ['public_only_default'],
    ...extra,
  };
}

function cookieVerifiedAuthStateReport(extra = {}) {
  return {
    authMethod: 'cookie',
    authVerificationStatus: 'cookie_verified',
    verified: true,
    source: 'cookie_header_verification',
    blockingSignals: [],
    positiveSignals: ['cookie_auth_verified'],
    rawMaterialPersisted: false,
    sessionMaterialPersisted: false,
    cookieMaterialPersisted: false,
    browserProfilePersisted: false,
    ...extra,
  };
}

test('public saved build profile reuses normalized auth report and crawl contract', () => {
  const authStateReport = publicAuthStateReport();
  const crawlContract = createCrawlContract({
    site,
    authStateReport,
    coverageTargets: {
      publicRoutes: ['/'],
      authRoutes: [],
      publicRevisitRoutes: ['/'],
      candidateCapabilities: ['browse-site-navigation'],
      requiresLoginCapabilities: [],
    },
  });
  const buildProfile = {
    artifactFamily: 'siteforge-build-profile',
    site,
    authStateReport,
    crawlContract,
  };

  assert.equal(buildProfileAuthRequiresFreshVerification(buildProfile), false);

  const reusedAuthStateReport = reusableBuildProfileAuthStateReport({ site, buildProfile });
  const reusedCrawlContract = reusableBuildProfileCrawlContract({
    site,
    buildProfile,
    authStateReport: reusedAuthStateReport,
  });

  assert.equal(reusedAuthStateReport.artifactFamily, 'siteforge-auth-state-report');
  assert.equal(reusedAuthStateReport.crawlMode, 'public_only');
  assert.equal(reusedAuthStateReport.authMethod, 'none');
  assert.equal(reusedAuthStateReport.authVerificationStatus, 'not_requested');
  assert.equal(reusedAuthStateReport.verified, false);
  assert.deepEqual(reusedCrawlContract, crawlContract);
  assert.notEqual(reusedCrawlContract, crawlContract);
});

test('authenticated saved build profile downgrades to public-only until auth is reverified', () => {
  const authStateReport = cookieVerifiedAuthStateReport();
  const crawlContract = createCrawlContract({
    site,
    authStateReport,
    coverageTargets: {
      publicRoutes: ['/'],
      authRoutes: ['/account'],
      publicRevisitRoutes: ['/'],
      candidateCapabilities: ['browse-site-navigation'],
      requiresLoginCapabilities: ['view-account'],
    },
  });
  const buildProfile = {
    artifactFamily: 'siteforge-build-profile',
    site,
    authStateReport,
    crawlContract,
  };

  assert.equal(buildProfileAuthRequiresFreshVerification(buildProfile), true);

  const reusedAuthStateReport = reusableBuildProfileAuthStateReport({ site, buildProfile });
  const reusedCrawlContract = reusableBuildProfileCrawlContract({
    site,
    buildProfile,
    authStateReport: reusedAuthStateReport,
  });

  assert.equal(reusedAuthStateReport.crawlMode, 'public_only');
  assert.equal(reusedAuthStateReport.authMethod, 'none');
  assert.equal(reusedAuthStateReport.authVerificationStatus, 'not_requested');
  assert.equal(reusedAuthStateReport.verified, false);
  assert.equal(reusedAuthStateReport.blockingSignals.includes('saved-auth-reverify-required'), true);
  assert.equal(reusedCrawlContract.crawlMode, 'public_only');
  assert.equal(reusedCrawlContract.authMethod, 'none');
  assert.equal(reusedCrawlContract.authVerificationStatus, 'not_requested');
  assert.deepEqual(reusedCrawlContract.coverageTargets.authRoutes, crawlContract.coverageTargets.authRoutes);
  assert.equal(reusedCrawlContract.evidencePolicy.allowAuthenticatedCookie, false);
  assert.equal(reusedCrawlContract.evidencePolicy.allowCookieInput, false);
});

test('explicit auth report and crawl contract options override saved build profile values', () => {
  const savedAuthStateReport = cookieVerifiedAuthStateReport();
  const savedCrawlContract = createCrawlContract({
    site,
    authStateReport: savedAuthStateReport,
    coverageTargets: {
      publicRoutes: ['/'],
      authRoutes: ['/account'],
      publicRevisitRoutes: ['/'],
      candidateCapabilities: [],
      requiresLoginCapabilities: ['view-account'],
    },
  });
  const overrideAuthStateReport = publicAuthStateReport({
    positiveSignals: ['explicit-public-override'],
  });
  const overrideCrawlContract = createCrawlContract({
    site,
    authStateReport: overrideAuthStateReport,
    coverageTargets: {
      publicRoutes: ['/override'],
      authRoutes: [],
      publicRevisitRoutes: ['/override'],
      candidateCapabilities: ['override-capability'],
      requiresLoginCapabilities: [],
    },
  });
  const buildProfile = {
    artifactFamily: 'siteforge-build-profile',
    site,
    authStateReport: savedAuthStateReport,
    crawlContract: savedCrawlContract,
  };
  const options = {
    authStateReport: overrideAuthStateReport,
    crawlContract: overrideCrawlContract,
  };

  const reusedAuthStateReport = reusableBuildProfileAuthStateReport({ options, site, buildProfile });
  const reusedCrawlContract = reusableBuildProfileCrawlContract({
    options,
    site,
    buildProfile,
    authStateReport: reusedAuthStateReport,
  });

  assert.equal(reusedAuthStateReport.crawlMode, 'public_only');
  assert.deepEqual(reusedAuthStateReport.positiveSignals, ['explicit-public-override']);
  assert.deepEqual(reusedCrawlContract, overrideCrawlContract);
  assert.notEqual(reusedCrawlContract, overrideCrawlContract);
});

test('build profile safety rejects persisted runtime secrets', () => {
  const profile = {
    artifactFamily: 'siteforge-build-profile',
    site,
    authStateReport: publicAuthStateReport(),
    metadata: {
      cookieHeader: 'sid=secret',
    },
  };

  assert.equal(isBuildProfileSafe(profile), false);
  assert.throws(
    () => assertBuildProfileSafe(profile),
    /sensitive fields: metadata\.cookieHeader/u,
  );
});
