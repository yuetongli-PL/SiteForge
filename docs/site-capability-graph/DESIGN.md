# Site Capability Graph Design

Last updated: 2026-05-05

This document is the local source of truth for the first Site Capability Graph migration inside Browser-Wiki-Skill.

The Site Capability Graph is the declarative capability knowledge model for the Site Capability Layer. It describes what a site can do, which routes and endpoints support those capabilities, what auth/session/risk/schema/artifact/test/version/failure-mode constraints apply, and which Layer components are allowed to consume that knowledge.

The Site Capability Graph does not execute tasks. The Site Capability Layer remains the external execution and orchestration entrypoint.

## 1. 核心定位

Site Capability Graph is a declarative, versioned, queryable model of site capability knowledge.

It answers questions such as:

- Which capabilities exist for a site.
- Which routes expose or support those capabilities.
- Which endpoints are known, verified, blocked, deprecated, or unavailable.
- Which auth, session, signer, risk, approval, schema, artifact, failure-mode, and observability requirements apply.
- Which tests or verification evidence support a capability edge.

The Graph must stay descriptive. It must not:

- Execute browser tasks, API calls, download jobs, login flows, recovery flows, or crawler jobs.
- Store dynamic run state.
- Store raw sensitive credentials or identity-linked session material.
- Replace the Site Capability Layer runtime.
- Replace SiteAdapter interpretation.
- Replace downloader planning or execution.

Version 1 should use JSON plus schema plus validator plus read-only query API. Do not introduce a database until the JSON model, invariants, and query paths are stable and tested.

## 2. Non-goals

The Graph is not a runtime engine, task queue, downloader, browser profile manager, auth store, API sniffer, or automatic catalog promoter.

Non-goals:

- No CAPTCHA bypass, anti-bot bypass, access-control bypass, MFA bypass, credential extraction, platform-risk evasion, or silent privilege expansion.
- No raw credential persistence.
- No raw cookie, CSRF, authorization header, token, session id, browser profile, device fingerprint, account identifier, IP/network identifier, or sensitive query-string persistence.
- No dynamic runtime state such as current login state, current risk state, current browser profile path, current downloader progress, or current network lease.
- No automatic promotion from observed API candidate to stable catalog entry.
- No direct downloader execution.
- No site-specific semantic interpretation in Kernel-owned Graph logic.

If examples are required, use synthetic and redacted values only.

## 3. 与 Site Capability Layer 的关系

The Site Capability Layer executes and orchestrates. The Site Capability Graph describes.

Boundary:

- Kernel/orchestrator remains site-agnostic and owns coordination, common safety, lifecycle events, schema governance, reason semantics, and artifact routing.
- Capability Services provide reusable cross-site mechanisms such as capture, API discovery, redaction, session views, risk state, policy handoff, schema inventory, and lifecycle hooks.
- SiteAdapter owns site-specific interpretation: URL classification, page type, endpoint meaning, signer requirements, auth/risk mapping, pagination, fields, and candidate-to-catalog decisions.
- downloader remains a low-permission consumer of StandardTaskList, DownloadPolicy, minimized SessionView, and resolved resources.
- Graph is read by Layer components through a query API. External callers should not execute Graph directly.

The Graph can reference existing Layer concepts, but must not move their responsibilities:

- It may reference a SiteAdapter id and version; it must not implement SiteAdapter logic.
- It may reference a downloader module capability; it must not execute downloader logic.
- It may reference SessionRequirement; it must not materialize or store raw sessions.
- It may reference SecurityGuard / Redaction policy; graph-derived artifacts must still pass through the actual guard before persistence.

## 4. Graph 分层结构

Graph v1 should be stored as JSON documents validated by schema:

- `GraphManifest`: top-level metadata, schema version, graph version, source inventories, generated/updated timestamps, and compatibility declarations.
- `SiteLayer`: site identity, URL family, adapter id/version, registry references, capability profile references.
- `CapabilityLayer`: declared capabilities and their approval, read/write, task, policy, artifact, and test relationships.
- `RouteLayer`: route/page/query/action surfaces and route-to-capability mappings.
- `EndpointLayer`: known endpoint candidates and cataloged endpoints with auth, signer, schema, pagination, risk, and version metadata.
- `RequirementLayer`: auth, session, signer, risk, approval, policy, schema, and trust-boundary requirements.
- `EvidenceLayer`: tests, fixtures, verification commands, verification results, redaction audit references, and lifecycle/observability evidence.

Storage should remain repository-local JSON in the first version. The first implementation should prefer deterministic generation and validation over hand-edited large files.

## 5. Node taxonomy

Minimum node families:

- `SiteNode`: site key, host family, registry reference, adapter reference.
- `CapabilityNode`: normalized capability, mode, read/write boundary, approval requirement, task types, policy link.
- `RouteNode`: URL pattern or route family, route kind, page type, supported capability edges.
- `EndpointNode`: API or resource endpoint descriptor, status, method family, schema, auth, signer, risk, and verification metadata.
- `AuthRequirementNode`: auth type and proof requirement without raw auth values.
- `SessionRequirementNode`: minimal SessionView requirement, purpose, TTL class, scope, and permission boundary.
- `SignerNode`: signer requirement descriptor, version, adapter owner, and test evidence.
- `RiskPolicyNode`: risk states, allowed actions, cooldown/quarantine/manual recovery behavior, reasonCode mapping.
- `SchemaNode`: governed schema name, schemaVersion, compatibility owner, validation command.
- `ArtifactContractNode`: artifact family, redaction requirement, schema, write guard, audit requirement.
- `TestEvidenceNode`: test file, command, result, fixture type, and verification scope.
- `VersionNode`: graph, adapter, service, catalog, schema, and downloader compatibility versions.
- `FailureModeNode`: reasonCode, retry/cooldown/isolation/degrade/manual recovery/artifact-write semantics.
- `ObservabilityNode`: lifecycle event or metric descriptor with required fields and producer evidence.

Nodes must have stable ids. Node ids should be deterministic, human-readable, and not derived from sensitive runtime data.

## 6. Edge taxonomy

Minimum edge families:

- `site_declares_capability`: SiteNode -> CapabilityNode.
- `capability_exposed_on_route`: CapabilityNode -> RouteNode.
- `route_resolves_endpoint`: RouteNode -> EndpointNode.
- `capability_requires_auth`: CapabilityNode -> AuthRequirementNode.
- `endpoint_requires_auth`: EndpointNode -> AuthRequirementNode.
- `capability_requires_session`: CapabilityNode -> SessionRequirementNode.
- `endpoint_requires_session`: EndpointNode -> SessionRequirementNode.
- `endpoint_requires_signer`: EndpointNode -> SignerNode.
- `capability_guarded_by_risk_policy`: CapabilityNode -> RiskPolicyNode.
- `endpoint_guarded_by_risk_policy`: EndpointNode -> RiskPolicyNode.
- `node_validated_by_schema`: any governed node -> SchemaNode.
- `node_produces_artifact`: node -> ArtifactContractNode.
- `artifact_guarded_by_redaction`: ArtifactContractNode -> SecurityGuard / Redaction policy reference.
- `node_covered_by_test`: node or edge -> TestEvidenceNode.
- `node_has_version`: node -> VersionNode.
- `node_fails_with`: node or edge -> FailureModeNode.
- `observability_emits`: node -> ObservabilityNode.
- `derived_from_layer_source`: graph node -> source file/config/test evidence reference.

Edges must be validatable. Broken edges are graph validation failures, not warnings.

## 7. CapabilityNode

`CapabilityNode` describes a stable capability exposed by a site, not a runtime action.

Required fields:

- `id`
- `siteKey`
- `capabilityKey`
- `capabilityFamily`
- `mode`: `readOnly`, `write`, `download`, `auth`, `diagnostic`, or `maintenance`
- `requiresApproval`: boolean
- `supportedTaskTypes`
- `routeRefs`
- `riskPolicyRef`
- `schemaVersion`
- `sourceRefs`
- `testEvidenceRefs`

Invariants:

- A CapabilityNode must have at least one route reference unless explicitly blocked.
- A CapabilityNode must have a risk policy reference.
- A non-readOnly capability must set `requiresApproval: true` unless a narrower policy explicitly blocks execution.
- An agent-exposed capability must have test evidence before it can be marked implemented.
- CapabilityNode must not contain raw request headers, raw cookies, raw session values, or browser profile identifiers.

Existing migration inputs include `config/site-capabilities.json`, `config/site-registry.json`, `src/sites/catalog/`, SiteAdapter contracts, and planner policy handoff tests. Those inputs are not yet a Graph implementation.

## 8. RouteNode

`RouteNode` describes a page, URL family, command route, or action surface that can expose capabilities.

Required fields:

- `id`
- `siteKey`
- `routeKind`
- `urlPattern` or `commandPattern`
- `pageType`
- `capabilityRefs`
- `adapterRef`
- `riskPolicyRef`
- `schemaVersion`
- `sourceRefs`
- `testEvidenceRefs`

RouteNode must not classify site semantics by itself. SiteAdapter remains the owner of page type and site-specific route interpretation. Graph records the adapter-owned declaration and validation evidence.

## 9. EndpointNode

`EndpointNode` describes a known API, resource, native seed, or download resource endpoint.

Required fields:

- `id`
- `siteKey`
- `endpointKind`
- `status`: `observed`, `candidate`, `verified`, `cataloged`, `deprecated`, or `blocked`
- `routeRefs`
- `capabilityRefs`
- `methodFamily`
- `authRequirementRef`
- `sessionRequirementRef`
- `signerRef`
- `requestSchemaRef`
- `responseSchemaRef`
- `riskPolicyRef`
- `versionRef`
- `sourceRefs`
- `testEvidenceRefs`

Invariants:

- `requiresCookie: true` requires an AuthRequirementNode and SessionRequirementNode.
- `requiresWbi: true` or any signer-specific flag requires a SignerNode.
- `observed` or `candidate` endpoints cannot be treated as `cataloged`.
- EndpointNode must contain only redacted request and response shape metadata, never raw sensitive values.

## 10. AuthRequirement / SessionRequirement

Auth and session requirements describe conditions, not credential material.

AuthRequirementNode fields should include:

- `authKind`
- `requiredFor`
- `proofType`
- `allowedMaterial`: descriptor-only values such as `session-view`, `browser-visible`, or `manual-operator-confirmed`
- `forbiddenMaterial`
- `reasonCodeRefs`

SessionRequirementNode fields should include:

- `purpose`
- `scope`
- `ttlClass`
- `permissionClass`
- `profileIsolation`
- `networkContextClass`
- `auditRequired`
- `revocationRequired`

The Graph must never store raw session material. Session materialization remains a Site Capability Layer / SessionProvider concern.

## 11. SignerNode

`SignerNode` describes a signer requirement such as WBI-style signing, site request signature generation, or adapter-owned request proof.

Required fields:

- `id`
- `siteKey`
- `signerKind`
- `adapterRef`
- `versionRef`
- `supportedEndpointRefs`
- `testEvidenceRefs`
- `failureModeRefs`

SignerNode must not store signer secrets, raw keys, runtime tokens, or raw request material. It only declares that an adapter-owned signer is required and verified.

## 12. RiskPolicyNode

`RiskPolicyNode` describes allowed behavior under risk signals.

Minimum risk states:

- `normal`
- `suspicious`
- `rate_limited`
- `captcha_required`
- `auth_expired`
- `permission_denied`
- `cooldown`
- `isolated`
- `manual_recovery_required`
- `blocked`

Policy fields:

- `state`
- `allowedActions`
- `blockedActions`
- `requiresApproval`
- `cooldownRequired`
- `isolationRequired`
- `manualRecoveryRequired`
- `degradable`
- `artifactWriteAllowed`
- `reasonCodeRefs`

RiskPolicyNode is for safe degradation, pausing, isolation, and manual recovery signaling. It is not for bypassing CAPTCHA, anti-bot, rate limits, permission checks, or account risk controls.

## 13. Schema governance

Graph v1 must define governed schemas before runtime integration:

- `SiteCapabilityGraph`
- `GraphManifest`
- `SiteNode`
- `CapabilityNode`
- `RouteNode`
- `EndpointNode`
- `AuthRequirementNode`
- `SessionRequirementNode`
- `SignerNode`
- `RiskPolicyNode`
- `SchemaNode`
- `ArtifactContractNode`
- `TestEvidenceNode`
- `VersionNode`
- `FailureModeNode`
- `ObservabilityNode`
- `GraphEdge`
- `GraphValidationReport`
- `GraphQueryResult`

Every schema must have `schemaVersion`. Graph validation must reject missing, future, incompatible, or conflicting schema versions.

## 14. Versioning

Graph versioning must track:

- `graphSchemaVersion`
- `graphDataVersion`
- `kernelCompatibilityVersion`
- `capabilityServiceCompatibilityVersion`
- `siteAdapterVersion`
- `apiCatalogVersion`
- `manifestSchemaVersion`
- `reasonCodeSchemaVersion`
- `standardTaskListVersion`
- `downloadPolicyVersion`
- `riskStateSchemaVersion`
- `sessionViewSchemaVersion`
- `downloaderCompatibilityVersion`

The first validator must fail closed on incompatible versions. Migration should use explicit compatibility checks instead of best-effort fallback.

## 15. Trust Boundary

Trust boundaries:

- Graph data is repository knowledge, not live session state.
- Graph-derived artifacts are untrusted until passed through SecurityGuard / Redaction.
- Graph query results are descriptors, not execution grants.
- Any boundary crossing from Graph to Layer execution must go through Layer policy, SiteAdapter interpretation, SessionProvider, and downloader contracts as applicable.

The Graph must not give downloader raw credentials, raw browser profiles, unredacted session material, or site-specific semantic authority.

## 16. SecurityGuard / Redaction 集成

All graph-derived artifact writes must be guarded.

Required behavior:

- Redact headers, query parameters, request bodies, response summaries, errors, lifecycle event details, and metadata before persistence.
- Reject forbidden sensitive fields in graph data.
- Fail closed if redaction fails.
- Store redaction audit summaries with graph-derived artifacts.
- Use synthetic or redacted fixtures in tests.

Existing Layer SecurityGuard and redaction tests are migration inputs. Graph-specific artifact writes and graph-specific redaction tests still need to be implemented in a later phase.

## 17. Failure Modes / reasonCode

Graph failure modes must map to existing reasonCode governance instead of ad hoc strings.

Required graph failure categories:

- `graph-schema-invalid`
- `graph-version-incompatible`
- `graph-edge-broken`
- `graph-node-missing-required-field`
- `graph-capability-missing-route`
- `graph-capability-missing-risk-policy`
- `graph-non-readonly-missing-approval`
- `graph-agent-capability-missing-test-evidence`
- `graph-endpoint-missing-signer`
- `graph-endpoint-missing-auth-requirement`
- `graph-observed-candidate-promoted-without-verification`
- `graph-artifact-redaction-required`
- `graph-query-no-match`
- `graph-query-ambiguous`
- `graph-boundary-violation`

Each failure mode must define retry, cooldown, isolation, manual recovery, degradation, artifact-write, and catalog-deprecation semantics where applicable.

## 18. Observability

Graph observability is descriptor-oriented.

Required fields for graph validation and query events:

- `traceId`
- `correlationId`
- `taskId` when part of a Layer task
- `siteKey`
- `capabilityKey`
- `adapterVersion`
- `graphVersion`
- `schemaVersion`
- `lifecycleEvent`
- `reasonCode`
- `riskState`
- `queryName`
- `validationResult`
- `redactionResult`

Do not add fake metrics. Every event or metric must have a real producer or a focused test before being marked implemented.

## 19. Testing strategy

Minimum test coverage before Graph implementation can be marked verified:

- Graph schema tests.
- Validator invariant tests.
- Broken-edge tests.
- Sensitive-field rejection tests.
- Graph-derived artifact redaction tests.
- Query API tests.
- Planner handoff compatibility tests.
- SiteAdapter reference contract tests.
- Endpoint auth/signer requirement tests.
- API candidate to catalog lifecycle tests.
- Failure mode reasonCode mapping tests.
- Version compatibility tests.
- Observability event tests.

Testing must use synthetic and redacted fixtures only.

## 20. 标准产物与最终目标

Standard Graph artifacts:

- `SiteCapabilityGraph` JSON data.
- `GraphManifest`.
- `GraphValidationReport`.
- `GraphQueryResult` fixtures.
- `GraphCoverageMatrix`.
- `GraphMigrationReport`.
- Redaction audit artifacts for graph-derived writes.

Final target:

- Graph v1 is stored as JSON.
- Graph schema, validator, and query API exist with tests.
- Graph references existing Layer evidence without replacing Layer boundaries.
- Graph-derived artifacts pass SecurityGuard / Redaction before persistence.
- Capability, route, endpoint, auth/session, signer, risk, schema, version, failure, artifact, test, and observability relationships are represented as validated nodes and edges.
- The Site Capability Layer remains the only execution entrypoint.
- SiteAdapter remains the site-specific interpretation owner.
- downloader remains a low-permission consumer.
