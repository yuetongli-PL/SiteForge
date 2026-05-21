// @ts-check

import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { runSingleStageCliWithProgress } from '../src/infra/cli/progress-cli.mjs';
import {
  HELP,
  buildReport,
  parseArgs,
  writeReport,
} from '../tools/social-live-report-core.mjs';

export {
  buildReport,
  parseArgs,
  writeReport,
};

export async function main(argv) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(`${HELP}\n`);
    return;
  }
  const result = await runSingleStageCliWithProgress({
    inputUrl: `${options.site} social live report`,
    options: {
      ...options,
      json: options.json === true || options.write === false,
    },
    taskId: 'socialLiveReport',
    title: 'Social live report',
    stageId: 'socialLiveReport',
    stageTitle: '汇总社交 live 报告',
    run: async (stageOptions) => {
      const report = await buildReport(stageOptions);
      const outputs = await writeReport(stageOptions, report);
      return { report, outputs };
    },
    successMessage: (stageResult) => `rows=${stageResult?.report?.totalRows ?? 0}`,
    artifacts: (stageResult) => [
      stageResult?.outputs?.jsonPath ? { label: 'JSON', path: stageResult.outputs.jsonPath } : null,
      stageResult?.outputs?.markdownPath ? { label: 'Markdown', path: stageResult.outputs.markdownPath } : null,
    ].filter(Boolean),
    isFailureResult: undefined,
    failureReason: undefined,
    warningResult: undefined,
    failureTitle: 'Social live report safely stopped',
    nextStep: 'Check the runs root and rerun the report after the expected manifests exist.',
  });
  const report = result.report;
  const outputs = result.outputs;
  if (outputs) {
    process.stdout.write(`JSON: ${outputs.jsonPath}\nMarkdown: ${outputs.markdownPath}\n`);
  } else {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  }
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (entryPath && entryPath === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error?.message ?? String(error));
    process.exitCode = 1;
  });
}
