// @ts-check

import {
  PLANNER_SELECTED_ROUTE_SOURCE,
  SITE_CAPABILITY_PLANNER_SCHEMA_VERSION,
} from './schema.mjs';
import {
  assertPlannerGraphSourceCompatible,
} from './loader.mjs';
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

function graphNodes(graph, type) {
  return Array.isArray(graph?.nodes)
    ? graph.nodes.filter((node) => node?.type === type)
    : [];
}

function readRoutePriority(route) {
  const value = route?.plannerPriority ?? route?.priority ?? route?.routePriority ?? 0;
  return Number.isFinite(value) ? Number(value) : 0;
}

function routeDescriptor(route, graphVersion) {
  return {
    routeId: route.id,
    routeNodeId: route.id,
    source: PLANNER_SELECTED_ROUTE_SOURCE,
    graphVersion,
    priority: readRoutePriority(route),
    routeKind: route.routeKind,
    pageType: route.pageType,
  };
}

function assertGraphSourceMatches(graph, graphSource) {
  assertPlannerGraphSourceCompatible(graphSource);
  const graphVersion = graph?.graphVersion ?? graph?.manifest?.graphDataVersion;
  if (graphSource.graphVersion !== graphVersion) {
    fail('PlannerGraphSource graphVersion must match graph', 'planner.version_incompatible');
  }
  return graphVersion;
}

function findSiteNode(graph, { siteId, siteKey } = {}) {
  const sites = graphNodes(graph, 'SiteNode');
  if (siteId) {
    return sites.find((site) => site.id === siteId || site.siteKey === siteId);
  }
  if (siteKey) {
    return sites.find((site) => site.siteKey === siteKey || site.id === siteKey);
  }
  return sites.length === 1 ? sites[0] : undefined;
}

function capabilityMatchesIntent(capability, normalizedIntent) {
  if (!normalizedIntent) {
    return true;
  }
  return capability.capabilityKey === normalizedIntent
    || capability.capabilityFamily === normalizedIntent
    || capability.normalizedIntent === normalizedIntent
    || (Array.isArray(capability.supportedTaskTypes)
      && capability.supportedTaskTypes.includes(normalizedIntent));
}

function findCapabilityNode(graph, {
  site,
  capabilityId,
  normalizedIntent,
} = {}) {
  const capabilities = graphNodes(graph, 'CapabilityNode')
    .filter((capability) => !site?.siteKey || capability.siteKey === site.siteKey);
  if (capabilityId) {
    return capabilities.find((capability) => (
      capability.id === capabilityId
      || capability.capabilityKey === capabilityId
      || capability.capabilityFamily === capabilityId
    ));
  }
  return capabilities.find((capability) => capabilityMatchesIntent(capability, normalizedIntent));
}

function resolveRouteRefs(graph, routeRefs, code = 'planner.route_not_found') {
  const routesById = new Map(graphNodes(graph, 'RouteNode').map((route) => [route.id, route]));
  const routes = [];
  for (const routeRef of routeRefs ?? []) {
    const route = routesById.get(routeRef);
    if (!route) {
      fail('Planner route reference does not resolve to a Graph RouteNode', code);
    }
    routes.push(route);
  }
  return routes;
}

export function assertPlannerRouteResolutionCompatible(resolution) {
  assertPlainObject(resolution, 'PlannerRouteResolution', 'planner.route_not_found');
  if (resolution.schemaVersion !== SITE_CAPABILITY_PLANNER_SCHEMA_VERSION) {
    fail('PlannerRouteResolution schemaVersion is not compatible', 'planner.version_incompatible');
  }
  assertNonEmptyString(resolution.graphVersion, 'PlannerRouteResolution graphVersion', 'planner.version_incompatible');
  assertNonEmptyString(resolution.capabilityId, 'PlannerRouteResolution capabilityId', 'planner.capability_not_found');
  if (!Array.isArray(resolution.routeCandidates) || resolution.routeCandidates.length === 0) {
    fail('PlannerRouteResolution routeCandidates are required', 'planner.route_not_found');
  }
  for (const route of [resolution.selectedRoute, ...resolution.routeCandidates, ...(resolution.fallbacks ?? [])]) {
    assertPlainObject(route, 'Planner route descriptor', 'planner.route_not_found');
    assertNonEmptyString(route.routeId, 'Planner route descriptor routeId', 'planner.route_not_found');
    if (route.source !== PLANNER_SELECTED_ROUTE_SOURCE) {
      fail('Planner route descriptor source must be site-capability-graph', 'planner.route_not_found');
    }
    if (route.graphVersion !== resolution.graphVersion) {
      fail('Planner route descriptor graphVersion must match resolution', 'planner.version_incompatible');
    }
  }
  if (
    resolution.descriptorOnly !== true
    || resolution.redactionRequired !== true
    || resolution.executionAllowed !== false
    || resolution.layerHandoffAllowed !== false
    || resolution.siteAdapterInvocationAllowed !== false
    || resolution.downloaderInvocationAllowed !== false
  ) {
    fail('PlannerRouteResolution must be descriptor-only with execution disabled', 'planner.route_context_unsatisfied');
  }
  assertNoPlannerSensitiveMaterial(resolution);
  return true;
}

export function resolvePlannerRoute({
  graph,
  graphSource,
  siteId,
  siteKey,
  normalizedIntent,
  capabilityId,
} = {}) {
  assertPlainObject(graph, 'SiteCapabilityGraph', 'planner.graph_missing');
  assertNoPlannerSensitiveMaterial(graph);
  const graphVersion = assertGraphSourceMatches(graph, graphSource);
  const site = findSiteNode(graph, { siteId, siteKey });
  if (!site) {
    fail('Planner site could not be resolved from Graph', 'planner.site_unresolved');
  }

  const capability = findCapabilityNode(graph, {
    site,
    capabilityId,
    normalizedIntent,
  });
  if (!capability) {
    fail('Planner capability could not be resolved from Graph', 'planner.capability_not_found');
  }
  if (!Array.isArray(capability.routeRefs) || capability.routeRefs.length === 0) {
    fail('Planner capability has no Graph routeRefs', 'planner.route_not_found');
  }

  const routeCandidates = resolveRouteRefs(graph, capability.routeRefs)
    .map((route) => routeDescriptor(route, graphVersion))
    .sort((left, right) => right.priority - left.priority || left.routeId.localeCompare(right.routeId));
  const selectedRoute = routeCandidates[0];
  const selectedRouteNode = graphNodes(graph, 'RouteNode')
    .find((route) => route.id === selectedRoute.routeId);
  const fallbacks = resolveRouteRefs(graph, selectedRouteNode?.fallbackRouteRefs ?? [])
    .map((route) => ({
      ...routeDescriptor(route, graphVersion),
      reason: 'graph_declared_fallback',
    }));

  const resolution = {
    schemaVersion: SITE_CAPABILITY_PLANNER_SCHEMA_VERSION,
    graphVersion,
    siteId: site.id,
    siteKey: site.siteKey,
    normalizedIntent,
    capabilityId: capability.id,
    capabilityKey: capability.capabilityKey,
    selectedRoute,
    routeCandidates,
    fallbacks,
    descriptorOnly: true,
    redactionRequired: true,
    executionAllowed: false,
    layerHandoffAllowed: false,
    siteAdapterInvocationAllowed: false,
    downloaderInvocationAllowed: false,
  };
  assertPlannerRouteResolutionCompatible(resolution);
  return resolution;
}
