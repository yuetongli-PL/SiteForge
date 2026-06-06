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

function executionContractRef(siteSegment, capability = {}) {
  return `execution-contract:${siteSegment}:${cleanSegment(capability.capabilityKey ?? capability.normalizedIntent, 'capability')}`;
}

function runtimeBindingRef(siteSegment, capability = {}) {
  return `runtime-binding:${siteSegment}:${cleanSegment(capability.capabilityKey ?? capability.normalizedIntent, 'capability')}`;
}

function governancePolicyRef(siteSegment, capability = {}) {
  return `governance-policy:${siteSegment}:${cleanSegment(capability.capabilityKey ?? capability.normalizedIntent, 'capability')}`;
}

/** @param {Record<string, any>} [capability] */
function capabilityText(capability = {}) {
  return [
    capability.capabilityKey,
    capability.normalizedIntent,
    capability.capabilityFamily,
    capability.mode,
    capability.action,
    capability.object,
    capability.safetyLevel,
    capability.safety,
    ...(Array.isArray(capability.supportedTaskTypes) ? capability.supportedTaskTypes : []),
  ].filter(Boolean).join(' ');
}

function normalizeToken(value) {
  return String(value ?? '').trim().toLowerCase();
}

/** @param {Record<string, any>} [capability] */
function isDestructiveCapability(capability = {}) {
  return /\b(?:delete|remove|clear|empty|wipe|overwrite|reset|cancel[-_\s]?(?:order|subscription)?|void|destroy|purge|erase|revoke)\b|\u5220\u9664|\u6e05\u7a7a|\u8986\u76d6|\u91cd\u7f6e|\u53d6\u6d88\u8ba2\u5355|\u9500\u6bc1|\u64a4\u9500/u.test(capabilityText(capability));
}

/** @param {Record<string, any>} [capability] */
function isPaymentCapability(capability = {}) {
  return capability.safetyLevel === 'payment'
    || /\b(?:pay|payment|checkout|purchase|billing|invoice|charge|wallet|funds?)\b|\u652f\u4ed8|\u4ed8\u6b3e|\u4ed8\u8d39|\u5145\u503c/u.test(capabilityText(capability));
}

/** @param {Record<string, any>} [capability] */
function requiresHighRiskGovernance(capability = {}) {
  const riskLevel = riskLevelForCapability(capability);
  const safetyLevel = normalizeToken(capability.safetyLevel ?? capability.safety);
  return capability.highRiskAction === true
    || isDestructiveCapability(capability)
    || isPaymentCapability(capability)
    || riskLevel === 'account_security_critical'
    || ['high_risk', 'requires_confirmation', 'account_security', 'security_critical'].includes(safetyLevel)
    || /\b(?:password|2fa|mfa|security settings|credential|account security)\b|\u5bc6\u7801|\u8d26\u53f7\u5b89\u5168/u.test(capabilityText(capability));
}

function riskLevelForCapability(capability = {}) {
  const explicit = String(capability.risk_level ?? capability.riskLevel ?? '').trim();
  if (explicit) return explicit;
  const mode = capabilityMode(capability);
  if (mode === 'download') return 'download_high';
  if (mode === 'auth') return 'read_personal_medium';
  if (mode === 'write' || requiresApproval(capability)) return 'write_low';
  return requiresAuth(capability) || requiresSession(capability) ? 'read_personal_medium' : 'read_public_low';
}

function operationKindForCapability(capability = {}) {
  const mode = capabilityMode(capability);
  if (mode === 'download') return 'download';
  if (mode === 'write' || requiresApproval(capability)) return 'form_or_action';
  return 'navigate';
}

function executionDispositionForCapability(capability = {}) {
  const explicit = String(capability.executionDisposition ?? '').trim();
  if (['allow', 'controlled', 'confirm_required', 'blocked'].includes(explicit)) {
    return explicit;
  }
  if (isDestructiveCapability(capability) || isPaymentCapability(capability)) {
    return 'blocked';
  }
  const mode = capabilityMode(capability);
  if (
    capability.enablementStatus === 'disabled'
    || capability.enabled_status === 'disabled'
    || capability.riskState === 'blocked'
  ) {
    return 'blocked';
  }
  if (
    mode === 'auth'
    || requiresHighRiskGovernance(capability)
  ) {
    return 'controlled';
  }
  const riskLevel = riskLevelForCapability(capability);
  return ['read_personal_medium', 'read_private_high', 'account_security_critical'].includes(riskLevel) ? 'controlled' : 'allow';
}

function executionVerdictForDisposition(disposition = 'blocked') {
  return disposition === 'confirm_required'
    ? 'controlled'
    : ['allow', 'controlled', 'blocked'].includes(disposition)
      ? disposition
      : 'blocked';
}

function executionGatesForCapability(capability = {}, {
  destructive = false,
  payment = false,
  sessionRequired = false,
  operationKind = operationKindForCapability(capability),
  disposition = executionDispositionForCapability(capability),
} = {}) {
  const riskLevel = riskLevelForCapability(capability);
  const highRisk = destructive === true || payment === true || requiresHighRiskGovernance(capability);
  if (disposition === 'allow') return [];
  return [
    highRisk ? 'confirm_required' : null,
    highRisk ? 'audit_required' : null,
    sessionRequired === true ? 'session_required' : null,
    highRisk ? 'permission_required' : null,
  ].filter(Boolean);
}

function impactScopeForCapability(siteSegment, capability = {}) {
  const destructive = isDestructiveCapability(capability);
  const payment = isPaymentCapability(capability);
  const highRisk = requiresHighRiskGovernance(capability);
  const text = capabilityText(capability);
  const scopeKinds = [];
  if (payment) scopeKinds.push('payment_or_funds');
  if (/\b(?:account|profile|password|security|user)\b|\u8d26\u53f7|\u8d26\u6237/u.test(text)) scopeKinds.push('account_or_profile');
  if (/\b(?:order|subscription|booking|cart|invoice)\b|\u8ba2\u5355|\u8ba2\u9605/u.test(text)) scopeKinds.push('order_or_subscription');
  if (/\b(?:file|asset|media|document|download|upload)\b|\u6587\u4ef6|\u8d44\u4ea7|\u4e0b\u8f7d|\u4e0a\u4f20/u.test(text)) scopeKinds.push('file_or_asset');
  if (/\b(?:data|record|post|comment|message|entry|item)\b|\u6570\u636e|\u8bb0\u5f55|\u6d88\u606f/u.test(text)) scopeKinds.push('record_or_data');
  return {
    material: 'descriptor_only',
    level: destructive ? 'destructive' : payment ? 'funds_or_payment' : 'standard',
    destructive,
    highRisk,
    paymentOrFunds: payment,
    scopeKinds: scopeKinds.length ? [...new Set(scopeKinds)] : [destructive ? 'site_state' : 'requested_resource'],
    affectedResourceRefs: [`capability:${siteSegment}:${cleanSegment(capability.capabilityKey ?? capability.normalizedIntent, 'capability')}`],
    reversibility: destructive || payment ? 'irreversible_or_site_defined' : 'site_defined',
  };
}

function confirmationPolicyForCapability(capability = {}) {
  const destructive = isDestructiveCapability(capability);
  const payment = isPaymentCapability(capability);
  const highRisk = requiresHighRiskGovernance(capability);
  const strongConfirmationRequired = destructive || payment;
  return {
    material: 'descriptor_only',
    required: highRisk,
    strongConfirmationRequired,
    destructiveConfirmationRequired: destructive,
    paymentConfirmationRequired: payment,
    acceptedConfirmationRefs: highRisk ? ['execution_contract_id', 'capability_id'] : [],
    naturalLanguageRequestGrantsExecution: false,
  };
}

function auditPolicyForCapability(capability = {}) {
  const highRisk = requiresHighRiskGovernance(capability);
  return {
    material: 'redacted_descriptor_only',
    required: highRisk,
    redactionRequired: true,
    sensitiveMaterialPersisted: false,
    replayableDecision: true,
    fields: highRisk
      ? ['buildId', 'siteId', 'contractRef', 'capabilityId', 'impactScope', 'runtimeDecision', 'resultStatus']
      : ['buildId', 'siteId', 'contractRef', 'capabilityId', 'runtimeDecision'],
  };
}

function executionPrerequisitesForCapability(capability = {}, { capabilityConfig = {}, registrySite = {} } = {}) {
  const destructive = isDestructiveCapability(capability);
  const payment = isPaymentCapability(capability);
  const highRisk = requiresHighRiskGovernance(capability);
  return {
    material: 'descriptor_only',
    sitePolicyExplicitAllowRequired: destructive || payment,
    strongConfirmationRequired: destructive || payment,
    auditRequired: highRisk,
    runtimeConstraintRequired: highRisk || requiresSession(capability, capabilityConfig, registrySite),
    sessionRequired: requiresSession(capability, capabilityConfig, registrySite),
    authRequired: requiresAuth(capability, capabilityConfig, registrySite),
    requiredPolicyFlags: destructive ? ['allowDestructiveActions'] : payment ? ['allowPaymentActions'] : [],
    naturalLanguageRequestGrantsExecution: false,
  };
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
    allowedActions: blocked ? ['discover', 'model', 'plan'] : ['read', 'query', 'submit', 'write', 'download', 'plan'],
    blockedActions: blocked ? ['runtime_execute'] : [],
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
function createExecutionGraphNodes({ siteSegment, siteKey, capability, capabilityConfig, registrySite } = {}) {
  const capabilityKey = cleanSegment(capability.capabilityKey ?? capability.normalizedIntent, 'capability');
  const capabilityId = `capability:${siteSegment}:${capabilityKey}`;
  const destructive = isDestructiveCapability(capability);
  const payment = isPaymentCapability(capability);
  const riskLevel = riskLevelForCapability(capability);
  const highRisk = requiresHighRiskGovernance(capability);
  const disposition = executionDispositionForCapability(capability);
  const sessionRequired = requiresSession(capability, capabilityConfig, registrySite);
  const authRequired = requiresAuth(capability, capabilityConfig, registrySite);
  const executionVerdict = executionVerdictForDisposition(disposition);
  const operationKind = operationKindForCapability(capability);
  const executionGates = executionGatesForCapability(capability, {
    destructive,
    payment,
    sessionRequired,
    operationKind,
    disposition,
  });
  const runtimeBindingId = runtimeBindingRef(siteSegment, capability);
  const governancePolicyId = governancePolicyRef(siteSegment, capability);
  const impactScope = impactScopeForCapability(siteSegment, capability);
  const confirmationPolicy = confirmationPolicyForCapability(capability);
  const auditPolicy = auditPolicyForCapability(capability);
  const executionPrerequisites = executionPrerequisitesForCapability(capability, {
    capabilityConfig,
    registrySite,
  });
  const sessionRefs = sessionRequired
    ? [sessionRequirementRef(siteSegment, capability)]
    : [];
  const authRefs = authRequired
    ? [authRequirementRef(siteSegment, capability)]
    : [];
  return [
    {
      schemaVersion: SITE_CAPABILITY_COMPILER_SCHEMA_VERSION,
      id: runtimeBindingId,
      type: 'RuntimeBindingNode',
      siteKey: siteKey ?? siteSegment,
      bindingKind: capabilityMode(capability) === 'download' ? 'downloader' : 'site_adapter_or_public_http',
      allowedMaterial: ['schema', 'template', 'slot', 'redacted-descriptor'],
      forbiddenMaterial: [
        'cookie-value',
        'auth-header-value',
        'complete-header-map',
        'request-response-body',
        'browser-profile-material',
        'session-secret-material',
      ],
      downloaderTaskDescriptor: capabilityMode(capability) === 'download'
        ? {
          material: 'descriptor_only',
          networkResolveAllowedAtRuntime: disposition !== 'blocked',
          savedMaterial: 'sanitized_summary_only',
        }
        : null,
      redactionRequired: true,
      credentialMaterialPolicy: 'no_raw_material',
      sourceRefs: sourceRefsFor(capability),
    },
    {
      schemaVersion: SITE_CAPABILITY_COMPILER_SCHEMA_VERSION,
      id: governancePolicyId,
      type: 'GovernancePolicyNode',
      executionDisposition: disposition,
      executionVerdict,
      executionGates,
      auditRequired: auditPolicy.required,
      confirmationRequired: confirmationPolicy.required,
      destructiveConfirmationRequired: destructive,
      paymentConfirmationRequired: payment,
      strongConfirmationRequired: confirmationPolicy.strongConfirmationRequired,
      sitePolicyExplicitAllowRequired: destructive || payment,
      runtimeConstraintRequired: executionPrerequisites.runtimeConstraintRequired,
      naturalLanguageRequestGrantsExecution: false,
      runtimeDispatchAllowedByDefault: highRisk ? false : executionVerdict === 'allow',
      impactScope,
      executionPrerequisites,
      confirmationPolicy,
      auditPolicy,
      reasonCodeRefs: highRisk
        ? [destructive
          ? 'execution.destructive_default_blocked'
          : payment
            ? 'execution.payment_default_blocked'
            : 'execution.controlled_runtime_required']
        : [],
      sourceRefs: sourceRefsFor(capability),
    },
    {
      schemaVersion: SITE_CAPABILITY_COMPILER_SCHEMA_VERSION,
      id: executionContractRef(siteSegment, capability),
      type: 'ExecutionContractNode',
      siteKey: siteKey ?? siteSegment,
      capabilityRef: capabilityId,
      operationKind,
      requestSchemaRef: `schema:${siteSegment}:${capabilityKey}:request`,
      responseSchemaRef: `schema:${siteSegment}:${capabilityKey}:response`,
      runtimeBindingRef: runtimeBindingId,
      sessionRequirementRef: sessionRefs[0] ?? null,
      authRequirementRef: authRefs[0] ?? null,
      riskPolicyRef: riskPolicyRef(siteSegment, capability),
      governancePolicyRef: governancePolicyId,
      executionDisposition: disposition,
      executionVerdict,
      executionGates,
      destructiveAction: destructive,
      highRiskAction: highRisk,
      paymentOrFundsAction: payment,
      planCallable: true,
      runtimeCallable: executionVerdict !== 'blocked',
      autoExecutable: executionVerdict === 'allow',
      redactionRequired: true,
      impactScope,
      executionPrerequisites,
      confirmationPolicy,
      auditPolicy,
      payloadTemplate: {
        material: 'template_only',
        slotBindings: [],
        savedMaterial: 'sanitized_summary_only',
      },
      sourceRefs: sourceRefsFor(capability),
      testEvidenceRefs: ['test:site-capability-compiler-executor'],
    },
  ];
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
    nodes.push(...createExecutionGraphNodes({
      siteSegment,
      siteKey,
      capability,
      capabilityConfig,
      registrySite,
    }));
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
    const executionDisposition = executionDispositionForCapability(capability);
    const executionVerdict = executionVerdictForDisposition(executionDisposition);
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
      executable: capability.executable !== false,
      enablementStatus: capability.enablementStatus ?? (executionDisposition === 'blocked' ? 'disabled' : 'enabled'),
      executionDisposition,
      runtimeCallable: executionVerdict !== 'blocked',
      autoExecutable: executionVerdict === 'allow',
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
