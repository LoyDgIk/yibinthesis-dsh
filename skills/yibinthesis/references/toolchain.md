# 工具链参考

**本文件在什么时候需要读**：`yibinthesis_doctor` 报 `NOT READY`、要装/指向 Tectonic·Biber·Pandoc·Python、要排查「明明装了却探测不到」、或要确认 Biber 版本约束时读它。

## 1. 六个环境变量

| 环境变量 | 管什么 | 何时用 |
| --- | --- | --- |
| `YIBINTHESIS_TECTONIC` | Tectonic 可执行文件 | 用非默认安装位置的 Tectonic 时 |
| `YIBINTHESIS_BIBER` | Biber 可执行文件 | 指向本地 Biber 2.17（见第 5 节硬约束） |
| `YIBINTHESIS_PANDOC` | Pandoc 可执行文件 | 生成 DOCX 时；不在 PATH 上就显式给 |
| `YIBINTHESIS_PYTHON` | Python 解释器 | 多版本 Python 或需要虚拟环境时 |
| `YIBINTHESIS_LATEXMK` | latexmk | 走 LaTeX 路线（而非 Tectonic）时 |
| `YIBINTHESIS_XELATEX` | xelatex | 同上，latexmk 路线需要 latexmk + xelatex 同时命中 |

取值语义（来源：`build.ps1:511-534`）：先把变量的值**当文件路径**试（去首尾引号），不成立再**当命令名**在 PATH 上 `Get-Command`；都不成立时工具状态记为 `Source = "invalid env:<变量名> (<值>)"`，也就是**不会**再回落到 PATH 或已知路径。写错了会响亮失败，不会静默忽略。

`doctor` 输出末尾固定打印这六个变量的名字作为提示（来源：`build.ps1:1276-1277`）。

插件侧还有两个**不叫** `YIBINTHESIS_*` 的配置/环境入口，容易和上表混淆：

- 插件配置项 `cliRoot` 或环境变量 `YIBINTHESIS_CLI_ROOT`：只给 `yibinthesis_new` 用，指向上游 YibinThesis 检出根（提供 `lib/yibinthesis_cli`）。它不是构建工具链变量（来源：`lib/config.js:20-24`、`lib/tools.js:231-258`）。
- 插件配置项 `toolchain`（按工具名给绝对/相对路径）与 `toolchainDirs`（额外目录）：插件在派生子进程前把它们写进子进程的 `YIBINTHESIS_*` 并前置 `PATH`（来源：`lib/toolchain.js:114-181`、`lib/config.js:30-39`）。

## 2. 探测顺序：三层

上游 `Find-Executable` 的逐工具顺序（来源：`build.ps1:499-562`）：

1. **环境变量** `YIBINTHESIS_*`（当路径，再当命令名）；
2. **调用方传入的 `-KnownPaths`**（`Source = 'known local path'`）；
3. **`$CommandNames` 在 `PATH` 上 `Get-Command`**（`Source = 'PATH'`）；
4. 都没有 → `Path = $null`、`Source = 'not found'` → `doctor` 报 `[MISSING]`。

各工具实际拿到的 `-KnownPaths` 并**不相同**（来源：`build.ps1:590-614`）：

| 工具 | 环境变量 | `-KnownPaths` | PATH 上找的命令名 |
| --- | --- | --- | --- |
| Tectonic | `YIBINTHESIS_TECTONIC` | `.tools\tectonic\tectonic.exe`、`.tools\tectonic.exe`，**外加** `Get-KnownTectonicPaths` | `tectonic` |
| Biber | `YIBINTHESIS_BIBER` | `.tools\biber-2.17\biber.exe`、`.tools\biber\biber.exe` | `biber` |
| Pandoc | `YIBINTHESIS_PANDOC` | `.tools\pandoc-3.9.0.2\pandoc.exe`、`.tools\pandoc\pandoc.exe` | `pandoc` |
| Python | `YIBINTHESIS_PYTHON` | `.tools\venv\Scripts\python.exe`、`.tools\python\python.exe` | `python`、`python3`、`py` |
| latexmk | `YIBINTHESIS_LATEXMK` | 无 | `latexmk` |
| xelatex | `YIBINTHESIS_XELATEX` | 无 | `xelatex` |

**实测事实（逐字）**：Biber 与 Pandoc **只**能通过环境变量或 PATH 命中（`build.ps1` 只给 Tectonic 传了 `-KnownPaths`），Tectonic 额外有已知本机缓存路径。

> 需要说明的细节，避免误读：`Get-ToolSet` 确实给 Biber/Pandoc 也传了 `.tools\` 候选路径，但这些路径以 `$ProjectRoot`（**工具运行时根**）为基准。论文项目自己的 `.tools/` 不在其中；本机实测 `doctor` 报 Biber **缺失**时，项目里并没有 `.tools/`。所以上句结论成立，理由是「基准目录是工具运行时根，不是论文项目」——见下一节。

Tectonic 的已知本机缓存路径由 `Get-KnownTectonicPaths` 生成：扫 `%USERPROFILE%\.codex\plugins\cache\openai-bundled\latex\` 下按名字降序的子目录，取 `<子目录>\bin\tectonic.exe`（来源：`build.ps1:484-497`）。`Source` 会显示为 `known local path`。

本机实测命中：Tectonic `0.17.0` @ `%USERPROFILE%\.codex\plugins\cache\openai-bundled\latex\0.2.6\bin\tectonic.exe`；Biber 与 Pandoc 缺失；`PDF toolchain: NOT READY` / `Word toolchain: NOT READY`，`doctor` 退出码 2（来源：`docs/ARCHITECTURE.md:62-63`）。

### 插件补的那一层：子进程 PATH 组合 + `YIBINTHESIS_*` 注入

插件在调用 vendored `build.ps1` 前按以下优先级解析，并把结果注入子进程（来源：`lib/toolchain.js:97-181`）：

1. 插件配置 `toolchain.<工具名>` 给出的路径（最高）；
2. 进程现有 `YIBINTHESIS_*` 环境变量指向的**文件**；
3. 目录扫描：配置 `toolchainDirs` → **论文项目 `.tools/`** → 插件包 `.tools/`（`<包根>/.tools`）；
4. 都不命中 → 不注入，交给 `build.ps1` 自己走 PATH 与已知缓存（缺失必须由 `doctor` 如实报出）。

命中的绝对路径会写成子进程的 `YIBINTHESIS_*`，同时该文件所在目录被前置到子进程 `PATH`（来源：`lib/toolchain.js:164-178`、`lib/runner.js:62-64`）。所以**论文项目自己的 `.tools/` 是通过插件这一层才生效的**：它不在 `build.ps1` 的 `-KnownPaths` 里（那些以工具运行时根为基准），裸调 `build.ps1` 不会去读它。

## 3. `.tools/` 目录约定与 `setup_toolchain.ps1`

> 「项目 `.tools/`」在**上游文档**里指的是**工具仓库**的 `.tools/`（`build.ps1` 的 `$ProjectRoot` 基准）。插件语境里的「论文项目 `.tools/`」是另一回事，两者别混。本文件以下统一写作「工具根 `.tools/`」与「论文项目 `.tools/`」。

`setup_toolchain.ps1` 的目标布局（来源：`tools/setup_toolchain.ps1:65-67`，`$ProjectRoot` = 脚本上一级）：

| 工具 | 落盘路径 | 版本 |
| --- | --- | --- |
| Tectonic | `<工具根>\.tools\tectonic\tectonic.exe` | 0.16.9 |
| Biber | `<工具根>\.tools\biber-2.17\biber.exe` | 2.17 |
| Pandoc | `<工具根>\.tools\pandoc-3.9.0.2\pandoc.exe` | 3.9.0.2 |
| Python（可选） | `<工具根>\.tools\venv\Scripts\python.exe` | 由 `-PythonPath` 或现有 Python 建 venv |

用法（来源：`tools/setup_toolchain.ps1:3-10`、`:18-37`、`:69-86`）：

```powershell
# 逐个显式给路径
pwsh -File '<上游检出>\tools\setup_toolchain.ps1' `
  -TectonicPath 'C:\path\tectonic.exe' `
  -BiberPath 'C:\path\biber.exe' `
  -PandocPath 'C:\path\pandoc.exe' `
  -PythonPath 'C:\Python312\python.exe'

# 或先设置同名环境变量再跑（脚本会读 YIBINTHESIS_TECTONIC/BIBER/PANDOC/PYTHON）
pwsh -File '<上游检出>\tools\setup_toolchain.ps1' -SkipPythonEnvironment
```

脚本行为要点：

- 每个工具的源解析顺序：显式参数 → 同名环境变量 → `Get-Command`（`tools/setup_toolchain.ps1:25-36`）。
- 目标文件已存在则跳过并打印 `[OK] ... already exists`；源找不到则抛错。
- 不加 `-SkipPythonEnvironment` 时会建 `.tools\venv` 并 `pip install -r requirements-word.txt`（`python-docx>=1.2.0,<2.0`、`Pillow>=10.0.0,<13.0`，来源：`requirements-word.txt:1-2`）。
- 它写入的是「工具根」的 `.tools/`。NPM 包场景下工具根是**插件包或模板副本**，用户通常没有写权限或不想写进去；更省事的做法是设 `YIBINTHESIS_*` 环境变量、或把二进制放进**论文项目** `.tools/`（由插件第 2 节的第 3 条生效）。

`tools/toolchain.lock.json` 记录三个工具的版本、relativePath 和 sha256（来源：`tools/toolchain.lock.json:1-20`）。本仓库内**未发现**消费该文件的代码（`build.ps1` 与本仓库 `.py` 中检索不到 `toolchain.lock.json`），所以它当前是**未接线**的登记表，标为**未证实**其校验作用。

## 4. Biber 2.17 的硬约束

- 判据函数：`Assert-CompatibleBiber`，取 `biber --version` 里 `biber version:\s*(\d+\.\d+(\.\d+)?)`，**要求字符串精确等于 `2.17`**，否则抛 `Biber 2.17 is required for the current BCF 3.8 workflow; detected <版本或 unknown>. Biber 2.21 is incompatible with this project.`（来源：`build.ps1:657-684`）。
- 触发时机：入口文件命中 `\addbibresource` 或 `\print(yibin)bibliography` 时（`Test-MainNeedsBiber`，来源：`build.ps1:644-655`）。脚手架生成的入口两者都有，所以本工具的项目**总是**需要 Biber；只有 `\documentclass[...nobibliography...]` 能关掉它。
- 为什么是 2.17：`doctor` 的 `[INCOMPATIBLE]` 文案写明「Tectonic 0.16.9 requires Biber 2.17 for BCF 3.8」（来源：`build.ps1:1238`）。即上游把 BCF 格式版本 3.8 与 Biber 2.17 绑为一对；2.21 的 BCF 读写不匹配，构建会失败。
- 文档类也会警告/停止：`docs/format-basis.md` 与 `docs/document-types.md` 只保证 Tectonic 0.16.9 + Biber 2.17 组合是用过的组合；`build.ps1` 对 Tectonic 版本只**警告**不拦（非 0.16.9 打印 `This template is verified with Tectonic 0.16.9; detected: ...`，来源：`build.ps1:754-757`）。本机 0.17.0 属于「能跑但有警告」。
- 相关 ASCII 约束（Biber 2.17 自身的限制，来源：`build.ps1:461-482`、`:778-815`）：
  - 入口文件名含非 ASCII → 抛 `Biber 2.17 cannot reliably process a non-ASCII TeX job name. Rename the entry .tex file with an ASCII filename.`；脚手架固定用 `latex/main.tex`，天然满足。
  - `pdf` 输出目录含非 ASCII 时，会在 `%LOCALAPPDATA%`（或 `%TEMP%`/`%TMP%`）下 `YibinThesis\biber-paths\` 建目录联结做别名，用完删除。这也是「项目路径带中文可以，但入口文件名必须 ASCII」这条边界的原因。

## 5. Word 链路的额外依赖

除 Pandoc 外，走 `word`/`all` 还需要（来源：`build.ps1:934-1004`、`:1212-1285`）：

| 依赖 | 用途 | 缺失时的报错 |
| --- | --- | --- |
| `YIBINTHESIS_PANDOC` 或 PATH 上的 `pandoc` | `lib/build_word.py --pandoc` 的转换后端 | `Pandoc was not found. Set YIBINTHESIS_PANDOC or add Pandoc to PATH.` |
| Python | 跑 `lib/build_word.py` | `Python was not found. Set YIBINTHESIS_PYTHON or add Python to PATH.` |
| `python-docx`（`import docx`） | DOCX 装配 | `doctor` 报 `[MISSING] Python module: python-docx (install requirements-word.txt)` |
| `Pillow`（`import PIL`） | 图片/签名资源处理 | `doctor` 报 `[MISSING] Python module: Pillow (install requirements-word.txt)` |
| `lib/build_word.py` | Word 构建器本体 | `Word builder not found: <path>` |
| `word/reference.docx` | Word 参考样式 | `doctor` 报 `[MISSING] lib/build_word.py or word/reference.docx` |
| Microsoft Word（可选） | `wordRefresh` 时的域刷新与重新分页 | 见下 |

`reference.docx` 除样式外还带 CSL/XSL 资源：`word/china-national-standard-gb-t-7714-2015-numeric.csl`、`word/Yibin-GB-T-7714-Numeric.xsl`（来源：仓库 `word/` 目录清单）。

**Microsoft Word 不是「Word 构建」的必需项，但域刷新需要它**（来源：`build.ps1:1006-1046`）：

- `wordRefresh: never` → 直接跳过刷新。
- 检测方式 `GetTypeFromProgID('Word.Application')`；不可用时：`auto` 打印警告后继续，`always` **抛错构建失败**。
- 可用时调用 `tools/refresh_word.ps1 -InputPath <docx> -RefreshOnly`。
- WPS / LibreOffice 只能做兼容性预览，域刷新与分页的验收实现是 Microsoft Word（来源：`docs/project-config.md:136-137`）。

另有一条 PDF 侧的隐藏依赖：启用签名图片时用 `lib/prepare_signature_assets.py`，它依赖 `python-docx`；缺失且 `signature-background = whiten` 时才会抛错（来源：`build.ps1:686-709`、`lib/prepare_signature_assets.py:9`）。

## 6. `doctor` 报什么、退出码语义

输出头部固定打印 `Project root` / `Output root` / `Main file` / `PDF output` / `Word output`（来源：`build.ps1:1221-1226`）。

状态行两种格式（来源：`build.ps1:1169-1186`）：

```
  [OK]      <Name> (<required|optional>) - <绝对路径> [<Source>] | <版本行>
  [MISSING] <Name> (<required|optional>) - <Source>
  [INCOMPATIBLE] Biber <版本>; Tectonic 0.16.9 requires Biber 2.17 for BCF 3.8.
```

三种状态的含义：

| 状态 | 含义 |
| --- | --- |
| `[OK]` | 找到了可执行文件；方括号里是来源（`known local path` / `PATH` / `env:YIBINTHESIS_*`） |
| `[MISSING]` | 该层探测全部落空，`Source = not found` |
| `[INCOMPATIBLE]` | 找到了但版本不满足；目前只用于 Biber ≠ 2.17（且入口需要 Biber） |

其余行：`Python module: python-docx` / `Python module: Pillow` / `Word builder and reference.docx` 各有 `[OK]`、`[MISSING]`；末尾两行 `PDF toolchain: READY|NOT READY`、`Word toolchain: READY|NOT READY`。

必需性判定（来源：`build.ps1:1229-1271`）：

| 工具 | doctor 里的角色 |
| --- | --- |
| latexmk | optional |
| xelatex | optional |
| tectonic | optional（与 latexmk+xelatex 二选一即可满足 PDF 引擎） |
| biber | 入口需要文献时 required，否则 optional |
| pandoc | **required**（恒定） |
| python | optional（但 Word 就绪度要求它） |

就绪度公式：

- `pdfReady = ((latexmk ∧ xelatex) ∨ tectonic) ∧ (¬needsBiber ∨ (biberOk ∧ biberCompatible))`
- `wordReady = pandoc ∧ python ∧ python-docx ∧ Pillow ∧ (build_word.py ∧ reference.docx)`
- 两者都真 → 打印 `Doctor result: READY (exit code 0)` 并 `exit 0`；否则 `Doctor result: NOT READY (exit code 2)` 并 `exit 2`。

退出码（来源：`build.ps1:1279-1284`、`:1478-1480`）：

| 码 | 含义 |
| ---: | --- |
| 0 | `READY`：PDF 与 Word 两条链路都齐 |
| 2 | `NOT READY`：缺工具或版本不兼容；**注意 `doctor` 内部抛异常也走 `catch` 变成 1** |
| 1 | 内部错误（`catch { Write-Error; exit 1 }`），如配置非法、入口不存在、路径越界 |

CLI/插件侧把 `build.ps1` 的退出码原样透传（来源：`lib/yibinthesis_cli/build.py:69-71`）；插件把 `ready` 直接定义为「退出码是否为 0」，**不**把缺失渲染成成功（来源：`docs/ARCHITECTURE.md:63-67`、`lib/env.js:192-199`）。

## 7. 本机实测结论（2026 环境）

| 事实 | 值 |
| --- | --- |
| Tectonic | `0.17.0`，命中 `%USERPROFILE%\.codex\plugins\cache\openai-bundled\latex\0.2.6\bin\tectonic.exe` |
| Biber / Pandoc | 缺失 |
| `python-docx` | 缺失；Pillow 存在 |
| Python | `3.12.10` |
| 基线 `doctor` | `PDF toolchain: NOT READY`、`Word toolchain: NOT READY`，退出码 2 |
| 把 biber 2.17 与 pandoc 的目录前置到 `PATH` 后 | `doctor` 报 `PDF toolchain: READY` |
| 真实 PDF 构建 | 成功产出 `build\deliverables\thesis.pdf`（157 KB，文件头 `%PDF-1.5`） |

来源：`docs/ARCHITECTURE.md:62-63`、`:6-14`。

注意 Tectonic 只是「有警告也照跑」：`build.ps1` 只在版本不是 0.16.9 时警告（`build.ps1:754-757`），因此本机 0.17.0 能出 PDF；这不等于上游验证过 0.17.0。

## 8. 缺什么 → 怎么补

| 缺失项 | 具体补法 |
| --- | --- |
| Tectonic | 优先确认是否已有本机缓存：`Get-ChildItem "$env:USERPROFILE\.codex\plugins\cache\openai-bundled\latex" -Directory`；否则从 Tectonic 发行版取 `tectonic.exe` 放进 `<工具根>\.tools\tectonic\` 或设 `YIBINTHESIS_TECTONIC` |
| Biber 2.17 | 必须恰好 2.17。放到 `<工具根>\.tools\biber-2.17\biber.exe`（`setup_toolchain.ps1 -BiberPath ...` 会放这里），或 `[Environment]::SetEnvironmentVariable('YIBINTHESIS_BIBER','<abs>\biber.exe','User')` |
| Pandoc | 装 Pandoc 3.9.0.2，放到 `.tools\pandoc-3.9.0.2\pandoc.exe`，或设 `YIBINTHESIS_PANDOC`。Pandoc 单文件体积很大，见第 9 节 |
| Python | 设 `YIBINTHESIS_PYTHON`，或建 `<工具根>\.tools\venv`（`setup_toolchain.ps1`），或保证 `python` 在 PATH 上 |
| `python-docx` / `Pillow` | `& '<工具根>\.tools\venv\Scripts\python.exe' -m pip install -r '<工具根>\requirements-word.txt'`；不用 venv 则用目标解释器执行同一条 pip |
| `lib/build_word.py` 或 `word/reference.docx` | 说明「模板运行时」不完整：改用完整的上游 YibinThesis 检出，或重装插件包；插件配置项 `templateRoot` 可指向自己的检出（须含 `build.ps1` 与 `lib/build_word.py`） |
| Microsoft Word（仅 `wordRefresh: always` 需要） | 装 Microsoft Word；或把 `wordRefresh` 改成 `auto`（警告后继续）或 `never`（跳过刷新），此时 DOCX 里保留待更新域 |
| latexmk / xelatex（只想走 LaTeX 路线） | 两者**必须同时**命中才满足 PDF 引擎；否则继续用 Tectonic |

插件配置项（`Config`）与本表的对应关系：`toolchain.tectonic/biber/pandoc/python/latexmk/xelatex` 等价于逐个设 `YIBINTHESIS_*`；`toolchainDirs` 等价于「额外 `.tools/` 搜索目录」；`templateRoot` 换模板运行时（来源：`lib/config.js:14-60`）。

## 9. 为什么随 npm 包**不**分发这些二进制

- `.tools/` 下三个二进制的体积实测（源仓库当前文件）：`biber.exe` 31,734,307 字节、`pandoc.exe` 231,056,136 字节、`tectonic.exe` 49,630,208 字节；整个 `.tools/` 约 312 MB。
- 因此 npm 包**不含**这些二进制，只随包复制 `build.ps1`、`*.cls`/`*.sty`、`lib/`、`word/`、`assets/`、`tools/`、`NOTICE`、`LICENSE`（来源：`docs/ARCHITECTURE.md:54-56`）。
- 随包 `.tools/` 目录（`<包根>/.tools`）是**留给使用者自己投放二进制**的位置，默认不存在；插件会扫它，但不创建它（来源：`lib/env.js:21-22`、`lib/toolchain.js:118-126`）。
- 用户可选路径：① 自备二进制放进论文项目 `.tools/`；② 设环境变量指向已有安装；③ 把插件配置 `templateRoot` 指向自己的上游检出，并**同时**把该检出的 `.tools/` 加进 `toolchainDirs`。第 ③ 条的补充是必要的：目录扫描序列为 `toolchainDirs` → 论文项目 `.tools/` → `<包根>/.tools`，**不含** `templateRoot/.tools`（来源：`lib/toolchain.js:118-126`）。

## 10. 未证实 / 需要留意

- `tools/toolchain.lock.json` 的 sha256 未被本仓库任何脚本消费（见第 3 节），因此「校验二进制完整性」这一能力当前**未证实存在**。
- `Setup_toolchain.ps1` 的 `-OneFile`/`build_exe.ps1` 属于 CLI 打包，不影响工具链探测，本文件不复述。
- 插件 `Config.pythonPath` 只影响**适配器**的 Python，不影响 `build.ps1` 选的 Python；`build.ps1` 侧要改 Python 得用 `YIBINTHESIS_PYTHON` 或 `toolchain.python`（来源：`lib/config.js:25-29`、`lib/runner.js:244-254`）。
