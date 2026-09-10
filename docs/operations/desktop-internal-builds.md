# GitHub Actions 桌面测试包

2026-09-10 确认的范围：主干更新后自动生成 macOS 与 Windows 的 arm64/x64 未签名测试包。
平台边界和验收以[平台适配器契约](../specs/platform-adapters.md)为准；打包成功不代表正式 Release 或 Windows 真机交互验收完成。

## 在 GitHub 上运行

1. 合并到 `main` 后自动开始构建，包含 UI、业务代码和仅文档的更新，无路径过滤。
2. 打开[主干成功构建](https://github.com/skybcyang/Mira/actions/workflows/desktop-build.yml?query=branch%3Amain+is%3Asuccess)，选择最新一次运行。
3. 确认 Repository checks 和四个目标均成功，在该次运行底部 **Artifacts** 下载对应架构。
   新提交构建失败时不会伪装为“最新版成功”，请核对源码 SHA 与运行时间。

需要重试或验证其他分支时，在 **Actions → Desktop builds → Run workflow** 选择分支运行。
打包相关 PR（workflow、desktop、Forge、staging/make/smoke、桌面测试、package/lockfile）也自动构建，
用于合并前验证；PR 产物与主干产物按运行记录和 SHA 区分，不把 PR 包称为主干最新版。
同一分支出现新提交时取消仍在执行的旧构建，优先处理最新提交。
workflow 不推送代码、不创建 GitHub Release，不需要签名证书、模型 API Key 或发布 token。
Actions 必须在仓库中启用。构建产物保留 14 天，可访问者由 GitHub 仓库和 Actions 权限决定。

本次用户授权公开仓库的 Actions 测试产物，移除首次源码开源时的 private-only 限制。
这些包未签名、未公证，没有应用内自动更新；只作为显式下载的测试版本。
源码的 `CI required` 仍独立运行，主干 PR 保护规则保持有效。

| 下载名称中的目标 | 原生 runner | 内部产物 |
| --- | --- | --- |
| `darwin-arm64` | `macos-15` | Apple Silicon `.dmg`、`.zip` |
| `darwin-x64` | `macos-15-intel` | Intel `.dmg`、`.zip` |
| `win32-x64` | `windows-2022` | 免安装 `.zip`，完整解压后运行 `Mira.exe` |
| `win32-arm64` | `windows-11-arm` | Windows ARM 免安装 `.zip`，完整解压后运行 `Mira.exe` |

Artifact 名称包含源码 commit SHA，便于对应日志；GitHub 下载的外层压缩包里才是 Forge
生成的 DMG/ZIP；下载 Actions artifact 需要登录 GitHub。Windows 必须保留解压后的完整目录，不能只复制 EXE。Windows
沿用 Electron 默认可执行文件图标，没有新增安装器或自动更新。

应用自带 Electron/Node runtime，使用者无需安装 Node.js 或 pnpm。启动后明确选择
workspace，业务数据只写入所选目录。不要让其他 Mira 实例同时写同一 workspace。
macOS 产物未签名、未公证，Windows 产物也未签名，系统可能显示来源或信誉提示。

## 本地构建与验证

构建机使用 Node.js `>=22.12.0`、pnpm `9.0.0`，先运行 `pnpm install --frozen-lockfile`。
CI 固定 Node 22、`TZ=Asia/Shanghai`（现有 UI 日期测试的时区）并冻结 lockfile；
继续复用 Forge、最小 staging 和同一套业务代码。

在目标系统运行：

```sh
# macOS Apple Silicon 或 Windows ARM64（自动使用当前操作系统）
pnpm desktop:make:arm64
pnpm desktop:smoke:packed:arm64
node scripts/packed-desktop-smoke.mjs --arch=arm64 --restore

# macOS Intel 或 Windows x64（自动使用当前操作系统）
pnpm desktop:make:x64
pnpm desktop:smoke:packed:x64
node scripts/packed-desktop-smoke.mjs --arch=x64 --restore
```

日常构建应选择本机对应的 `desktop:make:arm64` 或 `desktop:make:x64`。
`pnpm desktop:make` 保留原有双架构串行构建命令；跨架构生成不能替代原生 runner 验证。
输出位于 `out/desktop/`，分发文件位于 `out/desktop/make/`。

CI 先在 macOS 执行全仓测试、类型检查和前后端构建；然后核对每个 runner 的实际系统和架构，执行桌面定向测试、
native make、普通 packed smoke 和含 Checkpoint 的备份恢复 smoke。只有这些步骤通过才
上传产物。每次 smoke 使用临时 workspace/userData，在真实 renderer 和 Board API ready
后，在临时 userData 中写入 `smoke-ready` 标记并请求普通应用退出。父进程随后检查
退出码、标记、恢复的数据和工作区锁释放。标记及退出仅在 `MIRA_DESKTOP_SMOKE=1`
且 `MIRA_DESKTOP_SMOKE_EXIT_ON_READY=1` 时启用，不依赖 Windows GUI 的标准输入/输出，
也不对 renderer 或网络开放。

staging 只装入 bundled main/preload、React 构建与最小 package.json。Board、Run、灵感池、
`.env`、workspace lock、源码和测试不进入包。workflow 不需要也不读取本机工作区数据。

每次验收需要检查四个目标的实际日志与产物。Windows runner 上的 smoke 不能替代
Windows 客户端的目录选择、窗口关闭、焦点和显示检查；macOS 也保留原有真实 UI 验收要求。

配置依据：[GitHub runner 列表](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)、
[手动 workflow](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow)、
[Forge ZIP maker](https://www.electronforge.io/config/makers/zip)。
