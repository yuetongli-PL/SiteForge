export function createDouyinNlSemantics(deps) {
  const {
    INTENT_LANGUAGE_LABELS,
    ELEMENT_KIND_LABELS,
    ZH_STATUS_QUERY_EXAMPLES,
    ZH_SEARCH_VERBS,
    ZH_OPEN_VERBS,
  } = deps;

  return {
    siteKey: 'douyin',
    intentLabels: {
      ...INTENT_LANGUAGE_LABELS,
      'search-video': {
        canonical: '搜索视频',
        aliases: ['搜索视频', '搜视频', '查询视频'],
      },
      'open-video': {
        canonical: '打开视频',
        aliases: ['打开视频', '查看视频', '进入视频页'],
      },
      'open-author': {
        canonical: '打开用户主页',
        aliases: ['打开用户主页', '查看用户主页', '打开作者主页'],
      },
      'list-followed-users': {
        canonical: '查询关注用户列表',
        aliases: ['查询关注用户列表', '列出我关注的用户', '查看关注用户列表'],
      },
      'list-followed-updates': {
        canonical: '查询关注更新视频',
        aliases: ['查询关注更新视频', '列出关注更新视频', '查看关注更新'],
      },
    },
    elementLabels: {
      ...ELEMENT_KIND_LABELS,
      'content-link-group': {
        canonical: '视频',
        aliases: ['视频', '作品', '详情'],
      },
      'author-link-group': {
        canonical: '用户',
        aliases: ['用户', '作者', '用户主页'],
      },
    },
    statusExamples: {
      ...ZH_STATUS_QUERY_EXAMPLES,
    },
    searchQueryNouns: ['视频', '用户', '分类', '关注', '观看历史'],
    searchVerbTerms: [...ZH_SEARCH_VERBS, '搜索视频', '查询视频'],
    openVerbTerms: [...ZH_OPEN_VERBS, '打开视频', '打开用户主页'],
  };
}
