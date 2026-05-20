import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  listSiteCapabilityCompilerSchemaDefinitions,
} from '../../../src/app/compiler/index.mjs';
import {
  listSiteCapabilityExecutionSchemaDefinitions,
} from '../../../src/domain/policies/execution/index.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));

function text(path) {
  return readFileSync(join(root, path), 'utf8');
}

test('compiler-executor contract surfaces exist without retired docs fixtures', () => {
  for (const path of [
    'src/app/compiler/schema.mjs',
    'src/app/compiler/digest.mjs',
    'src/app/compiler/validator.mjs',
    'src/app/compiler/capability-intake.mjs',
    'src/app/compiler/config-loader.mjs',
    'src/app/compiler/static-compiler.mjs',
    'src/app/compiler/inventory.mjs',
    'src/app/compiler/coverage-report.mjs',
    'src/app/compiler/graph-builder.mjs',
    'src/app/compiler/redaction-guard.mjs',
    'src/app/compiler/reason-codes.mjs',
    'src/app/compiler/observability.mjs',
    'src/domain/policies/execution/schema.mjs',
    'src/domain/policies/execution/validator.mjs',
    'src/domain/policies/execution/layer-handoff.mjs',
    'src/domain/policies/execution/artifact-guard.mjs',
    'src/domain/policies/execution/policy-gate.mjs',
    'src/domain/policies/execution/coverage-delta-queue.mjs',
    'src/domain/policies/execution/layer-runtime-consumer.mjs',
    'src/entrypoints/sites/site-capability-compile.mjs',
  ]) {
    assert.equal(existsSync(join(root, path)), true, `${path} should exist`);
  }
});

test('compiler and execution schemas list required final contracts', () => {
  const compilerNames = new Set(listSiteCapabilityCompilerSchemaDefinitions().map((entry) => entry.name));
  const executionNames = new Set(listSiteCapabilityExecutionSchemaDefinitions().map((entry) => entry.name));
  for (const name of [
    'SiteCompileRequest',
    'SiteCompileScope',
    'SiteCompileManifest',
    'CapabilityIntake',
    'CapabilityIntakeQuestionnaire',
    'CapabilityCoverageSummary',
    'CompilerConfigSource',
    'CompilerSourceDigest',
    'IncrementalCompileSummary',
    'NodeInventory',
    'CapabilityInventory',
    'ExecutionPathInventory',
    'FunctionPathTrace',
    'RequirementInventory',
    'CompileCoverageReport',
    'UnknownNodeReport',
    'CapabilityGraphDraft',
    'GraphBuildManifest',
    'ExecutionManifest',
    'ExecutionFeedback',
    'CoverageDelta',
    'CoverageDeltaArtifactQueue',
  ]) {
    assert.equal(compilerNames.has(name) || executionNames.has(name), true, `${name} should be listed`);
  }
});

test('compiler/execution modules do not import runtime downloader session browser or adapters', () => {
  for (const path of [
    'src/app/compiler/index.mjs',
    'src/app/compiler/static-compiler.mjs',
    'src/app/compiler/config-loader.mjs',
    'src/app/compiler/graph-builder.mjs',
    'src/domain/policies/execution/index.mjs',
    'src/domain/policies/execution/layer-handoff.mjs',
    'src/domain/policies/execution/policy-gate.mjs',
    'src/domain/policies/execution/coverage-delta-queue.mjs',
    'src/domain/policies/execution/layer-runtime-consumer.mjs',
    'src/entrypoints/sites/site-capability-compile.mjs',
  ]) {
    const source = text(path);
    assert.doesNotMatch(source, /from ['"].*(?:sites\/downloads|sites\\downloads|sites\/sessions|sites\\sessions|infra\/browser|infra\\browser|core\/adapters|core\\adapters)/u);
  }
});
