// @ts-check

import { pathExists, readTextFile } from '../../infra/io.mjs';
import { markdownLink, normalizeImportedMarkdown, renderTable } from '../../shared/markdown.mjs';
import { uniqueSortedStrings } from '../../shared/normalize.mjs';
import {
  buildElementsById,
  buildPatternsByIntent,
} from './context-indexes.mjs';
import {
  renderKnownSiteApprovalReference,
  renderKnownSiteFlowsReference,
  renderKnownSiteIndexReference,
  renderKnownSiteInteractionModelReference,
  renderKnownSiteNlIntentsReference,
  renderKnownSiteRecoveryReference,
  renderKnownSiteSkillMd,
} from './site-render-inputs.mjs';
import {
  resolveCapabilityFamilies,
  resolvePrimaryArchetype,
  resolveSafeActions,
  resolveSupportedIntents,
} from './site-capabilities.mjs';
import { rewriteMarkdownLinks } from './source-inputs.mjs';

export function renderSkillMd(context, outputs) {
  const knownSiteDocument = renderKnownSiteSkillMd(context, outputs);
  if (knownSiteDocument) {
    return knownSiteDocument;
  }

  const intents = context.intentsDocument.intents ?? [];
  const actionableLabels = uniqueSortedStrings(intents.flatMap((intent) => (intent.targetDomain?.actionableValues ?? []).map((value) => value.label)));
  const primaryArchetype = resolvePrimaryArchetype(context);
  const capabilityFamilies = resolveCapabilityFamilies(context);
  const supportedIntents = resolveSupportedIntents(context);
  const safeActions = resolveSafeActions(context);
  const description = primaryArchetype === 'navigation-hub' || primaryArchetype === 'catalog-detail'
    ? `Instruction-only Skill for the observed ${context.url} navigation space.`
    : `Instruction-only Skill for the observed ${context.url} state space.`;
  return [
    '---',
    `name: ${context.skillName}`,
    `description: ${description}`,
    '---',
    '',
    `# ${context.siteDisplayName} Skill`,
    '',
    '## Scope',
    '',
    `- Site: \`${context.url}\``,
    `- Primary archetype: \`${primaryArchetype}\``,
    `- Capability families: ${capabilityFamilies.join(', ') || 'none'}`,
    `- Supported intents: ${supportedIntents.join(', ') || 'none'}`,
    `- Safe actions: \`${safeActions.join('`, `')}\``,
    `- Actionable targets: ${actionableLabels.join(', ') || 'none'}`,
    '',
    '## Reading order',
    '',
    `1. ${markdownLink('references/index.md', outputs.skillMd, outputs.indexMd)}`,
    `2. ${markdownLink('references/flows.md', outputs.skillMd, outputs.flowsMd)}`,
    `3. ${markdownLink('references/nl-intents.md', outputs.skillMd, outputs.nlIntentsMd)}`,
    `4. ${markdownLink('references/recovery.md', outputs.skillMd, outputs.recoveryMd)}`,
    `5. ${markdownLink('references/approval.md', outputs.skillMd, outputs.approvalMd)}`,
    `6. ${markdownLink('references/interaction-model.md', outputs.skillMd, outputs.interactionModelMd)}`,
  ].join('\n');
}

export function renderIndexReference(context, outputs, docsByIntent) {
  const knownSiteDocument = renderKnownSiteIndexReference(context, outputs, docsByIntent);
  if (knownSiteDocument) {
    return knownSiteDocument;
  }

  const intents = context.intentsDocument.intents ?? [];
  const flowLinks = intents.map((intent) => {
    const doc = docsByIntent.get(intent.intentId);
    return {
      intent: intent.intentName,
      link: doc ? markdownLink(doc.title ?? intent.intentName, outputs.indexMd, doc.mappedPath) : '-',
      actionableTargets: (intent.targetDomain?.actionableValues ?? []).map((value) => value.label).join(', ') || '-',
      recognitionOnly: (intent.targetDomain?.candidateValues ?? [])
        .filter((value) => !(intent.targetDomain?.actionableValues ?? []).some((candidate) => candidate.value === value.value))
        .map((value) => value.label)
        .join(', ') || '-',
    };
  });
  return [
    `# ${context.siteDisplayName} Index`,
    '',
    `- Entry URL: \`${context.url}\``,
    `- Intent count: ${intents.length}`,
    `- State count: ${(context.statesDocument.states ?? []).length}`,
    '',
    renderTable(['Intent', 'Flow Source', 'Actionable Targets', 'Recognition-only Targets'], flowLinks),
  ].join('\n');
}

export async function renderFlowsReference(context, outputs, docsByIntent) {
  const knownSiteDocument = renderKnownSiteFlowsReference(context, outputs, docsByIntent);
  if (knownSiteDocument) {
    return knownSiteDocument;
  }

  const intents = [...(context.intentsDocument.intents ?? [])].sort((left, right) => String(left.intentId).localeCompare(String(right.intentId), 'en'));
  const sections = ['# Flows', ''];
  if (!intents.length) {
    sections.push('No executable flows are currently documented.');
    return sections.join('\n');
  }
  for (const intent of intents) {
    const flowDoc = docsByIntent.get(intent.intentId);
    sections.push(`## ${intent.intentName}`);
    sections.push('');
    sections.push(`- Intent ID: \`${intent.intentId}\``);
    sections.push(`- Intent Type: \`${intent.intentType}\``);
    sections.push(`- Action: \`${intent.actionId}\``);
    const flowSourcePath = flowDoc
      ? (flowDoc.originalPath && await pathExists(flowDoc.originalPath) ? flowDoc.originalPath : flowDoc.mappedPath)
      : null;
    if (flowSourcePath) {
      const imported = await readTextFile(flowSourcePath);
      sections.push('');
      sections.push(rewriteMarkdownLinks(normalizeImportedMarkdown(imported), flowSourcePath, outputs.flowsMd, context.mapToKbPath, context.warnings));
    }
    sections.push('');
  }
  return sections.join('\n');
}

export async function renderRecoveryReference(context, outputs) {
  const knownSiteDocument = renderKnownSiteRecoveryReference(context);
  if (knownSiteDocument) {
    return knownSiteDocument;
  }

  const originalPath = context.rawToOriginalPath(context.recoveryPath);
  const sourcePath = originalPath && await pathExists(originalPath) ? originalPath : context.recoveryPath;
  const text = await readTextFile(sourcePath);
  return ['# Recovery', '', rewriteMarkdownLinks(normalizeImportedMarkdown(text), sourcePath, outputs.recoveryMd, context.mapToKbPath, context.warnings)].join('\n');
}

export async function renderApprovalReference(context, outputs) {
  const knownSiteDocument = renderKnownSiteApprovalReference(context);
  if (knownSiteDocument) {
    return knownSiteDocument;
  }

  const originalPath = context.rawToOriginalPath(context.approvalPath);
  const sourcePath = originalPath && await pathExists(originalPath) ? originalPath : context.approvalPath;
  const text = await readTextFile(sourcePath);
  return ['# Approval', '', rewriteMarkdownLinks(normalizeImportedMarkdown(text), sourcePath, outputs.approvalMd, context.mapToKbPath, context.warnings)].join('\n');
}

export async function renderNlIntentsReference(context, outputs) {
  const knownSiteDocument = renderKnownSiteNlIntentsReference(context, outputs);
  if (knownSiteDocument) {
    return knownSiteDocument;
  }

  const patternsByIntent = buildPatternsByIntent(context);
  const sections = ['# NL Intents', ''];
  for (const intent of [...(context.intentsDocument.intents ?? [])].sort((left, right) => String(left.intentId).localeCompare(String(right.intentId), 'en'))) {
    const patterns = patternsByIntent.get(intent.intentId) ?? [];
    sections.push(`## ${intent.intentName}`);
    sections.push('');
    sections.push(renderTable(
      ['Pattern Type', 'Examples', 'Regex'],
      patterns.map((pattern) => ({
        patternType: pattern.patternType,
        examples: (pattern.examples ?? []).join(' / ') || '-',
        regex: `\`${pattern.regex}\``,
      })),
    ));
    sections.push('');
  }
  return sections.join('\n');
}

export async function renderInteractionModelReference(context, outputs) {
  const knownSiteDocument = renderKnownSiteInteractionModelReference(context, outputs);
  if (knownSiteDocument) {
    return knownSiteDocument;
  }

  const elementsById = buildElementsById(context);
  return [
    '# Interaction Model',
    '',
    renderTable(
      ['Intent ID', 'Intent Type', 'Element', 'Action', 'State Field'],
      (context.intentsDocument.intents ?? []).map((intent) => ({
        intentId: intent.intentId,
        intentType: intent.intentType,
        element: `${intent.elementId} (${elementsById.get(intent.elementId)?.kind ?? '-'})`,
        action: intent.actionId,
        stateField: intent.stateField,
      })),
    ),
  ].join('\n');
}
