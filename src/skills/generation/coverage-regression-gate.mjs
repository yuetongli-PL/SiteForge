// @ts-check

import path from 'node:path';
import { access, readFile } from 'node:fs/promises';
import { constants as fsConstants, realpathSync } from 'node:fs';

const SKILL_MD = 'SKILL.md';
const FLOWS_MD = 'references/flows.md';
const INDEX_MD = 'references/index.md';
const MIN_FLOW_CONTENT_RATIO = 0.9;

const REQUIRED_STATUS_BLOCKS = Object.freeze([
  {
    id: 'site-capability-graph',
    heading: '## Site Capability Graph status',
  },
  {
    id: 'site-capability-compiler',
    heading: '## Site Capability Compiler status',
  },
]);

const COVERAGE_FIELDS = Object.freeze([
  'safeActionKinds',
  'approvalActionKinds',
  'supportedIntents',
  'capabilityFamilies',
]);

function uniqueSorted(values = /** @type {any[]} */ ([])) {
  return [...new Set(
    values
      .map((value) => String(value ?? '').trim())
      .filter(Boolean),
  )].sort((left, right) => left.localeCompare(right, 'en'));
}

function normalizeRepoPath(value) {
  return String(value ?? '').replaceAll('\\', '/').replace(/^\.?\//u, '');
}

function comparablePaths(value) {
  const resolved = path.resolve(value);
  try {
    const real = realpathSync.native(resolved);
    return real === resolved ? [resolved] : [resolved, real];
  } catch {
    return [resolved];
  }
}

function samePath(left, right) {
  const rightPaths = new Set(comparablePaths(right));
  return comparablePaths(left).some((leftPath) => rightPaths.has(leftPath));
}

async function pathExists(filePath) {
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function readOptionalText(filePath) {
  return await pathExists(filePath) ? readFile(filePath, 'utf8') : '';
}

async function readOptionalJson(filePath) {
  if (!await pathExists(filePath)) {
    return null;
  }
  return JSON.parse(await readFile(filePath, 'utf8'));
}

function extractBacktickValuesAfterLabel(markdown, label) {
  const pattern = new RegExp(`${label.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}\\s*:\\s*([^\\n]+)`, 'iu');
  const match = pattern.exec(markdown);
  if (!match) {
    return [];
  }
  return [...match[1].matchAll(/`([^`]+)`/gu)].flatMap((item) => item[1].split(',')).map((item) => item.trim());
}

function extractCommaValuesAfterLabel(markdown, label) {
  const pattern = new RegExp(`${label.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}\\s*:\\s*([^\\n]+)`, 'iu');
  const match = pattern.exec(markdown);
  if (!match) {
    return [];
  }
  return match[1].replace(/`/gu, '').split(',').map((item) => item.trim());
}

function extractFlowHeadings(flowsMd) {
  return uniqueSorted([...flowsMd.matchAll(/^##\s+(.+)$/gmu)]
    .map((match) => match[1].trim())
    .filter((heading) => !['Table of contents', 'Notes'].includes(heading)));
}

function extractIntentTypes(flowsMd) {
  return uniqueSorted([...flowsMd.matchAll(/^\s*-\s*Intent Type:\s*`([^`]+)`/gmu)]
    .map((match) => match[1]));
}

function inferApprovalActionKinds(markdown) {
  const actions = /** @type {any[]} */ ([]);
  if (/\bsearch-submit\b/u.test(markdown)) {
    actions.push('search-submit');
  }
  if (/\bauth-submit\b/u.test(markdown)) {
    actions.push('auth-submit');
  }
  if (/\bpayment-submit\b/u.test(markdown)) {
    actions.push('payment-submit');
  }
  if (/\bupload-submit\b/u.test(markdown)) {
    actions.push('upload-submit');
  }
  return actions;
}

function extractSampleCoverage(markdown) {
  const match = /Latest full-book coverage:\s*(\d+)\s+book\(s\),\s*(\d+)\s+chapter\(s\)/iu.exec(markdown);
  if (!match) {
    return {
      present: false,
      books: 0,
      chapters: 0,
    };
  }
  return {
    present: true,
    books: Number(match[1]),
    chapters: Number(match[2]),
  };
}

function statusBlockPresence(skillMd) {
  return Object.fromEntries(REQUIRED_STATUS_BLOCKS.map((block) => [
    block.id,
    skillMd.includes(block.heading),
  ]));
}

function compileEvidencePresence(skillMd) {
  return {
    compileSummary: /Compile summary artifact:/u.test(skillMd),
    siteSpecificEvidenceSummary: /Site-specific evidence summary:/u.test(skillMd),
  };
}

export function buildSkillCoverageFingerprint({
  documents = /** @type {any} */ ({}),
  coverage = /** @type {any} */ ({}),
} = /** @type {any} */ ({})) {
  const skillMd = documents.skillMd ?? '';
  const flowsMd = documents.flowsMd ?? '';
  const indexMd = documents.indexMd ?? '';
  const allMarkdown = [
    skillMd,
    flowsMd,
    indexMd,
    documents.interactionModelMd ?? '',
    documents.nlIntentsMd ?? '',
  ].join('\n');

  return {
    safeActionKinds: uniqueSorted([
      ...(coverage.safeActionKinds ?? []),
      ...extractBacktickValuesAfterLabel(allMarkdown, 'Safe actions'),
    ]),
    approvalActionKinds: uniqueSorted([
      ...(coverage.approvalActionKinds ?? []),
      ...extractBacktickValuesAfterLabel(allMarkdown, 'Approval actions'),
      ...inferApprovalActionKinds(allMarkdown),
    ]),
    supportedIntents: uniqueSorted([
      ...(coverage.supportedIntents ?? []),
      ...extractIntentTypes(flowsMd),
    ]),
    capabilityFamilies: uniqueSorted([
      ...(coverage.capabilityFamilies ?? []),
      ...extractCommaValuesAfterLabel(allMarkdown, 'Capability families'),
    ]),
    flowHeadings: extractFlowHeadings(flowsMd),
    flowsContentLength: flowsMd.trim().length,
    statusBlocks: statusBlockPresence(skillMd),
    compileEvidence: compileEvidencePresence(skillMd),
    sampleCoverage: extractSampleCoverage(indexMd),
  };
}

async function readRepoMetadataCoverage(cwd, skillName) {
  const registry = await readOptionalJson(path.join(cwd, 'config', 'site-registry.json'));
  const capabilities = await readOptionalJson(path.join(cwd, 'config', 'site-capabilities.json'));
  const repoSkillDir = `skills/${skillName}`;
  const host = Object.entries(registry?.sites ?? {}).find(([, record]) => (
    normalizeRepoPath(record?.repoSkillDir) === repoSkillDir
  ))?.[0] ?? null;
  const capabilityRecord = host ? capabilities?.sites?.[host] : null;
  const registryRecord = host ? registry?.sites?.[host] : null;
  return {
    safeActionKinds: capabilityRecord?.safeActionKinds ?? [],
    approvalActionKinds: capabilityRecord?.approvalActionKinds ?? [],
    supportedIntents: capabilityRecord?.supportedIntents ?? [],
    capabilityFamilies: uniqueSorted([
      ...(capabilityRecord?.capabilityFamilies ?? []),
      ...(registryRecord?.capabilityFamilies ?? []),
    ]),
  };
}

async function readRepoSkillDocuments(skillDir) {
  return {
    skillMd: await readOptionalText(path.join(skillDir, SKILL_MD)),
    flowsMd: await readOptionalText(path.join(skillDir, FLOWS_MD)),
    indexMd: await readOptionalText(path.join(skillDir, INDEX_MD)),
    interactionModelMd: await readOptionalText(path.join(skillDir, 'references/interaction-model.md')),
    nlIntentsMd: await readOptionalText(path.join(skillDir, 'references/nl-intents.md')),
  };
}

function missingItems(baseline = /** @type {any[]} */ ([]), candidate = /** @type {any[]} */ ([])) {
  const candidateSet = new Set(candidate);
  return baseline.filter((item) => !candidateSet.has(item));
}

function compareFingerprints(baseline, candidate) {
  const reasons = /** @type {any[]} */ ([]);

  for (const field of COVERAGE_FIELDS) {
    const missing = missingItems(baseline[field], candidate[field]);
    if (missing.length) {
      reasons.push({
        type: 'missing_capability',
        field,
        missing,
      });
    }
  }

  const missingFlows = missingItems(baseline.flowHeadings, candidate.flowHeadings);
  if (missingFlows.length) {
    reasons.push({
      type: 'missing_flow',
      field: FLOWS_MD,
      missing: missingFlows,
    });
  }

  if (
    baseline.flowsContentLength > 0
    && candidate.flowsContentLength < Math.floor(baseline.flowsContentLength * MIN_FLOW_CONTENT_RATIO)
  ) {
    reasons.push({
      type: 'lower_sample_coverage',
      field: FLOWS_MD,
      baseline: baseline.flowsContentLength,
      candidate: candidate.flowsContentLength,
      minimumRatio: MIN_FLOW_CONTENT_RATIO,
    });
  }

  for (const block of REQUIRED_STATUS_BLOCKS) {
    if (!candidate.statusBlocks[block.id]) {
      reasons.push({
        type: 'missing_status_block',
        field: SKILL_MD,
        missing: [block.heading],
      });
    }
  }

  for (const [key, baselinePresent] of Object.entries(baseline.compileEvidence)) {
    if (baselinePresent && !candidate.compileEvidence[key]) {
      reasons.push({
        type: 'missing_status_block',
        field: SKILL_MD,
        missing: [key],
      });
    }
  }

  if (
    baseline.sampleCoverage.present
    && (
      candidate.sampleCoverage.books < baseline.sampleCoverage.books
      || candidate.sampleCoverage.chapters < baseline.sampleCoverage.chapters
    )
  ) {
    reasons.push({
      type: 'lower_sample_coverage',
      field: INDEX_MD,
      baseline: baseline.sampleCoverage,
      candidate: candidate.sampleCoverage,
    });
  }

  return reasons;
}

export async function evaluateSkillCoverageRegressionGate({
  cwd = process.cwd(),
  skillName,
  targetDir,
  candidateDocuments,
  candidateCoverage = /** @type {any} */ ({}),
  baselineCoverage = null,
} = /** @type {any} */ ({})) {
  if (!skillName) {
    throw new Error('Skill coverage regression gate requires skillName.');
  }
  if (!targetDir) {
    throw new Error('Skill coverage regression gate requires targetDir.');
  }

  const repoSkillDir = path.resolve(cwd, 'skills', skillName);
  if (!samePath(targetDir, repoSkillDir)) {
    return {
      allowed: true,
      status: 'skipped',
      reason: 'not-repo-local-skill-promotion',
      skillName,
      targetDir: path.resolve(targetDir),
      repoSkillDir,
      reasons: [],
    };
  }

  if (!await pathExists(path.join(repoSkillDir, SKILL_MD))) {
    return {
      allowed: true,
      status: 'skipped',
      reason: 'no-existing-repo-local-skill',
      skillName,
      targetDir: path.resolve(targetDir),
      repoSkillDir,
      reasons: [],
    };
  }

  const baselineDocuments = await readRepoSkillDocuments(repoSkillDir);
  const baseline = buildSkillCoverageFingerprint({
    documents: baselineDocuments,
    coverage: baselineCoverage ?? await readRepoMetadataCoverage(cwd, skillName),
  });
  const candidate = buildSkillCoverageFingerprint({
    documents: candidateDocuments,
    coverage: candidateCoverage,
  });
  const reasons = compareFingerprints(baseline, candidate);

  return {
    allowed: reasons.length === 0,
    status: reasons.length === 0 ? 'passed' : 'failed',
    skillName,
    targetDir: path.resolve(targetDir),
    repoSkillDir,
    reasons,
    baseline,
    candidate,
  };
}

function reasonSummary(reason) {
  const missing = Array.isArray(reason.missing) && reason.missing.length
    ? ` missing ${reason.missing.join(', ')}`
    : '';
  return `${reason.type}:${reason.field}${missing}`;
}

export class SkillCoverageRegressionError extends Error {
  constructor(report) {
    super(`Skill coverage regression gate failed for ${report.skillName}: ${report.reasons.map(reasonSummary).join('; ')}`);
    this.name = 'SkillCoverageRegressionError';
    this.code = 'skill_coverage_regression';
    this.report = report;
  }
}

export async function enforceSkillCoverageRegressionGate(options = /** @type {any} */ ({})) {
  const report = await evaluateSkillCoverageRegressionGate(options);
  if (!report.allowed) {
    throw new SkillCoverageRegressionError(report);
  }
  return report;
}
