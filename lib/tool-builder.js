// 零依赖的工具定义构造器：把作者的 schema DSL 编译成宿主注册表要求的原始 JSON Schema。
//
// 为什么不用宿主的 `defineTool`（这是本次联调最重要的一个决策，有实测依据）
// ---------------------------------------------------------------------------
// 契约本身要求 `ctx.tools.register(defineTool(options))`。但实测发现：
//
// 1. 宿主把 `@deepseek-ai/*` 以 **junction** 形式放在
//    `%USERPROFILE%\.dsh\profiles\node_modules\@deepseek-ai\` 下，而本机这 **225 个 junction
//    **全部断链**（指向已不存在的 `<DSH 安装目录>\…`，真实目录是 `…\dsh\…`）
//    ——**零个可达**。所以不能指望「宿主会替我解析宿主包」。
// 2. 改成把 `@deepseek-ai/dsh-tools` 声明为**本包依赖**也不够：profile 的
//    `pnpm-workspace.yaml` 设了 `nodeLinker: hoisted`，pnpm 会把它**提升**到
//    `<profile>/node_modules/@deepseek-ai/dsh-tools`；该副本要 import 自己的 peer
//    `@deepseek-ai/cordis`，而那里的 `cordis` 正是断链 junction →
//    `ERR_MODULE_NOT_FOUND: Cannot find package '@deepseek-ai/cordis'`。
//    **实测**：在已安装副本上真跑 apply 时，工具注册数 = 0。
//
// 结论：任何「运行时依赖宿主包」的方案在这套布局下都不可靠。本模块因此**自带**
// 与官方 `defineTool` 等价的编译逻辑。等价性由 `tests/local-toolbuilder.test.mjs`
// 用**宿主真实的** `defineTool` 逐字段比对（真值表 + 递归结构），不是靠人工核对。
//
// 为什么这不违反契约
// ------------------
// 注册表消费的是 `ToolDefinition` 的**数据形态**（`{name, description, parameters, output}`），
// 而不是某个构造函数。`defineTool` 本身也只是「编译 schema + 组装对象」的纯函数
// （官方实现从显式白名单构造，见 `research/contracts.md` §A.7）。本模块复现同一数据形态。
//
// ## 已实测的目标形态（`@deepseek-ai/dsh-tools@0.2.0-rc.2` 的真实输出）
//
// - 参数根固定 `{ type: 'object', properties: {...}, required: [...] }`；
//   `required` **只在确有必要参数时出现**（全可选则省略该键）。
// - 值节点：`description` 原样透传；`enum` 透传；
//   `type: 'json'` → 产出 `{}`（仅注解的 schema）；`type: 'object'` 递归编译 `properties`。
// - `output.schema` 与参数用同一套值 schema 编译。
// - 工具对象顶层键：`name, description, parameters, output, execute`（+ 可选回调）。

/**
 * 把「值 schema 规格」编译成原始 JSON Schema 节点。
 *
 * 支持的规格形态与官方 `ValueSchemaSpec` 一致：
 * `string` / `number` / `integer` / `boolean` / `null` / `array` / `object` / `json` / `oneOf`。
 * @param spec - 作者写的值 schema。
 * @returns 原始 JSON Schema 节点。
 * @throws {TypeError} 规格非法时（**在定义期响亮失败**，不静默产出坏 schema）。
 */
export function valueSpecToJsonSchema(spec) {
  if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) {
    throw new TypeError(`值 schema 必须是对象，收到 ${Array.isArray(spec) ? 'array' : typeof spec}`)
  }
  const node = {}

  if (Array.isArray(spec.oneOf)) {
    if (spec.oneOf.length < 2) throw new TypeError('oneOf 至少需要两个分支')
    node.oneOf = spec.oneOf.map((branch) => valueSpecToJsonSchema(branch))
  } else {
    const type = spec.type
    if (typeof type !== 'string') {
      // `json` 之外必须有 type；`json` 是官方 DSL 里唯一的无类型节点。
      throw new TypeError(`值 schema 缺少 type（可用：string/number/integer/boolean/null/array/object/json/oneOf）`)
    }
    switch (type) {
      case 'json':
        // 官方把作者侧的 `json` 节点编译成「仅注解」的空 schema。
        break
      case 'string':
      case 'number':
      case 'integer':
      case 'boolean':
      case 'null':
        node.type = type
        break
      case 'array':
        node.type = 'array'
        if (spec.items !== undefined) node.items = valueSpecToJsonSchema(spec.items)
        break
      case 'object': {
        node.type = 'object'
        // 官方强制要求嵌套/输出对象**显式声明开放性**，避免拿到 JSON Schema 的隐式默认。
        if (typeof spec.additionalProperties !== 'boolean') {
          throw new TypeError("object 值 schema 必须显式声明 additionalProperties（true 或 false）")
        }
        node.additionalProperties = spec.additionalProperties
        // ★ 关键：`properties` 是「属性名 → 值 schema」的**映射**，只编译每个值本身，
        //   绝不能把整个映射再当成一个值 schema 去套 `{type:'object'}`——
        //   那会产出 `properties: { type: 'object', properties: {...} }` 这种错形态。
        //   （这条由 tests/local-toolbuilder.test.mjs 的等价比对抓出来。）
        if (spec.properties !== undefined) {
          node.properties = compilePropertyMap(spec.properties)
        }
        break
      }
      default:
        throw new TypeError(`不支持的值 schema type：${String(type)}`)
    }
  }

  // 注解关键字原样透传（description / title / default / examples）。
  if (spec.description !== undefined) node.description = spec.description
  if (spec.title !== undefined) node.title = spec.title
  if (spec.default !== undefined) node.default = spec.default
  if (spec.examples !== undefined) node.examples = spec.examples
  // `const` 与 `enum` 是类型正确的字面量约束，直接透传。
  if (spec.const !== undefined) node.const = spec.const
  if (Array.isArray(spec.enum)) node.enum = spec.enum

  return node
}

/**
 * 编译一张「属性名 → 值 schema」映射（**不**附加 object 包装）。
 *
 * 与 {@link parametersSpecToJsonSchema} 的区别：后者产出**完整**的对象根
 * （含 `{type:'object'}`）；本函数只产出裸的属性映射，用于嵌套对象的 `properties`。
 * 混用两者会产出双层 `type:'object'` 的错形态。
 * @param spec - 属性映射。
 * @returns 属性名 → 编译后的节点。
 * @throws {TypeError} 规格非法时。
 */
export function compilePropertyMap(spec) {
  if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) {
    throw new TypeError(`properties 必须是对象，收到 ${Array.isArray(spec) ? 'array' : typeof spec}`)
  }
  const out = {}
  for (const [key, child] of Object.entries(spec)) {
    out[key] = valueSpecToJsonSchema(child)
  }
  return out
}

/**
 * 把参数规格编译成隐式开放对象的原始 JSON Schema。
 *
 * 已实测的语义：`required` **只在确实存在必填参数时才出现**——
 * 全可选时官方输出里没有该键，故这里同样省略（多写一个空数组会与官方形态不一致）。
 * @param spec - 逐参数的规格表。
 * @returns `{ type: 'object', properties, required? }`。
 * @throws {TypeError} 规格非法时。
 */
export function parametersSpecToJsonSchema(spec) {
  if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) {
    throw new TypeError(`parameters 必须是对象，收到 ${Array.isArray(spec) ? 'array' : typeof spec}`)
  }
  const properties = {}
  const required = []
  for (const [key, raw] of Object.entries(spec)) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new TypeError(`parameters.${key} 必须是对象`)
    }
    const { required: isRequired, ...rest } = raw
    if (isRequired !== undefined && isRequired !== true) {
      throw new TypeError(`parameters.${key}.required 只允许字面量 true（收到 ${JSON.stringify(isRequired)}）`)
    }
    properties[key] = valueSpecToJsonSchema(rest)
    if (isRequired === true) required.push(key)
  }
  const root = { type: 'object', properties }
  if (required.length > 0) root.required = required
  return root
}

/** 官方 `defineTool` 会读取的顶层键（其余键**既不读取也不报错**，故必须显式拒绝以免误导作者）。 */
const KNOWN_OPTION_KEYS = new Set([
  'name',
  'description',
  'parameters',
  'output',
  'deferLoading',
  'timeoutMs',
  'isConcurrencySafe',
  'execute',
  'projectContent',
  'finalizeContent',
  'presentCall',
  'presentResult',
])

/**
 * 定义一个工具（与官方 `defineTool` 等价的数据形态，零宿主依赖）。
 *
 * 与官方一致的行为：
 * - **定义期校验**，非法即抛（响亮失败，不留到运行期）；
 * - 未知顶层键**不上抛**给注册表（官方对未知键静默忽略；这里显式**拒绝**，
 *   因为本包的主要静默失效风险正是「写了个不生效的键」——见 `executionMode` 的教训）；
 * - `timeoutMs` 必须是正有限数；
 * - `deferLoading` 只接受字面量 `true`。
 * @param options - 工具定义。
 * @returns 可交给 `ctx.tools.register()` 的 `ToolDefinition`。
 * @throws {TypeError} 定义非法时。
 */
export function defineTool(options) {
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('defineTool 必须收到对象')
  }
  const unknown = Object.keys(options).filter((key) => !KNOWN_OPTION_KEYS.has(key))
  if (unknown.length > 0) {
    throw new TypeError(
      `defineTool(${options.name ?? '?'})：不认识的选项 ${unknown.map((k) => `"${k}"`).join(', ')}。` +
        `官方实现会**静默忽略**未知键（例如 executionMode 就是无效的，并发安全请用 isConcurrencySafe），` +
        `本包选择在此响亮失败以免留下静默失效的配置。`,
    )
  }
  if (typeof options.name !== 'string' || !options.name) throw new TypeError('defineTool 需要非空字符串 name')
  if (typeof options.description !== 'string' || !options.description) {
    throw new TypeError(`defineTool(${options.name})：需要非空字符串 description`)
  }
  if (typeof options.execute !== 'function') throw new TypeError(`defineTool(${options.name})：execute 必须是函数`)
  if (options.output === null || typeof options.output !== 'object') {
    throw new TypeError(`defineTool(${options.name})：需要 output 对象`)
  }
  if (typeof options.output.render !== 'function') {
    throw new TypeError(`defineTool(${options.name})：output.render 必须是函数`)
  }
  if (options.output.schema === undefined) {
    throw new TypeError(`defineTool(${options.name})：output.schema 必须声明`)
  }
  if (options.timeoutMs !== undefined) {
    if (typeof options.timeoutMs !== 'number' || !Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
      throw new TypeError(`defineTool(${options.name})：timeoutMs 必须是正有限数`)
    }
  }
  if (options.deferLoading !== undefined && options.deferLoading !== true) {
    throw new TypeError(`defineTool(${options.name})：deferLoading 只接受字面量 true`)
  }

  const output = { schema: valueSpecToJsonSchema(options.output.schema), render: options.output.render }
  if (typeof options.output.presentationMeta === 'function') {
    output.presentationMeta = options.output.presentationMeta
  }

  const tool = {
    name: options.name,
    description: options.description,
    parameters: parametersSpecToJsonSchema(options.parameters ?? {}),
    output,
    async execute(args, exec) {
      return options.execute(args, exec)
    },
  }
  if (options.deferLoading === true) tool.deferLoading = true
  if (options.timeoutMs !== undefined) tool.timeoutMs = options.timeoutMs
  if (typeof options.isConcurrencySafe === 'function') tool.isConcurrencySafe = options.isConcurrencySafe
  if (typeof options.projectContent === 'function') tool.projectContent = options.projectContent
  if (typeof options.finalizeContent === 'function') tool.finalizeContent = options.finalizeContent
  if (typeof options.presentCall === 'function') tool.presentCall = options.presentCall
  if (typeof options.presentResult === 'function') tool.presentResult = options.presentResult
  return tool
}
