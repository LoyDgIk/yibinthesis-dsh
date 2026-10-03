# yibinthesis-dsh 架构

把 [YibinThesis](../README.md)（宜宾学院本科毕业材料 LaTeX 排版工具）包装成 DSH 原生插件包。
本文说明**三半的边界**与**几个被实测推翻过的设计选择**——后者尤其值得读，
因为每一条都对应一个「看起来更合理、实际跑不通」的方案。

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

原项目是 **Python CLI + PowerShell 构建器 + LaTeX 类**。重写成 JS 意味着移植
53 KB 的 `build.ps1` 与 280 KB 的 Word 模块，回归风险极高且无收益。
**决策**：插件是**薄桥**——Node 侧负责「探测 / 校验 / 编排 / 结构化」，
Python 与 PowerShell 负责「排版」。

### D2：vendored 模板运行时

`build.ps1` 按「脚本自身所在仓库根」解析 `lib/build_word.py`、`word/reference.docx`、
`yibinthesis.cls`，因此 npm 包必须自带这些文件。

- **随包**：`build.ps1`、`*.cls`/`*.sty`、`yibinthesis.project.schema.json`、
  `lib/`（Word 与审计模块）、`word/`、`assets/`、`tools/`、`tests/`、`LICENSE`、`NOTICE`。
- **不随包**：`.tools/`（约 312 MB 二进制：`pandoc.exe` 231 MB、`tectonic.exe` 49.6 MB、
  `biber.exe` 31.7 MB）、`lib/tests/`（上游单测）、`examples/`。
- **`tests/` 必须随包**（实测硬约束）：`build.ps1` 的 `Invoke-Checks` 在审计所选论文之外，
  还会**无条件**构建 `tests/smoke.tex` 与 `tests/smoke-science.tex`。缺了它们，
  `yibinthesis_check` 必然 exit 1——与用户论文的好坏无关。
- **边界**：vendored 副本是**发布快照**，不是软链。上游更新后需重新同步；
  `Config.templateRoot` 允许指向用户自己的上游检出。

### D3：工具链探测与 PATH 组合

沿用上游语义：`env YIBINTHESIS_*` → 配置目录 → PATH → 找不到。

插件在此之上补一层 **PATH 组合**：把以下目录注入子进程 PATH，使 `Get-Command` 能命中
① `Config.toolchainDirs`；② 项目 `.tools/` 下的版本化子目录（`biber-2.17/`、`pandoc-3.9.0.2/`）；
③ 插件包内 `.tools/`（用户自行放入时）。

**绝不**把「找不到」渲染成成功——`yibinthesis_doctor` 的 `ready` 直接来自脚本退出码。

### D4：结构化输出走 Python 适配器，不解析 PowerShell 文本

`build.ps1` 的 `doctor` 输出是给**人**看的。解析它等于把排版工具的日志格式当成 API。

`adapter/yibinthesis_probe.py` 直接 `import` vendored CLI 的纯函数，输出**唯一一个规范化 JSON**。
`build.ps1` 的 stdout 仍如实回传（截断后），但**不作为结构化字段的来源**。

适配器另有一个纯函数子命令 `strip`：把 LaTeX 剥成可见文字后再数汉字。
**为什么必须剥离**：直接对源码数字符会把 `\yibinopeningchapter` 这类命令名、
`\begin{cnabstract}` 环境名、注释、公式、逐字环境一起算进去——实测一个纯骨架的
附录文件被计成「20 字」。判据见 `count_han` / `count_han_prose` 与 `tests/han-count.test.mjs`。

### D5：自带 `defineTool`，运行期**零宿主依赖**

原计划是「动态 import 宿主 `@deepseek-ai/dsh-tools` 的 `defineTool`，拿不到就降级」。
这条路线**被实测推翻**，改为自带实现（`lib/tool-builder.js`）：

1. 宿主把 `@deepseek-ai/*` 以 junction 放在 profile 的 `node_modules` 下。实测环境中
   这 **225 个 junction 全部断链**（指向已不存在的旧安装目录）——**零个可达**。
2. 退一步把它声明为本包依赖**也不行**：profile 设了 `nodeLinker: hoisted`，
   pnpm 会提升该副本，而它要 import 自己的 peer `@deepseek-ai/cordis`，
   那里的 `cordis` 正是断链 junction → `ERR_MODULE_NOT_FOUND`。
   **实测：在已安装副本上真跑 `apply` 时，工具注册数 = 0。**

注册表消费的是 `ToolDefinition` 的**数据形态**，不是某个构造函数；官方 `defineTool`
本身也只是「编译 schema + 组装对象」的纯函数。故自带实现同一形态，
等价性由 `tests/local-toolbuilder.test.mjs` 用宿主**真实**的 `defineTool` 做递归全等比对
（parameters、output.schema、`required` 的出现/省略规则、顶层键集合）。
`@deepseek-ai/dsh-tools` 因此降级为 **devDependency**。

附带收益：自带的实现把**未知顶层键当作错误**（官方是静默忽略），
所以 `executionMode` 那类「写了但没生效」的配置在本包里写不出来。

**边界（如实）**：上游 DSL 若在未来版本发生不兼容变化，自带实现不会自动跟随。
这是刻意接受的代价，换取「插件在任何 profile 布局下都能注册工具」的确定性；
失效会被等价比对测试在升级 devDependency 时立刻暴露。

### D6：面板挂在**会话右侧栏**

面板讲的是「**当前会话的论文项目**」，属于会话级 UI。定位走过两次弯路，记下来避免重犯：

1. 只挂 `plugins.row.config` —— 要点「插件 → 已安装 → 找到该行 → 配置」四步，
   用户反馈「**面板在哪**」。
2. 改挂应用级侧栏 —— 找得到了，但**层级错了**：它不该和「插件 / 技能中心」并列。
   用户反馈：「**这个面板不应该在会话窗口的侧栏吗？**」
3. 现方案：注册到**会话右侧栏**，三件配对、共用同一个 id：

   | 作用 | 注册点 |
   | --- | --- |
   | 声明标签条目（含图标与 guide；没有它标签不出现） | `sidebarRightTabs.register({ id, kind, title, guide })` |
   | 标签正文 | 槽位 `sidebar.right.pane.tab`，key = id |
   | 标签标题头 | 槽位 `sidebar.right.pane.tab.title`，key = id |

主题令牌**只用**官方目录里存在的语义色（`--dsw-alias-*`）。
**不**使用未在目录中声明的令牌——曾用过一个「看起来合理」的 `label-dimmed`，
它在深色主题下对比度极低，用户反馈「**这种字根本看不清**」。

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

- 全部返回 `{ ok, ... }`，失败用 `ok:false` + `error.kind`/`error.message`，**不抛裸异常给模型**。
- 长任务用 `exec.signal` 转发取消；子进程被中止时回 `error.kind='cancelled'`。
- stdout/stderr **有上限**（`maxLogBytes`，默认 256 KB），截断时显式置 `truncated:true`。
- 工具链缺失时**如实失败**，不做「部分成功」。

## 3. 技能面

`skills/yibinthesis/SKILL.md` 是**路由**（何时用、怎么用、边界），
`references/` 按需加载（文档类型、项目配置、工具链、故障处置）。
技能注册是**硬依赖** `skills` 服务（`inject = ['skills', 'tools']`）；
`tools` 服务缺失时只 warn，技能照常可用——技能是「模型的路标」，它必须比工具更硬。

## 4. 面板的数据桥

client 半不直接读盘：它经 host 半注册的 HTTP 路由取数。

| 路由 | 方法 | 作用 |
| --- | --- | --- |
| `/state` | GET | 插件配置与当前项目概况（**带 `?projectDir=`**） |
| `/probe` | GET | 结构化项目摘要（走 Python 适配器） |
| `/deliverables` | GET | 交付物存在性 / 体积 / 时间 |
| `/deliverables` | **POST** | **设置产物输出名称**（唯一写操作，点击触发） |
| `/files` | GET | 项目文件清单（带分类，跳过构建产物目录） |
| `/doctor` | GET | 工具链就绪度 |

**为什么不从面板触发构建**：经 Web 路由触发编译会让权限面过大——任何能访问该端口的
页面都能让宿主编译写盘。构建一律由助手经工具发起，走正常的审批与取消链路。

写路由必须**显式登记**在 `BRIDGE_WRITE_ROUTES` 里，且由两条测试机械守住：

- `tests/bridge.test.mjs`：断言「除白名单外一律只读」；
- `tests/client-render.test.mjs`：断言**客户端写调用恰好只有一个**、必须挂在点击处理器里、
  且**不得**在 effect 中自动执行。

### 版本落差（运维须知）

**client 半随页面刷新更新，host 半要重启 DSH 才更新。** 两者不一致时会出现难排查的现象：
例如旧 host 的 `/files` 不返回分类字段，界面就会「显示 147 个、却一个文件也列不出来」。
因此客户端对旧版 host 做了**降级路径**（本地推导分类），并由测试固定住。

## 5. 测试

84 个用例，按关注点分文件。几条**刻意的**设计：

- **真渲染而非快照**：`tests/support/client-harness.mjs` 是一个迷你 React 渲染器，
  忠实实现 `createElement` 的变长 children、`useCallback` 记忆化、class 组件与渲染次数上限。
- **组件抛错必须可见**：React 在子组件抛错时会卸载整棵子树且不留痕迹——面板「一片空白」
  曾让我反复误判。故面板包了错误边界，测试也断言渲染期**不得有任何组件抛错**。
- **替身必须仿真真实行为**：测试桩曾因忽略 `?projectDir=` 参数而让「客户端忘了传目录」
  这个缺陷隐身；也曾因缺少 `localStorage` 桩而让「持久化没发生」隐身。
  改桩只证明桩变了——**断言请求参数与存储写入**才能防复发。
