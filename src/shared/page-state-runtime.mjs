// @ts-check

import { createBrowserPageStateRuntime } from './page-state-browser.mjs';
import { createPageStateCore } from './page-state-core.mjs';
import { createPageStateFactsRuntime } from './page-state-facts.mjs';

function createPageStateRuntimeWithFactories({
  createPageStateCore,
  createPageStateFactsRuntime,
  createBrowserPageStateRuntime,
} = /** @type {any} */ ({})) {
  const core = createPageStateCore();
  const factsRuntime = createPageStateFactsRuntime(core);

  function buildStateFingerprint({
    finalUrl = '',
    title = '',
    pageType = 'unknown-page',
    pageFacts = null,
    detailsOpen = /** @type {any[]} */ ([]),
    expandedTrue = /** @type {any[]} */ ([]),
    activeTabs = /** @type {any[]} */ ([]),
    controlledVisible = /** @type {any[]} */ ([]),
    openDialogs = /** @type {any[]} */ ([]),
    openMenus = /** @type {any[]} */ ([]),
    openListboxes = /** @type {any[]} */ ([]),
    openPopovers = /** @type {any[]} */ ([]),
  } = /** @type {any} */ ({})) {
    return {
      finalUrl,
      title,
      pageType,
      pageFacts,
      detailsOpen,
      expandedTrue,
      activeTabs,
      controlledVisible,
      openDialogs,
      openMenus,
      openListboxes,
      openPopovers,
    };
  }

  function computePageStateSignature(input = /** @type {any} */ ({}), siteProfile = null, options = /** @type {any} */ ({})) {
    const finalUrl = core.normalizeUrlNoFragment(input.finalUrl ?? '');
    const title = String(input.title ?? '');
    const pageType = input.pageType
      || core.inferPageTypeFromUrl(finalUrl, siteProfile, options);
    const derivedFacts = factsRuntime.derivePageFacts({
      pageType,
      siteProfile,
      finalUrl,
      title,
      rawHtml: input.rawHtml ?? '',
      queryInputValue: input.queryInputValue ?? '',
      textFromSelectors: input.textFromSelectors ?? (() => null),
      hrefFromSelectors: input.hrefFromSelectors ?? (() => null),
      textsFromSelectors: input.textsFromSelectors ?? (() => []),
      hrefsFromSelectors: input.hrefsFromSelectors ?? (() => []),
      metaContent: input.metaContent ?? (() => null),
      documentText: input.documentText ?? '',
      extractStructuredBilibiliAuthorCards: input.extractStructuredBilibiliAuthorCards ?? null,
    });
    const normalizedEvidence = core.mergePageStateEvidence(
      derivedFacts,
      input.runtimeEvidence ?? null,
      {
        antiCrawlReasonCode: derivedFacts?.antiCrawlReasonCode ?? null,
      },
    );
    const pageFacts = normalizedEvidence.pageFacts;
    return {
      finalUrl,
      title,
      viewportWidth: Number(input.viewportWidth ?? 0) || 0,
      viewportHeight: Number(input.viewportHeight ?? 0) || 0,
      pageType,
      pageFacts,
      runtimeEvidence: normalizedEvidence.runtimeEvidence,
      fingerprint: buildStateFingerprint({
        finalUrl,
        title,
        pageType,
        pageFacts,
        detailsOpen: input.detailsOpen ?? [],
        expandedTrue: input.expandedTrue ?? [],
        activeTabs: input.activeTabs ?? [],
        controlledVisible: input.controlledVisible ?? [],
        openDialogs: input.openDialogs ?? [],
        openMenus: input.openMenus ?? [],
        openListboxes: input.openListboxes ?? [],
        openPopovers: input.openPopovers ?? [],
      }),
    };
  }

  const browserRuntime = createBrowserPageStateRuntime({
    ...core,
    ...factsRuntime,
    computePageStateSignature,
  });

  return {
    CONTENT_DETAIL_PAGE_TYPES: core.CONTENT_DETAIL_PAGE_TYPES,
    deriveRuntimeEvidence: core.deriveRuntimeEvidence,
    mergePageStateEvidence: core.mergePageStateEvidence,
    isContentDetailPageType: core.isContentDetailPageType,
    toSemanticPageType: core.toSemanticPageType,
    resolveConfiguredPageTypes: core.resolveConfiguredPageTypes,
    inferProfilePageTypeFromPathname: core.inferProfilePageTypeFromPathname,
    inferPageTypeFromUrl: core.inferPageTypeFromUrl,
    derivePageFacts: factsRuntime.derivePageFacts,
    computePageStateSignature,
    browserComputePageStateSignature: browserRuntime.browserComputePageStateSignature,
  };
}

export function createPageStateRuntime() {
  return createPageStateRuntimeWithFactories({
    createPageStateCore,
    createPageStateFactsRuntime,
    createBrowserPageStateRuntime,
  });
}

function createPageStateRuntimeBundleSource() {
  return `(() => {
    const createPageStateCore = ${createPageStateCore.toString()};
    const createPageStateFactsRuntime = ${createPageStateFactsRuntime.toString()};
    const createBrowserPageStateRuntime = ${createBrowserPageStateRuntime.toString()};
    const createPageStateRuntimeWithFactories = ${createPageStateRuntimeWithFactories.toString()};
    return createPageStateRuntimeWithFactories({
      createPageStateCore,
      createPageStateFactsRuntime,
      createBrowserPageStateRuntime,
    });
  })()`;
}

const defaultRuntime = createPageStateRuntime();

export const CONTENT_DETAIL_PAGE_TYPES = defaultRuntime.CONTENT_DETAIL_PAGE_TYPES;
export const deriveRuntimeEvidence = defaultRuntime.deriveRuntimeEvidence;
export const mergePageStateEvidence = defaultRuntime.mergePageStateEvidence;
export const isContentDetailPageType = defaultRuntime.isContentDetailPageType;
export const toSemanticPageType = defaultRuntime.toSemanticPageType;
export const resolveConfiguredPageTypes = defaultRuntime.resolveConfiguredPageTypes;
export const inferProfilePageTypeFromPathnameCore = defaultRuntime.inferProfilePageTypeFromPathname;
export const inferPageTypeFromUrlCore = defaultRuntime.inferPageTypeFromUrl;
export const derivePageFacts = defaultRuntime.derivePageFacts;
export const computePageStateSignature = defaultRuntime.computePageStateSignature;

export function createPageStateHelperBundleSource(namespace = '__BWS_PAGE_STATE__') {
  const runtimeSource = createPageStateRuntimeBundleSource();
  return `(() => {
    const root = globalThis;
    const existing = root[${JSON.stringify(namespace)}];
    if (existing && existing.__version === 1) {
      return existing;
    }
    const runtime = ${runtimeSource};
    const api = {
      __version: 1,
      pageComputeStateSignature: runtime.browserComputePageStateSignature,
    };
    root[${JSON.stringify(namespace)}] = api;
    return api;
  })()`;
}

export function createPageStateHelperFallbackFunction(namespace = '__BWS_PAGE_STATE__') {
  const runtimeSource = createPageStateRuntimeBundleSource();
  return new Function('siteProfile', `
    const root = globalThis;
    const namespace = ${JSON.stringify(namespace)};
    const runtimeKey = namespace + '::runtime';
    const helperApi = root[namespace];
    if (helperApi && typeof helperApi.pageComputeStateSignature === 'function') {
      return helperApi.pageComputeStateSignature(siteProfile);
    }
    let runtime = root[runtimeKey];
    if (!runtime || runtime.__version !== 1) {
      runtime = ${runtimeSource};
      runtime.__version = 1;
      root[runtimeKey] = runtime;
    }
    return runtime.browserComputePageStateSignature(siteProfile);
  `);
}
