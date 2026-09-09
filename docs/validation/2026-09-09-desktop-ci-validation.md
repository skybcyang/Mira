# 跨平台内部打包验证

- 日期：2026-09-09
- 分支：`codex/desktop-ci`，基线 `ab47573`
- 范围：GitHub Actions、Windows x64 ZIP、macOS 双架构 DMG/ZIP、正常退出验证。
- 产品对象、UI renderer、Store 和 API 契约保持不变；使用临时 workspace，不修改用户画板。

## 本地证据

环境为 macOS 26.3.1 arm64、Node 26.7.0、pnpm 9.0.0；CI 使用 Node 22。

- 基线：138 个测试文件、1519 项测试通过。
- 新增跨平台目标、ZIP 配置、Windows EXE 路径、窗口关闭及 smoke 就绪退出测试，先失败后通过。
- 最终全仓：139 个测试文件、1525 项测试通过。
- `pnpm exec tsc --noEmit`、`pnpm build`、`pnpm build:bridge`、`git diff --check` 通过。
- actionlint 1.7.12 检查 `.github/workflows/desktop-build.yml` 通过。
- `pnpm desktop:make:arm64` 和 `pnpm desktop:make:x64` 均生成 DMG 与 ZIP。
- 两架构均通过普通 packed smoke 与 `--restore` packed smoke：真实 renderer/样式/Board API
  ready，恢复 Board 与 Checkpoint，普通退出 code 0，workspace 锁不存在。

首次 x64 恢复 smoke 发现：Host 开始 close 时仍有请求正在处理，该请求完成后仍保持
keep-alive，使桌面 3 秒退出上限先到，留下锁。诊断记录显示其他连接已关闭，最后连接
在退出期间继续服务请求。新增真实 HTTP 测试通过挂起一个请求、开始 close、完成响应，
在修复前复现 500ms 内无法结束；Host 在 response finish 时对 closing server 清理空闲
连接后通过。该修复不强断正在处理的请求，不以等待或重试掩盖失败。

## 可见检查与限制

通过独立 userData 和临时 workspace，在原生 macOS 会话完成工作区选择、主窗口显示、
焦点与关闭窗口检查。macOS 关闭窗口后保留进程，随后经 SIGINT 正常退出。
未改变 renderer 布局，本批未重复 390px 浏览器验收。

本机可见运行日志出现一次 Electron network service 重启、`fs.Stats` deprecation 和
macOS 输入法 mach-port 信息；界面随后正常 ready，因此不声称本机原生日志零告警。
全仓测试仍有基线已有的 React SSR `useLayoutEffect` 和 Node 26 localStorage 告警。

Windows 客户端的目录选择、焦点、显示、系统提示与最低系统兼容性尚未真机验收。
GitHub 原生 runner 结果见下节；本地 macOS 证据不能替代 Windows 运行证据。
产物未签名、未公证，无安装器、自动更新或公开 Release。

## GitHub 首轮反馈

- `ea5736f` push 自动触发运行 `34317999003`；两项 UI 日期测试因 runner UTC 时区失败。
  `ccb4afd` 将 CI 的 `TZ` 固定为 Asia/Shanghai，对应日期测试本地重跑通过。
- 运行 `34318281546` 的全仓门禁与 macOS arm64/x64 全部通过，Mac 产物上传成功。
  Windows native make 生成 ZIP，但使用标准输入 EOF 的 smoke 控制导致 GUI 提前退出。
- smoke 改为显式 `MIRA_DESKTOP_SMOKE_EXIT_ON_READY=1`：真实 renderer 验证后将 ready 标记
  写入临时 userData，再正常退出；父进程检查退出码、标记、恢复数据与锁释放，不再依赖
  Windows GUI 的 stdio 控制。普通交互运行不启用该标记与退出行为。

## GitHub 最终结果

源码 commit `89b7d3991f004dca1666842fa5b9b23815ace01f` 经分支 push 自动触发
[运行 34319081019](https://github.com/skybcyang/Mira/actions/runs/34319081019)，最终 `success`：

- Repository checks：全仓测试、TypeScript、前后端构建与 diff check 全部通过。
- `darwin-arm64`、`darwin-x64`、`win32-x64`：定向测试、native make、普通 packed smoke、
  Board/Checkpoint restore smoke 和产物上传全部通过。
- 三份 artifact 已确认存在且未过期，保留 14 天：
  - Windows x64：artifact `10091235480`，157,737,763 bytes。
  - macOS Intel：artifact `10091233356`，262,647,506 bytes。
  - macOS Apple Silicon：artifact `10091209760`，255,120,630 bytes。

本地修复后 Intel restore smoke 额外连续三次通过；最终采用 ready 文件的方式又完成
两种 Mac 架构的 make、普通和 restore smoke。Windows runner 上的成功表明打包程序能
加载实际 UI/API、恢复数据并释放锁，不扩大为 Windows 客户端完整交互验收。

GitHub 对所用 v4 Actions 发出了 Node 20 runtime 弃用提示，并实际使用 Node 24 运行
这些 Actions；仓库构建命令仍使用显式安装的 Node 22，全部任务成功。未宣称 CI 零告警。
功能分支已推送到远端，未合并 main，未创建 PR 或 GitHub Release。
