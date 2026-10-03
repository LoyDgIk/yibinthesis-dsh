// 一个最小但**结构正确**的 React 测试渲染器（无 JSX、无 DOM，只跑函数组件与 hooks）。
//
// 为什么需要它：`lib/client.js` 是浏览器代码，其失效模式全是**静默**的——注册写错只是
// 组件不出现，渲染期抛错会被 React 吞成空面板。实测教训：面板「空的」正是这样漏出去的。
//
// 上一版替身的两个结构性错误（导致测试把失败归咎于产品代码，浪费了两轮排查）：
//   1. `jsx(type, props, key)` 的第三个参数被当成 children —— 真实签名里 children 在 props 中，
//      于是 `h('div', {...}, h(ThesisPanel))` 的子树整个丢掉、effect 从没执行、一个 fetch 都没发。
//   2. 文本提取时**再次调用组件函数** —— 重复执行组件、打乱 hooks 游标，state 因此对不上。
//
// 本文件的正确结构：**组件只在渲染过程中执行一次**，渲染产出被缓存进树节点；
// 文本提取是纯遍历，绝不再执行组件；`setState` 同步重渲染整棵树。
import { createContext, runInContext } from 'node:vm'

/**
 * 建一个渲染器并加载客户端模块。
 * @param opts - 依赖注入。
 * @param opts.source - 客户端模块源码。
 * @param opts.fetchImpl - 假的 fetch `(url) => Promise<body>`。
 * @returns 渲染器 API。
 */
export function createClientHarness({ source, fetchImpl } = {}) {
  // ── hooks 状态：按「组件实例 id + hook 序号」索引，跨渲染保留 ─────────────
  const stateSlots = new Map()
  const refSlots = new Map()
  const effectSlots = new Map()
  const memoSlots = new Map()
  /** 当前正在渲染的组件实例 id。 */
  let currentInstance = null
  let hookIndex = 0
  /** 渲染次数上限：超过即报错，让「无限渲染」变成可见失败而不是把测试挂住。 */
  const MAX_RENDERS = 60
  let renderCount = 0

  /**
   * 建元素。**同时支持**两种调用约定，且都必须保真：
   *
   * 1. `createElement(type, props, ...children)` —— 变长 children（React 的公开 API）。
   * 2. `jsx(type, props, key)` —— `react/jsx-runtime` 的约定，children 在 props 里，
   *    第三个参数是 **key**。
   *
   * ⚠️ 早期版本只实现了第 1 种且只取第一个 child，既漏掉了「多子节点」，
   * 也掩盖了源码误用 `jsx` 却被当 `createElement` 调用时子节点被丢弃的缺陷
   * （实机表现为「面板是空的」）。两种约定都要如实模拟。
   * @param type - 元素类型或组件。
   * @param props - 属性（可含 children）。
   * @param args - 位置参数：createElement 语义下是 children 列表；jsx 语义下是 key。
   * @returns 原始 vnode。
   */
  const createElement = (type, props, ...args) => {
    const { children, ...rest } = props || {}
    if (children !== undefined) return { type, props: rest, children }
    if (args.length === 0) return { type, props: rest, children: undefined }
    if (args.length === 1) return { type, props: rest, children: args[0] }
    return { type, props: rest, children: args }
  }

  /** `react/jsx-runtime` 的 `jsx`／`jsxs`：第三参数是 key，**不是** children。 */
  const jsx = (type, props, key) => {
    const { children, ...rest } = props || {}
    if (key !== undefined) rest.key = key
    return { type, props: rest, children }
  }
  const jsxs = jsx

  const React = {
    /** `React.createElement(type, props, ...children)` —— 变长 children。 */
    createElement,
    /**
     * class 组件的基类。
     *
     * 真实 React 提供它；错误边界**必须**用 class 写（只有 class 能实现
     * `componentDidCatch` / `getDerivedStateFromError`），所以替身少了它，
     * 客户端模块一注册就抛。
     */
    Component: class Component {
      constructor(props) {
        this.props = props || {}
        this.state = {}
      }
    },
    useState(initial) {
      const key = `${currentInstance}#${hookIndex++}`
      if (!stateSlots.has(key)) stateSlots.set(key, typeof initial === 'function' ? initial() : initial)
      const set = (next) => {
        const resolved = typeof next === 'function' ? next(stateSlots.get(key)) : next
        if (Object.is(resolved, stateSlots.get(key))) return
        stateSlots.set(key, resolved)
        scheduleRerender()
      }
      return [stateSlots.get(key), set]
    },
    useRef(initial) {
      const key = `${currentInstance}#${hookIndex++}`
      if (!refSlots.has(key)) refSlots.set(key, { current: initial })
      return refSlots.get(key)
    },
    useEffect(fn, deps) {
      const key = `${currentInstance}#${hookIndex++}`
      const prev = effectSlots.get(key)
      const changed =
        prev === undefined ||
        deps === undefined ||
        prev.deps === undefined ||
        deps.length !== prev.deps.length ||
        deps.some((d, i) => !Object.is(d, prev.deps[i]))
      if (!changed) return
      // 先登记，再执行：副作用里 setState 触发的重渲染不应把同一 effect 再排一次。
      effectSlots.set(key, { deps, cleanup: undefined })
      const cleanup = fn()
      if (typeof cleanup === 'function') effectSlots.get(key).cleanup = cleanup
    },
    useCallback(fn, deps) {
      // 必须**真的 memoize**：否则依赖它的 `useEffect(fn, [callback])` 每轮都判定 deps 变化，
      // 于 effect → setState → rerender → effect … 无限循环（实测把测试跑挂）。
      const key = `${currentInstance}#memo#${hookIndex++}`
      const prev = memoSlots.get(key)
      if (prev && stableDeps(prev.deps, deps)) return prev.value
      memoSlots.set(key, { deps, value: fn })
      return fn
    },
    useMemo(fn, deps) {
      const key = `${currentInstance}#memo#${hookIndex++}`
      const prev = memoSlots.get(key)
      if (prev && stableDeps(prev.deps, deps)) return prev.value
      const value = fn()
      memoSlots.set(key, { deps, value })
      return value
    },
  }

  /** 依赖数组是否稳定（`undefined` 视为每次变化，与真实 React 一致）。 */
  function stableDeps(prev, next) {
    if (!prev || !next) return false
    if (prev.length !== next.length) return false
    return prev.every((dep, index) => Object.is(dep, next[index]))
  }

  // ── 收集注册与词典 ─────────────────────────────────────────────────────
  const registrations = []
  const localeRegistrations = []
  const fetchCalls = []

  const slots = {
    inject(_key, callback) {
      // 契约：等该 slot 被声明后执行 callback。测试里把「宿主已声明」视为成立。
      const result = callback()
      return typeof result === 'function' ? result : () => {}
    },
    register(options, Component) {
      registrations.push({ options, Component })
      return () => {}
    },
  }
  const locale = {
    register(ns, dicts) {
      localeRegistrations.push({ ns, dicts })
      return () => {}
    },
    bind(ns) {
      const found = localeRegistrations.find((entry) => entry.ns === ns)
      const dict = found?.dicts?.zh || {}
      return (key) => dict[key] ?? key
    },
    getLocale: () => ({ id: 'zh' }),
  }
  const effects = []
  /** 会话右侧栏标签声明（`sidebarRightTabs.register`）。 */
  const rightTabs = []
  const sidebarRightTabs = {
    register(definition) {
      rightTabs.push(definition)
      return () => {}
    },
  }
  const ctx = {
    slots,
    locale,
    sidebarRightTabs,
    effect(fn) {
      const dispose = fn()
      effects.push(dispose)
      return typeof dispose === 'function' ? dispose : () => {}
    },
    get(name) {
      if (name === 'slots') return slots
      if (name === 'locale') return locale
      if (name === 'sidebarRightTabs') return sidebarRightTabs
      return undefined
    },
    /**
     * 延迟注入（Cordis `ctx.inject`）：服务就绪后执行回调。
     * 测试里把「服务已就绪」视为成立，且把 `scope` 做成可用的子上下文——
     * 与真实 `dsh-context` 的用法（`injected.slots` / `injected.sidebarRightTabs`）一致。
     */
    inject(services, callback) {
      const names = Array.isArray(services) ? services : [services]
      const scope = { slots, locale, sidebarRightTabs }
      for (const name of names) {
        if (scope[name] === undefined) return () => {}
      }
      const dispose = callback(scope)
      return typeof dispose === 'function' ? dispose : () => {}
    },
  }

  // ── 伪 window / document / fetch ───────────────────────────────────────
  const styleEls = []
  const documentStub = {
    getElementById: (id) => styleEls.find((el) => el.id === id) || null,
    createElement: () => ({ id: '', textContent: '' }),
    head: {
      appendChild(el) {
        styleEls.push(el)
      },
    },
  }
  /**
   * 建一个 Web Storage 替身（`localStorage` / `sessionStorage` 语义相同，仅生命周期不同）。
   *
   * 为什么必须有：面板用它们**按会话**保存项目列表。缺了桩时 `window.localStorage?.setItem`
   * 是 `undefined`，写入被静默跳过——测试看起来「通过」而持久化根本没发生
   * （实测两次踩过：先是 `sessionStorage` 缺失漏掉「切回标签列表丢空」，
   *  后是用错存储 API 漏掉「重启 DSH 后路径丢失」）。
   * @returns 存储替身，附 `__dump()` 供测试检视。
   */
  const makeStorageStub = () => {
    const store = new Map()
    return {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => {
        store.set(key, String(value))
      },
      removeItem: (key) => {
        store.delete(key)
      },
      clear: () => store.clear(),
      key: (index) => [...store.keys()][index] ?? null,
      get length() {
        return store.size
      },
      /** 供测试直接检视（非 Web 标准，仅测试用）。 */
      __dump: () => Object.fromEntries(store),
    }
  }

  const sessionStorageStub = makeStorageStub()
  /**
   * `window.localStorage` 替身 —— **跨应用重启**的那一层。
   *
   * 测试「重启后还在」的方式：清掉 `sessionStorage`（模拟新会话/新页面）
   * 而**保留** `localStorage`（模拟磁盘上的持久数据）。
   */
  const localStorageStub = makeStorageStub()

  const windowStub = {
    __ModuleLoader__: { load: (spec) => { windowStub.__spec = spec } },
    sessionStorage: sessionStorageStub,
    localStorage: localStorageStub,
  }
  const fakeFetch = async (url) => {
    fetchCalls.push(url)
    const impl = fetchImpl || (() => ({ ok: true, status: 200, json: async () => ({ ok: true }) }))
    const body = await impl(url)
    if (body && body.__throw) throw new Error(body.__throw)
    // 真实的 `Response` **同时**提供 `text()` 与 `json()`；替身必须都给，
    // 否则「非 JSON 响应」这条路径永远测不到（客户端会先 text() 再自己解析）。
    // 用 `__raw` / `__status` 表达「非 JSON 的应答」，例如宿主未注册路由时的纯文本 404。
    const text = body && body.__raw !== undefined ? String(body.__raw) : JSON.stringify(body ?? null)
    const status = body && typeof body.__status === 'number' ? body.__status : body?.ok === false ? 400 : 200
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => text,
      json: async () => JSON.parse(text),
    }
  }
  const requireStub = (spec) => {
    if (spec === 'react') return React
    if (spec === 'react/jsx-runtime') return { jsx, jsxs, Fragment: 'Fragment' }
    throw new Error(`测试替身未实现 require("${spec}")`)
  }

  // 用 vm 而不是 new Function：后者在 Node 里不解析 `window`/`document` 全局。
  const sandbox = {
    window: windowStub,
    document: documentStub,
    fetch: fakeFetch,
    require: requireStub,
    module: { exports: {} },
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    queueMicrotask,
    setImmediate,
    Promise,
    Object,
    Array,
    JSON,
    Math,
    Date,
    String,
    Number,
    Boolean,
    Error,
    TypeError,
    RangeError,
    RegExp,
    Symbol,
    Map,
    Set,
    WeakMap,
    URL,
    URLSearchParams,
    encodeURIComponent,
    decodeURIComponent,
  }
  sandbox.globalThis = sandbox
  sandbox.exports = sandbox.module.exports
  createContext(sandbox)
  runInContext(source, sandbox, { filename: 'client.js' })

  const spec = windowStub.__spec
  if (!spec) throw new Error('客户端模块未调用 window.__ModuleLoader__.load()')
  const pluginExports = spec.factory(requireStub)

  // ── 渲染核心 ───────────────────────────────────────────────────────────
  /** 当前挂载的根：`{ Component, props, tree, instanceId }`。 */
  let root = null
  let rerenderScheduled = false

  /**
   * 把一棵「原始 vnode 树」渲染成「已求值树」（函数组件已执行、结果缓存）。
   * @param node - 原始节点（jsx 的产物）。
   * @param path - 稳定路径，用作组件实例 id，保证 hooks 跨渲染对齐。
   * @returns 已求值节点：`{ kind:'host'|'text'|'fragment', ... }`。
   */
  const evaluate = (node, path) => {
    if (node === null || node === undefined || typeof node === 'boolean') return { kind: 'empty' }
    if (typeof node === 'string' || typeof node === 'number') return { kind: 'text', text: String(node) }
    if (Array.isArray(node)) {
      return { kind: 'fragment', children: node.map((child, index) => evaluate(child, `${path}.${index}`)) }
    }
    if (typeof node.type === 'function') {
      const instanceId = `${node.type.name || 'anon'}@${path}`
      const prev = currentInstance
      const prevHook = hookIndex
      currentInstance = instanceId
      hookIndex = 0
      try {
        // class 组件（错误边界必须用它写）：`new` 之后调 `render()`，
        // 直接当函数调用会抛 "Class constructor cannot be invoked without 'new'"。
        const isClass = node.type.prototype instanceof React.Component
        const produced = isClass
          ? new node.type({ ...(node.props || {}), children: node.children }).render()
          : node.type({ ...(node.props || {}), children: node.children })
        const child = evaluate(produced, `${path}>`)
        return { kind: 'component', name: node.type.name || 'anon', child }
      } catch (error) {
        // 组件抛错在真实 React 里会被 ErrorBoundary 吞成空——这里如实记录，
        // 让测试能报出「为什么是空的」。
        return { kind: 'component', name: node.type.name || 'anon', child: { kind: 'threw', message: String(error?.message ?? error) } }
      } finally {
        currentInstance = prev
        hookIndex = prevHook
      }
    }
    // 宿主元素（'div' 等字符串类型）
    const kids = node.children
    const list = Array.isArray(kids) ? kids : kids === undefined ? [] : [kids]
    return {
      kind: 'host',
      type: node.type,
      props: node.props || {},
      children: list.map((child, index) => evaluate(child, `${path}.${index}`)),
    }
  }

  /**
   * 把已求值树拍成纯文本。**纯遍历，绝不再执行组件**（上一版在这里重复执行组件，
   * 打乱 hooks 游标导致 state 对不上）。
   * @param node - 已求值节点。
   * @returns 文本。
   */
  const textOf = (node) => {
    if (!node) return ''
    switch (node.kind) {
      case 'text':
        return node.text
      case 'fragment':
        return node.children.map(textOf).join('')
      case 'component':
        return textOf(node.child)
      case 'host': {
        const title = typeof node.props.title === 'string' ? `${node.props.title} ` : ''
        return title + node.children.map(textOf).join('')
      }
      case 'threw':
        return `<<组件抛错: ${node.message}>>`
      case 'empty':
      default:
        return ''
    }
  }

  /** 挂载一个组件为根，并立即渲染一次。 */
  const mount = (Component, props = {}) => {
    root = { Component, props, tree: null }
    renderNow()
    return root.tree
  }

  /**
   * 卸载当前根。
   *
   * 模拟**宿主切换右侧栏标签时卸载面板组件**这一真实行为——组件内 state 随之清空。
   * 模块级状态（本包用于跨挂载缓存）不受影响，这正是缓存测试要验证的。
   */
  const unmount = () => {
    root = null
    stateSlots.clear()
    refSlots.clear()
    effectSlots.clear()
    memoSlots.clear()
  }

  /** 同步重渲染根。 */
  const renderNow = () => {
    if (!root) return null
    renderCount += 1
    if (renderCount > MAX_RENDERS) {
      throw new Error(
        `渲染次数超过上限 ${MAX_RENDERS}：几乎一定是 effect → setState → 重渲染的无限循环。` +
          '常见原因是某个 useCallback/useMemo 的依赖不稳定，或 effect 里无条件 setState。',
      )
    }
    root.tree = evaluate(jsx(root.Component, root.props), 'root')
    return root.tree
  }

  /** `setState` 触发的重渲染（同步，便于断言；真实 React 是异步批处理）。 */
  const scheduleRerender = () => {
    if (rerenderScheduled) return
    rerenderScheduled = true
    // 不递归：本轮渲染结束后再重渲染，避免 setState-in-render 造成栈溢出。
    queueMicrotask(() => {
      rerenderScheduled = false
      renderNow()
    })
  }

  /** 让所有微任务与 effect 落地。 */
  const flush = async (rounds = 8) => {
    for (let i = 0; i < rounds; i += 1) await new Promise((resolve) => setImmediate(resolve))
  }

  return {
    spec,
    exports: pluginExports,
    ctx,
    registrations,
    localeRegistrations,
    fetchCalls,
    styleEls,
    /** 会话右侧栏标签声明列表（`sidebarRightTabs.register` 的入参）。 */
    rightTabs,
    mount,
    unmount,
    renderNow,
    flush,
    /** `window.sessionStorage` 替身（检视持久化是否真的发生）。 */
    sessionStorage: sessionStorageStub,
    /** `window.localStorage` 替身（跨应用重启的那一层）。 */
    localStorage: localStorageStub,
    /**
     * 深度优先收集已求值树里的所有宿主节点（含 props）。
     *
     * 供测试直接驱动交互（点按钮、改输入），避免每处测试都手写一遍树遍历。
     * @param node - 起始节点（默认根）。
     * @returns 宿主节点数组。
     */
    collectHosts(node) {
      const found = []
      const walk = (current) => {
        if (!current) return
        if (current.kind === 'host') {
          found.push(current)
          current.children.forEach(walk)
          return
        }
        if (current.kind === 'component') return walk(current.child)
        if (current.kind === 'fragment') return current.children.forEach(walk)
      }
      walk(node === undefined ? root?.tree : node)
      return found
    },
    /**
     * 按标签名找第一个宿主节点。
     * @param type - 标签名（如 `'input'`）。
     * @returns 节点，或 `undefined`。
     */
    findByType(type) {
      return this.collectHosts().find((node) => node.type === type)
    },
    /**
     * 按文本找第一个按钮。
     * @param text - 按钮文本片段。
     * @returns 节点，或 `undefined`。
     */
    findButtonByText(text) {
      return this.collectHosts().find(
        (node) => node.type === 'button' && JSON.stringify(node.children).includes(text),
      )
    },
    /** 当前根的已求值树。 */
    get tree() {
      return root?.tree
    },
    /** 当前根的纯文本（供断言）。 */
    get text() {
      return textOf(root?.tree)
    },
    textOf,
    /** 按注册名取组件。 */
    componentFor(slotName) {
      const found = registrations.find((reg) => reg.options.name === slotName)
      if (!found) throw new Error(`未注册槽位 ${slotName}`)
      return found.Component
    },
    /** 按注册名取注册项。 */
    registrationFor(slotName) {
      return registrations.find((reg) => reg.options.name === slotName)
    },
  }
}
