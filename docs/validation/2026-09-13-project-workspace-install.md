# 项目工作区主干合入、实际迁移与本机安装

2026-09-13，Asia/Shanghai。用户明确授权“合入 main，迁移工作区，构建替换本地应用，更新文档”。单 Agent 顺序执行，复用现有迁移、恢复、打包和桌面状态写入能力，没有新增生产行为。`verification-before-completion` 的新鲜证据门槛用于控制合入和安装顺序。

## 主干与工程验证

`main` 从 `b5cb2a9` 快进到 `95a8e8c`，无合并冲突。功能边界与先前 UI 证据见[实现验证](2026-09-13-project-workspace.md)。合入后在 main 工作树运行：

- `pnpm test`：160 files / 1634 tests passed；仍有 Node localStorage ExperimentalWarning，与 renderer console 分开记录。
- `pnpm exec tsc --noEmit`、`pnpm build`、`pnpm build:bridge`、`git diff --check`：通过。
- `pnpm desktop:make:arm64`：生成 main 的 `.app`、DMG、ZIP。
- `pnpm desktop:smoke:packed:arm64`：包内启动、材料/PDF 文字及原页渲染、Backup V3 检查通过。
- `node scripts/packed-desktop-smoke.mjs --arch=arm64 --restore`：恢复 smoke 通过。

没有推送远端、启动四平台 CI 或正式发布。同期另一需求草案对文档地图/TODO 的改动保留，未混入本次提交。

## 实际工作区迁移

原 workspace 为本机 `Projects/MiraWorkSpace`。迁移前检查原生窗口，无正文编辑草稿；持久数据无 queued/running Run、无 Candidate、无文件绑定。正常退出旧应用并确认写锁释放后，在权限 0700 的私有升级目录保存完整旧 workspace、正式 MiraBackup V3、桌面路径/窗口状态及旧应用。

执行现有 `pnpm migrate:workspace -- --source <旧目录> --target <同级 MiraWorkSpace-project>`。目标此前不存在，父目录已存在；成功后新项目内部数据位于 `.mira/`，材料目录为 `materials/`，获得独立稳定 workspace 身份。原工作区路径与数据均保留。

| 对象 | 迁移前 | 迁移后 |
| --- | --- | --- |
| Board | 2 | 2 |
| Card | 14 | 14 |
| CardVersion | 13 | 13 |
| Run | 2 | 2 |
| 灵感条目 | 1 | 1 |
| Workflow / Checkpoint / 已收纳原件 | 0 / 0 / 0 | 0 / 0 / 0 |

源目录 5 个持久数据文件的 SHA-256 在迁移与安装验收后完全一致。源与目标分别由正式 backup service 在写锁保护下导出，去除导出时间后逐字段深比较一致；没有把数量相同当作内容相同的替代。

迁移前已有 5 个缺失文件引用，分别指向产品定义、核心规格、架构图、体验设计和实施路线的 `docs/` 路径。旧 workspace 中不存在对应文件，迁移原样保留依赖，没有把仓库当前文档冒充历史原件。材料库目前为空是实际数据状态；后续需用户确认来源后重新导入。

## 应用替换与原生验收

环境为 macOS 26.3.1 (a)、Apple Silicon arm64、Node 26.7、pnpm 9。旧版、新版均显示 `0.1.0-beta.2`，以实际 `app.asar` SHA-256 区分：

- 升级前：`e202fe2d59ed0709be46e4f9da60459bb1fe078935622bac1cfbfd883ec99f05`。
- 本次 main 包与安装后：`929ff47018d2b2e7a741db929c7ba7a549e47ab88fb09f45b132a13fc85de4ce`。

先将新包暂存到 `/Applications/` 的独立路径并全目录比对，再把旧应用移入私有回退目录，将暂存新包 rename 为 `/Applications/Mira.app`。通过既有 `writeDesktopState` 原子更新所选 workspace，保留其他桌面状态，不改模型配置。替换过程准备了失败时恢复旧应用与旧路径的补偿步骤。

安装版实际启动迁移后的工作区，核对新目录写锁持有者就是安装版进程。原生窗口检查现有画板、材料入口、材料库空态、键盘 Tab 焦点与 1440px 宽度下无横向溢出；窗口移回当前屏幕可见区域。只读 application-info 返回 Desktop / darwin / arm64。renderer 重载及交互采集的 pageerror、console warning/error 为零；含真实用户内容的截图仅保留在本机私有回退目录。

由安装版的“备份 Mira 数据”触发原生保存面板，核对目标目录和文件名后保存。最初浏览器自动化等待 download 事件超时，因文件仍停在 Electron 原生保存面板；按 `systematic-debugging` 核对窗口层后完成保存。这是验收工具的等待方式差异，没有修改下载代码或伪报首次下载成功。

实际导出的 Backup V3 通过严格校验，并与迁移前正式备份逐字段一致。通过离线恢复工具恢复到私有目录中的全新副本，由新 Node Host 核对全部原对象，再只在副本新建验收画板/卡片；关闭和重启后同一 Head 与正文仍存在。正式新、旧 workspace 中没有写入测试卡片或启动模型。

交互结束正常退出安装版，再次核对源摘要和目标可移植数据一致；随后以正常方式启动 `/Applications/Mira.app`，不保留验收用调试端口，当前应用留给用户使用。

## 回退与剩余边界

私有回执位于本机 `Projects/Mira-backups/project-workspace-upgrade-WZdOYi/`，包含 `installation-receipt.json`、`before.json`、`migration-verification.json`、升级前 workspace/备份、旧 `.app`、安装版导出备份及恢复副本。旧原应用为其中的 `Mira-original.app`，另有安装前核对用副本；原 `MiraWorkSpace` 完整保留。

需要回退时：先保存并退出当前 Mira，保留新 `MiraWorkSpace-project`；恢复旧 `.app`，明确选择旧 `MiraWorkSpace` 或升级前备份恢复出的新目录。旧应用不能直接指向新版 `.mira/` 工作区，不能用覆盖新工作区的方式回退。完整操作边界见[桌面发行规程](../operations/desktop-release.md)。

本批交付为本机未签名 arm64 内部应用。远端推送/构建、Windows、真实 Intel Mac、触屏、正式签名和公证仍未执行；既有模型质量与真实使用反馈 TODO 保留。README、产品和用户手册的工作区机制已由实现提交同步，本次更新交付状态、原生保存证据、缺失依赖和回退说明。
