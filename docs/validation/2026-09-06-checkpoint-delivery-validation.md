# Card 与画布版本管理交付验证

- 日期：2026-09-06
- 集成分支：`codex/checkpoint-delivery-integration`
- 基线：主线 `9f76e86` 与版本管理实现 `8594438`；预览修复来自 `6550918`、`6a80ef8`。
- 结论：实现、集成门禁、三档浏览器和 macOS arm64 内部交付验收通过。
- 环境：macOS Apple Silicon、Node.js 26.7.0、pnpm 9.0.0，in-app Browser 与真实原生 macOS 会话。

## 产品与模块边界

保持已确认的 D1–D5：线性不可变 CardVersion、手动命名检查点、活动 Run/Candidate 禁止
保存、每 Board 20 个且不自动淘汰、恢复只创建全新副本，Checkpoint 与 MiraBackup V2 同批支持。
V1 备份继续恢复为零检查点；绑定文件元数据和引用文件正文不进入可移植包。

六处合并冲突按当前边界解决：根 Store 仍为组合入口；Checkpoint 命令由 Board slice
注入导航协调；版本详情进入 `detail/VersionPanel.tsx`；新 CSS 使用独立 `board-history.css`，
版本、外观与响应式规则进入对应现有模块。CSS 测试剔除本功能新增规则后，原主线指纹不变。
没有回灌旧 Beta.3 的标签删除、旧页签或通知实现。

## 回归修复

- 预览 A 慢请求、返回并打开 B 后，A 的迟到成功/错误不再覆盖 B；关闭、卸载、目标切换使请求失效。
- 使用服务端完整 Run 历史进行比较，并仅由同 Board 的实时缓存推进生命周期；不会把终态变回运行中或复活已处理 Candidate。
- 副本在读取来源、刷新目录、读取新 Board 期间都检查调用者和导航归属；取消或新任务不会被迟到结果抢走，已提交副本仍留在目录。
- 副本读取与归档协调并发时，旧请求不能把新任务的 loading 状态改成 error。
- 历史面板中的新建内容/添加步骤命令先关闭历史，再由正常内容/关系详情接管，不隐藏新编辑器。
- 窄屏固定底部命令使用不透明 surface，避免滚动正文透出。
- packed restore smoke 改用 `boardCheckpointFilename`；测试通过真实恢复生成实体，替代自行制造旧文件名的 fixture。

这些变更先观察对应测试失败再实现。独立只读审查提出的任务切换与 lifecycle 竞态问题已
逐项修复，审查者重新运行相关回归并确认收口。

## 自动化与产物

| 验证 | 结果 |
| --- | --- |
| `pnpm test` | 117 个文件、1279 项用例通过，含完整 Bridge 集成与故障注入 |
| `pnpm exec tsc --noEmit` | 通过 |
| `pnpm build` | 通过，保留独立 BoardHistory/DetailDrawer 等 chunk，无 500 kB 警告 |
| `pnpm build:bridge` | 通过 |
| `git diff --check` | 通过 |
| `pnpm desktop:make:arm64` | 生成 unsigned app、DMG、ZIP |
| `pnpm desktop:smoke:packed:arm64` | 通过 |
| `pnpm desktop:smoke:packed:arm64 --restore` | 通过，验证恢复后的 Board 与规范路径 Checkpoint |

原始 restore smoke 在错误的旧路径上真实失败；修复脚本后，原应用产物和最后重新打包的
应用均通过 restore 模式。全仓测试仍有 Node 26 既有 localStorage ExperimentalWarning。

## 用户流程与数据证据

浏览器使用 `/tmp/mira-checkpoint-acceptance.6BpDt6/workspace`，只接入确定性本地模型。

1. 1440x900：手动保存 Milestone A；继续修改正文并新增两次 Run；刷新后预览正确显示正文变化 1、新增运行 2。
2. 390x844：全宽 modal、焦点在面板内；20 项长标题列表无行内或页面溢出；第 21 次保存返回 CHECKPOINT_LIMIT，旧版本未被淘汰。
3. 390px：重命名成功；删除进入明确确认，取消不删除；API 对专门创建的临时检查点执行了实际删除并核对剩余集合。
4. 从 Milestone A 创建 Recovered milestone，自动打开新 Board；新 Card 身份与原 Board 不同，恢复两张原始卡和当时正文，不继承 fileBinding；原 Board 保持后续三张卡与修改内容。
5. 1024x900：从 BoardManager 打开 archived/trashed Board 的版本列表，旧版本保持可达，保存命令只读禁用，页面无横向溢出。
6. 活动 Run 保存返回 TARGET_BUSY；运行中人工写入后得到 Candidate，保存返回 CANDIDATE_PENDING；界面显示处理入口。
7. 在历史面板中点击新建内容，历史退出且正文编辑器立即获得焦点；Card v1 恢复时明确创建 v3，完成后 v1/v2/v3 均保留。
8. MiraBackup V2 包含 active/archived/trashed 共 4 个 Board、3 次 Run 和 21 个 Checkpoint，排除 fileBinding；真实恢复及 `pnpm restore:backup` 均恢复相同实体数量和检查点 ID 集合。

浏览器 console warning/error 为 0。三档截图检查未见主要控件遮挡或页面横向溢出。
列表和 modal 使用模拟窄屏，不宣称真实触屏设备或软键盘验证。

原生桌面另用独立 `native-workspace` 与 `native-userdata`：验证启动选择、原生目录选择器、
主窗口、版本菜单、名称焦点与 Native checkpoint 保存。未使用真实用户 workspace。
桌面 stderr 记录到 Electron network-service 自动重启、Node fs.Stats 弃用和 macOS 输入法
mach-port 诊断；应用正常 ready 且流程完成，不将这些宿主诊断描述为 renderer console 零错误。

截图位于 `out/checkpoint-delivery-validation-20260906/`：desktop-compare、mobile-compare、
mobile-limit、compact-archived 与 native-checkpoint。早期 mobile-compare 显示的 footer 透出
问题随后由不透明 surface 修复，样式回归和最新构建通过；原图保留作为发现证据。

## 清理与发布边界

旧 Beta.3 与旧设计分支已保存到 `.git/retired-beta3-design-20260906.bundle` 并验证完整历史，
然后删除 worktree/分支；旧 favicon、发布草稿和未采用的产品改动仍可从该备份恢复。
产品仍为 unsigned internal Alpha，未签名、未公证、无自动更新；本批不创建公开 Release
或移动既有 tag。当前目标架构为 arm64，未重跑 x64 make/smoke。

临时浏览器服务与原生应用在验收后关闭。真实 Mira 后台保持停止，未修改用户 Board/Run。
