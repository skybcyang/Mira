# Mira 当前架构图

- 状态：当前生产架构
- 日期：2026-09-06
- 目标：让修改停留在所属边界，避免 UI、状态、HTTP 与领域规则联动扩散

## 依赖方向

```text
Browser
  App.tsx
    -> canvas shell + lazy DetailDrawer / WorkflowLibrary / ModelSettings / InspirationPicker / FilePicker / BoardManager / BoardHistory
    -> AppBar / BoardMenu (search, local open/pin state, activity markers)
    -> useV2Canvas contract (src/v2/storeTypes.ts)
       -> composition (src/v2Store.ts)
          -> shared request context/projection/notices (src/v2/storeContext.ts)
          -> board lifecycle/catalog/portability/local navigation (src/v2/boardSlice.ts + boardNavigation.ts)
            -> checkpoint commands (src/v2/checkpointSlice.ts)
          -> Card content/file binding (src/v2/cardSlice.ts)
          -> canvas selection/movement/history (src/v2/canvasSlice.ts)
          -> explicit grouping/colors (src/v2/organizationSlice.ts)
          -> workflow/plan commands (src/v2/workflowSlice.ts)
          -> transformation commands (src/v2/transformationSlice.ts)
          -> run commands/polling (src/v2/runSlice.ts)
          -> inspiration commands (src/v2/inspirationSlice.ts)
       -> presentation policy (src/v2/storePolicy.ts)
       -> pure projection/state/workflow helpers
       -> v2Api.ts

HTTP
  mira-http.js
    -> v2-routes.js
       -> v2-http.js command handlers
          -> domain/board-activity.js (read-only Run/Candidate counts; strict Run store reads)
          -> v2-http-policy.js request/prompt policy
          -> bridge/domain/* invariants
          -> v2 board/run/workflow stores

Platform
  mira-application.js
    -> Node host
       -> Standalone CLI / LaunchAgent
       -> Electron desktop thin shell
    -> DSH/Cordis adapter
    -> file/model/runtime adapters

Desktop packaging
  forge.config.mjs
    -> explicit .desktop-stage payload
    -> macOS unsigned arm64/x64 app + DMG + ZIP; Windows arm64/x64 EXE directory + ZIP
    -> .github/workflows/desktop-build.yml native make + packed smoke + internal artifacts
```

箭头只能向右或向下。`src/domain/` 与 `bridge/domain/` 不依赖 React、Zustand、HTTP route、文件系统宿主或 DSH/Cordis。`archive/` 和生产数据目录不属于依赖图。

## 边界职责

| 边界 | 负责 | 不负责 |
| --- | --- | --- |
| `src/domain/` | 浏览器共享领域类型 | 网络、持久化、UI 状态 |
| `src/v2/*.tsx` | 视图、输入和可访问交互 | 写回规则、领域事实 |
| `src/v2/storeTypes.ts` | Canvas Store 的稳定公共契约 | 异步实现 |
| `src/v2/storePolicy.ts` | 错误到用户文案、传输错误分类 | 状态写入 |
| `src/v2Store.ts` | 初始 UI state 与 slice 组合，稳定 `useV2Canvas` 导出 | HTTP 命令体、重复领域校验 |
| `src/v2/storeContext.ts` | 共享请求代次、写序号、刷新防覆盖、投影与通知 | 生命周期或 feature 命令实现 |
| `src/v2/boardSlice.ts` | Board 导航、生命周期、目录与可移植数据命令 | Card、方法或 Run 的执行实现 |
| `src/v2/cardSlice.ts` | Card 创建、独立名称、正文、标签、恢复与文件绑定 | 几何移动、剪贴板与历史重放 |
| `src/v2/canvasSlice.ts` | 选择、几何移动、剪贴板、批量删除与会话历史 | 正文领域规则或结构级联删除 |
| `src/v2/organizationSlice.ts` | 显式分组、颜色 CAS、组选择和冻结整体拖动 | 正文、Run、自动归组或新执行模型 |
| `src/v2/canvasOrganization.ts` | 颜色枚举文案、成员转换、组框投影、整理请求反转与元数据合并 | HTTP I/O、领域写回或持久历史 |
| `src/v2/workflowSlice.ts` | 方法提取、直接计划与方法草稿、原子铺计划 | 新的执行引擎或自动 Run |
| `src/v2/transformationSlice.ts` | 建议、单步/批量转化创建、更新与结构删除 | Run polling 或 Card 正文 |
| `src/v2/sourceSlice.ts`、`transformationSources.ts` | 来源追加、页面点选草稿与来源校验；由 Transformation slice 组合 | 新 Run、目标创建或持久选择对象 |
| `src/v2/runSlice.ts` | Run 执行、轮询、初始读取重试、停止和 Candidate 命令 | Board 导航代次与领域写回规则 |
| `src/v2/inspirationSlice.ts` | 灵感记录、批量快照放入与 create history 编排 | 池检索 UI、领域校验或独立的 Board 导航状态 |
| `src/v2/checkpointSlice.ts` | 检查点读取、创建、更新、删除、导出与副本命令 | 新的 Board 导航状态；副本协调由 Board slice 注入 |
| `src/v2/DetailDrawer.tsx`、`src/v2/detail/` | 稳定详情 shell/兼容导出与分面组件 | 新的详情导航或重复 Store |
| `src/styles.css`、`src/styles/` | 固定导入顺序与 token、feature、外观、响应式模块 | 重排层叠或组件隐式重复加载样式 |
| `src/v2Api.ts` | HTTP 序列化和错误解码 | 业务决策 |
| `bridge/v2-http-policy.js` | 请求校验 helper、建议解析、prompt 与 Run 进度 helper 的兼容导出 | 存储写入 |
| `bridge/v2-http.js` | Card/Transformation/Run 命令编排 | host 路由与产品 UI |
| `bridge/domain/` | Version、snapshot、Candidate、Board 校验 | HTTP 和宿主能力 |
| `bridge/domain/run-progress.js` | Run 公开进度规范化、最近 20 条追加与持久字段校验 | 模型原始事件或 UI 呈现 |
| `bridge/domain/organization.js` | 颜色/分组/几何严格校验与 CAS、删除成员回执前后态 | UI、文件 I/O、CardVersion 或 Run 执行 |
| `bridge/board-checkpoint-service.js`、`board-checkpoint-store.js` | 命名检查点、Board 锁内一致快照、元数据 CAS 与原子存储 | 原地回滚或自动检查点 |
| `bridge/domain/workspace-backup.js` | MiraBackup V1/V2 全量校验与检查点归属 | 平台 I/O 或第二套 artifact schema |
| `bridge/*-store.js` | 原子持久化与读取 | 产品交互 |
| `bridge/node-runtime.js` | 以显式 workspace、静态目录、地址和端口启动/关闭可复用 Node Host | CLI 环境变量、Electron 窗口 |
| adapters/hosts | 文件、模型、进程和 DSH/Cordis 接入 | 核心业务语义 |
| `desktop/` | workspace 选择、窗口、菜单、本地鉴权、安全策略与 Electron 生命周期 | 领域、Store、route 或 React feature |
| desktop staging/Forge scripts | 显式载荷、双架构打包与 packed `.app` smoke | 用户数据、公开发布、产品逻辑 |

## 改动路由

改 Card/Version/Transformation/Run 语义：先改产品与核心规格，再改 `src/domain/`、`bridge/domain/` 和领域/集成测试。

改画布布局或连线：优先改 `src/v2Projection.ts`、`src/v2State.ts`、`src/canvasOperations.ts`；Workflow 方法草稿的纯投影与完整性判断位于 `src/v2/workflowDraft.ts`。不要在 React 组件中复制投影算法。

改灵感池筛选、标签匹配、候选顺序或记录输入映射：纯规则位于 `src/v2/inspiration.ts`，批量快照放入和记录由 `src/v2/inspirationSlice.ts` 编排，池读取沿用 InspirationPicker/API；workspace 池的校验与原子文件存储位于 `bridge/inspiration-pool-store.js`，HTTP handlers 位于 `bridge/inspiration-pool-http.js` 并接入 `bridge/v2-routes.js`。搜索结果不是领域事实或画布节点。

改错误提示：浏览器文案在 `src/v2/storePolicy.ts`，HTTP 错误码仍由 handler/domain 产生。不要在多个组件分别翻译同一错误码。

改请求校验或模型建议格式：在 `bridge/v2-http-policy.js` 做纯函数，并由 `v2-http.js` 调用。涉及写入原子性或 CAS 时才进入 handler/domain。

改工作台导航与本机密度偏好：`WorkbenchNavigation.tsx` 与 `workbenchPreferences.ts`；AppBar 接入既有工具，不建立新路由。`useTaskViewport.ts` 只投影视口高度，`useMobilePanelModal.ts` 处理 Compact/Mobile 焦点边界；NoticeRegion 在这些边界内投递通知。

改详情：`DetailDrawer.tsx` 只保留 shell、页签、四个 panel 的路由和既有命名导出。Candidate 比较位于 `detail/CandidateComparison.tsx`，冻结已读基线并复用 `cardVersions.ts` 的有界差异；Run slice 的采用调用必须显式传基线，重新核对只读取事实。
详情跟随选择与保存后离开的纯策略位于 `inspectorBehavior.ts`；`inspectorDrafts.ts` 注册各编辑字段的保存回调，`DrawerLeaveConfirmation.tsx` 承载统一离开确认。名称编辑状态由内容面板持有并呈现在 shell 顶部，不复制 Store 或领域规则。
内容与标签视图、版本、关系、转化控件、方法出处/表单和 Run 分别位于 `src/v2/detail/`；
不得改变原有 component key、dirty guard、异步意图和焦点归属。方法库、模型设置与灵感选择器
仍修改对应 `src/v2/` feature。它们都是动态入口，不应重新变成 `App.tsx` 的静态依赖。

改样式：`src/styles.css` 仅按固定顺序导入 `src/styles/` 的 18 个模块，依次为 token、基础壳、
feature、外观、命令面板、Desktop/Mobile 与无障碍覆盖。规则必须放回对应 owner；不要在
拆分时按 selector 合并或重排旧覆盖。测试使用 `test/helpers/read-styles.js` 读取完整导入树。

改平台部署：通过 `mira-application.js` 注入 adapter；Standalone、Desktop 和 DSH/Cordis 不能绕过同一套 application/handler。Node Host 的可复用启动入口位于 `bridge/node-runtime.js`，Standalone 环境变量与信号处理留在 `scripts/start-standalone.mjs`，Electron 窗口和 workspace 生命周期留在 `desktop/`。

改桌面打包：renderer 仍由 Vite 生产构建；`scripts/stage-desktop.mjs` 只允许写入仓库根目录的 `.desktop-stage/`，并通过显式清单装入 bundled main/preload、`dist/` 和最小 `package.json`。架构、格式、最低 macOS 版本和 fuse 策略统一由 `forge.config.mjs` 定义，不得把 Board、Run、Workflow、`.env`、源码或测试打入产物。

## 防回退约束

- `test/architecture/frontend-feature-boundaries.test.js` 锁定详情、方法库、模型设置、灵感选择器等动态 feature，以及 Store 契约和 canvas vendor 边界。
- `test/architecture/store-slice-boundaries.test.js`、`detail-panel-boundaries.test.js` 与 `style-boundaries.test.js` 分别锁定 Store 命令、详情组件与 CSS 层叠边界；视觉变更才允许更新样式基线指纹。
- `test/architecture/dsh-decoupling.test.js` 锁定核心应用与 DSH/Cordis 的隔离。
- `test/architecture/desktop-boundary.test.js` 锁定 Electron thin shell 不复制 React、route、Store 或领域实现，并限制 staging 载荷。
- `test/architecture/legacy-removal.test.js` 防止 v1 Action/chain 回到生产路径。
- `test/bridge/v2-http-policy.test.js` 和 `src/v2/storePolicy.test.ts` 直接覆盖两侧纯策略。
- `pnpm build` 应产生独立 `canvas-vendor`、`DetailDrawer`、`WorkflowLibrary`、`ModelSettings`、`InspirationPicker`、`FilePicker`、`BoardManager` 和 `BoardHistory` chunk，且无 500 kB chunk warning。

## 当前边界与后续约束

根 Store 已是组合入口，7 个 command slice 共用 `storeContext.ts`。只有 Board slice 推进
共享导航代次；movement、Run tracking、创建 Card 的异步意图各在所属 slice 内保留独立
生命周期。后续变更继续保留模板提取、移动写回、Run polling、灵感记录与 history replay 的
特征测试，不为文件变短而把同一并发边界再拆成多份状态。

`DetailDrawer.tsx` 与 `detail/` 保持单一延迟 chunk。Card 版本确认与差异位于
`detail/VersionPanel.tsx`，纯映射位于 `cardVersions.ts`；检查点 UI 使用独立 BoardHistory。
副本命令复用 Board slice 的导航代次与已提交目录协调，不得抢走请求期间的新导航。

`src/v2/InspirationPicker.tsx` 作为独立 `InspirationPicker` chunk 同时承载检索、
有序选择和直接记录三种交互。继续扩展前应把非视图状态机移入可直接测试的 helper，保留该
文件作为稳定延迟加载入口。

CSS 已按连续语义段拆分并固定导入顺序。现有重复 selector 是历史覆盖关系，不因模块化被
删除或重排；后续简化层叠需独立视觉验收。本次拆分证据见
[边界拆分集成验证](../validation/2026-09-06-boundary-split-integration-validation.md)。

macOS Desktop 当前是 Electron 44 internal Alpha，目标为 macOS 13 或更新版本。Node-backed Desktop
与 Standalone 在恢复前取得 workspace 级 `.mira-workspace.lock`，第二写者 fail-closed；DSH/Cordis
当前没有原子锁适配器，仍由宿主保证单写者。同一 workspace 同一时刻只能由一个 writer 使用。
macOS / Windows arm64/x64 未签名测试包与主干更新后 GitHub Actions 自动构建已于 2026-09-10 获用户确认；
操作及平台验收限制见[内部桌面打包](../operations/desktop-internal-builds.md)。
公开分发前还需要完成签名/公证/更新策略与对应发布门禁。
