/**
 * yibinthesis-dsh —— 浏览器半（Web GUI 只读面板）。
 *
 * ⚠️ 本文件**不是**普通 ESM：它必须是 `window.__ModuleLoader__.load({ id, factory })`
 * 包裹格式。这是实测的硬契约——官方 `@deepseek-ai/dsh-client-ui-jobs`、以及第三方
 * `dsh-univer-office` / `dsh-free-search` / `@linxin666/dsh-client-ui-skill-explorer` /
 * `dsh-status-rotator` 共 5 个包全部是这个形态（见 `research/contracts.md` §E.1）。
 * 用普通 ESM 写会导致客户端模块加载不到，且**没有报错**——静默失效。
 *
 * 两个 inject 层次同名不同义，别混用（§D.3）：
 *   · `package.json#dsh.client.inject` 写的是**包名**（如 "@deepseek-ai/dsh-client-ui-renderer"）；
 *   · 本文件导出的 `inject` 写的是**服务名**（如 "slots"）。
 *
 * 本面板**全程只读**：回答「我的论文现在什么状态、上次构建的东西在哪、这台机器能不能出 PDF」，
 * 而**不**提供「点一下构建」——通过 Web 路由触发写盘会把权限面开得过大
 * （任何能访问该端口的页面都能让宿主写盘）。构建与脚手架由助手经
 * `yibinthesis_build` / `yibinthesis_new` 发起，走正常的工具审批与取消链路。
 *
 * 面板位置：keyed 槽位 `plugins.row.config`，key = `<包名>#<cordis.patch.yml 里的行 id>`
 * = `yibinthesis-dsh#yibinthesis`（侧栏 → 插件 → 已安装 → yibinthesis-dsh → 配置）。
 */
window.__ModuleLoader__.load({
  id: 'yibinthesis-dsh',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    // 只 require react 与 dsh.client.inject 里声明过的包（§E.1 的保守做法）。
    const React = require('react')
    /**
     * 建元素用 **`React.createElement`**，**不要**用 `react/jsx-runtime` 的 `jsx`。
     *
     * ⚠️ 这是**实装过的缺陷**，不是风格偏好：`react/jsx-runtime` 导出的是
     * `jsx(type, props, key)` —— 只接受三个参数、**children 必须放进 props**，
     * 第三个位置参数是 **key**。本文件历史上写的是
     * `const h = jsxRuntime.jsx` 然后 `h('div', props, child1, child2, …)`，
     * 于是第 2 个起的子节点被**静默丢弃**，面板只剩骨架——实机表现就是「面板是空的」。
     *
     * `React.createElement(type, props, ...children)` 接受**变长** children，
     * 是 React 的稳定公开 API，不依赖自动 runtime 的调用约定。
     */
    const h = React.createElement
    const { useState, useEffect, useCallback, useRef } = React

    /**
     * 客户端服务名（**不是**包名）。
     *
     * `slots`：槽位注册。
     * `locale`：词典注册（`ctx.locale.register(ns, {zh, en})`）。
     */
    const inject = ['slots', 'locale']

    /** 桥的路径前缀，必须与 host 半 `lib/bridge.js` 的 BRIDGE_PREFIX 一致。 */
    const BRIDGE = '/api/yibinthesis'

    /** 词典命名空间。 */
    const NS = 'yibinthesis'

    // ── 样式：只用已证实存在的 `--dsw-*` 令牌（§E.6）──────────────────────────
    // 语义层用 --dsw-alias-*；圆角/字体用对应阶梯。不硬编码颜色，
    // 浅色/深色主题都由宿主主题接管。
    //
    // 版式按**窄列**设计：右侧栏只有两三百像素宽，横向铺开的行会立刻挤成一团。
    // 因此：分区用卡片、键值行「左标签 + 右值」、长路径单行截断（`title` 里留全文）、
    // 数值/文件名用等宽字体便于对齐。所有长度用 `em` 相对尺寸，跟宿主字号缩放。
    const CSS = `
.ybt-root { display: flex; flex-direction: column; gap: 14px; padding: 12px 14px 16px; font-size: 13px; line-height: 1.5; color: var(--dsw-alias-label-primary); height: 100%; box-sizing: border-box; overflow-y: auto; overflow-x: hidden; }
/* 交付物卡片可点击（在右侧栏预览 / 系统打开），因此给足指针与悬停反馈。 */
.ybt-file-click { cursor: pointer; }
.ybt-file-click:hover { background: var(--dsw-alias-interactive-bg-hover); border-color: var(--dsw-alias-border-l2); }
.ybt-file-click:focus-visible { outline: none; border-color: var(--dsw-focus-ring-color, var(--dsw-alias-brand-primary)); }
.ybt-sec { display: flex; flex-direction: column; gap: 6px; }
.ybt-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.ybt-htitle { font-size: 11.5px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: var(--dsw-alias-label-secondary); }
.ybt-card { display: flex; flex-direction: column; padding: 2px 10px; border-radius: var(--dsw-radius-md); border: 0.5px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); }
.ybt-kv { display: flex; align-items: baseline; gap: 10px; padding: 4px 0; }
.ybt-kv + .ybt-kv { border-top: 0.5px solid var(--dsw-alias-border-l1); }
.ybt-k { flex: 0 0 auto; width: 4.6em; color: var(--dsw-alias-label-secondary); font-size: 12.5px; }
.ybt-v { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ybt-vwrap { flex: 1 1 auto; min-width: 0; word-break: break-all; }
.ybt-num { flex: 1 1 auto; text-align: right; font-variant-numeric: tabular-nums; font-weight: 600; }
.ybt-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11.5px; }
.ybt-dim { color: var(--dsw-alias-label-secondary); }
.ybt-faint { color: var(--dsw-alias-label-secondary); }
.ybt-ok { color: var(--dsw-alias-state-success-primary); }
.ybt-bad { color: var(--dsw-alias-state-error-primary); }
.ybt-warn { color: var(--dsw-alias-state-warn-primary); }
.ybt-idle { color: var(--dsw-alias-state-idle-primary); }
.ybt-chip { display: inline-flex; align-items: center; padding: 0 6px; border-radius: var(--dsw-radius-sm); border: 0.5px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-2); font-size: 11.5px; color: var(--dsw-alias-label-secondary); }
.ybt-stats { display: flex; gap: 6px; }
.ybt-stat { flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; gap: 1px; padding: 7px 9px; border-radius: var(--dsw-radius-md); border: 0.5px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); }
.ybt-stat-v { font-size: 17px; font-weight: 600; line-height: 1.2; font-variant-numeric: tabular-nums; }
.ybt-stat-k { font-size: 11.5px; color: var(--dsw-alias-label-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ybt-file { display: flex; flex-direction: column; gap: 2px; padding: 8px 10px; border-radius: var(--dsw-radius-md); border: 0.5px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); }
.ybt-file + .ybt-file { margin-top: 6px; }
.ybt-file-missing { border-style: dashed; background: transparent; }
.ybt-file-top { display: flex; align-items: baseline; gap: 8px; }
.ybt-file-name { flex: 1 1 auto; min-width: 0; font-weight: 600; font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ybt-file-size { flex: 0 0 auto; font-size: 11.5px; font-variant-numeric: tabular-nums; color: var(--dsw-alias-label-secondary); }
/* 交付物路径：这类「要照着去找文件」的文本必须看得清，
   故用 12px 常规字重 + secondary 文本色，而不是更小更弱的辅助色。 */
.ybt-file-path { font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ybt-tools { display: flex; flex-direction: column; }
.ybt-tool { display: flex; align-items: baseline; gap: 7px; padding: 3px 0; }
.ybt-tool + .ybt-tool { border-top: 0.5px solid var(--dsw-alias-border-l1); }
.ybt-tool-name { flex: 0 0 auto; font-size: 12px; }
.ybt-tool-ver { flex: 1 1 auto; min-width: 0; text-align: right; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11.5px; color: var(--dsw-alias-label-secondary); }
.ybt-btn { font: inherit; font-size: 12px; padding: 3px 10px; border-radius: var(--dsw-radius-sm); border: 0.5px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-button-elevated-fill); color: var(--dsw-alias-label-primary); cursor: pointer; flex: 0 0 auto; }
.ybt-btn:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.ybt-btn:disabled { color: var(--dsw-alias-label-secondary); cursor: default; }
.ybt-btn-plain { border-color: transparent; background: transparent; color: var(--dsw-alias-label-secondary); padding: 2px 6px; }
.ybt-btn-plain:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.ybt-input { width: 100%; box-sizing: border-box; padding: 5px 8px; border-radius: var(--dsw-radius-sm); border: 0.5px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font: inherit; font-size: 12px; }
.ybt-pre { margin: 6px 0 0; padding: 8px; max-height: 220px; overflow: auto; border-radius: var(--dsw-radius-sm); border: 0.5px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-markdown-code-block); color: var(--dsw-alias-label-secondary); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11px; line-height: 1.55; white-space: pre-wrap; word-break: break-all; }
.ybt-note { font-size: 12px; color: var(--dsw-alias-label-secondary); }
.ybt-row-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
/* 论文源文件清单：条目行紧凑排列，长路径单行省略。 */
.ybt-files { padding: 2px 0; max-height: 40vh; overflow-y: auto; }
/* 分类标签页：正文 / 资源 / 数据 / 文档。窄栏里用可换行的 pill 行，而不是等宽分栏。 */
.ybt-tabs { display: flex; flex-wrap: wrap; gap: 4px; padding-bottom: 2px; }
.ybt-tab { font: inherit; font-size: 11.5px; line-height: 1.6; padding: 1px 8px; border-radius: 999px; border: 0.5px solid var(--dsw-alias-border-l1); background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; display: inline-flex; align-items: center; gap: 4px; }
.ybt-tab:hover { background: var(--dsw-alias-interactive-bg-hover); }
.ybt-tab.on { background: var(--dsw-alias-interactive-bg-hover); border-color: var(--dsw-alias-border-l2); color: var(--dsw-alias-label-primary); font-weight: 600; }
.ybt-tab-n { font-variant-numeric: tabular-nums; font-size: 10.5px; color: var(--dsw-alias-label-secondary); }
/* 资源目录的聚合行：只列目录与数量，不逐个铺开上百张图。 */
.ybt-dir-row { display: flex; align-items: baseline; gap: 8px; padding: 5px 10px; }
.ybt-dir-row + .ybt-dir-row { border-top: 0.5px solid var(--dsw-alias-border-l1); }
.ybt-dir-name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11.5px; }
.ybt-dir-meta { flex: 0 0 auto; font-size: 11px; color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; }
.ybt-file-row { display: flex; align-items: baseline; gap: 7px; padding: 3px 10px; }
.ybt-file-row + .ybt-file-row { border-top: 0.5px solid var(--dsw-alias-border-l1); }
.ybt-file-row-name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11.5px; }
/* 逐章汉字数：右对齐、等宽数字，读起来能列成一条竖线。 */
.ybt-file-row-han { flex: 0 0 auto; font-size: 11.5px; font-variant-numeric: tabular-nums; color: var(--dsw-alias-label-secondary); }
.ybt-file-row-size { flex: 0 0 auto; font-size: 11px; color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; }
.ybt-foot { display: flex; align-items: center; gap: 6px; padding-top: 2px; border-top: 0.5px solid var(--dsw-alias-border-l1); }
.ybt-live { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: var(--dsw-alias-state-idle-primary); flex: 0 0 auto; }
.ybt-live.on { background: var(--dsw-alias-state-success-primary); }
.ybt-live.bad { background: var(--dsw-alias-state-error-primary); }
.ybt-empty { padding: 10px; border-radius: var(--dsw-radius-md); border: 0.5px dashed var(--dsw-alias-border-l2); color: var(--dsw-alias-label-secondary); font-size: 12px; text-align: center; }
/* 会话内的项目列表：一个会话可有多篇文档（论文 / 开题 / 文献综述）。 */
.ybt-projects { padding: 2px 0; }
.ybt-project-row { display: flex; align-items: center; gap: 2px; }
.ybt-project-row + .ybt-project-row { border-top: 0.5px solid var(--dsw-alias-border-l1); }
.ybt-project-row.on { background: var(--dsw-alias-interactive-bg-hover); }
.ybt-project-pick { flex: 1 1 auto; min-width: 0; display: flex; align-items: center; gap: 6px; padding: 5px 10px; border: 0; background: transparent; color: inherit; font: inherit; cursor: pointer; text-align: left; }
.ybt-project-name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11.5px; }
.ybt-alert { padding: 8px 10px; border-radius: var(--dsw-radius-md); border: 0.5px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-2); font-size: 12px; }
`

    /** 只注入一次样式表（面板可能被多次挂载）。 */
    function ensureStyles() {
      const id = 'yibinthesis-dsh-styles'
      if (typeof document === 'undefined') return
      if (document.getElementById(id)) return
      const el = document.createElement('style')
      el.id = id
      el.textContent = CSS
      document.head.appendChild(el)
    }

    /**
     * 人类可读的字节数。
     * @param bytes - 字节数（可为 null）。
     * @returns 形如 `157.2 KB` 的文本，或 null。
     */
    function formatBytes(bytes) {
      if (typeof bytes !== 'number' || !Number.isFinite(bytes)) return null
      if (bytes < 1024) return `${bytes} B`
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
      return `${(bytes / 1024 / 1024).toFixed(2)} MB`
    }

    /**
     * 人类可读的本地时间。
     * @param ms - epoch 毫秒（可为 null）。
     * @returns 形如 `10-04 00:22` 的文本，或 null。
     */
    function formatTime(ms) {
      if (typeof ms !== 'number' || !Number.isFinite(ms)) return null
      const d = new Date(ms)
      const p = (n) => String(n).padStart(2, '0')
      return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
    }

    /**
     * 从 doctor 的 stdout 里切出逐项状态行，供面板紧凑显示。
     *
     * 这里**只做展示**；就绪度的权威判断始终是退出码（host 半已判定并回传 ready）。
     * @param stdout - doctor 的原始输出。
     * @returns 解析出的条目数组。
     */
    function parseEntries(stdout) {
      const out = []
      for (const raw of String(stdout || '').split(/\r?\n/)) {
        const m = /^\s*\[(OK|MISSING|INCOMPATIBLE)\]\s+(.+?)\s+\((required|optional)\)\s*-\s*(.*)$/.exec(raw)
        if (m) {
          out.push({ status: m[1], name: m[2].trim(), required: m[3] === 'required', detail: m[4].trim() })
          continue
        }
        const mod = /^\s*\[(OK|MISSING)\]\s+Python module:\s*(.+)$/.exec(raw)
        if (mod) out.push({ status: mod[1], name: `python:${mod[2].trim()}`, required: false, detail: '' })
      }
      return out
    }

    /** 文档类型与学科的标签键（走词典，便于将来加语言）。 */
    const DOC_TYPE_KEY = { thesis: 'doc.thesis', proposal: 'doc.proposal', 'literature-review': 'doc.literatureReview' }
    const DISCIPLINE_KEY = { humanities: 'disc.humanities', science: 'disc.science' }

    /**
     * 文件分类的中文标签。
     *
     * 与 host 半的 `FILE_CATEGORY_LABELS` 同源（那边是事实源，这边是客户端显示用）。
     * 之所以不并入 `zh` 词典：它随 `files.categories` 的键动态出现，
     * 而词典是静态键集，两者合并会让「词典键必须 zh/en 一致」那条测试变复杂。
     */
    const CATEGORY_LABELS = { source: '正文', assets: '资源', data: '数据', docs: '文档', other: '其他' }

    /** 分类的显示顺序（正文最先——那是要写的东西）。 */
    const CATEGORY_ORDER = ['source', 'assets', 'data', 'docs', 'other']

    /**
     * 把长路径缩成「末两级」，窄栏里才看得清是哪篇文档。
     * @param path - 完整路径。
     * @returns 缩短后的显示文本（仍能从 title 看到全路径）。
     */
    function shortenPath(path) {
      const parts = String(path || '').replace(/\\/g, '/').split('/').filter(Boolean)
      if (parts.length <= 2) return String(path || '')
      return `…/${parts.slice(-2).join('/')}`
    }

    /**
     * 从文件列表**本地推导**分类计数（旧版宿主没有 `categories` 字段时的兜底）。
     *
     * 为什么要这层兜底：client 半随页面刷新更新，host 半要**重启 DSH** 才更新。
     * 两者版本不一致时，旧 host 的 `/files` 不返回 `categories`，界面会表现为
     * 「显示 147 个、但一个文件都列不出来」——比直接报错更难排查。
     * 本地推导让面板在任何一侧较旧时仍可用。
     * @param list - `/files` 返回的文件数组。
     * @returns `{ [category]: count }`。
     */
    function deriveCategories(list) {
      const counts = {}
      for (const file of list || []) {
        // 更早的客户端字段是 `source` 布尔值；两者都认。
        const key = file.category || (file.source ? 'source' : 'other')
        counts[key] = (counts[key] || 0) + 1
      }
      return counts
    }

    /**
     * 单个文件所属分类（兼容旧版宿主只给 `source` 布尔值的情况）。
     * @param file - 文件项。
     * @returns 分类键。
     */
    function categoryOf(file) {
      return file.category || (file.source ? 'source' : 'other')
    }

    /**
     * 按目录聚合文件（用于「资源」这类动辄上百个的分类）。
     *
     * 聚合到**目录**层级而不是逐个列出：一个真实项目的 `图表资源/` 有 44 张图，
     * 铺开只是噪音；用户关心的是「资源放在哪几个目录、有多少」。
     * @param list - 文件数组（每项含 `relative` 与 `size`）。
     * @returns `[{ dir, count, bytes }]`，按目录名字典序。
     */
    function groupByDirectory(list) {
      const groups = new Map()
      for (const file of list) {
        const relative = String(file.relative || '').replace(/\\/g, '/')
        const index = relative.lastIndexOf('/')
        // 顶层文件没有目录段，用「(项目根)」占位，避免出现空目录名。
        const dir = index > 0 ? relative.slice(0, index) : '(项目根)'
        const current = groups.get(dir) || { dir, count: 0, bytes: 0 }
        current.count += 1
        current.bytes += typeof file.size === 'number' ? file.size : 0
        groups.set(dir, current)
      }
      return [...groups.values()].sort((a, b) => a.dir.localeCompare(b.dir))
    }

    /**
     * 右侧栏的文件打开通道（`ctx.sidebarRight.openResource`）。
     *
     * 契约取自 `dsh-context` 的实测实现：地址形如
     * `dsh-resource://file/session/<sessionId>/<url-encoded path>`。
     * 服务在 `apply()` 时可能尚未就绪，故用 `ctx.inject` 延迟捕获，并在**每次点击时**
     * 重新校验（服务可能随 HMR 消失）。
     */
    let sidebarRightFace = null

    /**
     * 在右侧栏打开一个本地文件。
     * @param sessionId - 当前会话 id（由槽位 props 提供）。
     * @param absolutePath - 文件的绝对路径。
     * @returns 是否成功交给宿主打开。
     */
    function openFileInSidebar(sessionId, absolutePath) {
      if (typeof sessionId !== 'string' || sessionId === '') return false
      const encodedSegment = (segment) => encodeURIComponent(segment).replace(/%3A/gi, ':')
      const normalized = String(absolutePath).replace(/\\/g, '/').replace(/^(?:\.\/)+/, '')
      const address = `dsh-resource://file/session/${encodedSegment(sessionId)}/${normalized
        .split('/')
        .map(encodedSegment)
        .join('/')}`
      try {
        if (sidebarRightFace === null || typeof sidebarRightFace.openResource !== 'function') return false
        sidebarRightFace.openResource(address)
        return true
      } catch {
        return false
      }
    }

    /**
     * 面板数据的**模块级缓存**（跨组件挂载存活）。
     *
     * 为什么必须放在组件外：宿主在切换右侧栏标签时会**卸载**面板组件，组件内的 state
     * 随之清空——于是每次切回来都要重新跑一遍 `/doctor`（那是真的起 PowerShell 进程），
     * 用户看到的就是「切回来又要等扫描」。模块作用域在整个页面生命周期内都在。
     *
     * 同时持久化到 `sessionStorage`：**刷新页面**后也能秒开。
     *
     * 缓存**故意**留在 `sessionStorage`（而不是 `localStorage`）：它只是性能优化，
     * 页面级生命周期正好够用；跨重启留一份可能过期的工具链/交付物快照没有价值，
     * 反而会让人看到陈旧数据。**项目列表**则必须跨重启，故用 `localStorage`。
     *
     * 陈旧性由三件事兜住：① 记录并显示「几秒前更新」；② 先渲染缓存、再后台静默刷新；
     * ③ 显式的「刷新」按钮。
     */
    const CACHE_PREFIX = 'yibinthesis-dsh:cache:'
    /** 内存缓存：`{ [projectDir]: { at, state, probe, deliverables, doctor, files } }`。 */
    const memoryCache = new Map()

    // ── 按会话保存的项目列表 ────────────────────────────────────────────────
    //
    // 设计为什么从「一个目录」改成「一列表」：
    //   ① 用户实测反馈：每个新窗口默认都指向示例论文，而他真正的项目在别处；
    //      默认应当是**空**，由用户或助手显式加入。
    //   ② 一个会话里往往不止一篇文档——毕业论文、开题报告、文献综述是三个**独立项目**
    //      （`yibinthesis_new` 的三种 documentType），旧模型「一个会话 = 一篇论文」
    //      让面板只能看其中一个。
    //   ③ 用户要求「按会话窗口保存」：所以键是 sessionId，而不是全局或按目录。
    //
    // 持久化用 **`localStorage`**（跨应用重启），键里带会话 id。
    //
    // ⚠️ 早期用的是 `sessionStorage`，那是**错的**：它的生命周期只有当前标签页会话，
    // 关掉 DSH 再打开就全没了——用户实测反馈「每次重进 dsh 都要重新输入路径」。
    // `sessionStorage` 只能扛页面刷新，扛不住应用重启。
    // 仍然刻意**不**写宿主的持久存储：那需要宿主级服务且会跨会话泄漏。

    /** 存储键前缀（后接 sessionId）。 */
    const PROJECTS_PREFIX = 'yibinthesis-dsh:projects:'

    /**
     * 取持久化存储：优先 `localStorage`（跨重启），回退 `sessionStorage`。
     *
     * 回退是必要的：某些嵌入式环境可能禁用 `localStorage`（隐私模式等），
     * 此时退到 `sessionStorage` 至少能扛住页面刷新，而不是完全丢失。
     * @returns 存储对象，或 `null`。
     */
    function persistentStore() {
      for (const candidate of ['localStorage', 'sessionStorage']) {
        try {
          const store = window?.[candidate]
          if (store && typeof store.getItem === 'function' && typeof store.setItem === 'function') return store
        } catch {
          /* 访问被拒（安全策略）：试下一个 */
        }
      }
      return null
    }

    /**
     * 读某会话的项目列表。
     *
     * 兼容旧键：早期写在 `sessionStorage`，现在读 `localStorage`；
     * 若新位置没有则去旧位置找一次，避免升级后用户的列表「消失」。
     * @param sessionId - 会话 id（空则返回空列表）。
     * @returns `{ projects: Array<{dir: string}>, active: number }`。
     */
    function readProjects(sessionId) {
      if (!sessionId) return { projects: [], active: 0 }
      const key = PROJECTS_PREFIX + sessionId
      const parse = (raw) => {
        if (!raw) return null
        const parsed = JSON.parse(raw)
        const projects = Array.isArray(parsed?.projects)
          ? parsed.projects.filter((item) => item && typeof item.dir === 'string' && item.dir.trim())
          : []
        if (!projects.length) return null
        const active = Number.isInteger(parsed?.active)
          ? Math.min(Math.max(parsed.active, 0), projects.length - 1)
          : 0
        return { projects, active }
      }
      try {
        const fresh = parse(persistentStore()?.getItem(key))
        if (fresh) return fresh
        // 旧位置（早期版本用 sessionStorage 写）。
        const legacy = parse(window?.sessionStorage?.getItem(key))
        if (legacy) return legacy
        return { projects: [], active: 0 }
      } catch {
        return { projects: [], active: 0 }
      }
    }

    /**
     * 写某会话的项目列表（**跨应用重启**持久）。
     * @param sessionId - 会话 id。
     * @param value - `{ projects, active }`。
     */
    function writeProjects(sessionId, value) {
      if (!sessionId) return
      try {
        persistentStore()?.setItem(PROJECTS_PREFIX + sessionId, JSON.stringify(value))
      } catch {
        /* 无可用存储（或配额满）：本次会话内仍可用内存状态 */
      }
    }

    /**
     * 用户**手动指定**的目录（模块作用域，当前会话内）。
     *
     * 为什么在模块级：宿主切换右侧栏标签会卸载面板，组件 state 随之清空，
     * 重挂载就回落到配置里的 `defaultProjectDir`——实测表现是
     * 「我把项目切到自己的论文，切一下 tab 又变回默认项目了」。
     *
     * 语义（与 `activeDir` 一起构成目录真源，改这里务必同步改测试）：
     * · 非空 = 有明确的当前项目 → 优先于 `/state` 报的默认目录；
     * · 为空 = 当前会话还没有项目 → 由用户或助手加入（配置默认值仅在非空时才兜底）。
     */
    let manualDir = ''

    /**
     * **当前在用**的目录（模块作用域），用作缓存键。
     *
     * 与 `manualDir` 的区别：它记录「当前正在取数的那一个」，用于命中缓存
     * （缓存按目录索引），从而让「切回标签秒开」成立。
     */
    let activeDir = ''

    /**
     * 已加载过的会话 id。
     *
     * 为什么需要：`loadState` 可能因其它依赖变化重跑，而「从存储载入项目列表」
     * 只能在**会话真正切换**时做一次——否则会把用户刚加入、还没写盘的项目覆盖掉。
     */

    /**
     * 缓存新鲜度窗口（毫秒）。
     *
     * 窗口内切回标签页**直接复用缓存**、不重跑 `doctor`（那会真的起 PowerShell 进程）；
     * 超出窗口才后台重扫。60 秒是个折中：工具链与交付物不会秒级变化，
     * 而用户若刚构建完想核对结果，可以点「刷新」强制重扫。
     */
    const CACHE_FRESH_MS = 60000

    /**
     * 读缓存：先内存，再 sessionStorage。
     * @param projectDir - 缓存键（按项目目录隔离）。
     * @returns 缓存条目，或 `null`。
     */
    function readCache(projectDir) {
      if (!projectDir) return null
      if (memoryCache.has(projectDir)) return memoryCache.get(projectDir)
      try {
        const raw = window.sessionStorage?.getItem(CACHE_PREFIX + projectDir)
        if (!raw) return null
        const parsed = JSON.parse(raw)
        if (parsed && typeof parsed === 'object') {
          memoryCache.set(projectDir, parsed)
          return parsed
        }
      } catch {
        /* 无 sessionStorage（或配额满）：只靠内存缓存 */
      }
      return null
    }

    /**
     * 写缓存（内存 + sessionStorage）。
     * @param projectDir - 缓存键。
     * @param entry - 缓存条目。
     */
    function writeCache(projectDir, entry) {
      if (!projectDir) return
      activeDir = projectDir
      memoryCache.set(projectDir, entry)
      try {
        window.sessionStorage?.setItem(CACHE_PREFIX + projectDir, JSON.stringify(entry))
      } catch {
        /* 配额满：内存缓存仍然有效 */
      }
    }

    /**
     * 人类可读的「多久之前」。
     * @param ms - 距今毫秒数。
     * @returns 形如 `刚刚` / `12 秒前` / `3 分钟前` 的文本。
     */
    function formatAgo(ms) {
      if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return '刚刚'
      const seconds = Math.floor(ms / 1000)
      if (seconds < 5) return '刚刚'
      if (seconds < 60) return `${seconds} 秒前`
      const minutes = Math.floor(seconds / 60)
      if (minutes < 60) return `${minutes} 分钟前`
      return `${Math.floor(minutes / 60)} 小时前`
    }

    /**
     * 一行「左标签 + 右值」，空值不渲染。 */
    function Row({ k, value, mono, className, title }) {
      if (value === null || value === undefined || value === '') return null
      return h(
        'div',
        { className: 'ybt-kv' },
        h('span', { className: 'ybt-k' }, k),
        h('span', { className: `ybt-v${mono ? ' ybt-mono' : ''}${className ? ` ${className}` : ''}`, title: title || undefined }, value),
      )
    }

    /** 一张交付物卡片（存在 / 未生成 两种形态；已生成的可点击打开）。 */
    function DeliverableCard({ title, info, onOpen }) {
      if (!info || !info.template) return null
      const missing = !info.exists
      const path = info.resolved || info.template
      const sub = info.hasPlaceholders
        ? '文件名含 {{占位符}}，实际产物以构建器为准'
        : missing
          ? '尚未生成'
          : `生成于 ${formatTime(info.mtimeMs) || '未知时间'}${onOpen ? ' · 点击打开' : ''}`
      const clickable = Boolean(onOpen) && !missing
      return h(
        'div',
        {
          className: `ybt-file${missing ? ' ybt-file-missing' : ''}${clickable ? ' ybt-file-click' : ''}`,
          role: clickable ? 'button' : undefined,
          tabIndex: clickable ? 0 : undefined,
          title: clickable ? `打开 ${path}` : path,
          onClick: clickable ? () => onOpen(path) : undefined,
          onKeyDown: clickable
            ? (event) => {
                if (event.key === 'Enter' || event.key === ' ') onOpen(path)
              }
            : undefined,
        },
        h(
          'div',
          { className: 'ybt-file-top' },
          h('span', { className: missing ? 'ybt-faint' : 'ybt-ok' }, missing ? '○' : '●'),
          h('span', { className: 'ybt-file-name' }, title),
          info.exists ? h('span', { className: 'ybt-file-size' }, formatBytes(info.size) || '') : null,
        ),
        h('div', { className: 'ybt-file-path ybt-mono ybt-dim' }, path),
        h('div', { className: 'ybt-note' }, sub),
      )
    }

    /**
     * 错误边界：面板渲染抛错时**把错误显示出来**，而不是留一片空白。
     *
     * 为什么必须自己包一层：React 在组件抛错时会卸载整棵子树，实机表现就是「面板是空的、
     * 且没有任何提示」——排查时完全无从下手（本项目已经因为「空面板」浪费过多轮往返）。
     * 边界把 `error.message` 与组件栈直接渲染出来，下一次就能一眼看到原因。
     *
     * 用 class 组件是 React 的硬要求：只有 class 能实现 `componentDidCatch`／`getDerivedStateFromError`。
     */
    class PanelErrorBoundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { error: null }
      }

      static getDerivedStateFromError(error) {
        return { error }
      }

      componentDidCatch(error, info) {
        // 宿主控制台留一份完整栈，便于深挖。
        try {
          console.error('[yibinthesis-dsh] 面板渲染失败', error, info)
        } catch {
          /* 控制台不可用则忽略 */
        }
      }

      render() {
        const { error } = this.state
        if (!error) return this.props.children
        const detail = [String(error?.message ?? error), String(error?.stack ?? '')].filter(Boolean).join('\n\n')
        return h(
          'div',
          { className: 'ybt-root' },
          h('div', { className: 'ybt-alert ybt-bad' }, '面板渲染失败（已捕获，以下为原因）'),
          h('pre', { className: 'ybt-pre', style: { maxHeight: '60vh' } }, detail),
          h('div', { className: 'ybt-note' }, '请把这段内容反馈给插件作者；宿主控制台有完整堆栈。'),
        )
      }
    }

    /** 工具链逐项：● 就绪 / ○ 缺失 / ◐ 版本不符。 */
    function ToolRow({ entry }) {
      const mark = entry.status === 'OK' ? '●' : entry.status === 'MISSING' ? '○' : '◐'
      const tone = entry.status === 'OK' ? 'ybt-ok' : entry.status === 'MISSING' ? 'ybt-bad' : 'ybt-warn'
      return h(
        'div',
        { className: 'ybt-tool' },
        h('span', { className: tone }, mark),
        h('span', { className: 'ybt-tool-name ybt-mono' }, entry.name),
        entry.required ? h('span', { className: 'ybt-chip' }, '必需') : null,
        h('span', { className: 'ybt-tool-ver', title: entry.detail || undefined }, entry.detail || ''),
      )
    }

    /** 主面板组件（含一个显式写操作：设置产物输出名称）。 */
    function ThesisPanel(slotProps) {
      const sessionId = typeof slotProps?.sessionId === 'string' ? slotProps.sessionId : ''
      const [state, setState] = useState(null)
      const [probe, setProbe] = useState(null)
      const [deliverables, setDeliverables] = useState(null)
      const [doctor, setDoctor] = useState(null)
      const [error, setError] = useState(null)
      const [loading, setLoading] = useState(false)
      const [showLog, setShowLog] = useState(false)
      const [showConfig, setShowConfig] = useState(false)
      const [editingDir, setEditingDir] = useState(false)
      /**
       * 「＋ 添加」输入框的草稿（确认后才进列表）。
       *
       * ⚠️ 必须与「产物输出名称」编辑器的草稿**分开**：早期两者共用 `draftDir`，
       * 同一个 state 被两个输入框读写，按回车时读到的草稿是空的
       * （实测由临时日志定位：`draftDir=""` 而输入框 `value` 已是新值）。
       */
      const [projectDraft, setProjectDraft] = useState('')
      const [files, setFiles] = useState(null)
      /** 文件分类标签页的当前分类。默认「正文」——那是用户最常看的。 */
      const [activeCategory, setActiveCategory] = useState('source')
      const [editingNames, setEditingNames] = useState(false)
      const [draftPdf, setDraftPdf] = useState('')
      const [draftWord, setDraftWord] = useState('')
      const [savingNames, setSavingNames] = useState(false)
      const [namesError, setNamesError] = useState(null)
      /** 上次数据落地的时刻（用于「12 秒前更新」与缓存判断）。 */
      const [updatedAt, setUpdatedAt] = useState(null)
      /**
       * 当前会话的项目列表（一个会话可有多篇文档：论文 / 开题 / 文献综述）。
       * 空列表是**正常初始态**——默认不该凭空指向某个项目。
       */
      const [projects, setProjects] = useState([])
      /** 当前选中的项目下标。 */
      const [activeIndex, setActiveIndex] = useState(0)
      const mounted = useRef(true)
      const dirInput = useRef(null)

      useEffect(() => {
        mounted.current = true
        ensureStyles()
        return () => {
          mounted.current = false
        }
      }, [])

      /**
       * 挂载时从存储恢复本会话的项目列表（**每个组件实例只做一次**）。
       *
       * 为什么用组件内 ref 而不是模块级标志：模块级标志不会被「卸载」重置，
       * 于是重新挂载时守卫会误判为「已恢复过」而跳过——组件 state 已在卸载时清空，
       * 结果就是**切回标签后项目列表丢空**（实测缺陷）。
       * 组件 ref 随实例重建，语义正好是「本次挂载还没恢复过」。
       */
      const restoredRef = useRef(false)
      useEffect(() => {
        if (restoredRef.current) return
        restoredRef.current = true
        const stored = readProjects(sessionId)
        if (stored.projects.length) {
          setProjects(stored.projects)
          setActiveIndex(stored.active)
          manualDir = stored.projects[stored.active]?.dir || ''
        }
      }, [sessionId])

      /**
       * 走一次桥，返回解析后的 JSON。
       *
       * 必须**容错地**解析：桥路由由 host 半在**启动时**注册，页面刷新不会重载宿主模块。
       * 当宿主进程里装的是旧版桥（没有这个路由）时，服务端会以**纯文本** 404 应答
       * （例如 `not found`），直接 `res.json()` 只会抛出
       * `Unexpected token 'o', "not found" is not valid JSON` —— 这种消息对用户毫无意义。
       * 这里把它翻译成一条**可操作**的说明。
       * @param route - 桥路由（如 `/state`）。
       * @param dir - 可选的项目目录。
       * @param options - `{ method, body }`；省略即 GET。
       * @returns 解析后的响应体。
       * @throws {Error} 响应不是 JSON 时（消息里带上状态码与正文片段）。
       */
      const callBridge = useCallback(async (route, dir, options = {}) => {
        const query = dir && !options.method ? `?projectDir=${encodeURIComponent(dir)}` : ''
        const init = { headers: { accept: 'application/json' } }
        if (options.method) {
          init.method = options.method
          init.headers['content-type'] = 'application/json'
          init.body = JSON.stringify(options.body || {})
        }
        const res = await fetch(`${BRIDGE}${route}${query}`, init)
        const raw = await res.text()
        let body = null
        try {
          body = raw ? JSON.parse(raw) : null
        } catch {
          body = null
        }
        if (body === null) {
          const snippet = String(raw || '').trim().slice(0, 120)
          if (res.status === 404) {
            throw new Error(
              `宿主没有注册桥路由 ${BRIDGE}${route}（404）。` +
                '桥路由在宿主**启动时**注册，页面刷新不会重载宿主模块——' +
                '请**重启 DSH**（不是刷新页面），让新版本的 host 半生效。',
            )
          }
          throw new Error(`桥 ${route} 返回了非 JSON 响应（HTTP ${res.status}）：${snippet || '(空)'}`)
        }
        if (!res.ok && !body?.error) throw new Error(`桥 ${route} 返回 HTTP ${res.status}`)
        return body
      }, [])

      /**
       * 首屏：只取 `/state`（秒级），并把 defaultProjectDir 填进输入框。
       *
       * 先**同步**从缓存塞入上一次的项目目录与数据，再发请求——这样切回标签页时
       * 内容立刻就在，不会先闪一下空面板。
       */
      /**
       * 首屏：只取 `/state`（秒级），并把项目目录填进输入框。
       *
       * 目录优先级见 `manualDir`：**用户手动改过的目录永远优先**，
       * 没改过时才采用 `/state` 报的目录（配置默认值 / 会话切换）。
       *
       * 先用**缓存**把界面填上（切回标签页 / 刷新页面后的秒开路径），再向宿主确认。
       *
       * ⚠️ 依赖必须保持稳定：早期版本把 `state`/`projectDir` 写进依赖数组，导致
       * `loadState` 每次渲染都换新引用 → 触发 `useEffect([loadState])` → 再 setState
       * → **无限渲染循环**（被测试的循环上限逮住）。
       */
      const loadState = useCallback(async () => {
        // 缓存按**当前在用**的目录索引。
        const cached = readCache(manualDir || activeDir)
        if (cached) {
          if (cached.state) setState(cached.state)
          if (cached.probe) setProbe(cached.probe)
          if (cached.deliverables) setDeliverables(cached.deliverables)
          if (cached.doctor) setDoctor(cached.doctor)
          if (cached.files) setFiles(cached.files)
          if (typeof cached.at === 'number') setUpdatedAt(cached.at)
        }
        try {
          // 必须带上**当前项目目录**：不带时 `/state` 只能回 `project.dir = null`，
          // 面板会显示「✗ 该目录没有 yibinthesis.project.json」，而摘要区（`/probe`
          // 带了目录）却读到了内容——实测过的自相矛盾状态。
          const stateQuery = manualDir || activeDir || ''
          const body = await callBridge('/state', stateQuery)
          if (!mounted.current) return
          if (!body?.ok) {
            setError(body?.error?.message || '无法读取插件状态')
            return
          }
          setError(null)
          setState(body)
          // 兜底：配置里若**显式**设了 `defaultProjectDir`（本部署刻意留空），
          // 且面板此刻确实在查那个目录（`stateQuery` 为空，由后端选定），才把它加进列表。
          // 这样既兼容设了默认目录的部署，又保持「本部署默认空、不凭空指向项目」。
          const fallback = body.config?.defaultProjectDir
          if (!stateQuery && typeof fallback === 'string' && fallback.trim()) {
            const value = fallback.trim()
            manualDir = value
            setProjects((current) => (current.length ? current : [{ dir: value }]))
          }
        } catch (err) {
          if (mounted.current) setError(String(err?.message || err))
        }
      }, [callBridge, sessionId])

      /** 当前项目目录（由列表与下标派生——单一真源，避免两份状态不同步）。 */
      const projectDir = projects[activeIndex]?.dir || ''

      /** 把一个目录加入本会话的项目列表（已存在则只切换过去）。 */
      const addProject = useCallback(
        (dir) => {
          const value = String(dir || '').trim()
          if (!value) return false
          // 必须**同步**算出新列表与下标：不能指望 `setProjects` 的 updater 立刻执行
          // （React 可能推迟到渲染期，那样 `nextProjects` 会一直是空数组）。
          const existing = projects.findIndex((item) => item.dir === value)
          const nextProjects = existing >= 0 ? projects : [...projects, { dir: value }]
          const nextIndex = existing >= 0 ? existing : nextProjects.length - 1
          setProjects(nextProjects)
          setActiveIndex(nextIndex)
          manualDir = value
          if (sessionId) writeProjects(sessionId, { projects: nextProjects, active: nextIndex })
          return true
        },
        [projects, sessionId],
      )

      /** 切换到列表中的某个项目。 */
      const selectProject = useCallback(
        (index) => {
          setActiveIndex(index)
          const dir = projects[index]?.dir || ''
          manualDir = dir
          if (sessionId) writeProjects(sessionId, { projects, active: index })
        },
        [projects, sessionId],
      )

      /** 从列表移除某个项目（纯本地列表操作，不碰磁盘）。 */
      const removeProject = useCallback(
        (index) => {
          const nextProjects = projects.filter((_, i) => i !== index)
          const nextIndex = Math.min(Math.max(activeIndex > index ? activeIndex - 1 : activeIndex, 0), Math.max(nextProjects.length - 1, 0))
          setProjects(nextProjects)
          setActiveIndex(nextIndex)
          manualDir = nextProjects[nextIndex]?.dir || ''
          if (sessionId) writeProjects(sessionId, { projects: nextProjects, active: nextIndex })
        },
        [projects, activeIndex, sessionId],
      )

      useEffect(() => {
        void loadState()
      }, [loadState])

      /**
       * 「刷新」：并行取 probe + deliverables + doctor + files，互不依赖。
       * @param options - `{ silent }`：静默模式不显示「读取中…」（用于切回标签后的自动刷新）。
       */
      const refresh = useCallback(
        async (options = {}) => {
          if (!projectDir) return
          const silent = options.silent === true
          if (!silent) setLoading(true)
          setError(null)
          try {
            const fail = (err) => ({ ok: false, error: { kind: 'network', message: String(err?.message || err) } })
            const [probeBody, deliverableBody, doctorBody, filesBody] = await Promise.all([
              callBridge('/probe', projectDir).catch(fail),
              callBridge('/deliverables', projectDir).catch(fail),
              callBridge('/doctor', projectDir).catch(fail),
              callBridge('/files', projectDir).catch(fail),
            ])
            if (!mounted.current) return
            const nextProbe = probeBody?.ok ? probeBody : null
            const nextDeliverables = deliverableBody?.ok ? deliverableBody : null
            const nextFiles = filesBody?.ok ? filesBody : null
            const at = Date.now()
            setProbe(nextProbe)
            setDeliverables(nextDeliverables)
            setDoctor(doctorBody)
            setFiles(nextFiles)
            setUpdatedAt(at)
            // 落缓存：下次切回标签页或刷新页面时**先渲染这份数据**，不必再等一轮扫描。
            writeCache(projectDir, {
              at,
              state,
              probe: nextProbe,
              deliverables: nextDeliverables,
              doctor: doctorBody,
              files: nextFiles,
            })
            const firstError = [probeBody, deliverableBody].find((b) => b && b.ok === false && b.error)
            if (firstError) setError(`${firstError.error.message}（${firstError.error.kind}）`)
          } catch (err) {
            if (mounted.current) setError(String(err?.message || err))
          } finally {
            if (mounted.current && !silent) setLoading(false)
          }
        },
        [callBridge, projectDir, state],
      )

      /**
       * 保存「产物输出名称」（写项目配置的 `deliverables`）。
       *
       * 第二个（也是最后一个）写操作，同样由点击触发。校验在 host 半做——
       * 客户端只做「非空」这种显然判断，避免两处规则漂移。
       */
      const saveDeliverableNames = useCallback(async () => {
        if (!projectDir || savingNames) return
        setSavingNames(true)
        setNamesError(null)
        try {
          const result = await callBridge('/deliverables', '', {
            method: 'POST',
            body: { projectDir, pdf: draftPdf, word: draftWord },
          })
          if (!mounted.current) return
          if (!result?.ok) {
            setNamesError(result?.error?.message || '保存失败')
            return
          }
          // 用 host 回读的**真实**状态刷新面板，而不是拿本地草稿推断。
          setDeliverables((prev) => ({ ...(prev || {}), ...result }))
          setEditingNames(false)
        } catch (err) {
          if (mounted.current) setNamesError(String(err?.message || err))
        } finally {
          if (mounted.current) setSavingNames(false)
        }
      }, [callBridge, projectDir, draftPdf, draftWord, savingNames])

      // 首屏拿到项目目录后按需取数。
      //
      // 关键：**有足够新的缓存就不重扫**。宿主在切换右侧栏标签时会卸载本组件，
      // 若无条件重跑，每次切回来都要重新起 PowerShell 跑 `doctor` ——
      // 这正是用户报的「切回来又要等扫描」。
      //
      // 为什么「有缓存就静默刷新」还不够：静默只是**不显示进度**，`doctor` 该起进程
      // 还是起（实测重挂载会照样重跑一整轮）。故必须按**新鲜度**跳过：
      // 窗口内直接用缓存，超过窗口才后台重扫；用户始终可以点「刷新」强制。
      const autoRan = useRef(false)
      useEffect(() => {
        if (autoRan.current || !projectDir || !state?.project?.hasConfig) return
        autoRan.current = true
        const cached = readCache(projectDir)
        const fresh = cached && typeof cached.at === 'number' && Date.now() - cached.at < CACHE_FRESH_MS
        if (fresh) {
          // 缓存足够新：只向宿主确认目录（秒级、无进程），不重跑 doctor。
          void loadState()
          return
        }
        void refresh({ silent: Boolean(cached) })
      }, [projectDir, state, refresh, loadState])

      const connected = Boolean(state)
      // 桥连不上（且没有 state）时进入专门的失败视图。
      const bridgeFailed = !connected && Boolean(error)
      if (bridgeFailed) {
        return h(
          'div',
          { className: 'ybt-root' },
          h('div', { className: 'ybt-bad' }, '无法连接 yibinthesis-dsh 的 host 桥'),
          h('div', { className: 'ybt-dim' }, error),
          h(
            'div',
            { className: 'ybt-faint' },
            '桥需要宿主提供 webServer 服务。即使桥不可用，yibinthesis_* 原生工具与 yibinthesis 技能仍可正常使用。',
          ),
        )
      }

      const meta = probe?.metadata || {}
      const docClass = probe?.project?.documentClass || {}
      const docType = docClass.documentType
      const discipline = docClass.discipline
      const entries = doctor ? parseEntries(doctor.stdout) : []
      const hasConfig = Boolean(state?.project?.hasConfig)
      const pct = (n) => (typeof n === 'number' ? n.toLocaleString('en-US') : String(n ?? 0))
      // 逐章汉字数（来自 probe，**已剔除 LaTeX 标记**）按路径索引，
      // 供源文件清单逐条标注——只列路径不列字数，用户还得自己数。
      const hanByPath = new Map((probe?.chapters || []).map((chapter) => [chapter.path, chapter]))
      // 分类计数：优先用 host 给的；旧版 host 没有该字段时**本地推导**，
      // 否则标签栏与列表会双双为空（表现为「显示 N 个却一个也列不出来」）。
      const fileList = files?.files || []
      const categoryCounts = files?.categories && Object.keys(files.categories).length ? files.categories : deriveCategories(fileList)
      const categoryKeys = CATEGORY_ORDER.filter((key) => (categoryCounts[key] || 0) > 0)
      // 当前分类若在新数据里不存在（切换项目后分类变化），回落到第一个有内容的分类。
      const shownCategory = categoryCounts[activeCategory] ? activeCategory : categoryKeys[0] || 'source'

      return h(
        'div',
        { className: 'ybt-root' },

        // ── 头：项目目录 + 刷新 ─────────────────────────────────────────────
        h(
          'div',
          { className: 'ybt-sec' },
          h(
            'div',
            { className: 'ybt-head' },
            h('span', { className: 'ybt-htitle' }, '论文项目'),
            h(
              'div',
              { style: { display: 'flex', gap: '2px' } },
              h(
                'button',
                {
                  className: 'ybt-btn ybt-btn-plain',
                  type: 'button',
                  title: '把另一个项目目录加入本会话（论文 / 开题 / 文献综述各自独立）',
                  onClick: () => {
                    setEditingDir((v) => !v)
                    setProjectDraft('')
                    setTimeout(() => dirInput.current?.focus?.(), 0)
                  },
                },
                editingDir ? '取消' : '＋ 添加',
              ),
              h(
                'button',
                {
                  className: 'ybt-btn ybt-btn-plain',
                  type: 'button',
                  disabled: loading || !projectDir,
                  onClick: () => void refresh(),
                },
                loading ? '读取中…' : '刷新',
              ),
            ),
          ),

          // 添加输入框（加入列表，而不是替换当前项目）。
          editingDir
            ? h('input', {
                className: 'ybt-input ybt-mono',
                ref: dirInput,
                placeholder: '项目目录（含 yibinthesis.project.json）',
                value: projectDraft,
                onChange: (event) => setProjectDraft(event.target.value),
                onKeyDown: (event) => {
                  if (event.key === 'Enter' && projectDraft.trim()) {
                    addProject(projectDraft)
                    setEditingDir(false)
                  }
                },
              })
            : null,

          // 项目列表：一个会话可有多篇文档，点条目切换，× 移除（只动列表，不碰磁盘）。
          projects.length
            ? h(
                'div',
                { className: 'ybt-card ybt-projects' },
                projects.map((project, index) =>
                  h(
                    'div',
                    {
                      key: project.dir,
                      className: `ybt-project-row${index === activeIndex ? ' on' : ''}`,
                    },
                    h(
                      'button',
                      {
                        className: 'ybt-project-pick',
                        type: 'button',
                        title: project.dir,
                        onClick: () => selectProject(index),
                      },
                      h('span', { className: index === activeIndex ? 'ybt-ok' : 'ybt-faint' }, index === activeIndex ? '●' : '○'),
                      // 目录太长只显示末两级，全路径在 title 里。
                      h('span', { className: 'ybt-project-name ybt-mono' }, shortenPath(project.dir)),
                    ),
                    h(
                      'button',
                      {
                        className: 'ybt-btn ybt-btn-plain',
                        type: 'button',
                        title: '从列表移除（不删除磁盘文件）',
                        onClick: () => removeProject(index),
                      },
                      '×',
                    ),
                  ),
                ),
              )
            : h('div', { className: 'ybt-empty' }, '还没有项目。点「＋ 添加」选一个目录，或让助手用 yibinthesis_new 建一个。'),

          state?.project && projectDir
            ? h(
                'div',
                { className: `${hasConfig ? 'ybt-ok' : 'ybt-warn'}`, style: { fontSize: '12px' } },
                hasConfig ? `✓ 已找到 ${state.project.configName}` : `✗ 该目录没有 ${state.project.configName}`,
                // 缓存必须**可见地**标明新鲜度，否则用户无从判断看到的是不是旧数据。
                updatedAt
                  ? h('span', { className: 'ybt-note' }, ` · ${formatAgo(Date.now() - updatedAt)}更新`)
                  : null,
              )
            : null,
          error ? h('div', { className: 'ybt-alert ybt-bad' }, error) : null,
        ),

        // ── 论文摘要 ───────────────────────────────────────────────────────
        probe
          ? h(
              'div',
              { className: 'ybt-sec' },
              h('div', { className: 'ybt-htitle' }, '论文摘要'),
              h(
                'div',
                { className: 'ybt-card' },
                h(Row, { k: '题目', value: meta.title || '（未填写）', title: meta.title || undefined }),
                h(Row, { k: '英文题', value: meta['english-title'] }),
                h(Row, { k: '作者', value: meta.author || '（未填写）' }),
                h(Row, { k: '学号', value: meta['student-id'], mono: true }),
                h(Row, { k: '年级', value: meta.grade }),
                h(Row, { k: '院系', value: [meta.college, meta.major].filter(Boolean).join(' · ') }),
                h(Row, { k: '导师', value: [meta.advisor, meta['advisor-title']].filter(Boolean).join(' ') }),
                h(Row, {
                  k: '类型',
                  value: docType ? t(DOC_TYPE_KEY[docType] || docType) : '未识别',
                  title: docClass.class || undefined,
                }),
                h(Row, { k: '学科', value: discipline ? t(DISCIPLINE_KEY[discipline] || discipline) : null }),
              ),
              h(
                'div',
                { className: 'ybt-stats' },
                h(
                  'div',
                  { className: 'ybt-stat' },
                  h('div', { className: 'ybt-stat-v' }, String((probe.chapters || []).length)),
                  h('div', { className: 'ybt-stat-k' }, '章节'),
                ),
                h(
                  'div',
                  { className: 'ybt-stat' },
                  h(
                    'div',
                    { className: 'ybt-stat-v', title: `含标题 ${pct(probe.totalHan)} 字；不含标题 ${pct(probe.totalHanProse ?? 0)} 字` },
                    pct(probe.totalHanProse ?? probe.totalHan),
                  ),
                  h('div', { className: 'ybt-stat-k', title: '仅正文段落，不含章节标题，已剔除 LaTeX 标记' }, '正文字数'),
                ),
                h(
                  'div',
                  { className: 'ybt-stat' },
                  h('div', { className: 'ybt-stat-v ybt-mono', style: { fontSize: '13px' } }, probe.config?.citationMode || '—'),
                  h('div', { className: 'ybt-stat-k' }, '引用模式'),
                ),
              ),
            )
          : null,

        // ── 论文文件（按用途分类；点击在右侧栏预览，编辑交给宿主的编辑界面）──
        files?.files?.length
          ? h(
              'div',
              { className: 'ybt-sec' },
              h(
                'div',
                { className: 'ybt-head' },
                h('span', { className: 'ybt-htitle' }, '论文文件'),
                h(
                  'span',
                  { className: 'ybt-note' },
                  `${files.files.length}${files.truncated ? '+' : ''} 个`,
                ),
              ),
              // 分类标签页：实测一个真实项目有 147 个文件（资源 106、正文仅 13），
              // 混在一个列表里正文会被资源淹没，故必须分类。
              h(
                'div',
                { className: 'ybt-tabs' },
                categoryKeys.map((key) =>
                  h(
                    'button',
                    {
                      key,
                      type: 'button',
                      className: `ybt-tab${shownCategory === key ? ' on' : ''}`,
                      onClick: () => setActiveCategory(key),
                    },
                    CATEGORY_LABELS[key] || key,
                    h('span', { className: 'ybt-tab-n' }, String(categoryCounts[key] || 0)),
                  ),
                ),
              ),
              shownCategory === 'assets'
                ? // 资源动辄上百个：按目录聚合，不逐个铺开。
                  h(
                    'div',
                    { className: 'ybt-card ybt-files' },
                    groupByDirectory(fileList.filter((file) => categoryOf(file) === 'assets')).map((group) =>
                      h(
                        'div',
                        { className: 'ybt-dir-row', key: group.dir },
                        h('span', { className: 'ybt-faint' }, '▸'),
                        h('span', { className: 'ybt-dir-name ybt-mono' }, group.dir),
                        h('span', { className: 'ybt-dir-meta' }, `${group.count} 个 · ${formatBytes(group.bytes) || '—'}`),
                      ),
                    ),
                  )
                : h(
                    'div',
                    { className: 'ybt-card ybt-files' },
                    fileList
                      .filter((file) => categoryOf(file) === shownCategory)
                      .map((file) => {
                        const chapter = hanByPath.get(file.path)
                        // 汉字数只在**正文类文件**上显示：参考文献是书目数据，
                        // 为 0 字是正常的，显示成「0」会被误读为「没写」。
                        const showHan = chapter && chapter.content
                        const title = chapter
                          ? `${file.path}\n\n汉字 ${chapter.han}（含标题）· 正文 ${chapter.hanProse}（不含标题）` +
                            (chapter.content ? '' : '\n（书目/索引类文件，不计正文字数）')
                          : sessionId
                            ? `在右侧栏打开 ${file.path}`
                            : file.path
                        return h(
                          'div',
                          {
                            key: file.path,
                            className: `ybt-file-row${sessionId ? ' ybt-file-click' : ''}`,
                            role: sessionId ? 'button' : undefined,
                            tabIndex: sessionId ? 0 : undefined,
                            title,
                            onClick: sessionId ? () => openFileInSidebar(sessionId, file.path) : undefined,
                            onKeyDown: sessionId
                              ? (event) => {
                                  if (event.key === 'Enter' || event.key === ' ') openFileInSidebar(sessionId, file.path)
                                }
                              : undefined,
                          },
                          h('span', { className: file.category === 'source' ? 'ybt-ok' : 'ybt-faint' }, file.category === 'source' ? '◆' : '·'),
                          h('span', { className: 'ybt-file-row-name ybt-mono' }, file.relative),
                          showHan
                            ? h('span', { className: `ybt-file-row-han${chapter.han ? '' : ' ybt-warn'}` }, `${chapter.han} 字`)
                            : null,
                          h('span', { className: 'ybt-file-row-size' }, formatBytes(file.size) || ''),
                        )
                      }),
                  ),
              h(
                'div',
                { className: 'ybt-note' },
                shownCategory === 'assets'
                  ? '资源按目录聚合；点「正文」看章节与字数。'
                  : '点条目在右侧栏打开；编辑与保存请使用宿主的文件界面。',
              ),
            )
          : null,

        // ── 交付物 ─────────────────────────────────────────────────────────
        deliverables
          ? h(
              'div',
              { className: 'ybt-sec' },
              h('div', { className: 'ybt-htitle' }, '交付物'),
              h(DeliverableCard, {
                title: 'PDF · 版式主输出',
                info: deliverables.pdf,
                onOpen: (path) => {
                  if (openFileInSidebar(sessionId, path)) return
                  // 退路：宿主没有右侧栏服务时，用系统默认程序打开（`file:` 地址）。
                  try {
                    window.open(`file:///${String(path).replace(/\\/g, '/')}`, '_blank')
                  } catch {
                    /* 打开失败不改状态：路径本来就显示在卡片上 */
                  }
                },
              }),
              h(DeliverableCard, { title: 'DOCX · 供继续编辑', info: deliverables.word }),
              // 产物输出名称设置（写项目配置的 deliverables；由点击触发）。
              h(
                'div',
                { className: 'ybt-row-actions' },
                h(
                  'button',
                  {
                    className: 'ybt-btn ybt-btn-plain',
                    type: 'button',
                    onClick: () => {
                      if (!editingNames) {
                        setDraftPdf(deliverables.pdf?.template || '')
                        setDraftWord(deliverables.word?.template || '')
                        setNamesError(null)
                      }
                      setEditingNames((v) => !v)
                    },
                  },
                  editingNames ? '取消' : '✎ 设置输出文件名',
                ),
                namesError ? h('span', { className: 'ybt-note ybt-bad' }, namesError) : null,
              ),
              editingNames
                ? h(
                    'div',
                    { className: 'ybt-card', style: { padding: '8px 10px', gap: '6px', display: 'flex', flexDirection: 'column' } },
                    h('div', { className: 'ybt-note' }, '相对项目目录；可用 {{title}}、{{author}} 等 metadata 字段。'),
                    h('label', { className: 'ybt-note' }, 'PDF'),
                    h('input', {
                      className: 'ybt-input ybt-mono',
                      value: draftPdf,
                      onChange: (event) => setDraftPdf(event.target.value),
                      placeholder: 'build/deliverables/{{title}}.pdf',
                    }),
                    h('label', { className: 'ybt-note' }, 'DOCX'),
                    h('input', {
                      className: 'ybt-input ybt-mono',
                      value: draftWord,
                      onChange: (event) => setDraftWord(event.target.value),
                      placeholder: 'build/deliverables/{{title}}.docx',
                    }),
                    h(
                      'div',
                      { className: 'ybt-row-actions' },
                      h(
                        'button',
                        {
                          className: 'ybt-btn',
                          type: 'button',
                          disabled: savingNames || !draftPdf.trim() || !draftWord.trim(),
                          onClick: () => void saveDeliverableNames(),
                        },
                        savingNames ? '保存中…' : '保存',
                      ),
                      h('span', { className: 'ybt-note' }, '写入 yibinthesis.project.json'),
                    ),
                  )
                : null,
              h(
                'div',
                { className: 'ybt-note ybt-mono ybt-v', title: deliverables.buildRoot },
                `构建根目录：${deliverables.buildRoot}${deliverables.buildRootExists ? '' : '（尚未创建）'}`,
              ),
            )
          : null,

        // ── 工具链 ─────────────────────────────────────────────────────────
        h(
          'div',
          { className: 'ybt-sec' },
          h(
            'div',
            { className: 'ybt-head' },
            h('span', { className: 'ybt-htitle' }, '工具链'),
            h(
              'span',
              { className: 'ybt-dim', style: { fontSize: '12px' } },
              doctor
                ? doctor.ready
                  ? h('span', { className: 'ybt-ok' }, '● 就绪')
                  : h(
                      'span',
                      { className: doctor.kind === 'missing-toolchain' ? 'ybt-warn' : 'ybt-bad' },
                      doctor.kind === 'missing-toolchain' ? '◐ 未就绪' : '○ 检查失败',
                    )
                : h('span', { className: 'ybt-idle' }, '未检查'),
              doctor?.exitCode !== undefined && doctor?.exitCode !== null
                ? h('span', { className: 'ybt-mono ybt-faint' }, `  exit ${doctor.exitCode}`)
                : null,
            ),
          ),
          entries.length
            ? h(
                'div',
                { className: 'ybt-card' },
                entries.map((entry) => h(ToolRow, { entry, key: entry.name })),
              )
            : h('div', { className: 'ybt-empty' }, loading ? '正在检查…' : '点「刷新」检查项目与工具链'),
          doctor && doctor.kind === 'missing-toolchain'
            ? h(
                'div',
                { className: 'ybt-alert ybt-warn' },
                '缺工具时构建会如实失败，不会「部分成功」。Biber 必须是 2.17（配 Tectonic 0.16.9 的 BCF 3.8）。',
              )
            : null,
          doctor?.stdout
            ? h(
                'div',
                null,
                h(
                  'button',
                  { className: 'ybt-btn ybt-btn-plain', type: 'button', onClick: () => setShowLog((v) => !v) },
                  showLog ? '收起原始输出' : '查看原始输出',
                ),
                showLog ? h('pre', { className: 'ybt-pre' }, String(doctor.stdout)) : null,
              )
            : null,
        ),

        // ── 生效配置（默认折叠：诊断信息不该常驻占位）─────────────────────
        h(
          'div',
          { className: 'ybt-sec' },
          h(
            'button',
            { className: 'ybt-btn ybt-btn-plain', type: 'button', style: { alignSelf: 'flex-start' }, onClick: () => setShowConfig((v) => !v) },
            showConfig ? '▾ 生效配置' : '▸ 生效配置',
          ),
          showConfig
            ? h(
                'div',
                { className: 'ybt-card' },
                h(Row, { k: '模板', value: state?.config?.templateRoot || '—', mono: true, title: state?.config?.templateRoot || '' }),
                h(Row, {
                  k: 'CLI',
                  value: state?.config?.cliRoot || '未设置',
                  mono: true,
                  title: state?.config?.cliRoot || '未设置 cliRoot：yibinthesis_new 不可用',
                }),
                h(Row, {
                  k: '工具链',
                  value: (state?.config?.toolchainDirs || []).join(' ; ') || '未设置',
                  mono: true,
                  className: 'ybt-dim',
                }),
              )
            : null,
        ),

        // ── 页脚：只读声明 + 连接状态 ──────────────────────────────────────
        h(
          'div',
          { className: 'ybt-foot' },
          h('span', { className: `ybt-live${connected ? ' on' : bridgeFailed ? ' bad' : ''}` }),
          h('span', { className: 'ybt-note' }, connected ? `${t('state.connected')} v${state.bridgeVersion}` : t('state.connecting')),
          h('span', { className: 'ybt-note ybt-v', style: { textAlign: 'right' } }, '只读 · 构建请让助手发起'),
        ),
      )
    }

    // ── 词典（zh 为事实源；键集必须 zh/en 一致）───────────────────────────
    const zh = {
      'panel.title': '论文工具',
      'panel.tip': 'YibinThesis 论文排版：项目状态 / 工具链 / 交付物',
      'panel.guideDescription': '论文项目状态：题目作者、章节与字数、工具链就绪度、上次构建的交付物',
      'doc.thesis': '毕业论文（设计）',
      'doc.proposal': '开题报告',
      'doc.literatureReview': '文献综述',
      'disc.humanities': '人文社科',
      'disc.science': '理工农医',
      'state.connected': '已连接 host 桥',
      'state.connecting': '正在连接 host 桥…',
    }
    const en = {
      'panel.title': 'Thesis',
      'panel.tip': 'YibinThesis: project status, toolchain, deliverables',
      'panel.guideDescription':
        'Thesis project status: title & author, chapters and length, toolchain readiness, last build outputs',
      'doc.thesis': 'Thesis',
      'doc.proposal': 'Proposal',
      'doc.literatureReview': 'Literature review',
      'disc.humanities': 'Humanities',
      'disc.science': 'Science & engineering',
      'state.connected': 'Connected to host bridge',
      'state.connecting': 'Connecting to host bridge…',
    }

    /**
     * 侧栏标签用的翻译函数。
     *
     * `ctx.locale.bind(ns)` 返回的 `t` 依赖词典已注册；本函数在其不可用时回退到中文，
     * 保证**标签永远不会渲染成空白**（一个没有文字的侧栏按钮等于不存在）。
     * @param key - 词典键。
     * @returns 显示文本。
     */
    let translateNS = null
    function t(key) {
      try {
        if (typeof translateNS === 'function') {
          const value = translateNS(key)
          if (typeof value === 'string' && value) return value
        }
      } catch {
        /* 词典未就绪：走回退 */
      }
      return zh[key] || key
    }

    /**
     * 会话右侧栏标签页的 id 与 kind。
     *
     * 契约（`sidebar.right.pane.tab`）：body 用「该 tab 的 kind 当前生效的 type 的 id」分发，
     * 且 tab type 以自身定义的 `id` 注册。`dsh-context`（同为第三方、同为会话级面板）
     * 实测把 `id` 与 `kind` 都用同一个常量、并让三个注册共用它——
     * 这是最简单也最不容易配错的做法。
     */
    const TAB_ID = 'yibinthesis'
    const TAB_KIND = 'yibinthesis'
    /**
     * guide 卡片在「开始」页里的位置。
     *
     * 参考 `dsh-context` 的取法：它在注释里写明「after the shipped Files entry (order 10)」
     * 并取 20。这里取 60，排在同一批第三方 provider 之后，不抢占靠前位置。
     */
    const TAB_GUIDE_ORDER = 60

    /**
     * 批量释放，释放过程中单个失败不影响其余。
     * @param disposers - 待调用的 disposer 列表。
     */
    function disposeAll(disposers) {
      for (const dispose of disposers) {
        try {
          if (typeof dispose === 'function') dispose()
        } catch {
          /* 卸载期忽略单项失败 */
        }
      }
    }

    /**
     * 论文工具图标。
     *
     * 用 `currentColor` 描边，颜色随宿主主题与选中状态自动变化，不硬编码任何颜色。
     * 图形取「文稿 + 折角」，语义上贴合「论文」。
     *
     * 尺寸同时从 `props.size`（`sidebar.panellist` 的 owner props）与 `props.width`
     * （部分图标座位传 width）读取，取不到时回退 18 —— **绝不能因为拿不到 size 就不渲染**。
     * @param props - `{ size?, width?, active? }`。
     */
    function ThesisIcon(props) {
      const raw = props?.size ?? props?.width
      const size = typeof raw === 'number' && raw > 0 ? raw : 18
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.7,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
          focusable: 'false',
        },
        h('path', { d: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z' }),
        h('path', { d: 'M14 3v5h5' }),
        h('path', { d: 'M9 13h6' }),
        h('path', { d: 'M9 17h4' }),
      )
    }

    /** 阻止点击冒泡（面板宿主可能把点击解释为「收起面板」）。 */
    const stop = (event) => {
      if (event && typeof event.stopPropagation === 'function') event.stopPropagation()
    }

    /** 标签头的标题组件（`sidebar.right.pane.tab.title` 的 owner props 是 `{ t }`）。 */
    function ThesisTabTitle(props) {
      const translate = typeof props?.t === 'function' ? props.t : t
      return h('span', { className: 'ybt-tab-title' }, translate('panel.title'))
    }

    /** 插件主体。 */
    function apply(ctx) {
      // 1) 词典。返回 disposer，交给 ctx.effect 托管。
      ctx.effect(() => {
        const dispose = ctx.locale.register(NS, { zh, en })
        // 绑定命名空间的翻译函数；各处 label/title 都是 thunk，会在每次投影时重新求值，
        // 所以这里晚绑定也能生效（且切换语言时自动跟随）。
        try {
          translateNS = ctx.locale.bind(NS)
        } catch {
          translateNS = null
        }
        return () => {
          translateNS = null
          if (typeof dispose === 'function') dispose()
        }
      }, 'yibinthesis: dictionaries')

      // 1b) 捕获右侧栏服务（`ctx.sidebarRight`）——「点击交付产物在右侧栏打开」要用它。
      //     契约取自 `dsh-context`：`sidebarRight.openResource(address)`，
      //     地址形如 `dsh-resource://file/session/<sessionId>/<path>`。
      //     用 `ctx.inject` 而不是 `ctx.get`：服务可能在 apply 期尚未就绪。
      ctx.effect(() => {
        const dispose = ctx.inject(['sidebarRight'], (scope) => {
          try {
            const face = scope.sidebarRight
            sidebarRightFace = face && typeof face.openResource === 'function' ? face : null
          } catch {
            sidebarRightFace = null
          }
          return () => {
            sidebarRightFace = null
          }
        })
        return () => {
          sidebarRightFace = null
          if (typeof dispose === 'function') dispose()
        }
      }, 'yibinthesis: sidebar-right file opener')

      // 2) **会话右侧栏标签页**（主入口，与「工作区文件 / 上下文 / 新建终端 / 浏览器」并列）。
      //    这是 `dsh-context`（同为第三方插件、同为会话级面板）实测在用的写法：
      //      · `ctx.inject(['sidebarRightTabs'], …)` → `sidebarRightTabs.register({ id, kind, title, guide })`
      //        声明标签条目本身（没有它标签不会出现）；
      //      · 槽位 `sidebar.right.pane.tab`（body）与 `sidebar.right.pane.tab.title`（标签头）
      //        都按**同一个 id** 键控。
      //    三件事都在**同一个 effect** 里注册、失败一起回滚——避免留下半个标签。
      ctx.effect(
        () => {
          let handle = null
          // `ctx.inject` 是延迟注入：等 `sidebarRightTabs` 服务就绪后才执行回调。
          const disposeInject = ctx.inject(['sidebarRightTabs'], (scope) => {
            const disposers = []
            const own = (result) => {
              if (typeof result === 'function') disposers.push(result)
            }
            try {
              const tabs = scope.sidebarRightTabs
              if (tabs === undefined || typeof tabs.register !== 'function') {
                throw new Error('宿主未提供 sidebarRightTabs.register')
              }
              const definition = {
                id: TAB_ID,
                kind: TAB_KIND,
                title: () => t('panel.title'),
                // `guide` **必须给**：右侧栏的标签不是自动出现的——用户要在右侧栏的
                // 「开始 / guide」页里**选一个 provider**，面板才会在旁边打开。
                // `guide` 条目就是这个可选项；没有它，provider 不出现在该页
                // （实机表现：标签条里看不到它）。形状 `{ order, title, description?, icon? }`
                // 取自 `dsh-context` 的实测用法，其注释写明「the guide capsule's position」。
                guide: [
                  {
                    order: TAB_GUIDE_ORDER,
                    title: () => t('panel.title'),
                    description: () => t('panel.guideDescription'),
                    icon: ThesisIcon,
                  },
                ],
              }
              try {
                own(tabs.register(definition))
              } catch {
                // `guide` / `icon` 的 schema 未随包发布；若某版宿主严格拒绝这些键，
                // 退回只有 id/kind/title 的最小形态——**不能**让整个注册失败。
                own(
                  tabs.register({
                    id: TAB_ID,
                    kind: TAB_KIND,
                    title: () => t('panel.title'),
                  }),
                )
              }
              own(
                scope.slots.inject('sidebar.right.pane.tab', () =>
                  scope.slots.register(
                    {
                      name: 'sidebar.right.pane.tab',
                      key: TAB_ID,
                      locale: NS,
                    },
                    // 包一层错误边界：抛错时把原因显示在面板里，而不是留一片空白。
                    // 同时显式传递 `sessionId`——「打开交付产物」需要它构造
                    // `dsh-resource://file/session/<id>/<path>` 地址（槽位 props 里有，
                    // 但错误边界的包装层不会自动透传下去）。
                    (slotProps) =>
                      h(PanelErrorBoundary, null, h(ThesisPanel, { sessionId: slotProps?.sessionId })),
                  ),
                ),
              )
              own(
                scope.slots.inject('sidebar.right.pane.tab.title', () =>
                  scope.slots.register(
                    {
                      name: 'sidebar.right.pane.tab.title',
                      key: TAB_ID,
                    },
                    ThesisTabTitle,
                  ),
                ),
              )
            } catch (error) {
              // 部分注册要回滚，避免留下半个标签。
              disposeAll(disposers)
              throw error
            }
            handle = { dispose: () => disposeAll(disposers) }
            return () => {
              handle?.dispose?.()
              handle = null
            }
          })
          return () => {
            handle?.dispose?.()
            handle = null
            if (typeof disposeInject === 'function') disposeInject()
          }
        },
        'yibinthesis: session right-bar tab',
      )

      // 3) 插件行配置页：同一份面板的备用入口（「已安装」列表里该行的「配置」按钮）。
      //    主入口是右侧栏标签；这里保留是为了在标签被隐藏时仍能看到状态。
      //    keyed 槽位的 key 规则 = `<包名>#<cordis.patch.yml 里的行 id>`。
      ctx.effect(
        () =>
          ctx.slots.inject('plugins.row.config', () =>
            ctx.slots.register(
              {
                name: 'plugins.row.config',
                key: 'yibinthesis-dsh#yibinthesis',
              },
              ThesisPanel,
            ),
          ),
        'yibinthesis: plugins row config panel',
      )
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
