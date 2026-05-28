// @ts-check

export function summarizePrivacy(context, report) {
  const privacyMode = context.options?.privacyMode ?? context.options?.privacy ?? 'limited';
  const networkRequested = context.policy?.captureNetwork === true || context.options?.network === true;
  const rawNetworkTracesPersisted = report.summary?.network?.sanitizedSummary?.rawTracesPersisted === true
    || report.summary?.network?.rawTracesPersisted === true;
  const rawPageMaterialPages = Number(report.summary?.rawPageMaterial?.pages ?? 0);
  return {
    mode: privacyMode,
    credential_material_persisted: false,
    runtime_sensitive_material_persisted: false,
    browser_state_material_persisted: false,
    public_page_material_persisted: rawPageMaterialPages > 0,
    public_page_material_pages: rawPageMaterialPages,
    public_page_material_redacted: rawPageMaterialPages > 0,
    private_page_material_persisted: false,
    raw_network_traces_persisted: rawNetworkTracesPersisted,
    sanitized_reports: true,
    network_capture_requested: networkRequested,
    network_summary_only: networkRequested && !rawNetworkTracesPersisted,
    redaction_required: true,
    warning_codes: report.warningCodes ?? [],
  };
}
