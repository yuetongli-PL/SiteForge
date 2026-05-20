// @ts-check

import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { initializeCliUtf8, writeJsonStdout } from '../../infra/cli.mjs';
import {
  parseProgressCliOption,
  runSingleStageCliWithProgress,
} from '../../infra/cli/progress-cli.mjs';
import { parseNaturalLanguageSiteLoginRequest } from '../../infra/auth/site-login-natural.mjs';
import { siteLogin } from './site-login.mjs';

const HELP = `Internal script usage:
  node src/entrypoints/sites/nl-site-login.mjs "<request>" [options]

Examples:
  node src/entrypoints/sites/nl-site-login.mjs "login bilibili with visible browser"
  node src/entrypoints/sites/nl-site-login.mjs "keep x.com logged in" --json

Public command:
  siteforge build <url>

Notes:
  - Free-form text is parsed into the existing site-login flow; it does not write credentials into the generated report.
  - Environment variables such as BILIBILI_USERNAME / BILIBILI_PASSWORD are still safer than inline passwords.
`;

export function parseCliArgs(argv) {
  if (!argv.length || argv[0] === '--help' || argv[0] === '-h') {
    return { help: true };
  }

  const requestTokens = [];
  const rest = [];
  let readingOptions = false;
  for (const token of argv) {
    if (!readingOptions && !token.startsWith('--')) {
      requestTokens.push(token);
      continue;
    }
    readingOptions = true;
    rest.push(token);
  }

  if (!requestTokens.length) {
    throw new Error('Missing natural-language login request.');
  }

  const options = {};
  const readValue = (index) => {
    if (index + 1 >= rest.length) {
      throw new Error(`Missing value for ${rest[index]}`);
    }
    return { value: rest[index + 1], nextIndex: index + 1 };
  };

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    const progressOption = parseProgressCliOption(rest, token, index, options);
    if (progressOption.handled) {
      index = progressOption.nextIndex;
      continue;
    }
    switch (token) {
      case '--profile-path': {
        const { value, nextIndex } = readValue(index);
        options.profilePath = value;
        index = nextIndex;
        break;
      }
      case '--out-dir': {
        const { value, nextIndex } = readValue(index);
        options.outDir = value;
        index = nextIndex;
        break;
      }
      case '--browser-path': {
        const { value, nextIndex } = readValue(index);
        options.browserPath = value;
        index = nextIndex;
        break;
      }
      case '--browser-profile-root': {
        const { value, nextIndex } = readValue(index);
        options.browserProfileRoot = value;
        index = nextIndex;
        break;
      }
      case '--user-data-dir': {
        const { value, nextIndex } = readValue(index);
        options.userDataDir = value;
        index = nextIndex;
        break;
      }
      case '--timeout': {
        const { value, nextIndex } = readValue(index);
        options.timeoutMs = value;
        index = nextIndex;
        break;
      }
      case '--manual-timeout': {
        const { value, nextIndex } = readValue(index);
        options.manualLoginTimeoutMs = value;
        index = nextIndex;
        break;
      }
      default:
        throw new Error(`Unknown option: ${token}`);
    }
  }

  return {
    help: false,
    requestText: requestTokens.join(' '),
    options,
  };
}

export async function runNaturalLanguageSiteLogin(requestText, options = {}, deps = {}) {
  const parsed = parseNaturalLanguageSiteLoginRequest(requestText);
  const report = await (deps.siteLogin ?? siteLogin)(parsed.inputUrl, {
    ...parsed.options,
    ...options,
  }, deps.siteLoginDeps ?? {});
  return {
    requestText,
    site: {
      url: parsed.inputUrl,
    },
    parseWarnings: parsed.warnings,
    report,
  };
}

async function runCli() {
  initializeCliUtf8();
  const parsed = parseCliArgs(process.argv.slice(2));
  if (parsed.help) {
    process.stdout.write(`${HELP}\n`);
    return;
  }
  const result = await runSingleStageCliWithProgress({
    inputUrl: 'natural-language-request',
    options: parsed.options,
    taskId: 'nlSiteLogin',
    title: 'Natural-language site login',
    stageId: 'nlSiteLogin',
    stageTitle: 'Parse and run login',
    run: (stageOptions) => runNaturalLanguageSiteLogin(parsed.requestText, stageOptions),
    successMessage: (stageResult) => stageResult?.report?.auth?.status,
    artifacts: (stageResult) => [
      stageResult?.report?.reports?.json ? { label: 'report', path: stageResult.report.reports.json } : null,
    ].filter(Boolean),
    isFailureResult: (stageResult) => !['authenticated', 'session-reused', 'manual-login-complete'].includes(stageResult?.report?.auth?.status),
    failureReason: (stageResult) => stageResult?.report?.auth?.riskCauseCode ?? stageResult?.report?.auth?.status ?? 'login failed',
    failureTitle: 'Natural-language site login requires manual recovery',
    nextStep: 'siteforge build <url>',
  });
  writeJsonStdout(result);
  if (!['authenticated', 'session-reused', 'manual-login-complete'].includes(result.report.auth.status)) {
    process.exitCode = 1;
  }
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (entryPath && entryPath === fileURLToPath(import.meta.url)) {
  runCli().catch((error) => {
    console.error(error?.message ?? String(error));
    process.exitCode = 1;
  });
}
