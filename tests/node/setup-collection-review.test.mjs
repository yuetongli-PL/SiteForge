import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCollectionReviewModel,
  collectionReviewLabel,
  createCollectionReviewModel,
  normalizeUserAuthorizedCapabilityProofs,
  renderSetupCollectionReviewLines,
  reconcileSetupCollectionReviewWithBuildOutputs,
  setupCollectionReviewReport,
  SETUP_COLLECTION_REVIEW_SCHEMA_VERSION,
} from '../../src/app/pipeline/build/setup-collection-review.mjs';
import { normalizeCapabilityId } from '../../src/app/pipeline/build/capability-id.mjs';
import {
  buildCollectionReviewModel as setupAssistantBuildCollectionReviewModel,
  createCollectionReviewModel as setupAssistantCreateCollectionReviewModel,
} from '../../src/app/pipeline/build/setup-assistant.mjs';

test('setup build capability ids normalize consistently', () => {
  assert.equal(normalizeCapabilityId(' List Bookmarks '), 'list-bookmarks');
  assert.equal(normalizeCapabilityId('list_bookmarks'), 'list-bookmarks');
  assert.equal(normalizeCapabilityId(''), '');
});

test('setup collection review model records sanitized public setup evidence', () => {
  const review = buildCollectionReviewModel({
    setupPlan: {
      buildId: 'review-public',
      site: { id: 'example-test' },
      pageGroups: [{
        id: 'catalog',
        name: 'Catalog Pages',
        count: 2,
        sampleUrls: ['https://example.test/catalog?access_token=SECRET'],
        sampleLabels: ['Catalog item list'],
      }],
      recommendedCapabilities: [{
        id: 'navigate-catalog',
        name: 'Navigate catalog',
        recommended: true,
        safety: 'read_only',
      }],
      buildReadiness: {
        reasonCode: 'ready',
      },
    },
  });

  assert.equal(review.schemaVersion, SETUP_COLLECTION_REVIEW_SCHEMA_VERSION);
  assert.equal(review.artifactFamily, 'siteforge-collection-review');
  assert.equal(review.summary.seeds.collected, 1);
  assert.equal(review.summary.nodes.collected, 1);
  assert.equal(review.summary.affordances.collected, 1);
  assert.equal(review.capabilities.collected.some((item) => item.id === 'navigate-catalog'), true);
  assert.doesNotMatch(JSON.stringify(review), /SECRET/u);
});

test('setup collection review model maps user-authorized capability proofs without raw material', () => {
  const proofs = normalizeUserAuthorizedCapabilityProofs([{
    status: 'verified',
    capabilityId: 'list-followed-users',
    sampleCount: 3,
    source: 'https://social.test/following?token=SECRET',
  }]);
  assert.equal(proofs.length, 1);
  assert.doesNotMatch(JSON.stringify(proofs), /SECRET/u);

  const review = createCollectionReviewModel({
    setupPlan: {
      buildId: 'review-auth',
      site: { id: 'social-test' },
      recommendedCapabilities: [{
        id: 'list-followed-users',
        name: 'List followed users',
        evidenceRequirement: 'capability-specific-evidence',
        safety: 'read_only',
      }],
      userAuthorizedEvidence: {
        status: 'captured',
        pages: [{
          normalizedUrl: 'https://social.test/following?token=SECRET',
          title: 'Following',
          textSummary: 'Following list',
        }],
        browserSeeds: [{
          normalizedUrl: 'https://social.test/following?token=SECRET',
          routeKind: 'following',
          capabilityIds: ['list-followed-users'],
          visibleItemCount: 3,
        }],
        capabilityProofs: [{
          status: 'verified',
          capabilityId: 'list-followed-users',
          evidenceType: 'visible-count',
          sampleCount: 3,
          source: 'https://social.test/following?token=SECRET',
        }],
      },
      buildReadiness: {
        reasonCode: 'ready',
      },
    },
  });

  assert.equal(review.userAuthorizedEvidence.status, 'captured');
  assert.equal(review.userAuthorizedEvidence.capabilityProofCount, 1);
  assert.equal(review.capabilities.collected.some((item) => item.id === 'list-followed-users'), true);
  assert.equal(review.affordances.collected.some((item) => item.id === 'capability-proof-list-followed-users'), true);
  assert.equal(review.userAuthorizedEvidence.sessionMaterialPersisted, false);
  assert.doesNotMatch(JSON.stringify(review), /SECRET/u);
});

test('setup collection review model keeps known-site policy gaps explicit', () => {
  const review = buildCollectionReviewModel({
    setupPlan: {
      buildId: 'review-policy',
      site: { id: 'known-social' },
      buildReadiness: {
        buildable: false,
        reasonCode: 'robots-disallowed',
      },
      knownSitePolicy: {
        status: 'matched',
        siteKey: 'known-social',
        adapterId: 'known-social-adapter',
        capabilityFamilies: ['query-social-content'],
        supportedIntents: ['search-posts'],
        downloadSessionRequirement: 'required',
        sources: ['config/site-registry.json'],
      },
    },
  });

  assert.equal(review.knownSitePolicy.siteKey, 'known-social');
  assert.equal(review.summary.seeds.missing > 0, true);
  assert.equal(review.seeds.missing.some((item) => item.id === 'user-authorized-browser-evidence'), true);
  assert.equal(review.capabilities.missing.some((item) => item.id === 'search-posts'), true);
  assert.equal(review.intents.missing.some((item) => item.id === 'search-posts'), true);
});

test('setup collection review report reconciles final build capabilities and intents', () => {
  const review = {
    schemaVersion: SETUP_COLLECTION_REVIEW_SCHEMA_VERSION,
    artifactFamily: 'siteforge-collection-review',
    buildId: 'review-final',
    siteId: 'example-test',
    capabilities: {
      collected: [],
      missing: [{
        id: 'list-categories',
        label: 'List categories',
        status: 'missing',
        reasonCode: 'setup-evidence-missing',
        extra: { evidenceRequirement: 'public-structure' },
      }],
    },
    intents: {
      collected: [],
      missing: [{
        id: 'open-category-list',
        label: 'Open category list',
        status: 'missing',
        reasonCode: 'setup-intent-missing',
      }],
    },
    seeds: { collected: [], missing: [] },
    nodes: { collected: [], missing: [] },
    affordances: { collected: [], missing: [] },
  };

  const reconciled = reconcileSetupCollectionReviewWithBuildOutputs(review, [{
    id: 'cap-category',
    name: 'Read category list',
    status: 'active',
  }], [{
    id: 'intent-category',
    capabilityId: 'cap-category',
    canonicalUtterance: 'open category list',
    callable: true,
  }]);
  const report = setupCollectionReviewReport(reconciled, 'C:\\repo\\build_profile.json?token=SECRET');

  assert.equal(reconciled.capabilities.missing.length, 0);
  assert.equal(reconciled.capabilities.collected[0].collectedBy, 'final-build-capability-or-intent');
  assert.equal(reconciled.intents.missing.length, 0);
  assert.equal(report.summary.capabilities.collected, 1);
  assert.equal(report.summary.capabilities.missing, 0);
  assert.equal(report.missingRecordCount, 0);
  assert.doesNotMatch(JSON.stringify(report), /SECRET/u);
});

test('setup collection review debug lines render bounded missing evidence', () => {
  const lines = renderSetupCollectionReviewLines({
    summary: {
      seeds: { collected: 1 },
      nodes: { collected: 2 },
      affordances: { collected: 3 },
      capabilities: { collected: 4, missing: 6 },
      intents: { collected: 5, missing: 1 },
    },
    missingRecords: Array.from({ length: 6 }, (_, index) => ({
      kind: 'capabilities',
      id: `cap-${index}`,
      label: `Capability ${index}`,
      reasonCode: 'setup-evidence-missing',
    })),
  });

  assert.equal(lines[0], 'Collection review:');
  assert.match(lines[1], /seeds=1 nodes=2 affordances=3 capabilities=4 intents=5/u);
  assert.match(lines[2], /capabilities=6 intents=1/u);
  assert.equal(lines.filter((line) => line.includes('setup-evidence-missing')).length, 5);
  assert.equal(lines.at(-1), '    - See build_report.json for the full collection review.');
  assert.deepEqual(renderSetupCollectionReviewLines(null), []);
});

test('setup assistant keeps compatibility exports for collection review model', () => {
  assert.equal(setupAssistantBuildCollectionReviewModel, buildCollectionReviewModel);
  assert.equal(setupAssistantCreateCollectionReviewModel, createCollectionReviewModel);
  assert.equal(collectionReviewLabel('policy-intent-search-posts'), 'search posts');
  assert.doesNotMatch(collectionReviewLabel('https://example.test/path?access_token=SECRET'), /SECRET/u);
});
