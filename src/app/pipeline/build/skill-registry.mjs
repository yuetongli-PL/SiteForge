// @ts-check

import path from 'node:path';
import { readJsonIfExists } from './artifact-store.mjs';

export const BUILD_SKILL_REGISTRY_SCHEMA_VERSION = 1;

function normalizeWords(value) {
  const normalized = String(value ?? '')
    .toLowerCase()
    .normalize('NFKC');
  const tokens = normalized.match(/[\p{L}\p{N}]+/gu) ?? [];
  const expanded = /** @type {any[]} */ ([]);
  for (const token of tokens) {
    expanded.push(token);
    if (/[\p{Script=Han}]/u.test(token)) {
      expanded.push(...[...token]);
    }
  }
  return expanded.filter(Boolean);
}

function normalizePhrase(value) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/\s+/gu, ' ')
    .trim();
}

function utteranceScore(intent, utterance) {
  const queryPhrase = normalizePhrase(utterance);
  const queryWords = new Set(normalizeWords(utterance));
  const candidates = [
    intent.name,
    intent.description,
    intent.canonicalUtterance,
    ...(intent.utteranceExamples ?? []),
  ].join(' ');
  const candidatePhrase = normalizePhrase(candidates);
  const exactPhraseBonus = queryPhrase && candidatePhrase.includes(queryPhrase) ? 100 : 0;
  const candidateWords = new Set(normalizeWords(candidates));
  let overlap = 0;
  for (const word of queryWords) {
    if (candidateWords.has(word)) {
      overlap += 1;
    }
  }
  const actionBonus = intent.capabilityAction && queryWords.has(String(intent.capabilityAction).toLowerCase()) ? 2 : 0;
  if (overlap + actionBonus <= 0) {
    return 0;
  }
  return exactPhraseBonus + overlap + actionBonus + Number(intent.invocationScore ?? 0);
}

function hasAnyWord(words, candidates) {
  for (const candidate of candidates) {
    if (words.has(candidate)) {
      return true;
    }
  }
  return false;
}

function hasObjectMismatch(best, utterance) {
  const queryWords = new Set(normalizeWords(utterance));
  const bestWords = new Set(normalizeWords([
    best?.intentName,
    best?.capabilityName,
  ].join(' ')));
  if (
    hasAnyWord(queryWords, ['user', 'users', 'account', 'accounts', 'follower', 'followers'])
    && !hasAnyWord(bestWords, ['user', 'users', 'account', 'accounts', 'profile', 'profiles', 'author', 'authors', 'follower', 'followers'])
  ) {
    return true;
  }
  if (
    hasAnyWord(queryWords, ['timeline', 'feed', 'posts', 'updates'])
    && hasAnyWord(bestWords, ['user', 'users', 'account', 'accounts', 'profile', 'profiles', 'follower', 'followers'])
    && !hasAnyWord(bestWords, ['timeline', 'feed', 'posts', 'updates'])
  ) {
    return true;
  }
  return false;
}

const WRITE_INTENT_PATTERN = /(?:\b(?:edit|update|change|modify|delete|remove|publish|send|submit|follow|unfollow|like|repost|upload|pay|payment|checkout)\b|\u4fee\u6539|\u7f16\u8f91|\u66f4\u6539|\u5220\u9664|\u79fb\u9664|\u53d1\u5e03|\u53d1\u9001|\u63d0\u4ea4|\u5173\u6ce8|\u53d6\u5173|\u70b9\u8d5e|\u8f6c\u53d1|\u4e0a\u4f20|\u4ed8\u6b3e|\u652f\u4ed8)/iu;
const PROFILE_EDIT_INTENT_PATTERN = /(?:(?:\b(?:edit|update|change|modify)\b|\u4fee\u6539|\u7f16\u8f91|\u66f4\u6539).*(?:\b(?:profile|account|bio|homepage)\b|\u4e2a\u4eba\u8d44\u6599|\u8d26\u53f7\u8d44\u6599|\u4e3b\u9875\u4fe1\u606f|\u4e3b\u9875)|(?:\b(?:profile|account|bio|homepage)\b|\u4e2a\u4eba\u8d44\u6599|\u8d26\u53f7\u8d44\u6599|\u4e3b\u9875\u4fe1\u606f|\u4e3b\u9875).*(?:\b(?:edit|update|change|modify)\b|\u4fee\u6539|\u7f16\u8f91|\u66f4\u6539))/iu;

function bestSupportsWriteIntent(best) {
  const action = String(best?.capabilityAction ?? '').toLowerCase();
  if (['create', 'submit', 'upload', 'book', 'purchase', 'login', 'register', 'manage', 'contact'].includes(action)) {
    return true;
  }
  if (String(best?.safetyLevel ?? '').toLowerCase() !== 'read_only') {
    return true;
  }
  const bestText = normalizePhrase([
    best?.intentName,
    best?.capabilityName,
    best?.canonicalUtterance,
    ...(best?.utteranceExamples ?? []),
  ].join(' '));
  return /(?:\b(?:draft|compose|prepare|edit|update|change|modify|delete|remove|publish|send|submit|follow|unfollow|like|repost|upload|payment|checkout)\b|\u4fee\u6539|\u7f16\u8f91|\u66f4\u6539|\u5220\u9664|\u53d1\u5e03|\u53d1\u9001|\u63d0\u4ea4|\u5173\u6ce8|\u53d6\u5173|\u70b9\u8d5e|\u8f6c\u53d1|\u4e0a\u4f20|\u4ed8\u6b3e|\u652f\u4ed8)/iu.test(bestText);
}

function hasActionMismatch(best, utterance) {
  const queryPhrase = normalizePhrase(utterance);
  if (!queryPhrase) {
    return false;
  }
  if ((WRITE_INTENT_PATTERN.test(queryPhrase) || PROFILE_EDIT_INTENT_PATTERN.test(queryPhrase)) && !bestSupportsWriteIntent(best)) {
    return true;
  }
  if (PROFILE_EDIT_INTENT_PATTERN.test(queryPhrase)) {
    const bestText = normalizePhrase([
      best?.intentName,
      best?.capabilityName,
      best?.canonicalUtterance,
      ...(best?.utteranceExamples ?? []),
    ].join(' '));
    if (!PROFILE_EDIT_INTENT_PATTERN.test(bestText)) {
      return true;
    }
  }
  return false;
}

function isCallableSkillRecord(skill) {
  return skill?.verificationStatus === 'passed';
}

export function createEmptySkillRegistry(nowIso = new Date().toISOString()) {
  return {
    schemaVersion: BUILD_SKILL_REGISTRY_SCHEMA_VERSION,
    generatedAt: nowIso,
    skills: [],
  };
}

export function upsertSkillRegistryRecord(registry, record, nowIso = new Date().toISOString()) {
  const next = {
    ...(registry ?? createEmptySkillRegistry(nowIso)),
    schemaVersion: BUILD_SKILL_REGISTRY_SCHEMA_VERSION,
    generatedAt: nowIso,
  };
  const records = (next.skills ?? []).filter((entry) => entry.skillId !== record.skillId);
  records.push(record);
  records.sort((left, right) => String(left.skillId).localeCompare(String(right.skillId), 'en'));
  next.skills = records;
  return next;
}

export async function readSkillRegistry(registryPath) {
  return await readJsonIfExists(registryPath, createEmptySkillRegistry());
}

export function lookupSkillIntentFromRegistry(registry, {
  domain,
  utterance,
} = /** @type {any} */ ({})) {
  const normalizedDomain = String(domain ?? '').toLowerCase();
  const matchingSkills = (registry?.skills ?? []).filter((skill) => (
    isCallableSkillRecord(skill)
    &&
    (skill.domains ?? []).map((entry) => String(entry).toLowerCase()).includes(normalizedDomain)
  ));
  let best = null;
  for (const skill of matchingSkills) {
    for (const intent of skill.intents ?? []) {
      const score = utteranceScore(intent, utterance);
      if (!best || score > best.score || (score === best.score && intent.intentId < best.intentId)) {
        best = {
          score,
          skillId: skill.skillId,
          skillDir: skill.skillDir,
          intentId: intent.intentId,
          intentName: intent.name,
          capabilityId: intent.capabilityId,
          capabilityName: intent.capabilityName,
          capabilityAction: intent.capabilityAction,
          executionPlanId: intent.executionPlanId,
          canonicalUtterance: intent.canonicalUtterance,
          utteranceExamples: intent.utteranceExamples ?? [],
          safetyLevel: intent.safetyLevel,
        };
      }
    }
  }
  if (!best || best.score <= 0) {
    return {
      status: 'not_found',
      domain: normalizedDomain,
      utterance,
      skillId: null,
      intentId: null,
      capabilityId: null,
      ...((WRITE_INTENT_PATTERN.test(normalizePhrase(utterance)) || PROFILE_EDIT_INTENT_PATTERN.test(normalizePhrase(utterance)))
        ? { reason: 'action_mismatch' }
        : {}),
    };
  }
  if (hasObjectMismatch(best, utterance)) {
    return {
      status: 'not_found',
      domain: normalizedDomain,
      utterance,
      skillId: null,
      intentId: null,
      capabilityId: null,
      reason: 'object_mismatch',
    };
  }
  if (hasActionMismatch(best, utterance)) {
    return {
      status: 'not_found',
      domain: normalizedDomain,
      utterance,
      skillId: null,
      intentId: null,
      capabilityId: null,
      reason: 'action_mismatch',
    };
  }
  return {
    status: 'found',
    domain: normalizedDomain,
    utterance,
    ...best,
  };
}

export async function lookupSkillIntent({
  registryPath = path.resolve(process.cwd(), 'skills', 'registry.json'),
  domain,
  utterance,
} = /** @type {any} */ ({})) {
  const registry = await readSkillRegistry(registryPath);
  return lookupSkillIntentFromRegistry(registry, { domain, utterance });
}
