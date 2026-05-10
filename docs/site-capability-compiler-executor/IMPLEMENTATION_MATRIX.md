# Site Capability Compiler And Execution System Implementation Matrix

Last updated: 2026-05-10

Allowed statuses: `not_started`, `partial`, `implemented`, `verified`,
`blocked`.

Current final validation summary:

- `verified`: 20
- `implemented`: 0
- `partial`: 0
- `not_started`: 0
- `blocked`: 0

Status policy: a section is `verified` only when code evidence, test evidence,
validation command, validation result, and TestVerificationQualityGateAgent
acceptance exist without violating Compiler / Graph / Planner / Layer /
SiteAdapter / downloader / Session / Redaction boundaries. This matrix is
covered by `tests/node/site-capability-compiler-executor/matrix.test.mjs` and
the final surface is covered by
`tests/node/site-capability-compiler-executor/final-validation.test.mjs`.

Optimization closeout evidence: 2026-05-10 expanded the verified scope with
config-backed compile loading, source digest and incremental compile summaries,
richer requirement/risk mapping, redacted compiler provenance in generated
Graphs, a descriptor-only `site-capability-compile` CLI, an
`ExecutionPolicyDecision` preflight gate, and a redacted `CoverageDelta`
artifact queue. Additional closeout validation added repo-local config path
guards, manifest digest governance, an opt-in `site doctor
--capability-compile-dry-run` check, generated Skill compiler status guidance,
and download release audit compile coverage summaries. Focused
compiler-executor validation passed 42/42; focused upper-consumer validation
passed 67/67.

Capability intake evidence: 2026-05-10 added a pre-compile capability intake
contract and descriptor-only CLI flow so site onboarding can ask for requested
capabilities first, prioritize matching static descriptors, and still record
unconfirmed capabilities under `best_effort_full_coverage` without promoting
unknown capabilities to verified executable coverage. Missing requested
capabilities are now exposed as `missingRequestedCapabilities` gap evidence and
block unrelated Planner/Layer handoff readiness instead of silently planning the
first available capability. Focused compiler capability-gap validation passed
23/23 after this update.

## 1. Core Positioning

- Section name: Core Positioning
- Requirement summary: Compiler generates governed Graph inputs; Execution runs
  plans only through Site Capability Layer.
- Current status: `verified`
- Existing code evidence: `src/sites/capability/compiler/static-compiler.mjs`
  creates descriptor-only compile manifests; `config-loader.mjs` loads
  repo-local registry/capability descriptors; `graph-builder.mjs` builds Graph
  descriptors without execution; `src/entrypoints/sites/site-capability-compile.mjs`
  exposes a descriptor-only compile dry-run; `src/sites/capability/execution/layer-handoff.mjs`
  creates Layer-targeted execution descriptors with runtime flags disabled.
- Existing test evidence: `static-compiler.test.mjs`,
  `graph-builder.test.mjs`, `planner-integration.test.mjs`, and
  `execution-handoff.test.mjs`.
- Verification command: `node --test tests\node\site-capability-compiler-executor\*.test.mjs`.
- Verification result: Focused compiler-executor suite passed 42/42.
- Current gaps: None known for the descriptor-only compiler/executor goal.
- Next smallest task: Maintain focused regression coverage when expanding live
  Layer-owned execution.
- Risk notes: Live execution must remain Layer-owned.
- Last updated: 2026-05-10
- Responsible subagent: RepoMatrixAuditor
- TestVerificationQualityGateAgent conclusion: Accepted.

## 2. Non-goals

- Section name: Non-goals
- Requirement summary: No access-control bypass, raw credential persistence,
  direct downloader execution, or replacement of Graph, Planner, Layer, or
  SiteAdapter.
- Current status: `verified`
- Existing code evidence: `compiler/validator.mjs` rejects raw sensitive and
  runtime fields; `execution/validator.mjs` rejects downloader, SiteAdapter,
  SessionView, browser, handler, and sensitive fields.
- Existing test evidence: `schema-validator.test.mjs` and
  `execution-handoff.test.mjs` reject cookies, tokens, headers, profile paths,
  storage state, downloader tasks, SessionView-shaped objects, and handlers
  without echoing synthetic secrets.
- Verification command: `node --test tests\node\site-capability-compiler-executor\schema-validator.test.mjs tests\node\site-capability-compiler-executor\execution-handoff.test.mjs`.
- Verification result: Focused non-goal validation passed 11/11.
- Current gaps: None known for descriptor-only contracts.
- Next smallest task: Add import-boundary regression if execution modules grow.
- Risk notes: Any direct runtime import is a boundary regression.
- Last updated: 2026-05-09
- Responsible subagent: ExecutionPolicySecurityAgent
- TestVerificationQualityGateAgent conclusion: Accepted.

## 3. Relationship With Site Capability Layer / Graph / Planner

- Section name: Relationship With Site Capability Layer / Graph / Planner
- Requirement summary: Compiler feeds Graph; Graph remains declarative; Planner
  consumes only validated Graph; Execution goes through Layer.
- Current status: `verified`
- Existing code evidence: `graph-builder.mjs` emits a Graph descriptor and
  validation report; `planner-integration.test.mjs` drives existing Planner
  dry-run through `createDryRunCapabilityPlan()` using validated compiler-built
  Graph; `execution/layer-handoff.mjs` targets `site-capability-layer`.
- Existing test evidence: `graph-builder.test.mjs`,
  `planner-integration.test.mjs`, and `final-validation.test.mjs`.
- Verification command: `node --test tests\node\site-capability-compiler-executor\graph-builder.test.mjs tests\node\site-capability-compiler-executor\planner-integration.test.mjs tests\node\site-capability-compiler-executor\final-validation.test.mjs`.
- Verification result: Graph/Planner/Layer relationship validation passed 8/8.
- Current gaps: None known for descriptor-only integration.
- Next smallest task: Add Layer runtime consumer only in a separate governed
  batch.
- Risk notes: Planner must never consume unvalidated compiler drafts.
- Last updated: 2026-05-09
- Responsible subagent: GraphEmissionPlannerIntegrationAgent
- TestVerificationQualityGateAgent conclusion: Accepted.

## 4. Compiler And Execution Layered Structure

- Section name: Compiler And Execution Layered Structure
- Requirement summary: Separate schemas, validators, static compiler, inventory,
  graph builder, execution handoff, artifact guard, reasonCode, observability,
  and tests.
- Current status: `verified`
- Existing code evidence: `src/sites/capability/compiler/` contains schema,
  validator, coverage report, inventory, static compiler, graph builder,
  redaction guard, reason codes, observability, and index modules.
  `src/sites/capability/execution/` contains schema, validator, Layer handoff,
  artifact guard, and index modules.
- Existing test evidence: `final-validation.test.mjs` verifies the final module
  surfaces exist and avoid runtime imports.
- Verification command: `node --test tests\node\site-capability-compiler-executor\final-validation.test.mjs`.
- Verification result: Final surface validation passed 3/3.
- Current gaps: None known for current scope.
- Next smallest task: Keep live execution code outside this descriptor layer
  until Layer-owned runtime gates exist.
- Risk notes: Do not add placeholder-only modules without tests.
- Last updated: 2026-05-09
- Responsible subagent: CompilerContractSchemaAgent
- TestVerificationQualityGateAgent conclusion: Accepted.

## 5. Compile Scope / Coverage Semantics

- Section name: Compile Scope / Coverage Semantics
- Requirement summary: Compile scope defines coverage mode, completeness,
  allowed capture modes, source types, exclusions, and redaction.
- Current status: `verified`
- Existing code evidence: `compiler/schema.mjs` defines coverage and capture
  enums plus `CapabilityIntake` / `CapabilityCoverageSummary` contracts;
  `compiler/validator.mjs` validates `SiteCompileScope` and capability-intake
  safety; `capability-intake.mjs` normalizes requested, missing, and
  unconfirmed capabilities; `coverage-report.mjs` records capability coverage
  summaries and checks complete coverage requires evidence; `digest.mjs`
  records source digests and incremental compile summaries.
- Existing test evidence: `schema-validator.test.mjs`,
  `static-compiler.test.mjs`, `compile-entrypoint.test.mjs`, and
  `config-loader.test.mjs`.
- Verification command: `node --test tests\node\site-capability-compiler-executor\schema-validator.test.mjs tests\node\site-capability-compiler-executor\static-compiler.test.mjs`.
- Verification result: Compile scope, capability intake, digest, config path guard, and coverage validation passed in the focused suite; 2026-05-10 capability-gap focused validation passed `schema-validator.test.mjs` 10/10, `static-compiler.test.mjs` 4/4, and `compile-entrypoint.test.mjs` 9/9.
- Current gaps: None known for static descriptor coverage.
- Next smallest task: Extend coverage modes when governed capture normalization
  is implemented.
- Risk notes: No complete coverage claim without evidence.
- Last updated: 2026-05-10T14:30:04+08:00
- Responsible subagent: CompilerContractSchemaAgent
- TestVerificationQualityGateAgent conclusion: Accepted.

## 6. Node Capture / NodeInventory

- Section name: Node Capture / NodeInventory
- Requirement summary: Capture compile-scope nodes with deterministic ids,
  evidence, confidence, freshness, validation state, unknown reporting, and
  redaction.
- Current status: `verified`
- Existing code evidence: `compiler/inventory.mjs` implements
  `createNodeInventory()` for static SiteNode, RouteNode, RiskPolicyNode,
  AuthRequirementNode, SessionRequirementNode, SchemaNode, ArtifactContractNode,
  TestEvidenceNode, VersionNode, FailureModeNode, and ObservabilityNode
  descriptors.
- Existing test evidence: `static-compiler.test.mjs` asserts node inventory
  contains SiteNode, RouteNode, and RiskPolicyNode from synthetic static input;
  `config-loader.test.mjs` verifies config-backed blocked risk descriptors.
- Verification command: `node --test tests\node\site-capability-compiler-executor\static-compiler.test.mjs`.
- Verification result: Static and config-backed compiler inventory validation passed in the 42/42 focused suite.
- Current gaps: None known for static node inventory.
- Next smallest task: Add DOM/page-fact node normalization in a separate
  governed-capture batch.
- Risk notes: Node ids must not derive from sensitive runtime data.
- Last updated: 2026-05-09
- Responsible subagent: SiteCapturePathDiscoveryAgent
- TestVerificationQualityGateAgent conclusion: Accepted.

## 7. Capability Capture / CapabilityInventory

- Section name: Capability Capture / CapabilityInventory
- Requirement summary: Capture capabilities, intents, exposure, route refs,
  requirements, risk, schema, artifact, and test evidence.
- Current status: `verified`
- Existing code evidence: `compiler/inventory.mjs` implements
  `createCapabilityInventory()` from static and config-backed capability
  config, including mode, auth/session/signer flags, approval requirement,
  risk policy refs, source refs, capability-intake status, targeted requested
  coverage flags, missing requested capability gap fields, unconfirmed
  best-effort policy, and redaction-required descriptors.
- Existing test evidence: `static-compiler.test.mjs` verifies one synthetic
  capability inventory item is generated and requested capabilities are
  prioritized while missing requested capabilities are recorded as unknown
  coverage; `config-loader.test.mjs` verifies derived config capabilities and
  download requirement mapping.
- Verification command: `node --test tests\node\site-capability-compiler-executor\static-compiler.test.mjs`.
- Verification result: Static, config-backed, and capability-intake inventory validation passed in the focused suite; 2026-05-10 `static-compiler.test.mjs` passed 4/4 with `missingRequestedCapabilities`, `missingRequestedCapabilityCount`, and `capabilityGapStatus` coverage.
- Current gaps: None known for static capability inventory.
- Next smallest task: Add adapter metadata summaries when needed.
- Risk notes: Observed capabilities remain non-promoted until validation gates.
- Last updated: 2026-05-10T14:30:04+08:00
- Responsible subagent: SiteCapturePathDiscoveryAgent
- TestVerificationQualityGateAgent conclusion: Accepted.

## 8. Function Execution Path Capture / ExecutionPathInventory

- Section name: Function Execution Path Capture / ExecutionPathInventory
- Requirement summary: Capture descriptor-only function paths, preconditions,
  route candidates, fallbacks, artifacts, and failure modes.
- Current status: `verified`
- Existing code evidence: `compiler/inventory.mjs` implements
  `createExecutionPathInventory()` as static route-descriptor steps with no
  handlers, task runners, downloader payloads, or SessionView material.
- Existing test evidence: `static-compiler.test.mjs` verifies execution path
  inventory is generated and `schema-validator.test.mjs` rejects runtime fields.
- Verification command: `node --test tests\node\site-capability-compiler-executor\static-compiler.test.mjs tests\node\site-capability-compiler-executor\schema-validator.test.mjs`.
- Verification result: Execution path descriptor validation passed 10/10.
- Current gaps: None known for static path descriptors.
- Next smallest task: Add dry-run traces after Layer-owned execution descriptors
  are expanded.
- Risk notes: No function execution or downloader calls.
- Last updated: 2026-05-09
- Responsible subagent: SiteCapturePathDiscoveryAgent
- TestVerificationQualityGateAgent conclusion: Accepted.

## 9. Endpoint / API / Route Capture

- Section name: Endpoint / API / Route Capture
- Requirement summary: Capture route and endpoint descriptors with requirement,
  schema, risk, catalog status, evidence, and redaction fields.
- Current status: `verified`
- Existing code evidence: `compiler/inventory.mjs` emits declared RouteNode
  descriptors from synthetic static capability config; `graph-builder.mjs`
  converts them to Graph RouteNodes.
- Existing test evidence: `graph-builder.test.mjs` verifies route nodes and
  route edges validate through `validateSiteCapabilityGraph()`.
- Verification command: `node --test tests\node\site-capability-compiler-executor\graph-builder.test.mjs`.
- Verification result: Graph route capture validation passed 3/3.
- Current gaps: None known for static route family descriptors.
- Next smallest task: Add observed API candidate summaries without catalog
  promotion.
- Risk notes: Observed API candidates must remain separate from verified
  catalog endpoints.
- Last updated: 2026-05-09
- Responsible subagent: GraphEmissionPlannerIntegrationAgent
- TestVerificationQualityGateAgent conclusion: Accepted.

## 10. Requirement Capture: Auth / Session / Signer / Risk / Approval

- Section name: Requirement Capture: Auth / Session / Signer / Risk / Approval
- Requirement summary: Normalize requirements without raw credential, session,
  header, profile, identity, or network material.
- Current status: `verified`
- Existing code evidence: `compiler/inventory.mjs` implements
  `createRequirementInventory()` as requirement descriptors and creates
  AuthRequirementNode, SessionRequirementNode, and RiskPolicyNode metadata
  without raw auth/session material.
- Existing test evidence: `schema-validator.test.mjs` rejects cookies, tokens,
  Authorization, refresh token, session id, browser profile, account, device,
  IP, SessionView, StandardTaskList, downloader task, handler, and browser
  context fields; `config-loader.test.mjs` verifies sanitized config-backed
  auth/session/risk summaries.
- Verification command: `node --test tests\node\site-capability-compiler-executor\schema-validator.test.mjs`.
- Verification result: Requirement and sensitive-field validation passed in the 42/42 focused suite.
- Current gaps: None known for descriptor requirements.
- Next smallest task: Add richer signer/session requirement descriptors with
  synthetic fixtures.
- Risk notes: Requirement records describe needs, not secrets.
- Last updated: 2026-05-09
- Responsible subagent: ExecutionPolicySecurityAgent
- TestVerificationQualityGateAgent conclusion: Accepted.

## 11. Graph Generation: Compile Manifest To Site Capability Graph

- Section name: Graph Generation: Compile Manifest To Site Capability Graph
- Requirement summary: Build `CapabilityGraphDraft` and `GraphBuildManifest`
  from validated compile manifests.
- Current status: `verified`
- Existing code evidence: `compiler/graph-builder.mjs` implements
  `createCapabilityGraphDraftFromCompileManifest()` and
  `buildSiteCapabilityGraphFromCompileManifest()`, preserving redacted compiler
  provenance, source digest, incremental compile summary, and auth/session
  requirement edges.
- Existing test evidence: `graph-builder.test.mjs` verifies Graph nodes, edges,
  compiler provenance, and build manifest output.
- Verification command: `node --test tests\node\site-capability-compiler-executor\graph-builder.test.mjs`.
- Verification result: Graph builder validation passed in the 42/42 focused suite.
- Current gaps: None known for minimal graph generation.
- Next smallest task: Add endpoint node generation once endpoint inventories
  are expanded.
- Risk notes: Graph Builder remains non-executing.
- Last updated: 2026-05-09
- Responsible subagent: GraphEmissionPlannerIntegrationAgent
- TestVerificationQualityGateAgent conclusion: Accepted.

## 12. Graph Validation / Version Compatibility

- Section name: Graph Validation / Version Compatibility
- Requirement summary: Validate graph schema, edges, missing nodes/routes,
  versions, requirements, redaction, and compatibility before Planner
  consumption.
- Current status: `verified`
- Existing code evidence: `compiler/graph-builder.mjs` calls existing
  `validateSiteCapabilityGraph()` and records `graphBuildManifest`
  compiler/graph version metadata, source digest, and incremental compile
  metadata.
- Existing test evidence: `graph-builder.test.mjs` validates a passed compiler
  graph and a broken route edge failure.
- Verification command: `node --test tests\node\site-capability-compiler-executor\graph-builder.test.mjs`.
- Verification result: Graph validation bridge passed in the 42/42 focused suite.
- Current gaps: None known for minimal validation bridge.
- Next smallest task: Add version mismatch negative tests if graph versioning
  expands.
- Risk notes: Planner must reject drafts without passed validation report.
- Last updated: 2026-05-09
- Responsible subagent: GraphEmissionPlannerIntegrationAgent
- TestVerificationQualityGateAgent conclusion: Accepted.

## 13. Planner Consumption / CapabilityPlan Handoff

- Section name: Planner Consumption / CapabilityPlan Handoff
- Requirement summary: Planner consumes only validated compiler-generated Graph
  and records graph provenance in plans.
- Current status: `verified`
- Existing code evidence: `planner-integration.test.mjs` composes
  `buildSiteCapabilityGraphFromCompileManifest()` with existing Planner
  `createDryRunCapabilityPlan()`; `site-capability-compile.mjs` runs the same
  validated-Graph-only dry-run path from a repo-local CLI.
- Existing test evidence: `planner-integration.test.mjs` proves Planner
  generates a ready dry-run plan from a passed validation report and rejects
  missing or failed validation reports; `compile-entrypoint.test.mjs` verifies
  the CLI dry-run summary.
- Verification command: `node --test tests\node\site-capability-compiler-executor\planner-integration.test.mjs`.
- Verification result: Planner integration and CLI dry-run validation passed in the 42/42 focused suite.
- Current gaps: None known for dry-run Planner consumption.
- Next smallest task: Add Layer handoff descriptor consumption in a separate
  runtime-governed batch.
- Risk notes: Planner does not discover sites or execute tasks.
- Last updated: 2026-05-09
- Responsible subagent: GraphEmissionPlannerIntegrationAgent
- TestVerificationQualityGateAgent conclusion: Accepted.

## 14. Execution System: Layer-governed Execution

- Section name: Execution System: Layer-governed Execution
- Requirement summary: Execute `CapabilityPlan` only through Layer-governed
  entrypoints and emit governed execution products.
- Current status: `verified`
- Existing code evidence: `src/sites/capability/execution/schema.mjs`,
  `validator.mjs`, `layer-handoff.mjs`, `policy-gate.mjs`,
  `coverage-delta-queue.mjs`, `artifact-guard.mjs`, and `index.mjs`
  define descriptor-only `ExecutionManifest`, `ExecutionPolicyDecision`, Layer
  handoff, feedback, coverage delta, and redacted queue contracts.
- Existing test evidence: `execution-handoff.test.mjs` accepts descriptor-only
  handoff/feedback/delta and rejects downloader, SessionView, and sensitive
  payloads; `execution-policy.test.mjs` verifies policy preflight and
  CoverageDelta queue behavior.
- Verification command: `node --test tests\node\site-capability-compiler-executor\execution-handoff.test.mjs`.
- Verification result: Execution handoff, policy, and coverage queue validation passed in the 42/42 focused suite.
- Current gaps: None known for descriptor-only execution contracts.
- Next smallest task: Wire a Layer-owned consumer only after runtime gates.
- Risk notes: No direct downloader or SiteAdapter invocation.
- Last updated: 2026-05-09
- Responsible subagent: ExecutionPolicySecurityAgent
- TestVerificationQualityGateAgent conclusion: Accepted.

## 15. Artifact Governance: Compiler / Graph / Planner / Execution Artifacts

- Section name: Artifact Governance
- Requirement summary: All derived artifacts require `redactionRequired=true`
  and SecurityGuard / Redaction before writes.
- Current status: `verified`
- Existing code evidence: `compiler/redaction-guard.mjs` implements
  `prepareCompilerDerivedArtifact()`; `execution/artifact-guard.mjs` implements
  `prepareExecutionArtifactJsonWithAudit()`; `site-capability-compile.mjs`
  writes optional compiler artifacts only after redaction; `coverage-delta-queue.mjs`
  prepares coverage queue artifacts through the execution artifact guard.
  `compiler/validator.mjs` and `execution/validator.mjs` now fail closed on
  unsafe source/evidence/artifact refs before derived artifact writes.
- Existing test evidence: `artifact-guard.test.mjs`, `compile-entrypoint.test.mjs`,
  `execution-policy.test.mjs`, and `execution-handoff.test.mjs` verify
  redaction-required artifacts, reject unredacted sensitive material, and reject
  raw URL/path/account/IP/query/executable-looking evidence refs.
- Verification command: `node --test tests\node\site-capability-compiler-executor\artifact-guard.test.mjs tests\node\site-capability-compiler-executor\execution-handoff.test.mjs`.
- Verification result: 2026-05-10 focused artifact/ref guard validation passed
  21/21; full compiler-executor suite passed 53/53 with unsafe compiler
  source/evidence refs and execution artifact/evidence refs rejected.
- Current gaps: None known for descriptor artifact guards.
- Next smallest task: Add real writer tests only when a writer is introduced.
- Risk notes: No derived artifact write path without guard.
- Last updated: 2026-05-10T13:27:11+08:00
- Responsible subagent: ExecutionPolicySecurityAgent
- TestVerificationQualityGateAgent conclusion: Accepted.

## 16. Trust Boundary / SecurityGuard / Redaction

- Section name: Trust Boundary / SecurityGuard / Redaction
- Requirement summary: Fail closed on raw sensitive data and route derived
  artifact writes through SecurityGuard / Redaction.
- Current status: `verified`
- Existing code evidence: `compiler/validator.mjs`, `compiler/redaction-guard.mjs`,
  `config-loader.mjs`, `site-capability-compile.mjs`, `execution/validator.mjs`,
  `execution/policy-gate.mjs`, `execution/coverage-delta-queue.mjs`, and
  `execution/artifact-guard.mjs` use existing SecurityGuard scanners and
  redaction helpers. Compiler and execution validators now also enforce an
  allowlist for source/evidence/artifact refs so raw URLs, local paths, query
  fragments, account-like refs, IP refs, and executable-looking refs cannot be
  persisted through compiler/executor artifacts.
- Existing test evidence: `schema-validator.test.mjs`, `artifact-guard.test.mjs`,
  `execution-handoff.test.mjs`, `execution-policy.test.mjs`, and
  `observability.test.mjs`.
- Verification command: `node --test tests\node\site-capability-compiler-executor\schema-validator.test.mjs tests\node\site-capability-compiler-executor\artifact-guard.test.mjs tests\node\site-capability-compiler-executor\execution-handoff.test.mjs tests\node\site-capability-compiler-executor\observability.test.mjs`; `node tools\prepublish-secret-scan.mjs`.
- Verification result: 2026-05-10 unsafe ref allowlist validation passed in
  the 21/21 focused suite; full compiler-executor suite passed 53/53 and
  prepublish secret scan passed across 656 candidate files.
- Current gaps: None known.
- Next smallest task: Keep synthetic/redacted fixtures only.
- Risk notes: Errors must not echo sensitive values.
- Last updated: 2026-05-10T13:27:11+08:00
- Responsible subagent: ExecutionPolicySecurityAgent
- TestVerificationQualityGateAgent conclusion: Accepted.

## 17. Failure Modes / reasonCode

- Section name: Failure Modes / reasonCode
- Requirement summary: Define compiler, graph, planner, and execution
  reasonCodes with retry, cooldown, manual, degrade, artifact, Planner, and
  Layer semantics.
- Current status: `verified`
- Existing code evidence: `compiler/reason-codes.mjs` defines compiler and
  execution reasonCode semantics and fail-closed lookup, including
  `compiler.capability_intake_invalid` for unsafe requested capability input.
- Existing test evidence: `reason-codes.test.mjs` verifies required codes and
  gate semantics.
- Verification command: `node --test tests\node\site-capability-compiler-executor\reason-codes.test.mjs`.
- Verification result: ReasonCode validation passed 2/2.
- Current gaps: None known for current taxonomy.
- Next smallest task: Fold into central reason catalog if the project chooses a
  single registry.
- Risk notes: Unknown reason codes fail closed.
- Last updated: 2026-05-10
- Responsible subagent: CompilerContractSchemaAgent
- TestVerificationQualityGateAgent conclusion: Accepted.

## 18. Observability / Lifecycle Events

- Section name: Observability / Lifecycle Events
- Requirement summary: Emit real or test-backed lifecycle event descriptors for
  compile, graph build, planner handoff, execution, artifact write, and
  redaction events.
- Current status: `verified`
- Existing code evidence: `compiler/observability.mjs` implements
  `createCompilerLifecycleEvent()` and validates required fields, validation
  result, and redaction event metadata; `site-doctor.mjs` can attach an opt-in
  descriptor-only compile dry-run check; `download-release-audit-core.mjs`
  attaches per-site compile coverage summaries to release audit rows.
- Existing test evidence: `observability.test.mjs` accepts a compiler lifecycle
  event and rejects sensitive values; `site-onboarding.test.mjs` verifies the
  Doctor dry-run check and `download-release-audit.test.mjs` verifies compile
  coverage release-audit rows.
- Verification command: `node --test tests\node\site-capability-compiler-executor\observability.test.mjs`.
- Verification result: Observability validation passed 2/2; focused
  upper-consumer validation passed 67/67.
- Current gaps: None known for descriptor events.
- Next smallest task: Add runtime lifecycle dispatch only through Layer-owned
  paths.
- Risk notes: No fake external telemetry.
- Last updated: 2026-05-09
- Responsible subagent: TestVerificationQualityGateAgent
- TestVerificationQualityGateAgent conclusion: Accepted.

## 19. Testing Strategy

- Section name: Testing Strategy
- Requirement summary: Focused tests cover schemas, validators, static compiler,
  inventories, graph builder, Planner consumption, execution handoff,
  redaction, reasonCodes, compatibility, observability, and matrix.
- Current status: `verified`
- Existing code evidence: Testable compiler/executor modules exist under
  `src/sites/capability/compiler/`, `src/sites/capability/execution/`, and
  `src/entrypoints/sites/site-capability-compile.mjs`.
- Existing test evidence: `schema-validator.test.mjs`,
  `static-compiler.test.mjs`, `graph-builder.test.mjs`,
  `planner-integration.test.mjs`, `execution-handoff.test.mjs`,
  `artifact-guard.test.mjs`, `config-loader.test.mjs`,
  `compile-entrypoint.test.mjs`, `execution-policy.test.mjs`,
  `reason-codes.test.mjs`,
  `observability.test.mjs`, `matrix.test.mjs`, and
  `final-validation.test.mjs`; upper-consumer tests cover Doctor dry-run,
  generated Skill compiler guidance, release-audit compile coverage, and CLI
  flag parsing. Capability-intake regression tests cover requested capability
  schema validation, unsafe capability rejection, static targeted coverage,
  CLI `--capability`, descriptor-only `--ask-capabilities`, and blocked
  handoff behavior for missing requested capabilities.
- Verification command: `node --test tests\node\site-capability-compiler-executor\*.test.mjs`.
- Verification result: Focused compiler-executor suite passed 53/53; focused
  upper-consumer validation passed 67/67. 2026-05-10 capability-gap focused
  validation passed 23/23 for schema, static compiler, and compile entrypoint
  coverage.
- Current gaps: None known for current goal.
- Next smallest task: Add regression tests with every future behavior change.
- Risk notes: Do not report unrun tests as passed.
- Last updated: 2026-05-10T14:30:04+08:00
- Responsible subagent: TestVerificationQualityGateAgent
- TestVerificationQualityGateAgent conclusion: Accepted.

## 20. Standard Products And Final Goal

- Section name: Standard Products And Final Goal
- Requirement summary: All docs, schemas, validators, compiler, graph builder,
  Planner integration, execution handoff, artifact governance, tests, and
  matrix evidence exist and sections 1-20 are verified.
- Current status: `verified`
- Existing code evidence: Final products exist in
  `docs/site-capability-compiler-executor/`,
  `src/sites/capability/compiler/`, `src/sites/capability/execution/`, and
  `src/entrypoints/sites/site-capability-compile.mjs`; opt-in consumers now
  include `site-doctor.mjs`, generated Skill status rendering, and
  `download-release-audit-core.mjs`. `capability-intake.mjs` and the
  compile entrypoint provide the pre-compile ask/prioritize/best-effort
  coverage contract for new site onboarding, including missing requested
  capability gaps that block unrelated Planner/Layer handoff readiness.
- Existing test evidence: `matrix.test.mjs` verifies sections 1-20 are
  `verified` with evidence; `final-validation.test.mjs` verifies final docs,
  contracts, schema listings, and runtime import boundaries.
- Verification command: `node --test tests\node\site-capability-compiler-executor\matrix.test.mjs tests\node\site-capability-compiler-executor\final-validation.test.mjs`; `node --test tests\node\site-capability-compiler-executor\*.test.mjs`; `git diff --check`; `node tools\prepublish-secret-scan.mjs`.
- Verification result: Matrix/final validation passed 5/5; focused compiler-executor suite passed 53/53; focused Doctor/Skill/audit upper-consumer validation passed 67/67; Python unittest passed 58/58; path-specific diff check passed; prepublish secret scan passed, scanning 656 candidate files; 2026-05-10 missing requested capability focused validation passed 23/23; broad `node --test tests\node\*.test.mjs` was attempted and timed out after 600 seconds before producing a final pass/fail result.
- Current gaps: None known for the current descriptor-only compiler/executor
  goal.
- Next smallest task: Integrate future live execution only through a
  Layer-owned runtime goal.
- Risk notes: Do not expand beyond descriptor-only contracts without new gates.
- Last updated: 2026-05-10
- Responsible subagent: TestVerificationQualityGateAgent
- TestVerificationQualityGateAgent conclusion: Accepted.
