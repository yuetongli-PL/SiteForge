// @ts-check

import {
  assertNoExecutionSensitiveMaterial,
} from '../../../domain/policies/execution/index.mjs';
import {
  inferRuntimeCapabilityKind,
} from '../provider-registry.mjs';

const ZHIHU_READONLY_PROVIDER_ID = 'zhihu_readonly_provider';
const ZHIHU_ORIGIN = 'https://www.zhihu.com';
const READ_KINDS = Object.freeze(new Set(['read', 'query', 'search', 'navigate', 'public_http']));
const ZHIHU_ANSWER_EXPORT_DISALLOWED_REASON = 'runtime.zhihu_answer_export_disallowed';
const ZHIHU_ANSWER_EXPORT_RUNTIME_MODE = 'zhihu_answer_export_guard_v1';
const BLOCKED_PATTERN = /\b(?:delete|destroy|clear|reset|cancel|revoke|pay|payment|purchase|checkout|billing|download|export|write|submit|update|create|publish|follow|unfollow|vote|like|collect|message|send|upload)\b/iu;

function normalizeText(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function normalizeKind(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/gu, '_')
    .replace(/^_+|_+$/gu, '');
}

function descriptorKind(descriptor = {}) {
  const kind = inferRuntimeCapabilityKind(descriptor);
  if (kind !== 'generic') return kind;
  for (const value of [
    descriptor.runtimeContext?.capabilityKind,
    descriptor.runtimeContext?.operationKind,
    descriptor.runtimeContext?.runtimeBindingKind,
    descriptor.executionContract?.capabilityKind,
    descriptor.executionContract?.operationKind,
    descriptor.executionContract?.runtimeBinding?.kind,
  ]) {
    const direct = normalizeKind(value);
    if (direct) return direct;
  }
  return kind;
}

function descriptorText(descriptor = {}) {
  return [
    descriptor.invocationRequest?.capabilityId,
    descriptor.invocationRequest?.taskId,
    descriptor.executionContract?.capabilityId,
    descriptor.executionContract?.operationKind,
    descriptor.executionContract?.contractKind,
    descriptor.executionContract?.runtimeBinding?.kind,
    descriptor.executionContract?.description,
    descriptor.capability?.id,
    descriptor.capability?.name,
    descriptor.capability?.action,
    descriptor.capability?.description,
    descriptor.runtimeContext?.executionTask,
    descriptor.runtimeContext?.taskText,
    descriptor.runtimeContext?.requestText,
    descriptor.runtimeContext?.userRequest,
    descriptor.runtimeContext?.naturalLanguageTask,
  ].map((value) => String(value ?? '')).join(' ');
}

function isZhihuSiteDescriptor(descriptor = {}) {
  const text = descriptorText(descriptor).toLowerCase();
  const siteKey = normalizeText(descriptor.runtimeContext?.siteKey).toLowerCase();
  const siteHost = normalizeText(descriptor.runtimeContext?.siteHost).toLowerCase();
  return siteKey === 'zhihu'
    || siteHost === 'www.zhihu.com'
    || siteHost === 'zhihu.com'
    || siteHost.endsWith('.zhihu.com')
    || text.includes('zhihu');
}

function isBlockedText(text) {
  const blockingText = stripNegatedBlockedTerms(text);
  return BLOCKED_PATTERN.test(blockingText)
    && !/\b(?:followed-users|followed\s+users|following\s+(?:accounts|list)|followed-updates|followed\s+updates)\b/iu.test(blockingText);
}

function stripNegatedBlockedTerms(text) {
  return String(text ?? '')
    .replace(/\b(?:do\s+not|don't|dont|without|no|avoid|skip|disable)\b[^.;,\n，。；]{0,48}\b(?:download(?:ing)?|export(?:ing)?|sav(?:e|ing)|persist(?:ing)?|writ(?:e|ing)|index(?:ing)?|raw|body|local)\b[^.;,\n，。；]{0,24}/giu, ' ')
    .replace(/(?:不要|不需要|无需|别|避免|禁止|不能|不必|不再)[^,，。；;\n]{0,48}(?:导出|下载|保存|写入|落地|索引|正文|原文|本地)[^,，。；;\n]{0,24}/gu, ' ');
}

function isZhihuAnswerExportDescriptor(descriptor = {}) {
  if (!isZhihuSiteDescriptor(descriptor)) return false;
  const text = stripNegatedBlockedTerms(descriptorText(descriptor)).toLowerCase();
  const answerSurface = /\b(?:answer|answers|answer-list|question-answers?)\b/u.test(text)
    || /(?:回答|答案)/u.test(text);
  const questionSurface = /\bquestions?\b/u.test(text) || /问题/u.test(text);
  const bulkAnswerSurface = /\b(?:all|every|bulk|full|complete|entire)\s+(?:question\s+)?answers?\b/u.test(text)
    || /(?:所有|全部|全量|完整)[^,，。；;\n]{0,12}(?:回答|答案)/u.test(text);
  const exportOrPersistence = /\b(?:download|export|dump|archive|save|persist|write|jsonl|csv|txt|markdown|md|local\s+index|cache[-_\s]?index)\b/u.test(text)
    || /(?:导出|下载|保存|写入|落地|归档|本地|索引)/u.test(text);
  const bodyMaterial = /\b(?:body|text|full\s+text|raw\s+content|content)\b/u.test(text)
    || /(?:正文|原文|全文|完整内容)/u.test(text);
  return answerSurface
    && (questionSurface || bulkAnswerSurface)
    && (exportOrPersistence || bodyMaterial);
}

function isZhihuSearchDescriptor(descriptor = {}) {
  const text = descriptorText(descriptor).toLowerCase();
  return isZhihuSiteDescriptor(descriptor)
    && (text.includes('search-posts') || /\bsearch\b/u.test(text))
    && !isBlockedText(text);
}

function isZhihuHotDescriptor(descriptor = {}) {
  const text = descriptorText(descriptor).toLowerCase();
  return isZhihuSiteDescriptor(descriptor)
    && /\b(?:list-hot-posts|hot-posts|hot\s+posts|hot\s+list|hot\s+ranking|zhihu\s+hot)\b/u.test(text)
    && !isBlockedText(text);
}

function isZhihuHotBroadcastDescriptor(descriptor = {}) {
  const text = descriptorText(descriptor).toLowerCase();
  return isZhihuSiteDescriptor(descriptor)
    && /\b(?:list-hot-broadcasts|hot-broadcasts|hot\s+broadcasts?|drama\s+feed|live\s+feed)\b/u.test(text)
    && !isBlockedText(text);
}

function isZhihuFollowedUsersDescriptor(descriptor = {}) {
  const text = descriptorText(descriptor).toLowerCase();
  return isZhihuSiteDescriptor(descriptor)
    && /\b(?:list|read|show)\b/u.test(text)
    && /\b(?:followed-users|followed\s+users|following\s+(?:accounts|list)|who\s+do\s+i\s+follow)\b/u.test(text)
    && !isBlockedText(text);
}

function isZhihuFeedDescriptor(descriptor = {}) {
  const text = descriptorText(descriptor).toLowerCase();
  return isZhihuSiteDescriptor(descriptor)
    && /\b(?:list|read|show)\b/u.test(text)
    && /\b(?:followed-updates|followed\s+updates|recommended-timeline|timeline|feed|homepage)\b/u.test(text)
    && !isBlockedText(text);
}

function isZhihuNotificationsDescriptor(descriptor = {}) {
  const text = descriptorText(descriptor).toLowerCase();
  return isZhihuSiteDescriptor(descriptor)
    && /\b(?:list|read|show)\b/u.test(text)
    && /\bnotifications?\b/u.test(text)
    && !isBlockedText(text);
}

function isZhihuProfileDescriptor(descriptor = {}) {
  const text = descriptorText(descriptor).toLowerCase();
  return isZhihuSiteDescriptor(descriptor)
    && /\b(?:profile-content|list-profile-content|account-info|profile)\b/u.test(text)
    && !isBlockedText(text);
}

function zhihuProfileTabMode(descriptor = {}) {
  const text = descriptorText(descriptor).toLowerCase();
  if (!isZhihuSiteDescriptor(descriptor) || isBlockedText(text)) return null;
  for (const [needle, mode] of [
    ['list-user-activities', 'user-activities'],
    ['user activities', 'user-activities'],
    ['list-user-answers', 'user-answers'],
    ['user answers', 'user-answers'],
    ['list-user-questions', 'user-questions'],
    ['user questions', 'user-questions'],
    ['list-user-articles', 'user-articles'],
    ['user articles', 'user-articles'],
    ['list-user-columns', 'user-columns'],
    ['user columns', 'user-columns'],
    ['list-user-pins', 'user-pins'],
    ['user pins', 'user-pins'],
    ['user thoughts', 'user-pins'],
    ['list-user-collections', 'user-collections'],
    ['user collections', 'user-collections'],
    ['list-user-videos', 'user-videos'],
    ['user videos', 'user-videos'],
    ['list-user-following', 'user-following'],
    ['user following', 'user-following'],
  ]) {
    if (text.includes(needle)) return mode;
  }
  return null;
}

function isZhihuProfileTabDescriptor(descriptor = {}) {
  return zhihuProfileTabMode(descriptor) !== null;
}

function zhihuTopicMode(descriptor = {}) {
  const text = descriptorText(descriptor).toLowerCase();
  if (!isZhihuSiteDescriptor(descriptor) || isBlockedText(text)) return null;
  if (/\b(?:list-topic-featured|topic-featured|topic\s+featured|featured\s+answers?|top\s+answers?)\b/u.test(text)) {
    return 'topic-featured';
  }
  if (/\b(?:list-topic-discussions|topic-discussions|topic\s+discussions?)\b/u.test(text)) {
    return 'topic-discussions';
  }
  return null;
}

function isZhihuTopicDescriptor(descriptor = {}) {
  return zhihuTopicMode(descriptor) !== null;
}

function isZhihuQuestionDescriptor(descriptor = {}) {
  const text = descriptorText(descriptor).toLowerCase();
  return isZhihuSiteDescriptor(descriptor)
    && /\b(?:view-question-detail|question-detail|question\s+detail)\b/u.test(text)
    && !isBlockedText(text);
}

function isZhihuAnswerDescriptor(descriptor = {}) {
  const text = descriptorText(descriptor).toLowerCase();
  return isZhihuSiteDescriptor(descriptor)
    && /\b(?:view-answer-detail|answer-detail|answer\s+detail)\b/u.test(text)
    && !isBlockedText(text);
}

function supportsZhihuReadonly(descriptor = {}) {
  const contract = descriptor.executionContract ?? {};
  const capability = descriptor.capability ?? {};
  if (
    contract.destructiveAction === true
    || contract.paymentOrFundsAction === true
    || capability.destructiveAction === true
    || capability.paymentOrFundsAction === true
  ) {
    return false;
  }
  if (isZhihuAnswerExportDescriptor(descriptor)) {
    return true;
  }
  return (
    isZhihuSearchDescriptor(descriptor)
    || isZhihuHotDescriptor(descriptor)
    || isZhihuHotBroadcastDescriptor(descriptor)
    || isZhihuFollowedUsersDescriptor(descriptor)
    || isZhihuFeedDescriptor(descriptor)
    || isZhihuNotificationsDescriptor(descriptor)
    || isZhihuProfileDescriptor(descriptor)
    || isZhihuProfileTabDescriptor(descriptor)
    || isZhihuTopicDescriptor(descriptor)
    || isZhihuQuestionDescriptor(descriptor)
    || isZhihuAnswerDescriptor(descriptor)
  ) && READ_KINDS.has(descriptorKind(descriptor));
}

function runtimeSlotValues(runtimeContext = null) {
  const values = runtimeContext?.slotValues ?? runtimeContext?.fixtureSlotValues ?? null;
  return values && typeof values === 'object' && !Array.isArray(values) ? values : {};
}

function searchQueryFrom(options = {}) {
  const values = runtimeSlotValues(options.runtimeContext);
  return normalizeText(values.query ?? values.keyword ?? values.q);
}

function accountFrom(options = {}) {
  const values = runtimeSlotValues(options.runtimeContext);
  const account = normalizeText(values.account ?? values.urlToken ?? values.profile ?? values.user);
  return /^[A-Za-z0-9_-]{2,80}$/u.test(account) ? account : '';
}

function topicIdFrom(options = {}) {
  const values = runtimeSlotValues(options.runtimeContext);
  const topicId = normalizeText(values.topic_id ?? values.topicId ?? values.topic);
  return /^\d{2,32}$/u.test(topicId) ? topicId : '';
}

function questionIdFrom(options = {}) {
  const values = runtimeSlotValues(options.runtimeContext);
  const questionId = normalizeText(values.question_id ?? values.questionId ?? values.question);
  return /^\d{2,32}$/u.test(questionId) ? questionId : '';
}

function answerIdFrom(options = {}) {
  const values = runtimeSlotValues(options.runtimeContext);
  const answerId = normalizeText(values.answer_id ?? values.answerId ?? values.answer);
  return /^\d{2,32}$/u.test(answerId) ? answerId : '';
}

function responseContentType(response = null) {
  try {
    return String(response?.headers?.get?.('content-type') ?? '').trim() || null;
  } catch {
    return null;
  }
}

function zhihuAuthOrChallengeSignals(bodyText) {
  return [
    /\b(?:login|signin|captcha|verify|verification|challenge|unhuman)\b/iu,
    /(?:\u767b\u5f55|\u6ce8\u518c|\u8bf7\u5148\u767b\u5f55|\u5b89\u5168\u9a8c\u8bc1|\u8eab\u4efd\u9a8c\u8bc1|\u8bbf\u95ee\u5f02\u5e38)/u,
  ].filter((pattern) => pattern.test(String(bodyText ?? ''))).length;
}

function summarizeZhihuHtml(text, mode) {
  const bodyText = String(text ?? '');
  const containerMatches = bodyText.match(/\b(?:TopstoryItem|SearchResult|ContentItem|List-item|QuestionItem|AnswerItem|ProfileHeader|Notifications|Card|Feed|TopicItem|TopicCard|ZVideoItem|PinItem|ColumnItem|CollectionItem|ActivityItem|BroadcastItem|LiveCard)\b/gu) ?? [];
  const emptyStatePresent = /\b(?:no\s+result|empty|not\s+found)\b/iu.test(bodyText)
    || /(?:\u6682\u65e0|\u6ca1\u6709\u627e\u5230|\u65e0\u7ed3\u679c|\u8fd8\u6ca1\u6709)/u.test(bodyText);
  const authOrChallengeSignals = zhihuAuthOrChallengeSignals(bodyText);
  return {
    kind: 'html',
    mode,
    byteLength: Buffer.byteLength(bodyText),
    resultContainerSignals: Math.min(containerMatches.length, 200),
    emptyStatePresent,
    authOrChallengeSignals,
    resultStateVerified: containerMatches.length > 0 || emptyStatePresent,
  };
}

function failedZhihuReadonly(reasonCode, options = {}, runtimeMode = 'zhihu_readonly_http_read_v1', extraSummary = {}) {
  const resultSummary = {
    outcome: 'zhihu_readonly_failed',
    providerId: ZHIHU_READONLY_PROVIDER_ID,
    reasonCode,
    runtimeMode,
    responseMaterial: 'sanitized_summary_only',
    queryProvided: Boolean(searchQueryFrom(options)),
    accountProvided: Boolean(accountFrom(options)),
    topicProvided: Boolean(topicIdFrom(options)),
    ...extraSummary,
    artifactRefs: [],
    redactionRequired: true,
  };
  assertNoExecutionSensitiveMaterial(resultSummary);
  return {
    providerId: ZHIHU_READONLY_PROVIDER_ID,
    providerKind: 'zhihu_readonly_provider',
    status: 'failed',
    reasonCode,
    runtimeExecuted: true,
    sideEffectAttempted: false,
    sideEffectSucceeded: false,
    sideEffectFailed: true,
    resultSummary,
  };
}

function failedZhihuAnswerExport(options = {}) {
  return failedZhihuReadonly(
    ZHIHU_ANSWER_EXPORT_DISALLOWED_REASON,
    options,
    ZHIHU_ANSWER_EXPORT_RUNTIME_MODE,
    {
      requestedSurface: 'zhihu_question_answers',
      requestedOperation: 'bulk_answer_export',
      contentPersistence: 'disallowed',
      localArtifactCreation: 'not_attempted',
      nearestActiveCapabilities: [
        'capability:www.zhihu.com:view-question-detail',
        'capability:www.zhihu.com:view-answer-detail',
      ],
    },
  );
}

function failedZhihuHttpRead(reasonCode, response = null, bodyText = '', authSummary = null, bodySummary = null, runtimeMode = 'zhihu_readonly_http_read_v1') {
  const resultSummary = {
    outcome: 'zhihu_readonly_failed',
    providerId: ZHIHU_READONLY_PROVIDER_ID,
    reasonCode,
    runtimeMode,
    responseMaterial: 'sanitized_summary_only',
    response: {
      status: Number(response?.status ?? 0) || null,
      ok: response?.ok === true,
      contentType: responseContentType(response),
      bodySummary,
    },
    authSummary,
    artifactRefs: [],
    redactionRequired: true,
  };
  assertNoExecutionSensitiveMaterial(resultSummary);
  return {
    providerId: ZHIHU_READONLY_PROVIDER_ID,
    providerKind: 'zhihu_readonly_provider',
    status: 'failed',
    reasonCode,
    runtimeExecuted: true,
    sideEffectAttempted: true,
    sideEffectSucceeded: false,
    sideEffectFailed: true,
    authSummary,
    resultSummary,
  };
}

async function applyOptionalHttpAuth(options, request) {
  if (options.authAdapter?.isRequired?.() !== true) {
    return { ok: true, request, authSummary: null };
  }
  const applied = await options.authAdapter.applyHttpAuth({
    url: request.url,
    method: request.method,
  });
  if (applied.ok !== true) {
    return {
      ok: false,
      reasonCode: applied.reasonCode ?? 'runtime.auth_required',
      authSummary: applied.authSummary ?? null,
    };
  }
  return {
    ok: true,
    authSummary: applied.authSummary ?? null,
    request: {
      url: applied.request.url,
      method: applied.request.method,
      headers: applied.request.headers,
    },
  };
}

async function fetchReadonly(request, fetchImpl) {
  return fetchImpl(request.url, {
    method: request.method,
    headers: request.headers,
    redirect: 'manual',
  });
}

function requestForMode(mode, options = {}) {
  if (mode === 'search') {
    const query = searchQueryFrom(options);
    if (!query) return { ok: false, reasonCode: 'runtime.missing_required_slot' };
    const descriptor = descriptorText(options).toLowerCase();
    const url = new URL('/search', ZHIHU_ORIGIN);
    const searchType = /\b(?:search-users|users|people)\b/u.test(descriptor) ? 'people' : 'content';
    url.searchParams.set('type', searchType);
    url.searchParams.set('q', query);
    return {
      ok: true,
      url,
      runtimeMode: 'zhihu_search_http_read_v1',
      outcome: 'zhihu_search_read_completed',
      pathTemplate: `/search?type=${searchType}&q={query}`,
    };
  }
  if (mode === 'hot') {
    return {
      ok: true,
      url: new URL('/hot', ZHIHU_ORIGIN),
      runtimeMode: 'zhihu_hot_http_read_v1',
      outcome: 'zhihu_hot_posts_read_completed',
      pathTemplate: '/hot',
    };
  }
  if (mode === 'hot-broadcasts') {
    return {
      ok: true,
      url: new URL('/drama/feed', ZHIHU_ORIGIN),
      runtimeMode: 'zhihu_hot_broadcasts_http_read_v1',
      outcome: 'zhihu_hot_broadcasts_read_completed',
      pathTemplate: '/drama/feed',
    };
  }
  if (mode === 'topic-discussions' || mode === 'topic-featured') {
    const topicId = topicIdFrom(options);
    if (!topicId) return { ok: false, reasonCode: 'runtime.missing_required_topic_slot' };
    const suffix = mode === 'topic-featured' ? 'top-answers' : 'hot';
    return {
      ok: true,
      url: new URL(`/topic/${topicId}/${suffix}`, ZHIHU_ORIGIN),
      runtimeMode: `zhihu_${mode.replace(/-/gu, '_')}_http_read_v1`,
      outcome: mode === 'topic-featured'
        ? 'zhihu_topic_featured_read_completed'
        : 'zhihu_topic_discussions_read_completed',
      pathTemplate: mode === 'topic-featured'
        ? '/topic/{topic_id}/top-answers'
        : '/topic/{topic_id}/hot',
    };
  }
  if (mode === 'profile') {
    const account = accountFrom(options);
    if (!account) return { ok: false, reasonCode: 'runtime.missing_required_account_slot' };
    return {
      ok: true,
      url: new URL(`/people/${account}`, ZHIHU_ORIGIN),
      runtimeMode: 'zhihu_profile_http_read_v1',
      outcome: 'zhihu_profile_read_completed',
      pathTemplate: '/people/{account}',
    };
  }
  if (mode.startsWith('user-')) {
    const account = accountFrom(options);
    if (!account) return { ok: false, reasonCode: 'runtime.missing_required_account_slot' };
    const tabPaths = {
      'user-activities': 'activities',
      'user-answers': 'answers',
      'user-questions': 'asks',
      'user-articles': 'posts',
      'user-columns': 'columns',
      'user-pins': 'pins',
      'user-collections': 'collections',
      'user-videos': 'zvideos',
      'user-following': 'following',
    };
    const tabPath = tabPaths[mode];
    if (!tabPath) return { ok: false, reasonCode: 'runtime.zhihu_readonly_provider_unsupported' };
    return {
      ok: true,
      url: new URL(`/people/${account}/${tabPath}`, ZHIHU_ORIGIN),
      runtimeMode: `zhihu_${mode.replace(/-/gu, '_')}_http_read_v1`,
      outcome: `zhihu_${mode.replace(/-/gu, '_')}_read_completed`,
      pathTemplate: `/people/{account}/${tabPath}`,
    };
  }
  if (mode === 'followed-users') {
    return {
      ok: true,
      url: new URL('/follow', ZHIHU_ORIGIN),
      runtimeMode: 'zhihu_followed_users_http_read_v1',
      outcome: 'zhihu_followed_users_read_completed',
      pathTemplate: '/follow',
    };
  }
  if (mode === 'notifications') {
    return {
      ok: true,
      url: new URL('/notifications', ZHIHU_ORIGIN),
      runtimeMode: 'zhihu_notifications_http_read_v1',
      outcome: 'zhihu_notifications_read_completed',
      pathTemplate: '/notifications',
    };
  }
  if (mode === 'question') {
    const questionId = questionIdFrom(options);
    if (!questionId) return { ok: false, reasonCode: 'runtime.missing_required_question_slot' };
    return {
      ok: true,
      url: new URL(`/question/${questionId}`, ZHIHU_ORIGIN),
      runtimeMode: 'zhihu_question_detail_http_read_v1',
      outcome: 'zhihu_question_detail_read_completed',
      pathTemplate: '/question/{question_id}',
    };
  }
  if (mode === 'answer') {
    const questionId = questionIdFrom(options);
    const answerId = answerIdFrom(options);
    if (!answerId) return { ok: false, reasonCode: 'runtime.missing_required_answer_slot' };
    const pathname = questionId
      ? `/question/${questionId}/answer/${answerId}`
      : `/answer/${answerId}`;
    return {
      ok: true,
      url: new URL(pathname, ZHIHU_ORIGIN),
      runtimeMode: 'zhihu_answer_detail_http_read_v1',
      outcome: 'zhihu_answer_detail_read_completed',
      pathTemplate: questionId ? '/question/{question_id}/answer/{answer_id}' : '/answer/{answer_id}',
    };
  }
  return {
    ok: true,
    url: new URL('/', ZHIHU_ORIGIN),
    runtimeMode: 'zhihu_feed_http_read_v1',
    outcome: 'zhihu_feed_read_completed',
    pathTemplate: '/',
  };
}

function modeFromDescriptor(descriptor = {}) {
  if (isZhihuSearchDescriptor(descriptor)) return 'search';
  if (isZhihuHotDescriptor(descriptor)) return 'hot';
  if (isZhihuHotBroadcastDescriptor(descriptor)) return 'hot-broadcasts';
  if (isZhihuFollowedUsersDescriptor(descriptor)) return 'followed-users';
  if (isZhihuNotificationsDescriptor(descriptor)) return 'notifications';
  const topicMode = zhihuTopicMode(descriptor);
  if (topicMode) return topicMode;
  const profileTabMode = zhihuProfileTabMode(descriptor);
  if (profileTabMode) return profileTabMode;
  if (isZhihuProfileDescriptor(descriptor)) return 'profile';
  if (isZhihuQuestionDescriptor(descriptor)) return 'question';
  if (isZhihuAnswerDescriptor(descriptor)) return 'answer';
  return 'feed';
}

async function runZhihuReadonly(options = {}) {
  if (isZhihuAnswerExportDescriptor(options)) {
    return failedZhihuAnswerExport(options);
  }
  const mode = modeFromDescriptor(options);
  const requestDescriptor = requestForMode(mode, options);
  if (requestDescriptor.ok !== true) {
    return failedZhihuReadonly(requestDescriptor.reasonCode, options, `zhihu_${mode}_http_read_v1`);
  }
  const fetchImpl = options.runtimeContext?.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    return failedZhihuReadonly('runtime.provider_failed', options, requestDescriptor.runtimeMode);
  }
  let request = {
    url: requestDescriptor.url.toString(),
    method: 'GET',
    headers: {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.1',
    },
  };
  const auth = await applyOptionalHttpAuth(options, request);
  if (auth.ok !== true) {
    return failedZhihuReadonly(auth.reasonCode, options, requestDescriptor.runtimeMode);
  }
  request = auth.request;
  let response;
  try {
    response = await fetchReadonly(request, fetchImpl);
  } catch {
    return failedZhihuReadonly('runtime.provider_failed', options, requestDescriptor.runtimeMode);
  }
  const contentType = responseContentType(response);
  const bodyText = typeof response?.text === 'function' ? await response.text() : '';
  const status = Number(response?.status ?? 0) || null;
  const bodySummary = summarizeZhihuHtml(bodyText, mode);
  if (status !== null && (status < 200 || status >= 300)) {
    return failedZhihuHttpRead(
      status >= 300 && status < 400
        ? 'runtime.zhihu_readonly_auth_or_redirect_required'
        : 'runtime.zhihu_readonly_http_failed',
      response,
      bodyText,
      auth.authSummary,
      bodySummary,
      requestDescriptor.runtimeMode,
    );
  }
  if (bodySummary.authOrChallengeSignals > 0) {
    return failedZhihuHttpRead(
      'runtime.zhihu_readonly_auth_or_challenge_required',
      response,
      bodyText,
      auth.authSummary,
      bodySummary,
      requestDescriptor.runtimeMode,
    );
  }
  if (bodySummary.resultStateVerified !== true) {
    return failedZhihuHttpRead(
      'runtime.zhihu_readonly_unverified_result_state',
      response,
      bodyText,
      auth.authSummary,
      bodySummary,
      requestDescriptor.runtimeMode,
    );
  }
  const resultSummary = {
    outcome: requestDescriptor.outcome,
    providerId: ZHIHU_READONLY_PROVIDER_ID,
    runtimeMode: requestDescriptor.runtimeMode,
    responseMaterial: 'sanitized_summary_only',
    request: {
      origin: ZHIHU_ORIGIN,
      pathTemplate: requestDescriptor.pathTemplate ?? requestDescriptor.url.pathname,
      method: 'GET',
      querySlotUsed: mode === 'search',
      accountSlotUsed: mode === 'profile' || mode.startsWith('user-'),
      topicSlotUsed: mode === 'topic-discussions' || mode === 'topic-featured',
      questionSlotUsed: mode === 'question' || mode === 'answer',
      answerSlotUsed: mode === 'answer',
    },
    response: {
      status,
      ok: response?.ok === true,
      contentType,
      bodySummary,
    },
    authSummary: auth.authSummary,
    artifactRefs: [],
    redactionRequired: true,
  };
  assertNoExecutionSensitiveMaterial(resultSummary);
  return {
    providerId: ZHIHU_READONLY_PROVIDER_ID,
    providerKind: 'zhihu_readonly_provider',
    status: 'completed',
    runtimeExecuted: true,
    sideEffectAttempted: true,
    sideEffectSucceeded: true,
    sideEffectFailed: false,
    authSummary: auth.authSummary,
    resultSummary,
  };
}

export function createZhihuReadonlyProvider() {
  return {
    id: ZHIHU_READONLY_PROVIDER_ID,
    providerKind: 'zhihu_readonly_provider',
    capabilityKinds: ['read', 'query', 'search'],
    supports(descriptor = {}) {
      return supportsZhihuReadonly(descriptor);
    },
    canExecute(options = {}) {
      if (isZhihuAnswerExportDescriptor(options)) {
        return {
          allowed: false,
          reasonCode: ZHIHU_ANSWER_EXPORT_DISALLOWED_REASON,
        };
      }
      if (!supportsZhihuReadonly(options)) {
        return {
          allowed: false,
          reasonCode: 'runtime.zhihu_readonly_provider_unsupported',
        };
      }
      if (isZhihuSearchDescriptor(options) && !searchQueryFrom(options)) {
        return {
          allowed: false,
          reasonCode: 'runtime.missing_required_slot',
        };
      }
      if (isZhihuQuestionDescriptor(options) && !questionIdFrom(options)) {
        return {
          allowed: false,
          reasonCode: 'runtime.missing_required_question_slot',
        };
      }
      if (isZhihuAnswerDescriptor(options) && !answerIdFrom(options)) {
        return {
          allowed: false,
          reasonCode: 'runtime.missing_required_answer_slot',
        };
      }
      if (isZhihuProfileDescriptor(options) && !accountFrom(options)) {
        return {
          allowed: false,
          reasonCode: 'runtime.missing_required_account_slot',
        };
      }
      if (isZhihuProfileTabDescriptor(options) && !accountFrom(options)) {
        return {
          allowed: false,
          reasonCode: 'runtime.missing_required_account_slot',
        };
      }
      if (isZhihuTopicDescriptor(options) && !topicIdFrom(options)) {
        return {
          allowed: false,
          reasonCode: 'runtime.missing_required_topic_slot',
        };
      }
      return { allowed: true };
    },
    async run(options = {}) {
      return runZhihuReadonly(options);
    },
  };
}

export { ZHIHU_READONLY_PROVIDER_ID };
