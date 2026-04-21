// @ts-check

import path from 'node:path';

const PIPELINE_RUN_MAPPINGS = Object.freeze([
  ['captures', path.join('runs', 'pipeline', 'captures')],
  ['expanded-states', path.join('runs', 'pipeline', 'expanded-states')],
  ['state-analysis', path.join('runs', 'pipeline', 'state-analysis')],
  ['interaction-abstraction', path.join('runs', 'pipeline', 'interaction-abstraction')],
  ['nl-entry', path.join('runs', 'pipeline', 'nl-entry')],
  ['operation-docs', path.join('runs', 'pipeline', 'operation-docs')],
  ['governance', path.join('runs', 'pipeline', 'governance')],
  ['archive\\site-login', path.join('runs', 'sites', 'site-login')],
  ['archive\\site-keepalive', path.join('runs', 'sites', 'site-keepalive')],
  ['archive\\site-doctor', path.join('runs', 'sites', 'site-doctor')],
  ['archive\\site-scaffold', path.join('runs', 'sites', 'site-scaffold')],
  ['archive\\bilibili-open', path.join('runs', 'sites', 'bilibili-open-page')],
]);

function splitPathSegments(value) {
  const normalized = path.normalize(String(value ?? '').trim());
  if (!normalized) {
    return { root: '', segments: [] };
  }
  const parsed = path.parse(normalized);
  return {
    root: parsed.root,
    segments: normalized
      .slice(parsed.root.length)
      .split(path.sep)
      .filter(Boolean),
  };
}

function joinPathSegments(root, segments) {
  if (!segments.length) {
    return root || '';
  }
  return root ? path.join(root, ...segments) : path.join(...segments);
}

function findSubpathIndex(segments, candidate) {
  if (!candidate.length || candidate.length > segments.length) {
    return -1;
  }
  for (let index = 0; index <= segments.length - candidate.length; index += 1) {
    let matched = true;
    for (let offset = 0; offset < candidate.length; offset += 1) {
      if (segments[index + offset] !== candidate[offset]) {
        matched = false;
        break;
      }
    }
    if (matched) {
      return index;
    }
  }
  return -1;
}

function replaceSubpath(value, fromPath, toPath) {
  const { root, segments } = splitPathSegments(value);
  const fromSegments = splitPathSegments(fromPath).segments;
  const toSegments = splitPathSegments(toPath).segments;
  const matchIndex = findSubpathIndex(segments, fromSegments);
  if (matchIndex === -1) {
    return null;
  }
  const nextSegments = [
    ...segments.slice(0, matchIndex),
    ...toSegments,
    ...segments.slice(matchIndex + fromSegments.length),
  ];
  return joinPathSegments(root, nextSegments);
}

export function expandRunsAwareCandidateValues(value) {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    return [];
  }
  const candidates = [normalized];
  const seen = new Set(candidates.map((entry) => path.normalize(entry)));

  for (const [legacyPath, runsPath] of PIPELINE_RUN_MAPPINGS) {
    for (const [fromPath, toPath] of [[legacyPath, runsPath], [runsPath, legacyPath]]) {
      const replaced = replaceSubpath(normalized, fromPath, toPath);
      if (!replaced) {
        continue;
      }
      const key = path.normalize(replaced);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      candidates.push(replaced);
    }
  }

  return candidates;
}

export function buildRunsAwareCandidates(value, baseDir) {
  return expandRunsAwareCandidateValues(value).map((candidateValue) => ({
    value: candidateValue,
    baseDir,
  }));
}
