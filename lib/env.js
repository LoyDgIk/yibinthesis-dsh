// 共享环境工具：包根解析、路径规范化、错误分类、确定性 JSON。
//
// 设计约束（见 docs/ARCHITECTURE.md D5）：本包**不**静态 import 任何宿主包，
// 因此这里只用 Node 内建模块。所有路径计算都在 apply 期之外可安全调用（纯函数）。
import { existsSync, realpathSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 包根：本文件位于 `lib/`，故根在其上一级。 */
export const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

/** 随包模板运行时根（`vendor/yibinthesis`）。 */
export const VENDOR_TEMPLATE_ROOT = join(PACKAGE_ROOT, 'vendor', 'yibinthesis')

/** 随包 Python 适配器。 */
export const ADAPTER_SCRIPT = join(PACKAGE_ROOT, 'adapter', 'yibinthesis_probe.py')

/** 随包技能目录（`resourceBase` 指向它）。 */
export const SKILL_DIR = join(PACKAGE_ROOT, 'skills', 'yibinthesis')

/** 随包可放置工具链二进制的目录（不进 npm tarball，供使用者自行投放）。 */
export const PACKAGE_TOOLCHAIN_ROOT = join(PACKAGE_ROOT, '.tools')

/** 项目配置文件名，与上游 CLI 的 `PROJECT_CONFIG_NAME` 保持一致。 */
export const PROJECT_CONFIG_NAME = 'yibinthesis.project.json'

/** 工具链二进制在 `.tools/` 下的候选子目录名（按上游 `setup_toolchain.ps1` 的布局）。 */
export const TOOLCHAIN_SUBDIRS = Object.freeze({
  tectonic: ['tectonic', 'tectonic-0.16.9', 'tectonic-0.17.0'],
  biber: ['biber-2.17', 'biber'],
  pandoc: ['pandoc-3.9.0.2', 'pandoc'],
})

/**
 * 把用户给出的相对路径按 `base` 解析为绝对路径。
 * @param value - 原始路径（可为 undefined/空）。
 * @param base - 相对路径的基准目录。
 * @returns 绝对路径；`value` 为空时返回 `null`。
 */
export function resolveFrom(value, base) {
  if (typeof value !== 'string' || value.trim() === '') return null
  const trimmed = value.trim().replace(/^"(.*)"$/, '$1')
  return isAbsolute(trimmed) ? resolve(trimmed) : resolve(base, trimmed)
}

/**
 * 返回路径的真实拼写（解析 junction/symlink）；失败时回退原路径。
 *
 * 必要性（实测）：本机 `%USERPROFILE%\.dsh\profiles\node_modules\@deepseek-ai\*`
 * 全是指向**已不存在**路径的 junction。任何以 realpath 为准的解析都必须容错，
 * 否则一个断链就让整个插件 apply 失败。
 * @param path - 待解析路径。
 * @returns 可用的绝对路径。
 */
export function safeRealpath(path) {
  try {
    return realpathSync.native(path)
  } catch {
    return path
  }
}

/**
 * 判断 `child` 是否位于 `parent` 之内（含相等）。
 * 用于拒绝把工具仓库自身当作论文项目目录这类越界输入。
 * @param child - 待检查路径。
 * @param parent - 允许的父路径。
 * @returns 是否位于其内。
 */
export function isInside(child, parent) {
  const a = resolve(child)
  const b = resolve(parent)
  if (a === b) return true
  return a.startsWith(b.endsWith(sep) ? b : b + sep)
}

/**
 * 把未知的抛出物归一为可读消息。
 *
 * 必要性：Node 的 spawn 失败是 `Error & {code}`，而 `Error.message` 在
 * Windows 上常带前缀噪音；分类逻辑见 {@link classifyFailure}。
 * @param error - 任意抛出物。
 * @returns 简短消息。
 */
export function describeError(error) {
  if (error === null || error === undefined) return 'unknown error'
  if (typeof error === 'string') return error
  const code = error.code ? ` [${error.code}]` : ''
  const message = error.message || String(error)
  return `${message}${code}`
}

/**
 * 把子进程失败分类为稳定的错误种类，供工具返回结构化 `error.kind`。
 *
 * 分类表（与 README 的故障处置表一一对应）：
 * - `missing-toolchain`：构建器自报外部工具缺失（Doctor/构建前置检查）。
 * - `spawn-denied`：宿主禁止派生进程（沙箱下的 EPERM/EACCES）。
 * - `cancelled`：`AbortSignal` 触发。
 * - `timeout`：超过协作超时预算。
 * - `project-invalid`：项目目录/配置/入口缺失或非法。
 * - `build-failed`：构建器以非零码退出且不属于以上各类。
 * @param input - 失败上下文。
 * @returns 分类结果。
 */
export function classifyFailure({ exitCode, stderr, stdout, spawnError, timedOut, aborted, missingTools = [] } = {}) {
  const text = `${stderr || ''}\n${stdout || ''}`
  if (aborted) return { kind: 'cancelled', message: '已取消（调用方中止）' }
  if (timedOut) return { kind: 'timeout', message: '超过协作超时预算，已中止' }
  if (spawnError === 'EPERM' || spawnError === 'EACCES') {
    return {
      kind: 'spawn-denied',
      message:
        `宿主禁止本进程派生子进程（${spawnError}）。这通常发生在受限文件策略下` +
        '「被围栏进程不能开命名管道」。请改用 `pwsh` 直接调用同一脚本：' +
        '`pwsh -File <插件>/vendor/yibinthesis/build.ps1 <命令> -Config <项目>/yibinthesis.project.json`。',
    }
  }
  if (missingTools.length > 0) {
    return {
      kind: 'missing-toolchain',
      message: `缺少构建所需的外部工具：${missingTools.join('、')}`,
    }
  }
  // ★ 分类顺序很重要：`project-invalid` 必须在 `missing-toolchain` 之前判定。
  //   上游的项目类错误里也带 "not found"（例如 "YibinThesis project config not found: …"），
  //   若先跑下面那条 `not found` 规则，就会被误判成「缺外部工具」——
  //   于是模型收到「去装 Biber」这种与真实原因无关的建议，白费一轮。
  if (/project config not found|Invalid YibinThesis project config|must define a non-empty|LaTeX entry point not found|项目目录不存在|找不到项目配置/i.test(text)) {
    const line = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => /project config|LaTeX entry point|must define|项目目录|找不到项目配置/i.test(l))
    return { kind: 'project-invalid', message: line || '项目配置或入口非法' }
  }
  if (/not found|was not found|not be found|未找到|找不到|is required by this entry point/i.test(text)) {
    const line = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => /not found|was not found|not be found|未找到|找不到|is required/i.test(l))
    return { kind: 'missing-toolchain', message: line || '外部工具或资源缺失' }
  }
  const tail = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(-3).join(' / ')
  return {
    kind: 'build-failed',
    message: tail || `构建器以退出码 ${exitCode} 结束`,
  }
}

/**
 * 把子进程的 stdout 文本按行解析成 doctor 的逐项状态。
 *
 * 契约来源：`build.ps1:1169-1186` 的 `Show-ToolStatus` 固定打印
 * `  [OK]      <Name> (<role>) - <Path> [<Source>] | <Version>` 或 `  [MISSING] <Name> (<role>) - <Source>`。
 * 另有两项非该格式：`  [OK]      Python module: <name>` 与 `  [OK]      Word builder and reference.docx`。
 *
 * 说明：本函数只用于**展示与提示**，权威就绪度取自退出码（`ready = exitCode === 0`）。
 * @param stdout - doctor 的完整 stdout。
 * @returns 解析出的条目与汇总行。
 */
export function parseDoctorOutput(stdout) {
  const entries = []
  let pdfReady = null
  let wordReady = null
  for (const raw of String(stdout || '').split(/\r?\n/)) {
    const line = raw.trimEnd()
    const tool = /^\s*\[(OK|MISSING|INCOMPATIBLE)\]\s+(.+?)\s+\((required|optional)\)\s*-\s*(.*)$/.exec(line)
    if (tool) {
      const [, status, name, role, rest] = tool
      // 形如 `<Path> [<Source>] | <Version>`；MISSING 时只有 `<Source>`。
      const versionSplit = rest.split(' | ')
      const origin = versionSplit[0].trim()
      const version = versionSplit.length > 1 ? versionSplit.slice(1).join(' | ').trim() : null
      const pathMatch = /^(.*?)\s*\[([^\]]*)\]$/.exec(origin)
      entries.push({
        name: name.trim(),
        kind: 'tool',
        status: status === 'OK' ? 'ok' : status === 'MISSING' ? 'missing' : 'incompatible',
        required: role === 'required',
        path: pathMatch ? pathMatch[1].trim() || null : origin || null,
        source: pathMatch ? pathMatch[2].trim() : null,
        version,
      })
      continue
    }
    const module = /^\s*\[(OK|MISSING)\]\s+Python module:\s*(.+)$/.exec(line)
    if (module) {
      entries.push({ name: `python:${module[2].trim()}`, kind: 'python-module', status: module[1] === 'OK' ? 'ok' : 'missing', required: false, path: null, source: null, version: null })
      continue
    }
    const wordFiles = /^\s*\[(OK|MISSING)\]\s+(Word builder and reference\.docx)$/.exec(line)
    if (wordFiles) {
      entries.push({ name: 'word-assets', kind: 'asset', status: wordFiles[1] === 'OK' ? 'ok' : 'missing', required: true, path: null, source: null, version: null })
      continue
    }
    const summary = /^\s*(PDF|Word) toolchain:\s*(READY|NOT READY)\s*$/.exec(line)
    if (summary) {
      const ready = summary[2] === 'READY'
      if (summary[1] === 'PDF') pdfReady = ready
      else wordReady = ready
    }
  }
  return { entries, pdfReady, wordReady }
}

/**
 * 判断一个路径是否是 YibinThesis 项目目录（含 `yibinthesis.project.json`）。
 * @param dir - 候选项目目录。
 * @returns 是否存在配置文件。
 */
export function looksLikeProject(dir) {
  return existsSync(join(dir, PROJECT_CONFIG_NAME))
}
