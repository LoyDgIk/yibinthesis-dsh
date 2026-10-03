---
name: yibinthesis
description: 宜宾学院本科毕业材料（毕业论文/开题报告/文献综述）的 LaTeX 排版工具 YibinThesis。用于新建论文项目骨架、检查 LaTeX/Word 工具链就绪度、构建 PDF 与 DOCX、以及按学校规范审计版式。当用户提到宜宾学院、毕业论文排版、yibinthesis、学位论文 LaTeX、开题报告或文献综述的模板与构建时使用。
whenToUse: 用户要创建、构建、检查或排查一个 YibinThesis 论文项目；需要生成符合宜宾学院规范的 PDF/DOCX；需要知道当前机器缺哪个排版工具；或需要按学校模板审计版式时。纯内容写作（不涉及排版与构建）不需要本技能。
---

# YibinThesis —— 宜宾学院毕业材料排版

`YibinThesis` 是一个**非官方**的 LaTeX 排版工具，只维护文档类、转换器、检查器与命令行程序，
**不保存任何论文稿件**。论文源文件位于工具仓库**之外**的独立项目目录里。

> **首要规则：先 `yibinthesis_probe`，再动手。**
> 项目目录、文档类型、学科编号体系、章节清单都在项目自己的配置与入口文件里。
> 猜目录或猜文档类型是最常见的错误来源——本项目刻意**不**默认使用当前工作目录。

## 决策流程

```
需要做什么？
├─ 不确定项目长什么样 / 第一次接触这个项目 ──→ yibinthesis_probe
├─ 要新建项目 ──────────────────────────────→ yibinthesis_new（先 dry_run）
├─ 要出 PDF/DOCX ───────────────────────────→ yibinthesis_doctor 先查就绪度
│                                              就绪 → yibinthesis_build
│                                              未就绪 → 按 hints 补齐工具链，不要反复重试
├─ 要按学校规范检查版式 ────────────────────→ yibinthesis_check
└─ 要清掉构建产物 ──────────────────────────→ yibinthesis_clean
```

## 工具

| 工具 | 用途 | 写盘 |
| --- | --- | --- |
| `yibinthesis_probe` | 项目摘要：配置、入口、元数据、章节与字数、交付路径 | 否 |
| `yibinthesis_doctor` | 工具链就绪度 + 缺什么 + 怎么补 | 否 |
| `yibinthesis_new` | 新建项目骨架（支持 `dry_run`） | 是 |
| `yibinthesis_build` | 构建 `pdf` / `word` / `all` | 是 |
| `yibinthesis_check` | 结构与格式检查 | 是（仅构建输出目录） |
| `yibinthesis_clean` | 清理构建产物 | 是（仅构建输出目录） |

## 三种文档类型（由入口的 `documentclass` 选项决定）

| 类型 | 类选项 | 版式年份 | 用途 |
| --- | --- | ---: | --- |
| 毕业论文（设计） | `thesis` | 2024 | 封面、声明、双语摘要、目录、正文、后置部分 |
| 开题报告 | `proposal` | 2022 | 工作表中的七个开题栏目 |
| 文献综述 | `literature-review` | 2024 | 独立信息页与 2024 正文版式 |

学科决定编号体系：`humanities` 用「一、/（一）/1./（1）」；`science` 用「1/1.1/1.1.1/1.1.1.1」。
**类型与年份的对应关系固定，不能混用**——`proposal` 永远是 2022，其余是 2024。

## 工具链：三层探测，缺了会**如实报错**

外部工具（Tectonic/XeLaTeX/Latexmk、Biber、Pandoc、Python 及 python-docx/Pillow）按以下顺序解析：

1. 环境变量 `YIBINTHESIS_TECTONIC` / `YIBINTHESIS_BIBER` / `YIBINTHESIS_PANDOC` /
   `YIBINTHESIS_PYTHON` / `YIBINTHESIS_LATEXMK` / `YIBINTHESIS_XELATEX`；
2. 插件与项目的 `.tools/` 目录、以及本机已知缓存路径；
3. `PATH`。

**两条硬约束**：

- **Biber 必须是 2.17**。Tectonic 0.16.9 的 BCF 3.8 工作流与 2.21 **不兼容**，用错版本构建会失败。
- **构建绝不会「部分成功」**。缺工具时 `yibinthesis_build` 返回 `ok:false` 并给出可操作提示；
  **不要**把这种失败当成偶发问题反复重试，先按 `hints` 补齐。

PDF 是版式主输出；DOCX 用于继续编辑（Word 域刷新与重新分页需要本机安装 Microsoft Word）。

## 失败处置（先看 `kind` 字段）

| `kind` | 含义 | 怎么办 |
| --- | --- | --- |
| `missing-toolchain` | 缺外部工具或 Python 模块 | 按返回的 `hints` 逐条补齐；Biber 认准 2.17 |
| `project-invalid` | 目录/配置/入口不合法 | 先用 `yibinthesis_probe` 确认；可能根本不是 YibinThesis 项目 |
| `spawn-denied` | 宿主禁止派生子进程 | 改用 `pwsh` 直接调 `<插件>/vendor/yibinthesis/build.ps1` |
| `cancelled` / `timeout` | 被取消 / 超预算 | 首次 Tectonic 构建要下载宏包，可能数分钟；重跑一次即可（宏包已缓存） |
| `cli-missing` | 缺上游 CLI 源码 | `yibinthesis_new` 需要它：设配置项 `cliRoot` 或环境变量 `YIBINTHESIS_CLI_ROOT` |
| `build-failed` | 其它构建失败 | 看 `log` 与 `stderr` 尾部；LaTeX 错误在 `log` 里 |

## 边界（如实告知用户，不要含糊）

- 本工具是**非官方**实现。学校、学院或专业的新通知**优先于**本工具；
  提交前仍需由指导教师或所在学院复核。
- 版式依据为 2024 人文社科/理工农医模板与宜宾学院本科毕业论文（设计）撰写规范。
- 缺少学校字体时默认使用兼容字体预览；最终提交可在 `\documentclass` 加 `strictfonts` 强制检查。
- 校名、校徽等机构标识**不在 MIT 授权范围内**（见随包 `vendor/yibinthesis/NOTICE`）。

## 参考

- `references/project-config.md` —— 项目配置字段、目录布局、交付文件占位符
- `references/toolchain.md` —— 工具链安装与探测细节、环境变量清单
- `references/document-types.md` —— 三种文档类型与版式差异
