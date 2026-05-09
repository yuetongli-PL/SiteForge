# Site Capability Compiler And Execution System Design

Last updated: 2026-05-10

This document initializes the Browser-Wiki-Skill Site Capability Compiler and
Execution System. It defines the compile-time path that turns governed site
facts into a validated Site Capability Graph, the Planner consumption boundary,
and the execution feedback path through the existing Site Capability Layer.

This is a design document only. Implementation status is tracked in
`IMPLEMENTATION_MATRIX.md`.

Boundary rules:

- Compiler is the upstream graph input generator, not Planner and not Layer.
- Compiler may discover nodes, capabilities, routes, requirements, endpoints,
  and function paths only inside a declared compile scope.
- Compiler does not execute downloads, bypass access controls, or visit real
  sites outside governed capture modes.
- Graph remains the declarative capability knowledge model.
- Planner consumes only validated Graph data and does not perform discovery.
- Execution System may execute only through Site Capability Layer or a
  Layer-governed entrypoint.
- SiteAdapter remains responsible for site-specific interpretation.
- downloader remains a low-permission consumer invoked only by Layer-owned
  paths.
- No component may read, persist, or output raw credentials, raw sessions,
  browser profile material, account identifiers, device fingerprints, or
  network identifiers.
- Every compiler-derived, graph-derived, planner-derived, and
  execution-derived artifact must declare `redactionRequired: true` and pass
  SecurityGuard / Redaction before any write.
- Config-backed compiler sources must resolve through repo-local relative path
  guards; absolute paths and `..` escapes are rejected before read.
- Site compile manifests must carry source and manifest digests so validators
  can reject stale, tampered, or incomplete descriptor artifacts.

Version 1 should use JSON, schemas, validators, compile manifests, graph
builder functions, and descriptor-only handoff contracts. Do not introduce a
database until the contracts and validation gates are stable.

## 1. Core Positioning

The Site Capability Compiler System is a controlled compile-time subsystem. It
collects declared and governed observed facts from repository-local sources and
redacted evidence, normalizes them into inventories, and produces
`SiteCompileManifest` records that can be transformed into a Site Capability
Graph draft.

The Site Capability Execution System is the governed post-planning execution
side. It accepts a validated `CapabilityPlan` only through a Layer-owned or
Layer-governed entrypoint and emits execution feedback, coverage deltas, and
lifecycle events.

The system answers:

- Which nodes, capabilities, routes, endpoints, requirements, risks, and
  execution paths are known inside the current compile scope.
- Which facts are declared, observed, replayed, blocked, unknown, stale, or
  validated.
- Which graph draft can be built from the compile manifest.
- Which validation gates are required before Planner may consume the Graph.
- Which execution feedback can update coverage without bypassing Layer.

## 2. Non-goals

Compiler / Graph Builder / Planner / Execution are not:

- A crawler that claims unbounded whole-site completeness.
- A CAPTCHA, MFA, anti-bot, risk-control, permission, paywall, or access-control
  bypass.
- A credential, cookie, token, session, browser profile, device fingerprint, or
  account store.
- A downloader, direct task executor, hidden browser runtime, or scheduler.
- A replacement for Site Capability Graph, Planner, Site Capability Layer,
  SiteAdapter, or downloader.
- An automatic promoter of observed API candidates into verified cataloged
  endpoints.

The system must not store dynamic browser state, raw request headers, raw
cookies, CSRF values, Authorization values, SESSDATA, access tokens, refresh
tokens, session ids, browser profile identifiers, account identifiers, IP or
network identifiers, sensitive query strings, or error logs that expose
sensitive context.

## 3. Relationship With Site Capability Layer / Graph / Planner

The ownership boundaries are fixed:

- Site Capability Compiler System generates governed inputs.
- Site Capability Graph is the declarative knowledge model generated and
  validated from those inputs.
- Site Capability Planner Layer consumes validated Graph data and generates
  `CapabilityPlan`.
- Site Capability Execution System executes only through Layer-owned paths.
- Site Capability Layer remains the execution and orchestration entrypoint.

Compiler may read registry, capability config, SiteAdapter metadata, redacted
artifacts, synthetic fixtures, and governed capture outputs. It must not execute
tasks or produce `CapabilityPlan` directly.

Graph Builder may transform compile manifests into graph drafts and validation
reports. It must not execute graph nodes or routes.

Planner may consume only validated Graph data and must not discover sites, visit
real sites, call downloader, or replace SiteAdapter.

Execution may consume a plan only after Layer-governed validation and must not
call downloader directly.

## 4. Compiler And Execution Layered Structure

Version 1 should be split into focused modules:

- Contract schemas: `SiteCompileRequest`, `SiteCompileScope`,
  `SiteCompileManifest`, inventories, graph drafts, graph build manifests,
  execution manifests, feedback, coverage deltas, and lifecycle event
  descriptors.
- Validators: structure, version compatibility, forbidden sensitive fields,
  redaction-required artifacts, and fail-closed boundary checks.
- Static compiler: reads registry, capability config, adapter metadata, and
  redacted artifacts to produce minimal manifests.
- Capture normalizer: converts governed redacted capture facts into inventory
  records without storing raw runtime data.
- Path inventory builder: records non-mutating or synthetic execution path
  traces.
- Coverage reporter: records scope, completeness, confidence, unknowns, and
  blockers.
- Graph builder: turns compile manifests into graph drafts and build manifests.
- Graph validator bridge: enforces graph schema, edge, version, and redaction
  gates before Planner consumption.
- Planner integration: ensures Planner consumes only validated
  compiler-generated Graph descriptors.
- Execution handoff: Layer-governed execution descriptors, feedback, coverage
  deltas, and lifecycle event output.

## 5. Compile Scope / Coverage Semantics

Compile scope defines what "all" means for a run. The system may claim complete
coverage only inside an explicit, bounded scope with evidence.

Minimum `SiteCompileScope` fields:

- `schemaVersion`
- `coverageMode`: `declared_only`, `observed_only`, `hybrid`,
  `regression_replay`, or `bounded_full`
- `coverageCompleteness`: `complete_within_scope`, `partial`, `unknown`, or
  `blocked`
- `allowedCaptureModes`: for example `static`, `adapter_metadata`,
  `redacted_artifact_replay`, `governed_capture`, `api_discovery`, or
  `dry_run_trace`
- `sourceTypes`
- `siteBoundary`
- `excludedSurfaces`
- `redactionRequired`

If scope is partial, blocked, or unknown, the manifest must say so. It must not
inflate coverage to complete without evidence.

## 6. Node Capture / NodeInventory

`NodeInventory` records nodes discovered or declared inside the compile scope.
Node examples include page type nodes, DOM semantic nodes, action nodes, route
nodes, endpoint nodes, artifact nodes, test nodes, policy nodes, schema nodes,
and unknown nodes.

Each node record should include:

- stable id
- node type
- label
- source and source type
- evidence reference
- confidence
- freshness
- validation state
- redaction requirement

Node ids must be deterministic and must not be derived from sensitive runtime
data. Unknown or blocked nodes must be represented instead of silently dropped.

## 7. Capability Capture / CapabilityInventory

`CapabilityInventory` records compile-scope capabilities and their declared or
observed evidence. Minimum fields should cover:

- capability id
- standard intent
- read-only or mutating boundary
- agent exposure state
- route references
- requirement references
- risk policy references
- approval requirement
- schema and artifact references
- test evidence references
- source, confidence, freshness, and redaction requirement

Observed capabilities are not automatically verified. Promotion to verified
catalog state requires Graph validation, SiteAdapter ownership where
site-specific semantics are involved, and project policy gates.

## 8. Function Execution Path Capture / ExecutionPathInventory

`ExecutionPathInventory` and `FunctionPathTrace` describe planned or observed
function paths without performing real work. First-version path records should
be static, synthetic, replay-based, or dry-run-only.

Minimum path fields:

- path id
- capability id
- entry action
- ordered descriptor steps
- preconditions
- route candidates
- fallback references
- expected artifacts
- failure modes and reasonCodes
- source, confidence, freshness, and redaction requirement

No path record may include executable browser handlers, downloader payloads,
raw SessionView data, raw request headers, or raw credentials.

## 9. Endpoint / API / Route Capture

Endpoint and route capture records describe surfaces known inside compile scope:

- route id and route kind
- URL pattern or abstract route family
- endpoint id and method family
- request and response schema references
- pagination or continuation descriptors
- auth, session, signer, risk, and approval requirements
- catalog status: candidate, observed, verified, deprecated, blocked, or
  unavailable
- source evidence, confidence, freshness, and redaction requirement

The compiler must keep observed API candidates separate from cataloged
endpoints. Observed candidates cannot be auto-promoted to verified Graph routes.

## 10. Requirement Capture: Auth / Session / Signer / Risk / Approval

Requirement inventories normalize:

- auth requirements
- session requirements
- signer requirements
- risk policies
- approval gates
- schema requirements
- adapter capability requirements
- Layer compatibility requirements

These records describe requirements only. They must not include actual cookies,
tokens, authorization headers, session ids, browser profiles, account
identifiers, or raw headers. Session needs should be represented as minimized
`SessionView` requirements, not raw session material.

## 11. Graph Generation: Compile Manifest To Site Capability Graph

Graph Builder consumes a validated `SiteCompileManifest` and emits
`CapabilityGraphDraft` plus `GraphBuildManifest`.

Responsibilities:

- Convert inventory records into Graph nodes.
- Convert references into Graph edges.
- Preserve source evidence, confidence, freshness, coverage mode, and
  completeness.
- Preserve requirement, risk, schema, artifact, test, version, and failure
  metadata.
- Mark unknown, missing, blocked, or incomplete surfaces.
- Require graph-derived artifacts to be redaction-required.

Graph Builder does not execute Graph routes or Planner decisions.

## 12. Graph Validation / Version Compatibility

Graph validation must run before Planner consumption. Minimum gates:

- graph schema validation
- missing node checks
- broken edge checks
- missing route checks
- endpoint and route requirement checks
- version compatibility checks
- redaction-required artifact checks
- non-read-only approval checks
- agent-exposed capability test evidence checks
- raw sensitive field rejection

Compatibility declarations should include compiler schema version, compiler
version, graph schema version, graph version, planner compatibility version,
Layer compatibility version, adapter version, and relevant schema versions.

## 13. Planner Consumption / CapabilityPlan Handoff

Planner may consume only a validated Graph with an accepted validation report.
Planner must not consume Graph drafts directly unless a test explicitly verifies
fail-closed draft rejection.

Planner integration must preserve:

- route and fallback references come from Graph.
- `CapabilityPlan` references `graphVersion` and compiler provenance where
  required.
- Planner does not perform site discovery, visit real sites, execute routes,
  call downloader, call SiteAdapter runtime functions, or write artifacts
  outside governed redaction paths.

## 14. Execution System: Layer-governed Execution

Execution System owns descriptor contracts for executing a validated
`CapabilityPlan` through Site Capability Layer. Minimum products:

- `ExecutionManifest`
- Layer handoff descriptor
- execution policy decision
- `ExecutionFeedback`
- `CoverageDelta`
- lifecycle event descriptors

Execution must not bypass Layer, call downloader directly, call SiteAdapter
outside Layer ownership, materialize raw SessionView, or write unredacted
artifacts.

## 15. Artifact Governance: Compiler / Graph / Planner / Execution Artifacts

Derived artifacts include:

- compile manifest
- node inventory
- capability inventory
- execution path inventory
- requirement inventory
- coverage report
- unknown node report
- graph draft
- graph build manifest
- planner handoff artifact
- execution manifest
- execution feedback
- coverage delta
- lifecycle event evidence

Every derived artifact must include `redactionRequired: true`, must be validated
before write, and must pass SecurityGuard / Redaction. Artifacts must not
contain raw credentials, raw browser profile material, user identity, account
identifiers, device fingerprints, or network identifiers.

## 16. Trust Boundary / SecurityGuard / Redaction

Trust boundaries:

- Static repository inputs are trusted only after schema validation.
- Redacted artifacts are trusted only as evidence summaries, not raw capture.
- Governed capture is allowed only when the capture mode is explicitly inside
  compile scope and output is redacted.
- Synthetic fixtures may be used for tests, but must not use real secrets.
- Execution feedback is trusted only after Layer-governed validation.

Validators and artifact write paths must fail closed on raw sensitive fields and
must not echo sensitive values in errors.

## 17. Failure Modes / reasonCode

Initial reasonCode families:

- `compiler.request_invalid`
- `compiler.scope_invalid`
- `compiler.scope_blocked`
- `compiler.source_unavailable`
- `compiler.source_not_redacted`
- `compiler.raw_sensitive_material_rejected`
- `compiler.manifest_invalid`
- `compiler.node_inventory_invalid`
- `compiler.capability_inventory_invalid`
- `compiler.execution_path_invalid`
- `compiler.unknown_node_detected`
- `compiler.coverage_incomplete`
- `compiler.redaction_required`
- `compiler.redaction_failed`
- `compiler.graph_build_failed`
- `graph.draft_invalid`
- `graph.edge_broken`
- `graph.node_missing`
- `graph.capability_missing_route`
- `graph.capability_missing_risk_policy`
- `graph.endpoint_requires_wbi_without_signer`
- `graph.endpoint_requires_cookie_without_auth`
- `graph.non_readonly_without_approval`
- `graph.agent_exposed_without_test`
- `graph.version_incompatible`
- `planner.graph_missing`
- `planner.graph_not_validated`
- `planner.route_not_found`
- `planner.route_context_unsatisfied`
- `planner.route_forbidden_by_risk`
- `planner.fallback_not_found`
- `execution.plan_invalid`
- `execution.layer_handoff_unavailable`
- `execution.policy_denied`
- `execution.auth_required`
- `execution.session_required`
- `execution.signer_required`
- `execution.approval_required`
- `execution.redaction_failed`
- `execution.feedback_write_failed`

Each failure must define retryability, cooldown, manual intervention,
degradation, artifact-write permission, Planner handoff permission, and Layer
handoff permission.

## 18. Observability / Lifecycle Events

Events must have a real producer or test path before being considered
implemented. Required fields include:

- trace id
- correlation id
- task id
- site
- compile id
- compiler version
- graph version
- planner version
- layer compatibility version
- adapter id
- capability id
- route id
- endpoint id
- coverage mode
- coverage completeness
- planner decision
- execution decision
- reasonCode
- risk state
- validation result
- artifact write event
- redaction event

The system must not add fake metrics or telemetry-only claims without code and
tests.

## 19. Testing Strategy

Required focused tests:

- compiler schema tests
- compiler validator tests
- raw credential rejection tests
- static compiler tests
- NodeInventory / CapabilityInventory tests
- ExecutionPathInventory / FunctionPathTrace tests
- CoverageReport / UnknownNodeReport tests
- graph builder tests
- graph validator tests
- Planner consumes validated Graph tests
- `CapabilityPlan` graphVersion / compilerVersion tests
- execution handoff tests
- ExecutionManifest / ExecutionFeedback / CoverageDelta tests
- redaction guard tests
- reasonCode mapping tests
- version compatibility tests
- docs / matrix consistency tests
- Site Capability Layer compatibility tests

Tests must use synthetic or redacted fixtures only. Unrun tests must not be
reported as passing.

## 20. Standard Products And Final Goal

Final standard products:

- `docs/site-capability-compiler-executor/DESIGN.md`
- `docs/site-capability-compiler-executor/IMPLEMENTATION_MATRIX.md`
- `docs/site-capability-compiler-executor/MIGRATION_PLAN.md`
- compiler schemas and validators
- graph builder schemas and validators
- execution schemas and validators
- static compiler and graph builder implementation
- redaction guard and artifact governance
- Planner validated-Graph consumption evidence
- Layer-governed execution handoff evidence
- tests and validation evidence for all 20 matrix sections

The goal is complete only when `IMPLEMENTATION_MATRIX.md` sections 1-20 are all
`verified`, code and test evidence are recorded, no boundary violation exists,
no sensitive data is persisted, and TestVerificationQualityGateAgent gives final
`Accepted`.
