# 依赖维护与 Electron 44.3 本机安装验证

日期：2026-09-14，Asia/Shanghai。范围：本轮 5 个 Dependabot PR 的取舍、Actions artifact 上传升级，以及 Electron 44.3.0 桌面打包和本机替换；不改变 Board、Run、Candidate、Workflow 或 workspace 数据语义。

## 依赖取舍

| 项目 | 结论 | 依据 |
| --- | --- | --- |
| `actions/upload-artifact` 7.0.1 | 已通过 PR #18 合入 | 同一固定 SHA 覆盖 3 个上传点；普通 CI 与 macOS/Windows arm64/x64 原生 make、两种 packed smoke、artifact 上传均通过。原 Dependabot #10 只覆盖 1 个调用点，关闭后由完整 PR 取代。 |
| Electron 44.3.0 | 本批升级 | 保持 Electron 44 major 和 Node `>=22.12.0` 基线，只更新 patch、锁文件、四平台包键及 macOS 官方 SHA-256。Dependabot #13 在关闭前也刷新到 44.3.0，但只更新依赖与锁文件；本批以包含校验和、许可、打包及安装证据的完整 PR 取代。 |
| `pnpm/action-setup` 6.1.0 | 暂不升级 | Windows arm64 runner 上，v6 先启动 pnpm 11 再切换项目固定的 pnpm 9.0.0；`@pnpm/exe@9.0.0` 没有 win32-arm64 包，实际失败为 `ERR_PNPM_PNPM_ENGINE_IDENTITY_UNVERIFIABLE`。#11 已关闭，后续应作为 pnpm 工具链升级独立处理。 |
| Vitest 5 | 暂不升级 | 属于测试工具 major migration，没有当前产品或安全修复要求；#12 已关闭，待独立迁移和兼容性验证。 |
| Lucide 1.44 | 不升级 | 当前按钮反馈、运行指示和设置开关不需要新增图标，且无安全修复；#14 已关闭，避免无收益锁文件变更。 |

## 实现与工程验证

- `electron` 从 `44.0.0` 精确升级到 `44.3.0`，`pnpm-lock.yaml` 与依赖许可清单同步；许可证仍为 MIT，生产 notices 无内容变化。
- 先只更新依赖，定向测试按预期失败：Windows 包键仍指向 44.0.0，macOS 包摘要仍是旧值。同步 44.3.0 键与官方摘要后，2 文件 / 21 测试通过。
- 桌面宿主、打包、跨平台与 Node runtime 定向回归：12 文件 / 99 测试通过。
- 全仓：185 文件 / 1858 测试通过；`pnpm exec tsc --noEmit`、`pnpm build`、`pnpm build:bridge` 与 `git diff --check` 通过。
- 本机 Apple Silicon：`pnpm desktop:make:arm64`、普通 packed smoke 和 Backup restore packed smoke 通过；生成 `.app`、DMG 与 ZIP。
- 使用独立临时 workspace/userData 启动 packed app，真实 macOS 窗口与系统设置面板可见，无遮挡或横向溢出。宿主日志达到 `[mira-desktop] ready`，仍有既有 Node `fs.Stats` 弃用提示，退出时出现一条 macOS 输入法 mach-port 消息；本次未把不可见的 DevTools console 推断为零告警。

## 本机替换与回退

替换前确认没有 Mira/Standalone 进程或其他进程打开当前 workspace。上次异常退出遗留的 `.mira-workspace.lock` 中 PID 已被系统其他进程复用；按恢复规程先保存完整 workspace、桌面状态和旧应用，再把该锁移动到私有回退目录，没有直接删除。

新 `.app` 先复制到 `/Applications/` 的独立暂存路径，并核对构建包、暂存包和最终安装包的 `app.asar` SHA-256。旧应用移动到私有回退目录后再原子换名：

- 旧安装包 `app.asar`：`929ff47018d2b2e7a741db929c7ba7a549e47ab88fb09f45b132a13fc85de4ce`。
- Electron 44.3.0 构建及安装包 `app.asar`：`a75a7cf91c232281f29b9dfb6a52b2aec7fc79072cd4a0d7e306eece36ab1469`。
- 回退目录：`~/Projects/Mira-backups/electron-44-3-upgrade-8HYfYD/`，权限 `0700`；含替换前 workspace、桌面状态、旧应用和 stale lock。

安装版使用原 `MiraWorkSpace-project` 正常启动，项目总览显示原有 2 个画板；当前写锁 PID 指向安装版进程。替换前后 workspace 持久数据逐文件一致，差异只有新进程持有的 live lock；桌面选定路径保持不变。应用保持打开供后续使用。

## 边界

这是本机 arm64 未签名 internal Alpha 的替换，不是公开发行；未新增签名、公证、自动更新或 Release。其他原生目标继续以本分支 Pull Request 的 GitHub Actions 结果作为合并门禁，不以本机 arm64 证据替代 Windows 或 Intel Mac。
