// @ts-check

import { parseBoolean } from '../../../../infra/cli/parse-values.mjs';

function toBoolean(value, defaultValue = false) {
  return parseBoolean(value, { defaultValue });
}

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

function lastFlagValue(flags, key, fallback = undefined) {
  const value = flags[key];
  if (Array.isArray(value)) {
    return value[value.length - 1] ?? fallback;
  }
  return value ?? fallback;
}

const READ_ROUTE_ACTION_TOKENS = new Set(['app-route', 'read-route', 'route', 'route-crawl']);
const SEARCH_ACTION_TOKENS = new Set(['search', 'search-book', 'search-content', 'search-posts']);

export const SOCIAL_ACTION_HELP = `Internal script usage:
  node src/entrypoints/sites/x-action.mjs <action> [options]
  node src/entrypoints/sites/instagram-action.mjs <action> [options]
  node src/entrypoints/sites/weibo-action.mjs <action> [options]

Public command:
  siteforge build <url>

Common actions include profile-content, full-archive, search, profile-following,
profile-followers, followed-posts-by-date, read-route, and account-info.

Options:
  --site <x|instagram|weibo>        Override the wrapper default site.
  --account <handle>                Target account or profile handle.
  --query <value>                   Search query.
  --route <path>                    Safe same-site read-route start path.
  --community-id <id>               Community id for X community detail read-route surfaces.
  --list-id <id>                    List id for X list detail read-route surfaces.
  --space-id <id>                   Space id for X Spaces read-route surfaces.
  --status-id <id>                  Status id for status read-route surfaces.
  --media-id <id>                   Media id for status media read-route surfaces.
  --content-type <type>             posts, replies, media, likes, or site-specific tab.
  --download-media                  Download discovered media binaries locally and write media manifests.
  --probe-read-controls             Execute bounded read-only UI probes; mutations remain blocked.
  --max-control-probes <n>          Limit read-only UI probes. Default: 8.
  --crawl-read-surfaces             Follow bounded same-site read-only route queue.
  --risk-reviewed-read-surfaces     Also navigate discovered risky routes for structure only; controls remain blocked.
  --max-read-crawl-pages <n>        Limit read-only crawl pages. Default: 20.
  --max-read-crawl-depth <n>        Limit read-only crawl depth. Default: 1.
  --max-items <n>                   Limit archive or content items.
  --max-users <n>                   Limit relation/followed scans.
  --followed-users-file <path>      Reuse a verified followed-users items.jsonl as the relation seed.
  --run-dir <dir>                   Exact artifact run directory.
  --out-dir <dir>                   Artifact output root.
  --resume                          Resume from existing checkpoint state.
  --dry-run                         Plan without performing browser/media work when supported.
  --cookie-file <path>              Use a user-provided login-state cookie file for this run only.
  --session-manifest <path>         Consume a unified runs/session health manifest.
  --session-health-plan             Generate and consume a unified session health manifest first.
  --no-session-health-plan          Use the legacy session provider path.
  --format <json|markdown>          Output format. Default: json.
  --json                            Force JSON output and suppress human progress.
  --quiet                           Suppress human progress.
  --progress <auto|interactive|plain>
  --force-tty                       Force interactive progress rendering.
  --no-tty                          Force plain progress rendering.
  -h, --help                        Show this help.
`;

export function parseSocialActionArgs(argv = process.argv.slice(2), defaults = /** @type {any} */ ({})) {
  const args = [...argv];
  const positionals = /** @type {any[]} */ ([]);
  const flags = /** @type {any} */ ({});
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
    const [key, inlineValue] = token.split('=', 2);
    const normalizedKey = key.replace(/^--/u, '');
    if (inlineValue !== undefined) {
      appendFlag(flags, normalizedKey, inlineValue);
      continue;
    }
    const next = args[index + 1];
    if (next && !next.startsWith('--')) {
      appendFlag(flags, normalizedKey, next);
      index += 1;
    } else {
      appendFlag(flags, normalizedKey, true);
    }
  }

  const action = positionals[0] ?? lastFlagValue(flags, 'action', defaults.action ?? 'account-info');
  const normalizedActionToken = String(action ?? '').trim().toLowerCase().replace(/_/gu, '-');
  const isReadRouteAction = READ_ROUTE_ACTION_TOKENS.has(normalizedActionToken);
  const isSearchAction = SEARCH_ACTION_TOKENS.has(normalizedActionToken);
  const actionRequestsFullArchive = [
    'archive',
    'archive-user-content',
    'export-all',
    'full-archive',
    'full-history',
  ].includes(normalizedActionToken);
  const firstItem = positionals[1] ?? null;
  const site = lastFlagValue(flags, 'site', defaults.site);
  const apiCursorFlag = lastFlagValue(flags, 'api-cursor');
  const positionalAccount = isReadRouteAction || isSearchAction ? undefined : firstItem;
  return {
    help: flags.help === true,
    site,
    action,
    account: lastFlagValue(flags, 'account', lastFlagValue(flags, 'handle', lastFlagValue(flags, 'user', positionalAccount))),
    query: lastFlagValue(flags, 'query', lastFlagValue(flags, 'keyword', isSearchAction ? firstItem : undefined)),
    route: lastFlagValue(flags, 'route', lastFlagValue(flags, 'path', isReadRouteAction ? firstItem : undefined)),
    communityId: lastFlagValue(flags, 'community-id', lastFlagValue(flags, 'communityid')),
    listId: lastFlagValue(flags, 'list-id', lastFlagValue(flags, 'listid')),
    spaceId: lastFlagValue(flags, 'space-id', lastFlagValue(flags, 'spaceid')),
    statusId: lastFlagValue(flags, 'status-id', lastFlagValue(flags, 'tweet-id', lastFlagValue(flags, 'post-id'))),
    mediaId: lastFlagValue(flags, 'media-id', lastFlagValue(flags, 'photo-id')),
    contentType: lastFlagValue(flags, 'content-type', lastFlagValue(flags, 'tab')),
    date: lastFlagValue(flags, 'date'),
    fromDate: lastFlagValue(flags, 'from', lastFlagValue(flags, 'from-date')),
    toDate: lastFlagValue(flags, 'to', lastFlagValue(flags, 'to-date')),
    profilePath: lastFlagValue(flags, 'profile-path'),
    browserPath: lastFlagValue(flags, 'browser-path'),
    browserProfileRoot: lastFlagValue(flags, 'browser-profile-root'),
    userDataDir: lastFlagValue(flags, 'user-data-dir'),
    cookieFile: lastFlagValue(flags, 'cookie-file', lastFlagValue(flags, 'cookies-file')),
    sessionManifest: lastFlagValue(flags, 'session-manifest'),
    sessionProvider: lastFlagValue(flags, 'session-provider'),
    useUnifiedSessionHealth: flags['no-session-health-plan'] === true
      ? false
      : flags['session-health-plan'] === true
        ? true
        : undefined,
    outDir: lastFlagValue(flags, 'out-dir'),
    runDir: lastFlagValue(flags, 'run-dir', lastFlagValue(flags, 'artifacts-dir')),
    artifactRunId: lastFlagValue(flags, 'artifact-run-id', lastFlagValue(flags, 'run-id')),
    reportPath: lastFlagValue(flags, 'report-path'),
    timeoutMs: lastFlagValue(flags, 'timeout'),
    maxItems: lastFlagValue(flags, 'max-items'),
    maxScrolls: lastFlagValue(flags, 'max-scrolls'),
    maxApiPages: lastFlagValue(flags, 'max-api-pages'),
    maxControlProbes: lastFlagValue(flags, 'max-control-probes', lastFlagValue(flags, 'max-probes')),
    maxReadCrawlPages: lastFlagValue(flags, 'max-read-crawl-pages', lastFlagValue(flags, 'max-crawl-pages')),
    maxReadCrawlDepth: lastFlagValue(flags, 'max-read-crawl-depth', lastFlagValue(flags, 'max-crawl-depth')),
    maxUsers: lastFlagValue(flags, 'max-users'),
    followedUsersFile: lastFlagValue(flags, 'followed-users-file', lastFlagValue(flags, 'following-file')),
    maxDetailPages: lastFlagValue(flags, 'max-detail-pages'),
    perUserMaxItems: lastFlagValue(flags, 'per-user-max-items'),
    riskBackoffMs: flags['no-risk-backoff'] === true ? 0 : lastFlagValue(flags, 'risk-backoff-ms'),
    riskRetries: lastFlagValue(flags, 'risk-retries'),
    apiRetries: lastFlagValue(flags, 'api-retries'),
    scrollWaitMs: lastFlagValue(flags, 'scroll-wait'),
    fullArchive: actionRequestsFullArchive || flags['full-archive'] === true || flags['all-history'] === true,
    apiCursor: flags['no-api-cursor'] === true ? false : apiCursorFlag === undefined ? undefined : toBoolean(apiCursorFlag, true),
    followedDateMode: lastFlagValue(flags, 'followed-date-mode', lastFlagValue(flags, 'followed-date-strategy')),
    headless: flags.headless === true ? true : flags['no-headless'] === true ? false : undefined,
    reuseLoginState: flags['no-reuse-login-state'] === true ? false : flags['reuse-login-state'] === true ? true : undefined,
    autoLogin: flags['no-auto-login'] === true ? false : flags['auto-login'] === true ? true : undefined,
    dryRun: flags['dry-run'] === true,
    probeReadControls: flags['probe-read-controls'] === true,
    crawlReadSurfaces: flags['crawl-read-surfaces'] === true,
    riskReviewedReadSurfaces: flags['risk-reviewed-read-surfaces'] === true || flags['crawl-risky-read-surfaces'] === true,
    resume: flags['no-resume'] === true ? false : flags.resume === true ? true : undefined,
    downloadMedia: flags['download-media'] === true || flags.download === true,
    outputFormat: flags.json === true ? 'json' : lastFlagValue(flags, 'format', 'json'),
    json: flags.json === true,
    quiet: flags.quiet === true,
    progressMode: lastFlagValue(flags, 'progress'),
    forceTty: flags['force-tty'] === true,
    noTty: flags['no-tty'] === true,
  };
}
