// @ts-check

import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { initializeCliUtf8, writeJsonStdout } from '../../infra/cli.mjs';
import {
  createCliProgressRenderer,
  parseProgressCliOption,
  stripProgressCliOptions,
} from '../../infra/cli/progress-cli.mjs';
import { runBilibiliAction } from '../../sites/bilibili/actions/router.mjs';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(MODULE_DIR, '..', '..', '..');

const HELP = `Usage:
  node src/entrypoints/cli.mjs bilibili action open <url> [--profile-path <path>] [--browser-path <path>] [--browser-profile-root <dir>] [--reuse-login-state|--no-reuse-login-state] [--auto-login-bootstrap|--no-auto-login-bootstrap]
  node src/entrypoints/cli.mjs bilibili action download <url-or-bv>... [--out-dir <dir>] [--concurrency <n>] [--max-playlist-items <n>] [--reuse-login-state|--no-reuse-login-state] [--auto-login-bootstrap|--no-auto-login-bootstrap] [--skip-existing] [--retry-failed-only] [--resume|--no-resume] [--dry-run]
  node src/entrypoints/cli.mjs bilibili action login [<url>] [--profile-path <path>] [--browser-path <path>] [--browser-profile-root <dir>] [--reuse-login-state|--no-reuse-login-state]
  node src/entrypoints/cli.mjs bilibili action preflight <url> [--profile-path <path>] [--browser-path <path>] [--browser-profile-root <dir>] [--reuse-login-state|--no-reuse-login-state]
  Add [--json] [--quiet] [--progress auto|interactive|plain] [--force-tty] [--no-tty] to any command.
`;

function readValue(argv, index) {
  if (index + 1 >= argv.length) {
    throw new Error(`Missing value for ${argv[index]}`);
  }
  return { value: argv[index + 1], nextIndex: index + 1 };
}

export function parseCliArgs(argv) {
  if (!argv.length || argv[0] === '--help' || argv[0] === '-h') {
    return { help: true };
  }
  const [action, ...rest] = argv;
  const options = {
    reuseLoginState: true,
    allowAutoLoginBootstrap: true,
  };
  const items = [];
  let targetUrl = null;

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith('--')) {
      if (action === 'download') {
        items.push(token);
      } else if (!targetUrl) {
        targetUrl = token;
      } else {
        throw new Error(`Unexpected positional argument: ${token}`);
      }
      continue;
    }
    const progressOption = parseProgressCliOption(rest, token, index, options);
    if (progressOption.handled) {
      index = progressOption.nextIndex;
      continue;
    }
    switch (token) {
      case '--profile-path': {
        const { value, nextIndex } = readValue(rest, index);
        options.profilePath = value;
        index = nextIndex;
        break;
      }
      case '--browser-path': {
        const { value, nextIndex } = readValue(rest, index);
        options.browserPath = value;
        index = nextIndex;
        break;
      }
      case '--browser-profile-root': {
        const { value, nextIndex } = readValue(rest, index);
        options.browserProfileRoot = value;
        index = nextIndex;
        break;
      }
      case '--user-data-dir': {
        const { value, nextIndex } = readValue(rest, index);
        options.userDataDir = value;
        index = nextIndex;
        break;
      }
      case '--out-dir': {
        const { value, nextIndex } = readValue(rest, index);
        options.outDir = value;
        index = nextIndex;
        break;
      }
      case '--timeout': {
        const { value, nextIndex } = readValue(rest, index);
        options.timeoutMs = Number(value);
        index = nextIndex;
        break;
      }
      case '--reuse-login-state':
        options.reuseLoginState = true;
        break;
      case '--no-reuse-login-state':
        options.reuseLoginState = false;
        break;
      case '--auto-login-bootstrap':
        options.allowAutoLoginBootstrap = true;
        break;
      case '--no-auto-login-bootstrap':
        options.allowAutoLoginBootstrap = false;
        break;
      case '--concurrency': {
        const { value, nextIndex } = readValue(rest, index);
        options.download = { ...(options.download || {}), concurrency: Number(value) };
        index = nextIndex;
        break;
      }
      case '--max-playlist-items': {
        const { value, nextIndex } = readValue(rest, index);
        options.download = { ...(options.download || {}), maxPlaylistItems: Number(value) };
        index = nextIndex;
        break;
      }
      case '--dry-run':
        options.download = { ...(options.download || {}), dryRun: true };
        break;
      case '--skip-existing':
        options.download = { ...(options.download || {}), skipExisting: true };
        break;
      case '--retry-failed-only':
        options.download = { ...(options.download || {}), retryFailedOnly: true };
        break;
      case '--resume':
        options.download = { ...(options.download || {}), resume: true };
        break;
      case '--no-resume':
        options.download = { ...(options.download || {}), resume: false };
        break;
      case '--download-archive': {
        const { value, nextIndex } = readValue(rest, index);
        options.download = { ...(options.download || {}), downloadArchivePath: value };
        index = nextIndex;
        break;
      }
      default:
        throw new Error(`Unknown option: ${token}`);
    }
  }

  if (action !== 'download' && !targetUrl && action !== 'login') {
    throw new Error(`${action} requires a target URL.`);
  }

  return {
    help: false,
    action,
    targetUrl: targetUrl || (action === 'login' ? 'https://www.bilibili.com/' : null),
    items,
    options,
  };
}

export async function cli(argv = process.argv.slice(2), deps = {}) {
  initializeCliUtf8();
  const parsed = parseCliArgs(argv);
  if (parsed.help) {
    process.stdout.write(HELP);
    return 0;
  }
  const progress = createCliProgressRenderer(parsed.options);
  const task = progress.task({
    id: 'bilibiliAction',
    title: 'Bilibili action',
    totalStages: 1,
    item: parsed.targetUrl ?? parsed.items?.[0],
  });
  const stage = task.stage({
    id: parsed.action,
    title: `Run ${parsed.action}`,
    index: 1,
    total: 1,
    item: parsed.targetUrl ?? parsed.items?.[0],
  });
  let report;
  try {
    report = await (deps.runBilibiliAction ?? runBilibiliAction)({
      action: parsed.action,
      targetUrl: parsed.targetUrl,
      items: parsed.items,
      ...stripProgressCliOptions(parsed.options),
    }, deps.routerDeps ?? {});
    const message = report.ok ? 'ok' : (report.reason ?? report.status ?? 'failed');
    if (report.ok) {
      stage.succeed({ message });
      task.succeed({ message });
    } else {
      stage.fail({ message });
      task.fail({ message });
      progress.failure({
        taskId: 'bilibiliAction',
        title: 'Bilibili action failed',
        stage: `Run ${parsed.action}`,
        reason: message,
        nextStep: 'node src/entrypoints/cli.mjs site doctor https://www.bilibili.com/ --no-headless --reuse-login-state',
      });
    }
  } catch (error) {
    const reason = error?.message ?? String(error);
    stage.fail({ message: reason });
    task.fail({ message: reason });
    progress.failure({
      taskId: 'bilibiliAction',
      title: 'Bilibili action failed',
      stage: `Run ${parsed.action}`,
      reason,
      nextStep: 'node src/entrypoints/cli.mjs site doctor https://www.bilibili.com/ --no-headless --reuse-login-state',
    });
    throw error;
  }
  writeJsonStdout(report);
  return report.ok ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cli().then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      process.stderr.write(`${error?.stack || error}\n`);
      process.exitCode = 1;
    },
  );
}
