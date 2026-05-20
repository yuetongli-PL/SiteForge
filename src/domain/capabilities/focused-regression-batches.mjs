// @ts-check

export const FOCUSED_REGRESSION_BATCH_DEFINITION_SCHEMA_VERSION = 1;

function isObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function assertNonEmptyString(value, fieldPath) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`FocusedRegressionBatchDefinition ${fieldPath} must be a non-empty string`);
  }
}

function assertPositiveInteger(value, fieldPath) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`FocusedRegressionBatchDefinition ${fieldPath} must be a positive integer`);
  }
}

function assertOptionalStringArray(value, fieldPath) {
  if (value === undefined) {
    return;
  }
  if (!Array.isArray(value)) {
    throw new Error(`FocusedRegressionBatchDefinition ${fieldPath} must be an array when present`);
  }
  value.forEach((entry, index) => {
    assertNonEmptyString(entry, `${fieldPath}.${index}`);
  });
}

function assertFocusedRegressionBatchCompatible(batch, index) {
  if (!isObject(batch)) {
    throw new Error(`FocusedRegressionBatchDefinition batches.${index} must be an object`);
  }
  assertNonEmptyString(batch.id, `batches.${index}.id`);
  assertNonEmptyString(batch.command, `batches.${index}.command`);
  assertNonEmptyString(batch.purpose, `batches.${index}.purpose`);
  if (!batch.command.startsWith('node --test ')) {
    throw new Error(`FocusedRegressionBatchDefinition batches.${index}.command must be a focused node --test command`);
  }
  if (!Array.isArray(batch.sectionFocus) || batch.sectionFocus.length === 0) {
    throw new Error(`FocusedRegressionBatchDefinition batches.${index}.sectionFocus must be a non-empty array`);
  }
  batch.sectionFocus.forEach((section, sectionIndex) => {
    assertPositiveInteger(section, `batches.${index}.sectionFocus.${sectionIndex}`);
  });
  assertOptionalStringArray(batch.recentPassingEvidence, `batches.${index}.recentPassingEvidence`);
}

export function assertFocusedRegressionBatchDefinitionCompatible(definition = {}) {
  if (!isObject(definition)) {
    throw new Error('FocusedRegressionBatchDefinition must be an object');
  }
  if (definition.schemaVersion === undefined || definition.schemaVersion === null) {
    throw new Error('FocusedRegressionBatchDefinition schemaVersion is required');
  }
  if (definition.schemaVersion !== FOCUSED_REGRESSION_BATCH_DEFINITION_SCHEMA_VERSION) {
    throw new Error(`FocusedRegressionBatchDefinition schemaVersion ${definition.schemaVersion} is not compatible`);
  }
  assertNonEmptyString(definition.description, 'description');
  if (!Array.isArray(definition.batches) || definition.batches.length === 0) {
    throw new Error('FocusedRegressionBatchDefinition batches must be a non-empty array');
  }
  if (!isObject(definition.layeredValidationPolicy)) {
    throw new Error('FocusedRegressionBatchDefinition layeredValidationPolicy must be an object');
  }
  for (const policyName of ['directTask', 'sameTypeBatch', 'matrix', 'fullSuite']) {
    assertNonEmptyString(definition.layeredValidationPolicy[policyName], `layeredValidationPolicy.${policyName}`);
  }
  const seenBatchIds = new Set();
  definition.batches.forEach((batch, index) => {
    assertFocusedRegressionBatchCompatible(batch, index);
    if (seenBatchIds.has(batch.id)) {
      throw new Error(`FocusedRegressionBatchDefinition duplicate batch id: ${batch.id}`);
    }
    seenBatchIds.add(batch.id);
  });
  if (!isObject(definition.fullSuitePolicy)) {
    throw new Error('FocusedRegressionBatchDefinition fullSuitePolicy must be an object');
  }
  assertNonEmptyString(definition.fullSuitePolicy.nodeWildcard, 'fullSuitePolicy.nodeWildcard');
  assertNonEmptyString(definition.fullSuitePolicy.pythonUnittest, 'fullSuitePolicy.pythonUnittest');
  return true;
}

export function createFocusedRegressionBatchDefinitionFixture(overrides = {}) {
  return {
    schemaVersion: FOCUSED_REGRESSION_BATCH_DEFINITION_SCHEMA_VERSION,
    description: 'Synthetic focused regression batch definition fixture.',
    layeredValidationPolicy: {
      directTask: 'Run the directly related synthetic focused test first.',
      sameTypeBatch: 'Run a synthetic same-type batch before status upgrade.',
      matrix: 'Run the synthetic matrix test after matrix updates.',
      fullSuite: 'Defer wildcard Node and Python full suites for synthetic fixture.',
    },
    batches: [{
      id: 'synthetic-focused-batch',
      sectionFocus: [11, 12],
      command: 'node --test tests/node/schema-inventory.test.mjs',
      purpose: 'Synthetic compatibility fixture for focused regression batch governance.',
    }],
    fullSuitePolicy: {
      nodeWildcard: 'deferred for synthetic fixture',
      pythonUnittest: 'deferred for synthetic fixture',
    },
    ...overrides,
  };
}
