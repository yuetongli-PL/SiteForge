import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createProgressLifecycle,
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

function createStream({ isTTY = false, columns = 80 } = /** @type {any} */ ({})) {
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
  const task = progress.task({ id: 'build', title: 'Build SiteForge Skill' });
  const stage = task.stage({ id: 'crawlStatic', index: 1, total: 10, item: 'https://example.com/page' });
  stage.update({ current: 3, total: 10, message: 'Crawling static pages' });
  stage.succeed({ message: 'Crawled static pages' });
  task.succeed({ message: 'SiteForge Skill generated', artifacts: [{ label: 'skill', path: 'skills/example/SKILL.md' }] });

  const output = stderr.output();
  assert.match(output, /\[build\] start status=pending/u);
  assert.match(output, /stage=1\/10 name=crawlStatic status=running/u);
  assert.match(output, /percent="30%"/u);
  assert.match(output, /status=success message="Crawled static pages"/u);
  assert.match(output, /skill=skills\/example\/SKILL\.md/u);
  assert.equal(hasCursorControl(output), false);
  assert.doesNotMatch(output, /[\u280b\u2819\u2839]\r/u);
});

test('interactive mode refreshes in place and avoids extra newline while running', () => {
  const stderr = createStream({ isTTY: true, columns: 90 });
  const progress = createProgressRenderer({ stdout: stderr, stderr, mode: 'interactive', color: 'never', unicode: 'never', env: {} });
  const task = progress.task({ id: 'build', title: 'Build' });
  const stage = task.stage({ id: 'crawlStatic', index: 1, total: 10 });
  stage.update({ current: 1, total: 10, message: 'running' });
  const output = stderr.output();
  assert.match(output, /\r/u);
  assert.equal(output.endsWith('\n'), false);
});

test('stage progress falls back to stage index when no inner progress is reported', () => {
  const stderr = createStream({ isTTY: true, columns: 90 });
  const progress = createProgressRenderer({ stdout: stderr, stderr, mode: 'interactive', color: 'never', unicode: 'never', env: {} });
  const task = progress.task({ id: 'build', title: 'Build' });
  const stage = task.stage({ id: 'writeBuildReport', index: 7, total: 10, title: 'Writing build report' });
  stage.succeed({ message: 'done' });
  const output = stripAnsi(stderr.output());
  assert.match(output, /70%/u);
});

test('progress lifecycle accepts stage status tokens and method names', () => {
  const stderr = createStream();
  const progress = createProgressRenderer({ stdout: stderr, stderr, mode: 'plain', color: 'never', unicode: 'never', env: {} });
  const task = progress.task({ id: 'build', title: 'Build' });
  const lifecycle = createProgressLifecycle(progress, task);

  lifecycle.finishStage(lifecycle.startStage({ id: 'writeReport', index: 1, total: 4 }), 'success', { message: 'report written' });
  lifecycle.finishStage(lifecycle.startStage({ id: 'capture', index: 2, total: 4 }), 'warning', { message: 'partial capture' });
  lifecycle.finishStage(lifecycle.startStage({ id: 'optional', index: 3, total: 4 }), 'skipped', { message: 'not needed' });
  lifecycle.finishStage(lifecycle.startStage({ id: 'verify', index: 4, total: 4 }), 'fail', { message: 'verification failed' });

  const output = stderr.output();
  assert.match(output, /name=writeReport status=success message="report written"/u);
  assert.match(output, /name=capture status=warning message="partial capture"/u);
  assert.match(output, /name=optional status=skipped message="not needed"/u);
  assert.match(output, /name=verify status=failed message="verification failed"/u);
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
  assert.equal(visibleWidth('观察abc'), 7);
  assert.equal(truncateText('https://example.com/a/very/long/path', 14), 'https://examp…');
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
    stage: 'crawlStatic',
    reason: 'verification or access-control page',
    nextStep: 'siteforge build https://example.com',
    report: 'runs/sites/site-doctor/example/report.md',
  });
  assert.match(output, /\[build\] status=failed stage=crawlStatic reason="verification or access-control page"/u);
  assert.match(output, /CAPTCHA.*MFA/u);
  assert.match(output, /next=/u);
  assert.match(output, /report=runs\/sites\/site-doctor\/example\/report\.md/u);
});

test('download progress summary renders bytes, speed, ETA, resume, skip, verify, and failures', () => {
  const stderr = createStream();
  const progress = createProgressRenderer({ stdout: stderr, stderr, mode: 'plain', env: {} });
  const task = progress.download({ id: 'download', title: 'Download' });
  const item = task.stage({ id: 'file-1', index: 1, total: 2, title: 'Download resource', totalBytes: 4096 });
  item.update({ downloadedBytes: 2048, totalBytes: 4096, item: 'video.mp4', retryCount: 1 });
  item.succeed({ downloadedBytes: 4096, totalBytes: 4096, completedItems: 1, verified: 1, message: 'Downloaded and verified' });
  const skipped = task.stage({ id: 'file-2', index: 2, total: 2, title: 'Download resource' });
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
