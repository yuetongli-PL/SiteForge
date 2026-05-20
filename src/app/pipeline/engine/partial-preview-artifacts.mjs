// @ts-check

import path from 'node:path';
import process from 'node:process';
import { rm } from 'node:fs/promises';
import { ensureDir, writeTextFile } from '../../../infra/io.mjs';
import { prepareRedactedArtifactJsonWithAudit } from '../../../domain/sessions/security-guard.mjs';

const PARTIAL_ARTIFACT_SCHEMA_VERSION = 1;
const REPO_RUNTIME_OUTPUT_DIRS = ['runs', 'knowledge-base'];

function isSameOrInsideDir(targetPath, parentDir) {
  const relative = path.relative(path.resolve(parentDir), path.resolve(targetPath));
  return !relative || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function blockedRepoPathKind(targetPath, cwd = process.cwd()) {
  const resolvedTarget = path.resolve(targetPath);
  const resolvedCwd = path.resolve(cwd);
  if (!isSameOrInsideDir(resolvedTarget, resolvedCwd)) {
    return null;
  }
  for (const dirName of REPO_RUNTIME_OUTPUT_DIRS) {
    if (isSameOrInsideDir(resolvedTarget, path.resolve(cwd, dirName))) {
      return null;
    }
  }
  for (const [kind, dirPath] of [
    ['skills', path.resolve(cwd, 'skills')],
    ['config', path.resolve(cwd, 'config')],
  ]) {
    if (isSameOrInsideDir(resolvedTarget, dirPath)) {
      return kind;
    }
  }
  return 'repo';
}

function auditPathFor(filePath) {
  return `${filePath}.redaction-audit.json`;
}

async function writeRedactedJsonArtifact(filePath, value) {
  const prepared = prepareRedactedArtifactJsonWithAudit(value);
  const auditPath = auditPathFor(filePath);
  await writeTextFile(filePath, prepared.json);
  await writeTextFile(auditPath, prepared.auditJson);
  return {
    path: filePath,
    redactionAuditPath: auditPath,
    value: prepared.value,
    redactionAudit: prepared.auditValue,
  };
}

async function writeRedactedTextArtifact(filePath, text, metadata = {}) {
  const prepared = prepareRedactedArtifactJsonWithAudit({
    metadata,
    text,
  });
  const auditPath = auditPathFor(filePath);
  await writeTextFile(filePath, prepared.value.text);
  await writeTextFile(auditPath, prepared.auditJson);
  return {
    path: filePath,
    redactionAuditPath: auditPath,
    value: prepared.value.text,
    redactionAudit: prepared.auditValue,
  };
}

function fallbackPartialRoot(settings, cwd = process.cwd()) {
  const expandedRoot = path.resolve(settings.expandedOutDir ?? path.join(cwd, 'runs', 'pipeline', 'expanded'));
  if (!blockedRepoPathKind(expandedRoot, cwd)) {
    return expandedRoot;
  }
  return path.resolve(cwd, 'runs', 'preview', settings.skillName ?? 'partial', 'expanded');
}

function resolvePartialKnowledgeBaseDir(settings, {
  cwd = process.cwd(),
} = {}) {
  const requested = settings.kbDir ? path.resolve(settings.kbDir) : null;
  const blockedKind = requested ? blockedRepoPathKind(requested, cwd) : null;
  if (blockedKind) {
    return {
      kbDir: path.resolve(fallbackPartialRoot(settings, cwd), 'partial-knowledge-base'),
      requestedKbDir: requested,
      repoLocalKnowledgeBaseWriteSkipped: true,
      repoLocalKnowledgeBaseWriteSkippedReason: `requested-${blockedKind}-path`,
    };
  }
  return {
    kbDir: requested ?? path.resolve(fallbackPartialRoot(settings, cwd), 'partial-knowledge-base'),
    requestedKbDir: requested,
    repoLocalKnowledgeBaseWriteSkipped: false,
    repoLocalKnowledgeBaseWriteSkippedReason: null,
  };
}

function resolvePartialSkillDir(settings, {
  cwd = process.cwd(),
} = {}) {
  const requested = settings.skillOutDir ? path.resolve(settings.skillOutDir) : null;
  const blockedKind = requested ? blockedRepoPathKind(requested, cwd) : null;
  if (blockedKind) {
    return {
      skillDir: path.resolve(fallbackPartialRoot(settings, cwd), 'partial-skill', settings.skillName),
      requestedSkillOutDir: requested,
      repoLocalSkillWriteSkipped: true,
      repoLocalSkillWriteSkippedReason: `requested-${blockedKind}-path`,
    };
  }
  return {
    skillDir: requested ?? path.resolve(fallbackPartialRoot(settings, cwd), 'partial-skill', settings.skillName),
    requestedSkillOutDir: requested,
    repoLocalSkillWriteSkipped: false,
    repoLocalSkillWriteSkippedReason: null,
  };
}

function stageGapRows(partialPreviewResult) {
  return (partialPreviewResult.gaps ?? []).map((gap) => ({
    stage: gap.stage ?? null,
    status: gap.status ?? 'unknown',
    reasonCode: gap.reasonCode ?? partialPreviewResult.reasonCode ?? null,
    blocked: gap.blocked === true,
    failed: gap.failed === true,
    unknown: gap.unknown === true,
    skipped: gap.skipped === true,
  }));
}

function sourceCaptureRefs(partialPreviewResult) {
  return {
    ...(partialPreviewResult.sourceCaptureRefs ?? {}),
  };
}

function buildPartialKnowledgeBasePayload({
  inputUrl,
  generatedAt,
  kbDir,
  partialPreviewResult,
  repoLocalKnowledgeBaseWriteSkipped,
  repoLocalKnowledgeBaseWriteSkippedReason,
}) {
  return {
    schemaVersion: PARTIAL_ARTIFACT_SCHEMA_VERSION,
    artifactFamily: 'pipeline-partial-knowledge-base',
    status: 'partial',
    inputUrl,
    generatedAt,
    kbDir,
    sourceCaptureRefs: sourceCaptureRefs(partialPreviewResult),
    failedStage: partialPreviewResult.failedStage ?? 'expanded',
    reasonCode: partialPreviewResult.reasonCode ?? 'expand-stage-failed',
    retryable: partialPreviewResult.retryable === true,
    attempts: partialPreviewResult.attempts ?? null,
    redactionRequired: true,
    normalKnowledgeBaseComplete: false,
    repoLocalKnowledgeBaseWriteSkipped,
    repoLocalKnowledgeBaseWriteSkippedReason,
    promotionAllowed: false,
    gaps: stageGapRows(partialPreviewResult),
  };
}

function buildPartialSkillPayload({
  inputUrl,
  generatedAt,
  skillDir,
  skillName,
  partialPreviewResult,
  repoLocalSkillWriteSkipped,
  repoLocalSkillWriteSkippedReason,
}) {
  return {
    schemaVersion: PARTIAL_ARTIFACT_SCHEMA_VERSION,
    artifactFamily: 'pipeline-partial-skill-preview',
    status: 'partial',
    inputUrl,
    generatedAt,
    skillDir,
    skillName,
    sourceCaptureRefs: sourceCaptureRefs(partialPreviewResult),
    failedStage: partialPreviewResult.failedStage ?? 'expanded',
    reasonCode: partialPreviewResult.reasonCode ?? 'expand-stage-failed',
    retryable: partialPreviewResult.retryable === true,
    attempts: partialPreviewResult.attempts ?? null,
    redactionRequired: true,
    repoLocalSkillUpdated: false,
    repoLocalSkillWriteSkipped,
    repoLocalSkillWriteSkippedReason,
    promotionAllowed: false,
    gaps: stageGapRows(partialPreviewResult),
  };
}

function renderGapLines(gaps) {
  if (!gaps.length) {
    return ['- No machine-readable gaps were recorded.'];
  }
  return gaps.map((gap) => (
    `- ${gap.stage}: ${gap.status}; reasonCode=${gap.reasonCode}; blocked=${gap.blocked}; failed=${gap.failed}; unknown=${gap.unknown}; skipped=${gap.skipped}`
  ));
}

function renderPartialKnowledgeBaseReadme(payload) {
  return [
    '# Partial Knowledge Base Preview',
    '',
    `- Status: \`${payload.status}\``,
    `- Failed stage: \`${payload.failedStage}\``,
    `- Reason code: \`${payload.reasonCode}\``,
    `- Retryable: \`${payload.retryable}\``,
    `- Attempts: \`${payload.attempts ?? '-'}\``,
    `- Redaction required: \`${payload.redactionRequired}\``,
    `- Promotion allowed: \`${payload.promotionAllowed}\``,
    '',
    '## Source Capture Refs',
    '',
    `- Manifest: \`${payload.sourceCaptureRefs.manifestPath ?? '-'}\``,
    `- Output dir: \`${payload.sourceCaptureRefs.outDir ?? '-'}\``,
    `- Captured at: \`${payload.sourceCaptureRefs.capturedAt ?? '-'}\``,
    '',
    '## Gaps',
    '',
    ...renderGapLines(payload.gaps),
  ].join('\n');
}

function renderPartialSkillMd(payload) {
  return [
    '---',
    `name: ${payload.skillName}`,
    `description: Partial preview Skill for ${payload.inputUrl}; capture evidence exists but expand failed before a complete KB was available.`,
    '---',
    '',
    `# ${payload.skillName} Partial Skill Preview`,
    '',
    '## Partial Preview Status',
    '',
    `- Status: \`${payload.status}\``,
    `- Failed stage: \`${payload.failedStage}\``,
    `- Reason code: \`${payload.reasonCode}\``,
    `- Retryable: \`${payload.retryable}\``,
    `- Attempts: \`${payload.attempts ?? '-'}\``,
    `- Redaction required: \`${payload.redactionRequired}\``,
    `- Repo-local skill updated: \`${payload.repoLocalSkillUpdated}\``,
    `- Promotion allowed: \`${payload.promotionAllowed}\``,
    '',
    '## Source Capture Refs',
    '',
    `- Manifest: \`${payload.sourceCaptureRefs.manifestPath ?? '-'}\``,
    `- Output dir: \`${payload.sourceCaptureRefs.outDir ?? '-'}\``,
    `- Captured at: \`${payload.sourceCaptureRefs.capturedAt ?? '-'}\``,
    '',
    '## Gaps',
    '',
    ...renderGapLines(payload.gaps),
    '',
    '## Reading order',
    '',
    '1. `references/partial-preview.md`',
    '2. `references/partial-preview-result.json`',
  ].join('\n');
}

function renderPartialSkillReference(payload) {
  return [
    '# Partial Preview Evidence',
    '',
    'This preview is intentionally partial. It preserves captured evidence after the expanded-state stage failed, but it is not eligible for repo-local promotion.',
    '',
    `- Failed stage: \`${payload.failedStage}\``,
    `- Reason code: \`${payload.reasonCode}\``,
    `- Redaction required: \`${payload.redactionRequired}\``,
    `- Repo-local skill updated: \`${payload.repoLocalSkillUpdated}\``,
    '',
    '## Gaps',
    '',
    ...renderGapLines(payload.gaps),
  ].join('\n');
}

export async function writePartialPreviewArtifacts({
  inputUrl,
  generatedAt,
  settings,
  partialPreviewResult,
  cwd = process.cwd(),
}) {
  const {
    kbDir,
    requestedKbDir,
    repoLocalKnowledgeBaseWriteSkipped,
    repoLocalKnowledgeBaseWriteSkippedReason,
  } = resolvePartialKnowledgeBaseDir(settings, { cwd });
  const {
    skillDir,
    requestedSkillOutDir,
    repoLocalSkillWriteSkipped,
    repoLocalSkillWriteSkippedReason,
  } = resolvePartialSkillDir(settings, { cwd });
  const skillName = settings.skillName;
  const referencesDir = path.join(skillDir, 'references');

  await rm(kbDir, { recursive: true, force: true });
  await rm(skillDir, { recursive: true, force: true });
  await ensureDir(kbDir);
  await ensureDir(referencesDir);

  const kbPayload = buildPartialKnowledgeBasePayload({
    inputUrl,
    generatedAt,
    kbDir,
    partialPreviewResult,
    repoLocalKnowledgeBaseWriteSkipped,
    repoLocalKnowledgeBaseWriteSkippedReason,
  });
  const skillPayload = buildPartialSkillPayload({
    inputUrl,
    generatedAt,
    skillDir,
    skillName,
    partialPreviewResult,
    repoLocalSkillWriteSkipped,
    repoLocalSkillWriteSkippedReason,
  });

  const kbResult = await writeRedactedJsonArtifact(path.join(kbDir, 'partial-kb-result.json'), kbPayload);
  const kbReadme = await writeRedactedTextArtifact(path.join(kbDir, 'README.md'), renderPartialKnowledgeBaseReadme(kbPayload), {
    artifactFamily: kbPayload.artifactFamily,
    redactionRequired: true,
  });
  const skillResult = await writeRedactedJsonArtifact(path.join(referencesDir, 'partial-preview-result.json'), skillPayload);
  const skillMd = await writeRedactedTextArtifact(path.join(skillDir, 'SKILL.md'), renderPartialSkillMd(skillPayload), {
    artifactFamily: skillPayload.artifactFamily,
    redactionRequired: true,
  });
  const skillReference = await writeRedactedTextArtifact(path.join(referencesDir, 'partial-preview.md'), renderPartialSkillReference(skillPayload), {
    artifactFamily: skillPayload.artifactFamily,
    redactionRequired: true,
  });

  return {
    knowledgeBase: {
      status: 'partial',
      kbDir,
      requestedKbDir,
      repoLocalKnowledgeBaseWriteSkipped,
      repoLocalKnowledgeBaseWriteSkippedReason,
      resultPath: kbResult.path,
      resultRedactionAuditPath: kbResult.redactionAuditPath,
      readmePath: kbReadme.path,
      readmeRedactionAuditPath: kbReadme.redactionAuditPath,
      result: kbResult.value,
    },
    skill: {
      status: 'partial',
      skillDir,
      skillName,
      requestedSkillOutDir,
      repoLocalSkillUpdated: false,
      repoLocalSkillWriteSkipped,
      repoLocalSkillWriteSkippedReason,
      resultPath: skillResult.path,
      resultRedactionAuditPath: skillResult.redactionAuditPath,
      skillMdPath: skillMd.path,
      skillMdRedactionAuditPath: skillMd.redactionAuditPath,
      references: [
        'references/partial-preview.md',
        'references/partial-preview-result.json',
      ],
      referencePath: skillReference.path,
      referenceRedactionAuditPath: skillReference.redactionAuditPath,
      result: skillResult.value,
      warnings: [
        'Partial preview only: expanded-state generation failed before a complete knowledge base was available.',
      ],
    },
  };
}
