import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const MATRIX_PATH = new URL(
  '../../../docs/site-capability-compiler-executor/IMPLEMENTATION_MATRIX.md',
  import.meta.url,
);

function readMatrix() {
  return readFileSync(MATRIX_PATH, 'utf8');
}

function sectionBlocks(markdown) {
  const matches = [...markdown.matchAll(/^## ([0-9]+)\. .+$/gmu)];
  return matches.map((match, index) => {
    const start = match.index;
    const end = index + 1 < matches.length ? matches[index + 1].index : markdown.length;
    return {
      number: Number(match[1]),
      text: markdown.slice(start, end),
    };
  });
}

test('compiler-executor matrix covers sections 1-20 as verified', () => {
  const blocks = sectionBlocks(readMatrix());
  assert.equal(blocks.length, 20);
  assert.deepEqual(blocks.map((block) => block.number), Array.from({ length: 20 }, (_, index) => index + 1));
  for (const block of blocks) {
    assert.match(block.text, /Current status: `verified`/u, `section ${block.number} should be verified`);
    assert.doesNotMatch(block.text, /Pending implementation|Not verified|Not run/u);
  }
});

test('compiler-executor matrix records code, test, command, result, and quality gate evidence', () => {
  for (const block of sectionBlocks(readMatrix())) {
    assert.match(block.text, /Existing code evidence: .+/u, `section ${block.number} needs code evidence`);
    assert.match(block.text, /Existing test evidence: .+/u, `section ${block.number} needs test evidence`);
    assert.match(block.text, /Verification command: .+/u, `section ${block.number} needs command evidence`);
    assert.match(block.text, /Verification result: .+passed/u, `section ${block.number} needs passing result`);
    assert.match(block.text, /TestVerificationQualityGateAgent conclusion: Accepted/u, `section ${block.number} needs acceptance`);
  }
});
