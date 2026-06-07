# Runtime Run Store

The runtime run store persists sanitized execution summaries, audit views, manifests, query indexes, integrity digests, and retention metadata. It is not an artifact content store and does not reconstruct raw execution material.

## Core APIs

Run store records use:

- `RUNTIME_RUN_STORE_SCHEMA_VERSION`
- `RUNTIME_RUN_STORE_MANIFEST_SCHEMA_VERSION`
- `RUNTIME_RUN_STORE_QUERY_INDEX_SCHEMA_VERSION`
- `RUNTIME_RUN_STORE_RETENTION_SCHEMA_VERSION`

Use these APIs:

- `createRuntimeRunId`
- `writeRuntimeRunStore`
- `loadRuntimeRunStore`
- `queryRunStoreIndex`
- `createRunStoreManifest`
- `createRunStoreQueryIndex`
- `createRunStoreRetentionMetadata`
- `createRunStoreIntegrityDigest`
- `resolveRunStorePath`
- `sanitizeRunStoreManifest`

## No Execution Boundary

Run store, audit query, and replay tooling do not execute provider, browser, vault, or network paths. They read bounded sanitized JSON records and return summaries for inspection.

The run store must not persist literal credentials, cookie values, token values, Authorization headers, Cookie headers, browser storage state, raw DOM, raw screenshot data, full request bodies, full response bodies, or private session material. Payment execution is not implemented. Default destructive execution is blocked.
