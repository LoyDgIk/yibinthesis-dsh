// 原生工具定义（host 半）。
//
// 契约依据（`@deepseek-ai/dsh-tools@0.2.0-rc.2`，本地解包在 `_scratch/`，详见
// `research/contracts.md` §A、§B）：
//   · `defineTool(options)` 从**显式白名单**构造工具对象；未知顶层键**既不读取也不报错**
//     ——故 `executionMode` 在这条路径上是 no-op（§A.7）。并发安全用 `isConcurrencySafe`。
//   · `parameters.<name>` 是「值 schema + `required?: true`」，形态 `{ type, required, description }` 正确（§A.3）。
//   · `output.schema` 是**值 schema**（不是原始 JSON Schema）；`output.render(args, value)`
//     必须返回 `ContentBlock[]`（§A.4）。
//   · `execute(args, exec)` 返回 `output.schema` 声明的规范值；抛异常 = 该次调用失败（§A.5）。
//
// ★ `defineTool` 用**本包自带**的实现（`lib/tool-builder.js`），**不是**宿主的
//   `@deepseek-ai/dsh-tools`。这是本次联调最重要的决策，有实测依据：
//     · 宿主把 `@deepseek-ai/*` 以 junction 放在 profile 的 node_modules 下，本机 225 个**全部断链**；
//     · 退而把它声明为本包依赖也不行——profile 的 `nodeLinker: hoisted` 会把它提升到
//       `<profile>/node_modules/@deepseek-ai/dsh-tools`，该副本要 import 自己的
//       peer `@deepseek-ai/cordis`，而那里的 cordis 正是断链 junction →
//       `ERR_MODULE_NOT_FOUND`。**实测：已安装副本上工具注册数 = 0。**
//   自带实现的**等价性**由 `tests/local-toolbuilder.test.mjs` 用宿主真实的 `defineTool`
//   逐字段比对（真值表 + 递归结构），不是人工核对。
//
// 两条刻意的实现取舍：
//   1. 所有工具**都不抛**：失败变成 `{ ok: false, kind, message }` 的结构化值。理由是本项目的
//      失败模式高度可预期（缺 biber、缺 python-docx、项目配置非法），让模型拿到 `kind` 与
//      可操作提示，比拿到一行 `Error: <message>` 更有用。
//   2. `output.schema` 用 `{ type: 'json' }`：规范值里字段多且会长（项目摘要、逐项工具链状态），
//      逐字段声明只会增加漂移面；真正的信息在 `render` 出的文本里，落盘副本在 tool/result 里。
import { ADAPTER_SCRIPT, PROJECT_CONFIG_NAME, looksLikeProject, parseDoctorOutput } from './env.js'
import { requireProjectDir } from './config.js'
import { runAdapter, runBuilder } from './runner.js'
import { defineTool } from './tool-builder.js'
export { defineTool }

/** 让规范值原样成为模型可见文本（JSON 缩进，便于阅读长列表）。 */
function renderJson(_args, value) {
  return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
}

/**
 * 把一次构建器调用的结果收成规范值。
 * @param result - `runBuilder` 的返回值。
 * @param options - 附加信息。
 * @returns 规范值。
 */
function builderOutcome(result, { command, published = [] } = {}) {
  const ok = result.exitCode === 0
  const parsed = command === 'doctor' ? parseDoctorOutput(result.stdout) : null
  const outcome = {
    ok,
    command,
    // doctor 的权威就绪度只取自退出码：0 = READY，2 = NOT READY（build.ps1:1279-1284）。
    exitCode: result.exitCode,
    kind: ok ? null : result.kind || 'build-failed',
    message: ok ? null : result.message || null,
    toolchain: Object.fromEntries(
      Object.entries(result.toolchain || {}).map(([tool, info]) => [tool, { path: info.path, source: info.source }]),
    ),
    log: (result.stdout || '').slice(-8000) || null,
    stderr: (result.stderr || '').slice(-4000) || null,
    truncated: Boolean(result.truncated),
    published,
  }
  if (parsed) {
    outcome.entries = parsed.entries
    outcome.pdfReady = parsed.pdfReady
    outcome.wordReady = parsed.wordReady
  }
  return outcome
}

/**
 * 由已解析的 `doctor` 结果生成**可操作**的提示。
 *
 * 设计原则：每一条提示都必须给出「做什么」，而不是复述「缺什么」。
 * @param outcome - `builderOutcome` 的产物。
 * @returns 提示字符串数组。
 */
function doctorHints(outcome) {
  const hints = []
  const entries = outcome.entries || []
  const missing = entries.filter((entry) => entry.status === 'missing')
  const byName = (needle) => missing.find((entry) => entry.name.toLowerCase().includes(needle))
  if (byName('biber')) {
    hints.push(
      '缺 Biber：项目引用了 .bib，构建 PDF 需要它。' +
        '下载 biber 2.17（Tectonic 0.16.9 的 BCF 3.8 工作流要求恰好 2.17，2.21 不兼容）后，' +
        '要么放进 <项目>/.tools/biber-2.17/biber.exe，要么设环境变量 YIBINTHESIS_BIBER，' +
        '或在插件配置 toolchain.biber 里给绝对路径。',
    )
  }
  if (byName('pandoc')) {
    hints.push('缺 Pandoc：Word 输出需要它。装好后放进 <项目>/.tools/pandoc-3.9.0.2/pandoc.exe 或设 YIBINTHESIS_PANDOC。')
  }
  if (byName('tectonic') && byName('xelatex')) {
    hints.push('PDF 引擎缺失：需要 Tectonic 或 XeLaTeX+Latexmk 之一。设 YIBINTHESIS_TECTONIC 指向 tectonic.exe。')
  }
  if (missing.some((entry) => entry.name === 'python:docx')) {
    hints.push('缺 python-docx：运行 `python -m pip install -r <插件>/vendor/yibinthesis/requirements-word.txt`。')
  }
  const incompatible = entries.find((entry) => entry.status === 'incompatible')
  if (incompatible) {
    hints.push(`${incompatible.name} 版本不兼容：${incompatible.version || '未知版本'}。Tectonic 0.16.9 需要 Biber 2.17。`)
  }
  if (!hints.length && !outcome.ok) {
    hints.push('工具链未全部就绪但未识别出具体缺项；请查看 log 与 stderr 字段。')
  }
  return hints
}

/**
 * 注册全部 yibinthesis_* 工具。
 *
 * 同步函数：`defineTool` 现在是本包自带的零依赖实现（见文件头），无需动态导入宿主包。
 * @param ctx - 插件 ctx（需要 `tools` 服务已就绪）。
 * @param options - 依赖注入点。
 * @param options.config - 已规范化的插件配置。
 * @param options.defineToolImpl - 可注入的 `defineTool` 实现（单测用真实现做等价比对）。
 * @param options.adapterScript - 适配器脚本路径（默认随包路径）。
 * @param options.runBuilderImpl - 可注入的构建器执行器（单测用）。
 * @param options.runAdapterImpl - 可注入的适配器执行器（单测用）。
 * @returns disposer 数组。
 */
export function installTools(ctx, {
  config,
  defineToolImpl = defineTool,
  adapterScript = ADAPTER_SCRIPT,
  runBuilderImpl = runBuilder,
  runAdapterImpl = runAdapter,
} = {}) {
  const definer = defineToolImpl
  const disposers = []

  // 契约形态：`ctx.tools.register(defineTool(options))`（§B.1）。
  // `defineTool` 只负责「构造并校验工具定义」，`register` 才把它挂进注册表。
  // 顺序不能反：`defineTool` 会在**定义期**校验 schema，非法定义当场抛（响亮失败）。
  //
  // ★ 服务取法：**属性访问与 `ctx.get()` 都试**。
  //   契约上 `ctx.tools` 应直接可用（`declare module` 把 `tools` 挂到 `Context`），
  //   而 `ctx.get('tools')` 是官方文档点名的**可选依赖取法**，在两种上下文形态下都能工作。
  //   只依赖其中一种、另一种恰好不成立，表现就是「工具静默不见、且没有任何错误」——
  //   正是本项目最忌讳的失效形态。
  const tools = ctx?.tools ?? ctx?.get?.('tools')
  if (!tools || typeof tools.register !== 'function') {
    throw new Error('宿主 ctx 上没有可用的 tools.register（已尝试 ctx.tools 与 ctx.get("tools")）')
  }
  /** 定义并注册一个工具，返回 disposer。 */
  const defineAndRegister = (options) => tools.register(definer(options))

  /** 归一化「项目目录 + 配置路径」，并给出可操作错误。 */
  const projectArgs = (args) => {
    const projectDir = requireProjectDir(args.project_dir, config)
    if (!looksLikeProject(projectDir)) {
      throw new Error(
        `目录里没有 ${PROJECT_CONFIG_NAME}：${projectDir}。` +
          '请用 yibinthesis_new 生成项目，或把 project_dir 指向已有的 YibinThesis 项目。',
      )
    }
    const configPath = args.config || `${projectDir}\\${PROJECT_CONFIG_NAME}`
    return { projectDir, configPath }
  }

  /** 把任意抛出物变成规范值（工具刻意不抛，见文件头）。 */
  const failure = (error, extra = {}) => ({
    ok: false,
    kind: extra.kind || 'invalid-request',
    message: error instanceof Error ? error.message : String(error),
    ...extra,
  })

  // ── 工具 1：yibinthesis_probe ────────────────────────────────────────────
  disposers.push(defineAndRegister({
    name: 'yibinthesis_probe',
    description:
      '读取一个 YibinThesis 论文项目的结构化摘要（**只读**）：项目配置、LaTeX 入口与 documentclass 选项、' +
      '封面元数据字段、chapters/ 章节清单与各章汉字数、交付文件路径、签名背景设置。' +
      '在动手改论文或构建前先调用它，避免猜目录与猜文档类型。',
    parameters: {
      project_dir: { type: 'string', description: '论文项目目录（含 yibinthesis.project.json）。省略时用配置项 defaultProjectDir。' },
      config: { type: 'string', description: '可选的显式项目配置路径；省略时用 <project_dir>/yibinthesis.project.json。' },
    },
    output: { schema: { type: 'json' }, render: renderJson },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      let resolved
      try {
        resolved = projectArgs(args)
      } catch (error) {
        return failure(error)
      }
      const result = await runAdapterImpl({
        pythonPath: config?.pythonPath,
        scriptPath: adapterScript,
        args: ['probe', '--project-dir', resolved.projectDir, ...(resolved.configPath ? ['--config', resolved.configPath] : [])],
        projectDir: resolved.projectDir,
        templateRoot: config?.templateRoot,
        toolchainDirs: config?.toolchainDirs,
        toolchain: config?.toolchain,
        signal: exec?.signal,
        maxLogBytes: config?.maxLogBytes,
      })
      if (!result.ok) {
        const kind = result.value?.error?.kind || result.error?.kind || 'probe-failed'
        return failure(result.value?.error?.message || result.error?.message || '适配器未返回项目摘要', { kind })
      }
      return result.value
    },
  }))

  // ── 工具 2：yibinthesis_doctor ───────────────────────────────────────────
  disposers.push(defineAndRegister({
    name: 'yibinthesis_doctor',
    description:
      '检查一个 YibinThesis 项目的构建工具链就绪度（**只读**）：Tectonic/XeLaTeX/Latexmk、Biber（版本必须是 2.17）、' +
      'Pandoc、Python 及 python-docx/Pillow、Word 资源。返回 PDF 与 Word 两条链路的 READY 状态、逐项来源与路径、以及可操作提示。' +
      '构建失败时先跑它。',
    parameters: {
      project_dir: { type: 'string', description: '论文项目目录。省略时用配置项 defaultProjectDir。' },
      config: { type: 'string', description: '可选的显式项目配置路径。' },
    },
    output: { schema: { type: 'json' }, render: renderJson },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      let resolved
      try {
        resolved = projectArgs(args)
      } catch (error) {
        return failure(error)
      }
      const result = await runBuilderImpl({
        command: 'doctor',
        configPath: resolved.configPath,
        templateRoot: config?.templateRoot,
        projectDir: resolved.projectDir,
        toolchainDirs: config?.toolchainDirs,
        toolchain: config?.toolchain,
        signal: exec?.signal,
        timeoutMs: config?.buildTimeoutMs,
        maxLogBytes: config?.maxLogBytes,
      })
      const outcome = builderOutcome(result, { command: 'doctor' })
      // doctor 的退出码 2 = 工具链未就绪（不是插件故障）；0 = 就绪；其余 = 真失败。
      if (outcome.exitCode === 2) {
        outcome.ok = false
        outcome.kind = 'missing-toolchain'
        outcome.message = '工具链未就绪'
      }
      outcome.hints = doctorHints(outcome)
      return outcome
    },
  }))

  // ── 工具 3：yibinthesis_new ──────────────────────────────────────────────
  disposers.push(defineAndRegister({
    name: 'yibinthesis_new',
    description:
      '在哪个目录创建新的 YibinThesis 论文项目骨架（**写盘**）。生成 latex/main.tex、metadata.tex、references.bib、' +
      'chapters/、assets/ 与 yibinthesis.project.json。文档类型决定版式年份（thesis/literature-review→2024，proposal→2022），' +
      '学科决定编号体系（humanities→一、/（一）；science→1/1.1）。先跑 dry_run=true 预览将要创建的文件。' +
      '需要上游 YibinThesis CLI（配置项 cliRoot 或环境变量 YIBINTHESIS_CLI_ROOT）。',
    parameters: {
      target_dir: { type: 'string', required: true, description: '项目目录（必须位于工具仓库之外）。' },
      document_type: { type: 'string', enum: ['thesis', 'proposal', 'literature-review'], description: '文档类型，默认 thesis。' },
      discipline: { type: 'string', enum: ['humanities', 'science'], description: '学科，决定章节编号体系，默认 humanities。' },
      title: { type: 'string', description: '中文题目。' },
      english_title: { type: 'string', description: '英文题目。' },
      author: { type: 'string', description: '作者姓名。' },
      student_id: { type: 'string', description: '学号。' },
      college: { type: 'string', description: '学院。' },
      major: { type: 'string', description: '专业。' },
      grade: { type: 'string', description: '年级。' },
      class_name: { type: 'string', description: '班级。' },
      advisor: { type: 'string', description: '校内导师。' },
      advisor_title: { type: 'string', description: '导师职称。' },
      external_advisor: { type: 'string', description: '校外导师。' },
      external_advisor_title: { type: 'string', description: '校外导师职称。' },
      secrecy: { type: 'string', enum: ['public', 'confidential'], description: '密级，默认 public。' },
      dry_run: { type: 'boolean', description: 'true 时只回报将要创建的文件，不写盘。' },
      force: { type: 'boolean', description: 'true 时允许覆盖脚手架已生成的文件（不删除目录中其它内容）。' },
    },
    output: { schema: { type: 'json' }, render: renderJson },
    // 写盘工具：不参与并行组（默认即 exclusive，此处显式声明以表明意图）。
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const cliRoot = config?.cliRoot || process.env.YIBINTHESIS_CLI_ROOT || null
      const adapterArgs = ['new', args.target_dir]
      if (cliRoot) adapterArgs.push('--cli-root', cliRoot)
      const passthrough = [
        ['--type', args.document_type],
        ['--discipline', args.discipline],
        ['--secrecy', args.secrecy],
        ['--title', args.title],
        ['--english-title', args.english_title],
        ['--author', args.author],
        ['--student-id', args.student_id],
        ['--college', args.college],
        ['--major', args.major],
        ['--grade', args.grade],
        ['--class-name', args.class_name],
        ['--advisor', args.advisor],
        ['--advisor-title', args.advisor_title],
        ['--external-advisor', args.external_advisor],
        ['--external-advisor-title', args.external_advisor_title],
      ]
      for (const [flag, value] of passthrough) {
        if (value !== undefined && value !== null && value !== '') adapterArgs.push(flag, String(value))
      }
      if (args.dry_run) adapterArgs.push('--dry-run')
      if (args.force) adapterArgs.push('--force')

      const result = await runAdapterImpl({
        pythonPath: config?.pythonPath,
        scriptPath: adapterScript,
        args: adapterArgs,
        projectDir: config?.templateRoot,
        templateRoot: config?.templateRoot,
        toolchainDirs: config?.toolchainDirs,
        toolchain: config?.toolchain,
        signal: exec?.signal,
        maxLogBytes: config?.maxLogBytes,
      })
      if (!result.ok) {
        const kind = result.value?.error?.kind || result.error?.kind || 'scaffold-failed'
        const message = result.value?.error?.message || result.error?.message || '脚手架未返回结果'
        const extra = kind === 'cli-missing' ? { hint: '设置插件配置项 cliRoot，或环境变量 YIBINTHESIS_CLI_ROOT，指向 YibinThesis 检出根。' } : {}
        return failure(message, { kind, ...extra })
      }
      return result.value
    },
  }))

  // ── 工具 4：yibinthesis_build ────────────────────────────────────────────
  disposers.push(defineAndRegister({
    name: 'yibinthesis_build',
    description:
      '构建 YibinThesis 论文项目的 PDF 或 Word（**写盘**，长任务）。format: pdf | word | all。' +
      'PDF 走 Tectonic（或 XeLaTeX+Latexmk），Word 走 Pandoc + python-docx；构建成功后按项目配置把交付文件发布到 deliverables 路径。' +
      '首次运行 Tectonic 会下载宏包，可能数分钟。返回 exitCode、逐项工具链来源、发布文件与日志尾部。' +
      '工具链缺失时**如实返回失败**，不会假装成功。',
    parameters: {
      project_dir: { type: 'string', description: '论文项目目录。省略时用配置项 defaultProjectDir。' },
      format: { type: 'string', enum: ['pdf', 'word', 'all'], description: '构建目标，默认 all。' },
      config: { type: 'string', description: '可选的显式项目配置路径。' },
      main: { type: 'string', description: '覆盖配置中的 LaTeX 入口（相对项目目录）。' },
      output_root: { type: 'string', description: '覆盖构建输出目录。' },
      citation_mode: { type: 'string', enum: ['linked', 'native'], description: 'Word 引用模式覆盖。' },
      word_refresh: { type: 'string', enum: ['auto', 'always', 'never'], description: 'Word 域刷新策略覆盖。' },
    },
    output: { schema: { type: 'json' }, render: renderJson },
    // 构建是重 IO 写盘任务，不与其他调用并行。
    isConcurrencySafe: () => false,
    timeoutMs: config?.buildTimeoutMs,
    async execute(args, exec) {
      let resolved
      try {
        resolved = projectArgs(args)
      } catch (error) {
        return failure(error)
      }
      const result = await runBuilderImpl({
        command: args.format || 'all',
        configPath: resolved.configPath,
        templateRoot: config?.templateRoot,
        projectDir: resolved.projectDir,
        toolchainDirs: config?.toolchainDirs,
        toolchain: config?.toolchain,
        main: args.main,
        outputRoot: args.output_root,
        citationMode: args.citation_mode,
        wordRefresh: args.word_refresh,
        signal: exec?.signal,
        timeoutMs: config?.buildTimeoutMs,
        maxLogBytes: config?.maxLogBytes,
      })
      const outcome = builderOutcome(result, { command: args.format || 'all' })
      // 上游缺陷有非常特征化的报错，给一条专门提示，而不是让模型对着
      // NameError / BuildError 反复重试（那会白烧好几轮）。
      const text = `${outcome.log || ''}${outcome.stderr || ''}`
      if (/_build_front_matter|_build_cover_page|_build_originality_page|_build_authorization_page/.test(text)) {
        // 缺陷 1（word_core 未绑定名）。**上游已修复**（`word_core.py:2271` 的排除集合已删除）。
        // 若仍出现，说明用户的 templateRoot 指向的是修复前的检出。
        outcome.kind = 'upstream-word-defect'
        outcome.message = 'word_core 存在「未绑定名」缺陷：_build_front_matter 等 4 个函数从未被绑定进 word_core'
        outcome.hint =
          '这是上游缺陷（不是你的项目问题），且**上游已修复**。' +
          '若仍报此错，说明 templateRoot 指向的是修复前的 YibinThesis 检出；' +
          '请更新该检出（修复内容：`word_core.py` 的 `_bind_oxml_module()` 删除了对 ' +
          '`_build_front_matter` / `_build_cover_page` / `_build_originality_page` / `_build_authorization_page` ' +
          '的排除），或直接使用随包副本（默认 templateRoot）。'
      } else if (/Word 后处理标记未清理/.test(text)) {
        // 缺陷 2（论文路径注入的 SECTION_REVIEW_* 标记无人消费）。**上游仍在修**。
        outcome.kind = 'upstream-word-defect'
        outcome.message = '上游论文路径注入了 SECTION_REVIEW_* 分节标记，但没有任何后处理消费它们'
        outcome.hint =
          '这是与「未绑定名」**独立**的第二处上游缺陷：`word_core.py:3066/3073/3075` 对论文路径也注入 ' +
          'SECTION_REVIEW_REFERENCES / SECTION_REVIEW_TAIL，而移除它们的代码在 `word_profiles.py:505-526` ' +
          '（属于 `_postprocess_review_docx`，只服务文献综述）；`word_core.py:2743-2749` 的「后处理标记未清理」' +
          '守卫因此必然抛错。插件不代修上游排版逻辑——**改用 PDF**（版式主输出，不受影响，已实测通过），' +
          '并把此不一致反馈给上游。'
      }
      return outcome
    },
  }))

  // ── 工具 5：yibinthesis_check ────────────────────────────────────────────
  disposers.push(defineAndRegister({
    name: 'yibinthesis_check',
    description:
      '对一个 YibinThesis 项目运行格式审计与模板回归（`build.ps1 check`）。它做**两件事**：' +
      '① 用 `lib/audit_format.py` 审计**所选论文**的版式（对比 word/reference.docx）；' +
      '② **无条件**构建模板自带的冒烟夹具 `tests/smoke.tex` 与 `tests/smoke-science.tex`（人文/理工两套回归）。' +
      '因此它比单纯「检查论文」慢，且要求 templateRoot 下有 tests/ 冒烟夹具（随包副本已含）。' +
      '**写盘**：只写构建输出目录（checkOutputRoot），不动论文源文件。exitCode 非 0 表示有检查项未通过。',
    parameters: {
      project_dir: { type: 'string', description: '论文项目目录。省略时用配置项 defaultProjectDir。' },
      config: { type: 'string', description: '可选的显式项目配置路径。' },
      citation_mode: { type: 'string', enum: ['linked', 'native'], description: 'Word 引用模式覆盖。' },
      word_refresh: { type: 'string', enum: ['auto', 'always', 'never'], description: 'Word 域刷新策略覆盖。' },
    },
    output: { schema: { type: 'json' }, render: renderJson },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      let resolved
      try {
        resolved = projectArgs(args)
      } catch (error) {
        return failure(error)
      }
      const result = await runBuilderImpl({
        command: 'check',
        configPath: resolved.configPath,
        templateRoot: config?.templateRoot,
        projectDir: resolved.projectDir,
        toolchainDirs: config?.toolchainDirs,
        toolchain: config?.toolchain,
        citationMode: args.citation_mode,
        wordRefresh: args.word_refresh,
        signal: exec?.signal,
        timeoutMs: config?.buildTimeoutMs,
        maxLogBytes: config?.maxLogBytes,
      })
      return builderOutcome(result, { command: 'check' })
    },
  }))

  // ── 工具 6：yibinthesis_clean ────────────────────────────────────────────
  disposers.push(defineAndRegister({
    name: 'yibinthesis_clean',
    description:
      '清理一个 YibinThesis 项目的构建产物（**删除**构建输出目录里的内容）。' +
      '只删除项目配置 outputRoot 之下的构建产物，不触碰 latex/ 下的论文源文件。',
    parameters: {
      project_dir: { type: 'string', description: '论文项目目录。省略时用配置项 defaultProjectDir。' },
      config: { type: 'string', description: '可选的显式项目配置路径。' },
    },
    output: { schema: { type: 'json' }, render: renderJson },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      let resolved
      try {
        resolved = projectArgs(args)
      } catch (error) {
        return failure(error)
      }
      const result = await runBuilderImpl({
        command: 'clean',
        configPath: resolved.configPath,
        templateRoot: config?.templateRoot,
        projectDir: resolved.projectDir,
        toolchainDirs: config?.toolchainDirs,
        toolchain: config?.toolchain,
        signal: exec?.signal,
        timeoutMs: config?.buildTimeoutMs,
        maxLogBytes: config?.maxLogBytes,
      })
      return builderOutcome(result, { command: 'clean' })
    },
  }))

  return disposers
}
