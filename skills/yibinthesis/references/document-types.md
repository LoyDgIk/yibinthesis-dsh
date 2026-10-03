# 文档类型与版式参考

**本文件在什么时候需要读**：要判断一个项目是论文/开题报告/文献综述、要写对 `\documentclass` 选项与年份、要按学科选编号体系、要核对版式要点（页边距、字体、行距、三线表、引用与后置顺序）、或要向用户如实说明本实现的版式边界时读它。

## 1. 三种类型

| 文档类型 | 类选项 | 版式年份 | 用途 | 入口命令 | 版式来源 |
| --- | --- | ---: | --- | --- | --- |
| 毕业论文（设计） | `thesis`（可省略） | `2024` | 封面、声明、双语摘要、目录、正文、后置部分 | `\makeyibincover`、`\makeyibindeclarations` | 2024 论文模板与校级撰写规范 |
| 开题报告 | `proposal` | `2022` | 2022 工作表物理第 5–7 页的七个开题栏目 | `\makeyibinproposal` | 2022 工作表开题报告模块 |
| 文献综述 | `literature-review` | `2024` | 独立信息页 + 2024 正文版式 | `\makeyibinliteraturereviewcover` | 简洁信息页 + 2024 论文正文版式基线 |

来源：`docs/document-types.md:6-10`、`README.md:130-134`。

- 类选项写法：`\documentclass[<类型>,<学科>]{yibinthesis}`；`thesis` 是默认类型，旧写法 `\documentclass[humanities]{yibinthesis}` 仍有效（来源：`docs/document-types.md:23`）。
- 可用类选项全集：`thesis`、`proposal`、`literature-review`、`humanities`、`science`、`nobibliography`、`strictfonts`（来源：`yibinthesis.cls:39-51`）。
- 默认值：`--type` 默认 `thesis`，`--discipline` 默认 `humanities`（来源：`lib/yibinthesis_cli/app.py:30-31`）。
- 使用者**只需**加载 `yibinthesis` 类，类型模块由类自动加载，不需要手动 `\usepackage`（来源：`docs/document-types.md:16-19`）。
- 一个 `main.tex` 只生成一种文档；类型必须写在入口里，配置 JSON 中没有该字段（来源：`docs/document-types.md:3-4`、`yibinthesis.project.schema.json:4`）。

## 2. 年份是硬约束，不是兼容开关

- 期望年份由类型决定并写死在类里：`proposal` → `2022`，其余 → `2024`（来源：`yibinthesis.cls:216-224`）。
- `\yibinsetup{ template-year = ... }` 与期望值不等时抛 `\ClassError`：`Invalid template-year '#1' for document type '<类型>'`，构建停止（来源：`yibinthesis.cls:241-252`）。
- 语义是「登记当前文档真实采用的版式来源」，不会自动选择或混用其他年份（来源：`docs/format-basis.md:10`）。
- 当前**不支持 2025 论文模板**（来源：`docs/document-types.md:14`、`docs/format-basis.md:16`）。

## 3. 学科编号体系差异

| 层级 | `humanities`（人文社科） | `science`（理工农医） |
| --- | --- | --- |
| 一级 | `一、` | `1` |
| 二级 | `（一）` | `1.1` |
| 三级 | `1.` | `1.1.1` |
| 四级 | `（1）` | `1.1.1.1` |

来源：`README.md:136`；文献综述模板对照另见 `docs/template-audit-20261003.md:66-71`（文科一级 `一、`、二级 `（一）`、三级 `1.`）。

编号与标题排版还带来这些差异（来源：`docs/format-basis.md:22-26`）：

- `humanities`：一级标题三号黑体、左对齐并首行缩进两字；绪论后的每个一级标题另起一页；绪论与结论用居中、无编号标题。
- `science`：绪论**参与章编号**；结论单独成章但不加章号。
- 图、表、公式按章用点号编号，如 `图3.1`、`表4.2`、`（5.1）`。

## 4. 版式要点

| 项 | 值 | 来源 |
| --- | --- | --- |
| 纸张/装订 | A4 单面 | `yibinthesis.cls:108-119`；`README.md:137` |
| 页边距 | 上 2.5 cm、下 2.5 cm、左 3.0 cm、右 2.5 cm | `yibinthesis.cls:110-119` |
| 页眉/页脚几何 | `headheight=15pt`、`headsep=10mm`、`footskip=10mm` | `yibinthesis.cls:116-118` |
| 行距 | `\setstretch{1.5}` | `yibinthesis.cls:185` |
| 首行缩进 | 两字（`\parindent`），各级标题后的首段同样缩进 | `docs/format-basis.md:80` |
| 中文字体层级 | 正文/附录/致谢宋体小四（12 pt）；一级黑体三号（16 pt）加粗；二级楷体小三（15 pt）加粗；三、四级宋体四号（14 pt）加粗 | `docs/format-basis.md:78-91` |
| 西文字体 | Times New Roman | 同上 |
| 摘要/目录/绪论/结论/参考文献/附录/致谢标题 | 三号黑体居中 | `docs/format-basis.md:27-28` |
| 英文摘要 | Times New Roman 小四、1.5 倍行距、**顶格不缩进** | `docs/format-basis.md:85` |
| 图表标题 | 宋体五号（10.5 pt）居中；**图题在图下、表题在表上** | `docs/format-basis.md:88`；`docs/document-types.md:159-160` |
| 注释 | 宋体小五（9 pt）顶格，集中列于文末 | `docs/format-basis.md:89` |
| 参考文献 | 宋体五号（10.5 pt）、1.5 倍行距、悬挂缩进 | `docs/format-basis.md:90`；`yibinthesis.cls:969` |
| 页眉页码 | 宋体小五（9 pt）居中 | `docs/format-basis.md:91` |
| 表格 | 三线表；列宽/对齐用 `L/C/R/X/l/c/r/p/m/b` 列规格；普通单元格不继承正文缩进 | `docs/format-basis.md:36-37`、`docs/document-types.md:159-160` |
| 引用 | GB/T 7714-2015 顺序编码制；`biblatex` + `backend=biber` + `style=gb7714-2015` + `sorting=none` | `yibinthesis.cls:79-87`；`README.md:138` |
| 上标引用 | `\yibincite{key}` | `yibinthesis.cls:962-964` |
| 页码分节 | 目录独立分节且不显示页码；中英文摘要用大写罗马页码；正文从阿拉伯数字 1 重新开始 | `docs/format-basis.md:32-33` |
| 封面 | 保留官方校徽；主标题黑体 28 pt；题目与六行信息区按官方逐行坐标与不同线长排版，不显示日期 | `docs/format-basis.md:29-31` |
| 附录 | 每个 `\yibinappendix{标题}` 都是独立顶层附录并另起一页 | `docs/format-basis.md:38` |

### 后置部分顺序：致谢 → 参考文献 → 附录

- 两份材料本身不一致：2024 人文社科 Word 模板是「参考文献 → 附录 → 致谢」；2022 校级正式撰写规范是「致谢 → 参考文献 → 附录」。本项目**以校级正式撰写规范为准**（来源：`docs/format-basis.md:42-59`）。
- 有集中注释时，注释放在**致谢之后、参考文献之前**；`\printyibinnotes` 仅在确实有注释时才输出「注释」标题（来源：`docs/format-basis.md:57`；`yibinthesis.cls:945-958`）。
- 顺序由 `main.tex` 装配，不需要改类文件；脚手架生成的顺序即：

```tex
\backmatter
\input{chapters/99-acknowledgements}
\printyibinnotes
\printyibinbibliography
\input{chapters/90-appendix}
```

（来源：`lib/yibinthesis_cli/scaffold.py:132-136`、`docs/format-basis.md:49-55`）

### Word 侧样式

- 提供「宜宾论文-正文」「宜宾论文-一级标题」至「宜宾论文-四级标题」「宜宾论文-图题」「宜宾论文-表题」「宜宾论文-续表题」及表格正文、表头、参考文献、文献上标等可复用样式（来源：`docs/format-basis.md:93-101`）。
- 自定义标题样式**独立于** Word 内置 `Heading 1`–`Heading 4`，内置样式名称与定义不被改写；不要求自定义标题出现在 Word「交叉引用」的「标题」列表中（来源：`docs/format-basis.md:96-98`、`docs/document-types.md:187-192`）。

## 5. `proposal` 的七个开题栏目

入口必须先 `\makeyibinproposal`，随后按下列顺序、各恰好一次调用 `\yibinproposalfield{字段键}{内容}`（来源：`docs/document-types.md:84-99`、`yibinthesis-proposal.sty:198-209`）：

| 顺序 | 字段键 | 栏目名 | 模板提示语 |
| ---: | --- | --- | --- |
| 1 | `significance` | 选题意义 | 无 |
| 2 | `research-status` | 国内外研究现状概述 | 国内、国外研究现状应分开概述；概述时语言简练、重点突出。 |
| 3 | `research-content` | 主要研究内容 | 无 |
| 4 | `research-approach` | 拟采用的研究思路 | 主要描述研究方法、技术路线、可行性论证等。 |
| 5 | `schedule` | 研究工作安排及进度 | 进度（应与二级学部（院）的进度大体一致） |
| 6 | `references` | 参考文献目录 | 根据《信息与文献—参考文献著录规则》（GB/T 7714--2015），规范表述。 |
| 7 | `advisor-opinion` | 指导教师意见 | 无 |

来源：`yibinthesis-proposal.sty:91-138`（栏目名与提示语逐字）。

其他 `proposal` 事实：

- 未知字段键 → LaTeX 侧抛 `Unknown proposal field '<键>'`，并提示合法键名（来源：`yibinthesis-proposal.sty:202-207`）。
- 「七个、顺序固定、各一次」由 **Word 链路**机械校验：字段顺序表 `PROPOSAL_FIELD_ORDER` 就是上表的七键顺序（来源：`lib/word_core.py:367-375`），`extract_proposal_fields()` 依次检查重复（`开题报告字段重复：`）、未知（`未知开题报告字段：`）、缺失（`开题报告字段缺失：`）、顺序（`开题报告字段顺序必须为：`），任一不满足即 `BuildError`（来源：`lib/word_core.py:378-408`）。LaTeX 侧只校验键名合法性，不校验顺序。
- 页码从**第 4 页**开始：封面不参与页码，`\pagenumbering{arabic}` + `\setcounter{page}{4}`（来源：`yibinthesis-proposal.sty:180-186`）。
- 只复刻 2022 工作表物理第 5–7 页的开题栏目，**不生成**工作表封面、任务书、中期检查表、指导记录表（来源：`docs/document-types.md:82-84`）。
- 不插入「可续页」字样，也不按官方示例的三张物理页强制分页；实际页数由内容自然决定（来源：`docs/document-types.md:83-85`）。
- 字段内**不要用普通浮动体**；图片用 `\yibinproposalfigure[宽度]{文件}{题注}{label}`，表格用 `yibinproposaltable` 环境，`references` 栏目内容写成 `\printyibinproposalbibliography`（来源：`docs/document-types.md:124-143`；`yibinthesis-proposal.sty:213-235`）。
- 导师意见默认留空；只有配置了 `advisor-signature` 才会在签名槽使用图片（来源：`docs/document-types.md:121-122`）。
- 元数据必须 `template-year = 2022`；2022 是开题工作表版本，不是 2024 毕业论文模板（来源：`docs/document-types.md:87-88`）。

## 6. `literature-review` 的独立信息页与 2024 版式

- 生成一页简洁信息页（封面），**不生成**论文原创性声明、版权授权书、摘要和目录（来源：`docs/document-types.md:170-172`）。
- 正文采用 2024 论文正文版式基线，因此 `template-year = 2024`；页码从阿拉伯数字 1 开始（来源：`docs/document-types.md:170-172`）。
- 正文可使用 `\chapter`、`\section`、`\subsection`、`\subsubsection`（来源：`docs/document-types.md:187`）。
- 入口三行结构：`\makeyibinliteraturereviewcover` → `\input{chapters/body}` → `\printyibinbibliography`（来源：`lib/yibinthesis_cli/scaffold.py:105-115`）。
- 官方 2024 模板的硬参数（OOXML 只读拆解所得，供核对用）：4 个 A4 竖版分节，页面 `11906×16838 twips`（210×297 mm）；左 1701 twips（约 3.0 cm），右/上/下各 1418 twips（约 2.5 cm）；页眉/页脚距边 851 twips（15.0 mm）；第 3 节有独立的首页页眉/页脚标记。封面后是「毕业论文题目—姓名—单位」信息段，随后中文摘要、关键词、英文摘要、英文关键词，再进入**不少于 3000 字**的正文（来源：`docs/template-audit-20261003.md:25-34`、`docs/document-types.md:148-156`）。
- 工科类与文科类只在标题编号和个别说明文字上不同（来源：`docs/document-types.md:157-158`）。

## 7. `strictfonts` 选项

- 默认模式优先用宋体（SimSun）、黑体（SimHei）、楷体（KaiTi）、Times New Roman；某个字体不存在时回退到 Fandol 系列与 TeX Gyre Termes 等兼容字体，并打 `\ClassWarning`（`Font '<名>' was not found; using a compatible preview font`）（来源：`yibinthesis.cls:121-174`）。
- 加 `strictfonts` 后，同一个缺失点改为抛 `\ClassError`：`Required font '<名>' was not found`，提示「装学校指定字体，或去掉 `strictfonts` 做预览构建」（来源：`yibinthesis.cls:124-133`）。
- 用法：`\documentclass[humanities,strictfonts]{yibinthesis}`（来源：`docs/format-basis.md:66-71`）。
- 也就是说：**默认不拦，只警告**；`strictfonts` 的作用是防止把兼容字体预览当成最终提交版（来源：`docs/format-basis.md:70-71`）。

## 8. 边界（如实告知，不要含糊）

- 本工具是**非官方**实现，不重新分发学校原始文件，不代表宜宾学院官方认证（来源：`docs/format-basis.md:3`、`:109-110`）。
- **学校、学院、专业或指导教师的新通知优先于本项目**（来源：`docs/format-basis.md:109`）。
- 模板只能降低机械排版成本，**不能替代提交前的人工核对**（来源：`docs/format-basis.md:110`）。
- `thesis` 的默认版式主要参考《附件：毕业论文（设计）模板（人文社科类）2024.docx》，并用校级《本科毕业论文（设计）撰写规范》补充理工农医编号、页边距、图表公式、注释和参考文献规则（来源：`docs/format-basis.md:3-5`）。
- 2024 Word 文件个别示范文字的直接格式与其括号内说明不一致（例如三级标题示范运行字号小于标注的「四号」）；此类冲突优先采用校级撰写规范和模板中的文字说明（来源：`docs/format-basis.md:103-105`）。
- 学校模板大量使用直接格式而非完全依赖 `Heading` 样式，因此**不能仅凭 Word 样式名判断合规**（来源：`docs/document-types.md:161-163`）。

### 已记录的已知版式差距（上游自述，报给用户时不要掩饰）

- `proposal`：当前实现只生成 1 个 Word 分节，没有样例的封面分节 + 正文分节；页面几何用的是旧开题工作表布局（`top=70.9pt, bottom=51.05pt, left=85.05pt, right=62.35pt`），与样例 S1 的 `1440/1440/1800/1800 twips` 不一致；七个栏目装进一个 7 行表、列宽 `1.52/14.23 cm`，未复现样例的 3 张表、不同表格行高和封面信息区。`yibinthesis-proposal.sty` 也使用旧布局几何，因此 PDF **不会**与新样例逐页一致（只有「页码从第 4 页开始」是对的）（来源：`docs/template-audit-20261003.md:98-107`）。
- `literature-review`：官方模板是 4 个分节，当前 DOCX 后处理只生成 2 个分节（信息页 + 正文），且未完全复现封面/正文/参考文献/尾页的 `PAGE` 域与 `titlePg` 行为；静态字体审计通过**不能**消除这个结构差异（来源：`docs/template-audit-20261003.md:60-62`）。
- 三份源模板的逐页 PNG 视觉对照**尚未完成**（本机无 Word/LibreOffice 时无法做），属于交付前必须补做的视觉风险，不能仅以 OOXML 静态检查替代（来源：`docs/document-types.md:165-168`）。
- 总评（上游自述）：当前实现「覆盖了文献综述和开题报告的语义入口、字体层级、题注、引用和基本分页能力」，**不能**说「已经满足这三份新 DOCX 模板的完整格式要求」（来源：`docs/template-audit-20261003.md:111-112`）。

## 9. 未证实 / 需要留意

- `science` 在**开题报告**与**文献综述**中的具体编号呈现：`docs/format-basis.md:22-26` 描述的是 `thesis` 的默认取舍；`proposal` 的七栏目本身不带标题编号。两份材料按学科组合时的实际呈现标为**未证实**。
- 「文献综述正文不少于 3000 字」只出现在官方模板的拆解结论里（`docs/document-types.md:156`），本工具的脚手架不会做字数校验；`yibinthesis_check` 是否拦截未达标正文**未证实**——已证实的是 `check` 会做一次类文件/Word 构建器/参考样式/校徽的格式审计，并对 `tests/smoke.tex`、`tests/smoke-science.tex` 做回归冒烟构建（来源：`build.ps1:1048-1125`）。
- 注释接口：`\yibinnote{内容}` 自增计数器并输出上标带圈序号，内容存入编号槽；`\printyibinnotes` 仅在计数器大于 0 时输出「注释」标题，然后逐条以「带圈序号 + 内容」的顶格段落列出（`\yibinsong\zihao{5}`，即宋体五号）（来源：`yibinthesis.cls:935-958`）。文末注释放在致谢之后、参考文献之前（来源：`docs/format-basis.md:57`）。
- 各文档类型在 Word 侧的**分节数**对照：`proposal`（本实现 1 节 vs 官方样例 2 节）与 `literature-review`（本实现 2 节 vs 官方模板 4 节）已知不一致；`thesis` 的分节对照未在 `docs/template-audit-20261003.md` 中给出结论，标为**未证实**。
- `check` 的构建基准是**工具运行时根**（`$ProjectRoot`）：它会审计类文件/Word 构建器/参考样式/校徽，并要求 `tests/smoke.tex`、`tests/smoke-science.tex` 存在（来源：`build.ps1:1048-1125`）。随包副本 `vendor/yibinthesis/` 里**没有** `tests/` 目录，所以该命令在插件默认 `templateRoot` 下能否走完，标为**未证实**；要跑 `check` 请把 `templateRoot` 指向完整的上游检出。
