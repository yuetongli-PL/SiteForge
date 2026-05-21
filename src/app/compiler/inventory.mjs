// @ts-check

import {
  SITE_CAPABILITY_COMPILER_SCHEMA_VERSION,
} from './schema.mjs';
import {
  assertNoCompilerSensitiveMaterial,
} from './validator.mjs';
import {
  capabilityIntakeStatusForCapability,
} from './capability-intake.mjs';

function cleanSegment(value, fallback = 'unknown') {
  const text = String(value ?? fallback).trim().toLowerCase();
  return text
    .replace(/^site:/u, '')
    .replace(/[^a-z0-9.-]+/gu, '-')
    .replace(/^-+|-+$/gu, '') || fallback;
}

function list(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

/** @param {Record<string, any>} [capability] */
function sourceRefsFor(capability = {}) {
  const refs = list(capability.sourceRefs);
  return refs.length ? refs : ['config/site-capabilities.json', 'config/site-registry.json'];
}

/** @param {Record<string, any>} [capability] */
function capabilityMode(capability = {}) {
  if (capability.mode) {
    return capability.mode;
  }
  if (/download/iu.test(String(capability.normalizedIntent ?? capability.capabilityKey ?? ''))) {
    return 'download';
  }
  return 'readOnly';
}

/** @param {Record<string, any>} [capability] */
function requiresAuth(capability = {}, capabilityConfig = {}, registrySite = {}) {
  return capability.requiresAuth === true
    || capabilityConfig.downloader?.requiresLogin === true
    || registrySite.downloadSessionRequirement === 'required';
}

/** @param {Record<string, any>} [capability] */
function requiresSession(capability = {}, capabilityConfig = {}, registrySite = {}) {
  return capability.requiresSession === true || requiresAuth(capability, capabilityConfig, registrySite);
}

/** @param {Record<string, any>} [capability] */
function requiresSigner(capability = {}) {
  return capability.requiresSigner === true;
}

/** @param {Record<string, any>} [capability] */
function requiresApproval(capability = {}) {
  const mode = capabilityMode(capability);
  return capability.requiresApproval === true || mode !== 'readOnly';
}

/** @param {Record<string, any>} [capability] */
function riskPolicyKey(capability = {}) {
  const state = capability.riskState ?? (capability.riskReasonCode ? 'blocked' : 'normal');
  const reason = capability.riskReasonCode ?? state;
  return cleanSegment(reason, state === 'normal' ? 'normal-readonly' : 'blocked');
}

function riskPolicyRef(siteSegment, capability = {}) {
  return `risk-policy:${siteSegment}:${riskPolicyKey(capability)}`;
}

function authRequirementRef(siteSegment, capability = {}) {
  return `auth-requirement:${siteSegment}:${cleanSegment(capability.capabilityKey ?? capability.normalizedIntent, 'capability')}`;
}

function sessionRequirementRef(siteSegment, capability = {}) {
  return `session-requirement:${siteSegment}:${cleanSegment(capability.capabilityKey ?? capability.normalizedIntent, 'capability')}`;
}

/** @param {Record<string, any>} options */
function createRiskPolicyNode({ siteSegment, capability = {} } = {}) {
  const state = capability.riskState ?? (capability.riskReasonCode ? 'blocked' : 'normal');
  const reasonCodeRefs = capability.riskReasonCode ? [capability.riskReasonCode] : [];
  const blocked = state === 'blocked';
  return {
    schemaVersion: SITE_CAPABILITY_COMPILER_SCHEMA_VERSION,
    id: riskPolicyRef(siteSegment, capability),
    type: 'RiskPolicyNode',
    state,
    allowedActions: blocked ? [] : ['read'],
    blockedActions: blocked ? ['read', 'write', 'download'] : ['write'],
    requiresApproval: blocked || requiresApproval(capability),
    cooldownRequired: blocked,
    isolationRequired: blocked,
    manualRecoveryRequired: blocked,
    degradable: true,
    artifactWriteAllowed: true,
    sourceRefs: ['config/site-capabilities.json', 'config/site-registry.json'],
    reasonCodeRefs,
    redactionRequired: true,
  };
}

/** @param {Record<string, any>} options */
function createRequirementGraphNodes({ siteSegment, siteKey, capability, capabilityConfig, registrySite } = {}) {
  const capabilityKey = cleanSegment(capability.capabilityKey ?? capability.normalizedIntent, 'capability');
  const capabilityId = `capability:${siteSegment}:${capabilityKey}`;
  const nodes = [];
  if (requiresAuth(capability, capabilityConfig, registrySite)) {
    nodes.push({
      schemaVersion: SITE_CAPABILITY_COMPILER_SCHEMA_VERSION,
      id: authRequirementRef(siteSegment, capability),
      type: 'AuthRequirementNode',
      authKind: 'declared-auth-required',
      requiredFor: [capabilityId],
      proofType: 'SessionViewSummary',
      allowedMaterial: ['redacted-session-state', 'SessionViewSummary'],
      forbiddenMaterial: ['Cookie', 'Authorization', 'SESSDATA', 'accessToken', 'refreshToken'],
      reasonCodeRefs: ['compiler.auth_required'],
      sourceRefs: ['config/site-capabilities.json', 'config/site-registry.json'],
      redactionRequired: true,
    });
  }
  if (requiresSession(capability, capabilityConfig, registrySite)) {
    nodes.push({
      schemaVersion: SITE_CAPABILITY_COMPILER_SCHEMA_VERSION,
      id: sessionRequirementRef(siteSegment, capability),
      type: 'SessionRequirementNode',
      purpose: 'capability-precondition-summary',
      scope: siteKey ?? siteSegment,
      ttlClass: 'short',
      permissionClass: 'read',
      profileIsolation: 'no-browser-profile-material',
      networkContextClass: 'not_persisted',
      auditRequired: true,
      revocationRequired: true,
      sourceRefs: ['config/site-capabilities.json', 'config/site-registry.json'],
      redactionRequired: true,
    });
  }
  return nodes;
}

/** @param {Record<string, any>} options */
export function createNodeInventory({
  siteId,
  siteKey,
  adapterId,
  capabilities = [],
  capabilityConfig = {},
  registrySite = {},
} = {}) {
  const siteSegment = cleanSegment(siteKey ?? siteId, 'site');
  const riskPolicies = new Map();
  riskPolicies.set(
    riskPolicyRef(siteSegment, { riskState: 'normal' }),
    createRiskPolicyNode({ siteSegment, capability: { riskState: 'normal' } }),
  );
  for (const capability of capabilities) {
    riskPolicies.set(
      riskPolicyRef(siteSegment, capability),
      createRiskPolicyNode({ siteSegment, capability }),
    );
  }
  const nodes = [
    {
      schemaVersion: SITE_CAPABILITY_COMPILER_SCHEMA_VERSION,
      id: `site:${siteSegment}`,
      type: 'SiteNode',
      siteKey: siteKey ?? siteSegment,
      hostFamily: [siteKey ?? siteSegment],
      adapterRef: {
        id: adapterId ?? `${siteSegment}-adapter`,
        version: 'compiler-static-v1',
      },
      source: 'static',
      sourceType: 'site-registry',
      evidenceRef: 'config/site-registry.json',
      confidence: 0.8,
      freshness: 'repo-local',
      redactionRequired: true,
    },
    ...riskPolicies.values(),
    {
      schemaVersion: SITE_CAPABILITY_COMPILER_SCHEMA_VERSION,
      id: 'schema:SiteCapabilityGraph',
      type: 'SchemaNode',
      schemaName: 'SiteCapabilityGraph',
      governedVersion: 1,
      owner: 'Capability',
      sourcePath: 'src/domain/capabilities/site-capability-graph.mjs',
      redactionRequired: true,
    },
    {
      schemaVersion: SITE_CAPABILITY_COMPILER_SCHEMA_VERSION,
      id: 'artifact:compiler-graph-validation-report',
      type: 'ArtifactContractNode',
      artifactFamily: 'site-capability-compiler-graph',
      redactionRequired: true,
      schemaRef: 'schema:SiteCapabilityGraph',
      writeGuard: 'SecurityGuard/Redaction',
      auditRequired: true,
    },
    {
      schemaVersion: SITE_CAPABILITY_COMPILER_SCHEMA_VERSION,
      id: 'test:site-capability-compiler-executor',
      type: 'TestEvidenceNode',
      testPath: 'tests/node/site-capability-compiler-executor/graph-builder.test.mjs',
      command: 'node --test tests/node/site-capability-compiler-executor/graph-builder.test.mjs',
      result: 'compiler-generated-fixture-compatible',
      fixtureType: 'synthetic-redacted',
      redactionRequired: true,
    },
    {
      schemaVersion: SITE_CAPABILITY_COMPILER_SCHEMA_VERSION,
      id: 'version:compiler-generated-graph-v1',
      type: 'VersionNode',
      versionKind: 'graphDataVersion',
      version: 'compiler-generated-graph-v1',
      redactionRequired: true,
    },
    {
      schemaVersion: SITE_CAPABILITY_COMPILER_SCHEMA_VERSION,
      id: 'failure:compiler-coverage-incomplete',
      type: 'FailureModeNode',
      reasonCode: 'compiler.coverage_incomplete',
      retryable: false,
      cooldownRequired: false,
      isolationRequired: false,
      manualRecoveryRequired: true,
      degradable: true,
      artifactWriteAllowed: true,
      redactionRequired: true,
    },
    {
      schemaVersion: SITE_CAPABILITY_COMPILER_SCHEMA_VERSION,
      id: 'observability:compiler-manifest-generated',
      type: 'ObservabilityNode',
      eventName: 'compiler.manifest.generated',
      requiredFields: [
        'traceId',
        'correlationId',
        'site',
        'compileId',
        'compilerVersion',
        'validationResult',
      ],
      producerRefs: ['test:site-capability-compiler-executor'],
      redactionRequired: true,
    },
  ];

  for (const capability of capabilities) {
    const routeKey = cleanSegment(capability.routeKey ?? capability.capabilityKey, 'route');
    const requirementNodes = createRequirementGraphNodes({
      siteSegment,
      siteKey,
      capability,
      capabilityConfig,
      registrySite,
    });
    nodes.push(...requirementNodes);
    nodes.push({
      schemaVersion: SITE_CAPABILITY_COMPILER_SCHEMA_VERSION,
      id: `route:${siteSegment}:${routeKey}`,
      type: 'RouteNode',
      siteKey: siteKey ?? siteSegment,
      routeKind: capability.routeKind ?? 'page',
      urlPattern: capability.urlPattern ?? `https://${siteKey ?? siteSegment}/${routeKey}/:id`,
      pageType: capability.pageType ?? 'public-detail',
      capabilityRefs: [`capability:${siteSegment}:${cleanSegment(capability.capabilityKey, 'capability')}`],
      adapterRef: {
        id: adapterId ?? `${siteSegment}-adapter`,
        version: 'compiler-static-v1',
      },
      riskPolicyRef: riskPolicyRef(siteSegment, capability),
      plannerPriority: capability.priority ?? 10,
      sourceRefs: sourceRefsFor(capability),
      testEvidenceRefs: ['test:site-capability-compiler-executor'],
      requiresAuth: requiresAuth(capability, capabilityConfig, registrySite),
      requiresSession: requiresSession(capability, capabilityConfig, registrySite),
      requiresSigner: requiresSigner(capability),
      requiresApproval: requiresApproval(capability),
      redactionRequired: true,
    });
  }

  assertNoCompilerSensitiveMaterial(nodes);
  return nodes;
}

/** @param {Record<string, any>} options */
export function createCapabilityInventory({
  siteId,
  siteKey,
  capabilities = [],
  capabilityConfig = {},
  registrySite = {},
  capabilityIntake = null,
} = {}) {
  const siteSegment = cleanSegment(siteKey ?? siteId, 'site');
  const inventory = capabilities.map((capability) => {
    const capabilityKey = cleanSegment(capability.capabilityKey ?? capability.normalizedIntent, 'capability');
    const routeKey = cleanSegment(capability.routeKey ?? capabilityKey, 'route');
    const authRefs = requiresAuth(capability, capabilityConfig, registrySite)
      ? [authRequirementRef(siteSegment, capability)]
      : [];
    const sessionRefs = requiresSession(capability, capabilityConfig, registrySite)
      ? [sessionRequirementRef(siteSegment, capability)]
      : [];
    return {
      schemaVersion: SITE_CAPABILITY_COMPILER_SCHEMA_VERSION,
      id: `capability:${siteSegment}:${capabilityKey}`,
      type: 'CapabilityNode',
      siteKey: siteKey ?? siteSegment,
      capabilityKey,
      normalizedIntent: capability.normalizedIntent ?? capability.supportedTaskType ?? capabilityKey,
      capabilityFamily: capability.capabilityFamily ?? capabilityKey,
      mode: capabilityMode(capability),
      agentExposed: capability.agentExposed !== false,
      requiresApproval: requiresApproval(capability),
      requiresAuth: requiresAuth(capability, capabilityConfig, registrySite),
      requiresSession: requiresSession(capability, capabilityConfig, registrySite),
      requiresSigner: requiresSigner(capability),
      supportedTaskTypes: list(capability.supportedTaskTypes).length
        ? list(capability.supportedTaskTypes)
        : [capability.normalizedIntent ?? capabilityKey],
      routeRefs: [`route:${siteSegment}:${routeKey}`],
      authRequirementRefs: authRefs,
      sessionRequirementRefs: sessionRefs,
      riskPolicyRef: riskPolicyRef(siteSegment, capability),
      sourceRefs: sourceRefsFor(capability),
      testEvidenceRefs: ['test:site-capability-compiler-executor'],
      confidence: capability.confidence ?? 0.8,
      freshness: 'repo-local',
      intakeStatus: capabilityIntakeStatusForCapability(capability, capabilityIntake),
      targetedByCapabilityIntake: capabilityIntakeStatusForCapability(capability, capabilityIntake) === 'requested',
      unconfirmedCoveragePolicy: capabilityIntake?.unconfirmedCapabilityPolicy ?? 'best_effort_full_coverage',
      redactionRequired: true,
    };
  });
  assertNoCompilerSensitiveMaterial(inventory);
  return inventory;
}

/** @param {Record<string, any>} options */
export function createExecutionPathInventory({ siteId, siteKey, capabilities = [] } = {}) {
  const siteSegment = cleanSegment(siteKey ?? siteId, 'site');
  const paths = capabilities.map((capability) => {
    const capabilityKey = cleanSegment(capability.capabilityKey ?? capability.normalizedIntent, 'capability');
    const routeKey = cleanSegment(capability.routeKey ?? capabilityKey, 'route');
    return {
      schemaVersion: SITE_CAPABILITY_COMPILER_SCHEMA_VERSION,
      id: `path:${siteSegment}:${capabilityKey}:static`,
      capabilityId: `capability:${siteSegment}:${capabilityKey}`,
      steps: [
        {
          kind: 'route-descriptor',
          routeRef: `route:${siteSegment}:${routeKey}`,
          mutating: false,
        },
      ],
      source: 'static',
      evidenceRef: 'config/site-capabilities.json',
      confidence: 0.7,
      freshness: 'repo-local',
      redactionRequired: true,
    };
  });
  assertNoCompilerSensitiveMaterial(paths);
  return paths;
}

/** @param {Record<string, any>} options */
export function createRequirementInventory({
  siteId,
  siteKey,
  capabilities = [],
  capabilityConfig = {},
  registrySite = {},
} = {}) {
  const siteSegment = cleanSegment(siteKey ?? siteId, 'site');
  const sourceCapabilities = capabilities.length ? capabilities : [{ capabilityKey: 'readonly-public' }];
  const requirements = sourceCapabilities.map((capability) => ({
    schemaVersion: SITE_CAPABILITY_COMPILER_SCHEMA_VERSION,
    id: `requirement:${siteSegment}:${cleanSegment(capability.capabilityKey ?? capability.normalizedIntent, 'readonly-public')}`,
    type: 'RequirementInventory',
    auth: requiresAuth(capability, capabilityConfig, registrySite) ? 'required' : 'optional',
    session: requiresSession(capability, capabilityConfig, registrySite)
      ? 'minimal-session-view-only'
      : 'not_required',
    signer: requiresSigner(capability) ? 'required' : 'not_required',
    approval: requiresApproval(capability) ? 'required_for_non_readonly' : 'not_required',
    riskPolicyRef: riskPolicyRef(siteSegment, capability),
    redactionRequired: true,
  }));
  assertNoCompilerSensitiveMaterial(requirements);
  return requirements;
}
