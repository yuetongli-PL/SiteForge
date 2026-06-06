// @ts-check

import {
  decorateCapabilitySafeRemediation,
  safeRemediationPathSummary,
} from './risk-policy.mjs';

export const CONFIRMATION_FLOW_SCHEMA_VERSION = 1;

export const CONFIRMATION_GROUPS = Object.freeze({
  sensitiveRead: 'sensitive-read',
  draftWrite: 'draft-write',
  capability: 'capability',
  blocked: 'blocked',
});

function asText(value) {
  return String(value ?? '').trim();
}

function asLowerText(value) {
  return asText(value).toLowerCase();
}

function commandArg(value) {
  const text = asText(value);
  if (/^[A-Za-z0-9_./:@=\\<>-]+$/u.test(text)) {
    return text;
  }
  return `"${text.replace(/"/gu, '\\"')}"`;
}

export function formatCapabilityCommand(args = /** @type {any[]} */ ([])) {
  return ['node', 'src/entrypoints/operator/capabilities.mjs', ...args.map(commandArg)].join(' ');
}

export function isSensitiveReadCapability(capability = /** @type {any} */ ({})) {
  const riskLevel = asLowerText(capability.risk_level ?? capability.riskPolicy?.riskLevel);
  return riskLevel === 'read_personal_medium' || riskLevel === 'read_private_high';
}

export function isDraftWriteCapability(capability = /** @type {any} */ ({})) {
  const defaultPolicy = asLowerText(capability.default_policy);
  const safetyLevel = asLowerText(capability.safety_level ?? capability.safetyLevel);
  return capability.executionDisposition === 'confirm_required' || defaultPolicy === 'draft_only' || safetyLevel === 'requires_confirmation';
}

export function isForcedPrivateMessageCapability(capability = /** @type {any} */ ({})) {
  const text = [
    capability.id,
    capability.name,
    capability.user_facing_name,
    capability.userFacingName,
    capability.action,
    capability.object,
    capability.category,
  ].map(asLowerText).join(' ');
  return /direct[-_\s]?message\s+(?:detail|body|conversation|conversations?|draft)|private[-_\s]?message\s+(?:detail|body|conversation|conversations?|draft)|\bdm\s+(?:detail|body|conversation|conversations?|draft)|send direct[-_\s]?message|send private[-_\s]?message|send dm|direct message sending/u.test(text);
}

export function isOrdinaryConfirmationBlocked(capability = /** @type {any} */ ({})) {
  const status = asLowerText(capability.status);
  const enabledStatus = asLowerText(capability.enabled_status);
  if (status === 'disabled' || enabledStatus === 'disabled' || capability.executionDisposition === 'blocked') {
    return true;
  }
  const text = [
    capability.id,
    capability.name,
    capability.action,
    capability.object,
    capability.safetyLevel,
  ].map(asLowerText).join(' ');
  return /payment|purchase|checkout|billing|invoice|charge|wallet|cart|pay|delete|remove|clear|empty|wipe|overwrite|reset|destroy|purge|erase|revoke|cancel[-_\s]?(?:order|subscription)/iu.test(text);
}

export function capabilityConfirmationGroup(capability = /** @type {any} */ ({})) {
  if (isOrdinaryConfirmationBlocked(capability)) {
    return CONFIRMATION_GROUPS.blocked;
  }
  if (isSensitiveReadCapability(capability)) {
    return CONFIRMATION_GROUPS.sensitiveRead;
  }
  if (isDraftWriteCapability(capability)) {
    return CONFIRMATION_GROUPS.draftWrite;
  }
  return CONFIRMATION_GROUPS.capability;
}

export function confirmationModeForCapability(capability = /** @type {any} */ ({})) {
  const group = capabilityConfirmationGroup(capability);
  if (group === CONFIRMATION_GROUPS.sensitiveRead) {
    return 'limited';
  }
  if (group === CONFIRMATION_GROUPS.draftWrite) {
    return 'draft_only';
  }
  if (group === CONFIRMATION_GROUPS.blocked) {
    return 'blocked';
  }
  return 'confirmation';
}

export function capabilityConfirmCommand(skillId, capability = /** @type {any} */ ({})) {
  const resolvedSkillId = asText(skillId);
  if (!resolvedSkillId || isOrdinaryConfirmationBlocked(capability)) {
    return null;
  }
  const group = capabilityConfirmationGroup(capability);
  if (group === CONFIRMATION_GROUPS.sensitiveRead) {
    return formatCapabilityCommand(['confirm', resolvedSkillId, '--group', CONFIRMATION_GROUPS.sensitiveRead, '--limited']);
  }
  if (group === CONFIRMATION_GROUPS.draftWrite) {
    return formatCapabilityCommand(['confirm', resolvedSkillId, '--group', CONFIRMATION_GROUPS.draftWrite, '--draft-only']);
  }
  return formatCapabilityCommand(['confirm', resolvedSkillId, '--capability', capability.id ?? capability.name]);
}

export function capabilityNextStep(skillId, capability = /** @type {any} */ ({})) {
  const blocked = isOrdinaryConfirmationBlocked(capability);
  if (blocked) {
    const review = skillId
      ? formatCapabilityCommand(['list', skillId, '--status', 'disabled'])
      : 'node src/entrypoints/operator/capabilities.mjs list <skill-id> --status disabled';
    return `Generate a safe remediation plan after reviewing disabled capabilities with: ${review}. Immediate alternatives may be limited summary or draft preview; otherwise implement a site-specific adapter path and rerun validation. Ordinary confirmation cannot enable private-message detail, message sending, account mutation, or other forced-disabled actions.`;
  }
  if (isSensitiveReadCapability(capability)) {
    return `Confirm limited sanitized structure scanning with: ${capabilityConfirmCommand(skillId, capability)}`;
  }
  if (isDraftWriteCapability(capability)) {
    return `Confirm draft-only preparation with: ${capabilityConfirmCommand(skillId, capability)}`;
  }
  return `Confirm this capability with: ${capabilityConfirmCommand(skillId, capability)}`;
}

function preserveExistingSafeRemediation(capability = /** @type {any} */ ({})) {
  const remediation = capability.safe_remediation ?? capability.safeRemediation;
  if (!remediation || typeof remediation !== 'object') {
    return null;
  }
  const path = remediation.path
    ?? remediation.type
    ?? remediation.safe_path
    ?? remediation.safePath
    ?? capability.safe_remediation_path
    ?? capability.safeRemediationPath;
  if (!path) {
    return null;
  }
  return {
    ...capability,
    safe_remediation_path: path,
    safe_remediation: {
      ...remediation,
      path,
    },
  };
}

export function decorateCapabilityConfirmation(capability = /** @type {any} */ ({}), { skillId = null } = /** @type {any} */ ({})) {
  const group = capabilityConfirmationGroup(capability);
  const command = capabilityConfirmCommand(skillId, capability);
  const blocked = group === CONFIRMATION_GROUPS.blocked;
  const remediated = blocked
    ? preserveExistingSafeRemediation(capability) ?? decorateCapabilitySafeRemediation(capability)
    : capability;
  return {
    ...remediated,
    confirmation_group: group,
    confirmation_mode: confirmationModeForCapability(capability),
    confirm_command: command,
    next_step: command ? capabilityNextStep(skillId, capability) : capabilityNextStep(skillId, capability),
    ordinary_confirmation_allowed: !blocked,
    write_actions_enabled: false,
    ...(blocked ? { confirmation_blocked_reason: '该能力默认禁用，普通确认不能开启。' } : {}),
  };
}

function uniqueCommands(values = /** @type {any[]} */ ([])) {
  return [...new Set(values.filter(Boolean).map(asText).filter(Boolean))];
}

export function buildConfirmationPaths({
  skillId = null,
  confirmationRequiredCapabilities = /** @type {any[]} */ ([]),
  disabledCapabilities = /** @type {any[]} */ ([]),
} = /** @type {any} */ ({})) {
  const decoratedConfirmation = confirmationRequiredCapabilities.map((capability) => (
    decorateCapabilityConfirmation(capability, { skillId })
  ));
  const decoratedDisabled = disabledCapabilities.map((capability) => (
    decorateCapabilityConfirmation(capability, { skillId })
  ));
  const sensitiveReadCount = decoratedConfirmation.filter((capability) => (
    capability.confirmation_group === CONFIRMATION_GROUPS.sensitiveRead
  )).length;
  const draftWriteCount = decoratedConfirmation.filter((capability) => (
    capability.confirmation_group === CONFIRMATION_GROUPS.draftWrite
  )).length;
  const blockedDisabledCount = decoratedDisabled.filter((capability) => (
    capability.confirmation_group === CONFIRMATION_GROUPS.blocked
  )).length;
  return {
    schemaVersion: CONFIRMATION_FLOW_SCHEMA_VERSION,
    skill_id: skillId,
    view_confirmation_required_command: skillId
      ? formatCapabilityCommand(['list', skillId, '--status', 'confirmation_required'])
      : null,
    sensitive_read: {
      count: sensitiveReadCount,
      mode: 'limited',
      command: sensitiveReadCount && skillId
        ? formatCapabilityCommand(['confirm', skillId, '--group', CONFIRMATION_GROUPS.sensitiveRead, '--limited'])
        : null,
      description: 'Confirms only limited sanitized structure scanning; unsanitized/private material remains unsaved.',
    },
    draft_write: {
      count: draftWriteCount,
      mode: 'draft_only',
      command: draftWriteCount && skillId
        ? formatCapabilityCommand(['confirm', skillId, '--group', CONFIRMATION_GROUPS.draftWrite, '--draft-only'])
        : null,
      description: 'Confirms draft preparation only; final submit/send actions remain disabled.',
    },
    disabled: {
      count: decoratedDisabled.length,
      blocked_by_ordinary_confirmation: blockedDisabledCount,
      safe_remediation: safeRemediationPathSummary(decoratedDisabled),
      review_command: skillId
        ? formatCapabilityCommand(['list', skillId, '--status', 'disabled'])
        : null,
      next_step: 'Select disabled capabilities in the post-build interaction to write capability_remediation_plan.json. Immediate entries can run only as limited summary or draft preview; adapter entries require explicit site-specific adapter validation before use.',
    },
    commands: uniqueCommands([
      skillId ? formatCapabilityCommand(['list', skillId, '--status', 'confirmation_required']) : null,
      sensitiveReadCount && skillId ? formatCapabilityCommand(['confirm', skillId, '--group', CONFIRMATION_GROUPS.sensitiveRead, '--limited']) : null,
      draftWriteCount && skillId ? formatCapabilityCommand(['confirm', skillId, '--group', CONFIRMATION_GROUPS.draftWrite, '--draft-only']) : null,
      decoratedDisabled.length && skillId ? formatCapabilityCommand(['list', skillId, '--status', 'disabled']) : null,
    ]),
  };
}

export function confirmationCapabilitiesForGroup(capabilities = /** @type {any[]} */ ([]), group) {
  const normalizedGroup = asLowerText(group);
  return capabilities.filter((capability) => capabilityConfirmationGroup(capability) === normalizedGroup);
}

export function shouldSkipInStrictPrivacy(capability = /** @type {any} */ ({})) {
  return isSensitiveReadCapability(capability);
}
