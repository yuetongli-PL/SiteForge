// @ts-check

import {
  PLANNER_SELECTED_ROUTE_SOURCE,
  SITE_CAPABILITY_PLANNER_SCHEMA_VERSION,
} from './schema.mjs';
import {
  assertNoPlannerSensitiveMaterial,
} from './validator.mjs';

function isPlainObject(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function fail(message, code) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function assertPlainObject(value, name, code = 'planner.request_invalid') {
  if (!isPlainObject(value)) {
    fail(`${name} must be a plain object`, code);
  }
}

function assertNonEmptyString(value, name, code = 'planner.request_invalid') {
  if (typeof value !== 'string' || value.trim() === '') {
    fail(`${name} is required`, code);
  }
}

function readGraphVersion(graph) {
  return graph?.graphVersion ?? graph?.manifest?.graphDataVersion;
}

function readGraphSchemaVersion(graph) {
  return graph?.schemaVersion ?? graph?.manifest?.graphSchemaVersion;
}

function countGraphNodes(graph, type) {
  if (!Array.isArray(graph?.nodes)) {
    return 0;
  }
  return graph.nodes.filter((node) => node?.type === type).length;
}

export function assertPlannerGraphSourceCompatible(source) {
  assertPlainObject(source, 'PlannerGraphSource', 'planner.graph_missing');
  if (source.schemaVersion !== SITE_CAPABILITY_PLANNER_SCHEMA_VERSION) {
    fail('PlannerGraphSource schemaVersion is not compatible', 'planner.version_incompatible');
  }
  if (source.source !== PLANNER_SELECTED_ROUTE_SOURCE) {
    fail('PlannerGraphSource source must be site-capability-graph', 'planner.graph_not_validated');
  }
  assertNonEmptyString(source.graphVersion, 'PlannerGraphSource graphVersion', 'planner.version_incompatible');
  if (source.graphSchemaVersion === undefined || source.graphSchemaVersion === null) {
    fail('PlannerGraphSource graphSchemaVersion is required', 'planner.version_incompatible');
  }
  if (source.validated !== true || source.validationResult !== 'passed') {
    fail('PlannerGraphSource must be validated with passed result', 'planner.graph_not_validated');
  }
  if (source.descriptorOnly !== true || source.redactionRequired !== true) {
    fail('PlannerGraphSource must be descriptor-only with redactionRequired', 'planner.artifact_redaction_required');
  }
  if (
    source.safeSummaryOnly !== true
    || source.routeResolutionAllowed !== false
    || source.executionAllowed !== false
    || source.layerHandoffAllowed !== false
  ) {
    fail('PlannerGraphSource must be a safe summary with route resolution, execution, and Layer handoff disabled', 'planner.graph_not_validated');
  }
  assertNoPlannerSensitiveMaterial(source);
  return true;
}

export function loadValidatedPlannerGraphSource({
  graph,
  validationReport,
  expectedGraphVersion,
  expectedGraphSchemaVersion,
} = {}) {
  assertPlainObject(graph, 'SiteCapabilityGraph', 'planner.graph_missing');
  assertNoPlannerSensitiveMaterial(graph);

  const graphVersion = readGraphVersion(graph);
  const graphSchemaVersion = readGraphSchemaVersion(graph);
  assertNonEmptyString(graphVersion, 'SiteCapabilityGraph graphVersion', 'planner.graph_missing');
  if (graphSchemaVersion === undefined || graphSchemaVersion === null) {
    fail('SiteCapabilityGraph graphSchemaVersion is required', 'planner.graph_missing');
  }

  assertPlainObject(validationReport, 'GraphValidationReport', 'planner.graph_not_validated');
  assertNoPlannerSensitiveMaterial(validationReport);
  if (validationReport.result !== 'passed') {
    fail('GraphValidationReport result must be passed', 'planner.graph_not_validated');
  }
  if (!Array.isArray(validationReport.findings) || validationReport.findings.length !== 0) {
    fail('GraphValidationReport findings must be empty', 'planner.graph_not_validated');
  }
  if (validationReport.graphVersion !== graphVersion) {
    fail('GraphValidationReport graphVersion must match graph', 'planner.version_incompatible');
  }
  if (expectedGraphVersion !== undefined && expectedGraphVersion !== graphVersion) {
    fail('SiteCapabilityGraph graphVersion is not compatible', 'planner.version_incompatible');
  }
  if (
    expectedGraphSchemaVersion !== undefined
    && expectedGraphSchemaVersion !== graphSchemaVersion
  ) {
    fail('SiteCapabilityGraph graphSchemaVersion is not compatible', 'planner.version_incompatible');
  }

  const source = {
    schemaVersion: SITE_CAPABILITY_PLANNER_SCHEMA_VERSION,
    source: PLANNER_SELECTED_ROUTE_SOURCE,
    graphVersion,
    graphSchemaVersion,
    validated: true,
    validationResult: 'passed',
    descriptorOnly: true,
    redactionRequired: true,
    safeSummaryOnly: true,
    routeResolutionAllowed: false,
    executionAllowed: false,
    layerHandoffAllowed: false,
    counts: {
      sites: countGraphNodes(graph, 'SiteNode'),
      capabilities: countGraphNodes(graph, 'CapabilityNode'),
      routes: countGraphNodes(graph, 'RouteNode'),
      endpoints: countGraphNodes(graph, 'EndpointNode'),
      riskPolicies: countGraphNodes(graph, 'RiskPolicyNode'),
    },
    sourceInventories: Array.isArray(graph.manifest?.sourceInventories)
      ? [...graph.manifest.sourceInventories]
      : [],
  };
  assertPlannerGraphSourceCompatible(source);
  return source;
}
