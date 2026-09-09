# Mira 核心规格

- 状态：Card 与画布版本管理实施基线
- 日期：2026-09-05
- 产品来源：[`../product/product-definition.md`](../product/product-definition.md)
- 范围：Board v2 生命周期、Card、Version、BoardCheckpoint、workspace 灵感池、Transformation、Run、Candidate、PlanDraft、WorkflowTemplate、WorkflowPlan 与版本化数据包

## 1. 规格目标

本规格将“默认从内容开始，也允许先搭计划；走通后再固化方法”转换为可实现、可测试的契约。所有能力共用一套内容和执行模型：直接计划和流程应用都不能绕过普通转化的版本、冲突、失败或分支规则。

优先级如下：

1. 人工内容和历史版本不可丢失。
2. 用户明确知道一次操作读取什么、创建什么、是否会运行。
3. 一次推进和流程中的一步使用相同对象与状态机。
4. Workflow 只复用方法，不成为第二套画板或执行引擎。
5. v1 数据只存在于产品之外的只读归档；生产 UI、HTTP API 和 bridge 运行时不提供兼容、预览或迁移路径。

## 2. 术语

| 术语 | 定义 |
| --- | --- |
| Card | 画板上的稳定内容对象和空间位置 |
| CardVersion | Card 在某个稳定时刻的不可变内容 |
| Head | Card 当前默认展示的最新版本 |
| Draft | 正在编辑、尚未提交为 Version 的本地内容 |
| CanvasClipboard | 当前页面会话中的 UI 内部剪贴板；不持久化，也不读写系统剪贴板 |
| CanvasHistory | 当前 Board 页面会话内最多 50 条、只覆盖受支持 Card 操作的撤销/重做栈；不属于 Board 持久数据 |
| BoardCheckpoint | 用户手动保存的命名画布里程碑；内嵌不可变 BoardArtifact，只能恢复为新 Board 副本 |
| BoardLifecycle | Board 的 `active`、`archived` 或 `trashed` 可逆状态；不拥有或改写内容对象 |
| Tag | ContentCard 上用于检索的可变扁平标签；不属于 Version 内容 |
| InspirationPool | workspace 级独立灵感集合；不属于任何 Board，不拥有画布坐标或运行状态 |
| InspirationEntry | 灵感池中的稳定条目，拥有标签和不可变版本序列 |
| InspirationVersion | InspirationEntry 的不可变 Markdown 内容版本 |
| FileBinding | Markdown Card 与一个 workspace-relative 本地文件之间的同步基线 |
| InspirationRef | 从灵感池创建独立 Card 时保留的轻量来源定位；不表示同步 |
| SourceRef | 明确的 Card 与 Version 引用 |
| Transformation | `1..N` 个来源到一个目标的持久局部推进关系 |
| Run | 使用冻结来源执行一条 Transformation 的记录 |
| Candidate | 因目标 Head 已变化而不能自动采用的模型输出 |
| Stale | 最近已采用 Run 的有序来源或来源版本不再等于 Transformation 当前来源与各 Card Head |
| WorkflowTemplate | 从已验证的线性转化路径提取的全局可复用方法 |
| WorkflowStepTemplate | 模板中的一个有序步骤，不含项目正文或运行状态 |
| PlanDraft | 当前页面内的线性计划草稿；不写 Board，也不创建 Run 或模板 |
| PlanRef | Transformation 上的轻量计划编号与来源；不拥有对象或控制执行 |
| WorkflowApplication | 将模板应用到一组 SourceRef 的原子命令 |
| WorkflowPlan | 直接创建或应用方法后铺在 Board 上的一组普通 Card 与 Transformation；不独立持久化 |
| Branch | 用户明确画出或配置的新方向 |
| BoardArtifact | 一个 Board、其 Run 与非安装型方法出处快照组成的版本化可移植数据包 |
| MiraBackup | 当前 workspace 中全部 Mira 管理数据的一致、版本化备份；不包含秘密配置或引用文件正文 |

## 3. Board 聚合

```ts
interface BoardV2 {
  schemaVersion: 2
  id: string
  title: string
  revision?: number
  lifecycle?: {
    state: 'active' | 'archived' | 'trashed'
    archivedAt?: string
    trashedAt?: string
  }
  cards: ContentCard[]
  groups?: CanvasGroup[]
  transformations: Transformation[]
  viewport: { x: number; y: number; zoom: number }
  createdAt: string
  updatedAt: string
}
```

Board 是可独立原子保存的 JSON 聚合。Card、Version 和 Transformation 必须在一次变更中共同校验；Board 不新增 `plans[]`，WorkflowPlan 只通过 Transformation 的轻量引用重建。WorkflowTemplate 不属于某个 Board，单独保存于全局模板存储。卡与卡之间唯一的持久结构联系是 Transformation；不存在普通关系连线。旧数据或旧数据包中残留的 `relations` 字段在读取和导入时一律静默忽略，不解析、不映射、不报错。

旧 Board 缺少 `lifecycle` 时按 `active` 解释，缺少 `revision` 时按 `0` 解释；新 Board 从 `revision: 0` 开始。每次成功的 Board 聚合变更只将 revision 加一，`updatedAt` 只用于展示，不能作为并发控制令牌。标题去除首尾空白后必须为 `1..120` 个字符，允许不同 Board 重名。重命名请求携带 `baseRevision`；并发旧请求返回 `BOARD_CONFLICT`，不得覆盖更新后的 Board。重命名只改变 `title`、`revision` 与 `updatedAt`，不改变 Board ID 或内部对象。

生命周期转换如下：

- `active -> archived`：归档；Board 保持完整，从普通画板切换、灵感来源以及内容、结构、运行写命令中退出，但仍可在 BoardManager 重命名、导出、恢复或移入废纸篓。
- `active | archived -> trashed`：移入废纸篓；Board 仍完整保存在 v2 Board 存储中，只能恢复、导出或参与完整备份。
- `archived | trashed -> active`：恢复；清除不再适用的当前状态时间并重新进入普通工作入口。
- `trashed -> absent`：永久清除；仅接受带当前 `baseRevision` 和显式确认的命令，在 Board 锁内原子移除该 Board 聚合、其 Board 级 Run 与全部 Checkpoint。成功后不可撤销、不产生可恢复回执且 Board ID 不得复用；不删除全局 WorkflowTemplate、其他 Board 或引用文件正文。
- 归档或移入废纸篓前，服务必须确认该 Board 没有 `queued/running` Run，也没有 `succeeded + candidate` 的未处理结果；否则分别返回 `TARGET_BUSY` 或 `CANDIDATE_PENDING`，Board 零写入。
- Board lifecycle lock 是现有每 Board 聚合写序列化边界。重命名、归档、移入废纸篓与恢复都必须携带 `baseRevision`；全部 Card、Transformation、Plan、Workflow application、Run 启动、Candidate 写回与 Board 导出也必须在同一锁内重新读取 lifecycle/revision 后提交。竞争命令只能按锁顺序成功：普通写入先成功会增加 revision，使旧 lifecycle 请求返回 `BOARD_CONFLICT`；生命周期转换先成功会使普通写入返回 `BOARD_READ_ONLY`。归档/移入废纸篓还必须在锁内重新读取 Run 和 Candidate 状态。完整备份使用覆盖所有 Board/Run/Workflow 写命令的独占 snapshot lease。
- archived 与 trashed Board 的 Card、Transformation、Plan、Workflow application、Run 启动和 Candidate 写回命令均返回 `BOARD_READ_ONLY`。永久清除只接受 trashed Board，必须通过独立二次确认命令；确认缺失、状态不是 trashed、活动 Run/Candidate 或任一文件提交失败时整体拒绝并零写入。
- 所有 Node-backed Standalone、Desktop 和其他可写 Host 在恢复和开放写入前必须取得 workspace 级独占写锁。锁以原子创建持有到 Host 关闭；已有其他写者时返回 `WORKSPACE_LOCKED` 并 fail-closed，不自动覆盖或降级为可写无锁模式。正常关闭释放锁；异常残留必须通过明确的离线运维步骤处理，不能依据不可靠的 PID 猜测自动删除。DSH/Cordis 的 `fsService` 若没有原子锁适配器，则不能宣称获得这项保护，仍必须由宿主保证单写者。
- 当前 Board 离开 active 集合后，客户端选择另一个 active Board；若不存在，则使用普通创建命令建立一个新的默认 Board。归档/移入废纸篓本身仍是单 Board 原子变更，不能把跨文件创建伪装成同一事务。

#### 本机画板导航

`openedBoardIds`（最近打开在前）和 `pinnedBoardIds` 只保存本机导航偏好，不写入 Board、数据包或 CanvasHistory。只有打开成功才更新列表，切换失败保持当前画板与列表；关闭当前项也必须在替代画板读取成功后才移除。关闭最后一个画板清空当前画布、选择、历史和页面草稿，保留目录和方法，刷新继续保持未打开状态。历史客户端无导航偏好时沿用原默认打开行为。

`GET /boards/activity` 返回 `{ activity: Record<boardId, { activeRuns: number; pendingCandidates: number }> }`，只统计 `queued/running` 与 `succeeded + candidate`，不返回正文或 Run 秘密字段。菜单打开时刷新；当前画板的已载入 Run 可即时更新标记。关闭前重新读取此摘要，未知/失败状态不能当作零任务。检查期间新导航使旧关闭意图失效；关闭不停止 Run、不改变 Board 生命周期。

### 3.1 BoardCheckpoint

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
```

- Checkpoint ID 在 workspace 内唯一，`boardId` 必须等于 `artifact.board.id`，`baseBoardRevision` 必须等于快照 Board revision。title trim 后为 `1..80` 字符，note trim 后最多 240 字符。
- artifact 创建后不可修改；重命名或备注更新只使用 `baseMetadataUpdatedAt` 做 CAS 并修改顶层元数据。Checkpoint 不使用连续版本号。
- 只允许用户为 active Board 手动创建。服务在 Board lifecycle lock 内重读 revision、Board 和全部 Run；存在 queued/running Run 返回 `TARGET_BUSY`，存在未处理 Candidate 返回 `CANDIDATE_PENDING`，旧 revision 返回 `CHECKPOINT_CONFLICT`，全部零写入。
- 每个 Board 最多 20 个 Checkpoint；达到上限返回 `CHECKPOINT_LIMIT`，不得静默删除。单个 artifact 继续受 BoardArtifact 的对象数量和 64 MiB 限制；列表默认只返回摘要。
- archived/trashed Board 可查看、导出、重命名、删除 Checkpoint 或从中创建副本，但不能创建 Checkpoint。归档和移入废纸篓保留 Checkpoint；永久清除在同一 Board 提交中原子移除 Board、所属 Run 和 Checkpoint。
- 从 Checkpoint 创建副本复用 BoardArtifact 的完整 ID remap 与 staging 提交，结果固定为 `active`、`revision: 0`，不复制 Checkpoint 或 Markdown `fileBinding`。原 Board、Run、Candidate 和 Checkpoint 零写入。

## 4. 内容与关系模型

### 4.0 InspirationPool

```ts
interface InspirationPool {
  schemaVersion: 1
  id: 'inspiration-pool'
  entries: InspirationEntry[]
  createdAt: string
  updatedAt: string
}

interface InspirationEntry {
  id: string
  tags?: string[]
  headVersionId: string
  versions: InspirationVersion[]
  createdAt: string
  updatedAt: string
}

interface InspirationVersion {
  id: string
  entryId: string
  sequence: number
  content: { kind: 'markdown'; markdown: string }
  digest: string
  origin: 'human' | 'restore' | 'import'
  createdAt: string
}
```

- 灵感池独立保存于 workspace 根存储，不依赖 Board 是否存在、处于何种生命周期或当前 Canvas 是否打开。
- 灵感池条目的版本创建后不可修改；筛选只读取每条目的 Head，正文关键词大小写不敏感，多个标签使用 AND 语义。
- 编辑只接受 `{ markdown, tags, baseVersionId, baseUpdatedAt }`。池内串行检查 Head 与更新时间；过期返回 `INSPIRATION_CONFLICT` (409)，不存在返回 `INSPIRATION_NOT_FOUND` (404)。正文变化追加 human Version，仅标签变化只更新元数据；updatedAt 单调增加。保存失败保持原数据完整，已选旧版与画板副本不被替换。
- 直接记录通过 `POST /inspiration-pool/entries` 写入灵感池；不创建 Card、CanvasHistory、Transformation、Run 或 Candidate。
- 添加到当前画板才通过 Board 批量创建一张普通 Card，并将 `{ poolId, entryId, versionId }` 保存为 `inspirationRef`；随后灵感池变化不自动同步该 Card。

### 4.1 ContentCard

```ts
interface ContentCard {
  id: string
  name?: string
  color?: CardColor
  contentKind: 'markdown' | 'file-reference'
  tags?: string[]
  inspirationRef?: {
    poolId: string
    entryId: string
    versionId: string
  }
  x: number
  y: number
  width: number
  height: number
  headVersionId: string | null
  versions: CardVersion[]
  fileBinding?: CardFileBinding
  createdAt: string
  updatedAt: string
}

interface CardFileBinding {
  path: string
  lastSyncedVersionId: string
  lastSyncedFileDigest: string
  lastSyncedAt: string
}
```

- Card ID 在 Board 内稳定。
- `name` 是可选、trim 后 1..120 个字符的单行名称；PATCH 使用 `{ name: string | null, baseName: string | null }`，null 清除，缺失名称按 null 比较。在 Board 锁内比较当前名称与 baseName，不匹配返回 `CARD_NAME_CONFLICT` (409)，不提交任何其他字段。改名不追加 Version、不改 Head、生成或文件同步，不进入 CanvasHistory。名称随复制和可移植数据保留，缺失字段不迁移。
- 空目标允许 `headVersionId: null` 且 `versions: []`。
- 非空 Head 必须引用本 Card 的 Version。
- 删除 Card 必须先显式处理相关 Transformation；Run 快照不可级联删除。
- `tags` 缺失按空数组解释；存在时最多 20 项，每项去除首尾空白后为 `1..32` 个字符，大小写不敏感地唯一，并保存用户确认的显示形式。
- `inspirationRef` 的 pool、entry、version 三个 ID 均必须为非空字符串。它不要求灵感池条目永久存在，也不参与 Board 内关系完整性校验。
- `fileBinding` 只允许出现在 `contentKind: 'markdown'` 且拥有有效 Head 的 Card 上。路径必须是 workspace-relative、规范化后不含 `..`、不含 NUL 的非空路径；`lastSyncedVersionId` 必须指向该 Card 的一个 Markdown Version。绑定元数据属于 Card 聚合，不属于任何 CardVersion。

### 4.2 CardVersion

```ts
type CardContent =
  | { kind: 'markdown'; markdown: string }
  | { kind: 'file-reference'; path: string; readonly: boolean }

interface CardVersion {
  id: string
  cardId: string
  sequence: number
  content: CardContent
  digest: string
  origin: 'human' | 'ai' | 'restore' | 'import'
  createdAt: string
  sourceRunId?: string
  restoredFromVersionId?: string
}
```

- Version 创建后不可修改，`sequence` 从 1 严格递增。
- `origin: ai` 必须带 `sourceRunId`；`origin: restore` 必须带 `restoredFromVersionId`。
- 恢复旧版会复制其内容并追加新 Version，不移动 Head 指针到旧对象。
- 画布始终显示 Head；查看历史不改变来源选择。

### 4.2.1 本地文件绑定与同步

`fileBinding` 表示最近一次确认的同步基线。Mira 通过 `lastSyncedFileDigest` 判断文件是否被外部修改，通过 `lastSyncedVersionId` 判断 Card 是否有尚未写出的新 Head。状态投影为 `unbound`、`synced`、`unsynced`、`conflict`、`missing` 或 `error`。

- `PUT .../file-binding` 只接受一个 workspace-relative 路径；file-reference Card、空目标和同 Board 已被其他 Card 绑定的路径必须拒绝。首次绑定已有文件时，内容不同必须显式要求 `overwrite`，内容相同时直接建立基线。
- 每次 human、restore、ai 或采用 Candidate 追加 CardVersion 后，若 Card 有绑定，服务自动尝试同步当前 Head。文件仍等于上次同步基线时，使用临时 workspace-relative 文件加原子 replace 写入，并更新 `fileBinding`；文件已变化、缺失或读取失败时不写文件，并保留 CardVersion。
- 冲突处理必须显式选择：`overwrite` 用当前 Mira Head 覆盖文件，`import` 读取本地 Markdown 并追加新的 `origin: human` CardVersion 后更新同步基线。两者都要在写入前重新比较文件 digest，避免覆盖处理期间的外部修改。
- `DELETE .../file-binding` 只解除绑定，不删除本地文件或 CardVersion。绑定元数据不进入 BoardArtifact、MiraBackup 或跨 Board 复制；导入后必须重新绑定。
- 文件同步是 Card/Board 原子变更的一部分，但与外部文件系统无法组成跨系统事务。文件已写而 Board 持久化失败时，下一次状态检查必须报告未同步或冲突，不能宣称已完成。

### 4.3 标签与灵感选择

标签是 Card 级元数据。更新标签只修改 Card 以及 Board 的 `revision`/`updatedAt`，不创建或恢复 CardVersion，不修改 Head、digest、Run snapshot 或 Transformation。恢复历史 Version 保留 Card 当前标签。

灵感选择器读取 workspace 灵感池，并只投影每条 InspirationEntry 的当前 Head。Markdown 使用当前正文参与大小写不敏感的关键词匹配；空 Head、悬空 Head 和结构无效内容不进入结果。多个已选标签使用 AND 语义；空查询和空标签显示灵感池的全部可用 Head。

直接记录通过一次 `POST /inspiration-pool/entries` 创建 InspirationEntry。请求只携带 Markdown 正文和可选标签，不携带 Board ID、坐标、文件字段或 `inspirationRef`。服务 trim 正文并要求非空，在 workspace 灵感池写锁内创建恰好一个 `origin: human` Head Version。记录过程不调用 `switchBoard`，不写 Board、CanvasHistory、Transformation、Run、Candidate 或 Workflow。

记录成功后，新条目进入灵感池检索投影，但不自动加入候选选择或当前工作集，弹窗保持打开。当前 Canvas 状态完全不变；记录失败时灵感池零写入，正文与标签草稿保留以便重试。

搜索词、标签筛选、候选选择和候选排序只存在于当前页面，零 Board 写入、零 Run。候选以 `{ poolId, entryId, versionId }` 标识。灵感池 Head 变化不会改写已经选择的页面内快照；用户重新选择时读取新的 Head。

放入当前 Board 使用 §4.4 的 `PoolSnapshotCreateCardInput` 批量创建契约；客户端只提交选择时的池、条目、不可变 Version ID 和标签快照。服务读取该版本正文、计算落位并生成 `inspirationRef`；新 Card/Version 获得独立 ID，`origin` 为 `human`。标签作为初始元数据复制，之后与灵感池独立。普通画布复制仍不添加 `inspirationRef`。

确认时客户端必须将全部池条目组成一次 `POST /boards/:boardId/cards/batch`。服务先验证全部标签、来源定位和内容，再在一次 Board 变更中计算几何并提交；任一项无效时零写入。响应顺序与请求一致。添加不改变画布来源选择，遵循 INSP-08。

### 4.4 画布复制与批量操作

画布复制是内容快照操作，不是对象克隆。复制一组 Card 时，UI 内部剪贴板为每项保存当前 Head 内容、`width`、`height` 和相对整组锚点的 `x/y` 偏移：

- Markdown Card 保存当前 Head 的 Markdown；无 Head 时保存为空内容。
- file-reference Card 保存当前 Head 的 `path` 和 `readonly`；当前 Head 结构无效时不得伪造可粘贴内容。
- 不保存 Card ID、Version ID 或完整历史、Transformation、Run、Candidate、`sourceRunId`、`restoredFromVersionId`、`planRef` 或 `workflowRef`。

粘贴必须创建新的 Card ID。非空内容至多形成一个新的 `origin: human` Head Version，并获得新的 Version ID；空 Markdown 保持 `headVersionId: null`。多张 Card 的尺寸和组内相对布局保持不变，锚点可以位于当前画板；连续粘贴可整体错开，但不得改变组内布局。

CanvasClipboard 只存在于当前页面会话，允许在该会话中跨 Board 使用。刷新或关闭页面后清空；它不是 Board、WorkflowApplication 或 HTTP 资源，也不得隐式接入操作系统剪贴板。创建副本复用相同快照语义，但不应覆盖用户已有的 CanvasClipboard。

单卡创建与批量 HTTP 请求体为：

```ts
interface PositionedCreateCardInput {
  x: number
  y: number
  width?: number
  height?: number
  contentKind?: 'markdown' | 'file-reference'
  tags?: string[]
  inspirationRef?: { boardId: string; cardId: string; versionId: string } // 历史调用兼容；UI 池添加使用下方 poolSource
  markdown?: string
  filePath?: string
  readonly?: boolean
}

interface BoardBottomCreateCardInput {
  placement: 'board-bottom'
  contentKind?: 'markdown'
  markdown: string
  tags?: string[]
}

type CreateCardInput = PositionedCreateCardInput | BoardBottomCreateCardInput

interface PoolSnapshotCreateCardInput {
  poolSource: { poolId: string; entryId: string; versionId: string }
  tags?: string[]
}

interface CreateCardsRequest { cards: (PositionedCreateCardInput | PoolSnapshotCreateCardInput)[] }

interface UpdateCardRequest {
  x?: number
  y?: number
  width?: number
  height?: number
  tags?: string[]
}

interface UpdateCardsRequest {
  updates: Array<{
    cardId: string
    x?: number
    y?: number
    width?: number
    height?: number
  }>
}

interface DeleteCardsRequest { cardIds: string[] }

interface RestoreCardsRequest { restoreReceiptId: string }

interface DeleteCardsResult {
  deletedCardIds: string[]
  restoreReceiptId: string
}

interface DeleteCardResult {
  deletedCardId: string
  restoreReceiptId: string
}
```

批量数组长度为 `1..100`。创建项必须有有限的 `x/y`，file-reference 必须有非空路径；更新和删除的 Card ID 必须非空且唯一，每个更新项至少包含一个有限的几何值。服务必须先校验整批对象，再在一次 Board 变更中创建、更新或删除；任一项畸形、缺失或写入失败时 Board 零写入。

灵感池添加使用 `PoolSnapshotCreateCardInput`，仅允许 `poolSource` 与可选的所选标签快照，不携带正文、尺寸、坐标或客户端 `inspirationRef`。服务读取受管池中明确选中的不可变 Version（不替换为新 Head），生成普通 human Card 和经过核对的 pool 出处，在 Board 写锁内复用画板底部落位策略，逐项避让此前创建项。缺失池/条目/版本、额外字段或混用几何返回 `BAD_REQUEST`，整批零写入；池存储不可用时返回 `INSPIRATION_UNAVAILABLE`。单卡与普通坐标创建不能接受客户端 pool 形式 `inspirationRef`；单卡入口也拒绝 `poolSource`，均返回 `BAD_REQUEST`，避免旁路伪造或静默空卡。普通带坐标创建的历史 board 形式出处兼容与独立导入校验保持原契约。UI 成功后遵循 INSP-08，不自动选择或移动视口。

批量删除前必须检查全部目标。只要任一卡作为 Transformation 的来源或目标，整批返回 `CARD_IN_USE`，不得删除其余无引用 Card。UI 的预检查和二次确认用于及时解释影响，服务端检查仍是最终安全边界。

#### 4.4.1 当前画板会话历史

CanvasHistory 只存在于浏览器 Store，最多保留最近 50 条记录。切换 Board、重新载入 Board、刷新或关闭页面都会清空；新记录会清空 redo 栈。删除记录使用 `{ kind: 'delete', boardId, cardIds, restoreReceiptId }`，不在浏览器保存可伪造的完整 Card 对象。它只记录：

- 已成功保存的 Markdown 正文变更；undo/redo 仍通过正常 Version API 追加新 Version，不修改旧 Version。
- 已成功保存的单卡或多卡位置变更。
- file-reference 创建，粘贴、创建副本，以及灵感池快照形成的 Card 创建批次。
- 经过引用预检和二次确认后删除的无结构引用 Card 批次。

普通空 Markdown Card 的初始创建不单独进入历史；首次正文提交按正文变更记录。直接记录到灵感池不创建 Card，因此不进入 CanvasHistory；将灵感添加到当前 Board 后形成的 Card 创建按普通创建历史处理。标签、Transformation、Run、Candidate、PlanDraft、WorkflowPlan、WorkflowTemplate 和模型设置均不进入 CanvasHistory。Card resize 按 4.4.3 进入整理历史；单独移动 Transformation 不在该历史范围，组整体移动按 4.4.2 处理。

撤销创建仍调用普通批量删除，不能绕过 `CARD_IN_USE`；redo 创建后若再次删除，必须用新响应替换历史项中的旧 receipt。单删和批量删除响应都返回不可伪造的 `restoreReceiptId`；撤销删除向 `POST /boards/:boardId/cards/restore` 只提交该 ID。Bridge 按 Board、按删除批次保留最近 50 份精确回执，与浏览器最多 50 条历史命令的窗口对齐，批次内 Card 数量不影响容量。有效回执恢复原 Card 身份和完整 Version 历史、响应 `{ cards }`，并在成功后消费；伪造、重复、服务重启后的请求或已存在的 Card ID 均返回 `CARD_RESTORE_CONFLICT` 且 Board 零写入。浏览器收到这个确定永久失效错误时移出该 undo/redo 历史项，允许继续操作更早历史；网络、存储或其他暂时错误保留该项以便重试。该端点只服务当前会话 undo，不是数据 import、备份恢复或通用 Card 创建 API。

Mira 不承诺持久、跨 Board 或覆盖完整对象图的撤销/重做，也不通过应用级系统剪贴板跨应用复制 Card。浏览器原生文字选区复制保持原生行为，不能被内部 Card 快捷键截获。

### 4.4.2 颜色与单层分组

本节扩展 4.4 与 4.4.1 的整理和会话历史范围，其余内容、执行与精确删除回执限制不变。

```ts
type CardColor = 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'violet'
interface CanvasGroup {
  id: string
  title: string
  color?: CardColor
  cardIds: string[]
}
// ContentCard.color?: CardColor; BoardV2.groups?: CanvasGroup[]
interface OrganizationPosition {
  kind: 'card' | 'transformation'
  id: string
  x: number | null
  y: number | null
  baseX: number | null
  baseY: number | null
}
interface UpdateOrganizationRequest {
  baseGroups?: CanvasGroup[]
  groups?: CanvasGroup[]
  colors?: Array<{ cardId: string; color: CardColor | null; baseColor: CardColor | null }>
  positions?: OrganizationPosition[]
  sizes?: Array<{ cardId: string; width: number; height: number; baseWidth: number; baseHeight: number }>
}
```

- 组 ID 为非空且 Board 内唯一；title trim 后为 1..80 字符，组名允许重复。每 Board 最多 100 组，每组 1..100 个不重复、存在于本 Board 的 Card；Card 不得属于多个组。不存储父组、框几何或转化成员。成员数组保持显式选择顺序，但不成为 Transformation 来源。
- `groups` 缺失按空集合解释；`color` 缺失为默认外观，更新 `null` 清除。旧文件不自动迁移或回写。颜色只接受上述枚举，不接受 CSS 字符串。整理请求先验证格式，再比较基线；基线不符或成员已不存在返回 `ORGANIZATION_CONFLICT`，非法格式、重复成员和容量越界返回 `ORGANIZATION_INVALID`。
- `PATCH /boards/:boardId/organization` 是原子整理命令。提供 `groups` 时必须同时提供 `baseGroups`，服务在 Board 写锁内比较当前完整分组集合后替换；这是保守的分组集合 CAS，不接受缺失引用或嵌套对象。只设色、只移动时不要求重传分组。
- `colors` 为 1..100 项，Card ID 唯一；每项必须携带 `baseColor` 并与当前颜色匹配。`positions` 最多 10,000 项，每个 kind/id 唯一，基线坐标必须匹配；Card 坐标为有限数字，只有 Transformation 允许成对 null，以撤销首次固定位置。至少存在一个有效命令字段，全部字段严格校验。
- 响应 `{ groups, cards, transformations }`：groups 为提交后的完整组集合，后两者只含受修改的对象。只允许改指定的颜色或几何，保留 Head、Version、语义 updatedAt、Run、出处、标签与绑定。组变更不触发模型或文件写入。整批在同一 Board 锁中预检并提交一次 revision；冲突 `ORGANIZATION_CONFLICT`、无效 `ORGANIZATION_INVALID` 均零写入，分别为 409/422。archived/trashed 返回现有 `BOARD_READ_ONLY`。
- 客户端拖组标题时冻结成员与完整内部步骤集合，基于现有投影位置生成整体位移；不递归扩散到其他组。Card 与内部步骤一次提交、一次撤销；只移动单卡不修改分组。
- 普通创建/复制输入可携带 `color`；`POST .../cards/batch` 可额外携带 `group: { title, color? }`，由服务生成新组 ID，将本批新 Card 全部纳入并原子返回 `{ cards, groups }`。未显式携带 group 的普通粘贴不创建组。整组粘贴复用现有避让布局计算，为整个框寻找空位，保持成员的相对位置。
- 删除 Card 时同次写入剔除成员引用，删除空组；精确回执同时保存受影响组的 before/after。恢复在锁内比较受影响组的删除后状态，存在冲突返回 `CARD_RESTORE_CONFLICT`，不得覆盖用户后续编辑或形成重复归属。无冲突恢复原 Card 与受影响组，保留无关组。删除与恢复响应追加 `groups`；回执仍每 Board 最近 50 个删除批次，批量大小不影响容量，不接受客户端传回 Card 快照。
- 整理历史只保存颜色、分组及几何的前后值，通过上述 CAS 命令重放，正文与 Run 不在该快照内。切换 Board/刷新清空，仍最多 50 条；新成功操作清空 redo。确定失效的整理历史移出栈并提示，暂时传输失败保留。
- BoardArtifact 重映射组 ID 与 cardIds，备份保留原身份，Checkpoint 预览展示框和颜色，比较展示颜色和分组变化。所有入口共用完整校验并限制组数量，不能静默丢弃分组字段。

验收：单卡任意远拖保持归属；整体拖动保留相对位置与跨组步骤；批量设色失败零半写；成员转组无双重归属；解组不删 Card；删除最后成员后撤销恢复原组；后续分组冲突拒绝恢复；六批各 100 张删除不挤出历史窗口；普通复制只带颜色，整组复制生成新身份且零 Transformation；导入、备份、Checkpoint 副本完整保留组织信息；运行期间整理不改变 Head/Candidate，390px 工具栏、菜单与焦点可达。

#### 4.4.3 尺寸整理扩展（2026-09-07）

本节扩展 4.4.1 中 resize 不进入历史的旧边界。`PATCH .../organization` 接受可选 `sizes`：1..100 个 `{ cardId, width, height, baseWidth, baseHeight }`，ID 唯一，全部尺寸为有限正数。目标存在且当前宽高与基线完全一致才可提交；无效返回 `ORGANIZATION_INVALID`，缺失或旧基线返回 `ORGANIZATION_CONFLICT`。与 colors/positions/groups 一同完整预检后提交一次，任意失败零半写，继续使用 Board lifecycle lock。

响应 cards 包含尺寸变化的 Card，保留 Head、Version、绑定与内容时间；组框由最新几何重投影。尺寸前后值进入 organization 会话历史，反转请求仍做 CAS，最多 50 条，确定失效移出、暂时失败保留。新 UI 推荐宽高范围不能阻止旧合法几何的恢复。删除回执仍每 Board 最近 50 个批次，不能改为按 Card 数量计数。

#### 4.4.4 正文保存与连续记录（2026-09-07）

正文保存由客户端显式携带草稿 baseVersionId；不能使用保存时重新读到的 Head 替换该基线。Store 保存结果必须明确成功/失败，成功后才可编排下一次创建。`保存并新建`的下一张 Card 不复制正文、标签、组、颜色、绑定或出处，只沿用尺寸并碰撞避让。双击提交受同一请求锁保护。

保存失败保留草稿并零创建；保存成功、新建失败时保留已保存 Version。新建请求结果不确定时阻止该连续动作直接重试，先刷新并核对画板，不自动推断或删除同名卡；用户显式普通新建仍是另一条命令。成功响应不能导航已失效的 Board/详情意图。

### 4.5 Transformation

```ts
interface WorkflowRef {
  workflowId: string
  stepId: string
  applicationId: string
}

interface PlanRef {
  planId: string
  source: 'ad-hoc' | 'template'
  title: string
  stepIndex: number
  stepTotal: number
  adjusted?: boolean
}

interface Transformation {
  id: string
  sourceCardIds: string[]
  targetCardId: string
  x?: number
  y?: number
  label: string
  instruction: string
  acceptance: string
  modelId?: string
  permissions: { workspaceWrite: boolean }
  planRef?: PlanRef
  workflowRef?: WorkflowRef
  lastRunId?: string
  lastAppliedRunId?: string
  createdAt: string
  updatedAt: string
}

interface UpdateTransformationRequest {
  baseUpdatedAt: string
  label?: string
  instruction?: string
  acceptance?: string
  modelId?: string | null
  sourceRefs?: SourceRef[]
}

interface UpdateTransformationPositionRequest {
  x: number
  y: number
}
```

- `sourceCardIds` 长度为 `1..N`，有序且不得重复。
- `x/y` 是可选的转化块画布位置，必须同时缺失或同时为有限数值。缺失时客户端按来源与目标的中点投影；首次手动移动后持久化。
- 目标恰好一个，不得同时作为自身来源；全部 Card 属于同一 Board。
- `label` 使用成果语言；当前尝试状态从 `lastRunId` 指向的 Run 派生，stale provenance 从 `lastAppliedRunId` 指向的最近已采用 Run 派生。
- `lastRunId` 在每次显式启动时更新；`lastAppliedRunId` 只在结果直接采用或 Candidate 明确采用后更新。失败、停止、产生 Candidate 或丢弃 Candidate 都不能清除或替换最近已采用 provenance。
- `workflowRef` 只记录来源，不改变 Transformation 行为。
- `planRef` 只记录计划来源、稳定编号和导航分组，不改变 Transformation 行为；用户显式编辑计划步骤语义时服务把该步 `adjusted` 置为 `true`，删除步骤则由编号缺口推导调整状态，两者都不级联。
- `modelId` 是可选的当前步骤模型覆盖。缺失时继承平台适配器的当前模型；非空时平台必须实际使用该模型或在创建 Run 前返回明确的不支持错误，不得静默回退。
- 模型覆盖不属于 Card，也不改变来源、目标、Version 或 Candidate 语义。旧 Board 未保存 `modelId` 时按继承处理。
- 修改或创建 Transformation 均不得自动创建 Run。
- 位置更新只修改 `x/y` 和 Board revision，不修改 Transformation 的语义 `updatedAt`，不受 Run/Candidate 编辑锁限制，也不改变来源、目标或 provenance。
- PATCH 必须携带用户打开编辑时看到的 `baseUpdatedAt`。服务在最新 Board 锁内比较；缺失或不匹配返回 `TRANSFORMATION_CONFLICT`，Board 零写入。每次成功更新必须产生与旧值不同的单调 revision，即使系统时钟仍处于同一毫秒。
- 更新只接受 `label`、`instruction`、`acceptance`、`modelId` 和 `sourceRefs`；`modelId: null` 清除覆盖，非空值去除首尾空白后必须仍非空。不得通过 PATCH 改写 `targetCardId`、`planRef`、`workflowRef`、`createdAt`、`lastRunId`、`lastAppliedRunId` 或 `permissions`。
- 更新 `sourceRefs` 时沿用创建 Run 的当前 Head 校验：数组非空、Card ID 唯一且有序、Version 等于对应 Card 当前 Head、Head 实际存在且内容可用，且来源不得包含目标 Card。缺失或空数组返回 `SOURCE_REQUIRED`；畸形 Card ID、重复或自引用返回 `TRANSFORMATION_SOURCE_INVALID`；缺失 Version、悬空 Head 或空白内容返回 `SOURCE_READ_FAILED`；请求 Version 已落后于当前 Head 返回 `SOURCE_VERSION_CHANGED`。更新后只替换 `sourceCardIds` 并刷新 `updatedAt`。
- 删除 Transformation 只移除这条结构，保留来源 Card、目标 Card、全部 Run、Version、Candidate 和其他 Transformation；不级联删除历史。
- 来源更新不得引入依赖环：如果当前目标可沿其他 Transformation 的来源到目标路径到达任一拟加入来源，则返回 `TRANSFORMATION_SOURCE_INVALID`，Board 零写入。此门禁用于显式来源更新，不扫描迁移或改写历史 Board。
- 拖线追加和详情来源管理均复用 PATCH。追加先去重，保留既有顺序；无新增项时零写入。点选草稿保留打开时的 `baseUpdatedAt`，确认后提交，旧基线仍返回冲突，不自动覆盖他人编辑。来源管理不进入 CanvasHistory。
- 更新或删除前若同一 Board 与目标 Card 存在 `queued` 或 `running` Run，返回 `TARGET_BUSY` 且零写入；若对应 Transformation 存在未采用或未丢弃的 Candidate，返回 `CANDIDATE_PENDING` 且零写入。
- Run 列表成员损坏、语义非法或读取失败时原错误上抛；只有并发删除造成的明确 `RUN_NOT_FOUND` 可以跳过。服务不能在无法确认安全状态时继续启动 Run 或修改 Board。

同一组有序 `sourceRefs` 可以通过批量创建命令一次生成 `2..16` 个彼此独立的 Transformation。批量项各自拥有一个空目标 Card 和成果文案，共享同一组来源引用；创建时服务只按当前 Head 校验来源，实际来源版本冻结由后续 Run 负责。服务必须先验证全部来源与全部批量项，再在一次 Board 变更中提交，任一项无效或数量越界时不得留下任何 Card 或 Transformation。该命令只创建结构，不创建 Run、Candidate 或 WorkflowPlan。

## 5. Workflow 模型

### 5.1 WorkflowTemplate

```ts
interface WorkflowTemplate {
  id: string
  title: string
  description: string
  inputs?: WorkflowInputSlot[]
  steps: WorkflowStepTemplate[]
  createdAt: string
  updatedAt: string
}

interface WorkflowInputSlot {
  id: string
  name: string
  description: string
  required: boolean
  cardinality: 'one' | 'many'
}

type WorkflowStepSource =
  | { kind: 'input'; inputId: string }
  | { kind: 'previous-output' }

interface WorkflowStepTemplate {
  id: string
  label: string
  instruction: string
  acceptance: string
  modelId?: string
  sources?: WorkflowStepSource[]
}
```

规则：

- WorkflowTemplate 全局保存于 `workflows-v2/`，不嵌入 Board。
- `steps` 至少一项，数组顺序即执行顺序，ID 在模板内唯一。
- 新模板必须保存至少一个具名 `inputs` 槽；槽 ID 唯一，名称非空，数量约束为 `one` 或 `many`。每步 `sources` 保留原有有序来源角色，只能引用模板输入槽或前一步成果；第一步不得引用 `previous-output`。
- 旧模板可能没有 `inputs` 和 `sources`。读取时将其解释为一个必填、多值的“起始内容”槽：第一步读取该槽，后续步骤读取前一步成果；不得为了兼容而改写原文件。
- 模板保存方法，不保存来源正文、Card ID、目标 Card ID、坐标、Version、Run、Candidate 或会话。
- 模板保存步骤的可选 `modelId` 覆盖；未覆盖步骤在每次应用后继续继承运行时模型。
- 创建请求中的来源 Board 和 Transformation ID 只用于提取校验，不进入模板正文；原 Board 变化或删除不改变模板。
- v1 模板正文不可更新。方法变化时必须从已验证路径创建新模板，再显式删除旧模板。
- 模板删除不修改任何 Board。已有 `workflowRef` 仍保留原 ID 并显示“模板已删除”。

### 5.2 从路径提取模板

创建请求引用一个 Board 和有序 Transformation ID：

```ts
interface CreateWorkflowRequest {
  title: string
  description?: string
  sourceBoardId: string
  transformationIds: string[]
  inputs: Array<{
    sourceCardId: string
    name: string
    description: string
    required: boolean
    cardinality: 'one' | 'many'
  }>
}
```

服务必须在保存前校验：

1. 所有 Transformation 存在于同一 Board。
2. 顺序中的第一步允许 `1..N` 个来源。
3. 从第二步开始，每一步必须包含且只包含一次前一步目标；还可以读取具名外部输入。
4. 路径无重复 Transformation、无环、无 fan-out 选择歧义；每个外部来源 Card 必须恰好映射到一个输入槽。
5. 每一步的目标 Card 都有当前 Head，且 Head 内容非空白、结构可用；Head 可以来自人工 Version，不要求存在成功 Run。
6. 标题非空；每一步 instruction 非空。

Head 内容可用性的判定是确定性的：Head ID 必须引用当前 Card 的真实 Version；Markdown 经 `trim()` 后必须非空；file-reference 必须具有非空路径并通过 CardContent 结构校验。不读取历史非 Head，也不以“存在 headVersionId”代替内容检查。

不符合条件时返回结构化错误，不能猜测顺序、丢掉合并来源或自动选择分支。非线性或闭环路径返回 `WORKFLOW_NOT_LINEAR`；任一步缺少可用当前 Head 内容时返回 `WORKFLOW_STEP_UNVERIFIED`。

### 5.3 PlanDraft、WorkflowApplication 与 WorkflowPlan

```ts
interface ApplyWorkflowRequest {
  inputBindings: Array<{
    inputId: string
    sourceRefs: SourceRef[]
  }>
  targetPosition: { x: number; y: number }
}

interface WorkflowApplicationResult {
  workflow: WorkflowTemplate
  applicationId: string
  transformations: Transformation[]
  targetCards: ContentCard[]
}

interface CreatePlanRequest {
  title: string
  sourceRefs: SourceRef[]
  steps: Array<{
    label: string
    instruction: string
    acceptance: string
    modelId?: string
  }>
  targetPosition: { x: number; y: number }
}

interface PlanApplicationResult {
  planId: string
  title: string
  transformations: Transformation[]
  targetCards: ContentCard[]
}
```

PlanDraft 是 UI 草稿，不进入 Board。WorkflowApplication 和直接计划创建都是命令，不单独持久化。每条新 Transformation 写入同一个 `planRef.planId` 以及明确的 `stepIndex/stepTotal`；应用模板时 `planId === applicationId`，并额外写入原有 `workflowRef`。

应用算法必须在一次 Board 原子写入中完成：

1. 校验模板、Board、输入槽绑定、SourceRef、Version 和目标位置；必填槽不能为空，`one` 恰好一张，`many` 至少一张，未知或重复槽拒绝。
2. 为每个步骤创建一个空 ContentCard。
3. 按每步 `sources` 顺序展开已绑定的输入槽和前一步目标，得到普通 Transformation 的有序来源；同一 Card 不得在一步中重复。
4. 为每步创建普通 Transformation，写入相同 `applicationId`、对应 `stepId` 和 `source: 'template'` 的 `planRef`。
5. 以稳定水平间距铺出线性计划，避免覆盖现有对象。
6. 校验完整 Board 后原子保存。
7. 返回 `workflow`、`applicationId`、所创建的 Transformation 与目标 Card；**不得创建 Run、Version、Candidate 或外部副作用**。

画布上的未完成方法骨架是 UI 草稿，不进入 Board，也不允许持久化缺少来源的 Transformation。SourceRef 的 Version 用于确认绑定时用户选择的输入上下文，必须等于对应 Card 的当前 Head。若已经变化，服务返回 `SOURCE_VERSION_CHANGED`，UI 刷新绑定后由用户重新确认。v1 不把历史 Version 固定到计划；需要从旧版开始时，用户先将该版本恢复为最新。应用后实际运行仍按普通 Run 规则冻结运行时的 Card Head。

重复应用同一模板必须生成新的 `applicationId`、Card 和 Transformation，不复用或覆盖旧计划。

直接计划通过 `POST /boards/:boardId/plans` 原子创建。页面 PlanDraft 先要求用户填写计划名称、最终成果和至少一个有序步骤；`finalOutcome` 是 UI 输入，用作最后一步 label，提交服务时仍归一化为普通 `steps[]`，不新增持久字段。v1 只支持一个有序的起始 `sourceRefs` 集合：第一步读取全部起始来源，之后每一步只读取上一步目标。服务必须校验标题、至少一个步骤、每步非空 label/instruction、当前 SourceRef 和目标位置；随后为每步创建一个空 Card 和普通 Transformation，写入 `source: 'ad-hoc'` 的同组 `planRef`，在一次 Board 保存后返回全部对象。请求失败时 Board 零写入；成功或失败都不得创建 Version、Run、Candidate、WorkflowTemplate 或外部副作用。

### 5.4 Workflow v1 结构限制

- 计划严格线性。
- 每一步可读取上一步成果和一个或多个具名外部输入槽；步骤依赖骨架仍严格线性。
- 无条件分支、循环、并行、join、timer、webhook 或事件触发。
- 无缺少目标边界的“运行整个流程”命令；用户只能对一条具体 Transformation 发出`运行到这里`。
- 用户可以手动修改、删除或另画新方向；修改后的 Board 仍是普通对象，不反向改写模板。
- 直接计划只支持“起始内容 -> 上一步成果”的简单线性来源；额外输入槽仍通过已验证模板表达。

## 6. Run 与安全写回

### 6.1 来源快照

```ts
interface SourceRef { cardId: string; versionId: string }

interface SourceSnapshot extends SourceRef {
  contentKind: 'markdown' | 'file-reference'
  resolvedContent: string
  digest: string
}
```

开始 Run 时按 Transformation 的来源顺序读取当前 Head，冻结完整 snapshot、目标基线和实际模型选择。`sourceSnapshot` 数组顺序即来源顺序，不另存 `order`；file-reference 的 `resolvedContent` 是运行开始时读取到的实际文本。之后来源变化不改变该 Run。

### 6.2 TransformationRun

```ts
interface RunProgress {
  phase: string
  label: string
  detail?: string
  updatedAt: string
}

interface RunProgressEvent {
  sequence: number
  phase: string
  label: string
  detail?: string
  occurredAt: string
}
```

Run 至少持久化：ID、Board/Transformation/target ID、source snapshots、target base version ID、`modelSnapshot:{provider,model}`、状态、当前 `progress`、最近的 `progressEvents`、错误、Candidate 或 applied version ID，以及时间戳。平台无法解析或执行步骤指定模型时必须在创建持久 Run 前失败；成功创建的 Run 不得在执行中静默换模型。

- `phase` trim 后为 `1..40` 字符，`label` 为 `1..160` 字符，可选 `detail` 最多 200 字符；进度对象不得包含其他字段。
- `progressEvents` 最多保留最近 20 条，`sequence` 在一个 Run 内严格递增且裁剪后不重新编号。存在事件时，`progress` 必须精确镜像最后一条事件的阶段、文案、细节和时间。
- 每个接受的模型进度以及 `succeeded`、`failed`、`interrupted` 终态都在同一 Run 锁内追加事件。终态事件使用固定、脱敏的产品文案，不复制供应商原始错误、Prompt、reasoning、秘密、工具参数或工具输出。
- Run 到达终态后忽略迟到进度。服务启动恢复活动 Run 时追加 `interrupted` 事件；旧 Run 缺少 `progressEvents` 时继续合法，不补写虚构历史。
- RunStore、BoardArtifact 与 MiraBackup 使用同一严格校验；超限、非递增 sequence、未知字段或 `progress` 与末事件不一致均视为损坏并 fail closed。

模型输出必须是可直接写入成果 Card 的正文，不得包含 agent、会话、工具、report、文件写入、上级代理或“已完成/以下为正文”等执行交付说明。该约束属于生成提示与验收契约；系统仍保存模型实际返回的完整文本，不通过静默字符串删除伪造结果。

状态转换：

```text
queued -> running -> succeeded(applied | candidate)
                  -> failed
                  -> interrupted
```

终态不可被迟到的异步回调覆盖。

### 6.3 Compare-and-swap

Run 开始时记录 `targetBaseVersionId`，允许为 `null`。成功写回时：

- 当前 Head 等于 base：追加 AI Version 并设为 Head，Run 为 `succeeded/applied`。
- 当前 Head 不等于 base：不修改 Card，保存 Candidate，Run 为 `succeeded/candidate`。

直接采用结果时，将 Transformation 的 `lastAppliedRunId` 更新为本 Run。采用 Candidate 时必须再次比较用户打开对比时的 Head；Head 再次变化则返回冲突并刷新，不得强行采用，采用成功后才更新 `lastAppliedRunId`。丢弃 Candidate 不改变它。

同一 Transformation 存在未处理 Candidate 时，启动新 Run、更新或删除 Transformation 均返回 `CANDIDATE_PENDING`。采用或丢弃 Candidate 后才解除门禁。

模型返回非空结果后采用两阶段安全提交：先把完整 output/digest 作为 `succeeded/candidate` 持久化，再尝试更新 Board；目标仍在 base 时追加带 `sourceRunId` 的 Version 并更新 `lastAppliedRunId`，最后将 Run 收敛为 `applied`。第一阶段失败时 Board 零写入；Board 或最后一次 Run 写入失败时，持久 Candidate 继续可达，输出不能只留在内存或日志。

### 6.4 Stale

stale 必须只相对 `lastAppliedRunId` 指向的 Run 判断，不能被最近一次失败、停止或 Candidate 尝试遮蔽。先精确比较 Transformation 当前有序 `sourceCardIds` 与该 Run 的有序 source snapshot Card ID；数量、成员或顺序任一变化即 stale。结构一致时，再比较每个 snapshot Version/digest 与对应 Card 当前 Head/文件内容；任一变化即 stale。无已采用 Run 时不是 stale。

Stale 只提供提示，不会自行运行、创建 Card 或创建分支。它是`运行到这里`判断某一步是否需要重新生成的依据之一。

### 6.5 运行到这里

`运行到这里`是前端对现有单步 Run API 的有界顺序编排，不新增 Workflow 执行对象或 run-all endpoint：

1. 用户必须指定一条目标 Transformation；系统沿目标每个来源 Card 的生产 Transformation 向上遍历，得到无重复、上游优先且以目标结尾的依赖序列。
2. 每步开始前基于最新 Board 与 Run 重新判断：目标无可用 Head 时运行；有 `lastAppliedRunId` 且当前有序来源或来源 Head 与快照不一致时运行；其他步骤跳过。目标已有人工内容但从未产生已采用 Run 时保持不变，不以模型结果覆盖。
3. 一个上游步骤成功写入新 Head 后，下游会在下一次判断时成为 stale，因此按序重新生成；不得预先冻结整条序列的 SourceRef。
4. 每次只启动一个普通 Run，并等待其终态后再判断下一步。Run 的冻结来源、模型快照、compare-and-swap 与 Candidate 规则完全不变。
5. 任一步存在未处理 Candidate、来源不可用、运行失败、被停止、状态无法确认或 Board 已切换时立即停止；目标之后的 Transformation 永不启动。
6. 同一页面同时最多有一个`运行到这里`序列。刷新或关闭页面不恢复客户端序列；已启动的单个 Run 仍按普通恢复规则跟踪。

普通 Transformation 和 WorkflowPlan 使用同一规则。来源变化本身仍是零 Run；只有用户点击具体目标的`运行到这里`才开始上述检查。

## 7. 原子性与并发

- Board 和 WorkflowTemplate 写入均使用临时文件、重新读取校验、原子 rename。
- 批量创建、移动和删除 Card 分别只提交一次 Board 变更；整批预检完成前不得写入，失败不得保留部分结果。
- 应用 Workflow 是单次 Board compare-and-save；任何步骤创建失败都零写入。
- 同一目标 Card 同时只允许一个活动 Run；无关目标可并行。
- Transformation 更新和删除必须与同一目标的 Run 启动互斥；活动 Run 或无法确认 Run 状态时不修改 Board。
- 创建 Card + Transformation、应用 Workflow、采用 Candidate 都必须以最新 Board 为前提，冲突返回可重试错误。
- 删除模板与应用模板并发时，应用必须在读取和提交阶段确认模板仍有效。
- 服务启动先对账持久 Candidate：若目标历史已存在 `sourceRunId` 对应 Version，则幂等补齐 `lastAppliedRunId` 并把 Run 收敛为 applied；之后才把真正仍活动的旧 Run 标为 interrupted。对账读取失败时启动 fail closed。
- 上述互斥只覆盖单个 bridge 进程。同一 workspace 必须遵守单写者运行约束；当前版本不承诺多个 bridge 进程并发修改同一数据目录。

### 7.1 可移植数据包

Board 导出使用以下版本化 envelope；字段可增加，但 `format` 与未知 `formatVersion` 必须严格拒绝：

```ts
interface WorkflowProvenanceSnapshot {
  workflowId: string
  title: string
  description: string
  inputs?: WorkflowInputSlot[]
  steps: WorkflowStepTemplate[]
}

interface BoardArtifactV1 {
  format: 'mira-board'
  formatVersion: 1
  exportedAt: string
  board: BoardV2
  runs: TransformationRun[]
  workflowProvenance: WorkflowProvenanceSnapshot[]
  fileDependencies: Array<{ path: string; occurrenceCount: number }>
  externalReferences: Array<
    | { kind: 'inspiration'; boardId: string; cardId: string; versionId: string }
    | { kind: 'workflow'; workflowId: string; stepId?: string }
    | { kind: 'historical'; objectKind: 'card' | 'version' | 'transformation' | 'run'; objectId: string }
  >
}

interface MiraBackupV1 {
  format: 'mira-backup'
  formatVersion: 1
  exportedAt: string
  boards: BoardV2[]
  runs: TransformationRun[]
  workflows: WorkflowTemplate[]
}

interface MiraBackupV2 {
  format: 'mira-backup'
  formatVersion: 2
  exportedAt: string
  boards: BoardV2[]
  runs: TransformationRun[]
  workflows: WorkflowTemplate[]
  inspirationPool?: InspirationPool
  checkpoints: BoardCheckpointV1[]
}
```

- 导出 Board 前必须在 Board lifecycle lock 内取得该 Board 与所属 Run 的一致读取边界；存在活动 Run 时返回 `EXPORT_BUSY`。导出和完整备份都移除 `runtime.rootSessionId`，不读取 file-reference 正文，不包含 API Key、进程模型设置、窗口状态、日志、CanvasHistory、剪贴板或 PlanDraft。
- BoardArtifact 包含该 Board 的全部 Run，以及当前仍存在且被 `workflowRef` 引用的方法 provenance 快照。快照只用于导入预览和出处解释，不是 WorkflowTemplate，导入不得向全局 WorkflowStore 安装或覆盖方法。已经删除或位于包外的出处进入显式外部引用清单，不能在导入时按同名 ID 绑定本地对象。
- 非 legacy 方法快照中，每个 `kind: 'input'` 的 step source 必须引用同一快照内的输入槽；缺少 `inputs` 的旧模板沿用 5.1 的 legacy 单槽解释，但导出和导入都不改写 artifact。
- `fileDependencies` 从全部 file-reference CardVersion 的原始路径汇总去重，只记录出现次数；导出不得读取、stat 或 digest 引用文件。导入只接受无 NUL、非绝对、规范化后不含 `..` 段的 workspace-relative 路径，校验失败时零文件写入。
- Markdown Card 的 `fileBinding` 不属于可移植数据；导出前移除绑定元数据，导入后 Card 保持未绑定。`fileDependencies` 仍只统计 file-reference Version，不能借此导出绑定文件。
- 导入 BoardArtifact 总是创建 `active`、`revision: 0` 的副本，不 merge、不覆盖，也不保留 artifact 中的 archived/trashed 状态。包内只允许终态 Run；`queued` 或 `running` Run 使整包返回 `BOARD_IMPORT_INVALID`。同一数据包可以重复导入为互相独立的 Board。
- 导入前一次性生成新 Board/Card/Version/Transformation/Run/planId/applicationId 身份，并一致重映射 Board ID、Card ID、Version 的 ID/cardId/sourceRunId/restoredFromVersionId、Transformation 的 ID/source/target/lastRun/lastApplied/planId/workflow application 与 step provenance，以及 Run 的 ID/boardId/transformationId/sourceSnapshot card/version/target/targetBase/result appliedVersionId。当前 Board 结构引用必须在包内闭合；合法历史 Run 指向已删除对象、包外 inspiration、缺失方法和其他包外出处时，为每个出处生成不解析到本地对象的 opaque 新 ID，并列入 `externalReferences`，不能因为字符串相同绑定当前 workspace 对象。包内 Board 残留的 `relations` 字段按第 3 节规则静默忽略。
- 任何 staging 写入前都必须按领域作用域拒绝重复的被拥有对象 ID。BoardArtifact 的 Board ID 恰好一个，Card、Version、Transformation 和 Run ID 在各自作用域内唯一；MiraBackup 的 Board、Run、WorkflowTemplate 和 Checkpoint ID 分别全局唯一，每个 Run 与 Checkpoint 的 `boardId` 必须恰好对应一个包内 Board，各 Board 内部对象继续通过完整 Board schema 校验。
- 导入在 staging 中完成格式、大小、数量、schema、路径、当前结构闭合性和完整 ID 映射校验；任一检查或提交失败时，生产 Board/Run/Workflow 列表零可见写入。导入不得调用 Card 删除恢复 API，也不得写 WorkflowStore。
- HTTP import 请求 body 上限为 `64 MiB`，超过限制返回 `PAYLOAD_TOO_LARGE` 且不继续缓冲或解析。V1 还限制恰好 1 个 Board、最多 10,000 张 Card、100,000 个 CardVersion、50,000 条 Transformation、100,000 个 Run 与 1,000 个 workflow provenance；任一超限整包拒绝。
- Board exporter 在生成下载前执行与 V1 importer 相同的安全路径、对象数量和 UTF-8 JSON 序列化字节上限检查。危险历史路径返回 `BOARD_EXPORT_INVALID` 并列出受影响 Card/Version，其他超限返回 `PAYLOAD_TOO_LARGE` 与超限类别；失败时不生成 artifact。任一成功导出的 BoardArtifact 必须可由同版本 importer 立即导入。
- MiraBackup V2 包含 active、archived、trashed Board、全部 Run、全部 WorkflowTemplate、可选灵感池和全部 Checkpoint，并在新 workspace 恢复时保留这些受管对象的原身份与生命周期，不执行 BoardArtifact 的副本 ID remap。V1 继续可恢复并按零 Checkpoint 处理。备份取得当前进程的独占 snapshot lease，拒绝活动 Run；严格读取任一成员失败时整体失败，不能复用会跳过损坏成员的普通列表投影。
- backup exporter 与 restore 的 V1/V2 UTF-8 JSON 字节上限均为 `256 MiB`；restore 必须在解析前 stat 并拒绝更大文件，不得先无界读入。备份限制最多 1,000 个 Board、100,000 张 Card、1,000,000 个 CardVersion、500,000 条 Transformation、1,000,000 个 Run、10,000 个 WorkflowTemplate 与每 Board 20 个 Checkpoint。超过任一限制返回 `BACKUP_TOO_LARGE` 和超限类别，目标 workspace 零写入。
- 完整备份恢复只允许写入不存在或经 lstat 验证为真实非 symlink 空目录的 workspace。恢复必须在目标父目录下创建同文件系统临时根，生成完整 workspace 并严格重读；重读后的 Board/Run/Workflow 实体 ID 集合与数量必须和已验证数据包完全一致。验证通过后以一次目录 rename 提交，不能把 `boards-v2/`、`runs-v2/`、`workflows-v2/` 分别视为成功。目标不存在时直接 rename；目标为空目录时提交前再次确认仍为空，移除该空目录后立即 rename。提交前失败删除临时根；最终 rename 失败时目标保持不存在或为空并清理临时根，允许同一命令重试。运行中的 HTTP surface 只允许下载备份，不提供覆盖恢复命令。
- Desktop 在 Host 启动前的 workspace chooser 提供`从 Mira 备份恢复`：选择备份与新建/空目录，恢复成功后才启动该 workspace，失败则停留在 chooser。Standalone 提供离线命令 `pnpm restore:backup -- --input <backup> --workspace <empty-dir>`，且目标非空时失败。桌面入口必须有定向测试和对应架构 packed smoke；浏览器 BoardManager 不声称可以完成整库恢复。

## 8. HTTP 契约

外部基础路径：`/graphmind/api/v2`。下表的 Path 省略该前缀。

```ts
type BoardLifecycleState = 'active' | 'archived' | 'trashed'

interface BoardSummary {
  id: string
  title: string
  state: BoardLifecycleState
  revision: number
  updatedAt: string
}

interface RenameBoardRequest { title: string; baseRevision: number }
interface BoardLifecycleRequest { baseRevision: number }
interface PurgeBoardRequest { baseRevision: number; confirmation: 'permanently-delete' }
interface ImportBoardRequest { artifact: BoardArtifactV1 }
interface CreateBoardCheckpointRequest { title: string; note?: string; baseRevision: number }
interface UpdateBoardCheckpointRequest {
  title?: string
  note?: string | null
  baseMetadataUpdatedAt: string
}
interface ForkBoardCheckpointRequest { title?: string }
```

`GET /boards` 与 `GET /boards/catalog` 响应 `{ boards: BoardSummary[] }`。重命名、归档、移入废纸篓与恢复响应 `{ board }`。导出和备份直接响应对应 JSON envelope，`Content-Type` 为 `application/json`；浏览器分别生成 `<safe-title>.mira-board.json` 与 `mira-YYYYMMDD-HHmm.mira-backup.json` 文件名。导入响应 `{ boardId, board, imported: { runCount, externalReferenceCount } }`，不向客户端返回巨大的内部 ID 映射。

| Method | Path | 作用 |
| --- | --- | --- |
| `GET` | `/boards` | 只列出 active v2 画板摘要 |
| `POST` | `/boards` | 创建空画板 |
| `GET` | `/boards/catalog` | 列出 active、archived 与 trashed 生命周期摘要，供画板管理入口使用 |
| `GET` | `/boards/:boardId` | 读取一个完整 Board 聚合 |
| `PATCH` | `/boards/:boardId` | 使用 `baseRevision` 重命名 active 或 archived Board |
| `POST` | `/boards/:boardId/archive` | 将无活动 Run/Candidate 的 active Board 归档 |
| `POST` | `/boards/:boardId/trash` | 将无活动 Run/Candidate 的 active/archived Board 移入废纸篓 |
| `POST` | `/boards/:boardId/restore` | 将 archived/trashed Board 恢复为 active |
| `POST` | `/boards/:boardId/purge` | 对 trashed Board 做明确确认后的不可撤销清除，并原子移除其 Board 级 Run 与 Checkpoint |
| `GET` | `/boards/:boardId/export` | 导出版本化 BoardArtifact；不嵌入引用文件正文或秘密配置 |
| `POST` | `/boards/imports` | 严格校验 BoardArtifact 并导入为全新身份的 Board 副本 |
| `GET` | `/boards/:boardId/checkpoints` | 按创建时间倒序列出轻量 Checkpoint 摘要 |
| `POST` | `/boards/:boardId/checkpoints` | 以 `baseRevision` 为 active Board 手动保存命名 Checkpoint |
| `GET` | `/boards/:boardId/checkpoints/:checkpointId` | 读取完整 Checkpoint 供只读预览与客户端比较 |
| `PATCH` | `/boards/:boardId/checkpoints/:checkpointId` | 以 `baseMetadataUpdatedAt` 更新名称或备注，不改 artifact |
| `DELETE` | `/boards/:boardId/checkpoints/:checkpointId` | 以 `confirmation: 'delete-checkpoint'` 不可撤销删除 Checkpoint |
| `POST` | `/boards/:boardId/checkpoints/:checkpointId/forks` | 通过 BoardArtifact ID remap 创建全新 active Board 副本 |
| `GET` | `/boards/:boardId/checkpoints/:checkpointId/export` | 将 Checkpoint 的已验证 artifact 下载为普通 BoardArtifact |
| `GET` | `/inspiration-pool` | 读取 workspace 灵感池 |
| `POST` | `/inspiration-pool/entries` | 独立记录一条 Markdown 灵感和可选标签 |
| `PATCH` | `/inspiration-pool/entries/:entryId` | 原子编辑正文与标签，检查 Head 和更新时间基线 |
| `GET` | `/backup` | 导出当前 workspace 的一致 MiraBackup（含灵感池）；不提供当前 workspace 覆盖恢复 |
| `POST` | `/files/browse` | 浏览一个本地目录并列出可选择的子目录与文件；不提供文件浏览的宿主返回 `FILES_UNAVAILABLE` |
| `POST` | `/files/import` | 把一个文件解析为 workspace 相对路径；工作区外文件先拷贝备份进 `attachments/` 并去重命名 |
| `POST` | `/boards/:boardId/cards` | 创建 Markdown 或工作区 file-reference Card |
| `POST` | `/boards/:boardId/cards/batch` | 原子创建 `1..100` 张独立 Card |
| `POST` | `/boards/:boardId/cards/restore` | 仅用同一进程的精确删除回执恢复 Card，服务当前会话 undo |
| `PATCH` | `/boards/:boardId/cards` | 原子更新一组 Card 的位置或尺寸 |
| `DELETE` | `/boards/:boardId/cards` | 原子删除一组无结构引用的 Card |
| `PATCH` | `/boards/:boardId/cards/:cardId` | 更新单张 Card 的位置、尺寸、标签或名称；元数据变化不创建 Version |
| `DELETE` | `/boards/:boardId/cards/:cardId` | 删除未被任何结构引用的 Card |
| `GET` | `/boards/:boardId/cards/:cardId/content` | 解析当前 Head 正文；file-reference 从 workspace 读取当前文件内容 |
| `POST` | `/boards/:boardId/cards/:cardId/versions` | 以当前 Head 为 base 提交人工 Version |
| `POST` | `/boards/:boardId/cards/:cardId/versions/:versionId/restore` | 将历史内容复制为新的 Head Version |
| `POST` | `/boards/:boardId/suggestions` | 为有序当前 SourceRef 请求临时下一步建议 |
| `GET` | `/workflows` | 列出全局流程模板 |
| `POST` | `/workflows` | 从已验证路径创建模板 |
| `GET` | `/workflows/:id` | 读取模板 |
| `DELETE` | `/workflows/:id` | 删除模板，不影响 Board |
| `POST` | `/boards/:boardId/plans` | 从起始 SourceRef 原子铺出直接计划，零 Run |
| `POST` | `/boards/:boardId/workflows/:workflowId/applications` | 原子铺出 WorkflowPlan，零 Run |
| `POST` | `/boards/:boardId/transformations` | 创建普通转化和目标 |
| `POST` | `/boards/:boardId/transformations/batch` | 用同一组来源原子创建 `2..16` 个并行转化和目标 |
| `PATCH` | `/boards/:boardId/transformations/:id` | 更新文案或有序来源，保留目标、provenance 与历史 |
| `PATCH` | `/boards/:boardId/transformations/:transformationId/position` | 只更新转化块位置，不改变语义时间、来源、目标或 provenance |
| `DELETE` | `/boards/:boardId/transformations/:id` | 只删除 Transformation，保留 Card 与 Run |
| `POST` | `/boards/:boardId/transformations/:id/runs` | 显式运行一个普通步骤；`运行到这里`由客户端顺序调用 |
| `GET` | `/runs/:id` | 读取运行 |
| `GET` | `/boards/:boardId/cards/:cardId/file-binding` | 读取本地文件绑定及同步状态 |
| `PUT` | `/boards/:boardId/cards/:cardId/file-binding` | 创建或替换单文件绑定；可带显式 `overwrite` |
| `DELETE` | `/boards/:boardId/cards/:cardId/file-binding` | 解除绑定，不删除本地文件 |
| `POST` | `/boards/:boardId/cards/:cardId/file-binding/sync` | 处理自动同步或显式 `overwrite`/`import` 冲突 |
| `POST` | `/runs/:id/interrupt` | 停止活动 Run |
| `POST` | `/runs/:id/candidate/adopt` | 采用 Candidate |
| `POST` | `/runs/:id/candidate/discard` | 丢弃 Candidate |
| `GET` | `/model-settings` | Standalone/Desktop 读取脱敏的当前进程模型设置；自定义宿主可不提供 |
| `PUT` | `/model-settings` | Standalone/Desktop 更新当前进程的 OpenAI-compatible 设置 |
| `POST` | `/model-settings/test` | 使用待保存设置测试一次连接，不写 Board/Run/Workflow |

`POST /boards/:boardId/plans` 是 command-only endpoint，没有对应 GET、PATCH 或 DELETE；这不表示存在独立 Plan 资源。Workflow v1 不提供 run-all、resume-plan、trigger 或 branch API。`运行到这里`始终有具体目标并顺序复用单步 Run API，不产生新的服务端计划运行资源。模板正文编辑若未提供原子更新端点，UI 只允许删除后重新提取，不得伪装成已保存编辑。

Transformation PATCH 请求体是 `UpdateTransformationRequest`，位置 PATCH 路径为 `/boards/:boardId/transformations/:transformationId/position`，请求体是 `UpdateTransformationPositionRequest`；两者都响应 `{ transformation }`。Transformation DELETE 响应 `{ deletedTransformationId }`。这些操作都修改 Board 聚合，但结构删除不返回或删除 Card/Run。

`cards/restore` 只接受服务进程持有的精确删除回执，不是 import。App bar 的`文件`通过目录选择器创建 file-reference Card：选择器经 `files/browse` 浏览目录，工作区外文件经 `files/import` 拷贝备份到 `attachments/` 后仍只以 workspace 相对路径创建 Card，这不是 BoardArtifact 式数据导入，Card 也不跟踪原文件变化；BoardArtifact 导入只能经过独立的严格验证、ID 映射与 staging 命令。`files/browse` 与 `files/import` 由具备本地文件系统能力的宿主（Standalone/Desktop）提供，其他宿主可以缺席并返回 `FILES_UNAVAILABLE`。完整备份恢复不属于当前运行 workspace 的 HTTP surface。`boards/:boardId/purge` 只接受 trashed Board 和确认值，不提供恢复端点。

批量创建响应 `{ cards }`，批量更新响应 `{ cards }`，且顺序与请求一致；批量删除响应 `{ deletedCardIds, restoreReceiptId }`，单卡删除响应 `{ deletedCardId, restoreReceiptId }`，回执恢复响应 `{ cards }`。批量创建请求以 `poolSource` 选择经服务端核对的池版本和 `tags`，响应 Card 携带 pool 形式 `inspirationRef`，但不复制或删除 Transformation、Run 或 Workflow 数据。灵感池直接记录使用独立的 `/inspiration-pool/entries` 命令。

错误统一返回 `{ code, message, details? }`。至少区分：`BAD_REQUEST`、`PAYLOAD_TOO_LARGE`、`BOARD_NOT_FOUND`、`BOARD_CONFLICT`、`BOARD_READ_ONLY`、`BOARD_PURGE_INVALID`、`BOARD_EXPORT_INVALID`、`BOARD_IMPORT_INVALID`、`BACKUP_INVALID`、`BACKUP_TOO_LARGE`、`WORKSPACE_LOCKED`、`EXPORT_BUSY`、`CHECKPOINT_NOT_FOUND`、`CHECKPOINT_INVALID`、`CHECKPOINT_LIMIT`、`CHECKPOINT_TOO_LARGE`、`CHECKPOINT_CONFLICT`、`CHECKPOINT_WRITE_FAILED`、`CARD_NOT_FOUND`、`CARD_IN_USE`、`CARD_ALREADY_EXISTS`、`CARD_RESTORE_CONFLICT`、`PLAN_INVALID`、`WORKFLOW_NOT_FOUND`、`WORKFLOW_NOT_LINEAR`、`WORKFLOW_STEP_UNVERIFIED`、`WORKFLOW_INPUT_INVALID`、`WORKFLOW_BINDING_INVALID`、`TRANSFORMATION_NOT_FOUND`、`TRANSFORMATION_INVALID`、`TRANSFORMATION_CONFLICT`、`TRANSFORMATION_SOURCE_INVALID`、`SOURCE_REQUIRED`、`SOURCE_READ_FAILED`、`SOURCE_VERSION_CHANGED`、`TARGET_BUSY`、`CANDIDATE_PENDING`、`FILE_ENTRY_NOT_FOUND`、`FILE_IMPORT_FAILED`、`FILES_UNAVAILABLE`、存储失败和校验失败。`PAYLOAD_TOO_LARGE`、`CHECKPOINT_TOO_LARGE`与 `BACKUP_TOO_LARGE` 返回 HTTP 413；格式/路径无效返回 HTTP 422；冲突、只读、busy、pending、上限、永久清除拒绝、永久失效回执与 workspace 锁返回 HTTP 409；`CHECKPOINT_NOT_FOUND` 返回 404。Checkpoint 写失败时可见列表零半写。

文件绑定相关错误码为 `FILE_BINDING_INVALID`（路径、Card 类型或请求无效）、`FILE_BINDING_CONFLICT`（首次绑定已有不同文件内容或路径已被占用）、`FILE_SYNC_CONFLICT`（外部文件在同步基线之后发生变化）和 `FILE_SYNC_FAILED`（文件读取或原子写入失败）。前两者与同步失败按 422/409/500 的既有错误映射返回；冲突不得自动覆盖文件。

## 9. 验收矩阵

| ID | 场景 | 必须结果 |
| --- | --- | --- |
| `CARD-01` | 人工提交 Draft | 追加 Version，历史不变 |
| `CARD-02` | 恢复旧版 | 创建新的 Head Version |
| `CARD-03` | 复制并粘贴多张 Card | 新 Card 保留当前 Head 内容、尺寸和组内相对布局；ID、历史、关系、运行和 Workflow provenance 均不复制 |
| `CARD-04` | 在 Board A 复制后切换到 Board B 粘贴 | 当前页面会话内可用；刷新后不可用，系统剪贴板不变 |
| `CARD-05` | 批量创建或移动中任一项无效/保存失败 | Board 零写入，不出现部分 Card 或部分位置更新 |
| `CARD-06` | 批量删除中任一卡被 Transformation 引用 | 返回 `CARD_IN_USE`，整批 Card 保持不变，相关结构不级联 |
| `CARD-07` | 删除一组无引用 Card | UI 二次确认后一次删除整组，响应 ID 顺序与请求一致 |
| `CARD-08` | 撤销/重做已提交 Markdown 编辑 | 每次都从当前 Head 追加新 Version；旧 Version 不修改，切换 Board 后会话历史清空 |
| `FILE-01` | Markdown Card 绑定工作区文件 | 一 Card 一文件；同内容已有文件建立基线，不同内容必须显式确认覆盖 |
| `FILE-02` | 绑定 Card 产生新 Head | 文件自动原子更新，绑定基线指向新 Version；不产生额外 Card |
| `FILE-03` | 外部修改后产生新 Head | CardVersion 保留，文件不被覆盖，状态为 conflict |
| `FILE-04` | 处理同步冲突 | overwrite 覆盖文件；import 追加 human Version；两者都重新校验文件 digest |
| `FILE-05` | 导出、复制或解除绑定 | 不导出/复制绑定元数据；解除绑定不删除本地文件或历史 Version |
| `CARD-09` | 撤销一批刚删除的无引用 Card | 只接受同一进程保存的精确回执，恢复原 ID 与完整 Version 历史；伪造、重复或服务重启后恢复返回冲突且零写入 |
| `CARD-10` | 撤销创建、移动或删除时结构/保存状态已经不允许重放 | 沿用普通 API 门禁并显示失败；不得绕过 `CARD_IN_USE`，Board 不产生部分写入 |
| `CARD-11` | 六批各 100 张删除后撤销仍在 50 条历史中的最早批次 | 按批次回执完整恢复，不因 Card 数量提前淘汰 |
| `CARD-12` | Bridge 重启后栈顶 delete 永久失效、其下仍有 move | 第一次撤销明确失效且零写入；失效项不再阻挡第二次撤销 move；暂时错误仍保留原项 |
| `INSP-01` | 修改一张 Card 的标签 | 只更新 Card 元数据；Version、Head、Transformation、Run 与 stale 不变 |
| `INSP-02` | 按正文和多个标签筛选 workspace 灵感池 | 只返回当前可用 Head 且满足全部标签的候选；Board 与灵感池零写入 |
| `INSP-03` | 切换筛选条件并继续挑选 | 已明确选择和顺序保留，未选择结果不自动成为来源 |
| `INSP-04` | 将灵感池的三个候选放入当前画板 | 一次批量写入创建三个独立 Card，保留顺序、初始标签与 pool 出处，不复制灵感历史或关系 |
| `INSP-05` | 放入批次中任一标签、内容、来源定位或几何无效 | 当前 Board 零写入，不留下部分 Card |
| `INSP-06` | 取消灵感选择器或未提交的记录草稿 | Board 与灵感池均零写入、零 Run；此前已明确保存的灵感不回滚 |
| `INSP-07` | 在选择器内直接记录正文与标签 | 创建一个独立 InspirationEntry 和 human Head；当前 Canvas、选择与 CanvasHistory 完全不变，新条目不进入已选 |
| `INSP-08` | 将灵感池候选添加到当前 Board | 新 Card 按服务端布局自动落位，保留 pool 出处并作为 create entry 进入当前 CanvasHistory；原选择、编辑、drawer 与分支草稿保持不变 |
| `INSP-09` | 空白正文、无效标签或记录保存失败 | 不创建 InspirationEntry 或 Card，保留记录草稿并允许重试，不创建 Transformation 或 Run |
| `NAME-01` | 设置、清除独立卡片名称 | 只变更名称元数据，Head、版本与会话正文历史不变；缺失名称使用默认标题 |
| `NAME-02` | 同基线并发改名 | 旧基线返回 409 且零写入；UI 保留草稿并核对最新名称，迟到正文响应不能撤销已保存名称 |
| `NAME-03` | 复制、导出导入、检查点与完整备份 | 名称作为 Card 元数据保留，身份重映射沿用原规则 |
| `INSP-10` | 编辑已有灵感正文或标签 | 正文变化追加 human Version，标签变化不追加；原版本、已选快照与 Board 副本不变 |
| `INSP-11` | 并发编辑、空正文、缺失标签或存储失败 | 基线冲突返回 409，非法输入或写入失败零半写；UI 保留草稿，不自动重试覆盖 |
| `TRN-01` | 创建转化 | `1..N` 来源、一个空目标、零 Run |
| `TRN-02` | 更新转化文案或来源 | 只更新允许字段；目标、planRef、workflowRef、权限与历史不变，零 Run |
| `TRN-03` | 删除转化 | 只删除结构，Card、Run 和其他步骤保持不变 |
| `TRN-04` | 活动 Run 期间更新或删除 | 返回 `TARGET_BUSY`，Board 零写入 |
| `TRN-05` | 未处理 Candidate 时更新或删除 | 返回 `CANDIDATE_PENDING`，Candidate 保持可达，Board 零写入 |
| `TRN-06` | 两个窗口从同一 revision 更新 | 只允许一个提交；另一个返回 `TRANSFORMATION_CONFLICT`，同毫秒也不能穿过 |
| `TRN-07` | 为一条转化固定模型后运行 | 只覆盖该步骤；Run 保存实际 provider/model，其他 Transformation 和 Card 不变 |
| `TRN-08` | 清除步骤模型覆盖 | Transformation 删除 `modelId`，后续 Run 继承平台当前模型，历史 Run 快照不变 |
| `TRN-09` | 用户添加步骤 | 只创建普通 Transformation 与空目标，保持零 Run；运行只由后续显式命令启动 |
| `TRN-10` | 用户确认多个并行分支 | 一次 Board 写入创建多个共享来源的普通 Transformation 与空目标，整批成功或失败，零 Run |
| `LINK-01` | 内容卡拖线到已有转化块输入端 | 保留原来源顺序并追加该卡，重复来源不重复添加；保留目标与历史，零 Run |
| `LINK-02` | 内容卡直连 Card 或转化块发起连接 | 零写入并给出短提示；空白画布仍可从内容卡发起新方向 |
| `LINK-03` | 来源列表添加、移除和排序 | 至少一个来源；添加草稿确认前、取消和切换画板均零写入；成功后有序来源持久化，零 Run |
| `LINK-04` | 来源更新引入自身或多步依赖环、不可用来源、活动 Run、Candidate 或旧编辑基线 | 明确拒绝，原结构和历史不变；环返回 TRANSFORMATION_SOURCE_INVALID |
| `RUN-01` | Head 未变化 | AI 输出追加为新 Head |
| `RUN-02` | 运行中人工编辑 | 人工 Head 保留，输出成为 Candidate |
| `RUN-03` | 停止运行 | 终态保持 interrupted |
| `RUN-04` | 未处理 Candidate 时重新生成 | 返回 `CANDIDATE_PENDING`；采用或丢弃后才可重试 |
| `RUN-05` | Run 列表含损坏或不可读成员 | 启动、结构更新和删除均 fail closed，Board/Run 零写入 |
| `RUN-06` | 模型结果安全持久化失败 | Board 零写入；不得只在内存保留输出 |
| `RUN-07` | Board 已提交但 Run 最终收敛失败 | 完整 Candidate 保持可达；启动对账或幂等采用后收敛，不重复 Version |
| `RUN-08` | 模型生成成果 | 返回可直接编辑的成果正文，不夹带内部执行或交付说明 |
| `RUN-09` | 在下游步骤点击`运行到这里` | 上游优先检查；最新步骤跳过，空目标或 stale 步骤顺序运行，到目标后停止 |
| `RUN-10` | `运行到这里`遇到 Candidate、失败、停止或来源不可用 | 立即停止，后续步骤零 Run；已有内容与 Candidate 保持可达 |
| `RUN-11` | Run 连续产生超过 20 条公开进度 | 只保留最近 20 条；sequence 保持严格递增，当前 progress 与末条事件一致 |
| `RUN-12` | 模型进度回调带 reasoning、Prompt、密钥、工具参数或工具正文等额外字段，或终态错误正文包含敏感信息 | `progress/progressEvents` 只持久化长度受限的公开字段；固定终态事件不复制额外字段或原始错误正文 |
| `RUN-13` | 运行中刷新页面后打开目标 Card | 单个 Run 的当前阶段与进度时间线可恢复，并可直接查看或停止；整条`运行到这里`序列不自动恢复 |
| `RUN-14` | 三步依赖路径运行到最后一步 | 每个实际启动步骤前显示当前路径位置和成果名；失败、停止或 Candidate 时不启动后续步骤 |
| `STALE-01` | 最近已采用 Run 后来源 Head 变化 | 即使最近尝试失败或成为 Candidate，仍显示 stale，零自动运行 |
| `PLAN-01` | 取消或切换 Board 前的直接 PlanDraft | Board、WorkflowTemplate 和 Run 零写入 |
| `PLAN-02` | 直接添加三步计划 | 一次 Board 写入创建三张空 Card 与三条 Transformation，共享 planId，零 Run |
| `PLAN-03` | 直接计划参数、SourceRef 或保存失败 | 返回结构化错误，Board 不留下部分计划 |
| `PLAN-04` | 直接计划添加后刷新 | 仍能按 planRef 显示名称、稳定编号和同计划导航 |
| `PLAN-05` | 在直接计划任一步运行到这里 | 完全复用普通 Run、stale、Candidate 与目标边界规则 |
| `PLAN-06` | 编辑、删除或从计划另画分支 | 只改变明确目标；不级联，不自动改写模板或计划中的其他对象 |
| `PLAN-07` | 直接计划全部步骤产生可用 Head 后保存方法 | 仍通过现有模板验证；未完成步骤不得被保存为已验证方法 |
| `STALE-02` | Transformation 来源成员或顺序改变 | 立即显示 stale，直到新结果被采用 |
| `WF-01` | 从三步线性路径提取 | 保存有序三步模板，不复制正文 |
| `WF-02` | 路径包含 fan-out/cycle | 拒绝或在 UI 明确缩短，服务不猜测；后续额外来源保存为具名输入槽 |
| `WF-02A` | 任一步目标无 Head、Head 悬空或内容仅空白 | 拒绝提取，提示先完成该步 |
| `WF-03` | 应用三步模板 | 原子创建三 Card、三 Transformation、零 Run |
| `WF-04` | 在计划下游步骤运行到这里 | 按需顺序复用普通 Run/Version/Candidate，不越过所选步骤 |
| `WF-05` | 删除模板 | 已应用计划和内容保持不变 |
| `WF-06` | 应用中写入失败 | Board 零半写 |
| `WF-07` | 方法草稿缺少必填输入或数量不符 | 创建计划禁用或服务拒绝，Board 零写入 |
| `BRANCH-01` | rerun/stale/Candidate | 不创建 Card 或分支 |
| `BRANCH-02` | 用户拖线到空白画布发起新方向 | 显式创建独立目标和 Transformation 步骤 |
| `BOARD-01` | 重命名 Board | 只改变标题、revision 与更新时间；旧 `baseRevision` 返回冲突且聚合零写入 |
| `BOARD-02` | 归档、移入废纸篓或恢复 Board | 只改变生命周期元数据；Card、Version、Transformation、Run 与 WorkflowTemplate 不变 |
| `BOARD-03` | Board 有活动 Run 或未处理 Candidate 时归档/移入废纸篓 | 返回 busy/pending，Board 保持 active，Candidate 继续可达 |
| `BOARD-04` | 修改 archived/trashed Board 内容或启动 Run | 返回 `BOARD_READ_ONLY`，Board/Run 零写入 |
| `BOARD-05` | Run start 与 archive/trash 从同一 revision 并发 | 只能一个成功；Run 成功则 Board 保持 active，生命周期转换成功则零 active Run/pending Candidate |
| `BOARD-06` | Card/Transformation/Plan/Workflow/Candidate 写入与 archive/trash 并发 | 普通写入先提交则旧 lifecycle revision 冲突；生命周期先提交则普通写入只读失败；不得在 archived/trashed Board 留下迟到写入 |
| `CHECKPOINT-01` | 为稳定 active Board 手动保存画布版本 | 保存包含当前 Board、终态 Run 与方法出处的一致 BoardArtifact；Board revision 不变 |
| `CHECKPOINT-02` | 活动 Run、未处理 Candidate、旧 revision 或第 21 个 Checkpoint | 返回对应结构化错误；Checkpoint 列表和 Board 零写入，不自动淘汰 |
| `CHECKPOINT-03` | 更新 Checkpoint 名称/备注 | CAS 只修改顶层元数据；artifact 字节语义不变，冲突保留用户草稿 |
| `CHECKPOINT-04` | 从 Checkpoint 创建副本 | 新 Board 为 active/revision 0 且所有内部身份重映射；不复制 fileBinding/Checkpoint，原 Board 零写入 |
| `CHECKPOINT-05` | 归档、移入废纸篓、恢复或永久清除 Board | 前三者保留 Checkpoint；永久清除与 Board/Run/Checkpoint 原子完成或零写入 |
| `CHECKPOINT-06` | 删除或导出 Checkpoint | 删除需明确确认且不可撤销；导出是可立即导入的普通 BoardArtifact |
| `PORT-01` | 导出一个无活动 Run 的 Board | 数据包版本、Board、所属 Runs、方法出处快照和文件路径清单完整；无秘密、runtime session 或文件正文 |
| `PORT-02` | 同一 BoardArtifact 导入两次 | 创建两个身份完全独立且内部引用闭合的 Board，不绑定本地同名外部 ID |
| `PORT-03` | 导入未知版本、超限、损坏或悬空数据包 | 返回结构化错误，生产 Board/Run/Workflow 列表零可见写入 |
| `PORT-04` | 导入含活动 Run、危险文件路径或 archived/trashed 状态的数据包 | 活动 Run 或危险路径整包拒绝；合法包始终创建 active Board，且零引用文件读写 |
| `PORT-05` | 导入包含方法 provenance 的数据包 | Board 与终态 Run 可导入，全局 WorkflowStore 零写入，出处 ID 不绑定本地同名模板 |
| `PORT-06` | 导出后立即导入同一 BoardArtifact | 成功导出的 artifact 必须创建 active 副本；路径或规模不满足 V1 时导出阶段失败且不产生下载 |
| `PORT-07` | export 与 Run start 并发 | 输出为 Run 启动前的一致快照，或 export 返回 `EXPORT_BUSY`；不得输出 Board/Run 混合状态 |
| `BACKUP-01` | 备份包含各生命周期 Board 的 workspace | V2 严格包含全部 Board、Run、WorkflowTemplate、灵感池与 Checkpoint；任一成员损坏或有活动 Run 时整体失败 |
| `BACKUP-02` | 通过 Desktop chooser 或离线 CLI 向新/空 workspace 恢复完整备份 | staging 校验后完整可读；失败仍停留在 chooser/CLI 且原 workspace 不变，不提供对运行中 workspace 的覆盖恢复 |
| `BACKUP-03` | staging、验证或最终目录 rename 故障后重试 restore | 每个失败点后目标仍为空或不存在、无部分受管目录；同一备份第二次恢复可成功 |
| `BACKUP-04` | backup 或 BoardArtifact 含重复主 ID、Run 指向零个/多个包内 Board，或重读实体集不一致 | staging 提交前整体失败，目标与生产列表零写入 |
| `BACKUP-05` | 恢复 V1 或 V2 backup | V1 恢复为零 Checkpoint；V2 严格恢复完整 Checkpoint 集合，未知版本拒绝且目标零写入 |
| `ARCHIVE-01` | 请求旧 v1/Action/chain 运行时入口 | 不存在兼容 API；恢复只能使用产品之外的显式离线工具 |

## 10. 完成定义

当前画板搜索验收：只检索当前 Head 标题/全文或引用文件路径，返回命中片段；不读取历史版本、其他画板或引用文件正文。选择结果只定位并选中原 Card，保持可读缩放且不打开详情；取消不改变选择或视口。搜索与定位不改 CardVersion、Transformation、Run 或 CanvasHistory。

- 用户只有一套 Card/Transformation/Run 心智。
- 创建和应用 WorkflowTemplate 的数据契约、错误和原子性由测试覆盖。
- 应用流程后 Board 中可见完整计划，但不存在新 Run。
- 任一步都能独立编辑、运行到这里、停止、重试和处理 Candidate；按需上游检查不新增执行对象。
- 删除模板不影响已应用成果。
- 没有由系统自动生成的结构分支。
- 画布复制只产生独立 Card，内部剪贴板的页面会话边界和不复制项由测试覆盖。
- 批量 Card 创建、移动和删除具有整批预检与零部分写入测试；结构引用阻止整批删除。
- 有限 CanvasHistory 只覆盖约定的 Card 操作；正文重放继续追加 Version，删除恢复要求同进程精确回执，刷新与切换 Board 后不可用。
- Board 生命周期、只读门禁和重命名并发契约由 domain、store、route 与浏览器验收覆盖。
- BoardArtifact 的严格校验、完整 ID 映射、零可见半写，以及 MiraBackup 的完整快照与新 workspace 恢复都有故障注入测试。
- 生产 UI、HTTP API、bridge 和 bundle 均不包含 v1/Action/chain 兼容或迁移代码。
