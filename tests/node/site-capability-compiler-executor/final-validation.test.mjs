import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  listSiteCapabilityCompilerSchemaDefinitions,
} from '../../../src/sites/capability/compiler/index.mjs';
import {
  listSiteCapabilityExecutionSchemaDefinitions,
} from '../../../src/sites/capability/execution/index.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));

function text(path) {
  return readFileSync(join(root, path), 'utf8');
}

test('compiler-executor final docs and contract surfaces exist', () => {
  for (const path of [
    'docs/site-capability-compiler-executor/DESIGN.md',
    'docs/site-capability-compiler-executor/IMPLEMENTATION_MATRIX.md',
    'docs/site-capability-compiler-executor/MIGRATION_PLAN.md',
    'src/sites/capability/compiler/schema.mjs',
    'src/sites/capability/compiler/digest.mjs',
    'src/sites/capability/compiler/validator.mjs',
    'src/sites/capability/compiler/capability-intake.mjs',
    'src/sites/capability/compiler/config-loader.mjs',
    'src/sites/capability/compiler/static-compiler.mjs',
    'src/sites/capability/compiler/inventory.mjs',
    'src/sites/capability/compiler/coverage-report.mjs',
    'src/sites/capability/compiler/graph-builder.mjs',
    'src/sites/capability/compiler/redaction-guard.mjs',
    'src/sites/capability/compiler/reason-codes.mjs',
    'src/sites/capability/compiler/observability.mjs',
    'src/sites/capability/execution/schema.mjs',
    'src/sites/capability/execution/validator.mjs',
    'src/sites/capability/execution/layer-handoff.mjs',
    'src/sites/capability/execution/artifact-guard.mjs',
    'src/sites/capability/execution/policy-gate.mjs',
    'src/sites/capability/execution/coverage-delta-queue.mjs',
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
    'src/sites/capability/compiler/index.mjs',
    'src/sites/capability/compiler/static-compiler.mjs',
    'src/sites/capability/compiler/config-loader.mjs',
    'src/sites/capability/compiler/graph-builder.mjs',
    'src/sites/capability/execution/index.mjs',
    'src/sites/capability/execution/layer-handoff.mjs',
    'src/sites/capability/execution/policy-gate.mjs',
    'src/sites/capability/execution/coverage-delta-queue.mjs',
    'src/entrypoints/sites/site-capability-compile.mjs',
  ]) {
    const source = text(path);
    assert.doesNotMatch(source, /from ['"].*(?:sites\/downloads|sites\\downloads|sites\/sessions|sites\\sessions|infra\/browser|infra\\browser|core\/adapters|core\\adapters)/u);
  }
});
