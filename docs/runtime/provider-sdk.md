# Runtime Provider SDK

The provider SDK defines the production-facing contract for runtime providers. Providers must be described by `PROVIDER_MANIFEST_SCHEMA_VERSION`, adapted with `createProviderAdapter`, validated with `validateProviderManifest` and `validateProviderRegistration`, and checked with `runProviderConformance` before production registration.

## Provider Contract

Provider implementations expose descriptor-driven methods only:

- `supports(descriptor)` answers whether a provider can handle a sanitized runtime descriptor.
- `canExecute(context)` returns an allow/block decision without side effects.
- `run(context)` executes only after runtime policy, provider registration, and execution gates have already allowed the request.

Providers cannot directly access the session vault. Providers cannot directly launch a browser. Providers cannot directly write audit, report, result, or run-store artifacts. Providers receive only the scoped services exposed by the runtime boundary.

## Manifest And Validation

Use these public APIs:

- `validateProviderManifest`
- `assertProviderManifestValid`
- `validateProviderRegistration`
- `assertProviderRegistrationValid`
- `validateRuntimeProviderInterface`
- `validateProviderRuntimeCompatibility`
- `validateProviderSideEffectProfile`
- `sanitizeProviderResult`
- `sanitizeProviderError`

Production registration requires a valid manifest. `PROVIDER_ALLOWED_SIDE_EFFECTS` does not include production payment execution or default destructive execution.

## Safety Rules

Automatic login is not supported. Arbitrary authenticated browsing is not supported. Payment execution is not implemented. Default destructive execution is blocked. Literal credentials, cookie values, token values, Authorization headers, and session handles are not valid provider inputs.

Testing fixture providers such as `createSafeFixtureProvider` are not exported from `src/app/runtime/index.mjs`; they remain available only from the provider SDK module for tests and conformance fixtures.
