// @ts-check

import { collectionStatusLabel } from './status-labels.mjs';

export function displayBuildWarning(value) {
  const text = String(value ?? '');
  const translations = new Map([
    ['Browser-rendered crawl is unavailable for this deterministic static build path.', 'Browser-rendered crawl is unavailable for this deterministic static build path.'],
    ['Browser-rendered crawl is not part of the public build path; this run used static and sanitized setup evidence only.', 'This build used static and sanitized setup evidence only; browser-rendered crawl is not part of the public build path.'],
    ['Network summary was not requested; raw network tracing is not part of the public build path.', 'Network summary was not requested; raw network tracing is not part of the public build path.'],
    ['Network capture requested; raw network traces were not persisted, and this build path only writes a sanitized network summary.', 'Network capture requested; only a sanitized network summary was saved.'],
    ['Network summary requested; raw network traces were not captured or persisted.', 'Network summary requested; raw network traces were not captured or persisted.'],
    ['Raw network capture was enabled; raw trace artifacts may contain sensitive material.', 'Raw network capture was enabled for controlled in-memory replay only; raw trace artifacts were not saved.'],
    ['Raw network capture was enabled; raw artifacts are kept out of generated Skill, current outputs, and registry.', 'Raw network capture was enabled for controlled in-memory replay only; raw trace artifacts were not saved.'],
    ['Raw network capture was enabled for in-memory API replay only; raw trace artifacts were not persisted.', 'Raw network capture was enabled for controlled in-memory replay only; raw trace artifacts were not saved.'],
    ['network-fetch-failed', 'Network fetch failed; raw error details were not saved.'],
    ['validation-failed', 'Verification did not pass; see verification_report.json.'],
    ['robots-unavailable', 'robots.txt could not be fetched, so the live build stopped safely.'],
    ['robots-disallowed', 'robots.txt blocked the candidate crawl scope.'],
    ['dynamic-unsupported', 'The route appears to require dynamic collection, which was not enabled.'],
    ['browser-auth-route-coverage-partial', 'Default-browser bridge captured only reachable configured routes; missing routes are reported as authenticated coverage gaps.'],
    ['Skipped because setup profile is not buildable.', 'Skipped because the setup profile is not buildable.'],
  ]);
  if (translations.has(text)) {
    return translations.get(text);
  }
  const skipped = text.match(/^Skipped because ([A-Za-z][A-Za-z0-9]*) ([a-z_]+)\.$/u);
  if (skipped) return `Skipped because stage ${skipped[1]} status is ${collectionStatusLabel(skipped[2])}.`;
  const crawlFailed = text.match(/^crawl failed: (.+)$/u);
  if (crawlFailed) return `Crawl failed: ${crawlFailed[1]}`;
  return text;
}

export function displayCollectionKind(value) {
  if (value === 'capability') return 'capability';
  if (value === 'node') return 'node';
  if (value === 'affordance') return 'affordance';
  if (value === 'stage') return 'stage';
  if (value === 'build') return 'build';
  return String(value ?? '-');
}

export function displayCollectionTarget(value) {
  return String(value ?? '') || '-';
}

export function displayCollectionReason(item) {
  const reasonCode = String(item?.reasonCode ?? '');
  if (reasonCode === 'capability-specific-evidence-required') return 'Capability-specific evidence is missing.';
  if (reasonCode === 'authorized-route-seed-only') return 'Only an authorized route seed was collected; page content is not verified.';
  if (reasonCode === 'not-selected-by-setup') return 'Not selected during setup; kept as a candidate capability.';
  if (reasonCode === 'capability-candidate') return 'Candidate capability does not yet meet activation criteria.';
  if (reasonCode === 'stage-skipped') return 'Upstream stage did not complete; this stage was skipped.';
  if (reasonCode === 'stage-failed') return 'This stage failed and did not produce a verifiable result.';
  if (reasonCode === 'stage-blocked') return 'This stage was blocked by a safety or evidence gate.';
  if (reasonCode === 'empty-crawl') return 'Static crawl did not collect verifiable page evidence.';
  if (reasonCode === 'robots-disallowed') return 'robots.txt blocked the candidate crawl scope.';
  if (reasonCode === 'robots-unavailable') return 'robots.txt could not be fetched, so the live build stopped safely.';
  if (reasonCode === 'dynamic-unsupported') return 'The route appears to require dynamic collection, which was not enabled.';
  if (reasonCode === 'network-fetch-failed') return 'Network fetch failed; no verifiable page evidence was collected.';
  return displayBuildWarning(item?.reason ?? reasonCode);
}

export function markdownTableCell(value, maxLength = 72) {
  const text = String(value ?? '-')
    .replace(/\r?\n/gu, ' ')
    .replace(/\|/gu, '\\|')
    .trim();
  if (text.length <= maxLength) {
    return text || '-';
  }
  return `${text.slice(0, Math.max(1, maxLength - 1))}...`;
}

export function renderCollectionOutcomeTable(outcomes = /** @type {any[]} */ ([])) {
  const rows = [
    '  | Type | Target | Status | Reason |',
    '  | --- | --- | --- | --- |',
  ];
  for (const item of outcomes) {
    rows.push(`  | ${markdownTableCell(displayCollectionKind(item.kind), 12)} | ${markdownTableCell(displayCollectionTarget(item.target), 30)} | ${markdownTableCell(collectionStatusLabel(item.status), 12)} | ${markdownTableCell(displayCollectionReason(item), 88)} |`);
  }
  return rows;
}
