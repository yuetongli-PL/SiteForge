import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isForbiddenFreshEvidenceHeaderName,
  redactFreshEvidenceUrlTokens,
  sanitizeFreshEvidenceHeaders,
} from '../../src/domain/sessions/fresh-evidence-redaction.mjs';
import { resolveXiaohongshuFreshEvidence } from '../../src/sites/known-sites/xiaohongshu/actions/router.mjs';

const REDACTED = '[REDACTED]';

function joinParts(...parts) {
  return parts.join('');
}

test('fresh evidence helper drops credential headers and redacts URL token values', () => {
  assert.equal(isForbiddenFreshEvidenceHeaderName('Cookie'), true);
  assert.equal(isForbiddenFreshEvidenceHeaderName('Authorization'), true);
  assert.equal(isForbiddenFreshEvidenceHeaderName('x-csrf-token'), true);
  assert.equal(isForbiddenFreshEvidenceHeaderName('x-xsrf-token'), true);
  assert.equal(isForbiddenFreshEvidenceHeaderName('x-session-id'), true);
  assert.equal(isForbiddenFreshEvidenceHeaderName('session-key'), true);
  assert.equal(isForbiddenFreshEvidenceHeaderName('xsec_token'), true);
  assert.equal(isForbiddenFreshEvidenceHeaderName('User-Agent'), false);

  const headers = sanitizeFreshEvidenceHeaders({
    [joinParts('coo', 'kie')]: ['a', 'b'].join('='),
    [joinParts('author', 'ization')]: ['Bearer', 'synthetic-auth'].join(' '),
    'x-csrf-token': 'synthetic-csrf',
    'x-xsrf-token': 'synthetic-xsrf',
    'x-session-id': 'synthetic-session',
    'xsec_token': 'synthetic-xsec',
    referer: 'https://www.xiaohongshu.com/explore/note?xsec_token=synthetic-xsec&session_id=synthetic-session&safe=1',
    'user-agent': 'Mozilla/5.0',
  });

  assert.deepEqual(headers, {
    Referer: 'https://www.xiaohongshu.com/explore/note?xsec_token=%5BREDACTED%5D&session_id=%5BREDACTED%5D&safe=1',
    'User-Agent': 'Mozilla/5.0',
  });
  assert.equal(JSON.stringify(headers).includes('synthetic-'), false);

  const rawUrl = 'https://example.invalid/path?xsec_token=synthetic-xsec&token=synthetic-token&auth=synthetic-auth&safe=1';
  const redactedUrl = redactFreshEvidenceUrlTokens(rawUrl);
  const parsed = new URL(redactedUrl);
  assert.equal(parsed.searchParams.get('xsec_token'), REDACTED);
  assert.equal(parsed.searchParams.get('token'), REDACTED);
  assert.equal(parsed.searchParams.get('auth'), REDACTED);
  assert.equal(parsed.searchParams.get('safe'), '1');
  assert.equal(redactedUrl.includes('synthetic-'), false);
});

test('Xiaohongshu fresh evidence artifacts keep xsec redaction and omit unsafe headers', async () => {
  const inputUrl = 'https://www.xiaohongshu.com/explore/note123?xsec_token=synthetic-xsec&token=synthetic-token';
  const result = await resolveXiaohongshuFreshEvidence(inputUrl, {
    reuseLoginState: true,
    headless: true,
  }, {
    siteProfile: {
      authSession: {
        verificationUrl: 'https://www.xiaohongshu.com/explore',
      },
    },
    inspectRequestReusableSiteSession: async () => ({
      authAvailable: true,
      userDataDir: '/tmp/siteforge-test-xiaohongshu-profile',
    }),
    fetchImpl: async () => {
      throw new Error('force browser fallback');
    },
    openBrowserSession: async () => ({
      browserAttachedVia: 'test',
      reusedBrowserInstance: false,
      navigateAndWait: async () => {},
      callPageFunction: async () => ({
        finalUrl: inputUrl,
        title: 'Fresh note',
        pageType: 'book-detail-page',
        pageFacts: {
          noteId: 'note123',
          contentTitle: 'Fresh note',
          contentImages: [{
            assetId: 'asset-1',
            url: 'https://sns-img.example.invalid/a.jpg',
            sourceUrls: [
              'https://www.xiaohongshu.com/explore/note123?xsec_token=synthetic-source-xsec',
            ],
          }],
        },
      }),
      getPageMetadata: async () => ({
        finalUrl: inputUrl,
        title: 'Fresh note',
      }),
      evaluateValue: async (expression) => {
        if (expression === 'navigator.userAgent') {
          return 'Mozilla/5.0';
        }
        if (expression.includes('navigator.languages')) {
          return 'zh-CN';
        }
        return 'https://www.xiaohongshu.com/explore/note123?xsec_token=synthetic-referrer-xsec';
      },
      close: async () => {},
    }),
  });

  const artifactText = JSON.stringify(result);
  assert.equal(result.status, 'resource-seeds-provided');
  assert.equal(artifactText.includes('synthetic-'), false);
  assert.equal(artifactText.includes('"Cookie"'), false);
  assert.equal(artifactText.includes('"Authorization"'), false);
  assert.equal(artifactText.includes('x-csrf-token'), false);
  assert.equal(result.inputUrl.includes('xsec_token=%5BREDACTED%5D'), true);
  assert.equal(result.inputUrl.includes('token=%5BREDACTED%5D'), true);
  assert.deepEqual(result.headerFreshness.headerNames, [
    'Accept-Language',
    'Origin',
    'Referer',
    'User-Agent',
  ]);
});
