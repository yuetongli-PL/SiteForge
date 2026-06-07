# Provider Sandbox Limitations

Provider sandbox V1 is a provider service boundary, not a full OS sandbox.

## What It Does

The sandbox constrains the services a provider can see. The APIs and schema names include:

- `PROVIDER_SANDBOX_PROTOCOL_SCHEMA_VERSION`
- `PROVIDER_SANDBOX_RESULT_SCHEMA_VERSION`
- `PROVIDER_SANDBOX_LIMITATION_STATEMENT`
- `validateProviderSandboxPolicy`
- `assertProviderSandboxPolicyValid`
- `createProviderSandboxEnvelope`
- `createRestrictedProviderSandboxServices`
- `runProviderInRestrictedSandbox`
- `sanitizeProviderSandboxResult`
- `sanitizeProviderSandboxError`
- `withProviderSandboxTimeout`

Providers receive restricted services such as controlled output writers or audit event emitters only when the policy allows them.

## What It Does Not Do

The sandbox is not a full operating-system isolation layer. It does not make unsafe provider code trustworthy by itself. It must be combined with provider manifest validation, conformance checks, runtime policy gates, output sanitization, path confinement, and release gates.

Providers cannot directly access the session vault, directly launch browsers, directly write audit/report/result/run-store artifacts, or receive private session material. Payment execution is not implemented. Default destructive execution is blocked.
