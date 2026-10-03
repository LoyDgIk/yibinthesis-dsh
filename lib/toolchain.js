// 工具链探测与子进程 PATH 组合。
//
// 设计依据（实测，见 docs/ARCHITECTURE.md D3）：
// 上游 `build.ps1` 的 `Find-Executable`（build.ps1:499-562）按以下顺序解析每个外部工具：
//   ① 环境变量 `YIBINTHESIS_*`：先当文件路径，再当命令名（`Get-Command`）；
//   ② 调用方传入的 `-KnownPaths`（**只有 Tectonic 有**，来自 `Get-KnownTectonicPaths`，
//      即 `%USERPROFILE%\.codex\plugins\cache\openai-bundled\latex\*\bin\tectonic.exe`）；
//   ③ `$CommandNames` 在 **PATH** 上 `Get-Command`；
//   ④ 都没有 → `Path = $null`、`Source = 'not found'` → doctor 报 `[MISSING]`。
//
// 结论：Biber 与 Pandoc **只**能通过 ① 或 ③ 命中。故「让工具链可被发现」有两种等效手段，
// 本模块对**已解析到的绝对路径**优先用 env 注入（比 PATH 更确定、不污染其他进程），
// 对**只知道目录**的情况用 PATH 前置（实测有效：注入后 doctor 报
// `[OK] Biber (required) - <...>\.tools\biber-2.17\biber.exe [PATH] | biber version: 2.17`）。
import { existsSync, readdirSync, statSync } from 'node:fs'
import { delimiter, dirname, join } from 'node:path'
import { PACKAGE_TOOLCHAIN_ROOT, TOOLCHAIN_SUBDIRS, resolveFrom } from './env.js'

/** 环境变量名 → 该工具在 `.tools/` 下的候选子目录。 */
const TOOL_ENV = Object.freeze({
  tectonic: 'YIBINTHESIS_TECTONIC',
  biber: 'YIBINTHESIS_BIBER',
  pandoc: 'YIBINTHESIS_PANDOC',
  python: 'YIBINTHESIS_PYTHON',
  latexmk: 'YIBINTHESIS_LATEXMK',
  xelatex: 'YIBINTHESIS_XELATEX',
})

/** 每个工具的可执行文件名（Windows 优先 .exe，其余平台无扩展）。 */
const EXECUTABLE_NAMES = Object.freeze({
  tectonic: ['tectonic.exe', 'tectonic'],
  biber: ['biber.exe', 'biber'],
  pandoc: ['pandoc.exe', 'pandoc'],
  python: ['python.exe', 'python3', 'python'],
  latexmk: ['latexmk.exe', 'latexmk', 'latexmk.pl'],
  xelatex: ['xelatex.exe', 'xelatex'],
})

/**
 * 在给定目录里找一个可执行文件（直接命中或在其一层子目录中命中）。
 * @param dir - 候选目录。
 * @param names - 可执行文件名候选。
 * @returns 命中的绝对路径，或 `null`。
 */
function findExecutableIn(dir, names) {
  if (!dir || !existsSync(dir)) return null
  for (const name of names) {
    const direct = join(dir, name)
    try {
      if (statSync(direct).isFile()) return direct
    } catch {
      /* 不存在或不可访问，继续探测 */
    }
  }
  // 上游 `setup_toolchain.ps1` 把二进制放在 `.tools/<name>-<version>/` 下，
  // 但也允许 `.tools/tectonic/` 直接放；这里再扫一层以覆盖版本化目录。
  let children = []
  try {
    children = readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => join(dir, e.name))
  } catch {
    return null
  }
  for (const child of children) {
    for (const name of names) {
      const candidate = join(child, name)
      try {
        if (statSync(candidate).isFile()) return candidate
      } catch {
        /* 继续 */
      }
    }
    // 再深一层：`.tools/<name>-<ver>/bin/<exe>`
    let grand = []
    try {
      grand = readdirSync(child, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => join(child, e.name))
    } catch {
      continue
    }
    for (const g of grand) {
      for (const name of names) {
        const candidate = join(g, name)
        try {
          if (statSync(candidate).isFile()) return candidate
        } catch {
          /* 继续 */
        }
      }
    }
  }
  return null
}

/**
 * 计算本次调用要注入子进程的工具链环境。
 *
 * 优先级（与文档 D3 一致）：
 * 1. `Config.toolchain` 里按工具名显式给出的路径（最高，运维显式覆盖）；
 * 2. 进程现有 `YIBINTHESIS_*` 环境变量指向的**文件**（尊重操作者）；
 * 3. `Config.toolchainDirs` 显式目录 → 项目 `.tools/` → 插件包 `.tools/`（目录扫描）；
 * 4. 都不命中 → 不注入，交由 `build.ps1` 自己走 PATH 与已知本机缓存。
 *
 * **不**在 4 命中时伪造任何路径：缺失必须由 doctor 如实报出。
 * @param opts - 探测输入。
 * @param opts.projectDir - 论文项目目录（其 `.tools/` 参与探测）。
 * @param opts.toolchainDirs - 额外显式目录（可空）。
 * @param opts.toolchain - 按工具名显式指定的可执行文件路径（可空，相对路径按 projectDir 解析）。
 * @param opts.env - 基础环境变量表（默认 `process.env`）。
 * @param opts.searchPackageTools - 是否把插件包内的 `.tools/` 也作为搜索根。
 *   默认 `true`（生产行为）。**单测必须传 `false`**，否则会命中本机真实的 `.tools/`，
 *   让「只在给定目录里找」的断言失去意义——这是刻意留出的测试接缝，不是产品开关。
 * @returns `{ env, pathEntries, found }`。
 */
export function resolveToolchain({
  projectDir,
  toolchainDirs = [],
  toolchain = {},
  env = process.env,
  searchPackageTools = true,
} = {}) {
  const found = {}
  const pathEntries = []

  // ③ 的目录序列：显式目录 → 项目 .tools → 插件包 .tools。
  const dirRoots = []
  for (const raw of toolchainDirs) {
    const dir = resolveFrom(raw, projectDir)
    if (dir) dirRoots.push(dir)
  }
  if (projectDir) dirRoots.push(join(projectDir, '.tools'))
  if (searchPackageTools) dirRoots.push(PACKAGE_TOOLCHAIN_ROOT)

  for (const tool of Object.keys(TOOL_ENV)) {
    // 1. 显式配置的路径（最高优先级）。
    const explicit = resolveFrom(toolchain?.[tool], projectDir)
    if (explicit && existsSync(explicit)) {
      found[tool] = { path: explicit, source: 'config' }
      continue
    }
    // 2. 进程已有 env（尊重操作者设定）；只在它确实指向文件时采纳。
    const fromEnv = process.env[TOOL_ENV[tool]]
    const envPath = resolveFrom(env?.[TOOL_ENV[tool]], projectDir)
    if (envPath && existsSync(envPath) && statSyncIsFile(envPath)) {
      found[tool] = { path: envPath, source: `env:${TOOL_ENV[tool]}` }
      continue
    }
    // 3. 目录扫描。
    //
    // 顺序很关键：**先**在版本化子目录（如 `.tools/biber-2.17/`）里精确找，
    // **再**退回该目录的递归扫描。理由（实测教训）：目录里可能同时存在多个版本
    // （`biber-2.17` 与 `biber-2.21`），而 `readdirSync` 的顺序不保证；
    // 一旦先命中错版本，doctor 就会报 `[INCOMPATIBLE]`——这本可由精确优先避免。
    const names = EXECUTABLE_NAMES[tool]
    let hit = null
    let hitSource = null
    for (const dir of dirRoots) {
      const source = dir === PACKAGE_TOOLCHAIN_ROOT ? 'package:.tools' : 'dir'
      for (const sub of TOOLCHAIN_SUBDIRS[tool] || []) {
        const tuned = findExecutableIn(join(dir, sub), names)
        if (tuned) {
          hit = tuned
          hitSource = source
          break
        }
      }
      if (hit) break
    }
    if (!hit) {
      for (const dir of dirRoots) {
        const candidate = findExecutableIn(dir, names)
        if (candidate) {
          hit = candidate
          hitSource = dir === PACKAGE_TOOLCHAIN_ROOT ? 'package:.tools' : 'dir'
          break
        }
      }
    }
    if (hit) found[tool] = { path: hit, source: hitSource }
  }

  // env 注入：把解析到的绝对路径写进 YIBINTHESIS_*（等价于操作者手工设置，语义最确定）。
  const injectedEnv = {}
  for (const [tool, info] of Object.entries(found)) {
    injectedEnv[TOOL_ENV[tool]] = info.path
  }

  // PATH 组合：即使 env 注入已覆盖，仍把命中目录前置，使 `Get-Command <name>` 也能命中
  // （build.ps1 的 doctor 用命令名探测，且用户可能在构建脚本里调用裸命令）。
  const seen = new Set()
  for (const info of Object.values(found)) {
    // 必须用 `dirname` 而不是 `join(path, '..')`：后者**不做规范化**，
    // 会得到 `C:\...\python.exe\..` 这种非法目录项，前置进 PATH 后毫无作用。
    const dir = dirname(info.path)
    if (seen.has(dir.toLowerCase())) continue
    seen.add(dir.toLowerCase())
    pathEntries.push(dir)
  }

  return { env: injectedEnv, pathEntries, found }
}

/**
 * 读 `statSync` 是否为普通文件（容错版）。
 * @param path - 待检查路径。
 * @returns 是否为文件。
 */
function statSyncIsFile(path) {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

/**
 * 把 PATH 前置项拼成新的 PATH 值（大小写不敏感去重，保留原值在后）。
 *
 * 去重必须**双向**：前置项内部去重，且前置项与基础 PATH 之间也要去重。
 * 只做前者的后果是同一个目录在结果里出现两次（例如前置了 `C:\Windows`
 * 而基础 PATH 里本来就有），PATH 越长越容易触发 Windows 的变量长度上限。
 * @param pathEntries - 要前置的目录。
 * @param basePath - 原始 PATH。
 * @returns 组合后的 PATH。
 */
export function composePath(pathEntries, basePath) {
  const parts = []
  const seen = new Set()
  const push = (entry) => {
    if (!entry) return
    const key = entry.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    parts.push(entry)
  }
  for (const entry of pathEntries) push(entry)
  for (const entry of String(basePath || '').split(delimiter)) push(entry)
  return parts.join(delimiter)
}
