// yibinthesis-dsh —— 插件入口（host 半）。
//
// 职责（按重要性排序）：
//   1. **注册技能** `yibinthesis`：这是一份关于「怎么用这套工具、边界在哪」的按需知识，
//      是模型在不确定时唯一的正确路标。
//   2. **注册原生工具** `yibinthesis_*`：把项目读取/工具链检查/构建/脚手架变成结构化调用。
//
// ★ 硬约束（见 docs/ARCHITECTURE.md D5）：本文件**不静态 import 任何宿主包**，
//   `@deepseek-ai/dsh-tools` 走**动态 import**（在 `lib/tools.js` 里）。
//   原因（本机实测）：`%USERPROFILE%\.dsh\profiles\node_modules\@deepseek-ai\`
//   下 **225 个 junction 全部断链**（指向已不存在的 `<DSH 安装目录>\…`，
//   而真实安装目录是 `…\dsh\…`）——**零个可达**。也就是说任何第三方插件都无法依赖
//   「宿主会替我解析 @deepseek-ai/*」这个假设。
//   因此 `@deepseek-ai/dsh-tools` 被声明为本包的**真实依赖**（见 package.json 的
//   `dependencies`），由本包自己的 node_modules 解析；动态 import 保证即使它仍解析不到，
//   也只剩「工具未启用」，**技能照常注册**。
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PACKAGE_ROOT, SKILL_DIR } from './env.js'
import { Config, resolveConfig } from './config.js'
import { installTools } from './tools.js'
import { mountBridge, BRIDGE_PREFIX, BRIDGE_ROUTES } from './bridge.js'

/** 插件 fiber 名；`cordis.patch.yml` 的插入行按包名解析到本入口。 */
export const name = 'yibinthesis-dsh'

/**
 * 硬依赖的服务。
 *
 * `skills`：技能注册是插件的首要职责。
 * `tools`：宿主核心服务（`@deepseek-ai/dsh-tools`，DSH 组合树里恒为 active）。
 *   写进 `inject` 而不是只走 `ctx.get('tools')`，是因为**加载时机**：
 *   未声明的服务在 `apply()` 执行时可能尚未就绪，而未就绪时属性访问器的行为不可依赖
 *   （实测：声明为 inject 后 `apply` 期 `ctx.tools` 才稳定可用）。
 *   工具注册仍保留 try/catch 降级——服务就绪不等于注册一定成功。
 *
 * 注意：`@deepseek-ai/dsh-tools` **不需要**成为 npm 依赖。本包用自己的
 * `lib/tool-builder.js`（零宿主依赖）产出同形态的 `ToolDefinition`，
 * 只经 `ctx.tools` 这一个服务接口与宿主交互。
 */
export const inject = ['skills', 'tools']

export { Config }

/** 本包版本（启动状态行带上它——装错了要看得见）。 */
function readPackageVersion() {
  try {
    return JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')).version ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

/**
 * 把 SKILL.md 的 YAML frontmatter 与正文分开。
 *
 * 行尾与 BOM 必须**先归一**：`readFileSync(p, 'utf8')` 不做行尾归一，Windows 上
 * （`core.autocrlf=true` 检出、或编辑器另存为 CRLF）首行会是 `---\r\n`，
 * 用 `startsWith('---\n')` 判定会**静默**丢掉 description/whenToUse——
 * 而这两个字段恰是模型侧路由的唯一依据。
 * @param text - SKILL.md 原文。
 * @returns 路由字段、正文、以及是否真的识别到 frontmatter。
 */
export function splitFrontmatter(text) {
  const normalized = String(text).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  const match = /^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(normalized)
  if (!match) return { fields: {}, body: normalized, parsed: false }
  const meta = match[1]
  const body = normalized.slice(match[0].length).replace(/^\n+/, '')
  const read = (key) => {
    const found = new RegExp(`^${key}:\\s*(.+)$`, 'm').exec(meta)
    return found?.[1]?.trim().replace(/^["']|["']$/g, '')
  }
  return {
    fields: { name: read('name'), description: read('description'), whenToUse: read('whenToUse') },
    body,
    parsed: true,
  }
}

/**
 * 读取随包技能定义。
 * @returns `{ name, description, whenToUse, content, resourceBase }`。
 * @throws {Error} 当 SKILL.md 缺失时（这是打包错误，必须响亮失败）。
 */
export function loadSkill() {
  const skillFile = join(SKILL_DIR, 'SKILL.md')
  if (!existsSync(skillFile)) {
    throw new Error(`随包技能文件缺失：${skillFile}（打包错误，请重新安装本包）`)
  }
  const parsed = splitFrontmatter(readFileSync(skillFile, 'utf8'))
  return {
    name: parsed.fields.name || 'yibinthesis',
    description:
      parsed.fields.description ||
      '宜宾学院本科毕业材料 LaTeX 排版工具（YibinThesis）：新建论文项目、检查工具链、构建 PDF/Word、格式审计。',
    whenToUse: parsed.fields.whenToUse,
    content: parsed.body,
    // 技能内 references/** 的相对引用按这个目录解析，故在任意 cwd 下都能加载。
    resourceBase: { kind: 'directory', path: SKILL_DIR },
  }
}

/**
 * 插件主体。
 * @param ctx - Cordis 上下文（需要 `skills` 服务已就绪）。
 * @param config - loader 传入的原始配置（经 {@link Config} 校验）。
 */
export function apply(ctx, config) {
  const settings = resolveConfig(config)
  const version = readPackageVersion()
  const log = (level, message) => {
    // warn 永不静音：静默降级正是本包要避免的缺陷形态。
    if (level === 'info' && settings.quiet) return
    const logger = ctx?.logger
    if (logger && typeof logger[level] === 'function') logger[level](message)
    else if (level !== 'info') console.error(message)
  }

  // 客户端半的加载情况：`lib/client.js` 由宿主的 clientModules 服务按
  // `package.json#dsh.client` 单独装配，**与 host 半的加载路径无关**——
  // 也就是说 host 半成功不等于面板一定出现。这里如实报告一次，
  // 让「面板看不到」这类问题能立刻区分是「客户端没装配」还是「导航没找对」。
  const clientEntry = join(PACKAGE_ROOT, 'lib', 'client.js')
  log(
    'info',
    `· yibinthesis-dsh ${version}：host 半已加载${existsSync(clientEntry) ? '；客户端面板入口存在（由宿主按 dsh.client 单独装配，若页面看不到请刷新一次）' : '；⚠ 客户端面板入口缺失'}`,
  )

  // ── 1. 技能（硬依赖，先注册）────────────────────────────────────────────
  ctx.effect(() => {
    const skill = loadSkill()
    const disposer = ctx.skills.register({
      name: skill.name,
      description: skill.description,
      ...(skill.whenToUse ? { whenToUse: skill.whenToUse } : {}),
      content: skill.content,
      resourceBase: skill.resourceBase,
      source: 'bundled',
      provider: name,
    })
    log('info', `· yibinthesis-dsh ${version}：已注册技能 ${skill.name}（${skill.content.length} 字符）`)
    return disposer
  }, 'yibinthesis-dsh: skill')

  // ── 2. 可选：模板运行时自检（缺失只 warn，不让技能失效）─────────────────
  const builderPath = join(settings.templateRoot, 'build.ps1')
  if (!existsSync(builderPath)) {
    log(
      'warn',
      `· yibinthesis-dsh：模板运行时缺少 build.ps1（${builderPath}）。` +
        '构建类工具会失败；请把配置项 templateRoot 指向含 build.ps1 的 YibinThesis 检出根。',
    )
  }

  // ── 3. 客户端面板的数据桥 ───────────────────────────────────────────────
  //
  // 服务取法：**延迟注入**（`ctx.inject(['webServer'], …)`）。
  //
  // 为什么不只是 `ctx.get('webServer')`：`webServer` 可能在 `apply()` 执行时**尚未就绪**
  // （实测过同类问题：`inject` 未声明的服务在 apply 期拿不到，工具因此静默不注册）。
  // `ctx.inject` 是官方点名的「等某个服务就绪后再干活」的写法，也是本机第三方插件
  // `dsh-free-search` 挂桥时的实测用法（`ctx.inject(["webServer", "settings"], …)`）。
  // 两条路径都保留：先试延迟注入，服务已就绪时它同样会立即执行。
  //
  // 挂载结果落盘到 `diag-bridge.json`：桥的状态只有宿主自己知道，
  // 面板报「404」时若没有这份自检，就只能靠猜。
  ctx.effect(() => {
    const record = (payload) => {
      try {
        writeFileSync(join(PACKAGE_ROOT, 'diag-bridge.json'), JSON.stringify({ at: new Date().toISOString(), ...payload }, null, 2), 'utf8')
      } catch {
        /* 诊断绝不能影响加载 */
      }
    }
    let disposers = []
    const mount = (scope, source) => {
      try {
        const result = mountBridge(scope, { config: settings })
        if (result.mounted) {
          disposers.push(...(result.disposers || []))
          record({ mounted: true, source, routes: BRIDGE_ROUTES })
          log('info', `· yibinthesis-dsh：面板数据桥已挂载（${BRIDGE_PREFIX}，${BRIDGE_ROUTES.length} 条路由，${source}）`)
        } else {
          record({ mounted: false, source, reason: result.reason })
          log('warn', `· yibinthesis-dsh：面板数据桥未挂载（${result.reason}）——原生工具与技能不受影响。`)
        }
      } catch (error) {
        record({ mounted: false, source, reason: String(error?.message || error) })
        log('warn', `· yibinthesis-dsh：面板数据桥未挂载（${error?.message || error}）`)
      }
    }

    // ① 服务可能已就绪：直接试一次。
    mount(ctx, 'direct')
    // ② 若 ① 没成，等 webServer 就绪后再挂（幂等：已挂过就跳过）。
    if (disposers.length === 0) {
      try {
        ctx.inject(['webServer'], (scope) => {
          if (disposers.length === 0) mount(scope, 'deferred-inject')
          return () => {}
        })
      } catch {
        /* 无 inject 能力：保持 ① 的结果 */
      }
    }

    return () => {
      for (const dispose of disposers) {
        try {
          dispose()
        } catch {
          /* 卸载期忽略 */
        }
      }
      disposers = []
    }
  }, 'yibinthesis-dsh: panel bridge')

  // ── 4. 工具（可选依赖：宿主无 tools 服务时降级，技能照常可用）───────────
  ctx.effect(() => {
    const tools = ctx.get('tools')
    if (!tools?.register) {
      log('warn', '· yibinthesis-dsh：宿主未提供 tools 服务，原生工具未启用；技能与随包 build.ps1 仍可直接使用。')
      return () => {}
    }
    try {
      // 静态 import 是安全的：`installTools` 与 `defineTool` 都在本包内，**不依赖任何宿主包**
      // （见 lib/tools.js 文件头的实测依据）。
      const disposers = installTools(ctx, { config: settings })
      log('info', `· yibinthesis-dsh：已注册 ${disposers.length} 个原生工具（yibinthesis_*）`)
      return () => {
        for (const dispose of disposers) {
          try {
            dispose()
          } catch {
            /* 卸载期忽略 */
          }
        }
      }
    } catch (error) {
      log(
        'warn',
        `· yibinthesis-dsh：原生工具未启用（${error?.code || error?.message || error}）。` +
          '技能仍可用；也可用 pwsh 直接调随包 build.ps1。',
      )
      return () => {}
    }
  }, 'yibinthesis-dsh: tools')
}
