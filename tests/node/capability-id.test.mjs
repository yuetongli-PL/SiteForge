import test from 'node:test';
import assert from 'node:assert/strict';

import {
  canonicalCapabilitySemanticToken,
  normalizeCapabilityId,
  normalizeSetupCapabilityId,
} from '../../src/app/pipeline/build/capability-id.mjs';

test('capability id helpers preserve generic and setup-specific normalization', () => {
  assert.equal(normalizeCapabilityId(' capability:x:Read Followers '), 'capability-x-read-followers');
  assert.equal(normalizeSetupCapabilityId(' capability:x:Read Followers '), 'read-followers');
  assert.equal(normalizeSetupCapabilityId('Read Followers'), 'read-followers');
});

test('capability semantic aliases canonicalize setup capabilities', () => {
  assert.equal(canonicalCapabilitySemanticToken('Following Accounts'), 'list-followed-users');
  assert.equal(canonicalCapabilitySemanticToken('capability:x:View Post Detail'), 'read-post-detail');
  assert.equal(canonicalCapabilitySemanticToken('unknown custom action'), 'unknown-custom-action');
  assert.equal(canonicalCapabilitySemanticToken(''), null);
});
