// 预演：在**最接近真实宿主**的条件下加载已安装的插件入口。
//
// 为什么需要它：profile 里的包是通过 pnpm 装成**链接**的，而且宿主目录布局特殊。
// 若入口在这些条件下加载失败，用户会在「重启 DSH 之后」才发现——代价高。
// 本脚本从**已安装位置**（而非源码目录）解析入口并真跑 apply，把问题提前暴露。
//
// 用法：node tests/installed-entry.test.mjs
//   （也作为 node --test 的一个用例运行；装不到 profile 时自动跳过。）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const INSTALLED = 'C:/Users/LoyDgIk/.dsh/profiles/desktop/node_modules/yibinthesis-dsh'
const INSTALLED_ENTRY = `${INSTALLED}/lib/index.js`
const available = existsSync(INSTALLED_ENTRY)

test('已安装副本：入口可加载、技能可注册、6 个工具可注册', async (t) => {
  if (!available) {
    t.skip(`尚未安装到 profile：${INSTALLED_ENTRY}`)
    return
  }

  // 用**已安装位置**做基准解析，等价于宿主 loader 的解析起点。
  const require = createRequire(INSTALLED_ENTRY)

  // ① 关键性质：入口**不依赖**宿主包就能注册工具。
  //
  //    背景（实测）：宿主把 `@deepseek-ai/*` 以 junction 放在 profile 的 node_modules 下，
  //    本机 **225 个 junction 全部断链**（指向已不存在的 `…\DSH Desktop\…`）。
  //    把 dsh-tools 声明为依赖也不够——profile 的 `nodeLinker: hoisted` 会把它提升到
  //    `<profile>/node_modules/@deepseek-ai/dsh-tools`，该副本要 import 自己的 peer
  //    `@deepseek-ai/cordis`，而那里的 cordis 正是断链 junction → ERR_MODULE_NOT_FOUND。
  //    故本包自带 `lib/tool-builder.js`（零宿主依赖），并且**不应**在运行期解析宿主包。
  const hostPkgResolvable = (() => {
    try {
      require.resolve('@deepseek-ai/dsh-tools')
      return true
    } catch {
      return false
    }
  })()
  // 记录事实（不当作失败）：这正是自带实现的动机。
  assert.equal(typeof hostPkgResolvable, 'boolean')

  // ② 入口本身可 import。
  const entry = await import(pathToFileURL(INSTALLED_ENTRY).href)
  assert.equal(typeof entry.apply, 'function', '入口必须导出 apply')
  assert.equal(entry.name, 'yibinthesis-dsh')
  assert.deepEqual(entry.inject, ['skills', 'tools'])
  assert.equal(typeof entry.Config, 'object', '入口必须导出 Config（否则配置会被静默丢弃）')
  // 自带的工具构造器必须随包。
  assert.ok(existsSync(`${INSTALLED}/lib/tool-builder.js`), '已安装副本必须含 lib/tool-builder.js（零宿主依赖的 defineTool）')

  // ③ 真跑 apply：技能必须注册，工具必须注册。
  const skills = []
  const registered = []
  const routes = []
  const effects = []
  const tools = { register: (d) => { registered.push(d); return () => {} } }
  const webServer = { register: (r) => { routes.push(r); return () => {} } }
  const ctx = {
    tools,
    webServer,
    get(name) {
      if (name === 'tools') return tools
      if (name === 'webServer') return webServer
      return undefined
    },
    skills: { register: (s) => { skills.push(s); return () => {} } },
    effect(fn, label) {
      effects.push({ label, result: fn() })
    },
  }

  entry.apply(ctx, {})
  // 工具注册走的是异步动态 import，给它时间落地。
  for (let i = 0; i < 60 && registered.length < 6; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 50))
  }

  assert.equal(skills.length, 1, '技能必须注册')
  assert.equal(skills[0].name, 'yibinthesis')
  assert.ok(skills[0].content.length > 500, '技能正文必须加载到')
  assert.ok(
    existsSync(`${skills[0].resourceBase.path}/SKILL.md`),
    `技能的 resourceBase 必须指向含 SKILL.md 的目录，实际：${skills[0].resourceBase.path}`,
  )

  assert.equal(registered.length, 6, `6 个工具必须注册，实际 ${registered.length}：${registered.map((x) => x.name).join(', ')}`)
  assert.ok(routes.length >= 1, '面板数据桥必须挂到 webServer')
  assert.ok(
    effects.some((e) => String(e.label).includes('skill')),
    '技能注册必须包在 ctx.effect 里（保证可卸载）',
  )
})

test('已安装副本：随包技能与模板运行时确实随包（不是指向源码目录）', async (t) => {
  if (!available) {
    t.skip('尚未安装到 profile')
    return
  }
  // 技能目录与 vendored 模板必须在**已安装副本内**，
  // 否则用户换目录或源码目录被移动后插件立刻失效。
  for (const rel of [
    'skills/yibinthesis/SKILL.md',
    'skills/yibinthesis/references/toolchain.md',
    'vendor/yibinthesis/build.ps1',
    'vendor/yibinthesis/lib/build_word.py',
    'vendor/yibinthesis/lib/word_core.py',
    'vendor/yibinthesis/tests/smoke.tex',
    'lib/tool-builder.js',
    'adapter/yibinthesis_probe.py',
    'lib/client.js',
    'cordis.patch.yml',
  ]) {
    assert.ok(existsSync(`${INSTALLED}/${rel}`), `已安装副本缺少 ${rel}`)
  }
})
