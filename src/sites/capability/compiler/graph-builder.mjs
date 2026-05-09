// @ts-check

import {
  SITE_CAPABILITY_GRAPH_SCHEMA_VERSION,
  validateSiteCapabilityGraph,
} from '../site-capability-graph.mjs';
import {
  SITE_CAPABILITY_COMPILER_SCHEMA_VERSION,
  SITE_CAPABILITY_COMPILER_VERSION,
} from './schema.mjs';
import {
  assertNoCompilerSensitiveMaterial,
  assertSiteCompileManifestCompatible,
} from './validator.mjs';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function graphVersionFromManifest(manifest) {
  const digest = String(manifest.manifestDigest ?? manifest.sourceDigest ?? manifest.compilerVersion)
    .replace(/^sha256:/u, '')
    .slice(0, 16);
  return `compiler-generated:${manifest.siteKey ?? manifest.siteId}:${digest}`;
}

function graphNodesFromManifest(manifest) {
  return [
    ...clone(manifest.inventories.nodes),
    ...clone(manifest.inventories.capabilities),
  ].map((node) => {
    const copy = { ...node, schemaVersion: SITE_CAPABILITY_GRAPH_SCHEMA_VERSION };
    const compilerProvenance = Object.fromEntries(Object.entries({
      source: copy.source,
      sourceType: copy.sourceType,
      evidenceRef: copy.evidenceRef,
      confidence: copy.confidence,
      freshness: copy.freshness,
      sourceRefs: copy.sourceRefs,
      sourceDigest: manifest.sourceDigest,
    }).filter(([, value]) => value !== undefined && value !== null));
    if (Object.keys(compilerProvenance).length > 0) {
      copy.compilerProvenance = compilerProvenance;
    }
    delete copy.source;
    delete copy.sourceType;
    delete copy.evidenceRef;
    delete copy.confidence;
    delete copy.freshness;
    return copy;
  });
}

function edge(id, type, from, to) {
  return {
    schemaVersion: SITE_CAPABILITY_GRAPH_SCHEMA_VERSION,
    id,
    type,
    from,
    to,
    sourceRefs: ['config/site-capabilities.json', 'config/site-registry.json'],
    testEvidenceRefs: ['test:site-capability-compiler-executor'],
  };
}

function graphEdgesFromManifest(manifest) {
  const site = manifest.inventories.nodes.find((node) => node.type === 'SiteNode');
  const edges = [];
  for (const capability of manifest.inventories.capabilities) {
    edges.push(edge(
      `edge:${capability.id}:site`,
      'site_declares_capability',
      site.id,
      capability.id,
    ));
    for (const routeRef of capability.routeRefs ?? []) {
      edges.push(edge(
        `edge:${capability.id}:route:${routeRef}`,
        'capability_exposed_on_route',
        capability.id,
        routeRef,
      ));
    }
    if (capability.riskPolicyRef) {
      edges.push(edge(
        `edge:${capability.id}:risk`,
        'capability_guarded_by_risk_policy',
        capability.id,
        capability.riskPolicyRef,
      ));
    }
    for (const authRequirementRef of capability.authRequirementRefs ?? []) {
      edges.push(edge(
        `edge:${capability.id}:auth:${authRequirementRef}`,
        'capability_requires_auth',
        capability.id,
        authRequirementRef,
      ));
    }
    for (const sessionRequirementRef of capability.sessionRequirementRefs ?? []) {
      edges.push(edge(
        `edge:${capability.id}:session:${sessionRequirementRef}`,
        'capability_requires_session',
        capability.id,
        sessionRequirementRef,
      ));
    }
  }
  edges.push(edge(
    'edge:artifact:compiler-graph-validation-report:redaction',
    'artifact_guarded_by_redaction',
    'artifact:compiler-graph-validation-report',
    'schema:SiteCapabilityGraph',
  ));
  return edges;
}

export function createCapabilityGraphDraftFromCompileManifest(manifest) {
  assertSiteCompileManifestCompatible(manifest);
  const graphVersion = graphVersionFromManifest(manifest);
  const graph = {
    schemaVersion: SITE_CAPABILITY_GRAPH_SCHEMA_VERSION,
    graphVersion,
    manifest: {
      schemaVersion: SITE_CAPABILITY_GRAPH_SCHEMA_VERSION,
      graphSchemaVersion: SITE_CAPABILITY_GRAPH_SCHEMA_VERSION,
      graphDataVersion: graphVersion,
      compilerGenerated: true,
      compilerVersion: manifest.compilerVersion,
      compilerSchemaVersion: manifest.schemaVersion,
      sourceCompileManifestId: manifest.compileId,
      sourceDigest: manifest.sourceDigest,
      manifestDigest: manifest.manifestDigest,
      incrementalCompile: manifest.incrementalCompile,
      layerCompatibility: {
        kernelCompatibilityVersion: 'compiler-kernel-v1',
        siteAdapterVersion: manifest.adapterId ?? 'compiler-static-adapter',
        downloaderCompatibilityVersion: 'compiler-layer-owned-downloader-v1',
      },
      sourceInventories: manifest.sourceRefs.map((ref) => ref.ref),
    },
    nodes: graphNodesFromManifest(manifest),
    edges: graphEdgesFromManifest(manifest),
    redactionRequired: true,
  };
  assertNoCompilerSensitiveMaterial(graph);
  return graph;
}

export function buildSiteCapabilityGraphFromCompileManifest(manifest) {
  const graph = createCapabilityGraphDraftFromCompileManifest(manifest);
  const validationReport = validateSiteCapabilityGraph(graph);
  const graphBuildManifest = {
    schemaVersion: SITE_CAPABILITY_COMPILER_SCHEMA_VERSION,
    compilerVersion: SITE_CAPABILITY_COMPILER_VERSION,
    sourceCompileManifestId: manifest.compileId,
    siteId: manifest.siteId,
    graphVersion: graph.graphVersion,
    graphSchemaVersion: SITE_CAPABILITY_GRAPH_SCHEMA_VERSION,
    sourceDigest: manifest.sourceDigest,
    manifestDigest: manifest.manifestDigest,
    incrementalCompile: manifest.incrementalCompile,
    validationResult: validationReport.result,
    findingCount: validationReport.findings.length,
    redactionRequired: true,
  };
  assertNoCompilerSensitiveMaterial(graphBuildManifest);
  return {
    graph,
    validationReport,
    graphBuildManifest,
    redactionRequired: true,
  };
}
