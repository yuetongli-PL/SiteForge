import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

import { isKnownReasonCode } from '../../src/domain/risks/reason-codes.mjs';
import { normalizeDownloadAvailability } from '../../src/sites/availability.mjs';

async function readJson(relativePath) {
  return JSON.parse(await readFile(new URL(`../../${relativePath}`, import.meta.url), 'utf8'));
}

async function fileExists(relativePath) {
  try {
    await access(new URL(`../../${relativePath}`, import.meta.url));
    return true;
  } catch {
    return false;
  }
}

test('site registry download availability is explicit and internally consistent', async () => {
  const registry = await readJson('config/site-registry.json');
  const capabilities = await readJson('config/site-capabilities.json');

  for (const [host, registrySite] of Object.entries(registry.sites)) {
    const capabilitySite = capabilities.sites[host];
    const availability = normalizeDownloadAvailability(registrySite, capabilitySite);
    if (!availability.declared) {
      continue;
    }
    assert.deepEqual(
      availability.availableTaskTypes.filter((taskType) => !availability.declaredTaskTypes.includes(taskType)),
      [],
      `${host} available download task types must be declared`,
    );
    assert.deepEqual(
      availability.blockedTaskTypes.filter((taskType) => !availability.declaredTaskTypes.includes(taskType)),
      [],
      `${host} blocked download task types must be declared`,
    );
    assert.deepEqual(
      availability.availableTaskTypes.filter((taskType) => availability.blockedTaskTypes.includes(taskType)),
      [],
      `${host} download task types cannot be both available and blocked`,
    );
    assert.equal(
      availability.status === 'blocked',
      availability.blocked === true,
      `${host} blocked status must match blocked availability`,
    );
    if (registrySite.downloadEntrypoint && !availability.blocked && !availability.fixtureOnly) {
      assert.equal(await fileExists(registrySite.downloadEntrypoint), true, `${host} downloadEntrypoint must exist`);
    }
  }
});

test('README public site table reflects the shared availability model', async () => {
  const registry = await readJson('config/site-registry.json');
  const capabilities = await readJson('config/site-capabilities.json');
  const readme = await readFile(new URL('../../README.md', import.meta.url), 'utf8');

  for (const [host, registrySite] of Object.entries(registry.sites)) {
    const capabilitySite = capabilities.sites[host];
    const availability = normalizeDownloadAvailability(registrySite, capabilitySite);
    const row = readme.split('\n').find((line) => line.startsWith(`| \`${host}\` |`));
    assert.ok(row, `README table is missing ${host}`);
    if (availability.declaredTaskTypes.length) {
      assert.match(row, new RegExp(`downloads declared: ${availability.declaredTaskTypes.join(', ')}`, 'u'));
      assert.match(row, new RegExp(`available: ${availability.availableTaskTypes.length ? availability.availableTaskTypes.join(', ') : 'none'}`, 'u'));
    }
    if (availability.blockedTaskTypes.length) {
      assert.match(row, new RegExp(`blocked: ${availability.blockedTaskTypes.join(', ')}`, 'u'));
    }
    if (availability.reasonCode) {
      assert.match(row, new RegExp(`reason: ${availability.reasonCode}`, 'u'));
    }
    if (availability.runtimeDependencies.length) {
      assert.match(row, new RegExp(`requires: ${availability.runtimeDependencies.join(', ')}`, 'u'));
    }
    for (const reasonCode of availability.dependencyReasonCodes) {
      assert.equal(isKnownReasonCode(reasonCode), true, `${host} dependency reasonCode must be canonical`);
      assert.match(row, new RegExp(`dependency reason: .*${reasonCode}`, 'u'));
    }
  }
});

test('runtime dependency declarations have explicit availability semantics for CI', async () => {
  const registry = await readJson('config/site-registry.json');
  const capabilities = await readJson('config/site-capabilities.json');

  for (const [host, registrySite] of Object.entries(registry.sites)) {
    if (!registrySite.interpreterRequired && registrySite.downloadSupport?.ocrRequired !== true) {
      continue;
    }
    const availability = normalizeDownloadAvailability(registrySite, capabilities.sites[host]);
    assert.equal(availability.declared, true, `${host} dependency-bound routes must declare download task types`);
    assert.ok(
      availability.status === 'available' || availability.status === 'blocked' || availability.status === 'fixtureOnly',
      `${host} dependency-bound routes need explicit available/blocked/fixtureOnly availability`,
    );
    assert.equal(availability.runtimeDependencies.length > 0, true, `${host} must expose runtime dependencies in availability`);
    assert.equal(availability.dependencyReasonCodes.length > 0, true, `${host} must expose dependency-unavailable reasonCode`);
  }
});
