# 项目工作区交付记录

2026-09-13：用户确认项目与 Mira 共同工作、导入材料自动复制，以及“材料共用、卡片独立”的跨画布/跨 workspace 复用。权威契约见[项目工作区规格](../specs/project-workspace.md)。

执行拓扑：单 Agent，`codex/project-workspace`，`.worktrees/project-workspace`，base `b5cb2a9`。原 main 与已安装应用保持可用；不迁移实际用户数据、不推送或发布。现有数据库/Store/Run/Candidate/文件绑定优先复用。

- [x] 隔离工作树与基线：155 files / 1609 tests passed。
- [x] 产品、规格、体验、兼容与迁移契约同步。
- [x] 新项目 `.mira/` 布局、稳定身份、旧布局兼容与显式迁移。
- [x] 原件收纳、完整性、共享材料库及文件/PDF/网页接入。
- [x] 受管资产随 Board/Checkpoint/完整备份可移植；事务与恢复。
- [x] 所选卡片跨工作区复用、复制出处、独立编辑。
- [x] 浏览器、原生打包、完整工程验证、文档/TODO 更新。

以上勾选以[2026-09-13 验证报告](../validation/2026-09-13-project-workspace.md)为证据，只代表安全本地交付；用户真实项目验收、实际数据迁移、主干/远端与安装版更新单列[统一 TODO](evolution-todo.md)。

已知门禁：旧版备份仍有效；新原件携带必须升级格式。受管数据与项目普通文件有不同写入规则，不能为路径重排复制领域实现。跨文件失败/重启必须测试，不把补偿式内存回滚当成持久事务。真实 Windows/Intel/触屏与正式签名仍按原 TODO 独立验收。
