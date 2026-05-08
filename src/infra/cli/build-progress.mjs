// @ts-check

import path from 'node:path';
import process from 'node:process';
import readline from 'node:readline';
import {
  formatDuration,
  formatPercent,
  renderProgressBar,
  resolveProgressMode,
  truncateText,
  visibleWidth,
} from './progress.mjs';
import { pipelineStageTitle, progressText, SAFETY_STOP_COPY } from './progress-copy.mjs';

const STATUS_ORDER = ['pending', 'running', 'completed', 'warning', 'failed', 'skipped'];

const GLYPHS = Object.freeze({
  unicode: {
    completed: '✓',
    running: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
    warning: '⚠',
    failed: '✗',
    pending: '·',
    skipped: '-',
  },
  ascii: {
    completed: 'OK',
    running: ['-', '\\', '|', '/'],
    warning: '!',
    failed: 'X',
    pending: '.',
    skipped: '-',
  },
});

const COLORS = Object.freeze({
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
});

function normalizeStatus(value) {
  if (value === 'success') return 'completed';
  if (value === 'cancelled') return 'failed';
  return STATUS_ORDER.includes(value) ? value : 'running';
}

function color(enabled, name, text) {
  return enabled ? `${COLORS[name] ?? ''}${text}${COLORS.reset}` : text;
}

function useColor(options, mode, stream) {
  if (options.noColor || options.color === 'never') return false;
  if (options.color === 'always') return true;
  return mode === 'interactive' && Boolean(stream?.isTTY);
}

function useUnicode(options, mode) {
  if (options.ascii || options.unicode === 'never') return false;
  if (options.unicode === 'always') return true;
  if (mode !== 'interactive' && mode !== 'plain') return false;
  return true;
}

function basenameSkillFromUrl(inputUrl) {
  try {
    const host = new URL(inputUrl).hostname;
    return host.split('.').filter(Boolean)[0] || host;
  } catch {
    return 'site';
  }
}

function relativeOrCompactPath(value, {
  cwd = process.cwd(),
  verbose = false,
  maxWidth = 70,
} = {}) {
  if (!value) return null;
  const text = String(value);
  if (/^[a-z][a-z0-9+.-]*:\/\//iu.test(text)) {
    return truncateText(text, maxWidth);
  }
  const normalized = text.replace(/\\/gu, path.sep);
  const resolved = path.isAbsolute(normalized) ? normalized : path.resolve(cwd, normalized);
  if (verbose) return resolved;
  let relative = path.relative(cwd, resolved);
  if (!relative || relative.startsWith('..')) {
    relative = resolved;
  }
  const display = relative.replace(/\\/gu, '/');
  if (visibleWidth(display) <= maxWidth) return display;
  const parts = display.split(/[\\/]/u);
  if (parts.length >= 4) {
    const compact = `${parts[0]}/.../${parts.slice(-2).join('/')}`;
    if (visibleWidth(compact) <= maxWidth) return compact;
  }
  return truncateText(display, maxWidth);
}

function padRight(value, width) {
  const text = String(value ?? '');
  return `${text}${' '.repeat(Math.max(0, width - visibleWidth(text)))}`;
}

function row(label, value) {
  return `  ${padRight(label, 14)} ${value ?? '-'}`;
}

function statusTone(status) {
  if (status === 'completed') return 'green';
  if (status === 'warning' || status === 'skipped') return 'yellow';
  if (status === 'failed') return 'red';
  return 'cyan';
}

function collectQuality(result) {
  const kb = result?.stages?.knowledgeBase ?? {};
  const lint = kb.lintSummary ?? {};
  const gaps = kb.gapGroups ?? {};
  const skillWarnings = result?.stages?.skill?.warnings?.length ?? 0;
  return {
    errors: Number(lint.errorCount ?? 0),
    warnings: Number(lint.warningCount ?? 0) + skillWarnings,
    orphanPages: Number(lint.orphanPageCount ?? gaps.orphanPages ?? 0),
    pendingRiskConfirmations: Number(gaps.pendingRiskConfirmations ?? 0),
    evidenceGaps: Number(gaps.evidenceGaps ?? 0),
  };
}

function hasWarnings(result) {
  const quality = collectQuality(result);
  return quality.warnings > 0
    || quality.orphanPages > 0
    || quality.pendingRiskConfirmations > 0
    || quality.evidenceGaps > 0
    || Object.values(result?.stages ?? {}).some((stage) => stage?.status === 'skipped' || stage?.status === 'warning');
}

function summarizeNumbers(result) {
  return {
    pages: result?.stages?.knowledgeBase?.pages ?? 0,
    states: result?.stages?.analysis?.summary?.inputStates
      ?? result?.stages?.expanded?.capturedStates
      ?? 0,
    actions: result?.stages?.abstraction?.summary?.actions ?? 0,
    documents: result?.stages?.docs?.summary?.documents ?? 0,
  };
}

function nextCommands(inputUrl, skillName) {
  return [
    ['Inspect generated skill', `node ./src/entrypoints/cli.mjs inspect ${skillName}`],
    ['Validate knowledge base', `node ./src/entrypoints/cli.mjs lint ${skillName}`],
    ['Rebuild with verbose logs', `node ./src/entrypoints/cli.mjs build ${inputUrl} --verbose`],
    ['Show raw JSON', `node ./src/entrypoints/cli.mjs build ${inputUrl} --json`],
  ];
}

export function renderBuildSummary(result, options = {}) {
  const lines = [];
  const stdoutColumns = Number(options.columns ?? 100) || 100;
  const verbose = options.verbose === true;
  const useGlyphs = options.ascii ? GLYPHS.ascii : GLYPHS.unicode;
  const warning = hasWarnings(result);
  const statusIcon = warning ? useGlyphs.warning : useGlyphs.completed;
  const statusText = warning ? 'Site skill generated with warnings' : 'Site skill generated';
  const skillName = result?.skillName ?? basenameSkillFromUrl(result?.inputUrl);
  const quality = collectQuality(result);
  const numbers = summarizeNumbers(result);
  const durationMs = Number(options.durationMs ?? 0);
  const pathWidth = Math.max(28, Math.min(90, stdoutColumns - 8));

  lines.push(`${statusIcon} ${statusText}`);
  lines.push('');
  lines.push('Summary');
  lines.push('');
  lines.push(row('Skill', skillName));
  lines.push(row('Site', result?.inputUrl));
  lines.push(row('Pages', numbers.pages));
  lines.push(row('States', numbers.states));
  lines.push(row('Actions', numbers.actions));
  lines.push(row('Documents', numbers.documents));
  lines.push(row('Warnings', quality.warnings));
  lines.push(row('Duration', formatDuration(durationMs)));
  lines.push(row('Status', warning ? 'Generated with warnings' : 'Generated'));
  lines.push('');
  lines.push('Artifacts');
  lines.push('');
  if (result?.skillDir) {
    lines.push('  Skill');
    lines.push(`    ${relativeOrCompactPath(result.skillDir, { verbose, maxWidth: pathWidth })}`);
    lines.push('');
  }
  if (result?.kbDir) {
    lines.push('  Knowledge Base');
    lines.push(`    ${relativeOrCompactPath(result.kbDir, { verbose, maxWidth: pathWidth })}`);
    lines.push('');
  }
  const refs = result?.stages?.skill?.references ?? [];
  if (refs.length) {
    lines.push('  References');
    for (const ref of refs) {
      lines.push(`    ${ref}`);
    }
    lines.push('');
  }
  lines.push('Quality');
  lines.push('');
  lines.push(`  ${quality.errors > 0 ? useGlyphs.failed : useGlyphs.completed} ${quality.errors} errors`);
  lines.push(`  ${quality.warnings > 0 ? useGlyphs.warning : useGlyphs.completed} ${quality.warnings} warnings`);
  lines.push(`  ${quality.orphanPages > 0 ? useGlyphs.warning : useGlyphs.completed} ${quality.orphanPages} orphan pages`);
  lines.push(`  ${quality.pendingRiskConfirmations > 0 ? useGlyphs.warning : useGlyphs.completed} ${quality.pendingRiskConfirmations} pending risk confirmations`);
  lines.push(`  ${quality.evidenceGaps > 0 ? useGlyphs.warning : useGlyphs.completed} ${quality.evidenceGaps} evidence gaps`);
  lines.push('');
  lines.push('Next');
  lines.push('');
  for (const [label, command] of nextCommands(result?.inputUrl, skillName)) {
    lines.push(`  ${label}`);
    lines.push(`    ${command}`);
    lines.push('');
  }
  if (options.verbose) {
    lines.push('Stage Details');
    lines.push('');
    for (const [stageId, stage] of Object.entries(result?.stages ?? {})) {
      lines.push(`  ${pipelineStageTitle(stageId)} (${stageId})`);
      if (stage?.outDir) lines.push(`    output: ${relativeOrCompactPath(stage.outDir, { verbose: true })}`);
      if (stage?.kbDir) lines.push(`    output: ${relativeOrCompactPath(stage.kbDir, { verbose: true })}`);
      if (stage?.skillDir) lines.push(`    output: ${relativeOrCompactPath(stage.skillDir, { verbose: true })}`);
      if (stage?.summary) lines.push(`    summary: ${JSON.stringify(stage.summary)}`);
    }
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

export function renderBuildFailure(error, state, options = {}) {
  const useGlyphs = options.ascii ? GLYPHS.ascii : GLYPHS.unicode;
  const stage = state.currentStage ?? state.stages.find((entry) => entry.status === 'failed');
  const reason = error?.message ?? String(error);
  const lines = [
    `${useGlyphs.failed} Build failed${stage ? ` at stage ${stage.index}/${state.stages.length}: ${stage.title}` : ''}`,
    '',
    'Reason',
    `  ${reason}`,
    '',
    'Safety',
    `  ${progressText(SAFETY_STOP_COPY, 'zh')}`,
    '',
    'Try',
    `  node ./src/entrypoints/cli.mjs build ${state.inputUrl} --verbose`,
    `  node ./src/entrypoints/sites/site-doctor.mjs ${state.inputUrl}`,
    '',
    'Debug',
    '  Run with --debug to show stack trace and raw diagnostic JSON.',
  ];
  if (options.debug && error?.stack) {
    lines.push('', 'Stack', String(error.stack));
  }
  return `${lines.join('\n')}\n`;
}

export class BuildProgressController {
  constructor({
    inputUrl,
    stageSpecs,
    options = {},
    stdout = process.stdout,
    stderr = process.stderr,
    cwd = process.cwd(),
  } = {}) {
    this.inputUrl = inputUrl;
    this.options = options;
    this.stdout = stdout;
    this.stderr = stderr;
    this.stream = stderr;
    this.cwd = cwd;
    this.mode = resolveProgressMode({
      stdout,
      stderr,
      mode: options.progressMode ?? 'auto',
      forceTty: options.forceTty,
      noTty: options.noTty,
      json: options.json,
      quiet: options.quiet,
      env: process.env,
    });
    this.mode = options.compact && this.mode === 'interactive' ? 'plain' : this.mode;
    this.color = useColor(options, this.mode, this.stream);
    this.unicode = useUnicode(options, this.mode);
    this.glyphs = this.unicode ? GLYPHS.unicode : GLYPHS.ascii;
    this.columns = Number(options.columns ?? this.stream?.columns ?? 100) || 100;
    this.startedAt = Date.now();
    this.spinnerIndex = 0;
    this.renderedLines = 0;
    this.renderedRows = 0;
    this.finalized = false;
    this.stages = stageSpecs.map((stageSpec, index) => ({
      id: stageSpec.name,
      title: pipelineStageTitle(stageSpec.name),
      index: index + 1,
      total: stageSpecs.length,
      status: 'pending',
      startedAt: null,
      finishedAt: null,
      durationMs: null,
      progressCurrent: null,
      progressTotal: null,
      currentItem: null,
      message: null,
      outputDir: null,
      summary: null,
      warnings: [],
      error: null,
    }));
    this.currentStage = null;
  }

  stage(input = {}) {
    const stage = this.stages.find((entry) => entry.id === input.id) ?? this.stages[input.index - 1];
    if (!stage) {
      return this.#noopStage();
    }
    stage.status = 'running';
    stage.startedAt = Date.now();
    stage.currentItem = input.item ?? this.inputUrl;
    stage.message = input.message ?? 'running';
    this.currentStage = stage;
    this.#emitPlainStage(stage, 'start');
    this.#render();
    return {
      update: (update = {}) => this.#updateStage(stage, update, 'running'),
      succeed: (update = {}) => this.#completeStage(stage, update, 'completed'),
      warn: (update = {}) => this.#completeStage(stage, update, 'warning'),
      fail: (update = {}) => this.#completeStage(stage, update, 'failed'),
      skip: (update = {}) => this.#completeStage(stage, update, 'skipped'),
      cancel: (update = {}) => this.#completeStage(stage, update, 'failed'),
      subtask: () => this.#noopStage(),
    };
  }

  complete(result = {}) {
    this.finalized = true;
    if (this.mode === 'interactive') {
      this.#clearPanel();
    }
    const warning = hasWarnings(result);
    if (this.mode === 'plain') {
      const statusText = warning ? 'Site skill generated with warnings.' : 'Site skill generated.';
      this.stream.write(`${statusText}\n`);
      if (result?.skillDir) this.stream.write(`Skill: ${relativeOrCompactPath(result.skillDir, { cwd: this.cwd, verbose: this.options.verbose })}\n`);
      if (result?.kbDir) this.stream.write(`Knowledge base: ${relativeOrCompactPath(result.kbDir, { cwd: this.cwd, verbose: this.options.verbose })}\n`);
      const quality = collectQuality(result);
      this.stream.write(`Warnings: ${quality.warnings}\n`);
    }
  }

  fail(error) {
    this.finalized = true;
    if (this.mode === 'interactive') {
      this.#clearPanel();
    }
    if (this.mode !== 'silent') {
      this.stream.write(renderBuildFailure(error, this, this.options));
    }
  }

  #noopStage() {
    return {
      update: () => {},
      succeed: () => {},
      warn: () => {},
      fail: () => {},
      skip: () => {},
      cancel: () => {},
      subtask: () => this.#noopStage(),
    };
  }

  #updateStage(stage, update, status) {
    stage.status = normalizeStatus(status);
    stage.message = update.message ?? stage.message;
    stage.currentItem = update.item ?? stage.currentItem;
    stage.progressCurrent = update.current ?? stage.progressCurrent;
    stage.progressTotal = update.total ?? stage.progressTotal;
    stage.outputDir = update.outputDir ?? update.outDir ?? stage.outputDir;
    if (Array.isArray(update.warnings)) stage.warnings.push(...update.warnings);
    this.#render();
  }

  #completeStage(stage, update, status) {
    stage.status = normalizeStatus(status);
    stage.finishedAt = Date.now();
    stage.durationMs = stage.finishedAt - (stage.startedAt ?? stage.finishedAt);
    stage.message = update.message ?? stage.message;
    stage.currentItem = update.item ?? stage.currentItem;
    stage.outputDir = update.outputDir ?? update.outDir ?? update.message ?? stage.outputDir;
    if (status === 'failed') stage.error = update.message ?? update.error ?? 'failed';
    if (Array.isArray(update.warnings)) stage.warnings.push(...update.warnings);
    this.#emitPlainStage(stage, status);
    this.#render();
  }

  #stageIcon(stage) {
    if (stage.status === 'running') {
      const frames = this.glyphs.running;
      const frame = frames[this.spinnerIndex % frames.length];
      this.spinnerIndex += 1;
      return frame;
    }
    return this.glyphs[stage.status] ?? this.glyphs.pending;
  }

  #overallCurrent() {
    const completed = this.stages.filter((stage) => ['completed', 'warning', 'skipped'].includes(stage.status)).length;
    const running = this.stages.some((stage) => stage.status === 'running') ? 0.35 : 0;
    return Math.min(this.stages.length, completed + running);
  }

  #currentStageProgress(stage) {
    if (!stage) return null;
    if (Number.isFinite(Number(stage.progressCurrent)) && Number.isFinite(Number(stage.progressTotal)) && Number(stage.progressTotal) > 0) {
      return {
        current: Number(stage.progressCurrent),
        total: Number(stage.progressTotal),
        label: `${stage.progressCurrent}/${stage.progressTotal}`,
      };
    }
    return null;
  }

  #panelLines() {
    const current = this.currentStage ?? this.stages.find((stage) => stage.status === 'running');
    const overallCurrent = this.#overallCurrent();
    const overallWidth = this.options.compact ? 16 : 20;
    const compact = this.columns < 84 || this.options.compact;
    const site = truncateText(this.inputUrl, compact ? Math.max(28, this.columns - 22) : 78);
    const skill = basenameSkillFromUrl(this.inputUrl);
    const elapsed = formatDuration(Date.now() - this.startedAt);
    const currentProgress = this.#currentStageProgress(current);
    const lines = [
      color(this.color, 'bold', 'Browser Wiki Skill'),
      '',
      `Generating site skill for ${site}`,
      '',
      `Overall   ${renderProgressBar(overallCurrent, this.stages.length, { width: overallWidth, unicode: this.unicode })}  ${formatPercent(overallCurrent, this.stages.length)}  ${Math.floor(overallCurrent)}/${this.stages.length} stages`,
    ];
    if (currentProgress) {
      lines.push(`Current   ${renderProgressBar(currentProgress.current, currentProgress.total, { width: overallWidth, unicode: this.unicode })}  ${formatPercent(currentProgress.current, currentProgress.total)}  ${current?.title}`);
    } else {
      const icon = current ? this.#stageIcon(current) : this.glyphs.pending;
      lines.push(`Current   ${icon} ${current?.message ?? current?.title ?? 'pending'}  ${elapsed}`);
    }
    lines.push(`Elapsed   ${elapsed}`);
    if (current) {
      lines.push(`Stage     ${current.index}/${this.stages.length} · ${current.title}`);
      if (current.currentItem) {
        lines.push(`Item      ${truncateText(relativeOrCompactPath(current.currentItem, { cwd: this.cwd, maxWidth: Math.max(24, this.columns - 12) }) ?? current.currentItem, Math.max(24, this.columns - 12))}`);
      }
    }
    lines.push('', 'Pipeline', '');
    for (const stage of this.stages) {
      const icon = this.#stageIcon(stage);
      const duration = stage.durationMs !== null ? `${(stage.durationMs / 1000).toFixed(1)}s` : stage.status;
      const line = `  ${color(this.color, statusTone(stage.status), icon)} ${String(stage.index).padStart(2, ' ')}. ${padRight(stage.title, compact ? 18 : 28)} ${duration}`;
      lines.push(truncateText(line, Math.max(30, this.columns - 1)));
    }
    return lines;
  }

  #render() {
    if (this.finalized || this.mode !== 'interactive') return;
    const lines = this.#panelLines();
    if (this.renderedRows > 0) {
      readline.moveCursor(this.stream, 0, -this.renderedRows);
      readline.clearScreenDown(this.stream);
    }
    for (const line of lines) {
      readline.clearLine(this.stream, 0);
      readline.cursorTo(this.stream, 0);
      this.stream.write(`${line}\n`);
    }
    this.renderedLines = lines.length;
    this.renderedRows = lines.length;
  }

  #clearPanel() {
    if (this.renderedRows <= 0) return;
    readline.moveCursor(this.stream, 0, -this.renderedRows);
    readline.clearScreenDown(this.stream);
    readline.cursorTo(this.stream, 0);
    this.renderedLines = 0;
    this.renderedRows = 0;
  }

  #emitPlainStage(stage, event) {
    if (this.mode !== 'plain') return;
    if (event === 'start') {
      this.stream.write(`[${stage.index}/${this.stages.length}] ${stage.title}... running\n`);
      return;
    }
    const duration = stage.durationMs !== null ? ` in ${(stage.durationMs / 1000).toFixed(1)}s` : '';
    const message = stage.status === 'warning'
      ? `warning: ${stage.message ?? 'completed with warnings'}`
      : stage.status === 'failed'
        ? `failed: ${stage.error ?? stage.message ?? 'failed'}`
        : stage.status === 'skipped'
          ? `skipped: ${stage.message ?? 'skipped'}`
          : `done${duration}`;
    this.stream.write(`[${stage.index}/${this.stages.length}] ${stage.title}... ${message}\n`);
  }
}

export function createBuildProgressController(options) {
  return new BuildProgressController(options);
}
