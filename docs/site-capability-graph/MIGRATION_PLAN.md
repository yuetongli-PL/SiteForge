# Site Capability Graph Migration Plan

Last updated: 2026-05-05

This plan initializes the SiteForge Site Capability Graph migration. It is intentionally incremental: do not attempt a one-shot rewrite of the Site Capability Layer.

## Current project structure overview

Observed key directories and files:

- `README.md`: project orientation, current direct Node/Python workflow, no `package.json`.
- `CONTRIBUTING.md`: current Site Capability Layer design contract, verified Layer implementation matrix, focused regression batches, and release checks.
- `AGENTS.md`: local working rules and Site Capability Layer boundary constraints.
- `config/site-capabilities.json`: current capability declarations and safety notes.
- `config/site-registry.json`: site registry, downloader routing, capability families, and session requirements.
- `schema/`: current site/profile/capability family schemas.
- `src/kernel/`: site-agnostic Kernel contracts and schema governance.
- `src/pipeline/`: capture, expand, knowledge-base, documentation, skill generation, and pipeline runtime stages.
- `src/sites/capability/`: shared Site Capability Layer services and governed contracts.
- `src/sites/core/adapters/`: SiteAdapter implementations and resolver.
- `src/sites/catalog/`: site registry/catalog access.
- `src/sites/downloads/`: unified download runner, policies, modules, resource seeds, session manager, and recovery.
- `src/sites/sessions/`: session manifests, repair commands, release gates, and session runner contracts.
- `tests/node/`: Node unit, contract, boundary, regression, and integration tests.
- `tests/python/`: Python downloader and context tests.
- `tools/`: release audit, secret scan, redaction, and maintenance helpers.

Existing docs check:

- `docs/` exists but was empty at initialization.
- `docs/site-capability-layer/` was not present.
- `docs/site-capability-graph/` was not present before this planning stage.
- `CONTRIBUTING.md` states the repository-level `docs/` directory is retired for long-lived Layer docs. This Graph planning task is an explicit user-requested exception and only adds the three requested Graph planning files.

Current A/B loop reconciliation:

- `docs/site-capability-layer/DESIGN.md` is still missing.
- `CONTRIBUTING.md` and `AGENTS.md` remain the Layer design references for this repository; `README.md` remains the project overview.
- Do not treat the missing Layer docs path as present, implemented, or verified unless a future explicit task creates that file and updates this plan plus the Graph implementation matrix.

## Current code to Site Capability Graph mapping

| Graph responsibility | Current closest project evidence | Migration interpretation |
| --- | --- | --- |
| Site Capability Layer | `src/kernel/`, `src/pipeline/`, `src/sites/capability/`, `CONTRIBUTING.md` | Execution and orchestration remain here. Graph must be read-only input. |
| Capability Registry | `config/site-capabilities.json`, `config/site-registry.json`, `src/sites/catalog/` | Source material for future CapabilityNode and SiteNode generation. |
| Capability Planner | `src/sites/capability/planner-policy-handoff.mjs`, `standard-task-list.mjs`, `download-policy.mjs` | Future Graph query may feed policy handoff, but only after descriptor-only query tests exist. |
| Context Checker | `src/sites/catalog/context.mjs`, profile validation, site adapter contract tests | Can become Graph source refs, not Graph-owned interpretation. |
| SiteAdapter | `src/sites/core/adapters/*.mjs`, `factory.mjs`, `resolver.mjs` | Remains owner of site-specific route/page/endpoint interpretation. Graph records adapter-owned declarations. |
| NetworkCaptureService | `src/sites/capability/network-capture.mjs`, capture stage | Source for observed EndpointNode candidates only. |
| ApiDiscoveryService | `src/sites/capability/api-discovery.mjs`, `api-candidates.mjs` | Source for EndpointNode lifecycle states; no automatic catalog promotion. |
| ApiKnowledgeService | `api-candidates.mjs`, API catalog upgrade/store helpers | Future Graph references verified/cataloged endpoint evidence. |
| SessionProvider | `src/sites/sessions/`, `src/infra/auth/site-session-governance.mjs`, downloader session manager | Graph stores SessionRequirement descriptors only. |
| RiskStateMachine | `risk-state.mjs`, `site-health-recovery.mjs`, `site-health-execution-gate.mjs` | Source for RiskPolicyNode states and reason semantics. |
| SecurityGuard / Redaction | `security-guard.mjs`, `tools/social-redaction.mjs`, redaction tests | Mandatory guard for graph-derived artifact writes. |
| ArtifactService | `src/pipeline/artifacts/`, `artifact-schema.mjs`, schema inventory | Future Graph artifact contract and validation report writer must integrate here. |
| PolicyResolver | `download-policy.mjs`, `planner-policy-handoff.mjs`, `site-health-execution-gate.mjs` | Graph can declare policy refs; Layer continues resolving policy. |
| downloader | `src/sites/downloads/`, Python download modules | Low-permission consumer only; Graph cannot execute or interpret downloader tasks. |
| schema | `schema/`, `schema-governance.mjs`, `schema-inventory.mjs` | Add Graph schemas and compatibility checks here in a later batch. |
| reasonCode | `reason-codes.mjs`, reason tests | Add graph-specific reason families only with validator failure modes. |
| api-candidates | `api-candidates.mjs`, `api-discovery.mjs` | Migrate into EndpointNode lifecycle references after schema exists. |
| api-catalog | `api-candidates.mjs` catalog helpers and tests | Graph can reference cataloged endpoints; it must not auto-promote candidates. |
| lifecycle hook | `lifecycle-events.mjs`, `capability-hook.mjs` | Add descriptor-only Graph validation/query events only with real producers. |
| observability | lifecycle/data-flow evidence modules and tests | Future GraphValidationReport and query events should reuse required fields. |
| tests | `tests/node/`, `tests/python/` | Need new `site-capability-graph-*` focused tests. |
| fixtures | `tests/node/helpers/`, synthetic inline fixtures | Graph tests must use synthetic/redacted fixtures only. |

## Current Layer to Graph connection model

The first connection should be read-only:

1. Generate or maintain Graph JSON from existing safe sources such as config, adapter declarations, schema inventory, and verified API catalog metadata.
2. Validate Graph JSON with Graph schema and invariant checks.
3. Query Graph through a small read-only API.
4. Let existing Layer components consume query results as descriptors only.
5. Keep actual execution in Layer paths: SiteAdapter, policy handoff, SessionProvider, downloader, ArtifactService, and SecurityGuard.

Do not wire Graph into downloader or session runtime before schema, validator, redaction, and query tests pass.

## Major architecture gaps

- No Graph data model, manifest, schema, validator, query API, or graph artifact family exists.
- Existing Layer capability/config/API knowledge is distributed and implicit rather than represented as validated nodes and edges.
- There is no explicit Graph invariant check for required route/risk/test edges.
- There is no Graph representation for AuthRequirementNode, SessionRequirementNode, SignerNode, RiskPolicyNode, VersionNode, FailureModeNode, or ObservabilityNode.
- There is no graph-specific reasonCode family.
- There is no compatibility check between graph version and Layer consumers.
- There is no generated GraphValidationReport.
- There is no GraphCoverageMatrix validation gate beyond this planning matrix.

## Major security gaps

- No graph-specific forbidden sensitive field validator exists.
- No graph-derived artifact write guard exists.
- No graph-specific redaction audit test exists.
- No validator currently proves that Graph cannot carry raw sessions, raw credentials, browser profile identifiers, device fingerprints, account identifiers, IP/network identifiers, or sensitive query parameters.
- No invariant currently prevents a non-readOnly agent-exposed capability from missing approval evidence.
- No invariant currently prevents an endpoint requiring cookies from missing auth/session requirement refs.
- No invariant currently prevents an endpoint requiring a signer from missing a SignerNode.
- No Graph query result trust-boundary tests exist.

## Major testing gaps

- No `site-capability-graph-schema.test.mjs`.
- No `site-capability-graph-validator.test.mjs`.
- No `site-capability-graph-query.test.mjs`.
- No Graph redaction golden tests.
- No Graph version compatibility tests.
- No Graph reasonCode mapping tests.
- No Graph planner handoff compatibility tests.
- No Graph observability event tests.
- No Graph matrix validation test.

## Suggested migration stages

### Stage 0. Planning initialization

- Goal: Create the Graph design, matrix, and migration plan.
- Risk: Documentation may be mistaken for implementation.
- Verification: Confirm the three docs exist and cover all required sections; do not mark Graph implementation verified.
- Current result: Completed by this planning batch.

### Stage 1. Graph schema and synthetic fixture

- Goal: Define GraphManifest, node, edge, validation report, and query result schemas with `schemaVersion`.
- Risk: Schema becomes too broad or encodes runtime state.
- Verification: `node --test tests\node\site-capability-graph-schema.test.mjs`.

### Stage 2. Validator invariants

- Goal: Enforce required fields, schemaVersion compatibility, broken-edge detection, forbidden sensitive fields, capability route/risk/test refs, non-readOnly approval, endpoint auth/session/signer requirements, and candidate-not-cataloged promotion boundaries.
- Risk: Validator misses high-risk boundary cases or only checks happy path.
- Verification: `node --test tests\node\site-capability-graph-validator.test.mjs tests\node\security-guard-redaction.test.mjs`.

### Stage 3. Read-only query API

- Goal: Add descriptor-only queries by site, capability, route, endpoint, requirement, risk policy, schema, failure mode, and test evidence.
- Risk: Query API accidentally becomes execution authority or returns unsafe material.
- Verification: `node --test tests\node\site-capability-graph-query.test.mjs tests\node\trust-boundary.test.mjs`.

### Stage 4. Initial graph generation from safe Layer sources

- Goal: Generate initial Graph JSON from `config/site-capabilities.json`, `config/site-registry.json`, adapter declarations, schema inventory, and verified API catalog metadata.
- Risk: Generator may over-trust observed candidates or encode stale/unsafe details.
- Verification: Graph validator tests plus focused config/profile/site adapter tests.

### Stage 5. Layer compatibility and planner handoff

- Goal: Allow selected Layer paths to read Graph descriptors without changing execution ownership.
- Risk: Graph bypasses SiteAdapter, SessionProvider, downloader policy, or SecurityGuard.
- Verification: Graph query tests plus `planner-policy-handoff`, `architecture-import-rules`, `downloads-runner`, and `session-view` focused tests.

### Stage 6. Graph-derived artifacts and observability

- Goal: Add GraphValidationReport, GraphQueryResult fixtures, migration report, redaction audit, and descriptor-only lifecycle/observability events.
- Risk: Artifact writes leak sensitive fields or fake metrics are added without producers.
- Verification: Graph redaction tests, lifecycle event tests, schema inventory tests, and secret scan.

## First five minimal tasks for the next A/B long loop

1. Add Graph v1 JSON schema and one synthetic minimal fixture.
   - Scope: schema and tests only.
   - Verification: `node --test tests\node\site-capability-graph-schema.test.mjs`.

2. Add Graph validator with core invariant tests.
   - Scope: required fields, schemaVersion, broken edges, forbidden sensitive fields.
   - Verification: `node --test tests\node\site-capability-graph-validator.test.mjs`.

3. Add CapabilityNode, RouteNode, and RiskPolicyNode invariant tests.
   - Scope: capability route refs, risk policy refs, non-readOnly approval, agent-exposed test evidence.
   - Verification: Graph validator focused tests.

4. Add EndpointNode auth/session/signer lifecycle invariant tests.
   - Scope: `requiresCookie` requires AuthRequirement and SessionRequirement; `requiresWbi` requires SignerNode; observed/candidate cannot become cataloged without verification edge.
   - Verification: Graph validator focused tests plus nearby API candidate tests if reused.

5. Add read-only Graph query API contract.
   - Scope: descriptor-only query results; no downloader/session execution; no raw sensitive fields.
   - Verification: `node --test tests\node\site-capability-graph-query.test.mjs tests\node\trust-boundary.test.mjs`.

## First recommended task for Stage 2

Start with task 1: add Graph v1 JSON schema and one synthetic minimal fixture, with no runtime integration. This gives every later batch a stable contract and keeps risk low.

## Verification strategy

Use the smallest relevant verification for each batch:

- Schema-only changes: Graph schema tests.
- Validator changes: Graph validator tests plus redaction tests when sensitive-field handling changes.
- Query API changes: query tests plus trust-boundary tests.
- Planner compatibility changes: graph query tests plus `planner-policy-handoff` and architecture import rules.
- Artifact writer changes: graph redaction tests, schema inventory tests, and secret scan.
- Release-sized checkpoints: existing README broad validation commands.

Existing project test entrypoints:

```powershell
node --test .\tests\node\site-capability-matrix.test.mjs
node --test .\tests\node\site-adapter-contract.test.mjs .\tests\node\site-onboarding-discovery.test.mjs
node --test .\tests\node\downloads-runner.test.mjs .\tests\node\planner-policy-handoff.test.mjs
node .\tools\prepublish-secret-scan.mjs
git diff --check
node --test .\tests\node\*.test.mjs
python -m unittest discover -s .\tests\python -p "test_*.py"
```

The repository currently has no `package.json`, `npm scripts`, `pnpm` setup, `pyproject.toml`, `pytest.ini`, or `Makefile` entrypoint detected in the root.

## Stop condition for this planning stage

This stage stops after creating:

- `docs/site-capability-graph/DESIGN.md`
- `docs/site-capability-graph/IMPLEMENTATION_MATRIX.md`
- `docs/site-capability-graph/MIGRATION_PLAN.md`

Do not begin implementation or an A/B loop from this stage.
