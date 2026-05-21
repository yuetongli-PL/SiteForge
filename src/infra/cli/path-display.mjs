// @ts-check

import path from 'node:path';
import process from 'node:process';

import { truncateText, visibleWidth } from './progress.mjs';

export function relativeOrCompactPath(value, {
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

export function displayPath(value, cwd = process.cwd()) {
  if (!value) {
    return '-';
  }
  const relative = path.relative(cwd, value);
  return relative && !relative.startsWith('..') ? relative.replace(/\\/gu, '/') : String(value).replace(/\\/gu, '/');
}

export function displayReportPath(value, options = {}) {
  const reportPath = String(value ?? '').trim();
  if (!reportPath) {
    return '-';
  }
  if (path.win32.isAbsolute(reportPath)) {
    const cwd = String(options.cwd ?? process.cwd());
    if (path.win32.isAbsolute(cwd)) {
      const relative = path.win32.relative(cwd, reportPath);
      if (relative && !relative.startsWith('..') && !path.win32.isAbsolute(relative)) {
        return relative.replace(/\\/gu, '/');
      }
    }
    return path.win32.basename(reportPath);
  }
  if (!path.isAbsolute(reportPath)) {
    return reportPath.replace(/\\/gu, '/');
  }
  const cwd = options.cwd ?? process.cwd();
  const relative = path.relative(cwd, reportPath);
  if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
    return relative.replace(/\\/gu, '/');
  }
  return path.basename(reportPath);
}
