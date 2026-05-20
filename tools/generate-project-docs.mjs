#!/usr/bin/env node
// @ts-check

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TOOL_DIR, '..');

const OUTPUTS = Object.freeze([
  ['README.md', renderReadme],
  ['docs/architecture.md', renderArchitecture],
  ['docs/release-hardening-plan.md', renderReleaseHardeningPlan],
]);

function normalizeSlashes(value) {
  return String(value).replace(/\\/gu, '/');
}

function asPosixPath(...segments) {
  return normalizeSlashes(path.join(...segments));
}

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(REPO_ROOT, relativePath), 'utf8'));
}

async function loadContext() {
  const registry = await readJson('config/site-registry.json');
  const capabilities = await readJson('config/site-capabilities.json');
  const hosts = Object.keys(registry.sites ?? {});
  const capabilityHosts = Object.keys(capabilities.sites ?? {});
  if (hosts.join('\n') !== capabilityHosts.join('\n')) {
    throw new Error('site-registry and site-capabilities host order must match before docs generation.');
  }
  return {
    hosts,
    registrySchemaVersion: registry.schemaVersion,
    capabilitiesSchemaVersion: capabilities.schemaVersion,
  };
}

function renderHostBullets(hosts) {
  return hosts.map((host) => `- \`${host}\``).join('\n');
}

function renderReadme(context) {
  return `# SiteForge

SiteForge is a local, modular-monolith tool for turning a public site URL into a governed site capability workspace. The only public CLI surface is:

\`\`\`bash
siteforge build https://example.com/
\`\`\`

The build command crawls within bounded site rules, compiles evidence into capability contracts, plans descriptor-only actions, writes sanitized artifacts, and promotes verified site outputs under \`.siteforge/sites/<site_id>/\`.

For non-developers, SiteForge is a site capability translator. It records what a real site exposes, where risk or login boundaries appear, which actions are safe to plan, and how later AI workflows should explain blocked or partial outcomes.

## What SiteForge Solves

- Site structure changes should become explainable capability drift, not silent script failure.
- Login, permission, CAPTCHA, rate-limit, and platform-risk pages should be recorded as blocked states instead of bypassed.
- Site-specific interpretation should live in SiteAdapters, while Pipeline, Compiler, Planner, and Domain services stay site-agnostic.
- Raw cookies, tokens, browser profiles, session ids, and authorization headers must not become ordinary build artifacts.
- Generated site data belongs outside tracked source so the checkout stays a clean code repository.

## Outputs

| Output | Purpose |
| --- | --- |
| Site workspace | Sanitized evidence, diagnostics, and generated artifacts under \`.siteforge/sites/<site_id>/\`. |
| Capability contracts | Structured facts about pages, capabilities, risks, sessions, schemas, and policies. |
| Descriptor-only plans | Planner outputs that describe allowed, blocked, or remediation paths without executing privileged actions. |
| Repo-local Skill material | Generated guidance for later AI use, backed by capability evidence and safety boundaries. |

## Current Contract

- Deployment shape: one repository, one package, one CLI.
- Dependency rule: entrypoints -> app -> domain; infra and site adapters depend only on contracts they need.
- Business shape: Pipeline / Compiler / Planner.
- Public command: \`siteforge build <url>\`.
- Internal commands: Node entrypoints under \`src/entrypoints/\` are operator-only and are not public CLI routes.
- Runtime artifacts: generated site data belongs in \`.siteforge/\` or ignored transient directories, never in tracked source.

## Architecture

\`\`\`mermaid
flowchart TD
  CLI["src/entrypoints/cli"] --> Pipeline["src/app/pipeline"]
  Pipeline --> Compiler["src/app/compiler"]
  Pipeline --> Planner["src/app/planner"]
  Compiler --> Domain["src/domain"]
  Planner --> Domain
  Pipeline --> Registry["src/sites/registry"]
  Registry --> Adapters["src/sites/adapters"]
  Adapters --> Domain
  Infra["src/infra"] --> Pipeline
  Infra --> Domain
\`\`\`

The durable map is [docs/architecture.md](docs/architecture.md).

## Repository Layout

| Path | Responsibility |
| --- | --- |
| \`src/entrypoints/cli/\` | Public CLI facade. |
| \`src/entrypoints/pipeline/\` | Internal stage entrypoints and runtime wiring. |
| \`src/entrypoints/sites/\` | Internal operator utilities for known sites and sessions. |
| \`src/app/pipeline/\` | End-to-end orchestration, build DAG, artifact lifecycle, recovery, output validation. |
| \`src/app/compiler/\` | Evidence, graph, and capability compilation into governed contracts. |
| \`src/app/planner/\` | Descriptor-only plans, blocked plans, remediation plans, and policy handoff. |
| \`src/domain/\` | Stable contracts for capabilities, policies, schemas, risks, sessions, artifacts, and lifecycle. |
| \`src/sites/adapters/\` | SiteAdapter contracts and site interpretation. |
| \`src/sites/known-sites/\` | Site-owned helpers for supported public sites. |
| \`src/sites/registry/\` | Site registry, profile, page type, and artifact lookup. |
| \`src/infra/\` | Browser, auth, config, filesystem, network, process, and CLI IO. |
| \`src/skills/generation/\` | Repo-local skill generation. |
| \`config/\` | Versioned stable site registry and capability records. |
| \`schema/\` | Published schema/profile definitions. |
| \`tests/\` | Node and Python tests, fixtures, and regression gates. |
| \`tools/\` | Release, cleanup, audit, and verification tooling. |

Retired Web UI, shared download runtime, legacy capability, legacy pipeline, and legacy kernel layers stay physically removed and are guarded by architecture tests.

## Supported Public Sites

Stable config currently keeps public records for:

${renderHostBullets(context.hosts)}

Removed internal catalog experiments are not part of the public site registry.

## Verification

Before release or merge, run:

\`\`\`bash
npm run check:syntax
npm run test:node:focused
npm run test:node:all
npm run test:python
npm run scan:secrets
git diff --check
\`\`\`

Focused tests are for batch work; the full gate above is required before publication.

Use \`npm run clean:outputs\` to remove local generated site data and keep the checkout source-only before staging.

## Safety

- Do not persist raw credentials, cookies, authorization headers, CSRF values, session ids, browser profiles, or tokens.
- Do not implement CAPTCHA bypass, anti-bot bypass, access-control bypass, credential extraction, or silent privilege expansion.
- Do not write generated site data into tracked source.
- Keep root-level \`runs/\`, \`book-content/\`, \`knowledge-base/\`, \`profiles/\`, \`skills/\`, \`crawler-scripts/\`, logs, downloads, caches, and browser state ignored and removable.
- Site-owned Python support files under \`src/sites/known-sites/<site>/download/python/\` are internal helpers, not a restored shared download runtime.

## Release And Versioning

- [x] Add clearer release/versioning policy

Release readiness is evidence-based, not date-based. No tag, package version bump, push, PR, publication, live capability claim, or live authenticated validation is implied by local tests passing.

Contract versions are governed by compatibility evidence in schema inventory and compatibility registry tests. Additive compatible fields keep the current schema or artifact version. Incompatible persisted or public contract changes require an explicit version bump and matching tests.

## Contributing

Use [CONTRIBUTING.md](CONTRIBUTING.md) for working rules, the Site Capability Layer matrix, focused regression batch definition, release boundaries, and operator runbooks. Use [AGENTS.md](AGENTS.md) for Codex-specific execution rules.

## Source Of Truth

- Architecture: [docs/architecture.md](docs/architecture.md)
- Release hardening: [docs/release-hardening-plan.md](docs/release-hardening-plan.md)
- Matrix and regression policy: [CONTRIBUTING.md](CONTRIBUTING.md)
- Active CLI: \`package.json\` bin -> \`src/entrypoints/cli/index.mjs\`
`;
}

function renderArchitecture() {
  return `# SiteForge Architecture

Last reviewed: 2026-05-21.

SiteForge is a modular monolith: one repository, one package, one public CLI, and no remote service boundary. The architecture rule is clean-architecture dependency direction, while the business structure is Pipeline / Compiler / Planner.

## Public Surface

\`siteforge build <url>\` is the only public command. It enters through \`src/entrypoints/cli/index.mjs\`, dispatches to \`src/entrypoints/pipeline/run-pipeline.mjs\`, and runs the URL-to-Skill build DAG from \`src/app/pipeline/build/\`.

Internal entrypoints under \`src/entrypoints/pipeline/\` and \`src/entrypoints/sites/\` are operator/developer tools, not public subcommands.

## Template Directory Mapping

This checkout now uses the physical template tree. The dependency contract is enforced by tests and the top-level source directories mirror the target architecture.

| Clean layer | Current path | Responsibility |
| --- | --- | --- |
| Entrypoints | \`src/entrypoints/\` | CLI parsing, runtime assembly, progress/output mapping, and operator entrypoints. |
| Application Pipeline | \`src/app/pipeline/\` | Stage orchestration, build DAG state, artifact lifecycle, recovery flow, and build reporting. |
| Application Compiler | \`src/app/compiler/\` and \`src/app/pipeline/stages/capability-compile.mjs\` | Compile evidence, graphs, capability facts, intents, contracts, and safe artifacts. |
| Application Planner | \`src/app/planner/\` and \`src/app/planner/policy-handoff.mjs\` | Produce descriptor-only plans, blocked plans, and remediation plans from validated facts and policy. |
| Domain contracts/services | \`src/domain/\` plus root \`schema/\` and \`config/\` data | Site-agnostic contracts, reason codes, redaction, risk, policy, lifecycle, SessionView, schema, and compatibility. |
| Site adapters | \`src/sites/adapters/\` | Site identity, URL/page/API interpretation, health-signal mapping, normalization, and site-owned support code. |
| Site registry | \`src/sites/registry/\` | Stable site registry access, context, archetypes, page type inference, profile validation, and site-neutral lookup helpers. |
| Known sites | \`src/sites/known-sites/\` | Site-owned support code, query helpers, doctor scenarios, and approved site-specific implementation details. |
| Infrastructure | \`src/infra/\` | Browser, auth, CLI rendering, filesystem, process, and runtime IO adapters. |
| Skill generation | \`src/skills/generation/\` | Repo-local skill rendering, coverage gates, metadata sync, and publishing helpers. |
| Shared helpers | \`src/shared/\` | Site-neutral formatting, normalization, page-state helpers, and markdown utilities. |

Root-level site data folders are not part of the source tree. Local \`book-content/\`, \`knowledge-base/\`, \`profiles/\`, \`skills/\`, \`crawler-scripts/\`, \`runs/\`, and \`.playwright-mcp/\` directories are generated data or tool state and must stay deleted or ignored. Durable examples belong under \`tests/fixtures/\`; runtime output belongs under a local workspace such as \`.siteforge/\`.

## Dependency Rules

- Entrypoints may depend on application, domain contracts, site adapters through registries, and infra assembly code.
- Application Pipeline may depend on domain contracts and adapter registries, but not concrete site internals or retired runtimes.
- Compiler must stay descriptor/artifact oriented. It must not import entrypoints, browser runtime, or concrete filesystem writer implementations except through guarded artifact APIs.
- Planner must not import Pipeline runtime, SiteAdapter runtime, browser runtime, download runtime, or session orchestration.
- Domain contracts and capability services must not import entrypoints, concrete site implementations, scripts, or retired download runtime paths.
- Infrastructure must not depend on CLI entrypoints; live login/keepalive execution is injected by entrypoints or tests.
- SiteAdapter implementations own site-specific interpretation and must not push those semantics into Pipeline, Kernel, or downloader-like consumers.

## Retired Paths

These paths are intentionally absent and protected by tests:

- \`src/sites/capability/build/web-interaction-*.mjs\`
- \`src/app/pipeline/build/web-interaction-*.mjs\`
- \`src/sites/downloads/\`
- \`src/entrypoints/sites/download.mjs\`

Download-like behavior is not a top-level runtime layer. The remaining supported surface is descriptor-only planning and policy contracts such as StandardTaskList, DownloadPolicy, SessionView, and artifact guards. Site-owned Python support files under \`src/sites/known-sites/<site>/download/python/\` are not the retired shared download runtime and are not public commands.

## Runtime Flow

\`\`\`mermaid
flowchart TD
    User["User"] --> CLI["siteforge build <url>"]
    CLI --> Pipeline["Application Pipeline"]
    Pipeline --> BuildDAG["URL-to-Skill Build DAG"]
    BuildDAG --> Compiler["Compiler"]
    Compiler --> Graph["Capability Graph + Intents"]
    Graph --> Planner["Planner"]
    Planner --> Plans["Descriptor-only plans / blocked plans / remediation"]
    Pipeline --> AdapterRegistry["SiteAdapter registry"]
    AdapterRegistry --> SiteAdapter["SiteAdapter"]
    Pipeline --> Domain["Domain services"]
    Domain --> Redaction["SecurityGuard + redaction audits"]
    Domain --> Session["SessionView + trust boundaries"]
    Domain --> Risk["Risk + reason codes"]
    Pipeline --> Infra["Infra adapters"]
    Pipeline --> Skill["Generated repo-local skill artifacts"]
\`\`\`

## Verification Gates

The architecture is protected by:

- \`tests/node/architecture-import-rules.test.mjs\`
- \`tests/node/src-architecture-layout.test.mjs\`
- \`tests/node/site-capability-matrix.test.mjs\`
- \`tests/node/test-coverage-regression.test.mjs\`
- \`npm run test:node:all\`
- \`npm run test:python\`
- \`npm run scan:secrets\`
- \`git diff --check\`
`;
}

function renderReleaseHardeningPlan(context) {
  return `# Release Hardening Plan

Last reviewed: 2026-05-21.

This file is generated by \`tools/generate-project-docs.mjs\`. Update the generator, then run \`npm run docs:generate\`.

## Release Posture

SiteForge releases are evidence-based. Passing local validation does not imply a tag, package version bump, push, PR, publication, live capability claim, or live authenticated validation.

Release scope is source, tests, config, schema, repo-local skills, tools, and durable docs. Runtime outputs, browser profiles, downloaded media, logs, generated run artifacts, raw session material, and unrelated dirty files are excluded.

## Public Surface

- Public CLI: \`siteforge build <url>\`
- Bin path: \`src/entrypoints/cli/index.mjs\`
- Internal runtime dispatch: \`src/entrypoints/pipeline/run-pipeline.mjs\`
- Site workspace: \`.siteforge/sites/<site_id>/\`

## Versioned Config

- \`config/site-registry.json\` schemaVersion: ${context.registrySchemaVersion}
- \`config/site-capabilities.json\` schemaVersion: ${context.capabilitiesSchemaVersion}
- Public config hosts:

${renderHostBullets(context.hosts)}

## Canonical Verification Commands

Run from \`C:\\Users\\lyt-p\\Desktop\\SiteForge\`:

\`\`\`powershell
npm run check:syntax
npm run test:node:focused
npm run test:node:all
npm run test:python
npm run scan:secrets
git diff --check
\`\`\`

The wrapper for local release validation is:

\`\`\`powershell
npm run release:local
\`\`\`

Use \`npm run clean:outputs\` before staging when tests or local build probes create ignored runtime directories.

## Risk Map

| Risk area | Highest-risk modules | Required evidence |
| --- | --- | --- |
| CLI boundary | \`src/entrypoints/cli/\`, \`src/infra/cli/command-map.mjs\` | CLI compatibility and public-copy tests. |
| Pipeline artifacts | \`src/app/pipeline/\`, \`src/domain/artifacts/\` | Build/output validation, artifact guard, and redaction tests. |
| Compiler and Planner | \`src/app/compiler/\`, \`src/app/planner/\`, \`src/domain/policies/\` | Compiler, planner, StandardTaskList, and DownloadPolicy tests. |
| Schema governance | \`src/domain/schemas/\`, \`schema/\`, \`config/\` | Schema inventory, compatibility registry, and config-loader tests. |
| SiteAdapter contracts | \`src/sites/adapters/\`, \`src/sites/registry/\` | SiteAdapter contract and architecture import tests. |
| Session/auth safety | \`src/infra/auth/\`, \`src/domain/sessions/\` | SessionView, trust-boundary, redaction, and secret scan. |
| Retired layers | deleted Web UI and shared download runtime paths | Architecture import rules and source-layout tests. |

## Stop Conditions

Stop and report instead of continuing when:

- Raw credentials, cookies, CSRF values, authorization headers, SESSDATA, tokens, session ids, browser profile paths, or user data directories appear in a candidate artifact or diff.
- CAPTCHA, MFA, platform-risk, rate-limit, permission, or access-control pages would require bypass behavior.
- A public command other than \`siteforge build <url>\` is needed without an explicit product decision.
- A matrix status would be promoted without focused verification evidence.
- A live validation claim depends on an unapproved or unsanitized run.
`;
}

async function main(argv = process.argv.slice(2)) {
  const check = argv.includes('--check');
  const context = await loadContext();
  const mismatches = [];
  for (const [relativePath, renderer] of OUTPUTS) {
    const targetPath = path.join(REPO_ROOT, relativePath);
    const nextText = renderer(context).replace(/\r\n/gu, '\n');
    if (check) {
      const currentText = (await readFile(targetPath, 'utf8')).replace(/\r\n/gu, '\n');
      if (currentText !== nextText) {
        mismatches.push(relativePath);
      }
      continue;
    }
    await writeFile(targetPath, nextText, 'utf8');
    console.log(`generated ${asPosixPath(relativePath)}`);
  }
  if (mismatches.length) {
    throw new Error(`Generated docs are stale: ${mismatches.join(', ')}`);
  }
  if (check) {
    console.log('generated docs are current');
  }
}

await main();
