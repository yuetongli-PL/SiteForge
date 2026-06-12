// @ts-check

import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const GOAL_DIR = path.resolve('docs/codex-goals/adult-catalog-site-build-evaluation-v1');
const RUN_DIR = path.join(GOAL_DIR, 'build-runs');
const RUN_BUILD = path.resolve('src/entrypoints/build/run-build.mjs');
const PROCESS_TIMEOUT_MS = 8 * 60 * 1000;

const TARGETS = Object.freeze([
  { siteKey: 't-powers', url: 'https://www.t-powers.co.jp/' },
  { siteKey: 'so-agent', url: 'http://so-agent.jp/' },
  { siteKey: 'moodyz', url: 'https://moodyz.com/top' },
  { siteKey: 'dahlia', url: 'https://dahlia-av.jp/' },
  { siteKey: 'sod', url: 'https://www.sod.co.jp/' },
  { siteKey: 's1', url: 'https://s1s1s1.com/top' },
  { siteKey: 'attackers', url: 'https://attackers.net/top' },
  { siteKey: 'km-produce', url: 'https://www.km-produce.com/' },
  { siteKey: 'rookie', url: 'https://rookie-av.jp/top' },
  { siteKey: 'madonna', url: 'https://madonna-av.com/top' },
  { siteKey: 'dogma', url: 'http://www.dogma.co.jp/' },
]);

function buildArgs(url) {
  return [
    RUN_BUILD,
    url,
    '--auto',
    '--deep',
    '--network',
    '--no-render-js',
    '--privacy',
    'strict',
    '--report',
    'user',
    '--json',
    '--no-tty',
    '--timeout',
    '20000',
    '--max-pages',
    '80',
    '--max-depth',
    '3',
    '--max-seeds',
    '2000',
  ];
}

function parseJsonOutput(text) {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function reportPathFromParsed(parsed) {
  return parsed?.user?.build_completion?.report_path
    ?? parsed?.build_completion?.report_path
    ?? parsed?.artifacts?.['build_report.user.json']
    ?? null;
}

function summarizeParsed(parsed) {
  const user = parsed?.user ?? parsed ?? {};
  const completion = user.build_completion ?? {};
  return {
    resultStatus: parsed?.result_status ?? user.result_status ?? null,
    legacyStatus: user.legacy_status ?? parsed?.legacy_status ?? null,
    reasonCode: user.reason_code ?? parsed?.reasonCode ?? parsed?.reason_code ?? null,
    buildId: parsed?.build_id ?? user.build_id ?? null,
    skillId: parsed?.skill_id ?? user.skill_id ?? null,
    siteId: user.site?.id ?? parsed?.siteId ?? null,
    reportPath: reportPathFromParsed(parsed),
    currentUpdated: completion.current_updated ?? null,
    registryRegistered: completion.registry_registered ?? null,
    verificationStatus: completion.verification_status ?? null,
    activeCapabilities: user.capability_summary?.active ?? null,
    capabilityTotal: user.capability_summary?.total ?? user.counts?.capabilities_total ?? null,
    intentsTotal: user.counts?.intents_total ?? null,
    publicPages: user.coverage?.public?.pages ?? null,
    warningCodes: user.privacy_summary?.warning_codes ?? parsed?.warningCodes ?? [],
  };
}

function runCommand(args) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn(process.execPath, args, {
      cwd: process.cwd(),
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
    }, PROCESS_TIMEOUT_MS);
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({
        code,
        signal,
        stdout,
        stderr,
        durationMs: Date.now() - startedAt,
        timedOut: signal === 'SIGTERM',
      });
    });
  });
}

async function main() {
  await mkdir(RUN_DIR, { recursive: true });
  const summaries = [];
  for (const target of TARGETS) {
    const args = buildArgs(target.url);
    process.stdout.write(`[adult-catalog-build] ${target.siteKey} ${target.url}\n`);
    const result = await runCommand(args);
    const stdoutPath = path.join(RUN_DIR, `${target.siteKey}.stdout.json`);
    const stderrPath = path.join(RUN_DIR, `${target.siteKey}.stderr.txt`);
    await writeFile(stdoutPath, result.stdout, 'utf8');
    await writeFile(stderrPath, result.stderr, 'utf8');
    const parsed = parseJsonOutput(result.stdout);
    const summary = {
      siteKey: target.siteKey,
      url: target.url,
      command: [process.execPath, ...args].join(' '),
      exitCode: result.code,
      signal: result.signal,
      timedOut: result.timedOut,
      durationMs: result.durationMs,
      stdoutPath: path.relative(process.cwd(), stdoutPath).replace(/\\/gu, '/'),
      stderrPath: path.relative(process.cwd(), stderrPath).replace(/\\/gu, '/'),
      parsed: Boolean(parsed),
      ...summarizeParsed(parsed),
    };
    summaries.push(summary);
    process.stdout.write(`[adult-catalog-build] ${target.siteKey} exit=${result.code} status=${summary.resultStatus ?? 'unknown'} report=${summary.reportPath ?? 'none'}\n`);
  }
  const summaryPath = path.join(GOAL_DIR, 'build-run-summary.json');
  await writeFile(summaryPath, `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    targets: summaries,
  }, null, 2)}\n`, 'utf8');
  process.stdout.write(`[adult-catalog-build] summary ${path.relative(process.cwd(), summaryPath).replace(/\\/gu, '/')}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error?.stack ?? error?.message ?? String(error)}\n`);
  process.exitCode = 1;
});
