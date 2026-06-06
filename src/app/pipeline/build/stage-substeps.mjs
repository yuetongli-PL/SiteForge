// @ts-check

const defineSubsteps = (entries) => Object.freeze(Object.fromEntries(
  Object.entries(entries).map(([stageName, substeps]) => [
    stageName,
    Object.freeze(substeps.map(([id, label], index) => Object.freeze({
      id,
      label,
      order: index + 1,
    }))),
  ]),
));

export const SITEFORGE_BUILD_STAGE_SUBSTEPS = defineSubsteps({
  registerSite: [
    ['normalizeInput', '规范化输入 URL'],
    ['resolveIdentity', '解析站点标识和主机键'],
    ['createWorkspace', '创建隔离站点工作区'],
    ['loadPolicy', '合并构建策略默认值'],
  ],
  discoverSeeds: [
    ['loadKnownPolicy', '加载已知站点策略'],
    ['readSitemaps', '读取 sitemap 和注册候选'],
    ['rankSeeds', '排序规范种子 URL'],
    ['emitBoundary', '输出抓取边界提示'],
  ],
  crawlStatic: [
    ['prepareQueue', '准备公开抓取队列'],
    ['checkRobots', '应用 robots 和访问策略'],
    ['fetchPages', '抓取受限静态页面'],
    ['sanitizeMaterial', '清洗页面材料'],
    ['writeManifests', '写入原始材料和来源清单'],
  ],
  authStateCheck: [
    ['readSetupProfile', '读取设置档案和认证提示'],
    ['classifyAccess', '分类公开/认证访问状态'],
    ['detectBlockers', '识别 robots、挑战和登录阻断'],
    ['planRoutes', '生成路由采集计划'],
    ['writeAuthReport', '写入认证状态报告'],
  ],
  crawlAuthenticated: [
    ['prepareSession', '准备受控浏览器/会话运行时'],
    ['openRoutes', '打开已批准路由队列'],
    ['collectStructure', '采集清洗后的同站结构'],
    ['mergeBridgeDiagnostics', '合并桥接诊断'],
    ['summarizeAuthenticatedPages', '汇总认证页面证据'],
  ],
  crawlRendered: [
    ['selectRenderedTargets', '选择动态渲染目标'],
    ['launchBrowserRuntime', '使用浏览器运行时读取页面状态'],
    ['captureRenderedFacts', '采集渲染后的结构事实'],
    ['dedupeRenderedPages', '去重渲染页面证据'],
  ],
  discoverInteractions: [
    ['scanLinks', '扫描链接和导航控件'],
    ['scanControls', '扫描按钮、表单和可操作提示'],
    ['classifySafeActions', '分类安全交互候选'],
    ['writeDiagnostics', '写入交互诊断'],
  ],
  captureNetworkTraces: [
    ['checkCapturePolicy', '检查网络采集策略'],
    ['collectRequests', '采集受限请求摘要'],
    ['redactSensitiveHeaders', '脱敏敏感头和令牌'],
    ['summarizeOperations', '汇总 API 操作候选'],
  ],
  apiAdapterReplay: [
    ['loadCandidates', '加载 API adapter 候选'],
    ['applyReadonlyPolicy', '应用只读运行策略'],
    ['replayRequests', '回放符合条件的请求'],
    ['validateBindings', '验证运行时绑定'],
  ],
  buildSiteGraph: [
    ['mergePages', '合并静态、渲染和认证页面'],
    ['mergeInteractions', '附加交互证据'],
    ['mergeApiEvidence', '附加 API 回放证据'],
    ['validateGraph', '验证图谱结构'],
  ],
  classifyNodes: [
    ['assignPageTypes', '分配页面和路由类型'],
    ['mapRiskVocabulary', '映射风险词表'],
    ['summarizeCoverage', '汇总覆盖缺口'],
    ['emitClassifiedGraph', '输出分类图谱'],
  ],
  extractAffordances: [
    ['normalizeControls', '规范化控件和链接'],
    ['bindEvidence', '绑定可操作项与证据引用'],
    ['dedupeAffordances', '去重重复可操作项'],
    ['emitAffordances', '输出可操作项列表'],
  ],
  discoverCapabilities: [
    ['promoteAffordances', '将可操作项提升为能力'],
    ['evaluatePolicy', '评估策略状态'],
    ['buildEvidenceMatrix', '构建证据矩阵'],
    ['writeStateReport', '写入能力状态报告'],
  ],
  generateIntents: [
    ['mapIntents', '将能力映射为意图入口'],
    ['buildPayloads', '构造意图载荷示例'],
    ['renderSummary', '渲染能力意图摘要'],
    ['writeIntentArtifacts', '写入意图产物'],
  ],
  compileExecutionContracts: [
    ['collectPlans', 'Collect capability execution plans'],
    ['buildContracts', 'Compile redacted execution contracts'],
    ['attachGraphRefs', 'Attach capability and intent contract refs'],
    ['writeContractArtifacts', 'Write execution contract artifacts'],
  ],
  evaluateExecutionGovernance: [
    ['evaluateRuntimePolicy', 'Evaluate Runtime execution governance'],
    ['classifyDestructiveActions', 'Classify high-risk and destructive actions'],
    ['writeGovernanceArtifact', 'Write execution governance artifact'],
  ],
  dispatchGovernedRuntime: [
    ['selectTaskContract', 'Select task execution contract'],
    ['preflightRuntimeDispatch', 'Preflight governed Runtime dispatch'],
    ['writeDispatchAudit', 'Write Runtime report and audit log'],
  ],
  generateSkill: [
    ['compileDescriptor', '编译 Skill 描述文件'],
    ['writeRuntimeFiles', '写入运行时和文档文件'],
    ['copyVerifiedEvidence', '复制已验证证据引用'],
    ['sealDraftSkill', '封存草稿 Skill 目录'],
  ],
  verifySkill: [
    ['validateSchemas', '验证 schema 和清单'],
    ['checkRedaction', '检查脱敏和产物保护'],
    ['runContractChecks', '运行运行时契约检查'],
    ['writeVerificationReport', '写入验证报告'],
  ],
  registerSkill: [
    ['promoteCurrent', '将已验证构建提升为当前版本'],
    ['updateRegistry', '更新运行时注册表'],
    ['writeLookup', '写入 Skill 查找元数据'],
    ['summarizePromotion', '汇总发布结果'],
  ],
  writeBuildReport: [
    ['buildUserReport', '生成用户报告'],
    ['writeMarkdown', '写入 Markdown 摘要'],
    ['buildDebugReport', '生成调试报告'],
    ['writeIndexReport', '写入报告索引'],
  ],
});

export function siteForgeBuildStageSubsteps(stageName) {
  return SITEFORGE_BUILD_STAGE_SUBSTEPS[stageName] ?? Object.freeze([]);
}

export function createStageSubstepRecords(stageName, status = 'pending') {
  return Object.fromEntries(siteForgeBuildStageSubsteps(stageName).map((substep) => [
    substep.id,
    {
      id: substep.id,
      label: substep.label,
      order: substep.order,
      status,
      startedAt: null,
      completedAt: null,
      reasonCode: null,
      message: null,
      currentItem: null,
      processedCount: null,
      totalCount: null,
      discoveredCount: null,
      skippedCount: null,
      elapsedMs: null,
      warnings: [],
      errors: [],
    },
  ]));
}
