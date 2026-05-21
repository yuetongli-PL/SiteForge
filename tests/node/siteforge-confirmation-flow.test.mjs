import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import {
  buildConfirmationPaths,
  decorateCapabilityConfirmation,
} from '../../src/app/pipeline/build/confirmation-flow.mjs';
import { parseCapabilitiesArgs } from '../../src/entrypoints/operator/capabilities.mjs';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIR, '..', '..');
const CLI_PATH = path.join(REPO_ROOT, 'src', 'entrypoints', 'operator', 'capabilities.mjs');

function sensitiveReadCapability(overrides = {}) {
  return {
    id: 'capability:x:list-bookmarks',
    name: 'list bookmarks',
    risk_level: 'read_personal_medium',
    enabled_status: 'confirmation_required',
    default_policy: 'confirm_or_limited',
    status: 'active',
    ...overrides,
  };
}

function draftWriteCapability(overrides = {}) {
  return {
    id: 'capability:x:create-post-draft',
    name: 'create post draft',
    risk_level: 'write_low',
    enabled_status: 'confirmation_required',
    default_policy: 'draft_only',
    safety_level: 'requires_confirmation',
    status: 'active',
    ...overrides,
  };
}

function disabledDirectMessageCapability(overrides = {}) {
  return {
    id: 'capability:x:send-direct-message',
    name: 'send direct message',
    risk_level: 'write_high',
    enabled_status: 'disabled',
    default_policy: 'disabled',
    action: 'submit',
    object: 'direct message',
    status: 'disabled',
    ...overrides,
  };
}

function privateMessageDetailCapability(overrides = {}) {
  return {
    id: 'capability:x:private-message-detail',
    name: 'read private message detail',
    risk_level: 'read_private_high',
    enabled_status: 'confirmation_required',
    default_policy: 'disabled',
    action: 'read',
    object: 'private message detail',
    status: 'active',
    ...overrides,
  };
}

function privateMessageBodyCapability(overrides = {}) {
  return {
    id: 'capability:x:direct-message-body',
    name: 'read direct message body',
    risk_level: 'read_private_high',
    enabled_status: 'confirmation_required',
    default_policy: 'disabled',
    action: 'read',
    object: 'direct message body',
    status: 'active',
    ...overrides,
  };
}

async function writeFixtureReport(t, report) {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-confirmation-flow-'));
  t.after(async () => {
    await rm(workspace, { recursive: true, force: true });
  });
  const reportPath = path.join(workspace, 'user.json');
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return reportPath;
}

function runCapabilitiesCli(args) {
  return spawnSync(process.execPath, [CLI_PATH, ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      FORCE_COLOR: '0',
      NO_COLOR: '1',
      PYTHONIOENCODING: 'utf-8',
      PYTHONUTF8: '1',
    },
  });
}

test('confirmation-required capabilities carry an explicit non-manual confirmation path', () => {
  const skillId = 'x-com-authorized-browser-surface';
  const sensitive = decorateCapabilityConfirmation(sensitiveReadCapability(), { skillId });
  const draft = decorateCapabilityConfirmation(draftWriteCapability(), { skillId });

  assert.equal(sensitive.confirmation_group, 'sensitive-read');
  assert.equal(sensitive.confirmation_mode, 'limited');
  assert.match(sensitive.confirm_command, /^node src\/entrypoints\/operator\/capabilities\.mjs confirm .+ --group sensitive-read --limited$/u);
  assert.doesNotMatch(sensitive.next_step, /--manual/u);

  assert.equal(draft.confirmation_group, 'draft-write');
  assert.equal(draft.confirmation_mode, 'draft_only');
  assert.match(draft.confirm_command, /^node src\/entrypoints\/operator\/capabilities\.mjs confirm .+ --group draft-write --draft-only$/u);
  assert.equal(draft.write_actions_enabled, false);
});

test('confirmation paths separate sensitive-read, draft-write, disabled review, and manual collection', () => {
  const paths = buildConfirmationPaths({
    skillId: 'x-com-authorized-browser-surface',
    confirmationRequiredCapabilities: [sensitiveReadCapability(), draftWriteCapability()],
    disabledCapabilities: [disabledDirectMessageCapability()],
  });

  assert.match(paths.view_confirmation_required_command, /node src\/entrypoints\/operator\/capabilities\.mjs list/u);
  assert.match(paths.sensitive_read.command, /--group sensitive-read --limited/u);
  assert.match(paths.draft_write.command, /--group draft-write --draft-only/u);
  assert.match(paths.disabled.review_command, /--status disabled/u);
  assert.equal(paths.commands.some((command) => /--manual/u.test(command)), false);
});

test('disabled high-risk confirmation path is remediation review only', () => {
  const skillId = 'x-com-authorized-browser-surface';
  const disabled = decorateCapabilityConfirmation(disabledDirectMessageCapability(), { skillId });
  const paths = buildConfirmationPaths({
    skillId,
    disabledCapabilities: [disabledDirectMessageCapability()],
  });

  assert.equal(disabled.confirmation_group, 'blocked');
  assert.equal(disabled.confirmation_mode, 'blocked');
  assert.equal(disabled.ordinary_confirmation_allowed, false);
  assert.equal(disabled.write_actions_enabled, false);
  assert.equal(disabled.confirm_command, null);
  assert.match(disabled.next_step, /safe remediation plan/u);
  assert.match(disabled.next_step, /site-specific adapter path/u);
  assert.doesNotMatch(disabled.next_step, /Keep disabled/u);
  assert.equal(disabled.safe_remediation_path, 'requires_explicit_external_adapter');
  assert.equal(disabled.safe_remediation.canAutoPrepare, false);
  assert.equal(disabled.safe_remediation.resultingStatus, 'disabled');
  assert.match(disabled.confirmation_blocked_reason, /默认禁用/u);

  assert.equal(paths.disabled.count, 1);
  assert.equal(paths.disabled.blocked_by_ordinary_confirmation, 1);
  assert.equal(paths.disabled.safe_remediation.requires_explicit_external_adapter, 1);
  assert.equal(paths.disabled.safe_remediation.canAutoPrepare, 0);
  assert.match(paths.disabled.review_command, /node src\/entrypoints\/operator\/capabilities\.mjs list .+ --status disabled/u);
  assert.match(paths.disabled.next_step, /capability_remediation_plan\.json/u);
  assert.match(paths.disabled.next_step, /site-specific adapter validation/u);
  assert.equal(paths.commands.some((command) => /confirm .+send-direct-message/u.test(command)), false);
});

test('disabled capability confirmation preserves generated safe remediation paths', () => {
  const skillId = 'x-com-authorized-browser-surface';
  const disabled = decorateCapabilityConfirmation(disabledDirectMessageCapability({
    safe_remediation_path: 'user_mediated_safe_action_path',
    safe_remediation: {
      path: 'user_mediated_safe_action_path',
      type: 'user_mediated_safe_action_path',
      canAutoPrepare: true,
      evidenceReady: true,
      useReadiness: 'immediate_user_mediated_safe_action',
      writeActionsEnabled: false,
      finalActionsAllowed: false,
      rawMaterialAllowed: false,
      privateContentAllowed: false,
    },
  }), { skillId });

  assert.equal(disabled.confirmation_group, 'blocked');
  assert.equal(disabled.confirm_command, null);
  assert.equal(disabled.safe_remediation_path, 'user_mediated_safe_action_path');
  assert.equal(disabled.safe_remediation.path, 'user_mediated_safe_action_path');
  assert.equal(disabled.safe_remediation.evidenceReady, true);
  assert.equal(disabled.safe_remediation.writeActionsEnabled, false);
  assert.equal(disabled.safe_remediation.rawMaterialAllowed, false);
  assert.equal(disabled.safe_remediation.privateContentAllowed, false);
});

test('draft-only confirmation never enables submit or send actions', () => {
  const skillId = 'x-com-authorized-browser-surface';
  const draft = decorateCapabilityConfirmation(draftWriteCapability({
    executionPlan: {
      id: 'plan:x:create-post-draft',
      mode: 'draft_only',
      dryRunOnly: true,
      autoExecute: false,
      steps: [{ kind: 'prepare_draft', submit: false, finalSubmit: false, upload: false }],
    },
  }), { skillId });
  const paths = buildConfirmationPaths({
    skillId,
    confirmationRequiredCapabilities: [draftWriteCapability()],
  });

  assert.equal(draft.confirmation_group, 'draft-write');
  assert.equal(draft.confirmation_mode, 'draft_only');
  assert.equal(draft.write_actions_enabled, false);
  assert.match(draft.confirm_command, /--draft-only/u);
  assert.doesNotMatch(draft.confirm_command, /submit|send|upload/u);
  assert.match(paths.draft_write.description, /final submit\/send actions remain disabled/u);
});

test('remediation commands and next steps do not include raw credentials or content', () => {
  const skillId = 'x-com-authorized-browser-surface';
  const sensitive = decorateCapabilityConfirmation(sensitiveReadCapability({
    evidence_requirements: ['sanitized_summary_only', 'no_raw_content'],
  }), { skillId });
  const disabled = decorateCapabilityConfirmation(disabledDirectMessageCapability(), { skillId });
  const paths = buildConfirmationPaths({
    skillId,
    confirmationRequiredCapabilities: [sensitiveReadCapability(), draftWriteCapability()],
    disabledCapabilities: [disabledDirectMessageCapability()],
  });
  const remediationText = JSON.stringify({
    sensitive,
    disabled,
    paths,
  });

  assert.doesNotMatch(remediationText, /\bBearer\s+[A-Za-z0-9._~+/-]+=*/u);
  assert.doesNotMatch(remediationText, /\b(?:access_token|refresh_token|token|auth|api[_-]?key|secret|password)=/iu);
  assert.doesNotMatch(remediationText, /\bcookie\s*[:=]/iu);
  assert.doesNotMatch(remediationText, /\bauthorization\s*[:=]/iu);
  assert.doesNotMatch(remediationText, /<html[\s>]|<\/html>|raw\s+(?:dom|html|body)\s*[:=]|private\s+body\s*[:=]/iu);
  assert.match(paths.sensitive_read.description, /unsanitized\/private material remains unsaved/u);
});

test('capabilities CLI parses list confirm and disable without using build manual flags', () => {
  assert.deepEqual(
    parseCapabilitiesArgs(['list', 'skill-a', '--status', 'confirmation_required']).status,
    'confirmation_required',
  );
  assert.equal(
    parseCapabilitiesArgs(['confirm', 'skill-a', '--group', 'sensitive-read', '--limited']).limited,
    true,
  );
  assert.equal(
    parseCapabilitiesArgs(['disable', 'skill-a', '--capability', 'capability:a']).capabilityId,
    'capability:a',
  );
});

test('capabilities CLI confirms limited sensitive reads and rejects ordinary DM send confirmation', async (t) => {
  const reportPath = await writeFixtureReport(t, {
    skill_id: 'x-com-authorized-browser-surface',
    confirmation_required_capabilities: [
      sensitiveReadCapability(),
      privateMessageDetailCapability(),
      privateMessageBodyCapability(),
      disabledDirectMessageCapability({
        status: 'active',
        enabled_status: 'confirmation_required',
      }),
    ],
    disabled_capabilities: [disabledDirectMessageCapability()],
  });

  const list = runCapabilitiesCli([
    'list',
    'x-com-authorized-browser-surface',
    '--report',
    reportPath,
    '--json',
  ]);
  assert.equal(list.status, 0, list.stderr);
  const listed = JSON.parse(list.stdout);
  assert.equal(listed.capabilities.every((capability) => capability.next_step && !/--manual/u.test(capability.next_step)), true);

  const missingLimited = runCapabilitiesCli([
    'confirm',
    'x-com-authorized-browser-surface',
    '--report',
    reportPath,
    '--group',
    'sensitive-read',
    '--json',
  ]);
  assert.notEqual(missingLimited.status, 0);
  assert.match(missingLimited.stderr, /requires --limited/u);

  const confirmLimited = runCapabilitiesCli([
    'confirm',
    'x-com-authorized-browser-surface',
    '--report',
    reportPath,
    '--group',
    'sensitive-read',
    '--limited',
    '--json',
  ]);
  assert.equal(confirmLimited.status, 0, confirmLimited.stderr);
  const confirmed = JSON.parse(confirmLimited.stdout);
  assert.equal(confirmed.write_actions_enabled, false);
  assert.equal(confirmed.private_content_allowed, false);
  assert.equal(confirmed.login_state_reuse.reuses_existing_login_state, true);
  assert.equal(confirmed.login_state_reuse.requires_new_login, false);
  assert.equal(confirmed.login_state_reuse.cookies_persisted, false);
  assert.equal(confirmed.login_state_reuse.tokens_persisted, false);
  assert.equal(confirmed.login_state_reuse.browser_profile_persisted, false);
  assert.equal(confirmed.login_state_reuse.raw_content_persisted, false);

  const blockedDm = runCapabilitiesCli([
    'confirm',
    'x-com-authorized-browser-surface',
    '--report',
    reportPath,
    '--capability',
    'capability:x:send-direct-message',
    '--draft-only',
  ]);
  assert.notEqual(blockedDm.status, 0);
  assert.match(blockedDm.stderr, /cannot be enabled by ordinary confirmation/u);

  const blockedDmDetail = runCapabilitiesCli([
    'confirm',
    'x-com-authorized-browser-surface',
    '--report',
    reportPath,
    '--capability',
    'capability:x:private-message-detail',
    '--limited',
  ]);
  assert.notEqual(blockedDmDetail.status, 0);
  assert.match(blockedDmDetail.stderr, /cannot be enabled by ordinary confirmation/u);

  const blockedDmBody = runCapabilitiesCli([
    'confirm',
    'x-com-authorized-browser-surface',
    '--report',
    reportPath,
    '--capability',
    'capability:x:direct-message-body',
    '--limited',
  ]);
  assert.notEqual(blockedDmBody.status, 0);
  assert.match(blockedDmBody.stderr, /cannot be enabled by ordinary confirmation/u);

  assert.equal((await readFile(reportPath, 'utf8')).includes('cookie'), false);
});
