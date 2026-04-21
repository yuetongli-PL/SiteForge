// @ts-check

import path from 'node:path';
import { writeJsonFile, writeTextFile } from '../../../infra/io.mjs';
import { mdEscape, renderTable as sharedRenderTable } from '../../../shared/markdown.mjs';
import { toPosixPath } from '../../../shared/normalize.mjs';

function renderTable(headers, rows) {
  if (!rows.length) {
    return '_None_';
  }
  return sharedRenderTable(headers, rows);
}

function renderIssueRows(items) {
  return items.map((item) => ({
    code: item.code,
    message: mdEscape(item.message),
    path: item.path ? `\`${toPosixPath(item.path)}\`` : '-',
  }));
}

export function buildLintSummary(errors, warnings) {
  const orphanPageCount = warnings.filter((warning) => warning.code === 'orphan-page').length;
  return {
    passed: errors.length === 0,
    errorCount: errors.length,
    warningCount: warnings.length,
    orphanPageCount,
  };
}

export function classifyGapWarnings(warnings) {
  const groups = {
    orphanPages: [],
    missingSummaries: [],
    thinConceptPages: [],
    missingSourceRefs: [],
    evidenceGaps: [],
    pendingRiskConfirmations: [],
    other: [],
  };
  for (const warning of warnings) {
    if (warning.code === 'orphan-page') {
      groups.orphanPages.push(warning);
    } else if (warning.code === 'missing-summary') {
      groups.missingSummaries.push(warning);
    } else if (warning.code === 'thin-concept-page') {
      groups.thinConceptPages.push(warning);
    } else if (warning.code === 'missing-source-refs') {
      groups.missingSourceRefs.push(warning);
    } else if (warning.code === 'evidence-gap') {
      groups.evidenceGaps.push(warning);
    } else if (warning.code === 'risk-context-thin') {
      groups.pendingRiskConfirmations.push(warning);
    } else {
      groups.other.push(warning);
    }
  }
  return groups;
}

export function renderLintReportMarkdown(report) {
  return [
    '# Lint Report',
    '',
    `- Generated At: \`${report.generatedAt}\``,
    `- KB Dir: \`${report.kbDir}\``,
    `- Passed: \`${String(Boolean(report.summary.passed))}\``,
    `- Errors: ${report.summary.errorCount}`,
    `- Warnings: ${report.summary.warningCount}`,
    '',
    '## Errors',
    '',
    renderTable(['Code', 'Message', 'Path'], renderIssueRows(report.errors)),
    '',
    '## Warnings',
    '',
    renderTable(['Code', 'Message', 'Path'], renderIssueRows(report.warnings)),
  ].join('\n');
}

export function renderGapReportMarkdown(report) {
  const sections = [
    '# Gap Report',
    '',
    `- Generated At: \`${report.generatedAt}\``,
    `- KB Dir: \`${report.kbDir}\``,
    '',
  ];
  for (const [section, items] of Object.entries(report.groups)) {
    sections.push(`## ${section}`);
    sections.push('');
    sections.push(renderTable(['Code', 'Message', 'Path'], renderIssueRows(items)));
    sections.push('');
  }
  return sections.join('\n');
}

export async function writeKnowledgeBaseLintReports(reportDir, kbFiles, lintReport, gapReport) {
  await writeJsonFile(path.join(reportDir, path.basename(kbFiles.lintReportJson)), lintReport);
  await writeTextFile(path.join(reportDir, path.basename(kbFiles.lintReportMd)), renderLintReportMarkdown(lintReport));
  await writeJsonFile(path.join(reportDir, path.basename(kbFiles.gapReportJson)), gapReport);
  await writeTextFile(path.join(reportDir, path.basename(kbFiles.gapReportMd)), renderGapReportMarkdown(gapReport));
}
