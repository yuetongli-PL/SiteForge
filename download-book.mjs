// @ts-check
import { access, cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DEFAULT_OPTIONS = {
  crawlerScriptsDir: path.resolve(process.cwd(), 'crawler-scripts'),
  knowledgeBaseDir: undefined,
  profilePath: undefined,
  outDir: path.resolve(process.cwd(), 'book-content'),
  bookTitle: undefined,
  bookUrl: undefined,
  metadataOnly: false,
  forceRecrawl: false,
};

const WINGET_PYPY_ROOT = path.join(
  process.env.LOCALAPPDATA || '',
  'Microsoft',
  'WinGet',
  'Packages',
  'PyPy.PyPy.3.11_Microsoft.Winget.Source_8wekyb3d8bbwe',
);

function normalizeWhitespace(value) {
  return String(value ?? '').replace(/\s+/gu, ' ').trim();
}

function normalizeText(value) {
  return normalizeWhitespace(String(value ?? '').normalize('NFKC'));
}

function normalizeSearchTitle(value) {
  const normalized = normalizeText(value);
  return normalized.replace(/[?？!！。．…]+$/u, '').trim() || normalized;
}

function normalizeUrlNoFragment(value) {
  if (!value) {
    return null;
  }
  try {
    const parsed = new URL(String(value));
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return String(value).split('#')[0];
  }
}

function sanitizeHost(host) {
  return (host || 'unknown-host').replace(/[^a-zA-Z0-9.-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'unknown-host';
}

async function exists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function findPyPyExecutable() {
  const candidates = [
    process.env.PYPY3_PATH,
    path.join(WINGET_PYPY_ROOT, 'pypy3.11-v7.3.20-win64', 'pypy3.exe'),
    path.join(WINGET_PYPY_ROOT, 'pypy3.11-v7.3.20-win64', 'pypy.exe'),
    'pypy3',
    'pypy',
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (candidate === 'pypy3' || candidate === 'pypy') {
      return candidate;
    }
    if (await exists(candidate)) {
      return candidate;
    }
  }
  return 'pypy3';
}

async function readJson(targetPath) {
  return JSON.parse(await readFile(targetPath, 'utf8'));
}

async function writeJson(targetPath, payload) {
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function mergeOptions(inputUrl, options = {}) {
  const parsed = new URL(inputUrl);
  const merged = { ...DEFAULT_OPTIONS, ...options };
  merged.host = parsed.host;
  merged.baseUrl = normalizeUrlNoFragment(parsed.origin + '/');
  merged.crawlerScriptsDir = path.resolve(merged.crawlerScriptsDir);
  merged.outDir = path.resolve(merged.outDir);
  merged.knowledgeBaseDir = merged.knowledgeBaseDir
    ? path.resolve(merged.knowledgeBaseDir)
    : path.resolve(process.cwd(), 'knowledge-base', sanitizeHost(parsed.host));
  if (merged.profilePath) {
    merged.profilePath = path.resolve(merged.profilePath);
  }
  merged.bookTitle = normalizeSearchTitle(merged.bookTitle);
  merged.bookUrl = normalizeUrlNoFragment(merged.bookUrl);
  merged.metadataOnly = Boolean(merged.metadataOnly);
  merged.forceRecrawl = Boolean(merged.forceRecrawl);
  return merged;
}

function titlesMatch(left, right) {
  const a = normalizeText(left);
  const b = normalizeText(right);
  if (!a || !b) {
    return false;
  }
  return a === b || a.includes(b) || b.includes(a);
}

async function listRunDirs(dirPath) {
  if (!await exists(dirPath)) {
    return [];
  }
  const entries = await readdir(dirPath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(dirPath, entry.name))
    .sort((left, right) => path.basename(right).localeCompare(path.basename(left), 'en'));
}

async function validateArtifact(book, manifestPath, runDir) {
  if (!book?.downloadFile || !book?.bookFile || !book?.chaptersFile) {
    return null;
  }
  const manifest = await readJson(manifestPath);
  if (manifest.completeness !== 'full-book' || manifest.downloadOrdering !== 'ascending' || manifest.formatting !== 'pretty-txt') {
    return null;
  }
  const bookFile = path.isAbsolute(book.bookFile) ? book.bookFile : path.join(runDir, book.bookFile);
  const chaptersFile = path.isAbsolute(book.chaptersFile) ? book.chaptersFile : path.join(runDir, book.chaptersFile);
  const downloadFile = path.isAbsolute(book.downloadFile) ? book.downloadFile : path.join(runDir, book.downloadFile);
  if (!await exists(bookFile) || !await exists(chaptersFile) || !await exists(downloadFile)) {
    return null;
  }
  const bookPayload = await readJson(bookFile);
  const chaptersPayload = await readJson(chaptersFile);
  if (bookPayload.chapterOrder !== 'ascending' || bookPayload.downloadFormat !== 'pretty-txt') {
    return null;
  }
  if (!Array.isArray(chaptersPayload) || chaptersPayload.length === 0) {
    return null;
  }
  const firstChapter = chaptersPayload[0];
  const lastChapter = chaptersPayload[chaptersPayload.length - 1];
  if (Number(firstChapter.chapterIndex) !== 1) {
    return null;
  }
  if (Number(lastChapter.chapterIndex) !== chaptersPayload.length) {
    return null;
  }
  return {
    downloadFile,
    chapterCount: chaptersPayload.length,
  };
}

async function findArtifactInRun(runDir, settings) {
  const booksPath = path.join(runDir, 'books.json');
  const manifestPath = path.join(runDir, 'book-content-manifest.json');
  if (!await exists(booksPath) || !await exists(manifestPath)) {
    return null;
  }
  const books = await readJson(booksPath);
  const matched = books.find((book) => (
    settings.bookUrl && normalizeUrlNoFragment(book.finalUrl) === settings.bookUrl
  ) || (
    settings.bookTitle && titlesMatch(book.title, settings.bookTitle)
  )) ?? null;
  if (!matched) {
    return null;
  }
  const validated = await validateArtifact(matched, manifestPath, runDir);
  if (!validated) {
    return null;
  }
  return {
    host: settings.host,
    bookTitle: matched.title,
    mode: 'artifact-hit',
    downloadFile: validated.downloadFile,
    crawlerScript: null,
    manifestPath,
    finalUrl: matched.finalUrl ?? null,
    interpreter: manifestPath ? (await readJson(manifestPath)).interpreter ?? null : null,
    durationMs: (await readJson(manifestPath)).summary?.durationMs ?? null,
    isComplete: true,
    metTargetSla: Boolean((await readJson(manifestPath)).summary?.durationMs <= 10_000),
  };
}

async function findExistingArtifact(settings) {
  const roots = [
    path.join(settings.knowledgeBaseDir, 'raw', 'step-book-content'),
    settings.outDir,
  ];
  for (const root of roots) {
    const runDirs = await listRunDirs(root);
    for (const runDir of runDirs) {
      const artifact = await findArtifactInRun(runDir, settings);
      if (artifact) {
        return artifact;
      }
    }
  }
  return null;
}

async function syncRunToKnowledgeBase(runDir, kbDir) {
  const destination = path.join(kbDir, 'raw', 'step-book-content', path.basename(runDir));
  if (!await exists(destination)) {
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(runDir, destination, { recursive: true, force: false });
  }
  return destination;
}

async function refreshRegistryUsage(registryPath, host, status) {
  if (!await exists(registryPath)) {
    return;
  }
  const registry = await readJson(registryPath);
  registry.generatedAt = new Date().toISOString();
  registry.hosts = registry.hosts ?? {};
  registry.hosts[host] = {
    ...(registry.hosts[host] ?? {}),
    host,
    lastUsedAt: new Date().toISOString(),
    status,
  };
  await writeJson(registryPath, registry);
}

async function runPyPyCrawler(scriptPath, settings) {
  const interpreter = await findPyPyExecutable();
  const args = [
    scriptPath,
    '--out-dir', settings.outDir,
  ];
  if (settings.bookTitle) {
    args.push('--book-title', settings.bookTitle);
  }
  if (settings.bookUrl) {
    args.push('--book-url', settings.bookUrl);
  }
  return await new Promise((resolve, reject) => {
    const child = spawn(interpreter, args, {
      cwd: process.cwd(),
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', (error) => {
      if (error?.code === 'ENOENT') {
        reject(new Error('Missing required interpreter: pypy3. Install PyPy and retry.'));
        return;
      }
      reject(error);
    });
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(normalizeWhitespace(stderr) || `PyPy crawler exited with code ${code}.`));
        return;
      }
      try {
        const parsed = JSON.parse(stdout);
        parsed.interpreter = parsed.interpreter ?? interpreter;
        resolve(parsed);
      } catch {
        reject(new Error(`Failed to parse crawler output JSON. Raw stdout: ${stdout}`));
      }
    });
  });
}

async function runPythonEntry(inputUrl, settings) {
  const interpreter = await findPyPyExecutable();
  const scriptPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'download_book.py');
  const args = [
    scriptPath,
    inputUrl,
    '--crawler-scripts-dir', settings.crawlerScriptsDir,
    '--knowledge-base-dir', settings.knowledgeBaseDir,
    '--out-dir', settings.outDir,
  ];
  if (settings.profilePath) {
    args.push('--profile-path', settings.profilePath);
  }
  if (settings.bookTitle) {
    args.push('--book-title', settings.bookTitle);
  }
  if (settings.bookUrl) {
    args.push('--book-url', settings.bookUrl);
  }
  if (settings.metadataOnly) {
    args.push('--metadata-only');
  }
  if (settings.forceRecrawl) {
    args.push('--force-recrawl');
  }
  return await new Promise((resolve, reject) => {
    const child = spawn(interpreter, args, {
      cwd: process.cwd(),
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', (error) => {
      if (error?.code === 'ENOENT') {
        reject(new Error('Missing required interpreter: pypy3. Install PyPy and retry.'));
        return;
      }
      reject(error);
    });
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(normalizeWhitespace(stderr) || `PyPy download entry exited with code ${code}.`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch {
        reject(new Error(`Failed to parse Python entry output JSON. Raw stdout: ${stdout}`));
      }
    });
  });
}

export async function downloadBook(inputUrl, options = {}) {
  const settings = mergeOptions(inputUrl, options);
  if (!settings.bookTitle && !settings.bookUrl) {
    throw new Error('Missing bookTitle or bookUrl.');
  }
  return await runPythonEntry(inputUrl, settings);
}

function parseCliArgs(argv) {
  if (!argv.length || argv[0] === '--help' || argv[0] === '-h') {
    return { help: true };
  }
  const [inputUrl, ...rest] = argv;
  const options = {};
  const readValue = (index) => {
    if (index + 1 >= rest.length) {
      throw new Error(`Missing value for ${rest[index]}`);
    }
    return { value: rest[index + 1], nextIndex: index + 1 };
  };
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    switch (token) {
      case '--book-title': {
        const { value, nextIndex } = readValue(index);
        options.bookTitle = value;
        index = nextIndex;
        break;
      }
      case '--book-url': {
        const { value, nextIndex } = readValue(index);
        options.bookUrl = value;
        index = nextIndex;
        break;
      }
      case '--crawler-scripts-dir': {
        const { value, nextIndex } = readValue(index);
        options.crawlerScriptsDir = value;
        index = nextIndex;
        break;
      }
      case '--knowledge-base-dir': {
        const { value, nextIndex } = readValue(index);
        options.knowledgeBaseDir = value;
        index = nextIndex;
        break;
      }
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
      case '--metadata-only':
        options.metadataOnly = true;
        break;
      case '--force-recrawl':
        options.forceRecrawl = true;
        break;
      default:
        break;
    }
  }
  return { help: false, inputUrl, options };
}

function printHelp() {
  process.stdout.write('Usage:\n  node download-book.mjs <url> --book-title <title> [--book-url <url>] [--out-dir <dir>] [--crawler-scripts-dir <dir>] [--knowledge-base-dir <dir>] [--profile-path <path>] [--metadata-only] [--force-recrawl]\n');
}

async function runCli() {
  const parsed = parseCliArgs(process.argv.slice(2));
  if (parsed.help) {
    printHelp();
    return;
  }
  const result = await downloadBook(parsed.inputUrl, parsed.options);
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  runCli().catch((error) => {
    console.error(error?.message ?? String(error));
    process.exitCode = 1;
  });
}
