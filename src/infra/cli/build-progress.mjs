// @ts-check

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
import { relativeOrCompactPath } from './path-display.mjs';

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

function statusLabel(status) {
  if (status === 'completed') return '已完成';
  if (status === 'warning') return '有警告';
  if (status === 'failed') return '失败';
  if (status === 'skipped') return '已跳过';
  if (status === 'pending') return '等待中';
  if (status === 'running') return '运行中';
  return String(status ?? '-');
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
  return result?.pipelinePartial === true
    || quality.warnings > 0
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
    ['重新运行构建', `siteforge build ${inputUrl}`],
  ];
}

export function renderBuildSummary(result, options = {}) {
  const lines = [];
  const stdoutColumns = Number(options.columns ?? 100) || 100;
  const verbose = options.verbose === true;
  const useGlyphs = options.ascii ? GLYPHS.ascii : GLYPHS.unicode;
  const partial = result?.pipelinePartial === true;
  const warning = hasWarnings(result);
  const statusIcon = warning ? useGlyphs.warning : useGlyphs.completed;
  const statusText = partial
    ? '已生成部分预览'
    : warning ? '站点 Skill 已生成，但存在警告' : '站点 Skill 已生成';
  const skillName = result?.skillName ?? basenameSkillFromUrl(result?.inputUrl);
  const quality = collectQuality(result);
  const numbers = summarizeNumbers(result);
  const durationMs = Number(options.durationMs ?? 0);
  const pathWidth = Math.max(28, Math.min(90, stdoutColumns - 8));

  lines.push(`${statusIcon} ${statusText}`);
  lines.push('');
  lines.push('摘要');
  lines.push('');
  lines.push(row('Skill', skillName));
  lines.push(row('站点', result?.inputUrl));
  lines.push(row('页面', numbers.pages));
  lines.push(row('状态数', numbers.states));
  lines.push(row('动作', numbers.actions));
  lines.push(row('文档', numbers.documents));
  lines.push(row('警告', quality.warnings));
  lines.push(row('耗时', formatDuration(durationMs)));
  lines.push(row('状态', partial ? '部分预览' : warning ? '已生成但有警告' : '已生成'));
  lines.push('');
  lines.push('产物');
  lines.push('');
  if (result?.skillDir) {
    lines.push('  Skill');
    lines.push(`    ${relativeOrCompactPath(result.skillDir, { verbose, maxWidth: pathWidth })}`);
    lines.push('');
  }
  if (result?.kbDir) {
    lines.push('  知识库');
    lines.push(`    ${relativeOrCompactPath(result.kbDir, { verbose, maxWidth: pathWidth })}`);
    lines.push('');
  }
  if (result?.partialPreview?.artifactPath) {
    lines.push('  部分预览');
    lines.push(`    ${relativeOrCompactPath(result.partialPreview.artifactPath, { verbose, maxWidth: pathWidth })}`);
    lines.push('');
  }
  const refs = result?.stages?.skill?.references ?? [];
  if (refs.length) {
    lines.push('  参考文件');
    for (const ref of refs) {
      lines.push(`    ${ref}`);
    }
    lines.push('');
  }
  lines.push('质量');
  lines.push('');
  lines.push(`  ${quality.errors > 0 ? useGlyphs.failed : useGlyphs.completed} ${quality.errors} 个错误`);
  lines.push(`  ${quality.warnings > 0 ? useGlyphs.warning : useGlyphs.completed} ${quality.warnings} 个警告`);
  lines.push(`  ${quality.orphanPages > 0 ? useGlyphs.warning : useGlyphs.completed} ${quality.orphanPages} 个孤立页面`);
  lines.push(`  ${quality.pendingRiskConfirmations > 0 ? useGlyphs.warning : useGlyphs.completed} ${quality.pendingRiskConfirmations} 个待确认风险`);
  lines.push(`  ${quality.evidenceGaps > 0 ? useGlyphs.warning : useGlyphs.completed} ${quality.evidenceGaps} 个证据缺口`);
  lines.push('');
  lines.push('下一步');
  lines.push('');
  for (const [label, command] of nextCommands(result?.inputUrl, skillName)) {
    lines.push(`  ${label}`);
    lines.push(`    ${command}`);
    lines.push('');
  }
  if (options.verbose) {
    lines.push('阶段详情');
    lines.push('');
    for (const [stageId, stage] of Object.entries(result?.stages ?? {})) {
      lines.push(`  ${pipelineStageTitle(stageId)} (${stageId})`);
      if (stage?.outDir) lines.push(`    输出：${relativeOrCompactPath(stage.outDir, { verbose: true })}`);
      if (stage?.kbDir) lines.push(`    输出：${relativeOrCompactPath(stage.kbDir, { verbose: true })}`);
      if (stage?.skillDir) lines.push(`    输出：${relativeOrCompactPath(stage.skillDir, { verbose: true })}`);
      if (stage?.summary) lines.push(`    摘要：${JSON.stringify(stage.summary)}`);
    }
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

export function renderBuildFailure(error, state, options = {}) {
  const useGlyphs = options.ascii ? GLYPHS.ascii : GLYPHS.unicode;
  const stage = state.currentStage ?? state.stages.find((entry) => entry.status === 'failed');
  const reason = error?.message ?? String(error);
  const lines = [
    `${useGlyphs.failed} 构建失败${stage ? `，阶段 ${stage.index}/${state.stages.length}：${stage.title}` : ''}`,
    '',
    '原因',
    `  ${reason}`,
    '',
    '安全边界',
    `  ${progressText(SAFETY_STOP_COPY, 'zh')}`,
    '',
    '可重试',
    `  siteforge build ${state.inputUrl}`,
  ];
  if (options.debug && error?.stack) {
    lines.push('', '堆栈', String(error.stack));
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
    stage.message = input.message ?? '运行中';
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
      const statusText = result?.pipelinePartial === true
        ? '已生成部分预览。'
        : warning ? '站点 Skill 已生成，但存在警告。' : '站点 Skill 已生成。';
      this.stream.write(`${statusText}\n`);
      if (result?.skillDir) this.stream.write(`Skill：${relativeOrCompactPath(result.skillDir, { cwd: this.cwd, verbose: this.options.verbose })}\n`);
      if (result?.kbDir) this.stream.write(`知识库：${relativeOrCompactPath(result.kbDir, { cwd: this.cwd, verbose: this.options.verbose })}\n`);
      if (result?.partialPreview?.artifactPath) this.stream.write(`部分预览：${relativeOrCompactPath(result.partialPreview.artifactPath, { cwd: this.cwd, verbose: this.options.verbose })}\n`);
      const quality = collectQuality(result);
      this.stream.write(`警告：${quality.warnings}\n`);
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
    if (status === 'failed') stage.error = update.message ?? update.error ?? '失败';
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
      color(this.color, 'bold', 'SiteForge'),
      '',
      `正在为 ${site} 生成站点 Skill`,
      '',
      `总进度   ${renderProgressBar(overallCurrent, this.stages.length, { width: overallWidth, unicode: this.unicode })}  ${formatPercent(overallCurrent, this.stages.length)}  ${Math.floor(overallCurrent)}/${this.stages.length} 个阶段`,
    ];
    if (currentProgress) {
      lines.push(`当前     ${renderProgressBar(currentProgress.current, currentProgress.total, { width: overallWidth, unicode: this.unicode })}  ${formatPercent(currentProgress.current, currentProgress.total)}  ${current?.title}`);
    } else {
      const icon = current ? this.#stageIcon(current) : this.glyphs.pending;
      lines.push(`当前     ${icon} ${current?.message ?? current?.title ?? '等待中'}  ${elapsed}`);
    }
    lines.push(`已用时   ${elapsed}`);
    if (current) {
      lines.push(`阶段     ${current.index}/${this.stages.length} - ${current.title}`);
      if (current.currentItem) {
        lines.push(`项目     ${truncateText(relativeOrCompactPath(current.currentItem, { cwd: this.cwd, maxWidth: Math.max(24, this.columns - 12) }) ?? current.currentItem, Math.max(24, this.columns - 12))}`);
      }
    }
    lines.push('', '流水线', '');
    for (const stage of this.stages) {
      const icon = this.#stageIcon(stage);
      const duration = stage.durationMs !== null ? `${(stage.durationMs / 1000).toFixed(1)}s` : statusLabel(stage.status);
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
      this.stream.write(`[${stage.index}/${this.stages.length}] ${stage.title}... 运行中\n`);
      return;
    }
    const duration = stage.durationMs !== null ? `，耗时 ${(stage.durationMs / 1000).toFixed(1)}s` : '';
    const message = stage.status === 'warning'
      ? `警告：${stage.message ?? '完成但存在警告'}`
      : stage.status === 'failed'
        ? `失败：${stage.error ?? stage.message ?? '失败'}`
        : stage.status === 'skipped'
          ? `已跳过：${stage.message ?? '已跳过'}`
          : `完成${duration}`;
    this.stream.write(`[${stage.index}/${this.stages.length}] ${stage.title}... ${message}\n`);
  }
}

export function createBuildProgressController(options) {
  return new BuildProgressController(options);
}
