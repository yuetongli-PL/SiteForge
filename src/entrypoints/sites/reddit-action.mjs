// @ts-check

import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { initializeCliUtf8, writeJsonStdout } from '../../infra/cli.mjs';
import {
  buildRedditApiRequestPlan,
  buildRedditAuthorizedSourceConfig,
  buildRedditComprehensiveCoverageReport,
  buildRedditCoverageAudit,
  buildRedditRuntimePlanIndex,
  countRedditRegisteredRuntimePlans,
  executeRedditApiReadPlan,
  findRedditApiOperation,
  loadRedditJsonArtifact,
  loadRedditOfficialApiCatalog,
  resolveRedditCredentialEnv,
  writeRedditApiCatalogArtifacts,
  writeRedditAuthorizedSourceConfigArtifacts,
  writeRedditComprehensiveCoverageReportArtifacts,
  writeRedditCoverageAuditArtifacts,
  writeRedditApiPlanArtifact,
  writeRedditRuntimePlanIndexArtifacts,
  writeRedditRuntimeSkillRegistration,
} from '../../sites/known-sites/reddit/api-catalog.mjs';

const HELP = `Internal script usage:
  node src/entrypoints/sites/reddit-action.mjs api-catalog [options]
  node src/entrypoints/sites/reddit-action.mjs api-plan --path /api/v1/me --method GET [options]
  node src/entrypoints/sites/reddit-action.mjs api-read --path /api/v1/me --method GET [options]
  node src/entrypoints/sites/reddit-action.mjs api-runtime-index [options]
  node src/entrypoints/sites/reddit-action.mjs api-runtime-register --site-dir <dir> [options]
  node src/entrypoints/sites/reddit-action.mjs authorized-source-config [options]
  node src/entrypoints/sites/reddit-action.mjs coverage-audit [options]
  node src/entrypoints/sites/reddit-action.mjs comprehensive-report [options]

Public command:
  siteforge build https://www.reddit.com/

Options:
  --source <file>             Parse a saved Reddit /dev/api/ HTML file instead of fetching live docs.
  --out-dir <dir>             Write redacted JSON/Markdown artifacts.
  --manifest <file>           Include a SiteForge authorized_source_manifest.json.
  --build-report <file>       Include a SiteForge build_report.user.json.
  --coverage-audit <file>     Include reddit_link_function_api_coverage_audit.json.
  --runtime-index <file>      Include reddit_oauth_api_runtime_plan_index.json.
  --cookie-build-report <file> Include the cookie build report.
  --browser-build-report <file> Include the Browser Bridge build report.
  --public-build-report <file> Include the public-only build report.
  --authorized-source-build-report <file> Include an authorized-source-only build report.
  --session-manifest <file>   Include session health manifest.
  --doctor-report <file>      Include site-doctor report.
  --registry <file>           Include or update a SiteForge registry.json.
  --site-dir <dir>            SiteForge site directory for api-runtime-register.
  --skill-dir <dir>           Runtime skill directory for api-runtime-register.
  --limit <n>                 Limit concrete runtime plans during registration.
  --robots-disallow-all       Record current generic robots crawl as blocked.
  --id <operation-id>         Select an operation id from the catalog.
  --anchor-id <anchor-id>     Select a Reddit docs anchor id.
  --path <template>           Select a path template, for example /api/v1/me.
  --method <GET|POST|...>     Select method when using --path.
  --param name=value          Path parameter value. Repeatable.
  --query name=value          Query parameter value. Repeatable.
  --template-index <n>        For optional subreddit paths, choose expanded endpoint template.
  --execute                   Execute api-plan when it is a read-only GET plan.
  --json                      Output JSON.
  -h, --help                  Show this help.

Execution requires SITEFORGE_REDDIT_BEARER_TOKEN or REDDIT_BEARER_TOKEN and
SITEFORGE_REDDIT_USER_AGENT or REDDIT_USER_AGENT. Tokens are never persisted.
`;

function appendFlag(flags, key, value) {
  if (!(key in flags)) {
    flags[key] = value;
    return;
  }
  if (Array.isArray(flags[key])) {
    flags[key].push(value);
    return;
  }
  flags[key] = [flags[key], value];
}

function lastValue(flags, key, fallback = undefined) {
  const value = flags[key];
  if (Array.isArray(value)) {
    return value[value.length - 1] ?? fallback;
  }
  return value ?? fallback;
}

function parsePairs(value) {
  const entries = Array.isArray(value) ? value : value === undefined ? [] : [value];
  const result = {};
  for (const entry of entries) {
    const text = String(entry ?? '').trim();
    if (!text) {
      continue;
    }
    const eq = text.indexOf('=');
    if (eq === -1) {
      result[text] = '';
    } else {
      result[text.slice(0, eq)] = text.slice(eq + 1);
    }
  }
  return result;
}

export function parseRedditActionArgs(argv = process.argv.slice(2)) {
  const args = [...argv];
  const positionals = [];
  const flags = {};
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === '-h') {
      appendFlag(flags, 'help', true);
      continue;
    }
    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }
    const [rawKey, inlineValue] = token.split('=', 2);
    const key = rawKey.replace(/^--/u, '');
    if (inlineValue !== undefined) {
      appendFlag(flags, key, inlineValue);
      continue;
    }
    const next = args[index + 1];
    if (next && !next.startsWith('--')) {
      appendFlag(flags, key, next);
      index += 1;
    } else {
      appendFlag(flags, key, true);
    }
  }
  return {
    help: flags.help === true,
    action: String(positionals[0] ?? lastValue(flags, 'action', 'api-catalog')).trim().toLowerCase(),
    sourcePath: lastValue(flags, 'source', lastValue(flags, 'source-path')),
    outDir: lastValue(flags, 'out-dir', lastValue(flags, 'run-dir')),
    manifestPath: lastValue(flags, 'manifest', lastValue(flags, 'authorized-source-manifest')),
    buildReportPath: lastValue(flags, 'build-report', lastValue(flags, 'build-report-path')),
    coverageAuditPath: lastValue(flags, 'coverage-audit', lastValue(flags, 'coverage-audit-path')),
    runtimeIndexPath: lastValue(flags, 'runtime-index', lastValue(flags, 'runtime-index-path')),
    cookieBuildReportPath: lastValue(flags, 'cookie-build-report', lastValue(flags, 'cookie-build-report-path')),
    browserBuildReportPath: lastValue(flags, 'browser-build-report', lastValue(flags, 'browser-build-report-path')),
    publicBuildReportPath: lastValue(flags, 'public-build-report', lastValue(flags, 'public-build-report-path')),
    authorizedSourceBuildReportPath: lastValue(
      flags,
      'authorized-source-build-report',
      lastValue(flags, 'authorized-source-build-report-path'),
    ),
    sessionManifestPath: lastValue(flags, 'session-manifest', lastValue(flags, 'session-manifest-path')),
    doctorReportPath: lastValue(flags, 'doctor-report', lastValue(flags, 'doctor-report-path')),
    registryPath: lastValue(flags, 'registry', lastValue(flags, 'registry-path')),
    siteDir: lastValue(flags, 'site-dir', lastValue(flags, 'site-path')),
    skillDir: lastValue(flags, 'skill-dir', lastValue(flags, 'runtime-skill-dir')),
    limit: lastValue(flags, 'limit') === undefined ? null : Number(lastValue(flags, 'limit')),
    robotsDisallowAll: flags['robots-disallow-all'] === true,
    id: lastValue(flags, 'id', lastValue(flags, 'operation-id')),
    anchorId: lastValue(flags, 'anchor-id', lastValue(flags, 'anchor')),
    pathTemplate: lastValue(flags, 'path', lastValue(flags, 'endpoint')),
    method: lastValue(flags, 'method'),
    pathParams: parsePairs(flags.param),
    query: parsePairs(flags.query),
    templateIndex: Number(lastValue(flags, 'template-index', 0)) || 0,
    execute: flags.execute === true,
    outputFormat: flags.json === true ? 'json' : String(lastValue(flags, 'format', 'json')).toLowerCase(),
  };
}

async function buildCatalog(options, deps = /** @type {any} */ ({})) {
  return await loadRedditOfficialApiCatalog({
    sourcePath: options.sourcePath,
    fetchImpl: deps.fetchImpl,
  });
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function redditCatalogFromCoverageAudit(coverageAudit = null) {
  const operations = asArray(coverageAudit?.apiOperationCoverage).map((operation) => ({
    id: operation?.id ?? null,
    anchorId: operation?.anchorId ?? null,
    method: operation?.method ?? null,
    pathTemplate: operation?.pathTemplate ?? null,
    section: operation?.section ?? null,
    oauthScopes: asArray(operation?.oauthScopes),
    oauthEndpointTemplates: asArray(operation?.endpointTemplates ?? operation?.oauthEndpointTemplates),
    safety: operation?.safety ?? null,
  }));
  if (!operations.length) {
    return null;
  }
  return {
    sourceReferences: coverageAudit?.sourceReferences ?? [],
    operations,
    operationCount: operations.length,
    methodCounts: coverageAudit?.summary?.apiMethodCounts ?? null,
    oauthScopeCounts: {},
    templateExpansionSummary: {
      oauthEndpointTemplateCount: Number(coverageAudit?.summary?.oauthEndpointTemplates ?? 0) || 0,
    },
    executableSummary: {
      runtimeReadyApiRequestPlans: Number(coverageAudit?.summary?.runtimeReadyApiRequestPlans ?? 0) || 0,
    },
  };
}

function selectOperation(catalog, options) {
  const operation = findRedditApiOperation(catalog, {
    id: options.id,
    anchorId: options.anchorId,
    method: options.method,
    pathTemplate: options.pathTemplate,
  });
  if (!operation) {
    throw new Error('Reddit API operation not found; provide --id, --anchor-id, or --path with --method.');
  }
  return operation;
}

export async function runRedditAction(options = /** @type {any} */ ({}), deps = /** @type {any} */ ({})) {
  const action = String(options.action ?? 'api-catalog').trim().toLowerCase();
  if (action === 'api-catalog' || action === 'catalog') {
    const catalog = await buildCatalog(options, deps);
    const artifacts = options.outDir ? await writeRedditApiCatalogArtifacts(catalog, options.outDir) : null;
    return {
      ok: true,
      siteKey: 'reddit',
      action: 'api-catalog',
      catalog: {
        operationCount: catalog.operationCount,
        methodCounts: catalog.methodCounts,
        oauthScopeCounts: catalog.oauthScopeCounts,
        templateExpansionSummary: catalog.templateExpansionSummary,
        executableSummary: catalog.executableSummary,
      },
      artifacts,
    };
  }
  if (action === 'coverage-audit' || action === 'coverage' || action === 'audit') {
    const catalog = await buildCatalog(options, deps);
    const authorizedSourceManifest = await loadRedditJsonArtifact(options.manifestPath);
    const buildReport = await loadRedditJsonArtifact(options.buildReportPath);
    const registry = await loadRedditJsonArtifact(options.registryPath);
    const audit = buildRedditCoverageAudit(catalog, {
      authorizedSourceManifest,
      buildReport,
      registeredRuntimePlanCount: registry ? countRedditRegisteredRuntimePlans(registry) : null,
      robots: {
        disallowAllForGenericUserAgent: options.robotsDisallowAll === true,
      },
    });
    const artifacts = options.outDir ? await writeRedditCoverageAuditArtifacts(audit, options.outDir) : null;
    return {
      ok: true,
      siteKey: 'reddit',
      action: 'coverage-audit',
      audit: {
        summary: audit.summary,
        status: audit.status,
        requirementAudit: audit.requirementAudit,
      },
      artifacts,
    };
  }
  if (action === 'authorized-source-config' || action === 'authorized-sources' || action === 'source-config') {
    const catalog = await buildCatalog(options, deps);
    const config = buildRedditAuthorizedSourceConfig(catalog);
    const artifacts = options.outDir ? await writeRedditAuthorizedSourceConfigArtifacts(config, options.outDir) : null;
    return {
      ok: true,
      siteKey: 'reddit',
      action: 'authorized-source-config',
      config: {
        summary: config.summary,
        localConfigWritten: Boolean(artifacts?.localConfigPath),
      },
      artifacts,
    };
  }
  if (action === 'comprehensive-report' || action === 'comprehensive' || action === 'execution-coverage') {
    const coverageAudit = await loadRedditJsonArtifact(options.coverageAuditPath);
    let catalog = null;
    try {
      catalog = await buildCatalog(options, deps);
    } catch (error) {
      catalog = redditCatalogFromCoverageAudit(coverageAudit);
      if (!catalog) {
        throw error;
      }
    }
    const runtimeIndex = await loadRedditJsonArtifact(options.runtimeIndexPath);
    const registry = await loadRedditJsonArtifact(options.registryPath);
    const authorizedSourceManifest = await loadRedditJsonArtifact(options.manifestPath);
    const buildReport = await loadRedditJsonArtifact(options.buildReportPath);
    const cookieBuildReport = await loadRedditJsonArtifact(options.cookieBuildReportPath);
    const browserBuildReport = await loadRedditJsonArtifact(options.browserBuildReportPath);
    const publicBuildReport = await loadRedditJsonArtifact(options.publicBuildReportPath ?? options.buildReportPath);
    const authorizedSourceBuildReport = await loadRedditJsonArtifact(options.authorizedSourceBuildReportPath);
    const sessionManifest = await loadRedditJsonArtifact(options.sessionManifestPath);
    const doctorReport = await loadRedditJsonArtifact(options.doctorReportPath);
    const report = buildRedditComprehensiveCoverageReport(catalog, {
      coverageAudit,
      runtimeIndex,
      registry,
      authorizedSourceManifest,
      cookieBuildReport,
      browserBuildReport,
      publicBuildReport,
      authorizedSourceBuildReport,
      sessionManifest,
      doctorReport,
      robots: {
        disallowAllForGenericUserAgent: options.robotsDisallowAll === true,
      },
      buildReport,
    });
    const artifacts = options.outDir ? await writeRedditComprehensiveCoverageReportArtifacts(report, options.outDir) : null;
    return {
      ok: true,
      siteKey: 'reddit',
      action: 'comprehensive-report',
      report: {
        summary: report.summary,
        status: report.status,
        requirementAudit: report.requirementAudit,
      },
      artifacts,
    };
  }
  if (action === 'api-runtime-register' || action === 'runtime-register' || action === 'register-runtime') {
    const catalog = await buildCatalog(options, deps);
    const index = buildRedditRuntimePlanIndex(catalog);
    const registration = await writeRedditRuntimeSkillRegistration({
      index,
      siteDir: options.siteDir,
      registryPath: options.registryPath,
      skillDir: options.skillDir,
      limit: options.limit,
    });
    return {
      ok: true,
      siteKey: 'reddit',
      action: 'api-runtime-register',
      registration,
    };
  }
  if (action === 'api-runtime-index' || action === 'runtime-index' || action === 'plan-index') {
    const catalog = await buildCatalog(options, deps);
    const registry = await loadRedditJsonArtifact(options.registryPath);
    const index = buildRedditRuntimePlanIndex(catalog, {
      registeredRuntimePlanCount: registry ? countRedditRegisteredRuntimePlans(registry) : 0,
    });
    const artifacts = options.outDir ? await writeRedditRuntimePlanIndexArtifacts(index, options.outDir) : null;
    return {
      ok: true,
      siteKey: 'reddit',
      action: 'api-runtime-index',
      runtimeIndex: {
        summary: index.summary,
        runtimeMode: index.runtimeMode,
        authBoundary: index.authBoundary,
      },
      artifacts,
    };
  }
  if (!['api-plan', 'plan', 'api-read', 'read'].includes(action)) {
    throw new Error(`Unsupported Reddit action ${JSON.stringify(action)}.`);
  }
  const catalog = await buildCatalog(options, deps);
  const operation = selectOperation(catalog, options);
  const plan = buildRedditApiRequestPlan(operation, {
    pathParams: options.pathParams,
    query: options.query,
    templateIndex: options.templateIndex,
  });
  const artifacts = options.outDir ? await writeRedditApiPlanArtifact(plan, options.outDir) : null;
  const shouldExecute = action === 'api-read' || action === 'read' || options.execute === true;
  if (!shouldExecute) {
    return {
      ok: true,
      siteKey: 'reddit',
      action: 'api-plan',
      plan,
      artifacts,
    };
  }
  const credentials = resolveRedditCredentialEnv(deps.env ?? process.env);
  const execution = await executeRedditApiReadPlan(plan, {
    fetchImpl: deps.fetchImpl,
    bearerToken: credentials.token,
    userAgent: credentials.userAgent,
  });
  return {
    ok: execution.status === 'success',
    siteKey: 'reddit',
    action: 'api-read',
    plan,
    execution: {
      ...execution,
      credentialSource: {
        tokenEnv: credentials.tokenEnv,
        userAgentEnv: credentials.userAgentEnv,
        tokenPersisted: false,
      },
    },
    artifacts,
  };
}

export async function runRedditActionCli(argv = process.argv.slice(2), deps = /** @type {any} */ ({})) {
  initializeCliUtf8();
  const parsed = parseRedditActionArgs(argv);
  if (parsed.help) {
    process.stdout.write(HELP);
    return { help: HELP };
  }
  const result = await runRedditAction(parsed, deps);
  writeJsonStdout(result);
  if (result.ok !== true) {
    process.exitCode = 1;
  }
  return result;
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (entryPath && entryPath === fileURLToPath(import.meta.url)) {
  runRedditActionCli(process.argv.slice(2)).catch((error) => {
    console.error(error?.message ?? String(error));
    process.exitCode = 1;
  });
}
