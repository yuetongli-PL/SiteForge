#!/usr/bin/env node
// @ts-check

import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { readFile, readdir, stat } from 'node:fs/promises';
import { initializeCliUtf8 } from '../../infra/cli.mjs';
import { writeJsonFile } from '../../infra/io.mjs';
import {
  buildConfirmationPaths,
  capabilityConfirmationGroup,
  decorateCapabilityConfirmation,
  formatCapabilityCommand,
  isOrdinaryConfirmationBlocked,
} from '../../app/pipeline/build/confirmation-flow.mjs';

const HELP = `Usage:
  node src/entrypoints/cli/capabilities.mjs list <skill-id> [--status confirmation_required|disabled|enabled|all] [--report <path>] [--json]
  node src/entrypoints/cli/capabilities.mjs confirm <skill-id> (--group sensitive-read --limited | --group draft-write --draft-only | --capability <id>) [--report <path>] [--json]
  node src/entrypoints/cli/capabilities.mjs disable <skill-id> (--group <group> | --capability <id>) [--report <path>] [--json]

Notes:
  This is an internal operator entrypoint; the public CLI is siteforge build <url>.
  --manual belongs to legacy step-by-step supplemental collection.
  capabilities confirm only confirms existing sanitized structure capabilities.
  --limited is required for sensitive-read confirmation.
  Direct-message detail and message sending cannot be enabled by ordinary confirmation.
`;

const STATUS_MAP = Object.freeze({
  enabled: 'enabled_capabilities',
  confirmation_required: 'confirmation_required_capabilities',
  disabled: 'disabled_capabilities',
});

function isHelpToken(token) {
  return token === '--help' || token === '-h';
}

function splitFlag(token) {
  const text = String(token ?? '');
  const eqIndex = text.indexOf('=');
  if (eqIndex === -1) {
    return { name: text, value: null };
  }
  return { name: text.slice(0, eqIndex), value: text.slice(eqIndex + 1) };
}

export function parseCapabilitiesArgs(argv = []) {
  const [command, ...rest] = argv;
  if (!command || isHelpToken(command)) {
    return { help: true };
  }
  if (!['list', 'confirm', 'disable'].includes(command)) {
    throw new Error(`Unknown capabilities command: ${command}\n\n${HELP}`);
  }
  const options = {
    command,
    skillId: null,
    status: command === 'list' ? 'confirmation_required' : 'all',
    reportPath: null,
    group: null,
    capabilityId: null,
    json: false,
    limited: false,
    draftOnly: false,
  };
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (isHelpToken(token)) {
      return { help: true };
    }
    if (!String(token).startsWith('--')) {
      if (options.skillId) {
        throw new Error(`Unsupported argument: ${token}\n\n${HELP}`);
      }
      options.skillId = token;
      continue;
    }
    const { name, value: inlineValue } = splitFlag(token);
    const readValue = () => {
      if (inlineValue !== null) {
        return inlineValue;
      }
      if (index + 1 >= rest.length) {
        throw new Error(`Missing value for ${name}\n\n${HELP}`);
      }
      index += 1;
      return rest[index];
    };
    if (name === '--json') {
      options.json = true;
    } else if (name === '--limited') {
      options.limited = true;
    } else if (name === '--draft-only') {
      options.draftOnly = true;
    } else if (name === '--status') {
      options.status = readValue();
    } else if (name === '--report') {
      options.reportPath = readValue();
    } else if (name === '--group') {
      options.group = readValue();
    } else if (name === '--capability') {
      options.capabilityId = readValue();
    } else {
      throw new Error(`Unknown option: ${name}\n\n${HELP}`);
    }
  }
  if (!options.skillId && !options.reportPath) {
    throw new Error(`Missing <skill-id> or --report.\n\n${HELP}`);
  }
  if (!['enabled', 'confirmation_required', 'disabled', 'all'].includes(options.status)) {
    throw new Error('--status must be one of: confirmation_required, disabled, enabled, all');
  }
  return options;
}

async function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return fallback;
    }
    throw error;
  }
}

function normalizeReport(payload) {
  return payload?.user_report ?? payload?.user ?? payload ?? {};
}

function reportSkillId(report) {
  return report.skill_id ?? report.skillId ?? null;
}

async function pathExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function buildReportPathFromLastBuild(cwd, siteDir, lastBuild) {
  const buildDir = lastBuild?.buildDir
    ? path.resolve(cwd, lastBuild.buildDir)
    : lastBuild?.build_id
      ? path.join(siteDir, 'builds', lastBuild.build_id)
      : lastBuild?.buildId
        ? path.join(siteDir, 'builds', lastBuild.buildId)
        : null;
  if (!buildDir) {
    return null;
  }
  for (const name of [
    path.join(buildDir, 'reports', 'build_report.user.json'),
    path.join(buildDir, 'reports', 'user.json'),
    path.join(buildDir, 'build_report.user.json'),
  ]) {
    if (await pathExists(name)) {
      return name;
    }
  }
  return null;
}

async function findReportForSkill(cwd, skillId) {
  const sitesDir = path.join(cwd, '.siteforge', 'sites');
  if (!await pathExists(sitesDir)) {
    return null;
  }
  const siteEntries = await readdir(sitesDir, { withFileTypes: true });
  const candidates = [];
  for (const entry of siteEntries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const siteDir = path.join(sitesDir, entry.name);
    const lastBuild = await readJson(path.join(siteDir, 'last_successful_build.json'), null);
    if (lastBuild?.skillId === skillId || lastBuild?.skill_id === skillId) {
      const reportPath = await buildReportPathFromLastBuild(cwd, siteDir, lastBuild);
      if (reportPath) {
        candidates.push({ reportPath, siteDir });
      }
    }
    const buildsDir = path.join(siteDir, 'builds');
    if (!await pathExists(buildsDir)) {
      continue;
    }
    const buildEntries = await readdir(buildsDir, { withFileTypes: true });
    for (const buildEntry of buildEntries) {
      if (!buildEntry.isDirectory()) {
        continue;
      }
      const reportPath = path.join(buildsDir, buildEntry.name, 'reports', 'build_report.user.json');
      if (!await pathExists(reportPath)) {
        continue;
      }
      const report = normalizeReport(await readJson(reportPath, {}));
      if (reportSkillId(report) === skillId) {
        candidates.push({ reportPath, siteDir });
      }
    }
  }
  candidates.sort((left, right) => String(right.reportPath).localeCompare(String(left.reportPath), 'en'));
  return candidates[0] ?? null;
}

async function loadReport(options) {
  const cwd = process.cwd();
  if (options.reportPath) {
    const reportPath = path.resolve(cwd, options.reportPath);
    const report = normalizeReport(await readJson(reportPath, {}));
    return { report, reportPath, siteDir: null };
  }
  const located = await findReportForSkill(cwd, options.skillId);
  if (!located) {
    throw new Error(`No SiteForge capability report found for skill-id: ${options.skillId}`);
  }
  const report = normalizeReport(await readJson(located.reportPath, {}));
  return { ...located, report };
}

function capabilitiesForStatus(report, status = 'confirmation_required') {
  if (status === 'all') {
    return [
      ...(report.enabled_capabilities ?? []),
      ...(report.confirmation_required_capabilities ?? []),
      ...(report.disabled_capabilities ?? []),
    ];
  }
  return report[STATUS_MAP[status] ?? STATUS_MAP.confirmation_required] ?? [];
}

function selectCapabilities(report, options, skillId) {
  const all = capabilitiesForStatus(report, options.command === 'confirm' ? 'confirmation_required' : options.status)
    .map((capability) => decorateCapabilityConfirmation(capability, { skillId }));
  if (options.capabilityId) {
    return all.filter((capability) => capability.id === options.capabilityId || capability.name === options.capabilityId);
  }
  if (options.group) {
    return all.filter((capability) => capabilityConfirmationGroup(capability) === options.group);
  }
  return all;
}

function validateConfirmationSelection(capabilities, options) {
  if (!capabilities.length) {
    throw new Error('No capabilities matched the requested confirmation scope.');
  }
  for (const capability of capabilities) {
    if (isOrdinaryConfirmationBlocked(capability)) {
      throw new Error(`Capability ${capability.id ?? capability.name} cannot be enabled by ordinary confirmation.`);
    }
    const group = capabilityConfirmationGroup(capability);
    if (group === 'sensitive-read' && options.limited !== true) {
      throw new Error('Confirming sensitive-read capabilities requires --limited.');
    }
    if (group === 'draft-write' && options.draftOnly !== true) {
      throw new Error('Confirming draft-write capabilities requires --draft-only.');
    }
  }
}

function confirmationUsablePathForMode(mode) {
  const loginStateReuse = {
    strategy: 'reuse_existing_system_browser_login_state',
    status: 'ready_for_sanitized_authorized_recheck',
    reusesExistingLoginState: true,
    requiresNewLogin: false,
    userMustRemainSignedIn: true,
    browser: 'system_default_browser',
    evidenceToCollect: 'sanitized_structure_summary_only',
    cookiesPersisted: false,
    tokensPersisted: false,
    credentialsPersisted: false,
    browserProfilePersisted: false,
    rawDomPersisted: false,
    rawHtmlPersisted: false,
    rawContentPersisted: false,
    privateContentPersisted: false,
  };
  if (mode === 'limited') {
    return {
      type: 'limited_sanitized_summary_path',
      readiness: 'immediate_limited_sanitized_summary',
      resultingStatus: 'limited_enabled',
      loginStateReuse,
    };
  }
  if (mode === 'draft_only') {
    return {
      type: 'draft_only_preview_path',
      readiness: 'immediate_draft_only_preview',
      resultingStatus: 'draft_only',
      loginStateReuse,
    };
  }
  return {
    type: 'safe_confirmed_capability_path',
    readiness: 'immediate_confirmed_capability',
    resultingStatus: mode === 'disabled' ? 'disabled' : 'enabled',
    loginStateReuse,
  };
}

async function writeDecisionRecord({ loaded, skillId, command, capabilities, decision, mode }) {
  if (!loaded.siteDir) {
    return null;
  }
  const filePath = path.join(loaded.siteDir, 'capability_confirmations.json');
  const existing = await readJson(filePath, {
    schemaVersion: 1,
    skillId,
    decisions: [],
  });
  const now = new Date().toISOString();
  const decisionByKey = new Map((existing.decisions ?? []).map((entry) => [
    `${entry.capabilityId}:${entry.decision}`,
    entry,
  ]));
  const usablePath = confirmationUsablePathForMode(mode);
  for (const capability of capabilities) {
    decisionByKey.set(`${capability.id}:${decision}`, {
      capabilityId: capability.id,
      capabilityName: capability.name ?? null,
      group: capabilityConfirmationGroup(capability),
      decision,
      mode,
      usableAfterSelection: decision !== 'disabled',
      usablePathType: usablePath.type,
      usablePath,
      loginStateReuse: usablePath.loginStateReuse,
      completedBy: decision !== 'disabled' ? 'reused_user_login_state' : 'disabled_by_user_choice',
      immediateLimitedUse: decision !== 'disabled' && usablePath.readiness.startsWith('immediate_'),
      requiresSiteAdapterVerificationBeforeUse: false,
      command,
      writeActionsEnabled: false,
      finalActionsAllowed: false,
      rawMaterialAllowed: false,
      privateContentAllowed: false,
      sourceBuildId: loaded.report.build_id ?? loaded.report.buildId ?? null,
      updatedAt: now,
    });
  }
  const next = {
    schemaVersion: 1,
    skillId,
    updatedAt: now,
    decisions: [...decisionByKey.values()].sort((left, right) => (
      String(left.capabilityId).localeCompare(String(right.capabilityId), 'en')
      || String(left.decision).localeCompare(String(right.decision), 'en')
    )),
  };
  await writeJsonFile(filePath, next);
  return filePath;
}

function output(payload, json = false) {
  if (json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }
  if (payload.command === 'list') {
    process.stdout.write(`Capability report: ${payload.skill_id}\n`);
    for (const capability of payload.capabilities) {
      process.stdout.write(`- ${capability.id}: ${capability.name} [${capability.confirmation_group}]\n`);
      if (capability.next_step) {
        process.stdout.write(`  next: ${capability.next_step}\n`);
      }
    }
    if (!payload.capabilities.length) {
      process.stdout.write('- none\n');
    }
    return;
  }
  process.stdout.write(`${payload.status}: ${payload.command}\n`);
  process.stdout.write(`skill: ${payload.skill_id}\n`);
  process.stdout.write(`capabilities: ${payload.count}\n`);
  if (payload.record_path) {
    process.stdout.write(`record: ${payload.record_path}\n`);
  }
  process.stdout.write('write actions enabled: false\n');
  process.stdout.write('raw/private material allowed: false\n');
}

export async function main(argv = process.argv.slice(2)) {
  initializeCliUtf8();
  const options = parseCapabilitiesArgs(argv);
  if (options.help) {
    process.stdout.write(`${HELP}\n`);
    return 0;
  }
  const loaded = await loadReport(options);
  const skillId = options.skillId ?? reportSkillId(loaded.report);
  const paths = buildConfirmationPaths({
    skillId,
    confirmationRequiredCapabilities: loaded.report.confirmation_required_capabilities ?? [],
    disabledCapabilities: loaded.report.disabled_capabilities ?? [],
  });
  const capabilities = selectCapabilities(loaded.report, options, skillId);
  if (options.command === 'list') {
    output({
      command: 'list',
      skill_id: skillId,
      status: options.status,
      report_path: loaded.reportPath,
      confirmation_paths: paths,
      capabilities,
    }, options.json);
    return 0;
  }
  if (options.command === 'confirm') {
    validateConfirmationSelection(capabilities, options);
  }
  const command = formatCapabilityCommand([options.command, skillId, ...(options.group ? ['--group', options.group] : []), ...(options.capabilityId ? ['--capability', options.capabilityId] : []), ...(options.limited ? ['--limited'] : []), ...(options.draftOnly ? ['--draft-only'] : [])]);
  const mode = options.command === 'disable'
    ? 'disabled'
    : options.limited
      ? 'limited'
      : options.draftOnly
        ? 'draft_only'
        : 'confirmation';
  const recordPath = await writeDecisionRecord({
    loaded,
    skillId,
    command,
    capabilities,
    decision: options.command === 'disable' ? 'disabled' : 'confirmed',
    mode,
  });
  output({
    command: options.command,
    status: options.command === 'disable' ? 'recorded_disabled' : 'recorded_confirmation',
    skill_id: skillId,
    count: capabilities.length,
    mode,
    login_state_reuse: options.command === 'confirm'
      ? {
        strategy: 'reuse_existing_system_browser_login_state',
        status: 'ready_for_sanitized_authorized_recheck',
        reuses_existing_login_state: true,
        requires_new_login: false,
        cookies_persisted: false,
        tokens_persisted: false,
        browser_profile_persisted: false,
        raw_content_persisted: false,
      }
      : null,
    report_path: loaded.reportPath,
    record_path: recordPath,
    write_actions_enabled: false,
    raw_material_allowed: false,
    private_content_allowed: false,
    capabilities,
  }, options.json);
  return 0;
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(fileURLToPath(import.meta.url))) {
  main().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    process.stderr.write(`${error?.message ?? String(error)}\n`);
    process.exitCode = 1;
  });
}
