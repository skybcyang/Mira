# 平台适配器契约

Mira 核心不依赖 DSH、Cordis、Node HTTP server 或具体模型厂商。依赖方向固定为：

```text
React client
    -> /graphmind/api/v2
HTTP host
    -> createMiraApplication
        -> storage port
        -> model port (optional)

HTTP host implementations
    - Node standalone host
    - macOS / Windows Electron thin shell -> same Node host
    - DSH/Cordis adapter
```

## 核心应用

`bridge/mira-application.js` 是应用装配边界。`createMiraApplication(options)` 返回：

- `ready`：Candidate 对账和活动 Run 恢复完成后的 Promise。
- `dispatch(method, segments, body)`：宿主无关的 v2 路由分派；每次调用先等待 `ready`。
- `boardStore`、`runStore`、`workflowStore`、`handlers`、`workflowService`：供适配器和测试组合使用。

`bridge/main.js` 只导出核心应用和通用 HTTP helper，不导入 DSH 适配器。

## Storage port

默认 Store 使用以下文件接口：

```js
{
  readText(path),
  writeText(path, content),
  replace(from, to),
  remove(path),
  listJson(directory),
}
```

`replace` 必须保持同一文件系统内的原子替换语义。当前互斥锁只存在于单个进程中；无论使用哪个宿主，同一 workspace 同一时刻只能有一个可写 Mira 实例。

Card 文件自动同步只能使用此 storage port：先读取 workspace-relative 文件并比较同步 digest，再写入唯一的临时 workspace-relative 文件，最后通过 `replace` 原子替换目标；同步不能由 React、preload 或平台宿主绕过应用层直接写文件。适配器必须继续拒绝绝对路径、`..` 越界和 NUL 路径，并将缺失与读写失败交给应用层形成可见同步状态。

Node 实现位于 `bridge/node-workspace-adapter.js`。DSH fs 实现位于 `bridge/dsh-cordis-adapter.js`。

## Model port

模型是可选依赖。Standalone 可通过 `MIRA_MODEL_ADAPTER` 加载 ESM 模块。模块必须默认导出一个函数，或导出 `executeModel`：

```js
export async function executeModel({
  boardId,
  transformation,
  sourceSnapshot,
  prompt,
  signal,
  onProgress,
}) {
  await onProgress?.({ phase: 'generating', label: 'Generating result' })
  return { outputText: await generateText({ prompt, signal }) }
}

export async function executeSuggestion({ prompt }) {
  return await generateText(prompt) // 兼容名称，仅供显式模型连接测试
}
```

`executeSuggestion` 是可省略的历史文本探针接口，用于显式连接测试，不再提供选卡推荐。模型模块负责自己的 SDK、凭据、限流和供应商错误映射；Mira 不读取厂商密钥。完整来源正文会随请求传给模型模块，因此模块也必须承担相应的数据边界责任。

仓库内置 `bridge/openai-compatible-adapter.js` 作为最小直接 LLM 实现。它使用原生 `fetch` 调用非流式 `chat/completions`，通过 `MIRA_LLM_BASE_URL`、`MIRA_LLM_MODEL` 和可选的 `MIRA_LLM_API_KEY` 配置。`pnpm start:llm` 会把它装配到同一个 Model port；该路径没有 Agent session、工具调用、自动重试或跨请求记忆。

Standalone 默认同时装配 `bridge/model-settings.js`。它提供进程内、可热更新的 OpenAI-compatible 配置，并由 Node host 暴露脱敏的读取、保存和连接测试路由。API Key 不写入 Board、Run、Workflow 或 workspace 文件，也不会通过 GET/PUT 响应返回；服务重启后以内存外的环境配置为准。自定义 `MIRA_MODEL_ADAPTER` 不经过该设置服务。

未配置模型模块时：

- Board、Card、Version 和 Workflow 正常工作。
- 选卡与添加步骤不调用模型，也不提供内置推荐回退。
- 显式 Run 会持久化为 `failed`，错误码为 `MODEL_UNAVAILABLE`，不会修改目标 Head。

DSH 模型会话实现仍位于 `bridge/dsh-cordis-adapter.js` 及其私有 helper 中，只负责把同一个 Model port 映射到 DSH root session、subagent 和 session event。

## HTTP hosts

通用 JSON 编解码、错误状态映射和 API 前缀位于 `bridge/mira-http.js`。两个宿主都保持同一外部契约：

- UI：`/graphmind/`
- API：`/graphmind/api/v2`
- API 在静态前缀之前匹配。
- 启动恢复完成前不处理业务请求。

Standalone 使用 `bridge/node-host.js`，默认只监听 `127.0.0.1`。`bridge/node-runtime.js`
把 Node Host 封装为接收显式 `workspaceRoot`、`staticRoot`、监听地址和端口的可复用启动/
关闭入口；`scripts/start-standalone.mjs` 只保留环境变量、模型适配器、日志和进程信号编排。

Standalone 默认不传 `accessToken`，因此当前 API 没有认证；除非外层提供认证、TLS 和请求
来源防护，不应直接监听公网地址。传入 `accessToken` 时，Node Host 必须在静态 UI、API
和 fallback 路由之前校验固定的桌面请求头；缺失或不匹配统一返回 `401` 和
`Cache-Control: no-store`，不得让请求进入 application dispatch。

## Desktop host

`desktop/main.mjs` 是 Electron 44 internal Alpha 的宿主入口。它不建立第二套应用或 transport：

```text
Electron main
  -> prepareWorkspaceRoot(user selection)
  -> startNodeRuntime({ host: '127.0.0.1', port: 0, accessToken })
  -> isolated BrowserWindow session adds token for the exact loopback origin
  -> /graphmind/ React UI -> same /graphmind/api/v2 -> same Mira Application
```

桌面宿主必须满足：

- 第一次启动由原生目录选择器获得 workspace；取消不创建业务目录或桌面状态。
- 路径存在、为目录且真实读写探针通过后，才初始化 `boards-v2/`、`runs-v2/` 和
  `workflows-v2/`；任一路径无效时不留下半初始化目录。
- Electron `userData` 只原子保存最近 workspace 与合法窗口 bounds，不保存 Card、Run、
  Workflow、模型 API Key 或临时访问凭据。
- 每次启动生成新的随机凭据，只绑定 `127.0.0.1:0`；凭据不进入 URL、日志、workspace
  或桌面状态文件。
- BrowserWindow 使用 `nodeIntegration: false`、`contextIsolation: true`、sandbox、CSP、
  权限拒绝和导航限制；preload 不暴露文件系统、子进程或原始 `ipcRenderer`。
- main 持有 Node runtime 的唯一引用。启动失败、切换 workspace、退出和信号关闭都先收敛
  状态写入并关闭 HTTP listener；关闭最后窗口在 macOS 上不等同于退出应用，Windows 上则正常退出并释放 workspace 锁。
- 单实例锁只约束同一个桌面应用，不能替代 workspace 跨进程锁。同一 workspace 同一时刻
  仍只能有一个 Desktop、Standalone 或 DSH/Cordis writer。

2026-09-10 用户确认主干更新后自动生成 macOS 与 Windows 的 arm64/x64 测试包。
macOS 13+ 输出 unsigned `.app`、`.dmg` 与 `.zip`；Windows 两架构输出包含 `Mira.exe` 的免安装 ZIP。
开发/构建环境要求 Node.js `>=22.12.0`，packed 应用自带运行时；两平台复用相同的
renderer、Node Host、workspace 锁与领域实现。Linux、安装器、签名、公证、
应用内自动更新和正式 Release 不属于本批范围。

桌面 CI 在 `main` 的每次 push 后自动执行，不按文件路径过滤；支持手动触发，打包相关 PR 也执行预合并验证。
公开仓库允许生成明确标注未签名的 Actions 测试产物，不再受首次源码发布的 private-only 限制。
每个任务先核对 runner 的操作系统和 CPU 架构，在四个目标原生 runner 上打包，测试和 packed smoke 成功后上传明确的
DMG/ZIP 构建产物，不创建 Release。每个目标必须使用临时 workspace/userData 验证真实
renderer、Board API、完整备份恢复（含 Checkpoint）、正常退出及锁释放；不能仅以编译
成功声称可运行。Windows 原生目录选择、窗口交互与最低系统兼容性仍需真实客户端验收。

macOS 的长期本地运行使用用户级 `launchd` LaunchAgent，但仍装配同一个
Standalone host，不形成新的平台实现。仓库内的管理入口必须满足：

- label 固定为 `com.mira.standalone`，`RunAtLoad` 注册；显式停止通过 `bootout`
  卸载 job。
- LaunchAgent 启动轻量 Supervisor，Supervisor 同一时刻只持有一个 Standalone
  子进程；子进程意外退出后延迟 1 秒重新启动，显式停止时向子进程传递 `SIGTERM`
  且不再重启。
- 工作目录、静态目录与数据 workspace 显式指向当前仓库，监听固定为
  `127.0.0.1:56300`。
- stdout/stderr 写入用户 `Library/Logs/Mira`，卸载服务不删除日志或业务数据。
- plist 不保存 API Key、token 或其他模型凭据；重启后的模型配置仍遵循上文
  Model port 规则。
- 安装和启动必须检查构建产物与端口占用；已存在其他 `56300` 服务时拒绝启动。
- 更新服务先卸载当前 job，确认旧 HTTP 监听退出，再加载新 job，避免短暂双实例。

LaunchAgent 只能约束自身单实例，不能替代 workspace 跨进程锁。操作者仍必须保证
Standalone 与 DSH/Cordis 不同时写同一个 workspace。

macOS Background Task Management 可能把未获用户允许的 legacy LaunchAgent 限制为
on-demand。安装命令会显式启动当前登录会话；重新登录后的自动启动取决于用户在系统
设置中允许该后台项目。若 workspace 位于 `Documents`，首次运行还可能触发 Node 的
文件夹访问授权。

DSH 兼容部署使用 `bridge/dsh-cordis-adapter.js`。`packages/mira-bridge` 和 `pnpm build:bridge` 直接引用该适配器，核心入口不反向引用它。

## A3–B8 材料适配与 A4 分发增量（2026-09-13 已确认）

以下是新增批次方案，不覆盖前文已经实施的未签名 Actions 契约。读取对象与 HTTP 行为以核心规格 §11 为准，执行顺序与当前阻挡见 `docs/refactor/a3-b8-delivery-plan.md`。

### 材料读取 port

`createMiraApplication` 注入网页/PDF 读取能力；Node Host 提供具体实现，缺席能力返回 MATERIAL_UNAVAILABLE。DSH/Cordis 不借实现文件反向依赖 Node，UI 根据宿主能力显示可用项。原 readFileContent 文本协议不改为“碰到任何文件就猜测解析”。

网页 adapter 使用受限网络连接取得有界字节，再以 Readability 0.6.0 和无脚本 linkedom 解析静态正文；DNS/重定向和连接地址由 Mira 自身校验，不能直接把第三方 URL fetch 当成安全边界。PDF 使用 PDF.js 5.4.624（兼容项目 Node 最低版本），独立 worker 共享解析文本与原页渲染的冻结字节，字体与 CMaps 只用随包本地资产。核心领域只消费规范文本、出处和错误，不 import 这些平台库。新增依赖必须通过四个原生目标 make/packed smoke，当前 Mac 两架构已验证，Windows 原生仍未验证；第三方文件列入最小 staging 清单。

### A4 手动更新与正式发行

1. 保留现有每次 main push 的四架构未签名 Actions 测试包。稳定下载采用 GitHub Releases 的明确版本资产；代码内只使用已验证的官方仓库地址，不生成第三方镜像链接。
2. 发行版本采用 SemVer，`v<package.json.version>` 与 changelog/manifest 一致；版本在实际发行准备时选定，不在设计阶段凭空创建 tag。预发布标明 prerelease，稳定版本不得混用 beta/候选描述。来源 SHA 固定到已验证提交，四个产物必须属于同一版本和 SHA。
3. 每个产物提供版本、平台、架构、字节大小、SHA-256、源码 SHA、构建运行链接及签名状态；生成统一 manifest 和校验文件。缺任一目标、签名状态不符或验证失败时拒绝推进为正式发行，不能拼接不同时刻的成功包。
4. 拟新增手动发行准备 workflow，仅接受明确源码 ref/版本；与现有自动测试包共用构建脚本。先执行全仓门禁、四个 native make、正常/恢复 packed smoke 和所需真机检查，再生成可审阅发行说明、manifest 与本地待上传资产。正式创建/公开 Release 为独立明确动作；默认脚本不得 push/tag/publish 或将失败包标为最新。
5. 签名为显式配置档：internal 继续 unsigned；release 模式缺少凭据必须失败，不回退 unsigned。macOS 使用 Developer ID Application、hardened runtime、公证和 stapling，验证 codesign、Gatekeeper 与 notarization 状态。Windows 对所分发 EXE/DLL 等需签名文件使用选定的 Authenticode 方案及可信时间戳，并在原生 runner 验证；继续保留完整解压目录，不凭空承诺安装器。签名方式依用户实际证书/服务决定，不自动采购。
6. 凭据来自操作系统凭据设施或受限 CI secrets，只在签名步骤可用；不得写入源码、manifest、renderer、workspace、日志或发行包。PR 与未签名测试任务无权访问发行凭据。不读取用户私钥内容来完成“配置检查”。
7. 第一阶段应用仅提供版本/架构显示和明确打开官方发行页面的入口，用户手动下载、校验、保存退出并替换应用；不检查后台 feed、不自动下载或安装。应用内自动更新列为第二阶段：签名、安装包格式、更新服务器/metadata 验签、用户确认、活动 Run/草稿退出与失败恢复需另有契约和验证，不能以两行 updater 接入代替这些条件。
8. 每次发行说明声明最低系统、兼容数据格式、已知限制、备份建议与回退方法。应用回退只适用于仍能读取当前数据的旧版本；不兼容时只能把事先备份恢复到新/空 workspace，再用旧版本打开副本，不覆盖当前工作区。至少验证本版到此前兼容版的启动/读取和数据不变。
9. A4 只有在版本资产、签名/公证、四平台验证、手动升级与回退证据及正式发布决策全部收口后才能勾选；仅提供 workflow 或下载按钮不算稳定分发完成。

验收 `DIST-01..06`：版本/SHA/架构一致且缺项拒绝；manifest 校验损坏包；缺凭据 release 模式失败而 internal 可用；签名/公证与正常/恢复 smoke；实际手动升级/回退且 workspace 不丢数据；检查/准备命令零远端写入，明确发布前不能改动 latest。

2026-09-12 核对的技术依据：[Defuddle](https://github.com/kepano/defuddle)、[PDF.js API](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib.html)、[Forge macOS 签名](https://www.electronforge.io/guides/code-signing/code-signing-macos)、[Windows 签名](https://www.electronforge.io/guides/code-signing/code-signing-windows)、[自动更新](https://www.electronforge.io/advanced/auto-update)。这些资料只说明工具接口与前置条件，不证明 Mira 已集成或发布成功。
