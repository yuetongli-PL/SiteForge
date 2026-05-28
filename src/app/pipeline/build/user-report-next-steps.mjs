// @ts-check

import { uniqueSortedStrings } from '../../../shared/normalize.mjs';

export function buildNextSteps({
  resultStatus,
  context,
  report,
  confirmationRequired,
  disabledCapabilities,
  confirmationPaths,
}) {
  const steps = /** @type {any[]} */ ([]);
  if (resultStatus === 'success') {
    steps.push('Use the generated skill for the enabled read-only capabilities.');
  } else if (resultStatus === 'partial_success') {
    if (report.summary?.verificationStatus === 'bridge_runtime_passed') {
      steps.push('Use the registered runtime-routed Skill: public read-only capabilities can use generic HTTP read, while captured authenticated capabilities require the SiteForge Browser Bridge extension.');
    } else if (report.summary?.verificationStatus === 'report_only_blocked') {
      steps.push('Review the report-only capabilities and intents; promotion was blocked by external access policy and runtime registry/current outputs were not updated.');
    } else {
      steps.push('Use the enabled low-risk read-only capabilities now.');
    }
    if (confirmationRequired.length) {
      if (confirmationPaths?.view_confirmation_required_command) {
        steps.push(`Review confirmation-required capabilities: ${confirmationPaths.view_confirmation_required_command}.`);
      }
      if (confirmationPaths?.sensitive_read?.command) {
        steps.push(`Confirm limited sensitive-read structure scanning: ${confirmationPaths.sensitive_read.command}.`);
      }
      if (confirmationPaths?.draft_write?.command) {
        steps.push(`Confirm draft-only preparation: ${confirmationPaths.draft_write.command}.`);
      }
    }
    if (context.options?.deep !== true) {
      steps.push('Run with --deep when you need broader static and sanitized structure discovery; this does not enable browser-rendered crawling.');
    }
    if (context.policy?.captureNetwork !== true) {
      steps.push('Enable rendered discovery when API/network capture evidence is needed; raw network capture is enabled by default for the public build command.');
    }
    if (
      context.setupProfile?.userAuthorizedEvidence?.autoDiscovery?.status === 'modeled'
      && (
        context.setupProfile.userAuthorizedEvidence.autoDiscovery.dynamicEnabled !== true
        || context.setupProfile.userAuthorizedEvidence.autoDiscovery.networkEnabled !== true
      )
    ) {
      steps.push('Internal operator deep mode: node src/entrypoints/build/run-build.mjs <url> --auto --deep --network.');
    }
    if (disabledCapabilities.length) {
      steps.push('For disabled capabilities, write a safe remediation plan: immediate entries use limited summaries or draft previews; adapter entries need explicit site adapter validation before use.');
      if (confirmationPaths?.disabled?.review_command) {
        steps.push(`Review disabled capabilities: ${confirmationPaths.disabled.review_command}.`);
      }
    }
  } else {
    const dynamicBlocked = report.reasonCode === 'dynamic-unsupported'
      || Object.values(report.stages ?? {}).some((stage) => (stage.reasonCodes ?? []).includes('dynamic-unsupported'));
    if (dynamicBlocked) {
      steps.push('For public dynamic pages, SiteForge now attempts a sanitized public rendered structure summary automatically; if the browser cannot launch, rerun with --browser-path pointing to Chrome or Chromium.');
      steps.push('If the rendered route is a challenge, CAPTCHA, login wall, or access-control page, SiteForge will keep it blocked and will not bypass it.');
    } else {
      steps.push(report.reasonAction ?? report.reason ?? 'Fix the reported blocker and rerun the build.');
    }
  }
  return uniqueSortedStrings(steps);
}
