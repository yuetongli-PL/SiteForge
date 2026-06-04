import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SITE_ADAPTER_CANDIDATE_DECISION_VERSION,
  SITE_ADAPTER_CATALOG_UPGRADE_POLICY_VERSION,
} from '../../src/domain/capabilities/api-candidates.mjs';
import { REDACTION_PLACEHOLDER } from '../../src/domain/sessions/security-guard.mjs';
import { qidianAdapter } from '../../src/sites/adapters/qidian.mjs';
import { resolveSiteAdapter, resolveSiteAdapterById } from '../../src/sites/adapters/resolver.mjs';

function candidate(overrides = {}) {
  return {
    id: 'qidian-candidate-1',
    siteKey: 'qidian',
    status: 'verified',
    endpoint: {
      method: 'GET',
      url: 'https://www.qidian.com/webcommon/user/getUserInfo',
    },
    ...overrides,
  };
}

test('qidian resolves through a dedicated adapter before chapter-content fallback', () => {
  assert.equal(resolveSiteAdapter({ host: 'www.qidian.com' }).id, 'qidian');
  assert.equal(resolveSiteAdapterById('qidian'), qidianAdapter);
  assert.equal(qidianAdapter.inferPageType({ pathname: '/book/123456/' }), 'book-detail-page');
  assert.equal(qidianAdapter.inferPageType({ pathname: '/chapter/123456/7890/' }), 'chapter-page');
  assert.equal(qidianAdapter.inferPageType({ pathname: '/rank/' }), 'category-page');
  assert.equal(qidianAdapter.inferPageType({ pathname: '/rank/yuepiao/' }), 'category-page');
  assert.equal(qidianAdapter.inferPageType({ pathname: '/xuanhuan/' }), 'category-page');
  assert.equal(qidianAdapter.inferPageType({ pathname: '/category/21/' }), 'category-page');
});

test('qidian adapter classifies site pages, WAF probes, and read-only APIs', () => {
  assert.deepEqual(qidianAdapter.classifyApi({
    url: 'https://www.qidian.com/webcommon/user/getUserInfo',
    required: true,
  }), {
    classification: 'recognized',
    recognizedAs: 'qidian:observed-api:/webcommon/user/getUserInfo',
    required: true,
  });
  assert.deepEqual(qidianAdapter.classifyApi({
    url: 'https://www.qidian.com/webcommon/book/category?bookId=1042256511',
    required: true,
  }), {
    classification: 'recognized',
    recognizedAs: 'qidian:observed-api:/webcommon/book/category',
    required: true,
  });
  assert.deepEqual(qidianAdapter.classifyApi({
    url: 'https://www.qidian.com/book/123456/',
  }), {
    classification: 'recognized',
    recognizedAs: 'qidian:page-request:/book/123456/',
    required: false,
  });
  assert.equal(qidianAdapter.classifyApi({
    url: 'https://www.qidian.com/rank/yuepiao/',
  }).recognizedAs, 'qidian:page-request:/rank/yuepiao/');
  assert.equal(qidianAdapter.classifyApi({
    url: 'https://www.qidian.com/xuanhuan/',
  }).recognizedAs, 'qidian:page-request:/xuanhuan/');
  assert.equal(qidianAdapter.classifyApi({
    url: 'https://www.qidian.com/C2WF946J0/probe.js?v=vc1jasc',
  }).classification, 'ignored');
});

test('qidian adapter gates executable API candidates and redacts sensitive evidence', () => {
  const accepted = qidianAdapter.validateApiCandidate({
    candidate: candidate(),
    evidence: {
      cookie: 'ywkey=synthetic-qidian-cookie',
      authorization: 'Bearer synthetic-qidian-token',
    },
  });

  assert.equal(accepted.contractVersion, SITE_ADAPTER_CANDIDATE_DECISION_VERSION);
  assert.equal(accepted.adapterId, 'qidian');
  assert.equal(accepted.adapterVersion, '2026-05-30');
  assert.equal(accepted.decision, 'accepted');
  assert.equal(accepted.scope.validationMode, 'qidian-api-candidate');
  assert.equal(accepted.scope.endpointHost, 'www.qidian.com');
  assert.equal(accepted.scope.endpointPath, '/webcommon/user/getUserInfo');
  assert.equal(accepted.evidence.cookie, REDACTION_PLACEHOLDER);
  assert.equal(accepted.evidence.authorization, REDACTION_PLACEHOLDER);

  const policy = qidianAdapter.getApiCatalogUpgradePolicy({
    candidate: candidate(),
    siteAdapterDecision: accepted,
  });
  assert.equal(policy.contractVersion, SITE_ADAPTER_CATALOG_UPGRADE_POLICY_VERSION);
  assert.equal(policy.adapterId, 'qidian');
  assert.equal(policy.adapterVersion, '2026-05-30');
  assert.equal(policy.allowCatalogUpgrade, true);
  assert.equal(policy.scope.policyMode, 'qidian-api');

  const pageCandidate = qidianAdapter.validateApiCandidate({
    candidate: candidate({
      id: 'qidian-page-candidate',
      endpoint: {
        method: 'GET',
        url: 'https://www.qidian.com/book/123456/',
      },
    }),
  });
  const postCandidate = qidianAdapter.validateApiCandidate({
    candidate: candidate({
      id: 'qidian-post-candidate',
      endpoint: {
        method: 'POST',
        url: 'https://www.qidian.com/webcommon/user/getUserInfo',
      },
    }),
  });

  assert.equal(pageCandidate.decision, 'rejected');
  assert.equal(postCandidate.decision, 'rejected');

  const bookCatalogCandidate = qidianAdapter.validateApiCandidate({
    candidate: candidate({
      id: 'qidian-book-catalog-candidate',
      endpoint: {
        method: 'GET',
        url: 'https://www.qidian.com/webcommon/book/category?bookId=1042256511',
      },
    }),
  });
  assert.equal(bookCatalogCandidate.decision, 'accepted');

  const bookCatalogSemantics = qidianAdapter.describeApiCandidateSemantics({
    candidate: candidate({
      endpoint: {
        method: 'GET',
        url: 'https://www.qidian.com/webcommon/book/category?bookId=1042256511',
      },
    }),
  });
  assert.equal(bookCatalogSemantics.semanticKind, 'read-book-catalog');
  assert.equal(bookCatalogSemantics.outputName, 'book_catalog');
  assert.equal(bookCatalogSemantics.pagination.model, 'page-number-or-site-response');

  const userTicketSemantics = qidianAdapter.describeApiCandidateSemantics({
    candidate: candidate({
      endpoint: {
        method: 'GET',
        url: 'https://www.qidian.com/webcommon/book/getUserMonthTicket?bookId=1042256511&userLevel=0',
      },
    }),
  });
  assert.equal(userTicketSemantics.semanticKind, 'read-user-month-ticket');
  assert.equal(userTicketSemantics.outputName, 'user_month_ticket');
});

test('qidian adapter exposes build API seeds and redacted semantics', () => {
  const seeds = qidianAdapter.getBuildApiDiscoverySeeds({ site: { id: 'qidian' } });
  assert.equal(seeds.length >= 16, true);
  assert.equal(seeds.some((seed) => seed.id === 'qidian-known-api-user-info'), true);
  assert.equal(seeds.some((seed) => seed.id === 'qidian-known-api-system-time'), true);
  assert.equal(seeds.some((seed) => seed.id === 'qidian-known-api-book-catalog'), true);
  assert.equal(seeds.some((seed) => seed.id === 'qidian-known-api-user-month-ticket'), true);
  assert.equal(seeds.some((seed) => seed.id === 'qidian-known-api-user-recommend-ticket'), true);
  assert.equal(seeds.some((seed) => seed.id === 'qidian-known-api-user-donate-balance'), true);
  assert.equal(seeds.some((seed) => seed.id === 'qidian-known-api-search-autocomplete'), true);
  assert.equal(seeds.some((seed) => /addbooks|vote|subscribe|validcode/iu.test(seed.id)), false);
  assert.equal(seeds.some((seed) => /donate/iu.test(seed.id) && !/donate-balance/iu.test(seed.id)), false);
  assert.equal(
    seeds.every((seed) => seed.runtime.runtimeParameterResolution === 'browser_bridge_page_context_qidian_yuew_sign'),
    true,
  );
  assert.equal(
    seeds.every((seed) => seed.runtime.parameterSource.kind === 'qidian_yuew_sign'),
    true,
  );
  assert.equal(
    seeds.every((seed) => /json/iu.test(seed.request.headers.Accept)),
    true,
  );

  const semantics = qidianAdapter.describeApiCandidateSemantics({
    candidate: candidate({
      auth: {
        cookie: 'ywkey=synthetic-qidian-cookie',
      },
    }),
    scope: {
      cookie: 'ywkey=synthetic-qidian-scope-cookie',
    },
  });

  assert.equal(semantics.adapterId, 'qidian');
  assert.equal(semantics.siteKey, 'qidian');
  assert.equal(semantics.semanticKind, 'read-authenticated-user');
  assert.equal(semantics.outputName, 'user_info');
  assert.equal(semantics.auth.cookie, REDACTION_PLACEHOLDER);
  assert.equal(semantics.scope.cookie, REDACTION_PLACEHOLDER);
  assert.equal(JSON.stringify(semantics).includes('synthetic-qidian'), false);
});
