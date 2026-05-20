// @ts-check

import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(MODULE_DIR, '..', '..', '..');
const COMPILE_ENTRYPOINT = path.join(REPO_ROOT, 'src', 'entrypoints', 'sites', 'site-capability-compile.mjs');

function summaryPathFromResult(outDir, result = {}) {
  const refs = result.artifactWrite?.artifactRefs ?? [];
  return refs.includes('site-compile-result-summary.json')
    ? path.join(outDir, 'site-compile-result-summary.json')
    : null;
}

function runCompileEntrypoint(args = []) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const child = spawn(process.execPath, [COMPILE_ENTRYPOINT, ...args], {
      cwd: process.cwd(),
      env: process.env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || stdout.trim() || `site capability compile exited with ${code}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (error) {
        reject(new Error(`Failed to parse site capability compile JSON: ${error?.message ?? String(error)}`));
      }
    });
  });
}

export async function compileSiteCapabilityLayer(inputUrl, options = {}) {
  const outDir = path.resolve(options.outDir ?? path.join(process.cwd(), 'runs', 'sites', 'site-capability-compile'));
  const args = [
    '--url',
    inputUrl,
    '--out-dir',
    outDir,
    '--json',
  ];
  if (options.writeArtifacts !== false) {
    args.push('--write-artifacts');
  }
  if (options.intent) {
    args.push('--intent', options.intent);
  }
  const requestedCapabilities = options.requestedCapabilities ?? [];
  if (requestedCapabilities.length) {
    args.push('--capabilities', requestedCapabilities.join(','));
  }
  const result = await runCompileEntrypoint(args);
  const compileSummaryPath = summaryPathFromResult(outDir, result);
  return {
    status: result.planStatus === 'blocked' ? 'blocked' : 'success',
    outDir,
    compileSummaryPath,
    siteKey: result.siteKey,
    siteId: result.siteId,
    compileId: result.compileId,
    graphVersion: result.graphVersion,
    graphValidationResult: result.graphValidationResult,
    planStatus: result.planStatus,
    plannerHandoffReady: result.plannerHandoffReady === true,
    executionPolicyStatus: result.executionPolicyStatus ?? null,
    layerRuntimeConsumerReady: result.layerRuntimeConsumerReady === true,
    reasonCode: result.reasonCode ?? null,
    artifactWrite: result.artifactWrite ?? null,
    redactionRequired: true,
    summary: {
      graphValidationResult: result.graphValidationResult,
      planStatus: result.planStatus,
      plannerHandoffReady: result.plannerHandoffReady === true,
      layerRuntimeConsumerReady: result.layerRuntimeConsumerReady === true,
      compileSummaryPath,
    },
  };
}
