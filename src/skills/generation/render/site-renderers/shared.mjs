function joinLines(lines) {
  return lines.join('\n');
}

function pushSection(lines, title, bodyLines) {
  if (!bodyLines || !bodyLines.length) {
    return;
  }
  lines.push(title, '', ...bodyLines, '');
}

export function renderReferenceNavigation(outputs, currentFilePath, markdownLink) {
  return [
    `- ${markdownLink('flows.md', currentFilePath, outputs.flowsMd)}`,
    `- ${markdownLink('recovery.md', currentFilePath, outputs.recoveryMd)}`,
    `- ${markdownLink('approval.md', currentFilePath, outputs.approvalMd)}`,
    `- ${markdownLink('nl-intents.md', currentFilePath, outputs.nlIntentsMd)}`,
    `- ${markdownLink('interaction-model.md', currentFilePath, outputs.interactionModelMd)}`,
  ];
}

export function renderReadingOrder(outputs, currentFilePath, markdownLink) {
  return [
    `1. Start with ${markdownLink('references/index.md', currentFilePath, outputs.indexMd)}.`,
    `2. For task execution details, read ${markdownLink('references/flows.md', currentFilePath, outputs.flowsMd)}.`,
    `3. For user utterances and slot mapping, read ${markdownLink('references/nl-intents.md', currentFilePath, outputs.nlIntentsMd)}.`,
    `4. For failure handling, read ${markdownLink('references/recovery.md', currentFilePath, outputs.recoveryMd)}.`,
    `5. For approval boundaries, read ${markdownLink('references/approval.md', currentFilePath, outputs.approvalMd)}.`,
    `6. For the structured site model, read ${markdownLink('references/interaction-model.md', currentFilePath, outputs.interactionModelMd)}.`,
  ];
}

export function renderSiteCapabilityGraphStatusLines() {
  return [
    '- Repo Graph status: Site Capability Graph final validation passed for the current repo scope on 2026-05-08 with sections 1-20 verified, `partial=0`, `gaps=[]`, and Agent B `Accepted`.',
    '- Execution boundary: the Graph is declarative, versioned capability knowledge only. The Site Capability Layer remains the execution and orchestration entrypoint.',
    '- Skill usage: use Graph-derived knowledge to choose verified capability families, routes, endpoint evidence, risk policies, reason codes, and recovery boundaries; do not treat Graph descriptors as permission to execute blocked actions.',
    '- Prohibited from Graph evidence alone: SiteAdapter/downloader invocation, SessionView/DownloadPolicy/StandardTaskList materialization, runtime artifact writes, repo writes, external dispatch/telemetry, profile materialization, or sensitive-material persistence.',
  ];
}

export function renderSiteCapabilityCompilerStatusLines() {
  return [
    '- Compiler status: Site Capability Compiler / Executor validation covers sections 1-20 verified for descriptor-only compile, Graph emission, Planner dry-run handoff, governed execution descriptors, redaction, and tests.',
    '- Dry-run entrypoint: use `node src/entrypoints/cli.mjs site capability-compile --site <site> --json` to inspect compile coverage without live capture, session materialization, SiteAdapter runtime execution, downloader invocation, or artifact writes unless explicitly requested.',
    '- Consumer boundary: generated Skills may surface compile coverage summaries and CLI pointers, but they must not convert compile evidence into permission for blocked execution, credential use, downloader calls, or live-site access.',
  ];
}

export function renderSkillTemplate({
  skillName,
  description,
  heading,
  scopeLines,
  sampleCoverageLines = [],
  executionPolicyLines = [],
  siteCapabilityGraphStatusLines = renderSiteCapabilityGraphStatusLines(),
  siteCapabilityCompilerStatusLines = renderSiteCapabilityCompilerStatusLines(),
  readingOrderLines,
  safetyBoundaryLines,
  doNotDoLines,
}) {
  const lines = [
    '---',
    `name: ${skillName}`,
    `description: ${description}`,
    '---',
    '',
    `# ${heading}`,
    '',
  ];
  pushSection(lines, '## Scope', scopeLines);
  pushSection(lines, '## Sample coverage', sampleCoverageLines);
  pushSection(lines, '## Site Capability Graph status', siteCapabilityGraphStatusLines);
  pushSection(lines, '## Site Capability Compiler status', siteCapabilityCompilerStatusLines);
  pushSection(lines, '## Execution policy', executionPolicyLines);
  pushSection(lines, '## Reading order', readingOrderLines);
  pushSection(lines, '## Safety boundary', safetyBoundaryLines);
  pushSection(lines, '## Do not do', doNotDoLines);
  while (lines.at(-1) === '') {
    lines.pop();
  }
  return joinLines(lines);
}

export function renderIndexTemplate({
  title,
  siteSummaryLines,
  referenceNavigationLines,
  sampleCoverageTable,
  notesTitle,
  notesLines,
}) {
  const lines = [`# ${title}`, ''];
  pushSection(lines, '## Site summary', siteSummaryLines);
  pushSection(lines, '## Reference navigation', referenceNavigationLines);
  if (sampleCoverageTable) {
    pushSection(lines, '## Sample intent coverage', [sampleCoverageTable]);
  }
  pushSection(lines, notesTitle, notesLines);
  while (lines.at(-1) === '') {
    lines.pop();
  }
  return joinLines(lines);
}

export function renderFlowsTemplate(entries, notes, slugifyAscii) {
  const lines = ['# Flows', '', '## Table of contents', ''];
  for (const entry of entries) {
    lines.push(`- [${entry.title}](#${slugifyAscii(entry.title, entry.anchorHint ?? entry.title)})`);
  }
  lines.push('');
  for (const entry of entries) {
    lines.push(`## ${entry.title}`);
    lines.push('');
    lines.push(`- Intent ID: \`${entry.intentId}\``);
    lines.push(`- Intent Type: \`${entry.intentType}\``);
    lines.push(`- Action: \`${entry.actionId}\``);
    lines.push(`- Summary: ${entry.summary}`);
    lines.push('');
    lines.push(...entry.bodyLines);
    lines.push('');
  }
  pushSection(lines, '## Notes', notes);
  while (lines.at(-1) === '') {
    lines.pop();
  }
  return joinLines(lines);
}

export function renderNlIntentsTemplate(entries) {
  const lines = ['# NL Intents', ''];
  for (const entry of entries) {
    lines.push(`## ${entry.title}`);
    lines.push('');
    lines.push(...entry.bodyLines);
    lines.push('');
  }
  while (lines.at(-1) === '') {
    lines.pop();
  }
  return joinLines(lines);
}

export function renderInteractionTemplate({ summaryTitle, summaryLines, table, extraSections = [] }) {
  const lines = ['# Interaction Model', ''];
  pushSection(lines, summaryTitle, summaryLines);
  if (table) {
    lines.push(table, '');
  }
  for (const section of extraSections) {
    pushSection(lines, section.title, section.lines);
  }
  while (lines.at(-1) === '') {
    lines.pop();
  }
  return joinLines(lines);
}

export function buildIntentCoverageRows(intents, docsByIntent, currentFilePath, markdownLink, displayIntentLabel, buildRow) {
  return intents.map((intent) => {
    const flowDoc = docsByIntent.get(intent.intentId);
    return buildRow(intent, flowDoc ? markdownLink(
      flowDoc.title ?? displayIntentLabel(intent.intentType),
      currentFilePath,
      flowDoc.mappedPath,
    ) : '-');
  });
}

export function dedupeSampleList(values, normalizer) {
  const seen = new Set();
  const result = [];
  for (const value of values ?? []) {
    const normalized = normalizer(value);
    if (!normalized) {
      continue;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(normalized);
  }
  return result;
}
