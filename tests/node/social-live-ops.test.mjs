import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  buildTemplates,
  parseArgs as parseTemplateArgs,
} from '../../scripts/social-command-templates.mjs';
import {
  buildHealthPlan,
  parseArgs as parseHealthArgs,
} from '../../scripts/social-health-watch.mjs';
import {
  buildManifest as buildAuthRecoverManifest,
  buildRecoveryPlan,
  parseArgs as parseAuthRecoverArgs,
} from '../../scripts/social-auth-recover.mjs';
import {
  prepareSocialManifestJsonWithAudit,
} from '../../tools/social-redaction.mjs';
import { REDACTION_PLACEHOLDER } from '../../src/domain/sessions/security-guard.mjs';
import {
  buildReport,
  parseArgs as parseReportArgs,
  writeReport,
} from '../../scripts/social-live-report.mjs';
import {
  buildResumePlan,
  parseArgs as parseResumeArgs,
} from '../../scripts/social-live-resume.mjs';
import { SOCIAL_OPERATOR_SCRIPT_STATUS } from '../../scripts/social-script-status.mjs';
import { buildRecoveryRunbook } from '../../src/sites/known-sites/social/actions/router.mjs';
import { safePlanForArtifact } from '../../src/sites/known-sites/social/actions/artifacts.mjs';

test('social operator scripts are classified as internal-only maintained scripts', async () => {
  const scriptDir = path.resolve('scripts');
  const entries = await readdir(scriptDir);
  const socialScripts = entries
    .filter((entry) => /^social-[\w-]+\.mjs$/u.test(entry) && entry !== 'social-script-status.mjs')
    .map((entry) => `scripts/${entry}`)
    .sort();

  assert.deepEqual(Object.keys(SOCIAL_OPERATOR_SCRIPT_STATUS).sort(), socialScripts);
  for (const [script, status] of Object.entries(SOCIAL_OPERATOR_SCRIPT_STATUS)) {
    assert.equal(status.visibility, 'internal-operator-only', script);
    assert.match(status.status, /^(active-tested|stale|archived|removed)$/u, script);
  }
  assert.equal(SOCIAL_OPERATOR_SCRIPT_STATUS['scripts/social-live-verify.mjs'].downloadBoundary, 'blocked-report-only');
});

test('social recovery runbook does not suggest media resume when download layer is blocked', () => {
  const runbook = buildRecoveryRunbook({
    siteKey: 'x',
    plan: {
      siteKey: 'x',
      action: 'profile-content',
      account: 'openai',
      contentType: 'media',
    },
    settings: {
      downloadMedia: true,
      maxItems: 10,
      timeoutMs: 30_000,
    },
    download: {
      blocked: true,
      supported: false,
      status: 'blocked',
      reason: 'download-layer-removed',
    },
    outcome: {
      reason: 'media-download-incomplete',
    },
    completeness: {
      download: {
        failedCount: 1,
        contentTypeMismatchCount: 0,
      },
    },
  }, {
    runDir: 'runs/social-action/x-media',
    manifestPath: 'runs/social-action/x-media/manifest.json',
    apiCapturePath: 'runs/social-action/x-media/api-capture.json',
    apiDriftSamplesPath: 'runs/social-action/x-media/api-drift.json',
  });

  assert.equal(runbook.commands.some((command) => command.id === 'resume-media-downloads'), false);
  assert.equal(runbook.commands.some((command) => command.command.includes('--download-media')), false);
});

test('social-command-templates emits unified X and Instagram commands', () => {
  const templates = buildTemplates(parseTemplateArgs([
    '--x-account',
    'openai',
    '--ig-account',
    'instagram',
    '--date',
    '2026-04-26',
  ]));

  assert.deepEqual(templates.sites.map((site) => site.site), ['x', 'instagram']);
  assert.match(templates.sites[0].productionCommands[0], /src\/entrypoints\/sites\/x-action\.mjs full-archive openai/u);
  assert.match(templates.sites[0].resumeCommand, /scripts\/social-live-resume\.mjs --site x/u);
  assert.match(templates.sites[1].kbWatchCommand, /scripts\/social-kb-refresh\.mjs --execute --site instagram --watch/u);
  for (const site of templates.sites) {
    assert.ok(site.dryRunCommands.every((command) => command.risk.includes('dry-run')));
    assert.ok(site.executeCommands.every((command) => command.risk.includes('execute')));
    assert.match(site.planJsonCommand, /scripts\/social-live-verify\.mjs --plan-json/u);
    assert.match(site.kbRefreshCommand, /scripts\/social-kb-refresh\.mjs --plan-only/u);
    assert.match(site.kbPlanJsonCommand, /scripts\/social-kb-refresh\.mjs --plan-json/u);
    assert.match(site.kbExecuteCommand, /scripts\/social-kb-refresh\.mjs --execute/u);
    for (const command of site.productionCommands) {
      assert.match(command, /--session-health-plan/u);
      assert.doesNotMatch(command, /--download-media/u);
    }
    assert.doesNotMatch(site.verifyCommand, /--max-media-downloads/u);
  }
});

test('social-health-watch dry-run plan includes session health, keepalive, auth doctor, and nextSuggestedKeepalive', () => {
  const now = new Date('2026-04-26T00:00:00.000Z');
  const plan = buildHealthPlan(parseHealthArgs(['--site', 'x', '--interval-minutes', '90']), now);

  assert.equal(plan.mode, 'dry-run');
  assert.equal(plan.nextSuggestedKeepalive, '2026-04-26T01:30:00.000Z');
  assert.equal(plan.sites.length, 1);
  assert.deepEqual(plan.sites[0].commands.map((command) => command.type), ['session-health', 'keepalive', 'auth-doctor']);
  assert.match(plan.sites[0].commands[0].commandLine, /src\/entrypoints\/sites\/session\.mjs health/u);
  assert.match(plan.sites[0].commands[1].commandLine, /src\/entrypoints\/sites\/site-keepalive\.mjs/u);
  assert.match(plan.sites[0].commands[2].commandLine, /src\/entrypoints\/sites\/site-doctor\.mjs/u);
  assert.match(plan.sites[0].commands[2].commandLine, /--session-manifest/u);
});

test('social auth recovery and health watch manifests redact path-bearing commands before persistence', () => {
  const rawProfileRoot = path.join(os.tmpdir(), 'bwk social profile root');
  const rawUserDataDir = path.join(rawProfileRoot, 'x.com');
  const rawRunRoot = path.join(os.tmpdir(), 'bwk social runs');
  const now = new Date('2026-04-26T00:00:00.000Z');

  const healthPlan = buildHealthPlan(parseHealthArgs([
    '--site', 'x',
    '--run-root', rawRunRoot,
    '--browser-profile-root', rawProfileRoot,
    '--user-data-dir', rawUserDataDir,
  ]), now);
  const healthPrepared = prepareSocialManifestJsonWithAudit(healthPlan);
  assert.equal(healthPrepared.json.includes(rawProfileRoot), false);
  assert.equal(healthPrepared.json.includes(rawUserDataDir), false);
  assert.equal(healthPrepared.json.includes(path.resolve('profiles', 'x.com.json')), false);
  assert.equal(healthPrepared.auditJson.includes(rawProfileRoot), false);

  const persistedHealth = JSON.parse(healthPrepared.json);
  assert.equal(persistedHealth.runDir, REDACTION_PLACEHOLDER);
  assert.equal(persistedHealth.sites[0].commands[1].args[1], 'https://x.com/home');
  assert.equal(persistedHealth.sites[0].commands[0].commandLine, REDACTION_PLACEHOLDER);
  assert.equal(persistedHealth.sites[0].commands[0].args.includes(REDACTION_PLACEHOLDER), true);

  const recoverOptions = parseAuthRecoverArgs([
    '--site', 'x',
    '--manual',
    '--verify',
    '--run-root', rawRunRoot,
    '--browser-profile-root', rawProfileRoot,
    '--user-data-dir', rawUserDataDir,
  ]);
  const recoveryPlan = buildRecoveryPlan(recoverOptions, '20260426T000000000Z');
  const recoveryManifest = buildAuthRecoverManifest(
    recoveryPlan,
    recoverOptions,
    path.join(recoveryPlan.runDir, 'manifest.json'),
  );
  const recoveryPrepared = prepareSocialManifestJsonWithAudit(recoveryManifest);
  assert.equal(recoveryPrepared.json.includes(rawProfileRoot), false);
  assert.equal(recoveryPrepared.json.includes(rawUserDataDir), false);
  assert.equal(recoveryPrepared.json.includes(path.resolve('profiles', 'x.com.json')), false);

  const persistedRecovery = JSON.parse(recoveryPrepared.json);
  assert.equal(persistedRecovery.repoRoot, REDACTION_PLACEHOLDER);
  assert.equal(persistedRecovery.runDir, REDACTION_PLACEHOLDER);
  assert.equal(persistedRecovery.sites[0].url, 'https://x.com/home');
  assert.equal(persistedRecovery.sites[0].profilePath, REDACTION_PLACEHOLDER);
  assert.equal(persistedRecovery.sites[0].commands.manualLogin.command, REDACTION_PLACEHOLDER);
  assert.equal(persistedRecovery.sites[0].commands.manualLogin.commandArray.includes(REDACTION_PLACEHOLDER), true);
});

test('social-live-report aggregates latest X and Instagram manifests and writes JSON/Markdown', async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'bwk-social-report-'));
  t.after(() => rm(rootDir, { recursive: true, force: true }));

  const runDir = path.join(rootDir, 'run-1');
  await mkdir(runDir, { recursive: true });
  await writeFile(path.join(runDir, 'manifest.json'), `${JSON.stringify({
    runId: 'run-1',
    status: 'blocked',
    results: [
      { id: 'x-full-archive', site: 'x', status: 'failed', artifactSummary: { verdict: 'blocked', reason: 'rate-limited', manifestPath: path.join(runDir, 'x', 'manifest.json') }, finishedAt: '2026-04-26T00:00:00.000Z' },
      { id: 'instagram-full-archive', site: 'instagram', status: 'passed', artifactSummary: { verdict: 'passed', reason: 'max-items', manifestPath: path.join(runDir, 'ig', 'manifest.json') }, finishedAt: '2026-04-26T00:01:00.000Z' },
    ],
  }, null, 2)}\n`, 'utf8');

  const outDir = path.join(rootDir, 'report');
  const report = await buildReport(parseReportArgs(['--runs-root', rootDir, '--out-dir', outDir]));
  const outputs = await writeReport(parseReportArgs(['--runs-root', rootDir, '--out-dir', outDir]), report);
  const markdown = await readFile(outputs.markdownPath, 'utf8');

  assert.equal(report.totalRows, 2);
  assert.equal(report.summary.x.statuses.blocked, 1);
  assert.equal(report.summary.instagram.statuses.passed, 1);
  assert.match(markdown, /x-full-archive/u);
});

test('social-live-report reclassifies known X unlabeled controls from safe test ids', async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'bwk-social-report-controls-'));
  t.after(() => rm(rootDir, { recursive: true, force: true }));

  const runDir = path.join(rootDir, 'x-controls');
  await mkdir(runDir, { recursive: true });
  await writeFile(path.join(runDir, 'manifest.json'), `${JSON.stringify({
    runId: 'x-controls',
    siteKey: 'x',
    generatedAt: '2026-04-26T00:00:00.000Z',
    plan: {
      siteKey: 'x',
      action: 'profile-content',
      contentType: 'posts',
      account: 'openai',
      routePath: null,
      routeName: null,
      url: 'https://x.com/openai',
    },
    outcome: { ok: true, status: 'passed', reason: null },
    surfaceInventory: {
      urlRouteTemplate: '/:account',
      controls: [
        { role: 'button', testId: 'usercell', descendantTestId: 'useravatar-container-openai', count: 1 },
        { role: 'button', testId: 'app-bar-close', count: 1 },
        { role: 'button', descendantTestId: 'pillLabel', count: 1 },
        { role: 'button', testId: 'contentdisclosurebutton', count: 1 },
        { role: 'button', testId: 'createpollbutton', count: 1 },
        { role: 'button', testId: 'gifsearchbutton', count: 1 },
        { role: 'button', testId: 'geobutton', count: 1 },
        { role: 'button', testId: 'grokimggen', count: 1 },
        { role: 'button', testId: 'scheduleoption', count: 1 },
        { role: 'button', labelKind: 'skip', count: 1 },
        { role: 'button', labelKind: 'translation', count: 1 },
        { role: 'button', ancestorTestId: 'tweet', iconSignature: '0-0-24-24-1-199-mllvhvllzmlchcvh', count: 1 },
        { role: 'button', ancestorTestId: 'primaryColumn', iconSignature: '0-0-24-24-1-253-mvhvhvhvhvhvhzmh', count: 1 },
        { role: 'button', ancestorTestId: 'primaryColumn', iconSignature: '0-0-24-24-1-296-mcszmllvlcllllzm', count: 1 },
        { role: 'button', ancestorTestId: 'primaryColumn', iconSignature: '0-0-24-24-1-999-mhlclclvlclclhlc', count: 1 },
        { role: 'button', disabled: true, count: 1 },
        {
          role: 'button',
          functionKind: 'content.news-story-card',
          intent: 'inspect_news_story_card',
          executionClass: 'read-navigation-probe',
          mutationRisk: 'none',
          count: 1,
        },
      ],
    },
  }, null, 2)}\n`, 'utf8');

  const report = await buildReport(parseReportArgs([
    '--runs-root',
    rootDir,
    '--site',
    'x',
    '--no-write',
  ]));

  const kinds = report.coverage.x.inventory.functionKinds;
  for (const kind of [
    'navigation.profile',
    'navigation.close',
    'navigation.tab',
    'compose.content-disclosure',
    'compose.poll',
    'compose.gif',
    'compose.location',
    'compose.grok-image',
    'compose.schedule',
    'compose.reply-permissions',
    'content.translation-info',
    'content.translation-toggle',
    'share.menu',
    'account.notifications-toggle',
    'navigation.skip',
    'interactive.disabled-control',
    'content.news-story-card',
  ]) {
    assert.equal(kinds.includes(kind), true, kind);
  }
  assert.equal(report.coverage.x.inventory.functionKinds.includes('interactive.unclassified-control'), false);
  assert.equal(report.coverage.x.inventory.unknownRiskBlockedFunctionCount, 0);
});

test('social-live-report classifies live smoke rows from artifact verdicts, not exit status alone', async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'bwk-social-report-artifacts-'));
  t.after(() => rm(rootDir, { recursive: true, force: true }));

  const runDir = path.join(rootDir, 'run-1');
  await mkdir(runDir, { recursive: true });
  await writeFile(path.join(runDir, 'manifest.json'), `${JSON.stringify({
    runId: 'run-1',
    status: 'failed',
    results: [
      { id: 'x-auth-doctor', site: 'x', status: 'failed', artifactSummary: { verdict: 'blocked', reason: 'rate-limited' }, finishedAt: '2026-04-26T00:00:00.000Z' },
      { id: 'x-full-archive', site: 'x', status: 'passed', artifactSummary: { verdict: 'failed', reason: 'archive-incomplete' }, finishedAt: '2026-04-26T00:01:00.000Z' },
      { id: 'x-search', site: 'x', status: 'failed', artifactSummary: { verdict: 'blocked-risk', reason: 'rate-limited' }, finishedAt: '2026-04-26T00:01:30.000Z' },
      { id: 'instagram-full-archive', site: 'instagram', status: 'failed', artifactSummary: { verdict: 'skipped', reason: 'not-logged-in' }, finishedAt: '2026-04-26T00:02:00.000Z' },
      { id: 'instagram-media-download-blocked-boundary', site: 'instagram', status: 'passed', artifactSummary: { verdict: 'passed', reason: null }, finishedAt: '2026-04-26T00:03:00.000Z' },
      { id: 'instagram-kb-refresh', site: 'instagram', status: 'passed', artifactSummary: { verdict: 'unexpected-live-status', reason: 'drift' }, finishedAt: '2026-04-26T00:04:00.000Z' },
    ],
  }, null, 2)}\n`, 'utf8');

  const options = parseReportArgs(['--runs-root', rootDir, '--no-write']);
  const report = await buildReport(options);

  assert.deepEqual(report.rows.map((row) => [row.id, row.status]), [
    ['x-auth-doctor', 'blocked'],
    ['x-full-archive', 'failed'],
    ['x-search', 'blocked'],
    ['instagram-full-archive', 'skipped'],
    ['instagram-media-download-blocked-boundary', 'passed'],
    ['instagram-kb-refresh', 'unknown'],
  ]);
  assert.equal(report.summary.x.statuses.blocked, 2);
  assert.equal(report.summary.x.statuses.failed, 1);
  assert.equal(report.summary.instagram.statuses.skipped, 1);
  assert.equal(report.summary.instagram.statuses.passed, 1);
  assert.equal(report.summary.instagram.statuses.unknown, 1);
});

test('social-live-report summarizes X surface API coverage beyond row limit without private query values', async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'bwk-social-report-coverage-'));
  t.after(() => rm(rootDir, { recursive: true, force: true }));

  async function writeManifest(dirName, manifest) {
    const runDir = path.join(rootDir, dirName);
    await mkdir(runDir, { recursive: true });
    await writeFile(path.join(runDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  }

  await writeManifest('x-account-info', {
    siteKey: 'x',
    generatedAt: '2026-04-26T00:00:00.000Z',
    plan: {
      action: 'account-info',
      account: 'private-account-handle',
      contentType: 'posts',
    },
    outcome: { ok: true, status: 'passed', reason: null },
    completeness: {
      apiPages: 0,
      dedupedItemCount: 0,
      userCount: 0,
      mediaCount: 0,
    },
    surfaceInventory: {
      urlRouteTemplate: '/private-account-handle',
      linkCount: 3,
      controlCount: 6,
      formCount: 1,
      linkRoutes: [
        { kind: 'profile', routeTemplate: '/private-account-handle', count: 1 },
        { kind: 'search', routeTemplate: '/search?q=private search query&src=typed_query&f=live', count: 2 },
      ],
      controls: [
        { role: 'button', testId: 'tweetButtonInline', count: 1 },
        { role: 'button', labelKind: 'post', count: 1 },
        { role: 'button', labelKey: 'private-search-query', count: 1 },
        { role: 'button', testId: 'auth_token', count: 1 },
        { role: 'div', testId: 'useravatar-container-privatehandle', count: 1 },
        { role: 'button', testId: '123456-follow', count: 1 },
      ],
      forms: [
        { role: 'search', inputCount: 1, buttonCount: 1, actionRouteTemplate: '/search?q=private search query' },
      ],
    },
    controlProbe: {
      requested: true,
      candidateCount: 4,
      selectedCount: 2,
      executedCount: 2,
      skippedCount: 0,
      failedCount: 0,
      mutationBlockedCount: 3,
      api: {
        responseCount: 2,
        operations: ['SearchTimeline', 'p2', 'SmartTagAttachmentQuery', 'usePremiumPaywallOnLoadMutation', 'update_subscriptions'],
      },
      mutationBlockedFunctions: [
        {
          functionKind: 'compose.post',
          intent: 'create_post',
          executionClass: 'mutation-blocked',
          mutationRisk: 'content-write',
          count: 1,
        },
        {
          functionKind: 'relation.follow-toggle',
          intent: 'mutate_follow_state',
          executionClass: 'mutation-blocked',
          mutationRisk: 'relationship-write',
          count: 1,
        },
      ],
      probes: [
        {
          status: 'passed',
          action: 'focus',
          functionKind: 'search.input-or-filter',
          intent: 'refine_search_results',
          executionClass: 'read-search-probe',
          mutationRisk: 'none',
          controlKey: 'searchbox_search_input',
        },
        {
          status: 'passed',
          action: 'click',
          functionKind: 'navigation.tab',
          intent: 'switch_read_surface',
          executionClass: 'read-tab-probe',
          mutationRisk: 'none',
          routeTemplate: '/private-account-handle/media',
          changedRoute: true,
        },
      ],
    },
    readCrawl: {
      requested: true,
      maxPages: 4,
      maxDepth: 1,
      visitedCount: 2,
      queuedCount: 3,
      pendingQueueCount: 1,
      exhausted: false,
      discoveredRouteTemplates: [
        '/private-account-handle',
        '/private-account-handle/media',
        '/search?q=private search query&src=typed_query&f=live',
        '/settings/account',
        '/i/premium_sign_up',
      ],
      functionKinds: [
        'navigation.profile',
        'navigation.profile-tab',
        'search.results',
      ],
      executionClasses: [
        'read-navigation-probe',
        'read-tab-probe',
        'read-search-probe',
      ],
      blockedRouteCount: 2,
      blockedFunctions: [
        {
          routeTemplate: '/settings/account',
          functionKind: 'account.settings',
          intent: 'inspect_account_settings',
          executionClass: 'side-effect-risk-blocked',
          mutationRisk: 'account-write-risk',
          count: 1,
        },
        {
          routeTemplate: '/i/premium_sign_up',
          functionKind: 'commerce.premium-signup',
          intent: 'inspect_premium_signup',
          executionClass: 'side-effect-risk-blocked',
          mutationRisk: 'purchase-risk',
          count: 1,
        },
      ],
      api: {
        responseCount: 3,
        operations: ['HomeTimeline', 'SearchTimeline', 'FetchDraftTweets', 'PutClientEducationFlag', 'update_subscriptions', 'log.json', 'AuthenticatePeriscope'],
      },
      pages: [
        {
          depth: 0,
          routeTemplate: '/private-account-handle',
          routeSample: {
            routeTemplate: '/private-account-handle',
            pathDepth: 1,
            dynamicSegmentCount: 1,
            segmentShapes: [
              { kind: 'account', valueLength: 22, valueClass: 'handle-like' },
            ],
            queryKeys: [],
            queryValueShapes: [],
          },
          status: 'passed',
          linkCount: 8,
          controlCount: 5,
          candidateCount: 5,
          readCandidateCount: 3,
          blockedCandidateCount: 2,
          readRouteTemplates: [
            '/private-account-handle/media',
            '/search?q=private search query&src=typed_query&f=live',
          ],
          readRouteSamples: [
            {
              routeTemplate: '/search?q=private search query&src=typed_query&f=live',
              pathDepth: 1,
              dynamicSegmentCount: 0,
              segmentShapes: [
                { kind: 'static', value: 'search' },
              ],
              queryKeys: ['f', 'q', 'src'],
              queryValueShapes: [
                { key: 'f', valueLength: 4, tokenCount: 1, valueClass: 'handle-like' },
                { key: 'q', valueLength: 20, tokenCount: 3, valueClass: 'mixed' },
                { key: 'src', valueLength: 11, tokenCount: 1, valueClass: 'handle-like' },
              ],
            },
          ],
          functionKinds: ['navigation.profile-tab', 'search.results'],
          executionClasses: ['read-tab-probe', 'read-search-probe'],
        },
        {
          depth: 1,
          requestedRouteTemplate: '/private-account-handle/status/1234567890',
          routeTemplate: '/private-account-handle/media',
          status: 'degraded',
          reason: 'x-blank-shell',
          sourceRouteTemplate: '/private-account-handle',
          linkCount: 2,
          controlCount: 1,
          candidateCount: 1,
          readCandidateCount: 1,
          blockedCandidateCount: 0,
          readRouteTemplates: ['/private-account-handle/status/1234567890'],
          readRouteSamples: [
            {
              routeTemplate: '/private-account-handle/status/1234567890',
              pathDepth: 3,
              dynamicSegmentCount: 2,
              segmentShapes: [
                { kind: 'account', valueLength: 22, valueClass: 'handle-like' },
                { kind: 'static', value: 'status' },
                { kind: 'id', valueLength: 10, valueClass: 'digits' },
              ],
              queryKeys: [],
              queryValueShapes: [],
            },
          ],
          functionKinds: ['navigation.content-detail'],
          executionClasses: ['read-navigation-probe'],
        },
      ],
    },
  });
  await writeManifest('x-profile-posts', {
    siteKey: 'x',
    generatedAt: '2026-04-26T00:01:00.000Z',
    plan: {
      action: 'profile-content',
      account: 'private-account-handle',
      contentType: 'posts',
      query: 'private search query',
    },
    outcome: { ok: true, status: 'bounded', reason: 'max-items' },
    completeness: {
      apiPages: 1,
      dedupedItemCount: 2,
      userCount: 0,
      mediaCount: 1,
    },
    archive: {
      capture: {
        requestCount: 4,
        responseCount: 2,
        parsedResponseCount: 1,
        operations: ['UserTweets', 'badge_count.json', 'ProfileSpotlightsQuery', 'SidebarUserRecommendations', 'QuickPromoteEligibility'],
        samples: [
          { operationName: 'UserTweets', itemCount: 2, userCount: 0, hasNextCursor: true },
        ],
      },
    },
  });

  const report = await buildReport(parseReportArgs([
    '--runs-root',
    rootDir,
    '--site',
    'x',
    '--limit',
    '1',
    '--no-write',
  ]));

  assert.equal(report.totalRows, 1);
  assert.equal(['bounded', 'passed'].includes(report.rows[0].status), true);
  assert.equal(report.coverage.x.plannedSurfaceCount, 117);
  assert.equal(report.coverage.x.coveredPlannedSurfaceCount, 2);
  assert.equal(report.coverage.x.missingExpectedSurfaces.includes('profile-followers'), true);
  assert.equal(report.coverage.x.boundedOrPassed, 2);
  assert.equal(report.coverage.x.degradedBlockedOrIncomplete, 0);
  assert.equal(report.coverage.x.surfacesWithApiPages, 1);
  assert.equal(report.coverage.x.surfacesWithApiResponses, 1);
  assert.equal(report.coverage.x.surfacesWithTargetOperations, 1);
  assert.equal(report.coverage.x.surfacesWithInventory, 1);
  assert.deepEqual(report.coverage.x.surfacesWithoutInventory, ['profile-content:posts']);
  assert.equal(report.coverage.x.surfacesWithControlProbe, 1);
  assert.equal(report.coverage.x.totalItems, 2);
  assert.equal(report.coverage.x.totalMedia, 1);
  assert.deepEqual(report.coverage.x.routeTemplates, ['/:account']);
  assert.deepEqual(report.coverage.x.capabilities, ['profile.identity.read', 'timeline.posts.archive']);
  assert.deepEqual(report.coverage.x.intents, ['inspect_account_profile', 'archive_profile_posts']);
  assert.equal(report.coverage.x.dynamicSeedCoverage.scope, 'executed-dynamic-seed-instances');
  assert.equal(report.coverage.x.dynamicSeedCoverage.seedRunCount, 2);
  assert.equal(report.coverage.x.dynamicSeedCoverage.familyCount, 1);
  assert.equal(report.coverage.x.dynamicSeedCoverage.routeTemplateCount, 1);
  assert.equal(report.coverage.x.dynamicSeedCoverage.surfaceCount, 2);
  assert.deepEqual(report.coverage.x.dynamicSeedCoverage.routeTemplates, ['/:account']);
  assert.deepEqual(report.coverage.x.dynamicSeedCoverage.statuses, [
    { value: 'bounded', count: 1 },
    { value: 'passed', count: 1 },
  ]);
  assert.deepEqual(
    report.coverage.x.dynamicSeedCoverage.families.map((entry) => [
      entry.familyKind,
      entry.seedRunCount,
      entry.surfaceCount,
      entry.routeTemplateCount,
    ]),
    [
      ['account-dynamic-route', 2, 2, 1],
    ],
  );
  assert.equal(report.coverage.x.discovery.plannedCapabilityCount, 2);
  assert.equal(report.coverage.x.discovery.discoveredFunctionKindCount >= 9, true);
  assert.equal(report.coverage.x.discovery.discoveredIntentCount >= 10, true);
  assert.equal(report.coverage.x.discovery.readExecutableFunctionKinds.includes('navigation.profile-tab'), true);
  assert.equal(report.coverage.x.discovery.readExecutableFunctionKinds.includes('search.results'), true);
  assert.equal(report.coverage.x.discovery.dynamicRouteFamilyCount, 2);
  assert.equal(report.coverage.x.discovery.dynamicRouteFamilyRouteTemplateCount, 2);
  assert.equal(report.coverage.x.discovery.dynamicRouteParameterizedFamilyCount, 2);
  assert.equal(report.coverage.x.discovery.dynamicRouteParameterizedTemplateCount, 2);
  assert.equal(report.coverage.x.discovery.dynamicRouteSampleCount, 1);
  assert.equal(report.coverage.x.discovery.dynamicRouteSamplelessTemplateCount, 1);
  assert.equal(report.coverage.x.discovery.dynamicRouteFamilyIntents.includes('inspect_dynamic_status_route'), true);
  assert.equal(report.coverage.x.discovery.discoveredIntents.includes('inspect_dynamic_status_route'), true);
  assert.equal(report.coverage.x.discovery.blockedFunctionKinds.includes('compose.post'), true);
  assert.equal(report.coverage.x.discovery.blockedFunctionKinds.includes('account.settings'), true);
  assert.equal(report.coverage.x.discovery.blockedFunctionKinds.includes('commerce.premium-signup'), true);
  assert.equal(report.coverage.x.discovery.observedApiOperationCount, 15);
  assert.deepEqual(report.coverage.x.discovery.observedApiOperations, [
    'SearchTimeline',
    'p2',
    'SmartTagAttachmentQuery',
    'usePremiumPaywallOnLoadMutation',
    'update_subscriptions',
    'HomeTimeline',
    'FetchDraftTweets',
    'PutClientEducationFlag',
    'log.json',
    'AuthenticatePeriscope',
    'UserTweets',
    'badge_count.json',
    'ProfileSpotlightsQuery',
    'SidebarUserRecommendations',
    'QuickPromoteEligibility',
  ]);
  assert.equal(report.coverage.x.discovery.targetApiOperationCount, 3);
  assert.deepEqual(report.coverage.x.discovery.targetApiOperations, ['UserTweets', 'ProfileSpotlightsQuery', 'SidebarUserRecommendations']);
  assert.equal(report.coverage.x.discovery.observedNonTargetApiOperationCount, 12);
  assert.deepEqual(report.coverage.x.discovery.observedNonTargetApiOperations, [
    'SearchTimeline',
    'p2',
    'SmartTagAttachmentQuery',
    'usePremiumPaywallOnLoadMutation',
    'update_subscriptions',
    'HomeTimeline',
    'FetchDraftTweets',
    'PutClientEducationFlag',
    'log.json',
    'AuthenticatePeriscope',
    'badge_count.json',
    'QuickPromoteEligibility',
  ]);
  assert.deepEqual(report.coverage.x.discovery.observedApiOperationClassCounts, [
    { operationClass: 'auth-replay-blocked', count: 1 },
    { operationClass: 'commerce-support-read', count: 1 },
    { operationClass: 'content-write-risk', count: 1 },
    { operationClass: 'side-effect-risk', count: 3 },
    { operationClass: 'support-read', count: 5 },
    { operationClass: 'target-functional', count: 3 },
    { operationClass: 'telemetry-or-ad', count: 1 },
  ]);
  assert.deepEqual(report.coverage.x.discovery.supportReadApiOperations, ['SearchTimeline', 'p2', 'SmartTagAttachmentQuery', 'HomeTimeline', 'badge_count.json']);
  assert.deepEqual(report.coverage.x.discovery.unclassifiedObservedApiOperations, []);
  assert.equal(report.coverage.x.discovery.coverageExpansionCandidateCount, 1);
  assert.deepEqual(report.coverage.x.discovery.coverageExpansionCandidateOperationClasses, [
    { operationClass: 'support-read', count: 1 },
  ]);
  assert.deepEqual(
    report.coverage.x.discovery.coverageExpansionCandidates.map((entry) => [
      entry.operation,
      entry.candidateCapability,
      entry.candidateIntent,
      entry.evidenceSurfaces,
    ]),
    [
      ['badge_count.json', 'notifications.badge.inspect', 'inspect_notification_badge_counts', ['profile-content:posts']],
    ],
  );
  assert.deepEqual(report.coverage.x.discovery.apiReadReplayEligibleOperations, ['HomeTimeline', 'SearchTimeline']);
  assert.deepEqual(report.coverage.x.discovery.apiReplayBlockedOperations, ['AuthenticatePeriscope', 'FetchDraftTweets', 'log.json', 'PutClientEducationFlag', 'update_subscriptions']);
  assert.deepEqual(report.coverage.x.targetOperations, ['UserTweets', 'ProfileSpotlightsQuery', 'SidebarUserRecommendations']);
  assert.deepEqual(report.coverage.x.uniqueOperations, [
    'SearchTimeline',
    'p2',
    'SmartTagAttachmentQuery',
    'usePremiumPaywallOnLoadMutation',
    'update_subscriptions',
    'HomeTimeline',
    'FetchDraftTweets',
    'PutClientEducationFlag',
    'log.json',
    'AuthenticatePeriscope',
    'UserTweets',
    'badge_count.json',
    'ProfileSpotlightsQuery',
    'SidebarUserRecommendations',
    'QuickPromoteEligibility',
  ]);
  assert.equal(report.coverage.x.inventory.totalLinks, 3);
  assert.equal(report.coverage.x.inventory.totalControls, 6);
  assert.equal(report.coverage.x.inventory.totalForms, 1);
  assert.deepEqual(report.coverage.x.inventory.routeTemplates, ['/search?q=:query&src=:src&f=:filter', '/:account']);
  assert.equal(report.coverage.x.inventory.controlKeys.includes('tweetbuttoninline'), true);
  assert.equal(report.coverage.x.inventory.controlKeys.includes('post'), true);
  assert.equal(report.coverage.x.inventory.controlKeys.includes('useravatar-container-:account'), true);
  assert.equal(report.coverage.x.inventory.controlKeys.includes(':id-follow'), true);
  assert.equal(report.coverage.x.inventory.functionKinds.includes('compose.post'), true);
  assert.equal(report.coverage.x.inventory.functionKinds.includes('relation.follow-toggle'), true);
  assert.equal(report.coverage.x.inventory.executionClasses.includes('mutation-blocked'), true);
  assert.equal(report.coverage.x.inventory.mutationBlockedFunctionCount >= 2, true);
  assert.equal(report.coverage.x.controlProbe.surfaceCount, 1);
  assert.equal(report.coverage.x.controlProbe.executedCount, 2);
  assert.equal(report.coverage.x.controlProbe.failedCount, 0);
  assert.equal(report.coverage.x.controlProbe.mutationBlockedCount, 3);
  assert.deepEqual(report.coverage.x.controlProbe.apiOperations, ['SearchTimeline', 'p2', 'SmartTagAttachmentQuery', 'usePremiumPaywallOnLoadMutation', 'update_subscriptions']);
  assert.deepEqual(report.coverage.x.controlProbe.apiReadLikeOperations, ['SearchTimeline', 'p2', 'SmartTagAttachmentQuery']);
  assert.deepEqual(report.coverage.x.controlProbe.apiSideEffectRiskOperations, ['usePremiumPaywallOnLoadMutation', 'update_subscriptions']);
  assert.equal(report.coverage.x.controlProbe.functionKinds.includes('search.input-or-filter'), true);
  assert.equal(report.coverage.x.controlProbe.functionKinds.includes('navigation.tab'), true);
  assert.equal(report.coverage.x.surfacesWithReadCrawl, 1);
  assert.equal(report.coverage.x.readCrawl.surfaceCount, 1);
  assert.equal(report.coverage.x.readCrawl.visitedCount, 2);
  assert.equal(report.coverage.x.readCrawl.queuedCount, 3);
  assert.equal(report.coverage.x.readCrawl.discoveredRouteTemplates.includes('/:account/media'), true);
  assert.equal(report.coverage.x.readCrawl.discoveredRouteTemplates.includes('/search?q=:query&src=:src&f=:filter'), true);
  assert.equal(report.coverage.x.readCrawl.discoveredRouteTemplates.includes('/settings/account'), true);
  assert.equal(report.coverage.x.readCrawl.discoveredRouteTemplates.includes('/i/premium_sign_up'), true);
  assert.equal(report.coverage.x.readCrawl.functionKinds.includes('navigation.profile-tab'), true);
  assert.equal(report.coverage.x.readCrawl.functionKinds.includes('account.settings'), true);
  assert.equal(report.coverage.x.readCrawl.executionClasses.includes('side-effect-risk-blocked'), true);
  assert.equal(report.coverage.x.readCrawl.blockedRouteCount, 2);
  assert.deepEqual(report.coverage.x.readCrawl.apiReadLikeOperations, ['HomeTimeline', 'SearchTimeline']);
  assert.deepEqual(report.coverage.x.readCrawl.apiSideEffectRiskOperations, ['FetchDraftTweets', 'PutClientEducationFlag', 'update_subscriptions', 'log.json', 'AuthenticatePeriscope']);
  assert.equal(report.coverage.x.readCrawl.apiOperationRiskSummary.total, 7);
  assert.equal(report.coverage.x.readCrawl.apiOperationRiskSummary.readLikeCount, 2);
  assert.equal(report.coverage.x.readCrawl.apiOperationRiskSummary.replayBlockedCount, 5);
  assert.equal(report.coverage.x.readCrawl.apiOperationRiskSummary.sideEffectRiskCount, 5);
  assert.deepEqual(
    report.coverage.x.readCrawl.apiOperationRisk
      .filter((entry) => entry.replayDisposition === 'replay-blocked')
      .map((entry) => [entry.operation, entry.riskClass]),
    [
      ['AuthenticatePeriscope', 'auth-session-risk'],
      ['FetchDraftTweets', 'content-write-risk'],
      ['log.json', 'telemetry-write-risk'],
      ['PutClientEducationFlag', 'side-effect-risk'],
      ['update_subscriptions', 'side-effect-risk'],
    ],
  );
  assert.equal(report.coverage.x.readCrawl.routeTemplateReplaySummary.total, 6);
  assert.equal(report.coverage.x.readCrawl.routeTemplateReplaySummary.visitedRouteTemplateCount, 2);
  assert.equal(report.coverage.x.readCrawl.routeTemplateReplaySummary.redirectedRouteTemplateCount, 1);
  assert.equal(report.coverage.x.readCrawl.routeTemplateReplaySummary.candidateOnlyRouteTemplateCount, 1);
  assert.equal(report.coverage.x.readCrawl.routeTemplateReplaySummary.blockedRouteTemplateCount, 2);
  assert.equal(report.coverage.x.readCrawl.routeTemplateReplaySummary.allExhausted, false);
  assert.equal(report.coverage.x.readCrawl.closure.scope, 'planned-surface-read-crawl');
  assert.equal(report.coverage.x.readCrawl.closure.fullSiteExhaustiveClaim, false);
  assert.equal(report.coverage.x.readCrawl.closure.controlledScopeClosureReady, false);
  assert.equal(report.coverage.x.readCrawl.closure.readCrawlSurfaceCount, 1);
  assert.equal(report.coverage.x.readCrawl.closure.surfacesWithRequestedRouteTemplateEvidence, 1);
  assert.equal(report.coverage.x.readCrawl.closure.allReadCrawlSurfacesHaveRequestedRouteTemplateEvidence, true);
  assert.deepEqual(report.coverage.x.readCrawl.closure.surfacesWithPendingReadQueue, ['account-info']);
  assert.equal(report.coverage.x.readCrawl.closure.unresolvedCandidateOnlyRouteCount, 1);
  assert.deepEqual(report.coverage.x.readCrawl.closure.unresolvedCandidateOnlyRoutes, ['/search?q=:query&src=:src&f=:filter']);
  assert.equal(report.coverage.x.readCrawl.closure.blockedRiskRoutesClassified, true);
  assert.deepEqual(
    report.coverage.x.readCrawl.closure.blockedRiskRoutes
      .map((entry) => [entry.routeTemplate, entry.functionKinds, entry.mutationRisks])
      .sort((left, right) => left[0].localeCompare(right[0])),
    [
      ['/i/premium_sign_up', ['commerce.premium-signup'], ['purchase-risk']],
      ['/settings/account', ['account.settings'], ['account-write-risk']],
    ],
  );
  assert.equal(report.coverage.x.readCrawl.closure.apiOperationCount, 7);
  assert.equal(report.coverage.x.readCrawl.closure.apiReplayBlockedCount, 5);
  assert.equal(report.coverage.x.readCrawl.closure.apiReplayRiskClassified, true);
  assert.equal(report.coverage.x.fullSiteBoundary.scope, 'controlled-plan-vs-open-site');
  assert.equal(report.coverage.x.fullSiteBoundary.fullSiteExhaustiveClaim, false);
  assert.equal(report.coverage.x.fullSiteBoundary.controlledScopeClosureReady, false);
  assert.equal(report.coverage.x.fullSiteBoundary.plannedSurfaceCount, 117);
  assert.equal(report.coverage.x.fullSiteBoundary.coveredPlannedSurfaceCount, 2);
  assert.equal(
    report.coverage.x.fullSiteBoundary.missingExpectedSurfaceCount,
    report.coverage.x.plannedSurfaceCount - report.coverage.x.coveredPlannedSurfaceCount,
  );
  assert.equal(report.coverage.x.fullSiteBoundary.pendingReadQueueSurfaceCount, 1);
  assert.equal(report.coverage.x.fullSiteBoundary.unresolvedCandidateOnlyRouteCount, 1);
  assert.equal(report.coverage.x.fullSiteBoundary.frontierGapCount, 4);
  assert.equal(report.coverage.x.fullSiteBoundary.plannedCapabilityCount, 2);
  assert.equal(report.coverage.x.fullSiteBoundary.discoveredFunctionKindCount, report.coverage.x.discovery.discoveredFunctionKindCount);
  assert.equal(report.coverage.x.fullSiteBoundary.readExecutableFunctionKindCount, report.coverage.x.discovery.readExecutableFunctionKinds.length);
  assert.equal(report.coverage.x.fullSiteBoundary.blockedFunctionKindCount, report.coverage.x.discovery.blockedFunctionKinds.length);
  assert.equal(report.coverage.x.fullSiteBoundary.observedApiOperationCount, 15);
  assert.equal(report.coverage.x.fullSiteBoundary.targetApiOperationCount, 3);
  assert.equal(report.coverage.x.fullSiteBoundary.readReplayEligibleApiOperationCount, 2);
  assert.equal(report.coverage.x.fullSiteBoundary.replayBlockedApiOperationCount, 5);
  assert.equal(report.coverage.x.fullSiteBoundary.sideEffectRiskApiOperationCount, 5);
  assert.equal(report.coverage.x.fullSiteBoundary.dynamicRouteFamilyCount, 2);
  assert.equal(report.coverage.x.fullSiteBoundary.dynamicRouteFamilyRouteTemplateCount, 2);
  assert.equal(report.coverage.x.fullSiteBoundary.dynamicRouteSampleCount, 1);
  assert.equal(report.coverage.x.fullSiteBoundary.dynamicRouteSamplelessTemplateCount, 1);
  assert.equal(report.coverage.x.fullSiteBoundary.dynamicSeedRunCount, 2);
  assert.equal(report.coverage.x.fullSiteBoundary.dynamicSeedFamilyCount, 1);
  assert.equal(report.coverage.x.fullSiteBoundary.dynamicSeedRouteTemplateCount, 1);
  assert.equal(report.coverage.x.fullSiteBoundary.dynamicSeedSurfaceCount, 2);
  assert.equal(report.coverage.x.fullSiteBoundary.finiteExhaustiveReason, 'x-has-open-ended-user-content-and-parameterized-route-families');
  assert.equal(report.coverage.x.fullSiteBoundary.nextEvidence, 'close-pending-planned-surface-queues-and-frontier-gaps');
  assert.equal(report.coverage.x.readCrawl.frontier.scope, 'outside-planned-surface-route-templates');
  assert.equal(report.coverage.x.readCrawl.frontier.plannedRouteTemplateCount, 2);
  assert.deepEqual(report.coverage.x.readCrawl.frontier.plannedRouteTemplates, ['/:account', '/compose/post']);
  assert.equal(report.coverage.x.readCrawl.frontier.routeTemplateCount, 5);
  assert.equal(report.coverage.x.readCrawl.frontier.safeVisitedRouteCount, 2);
  assert.equal(report.coverage.x.readCrawl.frontier.routeSampledRouteCount, 1);
  assert.equal(report.coverage.x.readCrawl.frontier.routeSamplelessRouteCount, 1);
  assert.deepEqual(report.coverage.x.readCrawl.frontier.routeSamplelessRoutes, ['/:account/media']);
  assert.equal(report.coverage.x.readCrawl.frontier.blockedRouteCount, 2);
  assert.equal(report.coverage.x.readCrawl.frontier.unresolvedRouteCount, 1);
  assert.equal(report.coverage.x.readCrawl.frontier.gapCount, 4);
  assert.equal(report.coverage.x.readCrawl.frontier.decisionSummary.routeTemplateCount, 5);
  assert.equal(report.coverage.x.readCrawl.frontier.decisionSummary.decisionCount, 5);
  assert.equal(report.coverage.x.readCrawl.frontier.decisionSummary.allFrontierRoutesClassified, true);
  assert.equal(report.coverage.x.readCrawl.frontier.decisionSummary.readyForControlledScopeClosure, false);
  assert.equal(report.coverage.x.readCrawl.frontier.decisionSummary.plannedSurfaceUpgradeCandidateCount, 0);
  assert.deepEqual(
    report.coverage.x.readCrawl.frontier.decisionSummary.byDecisionKind,
    [
      { decisionKind: 'dynamic-family-parameterized', count: 2 },
      { decisionKind: 'risk-blocked', count: 2 },
      { decisionKind: 'needs-read-route-replay', count: 1 },
    ],
  );
  assert.deepEqual(
    report.coverage.x.readCrawl.frontier.decisions
      .map((entry) => [entry.routeTemplate, entry.decisionKind, entry.upgradeAction])
      .sort((left, right) => left[0].localeCompare(right[0])),
    [
      ['/:account/media', 'dynamic-family-parameterized', 'keep-dynamic-family'],
      ['/:account/status/:id', 'dynamic-family-parameterized', 'keep-dynamic-family'],
      ['/i/premium_sign_up', 'risk-blocked', 'manual-review-required'],
      ['/search?q=:query&src=:src&f=:filter', 'needs-read-route-replay', 'defer-until-visited'],
      ['/settings/account', 'risk-blocked', 'manual-review-required'],
    ],
  );
  assert.deepEqual(
    report.coverage.x.readCrawl.frontier.gaps.map((entry) => [entry.routeTemplate, entry.gapKind, entry.nextEvidence]),
    [
      ['/i/premium_sign_up', 'blocked-risk', 'manual-review-or-explicit-user-approved-risk-run'],
      ['/settings/account', 'blocked-risk', 'manual-review-or-explicit-user-approved-risk-run'],
      ['/:account/media', 'sampleless-safe-visited', 'rerun-source-surface-with-route-sample-capture'],
      ['/search?q=:query&src=:src&f=:filter', 'candidate-only', 'read-route-crawl-replay'],
    ],
  );
  assert.equal(report.coverage.x.readCrawl.frontier.safeVisitedRoutes.includes('/:account/media'), true);
  assert.equal(report.coverage.x.readCrawl.frontier.safeVisitedRoutes.includes('/:account/status/:id'), true);
  assert.deepEqual(report.coverage.x.readCrawl.frontier.blockedRoutes, ['/i/premium_sign_up', '/settings/account']);
  assert.deepEqual(report.coverage.x.readCrawl.frontier.unresolvedRoutes, ['/search?q=:query&src=:src&f=:filter']);
  assert.deepEqual(
    report.coverage.x.readCrawl.frontier.dynamicRouteFamilies.families.map((entry) => [entry.familyKind, entry.routeTemplateCount, entry.parameterizedReplayRequired]),
    [
      ['account-dynamic-route', 1, true],
      ['status-dynamic-route', 1, true],
    ],
  );
  assert.deepEqual(
    report.coverage.x.readCrawl.frontier.dynamicRouteFamilies.families
      .find((entry) => entry.familyKind === 'status-dynamic-route')
      .routeShapes.map((entry) => [entry.depth, entry.dynamicSegmentCount, entry.idSegmentCount]),
    [[3, 2, 1]],
  );
  assert.equal(report.coverage.x.readCrawl.frontier.dynamicRouteFamilies.sampleCount, 1);
  assert.equal(report.coverage.x.readCrawl.frontier.dynamicRouteFamilies.samplelessRouteTemplateCount, 1);
  assert.equal(report.coverage.x.readCrawl.frontier.dynamicRouteFamilies.parameterizedCoverageBoundary.readyForControlledScopeClosure, false);
  assert.equal(report.coverage.x.readCrawl.frontier.dynamicRouteFamilies.parameterizedCoverageBoundary.nextEvidence, 'rerun-source-surfaces-with-route-sample-capture');
  const accountFamily = report.coverage.x.readCrawl.frontier.dynamicRouteFamilies.families
    .find((entry) => entry.familyKind === 'account-dynamic-route');
  assert.equal(accountFamily.routeSampledRouteTemplateCount, 0);
  assert.equal(accountFamily.routeSamplelessRouteTemplateCount, 1);
  assert.deepEqual(accountFamily.routeSamplelessRouteTemplates, ['/:account/media']);
  assert.equal(accountFamily.parameterizedCoverageBoundary.readyForControlledScopeClosure, false);
  assert.deepEqual(
    accountFamily.routeTemplateBoundaries.map((entry) => [
      entry.routeTemplate,
      entry.sampleStatus,
      entry.routeSampleCount,
      entry.plannedSurfacePromotionRequired,
      entry.nextEvidence,
    ]),
    [
      ['/:account/media', 'sampleless-parameterized-template', 0, false, 'rerun-source-surface-with-route-sample-capture'],
    ],
  );
  const statusFamily = report.coverage.x.readCrawl.frontier.dynamicRouteFamilies.families
    .find((entry) => entry.familyKind === 'status-dynamic-route');
  assert.equal(statusFamily.parameterizedCoverageBoundary.readyForControlledScopeClosure, true);
  assert.deepEqual(
    statusFamily.routeTemplateBoundaries.map((entry) => [
      entry.routeTemplate,
      entry.sampleStatus,
      entry.routeSampleCount,
      entry.plannedSurfacePromotionRequired,
      entry.nextEvidence,
    ]),
    [
      ['/:account/status/:id', 'sampled-parameterized-template', 1, false, null],
    ],
  );
  assert.equal(statusFamily.routeSampleCount, 1);
  assert.deepEqual(
    statusFamily.routeSamples[0].segmentShapes.map((entry) => [entry.kind, entry.valueLength, entry.valueClass]),
    [
      ['account', 22, 'handle-like'],
      ['static', 0, null],
      ['id', 10, 'digits'],
    ],
  );
  assert.equal(report.coverage.x.readCrawl.frontier.blockedFunctionKinds.includes('account.settings'), true);
  assert.equal(report.coverage.x.readCrawl.frontier.blockedFunctionKinds.includes('commerce.premium-signup'), true);
  const mediaRouteAudit = report.coverage.x.readCrawl.routeTemplateReplayCoverage.find((entry) => entry.routeTemplate === '/:account/media');
  assert.equal(mediaRouteAudit.replayDisposition, 'visited-route');
  assert.equal(mediaRouteAudit.observedAsPageCount, 1);
  assert.equal(mediaRouteAudit.observedAsCandidateCount, 1);
  const statusRouteAudit = report.coverage.x.readCrawl.routeTemplateReplayCoverage.find((entry) => entry.routeTemplate === '/:account/status/:id');
  assert.equal(statusRouteAudit.replayDisposition, 'redirected-route');
  assert.deepEqual(statusRouteAudit.redirectedToRouteTemplates, ['/:account/media']);
  assert.equal(statusRouteAudit.routeSamples[0].routeTemplate, '/:account/status/:id');
  const settingsRouteAudit = report.coverage.x.readCrawl.routeTemplateReplayCoverage.find((entry) => entry.routeTemplate === '/settings/account');
  assert.equal(settingsRouteAudit.replayDisposition, 'blocked-risk');

  const profilePosts = report.coverage.x.surfaceRows.find((row) => row.surface === 'profile-content:posts');
  assert.equal(profilePosts.routeTemplate, '/:account');
  assert.equal(profilePosts.capability, 'timeline.posts.archive');
  assert.equal(profilePosts.intent, 'archive_profile_posts');
  assert.equal(profilePosts.accountProvided, true);
  assert.equal(profilePosts.queryProvided, true);
  assert.equal(JSON.stringify(report.coverage).includes('private-account-handle'), false);
  assert.equal(JSON.stringify(report.coverage).includes('private search query'), false);
  assert.equal(JSON.stringify(report.coverage).includes('private-search-query'), false);
  assert.equal(JSON.stringify(report.coverage).includes('privatehandle'), false);
  assert.equal(JSON.stringify(report.coverage).includes('123456-follow'), false);
  assert.equal(JSON.stringify(report.coverage).includes('1234567890'), false);
  assert.equal(JSON.stringify(report.coverage).includes('auth_token'), false);
  assert.equal(JSON.stringify(report.coverage).includes('ct0'), false);
});

test('social-live-report distinguishes API responses without archive seeds from missing API evidence', async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'bwk-social-report-api-no-seed-'));
  t.after(() => rm(rootDir, { recursive: true, force: true }));

  const runDir = path.join(rootDir, 'x-connect-people-no-seed');
  await mkdir(runDir, { recursive: true });
  await writeFile(path.join(runDir, 'manifest.json'), `${JSON.stringify({
    siteKey: 'x',
    generatedAt: '2026-04-26T00:02:00.000Z',
    ok: true,
    plan: {
      action: 'read-route',
      routeName: 'connect-people',
      routePath: '/i/connect_people',
      url: 'https://x.com/i/connect_people',
      contentType: 'posts',
    },
    outcome: { ok: true, status: 'degraded', reason: 'api-operations-no-archive-seed' },
    completeness: {
      status: 'degraded',
      apiPages: 0,
      itemCount: 0,
      userCount: 0,
      mediaCount: 0,
      archiveReason: 'api-operations-no-archive-seed',
      driftReasons: ['api-operations-no-archive-seed'],
    },
    archive: {
      reason: 'api-operations-no-archive-seed',
      pages: 0,
      capture: {
        requestCount: 4,
        responseCount: 2,
        parsedResponseCount: 2,
        parsedSeedCandidateCount: 0,
        operations: ['ConnectTabTimeline', 'settings.json'],
        samples: [
          { operationName: 'ConnectTabTimeline', itemCount: 0, userCount: 0, hasNextCursor: false },
        ],
      },
    },
  }, null, 2)}\n`, 'utf8');

  const report = await buildReport(parseReportArgs(['--runs-root', rootDir, '--site', 'x', '--no-write']));
  const row = report.coverage.x.surfaceRows.find((entry) => entry.surface === 'read-route:connect-people');
  assert.equal(row.reason, 'api-operations-no-archive-seed');
  assert.equal(row.apiResponseCount, 2);
  assert.deepEqual(row.operations, ['ConnectTabTimeline', 'settings.json']);
  assert.equal(report.coverage.x.surfacesWithApiPages, 0);
  assert.equal(report.coverage.x.surfacesWithApiResponses, 1);
  assert.equal(report.coverage.x.surfacesWithApiOperationOnly, 1);
  assert.deepEqual(report.coverage.x.uniqueOperations, ['ConnectTabTimeline', 'settings.json']);
  assert.deepEqual(report.coverage.x.apiOperationOnlyOperations, ['ConnectTabTimeline', 'settings.json']);
});

test('social-live-report records parent read routes covered by child API surfaces', async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'bwk-social-report-child-api-'));
  t.after(() => rm(rootDir, { recursive: true, force: true }));

  const parentDir = path.join(rootDir, 'x-read-route-explore');
  const childDir = path.join(rootDir, 'x-read-route-explore-news');
  await mkdir(parentDir, { recursive: true });
  await mkdir(childDir, { recursive: true });
  await writeFile(path.join(parentDir, 'manifest.json'), `${JSON.stringify({
    siteKey: 'x',
    generatedAt: '2026-04-26T00:02:00.000Z',
    plan: {
      action: 'read-route',
      routeName: 'explore',
      routePath: '/explore',
      url: 'https://x.com/explore',
      contentType: 'posts',
    },
    outcome: { ok: true, status: 'passed', reason: null },
    completeness: {
      apiPages: 0,
      itemCount: 0,
      userCount: 0,
      mediaCount: 0,
    },
    archive: {
      pages: 0,
      capture: {
        requestCount: 1,
        responseCount: 0,
        parsedResponseCount: 0,
        operations: [],
        samples: [],
      },
    },
  }, null, 2)}\n`, 'utf8');
  await writeFile(path.join(childDir, 'manifest.json'), `${JSON.stringify({
    siteKey: 'x',
    generatedAt: '2026-04-26T00:03:00.000Z',
    plan: {
      action: 'read-route',
      routeName: 'explore-news',
      routePath: '/explore/tabs/news',
      url: 'https://x.com/explore/tabs/news',
      contentType: 'posts',
    },
    outcome: { ok: true, status: 'passed', reason: null },
    completeness: {
      apiPages: 1,
      itemCount: 1,
      userCount: 0,
      mediaCount: 1,
    },
    archive: {
      pages: 1,
      capture: {
        requestCount: 4,
        responseCount: 2,
        parsedResponseCount: 1,
        operations: ['ExplorePage'],
        samples: [
          { operationName: 'ExplorePage', itemCount: 1, userCount: 0, hasNextCursor: false },
        ],
      },
    },
  }, null, 2)}\n`, 'utf8');

  const report = await buildReport(parseReportArgs(['--runs-root', rootDir, '--site', 'x', '--no-write']));
  const childCoverage = report.coverage.x.apiCoveredByChildSurfaces[0];
  assert.equal(report.coverage.x.surfacesWithChildApiCoverage, 1);
  assert.equal(childCoverage.surface, 'read-route:explore');
  assert.equal(childCoverage.routeTemplate, '/explore');
  assert.deepEqual(childCoverage.childSurfaces, ['read-route:explore-news']);
  assert.deepEqual(childCoverage.childRouteTemplates, ['/explore/tabs/news']);
  assert.deepEqual(childCoverage.childOperations, ['ExplorePage']);
  assert.equal(childCoverage.childApiPages, 1);
  assert.equal(childCoverage.childApiResponses, 2);
  assert.equal(childCoverage.childItems, 1);
  assert.equal(childCoverage.childMedia, 1);

  const outDir = path.join(rootDir, 'report');
  const outputs = await writeReport(parseReportArgs(['--runs-root', rootDir, '--site', 'x', '--out-dir', outDir]), report);
  const markdown = await readFile(outputs.markdownPath, 'utf8');
  assert.match(markdown, /child API-covered surfaces: read-route:explore -> read-route:explore-news/u);
});

test('social-live-report maps supplemental X read-route surfaces', async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'bwk-social-report-supplemental-routes-'));
  t.after(() => rm(rootDir, { recursive: true, force: true }));

  async function writeRouteManifest(name, routeName, routePath, operations = ['settings.json'], extra = {}) {
    const runDir = path.join(rootDir, name);
    await mkdir(runDir, { recursive: true });
    await writeFile(path.join(runDir, 'manifest.json'), `${JSON.stringify({
      siteKey: 'x',
      generatedAt: `2026-04-26T00:0${name.slice(-1)}:00.000Z`,
      plan: {
        action: 'read-route',
        routeName,
        routePath,
        url: `https://x.com${routePath.replace('/{account}', '/openai').replace('/{statusId}', '/123456').replace('/{spaceId}', '/1OyKALLDpNrxb')}`,
        contentType: 'posts',
      },
      outcome: { ok: true, status: 'degraded', reason: 'api-seed-only' },
      completeness: {
        apiPages: 1,
        itemCount: 0,
        userCount: 0,
        mediaCount: 0,
      },
      archive: {
        pages: 1,
        capture: {
          requestCount: 2,
          responseCount: 1,
          parsedResponseCount: 1,
          operations,
          samples: operations.map((operationName) => ({ operationName, itemCount: 1, userCount: 0, hasNextCursor: false })),
        },
      },
      ...extra,
    }, null, 2)}\n`, 'utf8');
  }

  await writeRouteManifest('route-account-about', 'account-about', '/{account}/about');
  await writeRouteManifest('route-account-accessibility', 'account-accessibility', '/{account}/accessibility');
  await writeRouteManifest('route-1', 'account-articles', '/{account}/articles');
  await writeRouteManifest('route-2', 'settings-explore-location', '/settings/explore/location');
  await writeRouteManifest('route-3', 'internal-status', '/i/status/{statusId}');
  await writeRouteManifest('route-4', 'profile-lists', '/{account}/lists', ['CombinedLists', 'UserByScreenName', 'SidebarUserRecommendations']);
  await writeRouteManifest('route-5', 'verified-followers', '/{account}/verified_followers', ['BlueVerifiedFollowers', 'UserByScreenName', 'list.json', 'SidebarUserRecommendations']);
  await writeRouteManifest('route-6', 'status-retweets', '/{account}/status/{statusId}/retweets', ['Retweeters', 'SidebarUserRecommendations']);
  await writeRouteManifest('route-7', 'audio-space', '/i/spaces/{spaceId}', [], {
    controlProbe: {
      observed: true,
      api: {
        responseCount: 1,
        operations: ['AudioSpaceById'],
        readLikeOperations: ['AudioSpaceById'],
      },
    },
  });
  await writeRouteManifest('route-status-analytics', 'status-analytics', '/{account}/status/{statusId}/analytics', [
    'TweetDetail',
  ]);
  await writeRouteManifest('route-8', 'communities', '/i/communities', [
    'CarouselQuery',
    'CommunitiesCreateButtonQuery',
    'CommunitiesExploreTimeline',
    'TopicCarouselQuery',
  ]);
  await writeRouteManifest('route-community-detail', 'community-detail', '/i/communities/{communityId}', [
    'CommunityQuery',
    'CommunityTweetsTimeline',
  ]);
  await writeRouteManifest('route-community-about', 'community-about', '/i/communities/{communityId}/about', [
    'CommunityAboutTimeline',
    'CommunityQuery',
  ]);
  await writeRouteManifest('route-community-members', 'community-members', '/i/communities/{communityId}/members', [
    'CommunityInviteButtonQuery',
    'membersSliceTimeline_Query',
  ]);
  await writeRouteManifest('route-community-members-search', 'community-members-search', '/i/communities/{communityId}/members/search', [
    'membersSliceTimeline_Query',
  ]);
  await writeRouteManifest('route-community-search', 'community-search', '/i/communities/{communityId}/search', []);
  await writeRouteManifest('route-list-detail', 'list-detail', '/i/lists/{listId}', [
    'ListByRestId',
    'ListLatestTweetsTimeline',
    'UserByRestId',
  ]);
  await writeRouteManifest('route-list-followers', 'list-followers', '/i/lists/{listId}/followers', []);
  await writeRouteManifest('route-list-members', 'list-members', '/i/lists/{listId}/members', []);
  await writeRouteManifest('route-9', 'settings-account', '/settings/account', [
    'settings.json',
    'DataSaverMode',
    'getAltTextPromptPreference',
  ]);
  await writeRouteManifest('route-10', 'notifications', '/notifications', [
    'NotificationsTimeline',
    'badge_count.json',
  ]);
  await writeRouteManifest('route-11', 'jobs', '/jobs');
  await writeRouteManifest('route-12', 'settings', '/settings');
  await writeRouteManifest('route-13', 'settings-security', '/settings/security');
  await writeRouteManifest('route-14', 'settings-privacy-and-safety', '/settings/privacy_and_safety');
  await writeRouteManifest('route-15', 'settings-accessibility-display-languages', '/settings/accessibility_display_and_languages');
  await writeRouteManifest('route-16', 'settings-additional-resources', '/settings/additional_resources');
  await writeRouteManifest('route-17', 'settings-your-twitter-data', '/settings/your_twitter_data');
  await writeRouteManifest('route-18', 'notification-verified', '/notifications/verified');
  await writeRouteManifest('route-19', 'settings-about', '/settings/about');
  await writeRouteManifest('route-20', 'settings-profile', '/settings/profile');
  await writeRouteManifest('route-21', 'settings-account-login', '/settings/account/login');
  await writeRouteManifest('route-22', 'settings-notifications-email', '/settings/notifications/email_notifications');
  await writeRouteManifest('route-23', 'settings-notifications-push', '/settings/notifications/push_notifications');
  await writeRouteManifest('route-24', 'settings-manage-subscriptions', '/settings/manage_subscriptions');
  await writeRouteManifest('route-25', 'settings-monetization', '/settings/monetization');
  await writeRouteManifest('route-26', 'settings-security-and-account-access', '/settings/security_and_account_access');
  await writeRouteManifest('route-27', 'chat', '/i/chat');
  await writeRouteManifest('route-28', 'keyboard-shortcuts', '/i/keyboard_shortcuts');
  await writeRouteManifest('route-29', 'settings-contacts', '/settings/contacts');
  await writeRouteManifest('route-30', 'settings-connected-accounts', '/settings/connected_accounts');
  await writeRouteManifest('route-31', 'settings-delegate', '/settings/delegate', ['DelegateQuery', 'settings.json']);
  await writeRouteManifest('route-32', 'settings-notifications-filters', '/settings/notifications/filters');
  await writeRouteManifest('route-33', 'settings-notifications-preferences', '/settings/notifications/preferences');
  await writeRouteManifest('route-34', 'settings-email-notifications', '/settings/email_notifications', ['ViewerEmailSettings', 'settings.json']);
  await writeRouteManifest('route-35', 'settings-notifications-advanced-filters', '/settings/notifications/advanced_filters', ['advanced_filters.json', 'settings.json']);
  await writeRouteManifest('route-36', 'settings-push-notifications', '/settings/push_notifications');
  await writeRouteManifest('route-37', 'settings-accessibility', '/settings/accessibility', ['getAltTextPromptPreference', 'settings.json']);
  await writeRouteManifest('route-38', 'settings-data', '/settings/data');
  await writeRouteManifest('route-39', 'settings-deactivate', '/settings/deactivate');
  await writeRouteManifest('route-40', 'settings-display', '/settings/display', ['PremiumContentQuery', 'useDirectCallSetupQuery', 'xChatDmSettingsQuery']);
  await writeRouteManifest('route-41', 'settings-download-your-data', '/settings/download_your_data');
  await writeRouteManifest('route-42', 'settings-languages', '/settings/languages', ['SupportedLanguages', 'UnifiedLanguagePivotMenuLanguagesQuery', 'settings.json']);
  await writeRouteManifest('route-43', 'news-stories-home', '/i/jf/stories/home', ['NotificationsTimeline', 'fleetline', 'useRelayDelegateDataPendingQuery']);
  await writeRouteManifest('route-44', 'settings-autoplay', '/settings/autoplay');
  await writeRouteManifest('route-45', 'settings-delegate-groups', '/settings/delegate/groups', ['DelegateQuery', 'settings.json']);
  await writeRouteManifest('route-46', 'settings-delegate-members', '/settings/delegate/members', ['DelegateQuery', 'settings.json']);
  const promotedSettingsFrontierRoutes = [
    ['settings-account-id-verification', '/settings/account/id_verification'],
    ['settings-account-login-verification', '/settings/account/login_verification'],
    ['settings-account-passkey', '/settings/account/passkey'],
    ['settings-about-your-account', '/settings/about_your_account'],
    ['settings-ads-preferences', '/settings/ads_preferences'],
    ['settings-audience-and-tagging', '/settings/audience_and_tagging'],
    ['settings-blocked-all', '/settings/blocked/all'],
    ['settings-content-you-see', '/settings/content_you_see'],
    ['settings-contacts-dashboard', '/settings/contacts_dashboard'],
    ['settings-data-sharing-with-business-partners', '/settings/data_sharing_with_business_partners'],
    ['settings-direct-messages', '/settings/direct_messages'],
    ['settings-grok-settings', '/settings/grok_settings'],
    ['settings-location-information', '/settings/location_information'],
    ['settings-mute-and-block', '/settings/mute_and_block'],
    ['settings-muted-all', '/settings/muted/all'],
    ['settings-muted-keywords', '/settings/muted_keywords'],
    ['settings-off-twitter-activity', '/settings/off_twitter_activity'],
    ['settings-spaces', '/settings/spaces'],
    ['settings-your-tweets', '/settings/your_tweets'],
  ];
  for (const [index, [name, route]] of promotedSettingsFrontierRoutes.entries()) {
    await writeRouteManifest(`route-${47 + index}`, name, route);
  }

  const report = await buildReport(parseReportArgs(['--runs-root', rootDir, '--site', 'x', '--no-write']));
  assert.equal(report.coverage.x.plannedSurfaceCount, 117);
  assert.equal(report.coverage.x.missingExpectedSurfaces.includes('read-route:compose-post'), true);
  assert.equal(report.coverage.x.missingExpectedSurfaces.includes('read-route:messages'), true);

  const bySurface = new Map(report.coverage.x.surfaceRows.map((row) => [row.surface, row]));
  assert.equal(bySurface.get('read-route:account-about').routeTemplate, '/:account/about');
  assert.equal(bySurface.get('read-route:account-about').capability, 'dynamic.account-about.inspect');
  assert.equal(bySurface.get('read-route:account-accessibility').routeTemplate, '/:account/accessibility');
  assert.equal(bySurface.get('read-route:account-accessibility').intent, 'inspect_account_accessibility_route');
  assert.equal(bySurface.get('read-route:account-articles').routeTemplate, '/:account/articles');
  assert.equal(bySurface.get('read-route:account-articles').capability, 'dynamic.account-articles.inspect');
  assert.equal(bySurface.get('read-route:settings-explore-location').routeTemplate, '/settings/explore/location');
  assert.equal(bySurface.get('read-route:settings-explore-location').intent, 'inspect_explore_location_settings_surface');
  assert.equal(bySurface.get('read-route:chat').routeTemplate, '/i/chat');
  assert.equal(bySurface.get('read-route:chat').capability, 'risk-reviewed.chat.inspect');
  assert.equal(bySurface.get('read-route:keyboard-shortcuts').routeTemplate, '/i/keyboard_shortcuts');
  assert.equal(bySurface.get('read-route:keyboard-shortcuts').intent, 'inspect_keyboard_shortcuts_surface');
  assert.equal(bySurface.get('read-route:settings').routeTemplate, '/settings');
  assert.equal(bySurface.get('read-route:settings').capability, 'risk-reviewed.settings.inspect');
  assert.equal(bySurface.get('read-route:settings-security').routeTemplate, '/settings/security');
  assert.equal(bySurface.get('read-route:settings-security').intent, 'inspect_security_settings_surface');
  assert.equal(bySurface.get('read-route:settings-security-and-account-access').routeTemplate, '/settings/security_and_account_access');
  assert.equal(bySurface.get('read-route:settings-security-and-account-access').intent, 'inspect_security_account_access_settings_surface');
  assert.equal(bySurface.get('read-route:settings-privacy-and-safety').routeTemplate, '/settings/privacy_and_safety');
  assert.equal(bySurface.get('read-route:settings-privacy-and-safety').capability, 'risk-reviewed.settings-privacy.inspect');
  assert.equal(bySurface.get('read-route:settings-account-login').routeTemplate, '/settings/account/login');
  assert.equal(bySurface.get('read-route:settings-account-login').intent, 'inspect_account_login_settings_surface');
  assert.equal(bySurface.get('read-route:settings-account-id-verification').routeTemplate, '/settings/account/id_verification');
  assert.equal(bySurface.get('read-route:settings-account-id-verification').intent, 'inspect_account_id_verification_settings_surface');
  assert.equal(bySurface.get('read-route:settings-account-login-verification').routeTemplate, '/settings/account/login_verification');
  assert.equal(bySurface.get('read-route:settings-account-passkey').routeTemplate, '/settings/account/passkey');
  assert.equal(bySurface.get('read-route:settings-accessibility').routeTemplate, '/settings/accessibility');
  assert.equal(bySurface.get('read-route:settings-accessibility').intent, 'inspect_accessibility_settings_surface');
  assert.equal(bySurface.get('read-route:settings-profile').routeTemplate, '/settings/profile');
  assert.equal(bySurface.get('read-route:settings-profile').intent, 'inspect_profile_settings_surface');
  assert.equal(bySurface.get('read-route:settings-accessibility-display-languages').routeTemplate, '/settings/accessibility_display_and_languages');
  assert.equal(bySurface.get('read-route:settings-additional-resources').routeTemplate, '/settings/additional_resources');
  assert.equal(bySurface.get('read-route:settings-about').routeTemplate, '/settings/about');
  assert.equal(bySurface.get('read-route:settings-about').intent, 'inspect_about_settings_surface');
  assert.equal(bySurface.get('read-route:settings-about-your-account').routeTemplate, '/settings/about_your_account');
  assert.equal(bySurface.get('read-route:settings-ads-preferences').routeTemplate, '/settings/ads_preferences');
  assert.equal(bySurface.get('read-route:settings-audience-and-tagging').routeTemplate, '/settings/audience_and_tagging');
  assert.equal(bySurface.get('read-route:settings-autoplay').routeTemplate, '/settings/autoplay');
  assert.equal(bySurface.get('read-route:settings-autoplay').intent, 'inspect_autoplay_settings_surface');
  assert.equal(bySurface.get('read-route:settings-blocked-all').routeTemplate, '/settings/blocked/all');
  assert.equal(bySurface.get('read-route:settings-blocked-all').intent, 'inspect_blocked_accounts_settings_surface');
  assert.equal(bySurface.get('read-route:settings-connected-accounts').routeTemplate, '/settings/connected_accounts');
  assert.equal(bySurface.get('read-route:settings-content-you-see').routeTemplate, '/settings/content_you_see');
  assert.equal(bySurface.get('read-route:settings-connected-accounts').intent, 'inspect_connected_accounts_settings_surface');
  assert.equal(bySurface.get('read-route:settings-contacts').routeTemplate, '/settings/contacts');
  assert.equal(bySurface.get('read-route:settings-contacts').intent, 'inspect_contacts_settings_surface');
  assert.equal(bySurface.get('read-route:settings-contacts-dashboard').routeTemplate, '/settings/contacts_dashboard');
  assert.equal(bySurface.get('read-route:settings-contacts-dashboard').intent, 'inspect_contacts_dashboard_settings_surface');
  assert.equal(bySurface.get('read-route:settings-data').routeTemplate, '/settings/data');
  assert.equal(bySurface.get('read-route:settings-data').intent, 'inspect_data_settings_surface');
  assert.equal(bySurface.get('read-route:settings-data-sharing-with-business-partners').routeTemplate, '/settings/data_sharing_with_business_partners');
  assert.equal(bySurface.get('read-route:settings-deactivate').routeTemplate, '/settings/deactivate');
  assert.equal(bySurface.get('read-route:settings-deactivate').intent, 'inspect_account_deactivation_settings_surface');
  assert.equal(bySurface.get('read-route:settings-delegate').routeTemplate, '/settings/delegate');
  assert.equal(bySurface.get('read-route:settings-delegate').intent, 'inspect_delegate_settings_surface');
  assert.equal(bySurface.get('read-route:settings-delegate-groups').routeTemplate, '/settings/delegate/groups');
  assert.equal(bySurface.get('read-route:settings-delegate-groups').intent, 'inspect_delegate_groups_settings_surface');
  assert.equal(bySurface.get('read-route:settings-delegate-members').routeTemplate, '/settings/delegate/members');
  assert.equal(bySurface.get('read-route:settings-delegate-members').intent, 'inspect_delegate_members_settings_surface');
  assert.equal(bySurface.get('read-route:settings-direct-messages').routeTemplate, '/settings/direct_messages');
  assert.equal(bySurface.get('read-route:settings-display').routeTemplate, '/settings/display');
  assert.equal(bySurface.get('read-route:settings-display').intent, 'inspect_display_settings_surface');
  assert.equal(bySurface.get('read-route:settings-download-your-data').routeTemplate, '/settings/download_your_data');
  assert.equal(bySurface.get('read-route:settings-download-your-data').intent, 'inspect_download_data_settings_surface');
  assert.equal(bySurface.get('read-route:settings-email-notifications').routeTemplate, '/settings/email_notifications');
  assert.equal(bySurface.get('read-route:settings-email-notifications').intent, 'inspect_legacy_email_notification_settings_surface');
  assert.equal(bySurface.get('read-route:settings-notifications-advanced-filters').routeTemplate, '/settings/notifications/advanced_filters');
  assert.equal(bySurface.get('read-route:settings-notifications-advanced-filters').intent, 'inspect_notification_advanced_filter_settings_surface');
  assert.equal(bySurface.get('read-route:settings-push-notifications').routeTemplate, '/settings/push_notifications');
  assert.equal(bySurface.get('read-route:settings-push-notifications').intent, 'inspect_legacy_push_notification_settings_surface');
  assert.equal(bySurface.get('read-route:settings-notifications-filters').routeTemplate, '/settings/notifications/filters');
  assert.equal(bySurface.get('read-route:settings-notifications-filters').intent, 'inspect_notification_filter_settings_surface');
  assert.equal(bySurface.get('read-route:settings-notifications-preferences').routeTemplate, '/settings/notifications/preferences');
  assert.equal(bySurface.get('read-route:settings-notifications-preferences').intent, 'inspect_notification_preference_settings_surface');
  assert.equal(bySurface.get('read-route:settings-languages').routeTemplate, '/settings/languages');
  assert.equal(bySurface.get('read-route:settings-languages').intent, 'inspect_language_settings_surface');
  assert.equal(bySurface.get('read-route:settings-manage-subscriptions').routeTemplate, '/settings/manage_subscriptions');
  assert.equal(bySurface.get('read-route:settings-monetization').routeTemplate, '/settings/monetization');
  assert.equal(bySurface.get('read-route:news-stories-home').routeTemplate, '/i/jf/stories/home');
  assert.equal(bySurface.get('read-route:news-stories-home').capability, 'app.news-stories.inspect');
  assert.equal(bySurface.get('read-route:settings-notifications-email').routeTemplate, '/settings/notifications/email_notifications');
  assert.equal(bySurface.get('read-route:settings-notifications-push').routeTemplate, '/settings/notifications/push_notifications');
  assert.equal(bySurface.get('read-route:settings-your-twitter-data').routeTemplate, '/settings/your_twitter_data');
  assert.equal(bySurface.get('read-route:settings-grok-settings').routeTemplate, '/settings/grok_settings');
  assert.equal(bySurface.get('read-route:settings-location-information').routeTemplate, '/settings/location_information');
  assert.equal(bySurface.get('read-route:settings-mute-and-block').routeTemplate, '/settings/mute_and_block');
  assert.equal(bySurface.get('read-route:settings-muted-all').routeTemplate, '/settings/muted/all');
  assert.equal(bySurface.get('read-route:settings-muted-keywords').routeTemplate, '/settings/muted_keywords');
  assert.equal(bySurface.get('read-route:settings-off-twitter-activity').routeTemplate, '/settings/off_twitter_activity');
  assert.equal(bySurface.get('read-route:settings-spaces').routeTemplate, '/settings/spaces');
  assert.equal(bySurface.get('read-route:settings-your-tweets').routeTemplate, '/settings/your_tweets');
  assert.equal(bySurface.get('read-route:notification-verified').routeTemplate, '/notifications/verified');
  assert.equal(bySurface.get('read-route:internal-status').routeTemplate, '/i/status/:id');
  assert.equal(bySurface.get('read-route:internal-status').capability, 'content.internal-status.inspect');
  assert.equal(bySurface.get('read-route:jobs').routeTemplate, '/jobs');
  assert.equal(bySurface.get('read-route:jobs').capability, 'app.jobs.inspect');
  assert.deepEqual(bySurface.get('read-route:settings-account').targetOperations, ['settings.json', 'DataSaverMode', 'getAltTextPromptPreference']);
  assert.deepEqual(bySurface.get('read-route:settings-account-id-verification').targetOperations, ['settings.json']);
  assert.deepEqual(bySurface.get('read-route:settings-account-login-verification').targetOperations, ['settings.json']);
  assert.deepEqual(bySurface.get('read-route:settings-account-passkey').targetOperations, ['settings.json']);
  assert.deepEqual(bySurface.get('read-route:settings-accessibility').targetOperations, ['getAltTextPromptPreference', 'settings.json']);
  assert.deepEqual(bySurface.get('read-route:settings-about-your-account').targetOperations, ['settings.json']);
  assert.deepEqual(bySurface.get('read-route:settings-ads-preferences').targetOperations, ['settings.json']);
  assert.deepEqual(bySurface.get('read-route:settings-audience-and-tagging').targetOperations, ['settings.json']);
  assert.deepEqual(bySurface.get('read-route:settings-autoplay').targetOperations, ['settings.json']);
  assert.deepEqual(bySurface.get('read-route:settings-blocked-all').targetOperations, ['settings.json']);
  assert.deepEqual(bySurface.get('read-route:settings-notifications-email').targetOperations, ['settings.json']);
  assert.deepEqual(bySurface.get('read-route:settings-notifications-push').targetOperations, ['settings.json']);
  assert.deepEqual(bySurface.get('read-route:settings-connected-accounts').targetOperations, ['settings.json']);
  assert.deepEqual(bySurface.get('read-route:settings-contacts').targetOperations, ['settings.json']);
  assert.deepEqual(bySurface.get('read-route:settings-contacts-dashboard').targetOperations, ['settings.json']);
  assert.deepEqual(bySurface.get('read-route:settings-data').targetOperations, ['settings.json']);
  assert.deepEqual(bySurface.get('read-route:settings-data-sharing-with-business-partners').targetOperations, ['settings.json']);
  assert.deepEqual(bySurface.get('read-route:settings-deactivate').targetOperations, ['settings.json']);
  assert.deepEqual(bySurface.get('read-route:settings-delegate').targetOperations, ['DelegateQuery', 'settings.json']);
  assert.deepEqual(bySurface.get('read-route:settings-delegate-groups').targetOperations, ['DelegateQuery', 'settings.json']);
  assert.deepEqual(bySurface.get('read-route:settings-delegate-members').targetOperations, ['DelegateQuery', 'settings.json']);
  assert.deepEqual(bySurface.get('read-route:settings-direct-messages').targetOperations, ['settings.json']);
  assert.deepEqual(bySurface.get('read-route:settings-display').targetOperations, ['PremiumContentQuery', 'useDirectCallSetupQuery', 'xChatDmSettingsQuery']);
  assert.deepEqual(bySurface.get('read-route:settings-download-your-data').targetOperations, ['settings.json']);
  assert.deepEqual(bySurface.get('read-route:settings-email-notifications').targetOperations, ['ViewerEmailSettings', 'settings.json']);
  assert.deepEqual(bySurface.get('read-route:settings-notifications-advanced-filters').targetOperations, ['advanced_filters.json', 'settings.json']);
  assert.deepEqual(bySurface.get('read-route:settings-push-notifications').targetOperations, ['settings.json']);
  assert.deepEqual(bySurface.get('read-route:settings-notifications-filters').targetOperations, ['settings.json']);
  assert.deepEqual(bySurface.get('read-route:settings-notifications-preferences').targetOperations, ['settings.json']);
  assert.deepEqual(bySurface.get('read-route:settings-manage-subscriptions').targetOperations, ['settings.json']);
  assert.deepEqual(bySurface.get('read-route:settings-monetization').targetOperations, ['settings.json']);
  assert.deepEqual(bySurface.get('read-route:settings-languages').targetOperations, ['SupportedLanguages', 'UnifiedLanguagePivotMenuLanguagesQuery', 'settings.json']);
  assert.deepEqual(bySurface.get('read-route:settings-grok-settings').targetOperations, ['settings.json']);
  assert.deepEqual(bySurface.get('read-route:settings-location-information').targetOperations, ['settings.json']);
  assert.deepEqual(bySurface.get('read-route:settings-mute-and-block').targetOperations, ['settings.json']);
  assert.deepEqual(bySurface.get('read-route:settings-muted-all').targetOperations, ['settings.json']);
  assert.deepEqual(bySurface.get('read-route:settings-muted-keywords').targetOperations, ['settings.json']);
  assert.deepEqual(bySurface.get('read-route:settings-off-twitter-activity').targetOperations, ['settings.json']);
  assert.deepEqual(bySurface.get('read-route:settings-spaces').targetOperations, ['settings.json']);
  assert.deepEqual(bySurface.get('read-route:settings-your-tweets').targetOperations, ['settings.json']);
  assert.deepEqual(bySurface.get('read-route:news-stories-home').targetOperations, ['NotificationsTimeline', 'fleetline', 'useRelayDelegateDataPendingQuery']);
  assert.deepEqual(bySurface.get('read-route:notifications').targetOperations, ['NotificationsTimeline', 'badge_count.json']);
  assert.deepEqual(bySurface.get('read-route:profile-lists').targetOperations, ['CombinedLists', 'UserByScreenName', 'SidebarUserRecommendations']);
  assert.deepEqual(bySurface.get('read-route:verified-followers').targetOperations, ['BlueVerifiedFollowers', 'UserByScreenName', 'list.json', 'SidebarUserRecommendations']);
  assert.deepEqual(bySurface.get('read-route:status-retweets').targetOperations, ['Retweeters', 'SidebarUserRecommendations']);
  assert.deepEqual(bySurface.get('read-route:audio-space').targetOperations, ['AudioSpaceById']);
  assert.equal(bySurface.get('read-route:status-analytics').routeTemplate, '/:account/status/:id/analytics');
  assert.equal(bySurface.get('read-route:status-analytics').capability, 'risk-reviewed.status-analytics.inspect');
  assert.deepEqual(bySurface.get('read-route:status-analytics').targetOperations, ['TweetDetail']);
  assert.deepEqual(bySurface.get('read-route:communities').targetOperations, [
    'CarouselQuery',
    'CommunitiesCreateButtonQuery',
    'CommunitiesExploreTimeline',
    'TopicCarouselQuery',
  ]);
  assert.equal(bySurface.get('read-route:community-detail').routeTemplate, '/i/communities/:communityId');
  assert.equal(bySurface.get('read-route:community-detail').capability, 'communities.detail.inspect');
  assert.deepEqual(bySurface.get('read-route:community-detail').targetOperations, ['CommunityQuery', 'CommunityTweetsTimeline']);
  assert.equal(bySurface.get('read-route:community-about').routeTemplate, '/i/communities/:communityId/about');
  assert.equal(bySurface.get('read-route:community-about').intent, 'inspect_community_about');
  assert.deepEqual(bySurface.get('read-route:community-about').targetOperations, [
    'CommunityAboutTimeline',
    'CommunityQuery',
  ]);
  assert.equal(bySurface.get('read-route:community-members').routeTemplate, '/i/communities/:communityId/members');
  assert.equal(bySurface.get('read-route:community-members').intent, 'inspect_community_members');
  assert.deepEqual(bySurface.get('read-route:community-members').targetOperations, [
    'CommunityInviteButtonQuery',
    'membersSliceTimeline_Query',
  ]);
  assert.equal(bySurface.get('read-route:community-members-search').routeTemplate, '/i/communities/:communityId/members/search');
  assert.equal(bySurface.get('read-route:community-members-search').capability, 'communities.members-search.inspect');
  assert.equal(bySurface.get('read-route:community-search').routeTemplate, '/i/communities/:communityId/search');
  assert.equal(bySurface.get('read-route:community-search').capability, 'communities.search.inspect');
  assert.equal(bySurface.get('read-route:list-detail').routeTemplate, '/i/lists/:listId');
  assert.equal(bySurface.get('read-route:list-detail').intent, 'inspect_list_detail');
  assert.deepEqual(bySurface.get('read-route:list-detail').targetOperations, ['ListByRestId', 'ListLatestTweetsTimeline', 'UserByRestId']);
  assert.equal(bySurface.get('read-route:list-followers').routeTemplate, '/i/lists/:listId/followers');
  assert.equal(bySurface.get('read-route:list-followers').intent, 'inspect_list_followers');
  assert.equal(bySurface.get('read-route:list-members').routeTemplate, '/i/lists/:listId/members');
  assert.equal(bySurface.get('read-route:list-members').capability, 'lists.members.inspect');
  assert.equal(report.coverage.x.dynamicSeedCoverage.routeTemplates.includes('/:account/status/:id/analytics'), true);
  assert.equal(report.coverage.x.dynamicSeedCoverage.routeTemplates.includes('/i/communities/:communityid/about'), true);
  assert.equal(report.coverage.x.dynamicSeedCoverage.routeTemplates.includes('/:account/status/:id/:segment'), false);
  assert.equal(report.coverage.x.dynamicSeedCoverage.routeTemplates.includes('/i/communities/:communityid/:segment'), false);
  assert.equal(report.coverage.x.discovery.targetApiOperations.includes('CombinedLists'), true);
  assert.equal(report.coverage.x.discovery.targetApiOperations.includes('BlueVerifiedFollowers'), true);
  assert.equal(report.coverage.x.discovery.targetApiOperations.includes('UserByScreenName'), true);
  assert.equal(report.coverage.x.discovery.targetApiOperations.includes('list.json'), true);
  assert.equal(report.coverage.x.discovery.targetApiOperations.includes('SidebarUserRecommendations'), true);
  assert.equal(report.coverage.x.discovery.targetApiOperations.includes('Retweeters'), true);
  assert.equal(report.coverage.x.discovery.targetApiOperations.includes('AudioSpaceById'), true);
  assert.equal(report.coverage.x.discovery.targetApiOperations.includes('CarouselQuery'), true);
  assert.equal(report.coverage.x.discovery.targetApiOperations.includes('CommunitiesCreateButtonQuery'), true);
  assert.equal(report.coverage.x.discovery.targetApiOperations.includes('CommunityQuery'), true);
  assert.equal(report.coverage.x.discovery.targetApiOperations.includes('CommunityTweetsTimeline'), true);
  assert.equal(report.coverage.x.discovery.targetApiOperations.includes('CommunityAboutTimeline'), true);
  assert.equal(report.coverage.x.discovery.targetApiOperations.includes('CommunityInviteButtonQuery'), true);
  assert.equal(report.coverage.x.discovery.targetApiOperations.includes('membersSliceTimeline_Query'), true);
  assert.equal(report.coverage.x.discovery.targetApiOperations.includes('ListByRestId'), true);
  assert.equal(report.coverage.x.discovery.targetApiOperations.includes('ListLatestTweetsTimeline'), true);
  assert.equal(report.coverage.x.discovery.targetApiOperations.includes('UserByRestId'), true);
  assert.equal(report.coverage.x.discovery.targetApiOperations.includes('TopicCarouselQuery'), true);
  assert.equal(report.coverage.x.discovery.targetApiOperations.includes('DataSaverMode'), true);
  assert.equal(report.coverage.x.discovery.targetApiOperations.includes('getAltTextPromptPreference'), true);
  assert.equal(report.coverage.x.discovery.targetApiOperations.includes('badge_count.json'), true);
  assert.equal(report.coverage.x.discovery.targetApiOperations.includes('ViewerEmailSettings'), true);
  assert.equal(report.coverage.x.discovery.targetApiOperations.includes('advanced_filters.json'), true);
  assert.equal(report.coverage.x.discovery.targetApiOperations.includes('SupportedLanguages'), true);
  assert.equal(report.coverage.x.discovery.targetApiOperations.includes('UnifiedLanguagePivotMenuLanguagesQuery'), true);
  assert.equal(report.coverage.x.discovery.targetApiOperations.includes('PremiumContentQuery'), true);
  assert.equal(report.coverage.x.discovery.targetApiOperations.includes('useDirectCallSetupQuery'), true);
  assert.equal(report.coverage.x.discovery.targetApiOperations.includes('xChatDmSettingsQuery'), true);
  assert.equal(report.coverage.x.discovery.targetApiOperations.includes('useRelayDelegateDataPendingQuery'), true);
});

test('social-live-report exposes dynamic seed expansion candidates after controlled scope closure', async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'bwk-social-report-dynamic-seed-expansion-'));
  t.after(() => rm(rootDir, { recursive: true, force: true }));

  function planForSurface(surface) {
    if (surface.startsWith('profile-content:')) {
      return { action: 'profile-content', contentType: surface.slice('profile-content:'.length) };
    }
    if (surface.startsWith('read-route:')) {
      return { action: 'read-route', routeName: surface.slice('read-route:'.length) };
    }
    return { action: surface };
  }

  async function writeSurfaceManifest(surface, index, extra = {}) {
    const runDir = path.join(rootDir, `x-${String(index).padStart(3, '0')}-${surface.replace(/[^a-z0-9]+/giu, '-')}`);
    await mkdir(runDir, { recursive: true });
    await writeFile(path.join(runDir, 'manifest.json'), `${JSON.stringify({
      siteKey: 'x',
      generatedAt: new Date(Date.UTC(2026, 3, 26, 0, 0, index)).toISOString(),
      plan: planForSurface(surface),
      outcome: { ok: true, status: 'passed', reason: null },
      completeness: { itemCount: 0, userCount: 0, mediaCount: 0 },
      archive: { pages: 0, capture: null },
      ...extra,
    }, null, 2)}\n`, 'utf8');
  }

  await writeSurfaceManifest('account-info', 1, {
    readCrawl: {
      requested: true,
      maxPages: 1,
      maxDepth: 0,
      visitedCount: 1,
      queuedCount: 0,
      pendingQueueCount: 0,
      exhausted: true,
      pages: [{
        depth: 0,
        requestedRouteTemplate: '/:account',
        routeTemplate: '/:account',
        routeSample: {
          routeTemplate: '/:account',
          pathDepth: 1,
          dynamicSegmentCount: 1,
          segmentShapes: [{ kind: 'account', valueLength: 6, valueClass: 'handle-like' }],
          queryKeys: [],
          queryValueShapes: [],
        },
        status: 'passed',
        readRouteTemplates: [],
        functionKinds: ['navigation.profile'],
        executionClasses: ['read-navigation-probe'],
      }],
    },
  });

  const seedReport = await buildReport(parseReportArgs(['--runs-root', rootDir, '--site', 'x', '--no-write']));
  for (const [index, surface] of seedReport.coverage.x.missingExpectedSurfaces.entries()) {
    await writeSurfaceManifest(surface, index + 2);
  }

  const report = await buildReport(parseReportArgs(['--runs-root', rootDir, '--site', 'x', '--no-write']));
  assert.equal(report.coverage.x.fullSiteBoundary.controlledScopeClosureReady, true);
  assert.equal(report.coverage.x.fullSiteBoundary.fullSiteExhaustiveClaim, false);
  assert.equal(report.coverage.x.fullSiteBoundary.nextEvidence, 'expand-specific-dynamic-route-families-with-user-approved-seeds');
  assert.equal(report.coverage.x.fullSiteBoundary.dynamicSeedExpansionRequiresUserApproval, true);
  assert.equal(report.coverage.x.dynamicSeedExpansion.scope, 'specific-dynamic-route-family-seed-expansion');
  assert.equal(report.coverage.x.dynamicSeedExpansion.userApprovalRequired, true);
  assert.equal(report.coverage.x.dynamicSeedExpansion.candidateCount > 0, true);
  const accountCandidate = report.coverage.x.dynamicSeedExpansion.candidates
    .find((entry) => entry.routeTemplate === '/:account');
  assert.equal(accountCandidate.familyKind, 'account-dynamic-route');
  assert.deepEqual(accountCandidate.parameters, ['account']);
  assert.equal(accountCandidate.surfaces.includes('account-info'), true);
  assert.equal(accountCandidate.surfaceCount >= 1, true);
  assert.equal(accountCandidate.seedEvidenceStatus, 'executed-dynamic-seed');
  assert.equal(accountCandidate.nextEvidence, 'provide-user-approved-concrete-seed-values-for-this-route-family');
});

test('social-live-report prefers API evidence when merging equal-status surface runs', async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'bwk-social-report-merge-api-evidence-'));
  t.after(() => rm(rootDir, { recursive: true, force: true }));

  async function writeExploreManifest(name, generatedAt, reason, apiPages, responseCount, operations = []) {
    const runDir = path.join(rootDir, name);
    await mkdir(runDir, { recursive: true });
    await writeFile(path.join(runDir, 'manifest.json'), `${JSON.stringify({
      siteKey: 'x',
      generatedAt,
      plan: {
        action: 'read-route',
        routeName: 'explore',
        routePath: '/explore',
        url: 'https://x.com/explore',
        contentType: 'posts',
      },
      outcome: { ok: true, status: 'degraded', reason },
      completeness: {
        apiPages,
        itemCount: apiPages ? 1 : 0,
        userCount: 0,
        mediaCount: 0,
      },
      archive: {
        pages: apiPages,
        capture: {
          requestCount: 2,
          responseCount,
          parsedResponseCount: apiPages ? 1 : 0,
          operations,
          samples: operations.map((operationName) => ({ operationName, itemCount: 1, userCount: 0, hasNextCursor: false })),
        },
      },
    }, null, 2)}\n`, 'utf8');
  }

  await writeExploreManifest('explore-no-seed', '2026-04-26T00:02:00.000Z', 'no-api-seed-captured', 0, 0);
  await writeExploreManifest('explore-api-seed', '2026-04-26T00:03:00.000Z', 'api-seed-only', 1, 2, ['ExplorePage', 'ExploreSidebar']);

  const report = await buildReport(parseReportArgs(['--runs-root', rootDir, '--site', 'x', '--no-write']));
  const row = report.coverage.x.surfaceRows.find((entry) => entry.surface === 'read-route:explore');
  assert.equal(row.reason, 'api-seed-only');
  assert.equal(row.apiPages, 1);
  assert.equal(row.apiResponseCount, 2);
  assert.deepEqual(row.operations, ['ExplorePage', 'ExploreSidebar']);
  assert.deepEqual(row.targetOperations, ['ExplorePage', 'ExploreSidebar']);
});

test('social-live-report counts X read-route surfaces as planned app route coverage', async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'bwk-social-report-read-route-'));
  t.after(() => rm(rootDir, { recursive: true, force: true }));

  const runDir = path.join(rootDir, 'x-read-route-home');
  await mkdir(runDir, { recursive: true });
  await writeFile(path.join(runDir, 'manifest.json'), `${JSON.stringify({
    siteKey: 'x',
    generatedAt: '2026-04-26T00:02:00.000Z',
    plan: {
      action: 'read-route',
      routeName: 'home',
      routePath: '/home',
      url: 'https://x.com/home',
      contentType: 'posts',
    },
    outcome: { ok: true, status: 'passed', reason: null },
    completeness: {
      apiPages: 0,
      dedupedItemCount: 0,
      userCount: 0,
      mediaCount: 0,
    },
    surfaceInventory: {
      urlRouteTemplate: '/home',
      linkCount: 4,
      controlCount: 2,
      formCount: 0,
      linkRoutes: [
        { kind: 'app-section', routeTemplate: '/explore', count: 1 },
        { kind: 'profile', routeTemplate: '/private-account-handle', count: 1 },
      ],
      controls: [
        { role: 'link', labelKind: 'home', routeTemplate: '/home', count: 1 },
      ],
      forms: [],
    },
    readCrawl: {
      requested: true,
      maxPages: 2,
      maxDepth: 1,
      visitedCount: 1,
      queuedCount: 2,
      pendingQueueCount: 1,
      exhausted: false,
      discoveredRouteTemplates: ['/home', '/explore'],
      functionKinds: ['navigation.app-section'],
      executionClasses: ['read-navigation-probe'],
      blockedRouteCount: 0,
      blockedFunctions: [],
      api: {
        responseCount: 1,
        operations: ['HomeTimeline', 'PinnedTimelines', 'fleetline'],
      },
      pages: [{
        depth: 0,
        requestedRouteTemplate: '/home',
        routeTemplate: '/home',
        status: 'passed',
        linkCount: 4,
        controlCount: 2,
        candidateCount: 1,
        readCandidateCount: 1,
        blockedCandidateCount: 0,
        readRouteTemplates: ['/explore'],
        functionKinds: ['navigation.app-section'],
        executionClasses: ['read-navigation-probe'],
      }],
    },
  }, null, 2)}\n`, 'utf8');

  const report = await buildReport(parseReportArgs([
    '--runs-root',
    rootDir,
    '--site',
    'x',
    '--no-write',
  ]));

  assert.equal(report.coverage.x.plannedSurfaceCount, 117);
  assert.equal(report.coverage.x.coveredPlannedSurfaceCount, 1);
  assert.equal(report.coverage.x.missingExpectedSurfaces.includes('read-route:grok'), true);
  assert.deepEqual(report.coverage.x.routeTemplates, ['/home']);
  assert.deepEqual(report.coverage.x.capabilities, ['app.home.inspect']);
  assert.deepEqual(report.coverage.x.intents, ['inspect_home_timeline']);
  assert.equal(report.coverage.x.discovery.plannedCapabilities.includes('app.home.inspect'), true);
  assert.equal(report.coverage.x.discovery.readExecutableFunctionKinds.includes('navigation.app-section'), true);
  const homeRow = report.coverage.x.surfaceRows.find((row) => row.surface === 'read-route:home');
  assert.equal(homeRow.routeTemplate, '/home');
  assert.equal(homeRow.capability, 'app.home.inspect');
  assert.deepEqual(homeRow.targetOperations, ['HomeTimeline', 'PinnedTimelines', 'fleetline']);
});

test('social-live-report does not keep generic route sample gaps when a sampled static specialization covers them', async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'bwk-social-report-specific-route-sample-'));
  t.after(() => rm(rootDir, { recursive: true, force: true }));

  const runDir = path.join(rootDir, 'x-specific-route-sample');
  await mkdir(runDir, { recursive: true });
  const accountSample = {
    routeTemplate: '/:account/communities/explore',
    pathDepth: 3,
    dynamicSegmentCount: 1,
    segmentShapes: [
      { kind: 'account', valueLength: 6, valueClass: 'handle-like' },
      { kind: 'static', value: 'communities' },
      { kind: 'static', value: 'explore' },
    ],
    queryKeys: [],
    queryValueShapes: [],
  };
  const settingsLocationSample = {
    routeTemplate: '/settings/explore/location',
    pathDepth: 3,
    dynamicSegmentCount: 0,
    segmentShapes: [
      { kind: 'static', value: 'settings' },
      { kind: 'static', value: 'explore' },
      { kind: 'static', value: 'location' },
    ],
    queryKeys: [],
    queryValueShapes: [],
  };
  const searchSample = {
    routeTemplate: '/search?q=:query&src=:src',
    pathDepth: 1,
    dynamicSegmentCount: 0,
    segmentShapes: [
      { kind: 'static', value: 'search' },
    ],
    queryKeys: ['q', 'src'],
    queryValueShapes: [],
  };
  await writeFile(path.join(runDir, 'manifest.json'), `${JSON.stringify({
    siteKey: 'x',
    generatedAt: '2026-04-26T00:02:00.000Z',
    ok: true,
    plan: {
      action: 'account-info',
      account: ':account',
      url: 'https://x.com/:account',
    },
    readCrawl: {
      requested: true,
      maxPages: 3,
      maxDepth: 2,
      visitedCount: 3,
      queuedCount: 3,
      exhausted: true,
      blockedFunctions: [
        {
          routeTemplate: '/compose/:segment',
          functionKind: 'compose.post',
          intent: 'create_post',
          executionClass: 'mutation-blocked',
          mutationRisk: 'content-write',
          count: 1,
        },
      ],
      pages: [
        {
          depth: 0,
          routeTemplate: '/:account',
          status: 'passed',
          readRouteTemplates: [
            '/:account/:segment/explore',
            '/:account/communities/explore',
            '/settings/explore/:segment',
            '/settings/explore/location',
            '/search',
            '/search?q=:query&src=:src',
          ],
          readRouteSamples: [accountSample, settingsLocationSample, searchSample],
          functionKinds: ['navigation.profile'],
          executionClasses: ['read-navigation-probe'],
        },
        {
          depth: 1,
          requestedRouteTemplate: '/:account/:segment/explore',
          routeTemplate: '/:account/:segment/explore',
          status: 'passed',
          readRouteTemplates: [],
          functionKinds: ['navigation.profile'],
          executionClasses: ['read-navigation-probe'],
        },
        {
          depth: 1,
          requestedRouteTemplate: '/:account/communities/explore',
          routeTemplate: '/:account/communities/explore',
          routeSample: accountSample,
          status: 'passed',
          readRouteTemplates: [],
          functionKinds: ['navigation.profile'],
          executionClasses: ['read-navigation-probe'],
        },
        {
          depth: 1,
          requestedRouteTemplate: '/settings/explore/location',
          routeTemplate: '/settings/explore/location',
          routeSample: settingsLocationSample,
          status: 'passed',
          readRouteTemplates: [],
          functionKinds: ['account.settings'],
          executionClasses: ['risk-reviewed-read-navigation'],
        },
        {
          depth: 1,
          requestedRouteTemplate: '/search?q=:query&src=:src',
          routeTemplate: '/search?q=:query&src=:src',
          routeSample: searchSample,
          status: 'passed',
          readRouteTemplates: [],
          functionKinds: ['search.results'],
          executionClasses: ['read-navigation-probe'],
        },
      ],
    },
  }, null, 2)}\n`, 'utf8');
  const searchRunDir = path.join(rootDir, 'x-planned-search-route-sample');
  await mkdir(searchRunDir, { recursive: true });
  await writeFile(path.join(searchRunDir, 'manifest.json'), `${JSON.stringify({
    siteKey: 'x',
    generatedAt: '2026-04-26T00:03:00.000Z',
    ok: true,
    plan: {
      action: 'read-route',
      routeName: 'search-top',
      routePath: '/search?q=fixture&src=typed_query',
      url: 'https://x.com/search?q=fixture&src=typed_query',
    },
    readCrawl: {
      requested: true,
      maxPages: 1,
      maxDepth: 0,
      visitedCount: 1,
      queuedCount: 0,
      exhausted: true,
      pages: [{
        depth: 0,
        requestedRouteTemplate: '/search?q=:query&src=:src',
        routeTemplate: '/search?q=:query&src=:src',
        routeSample: searchSample,
        status: 'passed',
        readRouteTemplates: [],
        functionKinds: ['search.results'],
        executionClasses: ['read-search-probe'],
      }],
    },
  }, null, 2)}\n`, 'utf8');

  const report = await buildReport(parseReportArgs(['--runs-root', rootDir, '--site', 'x', '--no-write']));
  const frontier = report.coverage.x.readCrawl.frontier;
  assert.equal(frontier.routeSamplelessRouteCount, 0);
  assert.equal(frontier.gapCount, 0);
  const genericRoute = frontier.routes.find((entry) => entry.routeTemplate === '/:account/:segment/explore');
  assert.equal(genericRoute.sampleCoverageStatus, 'sampled-specific-covered');
  assert.deepEqual(genericRoute.sampledSpecificRouteTemplates, ['/:account/communities/explore']);
  const genericSettingsRoute = frontier.routes.find((entry) => entry.routeTemplate === '/settings/explore/:segment');
  assert.equal(genericSettingsRoute.sampleCoverageStatus, 'sampled-specific-covered');
  assert.deepEqual(genericSettingsRoute.sampledSpecificRouteTemplates, ['/settings/explore/location']);
  assert.equal(frontier.unresolvedRoutes.includes('/settings/explore/:segment'), false);
  const genericSearchRoute = frontier.routes.find((entry) => entry.routeTemplate === '/search');
  assert.equal(genericSearchRoute.sampleCoverageStatus, 'sampled-specific-covered');
  assert.deepEqual(genericSearchRoute.sampledSpecificRouteTemplates, ['/search?q=:query&src=:src']);
  assert.equal(frontier.unresolvedRoutes.includes('/search'), false);
  assert.equal(report.coverage.x.readCrawl.closure.unresolvedCandidateOnlyRouteCount, 0);
  assert.deepEqual(report.coverage.x.readCrawl.closure.unresolvedCandidateOnlyRoutes, []);
  assert.equal(frontier.dynamicRouteFamilies.samplelessRouteTemplateCount, 0);
  assert.equal(frontier.dynamicRouteFamilies.parameterizedCoverageBoundary.readyForControlledScopeClosure, true);
  assert.equal(frontier.dynamicRouteFamilies.parameterizedCoverageBoundary.plannedSurfacePromotionRequired, false);
  assert.equal(frontier.decisionSummary.allFrontierRoutesClassified, true);
  assert.equal(frontier.decisionSummary.readyForControlledScopeClosure, true);
  assert.equal(frontier.decisionSummary.plannedSurfaceUpgradeCandidateCount, 1);
  assert.deepEqual(frontier.decisionSummary.plannedSurfaceUpgradeCandidates, ['/settings/explore/location']);
  assert.deepEqual(frontier.decisionSummary.byDecisionKind, [
    { decisionKind: 'covered-by-specific-route-template', count: 3 },
    { decisionKind: 'dynamic-family-parameterized', count: 1 },
    { decisionKind: 'stable-frontier-surface', count: 1 },
  ]);
  assert.deepEqual(
    frontier.decisions
      .map((entry) => [entry.routeTemplate, entry.decisionKind, entry.upgradeAction])
      .sort((left, right) => left[0].localeCompare(right[0])),
    [
      ['/:account/:segment/explore', 'covered-by-specific-route-template', 'do-not-promote'],
      ['/:account/communities/explore', 'dynamic-family-parameterized', 'keep-dynamic-family'],
      ['/search', 'covered-by-specific-route-template', 'do-not-promote'],
      ['/settings/explore/:segment', 'covered-by-specific-route-template', 'do-not-promote'],
      ['/settings/explore/location', 'stable-frontier-surface', 'promote-to-planned-surface'],
    ],
  );
  const accountBoundary = frontier.dynamicRouteFamilies.families
    .find((entry) => entry.familyKind === 'account-dynamic-route')
    .routeTemplateBoundaries[0];
  assert.deepEqual(
    [
      accountBoundary.routeTemplate,
      accountBoundary.sampleStatus,
      accountBoundary.closureDisposition,
      accountBoundary.plannedSurfacePromotionRequired,
      accountBoundary.nextEvidence,
    ],
    [
      '/:account/communities/explore',
      'sampled-parameterized-template',
      'keep-parameterized-family',
      false,
      null,
    ],
  );
});

test('social-live-report keeps dynamic family route samples beyond display-sized batches', async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'bwk-social-report-dynamic-samples-'));
  t.after(() => rm(rootDir, { recursive: true, force: true }));

  const runDir = path.join(rootDir, 'x-dynamic-family-samples');
  await mkdir(runDir, { recursive: true });
  const pages = Array.from({ length: 24 }, (_, index) => {
    const routeTemplate = index < 23 ? '/:account/:segment' : '/:account/:segment/:segment';
    return {
      depth: 1,
      requestedRouteTemplate: routeTemplate,
      routeTemplate,
      routeSample: {
        routeTemplate,
        pathDepth: index < 23 ? 2 : 3,
        dynamicSegmentCount: index < 23 ? 2 : 3,
        segmentShapes: index < 23
          ? [
              { kind: 'account', valueLength: 8, valueClass: 'handle-like' },
              { kind: 'segment', valueLength: index + 2, valueClass: 'handle-like' },
            ]
          : [
              { kind: 'account', valueLength: 8, valueClass: 'handle-like' },
              { kind: 'segment', valueLength: 5, valueClass: 'handle-like' },
              { kind: 'segment', valueLength: 9, valueClass: 'slug' },
            ],
        queryKeys: [],
        queryValueShapes: [],
      },
      status: 'passed',
      readRouteTemplates: [],
      functionKinds: ['navigation.profile'],
      executionClasses: ['read-navigation-probe'],
    };
  });
  await writeFile(path.join(runDir, 'manifest.json'), `${JSON.stringify({
    siteKey: 'x',
    generatedAt: '2026-04-26T00:04:00.000Z',
    ok: true,
    plan: {
      action: 'account-info',
      account: ':account',
      url: 'https://x.com/:account',
    },
    readCrawl: {
      requested: true,
      maxPages: pages.length,
      maxDepth: 1,
      visitedCount: pages.length,
      queuedCount: pages.length,
      exhausted: true,
      pages,
    },
  }, null, 2)}\n`, 'utf8');

  const report = await buildReport(parseReportArgs(['--runs-root', rootDir, '--site', 'x', '--no-write']));
  const family = report.coverage.x.readCrawl.frontier.dynamicRouteFamilies.families
    .find((entry) => entry.familyKind === 'account-dynamic-route');

  assert.equal(family.routeTemplateCount, 2);
  assert.equal(family.routeSamplelessRouteTemplateCount, 0);
  assert.equal(family.parameterizedCoverageBoundary.readyForControlledScopeClosure, true);
});

test('social-live-report preserves safe settings and notification structure route slugs', async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'bwk-social-report-structure-slugs-'));
  t.after(() => rm(rootDir, { recursive: true, force: true }));

  const runDir = path.join(rootDir, 'x-structure-slugs');
  await mkdir(runDir, { recursive: true });
  const settingsProfileSample = {
    routeTemplate: '/settings/account/profile',
    pathDepth: 3,
    dynamicSegmentCount: 0,
    segmentShapes: [
      { kind: 'static', value: 'settings' },
      { kind: 'static', value: 'account' },
      { kind: 'static', value: 'profile' },
    ],
    queryKeys: [],
    queryValueShapes: [],
  };
  const settingsAccountSample = {
    routeTemplate: '/settings/account',
    pathDepth: 2,
    dynamicSegmentCount: 0,
    segmentShapes: [
      { kind: 'static', value: 'settings' },
      { kind: 'static', value: 'account' },
    ],
    queryKeys: [],
    queryValueShapes: [],
  };
  const notificationsVerifiedSample = {
    routeTemplate: '/notifications/verified',
    pathDepth: 2,
    dynamicSegmentCount: 0,
    segmentShapes: [
      { kind: 'static', value: 'notifications' },
      { kind: 'static', value: 'verified' },
    ],
    queryKeys: [],
    queryValueShapes: [],
  };
  const composePostSample = {
    routeTemplate: '/compose/:segment',
    pathDepth: 2,
    dynamicSegmentCount: 1,
    segmentShapes: [
      { kind: 'static', value: 'compose' },
      { kind: 'segment', valueLength: 4, valueClass: 'handle-like' },
    ],
    queryKeys: [],
    queryValueShapes: [],
  };
  await writeFile(path.join(runDir, 'manifest.json'), `${JSON.stringify({
    siteKey: 'x',
    generatedAt: '2026-04-26T00:03:00.000Z',
    ok: true,
    plan: {
      action: 'read-route',
      routeName: 'settings-account',
      routePath: '/settings/account',
      url: 'https://x.com/settings/account',
    },
    readCrawl: {
      requested: true,
      maxPages: 3,
      maxDepth: 1,
      visitedCount: 3,
      queuedCount: 3,
      exhausted: true,
      pages: [
        {
          depth: 0,
          requestedRouteTemplate: '/settings/account',
          routeTemplate: '/settings/account',
          status: 'passed',
          readRouteTemplates: [
            '/settings/account',
            '/settings/account/profile',
            '/settings/:segment',
            '/notifications/verified',
            '/notifications/:segment',
            '/compose/:segment',
          ],
          readRouteSamples: [
            settingsAccountSample,
            settingsProfileSample,
            notificationsVerifiedSample,
            composePostSample,
            {
              routeTemplate: '/settings/:segment',
              pathDepth: 2,
              dynamicSegmentCount: 1,
              segmentShapes: [
                { kind: 'static', value: 'settings' },
                { kind: 'segment', valueLength: 7, valueClass: 'handle-like' },
              ],
              queryKeys: [],
              queryValueShapes: [],
            },
            {
              routeTemplate: '/notifications/:segment',
              pathDepth: 2,
              dynamicSegmentCount: 1,
              segmentShapes: [
                { kind: 'static', value: 'notifications' },
                { kind: 'segment', valueLength: 8, valueClass: 'handle-like' },
              ],
              queryKeys: [],
              queryValueShapes: [],
            },
          ],
          functionKinds: ['account.settings'],
          executionClasses: ['risk-reviewed-read-navigation'],
        },
        {
          depth: 1,
          requestedRouteTemplate: '/settings/account',
          routeTemplate: '/settings/account',
          routeSample: settingsAccountSample,
          status: 'passed',
          readRouteTemplates: [],
          functionKinds: ['account.settings'],
          executionClasses: ['risk-reviewed-read-navigation'],
        },
        {
          depth: 1,
          requestedRouteTemplate: '/settings/account/profile',
          routeTemplate: '/settings/account/profile',
          routeSample: settingsProfileSample,
          status: 'passed',
          readRouteTemplates: [],
          functionKinds: ['account.settings'],
          executionClasses: ['risk-reviewed-read-navigation'],
        },
        {
          depth: 1,
          requestedRouteTemplate: '/notifications/verified',
          routeTemplate: '/notifications/verified',
          routeSample: notificationsVerifiedSample,
          status: 'passed',
          readRouteTemplates: [],
          functionKinds: ['navigation.link'],
          executionClasses: ['read-navigation-probe'],
        },
      ],
    },
    outcome: { ok: true, status: 'passed', reason: null },
    completeness: { itemCount: 0, userCount: 0, mediaCount: 0 },
    archive: { pages: 0, capture: null },
  }, null, 2)}\n`, 'utf8');

  const report = await buildReport(parseReportArgs(['--runs-root', rootDir, '--site', 'x', '--no-write']));
  const routeTemplates = report.coverage.x.readCrawl.routeTemplateReplayCoverage.map((entry) => entry.routeTemplate);
  assert.equal(routeTemplates.includes('/settings/account/profile'), true);
  assert.equal(routeTemplates.includes('/settings/account/:segment'), false);
  assert.equal(routeTemplates.includes('/notifications/verified'), true);
  assert.equal(routeTemplates.includes('/notifications/:segment'), true);
  assert.equal(routeTemplates.includes('/compose/post'), true);
  assert.equal(routeTemplates.includes('/compose/:segment'), false);
  const frontier = report.coverage.x.readCrawl.frontier;
  const promoted = frontier.decisions.find((entry) => entry.routeTemplate === '/settings/account/profile');
  assert.equal(promoted.decisionKind, 'stable-frontier-surface');
  assert.equal(promoted.upgradeAction, 'promote-to-planned-surface');
  const genericSettings = frontier.decisions.find((entry) => entry.routeTemplate === '/settings/:segment');
  assert.equal(genericSettings.decisionKind, 'covered-by-specific-route-template');
  assert.equal(genericSettings.upgradeAction, 'do-not-promote');
  assert.equal(genericSettings.sampledSpecificRouteTemplates.includes('/settings/account'), true);
  const genericNotifications = frontier.decisions.find((entry) => entry.routeTemplate === '/notifications/:segment');
  assert.equal(genericNotifications.decisionKind, 'covered-by-specific-route-template');
  assert.equal(genericNotifications.upgradeAction, 'do-not-promote');
  assert.equal(genericNotifications.sampledSpecificRouteTemplates.includes('/notifications/verified'), true);
  const composePost = frontier.decisions.find((entry) => entry.routeTemplate === '/compose/post');
  assert.equal(composePost, undefined);
});

test('social action artifacts preserve promoted X settings route slugs', () => {
  const promotedSettingsRoutes = [
    '/compose/post',
    '/settings/contacts',
    '/settings/connected_accounts',
    '/settings/content_you_see',
    '/settings/data',
    '/settings/data_sharing_with_business_partners',
    '/settings/deactivate',
    '/settings/delegate',
    '/settings/direct_messages',
    '/settings/display',
    '/settings/download_your_data',
    '/settings/email_notifications',
    '/settings/languages',
    '/settings/location_information',
    '/settings/mute_and_block',
    '/settings/notifications/advanced_filters',
    '/settings/notifications/filters',
    '/settings/notifications/preferences',
    '/settings/off_twitter_activity',
    '/settings/push_notifications',
    '/i/jf/stories/home',
  ];

  for (const routePath of promotedSettingsRoutes) {
    const safePlan = safePlanForArtifact({
      siteKey: 'x',
      host: 'x.com',
      action: 'read-route',
      contentType: 'posts',
      routePath,
      url: `https://x.com${routePath}`,
    });
    assert.equal(safePlan.routePath, `https://x.com${routePath}`);
    assert.equal(safePlan.url, `https://x.com${routePath}`);
  }

  const statusDetailPlan = safePlanForArtifact({
    siteKey: 'x',
    host: 'x.com',
    action: 'read-route',
    contentType: 'posts',
    routePath: '/{account}/status/{statusId}',
    url: 'https://x.com/private-handle/status/123456789',
    account: 'private-handle',
    statusId: '123456789',
  });
  assert.equal(statusDetailPlan.routePath, 'https://x.com/:account/status/:id');
  assert.equal(statusDetailPlan.url, 'https://x.com/:account/status/:id');
});

test('social-live-report merges API and inventory evidence across repeated X surface runs', async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'bwk-social-report-merge-evidence-'));
  t.after(() => rm(rootDir, { recursive: true, force: true }));

  async function writeManifest(dirName, manifest) {
    const runDir = path.join(rootDir, dirName);
    await mkdir(runDir, { recursive: true });
    await writeFile(path.join(runDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  }

  const plan = {
    action: 'profile-content',
    account: 'private-account-handle',
    contentType: 'posts',
  };
  await writeManifest('x-profile-posts-api', {
    siteKey: 'x',
    generatedAt: '2026-04-26T00:00:00.000Z',
    plan,
    outcome: { ok: true, status: 'bounded', reason: 'max-api-pages' },
    completeness: {
      apiPages: 1,
      dedupedItemCount: 2,
      userCount: 0,
      mediaCount: 1,
    },
    archive: {
      capture: {
        requestCount: 2,
        responseCount: 1,
        parsedResponseCount: 1,
        operations: ['UserTweets'],
        samples: [
          { operationName: 'UserTweets', itemCount: 2, userCount: 0 },
        ],
      },
    },
  });
  await writeManifest('x-profile-posts-inventory', {
    siteKey: 'x',
    generatedAt: '2026-04-26T00:01:00.000Z',
    plan,
    outcome: { ok: true, status: 'passed', reason: null },
    completeness: {
      apiPages: 0,
      dedupedItemCount: 1,
      userCount: 0,
      mediaCount: 0,
    },
    surfaceInventory: {
      urlRouteTemplate: '/private-account-handle',
      linkCount: 2,
      controlCount: 3,
      formCount: 1,
      linkRoutes: [
        { kind: 'profile', routeTemplate: '/private-account-handle', count: 1 },
        { kind: 'content-detail', routeTemplate: '/private-account-handle/status/123456', count: 1 },
      ],
      controls: [
        { role: 'button', testId: '123456-follow', count: 1 },
        { role: 'button', testId: 'like', count: 1 },
        { role: 'button', count: 1 },
      ],
      anonymousControls: [
        {
          role: 'button',
          disabled: false,
          closestRole: 'article',
          inArticle: true,
          inDialog: false,
          inForm: false,
          closestLinkKind: 'profile',
          closestLinkRouteTemplate: '/private-account-handle',
          svgCount: 1,
          imageCount: 0,
          childElementCount: 1,
          count: 1,
        },
      ],
      forms: [
        { role: 'search', inputCount: 1, buttonCount: 0, actionRouteTemplate: '/search?q=private search query' },
      ],
    },
  });
  await writeManifest('x-profile-posts-inventory-latest-anonymous', {
    siteKey: 'x',
    generatedAt: '2026-04-26T00:02:00.000Z',
    plan,
    outcome: { ok: true, status: 'passed', reason: null },
    completeness: {
      apiPages: 0,
      dedupedItemCount: 1,
      userCount: 0,
      mediaCount: 0,
    },
    surfaceInventory: {
      urlRouteTemplate: '/private-account-handle',
      linkCount: 1,
      controlCount: 1,
      formCount: 0,
      controls: [
        { role: 'button', count: 1 },
      ],
      anonymousControls: [
        {
          role: 'button',
          disabled: false,
          closestRole: 'article',
          inArticle: true,
          inDialog: false,
          inForm: false,
          closestLinkKind: 'profile',
          closestLinkRouteTemplate: '/private-account-handle',
          svgCount: 1,
          imageCount: 0,
          childElementCount: 1,
          count: 1,
        },
      ],
    },
  });

  const report = await buildReport(parseReportArgs([
    '--runs-root',
    rootDir,
    '--site',
    'x',
    '--no-write',
  ]));

  const row = report.coverage.x.surfaceRows.find((entry) => entry.surface === 'profile-content:posts');
  assert.equal(row.status, 'passed');
  assert.equal(row.latestStatus, 'passed');
  assert.equal(row.apiPages, 1);
  assert.equal(row.itemCount, 2);
  assert.deepEqual(row.targetOperations, ['UserTweets']);
  assert.equal(row.surfaceInventory.observed, true);
  assert.equal(row.surfaceInventory.linkCount, 2);
  assert.equal(row.surfaceInventory.controlCount, 3);
  assert.equal(report.coverage.x.surfacesWithApiPages, 1);
  assert.equal(report.coverage.x.surfacesWithTargetOperations, 1);
  assert.equal(report.coverage.x.surfacesWithInventory, 1);
  assert.deepEqual(report.coverage.x.inventory.routeTemplates, ['/:account/status/:id', '/:account']);
  assert.equal(report.coverage.x.inventory.controlKeys.includes(':id-follow'), true);
  assert.equal(report.coverage.x.inventory.functionKinds.includes('relation.follow-toggle'), true);
  assert.equal(report.coverage.x.inventory.functionKinds.includes('engagement.like-toggle'), true);
  assert.equal(report.coverage.x.inventory.functionKinds.includes('interactive.unclassified-control'), true);
  assert.equal(report.coverage.x.inventory.executionClasses.includes('mutation-blocked'), true);
  assert.equal(report.coverage.x.inventory.executionClasses.includes('unknown-risk-blocked'), true);
  assert.equal(report.coverage.x.inventory.mutationRisks.includes('unknown-interaction-risk'), true);
  assert.equal(report.coverage.x.inventory.unknownRiskBlockedFunctionCount, 1);
  assert.equal(report.coverage.x.inventory.unknownRiskBlockedControlCount, 1);
  assert.deepEqual(
    report.coverage.x.inventory.unknownRiskBlockedControls.map((entry) => [
      entry.surface,
      entry.surfaceRouteTemplate,
      entry.role,
      entry.reason,
      entry.nextEvidence,
    ]),
    [
      [
        'profile-content:posts',
        '/:account',
        'button',
        'unlabeled-control-without-safe-function-classification',
        'capture-label-or-repeatable-testid-before-probing',
      ],
    ],
  );
  assert.equal(report.coverage.x.inventory.anonymousControlCount, 1);
  assert.deepEqual(
    report.coverage.x.inventory.anonymousControlsBySurface.map((entry) => [
      entry.surface,
      entry.surfaceRouteTemplate,
      entry.role,
      entry.inArticle,
      entry.closestLinkKind,
      entry.closestLinkRouteTemplate,
      entry.svgCount,
      entry.reason,
      entry.nextEvidence,
      entry.count,
    ]),
    [
      [
        'profile-content:posts',
        '/:account',
        'button',
        true,
        'profile',
        '/:account',
        1,
        'anonymous-control-without-stable-label-testid-or-route',
        'capture-label-testid-route-or-icon-signature-before-probing',
        1,
      ],
    ],
  );
  assert.equal(report.coverage.x.inventory.anonymousControls[0].role, 'button');
  assert.equal(report.coverage.x.inventory.anonymousControls[0].inArticle, true);
  assert.equal(report.coverage.x.inventory.anonymousControls[0].closestLinkKind, 'profile');
  assert.equal(report.coverage.x.inventory.anonymousControls[0].closestLinkRouteTemplate, '/:account');
  assert.equal(report.coverage.x.inventory.anonymousControls[0].svgCount, 1);
  assert.equal(report.coverage.x.inventory.routeCoverage.total, 2);
  assert.equal(report.coverage.x.inventory.routeCoverage.coveredCount, 1);
  assert.equal(report.coverage.x.inventory.routeCoverage.uncoveredCount, 1);
  assert.deepEqual(report.coverage.x.inventory.routeCoverage.uncoveredRoutes, ['/:account/status/:id']);
  assert.equal(JSON.stringify(report.coverage).includes('private-account-handle'), false);
  assert.equal(JSON.stringify(report.coverage).includes('123456-follow'), false);
  assert.equal(JSON.stringify(report.coverage).includes('private search query'), false);
});

test('social-live-report treats equivalent dynamic route parameter names as inventory-covered', async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'bwk-social-report-dynamic-inventory-routes-'));
  t.after(() => rm(rootDir, { recursive: true, force: true }));

  async function writeRouteManifest(dirName, routeName, routePath, linkRoutes = []) {
    const runDir = path.join(rootDir, dirName);
    await mkdir(runDir, { recursive: true });
    await writeFile(path.join(runDir, 'manifest.json'), `${JSON.stringify({
      runId: dirName,
      siteKey: 'x',
      generatedAt: '2026-04-26T00:00:00.000Z',
      plan: {
        siteKey: 'x',
        action: 'read-route',
        routeName,
        routePath,
        contentType: 'posts',
      },
      outcome: { ok: true, status: 'passed', reason: null },
      surfaceInventory: {
        urlRouteTemplate: routePath,
        linkCount: linkRoutes.length,
        linkRoutes,
      },
    }, null, 2)}\n`, 'utf8');
  }

  await writeRouteManifest('community-detail', 'community-detail', '/i/communities/{communityId}', [
    { kind: 'same-site-link', routeTemplate: '/i/communities/123456/about', count: 1 },
    { kind: 'same-site-link', routeTemplate: '/i/communities/open-source', count: 1 },
    { kind: 'same-site-link', routeTemplate: '/OpenAIDevs/about', count: 1 },
  ]);
  await writeRouteManifest('community-about', 'community-about', '/i/communities/{communityId}/about');

  const report = await buildReport(parseReportArgs([
    '--runs-root',
    rootDir,
    '--site',
    'x',
    '--no-write',
  ]));

  const routeCoverage = report.coverage.x.inventory.routeCoverage;
  const byRoute = new Map(routeCoverage.routes.map((entry) => [entry.routeTemplate, entry]));
  assert.equal(byRoute.get('/i/communities/:id/about').coverageStatus, 'covered');
  assert.equal(byRoute.get('/i/communities/:id/about').sampledRouteTemplate, '/i/communities/:communityid/about');
  assert.equal(byRoute.get('/i/communities/:segment').coverageStatus, 'covered');
  assert.equal(byRoute.get('/i/communities/:segment').sampledRouteTemplate, '/i/communities/:communityid');
  assert.deepEqual(routeCoverage.uncoveredRoutes, ['/:account/about']);
  assert.equal(report.coverage.x.fullSiteBoundary.inventoryRouteUncoveredCount, 1);
  assert.deepEqual(report.coverage.x.fullSiteBoundary.inventoryUncoveredRoutes, ['/:account/about']);
});

test('social-live-report lets deeper exhausted read-crawl supersede stale candidate-only routes', async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'bwk-social-report-stale-candidate-'));
  t.after(() => rm(rootDir, { recursive: true, force: true }));

  async function writeManifest(dirName, generatedAt, readCrawl) {
    const runDir = path.join(rootDir, dirName);
    await mkdir(runDir, { recursive: true });
    await writeFile(path.join(runDir, 'manifest.json'), `${JSON.stringify({
      siteKey: 'x',
      generatedAt,
      plan: {
        action: 'read-route',
        routeName: 'premium-sign-up',
        routePath: '/i/premium_sign_up',
        url: 'https://x.com/i/premium_sign_up',
        contentType: 'posts',
      },
      outcome: { ok: true, status: 'passed', reason: null },
      completeness: {
        apiPages: 0,
        dedupedItemCount: 0,
        userCount: 0,
        mediaCount: 0,
      },
      readCrawl,
    }, null, 2)}\n`, 'utf8');
  }

  const staleRoute = '/:account/:segment/:segment/:segment/:segment/:segment/:segment';
  await writeManifest('premium-depth1', '2026-04-26T00:00:00.000Z', {
    requested: true,
    maxPages: 10,
    maxDepth: 1,
    visitedCount: 2,
    queuedCount: 2,
    pendingQueueCount: 0,
    exhausted: true,
    discoveredRouteTemplates: ['/i/premium_sign_up', staleRoute],
    pages: [{
      depth: 1,
      requestedRouteTemplate: '/:account',
      routeTemplate: '/:account/:segment',
      status: 'passed',
      readRouteTemplates: [staleRoute],
      readRouteSamples: [{
        routeTemplate: staleRoute,
        pathDepth: 7,
        dynamicSegmentCount: 7,
        segmentShapes: [
          { kind: 'account', valueLength: 7, valueClass: 'handle-like' },
          { kind: 'segment', valueLength: 3, valueClass: 'handle-like' },
          { kind: 'segment', valueLength: 13, valueClass: 'slug' },
          { kind: 'segment', valueLength: 34, valueClass: 'slug' },
          { kind: 'segment', valueLength: 28, valueClass: 'slug' },
          { kind: 'segment', valueLength: 2, valueClass: 'handle-like' },
          { kind: 'segment', valueLength: 32, valueClass: 'mixed' },
        ],
        queryKeys: [],
        queryValueShapes: [],
      }],
      functionKinds: ['navigation.link'],
      executionClasses: ['read-navigation-probe'],
    }],
  });
  await writeManifest('premium-depth2', '2026-04-26T00:01:00.000Z', {
    requested: true,
    maxPages: 20,
    maxDepth: 2,
    visitedCount: 3,
    queuedCount: 3,
    pendingQueueCount: 0,
    exhausted: true,
    discoveredRouteTemplates: ['/i/premium_sign_up', '/:account'],
    pages: [{
      depth: 0,
      requestedRouteTemplate: '/i/premium_sign_up',
      routeTemplate: '/i/premium_sign_up',
      status: 'passed',
      readRouteTemplates: ['/:account'],
      readRouteSamples: [{
        routeTemplate: '/:account',
        pathDepth: 1,
        dynamicSegmentCount: 1,
        segmentShapes: [
          { kind: 'account', valueLength: 8, valueClass: 'handle-like' },
        ],
        queryKeys: [],
        queryValueShapes: [],
      }],
      functionKinds: ['navigation.profile'],
      executionClasses: ['read-navigation-probe'],
    }],
  });

  const report = await buildReport(parseReportArgs(['--runs-root', rootDir, '--site', 'x', '--no-write']));
  const row = report.coverage.x.surfaceRows.find((entry) => entry.surface === 'read-route:premium-sign-up');

  assert.equal(row.readCrawl.maxDepth, 2);
  assert.equal(row.readCrawl.discoveredRouteTemplates.includes(staleRoute), false);
  assert.equal(row.readCrawl.routeTemplateReplayCoverage.some((entry) => entry.routeTemplate === staleRoute), false);
  assert.equal(report.coverage.x.readCrawl.frontier.unresolvedRoutes.includes(staleRoute), false);
});

test('social-live-report classifies anonymous settings buttons as blocked settings controls', async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'bwk-social-report-settings-control-'));
  t.after(() => rm(rootDir, { recursive: true, force: true }));

  const runDir = path.join(rootDir, 'x-settings-grok');
  await mkdir(runDir, { recursive: true });
  await writeFile(path.join(runDir, 'manifest.json'), `${JSON.stringify({
    siteKey: 'x',
    generatedAt: '2026-04-26T00:00:00.000Z',
    plan: {
      action: 'read-route',
      routePath: 'https://x.com/settings/grok_settings',
      url: 'https://x.com/settings/grok_settings',
    },
    outcome: { ok: true, status: 'passed', reason: null },
    completeness: {
      apiPages: 0,
      dedupedItemCount: 0,
      userCount: 0,
      mediaCount: 0,
    },
    surfaceInventory: {
      urlRouteTemplate: '/settings/grok_settings',
      linkCount: 0,
      controlCount: 1,
      formCount: 0,
      controls: [
        {
          role: 'button',
          functionKind: 'interactive.unclassified-control',
          intent: 'inspect_unclassified_interactive_control',
          executionClass: 'unknown-risk-blocked',
          mutationRisk: 'unknown-interaction-risk',
          count: 1,
        },
      ],
    },
  }, null, 2)}\n`, 'utf8');

  const report = await buildReport(parseReportArgs([
    '--runs-root',
    rootDir,
    '--site',
    'x',
    '--no-write',
  ]));

  assert.equal(report.coverage.x.inventory.functionKinds.includes('interactive.unclassified-control'), false);
  assert.equal(report.coverage.x.inventory.functionKinds.includes('account.settings'), true);
  assert.equal(report.coverage.x.inventory.executionClasses.includes('unknown-risk-blocked'), false);
  assert.equal(report.coverage.x.inventory.executionClasses.includes('side-effect-risk-blocked'), true);
  assert.equal(report.coverage.x.inventory.mutationRisks.includes('account-write-risk'), true);
  assert.equal(report.coverage.x.inventory.unknownRiskBlockedControlCount, 0);
  assert.deepEqual(report.coverage.x.inventory.unknownRiskBlockedControls, []);
});

test('social-live-report preserves private-content read-route risk classifications', async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'bwk-social-report-private-content-risk-'));
  t.after(() => rm(rootDir, { recursive: true, force: true }));

  const runDir = path.join(rootDir, 'x-private-content-route');
  await mkdir(runDir, { recursive: true });
  await writeFile(path.join(runDir, 'manifest.json'), `${JSON.stringify({
    siteKey: 'x',
    generatedAt: '2026-04-26T00:00:00.000Z',
    plan: {
      action: 'read-route',
      routePath: '/settings/data',
      routeName: 'settings-data',
      url: 'https://x.com/settings/data',
    },
    outcome: { ok: true, status: 'degraded', reason: 'private-content-risk' },
    surfaceInventory: {
      urlRouteTemplate: '/settings/data',
      controls: [
        {
          role: 'link',
          routeTemplate: '/settings/data/:segment',
          functionKind: 'navigation.link',
          intent: 'navigate_read_surface',
          executionClass: 'unknown-risk-blocked',
          mutationRisk: 'private-content-risk',
          count: 1,
        },
      ],
    },
  }, null, 2)}\n`, 'utf8');

  const report = await buildReport(parseReportArgs([
    '--runs-root',
    rootDir,
    '--site',
    'x',
    '--no-write',
  ]));

  assert.equal(report.coverage.x.inventory.functionKinds.includes('navigation.link'), true);
  assert.equal(report.coverage.x.inventory.executionClasses.includes('unknown-risk-blocked'), true);
  assert.equal(report.coverage.x.inventory.mutationRisks.includes('private-content-risk'), true);
});

test('social-live-report surfaces social action session gate summaries', async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'bwk-social-report-session-gate-'));
  t.after(() => rm(rootDir, { recursive: true, force: true }));

  const runDir = path.join(rootDir, 'x-action-run');
  const blockedRunDir = path.join(rootDir, 'x-blocked-action-run');
  await mkdir(runDir, { recursive: true });
  await mkdir(blockedRunDir, { recursive: true });
  await writeFile(path.join(runDir, 'manifest.json'), `${JSON.stringify({
    runId: 'x-action-run',
    siteKey: 'x',
    status: 'passed',
    reason: 'completed',
    sessionProvider: 'unified-session-runner',
    sessionGate: {
      ok: true,
      status: 'passed',
      reason: 'unified-session-health-manifest',
      provider: 'unified-session-runner',
      healthManifest: path.join(rootDir, 'session', 'manifest.json'),
    },
    generatedAt: '2026-04-26T00:00:00.000Z',
  }, null, 2)}\n`, 'utf8');
  await writeFile(path.join(blockedRunDir, 'manifest.json'), `${JSON.stringify({
    runId: 'x-blocked-action-run',
    siteKey: 'x',
    status: 'blocked',
    reason: 'login-required',
    plan: {
      siteKey: 'x',
      action: 'profile-followers',
      account: 'OpenAIDevs',
    },
    sessionProvider: 'unified-session-runner',
    sessionGate: {
      ok: false,
      status: 'blocked',
      reason: 'login-required',
      provider: 'unified-session-runner',
      healthManifest: null,
    },
    generatedAt: '2026-04-26T00:01:00.000Z',
  }, null, 2)}\n`, 'utf8');

  const outDir = path.join(rootDir, 'report');
  const report = await buildReport(parseReportArgs(['--runs-root', rootDir, '--out-dir', outDir]));
  const outputs = await writeReport(parseReportArgs(['--runs-root', rootDir, '--out-dir', outDir]), report);
  const markdown = await readFile(outputs.markdownPath, 'utf8');

  assert.equal(report.totalRows, 2);
  const passedRow = report.rows.find((row) => row.id === 'x-action-run');
  const blockedRow = report.rows.find((row) => row.id === 'x-blocked-action-run');
  assert.equal(passedRow.sessionGate.status, 'passed');
  assert.equal(passedRow.sessionGate.reason, 'unified-session-health-manifest');
  assert.equal(passedRow.sessionRepairPlan, undefined);
  assert.equal(blockedRow.sessionGate.status, 'blocked');
  assert.equal(blockedRow.sessionRepairPlan.command, 'siteforge-build');
  assert.match(blockedRow.sessionRepairPlan.commandText, /siteforge build <url>/u);
  assert.equal(report.summary.x.sessionGates.passed, 1);
  assert.equal(report.summary.x.sessionGates.blocked, 1);
  assert.equal(report.coverage.x.sessionAuthBoundary.activeAuthBlocker, true);
  assert.equal(report.coverage.x.fullSiteBoundary.activeAuthBlocker, true);
  assert.equal(report.coverage.x.fullSiteBoundary.authBlockedRunCount, 1);
  assert.deepEqual(report.coverage.x.fullSiteBoundary.authBlockedSurfaces, ['profile-followers']);
  assert.equal(report.coverage.x.fullSiteBoundary.nextEvidence, 'restore-authentication-then-close-pending-planned-surface-queues');
  assert.match(markdown, /Session Gate/u);
  assert.match(markdown, /passed \(unified-session-health-manifest\)/u);
  assert.match(markdown, /full-site auth boundary: active yes/u);
  assert.match(markdown, /Repair Plan/u);
  assert.match(markdown, /siteforge build <url>/u);
});

test('social-live-report surfaces state-only started runs as stale when no process owns them', async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'bwk-social-report-stale-'));
  t.after(() => rm(rootDir, { recursive: true, force: true }));

  const runDir = path.join(rootDir, 'instagram-stale-run');
  await mkdir(runDir, { recursive: true });
  await writeFile(path.join(runDir, 'state.json'), `${JSON.stringify({
    status: 'started',
    startedAt: '2026-04-26T00:00:00.000Z',
    updatedAt: '2026-04-26T00:00:00.000Z',
    siteKey: 'instagram',
    plan: { siteKey: 'instagram', action: 'followed-users', account: 'me' },
    artifacts: { runDir },
  }, null, 2)}\n`, 'utf8');

  const options = parseReportArgs(['--runs-root', rootDir, '--no-write']);
  options.activeProcessCommandLines = /** @type {any[]} */ ([]);
  const report = await buildReport(options);

  assert.equal(report.totalRows, 1);
  assert.equal(report.rows[0].site, 'instagram');
  assert.equal(report.rows[0].status, 'stale');
  assert.equal(report.rows[0].reason, 'process-missing');
  assert.equal(report.summary.instagram.statuses.stale, 1);
});

test('social-live-report keeps state-only started runs active when a process owns them', async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'bwk-social-report-active-'));
  t.after(() => rm(rootDir, { recursive: true, force: true }));

  const runDir = path.join(rootDir, 'instagram-active-run');
  await mkdir(runDir, { recursive: true });
  await writeFile(path.join(runDir, 'state.json'), `${JSON.stringify({
    status: 'started',
    startedAt: '2026-04-26T00:00:00.000Z',
    updatedAt: '2026-04-26T00:00:00.000Z',
    siteKey: 'instagram',
    plan: { siteKey: 'instagram', action: 'followed-users', account: 'me' },
    artifacts: { runDir },
  }, null, 2)}\n`, 'utf8');

  const options = parseReportArgs(['--runs-root', rootDir, '--no-write']);
  options.activeProcessCommandLines = [`node src/entrypoints/sites/instagram-action.mjs followed-users me --run-dir "${runDir}"`];
  const report = await buildReport(options);

  assert.equal(report.totalRows, 1);
  assert.equal(report.rows[0].site, 'instagram');
  assert.equal(report.rows[0].status, 'running');
  assert.equal(report.rows[0].reason, 'process-active');
  assert.equal(report.summary.instagram.statuses.running, 1);
});

test('social-live-resume honors cooldown and max-attempts from manifests', async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'bwk-social-resume-'));
  t.after(() => rm(rootDir, { recursive: true, force: true }));
  const manifestPath = path.join(rootDir, 'manifest.json');
  await writeFile(manifestPath, `${JSON.stringify({
    runId: 'run-1',
    results: [{
      id: 'x-full-archive',
      site: 'x',
      status: 'passed',
      command: 'node src/entrypoints/sites/x-action.mjs full-archive openai --run-dir runs/x',
      finishedAt: '2026-04-26T00:00:00.000Z',
      artifactSummary: {
        verdict: 'passed',
        reason: 'max-items',
        archive: { complete: false, reason: 'max-items' },
      },
    }],
  }, null, 2)}\n`, 'utf8');

  const cooling = await buildResumePlan(parseResumeArgs([
    '--state',
    manifestPath,
    '--cooldown-minutes',
    '30',
    '--max-attempts',
    '3',
  ]), new Date('2026-04-26T00:10:00.000Z'));
  assert.equal(cooling.candidates[0].ready, false);
  assert.equal(cooling.candidates[0].blockedReason, 'cooldown');

  const ready = await buildResumePlan(parseResumeArgs([
    '--state',
    manifestPath,
    '--cooldown-minutes',
    '5',
    '--max-attempts',
    '3',
  ]), new Date('2026-04-26T00:10:00.000Z'));
  assert.equal(ready.candidates[0].ready, true);
  assert.match(ready.candidates[0].resumeCommand, /full-archive openai/u);
  assert.match(ready.candidates[0].resumeCommand, /--session-health-plan/u);

  const blocked = await buildResumePlan(parseResumeArgs([
    '--state',
    manifestPath,
    '--cooldown-minutes',
    '0',
    '--max-attempts',
    '1',
  ]), new Date('2026-04-26T00:10:00.000Z'));
  assert.equal(blocked.candidates[0].ready, false);
  assert.equal(blocked.candidates[0].blockedReason, 'max-attempts');
});

test('social-live-resume preserves explicit session manifest resume commands', async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'bwk-social-resume-manifest-'));
  t.after(() => rm(rootDir, { recursive: true, force: true }));
  const manifestPath = path.join(rootDir, 'manifest.json');
  await writeFile(manifestPath, `${JSON.stringify({
    runId: 'run-1',
    results: [{
      id: 'instagram-full-archive',
      site: 'instagram',
      status: 'passed',
      command: 'node src/entrypoints/sites/instagram-action.mjs full-archive instagram --run-dir runs/ig --session-manifest runs/session/instagram/manifest.json',
      finishedAt: '2026-04-26T00:00:00.000Z',
      artifactSummary: {
        verdict: 'passed',
        reason: 'max-items',
        archive: { complete: false, reason: 'max-items' },
      },
    }],
  }, null, 2)}\n`, 'utf8');

  const plan = await buildResumePlan(parseResumeArgs([
    '--state',
    manifestPath,
    '--site',
    'instagram',
    '--cooldown-minutes',
    '0',
    '--max-attempts',
    '3',
  ]), new Date('2026-04-26T00:10:00.000Z'));

  assert.match(plan.candidates[0].resumeCommand, /--session-manifest runs\/session\/instagram\/manifest\.json/u);
  assert.doesNotMatch(plan.candidates[0].resumeCommand, /--session-health-plan/u);
});
