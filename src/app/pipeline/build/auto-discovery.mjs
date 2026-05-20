// @ts-check

import { uniqueSortedStrings } from '../../../shared/normalize.mjs';
import {
  isInternalUrl,
  normalizeUrl,
  sha256Short,
} from './models.mjs';

export const AUTO_DISCOVERY_SCHEMA_VERSION = 1;

const SOCIAL_HOSTS = new Set(['x.com', 'twitter.com']);

function compactText(value, fallback = '') {
  return String(value ?? fallback).replace(/\s+/gu, ' ').trim();
}

function normalizedHost(site) {
  try {
    return new URL(site?.rootUrl ?? site?.normalizedUrl ?? 'https://example.invalid/').hostname
      .replace(/^www\./u, '')
      .toLowerCase();
  } catch {
    return '';
  }
}

export function isKnownSocialSpaSite(site, knownSitePolicy = null) {
  const host = normalizedHost(site);
  const siteKey = String(knownSitePolicy?.siteKey ?? knownSitePolicy?.adapterId ?? '').toLowerCase();
  return SOCIAL_HOSTS.has(host)
    || siteKey === 'x';
}

function safeRoutePath(routePath) {
  const text = compactText(routePath, '/');
  if (/^\/[A-Za-z0-9_./:-]*$/u.test(text)) {
    return text;
  }
  return '/';
}

function routeUrl(site, routePath) {
  try {
    return normalizeUrl(new URL(safeRoutePath(routePath), site.rootUrl).toString(), site.rootUrl);
  } catch {
    return normalizeUrl(site.rootUrl);
  }
}

function summaryHash(value) {
  return sha256Short(JSON.stringify(value), 16);
}

function stateKeyFor(pageType, routeTemplate, tabState = 'default') {
  return `${pageType}:${routeTemplate}:${tabState}`
    .toLowerCase()
    .replace(/[^a-z0-9:]+/gu, '-')
    .replace(/-+/gu, '-')
    .replace(/^-+|-+$/gu, '');
}

function labelSummary(controlType, pageType, tabState = '') {
  return [pageType, tabState, controlType].filter(Boolean).join(' ');
}

function control(controlType, pageType, tabState, index, {
  kind = 'button',
  role = null,
  safety = 'safe',
  label = null,
  selector = null,
  type = null,
} = {}) {
  const labelText = label ?? labelSummary(controlType, pageType, tabState);
  return {
    kind,
    type,
    label: labelText,
    labelSummary: labelText,
    labelHash: summaryHash(labelText),
    selector: selector ?? `[data-siteforge-auto="${pageType}-${tabState || 'default'}-${controlType}-${index}"]`,
    safety,
    controlType,
    attrs: {
      ...(role ? { role } : {}),
      'data-siteforge-auto': controlType,
    },
    evidenceStatus: 'modeled_structure',
    riskLevel: safety === 'safe' ? 'low' : 'medium',
  };
}

function controlsForPage(page) {
  const controls = [];
  let index = 0;
  const add = (controlType, options = {}) => {
    index += 1;
    controls.push(control(controlType, page.pageType, page.tabState, index, options));
  };

  for (const nav of ['home', 'explore', 'notifications', 'messages', 'bookmarks', 'lists', 'profile', 'settings']) {
    add(`nav-${nav}`, { kind: 'link', role: 'link', label: `navigation ${nav}` });
  }
  add('searchbox', { kind: 'input', role: 'searchbox', type: 'search', safety: 'requires_input', label: 'search box' });
  add('overflow-menu', { kind: 'button', role: 'menuitem', label: 'overflow menu' });

  for (const tab of page.tabs ?? []) {
    add(`tab-${tab}`, { kind: 'button', role: 'tab', label: `${page.pageType} tab ${tab}` });
  }

  if (page.pageType === 'settings') {
    add('settings-select', { kind: 'select', role: 'combobox', label: 'settings option selector', safety: 'requires_input' });
  }
  if (page.hasModal) {
    add('open-modal', { kind: 'button', role: 'button', label: `${page.pageType} modal trigger` });
    add('close-modal', { kind: 'button', role: 'button', label: `${page.pageType} modal close` });
  }
  if (page.hasDrawer) {
    add('open-drawer', { kind: 'button', role: 'button', label: `${page.pageType} drawer trigger` });
  }
  return controls;
}

function structureItemsForPage(page) {
  const items = [{
    structureType: 'scroll_list',
    nodeType: 'content',
    labelSummary: `${page.pageType} scroll list`,
    listPresent: page.listPresent,
    visibleItemCount: page.visibleItemCount,
    riskLevel: 'low',
  }];
  for (const itemType of page.itemTypes ?? []) {
    items.push({
      structureType: itemType,
      nodeType: 'content',
      labelSummary: `${page.pageType} ${itemType}`,
      listPresent: true,
      visibleItemCount: page.visibleItemCount,
      riskLevel: page.pageType === 'messages' ? 'medium' : 'low',
    });
  }
  items.push({
    structureType: 'operation_bar',
    nodeType: 'operation',
    labelSummary: `${page.pageType} read-only operation controls`,
    listPresent: false,
    visibleItemCount: Math.min(6, Math.max(1, page.controlsCount ?? 1)),
    riskLevel: page.pageType === 'settings' || page.pageType === 'messages' ? 'medium' : 'low',
  });
  if (page.hasModal) {
    items.push({
      structureType: 'modal',
      nodeType: 'modal',
      labelSummary: `${page.pageType} modal surface`,
      listPresent: false,
      visibleItemCount: 1,
      riskLevel: 'medium',
    });
  }
  if (page.hasDrawer) {
    items.push({
      structureType: 'drawer',
      nodeType: 'modal',
      labelSummary: `${page.pageType} drawer surface`,
      listPresent: false,
      visibleItemCount: 1,
      riskLevel: 'medium',
    });
  }
  return items.map((item, index) => ({
    ...item,
    id: `${page.stateKey}:structure:${index + 1}`,
    structureHash: summaryHash({
      pageType: page.pageType,
      routeTemplate: page.routeTemplate,
      tabState: page.tabState,
      structureType: item.structureType,
    }),
    evidenceStatus: page.evidenceStatus,
  }));
}

function pageState(input) {
  const routePath = input.routePath ?? input.routeTemplate;
  const stateKey = stateKeyFor(input.pageType, input.routeTemplate, input.tabState);
  const base = {
    pageType: input.pageType,
    routeTemplate: input.routeTemplate,
    routePath,
    tabState: input.tabState ?? 'default',
    tabs: input.tabs ?? [],
    itemTypes: input.itemTypes ?? [],
    listPresent: input.listPresent !== false,
    visibleItemCount: Math.max(0, Number(input.visibleItemCount ?? 0) || 0),
    riskLevel: input.riskLevel ?? 'low',
    evidenceStatus: input.evidenceStatus ?? 'modeled_structure',
    hasModal: input.hasModal === true,
    hasDrawer: input.hasDrawer === true,
    stateKey,
  };
  const controls = controlsForPage(base);
  const structureItems = structureItemsForPage({
    ...base,
    controlsCount: controls.length,
  });
  return {
    ...base,
    controls,
    structureItems,
    controlCount: controls.length,
    structureHash: summaryHash({
      pageType: base.pageType,
      routeTemplate: base.routeTemplate,
      tabState: base.tabState,
      controls: controls.map((item) => item.controlType),
      structures: structureItems.map((item) => item.structureType),
    }),
  };
}

function defaultSocialSpaStates({ deep = false } = {}) {
  const states = [
    pageState({
      pageType: 'home',
      routeTemplate: '/home',
      tabState: 'for_you',
      tabs: ['for_you', 'following'],
      itemTypes: ['post_card', 'profile_card'],
      visibleItemCount: 5,
    }),
    pageState({
      pageType: 'home',
      routeTemplate: '/home',
      tabState: 'following',
      tabs: ['for_you', 'following'],
      itemTypes: ['post_card', 'profile_card'],
      visibleItemCount: 5,
    }),
    pageState({
      pageType: 'explore',
      routeTemplate: '/explore',
      tabState: 'discover',
      tabs: ['for_you', 'trending', 'news', 'sports', 'entertainment'],
      itemTypes: ['post_card', 'topic_card'],
      visibleItemCount: 6,
    }),
    pageState({
      pageType: 'search',
      routeTemplate: '/search',
      tabState: 'top',
      tabs: ['top', 'latest', 'people', 'media', 'lists'],
      itemTypes: ['post_card', 'profile_card'],
      visibleItemCount: 5,
    }),
    pageState({
      pageType: 'search',
      routeTemplate: '/search',
      tabState: 'latest',
      tabs: ['top', 'latest', 'people', 'media', 'lists'],
      itemTypes: ['post_card'],
      visibleItemCount: 5,
    }),
    pageState({
      pageType: 'search',
      routeTemplate: '/search',
      tabState: 'people',
      tabs: ['top', 'latest', 'people', 'media', 'lists'],
      itemTypes: ['profile_card'],
      visibleItemCount: 5,
    }),
    pageState({
      pageType: 'search',
      routeTemplate: '/search',
      tabState: 'media',
      tabs: ['top', 'latest', 'people', 'media', 'lists'],
      itemTypes: ['media_item', 'post_card'],
      visibleItemCount: 6,
      hasModal: true,
    }),
    pageState({
      pageType: 'notifications',
      routeTemplate: '/notifications',
      tabState: 'all',
      tabs: ['all', 'verified', 'mentions'],
      itemTypes: ['notification_item', 'profile_card'],
      visibleItemCount: 6,
    }),
    pageState({
      pageType: 'notifications',
      routeTemplate: '/notifications/verified',
      tabState: 'verified',
      tabs: ['all', 'verified', 'mentions'],
      itemTypes: ['notification_item'],
      visibleItemCount: 4,
    }),
    pageState({
      pageType: 'notifications',
      routeTemplate: '/notifications/mentions',
      tabState: 'mentions',
      tabs: ['all', 'verified', 'mentions'],
      itemTypes: ['notification_item'],
      visibleItemCount: 4,
    }),
    pageState({
      pageType: 'messages',
      routeTemplate: '/messages',
      tabState: 'inbox',
      itemTypes: ['conversation_row'],
      visibleItemCount: 5,
      riskLevel: 'medium',
      hasModal: true,
    }),
    pageState({
      pageType: 'bookmarks',
      routeTemplate: '/i/bookmarks',
      tabState: 'saved',
      itemTypes: ['bookmark_item', 'post_card'],
      visibleItemCount: 5,
    }),
    pageState({
      pageType: 'lists',
      routeTemplate: '/i/lists',
      tabState: 'index',
      itemTypes: ['list_item', 'profile_card'],
      visibleItemCount: 4,
    }),
    pageState({
      pageType: 'profile',
      routeTemplate: '/:handle',
      routePath: '/_siteforge_profile',
      tabState: 'posts',
      tabs: ['posts', 'replies', 'media'],
      itemTypes: ['post_card', 'profile_card'],
      visibleItemCount: 5,
    }),
    pageState({
      pageType: 'profile',
      routeTemplate: '/:handle/with_replies',
      routePath: '/_siteforge_profile/with_replies',
      tabState: 'replies',
      tabs: ['posts', 'replies', 'media'],
      itemTypes: ['post_card'],
      visibleItemCount: 4,
    }),
    pageState({
      pageType: 'profile',
      routeTemplate: '/:handle/media',
      routePath: '/_siteforge_profile/media',
      tabState: 'media',
      tabs: ['posts', 'replies', 'media'],
      itemTypes: ['post_card', 'media_item'],
      visibleItemCount: 6,
    }),
    pageState({
      pageType: 'post_detail',
      routeTemplate: '/:handle/status/:postId',
      routePath: '/_siteforge_profile/status/0',
      tabState: 'detail',
      itemTypes: ['post_card', 'profile_card'],
      visibleItemCount: 3,
      hasModal: true,
    }),
    pageState({
      pageType: 'author',
      routeTemplate: '/:handle',
      routePath: '/_siteforge_author',
      tabState: 'profile',
      tabs: ['posts', 'replies', 'media'],
      itemTypes: ['profile_card', 'post_card'],
      visibleItemCount: 5,
    }),
    pageState({
      pageType: 'topic',
      routeTemplate: '/hashtag/:tag',
      routePath: '/hashtag/_siteforge_topic',
      tabState: 'topic',
      itemTypes: ['post_card', 'topic_card'],
      visibleItemCount: 5,
    }),
    pageState({
      pageType: 'media',
      routeTemplate: '/:handle/status/:postId/photo/:mediaIndex',
      routePath: '/_siteforge_profile/status/0/photo/1',
      tabState: 'viewer',
      itemTypes: ['media_item', 'post_card'],
      visibleItemCount: 2,
      hasModal: true,
    }),
    pageState({
      pageType: 'settings',
      routeTemplate: '/settings',
      tabState: 'entry',
      itemTypes: ['settings_item'],
      visibleItemCount: 4,
      riskLevel: 'medium',
      hasDrawer: true,
    }),
  ];

  if (!deep) {
    return states;
  }

  return [
    ...states,
    pageState({
      pageType: 'lists',
      routeTemplate: '/i/lists/:listId',
      routePath: '/i/lists/0',
      tabState: 'list_detail',
      itemTypes: ['list_item', 'post_card', 'profile_card'],
      visibleItemCount: 6,
    }),
  ];
}

function mergeSeedRoutes(states, seeds = []) {
  const byRoute = new Map(states.map((state) => [`${state.routeTemplate}:${state.tabState}`, state]));
  for (const seed of Array.isArray(seeds) ? seeds : []) {
    const urlValue = seed?.normalizedUrl ?? seed?.url;
    if (!urlValue) {
      continue;
    }
    let parsed;
    try {
      parsed = new URL(urlValue);
    } catch {
      continue;
    }
    const routeTemplate = parsed.pathname === '/' ? '/home' : parsed.pathname.replace(/\/$/u, '') || '/home';
    const tabState = seed?.routeKind ?? 'default';
    const key = `${routeTemplate}:${tabState}`;
    if (byRoute.has(key)) {
      continue;
    }
    byRoute.set(key, pageState({
      pageType: 'route',
      routeTemplate,
      tabState,
      itemTypes: ['post_card'],
      visibleItemCount: 0,
      evidenceStatus: 'route_seed_only',
    }));
  }
  return [...byRoute.values()];
}

function networkSummary({ network = false } = {}) {
  return {
    status: network ? 'redacted_summary_allowed' : 'not_enabled',
    allowedFields: network
      ? ['method_family', 'path_template', 'resource_type', 'status_class', 'initiator_type', 'count']
      : [],
    rawRequestMaterialPersisted: false,
    rawSecretMaterialPersisted: false,
    identityValuesPersisted: false,
    bodyValuesPersisted: false,
  };
}

export function createSocialSpaAutoDiscoverySummary({
  site,
  knownSitePolicy = null,
  evidence = {},
  options = {},
} = {}) {
  if (!site?.rootUrl || !isKnownSocialSpaSite(site, knownSitePolicy)) {
    return null;
  }
  const deep = options.deep === true || options.autoDiscoveryDeep === true;
  const rendered = deep || options.renderJs === true || options.autoDiscoveryRendered === true;
  const network = options.network === true || options.captureNetwork === true || options.autoDiscoveryNetwork === true;
  const states = mergeSeedRoutes(defaultSocialSpaStates({ deep }), evidence?.browserSeeds);
  const pages = [];
  for (const state of states) {
    const normalizedUrl = routeUrl(site, state.routePath);
    if (!isInternalUrl(normalizedUrl, site.allowedDomains ?? [new URL(site.rootUrl).hostname])) {
      continue;
    }
    pages.push({
      url: normalizedUrl,
      normalizedUrl,
      title: `${normalizedHost(site)} ${state.pageType} ${state.tabState}`,
      textSummary: `${state.pageType} ${state.routeTemplate} ${state.tabState} modeled SPA structure; raw content was not persisted.`,
      source: 'auto_discovery',
      pageType: state.pageType,
      routeTemplate: state.routeTemplate,
      routePath: state.routePath,
      tabState: state.tabState,
      stateKey: state.stateKey,
      visibleItemCount: state.visibleItemCount,
      listPresent: state.listPresent,
      structureHash: state.structureHash,
      evidenceStatus: state.evidenceStatus,
      riskLevel: state.riskLevel,
      controls: state.controls,
      structureItems: state.structureItems,
      rawMaterialPersisted: false,
    });
  }
  const controls = pages.flatMap((page) => page.controls ?? []);
  const structureItems = pages.flatMap((page) => page.structureItems ?? []);
  const routeTemplates = uniqueSortedStrings(pages.map((page) => page.routeTemplate).filter(Boolean));
  const tabStates = uniqueSortedStrings(pages.map((page) => `${page.routeTemplate}:${page.tabState}`).filter(Boolean));
  const summary = {
    nodes_total: pages.length + routeTemplates.length + structureItems.length,
    page_nodes: pages.length,
    content_nodes: structureItems.filter((item) => item.nodeType === 'content').length,
    operation_nodes: structureItems.filter((item) => item.nodeType === 'operation').length,
    modal_nodes: structureItems.filter((item) => item.nodeType === 'modal').length,
    route_templates: routeTemplates.length,
    actionable_elements: controls.length,
    visible_item_count: pages.reduce((sum, page) => sum + Math.max(0, Number(page.visibleItemCount ?? 0) || 0), 0),
    lists_present: pages.filter((page) => page.listPresent === true).length,
    evidenceStatus: 'modeled_structure',
    riskLevel: pages.some((page) => page.riskLevel === 'medium') ? 'medium' : 'low',
  };
  return {
    schemaVersion: AUTO_DISCOVERY_SCHEMA_VERSION,
    artifactFamily: 'siteforge-auto-discovery-summary',
    status: 'modeled',
    mode: deep ? 'deep' : 'default',
    source: 'known-social-spa-route-state-model',
    siteKey: knownSitePolicy?.siteKey ?? knownSitePolicy?.adapterId ?? normalizedHost(site),
    host: normalizedHost(site),
    dynamicEnabled: rendered,
    networkEnabled: network,
    pages,
    routeTemplates,
    tabStates,
    controlTypes: uniqueSortedStrings(controls.map((item) => item.controlType).filter(Boolean)),
    structureTypes: uniqueSortedStrings(structureItems.map((item) => item.structureType).filter(Boolean)),
    network: networkSummary({ network }),
    summary,
    safetyBoundary: 'Auto-discovery stores route, state, count, control, and structure summaries only; unredacted page structure, request material, account identifiers, and secret material are not persisted.',
  };
}

export function mergeAutoDiscoveryPages(rawPages = [], autoDiscovery = null) {
  const merged = new Map();
  for (const page of Array.isArray(rawPages) ? rawPages : []) {
    const key = page?.stateKey
      ? `${page.normalizedUrl ?? page.url ?? ''}#${page.stateKey}`
      : `${page?.normalizedUrl ?? page?.url ?? ''}`;
    if (key.trim()) {
      merged.set(key, page);
    }
  }
  for (const page of autoDiscovery?.pages ?? []) {
    const key = page.stateKey
      ? `${page.normalizedUrl ?? page.url ?? ''}#${page.stateKey}`
      : `${page.normalizedUrl ?? page.url ?? ''}`;
    if (!merged.has(key)) {
      merged.set(key, page);
    }
  }
  return [...merged.values()];
}

export function summarizeAutoDiscoveryFromGraph(graph = {}, affordances = [], capabilities = []) {
  const nodes = graph?.nodes ?? [];
  const autoSummary = graph?.autoDiscoverySummary ?? null;
  if (autoSummary) {
    return {
      page_nodes: Number(autoSummary.page_nodes ?? 0) || 0,
      content_nodes: Number(autoSummary.content_nodes ?? 0) || 0,
      operation_nodes: Number(autoSummary.operation_nodes ?? 0) || 0,
      modal_nodes: Number(autoSummary.modal_nodes ?? 0) || 0,
      route_templates: Number(autoSummary.route_templates ?? 0) || 0,
      actionable_elements: Number(autoSummary.actionable_elements ?? 0) || affordances.length,
      read_only_capabilities: capabilities.filter((capability) => /^read_/u.test(String(capability.risk_level ?? ''))).length,
      limited_enabled_capabilities: capabilities.filter((capability) => capability.enabled_status === 'limited_enabled').length,
      confirmation_required_capabilities: capabilities.filter((capability) => (
        capability.enabled_status === 'confirmation_required'
        || capability.enabled_status === 'draft_only'
      )).length,
      disabled_high_risk_capabilities: capabilities.filter((capability) => (
        capability.enabled_status === 'disabled'
        && ['write_high', 'account_security_critical'].includes(capability.risk_level)
      )).length,
    };
  }
  const pageNodes = nodes.filter((node) => node.type === 'page');
  const routeTemplates = new Set(nodes.map((node) => node.routePattern).filter(Boolean));
  const contentNodes = nodes.filter((node) => ['page', 'entity', 'route'].includes(node.type));
  const operationNodes = nodes.filter((node) => ['component', 'form', 'tab', 'menu', 'pagination', 'workflow'].includes(node.type));
  const modalNodes = nodes.filter((node) => node.type === 'modal' || node.classification === 'modal');
  return {
    page_nodes: pageNodes.length,
    content_nodes: contentNodes.length,
    operation_nodes: operationNodes.length,
    modal_nodes: modalNodes.length,
    route_templates: routeTemplates.size,
    actionable_elements: affordances.length,
    read_only_capabilities: capabilities.filter((capability) => /^read_/u.test(String(capability.risk_level ?? ''))).length,
    limited_enabled_capabilities: capabilities.filter((capability) => capability.enabled_status === 'limited_enabled').length,
    confirmation_required_capabilities: capabilities.filter((capability) => (
      capability.enabled_status === 'confirmation_required'
      || capability.enabled_status === 'draft_only'
    )).length,
    disabled_high_risk_capabilities: capabilities.filter((capability) => (
      capability.enabled_status === 'disabled'
      && ['write_high', 'account_security_critical'].includes(capability.risk_level)
    )).length,
  };
}
