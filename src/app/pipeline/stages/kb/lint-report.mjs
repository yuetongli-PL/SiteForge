// @ts-check

import path from 'node:path';
import { writeTextFile } from '../../../../infra/io.mjs';
import { normalizeArtifactReferenceSet } from '../../../../domain/artifacts/schema.mjs';
import { assertSchemaCompatible } from '../../../../domain/schemas/compatibility-registry.mjs';
import {
  assertNoForbiddenPatterns,
  prepareRedactedArtifactJson,
  prepareRedactedArtifactJsonWithAudit,
  redactValue,
} from '../../../../domain/sessions/security-guard.mjs';
import { mdEscape, renderTable as sharedRenderTable } from '../../../../shared/markdown.mjs';
import { toPosixPath } from '../../../../shared/normalize.mjs';

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

function auditPathFor(filePath) {
  const ext = path.extname(filePath);
  if (ext === '.md') {
    return `${filePath}.redaction-audit.json`;
  }
  const base = ext ? filePath.slice(0, -ext.length) : filePath;
  return `${base}.redaction-audit.json`;
}

function toKnowledgeBaseLintReportRedactionFailure(error) {
  const failure = new Error('Knowledge base lint report redaction failed');
  failure.name = 'KnowledgeBaseLintReportRedactionFailure';
  failure.code = 'redaction-failed';
  failure.reasonCode = 'redaction-failed';
  failure.artifactWriteAllowed = false;
  failure.causeSummary = {
    name: error?.name ?? 'Error',
    code: error?.code ?? null,
  };
  return failure;
}

function prepareMarkdownArtifact(markdown) {
  const redacted = redactValue(String(markdown ?? ''));
  const markdownText = String(redacted.value ?? '');
  assertNoForbiddenPatterns(markdownText);
  return {
    markdown: markdownText,
    auditJson: prepareRedactedArtifactJson(redacted.audit).json,
  };
}

export function knowledgeBaseLintReportArtifactPaths(reportDir, kbFiles) {
  const lintReportJson = path.join(reportDir, path.basename(kbFiles.lintReportJson));
  const lintReportMd = path.join(reportDir, path.basename(kbFiles.lintReportMd));
  const gapReportJson = path.join(reportDir, path.basename(kbFiles.gapReportJson));
  const gapReportMd = path.join(reportDir, path.basename(kbFiles.gapReportMd));
  return {
    lintReportJson,
    lintReportJsonAudit: auditPathFor(lintReportJson),
    lintReportMd,
    lintReportMdAudit: auditPathFor(lintReportMd),
    gapReportJson,
    gapReportJsonAudit: auditPathFor(gapReportJson),
    gapReportMd,
    gapReportMdAudit: auditPathFor(gapReportMd),
  };
}

export function prepareKnowledgeBaseLintReportArtifacts(lintReport, gapReport) {
  try {
    const preparedLintJson = prepareRedactedArtifactJsonWithAudit(lintReport);
    const preparedGapJson = prepareRedactedArtifactJsonWithAudit(gapReport);
    const preparedLintMarkdown = prepareMarkdownArtifact(renderLintReportMarkdown(preparedLintJson.value));
    const preparedGapMarkdown = prepareMarkdownArtifact(renderGapReportMarkdown(preparedGapJson.value));
    return {
      lintReportJson: preparedLintJson.json,
      lintReportJsonAudit: preparedLintJson.auditJson,
      lintReportMd: preparedLintMarkdown.markdown,
      lintReportMdAudit: preparedLintMarkdown.auditJson,
      gapReportJson: preparedGapJson.json,
      gapReportJsonAudit: preparedGapJson.auditJson,
      gapReportMd: preparedGapMarkdown.markdown,
      gapReportMdAudit: preparedGapMarkdown.auditJson,
      lintReport: preparedLintJson.value,
      gapReport: preparedGapJson.value,
    };
  } catch (error) {
    throw toKnowledgeBaseLintReportRedactionFailure(error);
  }
}

export async function writeKnowledgeBaseLintReports(reportDir, kbFiles, lintReport, gapReport) {
  const paths = knowledgeBaseLintReportArtifactPaths(reportDir, kbFiles);
  const artifacts = normalizeArtifactReferenceSet(paths);
  assertSchemaCompatible('ArtifactReferenceSet', artifacts);
  const prepared = prepareKnowledgeBaseLintReportArtifacts(lintReport, gapReport);
  await writeTextFile(paths.lintReportJsonAudit, prepared.lintReportJsonAudit);
  await writeTextFile(paths.lintReportMdAudit, prepared.lintReportMdAudit);
  await writeTextFile(paths.gapReportJsonAudit, prepared.gapReportJsonAudit);
  await writeTextFile(paths.gapReportMdAudit, prepared.gapReportMdAudit);
  await writeTextFile(paths.lintReportJson, prepared.lintReportJson);
  await writeTextFile(paths.lintReportMd, prepared.lintReportMd);
  await writeTextFile(paths.gapReportJson, prepared.gapReportJson);
  await writeTextFile(paths.gapReportMd, prepared.gapReportMd);
  return {
    paths,
    artifacts,
    lintReport: prepared.lintReport,
    gapReport: prepared.gapReport,
  };
}
