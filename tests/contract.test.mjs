// 端到端契约测试：不依赖真实 DSH 宿主，但**真执行** apply 与全部工具。
//
// 为什么不 mock 掉一切：本包最容易静默失效的地方恰恰是「定义形态」——
// `defineTool` 从显式白名单构造工具对象，未知顶层键既不读取也不报错
// （见 research/contracts.md §A.7）。一个只检查「函数被调用过」的 mock 会放过这类缺陷，
// 所以这里的替身**按契约校验字段**：unknown 顶层键 → 抛错；非法参数形态 → 抛错。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url))
const { installTools } = await import('../lib/tools.js')
// 本包自带的零依赖 defineTool（运行期用它，不用宿主包——理由见 lib/tool-builder.js）。
const { defineTool: localDefineTool, compilePropertyMap } = await import('../lib/tool-builder.js')
const { apply, splitFrontmatter, resolveConfig, validateConfig, CONFIG_DEFAULTS } = {
  ...(await import('../lib/index.js')),
  ...(await import('../lib/config.js')),
}

/**
 * 把本包自带的 `defineTool` 包一层，记录每次定义时收到的 options，便于断言。
 *
 * 为什么记录 options 而不是返回值：`lib/tools.js` 里的 `render` 会读 `value` 上的业务字段
 * （如 `value.ok`），拿 `{ok:true}` 去探测它对某些工具会抛——那是**调用期**行为，
 * 与「定义形态是否合法」无关。定义形态由真实现本身的定义期校验保证。
 */
function makeCapturingDefineTool() {
  const defined = []
  const defineTool = (options) => {
    defined.push({ options })
    return localDefineTool(options)
  }
  return { defineTool, defined }
}

/** 最小 ctx 替身：记录注册了哪些工具、哪些路由。 */
function makeCtx() {
  const registered = []
  const routes = []
  const skills = []
  const effects = []
  // Cordis 把服务直接挂到 ctx 上（`declare module '@deepseek-ai/cordis' { interface Context { tools: ToolRuntime } }`），
  // 故契约形态是 `ctx.tools.register(...)`；`ctx.get('tools')` 只是可选依赖的取法。
  // 替身必须两种都给，否则测出来的不是真实契约。
  const tools = { register: (definition) => { registered.push(definition); return () => {} } }
  const webServer = { register: (route) => { routes.push(route); return () => {} } }
  return {
    registered,
    routes,
    skills,
    effects,
    ctx: {
      tools,
      webServer,
      get(name) {
        if (name === 'tools') return tools
        if (name === 'webServer') return webServer
        return undefined
      },
      effect(fn, label) {
        const result = fn()
        effects.push({ label, result })
      },
      get logger() {
        return undefined
      },
      skills: {
        register(skill) {
          skills.push(skill)
          return () => {}
        },
      },
    },
  }
}

/** 造一个最小但**真实**的 YibinThesis 项目。 */
function makeProject() {
  const dir = mkdtempSync(join(tmpdir(), 'ybt-test-'))
  mkdirSync(join(dir, 'latex', 'chapters'), { recursive: true })
  writeFileSync(join(dir, 'latex', 'main.tex'), '\\documentclass[thesis,science]{yibinthesis}\n\\input{chapters/10-introduction}\n', 'utf8')
  writeFileSync(
    join(dir, 'latex', 'metadata.tex'),
    '\\yibinsetup{\n  title = {测试题目},\n  author = {张三},\n}\n',
    'utf8',
  )
  writeFileSync(join(dir, 'latex', 'chapters', '10-introduction.tex'), '本文研究汉字统计。\n', 'utf8')
  writeFileSync(
    join(dir, 'yibinthesis.project.json'),
    JSON.stringify({
      schemaVersion: 1,
      main: 'latex/main.tex',
      outputRoot: 'build',
      checkOutputRoot: 'build/checks',
      citationMode: 'linked',
      wordRefresh: 'auto',
      deliverables: { pdf: 'build/deliverables/{{title}}.pdf', word: 'build/deliverables/{{title}}.docx' },
    }),
    'utf8',
  )
  return dir
}

test('Config：默认值可解析，未知键与类型错误响亮失败', () => {
  assert.deepEqual(resolveConfig(undefined), CONFIG_DEFAULTS)
  assert.equal(resolveConfig({ quiet: true }).quiet, true)
  assert.equal(resolveConfig({ buildTimeoutMs: 1000 }).buildTimeoutMs, 1000)

  const unknown = validateConfig({ nope: 1 })
  assert.ok(unknown.issues, '未知键必须报 issue')
  assert.match(unknown.issues[0].message, /不认识的配置键/)

  const wrongType = validateConfig({ quiet: 'yes' })
  assert.ok(wrongType.issues, '类型错误必须报 issue')

  const badPositive = validateConfig({ buildTimeoutMs: -1 })
  assert.ok(badPositive.issues, '非正数必须报 issue')

  const badTool = validateConfig({ toolchain: { nope: 'x' } })
  assert.ok(badTool.issues, '未知工具名必须报 issue')

  assert.throws(() => resolveConfig({ quiet: 'yes' }), /config 非法/)
})

test('入口：注册技能，且技能 frontmatter 被正确解析', () => {
  const { ctx, skills } = makeCtx()
  apply(ctx, {})
  assert.equal(skills.length, 1, '必须注册恰好一个技能')
  const skill = skills[0]
  assert.equal(skill.name, 'yibinthesis')
  assert.ok(skill.description.length > 20, 'description 是模型路由依据，不能为空')
  assert.ok(skill.whenToUse, 'whenToUse 必须存在（否则注册字段会消失）')
  assert.ok(skill.content.length > 500, '技能正文必须真的加载到')
  assert.equal(skill.resourceBase.kind, 'directory')
  assert.ok(existsSync(join(skill.resourceBase.path, 'SKILL.md')), 'resourceBase 必须指向含 SKILL.md 的目录')
  assert.ok(!skill.content.startsWith('---'), 'frontmatter 必须从正文里剥掉')
})

test('splitFrontmatter：CRLF 与 BOM 下不静默退化', () => {
  const crlf = '---\r\nname: x\r\ndescription: y\r\nwhenToUse: z\r\n---\r\n\r\nbody\r\n'
  const parsed = splitFrontmatter(crlf)
  assert.equal(parsed.parsed, true, 'CRLF 必须能解析（否则 description/whenToUse 静默丢失）')
  assert.equal(parsed.fields.name, 'x')
  assert.equal(parsed.fields.whenToUse, 'z')
  assert.equal(parsed.body.trim(), 'body')

  const bom = '\uFEFF---\nname: a\ndescription: b\n---\nbody'
  assert.equal(splitFrontmatter(bom).fields.name, 'a')

  const none = splitFrontmatter('no frontmatter here')
  assert.equal(none.parsed, false)
  assert.equal(none.body, 'no frontmatter here')
})

test('工具：契约合法的定义形态，且 6 个工具全部注册', async () => {
  const { ctx, registered, routes } = makeCtx()
  const { defineTool, defined } = makeCapturingDefineTool()
  const disposers = installTools(ctx, {
    config: { ...CONFIG_DEFAULTS },
    defineToolImpl: defineTool,
  })
  assert.equal(disposers.length, 6, '应注册 6 个工具')
  assert.equal(registered.length, 6)

  const names = registered.map((tool) => tool.name).sort()
  assert.deepEqual(names, [
    'yibinthesis_build',
    'yibinthesis_check',
    'yibinthesis_clean',
    'yibinthesis_doctor',
    'yibinthesis_new',
    'yibinthesis_probe',
  ])

  // ★ 回归防线：`executionMode` 不是 defineTool 的合法键（会被静默忽略）。
  for (const { options } of defined) {
    assert.equal(options.executionMode, undefined, `${options.name} 不得使用 executionMode（无效果）`)
  }
  // 并发语义必须通过 isConcurrencySafe 表达：只读工具 true，写盘工具 false。
  const byName = Object.fromEntries(defined.map(({ options }) => [options.name, options]))
  assert.equal(byName.yibinthesis_probe.isConcurrencySafe({}), true)
  assert.equal(byName.yibinthesis_doctor.isConcurrencySafe({}), true)
  assert.equal(byName.yibinthesis_build.isConcurrencySafe({}), false)
  assert.equal(byName.yibinthesis_new.isConcurrencySafe({}), false)
  // 桥不在这里注册（它由入口单独挂载）。
  assert.equal(routes.length, 0)
})

test('★ 生产路径：不注入替身时，用本包自带的 defineTool 注册 6 个工具', () => {
  // 覆盖真实运行路径：`installTools` 默认使用本包自带的 `lib/tool-builder.js`，
  // **完全不依赖宿主包**（理由见 lib/tool-builder.js 文件头：宿主 225 个 @deepseek-ai/*
  // junction 在本机全部断链，任何「运行时依赖宿主包」的方案都不可靠）。
  const { ctx, registered } = makeCtx()
  const disposers = installTools(ctx, { config: { ...CONFIG_DEFAULTS } })
  assert.equal(disposers.length, 6)
  assert.equal(registered.length, 6)
  // 自带实现产出的 parameters 必须是完整可用的原始 JSON Schema。
  for (const tool of registered) {
    assert.equal(tool.parameters.type, 'object', `${tool.name}.parameters 应是 object 根`)
    assert.equal(typeof tool.parameters.properties, 'object')
    assert.equal(typeof tool.output.render, 'function')
    assert.equal(typeof tool.execute, 'function')
  }
})

test('工具：宿主无 tools 服务时入口降级，而技能照常可用', () => {
  // 这是真实会话里最可能出现的降级形态：宿主没给 tools 服务。
  // 入口（lib/index.js）用 `ctx.get('tools')` 取，取不到只发 warn，不抛。
  const skills = []
  const ctx = {
    get() {
      return undefined
    },
    effect(fn, label) {
      fn()
      void label
    },
    skills: {
      register(skill) {
        skills.push(skill)
        return () => {}
      },
    },
  }
  apply(ctx, {})
  assert.equal(skills.length, 1, '技能必须仍然注册成功（工具降级不影响技能）')
  assert.equal(skills[0].name, 'yibinthesis')
})

test('工具：定义被拒绝时**抛**，由入口降级为「工具未启用」', () => {
  const { ctx, registered } = makeCtx()
  // 用一个会抛的实现模拟「宿主注册表拒绝该定义」。
  assert.throws(
    () =>
      installTools(ctx, {
        config: { ...CONFIG_DEFAULTS },
        defineToolImpl: () => {
          throw new TypeError('宿主注册表拒绝了该工具定义')
        },
      }),
    /拒绝了该工具定义/,
    '定义失败必须抛，而不是静默注册 0 个工具',
  )
  assert.equal(registered.length, 0)
})

test('工具：缺项目目录时报可操作错误，而不是抛或猜 cwd', async () => {
  const { ctx, registered } = makeCtx()
  const { defineTool } = makeCapturingDefineTool()
  installTools(ctx, { config: { ...CONFIG_DEFAULTS }, defineToolImpl: defineTool })
  const probe = registered.find((tool) => tool.name === 'yibinthesis_probe')
  const value = await probe.execute({}, { signal: undefined })
  assert.equal(value.ok, false)
  assert.equal(value.kind, 'invalid-request')
  assert.match(value.message, /未指定论文项目目录/)
})

test('工具：目录存在但不是 YibinThesis 项目时如实报错', async () => {
  const empty = mkdtempSync(join(tmpdir(), 'ybt-empty-'))
  const { ctx, registered } = makeCtx()
  const { defineTool } = makeCapturingDefineTool()
  installTools(ctx, { config: { ...CONFIG_DEFAULTS }, defineToolImpl: defineTool })
  const probe = registered.find((tool) => tool.name === 'yibinthesis_probe')
  const value = await probe.execute({ project_dir: empty }, { signal: undefined })
  assert.equal(value.ok, false)
  assert.match(value.message, /yibinthesis\.project\.json/)
  rmSync(empty, { recursive: true, force: true })
})

test('工具：probe 返回结构化项目摘要（真跑 Python 适配器）', async (t) => {
  const project = makeProject()
  const { ctx, registered } = makeCtx()
  const { defineTool } = makeCapturingDefineTool()
  installTools(ctx, { config: { ...CONFIG_DEFAULTS }, defineToolImpl: defineTool })
  const probe = registered.find((tool) => tool.name === 'yibinthesis_probe')
  const value = await probe.execute({ project_dir: project }, { signal: undefined })
  if (!value.ok && /适配器/.test(value.message || '')) {
    t.skip(`本机无法运行 Python 适配器：${value.message}`)
    return
  }
  assert.equal(value.ok, true, `probe 应成功，实际：${JSON.stringify(value).slice(0, 400)}`)
  assert.equal(value.project.documentClass.documentType, 'thesis')
  assert.equal(value.project.documentClass.discipline, 'science')
  assert.equal(value.config.citationMode, 'linked')
  assert.equal(value.metadata.title, '测试题目')
  assert.equal(value.metadata.author, '张三')
  // 交付路径的占位符必须被 metadata 字段展开。
  assert.match(value.outputs.pdfDeliverable, /测试题目\.pdf$/)
  assert.equal(value.chapters.length, 1)
  assert.ok(value.totalHan > 0, '汉字数应被统计')
  rmSync(project, { recursive: true, force: true })
})

test('工具：probe 对非法配置给出 project-invalid（不静默回落）', async (t) => {
  const project = makeProject()
  writeFileSync(join(project, 'yibinthesis.project.json'), JSON.stringify({ schemaVersion: 2, main: 'latex/main.tex' }), 'utf8')
  const { ctx, registered } = makeCtx()
  const { defineTool } = makeCapturingDefineTool()
  installTools(ctx, { config: { ...CONFIG_DEFAULTS }, defineToolImpl: defineTool })
  const probe = registered.find((tool) => tool.name === 'yibinthesis_probe')
  const value = await probe.execute({ project_dir: project }, { signal: undefined })
  if (/适配器/.test(value.message || '')) {
    t.skip('本机无法运行 Python 适配器')
    return
  }
  assert.equal(value.ok, false)
  assert.equal(value.kind, 'project-invalid')
  assert.match(value.message, /schemaVersion/)
  rmSync(project, { recursive: true, force: true })
})

// 桥的路由行为测试在 `tests/bridge.test.mjs`（专测只读面：路由全集、凭据泄露、
// 交付物存在性、客户端断开保护等）。这里只保留与「客户端半模块形态」相关的契约测试。

test('★ 客户端半：必须用 React.createElement 建元素，不得用 react/jsx-runtime 的 jsx', () => {
  // 这条防的是**实装过的缺陷**（实机表现：面板是空的）。
  //
  // `react/jsx-runtime` 导出 `jsx(type, props, key)`——只接受三个参数，
  // **children 必须放进 props**，第三个位置参数是 key。历史上 client.js 写的是
  //   const h = jsxRuntime.jsx
  //   h('div', props, child1, child2, child3, …)
  // 于是第 2 个起的子节点被**静默丢弃**，面板只剩骨架，且不报错。
  //
  // `React.createElement(type, props, ...children)` 接受变长 children，是稳定公开 API。
  const source = readFileSync(join(PACKAGE_ROOT, 'lib', 'client.js'), 'utf8')
  // 先剥离注释：本文件在注释里**故意**引用了 `jsxRuntime.jsx` 来解释这个缺陷，
  // 不剥离注释会把「说明文字」误判成「违规代码」。
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.ok(
    !/jsxRuntime\s*\.\s*jsx/.test(code),
    '客户端半不得用 react/jsx-runtime 的 jsx 建元素（它会丢弃第 2 个起的子节点）',
  )
  assert.match(code, /const h = React\.createElement/, 'h 必须绑定到 React.createElement')
})

test('客户端半：是 __ModuleLoader__ 包裹格式，导出 apply 与 inject', () => {
  const source = readFileSync(join(PACKAGE_ROOT, 'lib', 'client.js'), 'utf8')
  assert.match(source, /^window\.__ModuleLoader__\.load\(\{/m, '客户端半必须是 __ModuleLoader__ 包裹格式（普通 ESM 会静默不加载）')
  assert.match(source, /exports\.apply\s*=\s*apply/)
  assert.match(source, /exports\.inject\s*=\s*inject/)
  assert.match(source, /id:\s*'yibinthesis-dsh'/, 'id 必须是包名')
})

test('★ 客户端半：必须注册会话右侧栏标签（声明 + body + 标签头三件配对）', () => {
  // 这条防的是**实装过的两次缺陷**：
  //   ① 面板只挂在 `plugins.row.config` —— 用户要走「插件 → 已安装 → 找到该行 → 点该行的
  //      『配置』」三步，中途点到插件名还会先落到宿主的信息页，实际反馈是「面板在哪」。
  //   ② 改挂到应用级 `sidebar.panellist` + `main` —— 位置对了但**层级错了**：这个面板讲的是
  //      **当前会话的论文项目**，属于会话级 UI，应与其他会话工具（工作区文件 / 上下文 /
  //      新建终端 / 浏览器）同列。
  //
  // 现在按 `dsh-context`（同为第三方、同为会话级面板）实测的写法注册到会话右侧栏，四件配对：
  //   · `ctx.inject(['sidebarRightTabs'])` → `sidebarRightTabs.register({ id, kind, title, guide })`
  //   · 槽位 `sidebar.right.pane.tab`（body）
  //   · 槽位 `sidebar.right.pane.tab.title`（标签头）
  // 三者必须共用**同一个 id**（契约：body 按 kind 生效的 type id 分发）。
  const source = readFileSync(join(PACKAGE_ROOT, 'lib', 'client.js'), 'utf8')
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  assert.match(code, /ctx\.inject\(\['sidebarRightTabs'\]/, '必须延迟注入 sidebarRightTabs 服务')
  assert.match(code, /tabs\.register\(\{/, '必须声明标签条目（否则标签不出现）')
  // `guide` 必须给：右侧栏标签**不是自动出现的**——用户要在右侧栏的「开始」页里
  // 选一个 provider，面板才会在旁边打开。没有 guide，provider 不出现在该页
  // ——这正是实机「标签条里看不到它」的原因（`dsh-context` README 原文：
  // 「pick Context on the sidebar's guide page and the panel opens beside the chat」）。
  assert.match(code, /guide:\s*\[/, '必须带 guide 条目（否则用户无法在「开始」页选中它）')
  assert.match(code, /order:\s*TAB_GUIDE_ORDER/, 'guide 条目需要 order 决定位置')
  assert.match(code, /const TAB_GUIDE_ORDER = \d+/, 'TAB_GUIDE_ORDER 必须是常量')
  assert.match(code, /const TAB_ID = '/, 'TAB_ID 必须是常量，避免三处不一致')
  assert.match(code, /id:\s*TAB_ID/, '标签声明必须用 TAB_ID')
  assert.match(code, /slots\.inject\('sidebar\.right\.pane\.tab',/, '必须注册标签 body 槽位')
  assert.match(code, /slots\.inject\('sidebar\.right\.pane\.tab\.title',/, '必须注册标签头槽位')
  // 两个槽位的 key 都必须是 TAB_ID。
  assert.match(code, /name:\s*'sidebar\.right\.pane\.tab',\s*\n\s*key:\s*TAB_ID/, 'body 的 key 必须是 TAB_ID')
  assert.match(code, /name:\s*'sidebar\.right\.pane\.tab\.title',\s*\n\s*key:\s*TAB_ID/, '标签头的 key 必须是 TAB_ID')

  // 不得再挂回应用级侧栏（那是层级错误）。
  assert.ok(!/slots\.inject\('sidebar\.panellist'/.test(code), '不应挂到应用级侧栏（层级错误）')
  assert.ok(!/slots\.inject\('main'/.test(code), '不应占用 main 主面板')

  // 词典：标题走 thunk，注册失败时必须有中文回退（没有文字的标签等于不存在）。
  assert.match(code, /ctx\.locale\.register\(NS,\s*\{\s*zh,\s*en\s*\}\)/, '必须注册 zh/en 词典')
  assert.match(code, /return zh\[key\] \|\| key/, 't() 必须有中文回退，不能渲染成空白')

  // 部分注册失败必须回滚，避免留下「半个标签」。
  assert.match(code, /disposeAll\(disposers\)/, '注册失败必须回滚已成功的部分')
})

test('package.json：dsh.* 契约字段齐备且自洽', () => {
  const manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'))
  assert.equal(manifest.name, 'yibinthesis-dsh')
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(manifest.dsh.client.platform, 'web')
  // dsh.client.inject 写的是**包名**，不是服务名（§D.3）。
  for (const entry of manifest.dsh.client.inject) {
    assert.ok(entry.startsWith('@deepseek-ai/'), `dsh.client.inject 必须是包名，收到 "${entry}"`)
  }
  assert.equal(manifest.exports['./client'].default, './lib/client.js')
  assert.equal(manifest.exports['.'].default, './lib/index.js')
  assert.ok(manifest.files.includes('vendor'), 'vendor 模板运行时必须在发布清单里')
  assert.ok(manifest.files.includes('adapter'), 'Python 适配器必须在发布清单里')
  assert.ok(manifest.files.includes('skills'), '技能必须在发布清单里')
})

test('cordis.patch.yml：必须插入一行 name = 本包包名（否则入口永不被 import）', () => {
  const patch = readFileSync(join(PACKAGE_ROOT, 'cordis.patch.yml'), 'utf8')
  assert.match(patch, /^\s*-\s*insert:/m, '必须用 - insert: 新增行')
  assert.match(patch, /name:\s*yibinthesis-dsh/, 'patch 行必须写本包包名')
  assert.match(patch, /id:\s*yibinthesis/, 'patch 行必须有 id')
  // 客户端半不需要 patch 行（由 dsh.client 驱动）——不应出现客户端包名。
  assert.ok(!patch.includes('dsh-client-'), '客户端半不应在 patch 里挂行')
})

test('vendor 模板运行时：构建器与 Word 资源齐备', () => {
  const vendor = join(PACKAGE_ROOT, 'vendor', 'yibinthesis')
  for (const rel of [
    'build.ps1',
    'yibinthesis.cls',
    'yibinthesis-proposal.sty',
    'yibinthesis-literature-review.sty',
    'yibinthesis.project.schema.json',
    'lib/build_word.py',
    'lib/audit_format.py',
    'lib/word_core.py',
    'word/reference.docx',
    'assets/yibin-university-logo.png',
    'NOTICE',
  ]) {
    assert.ok(existsSync(join(vendor, rel)), `vendor 缺少 ${rel}`)
  }
  // 冒烟夹具是 `check` 的**硬依赖**：`Invoke-Checks`（build.ps1:1119-1123）在审计论文之外
  // 还会无条件构建 `tests\smoke.tex` 与 `tests\smoke-science.tex`；缺了它们 check 必失败。
  for (const rel of ['tests/smoke.tex', 'tests/smoke-science.tex', 'tests/yibinthesis.cls']) {
    assert.ok(existsSync(join(vendor, rel)), `vendor 缺少冒烟夹具 ${rel}（会让 yibinthesis_check 失败）`)
  }
  // 上游 CLI 的脚手架源码**不**随包（`new` 复用上游，不做第二份会漂移的副本）。
  assert.ok(!existsSync(join(vendor, 'lib', 'yibinthesis_cli')), 'vendor 不应包含 yibinthesis_cli（避免漂移）')
  // 上游单元测试与回归夹具不需要（只要冒烟 .tex）。
  assert.ok(!existsSync(join(vendor, 'lib', 'tests')), 'vendor 不应包含 lib/tests（上游单测，非构建需要）')
})

// ── 辅助：以最小 req/res 替身驱动一个路由 ─────────────────────────────────

function invokeRoute(route, method, url) {
  return new Promise((resolve) => {
    const handlers = {}
    const req = {
      method,
      url,
      on(event, cb) {
        handlers[event] = cb
        return this
      },
      destroy() {},
    }
    const res = {
      status: null,
      headers: null,
      body: null,
      writableEnded: false,
      destroyed: false,
      writeHead(status, headers) {
        this.status = status
        this.headers = headers
      },
      end(body) {
        this.body = body
        this.writableEnded = true
        resolve({ status: this.status, headers: this.headers, body: JSON.parse(body) })
      },
      on() {
        return this
      },
    }
    Promise.resolve(route.handler(req, res)).catch((error) => {
      resolve({ status: 500, headers: null, body: { ok: false, error: { kind: 'threw', message: String(error?.message || error) } } })
    })
  })
}
