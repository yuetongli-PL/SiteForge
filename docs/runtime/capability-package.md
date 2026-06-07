# Capability Package

Capability packages are portable, sanitized descriptions of site capabilities, execution contracts, package provenance, and provider compatibility. They do not carry private session material or raw browser material.

## Core APIs

Use `CAPABILITY_PACKAGE_SCHEMA_VERSION` with:

- `buildCapabilityPackageFromGraph`
- `validateCapabilityPackageManifest`
- `assertCapabilityPackageManifestValid`
- `sanitizeCapabilityPackageManifest`
- `exportCapabilityPackageSafeJson`
- `importCapabilityPackageSafeJson`
- `createCapabilityPackageRegistry`
- `resolvePackageCapabilityRef`
- `resolvePackageExecutionContractRef`
- `createCapabilityPackageDigest`
- `createCapabilityPackageProvenance`

`CAPABILITY_PACKAGE_SCHEMA_DEFINITIONS` documents the schema fragments used by package manifests, registry entries, diffs, compatibility reports, and provenance records.

## Boundary

Packages describe what can be requested; they do not execute providers, launch browsers, inspect sessions, or authorize high-risk actions. Payment capabilities may be classified and planned, but payment execution is not implemented. Destructive capabilities may be represented for planning or lab-only flows, but default destructive execution is blocked.

Capability package authors should store stable refs, digests, schema versions, sanitized evidence summaries, and provider compatibility metadata. They must not store literal credentials, private session data, browser storage state, full request or response bodies, or raw page artifacts.
