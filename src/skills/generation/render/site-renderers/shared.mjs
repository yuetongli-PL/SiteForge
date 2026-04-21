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

export function renderSkillTemplate({
  skillName,
  description,
  heading,
  scopeLines,
  sampleCoverageLines = [],
  executionPolicyLines = [],
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
