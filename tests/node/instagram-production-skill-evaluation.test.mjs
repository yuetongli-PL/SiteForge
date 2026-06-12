import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluateArtifacts,
  renderMarkdown,
} from '../../tools/evaluate-instagram-production-skill.mjs';

function capability(id, status, extra = {}) {
  return {
    id: `capability:instagram.com-ea2ecfbf:${id}`,
    status,
    evidence_status: status === 'active' ? 'verified' : 'candidate',
    evidenceMatrix: status === 'active' ? { activationDecision: 'active' } : { activationDecision: 'candidate' },
    activationBlockedReason: status === 'candidate' ? 'capability-evidence-matrix-incomplete' : undefined,
    reason: status === 'disabled' ? 'site-policy-disabled-action' : undefined,
    ...extra,
  };
}

function baseArtifacts(overrides = {}) {
  const active = [
    capability('search-posts', 'active'),
    capability('read-post-detail', 'active'),
  ];
  const candidate = [
    capability('capture-network-apis', 'candidate', {
      reason: 'API candidates remain debug-only until replay verification and runtime binding evidence are available.',
    }),
    capability('read-user-media', 'candidate'),
  ];
  const disabled = [
    capability('publish-post', 'disabled'),
    capability('like-post', 'disabled'),
    capability('follow-user', 'disabled'),
    capability('send-direct-message', 'disabled'),
    capability('change-account-password', 'disabled'),
    capability('delete-post', 'disabled'),
    capability('edit-profile', 'disabled'),
    capability('change-payment-settings', 'disabled'),
    capability('create-post-draft', 'disabled'),
    capability('create-direct-message-draft', 'disabled'),
    capability('create-reply-draft', 'disabled'),
    capability('repost-post', 'disabled'),
    capability('unfollow-user', 'disabled'),
    capability('publish-reply', 'disabled'),
    capability('change-account-email', 'disabled'),
    capability('change-account-2fa', 'disabled'),
    capability('change-account-security-settings', 'disabled'),
  ];
  const taskTemplates = [
    'account-full-archive',
    'account-works-archive',
    'keyword-trend',
    'industry-report',
    'account-composite-profile',
    'account-content-profile',
    'relation-list-collection',
    'event-timeline',
    'similar-account-discovery',
  ].map((id) => ({
    id,
    input: id.includes('keyword') || id.includes('timeline') ? 'query' : 'account',
    buckets: ['bucket-1'],
    plannerCommand: `plan ${id}`,
    executeCommand: `execute ${id}`,
  }));
  const artifacts = {
    buildDir: 'builds/current',
    buildReport: {
      buildId: '20260609T000000000Z',
      siteId: 'instagram.com-ea2ecfbf',
      status: 'success',
      summary: {
        siteAdapter: {
          sourceSiteKey: 'instagram',
          sourceAdapterId: 'instagram',
          adapter_kind: 'site_dedicated_generated_profile',
        },
        coverage: {
          crawlMode: 'authenticated_authorized_source',
        },
        auth: {
          savedMaterial: {
            rawMaterialPersisted: false,
            cookieMaterialPersisted: false,
            privateBodyPersisted: false,
          },
        },
        network: {
          replayVerifiedCount: 0,
          sanitizedSummary: {
            rawTracesPersisted: false,
          },
        },
      },
    },
    verificationReport: { status: 'passed' },
    runtimeExecutionReport: {
      status: 'completed',
      runtimeExecuted: true,
      resultSummary: {
        contextTransfer: { status: 'completed' },
      },
      compositionExecution: {
        steps: [
          { contextOutput: { fields: ['resultSummary'] } },
          { contextInput: { fields: ['resultSummary'] } },
        ],
      },
    },
    runtimeDispatchReport: {
      runtimeInvocationRequest: {
        descriptorOnly: true,
      },
    },
    capabilitiesArtifact: {
      capabilities: [...active, ...candidate, ...disabled],
    },
    executionPlansArtifact: {
      executionPlans: active.map((item) => ({ capabilityId: item.id })),
    },
    executionContractsArtifact: {
      executionContracts: active.map((item) => ({ capabilityId: item.id })),
    },
    catalog: {
      apiFirstPolicy: {
        status: 'no_active_api',
        activeApiCapabilities: [],
        fallbackPolicy: 'immediate_verified_site_fallback',
      },
      taskTemplates,
      siteFallbacks: {
        'account-info': 'cmd',
        'profile-content': 'cmd',
        'profile-following': 'cmd',
        'profile-followers': 'cmd',
        search: 'cmd',
      },
    },
    dryRunSummary: {
      bucketCounts: { planned: 1 },
      task: {
        noStallPolicy: { resume: 'reuse-task-state-before-live-retry' },
      },
      artifactContract: {
        requiredFiles: ['task-plan.json'],
        paths: { outDir: '/missing' },
      },
      productionEvidence: {
        contentCollectionComplete: false,
      },
    },
    realAttemptSummary: {
      status: 'failed',
      failures: [
        {
          layer: 'login',
          reasonCode: 'login_or_session_required',
          remediation: '刷新用户授权浏览器会话。',
        },
      ],
      productionEvidence: {
        contentCollectionComplete: false,
      },
    },
    relationAttemptSummary: {
      status: 'blocked',
      productionEvidence: {
        contentCollectionComplete: false,
      },
    },
    degradedSummary: {
      status: 'completed',
      productionEvidence: {
        contentCollectionComplete: false,
      },
    },
    plannerCheck: {
      ok: true,
      safety: {
        descriptorOnly: true,
        sensitiveMaterialRead: false,
      },
    },
    apiCaptureProbe: null,
    apiReplayAudit: null,
    profileExists: false,
  };
  return {
    ...artifacts,
    ...overrides,
  };
}

function verifiedApiReplayAudit() {
  const operations = [
    'instagram-web-profile-info',
    'instagram-feed-user',
    'instagram-friendships-following',
    'instagram-friendships-followers',
  ].map((id) => ({
    id,
    method: 'GET',
    replayVerified: true,
    adapterBound: {
      accepted: true,
      adapterId: 'instagram',
    },
    runtimeTested: {
      completed: true,
      status: 'completed',
    },
    authBoundary: {
      redactionAuditsPassed: true,
    },
  }));
  return {
    status: 'verified',
    summary: {
      operationCount: operations.length,
      verifiedOperationCount: operations.length,
      activeApiCapabilityCount: 3,
      replayVerified: true,
      adapterBound: true,
      runtimeTested: true,
      redactionAuditsPassed: true,
      relationTaskStatus: 'completed',
      relationTaskCollectedRecordCount: 57,
    },
    operations,
    activeApiCapabilities: [
      { id: 'instagram-api-profile-info' },
      { id: 'instagram-api-profile-posts' },
      { id: 'instagram-api-profile-relations' },
    ],
    safety: {
      sensitiveMaterial: {
        cookieFilePathPersisted: false,
        cookieNamesPersisted: false,
        cookieValuesPersisted: false,
        authHeadersPersisted: false,
        browserProfilePathPersistedInAudit: false,
        rawPrivateBodiesPersisted: false,
      },
    },
  };
}

test('instagram production evaluation refuses 100 without real content collection', () => {
  const evaluation = evaluateArtifacts(baseArtifacts());
  assert.equal(evaluation.status, 'not_production_complete');
  assert.equal(evaluation.supportAnswer.specifiedUserAllWorks, 'not_supported_yet');
  assert.equal(evaluation.evidence.realContentComplete, false);
  assert.equal(evaluation.scores.capped < 100, true);
  assert.equal(evaluation.blockers.some((blocker) => blocker.reasonCode === 'real_content_jsonl_not_collected'), true);
});

test('instagram production evaluation keeps candidate reasons explainable from activation blockers', () => {
  const evaluation = evaluateArtifacts(baseArtifacts());
  assert.equal(evaluation.scores.discovery.metrics.candidateExplainability, 100);
  assert.equal(evaluation.capabilityState.candidate.every((capability) => capability.reason), true);
});

test('instagram production evaluation separates content profile support from all-works archive support', () => {
  const evaluation = evaluateArtifacts(baseArtifacts({
    realAttemptSummary: {
      status: 'completed',
      task: { id: 'account-content-profile' },
      failures: [],
      productionEvidence: {
        contentCollectionComplete: true,
        collectedRecordCount: 202,
      },
    },
    relationAttemptSummary: {
      status: 'failed',
      failures: [
        {
          layer: 'empty_result',
          reasonCode: 'empty_result',
          remediation: '补关系弹窗选择器或 API replay 证据。',
        },
      ],
    },
    profileExists: true,
  }));

  assert.equal(evaluation.status, 'not_production_complete');
  assert.equal(evaluation.evidence.realContentComplete, true);
  assert.equal(evaluation.evidence.accountContentProfileSupported, true);
  assert.equal(evaluation.evidence.specifiedUserAllWorksSupported, false);
  assert.equal(evaluation.supportAnswer.accountContentProfile, 'supported_with_current_artifacts');
  assert.equal(evaluation.supportAnswer.specifiedUserAllWorks, 'not_supported_yet');
  assert.equal(evaluation.blockers.some((blocker) => blocker.reasonCode === 'real_content_jsonl_not_collected'), false);
  assert.equal(evaluation.blockers.some((blocker) => blocker.reasonCode === 'account_content_profile_completed_works_archive_not_verified'), true);
  assert.equal(evaluation.scores.taskCompletion.metrics.endToEndCompletion, 80);
  assert.equal(evaluation.scores.capped < 100, true);
});

test('instagram production evaluation accepts verified works archive support but still blocks on API and relations', () => {
  const evaluation = evaluateArtifacts(baseArtifacts({
    realAttemptSummary: {
      status: 'completed',
      task: { id: 'account-works-archive' },
      failures: [],
      productionEvidence: {
        contentCollectionComplete: true,
        collectedRecordCount: 402,
        userArchiveSupport: 'supported_with_current_artifacts',
      },
    },
    relationAttemptSummary: {
      status: 'failed',
      failures: [
        {
          layer: 'runtime',
          reasonCode: 'command_timeout',
          remediation: '补关系弹窗选择器或 API replay 证据。',
        },
      ],
    },
    profileExists: true,
  }));

  assert.equal(evaluation.evidence.specifiedUserAllWorksSupported, true);
  assert.equal(evaluation.supportAnswer.specifiedUserAllWorks, 'supported');
  assert.equal(evaluation.blockers.some((blocker) => blocker.layer === 'all_works_archive'), false);
  assert.equal(evaluation.blockers.some((blocker) => blocker.reasonCode === 'no_replay_verified_instagram_api'), true);
  assert.equal(evaluation.blockers.some((blocker) => blocker.reasonCode === 'command_timeout'), true);
  assert.equal(evaluation.status, 'not_production_complete');
});

test('instagram production evaluation reaches 100 only with verified API audit and completed relation task', () => {
  const base = baseArtifacts();
  const evaluation = evaluateArtifacts(baseArtifacts({
    catalog: {
      ...base.catalog,
      apiFirstPolicy: {
        status: 'active_api_with_verified_site_fallback',
        activeApiCapabilities: [
          { id: 'instagram-api-profile-info' },
          { id: 'instagram-api-profile-posts' },
          { id: 'instagram-api-profile-relations' },
        ],
        fallbackPolicy: 'immediate_verified_site_fallback',
      },
    },
    realAttemptSummary: {
      status: 'completed',
      task: { id: 'account-works-archive' },
      failures: [],
      productionEvidence: {
        contentCollectionComplete: true,
        collectedRecordCount: 402,
        userArchiveSupport: 'supported_with_current_artifacts',
      },
    },
    relationAttemptSummary: {
      status: 'completed',
      failures: [],
      productionEvidence: {
        contentCollectionComplete: true,
        collectedRecordCount: 57,
      },
    },
    dryRunSummary: {
      bucketCounts: { planned: 1 },
      task: {
        noStallPolicy: { resume: 'reuse-task-state-before-live-retry' },
      },
      artifactContract: {
        requiredFiles: ['package.json'],
        paths: { outDir: '.' },
      },
      productionEvidence: {
        contentCollectionComplete: false,
      },
    },
    apiReplayAudit: verifiedApiReplayAudit(),
    profileExists: true,
  }));

  assert.equal(evaluation.status, 'production_complete');
  assert.equal(evaluation.scores.capped, 100);
  assert.equal(evaluation.blockers.length, 0);
  assert.equal(evaluation.apiFirstPolicy.replayVerifiedApiCount, 4);
  assert.equal(evaluation.apiFirstPolicy.falseApiClaimMade, false);
});

test('instagram production evaluation markdown states specified-user archive boundary', () => {
  const evaluation = evaluateArtifacts(baseArtifacts());
  const markdown = renderMarkdown(evaluation);
  assert.match(markdown, /指定用户所有作品支持性/u);
  assert.match(markdown, /not_supported_yet/u);
  assert.doesNotMatch(markdown, /Bearer\s+[A-Za-z0-9._-]+|set-cookie:|Authorization:\s*\S+/iu);
});
