#!/usr/bin/env python3
"""yibinthesis-dsh 的 Python 适配器：把项目状态的**结构化**读取集中在这一处。

为什么需要它（设计依据见 docs/ARCHITECTURE.md D4）
--------------------------------------------------
上游 `build.ps1 -Command doctor` 的输出是**给人看的**，形如::

    [OK]      Tectonic (optional) - C:\\...\\tectonic.exe [known local path] | Tectonic 0.17.0

把它当 API 解析，等于把排版工具的日志格式钉进插件契约。因此：

* **就绪度**仍然只取自 `build.ps1` 的退出码（0 = READY，2 = NOT READY），那是权威；
* **项目状态的读取**（配置、入口、章节、元数据、产出路径）走本适配器直读文件系统，
  输出**唯一一个**规范化 JSON 对象到 stdout；
* `new`（脚手架）**不重实现**，而是复用上游 CLI 的 `yibinthesis_cli.scaffold`——
  业务逻辑只有一份真源，插件不做第二份会漂移的副本。

输出契约
--------
stdout **只**打印一个 JSON 对象：成功 `{"ok": true, ...}`，可预期错误
`{"ok": false, "error": {"kind": ..., "message": ...}}`。
退出码：`0` 成功；`2` 可预期的用户错误；`70` 适配器自身故障（未捕获异常）。
任何诊断信息一律走 stderr，绝不污染 stdout 的 JSON。

环境变量
--------
``YIBINTHESIS_TEMPLATE_ROOT``  随包模板运行时根（用于解析产出布局与 schema 路径）。
``YIBINTHESIS_CLI_ROOT``       上游 YibinThesis 检出根（提供 ``lib/yibinthesis_cli``，`new` 需要）。
"""

from __future__ import annotations

import argparse
import io
import json
import os
from pathlib import Path
import re
import sys

# Windows 控制台默认可能是 GBK；本适配器的输出含中文，必须钉死 UTF-8。
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

EXIT_OK = 0
EXIT_USER_ERROR = 2
EXIT_ADAPTER_ERROR = 70

PROJECT_CONFIG_NAME = "yibinthesis.project.json"
SCHEMA_VERSION = 1


class AdapterError(Exception):
    """可预期的用户级错误（输入/环境不合法），映射为 EXIT_USER_ERROR。"""

    def __init__(self, kind: str, message: str) -> None:
        super().__init__(message)
        self.kind = kind
        self.message = message


def emit(payload: dict) -> None:
    """把唯一一个 JSON 对象写到 stdout（不换行美化，便于管道消费）。"""
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


# ──────────────────────────────────────────────────────────────────────────
# 元数据解析
# ──────────────────────────────────────────────────────────────────────────

# `metadata.tex` 由 <metadata>{\n  key = {value},\n ... } 构成（见上游 scaffold.py:59-90）。
# 这里只提取扁平的一层 `key = {value}`，足够读取封面字段；不做完整 TeX 解析。
_META_BLOCK = re.compile(r"\\yibinsetup\s*\{", re.IGNORECASE)
_META_FIELD = re.compile(r"^\s*([a-z][a-z0-9-]*)\s*=\s*\{(.*?)\}\s*,\s*$", re.MULTILINE)


def parse_metadata(path: Path) -> dict[str, str]:
    """从 `metadata.tex` 提取 `\\yibinsetup{...}` 里的扁平字段。

    边界（如实）：只支持上游脚手架生成的 `key = {value},` 形态；手写成多行嵌套花括号的
    字段会被跳过而不是猜测。缺文件时返回空字典（**不**报错——元数据缺失本身不是错误）。
    """
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return {}
    if not _META_BLOCK.search(text):
        return {}
    fields: dict[str, str] = {}
    for match in _META_FIELD.finditer(text):
        key, value = match.group(1), match.group(2).strip()
        fields[key] = value
    return fields


# ──────────────────────────────────────────────────────────────────────────
# 项目配置
# ──────────────────────────────────────────────────────────────────────────


def read_project_config(project_dir: Path, config_path: Path | None) -> tuple[dict, Path]:
    """读取并最小校验项目配置。

    校验口径对齐上游 `build.ps1:212-292` 与 `yibinthesis.project.schema.json`：
    `schemaVersion` 必须为 1，`main` 必须非空。其余字段缺省时按上游默认值处理。
    """
    path = config_path or (project_dir / PROJECT_CONFIG_NAME)
    if not path.is_file():
        raise AdapterError(
            "project-invalid",
            f"找不到项目配置：{path}。请先运行 yibinthesis_new 生成项目，"
            "或把 project_dir 指向包含 "
            f"{PROJECT_CONFIG_NAME} 的目录。",
        )
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise AdapterError("project-invalid", f"项目配置无法解析：{path} ({exc})") from exc
    if not isinstance(raw, dict):
        raise AdapterError("project-invalid", f"项目配置必须是 JSON 对象：{path}")

    version = raw.get("schemaVersion")
    if version != SCHEMA_VERSION:
        raise AdapterError(
            "project-invalid",
            f"不支持的 schemaVersion：{version!r}（本插件支持 {SCHEMA_VERSION}）",
        )
    main = raw.get("main")
    if not isinstance(main, str) or not main.strip():
        raise AdapterError("project-invalid", "项目配置必须定义非空的 'main' 路径")
    return raw, path


def _resolve_under(root: Path, value: str | None) -> Path | None:
    """把配置里的相对路径按配置所在目录解析（与上游 `Get-FullPath -BasePath $ConfigRoot` 同义）。"""
    if not value:
        return None
    candidate = Path(value).expanduser()
    return candidate if candidate.is_absolute() else (root / candidate)


def expand_deliverable(root: Path, template: str | None, metadata: dict[str, str]) -> str | None:
    """展开交付文件名模板里的 `{{field}}` 占位符。

    与上游 `Expand-Deliverable-Template`（build.ps1:171-198）语义一致：占位字段缺失即
    **不展开**（上游会 throw），这里把未展开的事实回传给调用方，不静默产出错名文件。
    """
    if not template:
        return None
    fields = re.findall(r"\{\{([a-z0-9-]+)\}\}", template)
    expanded = template
    missing = []
    for field in fields:
        if field in metadata and metadata[field].strip():
            # 与上游 ConvertTo-SafeName 同口径的安全化：去掉文件名非法字符。
            safe = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "-", metadata[field].strip()).strip(". ")
            expanded = expanded.replace("{{" + field + "}}", safe or field)
        else:
            missing.append(field)
    if missing:
        return None
    resolved = Path(expanded)
    return str((root / resolved).resolve() if not resolved.is_absolute() else resolved)


# ──────────────────────────────────────────────────────────────────────────
# 章节与入口
# ──────────────────────────────────────────────────────────────────────────


# ──────────────────────────────────────────────────────────────────────────
# 汉字计数（必须剔除 LaTeX 标记）
# ──────────────────────────────────────────────────────────────────────────

#: 汉字范围。与「论衡」口径一致，只数汉字，不含标点/数字/拉丁字母。
HAN_RE = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]")

#: 内容型命令：其**参数是读者可见的文字**（标题、关键词、强调文字……），要保留计数。
CONTENT_COMMANDS = frozenset(
    {
        "section",
        "subsection",
        "subsubsection",
        "paragraph",
        "subparagraph",
        "chapter",
        "part",
        "title",
        "caption",
        "author",
        "date",
        "keywords",
        "cnkeywords",
        "enkeywords",
        "thanks",
        "footnote",
        "emph",
        "textbf",
        "textit",
        "textrm",
        "textsf",
        "texttt",
        "textnormal",
        "underline",
        "mbox",
        "hbox",
        "text",
        "textup",
        "textsl",
        "textsc",
        "zhd",
    }
)

#: 章节标题类命令（用于「仅正文」口径：这些命令的参数不计入）。
SECTION_COMMANDS = frozenset(
    {"section", "subsection", "subsubsection", "paragraph", "subparagraph", "chapter", "part"}
)

#: 逐字环境：内部全是代码，整体丢弃。
VERBATIM_ENVS = frozenset(
    {"verbatim", "verbatim*", "lstlisting", "listing", "minted", "BVerbatim", "LVerbatim", "SaveVerbatim", "comment"}
)

#: 纯浮动体环境：用于「是否含图/表/算法」的标记。
FLOAT_ENVS = frozenset({"figure", "figure*", "table", "table*", "wrapfigure", "subfigure", "algorithm"})

#: 数学环境：内部一律不计（公式不是正文文字，连 `\text{…}` 也是公式的一部分）。
MATH_ENVS = frozenset(
    {
        "equation",
        "equation*",
        "align",
        "align*",
        "gather",
        "gather*",
        "eqnarray",
        "eqnarray*",
        "multline",
        "multline*",
        "flalign",
        "flalign*",
        "alignat",
        "alignat*",
        "split",
        "cases",
        "displaymath",
        "math",
    }
)

#: 这些「结构命令」的参数是**内部标记**，必须连参数一起丢弃。
#: （早期用正则链时这里出了漏：`\label{sec:intro}` 与 `\includegraphics{a.pdf}`
#:  的参数都漏进了计数文本。）
_DISCARD_ARG_PREFIX = (
    "label",
    "ref",
    "eqref",
    "pageref",
    "cite",
    "citep",
    "citet",
    "nocite",
    "bibitem",
    "input",
    "include",
    "includeonly",
    "usepackage",
    "documentclass",
    "RequirePackage",
    "includegraphics",
    "bibliography",
    "bibliographystyle",
    "addbibresource",
    "graphicspath",
    "newcommand",
    "renewcommand",
    "providecommand",
    "DeclareMathOperator",
    "setlength",
    "addtolength",
    "geometry",
    "hypersetup",
    "definecolor",
    "cline",
    "multicolumn",
    "hspace",
    "vspace",
    "rule",
    "raisebox",
    "hfill",
)


class _Scanner:
    """单遍字符扫描器：把 LaTeX 剥成「读者可见的文字」。

    为什么不用一串正则替换：`\\\\label{x}` 这类命令**参数要不要保留**取决于命令本身
    （内容命令保留、结构命令丢弃），正则链很难在这点上保持正确——实测漏出了
    `sec:intro`、`a.pdf`、`width=0.8` 这类噪声。逐字符扫描把「当前处于什么状态」
    和「这个命令的参数算不算内容」都显式化，才可靠。
    """

    def __init__(self, text: str, *, keep_section_titles: bool = True):
        """初始化扫描器。

        @param text - LaTeX 源文本。
        @param keep_section_titles - 是否把章节标题的参数计入结果。默认 True（标题确实
            显示在成品里）；置 False 得到「仅正文」口径。
        """
        self.text = text
        self.keep_section_titles = keep_section_titles
        self.pos = 0
        self.parts: list[str] = []
        # 逐字环境名栈：非空时内部一切字符直接丢弃。
        self.verbatim_stack: list[str] = []
        # 数学模式：`$` 与 `$$` 的配对状态。
        self.in_math = False
        self.math_delim = ""

    # ── 基础工具 ──────────────────────────────────────────────────────────

    def _peek(self, offset: int = 0) -> str:
        index = self.pos + offset
        return self.text[index] if index < len(self.text) else ""

    def _at(self, token: str) -> bool:
        return self.text.startswith(token, self.pos)

    def _emit(self, value: str) -> None:
        self.parts.append(value)

    def _skip_balanced(self, open_char: str = "{", close_char: str = "}") -> str:
        """跳过一段配对的括号内容（支持嵌套），并返回其内部原文。"""
        if self._peek() != open_char:
            return ""
        depth = 0
        start = self.pos + 1
        while self.pos < len(self.text):
            char = self.text[self.pos]
            if char == "\\":
                self.pos += 2
                continue
            if char == open_char:
                depth += 1
            elif char == close_char:
                depth -= 1
                if depth == 0:
                    inner = self.text[start : self.pos]
                    self.pos += 1
                    return inner
            self.pos += 1
        return self.text[start : self.pos]

    def _skip_optional(self) -> None:
        """跳过 `[...]` 形式的可选参数（不支持嵌套）。"""
        if self._peek() != "[":
            return
        depth = 0
        while self.pos < len(self.text):
            char = self.text[self.pos]
            if char == "[":
                depth += 1
            elif char == "]":
                depth -= 1
                self.pos += 1
                if depth == 0:
                    return
                continue
            self.pos += 1

    def _skip_comment(self) -> None:
        while self.pos < len(self.text) and self.text[self.pos] != "\n":
            self.pos += 1

    def _read_command(self) -> str:
        """读命令名；`\\foo` 与 `\\begin` 之类都返回裸名（不含反斜杠）。"""
        start = self.pos + 1
        index = start
        while index < len(self.text) and (self.text[index].isalpha() or self.text[index] == "@"):
            index += 1
        name = self.text[start:index]
        if not name:  # 单字符命令（`\%`、`\\`、`\{`…）
            name = self.text[start : start + 1]
            index = start + 1
        self.pos = index
        if self._peek() == "*":  # `\section*`
            self.pos += 1
        return name

    # ── 主循环 ────────────────────────────────────────────────────────────

    def run(self) -> str:
        while self.pos < len(self.text):
            char = self._peek()

            if self.verbatim_stack:
                self._consume_verbatim_body()
                continue

            if char == "%":
                self._skip_comment()
                continue

            if char == "\\":
                # `\\` 是换行命令，`\%` `\&` `\_` 等是转义字符。
                nxt = self._peek(1)
                if nxt in "\\%&#_$~{}":
                    if nxt in "%&#_$":
                        self._emit(nxt)
                    self.pos += 2
                    continue
                if nxt.isspace():
                    self.pos += 2
                    continue
                self._consume_command()
                continue

            if char == "$":
                self._toggle_math()
                continue

            if char in "{}":
                # 裸括号（未配对命令参数）：`{}` 是分组，内部文字仍是正文。
                self.pos += 1
                continue

            if char in "&~^_":
                self.pos += 1
                continue

            self._emit(char)
            self.pos += 1

        return "".join(self.parts)

    def _consume_verbatim_body(self) -> None:
        """消费逐字环境体，直到匹配的 `\\end{env}`。"""
        env = self.verbatim_stack[-1]
        end_token = "\\end{" + env + "}"
        index = self.text.find(end_token, self.pos)
        if index < 0:
            self.pos = len(self.text)
            self.verbatim_stack.pop()
            return
        self.pos = index + len(end_token)
        self.verbatim_stack.pop()

    def _toggle_math(self) -> None:
        """切换数学模式。`$$` 与 `$` 互不串味。"""
        if self._peek(1) == "$":
            if self.in_math and self.math_delim == "$$":
                self.in_math, self.math_delim = False, ""
            elif not self.in_math:
                self.in_math, self.math_delim = True, "$$"
            self.pos += 2
            return
        if self.math_delim == "$$":
            self.pos += 1
            return
        if self.in_math:
            self.in_math, self.math_delim = False, ""
        else:
            self.in_math, self.math_delim = True, "$"
        self.pos += 1

    def _consume_command(self) -> None:
        """处理一个反斜杠命令。"""
        name = self._read_command()

        # `\begin{env}` / `\end{env}`：环境边界，内容由环境名决定处理方式。
        if name in ("begin", "end"):
            inner = self._skip_balanced() if self._peek() == "{" else ""
            env = inner.strip()
            if name == "begin":
                if env in VERBATIM_ENVS:
                    self.verbatim_stack.append(env)
                elif env in MATH_ENVS:
                    # 数学环境：内部一切不可计数——**包括** `\text{…}`
                    # （实测：`\begin{equation}…\text{质能方程}…\end{equation}` 曾被多算 4 字）。
                    # 注意这里**不要求** `in_math`：`\begin{equation}` 常裸用，不带 `\[`。
                    self._skip_to_end(env)
                else:
                    self._emit("\n")
            else:
                self._emit("\n")
            return

        # `\[ … \]` / `\( … \)`：显示/行内数学。
        if name in ("[", "("):
            closer = "\\]" if name == "[" else "\\)"
            index = self.text.find(closer, self.pos)
            self.pos = len(self.text) if index < 0 else index + len(closer)
            self._emit(" ")
            return
        if name in ("]", ")"):
            return

        # 数学模式内部：忽略一切（公式不是正文文字）。
        #
        # 注意 `\text{…}` 也在 CONTENT_COMMANDS 里，但它出现在公式中时是**公式的一部分**
        # （实测边界用例：`\begin{equation}…\text{质能方程}…\end{equation}` 被多算了 4 字）。
        # 因此这条判断必须排在内容命令之前。
        if self.in_math:
            self._skip_optional()
            if self._peek() == "{":
                self._skip_balanced()
            return

        # 内容型命令：只处理参数（参数文字要计数），命令名丢弃。
        if name in CONTENT_COMMANDS:
            # 「仅正文」口径下，章节标题的参数一律丢弃。
            if name in SECTION_COMMANDS and not self.keep_section_titles:
                self._skip_optional()
                if self._peek() == "{":
                    self._skip_balanced()
                self._emit(" ")
                return
            self._skip_optional()
            if self._peek() == "{":
                inner = self._skip_balanced()
                self._emit(" ")
                self._emit(inner)
                self._emit(" ")
            return

        # 结构型命令：连参数一起丢弃（`\label{x}`、`\includegraphics[..]{a.pdf}`…）。
        if name in _DISCARD_ARG_PREFIX:
            self._skip_optional()
            while self._peek() in "{[":
                if self._peek() == "{":
                    self._skip_balanced()
                else:
                    self._skip_optional()
                self._skip_optional()
            self._emit(" ")
            return

        # 其余命令（`\yibinopeningchapter`、`\maketitle`…）：只丢命令名，
        # 其后若有参数按分组处理（裸 `{}` 会在主循环被剔除，内部文字保留）。
        self._skip_optional()
        self._emit(" ")

    def _skip_to_end(self, env: str) -> None:
        """跳到匹配的 `\\end{env}` 之后（用于数学环境）。"""
        end_token = "\\end{" + env + "}"
        index = self.text.find(end_token, self.pos)
        self.pos = len(self.text) if index < 0 else index + len(end_token)
        self._emit(" ")


def strip_latex(text: str) -> str:
    """把 LaTeX 源码剥成「读者可见的文字」。

    这是**汉字计数的前置步骤**：直接对源码数字符会把命令名、环境名、标签键一起算进去
    （实测：`\\\\yibinopeningchapter` 与 `\\\\begin{cnabstract}` 里的字母/汉字被计入，
    导致章节字数虚高，而纯骨架文件也被显示成「写了 20 字」）。

    保留：正文文字、内容命令的参数（`\\\\section{研究背景}` → `研究背景`）、
    `\\\\caption{…}` 之类标题文字、转义字符（`\\\\%` → `%`）。
    丢弃：注释、数学公式、逐字环境（`lstlisting`/`minted`）、结构命令及其参数
    （`\\\\label`、`\\\\includegraphics`、`\\\\cite`…）、排版符号。

    @param text - LaTeX 源文本。
    @returns 剥离后的纯文本（保留换行，便于逐段核对）。
    """
    return _Scanner(text).run()


def count_han(text: str) -> int:
    """数**剥掉 LaTeX 标记之后**的汉字数（含章节标题，标题确实显示在成品里）。

    @param text - LaTeX 源文本。
    @returns 汉字个数。
    """
    return len(HAN_RE.findall(strip_latex(text)))


def count_han_prose(text: str) -> int:
    """只数**正文段落**里的汉字，不算章节标题。

    为什么要有这个口径：模板可能给标题加前缀（如「第一章 绪论」），这些字不是学生写的，
    混进来会让「我写了多少字」偏高。故单独给一个口径。
    @param text - LaTeX 源文本。
    @returns 正文汉字个数（不含章节标题）。
    """
    return len(HAN_RE.findall(_Scanner(text, keep_section_titles=False).run()))


def is_content_file(name: str) -> bool:
    """该文件是否**承载正文**（据此决定面板是否显示字数）。

    参考文献、术语表这些是书目数据，为 0 字是正常的，不该显示成「没写」。
    @param name - 文件名。
    @returns 是否属于正文类文件。
    """
    lowered = name.lower()
    if lowered.endswith(".bib"):
        return False
    return not any(token in lowered for token in ("reference", "glossary", "acronym"))


def has_float(text: str) -> bool:
    """该文件是否含浮动体环境（图/表/算法）。

    @param text - LaTeX 源文本。
    @returns 是否含浮动体。
    """
    return any(re.search(r"\\begin\{" + re.escape(env) + r"\}", text) for env in FLOAT_ENVS)


def scan_chapters(main_tex: Path) -> tuple[list[dict], list[str]]:
    """扫描入口所在目录的 `chapters/`，列出章节文件与字数。

    返回 `(chapters, includes)`：章节文件清单（含汉字数），以及入口里 `\\input`/`\\include`
    引用到的相对路径。**只读**，不修改任何文件。

    字数口径（**剔除 LaTeX 标记**，见 `count_han`）：
    · `han`        —— 剥掉标记后剩余正文里的汉字数（含章节标题，因为标题确实显示在成品里）；
    · `hanProse`   —— 只算正文段落，不含章节标题；
    · `content`    —— 是否正文类文件（`.bib`/参考文献为 false，为 0 字是正常的）；
    · `hasFloat`   —— 是否含图/表/算法等浮动体；
    · `bare`       —— 剥离标记后是否**没有剩下任何可见文字**（纯骨架文件）。
    """
    chapters: list[dict] = []
    chapter_dir = main_tex.parent / "chapters"
    if chapter_dir.is_dir():
        for path in sorted(chapter_dir.glob("*.tex")):
            try:
                text = path.read_text(encoding="utf-8")
            except OSError:
                continue
            stripped = strip_latex(text)
            chapters.append(
                {
                    "file": path.name,
                    "path": str(path),
                    "han": count_han(text),
                    "hanProse": count_han_prose(text),
                    "content": is_content_file(path.name),
                    "hasFloat": has_float(text),
                    "bare": not stripped.strip(),
                    "bytes": len(text.encode("utf-8")),
                }
            )
    includes: list[str] = []
    try:
        entry = main_tex.read_text(encoding="utf-8")
    except OSError:
        return chapters, includes
    for match in re.finditer(r"\\(?:input|include)\s*\{([^}]+)\}", entry):
        includes.append(match.group(1).strip())
    return chapters, includes


# ──────────────────────────────────────────────────────────────────────────
# 子命令：probe
# ──────────────────────────────────────────────────────────────────────────


def cmd_probe(args: argparse.Namespace) -> int:
    """读取一个 YibinThesis 项目的结构化摘要（只读）。"""
    project_dir = Path(args.project_dir).expanduser().resolve()
    if not project_dir.is_dir():
        raise AdapterError("project-invalid", f"项目目录不存在：{project_dir}")

    config, config_path = read_project_config(project_dir, Path(args.config).expanduser().resolve() if args.config else None)
    config_root = config_path.parent

    main_tex = _resolve_under(config_root, config.get("main"))
    if main_tex is None or not main_tex.is_file():
        raise AdapterError(
            "project-invalid",
            f"找不到 LaTeX 入口：{main_tex or config.get('main')}（配置 {config_path}）",
        )

    metadata = parse_metadata(main_tex.parent / "metadata.tex")
    chapters, includes = scan_chapters(main_tex)

    output_root = _resolve_under(config_root, config.get("outputRoot")) or (config_root / "build")
    check_root = _resolve_under(config_root, config.get("checkOutputRoot")) or output_root

    # 上游把产出放在 <outputRoot>/<pdf|word>/<入口 stem>-<hash8>/ 下（build.ps1:325-392）。
    # 这里如实回报「出口目录」而不是伪造确切的最终文件名——hash 由构建器计算。
    entry_stem = main_tex.stem
    deliverables = config.get("deliverables") or {}
    payload = {
        "ok": True,
        "project": {
            "root": str(config_root),
            "configPath": str(config_path),
            "mainTex": str(main_tex),
            "entryStem": entry_stem,
            # 文档类型不在配置里——它由入口的 documentclass 选项决定（见 schema.json 描述）。
            "documentClass": read_document_class(main_tex),
        },
        "config": {
            "schemaVersion": config.get("schemaVersion"),
            "main": config.get("main"),
            "outputRoot": str(output_root),
            "checkOutputRoot": str(check_root),
            "citationMode": config.get("citationMode", "linked"),
            "wordRefresh": config.get("wordRefresh", "auto"),
        },
        "metadata": metadata,
        "chapters": chapters,
        "includes": includes,
        "totalHan": sum(item["han"] for item in chapters),
        # 只算正文段落（不含章节标题），且只算正文类文件——「我写了多少字」用这个更贴切。
        "totalHanProse": sum(item["hanProse"] for item in chapters if item["content"]),
        "outputs": {
            "buildRoot": str(output_root),
            "pdfDeliverableTemplate": deliverables.get("pdf"),
            "wordDeliverableTemplate": deliverables.get("word"),
            "pdfDeliverable": expand_deliverable(config_root, deliverables.get("pdf"), metadata),
            "wordDeliverable": expand_deliverable(config_root, deliverables.get("word"), metadata),
        },
        "signatureBackground": read_signature_background(main_tex),
    }
    emit(payload)
    return EXIT_OK


_DOCUMENT_CLASS = re.compile(r"\\documentclass\s*\[([^\]]*)\]\s*\{([^}]+)\}", re.DOTALL)


def read_document_class(main_tex: Path) -> dict:
    """读入口的 `\\documentclass[...]{...}`，解析出文档类型与学科（只读）。

    上游 `yibinthesis.cls` 用类选项区分 `thesis|proposal|literature-review` 与
    `humanities|science`（见 README「文档类型与版式」）。解析不到时如实返回空值。
    """
    try:
        text = main_tex.read_text(encoding="utf-8")
    except OSError:
        return {"class": None, "options": [], "documentType": None, "discipline": None}
    match = _DOCUMENT_CLASS.search(text)
    if not match:
        return {"class": None, "options": [], "documentType": None, "discipline": None}
    options = [opt.strip() for opt in match.group(1).split(",") if opt.strip()]
    known_types = {"thesis", "proposal", "literature-review"}
    known_disciplines = {"humanities", "science"}
    return {
        "class": match.group(2).strip(),
        "options": options,
        "documentType": next((opt for opt in options if opt in known_types), None),
        "discipline": next((opt for opt in options if opt in known_disciplines), None),
    }


def read_signature_background(main_tex: Path) -> str | None:
    """读入口里 `signature-background=<preserve|whiten>` 选项（决定是否需要 python-docx）。"""
    try:
        text = main_tex.read_text(encoding="utf-8")
    except OSError:
        return None
    match = re.search(r"signature-background\s*=\s*(preserve|whiten)", text)
    return match.group(1) if match else None


# ──────────────────────────────────────────────────────────────────────────
# 子命令：new（复用上游 CLI，不重实现）
# ──────────────────────────────────────────────────────────────────────────


def load_upstream_cli(cli_root: Path | None):
    """导入上游 `yibinthesis_cli.scaffold`。

    为什么必须复用而不是在插件里重写：脚手架要生成 `main.tex`、`metadata.tex`、
    `chapters/*.tex`、`yibinthesis.project.json`，其中文档类型↔年份、学科↔编号体系、
    TeX 转义规则都是上游的单一真源（`scaffold.py:26-209`）。插件里复制一份必然漂移。
    """
    if cli_root is None:
        raise AdapterError(
            "cli-missing",
            "生成新项目需要上游 YibinThesis 的 CLI 源码（lib/yibinthesis_cli）。"
            "请把插件配置项 cliRoot 指向 YibinThesis 检出根，"
            "或设置环境变量 YIBINTHESIS_CLI_ROOT。",
        )
    lib_dir = cli_root / "lib"
    if not (lib_dir / "yibinthesis_cli" / "scaffold.py").is_file():
        raise AdapterError("cli-missing", f"在 {lib_dir} 下找不到 yibinthesis_cli/scaffold.py")
    if str(lib_dir) not in sys.path:
        sys.path.insert(0, str(lib_dir))
    try:
        from yibinthesis_cli import scaffold  # noqa: PLC0415 —— 故意延迟导入（依赖运行时 sys.path）
    except Exception as exc:  # noqa: BLE001 —— 上游包的导入失败形态不可枚举，统一转为可读错误
        raise AdapterError("cli-missing", f"无法导入上游 CLI：{exc}") from exc
    return scaffold


def cmd_new(args: argparse.Namespace) -> int:
    """脚手架一个新项目（写盘；`--dry-run` 时只回报将要创建的文件）。"""
    cli_root = Path(args.cli_root).expanduser().resolve() if args.cli_root else None
    scaffold = load_upstream_cli(cli_root)

    target = Path(args.target).expanduser().resolve()
    document_type = args.document_type or "thesis"
    if document_type not in scaffold.DOCUMENT_TYPES:
        raise AdapterError("invalid-args", f"未知文档类型：{document_type}（可用：{', '.join(scaffold.DOCUMENT_TYPES)}）")
    discipline = args.discipline or "humanities"
    if discipline not in scaffold.DISCIPLINES:
        raise AdapterError("invalid-args", f"未知学科：{discipline}（可用：{', '.join(scaffold.DISCIPLINES)}）")

    # 上游 `create_project(args)` 直接读 argparse 命名空间的属性（含 `--` 转 `_` 的字段名）。
    ns = argparse.Namespace(
        target=str(target),
        document_type=document_type,
        discipline=discipline,
        dry_run=bool(args.dry_run),
        force=bool(args.force),
        secrecy=args.secrecy or "public",
        signature_background=args.signature_background or "preserve",
    )
    for option in (
        "title", "english_title", "author", "student_id", "college", "major", "grade",
        "class_name", "advisor", "advisor_title", "external_advisor", "external_advisor_title",
        "version", "date", "declassify_year", "author_signature", "advisor_signature",
    ):
        setattr(ns, option, getattr(args, option, None))

    # 上游把「干跑时将要写的文件」打到 stdout；把这段文本改道到 stderr，
    # 以免污染本适配器 stdout 的 JSON 契约。
    buffer = io.StringIO()
    saved_stdout = sys.stdout
    try:
        sys.stdout = buffer
        exit_code = scaffold.create_project(ns)
    except Exception as exc:  # noqa: BLE001
        sys.stdout = saved_stdout
        raise AdapterError("scaffold-failed", f"脚手架执行失败：{exc}") from exc
    finally:
        sys.stdout = saved_stdout

    captured = buffer.getvalue()
    if captured.strip():
        sys.stderr.write(captured)

    files = []
    if target.is_dir():
        for path in sorted(target.rglob("*")):
            if path.is_file():
                files.append(str(path.relative_to(target)).replace(os.sep, "/"))

    emit(
        {
            "ok": int(exit_code) == 0,
            "projectRoot": str(target),
            "documentType": document_type,
            "discipline": discipline,
            "dryRun": bool(args.dry_run),
            "files": files,
            "message": captured.strip() or None,
        }
    )
    return EXIT_OK if int(exit_code) == 0 else EXIT_USER_ERROR


# ──────────────────────────────────────────────────────────────────────────
# 入口
# ──────────────────────────────────────────────────────────────────────────


def cmd_strip(args: argparse.Namespace) -> int:
    """把 stdin 的 LaTeX 剥成纯文本并回报计数（**纯函数，便于单测**）。

    为什么单独开一个子命令：剥离器是计数的正确性核心，必须能被测试**直接**验证，
    而不是只能靠「跑一遍 probe 看数字」。它不做文件 IO、不碰网络。
    """
    raw = sys.stdin.read()
    stripped = strip_latex(raw)
    emit(
        {
            "ok": True,
            "stripped": stripped,
            "han": count_han(raw),
            "hanProse": count_han_prose(raw),
        }
    )
    return EXIT_OK


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="yibinthesis_probe", description="yibinthesis-dsh 结构化适配器")
    sub = parser.add_subparsers(dest="command", required=True)

    probe = sub.add_parser("probe", help="读取项目摘要（只读）")
    probe.add_argument("--project-dir", required=True)
    probe.add_argument("--config")
    probe.set_defaults(func=cmd_probe)

    strip = sub.add_parser("strip", help="剥离 LaTeX 标记并数汉字（stdin → JSON，纯函数）")
    strip.set_defaults(func=cmd_strip)

    new = sub.add_parser("new", help="脚手架新项目（复用上游 CLI）")
    new.add_argument("target")
    new.add_argument("--cli-root")
    new.add_argument("--type", dest="document_type")
    new.add_argument("--discipline")
    new.add_argument("--secrecy")
    new.add_argument("--signature-background")
    new.add_argument("--dry-run", action="store_true")
    new.add_argument("--force", action="store_true")
    for option in (
        "title", "english-title", "author", "student-id", "college", "major", "grade",
        "class-name", "advisor", "advisor-title", "external-advisor", "external-advisor-title",
        "version", "date", "declassify-year", "author-signature", "advisor-signature",
    ):
        new.add_argument(f"--{option}", dest=option.replace("-", "_"))
    new.set_defaults(func=cmd_new)

    return parser


def main(argv: list[str] | None = None) -> int:
    try:
        args = build_parser().parse_args(argv)
        return int(args.func(args))
    except AdapterError as exc:
        emit({"ok": False, "error": {"kind": exc.kind, "message": exc.message}})
        return EXIT_USER_ERROR
    except KeyboardInterrupt:
        emit({"ok": False, "error": {"kind": "cancelled", "message": "已取消"}})
        return EXIT_USER_ERROR
    except Exception as exc:  # noqa: BLE001 —— 适配器自身故障要能被上层区分出来
        emit({"ok": False, "error": {"kind": "adapter-failed", "message": f"{type(exc).__name__}: {exc}"}})
        return EXIT_ADAPTER_ERROR


if __name__ == "__main__":
    raise SystemExit(main())
