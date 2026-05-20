function normalizeText(value, cleanDisplayText) {
  return cleanDisplayText(String(value ?? '')).trim();
}

function isSearchNoteIntent(intentType) {
  return intentType === 'search-video' || intentType === 'search-book' || intentType === 'search-work';
}

function isOpenNoteIntent(intentType) {
  return intentType === 'open-video' || intentType === 'open-book' || intentType === 'open-work';
}

function isOpenUserIntent(intentType) {
  return intentType === 'open-author' || intentType === 'open-up' || intentType === 'open-model' || intentType === 'open-actress';
}

function isDownloadNoteIntent(intentType) {
  return intentType === 'download-video' || intentType === 'download-book' || intentType === 'download-work';
}

function uniqueExamples(values) {
  return [...new Set(values.filter(Boolean))];
}

function isNotificationLikeLabel(label) {
  return /通知|消息/u.test(label);
}

function isLiveListLikeLabel(label) {
  return /直播|livelist/iu.test(label);
}

export function createXiaohongshuNlSemantics(deps) {
  const {
    INTENT_LANGUAGE_LABELS,
    ELEMENT_KIND_LABELS,
    ZH_STATUS_QUERY_EXAMPLES,
    ZH_SEARCH_VERBS,
    ZH_OPEN_VERBS,
    cleanDisplayText,
  } = deps;

  const noteSearchAliases = ['搜索笔记', '搜笔记', '查找笔记', '搜小红书', '搜小红书笔记', '搜索图文', '搜图文', '搜索帖子', '搜索图片帖子'];
  const openNoteAliases = ['打开笔记', '查看笔记', '进入笔记', '打开图文', '查看图文', '打开帖子', '查看帖子', '看这篇笔记'];
  const downloadNoteAliases = ['下载笔记', '下载图文', '下载帖子', '下载图片帖子', '保存图文', '保存帖子图片'];
  const openUserAliases = ['打开用户主页', '查看用户主页', '进入用户主页', '打开博主主页', '查看博主主页', '打开作者主页', '查看作者主页'];
  const openDiscoverAliases = ['打开发现页', '浏览发现页', '进入发现页', '查看发现页', '回到发现页'];
  const openAuthAliases = ['打开登录页', '打开注册页', '进入登录页', '进入注册页', '打开登录页但不自动提交凭证'];
  const openUtilityAliases = ['打开通知页', '查看通知页', '进入通知页', '打开消息页', '查看消息页', '打开通知'];
  const followedUsersAliases = ['查询关注用户列表', '列出我关注的用户', '查看关注用户列表', '我关注了哪些用户', '关注了哪些用户', '我的关注列表'];
  const followedUpdatesAliases = ['查询关注用户最近更新', '我关注的人最近发了什么', '查看关注更新', '列出关注用户最近的图文', '关注用户最近的图文'];

  return {
    siteKey: 'xiaohongshu',
    intentLabels: {
      ...INTENT_LANGUAGE_LABELS,
      'search-video': {
        canonical: '搜索笔记',
        aliases: noteSearchAliases,
      },
      'search-book': {
        canonical: '搜索笔记',
        aliases: noteSearchAliases,
      },
      'search-work': {
        canonical: '搜索笔记',
        aliases: noteSearchAliases,
      },
      'open-video': {
        canonical: '打开笔记',
        aliases: openNoteAliases,
      },
      'open-book': {
        canonical: '打开笔记',
        aliases: openNoteAliases,
      },
      'open-work': {
        canonical: '打开笔记',
        aliases: openNoteAliases,
      },
      'download-video': {
        canonical: '下载笔记',
        aliases: downloadNoteAliases,
      },
      'download-book': {
        canonical: '下载笔记',
        aliases: downloadNoteAliases,
      },
      'download-work': {
        canonical: '下载笔记',
        aliases: downloadNoteAliases,
      },
      'open-author': {
        canonical: '打开用户主页',
        aliases: openUserAliases,
      },
      'open-up': {
        canonical: '打开用户主页',
        aliases: openUserAliases,
      },
      'open-model': {
        canonical: '打开用户主页',
        aliases: openUserAliases,
      },
      'open-actress': {
        canonical: '打开用户主页',
        aliases: openUserAliases,
      },
      'open-category': {
        canonical: '打开发现页',
        aliases: openDiscoverAliases,
      },
      'open-auth-page': {
        canonical: '打开登录页',
        aliases: openAuthAliases,
      },
      'open-utility-page': {
        canonical: '打开通知页',
        aliases: openUtilityAliases,
      },
      'list-followed-users': {
        canonical: '查询关注用户列表',
        aliases: followedUsersAliases,
      },
      'list-followed-updates': {
        canonical: '查询关注用户最近更新',
        aliases: followedUpdatesAliases,
      },
    },
    elementLabels: {
      ...ELEMENT_KIND_LABELS,
      'content-link-group': {
        canonical: '笔记',
        aliases: ['笔记', '笔记详情', '图文', '帖子'],
      },
      'author-link-group': {
        canonical: '用户',
        aliases: ['用户', '用户主页', '博主', '作者'],
      },
      'search-form-group': {
        canonical: '搜索笔记',
        aliases: ['搜索笔记', '搜笔记', '搜索框', '搜索'],
      },
      'category-link-group': {
        canonical: '发现页',
        aliases: ['发现页', '发现', '图文', '视频', '用户'],
      },
      'auth-link-group': {
        canonical: '登录页',
        aliases: ['登录页', '注册页', '认证页'],
      },
      'utility-link-group': {
        canonical: '通知页',
        aliases: ['通知页', '消息页', '通知', '消息', '关注列表'],
      },
    },
    statusExamples: {
      ...ZH_STATUS_QUERY_EXAMPLES,
      'content-link-group': ['当前打开的是哪篇笔记', '现在在看哪篇笔记', '当前页是哪篇笔记详情'],
      'author-link-group': ['当前打开的是哪个用户主页', '现在在看哪个博主', '当前页是哪位作者主页'],
      'search-form-group': ['当前搜索的是什么笔记', '现在的搜索词是什么', '当前在搜什么关键词'],
      'category-link-group': ['当前是不是在发现页', '现在在发现页还是搜索结果页', '当前打开的是发现页吗'],
      'auth-link-group': ['当前是登录页还是注册页', '现在打开的是登录页吗'],
      'utility-link-group': ['当前是不是在通知页', '现在打开的是消息页吗', '当前页是不是通知列表'],
    },
    searchQueryNouns: ['笔记', '图文', '帖子', '图片帖子', '用户', '博主', '作者', '发现', '通知', '关注', '关键词'],
    searchVerbTerms: [...ZH_SEARCH_VERBS, '搜索笔记', '搜笔记', '查找笔记', '搜索图文', '搜图文', '搜小红书', '搜小红书笔记'],
    openVerbTerms: [...ZH_OPEN_VERBS, '打开笔记', '查看笔记', '打开用户主页', '查看用户主页', '打开博主主页', '打开发现页', '进入发现页', '打开登录页', '打开通知页', '打开消息页', '查看关注'],
    buildGeneratedPatternExamples(context, patternType, fallbackValues) {
      if (context.slotName === 'queryText' && isSearchNoteIntent(context.intent.intentType)) {
        return uniqueExamples(fallbackValues.flatMap((valueRecord) => {
          const label = normalizeText(valueRecord.label ?? valueRecord.value, cleanDisplayText);
          if (!label) {
            return [];
          }
          if (patternType !== 'explicit-intent') {
            return [label];
          }
          return [`搜索笔记${label}`, `搜索图文${label}`];
        }));
      }

      if (context.intent.intentType === 'list-followed-users') {
        return uniqueExamples(followedUsersAliases);
      }

      if (context.intent.intentType === 'list-followed-updates') {
        return uniqueExamples(followedUpdatesAliases);
      }

      if (!['targetMemberId', 'noteTitle', 'noteId'].includes(context.slotName)) {
        return null;
      }

      if (isOpenNoteIntent(context.intent.intentType)) {
        return uniqueExamples(fallbackValues.flatMap((valueRecord) => {
          const label = normalizeText(valueRecord.label ?? valueRecord.value, cleanDisplayText);
          if (!label) {
            return [];
          }
          if (patternType !== 'explicit-intent') {
            return [label];
          }
          return [`打开笔记${label}`, `打开图文${label}`];
        }));
      }

      if (isDownloadNoteIntent(context.intent.intentType)) {
        return uniqueExamples(fallbackValues.flatMap((valueRecord) => {
          const label = normalizeText(valueRecord.label ?? valueRecord.value, cleanDisplayText);
          if (!label) {
            return [];
          }
          if (patternType !== 'explicit-intent') {
            return [label];
          }
          return [`下载笔记${label}`, `下载图文${label}`];
        }));
      }

      if (isOpenUserIntent(context.intent.intentType)) {
        return uniqueExamples(fallbackValues.flatMap((valueRecord) => {
          const label = normalizeText(valueRecord.label ?? valueRecord.value, cleanDisplayText);
          if (!label) {
            return [];
          }
          if (patternType !== 'explicit-intent') {
            return [label];
          }
          return [`打开用户主页${label}`, `打开博主主页${label}`];
        }));
      }

      if (context.intent.intentType === 'open-category') {
        const examples = fallbackValues.flatMap((valueRecord) => {
          const label = normalizeText(valueRecord.label ?? valueRecord.value, cleanDisplayText) || '发现页';
          if (patternType !== 'explicit-intent') {
            return [label];
          }
          if (label === '发现' || label === '发现页') {
            return ['打开发现页', '浏览发现页', '进入发现页'];
          }
          return [`打开发现页${label}`, `浏览发现页${label}`];
        });
        return uniqueExamples(examples);
      }

      if (context.intent.intentType === 'open-auth-page') {
        const examples = fallbackValues.flatMap((valueRecord) => {
          const label = normalizeText(valueRecord.label ?? valueRecord.value, cleanDisplayText) || '登录页';
          if (patternType !== 'explicit-intent') {
            return [label];
          }
          if (label.includes('注册')) {
            return ['打开注册页', '进入注册页'];
          }
          return ['打开登录页', '打开登录页但不自动提交凭证'];
        });
        return uniqueExamples(examples);
      }

      if (context.intent.intentType === 'open-utility-page') {
        const examples = fallbackValues.flatMap((valueRecord) => {
          const label = normalizeText(valueRecord.label ?? valueRecord.value, cleanDisplayText) || '通知页';
          if (patternType !== 'explicit-intent') {
            return [label];
          }
          if (isNotificationLikeLabel(label)) {
            return ['打开通知页', '查看消息页'];
          }
          if (isLiveListLikeLabel(label)) {
            return ['打开直播列表', '查看直播列表'];
          }
          return [`打开${label}`];
        });
        return uniqueExamples(examples);
      }

      return null;
    },
    rewriteClarificationRule(cloned) {
      if (cloned.case === 'missing-slot') {
        cloned.response.questionTemplate = '你要搜索哪篇笔记、打开哪个用户主页、查询关注列表、查询关注更新、打开通知页，还是回到发现页？';
      } else if (cloned.case === 'ambiguous-target') {
        cloned.response.questionTemplate = '这个名字可能对应多篇笔记或多个用户。请给我更具体的笔记标题、用户名，或者直接说要进入发现页、通知页、关注列表或关注更新。';
      } else if (cloned.case === 'unsupported-target') {
        cloned.response.questionTemplate = '这个目标可以识别，但当前没有可执行的打开、搜索、下载或关注查询路径。要不要换成已观察到的笔记、用户主页、发现页、通知页、关注列表、关注更新或登录页入口？';
      } else if (cloned.case === 'book-ambiguous') {
        cloned.response.questionTemplate = '这个说法既可能是在指笔记，也可能是在指用户主页。请明确说“打开笔记”“下载笔记”还是“打开用户主页”。';
      } else if (cloned.case === 'search-no-results') {
        cloned.response.questionTemplate = '站内没有命中这条搜索。可以换成更短的关键词、更完整的笔记标题，或者直接搜用户名继续。';
      }
      return cloned;
    },
  };
}
