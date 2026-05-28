import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertCapabilityIntentHtmlSafe,
  renderCapabilityIntentSummaryHtml,
} from '../../src/app/pipeline/build/capability-intent-html-render.mjs';

test('capability intent HTML render escapes markup and redacts sensitive values', () => {
  const html = renderCapabilityIntentSummaryHtml({
    meta: {
      title: 'SiteForge Build Summary',
      siteUrl: 'https://fixture.local/?token=synthetic-secret',
      siteId: 'fixture.local-25369277',
      buildId: 'escape-build',
      skillId: 'simple-shop',
      crawlMode: 'public_only',
      authMethod: 'none',
      authVerificationStatus: 'not_requested',
      resultStatus: 'success',
      legacyStatus: 'success',
      verificationStatus: 'passed',
      generatedAt: '2026-05-21T10:00:00.000Z',
      completedAt: '2026-05-21T10:00:01.000Z',
    },
    coverage: {
      public: { pages: 1, nodes: 1, capabilities: 1 },
      authenticated: { pages: 0, nodes: 0, capabilities: 0 },
      overlay: { pagesRevisited: 0, newNodes: 0, newAffordances: 0 },
      browserBridge: {
        used: true,
        routeCount: 1,
        capturedRouteCount: 0,
        missingRouteCount: 1,
        routeResults: [{
          targetRoute: '/private?token=synthetic-secret',
          status: 'missing',
          finalStatus: 'missing',
          reasonCode: 'challenge',
        }],
      },
      requiresLoginButMissing: [],
      blockedByRisk: [],
      blockedByAuth: [],
    },
    counts: { capabilities: 1, intents: 1, nodes: 1, riskBlocked: 0 },
    capabilities: [{
      id: 'capability:test:escape',
      name: '<script>alert(1)</script>',
      userValue: 'A & B "quote" \'apostrophe\'',
      action: 'view',
      object: 'report',
      status: 'active',
      enabledStatus: 'enabled',
      evidenceStatus: 'verified',
      riskLevel: 'read_public_low',
      safetyLevel: 'read_only',
      authRequired: false,
      sourceLayer: 'public',
      activationDecision: 'active',
      reason: 'Authorization: Bearer synthetic-secret cookie=sessionid=synthetic-secret token=synthetic-secret /Users/example/profile raw html <html>',
      strategy: 'enabled',
      mappedIntentCount: 1,
      group: 'enabled',
      evidenceMatrix: {
        requiredEvidence: ['A & B', '"quote"', '\'apostrophe\''],
        observedEvidence: ['<script>alert(1)</script>'],
        missingEvidence: ['token=synthetic-secret'],
        activationDecision: 'active',
      },
    }],
    intents: [{
      id: 'intent:test:escape',
      capabilityId: 'capability:test:escape',
      capabilityName: '<script>alert(1)</script>',
      canonicalUtterance: 'A & B "quote" \'apostrophe\' <script>alert(1)</script>',
      callable: 'callable',
      safetyLevel: 'read_only',
      enabledStatus: 'enabled',
      utteranceExamples: ['A & B', '"quote"', '\'apostrophe\''],
      negativeExamples: ['Authorization: Bearer synthetic-secret'],
      reason: 'safe',
    }],
    mappings: [{
      capabilityName: '<script>alert(1)</script>',
      capabilityId: 'capability:test:escape',
      capabilityStatus: 'active',
      enabledStatus: 'enabled',
      intentCount: 1,
      canonicalUtterances: ['A & B "quote" \'apostrophe\' <script>alert(1)</script>'],
      callable: 1,
      nonCallable: 0,
      riskLevel: 'read_public_low',
      authVerificationStatus: 'not_requested',
    }],
    blocked: {
      disabledHighRisk: [],
      blockedByAuth: [],
      requiresLogin: [],
      missingEvidence: [],
      candidateOnly: [],
    },
  });

  assert.match(html, /<html lang="zh-CN">/u);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/u);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/u);
  assert.match(html, /A &amp; B/u);
  assert.doesNotMatch(html, /synthetic-secret/u);
  assert.doesNotMatch(html, /token=synthetic-secret/u);
  assert.match(html, /Browser Bridge Route Coverage/u);
});

test('capability intent HTML safety scan fails closed on forbidden material', () => {
  assert.doesNotThrow(() => assertCapabilityIntentHtmlSafe('<p>safe summary</p>'));

  let error = null;
  try {
    assertCapabilityIntentHtmlSafe('<script>alert(1)</script>');
  } catch (caught) {
    error = caught;
  }
  assert.match(error?.message, /forbidden pattern script-tag/u);
  assert.equal(error.code, 'capability-intent-html-report-unsafe');
  assert.equal(error.reasonCode, 'script-tag');
});
