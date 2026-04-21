// @ts-check

import { uniqueSortedStrings } from '../../shared/normalize.mjs';
import {
  remapSupportedIntent as remapSiteIntent,
  resolveSemanticSiteKey,
  siteTerminology as resolveSemanticTerminology,
} from '../../sites/core/site-semantics.mjs';
import { resolveConfiguredPageTypes } from '../../sites/core/page-types.mjs';
import {
  resolvePrimaryArchetypeFromSiteContext,
  resolveSafeActionKindsFromSiteContext,
} from '../../sites/catalog/context.mjs';

export function siteTerminology(context) {
  return resolveSemanticTerminology(context);
}

export function remapSupportedIntent(intentType, context) {
  return remapSiteIntent(intentType, context);
}

export function resolveSupportedIntents(context) {
  return uniqueSortedStrings(
    (context.intentsDocument?.intents ?? [])
      .map((intent) => intent.intentType ?? intent.intentId)
      .filter(Boolean)
      .map((intentType) => remapSupportedIntent(intentType, context)),
  );
}

export function resolvePrimaryArchetype(context) {
  const resolved = resolvePrimaryArchetypeFromSiteContext(context.siteContext, [
    context.siteProfileDocument?.primaryArchetype,
  ]);
  if (resolved) {
    return resolved;
  }
  const intentTypes = new Set((context.intentsDocument.intents ?? []).map((intent) => intent.intentType));
  if ([...intentTypes].some((intentType) => ['open-category', 'open-book', 'open-work', 'open-author', 'open-actress', 'open-chapter', 'open-utility-page', 'open-auth-page', 'paginate-content', 'search-book', 'search-work'].includes(intentType))) {
    return 'navigation-hub';
  }
  if ([...intentTypes].some((intentType) => ['switch-tab', 'expand-panel', 'open-overlay', 'set-active-member', 'set-expanded', 'set-open'].includes(intentType))) {
    return 'in-page-stateful';
  }
  return 'unknown';
}

export function resolveSafeActions(context) {
  const intentTypes = new Set((context.intentsDocument.intents ?? []).map((intent) => intent.intentType));
  const siteActions = resolveSafeActionKindsFromSiteContext(context.siteContext, []);
  if (siteActions.length) {
    return siteActions.filter((actionId) => {
      if (actionId === 'download-book') {
        return intentTypes.has('download-book');
      }
      if (actionId === 'search-submit') {
        return [...intentTypes].some((intentType) => intentType.startsWith('search-'));
      }
      return true;
    });
  }

  const profileActions = uniqueSortedStrings([...(context.siteProfileDocument?.safeActionKinds ?? [])]);
  if (profileActions.length) {
    return profileActions.filter((actionId) => {
      if (actionId === 'download-book') {
        return intentTypes.has('download-book');
      }
      if (actionId === 'search-submit') {
        return [...intentTypes].some((intentType) => intentType.startsWith('search-'));
      }
      return true;
    });
  }

  const actionableActions = uniqueSortedStrings((context.intentsDocument.intents ?? []).map((intent) => intent.actionId));
  if (actionableActions.length) {
    return actionableActions;
  }

  return uniqueSortedStrings((context.actionsDocument.actions ?? []).map((action) => action.actionId));
}

export function resolveCapabilityFamilies(context) {
  const configuredPageTypes = new Set(resolveConfiguredPageTypes(context.siteProfileDocument));
  const siteKey = resolveSemanticSiteKey(context);
  const mappedIntentTypes = new Set(resolveSupportedIntents(context));
  const intentTypes = new Set(
    (context.intentsDocument?.intents ?? [])
      .map((intent) => intent.intentType ?? intent.intentId)
      .filter(Boolean),
  );
  const capabilityFamilies = new Set(context.capabilityMatrixDocument?.capabilityFamilies ?? []);

  if ([...mappedIntentTypes].some((intentType) => String(intentType).startsWith('search-'))) {
    capabilityFamilies.add('search-content');
  }
  if (['open-book', 'open-work', 'open-video'].some((intentType) => mappedIntentTypes.has(intentType) || intentTypes.has(intentType))) {
    capabilityFamilies.add('navigate-to-content');
  }
  if (['open-author', 'open-actress', 'open-model', 'open-up'].some((intentType) => mappedIntentTypes.has(intentType) || intentTypes.has(intentType))) {
    capabilityFamilies.add('navigate-to-author');
  }
  if (mappedIntentTypes.has('open-category') || mappedIntentTypes.has('list-category-videos') || intentTypes.has('open-category') || intentTypes.has('list-category-videos')) {
    capabilityFamilies.add('navigate-to-category');
  }
  if (mappedIntentTypes.has('open-utility-page') || intentTypes.has('open-utility-page')) {
    capabilityFamilies.add('navigate-to-utility-page');
  }
  if (mappedIntentTypes.has('open-chapter') || intentTypes.has('open-chapter')) {
    capabilityFamilies.add('navigate-to-chapter');
  }
  if (mappedIntentTypes.has('download-book') || intentTypes.has('download-book')) {
    capabilityFamilies.add('download-content');
  }

  if (!configuredPageTypes.has('chapter-page')) {
    capabilityFamilies.delete('navigate-to-chapter');
    if (!['bilibili', 'jable', 'moodyz'].includes(String(siteKey ?? ''))) {
      capabilityFamilies.delete('download-content');
    }
  }
  if (!configuredPageTypes.has('category-page')) {
    capabilityFamilies.delete('navigate-to-category');
  }

  return uniqueSortedStrings([...capabilityFamilies]);
}
