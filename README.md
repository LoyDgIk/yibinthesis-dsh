# yibinthesis-dsh

把 [YibinThesis](https://github.com/)（宜宾学院本科毕业材料的 LaTeX 排版工具）接入
**DeepSeek Harness**，作为原生插件：一组 `yibinthesis_*` 原生工具、一份按需加载的技能，
以及一个 Web GUI 工具链状态面板。

> 本工具是**非官方**实现。学校、学院或专业的新通知优先于本工具；提交前仍需由指导教师或所在学院复核。

## 功能范围

上游 `YibinThesis` 由 Python CLI、PowerShell 构建器与 LaTeX 文档类组成，在终端中可用，
但助手调用时需先确定：项目位置、文档类型、缺失的排版工具，以及失败源于配置还是环境。
本插件将这些判断转化为**结构化调用**：

| 工具 | 用途 | 只读 |
| --- | --- | :---: |
| `yibinthesis_probe` | 项目摘要：配置、入口与文档类型、封面元数据、章节与汉字数、交付路径 | ✅ |
| `yibinthesis_doctor` | 工具链就绪度，并指出缺项与补法 | ✅ |
| `yibinthesis_new` | 新建项目骨架（支持 `dry_run` 预览） | ❌ |
| `yibinthesis_build` | 构建 PDF / DOCX | ❌ |
| `yibinthesis_check` | 结构与格式检查 | ❌ |
| `yibinthesis_clean` | 清理构建产物 | ❌ |

另含渐进披露技能 `yibinthesis`，以及一个状态面板（除「设置产物输出名称」外只读）。

## 状态面板

**入口：会话右侧栏的「论文工具」标签页**，与「工作区文件 / 上下文 / 新建终端 / 浏览器」同列。
另有备用入口：**插件 → 已安装 → `yibinthesis-dsh` → 该行的「配置」**（`plugins.row.config`）。

### 位置选型依据

面板承载的是**当前会话的论文项目**，属于会话级 UI，因此注册到会话右侧栏，
而不是与「插件 / 技能中心」并列的应用级侧栏。注册由三处配对完成，共用同一 id：

| 作用 | 注册点 |
| --- | --- |
| 声明标签条目（含图标；缺此项标签不出现） | `ctx.inject(['sidebarRightTabs'])` → `sidebarRightTabs.register({ id, kind, title, guide })` |
| 标签正文 | 槽位 `sidebar.right.pane.tab`，key = id |
| 标签标题头 | 槽位 `sidebar.right.pane.tab.title`，key = id |

该配对由 `tests/contract.test.mjs` 的「客户端半：必须注册会话右侧栏标签」与
`tests/client-render.test.mjs`（真渲染 + 逐项内容断言 + 抛错可见性）机械保证。

### 呈现内容

1. **项目状态**：题目 / 作者 / 学号 / 年级 / 院系 / 导师、文档类型与学科、章节文件数、
   正文字数；**论文文件清单**（按用途分「正文 / 资源 / 数据 / 文档」标签页，正文每章附汉字数，
   点击即在右侧栏预览）；两份交付物的**存在性、体积与生成时间**，已生成者可直接打开。

   > **一个会话可承载多篇文档。** 毕业论文、开题报告、文献综述对应 `yibinthesis_new` 的三种
   > `documentType`，各为独立项目，因此面板维护的是**项目列表**（点条目切换，`×` 从列表移除，
   > 不删除磁盘文件）。列表**按会话持久保存**，初始为空——`defaultProjectDir` 在本部署
   > 刻意留空，以免每个新会话都指向同一项目。助手可用 `yibinthesis_new` 建项目，
   > 或用任一工具的 `project_dir` 参数指定路径。

   > **文件分类的必要性。** 实测样本含 **148 个文件**：`latex/assets/` 52（插图与中间件）、
   > `图表资源/` 44、`plan/` 26、`tmp/` 10，而**正文仅 13 个 `.tex`**。合并展示时正文会被资源淹没。
   > 分类判据为**用途**而非扩展名，实现见 `categorizeProjectFile()`；
   > 「资源」页按**目录聚合**呈现，不逐条展开。
2. **工具链就绪度**：Tectonic / Biber 版本 / Pandoc / Python / python-docx / Pillow 逐项状态，
   附 `exit 0/2` 与可按需展开的原始输出。
3. **生效配置**：`templateRoot`、`cliRoot`、`toolchainDirs`、`defaultProjectDir`。

### 路由与写面

面板不触发构建：经 Web 路由调用编译会显著扩大权限面（任何能访问该端口的页面均可让宿主写盘）。
构建与脚手架一律由助手经 `yibinthesis_build` / `yibinthesis_new` 发起，受正常的工具审批与取消链路约束。

桥暴露 5 条路由，其中**仅一条可写**：

| 路由 | 方法 | 作用 |
| --- | --- | --- |
| `/state` | GET | 插件配置与项目概况 |
| `/probe` | GET | 结构化项目摘要（经 Python 适配器） |
| `/deliverables` | GET | 交付物存在性 / 体积 / 时间 |
| `/deliverables` | **POST** | **设置产物输出名称**（唯一写操作，由用户点击触发） |
| `/files` | GET | 项目文件清单（跳过构建产物目录） |
| `/doctor` | GET | 工具链就绪度 |

写路由必须**显式登记**于 `BRIDGE_WRITE_ROUTES`。`tests/bridge.test.mjs` 断言「除白名单外一律只读」；
`tests/client-render.test.mjs` 断言客户端写调用**恰好一处**、必须挂在点击处理器上、且不得在 effect 中自动执行。
新增写操作会被这两条测试强制要求同步更新白名单。

## 设计取舍：薄桥，不重写

上游的分工是「PowerShell 与 Python 管排版」。本插件**不**将 53 KB 的 `build.ps1`
与 280 KB 的 Word 模块移植到 JS——那只会引入回归风险。插件职责限于**探测、校验、编排、结构化**：

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

## 与上游的兼容性

本插件随包携带 YibinThesis 模板运行时的发布快照（见 `vendor/yibinthesis/`）。
该快照为 **commit `c453a26`**，与上游 `lib/` 下 33 个共有文件逐字节一致。

联调期间曾在上游发现两处导致 DOCX 链路失败的缺陷。**两处均已由上游修复并并入本快照**，
本插件不代修上游排版逻辑，此处记录仅用于说明快照版本与验证依据。

### 已修复：`word_core` 的私有 OOXML 函数未绑定

`lib/word_oxml.py` 通过 `bind_core(core)` 将自身名字并入 `word_core`；`lib/word_core.py`
的 `_bind_oxml_module()` 再将合并后的私有名字注回 `word_core`。原实现在注回时排除了
`_build_front_matter`、`_build_cover_page`、`_build_originality_page`、`_build_authorization_page`
四个名字，而它们**只在 `word_oxml.py` 中定义**，`word_core.py` 中并不存在。
因此 `postprocess_docx()` 以裸名调用时触发 `NameError`。

**上游修复**：注回条件改为 `name.startswith("_")`，即绑定全部私有 OOXML 函数。

### 已修复：分节标记的注入点与消费点不同源

原实现在 `word_core.py` 的**论文**构建路径上注入 `SECTION_REVIEW_REFERENCES` 与
`SECTION_REVIEW_TAIL` 两个内部标记，而清理它们的代码位于 `word_profiles.py` 的
`_postprocess_review_docx()`，**只服务于文献综述**。两者不同源，导致
`word_core.py` 的「后处理标记未清理」守卫必然抛错。

**上游修复**：将三处标记注入移入 `word_profiles.py` 的非论文构建路径，与消费点同处一文件。

### 本插件的验证结论

| 链路 | 结果 |
| --- | --- |
| PDF | ✅ 通过（示例项目产出 163.2 KB，`%PDF-1.5`） |
| DOCX | ✅ 通过（示例项目产出 62.8 KB，`PK` 魔数；`word/document.xml` 中两个内部标记均已清理） |
| 模板回归 | ✅ 通过（`yibinthesis_check` 的冒烟夹具） |

若使用自定义 `templateRoot` 指向**较旧**的上游检出，上述缺陷可能仍然存在；
`yibinthesis_build` 检测到相应症状时会返回 `kind: 'upstream-word-defect'` 并附诊断。

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

**84 个用例**，按关注点分文件（`tests/`）：

| 文件 | 用例 | 守住什么 |
| --- | ---: | --- |
| `contract.test.mjs` | 17 | package.json / patch / vendor / 注册面自洽；技能 frontmatter 在 CRLF·BOM 下不退化 |
| `client-render.test.mjs` | 21 | 真渲染（非快照）：逐项内容断言、**组件抛错必须可见**、缓存跨卸载、目录优先级、写面恰好一个 |
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
└── tests/               84 个测试
```

## 发布（维护者）

```powershell
# 1) 先跑测试与打包
npm test
npm pack                       # 产出 yibinthesis-dsh-<version>.tgz

# 2) 发布（用绝对路径指向 tarball，避免工作目录不对导致发错包）
npm publish "<仓库绝对路径>\yibinthesis-dsh-<version>.tgz"
```

**必须使用 Automation token，不要使用交互式 2FA。** 交互式流程走「暂存发布」：
若在浏览器确认环节中断，registry 会残留 `0.0.0-stage` 占位存根并占据
`dist-tags.latest`，其后发布会报 `E409 Cannot publish over previously staged version`。
Automation token 使 `npm publish` 成为非交互的单次操作：

```
# %USERPROFILE%\.npmrc
//registry.npmjs.org/:_authToken=<Automation token>
```

**不要执行 `npm unpublish`**：删除后 npm 会锁定该包名 **24 小时**不允许重发
（`E403 cannot be republished until 24 hours have passed`）。该限制作用于**包名**，
更换版本号无法绕过。

**发布前确认工作目录为仓库根**（`npm pkg get name` 应返回 `yibinthesis-dsh`）。
用户主目录下若存在用于存放依赖的 `package.json`，在其中执行 `npm publish`
会使 npm 将该目录当作包根并遍历，进而扫到受保护的系统目录
（`AppData\Local\ElevatedDiagnostics`）而报 `EPERM scandir`。

## 授权

MIT。随包 `vendor/yibinthesis/` 来自上游 YibinThesis（MIT）。
**校名、校徽等机构标识不在 MIT 授权范围内**，详见 [`NOTICE`](NOTICE)。
