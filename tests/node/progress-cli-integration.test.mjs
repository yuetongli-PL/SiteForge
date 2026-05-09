import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

import { parseArgs as parseDownloadArgs } from '../../src/entrypoints/sites/download.mjs';
import { parseCliArgs as parseDoctorArgs } from '../../src/entrypoints/sites/site-doctor.mjs';
import { resolveCliDispatch } from '../../src/entrypoints/cli.mjs';
import { parseCliArgs as parseBuildArgs } from '../../src/entrypoints/pipeline/run-pipeline.mjs';
import { parseCliArgs as parseCaptureArgs } from '../../src/pipeline/stages/capture.mjs';
import { parseCliArgs as parseExpandArgs } from '../../src/pipeline/stages/expand.mjs';
import { parseCliArgs as parseCollectContentArgs } from '../../src/pipeline/stages/collect-content.mjs';
import { parseCliArgs as parseAnalyzeArgs } from '../../src/pipeline/stages/analyze.mjs';
import { parseCliArgs as parseAbstractArgs } from '../../src/pipeline/stages/abstract.mjs';
import { parseCliArgs as parseNlArgs } from '../../src/pipeline/stages/nl.mjs';
import { parseCliArgs as parseDocsArgs } from '../../src/pipeline/stages/docs.mjs';
import { parseCliArgs as parseGovernanceArgs } from '../../src/pipeline/stages/governance.mjs';
import { parseCliArgs as parseKbArgs } from '../../src/pipeline/stages/kb/index.mjs';
import { parseCliArgs as parseSiteLoginArgs } from '../../src/entrypoints/sites/site-login.mjs';
import { parseCliArgs as parseSiteKeepaliveArgs } from '../../src/entrypoints/sites/site-keepalive.mjs';
import { parseCliArgs as parseNlSiteLoginArgs } from '../../src/entrypoints/sites/nl-site-login.mjs';
import { parseArgs as parseSessionArgs, main as sessionMain } from '../../src/entrypoints/sites/session.mjs';
import { parseArgs as parseSessionRepairArgs } from '../../src/entrypoints/sites/session-repair-plan.mjs';
import { parseCliArgs as parseBilibiliActionArgs } from '../../src/entrypoints/sites/bilibili-action.mjs';
import { parseDouyinActionArgs } from '../../src/entrypoints/sites/douyin-action.mjs';
import { parseXiaohongshuActionArgs } from '../../src/entrypoints/sites/xiaohongshu-action.mjs';
import { parseArgs as parseJableRankingArgs } from '../../src/entrypoints/sites/jable-ranking.mjs';
import { parseArgs as parseJpAvCatalogArgs } from '../../src/entrypoints/sites/jp-av-release-catalog.mjs';
import { parseArgs as parseMoodyzCatalogArgs } from '../../src/entrypoints/sites/moodyz-month-catalog.mjs';
import { parseCliArgs as parseSiteCredentialsArgs } from '../../src/entrypoints/sites/site-credentials.mjs';
import { parseCliArgs as parseSiteScaffoldArgs } from '../../src/entrypoints/sites/site-scaffold.mjs';
import { parseCliArgs as parseBilibiliOpenPageArgs } from '../../src/entrypoints/sites/bilibili-open-page.mjs';
import { parseArgs as parseBilibiliExtractLinksArgs } from '../../src/entrypoints/sites/bilibili-extract-links.mjs';
import { parseArgs as parseSocialAuthImportArgs } from '../../src/entrypoints/sites/social-auth-import.mjs';
import { parseCliArgs as parseGenerateCrawlerScriptArgs } from '../../src/entrypoints/pipeline/generate-crawler-script.mjs';
import { parseArgs as parseDouyinExportCookiesArgs } from '../../src/entrypoints/sites/douyin-export-cookies.mjs';
import { parseSocialActionArgs } from '../../src/sites/social/actions/router.mjs';
import { parseDouyinFollowQueryArgs } from '../../src/sites/douyin/queries/follow-query.mjs';
import { parseDouyinMediaResolverArgs } from '../../src/sites/douyin/queries/media-resolver.mjs';
import { parseArgs as parseSocialLiveVerifyArgs } from '../../scripts/social-live-verify.mjs';
import { parseArgs as parseSocialKbRefreshArgs } from '../../scripts/social-kb-refresh.mjs';
import { parseArgs as parseSocialLiveResumeArgs } from '../../scripts/social-live-resume.mjs';
import { parseArgs as parseSocialLiveReportArgs } from '../../tools/social-live-report-core.mjs';
import { parseArgs as parseSocialLiveDashboardArgs } from '../../scripts/social-live-dashboard.mjs';
import { parseArgs as parseSocialAuthRecoverArgs } from '../../scripts/social-auth-recover.mjs';
import { parseArgs as parseSocialHealthWatchArgs } from '../../scripts/social-health-watch.mjs';
import { parseArgs as parseSocialCommandTemplatesArgs } from '../../scripts/social-command-templates.mjs';
import {
  runSingleStageCliWithProgress,
  stripProgressCliOptions,
} from '../../src/infra/cli/progress-cli.mjs';
import {
  siteCapabilityCompileCommand,
  unifiedCliArgsForScript,
} from '../../src/infra/cli/command-map.mjs';

function createStream({ isTTY = false, columns = 80 } = {}) {
  let output = '';
  return {
    isTTY,
    columns,
    write(chunk, _encoding, callback) {
      output += String(chunk);
      if (typeof callback === 'function') callback();
      return true;
    },
    output() {
      return output;
    },
  };
}

test('download --json and --plan-json keep stdout machine-readable and suppress progress', async () => {
  const result = spawnSync(
    process.execPath,
    [
      path.join(process.cwd(), 'src', 'entrypoints', 'sites', 'download.mjs'),
      '--site',
      'bilibili',
      '--input',
      'BV1progress',
      '--plan-json',
      '--progress',
      'plain',
    ],
    { cwd: process.cwd(), encoding: 'utf8' },
  );

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.status, 'planned');
  assert.equal(result.stderr, '');
});

test('download parser accepts progress flags without changing execute safety', () => {
  const args = parseDownloadArgs([
    '--site',
    'bilibili',
    '--input',
    'BV1progress',
    '--progress',
    'plain',
    '--quiet',
    '--force-tty',
  ]);
  assert.equal(args.dryRun, true);
  assert.equal(args.progressMode, 'plain');
  assert.equal(args.quiet, true);
  assert.equal(args.forceTty, true);
});

test('build parser accepts upgraded human-output flags', () => {
  const parsed = parseBuildArgs([
    'https://weread.qq.com/',
    '--verbose',
    '--debug',
    '--no-color',
    '--ascii',
    '--compact',
    '--force-tty',
    '--progress=interactive',
  ]);
  assert.equal(parsed.url, 'https://weread.qq.com/');
  assert.equal(parsed.options.verbose, true);
  assert.equal(parsed.options.debug, true);
  assert.equal(parsed.options.noColor, true);
  assert.equal(parsed.options.ascii, true);
  assert.equal(parsed.options.compact, true);
  assert.equal(parsed.options.forceTty, true);
  assert.equal(parsed.options.progressMode, 'interactive');
});

test('site-doctor parser accepts progress flags while keeping JSON-compatible default output', () => {
  const parsed = parseDoctorArgs([
    'https://www.22biqu.com/',
    '--progress',
    'plain',
    '--quiet',
    '--json',
    '--no-tty',
  ]);
  assert.equal(parsed.inputUrl, 'https://www.22biqu.com/');
  assert.equal(parsed.options.progressMode, 'plain');
  assert.equal(parsed.options.quiet, true);
  assert.equal(parsed.options.json, true);
  assert.equal(parsed.options.noTty, true);
});

test('single-stage pipeline parsers accept shared progress flags', () => {
  const capture = parseCaptureArgs([
    'https://example.com',
    '--progress',
    'plain',
    '--json',
    '--quiet',
    '--force-tty',
    '--no-tty',
  ]);
  assert.equal(capture.options.progressMode, 'plain');
  assert.equal(capture.options.json, true);
  assert.equal(capture.options.quiet, true);
  assert.equal(capture.options.forceTty, true);
  assert.equal(capture.options.noTty, true);

  const expand = parseExpandArgs(['https://example.com', '--initial-manifest', 'capture.json', '--progress=plain']);
  assert.equal(expand.options.initialManifestPath, 'capture.json');
  assert.equal(expand.options.progressMode, 'plain');

  const collect = parseCollectContentArgs(['https://example.com', '--expanded-dir', 'expanded', '--quiet']);
  assert.equal(collect.options.expandedStatesDir, 'expanded');
  assert.equal(collect.options.quiet, true);

  const analyze = parseAnalyzeArgs(['https://example.com', '--expanded-dir', 'expanded', '--json']);
  assert.equal(analyze.options.expandedStatesDir, 'expanded');
  assert.equal(analyze.options.json, true);

  const abstraction = parseAbstractArgs(['https://example.com', '--analysis-dir', 'analysis', '--no-tty']);
  assert.equal(abstraction.options.analysisDir, 'analysis');
  assert.equal(abstraction.options.noTty, true);

  const nl = parseNlArgs(['https://example.com', '--abstraction-dir', 'abstraction', '--progress', 'plain']);
  assert.equal(nl.options.abstractionDir, 'abstraction');
  assert.equal(nl.options.progressMode, 'plain');

  const docs = parseDocsArgs(['https://example.com', '--nl-entry-dir', 'nl', '--force-tty']);
  assert.equal(docs.options.nlEntryDir, 'nl');
  assert.equal(docs.options.forceTty, true);

  const governance = parseGovernanceArgs(['https://example.com', '--docs-dir', 'docs', '--quiet']);
  assert.equal(governance.options.docsDir, 'docs');
  assert.equal(governance.options.quiet, true);

  const kb = parseKbArgs(['compile', 'https://example.com', '--kb-dir', 'kb', '--progress', 'plain', '--quiet']);
  assert.equal(kb.options.kbDir, 'kb');
  assert.equal(kb.options.progressMode, 'plain');
  assert.equal(kb.options.quiet, true);
});

test('single-stage progress helper strips UI flags before running stage logic', async () => {
  const stderr = createStream();
  const previousStdout = process.stdout;
  const previousStderr = process.stderr;
  Object.defineProperty(process, 'stdout', { value: createStream(), configurable: true });
  Object.defineProperty(process, 'stderr', { value: stderr, configurable: true });
  try {
    const seen = await runSingleStageCliWithProgress({
      inputUrl: 'https://example.com',
      options: {
        progressMode: 'plain',
        json: true,
        quiet: true,
        outDir: 'out',
      },
      taskId: 'analysis',
      stageId: 'analysis',
      run: async (stageOptions) => stageOptions,
    });
    assert.deepEqual(seen, { outDir: 'out' });
    assert.equal(stderr.output(), '');
    assert.deepEqual(stripProgressCliOptions({ json: true, quiet: true, progressMode: 'plain', outDir: 'out' }), { outDir: 'out' });
  } finally {
    Object.defineProperty(process, 'stdout', { value: previousStdout, configurable: true });
    Object.defineProperty(process, 'stderr', { value: previousStderr, configurable: true });
  }
});

test('site login, session, action, and catalog parsers accept shared progress flags', () => {
  const siteLogin = parseSiteLoginArgs(['https://example.com', '--progress', 'plain', '--quiet', '--json', '--no-tty']);
  assert.equal(siteLogin.options.progressMode, 'plain');
  assert.equal(siteLogin.options.quiet, true);
  assert.equal(siteLogin.options.json, true);
  assert.equal(siteLogin.options.noTty, true);

  const keepalive = parseSiteKeepaliveArgs(['https://example.com', '--progress=plain', '--force-tty']);
  assert.equal(keepalive.options.progressMode, 'plain');
  assert.equal(keepalive.options.forceTty, true);

  const nlLogin = parseNlSiteLoginArgs(['login', 'example', '--quiet']);
  assert.equal(nlLogin.options.quiet, true);

  const session = parseSessionArgs(['health', '--site', 'bilibili', '--progress', 'plain', '--quiet']);
  assert.equal(session.progressMode, 'plain');
  assert.equal(session.quiet, true);

  const repair = parseSessionRepairArgs(['--site', 'douyin', '--progress', 'plain', '--no-tty']);
  assert.equal(repair.progressMode, 'plain');
  assert.equal(repair.noTty, true);

  const bilibili = parseBilibiliActionArgs(['download', 'BV1progress', '--progress', 'plain', '--quiet']);
  assert.equal(bilibili.options.progressMode, 'plain');
  assert.equal(bilibili.options.quiet, true);

  const douyin = parseDouyinActionArgs(['download', 'https://www.douyin.com/video/1', '--progress', 'plain', '--json']);
  assert.equal(douyin.progressMode, 'plain');
  assert.equal(douyin.json, true);

  const xiaohongshu = parseXiaohongshuActionArgs(['download', 'https://www.xiaohongshu.com/explore/1', '--quiet']);
  assert.equal(xiaohongshu.quiet, true);

  const jable = parseJableRankingArgs(['https://jable.tv/', '--query', 'test', '--progress', 'plain']);
  assert.equal(jable.progressMode, 'plain');

  const jpAv = parseJpAvCatalogArgs(['--start', '2026-01-01', '--end', '2026-01-31', '--quiet']);
  assert.equal(jpAv.quiet, true);

  const moodyz = parseMoodyzCatalogArgs(['--month', '2026-05', '--no-tty']);
  assert.equal(moodyz.noTty, true);
});

test('session CLI --json remains machine-readable and suppresses progress', async () => {
  const stdout = createStream();
  const stderr = createStream();
  const result = await sessionMain([
    'health',
    '--site',
    'bilibili',
    '--json',
    '--progress',
    'plain',
  ], {
    stdout,
    stderr,
    runSessionTask: async () => ({
      manifest: {
        siteKey: 'bilibili',
        purpose: 'download',
        status: 'ready',
        reason: null,
        dryRun: true,
        plan: { sessionRequirement: 'optional' },
        repairPlan: { action: 'none' },
        artifacts: { manifest: 'runs/session/bilibili/session.json' },
      },
    }),
  });
  assert.equal(result.manifest.status, 'ready');
  const payload = JSON.parse(stdout.output());
  assert.equal(payload.siteKey, 'bilibili');
  assert.equal(stderr.output(), '');
});

test('auxiliary site CLIs accept shared progress flags without exposing sensitive positional data', () => {
  const credentials = parseSiteCredentialsArgs([
    'set',
    'https://example.com',
    '--username',
    'person@example.com',
    '--password',
    'synthetic-secret',
    '--progress',
    'plain',
    '--json',
  ]);
  assert.equal(credentials.options.progressMode, 'plain');
  assert.equal(credentials.options.json, true);
  assert.equal(credentials.options.password, 'synthetic-secret');

  const scaffold = parseSiteScaffoldArgs(['https://example.com', '--archetype', 'navigation-catalog', '--quiet']);
  assert.equal(scaffold.options.archetype, 'navigation-catalog');
  assert.equal(scaffold.options.quiet, true);

  const openPage = parseBilibiliOpenPageArgs(['https://www.bilibili.com/', '--progress=plain', '--no-tty']);
  assert.equal(openPage.options.progressMode, 'plain');
  assert.equal(openPage.options.noTty, true);

  const extractLinks = parseBilibiliExtractLinksArgs(['https://www.bilibili.com/', '--max-items', '3', '--force-tty']);
  assert.equal(extractLinks.maxItems, 3);
  assert.equal(extractLinks.forceTty, true);

  const socialImport = parseSocialAuthImportArgs([
    '--site',
    'x',
    '--cookie-header-env',
    'X_COOKIE_HEADER',
    '--progress',
    'plain',
    '--quiet',
  ]);
  assert.equal(socialImport.site, 'x');
  assert.equal(socialImport.cookieHeaderEnv, 'X_COOKIE_HEADER');
  assert.equal(socialImport.progressMode, 'plain');
  assert.equal(socialImport.quiet, true);

  const crawlerScript = parseGenerateCrawlerScriptArgs([
    'https://example.com',
    '--crawler-scripts-dir',
    'crawler-scripts',
    '--progress',
    'plain',
    '--quiet',
  ]);
  assert.equal(crawlerScript.options.crawlerScriptsDir, 'crawler-scripts');
  assert.equal(crawlerScript.options.progressMode, 'plain');
  assert.equal(crawlerScript.options.quiet, true);

  const douyinExport = parseDouyinExportCookiesArgs([
    '--out-file',
    'redacted-cookie-summary.json',
    '--progress',
    'plain',
    '--quiet',
    '--json',
  ]);
  assert.equal(douyinExport.options.outFile, 'redacted-cookie-summary.json');
  assert.equal(douyinExport.options.progressMode, 'plain');
  assert.equal(douyinExport.options.quiet, true);
  assert.equal(douyinExport.options.json, true);

  const socialAction = parseSocialActionArgs([
    'full-archive',
    'example-account',
    '--site',
    'x',
    '--progress',
    'plain',
    '--quiet',
    '--json',
  ]);
  assert.equal(socialAction.site, 'x');
  assert.equal(socialAction.action, 'full-archive');
  assert.equal(socialAction.progressMode, 'plain');
  assert.equal(socialAction.quiet, true);
  assert.equal(socialAction.json, true);
  assert.equal(socialAction.outputFormat, 'json');

  const douyinFollow = parseDouyinFollowQueryArgs([
    'https://www.douyin.com/?recommend=1',
    '--intent',
    'list-followed-updates',
    '--progress',
    'plain',
    '--quiet',
    '--json',
  ]);
  assert.equal(douyinFollow.options.intent, 'list-followed-updates');
  assert.equal(douyinFollow.options.progressMode, 'plain');
  assert.equal(douyinFollow.options.quiet, true);
  assert.equal(douyinFollow.options.json, true);

  const douyinMedia = parseDouyinMediaResolverArgs([
    'https://www.douyin.com/video/1',
    '--progress',
    'plain',
    '--no-tty',
  ]);
  assert.equal(douyinMedia.options.progressMode, 'plain');
  assert.equal(douyinMedia.options.noTty, true);
});

test('unified CLI facade routes build, skill, doctor, and download commands', () => {
  const build = resolveCliDispatch(['build', 'https://example.com', '--json']);
  assert.equal(path.basename(build.script), 'run-pipeline.mjs');
  assert.deepEqual(build.args, ['https://example.com', '--json']);

  const skill = resolveCliDispatch(['skill', 'https://example.com', '--quiet']);
  assert.equal(path.basename(skill.script), 'generate-skill.mjs');
  assert.deepEqual(skill.args, ['https://example.com', '--quiet']);

  const doctor = resolveCliDispatch(['doctor', 'https://example.com', '--progress', 'plain']);
  assert.equal(path.basename(doctor.script), 'site-doctor.mjs');
  assert.deepEqual(doctor.args, ['https://example.com', '--progress', 'plain']);

  const plan = resolveCliDispatch(['download', 'plan', 'BV1abc', '--site', 'bilibili']);
  assert.equal(path.basename(plan.script), 'download.mjs');
  assert.deepEqual(plan.args, ['--input', 'BV1abc', '--site', 'bilibili']);

  const execute = resolveCliDispatch(['download', 'execute', 'BV1abc', '--site', 'bilibili']);
  assert.deepEqual(execute.args, ['--input', 'BV1abc', '--execute', '--site', 'bilibili']);
});

test('unified CLI facade routes domain command tree', () => {
  const cases = [
    [['site', 'doctor', 'https://example.com'], 'site-doctor.mjs', ['https://example.com']],
    [['site', 'capability-compile', '--site', 'qidian', '--json'], 'site-capability-compile.mjs', ['--site', 'qidian', '--json']],
    [['site', 'login', 'https://example.com', '--json'], 'site-login.mjs', ['https://example.com', '--json']],
    [['site', 'keepalive', 'https://example.com'], 'site-keepalive.mjs', ['https://example.com']],
    [['site', 'scaffold', 'https://example.com', '--archetype', 'navigation-catalog'], 'site-scaffold.mjs', ['https://example.com', '--archetype', 'navigation-catalog']],
    [['site', 'credentials', 'show', 'https://example.com'], 'site-credentials.mjs', ['show', 'https://example.com']],
    [['site', 'nl-login', '登录 B 站'], 'nl-site-login.mjs', ['登录 B 站']],
    [['site', 'repair-plan', '--site', 'x'], 'session-repair-plan.mjs', ['--site', 'x']],
    [['session', 'health', '--site', 'x'], 'session.mjs', ['health', '--site', 'x']],
    [['session', 'repair-plan', '--site', 'x'], 'session.mjs', ['plan-repair', '--site', 'x']],
    [['social', 'live-verify', '--live', '--site', 'x'], 'social-live-verify.mjs', ['--live', '--site', 'x']],
    [['social', 'kb-refresh', '--site', 'x'], 'social-kb-refresh.mjs', ['--site', 'x']],
    [['social', 'resume', '--state', 'manifest.json'], 'social-live-resume.mjs', ['--state', 'manifest.json']],
    [['social', 'report', '--json'], 'social-live-report.mjs', ['--json']],
    [['social', 'dashboard', '--quiet'], 'social-live-dashboard.mjs', ['--quiet']],
    [['social', 'auth-recover', '--site', 'x'], 'social-auth-recover.mjs', ['--site', 'x']],
    [['social', 'health-watch', '--site', 'x'], 'social-health-watch.mjs', ['--site', 'x']],
    [['social', 'templates', '--site', 'all'], 'social-command-templates.mjs', ['--site', 'all']],
    [['social', 'auth-import', '--site', 'x'], 'social-auth-import.mjs', ['--site', 'x']],
    [['catalog', 'jable-ranking', 'https://jable.tv/', '--query', 'test'], 'jable-ranking.mjs', ['https://jable.tv/', '--query', 'test']],
    [['catalog', 'jp-av-release', '--start', '2026-01-01'], 'jp-av-release-catalog.mjs', ['--start', '2026-01-01']],
    [['catalog', 'moodyz-month', '--month', '2026-05'], 'moodyz-month-catalog.mjs', ['--month', '2026-05']],
    [['bilibili', 'action', 'download', 'BV1abc', '--progress', 'plain'], 'bilibili-action.mjs', ['download', 'BV1abc', '--progress', 'plain']],
    [['bilibili', 'open', 'https://www.bilibili.com/'], 'bilibili-open-page.mjs', ['https://www.bilibili.com/']],
    [['bilibili', 'extract-links', 'https://www.bilibili.com/'], 'bilibili-extract-links.mjs', ['https://www.bilibili.com/']],
    [['douyin', 'action', 'download', 'https://www.douyin.com/video/1'], 'douyin-action.mjs', ['download', 'https://www.douyin.com/video/1']],
    [['douyin', 'follow', 'https://www.douyin.com/?recommend=1'], 'douyin-query-follow.mjs', ['https://www.douyin.com/?recommend=1']],
    [['douyin', 'resolve-media', 'https://www.douyin.com/video/1'], 'douyin-resolve-media.mjs', ['https://www.douyin.com/video/1']],
    [['douyin', 'export-cookies', '--json'], 'douyin-export-cookies.mjs', ['--json']],
    [['xiaohongshu', 'action', 'download', 'https://www.xiaohongshu.com/explore/1'], 'xiaohongshu-action.mjs', ['download', 'https://www.xiaohongshu.com/explore/1']],
    [['xiaohongshu', 'follow', 'https://www.xiaohongshu.com/notification'], 'xiaohongshu-query-follow.mjs', ['https://www.xiaohongshu.com/notification']],
    [['x', 'action', 'account-info', 'openai'], 'x-action.mjs', ['account-info', 'openai']],
    [['instagram', 'action', 'account-info', 'instagram'], 'instagram-action.mjs', ['account-info', 'instagram']],
  ];
  for (const [argv, expectedScript, expectedArgs] of cases) {
    const dispatch = resolveCliDispatch(argv);
    assert.equal(path.basename(dispatch.script), expectedScript);
    assert.deepEqual(dispatch.args, expectedArgs);
  }
});

test('unified CLI command map exposes descriptor-only site capability compile', () => {
  assert.deepEqual(
    unifiedCliArgsForScript('src/entrypoints/sites/site-capability-compile.mjs'),
    ['site', 'capability-compile'],
  );
  assert.equal(
    siteCapabilityCompileCommand(['--site', 'qidian', '--json']),
    'node src/entrypoints/cli.mjs site capability-compile --site qidian --json',
  );
});

test('unified CLI facade exposes top-level, domain, and forwarded help', () => {
  const top = spawnSync(process.execPath, [path.join(process.cwd(), 'src', 'entrypoints', 'cli.mjs'), '--help'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  assert.equal(top.status, 0, top.stderr);
  assert.match(top.stdout, /Domains:/u);
  assert.match(top.stdout, /node src\/entrypoints\/cli\.mjs social templates --site all/u);

  const site = spawnSync(process.execPath, [path.join(process.cwd(), 'src', 'entrypoints', 'cli.mjs'), 'site', '--help'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  assert.equal(site.status, 0, site.stderr);
  assert.match(site.stdout, /node src\/entrypoints\/cli\.mjs site <command>/u);
  assert.match(site.stdout, /repair-plan/u);

  const social = spawnSync(process.execPath, [path.join(process.cwd(), 'src', 'entrypoints', 'cli.mjs'), 'social', '--help'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  assert.equal(social.status, 0, social.stderr);
  assert.match(social.stdout, /live-verify/u);
  assert.match(social.stdout, /auth-recover/u);

  const download = spawnSync(process.execPath, [path.join(process.cwd(), 'src', 'entrypoints', 'cli.mjs'), 'download', '--help'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  assert.equal(download.status, 0, download.stderr);
  assert.match(download.stdout, /Defaults to dry-run/u);

  const unknown = spawnSync(process.execPath, [path.join(process.cwd(), 'src', 'entrypoints', 'cli.mjs'), 'site', 'unknown'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  assert.notEqual(unknown.status, 0);
  assert.match(unknown.stderr, /Unknown site command/u);
});

test('social live helper scripts accept shared progress flags', () => {
  const liveVerify = parseSocialLiveVerifyArgs([
    '--live',
    '--site',
    'x',
    '--run-root',
    'runs/social-live-verify',
    '--max-items',
    '1',
    '--timeout',
    '1000',
    '--case-timeout',
    '1000',
    '--progress=plain',
    '--quiet',
  ]);
  assert.equal(liveVerify.progressMode, 'plain');
  assert.equal(liveVerify.quiet, true);

  const kbRefresh = parseSocialKbRefreshArgs(['--site', 'instagram', '--progress', 'plain', '--no-tty']);
  assert.equal(kbRefresh.progressMode, 'plain');
  assert.equal(kbRefresh.noTty, true);

  const resume = parseSocialLiveResumeArgs(['--state', 'runs/social/state.json', '--json', '--progress', 'plain']);
  assert.equal(resume.format, 'json');
  assert.equal(resume.json, true);
  assert.equal(resume.progressMode, 'plain');

  const report = parseSocialLiveReportArgs(['--json', '--progress=plain']);
  assert.equal(report.write, false);
  assert.equal(report.json, true);
  assert.equal(report.progressMode, 'plain');

  const dashboard = parseSocialLiveDashboardArgs(['--no-write', '--progress', 'plain', '--force-tty']);
  assert.equal(dashboard.write, false);
  assert.equal(dashboard.progressMode, 'plain');
  assert.equal(dashboard.forceTty, true);

  const authRecover = parseSocialAuthRecoverArgs(['--site', 'x', '--json', '--progress', 'plain', '--quiet']);
  assert.equal(authRecover.site, 'x');
  assert.equal(authRecover.json, true);
  assert.equal(authRecover.progressMode, 'plain');
  assert.equal(authRecover.quiet, true);

  const healthWatch = parseSocialHealthWatchArgs(['--site', 'instagram', '--json', '--progress=plain', '--no-tty']);
  assert.equal(healthWatch.site, 'instagram');
  assert.equal(healthWatch.json, true);
  assert.equal(healthWatch.progressMode, 'plain');
  assert.equal(healthWatch.noTty, true);

  const templates = parseSocialCommandTemplatesArgs(['--site', 'all', '--json', '--quiet', '--force-tty']);
  assert.equal(templates.format, 'json');
  assert.equal(templates.json, true);
  assert.equal(templates.quiet, true);
  assert.equal(templates.forceTty, true);
});

test('edge social helper --json output remains machine-readable and suppresses progress', async (t) => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), 'bwk-social-edge-progress-'));
  t.after(() => rm(runRoot, { recursive: true, force: true }));

  const recover = spawnSync(
    process.execPath,
    [
      path.join(process.cwd(), 'scripts', 'social-auth-recover.mjs'),
      '--site',
      'x',
      '--run-root',
      path.join(runRoot, 'recover'),
      '--json',
      '--progress',
      'plain',
    ],
    { cwd: process.cwd(), encoding: 'utf8' },
  );
  assert.equal(recover.status, 0, recover.stderr);
  assert.equal(recover.stderr, '');
  assert.equal(JSON.parse(recover.stdout).mode, 'dry-run');

  const health = spawnSync(
    process.execPath,
    [
      path.join(process.cwd(), 'scripts', 'social-health-watch.mjs'),
      '--site',
      'x',
      '--run-root',
      path.join(runRoot, 'health'),
      '--json',
      '--progress',
      'plain',
    ],
    { cwd: process.cwd(), encoding: 'utf8' },
  );
  assert.equal(health.status, 0, health.stderr);
  assert.equal(health.stderr, '');
  assert.equal(JSON.parse(health.stdout).mode, 'dry-run');

  const templates = spawnSync(
    process.execPath,
    [
      path.join(process.cwd(), 'scripts', 'social-command-templates.mjs'),
      '--site',
      'x',
      '--json',
      '--progress',
      'plain',
    ],
    { cwd: process.cwd(), encoding: 'utf8' },
  );
  assert.equal(templates.status, 0, templates.stderr);
  assert.equal(templates.stderr, '');
  assert.deepEqual(JSON.parse(templates.stdout).sites.map((site) => site.site), ['x']);
});
