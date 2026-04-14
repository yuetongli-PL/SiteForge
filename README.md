# Browser-Wiki-Skill

把站点采集、状态分析、交互抽象、自然语言入口、文档治理、知识库编译和本地 Skill 生成串成一条可维护流水线。

## 当前保留的核心目录
- `profiles/`
  站点级规则源。每个 host 一个 profile，负责页型识别、DOM 选择器、正文清洗和下载策略提示。
- `crawler-scripts/`
  按 host 缓存的站点爬虫脚本与元数据。
- `book-content/`
  按 host 保存的本地下载缓存与运行产物。
- `knowledge-base/`
  编译后的知识库和 `raw/` 事实归档。
- `skills/`
  仓库内的 Skill 源文件。
- `archive/`
  已归档的中间产物，不参与当前主链路运行。
- `schema/`
  知识库和文档治理规则。
- `tests/`
  当前最小回归测试集。

## 统一真值文件
- `site-registry.json`
  站点级运行指针。记录 host、知识库路径、Skill 路径、crawler 路径和最近一次下载/编译信息。
- `site-capabilities.json`
  站点级能力真值。记录 archetype、page types、capability families、supported intents、safe/approval actions。

## 当前主入口
- 下载主入口：
  `pypy3 download_book.py <url> --book-title "<title>"`
- 站点 crawler 生成：
  `node generate-crawler-script.mjs <url>`
- 一键流水线：
  `node run-pipeline.mjs <url>`
- Skill 生成：
  `node generate-skill.mjs <url>`

## PowerShell UTF-8 初始化
先执行一次：

```powershell
. .\scripts\bootstrap.ps1
```

这会统一：
- PowerShell 输入/输出编码
- `PYTHONIOENCODING`
- `PYTHONUTF8`

## 常用命令

### 22biqu 下载整本
```powershell
& 'C:\Users\lyt-p\AppData\Local\Microsoft\WinGet\Packages\PyPy.PyPy.3.11_Microsoft.Winget.Source_8wekyb3d8bbwe\pypy3.11-v7.3.20-win64\pypy3.exe' '.\download_book.py' 'https://www.22biqu.com/' --book-title '玄鉴仙族'
```

### 重新强制抓取
```powershell
& 'C:\Users\lyt-p\AppData\Local\Microsoft\WinGet\Packages\PyPy.PyPy.3.11_Microsoft.Winget.Source_8wekyb3d8bbwe\pypy3.11-v7.3.20-win64\pypy3.exe' '.\download_book.py' 'https://www.22biqu.com/' --book-title '玄鉴仙族' --force-recrawl
```

### 生成或复用站点 crawler
```powershell
node .\generate-crawler-script.mjs https://www.22biqu.com/
```

### 重生成 Skill
```powershell
node .\generate-skill.mjs https://www.22biqu.com/
node .\generate-skill.mjs https://moodyz.com/works/date --skill-name moodyz-works
```

## 测试

### Node 测试
```powershell
node --test .\tests\node\*.test.mjs
```

### Python 测试
```powershell
python -m unittest discover -s .\tests\python -p 'test_*.py'
```

## 说明
- `download_book.py` 是唯一保留的下载入口；旧的 `download-book.mjs` 已移除。
- `book-content/` 默认按 host 落盘，例如：
  - `book-content/www.22biqu.com/...`
  - `book-content/moodyz.com/...`
- 运行时优先命中本地完整 artifact；缺失时再复用或生成 crawler。
- `skills/` 是仓库内维护源；真正给 Codex 使用的安装目录在 `.codex/skills/`。
