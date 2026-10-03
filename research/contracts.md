# DSH 插件契约笔记（供 `yibinthesis-dsh` 编码照抄）

- 侦察目标：为把 YibinThesis 论文工具改造成 DSH 插件包 `yibinthesis-dsh` 产出可直接照抄的编码契约。
- 基线版本：`@deepseek-ai/*` = **0.2.0-rc.2**（DSH Desktop 0.2.0-rc.2 对应版本）。
- 采证日期：2026-10-03。本机为 Windows，PowerShell。
- **本文件只写结论与证据，不含猜测。查不到的逐条写「未证实」并说明原因。**

---

## 0. 素材别名表与可达性实测

### 0.1 别名 → 绝对路径

| 别名 | 绝对路径 |
|---|---|
| `[TOOLS]` | `E:\文档\毕业论文\yibinthesis-dsh\_scratch\deepseek-ai-dsh-tools-0.2.0-rc.2\package\` |
| `[SKILL]` | `E:\文档\毕业论文\yibinthesis-dsh\_scratch\deepseek-ai-dsh-skill-0.2.0-rc.2\package\` |
| `[JOBS]` | `E:\文档\毕业论文\yibinthesis-dsh\_scratch\deepseek-ai-dsh-client-ui-jobs-0.2.0-rc.2\package\` |
| `[SLOTS]` | `E:\文档\毕业论文\yibinthesis-dsh\_scratch\deepseek-ai-dsh-client-ui-slots-0.2.0-rc.2\package\` |
| `[RENDER]` | `E:\文档\毕业论文\yibinthesis-dsh\_scratch\deepseek-ai-dsh-client-ui-renderer-0.2.0-rc.2\package\` |
| `[THEME]` | `E:\文档\毕业论文\yibinthesis-dsh\_scratch\deepseek-ai-dsh-client-ui-theme-0.2.0-rc.2\package\` |
| `[CONV]` | `E:\文档\毕业论文\yibinthesis-dsh\_scratch\deepseek-ai-dsh-client-ui-conversation-0.2.0-rc.2\package\` |
| `[PRIM]` | `E:\文档\毕业论文\yibinthesis-dsh\_scratch\deepseek-ai-dsh-client-ui-primitives-0.2.0-rc.2\package\` |
| `[REMOTE]` | `E:\文档\毕业论文\yibinthesis-dsh\_scratch\deepseek-ai-dsh-api-remotes-0.2.0-rc.2\package\` |
| `[JOBC]` | `E:\文档\毕业论文\yibinthesis-dsh\_scratch\deepseek-ai-dsh-api-job-controller-0.2.0-rc.2\package\` |
| `[LUNHENG]` | `C:\Users\LoyDgIk\.dsh\profiles\desktop\node_modules\lunheng-article-pipeline\` |
| `[UNIVER]` | `C:\Users\LoyDgIk\.dsh\profiles\desktop\node_modules\dsh-univer-office\` |
| `[PROFILE]` | `C:\Users\LoyDgIk\.dsh\profiles\desktop\` |
| `[STATUS-ROTATOR]` | `C:\Users\LoyDgIk\.dsh\profiles\desktop\node_modules\dsh-status-rotator\` |
| `[FREESEARCH]` | `C:\Users\LoyDgIk\.dsh\profiles\desktop\node_modules\dsh-free-search\` |
| `[SIDEBAR]` | `C:\Users\LoyDgIk\.dsh\profiles\desktop\node_modules\dsh-better-sidebar\` |
| `[CTX-PLUGIN]` | `C:\Users\LoyDgIk\.dsh\profiles\desktop\node_modules\dsh-context\` |
| `[SKILLEXP]` | `C:\Users\LoyDgIk\.dsh\profiles\desktop\node_modules\@linxin666\dsh-client-ui-skill-explorer\` |

下文证据写作 `[别名]:行号`，别名一律按本表解析。

### 0.2 客户端插件源码可达性 —— 实测结论

- **实测于** `Test-Path -LiteralPath 'D:\Program Files (x86)\dsh\resources\app.asar.unpacked\node_modules\@deepseek-ai\'` → `False`（该目录**不存在**）。
- `D:\Program Files (x86)\dsh\resources\app.asar.unpacked\` 下**只有** `dsh\` 一层；其 `node_modules\@deepseek-ai\` 下**只有 4 个包**，且**全部不是客户端 UI 插件**：
  `dsh-desktop-host`、`dsh-session-log-export`、`libreoffice-kit`、`libreoffice-kit-win32-x64`。
  （**实测于** `Get-ChildItem -LiteralPath 'D:\Program Files (x86)\dsh\resources\app.asar.unpacked\dsh\node_modules\@deepseek-ai' -Force`，计数 = 4）
- `C:\Users\LoyDgIk\.dsh\profiles\node_modules\@deepseek-ai\` 下的 junction **全部断链**：
  其 `Target` 指向 `D:\Program Files (x86)\DSH Desktop\resources\...`，而 `D:\Program Files (x86)\DSH Desktop` **不存在**（真实安装目录是 `D:\Program Files (x86)\dsh`）。
  - `Test-Path` 对 junction 本身返回 `True`（迷惑项），但列目录立即失败：
    `Get-ChildItem : Could not find a part of the path 'C:\Users\LoyDgIk\.dsh\profiles\node_modules\@deepseek-ai\dsh-client-ui-jobs'.`
  - 其中 `dsh-client-runtime`、`dsh-host-apiproxy` 两个 junction 指向第三条路径 `D:\MyCode\VSDK\nodejs\v-24.11.1\nodejs-24.11.1\node_modules\@deepseek-ai\dsh\node_modules\@deepseek-ai\`，**实测该路径也不存在**（`Test-Path` → `False`）。
- ⇒ **按任务给定线索，客户端插件源码本机不可得**。但 `app.asar`（121 MB）本身存在，未尝试解包（超出本次侦察范围）。
- 因此按任务第 4 条途径，**经 npm 拉取官方客户端小插件**（联网，已允许）。**实测于**以下命令（工作目录 `E:\文档\毕业论文\yibinthesis-dsh\_scratch`）：

```
npm pack @deepseek-ai/dsh-client-ui-jobs@0.2.0-rc.2          → OK
npm pack @deepseek-ai/dsh-skill-badge@0.2.0-rc.2             → OK
npm pack @deepseek-ai/dsh-client-ui-slots@0.2.0-rc.2         → OK
npm pack @deepseek-ai/dsh-client-ui-primitives@0.2.0-rc.2    → OK
npm pack @deepseek-ai/dsh-client-runtime@0.2.0-rc.2          → 404（该包不发布此版本，见下）
npm pack @deepseek-ai/dsh-client-ui-renderer@0.2.0-rc.2      → OK   （额外拉取，为证 `ctx.slots.inject`）
npm pack @deepseek-ai/dsh-client-ui-theme@0.2.0-rc.2         → OK   （额外拉取，为证主题令牌）
npm pack @deepseek-ai/dsh-client-ui-conversation@0.2.0-rc.2  → OK   （额外拉取，为证 Slot 名清单）
npm pack @deepseek-ai/dsh-api-remotes@0.2.0-rc.2             → OK   （额外拉取，为证 host↔client 通信）
npm pack @deepseek-ai/dsh-api-job-controller@0.2.0-rc.2      → OK   （额外拉取，同上）
```

- **与预期不符①**：`@deepseek-ai/dsh-client-runtime` 在 npm 上**没有 `0.2.0-rc.2` 版本**。
  实测 `npm view @deepseek-ai/dsh-client-runtime@0.2.0-rc.2 version` → `E404 No match found for version 0.2.0-rc.2`。
  该包名在 profile 里只作为**断链 junction** 存在。**是否存在其他可行版本：未证实。**
- 元数据交叉验证：`@deepseek-ai/dsh-client-ui-jobs/package.json` 的 `devDependencies` 里记录了
  `"@deepseek-ai/dsh-client-test-runtime": "0.2.0-rc.2"`（`[JOBS]:37`），
  即该版本的客户端测试运行时叫 **`dsh-client-test-runtime`**；是否为 `dsh-client-runtime` 的新名，**未证实**。
- 所有 tarball 已解包到 `_scratch\<tarball 同名目录>\package\`。**未改动 profile 内任何已安装内容。**

### 0.3 第三方插件的 `package.json` 读法（**实测于**此命令）

本机已安装的**第三方**插件（`dsh-better-sidebar` / `dsh-free-search` / `dsh-status-rotator` / `dsh-context` / `dsh-vibe-math` / `@linxin666/dsh-client-ui-skill-explorer`）是 §D 的重要旁证。其 manifest **实测于**：

```powershell
$d='C:\Users\LoyDgIk\.dsh\profiles\desktop\node_modules'
foreach ($p in @('dsh-better-sidebar','dsh-free-search','dsh-status-rotator','dsh-context','dsh-vibe-math','@linxin666\dsh-client-ui-skill-explorer')) {
  $j = Get-Content -LiteralPath "$d\$p\package.json" -Raw | ConvertFrom-Json
  "$p | main=$($j.main) | exports[./client]=$($j.exports.'./client' | ConvertTo-Json -Compress) | dsh=$($j.dsh | ConvertTo-Json -Compress -Depth 6)"
}
```

- 其**客户端 bundle 首行**（用于证 §E.1 的 `__ModuleLoader__` 格式）**实测于** `Get-Content -LiteralPath <pkg>\lib\client.js -TotalCount 6 -Encoding UTF8`。
- 其**主题令牌清单**（§E.6 的 403 个）**实测于**此前 §E.6 给出的正则抽取命令。

---

## A. `defineTool` 的精确调用形态 —— 状态：**已证实**

### A.1 从哪个包导入

- **`import { defineTool } from '@deepseek-ai/dsh-tools'`**。
  - 官方 README 示例原句（`[TOOLS]:37`）：`import { defineTool } from '@deepseek-ai/dsh-tools'`
  - 类型再导出（`[TOOLS]\lib\types\index.d.ts:24`）：`export { defineTool, valueSchemaSpecToJsonSchema, parameterSchemaSpecToJsonSchema, validateArgs, ToolArgsError, ... } from './schema.ts';`
  - 真实插件用法（`[LUNHENG]\lib\tools.js:115-116`）：动态 import 同一包名
    `const factory = defineToolFactory || (() => import('@deepseek-ai/dsh-tools'))` / `;({ defineTool } = await factory())`
  - 结论：包名 `@deepseek-ai/dsh-tools`，具名导出 `defineTool`。**无默认导出**。

### A.2 传入对象的字段表（`DefineToolOptions`，`[TOOLS]\lib\types\schema.d.ts:178-240`）

| 字段 | 必填？ | 类型 / 取值 | 证据 |
|---|---|---|---|
| `name` | **必填** | `string`（"must be unique"） | `[TOOLS]\lib\types\schema.d.ts:180` |
| `description` | **必填** | `string`（发给模型） | 同上 `:182` |
| `parameters` | **必填** | `ParameterSchemaSpec`（隐式开放对象根） | 同上 `:184` |
| `output` | **必填** | 对象 `{ schema, render, presentationMeta? }` | 同上 `:186-193` |
| `deferLoading` | 可选 | `true`（仅此字面量） | 同上 `:195` |
| `timeoutMs` | 可选 | 正整数毫秒（**登记声明，注册表不强制**） | 同上 `:197`；`[TOOLS]:232`（README：「仅作声明之用」） |
| `isConcurrencySafe` | 可选 | `(args) => boolean`，**纯函数分类器** | 同上 `:198-203` |
| `execute` | **必填** | `(args, exec) => Promise<value>` | 同上 `:204-210` |
| `projectContent` | 可选 | `(exec, result) => ContentBlock[] \| undefined` | 同上 `:211-217` |
| `finalizeContent` | 可选 | 同上（含非法入参路径，`args` 为 `unknown`） | 同上 `:218-226` |
| `presentCall` | 可选 | `(args) => ToolCallView \| undefined` | 同上 `:227-232` |
| `presentResult` | 可选 | `(args, result) => ToolResultView \| undefined` | 同上 `:233-239` |
| **`executionMode`** | **不是字段** | —— | **见 A.7（重要）** |

### A.3 `parameters` 里每个参数怎么写 —— 任务里的形态**正确**

- **`{ type: 'string', required: true, description: '...' }` 形态正确。** 精确字段名就是 `type` / `required` / `description`。
- 类型定义（`[TOOLS]\lib\types\schema.d.ts:74-84`）：
  ```ts
  /** One implicit parameter-root property, optionally required. */
  export type ParameterPropertySpec = ValueSchemaSpec & { required?: true; };
  /** Tool parameter schema. The map itself is an implicit open object root;
   *  requiredness remains a per-property `required: true` annotation. */
  export type ParameterSchemaSpec = { [key: string]: ParameterPropertySpec; [key: symbol]: never; };
  ```
  - 注意：`required` 的类型是字面量 **`true`**（不是 `boolean`）。省略 = 可选。
- 官方 README 示例原文（`[TOOLS]:44-48`）：
  ```ts
  parameters: {
    path: { type: 'string', required: true, description: 'Absolute file path' },
    offset: { type: 'number' },
    limit: { type: 'number' },
  },
  ```
- 真实插件实测同形（`[LUNHENG]\lib\tools.js:134-137`）：
  ```js
  parameters: {
    draft: { type: 'string', required: true, description: '被审正文路径（<项目>/final/定稿.md 或 <项目>/drafts/初稿-vN.md）' },
    evidence: { type: 'string', required: true, description: '证据包目录（<项目>/final/证据包）' },
    summary: { type: 'boolean', description: 'true = 只回聚合统计与硬失败项（省 token）；省略 = 全量 results' },
  },
  ```

#### A.3.1 每个 schema 节点允许的字段（白名单，写别的会**在定义期抛错**）

- 通用注解（`ValueSchemaAnnotations`，`[TOOLS]\lib\types\schema.d.ts:9-18`）：`description?` / `title?` / `default?` / `examples?`
- 按 `type` 追加：
  | `type` | 追加字段 | 证据 |
  |---|---|---|
  | `'string'` | `enum?: readonly string[]`、`const?: string` | `schema.d.ts:20-24` |
  | `'number'` | `enum?: readonly number[]`、`const?: number` | `:26-30` |
  | `'integer'` | `enum?: readonly number[]`、`const?: number` | `:32-36` |
  | `'boolean'` | `enum?: readonly boolean[]`、`const?: boolean` | `:38-42` |
  | `'null'` | `enum?: readonly null[]`、`const?: null` | `:44-48` |
  | `'array'` | `items?: ValueSchemaSpec` | `:50-53` |
  | `'object'` | `properties?: ParameterSchemaSpec`、**`additionalProperties: boolean`（必填）** | `:58-62` |
  | `'json'` | 无（作者专用无约束 JSON） | `:64-66` |
  | `oneOf` | `oneOf: readonly [A, B, ...A[]]`（**至少两支**） | `:68-70` |
- **对象节点必须显式写 `additionalProperties`**，注释原文（`[TOOLS]\lib\types\schema.d.ts:54-57`）：
  > "Explicit object value schema. Openness is mandatory so a nested or output object never acquires an accidental JSON Schema default."
- 写了白名单外的键 → **抛错**，实现原文（`[TOOLS]\lib\index.js:556`）：
  ```js
  for (const key of Object.keys(source)) if (!allowed.includes(key)) authorError(`${path}.${key} is not supported by the value schema DSL`);
  ```
- `'json'` 节点只允许作者用；编译成「仅注解」schema。

#### A.3.2 ★ `required` **只能**出现在参数属性层，绝不能出现在 `output.schema` 里

- 机制：编译器对参数根传 `allowRequired: true`，对值 schema 传 `false`。
  - 参数属性分支：`[TOOLS]\lib\index.js:609` → `allowRequired: true,`
  - 参数根键白名单：`[TOOLS]\lib\index.js:655` → `const authorKeys = [...ANNOTATION_KEYS, ...task.allowRequired ? ["required"] : []];`
  - 值 schema（`output.schema` 走这条）：`[TOOLS]\lib\index.js:677` / `:725` / `:777` → 三处均 `allowRequired: false,`
- 真实插件踩坑记录与本机实测报错原文（`[LUNHENG]\lib\tools.js:155-160`）：
  > ⚠️ 此处**不得**写 `required`（嵌套与根都不行——见下）。宿主 value schema DSL 的 `required` 只在**参数属性**层可用（`dsh-tools/lib/index.js:600-608` 的 property 分支 `allowRequired:true`），`output.schema` 走 `compileValueSchema`（同文件 :770-783，`allowRequired:false`）。写错会让 `defineTool()` **在定义期抛错** → 工具永不注册，且被入口的降级 catch 吞成一行提示。**实测报错原文**：`unsupported JSON schema: schema.required is not supported by the value schema DSL`。回归防线：`tests/entry.test.mjs` 断言「output.schema 全程不得出现 required」。
- **照抄要求**：`output.schema`（含其所有嵌套层）里**一律不写 `required`**；对象节点仍必须写 `additionalProperties`。

### A.4 `output.schema` 与 `output.render` 的签名

- 类型（`[TOOLS]\lib\types\schema.d.ts:186-193`）：
  ```ts
  readonly output: {
      /** Schema enforced against every successful body or policy-replaced value. */
      readonly schema: O;
      /** Pure Native/model rendering of one validated canonical value. */
      render(args: InferArgs<S>, value: InferValue<NoInfer<O>>): ContentBlock[];
      /** Pure replayable presentation metadata for direct top-level calls. */
      presentationMeta?(args: InferArgs<S>, value: InferValue<NoInfer<O>>): JsonValue;
  };
  ```
- 运行时契约（`ToolOutputDefinition`，`[TOOLS]\lib\types\index.d.ts:105-113`）：
  - `schema: JsonSchemaNode` —— "Raw supported JSON Schema enforced against every successful canonical value."
  - `render(args: unknown, value: JsonValue): ContentBlock[]`
  - `presentationMeta?(args: unknown, value: JsonValue): JsonValue`
- **`render` 必须返回 `ContentBlock[]`**（数组，不是字符串）。最小形态就是单元素 `[{ type: 'text', text: '...' }]`。
  - 官方 README（`[TOOLS]:51`）：`render: (_args, value) => [{ type: 'text', text: value }],`
  - 真实插件（`[LUNHENG]\lib\tools.js:174-182`）：`render: (args, v) => [{ type: 'text', text: ... }],`
- `render` 是**纯函数**（UI/回放都可能调用）；不要在其中做 IO。
- `presentationMeta` 为可选，产物持久化到 `tool/result` 的 `meta`，供 Host presenter / Client renderer 各自收窄（`[TOOLS]\lib\types\index.d.ts:198-204`）。

### A.5 `execute` 收到几个参数、返回什么

- **收 2 个参数：`(args, exec)`。**
  - 类型（`[TOOLS]\lib\types\schema.d.ts:204-210`）：
    ```ts
    /**
     * Execute the tool after argument validation.
     * @param args - typed validated arguments.
     * @param exec - execution identity, caller, cancellation, and nesting data.
     * @returns The canonical value declared by `output.schema`.
     */
    execute(args: InferArgs<S>, exec: ToolRunContext): Promise<InferValue<NoInfer<O>>>;
    ```
- **返回**：`output.schema` 所声明的那个**规范 JSON 值**（不是 `ContentBlock[]`；文本渲染交给 `render`）。
- `args` 已被注册表**校验并深冻结**（`[TOOLS]\lib\types\index.d.ts:277-280`：`Parsed arguments cross one lossless-JSON materialization boundary before policy and are deep-frozen;`）。非法入参**不会**进 `execute`，会变成 `ToolArgsError`（`[TOOLS]\lib\index.js:866-870`）：
  ```js
  async execute(args, exec) {
      const violations = validate(args);
      if (violations.length > 0) throw new ToolArgsError(violations);
      return userExecute(args, exec);
  }
  ```
- **`exec` 是 `ToolRunContext`**（`[TOOLS]\lib\types\index.d.ts:305-322`），关键成员：
  - `exec.signal: AbortSignal` —— **必须转发/观测**（"Async work must observe or forward `exec.signal` and settle only after its owned work reaches quiescence."，`index.d.ts:119-123`）
  - `exec.callId` / `exec.rootCallId` / `exec.token` / `exec.name` / `exec.arguments` / `exec.agent?` / `exec.parent?`（`index.d.ts:216-242`、`:282-287`）
  - `exec.deferContext(context: UserMessage): void`（`index.d.ts:306-312`）
  - `exec.concludeTurn(): void`（`index.d.ts:313-321`）
- **抛异常 = 该次调用失败**（`isError`）。真实插件注释（`[LUNHENG]\lib\tools.js:192`）：`// 基础设施失败（拿不到 JSON）→ throw（官方：throw 表示 isError）；内容不理想不算失败`。
- 失败结果对模型的确切文本形态（`[TOOLS]:212`）：`任何抛出异常或遭到拒绝的调用，都会转换为确切的 Error: <message>`。

### A.6 官方最小完整示例（逐字摘录，`[TOOLS]\README.zh.md:34-58`）

```ts
import { readFile } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

declare const ctx: Context

ctx.tools.register(defineTool({
  name: 'read_file',
  description: 'Read a file from disk.',
  parameters: {
    path: { type: 'string', required: true, description: 'Absolute file path' },
    offset: { type: 'number' },
    limit: { type: 'number' },
  },
  output: {
    schema: { type: 'string' },
    render: (_args, value) => [{ type: 'text', text: value }],
  },
  async execute(args, exec) {
    // args is typed: { path: string; offset?: number; limit?: number }
    return readFile(args.path, { encoding: 'utf8', signal: exec.signal })
  },
}))
```

### A.7 ★★ 重要：「`executionMode`」**不是** `defineTool` 的选项，传了会被静默忽略

- 任务描述里提到 `executionMode`。**实测结论：把 `executionMode` 传给 `defineTool` 是无效的（no-op），且不会报错。**
- `defineTool` 实现从**显式白名单**构造工具对象，完全**不读取** `options.executionMode`（`[TOOLS]\lib\index.js:838-887`）：
  ```js
  function defineTool(options) {
      const userExecute = options.execute;
      const userFinalizeContent = options.finalizeContent;
      const userProjectContent = options.projectContent;
      const userRender = options.output.render;
      const userPresentationMeta = options.output.presentationMeta;
      const userPresentCall = options.presentCall;
      const userPresentResult = options.presentResult;
      const userIsConcurrencySafe = options.isConcurrencySafe;
      if (options.timeoutMs !== void 0 && (...)) throw new Error(`defineTool(${options.name}): timeoutMs must be a positive finite number`);
      const parameters = parameterSchemaSpecToJsonSchema(options.parameters);
      const outputSchema = valueSchemaSpecToJsonSchema(options.output.schema);
      ...
      const tool = {
          name: options.name,
          description: options.description,
          parameters,
          output: { ... },
          ...options.deferLoading === true ? { deferLoading: options.deferLoading } : {},
          ...options.timeoutMs !== void 0 ? { timeoutMs: options.timeoutMs } : {},
          async execute(args, exec) { ... }
      };
      if (userProjectContent) tool.projectContent = ...;
      if (userFinalizeContent) tool.finalizeContent = ...;
      if (userPresentCall) tool.presentCall = ...;
      if (userPresentResult) tool.presentResult = ...;
      if (userIsConcurrencySafe) tool.isConcurrencySafe = ...;
      return tool;
  }
  ```
  - 该函数**没有** `for (const key of Object.keys(options))` 之类的未知键校验 ⇒ 未知顶层键既不被读取也不抛错。
- `executionMode` 在 `@deepseek-ai/dsh-tools` 中**只作为 `ToolRuntime` 的方法**存在：
  - `[TOOLS]\lib\index.js:3057` → `executionMode(exec) {`
  - `[TOOLS]\lib\index.js:3059` → `if (!tool?.isConcurrencySafe) return { kind: "exclusive" };`
  - `[TOOLS]\lib\index.js:3061` → `return tool.isConcurrencySafe(exec.arguments) === true ? { kind: "parallel" } : { kind: "exclusive" };`
  - 类型声明（`[TOOLS]\lib\types\index.d.ts:716-723`）：`executionMode(exec: ToolExecutionInput): ToolExecutionMode;`
- **并行安全的正确写法是 `isConcurrencySafe`**（`[TOOLS]\lib\types\index.d.ts:159-172`）：
  > "Pure synchronous classifier for overlap with sibling tool calls. Only `true` opts in; omission, exceptions, non-`true` returns, and invalid `defineTool` arguments are exclusive. This metadata is never model-visible."
- **与预期不符②（重要，会影响返工）**：本机已安装的真实插件 `lunheng-article-pipeline` 在 4 个工具上写了
  `executionMode: 'parallel'`（`[LUNHENG]\lib\tools.js:129`、`:217`，及其余工具的同类位置），
  并配有大段注释声称「`executionMode:'parallel'` 让 driver 用有界滚动池调度」（`[LUNHENG]\lib\tools.js:125-126`）。
  **按 0.2.0-rc.2 的实现，该字段被静默丢弃 ⇒ 这些工具实际仍按 `exclusive` 调度。**
  - 其注释还引用了 `audits/反哺报告-...md` 作为授权依据，**未在本机复核该文件**。
  - **本文件的结论仅来自 `[TOOLS]\lib\index.js` 与 `[TOOLS]\lib\types\schema.d.ts`（0.2.0-rc.2）静态阅读**；
    未启动 harness 做端到端调度行为实验。**「`executionMode` 在别的 DSH 版本上是否生效」未证实。**
  - ⇒ **照抄建议**：`yibinthesis-dsh` 要用并行安全，只写 `isConcurrencySafe: (args) => true`，不要写 `executionMode`。

### A.8 其它已验证的 `defineTool` 事实

- `deferLoading` 只接受字面量 `true`（`[TOOLS]\lib\types\schema.d.ts:194-195`；`[TOOLS]\lib\index.js:864` 用 `options.deferLoading === true` 判定）。
- `timeoutMs` 非正数/非有限值 → **定义期抛错**（`[TOOLS]\lib\index.js:847`），且**注册表绝不强制执行截止时间**（`[TOOLS]:232`）；要强制须挂 `@deepseek-ai/dsh-tool-call-timeout-policy`。
- 模型**看不到** `output` / `execute` / `finalizeContent` / `timeoutMs` / 呈现回调（`[TOOLS]:105` + `[TOOLS]\lib\types\index.d.ts:152-158`）。
- 工具名 `run_code` 是保留名，注册会失败（`[TOOLS]\lib\types\index.d.ts:630-636`：`duplicates within one layer and the reserved \`run_code\` name fail`）。
- `presentCall` / `presentResult`：**内置 Web Client 不消费它们**。原文（`[TOOLS]:91`）：
  > 工具可以为 Host 本地消费方保留纯函数 `presentCall()` 与 `presentResult()` 方法。**内置 Web Client 不消费这些值**，而是通过 `tool.call.toolview` 选择 renderer，并从原始调用参数、结果内容、失败状态与持久 metadata 派生 card props。
  - ⇒ 想让 Web GUI 出现自定义卡片，走 `tool.call.toolview` 路径，**不是** `presentCall`。该 renderer 注册 API **未证实**（不在本次已拉取的包内）。

---

## B. 工具注册到 ctx 的精确写法 + 插件入口语义 —— 状态：**已证实**

### B.1 注册写法

- **标准写法：`ctx.tools.register(defineTool({ ... }))`。**
  - 官方 README（`[TOOLS]:41`）：`ctx.tools.register(defineTool({`
  - 服务注入声明（`[TOOLS]\lib\types\index.d.ts:32-35`）：
    ```ts
    declare module '@deepseek-ai/cordis' {
        interface Context { tools: ToolRuntime; }
    ```
- **`register` 签名与返回值**（`[TOOLS]\lib\types\index.d.ts:630-636`）：
  ```ts
  /**
   * Register globally or in the calling agent scope. Scoped tools shadow
   * globals; duplicates within one layer and the reserved `run_code` name fail.
   * @param definition - tool schema, execution, and optional finalization/presentation callbacks.
   * @returns the exact disposer that unregisters the tool.
   */
  register(definition: ToolDefinition): () => void;
  ```
- **disposer 怎么处理**：`register` 返回**精确的反注册 disposer**。两种正确处置：
  1. 交给 `ctx.effect()` 作用域托管（**推荐**，卸载/HMR 自动回收）；
  2. 自己收集成数组，在 effect 返回的清理函数里逐个调用。
  - 真实插件同时用了两种（`[LUNHENG]\lib\tools.js:111-127`）：
    ```js
    const tools = ctx.get('tools')
    if (!tools?.register) return []
    ...
    const disposers = []
    disposers.push(tools.register(defineTool({ ... })))
    ```
    其调用点（`[LUNHENG]\lib\index.js:304`）是 `ctx.effect(() => { const disposers = []; ... })`。
- **变体写法（可选依赖 + 降级，非必需）**：`ctx.get('tools')` 取服务而非 `inject`。
  - `[LUNHENG]\lib\tools.js:111-112`：`const tools = ctx.get('tools')` / `if (!tools?.register) return []`
  - 动机（`[LUNHENG]\lib\tools.js:13-17` 注释）：若为工具而把 `tools` 写进 `inject` 或静态 import 宿主包，一旦某 profile 缺该服务/包，**整个入口 import 失败 → 技能也不注册**。
  - ⇒ 这是**防御性设计取舍**，不是契约要求。若 `yibinthesis-dsh` 只有工具这一个职责，直接用 `inject: ['tools']` + 静态 import 更简单。
- 其它注册面（同文件）：
  - `restrict(filter: ToolRestriction): () => void`（`index.d.ts:637-644`）
  - `guard(guard: ToolGuard): () => void`（`index.d.ts:645-655`）
  - `get(name, scope?): ToolDefinition | undefined`（`:681-690`）
  - `schemas(scope?): ToolSchema[]`（`:705-711`）
  - `execute(exec: ToolExecutionInput): Promise<ToolExecutionResult>`（`:751-765`）
- 可用事件（`index.d.ts:36-103`）：`tools/pre-execute`（waterfall）、`tools/execute`（waterfall）、`tools/post-execute`（waterfall）、`tools/ptc-dispatch-log`（waterfall）、`tools/result`（emit）、`tools/change`（emit）。

### B.2 插件入口各导出的语义

真实插件入口实测齐备（`[LUNHENG]\lib\index.js`）：

| 导出 | 语义 | 证据 |
|---|---|---|
| `export const name` | 插件的 **fiber 名**；loader 的 patch 行按 `name` 解析包，包内 `name` 又与技能名/诊断标签对齐 | `[LUNHENG]\lib\index.js:22` → `export const name = 'lunheng-article-pipeline'` |
| `export const inject` | **要等待的服务名数组（不是包名！）**；列出的服务在 `apply` 执行前已就绪，缺失则插件不激活 | `[LUNHENG]\lib\index.js:23` → `export const inject = ['skills']`；客户端侧同类：`[JOBS]\lib\client.js:596-600` → `const inject = ["jobs","slots","locale"]` |
| `export const Config` | **可选**的插件配置 schema。存在时 loader 会校验 config，非法**在加载期响亮失败**；**不存在时加载器把原始 config 原样传入（`apply` 第二参数），而「配置被静默丢弃」是常见缺陷** | `[LUNHENG]\lib\index.js:103-105`；机理见同文件 `:28-33` 注释（引 `@deepseek-ai/cordis/lib/index.js:955-961`、`:1067/:1070`） |
| `export function apply(ctx, config)` | 插件主体。所有副作用应经 `ctx.effect(...)` 登记，以便卸载/HMR 回收 | `[LUNHENG]\lib\index.js:215` → `export function apply(ctx, config) {` |

#### B.2.1 `Config` 的**零依赖**写法（已证实可用，且绕开 pnpm 解析坑）

- 契约只需 **standard-schema v1** 接口：`Config['~standard'].validate(config)` 返回 `{value}` 或 `{issues:[{message, path}]}`。
  证据（`[LUNHENG]\lib\index.js:43-46` 注释）：
  > Cordis 需要的其实只有 **standard-schema 接口**：`Config['~standard'].validate(config)` 返回 `{value}` 或 `{issues:[{message,path}]}`（`cordis/lib/index.js:955-961`；issue 形态见 `ValidationError`，同文件 `:932-945`）。自己实现这 20 行即可**零依赖**拿到「加载期校验 + 响亮失败 + `--dump-config` 可见」。
- 实例形态（`[LUNHENG]\lib\index.js:103-105`）：
  ```js
  export const Config = Object.freeze({
    '~standard': Object.freeze({ version: 1, vendor: 'lunheng-article-pipeline', validate: validateConfig }),
  })
  ```
- **为什么不用 `@deepseek-ai/schemastery`**（`[LUNHENG]\lib\index.js:36-42` 注释，**实测教训**）：
  > **动态 import 也不行**：宿主用 **pnpm** 安装（`dsh plugin add` 走 pnpm），pnpm 只为**已声明**的依赖建私有 `node_modules` 链接，而 `@deepseek-ai/schemastery` 不在本包依赖表里 → `import('@deepseek-ai/schemastery')` 在 pnpm 布局下解析不到。**实测**：即便把包按 profile 布局放好（`node_modules/lunheng-article-pipeline` + `node_modules/@deepseek-ai/schemastery`），经 junction/symlink 后 Node 按 **realpath** 向上找依赖，仍然找不到 → Config 恒为 undefined。
  - ⇒ **照抄要点**：若 `yibinthesis-dsh` 要声明 `Config`，**优先用 standard-schema 自实现**，或**把依赖显式写进 `dependencies`**。不要指望未声明的可选依赖在 pnpm 下解析成功。

#### B.2.2 `ctx.effect` —— 副作用归属原语

- 签名（从真实用法归纳，**未在本次已读的 `.d.ts` 中见到正式声明**，标为**部分证实**）：
  `ctx.effect(fn: () => (void | (() => void)), label?: string): void`
  - 传函数，函数可返回清理函数；第二个参数是可选的诊断标签字符串。
  - 证据（3 处独立实现）：
    - `[LUNHENG]\lib\index.js:247` → `ctx.effect(() => {`（无标签）
    - `[JOBS]\lib\client.js:606-609` → `ctx.effect(() => ctx.locale.register("job", { zh, en }), "ui-jobs: dictionaries");`
    - `[UNIVER]\lib\client.js:23321` → `ctx.effect(() => ctx.locale.register(UNIVER_LOCALE_NAMESPACE, { zh, en }), "univer: dictionaries");`
    - `[STATUS-ROTATOR]\lib\index.js`（`C:\Users\LoyDgIk\.dsh\profiles\desktop\node_modules\dsh-status-rotator\lib\index.js`）→ `ctx.effect(() => startRemoteBankUpdater(), "status-rotator: remote bank updater");` 与 `ctx.effect(() => { ... return () => {...} }, "status-rotator: config.json route");`
- ⇒ **实践建议**：所有 `register` / 路由 / 定时器都包在 `ctx.effect` 里并交回 disposer；用标签便于诊断。

---

## C. `cordis.patch.yml` 的 patch 语法 —— 状态：**已证实**（loader 内部行号引文除外，见 C.5）

### C.1 patch 文件是「顶层 YAML 数组」

- profile 自己的 patch 文件开头注释即规格（`[PROFILE]cordis.patch.yml:1-4`）：
  ```yaml
  # Your patch layer for this dsh profile, applied after every bundle layer:
  # a top-level YAML array of loader patch entries (id-targeted config
  # overrides, disables, and insert lists; `!!js` expressions allowed).
  ```

### C.2 `- insert:` 语法与行内字段

- **新增行必须用 `- insert:` 包一层列表**；列表里每个元素是一行插件声明，字段为 `id` / `name` / `config` / `disabled`。
- 最小真实样例（`[UNIVER]cordis.patch.yml` 全文，仅 5 行有效内容）：
  ```yaml
  # DSH × Univer integration: Host services + browser client + bundled Gateway and Viewer.
  - insert:
      - id: univer
        name: 'dsh-univer-office'
  ```
- 本包入口行（`[LUNHENG]cordis.patch.yml`，文件末尾的实际 patch 部分）：
  ```yaml
  - insert:
      - id: lunheng-article-pipeline
        name: lunheng-article-pipeline
  ```
- 带 `config` 与 `disabled` 的完整字段形态（`[LUNHENG]cordis.patch.yml`）：
  ```yaml
  - insert:
      - id: tool-subagent-retrieval
        name: '@deepseek-ai/dsh-tool-subagent'
        disabled: !!js "process.env.LUNHENG_TIERING === 'off' || (...)"
        config:
          provider: spawn
          toolName: subagent_retrieval
          backgroundMode: continuable
          agentOptions: !!js "(e => { ... })(process.env)"
  ```
- **`- id: X` 覆盖已存在行**（不是新增）：`[PROFILE]cordis.patch.yml` 里大量这种形态，例如
  ```yaml
  - id: ui-chat
    name: "@deepseek-ai/dsh-client-ui-chat"
    config:
      transcriptView: standard
      performanceUsage: compact
  - id: ui-settings
    name: "@deepseek-ai/dsh-client-ui-settings"
    config:
      enabled: false
  - id: tool-subagent-retrieval
    disabled: true
  ```
  - `[LUNHENG]cordis.patch.yml` 注释给了语义对照：
    > `- id: X`：覆盖已存在 id 的 config（v2.5.2-dsh.0 之前的默认语义，常误用产生 "entry not found" 警告）
    > `- insert: - id: X`：新增一行（不覆盖任何东西；DSH 真正推荐的 patch 模式）
    > 普通行按 id-targeted patch existing row；新增行必须用 `- insert:` 形式
- ⇒ 字段语义归纳：`id` = 该行的稳定标识（用于后续层按 id 覆盖/禁用）；`name` = 要解析加载的模块（包名或内置名）；`config` = 传给该插件 `apply(ctx, config)` 的配置对象；`disabled` = 行级门控（`true` 或 `!!js` 表达式，求值为真则该行不装载）。

### C.3 ★ 包名解析入口：`name` 必须写**本包自己的包名**

- `[LUNHENG]cordis.patch.yml` 注释原文（**这是最容易漏、且后果最严重的一条**）：
  > ⚠️ **第 1 行为什么不能删（v18.0.1 修复）**：官方 `publish.zh.md` 明确——组合包的 patch 必须**插入一行 `name` = 本包包名**，「插件行按包名而不是相对源码路径引用这个包，这样 Node 的模块解析才能找到已安装的代码」。**patch 里的行才是会被 import 的东西**；`package.json#main` 不会因为「包被列进 profile 的 bundles」就自动执行。v18.0.0 删掉旧的 skill-filesystem 挂载行时漏补这一行 → 入口从不被 import → 技能不注册（实测：组合树中 `name: lunheng-article-pipeline` 行数 = 0，只有三档工具）。已发布版本不可再改，故以 18.0.1 修复，并由 `tests/bundle-contract.test.mjs` 机械防守。
- ⇒ **对 `yibinthesis-dsh` 的硬性要求**：`cordis.patch.yml` 必须含
  ```yaml
  - insert:
      - id: yibinthesis-dsh
        name: yibinthesis-dsh
  ```
  且该 `name` 与 `package.json#name`、包入口 `export const name` 三者一致（本机两个真实包均已对齐：`[UNIVER]cordis.patch.yml` 的 `name: 'dsh-univer-office'` ↔ `[UNIVER]package.json:2`；`[LUNHENG]` 的 `name: lunheng-article-pipeline` ↔ 其 `package.json#name`）。

### C.4 客户端半**不需要**额外的 patch 行

- `[UNIVER]cordis.patch.yml` 全文只有 1 行 insert，但该包有完整的浏览器半（`[UNIVER]package.json` 有 `dsh.client` 与 `exports["./client"]`）。
- ⇒ **客户端半由 `dsh.client` 字段驱动加载，不在 `cordis.patch.yml` 里单独挂行**。（机制细节见 D.3，标注为部分证实。）

### C.5 `disabled` / `!!js` 求值 —— **转引，未独立复核**

- `[LUNHENG]cordis.patch.yml` 注释声称（引 `@deepseek-ai/cordis-plugin-loader` 源码）：
  - `src/config/entry.ts:19` 声明 `disabled?: boolean | null`
  - `disabledOf()`（同文件 `:104-107`）：`isJsExpr(options.disabled) ? Boolean(this.evaluate(options.disabled.__jsExpr)) : Boolean(options.disabled)`
  - `refresh()`（`:124-128`）首行 `if (this.disabled) return` → 不进 init，行不装载
  - `update()`（`:181-189`）在 `_disabled(candidate)` 为真时 `_dispose(previous)` → 热更新主动卸载
  - 宿主自用先例：DSH Desktop 随包 `cordis.patch.yml` 的 `disabled: !!js process.platform === 'linux'`
- **本机 `@deepseek-ai/cordis-plugin-loader` 源码不可得**（profile 内 junction 断链，见 0.2），
  ⇒ **以上行号与函数名均为转引，未独立复核。**
- 已证实（可自己复现）的部分：
  - `!!js` 是**加载期**由宿主进程以完整 Node 权限求值，发生在 agent 沙箱与审批关卡之前；
  - 因此 `[LUNHENG]cordis.patch.yml` 自设红线：只允许 `process.env.*`、全局 `Object.assign` 级取值；禁止 `getBuiltinModule` / `child_process` / `require(` / `import(` / `eval(` / `new Function` / `fs.` / `node:`。
  - 证据：`[LUNHENG]cordis.patch.yml` 的「执行面披露（v2.5.2-dsh.13 新增；v18.2.6 更正计数并复核为 6 处）」段落。
- ⇒ **对 `yibinthesis-dsh` 的建议**：patch 里**尽量不写 `!!js`**。若必须按环境开关某行，只读 `process.env.*`。

---

## D. `package.json` 各 `dsh.*` 字段的语义与取值 —— 状态：**已证实**（D.3 的加载机制为部分证实）

### D.1 `dsh.bundle.patch` —— **必填**，指向 patch 文件

- 取值：**相对包根的路径字符串**。实测到的两种写法（`./` 前缀有无皆可）：
  | 包 | 取值 | 证据 |
  |---|---|---|
  | `lunheng-article-pipeline` | `"./cordis.patch.yml"` | `[LUNHENG]package.json` → `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }` |
  | `dsh-univer-office` | `"./cordis.patch.yml"` | `[UNIVER]package.json` → `"dsh": { "bundle": { "patch": "./cordis.patch.yml" }, ... }` |
  | `dsh-free-search` | `"cordis.patch.yml"`（无 `./`） | `C:\Users\LoyDgIk\.dsh\profiles\desktop\node_modules\dsh-free-search\package.json` |
- 语义：该文件是**组合包 patch**，在 standard 组合树之上叠加。若包被列进 profile 的 `dsh.profile.bundles`，其 patch 被应用。
- profile 侧组合方式（`[PROFILE]package.json`）：
  ```json
  "dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", ..., "lunheng-article-pipeline", ...], "patchReload": "live" } },
  "dependencies": { "lunheng-article-pipeline": "18.62.9", ... }
  ```
  - ⇒ 两处都要有：`bundles` 数组（参与组合）+ `dependencies`（能被解析安装）。
  - `patchReload: "live"` —— **仅证实该键存在并取此值；精确语义未证实**（未在本次可得的任何 `.d.ts` / README 中找到说明；`C:\Users\LoyDgIk\.dsh\profiles\` 下另有 `web` profile，未读取）。
  - `[PROFILE]package.json` 同时是 profile 的 npm 包（`"name": "dsh-profile-desktop"`, `"private": true`）。
- `[PROFILE]pnpm-workspace.yaml` 相关（**用 pnpm 安装时会读**）：
  ```yaml
  packages: [ . ]
  nodeLinker: hoisted
  autoInstallPeers: false
  ```
  - `nodeLinker: hoisted` 很关键：它意味着**依赖被平铺**，而不是 pnpm 默认的符号链接布局。这与 B.2.1 里 lunheng 记录的 pnpm 解析坑相关。**「hoisted 布局是否让未声明依赖变得可解析」未证实。**

### D.2 `dsh.client.platform` —— 客户端半的目标平台

- 实测取值：**全部为 `"web"`**（无一例外）。
  | 包 | 取值 | 证据 |
  |---|---|---|
  | `dsh-univer-office` | `"web"` | `[UNIVER]package.json` → `"client": { "platform": "web", "inject": [...] }` |
  | `@deepseek-ai/dsh-client-ui-jobs` | `"web"` | `[JOBS]package.json:60` |
  | `dsh-better-sidebar` | `"web"` | `[SIDEBAR]package.json` |
  | `dsh-free-search` | `"web"` | `[FREESEARCH]package.json` |
  | `dsh-status-rotator` | `"web"` | `[STATUS-ROTATOR]package.json` |
  | `dsh-context` | `"web"` | `[CTX-PLUGIN]package.json` |
  | `@linxin666/dsh-client-ui-skill-explorer` | `"web"` | `[SKILLEXP]package.json` |
  | `@deepseek-ai/dsh-api-job-controller` | `"web"` | `[JOBC]package.json:49` |
- **是否存在其它取值（如 `tui` / `desktop`）：未证实。** 本次可见范围内只有 `"web"`。

### D.3 `dsh.client.inject` —— ★ 写的是**包名**，不是服务名

- **这是最容易搞错的一点。** 实测对照：
  - `dsh.client.inject` 里是**包名**（`@deepseek-ai/...`）：
    - `[JOBS]package.json:54-59`：
      ```json
      "inject": [
        "@deepseek-ai/dsh-api-job-controller",
        "@deepseek-ai/dsh-client-locale",
        "@deepseek-ai/dsh-client-ui-conversation",
        "@deepseek-ai/dsh-client-ui-primitives"
      ]
      ```
    - `[UNIVER]package.json` → `"inject": ["@deepseek-ai/dsh-client-locale","@deepseek-ai/dsh-client-ui-chat","@deepseek-ai/dsh-client-ui-conversation","@deepseek-ai/dsh-client-ui-renderer","@deepseek-ai/dsh-client-ui-session","@deepseek-ai/dsh-client-ui-settings","@deepseek-ai/dsh-client-ui-settings-plugins"]`
    - `dsh-better-sidebar` → `"inject": ["@deepseek-ai/dsh-client-locale","@deepseek-ai/dsh-client-ui-slots","@deepseek-ai/dsh-client-ui-conversation","@deepseek-ai/dsh-client-ui-sidebar-right","@deepseek-ai/dsh-client-modules"]`（`[SIDEBAR]package.json`）
    - `@linxin666/dsh-client-ui-skill-explorer` → `"inject": ["@deepseek-ai/dsh-client-locale","@deepseek-ai/dsh-client-ui-renderer","@deepseek-ai/dsh-client-ui-layout"]`（`[SKILLEXP]package.json`）
    - `dsh-context` → `"inject": ["@deepseek-ai/dsh-api-remotes","@deepseek-ai/dsh-client-connection","@deepseek-ai/dsh-client-locale","@deepseek-ai/dsh-client-ui-conversation","@deepseek-ai/dsh-client-ui-settings","@deepseek-ai/dsh-client-ui-sidebar-right"]`（`[CTX-PLUGIN]package.json`）
    - （以上第三方条目**实测于** `Get-Content <pkg>\package.json -Raw | ConvertFrom-Json` 后打印 `.dsh`，命令见 §0.2）
  - 而**客户端模块内部**的 `inject` 导出是**服务名**：
    - `[JOBS]\lib\client.js:596-600` → `const inject = ["jobs", "slots", "locale"];`
    - `[UNIVER]\lib\client.js:23306` → `var inject = ["slots", "locale", "conversation", "uiConversation"];`
  - ⇒ **两层 `inject` 语义不同，别混。** `package.json` 那层解决"客户端包依赖哪些别的客户端包（加载顺序）"，`exports.apply` 那层解决"我的 apply 内需要哪些 Cordis 服务已就绪"。
- 空数组合法：`dsh-status-rotator` → `"inject": []`。
- **与预期不符③**：`dsh-status-rotator` 还用了任务清单里**没有提到**的字段：
  ```json
  "client": { "platform": "web", "inject": [], "immediately": true }
  ```
  - **`immediately` 的语义未证实**（不在本次可得的任何 `.d.ts` / README 中）。
- `@deepseek-ai/dsh-api-job-controller` 还用了 `"client": { "external": ["@deepseek-ai/dsh-api-gateway/client"], ... }`（`[JOBC]package.json:42-44`）—— **`external` 语义未证实**。

### D.4 `exports["./client"]` —— 浏览器半的入口子路径导出

- 取值形态两种（**都能用**）：
  1. **带 `types` + `default` 的对象**（TS 友好）：
     - `[JOBS]package.json:13-16`：
       ```json
       "./client": {
         "types": "./lib/types/client/index.d.ts",
         "default": "./lib/client.js"
       }
       ```
     - `[UNIVER]package.json`：`"./client": { "default": "./lib/client.js" }`（无 `types`）
     - `dsh-better-sidebar` / `@linxin666/dsh-client-ui-skill-explorer`：同 `[JOBS]` 形态（`[SIDEBAR]package.json`、`[SKILLEXP]package.json`）
  2. **裸字符串**：
     - `dsh-free-search` → `"./client": "./lib/client.js"`（`[FREESEARCH]package.json`）
     - `dsh-status-rotator` → `"./client": "./lib/client.js"`（`[STATUS-ROTATOR]package.json`）
     - `dsh-context` → `"./client": "./lib/client.js"`（`[CTX-PLUGIN]package.json`）
- 其余导出子路径（同一 `exports` 表内，非必须但真实包都有）：`"."`（宿主入口）、`"./package.json"`；`[JOBC]` 还额外有 `"./types"`、`"./typert"`、`"./remote"`、`"./src/*"`。
- `main` 指向宿主入口（如 `lib/index.js`），`type: "module"`（本机全部包都是），顶层 `types` 指向宿主类型。

### D.5 其它已观测但**语义未证实**的 `dsh.*` 键（不要把猜测写进代码）

| 键 | 观测到的取值 | 状态 |
|---|---|---|
| `dsh.manifestVersion` | `1`（`[SIDEBAR]package.json`） | **未证实** |
| `dsh.engines.dsh` | `">=0.1.7-rc.1"`（`[FREESEARCH]package.json`）、`">=0.2.0-rc.1"`（`[SKILLEXP]package.json`） | **未证实**（推测为版本窗口，但未找到校验实现） |
| `dsh.compatibility.dshReleases` | `{ "0.2.0-rc.2": "compatible" }`（`[CTX-PLUGIN]`、`[FREESEARCH]`、`dsh-vibe-math`） | **未证实** |
| `dsh.minVersion` / `dsh.testedVersion` / `dsh.compatNote` | `dsh-vibe-math` 使用 | **未证实** |

⇒ **照抄建议**：`yibinthesis-dsh` 只用 **已证实** 的 `dsh.bundle.patch` + `dsh.client.{platform,inject}` + `exports["./client"]`。其余键若不确知，宁可不写。

### D.6 已证实的完整 `package.json` 骨架

```json
{
  "name": "yibinthesis-dsh",
  "version": "0.1.0",
  "description": "宜宾论文工具（YibinThesis）的 DSH 原生插件：论文查重口径字数统计 / 格式门 / 引用检查等。",
  "type": "module",
  "main": "./lib/index.js",
  "exports": {
    ".": { "default": "./lib/index.js" },
    "./client": { "default": "./lib/client.js" },
    "./package.json": "./package.json"
  },
  "files": ["lib", "cordis.patch.yml", "README.md"],
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": {
      "platform": "web",
      "inject": [
        "@deepseek-ai/dsh-client-locale",
        "@deepseek-ai/dsh-client-ui-slots"
      ]
    }
  },
  "peerDependencies": {
    "@deepseek-ai/cordis": "~4.0.4",
    "@deepseek-ai/dsh-tools": "^0.2.0-rc.2"
  },
  "engines": { "node": ">=22.19.0" }
}
```

- `engines.node` 依据：`[TOOLS]`（`@deepseek-ai/dsh-tools` 随包 README 的 `engines`）无；但 `[LUNHENG]package.json` 用 `"node": "^22.19.0 || >=24.0.0"`，`[UNIVER]package.json` 用 `">=22.19.0"`，`dsh-univer-office` 亦为 `">=22.19.0"`。取 `>=22.19.0` 是本机两个真实包的交集下界。
- `peerDependencies.@deepseek-ai/cordis` 依据：`[JOBS]package.json:30` → `"@deepseek-ai/cordis": "~4.0.4"`；`[UNIVER]package.json` → `"^4.0.2"`；`[JOBC]package.json:69` → `"~4.0.4"`。
- ⇒ **注意**：若 `yibinthesis-dsh` 采用 B.2.1 的**零依赖 Config**写法且入口不静态 import 任何宿主包，则 peer 依赖可像 lunheng 一样全部标**可选**（`peerDependenciesMeta` + `optional: true`，见 `[LUNHENG]package.json`）。

---

## E. 客户端插件模块的编码骨架 —— 状态：**已证实**（E.5 清单为部分证实）

### E.1 ★★ 客户端半**不是**普通 ESM —— 必须打成 `window.__ModuleLoader__.load({...})` 包裹格式

- **这是本次侦察最重要的、最容易被漏掉的契约。** 所有实测到的客户端半（官方 + 第三方，共 5 个独立包）都是同一格式：

| 包 | 首行/行号 | 证据 |
|---|---|---|
| `@deepseek-ai/dsh-client-ui-jobs`（官方） | `client.js:1` | `window.__ModuleLoader__.load({` |
| `dsh-univer-office`（第三方） | `client.js:1` | `window.__ModuleLoader__.load({` |
| `dsh-free-search`（第三方） | `client.js:1` | `window.__ModuleLoader__.load({` |
| `@linxin666/dsh-client-ui-skill-explorer`（第三方） | `client.js:1` | `window.__ModuleLoader__.load({` |
| `dsh-status-rotator`（第三方） | `client.js:42`（前 41 行是 banner 注释） | `window.__ModuleLoader__.load({` |

- 完整外壳（逐字摘录 `[JOBS]\lib\client.js:1-6` 与 `:624-628`）：
  ```js
  window.__ModuleLoader__.load({
  	id: "@deepseek-ai/dsh-client-ui-jobs",
  	factory: (require) => {
  		var module = { exports: {} };
  		var exports = module.exports;
  		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
  		// ... 你的插件代码 ...
  		exports.apply = apply;
  		exports.inject = inject;
  		return module.exports;
  	}
  });
  ```
- `id` 取值 = **该包的 `package.json#name`**（`"@deepseek-ai/dsh-client-ui-jobs"`；第三方 `"dsh-univer-office"`、`"dsh-free-search"`、`"@linxin666/dsh-client-ui-skill-explorer"`）。
- `factory` 收到一个 **`require` 函数**，可解析：
  - 裸模块：`require("react")`、`require("react/jsx-runtime")`
  - 其他客户端包：`require("@deepseek-ai/dsh-client-ui-primitives")`
  - 证据（`[JOBS]\lib\client.js:7-9`）：
    ```js
    let react_jsx_runtime = require("react/jsx-runtime");
    let react = require("react");
    let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
    ```
  - **`require` 能解析哪些 specifier 的完整规则：未证实**（推测与 `dsh.client.inject` / `external` 有关，未找到实现）。**保守做法：只 require `react`、`react/jsx-runtime`，以及你在 `dsh.client.inject` 里声明过的包。**
- **导出什么**：具名 `exports.apply` + `exports.inject`。**没有 `name`，没有默认导出。**
  - `[JOBS]\lib\client.js:624-625`：`exports.apply = apply;` / `exports.inject = inject;`
  - `[UNIVER]\lib\client.js:23306-23307`：`var inject = [...];` / `function apply(ctx) {`（经其 bundler 的 `__defProp`/`__export` 助手导出）
  - `[JOBS]\lib\types\client\index.d.ts:17-22`：
    ```ts
    /** Required services: the jobs rosters, observations, and kill, the slot registry, and dictionaries. */
    export declare const inject: string[];
    /**
     * Client plugin body: register the dictionaries and the header action.
     * @param ctx - client root context.
     */
    export declare function apply(ctx: ClientContext): void;
    ```
- **打包方式**：官方用 `tsdown`（`[JOBS]package.json:63-66` → `"bundle": "tsdown"`）。**第三方手写这个外壳也完全可行**（外壳本身只是普通 JS）。`yibinthesis-dsh` 若不想引入构建链，**手写外壳是已验证可行的路线**（`dsh-free-search` 等第三方包即此形态）。

### E.2 `apply(ctx)` 里能拿到什么

- 由客户端 `inject` 数组决定。实测出现过的客户端服务：
  | 服务名 | 提供方（包） | 证据 |
  |---|---|---|
  | `slots` | `@deepseek-ai/dsh-client-ui-renderer`（类型 `SlotRegistry`） | `[RENDER]\lib\types\client\index.d.ts:25-27` |
  | `uiRenderer` | 同上（`UiRendererService`，有 `mount(container)`） | `[RENDER]\lib\types\client\index.d.ts:28-29`、`:7-14` |
  | `locale` | `@deepseek-ai/dsh-client-locale` | `[JOBS]\lib\client.js:599`、`[UNIVER]\lib\client.js:23308` |
  | `conversation` / `uiConversation` | `@deepseek-ai/dsh-client-ui-conversation` | `[UNIVER]\lib\client.js:23306`、`:23312` |
  | `jobs` | `@deepseek-ai/dsh-api-job-controller`（客户端半） | `[JOBS]\lib\client.js:597`、`[JOBC]\lib\types\client\index.d.ts` |
  | `theme` | `@deepseek-ai/dsh-client-ui-theme`（`ThemeRuntime`） | `[THEME]\lib\types\client\index.d.ts:84-87` |
  | `remote` | `@deepseek-ai/dsh-api-remotes`（`ClientRemote`） | `[REMOTE]\lib\types\client\index.d.ts:64-68` |
- `declare module '@deepseek-ai/cordis' { interface Context { ... } }` 是服务挂到 ctx 的声明方式（同 `[RENDER]`、`[THEME]`、`[REMOTE]` 三处同形）。
- **完整的客户端服务目录：未证实**（需要 `@deepseek-ai/dsh-client-*` 全量包，本次只拉了 5 个）。

### E.3 如何往某个 Slot 注册 UI

- **两段式：`ctx.slots.inject(SLOT_KEY, () => ctx.slots.register(options, Component))`，整体包在 `ctx.effect(...)` 里。**
- `ctx.slots` 的类型是 `SlotRegistry extends Service`（`[RENDER]\lib\types\client\registry.d.ts:46`）。
- **`inject` 签名**（`[RENDER]\lib\types\client\registry.d.ts:99-111`）：
  ```ts
  /**
   * @param key - declared SlotMap key to depend on.
   * @throws callback setup failures synchronously when the slot is already declared.
   */
  inject(key: keyof SlotMap & string, callback: () => SlotInjectionEffect): () => void;
  ```
  - 语义：**等该 slot 被声明后**再执行 callback（declaration epoch 变了就重跑）。返回 disposer。
- **`register` 签名**（`[SLOTS]\lib\types\index.d.ts:789-804` 两个重载）：
  ```ts
  register<K extends keyof SlotMap & string, ...>(
      options: BaseOptions<K, EntryKey, D, H, M, N> & { inject?: undefined; },
      component: C & SlotComponent<...> & RendersCheck<C, D>
  ): () => void;
  // 带 inject 的重载：
  register<K, I extends object, ...>(
      options: BaseOptions<K, EntryKey, D, H, M, N> & { inject: (...args: InjectParams<K, H>) => I; },
      component: C & SlotComponent<...>
  ): () => void;
  ```
- **`options` 字段**（`BaseOptions`，`[SLOTS]\lib\types\index.d.ts:596-613`）：
  | 字段 | 必填 | 语义 |
  |---|---|---|
  | `name` | **必填** | 目标 slot 键（contributing INTO this slot） |
  | `children` | 可选 | 子 slot 声明表（声明即认领；声明了就必须在组件里用 `renderSlot`） |
  | `store` | 可选 | store 席位（共享 handle 或独占 factory） |
  | `locale` | 可选 | 词典命名空间；声明后组件 props 上出现框架合成的 `t` |
  | `registrant` | 可选 | 诊断用注册者标签 |
- **按 kind 追加的字段**（`KindOptions`，`[SLOTS]\lib\types\index.d.ts:556-583`）：
  | slot kind | 追加字段 |
  |---|---|
  | `'single'` | `priority?`（遮蔽等级，升序，默认 0） |
  | `'list'` | **`id: string`（必填）**、`order?: number`、`label?: SlotLabel`、`priority?` |
  | `'keyed'` | **`key: EntryKey`（必填）**、`priority?` |
  | `'chain'` | **`select: ChainSelect`（必填）**、`priority?` |
- **加载期硬校验（写错会抛）**（`[SLOTS]\lib\types\index.d.ts:760-775`）：
  > registering into an undeclared slot throws; declaring an already-declared child key throws (one declarer per slot — the message names the first declarer); mounting one shared store handle under slots of different scopes throws. Kind constraints: keyed — missing `key` throws; list — missing `id` throws; chain — missing `select` throws.
  - 同一 cell 同 priority 二次注册也会抛（`:772-775`）。
- **返回值**：disposer，移除该贡献**及其声明的全部子 slot**（幂等；`:777-787`）。

### E.4 真实的最小 Slot 注册代码（逐行摘录，可直接照抄改）

**官方 `@deepseek-ai/dsh-client-ui-jobs`（`[JOBS]\lib\client.js:594-626`）—— 最短的完整范例：**

```js
/** Required services: the jobs rosters, observations, and kill, the slot registry, and dictionaries. */
const inject = [
	"jobs",
	"slots",
	"locale"
];
/**
* Client plugin body: register the dictionaries and the header action.
* @param ctx - client root context.
*/
function apply(ctx) {
	ctx.effect(() => ctx.locale.register("job", {
		zh,
		en
	}), "ui-jobs: dictionaries");
	ctx.slots.inject("conversation.session.header.actions", () => ctx.slots.register({
		name: "conversation.session.header.actions",
		id: "job-list",
		order: 20,
		locale: "job",
		inject: () => ({
			hooks: { jobs: ctx.jobs.state },
			watchRows: (sessionId) => ctx.jobs.watchRows(sessionId),
			observe: (sessionId, id) => ctx.jobs.observe(sessionId, id),
			killJob: async (sessionId, jobId) => (await ctx.jobs.kill(sessionId, jobId)).ok
		})
	}, JobListAction));
}
exports.apply = apply;
exports.inject = inject;
```

**第三方 `dsh-univer-office`（`[UNIVER]\lib\client.js:23306-23354`）—— 展示了 `ctx.effect` 包裹 + 多 slot 注册 + 降级路径：**

```js
var inject = ["slots", "locale", "conversation", "uiConversation"];
function apply(ctx) {
  const getViewerLocale = () => viewerLocaleOf(ctx.locale.getSnapshot().active);
  const preferences = new UniverPreferences();
  injectStyles("dsh-univer-office/styles", worktreeStyles);
  const uiConversation = ctx.get("uiConversation");
  if (uiConversation === void 0) {
    throw new Error("dsh-univer-office: active DSH Client exposes no uiConversation service");
  }
  try {
    uiConversation.events.register(univerTurnDefinition);
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("already registered")) throw error;
  }
  ctx.effect(() => ctx.locale.register(UNIVER_LOCALE_NAMESPACE, { zh, en }), "univer: dictionaries");
  ctx.effect(
    () => ctx.slots.inject("conversation.chat.turnTail", () => {
      try {
        return ctx.slots.register(
          { name: "conversation.chat.turnTail", id: "univer-turn-preview",
            locale: UNIVER_LOCALE_NAMESPACE,
            inject: () => ({ getViewerLocale, preferences }) },
          PreviewCard
        );
      } catch (error) {
        if (!(error instanceof Error) || !error.message.includes("requires options.select"))
          throw error;
        return untypedSlots(ctx).register(
          { name: "conversation.chat.turnTail", priority: -10,
            locale: UNIVER_LOCALE_NAMESPACE,
            select: selectUniverTurn,
            inject: () => ({ getViewerLocale, preferences }) },
          PreviewCard
        );
      }
    }),
    "univer: turn preview"
  );
  ctx.effect(
    () => ctx.slots.inject("conversation.input.dock",
      () => ctx.slots.register(
        { name: "conversation.input.dock", id: "univer-dock", order: 400,
          locale: UNIVER_LOCALE_NAMESPACE,
          inject: () => ({ getViewerLocale, preferences }) },
        /* ...组件... */
      )
    ),
    /* "univer: ..." */
  );
}
```

**CSS 注入惯例**（`[JOBS]\lib\client.js:12-19`；`[UNIVER]\lib\client.js` 的 `injectStyles`，同形）：

```js
const tagId = "@deepseek-ai/dsh-client-ui-jobs/JobListAction.module.css";
if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
	const tag = document.createElement("style");
	tag.dataset.plugin = "@deepseek-ai/dsh-client-ui-jobs";
	tag.dataset.pluginCss = tagId;
	tag.textContent = css;
	document.head.appendChild(tag);
}
```

- `data-plugin` = 包名；`data-plugin-css` = `<包名>/<模块标识>`。**去重靠 `data-plugin-css`。**
- ⚠️ **本格式的外壳示例是纯 JS。若用 JSX/TS 写组件，必须先构建成这个格式**；`dsh.client.platform: "web"` 的产物是**已打包**的浏览器 bundle（见 E.1 的 5 个实例）。

### E.5 已证实的 Slot 键清单（来自 `@deepseek-ai/dsh-client-ui-conversation`）

- **部分证实**：以下是从 `[CONV]\lib\types\client\contract\slots.d.ts` 抽出的 `SlotMap` 声明合并条目（**该文件只覆盖 conversation 包拥有的 slot**；`shell.overlay`、`main.sidebar` 等由别的包声明，见 E.5.1）：

| Slot 键 | kind | scope | 证据行 |
|---|---|---|---|
| `main.conversation` | single | session-maybe | `[CONV]:122-125` |
| `conversation.session` | single | session | `:127-130` |
| `conversation.header` | single | session-maybe | `:135-138` |
| `conversation.session.header` | single | session | `:140-143` |
| `conversation.session.header.lineage` | single | session | `:149-152` |
| **`conversation.session.header.actions`** | **list** | session | `:155-158` |
| `conversation.session.header.utilities` | list | session | `:161-164` |
| `conversation.header.leading` | single | root | `:167-170` |
| `conversation.session.header.corner` | single | session | `:178-181` |
| `conversation.view` | list | session | `:184-187` |
| `conversation.composer` | chain | session | `:190-193` |
| `conversation.hero.workspace` | single | root | `:196-199` |
| `conversation.hero.brand.mark` | single | root | `:202-205` |
| `conversation.hero.agentPreset` | single | session-maybe | `:208-211` |
| `conversation.input.dock` | list | session | `:214-217` |
| `conversation.input.overlay` | list | session | `:220-223` |
| `conversation.composer.dock` | list | session | `:225-228` |
| `conversation.input.left` | list | session | `:230-233` |
| `conversation.input.right` | list | session | `:235-238` |
| `conversation.input.activity` | single | session | `:240-243` |
| `conversation.composer.bar` | single | session-maybe | `:246-249` |
| `conversation.input.attachments` | single | session-maybe | `:252-255` |
| `conversation.input.plan` | single | session | `:258-261` |
| `conversation.input.permission` | single | session | `:264-267` |
| `conversation.input.model` | single | session | `:274-277` |
| `conversation.content` | （容器，含 children 声明） | session-maybe | `:282-322` |
| `conversation.chat.turnTail` | （见 `[UNIVER]` 用法） | —— | `[UNIVER]\lib\client.js:23323`、`:23343` |

#### E.5.1 其它已证实的 Slot 键（来源分散，非同一文件）

| Slot 键 | 来源证据 |
|---|---|
| `shell.overlay` | `[RENDER]\lib\types\client\registry.d.ts:28-29`（注释：「For a surface of your own that floats over the whole app, register into `shell.overlay` instead (a list slot: additive…)」） |
| `shell` 的 frame（single） | `[RENDER]\lib\types\client\registry.d.ts:21-28`（注释警告：`ui-layout` 的 AppFrame 声明了它，**不要在此注册**；single slot 会被遮蔽而不是并列） |

- **完整 Slot 键全集：未证实。** 需要 `@deepseek-ai/dsh-client-ui-layout`、`dsh-client-ui-sidebar`、`dsh-client-ui-settings` 等包的 `contract/slots.d.ts`。本次未拉取。
- ⇒ **选 slot 的稳妥做法**：参照本机已装真实插件用过的键（`conversation.session.header.actions`、`conversation.input.dock`、`conversation.chat.turnTail`），它们在真机上**确实渲染**。

### E.6 主题令牌（theme tokens）

- **机制**：主题令牌是 **CSS 自定义属性**，前缀 **`--dsw-`**。组件以 `var(--dsw-…)` 在 CSS 里读取。
  - 官方原文（`[PRIM]README.zh.md:12`）：
    > 组件不 import Cordis 运行时；调用方提供本地化 label，**主题相关颜色使用 `--dsw-*` 设计 token**。
  - 原文（`[PRIM]README.zh.md:131`）：
    > 本包只做一件事：提供零 cordis、零 slot 知识、**仅经 `--dsw-*` token 设置样式**的纯 React 原子组件……
  - 真实用法（`[JOBS]\lib\client.js:11` 的 CSS 文本）：
    `border-radius:var(--dsw-radius-sm)`、`color:var(--dsw-alias-label-tertiary)`、
    `background:var(--dsw-specific-menu)`、`box-shadow:var(--dsw-elevation-prominent)`、
    `border-top:.5px solid var(--dsw-alias-border-l1)`
- **令牌体系归属**：`@deepseek-ai/dsh-client-ui-theme`（`[PRIM]README.zh.md:174` → 「[ui-theme](../ui-theme/README.zh.md)——这些原子组件样式所依赖的 `--dsw-*` token 体系」）。
- **`ctx.theme` 服务 API**（`[THEME]\lib\types\client\index.d.ts:109-188`）：
  | 方法 | 签名 | 用途 |
  |---|---|---|
  | `getTheme()` | `(): ThemeSnapshot` | 读不可变主题快照（`:127-131`） |
  | `setTheme(id)` | `(id: string): void` | 切主题（唯一偏好写入口；未知 id 抛错，`:137-143`） |
  | `setFontSize(px)` | `(px: number): void` | 改正文字号（`:144-150`） |
  | `register(definition)` | `(ThemeDefinition): () => void` | 注册自有主题（重复 id 抛错，`:153-161`） |
  | `overrideTokens(source, tokens)` | `(string, ThemeTokenOverrides): () => void` | **在活动主题之上叠一层别名令牌覆盖**（`:162-178`） |
  | `exportInspectTokens()` | `(): ThemeTokenInspection[]` | 导出令牌目录（不读 DOM，`:132-136`） |
  | 事件 | `'theme/change'(snapshot: ThemeSnapshot)` | 主题变更（`:88-96`） |
  - `ThemeTokenOverrides = Record<string, { light: string; dark: string }>`（`:34-41`）——**覆盖层必须同时给 light 与 dark**。
  - `ThemeDefinition`：`{ id, colorScheme: 'light'|'dark', tokens: ThemeTokens }`（`:42-53`）。
- **★ 权威令牌清单的取得方式（可复现）**：令牌定义被编译进 `dsh-client-ui-theme` 的浏览器 bundle。
  - **实测于**：
    ```powershell
    $txt=[System.IO.File]::ReadAllText('[THEME]\lib\client.js')
    ([regex]::Matches($txt,'--dsw-[a-z0-9-]+') | ForEach-Object { $_.Value } | Sort-Object -Unique)
    ```
  - **结果：403 个不同 `--dsw-*` 令牌名。**
  - 分类计数（按前缀）：`--dsw-static-*`（调色板原始值，最多）、`--dsw-font-*`（字体阶梯，含 `-font-family/-font-size/-font-weight/-line-height/-font-style` 五连）、`--dsw-alias-*`（**语义层，插件应当用这一层**）、`--dsw-specific-*`、`--dsw-elevation-*`、`--dsw-shadow-lv*`、`--dsw-radius-*`、`--dsw-gradient-*`、`--dsw-mask-blur`、`--dsw-menu-*`、`--dsw-corner-shape`、`--dsw-focus-ring-*`、`--dsw-linear-*`。
- **语义层（`--dsw-alias-*`）全量清单**——**插件应当优先用这些**：

```text
--dsw-alias-bg-base              --dsw-alias-bg-document-preview     --dsw-alias-bg-document-selection
--dsw-alias-bg-layer-1           --dsw-alias-bg-layer-2              --dsw-alias-bg-layer-3
--dsw-alias-bg-mask-1            --dsw-alias-bg-mask-2               --dsw-alias-bg-mask-3
--dsw-alias-bg-mask-drop         --dsw-alias-bg-mask-photo           --dsw-alias-bg-module-platform
--dsw-alias-bg-multi-select      --dsw-alias-bg-overlay              --dsw-alias-bg-skeleton
--dsw-alias-border-inverted      --dsw-alias-border-inverted2        --dsw-alias-border-l1
--dsw-alias-border-l2            --dsw-alias-border-l2-darkmode-thin --dsw-alias-border-l3
--dsw-alias-border-l4            --dsw-alias-brand-primary           --dsw-alias-brand-primary-invert
--dsw-alias-brand-primary-new-colorprimary-new-color            --dsw-alias-brand-text
--dsw-alias-button-contrast-fill --dsw-alias-button-elevated-fill    --dsw-alias-button-floating-fill
--dsw-alias-button-floating-hover --dsw-alias-button-ghost-active-border
--dsw-alias-button-ghost-active-fill --dsw-alias-button-ghost-active-hover
--dsw-alias-button-info-fill     --dsw-alias-button-info-hover       --dsw-alias-button-primary-dimmed
--dsw-alias-button-primary-fill  --dsw-alias-button-primary-hover    --dsw-alias-button-tool-bar-fill
--dsw-alias-button-tool-bar-fill-invisible                       --dsw-alias-button-tool-bar-hover
--dsw-alias-code-diff-added      --dsw-alias-code-diff-deleted       --dsw-alias-file-diff-added-bg
--dsw-alias-file-diff-added-gutter --dsw-alias-file-diff-added-marker --dsw-alias-file-diff-deleted-bg
--dsw-alias-file-diff-deleted-gutter --dsw-alias-file-diff-deleted-marker
--dsw-alias-interactive-bg-active --dsw-alias-interactive-bg-hover   --dsw-alias-interactive-bg-hover-accent
--dsw-alias-interactive-bg-hover-danger                           --dsw-alias-interactive-bg-hover-solid
--dsw-alias-label-caption        --dsw-alias-label-deep-diving       --dsw-alias-label-deep-diving-shimmer
--dsw-alias-label-dimmed         --dsw-alias-label-document-preview  --dsw-alias-label-primary
--dsw-alias-label-primary-bluish --dsw-alias-label-primary-dimmed    --dsw-alias-label-primary-foreground
--dsw-alias-label-primary-inverted --dsw-alias-label-secondary      --dsw-alias-label-shimmer
--dsw-alias-label-tertiary       --dsw-alias-link                    --dsw-alias-markdown-citation
--dsw-alias-markdown-code-block  --dsw-alias-markdown-code-block-banner
--dsw-alias-markdown-code-segment-selected                       --dsw-alias-markdown-code-segment-unselected
--dsw-alias-markdown-inline-code --dsw-alias-markdown-placeholder   --dsw-alias-markdown-tag
--dsw-alias-menu-group-header-fill --dsw-alias-menu-icon            --dsw-alias-onboarding-accent
--dsw-alias-onboarding-card-fill --dsw-alias-onboarding-checkbox-border
--dsw-alias-onboarding-secondary-fill                             --dsw-alias-scrollbar-bg-l1
--dsw-alias-scrollbar-bg-l2      --dsw-alias-scrollbar-hover-l1      --dsw-alias-scrollbar-hover-l2
--dsw-alias-settings-card-fill   --dsw-alias-settings-card-stroke    --dsw-alias-state-business-primary
--dsw-alias-state-business-tertiary                               --dsw-alias-state-error-primary
--dsw-alias-state-error-secondary --dsw-alias-state-idle-primary    --dsw-alias-state-success-primary
--dsw-alias-state-success-secondary                               --dsw-alias-state-success-tertiary
--dsw-alias-state-warn-label     --dsw-alias-state-warn-primary      --dsw-alias-state-warn-secondary
--dsw-alias-state-warn-tertiary  --dsw-alias-switch-thumb            --dsw-alias-toast-bg
--dsw-alias-toast-label          --dsw-alias-tooltip-bg              --dsw-alias-tooltip-key-bg
--dsw-alias-turn-trigger-bg      --dsw-alias-turn-trigger-bg-hover
```

- **非 alias 层、但插件常用**：
  ```text
  --dsw-radius-xs  --dsw-radius-sm  --dsw-radius-md  --dsw-radius-lg  --dsw-radius-xl  --dsw-radius-panel
  --dsw-shadow-lv1 --dsw-shadow-lv2 --dsw-shadow-lv3
  --dsw-elevation-stroke --dsw-elevation-stroke-color
  --dsw-elevation-panel --dsw-elevation-prominent --dsw-elevation-soft
  --dsw-menu-surface-fill  --dsw-menu-backdrop-filter  --dsw-specific-menu
  --dsw-focus-ring-color   --dsw-focus-ring-width
  --dsw-corner-shape       --dsw-mask-blur
  --dsw-font-family        --dsw-font-family-brand
  --dsw-font-xxxs-11 --dsw-font-xxs-12 --dsw-font-xs-13 --dsw-font-s-14 --dsw-font-base-16
  --dsw-font-m-18 --dsw-font-l-20 --dsw-font-xl-24
  --dsw-specific-bubble --dsw-specific-bubble-highlight --dsw-specific-input-major
  --dsw-specific-selector --dsw-specific-sidebar-fill --dsw-specific-sidebar-nav-item-active
  --dsw-specific-sidebar-nav-item-active-accent --dsw-specific-sidebar-nav-item-hover
  --dsw-specific-tip --dsw-specific-login-input
  ```
  - 每个字体阶梯令牌还有 5 个后缀变体：`-font-family` / `-font-size` / `-font-weight` / `-line-height` / `-font-style`
    （例：`--dsw-font-base-16`、`--dsw-font-base-16-font-size`、…）。
- **主题/设计约束**（`[THEME]README.zh.md` 摘录，写 CSS 前应遵守）：
  - `:58`：`src/styles/` 下八张样式表由 ui-theme 动态客户端 entry 依次导入；**`scrollbar.css` 消费 `--dsw-alias-scrollbar-*` token，必须排在声明这些 token 的 `design-platform.css` 之后**。
  - `:60`：焦点环用 `var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary))`；`--dsw-focus-ring-width`（2px）是标准宽度。
  - `:78`：高层级表面设 `border: 0`（用 elevation 的 0.5px 发丝描边）；绘制 `--dsw-specific-menu` 的高层级表面还要 `backdrop-filter: var(--dsw-menu-backdrop-filter)`。
  - `:47`：菜单吸顶分组标题用 `--dsw-alias-menu-group-header-fill`（浅/深均 94% 不透明度）。
- **注意**：`[THEME]\lib\styles\` 里**只有** `brand-font.css` + 3 个 woff2 + 许可文件；`base.css` / `design-platform.css` 等**未随包发布**（被编译进 `lib/client.js`）。⇒ **不要试图 import 这些 CSS 文件，直接用 `var(--dsw-…)`。**

### E.7 客户端半的最小可运行骨架（**可照抄**）

见文末「§G 骨架」的 **G.2**。

---

## F. 客户端与 host 如何通信 —— 状态：**部分证实**（正式 RPC 面已证实为**构建期固化**，第三方扩展路径**未证实**）

### F.1 正式机制：Typert Remote（BFF）

- **Host 侧**：具备远程能力的包导出 `/typert`（host 半），客户端安全声明导出 `/remote`。
  - `[JOBC]package.json:29-36`：
    ```json
    "./typert": { "types": "./lib/typert.host.d.ts", "default": "./lib/typert.host.js" },
    "./remote": { "types": "./lib/typert.remote-client.d.ts", "default": "./lib/typert.remote-client.js" }
    ```
- **客户端侧**：`@deepseek-ai/dsh-api-remotes` 是**应用级 BFF 装配包**，它在**构建期**以值形式导入每个已选领域的 `/remote` 产物并挂载，然后把 `ctx.remote` 暴露给客户端业务包。
  - 原文（`[REMOTE]README.zh.md:14`）：
    > 为本应用选定的 Host Remote 能力提供双侧 BFF。Host 入口拥有转发事件名单并向 API Gateway 注册应用事件 source；Client 入口**以运行时值形式导入生成的 `/remote` 产物，通过 `ctx.remote.$mount()` 挂载每项贡献**，并重新导出对应的声明合并。Client 业务包依赖该外观，而不依赖 Gateway 实现或单独的 Remote 运行时入口。
  - `ctx.remote` 的声明（`[REMOTE]\lib\types\client\index.d.ts:64-68`）：
    ```ts
    declare module '@deepseek-ai/cordis' {
        interface Context {
            /** Generated Remote namespaces selected by this Client assembly. */
            remote: ClientRemote;
        }
    }
    ```
  - `apply` 返回 disposer（`[REMOTE]\lib\types\client\index.d.ts:72-77`）：
    ```ts
    export declare function apply(ctx: Context): Promise<() => Promise<void>>;
    ```
  - 已选中的 namespace 名单（`[REMOTE]\lib\types\client\index.d.ts:9-36`，逐条 `export type {} from '@deepseek-ai/dsh-xxx/remote'`）：plugin-manager、agent-preset-registry、user-questions、commands、api-settings-controller、api-account-controller、goal、schedule、office-to-pdf、llm、host-plugin-inventory、message-feedback、permission-presets、command-feedback、client-file-upload、session-reference、subagent、api-session-controller、**api-job-controller**、api-workspace-controller、api-workspace-files、api-terminal-controller、cordis-host-runner 等。
  - 业务包的**客户端服务**是由这些 Remote 派生的（例：`ctx.jobs` 由 `dsh-api-job-controller` 安装，`[JOBS]README.zh.md:38`：「展开可观察的行会从 `ctx.jobs`（由 `dsh-api-job-controller` 安装）打开该 job 的输出观测流」）。
- **★ 关键限制（决定 `yibinthesis-dsh` 能做什么）**：
  - `[REMOTE]README.zh.md:75-76`（「已知限制与暂缓事项」原文）：
    > - 能力集合由**构建时显式导入的值固定确定**；Client **不会在运行时发现** Host 中已启用的服务或 Remote 定义。
    > - 若要增加能力，**必须显式导入相应的 `/remote` 值并在此组合中挂载**。
  - ⇒ **第三方插件无法自行新增一个 Remote namespace**——那需要改 `@deepseek-ai/dsh-api-remotes` 这个官方装配包。
  - ⇒ **是否存在受支持的第三方「注册自定义 Remote」路径：未证实。**（`dsh-cordis-host-runner` 的类型里有 `DynamicCordisClientSource` / `DynamicCordisPackage` 等名字，暗示存在动态 Cordis 包机制，但**未展开核实**，本文件不对其下任何结论。）
- **Host → Client 事件转发**：`API_REMOTE_FORWARDED_EVENTS` 名单 + `ctx.remote.$on`。
  - 原文（`[REMOTE]README.zh.md:43-45`）：
    > `src/remote-events.ts` 持有 `API_REMOTE_FORWARDED_EVENTS`，即本应用不改名转发给消费端的 Host Cordis 事件名单；每个条目还会选择普通发送或 agent-scoped waterfall 投递。**该名单同时就是 `ctx.remote.$on` 的合法键集**，只含类型的 `src/types.ts` 派生其选择面。多转发一个事件只需在该数组里加一项。
  - `$mount` / `$on` 之外的方法面：`[REMOTE]README.zh.md:32` 提到 `@deepseek-ai/dsh-api-gateway/client` 负责「描述符校验、可追踪的 namespace 服务、直接与作用域方法、调用、流与取消」。
  - **`$mount` / `$on` 的精确签名：未证实**（`dsh-api-gateway` 包未拉取）。

### F.2 ★ 已验证的、第三方可用的替代通道：host 注册 webServer 路由 + 客户端 HTTP/SSE

- **这条是本机真实第三方插件 `dsh-status-rotator` 在用的、已经跑起来的路径**，不依赖 Remote 装配。
- Host 半（`C:\Users\LoyDgIk\.dsh\profiles\desktop\node_modules\dsh-status-rotator\lib\index.js`，`apply(ctx)` 内）：
  ```js
  let ws = null;
  try {
    ws = typeof ctx.get === "function" ? ctx.get("webServer") : null;
  } catch (error) { /* ignore */ }
  if (!ws) { try { ws = ctx.webServer || null; } catch (error) { /* ignore */ } }
  if (!ws || typeof ws.register !== "function") return false;
  routeDisposer = ws.register({
    kind: "exact",
    path: "/plugins/dsh-status-rotator/config.json",
    handler
  });
  // 事件路由注册失败（比如宿主版本不支持长连接）不算致命：轮询兜底仍然可用
  try {
    eventsDisposer = ws.register({ kind: "exact", path: EVENTS_PATH, handler: eventsHandler });
  } catch (error) { eventsDisposer = null; }
  ```
  - 即：**服务名 `webServer`，方法 `register({ kind: 'exact', path, handler })`，返回 disposer**；`handler` 是 `(req, res)` 形态的 Node HTTP 处理器，**允许长挂（SSE）**。
  - 该插件的注释给出依据与取舍：
    > 为什么是 SSE 而不是 WebSocket：宿主 webserver 的 `register` 明确写着 handler「may hold the response open, e.g. SSE」，而 `registerUpgrade` 要自己实现 RFC6455 的握手与帧。
  - 该插件还做了：路由晚就绪的**轮询等待**（500ms × 20 次）、`duplicate exact route` 防护（post/300ms…见原文）、卸载时显式 `sseCloseAll()`。
- 客户端半通过 `fetch` 该路由读取（同一包 `lib/client.js`，52 万字节的 bundle）。
- ⇒ **给 `yibinthesis-dsh` 的可行路径**：若要让 Web GUI 显示论文检查结果，**用 `webServer` 路由 + 客户端 `fetch`/SSE**，而不是试图新增 Remote namespace。
- ⚠️ **未证实**：`webServer` 服务的正式类型声明、`register` 的完整 options schema（`kind` 是否有别的取值、是否有鉴权/审批）、以及 `@deepseek-ai/dsh-host-webserver` 的导出面（该包**未拉取**）。以上仅为 `dsh-status-rotator` **实测在用的调用形态**。

### F.3 其它已验证的跨半数据面

| 机制 | 说明 | 证据 |
|---|---|---|
| Host 工具 → 模型 | `ctx.tools.register` 的 schema 自动流入系统提示词组装；结果是**模型**看到的，不是 GUI | `[TOOLS]:28`、`:138` |
| Host 工具结果 → GUI 卡片 | 内置 Web Client 走 `tool.call.toolview` renderer，从「原始调用参数 + 结果内容 + 失败状态 + 持久 metadata」派生 card props | `[TOOLS]:91` |
| 客户端读会话/轮次 | `ctx.conversation`、`ctx.uiConversation`；例：`uiConversation.events.register(definition)` | `[UNIVER]\lib\client.js:23312-23317` |
| 设置持久化 | `@deepseek-ai/dsh-settings` 的 `ctx.settings`；真实插件记录其 API 面为 `describe` / `update` / `replace` / `mutate` / `configure`（**0.1.7-rc.1 起没有 `register()`**） | 见 §H.2 |
| Host→Client 转发事件 | `ctx.remote.$on`（键集 = `API_REMOTE_FORWARDED_EVENTS`） | `[REMOTE]README.zh.md:43` |

---

## G. 骨架代码（可照抄）

### G.1 最小可运行**宿主**插件骨架（host 半）

文件：`lib/index.js`（ESM）

```js
/**
 * yibinthesis-dsh — 宿主半（Node 侧）。
 * 依据 DSH 0.2.0-rc.2 契约编写，全部字段均有本文件 §A/§B 的证据支撑。
 */
import { defineTool } from '@deepseek-ai/dsh-tools'

/** fiber 名：必须与 package.json#name 及 cordis.patch.yml 的 name 一致。 */
export const name = 'yibinthesis-dsh'

/**
 * 等待的服务名（不是包名）。
 * 'tools' 由 @deepseek-ai/dsh-tools 提供（tools\lib\types\index.d.ts:32-35）。
 * 声明后 ctx.tools 在 apply 执行前必然就绪。
 */
export const inject = ['tools']

/**
 * 可选。零依赖的 standard-schema v1 形态（见 §B.2.1）。
 * 不写 Config 也能跑，但那样 profile patch 里的 config 会被静默丢弃。
 */
function validateConfig(config) {
  if (config !== undefined && (typeof config !== 'object' || config === null || Array.isArray(config))) {
    return { issues: [{ message: `yibinthesis-dsh config 必须是对象，收到 ${Array.isArray(config) ? 'array' : typeof config}` }] }
  }
  const raw = config ?? {}
  const issues = []
  for (const key of Object.keys(raw)) {
    if (key !== 'scriptTimeoutMs') {
      issues.push({ message: `不认识的配置键 "${key}"（可用：scriptTimeoutMs）`, path: [key] })
    }
  }
  const value = { scriptTimeoutMs: 120000 }
  if (Object.hasOwn(raw, 'scriptTimeoutMs')) {
    const v = raw.scriptTimeoutMs
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) {
      issues.push({ message: 'config.scriptTimeoutMs 必须是正数', path: ['scriptTimeoutMs'] })
    } else {
      value.scriptTimeoutMs = Math.floor(v)
    }
  }
  return issues.length ? { issues } : { value }
}

export const Config = Object.freeze({
  '~standard': Object.freeze({ version: 1, vendor: 'yibinthesis-dsh', validate: validateConfig }),
})

/**
 * 插件主体。所有注册都经 ctx.effect 托管，卸载/HMR 自动回收（§B.2.2）。
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {unknown} config loader 传入的 profile 配置
 */
export function apply(ctx, config) {
  const cfg = Config['~standard'].validate(config)
  if (cfg.issues) {
    // 加载期响亮失败，不静默回落默认值（§B.2.1）
    throw new TypeError('yibinthesis-dsh config 非法：\n' + cfg.issues.map((i) => `  - ${i.message}`).join('\n'))
  }
  const { scriptTimeoutMs } = cfg.value

  ctx.effect(() => {
    const disposers = []

    // ── 工具 1：纯汉字数（论衡同口径，作为最小可运行示例）────────────────
    disposers.push(ctx.tools.register(defineTool({
      name: 'yibinthesis_char_count',
      // 注意：并行安全请用 isConcurrencySafe，不要写 executionMode（§A.7）
      isConcurrencySafe: () => true,
      timeoutMs: scriptTimeoutMs,
      description:
        '统计宜宾论文口径的纯汉字数（不含标点/数字/英文/编号）。' +
        'mode=body（默认）＝正文区；mode=full＝全文。只读，不修改任何文件。',
      parameters: {
        file: { type: 'string', required: true, description: '待统计的 Markdown 文件路径' },
        mode: { type: 'string', enum: ['body', 'full'], description: '统计模式；省略 = body' },
      },
      output: {
        // ⚠️ output.schema 及其所有嵌套层都不得出现 required（§A.3.2）；
        //    对象节点必须显式写 additionalProperties（§A.3.1）。
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            chars: { type: 'number', description: '纯汉字数' },
            mode: { type: 'string', description: '实际生效的模式' },
            degraded: { type: 'boolean', description: '口径失真（缺少「## 摘要」等结构）' },
          },
        },
        // render 必须返回 ContentBlock[]，不是字符串（§A.4）
        render: (args, v) => [{
          type: 'text',
          text: `汉字数：${v.chars}（mode=${v.mode}）${v.degraded ? '\n⚠️ 口径失真：缺少「## 摘要」节' : ''}`,
        }],
      },
      // execute 收 2 个参数，返回 output.schema 声明的规范值（§A.5）
      async execute(args, exec) {
        // 必须观测/转发 exec.signal（§A.5）
        const { readFile } = await import('node:fs/promises')
        const text = await readFile(args.file, { encoding: 'utf8', signal: exec.signal })
        const mode = args.mode ?? 'body'
        const body = mode === 'body' ? (text.split(/^## 摘要/m)[1] ?? text) : text
        const chars = (body.match(/[\u4e00-\u9fff]/g) ?? []).length
        return { chars, mode, degraded: mode === 'body' && !/^## 摘要/m.test(text) }
      },
    })))

    // 后续工具照抄同形追加即可。
    // 单个工具不需要工具时，这里会返回空数组 —— disposer 仍然有效。

    return () => { for (const d of disposers) { try { d() } catch { /* ignore */ } } }
  }, 'yibinthesis-dsh: tools')
}
```

文件：`cordis.patch.yml`

```yaml
# yibinthesis-dsh bundle patch。
# ⚠️ 必须插入一行 name = 本包包名，否则入口永不被 import（§C.3）。
# 客户端半不需要在这里挂行：它由 package.json 的 dsh.client 驱动（§C.4）。
- insert:
    - id: yibinthesis-dsh
      name: yibinthesis-dsh
```

### G.2 最小可运行**客户端**插件骨架（client 半）

文件：`lib/client.js`（**必须是 `__ModuleLoader__` 包裹格式，不是普通 ESM**，见 §E.1）

```js
/**
 * yibinthesis-dsh — 浏览器半。
 * 骨架依据 @deepseek-ai/dsh-client-ui-jobs/lib/client.js:1-6, 594-628 与
 * dsh-univer-office/lib/client.js:23306-23354 的真实形态（见 §E.4）。
 * 本文件是纯 JS，无需构建即可加载。
 */
window.__ModuleLoader__.load({
  id: 'yibinthesis-dsh',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    // require 只能可靠解析 react / react/jsx-runtime，以及 dsh.client.inject 里声明过的包（§E.1）
    const jsxRuntime = require('react/jsx-runtime')

    // 客户端服务名（不是包名！），见 §D.3 的两层 inject 区别
    const inject = ['slots', 'locale']

    // ── 词典（zh 为事实源；键集必须 zh/en 一致，见 §E.4 的 ui-jobs 形态）──
    const zh = {
      'badge.title': '宜宾论文助手',
      'badge.tip': '打开论文工具面板',
    }
    const en = {
      'badge.title': 'Yibin Thesis',
      'badge.tip': 'Open the thesis toolbox',
    }

    // ── 组件 ──────────────────────────────────────────────────────────────
    // 声明了 locale: 的注册，props 上会有框架合成的 t（§E.3 / slots types:74-81）
    function ThesisBadge(props) {
      return jsxRuntime.jsx('button', {
        type: 'button',
        title: props.t('badge.tip'),
        style: {
          background: 'transparent',
          border: 0,
          cursor: 'pointer',
          font: 'inherit',
          padding: '3px 6px',
          borderRadius: 'var(--dsw-radius-sm)',
          color: 'var(--dsw-alias-label-tertiary)',   // 主题令牌：语义层（§E.6）
        },
        children: props.t('badge.title'),
      })
    }

    // ── 插件主体 ──────────────────────────────────────────────────────────
    function apply(ctx) {
      // 1) 注册词典。locale.register(ns, {zh, en}) 返回 disposer，交给 ctx.effect 托管。
      ctx.effect(
        () => ctx.locale.register('yibinthesis', { zh, en }),
        'yibinthesis: dictionaries',
      )

      // 2) 注册一个 list slot 条目。
      //    - ctx.slots.inject(key, cb)：等该 slot 被声明后再执行 cb（§E.3）
      //    - ctx.slots.register(options, Component)：options 需要 name + 该 kind 的必填字段
      //      conversation.session.header.actions 是 list 且 scope=session
      //      ⇒ 必填 id；order 控制排序（§E.5）
      ctx.effect(
        () => ctx.slots.inject('conversation.session.header.actions', () =>
          ctx.slots.register(
            {
              name: 'conversation.session.header.actions',
              id: 'yibinthesis-badge',   // list slot 必填
              order: 30,
              locale: 'yibinthesis',     // 声明后组件收到 t
              inject: () => ({}),        // 业务面；本骨架暂时为空
            },
            ThesisBadge,
          ),
        ),
        'yibinthesis: header action',
      )
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
```

配套（§D.6 的 `package.json` 已含所需字段）：

```json
{
  "type": "module",
  "main": "./lib/index.js",
  "exports": {
    ".": { "default": "./lib/index.js" },
    "./client": { "default": "./lib/client.js" },
    "./package.json": "./package.json"
  },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": {
      "platform": "web",
      "inject": ["@deepseek-ai/dsh-client-locale", "@deepseek-ai/dsh-client-ui-slots"]
    }
  }
}
```

---

## H. 本次侦察发现的、与预期不符的事实（汇总）

| # | 事实 | 影响 | 证据 |
|---|---|---|---|
| ① | `@deepseek-ai/dsh-client-runtime` **没有** `0.2.0-rc.2` 版本（404） | 任务清单里这条拉取途径不可用；该名字在 profile 里只是断链 junction | 实测 `npm view`；§0.2 |
| ② | **`executionMode` 不是 `defineTool` 的选项，传了被静默忽略** —— 本机真实插件 `lunheng-article-pipeline` 在 4 个工具上依赖它，实际仍按 `exclusive` 调度 | 若要并行安全必须改用 `isConcurrencySafe` | `[TOOLS]\lib\index.js:838-887`（无该键读取）、`:3057-3061`（`executionMode` 是方法）；`[LUNHENG]\lib\tools.js:129,217` |
| ③ | `package.json` 的 `dsh.client.inject` 写的是**包名**，而客户端模块导出的 `inject` 写的是**服务名** —— 两层同名不同义 | 混用会导致客户端插件不加载或 apply 内服务为 undefined | `[JOBS]package.json:54-59` vs `[JOBS]\lib\client.js:596-600`；§D.3 |
| ④ | 客户端半**不是普通 ESM，而是 `window.__ModuleLoader__.load({id, factory})` 包裹格式**（官方 + 3 个第三方包共 5 例一致） | 用 JSX/TS 写客户端插件**必须**走构建产出该格式，或手写外壳 | `[JOBS]\lib\client.js:1`；`[UNIVER]\lib\client.js:1`；`dsh-free-search`、`skill-explorer`、`dsh-status-rotator:42` |
| ⑤ | plugin 内 `@deepseek-ai/*` junction **全部断链**（指向不存在的 `D:\Program Files (x86)\DSH Desktop\...`），`Test-Path` 对 junction 返回 True 会误导 | 不能靠裸路径读官方源码；要么 npm pack，要么解 app.asar | §0.2 的 `Get-ChildItem` 报错原文 |
| ⑥ | `cordis.patch.yml` 里 `name` 若漏写本包包名，**入口根本不会被 import**（`package.json#main` 不会因「包在 bundles 里」而自动执行） | 最容易漏、后果最严重的一条；客户端半则**不需要** patch 行 | `[LUNHENG]cordis.patch.yml` 注释；`[UNIVER]cordis.patch.yml` 只有 1 行 |
| ⑦ | `presentCall` / `presentResult` **不被内置 Web Client 消费**（它走 `tool.call.toolview`） | 想给 GUI 出卡片的努力会白费 | `[TOOLS]:91` |
| ⑧ | `output.schema` 里写 `required` 会**在定义期抛错**，导致工具**永不注册**（且常被入口的 try/catch 吞成一行日志） | 静默失效陷阱 | `[TOOLS]\lib\index.js:677/725/777`（`allowRequired:false`）；`[LUNHENG]\lib\tools.js:155-160` 记有实测报错原文 |
| ⑨ | Remote（正式 RPC）是**构建期固化**的；`api-remotes` README 明说客户端**不会运行时发现** Host 能力，加能力须显式导入 `/remote` 并挂载 | **第三方插件无法自行新增 Remote namespace**（是否存在受支持的第三方路径：**未证实**）；跨半通信的已验证替代是 `webServer` 路由 + HTTP/SSE | `[REMOTE]README.zh.md:75-76`；`dsh-status-rotator` host 半 |
| ⑩ | `dsh-status-rotator` 用了 `dsh.client.immediately`，`api-job-controller` 用了 `dsh.client.external`；`dsh.manifestVersion` / `dsh.engines.dsh` / `dsh.compatibility.dshReleases` / `dsh.minVersion` 等键见于真实包 | 这些键的**语义未证实**，不要凭猜测使用 | §D.5 |
| ⑪ | 主题令牌共 **403 个**，其中语义层是 `--dsw-alias-*`；`base.css` / `design-platform.css` 等**未随包发布**（编译进 `client.js`） | 不能 import 官方 CSS 文件；只能用 `var(--dsw-…)` | 实测正则抽取；`[THEME]README.zh.md:58` |
| ⑫ | `@deepseek-ai/dsh-client-ui-jobs` 的宿主半是**空实现**：`function apply() {}` | 客户端插件仍**必须**有宿主入口，因为它要以「一个普通 Loader 行」出现 | `[JOBS]\lib\index.js:8-11`、`[JOBS]\lib\types\index.d.ts:4-8` 原文：「this entry exists so the package appears as an ordinary Loader row」 |

### H.2 附带查到的一条高价值事实（设置持久化）

- `@deepseek-ai/dsh-settings` 的 API 面**收窄过**，真实插件对此有具名记录（`dsh-status-rotator\lib\index.js` 的 `resolveSettingsNamespace` 注释区）：
  > `dsh-settings` 的导出面收窄过：新版本只导出 `{ SettingsConflictError, SettingsProvider, redactSecrets }`，不再有 `settingsNamespace()`。旧代码直接调它 → TypeError 被外层 catch 吞掉 → settings 整条链路静默失效（用户配置不生效、保存也不落盘）。
  > 为什么不是宿主设置存储：`@deepseek-ai/dsh-settings` 0.1.7-rc.1 的 settings 服务只有 `describe` / `update` / `replace` / `mutate` / `configure`，**没有**插件原来依赖的 `register()`（也没有 `document`）……
- **未证实**：`@deepseek-ai/dsh-settings@0.2.0-rc.2` 的确切导出面与 Service 方法表（该包未拉取）。以上为第三方插件注释转引。
- ⇒ 若 `yibinthesis-dsh` 需要持久化配置，**先拉 `@deepseek-ai/dsh-settings@0.2.0-rc.2` 核实**，不要照抄任何一方。

---

## I. 状态汇总（A–F）

| 问题 | 状态 | 说明 |
|---|---|---|
| **A** `defineTool` 精确调用形态 | **已证实** | 字段表、参数形态、`output.schema`/`render`、`execute` 签名全部有 `.d.ts` + 官方 README + 真实插件三重证据。**唯一重要修正：`executionMode` 不是选项（§A.7）** |
| **B** 注册写法 + 入口语义 | **已证实** | `ctx.tools.register(defineTool({...}))` 返回 disposer；`name`/`inject`/`Config`/`apply` 语义均有证据。`ctx.effect` 的签名标注为**部分证实**（无正式 `.d.ts`，但有 5 处真实用法） |
| **C** `cordis.patch.yml` 语法 | **已证实** | `- insert:` / `- id:` 语义、字段集、`name` = 包名硬要求均由两个真实包 + profile 自身 patch 证实。loader 内部行号为**转引未复核**（§C.5） |
| **D** `package.json` 各字段 | **已证实**（主字段） | `dsh.bundle.patch` / `dsh.client.platform` / `dsh.client.inject` / `exports["./client"]` 全部证实。`immediately` / `external` / `manifestVersion` / `engines` / `compatibility` 等**语义未证实**（§D.5） |
| **E** 客户端插件骨架 | **已证实** | `__ModuleLoader__` 格式、`exports.apply`+`exports.inject`、`ctx.slots.inject`+`register`、`ctx.locale.register`、主题令牌机制与 403 令牌清单全部证实并有逐行骨架。**Slot 键全集未证实**（只列出 conversation 包拥有的 + 2 个跨包键） |
| **F** host↔client 通信 | **部分证实** | 正式 RPC = Typert Remote，**构建期固化**，第三方新增路径**未证实**；`ctx.remote` / `ctx.remote.$on` 与 `API_REMOTE_FORWARDED_EVENTS` 已证实存在但**方法签名未证实**；第三方可用的 **webServer 路由 + HTTP/SSE** 已由真实插件证实可用，但 `webServer.register` 的正式类型**未证实** |
