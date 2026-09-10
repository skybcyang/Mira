# macOS 桌面薄壳实施记录

- 状态：Electron 44 unsigned internal Alpha 验收完成
- 实施日期：2026-08-31
- 支持范围：macOS 13+，Apple Silicon 与 Intel
- 关联：[桌面 ADR](../architecture/adr-macos-desktop-shell.md)、[平台适配器契约](../specs/platform-adapters.md)、[当前验证报告](../validation/2026-08-31-macos-desktop-alpha-validation.md)

2026-09-10：用户已确认 macOS/Windows arm64/x64 未签名 Actions 测试包，主干更新后自动构建；四平台原生 make/smoke 证据见[自动打包验证](../validation/2026-09-10-desktop-auto-builds.md)。
当前跨平台范围和验收见[平台契约](../specs/platform-adapters.md)，运行方式见
[内部桌面打包](../operations/desktop-internal-builds.md)。本文保留原 macOS Alpha 实施证据。

## 原 macOS Alpha 已确认决策

- 只支持 macOS。
- 首次启动由用户选择 workspace 目录。
- 暂不做应用签名、公证、自动更新或公开分发。
- Web/Standalone 保持产品与日常开发主线；桌面版不复制领域、Store、HTTP API 或 React UI。

## 当前形态

```text
Electron thin shell
  -> 原生窗口、菜单、目录选择和应用生命周期
  -> 使用用户选择的 workspace 启动现有 Mira Node Host
  -> 使用 127.0.0.1 上由系统分配的临时端口和每次启动凭据
  -> BrowserWindow 加载同一套 React UI 与 HTTP API
```

桌面壳只增加 macOS 宿主能力。日常功能仍通过当前 `pnpm dev` 和 Standalone 路径开发；
桌面构建是发布验证目标。开发环境要求 Node.js `>=22.12.0`，packed `.app` 自带运行时，
目标 Mac 不需要安装 Node.js、pnpm 或开发服务器。

## 为什么不改成 IPC 主架构

当前 `v2Api`、HTTP route、Mira Application 和 Standalone host 已形成完整单一路径。若增加
一套 Electron IPC Client，每个新 API 都需要同步维护 HTTP 与 IPC，反而扩大修改影响。

首版因此复用现有 HTTP transport。只有钥匙串、通知、系统拖放等明确的原生需求出现时，
才为该能力增加窄范围、具名且校验参数的 IPC；不暴露原始 `ipcRenderer`，也不迁移普通
业务 API。

## Internal Alpha 实施清单

- [x] 编写并采纳桌面 ADR，固定 thin shell、临时端口、启动凭据和 workspace 生命周期。
- [x] 将 Node host 启动入口改成接收 `workspaceRoot` 与端口 `0` 的可复用 runtime，保持
  Standalone CLI 行为不变。
- [x] 建立 Electron main/preload 和显式 staging 入口，不修改现有 Web renderer 入口。
- [x] 首次启动使用 macOS 原生目录选择器；取消时不创建业务目录或桌面状态。
- [x] 预检所选目录和三个数据路径，并执行真实读写探针后再初始化 `boards-v2/`、
  `runs-v2/` 和 `workflows-v2/`；失败时回滚本次新建目录。
- [x] 在 Electron `userData` 中只原子保存最近 workspace 路径与窗口状态，不保存业务数据。
- [x] workspace 丢失、移动或不可写时要求重新选择，不静默切换目录。
- [x] Node host 只绑定 `127.0.0.1:0`，并使用每次启动随机生成的访问凭据保护所有路由。
- [x] BrowserWindow 保持 `nodeIntegration: false`、`contextIsolation: true`、sandbox、CSP、
  权限拒绝和导航限制。
- [x] 增加 macOS 菜单、单实例、窗口状态恢复/屏幕内校正和受控外链打开。
- [x] 使用显式载荷清单和 Electron fuse 输出 Apple Silicon 与 Intel 两套 unsigned
  `.app`、`.dmg` 和 `.zip`。
- [x] 增加 workspace、认证、端口隔离、状态写入、退出清理、边界、打包策略和 packed
  smoke tests。
- [x] 同步 `AGENTS.md`、架构图、平台契约、运行文档和验证报告。

## 已取得的真实证据

- arm64 与 x64 的 unsigned `.app`、`.dmg` 和 `.zip` 已在 macOS 上真实生成。
- 两个架构的 packed `.app` 均从独立临时 workspace 和 `userData` 启动，等待真实 renderer、
  样式和 Board API ready，验证三个业务目录后经 `SIGTERM` 正常退出。
- 定向 desktop、Node runtime、host、架构边界与 packaging 测试已通过。
- 最终 arm64 packed `.app` 在未锁屏的真实 macOS 会话完成原生目录选择、主窗口和计划编辑
  可见检查；同一 UI 在 `390x844` 完成菜单、表单、两步计划预览和零横向溢出验证，浏览器
  console warning/error 为 `0`。

精确命令、产物路径与发布范围外项目见当前验证报告；历史命令输出不能替代新的发布门禁。

完整 `pnpm test`（56 files / 481 tests）、TypeScript、frontend build、bridge build 与
`git diff --check` 已在合并后的根工作区通过。签名、公证、更新机制和跨进程 workspace lock
属于扩大分发或多宿主并发之前的后续范围，不是本次 unsigned internal Alpha 的完成项。

## 原 macOS Alpha 范围外

- Windows、Linux、Mac App Store。
- 签名、公证、自动更新和系统托盘。
- 桌面专用领域模型、Store、HTTP API 或 UI 分支。
- 固定本地端口、静默迁移现有数据或自动覆盖 workspace。
- 为普通业务接口建立第二套 IPC transport。

## Internal Alpha 完成门槛

- 同一功能修改无需分别修改 Web 与 Desktop 业务实现。
- 在没有系统 Node.js、pnpm 和开发服务器的 Mac 上可从打包产物启动。
- 用户选择的 workspace 是唯一业务数据根目录，退出和重启后保持一致。
- Web、Standalone 与 Desktop 共享完整测试，并额外通过桌面打包后启动验证。
- 可见 UI 验收和完整全仓门禁有当次、可复查的证据。

以上 internal Alpha 门槛均已有当次证据。签名、公证、自动更新与公开分发仍需独立发布门禁，
不能由本次 unsigned internal Alpha 结论替代。
