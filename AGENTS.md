# Mira AI 协作指南

本文件是 AI 工具进入仓库后的唯一协作入口，统一导航、实现、数据安全、文档治理与验证规则。产品规则仍由 `docs/` 中的权威文档定义；不要从旧代码、示例数据或归档反推产品。

Mira 采用产品定义驱动的工作方式：先定义产品，再写规格与体验；先做事，再固化方法。

## 开始前

按顺序读取：

1. `docs/product/product-definition.md`：产品目标和不变量。
2. `docs/specs/core-specification.md`：对象、状态、API 和原子性契约。
3. `docs/architecture/system-map.md`：当前模块边界和改动路由。
4. 与任务直接相关的 UX、UI、平台适配器或迁移文档。

事实优先级依次为产品定义、核心规格、`docs/design/experience-design.md`（信息架构与交互）、`docs/design/ui-system.md`（视觉与组件）。旧数据清理与离线归档以 `docs/specs/migration-plan.md` 为准；当前进度由 `docs/refactor/implementation-roadmap.md` 与最新验证证据共同判断。README、教程与案例解释产品，不另行定义规则。

`archive/` 只用于追溯，`boards-v2/`、`runs-v2/`、`workflows-v2/`、`board-checkpoints-v1/` 和灵感池文件是数据，不是规格。默认不要读取 `.obsidian/`、`reference/`、`dist/`、`dist-bridge/` 或 `node_modules/`。

macOS 桌面薄壳已进入 Electron 44 internal Alpha，见
`docs/architecture/adr-macos-desktop-shell.md`、`docs/refactor/macos-desktop-shell-todo.md`
与最新桌面验证报告。桌面版复用现有 React UI、HTTP API 和 Node Host；不要为桌面复制
领域、Store、route 或 UI。当前产物未签名、未公证且没有自动更新，只用于内部验证，
不得按公开发布版本处理。

2026-09-10 已确认 macOS 与 Windows 均提供 arm64/x64 未签名 Actions 测试包；
`.github/workflows/desktop-build.yml` 在每次 `main` push 后自动构建（无路径过滤），并支持手动与打包相关 PR 验证。
公开仓库允许上传这些测试产物；每个目标必须在原生 runner 上通过 make 和两种 packed smoke，见 `docs/operations/desktop-internal-builds.md`。
Windows native make/packed smoke 与客户端 UI 验收必须分别记录，不以 macOS 证据替代。

## 核心不变量

- Board 上的 Card 是唯一画布内容对象；正文编辑、生成、旧版本恢复和正文撤销/重做都追加 CardVersion。
- 撤销/重做只覆盖当前画板会话内受支持的 Card 操作；撤销删除只能恢复本进程仍保留精确回执的原对象，不能成为任意导入或持久恢复入口。
- 灵感池是 workspace 级独立记录集合；灵感选择器直接记录只写入灵感池，不依赖画板。只有明确添加到当前画板时才创建带 pool 出处的普通 Markdown Card；不创建 Transformation、Run 或自动选择。
- Transformation 使用有序来源，创建后不会自动 Run。
- WorkflowTemplate 只保存已验证的方法；应用只铺计划，不自动运行。
- 提取方法时，每步目标的当前 Head 必须真实存在且正文非空白、结构可用，不能只检查 headVersionId。每一步复用普通 snapshot/CAS/Candidate 规则；Workflow v1 只支持线性计划，不提供无目标边界的 run-all、timer、webhook、条件、循环或后台执行。
- stale 只提示，Candidate 在采用或丢弃前必须保持可达。
- rerun、stale、Candidate 和 Workflow 都不自动创建分支；只有用户手动画图或明确配置目标才产生分支。
- 人工 Head 变化时，模型结果只能进入 Candidate，不能覆盖人工内容。
- 结构删除不级联删除 Card、Version 或 Run。
- Board 归档、移入废纸篓和恢复只改变生命周期元数据；活动 Run 或未处理 Candidate 存在时不得隐藏 Board。移入废纸篓不物理清除；永久清除的独立二次确认、删除范围与不可撤销边界以产品定义 §5.1 和核心规格 §3 为准。
- BoardCheckpoint 只由用户为稳定 Board 手动保存；活动 Run 或未处理 Candidate 时拒绝创建，每个 Board 最多 20 个。从检查点继续工作只创建全新 active Board 副本，不覆盖原 Board。
- BoardArtifact 导入只创建全新身份，当前结构引用闭合，合法历史缺失与包外出处使用不解析到本地对象的 opaque ID；方法出处不安装。完整备份恢复只进入新建或空 workspace，不包含秘密配置、runtime session 或 file-reference 正文。
- v1 Action/chain 只存在于离线归档，不得重新接入生产路径。

## 改动路由

- 领域类型：`src/domain/`
- 浏览器纯状态/投影：`src/v2State.ts`、`src/v2Projection.ts`、`src/workflows.ts`
- Canvas Store 公共契约：`src/v2/storeTypes.ts`
- Store 错误和传输策略：`src/v2/storePolicy.ts`
- Store 异步编排：`src/v2Store.ts`；Run、灵感池和 Checkpoint 动作分别位于 `src/v2/runSlice.ts`、`src/v2/inspirationSlice.ts`、`src/v2/checkpointSlice.ts`
- UI feature：`src/v2/`；详情、方法库、模型设置、灵感选择器、画板管理和画布版本由 `App.tsx` 延迟加载
- API client：`src/v2Api.ts`
- Bridge 请求纯策略：`bridge/v2-http-policy.js`
- Bridge 命令编排：`bridge/v2-http.js`
- 路由映射：`bridge/v2-routes.js`
- 领域写回规则：`bridge/domain/`
- 完整备份投影与严格校验：`bridge/domain/workspace-backup.js`
- 画布检查点存储与服务：`bridge/board-checkpoint-store.js`、`bridge/board-checkpoint-service.js`
- 存储和平台适配：`bridge/*-store.js`、`bridge/*-adapter.js`、`bridge/node-host.js`
- 可复用 Node runtime：`bridge/node-runtime.js`；Standalone CLI 只负责环境变量、日志与信号编排
- macOS 桌面宿主：`desktop/`；只负责 workspace、窗口、安全策略和应用生命周期
- 桌面 staging/打包/smoke：`scripts/stage-desktop.mjs`、`scripts/run-desktop-forge.mjs`、
  `scripts/packed-desktop-smoke.mjs`、`forge.config.mjs`

依赖必须指向更稳定的内层：UI -> Store/API -> route/handler -> domain/store。领域模块不能 import React、Zustand、HTTP route 或平台宿主。

## 实施规则

- 行为变更先写失败测试，再做最小实现。
- 修改领域语义时，先同步产品/规格并明确验收；只重构时保持公开 API 和错误码不变。
- UI feature 不要回到 `App.tsx` 或 `v2Store.ts` 堆积；纯映射、校验和文案策略放入可独立测试的模块。
- 新增平台能力通过适配器注入，不能让核心应用直接依赖 DSH/Cordis 或 Node 服务。
- 领域不变量放在纯函数/service；Store 只编排命令和 UI state，不成为第二个领域事实来源。Board/Workflow 写入使用校验后的临时文件与原子 rename，失败必须零半写。
- Run 冻结来源并记录目标 base；灵感直接记录不接受 Board 或坐标，添加到画板的布局与 pool 出处由服务端计算和核对。
- 新生产代码不得依赖 LegacyApp、Action HTTP、chain runner 或 archive。
- 不删除或批量改写用户 Board/Run；测试需要临时数据时使用临时目录。
- 审阅 CanvasHistory 时同时核对浏览器 50 条命令与 Bridge 每 Board 最近 50 个删除批次回执；批次内 Card 数量不能使仍在窗口内的历史提前失效，永久失效项不能阻挡更早历史。

## 数据安全与文档治理

- 可以删除已被新路径替代的源码、测试、样式、原型和重复文档；不得因清理删除已归档 v1 Board/Run 或其他原始数据。
- v1 数据只读归档；UI、HTTP API 和 Bridge 运行时不得扫描、加载或转换。恢复旧内容只能用显式离线工具生成独立 v2 文件，输入不改写、输出先校验再由操作者导入；旧 Action/chain 不自动转换为 WorkflowTemplate。
- `archive/` 不参与生产构建、运行时 import 或固定测试 fixture。
- Active 文档登记在 `docs/README.md`；同一规则只有一个权威定义，其余文档链接它。根 README 面向用户介绍产品，教程教操作，开发与维护细节放入 `docs/operations/`。
- 重复说明、旧 redirect/stub 和 HTML prototype 从 active docs 删除，历史由 archive 或 Git 提供。产品案例使用明确标注的演示材料，不能伪装成真实用户数据或模型运行证据。
- 历史验证报告保留真实事实，只添加 superseded 注记，不回写伪造结论。路线 checkbox 必须同时有实现和验证证据；验证报告分别说明产品命题、UX 可发现性、产物质量与实现正确性。
- 判断顺序：产品支持 → 规格完整（对象、状态、错误、验收）→ UX/UI 明确（关键流程、响应式）→ TDD 实现 → 工程与浏览器验证 → 同步路线与验证报告。不符合产品不变量时先补产品定义并获得用户确认。

## 多需求与多 Agent 协作

设计者负责定义产品结果、不变量、验收场景、优先级与是否必须同批交付；不需要预先指定分支、worktree、Agent 数量或合并顺序。主 Agent 作为 Integrator，应主动识别模块边界、文件热点和依赖方向，选择单 Agent、并行分支、依赖分支栈或临时集成分支。

- 小需求或强耦合改动默认单分支完成；只有能按独立验收切片拆分时才启用多 Agent。
- 相互独立的需求使用各自的 `codex/<requirement>` 分支和 `.worktrees/<requirement>`，不共用一个长期集成分支。需要整体验收的复杂需求使用 `codex/<requirement>-integration`，并为其内部切片创建短期分支。
- 有依赖的切片按稳定性从内到外排列：产品/规格 -> domain -> route/handler/store -> Store/API -> UI -> desktop。上层分支必须以已确定的下层分支为 base；真正独立的切片才从同一个绿色基线并行。
- 涉及产品语义时，先在集成基线更新权威文档并获得用户确认；不得让多个 Agent 依据各自对需求的解释并行改写产品语义。
- 并行实现前，主 Agent 必须给每个切片明确目标、验收、base commit、worktree、可修改文件、禁止触及文件、依赖与验证命令。一个文件在同一批并行工作中只能有一个 writer。
- `AGENTS.md`、产品/核心规格、共享领域类型、`App.tsx`、`src/v2Store.ts` 和 `src/styles.css` 默认视为共享热点；未显式分配独占 owner 前不允许多 Agent 并行修改。
- 每个实现 Agent 使用独立 worktree，不在主工作树共享未提交变更。并行测试使用临时 workspace 和独立端口，不得启动多个写同一真实 Mira workspace 的进程。
- 实现 Agent 只提交自己的切片，不合并其他工作分支或 `main`。交接必须报告 commit SHA、变更文件、实际运行的验证、假设与剩余风险。
- 主 Agent 按依赖顺序集成，解决冲突后重跑相关定向测试，并在集成分支运行本文完整验证门禁。最后对集成 diff 做一次独立审查，不以各分支自测代替集成验收。
- 除非用户明确要求，不推送远端、不创建 Pull Request、不合并 `main` 且不删除远端分支。
- 主 Agent 应自动给出简短的需求分类、执行拓扑与冲突点，然后直接执行无产品歧义的安全本地工作。只有需求违反产品不变量、多需求在用户行为上冲突、交付批次会改变产品结果，或涉及数据迁移、破坏性操作与对外发布时，才暂停并请设计者决策。

## 验证

最小定向测试后，完成任务前运行：

```sh
pnpm test
pnpm exec tsc --noEmit
pnpm build
pnpm build:bridge
git diff --check
```

涉及可见 UI 时，再在真实浏览器验证桌面和 390px 窄屏，检查遮挡、溢出、焦点和 console warning/error。涉及存储、Run、Candidate 或 Workflow 时，必须运行对应 bridge 集成测试，不以 mock UI 结果替代。

仓库开发、测试与构建环境要求 Node.js `>=22.12.0`。涉及桌面宿主或打包时，目标系统为 macOS 13 或更新版本；至少运行定向桌面测试、目标架构 make 和对应 packed smoke。可见桌面 UI 仍须在未锁屏的真实
macOS 会话中检查窗口、目录选择、焦点、遮挡和 console warning/error。packed `.app` 自带
运行时，不要求目标 Mac 安装 Node.js 或 pnpm。同一 workspace 同一时刻只能有一个可写
Desktop、Standalone 或 DSH/Cordis 实例。
