// @ts-check

import { bilibiliAdapter } from '../../adapters/bilibili.mjs';
import { apiCandidateFromObservedRequest } from '../../../domain/capabilities/api-discovery.mjs';
import {
  writeVerifiedApiCatalogArtifactsFromObservedProducerEvidence,
} from '../../../domain/capabilities/api-catalog-promotion.mjs';
import {
  createExecutableCapabilityEvidenceFixture,
} from '../../../domain/capabilities/capability-evidence-chain.mjs';
import {
  createSiteOnboardingDiscoveryArtifacts,
  createSiteOnboardingDiscoveryInputFromCaptureExpand,
} from '../../../domain/capabilities/site-onboarding-discovery.mjs';
import {
  assertNoForbiddenPatterns,
} from '../../../domain/sessions/security-guard.mjs';

const BILIBILI_EVIDENCE_TIMESTAMP = '2026-05-10T00:00:00.000Z';

export function createBilibiliObservedVideoViewRequest() {
  return {
    id: 'bilibili-video-view-api',
    siteKey: 'bilibili',
    status: 'observed',
    method: 'GET',
    url: 'https://api.bilibili.com/x/web-interface/view?bvid=BV1safeexample',
    resourceType: 'fetch',
    source: 'governed-capture-fixture',
    evidence: {
      producer: 'site-onboarding-governed-fixture',
      siteAdapter: 'bilibili',
      surface: 'video-detail-api',
    },
  };
}

export function createBilibiliGovernedProducerFixture() {
  const fixture = {
    siteKey: 'bilibili',
    capture: {
      domNodes: [
        {
          id: 'bilibili-video-card',
          tagName: 'a',
          role: 'link',
          label: 'Video detail',
          href: '/video/BV1safeexample',
          required: true,
        },
        {
          id: 'bilibili-search-form',
          tagName: 'form',
          role: 'search',
          label: 'Search videos',
        },
      ],
      accessibilityNodes: [
        {
          id: 'bilibili-open-video-a11y',
          role: 'link',
          name: 'Open video',
          required: true,
        },
      ],
      jsRoutes: [
        {
          id: 'bilibili-route-video-detail',
          route: '/video/:bvid',
          source: 'history-route-descriptor',
          status: 'observed_only',
        },
      ],
    },
    expand: {
      governedRetryAttempts: [
        {
          id: 'bilibili-up-archive-trigger',
          label: 'Expand UP archive',
          kind: 'button',
          status: 'skipped_by_budget',
          reasonCode: 'skipped_by_budget',
          attempted: true,
          attemptCount: 1,
          governedAttempt: true,
          retryExecuted: true,
        },
      ],
    },
    networkRequests: [
      createBilibiliObservedVideoViewRequest(),
      {
        id: 'bilibili-player-preflight',
        siteKey: 'bilibili',
        method: 'OPTIONS',
        url: 'https://api.bilibili.com/x/player/playurl',
        resourceType: 'preflight',
        status: 'observed',
      },
      {
        id: 'bilibili-live-message-stream',
        siteKey: 'bilibili',
        method: 'GET',
        url: 'wss://api.bilibili.com/sub',
        resourceType: 'websocket',
        status: 'observed',
      },
    ],
    networkResponseSummaries: [
      {
        requestId: 'bilibili-video-view-api',
        statusCode: 200,
        contentType: 'application/json',
        bodyShape: {
          type: 'object',
          fields: {
            code: { type: 'number' },
            data: {
              type: 'object',
              fields: {
                bvid: { type: 'string' },
                pages: { type: 'array' },
                title: { type: 'string' },
              },
            },
          },
        },
        responseSchemaHash: 'sha256:bilibili-video-view-response-shape',
      },
    ],
  };
  assertNoForbiddenPatterns(fixture);
  return fixture;
}

export function createBilibiliApiVerificationFixtures() {
  return {
    verifierId: 'bilibili-site-specific-fixture-verifier',
    verifiedAt: BILIBILI_EVIDENCE_TIMESTAMP,
    responseFixture: {
      statusCode: 200,
      body: {
        code: 0,
        data: {
          bvid: 'BV1safeexample',
          aid: 1000,
          title: 'Safe fixture video',
          pages: [
            {
              cid: 2000,
              page: 1,
              part: 'main',
            },
          ],
        },
      },
    },
    authFixture: {
      authRequirement: 'none',
      requestProtectionRequirement: 'none',
    },
    paginationFixture: {
      paginationModel: 'none',
    },
    riskFixture: {
      riskState: 'low',
      riskLevel: 'low',
    },
    metadata: {
      siteAdapter: 'bilibili',
      evidenceKind: 'site-specific-api-verification-fixture',
    },
  };
}

export async function writeBilibiliVerifiedApiCatalogArtifactsFromGovernedProducerEvidence(paths = {}) {
  const observedRequest = createBilibiliObservedVideoViewRequest();
  const candidate = apiCandidateFromObservedRequest(observedRequest);
  const siteAdapterDecision = bilibiliAdapter.validateApiCandidate({
    candidate,
    validatedAt: BILIBILI_EVIDENCE_TIMESTAMP,
    evidence: {
      source: 'bilibili-governed-producer-fixture',
      endpointEvidence: 'video-view',
    },
  });
  const catalogUpgradePolicy = bilibiliAdapter.getApiCatalogUpgradePolicy({
    candidate,
    siteAdapterDecision,
    decidedAt: BILIBILI_EVIDENCE_TIMESTAMP,
    evidence: {
      policy: 'bilibili-public-video-view-api-fixture',
    },
  });
  return await writeVerifiedApiCatalogArtifactsFromObservedProducerEvidence({
    observedRequest,
    siteAdapterDecision,
    catalogUpgradePolicy,
    verification: createBilibiliApiVerificationFixtures(),
    promotionEvidence: {
      schemaEvidenceRef: 'schema:bilibili:video-view-response',
      policyEvidenceRef: 'policy:bilibili:public-api-catalog',
      testEvidenceRefs: [
        'test:bilibili:site-adapter-contract',
        'test:bilibili:api-catalog-promotion',
      ],
    },
    decidedAt: BILIBILI_EVIDENCE_TIMESTAMP,
    metadata: {
      version: 'bilibili-api-catalog-fixture-v1',
      taskType: 'site-specific-api-evidence',
      adapterVersion: 'bilibili-adapter-fixture-v1',
    },
  }, paths);
}

export function createBilibiliExecutableCapabilityEvidenceFixture({
  apiCatalogRef = 'artifact:api-catalog:bilibili-video-view-api',
  verifiedAt = BILIBILI_EVIDENCE_TIMESTAMP,
} = {}) {
  return createExecutableCapabilityEvidenceFixture({
    capability: 'navigate-to-content',
    id: 'executable-evidence:bilibili:navigate-to-content',
    adapterRef: 'adapter:bilibili:navigate-to-content',
    schemaRef: 'schema:bilibili:video-detail-api',
    testEvidenceRefs: [
      'test:bilibili:site-adapter-contract',
      'test:bilibili:api-catalog-promotion',
    ],
    policyRef: 'policy:bilibili:public-api-catalog',
    riskRef: 'risk:bilibili:public-video-view-low-risk',
    approvalRef: 'approval:bilibili:public-read-only',
    apiCatalogRef,
    verifiedAt,
  });
}

function createBilibiliEvidenceAdapter(capabilityEvidenceFixture) {
  return {
    ...bilibiliAdapter,
    metadata: {
      capabilityEvidenceFixtures: [capabilityEvidenceFixture],
    },
  };
}

export function createBilibiliSiteSpecificDiscoveryArtifacts({
  apiCatalogRef,
} = {}) {
  const producerFixture = createBilibiliGovernedProducerFixture();
  const discoveryInput = createSiteOnboardingDiscoveryInputFromCaptureExpand(producerFixture);
  const capabilityEvidenceFixture = createBilibiliExecutableCapabilityEvidenceFixture({
    apiCatalogRef,
  });
  const artifacts = createSiteOnboardingDiscoveryArtifacts({
    siteKey: 'bilibili',
    requestedCapabilities: ['navigate-to-content'],
    discoveredNodes: discoveryInput.discoveredNodes,
    discoveredApis: discoveryInput.discoveredApis,
    adapter: createBilibiliEvidenceAdapter(capabilityEvidenceFixture),
  });
  assertNoForbiddenPatterns(artifacts);
  return {
    producerFixture,
    discoveryInput,
    capabilityEvidenceFixture,
    artifacts,
    redactionRequired: true,
  };
}

export function createBilibiliSiteSpecificEvidenceSummary() {
  const producerFixture = createBilibiliGovernedProducerFixture();
  const capabilityEvidenceFixture = createBilibiliExecutableCapabilityEvidenceFixture();
  const summary = {
    schemaVersion: 1,
    summaryVersion: '1.0.0',
    summaryType: 'SITE_SPECIFIC_EVIDENCE_SUMMARY',
    siteKey: 'bilibili',
    descriptorOnly: true,
    redactionRequired: true,
    observedApiAutoPromotionAllowed: false,
    observedCapabilityAutoPromotionAllowed: false,
    executableCapabilityAutoPromotionAllowed: false,
    producerCoverage: {
      domNodeCount: producerFixture.capture.domNodes.length,
      accessibilityNodeCount: producerFixture.capture.accessibilityNodes.length,
      jsRouteCount: producerFixture.capture.jsRoutes.length,
      governedRetryAttemptCount: producerFixture.expand.governedRetryAttempts.length,
      networkRequestCount: producerFixture.networkRequests.length,
      networkResponseSummaryCount: producerFixture.networkResponseSummaries.length,
      endpointKinds: ['fetch', 'preflight', 'websocket'],
    },
    apiEvidence: [
      {
        endpointKey: 'GET /x/web-interface/view',
        observedStatus: 'observed_only',
        verifiedCatalogStatus: 'verified_fixture',
        catalogPromotionAllowedByObservation: false,
        requiredPromotionEvidence: ['siteAdapter', 'policy', 'schema', 'test'],
      },
    ],
    capabilityEvidence: [
      {
        capability: capabilityEvidenceFixture.capability,
        verificationState: capabilityEvidenceFixture.verificationState,
        evidenceKinds: capabilityEvidenceFixture.evidenceKinds,
        exactQuorumRequired: capabilityEvidenceFixture.exactQuorumRequired,
        exactQuorumSatisfied: capabilityEvidenceFixture.exactQuorumSatisfied,
        executableCapabilityAllowed: capabilityEvidenceFixture.executableCapabilityAllowed,
      },
    ],
    artifactFamilies: [
      'NODE_INVENTORY',
      'UNKNOWN_NODE_REPORT',
      'BLOCKED_NODE_REPORT',
      'API_INVENTORY',
      'UNKNOWN_API_REPORT',
      'BLOCKED_API_REPORT',
      'CAPABILITY_TARGETS',
      'CAPABILITY_GAP_REPORT',
      'SITE_CAPABILITY_REPORT',
      'DISCOVERY_AUDIT',
    ],
    boundaries: {
      liveCaptureAttempted: false,
      runtimeTaskExecuted: false,
      directDownloaderInvocationAllowed: false,
      directSiteAdapterInvocationAllowed: false,
      sessionViewCreated: false,
    },
  };
  assertNoForbiddenPatterns(summary);
  return summary;
}
