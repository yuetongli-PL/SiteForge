# SiteForge

**SiteForge 是一个让 AI 学会理解和使用真实网站的本地工具。**

它会把一个网站的页面、按钮、搜索入口、内容结构、登录状态、风险提示和可用操作，整理成 AI 可以理解的“网站能力说明”。

普通用户可以把它理解成：

> SiteForge 不是普通爬虫，也不是一次性自动化脚本。它更像是一个“网站能力翻译器”：把真实网站转换成 AI 可以安全理解、规划和复用的能力地图。

---

## SiteForge 解决了什么问题？

很多 AI 或自动化脚本在使用网站时都会遇到同样的问题：

- 网站一改版，脚本就失效。
- 页面能不能操作，AI 并不知道。
- 需要登录、验证码、权限限制或风控时，失败原因不清楚。
- 不同网站要重复写大量临时脚本。
- cookie、token、浏览器资料等敏感信息容易被错误保存或传递。

SiteForge 解决的就是这些问题。

它不是让 AI 盲目操作网站，而是先帮助 AI 理解：

```text
这个网站有哪些页面？
可以搜索什么？
可以打开哪些内容？
哪些操作需要登录？
哪些操作需要用户确认？
哪些地方存在访问限制或风控？
哪些下载是允许的？
失败时应该如何解释？
```

最终，SiteForge 会把这些信息整理成结构化知识、能力图和本地 Skill，让 AI 后续可以更稳定、更安全地使用这个网站。

---

## 用一句话说明

**SiteForge 把真实网站转换成 AI 可理解、可规划、可复用的网站能力层。**

---

## 它最终产出什么？

一次网站适配后，SiteForge 通常会产出这些内容：

| 产物 | 作用 |
| --- | --- |
| 网站知识库 | 记录网站页面、结构、流程、交互和恢复说明。 |
| Site Capability Graph | 把网站、页面、能力、风险、登录要求和可用路线整理成能力图。 |
| Planner dry-run 结果 | 判断用户意图应该使用哪个能力、是否需要登录、是否有风险、是否可以继续。 |
| Compile Summary | 保存 Graph / Planner 的编译摘要，供 Skill 生成使用。 |
| 本地 Skill | 给 AI 使用的网站说明和操作规则。 |
| 下载计划与运行报告 | 在站点允许的情况下，生成低权限、可审计的下载任务。 |

---

## 它适合谁？

SiteForge 适合想让 AI 更可靠地处理网站任务的用户。

例如：

```text
想让 AI 理解某个网站怎么用
想为一个网站生成本地 AI Skill
想诊断网站自动化为什么失败
想把网站搜索、浏览、下载等流程整理成可复用能力
想避免 AI 直接接触 cookie、token、浏览器 profile 等敏感信息
```

它不适合这些用途：

```text
绕过验证码
绕过登录限制
绕过平台风控
绕过付费墙或权限控制
偷偷保存 cookie、token 或浏览器资料
```

SiteForge 的目标是让网站自动化更稳定、更可解释、更可审计，而不是绕过网站的安全边界。

---

## SiteForge 如何工作？

SiteForge 会按几个步骤处理网站。

```text
1. 观察网站
   打开网页，记录页面结构、链接、按钮、搜索入口和网络请求。

2. 分析网站
   判断哪些是首页、搜索页、详情页、内容页、登录页或限制页面。

3. 整理能力
   把网站能做的事整理成能力，例如搜索、打开内容、查看作者、下载公开资源等。

4. 构建能力图
   把网站、页面、能力、风险、登录要求和可用路线整理成 Site Capability Graph。

5. 规划使用方式
   Planner Layer 会判断某个用户意图应该使用哪个能力、是否需要登录、是否有风险、是否可以继续。

6. 生成 Skill
   最后生成一个本地 Skill，让 AI 后续可以按照这些规则使用网站。
```

---

## 核心概念，用普通话解释

### Site Capability Layer

网站能力层。

它负责把真实网站整理成 AI 可以理解和复用的能力，例如搜索、打开详情页、查看内容、识别登录状态、识别风险页面、生成下载计划等。

### Site Capability Graph

网站能力地图。

它把网站里的页面、能力、路线、登录要求、风险策略、数据结构和失败原因连接起来，让 AI 不只是知道“可以点哪里”，而是知道“这个网站有哪些可用能力”。

### Site Capability Planner Layer

规划层。

它负责判断用户想做某件事时，应该使用哪个能力、走哪条路线、是否需要登录、是否需要用户确认、是否存在风险、能不能安全继续。

### SiteAdapter

每个网站自己的说明书。

不同网站的 URL、页面结构、搜索方式、分页规则、登录提示和风险页面都不一样。SiteAdapter 用来存放这些站点专属规则。

### SessionView

最小化会话视图。

如果某些网站需要登录，SiteForge 不会把原始 cookie、token 或浏览器 profile 随便传给各个模块，而是通过受限制的 SessionView 表示“当前会话是否可用”。

### RiskState

风险状态。

当网站出现登录失效、权限不足、验证码、限流、风控或访问限制时，SiteForge 会记录明确状态，而不是盲目继续。

---

## 当前版本如何使用？

当前版本已经包含 Site Capability Layer、Site Capability Graph 和 Planner Layer。

但需要注意：

```text
build 命令会完成网站采集、知识库和基础 Skill 生成；
Graph / Planner 编译目前仍需要单独运行；
额外编译后，建议重新生成 Skill，让 Skill 包含最新的能力图和规划结果。
```

也就是说，当前完整流程是三步。未来更理想的体验是一条 `build` 命令自动完成全部流程。

---

## 安装与准备

克隆仓库：

```bash
git clone https://github.com/yuetongli-PL/SiteForge.git
cd SiteForge
```

推荐在 Windows PowerShell 中初始化本地环境：

```powershell
. .\tools\bootstrap.ps1
```

当前仓库没有 `package.json`，所以稳定使用方式是直接运行 Node.js 和 Python 入口，而不是 `npm install` 或 `npm run dev`。

---

## 第一次适配一个网站

把 `<url>` 换成目标网站地址，把 `<siteKey>` 换成这个网站的站点标识，例如 `qidian`、`bilibili`、`xiaohongshu`。

### 1. 构建网站知识库和基础 Skill

```powershell
node .\src\entrypoints\cli.mjs build <url>
```

这一步会尝试观察网站、分析结构、生成知识库，并生成基础 Skill。

### 2. 编译 Site Capability Graph 和 Planner Layer

```powershell
node .\src\entrypoints\cli.mjs site capability-compile --site <siteKey> --url <url> --write-artifacts --out-dir .\runs\sites\site-capability-compile\<siteKey> --json
```

这一步会从本地站点配置编译能力图，并生成 Planner dry-run 结果和 compile summary。

重点产物是：

```powershell
.\runs\sites\site-capability-compile\<siteKey>\site-compile-result-summary.json
```

### 3. 重新生成 Skill，让它包含最新编译结果

```powershell
node .\src\entrypoints\cli.mjs skill <url> --compile-summary .\runs\sites\site-capability-compile\<siteKey>\site-compile-result-summary.json
```

重新生成后的 Skill 会更清楚地包含网站能力图、Planner 状态、缺失能力、安全边界和规划结果。

---

## 常用命令

### 检查网站状态

```powershell
node .\src\entrypoints\cli.mjs site doctor <url>
```

用于检查网站结构、健康状态、登录状态、风险提示和可用能力。

### 构建网站知识库和基础 Skill

```powershell
node .\src\entrypoints\cli.mjs build <url>
```

用于第一次适配网站或重新采集网站证据。

### 单独生成 Skill

```powershell
node .\src\entrypoints\cli.mjs skill <url>
```

如果已经有知识库，可以单独重新生成 Skill。

### 使用指定 compile summary 生成 Skill

```powershell
node .\src\entrypoints\cli.mjs skill <url> --compile-summary <site-compile-result-summary.json>
```

当你刚刚重新编译 Graph / Planner 后，推荐使用这个命令。

### 编译能力图和规划层

```powershell
node .\src\entrypoints\cli.mjs site capability-compile --site <siteKey> --url <url> --write-artifacts --out-dir .\runs\sites\site-capability-compile\<siteKey> --json
```

用于重新生成 Site Capability Graph、Planner dry-run 和 compile summary。

### 规划下载任务

```powershell
node .\src\entrypoints\cli.mjs download plan <url> --site <siteKey>
```

只生成下载计划，不直接下载。

### 执行下载任务

```powershell
node .\src\entrypoints\cli.mjs download execute <url> --site <siteKey>
```

是否可以执行取决于该站点是否注册了安全、低权限、已验证的下载能力。

---

## 生成的 Skill 有什么区别？

如果只运行 `build`，生成的是基础 Skill。

它主要来自网页采集和知识库，可以说明网站页面、流程、交互和恢复方式。

如果额外运行 `site capability-compile` 并用 `--compile-summary` 重新生成 Skill，新的 Skill 会额外包含：

```text
Site Capability Graph 编译结果
Graph validation 状态
Planner dry-run 状态
能力是否缺失
Planner handoff 是否 ready
Execution policy 是否允许
SiteAdapter / Downloader / Session 的安全边界
```

简单说：

| Skill 类型 | 说明 |
| --- | --- |
| 基础 Skill | 基于网页采集和知识库生成的网站说明。 |
| 包含 compile summary 的 Skill | 基于知识库 + 能力图 + 规划层结果生成，更适合稳定复用。 |

---

## 常见状态说明

SiteForge 不会把所有失败都简单显示成“失败”。它会尽量说明原因。

| 状态 | 含义 |
| --- | --- |
| `success` | 成功完成。 |
| `partial` | 部分完成，有些证据或页面没有采集完整。 |
| `skipped` | 被跳过，通常是策略或配置原因。 |
| `blocked` | 被安全边界阻止，例如登录、权限、验证码、风控、访问限制。 |
| `failed` | 执行失败，需要查看原因和日志。 |

常见原因包括：

```text
需要登录
权限不足
页面被限制
出现验证码或风控
站点结构变化
下载器未验证
能力图缺少对应能力
Planner 无法生成安全计划
```

---

## 安全边界

SiteForge 明确不做这些事：

```text
不绕过验证码
不绕过 MFA
不绕过登录权限
不绕过平台风控
不绕过付费墙或访问控制
不偷偷保存 cookie、token、authorization header、session id
不把浏览器 profile 当作普通数据传给下载器
```

如果遇到这些情况，SiteForge 应该停止、记录原因，并给出人工处理建议。

---

## 当前版本说明

当前版本的实际状态：

```text
Site Capability Layer 已经是项目主架构。
Site Capability Graph 已经有 schema、validator 和 compiler。
Site Capability Planner Layer 已经有 dry-run、route resolution、context check、fallback 和 handoff。
build 主流程目前还没有自动包含 Graph / Planner 编译。
因此完整适配时，推荐执行 build → capability-compile → skill --compile-summary。
```

未来目标是让普通用户只运行：

```powershell
node .\src\entrypoints\cli.mjs build <url>
```

一次完成网站采集、知识库、能力图、规划层和最终 Skill 生成。

---

## 项目目录

| 路径 | 作用 |
| --- | --- |
| `src/entrypoints/` | 命令入口。 |
| `src/pipeline/` | 网站采集、分析、知识库和 Skill 生成流程。 |
| `src/sites/capability/` | Site Capability Layer、Graph、Planner、风险、安全、策略等核心能力。 |
| `src/sites/core/adapters/` | 各网站的 SiteAdapter。 |
| `src/sites/downloads/` | 下载计划、资源解析和低权限下载执行。 |
| `src/sites/sessions/` | 会话健康、SessionView 和会话治理。 |
| `config/` | 网站注册表和能力配置。 |
| `profiles/` | 安全的站点 profile 配置，不是浏览器 profile。 |
| `skills/` | 生成或维护的本地 Skill。 |
| `tests/` | 架构、能力、安全和回归测试。 |
| `tools/` | 安全扫描、发布检查和维护工具。 |

---

## 贡献和安全

修改项目前，建议先阅读：

- `CONTRIBUTING.md`
- `AGENTS.md`
- `SECURITY.md`

提交前至少检查：

```powershell
git status --short
node .\tools\prepublish-secret-scan.mjs
git diff --check
```

不要提交：

```text
cookie
token
CSRF 值
authorization header
session id
浏览器 profile
下载媒体
本地运行日志
验证码、MFA、风控或访问控制绕过逻辑
```

---

## License

当前仓库没有 `LICENSE` 文件。除非后续添加明确许可证，否则不要假设它是 MIT、Apache-2.0 或其他开源许可证。
