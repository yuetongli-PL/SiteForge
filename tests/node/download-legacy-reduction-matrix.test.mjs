import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { stat, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIR, '..', '..');
const MATRIX_PATH = path.join(REPO_ROOT, 'docs', 'DOWNLOAD_LEGACY_REDUCTION_MIGRATION_MATRIX.md');

async function pathExists(relativePath) {
  try {
    await stat(path.join(REPO_ROOT, relativePath));
    return true;
  } catch {
    return false;
  }
}

function migrationMatrixSection(markdown) {
  const start = markdown.indexOf('## Migration Matrix');
  const end = markdown.indexOf('## Remaining Fallback Reasons');
  assert.notEqual(start, -1, 'Migration Matrix section must exist.');
  assert.notEqual(end, -1, 'Remaining Fallback Reasons section must exist.');
  return markdown.slice(start, end);
}

function parseTableRows(section) {
  return section
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('|') && line.endsWith('|'))
    .filter((line) => !/^\|\s*-+/u.test(line))
    .slice(1)
    .map((line) => line.slice(1, -1).split('|').map((cell) => cell.trim()))
    .map((cells) => ({
      site: cells[0],
      taskShape: cells[1],
      nativeStatus: cells[2],
      resolverMethod: cells[3],
      completionReason: cells[4],
      evidence: cells[5],
      legacyFallback: cells[6],
    }));
}

function evidenceTestPaths(evidenceCell = '') {
  return [...evidenceCell.matchAll(/tests\/node\/[A-Za-z0-9._-]+\.test\.mjs/gu)]
    .map((match) => match[0]);
}

test('download legacy reduction matrix remains evidence-backed and live-safe', async () => {
  const markdown = await readFile(MATRIX_PATH, 'utf8');
  assert.match(markdown, /Live traffic status: not claimed/u);

  const rows = parseTableRows(migrationMatrixSection(markdown));
  assert.ok(rows.length > 0, 'Migration Matrix must include task rows.');

  for (const site of ['22biqu', 'Bilibili', 'Douyin', 'Xiaohongshu', 'X', 'Instagram']) {
    assert.ok(rows.some((row) => row.site === site), `Migration Matrix must cover ${site}.`);
  }

  const nativeRows = rows.filter((row) => row.nativeStatus === 'Native');
  assert.ok(nativeRows.length > 0, 'Migration Matrix must include native rows.');
  for (const row of nativeRows) {
    const evidencePaths = evidenceTestPaths(row.evidence);
    assert.ok(
      evidencePaths.length > 0,
      `${row.site} native row must reference at least one node test evidence file: ${row.taskShape}`,
    );
    for (const evidencePath of evidencePaths) {
      assert.equal(await pathExists(evidencePath), true, `${evidencePath} must exist.`);
    }
  }

  const legacyRows = rows.filter((row) => row.nativeStatus === 'Legacy');
  assert.ok(legacyRows.length > 0, 'Migration Matrix must include legacy rows.');
  for (const row of legacyRows) {
    assert.match(
      row.completionReason,
      /legacy-downloader-required/u,
      `${row.site} legacy row must keep the stable fallback reason.`,
    );
  }
});
