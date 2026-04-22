import { cleanText, toArray } from './normalize.mjs';

function normalizeSignal(signal) {
  return cleanText(signal ?? '').toLowerCase();
}

function dedupeSignalsInOrder(signals = []) {
  const seen = new Set();
  const result = [];
  for (const signal of toArray(signals).map(normalizeSignal).filter(Boolean)) {
    if (seen.has(signal)) {
      continue;
    }
    seen.add(signal);
    result.push(signal);
  }
  return result;
}

export function deriveRuntimeEvidence(pageFacts = null, {
  antiCrawlReasonCode = null,
} = {}) {
  const antiCrawlSignals = dedupeSignalsInOrder(pageFacts?.antiCrawlSignals);
  const resolvedAntiCrawlReasonCode = cleanText(pageFacts?.antiCrawlReasonCode ?? antiCrawlReasonCode) || null;
  const antiCrawlDetected = (
    pageFacts?.antiCrawlDetected === true
    || antiCrawlSignals.length > 0
    || Boolean(resolvedAntiCrawlReasonCode)
  );
  if (!antiCrawlDetected) {
    return null;
  }

  return {
    antiCrawlDetected: true,
    antiCrawlSignals,
    antiCrawlReasonCode: resolvedAntiCrawlReasonCode || 'anti-crawl',
    antiCrawlEvidence: {
      governanceCategory: 'anti-crawl',
      reasonCode: resolvedAntiCrawlReasonCode || 'anti-crawl',
      signals: antiCrawlSignals,
    },
    networkRiskDetected: true,
    noDedicatedIpRiskDetected: true,
    noDedicatedIpRiskEvidence: {
      governanceCategory: 'no-dedicated-ip',
      reasonCode: resolvedAntiCrawlReasonCode || 'anti-crawl',
    },
  };
}

export function mergeRuntimeEvidence(pageFacts = null, runtimeEvidence = null, options = {}) {
  const derivedRuntimeEvidence = deriveRuntimeEvidence(pageFacts, options);
  const mergedRuntimeEvidence = (derivedRuntimeEvidence || runtimeEvidence)
    ? {
      ...(derivedRuntimeEvidence ?? {}),
      ...(runtimeEvidence ?? {}),
    }
    : null;
  const mergedPageFacts = mergedRuntimeEvidence && pageFacts
    ? {
      ...pageFacts,
      ...mergedRuntimeEvidence,
    }
    : pageFacts;

  return {
    pageFacts: mergedPageFacts,
    runtimeEvidence: mergedRuntimeEvidence,
  };
}
