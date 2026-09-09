# Mira Workflow 重构验收记录

- 日期：2026-08-23
- 服务：`http://127.0.0.1:56300/graphmind/`
- 验证性质：专家实机狗食、真实模型运行、直接 API 诊断与自动化回归
- 当前结论：Workflow 产品主线与实现契约已闭环，可进入外部用户研究；本文不等于目标用户验证

> 历史说明：本文记录 2026-08-23 当时的逐步执行交互。当前产品已改为用户在下游点击`运行到这里`，按依赖检查并只生成必要步骤；下列证据不作为现行交互规格。

## 1. 验证边界

本轮验证回答“当前实现是否按产品定义工作、是否有静默数据风险、核心路径是否真实可走通”。操作者熟悉产品与代码，任务没有采用盲测，也没有 5 名目标用户样本，因此不能回答入口是否对新用户自然可发现、产物是否长期有价值或用户是否愿意持续复用方法。

证据分为四类：

- `UI`：在 Codex 内置浏览器中按真实控件操作，不直接改 Zustand 状态。
- `RUN`：通过产品按钮启动真实模型 Run，并检查持久 Board/Run。
- `API`：只用于准备命名明确的技术验收画板和检查错误契约。
- `TEST`：领域、存储、HTTP、前端状态、SSR UX 与架构回归。

## 2. 总结

| 场景 | 结果 | 关键证据 |
| --- | --- | --- |
| 普通推进 | 通过 | 创建 1 Transformation + 1 空目标，零 Run，UI 明示“尚未生成” |
| 从成果提取方法 | 通过 | 浏览器从已完成三步路径保存 3 步 WorkflowTemplate，只含语义字段 |
| 三来源应用 | 通过 | 有序 3 来源铺出 3 卡 + 3 Transformation，应用时零 Run |
| 逐步执行 | 通过 | 3 步均由用户分别点击，4 次实际 Run 均 `succeeded/applied`，无下游自动运行 |
| Candidate 安全 | 通过 | 待比较结果可达；重跑、编辑、删除禁用；人工 Head 未改 |
| 模板生命周期 | 通过 | 二次确认删除；已有计划显示“模板已删除”且仍完整执行 |
| 响应式 | 通过 | 1440、1024、390px 无页面横向溢出或控件遮挡 |
| 遗留清理 | 通过 | v1 数据只读归档；生产源码、路由、bundle 无旧入口 |

## 3. 普通推进：创建关系不等于运行

验收画板：`board-34ogdqmt5s608d`（普通推进验收 · 2026-08-23）。

1. 在浏览器中 Shift 选择来源 `card-0dpbtgmt5s6gti`。
2. 在“把这些内容变成...”中输入“形成一页可讨论的问题定义”。
3. 点击“创建转化”。

结果：

- 创建 `transformation-8kmbprmt5s7e4o` 和空目标 `card-hohtntmt5s7e4o`。
- Board 为 2 Cards / 1 Transformation；目标 `headVersionId = null`。
- `lastRunId` 与 `lastAppliedRunId` 均不存在。
- 全局 Run 文件数保持 2，UI 显示“转化已创建，尚未生成”和“生成成果”。

这证明普通推进与 Workflow 应用使用同一契约：先创建可见计划，Run 必须由用户另行启动。

## 4. Workflow 提取与应用

### 4.1 从已验证路径保存方法

方法画板 `board-ataorsmt5rmlmg` 包含已有人类 Head 的线性路径：

`研究材料 -> 整理事实摘要 -> 形成判断 -> 写成一页简报`

浏览器打开第一条关系后，保存预览准确列出起始来源、3 个完整步骤、目标和完成标准，并明示“只保存方法，不复制当前内容”。保存得到：

- Workflow：`workflow-sujbx5mt5sm8f4`
- 标题：研究简报三步法 · 验收
- 步骤数：3
- 顶层字段仅 `id/title/description/steps/createdAt/updatedAt`

每一步只含 `id/label/instruction/acceptance`，没有 Card、Version、Run、坐标或当前正文。

### 4.2 三来源应用保持零 Run

应用画板：`board-biufv9mt5rmlok`。起始来源按以下顺序选择：

1. `card-7i8lv7mt5rmlor`：新课题访谈
2. `card-ljx4r5mt5rmloz`：新课题约束
3. `card-0a0ewjmt5rmlp6`：新课题标准

应用预览展示了三张来源及各自 `v1`、三个完整步骤，并明确“将创建 3 张目标卡和 3 条转化关系；不会开始任何运行”。确认后：

- applicationId：`workflow-application-fpjddmmt5ry7wx`
- Board 从 3 Cards / 0 Transformations 变为 6 Cards / 3 Transformations。
- 三个空目标最初均无 Head；Run 文件数仍为 2。
- 第一步显示“生成这一步”；第二步显示“先完成上一步”；第三步保持等待。
- 三条 Transformation 的 `workflowRef` 共享 applicationId，并分别记录 1/3、2/3、3/3。

## 5. 真实三步执行

模板删除后，旧计划仍显示完整 1/3 导航和“模板已删除，已有计划仍可逐步执行”。随后通过浏览器分别点击每一步：

| 步骤 | Transformation | Run | 结果 |
| --- | --- | --- | --- |
| 整理事实摘要 | `transformation-m0wv35mt5ry7wx` | `run-pz91w2mt5so3s3` | `succeeded/applied`，479 字 |
| 形成判断 | `transformation-x88bfmmt5ry7wx` | `run-rc3zpumt5stym1` | `succeeded/applied`，257 字 |
| 写成一页简报（首次） | `transformation-rcl5x8mt5ry7wx` | `run-ihqp9hmt5swmm3` | `succeeded/applied`，881 字 |
| 写成一页简报（提示修正后复验） | 同上 | `run-h4jjoqmt5tb6ut` | `succeeded/applied`，610 字 |

每一步完成后只解锁下一步，没有创建下一步 Run。最终 Board 仍为 6 Cards / 3 Transformations；前三步的 `lastAppliedRunId` 都指向实际采用 Run。

首次末步输出包含“本会话只有 report 工具、无法落盘”等内部执行说明。该问题先通过真实运行复现，再增加失败测试并收紧模型提示：只返回可写入卡片的正文，不提 agent、会话、工具、report、文件写入或上级代理。复验输出从 `# 课题可行性判断简报` 开始，610 字中不含上述内部术语。

目标卡 `card-scv0x9mt5ry7wx` 保留两个 AI Version：旧问题版本为 `v1`，清理后的最新版本为 `v2`。修正没有覆盖或删除历史。

## 6. Candidate 与版本安全

现有安全课题位于 `board-uvkfhfmt57n6pp`：

- Transformation：`transformation-vb1yormt57ub8u`
- 最近待比较 Run：`run-0s9dgpmt57yhft`
- 最近已采用 Run：`run-3g47e9mt57ub93`
- 人工 Head 保留唯一标记：`[人工决策-不可丢] 暂定名称：回声`

实机结果：

- 关系详情显示“先采用或丢弃待比较结果，再修改、删除或重新生成”。
- “编辑方法”“删除转化”“先处理待比较结果”均禁用。
- “比较待处理结果”始终可达，并同时展示当前版本与生成结果。
- 本轮没有点击采用或丢弃，人工 Head 与 Candidate 均保持原样。

自动化进一步覆盖 Candidate pending 对 start/update/delete 的 409 门禁、决策后解除、两阶段持久化、启动对账、`lastAppliedRunId`、有序来源 stale、PATCH revision CAS 与损坏 Run fail closed。

## 7. 模板生命周期

原模板 `workflow-o6gzkqmt5rmlob` 在流程库中经过“删除模板？”二次确认删除。UI 明确提示“不影响已有计划”。删除后：

- 流程库为空，不再伪装模板存在。
- 已应用计划仍保留 3 条 Transformation、applicationId 和步骤导航。
- 关系详情显示“模板已删除”，三步随后全部运行成功。
- 完成验证后，从方法画板重新保存了独立模板 `workflow-sujbx5mt5sm8f4`；旧计划仍如实指向已删除的原模板。

## 8. 响应式与浏览器运行

| 视口 | 实测结果 |
| --- | --- |
| 1440 x 900 | Canvas 1080px + Drawer 360px 并排；document scrollWidth = 1440 |
| 1024 x 768 | Drawer 360px 覆盖式展示，画布仍可操作；document scrollWidth = 1024 |
| 390 x 844 | Drawer 390px 宽底部面板；document scrollWidth = 390；无标题或按钮裁切 |

390px 初测发现三来源条为 688px 横向滚动区，只露出前两张。增加响应式回归后，来源条改为单列：三张卡分别为 374px 宽，容器 scrollWidth 回到 390，标题与排序/删除命令全部可见。浏览器控制台最终无 warning/error。

## 9. API、存储与清理

运行中服务的直接诊断：

| 请求 | 结果 |
| --- | --- |
| `GET /boards/board-missing-validation` | 404 `BOARD_NOT_FOUND` |
| `GET /runs/run-missing-validation` | 404 `RUN_NOT_FOUND` |
| `GET /workflows/workflow-missing-validation` | 404 `WORKFLOW_NOT_FOUND` |
| `GET /workflows` | 200，返回当前 1 个模板 |

旧 DSH 实例曾加载过期 bundle，错误返回 404 Workflow 和 400 missing Board；本轮停掉旧实例、重建 bridge，并修复 runtime FS adapter 对 definite ENOENT 的识别。真实 I/O 错误仍 fail closed，不会被误报成不存在。

旧数据已只读归档：12 个 v1 Boards、48 个 v1 Runs，位置为 `archive/2026-08-23-vnext-rebaseline/data/`。生产运行时只扫描 `boards-v2/`、`runs-v2/` 和 `workflows-v2/`。

## 10. 工程证据

- `pnpm test`：26 个文件，260 项全部通过。
- `pnpm exec tsc --noEmit --pretty false`：通过。
- `pnpm build`：通过；CSS 51.79 kB，JS 511.60 kB（gzip 161.88 kB）。
- `pnpm build:bridge`：通过；`dist-bridge/bridge.cordis.js` 107235 字符。
- `git diff --check`：通过。
- 生产 bundle 扫描未发现 LegacyApp、Action runtime、chain runner、legacy adapter、waiting_confirmation 或 verify-export。

## 11. 剩余边界

1. 尚未完成至少 5 名目标用户的无教学任务，因此“新用户是否自然理解并愿意复用 Workflow”仍是下一阶段产品验证，而非本轮已证明事实。
2. 当前持久化锁只覆盖单个 bridge 进程。同一 workspace 必须保持一个可写 bridge；跨进程文件锁或持久 revision CAS 尚未实现。
3. 前端主 JS 超过 Vite 默认 500 kB 警告线，功能不受影响，但后续应按路由/抽屉拆包。
4. Candidate 的采用/丢弃、fan-out/merge/cycle、结构并发与启动恢复由自动化覆盖；本轮浏览器只验证 Candidate 可达与门禁，没有改变现有候选。

## 12. 最终判断

当前实现已经满足本轮产品定义：只有一套画板心智；Card 默认显示最新 Head；用户选择材料并明确创建下一份成果；Workflow 从走通过的方法提取，应用只铺计划；每一步由用户启动；分支只通过用户手动画图产生；人工版本与 Candidate 不会被静默覆盖。

工程与专家实机验收已完成。下一步应转向外部用户验证，而不是继续增加第二套模式或自动 run-all。
