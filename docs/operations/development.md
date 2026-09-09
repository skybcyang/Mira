# 运行、开发与维护

这里集中保存源码运行、模型适配、后台服务和开发命令。第一次使用请先读[新手教程](../user/getting-started.md)；桌面安装包获取与跨平台 make/smoke 见[内部桌面打包](desktop-internal-builds.md)。

## 运行与开发

开发环境要求 Node.js `>=22.12.0`。macOS 桌面构建与运行目标为 macOS 13 或更新版本。

    pnpm install
    pnpm test
    pnpm exec tsc --noEmit
    pnpm build
    pnpm build:bridge

独立运行（默认生产路径）：

    pnpm build
    pnpm start

打开 `http://127.0.0.1:56300/graphmind/`。可用环境变量：

- `MIRA_HOST`：监听地址，默认 `127.0.0.1`。
- `MIRA_PORT`：监听端口，默认 `56300`。
- `MIRA_WORKSPACE_ROOT`：数据与 file-reference 的 workspace，默认当前目录。
- `MIRA_STATIC_ROOT`：已构建前端目录，默认 `<workspace>/dist`。
- `MIRA_MODEL_ADAPTER`：可选 ESM 模型适配器模块或包名。

使用独立数据 workspace 时还要把 `MIRA_STATIC_ROOT` 指向当前仓库构建出的 `dist`；否则服务会到 `<workspace>/dist` 查找前端。
Standalone 默认没有认证。需要从其他设备访问时，不要直接把 `MIRA_HOST` 暴露到公网；
应在外层配置 HTTPS、认证和请求来源防护，并继续遵守单 workspace 单写者约束。

### macOS 桌面 Internal Alpha

桌面版是 Electron 44 薄壳，复用上述 React 构建、HTTP API 和 Node Host。开发启动：

    pnpm desktop:dev

首次启动会显示 macOS 目录选择器。验证所选目录可读写后，Mira 才会在其中初始化
`boards-v2/`、`runs-v2/` 和 `workflows-v2/`；最近 workspace 与窗口状态只保存在应用的
`userData` 中。workspace 丢失或不可写时会重新要求选择，不会静默使用仓库或主目录。
运行中可从 Mira 应用菜单选择`选择其他工作区…`；应用会保存新目录并重启到该 workspace。
关闭最后一个窗口不会退出 Desktop 或停止本地 Host；从 Dock 再次激活会重开窗口，真正停止
写者需使用`Mira -> 退出`或 `Cmd+Q`。

生成 Apple Silicon 与 Intel 的 unsigned `.app`、`.dmg` 和 `.zip`：

    pnpm desktop:make

也可分别运行 `pnpm desktop:make:arm64` 或 `pnpm desktop:make:x64`。产物位于
`out/desktop/`；打包后启动验证分别使用：

    pnpm desktop:smoke:packed:arm64
    pnpm desktop:smoke:packed:x64

packed `.app` 自带运行时，目标 Mac 无需预装 Node.js、pnpm 或开发服务器。当前 Alpha
未签名、未公证、没有自动更新，也不用于公开分发；直接打开时可能出现 Gatekeeper
提示。开发、验证与交付边界见 [macOS 桌面 ADR](../architecture/adr-macos-desktop-shell.md)
和 [实施记录](../refactor/macos-desktop-shell-todo.md)。

macOS 上可把已构建的 Standalone 安装为当前用户的后台服务：

    pnpm build
    pnpm service:install

LaunchAgent 启动一个轻量 Supervisor；Mira 子进程意外退出后由 Supervisor 在 1 秒后
重新拉起。服务仍只监听 `http://127.0.0.1:56300/graphmind/`。首次安装时 macOS
可能要求允许 Node 访问当前 `Documents` workspace；重新登录后的自动启动还需要在
系统设置中允许对应后台项目。日常管理命令：

    pnpm service:status
    pnpm service:restart
    pnpm service:stop
    pnpm service:start
    pnpm service:logs
    pnpm service:uninstall

更新代码后先运行 `pnpm build`，再运行 `pnpm service:restart`。LaunchAgent
不会保存模型 API Key；卸载服务只删除 LaunchAgent，保留日志和 workspace 数据。
安装或启动前若 `56300` 已被其他进程占用，命令会拒绝启动，避免同一地址出现两个宿主。

最简单的直接 LLM 接法使用内置 OpenAI-compatible 适配器：

    MIRA_LLM_BASE_URL=https://api.example.com/v1 \
    MIRA_LLM_MODEL=your-model \
    MIRA_LLM_API_KEY=your-key \
    pnpm start:llm

`MIRA_LLM_API_KEY` 对无需鉴权的本地服务（例如暴露 OpenAI-compatible API 的 Ollama 或 vLLM）可省略。适配器调用 `${MIRA_LLM_BASE_URL}/chat/completions`，不使用 Agent、工具或持久模型会话。选中 Card 后的模型建议与显式生成都会把来源实际文本发送到该服务：Markdown 使用完整正文，file-reference 使用当时读取到的文件全文；不要把密钥写入仓库。

Standalone 模式也可从网页的“系统设置 → 模型设置”配置 Kimi K3 或其他 OpenAI-compatible 服务，并在保存前测试连接。网页读取接口只返回 `hasApiKey`，不会返回密钥；保存后的密钥仅存在于当前服务进程，重启后重新使用环境变量或再次设置。显式指定其他 `MIRA_MODEL_ADAPTER` 时，仍由该自定义模块管理配置，网页设置接口不接管它。

没有模型适配器时，画板、版本、步骤和 Workflow 仍可用，下一步建议使用内置回退；显式 Run 会以 `MODEL_UNAVAILABLE` 失败且不会覆盖内容。模型模块接口见 [平台适配器契约](../specs/platform-adapters.md)。

前端开发：

    pnpm dev

开发代理默认连接 `http://127.0.0.1:56300` 的 Mira server；使用其他端口时设置 `MIRA_BRIDGE_ORIGIN`。

DSH/Cordis 仍是可选兼容部署：

- 插件包装：packages/mira-bridge
- DSH 适配器：bridge/dsh-cordis-adapter.js
- Cordis bundle：`pnpm build:bridge`
- 核心应用入口：bridge/main.js

Desktop、Standalone 与 DSH 插件不能同时写同一 workspace。同一 workspace 同一时刻只运行一个可写 Mira 实例。Node-backed Desktop/Standalone 会在恢复前取得 `.mira-workspace.lock`；第二个写者 fail-closed。DSH/Cordis 当前没有原子锁适配器，仍需由宿主保证单写者；残留锁处理见 [workspace lock recovery](../operations/workspace-lock-recovery.md)。

## 数据目录

- boards-v2/：生产 Board v2。
- runs-v2/：生产 Run v2。
- workflows-v2/：全局 WorkflowTemplate。
- board-checkpoints-v1/：手动保存的画布版本。
- 灵感池：workspace 根存储中的独立记录集合，不属于某个 Board；结构以[核心规格](../specs/core-specification.md)为准。
- archive/2026-08-23-vnext-rebaseline/data/：v1 Board/Run 的只读归档；产品运行时不扫描、不加载。
- archive/：历史数据、代码与文档证据，不参与生产构建。

代码可以随重构删除，用户原始 Board/Run 不能因清理直接删除。如需恢复旧内容，由操作者使用显式离线工具读取归档并生成新的 v2 文件；Mira UI、HTTP API 和 bridge 运行时不提供兼容或迁移入口。
