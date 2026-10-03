// 等价性验证：本包自带的 `defineTool`（`lib/tool-builder.js`）与宿主**真实**的
// `@deepseek-ai/dsh-tools.defineTool` 在数据形态上必须逐字段一致。
//
// 这是「自带实现」这一决策的**唯一正当性来源**。没有这层验证，
// 自带的 schema 编译器就是在猜宿主的 DSL；有了它，任何上游形态变化都会在 CI 里炸出来。
//
// 依赖：`@deepseek-ai/dsh-tools` 是本包的 **devDependency**（不是运行期依赖——
// 运行期刻意零宿主依赖，原因见 `lib/tool-builder.js` 文件头）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { defineTool as localDefineTool } from '../lib/tool-builder.js'

/** 载入宿主真实实现；本机装不到时跳过（而不是假装通过）。 */
async function loadReal() {
  try {
    const mod = await import('@deepseek-ai/dsh-tools')
    return typeof mod.defineTool === 'function' ? mod.defineTool : null
  } catch {
    return null
  }
}

/** 覆盖 DSL 各种形态的参数表（同时用于参数根与输出根的比对）。 */
const PARAMETER_CASES = {
  '全可选（不得出现 required 键）': {
    a: { type: 'string' },
    b: { type: 'number' },
  },
  '混合必填/可选': {
    needed: { type: 'string', required: true, description: '必填项' },
    optional: { type: 'number', description: '可选项' },
  },
  '带 enum 与 const': {
    choice: { type: 'string', enum: ['a', 'b'], description: '枚举' },
    pinned: { type: 'string', const: 'x' },
  },
  '各标量类型': {
    s: { type: 'string' },
    n: { type: 'number' },
    i: { type: 'integer' },
    bo: { type: 'boolean' },
    nu: { type: 'null' },
  },
  '数组（含 items 与省略 items）': {
    withItems: { type: 'array', items: { type: 'string' } },
    withoutItems: { type: 'array' },
    nestedArray: { type: 'array', items: { type: 'array', items: { type: 'number' } } },
  },
  '显式开放性的嵌套对象': {
    closed: { type: 'object', additionalProperties: false, properties: { k: { type: 'string' } } },
    open: { type: 'object', additionalProperties: true },
  },
  'json 节点（仅注解）': {
    any: { type: 'json' },
  },
  '注解关键字透传': {
    annotated: { type: 'string', description: 'd', title: 't', default: 'v', examples: 'e' },
  },
  'oneOf 联合': {
    union: { oneOf: [{ type: 'string' }, { type: 'number' }] },
  },
  '空参数表': {},
}

/** 值 schema 用例（用于 output.schema）。 */
const VALUE_CASES = {
  'json（本包所有工具都用它）': { type: 'json' },
  string: { type: 'string' },
  '带约束的字符串': { type: 'string', enum: ['a', 'b'], description: 'x' },
  '显式对象': { type: 'object', additionalProperties: false, properties: { a: { type: 'string' } } },
  '开放对象': { type: 'object', additionalProperties: true },
  '数组': { type: 'array', items: { type: 'boolean' } },
  '整数': { type: 'integer' },
  'oneOf': { oneOf: [{ type: 'string' }, { type: 'object', additionalProperties: false }] },
}

/** 建一个最小可用的工具定义（只替换被测字段）。 */
function buildOptions(overrides = {}) {
  return {
    name: 'eq_probe',
    description: '等价比对用的工具',
    parameters: {},
    output: { schema: { type: 'json' }, render: () => [{ type: 'text', text: 'x' }] },
    execute: async () => ({}),
    ...overrides,
  }
}

test('前置事实：宿主真实 dsh-tools 可作为 devDependency 载入', async (t) => {
  const real = await loadReal()
  if (!real) {
    t.skip('本机未安装 @deepseek-ai/dsh-tools（devDependency）——请执行 pnpm install')
    return
  }
  assert.equal(typeof real, 'function')
})

test('等价性：parameters 编译结果与真实现**递归全等**', async (t) => {
  const realDefineTool = await loadReal()
  if (!realDefineTool) {
    t.skip('本机未安装真实 dsh-tools')
    return
  }
  for (const [label, parameters] of Object.entries(PARAMETER_CASES)) {
    const real = realDefineTool(buildOptions({ parameters }))
    const local = localDefineTool(buildOptions({ parameters }))
    assert.deepEqual(local.parameters, real.parameters, `parameters 不一致：${label}`)
  }
})

test('等价性：output.schema 编译结果与真实现**全等**', async (t) => {
  const realDefineTool = await loadReal()
  if (!realDefineTool) {
    t.skip('本机未安装真实 dsh-tools')
    return
  }
  for (const [label, schema] of Object.entries(VALUE_CASES)) {
    const real = realDefineTool(buildOptions({ output: { schema, render: () => [{ type: 'text', text: 'x' }] } }))
    const local = localDefineTool(buildOptions({ output: { schema, render: () => [{ type: 'text', text: 'x' }] } }))
    assert.deepEqual(local.output.schema, real.output.schema, `output.schema 不一致：${label}`)
  }
})

test('等价性：`required` 键的出现/省略规则一致（全可选时两个实现都不写该键）', async (t) => {
  const realDefineTool = await loadReal()
  if (!realDefineTool) {
    t.skip('本机未安装真实 dsh-tools')
    return
  }
  const allOptional = { a: { type: 'string' }, b: { type: 'number' } }
  const real = realDefineTool(buildOptions({ parameters: allOptional }))
  const local = localDefineTool(buildOptions({ parameters: allOptional }))
  assert.equal('required' in real.parameters, false, '真实现：全可选时不写 required')
  assert.equal('required' in local.parameters, false, '本实现也必须省略 required')
  assert.deepEqual(local.parameters, real.parameters)

  const withRequired = { a: { type: 'string', required: true } }
  const real2 = realDefineTool(buildOptions({ parameters: withRequired }))
  const local2 = localDefineTool(buildOptions({ parameters: withRequired }))
  assert.deepEqual(real2.parameters.required, ['a'])
  assert.deepEqual(local2.parameters.required, ['a'])
})

test('等价性：工具对象顶层键集合一致', async (t) => {
  const realDefineTool = await loadReal()
  if (!realDefineTool) {
    t.skip('本机未安装真实 dsh-tools')
    return
  }
  const real = realDefineTool(buildOptions())
  const local = localDefineTool(buildOptions())
  assert.deepEqual(Object.keys(local).sort(), Object.keys(real).sort())
  // 可选回调按位出现：给了才出现。
  const opts = () => buildOptions({ isConcurrencySafe: () => true, timeoutMs: 5000 })
  assert.deepEqual(Object.keys(localDefineTool(opts())).sort(), Object.keys(realDefineTool(opts())).sort())
})

test('★ 契约一致性：executionMode 在真实现里被静默忽略，在本实现里**响亮失败**', async (t) => {
  const realDefineTool = await loadReal()
  if (!realDefineTool) {
    t.skip('本机未安装真实 dsh-tools')
    return
  }
  // 这是本文件最有价值的一条：它把「静默失效」变成可执行的文档。
  // 真实现：传了 executionMode 不报错，但该键**完全不生效**（不进入工具对象）。
  const real = realDefineTool(buildOptions({ executionMode: 'parallel' }))
  assert.equal(real.executionMode, undefined, '真实现确实不读取 executionMode')
  // 本实现：显式拒绝，避免有人写出「看起来配了并行、实际没配」的工具。
  assert.throws(() => localDefineTool(buildOptions({ executionMode: 'parallel' })), /executionMode|不认识的选项/)
})

test('本实现：定义期校验非法输入即抛（响亮失败）', () => {
  assert.throws(() => localDefineTool(buildOptions({ name: '' })), /name/)
  assert.throws(() => localDefineTool(buildOptions({ description: '' })), /description/)
  assert.throws(() => localDefineTool(buildOptions({ execute: undefined })), /execute/)
  assert.throws(() => localDefineTool(buildOptions({ output: { schema: { type: 'json' } } })), /render/)
  assert.throws(() => localDefineTool(buildOptions({ timeoutMs: 0 })), /timeoutMs/)
  assert.throws(() => localDefineTool(buildOptions({ timeoutMs: Number.NaN })), /timeoutMs/)
  assert.throws(() => localDefineTool(buildOptions({ deferLoading: false })), /deferLoading/)
  // object 值 schema 必须显式声明开放性（否则会拿到 JSON Schema 的隐式默认）。
  assert.throws(
    () => localDefineTool(buildOptions({ output: { schema: { type: 'object' }, render: () => [] } })),
    /additionalProperties/,
  )
  // oneOf 至少两个分支。
  assert.throws(
    () => localDefineTool(buildOptions({ output: { schema: { oneOf: [{ type: 'string' }] }, render: () => [] } })),
    /oneOf/,
  )
  // 未知 type。
  assert.throws(
    () => localDefineTool(buildOptions({ output: { schema: { type: 'nope' }, render: () => [] } })),
    /不支持/,
  )
  // required 只接受字面量 true。
  assert.throws(
    () => localDefineTool(buildOptions({ parameters: { a: { type: 'string', required: false } } })),
    /required/,
  )
})

test('本实现：execute 被包装为异步，抛错即该次调用失败', async () => {
  const tool = localDefineTool(
    buildOptions({
      execute: () => {
        throw new Error('boom')
      },
    }),
  )
  await assert.rejects(() => tool.execute({}, {}), /boom/)
  // 返回值原样穿过（注册表负责按 output.schema 校验）。
  const ok = localDefineTool(buildOptions({ execute: async () => ({ ok: true }) }))
  assert.deepEqual(await ok.execute({}, {}), { ok: true })
})
