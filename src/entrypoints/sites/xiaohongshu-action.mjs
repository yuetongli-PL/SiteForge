// @ts-check

import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { initializeCliUtf8 } from '../../infra/cli.mjs';
import {
  createCliProgressRenderer,
  stripProgressCliOptions,
} from '../../infra/cli/progress-cli.mjs';
import {
  actionSessionMetadataFromOptions,
  readSessionRunManifest,
  sessionOptionsFromRunManifest,
} from '../../sites/sessions/manifest-bridge.mjs';
import {
  assertNoForbiddenPatterns,
  prepareRedactedArtifactJsonWithAudit,
  redactValue,
} from '../../sites/capability/security-guard.mjs';
import { reasonCodeSummary } from '../../sites/capability/reason-codes.mjs';
import { runXiaohongshuAction } from '../../sites/xiaohongshu/actions/router.mjs';

export const XIAOHONGSHU_ACTION_HELP = `Usage:
  node src/entrypoints/cli.mjs xiaohongshu action download <note-url|author-url|query> [options]
  node src/entrypoints/cli.mjs xiaohongshu action download --followed-users [options]

Defaults to dry-run behavior unless the underlying action is explicitly
configured to execute downloads.

Options:
  --profile-path <path>             Profile JSON source override.
  --browser-profile-root <path>     Browser profile root for reusable sessions.
  --user-data-dir <path>            Browser user data directory override.
  --out-dir <dir>                   Output directory for action artifacts.
  --timeout <ms>                    Browser/action timeout.
  --dry-run                         Plan downloads without executing media fetches.
  --max-items <n>                   Limit resolved note downloads.
  --author-page-limit <n>           Limit author continuation pages.
  --query <value>                   Add a search query. Can be repeated.
  --followed-users                  Expand followed users into author downloads.
  --followed-user-limit <n>         Limit followed users.
  --author-resume-state <json|@file> Resume author pagination state.
  --session-manifest <path>         Consume a unified runs/session health manifest.
  --session-health-plan             Generate and consume a unified session health manifest first.
  --no-session-health-plan          Use the legacy session provider path.
  --format <json|markdown>          Output format. Default: json.
  --output <full|summary|download>  Output payload shape. Default: full.
  --json                            Suppress human progress; output remains JSON unless --format markdown is used.
  --quiet                           Suppress human progress on stderr.
  --progress <mode>                 auto | interactive | plain.
  --force-tty                       Force interactive progress.
  --no-tty                          Force plain progress.
  -h, --help                        Show this help.
`;

function normalizeStringList(value) {
  return (Array.isArray(value) ? value : value === undefined || value === null ? [] : [value])
    .flatMap((item) => String(item ?? '').split(','))
    .map((item) => item.trim())
    .filter(Boolean);
}

function toArray(value) {
  return Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
}

function readInlineJsonValue(value) {
  const normalizedValue = String(value ?? '').trim();
  if (!normalizedValue) {
    return null;
  }
  const jsonText = normalizedValue.startsWith('@')
    ? readFileSync(path.resolve(normalizedValue.slice(1)), 'utf8')
    : normalizedValue;
  return JSON.parse(jsonText);
}

function parseAuthorResumeStateFlag(value) {
  const parsedValues = toArray(value)
    .map((entry) => readInlineJsonValue(entry))
    .flatMap((entry) => Array.isArray(entry) ? entry : [entry])
    .filter((entry) => entry && typeof entry === 'object');
  if (!parsedValues.length) {
    return undefined;
  }
  return parsedValues.length === 1 ? parsedValues[0] : parsedValues;
}

export function parseXiaohongshuActionArgs(argv = process.argv.slice(2)) {
  const args = [...argv];
  const positionals = [];
  const flags = {};
  const appendFlag = (key, value) => {
    if (!(key in flags)) {
      flags[key] = value;
      return;
    }
    if (Array.isArray(flags[key])) {
      flags[key].push(value);
      return;
    }
    flags[key] = [flags[key], value];
  };
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === '-h') {
      appendFlag('help', true);
      continue;
    }
    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }
    const [key, inlineValue] = token.split('=', 2);
    const normalizedKey = key.replace(/^--/, '');
    if (inlineValue !== undefined) {
      appendFlag(normalizedKey, inlineValue);
      continue;
    }
    const next = args[index + 1];
    if (next && !next.startsWith('--')) {
      appendFlag(normalizedKey, next);
      index += 1;
    } else {
      appendFlag(normalizedKey, true);
    }
  }
  const action = positionals[0] ?? 'download';
  const items = positionals.slice(1);
  return {
    help: flags.help === true,
    action,
    items,
    profilePath: flags['profile-path'] ? String(flags['profile-path']) : null,
    pythonPath: flags['python-path'] ? String(flags['python-path']) : undefined,
    browserPath: flags['browser-path'] ? String(flags['browser-path']) : undefined,
    browserProfileRoot: flags['browser-profile-root'] ? String(flags['browser-profile-root']) : undefined,
    userDataDir: flags['user-data-dir'] ? String(flags['user-data-dir']) : undefined,
    outDir: flags['out-dir'] ? String(flags['out-dir']) : undefined,
    timeoutMs: flags.timeout ? Number(flags.timeout) : undefined,
    headless: flags.headless === true ? true : flags['no-headless'] === true ? false : undefined,
    reuseLoginState: flags['no-reuse-login-state'] === true ? false : flags['reuse-login-state'] === true ? true : undefined,
    autoLogin: flags['no-auto-login'] === true ? false : flags['auto-login'] === true ? true : undefined,
    sessionManifest: flags['session-manifest'] ? String(flags['session-manifest']) : undefined,
    sessionProvider: flags['session-provider'] ? String(flags['session-provider']) : undefined,
    useUnifiedSessionHealth: flags['no-session-health-plan'] === true
      ? false
      : flags['session-health-plan'] === true
        ? true
        : undefined,
    output: flags.output ? String(flags.output) : 'full',
    outputFormat: flags.format ? String(flags.format) : 'json',
    json: flags.json === true,
    quiet: flags.quiet === true,
    progressMode: flags.progress ? String(flags.progress) : undefined,
    forceTty: flags['force-tty'] === true,
    noTty: flags['no-tty'] === true,
    followedUsers: flags['followed-users'] === true,
    followedUserLimit: flags['followed-user-limit'] ? Number(flags['followed-user-limit']) : undefined,
    download: {
      dryRun: flags['dry-run'] === true,
      maxItems: flags['max-items'] ? Number(flags['max-items']) : undefined,
      authorPageLimit: flags['author-page-limit'] ? Number(flags['author-page-limit']) : undefined,
    },
    queries: normalizeStringList(flags.query ?? []),
    authorResumeState: parseAuthorResumeStateFlag(flags['author-resume-state']),
  };
}

function selectCliPayload(result, outputMode) {
  const mode = String(outputMode || 'full').trim().toLowerCase();
  if (mode === 'summary') {
    return result?.actionSummary || result;
  }
  if (mode === 'download') {
    return result?.download
      ? {
        ...result.download,
        sessionProvider: result.sessionProvider,
        sessionHealth: result.sessionHealth ?? null,
      }
      : result;
  }
  return result;
}

function toXiaohongshuActionCliOutputRedactionFailure(error) {
  const recovery = reasonCodeSummary('redaction-failed');
  const failure = new Error('Xiaohongshu action CLI output redaction failed');
  failure.name = 'XiaohongshuActionCliOutputRedactionFailure';
  failure.code = 'redaction-failed';
  failure.reasonCode = 'redaction-failed';
  failure.retryable = recovery.retryable;
  failure.cooldownNeeded = recovery.cooldownNeeded;
  failure.isolationNeeded = recovery.isolationNeeded;
  failure.manualRecoveryNeeded = recovery.manualRecoveryNeeded;
  failure.degradable = recovery.degradable;
  failure.artifactWriteAllowed = recovery.artifactWriteAllowed;
  failure.catalogAction = recovery.catalogAction;
  failure.diagnosticWriteAllowed = false;
  failure.causeSummary = {
    name: error?.name ?? 'Error',
    code: error?.code ?? null,
  };
  return failure;
}

export function xiaohongshuActionCliJson(payload) {
  try {
    return `${prepareRedactedArtifactJsonWithAudit(payload).json}\n`;
  } catch (error) {
    throw toXiaohongshuActionCliOutputRedactionFailure(error);
  }
}

export function xiaohongshuActionCliMarkdown(markdown, fallbackPayload) {
  try {
    const text = String(markdown ?? '');
    if (!text) {
      return xiaohongshuActionCliJson(fallbackPayload);
    }
    const redacted = String(redactValue(text).value ?? '');
    assertNoForbiddenPatterns(redacted);
    return redacted;
  } catch (error) {
    throw toXiaohongshuActionCliOutputRedactionFailure(error);
  }
}

export async function buildXiaohongshuActionRequest(parsed) {
  const items = [...parsed.items, ...parsed.queries];
  const sessionManifestOptions = parsed.sessionManifest
    ? sessionOptionsFromRunManifest(
      await readSessionRunManifest(path.resolve(parsed.sessionManifest)),
      {
        siteKey: 'xiaohongshu',
        host: 'www.xiaohongshu.com',
      },
    )
    : {};
  return {
    action: parsed.action,
    items,
    profilePath: parsed.profilePath,
    pythonPath: parsed.pythonPath,
    browserPath: parsed.browserPath,
    browserProfileRoot: parsed.browserProfileRoot,
    userDataDir: parsed.userDataDir,
    outDir: parsed.outDir,
    timeoutMs: parsed.timeoutMs,
    headless: parsed.headless,
    reuseLoginState: parsed.reuseLoginState,
    autoLogin: parsed.autoLogin,
    sessionManifest: parsed.sessionManifest,
    sessionProvider: parsed.sessionProvider,
    useUnifiedSessionHealth: parsed.useUnifiedSessionHealth,
    followedUsers: parsed.followedUsers,
    followedUserLimit: parsed.followedUserLimit,
    download: parsed.download,
    authorResumeState: parsed.authorResumeState,
    ...sessionManifestOptions,
  };
}

export async function runXiaohongshuActionCli(argv = process.argv.slice(2)) {
  initializeCliUtf8();
  const parsed = parseXiaohongshuActionArgs(argv);
  if (parsed.help) {
    process.stdout.write(XIAOHONGSHU_ACTION_HELP);
    return { help: XIAOHONGSHU_ACTION_HELP };
  }
  const request = await buildXiaohongshuActionRequest(parsed);
  const progress = createCliProgressRenderer({
    ...parsed,
    json: parsed.json || String(parsed.outputFormat || 'json').toLowerCase() === 'json',
  });
  const task = progress.task({
    id: 'xiaohongshuAction',
    title: 'Xiaohongshu action',
    totalStages: 1,
    item: parsed.items?.[0] ?? parsed.queries?.[0] ?? parsed.action,
  });
  const stage = task.stage({
    id: parsed.action,
    title: `Run ${parsed.action}`,
    index: 1,
    total: 1,
    item: parsed.items?.[0] ?? parsed.queries?.[0] ?? parsed.action,
  });
  const sessionMetadata = await actionSessionMetadataFromOptions(parsed, {
    siteKey: 'xiaohongshu',
    host: 'www.xiaohongshu.com',
  });
  let result;
  try {
    result = {
      ...await runXiaohongshuAction(stripProgressCliOptions(request)),
      ...sessionMetadata,
    };
    const message = result?.ok === true ? 'ok' : (result?.reason ?? result?.status ?? 'failed');
    if (result?.ok === true) {
      stage.succeed({ message });
      task.succeed({ message });
    } else {
      stage.fail({ message });
      task.fail({ message });
      progress.failure({
        taskId: 'xiaohongshuAction',
        title: 'Xiaohongshu action failed',
        stage: `Run ${parsed.action}`,
        reason: message,
        nextStep: 'node src/entrypoints/cli.mjs site doctor https://www.xiaohongshu.com/ --no-headless --reuse-login-state',
      });
    }
  } catch (error) {
    const reason = error?.message ?? String(error);
    stage.fail({ message: reason });
    task.fail({ message: reason });
    progress.failure({
      taskId: 'xiaohongshuAction',
      title: 'Xiaohongshu action failed',
      stage: `Run ${parsed.action}`,
      reason,
      nextStep: 'node src/entrypoints/cli.mjs site doctor https://www.xiaohongshu.com/ --no-headless --reuse-login-state',
    });
    throw error;
  }
  const outputFormat = String(parsed.outputFormat || 'json').trim().toLowerCase();
  if (outputFormat === 'markdown') {
    process.stdout.write(xiaohongshuActionCliMarkdown(
      result?.download?.reportMarkdown || result?.markdown || '',
      selectCliPayload(result, parsed.output),
    ));
  } else {
    process.stdout.write(xiaohongshuActionCliJson(selectCliPayload(result, parsed.output)));
  }
  if (result?.ok !== true) {
    process.exitCode = 1;
  }
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (entryPath && entryPath === fileURLToPath(import.meta.url)) {
  runXiaohongshuActionCli().catch((error) => {
    console.error(error?.message ?? String(error));
    process.exitCode = 1;
  });
}
