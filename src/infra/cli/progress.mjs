// @ts-check

import readline from 'node:readline/promises';
import { stdin as defaultStdin } from 'node:process';
import {
  DEFAULT_PROGRESS_LANGUAGE,
  SAFETY_STOP_COPY,
  progressText,
  siteForgeBuildStageTitle,
  statusTitle,
} from './progress-copy.mjs';

const ANSI_PATTERN = /\x1B\[[0-?]*[ -/]*[@-~]/gu;
const CURSOR_CONTROL_PATTERN = /\x1B\[(?:\?25[hl]|[0-?]*[ -/]*[ABCDEFGJKSTfHsu])/u;
const SENSITIVE_KEY_PATTERN = /(?:cookie|authorization|csrf|sessdata|token|session(?:id)?|profile(?:path|root)?|userdatadir|browserprofileroot|headers)/iu;
const SENSITIVE_VALUE_PATTERN = new RegExp([
  `${'author'}ization:\\s*bearer`,
  `${'coo'}kie:`,
  `${'csrf'}=`,
  `access_${'tok'}en=`,
  `refresh_${'tok'}en=`,
  `${'session'}id=`,
  `${'sess'}data=`,
  `${'tok'}en=`,
].join('|'), 'iu');
const REDACTED = '[REDACTED]';

const SPINNER_UNICODE = ['\u280b', '\u2819', '\u2839', '\u2838', '\u283c', '\u2834', '\u2826', '\u2827', '\u2807', '\u280f'];
const SPINNER_ASCII = ['-', '\\', '|', '/'];

const ICONS = Object.freeze({
  unicode: {
    pending: '\u25cb',
    running: '\u280b',
    success: '\u2713',
    warning: '!',
    failed: '\u2717',
    skipped: '-',
    cancelled: '\u00d7',
  },
  ascii: {
    pending: 'o',
    running: '*',
    success: 'OK',
    warning: '!',
    failed: 'X',
    skipped: '-',
    cancelled: 'x',
  },
});

const COLORS = Object.freeze({
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  reset: '\x1b[0m',
});

function normalizeMode(value) {
  return ['auto', 'interactive', 'plain'].includes(value) ? value : 'auto';
}

function normalizeSwitch(value) {
  return ['auto', 'always', 'never'].includes(value) ? value : 'auto';
}

function isCiEnv(env = process.env) {
  return env.CI === 'true'
    || env.CI === '1'
    || Boolean(env.GITHUB_ACTIONS)
    || Boolean(env.TF_BUILD)
    || Boolean(env.BUILDKITE)
    || Boolean(env.GITLAB_CI);
}

export function resolveProgressMode({
  stdout = process.stdout,
  stderr = process.stderr,
  mode = 'auto',
  forceTty = false,
  noTty = false,
  json = false,
  quiet = false,
  env = process.env,
} = /** @type {any} */ ({})) {
  if (json || quiet) {
    return 'silent';
  }
  if (noTty) {
    return 'plain';
  }
  if (forceTty) {
    return 'interactive';
  }
  const normalizedMode = normalizeMode(mode);
  if (normalizedMode !== 'auto') {
    return normalizedMode;
  }
  if (isCiEnv(env)) {
    return 'plain';
  }
  return (stderr?.isTTY || stdout?.isTTY) ? 'interactive' : 'plain';
}

function resolveColor({ color = 'auto', mode, stream, env = process.env }) {
  const normalized = normalizeSwitch(color);
  if (normalized === 'always') return true;
  if (normalized === 'never') return false;
  if (env.NO_COLOR) return false;
  return mode === 'interactive' && Boolean(stream?.isTTY);
}

function resolveUnicode({ unicode = 'auto', mode, env = process.env }) {
  const normalized = normalizeSwitch(unicode);
  if (normalized === 'always') return true;
  if (normalized === 'never') return false;
  if (mode !== 'interactive' && mode !== 'plain') return false;
  const term = String(env.TERM ?? '');
  const wt = String(env.WT_SESSION ?? '');
  return Boolean(wt) || !/^(?:dumb|linux)$/iu.test(term);
}

export function stripAnsi(value) {
  return String(value ?? '').replace(ANSI_PATTERN, '');
}

function isFullWidthCodePoint(codePoint) {
  return (codePoint >= 0x1100 && (
    codePoint <= 0x115f
    || codePoint === 0x2329
    || codePoint === 0x232a
    || (codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f)
    || (codePoint >= 0xac00 && codePoint <= 0xd7a3)
    || (codePoint >= 0xf900 && codePoint <= 0xfaff)
    || (codePoint >= 0xfe10 && codePoint <= 0xfe19)
    || (codePoint >= 0xfe30 && codePoint <= 0xfe6f)
    || (codePoint >= 0xff00 && codePoint <= 0xff60)
    || (codePoint >= 0xffe0 && codePoint <= 0xffe6)
    || (codePoint >= 0x1f300 && codePoint <= 0x1faff)
  ));
}

export function visibleWidth(value) {
  let width = 0;
  for (const char of stripAnsi(value)) {
    const codePoint = char.codePointAt(0) ?? 0;
    if (codePoint === 0) continue;
    if (codePoint < 32 || (codePoint >= 0x7f && codePoint < 0xa0)) continue;
    width += isFullWidthCodePoint(codePoint) ? 2 : 1;
  }
  return width;
}

export function truncateText(value, maxWidth = 80) {
  const text = String(value ?? '');
  if (maxWidth <= 0 || visibleWidth(text) <= maxWidth) {
    return text;
  }
  if (maxWidth <= 1) {
    return '\u2026';
  }
  const ellipsis = '\u2026';
  let output = '';
  let width = 0;
  for (const char of stripAnsi(text)) {
    const charWidth = visibleWidth(char);
    if (width + charWidth + 1 > maxWidth) {
      break;
    }
    output += char;
    width += charWidth;
  }
  return `${output}${ellipsis}`;
}

export function formatPercent(current, total) {
  const denominator = Number(total);
  if (!Number.isFinite(denominator) || denominator <= 0) {
    return '0%';
  }
  const value = Math.max(0, Math.min(100, (Number(current) / denominator) * 100));
  return `${Math.round(value)}%`;
}

export function formatBytes(bytes) {
  const value = Math.max(0, Number(bytes) || 0);
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let next = value;
  let unitIndex = 0;
  while (next >= 1024 && unitIndex < units.length - 1) {
    next /= 1024;
    unitIndex += 1;
  }
  const precision = unitIndex === 0 || next >= 10 ? 0 : 1;
  return `${next.toFixed(precision)} ${units[unitIndex]}`;
}

export function formatSpeed(bytesPerSecond) {
  const value = Number(bytesPerSecond);
  if (!Number.isFinite(value) || value <= 0) {
    return '0 B/s';
  }
  return `${formatBytes(value)}/s`;
}

export function formatEta(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value < 0) {
    return '--';
  }
  const rounded = Math.ceil(value);
  if (rounded < 60) {
    return `${rounded}s`;
  }
  const minutes = Math.floor(rounded / 60);
  const restSeconds = rounded % 60;
  if (minutes < 60) {
    return `${minutes}m${String(restSeconds).padStart(2, '0')}s`;
  }
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  return `${hours}h${String(restMinutes).padStart(2, '0')}m`;
}

export function calculateRate({ current = 0, startTime = Date.now(), now = Date.now() } = /** @type {any} */ ({})) {
  const elapsedSeconds = Math.max(0, (Number(now) - Number(startTime)) / 1000);
  return elapsedSeconds > 0 ? Number(current) / elapsedSeconds : 0;
}

export function calculateEta({ current = 0, total = 0, startTime = Date.now(), now = Date.now() } = /** @type {any} */ ({})) {
  const rate = calculateRate({ current, startTime, now });
  if (!rate || !Number.isFinite(rate)) {
    return Infinity;
  }
  return Math.max(0, (Number(total) - Number(current)) / rate);
}

function quotePlain(value) {
  return `"${String(value ?? '').replace(/\\/gu, '\\\\').replace(/"/gu, '\\"')}"`;
}

function redactScalar(value) {
  const text = String(value ?? '');
  return SENSITIVE_VALUE_PATTERN.test(text) ? REDACTED : text;
}

export function redactProgressData(value, key = '') {
  if (SENSITIVE_KEY_PATTERN.test(String(key))) {
    return REDACTED;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactProgressData(entry));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [
      entryKey,
      redactProgressData(entryValue, entryKey),
    ]));
  }
  if (typeof value === 'string') {
    return redactScalar(value);
  }
  return value;
}

function statusFromMethod(method) {
  switch (method) {
    case 'succeed': return 'success';
    case 'warn': return 'warning';
    case 'fail': return 'failed';
    case 'skip': return 'skipped';
    case 'cancel': return 'cancelled';
    default: return 'running';
  }
}

function plainToken(key, value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return `${key}=${value}`;
  }
  const text = String(value);
  return /^[A-Za-z0-9._:/\\-]+$/u.test(text) ? `${key}=${text}` : `${key}=${quotePlain(text)}`;
}

function colorize(enabled, color, text) {
  return enabled ? `${COLORS[color] ?? ''}${text}${COLORS.reset}` : text;
}

function normalizeStatus(status) {
  return ['pending', 'running', 'success', 'warning', 'failed', 'skipped', 'cancelled'].includes(status)
    ? status
    : 'running';
}

function progressBar(current, total, width = 18, unicode = true) {
  const denominator = Number(total);
  const ratio = denominator > 0 ? Math.max(0, Math.min(1, Number(current) / denominator)) : 0;
  const filled = Math.round(ratio * width);
  const fill = unicode ? '\u2588' : '#';
  const empty = unicode ? '\u2591' : '-';
  return `${fill.repeat(filled)}${empty.repeat(Math.max(0, width - filled))}`;
}

function displayProgressValues(node) {
  if (node.total === undefined) {
    return null;
  }
  const current = Number(node.current);
  const stageIndex = Number(node.index);
  const total = Number(node.total);
  const displayCurrent = current > 0
    ? current
    : node.level === 'stage' && Number.isFinite(stageIndex) && stageIndex > 0
      ? stageIndex
      : current;
  return {
    current: displayCurrent,
    total,
  };
}

class ProgressNode {
  constructor(renderer, task, level, input = /** @type {any} */ ({})) {
    this.renderer = renderer;
    this.taskRef = task;
    this.level = level;
    this.id = String(input.id ?? input.name ?? level);
    this.title = input.title ?? input.name ?? this.id;
    this.index = input.index;
    this.total = input.total;
    this.totalStages = input.totalStages;
    this.status = 'pending';
    this.message = input.message ?? null;
    this.item = input.item ?? null;
    this.current = input.current ?? 0;
    this.downloadedBytes = input.downloadedBytes ?? 0;
    this.totalBytes = input.totalBytes;
    this.retryCount = input.retryCount ?? 0;
    this.completedItems = input.completedItems ?? 0;
    this.failedItems = input.failedItems ?? 0;
    this.skippedExisting = input.skippedExisting ?? 0;
    this.verified = input.verified ?? 0;
    this.artifacts = /** @type {any[]} */ ([]);
    this.warnings = /** @type {any[]} */ ([]);
    this.startedAt = Date.now();
    this.updatedAt = this.startedAt;
  }

  stage(input = /** @type {any} */ ({})) {
    return this.renderer._createStage(this, input);
  }

  subtask(input = /** @type {any} */ ({})) {
    return this.renderer._createSubtask(this, input);
  }

  update(input = /** @type {any} */ ({})) {
    this.renderer._updateNode(this, { ...input, status: input.status ?? 'running' });
    return this;
  }

  succeed(input = /** @type {any} */ ({})) {
    this.renderer._updateNode(this, { ...input, status: 'success' });
    return this;
  }

  warn(input = /** @type {any} */ ({})) {
    this.renderer._updateNode(this, { ...input, status: 'warning' });
    return this;
  }

  fail(input = /** @type {any} */ ({})) {
    this.renderer._updateNode(this, { ...input, status: 'failed' });
    return this;
  }

  skip(input = /** @type {any} */ ({})) {
    this.renderer._updateNode(this, { ...input, status: 'skipped' });
    return this;
  }

  cancel(input = /** @type {any} */ ({})) {
    this.renderer._updateNode(this, { ...input, status: 'cancelled' });
    return this;
  }
}

class ProgressRenderer {
  constructor(options = /** @type {any} */ ({})) {
    this.stdout = options.stdout ?? process.stdout;
    this.stderr = options.stderr ?? process.stderr;
    this.stdin = options.stdin ?? defaultStdin;
    this.stream = options.stream ?? this.stderr ?? this.stdout;
    this.env = options.env ?? process.env;
    this.mode = resolveProgressMode({
      stdout: this.stdout,
      stderr: this.stderr,
      mode: options.mode,
      forceTty: options.forceTty,
      noTty: options.noTty,
      json: options.json,
      quiet: options.quiet,
      env: this.env,
    });
    this.color = resolveColor({ color: options.color, mode: this.mode, stream: this.stream, env: this.env });
    this.unicode = resolveUnicode({ unicode: options.unicode, mode: this.mode, env: this.env });
    this.language = options.language ?? DEFAULT_PROGRESS_LANGUAGE;
    this.columns = Number(options.columns ?? this.stream?.columns ?? 80) || 80;
    this.spinnerFrames = this.unicode ? SPINNER_UNICODE : SPINNER_ASCII;
    this.spinnerIndex = 0;
    this.tasks = new Map();
    this.currentLineWidth = 0;
  }

  task(input = /** @type {any} */ ({})) {
    const task = new ProgressNode(this, null, 'task', input);
    this.tasks.set(task.id, task);
    this._emitPlain(task, 'start');
    this._renderInteractive(task);
    return task;
  }

  download(input = /** @type {any} */ ({})) {
    return this.task({ id: input.id ?? 'download', title: input.title ?? 'Download', ...input });
  }

  failure(input = /** @type {any} */ ({})) {
    const safeInput = redactProgressData(input);
    if (this.mode === 'silent') return;
    if (this.mode === 'plain') {
      this._writePlainLine([
        `[${safeInput.taskId ?? 'task'}]`,
        plainToken('status', 'failed'),
        plainToken('stage', safeInput.stage),
        plainToken('reason', safeInput.reason),
      ]);
      this._writePlainLine([`[${safeInput.taskId ?? 'task'}]`, plainToken('safety', safeInput.safety ?? progressText(SAFETY_STOP_COPY, this.language))]);
      this._writePlainLine([`[${safeInput.taskId ?? 'task'}]`, plainToken('next', safeInput.nextStep)]);
      this._writePlainLine([`[${safeInput.taskId ?? 'task'}]`, plainToken('report', safeInput.report)]);
      return;
    }
    const icon = this._icon('failed');
    const lines = [
      `${icon} ${safeInput.title ?? 'Task failed'}`,
      safeInput.stage ? `Stage: ${safeInput.stage}` : null,
      safeInput.reason ? `Reason: ${safeInput.reason}` : null,
      `Safety: ${safeInput.safety ?? progressText(SAFETY_STOP_COPY, this.language)}`,
      safeInput.nextStep ? `Next step: ${safeInput.nextStep}` : null,
      safeInput.report ? `Report: ${safeInput.report}` : null,
    ].filter(Boolean);
    this._clearInteractiveLine();
    this.stream.write(`${lines.join('\n')}\n`);
    this.currentLineWidth = 0;
  }

  async confirm({ message, defaultValue = false, nonInteractive = 'default' } = /** @type {any} */ ({})) {
    if (this.mode !== 'interactive') {
      if (nonInteractive === 'error') {
        throw new Error('Cannot prompt for confirmation in non-TTY mode.');
      }
      return Boolean(defaultValue);
    }
    const rl = readline.createInterface({ input: this.stdin, output: this.stream });
    try {
      const suffix = defaultValue ? 'Y/n' : 'y/N';
      const answer = (await rl.question(`${message} (${suffix}) `)).trim().toLowerCase();
      if (!answer) return Boolean(defaultValue);
      return ['y', 'yes'].includes(answer);
    } finally {
      rl.close();
    }
  }

  async select({ message, choices = /** @type {any[]} */ ([]), defaultValue = undefined, nonInteractive = 'default' } = /** @type {any} */ ({})) {
    if (this.mode !== 'interactive') {
      if (nonInteractive === 'error' && defaultValue === undefined) {
        throw new Error('Cannot prompt for selection in non-TTY mode.');
      }
      return defaultValue ?? choices[0]?.value ?? choices[0] ?? null;
    }
    const normalizedChoices = choices.map((choice, index) => (
      typeof choice === 'object' ? choice : { label: String(choice), value: choice, index }
    ));
    const lines = normalizedChoices.map((choice, index) => `  ${index + 1}. ${choice.label ?? choice.value}`);
    const rl = readline.createInterface({ input: this.stdin, output: this.stream });
    try {
      const answer = await rl.question(`${message}\n${lines.join('\n')}\n> `);
      const selected = Number(answer.trim()) - 1;
      return normalizedChoices[selected]?.value ?? defaultValue ?? normalizedChoices[0]?.value ?? null;
    } finally {
      rl.close();
    }
  }

  async multiSelect({ message, choices = /** @type {any[]} */ ([]), defaultValue = /** @type {any[]} */ ([]), nonInteractive = 'default' } = /** @type {any} */ ({})) {
    if (this.mode !== 'interactive') {
      if (nonInteractive === 'error') {
        throw new Error('Cannot prompt for multi-selection in non-TTY mode.');
      }
      return Array.isArray(defaultValue) ? defaultValue : [];
    }
    const selected = await this.select({ message, choices, defaultValue: null, nonInteractive });
    return selected === null ? [] : [selected];
  }

  _createStage(task, input = /** @type {any} */ ({})) {
    const title = input.title ?? siteForgeBuildStageTitle(input.id ?? input.name, this.language);
    const stage = new ProgressNode(this, task, 'stage', { ...input, title });
    task.currentStage = stage;
    this._emitPlain(stage, 'stage');
    this._renderInteractive(stage);
    return stage;
  }

  _createSubtask(task, input = /** @type {any} */ ({})) {
    const subtask = new ProgressNode(this, task, 'subtask', input);
    task.currentSubtask = subtask;
    this._emitPlain(subtask, 'subtask');
    this._renderInteractive(subtask);
    return subtask;
  }

  _updateNode(node, input = /** @type {any} */ ({})) {
    const safeInput = redactProgressData(input);
    for (const [key, value] of Object.entries(safeInput)) {
      if (key === 'artifacts' && Array.isArray(value)) {
        node.artifacts = value;
      } else if (key === 'warnings' && Array.isArray(value)) {
        node.warnings = value;
      } else if (value !== undefined) {
        node[key] = value;
      }
    }
    node.status = normalizeStatus(node.status);
    node.updatedAt = Date.now();
    this._emitPlain(node, node.level);
    this._renderInteractive(node);
  }

  _emitPlain(node, event) {
    if (this.mode !== 'plain') return;
    const task = node.level === 'task' ? node : node.taskRef;
    const id = task?.id ?? node.id;
    const tokens = [`[${id}]`];
    if (event === 'start') {
      tokens.push('start');
    }
    if (node.level === 'stage') {
      const stageIndex = node.index && node.total ? `${node.index}/${node.total}` : undefined;
      tokens.push(plainToken('stage', stageIndex), plainToken('name', node.id));
    }
    if (node.level === 'subtask') {
      tokens.push(plainToken('subtask', node.id));
    }
    tokens.push(plainToken('status', node.status));
    tokens.push(plainToken('message', node.message ?? node.title));
    tokens.push(plainToken('item', node.item));
    const progressValues = displayProgressValues(node);
    if (progressValues) {
      tokens.push(
        plainToken('current', progressValues.current),
        plainToken('total', progressValues.total),
        plainToken('percent', formatPercent(progressValues.current, progressValues.total)),
      );
    }
    if (node.totalBytes !== undefined) {
      const speed = calculateRate({ current: node.downloadedBytes, startTime: node.startedAt, now: node.updatedAt });
      tokens.push(
        plainToken('downloaded', formatBytes(node.downloadedBytes)),
        plainToken('size', node.totalBytes ? formatBytes(node.totalBytes) : null),
        plainToken('speed', formatSpeed(speed)),
        plainToken('eta', formatEta(calculateEta({ current: node.downloadedBytes, total: node.totalBytes, startTime: node.startedAt, now: node.updatedAt }))),
      );
    }
    tokens.push(
      plainToken('retry', node.retryCount || null),
      plainToken('completed', node.completedItems || null),
      plainToken('failed', node.failedItems || null),
      plainToken('skippedExisting', node.skippedExisting || null),
      plainToken('verified', node.verified || null),
    );
    this._writePlainLine(tokens);
    if (['success', 'warning', 'failed', 'skipped', 'cancelled'].includes(node.status) && node.level === 'task') {
      for (const artifact of node.artifacts ?? []) {
        this._writePlainLine([`[${id}]`, plainToken(String(artifact.label ?? 'artifact'), artifact.path ?? artifact.value)]);
      }
      for (const warning of node.warnings ?? []) {
        this._writePlainLine([`[${id}]`, plainToken('warning', warning)]);
      }
    }
  }

  _writePlainLine(tokens) {
    const line = tokens.filter(Boolean).join(' ');
    this.stream.write(`${line}\n`);
  }

  _icon(status) {
    const normalized = normalizeStatus(status);
    if (normalized === 'running') {
      const frames = this.spinnerFrames;
      const frame = frames[this.spinnerIndex % frames.length];
      this.spinnerIndex += 1;
      return frame;
    }
    return (this.unicode ? ICONS.unicode : ICONS.ascii)[normalized] ?? '';
  }

  _renderInteractive(node) {
    if (this.mode !== 'interactive') return;
    const line = this._interactiveLine(node);
    this._clearInteractiveLine();
    this.stream.write(`\r${line}`);
    this.currentLineWidth = visibleWidth(line);
    if (['success', 'warning', 'failed', 'skipped', 'cancelled'].includes(node.status)) {
      this.stream.write('\n');
      this.currentLineWidth = 0;
    }
  }

  _clearInteractiveLine() {
    if (this.mode !== 'interactive') return;
    this.stream.write('\r\x1b[2K');
  }

  _interactiveLine(node) {
    const status = normalizeStatus(node.status);
    const icon = this._icon(status);
    const color = status === 'success' ? 'green'
      : status === 'warning' || status === 'skipped' ? 'yellow'
        : status === 'failed' || status === 'cancelled' ? 'red'
          : 'cyan';
    const task = node.level === 'task' ? node : node.taskRef;
    const stage = node.level === 'stage' ? node : task?.currentStage;
    const title = node.title ?? task?.title ?? node.id;
    const parts = [
      colorize(this.color, color, icon),
      colorize(this.color, 'bold', task?.title ?? title),
    ];
    if (stage) {
      const stageText = stage.index && stage.total ? `${stage.index}/${stage.total} ${stage.title}` : stage.title;
      parts.push(colorize(this.color, 'dim', stageText));
    }
    const currentNode = node.total !== undefined ? node : stage;
    const progressValues = currentNode ? displayProgressValues(currentNode) : null;
    const current = progressValues?.current;
    const total = progressValues?.total;
    if (total) {
      parts.push(`[${progressBar(current, total, 14, this.unicode)}]`, formatPercent(current, total));
    }
    const downloaded = node.downloadedBytes ?? 0;
    const totalBytes = node.totalBytes;
    if (totalBytes) {
      const speed = calculateRate({ current: downloaded, startTime: node.startedAt, now: node.updatedAt });
      parts.push(`${formatBytes(downloaded)}/${formatBytes(totalBytes)}`, formatSpeed(speed), `ETA ${formatEta(calculateEta({ current: downloaded, total: totalBytes, startTime: node.startedAt, now: node.updatedAt }))}`);
    }
    if (node.item) {
      parts.push(truncateText(node.item, 28));
    }
    if (node.message) {
      parts.push(truncateText(node.message, 36));
    }
    const terminalWidth = Math.max(20, this.columns - 1);
    return truncateText(parts.filter(Boolean).join(' '), terminalWidth);
  }
}

export function createProgressRenderer(options = /** @type {any} */ ({})) {
  return new ProgressRenderer(options);
}

export function renderProgressBar(current, total, {
  width = 20,
  unicode = true,
  brackets = true,
} = /** @type {any} */ ({})) {
  const bar = progressBar(current, total, width, unicode);
  return brackets ? `[${bar}]` : bar;
}

export function formatDuration(milliseconds) {
  const value = Math.max(0, Number(milliseconds) || 0);
  const totalSeconds = Math.floor(value / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) {
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  return `${hours}:${String(restMinutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function hasCursorControl(value) {
  return CURSOR_CONTROL_PATTERN.test(String(value ?? ''));
}

export function renderFailureSummary(input = /** @type {any} */ ({}), options = /** @type {any} */ ({})) {
  const chunks = /** @type {any[]} */ ([]);
  const stream = {
    isTTY: false,
    write(chunk) {
      chunks.push(String(chunk));
      return true;
    },
  };
  const renderer = createProgressRenderer({
    stdout: stream,
    stderr: stream,
    mode: options.mode ?? 'plain',
    color: 'never',
    unicode: options.unicode ?? 'never',
    language: options.language,
  });
  renderer.failure(input);
  return chunks.join('');
}

export function createProgressLifecycle(renderer, task) {
  return {
    startStage(stageInput) {
      return task.stage(stageInput);
    },
    update(stage, updateInput) {
      stage.update(updateInput);
    },
    finishStage(stage, status, input = /** @type {any} */ ({})) {
      const method = statusFromMethod(status);
      if (method === 'success') stage.succeed(input);
      else if (method === 'warning') stage.warn(input);
      else if (method === 'failed') stage.fail(input);
      else if (method === 'skipped') stage.skip(input);
      else if (method === 'cancelled') stage.cancel(input);
      else stage.update({ ...input, status: method });
    },
  };
}
