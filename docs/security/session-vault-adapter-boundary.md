# Session Vault Adapter Boundary

This document defines the Phase 29 production session vault adapter boundary for SiteForge runtime integration. The adapter is a backend-agnostic boundary for inspected session metadata, scoped ephemeral material grants, release, revocation, health, and sanitized audit events. It is not a credential onboarding system.

## Interface

The production adapter interface is `production-session-vault-adapter/v1` and requires:

- `inspectSession(request)` for metadata-only session inspection.
- `getScopedSessionMaterial(request)` for a scoped, ephemeral runtime grant.
- `releaseScopedSessionMaterial(request)` for explicit grant release.
- `healthCheck()` for sanitized operational status.
- `listLedgerEvents()` for sanitized audit events.
- `listSessionInventory()` for sanitized metadata inventory.

The adapter may expose `revokeSession(request)` for local revocation propagation. Revocation must be visible to later inspection and material requests.

## Backend-Agnostic Storage Boundary

The backend-agnostic storage boundary is metadata-only inside runtime surfaces. A production backend may be a managed secret service, HSM-backed service, platform vault, or another dependency-owned storage service, but runtime reports, health output, audit ledgers, and inventory views must not contain scoped material values.

The in-memory prototype is fileless. It keeps material in process memory only so conformance tests can exercise the interface without adding a real secret backend or writing sensitive material to disk.

The fileless prototype factory is an internal implementation module. It must not be exported from `src/app/runtime/index.mjs`, because the runtime public facade may expose only metadata, validation, audit, health, and conformance surfaces.

## Encryption And Key Management

Encryption at rest is a backend responsibility outside the runtime adapter surface. The runtime adapter must not implement ad hoc local encryption for persisted material, must not write browser profile state, and must not create a local secret file.

Key management is also outside the runtime adapter surface. Production deployments should bind a backend-specific key-management policy before enabling a durable vault backend. The runtime adapter may report which boundary is expected, but it must not expose keys, wrapped keys, credentials, tokens, cookies, or browser state.

## Lease TTL

Every material grant is bound to the inspected session and its lease TTL. If the lease has expired, `inspectSession()` must return inactive metadata and `getScopedSessionMaterial()` must deny the grant before material is returned to a provider.

## Revocation

Revocation must propagate through:

- session inspection, which reports `revoked`;
- grant requests, which are denied after revocation;
- audit events, which record a sanitized revocation observation.

Revocation does not require automatic login, credential refresh, MFA handling, captcha solving, or account recovery.

## Audit And Health

Audit sink events must use sanitized session refs, provider IDs, capability IDs, scopes, outcomes, reasons, and material summaries only. Health checks must expose counts, statuses, backend-boundary metadata, and capability flags only.

Audit and health output must never contain raw cookie values, bearer values, API key values, credential values, browser profile paths, local file paths, or `storageState` content.

## Explicit Non-Goals

The following remain out of scope for Phase 29:

- credential onboarding;
- automatic login is out of scope;
- MFA or captcha handling;
- browser profile persistence;
- storageState persistence is forbidden;
- writing cookies, bearer values, API keys, credentials, or browser state to disk;
- exposing material through `src/app/runtime/index.mjs`.

## Runtime Integration

Auth Runtime V1 and Auth-aware Controlled Browser V1 may receive ephemeral material through the existing runtime auth adapter flow. That material is allowed only inside the immediate provider call path and must be released afterward. Reports, audit views, run stores, health views, conformance reports, and public runtime exports must remain sanitized metadata surfaces.
