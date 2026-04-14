// @ts-check

function nonEmptyString(extra = {}) {
  return {
    type: 'string',
    minLength: 1,
    ...extra,
  };
}

function integer(min = 0, extra = {}) {
  return {
    type: 'integer',
    min,
    ...extra,
  };
}

function stringArray(options = {}) {
  const { minItems = 0 } = options;
  return {
    type: 'array',
    minItems,
    items: nonEmptyString(),
  };
}

const absoluteHttpUrl = nonEmptyString({
  validate(value) {
    try {
      const parsed = new URL(value);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        return null;
      }
    } catch {
      return 'must be a valid absolute http(s) URL';
    }
    return 'must be a valid absolute http(s) URL';
  },
});

const knownQuerySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['query', 'title', 'url', 'authorName'],
  properties: {
    query: nonEmptyString(),
    title: nonEmptyString(),
    url: absoluteHttpUrl,
    authorName: nonEmptyString(),
  },
};

const searchSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'formSelectors',
    'inputSelectors',
    'submitSelectors',
    'resultTitleSelectors',
    'resultBookSelectors',
    'knownQueries',
  ],
  properties: {
    formSelectors: stringArray({ minItems: 1 }),
    inputSelectors: stringArray({ minItems: 1 }),
    submitSelectors: stringArray({ minItems: 1 }),
    resultTitleSelectors: stringArray({ minItems: 1 }),
    resultBookSelectors: stringArray({ minItems: 1 }),
    queryParamNames: stringArray({ minItems: 1 }),
    defaultQueries: stringArray({ minItems: 1 }),
    knownQueries: {
      type: 'array',
      minItems: 0,
      items: knownQuerySchema,
    },
  },
};

const pageTypesSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'homeExact',
    'homePrefixes',
    'searchResultsPrefixes',
    'contentDetailPrefixes',
    'authorPrefixes',
    'chapterPrefixes',
    'historyPrefixes',
    'authPrefixes',
    'categoryPrefixes',
  ],
  properties: {
    homeExact: stringArray(),
    homePrefixes: stringArray(),
    searchResultsPrefixes: stringArray(),
    contentDetailPrefixes: stringArray(),
    authorPrefixes: stringArray(),
    chapterPrefixes: stringArray(),
    historyPrefixes: stringArray(),
    authPrefixes: stringArray(),
    categoryPrefixes: stringArray(),
  },
};

const twentyTwoBiquSchema = {
  id: 'profile/www.22biqu.com/v1',
  type: 'object',
  additionalProperties: false,
  required: ['host', 'version', 'search', 'bookDetail', 'chapter'],
  properties: {
    host: nonEmptyString({ const: 'www.22biqu.com' }),
    version: integer(1),
    search: searchSchema,
    bookDetail: {
      type: 'object',
      additionalProperties: false,
      required: [
        'authorMetaNames',
        'authorLinkMetaNames',
        'latestChapterNameMetaNames',
        'latestChapterMetaNames',
        'updateTimeMetaNames',
        'chapterLinkSelectors',
        'directoryLinkSelectors',
        'directoryPageUrlTemplate',
        'directoryPageStart',
        'directoryPageMax',
        'directoryMinimumExpected',
      ],
      properties: {
        authorMetaNames: stringArray({ minItems: 1 }),
        authorLinkMetaNames: stringArray({ minItems: 1 }),
        latestChapterNameMetaNames: stringArray({ minItems: 1 }),
        latestChapterMetaNames: stringArray({ minItems: 1 }),
        updateTimeMetaNames: stringArray({ minItems: 1 }),
        chapterLinkSelectors: stringArray({ minItems: 1 }),
        directoryLinkSelectors: stringArray({ minItems: 1 }),
        directoryPageUrlTemplate: nonEmptyString({
          validate(value) {
            const missing = ['{detail_url}', '{page}'].filter((token) => !value.includes(token));
            return missing.length ? `must include placeholders: ${missing.join(', ')}` : null;
          },
        }),
        directoryPageStart: integer(1),
        directoryPageMax: integer(1),
        directoryMinimumExpected: integer(1),
      },
      validate(value) {
        if (value.directoryPageMax < value.directoryPageStart) {
          return 'directoryPageMax must be greater than or equal to directoryPageStart';
        }
        return null;
      },
    },
    chapter: {
      type: 'object',
      additionalProperties: false,
      required: [
        'contentSelectors',
        'titleSelectors',
        'prevSelector',
        'nextSelector',
        'cleanupPatterns',
      ],
      properties: {
        contentSelectors: stringArray({ minItems: 1 }),
        titleSelectors: stringArray({ minItems: 1 }),
        prevSelector: nonEmptyString(),
        nextSelector: nonEmptyString(),
        cleanupPatterns: stringArray({ minItems: 1 }),
      },
    },
  },
};

const moodyzSchema = {
  id: 'profile/moodyz.com/v1',
  type: 'object',
  additionalProperties: false,
  required: [
    'host',
    'version',
    'pageTypes',
    'search',
    'sampling',
    'navigation',
    'contentDetail',
    'author',
  ],
  properties: {
    host: nonEmptyString({ const: 'moodyz.com' }),
    version: integer(1),
    pageTypes: pageTypesSchema,
    search: searchSchema,
    sampling: {
      type: 'object',
      additionalProperties: false,
      required: [
        'searchResultContentLimit',
        'authorContentLimit',
        'categoryContentLimit',
        'fallbackContentLimitWithSearch',
      ],
      properties: {
        searchResultContentLimit: integer(1),
        authorContentLimit: integer(1),
        categoryContentLimit: integer(1),
        fallbackContentLimitWithSearch: integer(1),
      },
    },
    navigation: {
      type: 'object',
      additionalProperties: false,
      required: [
        'allowedHosts',
        'contentPathPrefixes',
        'authorPathPrefixes',
        'categoryPathPrefixes',
        'utilityPathPrefixes',
        'authPathPrefixes',
        'categoryLabelKeywords',
      ],
      properties: {
        allowedHosts: stringArray({ minItems: 1 }),
        contentPathPrefixes: stringArray({ minItems: 1 }),
        authorPathPrefixes: stringArray({ minItems: 1 }),
        categoryPathPrefixes: stringArray({ minItems: 1 }),
        utilityPathPrefixes: stringArray({ minItems: 1 }),
        authPathPrefixes: stringArray(),
        categoryLabelKeywords: stringArray({ minItems: 1 }),
      },
    },
    contentDetail: {
      type: 'object',
      additionalProperties: false,
      required: ['titleSelectors', 'authorNameSelectors', 'authorLinkSelectors'],
      properties: {
        titleSelectors: stringArray({ minItems: 1 }),
        authorNameSelectors: stringArray({ minItems: 1 }),
        authorLinkSelectors: stringArray({ minItems: 1 }),
      },
    },
    author: {
      type: 'object',
      additionalProperties: false,
      required: ['titleSelectors', 'workLinkSelectors'],
      properties: {
        titleSelectors: stringArray({ minItems: 1 }),
        workLinkSelectors: stringArray({ minItems: 1 }),
      },
    },
  },
};

export const PROFILE_SCHEMAS = Object.freeze({
  'www.22biqu.com': twentyTwoBiquSchema,
  'moodyz.com': moodyzSchema,
});

export function resolveProfileSchema(host) {
  return PROFILE_SCHEMAS[host] ?? null;
}
