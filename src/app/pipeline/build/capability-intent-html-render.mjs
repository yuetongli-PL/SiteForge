// @ts-check

import {
  HTML_REPORT_FORBIDDEN_PATTERNS,
  HTML_REPORT_MAX_EXAMPLES,
  escapeHtml,
  htmlAuthBadge,
  htmlBadge,
  htmlCell,
  htmlList,
  htmlRiskBadge,
  htmlStatusBadge,
  sanitizeCapabilityIntentHtmlPayload,
} from './capability-intent-html-values.mjs';
import { htmlCategoryInstanceLabel } from './capability-intent-html-payload.mjs';

function renderCapabilityRows(rows = /** @type {any[]} */ ([]), emptyMessage = 'No capabilities available.') {
  if (!rows.length) {
    return `<p class="empty">${escapeHtml(emptyMessage)}</p>`;
  }
  return `<div class="table-wrapper"><table>
    <thead><tr>
      <th>Capability</th><th>ID</th><th>Action</th><th>Element / category</th><th>Status</th><th>Risk</th><th>Auth</th><th>Evidence matrix</th><th>Reason / strategy</th><th>Intent count</th>
    </tr></thead>
    <tbody>
      ${rows.map((capability) => `<tr>
        <td><strong>${htmlCell(capability.name)}</strong><br><span class="muted">${htmlCell(capability.userValue ?? capability.userFacingName)}</span></td>
        <td>${htmlCell(capability.id, { code: true })}</td>
        <td>${htmlCell(capability.action)}<br><span class="muted">${htmlCell(capability.object)}</span></td>
        <td>
          <div class="matrix-line"><span>evidenceModel</span>${htmlCell(capability.evidenceModel ?? '-', { code: true })}</div>
          <div class="matrix-line"><span>element</span>${htmlCell([capability.elementRole, capability.elementLabel].filter(Boolean).join(': ') || '-')}</div>
          <div class="matrix-line"><span>routeTemplates</span>${htmlList(capability.routeTemplates ?? [], { code: true, limit: 4 })}</div>
          <div class="matrix-line"><span>categoryInstances</span>${htmlList((capability.categoryInstances ?? []).map(htmlCategoryInstanceLabel), { code: false, limit: 4 })}</div>
          <div class="matrix-line"><span>sourceNodes</span>${htmlList(capability.sourceNodeIds ?? [], { code: true, limit: 4 })}</div>
          ${capability.publicRouteOnly ? htmlBadge('route-only summary', 'limited') : ''}
        </td>
        <td>${htmlStatusBadge(capability.status)} ${htmlStatusBadge(capability.enabledStatus)}<br><span class="muted">${htmlCell(capability.evidenceStatus)}</span></td>
        <td>${htmlRiskBadge(capability.riskLevel)}<br><span class="muted">${htmlCell(capability.safetyLevel)}</span></td>
        <td>${htmlAuthBadge(capability.authRequired ? 'required' : 'public')}<br><code>${escapeHtml(capability.sourceLayer)}</code><br><span class="muted">${htmlCell(capability.requiredEvidenceLevel)} / ${htmlCell(capability.observedEvidenceLevel)}</span></td>
        <td><div class="matrix-line"><span>requiredEvidence</span>${htmlList(capability.evidenceMatrix?.requiredEvidence ?? [])}</div><div class="matrix-line"><span>observedEvidence</span>${htmlList(capability.evidenceMatrix?.observedEvidence ?? [])}</div><div class="matrix-line"><span>missingEvidence</span>${htmlList(capability.evidenceMatrix?.missingEvidence ?? [])}</div><div>${htmlStatusBadge(capability.activationDecision)}</div></td>
        <td>${htmlCell(capability.reason)}<br><span class="muted">${htmlCell(capability.strategy)}</span></td>
        <td>${htmlCell(capability.mappedIntentCount)}</td>
      </tr>`).join('')}
    </tbody>
  </table></div>`;
}

function renderIntentRows(rows = /** @type {any[]} */ ([])) {
  if (!rows.length) {
    return '<p class="empty">No intents are available; the build may have failed before intent generation.</p>';
  }
  return `<div class="table-wrapper"><table>
    <thead><tr>
      <th>Intent</th><th>Capability</th><th>Source</th><th>Callable</th><th>Examples</th><th>Negative examples</th><th>Reason</th>
    </tr></thead>
    <tbody>
      ${rows.map((intent) => `<tr>
        <td><strong>${htmlCell(intent.canonicalUtterance)}</strong><br>${htmlCell(intent.id, { code: true })}</td>
        <td>${htmlCell(intent.capabilityName)}<br>${htmlCell(intent.capabilityId, { code: true })}</td>
        <td>
          <div class="matrix-line"><span>intentSource</span>${htmlCell(intent.intentSource ?? '-', { code: true })}</div>
          <div class="matrix-line"><span>sourceNode</span>${htmlCell(intent.sourceNodeId ?? '-', { code: true })}</div>
          <div class="matrix-line"><span>sourceLayer</span>${htmlCell(intent.sourceLayer ?? '-', { code: true })}</div>
          <div class="matrix-line"><span>categoryInstance</span>${htmlCell(intent.categoryInstance ? htmlCategoryInstanceLabel(intent.categoryInstance) : '-')}</div>
        </td>
        <td>${htmlStatusBadge(intent.callable)}<br><span class="muted">${htmlCell(intent.safetyLevel)} / ${htmlCell(intent.enabledStatus)}</span></td>
        <td>${htmlList(intent.utteranceExamples, { code: false, limit: HTML_REPORT_MAX_EXAMPLES })}</td>
        <td>${htmlList(intent.negativeExamples, { code: false, limit: HTML_REPORT_MAX_EXAMPLES })}</td>
        <td>${htmlCell(intent.reason)}${intent.safeRemediation ? `<br><span class="muted">${htmlCell(JSON.stringify(intent.safeRemediation))}</span>` : ''}</td>
      </tr>`).join('')}
    </tbody>
  </table></div>`;
}

function renderMappingRows(rows = /** @type {any[]} */ ([])) {
  if (!rows.length) {
    return '<p class="empty">No capability-intent mappings are available.</p>';
  }
  return `<div class="table-wrapper"><table>
    <thead><tr>
      <th>Capability</th><th>Status</th><th>Intent count</th><th>Canonical utterances</th><th>Element / route</th><th>Callable</th><th>Risk</th><th>Auth status</th>
    </tr></thead>
    <tbody>
      ${rows.map((row) => `<tr>
        <td><strong>${htmlCell(row.capabilityName)}</strong><br>${htmlCell(row.capabilityId, { code: true })}</td>
        <td>${htmlStatusBadge(row.capabilityStatus)} ${htmlStatusBadge(row.enabledStatus)}</td>
        <td>${htmlCell(row.intentCount)}</td>
        <td>${htmlList(row.canonicalUtterances, { code: false, limit: 6 })}</td>
        <td>${htmlCell([row.elementRole, row.elementLabel].filter(Boolean).join(': ') || '-')}<br>${htmlList(row.routeTemplates ?? [], { code: true, limit: 4 })}<br>${htmlList((row.categoryInstances ?? []).map(htmlCategoryInstanceLabel), { code: false, limit: 4 })}</td>
        <td>${htmlStatusBadge(`${row.callable} callable`)} ${htmlStatusBadge(`${row.nonCallable} non-callable`)}</td>
        <td>${htmlRiskBadge(row.riskLevel)}</td>
        <td>${htmlAuthBadge(row.authVerificationStatus)}</td>
      </tr>`).join('')}
    </tbody>
  </table></div>`;
}

function renderBrowserBridgeRouteCoverage(coverage = /** @type {any} */ ({})) {
  const bridge = coverage.browserBridge ?? {};
  if (bridge.used !== true && Number(bridge.routeCount ?? 0) <= 0) {
    return '<p class="empty">本次没有使用默认浏览器 Bridge 路由采集。</p>';
  }
  const routeResults = Array.isArray(bridge.routeResults) ? bridge.routeResults : [];
  const missing = routeResults.filter((result) => !['captured', 'captured_with_warning'].includes(String(result?.status ?? '')));
  const displayedMissing = missing.slice(0, 40);
  const omittedMissingCount = Math.max(0, missing.length - displayedMissing.length);
  const notes = [
    `默认浏览器 Bridge 最终采集 ${bridge.capturedRouteCount ?? 0}/${bridge.routeCount ?? 0} 条配置路由。`,
    `系统已自动温和重试 ${bridge.retryAttemptedRouteCount ?? 0} 条路由，重试后新增采集 ${bridge.retryCapturedRouteCount ?? 0} 条。`,
    '未采集路由只进入覆盖缺口和 route_capture_plan.json，不生成能力或意图，不声明全覆盖。',
    '系统不会绕过 robots、验证码、MFA、JS challenge、登录墙或访问控制。',
    omittedMissingCount > 0
      ? `This HTML table shows the first ${displayedMissing.length} missing routes; the full ${missing.length} route gap list is in route_capture_plan.json.`
      : null,
  ].filter(Boolean);
  const rows = [
    ['routeCoverageStatus', bridge.routeCoverageStatus ?? '-'],
    ['retryStatus', bridge.retryStatus ?? '-'],
    ['retryPasses', bridge.retryPasses ?? 0],
    ['routeQueueLimit', bridge.routeQueueLimit ?? 0],
    ['scheduledRouteCount', bridge.scheduledRouteCount ?? 0],
    ['overflowRouteCount', bridge.overflowRouteCount ?? 0],
    ['unattemptedRouteCount', bridge.unattemptedRouteCount ?? 0],
    ['routeQueueTruncated', bridge.routeQueueTruncated === true ? 'true' : 'false'],
    ['initialCapturedRouteCount', bridge.initialCapturedRouteCount ?? 0],
    ['finalCapturedRouteCount', bridge.finalCapturedRouteCount ?? bridge.capturedRouteCount ?? 0],
    ['finalMissingRouteCount', bridge.finalMissingRouteCount ?? bridge.missingRouteCount ?? 0],
  ];
  const missingTable = missing.length
    ? `<h3>未采集路由</h3><div class="table-wrapper"><table>
      <thead><tr><th>Route</th><th>Layer</th><th>Initial</th><th>Final</th><th>Reason</th><th>Retry</th></tr></thead>
      <tbody>${displayedMissing.map((route) => `<tr>
        <td>${htmlCell(route.targetRoute ?? route.routeId ?? '-', { code: true })}</td>
        <td>${htmlCell(route.sourceLayer ?? '-', { code: true })}</td>
        <td>${htmlStatusBadge(route.initialStatus ?? route.status ?? '-')}</td>
        <td>${htmlStatusBadge(route.finalStatus ?? route.status ?? '-')}</td>
        <td>${htmlCell(route.finalReasonCode ?? route.reasonCode ?? '-')}</td>
        <td>${htmlCell(`${route.retryAttemptCount ?? 0} / ${route.retryOutcome ?? 'not_attempted'}`)}</td>
      </tr>`).join('')}</tbody>
    </table></div>${omittedMissingCount > 0 ? `<p class="muted">Only the first ${displayedMissing.length} missing routes are shown here; ${omittedMissingCount} more are listed in <code>route_capture_plan.json</code>.</p>` : ''}`
    : '<p class="empty">没有未采集的 Browser Bridge 路由。</p>';
  return `
    <div class="summary-row">
      ${htmlBadge(`captured ${bridge.capturedRouteCount ?? 0}/${bridge.routeCount ?? 0}`, bridge.missingRouteCount ? 'warning' : 'success')}
      ${htmlBadge(`retry ${bridge.retryStatus ?? 'not_attempted'}`, bridge.retryCapturedRouteCount ? 'limited' : 'muted')}
      ${htmlBadge(`missing ${bridge.missingRouteCount ?? 0}`, bridge.missingRouteCount ? 'warning' : 'success')}
      ${Number(bridge.unattemptedRouteCount ?? 0) > 0 ? htmlBadge(`unattempted ${bridge.unattemptedRouteCount}`, 'warning') : ''}
    </div>
    <div class="notice-list">
      ${notes.map((note) => `<div class="notice"><p>${htmlCell(note)}</p></div>`).join('')}
    </div>
    <div class="table-wrapper compact"><table>
      <thead><tr><th>Metric</th><th>Value</th></tr></thead>
      <tbody>${rows.map(([metric, value]) => `<tr><td>${htmlCell(metric)}</td><td>${htmlCell(value)}</td></tr>`).join('')}</tbody>
    </table></div>
    ${missingTable}`;
}

function renderCoverageTable(coverage = /** @type {any} */ ({})) {
  const rows = [
    ['public pages', coverage.public?.pages ?? 0],
    ['public nodes', coverage.public?.nodes ?? 0],
    ['public capabilities', coverage.public?.capabilities ?? 0],
    ['public rendered pages', coverage.publicRendered?.pages ?? 0],
    ['public rendered nodes', coverage.publicRendered?.nodes ?? 0],
    ['public rendered capabilities', coverage.publicRendered?.capabilities ?? 0],
    ['authenticated pages', coverage.authenticated?.pages ?? 0],
    ['authenticated nodes', coverage.authenticated?.nodes ?? 0],
    ['authenticated capabilities', coverage.authenticated?.capabilities ?? 0],
    ['browser bridge routes', coverage.browserBridge?.routeCount ?? 0],
    ['browser bridge captured routes', coverage.browserBridge?.capturedRouteCount ?? 0],
    ['browser bridge missing routes', coverage.browserBridge?.missingRouteCount ?? 0],
    ['browser bridge route queue limit', coverage.browserBridge?.routeQueueLimit ?? 0],
    ['browser bridge scheduled routes', coverage.browserBridge?.scheduledRouteCount ?? 0],
    ['browser bridge overflow routes', coverage.browserBridge?.overflowRouteCount ?? 0],
    ['browser bridge unattempted routes', coverage.browserBridge?.unattemptedRouteCount ?? 0],
    ['browser bridge route queue truncated', coverage.browserBridge?.routeQueueTruncated === true ? 'true' : 'false'],
    ['browser bridge route coverage status', coverage.browserBridge?.routeCoverageStatus ?? '-'],
    ['browser bridge retry status', coverage.browserBridge?.retryStatus ?? '-'],
    ['browser bridge retry passes', coverage.browserBridge?.retryPasses ?? 0],
    ['browser bridge retry attempted routes', coverage.browserBridge?.retryAttemptedRouteCount ?? 0],
    ['browser bridge retry captured routes', coverage.browserBridge?.retryCapturedRouteCount ?? 0],
    ['overlay pages revisited', coverage.overlay?.pagesRevisited ?? 0],
    ['overlay new nodes', coverage.overlay?.newNodes ?? 0],
    ['overlay new affordances', coverage.overlay?.newAffordances ?? 0],
    ['requires-login candidates', coverage.requiresLoginButMissing?.length ?? 0],
    ['blocked by risk', coverage.blockedByRisk?.length ?? 0],
    ['blocked by auth', coverage.blockedByAuth?.length ?? 0],
  ];
  return `<div class="table-wrapper compact"><table>
    <thead><tr><th>Metric</th><th>Value</th></tr></thead>
    <tbody>${rows.map(([metric, value]) => `<tr><td>${htmlCell(metric)}</td><td>${htmlCell(value)}</td></tr>`).join('')}</tbody>
  </table></div>`;
}

function renderProviderCoverageTable(coverage = /** @type {any} */ ({})) {
  const providers = Object.entries(coverage.providers ?? {});
  if (!providers.length) {
    return '<p class="empty">No normalized evidence provider bundles were recorded.</p>';
  }
  return `<div class="table-wrapper compact"><table>
    <thead><tr><th>Provider</th><th>Status</th><th>Pages</th><th>Routes</th><th>Captured</th><th>Missing</th><th>Source layer</th><th>Auth</th><th>Runtime</th></tr></thead>
    <tbody>${providers.map(([providerId, row]) => `<tr>
      <td>${htmlCell(providerId, { code: true })}</td>
      <td>${htmlStatusBadge(row.status ?? '-')}</td>
      <td>${htmlCell(row.pages ?? 0)}</td>
      <td>${htmlCell(row.routeResults ?? 0)}</td>
      <td>${htmlCell(row.capturedRouteCount ?? 0)}</td>
      <td>${htmlCell(row.missingRouteCount ?? 0)}</td>
      <td>${htmlCell(row.sourceLayer ?? '-', { code: true })}</td>
      <td>${htmlCell(row.authMethod ?? '-', { code: true })}</td>
      <td>${htmlCell(row.runtimeMode ?? '-', { code: true })}</td>
    </tr>`).join('')}</tbody>
  </table></div>`;
}

function renderElementCoverageAudit(elementCoverage = /** @type {any} */ ({})) {
  const rows = elementCoverage.rows ?? [];
  const summary = elementCoverage.summary ?? {};
  if (!rows.length) {
    return '<p class="empty">No sanitized page element instances were available for coverage auditing.</p>';
  }
  return `
    <div class="summary-row">
      ${htmlBadge(`total ${summary.total ?? rows.length}`, 'muted')}
      ${htmlBadge(`covered ${summary.covered ?? 0}`, 'success')}
      ${htmlBadge(`graph-only ${summary.graphIntentOnly ?? 0}`, 'limited')}
      ${htmlBadge(`missing capability ${summary.missingCapability ?? 0}`, (summary.missingCapability ?? 0) ? 'warning' : 'success')}
      ${htmlBadge(`missing intent ${summary.missingIntent ?? 0}`, (summary.missingIntent ?? 0) ? 'warning' : 'success')}
    </div>
    <div class="table-wrapper"><table>
      <thead><tr>
        <th>Element</th><th>Source</th><th>Category instance</th><th>Coverage status</th><th>Mapped capabilities</th><th>Mapped intents</th>
      </tr></thead>
      <tbody>
        ${rows.map((row) => `<tr>
          <td><strong>${htmlCell([row.elementRole, row.elementLabel].filter(Boolean).join(': ') || '-')}</strong><br>${htmlCell(row.routeTemplate, { code: true })}</td>
          <td>${htmlCell(row.sourceLayer, { code: true })}<br>${htmlCell(row.nodeId, { code: true })}<br><span class="muted">${htmlCell(row.evidenceStatus)}</span></td>
          <td>${htmlCell(row.categoryInstance ? htmlCategoryInstanceLabel(row.categoryInstance) : '-')}</td>
          <td>${htmlStatusBadge(row.status)}</td>
          <td>${htmlList(row.mappedCapabilityNames?.length ? row.mappedCapabilityNames : row.mappedCapabilityIds, { code: false, limit: 5 })}</td>
          <td>${htmlList(row.mappedIntentIds ?? [], { code: true, limit: 5 })}</td>
        </tr>`).join('')}
      </tbody>
    </table></div>`;
}

function renderBlockedList(payload) {
  const blocked = payload.blocked ?? {};
  const items = [
    ...(blocked.requiresLogin ?? []).map((item) => ({
      title: item.name ?? item.id,
      text: 'This capability requires authenticated structural evidence. It remains a candidate because login was not used or not verified.',
    })),
    ...(blocked.disabledHighRisk ?? []).map((item) => ({
      title: item.name ?? item.id,
      text: 'This capability involves write actions, account changes, or high-sensitivity reads. It is disabled by default and will not auto-execute.',
    })),
    ...(blocked.missingEvidence ?? []).map((item) => ({
      title: item.name ?? item.id,
      text: 'The evidence matrix still has gaps, so this is not a callable capability.',
    })),
    ...(blocked.candidateOnly ?? []).map((item) => ({
      title: item.name ?? item.id,
      text: 'This capability is shown only as a candidate or debug summary and was not promoted into a callable Skill.',
    })),
  ];
  if (!items.length) {
    return '<p class="empty">No risk blocks or missing-evidence items were reported.</p>';
  }
  return `<div class="notice-list">${items.slice(0, 40).map((item) => `<div class="notice">
    <strong>${htmlCell(item.title)}</strong>
    <p>${htmlCell(item.text)}</p>
  </div>`).join('')}</div>`;
}

export function renderCapabilityIntentSummaryHtml(payload, options = /** @type {any} */ ({})) {
  const safe = sanitizeCapabilityIntentHtmlPayload(payload);
  const grouped = new Map();
  for (const capability of safe.capabilities ?? []) {
    const group = capability.group ?? 'unknown';
    grouped.set(group, [...(grouped.get(group) ?? []), capability]);
  }
  const groupOrder = [
    ['enabled', 'enabled'],
    ['limited_enabled', 'limited_enabled'],
    ['confirmation_required', 'confirmation_required'],
    ['draft_only', 'draft_only'],
    ['candidate', 'candidate'],
    ['disabled', 'disabled'],
    ['candidate_debug_only', 'debug_only / candidate_debug_only'],
    ['debug_only', 'debug_only'],
    ['unknown', 'other'],
  ];
  const meta = safe.meta ?? {};
  const capabilities = safe.capabilities ?? [];
  const intents = safe.intents ?? [];
  const noCapabilityIntent = capabilities.length === 0 && intents.length === 0;
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(meta.title ?? 'SiteForge Build Summary')}</title>
  <style>
    :root {
      --bg: #f6f8fb;
      --panel: #ffffff;
      --text: #182230;
      --muted: #667085;
      --border: #d9e2ec;
      --shadow: 0 8px 24px rgba(15, 23, 42, 0.08);
      --success: #0f766e;
      --limited: #2563eb;
      --warning: #b45309;
      --danger: #b91c1c;
      --auth: #6d28d9;
      --risk: #be123c;
      --code-bg: #eef2f7;
    }
    * { box-sizing: border-box; }
    body { margin: 0; font: 14px/1.55 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: var(--text); background: var(--bg); }
    header { background: linear-gradient(135deg, #111827, #1f3a5f); color: #fff; padding: 28px 20px; }
    .container { max-width: 1180px; margin: 0 auto; padding: 0 20px 32px; }
    header .container { padding-bottom: 0; }
    h1 { margin: 0 0 6px; font-size: 30px; letter-spacing: 0; }
    h2 { margin: 0 0 14px; font-size: 20px; letter-spacing: 0; }
    h3 { margin: 20px 0 10px; font-size: 16px; letter-spacing: 0; }
    .subtitle { margin: 0; color: rgba(255,255,255,0.78); }
    nav { display: flex; flex-wrap: wrap; gap: 8px; margin: 18px 0 0; }
    nav a { color: #fff; text-decoration: none; border: 1px solid rgba(255,255,255,0.28); border-radius: 8px; padding: 6px 10px; }
    section { margin-top: 22px; background: var(--panel); border: 1px solid var(--border); border-radius: 8px; box-shadow: var(--shadow); padding: 18px; }
    section > h2 { position: sticky; top: 0; background: var(--panel); padding: 4px 0 10px; z-index: 1; }
    .summary-grid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 12px; margin-top: 18px; }
    .summary-card { background: rgba(255,255,255,0.12); border: 1px solid rgba(255,255,255,0.22); border-radius: 8px; padding: 12px; }
    .summary-card span { display: block; color: rgba(255,255,255,0.72); font-size: 12px; }
    .summary-card strong { display: block; margin-top: 4px; font-size: 18px; word-break: break-word; }
    .meta-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
    .meta-item { border: 1px solid var(--border); border-radius: 8px; padding: 10px; background: #fbfdff; }
    .meta-item span { display: block; color: var(--muted); font-size: 12px; }
    .badge { display: inline-flex; align-items: center; border-radius: 999px; padding: 2px 8px; margin: 1px 2px 1px 0; font-size: 12px; font-weight: 650; background: #eef2f7; color: #344054; }
    .badge-success { background: #ccfbf1; color: var(--success); }
    .badge-limited { background: #dbeafe; color: var(--limited); }
    .badge-warning { background: #fef3c7; color: var(--warning); }
    .badge-danger { background: #fee2e2; color: var(--danger); }
    .badge-muted { background: #eef2f7; color: #475467; }
    .badge-auth { background: #ede9fe; color: var(--auth); }
    .badge-risk { background: #ffe4e6; color: var(--risk); }
    .table-wrapper { width: 100%; overflow-x: auto; border: 1px solid var(--border); border-radius: 8px; }
    .table-wrapper.compact { max-width: 720px; }
    table { width: 100%; border-collapse: collapse; min-width: 900px; background: #fff; }
    th, td { text-align: left; vertical-align: top; border-bottom: 1px solid var(--border); padding: 10px; word-break: break-word; }
    th { background: #f2f6fb; color: #344054; font-size: 12px; text-transform: uppercase; letter-spacing: 0; }
    tbody tr:nth-child(even) { background: #fbfdff; }
    tbody tr:hover { background: #f8fafc; }
    code { font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace; background: var(--code-bg); border-radius: 4px; padding: 1px 4px; }
    .muted { color: var(--muted); }
    .empty { color: var(--muted); margin: 8px 0; }
    .matrix-line { margin: 2px 0; }
    .matrix-line > span:first-child { display: inline-block; min-width: 64px; color: var(--muted); }
    .summary-row { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 12px; }
    .notice-list { display: grid; gap: 10px; }
    .notice { border: 1px solid var(--border); border-left: 4px solid var(--warning); border-radius: 8px; padding: 10px 12px; background: #fffdf7; }
    .notice p { margin: 4px 0 0; color: var(--muted); }
    @media (max-width: 860px) {
      .summary-grid, .meta-grid { grid-template-columns: 1fr; }
      header { padding: 22px 0; }
      .container { padding-left: 12px; padding-right: 12px; }
      section { padding: 14px; }
      h1 { font-size: 24px; }
    }
    @media print {
      body { background: #fff; }
      header { background: #fff; color: #000; border-bottom: 1px solid #ccc; }
      nav { display: none; }
      section { box-shadow: none; break-inside: avoid; }
      .summary-card { color: #000; border-color: #ccc; }
      .summary-card span { color: #444; }
    }
  </style>
</head>
<body>
  <header>
    <div class="container">
      <h1>${escapeHtml(meta.title ?? 'SiteForge Build Summary')}</h1>
      <p class="subtitle">${escapeHtml(meta.siteUrl)} 路 ${escapeHtml(meta.buildId)}</p>
      <nav>
        <a href="#overview">Overview</a>
        <a href="#coverage">Coverage</a>
        <a href="#evidence-providers">Evidence providers</a>
        <a href="#browser-bridge-route-coverage">Browser Bridge route coverage</a>
        <a href="#element-coverage">Element coverage</a>
        <a href="#capabilities">Capabilities</a>
        <a href="#intents">Intents</a>
        <a href="#mapping">Mapping</a>
        <a href="#blocked">Risk and gaps</a>
      </nav>
      <div class="summary-grid">
        <div class="summary-card"><span>result_status</span><strong>${escapeHtml(meta.resultStatus)}</strong></div>
        <div class="summary-card"><span>capabilities</span><strong>${escapeHtml(safe.counts?.capabilities ?? 0)}</strong></div>
        <div class="summary-card"><span>intents</span><strong>${escapeHtml(safe.counts?.intents ?? 0)}</strong></div>
        <div class="summary-card"><span>auth verification status</span><strong>${escapeHtml(meta.authVerificationStatus)}</strong></div>
        <div class="summary-card"><span>risk blocked</span><strong>${escapeHtml(safe.counts?.riskBlocked ?? 0)}</strong></div>
      </div>
    </div>
  </header>
  <main class="container">
    <section id="overview">
      <h2>构建概览</h2>
      <div class="meta-grid">
        ${[
          ['站点 URL', meta.siteUrl],
          ['siteId', meta.siteId],
          ['buildId', meta.buildId],
          ['skillId', meta.skillId],
          ['crawlMode', meta.crawlMode],
          ['authMethod', meta.authMethod],
          ['authVerificationStatus', meta.authVerificationStatus],
          ['result_status', meta.resultStatus],
          ['legacy_status', meta.legacyStatus],
          ['verification status', meta.verificationStatus],
          ['promotionClass', meta.promotionClass],
          ['runtimeMode', meta.runtimeMode],
          ['coverageStatus', meta.coverageStatus],
          ['generatedAt', meta.generatedAt],
          ['completedAt', meta.completedAt],
          ['user report', meta.paths?.userReport],
          ['debug report', meta.paths?.debugReport],
          ['index report', meta.paths?.indexReport],
          ['HTML report', meta.paths?.htmlReport],
        ].map(([label, value]) => `<div class="meta-item"><span>${escapeHtml(label)}</span><strong>${htmlCell(value)}</strong></div>`).join('')}
      </div>
    </section>
    <section id="coverage">
      <h2>覆盖率概览</h2>
      ${renderCoverageTable(safe.coverage ?? {})}
    </section>
    <section id="evidence-providers">
      <h2>Evidence Providers</h2>
      ${renderProviderCoverageTable(safe.coverage ?? {})}
    </section>
    <section id="browser-bridge-route-coverage">
      <h2>Browser Bridge Route Coverage</h2>
      ${renderBrowserBridgeRouteCoverage(safe.coverage ?? {})}
    </section>
    <section id="element-coverage">
      <h2>页面元素覆盖审计</h2>
      <p class="muted">逐项列出已保存的脱敏页面元素摘要，并标记是否已经映射为能力和意图。</p>
      ${renderElementCoverageAudit(safe.elementCoverage ?? {})}
    </section>
    <section id="capabilities">
      <h2>能力汇总</h2>
      ${noCapabilityIntent ? '<p class="empty">暂无能力和意图，构建在上游阶段失败。</p>' : ''}
      ${groupOrder.map(([group, label]) => {
        const rows = grouped.get(group) ?? [];
        if (!rows.length) return '';
        return `<h3>${escapeHtml(label)} (${rows.length})</h3>${renderCapabilityRows(rows)}`;
      }).join('')}
    </section>
    <section id="intents">
      <h2>意图汇总</h2>
      ${renderIntentRows(intents)}
    </section>
    <section id="mapping">
      <h2>Capability -> Intents</h2>
      ${renderMappingRows(safe.mappings ?? [])}
    </section>
    <section id="blocked">
      <h2>风险与阻断说明</h2>
      <p class="muted">本页只展示脱敏结构摘要。涉及写入、账号变更或证据不足的能力不会自动执行。</p>
      ${renderBlockedList(safe)}
    </section>
  </main>
</body>
</html>`;
  assertCapabilityIntentHtmlSafe(html, options);
  return html;
}

export function assertCapabilityIntentHtmlSafe(html, options = /** @type {any} */ ({})) {
  if (options.skipSafetyScan === true) {
    return;
  }
  for (const { code, pattern } of HTML_REPORT_FORBIDDEN_PATTERNS) {
    if (pattern.test(html)) {
      const error = /** @type {Error & Record<string, any>} */ (new Error(`capability-intent-html-report-unsafe: forbidden pattern ${code}`));
      error.code = 'capability-intent-html-report-unsafe';
      error.reasonCode = code;
      throw error;
    }
  }
}
