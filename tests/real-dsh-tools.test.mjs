// 用**宿主真实的** `defineTool` 验证工具定义能否被接受。
//
// 为什么值得单独一层测试：`defineTool` 在**定义期**就校验 schema。
// 如果 `output.schema` 或 `parameters` 的形态不合 DSL，定义期会抛——
// 而真实的插件入口通常把这个异常吞成一行日志，于是**表现为「工具不见了」而没有任何明显错误**。
// 这种静默失效只能靠拿真实现做一次定义期验证来防。
//
// 依赖准备：本测试需要一个能解析 `@deepseek-ai/dsh-tools` 的环境。
//
// 做法演进（值得记录，因为踩过坑）：早期版本在包根建 `node_modules/@deepseek-ai/dsh-tools`
// 的 **junction**，测完再删。两个问题：① Windows 上 `rmSync(junction, {recursive:true})`
// 会删掉**目标内容**或留下空壳，语义不可靠；② 残留会让 `contract.test.mjs` 里
// 「宿主无 dsh-tools 时优雅降级」的用例**静默失效**（模块突然变得可解析了）。
//
// 现方案：**不碰包目录**。把真实安装目录写进 `NODE_PATH`，再用 `cwd` 限定在临时目录里
// 动态 `import('@deepseek-ai/dsh-tools')`。Node 会经 `NODE_PATH` 解析，包树保持干净。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url))

/**
 * 定位宿主真实的 `@deepseek-ai/dsh-tools`，按以下顺序尝试：
 *
 * 1. `YIBINTTHESIS_REAL_TOOLS`（显式指定，优先级最高）；
 * 2. 本包 `_scratch/realtools/…` —— 从 npm registry 解包的副本（**不进仓库**，
 *    故 clone 后通常不存在，测试会自动跳过）；
 * 3. 从 DSH profile 的 `node_modules` 里找（装了 DSH 的机器上一般有，
 *    但实测常见坑：那里的 `@deepseek-ai/*` 可能是**断链 junction**，故仍需 existsSync 校验）。
 *
 * 早期版本把第 2 条写成了硬编码的绝对路径，导致换机/换目录后这个测试静默失效
 * ——它本意是「用宿主真 DSL 做等价比对」，静默跳过就失去了意义。
 * @returns 候选目录（第一个真正含入口文件的），或 `null`。
 */
function locateRealTools() {
  const candidates = []
  if (process.env.YIBINTTHESIS_REAL_TOOLS) candidates.push(process.env.YIBINTTHESIS_REAL_TOOLS)
  candidates.push(join(PACKAGE_ROOT, '_scratch', 'realtools', 'node_modules', '@deepseek-ai', 'dsh-tools'))
  const home = process.env.USERPROFILE || process.env.HOME
  if (home) {
    candidates.push(join(home, '.dsh', 'profiles', 'node_modules', '@deepseek-ai', 'dsh-tools'))
    candidates.push(join(home, '.dsh', 'profiles', 'desktop', 'node_modules', '@deepseek-ai', 'dsh-tools'))
  }
  for (const candidate of candidates) {
    try {
      if (existsSync(join(candidate, 'lib', 'index.js'))) return candidate
    } catch {
      /* 权限等问题：试下一个 */
    }
  }
  return null
}

const REAL_TOOLS = locateRealTools()
const available = REAL_TOOLS !== null

/**
 * 从**包外**的动态上下文里取真实的 `@deepseek-ai/dsh-tools`。
 *
 * 用 `pathToFileURL` 直接指向包入口，而不是走 specifier 解析——这样连 `NODE_PATH`
 * 都不需要，且**绝对不会**污染包目录或触发任何链接创建。
 * @returns 真实模块的命名空间。
 */
async function loadRealTools() {
  return import(pathToFileURL(join(REAL_TOOLS, 'lib', 'index.js')).href)
}

test('前置事实：宿主真实 dsh-tools 可用', (t) => {
  if (!available) {
    t.skip(`未找到真实 @deepseek-ai/dsh-tools：${REAL_TOOLS}（设 YIBINTTHESIS_REAL_TOOLS 指向它）`)
    return
  }
  assert.ok(existsSync(join(REAL_TOOLS, 'lib', 'index.js')))
})

test('真实 defineTool 接受全部 6 个 yibinthesis_* 工具定义', async (t) => {
  if (!available) {
    t.skip('本机没有真实 dsh-tools')
    return
  }
  const realTools = await loadRealTools()
  const { defineTool } = realTools
  assert.equal(typeof defineTool, 'function')

  const registered = []
  const ctx = {
    tools: { register: (definition) => { registered.push(definition); return () => {} } },
    get(name) {
      return name === 'tools' ? this.tools : undefined
    },
  }

  const { installTools } = await import('../lib/tools.js')
  const { CONFIG_DEFAULTS } = await import('../lib/config.js')
  // 注入**真实**的 defineTool（而不是替身）→ 一次性验证全部工具定义在真 DSL 下合法。
  // 同时这也是「本包自己 parse 出来的工具对象」与「宿主真实注册表要求」的对齐检查。
  const disposers = installTools(ctx, {
    config: { ...CONFIG_DEFAULTS },
    defineToolImpl: realTools.defineTool,
  })

  assert.equal(disposers.length, 6, '真实 defineTool 下也应注册 6 个工具')
  assert.equal(registered.length, 6)

  for (const tool of registered) {
    assert.equal(typeof tool.name, 'string')
    assert.equal(typeof tool.description, 'string')
    assert.ok(tool.description.length > 20, `${tool.name} 的描述要足够模型路由`)
    // 真实 defineTool 把参数编成原始 JSON Schema：应有 properties；
    // `required` 只在**确有**必填参数时才出现（全可选时该键被省略），故不能无条件断言它是数组。
    assert.equal(tool.parameters.type, 'object', `${tool.name}.parameters 应是 object 根`)
    assert.equal(typeof tool.parameters.properties, 'object')
    if (tool.parameters.required !== undefined) {
      assert.ok(Array.isArray(tool.parameters.required), `${tool.name}.parameters.required 若是出现则必须是数组`)
    }
    // output 必须是 { schema, render }，且 render 返回 ContentBlock[]。
    assert.equal(typeof tool.output.render, 'function')
    assert.equal(typeof tool.output.schema, 'object')
    const blocks = tool.output.render({}, { ok: true, probe: true })
    assert.ok(Array.isArray(blocks))
    assert.ok(blocks.length > 0)
    assert.equal(blocks[0].type, 'text')
    assert.equal(typeof blocks[0].text, 'string')
    // execute 必须存在且是函数（真实注册表在此之上再包一层参数校验）。
    assert.equal(typeof tool.execute, 'function')
  }

  const names = registered.map((tool) => tool.name).sort()
  assert.deepEqual(names, [
    'yibinthesis_build',
    'yibinthesis_check',
    'yibinthesis_clean',
    'yibinthesis_doctor',
    'yibinthesis_new',
    'yibinthesis_probe',
  ])
})

test('回归防线：真实 defineTool 会拒绝带 required 的 output.schema', async (t) => {
  if (!available) {
    t.skip('本机没有真实 dsh-tools')
    return
  }
  const { defineTool } = await loadRealTools()
  // 这是「陷阱本身」的可执行文档：证明 output.schema 里写 required 会在定义期抛，
  // 从而解释为什么本包所有工具都用 `{ type: 'json' }` 作为输出 schema。
  assert.throws(
    () =>
      defineTool({
        name: 'ybt_trap_probe',
        description: '用于证明 output.schema 不接受 required 的探针工具',
        parameters: { x: { type: 'string' } },
        output: {
          schema: { type: 'object', additionalProperties: false, properties: { a: { type: 'string' } }, required: ['a'] },
          render: () => [{ type: 'text', text: 'x' }],
        },
        execute: async () => ({ a: 'x' }),
      }),
    (error) => {
      assert.ok(error instanceof Error)
      return true
    },
    'output.schema 带 required 必须抛错（否则这条陷阱会被静默放过）',
  )
})

test('回归防线：真实 defineTool 的 parameters.required 形态有效', async (t) => {
  if (!available) {
    t.skip('本机没有真实 dsh-tools')
    return
  }
  const { defineTool } = await loadRealTools()
  const tool = defineTool({
    name: 'ybt_param_probe',
    description: '用于证明 parameters.<name>.required:true 会被编进 required 数组',
    parameters: {
      needed: { type: 'string', required: true, description: '必填项' },
      optional: { type: 'number', description: '可选项' },
    },
    output: { schema: { type: 'json' }, render: () => [{ type: 'text', text: 'x' }] },
    execute: async () => ({}),
  })
  assert.deepEqual(tool.parameters.required, ['needed'])
  assert.ok(tool.parameters.properties.needed)
  assert.ok(tool.parameters.properties.optional)
  assert.equal(tool.parameters.properties.needed.description, '必填项')
})
