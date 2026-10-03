// 插件配置：零依赖的 standard-schema v1 实现。
//
// 为什么手写而不 import `@deepseek-ai/schemastery`（实测教训，见 docs/ARCHITECTURE.md D5）：
// 本机 `%USERPROFILE%\.dsh\profiles\node_modules\@deepseek-ai\*` 全是指向
// **已不存在路径**的 junction（真实安装目录已从 `DSH Desktop` 改名为 `dsh`）。
// 静态 import 或动态 import 宿主包都可能在 pnpm 布局下解析失败；而 Cordis 实际只需要
// `Config['~standard'].validate(config)` 这一个接口，返回 `{ value }` 或 `{ issues }`。
//
// 行为契约：**非法配置在加载期响亮失败**，不静默回落默认值。
// 「配置被静默丢弃」是本生态里反复出现的缺陷形态，本模块刻意与之相反。
import { VENDOR_TEMPLATE_ROOT, resolveFrom } from './env.js'

/** 令牌类型：'boolean' | 'string' | 'positive' | 'enum' | 'string-list'。 */
const CONFIG_SPEC = Object.freeze({
  templateRoot: {
    kind: 'string',
    def: VENDOR_TEMPLATE_ROOT,
    why: 'YibinThesis 模板运行时根（须含 build.ps1 与 lib/build_word.py）。默认用随包副本；指向你自己的上游检出可跟随上游更新。',
  },
  cliRoot: {
    kind: 'string',
    def: null,
    why: '上游 YibinThesis 检出根（提供 lib/yibinthesis_cli）。只有 yibinthesis_new 需要它；不设置时该工具会如实报告缺失而不是复制一份会漂移的脚手架实现。',
  },
  pythonPath: {
    kind: 'string',
    def: null,
    why: '用于跑适配器的 Python 解释器。留空则在 PATH 上找 python。',
  },
  toolchainDirs: {
    kind: 'string-list',
    def: [],
    why: '额外工具链搜索目录，按顺序优先于项目 .tools/ 与随包 .tools/。',
  },
  toolchain: {
    kind: 'string-map',
    def: {},
    why: '按工具名直接指定可执行文件（tectonic / biber / pandoc / python / latexmk / xelatex）。优先级最高。',
  },
  defaultProjectDir: {
    kind: 'string',
    def: null,
    why: '未显式传 project_dir 时的默认项目目录。留空则报错要求显式传入——静默猜目录会让模型改错论文。',
  },
  buildTimeoutMs: {
    kind: 'positive',
    def: 15 * 60 * 1000,
    why: '单次构建的墙钟预算（毫秒）。首次 Tectonic 构建要下载宏包，可能数分钟。',
  },
  maxLogBytes: {
    kind: 'positive',
    def: 256 * 1024,
    why: '单次子进程 stdout/stderr 采集上限（字节）。超限截断并显式置 truncated:true。',
  },
  quiet: {
    kind: 'boolean',
    def: false,
    why: '静音 info 级启动日志（warn 永不静音）。',
  },
})

/** 默认值（文档与测试引用此处；改这里即改默认）。 */
export const CONFIG_DEFAULTS = Object.freeze(
  Object.fromEntries(Object.entries(CONFIG_SPEC).map(([key, spec]) => [key, spec.def])),
)

/** 可配置的工具名（`toolchain` 的键集）。 */
export const TOOLCHAIN_KEYS = Object.freeze(['tectonic', 'biber', 'pandoc', 'python', 'latexmk', 'xelatex'])

/**
 * 校验并规范化配置。
 *
 * 返回形态遵循 standard-schema v1：合法 → `{ value }`（已填默认值）；
 * 非法 → `{ issues: [{ message, path? }] }`，由 Cordis 抛 `ValidationError`。
 * @param config - loader 传入的原始配置（可为 undefined）。
 * @returns `{ value }` 或 `{ issues }`。
 */
export function validateConfig(config) {
  if (config !== undefined && (config === null || typeof config !== 'object' || Array.isArray(config))) {
    return { issues: [{ message: `yibinthesis-dsh 的 config 必须是对象，收到 ${Array.isArray(config) ? 'array' : typeof config}` }] }
  }
  const raw = config ?? {}
  const issues = []
  for (const key of Object.keys(raw)) {
    if (!Object.hasOwn(CONFIG_SPEC, key)) {
      issues.push({ message: `不认识的配置键 "${key}"（可用：${Object.keys(CONFIG_SPEC).join(' / ')}）`, path: [key] })
    }
  }
  const value = { ...CONFIG_DEFAULTS }
  for (const [key, spec] of Object.entries(CONFIG_SPEC)) {
    if (!Object.hasOwn(raw, key)) continue
    const v = raw[key]
    if (v === undefined) continue
    switch (spec.kind) {
      case 'boolean':
        if (typeof v !== 'boolean') issues.push({ message: `config.${key} 必须是 boolean，收到 ${typeof v}`, path: [key] })
        else value[key] = v
        break
      case 'positive':
        if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) issues.push({ message: `config.${key} 必须是正数，收到 ${String(v)}`, path: [key] })
        else value[key] = Math.floor(v)
        break
      case 'enum':
        if (!spec.values.includes(v)) issues.push({ message: `config.${key} 必须是 ${spec.values.join(' / ')} 之一，收到 ${String(v)}`, path: [key] })
        else value[key] = v
        break
      case 'string-list':
        if (!Array.isArray(v) || v.some((item) => typeof item !== 'string')) {
          issues.push({ message: `config.${key} 必须是字符串数组`, path: [key] })
        } else value[key] = v
        break
      case 'string-map': {
        if (v === null || typeof v !== 'object' || Array.isArray(v)) {
          issues.push({ message: `config.${key} 必须是对象`, path: [key] })
          break
        }
        for (const toolKey of Object.keys(v)) {
          if (!TOOLCHAIN_KEYS.includes(toolKey)) {
            issues.push({ message: `config.${key}.${toolKey} 不是已知工具（可用：${TOOLCHAIN_KEYS.join(' / ')}）`, path: [key, toolKey] })
          } else if (typeof v[toolKey] !== 'string') {
            issues.push({ message: `config.${key}.${toolKey} 必须是字符串路径`, path: [key, toolKey] })
          }
        }
        if (!issues.length) value[key] = { ...v }
        break
      }
      default: {
        // 'string'
        if (v !== null && typeof v !== 'string') issues.push({ message: `config.${key} 必须是字符串，收到 ${typeof v}`, path: [key] })
        else value[key] = v === '' ? null : v
      }
    }
  }
  return issues.length ? { issues } : { value }
}

/** Cordis 读取的配置 schema 挂载点。 */
export const Config = Object.freeze({
  '~standard': Object.freeze({ version: 1, vendor: 'yibinthesis-dsh', validate: validateConfig }),
})

/**
 * 供 `apply()` 与测试使用的规范化入口：与 `Config['~standard'].validate` 同源，非法即抛。
 *
 * 必要性：宿主经 `ctx.plugin(entry, config)` 加载时 Cordis 已校验一次；但「直接调用 apply」
 * 的路径（单测、最小宿主）没有那一层，这里兜底，避免非法配置在本包内部造成难查的远端故障。
 * @param config - 原始配置。
 * @returns 规范化后的配置对象。
 * @throws {TypeError} 当配置非法时。
 */
export function resolveConfig(config) {
  const result = validateConfig(config)
  if (result.issues) {
    throw new TypeError(
      'yibinthesis-dsh 的 config 非法：\n' + result.issues.map((issue) => `  - ${issue.message}`).join('\n'),
    )
  }
  return result.value
}

/**
 * 从已解析的项目配置里取项目目录：显式参数 > `config.defaultProjectDir`。
 *
 * 刻意**不**回落到 `process.cwd()`：插件的 cwd 是宿主会话的工作目录，可能完全不是论文项目；
 * 静默猜目录会让模型改错论文。找不到就抛，由工具层转成可操作的提示。
 * @param explicit - 调用参数里显式给出的目录。
 * @param config - 已规范化的插件配置。
 * @returns 项目目录的绝对路径。
 * @throws {Error} 当两处都没有时。
 */
export function requireProjectDir(explicit, config) {
  const fromExplicit = resolveFrom(explicit, process.cwd())
  if (fromExplicit) return fromExplicit
  const fromConfig = resolveFrom(config?.defaultProjectDir, process.cwd())
  if (fromConfig) return fromConfig
  throw new Error(
    '未指定论文项目目录。请传入 project_dir，或在插件配置里设置 defaultProjectDir。' +
      '（插件刻意不默认使用当前工作目录，以免改错项目。）',
  )
}

export { CONFIG_SPEC }
