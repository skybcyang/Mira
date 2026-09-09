# Mira Card 与画布版本管理详细设计 TODO

- 状态：实现、当前主线集成与交付验收完成
- 日期：2026-09-04
- 范围：CardVersion 体验收口、BoardCheckpoint V1、备份与恢复边界
- 依据：[产品定义](../product/product-definition.md)、[核心规格](../specs/core-specification.md)、[体验设计](../design/experience-design.md)、[UI 系统](../design/ui-system.md)、[系统图](../architecture/system-map.md)

本文描述已确认方案和实施顺序。2026-09-05 设计者接受 D1–D5 的建议默认；生效规则已同步到
产品定义、核心规格、体验设计和 UI 系统，后续实现以这些权威文档为准。

## 1. 一句话方案

Card 继续使用现有的线性不可变 `CardVersion`；整个画布新增用户手动保存的命名检查点
`BoardCheckpoint`。从检查点恢复时创建一个全新 active Board 副本，当前 Board 永不被覆盖。

```text
单张 Card 正文历史  -> CardVersion
当前会话撤销/重做   -> CanvasHistory
并发写入校验        -> Board.revision
整个画布里程碑      -> BoardCheckpoint
整库灾难恢复        -> MiraBackup
```

这五种机制各自解决一个问题，不合并为“万能历史”。

## 2. 决策门

以下产品决策已于 2026-09-05 确认。

| ID | 决策 | 确认结果 | 原因 |
| --- | --- | --- | --- |
| `D1` | 画布恢复方式 | 只创建新 Board 副本 | 不覆盖当前工作，不需要复活旧 ID，也不会破坏 Run/Candidate 出处 |
| `D2` | 检查点创建时机 | 只允许用户手动保存 | 自动按每次编辑保存会放大存储、噪声和心智负担 |
| `D3` | 活动状态门禁 | active Run 或未处理 Candidate 时禁止保存 | 检查点必须是稳定、可解释、可再次打开的成果状态 |
| `D4` | 首版保留上限 | 每个 Board 20 个，不静默淘汰 | 限制完整快照成本；满额时由用户明确删除 |
| `D5` | 备份范围 | Checkpoint 与功能同批进入 MiraBackup | 用户可见的持久版本不能成为备份盲区 |

以上确认结果作为实现输入。若未来将 `D1` 改为“原地回滚”，必须重新设计
对象复活、Head、Run、Candidate、文件绑定与多窗口并发，本 TODO 不能直接实施。

## 3. 目标与非目标

### 3.1 目标

- 用户能理解某张 Card 为什么是当前内容，并安全恢复任一旧正文。
- 用户能在关键里程碑手动保存整个 Board 的稳定状态。
- 用户能预览和比较检查点，再从中创建独立副本继续工作。
- Checkpoint 的存储、清除、导出和备份都 fail closed，不出现半写或静默丢失。
- Desktop、Compact 和 390px 均能到达同一套命令且不遮挡画布主流程。

### 3.2 首版不做

- 不做 Git 式分支、合并、rebase、冲突编辑器或版本树。
- 不为每次移动、输入或 Run 自动创建持久快照。
- 不把 `CardVersion` 从 Board 聚合拆到独立存储，也不迁移现有 Card 历史。
- 不提供覆盖当前 Board 的原地回滚，不把 CanvasHistory 持久化。
- 不做增量、差分或内容寻址快照；先复用已验证的 BoardArtifact 投影与 ID remap。

## 4. Card 版本详细设计

### 4.1 保持现有领域模型

`CardVersion` 继续是 Card 内不可变、严格递增的线性正文历史。画布只显示 `headVersionId` 指向
的 Version。恢复旧版复制旧内容并追加新的 `origin: restore` Version，不移动 Head 到旧对象。

| 用户动作 | 是否创建 Version | `origin` | 必须保留的出处 |
| --- | --- | --- | --- |
| 保存 Markdown 正文 | 是 | `human` | 提交时的 `baseVersionId` |
| AI 结果直接采用 | 是 | `ai` | `sourceRunId` |
| 采用 Candidate | 是 | `ai` | `sourceRunId` 与采用时 Head CAS |
| 恢复历史正文 | 是 | `restore` | `restoredFromVersionId` |
| 导入 BoardArtifact | 保留并重映射历史 | `import` 或原始合法来源 | 包内闭合引用或 opaque 出处 |
| 移动、缩放、标签或文件绑定变化 | 否 | - | 这些是 Card/Canvas 元数据，不是正文 |

正文 undo/redo 仍通过普通 Version API 追加新 Version。它属于当前页面 `CanvasHistory`，切换
Board 或刷新后清空；CardVersion 本身不会因此被删除。

### 4.2 Version 面板

首版沿用 `DetailDrawer` 的`版本`页签，不增加独立页面。

- 顶部固定显示当前版本，例如`当前 v7`，并提供返回正文的页签。
- 历史按新到旧排列，每行显示 `vN`、来源、时间和当前标记；不把每条历史做成 Card。
- 选中一个历史版本后，与当前 Head 做 Markdown diff；file-reference 只比较引用路径和只读状态。
- 主命令为`恢复为最新版本`，确认区说明会创建 `vN+1`，旧版本不变。
- 保存或恢复产生文件同步冲突时保留新 Version，并回到内容页的文件冲突处理区。

首版只支持“所选历史 vs 当前 Head”，不支持任意两个历史版本互比。需要任意两版比较时，
再增加双选择状态，不改变领域模型或 API。

### 4.3 Card 版本错误与并发

| 场景 | 结果 |
| --- | --- |
| 提交时 Head 已变化 | 返回现有 Version 冲突；保留编辑草稿并刷新当前 Head |
| 历史 Version 不存在 | 返回 `VERSION_NOT_FOUND`；Board 零写入 |
| archived/trashed Board | 返回 `BOARD_READ_ONLY`；不创建 Version |
| fileBinding 外部文件变化 | Version 保留，文件不覆盖，显示 `FILE_SYNC_CONFLICT` |
| Version 列表或 Head 损坏 | Board 校验失败，禁止恢复；不猜测最近一项 |

## 5. 画布版本详细设计

### 5.1 用户语言与内部对象

用户界面统一称`画布版本`和`保存画布版本`。内部对象命名为 `BoardCheckpoint`，避免与
`Board.revision` 混淆。Checkpoint 是命名里程碑，不是编辑日志，也不是新的 Board 类型。

### 5.2 持久对象

```ts
interface BoardCheckpointV1 {
  schemaVersion: 1
  id: string
  boardId: string
  title: string
  note?: string
  baseBoardRevision: number
  artifact: BoardArtifactV1
  createdAt: string
  metadataUpdatedAt: string
}

interface BoardCheckpointSummary {
  id: string
  boardId: string
  title: string
  note?: string
  baseBoardRevision: number
  counts: { cards: number; transformations: number; runs: number }
  createdAt: string
  metadataUpdatedAt: string
}
```

约束如下：

- `id` 全 workspace 唯一；`boardId` 必须等于 `artifact.board.id`。
- `title` trim 后 `1..80` 字符；`note` 可选，trim 后最多 240 字符。
- `baseBoardRevision` 必须等于快照 Board 的 revision；它只用于解释和 CAS，不显示为版本号。
- `artifact` 创建后不可修改；重命名或修改备注只改变顶层元数据和 `metadataUpdatedAt`。
- `artifact` 使用现有 BoardArtifact 严格校验、规模限制和敏感数据排除规则。

不使用连续 `v1/v2` 给 Checkpoint 编号。用户删除版本后，维护永不复用的连续编号需要新增
索引或 tombstone，而名称与时间已经能稳定定位里程碑。Card 的 `vN` 仍保持不变。

### 5.3 快照包含与排除

| 包含 | 排除 |
| --- | --- |
| Board 标题、Card、全部 CardVersion、Head、坐标、尺寸与 viewport | API Key、模型设置、runtime session、日志 |
| Transformation、来源顺序、目标、位置、Plan/Workflow 轻量出处 | CanvasHistory、内部剪贴板、PlanDraft、未保存正文 |
| 截止保存时该 Board 的全部终态 Run 与公开进度事件 | queued/running Run、reasoning、Prompt、工具正文 |
| 被当前结构引用且仍存在的 Workflow provenance 快照 | 向全局 WorkflowStore 安装或覆盖方法 |
| file-reference 路径清单与合法包外 opaque 出处 | 文件正文、Markdown `fileBinding` 和外部文件写入能力 |

Checkpoint 内嵌经过净化的 `BoardArtifactV1`，而不是重新定义另一套对象图。这样可以直接复用
现有验证、敏感字段剥离、当前结构闭合检查和全量 ID remap。Checkpoint 不是可下载格式；下载
时从其 artifact 生成普通 `.mira-board.json`。

### 5.4 创建算法

```text
客户端提交 title、note、baseRevision
  -> 进入现有 Board lifecycle lock
  -> 重读 Board lifecycle 与 revision
  -> 严格读取该 Board 的全部 Run
  -> 拒绝 active Run 或未处理 Candidate
  -> 生成并验证 BoardArtifact
  -> 原子写入 BoardCheckpoint 文件
  -> 返回轻量 CheckpointSummary
```

创建 Checkpoint 不修改工作 Board，因此不增加 `Board.revision`。锁内读取必须产生一个一致的
Board/Run 边界；并发 Board 写入只能发生在快照之前或之后，不能混入同一个 Checkpoint。
Checkpoint 写入失败时，Board、Run 和可见 Checkpoint 列表均保持不变。

### 5.5 查看与比较

画布版本面板默认只读取轻量摘要，选中时才读取完整 Checkpoint。

| 比较项 | 判定 |
| --- | --- |
| Card 新增/删除 | 用同一 Board 谱系中的稳定 Card ID 比较 |
| 正文变化 | 比较 Head Version ID 与 digest；显示当前 Head 的 Markdown diff |
| 布局变化 | 比较 `x/y/width/height`；只汇总数量，预览中直接展示位置 |
| 结构变化 | 比较 Transformation ID、来源顺序、目标与可编辑字段 |
| 运行变化 | 只显示“新增 N 次运行/产生 N 个待处理结果”的摘要，不做日志逐行 diff |

首版只比较“一个 Checkpoint vs 当前 Board”。检查点之间任意比较、逐像素位移清单和 Run 事件
diff 延后；这些能力可以在已有纯 diff 投影上增加，不影响存储格式。

### 5.6 从检查点创建副本

`从这个版本创建副本`复用 BoardArtifact 导入的 staging、完整 ID remap 和原子提交：

- 为 Board、Card、Version、Transformation、Run、plan/application 生成全新身份。
- 合法历史缺失、灵感和方法出处继续映射为不绑定本地对象的 opaque ID。
- 新 Board 固定为 `active`、`revision: 0`，标题默认为`原标题 - 版本副本`，可在确认时修改。
- 新副本不继承原 Board 的 Checkpoint 列表，也不恢复 Markdown `fileBinding`。
- 原 Board、其 Head、生命周期、Run、Candidate 和 Checkpoint 均零写入。

复制成功后关闭版本面板，切换到新 Board，并显示`已从“检查点名”创建画板副本`。失败时仍停留
在原 Board，保留所选 Checkpoint 和拟用标题。

### 5.7 元数据修改、删除与生命周期

| 命令 | active | archived | trashed | 规则 |
| --- | --- | --- | --- | --- |
| 创建 Checkpoint | 允许 | 禁止 | 禁止 | 必须携带当前 `baseRevision` |
| 重命名/修改备注 | 允许 | 允许 | 允许 | 使用 `baseMetadataUpdatedAt` 做 CAS，artifact 不变 |
| 创建 Board 副本 | 允许 | 允许 | 允许 | 新对象始终 active，原对象不变 |
| 删除 Checkpoint | 允许 | 允许 | 允许 | 行内二次确认；不可撤销，不进入 CanvasHistory |
| 永久清除 Board | - | - | 允许 | 与该 Board 的 Run、Checkpoint 一起原子移除 |

归档和移入废纸篓不删除 Checkpoint。普通 Board 切换仍不显示 archived/trashed Board；用户从
BoardManager 进入其画布版本列表，只能预览、导出、创建副本或删除 Checkpoint。

### 5.8 数量、体积与保留

- 每个 Board 最多 20 个 Checkpoint；达到上限返回 `CHECKPOINT_LIMIT`，不自动删最旧版本。
- 单个 artifact 沿用 BoardArtifact 的对象数量与 64 MiB UTF-8 JSON 上限。
- Checkpoint 列表只返回摘要和统计，不在首次打开时传输完整 artifact。
- MiraBackup 继续使用 256 MiB 总上限；包含 Checkpoint 后超限必须在备份前明确失败。
- 不做增量压缩；真实 workspace 证明完整快照过慢或过大后，再设计内容寻址存储。

## 6. Store、API 与错误契约

### 6.1 Bridge 存储

新增 `bridge/board-checkpoint-store.js`，默认根目录 `board-checkpoints-v1/`。每个 Checkpoint
使用 Board ID 与 Checkpoint ID 的规范 UTF-8 编码生成单射文件名，路径 helper 必须拒绝 `/`、
`..` 和不安全 ID，并避免大小写不敏感或 Unicode 归一化文件系统上的身份碰撞；按 Board
列举时先用精确的编码后 Board ID 前缀过滤文件名，再读取和严格校验。文件使用临时写、严格重读和
原子 replace；Store 接入现有
`StorageCoordinator`，Board 操作复用 `withBoard` lease。

第一版接口保持窄小：

```ts
listSummaries(boardId): Promise<BoardCheckpointSummary[]>
load(boardId, checkpointId): Promise<BoardCheckpointV1>
save(checkpoint, boardLease): Promise<BoardCheckpointV1>
updateMetadata(boardId, checkpointId, change, boardLease): Promise<BoardCheckpointV1>
pathsForBoard(boardId): Promise<string[]>
```

新增 `bridge/board-checkpoint-service.js` 负责一致快照、Run/Candidate 门禁、元数据 CAS、删除、
导出和创建副本；Store 不拥有产品决策。删除单个 Checkpoint 由 service 在 Board lock 内执行
原子文件删除；永久清除复用现有
`removeFilesAtomically`，把 `pathsForBoard` 返回值并入 Board 与 Run 文件集合。不存在独立索引；
文件名前缀与 20 个/Board 的上限足以先使用目录扫描，只有测得列表延迟后才增加索引。

### 6.2 HTTP API

```ts
interface CreateBoardCheckpointRequest {
  title: string
  note?: string
  baseRevision: number
}

interface UpdateBoardCheckpointRequest {
  title?: string
  note?: string | null
  baseMetadataUpdatedAt: string
}

interface ForkBoardCheckpointRequest { title?: string }
```

| Method | Path | 作用 |
| --- | --- | --- |
| `GET` | `/boards/:boardId/checkpoints` | 返回按创建时间倒序的摘要 |
| `POST` | `/boards/:boardId/checkpoints` | 以 `baseRevision` 保存命名检查点 |
| `GET` | `/boards/:boardId/checkpoints/:checkpointId` | 返回完整检查点供预览/比较 |
| `PATCH` | `/boards/:boardId/checkpoints/:checkpointId` | CAS 更新 title/note，不改 artifact |
| `DELETE` | `/boards/:boardId/checkpoints/:checkpointId` | 需 `confirmation: 'delete-checkpoint'` |
| `POST` | `/boards/:boardId/checkpoints/:checkpointId/forks` | 通过 ID remap 创建新 Board 副本 |
| `GET` | `/boards/:boardId/checkpoints/:checkpointId/export` | 下载普通 BoardArtifact |

不新增服务端 compare endpoint。客户端已有当前 Board，只需在加载单个 Checkpoint 后运行纯 diff
投影，能减少一个 API 和一套缓存失效规则。

### 6.3 错误码

| 错误码 | HTTP | 含义与零写入要求 |
| --- | --- | --- |
| `CHECKPOINT_NOT_FOUND` | 404 | Board 或 Checkpoint 不匹配；不允许只按全局 ID 越权读取 |
| `CHECKPOINT_INVALID` | 422 | schema、内部 artifact、标题或备注不合法 |
| `CHECKPOINT_LIMIT` | 409 | 已达到 20 个；不自动清理 |
| `CHECKPOINT_TOO_LARGE` | 413 | artifact 超过现有 BoardArtifact 限制 |
| `CHECKPOINT_CONFLICT` | 409 | Board revision 或 Checkpoint 元数据 CAS 已变化 |
| `TARGET_BUSY` | 409 | 存在 queued/running Run；不创建 Checkpoint |
| `CANDIDATE_PENDING` | 409 | 存在未处理 Candidate；不创建 Checkpoint |
| `CHECKPOINT_WRITE_FAILED` | 500 | 临时写、重读或 replace 失败；可见列表零半写 |

archived/trashed 创建请求沿用 `BOARD_READ_ONLY`。副本导入阶段的碰撞、校验和提交错误沿用现有
`BOARD_IMPORT_*`，不再创造同义错误。

## 7. 前端状态与 UI

### 7.1 入口与布局

App bar 不增加常驻文字按钮。Desktop/Compact/Mobile 都从`更多 -> 画布版本`进入独立延迟加载
面板；BoardManager 的每个 Board 行增加 `History` 图标入口，方便查看非 active Board。

- Desktop `>=1100px`：360px 右侧面板，Canvas 重算可用宽度并保持当前对象可见。
- Compact：覆盖式右侧面板，不改变 React Flow 尺寸或 body 宽度。
- Mobile `<720px`：全屏 sheet，列表、预览和确认按同一层级切换，不嵌套 modal。
- 保存、删除和创建副本使用固定底部命令区；长标题换行，触控命中至少 44px。
- 所有 icon-only 命令使用 Lucide `History`、`Save`、`CopyPlus`、`Download`、`Trash2` 并有 tooltip 与 accessible name。

### 7.2 面板状态

```text
list -> save-form
list -> preview -> compare
list -> preview -> fork-confirm
list -> rename-confirm | delete-confirm
```

同一时刻只显示一个主任务。保存表单只收集名称和可选备注；预览是只读 Canvas，不挂载编辑、
连接、运行或文件绑定命令。关闭后焦点回到触发按钮。

### 7.3 列表与预览文案

摘要行显示名称、保存时间、Card/步骤/Run 数量和备注首行。首版不显示 `r42` 之类内部 revision
标签，避免用户误以为每次编辑都有可恢复版本。

| 场景 | 主文案 | 主命令 |
| --- | --- | --- |
| 空列表 | `还没有保存画布版本` | `保存当前版本` |
| 稳定 active Board | `保存当前画布状态，之后可从副本继续` | `保存画布版本` |
| active Run | `生成结束或停止后才能保存稳定版本` | `查看运行` |
| pending Candidate | `先采用或丢弃待比较结果` | `比较待处理结果` |
| 预览 | `这是只读版本，不会改变当前画布` | `从这个版本创建副本` |

## 8. 备份、导出与恢复

BoardArtifact 格式不增加 Checkpoint 数组。导出一个 Checkpoint 时，直接下载其中已验证的
artifact；导入仍只创建一个新 Board，不把来源 workspace 的 Checkpoint 一并复制。

MiraBackup 需要升级为 `MiraBackupV2`，保留 V1 的字段并增加：

```ts
interface MiraBackupV2 {
  format: 'mira-backup'
  formatVersion: 2
  boards: BoardV2[]
  runs: TransformationRun[]
  workflows: WorkflowTemplate[]
  inspirationPool?: InspirationPool
  checkpoints: BoardCheckpointV1[]
  exportedAt: string
}
```

恢复规则：

- 旧 `MiraBackupV1` 继续可恢复，按零 Checkpoint 处理，不回填历史。
- 新格式严格校验 Checkpoint ID 唯一、boardId 恰好对应包内 Board、artifact 与基线一致。
- restore staging 写入 Board、Run、Workflow、InspirationPool 与 Checkpoint 后严格重读实体集合。
- 最终仍只通过一次 workspace 根目录 rename 提交，不提供运行中 workspace 覆盖恢复。
- 备份不包含 fileBinding、引用文件正文、秘密配置、CanvasHistory 或运行时会话。

这是 Checkpoint 上线的同批必做项；不能先让用户创建版本，再在完整备份中遗漏它们。

## 9. 实施拓扑与文件所有权

依赖必须从稳定内层向外推进：

```text
产品/规格确认
  -> checkpoint schema + diff 纯函数
  -> checkpoint store + lifecycle/portable/backup service
  -> HTTP routes + API client + Zustand slice
  -> Version/Checkpoint UI
  -> Desktop/Standalone 备份恢复与真实验收
```

共享热点在同一批只能有一个 writer：`docs/product/product-definition.md`、
`docs/specs/core-specification.md`、`src/domain/`、`bridge/domain/portable-format.js`、
`bridge/mira-application.js`、`bridge/v2-http.js`、`bridge/v2-routes.js`、`src/v2Store.ts`、
`App.tsx` 和 `src/styles.css`。

建议使用一个 `codex/card-canvas-version-management-integration` 集成分支。只有纯 diff、Checkpoint
Store 和 UI feature 能按独立验收切片时才建立短期依赖分支；上层分支必须以已确认的下层
commit 为 base，不让多个 Agent 并行解释产品语义。

## 10. TODO

### Phase 0：确认产品结果，0.5 天

- [x] 确认 `D1..D5`，尤其是“恢复只创建副本”和“每 Board 20 个”。
- [x] 更新产品定义中的历史/恢复边界与非目标。
- [x] 更新核心规格的对象、状态、原子性、API、错误码与验收矩阵。
- [x] 更新体验设计和 UI 系统的入口、文案、响应式与无障碍规则。
- [x] 在实施路线登记切片、依赖顺序、共享热点 owner 和验证命令。

退出条件：四份权威文档使用 `CardVersion / CanvasHistory / BoardCheckpoint / Board.revision /
MiraBackup` 的同一术语与边界。

### Phase 1：Card 版本体验收口，0.5–1 天

- [x] 为 Version 行映射、来源文案、当前标记和恢复确认先写失败测试。
- [x] 把版本列表/对比的纯投影从 `DetailDrawer.tsx` 移到可测试 helper。
- [x] 补齐 human、ai、restore、import 的来源显示和 Markdown diff 空状态。
- [x] 恢复确认明确显示将创建的新版本号，并保留冲突后的当前选择。
- [x] 回归 fileBinding 冲突、Candidate 采用与正文 undo/redo 的 Version 语义。

退出条件：Card 领域模型和 API 不变；用户可解释当前版本、比较旧版并安全恢复为新 Head。

### Phase 2：Checkpoint 领域、存储与 API，1–1.5 天

- [x] 先写 Checkpoint schema、摘要、元数据 CAS 和一致性校验失败测试。
- [x] 实现 `BoardCheckpointStore` 的原子 save/load/list/update/delete 与 20 个上限。
- [x] 在 Board lock 内复用 BoardArtifact 投影创建稳定快照，并加 Run/Candidate 门禁。
- [x] 增加 routes/handlers/API client；错误映射进入共享 policy，不在组件重复翻译。
- [x] 将 Checkpoint 文件并入 Board 永久清除事务与故障注入测试。

退出条件：并发编辑、活动 Run、Candidate、损坏文件和原子 replace 故障都不会产生可见半写。

### Phase 3：副本、备份与 diff，1–1.5 天

- [x] 先写 Checkpoint-to-current diff 的 Card/布局/Transformation 纯函数测试。
- [x] 复用 BoardArtifact remap 与 import committer 实现`从版本创建副本`。
- [x] 验证新副本 ID 全新、结构闭合、终态 Run 保留、fileBinding 不复制、原 Board 零写入。
- [x] 升级 MiraBackup 格式并覆盖旧备份兼容、新格式严格校验和 workspace 原子恢复。
- [x] 覆盖 checkpoint 导出、备份 256 MiB 上限和 Desktop/Standalone restore 测试。

退出条件：Checkpoint 可以预览、比较、导出、创建独立 Board，并完整进入备份恢复。

### Phase 4：UI 与集成验收，1–1.5 天

- [x] 新增延迟加载 `BoardHistory` feature，Store 公共契约与异步编排保持边界清晰。
- [x] 实现列表、保存、只读预览、比较、重命名、删除和创建副本状态。
- [x] 在 BoardManager 增加 active/archived/trashed 的历史入口，不把逻辑堆回 `App.tsx`。
- [x] 真实浏览器验证 1440、1024、390px 的遮挡、溢出、焦点、键盘与 console。
- [x] 用独立临时 workspace 走完手动里程碑、继续编辑、比较、创建副本、备份恢复。

退出条件：自动化和真实产品路径都通过，验证报告记录环境、数据、限制与截图证据。

整体预计 `3.5–5.5` 个工程日；若 `D1` 改为原地回滚，预计增加至少 `3–5` 个工程日并需要新的
领域设计，不应塞入上述 Phase 2。

当前自动化、真实临时 workspace、Standalone restore 与 arm64 packed smoke 证据见
[2026-09-05 Card 与画布版本管理验证](../validation/2026-09-05-card-canvas-version-management-validation.md)。
原分支当时受浏览器环境阻塞的两项验收已在 2026-09-06 补齐，并完成预览请求归属、完整
Run 比较、副本取消/并发导航及当前模块边界适配。当前证据见
[版本管理交付验证](../validation/2026-09-06-checkpoint-delivery-validation.md)，历史报告保持原结论。

## 11. 验收矩阵

### 11.1 CardVersion

| ID | 场景 | 必须结果 |
| --- | --- | --- |
| `CV-01` | 保存人工正文 | 只追加 human Version，旧 Version 不变 |
| `CV-02` | 恢复 v2，当前为 v7 | 创建 v8，内容等于 v2，Head 指向 v8 |
| `CV-03` | AI 运行中人工修改目标 | 人工 Head 保留，AI 输出进入 Candidate |
| `CV-04` | 采用 Candidate 前 Head 再次变化 | 返回冲突，Candidate 保持可达 |
| `CV-05` | 绑定文件被外部修改后恢复旧版 | 新 Version 保留，外部文件不覆盖，显示冲突处理入口 |

### 11.2 BoardCheckpoint

| ID | 场景 | 必须结果 |
| --- | --- | --- |
| `BC-01` | revision 12 保存检查点，同时另一窗口编辑 | 快照完整落在编辑前或后；旧 baseRevision 冲突，绝无混合状态 |
| `BC-02` | 有 running Run 保存 | 返回 `TARGET_BUSY`，Checkpoint 列表零新增 |
| `BC-03` | 有 pending Candidate 保存 | 返回 `CANDIDATE_PENDING`，Candidate 仍可处理 |
| `BC-04` | 删除 Card/结构并继续编辑后打开旧检查点 | 只读预览仍完整显示当时对象，不写当前 Board |
| `BC-05` | 从同一检查点创建两次副本 | 得到两个身份独立、引用闭合的 active Board |
| `BC-06` | 副本来自带文件绑定的 Markdown Card | 内容与版本保留，绑定移除，不写外部文件 |
| `BC-07` | 第 21 次保存 | 明确返回上限错误，不删除最旧 Checkpoint |
| `BC-08` | Checkpoint JSON 损坏 | 单项读取 fail closed；不能以空快照或当前 Board 替代 |
| `BC-09` | 永久清除 trashed Board | Board、所属 Run 与 Checkpoint 同事务移除，其他 Board 不变 |
| `BC-10` | 新格式备份恢复到空 workspace | Checkpoint 数量、ID、内容和 Board 归属严格一致 |

### 11.3 UI 与可访问性

| ID | 场景 | 必须结果 |
| --- | --- | --- |
| `UI-01` | 1440px 保存并比较 | Canvas 与 360px 面板不重叠，当前对象保持可见 |
| `UI-02` | 390px 长标题和 20 个版本 | 标题换行、列表可滚动、底部命令可达、无页面横向溢出 |
| `UI-03` | 键盘进入、保存、取消 | 焦点被正确锁定并返回触发元素，状态有 `aria-live` 反馈 |
| `UI-04` | active Run/Candidate 门禁 | 说明原因并提供对应处理入口，不只禁用按钮 |
| `UI-05` | 创建副本失败 | 原 Board、所选版本与表单输入保留，错误不被通知层遮挡 |

## 12. 验证命令与证据

每个 Phase 先运行最小定向测试。合入集成分支前统一运行：

```sh
pnpm test
pnpm exec tsc --noEmit
pnpm build
pnpm build:bridge
git diff --check
```

涉及 Checkpoint、Run、Candidate、Board purge、BoardArtifact 或 MiraBackup 的切片必须运行真实
Bridge 集成测试与故障注入。可见 UI 必须在真实浏览器验证 1440、1024 和 390px；Desktop
备份恢复变化还需目标架构 make、对应 packed smoke，以及未锁屏 macOS 会话中的可见检查。

## 13. 上线与迁移

- 现有 workspace 没有 `board-checkpoints-v1/` 时视为零 Checkpoint，首次保存时创建目录。
- 不从 `Board.revision`、CanvasHistory、旧 BoardArtifact 或 Git history 回填 Checkpoint。
- 现有 CardVersion 原样保留，不重排 sequence、不修改 origin、不重新计算历史出处。
- Checkpoint 功能与新 MiraBackup 格式同批上线；旧备份读取兼容由测试锁定。
- internal Alpha 不需要 feature flag；若真实数据验证失败，只停用新的创建入口，读取、导出和
  `MiraBackupV2` 兼容必须保留。

回退不得删除或隐藏 `board-checkpoints-v1/`，也不得退回会遗漏 Checkpoint 的 V1 备份导出。
再次上线时必须能读取同一 schema；若格式需要变化，新增 `schemaVersion` 迁移或离线转换，
不能批量覆盖用户快照。
