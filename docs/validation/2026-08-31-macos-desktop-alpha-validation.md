# 2026-08-31 macOS 桌面 Internal Alpha 验证

- 状态：unsigned internal Alpha 验收完成
- 当前结论：双架构产物、packed smoke、可见桌面/390px UI 与完整全仓门禁均已通过
- 基线提交：`e299d0f` 加本次 desktop worktree 改动
- 环境：Apple Silicon，macOS 26.3.1，Node.js 26.7.0
- 契约下限：开发环境 Node.js `>=22.12.0`，目标 macOS 13+

本报告记录 2026-08-31 这一实施时点的真实证据，不替代产品规格，也不表示 Mira 已具备
公开发布条件。当前桌面版是 Electron 44 internal Alpha，没有 Developer ID 签名、公证
或自动更新。

## 范围

本轮验证覆盖：

- Electron thin shell 是否继续复用同一 React UI、HTTP API、Mira Application 和 Node Host；
- workspace 预检、状态持久化、临时 loopback 端口与启动凭据；
- BrowserWindow、导航、权限、生命周期和最小 staging 边界；
- arm64/x64 的 packed `.app`、DMG、ZIP 与真实进程启动/退出；
- 原生 workspace 选择、桌面窗口和 `390x844` 窄屏下的真实可见 UI。

本轮没有重新验收 Card、Transformation、Run、Candidate 或 Workflow 产品语义；它们仍以
完整全仓门禁和已有验证报告为准。

## 自动化测试

以下定向命令在 desktop worktree 通过：

```sh
pnpm exec vitest run test/desktop \
  test/architecture/desktop-boundary.test.js \
  test/bridge/node-runtime.test.js \
  test/bridge/standalone-host.test.js \
  test/scripts/desktop-package.test.js
```

结果：10 个 test files、66 个 tests 全部通过。覆盖了 workspace 取消/失败零初始化、状态
白名单与原子写、屏幕 bounds 恢复、host 启停、无凭据 `401`、渲染 ready、窗口安全策略、
退出收敛、thin-shell 架构边界、显式 staging 载荷和双架构打包策略。

合并后的根工作区通过了完整共享门禁：

```sh
pnpm test                  # 56 test files / 481 tests passed
pnpm exec tsc --noEmit     # exit 0
pnpm build                 # exit 0
pnpm build:bridge          # exit 0
git diff --check           # exit 0
```

## 打包产物

以下命令已在真实 macOS 环境成功完成：

```sh
pnpm desktop:make:arm64
pnpm desktop:make:x64
```

已生成：

| 架构 | `.app` | DMG | ZIP |
| --- | --- | --- | --- |
| Apple Silicon | `out/desktop/Mira-darwin-arm64/Mira.app` | `out/desktop/make/Mira-0.1.0-alpha.1-arm64.dmg` | `out/desktop/make/zip/darwin/arm64/Mira-darwin-arm64-0.1.0-alpha.1.zip` |
| Intel | `out/desktop/Mira-darwin-x64/Mira.app` | `out/desktop/make/Mira-0.1.0-alpha.1-x64.dmg` | `out/desktop/make/zip/darwin/x64/Mira-darwin-x64-0.1.0-alpha.1.zip` |

产物只包含 bundled main/preload、React `dist/` 和最小 package metadata；业务数据、`.env`、
归档、源码和测试不在 staging 载荷中。Forge 配置将最低系统版本写为 macOS 13，并为应用
启用 asar integrity/only-load-from-asar 等 fuse；当前产物没有 Developer ID 签名或公证。
最新 staging main 与 arm64/x64 两个 `app.asar` 中的 main SHA-256 均一致
（`e4c46d1ac31fd0db22e2866939f98179e2ed07de6031a1173640a3b79fa9cede`），
证明两架构产物包含同一份最新桌面入口。最后一次 arm64 remake 后对应 packed smoke 也再次通过。

## Packed Smoke

以下命令已通过：

```sh
pnpm desktop:smoke:packed:arm64
pnpm desktop:smoke:packed:x64
```

每次 smoke 都直接启动对应 `.app/Contents/MacOS/Mira`，使用独立临时 workspace 和
`userData`，不读取或改写仓库中的真实 Board/Run/Workflow。ready 条件同时要求 renderer
根节点、已加载样式和带本次启动凭据的 Board API 可用；随后确认三个 v2 数据目录已在临时
workspace 中创建，并通过 `SIGTERM` 验证 host 与应用进程正常退出。两个架构均满足该流程。

## 可见 UI

在未锁屏的真实 macOS 会话中，最终 arm64 packed `.app` 使用独立临时 `userData` 启动：

- 首次启动的 macOS 原生目录选择器可见、可聚焦，并成功选择隔离的临时 workspace；
- 主窗口完成首屏渲染，画布、顶部命令、缩放控件和空状态没有遮挡或溢出；
- 桌面端打开“搭计划”后，计划名称、最终成果、步骤编辑、添加、取消和预览操作均可达；
- 进程输出达到 `[mira-desktop] ready`，未出现桌面宿主错误。

同一 React UI 还在 `390x844` 真实浏览器 viewport 完成窄屏检查：“搭计划”正确进入“更多”
菜单，编排器以底部面板显示；填写两步计划并进入画布预览后，所有阶段的
`documentElement.scrollWidth` 与 `clientWidth` 均为 `390`。浏览器 console 的 warning/error
为 `0`。测试使用临时 workspace，没有写入仓库 Board/Run/Workflow 数据。

## 公开发布范围外

Developer ID 签名、公证、更新/回滚策略、干净目标机安装和 Gatekeeper 验收不在本次
unsigned internal Alpha 范围；若转为公开发布，必须另立发布门禁。

## 当前判定

Mira 已具备可打包、可真实启动、可正常退出的 macOS 双架构 internal Alpha，桌面宿主
没有引入第二套产品实现，完整工程门禁和可见 UI/390px 验收均已通过。此结论只覆盖内部
Alpha；在签名、公证和更新机制完成之前，不得作为公开安装包分发。
