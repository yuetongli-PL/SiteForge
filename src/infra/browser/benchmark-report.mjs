export const DEFAULT_CAPTURE_EXPAND_BENCHMARKS = [
  {
    id: 'jable',
    label: 'jable.tv',
    url: 'https://jable.tv/',
    searchQueries: ['IPX-001'],
    maxTriggers: 2,
    maxCapturedStates: 3,
  },
  {
    id: 'moodyz',
    label: 'moodyz.com/works/date',
    url: 'https://www.moodyz.com/works/date/',
    searchQueries: [],
    maxTriggers: 2,
    maxCapturedStates: 3,
  },
  {
    id: 'bilibili-home-search-video',
    label: 'bilibili.com home/search/video',
    profilePath: 'profiles/www.bilibili.com.json',
    urlSource: 'profile-host-home',
    searchQuerySampleField: 'videoSearchQuery',
    maxTriggers: 5,
    maxCapturedStates: 5,
  },
  {
    id: 'bilibili-category-popular',
    label: 'bilibili.com category popular',
    profilePath: 'profiles/www.bilibili.com.json',
    urlSampleField: 'categoryPopularUrl',
    searchQueries: [],
    maxTriggers: 4,
    maxCapturedStates: 4,
  },
  {
    id: 'bilibili-bangumi',
    label: 'bilibili.com bangumi',
    profilePath: 'profiles/www.bilibili.com.json',
    urlSampleField: 'bangumiDetailUrl',
    searchQueries: [],
    maxTriggers: 3,
    maxCapturedStates: 3,
  },
  {
    id: 'bilibili-author-videos',
    label: 'bilibili.com author videos',
    profilePath: 'profiles/www.bilibili.com.json',
    urlSampleField: 'authorVideosUrl',
    searchQueries: [],
    maxTriggers: 4,
    maxCapturedStates: 4,
  },
  {
    id: '22biqu',
    label: '22biqu.com',
    url: 'https://www.22biqu.com/',
    searchQueries: ['凡人修仙传'],
    maxTriggers: 2,
    maxCapturedStates: 3,
  },
];

export const AUTHENTICATED_BILIBILI_BENCHMARKS = [
  {
    id: 'bilibili-author-follow-list',
    label: 'bilibili.com author follow list',
    profilePath: 'profiles/www.bilibili.com.json',
    authUrlSampleField: 'followListUrl',
    searchQueries: [],
    maxTriggers: 3,
    maxCapturedStates: 3,
    authRequired: true,
  },
  {
    id: 'bilibili-author-fans-list',
    label: 'bilibili.com author fans list',
    profilePath: 'profiles/www.bilibili.com.json',
    authUrlSampleField: 'fansListUrl',
    searchQueries: [],
    maxTriggers: 3,
    maxCapturedStates: 3,
    authRequired: true,
  },
];

function toInt(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : 0;
}

function formatMs(ms) {
  if (!Number.isFinite(ms)) {
    return 'n/a';
  }
  if (ms < 1_000) {
    return `${Math.round(ms)} ms`;
  }
  return `${(ms / 1_000).toFixed(2)} s`;
}

function pluck(obj, key) {
  return Number(obj?.[key] ?? 0);
}

function deriveBenchmarkOutcome(entry) {
  if (entry.error) {
    return {
      code: 'error',
      summary: 'benchmark failed',
      observations: ['Benchmark did not complete successfully.'],
    };
  }
  if (entry.skippedReason) {
    return {
      code: 'skipped',
      summary: 'skipped',
      observations: [entry.skippedReason],
    };
  }

  const observations = [];
  if (entry.budget?.hit && entry.budget?.stopReason) {
    observations.push(`Budget was exhausted: ${entry.budget.stopReason}`);
  }
  if ((entry.expand?.discoveredTriggers ?? 0) > (entry.expand?.attemptedTriggers ?? 0)) {
    observations.push(`Only ${entry.expand?.attemptedTriggers ?? 0} of ${entry.expand?.discoveredTriggers ?? 0} discovered triggers were attempted.`);
  }
  if ((entry.expand?.attemptedTriggers ?? 0) === 0 && (entry.expand?.capturedStates ?? 0) === 0) {
    observations.push('Expand did not advance beyond the starting page.');
  }
  if ((entry.expand?.capturedStates ?? 0) === 0 && (entry.expand?.discoveredTriggers ?? 0) === 0) {
    observations.push('No candidate triggers were discovered during expansion.');
  }

  if (entry.budget?.hit) {
    return {
      code: 'budget-hit',
      summary: 'stopped by configured budget',
      observations,
    };
  }
  if ((entry.expand?.attemptedTriggers ?? 0) === 0 && (entry.expand?.capturedStates ?? 0) === 0) {
    return {
      code: 'no-trigger-progress',
      summary: 'no trigger progress',
      observations,
    };
  }
  if ((entry.expand?.discoveredTriggers ?? 0) === 0) {
    return {
      code: 'no-discovered-triggers',
      summary: 'no triggers discovered',
      observations,
    };
  }
  return {
    code: 'completed-under-budget',
    summary: 'completed under budget',
    observations,
  };
}

export function summarizeSessionMetrics(metrics = {}) {
  const safeMetrics = metrics ?? {};
  return {
    send: pluck(safeMetrics.counts, 'send'),
    evaluate: pluck(safeMetrics.counts, 'evaluate'),
    evaluateValue: pluck(safeMetrics.counts, 'evaluateValue'),
    callPageFunction: pluck(safeMetrics.counts, 'callPageFunction'),
    navigateAndWait: pluck(safeMetrics.counts, 'navigateAndWait'),
    waitForSettled: pluck(safeMetrics.counts, 'waitForSettled'),
    waitForDocumentReady: pluck(safeMetrics.counts, 'waitForDocumentReady'),
    waitForDomQuiet: pluck(safeMetrics.counts, 'waitForDomQuiet'),
    networkIdleWait: pluck(safeMetrics.counts, 'networkIdleWait'),
    captureHtml: pluck(safeMetrics.counts, 'captureHtml'),
    captureSnapshot: pluck(safeMetrics.counts, 'captureSnapshot'),
    captureScreenshot: pluck(safeMetrics.counts, 'captureScreenshot'),
    helperEnsure: pluck(safeMetrics.counts, 'helperEnsure'),
    helperInvoke: pluck(safeMetrics.counts, 'helperInvoke'),
    helperRetry: pluck(safeMetrics.counts, 'helperRetry'),
    helperFallback: pluck(safeMetrics.counts, 'helperFallback'),
    protocolTotal: pluck(safeMetrics.protocol, 'total'),
    protocolByMethod: { ...(safeMetrics.protocol?.byMethod ?? {}) },
    helperMethods: { ...(safeMetrics.helperMethods ?? {}) },
    waitPolicies: Array.isArray(safeMetrics.waitPolicies) ? safeMetrics.waitPolicies : [],
  };
}

export function buildBenchmarkReport({ generatedAt, cwd, outputDir, browserPath = null, benchmarks = [] }) {
  const normalizedBenchmarks = benchmarks.map((entry) => {
    const captureDurationMs = toInt(entry.capture?.durationMs);
    const expandDurationMs = toInt(entry.expand?.durationMs);
    const totalDurationMs = captureDurationMs + expandDurationMs;
    const captureMetrics = summarizeSessionMetrics(entry.capture?.metrics);
    const expandMetrics = summarizeSessionMetrics(entry.expand?.metrics);

    const normalizedEntry = {
      id: entry.id,
      label: entry.label,
      url: entry.url,
      searchQueries: Array.isArray(entry.searchQueries) ? entry.searchQueries : [],
      error: entry.error ?? null,
      budget: {
        maxTriggers: toInt(entry.budget?.maxTriggers ?? entry.maxTriggers),
        maxCapturedStates: Number.isFinite(Number(entry.budget?.maxCapturedStates ?? entry.maxCapturedStates))
          ? toInt(entry.budget?.maxCapturedStates ?? entry.maxCapturedStates)
          : null,
        hit: Boolean(entry.budget?.hit),
        stopReason: entry.budget?.stopReason ?? null,
      },
      authRequired: entry.authRequired === true,
      authAvailable: entry.authAvailable ?? null,
      skippedReason: entry.skippedReason ?? null,
      capture: {
        durationMs: captureDurationMs,
        status: entry.capture?.status ?? 'unknown',
        outDir: entry.capture?.outDir ?? null,
        finalUrl: entry.capture?.finalUrl ?? null,
        metrics: captureMetrics,
      },
      expand: {
        durationMs: expandDurationMs,
        capturedStates: toInt(entry.expand?.capturedStates),
        discoveredTriggers: toInt(entry.expand?.discoveredTriggers),
        attemptedTriggers: toInt(entry.expand?.attemptedTriggers),
        duplicateStates: toInt(entry.expand?.duplicateStates),
        noopTriggers: toInt(entry.expand?.noopTriggers),
        failedTriggers: toInt(entry.expand?.failedTriggers),
        outDir: entry.expand?.outDir ?? null,
        metrics: expandMetrics,
      },
      totals: {
        durationMs: totalDurationMs,
        protocolTotal: captureMetrics.protocolTotal + expandMetrics.protocolTotal,
        navigateAndWait: captureMetrics.navigateAndWait + expandMetrics.navigateAndWait,
        evaluate: captureMetrics.evaluate + expandMetrics.evaluate,
        captureSnapshot: captureMetrics.captureSnapshot + expandMetrics.captureSnapshot,
        captureScreenshot: captureMetrics.captureScreenshot + expandMetrics.captureScreenshot,
      },
    };

    const outcome = deriveBenchmarkOutcome(normalizedEntry);
    return {
      ...normalizedEntry,
      outcome,
    };
  });

  return {
    generatedAt,
    cwd,
    outputDir,
    browserPath,
    benchmarks: normalizedBenchmarks,
  };
}

export function renderBenchmarkMarkdown(report) {
  const lines = [
    '# Capture + Expand Benchmark',
    '',
    `Generated: ${report.generatedAt}`,
    `Workspace: ${report.cwd}`,
    `Output: ${report.outputDir}`,
    `Browser: ${report.browserPath || 'auto-detect'}`,
    '',
    '| Site | Outcome | Capture | Expand | Total | Page.navigate | Runtime.evaluate | Snapshot | Screenshot |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  ];

  for (const entry of report.benchmarks) {
    lines.push(
      `| ${entry.label} | ${entry.outcome.summary} | ${formatMs(entry.capture.durationMs)} | ${formatMs(entry.expand.durationMs)} | ${formatMs(entry.totals.durationMs)} | ${entry.totals.navigateAndWait} | ${entry.totals.evaluate} | ${entry.totals.captureSnapshot} | ${entry.totals.captureScreenshot} |`,
    );
  }

  lines.push('');

  for (const entry of report.benchmarks) {
    lines.push(`## ${entry.label}`);
    lines.push('');
    lines.push(`- URL: ${entry.url}`);
    lines.push(`- Search queries: ${entry.searchQueries.length > 0 ? entry.searchQueries.join(', ') : '(none)'}`);
    if (entry.error) {
      lines.push(`- Error: ${entry.error}`);
    }
    lines.push(`- Outcome: ${entry.outcome.summary} (${entry.outcome.code})`);
    if (entry.authRequired) {
      lines.push(`- Auth: required, available=${entry.authAvailable === null ? 'unknown' : entry.authAvailable ? 'yes' : 'no'}`);
    }
    lines.push(
      `- Budget: maxTriggers=${entry.budget.maxTriggers}, maxCapturedStates=${entry.budget.maxCapturedStates ?? 'unbounded'}, hit=${entry.budget.hit ? 'yes' : 'no'}${entry.budget.stopReason ? `, reason=${entry.budget.stopReason}` : ''}`,
    );
    lines.push(`- Capture: ${entry.capture.status}, ${formatMs(entry.capture.durationMs)}, outDir=${entry.capture.outDir || 'n/a'}`);
    lines.push(`- Expand: ${formatMs(entry.expand.durationMs)}, captured=${entry.expand.capturedStates}, attempted=${entry.expand.attemptedTriggers}, duplicates=${entry.expand.duplicateStates}, noop=${entry.expand.noopTriggers}, failed=${entry.expand.failedTriggers}`);
    lines.push(`- Protocol totals: capture=${entry.capture.metrics.protocolTotal}, expand=${entry.expand.metrics.protocolTotal}`);
    lines.push(`- Helper calls: ensure=${entry.expand.metrics.helperEnsure}, invoke=${entry.expand.metrics.helperInvoke}, retry=${entry.expand.metrics.helperRetry}, fallback=${entry.expand.metrics.helperFallback}`);
    lines.push(`- Wait policies observed: ${entry.expand.metrics.waitPolicies.length}`);
    lines.push(`- Observations: ${entry.outcome.observations.length ? entry.outcome.observations.join(' ; ') : 'none'}`);
    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}
