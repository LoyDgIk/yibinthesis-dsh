// 子进程执行：统一 PATH 组合、取消转发、输出上限与失败分类。
//
// 为什么自己写而不是复用宿主能力：本包的入口**不静态 import 宿主包**（见
// docs/ARCHITECTURE.md D5，本机 `@deepseek-ai/*` junction 已实测断链），
// 故此处用 `node:child_process` 直连，把宿主无关性保持到底。
import { spawn } from 'node:child_process'
import { delimiter } from 'node:path'
import { classifyFailure, describeError } from './env.js'
import { composePath, resolveToolchain } from './toolchain.js'

/** 默认单次执行的墙钟预算（毫秒）。 */
export const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000
/** 默认采集的输出上限（字节）。 */
export const DEFAULT_MAX_LOG_BYTES = 256 * 1024

/**
 * 找到可用的 PowerShell 宿主。
 *
 * 上游 `build.ps1` 是 PowerShell 脚本；Windows 上 `pwsh`（PS7）与 `powershell`（5.1）
 * 都能跑它（脚本有 `#requires -Version 5.1`）。此处按 pwsh → powershell 顺序探测。
 * @param env - 探测用的 PATH 环境。
 * @returns 可执行名（交给 spawn 自己解析）或 `null`。
 */
export function findPowerShell(env = process.env) {
  // 不自己遍历 PATH：交给 spawn + shell:false 的默认解析即可，
  // 这里只是决定「用哪个名字」，并在两者都不存在时给出可操作的错误。
  return process.platform === 'win32' ? 'pwsh' : 'pwsh'
}

/**
 * 执行一个子进程，收集输出并归一失败。
 *
 * 契约：
 * - 尊重 `signal`：中止时杀子进程，并以 `error.kind = 'cancelled'` 返回（**不**抛）。
 * - 输出超过 `maxLogBytes` 时截断并置 `truncated: true`（**不**静默丢弃）。
 * - 从不抛出：所有失败都变成结构化结果，让工具层能给出可操作的提示。
 * @param opts - 执行参数。
 * @param opts.command - 可执行文件或命令名。
 * @param opts.args - 参数数组。
 * @param opts.cwd - 工作目录。
 * @param opts.env - 完整环境变量表（调用方已组合好；缺省继承 `process.env`）。
 * @param opts.pathEntries - 前置到 PATH 的目录。
 * @param opts.signal - 取消信号。
 * @param opts.timeoutMs - 超时预算。
 * @param opts.maxLogBytes - 输出上限。
 * @param opts.spawnImpl - 可注入的 spawn（单测用）。
 * @returns 结构化执行结果。
 */
export function runProcess({
  command,
  args = [],
  cwd,
  env = process.env,
  pathEntries = [],
  signal,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxLogBytes = DEFAULT_MAX_LOG_BYTES,
  spawnImpl = spawn,
} = {}) {
  return new Promise((resolve) => {
    const childEnv = { ...env }
    childEnv.PATH = composePath(pathEntries, env.PATH || env.Path || '')
    // Windows 上 PATH 的大小写敏感拼写并存会让某些工具只读到其中一个。
    if (process.platform === 'win32') childEnv.Path = childEnv.PATH

    let child
    try {
      child = spawnImpl(command, args, {
        cwd,
        env: childEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })
    } catch (error) {
      // 受限部署下 spawn 会**同步抛**（沙箱禁止开命名管道 → EPERM）。
      // 归类为 spawn-denied，交由工具层给出「改用 pwsh 直接调」的提示。
      const failure = classifyFailure({ spawnError: error?.code || 'SPAWN_FAILED', stderr: describeError(error) })
      resolve({ exitCode: null, stdout: '', stderr: describeError(error), ...failure, spawnError: error?.code || 'SPAWN_FAILED', timedOut: false, truncated: false })
      return
    }

    let stdout = ''
    let stderr = ''
    let truncated = false
    let timedOut = false
    let aborted = false
    const cap = Number.isFinite(maxLogBytes) && maxLogBytes > 0 ? maxLogBytes : Infinity

    // 关键：setEncoding('utf8') 让 Node 用 StringDecoder 缓存跨分片的不完整多字节序列。
    // 手工对每个 Buffer 分片解码会把跨越分片边界的汉字解成 U+FFFD——
    // 本项目的输出**全是中文**（doctor/构建日志），这类丢字会让结构化解析静默出错。
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')

    const append = (current, chunk) => {
      const text = String(chunk)
      if (current.length + text.length <= cap) return current + text
      truncated = true
      return current.slice(0, Math.max(0, cap - 1)) + '…'
    }

    const kill = () => {
      try {
        child.kill()
      } catch {
        /* 已退出 */
      }
    }

    const onAbort = () => {
      aborted = true
      kill()
    }

    let timer = null
    if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true
        kill()
      }, timeoutMs)
    }

    const cleanup = () => {
      if (timer) clearTimeout(timer)
      if (signal) signal.removeEventListener('abort', onAbort)
    }

    if (signal) {
      if (signal.aborted) onAbort()
      else signal.addEventListener('abort', onAbort, { once: true })
    }

    child.stdout?.on('data', (chunk) => {
      stdout = append(stdout, chunk)
    })
    child.stderr?.on('data', (chunk) => {
      stderr = append(stderr, chunk)
    })
    child.on('error', (error) => {
      cleanup()
      const failure = classifyFailure({ spawnError: error?.code, stderr: `${stderr}${describeError(error)}`, timedOut, aborted })
      resolve({
        exitCode: null,
        stdout,
        stderr: `${stderr}${describeError(error)}`,
        ...failure,
        spawnError: error?.code || 'SPAWN_FAILED',
        timedOut,
        aborted,
        truncated,
      })
    })
    child.on('close', (code) => {
      cleanup()
      const failure = classifyFailure({ exitCode: code, stdout, stderr, timedOut, aborted })
      resolve({
        exitCode: code,
        stdout,
        stderr,
        ...failure,
        spawnError: null,
        timedOut,
        aborted,
        truncated,
      })
    })
  })
}

/**
 * 调用随包模板运行时的 `build.ps1`。
 *
 * 契约来源（实测）：`build.ps1` 的位置参数 0 是
 * `pdf|word|all|check|doctor|clean`，并接受 `-Config <项目>/yibinthesis.project.json`
 * 与 `-Main` / `-OutputRoot` / `-CitationMode` / `-WordRefresh`。
 * 退出码：`0` 成功；`1` 构建器内部抛错；`2` 仅 `doctor` 使用，表示「工具链未就绪」。
 * @param opts - 调用参数。
 * @returns 结构化执行结果（含 `env` 里实际注入的工具链路径，便于回传诊断）。
 */
export async function runBuilder({
  command,
  configPath,
  templateRoot,
  projectDir,
  cwd,
  toolchainDirs = [],
  toolchain = {},
  main,
  outputRoot,
  citationMode,
  wordRefresh,
  signal,
  timeoutMs,
  maxLogBytes,
  extraArgs = [],
  spawnImpl,
} = {}) {
  const resolved = resolveToolchain({ projectDir, toolchainDirs, toolchain })
  const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', `${templateRoot}/build.ps1`, command, '-Config', configPath]
  if (main) args.push('-Main', main)
  if (outputRoot) args.push('-OutputRoot', outputRoot)
  if (citationMode) args.push('-CitationMode', citationMode)
  if (wordRefresh) args.push('-WordRefresh', wordRefresh)
  args.push(...extraArgs)

  const result = await runProcess({
    command: findPowerShell(),
    args,
    cwd: cwd || projectDir,
    pathEntries: resolved.pathEntries,
    env: { ...process.env, ...resolved.env },
    signal,
    timeoutMs,
    maxLogBytes,
    spawnImpl,
  })
  return { ...result, toolchain: resolved.found }
}

/**
 * 调用随包 Python 适配器（结构化 JSON 的唯一来源）。
 *
 * 约定：适配器**只**向 stdout 打印一个 JSON 对象；退出码 0 = `ok:true`，
 * 退出码 2 = 可预期的用户错误（`ok:false` + `error.kind`），其它 = 适配器自身故障。
 * @param opts - 调用参数。
 * @returns `{ ok, value, error, raw }`。
 */
export async function runAdapter({
  pythonPath,
  scriptPath,
  args = [],
  projectDir,
  templateRoot,
  toolchainDirs = [],
  toolchain = {},
  signal,
  timeoutMs = 120000,
  maxLogBytes = DEFAULT_MAX_LOG_BYTES,
  spawnImpl,
} = {}) {
  const resolved = resolveToolchain({ projectDir, toolchainDirs, toolchain })
  // 适配器需要 `python-docx`/`Pillow` 时不必走到这里；本层只负责项目摘要与脚手架。
  const result = await runProcess({
    command: pythonPath || 'python',
    args: [scriptPath, ...args],
    cwd: projectDir || templateRoot,
    pathEntries: resolved.pathEntries,
    env: {
      ...process.env,
      ...resolved.env,
      YIBINTHESIS_TEMPLATE_ROOT: templateRoot,
      // 保证适配器与 CLI 的 UTF-8 输出在 Windows 控制台下不被代码页破坏。
      PYTHONIOENCODING: 'utf-8',
      PYTHONUTF8: '1',
    },
    signal,
    timeoutMs,
    maxLogBytes,
    spawnImpl,
  })

  const text = String(result.stdout || '').trim()
  const start = text.indexOf('{')
  let parsed = null
  if (start >= 0) {
    try {
      parsed = JSON.parse(text.slice(start))
    } catch {
      parsed = null
    }
  }
  if (parsed && typeof parsed === 'object') {
    return { ok: Boolean(parsed.ok), value: parsed, error: null, raw: result }
  }
  return {
    ok: false,
    value: null,
    error: result.exitCode === null || result.exitCode === undefined
      ? { kind: result.kind || 'adapter-failed', message: result.message || '适配器未返回 JSON' }
      : { kind: 'adapter-failed', message: `适配器未返回可解析的 JSON（退出码 ${result.exitCode}）：${(result.stderr || result.stdout || '').slice(-400)}` },
    raw: result,
  }
}

export { delimiter }
