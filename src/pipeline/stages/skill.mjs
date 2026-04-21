// @ts-check

import {
  rm,
} from 'node:fs/promises';
import process from 'node:process';
import { initializeCliUtf8, writeJsonStdout } from '../../infra/cli.mjs';
import { ensureDir, writeTextFile } from '../../infra/io.mjs';
import { toPosixPath, uniqueSortedStrings } from '../../shared/normalize.mjs';
import { upsertSiteCapabilities } from '../../sites/catalog/capabilities.mjs';
import { upsertSiteRegistryRecord } from '../../sites/catalog/registry.mjs';
import { collectFlowDocs } from '../../skills/generation/context-indexes.mjs';
import { publishSkill } from '../../skills/generation/publisher.mjs';
import {
  renderApprovalReference,
  renderFlowsReference,
  renderIndexReference,
  renderInteractionModelReference,
  renderNlIntentsReference,
  renderRecoveryReference,
  renderSkillMd,
} from '../../skills/generation/render-documents.mjs';
import { siteTerminology } from '../../skills/generation/site-render-inputs.mjs';
import {
  remapSupportedIntent,
  resolveCapabilityFamilies,
  resolvePrimaryArchetype,
  resolveSupportedIntents,
} from '../../skills/generation/site-capabilities.mjs';
import { buildOutputPaths, mergeSkillOptions } from '../../skills/generation/skill-options.mjs';
import { resolveSkillSourceInputs } from '../../skills/generation/source-inputs.mjs';

const DEFAULT_OPTIONS = {
  kbDir: undefined,
  outDir: undefined,
  skillName: undefined,
  wikiIndexPath: undefined,
  wikiSchemaPath: undefined,
  flowsDir: undefined,
  recoveryPath: undefined,
  approvalPath: undefined,
  nlIntentsPath: undefined,
  interactionModelPath: undefined,
};

function mergeOptions(options) {
  return mergeSkillOptions({
    ...DEFAULT_OPTIONS,
    ...options,
  });
}

export { siteTerminology, remapSupportedIntent };

export async function generateSkill(url, options = {}) {
  const mergedOptions = mergeOptions({ ...options, url });
  return publishSkill(url, mergedOptions, {
    cwd: process.cwd(),
    resolveSourceInputs: resolveSkillSourceInputs,
    buildOutputPaths,
    collectFlowDocs,
    renderSkillMd,
    renderIndexReference,
    renderFlowsReference,
    renderRecoveryReference,
    renderApprovalReference,
    renderNlIntentsReference,
    renderInteractionModelReference,
    rm,
    ensureDir,
    writeTextFile,
    upsertSiteRegistryRecord,
    upsertSiteCapabilities,
    resolvePrimaryArchetype,
    resolveCapabilityFamilies,
    resolveSupportedIntents,
    toPosixPath,
    uniqueSortedStrings,
  });
}

export function parseCliArgs(argv) {
  if (!argv.length || argv[0] === '--help' || argv[0] === '-h') {
    return { command: 'help' };
  }
  const [inputUrl, ...rest] = argv;
  const flags = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith('--')) {
      continue;
    }
    const key = token.slice(2);
    const next = rest[index + 1];
    if (next && !next.startsWith('--')) {
      flags[key] = next;
      index += 1;
    } else {
      flags[key] = true;
    }
  }
  return {
    command: 'generate',
    inputUrl,
    options: {
      kbDir: flags['kb-dir'],
      outDir: flags['out-dir'],
      skillName: flags['skill-name'],
      wikiIndexPath: flags['wiki-index'],
      wikiSchemaPath: flags['wiki-schema'],
      flowsDir: flags['flows-dir'],
      recoveryPath: flags.recovery,
      approvalPath: flags.approval,
      nlIntentsPath: flags['nl-intents'],
      interactionModelPath: flags['interaction-model'],
    },
  };
}

export function printHelp() {
  console.log([
    'Usage:',
    '  node src/entrypoints/pipeline/generate-skill.mjs <url> [--kb-dir <dir>] [--out-dir <dir>] [--skill-name <name>] [--wiki-index <path>] [--wiki-schema <path>] [--flows-dir <dir>] [--recovery <path>] [--approval <path>] [--nl-intents <path>] [--interaction-model <path>]',
  ].join('\n'));
}

export async function runCli() {
  initializeCliUtf8();
  const parsed = parseCliArgs(process.argv.slice(2));
  if (parsed.command === 'help') {
    printHelp();
    return;
  }
  if (!parsed.inputUrl) {
    throw new Error('Missing <url>.');
  }
  const result = await generateSkill(parsed.inputUrl, parsed.options);
  writeJsonStdout(result);
}
