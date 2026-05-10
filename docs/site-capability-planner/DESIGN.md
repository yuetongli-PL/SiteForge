# Site Capability Planner Layer Design

Last updated: 2026-05-09

This document initializes the SiteForge Site Capability Planner Layer.
The Planner is the task decision layer between a normalized user task and the
existing Site Capability Graph plus Site Capability Layer. This is a design
document only; verified implementation status is tracked in
`IMPLEMENTATION_MATRIX.md`.

The Planner must preserve the existing project boundaries:

- Site Capability Layer remains the execution and orchestration entrypoint.
- Site Capability Graph remains the declarative capability knowledge model.
- SiteAdapter remains responsible for site-specific interpretation.
- downloader remains a low-permission consumer of governed tasks and policies.
- Planner never executes real tasks, never visits real sites, and never calls
  downloader directly.
- Planner never reads, stores, emits, or persists raw credentials, browser
  profile material, identity-linked session data, or sensitive request data.
- Every planner-derived artifact must be redaction-required and must pass
  SecurityGuard / Redaction before persistence.

Version 1 should use JSON, schema, validators, a read-only graph query path, and
a dry-run plan API. Do not introduce a database until the contract is stable and
tested.

## 1. Core Positioning

Site Capability Planner Layer is a task decision layer. Given a user task,
standard intent, PlanContext, policy input, risk state, and validated Graph query
result, it generates a structured `CapabilityPlan`.

It answers:

- Which capability should satisfy this task.
- Which graph-declared route is the safest eligible route.
- Which auth, session, signer, approval, risk, schema, and artifact
  requirements are satisfied or missing.
- Which fallback route may be used when the primary route is unavailable.
- Which failure reasonCode should be returned when planning cannot proceed.
- Which plan artifacts are expected and how they must be governed.

The Planner does not perform the task. The generated plan is handed to the Site
Capability Layer in dry-run or governed mode.

## 2. Non-goals

The Planner is not:

- A browser automation runtime.
- A downloader.
- A task runner or scheduler.
- A credential, cookie, token, session, or browser profile store.
- A replacement for Site Capability Graph.
- A replacement for Site Capability Layer.
- A replacement for SiteAdapter.
- A replacement for downloader policy or execution.
- An API candidate promoter.
- A CAPTCHA, anti-bot, access-control, auth, risk-control, or privilege bypass.

The Planner must not:

- Execute browser actions, API calls, downloads, login flows, recovery flows, or
  crawler jobs.
- Access real websites.
- Materialize raw SessionView, DownloadPolicy, StandardTaskList, or downloader
  work items outside Layer-owned paths.
- Store dynamic browser state.
- Persist raw cookies, tokens, authorization headers, CSRF values, session ids,
  browser profile identifiers, account identifiers, network identifiers, device
  fingerprints, or sensitive query parameters.
- Convert observed API candidates into verified catalog entries.
- Add fake observability events or metrics without a producer or test path.

## 3. Relationship With Site Capability Layer And Graph

The three layers have separate ownership:

- Site Capability Layer describes how safe execution and orchestration work.
- Site Capability Graph describes declarative capability knowledge.
- Site Capability Planner Layer decides how one concrete task should be planned
  against the validated Graph and governed Layer entrypoint.

Planner may query Graph, but Graph remains descriptive. Planner may hand a plan
to Layer, but Layer remains the execution entrypoint. Planner may reference a
SiteAdapter id, but SiteAdapter remains responsible for site semantics. Planner
may mention downloader requirements, but downloader remains a low-permission
consumer invoked only by Layer-owned execution paths.

The first integration mode is descriptor-only and dry-run-first:

1. Validate PlanRequest and PlanContext.
2. Normalize or accept a standard intent.
3. Query a validated Site Capability Graph.
4. Resolve capability and route candidates.
5. Check requirements and risk gates.
6. Generate `CapabilityPlan`.
7. Return or hand off the plan to a Layer-governed dry-run consumer.

## 4. Planner Layered Structure

Planner v1 should be split into focused modules:

- Schema and contracts: versioned PlannerConfig, PlanRequest, PlanContext,
  CapabilityPlan, PlanStep, PlanDecision, PlanRequirementSummary,
  PlanRiskSummary, PlanFailure, PlanArtifact, and PlanManifest.
- Validators: structural checks, forbidden sensitive field checks, graph source
  checks, route source checks, approval checks, and artifact redaction checks.
- Graph loader: accepts only validated Graph data and compatibility metadata.
- Route resolver: selects route candidates and fallbacks from Graph descriptors.
- Context checker: evaluates auth, session, signer, approval, risk, schema, and
  compatibility constraints.
- Reason mapping: maps planner failures to stable reasonCodes.
- Artifact governance: validates redaction-required plan artifacts before any
  write path.
- Observability: emits descriptor-only lifecycle events with required fields.
- Entrypoint: dry-run planner API used by Layer-governed consumers.

## 5. Planner Input Model: PlanRequest / PlanContext

`PlanRequest` is the user-task planning input. Minimum fields:

- `schemaVersion`
- `taskId`
- `site` or `url`
- `normalizedIntent` or an intent input that can be normalized
- `requestedCapabilityId` when already known
- `mode`, such as `dry_run` or `governed_handoff`
- `plannerConfigRef`
- `correlationId`

`PlanContext` is minimized planning context. Minimum fields:

- `schemaVersion`
- `capabilityState`
- `sessionState`
- `riskState`
- `approvalState`
- `graphCompatibility`
- `layerCompatibility`
- `adapterCapabilityState`
- `schemaAvailability`

PlanContext may describe whether a requirement is satisfied. It must not contain
raw credentials, raw session ids, raw browser profile identifiers, raw request
headers, raw cookies, raw account identifiers, raw network identifiers, or
sensitive query strings.

## 6. Planner Output Model: CapabilityPlan / PlanStep / PlanDecision

`CapabilityPlan` is the central Planner product. Minimum fields:

- `schemaVersion`
- `plannerVersion`
- `graphVersion`
- `layerCompatibilityVersion`
- `planStatus`
- `siteId`
- `normalizedIntent`
- `capabilityId`
- `selectedRoute`
- `requirements`
- `riskSummary`
- `decisions`
- `steps`
- `fallbacks`
- `expectedArtifacts`
- `redactionRequired`

`PlanStep` records a planned Layer-owned action descriptor, not an executed task.
It may identify a capability, route, requirement check, artifact expectation, or
handoff target. It must not contain concrete downloader execution payloads.

`PlanDecision` records why a route, fallback, block, or degradation was selected.
It should include source graph references, compatibility evidence, and
reasonCode when relevant.

## 7. Intent Normalization

Planner accepts either a standard `normalizedIntent` or an input that an
Intent Normalizer can map to one. The first version should prefer existing
project intent conventions and avoid site-specific parsing inside Planner.

If intent cannot be normalized, Planner returns `planner.intent_unresolved`.
Planner must not try to infer site semantics that belong in SiteAdapter.

## 8. Capability / Route Resolution

Planner resolves:

- site plus intent to capability candidates;
- capability to route candidates;
- route to endpoint, requirements, risk policy, schema, artifact, fallback, and
  test evidence references;
- eligible route candidates to a selected route by priority, safety, and
  compatibility;
- graph-declared fallback routes when the selected route is unavailable.

Routes and fallbacks must explicitly come from a validated Graph. Planner must
not invent routes, promote observed candidates, or treat unvalidated catalog
data as trusted.

## 9. Requirement / Context Checking

Planner checks whether context satisfies declared requirements:

- auth requirement;
- session requirement;
- signer requirement;
- approval requirement;
- risk policy;
- graph version compatibility;
- layer compatibility;
- adapter capability;
- required schema availability;
- agent exposure permission.

Unsatisfied requirements return structured failures and reasonCodes. Planner
does not obtain missing auth, login, session, signer, or profile data.

## 10. RiskPolicy / Approval Gate

Planner enforces Graph-declared risk policy and approval requirements before a
route can be marked ready.

Non-readOnly capabilities require an approval requirement. Risk-blocked routes
must return `planner.route_forbidden_by_risk` and must not continue to Layer
handoff unless the design explicitly allows a safe degradation.

Approval state is a descriptor, not an authorization secret. It must not contain
identity-linked values.

## 11. AuthRequirement / SessionRequirement / SignerRequirement

Planner may require:

- auth capability availability;
- minimal session view availability;
- signer availability;
- signer owner compatibility;
- adapter capability compatibility.

Planner must never require raw cookie strings, raw authorization headers, raw
tokens, raw session ids, raw browser profile paths, or device fingerprints.

For cookie/session-requiring capabilities, Planner can only require a
SessionView-compatible descriptor owned by the Layer or a session provider.
For signer-requiring capabilities, Planner can only require a signer descriptor
owned by SiteAdapter or another governed component.

## 12. Fallback / Degradation Strategy

Fallbacks must be declared in the validated Graph. Planner may choose a fallback
when:

- primary route context is unsatisfied;
- primary route is risk-blocked and a safer fallback exists;
- primary route is version-incompatible;
- primary route lacks required schema;
- primary route is not agent-exposed;
- a metadata-only or dry-run-only degradation is declared.

If no Graph-declared fallback exists, Planner returns
`planner.fallback_not_found`.

## 13. Failure Modes / reasonCode

Planner reasonCodes:

- `planner.request_invalid`
- `planner.intent_unresolved`
- `planner.site_unresolved`
- `planner.graph_missing`
- `planner.graph_not_validated`
- `planner.capability_not_found`
- `planner.route_not_found`
- `planner.route_context_unsatisfied`
- `planner.route_forbidden_by_risk`
- `planner.auth_required`
- `planner.session_required`
- `planner.signer_required`
- `planner.approval_required`
- `planner.version_incompatible`
- `planner.schema_missing`
- `planner.artifact_redaction_required`
- `planner.artifact_redaction_failed`
- `planner.fallback_not_found`
- `planner.plan_generation_failed`
- `planner.layer_handoff_unavailable`

Each reasonCode must define:

- retryability;
- cooldown requirement;
- manual intervention requirement;
- degradation allowance;
- artifact write allowance;
- Layer handoff allowance.

## 14. Versioning / Compatibility

Planner contracts must declare:

- Planner schema version;
- planner implementation version;
- Graph schema and data version;
- Layer compatibility version;
- plan artifact schema version;
- reasonCode taxonomy version.

Planner must fail closed on incompatible Graph or Layer versions with
`planner.version_incompatible`. Compatibility checks should be explicit and
covered by tests before sections are promoted beyond `implemented`.

## 15. Trust Boundary

Planner consumes only:

- validated Graph descriptors;
- declared policy descriptors;
- minimized and redacted context;
- compatibility metadata;
- synthetic or redacted test fixtures.

Planner must reject:

- raw sensitive material;
- dynamic browser state;
- raw profile roots or profile identifiers;
- executable route handlers;
- downloader command payloads;
- SiteAdapter runtime products;
- unredacted artifact payloads;
- unvalidated observed API candidates.

## 16. SecurityGuard / Redaction Integration

Planner-derived artifacts must:

- set `redactionRequired: true`;
- pass forbidden sensitive field checks;
- pass SecurityGuard / Redaction before persistence;
- record redaction audit metadata where the existing artifact governance path
  supports it;
- fail closed with `planner.artifact_redaction_required` or
  `planner.artifact_redaction_failed` when redaction governance is missing.

Tests must prove that Planner rejects raw credential fields and unredacted plan
artifacts.

## 17. Plan Artifact / Plan Manifest Governance

Plan artifacts include:

- `PlanArtifact`;
- `PlanManifest`;
- dry-run plan output;
- Layer handoff descriptor;
- validation report;
- redaction audit summary;
- planner lifecycle event fixture.

Artifacts are planner-derived, not runtime execution records. They must not
contain downloader results, raw sessions, browser profile material, or live site
payloads unless a future Layer-owned governed consumer defines and tests a safe
summary.

## 18. Observability / Lifecycle Events

Planner event fields:

- trace id;
- correlation id;
- task id;
- site;
- normalized intent;
- capability id;
- route id;
- graph version;
- planner version;
- layer compatibility version;
- adapter id;
- planner decision;
- reasonCode;
- risk state;
- validation result;
- artifact write event;
- redaction event.

Observability must have a real producer or focused test coverage. Do not add
fake metrics, external telemetry, or dispatch paths during Planner v1
initialization.

## 19. Testing Strategy

Minimum Planner test families:

- schema tests;
- PlanRequest validator tests;
- PlanContext validator tests;
- CapabilityPlan validator tests;
- raw credential rejection tests;
- graph loader tests;
- validated graph requirement tests;
- route selection tests;
- priority selection tests;
- context unsatisfied tests;
- risk-blocked route tests;
- auth/session/signer requirement tests;
- approval gate tests;
- fallback route tests;
- reasonCode mapping tests;
- version compatibility tests;
- redaction guard tests;
- plan artifact tests;
- dry-run planner entrypoint tests;
- Site Capability Layer compatibility tests;
- docs and matrix validation tests if infrastructure is available.

Every verified section must record code evidence, test evidence, verification
command, verification result, current gaps, and QualityGateReviewAgent
acceptance.

## 20. Standard Outputs And Final Goal

Standard outputs:

- `PlannerConfig`
- `PlanRequest`
- `PlanContext`
- `PlanContextCapabilityState`
- `PlanContextSessionState`
- `PlanContextRiskState`
- `CapabilityPlan`
- `PlanStep`
- `PlanDecision`
- `PlanRequirementSummary`
- `PlanRiskSummary`
- `PlanFailure`
- `PlanArtifact`
- `PlanManifest`
- planner compatibility declaration
- planner reasonCode catalog
- dry-run planner entrypoint
- Layer handoff descriptor

The Site Capability Planner Layer goal is complete only when
`IMPLEMENTATION_MATRIX.md` records sections 1-20 as `verified`, focused
verification evidence exists, and QualityGateReviewAgent accepts the final
state. Documentation alone is not completion.
