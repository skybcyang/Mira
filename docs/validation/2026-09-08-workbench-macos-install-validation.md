# 工作台新版 macOS 本地安装验证

公开副本已脱敏个人绝对路径；原始验证事实与结果保留。

日期：2026-09-08。代码基线：`42f1be3`，版本 `0.1.0-beta.2`，目标为本机 Apple Silicon / arm64。

## 构建与检查

- `pnpm desktop:make:arm64` 通过，包含同一份最新 React 生产构建，输出 `.app`、DMG、ZIP。
- 桌面定向测试：10 文件、90 测试通过。
- `pnpm test`：133 文件、1479 测试通过（16:57:21 开始，7.94 秒）。
- `pnpm exec tsc --noEmit`、`pnpm build:bridge` 和 `git diff --check` 通过。
- `pnpm desktop:smoke:packed:arm64` 与带 `--restore` 的恢复 smoke 均通过；各自使用独立临时 workspace/userData，正常就绪后退出。

产物位于 `out/desktop/`：

- `Mira-darwin-arm64/Mira.app`
- `make/Mira-0.1.0-beta.2-arm64.dmg`（约 120 MiB）
- `make/zip/darwin/arm64/Mira-darwin-arm64-0.1.0-beta.2.zip`（约 121 MiB）

## 本地安装

旧版 UI 显示已保存且正文保存按钮禁用后，通过正常退出关闭旧进程，确认原 workspace 锁已释放。先复制新应用到临时安装路径并校验 app.asar，再将旧应用移动到可回退路径，最后替换正式路径并启动。

- 安装位置：`/Applications/Mira.app`。
- 旧版保留：`/Applications/Mira.app.previous-20260908-workbench`。
- 新包与安装副本 app.asar SHA-256 一致：`7203cca561741da769d2bee5fdabdc061aaab1c1281372fe0e416209db6af413`。
- 桌面偏好继续指向 `/Users/<local-user>/Projects/MiraWorkSpace`，没有切换或改写用户画板数据。
- 安装版日志达到 `[mira-desktop] ready`，原工作区由新桌面进程持锁。

## 可见验收与限制

真实 macOS 会话可见新版衬线 `mira.`、顶栏画板管理、居中搜索和全部平铺的悬浮工具。系统设置可打开，网格与外观入口可见；Escape 关闭后焦点返回设置按钮。原生“选择其他工作区”目录选择器显示正常，取消后回到原窗口与原工作区。390px Web 同构 UI 已在[本轮入口验证](2026-09-08-direct-work-tools-validation.md)检查，本次未重复移动视口。

本次未变更签名配置，仍为未做 Developer ID 签名、公证或自动更新的内部构建。`codesign --verify --deep --strict` 返回 Info.plist/签名被修改，并不具备签名验证通过的发布证据；packed 与安装版均实际启动成功。启动日志有 Node `fs.Stats` 弃用提示，以及操作原生菜单时的一条 macOS 输入法 mach-port 消息；未出现应用启动失败。未构建 Intel 版本、未向外发布。
