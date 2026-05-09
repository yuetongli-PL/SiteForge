import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createProgressRenderer,
  formatEta,
  formatPercent,
  formatSpeed,
  hasCursorControl,
  renderFailureSummary,
  stripAnsi,
  truncateText,
  visibleWidth,
} from '../../src/infra/cli/progress.mjs';
import { pipelineStageTitle } from '../../src/infra/cli/progress-copy.mjs';
import {
  BuildProgressController,
  renderBuildFailure,
  renderBuildSummary,
} from '../../src/infra/cli/build-progress.mjs';

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

test('progress renderer detects TTY, CI, JSON, quiet, and explicit modes', () => {
  const tty = createStream({ isTTY: true });
  assert.equal(createProgressRenderer({ stdout: tty, stderr: tty, env: {} }).mode, 'interactive');
  assert.equal(createProgressRenderer({ stdout: tty, stderr: tty, env: { CI: 'true' } }).mode, 'plain');
  assert.equal(createProgressRenderer({ stdout: tty, stderr: tty, json: true, env: {} }).mode, 'silent');
  assert.equal(createProgressRenderer({ stdout: tty, stderr: tty, quiet: true, env: {} }).mode, 'silent');
  assert.equal(createProgressRenderer({ stdout: tty, stderr: tty, mode: 'plain', env: {} }).mode, 'plain');
  assert.equal(createProgressRenderer({ stdout: createStream(), stderr: createStream(), forceTty: true, env: {} }).mode, 'interactive');
  assert.equal(createProgressRenderer({ stdout: tty, stderr: tty, noTty: true, env: {} }).mode, 'plain');
});

test('plain mode renders stable lines without ANSI cursor control or spinner frames', () => {
  const stderr = createStream();
  const progress = createProgressRenderer({ stdout: stderr, stderr, mode: 'plain', color: 'never', unicode: 'never', env: {} });
  const task = progress.task({ id: 'build', title: 'Build site skill' });
  const stage = task.stage({ id: 'capture', index: 1, total: 10, item: 'https://example.com/page' });
  stage.update({ current: 3, total: 10, message: 'Capturing page facts' });
  stage.succeed({ message: 'Captured page facts' });
  task.succeed({ message: 'Skill generated', artifacts: [{ label: 'skill', path: 'skills/example/SKILL.md' }] });

  const output = stderr.output();
  assert.match(output, /\[build\] start status=pending/u);
  assert.match(output, /stage=1\/10 name=capture status=running/u);
  assert.match(output, /percent="30%"/u);
  assert.match(output, /status=success message="Captured page facts"/u);
  assert.match(output, /skill=skills\/example\/SKILL\.md/u);
  assert.equal(hasCursorControl(output), false);
  assert.doesNotMatch(output, /[\u280b\u2819\u2839]\r/u);
});

test('interactive mode refreshes in place and avoids extra newline while running', () => {
  const stderr = createStream({ isTTY: true, columns: 90 });
  const progress = createProgressRenderer({ stdout: stderr, stderr, mode: 'interactive', color: 'never', unicode: 'never', env: {} });
  const task = progress.task({ id: 'build', title: 'Build' });
  const stage = task.stage({ id: 'capture', index: 1, total: 10 });
  stage.update({ current: 1, total: 10, message: 'running' });
  const output = stderr.output();
  assert.match(output, /\r/u);
  assert.equal(output.endsWith('\n'), false);
});

test('stage progress falls back to stage index when no inner progress is reported', () => {
  const stderr = createStream({ isTTY: true, columns: 90 });
  const progress = createProgressRenderer({ stdout: stderr, stderr, mode: 'interactive', color: 'never', unicode: 'never', env: {} });
  const task = progress.task({ id: 'build', title: 'Build' });
  const stage = task.stage({ id: 'docs', index: 7, total: 10, title: 'Docs' });
  stage.succeed({ message: 'done' });
  const output = stripAnsi(stderr.output());
  assert.match(output, /70%/u);
});

test('interactive mode supports status icons and color can be disabled', () => {
  const stderr = createStream({ isTTY: true });
  const progress = createProgressRenderer({ stdout: stderr, stderr, mode: 'interactive', color: 'never', unicode: 'never', env: {} });
  const task = progress.task({ id: 'doctor', title: 'Doctor' });
  task.warn({ message: 'degraded' });
  task.fail({ message: 'blocked' });
  const output = stderr.output();
  assert.doesNotMatch(output, /\x1b\[(?:3[0-7]|9[0-7]|1|2)m/u);
  assert.match(output, /!/u);
  assert.match(output, /X/u);
});

test('format helpers cover percent, ETA, speed, truncation, and Chinese width', () => {
  assert.equal(formatPercent(3, 10), '30%');
  assert.equal(formatEta(65), '1m05s');
  assert.equal(formatSpeed(2048), '2.0 KB/s');
  assert.equal(visibleWidth('\u89c2\u5bdfabc'), 7);
  assert.equal(truncateText('https://example.com/a/very/long/path', 14), 'https://examp\u2026');
});

test('unicode disabled and color disabled degrade output', () => {
  const stderr = createStream({ isTTY: true });
  const progress = createProgressRenderer({ stdout: stderr, stderr, mode: 'interactive', color: 'never', unicode: 'never', env: {} });
  const task = progress.task({ id: 'download', title: 'Download' });
  task.succeed({ message: 'ok' });
  const output = stderr.output();
  assert.doesNotMatch(output, /\x1b\[(?:3[0-7]|9[0-7]|1|2)m/u);
  assert.doesNotMatch(output, /[\u2713\u2717\u25cb\u280b\u2588\u2591]/u);
  assert.match(output, /OK/u);
});

test('confirm/select/multiSelect do not block in non-TTY mode', async () => {
  const stderr = createStream();
  const progress = createProgressRenderer({ stdout: stderr, stderr, mode: 'plain', env: {} });
  assert.equal(await progress.confirm({ message: 'Proceed?', defaultValue: true }), true);
  assert.equal(await progress.select({ message: 'Pick', choices: [{ label: 'A', value: 'a' }], defaultValue: 'b' }), 'b');
  assert.deepEqual(await progress.multiSelect({ message: 'Pick many', defaultValue: ['a'] }), ['a']);
  await assert.rejects(
    () => progress.confirm({ message: 'Proceed?', nonInteractive: 'error' }),
    /non-TTY/u,
  );
});

test('failure renderer includes stage, reason, safety, next step, and report', () => {
  const output = renderFailureSummary({
    taskId: 'build',
    stage: 'capture',
    reason: 'verification or access-control page',
    nextStep: 'node src/entrypoints/cli.mjs site doctor https://example.com --no-headless',
    report: 'runs/sites/site-doctor/example/report.md',
  });
  assert.match(output, /\[build\] status=failed stage=capture reason="verification or access-control page"/u);
  assert.match(output, /CAPTCHA.*MFA/u);
  assert.match(output, /next=/u);
  assert.match(output, /report=runs\/sites\/site-doctor\/example\/report\.md/u);
});

test('download progress summary renders bytes, speed, ETA, resume, skip, verify, and failures', () => {
  const stderr = createStream();
  const progress = createProgressRenderer({ stdout: stderr, stderr, mode: 'plain', env: {} });
  const task = progress.download({ id: 'download', title: 'Download' });
  const item = task.stage({ id: 'file-1', index: 1, total: 2, title: '\u4e0b\u8f7d\u8d44\u6e90', totalBytes: 4096 });
  item.update({ downloadedBytes: 2048, totalBytes: 4096, item: 'video.mp4', retryCount: 1 });
  item.succeed({ downloadedBytes: 4096, totalBytes: 4096, completedItems: 1, verified: 1, message: 'Downloaded and verified' });
  const skipped = task.stage({ id: 'file-2', index: 2, total: 2, title: '\u4e0b\u8f7d\u8d44\u6e90' });
  skipped.skip({ message: 'Skipped existing file', skippedExisting: 1 });
  task.warn({ message: 'partial', completedItems: 1, failedItems: 1, skippedExisting: 1 });
  const output = stderr.output();
  assert.match(output, /downloaded="2.0 KB" size="4.0 KB"/u);
  assert.match(output, /speed=/u);
  assert.match(output, /eta=/u);
  assert.match(output, /retry=1/u);
  assert.match(output, /verified=1/u);
  assert.match(output, /skippedExisting=1/u);
  assert.match(output, /failed=1/u);
});

test('pipeline stage mapping is centralized and defaults to Chinese', () => {
  assert.equal(pipelineStageTitle('capture'), '\u89c2\u5bdf\u7f51\u7ad9\u7ed3\u6784');
  assert.equal(pipelineStageTitle('expanded', 'en'), 'Exploring page states');
  assert.equal(pipelineStageTitle('bookContent'), '\u91c7\u96c6\u5185\u5bb9\u6837\u672c');
  assert.equal(pipelineStageTitle('analysis'), '\u5206\u6790\u9875\u9762\u7c7b\u578b');
  assert.equal(pipelineStageTitle('abstraction'), '\u6574\u7406\u4ea4\u4e92\u6a21\u578b');
  assert.equal(pipelineStageTitle('nlEntry'), '\u751f\u6210\u81ea\u7136\u8bed\u8a00\u5165\u53e3');
  assert.equal(pipelineStageTitle('docs'), '\u751f\u6210\u8bf4\u660e\u6587\u6863');
  assert.equal(pipelineStageTitle('governance'), '\u751f\u6210\u5b89\u5168\u8fb9\u754c\u4e0e\u6062\u590d\u7b56\u7565');
  assert.equal(pipelineStageTitle('knowledgeBase'), '\u7f16\u8bd1\u7ad9\u70b9\u77e5\u8bc6\u5e93');
  assert.equal(pipelineStageTitle('skill'), '\u751f\u6210 Agent Skill');
});

test('progress output redacts sensitive keys and values', () => {
  const stderr = createStream();
  const progress = createProgressRenderer({ stdout: stderr, stderr, mode: 'plain', env: {} });
  const task = progress.task({ id: 'safe', title: 'Safe' });
  task.update({
    message: 'Authorization: Bearer synthetic-token',
    item: 'https://example.com/?access_token=synthetic-token',
    sessionId: 'synthetic-session',
  });
  const output = stderr.output();
  assert.doesNotMatch(output, /synthetic-token|synthetic-session|Authorization: Bearer|access_token=/u);
  assert.match(output, /\[REDACTED\]/u);
});

test('build progress TTY panel keeps pending stages distinct and uses cursor refresh', () => {
  const stderr = createStream({ isTTY: true, columns: 100 });
  const stages = [
    { name: 'capture' },
    { name: 'expanded' },
    { name: 'analysis' },
  ];
  const progress = new BuildProgressController({
    inputUrl: 'https://weread.qq.com/',
    stageSpecs: stages,
    stderr,
    stdout: createStream({ isTTY: true }),
    options: { forceTty: true, noColor: true },
  });
  const capture = progress.stage({ id: 'capture', index: 1, total: 3, item: 'https://weread.qq.com/' });
  capture.succeed({ message: 'runs/pipeline/captures/weread' });
  progress.stage({ id: 'expanded', index: 2, total: 3, item: 'trigger:nav' });
  const output = stripAnsi(stderr.output());
  assert.match(stderr.output(), /\x1b\[/u);
  assert.match(output, /Browser Wiki Skill/u);
  assert.match(output, /1\/3 stages|0\/3 stages/u);
  assert.match(output, /✓\s+1\. 观察网站结构/u);
  assert.match(output, /2\. 探索页面状态\s+running/u);
  assert.match(output, /3\. 分析页面类型\s+pending/u);
});

test('build progress plain mode emits stable stage lines and final compact result', () => {
  const stderr = createStream();
  const stages = [{ name: 'capture' }, { name: 'knowledgeBase' }];
  const progress = new BuildProgressController({
    inputUrl: 'https://example.com/',
    stageSpecs: stages,
    stderr,
    stdout: createStream(),
    options: { progressMode: 'plain', ascii: true },
  });
  const capture = progress.stage({ id: 'capture', index: 1, total: 2 });
  capture.succeed({ message: 'runs/pipeline/captures/example' });
  const kb = progress.stage({ id: 'knowledgeBase', index: 2, total: 2 });
  kb.warn({ message: '20 warnings' });
  progress.complete({
    inputUrl: 'https://example.com/',
    skillName: 'example',
    skillDir: 'skills/example',
    kbDir: 'knowledge-base/example.com',
    stages: {
      knowledgeBase: {
        pages: 12,
        lintSummary: { errorCount: 0, warningCount: 20, orphanPageCount: 3 },
        gapGroups: { pendingRiskConfirmations: 2, evidenceGaps: 0 },
      },
      skill: { warnings: [] },
    },
  });
  const output = stderr.output();
  assert.equal(hasCursorControl(output), false);
  assert.match(output, /\[1\/2\] 观察网站结构\.\.\. running/u);
  assert.match(output, /\[1\/2\] 观察网站结构\.\.\. done/u);
  assert.match(output, /\[2\/2\] 编译站点知识库\.\.\. warning: 20 warnings/u);
  assert.match(output, /Site skill generated with warnings\./u);
  assert.match(output, /Skill: skills\/example/u);
});

test('build summary renders table, artifacts, quality, next commands, and path compaction', () => {
  const summary = renderBuildSummary({
    inputUrl: 'https://weread.qq.com/',
    skillName: 'weread',
    skillDir: 'C:\\Users\\lyt-p\\Desktop\\Browser-Wiki-Skill\\skills\\weread',
    kbDir: 'C:\\Users\\lyt-p\\Desktop\\Browser-Wiki-Skill\\knowledge-base\\weread.qq.com',
    stages: {
      analysis: { summary: { inputStates: 13 } },
      abstraction: { summary: { actions: 8 } },
      docs: { summary: { documents: 8 } },
      knowledgeBase: {
        pages: 38,
        lintSummary: { errorCount: 0, warningCount: 20, orphanPageCount: 13 },
        gapGroups: { pendingRiskConfirmations: 7, evidenceGaps: 0 },
      },
      skill: {
        references: ['references/index.md', 'references/flows.md'],
        warnings: [],
      },
    },
  }, {
    durationMs: 141000,
    columns: 90,
  });
  assert.match(summary, /Site skill generated with warnings/u);
  assert.match(summary, /Summary/u);
  assert.match(summary, /Artifacts/u);
  assert.match(summary, /Quality/u);
  assert.match(summary, /Next/u);
  assert.match(summary, /Warnings\s+20/u);
  assert.match(summary, /skills\/weread/u);
  assert.doesNotMatch(summary, /"inputUrl"/u);
});

test('build summary and failure support ASCII and debug-oriented failure text', () => {
  const summary = renderBuildSummary({
    inputUrl: 'https://example.com/',
    skillName: 'example',
    stages: { knowledgeBase: { lintSummary: { errorCount: 0, warningCount: 0 } }, skill: { warnings: [] } },
  }, { ascii: true });
  assert.match(summary, /^OK Site skill generated/u);
  assert.doesNotMatch(summary, /✓|⚠|✗/u);

  const failure = renderBuildFailure(new Error('Failed to read captured state file'), {
    inputUrl: 'https://example.com/',
    stages: [{ index: 4, title: '分析页面类型', status: 'failed' }],
    currentStage: { index: 4, title: '分析页面类型' },
  }, { ascii: true });
  assert.match(failure, /^X Build failed at stage 4\/1: 分析页面类型/u);
  assert.match(failure, /Reason\s+Failed to read captured state file/su);
  assert.match(failure, /--debug/u);
});

test('build progress respects quiet mode and narrow terminal truncation', () => {
  const quietStderr = createStream({ isTTY: true, columns: 40 });
  const quiet = new BuildProgressController({
    inputUrl: 'https://example.com/a/very/long/path',
    stageSpecs: [{ name: 'capture' }],
    stderr: quietStderr,
    stdout: createStream({ isTTY: true }),
    options: { quiet: true, forceTty: true },
  });
  quiet.stage({ id: 'capture', index: 1, total: 1 });
  quiet.complete({ inputUrl: 'https://example.com/', stages: {} });
  assert.equal(quietStderr.output(), '');

  const narrowStderr = createStream({ isTTY: true, columns: 42 });
  const narrow = new BuildProgressController({
    inputUrl: 'https://example.com/a/very/long/path/that/should/truncate',
    stageSpecs: [{ name: 'capture' }, { name: 'expanded' }],
    stderr: narrowStderr,
    stdout: createStream({ isTTY: true }),
    options: { forceTty: true, noColor: true },
  });
  narrow.stage({ id: 'capture', index: 1, total: 2, item: 'https://example.com/a/very/long/path/that/should/truncate' });
  const visible = stripAnsi(narrowStderr.output());
  assert.match(visible, /…/u);
});
