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
    throw new Error('site-registry and site-capabilities host order must match before README generation.');
  }
  return {
    hosts,
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

The source tree keeps a clean dependency direction: entrypoints feed application modules, application modules use domain contracts, site adapters own site-specific interpretation, and infrastructure supplies IO, browser, auth, and process adapters.

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

Release readiness is evidence-based, not date-based. No tag, package version bump, push, PR, publication, live capability claim, or live authenticated validation is implied by local tests passing.

Contract versions are governed by compatibility evidence in schema inventory and compatibility registry tests. Additive compatible fields keep the current schema or artifact version. Incompatible persisted or public contract changes require an explicit version bump and matching tests.
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
    throw new Error(`Generated README is stale: ${mismatches.join(', ')}`);
  }
  if (check) {
    console.log('generated README is current');
  }
}

await main();
