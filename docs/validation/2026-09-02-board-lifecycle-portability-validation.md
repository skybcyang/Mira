# 2026-09-02 Board 生命周期与可移植数据集成验证

公开副本已脱敏个人绝对路径；原始验证事实与结果保留。

- 状态：Wave 1–3 功能、永久清除、Node-backed workspace 写锁、UX/UI、浏览器与 arm64/x64 Desktop 集成验收完成
- 分支：`codex/mira-lifecycle-integration`
- Wave 1–3 与 BoardManager 浏览器基线：`2bc0979`
- 最终实现与补充验证基线：`978dcad`（包含 workspace 写锁 `16bcb94`）
- 文档收口：`0f40601`
- 环境：macOS arm64，Node.js `v26.7.0`，pnpm `9.0.0`

本轮使用独立临时 workspace，不读取或改写仓库数据目录中的 Board、Run 或 Workflow。目标是
同时补齐现有体验缺口，以及 Board 重命名、归档、可恢复删除、导入导出、完整备份和离线恢复。
产品仍不提供运行中 workspace 的整库覆盖，也不把撤销删除回执复用为导入入口。

## 用户路径与结果

| 用户 | 模拟任务 | 结果 |
| --- | --- | --- |
| 首次使用者 | 从空画布创建内容、连续新建、编辑第一张 Card | 空态 CTA 可命中；所有创建入口共用一次命令；新 Card 自动避让并稳定进入编辑焦点 |
| 日常知识工作者 | 组合材料、计划与灵感，观察运行进度 | 来源与步骤文案更明确；计划和灵感只做一次可读聚焦；结构化通知原位更新并避开工具区 |
| 高频撤销使用者 | 批量删除、撤销、重做和回执失效 | 浏览器与 Bridge 都按最近 50 个删除批次计数；永久失效项不阻塞更早历史，暂时错误可重试 |
| 多课题使用者 | 新建、重命名、归档、移入废纸篓、恢复、永久清除和切换 | 三态目录、revision CAS、活动 Run/Candidate 门禁与当前画板 fallback 全部生效；永久清除仅作用于 trashed Board 且不可撤销 |
| 数据迁移使用者 | 导出一个画板、重复导入、下载完整备份 | 每次导入生成独立 ID，不覆盖现有内容；导出和备份有 64 MiB UTF-8 边界，不包含密钥或页面临时状态 |
| 恢复操作者 | Standalone 离线恢复、Desktop 菜单恢复 | 只允许新建/真实空目录；校验、ID 保留、staging、提交与启动恢复均为 fail-closed |
| 键盘与窄屏使用者 | 用 tabs 键盘切换目录、执行生命周期命令、关闭弹窗 | Arrow/Home/End、焦点兜底与 opener 恢复有效；390px 面板无横向溢出，More 与通知不重叠 |

## 可靠性审查

- Board 生命周期写入使用 revision CAS；archived/trashed Board 的内容、Run、Candidate 与 Workflow
  写路径只读。归档和移入废纸篓会在锁内拒绝活动 Run 或待处理 Candidate。
- Board、Run、Workflow 共享公平 storage coordinator。组合写复用外层 lease，真实 backup snapshot
  gate 覆盖 Run 启动/终结、Candidate adopt/discard/reconcile/interrupt、Workflow 提取与应用，未再出现
  `outer mutation -> snapshot -> inner mutation` 死锁。
- 导入先验证和 remap，再通过 journal、隐藏 ID reservation、Run-first/Board-last rename 原子提交；
  进程恢复会在开放 Run 恢复前处理未完成 journal。普通读取看不到 staging 或 reserved ID。
- succeeded/candidate Run 必须由同一 Transformation 的 `lastRunId` 唯一持有；孤立 Candidate 在
  生成新 ID 和写盘前拒绝，确保导入/恢复后仍有 UI 可达入口。
- Node 备份恢复使用同一个 FileHandle 完成 `stat` 和有界分块读取，不在路径二次打开后无界读入。
- Node-backed Host 在恢复前原子创建 `.mira-workspace.lock`；第二写者返回 `WORKSPACE_LOCKED`，正常关闭释放，残留锁必须人工确认无写者后处理。DSH/Cordis 当前没有原子锁适配器，仍由宿主负责单写者。
- 永久清除只在 trashed + 当前 revision + 显式确认下执行，使用可回滚文件事务同时移除 Board 与 Board 级 Run，并写入 ID tombstone 防止复用。

## 真实浏览器

生产构建通过独立 Standalone Host 验证，未配置模型服务。

- `1440 x 900`：桌面 App bar 直接显示`画板`；完成新建、重命名、导出、重复导入、归档、
  移入废纸篓、恢复和永久删除。关闭管理面板后焦点回到`画板`，console warning/error 为 0。
- `1024 x 768`：管理面板为 `960 x 704`，页面和弹窗均无横向溢出。生命周期命令移除当前行后，
  焦点回到当前状态 tab，不落到 `body`。
- `390 x 844`：More 菜单与通知保持至少 8px 间距；管理面板精确覆盖 viewport，无横向溢出。
  导入预览、三态 tabs 和 44px 行命令可达；关闭后焦点回到可见的`更多`按钮。另完成
  “移入废纸篓 -> 废纸篓 -> 永久删除”的二次确认流程，删除后废纸篓为 0、当前画板 fallback
  为仍 active 的 Board。
- 实际 BoardArtifact 包含 1 张 Card/Version；同一 artifact 两次导入产生两个独立 Board ID。
  实际 MiraBackup 含 4 个 Board，并确认没有 API Key、页面草稿或引用文件正文。
- 当前应用内浏览器不暴露下载事件；UI 成功终态、服务端真实 artifact、UTF-8 Blob/安全文件名/
  延迟 URL revoke 测试共同覆盖下载链路。另在最终 Electron UI 中实际落盘验证：
  `/Users/<local-user>/Downloads/Mira 画板.mira-board.json`（586 bytes）和
  `/Users/<local-user>/Downloads/mira-20260902-2102.mira-backup.json`（571 bytes），均通过
  文件名、非零大小、fatal UTF-8、JSON 格式与敏感字段检查；没有把 IAB 的 download event 当作证据。

## 自动化与 Desktop

| 命令 | 结果 |
| --- | --- |
| `pnpm test` | 通过：80 个测试文件，914 个用例 |
| `pnpm exec tsc --noEmit` | 通过，exit 0 |
| `pnpm build` | 通过；BoardManager 保持独立延迟 chunk |
| `pnpm build:bridge` | 通过，exit 0 |
| `pnpm desktop:stage` | 通过，使用最终 renderer |
| `pnpm desktop:make:arm64` | 通过，生成 arm64 DMG 与 ZIP |
| `pnpm desktop:smoke:packed:arm64` | 通过 |
| `node scripts/packed-desktop-smoke.mjs --arch=arm64 --restore` | 通过；恢复 Board 与三个数据目录存在 |
| `pnpm desktop:make:x64` | 通过，生成最终 x64 DMG 与 ZIP |
| `pnpm desktop:smoke:packed:x64` | 通过 |
| `node scripts/packed-desktop-smoke.mjs --arch=x64 --restore` | 通过；恢复 Board 与三个数据目录存在 |
| `git diff --check` | 通过，exit 0 |

`2bc0979` 当次记录为 80 个测试文件、904 个用例；workspace 写锁和永久清除随后分别在
`16bcb94` 与 `978dcad` 加入。文档一致性复核在 `0f40601` 实现基线上重新运行完整门禁，
当前结果为 80 个测试文件、914 个用例。以上基线分开记录，避免用早期测试计数覆盖后续实现状态。

最终 packed `.app` 另做可见检查：已有 workspace 时，Mira 应用菜单显示`从 Mira 备份恢复…`；
点击后出现标题为`选择 Mira 备份`的 JSON 文件选择器，取消可回到主窗口。测试实例使用独立
userData 与 workspace，并已退出。

## 后续改进

1. 在目标 x64 Mac 上重跑对应 make、packed smoke 和可见窗口检查；本轮 x64 产物与 smoke 已在当前 arm64 主机完成交叉打包验证，仍需真实 x64 硬件做最终兼容性确认。
2. DSH/Cordis 若要获得同等跨进程锁保护，需要为 `fsService` 增加原子锁适配器；当前仍依赖宿主单写者约束。
3. 永久清除已交付为不可撤销操作；后续若要提供批量清除或保留期策略，需另行定义数据保留与审计契约。

当前 Desktop 仍是未签名、未公证、无自动更新的 macOS 13+ internal Alpha，不属于公开发布产物。
