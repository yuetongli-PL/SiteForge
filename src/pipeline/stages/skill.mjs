// @ts-check

import {
  rm,
} from 'node:fs/promises';
import process from 'node:process';
import { initializeCliUtf8, writeJsonStdout } from '../../infra/cli.mjs';
import { createProgressRenderer } from '../../infra/cli/progress.mjs';
import { pipelineStageTitle } from '../../infra/cli/progress-copy.mjs';
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
  resolveSafeActions,
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
  compileSummaryPath: undefined,
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
    resolveSafeActions,
    resolveSupportedIntents,
    toPosixPath,
    uniqueSortedStrings,
  });
}

function buildCliSiteMetadataOptions(flags = {}) {
  const options = {
    ...(flags['metadata-config-dir'] || flags['site-metadata-config-dir']
      ? { configDir: flags['metadata-config-dir'] ?? flags['site-metadata-config-dir'] }
      : {}),
    ...(flags['metadata-runtime-dir'] || flags['site-metadata-runtime-dir']
      ? { runtimeDir: flags['metadata-runtime-dir'] ?? flags['site-metadata-runtime-dir'] }
      : {}),
  };
  return Object.keys(options).length ? options : undefined;
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
      compileSummaryPath: flags['compile-summary'],
      siteMetadataOptions: buildCliSiteMetadataOptions(flags),
      json: flags.json === true,
      quiet: flags.quiet === true,
      progressMode: flags.progress,
      forceTty: flags['force-tty'] === true,
      noTty: flags['no-tty'] === true,
    },
  };
}

export function printHelp() {
  console.log([
    'Usage:',
    '  node src/entrypoints/pipeline/generate-skill.mjs <url> [--kb-dir <dir>] [--out-dir <dir>] [--skill-name <name>] [--wiki-index <path>] [--wiki-schema <path>] [--flows-dir <dir>] [--recovery <path>] [--approval <path>] [--nl-intents <path>] [--interaction-model <path>] [--compile-summary <path>] [--metadata-config-dir <dir>] [--metadata-runtime-dir <dir>] [--json] [--quiet] [--progress auto|interactive|plain] [--force-tty] [--no-tty]',
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
  const progress = createProgressRenderer({
    stdout: process.stdout,
    stderr: process.stderr,
    mode: parsed.options.progressMode ?? 'auto',
    forceTty: parsed.options.forceTty,
    noTty: parsed.options.noTty,
    json: parsed.options.json,
    quiet: parsed.options.quiet,
  });
  const task = progress.task({
    id: 'skill',
    title: pipelineStageTitle('skill'),
    totalStages: 1,
    item: parsed.inputUrl,
  });
  let result;
  try {
    const stage = task.stage({
      id: 'skill',
      title: pipelineStageTitle('skill'),
      index: 1,
      total: 1,
      item: parsed.inputUrl,
    });
    const {
      json: _json,
      quiet: _quiet,
      progressMode: _progressMode,
      forceTty: _forceTty,
      noTty: _noTty,
      ...skillOptions
    } = parsed.options;
    result = await generateSkill(parsed.inputUrl, skillOptions);
    stage.succeed({ message: result.skillDir });
    task.succeed({
      message: 'Skill generated',
      artifacts: [{ label: 'skill', path: result.skillDir }],
    });
  } catch (error) {
    task.fail({ message: error?.message ?? String(error) });
    progress.failure({
      taskId: 'skill',
      title: 'Skill generation failed',
      stage: pipelineStageTitle('skill'),
      reason: error?.message ?? String(error),
      nextStep: `node src/entrypoints/cli.mjs site doctor ${parsed.inputUrl}`,
    });
    throw error;
  }
  writeJsonStdout(result);
}
