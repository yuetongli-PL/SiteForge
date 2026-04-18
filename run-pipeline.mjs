import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { initializeCliUtf8 } from './lib/cli.mjs';

import { capture } from './capture.mjs';
import { expandStates } from './expand-states.mjs';
import { collectBookContent } from './collect-book-content.mjs';
import { analyzeStates } from './analyze-states.mjs';
import { abstractInteractions } from './abstract-interactions.mjs';
import { buildNlEntry } from './nl-entry.mjs';
import { generateDocs } from './generate-docs.mjs';
import { buildGovernance } from './govern-interactions.mjs';
import { compileKnowledgeBase } from './compile-wiki.mjs';
import { generateSkill } from './generate-skill.mjs';
import { executePipeline } from './lib/pipeline/engine.mjs';
import { normalizePipelineOptions, toBoolean } from './lib/pipeline/options.mjs';
import { PIPELINE_STAGE_SPECS, summarizePipelineStages } from './lib/pipeline/stage-spec.mjs';

const PIPELINE_STAGE_IMPLS = {
  capture,
  expandStates,
  collectBookContent,
  analyzeStates,
  abstractInteractions,
  buildNlEntry,
  generateDocs,
  buildGovernance,
  compileKnowledgeBase,
  generateSkill,
};

function resolvePipelineRuntime(runtime = {}) {
  if (
    !runtime
    || Array.isArray(runtime)
    || typeof runtime !== 'object'
    || (!('stageImpls' in runtime) && !('stageSpecs' in runtime))
  ) {
    return {
      stageSpecs: PIPELINE_STAGE_SPECS,
      stageImpls: runtime ?? PIPELINE_STAGE_IMPLS,
    };
  }

  return {
    stageSpecs: runtime.stageSpecs ?? PIPELINE_STAGE_SPECS,
    stageImpls: runtime.stageImpls ?? PIPELINE_STAGE_IMPLS,
  };
}

export async function runPipeline(inputUrl, options = {}, runtime = PIPELINE_STAGE_IMPLS) {
  const settings = normalizePipelineOptions(inputUrl, options);
  const { stageSpecs, stageImpls } = resolvePipelineRuntime(runtime);
  const { generatedAt, stageResults } = await executePipeline(inputUrl, settings, {
    stageSpecs,
    stageImpls,
  });

  return {
    inputUrl,
    generatedAt,
    kbDir: stageResults.knowledgeBase.kbDir,
    skillDir: stageResults.skill.skillDir,
    skillName: stageResults.skill.skillName,
    stages: summarizePipelineStages(stageResults),
  };
}

function printHelp() {
  process.stdout.write(`Usage:
  node run-pipeline.mjs <url> [options]

Options:
  --browser-path <path>        Explicit Chromium/Chrome executable path
  --browser-profile-root <path> Root directory for persistent browser profiles
  --user-data-dir <path>       Explicit Chromium user-data-dir to reuse
  --timeout <ms>               Overall timeout for browser steps
  --wait-until <mode>          load | networkidle
  --idle-ms <ms>               Extra delay after readiness before capture
  --max-triggers <n>           Maximum discovered triggers to expand
  --max-captured-states <n>    Maximum newly captured states during expansion
  --search-query <text>        Repeatable search query seed for site search
  --examples <path>            Optional example utterance JSON file
  --capture-out-dir <dir>      Root output directory for step 1
  --expanded-out-dir <dir>     Root output directory for step 2
  --book-content-out-dir <dir> Root output directory for chapter/book content collection
  --analysis-out-dir <dir>     Root output directory for step 3
  --abstraction-out-dir <dir>  Root output directory for step 4
  --nl-entry-out-dir <dir>     Root output directory for step 5
  --docs-out-dir <dir>         Root output directory for step 6
  --governance-out-dir <dir>   Root output directory for step 7
  --kb-dir <dir>               Final knowledge base directory
  --skill-out-dir <dir>        Final skill directory
  --skill-name <name>          Override default skill name
  --strict <true|false>        Strict mode for compileKnowledgeBase
  --reuse-login-state          Reuse a persistent per-site browser profile
  --no-reuse-login-state       Disable persistent login-state reuse
  --auto-login                 Best-effort credential login when credentials exist
  --no-auto-login              Disable credential auto-login
  --headless                   Run browser headless (default)
  --no-headless                Run browser with a visible window
  --full-page                  Force full-page screenshot (default)
  --no-full-page               Disable full-page screenshot
  --help                       Show this help
`);
}

function parseCliArgs(argv) {
  const args = [...argv];
  const options = {};
  let url = null;

  const readValue = (current, index) => {
    const eqIndex = current.indexOf('=');
    if (eqIndex !== -1) {
      return { value: current.slice(eqIndex + 1), nextIndex: index };
    }
    if (index + 1 >= args.length) {
      throw new Error(`Missing value for ${current}`);
    }
    return { value: args[index + 1], nextIndex: index + 1 };
  };

  for (let index = 0; index < args.length; index += 1) {
    const current = args[index];
    if (!current.startsWith('--')) {
      if (url !== null) {
        throw new Error(`Unexpected argument: ${current}`);
      }
      url = current;
      continue;
    }

    switch (current.split('=')[0]) {
      case '--browser-path': {
        const { value, nextIndex } = readValue(current, index);
        options.browserPath = value;
        index = nextIndex;
        break;
      }
      case '--browser-profile-root': {
        const { value, nextIndex } = readValue(current, index);
        options.browserProfileRoot = value;
        index = nextIndex;
        break;
      }
      case '--user-data-dir': {
        const { value, nextIndex } = readValue(current, index);
        options.userDataDir = value;
        index = nextIndex;
        break;
      }
      case '--timeout': {
        const { value, nextIndex } = readValue(current, index);
        options.timeoutMs = Number(value);
        index = nextIndex;
        break;
      }
      case '--wait-until': {
        const { value, nextIndex } = readValue(current, index);
        options.waitUntil = value;
        index = nextIndex;
        break;
      }
      case '--idle-ms': {
        const { value, nextIndex } = readValue(current, index);
        options.idleMs = Number(value);
        index = nextIndex;
        break;
      }
      case '--max-triggers': {
        const { value, nextIndex } = readValue(current, index);
        options.maxTriggers = Number(value);
        index = nextIndex;
        break;
      }
      case '--max-captured-states': {
        const { value, nextIndex } = readValue(current, index);
        options.maxCapturedStates = Number(value);
        index = nextIndex;
        break;
      }
      case '--search-query': {
        const { value, nextIndex } = readValue(current, index);
        options.searchQueries = [...(options.searchQueries ?? []), value];
        index = nextIndex;
        break;
      }
      case '--examples': {
        const { value, nextIndex } = readValue(current, index);
        options.examplesPath = value;
        index = nextIndex;
        break;
      }
      case '--capture-out-dir': {
        const { value, nextIndex } = readValue(current, index);
        options.captureOutDir = value;
        index = nextIndex;
        break;
      }
      case '--expanded-out-dir': {
        const { value, nextIndex } = readValue(current, index);
        options.expandedOutDir = value;
        index = nextIndex;
        break;
      }
      case '--analysis-out-dir': {
        const { value, nextIndex } = readValue(current, index);
        options.analysisOutDir = value;
        index = nextIndex;
        break;
      }
      case '--book-content-out-dir': {
        const { value, nextIndex } = readValue(current, index);
        options.bookContentOutDir = value;
        index = nextIndex;
        break;
      }
      case '--abstraction-out-dir': {
        const { value, nextIndex } = readValue(current, index);
        options.abstractionOutDir = value;
        index = nextIndex;
        break;
      }
      case '--nl-entry-out-dir': {
        const { value, nextIndex } = readValue(current, index);
        options.nlEntryOutDir = value;
        index = nextIndex;
        break;
      }
      case '--docs-out-dir': {
        const { value, nextIndex } = readValue(current, index);
        options.docsOutDir = value;
        index = nextIndex;
        break;
      }
      case '--governance-out-dir': {
        const { value, nextIndex } = readValue(current, index);
        options.governanceOutDir = value;
        index = nextIndex;
        break;
      }
      case '--kb-dir': {
        const { value, nextIndex } = readValue(current, index);
        options.kbDir = value;
        index = nextIndex;
        break;
      }
      case '--skill-out-dir': {
        const { value, nextIndex } = readValue(current, index);
        options.skillOutDir = value;
        index = nextIndex;
        break;
      }
      case '--skill-name': {
        const { value, nextIndex } = readValue(current, index);
        options.skillName = value;
        index = nextIndex;
        break;
      }
      case '--strict': {
        const { value, nextIndex } = readValue(current, index);
        options.strict = toBoolean(value, '--strict');
        index = nextIndex;
        break;
      }
      case '--headless':
        options.headless = true;
        break;
      case '--no-headless':
        options.headless = false;
        break;
      case '--reuse-login-state':
        options.reuseLoginState = true;
        break;
      case '--no-reuse-login-state':
        options.reuseLoginState = false;
        break;
      case '--auto-login':
        options.autoLogin = true;
        break;
      case '--no-auto-login':
        options.autoLogin = false;
        break;
      case '--full-page':
        options.fullPage = true;
        break;
      case '--no-full-page':
        options.fullPage = false;
        break;
      case '--help':
        options.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${current}`);
    }
  }

  return { url, options };
}

async function runCli() {
  initializeCliUtf8();
  const { url, options } = parseCliArgs(process.argv.slice(2));
  if (options.help || !url) {
    printHelp();
    if (!options.help && !url) {
      process.exitCode = 1;
    }
    return;
  }

  const result = await runPipeline(url, options);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (entryPath && fileURLToPath(import.meta.url) === entryPath) {
  runCli().catch((error) => {
    process.stderr.write(`${error?.message ?? String(error)}\n`);
    process.exitCode = 1;
  });
}
