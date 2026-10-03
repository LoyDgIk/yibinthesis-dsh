// 客户端半的**渲染测试**：用 `support/client-harness.mjs` 真执行 `apply()` 与组件渲染。
//
// 为什么必须有这一层：`lib/client.js` 是浏览器代码，跑不了 `node --check` 之外的东西；
// 而它的失效模式全是**静默**的——注册写错只是组件不出现，渲染期抛错会被 React 吞成空面板。
// 实测教训：用户看到的面板「空的」，正是这样漏出去的（见文件末尾的回归条目）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClientHarness } from './support/client-harness.mjs'

const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url))
const SOURCE = readFileSync(join(PACKAGE_ROOT, 'lib', 'client.js'), 'utf8')

/** 常用假响应：/state。 */
const stateBody = (overrides = {}) => ({
  ok: true,
  bridgeVersion: 2,
  readOnly: true,
  plugin: { name: 'yibinthesis-dsh' },
  config: {
    templateRoot: 'E:\\tpl\\vendor\\yibinthesis',
    cliRoot: 'E:\\cli',
    defaultProjectDir: 'E:\\proj',
    toolchainDirs: ['E:\\tools'],
    toolchain: {},
  },
  project: { dir: 'E:\\proj', hasConfig: false, configName: 'yibinthesis.project.json' },
  ...overrides,
})

/** 覆盖全部四条路由的假 fetch。 */
function makeFetchImpl(overrides = {}) {
  return (url) => {
    const route = String(url).replace(/^.*\/api\/yibinthesis/, '').split('?')[0]
    if (overrides[route]) return overrides[route]
    if (route === '/state') return stateBody()
    if (route === '/probe') {
      return {
        ok: true,
        metadata: {
          title: '示例论文题目',
          author: '张三',
          'student-id': '20230001',
          grade: '2023',
          college: '示例学院',
          major: '示例专业',
          advisor: '李四',
          'advisor-title': '教授',
        },
        project: { documentClass: { class: 'yibinthesis', documentType: 'thesis', discipline: 'science' } },
        config: { citationMode: 'linked' },
        chapters: [{ file: 'a.tex' }, { file: 'b.tex' }, { file: 'c.tex' }],
        totalHan: 1234,
      }
    }
    if (route === '/deliverables') {
      return {
        ok: true,
        buildRoot: 'E:\\proj\\build',
        buildRootExists: true,
        pdf: {
          template: 'build/deliverables/thesis.pdf',
          resolved: 'E:\\proj\\build\\deliverables\\thesis.pdf',
          hasPlaceholders: false,
          exists: true,
          size: 160975,
          mtimeMs: 1791044524936,
        },
        word: {
          template: 'build/deliverables/thesis.docx',
          resolved: 'E:\\proj\\build\\deliverables\\thesis.docx',
          hasPlaceholders: false,
          exists: false,
          size: null,
          mtimeMs: null,
        },
      }
    }
    if (route === '/doctor') {
      return {
        ok: true,
        ready: true,
        exitCode: 0,
        kind: null,
        stdout: [
          '  [OK]      Tectonic (optional) - C:\\t\\tectonic.exe [known local path] | Tectonic 0.17.0',
          '  [OK]      Biber (required) - E:\\b\\biber.exe [env:YIBINTHESIS_BIBER] | biber version: 2.17',
          '  PDF toolchain:  READY',
          '  Word toolchain: READY',
        ].join('\n'),
      }
    }
    return { ok: false, error: { kind: 'unexpected', message: `未预期的路由：${route}` } }
  }
}

/**
 * 遍历已求值树，收集所有「组件抛错」节点。
 *
 * 这一层存在的理由（实装教训）：渲染器如实记录了组件抛错，但测试若只断言「文本非空」，
 * 一个抛错的子组件会让**它那棵子树**变空却不影响其它子树——于是测试照样绿，实机看到空白。
 * 因此每次渲染后都必须断言这里为空。
 * @param node - 已求值节点。
 * @returns 抛错信息列表。
 */
function collectThrows(node) {
  if (!node) return []
  if (node.kind === 'threw') return [node.message]
  if (node.kind === 'component') return collectThrows(node.child)
  if (node.kind === 'fragment') return node.children.flatMap(collectThrows)
  if (node.kind === 'host') return node.children.flatMap(collectThrows)
  return []
}

/** 挂载客户端并跑一次 apply。 */
function boot({ fetchImpl, config = {} } = {}) {
  const harness = createClientHarness({ source: SOURCE, fetchImpl })
  harness.exports.apply(harness.ctx, config)
  return harness
}

test('客户端工厂：可加载、导出 apply/inject，且 id 是包名', () => {
  const harness = boot()
  assert.equal(harness.spec.id, 'yibinthesis-dsh')
  assert.equal(typeof harness.exports.apply, 'function')
  assert.equal(harness.exports.inject.join(','), 'slots,locale')
})

test('★ 注册面：会话右侧栏标签（声明 + body + 标签头）与插件行配置页齐备', () => {
  const harness = boot()

  // ① tab 条目本身必须声明——没有它标签不会出现在右侧栏。
  assert.equal(harness.rightTabs.length, 1, '必须声明恰好一个会话右侧栏标签')
  const tab = harness.rightTabs[0]
  assert.equal(typeof tab.id, 'string')
  assert.ok(tab.id.length > 0, 'tab 必须有 id')
  assert.equal(typeof tab.kind, 'string')
  assert.equal(typeof tab.title, 'function', 'title 必须是 thunk（切语言时重算）')
  assert.ok(tab.title().trim().length > 0, 'tab 标题不能为空')

  // ⑤ guide 条目**必须给**：右侧栏标签不是自动出现的，用户要在右侧栏的「开始」页里
  //    选一个 provider 才会打开面板。没有 guide，provider 不出现在该页
  //    ——这正是「标签条里看不到它」的实装缺陷。
  assert.ok(Array.isArray(tab.guide) && tab.guide.length >= 1, 'tab 必须带 guide 条目（否则用户无法选中它）')
  const guide = tab.guide[0]
  assert.equal(typeof guide.order, 'number', 'guide 需要 order 决定卡片位置')
  assert.equal(typeof guide.title, 'function', 'guide.title 必须是 thunk')
  assert.ok(guide.title().trim().length > 0, 'guide 标题不能为空')
  assert.ok(typeof guide.description === 'function' && guide.description().trim().length > 0, 'guide 需要非空描述')
  assert.equal(typeof guide.icon, 'function', 'guide 应带图标组件')

  // ② body 与 ③ 标签头，两者必须与 tab 声明用**同一个 id**（契约：按 kind 生效的 type id 分发）。
  const body = harness.registrationFor('sidebar.right.pane.tab')
  const title = harness.registrationFor('sidebar.right.pane.tab.title')
  assert.ok(body, '必须注册 sidebar.right.pane.tab（body）')
  assert.ok(title, '必须注册 sidebar.right.pane.tab.title（标签头）')
  assert.equal(body.options.key, tab.id, 'body 的 key 必须等于 tab 的 id')
  assert.equal(title.options.key, tab.id, '标签头的 key 必须等于 tab 的 id')

  // ④ 插件行配置页作为备用入口保留。
  assert.ok(harness.registrationFor('plugins.row.config'), '必须保留插件行配置入口')
})

test('词典：zh/en 键集一致，且面板用到的键都在', () => {
  const harness = boot()
  assert.equal(harness.localeRegistrations.length, 1)
  const dicts = harness.localeRegistrations[0].dicts
  assert.deepEqual(Object.keys(dicts.zh).sort(), Object.keys(dicts.en).sort(), 'zh/en 键集必须一致')
  for (const key of ['panel.title', 'doc.thesis', 'doc.proposal', 'doc.literatureReview', 'disc.humanities', 'disc.science']) {
    assert.ok(dicts.zh[key], `词典缺 ${key}`)
  }
})

test('★ 标签标题组件必须渲染出非空文字（空白标签等于不存在）', () => {
  const harness = boot()
  const Title = harness.componentFor('sidebar.right.pane.tab.title')
  const tree = harness.mount(Title, { t: (key) => (key === 'panel.title' ? '论文工具' : key) })
  assert.equal(tree.child.kind, 'host')
  assert.match(harness.text, /论文工具/)
})

test('★ guide 条目的图标必须渲染出 svg，并用 currentColor 跟随主题', () => {
  const harness = boot()
  const icon = harness.rightTabs[0].guide[0].icon
  assert.equal(typeof icon, 'function', 'guide 条目应带图标')
  const tree = harness.mount(icon, { size: 18, active: false })
  assert.equal(tree.child.kind, 'host')
  assert.equal(tree.child.type, 'svg')
  assert.equal(tree.child.props.width, 18)
  assert.equal(tree.child.props.stroke, 'currentColor')
})

test('★ 图标不得因拿不到 size 就不渲染（回退默认尺寸）', () => {
  const harness = boot()
  const icon = harness.rightTabs[0].guide[0].icon
  const tree = harness.mount(icon, {})
  assert.equal(tree.child.type, 'svg', '无 size 时仍须渲染')
  assert.equal(tree.child.props.width, 18, '无 size 时回退 18')
})

test('★ 回归：面板首渲染就非空，且自动取 /state', async () => {
  const harness = boot({ fetchImpl: makeFetchImpl() })
  const Body = harness.componentFor('sidebar.right.pane.tab')
  harness.mount(Body, {})
  await harness.flush()

  const text = harness.text
  assert.deepEqual(collectThrows(harness.tree), [], '渲染期不得有任何组件抛错（抛错会让那棵子树变空白）')
  assert.ok(text.length > 0, '面板渲染结果不能为空——「空的」正是本次要防的缺陷')
  assert.ok(text.includes('论文项目'), `应含「论文项目」区块，实际：${text.slice(0, 300)}`)
  assert.ok(text.includes('yibinthesis.project.json'), `应显示项目配置文件名，实际：${text.slice(0, 300)}`)
  // 生效配置**默认折叠**：诊断信息不该常驻占窄栏的地方。折叠时只留一个可点的标题，
  // 路径不渲染；展开后才出现。这两条一起断言，防止有人把「折叠」写成「隐藏且点不开」。
  assert.ok(text.includes('生效配置'), '折叠状态也要有可点的标题')
  assert.ok(!text.includes('E:\\tpl\\vendor\\yibinthesis'), '折叠时不该渲染具体路径')
  assert.ok(harness.styleEls.length >= 1, '必须注入样式表（否则面板无版式）')
  assert.ok(harness.fetchCalls.some((u) => u.includes('/state')), '应请求 /state')
  assert.ok(!harness.fetchCalls.some((u) => u.includes('/probe')), 'hasConfig=false 时不该请求 /probe')
})

test('★ 生效配置可展开：展开后显示 templateRoot / cliRoot / toolchainDirs', async () => {
  const harness = boot({ fetchImpl: makeFetchImpl() })
  const Body = harness.componentFor('sidebar.right.pane.tab')
  harness.mount(Body, {})
  await harness.flush()
  assert.ok(!harness.text.includes('E:\\tpl\\vendor\\yibinthesis'), '前置：默认折叠')

  // 点「生效配置」这个可点标题（它是唯一的 plain 按钮，文本以 ▸ 开头）。
  const buttons = []
  const collect = (node) => {
    if (!node) return
    if (node.kind === 'host' && node.type === 'button') buttons.push(node)
    if (node.kind === 'host') node.children.forEach(collect)
    if (node.kind === 'component') collect(node.child)
    if (node.kind === 'fragment') node.children.forEach(collect)
  }
  collect(harness.tree)
  const toggle = buttons.find((b) => (b.children || []).some((c) => c.kind === 'text' && c.text.includes('生效配置')))
  assert.ok(toggle, '应存在「生效配置」切换按钮')
  assert.equal(typeof toggle.props.onClick, 'function')
  toggle.props.onClick()
  await harness.flush()

  assert.ok(harness.text.includes('E:\\tpl\\vendor\\yibinthesis'), '展开后应显示 templateRoot')
  assert.ok(harness.text.includes('E:\\cli'), '展开后应显示 cliRoot')
  assert.ok(harness.text.includes('E:\\tools'), '展开后应显示 toolchainDirs')
})

test('★ 数据落地后：probe / deliverables / doctor 三块内容都要渲染出来', async () => {
  const harness = boot({
    fetchImpl: makeFetchImpl({
      '/state': stateBody({ project: { dir: 'E:\\proj', hasConfig: true, configName: 'yibinthesis.project.json' } }),
    }),
  })
  const Body = harness.componentFor('sidebar.right.pane.tab')
  harness.mount(Body, {})
  // 首屏 /state 落地 -> 自动并发取 probe/deliverables/doctor -> 再落地。
  await harness.flush()
  await harness.flush()

  const text = harness.text
  assert.deepEqual(collectThrows(harness.tree), [], '渲染期不得有任何组件抛错（抛错会让那棵子树变空白）')
  assert.deepEqual(collectThrows(harness.tree), [], '渲染期不得有任何组件抛错')
  assert.ok(text.includes('示例论文题目'), `应渲染题目，实际：${text.slice(0, 400)}`)
  assert.ok(text.includes('张三'), '应渲染作者')
  assert.ok(text.includes('20230001'), '应渲染学号')
  assert.ok(text.includes('毕业论文（设计）'), '应把 thesis 渲染成中文类型标签')
  assert.ok(text.includes('理工农医'), '应把 science 渲染成中文学科标签')
  assert.ok(text.includes('1,234'), '应渲染正文汉字数（带千分位）')
  assert.ok(text.includes('交付物'), '应有交付物区块')
  assert.ok(text.includes('157.2 KB'), '应把字节数格式化成 KB')
  assert.ok(text.includes('尚未生成'), '未生成的 DOCX 应标「尚未生成」')
  assert.ok(text.includes('● 就绪'), '工具链就绪应显示 ●')
  assert.ok(text.includes('Biber'), '应逐项列出工具链条目')
  assert.ok(text.includes('2.17'), '应显示 Biber 版本')

  const routes = harness.fetchCalls.map((u) => u.replace(/^.*\/api\/yibinthesis/, '').split('?')[0])
  for (const route of ['/state', '/probe', '/deliverables', '/doctor']) {
    assert.ok(routes.includes(route), `应请求 ${route}，实际：${routes.join(' ')}`)
  }
})

test('★ 桥路由 404（宿主装的是旧版桥）：给出「重启 DSH」的可操作提示', async () => {
  // 实机发生过的情形：宿主进程里缓存的 host 半还是只有 /state 与 /doctor 的旧版本，
  // 客户端请求 /probe 时服务端以**纯文本** `not found` 404 应答。
  // 直接 res.json() 会抛 `Unexpected token 'o', "not found" is not valid JSON`——
  // 对用户毫无意义。必须翻译成可操作的说明。
  const harness = boot({
    fetchImpl: (url) => {
      const route = String(url).replace(/^.*\/api\/yibinthesis/, '').split('?')[0]
      // 必须让 `hasConfig: true`，否则面板不会去取 /probe，这条路径根本走不到。
      if (route === '/state') {
        return stateBody({ project: { dir: 'E:\\proj', hasConfig: true, configName: 'yibinthesis.project.json' } })
      }
      return { __raw: 'not found', __status: 404 }
    },
  })
  const Body = harness.componentFor('sidebar.right.pane.tab')
  harness.mount(Body, {})
  await harness.flush()
  await harness.flush()

  const text = harness.text
  assert.deepEqual(collectThrows(harness.tree), [], '渲染期不得有任何组件抛错（抛错会让那棵子树变空白）')
  assert.ok(text.length > 0, '不能渲染成空白')
  assert.match(text, /没有注册桥路由|重启 DSH/, `应给出可操作提示，实际：${text.slice(0, 400)}`)
  assert.ok(!/Unexpected token/.test(text), '不该把 JSON 解析错误原样抛给用户')
})

test('★ 桥不可用：显示可操作提示而不是空白', async () => {
  const harness = boot({ fetchImpl: () => ({ __throw: 'connect ECONNREFUSED 127.0.0.1:19387' }) })
  const Body = harness.componentFor('sidebar.right.pane.tab')
  harness.mount(Body, {})
  await harness.flush()

  const text = harness.text
  assert.deepEqual(collectThrows(harness.tree), [], '渲染期不得有任何组件抛错（抛错会让那棵子树变空白）')
  assert.ok(text.length > 0, '桥不可用时也不能渲染成空白')
  assert.ok(/无法连接|正在连接/.test(text), `应说明桥不可用，实际：${text.slice(0, 200)}`)
})

test('★ 组件抛错必须被测试看见（而不是渲染成空面板）', () => {
  const harness = boot()
  const Boom = () => {
    throw new Error('故意抛错')
  }
  const tree = harness.mount(Boom, {})
  assert.equal(tree.child.kind, 'threw', '渲染器必须如实登记组件抛错')
  assert.match(harness.text, /故意抛错/)
})

test('★ 回归：不得用 react/jsx-runtime 的 jsx 建元素（它会丢弃第 2 个起的子节点）', () => {
  // 这是**实装过的缺陷**，实机表现为「面板是空的」：
  // `jsx(type, props, key)` 只接受三个参数、children 必须在 props 里，第三参数是 key。
  // 写成 `h('div', props, child1, child2, …)` 时第 2 个起的子节点被静默丢弃。
  const code = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.ok(!/jsxRuntime\s*\.\s*jsx/.test(code), '不得用 react/jsx-runtime 的 jsx 建元素')
  assert.match(code, /const h = React\.createElement/, 'h 必须绑定到 React.createElement')
})

test('★ 切回标签页要秒开：重挂载先渲染缓存，且**不得**重新起昂贵扫描', async () => {
  // 这条防的是用户实测反馈：「每次切到论文工具 tab 就要重新等扫描，页面没有缓存吗」。
  // 成因：宿主切换右侧栏标签时会**卸载**面板组件，组件内 state 随之清空，
  // 而无条件重跑会重新起 PowerShell 跑 `doctor`（那正是「等扫描」的来源）。
  // 修法：数据缓存在**模块作用域**（跨挂载存活），重挂载先用缓存渲染。
  const harness = boot({
    fetchImpl: makeFetchImpl({
      '/state': stateBody({ project: { dir: 'E:\\proj', hasConfig: true, configName: 'yibinthesis.project.json' } }),
    }),
  })
  const Body = harness.componentFor('sidebar.right.pane.tab')

  // 第一次挂载：完整取数（此时才会跑 doctor）。
  harness.mount(Body, {})
  await harness.flush()
  await harness.flush()
  assert.ok(harness.text.includes('示例论文题目'), '前置：第一次挂载应取到项目数据')
  const firstMountFetches = harness.fetchCalls.length
  // 首次是完整取数：/state + /probe + /deliverables + /doctor + /files = 5 次。
  assert.ok(firstMountFetches >= 5, `前置：第一次应完整取数，实际 ${firstMountFetches} 次`)

  // 卸载：等价于宿主切走标签时卸载组件。
  harness.unmount()

  // 第二次挂载。
  harness.mount(Body, {})
  // 缓存命中后需要一次重渲染才上屏（真实浏览器里是同一 tick）。
  await harness.flush()
  assert.ok(
    harness.text.includes('示例论文题目'),
    `重挂载后应从缓存渲染出数据，实际：${JSON.stringify(harness.text.slice(0, 160))}`,
  )

  // 关键断言：重挂载**不得**再触发一轮完整扫描（这就是「不用等」的本质）。
  const secondMountFetches = harness.fetchCalls.slice(firstMountFetches)
  assert.ok(
    !secondMountFetches.some((u) => u.includes('/doctor')),
    `重挂载不该重跑 doctor（那是真的起 PowerShell），实际请求：${secondMountFetches.join(', ')}`,
  )
  assert.ok(
    !secondMountFetches.some((u) => u.includes('/probe')),
    `重挂载不该重跑 probe，实际请求：${secondMountFetches.join(', ')}`,
  )
  // 仍然向宿主确认「当前状态」（廉价、秒级），保证数据不会永远陈旧。
  assert.ok(
    secondMountFetches.some((u) => u.includes('/state')),
    '仍应确认 /state，避免显示过期目录',
  )
})

test('★ 缓存：按项目目录隔离，不能把 A 项目的数据显示给 B 项目', async () => {
  // 面板现在按会话维护**项目列表**，初始为空；这里通过 `defaultProjectDir` 兜底
  // 把项目加进列表，再切换会话让 `/state` 报出另一个目录，验证缓存不串。
  let currentDir = 'E:\\proj-a'
  const harness = boot({
    fetchImpl: (url) => {
      const route = String(url).replace(/^.*\/api\/yibinthesis/, '').split('?')[0]
      if (route === '/state') {
        // 桩必须**仿真真实端点**：`/state` 会回显收到的 `?projectDir=`。
        // 早期桩忽略了该参数，于是「客户端忘了传目录」这个缺陷在测试里看不出来
        // ——实测面板正是因此显示「✗ 该目录没有配置」而摘要区却读到了内容。
        const asked = new URL(String(url), 'http://x').searchParams.get('projectDir')
        const dir = asked || currentDir
        return stateBody({
          config: {
            templateRoot: 'E:\\tpl',
            cliRoot: 'E:\\cli',
            // 刻意留空：本部署的默认值就是空，面板不该凭空指向任何项目。
            defaultProjectDir: '',
            toolchainDirs: ['E:\\tools'],
            toolchain: {},
          },
          project: { dir, hasConfig: true, configName: 'yibinthesis.project.json' },
        })
      }
      if (route === '/probe') {
        const title = String(url).includes('proj-a') ? '项目甲' : '项目乙'
        return {
          ok: true,
          metadata: { title },
          project: { documentClass: { documentType: 'thesis', discipline: 'science' } },
          config: { citationMode: 'linked' },
          chapters: [],
          totalHan: 1,
        }
      }
      if (route === '/deliverables') {
        return { ok: true, buildRoot: 'B', buildRootExists: true, pdf: { template: 'p.pdf', resolved: 'P', exists: false }, word: { template: 'w.docx', resolved: 'W', exists: false } }
      }
      if (route === '/doctor') return { ok: true, ready: true, exitCode: 0, stdout: '  [OK]      Tectonic (optional) - x' }
      if (route === '/files') return { ok: true, files: [] }
      return { ok: false, error: { kind: 'unexpected', message: route } }
    },
  })
  const Body = harness.componentFor('sidebar.right.pane.tab')
  const SESSION = 'sess-cache-isolation'
  // 预置会话项目列表（甲），模拟「用户已加入项目」的真实状态。
  harness.sessionStorage.setItem(
    `yibinthesis-dsh:projects:${SESSION}`,
    JSON.stringify({ projects: [{ dir: 'E:\\proj-a' }], active: 0 }),
  )

  // 项目甲：取数并落缓存。
  harness.mount(Body, { sessionId: SESSION })
  await harness.flush()
  await harness.flush()
  assert.ok(harness.text.includes('项目甲'), '前置：甲项目数据应到位')

  // 切到项目乙并卸载重挂：**不能**再显示甲的数据。
  currentDir = 'E:\\proj-b'
  harness.unmount()
  harness.sessionStorage.setItem(
    `yibinthesis-dsh:projects:${SESSION}`,
    JSON.stringify({ projects: [{ dir: 'E:\\proj-b' }], active: 0 }),
  )
  harness.mount(Body, { sessionId: SESSION })
  assert.ok(
    !harness.text.includes('项目甲'),
    `切到乙项目后不该残留甲的数据：${harness.text.slice(0, 200)}`,
  )
  await harness.flush()
  await harness.flush()
  assert.ok(harness.text.includes('项目乙'), '应显示乙项目的数据')
})

test('★ 回归：`loadState` 的依赖必须稳定（依赖 state/projectDir 会造成无限渲染循环）', () => {
  // 实装过的缺陷：给 `loadState` 加上 state/projectDir 依赖后，它每次渲染都换新引用
  // → `useEffect([loadState])` 重跑 → 再 setState → 无限循环（被渲染器的循环上限逮住）。
  // 故「上次项目目录」必须放在**模块作用域**（组件 ref 也会随卸载清空），依赖保持稳定。
  const code = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const match = /const loadState = useCallback\([\s\S]*?\n\s*\}, \[([^\]]*)\]\)/.exec(code)
  assert.ok(match, '应能定位 loadState 的依赖数组')
  // 依赖里允许 `sessionId`（字符串，跨渲染稳定）；**不得**出现 state / projects /
  // projectDir 这类每次渲染都可能换引用的值——那正是无限循环的成因。
  assert.equal(
    match[1].trim(),
    'callBridge, sessionId',
    `loadState 的依赖必须只有稳定值，实际：[${match[1].trim()}]`,
  )
  assert.match(code, /let manualDir = ''/, '用户手动选择的目录必须放在模块作用域（组件 state 会随卸载清空）')
  assert.ok(!/lastKnownDir/.test(code), '不该再引用已被取代的 lastKnownDir')
})

test('★ 用户选定的项目目录必须优先于配置默认值，且切标签不丢', async () => {
  // 实测缺陷：用户把项目切到自己的论文，**切一下 tab 又变回配置里的默认项目**。
  // 成因：目录存在组件 state 里，宿主切换标签会卸载组件 → state 清空 →
  //       重挂载时 `current || body.project.dir` 回落到配置默认值。
  // 这条测试同时钉住「优先级」与「跨卸载存活」两件事。
  const DEFAULT_DIR = 'E:\\默认项目'
  const CHOSEN_DIR = 'E:\\用户论文\\03_正式论文'
  const harness = boot({
    fetchImpl: (url) => {
      const route = String(url).replace(/^.*\/api\/yibinthesis/, '').split('?')[0]
      if (route === '/state') {
        return stateBody({
          config: {
            templateRoot: 'E:\\tpl',
            cliRoot: 'E:\\cli',
            defaultProjectDir: DEFAULT_DIR,
            toolchainDirs: ['E:\\tools'],
            toolchain: {},
          },
          project: { dir: DEFAULT_DIR, hasConfig: true, configName: 'yibinthesis.project.json' },
        })
      }
      if (route === '/probe') {
        return { ok: true, metadata: { title: '题' }, project: { documentClass: {} }, config: {}, chapters: [], totalHan: 0, totalHanProse: 0 }
      }
      if (route === '/deliverables') return { ok: true, buildRoot: 'B', buildRootExists: false, pdf: null, word: null }
      if (route === '/doctor') return { ok: true, ready: true, exitCode: 0, stdout: '  [OK]      Tectonic (optional) - x' }
      if (route === '/files') return { ok: true, files: [] }
      return { ok: false, error: { kind: 'unexpected', message: route } }
    },
  })
  const Body = harness.componentFor('sidebar.right.pane.tab')
  // 必须带 sessionId：项目的保存/恢复是**按会话**的，真实面板总会拿到它。
  harness.mount(Body, { sessionId: 'sess-dir-test' })
  await harness.flush()
  await harness.flush()
  assert.ok(harness.text.includes(DEFAULT_DIR), '前置：首次应显示配置里的默认目录')

  // 点「＋ 添加」加入一个**新**项目（目录列表模型：添加而不是替换）。
  const addButton = harness.findButtonByText('＋ 添加')
  assert.ok(addButton, '应有「＋ 添加」按钮')
  addButton.props.onClick()
  await harness.flush()
  const input = harness.findByType('input')
  assert.ok(input, '展开后应有目录输入框')
  input.props.onChange({ target: { value: CHOSEN_DIR } })
  await harness.flush()
  // 必须**重新取**输入框节点：flush 后旧节点是上一轮的产物，
  // 它的 props 闭包捕获的是旧 state（实测表现：onKeyDown 读到的草稿是空串）。
  const freshInput = harness.findByType('input')
  assert.equal(freshInput?.props.value, CHOSEN_DIR, '输入框应显示新目录')
  freshInput.props.onKeyDown({ key: 'Enter' })
  await harness.flush()
  // 持久化必须**真的发生**（缺存储桩时写入会被静默跳过，测试看似通过而实际没存）。
  // 而且必须写进 `localStorage`——写 `sessionStorage` 会在关掉 DSH 后全丢
  // （用户实测反馈：「每次重进 dsh 都要重新输入路径」）。
  const stored = harness.localStorage.__dump()
  const storedProjects = Object.entries(stored).find(([key]) => key.includes('projects'))
  assert.ok(storedProjects, `应按会话写入项目列表（localStorage），实际存储：${JSON.stringify(stored)}`)
  assert.ok(
    storedProjects[1].includes('03_正式论文'),
    `写入内容应含新项目：${storedProjects[1]}`,
  )
  // 两个项目都应在列表里（添加不替换）。
  // 断言目录名（缩短规则下「末两级」的呈现随路径而异，断言目录名更稳）。
  assert.ok(harness.text.includes('03_正式论文'), `应显示新项目：${harness.text.slice(0, 300)}`)

  // **模拟重启 DSH**：清掉 sessionStorage（新的页面级存储），保留 localStorage（磁盘持久数据）。
  harness.sessionStorage.clear()
  harness.unmount()
  harness.mount(Body, { sessionId: 'sess-dir-test' })
  await harness.flush()
  assert.ok(
    harness.text.includes('03_正式论文'),
    `重启后项目列表必须仍在（localStorage 持久化），实际：${JSON.stringify(harness.text.slice(0, 200))}`,
  )

  // **切走标签**（卸载）再切回来：会话内的项目列表必须还在，且仍选中刚加入的那个。
  harness.unmount()
  harness.mount(Body, { sessionId: 'sess-dir-test' })
  await harness.flush()
  assert.ok(
    harness.text.includes('03_正式论文'),
    `切回标签后项目列表必须还在，实际：${JSON.stringify(harness.text.slice(0, 300))}`,
  )
  assert.ok(
    harness.text.includes('默认项目'),
    '先加入的项目也应保留（列表模型：添加不替换）',
  )
})

test('★ 文件分类标签页：默认只渲染正文，资源按目录聚合显示', async () => {
  // 实测场景：项目有 148 个文件，其中资源 106、正文仅 13。混在一个列表里正文被淹没。
  // 这条测试钉住两件事：① 默认只显示正文；② 切到「资源」时按目录聚合（不铺开上百行）。
  const harness = boot({
    fetchImpl: (url) => {
      const route = String(url).replace(/^.*\/api\/yibinthesis/, '').split('?')[0]
      if (route === '/state') {
        return stateBody({ project: { dir: 'E:\\proj', hasConfig: true, configName: 'yibinthesis.project.json' } })
      }
      if (route === '/probe') {
        return {
          ok: true,
          metadata: { title: '分类测试' },
          project: { documentClass: { documentType: 'thesis', discipline: 'science' } },
          config: { citationMode: 'linked' },
          chapters: [{ file: '10-introduction.tex', path: 'E:\\proj\\latex\\chapters\\10-introduction.tex', han: 2998, hanProse: 2998, content: true }],
          totalHan: 2998,
          totalHanProse: 2998,
        }
      }
      if (route === '/deliverables') return { ok: true, buildRoot: 'B', buildRootExists: false, pdf: null, word: null }
      if (route === '/doctor') return { ok: true, ready: true, exitCode: 0, stdout: '  [OK]      Tectonic (optional) - x' }
      if (route === '/files') {
        return {
          ok: true,
          truncated: false,
          categories: { source: 1, assets: 2, data: 0, docs: 0, other: 0 },
          files: [
            {
              path: 'E:\\proj\\latex\\chapters\\10-introduction.tex',
              relative: 'latex/chapters/10-introduction.tex',
              name: '10-introduction.tex',
              size: 10700,
              category: 'source',
              source: true,
            },
            {
              path: 'E:\\proj\\图表资源\\重构\\图1_TFIDF.png',
              relative: '图表资源/重构/图1_TFIDF.png',
              name: '图1_TFIDF.png',
              size: 51200,
              category: 'assets',
              source: false,
            },
            {
              path: 'E:\\proj\\latex\\assets\\本人签名.jpg',
              relative: 'latex/assets/本人签名.jpg',
              name: '本人签名.jpg',
              size: 10240,
              category: 'assets',
              source: false,
            },
          ],
        }
      }
      return { ok: false, error: { kind: 'unexpected', message: route } }
    },
  })
  const Body = harness.componentFor('sidebar.right.pane.tab')
  harness.mount(Body, {})
  await harness.flush()
  await harness.flush()

  const text = harness.text
  assert.deepEqual(collectThrows(harness.tree), [], '渲染期不得有组件抛错')

  // ① 分类标签页要出现，并带计数。
  assert.ok(text.includes('正文'), '应有「正文」标签')
  assert.ok(text.includes('资源'), '应有「资源」标签')
  // ② 默认只渲染正文：资源的路径不得出现。
  assert.ok(text.includes('latex/chapters/10-introduction.tex'), '默认应显示正文文件')
  assert.ok(!text.includes('本人签名.jpg'), `默认不该显示资源文件：${text.slice(0, 300)}`)
  // ③ 正文字数（来自 probe）要显示。
  assert.ok(text.includes('2998 字'), `正文字数应显示：${text.slice(0, 300)}`)

  // ④ 切到「资源」：显示**目录聚合**，不逐个铺开文件。
  const assetTab = harness.collectHosts().find(
    (node) => node.type === 'button' && node.props.className?.includes('ybt-tab') && JSON.stringify(node.children).includes('资源'),
  )
  assert.ok(assetTab, '应能找到「资源」标签按钮')
  assetTab.props.onClick()
  await harness.flush()

  const assetText = harness.text
  assert.ok(assetText.includes('图表资源/重构'), `资源应按目录聚合：${assetText.slice(0, 400)}`)
  assert.ok(assetText.includes('latex/assets'), '资源目录 latex/assets 也应列出')
  assert.ok(!assetText.includes('latex/chapters/10-introduction.tex'), '切到资源后不该再显示正文条目')
  // 聚合口径：两个目录各 1 个文件 → 两行「1 个」，且**不**逐个列文件名。
  const groupRows = (assetText.match(/1 个 · /g) || []).length
  assert.equal(groupRows, 2, `应有两行目录聚合（各 1 个文件）：${assetText.slice(0, 400)}`)
  assert.ok(!assetText.includes('图1_TFIDF.png'), '聚合行不该铺开文件名')
})

test('★ 回归：`/state` 必须带 `projectDir`（否则「✗ 该目录没有配置」与摘要区自相矛盾）', async () => {
  // 实测缺陷：`/state` 支持 `?projectDir=` 但客户端调用时**没传**，
  // 于是这个端点在查空目录 → 面板显示「✗ 该目录没有 yibinthesis.project.json」，
  // 而摘要区（`/probe` 带了目录）却能读到内容。两个请求看的是不同目录。
  const DIR = 'E:\\proj-x'
  const harness = boot({
    fetchImpl: (url) => {
      const route = String(url).replace(/^.*\/api\/yibinthesis/, '').split('?')[0]
      if (route === '/state') {
        const asked = new URL(String(url), 'http://x').searchParams.get('projectDir')
        return stateBody({
          config: { templateRoot: 'E:\\tpl', cliRoot: 'E:\\cli', defaultProjectDir: '', toolchainDirs: [], toolchain: {} },
          // 回显收到的目录：没传就是 null —— 正是缺陷在真实端点上的表现。
          project: asked
            ? { dir: asked, hasConfig: true, configName: 'yibinthesis.project.json' }
            : { dir: null, hasConfig: false, configName: 'yibinthesis.project.json' },
        })
      }
      if (route === '/probe') {
        return { ok: true, metadata: { title: '题目' }, project: { documentClass: {} }, config: {}, chapters: [], totalHan: 0, totalHanProse: 0 }
      }
      if (route === '/deliverables') return { ok: true, buildRoot: 'B', buildRootExists: false, pdf: null, word: null }
      if (route === '/doctor') return { ok: true, ready: true, exitCode: 0, stdout: '  [OK]      Tectonic (optional) - x' }
      if (route === '/files') return { ok: true, files: [] }
      return { ok: false, error: { kind: 'unexpected', message: route } }
    },
  })
  harness.sessionStorage.setItem(
    'yibinthesis-dsh:projects:sess-state-query',
    JSON.stringify({ projects: [{ dir: DIR }], active: 0 }),
  )
  const Body = harness.componentFor('sidebar.right.pane.tab')
  harness.mount(Body, { sessionId: 'sess-state-query' })
  await harness.flush()
  await harness.flush()

  // ① 直接断言请求带上了目录（这才是防复发的关键：改桩只能证明桩变了）。
  const stateCalls = harness.fetchCalls.filter((u) => u.includes('/state'))
  assert.ok(stateCalls.length > 0, '应请求过 /state')
  const withDir = stateCalls.filter((u) => u.includes('projectDir='))
  assert.ok(
    withDir.length > 0,
    `/state 必须带 projectDir 参数，实际请求：${JSON.stringify(stateCalls)}`,
  )
  assert.ok(
    decodeURIComponent(withDir[withDir.length - 1]).includes(DIR),
    `最后一次 /state 应查当前项目目录：${withDir[withDir.length - 1]}`,
  )

  // ② 界面不得出现「该目录没有配置」这种与事实相矛盾的提示。
  assert.ok(
    !harness.text.includes('✗'),
    `不该显示「没有配置」：${harness.text.slice(0, 200)}`,
  )
  assert.ok(harness.text.includes('✓ 已找到'), '应确认找到配置文件')
})

test('★ 容错：旧版宿主不返回 `categories` 时，文件列表仍要列得出来（并降级）', async () => {
  // 实测场景：client 半随页面刷新更新，host 半要**重启 DSH** 才更新。
  // 旧 host 的 `/files` 没有 `categories` 字段、也没有逐文件 `category`，只有 `source` 布尔值。
  // 若客户端直接按 `file.category === activeCategory` 过滤，就会「显示 147 个、却一个也列不出来」
  // ——比报错更难排查。故必须有本地推导的降级路径。
  const harness = boot({
    fetchImpl: (url) => {
      const route = String(url).replace(/^.*\/api\/yibinthesis/, '').split('?')[0]
      if (route === '/state') {
        const asked = new URL(String(url), 'http://x').searchParams.get('projectDir')
        return stateBody({
          config: { templateRoot: 'E:\\tpl', cliRoot: 'E:\\cli', defaultProjectDir: '', toolchainDirs: [], toolchain: {} },
          project: asked ? { dir: asked, hasConfig: true, configName: 'yibinthesis.project.json' } : { dir: null, hasConfig: false, configName: 'yibinthesis.project.json' },
        })
      }
      if (route === '/probe') {
        return { ok: true, metadata: { title: '题' }, project: { documentClass: {} }, config: {}, chapters: [], totalHan: 0, totalHanProse: 0 }
      }
      if (route === '/deliverables') return { ok: true, buildRoot: 'B', buildRootExists: false, pdf: null, word: null }
      if (route === '/doctor') return { ok: true, ready: true, exitCode: 0, stdout: '  [OK]      Tectonic (optional) - x' }
      if (route === '/files') {
        // 刻意模仿**旧版宿主**：无 `categories`，逐文件只有 `source` 布尔值、无 `category`。
        return {
          ok: true,
          total: 3,
          files: [
            { path: 'P\\latex\\main.tex', relative: 'latex/main.tex', name: 'main.tex', size: 100, source: true },
            { path: 'P\\latex\\chapters\\10-intro.tex', relative: 'latex/chapters/10-intro.tex', name: '10-intro.tex', size: 200, source: true },
            { path: 'P\\latex\\assets\\a.png', relative: 'latex/assets/a.png', name: 'a.png', size: 300, source: false },
          ],
        }
      }
      return { ok: false, error: { kind: 'unexpected', message: route } }
    },
  })
  const Body = harness.componentFor('sidebar.right.pane.tab')
  // 预置会话项目，面板才会去取 `/files`（默认空列表是正常初始态）。
  harness.sessionStorage.setItem(
    'yibinthesis-dsh:projects:sess-old-host',
    JSON.stringify({ projects: [{ dir: 'E:\\proj-old' }], active: 0 }),
  )
  harness.mount(Body, { sessionId: 'sess-old-host' })
  await harness.flush()
  await harness.flush()

  assert.deepEqual(collectThrows(harness.tree), [], '不得因缺字段而抛错')
  // 必须有标签（从 `source` 布尔值推导：正文 2、其他 1）。
  const tabs = harness.collectHosts().filter((n) => String(n.props.className || '').includes('ybt-tab'))
  assert.ok(tabs.length >= 2, `降级后仍应有分类标签，实际 ${tabs.length} 个`)
  assert.ok(harness.text.includes('正文'), '应有「正文」标签')
  // 关键：正文文件**必须列出来**（这正是原缺陷的表现：显示 N 个却列不出来）。
  assert.ok(harness.text.includes('latex/main.tex'), `旧版宿主下正文仍应列出：${harness.text.slice(0, 300)}`)
  assert.ok(harness.text.includes('10-intro.tex'), '另一篇正文也应列出')
})

test('★ 面板的写面必须**恰好只有一个**（设置产物输出名称），且由点击触发', () => {
  // 这条测试的性质随需求变过两次，值得写清楚：
  //   ① 早期刻意**全程只读**（理由：Web 路由触发写盘会把权限面开得过大）；
  //   ② 中途按用户要求加入两个写操作（登记为工作区、设置产物输出名称）；
  //   ③ 现在**「登记工作区」已整体移除**，回到只有「设置产物输出名称」一个写操作。
  // 这里同时断言它**不再存在**——移除功能时最容易留下的就是一条没人调用的写路由。
  const code = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  // ① 客户端永远不得直接触发构建/脚手架（那些写盘且耗时，必须走工具审批链路）。
  for (const bad of ['/yibinthesis/build', 'yibinthesis_build(', 'yibinthesis_new(']) {
    assert.ok(!code.includes(bad), `客户端半不得直接触发构建/脚手架：${bad}`)
  }

  // ② 写方法只允许 POST。
  const methodUsages = [...code.matchAll(/method:\s*'([A-Z]+)'/g)].map((m) => m[1])
  assert.deepEqual([...new Set(methodUsages)], ['POST'], `唯一的写方法应是 POST，实际：${methodUsages.join(',')}`)

  // ③ 写路由**恰好一个**：`/deliverables`。新增写操作必须同时改这里与 BRIDGE_WRITE_ROUTES。
  const writeRoutes = [...code.matchAll(/callBridge\('([^']+)',[^)]*method:\s*'POST'/g)].map((m) => m[1])
  assert.deepEqual([...new Set(writeRoutes)], ['/deliverables'], `唯一的写路由应是 /deliverables，实际：${writeRoutes.join(',')}`)

  // ④ 已移除的「登记工作区」不得以任何形式残留（客户端侧）。
  assert.ok(!/registerWorkspace/.test(code), '登记工作区已移除，不该再有 registerWorkspace')
  assert.ok(!code.includes('/workspace'), '客户端不该再请求 /workspace')

  // ⑤ 该写调用必须由点击触发，且不得在 effect 里自动执行。
  assert.match(code, /onClick:[^,]*void saveDeliverableNames\(\)/, '保存产物名必须由点击触发')
  assert.ok(!/useEffect\([^)]*saveDeliverableNames/s.test(code), '保存不得在 effect 里自动执行')

  // ⑥ 取数仍经统一的助手；不得有表单提交。
  assert.match(code, /fetch\(`\$\{BRIDGE\}\$\{route\}/, '取数只经统一的助手')
  assert.ok(!code.includes('onSubmit'), '不应有表单提交')
})
