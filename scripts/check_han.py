"""临时核对脚本：验证 LaTeX 剥离后的汉字计数（用完即删）。

三组对照：
· 旧口径 —— 直接对源码数字符（含 LaTeX 标记，虚高）；
· 新口径 —— 剥离标记后的全部可见文字（含章节标题）；
· 仅正文 —— 再排除章节标题（「我写了多少字」用这个）。

末尾对合成边界用例做**硬断言**：注释、逐字环境、公式、结构命令参数、排版符号
必须一律不计，正文与标题必须计。
"""

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "adapter"))
from yibinthesis_probe import count_han, count_han_prose, has_float, is_content_file, strip_latex  # noqa: E402

HAN = re.compile(r"[\u4e00-\u9fff]")
CHAPTERS = Path(r"E:\文档\毕业论文\示例论文\latex\chapters")

print(f'{"文件":<26}{"旧(含标记)":>11}{"新(剥离)":>10}{"仅正文":>9}{"正文类":>7}')
for path in sorted(CHAPTERS.glob("*.tex")):
    text = path.read_text(encoding="utf-8")
    print(
        f"{path.name:<26}{len(HAN.findall(text)):>11}{count_han(text):>10}"
        f"{count_han_prose(text):>9}{str(is_content_file(path.name)):>7}"
    )

# ── 合成边界用例：每一处都写明期望 ────────────────────────────────────────
SAMPLE = r"""
% 整行注释：这些汉字不该被计数
\section{研究背景}          % 行尾注释
本文研究\emph{图像超分辨率}重建。百分之五十\% 的情况成立。
\label{sec:intro}
\begin{equation}
  E = mc^2 \quad \text{质能方程}
\end{equation}
\begin{lstlisting}
  print("这里的汉字不该被计数")
\end{lstlisting}
\includegraphics[width=0.8\textwidth]{figs/a.pdf}
\begin{figure}
  \caption{实验装置示意图}
\end{figure}
关键词：超分辨率；深度学习。
"""

# 期望计入（含标题口径）
EXPECT_WITH_TITLES = (
    "研究背景"  # \section 参数
    "本文研究"  # 正文
    "图像超分辨率"  # \emph 参数（内容命令）
    "重建"  # 正文
    "百分之五十"  # 正文（`\%` 是转义百分号，其后文字继续计）
    "的情况成立"  # 正文
    "实验装置示意图"  # \caption 参数
    "关键词"  # 正文
    "超分辨率"  # 正文
    "深度学习"  # 正文
)
# 期望**不**计入：注释 8 字、lstlisting 12 字、公式 4 字（\text{质能方程}）、
#                   \label{sec:intro} 的 sec、\includegraphics 的 figs/a.pdf、width=0.8
ok = True


def check(label: str, actual: int, expected: int) -> None:
    """比对一项并记录结果。"""
    global ok
    mark = "✓" if actual == expected else "✗"
    if actual != expected:
        ok = False
    print(f"  {mark} {label}: 实际 {actual}，期望 {expected}")


print()
print("── 边界用例断言 ──")
check("含标题口径", count_han(SAMPLE), len(EXPECT_WITH_TITLES))
check("仅正文口径", count_han_prose(SAMPLE), len(EXPECT_WITH_TITLES) - len("研究背景"))
check("含图/表", int(has_float(SAMPLE)), 1)

stripped = strip_latex(SAMPLE)
for leaked in ("不该被计数", "质能方程", "sec:intro", "a.pdf", "width=0.8"):
    present = leaked in stripped
    if present:
        ok = False
    print(f"  {'✗' if present else '✓'} 不得泄露 {leaked!r}")

for kept in ("本文研究", "百分之五十%", "实验装置示意图", "关键词"):
    present = kept in stripped
    if not present:
        ok = False
    print(f"  {'✓' if present else '✗'} 必须保留 {kept!r}")

print()
print("纯骨架文件（90-appendix.tex）应为 0 字并判为正文类：")
appendix = (CHAPTERS / "90-appendix.tex").read_text(encoding="utf-8")
check("骨架文件汉字数", count_han(appendix), 0)
check("骨架文件仍算正文类", int(is_content_file("90-appendix.tex")), 1)
check("references.bib 不算正文类", int(is_content_file("references.bib")), 0)

print()
print("结果:", "全部通过" if ok else "有失败项")
sys.exit(0 if ok else 1)
