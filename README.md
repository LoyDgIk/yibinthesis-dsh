# yibinthesis-dsh

把 [YibinThesis](https://github.com/)（宜宾学院本科毕业材料的 LaTeX 排版工具）接入
**DeepSeek Harness**，作为原生插件：一组 `yibinthesis_*` 原生工具、一份按需加载的技能，
以及一个 Web GUI 工具链状态面板。

> 本工具是**非官方**实现。学校、学院或专业的新通知优先于本工具；提交前仍需由指导教师或所在学院复核。

## 它解决什么

上游 `YibinThesis` 是一个 Python CLI + PowerShell 构建器 + LaTeX 文档类。
它在终端里很好用，但一个 AI 助手要用它，得先搞清楚：项目在哪、是哪类文档、缺哪个排版工具、
失败到底是配置错还是环境错。本插件把这些问题变成**结构化调用**：

| 工具 | 用途 | 只读 |
| --- | --- | :---: |
| `yibinthesis_probe` | 项目摘要：配置、入口与文档类型、封面元数据、章节与汉字数、交付路径 | ✅ |
| `yibinthesis_doctor` | 工具链就绪度 + **缺什么、怎么补** | ✅ |
| `yibinthesis_new` | 新建项目骨架（支持 `dry_run` 预览） | ❌ |
| `yibinthesis_build` | 构建 PDF / DOCX | ❌ |
| `yibinthesis_check` | 结构与格式检查 | ❌ |
| `yibinthesis_clean` | 清理构建产物 | ❌ |

外加技能 `yibinthesis`（渐进披露）与一个状态面板（除「设置产物输出名称」外只读）。

## 状态面板

**入口：会话右侧栏的「论文工具」标签页** —— 与「工作区文件 / 上下文 / 新建终端 / 浏览器」同列。
另有备用入口：**插件 → 已安装 → `yibinthesis-dsh` → 该行的「配置」**（`plugins.row.config`）。

位置为什么是这里（走过两次弯路，记下来避免重犯）：

1. 最初只挂 `plugins.row.config` —— 要走「插件 → 已安装 → 找到该行 → 点『配置』」三步，
   中途点到插件名还会先落到宿主自动生成的插件信息页。用户反馈：**「面板在哪」**。
2. 改挂应用级侧栏 `sidebar.panellist` + `main` —— 找得到了，但**层级错了**：这个面板讲的是
   **当前会话的论文项目**，属于会话级 UI，不该和「插件 / 技能中心」并列。
   用户反馈：**「这个面板不应该在会话窗口的顶栏或侧栏吗？」**
3. 现方案：按 `dsh-context`（同为第三方、同为会话级面板）实测的写法注册到**会话右侧栏**，
   三件配对、共用同一个 id：

   | 作用 | 注册点 |
   | --- | --- |
   | 声明标签条目（含图标；没有它标签不出现） | `ctx.inject(['sidebarRightTabs'])` → `sidebarRightTabs.register({ id, kind, title, icon })` |
   | 标签正文 | 槽位 `sidebar.right.pane.tab`，key = id |
   | 标签标题头 | 槽位 `sidebar.right.pane.tab.title`，key = id |

这套配对由 `tests/contract.test.mjs` 的「★ 客户端半：必须注册会话右侧栏标签」与
`tests/client-render.test.mjs`（真渲染 + 逐项内容断言 + 抛错可见性）机械守住。

它回答三个问题：

1. **我的论文现在什么状态** —— 题目 / 作者 / 学号 / 年级 / 院系 / 导师、文档类型与学科、章节文件数、
   正文字数；并列出**论文文件清单**（按用途分「正文 / 资源 / 数据 / 文档」标签页，正文每章带汉字数，
   点击即在右侧栏预览）与两份交付物各自**是否已生成、多大、什么时候生成的**（已生成的**可点击打开**）。

   > **一个会话可有多篇文档**。毕业论文、开题报告、文献综述是 `yibinthesis_new` 的三种
   > `documentType`，各为**独立项目**，因此面板维护的是**项目列表**（点条目切换、`×` 移除；
   > 移除只动列表，不删磁盘文件）。列表**按会话保存**，初始为**空**——`defaultProjectDir`
   > 在本部署刻意留空，避免每个新窗口都凭空指向同一个项目。
   > 助手可用 `yibinthesis_new` 直接建项目，或用任一工具的 `project_dir` 参数指定路径。

   > **为什么文件要分类**：实测一个真实论文项目有 **148 个文件**——`latex/assets/` 52 张图与中间件、
   > `图表资源/` 44、`plan/` 26、`tmp/` 10，而**正文只有 13 个 `.tex`**。混成一个列表时正文会被资源
   > 淹没（用户反馈「资产目录和正文混在一起」）。分类判据是**用途**而非扩展名，见
   > `categorizeProjectFile()`；「资源」页按**目录聚合**显示，不铺开上百行。
2. **这台机器能不能出 PDF / DOCX** —— 工具链逐项就绪度（Tectonic / Biber 版本 / Pandoc / Python /
   python-docx / Pillow），带 `exit 0/2` 与可按需展开的原始输出。
3. **当前生效的是哪套配置** —— `templateRoot`、`cliRoot`、`toolchainDirs`、`defaultProjectDir`。

### 路由与写面

**为什么不从面板触发构建**：通过 Web 路由编译会让权限面过大（任何能访问该端口的页面都能让宿主编译写盘）。
构建与脚手架一律由助手经 `yibinthesis_build` / `yibinthesis_new` 发起，走正常的工具审批与取消链路。

桥现有 5 条路由，其中**只有一条可写**：

| 路由 | 方法 | 作用 |
| --- | --- | --- |
| `/state` | GET | 插件配置与项目概况 |
| `/probe` | GET | 结构化项目摘要（走 Python 适配器） |
| `/deliverables` | GET | 交付物存在性 / 体积 / 时间 |
| `/deliverables` | **POST** | **设置产物输出名称**（唯一写操作，由用户点击触发） |
| `/files` | GET | 论文源文件清单（跳过构建产物目录） |
| `/doctor` | GET | 工具链就绪度 |

写路由必须**显式登记**在 `BRIDGE_WRITE_ROUTES` 里；`tests/bridge.test.mjs` 断言「除白名单外一律只读」，
`tests/client-render.test.mjs` 断言**客户端写调用恰好只有一个**、且必须挂在点击处理器里（不得在 effect 中自动执行）。
新增写操作会被这两条测试强制要求同步更新白名单——不会因为「顺手加个 POST」而无声扩大写面。

## 设计取舍：薄桥，不重写

上游是「Node 管编排、Python 与 PowerShell 管排版」。本插件**不**把 53 KB 的 `build.ps1`
和 280 KB 的 Word 模块移植到 JS——那只会引入回归风险。插件的职责是**探测、校验、编排、结构化**：

```
DSH 工具调用
   └─ Node（本包）
        ├─ 工具链探测（env → .tools/ → PATH）+ 子进程 PATH 组合
        ├─ 结构读取 ──→ adapter/yibinthesis_probe.py（只读，输出唯一 JSON）
        └─ 构建编排 ──→ vendor/yibinthesis/build.ps1（PDF/Word/check/clean/doctor）
```

两条硬规则：

1. **不假装成功。** 缺工具就报 `ok:false` + `kind:'missing-toolchain'` + 可操作提示，
   绝不产出「部分成功」的构建结论。
2. **失败给 `kind`，不给裸异常。** 所有工具都不抛，失败变成
   `{ ok:false, kind, message, hints }`，让调用方知道该补环境还是改配置。

## 安装

见 [`docs/INSTALL.md`](docs/INSTALL.md)。要点：

```powershell
# 1) 装进一个 DSH profile（用 npm 包名，或本地路径）
cd $env:USERPROFILE\.dsh\profiles\desktop
pnpm add yibinthesis-dsh

# 2) 在 profile 的 package.json 里把包名加进 dsh.profile.bundles
# 3) 重载 profile（或重启 DSH）
```

只想用模板运行时、不装插件也可以：直接用上游 [`YibinThesis`](https://github.com/) 仓库的 `build.ps1`。

## 上游已知缺陷

本插件在联调中发现**上游 YibinThesis 有两处独立缺陷**，都会让 Word/DOCX 链路失败。
两处都**已用未改动的上游仓库复现**，不是本插件引入的，本插件也不代修上游排版逻辑。

### 缺陷 1：`word_core` 有 4 个名字永远不会被绑定 —— **上游已修复 ✅**

- `lib/word_oxml.py:8-13` 的 `bind_core(core)` 把 `word_core` 的名字并入 `word_oxml`；
- `lib/word_core.py` 的 `_bind_oxml_module()` 再把合并后的**私有**名字注回 `word_core`，原先**排除**了
  `_build_front_matter` / `_build_cover_page` / `_build_originality_page` / `_build_authorization_page`；
- 而这 4 个函数**只存在于 `word_oxml.py`**（`:513/638/711/777`），`word_core.py` 里从未定义过；
- 于是 `postprocess_docx()` 以**裸名**调用时 → `NameError: name '_build_front_matter' is not defined`。

**上游修复**：删除该排除集合，改为绑定全部私有 OOXML 函数（`_bind_oxml_module()` 现在只判
`name.startswith("_")`）。随包副本已同步该修复，**实测不再报 `NameError`**。

### 缺陷 2：论文路径注入的分节标记无人消费（**仍在修**）

- `word_core.py:3066/3073/3075` 在**论文**路径上也注入 `SECTION_REVIEW_REFERENCES` 与 `SECTION_REVIEW_TAIL`；
- 消费（移除）它们的代码在 `word_profiles.py:505-526`，属于 `_postprocess_review_docx`——**只服务文献综述**；
- 因此 `word_core.py:2743-2749` 的「后处理标记未清理」守卫必然抛错。

**结论**：**在缺陷 2 修复前，论文类文档无法产出 DOCX。**
**PDF 输出不受影响**——它是版式主输出，本插件已实测通过（157 KB，`%PDF-1.5`），
`doctor`、`probe`、`clean` 以及模板回归冒烟也都正常工作。
`yibinthesis_build` 检测到该错误时会返回 `kind: 'upstream-word-defect'` 并给出同一份诊断。

## 工具链：本包**不分发**排版二进制

上游 `.tools/` 下的 Tectonic + Biber + Pandoc 合计约 **312 MB**（`biber.exe` 31.7 MB、
`pandoc.exe` 231.1 MB、`tectonic.exe` 49.6 MB），不适合进 npm 包。
本包改为按三层优先级**探测**：

1. 环境变量 `YIBINTHESIS_TECTONIC` / `YIBINTHESIS_BIBER` / `YIBINTHESIS_PANDOC` / `YIBINTHESIS_PYTHON` / `YIBINTHESIS_LATEXMK` / `YIBINTHESIS_XELATEX`
2. 插件与项目的 `.tools/`（约定：`biber-2.17/biber.exe`、`pandoc-3.9.0.2/pandoc.exe`、`tectonic/tectonic.exe`）、以及本机已知缓存路径
3. `PATH`

**Biber 必须是 2.17**：Tectonic 0.16.9 的 BCF 3.8 工作流与 2.21 不兼容。
先跑 `yibinthesis_doctor` 看缺什么。

## 配置

在 profile 补丁里按行 id 覆盖（`cordis.patch.yml`）：

```yaml
- id: yibinthesis
  name: yibinthesis-dsh
  config:
    templateRoot: 'D:\src\YibinThesis'          # 想跟随上游更新时指向它；默认用随包副本
    cliRoot: 'D:\src\YibinThesis'               # yibinthesis_new 需要
    defaultProjectDir: 'D:\thesis\my-thesis'    # 留空则面板初始为空（推荐）
    toolchainDirs: ['D:\src\YibinThesis\.tools']
```

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `templateRoot` | 随包 `vendor/yibinthesis` | 模板运行时根（须含 `build.ps1`） |
| `cliRoot` | `null` | 上游检出根，提供 `lib/yibinthesis_cli`（`yibinthesis_new` 需要） |
| `pythonPath` | `null` | 跑适配器的解释器；留空用 PATH 上的 `python` |
| `toolchainDirs` | `[]` | 额外工具链搜索目录 |
| `toolchain` | `{}` | 按工具名直接指定可执行文件（优先级最高） |
| `defaultProjectDir` | `null` | 未传 `project_dir` 时的默认项目目录 |
| `buildTimeoutMs` | `900000` | 单次构建墙钟预算（首次 Tectonic 要下载宏包） |
| `maxLogBytes` | `262144` | 子进程输出采集上限，超限截断并置 `truncated:true` |
| `quiet` | `false` | 静音 info 级启动日志（warn 永不静音） |

非法配置在**加载期响亮失败**，不会静默回落默认值。

## 测试

```powershell
node --test --test-timeout=120000 "tests/**/*.test.mjs"
```

**82 个用例**，按关注点分文件（`tests/`）：

| 文件 | 用例 | 守住什么 |
| --- | ---: | --- |
| `contract.test.mjs` | 17 | package.json / patch / vendor / 注册面自洽；技能 frontmatter 在 CRLF·BOM 下不退化 |
| `client-render.test.mjs` | 19 | 真渲染（非快照）：逐项内容断言、**组件抛错必须可见**、缓存跨卸载、目录优先级、写面恰好一个 |
| `bridge.test.mjs` | 16 | 路由全集、写白名单、**非法输入不得落盘**、写回保真（其余字段原样） |
| `toolchain.test.mjs` | 10 | 工具链发现优先级、PATH 去重、版本校验 |
| `local-toolbuilder.test.mjs` | 8 | 自带 `defineTool` 与宿主真 DSL 的等价性 |
| `han-count.test.mjs` | 6 | LaTeX 剥离口径：注释 / 公式 / 逐字环境 / 结构命令参数一律不计 |
| `real-dsh-tools.test.mjs` | 4 | 用宿主**真实** `defineTool` 验证 6 个工具定义合法 |
| `installed-entry.test.mjs` | 2 | 已安装副本与源码逐字节一致 |

另有 `scripts/check_han.py`：汉字计数的**硬断言式**校对（自带期望值，非人工比对）。

## 目录

```
yibinthesis-dsh/
├── lib/                 host 半：入口、工具、工具链探测、子进程、配置、HTTP 桥、客户端
├── adapter/             Python 适配器（结构化读取的唯一来源）
├── client 半            lib/client.js（__ModuleLoader__ 包裹格式）
├── skills/yibinthesis/  技能 + references
├── vendor/yibinthesis/  随包模板运行时
├── scripts/             校对脚本（check_han.py）
├── docs/                架构与安装
└── tests/               82 个测试
```

## 授权

MIT。随包 `vendor/yibinthesis/` 来自上游 YibinThesis（MIT）。
**校名、校徽等机构标识不在 MIT 授权范围内**，详见 [`NOTICE`](NOTICE)。
