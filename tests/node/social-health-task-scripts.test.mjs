import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const INSTALL_SCRIPT = path.join(REPO_ROOT, 'tools', 'install-social-health-watch-task.ps1');
const UNINSTALL_SCRIPT = path.join(REPO_ROOT, 'tools', 'uninstall-social-health-watch-task.ps1');

function runPowerShell(script, args) {
  return new Promise((resolve, reject) => {
    const child = execFile('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, ...args], {
      cwd: REPO_ROOT,
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (exitCode) => {
      if (exitCode === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(`PowerShell exited ${exitCode}\n${stderr}`));
    });
  });
}

test('install social health task script dry-run builds stable schtasks create args', async () => {
  const { stdout } = await runPowerShell(INSTALL_SCRIPT, [
    '-Json',
    '-Site',
    'x',
    '-IntervalMinutes',
    '45',
    '-NodePath',
    'C:\\Program Files\\nodejs\\node.exe',
    '-TaskName',
    'SocialHealthX',
  ]);
  const plan = JSON.parse(stdout);

  assert.equal(plan.mode, 'dry-run');
  assert.equal(plan.taskName, '\\Browser-Wiki-Skill\\SocialHealthX');
  assert.equal(plan.taskRunCommand.includes('src\\entrypoints\\cli.mjs'), true);
  assert.equal(plan.taskRunCommand.includes('social health-watch'), true);
  assert.equal(plan.taskRunCommand.includes('--execute'), true);
  assert.deepEqual(plan.schtasksArgs.slice(0, 8), ['/Create', '/F', '/SC', 'MINUTE', '/MO', '45', '/TN', plan.taskName]);
  assert.equal(plan.schtasksArgs[plan.schtasksArgs.indexOf('/TR') + 1], plan.taskRunCommand);
  assert.equal(plan.schtasksArgs.includes('/RL'), true);
});

test('install social health task script supports user-scoped task names without executing schtasks', async () => {
  const { stdout } = await runPowerShell(INSTALL_SCRIPT, [
    '-Json',
    '-UserScope',
    '-Site',
    'instagram',
    '-IntervalMinutes',
    '120',
  ]);
  const plan = JSON.parse(stdout);

  assert.equal(plan.mode, 'dry-run');
  assert.equal(plan.userScope, true);
  assert.match(plan.taskName, /^\\Browser-Wiki-Skill\\[^\\]+\\BrowserWikiSkillSocialHealthWatch$/u);
  assert.equal(plan.schtasksArgs[plan.schtasksArgs.indexOf('/MO') + 1], '120');
  assert.match(plan.taskRunCommand, /--site instagram/u);
});

test('uninstall social health task script dry-run builds stable schtasks delete args', async () => {
  const { stdout } = await runPowerShell(UNINSTALL_SCRIPT, [
    '-Json',
    '-TaskName',
    'SocialHealthX',
  ]);
  const plan = JSON.parse(stdout);

  assert.equal(plan.mode, 'dry-run');
  assert.equal(plan.taskName, '\\Browser-Wiki-Skill\\SocialHealthX');
  assert.deepEqual(plan.schtasksArgs, ['/Delete', '/F', '/TN', plan.taskName]);
});

test('task scripts keep execution gated behind Execute and support WhatIf', async () => {
  const installText = await readFile(INSTALL_SCRIPT, 'utf8');
  const uninstallText = await readFile(UNINSTALL_SCRIPT, 'utf8');

  for (const scriptText of [installText, uninstallText]) {
    assert.match(scriptText, /SupportsShouldProcess = \$true/u);
    assert.match(scriptText, /if \(-not \$Execute\.IsPresent\)/u);
    assert.match(scriptText, /\$PSCmdlet\.ShouldProcess/u);
    assert.match(scriptText, /& schtasks\.exe @schtasksArgs/u);
  }
});

test('task scripts honor PowerShell WhatIf even when Execute is supplied', async () => {
  await runPowerShell(INSTALL_SCRIPT, [
    '-Execute',
    '-WhatIf',
    '-Site',
    'x',
    '-TaskName',
    'SocialHealthWhatIf',
  ]);
  await runPowerShell(UNINSTALL_SCRIPT, [
    '-Execute',
    '-WhatIf',
    '-TaskName',
    'SocialHealthWhatIf',
  ]);
});
