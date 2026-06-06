// @ts-check

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  SITEFORGE_BUILD_STAGE_DEPENDENCIES,
  SITEFORGE_BUILD_STAGE_NAMES,
} from '../src/app/pipeline/build/stage-plan.mjs';
import {
  SITEFORGE_BUILD_STAGE_COPY,
} from '../src/app/pipeline/build/progress-copy.mjs';
import {
  siteForgeBuildStageSubsteps,
} from '../src/app/pipeline/build/stage-substeps.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const OUTPUT_PATH = path.join(REPO_ROOT, 'docs', 'siteforge-pipeline.html');

const STAGE_META = Object.freeze({
  registerSite: {
    group: 'setup',
    summary: '规范化输入 URL，解析站点身份，并创建隔离的构建工作区上下文。',
    inputs: ['输入 URL', '构建选项'],
    outputs: ['站点记录', '工作区路径', '初始构建上下文'],
    source: 'src/app/pipeline/build/pipeline.mjs',
  },
  discoverSeeds: {
    group: 'setup',
    summary: '发现规范种子页面，用于定义抓取边界和首批证据目标。',
    inputs: ['站点记录', '已知站点策略'],
    outputs: ['种子页面', '抓取边界提示'],
    source: 'src/app/pipeline/build/pipeline.mjs',
  },
  crawlStatic: {
    group: 'evidence',
    summary: '在不执行特权操作的前提下采集公开/静态页面材料和授权来源元数据。',
    inputs: ['种子页面', '抓取契约'],
    outputs: ['静态页面', '原始页面材料清单', '授权来源清单'],
    source: 'src/app/pipeline/build/source.mjs',
  },
  authStateCheck: {
    group: 'evidence',
    summary: '分类认证状态、实时访问阻断、路由覆盖和浏览器桥接就绪情况。',
    inputs: ['静态抓取证据', '设置档案'],
    outputs: ['认证状态报告', '抓取契约', '路由采集计划'],
    source: 'src/app/pipeline/build/auth-state.mjs',
  },
  crawlAuthenticated: {
    group: 'evidence',
    summary: '当策略、档案状态和用户授权允许时，采集已批准的认证页面表面。',
    inputs: ['认证状态报告', '抓取契约'],
    outputs: ['认证页面', '覆盖层页面', '会话诊断'],
    source: 'src/app/pipeline/build/browser-auth-bridge.mjs',
  },
  crawlRendered: {
    group: 'evidence',
    summary: '使用浏览器渲染材料采集静态 HTML 之外的动态页面结构。',
    inputs: ['认证抓取结果', '浏览器运行时'],
    outputs: ['渲染页面', '浏览器结构事实'],
    source: 'src/app/pipeline/build/browser-structure-collector.mjs',
  },
  discoverInteractions: {
    group: 'discovery',
    summary: '从已采集页面中提取可见链接、控件、表单和安全交互候选。',
    inputs: ['静态页面', '认证页面'],
    outputs: ['交互项', '交互诊断'],
    source: 'src/app/pipeline/build/capability-interaction.mjs',
  },
  captureNetworkTraces: {
    group: 'discovery',
    summary: '汇总渲染/浏览器会话中的网络证据，同时避免持久化原始敏感材料。',
    inputs: ['渲染页面抓取结果'],
    outputs: ['网络摘要', '追踪诊断'],
    source: 'src/app/pipeline/build/browser-auth-bridge.mjs',
  },
  apiAdapterReplay: {
    group: 'discovery',
    summary: '回放符合条件的只读 API adapter 候选，并验证其运行时绑定。',
    inputs: ['网络摘要', 'API 候选'],
    outputs: ['API 回放结果', '运行时绑定证据'],
    source: 'src/app/pipeline/build/api-request-runtime.mjs',
  },
  buildSiteGraph: {
    group: 'graph',
    summary: '将抓取、交互和 API 证据合并为规范站点能力图谱。',
    inputs: ['页面证据', '交互项', 'API 回放结果'],
    outputs: ['站点图谱'],
    source: 'src/domain/capabilities/site-capability-graph.mjs',
  },
  classifyNodes: {
    group: 'graph',
    summary: '为图谱分配页面/节点类型、风险词表和语义标签。',
    inputs: ['站点图谱'],
    outputs: ['分类图谱', '覆盖摘要'],
    source: 'src/app/pipeline/build/user-report-coverage.mjs',
  },
  extractAffordances: {
    group: 'graph',
    summary: '将分类节点和交互项转换为规范化可操作项记录。',
    inputs: ['分类图谱', '交互候选'],
    outputs: ['可操作项'],
    source: 'src/app/pipeline/build/capability-interaction.mjs',
  },
  discoverCapabilities: {
    group: 'capability',
    summary: '将可操作项提升为带策略状态和证据链的受控能力。',
    inputs: ['可操作项'],
    outputs: ['能力', '能力状态报告', '证据矩阵'],
    source: 'src/app/pipeline/build/auto-capabilities.mjs',
  },
  generateIntents: {
    group: 'capability',
    summary: '为用户侧能力审查创建意图入口和 HTML 摘要。',
    inputs: ['能力'],
    outputs: ['意图定义', '能力意图摘要 HTML'],
    source: 'src/app/pipeline/build/capability-intent-html-render.mjs',
  },
  generateSkill: {
    group: 'output',
    summary: '将已验证图谱、能力和意图编译为本地 SiteForge Skill 材料。',
    inputs: ['分类图谱', '能力', '意图'],
    outputs: ['Skill 文件', '产物契约记录'],
    source: 'src/app/pipeline/build/pipeline.mjs',
  },
  verifySkill: {
    group: 'output',
    summary: '验证生成的 Skill 内容、schema、脱敏规则和运行时契约安全性。',
    inputs: ['生成的 Skill'],
    outputs: ['验证报告', '验证状态'],
    source: 'src/app/pipeline/build/output-validation.mjs',
  },
  registerSkill: {
    group: 'output',
    summary: '将已验证构建输出提升到当前站点工作区和运行时注册表。',
    inputs: ['已验证 Skill', '产物存储'],
    outputs: ['当前 Skill 指针', '运行时注册记录'],
    source: 'src/app/pipeline/build/workspace.mjs',
  },
  writeBuildReport: {
    group: 'output',
    summary: '为完成的构建写入用户、调试、索引、覆盖和修复建议报告。',
    inputs: ['阶段记录', '阶段结果'],
    outputs: ['build_report.json', 'build_report.user.json', 'build_report.debug.json'],
    source: 'src/app/pipeline/build/user-report.mjs',
  },
});

const GROUPS = Object.freeze({
  setup: { label: '初始化', color: '#2563eb' },
  evidence: { label: '证据采集', color: '#c2410c' },
  discovery: { label: '发现分析', color: '#7c3aed' },
  graph: { label: '图谱语义', color: '#0f766e' },
  capability: { label: '能力编译', color: '#a16207' },
  output: { label: '输出注册', color: '#be123c' },
});

const STATUS_LABELS = Object.freeze({
  pending: '待执行',
  running: '执行中',
  success: '已完成',
  failed: '失败',
  blocked: '已阻断',
  skipped: '已跳过',
});

function js(value) {
  return JSON.stringify(value, null, 2).replaceAll('</script', '<\\/script');
}

function stageTitle(stageName) {
  const copy = SITEFORGE_BUILD_STAGE_COPY[stageName] ?? {};
  return copy.zh ?? copy.en ?? stageName;
}

function buildData() {
  return SITEFORGE_BUILD_STAGE_NAMES.map((stageName, index) => {
    const meta = STAGE_META[stageName] ?? {
      group: 'setup',
      summary: '该阶段尚未登记展示元数据。',
      inputs: [],
      outputs: [],
      source: 'src/app/pipeline/build/pipeline.mjs',
    };
    return {
      id: stageName,
      order: index + 1,
      title: stageTitle(stageName),
      enTitle: SITEFORGE_BUILD_STAGE_COPY[stageName]?.en ?? stageName,
      dependencies: SITEFORGE_BUILD_STAGE_DEPENDENCIES[stageName] ?? [],
      substeps: siteForgeBuildStageSubsteps(stageName),
      ...meta,
    };
  });
}

function renderHtml(stages) {
  const generatedAt = new Date().toISOString();
  const substepCount = stages.reduce((sum, stage) => sum + (stage.substeps?.length ?? 0), 0);
  return `<!doctype html>
<!-- Generated by tools/generate-pipeline-visualization.mjs; edit the generator instead. -->
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="icon" href="data:,">
  <title>SiteForge 执行流水线图</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f8fafc;
      --panel: #ffffff;
      --ink: #111827;
      --muted: #64748b;
      --line: #cbd5e1;
      --soft-line: #e2e8f0;
      --focus: #2563eb;
      --shadow: 0 14px 34px rgba(15, 23, 42, 0.10);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--ink);
      letter-spacing: 0;
    }
    header {
      padding: 28px clamp(16px, 4vw, 48px) 18px;
      border-bottom: 1px solid var(--soft-line);
      background: #ffffff;
    }
    h1 {
      margin: 0 0 10px;
      font-size: clamp(26px, 4vw, 42px);
      line-height: 1.08;
      letter-spacing: 0;
    }
    .lede {
      margin: 0;
      max-width: 940px;
      color: var(--muted);
      font-size: 15px;
      line-height: 1.7;
    }
    .meta-strip {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-top: 18px;
    }
    .pill {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      min-height: 30px;
      padding: 5px 10px;
      border: 1px solid var(--soft-line);
      border-radius: 6px;
      color: #334155;
      background: #f8fafc;
      font-size: 13px;
      white-space: nowrap;
    }
    main {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 360px;
      gap: 18px;
      padding: 18px clamp(16px, 4vw, 48px) 32px;
    }
    .board, .panel, .table-panel {
      background: var(--panel);
      border: 1px solid var(--soft-line);
      border-radius: 8px;
      box-shadow: var(--shadow);
    }
    .board {
      min-width: 0;
      overflow: hidden;
    }
    .toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 14px 16px;
      border-bottom: 1px solid var(--soft-line);
    }
    .toolbar strong {
      font-size: 14px;
    }
    .toolbar-actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      justify-content: flex-end;
    }
    button {
      min-height: 32px;
      border: 1px solid #cbd5e1;
      border-radius: 6px;
      background: #ffffff;
      color: #0f172a;
      font: inherit;
      font-size: 13px;
      cursor: pointer;
    }
    button:hover, button:focus-visible {
      border-color: var(--focus);
      outline: none;
      box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.15);
    }
    button.active {
      background: #eff6ff;
      border-color: #93c5fd;
      color: #1d4ed8;
    }
    .svg-wrap {
      overflow: auto;
      padding: 18px;
      min-height: 660px;
    }
    svg {
      display: block;
      min-width: 1140px;
      width: 100%;
      height: 820px;
    }
    .edge {
      fill: none;
      stroke: #94a3b8;
      stroke-width: 2;
      opacity: 0.72;
    }
    .edge.dimmed { opacity: 0.13; }
    .edge.active {
      stroke: var(--focus);
      stroke-width: 3;
      opacity: 1;
    }
    .node rect {
      fill: #ffffff;
      stroke: #cbd5e1;
      stroke-width: 1.4;
      rx: 8;
    }
    .node.active rect {
      stroke: var(--focus);
      stroke-width: 2.5;
      filter: drop-shadow(0 10px 18px rgba(37, 99, 235, 0.20));
    }
    .node.status-running rect {
      stroke: #2563eb;
      stroke-width: 2.2;
    }
    .node.status-success rect {
      stroke: #0f766e;
      stroke-width: 2.2;
    }
    .node.status-failed rect,
    .node.status-blocked rect {
      stroke: #b91c1c;
      stroke-width: 2.2;
    }
    .node.status-skipped rect {
      stroke: #94a3b8;
      stroke-dasharray: 5 4;
    }
    .node.dimmed {
      opacity: 0.33;
    }
    .node text {
      pointer-events: none;
      letter-spacing: 0;
    }
    .node .order {
      font-size: 12px;
      font-weight: 700;
      fill: #ffffff;
    }
    .node .title {
      font-size: 14px;
      font-weight: 700;
      fill: #0f172a;
    }
    .node .subtitle {
      font-size: 11px;
      fill: #64748b;
    }
    .node .status {
      font-size: 10px;
      font-weight: 700;
      fill: #475569;
    }
    .group-label {
      font-size: 12px;
      font-weight: 700;
      fill: #475569;
      text-transform: uppercase;
    }
    .group-line {
      stroke: #e2e8f0;
      stroke-width: 1;
    }
    .panel {
      align-self: start;
      position: sticky;
      top: 12px;
      padding: 18px;
    }
    .panel h2 {
      margin: 0 0 8px;
      font-size: 20px;
      line-height: 1.25;
      letter-spacing: 0;
    }
    .panel .stage-id {
      margin: 0 0 14px;
      color: var(--muted);
      font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
      font-size: 12px;
    }
    .panel-section {
      margin-top: 16px;
      padding-top: 14px;
      border-top: 1px solid var(--soft-line);
    }
    .panel-section h3 {
      margin: 0 0 8px;
      font-size: 13px;
      color: #334155;
      letter-spacing: 0;
    }
    .list {
      margin: 0;
      padding-left: 18px;
      color: #334155;
      font-size: 13px;
      line-height: 1.65;
    }
    .source-link {
      display: inline-flex;
      max-width: 100%;
      color: #1d4ed8;
      font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
      font-size: 12px;
      overflow-wrap: anywhere;
    }
    .legend {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 8px;
      padding: 14px 16px;
      border-top: 1px solid var(--soft-line);
    }
    .legend-item {
      display: flex;
      align-items: center;
      gap: 8px;
      color: #475569;
      font-size: 12px;
      min-width: 0;
    }
    .swatch {
      width: 10px;
      height: 10px;
      border-radius: 3px;
      flex: 0 0 auto;
    }
    .lower {
      grid-column: 1 / -1;
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(320px, 0.55fr);
      gap: 18px;
    }
    .table-panel {
      overflow: hidden;
    }
    .table-panel h2 {
      margin: 0;
      padding: 16px;
      font-size: 16px;
      border-bottom: 1px solid var(--soft-line);
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }
    th, td {
      padding: 10px 12px;
      border-bottom: 1px solid #edf2f7;
      text-align: left;
      vertical-align: top;
    }
    th {
      color: #475569;
      background: #f8fafc;
      font-size: 12px;
      font-weight: 700;
    }
    td code {
      font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
      font-size: 12px;
      color: #334155;
    }
    .note {
      margin: 0;
      padding: 16px;
      color: #475569;
      font-size: 13px;
      line-height: 1.7;
    }
    .live-strip {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      padding: 12px 16px;
      border-top: 1px solid var(--soft-line);
      color: #475569;
      font-size: 12px;
    }
    .live-dot {
      width: 8px;
      height: 8px;
      border-radius: 999px;
      background: #94a3b8;
      margin-top: 4px;
      flex: 0 0 auto;
    }
    .live-dot.on { background: #2563eb; }
    .live-dot.done { background: #0f766e; }
    .live-dot.error { background: #b91c1c; }
    .observability {
      grid-column: 1 / -1;
      overflow: hidden;
    }
    .observability-head {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 16px;
      border-bottom: 1px solid var(--soft-line);
    }
    .observability-head h2 {
      margin: 0;
      font-size: 17px;
    }
    .metrics {
      display: grid;
      grid-template-columns: repeat(6, minmax(112px, 1fr));
      gap: 10px;
      padding: 14px 16px;
      border-bottom: 1px solid var(--soft-line);
      background: #f8fafc;
    }
    .metric {
      min-width: 0;
      padding: 10px;
      border: 1px solid var(--soft-line);
      border-radius: 7px;
      background: #ffffff;
    }
    .metric span {
      display: block;
      color: #64748b;
      font-size: 11px;
      font-weight: 700;
    }
    .metric strong {
      display: block;
      margin-top: 4px;
      font-size: 20px;
      line-height: 1.1;
    }
    .tabs {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      padding: 12px 16px;
      border-bottom: 1px solid var(--soft-line);
    }
    .tabs button {
      border: 1px solid var(--soft-line);
      background: #ffffff;
      color: #334155;
    }
    .tabs button.active {
      border-color: #2563eb;
      background: #eff6ff;
      color: #1d4ed8;
    }
    .artifact-list {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
      padding: 16px;
    }
    .artifact-card {
      min-width: 0;
      border: 1px solid var(--soft-line);
      border-radius: 7px;
      padding: 12px;
      background: #ffffff;
    }
    .artifact-title {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      margin-bottom: 8px;
    }
    .artifact-title strong {
      min-width: 0;
      overflow-wrap: anywhere;
      font-size: 13px;
    }
    .artifact-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      color: #475569;
      font-size: 12px;
    }
    .tag {
      display: inline-flex;
      align-items: center;
      min-height: 20px;
      padding: 2px 6px;
      border-radius: 5px;
      background: #f1f5f9;
      color: #475569;
      font-size: 11px;
      font-weight: 700;
    }
    .empty-state {
      padding: 18px 16px;
      color: #64748b;
      font-size: 13px;
    }
    .status-badge {
      display: inline-flex;
      align-items: center;
      min-height: 22px;
      padding: 2px 7px;
      border-radius: 5px;
      background: #f1f5f9;
      color: #334155;
      font-size: 12px;
      font-weight: 700;
    }
    .substep-flow {
      display: grid;
      gap: 8px;
      margin-top: 10px;
    }
    .substep {
      display: grid;
      grid-template-columns: 28px minmax(0, 1fr) auto;
      align-items: center;
      gap: 10px;
      padding: 8px 10px;
      border: 1px solid var(--soft-line);
      border-radius: 7px;
      background: #ffffff;
    }
    .substep-index {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
      border-radius: 6px;
      background: #f1f5f9;
      color: #475569;
      font-size: 11px;
      font-weight: 700;
    }
    .substep-label {
      min-width: 0;
      color: #1f2937;
      font-size: 13px;
      line-height: 1.3;
    }
    .substep-code {
      color: #64748b;
      font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
      font-size: 11px;
      overflow-wrap: anywhere;
    }
    .substep-detail {
      display: block;
      margin-top: 4px;
      color: #64748b;
      font-size: 11px;
      line-height: 1.35;
      overflow-wrap: anywhere;
    }
    .substep-state {
      min-width: 58px;
      text-align: center;
      color: #64748b;
      font-size: 11px;
      font-weight: 700;
    }
    .substep.status-success {
      border-color: #99f6e4;
      background: #f0fdfa;
    }
    .substep.status-running {
      border-color: #bfdbfe;
      background: #eff6ff;
    }
    .substep.status-failed,
    .substep.status-blocked {
      border-color: #fecaca;
      background: #fef2f2;
    }
    .substep.status-skipped {
      border-style: dashed;
      background: #f8fafc;
    }
    @media (max-width: 980px) {
      main, .lower {
        grid-template-columns: 1fr;
      }
      .metrics,
      .artifact-list {
        grid-template-columns: 1fr;
      }
      .panel {
        position: static;
      }
      .legend {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }
    @media (max-width: 640px) {
      header, main {
        padding-left: 12px;
        padding-right: 12px;
      }
      .toolbar {
        align-items: stretch;
        flex-direction: column;
      }
      .toolbar-actions {
        justify-content: flex-start;
      }
      .legend {
        grid-template-columns: 1fr;
      }
    }
  </style>
</head>
<body>
  <header>
    <h1>SiteForge 执行流水线图</h1>
    <p class="lede">这张图从当前源码生成，展示 <code>siteforge build &lt;url&gt;</code> 的阶段顺序、跨阶段依赖、输入输出和失败传播路径。点击任意节点可以查看该阶段的职责、依赖、产物和主要源码入口。</p>
    <div class="meta-strip">
      <span class="pill">阶段 ${stages.length}</span>
      <span class="pill">内部子步骤 ${substepCount}</span>
      <span class="pill">依赖边 ${stages.reduce((sum, stage) => sum + stage.dependencies.length, 0)}</span>
      <span class="pill">数据源 stage-plan.mjs</span>
      <span class="pill">生成时间 ${generatedAt}</span>
    </div>
  </header>
  <main>
    <section class="board" aria-label="SiteForge 构建流水线图">
      <div class="toolbar">
        <strong>执行 DAG</strong>
        <div class="toolbar-actions" aria-label="图谱筛选控件">
          <button type="button" data-filter="all" class="active">全部</button>
          ${Object.entries(GROUPS).map(([id, group]) => `<button type="button" data-filter="${id}">${group.label}</button>`).join('')}
        </div>
      </div>
      <div class="svg-wrap">
        <svg id="pipelineGraph" role="img" aria-label="SiteForge 执行流水线 DAG"></svg>
      </div>
      <div class="live-strip" id="liveStrip">
        <span class="live-dot" id="liveDot" aria-hidden="true"></span>
        <span id="liveText">静态结构图。追加 <code>?state=.siteforge/.../build_state.json</code> 可切换为实时模式。</span>
      </div>
      <div class="legend">
        ${Object.entries(GROUPS).map(([id, group]) => `<div class="legend-item"><span class="swatch" style="background:${group.color}"></span><span>${group.label}</span></div>`).join('')}
      </div>
    </section>

    <aside class="panel" id="detailPanel" aria-live="polite"></aside>

    <section class="observability" aria-label="实时执行产物">
      <div class="observability-head">
        <h2>实时执行产物</h2>
        <span class="stage-id">只展示已清洗摘要，不展示原始响应体、Cookie、Token 或私密页面内容。</span>
      </div>
      <div class="metrics" id="observationMetrics"></div>
      <div class="tabs" aria-label="实时产物分类">
        <button type="button" data-observation-tab="apiDiscoveries" class="active">API 发现</button>
        <button type="button" data-observation-tab="capabilityDiscoveries">能力发现</button>
        <button type="button" data-observation-tab="executableCapabilities">可执行能力</button>
        <button type="button" data-observation-tab="apiAdapters">API Adapter</button>
        <button type="button" data-observation-tab="userIntents">用户意图</button>
      </div>
      <div class="artifact-list" id="observationList"></div>
    </section>

    <section class="lower">
      <div class="table-panel">
        <h2>阶段依赖表</h2>
        <table>
          <thead><tr><th>顺序</th><th>阶段</th><th>依赖</th><th>产物方向</th></tr></thead>
          <tbody id="dependencyRows"></tbody>
        </table>
      </div>
      <div class="table-panel">
        <h2>失败传播规则</h2>
        <p class="note"><code>runSiteForgeBuild</code> 按 <code>SITEFORGE_BUILD_STAGE_NAMES</code> 顺序执行。每个阶段运行前会检查依赖是否已经产生结果；阶段抛错时，当前阶段记录为 <code>failed</code> 或 <code>blocked</code>，后续阶段统一写入 <code>skipped</code>，然后生成失败报告。设置档案不可构建时会在 <code>registerSite</code> 阶段阻断，并跳过后续所有阶段。</p>
      </div>
    </section>
  </main>

  <script>
    const STAGES = ${js(stages)};
    const GROUPS = ${js(GROUPS)};
    const STATUS_LABELS = ${js(STATUS_LABELS)};

    const svg = document.getElementById('pipelineGraph');
    const panel = document.getElementById('detailPanel');
    const rows = document.getElementById('dependencyRows');
    const liveDot = document.getElementById('liveDot');
    const liveText = document.getElementById('liveText');
    const buttons = Array.from(document.querySelectorAll('[data-filter]'));
    const observationMetrics = document.getElementById('observationMetrics');
    const observationList = document.getElementById('observationList');
    const observationTabs = Array.from(document.querySelectorAll('[data-observation-tab]'));
    const width = 1280;
    const rowHeight = 118;
    const nodeWidth = 238;
    const nodeHeight = 76;
    const startX = 150;
    const colGap = 286;
    const lanes = ['setup', 'evidence', 'discovery', 'graph', 'capability', 'output'];
    const laneY = Object.fromEntries(lanes.map((lane, index) => [lane, 92 + (index * rowHeight)]));
    const stageById = new Map(STAGES.map((stage) => [stage.id, stage]));
    const outgoing = new Map(STAGES.map((stage) => [stage.id, []]));
    for (const stage of STAGES) {
      for (const dependency of stage.dependencies) {
        outgoing.get(dependency)?.push(stage.id);
      }
    }
    STAGES.forEach((stage) => {
      stage.x = startX + Math.floor((stage.order - 1) / 3) * colGap;
      stage.y = laneY[stage.group] ?? 92;
    });
    let liveState = null;
    let activeObservationTab = 'apiDiscoveries';

    function escapeHtml(value) {
      return String(value ?? '').replace(/[&<>"']/g, (char) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[char]);
    }

    function statusLabel(status) {
      return STATUS_LABELS[status] ?? status ?? '未知';
    }

    function hasFiniteNumber(value) {
      return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
    }

    function liveStatusLabel(status) {
      const raw = String(status ?? 'running');
      const [base, detail] = raw.split(':');
      const label = statusLabel(base);
      return detail ? \`\${label}：\${detail}\` : label;
    }

    function substepRecordMap(record) {
      const raw = record?.substeps;
      if (!raw) return new Map();
      if (Array.isArray(raw)) {
        return new Map(raw.map((entry) => [entry?.id, entry]).filter(([id]) => id));
      }
      if (typeof raw === 'object') {
        return new Map(Object.entries(raw).map(([id, value]) => [
          id,
          typeof value === 'string' ? { status: value } : value,
        ]));
      }
      return new Map();
    }

    function fallbackSubstepStatus(stageStatus, hasSubstepRecords) {
      if (hasSubstepRecords) return 'pending';
      if (stageStatus === 'success') return 'success';
      if (stageStatus === 'skipped') return 'skipped';
      if (stageStatus === 'blocked') return 'blocked';
      if (stageStatus === 'failed') return 'failed';
      return 'pending';
    }

    function renderSubsteps(stage, record) {
      const substeps = stage.substeps ?? [];
      if (!substeps.length) {
        return '<p class="stage-id">该阶段尚未定义内部子步骤契约。</p>';
      }
      const map = substepRecordMap(record);
      const activeSubstep = record?.activeSubstep ?? null;
      const stageStatus = record?.status ?? 'pending';
      return \`
        <div class="substep-flow">
          \${substeps.map((substep) => {
            const live = map.get(substep.id) ?? null;
            const status = live?.status ?? (activeSubstep === substep.id ? 'running' : fallbackSubstepStatus(stageStatus, map.size > 0));
            const details = [
              live?.message,
              live?.currentItem ? \`当前：\${live.currentItem}\` : null,
              hasFiniteNumber(live?.processedCount) ? \`已处理：\${live.processedCount}\` : null,
              hasFiniteNumber(live?.totalCount) ? \`总数：\${live.totalCount}\` : null,
              hasFiniteNumber(live?.discoveredCount) ? \`已发现：\${live.discoveredCount}\` : null,
              hasFiniteNumber(live?.skippedCount) ? \`已跳过：\${live.skippedCount}\` : null,
              hasFiniteNumber(live?.elapsedMs) ? \`耗时：\${Math.round(Number(live.elapsedMs) / 1000)}s\` : null,
            ].filter(Boolean).join(' · ');
            return \`
              <div class="substep status-\${escapeHtml(status)}">
                <span class="substep-index">\${String(substep.order).padStart(2, '0')}</span>
                <span class="substep-label">\${escapeHtml(substep.label)}<br><span class="substep-code">\${escapeHtml(substep.id)}</span>\${details ? \`<span class="substep-detail">\${escapeHtml(details)}</span>\` : ''}</span>
                <span class="substep-state">\${escapeHtml(statusLabel(status))}</span>
              </div>
            \`;
          }).join('')}
        </div>
      \`;
    }

    function el(name, attrs = {}, children = []) {
      const node = document.createElementNS('http://www.w3.org/2000/svg', name);
      for (const [key, value] of Object.entries(attrs)) {
        node.setAttribute(key, String(value));
      }
      for (const child of children) {
        node.append(child);
      }
      return node;
    }

    function textNode(value, attrs = {}) {
      const text = el('text', attrs);
      text.textContent = value;
      return text;
    }

    function curve(from, to) {
      const x1 = from.x + nodeWidth;
      const y1 = from.y + nodeHeight / 2;
      const x2 = to.x;
      const y2 = to.y + nodeHeight / 2;
      const mid = Math.max(42, (x2 - x1) / 2);
      return \`M \${x1} \${y1} C \${x1 + mid} \${y1}, \${x2 - mid} \${y2}, \${x2} \${y2}\`;
    }

    function relatedIds(stageId) {
      const related = new Set([stageId]);
      const stage = stageById.get(stageId);
      for (const dependency of stage?.dependencies ?? []) related.add(dependency);
      for (const next of outgoing.get(stageId) ?? []) related.add(next);
      return related;
    }

    function renderGraph(activeId = STAGES[0]?.id, filter = 'all') {
      svg.innerHTML = '';
      svg.setAttribute('viewBox', \`0 0 \${width} 820\`);
      svg.setAttribute('preserveAspectRatio', 'xMinYMin meet');

      svg.append(el('defs', {}, [
        el('marker', {
          id: 'arrow',
          viewBox: '0 0 10 10',
          refX: '8',
          refY: '5',
          markerWidth: '6',
          markerHeight: '6',
          orient: 'auto-start-reverse',
        }, [el('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: '#94a3b8' })]),
        el('marker', {
          id: 'arrowActive',
          viewBox: '0 0 10 10',
          refX: '8',
          refY: '5',
          markerWidth: '7',
          markerHeight: '7',
          orient: 'auto-start-reverse',
        }, [el('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: '#2563eb' })]),
      ]));

      for (const lane of lanes) {
        const y = laneY[lane] - 26;
        svg.append(el('line', { x1: 28, y1: y, x2: width - 28, y2: y, class: 'group-line' }));
        svg.append(textNode(GROUPS[lane].label, { x: 34, y: y - 8, class: 'group-label' }));
      }

      const activeRelated = activeId ? relatedIds(activeId) : new Set();
      const edgeLayer = el('g', { class: 'edges' });
      for (const stage of STAGES) {
        for (const dependency of stage.dependencies) {
          const from = stageById.get(dependency);
          if (!from) continue;
          const isActive = activeId && (stage.id === activeId || dependency === activeId);
          const dimmed = filter !== 'all' && stage.group !== filter && from.group !== filter;
          edgeLayer.append(el('path', {
            d: curve(from, stage),
            class: \`edge\${isActive ? ' active' : ''}\${dimmed ? ' dimmed' : ''}\`,
            markerEnd: isActive ? 'url(#arrowActive)' : 'url(#arrow)',
            'data-from': dependency,
            'data-to': stage.id,
          }));
        }
      }
      svg.append(edgeLayer);

      const nodeLayer = el('g', { class: 'nodes' });
      for (const stage of STAGES) {
        const isActive = stage.id === activeId;
        const dimmed = (filter !== 'all' && stage.group !== filter) || (activeId && !activeRelated.has(stage.id));
        const status = liveState?.stageRecords?.[stage.id]?.status ?? 'pending';
        const group = el('g', {
          class: \`node status-\${status}\${isActive ? ' active' : ''}\${dimmed ? ' dimmed' : ''}\`,
          transform: \`translate(\${stage.x}, \${stage.y})\`,
          tabindex: '0',
          role: 'button',
          'aria-label': \`\${stage.order}. \${stage.title}\`,
          'data-id': stage.id,
        });
        group.append(el('rect', { width: nodeWidth, height: nodeHeight }));
        group.append(el('rect', {
          x: 12,
          y: 12,
          width: 30,
          height: 24,
          rx: 6,
          fill: GROUPS[stage.group].color,
          stroke: 'none',
        }));
        group.append(textNode(String(stage.order).padStart(2, '0'), { x: 20, y: 29, class: 'order' }));
        group.append(textNode(stage.title, { x: 54, y: 28, class: 'title' }));
        group.append(textNode(stage.id, { x: 54, y: 48, class: 'subtitle' }));
        group.append(textNode(GROUPS[stage.group].label, { x: 54, y: 64, class: 'subtitle' }));
        if (status !== 'pending') {
          group.append(textNode(statusLabel(status), { x: 176, y: 64, class: 'status' }));
        }
        group.addEventListener('click', () => setActive(stage.id));
        group.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            setActive(stage.id);
          }
        });
        nodeLayer.append(group);
      }
      svg.append(nodeLayer);
    }

    function renderPanel(stageId) {
      const stage = stageById.get(stageId) ?? STAGES[0];
      const dependencies = stage.dependencies.length ? stage.dependencies : ['无'];
      const nextStages = outgoing.get(stage.id)?.length ? outgoing.get(stage.id) : ['无'];
      const record = liveState?.stageRecords?.[stage.id] ?? null;
      const liveStatus = record?.status ?? 'pending';
      const liveSummary = record ? \`
        <div class="panel-section">
          <h3>实时状态</h3>
          <p><span class="status-badge">\${escapeHtml(statusLabel(liveStatus))}</span></p>
          \${record.startedAt ? \`<p class="stage-id">开始时间：\${escapeHtml(record.startedAt)}</p>\` : ''}
          \${record.finishedAt ? \`<p class="stage-id">结束时间：\${escapeHtml(record.finishedAt)}</p>\` : ''}
          \${record.reasonCode ? \`<p class="stage-id">原因码：\${escapeHtml(record.reasonCode)}</p>\` : ''}
          \${Array.isArray(record.warnings) && record.warnings.length ? \`<ul class="list">\${record.warnings.slice(0, 3).map((item) => \`<li>\${escapeHtml(item)}</li>\`).join('')}</ul>\` : ''}
        </div>
      \` : '';
      panel.innerHTML = \`
        <h2>\${escapeHtml(stage.order)}. \${escapeHtml(stage.title)}</h2>
        <p class="stage-id">\${escapeHtml(stage.id)} · \${escapeHtml(GROUPS[stage.group].label)}</p>
        <p>\${escapeHtml(stage.summary)}</p>
        \${liveSummary}
        <div class="panel-section">
          <h3>内部流水线</h3>
          \${renderSubsteps(stage, record)}
        </div>
        <div class="panel-section">
          <h3>输入</h3>
          <ul class="list">\${stage.inputs.map((item) => \`<li>\${escapeHtml(item)}</li>\`).join('')}</ul>
        </div>
        <div class="panel-section">
          <h3>输出</h3>
          <ul class="list">\${stage.outputs.map((item) => \`<li>\${escapeHtml(item)}</li>\`).join('')}</ul>
        </div>
        <div class="panel-section">
          <h3>依赖</h3>
          <ul class="list">\${dependencies.map((item) => \`<li><code>\${escapeHtml(item)}</code></li>\`).join('')}</ul>
        </div>
        <div class="panel-section">
          <h3>后续阶段</h3>
          <ul class="list">\${nextStages.map((item) => \`<li><code>\${escapeHtml(item)}</code></li>\`).join('')}</ul>
        </div>
        <div class="panel-section">
          <h3>主要源码</h3>
          <span class="source-link">\${escapeHtml(stage.source)}</span>
        </div>
      \`;
    }

    function valueOrDash(value) {
      const text = String(value ?? '').trim();
      return text || '-';
    }

    function boolLabel(value) {
      return value === true ? '是' : value === false ? '否' : '-';
    }

    function renderTags(tags) {
      return tags
        .filter((tag) => tag && tag.value !== null && tag.value !== undefined && tag.value !== '')
        .map((tag) => \`<span class="tag">\${escapeHtml(tag.label)}：\${escapeHtml(tag.value)}</span>\`)
        .join('');
    }

    function observationItems() {
      return liveState?.observations?.[activeObservationTab] ?? [];
    }

    function renderObservationCard(item, index) {
      if (activeObservationTab === 'apiDiscoveries') {
        return \`
          <article class="artifact-card">
            <div class="artifact-title">
              <strong>\${escapeHtml(item.method ?? 'GET')} \${escapeHtml(valueOrDash(item.endpoint))}</strong>
              <span class="status-badge">\${escapeHtml(valueOrDash(item.status))}</span>
            </div>
            <div class="artifact-meta">\${renderTags([
              { label: '阶段', value: item.stage },
              { label: '来源', value: item.source },
              { label: '主机', value: item.host },
              { label: '回放', value: item.replayStatus },
              { label: '证据', value: item.evidenceRef },
            ])}</div>
          </article>
        \`;
      }
      if (activeObservationTab === 'capabilityDiscoveries') {
        return \`
          <article class="artifact-card">
            <div class="artifact-title">
              <strong>\${escapeHtml(valueOrDash(item.name ?? item.id))}</strong>
              <span class="status-badge">\${escapeHtml(valueOrDash(item.status))}</span>
            </div>
            <div class="artifact-meta">\${renderTags([
              { label: '能力 ID', value: item.id },
              { label: '启用', value: item.enabledStatus },
              { label: '安全级别', value: item.safetyLevel },
              { label: '风险', value: item.riskLevel },
              { label: '证据', value: item.evidenceStatus },
              { label: '执行计划', value: boolLabel(item.hasExecutionPlan) },
              { label: 'API 支撑', value: boolLabel(item.apiBacked) },
            ])}</div>
          </article>
        \`;
      }
      if (activeObservationTab === 'executableCapabilities') {
        return \`
          <article class="artifact-card">
            <div class="artifact-title">
              <strong>\${escapeHtml(valueOrDash(item.capabilityName ?? item.capabilityId ?? item.id))}</strong>
              <span class="status-badge">\${escapeHtml(valueOrDash(item.mode ?? item.runtimeMode))}</span>
            </div>
            <div class="artifact-meta">\${renderTags([
              { label: '计划 ID', value: item.id },
              { label: '能力 ID', value: item.capabilityId },
              { label: '步骤', value: item.stepCount },
              { label: '首步骤', value: item.firstStep },
              { label: '需确认', value: boolLabel(item.requiresConfirmation) },
              { label: '自动执行', value: boolLabel(item.autoExecute) },
              { label: 'API 支撑', value: boolLabel(item.apiBacked) },
            ])}</div>
          </article>
        \`;
      }
      if (activeObservationTab === 'apiAdapters') {
        return \`
          <article class="artifact-card">
            <div class="artifact-title">
              <strong>\${escapeHtml(valueOrDash(item.id))}</strong>
              <span class="status-badge">\${escapeHtml(valueOrDash(item.status))}</span>
            </div>
            <div class="artifact-meta">\${renderTags([
              { label: '请求', value: \`\${item.method ?? 'GET'} \${item.endpoint ?? '-'}\` },
              { label: '绑定', value: item.runtimeBindingId },
              { label: '参数来源', value: item.runtimeParameterSource },
              { label: '认证边界', value: item.authBoundary },
              { label: '语义', value: item.semantics },
              { label: '证据', value: item.evidenceRef },
            ])}</div>
          </article>
        \`;
      }
      return \`
        <article class="artifact-card">
          <div class="artifact-title">
            <strong>\${escapeHtml(valueOrDash(item.canonicalUtterance ?? item.name ?? item.id))}</strong>
            <span class="status-badge">\${escapeHtml(item.callable === false ? '不可调用' : '可调用')}</span>
          </div>
          <div class="artifact-meta">\${renderTags([
            { label: '意图 ID', value: item.id },
            { label: '能力 ID', value: item.capabilityId },
            { label: '示例', value: item.example },
            { label: '安全级别', value: item.safetyLevel },
            { label: '运行模式', value: item.runtimeMode },
          ])}</div>
        </article>
      \`;
    }

    function renderObservations() {
      const observations = liveState?.observations ?? {};
      const summary = observations.summary ?? {};
      const metrics = [
        ['API 发现', summary.apiDiscoveries ?? 0],
        ['API Adapter', summary.apiAdapters ?? 0],
        ['能力发现', summary.capabilities ?? 0],
        ['可执行能力', summary.executableCapabilities ?? 0],
        ['API 可执行', summary.apiExecutableCapabilities ?? 0],
        ['用户意图', summary.userIntents ?? 0],
      ];
      observationMetrics.innerHTML = metrics.map(([label, value]) => \`
        <div class="metric"><span>\${escapeHtml(label)}</span><strong>\${escapeHtml(value)}</strong></div>
      \`).join('');
      const items = observationItems();
      observationList.innerHTML = items.length
        ? items.map((item, index) => renderObservationCard(item, index)).join('')
        : '<p class="empty-state">当前还没有该类实时产物。随着采集、发现和构建阶段推进，这里会自动出现已清洗摘要。</p>';
    }

    function renderRows() {
      rows.innerHTML = STAGES.map((stage) => {
        const deps = stage.dependencies.length ? stage.dependencies.map((dep) => \`<code>\${escapeHtml(dep)}</code>\`).join(', ') : '无';
        const outputs = stage.outputs.map((item) => escapeHtml(item)).join(', ');
        return \`<tr><td>\${stage.order}</td><td><code>\${escapeHtml(stage.id)}</code><br>\${escapeHtml(stage.title)}</td><td>\${deps}</td><td>\${outputs}</td></tr>\`;
      }).join('');
    }

    let activeId = STAGES[0]?.id;
    let activeFilter = 'all';

    function setActive(stageId) {
      activeId = stageId;
      renderGraph(activeId, activeFilter);
      renderPanel(activeId);
    }

    buttons.forEach((button) => {
      button.addEventListener('click', () => {
        activeFilter = button.dataset.filter ?? 'all';
        buttons.forEach((item) => item.classList.toggle('active', item === button));
        renderGraph(activeId, activeFilter);
      });
    });

    observationTabs.forEach((button) => {
      button.addEventListener('click', () => {
        activeObservationTab = button.dataset.observationTab ?? 'apiDiscoveries';
        observationTabs.forEach((item) => item.classList.toggle('active', item === button));
        renderObservations();
      });
    });

    function liveStateUrl() {
      const params = new URLSearchParams(window.location.search);
      const value = params.get('state');
      if (!value) return null;
      if (/^[a-z][a-z0-9+.-]*:/iu.test(value) || value.startsWith('./') || value.startsWith('../')) {
        return new URL(value, window.location.href).toString();
      }
      const rootRelative = value.startsWith('/') ? value : \`/\${value}\`;
      return new URL(rootRelative, window.location.origin).toString();
    }

    function summarizeLiveState(state) {
      const records = Object.values(state?.stageRecords ?? {});
      const counts = records.reduce((acc, record) => {
        const status = record?.status ?? 'pending';
        acc[status] = (acc[status] ?? 0) + 1;
        return acc;
      }, {});
      const parts = Object.entries(counts).map(([status, count]) => \`\${statusLabel(status)}：\${count}\`);
      return parts.length ? parts.join(' · ') : '等待阶段状态';
    }

    async function pollLiveState() {
      const url = liveStateUrl();
      if (!url) return;
      try {
        const response = await fetch(\`\${url}\${url.includes('?') ? '&' : '?'}t=\${Date.now()}\`, { cache: 'no-store' });
        if (!response.ok) throw new Error(\`HTTP \${response.status}\`);
        liveState = await response.json();
        const terminal = liveState?.phase === 'outputs' || liveState?.status === 'success' || liveState?.status === 'failed' || liveState?.status === 'blocked';
        liveDot.className = \`live-dot \${terminal ? (liveState?.status === 'failed' || liveState?.status === 'blocked' ? 'error' : 'done') : 'on'}\`;
        liveText.textContent = \`实时模式：\${liveStatusLabel(liveState?.status)} · \${summarizeLiveState(liveState)}\`;
        renderGraph(activeId, activeFilter);
        renderPanel(activeId);
        renderObservations();
        if (!terminal) {
          window.setTimeout(pollLiveState, 900);
        }
      } catch (error) {
        liveDot.className = 'live-dot error';
        liveText.textContent = \`实时状态读取失败：\${error?.message ?? String(error)}\`;
        window.setTimeout(pollLiveState, 1600);
      }
    }

    renderRows();
    setActive(activeId);
    renderObservations();
    pollLiveState();
  </script>
</body>
</html>
`;
}

await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
await writeFile(OUTPUT_PATH, renderHtml(buildData()), 'utf8');
console.log(`Wrote ${path.relative(REPO_ROOT, OUTPUT_PATH)}`);
