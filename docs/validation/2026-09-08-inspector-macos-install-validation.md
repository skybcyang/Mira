# 独立名称与悬浮详情 macOS 本地交付

公开副本已脱敏个人绝对路径；原始验证事实与结果保留。

日期：2026-09-08。应用代码基线：`0904c62`。分支：`codex/contextual-inspector`。版本保持 `0.1.0-beta.2`，目标为本机 Apple Silicon / arm64。

本次包含工作台布局、独立卡片名称、灵感编辑、悬浮详情、未保存草稿保护，以及转换详情切回内容卡的跟随修复。交互与数据边界见[体验设计](../design/experience-design.md)，此前 Web 验证见[悬浮详情记录](2026-09-08-contextual-inspector-validation.md)。

## 工程与产物验证

- `pnpm test`：135 文件、1504 测试通过（20:24:20，7.06 秒）。
- 桌面定向：`pnpm exec vitest run test/desktop test/scripts/desktop-package.test.js test/architecture/desktop-boundary.test.js test/bridge/node-runtime.test.js test/bridge/standalone-host.test.js`，10 文件、90 测试通过。
- `pnpm exec tsc --noEmit`、`pnpm build:bridge`、`git diff --check` 通过。
- `pnpm desktop:make:arm64` 通过，包含当次 React 生产构建；输出约 120 MiB DMG 和 121 MiB ZIP。
- `pnpm desktop:smoke:packed:arm64` 与 `pnpm desktop:smoke:packed:arm64 --restore` 均通过；各使用独立临时 workspace/userData，验证真实 renderer、业务目录及备份恢复后正常退出。

产物相对本分支 worktree：

- `out/desktop/Mira-darwin-arm64/Mira.app`
- `out/desktop/make/Mira-0.1.0-beta.2-arm64.dmg`
- `out/desktop/make/zip/darwin/arm64/Mira-darwin-arm64-0.1.0-beta.2.zip`

## 安装与恢复路径

安装前确认旧应用未运行。用 `ditto` 复制到独立临时安装路径，比较 app.asar 一致后保留旧应用、替换正式路径并启动。

- 正式安装：`/Applications/Mira.app`。
- 可回退旧版：`/Applications/Mira.app.previous-20260908-inspector`。
- 安装副本与产物 app.asar SHA-256 一致：`f60403e857ea051515a4773b299cd36691d4b7d68f84d117762149678b7938d5`。
- 桌面偏好继续使用 `/Users/<local-user>/Projects/MiraWorkSpace`，窗口状态保留；安装进程 PID 28803 正常达到 ready，持有该 workspace 的锁。
- 未保存测试卡片、转换设置或灵感；没有替换、迁移或批量改写用户业务数据。

## 原生可见验收

真实未锁屏 macOS 会话中，正式路径应用已打开原画板。可见 Mira 字标、居中搜索、悬浮工具、直接改名与右侧悬浮详情；正文、标签和卡片信息区域无遮挡。打开改名聚焦输入，取消后回到改名按钮；系统设置打开与 Escape 关闭后的焦点返回正常。

原生 Mira 菜单的“选择其他工作区”打开目录选择器，取消后回到原窗口和原 workspace。此次共享 Web UI 没有新增样式改动；桌面/390px 的切卡和草稿保护证据沿用同一代码基线的[后续修正验证](2026-09-08-contextual-inspector-validation.md)。

安装版启动及操作日志只有已知 Node `fs.Stats` 弃用提示和 ready 标记，未发现 renderer warning/error 或启动失败；不将 Node 弃用提示表述为零告警。

## 交付边界

代码与文档交付到远端功能分支 `codex/contextual-inspector`，不合并 main。安装包保留本地，没有创建 GitHub Release。本次只构建本机 arm64，未重新构建 Intel；仍为无 Developer ID 签名、公证或自动更新的内部构建。
