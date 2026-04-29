// @ts-check

import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { initializeCliUtf8, writeJsonStdout } from '../../infra/cli.mjs';
import {
  actionSessionMetadataFromOptions,
  readSessionRunManifest,
  sessionOptionsFromRunManifest,
} from '../../sites/sessions/manifest-bridge.mjs';
import { runXiaohongshuAction } from '../../sites/xiaohongshu/actions/router.mjs';

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
  const request = await buildXiaohongshuActionRequest(parsed);
  const sessionMetadata = await actionSessionMetadataFromOptions(parsed, {
    siteKey: 'xiaohongshu',
    host: 'www.xiaohongshu.com',
  });
  const result = {
    ...await runXiaohongshuAction(request),
    ...sessionMetadata,
  };
  const outputFormat = String(parsed.outputFormat || 'json').trim().toLowerCase();
  if (outputFormat === 'markdown') {
    process.stdout.write(result?.download?.reportMarkdown || result?.markdown || '');
  } else {
    writeJsonStdout(selectCliPayload(result, parsed.output));
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
