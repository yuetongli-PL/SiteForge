import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SITE_CAPABILITY_GRAPH_FINAL_SECTION_COUNT,
  assertSiteCapabilityGraphFinalValidationPassed,
  assertSiteCapabilityGraphFinalValidationSummaryCompatible,
  createSiteCapabilityGraphFinalValidationSummary,
  extractSiteCapabilityGraphMatrixSections,
} from '../../src/sites/capability/site-capability-graph-final-validation.mjs';

function completeSections(overrides = {}) {
  return Array.from({ length: SITE_CAPABILITY_GRAPH_FINAL_SECTION_COUNT }, (_, index) => {
    const number = index + 1;
    return {
      number,
      title: `Section ${number}`,
      status: 'verified',
      codeEvidence: `src/sites/capability/section-${number}.mjs final code evidence`,
      testEvidence: `tests/node/section-${number}.test.mjs focused test evidence`,
      verificationCommand: `node --test tests/node/section-${number}.test.mjs`,
      verificationResult: `focused validation passed for section ${number}`,
      riskNotes: 'No known serious safety violation remains.',
      ...overrides[number],
    };
  });
}

function passingInput(overrides = {}) {
  return {
    graphVersion: 'site-capability-graph-v1',
    sections: completeSections(overrides.sections),
    section19TestingStrategy: {
      focusedFinalValidationPassed: true,
      matrixValidationPassed: true,
      regressionCoverageRecorded: true,
      promotionBlockingCoverageResolved: true,
      ...overrides.section19TestingStrategy,
    },
    section20CompletionGate: {
      finalMatrixValidationPassed: true,
      finalValidationSummaryAccepted: true,
      noKnownSeriousSafetyViolations: true,
      ...overrides.section20CompletionGate,
    },
    agentBReview: {
      result: 'Accepted',
      ...overrides.agentBReview,
    },
    knownRisks: overrides.knownRisks ?? [],
  };
}

function renderSyntheticMatrix(sections) {
  return [
    '# Site Capability Graph Implementation Matrix',
    '',
    ...sections.map((section) => [
      `## ${section.number}. ${section.title}`,
      '',
      `- Current status: \`${section.status}\``,
      `- Existing code evidence: ${section.codeEvidence}`,
      `- Existing test evidence: ${section.testEvidence}`,
      `- Verification command: ${section.verificationCommand}`,
      `- Verification result: ${section.verificationResult}`,
      `- Current gaps: ${section.currentGaps ?? 'None for final validation.'}`,
      `- Risk notes: ${section.riskNotes ?? 'No known serious safety violation remains.'}`,
      '',
    ].join('\n')),
  ].join('\n');
}

test('final validation summary passes only when all 20 sections are verified with Section 19 and 20 closure gates', () => {
  const summary = createSiteCapabilityGraphFinalValidationSummary(passingInput());

  assert.equal(summary.result, 'passed');
  assert.equal(summary.allSectionsVerified, true);
  assert.equal(summary.statusCounts.verified, 20);
  assert.equal(summary.section19.readyForVerified, true);
  assert.equal(summary.section20.readyForVerified, true);
  assert.equal(summary.promotion.matrixVerifiedPromotionAllowed, true);
  assert.equal(summary.promotion.automaticMatrixMutationAllowed, false);
  assert.equal(summary.deliveryDescriptorScanPerformed, false);
  assert.equal(summary.runtimeExecutionPerformed, false);
  assert.equal(summary.repoWritePerformed, false);
  assert.equal(summary.matrixWritePerformed, false);
  assert.equal(summary.siteAdapterInvoked, false);
  assert.equal(summary.downloaderInvoked, false);
  assert.equal(summary.sessionMaterialized, false);
  assert.deepEqual(summary.gaps, []);
  assert.equal(assertSiteCapabilityGraphFinalValidationSummaryCompatible(summary), true);
  assert.equal(assertSiteCapabilityGraphFinalValidationPassed(summary), true);
});

test('final validation blocks Section 19 and 20 readiness when any section is still partial', () => {
  const summary = createSiteCapabilityGraphFinalValidationSummary(passingInput({
    sections: {
      3: {
        status: 'partial',
      },
    },
  }));

  assert.equal(summary.result, 'blocked');
  assert.equal(summary.allSectionsVerified, false);
  assert.equal(summary.statusCounts.partial, 1);
  assert.equal(summary.section19.readyForVerified, false);
  assert.equal(summary.section20.readyForVerified, false);
  assert.equal(summary.promotion.matrixVerifiedPromotionAllowed, false);
  assert.deepEqual(
    summary.gaps.filter((gap) => gap.reasonCode === 'graph-final-validation-section-not-verified'),
    [{
      reasonCode: 'graph-final-validation-section-not-verified',
      section: 3,
      message: 'Section 3 is partial, not verified',
    }],
  );
  assert.throws(
    () => assertSiteCapabilityGraphFinalValidationPassed(summary),
    /final validation did not pass/u,
  );
});

test('final validation blocks Section 19 when testing-strategy evidence is incomplete', () => {
  const summary = createSiteCapabilityGraphFinalValidationSummary(passingInput({
    section19TestingStrategy: {
      regressionCoverageRecorded: false,
    },
  }));

  assert.equal(summary.result, 'blocked');
  assert.equal(summary.section19.readyForVerified, false);
  assert.equal(summary.section20.readyForVerified, false);
  assert.equal(summary.promotion.matrixVerifiedPromotionAllowed, false);
  assert.deepEqual(
    summary.gaps.filter((gap) => gap.reasonCode === 'graph-final-validation-section19-testing-strategy-incomplete'),
    [{
      reasonCode: 'graph-final-validation-section19-testing-strategy-incomplete',
      section: 19,
      field: 'regressionCoverageRecorded',
      message: 'regression coverage must be recorded',
    }],
  );
});

test('final validation blocks Section 20 without Agent B acceptance and serious-risk closure', () => {
  const summary = createSiteCapabilityGraphFinalValidationSummary(passingInput({
    section20CompletionGate: {
      noKnownSeriousSafetyViolations: false,
    },
    agentBReview: {
      result: 'Needs changes',
    },
    knownRisks: ['Agent B still has an unresolved final gate concern.'],
  }));

  assert.equal(summary.result, 'blocked');
  assert.equal(summary.section20.readyForVerified, false);
  assert.equal(summary.section20.agentBReviewResult, 'Needs changes');
  assert.equal(summary.promotion.matrixVerifiedPromotionAllowed, false);
  assert.deepEqual(
    summary.gaps.map((gap) => gap.reasonCode),
    [
      'graph-final-validation-section20-completion-gate-incomplete',
      'graph-final-validation-agent-b-not-accepted',
      'graph-final-validation-known-risk-open',
    ],
  );
});

test('final validation can consume a matrix-style markdown snapshot without descriptor scanning', () => {
  const sections = completeSections();
  const markdown = renderSyntheticMatrix(sections);
  const extracted = extractSiteCapabilityGraphMatrixSections(markdown);
  const summary = createSiteCapabilityGraphFinalValidationSummary({
    ...passingInput(),
    sections: extracted,
  });

  assert.equal(extracted.length, 20);
  assert.deepEqual(extracted.map((section) => section.number), Array.from({ length: 20 }, (_, index) => index + 1));
  assert.equal(summary.result, 'passed');
  assert.equal(summary.deliveryDescriptorScanPerformed, false);
  assert.doesNotMatch(JSON.stringify(summary), /delivery-\*/u);
});

test('final validation rejects incomplete verified evidence instead of accepting status text alone', () => {
  const summary = createSiteCapabilityGraphFinalValidationSummary(passingInput({
    sections: {
      19: {
        verificationResult: 'Not run yet',
      },
    },
  }));

  assert.equal(summary.result, 'blocked');
  assert.deepEqual(
    summary.gaps.filter((gap) => gap.reasonCode === 'graph-final-validation-section-evidence-incomplete'),
    [{
      reasonCode: 'graph-final-validation-section-evidence-incomplete',
      section: 19,
      field: 'verificationResult',
      message: 'Section 19 verificationResult is incomplete',
    }],
  );
});

test('final validation rejects runtime products and sensitive material without echoing values', () => {
  assert.throws(
    () => createSiteCapabilityGraphFinalValidationSummary(passingInput({
      sections: {
        20: {
          rawSession: true,
        },
      },
    })),
    (error) => {
      assert.match(error.message, /runtime or sensitive field/u);
      assert.doesNotMatch(error.message, /true/u);
      return true;
    },
  );
});

test('final validation compatibility rejects any attempted delivery scan or runtime side effect', () => {
  const summary = createSiteCapabilityGraphFinalValidationSummary(passingInput());

  assert.throws(
    () => assertSiteCapabilityGraphFinalValidationSummaryCompatible({
      ...summary,
      deliveryDescriptorScanPerformed: true,
    }),
    /deliveryDescriptorScanPerformed must be false/u,
  );
  assert.throws(
    () => assertSiteCapabilityGraphFinalValidationSummaryCompatible({
      ...summary,
      runtimeExecutionPerformed: true,
    }),
    /runtimeExecutionPerformed must be false/u,
  );
  assert.throws(
    () => assertSiteCapabilityGraphFinalValidationSummaryCompatible({
      ...summary,
      matrixWritePerformed: true,
    }),
    /matrixWritePerformed must be false/u,
  );
});
