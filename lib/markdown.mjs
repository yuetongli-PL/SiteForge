// @ts-check

import { mdEscape } from './markdown_escape.mjs';
import { relativePath, toPosixPath } from './normalize.mjs';

export function markdownLink(label, fromPathOrTargetPath, targetPath) {
  if (targetPath === undefined) {
    return `[${label}](${toPosixPath(fromPathOrTargetPath)})`;
  }
  return `[${label}](${relativePath(fromPathOrTargetPath, targetPath)})`;
}

export function renderTable(headers, rows) {
  if (!(rows?.length)) {
    return '- none';
  }
  const head = `| ${headers.join(' | ')} |`;
  const divider = `| ${headers.map(() => '---').join(' | ')} |`;
  const body = rows.map((row) => {
    const cells = Array.isArray(row) ? row : Object.values(row ?? {});
    return `| ${cells.map((cell) => mdEscape(cell)).join(' | ')} |`;
  });
  return [head, divider, ...body].join('\n');
}

export function stripKbMeta(markdown) {
  return String(markdown ?? '').replace(/<!--\s*KBMETA[\s\S]*?-->\s*/u, '');
}

export function demoteHeadings(markdown, level = 1) {
  return String(markdown ?? '').replace(/^(#{1,6})(\s+)/gmu, (_, hashes, spacing) => `${'#'.repeat(Math.min(6, hashes.length + level))}${spacing}`);
}

export function normalizeImportedMarkdown(markdown) {
  return demoteHeadings(stripKbMeta(markdown).trim(), 1);
}
