# 2026-09-05 Card 与画布版本管理验证

- 日期：2026-09-05
- 分支：`codex/card-canvas-version-management-integration`
- 基线：`a262a67`
- 结论：实现、自动化、临时 workspace、Standalone 恢复与 arm64 packed smoke 通过；真实浏览器三档复验受本机安全校验阻断，保持待补

## 验证范围

本批保持 CardVersion 的线性不可变模型，并增加用户手动命名的 BoardCheckpoint。检查点只保存
稳定 Board，最多 20 个；恢复通过 BoardArtifact 全量 ID remap 创建新 active Board。Checkpoint
进入 MiraBackup V2，V1 恢复按零 Checkpoint 兼容。

同时完成三项边界减重：Run、workspace 灵感池和 Checkpoint 异步动作从 `src/v2Store.ts`
拆为独立 slice；MiraBackup 跨实体校验从 portable primitives 移入
`bridge/domain/workspace-backup.js`，消除 Checkpoint/BoardArtifact/portable-format ESM 导入环。

## 自动化证据

集成分支运行：

```sh
pnpm test
pnpm exec tsc --noEmit
pnpm build
pnpm build:bridge
git diff --check
```

结果：110 个测试文件、1225 条用例全部通过；TypeScript、前端生产构建、Bridge 构建和 diff
检查均通过。前端产物包含独立 `BoardHistory` chunk；最大 JavaScript chunk 仍低于 500 kB。

定向验证覆盖 Card 来源/差异/恢复确认、Checkpoint schema/store/service/routes、Board purge、
Run/Candidate 门禁、元数据 CAS、20 个上限、Board 副本 ID remap、MiraBackup V1/V2 校验、
256 MiB 上限、staging 故障注入、Store/API/UI 状态和移动端布局契约。独立审查后又补齐
Checkpoint 复合身份碰撞、线性批量恢复、artifact 根级敏感字段拒绝、非当前 Board 门禁、
Head ID/Markdown diff/Candidate 摘要、已提交 fork 的刷新失败与移动端固定命令区回归。
正文差异只在用户展开单张变化 Card 时计算，并以 128 KiB 与 25 万 LCS 单元为面板内上限；
超限内容保留导出查看入口，避免预览大画板时阻塞 renderer。

## 临时 Workspace

Standalone 使用独立 `/tmp/mira-checkpoint-browser.*` workspace 和端口 `56311`。真实 HTTP 流程
创建 1 个 Checkpoint，摘要返回 `cards: 0 / transformations: 0 / runs: 0`；从同一检查点创建的
副本获得新的 Board ID，原 Board 保持不变。随后下载的 MiraBackup 为 `formatVersion: 2`，包含
2 个 Board 和 1 个 Checkpoint。

该备份通过离线命令恢复到另一个全新临时目录：

```text
[mira] Restored 2 Board, 0 Runs, 0 WorkflowTemplates and 1 Checkpoints
```

## Desktop 产物

本机为 Apple Silicon，运行：

```sh
pnpm desktop:make:arm64
pnpm desktop:smoke:packed:arm64
```

成功生成 arm64 `.app`、DMG 与 ZIP；packed smoke 启动打包应用并验证 MiraBackup V2 恢复后的
Checkpoint 实体，结果为 `Packed Mira arm64 smoke passed`。当前产物仍未签名、未公证且没有
自动更新，只用于 internal Alpha。

## 浏览器限制

按要求尝试使用 in-app Browser 打开 `http://127.0.0.1:56311/graphmind/`。浏览器两次因
admin-enforced policy 校验不可用而拒绝 loopback 访问；未绕过该安全控制，也未改用间接浏览器
通道。因此本报告不声称 1440、1024、390px 的当次可见验收、焦点回返和 console 零错误已经
完成。自动化 SSR、CSS 契约和 packed smoke 只能证明实现与产物，不替代这项可见验收。

待环境恢复后，需要在同一集成提交补跑：`更多 -> 画布版本`、BoardManager 三生命周期入口、
20 项长列表滚动、保存/预览/重命名/删除/创建副本、Run/Candidate 处理入口、Esc/遮罩/焦点回返，
并分别记录 1440、1024 与 390px 的横向溢出和 console warning/error。
