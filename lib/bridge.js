// host ↔ client 的 HTTP 桥：把项目摘要、工具链状态与交付物清单暴露给 Web GUI 面板。
//
// 设计约束（重要）：本模块**只读**。面板刻意不提供「点一下构建」这类写盘动作——
// 通过 Web 路由触发任意构建会把权限面开得过大（任何能访问该端口的页面都能让宿主写盘）。
// 构建/脚手架一律由助手经 `yibinthesis_build` / `yibinthesis_new` 原生工具发起，
// 走正常的工具审批与取消链路。
//
// 为什么走 HTTP 而不是正式 RPC：DSH 的 Typert Remote 边面是**构建期固化**的，
// 客户端不做运行时服务发现，第三方插件**无法自行新增 Remote namespace**。
// 已验证的第三方替代通道是「host 用 `webServer.register` 注册路由 + 客户端 `fetch`」
// ——本机 `dsh-free-search`（`lib/index.js:2794-2811`）与 `dsh-status-rotator` 都实测在用。
//
// ⚠️ 已知的未证实点（见 research/contracts.md §F.2）：`webServer.register` 的正式类型声明
//   没有随包发布，`{ kind: 'exact', path, handler }` 是从两个真实插件的用法归纳出来的。
//   因此本模块**全程防御**：注册失败只降级（面板显示不可用），绝不让插件加载失败。
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { ADAPTER_SCRIPT, PROJECT_CONFIG_NAME } from './env.js'
import { runAdapter, runBuilder } from './runner.js'

/** 桥的路径前缀。用独立命名空间，避免与宿主或其它插件冲突。 */
export const BRIDGE_PREFIX = '/api/yibinthesis'

/**
 * 桥对外暴露的**全部路由**（面板与宿主自检共用这一份清单）。
 *
 * 单独导出而不是散落在 `makeBridgeRoutes` 里，是为了让宿主自检能如实报出
 * 「应该存在哪些路由」——面板报 404 时，这份清单是区分「桥没挂上」与
 * 「路由写错了」的直接依据。
 *
 * 其中 `/deliverables` 支持写（POST，设置产物输出名称）；其余一律只读 GET。
 */
export const BRIDGE_ROUTES = Object.freeze(['/state', '/probe', '/deliverables', '/files', '/doctor'])

/** 桥里允许写操作的路由（其余一律只读）。 */
export const BRIDGE_WRITE_ROUTES = Object.freeze(['/deliverables'])

/** 桥接口的版本；客户端据此判断兼容性，避免旧面板读新字段。 */
export const BRIDGE_VERSION = 2

/**
 * 写 JSON 响应（含客户端已断开时的保护）。
 *
 * 保护的必要性：面板可能被快速刷新/关闭，此时 `res` 已结束，写入会抛
 * `ERR_STREAM_WRITE_AFTER_END`——在 host 进程里就是一个未捕获异常。
 * @param res - Node ServerResponse。
 * @param status - HTTP 状态码。
 * @param payload - 要序列化的对象。
 */
function writeJson(res, status, payload) {
  if (res.writableEnded || res.destroyed) return
  let body
  try {
    body = JSON.stringify(payload)
  } catch (error) {
    body = JSON.stringify({ ok: false, error: { kind: 'serialize-failed', message: String(error?.message || error) } })
    status = 500
  }
  try {
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    })
    res.end(body)
  } catch {
    /* 客户端已断开：无需再报告，桥不是关键路径 */
  }
}

/**
 * 只接受指定方法的守卫。
 * @param req - Node IncomingMessage。
 * @param res - Node ServerResponse。
 * @param methods - 允许的方法集。
 * @returns 是否继续处理。
 */
function guard(req, res, methods) {
  const method = (req.method || 'GET').toUpperCase()
  if (!methods.includes(method)) {
    writeJson(res, 405, { ok: false, error: { kind: 'method-not-allowed', message: `不支持的方法：${method}` } })
    return false
  }
  return true
}

/**
 * 读取并解析 JSON 请求体（有大小上限）。
 * @param req - Node IncomingMessage。
 * @param maxBytes - 上限字节数。
 * @returns 解析出的对象，或 `null`（非法/超限）。
 */
export function readJsonBody(req, maxBytes = 64 * 1024) {
  return new Promise((resolvePromise) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > maxBytes) {
        resolvePromise(null)
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8').trim()
      if (!text) {
        resolvePromise({})
        return
      }
      try {
        const parsed = JSON.parse(text)
        resolvePromise(parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null)
      } catch {
        resolvePromise(null)
      }
    })
    req.on('error', () => resolvePromise(null))
  })
}

/**
 * 读一个文件的元信息（只读；不存在或不可访问时返回 `exists: false`）。
 *
 * `size`/`mtimeMs` 存在的意义：面板要让用户看到「上次构建的东西在哪、多大、什么时候出的」，
 * 而不是只显示一个路径。
 * @param path - 绝对路径。
 * @returns `{ path, exists, size?, mtimeMs?, error? }`。
 */
export function statFile(path) {
  try {
    const info = statSync(path)
    if (!info.isFile()) return { path, exists: false }
    return { path, exists: true, size: info.size, mtimeMs: info.mtimeMs }
  } catch {
    return { path, exists: false }
  }
}

/**
 * 从项目配置里推导交付物路径（**不**做完整的占位符展开，只在字面量无占位符时判定）。
 *
 * 为什么不在 Node 侧重实现占位符展开：那是上游 `build.ps1` 与适配器的职责，
 * 在这里复制一份会漂移。面板显示的是「配置里声明的交付路径」+「该文件是否已存在」；
 * 若配置里带 `{{title}}` 之类占位符，则如实标注 `hasPlaceholders: true` 让用户知道
 * 需要以构建器的实际产物为准。
 * @param configRoot - 项目配置所在目录。
 * @param template - 配置里的交付路径模板。
 * @returns `{ template, resolved, hasPlaceholders, exists, size, mtimeMs }`。
 */
export function describeDeliverable(configRoot, template) {
  if (typeof template !== 'string' || !template.trim()) {
    return { template: null, resolved: null, hasPlaceholders: false, exists: false, size: null, mtimeMs: null }
  }
  const hasPlaceholders = /\{\{[^}]+\}\}/.test(template)
  if (hasPlaceholders) {
    return { template, resolved: null, hasPlaceholders: true, exists: false, size: null, mtimeMs: null }
  }
  const absolute = isAbsolute(template) ? template : resolve(configRoot, template)
  const info = statFile(absolute)
  return {
    template,
    resolved: absolute,
    hasPlaceholders: false,
    exists: info.exists,
    size: info.exists ? info.size : null,
    mtimeMs: info.exists ? info.mtimeMs : null,
  }
}

/**
 * 读取项目配置并派生「构建根目录」（只读，容错）。
 * @param projectDir - 项目目录。
 * @returns `{ ok, configPath, config, configRoot, buildRoot, error? }`。
 */
export function readProjectConfig(projectDir) {
  const configPath = join(projectDir, PROJECT_CONFIG_NAME)
  let raw
  try {
    raw = readFileSync(configPath, 'utf8')
  } catch (error) {
    return { ok: false, configPath, error: { kind: 'project-invalid', message: `读不到项目配置：${configPath}（${error?.code || error?.message}）` } }
  }
  let config
  try {
    config = JSON.parse(raw)
  } catch (error) {
    return { ok: false, configPath, error: { kind: 'project-invalid', message: `项目配置不是合法 JSON：${configPath}` } }
  }
  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    return { ok: false, configPath, error: { kind: 'project-invalid', message: '项目配置必须是 JSON 对象' } }
  }
  const configRoot = resolve(configPath, '..')
  const outputRootRaw = typeof config.outputRoot === 'string' && config.outputRoot.trim() ? config.outputRoot : 'build'
  const buildRoot = isAbsolute(outputRootRaw) ? outputRootRaw : resolve(configRoot, outputRootRaw)
  return { ok: true, configPath, configRoot, config, buildRoot }
}

/**
 * 校验并规范化「交付文件名模板」。
 *
 * 判据来自上游 `yibinthesis.project.schema.json` 与 `build.ps1`：
 * · PDF 必须 `.pdf`、Word 必须 `.docx`（schema 的 `pattern`）；
 * · 路径相对**配置文件所在目录**解析（上游 `Get-FullPath -BasePath $ConfigRoot`）；
 * · 允许 `{{field}}` 占位符（由构建器用 metadata 字段展开）。
 *
 * 刻意**拒绝绝对路径**：交付路径写死盘符会让项目在换机后失效，
 * 而 schema 的语义是「相对于配置文件目录」。
 * @param value - 用户输入。
 * @param extension - 要求的扩展名（`.pdf` / `.docx`）。
 * @returns `{ ok: true, value }` 或 `{ ok: false, message }`。
 */
export function validateDeliverableTemplate(value, extension) {
  if (typeof value !== 'string' || !value.trim()) {
    return { ok: false, message: '不能为空' }
  }
  const trimmed = value.trim()
  if (/^([A-Za-z]:[\\/]|\\\\|\/)/.test(trimmed)) {
    return { ok: false, message: '必须是相对于项目配置文件的路径，不能用绝对路径' }
  }
  if (!trimmed.toLowerCase().endsWith(extension)) {
    return { ok: false, message: `必须以 ${extension} 结尾` }
  }
  if (trimmed.includes('..')) {
    return { ok: false, message: '路径不得包含 “..”' }
  }
  // 占位符只允许 `{{name}}` 形态，name 为 metadata 字段名（小写字母/数字/连字符）。
  const placeholders = trimmed.match(/\{\{[^}]*\}\}/g) || []
  for (const token of placeholders) {
    if (!/^\{\{[a-z][a-z0-9-]*\}\}$/.test(token)) {
      return { ok: false, message: `占位符格式不对：${token}（应形如 {{title}}）` }
    }
  }
  return { ok: true, value: trimmed }
}

/**
 * 把改动写回项目配置，**只改 `deliverables`**，其余键与顺序保持不变。
 *
 * 为什么不用「读出来整体重写」：`yibinthesis.project.json` 是用户的项目文件，
 * 里面可能有 `$schema` 之类我们不该动的东西；只做**键级替换**能把影响面压到最小。
 * 写入用 UTF-8 **无 BOM**，与上游 `build.ps1`（`Set-Content -Encoding UTF8`）及
 * 本包其它产物保持一致。
 * @param configPath - 项目配置路径。
 * @param patch - `{ pdf?, word? }`。
 * @returns `{ ok: true }` 或 `{ ok: false, error }`。
 */
export function writeDeliverables(configPath, patch) {
  let raw
  try {
    raw = readFileSync(configPath, 'utf8')
  } catch (error) {
    return { ok: false, error: { kind: 'project-invalid', message: `读不到项目配置：${configPath}` } }
  }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ok: false, error: { kind: 'project-invalid', message: '项目配置不是合法 JSON，拒绝改写' } }
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: { kind: 'project-invalid', message: '项目配置必须是 JSON 对象' } }
  }
  const next = { ...parsed, deliverables: { ...(parsed.deliverables || {}) } }
  if (patch.pdf !== undefined) next.deliverables.pdf = patch.pdf
  if (patch.word !== undefined) next.deliverables.word = patch.word
  try {
    writeFileSync(configPath, JSON.stringify(next, null, 2) + '\n', 'utf8')
  } catch (error) {
    return { ok: false, error: { kind: 'write-failed', message: `写盘失败：${error?.message || error}` } }
  }
  return { ok: true, value: next.deliverables }
}

/**
 * 论文项目的文件分类。
 *
 * 为什么必须分类（实测）：一个真实的论文项目有 **147 个文件**——`latex/` 66（其中
 * `latex/assets/` 就占 52 张图）、`图表资源/` 44、`plan/` 26、`tmp/` 10。混成一个列表时，
 * 正文（13 个 `.tex`）会被上百个资源与分析中间件淹没，用户反馈「资产目录和正文混在一起」。
 *
 * 分类依据是**用途**而不是扩展名，因为同一扩展名可能用途不同（`latex/assets/` 里的
 * `.tex` 片段也不是正文）。
 */
export const FILE_CATEGORIES = Object.freeze(['source', 'assets', 'data', 'docs', 'other'])

/** 分类的中文标签（面板直接显示，故放在这里与分类同源）。 */
export const FILE_CATEGORY_LABELS = Object.freeze({
  source: '正文',
  assets: '资源',
  data: '数据',
  docs: '文档',
  other: '其他',
})

/** 书目 / 配置类文件的扩展名。 */
const DATA_EXTENSIONS = new Set(['.bib', '.json', '.yaml', '.yml', '.toml', '.csv'])

/** 图片 / 字体 / 压缩包等资源类文件的扩展名（扩展名兜底用）。 */
const ASSET_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tif', '.tiff', '.svg', '.eps',
  '.pdf', '.ps', '.ttf', '.otf', '.woff', '.woff2', '.zip', '.7z',
])

/**
 * 目录名 → 分类。中文项目里资源目录常直接叫「图表资源」而不是 `assets`，
 * 只靠扩展名会把 `.md` 分析笔记混进资源，故按目录名再做一层判定。
 */
const ASSET_DIR_NAMES = new Set([
  'assets', 'asset', 'figures', 'figure', 'figs', 'fig', 'images', 'image', 'img',
  '图表资源', '图片', '图', '素材', '插图',
])
const DATA_DIR_NAMES = new Set(['data', 'dataset', 'datasets', '数据', '原始数据'])
const DOC_DIR_NAMES = new Set(['docs', 'doc', 'plan', 'plans', 'notes', '文档', '计划', '笔记'])

/** Office 的锁定残留文件形如 `~$论文.docx`（Word 异常退出后留下），不是项目内容。 */
const LOCK_FILE_RE = /^~\$/

/**
 * 该文件是否为应忽略的临时/锁定文件。
 * @param name - 文件名。
 * @returns 是否忽略。
 */
export function isIgnorableProjectFile(name) {
  return LOCK_FILE_RE.test(String(name))
}

/**
 * 判定一个项目内相对路径属于哪一类。
 *
 * 判据（按优先级）：
 * 1. `latex/` 下**不在**资源目录里的 `.tex` → `source`（这是真正要写的论文正文）；
 * 2. 落在资源目录（`assets`/`figures`/`图表资源`/…）或扩展名是图片/字体 → `assets`；
 * 3. 落在数据目录或扩展名是书目/配置 → `data`；
 * 4. 落在文档目录或扩展名是 `.md`/`.txt`/`.rst` → `docs`；
 * 5. 其余 → `other`。
 *
 * @param relative - 项目内相对路径（`/` 分隔）。
 * @returns 分类键（见 `FILE_CATEGORIES`）。
 */
export function categorizeProjectFile(relative) {
  const path = String(relative).replace(/\\/g, '/')
  const lower = path.toLowerCase()
  const dot = lower.lastIndexOf('.')
  const extension = dot >= 0 ? lower.slice(dot) : ''
  const segments = lower.split('/')
  const base = segments[segments.length - 1] || ''
  // 目录段（不含文件名本身）。
  const dirs = segments.slice(0, -1)

  const inAssetDir = dirs.some((segment) => ASSET_DIR_NAMES.has(segment))
  const inDataDir = dirs.some((segment) => DATA_DIR_NAMES.has(segment))
  const inDocDir = dirs.some((segment) => DOC_DIR_NAMES.has(segment))
  const underLatex = segments[0] === 'latex'

  // 目录名优先于扩展名：`图表资源/x.md` 是资源目录里的笔记，按资源归类。
  if (inAssetDir) return 'assets'
  if (underLatex && extension === '.tex') return 'source'
  if (ASSET_EXTENSIONS.has(extension)) return 'assets'
  if (inDataDir || DATA_EXTENSIONS.has(extension)) return 'data'
  if (inDocDir || extension === '.md' || extension === '.txt' || extension === '.rst' || base === 'readme') return 'docs'
  return 'other'
}

/**
 * 列出项目里的论文源文件（只读，**不**进入构建产物目录）。
 *
 * 每个文件带 `category`（见 `categorizeProjectFile`），调用方据此分组展示。
 * 排序：正文优先，然后按相对路径字典序。
 * 上限 800 条——面板是给人看的清单，不是文件管理器；超出时如实回报 `truncated`。
 * @param projectDir - 项目根目录。
 * @param buildRoot - 构建输出根目录（整棵跳过）。
 * @returns `{ files, categories, truncated, skippedDirs }`。
 */
export function listProjectFiles(projectDir, buildRoot) {
  const MAX_FILES = 800
  const SKIP_DIRS = new Set(['.git', 'node_modules', '__pycache__', '.vscode', '.idea'])
  const buildRootNorm = typeof buildRoot === 'string' ? resolve(buildRoot) : null
  const files = []
  let truncated = false
  const skippedDirs = []

  /** 递归遍历（深度优先，目录名序）。 */
  const walk = (dir, depth) => {
    if (truncated || depth > 8) return
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (truncated) return
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue
        if (buildRootNorm && resolve(full) === buildRootNorm) {
          skippedDirs.push(full)
          continue
        }
        walk(full, depth + 1)
        continue
      }
      if (!entry.isFile()) continue
      // Office 锁定残留（`~$xxx.docx`）等噪声不进清单。
      if (isIgnorableProjectFile(entry.name)) continue
      if (files.length >= MAX_FILES) {
        truncated = true
        return
      }
      let size = null
      try {
        size = statSync(full).size
      } catch {
        size = null
      }
      const relative = full.slice(projectDir.length + 1).replace(/\\/g, '/')
      const category = categorizeProjectFile(relative)
      files.push({
        path: full,
        relative,
        name: entry.name,
        size,
        category,
        // 兼容字段：面板早期用 `source` 布尔值排序；保留以免旧客户端读不到。
        source: category === 'source',
      })
    }
  }

  walk(projectDir, 0)
  files.sort((a, b) => {
    const rank = (file) => FILE_CATEGORIES.indexOf(file.category)
    if (rank(a) !== rank(b)) return rank(a) - rank(b)
    return a.relative.localeCompare(b.relative)
  })

  // 逐类计数（面板标签页上的数字直接用这份，避免前端重复统计）。
  const categories = {}
  for (const key of FILE_CATEGORIES) categories[key] = 0
  for (const file of files) categories[file.category] = (categories[file.category] || 0) + 1

  return { files, categories, truncated, skippedDirs, total: files.length }
}

/**
 * 组装桥的全部路由。
 *
 * 除 `/deliverables` 的 POST（设置产物输出名称）外全部为 **只读 GET**。
 * 任何一步失败都返回 `{ ok: false, error: { kind, message } }`，不抛给 HTTP 层。
 * @param opts - 依赖与配置。
 * @param opts.config - 已规范化的插件配置。
 * @param opts.runBuilderImpl - 可注入的构建器执行器（单测用）。
 * @param opts.runAdapterImpl - 可注入的适配器执行器（单测用）。
 * @param opts.adapterScript - 适配器脚本路径（单测用）。
 * @returns 路由数组（每项 `{ kind, path, handler }`）。
 */
export function makeBridgeRoutes({
  config,
  runBuilderImpl = runBuilder,
  runAdapterImpl = runAdapter,
  adapterScript = ADAPTER_SCRIPT,
} = {}) {

  /** 选项目录：请求参数 > 插件配置 defaultProjectDir。**不**回落到 cwd（见 config.js）。 */
  const pickProjectDir = (explicit) => {
    const candidate = typeof explicit === 'string' && explicit.trim() ? explicit.trim() : config?.defaultProjectDir
    return candidate && String(candidate).trim() ? String(candidate).trim() : null
  }

  /** 统一的「取项目目录并校验」前置。校验失败时已写好响应并返回 `null`。 */
  const requireProject = (req, res, url) => {
    const projectDir = pickProjectDir(url.searchParams.get('projectDir'))
    if (!projectDir) {
      writeJson(res, 400, {
        ok: false,
        error: {
          kind: 'no-project',
          message: '未指定论文项目目录：请在插件配置里设置 defaultProjectDir，或带上 ?projectDir= 查询参数。',
        },
      })
      return null
    }
    if (!existsSync(join(projectDir, PROJECT_CONFIG_NAME))) {
      writeJson(res, 400, {
        ok: false,
        error: { kind: 'no-project', message: `目录里没有 ${PROJECT_CONFIG_NAME}：${projectDir}` },
      })
      return null
    }
    return projectDir
  }

  /**
   * 组装 `/state` 的响应。
   *
   * `projectDir` 为 `null` 时 `project.hasConfig` 一律为 `false`——这是**如实**的：
   * 面板还没选定项目，自然谈不上「该目录有没有配置」。客户端必须把当前项目目录
   * 作为 `?projectDir=` 传进来，否则会显示「✗ 该目录没有 yibinthesis.project.json」
   * 而摘要区却读到了内容（实测过的自相矛盾状态）。
   * @param projectDir - 面板当前选定的项目目录，或 `null`。
   * @returns `/state` 响应体。
   */
  const describeState = (projectDir) => ({
    ok: true,
    bridgeVersion: BRIDGE_VERSION,
    plugin: { name: 'yibinthesis-dsh' },
    readOnly: true,
    config: {
      // 只回可以安全展示的配置；不泄露任何凭据（本插件也没有凭据）。
      templateRoot: config?.templateRoot ?? null,
      cliRoot: config?.cliRoot ?? null,
      defaultProjectDir: config?.defaultProjectDir ?? null,
      toolchainDirs: config?.toolchainDirs ?? [],
      toolchain: config?.toolchain ?? {},
      buildTimeoutMs: config?.buildTimeoutMs ?? null,
      maxLogBytes: config?.maxLogBytes ?? null,
      pythonPath: config?.pythonPath ?? null,
    },
    project: projectDir
      ? {
          dir: projectDir,
          hasConfig: existsSync(join(projectDir, PROJECT_CONFIG_NAME)),
          configName: PROJECT_CONFIG_NAME,
        }
      : { dir: null, hasConfig: false, configName: PROJECT_CONFIG_NAME },
  })

  return [
    // ── /state：插件配置 + 项目是否存在（秒级，面板首屏用）──────────────────
    {
      kind: 'exact',
      path: `${BRIDGE_PREFIX}/state`,
      handler: async (req, res) => {
        if (!guard(req, res, ['GET'])) return
        const url = new URL(req.url || '/', 'http://localhost')
        writeJson(res, 200, describeState(pickProjectDir(url.searchParams.get('projectDir'))))
      },
    },

    // ── /probe：结构化项目摘要（走随包 Python 适配器，只读）──────────────────
    {
      kind: 'exact',
      path: `${BRIDGE_PREFIX}/probe`,
      handler: async (req, res) => {
        if (!guard(req, res, ['GET'])) return
        const url = new URL(req.url || '/', 'http://localhost')
        const projectDir = requireProject(req, res, url)
        if (!projectDir) return

        const result = await runAdapterImpl({
          pythonPath: config?.pythonPath,
          scriptPath: adapterScript,
          args: ['probe', '--project-dir', projectDir],
          projectDir,
          templateRoot: config?.templateRoot,
          toolchainDirs: config?.toolchainDirs,
          toolchain: config?.toolchain,
          maxLogBytes: config?.maxLogBytes,
        })
        if (!result.ok) {
          const error = result.value?.error || result.error || { kind: 'probe-failed', message: '适配器未返回项目摘要' }
          writeJson(res, 200, { ok: false, error })
          return
        }
        writeJson(res, 200, result.value)
      },
    },

    // ── /deliverables：交付物清单（GET）与**产物名称设置**（POST）──────────
    {
      kind: 'exact',
      path: `${BRIDGE_PREFIX}/deliverables`,
      handler: async (req, res) => {
        const method = (req.method || 'GET').toUpperCase()
        if (!guard(req, res, ['GET', 'POST'])) return
        const url = new URL(req.url || '/', 'http://localhost')

        if (method === 'POST') {
          const body = await readJsonBody(req)
          if (body === null) {
            writeJson(res, 400, { ok: false, error: { kind: 'invalid-body', message: '请求体不是合法 JSON' } })
            return
          }
          const projectDir = pickProjectDir(body.projectDir)
          if (!projectDir || !existsSync(join(projectDir, PROJECT_CONFIG_NAME))) {
            writeJson(res, 400, {
              ok: false,
              error: { kind: 'no-project', message: `项目目录无效或缺少 ${PROJECT_CONFIG_NAME}：${projectDir || '(未指定)'}` },
            })
            return
          }
          const patch = {}
          if (body.pdf !== undefined) {
            const checked = validateDeliverableTemplate(body.pdf, '.pdf')
            if (!checked.ok) {
              writeJson(res, 400, { ok: false, error: { kind: 'invalid-template', field: 'pdf', message: `PDF 交付路径无效：${checked.message}` } })
              return
            }
            patch.pdf = checked.value
          }
          if (body.word !== undefined) {
            const checked = validateDeliverableTemplate(body.word, '.docx')
            if (!checked.ok) {
              writeJson(res, 400, { ok: false, error: { kind: 'invalid-template', field: 'word', message: `DOCX 交付路径无效：${checked.message}` } })
              return
            }
            patch.word = checked.value
          }
          if (Object.keys(patch).length === 0) {
            writeJson(res, 400, { ok: false, error: { kind: 'nothing-to-do', message: '未提供 pdf / word 中的任何一项' } })
            return
          }
          const written = writeDeliverables(join(projectDir, PROJECT_CONFIG_NAME), patch)
          if (!written.ok) {
            writeJson(res, 200, { ok: false, error: written.error })
            return
          }
          // 回读一遍，把**写盘后**的真实状态交给面板（不靠本地推断）。
          const read = readProjectConfig(projectDir)
          writeJson(res, 200, {
            ok: true,
            saved: written.value,
            projectDir,
            buildRoot: read.ok ? read.buildRoot : null,
            buildRootExists: read.ok ? existsSync(read.buildRoot) : false,
            pdf: read.ok ? describeDeliverable(read.configRoot, read.config.deliverables?.pdf) : null,
            word: read.ok ? describeDeliverable(read.configRoot, read.config.deliverables?.word) : null,
          })
          return
        }

        const projectDir = requireProject(req, res, url)
        if (!projectDir) return

        const read = readProjectConfig(projectDir)
        if (!read.ok) {
          writeJson(res, 200, { ok: false, error: read.error })
          return
        }
        const deliverables = read.config.deliverables && typeof read.config.deliverables === 'object' ? read.config.deliverables : {}
        writeJson(res, 200, {
          ok: true,
          projectDir,
          buildRoot: read.buildRoot,
          buildRootExists: existsSync(read.buildRoot),
          pdf: describeDeliverable(read.configRoot, deliverables.pdf),
          word: describeDeliverable(read.configRoot, deliverables.word),
        })
      },
    },

    // ── /files：列出项目里的文件（只读）────────────────────────────────────
    //
    // 用途：面板给出「论文源文件」清单，点条目即在右侧栏预览。
    // **只列不改**：写盘一律交给宿主自己的编辑界面，面板不成为第二条写路径。
    //
    // 过滤：跳过 `build/`（构建产物，噪声）与 `.git/`；只列常规文件；
    // 结果带上相对路径、字节数、是否在 `latex/` 下（决定排序优先级），并设条目上限。
    {
      kind: 'exact',
      path: `${BRIDGE_PREFIX}/files`,
      handler: async (req, res) => {
        if (!guard(req, res, ['GET'])) return
        const url = new URL(req.url || '/', 'http://localhost')
        const projectDir = requireProject(req, res, url)
        if (!projectDir) return

        const read = readProjectConfig(projectDir)
        if (!read.ok) {
          writeJson(res, 200, { ok: false, error: read.error })
          return
        }
        try {
          const listing = listProjectFiles(projectDir, read.buildRoot)
          writeJson(res, 200, { ok: true, projectDir, ...listing })
        } catch (error) {
          writeJson(res, 200, { ok: false, error: { kind: 'files-failed', message: String(error?.message || error) } })
        }
      },
    },

    // ── /doctor：工具链就绪度（跑 build.ps1 doctor，只读）───────────────────
    {
      kind: 'exact',
      path: `${BRIDGE_PREFIX}/doctor`,
      handler: async (req, res) => {
        if (!guard(req, res, ['GET'])) return
        const url = new URL(req.url || '/', 'http://localhost')
        const projectDir = requireProject(req, res, url)
        if (!projectDir) return

        // doctor 只读且通常秒级；给一个比构建短得多的预算，避免面板长时间挂起。
        const result = await runBuilderImpl({
          command: 'doctor',
          configPath: join(projectDir, PROJECT_CONFIG_NAME),
          templateRoot: config?.templateRoot,
          projectDir,
          toolchainDirs: config?.toolchainDirs,
          toolchain: config?.toolchain,
          timeoutMs: Math.min(config?.buildTimeoutMs ?? 120000, 120000),
          maxLogBytes: config?.maxLogBytes,
        })
        // 退出码语义（build.ps1:1279-1284）：0 = READY，2 = 工具链未就绪，其余 = 真失败。
        const ready = result.exitCode === 0
        writeJson(res, 200, {
          ok: result.exitCode === 0 || result.exitCode === 2,
          ready,
          exitCode: result.exitCode,
          kind: ready ? null : result.exitCode === 2 ? 'missing-toolchain' : result.kind || 'build-failed',
          message: ready ? null : result.exitCode === 2 ? '工具链未就绪' : result.message || null,
          stdout: (result.stdout || '').slice(-12000),
          stderr: (result.stderr || '').slice(-4000),
          truncated: Boolean(result.truncated),
        })
      },
    },
  ]
}

/**
 * 把桥挂到宿主的 `webServer` 服务上。
 *
 * **全程防御**：任何一步失败都只返回「未挂载」的说明，绝不抛——桥只是面板的数据源，
 * 它不可用时技能与原生工具必须照常工作。
 * @param ctx - 插件 ctx。
 * @param opts - 见 {@link makeBridgeRoutes}。
 * @returns `{ mounted: boolean, reason?: string, disposers: Array<() => void> }`。
 */
export function mountBridge(ctx, opts = {}) {
  let webServer = null
  try {
    webServer = typeof ctx?.get === 'function' ? ctx.get('webServer') : null
  } catch {
    webServer = null
  }
  if (!webServer) {
    try {
      webServer = ctx?.webServer || null
    } catch {
      webServer = null
    }
  }
  if (!webServer || typeof webServer.register !== 'function') {
    return { mounted: false, reason: '宿主未提供 webServer 服务', disposers: [] }
  }
  const disposers = []
  try {
    for (const route of makeBridgeRoutes(opts)) {
      const dispose = webServer.register(route)
      if (typeof dispose === 'function') disposers.push(dispose)
    }
  } catch (error) {
    // 已注册成功的部分要回滚，避免留下半个桥。
    for (const dispose of disposers) {
      try {
        dispose()
      } catch {
        /* 忽略：正在降级 */
      }
    }
    return { mounted: false, reason: `webServer.register 失败：${error?.message || error}`, disposers: [] }
  }
  return { mounted: true, disposers }
}
