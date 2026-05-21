#!/usr/bin/env node
// @ts-check

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TOOL_DIR, '..');

const README_OUTPUT = 'README.md';

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

SiteForge turns a public site URL into a local, governed site capability workspace. The public CLI is intentionally small:

\`\`\`bash
siteforge build https://example.com/
\`\`\`

Builds crawl within bounded site rules, compile sanitized evidence into capability contracts, plan descriptor-only actions, and promote verified outputs under \`.siteforge/sites/<site_id>/\`.

## Outputs

- Site workspace: \`.siteforge/sites/<site_id>/\`.
- Capability contracts: pages, risks, sessions, schemas, policies, and supported actions.
- Descriptor-only plans: allowed, blocked, or remediation paths without privileged execution.
- Repo-local Skill material backed by verified capability evidence.

## Architecture

The repository is one package and one public CLI. Dependency direction stays entrypoints -> app -> domain. Pipeline, Compiler, and Planner stay site-agnostic; SiteAdapters own site interpretation; infra supplies IO, browser, auth, network, process, and CLI adapters. Internal Node entrypoints under \`src/entrypoints/\` are operator tools, not public routes.

## Repository Layout

| Path | Responsibility |
| --- | --- |
| \`src/entrypoints/cli/\` | Public CLI facade. |
| \`src/entrypoints/pipeline/\` | Internal stage entrypoints and runtime wiring. |
| \`src/app/pipeline/\` | Build orchestration, lifecycle, recovery, and validation. |
| \`src/app/compiler/\` | Evidence and capability compilation. |
| \`src/app/planner/\` | Descriptor-only plans and policy handoff. |
| \`src/domain/\` | Capability, policy, schema, risk, session, artifact, and lifecycle contracts. |
| \`src/sites/\` | SiteAdapter contracts, known-site helpers, and registries. |
| \`src/infra/\` | Browser, auth, config, filesystem, network, process, and CLI IO. |
| \`config/\` | Versioned stable site registry and capability records. |
| \`schema/\` | Published schema/profile definitions. |
| \`tests/\` | Node and Python tests, fixtures, and regression gates. |
| \`tools/\` | README, release, cleanup, audit, and verification tooling. |

Retired Web UI, shared download runtime, legacy capability, legacy pipeline, and legacy kernel layers stay physically removed and are guarded by architecture tests.

## Supported Public Sites

Stable config currently keeps public records for:

${renderHostBullets(context.hosts)}

Removed internal catalog experiments are not part of the public site registry.

## Verification

Useful local checks:

\`\`\`bash
npm run readme:check
npm run check:syntax
npm run test:node:focused
npm run test:node:all
npm run test:python
npm run scan:secrets
git diff --check
\`\`\`

Focused groups are available as \`npm run test:cli\`, \`npm run test:pipeline\`, \`npm run test:capability\`, and \`npm run test:core\`. Use \`npm run clean:outputs\` to remove local generated site data before staging.

## Safety

- Do not persist raw credentials, cookies, authorization headers, CSRF values, session ids, browser profiles, or tokens.
- Do not implement CAPTCHA bypass, anti-bot bypass, access-control bypass, credential extraction, or silent privilege expansion.
- Do not write generated site data into tracked source.
- Keep generated outputs, logs, downloads, caches, and browser state ignored and removable.

## Release And Versioning

Release readiness is evidence-based. Local tests do not imply a tag, package version bump, push, PR, publication, live capability claim, or live authenticated validation. Incompatible persisted or public contract changes require an explicit version bump and matching tests.
`;
}

async function main(argv = process.argv.slice(2)) {
  const check = argv.includes('--check');
  const context = await loadContext();
  const targetPath = path.join(REPO_ROOT, README_OUTPUT);
  const nextText = renderReadme(context).replace(/\r\n/gu, '\n');
  if (check) {
    const currentText = (await readFile(targetPath, 'utf8')).replace(/\r\n/gu, '\n');
    if (currentText !== nextText) {
      throw new Error(`Generated README is stale: ${README_OUTPUT}`);
    }
    console.log('Generated README is current');
    return;
  }
  await writeFile(targetPath, nextText, 'utf8');
  console.log(`Generated ${asPosixPath(README_OUTPUT)}`);
}

await main();
