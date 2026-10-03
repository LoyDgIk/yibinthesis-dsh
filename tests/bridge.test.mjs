// 面板数据桥的路由测试。
//
// 为什么单独一层：面板是「给人看的」，它的数据面必须**可核验**——
// 「哪些路由可写」「响应会不会漏凭据」「失败是否如实回报」这三条性质只能靠测试钉死，
// 光看代码不容易发现。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const {
  makeBridgeRoutes,
  BRIDGE_PREFIX,
  BRIDGE_VERSION,
  BRIDGE_ROUTES,
  BRIDGE_WRITE_ROUTES,
  statFile,
  describeDeliverable,
  readProjectConfig,
  validateDeliverableTemplate,
  writeDeliverables,
  categorizeProjectFile,
  isIgnorableProjectFile,
} = await import('../lib/bridge.js')
const { CONFIG_DEFAULTS } = await import('../lib/config.js')

/**
 * 以最小 req/res 替身驱动一个路由。
 * @param route - 路由对象。
 * @param method - HTTP 方法。
 * @param url - 请求 URL。
 * @param body - 可选 JSON 请求体（POST 用）。
 */
function invokeRoute(route, method, url, body) {
  return new Promise((resolve) => {
    const handlers = {}
    const req = {
      method,
      url,
      on(event, handler) {
        handlers[event] = handler
        return this
      },
      destroy() {},
    }
    const res = {
      status: null,
      headers: null,
      writableEnded: false,
      destroyed: false,
      writeHead(status, headers) {
        this.status = status
        this.headers = headers
      },
      end(body) {
        this.writableEnded = true
        resolve({ status: this.status, headers: this.headers, body: JSON.parse(body) })
      },
      on() {
        return this
      },
    }
    Promise.resolve(route.handler(req, res)).catch((error) => {
      resolve({ status: 500, body: { ok: false, error: { kind: 'threw', message: String(error?.message || error) } } })
    })
    // POST：把 JSON 体喂给 handler 注册的 data/end 监听（`readJsonBody` 就是这么读的）。
    if (body !== undefined) {
      handlers.data?.(Buffer.from(JSON.stringify(body), 'utf8'))
    }
    handlers.end?.()
  })
}

/** 造一个最小但真实的项目目录。 */
function makeProject({ pdfExists = false, pdfWithPlaceholders = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ybt-bridge-'))
  mkdirSync(join(dir, 'latex', 'chapters'), { recursive: true })
  writeFileSync(join(dir, 'latex', 'main.tex'), '\\documentclass[thesis,science]{yibinthesis}\n', 'utf8')
  writeFileSync(join(dir, 'latex', 'metadata.tex'), '\\yibinsetup{\n  title = {桥测试},\n}\n', 'utf8')
  writeFileSync(join(dir, 'latex', 'chapters', '10-intro.tex'), '汉字若干。\n', 'utf8')
  const pdfPath = pdfWithPlaceholders ? 'build/deliverables/{{title}}.pdf' : 'build/deliverables/thesis.pdf'
  writeFileSync(
    join(dir, 'yibinthesis.project.json'),
    JSON.stringify({
      schemaVersion: 1,
      main: 'latex/main.tex',
      outputRoot: 'build',
      citationMode: 'linked',
      deliverables: { pdf: pdfPath, word: 'build/deliverables/thesis.docx' },
    }),
    'utf8',
  )
  if (pdfExists && !pdfWithPlaceholders) {
    mkdirSync(join(dir, 'build', 'deliverables'), { recursive: true })
    writeFileSync(join(dir, 'build', 'deliverables', 'thesis.pdf'), 'x'.repeat(2048), 'utf8')
  }
  return dir
}

test('桥：路由全集正确；写路由必须显式登记，其余一律只读', async () => {
  const routes = makeBridgeRoutes({ config: { ...CONFIG_DEFAULTS } })
  const paths = routes.map((route) => route.path).sort()
  assert.deepEqual(paths, [
    `${BRIDGE_PREFIX}/deliverables`,
    `${BRIDGE_PREFIX}/doctor`,
    `${BRIDGE_PREFIX}/files`,
    `${BRIDGE_PREFIX}/probe`,
    `${BRIDGE_PREFIX}/state`,
  ])
  // 导出的清单必须与实际注册一致（宿主自检依赖它判断「桥挂上没挂上」）。
  assert.deepEqual(paths, BRIDGE_ROUTES.map((r) => BRIDGE_PREFIX + r).sort())
  // 「登记为工作区」已整体移除：它的路由不得复活（移除功能时最容易留下的就是一条
  // 没人调用的写路由——那等于悄悄保留了一个写盘入口）。
  assert.ok(!routes.some((route) => route.path.endsWith('/workspace')), '/workspace 路由应已移除')
  assert.deepEqual([...BRIDGE_WRITE_ROUTES], ['/deliverables'], '写路由清单应只剩 /deliverables')

  for (const route of routes) {
    assert.equal(route.kind, 'exact')
    assert.equal(typeof route.handler, 'function')
    const suffix = route.path.slice(BRIDGE_PREFIX.length)
    const isWriteRoute = BRIDGE_WRITE_ROUTES.includes(suffix)
    // PUT/DELETE 对任何路由都不开放。
    for (const method of ['PUT', 'DELETE']) {
      const captured = await invokeRoute(route, method, route.path)
      assert.equal(captured.status, 405, `${route.path} 不该接受 ${method}`)
    }
    if (isWriteRoute) {
      // 写路由必须**显式**列在 BRIDGE_WRITE_ROUTES 里——新增写操作时会被强制登记，
      // 不会因为「顺手加了个 POST」而无声扩大写面。
      assert.equal(suffix, '/deliverables', `写路由未登记：${suffix}`)
      continue
    }
    const captured = await invokeRoute(route, 'POST', route.path)
    assert.equal(captured.status, 405, `${route.path} 不在写白名单里，不该接受 POST`)
  }
})

test('★ 交付文件名模板校验：判据来自上游 schema，拒绝绝对路径与错误扩展名', () => {
  const ok = (v, ext) => validateDeliverableTemplate(v, ext)
  assert.equal(ok('build/deliverables/thesis.pdf', '.pdf').ok, true)
  assert.equal(ok('build/deliverables/{{title}}-{{author}}.pdf', '.pdf').ok, true)
  assert.equal(ok('  build/deliverables/x.docx  ', '.docx').value, 'build/deliverables/x.docx', '应去除首尾空白')

  // 扩展名必须匹配（上游 schema 的 pattern）。
  assert.equal(ok('build/x.docx', '.pdf').ok, false)
  assert.equal(ok('build/x.pdf', '.docx').ok, false)
  assert.equal(ok('build/x.pdf', '.pdf').ok, true)
  assert.equal(ok('build/deliverables/x.docx', '.docx').ok, true)
  assert.match(ok('build/x.docx', '.pdf').message, /\.pdf/)

  // 绝对路径必须拒绝：写死盘符会让项目换机即失效。
  assert.equal(ok('E:\\论文\\out.pdf', '.pdf').ok, false)
  assert.equal(ok('E:/论文/out.pdf', '.pdf').ok, false)
  assert.equal(ok('\\\\server\\share\\out.pdf', '.pdf').ok, false)
  assert.equal(ok('/home/u/out.pdf', '.pdf').ok, false)
  assert.match(ok('E:\\x.pdf', '.pdf').message, /绝对路径/)

  // 上跳目录拒绝。
  assert.equal(ok('../outside/out.pdf', '.pdf').ok, false)

  // 空值拒绝。
  assert.equal(ok('', '.pdf').ok, false)
  assert.equal(ok('   ', '.pdf').ok, false)

  // 占位符格式必须规范（防止把坏模板写进配置）。
  assert.equal(ok('build/{{ Title }}.pdf', '.pdf').ok, false)
  assert.equal(ok('build/{{}}.pdf', '.pdf').ok, false)
  assert.equal(ok('build/{{ok-1}}.pdf', '.pdf').ok, true)
})

test('★ 写回项目配置：只动 deliverables，其余键与内容原样保留', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ybt-write-'))
  const configPath = join(dir, 'yibinthesis.project.json')
  const original = {
    $schema: '../YibinThesis/yibinthesis.project.schema.json',
    schemaVersion: 1,
    main: 'latex/main.tex',
    outputRoot: 'build',
    checkOutputRoot: 'build/checks',
    citationMode: 'linked',
    wordRefresh: 'auto',
    deliverables: { pdf: 'build/deliverables/thesis.pdf', word: 'build/deliverables/thesis.docx' },
  }
  writeFileSync(configPath, JSON.stringify(original, null, 2) + '\n', 'utf8')

  const result = writeDeliverables(configPath, { pdf: 'build/deliverables/{{title}}.pdf' })
  assert.equal(result.ok, true)
  assert.equal(result.value.pdf, 'build/deliverables/{{title}}.pdf')
  assert.equal(result.value.word, 'build/deliverables/thesis.docx', '未改的字段必须保持')

  const after = JSON.parse(readFileSync(configPath, 'utf8'))
  // 关键：除 deliverables.pdf 外，其余键逐个字节级等价。
  assert.deepEqual(Object.keys(after), Object.keys(original), '不得增删顶层键')
  assert.equal(after.$schema, original.$schema, '$schema 必须原样保留')
  assert.equal(after.schemaVersion, original.schemaVersion)
  assert.equal(after.main, original.main)
  assert.equal(after.outputRoot, original.outputRoot)
  assert.equal(after.checkOutputRoot, original.checkOutputRoot)
  assert.equal(after.citationMode, original.citationMode)
  assert.equal(after.wordRefresh, original.wordRefresh)

  // 非法 JSON 必须拒绝改写（不能把用户文件写坏）。
  writeFileSync(configPath, '{ not json', 'utf8')
  const refused = writeDeliverables(configPath, { pdf: 'x.pdf' })
  assert.equal(refused.ok, false)
  assert.equal(refused.error.kind, 'project-invalid')
  assert.equal(readFileSync(configPath, 'utf8'), '{ not json', '配置文件必须原封不动')

  rmSync(dir, { recursive: true, force: true })
})

test('★ 桥：POST /deliverables 校验后写盘，并用**回读**的真实状态应答', async () => {
  const project = makeProject()
  const routes = makeBridgeRoutes({ config: { ...CONFIG_DEFAULTS } })
  const route = routes.find((r) => r.path.endsWith('/deliverables'))

  // 非法值：必须 400，且**不得**改动磁盘。
  const before = readFileSync(join(project, 'yibinthesis.project.json'), 'utf8')
  const bad = await invokeRoute(route, 'POST', `${BRIDGE_PREFIX}/deliverables`, { projectDir: project, pdf: 'E:\\abs\\x.pdf', word: 'build/deliverables/thesis.docx' })
  assert.equal(bad.status, 400)
  assert.equal(bad.body.error.kind, 'invalid-template')
  assert.equal(bad.body.error.field, 'pdf')
  assert.equal(readFileSync(join(project, 'yibinthesis.project.json'), 'utf8'), before, '校验失败绝不能写盘')

  // 合法值：写盘并回读。
  const good = await invokeRoute(route, 'POST', `${BRIDGE_PREFIX}/deliverables`, {
    projectDir: project,
    pdf: 'build/deliverables/{{title}}.pdf',
    word: 'build/deliverables/thesis.docx',
  })
  assert.equal(good.status, 200)
  assert.equal(good.body.ok, true)
  assert.equal(good.body.pdf.template, 'build/deliverables/{{title}}.pdf')
  assert.equal(good.body.pdf.hasPlaceholders, true, '回读应识别占位符')
  const after = JSON.parse(readFileSync(join(project, 'yibinthesis.project.json'), 'utf8'))
  assert.equal(after.deliverables.pdf, 'build/deliverables/{{title}}.pdf')
  assert.equal(after.schemaVersion, 1, '其余字段不得被动')

  // 空 patch：应报 nothing-to-do 而不是静默成功。
  const empty = await invokeRoute(route, 'POST', `${BRIDGE_PREFIX}/deliverables`, { projectDir: project })
  assert.equal(empty.status, 400)
  assert.equal(empty.body.error.kind, 'nothing-to-do')

  rmSync(project, { recursive: true, force: true })
})

test('★ 文件分类：正文与资源必须分开（实测项目 148 个文件、资源占 106）', () => {
  // 判据来自一个**真实**论文项目的目录结构：
  //   latex/ (66)  → chapters/*.tex 12、main/metadata/references 3、assets/ 52
  //   图表资源/ (44)、plan/ (26, 全 .md 与 json)、tmp/ (10, 全 .png)
  // 混成一个列表时正文会被资源淹没，用户反馈「资产目录和正文混在一起」。
  // ① 正文：`latex/` 下的 `.tex`。
  for (const path of ['latex/chapters/10-introduction.tex', 'latex/main.tex', 'latex/metadata.tex', 'latex/chapters/90-appendix.tex']) {
    assert.equal(categorizeProjectFile(path), 'source', `${path} 应判为正文`)
  }

  // ② 关键回归：`latex/assets/` 里的**图片不是正文**。
  //    早期判据是「以 latex/ 开头即正文」，于是 `latex/assets/本人签名.jpg`
  //    与 52 个分析中间件被当成了正文。
  for (const path of [
    'latex/assets/本人签名.jpg',
    'latex/assets/analysis/fig14_standard_publisher_distribution.png',
    'latex/assets/map.tex',
  ]) {
    assert.equal(categorizeProjectFile(path), 'assets', `${path} 应判为资源（不得混进正文）`)
  }

  // ③ 中文资源目录按目录名判定，不靠扩展名猜。
  assert.equal(categorizeProjectFile('图表资源/重构/图1_TFIDF.png'), 'assets')
  assert.equal(categorizeProjectFile('图表资源/说明.md'), 'assets', '资源目录里的 md 仍属资源')

  // ④ 数据与文档。
  assert.equal(categorizeProjectFile('latex/references.bib'), 'data')
  assert.equal(categorizeProjectFile('yibinthesis.project.json'), 'data')
  assert.equal(categorizeProjectFile('plan/chapter-architecture.md'), 'docs')
  assert.equal(categorizeProjectFile('plan/review/teacher-comments.json'), 'data', 'plan 下的 json 是数据')

  // ⑤ 目录名优先于扩展名：`tmp/pdfs/page-016.png` 仍是资源。
  assert.equal(categorizeProjectFile('tmp/pdfs/page-016.png'), 'assets')

  // ⑥ 未知扩展名落到 other，不误判。
  assert.equal(categorizeProjectFile('weird.xyz'), 'other')
})

test('★ 文件分类：Office 锁定残留（`~$xxx.docx`）不进清单', () => {
  // Word 异常退出会留下 `~$文件名.docx`；它不是项目内容，列出来只是噪音。
  assert.equal(isIgnorableProjectFile('~$论文初稿-谯晨.docx'), true)
  assert.equal(isIgnorableProjectFile('论文初稿-谯晨.docx'), false)
  assert.equal(isIgnorableProjectFile('latex/main.tex'), false)
})

test('★ /files：分类计数与实际文件一致，锁文件被排除，正文排在最前', () => {
  const project = makeProject()
  mkdirSync(join(project, 'latex', 'assets'), { recursive: true })
  writeFileSync(join(project, 'latex', 'assets', '签名.jpg'), 'x', 'utf8')
  writeFileSync(join(project, 'latex', 'assets', 'notes.md'), '# 分析笔记', 'utf8')
  writeFileSync(join(project, '~$lock.docx'), 'x', 'utf8')

  const routes = makeBridgeRoutes({ config: { ...CONFIG_DEFAULTS } })
  const route = routes.find((r) => r.path.endsWith('/files'))
  return invokeRoute(route, 'GET', `${BRIDGE_PREFIX}/files?projectDir=${encodeURIComponent(project)}`).then((captured) => {
    assert.equal(captured.body.ok, true)
    const { files, categories } = captured.body
    const rels = files.map((f) => f.relative)

    assert.ok(!rels.some((r) => r.includes('~$')), `锁文件不该出现：${rels.join(', ')}`)

    // 分类计数必须与逐文件判定一致（防止计数与实际脱节）。
    for (const key of Object.keys(categories)) {
      const actual = files.filter((f) => f.category === key).length
      assert.equal(categories[key], actual, `分类 ${key} 的计数与实际不一致`)
    }
    assert.ok(categories.source >= 1, '应有正文文件')
    assert.ok(categories.assets >= 2, 'assets 目录里的图片与笔记都应算资源')

    // `latex/assets/` 的内容**不得**被判为正文。
    for (const file of files.filter((f) => f.relative.startsWith('latex/assets/'))) {
      assert.notEqual(file.category, 'source', `${file.relative} 不该是正文`)
    }

    // 排序：正文在前（面板默认展示第一类）。
    assert.equal(files[0].category, 'source', '正文应排在最前')

    rmSync(project, { recursive: true, force: true })
  })
})

test('★ 桥：/files 列出源文件、跳过构建产物目录', () => {
  const project = makeProject({ pdfExists: true })
  const routes = makeBridgeRoutes({ config: { ...CONFIG_DEFAULTS } })
  const route = routes.find((r) => r.path.endsWith('/files'))
  return invokeRoute(route, 'GET', `${BRIDGE_PREFIX}/files?projectDir=${encodeURIComponent(project)}`).then((captured) => {
    assert.equal(captured.status, 200)
    assert.equal(captured.body.ok, true)
    const rels = captured.body.files.map((f) => f.relative)
    assert.ok(rels.includes('yibinthesis.project.json'), '应列出项目配置')
    assert.ok(rels.includes('latex/main.tex'), '应列出 LaTeX 入口')
    assert.ok(
      !rels.some((r) => r.startsWith('build/')),
      `构建产物不该出现在源文件清单里：${rels.filter((r) => r.startsWith('build/')).join(', ')}`,
    )
    // `latex/` 下的文件排在最前（那才是要写的正文）。
    assert.equal(captured.body.files[0].source, true, 'latex/ 下的文件应排在最前')
    assert.ok(captured.body.files.every((f) => typeof f.path === 'string' && f.path.startsWith(project)))
    rmSync(project, { recursive: true, force: true })
  })
})

test('桥：/state 标注只读并回传全部生效配置，且不含凭据字段', async () => {
  const [stateRoute] = makeBridgeRoutes({ config: { ...CONFIG_DEFAULTS } })
  const captured = await invokeRoute(stateRoute, 'GET', `${BRIDGE_PREFIX}/state`)
  assert.equal(captured.status, 200)
  assert.equal(captured.body.ok, true)
  assert.equal(captured.body.bridgeVersion, BRIDGE_VERSION)
  assert.equal(captured.body.readOnly, true)
  // 面板「生效配置」区依赖这些键存在（缺失会渲染成 undefined）。
  for (const key of ['templateRoot', 'cliRoot', 'defaultProjectDir', 'toolchainDirs', 'toolchain']) {
    assert.ok(key in captured.body.config, `config 缺少 ${key}`)
  }
  const serialized = JSON.stringify(captured.body).toLowerCase()
  for (const needle of ['apikey', 'api_key', 'token', 'secret', 'password', 'credential']) {
    assert.ok(!serialized.includes(needle), `桥响应不得包含 "${needle}"`)
  }
})

test('桥：/probe 走适配器返回结构化摘要（真跑 Python）', async (t) => {
  const project = makeProject()
  const routes = makeBridgeRoutes({ config: { ...CONFIG_DEFAULTS } })
  const probeRoute = routes.find((route) => route.path.endsWith('/probe'))
  const captured = await invokeRoute(probeRoute, 'GET', `${BRIDGE_PREFIX}/probe?projectDir=${encodeURIComponent(project)}`)
  assert.equal(captured.status, 200)
  if (!captured.body.ok && /适配器|adapter/.test(JSON.stringify(captured.body))) {
    t.skip('本机无法运行 Python 适配器')
    rmSync(project, { recursive: true, force: true })
    return
  }
  assert.equal(captured.body.ok, true, JSON.stringify(captured.body).slice(0, 300))
  assert.equal(captured.body.metadata.title, '桥测试')
  assert.equal(captured.body.project.documentClass.documentType, 'thesis')
  assert.equal(captured.body.chapters.length, 1)
  assert.ok(captured.body.totalHan > 0)
  rmSync(project, { recursive: true, force: true })
})

test('桥：/probe 在非项目目录上给 400 与可操作提示', async () => {
  const empty = mkdtempSync(join(tmpdir(), 'ybt-empty-'))
  const routes = makeBridgeRoutes({ config: { ...CONFIG_DEFAULTS } })
  const probeRoute = routes.find((route) => route.path.endsWith('/probe'))
  const captured = await invokeRoute(probeRoute, 'GET', `${BRIDGE_PREFIX}/probe?projectDir=${encodeURIComponent(empty)}`)
  assert.equal(captured.status, 400)
  assert.equal(captured.body.ok, false)
  assert.equal(captured.body.error.kind, 'no-project')
  rmSync(empty, { recursive: true, force: true })
})

test('桥：/deliverables 报告交付物存在性与体积/时间', async () => {
  const withPdf = makeProject({ pdfExists: true })
  const withoutPdf = makeProject({ pdfExists: false })
  const routes = makeBridgeRoutes({ config: { ...CONFIG_DEFAULTS } })
  const route = routes.find((r) => r.path.endsWith('/deliverables'))

  const a = await invokeRoute(route, 'GET', `${BRIDGE_PREFIX}/deliverables?projectDir=${encodeURIComponent(withPdf)}`)
  assert.equal(a.body.ok, true)
  assert.equal(a.body.pdf.exists, true)
  assert.equal(a.body.pdf.size, 2048)
  assert.ok(a.body.pdf.mtimeMs > 0, '应带回生成时间')
  assert.equal(a.body.word.exists, false, '未生成的 DOCX 应报 exists:false')
  assert.equal(a.body.buildRootExists, true)

  const b = await invokeRoute(route, 'GET', `${BRIDGE_PREFIX}/deliverables?projectDir=${encodeURIComponent(withoutPdf)}`)
  assert.equal(b.body.pdf.exists, false)
  assert.equal(b.body.pdf.size, null)
  rmSync(withPdf, { recursive: true, force: true })
  rmSync(withoutPdf, { recursive: true, force: true })
})

test('桥：/deliverables 对含 {{占位符}} 的路径如实标注（不假装能解析）', async () => {
  const project = makeProject({ pdfExists: true, pdfWithPlaceholders: true })
  const routes = makeBridgeRoutes({ config: { ...CONFIG_DEFAULTS } })
  const route = routes.find((r) => r.path.endsWith('/deliverables'))
  const captured = await invokeRoute(route, 'GET', `${BRIDGE_PREFIX}/deliverables?projectDir=${encodeURIComponent(project)}`)
  assert.equal(captured.body.pdf.hasPlaceholders, true)
  assert.equal(captured.body.pdf.resolved, null, '带占位符时不应伪造解析结果')
  assert.equal(captured.body.pdf.exists, false)
  rmSync(project, { recursive: true, force: true })
})

test('桥：/doctor 用注入的假构建器驱动（不真跑 PowerShell）', async () => {
  const project = makeProject()
  const stdout = [
    'YibinThesis dependency doctor',
    '  [OK]      Tectonic (optional) - C:\\t\\tectonic.exe [known local path] | Tectonic 0.17.0',
    '  [MISSING] Biber (required) - not found',
    '  PDF toolchain:  NOT READY',
    '  Word toolchain: NOT READY',
    'Doctor result: NOT READY (exit code 2)',
  ].join('\n')
  const routes = makeBridgeRoutes({
    config: { ...CONFIG_DEFAULTS },
    runBuilderImpl: async () => ({ exitCode: 2, stdout, stderr: '', kind: null, message: null, truncated: false, toolchain: {} }),
  })
  const route = routes.find((r) => r.path.endsWith('/doctor'))
  const captured = await invokeRoute(route, 'GET', `${BRIDGE_PREFIX}/doctor?projectDir=${encodeURIComponent(project)}`)
  assert.equal(captured.status, 200)
  assert.equal(captured.body.ok, true, 'exit 2 属于「可预期的未就绪」，桥本身仍成功')
  assert.equal(captured.body.ready, false)
  assert.equal(captured.body.exitCode, 2)
  assert.equal(captured.body.kind, 'missing-toolchain')
  assert.match(captured.body.stdout, /Biber/)
  rmSync(project, { recursive: true, force: true })
})

test('桥：客户端断开时不抛（写入受保护）', async () => {
  const routes = makeBridgeRoutes({ config: { ...CONFIG_DEFAULTS } })
  const route = routes[0]
  const req = { method: 'GET', url: `${BRIDGE_PREFIX}/state`, on: () => req, destroy() {} }
  // 模拟已结束的响应：writeHead/end 不该被调用（否则 host 进程会抛未捕获异常）。
  let wrote = false
  const res = {
    writableEnded: true,
    destroyed: false,
    writeHead() {
      wrote = true
    },
    end() {
      wrote = true
    },
    on: () => res,
  }
  await route.handler(req, res)
  assert.equal(wrote, false, '已结束的响应不应再写入')
})

test('statFile / describeDeliverable / readProjectConfig：纯函数语义', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ybt-stat-'))
  writeFileSync(join(dir, 'a.txt'), 'hello', 'utf8')
  assert.equal(statFile(join(dir, 'a.txt')).exists, true)
  assert.equal(statFile(join(dir, 'a.txt')).size, 5)
  assert.equal(statFile(join(dir, 'missing.txt')).exists, false)
  assert.equal(statFile(dir).exists, false, '目录不算文件')

  // 空模板 → 全 null。
  const empty = describeDeliverable(dir, '')
  assert.equal(empty.template, null)
  assert.equal(empty.resolved, null)

  // 相对路径按 configRoot 解析。
  const rel = describeDeliverable(dir, 'out/x.pdf')
  assert.equal(rel.resolved, join(dir, 'out', 'x.pdf'))
  assert.equal(rel.exists, false)

  // 非法配置 → ok:false 且带 kind。
  writeFileSync(join(dir, 'yibinthesis.project.json'), '{ not json', 'utf8')
  const bad = readProjectConfig(dir)
  assert.equal(bad.ok, false)
  assert.equal(bad.error.kind, 'project-invalid')

  rmSync(dir, { recursive: true, force: true })
})
