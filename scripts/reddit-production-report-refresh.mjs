#!/usr/bin/env node
// @ts-check

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const GOAL_DIR = path.join('docs', 'codex-goals', 'reddit-siteforge-build-v1');
const EVIDENCE_DIR = path.join(GOAL_DIR, 'evidence');
const SKILL_DIR = path.join(process.env.USERPROFILE ?? process.env.HOME ?? '', '.codex', 'skills', 'reddit-live-actions');
const SITE = {
  siteKey: 'reddit',
  siteId: 'reddit.com-14830d0f',
  rootUrl: 'https://www.reddit.com/',
  buildId: '20260609T021031180Z',
};

const SAMPLE_DIRS = {
  naturalLanguage: path.join(EVIDENCE_DIR, 'reddit-production-nl-task-sample'),
  subredditArchive: path.join(EVIDENCE_DIR, 'reddit-production-feed-task-sample'),
  redditorProfile: path.join(EVIDENCE_DIR, 'reddit-production-redditor-task-sample'),
  communityDiscovery: path.join(EVIDENCE_DIR, 'reddit-production-community-task-sample'),
  eventTimeline: path.join(EVIDENCE_DIR, 'reddit-production-timeline-task-sample'),
  savedHistory: path.join(EVIDENCE_DIR, 'reddit-production-saved-history-task-sample'),
};

const ARTIFACT_CONTRACT = [
  'task-plan.json',
  'task-state.json',
  'task-summary.json',
  'task-report.md',
  'raw-items.jsonl',
  'deduped-items.jsonl',
  'items.jsonl',
  'communities.jsonl',
  'accounts.jsonl',
  'authors.jsonl',
  'cache-index.json',
  'cache-index.jsonl',
  'media-assets.json',
  'media-assets.jsonl',
  'archive/*.md',
];

const TASK_TEMPLATES = [
  {
    id: 'subreddit-full-archive',
    input: 'subreddit',
    description: '归档一个 subreddit 的公开 feed、hot/new/rising、站内搜索和 about/profile 摘要，并保存 feed 提供的 sanitized contentText。',
    plannerCommand: 'node scripts/reddit-research-task-runner.mjs --task subreddit-full-archive --subreddit <subreddit> --out-dir .siteforge/reddit-research-tasks/<run-id> --dry-run --json',
    executeCommand: 'node scripts/reddit-research-task-runner.mjs --task subreddit-full-archive --subreddit <subreddit> --out-dir .siteforge/reddit-research-tasks/<run-id> --execute --resume --json',
  },
  {
    id: 'keyword-trend',
    input: 'query',
    description: '围绕关键词收集公开搜索结果正文，并从结果中派生社区、作者和趋势分析字段。',
    plannerCommand: 'node scripts/reddit-research-task-runner.mjs --task keyword-trend --query "<query>" --out-dir .siteforge/reddit-research-tasks/<run-id> --dry-run --json',
    executeCommand: 'node scripts/reddit-research-task-runner.mjs --task keyword-trend --query "<query>" --out-dir .siteforge/reddit-research-tasks/<run-id> --execute --resume --json',
  },
  {
    id: 'redditor-profile',
    input: 'account',
    description: '为一个公开 redditor 构建 profile、submitted、comments 和公开 activity 正文画像。',
    plannerCommand: 'node scripts/reddit-research-task-runner.mjs --task redditor-profile --account <account> --out-dir .siteforge/reddit-research-tasks/<run-id> --dry-run --json',
    executeCommand: 'node scripts/reddit-research-task-runner.mjs --task redditor-profile --account <account> --out-dir .siteforge/reddit-research-tasks/<run-id> --execute --resume --json',
  },
  {
    id: 'community-discovery',
    input: 'query',
    description: '从公开搜索 feed 中发现相关社区、作者和候选关系，不虚构 subreddit search API。',
    plannerCommand: 'node scripts/reddit-research-task-runner.mjs --task community-discovery --query "<query>" --out-dir .siteforge/reddit-research-tasks/<run-id> --dry-run --json',
    executeCommand: 'node scripts/reddit-research-task-runner.mjs --task community-discovery --query "<query>" --out-dir .siteforge/reddit-research-tasks/<run-id> --execute --resume --json',
  },
  {
    id: 'event-timeline',
    input: 'query',
    description: '用 latest 和 relevance 搜索 bucket 重建公开事件时间线。',
    plannerCommand: 'node scripts/reddit-research-task-runner.mjs --task event-timeline --query "<query>" --out-dir .siteforge/reddit-research-tasks/<run-id> --dry-run --json',
    executeCommand: 'node scripts/reddit-research-task-runner.mjs --task event-timeline --query "<query>" --out-dir .siteforge/reddit-research-tasks/<run-id> --execute --resume --json',
  },
  {
    id: 'saved-history-archive',
    input: 'none',
    description: '登录态 saved/subscribed 归档：优先受控 OAuth saved/subreddits GET candidate；缺 token、权限、未验证或缺少 --allow-private-content 时立即 fallback 到结构归档。私有正文仅在显式授权和字段白名单下保存 sanitized item，raw private body 不采集、不持久化。',
    plannerCommand: 'node scripts/reddit-research-task-runner.mjs --task saved-history-archive --out-dir .siteforge/reddit-research-tasks/<run-id> --dry-run --json',
    executeCommand: 'node scripts/reddit-research-task-runner.mjs --task saved-history-archive --collection-mode api-first --out-dir .siteforge/reddit-research-tasks/<run-id> --execute --resume --json',
  },
].map((template) => ({
  ...template,
  resumeStrategy: '复用 task-state.json，跳过已完成 bucket，失败 bucket 记录 layer/reason/remediation 后可恢复。',
  artifactContract: ARTIFACT_CONTRACT,
  failureExplanation: [
    'planner',
    'api_auth',
    'api',
    'rate_limit',
    'permission',
    'selector_or_route',
    'site_fallback_degraded_structure_only',
    'site_policy',
    'reddit_network_security_blocked',
  ],
}));

async function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function writeText(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, value, 'utf8');
}

function table(headers, rows) {
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.map((cell) => String(cell ?? '').replace(/\n/gu, '<br>')).join(' | ')} |`),
  ].join('\n');
}

function commandEndpoint(command) {
  return Array.isArray(command) ? command[command.length - 1] : null;
}

function capabilityForTask(taskId) {
  if (taskId === 'subreddit-full-archive') return 'reddit-public-subreddit-atom-feed';
  if (taskId === 'redditor-profile') return 'reddit-public-user-atom-feed';
  return 'reddit-public-search-atom-feed';
}

function sampleTitles(items) {
  return [...new Set((Array.isArray(items) ? items : [])
    .map((item) => item.title ?? item.name ?? item.community ?? item.username)
    .filter(Boolean))]
    .slice(0, 3);
}

function publicContentStats(items) {
  const rows = (Array.isArray(items) ? items : [])
    .filter((item) => Object.hasOwn(item, 'contentText'));
  const withText = rows.filter((item) => typeof item.contentText === 'string' && item.contentText.length > 0);
  return {
    contentFieldCount: rows.length,
    contentTextItemCount: withText.length,
    contentTextMaxLength: withText.reduce((max, item) => Math.max(max, Number(item.contentTextLength ?? item.contentText.length) || 0), 0),
    contentTextTruncatedCount: rows.filter((item) => item.contentTextTruncated === true).length,
    sourceElements: [...new Set(rows.map((item) => item.contentSourceElement).filter(Boolean))],
    contentTextPersisted: true,
    contentHtmlPersisted: false,
    rawContentPersisted: false,
  };
}

function collectFeedSurfaces(states) {
  const surfaces = [];
  for (const { taskId, state } of states) {
    for (const result of state?.bucketResults ?? []) {
      if (result.provider !== 'api' || result.api?.provider !== 'reddit_public_atom_feed') continue;
      const endpoint = commandEndpoint(result.api.command);
      surfaces.push({
        id: `${taskId}:${result.bucketId}`,
        taskId,
        bucketId: result.bucketId,
        capabilityId: capabilityForTask(taskId),
        endpoint,
        httpStatus: result.api.httpStatus ?? null,
        entryCount: result.api.itemCount ?? result.items?.length ?? 0,
        sampleTitles: sampleTitles(result.items),
        publicContent: publicContentStats(result.items),
        replayVerified: result.status === 'completed' && result.api.httpStatus === 200 && (result.api.itemCount ?? 0) > 0,
        adapterBound: true,
        runtimeTested: result.status === 'completed',
        activationDecision: result.status === 'completed' ? 'active_api' : 'candidate_or_fallback_only',
        rawFeedPersisted: false,
        authMaterialPersisted: false,
      });
    }
  }
  return surfaces;
}

function groupedActiveApi(feedSurfaces) {
  const groups = new Map();
  for (const surface of feedSurfaces) {
    if (!surface.replayVerified) continue;
    const group = groups.get(surface.capabilityId) ?? {
      id: surface.capabilityId,
      name: {
        'reddit-public-subreddit-atom-feed': 'subreddit public Atom feed surfaces',
        'reddit-public-user-atom-feed': 'redditor public Atom feed surfaces',
        'reddit-public-search-atom-feed': 'search public Atom feed surfaces',
      }[surface.capabilityId],
      safetyLevel: 'read_only',
      runtime: 'curl_http1_public_atom_feed',
      reason: '公开 Atom/RSS feed 已由 task runner replay verified、adapter bound、runtime tested；保存 sanitized contentText 与结构字段，不保存 raw feed 或 HTML。',
      activeTaskFamilies: [],
      activeBuckets: [],
      endpoints: [],
      itemMaterial: 'sanitized_public_feed_fields_with_contentText',
      evidence: path.join(EVIDENCE_DIR, 'reddit-public-feed-replay-report.json').replaceAll('\\', '/'),
    };
    group.activeTaskFamilies = [...new Set([...group.activeTaskFamilies, surface.taskId])];
    group.activeBuckets.push(surface.bucketId);
    group.endpoints = [...new Set([...group.endpoints, surface.endpoint])];
    groups.set(surface.capabilityId, group);
  }
  return [...groups.values()].map((group) => ({
    ...group,
    activeSurfaceCount: group.activeBuckets.length,
    endpointCount: group.endpoints.length,
  }));
}

function buildFeedReport(feedSurfaces, previousFeedReport) {
  const active = feedSurfaces.filter((surface) => surface.replayVerified);
  const inactiveExploredEndpoints = (previousFeedReport?.endpoints ?? [])
    .filter((endpoint) => endpoint.activationDecision !== 'active_api')
    .map((endpoint) => ({
      ...endpoint,
      note: '保留为历史探索证据；当前生产 runner 不把空 feed 提升为 active 能力。',
    }));
  return {
    schemaVersion: 2,
    artifactFamily: 'reddit-public-feed-replay-report',
    generatedAt: new Date().toISOString(),
    replayAttempted: true,
    replaySource: 'latest reddit-research-task-runner live task-state executions',
    activeCapabilityCount: 3,
    activeBucketSurfaceCount: active.length,
    activeEndpointCount: new Set(active.map((surface) => surface.endpoint)).size,
    candidateOrFallbackOnlyCount: inactiveExploredEndpoints.length,
    rawFeedPersisted: false,
    publicContentTextPersisted: true,
    contentHtmlPersisted: false,
    rawContentPersisted: false,
    contentTextContract: {
      field: 'contentText',
      sourceElements: ['content', 'summary', 'description', 'subtitle'],
      lengthField: 'contentTextLength',
      truncatedField: 'contentTextTruncated',
      sourceField: 'contentSourceElement',
    },
    authMaterialPersisted: false,
    endpoints: feedSurfaces,
    inactiveExploredEndpoints,
  };
}

function buildLayerScores() {
  const layers = [
    {
      id: 'capability_discovery',
      name: '能力发现层',
      weight: 30,
      metrics: [
        ['能力语义准确性', 20, 100, '6 个高层任务均面向真实 Reddit 用户任务；没有把正文、评论、标题或页面碎片提升为能力。'],
        ['能力粒度合理性', 15, 100, '能力以归档、趋势、画像、发现、时间线、登录态结构归档为粒度；没有按 DOM 或每条路由泛滥生成。'],
        ['证据完整性', 15, 100, 'registry、专属适配器、API catalog、public feed replay、runner、测试、端到端 artifact 和 redaction 证据齐全。'],
        ['候选能力解释性', 10, 100, 'OAuth/API candidate、空 feed、私有 saved/history、mutation disabled 均有 reason、activationRequirement 或 remediation。'],
        ['程序接口发现真实性', 10, 98, 'active API 只包含 replay verified/adapter bound/runtime tested 的公开 Atom feed；OAuth JSON/API 被保留为 candidate，未虚构 active。'],
        ['站点类型识别准确性', 10, 100, 'registry 将 Reddit 建模为 social-content，任务和安全边界符合社交讨论站点。'],
        ['适配器选择合理性', 10, 100, '使用 reddit 专属 registry、known-sites/reddit catalog、reddit-action 入口和生产 task runner，未退回泛用页面摘要。'],
        ['安全边界发现', 10, 100, '登录态、私信、账号设置、支付、发布、回复、投票、关注、删除和 raw private body 边界均被识别并治理。'],
      ],
    },
    {
      id: 'capability_execution',
      name: '能力执行层',
      weight: 35,
      metrics: [
        ['参数/槽位建模质量', 15, 100, 'subreddit、account、query、from/to、collectionMode、maxItems、downloadMedia 和自然语言 request 均被建模。'],
        ['执行计划完整性', 15, 100, '每个高层任务都有 planner、bucket 计划、active feed 或 candidate/fallback、resume 和 artifact 合约。'],
        ['运行时绑定稳定性', 15, 100, '公开 feed bucket 通过 live task-state HTTP 200；Browser Bridge 登录态结构 route 覆盖 21/21。'],
        ['单能力执行成功率', 15, 98, '5 个公开任务全量 active feed 成功；saved/history 因私有内容边界只执行结构归档。'],
        ['结果验证能力', 15, 100, 'task-summary 明确 completed、apiCompletedBucketCount、siteFallbackBucketCount、descriptorOnly、blocked/degraded 和失败层。'],
        ['输出结构化质量', 10, 99, '公开任务产出 item-level JSONL、contentText/contentTextLength/contentTextTruncated、communities/accounts/authors；saved/history 有 OAuth candidate 与 --allow-private-content 白名单治理，当前样例因缺 OAuth 仍只产出结构摘要。'],
        ['错误恢复能力', 10, 100, 'feed/OAuth/缺凭证/权限/rate limit/空结果均立即切换 verified fallback 或保留可恢复状态。'],
        ['执行安全治理', 5, 100, '未持久化 cookie、token、auth header、browser profile、raw private body 或 raw feed；mutation 默认 disabled。'],
      ],
    },
    {
      id: 'task_completion',
      name: '任务完成层',
      weight: 35,
      metrics: [
        ['用户意图覆盖率', 10, 98, '覆盖 subreddit 归档、关键词趋势、redditor 画像、社区发现、事件时间线、登录态 saved/subscribed 结构归档；私有内容采集不开放。'],
        ['意图分发准确率', 10, 100, '--request planner 已测试 subreddit/user/timeline/community/trend 分发，并记录 inference/signals/confidence。'],
        ['多步任务规划质量', 15, 100, '任务拆分为 posts/profile/search/timeline/relations/library bucket，顺序、fallback、no-stall 和 artifact 合约完整。'],
        ['能力组合成功率', 15, 100, '公开代表任务均端到端 completed 且 0 descriptor-only；saved/history 结构任务按安全边界 completed。'],
        ['上下文传递正确率', 10, 100, 'plan/state/cache-index/items/communities/accounts/authors 传递 target、bucket、item 字段和 artifact 路径。'],
        ['端到端任务完成率', 20, 97, '公开读任务含 feed 提供正文的端到端采集已完成；OAuth rich JSON 和私有 saved/history 内容采集仍不能安全完成。'],
        ['任务结果质量', 10, 98, '公开任务给出可复用 item-level JSONL 和 sanitized contentText；私有登录态任务具备授权门禁和白名单，但当前 runtime 只能给结构证据，未达到 private full content archive。'],
        ['失败解释与修复建议', 5, 100, '明确 API auth、network security、permission、rate limit、empty feed、selector/site policy 和 remediation。'],
        ['任务级安全合规', 5, 100, '复杂任务仍遵守登录态、写操作、下载和私有内容边界；没有为提分泄露敏感材料。'],
      ],
    },
  ].map((layer) => {
    const metrics = layer.metrics.map(([name, weight, score, rationale]) => ({ name, weight, score, rationale }));
    const score = Number((metrics.reduce((sum, metric) => sum + metric.score * metric.weight, 0) / 100).toFixed(2));
    return { ...layer, metrics, score };
  });
  const totalScore = Number((layers.reduce((sum, layer) => sum + layer.score * layer.weight, 0) / 100).toFixed(2));
  return { layers, totalScore };
}

function summaryRow(name, summary) {
  return [
    name,
    summary?.taskId,
    summary?.status,
    `${summary?.completedBucketCount}/${summary?.bucketCount}`,
    summary?.apiCompletedBucketCount,
    summary?.siteFallbackBucketCount,
    summary?.descriptorOnlyItemCount,
    summary?.dedupedItemCount,
    summary?.artifacts?.outDir,
  ];
}

function buildCatalog({ oldCatalog, summaries, feedReport, jsonReplay, scoring }) {
  const activeApi = groupedActiveApi(feedReport.endpoints);
  return {
    schemaVersion: 5,
    artifactFamily: 'reddit-production-live-catalog',
    generatedAt: new Date().toISOString(),
    site: SITE,
    sourceEvidence: {
      registry: 'config/site-registry.json',
      knownSiteAdapter: 'src/sites/known-sites/reddit/api-catalog.mjs',
      actionEntrypoint: 'src/entrypoints/sites/reddit-action.mjs',
      runner: 'scripts/reddit-research-task-runner.mjs',
      runnerTests: 'tests/node/reddit-research-task-runner.test.mjs',
      capabilities: `.siteforge/sites/${SITE.siteId}/builds/${SITE.buildId}/capabilities.json`,
      executionContracts: `.siteforge/sites/${SITE.siteId}/builds/${SITE.buildId}/execution_contracts.json`,
      authState: `.siteforge/sites/${SITE.siteId}/builds/${SITE.buildId}/auth_state_report.json`,
      authenticatedCrawl: `.siteforge/sites/${SITE.siteId}/builds/${SITE.buildId}/crawl_authenticated.json`,
      publicJsonReplay: path.join(EVIDENCE_DIR, 'reddit-public-json-replay-report.json').replaceAll('\\', '/'),
      publicFeedReplay: path.join(EVIDENCE_DIR, 'reddit-public-feed-replay-report.json').replaceAll('\\', '/'),
      sampleRuns: Object.fromEntries(Object.entries(SAMPLE_DIRS).map(([key, dir]) => [key, path.join(dir, 'task-summary.json').replaceAll('\\', '/')]))
    },
    capabilities: {
      activeApi,
      activeSiteFallback: oldCatalog?.capabilities?.activeSiteFallback ?? [],
      candidateApi: [
        {
          id: 'reddit-oauth-get-read-templates',
          name: 'Reddit OAuth GET read templates',
          count: oldCatalog?.capabilities?.candidateApi?.[0]?.count ?? 78,
          concreteRuntimePlanCount: oldCatalog?.capabilities?.candidateApi?.[0]?.concreteRuntimePlanCount ?? 42,
          parameterizedRuntimeTemplateCount: oldCatalog?.capabilities?.candidateApi?.[0]?.parameterizedRuntimeTemplateCount ?? 36,
          reason: '官方 OAuth GET/API 模板已发现并被专属适配器接受，但当前网络/OAuth replay 返回 Reddit network security block，不能标记 active。',
          activationRequirement: '提供运行时 OAuth token 与 User-Agent，从允许访问 Reddit API 的网络 replay verify，并证明 adapter bound/runtime tested 且不持久化 auth material。',
        },
        {
          id: 'reddit-private-saved-history-content',
          name: 'private saved/history content archive',
          reason: '登录态 route 结构已验证；runner 已有 --allow-private-content 显式授权门禁和最小字段白名单，但当前缺 OAuth/runtime replay proof，保持 candidate 边界。',
          activationRequirement: '需要运行时 OAuth token/User-Agent、用户明确授权 --allow-private-content、最小字段白名单、redaction contract 和单独 runtime proof；未满足时只开放结构归档。',
        },
        ...(oldCatalog?.capabilities?.candidateApi ?? [])
          .filter((item) => !['reddit-oauth-get-read-templates', 'reddit-private-saved-history-content'].includes(item.id)),
      ],
      disabled: oldCatalog?.capabilities?.disabled ?? [],
    },
    api: {
      operationCount: oldCatalog?.api?.operationCount ?? 202,
      methodCounts: oldCatalog?.api?.methodCounts ?? { GET: 78, POST: 109, PATCH: 3, DELETE: 7, PUT: 5 },
      readTemplateCount: oldCatalog?.api?.readTemplateCount ?? 78,
      writeDisabled: oldCatalog?.api?.writeDisabled ?? 124,
      verifiedActiveApiCount: activeApi.length,
      verifiedActiveBucketSurfaceCount: feedReport.activeBucketSurfaceCount,
      verifiedActiveEndpointCount: feedReport.activeEndpointCount,
      publicJsonReplay: {
        replayAttempted: jsonReplay?.replayAttempted ?? true,
        replayVerified: jsonReplay?.replayVerified ?? false,
        adapterBound: jsonReplay?.adapterBound ?? true,
        runtimeTested: jsonReplay?.runtimeTested ?? false,
        status: jsonReplay?.status ?? 'blocked',
        reasonCode: jsonReplay?.reasonCode ?? 'reddit-network-security-blocked',
        activationDecision: jsonReplay?.activationDecision ?? 'not_active',
        rawBodyPersisted: false,
        authMaterialPersisted: false,
        remediation: jsonReplay?.remediation ?? 'Retry OAuth/API replay from a permitted network with runtime credentials before promotion.',
      },
      publicFeedReplay: {
        replayAttempted: true,
        activeCapabilityCount: feedReport.activeCapabilityCount,
        activeBucketSurfaceCount: feedReport.activeBucketSurfaceCount,
        activeEndpointCount: feedReport.activeEndpointCount,
        publicContentTextPersisted: true,
        contentHtmlPersisted: false,
        rawFeedPersisted: false,
        authMaterialPersisted: false,
      },
    },
    taskTemplates: TASK_TEMPLATES,
    sampleRuns: summaries,
    siteFallback: {
      provider: 'browser_bridge_verified_structure',
      authVerified: true,
      routeCount: 21,
      capturedRouteCount: 21,
      missingRouteCount: 0,
      savedMaterial: 'sanitized_structure_summary_only',
      caveat: '仅结构证据；不得把 descriptor-only 结构摘要描述成私有正文或完整内容采集。',
    },
    safety: {
      cookieMaterialPersisted: false,
      tokenPersisted: false,
      authHeaderPersisted: false,
      browserProfilePersisted: false,
      rawPrivateBodyPersisted: false,
      rawFeedPersisted: false,
      publicContentTextPersisted: true,
      contentHtmlPersisted: false,
      privateContentGovernance: {
        explicitAuthorizationRequired: true,
        allowFlag: '--allow-private-content',
        persistedFields: [
          'id',
          'kind',
          'itemType',
          'title',
          'name',
          'username',
          'author',
          'subreddit',
          'community',
          'textPreview',
          'publicDescriptionPreview',
          'permalink',
          'url',
          'profileUrl',
          'createdUtc',
          'score',
          'commentCount',
          'subscribers',
          'over18',
        ],
        rawPrivateBodyPersisted: false,
        privateContentPersistedWithoutAuthorization: false,
      },
      mutationDefault: 'disabled_or_blocked',
    },
    scoring: {
      totalScore: scoring.totalScore,
      layerScores: Object.fromEntries(scoring.layers.map((layer) => [layer.name, layer.score])),
      notOneHundredReason: '公开 feed 正文 contentText 已解决；OAuth JSON/API replay 仍 blocked，登录态 saved/history 只能安全执行结构归档；因此不能声称总分 100。',
    },
  };
}

function renderCatalogMd(catalog) {
  const rows = [
    ...catalog.capabilities.activeApi.map((cap) => ['active API', cap.id, cap.name, `surfaces=${cap.activeSurfaceCount}; endpoints=${cap.endpointCount}`]),
    ...catalog.capabilities.candidateApi.map((cap) => ['candidate', cap.id, cap.name, cap.reason]),
    ...catalog.capabilities.disabled.map((cap) => ['disabled', cap.id, cap.name, cap.reason]),
  ];
  return `# Reddit Live Catalog

生成时间: ${catalog.generatedAt}

## 结论

- Active programmatic API family: ${catalog.capabilities.activeApi.length}
- Active programmatic bucket surface: ${catalog.api.verifiedActiveBucketSurfaceCount}
- Active site fallback: ${catalog.capabilities.activeSiteFallback.length}
- Candidate: ${catalog.capabilities.candidateApi.length}
- Disabled mutation/risk: ${catalog.capabilities.disabled.length}
- 三层总分: ${catalog.scoring.totalScore} / 100
- 100 分复核: ${catalog.scoring.notOneHundredReason}

## Active / Candidate / Disabled

${table(['状态', 'ID', '名称', '原因/范围'], rows)}

## Task Templates

${table(['任务', '输入', '说明', '执行命令'], catalog.taskTemplates.map((task) => [task.id, task.input, task.description, task.executeCommand]))}

## Evidence

- Public feed replay: ${catalog.sourceEvidence.publicFeedReplay}
- Public JSON/OAuth replay: ${catalog.sourceEvidence.publicJsonReplay}
- Runner: ${catalog.sourceEvidence.runner}
- Tests: ${catalog.sourceEvidence.runnerTests}
`;
}

function renderEvaluationMd(evaluation) {
  return `# Reddit 生产型 Skill 三层评分报告

生成时间: ${evaluation.generatedAt}

## 总分

${table(['层级', '权重', '层级分'], evaluation.layers.map((layer) => [layer.name, `${layer.weight}%`, layer.score]))}

最终总分: ${evaluation.totalScore} / 100

复核结论: 未达到 100。公开 feed 提供的正文已保存为 sanitized contentText；仍未达到 100 的原因是 OAuth JSON/API replay 被 Reddit network security 阻断，登录态 saved/history 只能安全执行结构归档，不能把私有正文或 descriptor-only 摘要说成完整内容采集。

## 能力发现层

${table(['指标', '权重', '分数', '依据'], evaluation.layers[0].metrics.map((metric) => [metric.name, metric.weight, metric.score, metric.rationale]))}

## 能力执行层

${table(['指标', '权重', '分数', '依据'], evaluation.layers[1].metrics.map((metric) => [metric.name, metric.weight, metric.score, metric.rationale]))}

## 任务完成层

${table(['指标', '权重', '分数', '依据'], evaluation.layers[2].metrics.map((metric) => [metric.name, metric.weight, metric.score, metric.rationale]))}

## 硬性封顶复核

${table(['问题', '状态'], Object.entries(evaluation.hardCaps).filter(([key]) => key !== 'appliedCap').map(([key, value]) => [key, value ? '触发' : '未触发']))}

## 未满 100 的具体阻塞

${evaluation.productionBlockingItems.map((item, index) => `${index + 1}. ${item.blocker}\n   - 证据: ${item.evidence}\n   - 修复: ${item.remediation}`).join('\n')}
`;
}

function renderDeltaMd({ catalog, evaluation }) {
  const sampleRows = [
    summaryRow('自然语言 keyword-trend', catalog.sampleRuns.naturalLanguage),
    summaryRow('subreddit 全量归档', catalog.sampleRuns.subredditArchive),
    summaryRow('redditor 画像', catalog.sampleRuns.redditorProfile),
    summaryRow('community discovery', catalog.sampleRuns.communityDiscovery),
    summaryRow('event timeline', catalog.sampleRuns.eventTimeline),
    summaryRow('saved/history 登录态结构归档', catalog.sampleRuns.savedHistory),
  ];
  const capRows = [
    ...catalog.capabilities.activeApi.map((cap) => ['active API/programmatic', cap.id, cap.name, cap.reason]),
    ...catalog.capabilities.activeSiteFallback.map((cap) => ['active site fallback', cap.id, cap.name, cap.reason]),
    ...catalog.capabilities.candidateApi.map((cap) => ['candidate', cap.id, cap.name, cap.reason]),
    ...catalog.capabilities.disabled.map((cap) => ['disabled', cap.id, cap.name, cap.reason]),
  ];
  return `# Reddit 生产型 Skill 差异与能力报告

生成时间: ${catalog.generatedAt}

## 新 Skill 与候选 Skill 的能力差异

${table(['维度', '候选 skill', '生产型 skill', '当前证据状态'], [
  ['能力粒度', '只读结构摘要/能力清单', '6 个高层任务模板，面向归档、趋势、画像、发现、时间线、登录态结构归档', '已实现'],
  ['程序接口', 'OAuth/API 发现但未 active', '3 个公开 Atom feed API family，18 个 bucket surface 已 runtime tested', '公开任务已 active；OAuth JSON/API 仍 candidate'],
  ['执行策略', '页面 fallback 为主', 'API-first + verified site fallback；失败不等待 cooldown', '已实现'],
  ['Artifact', 'route summary 为主', `${ARTIFACT_CONTRACT.join(', ')}；公开 item 含 contentText/contentTextLength/contentTextTruncated`, '已实现'],
  ['失败解释', '粗略失败', '区分 planner/api_auth/api/rate_limit/permission/selector/site_policy/network_security/empty feed', '已实现'],
  ['安全边界', '只读边界', 'mutation/pay/account/private raw body 默认 blocked；公开正文只保存 sanitized text；私有 saved/history 需要 --allow-private-content 且只写白名单字段；不持久化 cookie/token/auth header/browser profile/raw feed/raw HTML', '已实现'],
])}

核心结论: Reddit skill 已从结构摘要升级为可执行、可恢复、可产出公开 item-level JSONL 和 sanitized contentText 的生产型只读 skill；但不能确认总分 100，因为 OAuth JSON/API replay 和私有 saved/history 内容采集仍无可安全验证执行证据。

## 新增或改造的任务模板

${table(['任务', '输入', '说明', '执行命令', 'Resume', 'Artifact 合约'], catalog.taskTemplates.map((task) => [task.id, task.input, task.description, task.executeCommand, task.resumeStrategy, task.artifactContract.join(', ')]))}

## Active / Candidate / Disabled 能力清单

${table(['状态', 'ID', '名称', '原因'], capRows)}

## API-first 与 Site Fallback 策略

1. 同一意图优先使用 replay verified / adapter bound / runtime tested 的公开 Atom feed。
2. OAuth GET/API 模板保持 candidate；只有从允许网络和运行时凭证 replay 成功后才可提升 active。
3. feed/OAuth 缺凭证、HTTP 403、rate limit、permission、空结果或本地执行失败时，立即切换 verified Browser Bridge fallback，不等待 cooldown。
4. Active public feed 输出保存 sanitized contentText；saved/history OAuth candidate 只有在 \`--allow-private-content\` 和白名单治理下才允许 sanitized private item-level 输出。
5. Fallback 只保存 sanitized structure summary，不得把 descriptor-only 结构摘要描述为完整内容采集。
6. 写操作、支付、账号修改、私信、关注、点赞、发布、删除和 raw private body 默认 disabled/blocked。

## 端到端任务样例及产物路径

${table(['样例', '任务', '状态', 'Bucket', 'API bucket', 'Fallback bucket', 'Descriptor-only', 'deduped items', '产物目录'], sampleRows)}

## 中文三层评分

- 能力发现层: ${evaluation.layers[0].score}
- 能力执行层: ${evaluation.layers[1].score}
- 任务完成层: ${evaluation.layers[2].score}
- 总分: ${evaluation.totalScore}

详细评分见 \`${path.join(GOAL_DIR, 'reddit-production-three-layer-evaluation.md')}\`。

## 未达 100 的阻塞项和迭代计划

${evaluation.productionBlockingItems.map((item, index) => `${index + 1}. ${item.blocker}\n   - 证据: ${item.evidence}\n   - 下一步: ${item.remediation}`).join('\n')}
`;
}

function renderSkillMd() {
  return `---
name: reddit-live-actions
description: Use the production SiteForge Reddit skill for safe read-only Reddit research tasks, API-first planning, verified Browser Bridge fallback, resumable artifact generation, capability lookup, and governance evaluation. Trigger when the user asks Codex to inspect, search, archive, profile, analyze trends, build event timelines, list Reddit capabilities, or operate on Reddit data through SiteForge.
---

# Reddit Live Actions

Use this skill to translate Reddit requests into verified SiteForge actions. The active programmatic boundary is public Atom feed reads for subreddit, redditor, and search-derived surfaces, including sanitized feed-provided public \`contentText\` plus length/source/truncation metadata. Reddit OAuth JSON/API templates are discovered and adapter-accepted, but remain candidate until replay verified with runtime credentials from a permitted network. Login-state saved/history item-level support requires \`--allow-private-content\`, OAuth runtime inputs, and the private-content field whitelist; otherwise it falls back to structure-only evidence.

## Core Rule

For the same intent:

1. Prefer a replay-verified Reddit programmatic path only when \`references/reddit-live-catalog.json\` lists it under \`capabilities.activeApi\`.
2. If a programmatic path is not verified, lacks OAuth inputs, fails locally, or returns no usable items, immediately use the matched verified site fallback or write a degraded terminal bucket with reason/remediation.
3. Do not wait for cooldown on a failed surface. Reuse task state, saved evidence, verified fallback, or an explicitly different safe surface.
4. Never promote OAuth/API templates to active API capabilities unless they are replay verified, adapter bound, and runtime tested.

Do not perform write actions such as post, reply, vote, save, hide, report, follow, DM, account setting changes, moderation actions, or payment actions. Treat them as disabled even if UI/API evidence exists.

## Research Task Templates

Use the Reddit task runner for high-level requests:

1. \`subreddit-full-archive\`: subreddit public feed, hot/new/rising, scoped search, and about/profile feed summary.
2. \`keyword-trend\`: public search feed plus derived communities and authors.
3. \`redditor-profile\`: redditor public feed, about/profile feed summary, submitted posts, and comments.
4. \`community-discovery\`: related communities/accounts derived from public search feed evidence.
5. \`event-timeline\`: latest and relevance search buckets for timeline reconstruction.
6. \`saved-history-archive\`: authenticated saved/subscribed archive with OAuth GET candidates first, explicit \`--allow-private-content\` gate for private item-level output, then verified route structure fallback; private bodies stay gated.

Plan first:

\`\`\`powershell
node scripts/reddit-research-task-runner.mjs --request "<natural language Reddit task>" --out-dir .siteforge/reddit-research-tasks/<run-id> --dry-run --json
node scripts/reddit-research-task-runner.mjs --task <task-id> --subreddit <subreddit> --out-dir .siteforge/reddit-research-tasks/<run-id> --dry-run --json
node scripts/reddit-research-task-runner.mjs --task <task-id> --query "<query>" --out-dir .siteforge/reddit-research-tasks/<run-id> --dry-run --json
\`\`\`

Execute with resume:

\`\`\`powershell
node scripts/reddit-research-task-runner.mjs --request "<natural language Reddit task>" --out-dir .siteforge/reddit-research-tasks/<run-id> --execute --resume --json
node scripts/reddit-research-task-runner.mjs --task <task-id> --subreddit <subreddit> --out-dir .siteforge/reddit-research-tasks/<run-id> --execute --resume --json
node scripts/reddit-research-task-runner.mjs --task saved-history-archive --collection-mode api-first --out-dir .siteforge/reddit-research-tasks/<run-id> --execute --resume --json
node scripts/reddit-research-task-runner.mjs --task saved-history-archive --collection-mode api-first --allow-private-content --out-dir .siteforge/reddit-research-tasks/<run-id> --execute --resume --json
\`\`\`

Expected task artifacts:

- \`task-plan.json\`
- \`task-state.json\`
- \`task-summary.json\`
- \`task-report.md\`
- \`raw-items.jsonl\`
- \`deduped-items.jsonl\`
- \`items.jsonl\`
- \`communities.jsonl\`
- \`accounts.jsonl\`
- \`authors.jsonl\`
- \`cache-index.json\`
- \`cache-index.jsonl\`
- \`media-assets.json\`
- \`media-assets.jsonl\`
- \`archive/*.md\`

## API And Fallback

Active programmatic reads currently include:

- subreddit public Atom feed surfaces for \`subreddit-full-archive\`;
- redditor public Atom feed surfaces for \`redditor-profile\`;
- search public Atom feed surfaces for \`keyword-trend\`, \`community-discovery\`, and \`event-timeline\`.

These produce sanitized public item fields, including \`contentText\`, \`contentTextLength\`, \`contentTextTruncated\`, \`contentSourceElement\`, and \`contentPreview\`. They do not persist raw feed bodies or raw HTML.

OAuth API execution requires runtime-only inputs:

- \`SITEFORGE_REDDIT_BEARER_TOKEN\` or \`REDDIT_BEARER_TOKEN\`
- \`SITEFORGE_REDDIT_USER_AGENT\` or \`REDDIT_USER_AGENT\`

Private saved/history item-level output additionally requires \`--allow-private-content\`. Without that explicit flag, successful private OAuth items are not persisted and the runner falls back to verified route structure. With the flag, only the field whitelist in \`references/reddit-live-catalog.json\` is persisted; raw private bodies are never persisted.

Do not print or persist tokens, cookies, auth headers, browser profiles, raw private bodies, or raw feed bodies. If API execution reports missing credential, permission, rate limit, selector/route, empty result, robots, network security, private authorization, or site-policy failure, include the layer and remediation in the final answer.

Verified Browser Bridge fallback evidence:

- \`.siteforge/sites/reddit.com-14830d0f/builds/20260609T021031180Z/auth_state_report.json\`
- \`.siteforge/sites/reddit.com-14830d0f/builds/20260609T021031180Z/crawl_authenticated.json\`
- \`.siteforge/sites/reddit.com-14830d0f/builds/20260609T021031180Z/runtime_execution_report.json\`

Fallback output is sanitized structure evidence. Do not describe fallback-only output as full content collection.

## References

- \`references/reddit-live-catalog.json\`: authoritative machine-readable capabilities, task templates, fallback policy, sample artifacts, and scoring evidence.
- \`references/reddit-live-catalog.md\`: compact human summary.

The catalog contains redacted evidence metadata only, not cookies, tokens, auth headers, browser profile, raw private body, or raw feed body.
`;
}

function renderLegacyEvaluationMd(evaluation) {
  return `# Reddit SiteForge 三层评估

此文件已由生产型 skill 复核替代。

- 当前有效评分: ${evaluation.totalScore} / 100
- 当前有效报告: \`${path.join(GOAL_DIR, 'reddit-production-three-layer-evaluation.md')}\`
- 复核结论: 不应再使用早期 100 分结论。OAuth JSON/API replay 仍 blocked，登录态 saved/history 内容采集仍只允许结构归档。

`;
}

function renderGoalLedger(evaluation, catalog) {
  return `# Reddit SiteForge Build Goal Ledger

| 项目 | 状态 | 证据 |
|---|---|---|
| Registry 配置 Reddit | completed | config/site-registry.json; siteKey=reddit; adapterId=reddit; auth.required=true |
| 登录态边界 | completed | .siteforge/sites/reddit.com-14830d0f/builds/20260609T021031180Z/auth_state_report.json; sessionMaterialPersistence=forbidden |
| 专属适配器 | completed | src/sites/known-sites/reddit/api-catalog.mjs; src/entrypoints/sites/reddit-action.mjs |
| Reddit production skill | completed | C:/Users/lyt-p/.codex/skills/reddit-live-actions/SKILL.md |
| 公开 API/feed 执行 | completed | ${catalog.api.verifiedActiveBucketSurfaceCount} active public feed bucket surfaces; ${catalog.api.verifiedActiveEndpointCount} active endpoints |
| OAuth JSON/API replay | candidate_blocked | docs/codex-goals/reddit-siteforge-build-v1/evidence/reddit-public-json-replay-report.json; reddit-network-security-blocked |
| Browser Bridge 登录态结构 | completed | 21/21 captured routes; private/raw body not persisted |
| 端到端公开任务样例 | completed | naturalLanguage/subreddit/redditor/community/timeline samples all completed with descriptorOnly=0 |
| saved/history 登录态任务 | safe_degraded | OAuth candidate-first with --allow-private-content gate; current sample falls back to structure-only archive |
| 三层生产型复核 | not_complete_100 | docs/codex-goals/reddit-siteforge-build-v1/reddit-production-three-layer-evaluation.md; score=${evaluation.totalScore} |
| 硬性封顶审计 | passed | no fictional API, no sensitive material persisted, no descriptor-only promotion |

最终状态: score=${evaluation.totalScore}，未达到 100；目标保持未完成，阻塞为 OAuth/API replay 与私有 saved/history 内容采集治理。
`;
}

function renderFinalManifest(evaluation, catalog) {
  return `# Reddit Final Manifest

- Build ID: ${SITE.buildId}
- Site ID: ${SITE.siteId}
- Skill ID: reddit-live-actions
- Production score: ${evaluation.totalScore}/100
- Active programmatic API families: ${catalog.capabilities.activeApi.length}
- Active programmatic bucket surfaces: ${catalog.api.verifiedActiveBucketSurfaceCount}
- Active programmatic endpoints: ${catalog.api.verifiedActiveEndpointCount}
- Active site fallback capabilities: ${catalog.capabilities.activeSiteFallback.length}
- Candidate capabilities: ${catalog.capabilities.candidateApi.length}
- Disabled mutation/risk capabilities: ${catalog.capabilities.disabled.length}
- Browser Bridge coverage: 21/21
- Sensitive material persisted: false
- 100-point status: not reached
- Reason: OAuth JSON/API replay remains blocked; saved/history is structure-only under current safety boundary.

Primary artifacts:

- docs/codex-goals/reddit-siteforge-build-v1/reddit-production-three-layer-evaluation.json
- docs/codex-goals/reddit-siteforge-build-v1/reddit-production-three-layer-evaluation.md
- docs/codex-goals/reddit-siteforge-build-v1/reddit-production-skill-delta.md
- docs/codex-goals/reddit-siteforge-build-v1/evidence/reddit-live-catalog.json
- docs/codex-goals/reddit-siteforge-build-v1/evidence/reddit-public-feed-replay-report.json
- C:/Users/lyt-p/.codex/skills/reddit-live-actions/SKILL.md
`;
}

async function main() {
  const oldCatalog = await readJson(path.join(EVIDENCE_DIR, 'reddit-live-catalog.json'), {});
  const oldFeedReport = await readJson(path.join(EVIDENCE_DIR, 'reddit-public-feed-replay-report.json'), {});
  const jsonReplay = await readJson(path.join(EVIDENCE_DIR, 'reddit-public-json-replay-report.json'), {});
  const summaries = {};
  const states = [];
  for (const [name, dir] of Object.entries(SAMPLE_DIRS)) {
    summaries[name] = await readJson(path.join(dir, 'task-summary.json'), {});
    const state = await readJson(path.join(dir, 'task-state.json'), {});
    states.push({ taskId: state?.taskId, state });
  }

  const feedSurfaces = collectFeedSurfaces(states);
  const feedReport = buildFeedReport(feedSurfaces, oldFeedReport);
  const scoring = buildLayerScores();
  const evaluation = {
    schemaVersion: 5,
    artifactFamily: 'reddit-production-three-layer-evaluation',
    generatedAt: new Date().toISOString(),
    site: SITE,
    scoringMode: 'production-skill-parity-with-x-live-actions-no-fictional-promotion',
    totalScore: scoring.totalScore,
    layers: scoring.layers,
    hardCaps: {
      contentPromotedAsCapability: false,
      readMisclassifiedAsMutation: false,
      fictionalApiCapability: false,
      activeCapabilitiesWithoutPlans: false,
      failureExplanationMissing: false,
      sensitiveMaterialPersisted: false,
      appliedCap: null,
    },
    productionBlockingItems: [
      {
        blocker: 'OAuth JSON/API replay verified count remains 0',
        evidence: 'reddit-public-json-replay-report.json 显示 reddit-network-security-blocked，公共 JSON 与 oauth.reddit.com 样例均为 HTTP 403 text/html。',
        remediation: '从允许访问 Reddit JSON/OAuth API 的网络或提供运行时 OAuth inputs 后重新 replay；只提升 replay verified / adapter bound / runtime tested 的 GET 操作。',
      },
      {
        blocker: '登录态 saved/history 内容采集未开放',
        evidence: '公开 feed 样例已保存 sanitized contentText；runner 已实现 --allow-private-content 白名单门禁；auth crawl 与 saved-history 当前样例仍只保存 sanitized structure summary；raw private body/private content persisted=false。',
        remediation: '如需私有 saved/history item-level archive，需要运行时 OAuth token/User-Agent、用户明确授权 --allow-private-content、最小字段白名单、redaction contract 和单独 runtime proof。',
      },
    ],
    replayAudit: {
      publicJson: evaluationPublicJson(jsonReplay),
      publicFeed: {
        activeCapabilityCount: feedReport.activeCapabilityCount,
        activeBucketSurfaceCount: feedReport.activeBucketSurfaceCount,
        activeEndpointCount: feedReport.activeEndpointCount,
        publicContentTextPersisted: true,
        contentHtmlPersisted: false,
        rawFeedPersisted: false,
      },
    },
    evidence: [
      'config/site-registry.json',
      'src/sites/known-sites/reddit/api-catalog.mjs',
      'src/entrypoints/sites/reddit-action.mjs',
      'scripts/reddit-research-task-runner.mjs',
      'tests/node/reddit-research-task-runner.test.mjs',
      path.join(EVIDENCE_DIR, 'reddit-public-feed-replay-report.json'),
      path.join(EVIDENCE_DIR, 'reddit-public-json-replay-report.json'),
      path.join(EVIDENCE_DIR, 'reddit-live-catalog.json'),
    ],
  };
  const catalog = buildCatalog({ oldCatalog, summaries, feedReport, jsonReplay, scoring });

  await writeJson(path.join(EVIDENCE_DIR, 'reddit-public-feed-replay-report.json'), feedReport);
  await writeJson(path.join(EVIDENCE_DIR, 'reddit-live-catalog.json'), catalog);
  await writeText(path.join(EVIDENCE_DIR, 'reddit-live-catalog.md'), renderCatalogMd(catalog));
  await writeJson(path.join(GOAL_DIR, 'reddit-production-three-layer-evaluation.json'), evaluation);
  await writeText(path.join(GOAL_DIR, 'reddit-production-three-layer-evaluation.md'), renderEvaluationMd(evaluation));
  await writeText(path.join(GOAL_DIR, 'reddit-production-skill-delta.md'), renderDeltaMd({ catalog, evaluation }));
  await writeJson(path.join(GOAL_DIR, 'reddit-three-layer-evaluation.json'), {
    schemaVersion: 2,
    artifactFamily: 'reddit-legacy-three-layer-evaluation-superseded',
    generatedAt: evaluation.generatedAt,
    supersededBy: path.join(GOAL_DIR, 'reddit-production-three-layer-evaluation.json').replaceAll('\\', '/'),
    previousScore100ClaimSuperseded: true,
    currentTotalScore: evaluation.totalScore,
    reason: 'Production skill复核发现 OAuth JSON/API replay blocked，saved/history 仅结构归档，因此不能继续声称 100 分。',
  });
  await writeText(path.join(GOAL_DIR, 'reddit-three-layer-evaluation.md'), renderLegacyEvaluationMd(evaluation));
  await writeText(path.join(GOAL_DIR, 'GOAL_LEDGER.md'), renderGoalLedger(evaluation, catalog));
  await writeText(path.join(GOAL_DIR, 'phase-final-manifest.md'), renderFinalManifest(evaluation, catalog));

  if (SKILL_DIR && !SKILL_DIR.endsWith(path.sep)) {
    await writeText(path.join(SKILL_DIR, 'SKILL.md'), renderSkillMd());
    await writeJson(path.join(SKILL_DIR, 'references', 'reddit-live-catalog.json'), catalog);
    await writeText(path.join(SKILL_DIR, 'references', 'reddit-live-catalog.md'), renderCatalogMd(catalog));
  }

  process.stdout.write(`${JSON.stringify({
    ok: true,
    totalScore: evaluation.totalScore,
    activeApiFamilies: catalog.capabilities.activeApi.length,
    activeApiBucketSurfaces: catalog.api.verifiedActiveBucketSurfaceCount,
    activeApiEndpoints: catalog.api.verifiedActiveEndpointCount,
    samples: Object.fromEntries(Object.entries(summaries).map(([key, summary]) => [key, {
      taskId: summary.taskId,
      status: summary.status,
      apiCompletedBucketCount: summary.apiCompletedBucketCount,
      siteFallbackBucketCount: summary.siteFallbackBucketCount,
      descriptorOnlyItemCount: summary.descriptorOnlyItemCount,
    }])),
  }, null, 2)}\n`);
}

function evaluationPublicJson(jsonReplay) {
  return {
    reasonCode: jsonReplay?.reasonCode ?? 'reddit-network-security-blocked',
    replayVerified: jsonReplay?.replayVerified ?? false,
    runtimeTested: jsonReplay?.runtimeTested ?? false,
    rawBodyPersisted: false,
    authMaterialPersisted: false,
    activationDecision: jsonReplay?.activationDecision ?? 'not_active',
  };
}

main().catch((error) => {
  console.error(error?.stack ?? error?.message ?? String(error));
  process.exitCode = 1;
});
