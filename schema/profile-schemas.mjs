// @ts-check

import {
  PROFILE_ARCHETYPES,
  resolveLegacyProfileArchetype,
  resolveProfileArchetype,
} from '../src/sites/core/archetypes.mjs';

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

function integerConst(value) {
  return integer(value, {
    validate(input) {
      return input === value ? null : `must equal ${value}`;
    },
  });
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

const validationSamplesSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    videoSearchQuery: nonEmptyString(),
    videoDetailUrl: absoluteHttpUrl,
    authorUrl: absoluteHttpUrl,
    authorVideosUrl: absoluteHttpUrl,
    authorDynamicUrl: absoluteHttpUrl,
    collectionUrl: absoluteHttpUrl,
    channelUrl: absoluteHttpUrl,
    categoryPopularUrl: absoluteHttpUrl,
    categoryAnimeUrl: absoluteHttpUrl,
    bangumiDetailUrl: absoluteHttpUrl,
  },
};

const authValidationSamplesSchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    dynamicUrl: absoluteHttpUrl,
    followListUrl: absoluteHttpUrl,
    fansListUrl: absoluteHttpUrl,
    favoriteListUrl: absoluteHttpUrl,
    watchLaterUrl: absoluteHttpUrl,
    selfPostsUrl: absoluteHttpUrl,
    likesUrl: absoluteHttpUrl,
    collectionsUrl: absoluteHttpUrl,
    historyUrl: absoluteHttpUrl,
    followFeedUrl: absoluteHttpUrl,
    followUsersUrl: absoluteHttpUrl,
  },
  validate(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return 'must be an object';
    }
    const errors = [];
    for (const [key, sampleUrl] of Object.entries(value)) {
      const result = absoluteHttpUrl.validate(sampleUrl);
      if (result) {
        errors.push(`${key}: ${result}`);
      }
    }
    return errors;
  },
};

const authSessionSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['loginUrl', 'postLoginUrl'],
  properties: {
    loginUrl: absoluteHttpUrl,
    postLoginUrl: absoluteHttpUrl,
    verificationUrl: absoluteHttpUrl,
    keepaliveUrl: absoluteHttpUrl,
    keepaliveIntervalMinutes: integer(1),
    cooldownMinutesAfterRisk: integer(1),
    preferVisibleBrowserForAuthenticatedFlows: { type: 'boolean' },
    requireStableNetworkForAuthenticatedFlows: { type: 'boolean' },
    reuseLoginStateByDefault: { type: 'boolean' },
    autoLoginByDefault: { type: 'boolean' },
    credentialTarget: nonEmptyString(),
    usernameEnv: nonEmptyString(),
    passwordEnv: nonEmptyString(),
    loginIndicatorSelectors: stringArray({ minItems: 1 }),
    loginEntrySelectors: stringArray({ minItems: 1 }),
    loggedOutIndicatorSelectors: stringArray({ minItems: 1 }),
    passwordLoginTabSelectors: stringArray({ minItems: 1 }),
    usernameSelectors: stringArray({ minItems: 1 }),
    passwordSelectors: stringArray({ minItems: 1 }),
    submitSelectors: stringArray({ minItems: 1 }),
    challengeSelectors: stringArray({ minItems: 1 }),
    validationSamplePriority: stringArray({ minItems: 1 }),
    reusableSessionSignals: stringArray({ minItems: 1 }),
    authRequiredAuthorSubpages: stringArray({ minItems: 1 }),
    authRequiredPathPrefixes: stringArray({ minItems: 1 }),
  },
};

const downloaderSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    defaultOutputRoot: nonEmptyString(),
    requiresLoginForHighestQuality: { type: 'boolean' },
    authorVideoListPathPrefixes: stringArray({ minItems: 1 }),
    favoriteListPathPrefixes: stringArray({ minItems: 1 }),
    watchLaterPathPrefixes: stringArray({ minItems: 1 }),
    collectionPathPrefixes: stringArray({ minItems: 1 }),
    channelPathPrefixes: stringArray({ minItems: 1 }),
    maxBatchItems: integer(1),
    playlistPageSize: integer(1),
    defaultContainer: nonEmptyString(),
    defaultNamingStrategy: nonEmptyString(),
    qualityPolicy: {
      type: 'object',
      additionalProperties: false,
      properties: {
        targetHeight: integer(144),
        targetCodec: nonEmptyString(),
        defaultContainer: nonEmptyString(),
        fallbackPolicy: nonEmptyString(),
      },
    },
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
    defaultQueries: stringArray(),
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
    'authorListExact',
    'authorListPrefixes',
    'authorDetailPrefixes',
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
    authorListExact: stringArray(),
    authorListPrefixes: stringArray(),
    authorDetailPrefixes: stringArray(),
    chapterPrefixes: stringArray(),
    historyPrefixes: stringArray(),
    authPrefixes: stringArray(),
    categoryPrefixes: stringArray(),
  },
};

function baseProfileProperties(archetype) {
  return {
    host: nonEmptyString(),
    version: integer(1),
    archetype: nonEmptyString({ const: archetype }),
    schemaVersion: integerConst(1),
    primaryArchetype: nonEmptyString(),
  };
}

const navigationCatalogSchema = {
  id: 'profile/navigation-catalog/v1',
  type: 'object',
  additionalProperties: false,
  required: [
    'host',
    'version',
    'archetype',
    'schemaVersion',
    'pageTypes',
    'search',
    'sampling',
    'navigation',
    'contentDetail',
    'author',
  ],
  properties: {
    ...baseProfileProperties(PROFILE_ARCHETYPES.NAVIGATION_CATALOG),
    pageTypes: pageTypesSchema,
    search: searchSchema,
    validationSamples: validationSamplesSchema,
    authValidationSamples: authValidationSamplesSchema,
    authSession: authSessionSchema,
    downloader: downloaderSchema,
    pipeline: {
      type: 'object',
      additionalProperties: false,
      properties: {
        skipBookContent: { type: 'boolean' },
      },
    },
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
        'authorListPathPrefixes',
        'authorDetailPathPrefixes',
        'categoryPathPrefixes',
        'utilityPathPrefixes',
        'authPathPrefixes',
        'categoryLabelKeywords',
      ],
      properties: {
        allowedHosts: stringArray({ minItems: 1 }),
        contentPathPrefixes: stringArray({ minItems: 1 }),
        authorPathPrefixes: stringArray({ minItems: 1 }),
        authorListPathPrefixes: stringArray(),
        authorDetailPathPrefixes: stringArray(),
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

const chapterContentSchema = {
  id: 'profile/chapter-content/v1',
  type: 'object',
  additionalProperties: false,
  required: ['host', 'version', 'archetype', 'schemaVersion', 'search', 'bookDetail', 'chapter'],
  properties: {
    ...baseProfileProperties(PROFILE_ARCHETYPES.CHAPTER_CONTENT),
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

export const PROFILE_SCHEMAS = Object.freeze({
  [PROFILE_ARCHETYPES.NAVIGATION_CATALOG]: navigationCatalogSchema,
  [PROFILE_ARCHETYPES.CHAPTER_CONTENT]: chapterContentSchema,
});

export function resolveProfileSchema(input) {
  const archetype = resolveProfileArchetype(input) ?? resolveLegacyProfileArchetype(input);
  return archetype ? (PROFILE_SCHEMAS[archetype] ?? null) : null;
}
