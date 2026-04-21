import { spawn } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { waitForPersistentProfileFlush } from './profile-store.mjs';

export const DEFAULT_BROWSER_PATHS = {
  win32: [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(os.homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    'C:\\Program Files\\Google\\Chrome for Testing\\chrome.exe',
    path.join(os.homedir(), 'AppData', 'Local', 'Google', 'Chrome for Testing', 'chrome.exe'),
    'C:\\Program Files\\Chromium\\Application\\chrome.exe',
    path.join(os.homedir(), 'AppData', 'Local', 'Chromium', 'Application', 'chrome.exe'),
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ],
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ],
  linux: [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
    '/usr/bin/microsoft-edge',
    '/usr/bin/microsoft-edge-stable',
  ],
};

const DEVTOOLS_POLL_INTERVAL_MS = 100;

export function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function parseDevToolsActivePortContent(content) {
  const [portLine, wsPathLine] = String(content ?? '').trim().split(/\r?\n/);
  const port = Number(portLine);
  if (!Number.isInteger(port) || port <= 0) {
    return null;
  }
  return {
    port,
    wsUrl: wsPathLine ? `ws://127.0.0.1:${port}${wsPathLine}` : null,
  };
}

export async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function detectBrowserPath() {
  const envCandidates = [process.env.BROWSER_PATH, process.env.CHROME_PATH, process.env.CHROMIUM_PATH].filter(Boolean);
  const platformCandidates = DEFAULT_BROWSER_PATHS[process.platform] ?? [];
  for (const candidate of [...envCandidates, ...platformCandidates]) {
    if (await fileExists(candidate)) {
      return candidate;
    }
  }
  return null;
}

async function waitForDevToolsPort(userDataDir, browserProcess, timeoutMs, getLaunchError = () => null) {
  const filePath = path.join(userDataDir, 'DevToolsActivePort');
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const launchError = getLaunchError();
    if (launchError) {
      throw launchError;
    }

    if (browserProcess.exitCode !== null) {
      throw new Error(`Browser exited before DevTools became ready (code ${browserProcess.exitCode})`);
    }

    try {
      const content = await readFile(filePath, 'utf8');
      const parsed = parseDevToolsActivePortContent(content);
      if (parsed) {
        return parsed;
      }
    } catch {
      // Keep polling until the file is populated.
    }

    await delay(DEVTOOLS_POLL_INTERVAL_MS);
  }

  throw new Error('Timed out waiting for DevToolsActivePort');
}

async function waitForBrowserWsUrl(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`, {
        signal: AbortSignal.timeout(Math.max(1, Math.min(2_000, timeoutMs))),
      });
      if (response.ok) {
        const payload = await response.json();
        if (payload?.webSocketDebuggerUrl) {
          return payload.webSocketDebuggerUrl;
        }
      }
    } catch {
      // Browser is still warming up.
    }

    await delay(DEVTOOLS_POLL_INTERVAL_MS);
  }

  throw new Error('Timed out waiting for browser websocket endpoint');
}

export async function readExistingBrowserDevTools(userDataDir, timeoutMs = 2_000) {
  if (!userDataDir) {
    return null;
  }

  const filePath = path.join(path.resolve(userDataDir), 'DevToolsActivePort');
  try {
    const content = await readFile(filePath, 'utf8');
    const parsed = parseDevToolsActivePortContent(content);
    if (!parsed) {
      return null;
    }
    if (parsed.wsUrl) {
      return parsed;
    }
    return {
      port: parsed.port,
      wsUrl: await waitForBrowserWsUrl(parsed.port, timeoutMs),
    };
  } catch {
    return null;
  }
}

export async function launchBrowser(
  browserPath,
  {
    headless,
    timeoutMs,
    userDataDirPrefix = 'browser-runtime-',
    userDataDir = null,
    cleanupUserDataDirOnShutdown = userDataDir ? false : true,
    startupUrl = 'about:blank',
  },
) {
  const resolvedUserDataDir = userDataDir
    ? path.resolve(userDataDir)
    : await mkdtemp(path.join(os.tmpdir(), userDataDirPrefix));
  if (userDataDir) {
    await mkdir(resolvedUserDataDir, { recursive: true });
  }
  try {
    await rm(path.join(resolvedUserDataDir, 'DevToolsActivePort'), { force: true });
  } catch {
    // Ignore stale DevToolsActivePort cleanup errors and let startup continue.
  }
  const args = [
    `--user-data-dir=${resolvedUserDataDir}`,
    '--remote-debugging-port=0',
    '--no-first-run',
    '--no-default-browser-check',
    '--hide-scrollbars',
    '--disable-gpu',
    '--disable-popup-blocking',
    '--disable-background-networking',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-sync',
    '--metrics-recording-only',
    '--mute-audio',
    String(startupUrl || 'about:blank'),
  ];

  if (headless) {
    args.unshift('--headless=new');
  }

  const browserProcess = spawn(browserPath, args, {
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true,
  });

  let stderr = '';
  let launchError = null;
  browserProcess.stderr?.setEncoding('utf8');
  browserProcess.stderr?.on('data', (chunk) => {
    stderr = `${stderr}${chunk}`.slice(-8_192);
  });

  browserProcess.once('error', (error) => {
    launchError = error;
  });

  try {
    if (launchError) {
      throw launchError;
    }
    const devtools = await waitForDevToolsPort(resolvedUserDataDir, browserProcess, timeoutMs, () => launchError);
    if (launchError) {
      throw launchError;
    }
    const wsUrl = devtools.wsUrl ?? await waitForBrowserWsUrl(devtools.port, timeoutMs);
    return {
      browserProcess,
      userDataDir: resolvedUserDataDir,
      cleanupUserDataDirOnShutdown,
      port: devtools.port,
      wsUrl,
      startupUrl: String(startupUrl || 'about:blank'),
      stderr,
    };
  } catch (error) {
    await shutdownBrowser(browserProcess, resolvedUserDataDir, { cleanupUserDataDirOnShutdown });
    throw new Error(`${error.message}${stderr ? `\n${stderr.trim()}` : ''}`.trim());
  }
}

function isTransientCleanupError(error) {
  const code = String(error?.code ?? '').toUpperCase();
  return ['EBUSY', 'EPERM', 'ENOTEMPTY'].includes(code);
}

export async function cleanupUserDataDir(userDataDir, removeImpl = rm) {
  if (!userDataDir) {
    return;
  }

  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      await removeImpl(userDataDir, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 100,
      });
      return;
    } catch (error) {
      if (!isTransientCleanupError(error) || attempt === 5) {
        return;
      }
      await delay(150 * (attempt + 1));
    }
  }
}

export async function waitForBrowserProcessExit(browserProcess, timeoutMs = 3_000) {
  if (!browserProcess) {
    return true;
  }
  if (browserProcess.exitCode !== null) {
    return true;
  }

  return await Promise.race([
    new Promise((resolve) => browserProcess.once('exit', () => resolve(true))),
    delay(timeoutMs).then(() => false),
  ]);
}

export async function shutdownBrowser(
  browserProcess,
  userDataDir,
  {
    cleanupUserDataDirOnShutdown = true,
    gracefulClose = null,
    gracefulExitTimeoutMs = 5_000,
    forceKillTimeoutMs = 2_000,
    waitForProfileFlushOnShutdown = !cleanupUserDataDirOnShutdown,
  } = {},
) {
  let shutdownMode = 'graceful';

  if (browserProcess && browserProcess.exitCode === null) {
    let exitedGracefully = false;
    if (typeof gracefulClose === 'function') {
      try {
        await gracefulClose();
      } catch {
        // Fall back to forceful termination below.
      }
      exitedGracefully = await waitForBrowserProcessExit(browserProcess, gracefulExitTimeoutMs);
    }

    if (!exitedGracefully) {
      shutdownMode = 'forced';
      browserProcess.kill();
      await waitForBrowserProcessExit(browserProcess, forceKillTimeoutMs);
      if (browserProcess.exitCode === null) {
        browserProcess.kill('SIGKILL');
        await waitForBrowserProcessExit(browserProcess, forceKillTimeoutMs);
      }
    }
  }

  const profileFlush = waitForProfileFlushOnShutdown && userDataDir
    ? await waitForPersistentProfileFlush(userDataDir)
    : null;

  if (cleanupUserDataDirOnShutdown) {
    await cleanupUserDataDir(userDataDir);
  }

  return {
    shutdownMode,
    profileFlush,
  };
}
