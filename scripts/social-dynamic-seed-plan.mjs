// @ts-check

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const DEFAULT_REPORT_PATH = path.join('runs', 'social-live-report', 'social-live-report.json');

const COMMON_HANDLE_SLUGS = new Map([
  ['openaidevs', 'OpenAIDevs'],
  ['openai', 'OpenAI'],
  ['dotey', 'dotey'],
  ['geekbb', 'geekbb'],
  ['gdb', 'gdb'],
  ['advancedcskills', 'advancedcskills'],
]);

const ROUTE_TOKENS = new Set([
  'about',
  'accessibility',
  'account',
  'analytics',
  'app',
  'articles',
  'audio',
  'communities',
  'community',
  'crawl40',
  'deep',
  'depth2',
  'detail',
  'dyn',
  'explore',
  'followers',
  'follow',
  'fresh',
  'fresh2',
  'fresh3',
  'fresh5',
  'fresh6',
  'internal',
  'legacy',
  'likes',
  'list',
  'lists',
  'media',
  'members',
  'photo',
  'post',
  'posts',
  'probe',
  'profile',
  'public',
  'quotes',
  'read',
  'route',
  'search',
  'seed',
  'space',
  'status',
  'top',
  'verified',
  'you',
]);

export const HELP = `Usage:
  node scripts/social-dynamic-seed-plan.mjs --report <social-live-report.json> [--out-dir <dir>]

Generates an internal approval plan for X dynamic route seed expansion.
It does not execute live crawl commands.`;

export function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    reportPath: DEFAULT_REPORT_PATH,
    outDir: null,
    help: false,
    write: true,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '-h' || token === '--help') {
      options.help = true;
    } else if (token === '--report') {
      options.reportPath = argv[++index] ?? options.reportPath;
    } else if (token === '--out-dir') {
      options.outDir = argv[++index] ?? options.outDir;
    } else if (token === '--no-write') {
      options.write = false;
    }
  }
  return options;
}

function isConcrete(value) {
  const text = String(value ?? '').trim();
  return Boolean(text) && !/(^|[/?&=]):[a-z][\w-]*/iu.test(text);
}

function requiredSeedFields(candidate = {}) {
  const route = String(candidate.routeTemplate ?? '').toLowerCase();
  const fields = [];
  if (route.includes(':account') || route.includes(':current_account')) fields.push('account');
  if (route === '/i/status/:id' || route.includes('/status/:id')) fields.push('statusId');
  if (route.includes('/photo/:id')) fields.push('mediaId');
  if (route.includes(':communityid')) fields.push('communityId');
  if (route.includes(':listid')) fields.push('listId');
  if (route === '/i/spaces/:id') fields.push('spaceId');
  if (route.startsWith('/search')) fields.push('query');
  return [...new Set(fields)];
}

function slug(value) {
  return String(value ?? 'seed')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-|-$/gu, '')
    .slice(0, 80) || 'seed';
}

function latestRowsForSurface(rows, surface) {
  return rows
    .filter((row) => row.site === 'x' && row.surface === surface && row.manifestPath)
    .sort((left, right) => String(right.finishedAt ?? '').localeCompare(String(left.finishedAt ?? '')));
}

async function readJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}

async function readItems(runDir) {
  try {
    const text = await readFile(path.join(runDir, 'items.jsonl'), 'utf8');
    return text
      .split(/\r?\n/u)
      .filter(Boolean)
      .slice(0, 50)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function manifestContext(row) {
  const runDir = row?.manifestPath ? path.dirname(row.manifestPath) : null;
  return {
    row,
    runDir,
    manifest: await readJson(row?.manifestPath),
    items: runDir ? await readItems(runDir) : [],
  };
}

function safePlan(manifest) {
  const plan = manifest?.plan ?? {};
  return {
    action: plan.action ?? null,
    routeName: plan.routeName ?? null,
    routePath: plan.routePath ?? null,
    contentType: plan.contentType ?? null,
  };
}

function seedHintsFromRows(surfaceRows) {
  return surfaceRows
    .flatMap((row) => [row.id, path.basename(path.dirname(row.manifestPath ?? ''))])
    .filter(Boolean)
    .map(String)
    .filter((value, index, values) => values.indexOf(value) === index)
    .slice(0, 10);
}

function allDigitsFromHints(hints, min = 6) {
  const re = new RegExp(`\\b\\d{${min},}\\b`, 'gu');
  return hints.flatMap((hint) => [...String(hint).matchAll(re)].map((match) => match[0]));
}

function digitsFromHints(hints, min = 6) {
  return allDigitsFromHints(hints, min)[0] ?? null;
}

function statusIdFromItems(items) {
  for (const item of items) {
    const id = String(item?.id ?? '');
    if (/^\d{15,}$/u.test(id)) return id;
    const match = String(item?.url ?? '').match(/\/status\/(\d{15,})/u);
    if (match) return match[1];
  }
  return null;
}

function accountFromItems(items, statusId = null) {
  for (const item of items) {
    const url = String(item?.url ?? '');
    if (statusId && !url.includes(`/status/${statusId}`) && String(item?.id ?? '') !== String(statusId)) {
      continue;
    }
    const handle = item?.author?.handle
      ?? item?.sourceAccount
      ?? url.match(/x\.com\/([^/]+)\/status\//u)?.[1];
    if (isConcrete(handle)) return String(handle);
  }
  return null;
}

function accountFromHints(hints) {
  for (const hint of hints) {
    const lower = String(hint).toLowerCase();
    for (const [slugValue, handle] of COMMON_HANDLE_SLUGS) {
      if (lower.includes(slugValue)) return handle;
    }
  }
  for (const hint of hints) {
    const tokens = String(hint).split(/[^a-z0-9_]+/iu).filter(Boolean);
    for (const token of tokens) {
      const lower = token.toLowerCase();
      if (ROUTE_TOKENS.has(lower) || /^\d+$/u.test(lower)) continue;
      if (/^[a-z][a-z0-9_]{1,14}$/iu.test(token)) return token;
    }
  }
  return null;
}

function spaceIdFromHints(hints) {
  const values = hints.flatMap((hint) => (
    [...String(hint).matchAll(/\b1[a-zA-Z0-9]{10,14}\b/gu)].map((match) => match[0])
  ));
  return values.find((value) => /[A-Z]/u.test(value)) ?? values[0] ?? null;
}

function mediaIdFromHints(hints) {
  for (const hint of hints) {
    const match = String(hint).match(/-(\d{15,})-(\d+)(?:-|$)/u);
    if (match) return match[2];
  }
  return null;
}

function queryFromHints(hints) {
  return hints.some((hint) => /openai/iu.test(String(hint))) ? 'OpenAI' : null;
}

function recoverSeeds(candidate, contexts, hints) {
  const required = requiredSeedFields(candidate);
  const allItems = contexts.flatMap((context) => context.items ?? []);
  const seeds = {};
  if (required.includes('statusId')) seeds.statusId = digitsFromHints(hints, 15) ?? statusIdFromItems(allItems);
  if (required.includes('account')) seeds.account = accountFromItems(allItems, seeds.statusId) ?? accountFromHints(hints);
  if (required.includes('mediaId')) seeds.mediaId = mediaIdFromHints(hints);
  if (required.includes('communityId')) {
    seeds.communityId = allDigitsFromHints(hints, 15).find((value) => value !== seeds.statusId)
      ?? digitsFromHints(hints, 15);
  }
  if (required.includes('listId')) seeds.listId = digitsFromHints(hints, 6);
  if (required.includes('spaceId')) seeds.spaceId = spaceIdFromHints(hints);
  if (required.includes('query')) seeds.query = queryFromHints(hints);
  return seeds;
}

function pushFlag(args, flag, value) {
  if (isConcrete(value)) args.push(flag, String(value));
}

function routeNeedsRiskReview(candidate, plan) {
  return String(candidate.routeTemplate ?? '').includes('/analytics')
    || String(plan?.routeName ?? '').includes('analytics');
}

function commandArgs(candidate, plan, seeds, missingFields) {
  if (missingFields.length) return null;
  const action = plan?.action || (candidate.surfaces?.[0]?.startsWith('read-route:') ? 'read-route' : null);
  if (!action) return null;
  const args = ['node', 'src/entrypoints/sites/x-action.mjs', action];
  if (action === 'read-route') {
    pushFlag(args, '--route', plan?.routeName ?? plan?.routePath ?? candidate.surfaces?.[0]?.replace(/^read-route:/u, ''));
  } else if (plan?.contentType) {
    pushFlag(args, '--content-type', plan.contentType);
  }
  pushFlag(args, '--account', seeds.account);
  pushFlag(args, '--query', seeds.query);
  pushFlag(args, '--status-id', seeds.statusId);
  pushFlag(args, '--media-id', seeds.mediaId);
  pushFlag(args, '--space-id', seeds.spaceId);
  pushFlag(args, '--community-id', seeds.communityId);
  pushFlag(args, '--list-id', seeds.listId);
  args.push('--reuse-login-state', '--no-session-health-plan', '--no-headless', '--crawl-read-surfaces');
  if (routeNeedsRiskReview(candidate, plan)) args.push('--risk-reviewed-read-surfaces');
  args.push(
    '--max-read-crawl-depth', '1',
    '--max-read-crawl-pages', '10',
    '--max-api-pages', '1',
    '--max-items', '1',
    '--timeout', '120000',
    '--out-dir', '.siteforge/x-live-runs-20260601T0000',
    '--artifact-run-id', `seed-expansion-${slug(candidate.familyKind)}-${slug(candidate.routeTemplate)}`,
    '--json',
    '--quiet',
    '--progress', 'plain',
    '--no-tty',
  );
  return args;
}

export async function buildDynamicSeedExpansionApprovalPlan(report, { reportPath = DEFAULT_REPORT_PATH } = {}) {
  const rows = report.rows ?? [];
  const candidates = (report.coverage?.x?.dynamicSeedExpansion?.candidates ?? [])
    .filter((entry) => entry.userApprovalRequired === true);
  const approvals = [];
  for (const candidate of candidates) {
    const surfaceRows = (candidate.surfaces ?? []).flatMap((surface) => latestRowsForSurface(rows, surface));
    const selectedRow = surfaceRows[0] ?? null;
    const contexts = [];
    for (const row of surfaceRows.slice(0, 8)) {
      contexts.push(await manifestContext(row));
    }
    const plan = safePlan(contexts.find((context) => context.manifest)?.manifest ?? null);
    const hints = seedHintsFromRows(surfaceRows);
    const seeds = recoverSeeds(candidate, contexts, hints);
    const requiredFields = requiredSeedFields(candidate);
    const missingFields = requiredFields.filter((field) => !isConcrete(seeds[field]));
    const args = commandArgs(candidate, plan, seeds, missingFields);
    approvals.push({
      routeTemplate: candidate.routeTemplate,
      familyKind: candidate.familyKind,
      parameters: candidate.parameters ?? [],
      surfaces: candidate.surfaces ?? [],
      seedEvidenceStatus: candidate.seedEvidenceStatus,
      latestStatus: selectedRow?.status ?? null,
      latestReason: selectedRow?.reason ?? null,
      latestFinishedAt: selectedRow?.finishedAt ?? null,
      latestManifestPath: selectedRow?.manifestPath ?? null,
      recoveredConcreteSeeds: {
        account: seeds.account ?? null,
        query: seeds.query ?? null,
        statusId: seeds.statusId ?? null,
        mediaId: seeds.mediaId ?? null,
        spaceId: seeds.spaceId ?? null,
        communityId: seeds.communityId ?? null,
        listId: seeds.listId ?? null,
      },
      existingPlan: { ...plan, ...seeds },
      requiredConcreteSeedFields: requiredFields,
      missingConcreteSeedFields: missingFields,
      observedSeedHints: hints,
      approvalRequiredBeforeExecution: true,
      executableAfterApproval: args !== null,
      suggestedArgs: args,
      suggestedCommand: args?.map((part) => /\s/u.test(part) ? JSON.stringify(part) : part).join(' ') ?? null,
    });
  }
  const families = [...new Set(approvals.map((entry) => entry.familyKind))]
    .sort()
    .map((familyKind) => {
      const entries = approvals.filter((entry) => entry.familyKind === familyKind);
      return {
        familyKind,
        approvalCandidateCount: entries.length,
        executableAfterApprovalCount: entries.filter((entry) => entry.executableAfterApproval).length,
        routeTemplates: entries.map((entry) => entry.routeTemplate),
        missingConcreteSeedFields: [...new Set(entries.flatMap((entry) => entry.missingConcreteSeedFields))].sort(),
        surfaces: [...new Set(entries.flatMap((entry) => entry.surfaces))].sort(),
      };
    });
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    sourceReport: path.resolve(reportPath),
    purpose: 'x-dynamic-route-family-seed-expansion-approval-plan',
    executionPolicy: 'do-not-run-until-user-approves-specific-seeds; recovered seeds come only from current report artifacts and public run ids/items',
    summary: {
      totalRows: report.totalRows,
      controlledScopeClosureReady: report.coverage?.x?.fullSiteBoundary?.controlledScopeClosureReady === true,
      fullSiteExhaustiveClaim: report.coverage?.x?.fullSiteBoundary?.fullSiteExhaustiveClaim === true,
      dynamicSeedCandidateCount: report.coverage?.x?.dynamicSeedExpansion?.candidateCount ?? 0,
      executedDynamicSeedRouteTemplateCount: report.coverage?.x?.dynamicSeedExpansion?.executedDynamicSeedRouteTemplateCount ?? 0,
      approvalRequiredCandidateCount: approvals.length,
      executableAfterApprovalCount: approvals.filter((entry) => entry.executableAfterApproval).length,
      unresolvedConcreteSeedCandidateCount: approvals.filter((entry) => entry.missingConcreteSeedFields.length > 0).length,
      approvalFamilyCount: families.length,
    },
    families,
    approvals,
  };
}

function markdownPlan(plan) {
  return [
    '# X dynamic seed expansion approval plan',
    '',
    `- Generated at: ${plan.generatedAt}`,
    `- Source report: ${plan.sourceReport}`,
    `- Controlled scope ready: ${plan.summary.controlledScopeClosureReady ? 'yes' : 'no'}`,
    `- Full-site exhaustive claim: ${plan.summary.fullSiteExhaustiveClaim ? 'yes' : 'no'}`,
    `- Dynamic seed route templates: ${plan.summary.executedDynamicSeedRouteTemplateCount}/${plan.summary.dynamicSeedCandidateCount} executed`,
    `- Approval-required candidates: ${plan.summary.approvalRequiredCandidateCount}`,
    `- Executable after approval: ${plan.summary.executableAfterApprovalCount}`,
    `- Unresolved concrete seed candidates: ${plan.summary.unresolvedConcreteSeedCandidateCount}`,
    '',
    'Execution policy: do not run these commands until the user approves the concrete seeds. Recovered seeds come only from current report artifacts and public run ids/items.',
    '',
    ...plan.families.flatMap((family) => [
      `## ${family.familyKind}`,
      '',
      `- Candidates: ${family.approvalCandidateCount}`,
      `- Executable after approval: ${family.executableAfterApprovalCount}`,
      `- Missing fields: ${family.missingConcreteSeedFields.length ? family.missingConcreteSeedFields.join(', ') : 'none'}`,
      `- Routes: ${family.routeTemplates.join(', ')}`,
      '',
    ]),
  ].join('\n');
}

export async function writeDynamicSeedExpansionApprovalPlan(options, plan) {
  const outDir = path.resolve(options.outDir ?? path.dirname(options.reportPath));
  await mkdir(outDir, { recursive: true });
  const jsonPath = path.join(outDir, 'dynamic-seed-expansion-plan.json');
  const markdownPath = path.join(outDir, 'dynamic-seed-expansion-plan.md');
  await writeFile(jsonPath, `${JSON.stringify(plan, null, 2)}\n`, 'utf8');
  await writeFile(markdownPath, `${markdownPlan(plan)}\n`, 'utf8');
  return { jsonPath, markdownPath };
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(`${HELP}\n`);
    return;
  }
  const report = JSON.parse(await readFile(options.reportPath, 'utf8'));
  const plan = await buildDynamicSeedExpansionApprovalPlan(report, options);
  if (options.write) {
    const outputs = await writeDynamicSeedExpansionApprovalPlan(options, plan);
    process.stdout.write(`JSON: ${outputs.jsonPath}\nMarkdown: ${outputs.markdownPath}\n`);
  } else {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
  }
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (entryPath && entryPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error?.message ?? String(error));
    process.exitCode = 1;
  });
}
