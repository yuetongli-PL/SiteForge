// @ts-check

import path from 'node:path';
import { uniqueSortedStrings } from '../../shared/normalize.mjs';

export function buildIntentLookup(context) {
  return new Map((context.intentsDocument.intents ?? []).map((intent) => [intent.intentId, intent]));
}

export function buildDecisionRulesByIntent(context) {
  const map = new Map();
  for (const rule of context.decisionTableDocument.rules ?? []) {
    const list = map.get(rule.intentId) ?? [];
    list.push(rule);
    map.set(rule.intentId, list);
  }
  for (const list of map.values()) {
    list.sort((left, right) => String(left.ruleId).localeCompare(String(right.ruleId), 'en'));
  }
  return map;
}

export function buildEntryRulesByIntent(context) {
  const map = new Map();
  for (const rule of context.entryRulesDocument.rules ?? []) {
    const list = map.get(rule.intentId) ?? [];
    list.push(rule);
    map.set(rule.intentId, list);
  }
  for (const list of map.values()) {
    list.sort((left, right) => (left.priority ?? 0) - (right.priority ?? 0) || String(left.entryRuleId).localeCompare(String(right.entryRuleId), 'en'));
  }
  return map;
}

export function buildPatternsByIntent(context) {
  const map = new Map();
  for (const pattern of context.utterancePatternsDocument.patterns ?? []) {
    const list = map.get(pattern.intentId) ?? [];
    list.push(pattern);
    map.set(pattern.intentId, list);
  }
  for (const list of map.values()) {
    list.sort((left, right) => (left.priority ?? 0) - (right.priority ?? 0) || String(left.patternId).localeCompare(String(right.patternId), 'en'));
  }
  return map;
}

export function buildSlotsByIntent(context) {
  return new Map((context.slotSchemaDocument.intents ?? []).map((intent) => [intent.intentId, intent]));
}

export function buildElementsById(context) {
  return new Map((context.elementsDocument.elements ?? []).map((element) => [element.elementId, element]));
}

export function buildStatesById(context) {
  return new Map((context.statesDocument.states ?? []).map((state) => [state.stateId, state]));
}

export function collectAliasesForCanonicalId(context, canonicalId) {
  const entry = (context.aliasLexiconDocument.entries ?? []).find((item) => item.canonicalId === canonicalId);
  return uniqueSortedStrings((entry?.aliases ?? []).map((alias) => alias.text));
}

export function collectFlowDocs(context) {
  const docsByIntent = new Map();
  for (const document of context.docsManifest.documents ?? []) {
    if (document.intentId && document.path) {
      const originalPath = path.resolve(document.path);
      const mappedPath = context.mapToKbPath(originalPath) ?? originalPath;
      docsByIntent.set(document.intentId, {
        ...document,
        originalPath,
        mappedPath,
      });
    }
  }
  return docsByIntent;
}
