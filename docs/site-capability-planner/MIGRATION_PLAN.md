# Site Capability Planner Layer Migration Plan

Last updated: 2026-05-09

This plan initializes the SiteForge Site Capability Planner Layer
migration. It is intentionally incremental. Do not attempt a one-shot rewrite of
the existing Site Capability Layer, Site Capability Graph, SiteAdapter, or
downloader stack.

## Current Project Structure Overview

Observed key directories and files:

- `README.md`: project overview and current workflows.
- `CONTRIBUTING.md`: current Site Capability Layer design contract, Layer
  implementation matrix, focused regression batches, and release checks.
- `AGENTS.md`: repo-local working rules and boundary constraints.
- `docs/site-capability-graph/`: current Site Capability Graph design, matrix,
  and migration plan.
- `config/site-capabilities.json`: current capability declarations and safety
  notes.
- `config/site-registry.json`: site registry, downloader routing, capability
  families, and session requirements.
- `schema/`: site/profile/capability family schemas.
- `src/kernel/`: site-agnostic Kernel contracts and schema governance.
- `src/pipeline/`: capture, expand, knowledge-base, documentation, skill
  generation, and pipeline runtime stages.
- `src/sites/capability/`: shared Site Capability Layer services, Graph code,
  policy handoff, redaction, risk, lifecycle, schema, and boundary modules.
- `src/sites/core/adapters/`: SiteAdapter implementations and resolver.
- `src/sites/downloads/`: unified download runner, policies, modules, resource
  seeds, session manager, and recovery.
- `src/sites/sessions/`: session manifests, repair commands, release gates, and
  session runner contracts.
- `tests/node/`: Node unit, contract, boundary, regression, and integration
  tests.
- `tests/python/`: Python downloader and context tests.
- `tools/`: release audit, secret scan, redaction, and maintenance helpers.

Current documentation check:

- `docs/site-capability-graph/DESIGN.md` exists.
- `docs/site-capability-graph/IMPLEMENTATION_MATRIX.md` exists.
- `docs/site-capability-graph/MIGRATION_PLAN.md` exists.
- `docs/site-capability-planner/` is initialized by this Goal 1 batch.
- `docs/site-capability-layer/` is not present in this checkout; Layer
  references remain `CONTRIBUTING.md`, `README.md`, and `AGENTS.md`.

The repository has no root `package.json` detected during preflight. Test
commands are direct `node --test`, `node --check`, Python unittest, and project
tools.

## Current Code To Planner Mapping

| Planner responsibility | Current closest project evidence | Migration interpretation |
| --- | --- | --- |
| Planner contracts | No Planner-specific schema yet | Add versioned schema and validators first. |
| PlanRequest / PlanContext | Existing site context/session/risk modules | Use as source concepts only; do not import raw runtime state. |
| CapabilityPlan | Existing Graph handoff descriptors | Useful reference, but Planner needs its own plan schema. |
| Validated Graph loading | `src/sites/capability/site-capability-graph.mjs` | Planner loader should consume only validated Graph descriptors. |
| Route resolution | Graph query and planner-policy handoff code | Add Planner route resolver that never executes routes. |
| Context checker | auth/session/risk/schema modules | Add descriptor-only Planner checks with synthetic fixtures. |
| Risk / approval gate | risk-state and site-health execution gates | Add Planner-specific risk and approval decision mapping. |
| Auth/session/signer checks | session, auth, adapter, and signer-related code | Check requirements only; never request raw material. |
| reasonCode | `src/sites/capability/reason-codes.mjs` | Add Planner taxonomy or mapping without blurring Graph reasonCodes. |
| Redaction guard | `security-guard.mjs`, redaction tests, tools | Planner artifact writes must pass SecurityGuard / Redaction. |
| Artifact governance | artifact schema and graph artifact modules | Add PlanArtifact / PlanManifest governance after schema. |
| Observability | lifecycle-events and capability hooks | Add Planner event descriptors only with real producer/test evidence. |
| Layer handoff | `planner-policy-handoff.mjs` | Add dry-run Planner entrypoint and Layer compatibility tests. |
| Tests | many focused node tests | Add Planner-specific focused tests before status promotion. |

## Current Graph To Planner Connection Model

The first Planner connection to Graph should be read-only and fail-closed:

1. Load a Graph descriptor only after Graph validation evidence is present.
2. Reject missing or unvalidated Graph input with `planner.graph_missing` or
   `planner.graph_not_validated`.
3. Query by site and normalized intent for capability candidates.
4. Query capability routes, requirements, risk policies, fallback routes,
   schemas, artifacts, and test evidence.
5. Select routes only from Graph-declared candidates.
6. Select fallbacks only from Graph-declared fallback references.
7. Include Graph version and Graph route source in CapabilityPlan.

Planner must not mutate Graph, generate new Graph catalog entries, or promote
observed API candidates.

## Current Layer To Planner Connection Model

The first Layer connection should be dry-run and descriptor-only:

1. Planner returns a `CapabilityPlan`.
2. Layer-governed consumer checks plan validity and compatibility.
3. Layer remains responsible for execution, orchestration, SiteAdapter calls,
   SessionView use, downloader planning, artifact writes, lifecycle dispatch,
   policy enforcement, and redaction.
4. Planner does not call downloader, SiteAdapter runtime functions, browser
   sessions, or real sites.

No live Layer runtime consumer should be enabled until schema, validators,
route resolver, context checker, risk gate, redaction guard, artifact governance,
observability, and Layer compatibility tests exist.

## Major Architecture Gaps

- No Planner schema module exists.
- No Planner validator exists.
- No PlanRequest / PlanContext / CapabilityPlan contract exists.
- No Planner Graph loader exists.
- No Planner route resolver exists.
- No Planner context checker exists.
- No Planner fallback strategy code exists.
- No Planner reasonCode taxonomy or mapping exists.
- No Planner version compatibility checker exists.
- No Planner artifact governance exists.
- No Planner dry-run entrypoint exists.
- No Planner-to-Layer compatibility test exists.

## Major Security Gaps

- No Planner-specific forbidden sensitive field validator exists.
- No Planner-specific raw credential rejection test exists.
- No Planner-specific runtime product rejection test exists.
- No Planner-specific artifact redaction-required test exists.
- No Planner-specific SecurityGuard / Redaction pre-write integration exists.
- No Planner-specific proof that SessionView, DownloadPolicy,
  StandardTaskList, SiteAdapter runtime products, downloader payloads, browser
  profiles, and raw credentials cannot appear in plans.

## Major Testing Gaps

- No Planner schema tests.
- No PlanRequest / PlanContext validator tests.
- No CapabilityPlan validator tests.
- No raw credential rejection tests.
- No Graph loader tests.
- No validated Graph requirement tests.
- No route selection tests.
- No route priority tests.
- No context unsatisfied tests.
- No risk-blocked route tests.
- No auth/session/signer requirement tests.
- No approval gate tests.
- No fallback route tests.
- No Planner reasonCode mapping tests.
- No Planner version compatibility tests.
- No Planner redaction guard tests.
- No Planner artifact tests.
- No dry-run Planner entrypoint tests.
- No Site Capability Layer compatibility tests for Planner plans.

## Suggested Migration Stages

### Stage 0. Documentation Initialization

- Goal: Create Planner design, matrix, and migration plan.
- Risk: Documentation may be mistaken for implementation.
- Verification: Confirm three docs exist and cover required sections; do not
  mark implementation verified.
- Current result: Completed by this Goal 1 batch.

### Stage 1. Schema And Validator

- Goal: Add PlannerConfig, PlanRequest, PlanContext, CapabilityPlan, PlanStep,
  PlanDecision, requirement/risk/failure/artifact schemas, and a minimum
  validator.
- Risk: Schema permits raw sensitive fields or executable runtime products.
- Verification: `node --test tests/node/site-capability-planner/schema.test.mjs`
  or equivalent.

### Stage 2. Raw Sensitive Material And Trust Boundary Guards

- Goal: Reject raw credentials, browser profile material, downloader payloads,
  SiteAdapter runtime products, SessionView materialization, DownloadPolicy
  materialization, and StandardTaskList materialization.
- Risk: Tests use real sensitive material or validator echoes sensitive values.
- Verification: Planner validator negative tests plus redaction tests.

### Stage 3. Validated Graph Loader

- Goal: Load only validated Graph descriptors and compatibility metadata.
- Risk: Planner accepts unvalidated or stale Graph data.
- Verification: graph loader tests for validated, missing, unvalidated, and
  incompatible Graph inputs.

### Stage 4. Route Resolver And Fallbacks

- Goal: Resolve capabilities, route candidates, route priority, and fallback
  routes from Graph descriptors.
- Risk: Planner invents routes or treats observed candidates as verified.
- Verification: route resolver tests with synthetic Graph fixtures.

### Stage 5. Context, Risk, Approval, And Requirement Checks

- Goal: Add auth/session/signer/risk/approval/schema/adapter/layer checks and
  reasonCode mapping.
- Risk: Planner attempts to obtain missing auth/session/signer material.
- Verification: context checker, risk-blocked, approval-required, and
  requirement reasonCode tests.

### Stage 6. Plan Artifact Governance And Redaction

- Goal: Add PlanArtifact / PlanManifest governance and SecurityGuard /
  Redaction pre-write requirements.
- Risk: Planner-derived artifact writes bypass redaction.
- Verification: redaction guard tests, artifact tests, and secret scan where
  appropriate.

### Stage 7. Observability And Dry-run Entrypoint

- Goal: Add planner lifecycle event descriptors and a dry-run planner entrypoint.
- Risk: Fake metrics or live external dispatch are introduced.
- Verification: lifecycle event tests and dry-run entrypoint tests.

### Stage 8. Layer Compatibility Handoff

- Goal: Let Site Capability Layer consume CapabilityPlan safely in dry-run or
  governed handoff mode.
- Risk: Planner becomes execution authority or bypasses Layer.
- Verification: Layer compatibility tests, architecture import rules, and
  downloader boundary tests.

### Stage 9. Final Matrix Closure

- Goal: Reconcile sections 1-20, run focused and release-sized validation as
  appropriate, and get QualityGateReviewAgent final acceptance.
- Risk: Stale matrix evidence or broad claims from unrelated tests.
- Verification: Planner matrix validation and final focused test bundle.

## First Five Minimal Tasks For The Implementation Loop

1. Establish Planner schema and minimum CapabilityPlan validator.
   - Scope: schema, validator, and focused tests only.
   - Verification: Planner schema/validator tests.

2. Add raw credential and runtime product rejection tests.
   - Scope: validator negative tests and forbidden field scan.
   - Verification: Planner validator tests plus redaction boundary checks.

3. Add validated Graph loader contract.
   - Scope: loader accepts validated synthetic Graph and rejects missing or
     unvalidated Graph.
   - Verification: Planner graph loader tests.

4. Add capability route resolver with priority selection and Graph source
   enforcement.
   - Scope: synthetic Graph route candidates only.
   - Verification: route resolver tests.

5. Add context checker for auth/session/signer/risk/approval.
   - Scope: descriptor-only checks and reasonCode mapping.
   - Verification: context checker and reasonCode tests.

## Verification Strategy

Use the smallest relevant verification for each batch:

- Schema changes: Planner schema tests.
- Validator changes: Planner validator negative tests.
- Graph loader changes: graph loader tests.
- Route changes: route resolver and fallback tests.
- Context changes: auth/session/signer/risk/approval tests.
- Reason changes: reasonCode mapping tests.
- Artifact changes: redaction guard and artifact tests.
- Layer handoff changes: dry-run entrypoint, Layer compatibility, architecture
  import rules, and downloader boundary tests.
- Release checkpoints: broader Node/Python tests, `git diff --check`, and
  secret scan if the batch touches artifact or persistence paths.

Known direct test entrypoints:

```powershell
node --test .\tests\node\site-capability-matrix.test.mjs
node --test .\tests\node\planner-policy-handoff.test.mjs
node --test .\tests\node\site-capability-graph-query.test.mjs
node --test .\tests\node\site-capability-graph-validator.test.mjs
node --test .\tests\node\security-guard-redaction.test.mjs
node .\tools\prepublish-secret-scan.mjs
git diff --check
node --test .\tests\node\*.test.mjs
python -m unittest discover -s .\tests\python -p "test_*.py"
```

Future Planner-specific examples:

```powershell
node --test .\tests\node\site-capability-planner\schema.test.mjs
node --test .\tests\node\site-capability-planner\validator.test.mjs
node --test .\tests\node\site-capability-planner\route-resolver.test.mjs
node --test .\tests\node\site-capability-planner\context-checker.test.mjs
node --test .\tests\node\site-capability-planner\artifact-redaction.test.mjs
```

## Six Subagent Responsibilities By Stage

- RepoMatrixAuditor: inspect git status, matrix status, open sections, allowed
  file scope, and safest next task.
- PlannerContractSchemaAgent: own Planner schema, validator, compatibility, and
  data model review.
- GraphLayerIntegrationAgent: own Graph loader, route/fallback source, Layer
  handoff, and execution-boundary review.
- ContextRiskSecurityAgent: own auth/session/signer/risk/approval/redaction and
  sensitive-material review.
- TestVerificationAgent: own focused test selection, execution, and matrix test
  evidence.
- QualityGateReviewAgent: own acceptance, rejection, stop criteria, and final
  closure.

## Stop Condition

The Planner goal is complete only when
`docs/site-capability-planner/IMPLEMENTATION_MATRIX.md` records sections 1-20
as `verified` and QualityGateReviewAgent gives final `Accepted`.

This Goal 1 documentation batch does not satisfy that final condition.
