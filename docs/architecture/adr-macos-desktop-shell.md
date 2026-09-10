# ADR：macOS 桌面薄壳

- 状态：已采纳，Electron 44 internal Alpha 已实现
- 日期：2026-08-31
- 范围：macOS internal alpha 的宿主、workspace 生命周期、本地传输与打包边界
- 关联：[平台适配器契约](../specs/platform-adapters.md)、[桌面薄壳实施记录](../refactor/macos-desktop-shell-todo.md)、[当前验证报告](../validation/2026-08-31-macos-desktop-alpha-validation.md)

## 背景

2026-09-10 扩展决策：用户确认 macOS 与 Windows 都提供 arm64/x64 Actions 测试包，主干每次更新后自动构建。
允许公开仓库上传未签名测试产物，增加 Windows ARM 原生 runner；正式 Release、签名、公证和应用内更新仍单独验收。
当前规则见[平台适配器契约](../specs/platform-adapters.md)，下列早期范围保留为决策历史。

2026-09-09 扩展决策：用户确认增加 Windows x64 与 GitHub Actions 手动内部打包。
两平台继续复用本文的 thin shell 和数据边界；新增范围及验收见
[平台适配器契约](../specs/platform-adapters.md)，操作见
[内部桌面打包](../operations/desktop-internal-builds.md)。下文“首个版本”描述最初 macOS Alpha，
不再限制本批 Windows 内部构建；历史 macOS 验证不能作为 Windows 验收证据。

Mira 已有一条完整的 Web/Standalone 路径：React 客户端使用
`/graphmind/api/v2`，Node host 将请求交给同一个 Mira Application，再由已有的领域
service 和 Store 读写 workspace。桌面化需要补充原生窗口、目录选择和应用生命周期，
但不能形成第二套产品、业务 API 或数据语义。

首个桌面版本只用于 macOS 内部 Alpha。它不承担公开分发所需的签名、公证、自动更新
和跨平台兼容，也不能以“桌面方便”为由改变 Card、Transformation、Run、Candidate 或
Workflow 的既有契约。

## 决策

### 1. Electron 只作为薄宿主

桌面应用采用以下单一路径：

```text
Electron main
  -> 校验用户选择的 workspace
  -> 在 127.0.0.1:0 启动现有 Node host
  -> BrowserWindow 加载 /graphmind/ 的同一套 React 构建
  -> React 继续使用同一个 /graphmind/api/v2
```

Electron main 只负责窗口、菜单、目录选择、单实例、受控外链、本地 host 启停和少量
应用元数据。它不导入 React feature，不重新装配 v2 route、领域 service 或 Store。
Web、Standalone、DSH/Cordis 和 Desktop 的业务修改仍只发生在现有共享路径。

preload 不暴露原始 `ipcRenderer`，也不提供文件系统或子进程能力。首版没有必须使用
IPC 的业务能力，因此不建立第二套 IPC client。未来若增加钥匙串、通知等原生能力，
每项能力必须使用窄范围、具名、校验参数的接口，并单独记录安全边界。

### 2. workspace 由用户明确选择

首次启动按以下顺序处理：

1. 显示 macOS 原生目录选择器；用户取消后退出，不创建 Board、Run、Workflow 或偏好文件。
2. 确认路径存在且为目录，并验证当前进程可以读取和写入。
3. 验证成功后，才允许 Node host 初始化 `boards-v2/`、`runs-v2/` 和
   `workflows-v2/`。
4. 在 Electron 的 `userData` 目录中只保存最近 workspace 路径和窗口状态；业务数据只在
   用户所选 workspace 中。
5. 重启时复用最近路径，但每次仍重新验证。路径丢失、移动或变为不可写时重新要求选择，
   不回退到仓库目录、主目录或新的隐式 workspace。

目录选择和业务目录初始化是两个阶段。取消或验证失败必须保持零业务数据写入。

### 3. 临时 loopback 端口也必须鉴权

桌面 main 每次启动生成新的高熵随机访问凭据，并要求 Node host：

- 只绑定 `127.0.0.1`；
- 使用端口 `0`，由系统分配空闲端口；
- 在静态 UI 和 API 分派前校验本次启动凭据；
- 对凭据缺失或不匹配的请求返回 `401`。

凭据只保存在当前 Electron main 进程内，由受限的 Electron session 为目标 origin 的请求
附加请求头。凭据不放入 URL、不写 workspace、不写应用偏好，也不输出到日志。端口随机
不能代替鉴权；同一机器上的其他进程仍可能发现并访问监听端口。

BrowserWindow 使用 `nodeIntegration: false`、`contextIsolation: true` 和 sandbox，页面
响应设置严格 CSP。导航只允许本次 Node host origin 和 `/graphmind/` 路径；新窗口默认
拒绝，明确的 `https:` 外链才交给系统浏览器。

### 4. 生命周期属于桌面宿主

桌面应用持有 Node host 的唯一引用。窗口启动失败、workspace 失效、第二实例退出或应用
结束时，main 负责关闭 HTTP server，并等待监听释放。单实例锁只防止同一桌面应用重复
启动，不能充当 workspace 跨进程写锁。

当前文件 Store 的互斥仅在单个进程内有效。因此同一 workspace 同时被 Desktop、
Standalone 或 DSH/Cordis 写入仍有破坏原子性与丢失更新的风险。internal alpha 明确要求
一个 workspace 同时只有一个 writer；在引入可验证的跨进程 workspace lease 前，产品
不得宣称多宿主并发写入安全。

### 5. 打包是发布验证目标，不是新开发主线

开发仍以 Web/Standalone 为主。桌面打包先构建 React UI，再把 Electron main 和 preload
打成自包含 bundle，并通过显式载荷清单放入独立 staging 目录。staging 只包含：

- bundled main；
- bundled preload；
- `dist/` React 构建；
- 最小 `package.json` 元数据。

仓库中的 `boards-v2/`、`runs-v2/`、`workflows-v2/`、`.env`、`archive/`、
`reference/`、`test/` 和 `src/` 不进入桌面产物。应用代码放入 asar，并关闭 Electron 的
Run-as-Node、Node options 和 CLI inspect 能力，同时启用 asar integrity 与 only-load-from-asar
限制。

Alpha 为 Apple Silicon 和 Intel 分别生成 unsigned `.dmg` 与 `.zip`。不执行签名、公证、
自动更新或公开发布；macOS Gatekeeper 警告属于该内部交付形态的已知限制，不能在发布
说明中伪装成可公开安装版本。

## 结果与取舍

- 产品、UI、HTTP API 与领域规则保持单一来源，桌面需求不会要求同步维护 IPC 版本。
- 应用随包携带 Electron 和 Node host，目标 Mac 不需要预装 Node.js、pnpm 或开发服务器。
- loopback 请求多一层临时凭据和 origin 限制，降低其他本机网页或进程直接调用 API 的风险。
- Electron 增加了包体、构建时间和安全更新责任；每次升级都要重新运行桌面边界与 packed
  smoke tests。
- internal alpha 暂不解决 workspace 跨进程锁。若要扩大分发或允许多宿主共存，必须先
  增加可恢复的 lease/lock 设计与冲突提示。

## 未采用方案

- **业务 API 全量改为 Electron IPC**：会复制现有 HTTP client 与 handler 契约，使每项
  产品能力出现两条实现和两套回归面。
- **BrowserWindow 直接加载 `file://`**：会让现有相对 API、路由与安全来源策略产生桌面
  分支，削弱 Standalone 作为真实部署路径的验证价值。
- **固定本地端口**：容易与 LaunchAgent 或其他实例冲突，也不能提供访问控制。
- **把业务数据放进 Application Support**：会隐式改变用户 workspace，破坏用户明确
  选择数据根目录的承诺。Application Support 仅保存宿主偏好。

## 验证要求

实施完成至少需要覆盖：workspace 取消与失败零写入、最近路径恢复、随机端口与无凭据
`401`、退出清理、导航限制、BrowserWindow 安全选项、最小 staging 载荷、两种架构的
DMG/ZIP 配置，以及从 packed `.app` 启动并加载真实 UI 的 smoke test。桌面测试是在完整
Web/Standalone 门禁之外增加的验证，不能替代既有领域和 bridge 集成测试。

internal Alpha 的定向测试、双架构产物、packed smoke、可见 UI/390px 检查和完整全仓门禁
均已取得证据。ADR 的“已采纳”只表示架构决策已经落地，不表示签名、公证、自动更新或
其他公开发布门禁已经完成。
