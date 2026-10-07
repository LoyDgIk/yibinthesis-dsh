# yibinthesis-dsh 架构

本文将上游 YibinThesis（宜宾学院本科毕业材料 LaTeX 排版工具）封装为 DSH 原生插件包，
说明三部分（host / client / skill）的边界与关键设计决策。

文中 D1–D6 各条均附**实测依据**：其中数条推翻了「看似更合理」的初始方案，
保留其依据可避免后续重复试错。

```
yibinthesis-dsh/
├── package.json          # dsh.bundle.patch + dsh.client.{platform,inject} + exports["./client"]
├── cordis.patch.yml      # - insert: 一行 name: yibinthesis-dsh（自注册行）
├── lib/                  # 【host 半】Node ESM，运行期零宿主依赖
│   ├── index.js          #   入口：注册技能 + 装工具 + 挂桥
│   ├── tools.js          #   6 个工具的 defineTool 定义与注册
│   ├── tool-builder.js   #   自带 defineTool（见 D5）
│   ├── toolchain.js      #   工具链探测（config → env → .tools/ → PATH）+ PATH 组合
│   ├── runner.js         #   子进程执行 build.ps1 / Python 适配器
│   ├── config.js         #   Config（standard-schema 形态，零依赖）
│   ├── bridge.js         #   HTTP 桥：面板取数（见 §4）
│   └── client.js         #   【client 半】右侧栏面板
├── adapter/
│   └── yibinthesis_probe.py  # 结构化读取 + LaTeX 剥离计数（见 D4）
├── skills/yibinthesis/   # 【skill 半】渐进披露：SKILL.md + references/
├── vendor/yibinthesis/   # 随包模板运行时（见 D2）
├── scripts/check_han.py  # 汉字计数的硬断言式校对
└── tests/                # 84 个测试
```

## 1. 核心设计决策

### D1：不重写，做桥接

上游为 **Python CLI + PowerShell 构建器 + LaTeX 文档类**。移植到 JS 需重写
53 KB 的 `build.ps1` 与 280 KB 的 Word 模块，回归风险高且无对应收益。
**决策**：插件为**薄桥**——Node 侧负责探测、校验、编排与结构化输出，
Python 与 PowerShell 负责排版。

### D2：随包携带模板运行时

`build.ps1` 以「脚本自身所在仓库根」解析 `lib/build_word.py`、`word/reference.docx`、
`yibinthesis.cls`，因此 npm 包必须自带这些文件，否则安装后仍无法构建。

- **随包**：`build.ps1`、`*.cls`/`*.sty`、`yibinthesis.project.schema.json`、
  `lib/`（Word 与审计模块）、`word/`、`assets/`、`tools/`、`tests/`、`LICENSE`、`NOTICE`。
- **不随包**：`.tools/`（约 312 MB 二进制：`pandoc.exe` 231 MB、`tectonic.exe` 49.6 MB、
  `biber.exe` 31.7 MB）、`lib/tests/`（上游单元测试）、`examples/`。
- **`tests/` 为必需项**：`build.ps1` 的 `Invoke-Checks` 除审计所选论文外，还会**无条件**构建
  `tests/smoke.tex` 与 `tests/smoke-science.tex`。缺少这两个夹具时，`yibinthesis_check`
  必然以 exit 1 结束，与所审论文本身无关。
- **边界**：随包副本是**发布快照**而非软链，上游更新后需重新同步；
  `Config.templateRoot` 可指向自定义上游检出。

### D3：工具链探测与子进程 PATH 组合

沿用上游语义：`env YIBINTHESIS_*` → 配置目录 → `PATH` → 未找到。

插件在此基础上增加一层 **PATH 组合**，将以下目录注入子进程 `PATH`，使上游的
`Get-Command` 能够命中：① `Config.toolchainDirs`；② 项目 `.tools/` 下的版本化子目录
（`biber-2.17/`、`pandoc-3.9.0.2/`）；③ 插件包内 `.tools/`（用户自行放置时）。

探测结果**不掩盖缺失**：`yibinthesis_doctor` 的 `ready` 字段直接取自脚本退出码，
缺失项按实际情况报告。

### D4：结构化输出经 Python 适配器，不解析 PowerShell 文本

`build.ps1` 的 `doctor` 输出面向人类阅读，解析它等同于将排版工具的日志格式当作 API。

`adapter/yibinthesis_probe.py` 直接 `import` 随包 CLI 的纯函数，输出**唯一一个规范化 JSON**。
`build.ps1` 的 stdout 仍如实回传（截断后），但**不作为结构化字段来源**。

适配器另提供纯函数子命令 `strip`：先将 LaTeX 剥离为可见文字，再统计汉字。
**必须剥离的原因**：直接对源码计数字符会把 `\yibinopeningchapter` 等命令名、
`\begin{cnabstract}` 等环境名、注释、公式与逐字环境一并计入——实测中一个纯骨架的
附录文件被计成「20 字」。判据见 `count_han` / `count_han_prose` 与 `tests/han-count.test.mjs`。

### D5：自带 `defineTool`，运行期零宿主依赖

初始方案为「动态 import 宿主 `@deepseek-ai/dsh-tools` 的 `defineTool`，不可用时降级」。
该方案经实测否决，改为自带实现（`lib/tool-builder.js`）。否决依据：

1. 宿主将 `@deepseek-ai/*` 以 junction 形式置于 profile 的 `node_modules` 下。
   实测环境中这 **225 个 junction 全部断链**（指向已不存在的旧安装目录），**无一可达**。
2. 将其声明为本包依赖亦不可行：profile 配置 `nodeLinker: hoisted`，pnpm 会提升该副本，
   而该副本需 import 其 peer `@deepseek-ai/cordis`，此处 `cordis` 同样为断链 junction，
   导致 `ERR_MODULE_NOT_FOUND`。**实测：在已安装副本上执行 `apply` 时，工具注册数为 0。**

工具注册表消费的是 `ToolDefinition` 的**数据形态**，而非某个构造函数；官方 `defineTool`
本身也只是「编译 schema 并组装对象」的纯函数。因此自带实现产出同一数据形态即可，
等价性由 `tests/local-toolbuilder.test.mjs` 以宿主**真实**的 `defineTool` 做递归全等比对
（parameters、`output.schema`、`required` 键的出现与省略规则、顶层键集合）。
`@deepseek-ai/dsh-tools` 因此降级为 **devDependency**。

附带收益：自带实现对**未知顶层键报错**（官方实现为静默忽略），
因此 `executionMode` 一类「已配置但未生效」的写法在本包中无法通过。

**边界**：若上游 DSL 在未来版本发生不兼容变更，自带实现不会自动跟随。
这是为换取「插件在任何 profile 布局下均可注册工具」的确定性而接受的代价；
该类失效会在升级 devDependency 时由等价比对测试立即暴露。

### D6：面板注册于**会话右侧栏**

面板承载的是**当前会话的论文项目**，属会话级 UI，因此注册于会话右侧栏，
而非与「插件 / 技能中心」并列的应用级侧栏。注册由三处配对完成，共用同一 id：

| 作用 | 注册点 |
| --- | --- |
| 声明标签条目（含图标与 guide；缺此项标签不出现） | `sidebarRightTabs.register({ id, kind, title, guide })` |
| 标签正文 | 槽位 `sidebar.right.pane.tab`，key = id |
| 标签标题头 | 槽位 `sidebar.right.pane.tab.title`，key = id |

主题令牌**仅使用**官方令牌目录中声明的语义色（`--dsw-alias-*`）。
未在目录中声明的令牌一律不用：此类令牌的取值不受主题契约保证，
曾使用过一个名义合理的 `label-dimmed`，其在深色主题下对比度不足，导致文本难以辨认。

## 2. 工具面

| 工具 | 能力 | 写盘 | 主要字段 |
| --- | --- | --- | --- |
| `yibinthesis_probe` | 项目摘要：配置、入口、章节与字数、元数据、产出路径 | — | `project`、`config`、`chapters`、`totalHanProse` |
| `yibinthesis_doctor` | 工具链就绪度（解析 `doctor` 输出 + PATH 组合） | — | `ready`、`pdf`、`word`、`tools[]`、`hints[]` |
| `yibinthesis_new` | 脚手架新项目（论文 / 开题报告 / 文献综述） | ✅ | `created[]`、`projectRoot` |
| `yibinthesis_build` | 构建 `pdf`/`word`/`all`/`check`/`clean` | ✅ | `exitCode`、`published[]`、`log`（截断） |
| `yibinthesis_check` | 格式审计 + 模板回归 | ✅（写 `build/checks`） | `exitCode`、`issues[]` |
| `yibinthesis_clean` | 清理构建产物 | ✅（删除 `outputRoot` 内） | `removed[]` |

统一约定：

- 全部返回 `{ ok, ... }`；失败以 `ok:false` 加 `error.kind`/`error.message` 表示，不向模型抛裸异常。
- 长任务经 `exec.signal` 转发取消；子进程被中止时返回 `error.kind='cancelled'`。
- stdout/stderr 采集**设有上限**（`maxLogBytes`，默认 256 KB），截断时显式置 `truncated:true`。
- 工具链缺失时**如实失败**，不产出「部分成功」的结论。

## 3. 技能面

`skills/yibinthesis/SKILL.md` 承担**路由**职责（何时使用、如何使用、边界），
`references/` 按需加载（文档类型、项目配置、工具链、故障处置）。
技能注册**硬依赖** `skills` 服务（`inject = ['skills', 'tools']`）；
`tools` 服务缺失时仅记录 warn，技能仍可用——技能是模型的操作路标，其可用性优先级应高于工具。

## 4. 面板的数据桥

client 半不直接读盘，经 host 半注册的 HTTP 路由取数。

| 路由 | 方法 | 作用 |
| --- | --- | --- |
| `/state` | GET | 插件配置与当前项目概况（需携带 `?projectDir=`） |
| `/probe` | GET | 结构化项目摘要（经 Python 适配器） |
| `/deliverables` | GET | 交付物存在性 / 体积 / 时间 |
| `/deliverables` | **POST** | **设置产物输出名称**（唯一写操作，由点击触发） |
| `/files` | GET | 项目文件清单（含分类，跳过构建产物目录） |
| `/doctor` | GET | 工具链就绪度 |

面板不触发构建：经 Web 路由调用编译会显著扩大权限面——任何能访问该端口的页面均可让宿主写盘。
构建一律由助手经工具发起，受正常的审批与取消链路约束。

写路由必须**显式登记**于 `BRIDGE_WRITE_ROUTES`，并由两条测试保证：

- `tests/bridge.test.mjs`：断言除白名单外一律只读；
- `tests/client-render.test.mjs`：断言客户端写调用**恰好一处**、必须挂在点击处理器上、
  且不得在 effect 中自动执行。

### 版本落差

**client 半随页面刷新更新，host 半需重启 DSH 才更新。** 两者版本不一致时会产生不易排查的现象：
例如旧版 host 的 `/files` 不返回分类字段，界面即表现为「显示 147 个，但一个文件都列不出来」。
为此客户端对旧版 host 实现了**降级路径**（本地推导分类），并由测试固定。

## 5. 测试

84 个用例，按关注点分文件。以下为若干**刻意**的设计：

- **真渲染而非快照**：`tests/support/client-harness.mjs` 是一个小型 React 渲染器，
  实现了 `createElement` 的变长 children、`useCallback` 记忆化、class 组件与渲染次数上限。
- **组件抛错必须可见**：React 在子组件抛错时会卸载整棵子树且不留痕迹，面板表现为空白。
  为此面板包裹了错误边界，测试同时断言渲染期**不得有任何组件抛错**。
- **替身必须仿真真实行为**：测试桩曾因忽略 `?projectDir=` 参数而掩盖「客户端遗漏传参」的缺陷，
  也曾因缺少 `localStorage` 桩而掩盖「持久化未发生」的缺陷。
  修改测试桩只能证明桩本身变化，**断言请求参数与存储写入**才能防止复发。
