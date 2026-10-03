# 安装 yibinthesis-dsh

面向 DSH（DeepSeek Harness）Desktop 用户。全程约 3 分钟。

## 前置条件

| 依赖 | 用途 | 必需 |
| --- | --- | --- |
| DSH Desktop（含 `pnpm`） | 承载插件 | ✅ |
| Node.js `^22.19.0 \|\| >=24` | host 半运行 | ✅ |
| Python 3.10+ | 结构化读取适配器（`probe` / 文件清单） | ✅ 面板取数需要 |
| Tectonic / Biber / Pandoc | 真正的 PDF / DOCX 构建 | 仅构建需要 |

> 装完插件后可用 `yibinthesis_doctor` 检查工具链；它会**如实报告缺失**，不会假装就绪。
> Tectonic 首次运行会下载宏包，可能数分钟。

## 一、装进 profile

```powershell
cd $env:USERPROFILE\.dsh\profiles\desktop
pnpm add yibinthesis-dsh
```

本地开发时用路径代替包名：

```powershell
pnpm add E:\src\yibinthesis-dsh
```

## 二、把包名加进 profile 的 bundles

编辑 `<profile>\package.json`，在 `dsh.profile.bundles` 里追加包名（**不要**删掉已有项）：

```jsonc
{
  "dsh": {
    "profile": {
      "bundles": [
        /* …已有的… */
        "yibinthesis-dsh"
      ]
    }
  }
}
```

`package.json#main` **不会**因为「包被列进 bundles」就自动执行——
真正被 import 的是 `cordis.patch.yml` 里 `- insert:` 那一行（它由本包随包提供，
所以你不必手写 CSS / 工具注册）。

## 三、重载

profile 补丁是 `patchReload: live`，但**宿主侧的 JS 模块在启动时载入并缓存**：

| 改动 | 生效方式 |
| --- | --- |
| 面板（client 半） | **刷新页面** |
| 工具 / HTTP 桥（host 半） | **重启 DSH** |

第一次装完请**重启 DSH**，然后在任意会话的**右侧栏**点「＋」，在「开始」页里选
**论文工具**。

## 四、（可选）配置

在 `<profile>\cordis.patch.yml` 里按行 id 覆盖：

```yaml
- id: yibinthesis
  name: yibinthesis-dsh
  config:
    templateRoot: 'D:\src\YibinThesis'        # 想跟随上游更新时指向它；默认用随包副本
    cliRoot: 'D:\src\YibinThesis'             # yibinthesis_new 需要（提供 lib/yibinthesis_cli）
    defaultProjectDir: ''                     # 留空 → 面板初始为空，由你或助手指定
    toolchainDirs:                            # 二进制所在目录，会前置进子进程 PATH
      - 'D:\src\YibinThesis\.tools'
```

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `templateRoot` | 随包 `vendor/yibinthesis` | 模板运行时根（须含 `build.ps1`） |
| `cliRoot` | `null` | 上游检出根；不设则 `yibinthesis_new` 不可用 |
| `defaultProjectDir` | `''` | **建议留空**：面板按会话记住你加入的项目 |
| `toolchainDirs` | `[]` | 工具链二进制目录 |
| `pythonPath` | `null` | 跑适配器的解释器；留空用 PATH 上的 `python` |
| `buildTimeoutMs` | `600000` | 单次构建超时 |
| `maxLogBytes` | `262144` | 子进程输出上限，超出会截断并置 `truncated` |

非法配置会在**加载期**响亮失败（Cordis 用 standard-schema 校验），不会静默回落默认值。

## 五、验证

在会话里让助手：

```
用 yibinthesis_doctor 检查工具链
```

应看到 `exit 0` 与逐项就绪度；缺失的项会明确列出（例如 Biber 必须是 **2.17**，
与模板的 BCF 3.8 工作流配对）。

面板里应能看到：项目列表、论文摘要、文件分类标签页、交付物、工具链、生效配置。

## 常见问题

**面板显示「宿主没有注册桥路由 …（404）」**
宿主进程里还是旧版桥。**重启 DSH**（刷新页面不够）。

**面板一片空白**
面板已包错误边界，正常情况下会把错误显示出来。若仍为空，请把宿主控制台
（`Ctrl+Shift+I`）里的报错发出来。

**文件列表显示「N 个」但一个都列不出来**
client 半比 host 半新。**重启 DSH** 让两侧版本一致。

**侧边栏右侧没有「论文工具」标签**
标签需要在右侧栏的「开始」页里**主动选择**一次，之后会一直保留。

**构建报缺工具链**
`yibinthesis_doctor` 会列出缺哪一项。Biber 版本不匹配是最常见的原因。
