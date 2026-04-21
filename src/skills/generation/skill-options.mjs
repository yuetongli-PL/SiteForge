// @ts-check

import path from 'node:path';
import { normalizeWhitespace, slugifyAscii } from '../../shared/normalize.mjs';

export const DEFAULT_SKILL_OPTIONS = {
  kbDir: undefined,
  outDir: undefined,
  skillName: undefined,
  wikiIndexPath: undefined,
  wikiSchemaPath: undefined,
  flowsDir: undefined,
  recoveryPath: undefined,
  approvalPath: undefined,
  nlIntentsPath: undefined,
  interactionModelPath: undefined,
};

export function resolveSkillName(inputUrl, explicitSkillName) {
  if (explicitSkillName) {
    return slugifyAscii(explicitSkillName, 'site-skill');
  }
  try {
    const parsed = new URL(inputUrl);
    const hostLabels = parsed.hostname
      .split('.')
      .map((label) => normalizeWhitespace(label).toLowerCase())
      .filter(Boolean)
      .filter((label) => !['www', 'm'].includes(label));
    const baseLabel = slugifyAscii(hostLabels[0], 'site');
    const firstSegment = parsed.pathname
      .split('/')
      .map((segment) => normalizeWhitespace(segment))
      .find(Boolean);
    const segmentSlug = firstSegment ? slugifyAscii(firstSegment, '') : '';
    return segmentSlug ? `${baseLabel}-${segmentSlug}` : baseLabel;
  } catch {
    return 'site-skill';
  }
}

export function mergeSkillOptions(options = {}) {
  const merged = { ...DEFAULT_SKILL_OPTIONS };
  for (const [key, value] of Object.entries(options ?? {})) {
    if (value !== undefined) {
      merged[key] = value;
    }
  }
  merged.skillName = resolveSkillName(options?.url ?? '', merged.skillName);
  return merged;
}

export function buildOutputPaths(skillDir) {
  const referencesDir = path.join(skillDir, 'references');
  return {
    skillDir,
    skillMd: path.join(skillDir, 'SKILL.md'),
    referencesDir,
    indexMd: path.join(referencesDir, 'index.md'),
    flowsMd: path.join(referencesDir, 'flows.md'),
    recoveryMd: path.join(referencesDir, 'recovery.md'),
    approvalMd: path.join(referencesDir, 'approval.md'),
    nlIntentsMd: path.join(referencesDir, 'nl-intents.md'),
    interactionModelMd: path.join(referencesDir, 'interaction-model.md'),
  };
}
