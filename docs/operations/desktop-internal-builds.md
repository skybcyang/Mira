# GitHub Actions 内部桌面打包

2026-09-09 确认的范围：Windows x64 与 macOS arm64/x64 内部测试包。平台边界和验收以
[平台适配器契约](../specs/platform-adapters.md)为准；打包成功不代表公开发布或 Windows 真机验收完成。

## 在 GitHub 上运行

1. 将本批代码及 `.github/workflows/desktop-build.yml` 提交到 GitHub 仓库。
   手动触发入口要求 workflow 文件已进入默认分支；之后可以选择要构建的分支。
2. 在仓库 **Actions → Internal desktop builds → Run workflow** 选择分支并运行。
3. 等待 Repository checks 和三个打包任务通过，在该次运行底部 **Artifacts** 下载目标包。

本 workflow 支持 `workflow_dispatch`，也会在分支 push 涉及 workflow、desktop、Forge、
staging/make/smoke 脚本、桌面测试或 package/lockfile 时自动触发（首次推送配置也会触发）。
只有 UI、业务代码或文档变化时可手动构建；未配置 PR 触发。它不会推送代码、
创建 GitHub Release 或发布安装包；不需要签名证书、模型 API Key 或发布 token。
Actions 必须在仓库中启用。构建产物保留 14 天，可访问者由 GitHub 仓库和 Actions 权限决定。

首次源码开源准备增加了私仓限制：此内部 workflow 仅在 private 仓库执行，公开仓库及
公开 fork 会跳过检查和打包任务，避免首次 push 自动暴露未签名产物。公开源码使用
独立的 `CI` workflow 验证；本地打包命令仍可使用。将来公开分发安装包时另行评审这一限制。

| 下载名称中的目标 | 原生 runner | 内部产物 |
| --- | --- | --- |
| `darwin-arm64` | `macos-15` | Apple Silicon `.dmg`、`.zip` |
| `darwin-x64` | `macos-15-intel` | Intel `.dmg`、`.zip` |
| `win32-x64` | `windows-2022` | 免安装 `.zip`，完整解压后运行 `Mira.exe` |

Artifact 名称包含源码 commit SHA，便于对应日志；GitHub 下载的外层压缩包里才是 Forge
生成的 DMG/ZIP。Windows 必须保留解压后的完整目录，不能只复制 EXE。首批 Windows
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
# macOS Apple Silicon
pnpm desktop:make:arm64
pnpm desktop:smoke:packed:arm64
node scripts/packed-desktop-smoke.mjs --arch=arm64 --restore

# macOS Intel 或 Windows x64（自动使用当前操作系统）
pnpm desktop:make:x64
pnpm desktop:smoke:packed:x64
node scripts/packed-desktop-smoke.mjs --arch=x64 --restore
```

`pnpm desktop:make` 保留原有 macOS 双架构串行构建用途；Windows 使用 `desktop:make:x64`。
输出位于 `out/desktop/`，分发文件位于 `out/desktop/make/`。

CI 先在 macOS 执行全仓测试、类型检查和前后端构建；然后各目标执行桌面定向测试、
native make、普通 packed smoke 和含 Checkpoint 的备份恢复 smoke。只有这些步骤通过才
上传产物。每次 smoke 使用临时 workspace/userData，在真实 renderer 和 Board API ready
后，在临时 userData 中写入 `smoke-ready` 标记并请求普通应用退出。父进程随后检查
退出码、标记、恢复的数据和工作区锁释放。标记及退出仅在 `MIRA_DESKTOP_SMOKE=1`
且 `MIRA_DESKTOP_SMOKE_EXIT_ON_READY=1` 时启用，不依赖 Windows GUI 的标准输入/输出，
也不对 renderer 或网络开放。

staging 只装入 bundled main/preload、React 构建与最小 package.json。Board、Run、灵感池、
`.env`、workspace lock、源码和测试不进入包。workflow 不需要也不读取本机工作区数据。

首次 GitHub 运行仍需检查三个目标的实际日志与产物。Windows runner 上的 smoke 不能替代
Windows 客户端的目录选择、窗口关闭、焦点和显示检查；macOS 也保留原有真实 UI 验收要求。

配置依据：[GitHub runner 列表](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)、
[手动 workflow](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow)、
[Forge ZIP maker](https://www.electronforge.io/config/makers/zip)。
