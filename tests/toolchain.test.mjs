// 工具链探测与 PATH 组合的单元测试（纯函数，无需宿主）。
//
// 这一层的价值：探测顺序与 PATH 组合**错了也不会报错**——只会表现为
// 「明明装了工具却报 MISSING」。所以必须用测试把语义钉死。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'
import { composePath, resolveToolchain } from '../lib/toolchain.js'
import { classifyFailure, parseDoctorOutput, looksLikeProject, isInside, PROJECT_CONFIG_NAME } from '../lib/env.js'

/** 造一个假的“工具目录”，放一个假二进制。 */
function fakeToolDir(name, exeName) {
  const dir = mkdtempSync(join(tmpdir(), `ybt-tool-${name}-`))
  writeFileSync(join(dir, exeName), 'stub', 'utf8')
  return dir
}

test('toolchain：从项目 .tools/ 的版本化子目录里找到二进制', () => {
  const project = mkdtempSync(join(tmpdir(), 'ybt-proj-'))
  const biberDir = join(project, '.tools', 'biber-2.17')
  mkdirSync(biberDir, { recursive: true })
  writeFileSync(join(biberDir, 'biber.exe'), 'stub', 'utf8')

  const result = resolveToolchain({ projectDir: project, env: {}, searchPackageTools: false })
  assert.ok(result.found.biber, '必须能从 .tools/biber-2.17/ 找到 biber')
  assert.equal(result.found.biber.path, join(biberDir, 'biber.exe'))
  // env 注入用的是上游认的变量名。
  assert.equal(result.env.YIBINTHESIS_BIBER, join(biberDir, 'biber.exe'))
  rmSync(project, { recursive: true, force: true })
})

test('toolchain：显式 toolchain 配置优先于目录扫描', () => {
  const project = mkdtempSync(join(tmpdir(), 'ybt-proj2-'))
  const biberDir = join(project, '.tools', 'biber-2.17')
  mkdirSync(biberDir, { recursive: true })
  writeFileSync(join(biberDir, 'biber.exe'), 'stub', 'utf8')
  const explicitDir = fakeToolDir('explicit', 'special-biber.exe')
  const explicit = join(explicitDir, 'special-biber.exe')

  const result = resolveToolchain({ projectDir: project, toolchain: { biber: explicit }, env: {}, searchPackageTools: false })
  assert.equal(result.found.biber.path, explicit)
  assert.equal(result.found.biber.source, 'config')
  rmSync(project, { recursive: true, force: true })
  rmSync(explicitDir, { recursive: true, force: true })
})

test('toolchain：显式配置的相对路径按项目目录解析', () => {
  const project = mkdtempSync(join(tmpdir(), 'ybt-proj3-'))
  const binDir = join(project, 'mybin')
  mkdirSync(binDir, { recursive: true })
  writeFileSync(join(binDir, 'tectonic.exe'), 'stub', 'utf8')

  const result = resolveToolchain({ projectDir: project, toolchain: { tectonic: 'mybin/tectonic.exe' }, env: {}, searchPackageTools: false })
  assert.equal(result.found.tectonic.path, resolve(project, 'mybin', 'tectonic.exe'))
  rmSync(project, { recursive: true, force: true })
})

test('toolchain：缺失时不伪造路径（缺失必须如实上抛）', () => {
  const project = mkdtempSync(join(tmpdir(), 'ybt-proj4-'))
  const result = resolveToolchain({ projectDir: project, env: {}, searchPackageTools: false })
  assert.equal(result.found.latexmk, undefined, '没有 latexmk 就不该出现在 found 里')
  assert.ok(!('YIBINTHESIS_LATEXMK' in result.env), '不该为缺失的工具注入 env')
  rmSync(project, { recursive: true, force: true })
})

test('composePath：前置项去重、大小写不敏感、保留原 PATH', () => {
  const base = ['C:\\Windows', 'C:\\Other'].join(delimiter)
  const composed = composePath(['C:\\Plugins', 'c:\\plugins', 'C:\\Windows'], base)
  const parts = composed.split(delimiter)
  assert.equal(parts[0], 'C:\\Plugins')
  // 'c:\plugins' 是重复项（大小写不敏感）→ 只保留首个。
  assert.equal(parts.filter((p) => p.toLowerCase() === 'c:\\plugins').length, 1)
  assert.equal(parts.filter((p) => p.toLowerCase() === 'c:\\windows').length, 1)
  assert.ok(parts.includes('C:\\Other'), '原 PATH 的其它项必须保留')
})

test('composePath：保持前置顺序（顺序即优先级）', () => {
  const composed = composePath(['A', 'B', 'C'], 'D')
  assert.deepEqual(composed.split(delimiter), ['A', 'B', 'C', 'D'])
})

test('★ 回归：PATH 前置项必须是目录，不能是 `file.exe\\..` 这种未规范化路径', () => {
  const project = mkdtempSync(join(tmpdir(), 'ybt-proj5-'))
  // 注意目录名要是解析器认识的（`biber-2.17` 或 `biber`），否则探测不到、断言失去意义。
  const binDir = join(project, '.tools', 'biber-2.17')
  mkdirSync(binDir, { recursive: true })
  writeFileSync(join(binDir, 'biber.exe'), 'stub', 'utf8')

  const result = resolveToolchain({ projectDir: project, env: {}, searchPackageTools: false })
  assert.equal(result.pathEntries.length, 1)
  const entry = result.pathEntries[0]
  // `join(path, '..')` 会产出 `...\biber.exe\..`——非法目录项，前置进 PATH 毫无作用。
  assert.ok(!entry.includes('..'), `PATH 项不应含 '..'：${entry}`)
  assert.equal(entry, binDir)
  assert.equal(entry, dirname(result.found.biber.path))
  rmSync(project, { recursive: true, force: true })
})

test('parseDoctorOutput：解析 [OK]/[MISSING]/[INCOMPATIBLE] 与两条汇总行', () => {
  const stdout = [
    'YibinThesis dependency doctor',
    '  Project root: C:\\p',
    '',
    '  [MISSING] latexmk (optional) - not found',
    '  [OK]      Tectonic (optional) - C:\\t\\tectonic.exe [known local path] | Tectonic 0.17.0',
    '  [OK]      Biber (required) - C:\\b\\biber.exe [PATH] | biber version: 2.17',
    '  [INCOMPATIBLE] Biber 2.21; Tectonic 0.16.9 requires Biber 2.17 for BCF 3.8.',
    '  [OK]      Python module: python-docx',
    '  [MISSING] Python module: Pillow',
    '  [OK]      Word builder and reference.docx',
    '',
    '  PDF toolchain:  READY',
    '  Word toolchain: NOT READY',
  ].join('\n')
  const parsed = parseDoctorOutput(stdout)
  const byName = Object.fromEntries(parsed.entries.map((e) => [e.name, e]))

  assert.equal(byName.latexmk.status, 'missing')
  assert.equal(byName.latexmk.required, false)
  assert.equal(byName.Tectonic.status, 'ok')
  assert.equal(byName.Tectonic.path, 'C:\\t\\tectonic.exe')
  assert.equal(byName.Tectonic.source, 'known local path')
  assert.equal(byName.Tectonic.version, 'Tectonic 0.17.0')
  assert.equal(byName.Biber.status, 'ok')
  assert.equal(byName.Biber.required, true)
  assert.equal(byName.Biber.version, 'biber version: 2.17')
  assert.equal(byName['python:python-docx'].status, 'ok')
  assert.equal(byName['python:Pillow'].status, 'missing')
  assert.equal(byName['word-assets'].status, 'ok')
  assert.equal(parsed.pdfReady, true)
  assert.equal(parsed.wordReady, false)
})

test('classifyFailure：把常见失败映射成可操作的 kind', () => {
  assert.equal(classifyFailure({ exitCode: 1, aborted: true }).kind, 'cancelled')
  assert.equal(classifyFailure({ exitCode: null, timedOut: true }).kind, 'timeout')

  const denied = classifyFailure({ spawnError: 'EPERM', stderr: 'spawn EPERM' })
  assert.equal(denied.kind, 'spawn-denied')
  assert.match(denied.message, /pwsh/, '必须给出改用 pwsh 的可操作建议')

  const missing = classifyFailure({ exitCode: 1, stderr: 'Biber is required by this entry point but was not found.' })
  assert.equal(missing.kind, 'missing-toolchain')
  assert.match(missing.message, /Biber/)

  const badProject = classifyFailure({ exitCode: 1, stderr: "YibinThesis project config not found: C:\\x" })
  assert.equal(badProject.kind, 'project-invalid')

  const generic = classifyFailure({ exitCode: 1, stderr: 'something exploded' })
  assert.equal(generic.kind, 'build-failed')
  assert.match(generic.message, /something exploded/)
})

test('looksLikeProject / isInside：项目识别与越界判定', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ybt-look-'))
  assert.equal(looksLikeProject(dir), false)
  writeFileSync(join(dir, PROJECT_CONFIG_NAME), '{}', 'utf8')
  assert.equal(looksLikeProject(dir), true)

  assert.equal(isInside(join(dir, 'a', 'b'), dir), true)
  assert.equal(isInside(dir, dir), true)
  assert.equal(isInside(tmpdir(), dir), false)
  // 前缀相近但不相同的路径不能被误判为「内部」。
  assert.equal(isInside(`${dir}-sibling`, dir), false)
  rmSync(dir, { recursive: true, force: true })
})
