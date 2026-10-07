// 构建产物路径解析的测试。
//
// 为什么单开一层：`yibinthesis_build` 的 `published` 字段是调用方（模型）得知
// 「产物落在哪」的唯一权威来源。早期实现把它固定成空数组，于是**构建成功却报告
// `published: []`**，调用方只能靠猜路径——与「如实报告」的承诺相悖。
// 该字段由 `build.ps1` 输出的 `Published PDF:` / `Published Word:` 行解析而来，
// 因此解析规则必须被测试固定。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const TOOLS_SOURCE = readFileSync(join(HERE, '..', 'lib', 'tools.js'), 'utf8')

/**
 * 从源码中取出 `parsePublishedArtifacts` 单独求值。
 *
 * `lib/tools.js` 的导出面是工具定义，不适合为了单测而扩大；这里按函数名抽取实现，
 * 保证测的是**同一份代码**而不是复制品。
 * @returns 解析函数。
 */
function loadParser() {
  const match = /^function parsePublishedArtifacts\(text\) \{[\s\S]*?\n\}/m.exec(TOOLS_SOURCE)
  assert.ok(match, '应能从 lib/tools.js 抽出 parsePublishedArtifacts')
  // eslint-disable-next-line no-new-func —— 单测内求值自身源码，无外部输入
  return new Function(`${match[0]}; return parsePublishedArtifacts;`)()
}

const parsePublishedArtifacts = loadParser()

test('★ 产物解析：从 build.ps1 输出中取出 Published PDF / Word 路径', () => {
  // 取自实测的 build.ps1 输出形态（含 Windows 反斜杠与中文路径）。
  const output = [
    'Project config: E:\\示例论文\\yibinthesis.project.json',
    'Generated: E:\\示例论文\\build\\word\\latex-main-79bc1270.docx',
    'Published PDF: E:\\示例论文\\build\\deliverables\\thesis.pdf',
    'Word generated: E:\\示例论文\\build\\word\\latex-main-79bc1270.docx',
    'Published Word: E:\\示例论文\\build\\deliverables\\thesis.docx',
  ].join('\r\n')

  assert.deepEqual(parsePublishedArtifacts(output), [
    'E:\\示例论文\\build\\deliverables\\thesis.pdf',
    'E:\\示例论文\\build\\deliverables\\thesis.docx',
  ])
})

test('★ 产物解析：去重（同一交付物可能被打印多次）', () => {
  const output = ['Published PDF: D:\\a\\thesis.pdf', 'Published PDF: D:\\a\\thesis.pdf', 'Published Word: D:\\a\\thesis.docx'].join('\n')
  assert.deepEqual(parsePublishedArtifacts(output), ['D:\\a\\thesis.pdf', 'D:\\a\\thesis.docx'])
})

test('★ 产物解析：无产物时返回空数组（不得凭 parse 失败而编造路径）', () => {
  assert.deepEqual(parsePublishedArtifacts(''), [])
  assert.deepEqual(parsePublishedArtifacts('nothing relevant here'), [])
  // 仅有 `Generated:` 而无 `Published:`：那是中间产物，不是交付物。
  assert.deepEqual(parsePublishedArtifacts('Generated: E:\\x\\build\\word\\tmp.docx'), [])
})

test('★ 产物解析：容忍行首前缀与引号包裹', () => {
  assert.deepEqual(parsePublishedArtifacts('[Published PDF]: "E:\\out\\t.pdf"'), ['E:\\out\\t.pdf'])
})
