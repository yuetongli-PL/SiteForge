import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import {
  displayPath,
  displayReportPath,
  relativeOrCompactPath,
} from '../../src/infra/cli/path-display.mjs';

test('displayPath preserves debug summary path semantics', () => {
  const cwd = path.resolve('/tmp/siteforge');
  assert.equal(displayPath('', cwd), '-');
  assert.equal(displayPath(path.join(cwd, 'runs', 'skill'), cwd), 'runs/skill');
  assert.equal(displayPath('/var/tmp/other/skill', cwd), '/var/tmp/other/skill');
});

test('displayReportPath keeps user report paths compact', () => {
  const cwd = path.resolve('/tmp/siteforge');
  assert.equal(displayReportPath('', { cwd }), '-');
  assert.equal(displayReportPath('runs/site/user.md', { cwd }), 'runs/site/user.md');
  assert.equal(displayReportPath(path.join(cwd, 'runs', 'site', 'user.md'), { cwd }), 'runs/site/user.md');
  assert.equal(displayReportPath('/var/tmp/other/user.md', { cwd }), 'user.md');
  assert.equal(displayReportPath('C:\\runs\\site\\user.md', { cwd: 'C:\\runs' }), 'site/user.md');
});

test('relativeOrCompactPath supports URLs, verbose mode, and max width', () => {
  const cwd = path.resolve('/tmp/siteforge');
  assert.equal(relativeOrCompactPath(null, { cwd }), null);
  assert.equal(relativeOrCompactPath(path.join(cwd, 'runs', 'skill'), { cwd }), 'runs/skill');
  assert.equal(relativeOrCompactPath(path.join(cwd, 'runs', 'skill'), { cwd, verbose: true }), path.join(cwd, 'runs', 'skill'));
  assert.equal(relativeOrCompactPath('https://example.com/path/to/resource', { cwd, maxWidth: 12 }).length <= 12, true);
  const compact = relativeOrCompactPath(path.join(cwd, 'alpha', 'beta', 'gamma', 'delta', 'epsilon'), { cwd, maxWidth: 24 });
  assert.match(compact, /alpha\/\.\.\.\/delta\/epsilon|…/u);
});
