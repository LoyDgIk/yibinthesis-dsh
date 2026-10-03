// LaTeX 剥离器与逐章汉字计数的测试。
//
// 为什么单开一层：字数口径是**用户直接看的数字**，也是论文写作里最容易被质疑的东西
// ——「这段标记到底算不算字」。早期实现直接对源码数汉字，把 `\yibinopeningchapter`
// 这类命令名、`\begin{cnabstract}` 环境名一起算了进去（实测：纯骨架的附录文件被显示成
// 「写了 20 字」）。故口径必须用测试钉死，而不是靠读代码判断。
//
// 测试通过适配器的 `strip` 子命令驱动：它是**纯函数**（stdin → JSON，不碰文件系统），
// 所以能把边界用例逐条写给 Python 侧的同一个实现，避免在 JS 里重写一遍解析器
// （那样两份实现必然漂移）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ADAPTER = join(HERE, '..', 'adapter', 'yibinthesis_probe.py')

/** 找一个可用的 Python 解释器（Windows 上是 py / python，其它平台是 python3 / python）。 */
function findPython() {
  for (const candidate of ['python', 'py', 'python3']) {
    const probe = spawnSync(candidate, ['--version'], { encoding: 'utf8' })
    if (probe.status === 0) return candidate
  }
  return null
}

const PYTHON = findPython()

/**
 * 调用 `strip` 子命令剥离一段 LaTeX。
 * @param source - LaTeX 源文本。
 * @returns `{ stripped, han, hanProse }`。
 */
function strip(source) {
  const run = spawnSync(PYTHON, ['-X', 'utf8', ADAPTER, 'strip'], { input: source, encoding: 'utf8' })
  assert.equal(run.status, 0, `strip 子命令应成功：${run.stderr}`)
  const parsed = JSON.parse(run.stdout)
  assert.equal(parsed.ok, true, `strip 应回报 ok：${run.stdout}`)
  return parsed
}

const skip = PYTHON === null ? '未找到可用的 Python 解释器' : false

test('★ LaTeX 剥离：注释 / 公式 / 逐字环境 / 结构命令参数一律不计', { skip }, () => {
  const sample = [
    '% 整行注释：这些汉字不该被计数',
    '\\section{研究背景}          % 行尾注释',
    '本文研究\\emph{图像超分辨率}重建。百分之五十\\% 的情况成立。',
    '\\label{sec:intro}',
    '\\begin{equation}',
    '  E = mc^2 \\quad \\text{质能方程}',
    '\\end{equation}',
    '\\begin{lstlisting}',
    '  print("这里的汉字不该被计数")',
    '\\end{lstlisting}',
    '\\includegraphics[width=0.8\\textwidth]{figs/a.pdf}',
    '\\begin{figure}',
    '  \\caption{实验装置示意图}',
    '\\end{figure}',
    '关键词：超分辨率；深度学习。',
  ].join('\n')

  const result = strip(sample)
  const withTitles =
    '研究背景' + '本文研究' + '图像超分辨率' + '重建' + '百分之五十' + '的情况成立' + '实验装置示意图' + '关键词' + '超分辨率' + '深度学习'
  assert.equal(result.han, withTitles.length, `含标题口径：${result.stripped}`)
  assert.equal(result.hanProse, withTitles.length - '研究背景'.length, `仅正文口径：${result.stripped}`)

  // 逐条钉住「不该出现的东西」——这是本缺陷的核心。
  for (const leaked of ['不该被计数', '质能方程', 'sec:intro', 'a.pdf', 'width=0.8']) {
    assert.ok(!result.stripped.includes(leaked), `剥离结果不得泄露 ${JSON.stringify(leaked)}：${result.stripped}`)
  }
  // 以及「必须保留的东西」——内容命令的参数是读者可见的文字。
  for (const kept of ['本文研究', '百分之五十%', '实验装置示意图', '关键词']) {
    assert.ok(result.stripped.includes(kept), `剥离结果必须保留 ${JSON.stringify(kept)}：${result.stripped}`)
  }
})

test('★ LaTeX 剥离：转义百分号不是注释（早期正则实现会截断整行）', { skip }, () => {
  // 早期用 `(?<!\\)%.*$` 删注释，`\%` 靠负向后顾挡住——但 `\\%`（先出 `\\` 再出 `%`）
  // 就会误判成注释，把那行后面的正文全删掉。扫描器按字符推进，天然没这个问题。
  const result = strip('正确率 95\\% 的结果成立。')
  // 「正确率」(3) + 「的结果成立」(5) = 8；百分号前后的文字都要留住。
  assert.equal(result.han, '正确率的结果成立'.length, `百分号后的正文必须保留：${result.stripped}`)
  assert.ok(result.stripped.includes('%'), '转义百分号本身要保留')
})

test('★ LaTeX 剥离：纯骨架文件必须数出 0 字（而不是把环境名算进去）', { skip }, () => {
  // 实测缺陷：`\begin{cnabstract}…\end{cnabstract}` 的环境名与命令名被计入，
  // 导致只有占位文字的附录文件显示成「写了 20 字」。
  const skeleton = '\\yibinopeningchapter\n\\begin{cnabstract}\n\\end{cnabstract}\n\\section{}\n'
  const result = strip(skeleton)
  assert.equal(result.han, 0, `骨架文件应为 0 字：${result.stripped}`)
  assert.equal(result.hanProse, 0)
})

test('★ LaTeX 剥离：嵌套花括号与星号变体都要正确配对', { skip }, () => {
  // `\section*{…}` 常见于不编号的标题；`\textbf{\emph{…}}` 是嵌套内容命令。
  const result = strip('\\section*{无编号标题}\n\\textbf{\\emph{加粗又斜体}}结束。')
  assert.equal(result.han, '无编号标题加粗又斜体结束'.length, `实际：${result.stripped}`)
  // 仅正文口径下 `\section*` 的参数也不计。
  assert.equal(result.hanProse, '加粗又斜体结束'.length)
})

test('★ 逐章计数：走 probe 适配器，且纯骨架章节如实报 0', { skip }, () => {
  // 端到端：造一个最小项目，验证 `chapters[].han` 用的是剥离后的口径。
  const project = mkdtempSync(join(tmpdir(), 'ybt-han-'))
  mkdirSync(join(project, 'latex', 'chapters'), { recursive: true })
  writeFileSync(
    join(project, 'latex', 'main.tex'),
    ['\\documentclass[thesis,science]{yibinthesis}', '\\begin{document}', '\\input{chapters/10-intro}', '\\end{document}'].join('\n'),
    'utf8',
  )
  writeFileSync(
    join(project, 'yibinthesis.project.json'),
    JSON.stringify({ schemaVersion: 1, main: 'latex/main.tex', outputRoot: 'build', deliverables: { pdf: 'build/thesis.pdf', word: 'build/thesis.docx' } }, null, 2),
    'utf8',
  )
  // 有正文的章节：标题 4 字 + 正文 5 字。
  writeFileSync(join(project, 'latex', 'chapters', '10-intro.tex'), '\\section{研究背景}\n本文研究图像重建。\n', 'utf8')
  // 纯骨架章节：只有命令，没有正文。
  writeFileSync(join(project, 'latex', 'chapters', '90-appendix.tex'), '\\yibinopeningchapter\n\\section{附录}\n', 'utf8')

  const run = spawnSync(PYTHON, ['-X', 'utf8', ADAPTER, 'probe', '--project-dir', project], { encoding: 'utf8' })
  assert.equal(run.status, 0, `probe 应成功：${run.stderr}`)
  const parsed = JSON.parse(run.stdout)
  assert.equal(parsed.ok, true)

  const intro = parsed.chapters.find((c) => c.file === '10-intro.tex')
  const appendix = parsed.chapters.find((c) => c.file === '90-appendix.tex')
  assert.equal(intro.han, '研究背景本文研究图像重建'.length, '正文与标题都要计')
  assert.equal(intro.hanProse, '本文研究图像重建'.length, '仅正文不含标题')
  // 附录只有 `\section{附录}`（2 字标题）：含标题 2、仅正文 0。
  assert.equal(appendix.han, 2, '只该剩标题的 2 字')
  assert.equal(appendix.hanProse, 0, '正文为 0')

  // 汇总字段：totalHan 含标题；totalHanProse 只算正文类文件。
  assert.equal(parsed.totalHan, intro.han + appendix.han)
  assert.equal(parsed.totalHanProse, intro.hanProse)

  rmSync(project, { recursive: true, force: true })
})

test('适配器脚本存在且可读（前置检查）', () => {
  assert.ok(existsSync(ADAPTER), `适配器应存在：${ADAPTER}`)
})
