# 项目配置参考

**本文件在什么时候需要读**：需要看懂或修改一个 YibinThesis 论文项目的 `yibinthesis.project.json`、想知道某个路径按谁解析、想改交付文件命名、或要新建/覆盖项目骨架时读它。

## 1. 权威契约

- 唯一权威 schema：上游 `yibinthesis.project.schema.json`（JSON Schema draft 2020-12）。
- 配置文件固定名称 `yibinthesis.project.json`，由 CLI 常量 `PROJECT_CONFIG_NAME` 定义（来源：`lib/yibinthesis_cli/runtime.py:11`）。
- 生成标记固定名称 `.yibinthesis-cli.json`，由 CLI 常量 `GENERATED_MARKER_NAME` 定义（来源：`lib/yibinthesis_cli/runtime.py:12`）。
- **项目根 = 配置文件所在目录**。`new` 生成的配置一律写在项目根，所以「项目根」与「配置文件目录」在本工具生成的布局里是同一个目录（来源：`lib/yibinthesis_cli/scaffold.py:205`）。

## 2. 字段逐项说明

| 字段 | 类型 | 必填 | 默认值 | 语义 | 相对路径按谁解析 |
| --- | --- | --- | --- | --- | --- |
| `$schema` | string | 否 | 无（schema 未给默认值） | 仅给编辑部补全/校验用；构建器**完全不读**它 | 不参与构建路径解析 |
| `schemaVersion` | 整数常量 `1` | **是** | 1 | 配置格式版本 | 不适用 |
| `main` | string（非空） | **是** | 无 | 唯一 LaTeX 入口，必须存在且扩展名为 `.tex` | 配置文件所在目录 |
| `outputRoot` | string（非空） | 否 | 见下方「默认值陷阱」 | `pdf`/`word` 与临时产物的构建根目录 | 配置文件所在目录 |
| `checkOutputRoot` | string（非空） | 否 | 省略时取 `outputRoot` | **只**给 `check` 命令用；其它命令忽略 | 配置文件所在目录 |
| `citationMode` | `linked` \| `native` | 否 | `linked` | Word 引用模式 | 不适用 |
| `wordRefresh` | `auto` \| `always` \| `never` | 否 | `auto` | Word 域更新与重新分页策略 | 不适用 |
| `deliverables` | object（可省略） | 否 | 无（省略即不发布稳定副本） | 成功构建后把产物复制到的稳定路径 | 配置文件所在目录 |
| `deliverables.pdf` | string，必须以 `.pdf`/`.PDF` 结尾 | 否 | 无 | PDF 交付路径，支持 `{{field}}` 占位符 | 配置文件所在目录 |
| `deliverables.word` | string，必须以 `.docx`/`.DOCX` 结尾 | 否 | 无 | DOCX 交付路径，支持 `{{field}}` 占位符 | 配置文件所在目录 |

来源：`yibinthesis.project.schema.json:8-23`（字段、类型、默认值、`additionalProperties:false`）、`build.ps1:226-293`（读取与校验）、`build.ps1:43-56`（`Get-FullPath` 的基准拼接）。

关键判定细节：

- `schemaVersion` 不等于整数 `1` → 抛 `Unsupported YibinThesis project config schemaVersion`（来源：`build.ps1:226-229`）。
- `documentclass` 必须写 `.tex` 路径；不是 `.tex` → 抛 `LaTeX entry point must be a .tex file`；文件不存在 → 抛 `LaTeX entry point not found`（来源：`build.ps1:316-321`）。
- `citationMode`/`wordRefresh` 出现表外取值 → 抛错停止（来源：`build.ps1:258-260`、`build.ps1:268-270`）。
- 交付路径扩展名不符 → 抛 `Configured PDF deliverable must end in .pdf` / `Configured Word deliverable must end in .docx`（来源：`build.ps1:281-283`、`build.ps1:288-290`）。
- 根层级和 `deliverables` 层级都禁止未知键（`additionalProperties:false`，来源：`yibinthesis.project.schema.json:6`、`:18`）。

### 默认值陷阱：省略 `outputRoot` 不会落在项目根

`build.ps1` 只在配置文件**给出了** `outputRoot` 时把它解析到项目根下；省略时回落到 `Join-Path $ProjectRoot 'build'`，而 `$ProjectRoot` 是**工具运行时根**（模板仓库或插件随包副本），不是论文项目（来源：`build.ps1:295-303`、`build.ps1:30`）。CLI 脚手架总会写出 `"outputRoot": "build"`，正常项目不会踩到；手写配置时不要省略它，也不要指望默认值指向你的项目。

相对路径解析还有两处例外，必须在排查「产物跑到别处去了」时记住：

- 命令行 `-OutputRoot <相对路径>` 不按配置文件目录解析，而按**工具运行时根**拼接（来源：`build.ps1:301-302`）。
- 交付占位符扩展出的**目录部分**仍按配置文件目录解析（来源：`build.ps1:280`、`build.ps1:287`）。

### 从外部 LaTeX 入口构建时的产物位置

若入口文件不在工具运行时根内部，构建布局会隔离到 `build/pdf/external/<安全化名称>-<短哈希>/<jobname>.pdf`，其中 `<安全化名称>` 由入口父目录名 + 入口名 + 路径短哈希拼成（来源：`build.ps1:356-363`）。本工具生成的项目属于这种情况，所以「PDF 在 `outputRoot/pdf/` 下」只是近似说法，以实际布局为准。

## 3. 文档类型不写在配置里

- 类型由**入口文件的 `\documentclass` 选项**决定，配置里没有 `documentType`/`template-year` 字段（来源：`yibinthesis.project.schema.json:4` 描述、「无该字段」；`yibinthesis.cls:39-51`）。
- 版式年份写在 `metadata.tex` 的 `\yibinsetup{ template-year = ... }`，取值必须与类型匹配，否则 LaTeX 直接抛类错误（来源：`yibinthesis.cls:216-252`）。
- 一个配置文件只指向一个入口。论文、开题报告、文献综述各放独立目录、各维护一份配置（来源：`docs/project-config.md:139-151`）。

## 4. 交付文件名占位符 `{{field}}`

- 取值来源：**入口文件同目录**的 `metadata.tex`（来源：`build.ps1:275-277`）。
- 占位符语法 `{{字段名}}`，字段名须匹配 `[A-Za-z][A-Za-z0-9_-]*`（来源：`build.ps1:180`）。
- 匹配规则：从 `metadata.tex` 里按行找 `字段名 = {值}`（可带行尾逗号），反斜杠转义的 `\_ \# \% \& \{ \}` 会被还原（来源：`build.ps1:161-168`）。
- 值经文件名安全化：非 `字母/数字/._-` 的字符折叠为 `-`，首尾 ` .-_` 裁掉，长度截到 80，结果为空则用 `document`（来源：`build.ps1:95-110`）。
- **缺失即失败（刻意的安全设计）**：`metadata.tex` 不存在 → 抛 `Metadata file required by deliverable template was not found`；字段名找不到 → 抛 `Metadata field '<name>' was not found`。两种情况都不会发布带未替换占位符的错名文件（来源：`build.ps1:157-165`）。

### `metadata.tex` 的可引用字段名列（按脚手架生成顺序）

| 字段名 | 脚手架未传参时的值 | 说明 |
| --- | --- | --- |
| `template-year` | `2022`（proposal）/ `2024`（其余） | 版式年份，不是自由项 |
| `title` | `（填写中文题目）` | 中文题目 |
| `english-title` | `Title in English` | 英文题目 |
| `author` | `（填写姓名）` | 姓名 |
| `student-id` | `（填写学号）` | 学号 |
| `college` | `（填写学院）` | 学院 |
| `major` | `（填写专业）` | 专业 |
| `grade` | `（填写年级）` | 年级 |
| `class-name` | 空 | 班级 |
| `advisor` | `（填写校内导师）` | 校内导师 |
| `advisor-title` | `（填写职称）` | 导师职称 |
| `external-advisor` | 空 | 校外导师 |
| `external-advisor-title` | 空 | 校外导师职称 |
| `version` | 空 | 版本 |
| `date` | 空 | 日期 |
| `secrecy` | `public` | 非花括号值 |
| `declassify-year` | 空 | 解密年份 |
| `logo` | `builtin` | 非花括号值；`builtin` 展开为 `assets/yibin-university-logo.png` |
| `author-signature` | 空 | 路径值，`\` 统一改成 `/` |
| `advisor-signature` | 空 | 路径值 |
| `signature-background` | `preserve` | 非花括号值 |

来源：`lib/yibinthesis_cli/scaffold.py:59-85`（`metadata_tex()` 的键名与占位符）、`yibinthesis.cls:226-259`（键语义、`logo=builtin` 展开）。

边界：

- `{{field}}` 扩展只按 `字段名 = {值}` 取值，因此裸值键（`secrecy`/`logo`/`signature-background`）和嵌套对象（`title={a{b}c}`）**取不到**或只能取到内层文本；把这几项放进交付文件名属于未证实可用。
- 未在 `\yibinsetup` 中出现的键**不会**获得脚手架占位符：占位符只由 `metadata_tex()` 写入，模板侧的键表只做「键 → 内部变量」的赋值（来源：`lib/yibinthesis_cli/scaffold.py:59-85`、`yibinthesis.cls:226-259`）。手写 `metadata.tex` 时请照抄字段名。
- `deliverables` 只被 `pdf`/`word`/`all` 命令发布；`check`/`doctor`/`clean` 不发布（来源：`build.ps1:1396-1409`）。

## 5. `yibinthesis new` 生成的目录树

```
<目标目录>/
├── yibinthesis.project.json        # 见第 2 节
├── .yibinthesis-cli.json           # 生成标记：tool/version/documentType/discipline/files
├── .gitignore                      # build/、*.aux、*.bbl、*.bcf、*.blg、*.log、*.run.xml、*.synctex.gz
├── README.md
├── latex/
│   ├── main.tex                    # 唯一入口，含 \documentclass[<类型>,<学科>]{yibinthesis}
│   ├── metadata.tex                # \yibinsetup{...}，见第 4 节
│   ├── references.bib
│   ├── assets/.gitkeep
│   └── chapters/                   # 按类型铺设，见下表
└── build/                          # 由配置的 outputRoot 指定，脚手架本身不创建
```

`chapters/` 的内容按类型不同（来源：`lib/yibinthesis_cli/scaffold.py:141-154`、`:88-138`）：

| 文档类型 | 生成的章节文件 |
| --- | --- |
| `thesis` | `00-abstract-cn.tex`、`01-abstract-en.tex`、`10-introduction.tex`、`20-body.tex`、`30-conclusion.tex`、`90-appendix.tex`、`99-acknowledgements.tex` |
| `literature-review` | `body.tex` |
| `proposal` | 无（七个栏目直接写在 `main.tex` 里） |

**生成的项目里没有**：

- `build.ps1`（构建器来自工具运行时：模板仓库根，或插件随包副本 `vendor/yibinthesis/`）
- `yibinthesis.cls` / `yibinthesis-*.sty`（文档类与模块来自工具运行时）
- `lib/`、`word/reference.docx`、`tools/`、`assets/`（Word 与审计模块、参考样式、工具脚本、校徽均来自工具运行时）

来源：`README.md:60`（「不会复制 `build.ps1`、模板类或工具源码」）、`docs/project-config.md:3-5`、`docs/document-types.md:203-204`。

产物构建位置（`build.ps1 -Main` 指向项目外入口的情形）见第 2 节末尾。`build/.template-runtime` 是外部入口场景下工具复制出来的模板搜索根（来源：`build.ps1:366-371`）。

## 6. `new` 的选项与边界

选项面（来源：`lib/yibinthesis_cli/app.py:28-37`）：

| 选项 | 取值 / 默认 |
| --- | --- |
| `target`（位置参数） | 项目目录，**必须位于工具仓库之外** |
| `--type` | `thesis`（默认）/ `proposal` / `literature-review` |
| `--discipline` | `humanities`（默认）/ `science` |
| `--secrecy` | `public`（默认）/ `confidential` |
| `--signature-background` | `preserve`（默认）/ `whiten` |
| `--title` `--english-title` `--author` `--student-id` `--college` `--major` `--grade` `--class-name` `--advisor` `--advisor-title` `--external-advisor` `--external-advisor-title` `--version` `--date` `--declassify-year` `--author-signature` `--advisor-signature` | 自由文本，默认留占位符 |
| `--dry-run` | 只打印「将创建或更新：」及计划路径，返回码 0，不写盘 |
| `--force` | 只允许覆盖 `.yibinthesis-cli.json` 的 `files` 列表里登记过的文件 |

`--dry-run` / `--force` 的精确语义（来源：`lib/yibinthesis_cli/scaffold.py:177-209`）：

- `--dry-run`：`target.mkdir` 也在写盘分支里，所以预览不会创建目录。
- 目标目录**非空且没有本工具的生成标记**时，即使给 `--force` 也不覆盖，直接抛 `目标目录非空，未覆盖已有内容`。
- 有生成标记时，`--force` 只覆盖标记里登记过的文件；**不删除**目录中其它内容，也不清理不再使用的旧文件。
- 生成过程中撞到未登记的同名文件仍会抛 `目标文件已存在，拒绝覆盖：<path>`。
- 工具仓库自身作为目标：`is_inside(target, resource_root())` 为真即抛 `论文项目必须创建在工具仓库之外：<path>`。所以 `<上游检出>` 及其子目录都不能作为 `new` 的目标（来源：`lib/yibinthesis_cli/scaffold.py:179-180`、`lib/yibinthesis_cli/runtime.py:52-57`）。
- 生成标记内容：`{tool, version, documentType, discipline, files[]}`，`version` 取自 `CLI_VERSION`（当前 `0.3.0`，来源：`lib/yibinthesis_cli/runtime.py:10`）。

CLI 退出码（来源：`docs/project-config.md:114-116`、`lib/yibinthesis_cli/app.py:74-82`）：

| 码 | 含义 |
| ---: | --- |
| 0 | 命令完成（`new` 成功创建也会打印计划/结果后返回 0） |
| 2 | 用户输入、项目配置或运行时依赖不满足（含「项目目录不存在」「找不到项目配置」「未找到 PowerShell」） |
| 130 | 用户中断（`Ctrl+C`） |

## 7. 未证实 / 需要留意

- 配置文件用相对路径 `../` 指到工具仓库里的 `yibinthesis.project.schema.json` 是允许的（`$schema` 不参与构建），但 schema 里 `$schema` 的定位在当前脚手架里由 `schema_path()` 相对 `resource_root()` 现算，值**不是固定字符串**（来源：`lib/yibinthesis_cli/runtime.py:60-65`、`scaffold.py:50`）。
- 模板自身是否对 `metadata.tex` 做完整键校验：`yibin`/`metadata` 键表已完整列举（`yibinthesis.cls:226-259`），但「漏写某个键时模板是否给默认值」未逐个实测，标为**未证实**。
