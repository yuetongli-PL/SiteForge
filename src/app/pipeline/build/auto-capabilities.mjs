// @ts-check

import {
  applyRiskDefaults,
  buildCapabilitySafeRemediationPath,
  CAPABILITY_ENABLEMENT_STATUSES,
  capabilityEnablementStatusCounts,
  isCallableEnablementStatus,
  normalizeCapabilityEnablementStatus,
  normalizeCapabilityEvidenceStatus,
  publicSafeRemediation,
  riskPolicyForLevel,
} from './risk-policy.mjs';
import {
  BUILD_SCHEMA_VERSION,
  buildEvidence,
  sha256Short,
  stableCapabilityId,
  stableIntentId,
} from './models.mjs';
import { slugifyAscii } from '../../../shared/normalize.mjs';

function uniqueBy(values, keyFn) {
  const seen = new Set();
  const result = /** @type {any[]} */ ([]);
  for (const value of values) {
    const key = keyFn(value);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(value);
  }
  return result;
}

function normalizeLabelKey(value) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^a-z0-9\u3400-\u9fff]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function hasCjkText(value) {
  return /[\u3400-\u9fff]/u.test(String(value ?? ''));
}

const USER_FACING_LABELS_ZH = Object.freeze(new Map([
  ['view homepage', '查看站点首页'],
  ['view news homepage', '查看新闻首页'],
  ['browse news channels', '浏览新闻频道'],
  ['view news article details', '查看新闻正文'],
  ['browse products', '浏览商品列表'],
  ['search products', '搜索商品'],
  ['view product detail', '查看商品详情'],
  ['contact support', '创建客服消息草稿'],
  ['capture network apis', '脱敏网络接口候选'],
  ['list followed users', '读取关注列表'],
  ['read followed users', '读取关注列表'],
  ['list followed updates', '读取关注动态'],
  ['read following timeline', '读取关注时间线'],
  ['list following timeline posts', '读取关注时间线'],
  ['read followers', '读取粉丝列表'],
  ['list account followers', '读取粉丝列表'],
  ['list explore topics', '读取探索话题'],
  ['list recommended timeline posts', '读取推荐时间线帖子'],
  ['read recommended timeline', '读取推荐时间线'],
  ['list profile content', '读取个人主页内容'],
  ['read profile content', '读取个人主页内容'],
  ['search posts', '搜索帖子'],
  ['list notifications', '读取通知摘要'],
  ['read all notifications summary', '读取全部通知摘要'],
  ['list bookmarks', '读取书签摘要'],
  ['read bookmarks summary', '读取书签摘要'],
  ['list lists', '读取列表摘要'],
  ['read lists summary', '读取列表摘要'],
  ['list direct messages', '读取私信会话列表摘要'],
  ['read direct message conversation summaries', '读取私信会话列表摘要'],
  ['read direct message detail', '读取私信详情'],
  ['create direct message draft', '创建私信草稿'],
  ['draft direct message', '创建私信草稿'],
  ['send direct message', '自动发送私信'],
  ['view post detail', '读取帖子详情'],
  ['view post replies', '读取帖子回复'],
  ['view post media', '读取帖子媒体摘要'],
  ['follow account', '关注账号'],
  ['unfollow account', '取关账号'],
  ['upload media', '上传媒体'],
  ['draft post', '创建发帖草稿'],
  ['draft reply', '创建回复草稿'],
  ['draft quote post', '创建转发草稿'],
  ['publish post', '自动发帖'],
  ['publish reply', '自动回复'],
  ['like post', '自动点赞'],
  ['repost post', '自动转发'],
  ['delete post', '删除帖子'],
  ['edit profile', '修改账号资料'],
  ['change account settings', '修改账号设置'],
  ['change account security settings', '修改账号安全设置'],
  ['change account email', '修改账号邮箱'],
  ['change account password', '修改账号密码'],
  ['change account 2fa', '修改两步验证'],
  ['change payment settings', '修改付款设置'],
]));

const BLOCKED_ACTION_LABELS_ZH = Object.freeze(new Map([
  ['submit', '提交操作'],
  ['send', '发送操作'],
  ['send_dm', '发送私信'],
  ['delete', '删除操作'],
  ['pay', '付款操作'],
  ['checkout', '结账操作'],
  ['upload', '上传操作'],
  ['change_password', '修改密码'],
  ['change_email', '修改邮箱'],
  ['change_2fa', '修改两步验证'],
  ['change_payment', '修改付款设置'],
  ['edit_profile', '修改账号资料'],
  ['follow', '关注操作'],
  ['unfollow', '取关操作'],
  ['like', '点赞操作'],
  ['repost', '转发操作'],
]));

function localizedUserFacingName(capability = /** @type {any} */ ({})) {
  for (const value of [capability.user_facing_name, capability.userFacingName, capability.userValue]) {
    if (hasCjkText(value)) {
      return String(value).trim();
    }
  }
  const blockedAction = normalizeLabelKey(capability.blockedAction);
  if (blockedAction && BLOCKED_ACTION_LABELS_ZH.has(blockedAction)) {
    return `已禁用${BLOCKED_ACTION_LABELS_ZH.get(blockedAction)}`;
  }
  for (const value of [
    capability.name,
    capability.userValue,
    capability.object,
    capability.setupCapabilityId,
  ]) {
    const mapped = USER_FACING_LABELS_ZH.get(normalizeLabelKey(value));
    if (mapped) {
      return mapped;
    }
  }
  const text = normalizeLabelKey(`${capability.name ?? ''} ${capability.object ?? ''} ${capability.action ?? ''}`);
  if (/post detail/u.test(text)) return '读取帖子详情';
  if (/post replies/u.test(text)) return '读取帖子回复';
  if (/post media/u.test(text)) return '读取帖子媒体摘要';
  if (/notification body/u.test(text)) return '读取通知正文';
  if (/bookmarked post body/u.test(text)) return '读取书签帖子正文';
  if (/explore topics/u.test(text)) return '读取探索话题';
  if (/publish post/u.test(text)) return '自动发帖';
  if (/publish reply/u.test(text)) return '自动回复';
  if (/like post/u.test(text)) return '自动点赞';
  if (/repost post/u.test(text)) return '自动转发';
  if (/delete post/u.test(text)) return '删除帖子';
  if (/account email/u.test(text)) return '修改账号邮箱';
  if (/account password/u.test(text)) return '修改账号密码';
  if (/account 2fa/u.test(text)) return '修改两步验证';
  if (/payment settings/u.test(text)) return '修改付款设置';
  return capability.user_facing_name ?? capability.userFacingName ?? capability.userValue ?? capability.name;
}

function executionPlanId(capabilityId) {
  return `plan:${capabilityId.replace(/^capability:/u, '')}`;
}

function buildGeneratedExecutionPlan(capabilityId, {
  mode = 'read_only',
  steps = /** @type {any[]} */ ([]),
  dryRunOnly = false,
  requiresConfirmation = false,
  autoExecute = false,
} = /** @type {any} */ ({})) {
  return {
    schemaVersion: BUILD_SCHEMA_VERSION,
    id: executionPlanId(capabilityId),
    capabilityId,
    mode,
    dryRunOnly,
    requiresConfirmation,
    autoExecute,
    steps,
  };
}

function makeGeneratedCapability(context, {
  name,
  description,
  action,
  object,
  userValue,
  entryNodeIds,
  requiredNodeIds = /** @type {any[]} */ ([]),
  inputs = /** @type {any[]} */ ([]),
  outputs = /** @type {any[]} */ ([]),
  safetyLevel = 'read_only',
  executionPlan,
  evidence,
  confidence,
  status = 'active',
  informational = false,
  ...metadata
}) {
  return {
    schemaVersion: BUILD_SCHEMA_VERSION,
    id: stableCapabilityId(context.site.id, name),
    siteId: context.site.id,
    name,
    description,
    action,
    object,
    userValue,
    entryNodeIds,
    requiredNodeIds,
    inputs,
    outputs,
    safetyLevel,
    executionPlan,
    evidence,
    confidence,
    status,
    informational,
    ...metadata,
  };
}

function fallbackEvidence(context) {
  return [{
    type: 'text',
    source: context?.site?.rootUrl ?? 'siteforge:auto-capability',
    text: 'Sanitized route and structure summary; no raw page content persisted.',
    confidence: 0.6,
  }];
}

function capabilityCategory(capability) {
  if (capability?.category === 'messages') {
    return 'direct_messages';
  }
  if (capability?.category) {
    return capability.category;
  }
  const text = [
    capability?.action,
    capability?.object,
    capability?.name,
    capability?.description,
    capability?.setupCapabilityId,
  ].filter(Boolean).join(' ').toLowerCase();
  if (/timeline|feed|recommended|followed updates|explore|trending/u.test(text)) {
    return 'timeline';
  }
  if (/search|query/u.test(text)) {
    return 'search';
  }
  if (/profile|author|followers|following/u.test(text)) {
    return 'profile';
  }
  if (/post detail|post thread|reply|quote|media|article detail/u.test(text)) {
    return 'post_detail';
  }
  if (/notification|mention/u.test(text)) {
    return 'notifications';
  }
  if (/bookmark|saved/u.test(text)) {
    return 'bookmarks';
  }
  if (/\blists?\b/u.test(text)) {
    return 'lists';
  }
  if (/direct message|\bdm\b|message conversation|private message/u.test(text)) {
    return 'direct_messages';
  }
  if (/draft|publish|send|like|repost|follow|delete|settings|upload|contact|submit/u.test(text)) {
    return 'write';
  }
  return 'general';
}

function normalizedIntentSeeds(capability) {
  const baseSeeds = Array.isArray(capability?.intents) && capability.intents.length
    ? capability.intents
    : COMPAT_INTENT_PHRASES[capability?.name]?.length
      ? COMPAT_INTENT_PHRASES[capability.name]
      : [capability?.name ?? 'open site capability'];
  const objectName = String(capability?.object ?? capability?.name ?? 'site capability').trim();
  const seeds = [...baseSeeds];
  for (const fallback of [
    `open ${objectName}`,
    `summarize ${objectName}`,
    `show ${objectName}`,
  ]) {
    if (seeds.length >= 2) {
      break;
    }
    seeds.push(fallback);
  }
  const normalized = seeds.map((seed) => {
    if (seed && typeof seed === 'object') {
      const canonicalUtterance = seed.canonicalUtterance
        ?? seed.canonical_utterance
        ?? seed.name
        ?? capability.name;
      return {
        canonicalUtterance,
        utteranceExamples: Array.isArray(seed.utteranceExamples) && seed.utteranceExamples.length
          ? seed.utteranceExamples
          : Array.isArray(seed.utterance_examples) && seed.utterance_examples.length
            ? seed.utterance_examples
            : [canonicalUtterance],
        negativeExamples: Array.isArray(seed.negativeExamples) && seed.negativeExamples.length
          ? seed.negativeExamples
          : Array.isArray(seed.negative_examples) && seed.negative_examples.length
            ? seed.negative_examples
            : ['submit a payment', 'delete account data'],
        slots: Array.isArray(seed.slots) ? seed.slots : [],
        invocationScore: Number.isFinite(Number(seed.invocationScore)) ? Number(seed.invocationScore) : 0.72,
      };
    }
    const utterance = String(seed ?? capability?.name ?? 'open site capability').trim() || capability.name;
    return {
      canonicalUtterance: utterance,
      utteranceExamples: [utterance],
      negativeExamples: ['submit a payment', 'delete account data'],
      slots: [],
      invocationScore: 0.72,
    };
  });
  const unique = /** @type {any[]} */ ([]);
  const seen = new Set();
  for (const seed of normalized) {
    const key = normalizeLabelKey(seed.canonicalUtterance);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(seed);
  }
  while (unique.length < 2) {
    const phrase = unique.length === 0
      ? String(capability?.name ?? 'open site capability')
      : `show ${objectName}`;
    const key = normalizeLabelKey(phrase);
    if (seen.has(key)) {
      break;
    }
    seen.add(key);
    unique.push({
      canonicalUtterance: phrase,
      utteranceExamples: [phrase],
      negativeExamples: ['submit a payment', 'delete account data'],
      slots: [],
      invocationScore: 0.72,
    });
  }
  return unique;
}

function intentIdFor(capability, seed, index) {
  const suffix = slugifyAscii(seed.canonicalUtterance, `intent-${index}`);
  return `${stableIntentId(capability.id)}:${suffix}`;
}

function nodeMatches(node, hints = /** @type {any[]} */ ([])) {
  const haystack = [
    node?.id,
    node?.classification,
    node?.routePattern,
    node?.routeState?.stateId,
    node?.routeState?.pageKind,
    ...(node?.routeState?.capabilityIds ?? []),
    node?.title,
  ].join(' ').toLowerCase();
  return hints.some((hint) => haystack.includes(String(hint).toLowerCase()));
}

function nodeRouteTemplate(node = /** @type {any} */ ({})) {
  return node.routeTemplate
    ?? node.routePattern
    ?? node.routeState?.routeTemplate
    ?? null;
}

function nodeTabState(node = /** @type {any} */ ({})) {
  return node.tabState
    ?? node.routeState?.tabState
    ?? null;
}

function nodePageKind(node = /** @type {any} */ ({})) {
  return node.pageType
    ?? node.routeState?.pageKind
    ?? node.classification
    ?? null;
}

function routeStateDescriptorFromNode(node = /** @type {any} */ ({})) {
  if (!node || typeof node !== 'object') return null;
  const routeTemplate = nodeRouteTemplate(node);
  const routePath = node.routePath ?? node.routeState?.routePath ?? null;
  const tabState = nodeTabState(node);
  const pageKind = nodePageKind(node);
  const stateId = node.routeState?.stateId ?? node.stateKey ?? null;
  if (!routeTemplate && !routePath && !tabState && !pageKind && !stateId) return null;
  return {
    stateId,
    pageKind,
    routeTemplate,
    routePath,
    tabState,
    tabs: node.routeState?.tabs ?? node.tabs ?? [],
    source: node.routeState?.source ?? null,
  };
}

function routePreferenceForDefinition(definition = /** @type {any} */ ({})) {
  const text = [
    definition.name,
    definition.category,
    definition.object,
    definition.setupCapabilityId,
  ].join(' ').toLowerCase();
  const primaryText = [
    definition.name,
    definition.category,
    definition.object,
  ].join(' ').toLowerCase();
  const pref = {
    routeTemplates: [],
    tabStates: [],
    pageKinds: [],
    requireRouteTemplate: false,
    requireTabState: false,
  };

  if (/recommended|for you/u.test(text)) {
    pref.routeTemplates.push('/home');
    pref.tabStates.push('for_you');
    pref.pageKinds.push('home');
    pref.requireRouteTemplate = true;
    pref.requireTabState = true;
  } else if (/following timeline|followed updates/u.test(text)) {
    pref.routeTemplates.push('/home', '/following');
    pref.tabStates.push('following');
    pref.pageKinds.push('home');
    pref.requireRouteTemplate = true;
    pref.requireTabState = true;
  } else if (/timeline/u.test(text)) {
    pref.routeTemplates.push('/home');
    pref.tabStates.push('for_you', 'home-timeline');
    pref.pageKinds.push('home');
    pref.requireRouteTemplate = true;
    pref.requireTabState = true;
  }

  if (/search/u.test(text)) {
    pref.routeTemplates.push('/search');
    pref.pageKinds.push('search');
    if (/latest/u.test(text)) pref.tabStates.push('latest');
    else if (/user|people/u.test(text)) pref.tabStates.push('people');
    else if (/media/u.test(text)) pref.tabStates.push('media');
    else pref.tabStates.push('top', 'search');
    pref.requireRouteTemplate = true;
    pref.requireTabState = true;
  }

  if (/notification|mention/u.test(text)) {
    pref.pageKinds.push('notifications');
    if (/mention/u.test(text)) {
      pref.routeTemplates.push('/notifications/mentions');
      pref.tabStates.push('mentions');
    } else if (/verified/u.test(text)) {
      pref.routeTemplates.push('/notifications/verified');
      pref.tabStates.push('verified');
    } else {
      pref.routeTemplates.push('/notifications');
      pref.tabStates.push('all', 'notifications');
    }
    pref.requireRouteTemplate = true;
    pref.requireTabState = true;
  }

  if (/bookmark/u.test(text)) {
    pref.routeTemplates.push('/i/bookmarks');
    pref.tabStates.push('saved', 'bookmarks');
    pref.pageKinds.push('bookmarks');
    pref.requireRouteTemplate = true;
    pref.requireTabState = true;
  }

  if (/\blist\b|lists/u.test(primaryText)) {
    if (/member|timeline/u.test(primaryText)) {
      pref.routeTemplates.push('/i/lists/:listId', '/i/lists');
      pref.tabStates.push('list_detail', 'index', 'lists');
    } else {
      pref.routeTemplates.push('/i/lists');
      pref.tabStates.push('index', 'lists');
    }
    pref.pageKinds.push('lists');
    pref.requireRouteTemplate = true;
    pref.requireTabState = true;
  }

  if (/direct message|private message|\bdm\b/u.test(text)) {
    pref.routeTemplates.push('/messages');
    pref.tabStates.push('inbox', 'direct-messages');
    pref.pageKinds.push('messages');
    pref.requireRouteTemplate = true;
    pref.requireTabState = true;
  }

  if (/profile|author|followers|following users|recent user posts|user replies|user media/u.test(text)) {
    if (/repl/u.test(text)) {
      pref.routeTemplates.push('/:handle/with_replies');
      pref.tabStates.push('replies');
    } else if (/media/u.test(text)) {
      pref.routeTemplates.push('/:handle/media');
      pref.tabStates.push('media');
    } else {
      pref.routeTemplates.push('/:handle');
      pref.tabStates.push('posts', 'profile');
    }
    pref.pageKinds.push('profile', 'author');
    pref.requireRouteTemplate = true;
    pref.requireTabState = true;
  }

  if (/post detail|reply tree|quote|post author|post engagement|external link|timeline post detail/u.test(text)) {
    pref.routeTemplates.push('/:handle/status/:postId');
    pref.tabStates.push('detail');
    pref.pageKinds.push('post_detail');
    pref.requireRouteTemplate = true;
    pref.requireTabState = true;
  }

  if (/settings|account|payment|password|email|2fa|security/u.test(text)) {
    pref.routeTemplates.push('/settings');
    pref.tabStates.push('entry');
    pref.pageKinds.push('settings');
    pref.requireRouteTemplate = true;
    pref.requireTabState = true;
  }

  pref.routeTemplates = [...new Set(pref.routeTemplates)];
  pref.tabStates = [...new Set(pref.tabStates)];
  pref.pageKinds = [...new Set(pref.pageKinds)];
  return pref;
}

function routePreferenceScore(node = /** @type {any} */ ({}), preference = /** @type {any} */ ({})) {
  const routeTemplate = nodeRouteTemplate(node);
  const tabState = nodeTabState(node);
  const pageKind = nodePageKind(node);
  const routeMatch = !preference.routeTemplates?.length || preference.routeTemplates.includes(routeTemplate);
  const tabMatch = !preference.tabStates?.length || preference.tabStates.includes(tabState);
  if (preference.requireRouteTemplate && !routeMatch) return -1;
  if (preference.requireTabState && !tabMatch) return -1;
  let score = 0;
  if (routeTemplate && routeMatch) score += 10;
  if (tabState && tabMatch) score += 8;
  if (pageKind && preference.pageKinds?.includes(pageKind)) score += 5;
  if (node.type === 'page') score += 2;
  if (node.type === 'route_template') score += 1;
  return score;
}

function findRoutePreferredNodes(graph, preference = /** @type {any} */ ({}), fallbackCount = 1) {
  const nodes = graph?.nodes ?? [];
  const hasPreference = [
    preference.routeTemplates,
    preference.tabStates,
    preference.pageKinds,
  ].some((values) => Array.isArray(values) && values.length > 0);
  if (!hasPreference) return [];
  return nodes
    .map((node, index) => ({ node, index, score: routePreferenceScore(node, preference) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, fallbackCount)
    .map((entry) => entry.node);
}

function findEntryNodes(graph, hints = /** @type {any[]} */ ([]), fallbackCount = 1) {
  const nodes = graph?.nodes ?? [];
  const matches = nodes.filter((node) => nodeMatches(node, hints));
  if (matches.length) {
    return matches;
  }
  return nodes
    .filter((node) => node.type === 'page')
    .slice(0, fallbackCount);
}

function graphHasStatefulRouteTemplateEvidence(graph = /** @type {any} */ ({})) {
  return (graph?.nodes ?? []).some((node) => nodeRouteTemplate(node) && nodeTabState(node));
}

function findEntryNodesForDefinition(graph, definition = /** @type {any} */ ({}), fallbackCount = 1) {
  const preference = routePreferenceForDefinition(definition);
  const preferred = findRoutePreferredNodes(graph, preference, fallbackCount);
  if (preferred.length) return preferred;
  if ((preference.requireRouteTemplate || preference.requireTabState) && graphHasStatefulRouteTemplateEvidence(graph)) {
    return [];
  }
  return findEntryNodes(graph, definition.nodeHints ?? [], fallbackCount);
}

function evidenceForNodes(nodes) {
  return nodes.flatMap((node) => node.evidence ?? []).slice(0, 6);
}

function routeStateNodeScore(node = /** @type {any} */ ({})) {
  const routeState = routeStateDescriptorFromNode(node);
  if (!routeState) return -1;
  let score = 0;
  if (routeState.routeTemplate) score += 8;
  if (routeState.routePath) score += 4;
  if (routeState.tabState) score += 4;
  if (routeState.pageKind) score += 2;
  if (node.type === 'page') score += 3;
  if (node.type === 'route_template') score += 2;
  return score;
}

function selectRouteStateNode(nodes = /** @type {any[]} */ ([])) {
  return [...nodes]
    .map((node, index) => ({ node, index, score: routeStateNodeScore(node) }))
    .filter((entry) => entry.score >= 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map((entry) => entry.node)[0] ?? nodes[0] ?? null;
}

function isSocialAutoCapabilityContext(context = /** @type {any} */ ({}), graph = /** @type {any} */ ({})) {
  const policy = context?.setupProfile?.knownSitePolicy ?? {};
  const policyText = [
    policy.siteArchetype,
    policy.primaryArchetype,
    policy.adapterId,
    policy.siteKey,
    ...(policy.capabilityFamilies ?? []),
    ...(policy.supportedIntents ?? []),
  ].join(' ').toLowerCase();
  if (/social|timeline|post|profile-content|search-posts|query-social/u.test(policyText)) {
    return true;
  }
  if (/chapter-content|open-book|open-chapter|search-book|navigate-to-chapter/u.test(policyText)) {
    return false;
  }
  return (graph?.nodes ?? []).some((node) => {
    const text = [
      node.classification,
      node.pageType,
      node.routeState?.source,
      node.routeState?.pageKind,
    ].join(' ').toLowerCase();
    return /known-social-route-state-model|timeline|post_detail|notifications|bookmarks|direct_message|following_list/u.test(text);
  });
}

const CAPABILITY_DEFINITIONS = Object.freeze([
  {
    name: 'read recommended timeline',
    userFacingName: '读取推荐时间线',
    category: 'timeline',
    setupCapabilityId: 'recommended-timeline-posts',
    riskLevel: 'read_personal_medium',
    action: 'view',
    object: 'recommended timeline',
    nodeHints: ['home-for-you', 'recommended-timeline-posts'],
    intents: ['看看首页有什么新内容', '读取推荐流', '读取推荐时间线帖子', '读取时间线上推荐的帖子', '读取时间线上被推荐的帖子', '总结今天推荐内容', '查看为你推荐的帖子'],
  },
  {
    name: 'read following timeline',
    userFacingName: '读取关注时间线',
    category: 'timeline',
    setupCapabilityId: 'list-followed-updates',
    riskLevel: 'read_personal_medium',
    action: 'view',
    object: 'following timeline',
    nodeHints: ['home-following', 'list-followed-updates', 'followed-timeline'],
    intents: ['查看关注的人最近发了什么', '读取关注时间线', '总结关注动态'],
  },
  {
    name: 'read timeline post summaries',
    userFacingName: '读取时间线帖子摘要',
    category: 'timeline',
    riskLevel: 'read_public_low',
    action: 'view',
    object: 'timeline post summaries',
    nodeHints: ['timeline-post-summary', 'post_card_list'],
    intents: ['总结时间线帖子', '查看帖子摘要', '读取首页帖子列表'],
  },
  {
    name: 'open timeline post detail',
    userFacingName: '打开时间线帖子详情',
    category: 'timeline',
    riskLevel: 'read_public_low',
    action: 'view',
    object: 'timeline post detail',
    nodeHints: ['open-timeline-post-detail', 'post-detail'],
    intents: ['打开这条帖子详情', '查看时间线帖子详情'],
  },
  {
    name: 'read post author summary',
    userFacingName: '读取帖子作者摘要',
    category: 'timeline',
    riskLevel: 'read_public_low',
    action: 'view',
    object: 'post author summary',
    nodeHints: ['navigate-author-profile', 'profile'],
    intents: ['看看帖子作者是谁', '读取作者摘要'],
  },
  {
    name: 'read post engagement summary',
    userFacingName: '读取帖子互动数摘要',
    category: 'timeline',
    riskLevel: 'read_public_low',
    action: 'view',
    object: 'post engagement summary',
    nodeHints: ['timeline', 'post-detail'],
    intents: ['读取帖子互动数', '总结帖子互动情况'],
  },
  {
    name: 'navigate to author profile',
    userFacingName: '导航到作者主页',
    category: 'profile',
    riskLevel: 'read_public_low',
    action: 'view',
    object: 'author profile',
    nodeHints: ['navigate-author-profile', 'profile'],
    intents: ['打开作者主页', '进入这个用户主页'],
  },
  {
    name: 'search posts',
    userFacingName: '搜索帖子',
    category: 'search',
    setupCapabilityId: 'search-posts',
    riskLevel: 'read_public_low',
    action: 'search',
    object: 'posts',
    inputs: [{ name: 'query', type: 'string', required: true }],
    nodeHints: ['search-posts', 'search-top'],
    intents: ['搜索某个关键词', '找某个话题的帖子', '搜索 X 上的内容'],
  },
  {
    name: 'search latest posts',
    userFacingName: '搜索最新帖子',
    category: 'search',
    riskLevel: 'read_public_low',
    action: 'search',
    object: 'latest posts',
    inputs: [{ name: 'query', type: 'string', required: true }],
    nodeHints: ['search-latest'],
    intents: ['搜索最新帖子', '查最近关于某事的讨论'],
  },
  {
    name: 'search users',
    userFacingName: '搜索用户',
    category: 'search',
    riskLevel: 'read_public_low',
    action: 'search',
    object: 'users',
    inputs: [{ name: 'query', type: 'string', required: true }],
    nodeHints: ['search-people'],
    intents: ['搜索用户', '找某个账号'],
  },
  {
    name: 'search media posts',
    userFacingName: '搜索媒体帖子',
    category: 'search',
    riskLevel: 'read_public_low',
    action: 'search',
    object: 'media posts',
    inputs: [{ name: 'query', type: 'string', required: true }],
    nodeHints: ['search-media'],
    intents: ['搜索媒体内容', '查带图片或视频的帖子'],
  },
  {
    name: 'read search result summaries',
    userFacingName: '读取搜索结果摘要',
    category: 'search',
    riskLevel: 'read_public_low',
    action: 'view',
    object: 'search result summaries',
    nodeHints: ['read-search-result-summary', 'search'],
    intents: ['总结搜索结果', '读取搜索列表摘要'],
  },
  {
    name: 'open search result detail',
    userFacingName: '打开搜索结果详情',
    category: 'search',
    riskLevel: 'read_public_low',
    action: 'view',
    object: 'search result detail',
    nodeHints: ['open-search-result-detail', 'search'],
    intents: ['打开搜索结果详情', '查看这条搜索结果'],
  },
  {
    name: 'read profile content',
    userFacingName: '读取个人主页内容',
    category: 'profile',
    setupCapabilityId: 'list-profile-content',
    riskLevel: 'read_public_low',
    action: 'view',
    object: 'profile content',
    inputs: [{ name: 'account', type: 'string', required: false }],
    nodeHints: ['profile-content', 'profile-posts'],
    intents: ['读取个人主页内容', '查看某个用户主页'],
  },
  {
    name: 'read user recent posts',
    userFacingName: '读取用户最近帖子',
    category: 'profile',
    riskLevel: 'read_public_low',
    action: 'view',
    object: 'user recent posts',
    inputs: [{ name: 'account', type: 'string', required: false }],
    nodeHints: ['profile-posts'],
    intents: ['读取用户最近帖子', '查看这个用户发了什么'],
  },
  {
    name: 'read user replies',
    userFacingName: '读取用户回复',
    category: 'profile',
    riskLevel: 'read_public_low',
    action: 'view',
    object: 'user replies',
    nodeHints: ['profile-replies'],
    intents: ['读取用户回复', '查看回复标签页'],
  },
  {
    name: 'read user media',
    userFacingName: '读取用户媒体',
    category: 'profile',
    riskLevel: 'read_public_low',
    action: 'view',
    object: 'user media',
    nodeHints: ['profile-media'],
    intents: ['读取用户媒体', '查看媒体标签页'],
  },
  {
    name: 'read followed users',
    userFacingName: '读取关注列表',
    category: 'profile',
    setupCapabilityId: 'list-followed-users',
    riskLevel: 'read_personal_medium',
    defaultPolicy: 'confirmation_required',
    enabledStatus: 'confirmation_required',
    action: 'view',
    object: 'followed users',
    nodeHints: ['profile-following', 'list-followed-users'],
    intents: ['读取关注列表', '看看我关注了谁'],
  },
  {
    name: 'read followers',
    userFacingName: '读取粉丝列表',
    category: 'profile',
    riskLevel: 'read_personal_medium',
    defaultPolicy: 'confirmation_required',
    enabledStatus: 'confirmation_required',
    action: 'view',
    object: 'followers',
    nodeHints: ['profile-followers'],
    intents: ['读取粉丝列表', '查看有哪些粉丝'],
  },
  {
    name: 'read post detail',
    userFacingName: '读取帖子详情',
    category: 'post_detail',
    riskLevel: 'read_public_low',
    action: 'view',
    object: 'post detail',
    nodeHints: ['post-detail'],
    intents: ['读取帖子详情', '打开这条帖子的完整信息'],
  },
  {
    name: 'read reply tree summary',
    userFacingName: '读取回复树摘要',
    category: 'post_detail',
    riskLevel: 'read_public_low',
    action: 'view',
    object: 'reply tree summary',
    nodeHints: ['reply-tree-summary', 'post-detail'],
    intents: ['总结回复树', '读取回复摘要'],
  },
  {
    name: 'read quote summary',
    userFacingName: '读取引用摘要',
    category: 'post_detail',
    riskLevel: 'read_public_low',
    action: 'view',
    object: 'quote summary',
    nodeHints: ['quote-summary', 'post-detail'],
    intents: ['读取引用摘要', '看看这条帖子被如何引用'],
  },
  {
    name: 'read media summary',
    userFacingName: '读取媒体摘要',
    category: 'post_detail',
    riskLevel: 'read_public_low',
    action: 'view',
    object: 'media summary',
    nodeHints: ['media-summary', 'search-media'],
    intents: ['读取媒体摘要', '总结图片或视频信息'],
  },
  {
    name: 'open external link preview',
    userFacingName: '打开外链预览',
    category: 'post_detail',
    riskLevel: 'read_public_low',
    action: 'view',
    object: 'external link preview',
    nodeHints: ['external-link-preview', 'post-detail'],
    intents: ['打开外链预览', '查看帖子里的链接预览'],
  },
  {
    name: 'read all notifications summary',
    userFacingName: '读取全部通知摘要',
    category: 'notifications',
    setupCapabilityId: 'list-notifications',
    riskLevel: 'read_personal_medium',
    defaultPolicy: 'confirmation_required',
    enabledStatus: 'confirmation_required',
    action: 'view',
    object: 'notification summaries',
    nodeHints: ['notifications-all', 'list-notifications'],
    intents: ['总结通知', '查看最近互动', '读取全部通知摘要'],
  },
  {
    name: 'read mentions notifications summary',
    userFacingName: '读取提及通知摘要',
    category: 'notifications',
    riskLevel: 'read_personal_medium',
    defaultPolicy: 'confirmation_required',
    enabledStatus: 'confirmation_required',
    action: 'view',
    object: 'mention notifications',
    nodeHints: ['notifications-mentions'],
    intents: ['看看谁提到了我', '读取提及通知摘要'],
  },
  {
    name: 'read verified notifications summary',
    userFacingName: '读取认证用户通知摘要',
    category: 'notifications',
    riskLevel: 'read_personal_medium',
    defaultPolicy: 'confirmation_required',
    enabledStatus: 'confirmation_required',
    action: 'view',
    object: 'verified notifications',
    nodeHints: ['notifications-verified'],
    intents: ['读取认证用户通知', '查看已认证账号互动'],
  },
  {
    name: 'open notification related post',
    userFacingName: '打开通知关联帖子',
    category: 'notifications',
    riskLevel: 'read_personal_medium',
    defaultPolicy: 'confirmation_required',
    enabledStatus: 'confirmation_required',
    action: 'view',
    object: 'notification related post',
    nodeHints: ['open-notification-post'],
    intents: ['打开通知对应帖子', '查看通知关联内容'],
  },
  {
    name: 'read notification body',
    userFacingName: '读取通知正文',
    category: 'notifications',
    riskLevel: 'read_private_high',
    action: 'view',
    object: 'notification body',
    nodeHints: ['notifications-all', 'notification-detail'],
    forceDisabled: true,
    intents: ['读取通知正文', '打开完整通知内容'],
    userReason: '通知正文可能包含私人互动内容，默认禁用。',
    userStrategy: '不读取或保存通知正文，只保留受限摘要。',
  },
  {
    name: 'read bookmarks summary',
    userFacingName: '读取书签摘要',
    category: 'bookmarks',
    setupCapabilityId: 'list-bookmarks',
    riskLevel: 'read_personal_medium',
    defaultPolicy: 'confirmation_required',
    enabledStatus: 'confirmation_required',
    action: 'view',
    object: 'bookmark summaries',
    nodeHints: ['list-bookmarks', 'bookmarks'],
    intents: ['读取书签摘要', '查看保存的帖子摘要'],
  },
  {
    name: 'open bookmarked post',
    userFacingName: '打开书签帖子',
    category: 'bookmarks',
    riskLevel: 'read_personal_medium',
    defaultPolicy: 'confirmation_required',
    enabledStatus: 'confirmation_required',
    action: 'view',
    object: 'bookmarked post',
    nodeHints: ['open-bookmark-post', 'bookmarks'],
    intents: ['打开书签帖子', '查看这条保存内容'],
  },
  {
    name: 'read recent bookmarks by time',
    userFacingName: '按时间读取最近书签',
    category: 'bookmarks',
    riskLevel: 'read_personal_medium',
    defaultPolicy: 'confirmation_required',
    enabledStatus: 'confirmation_required',
    action: 'filter',
    object: 'recent bookmarks',
    nodeHints: ['bookmarks'],
    intents: ['按时间查看最近书签', '读取最近保存的内容'],
  },
  {
    name: 'read bookmarked post body',
    userFacingName: '读取书签帖子正文',
    category: 'bookmarks',
    riskLevel: 'read_private_high',
    action: 'view',
    object: 'bookmarked post body',
    nodeHints: ['open-bookmark-post', 'bookmarks'],
    forceDisabled: true,
    intents: ['读取书签帖子正文', '打开书签里的完整帖子内容'],
    userReason: '书签正文属于更敏感的个人保存内容，默认禁用。',
    userStrategy: '不读取或保存书签正文，只保留受限摘要。',
  },
  {
    name: 'read lists summary',
    userFacingName: '读取列表摘要',
    category: 'lists',
    setupCapabilityId: 'list-lists',
    riskLevel: 'read_personal_medium',
    action: 'view',
    object: 'list summaries',
    nodeHints: ['list-lists', 'lists'],
    intents: ['读取列表摘要', '查看我的列表'],
  },
  {
    name: 'read list timeline',
    userFacingName: '读取列表时间线',
    category: 'lists',
    riskLevel: 'read_personal_medium',
    action: 'view',
    object: 'list timeline',
    nodeHints: ['list-timeline'],
    intents: ['读取列表时间线', '查看列表里的帖子'],
  },
  {
    name: 'read list members summary',
    userFacingName: '读取列表成员摘要',
    category: 'lists',
    riskLevel: 'read_personal_medium',
    action: 'view',
    object: 'list members',
    nodeHints: ['list-members'],
    intents: ['读取列表成员', '查看列表包含哪些账号'],
  },
  {
    name: 'read direct message conversation summaries',
    userFacingName: '读取私信会话列表摘要',
    category: 'messages',
    setupCapabilityId: 'list-direct-messages',
    riskLevel: 'read_private_high',
    defaultPolicy: 'confirmation_required',
    enabledStatus: 'confirmation_required',
    action: 'view',
    object: 'direct message conversation summaries',
    nodeHints: ['list-direct-messages', 'messages-list'],
    intents: ['读取私信会话列表摘要', '查看私信会话数量和结构'],
  },
  {
    name: 'read direct message detail',
    userFacingName: '读取私信详情',
    category: 'messages',
    riskLevel: 'read_private_high',
    action: 'view',
    object: 'direct message detail',
    nodeHints: ['messages-list'],
    forceDisabled: true,
    intents: ['读取私信详情', '打开私信内容'],
    userReason: '私信正文属于高敏感范围。',
    userStrategy: '默认禁用，不保存或读取私信正文。',
  },
  {
    name: 'create direct message draft',
    userFacingName: '创建私信草稿',
    category: 'messages',
    riskLevel: 'write_high',
    action: 'create',
    object: 'direct message draft',
    nodeHints: ['create-dm-draft', 'messages-list'],
    forceDisabled: true,
    userReason: '私信草稿涉及私人会话和收件人，不能按普通草稿处理。',
    userStrategy: '默认禁用；不会生成、保存或发送私信草稿。',
    intents: ['创建私信草稿', '帮我准备一条私信但不要发送'],
  },
  {
    name: 'send direct message',
    userFacingName: '自动发送私信',
    category: 'messages',
    riskLevel: 'write_high',
    action: 'submit',
    object: 'direct message',
    nodeHints: ['send-dm', 'messages-list'],
    forceDisabled: true,
    intents: ['发送私信', '给对方发消息'],
  },
  {
    name: 'publish post',
    userFacingName: '自动发帖',
    category: 'write',
    riskLevel: 'write_high',
    action: 'submit',
    object: 'publish post',
    nodeHints: ['create-post-draft', 'compose-post', 'timeline'],
    forceDisabled: true,
    intents: ['自动发帖', '发布这条帖子'],
  },
  {
    name: 'publish reply',
    userFacingName: '自动回复',
    category: 'write',
    riskLevel: 'write_high',
    action: 'submit',
    object: 'publish reply',
    nodeHints: ['status-reply-draft', 'post-detail'],
    forceDisabled: true,
    intents: ['自动回复', '发送这条回复'],
  },
  {
    name: 'create post draft',
    userFacingName: '创建发帖草稿',
    category: 'write',
    riskLevel: 'write_low',
    action: 'create',
    object: 'post draft',
    nodeHints: ['create-post-draft', 'compose-post', 'timeline'],
    intents: ['创建发帖草稿', '帮我准备一条帖子但不要发布'],
  },
  {
    name: 'create reply draft',
    userFacingName: '创建回复草稿',
    category: 'write',
    riskLevel: 'write_low',
    action: 'create',
    object: 'reply draft',
    nodeHints: ['status-reply-draft', 'post-detail'],
    intents: ['创建回复草稿', '准备回复但不要发送'],
  },
  {
    name: 'like post',
    userFacingName: '自动点赞',
    category: 'write',
    riskLevel: 'write_high',
    action: 'submit',
    object: 'like',
    nodeHints: ['post-detail', 'timeline'],
    forceDisabled: true,
    intents: ['点赞这条帖子', '自动点赞'],
  },
  {
    name: 'repost post',
    userFacingName: '自动转发',
    category: 'write',
    riskLevel: 'write_high',
    action: 'submit',
    object: 'repost',
    nodeHints: ['post-detail', 'timeline'],
    forceDisabled: true,
    intents: ['转发这条帖子', '自动转发'],
  },
  {
    name: 'follow user',
    userFacingName: '自动关注用户',
    category: 'write',
    riskLevel: 'write_high',
    action: 'submit',
    object: 'follow',
    nodeHints: ['profile'],
    forceDisabled: true,
    intents: ['关注这个用户', '自动关注账号'],
  },
  {
    name: 'unfollow user',
    userFacingName: '自动取关用户',
    category: 'write',
    riskLevel: 'write_high',
    action: 'submit',
    object: 'unfollow',
    nodeHints: ['profile'],
    forceDisabled: true,
    intents: ['取关这个用户', '自动取关账号'],
  },
  {
    name: 'delete post',
    userFacingName: '删除帖子',
    category: 'write',
    riskLevel: 'write_high',
    action: 'manage',
    object: 'post deletion',
    nodeHints: ['post-detail'],
    forceDisabled: true,
    intents: ['删除这条帖子', '移除帖子'],
  },
  {
    name: 'edit profile',
    userFacingName: '修改账号资料',
    category: 'account',
    riskLevel: 'account_security_critical',
    action: 'manage',
    object: 'profile settings',
    nodeHints: ['edit-profile', 'settings'],
    forceDisabled: true,
    intents: ['修改个人资料', '编辑账号主页信息'],
  },
  {
    name: 'change account security settings',
    userFacingName: '修改账号安全设置',
    category: 'account',
    riskLevel: 'account_security_critical',
    action: 'manage',
    object: 'account security settings',
    nodeHints: ['account-security-settings', 'settings'],
    forceDisabled: true,
    intents: ['修改账号安全设置', '更改密码或二次验证'],
  },
  {
    name: 'change account email',
    userFacingName: '修改账号邮箱',
    category: 'account',
    riskLevel: 'account_security_critical',
    action: 'manage',
    object: 'account email',
    nodeHints: ['account-security-settings', 'settings'],
    forceDisabled: true,
    intents: ['修改账号邮箱', '更改登录邮箱'],
  },
  {
    name: 'change account password',
    userFacingName: '修改账号密码',
    category: 'account',
    riskLevel: 'account_security_critical',
    action: 'manage',
    object: 'account password',
    nodeHints: ['account-security-settings', 'settings'],
    forceDisabled: true,
    intents: ['修改账号密码', '更改密码'],
  },
  {
    name: 'change account 2fa',
    userFacingName: '修改两步验证',
    category: 'account',
    riskLevel: 'account_security_critical',
    action: 'manage',
    object: 'account 2fa',
    nodeHints: ['account-security-settings', 'settings'],
    forceDisabled: true,
    intents: ['修改两步验证', '更改 2FA 设置'],
  },
  {
    name: 'change payment settings',
    userFacingName: '修改付款设置',
    category: 'account',
    riskLevel: 'account_security_critical',
    action: 'manage',
    object: 'payment settings',
    nodeHints: ['account-security-settings', 'settings'],
    forceDisabled: true,
    intents: ['修改付款设置', '更改支付方式'],
  },
]);

function buildPlanForCapability(capability, definition, entryNodes, buildExecutionPlan) {
  if (!isCallableEnablementStatus(capability.enabled_status) || capability.status !== 'active') {
    return null;
  }
  const isDraft = capability.enabled_status === 'draft_only' || capability.default_policy === 'draft_only';
  const isLimited = capability.enabled_status === 'limited_enabled';
  const requiresConfirmation = capability.enabled_status === 'confirmation_required' || isDraft;
  const entryNode = selectRouteStateNode(entryNodes);
  const routeState = routeStateDescriptorFromNode(entryNode);
  return buildExecutionPlan(capability.id, {
    mode: isDraft ? 'dry_run' : isLimited ? 'limited_read' : 'read_only',
    dryRunOnly: isDraft,
    requiresConfirmation,
    autoExecute: false,
    limitedOutputOnly: isLimited,
    savedMaterial: 'sanitized_summary_only',
    steps: [{
      kind: isDraft ? 'draft_preview' : 'read_sanitized_summary',
      action: definition.action,
      object: definition.object,
      nodeId: entryNode?.id,
      routeTemplate: routeState?.routeTemplate ?? entryNode?.routePattern ?? null,
      routePath: routeState?.routePath ?? entryNode?.routePath ?? null,
      routeState,
      routeStateId: routeState?.stateId ?? null,
      tabState: routeState?.tabState ?? null,
      pageKind: routeState?.pageKind ?? null,
      submit: false,
      finalSubmit: false,
      upload: false,
      selectSensitiveRecipient: false,
      autoExecute: false,
      limitedOutputOnly: isLimited,
      savedMaterial: 'sanitized_summary_only',
    }],
  });
}

export function buildAutoDiscoveredCapabilities({
  context,
  graph,
  makeCapability,
  buildExecutionPlan,
}) {
  const privacy = context?.options?.privacy ?? context?.options?.privacyMode ?? 'limited';
  if (!isSocialAutoCapabilityContext(context, graph)) {
    return [];
  }
  if (!graph?.nodes?.some((node) => node.routeState?.source === 'known-social-route-state-model' || node.routeState?.stateId)) {
    return [];
  }
  const capabilities = /** @type {any[]} */ ([]);
  for (const definition of CAPABILITY_DEFINITIONS) {
    const entryNodes = findEntryNodesForDefinition(graph, definition, 1);
    if (!entryNodes.length) {
      continue;
    }
    const routeStateNode = selectRouteStateNode(entryNodes);
    const entryRouteState = routeStateDescriptorFromNode(routeStateNode);
    const policy = riskPolicyForLevel(definition.riskLevel);
    const baseEvidence = evidenceForNodes(entryNodes);
    const seeded = makeCapability(context, {
      name: definition.name,
      description: `${definition.userFacingName}: generated from sanitized route, structure, and control evidence.`,
      action: definition.action,
      object: definition.object,
      userValue: definition.userFacingName,
      entryNodeIds: entryNodes.map((node) => node.id),
      requiredNodeIds: [],
      inputs: definition.inputs ?? [],
      outputs: [{ name: 'summary', type: 'sanitized_summary' }],
      safetyLevel: policy.safetyLevel,
      evidence: baseEvidence,
      confidence: definition.forceDisabled ? 0.62 : 0.84,
      status: 'active',
      informational: false,
      setupCapabilityId: definition.setupCapabilityId ?? null,
      requiresCapabilityEvidence: false,
      capabilityVerified: true,
      user_facing_name: localizedUserFacingName({
        name: definition.name,
        user_facing_name: definition.userFacingName,
        userValue: definition.userFacingName,
        setupCapabilityId: definition.setupCapabilityId,
      }),
      internal_name: definition.name,
      category: definition.category,
      routeTemplate: entryRouteState?.routeTemplate ?? routeStateNode?.routePattern ?? null,
      routePath: entryRouteState?.routePath ?? routeStateNode?.routePath ?? null,
      routeState: entryRouteState,
      routeStateId: entryRouteState?.stateId ?? null,
      tabState: entryRouteState?.tabState ?? null,
      pageKind: entryRouteState?.pageKind ?? null,
      intents: definition.intents,
    });
    const capability = applyRiskDefaults(seeded, {
      riskLevel: definition.riskLevel,
      privacy,
      forceDisabled: definition.forceDisabled === true,
      enabledStatus: definition.enabledStatus,
      defaultPolicy: definition.defaultPolicy,
      evidenceStatus: definition.evidenceStatus,
      evidenceSources: ['route', 'structure', 'control', 'adapter'],
      userReason: definition.userReason,
      userStrategy: definition.userStrategy,
    });
    capability.safetyLevel = riskPolicyForLevel(definition.riskLevel).safetyLevel;
    capability.executionPlan = buildPlanForCapability(capability, definition, entryNodes, buildExecutionPlan);
    if (!capability.executionPlan) {
      delete capability.executionPlan;
    }
    capabilities.push(capability);
  }
  return uniqueBy(capabilities, (capability) => capability.id)
    .sort((left, right) => left.id.localeCompare(right.id, 'en'));
}

export function generateAutoCapabilities(context, {
  graph,
  existingCapabilities = /** @type {any[]} */ ([]),
} = /** @type {any} */ ({})) {
  const generated = buildAutoDiscoveredCapabilities({
    context,
    graph,
    makeCapability: makeGeneratedCapability,
    buildExecutionPlan: buildGeneratedExecutionPlan,
  });
  const existingIds = new Set((Array.isArray(existingCapabilities) ? existingCapabilities : [])
    .map((capability) => capability.id)
    .filter(Boolean));
  const compatGenerated = compatGenerateAutoCapabilities(context, {
    graph,
    existingCapabilities: [
      ...(Array.isArray(existingCapabilities) ? existingCapabilities : []),
      ...generated,
    ],
  });
  return [...generated, ...compatGenerated].filter((capability) => !existingIds.has(capability.id));
}

export function enrichAutoCapability(context, capability = /** @type {any} */ ({})) {
  const riskLevel = capability.risk_level ?? capability.riskPolicy?.riskLevel ?? 'read_public_low';
  const policy = riskPolicyForLevel(riskLevel);
  const isCandidate = capability.status === 'candidate';
  const enabledStatus = normalizeCapabilityEnablementStatus(capability, {
    ...policy,
    disabled: capability.status === 'disabled' || capability.status === 'discarded' || policy.disabled,
  });
  const evidence = Array.isArray(capability.evidence) && capability.evidence.length
    ? capability.evidence
    : isCandidate
      ? []
      : fallbackEvidence(context);
  const enriched = {
    ...capability,
    user_facing_name: localizedUserFacingName(capability),
    internal_name: capability.internal_name ?? capability.name,
    category: capabilityCategory(capability),
    risk_level: riskLevel,
    default_policy: capability.default_policy ?? (enabledStatus === 'candidate_debug_only' ? 'candidate_debug_only' : policy.defaultAction),
    evidence,
    evidence_status: capability.evidence_status ?? normalizeCapabilityEvidenceStatus(capability, enabledStatus),
    evidence_sources: Array.isArray(capability.evidence_sources) && capability.evidence_sources.length
      ? capability.evidence_sources
      : ['route', 'structure', 'control'].filter((source, index) => index < Math.max(1, evidence.length)),
    saved_material: Array.isArray(capability.saved_material) && capability.saved_material.length
      ? capability.saved_material
      : ['sanitized_summary_only'],
    raw_content_saved: false,
    private_content_saved: false,
    enabled_status: enabledStatus,
  };
  enriched.intents = generateAutoIntentRecords(context, [enriched]).map((intent) => ({
    id: intent.id,
    canonicalUtterance: intent.canonicalUtterance,
    utteranceExamples: intent.utteranceExamples,
    negativeExamples: intent.negativeExamples,
    callable: intent.callable,
  }));
  return enriched;
}

export function capabilityEnabledStatusCounts(capabilities = /** @type {any[]} */ ([])) {
  return capabilityEnablementStatusCounts(capabilities);
}

export function generateAutoIntentRecords(context, capabilities = /** @type {any[]} */ ([]), options = /** @type {any} */ ({})) {
  const intents = /** @type {any[]} */ ([]);
  const seen = new Set();
  const includeCandidateDebug = options.includeCandidateDebug !== false;
  for (const capability of Array.isArray(capabilities) ? capabilities : []) {
    const enabledStatus = capability.status === 'active'
      ? capability.enabled_status ?? 'enabled'
      : capability.status === 'disabled' || capability.status === 'discarded'
        ? 'disabled'
        : capability.enabled_status === 'disabled'
          ? 'disabled'
          : 'candidate_debug_only';
    if (!includeCandidateDebug && enabledStatus === 'candidate_debug_only') {
      continue;
    }
    const seeds = normalizedIntentSeeds(capability);
    const callable = capability.status === 'active' && isCallableEnablementStatus(enabledStatus);
    const safeRemediation = callable
      ? null
      : capability.safe_remediation ?? publicSafeRemediation(buildCapabilitySafeRemediationPath(capability));
    for (const [index, seed] of seeds.entries()) {
      const id = intentIdFor(capability, seed, index);
      if (seen.has(id)) {
        continue;
      }
      seen.add(id);
      intents.push({
        schemaVersion: BUILD_SCHEMA_VERSION,
        id,
        capabilityId: capability.id,
        skillId: context.skillId,
        name: capability.name ?? seed.canonicalUtterance,
        description: capability.description ?? seed.canonicalUtterance,
        canonicalUtterance: seed.canonicalUtterance,
        utteranceExamples: seed.utteranceExamples,
        negativeExamples: seed.negativeExamples,
        slots: seed.slots,
        safetyLevel: capability.safetyLevel ?? riskPolicyForLevel(capability.risk_level).safetyLevel,
        invocationScore: seed.invocationScore,
        evidence: Array.isArray(capability.evidence) && capability.evidence.length
          ? capability.evidence
          : fallbackEvidence(context),
        callable,
        enabled_status: enabledStatus,
        safe_remediation_path: safeRemediation?.path ?? null,
        safe_remediation: safeRemediation,
        evidence_status: capability.evidence_status ?? (
          enabledStatus === 'disabled'
            ? 'disabled'
            : callable
              ? 'verified'
              : 'candidate'
        ),
        default_policy: capability.default_policy ?? (callable ? 'read_only' : enabledStatus),
        category: capability.category ?? capabilityCategory(capability),
        risk_level: capability.risk_level ?? capability.riskPolicy?.riskLevel ?? 'read_public_low',
      });
    }
  }
  return intents.sort((left, right) => left.id.localeCompare(right.id, 'en'));
}

const COMPAT_ENABLED_STATUSES = CAPABILITY_ENABLEMENT_STATUSES;

function compatSlug(value, fallback = 'item') {
  const slug = String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
  return slug || fallback;
}

function compatUniqueStrings(values) {
  return [...new Set(values.filter(Boolean).map(String))]
    .sort((left, right) => left.localeCompare(right, 'en'));
}

function compatHost(context) {
  try {
    return new URL(context.site.rootUrl).hostname.replace(/^www\./u, '').toLowerCase();
  } catch {
    return '';
  }
}

function compatIsXSite(context) {
  const policy = context.setupProfile?.knownSitePolicy ?? {};
  return compatHost(context) === 'x.com'
    || policy.siteKey === 'x'
    || policy.adapterId === 'x';
}

function compatHomepage(graph) {
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  return nodes.find((node) => node.type === 'page' && node.classification === 'homepage')
    ?? nodes.find((node) => node.type === 'page')
    ?? nodes[0]
    ?? null;
}

function compatEvidence(context, homepage, routePath, label, confidence = 0.55) {
  const urlValue = new URL(routePath || '/', context.site.rootUrl).toString();
  return [
    ...(Array.isArray(homepage?.evidence) ? homepage.evidence.slice(0, 2) : []),
    buildEvidence({
      type: 'url',
      source: urlValue,
      text: `${label} route or structure evidence`,
      confidence,
    }),
    buildEvidence({
      type: 'text',
      source: context.site.rootUrl,
      text: 'Auto-generated from sanitized node, control, route, or structure evidence; raw/private content not saved.',
      confidence,
    }),
  ];
}

const COMPAT_X_SPECS = Object.freeze([
  ['view post detail', 'post_detail', 'read_public_low', 'view', 'post detail', '/i/web/status/example', 'enabled'],
  ['view post replies', 'post_detail', 'read_public_low', 'view', 'post replies', '/i/web/status/example', 'enabled'],
  ['view post media', 'post_detail', 'read_public_low', 'view', 'post media', '/i/web/status/example', 'enabled'],
  ['list notifications', 'notifications', 'read_personal_medium', 'view', 'notifications', '/notifications', 'confirmation_required'],
  ['read notification body', 'notifications', 'read_private_high', 'view', 'notification body', '/notifications', 'disabled'],
  ['list bookmarks', 'bookmarks', 'read_personal_medium', 'view', 'bookmarks', '/i/bookmarks', 'confirmation_required'],
  ['read bookmarked post body', 'bookmarks', 'read_private_high', 'view', 'bookmarked post body', '/i/bookmarks', 'disabled'],
  ['list lists', 'lists', 'read_personal_medium', 'view', 'lists', '/i/lists', 'limited_enabled'],
  ['list direct messages', 'direct_messages', 'read_private_high', 'view', 'direct message summaries', '/messages', 'confirmation_required'],
  ['list explore topics', 'timeline', 'read_public_low', 'view', 'explore topics', '/explore', 'enabled'],
  ['list following timeline posts', 'timeline', 'read_personal_medium', 'view', 'following timeline posts', '/following', 'limited_enabled'],
  ['list account followers', 'profile', 'read_personal_medium', 'view', 'account followers', '/followers', 'confirmation_required'],
  ['draft post', 'write', 'write_low', 'create', 'post draft', '/compose/post', 'draft_only'],
  ['draft reply', 'write', 'write_low', 'create', 'reply draft', '/compose/post', 'draft_only'],
  ['draft quote post', 'write', 'write_low', 'create', 'quote-post draft', '/compose/post', 'draft_only'],
  ['draft direct message', 'write', 'write_high', 'create', 'direct message draft', '/messages', 'disabled'],
  ['publish post', 'write', 'write_high', 'submit', 'post publishing', '/compose/post', 'disabled'],
  ['publish reply', 'write', 'write_high', 'submit', 'reply publishing', '/compose/post', 'disabled'],
  ['send direct message', 'write', 'write_high', 'submit', 'direct message sending', '/messages', 'disabled'],
  ['like post', 'write', 'write_high', 'submit', 'post like', '/i/web/status/example', 'disabled'],
  ['repost post', 'write', 'write_high', 'submit', 'post repost', '/i/web/status/example', 'disabled'],
  ['follow account', 'write', 'write_high', 'submit', 'follow account', '/following', 'disabled'],
  ['unfollow account', 'write', 'write_high', 'submit', 'unfollow account', '/following', 'disabled'],
  ['delete post', 'write', 'write_high', 'manage', 'post deletion', '/i/web/status/example', 'disabled'],
  ['change account settings', 'write', 'account_security_critical', 'manage', 'account settings', '/settings', 'disabled'],
  ['change account email', 'write', 'account_security_critical', 'manage', 'account email', '/settings', 'disabled'],
  ['change account password', 'write', 'account_security_critical', 'manage', 'account password', '/settings', 'disabled'],
  ['change account 2fa', 'write', 'account_security_critical', 'manage', 'account 2fa', '/settings', 'disabled'],
  ['change payment settings', 'write', 'account_security_critical', 'manage', 'payment settings', '/settings', 'disabled'],
  ['upload media', 'write', 'write_high', 'upload', 'media upload', '/compose/post', 'disabled'],
]);

const COMPAT_INTENT_PHRASES = Object.freeze({
  'view homepage': ['查看站点首页', '打开站点首页', '查看网站入口和导航'],
  'view news homepage': ['view news homepage', '帮我看新闻首页', 'open the news homepage', 'show the news homepage'],
  'browse news channels': ['browse news channels', '帮我浏览新闻频道', 'show news channels', 'open public news feeds'],
  'view news article details': ['view news article details', 'read a news article', 'open article detail page'],
  'browse products': ['browse products', 'open the product catalog', 'show product listings'],
  'search products': ['search products', 'search for wireless headphones', 'find products by keyword'],
  'view product detail': ['view product detail', 'open a product detail page', 'inspect this product'],
  'contact support': ['准备联系表单草稿', '预览客服消息草稿', '查看联系表单但不提交'],
  'list followed users': ['list followed users', 'show followed accounts', 'who do I follow'],
  'list followed updates': ['list followed updates', 'show followed account posts', 'read followed timeline updates'],
  'list recommended timeline posts': ['list recommended timeline posts', '读取时间线上被推荐的帖子', '读取推荐时间线帖子', 'show For You timeline posts', 'read recommended timeline items'],
  'list profile content': ['list profile content', 'show account posts', 'open profile posts'],
  'search posts': ['search posts', 'find posts about a topic', 'search X posts'],
  'list notifications': ['list notifications', 'show notification summaries', 'read recent notifications'],
  'list bookmarks': ['list bookmarks', 'show saved posts', 'read bookmark summaries'],
  'list lists': ['list lists', 'show user lists', 'read list summaries'],
  'list direct messages': ['list direct messages', 'show message conversation summaries', 'count visible DM conversations'],
  'view post detail': ['view post detail', 'open a post thread', 'read a single post detail'],
  'view post replies': ['view post replies', 'show replies to a post', 'open the reply thread'],
  'view post media': ['view post media', 'open media attached to posts', 'inspect post media metadata'],
  'list explore topics': ['list explore topics', 'show Explore topics', 'read trending topic summaries'],
  'list following timeline posts': ['list following timeline posts', 'show Following timeline', 'read posts from followed accounts'],
  'list account followers': ['list account followers', 'show followers for an account', 'read follower summaries'],
  'draft post': ['draft a post', 'prepare a post draft', 'compose a post without publishing'],
  'draft reply': ['draft a reply', 'prepare a reply draft', 'compose a reply without sending'],
  'draft quote post': ['draft a quote post', 'prepare a quote-post draft', 'compose a quote without publishing'],
  'publish post': ['publish post', 'send this post live', 'submit final post'],
  'send direct message': ['send direct message', 'message this account', 'submit a private message'],
  'like post': ['like post', 'like this post', 'mark this post liked'],
  'repost post': ['repost post', 'reshare this post', 'repost this item'],
  'follow account': ['follow account', 'follow this user', 'add this account to following'],
  'delete post': ['delete post', 'remove this post', 'destroy this post'],
  'change account settings': ['change account settings', 'update account security settings', 'modify account controls'],
  'upload media': ['upload media', 'attach media to a post', 'add an image or video upload'],
  'capture network APIs': ['inspect network API candidates', 'capture network APIs', 'list discovered API traces'],
});

function compatCategory(capability) {
  if (capability.category === 'messages') return 'direct_messages';
  if (capability.category) return capability.category;
  const text = `${capability.name ?? ''} ${capability.object ?? ''}`.toLowerCase();
  if (/timeline|feed|recommended|followed updates|explore|trending/u.test(text)) return 'timeline';
  if (/search|query/u.test(text)) return 'search';
  if (/profile|followers|following/u.test(text)) return 'profile';
  if (/post detail|post thread|reply|media|article detail/u.test(text)) return 'post_detail';
  if (/notification/u.test(text)) return 'notifications';
  if (/bookmark/u.test(text)) return 'bookmarks';
  if (/\blists?\b/u.test(text)) return 'lists';
  if (/direct message|dm|message conversation/u.test(text)) return 'direct_messages';
  if (/draft|publish|send|like|repost|follow|delete|settings|upload|contact|submit/u.test(text)) return 'write';
  return 'navigation';
}

function compatRiskLevel(capability, category) {
  if (capability.risk_level) return capability.risk_level;
  const text = `${capability.name ?? ''} ${capability.object ?? ''} ${capability.action ?? ''}`.toLowerCase();
  if (/settings|password|security|login|register/u.test(text)) return 'account_security_critical';
  if (/publish|send direct message|delete|upload|like|repost|follow account|payment|checkout/u.test(text)) return 'write_high';
  if (/draft|contact/u.test(text)) return 'write_low';
  if (category === 'direct_messages') return 'read_private_high';
  if (['timeline', 'notifications', 'bookmarks', 'lists', 'profile'].includes(category)) return 'read_personal_medium';
  return 'read_public_low';
}

function compatEnabledStatus(capability, riskLevel) {
  if (COMPAT_ENABLED_STATUSES.includes(capability.enabled_status)) return capability.enabled_status;
  if (capability.name === 'capture network APIs') return 'candidate_debug_only';
  if (capability.status === 'active') {
    return normalizeCapabilityEnablementStatus({
      ...capability,
      risk_level: riskLevel,
    }, riskPolicyForLevel(riskLevel));
  }
  if (riskLevel === 'write_high' || riskLevel === 'account_security_critical' || capability.status === 'disabled') return 'disabled';
  return 'disabled';
}

function compatDefaultPolicy(capability, enabledStatus, riskLevel) {
  if (capability.default_policy) return capability.default_policy;
  if (enabledStatus === 'disabled') return 'disabled';
  if (enabledStatus === 'candidate_debug_only') return 'candidate_debug_only';
  if (enabledStatus === 'limited_enabled') return 'confirm_or_limited';
  if (enabledStatus === 'confirmation_required') return 'confirmation_required';
  if (enabledStatus === 'draft_only') return 'draft_only';
  if (riskLevel === 'write_low' || capability.safetyLevel !== 'read_only') return 'draft_only';
  return 'read_only';
}

function compatIntentDescriptors(capability, category, riskLevel, enabledStatus, defaultPolicy, evidenceStatus) {
  const raw = capability.intents?.length ? capability.intents : COMPAT_INTENT_PHRASES[capability.name];
  const phrases = compatUniqueStrings((raw?.length ? raw : [capability.name, `open ${capability.object ?? capability.name}`])
    .map((item) => typeof item === 'string' ? item : item?.canonical_utterance ?? item?.canonicalUtterance));
  while (phrases.length < 2) {
    phrases.push(`${capability.action ?? 'use'} ${capability.object ?? capability.name}`);
  }
  return phrases.slice(0, 5).map((phrase, index) => ({
    id: `intent:${capability.id.replace(/^capability:/u, '')}:${compatSlug(`${phrase}-${index + 1}`, `intent-${index + 1}`)}`,
    canonical_utterance: phrase,
    utterance_examples: compatUniqueStrings([phrase, index === 0 ? capability.name : null, `please ${phrase}`]).slice(0, 3),
    negative_examples: riskLevel.startsWith('write') || riskLevel === 'account_security_critical'
      ? ['execute the final action', 'bypass confirmation']
      : ['make a payment', 'delete account data'],
    slots: capability.inputs ?? [],
    category,
    risk_level: riskLevel,
    enabled_status: enabledStatus,
    evidence_status: evidenceStatus,
    default_policy: defaultPolicy,
  }));
}

function compatRouteStateForPath(routePath = '/', category = 'navigation') {
  const route = String(routePath || '/');
  const routeTemplate = route.startsWith('/i/web/status') ? '/:handle/status/:postId' : route;
  let pageKind = category === 'direct_messages' ? 'messages' : category;
  let tabState = 'default';
  if (route === '/notifications') {
    pageKind = 'notifications';
    tabState = 'all';
  } else if (route === '/i/bookmarks') {
    pageKind = 'bookmarks';
    tabState = 'saved';
  } else if (route === '/i/lists') {
    pageKind = 'lists';
    tabState = 'index';
  } else if (route === '/messages') {
    pageKind = 'messages';
    tabState = 'inbox';
  } else if (route === '/explore') {
    pageKind = 'explore';
    tabState = 'discover';
  } else if (route === '/following') {
    pageKind = 'home';
    tabState = 'following';
  } else if (route === '/compose/post') {
    pageKind = 'compose';
    tabState = 'draft';
  } else if (route === '/settings') {
    pageKind = 'settings';
    tabState = 'entry';
  } else if (route.startsWith('/i/web/status')) {
    pageKind = 'post_detail';
    tabState = 'detail';
  }
  const stateId = `${pageKind}:${routeTemplate}:${tabState}`
    .toLowerCase()
    .replace(/[^a-z0-9:]+/gu, '-')
    .replace(/-+/gu, '-')
    .replace(/^-+|-+$/gu, '');
  return {
    source: 'compat-site-route-state-model',
    stateId,
    routeTemplate,
    routePath: route,
    tabState,
    pageType: pageKind,
    pageKind,
  };
}

function compatEnrichAutoCapability(context, capability) {
  const category = compatCategory(capability);
  const riskLevel = compatRiskLevel(capability, category);
  const enabledStatus = compatEnabledStatus(capability, riskLevel);
  const evidenceStatus = capability.evidence_status
    ?? (enabledStatus === 'disabled' ? 'disabled' : enabledStatus === 'candidate_debug_only' ? 'candidate' : 'verified');
  const defaultPolicy = compatDefaultPolicy(capability, enabledStatus, riskLevel);
  const evidenceSources = capability.evidence_sources
    ?? compatUniqueStrings([...(capability.evidence ?? []).map((item) => item?.source), context.site.rootUrl]).slice(0, 8);
  const enriched = {
    ...capability,
    user_facing_name: localizedUserFacingName(capability),
    internal_name: capability.internal_name ?? compatSlug(capability.internalName ?? capability.name, 'capability'),
    category,
    risk_level: riskLevel,
    default_policy: defaultPolicy,
    evidence_status: evidenceStatus,
    evidence_sources: evidenceSources,
    saved_material: capability.saved_material ?? ['capability_metadata', 'sanitized_evidence_sources', 'natural_language_intent_templates'],
    raw_content_saved: false,
    private_content_saved: false,
    enabled_status: enabledStatus,
  };
  enriched.intents = compatIntentDescriptors(enriched, category, riskLevel, enabledStatus, defaultPolicy, evidenceStatus);
  return enriched;
}

function compatExecutionPlan(capabilityId, homepage, context, routeState = compatRouteStateForPath('/compose/post', 'write')) {
  return {
    schemaVersion: BUILD_SCHEMA_VERSION,
    id: `plan:${capabilityId.replace(/^capability:/u, '')}`,
    capabilityId,
    mode: 'dry_run',
    dryRunOnly: true,
    requiresConfirmation: true,
    autoExecute: false,
    draftOnly: true,
    steps: [{
      kind: 'draft_only',
      action: 'draft',
      url: new URL(routeState.routePath || '/compose/post', context.site.rootUrl).toString(),
      nodeId: homepage?.id,
      routeTemplate: routeState.routeTemplate ?? null,
      routePath: routeState.routePath ?? null,
      routeState,
      routeStateId: routeState.stateId ?? null,
      tabState: routeState.tabState ?? null,
      pageKind: routeState.pageKind ?? routeState.pageType ?? null,
      submit: false,
      finalSubmit: false,
      upload: false,
      selectSensitiveRecipient: false,
      autoExecute: false,
      draftOnly: true,
      requiresUserAuthorization: true,
    }],
  };
}

const COMPAT_SEMANTIC_NAME_ALIASES = Object.freeze(new Map([
  ['list followed users', 'followed-users'],
  ['read followed users', 'followed-users'],
  ['list followed updates', 'following-timeline'],
  ['read following timeline', 'following-timeline'],
  ['list following timeline posts', 'following-timeline'],
  ['list recommended timeline posts', 'recommended-timeline'],
  ['read recommended timeline', 'recommended-timeline'],
  ['list profile content', 'profile-content'],
  ['read profile content', 'profile-content'],
  ['list notifications', 'notifications-summary'],
  ['read all notifications summary', 'notifications-summary'],
  ['list bookmarks', 'bookmarks-summary'],
  ['read bookmarks summary', 'bookmarks-summary'],
  ['list lists', 'lists-summary'],
  ['read lists summary', 'lists-summary'],
  ['list direct messages', 'direct-message-summaries'],
  ['read direct message conversation summaries', 'direct-message-summaries'],
]));

function compatSemanticNameKey(value) {
  const key = normalizeLabelKey(value);
  return COMPAT_SEMANTIC_NAME_ALIASES.get(key) ?? key;
}

function compatCanSuppressGeneratedCapability(capability = /** @type {any} */ ({})) {
  const status = normalizeLabelKey(capability.status ?? capability.enabled_status ?? capability.enabledStatus);
  return status === 'active'
    || status === 'enabled'
    || status === 'limited_enabled'
    || status === 'confirmation_required'
    || status === 'draft_only';
}

function compatGenerateAutoCapabilities(context, {
  graph,
  existingCapabilities = /** @type {any[]} */ ([]),
} = /** @type {any} */ ({})) {
  if (!compatIsXSite(context)) {
    return [];
  }
  const homepage = compatHomepage(graph);
  if (!homepage) {
    return [];
  }
  const suppressingCapabilities = existingCapabilities.filter(compatCanSuppressGeneratedCapability);
  const existingNames = new Set(suppressingCapabilities.map((capability) => capability.name));
  const existingSemanticNames = new Set(suppressingCapabilities.map((capability) => compatSemanticNameKey(capability.name)));
  const generated = /** @type {any[]} */ ([]);
  for (const [name, category, riskLevel, action, object, routePath, enabledStatus] of COMPAT_X_SPECS) {
    if (existingNames.has(name) || existingSemanticNames.has(compatSemanticNameKey(name))) {
      continue;
    }
    const id = stableCapabilityId(context.site.id, name);
    const isDraft = enabledStatus === 'draft_only' || (enabledStatus === 'confirmation_required' && riskLevel === 'write_low');
    const callableStatus = isCallableEnablementStatus(enabledStatus) || isDraft;
    const routeState = compatRouteStateForPath(routePath, category);
    const capability = {
      schemaVersion: BUILD_SCHEMA_VERSION,
      id,
      siteId: context.site.id,
      name,
      description: `${name} generated from route, control, and structure evidence.`,
      action,
      object,
      userValue: name,
      entryNodeIds: callableStatus ? [homepage.id] : [],
      requiredNodeIds: callableStatus ? [homepage.id] : [],
      inputs: isDraft ? [{ name: 'draft', type: 'string', required: true }] : [],
      outputs: isDraft ? [{ name: 'draft', type: 'draft_preview' }] : [{ name: 'summary', type: 'sanitized_summary' }],
      safetyLevel: isDraft ? 'requires_confirmation' : riskPolicyForLevel(riskLevel).safetyLevel,
      evidence: compatEvidence(context, homepage, routePath, name, isDraft ? 0.62 : 0.54),
      confidence: isDraft ? 0.62 : 0.54,
      status: callableStatus ? 'active' : 'disabled',
      informational: !isDraft,
      autoGenerated: true,
      category,
      routeTemplate: routeState.routeTemplate,
      routePath: routeState.routePath,
      routeState,
      routeStateId: routeState.stateId,
      tabState: routeState.tabState,
      pageKind: routeState.pageKind,
      risk_level: riskLevel,
      enabled_status: isDraft ? 'draft_only' : enabledStatus,
      evidence_status: enabledStatus === 'disabled' ? 'disabled' : 'inferred',
      default_policy: isDraft ? 'draft_only' : enabledStatus === 'disabled' ? 'disabled' : enabledStatus,
      activationBlockedReason: callableStatus ? null : 'disabled-by-policy',
    };
    if (callableStatus) {
      capability.executionPlan = compatExecutionPlan(id, homepage, context, routeState);
    }
    generated.push(capability);
  }
  return generated;
}

function compatCapabilityEnabledStatusCounts(capabilities = /** @type {any[]} */ ([])) {
  return capabilityEnablementStatusCounts(capabilities);
}

function compatGenerateAutoIntentRecords(context, capabilities = /** @type {any[]} */ ([])) {
  const intents = /** @type {any[]} */ ([]);
  for (const capability of capabilities) {
    const enriched = capability.intents?.[0]?.canonical_utterance
      ? capability
      : enrichAutoCapability(context, capability);
    for (const [index, descriptor] of enriched.intents.entries()) {
      const callable = enriched.status === 'active' && isCallableEnablementStatus(enriched.enabled_status);
      const evidence = Array.isArray(enriched.evidence) && enriched.evidence.length
        ? enriched.evidence
        : [buildEvidence({
          type: 'text',
          source: context.site.rootUrl,
          text: 'Auto-generated intent metadata; raw/private content not saved.',
          confidence: 0.4,
        })];
      intents.push({
        schemaVersion: BUILD_SCHEMA_VERSION,
        id: descriptor.id || `intent:${enriched.id.replace(/^capability:/u, '')}:${sha256Short(`${descriptor.canonical_utterance}:${index}`, 8)}`,
        capabilityId: enriched.id,
        skillId: context.skillId,
        name: enriched.name,
        description: enriched.description,
        canonicalUtterance: descriptor.canonical_utterance,
        utteranceExamples: descriptor.utterance_examples,
        negativeExamples: descriptor.negative_examples,
        slots: descriptor.slots ?? [],
        safetyLevel: enriched.safetyLevel,
        invocationScore: callable ? Math.max(0.7, 0.96 - index * 0.03) : Math.max(0.2, 0.54 - index * 0.02),
        evidence,
        callable,
        enabled_status: enriched.enabled_status,
        evidence_status: enriched.evidence_status,
        default_policy: enriched.default_policy,
        category: enriched.category,
        risk_level: enriched.risk_level,
      });
    }
  }
  return intents.sort((left, right) => left.id.localeCompare(right.id, 'en'));
}
