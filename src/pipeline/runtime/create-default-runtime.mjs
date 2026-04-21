// @ts-check

import { maybeRunAuthenticatedKeepalivePreflight } from '../../infra/auth/auth-keepalive-preflight.mjs';
import { PIPELINE_STAGE_SPECS } from '../engine/stage-spec.mjs';
import { capture } from '../stages/capture.mjs';
import { expandStates } from '../stages/expand.mjs';
import { collectBookContent } from '../stages/collect-content.mjs';
import { analyzeStates } from '../stages/analyze.mjs';
import { abstractInteractions } from '../stages/abstract.mjs';
import { buildNlEntry } from '../stages/nl.mjs';
import { generateDocs } from '../stages/docs.mjs';
import { buildGovernance } from '../stages/governance.mjs';
import { compileKnowledgeBase } from '../stages/kb/index.mjs';
import { generateSkill } from '../stages/skill.mjs';
import { siteKeepalive } from '../../infra/auth/site-keepalive-service.mjs';

export const PIPELINE_STAGE_IMPLS = {
  capture,
  expandStates,
  collectBookContent,
  analyzeStates,
  abstractInteractions,
  buildNlEntry,
  generateDocs,
  buildGovernance,
  compileKnowledgeBase,
  generateSkill,
};

export const DEFAULT_PIPELINE_RUNTIME = {
  stageSpecs: PIPELINE_STAGE_SPECS,
  stageImpls: PIPELINE_STAGE_IMPLS,
  preflightKeepalive: maybeRunAuthenticatedKeepalivePreflight,
  siteKeepalive,
};

export function resolvePipelineRuntime(runtime = {}) {
  if (
    !runtime
    || Array.isArray(runtime)
    || typeof runtime !== 'object'
    || (!('stageImpls' in runtime) && !('stageSpecs' in runtime))
  ) {
    return {
      stageSpecs: PIPELINE_STAGE_SPECS,
      stageImpls: runtime ?? PIPELINE_STAGE_IMPLS,
      preflightKeepalive: null,
      siteKeepalive: null,
    };
  }

  return {
    stageSpecs: runtime.stageSpecs ?? PIPELINE_STAGE_SPECS,
    stageImpls: runtime.stageImpls ?? PIPELINE_STAGE_IMPLS,
    preflightKeepalive: runtime.preflightKeepalive ?? null,
    siteKeepalive: runtime.siteKeepalive ?? null,
  };
}
