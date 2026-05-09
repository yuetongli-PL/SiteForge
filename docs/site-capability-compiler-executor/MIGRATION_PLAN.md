# Site Capability Compiler And Execution System Migration Plan

Last updated: 2026-05-10

This plan initializes the Browser-Wiki-Skill migration for Site Capability
Compiler, Graph Builder integration, Planner consumption, and Layer-governed
Execution. The migration is intentionally incremental and must not rewrite the
existing Site Capability Layer, Graph, Planner, SiteAdapter, downloader, or
session systems in one pass.

## Current Project Structure Overview

Observed key directories and files:

- `README.md`: project overview and workflows.
- `CONTRIBUTING.md`: current Site Capability Layer design contract and matrix
  material.
- `AGENTS.md`: repo-local working rules and security boundaries.
- `docs/site-capability-graph/`: current Graph design, matrix, and migration
  plan.
- `docs/site-capability-planner/`: current Planner design, matrix, and
  migration plan.
- `docs/site-capability-compiler-executor/`: initialized by this Goal 1 batch.
- `config/site-registry.json`: registry, routing, and site metadata source.
- `config/site-capabilities.json`: capability declaration source.
- `schema/`: governed profile and capability family schemas.
- `src/sites/capability/`: Graph, Planner, security guard, risk, session view,
  lifecycle, policy handoff, artifact schema, and shared capability modules.
- `src/sites/capability/planner/`: current Planner Layer implementation.
- `src/sites/core/adapters/`: SiteAdapter implementations and resolver.
- `src/sites/downloads/`: downloader and media execution modules that must
  remain Layer-owned consumers.
- `src/sites/sessions/`: session contracts and runners.
- `tests/node/`: Node contract, boundary, graph, planner, and integration
  tests.
- `tools/prepublish-secret-scan.mjs`: repository secret scanning tool.

Documentation check during preflight:

- `docs/site-capability-graph/DESIGN.md` exists.
- `docs/site-capability-graph/IMPLEMENTATION_MATRIX.md` exists.
- `docs/site-capability-graph/MIGRATION_PLAN.md` exists.
- `docs/site-capability-planner/DESIGN.md` exists.
- `docs/site-capability-planner/IMPLEMENTATION_MATRIX.md` exists.
- `docs/site-capability-planner/MIGRATION_PLAN.md` exists.
- `docs/site-capability-layer/` is not present in this checkout; current Layer
  references remain `CONTRIBUTING.md`, `README.md`, and `AGENTS.md`.
- `docs/site-capability-compiler-executor/` is created by this initialization.

The repository does not expose a root `package.json` in preflight. Verification
should use direct `node --check`, `node --test`, Python tests where relevant,
and project tools.

## Current Code To Compiler / Executor Mapping

| Responsibility | Current closest project evidence | Migration interpretation |
| --- | --- | --- |
| Site registry input | `config/site-registry.json` | Static compiler source; validate and summarize only. |
| Capability config input | `config/site-capabilities.json` | Static compiler source for capabilities and routes. |
| SiteAdapter metadata | `src/sites/core/adapters/` | Source for site-owned semantics; Compiler must not replace adapters. |
| API discovery input | `src/sites/capability/api-discovery.mjs` and `api-candidates.mjs` | Input to inventories only after redaction and scope gates. |
| Capture input | capture and artifact modules under `src/pipeline/` and tests | Use redacted artifacts or synthetic replay first. |
| Security / redaction | `src/sites/capability/security-guard.mjs`, redaction tests, secret scan tool | Required guard before derived artifact writes. |
| Graph model | `src/sites/capability/site-capability-graph.mjs` | Graph builder target and validation bridge. |
| Planner | `src/sites/capability/planner/` | Consumer of validated compiler-generated Graph only. |
| Execution / downloader | `src/sites/downloads/` and Layer modules | Execution must remain Layer-governed; no direct downloader call. |
| Tests | `tests/node/` | Add `tests/node/site-capability-compiler-executor/`. |

## Current Site Capability Graph Connection

The compiler should connect to Graph in two steps:

1. Produce a validated `SiteCompileManifest` with inventories, source
   references, coverage report, unknown reports, version metadata, and
   redaction requirements.
2. Graph Builder converts the manifest into `CapabilityGraphDraft` and
   `GraphBuildManifest`, then existing or new Graph validation verifies schema,
   missing nodes, broken edges, missing routes, requirements, version
   compatibility, and redaction requirements.

Planner must not consume the draft. Planner may consume only a Graph with a
passed validation report and compiler provenance.

## Current Planner Connection

Planner already has a dedicated implementation under
`src/sites/capability/planner/`. For this migration, Planner integration should
be additive:

- Do not rewrite Planner.
- Add compiler provenance to the validated Graph fixture or loader metadata
  only where needed.
- Prove Planner rejects unvalidated compiler-generated drafts.
- Prove `CapabilityPlan` can reference `graphVersion` and `compilerVersion`
  without containing raw compile evidence or sensitive fields.

## Current Layer / Execution Connection

Layer remains the execution entrypoint. Execution migration should first add
descriptor-only contracts:

1. `ExecutionManifest` schema.
2. Layer handoff descriptor for a validated `CapabilityPlan`.
3. `ExecutionFeedback` and `CoverageDelta` schemas.
4. Redaction guard before execution-derived artifact writes.
5. Tests proving downloader and SiteAdapter are not called directly by the new
   execution modules.

Live execution wiring is not first-phase work.

## Major Architecture Gaps

- No `src/sites/capability/compiler/` implementation exists.
- No `src/sites/capability/execution/` implementation exists.
- No `SiteCompileRequest`, `SiteCompileScope`, or `SiteCompileManifest` schema
  exists.
- No compiler validator exists.
- No NodeInventory, CapabilityInventory, ExecutionPathInventory,
  FunctionPathTrace, RequirementInventory, CompileCoverageReport, or
  UnknownNodeReport schema exists.
- No static compiler from registry / capability config exists.
- No compile manifest to Graph draft builder exists.
- No GraphBuildManifest contract exists.
- No compiler-generated Graph validation bridge exists.
- No compiler provenance bridge to Planner exists.
- No ExecutionManifest, ExecutionFeedback, or CoverageDelta contract exists.

## Major Security Gaps

- No compiler/executor-specific raw sensitive field validator exists.
- No compiler/executor raw credential rejection tests exist.
- No compiler/executor artifact redaction guard exists.
- No derived artifact write path for this goal exists.
- No compiler proof exists that redacted artifacts are consumed only as safe
  evidence summaries.
- No execution proof exists that downloader remains Layer-owned.

## Major Testing Gaps

- No compiler schema tests.
- No compiler validator tests.
- No raw credential rejection tests.
- No static compiler tests.
- No NodeInventory / CapabilityInventory tests.
- No ExecutionPathInventory / FunctionPathTrace tests.
- No CompileCoverageReport / UnknownNodeReport tests.
- No graph builder tests.
- No graph validator tests for compiler-generated drafts.
- No Planner consumes validated compiler-generated Graph tests.
- No CapabilityPlan compilerVersion / graphVersion tests.
- No execution handoff tests.
- No ExecutionManifest / ExecutionFeedback / CoverageDelta tests.
- No compiler/executor redaction guard tests.
- No compiler/executor reasonCode tests.
- No compiler/executor version compatibility tests.
- No docs / matrix consistency tests for this new doc set.

## Suggested Migration Stages

### Stage 0. Documentation Initialization

- Goal: Create design, implementation matrix, and migration plan.
- Risk: Documentation may be mistaken for implementation.
- Verification: Confirm three docs exist and cover the required sections.
- Current result: Completed by this Goal 1 batch after verification.

### Stage 1. Core Schema And Validator

- Goal: Add `SiteCompileRequest`, `SiteCompileScope`, and
  `SiteCompileManifest` schemas plus validator.
- Risk: Schema permits raw sensitive material or derived artifacts without
  redaction.
- Verification: Focused schema/validator tests and raw sensitive material
  negative tests.

### Stage 2. Static Compiler Manifest

- Goal: Generate a minimal compile manifest from registry, capability config,
  adapter metadata summaries, and synthetic/redacted fixtures.
- Risk: Static compiler overclaims coverage or treats observed candidates as
  verified catalog entries.
- Verification: Static compiler tests with synthetic fixtures and coverage
  report assertions.

### Stage 3. Inventories And Coverage

- Goal: Add NodeInventory, CapabilityInventory, ExecutionPathInventory,
  FunctionPathTrace, RequirementInventory, CompileCoverageReport, and
  UnknownNodeReport.
- Risk: Inventories store sensitive runtime details or omit unknown/blocked
  objects.
- Verification: Inventory tests, unknown/blocked tests, and redaction tests.

### Stage 4. Graph Builder And Validation Bridge

- Goal: Build `CapabilityGraphDraft` and `GraphBuildManifest` from validated
  compile manifests, then validate graph schema, edges, nodes, routes,
  requirements, redaction, and versions.
- Risk: Graph Builder becomes an executor or Planner consumes drafts.
- Verification: Graph builder tests, broken edge tests, missing node tests, and
  Planner draft rejection tests.

### Stage 5. Planner Provenance Integration

- Goal: Let Planner consume only validated compiler-generated Graph metadata and
  preserve compiler/graph provenance in `CapabilityPlan`.
- Risk: Planner begins discovery or bypasses Graph validation.
- Verification: Planner validated-Graph consumption tests and negative tests
  for unvalidated compiler drafts.

### Stage 6. Layer-governed Execution Contracts

- Goal: Add `ExecutionManifest`, Layer handoff descriptor, `ExecutionFeedback`,
  and `CoverageDelta`.
- Risk: Execution calls downloader or SiteAdapter directly.
- Verification: Execution handoff tests, forbidden import/runtime tests, and
  redaction guard tests.

### Stage 7. ReasonCodes, Observability, And Final Matrix Closure

- Goal: Add reasonCode taxonomy, mapping tests, lifecycle events, matrix
  consistency tests, and final validation.
- Risk: Fake telemetry, incomplete reason semantics, or premature verified
  status.
- Verification: reasonCode tests, event tests, matrix tests, focused suite,
  diff check, and secret scan.

## First Five Minimum Verifiable Tasks

1. Establish `SiteCompileRequest`, `SiteCompileScope`, and
   `SiteCompileManifest` schemas and validator with raw sensitive material
   rejection tests.
2. Add `redactionRequired=true` validation for all compiler-derived artifacts
   and negative tests for missing redaction flags.
3. Add a static compiler that reads synthetic registry / capability config
   fixtures and emits a minimal `SiteCompileManifest` with coverage report.
4. Add NodeInventory and CapabilityInventory minimal outputs with source,
   confidence, freshness, unknown handling, and tests.
5. Add Graph Builder minimal draft emission from a validated compile manifest
   with broken edge and missing node validation tests.

## Subagent Responsibilities By Stage

RepoMatrixAuditor tracks git status, dirty-file risk, matrix status, section
selection, and allowed file scope in every batch.

CompilerContractSchemaAgent owns compiler, graph builder, and execution
contracts, schema versions, validators, compatibility declarations, and
negative schema tests.

SiteCapturePathDiscoveryAgent owns static sources, adapter metadata summaries,
redacted artifact replay, node/capability/path inventories, unknown reports,
and coverage semantics.

GraphEmissionPlannerIntegrationAgent owns compile-manifest to Graph draft
emission, graph validation bridge, Planner validated-Graph consumption, route
and fallback provenance, and Graph/Planner/Layer boundaries.

ExecutionPolicySecurityAgent owns Layer-governed execution contracts, policy,
risk, auth/session/signer/approval boundaries, redaction guards, artifact
governance, and downloader/SiteAdapter/session boundaries.

TestVerificationQualityGateAgent owns focused tests, verification commands,
matrix evidence quality, final gate review, and rejection of pseudo-completion.

## Stop Conditions

Stop if the user asks to stop, a user decision is required, sensitive data
landing risk cannot be safely avoided, unrelated dirty changes would be
overwritten, or all 20 matrix sections are `verified` with final
TestVerificationQualityGateAgent `Accepted`.
