# Mira Workflow 重构路线

- 状态：核心实现、Run 可观测性、Board 生命周期与可移植数据、永久清除、workspace 写锁、有限会话历史、灵感池、架构减重与 macOS Desktop internal Alpha 已完成
- 日期：2026-09-05
- 依据：产品定义、核心规格、体验设计、UI 系统与迁移规格
- 目标：删除第二套产品与 v1 生产路径，建立“先做事，再固化方法”的单一产品

## 1. 已有安全基线

### 真实模型案例（2026-09-10）

- [x] 四个公开案例与入门材料改用真实来源和 Kimi K3 推导，保留 13 次 Run、原始输出、人工修订与 Candidate。
- [x] 统一下载入口、替换旧简单案例，完成严格导入/恢复、方法零自动运行、1531 项测试与桌面/390px 验收，见[案例验证](../validation/2026-09-10-kimi-examples-validation.md)。

### 画板导航与方法计划入口（2026-09-09）

- [x] 统一画板菜单，全部 active 画板搜索、常用、已打开、当前与任务状态标记；手动关闭只改变本机导航，最后一项关闭后保持空态。
- [x] 合并方法与计划入口，区分步骤成果和处理要求，保留显式绑定、原子添加与零自动 Run。
- [x] 计划表单离开保护、异步关闭失败保留与迟到响应失效；1519 项测试、构建与桌面/390px 浏览器验收，见[验证记录](../validation/2026-09-09-board-navigation-plan-validation.md)。
- 本批为本地源码与隔离预览验收，不代表新的 macOS 安装包交付。

### 悬浮详情与卡片跟随（2026-09-08）

- [x] 保留外观，详情浮层、直接改名、单一正文编辑入口与可达页签；明确单选跟随已打开的卡片详情。
- [x] 名称、正文与标签保存后切换；失败保留原卡片与草稿，新建继续直接进入编辑。
- [x] 补齐转换详情切回内容卡的单选跟随，转换设置草稿接入离开保护；回归后 1504 项测试通过。
- [x] 1502 项测试、类型及构建门禁、桌面/Compact/390px 浏览器通过，见[验证记录](../validation/2026-09-08-contextual-inspector-validation.md)。
- [x] 连同独立名称与灵感编辑重新打包 arm64 macOS app，并替换本地安装；旧版保留可回退，见[安装验证](../validation/2026-09-08-inspector-macos-install-validation.md)。

### 独立卡片名称与灵感编辑（2026-09-08）

- [x] 可单独设置/清除卡片名称，正文版本与会话历史不变；复制、搜索与可移植数据保留名称。
- [x] 灵感全文可编辑正文和标签，保留不可变历史版本、已选快照与画板副本。
- [x] 并发基线、草稿保护、真实 HTTP 存储集成、1495 项测试及桌面/390px 浏览器验收通过，见[验证记录](../validation/2026-09-08-card-names-inspiration-edit-validation.md)。
- [x] 本批功能已包含于 `0904c62` 基线的 arm64 macOS 本地安装，见[安装验证](../validation/2026-09-08-inspector-macos-install-validation.md)。

### 工作台布局与交互（2026-09-08 Web 实现与验证完成）

设计范围见[工作台详细设计](workbench-layout-design.md)。

- [x] 固定 Candidate 已读比较基线，灵感添加保留画布上下文；池版本与落位由服务端核验。
- [x] 顶栏与五项导航、三档布局、顶部工具互斥。
- [x] 按反馈细化 Mira 字标、居中搜索、顶栏历史/系统设置、悬浮功能栏及网格开关；见[细化验证](../validation/2026-09-08-floating-tools-validation.md)。
- [x] 管理画板移到顶栏，悬浮工具栏全部平铺、移除重复搜索并修正衬线斜体字标；见[入口验证](../validation/2026-09-08-direct-work-tools-validation.md)。
- [x] 同一详情展开、来源同层往返和固定保存区。
- [x] 完整候选比较、逐行差异与大正文降级。
- [x] 静态灵感摘要/列表、全文阅读和记录离开保护。
- [x] 1478 项测试、类型检查及两套构建通过；真实浏览器、六套外观切换与[验证记录](../validation/2026-09-08-workbench-layout-validation.md)完成。
- [ ] 真实触屏软键盘、旋转与 safe-area 验收；不以浏览器尺寸模拟替代。

### 卡片颜色与显式分组

- [x] 已确认的产品约束与接口进入产品定义 5.2.1、核心规格 4.4.2 及 UX/UI。
- [x] Bridge 严格校验、整理 CAS、删除回执和可移植数据定向测试通过。
- [x] 颜色、显式归属、组拖动、独立选择和整理撤销实现，并完成定向及浏览器交互验证。
- [x] 最终集成门禁与完整验证记录，见[本批证据](../validation/2026-09-06-card-grouping-validation.md)。

此前 Slices A-D 已建立并验证以下 v2 能力，本轮必须保留：

- ContentCard 与不可变 CardVersion。
- 有序多来源 Transformation。
- Run 来源快照和 target base version。
- compare-and-swap、Candidate 采用/丢弃和 stale。
- v2 Board/Run 原子存储。
- 默认 ContentCard、Context dock、Detail drawer 和响应式画布。
- 只有用户手动画图才创建分支。

旧 Slice E 的隔离方案已被产品决策取代。它是历史实现证据，不是新的终态。

## 2. 目标模块边界

```text
src/domain/                  Card / Version / Transformation / Run / Workflow types
src/v2/storeTypes.ts         Canvas Store 稳定公共契约
src/v2/storePolicy.ts        用户错误文案与传输错误分类
src/v2Store.ts               Board、Card/历史/灵感、Run 与方法应用编排，不含领域写回规则
src/workflows.ts             线性路径提取与只读展示 helper
src/v2/                      唯一生产 UI；非画布 feature 延迟加载
bridge/v2-board-store.js     Board v2 原子存储
bridge/v2-run-store.js       Run v2 存储
bridge/workflow-store.js     全局 WorkflowTemplate 原子存储
bridge/workflow-service.js   提取、校验与原子应用
bridge/domain/run-progress.js Run 公开进度、固定终态与持久字段校验
bridge/v2-http-policy.js     请求校验、建议解析、prompt 与兼容 helper 导出
bridge/v2-http.js            Card / Transformation / Run 命令编排
bridge/v2-routes.js          唯一生产 HTTP surface
```

React/Canvas projection 不拥有业务规则；Store 只编排命令和 UI state；Version、snapshot、CAS、Workflow 验证与应用由纯领域或 service 层覆盖测试。

## 3. Slice W0：文档重新定线

- [x] 产品定义采用`先做事，再固化方法`。
- [x] 删除普通/高级模式概念。
- [x] 定义 WorkflowTemplate、WorkflowApplication 和 WorkflowPlan。
- [x] 明确应用只铺线性计划且零 Run。
- [x] 重写 UX、UI、迁移和验收规则。
- [x] 标记历史验证中的 superseded assumptions。
- [x] 删除 active docs redirect/stub 与旧 HTML prototype。

退出条件：README、docs map、产品、规格、UX/UI、迁移和路线使用同一术语和不变量。

## 4. Slice W1：Workflow 领域与存储

- [x] 定义 `WorkflowTemplate` 和 `WorkflowStepTemplate`。
- [x] 从所选 Transformation 推导最大无歧义线性路径。
- [x] fan-out、merge、cycle、缺失路径不被猜测；service 严格拒绝 cycle。
- [x] 每一步目标必须有可用当前 Head 内容；Markdown 空白、悬空 Head 和无效 file-reference 均拒绝。人工成果有效，不强制要求成功 Run。
- [x] 建立 `workflows-v2/` 原子 store。
- [x] 支持 list/create/get/delete；v1 不支持 update。
- [x] 删除模板不修改任何 Board。

测试重点：数组顺序稳定、模板不复制 Card/Version/Run、临时写失败零半写、非法 JSON 不进入列表、删除已应用模板不破坏 provenance。

## 5. Slice W2：WorkflowPlan 原子应用

- [x] `POST /graphmind/api/v2/boards/:boardId/workflows/:workflowId/applications`。
- [x] 校验有序 SourceRef 和指定 Version。
- [x] 为每一步创建空目标 Card 和普通 Transformation。
- [x] 第一步读取具名外部输入；后续步骤读取前一步目标，并可按模板声明继续读取具名外部输入。
- [x] 写入 `workflowRef:{workflowId,stepId,applicationId}`。
- [x] 一次 Board 写入提交整条计划。
- [x] 返回 workflow、applicationId、transformations 和 targetCards。
- [x] 应用不调用 Run API，结果只包含计划对象。

测试重点：三步应用对象数量、稳定顺序、唯一 ID、重复应用隔离、SourceRef 过期、目标位置、写入失败零半条计划。

## 6. Slice W3：Workflow UX/UI

- [x] App bar 提供唯一的`方法`入口，无第二套模式入口。
- [x] App bar 的`文件`只创建工作区 file-reference；宽屏直接显示`画板`，窄屏从`更多`进入独立 BoardManager，画板导入导出与完整备份下载均在其中完成。
- [x] 关系详情提供`保存为方法`，并展示名称、具名外部输入与有序步骤。
- [x] 保存确认包含可选说明、起始来源摘要和线性路径截断原因。
- [x] 模板库支持列出、创建和删除；模板正文不可编辑。
- [x] 删除模板使用二次确认，并明确不影响已有计划。
- [x] 应用预览显示步骤数量并明确`不会开始运行`。
- [x] 应用预览包含有序来源、完整步骤和即将创建的对象明细。
- [x] 应用后打开第一步关系详情，并提示计划尚未运行。
- [x] 未运行目标显示`等待生成`。
- [x] 计划关系显示轻量 `1/N`，关系详情提供模板 provenance 与同计划步骤导航。
- [x] 任一下游步骤提供`运行到这里`；系统向上检查并仅生成空结果或 stale 步骤，绝不越过用户点击的目标。
- [x] Desktop/Compact/Mobile 完成无遮挡验收。

测试重点：入口语言、零自动 Run、模板不可编辑提示、删除模板后的计划、键盘/焦点、最长标题、390px 无页面溢出。

## 7. Slice W4：按需运行一致性

- [x] Workflow 与普通 Transformation 统一使用`运行到这里`命令。
- [x] 每一步复用普通停止、失败、重试和 stale 路径。
- [x] 人工编辑触发 Candidate，不因 workflowRef 改变写回。
- [x] 计划对象与 WorkflowTemplate 分离，Card/Run 变化不反向修改模板。
- [x] rerun、Candidate、stale 和错误恢复不创建分支。
- [x] 没有无边界 run-all API、命令或后台触发器；前端只在一次显式点击内按依赖顺序调用普通单步 Run。
- [x] 方法来源详情展示 template/application/step provenance 和同计划步骤导航；模板删除后保留计划并显示缺失状态。
- [x] Transformation PATCH 只更新文案或有序来源，并保留目标、workflowRef、权限和历史；活动 Run 时拒绝。
- [x] Transformation DELETE 只删除结构，不级联 Card、Run 或其他步骤。
- [x] 关系详情提供步骤编辑、来源替换和结构删除交互，并明确展示影响范围。
- [x] 未处理 Candidate 保持可达并阻止重跑、修改和删除；处理后解除门禁。
- [x] `lastAppliedRunId` 独立保存最近已采用 provenance；失败、停止和 Candidate 不遮蔽 stale。
- [x] stale 精确比较当前有序来源与最近已采用快照，来源替换或重排后立即提示。
- [x] Run 列表损坏或读取失败时，启动和结构修改 fail closed。
- [x] Transformation PATCH 使用单调 revision CAS，跨窗口旧表单不能覆盖较新修改。
- [x] Run 结果先持久为可达 Candidate，再写 Board，并在启动时幂等对账已提交 Version。

测试重点：前一步完成后下一步不自动开始；计划中运行期间人工编辑保持 Head；删除模板后步骤继续作为普通 Transformation 工作；结构编辑零自动 Run，删除结构不丢 Card/Run，活动 Run 时修改零写入。

## 8. Slice C1：画布基础操作

- [x] 建立当前页面会话级 CanvasClipboard，可跨 Board 粘贴且不读写系统剪贴板。
- [x] 复制当前 Head、尺寸和组内相对布局；粘贴/创建副本生成新的 Card 与 Version 身份，不复制历史、Transformation、Run 或 Workflow provenance。
- [x] 提供批量 Card create/move/delete API，并以一次 Board 变更保证整批成功或整批失败。
- [x] 批量删除预检全部 Card；任一卡被 Transformation 引用时返回 `CARD_IN_USE`，不做部分删除或隐式级联。
- [x] 画布顶部提供显式选择工具栏，包含复制、创建副本、粘贴、多选、取消选择和带数量的二次删除确认。
- [x] 桌面支持 `Cmd/Ctrl+A/C/V/D`、`Delete/Backspace`、方向键 5px 与 `Shift + 方向键` 20px 微移；编辑和表单焦点不触发画布命令。
- [x] App bar 与快捷键提供当前 Board 会话内有限撤销/重做，最多 50 条，只覆盖正文、Card 位置和已记录的 Card 创建/删除。
- [x] 正文 undo/redo 继续追加 Version；撤销删除只接受同一进程保存的精确回执，并复用普通删除引用门禁。
- [x] 窄屏保留图标化的新建内容与显式多选入口，选择工具栏使用至少 44px 触控目标和内部横向滚动。
- [x] helper、Store、API client、HTTP route 与选择工具栏聚焦测试覆盖跨画板粘贴、原子写入、删除门禁和二次确认。
- [x] 在真实浏览器完成桌面快捷键、跨画板粘贴与窄屏触屏选择工具栏验收。

本 Slice 不包含持久、跨 Board 或完整对象图撤销/重做，也不包含系统剪贴板跨应用互通。标签、Transformation、Run、Candidate、计划、方法和模型设置均不进入当前 Card 会话历史。

后续契约已收敛为浏览器保留 50 条命令、Bridge 按 Board 保留最近 50 个删除批次回执；
批次内 Card 数量不消耗额外容量。进程重启等永久失效仍返回 `CARD_RESTORE_CONFLICT`，
但该条历史会被移出，不能继续阻挡更早历史；暂时错误仍保留原项以便重试。

测试重点：连续粘贴保持组内布局并整体错开；创建副本不覆盖已有内部剪贴板；移动失败恢复已保存位置；Transformation 引用仍在删除集合时拒绝隐式级联。

浏览器证据来自真实 `http://127.0.0.1:56300/graphmind/` 服务：原 Card 的 Head 为 Version 2 时，粘贴卡从独立 Version 1 开始；单卡和多卡复制粘贴、整批删除完成后均清理回原 7 张 Card；仍被 Transformation 引用的 Card 删除被阻止，无引用 Card 必须经过显式二次确认。显式多选模式可选中 2 张 Card 且 Context dock 隐藏；原生 `ArrowRight` 使卡牌向右移动 5，`Shift + ArrowRight` 移动 20，刷新后位置保持；file-reference Card 按 `Enter` 不进入编辑。

`390x844` 与 `320x720` 均无页面横向溢出，选择操作栏可达，console warning/error 为 0。浏览器自动化层会拦截 `Cmd/Ctrl+V`，因此该键盘映射由单元测试覆盖；浏览器中粘贴命令与结果已通过可见操作栏验证。

### Slice C2：高密度画布布局

- [x] 11 号开店决策画布按阶段从左到右展开，53 张 Card 保持可见且无桌面节点重叠。
- [x] 13 个及以上来源的 Transformation 投影为单一聚合节点，不再渲染会遮挡内容的高扇入来源边。
- [x] 聚合节点明确显示来源数量，并保留到目标 Card 的主流程边。
- [x] 大型画布在窄屏首次打开时聚焦最左侧阶段，避免把 53 张 Card 压缩成不可读缩略图。
- [x] seed 脚本、画布 JSON、投影测试、布局测试和真实浏览器证据保持一致。

证据见 [11 号画布布局验收](../validation/2026-08-25-showcase-11-layout-validation.md)。该切片只改变投影与初始视口，不修改 Board、Transformation 或 Run 的领域语义。

### Slice C3：标签与灵感池工作集

- [x] ContentCard 支持最多 20 个扁平标签，每项最多 32 字符且大小写不敏感唯一；标签变化不追加 Version 或触发 stale/Run。
- [x] App bar 的`灵感`打开延迟加载的 InspirationPicker，从 workspace 灵感池按当前 Head 正文和多标签 AND 语义筛选。
- [x] 候选跨查询和筛选保持稳定有序选择，可上移、下移或移除；筛选与选择阶段零 Board 写入。
- [x] 当前 Board 候选只选中、不复制；外部候选以一次批量请求创建独立快照，复制当前内容、尺寸、标签和轻量 `inspirationRef`，不复制历史、关系或 Run。
- [x] 灵感选择器可独立记录非空 Markdown 与标签到 workspace 灵感池；只有显式添加时才在当前画板创建带 pool `inspirationRef` 的普通 Card，不创建 Transformation、Run 或自动选择。
- [x] Store、API、HTTP handler 和 Board schema 覆盖顺序、原子写入、失败零半写、标签校验与出处兼容。
- [x] 在真实浏览器完成 1280px 弹窗与 390px 全屏 sheet 的直接记录、焦点、溢出和 console warning/error 验证。

自动化与浏览器证据见 [`2026-09-01 PR4 集成分支与用户文档验证`](../validation/2026-09-01-current-main-documentation-validation.md)。该报告同时记录了不属于灵感池本身的窄屏撤销/重做 toast 遮挡缺陷。

当前 Board 候选会被定位并选中；外部灵感批次在全部节点就绪后一次聚焦。整组仍可读时展示整组，
过大时定位第一项，避免把正文缩成不可读缩略图。

### Slice R1：架构减重与 AI 入口

- [x] 详情、方法库、模型设置和灵感选择器从首屏入口改为独立动态 feature。
- [x] React Flow 进入稳定 canvas vendor chunk，最大 chunk 低于 500 kB。
- [x] Store 公共契约和错误策略从 Zustand 编排器移出，并增加直接单元测试。
- [x] HTTP 请求、建议和进度纯策略从 handler 编排器移出，并保持完整 handler 回归测试。
- [x] 新增根目录 `AGENTS.md` 与当前架构图，明确 AI 读取顺序、依赖方向、改动路由和验证门槛。

指标与后续热点见 [架构减重记录](2026-08-25-architecture-reduction.md)。

### Slice R2：macOS Standalone 后台保活

- [x] 用户级 LaunchAgent 固定监听 `127.0.0.1:56300`，显式绑定当前 workspace 与构建目录。
- [x] Supervisor 保持单一 Standalone 子进程；子进程异常退出后重启，显式停止不重启。
- [x] 提供 install/start/stop/restart/status/logs/uninstall 命令，安装检查构建产物与端口占用。
- [x] plist 不包含模型凭据，卸载不删除日志、Board、Run 或 Workflow 数据。
- [x] 定向测试、plist 校验、真实 stop/start 与强制结束子进程恢复通过。

### Slice D1：macOS 桌面薄壳 Internal Alpha

- [x] 保持 Web/Standalone 为产品与日常开发主线；Desktop 只做 Electron 44 thin shell，
  复用现有 React UI、HTTP API、Mira Application 和 Node Host。
- [x] 首次启动由用户选择 workspace，完成真实读写预检后才初始化三个 v2 数据目录；最近
  workspace 和窗口状态只进入 Electron `userData`。
- [x] Node runtime 使用 `127.0.0.1:0` 与每次启动随机凭据；BrowserWindow 使用隔离 session、
  sandbox、CSP、权限拒绝、导航限制和窄 preload。
- [x] macOS 菜单、单实例、窗口状态恢复、受控外链和退出时 host 清理已接入。
- [x] 显式 staging 不包含用户数据、`.env`、源码或测试；Electron fuse 限制运行面。
- [x] 在 macOS 上真实生成 arm64/x64 的 unsigned `.app`、`.dmg`、`.zip`，两个架构的
  packed smoke 均通过。
- [x] 在未锁屏的真实 macOS 会话完成可见 UI、390px、目录选择、焦点、遮挡和 console 验收。
- [x] 在当次合并后的根工作区完成完整全仓自动化门禁：56 files / 481 tests、TypeScript、frontend
  build、bridge build 与 `git diff --check` 均通过。

当前不包含签名、公证、自动更新或公开分发。完整决策、实施清单与剩余发布项见
[macOS 桌面薄壳实施记录](macos-desktop-shell-todo.md)，当次证据见
[macOS 桌面 Alpha 验证](../validation/2026-08-31-macos-desktop-alpha-validation.md)。

## 9. 2026-09-02 并行需求批次

产品、核心规格与 UX/UI 已确认 Board 生命周期和可移植数据契约。实现按共享热点分波次推进；`App.tsx`、`src/v2Store.ts`、`src/styles.css`、Board 类型与 route/store 在同一波次只能有一个 writer。

### Wave 1：现有体验缺口

- [x] `canvas-foundation`：修复空画板主 CTA 命中，增加连续新建碰撞避让，并统一 Plan 落地与灵感离屏 Card 的一次性聚焦。该切片独占 Canvas/App 热点。
- [x] `history-contract`：Bridge 按 Board、按删除批次保留最近 50 份精确回执；永久失效条目不再阻塞更早历史，暂时错误仍可重试。导入不得复用 restore。
- [x] `ux-language`：file-reference 来源显示 basename 和完整路径提示；PlanComposer 明确每步做法与最终成果名称的映射。

### Wave 2：通知与 Board 基础

- [x] `notification-system`：使用结构化通知类型和身份，补齐自动过期、progress 终态替换、迟到 timer 隔离与三档视口避让。
- [x] `board-lifecycle-core`：实现标题 CAS、`active/archived/trashed` 状态机、活动 Run/Candidate 门禁、只读写边界、存储和 HTTP API。
- [x] `board-purge`：仅对 trashed Board 提供带当前 revision 和二次确认的不可撤销清除，Board 与 Board 级 Run 原子移除并保留 ID tombstone。
- [x] `portable-format`：实现版本化 BoardArtifact/MiraBackup schema、严格校验、明确对象上限和区分当前结构/合法历史缺失的纯 ID remap；Board 导入不安装方法 provenance，也不直接写生产目录。

### Wave 3：数据服务与管理 UI

- [x] `board-portability-service`：一致导出、staging 导入、故障清理和零可见半写；同一 BoardArtifact 可重复导入为独立 Board。
- [x] `backup-restore`：严格全量快照；Desktop 启动 chooser 与 Standalone 离线 CLI 只向新建/空 workspace 恢复，不提供运行中 workspace 覆盖。
- [x] `board-manager-ui`：以独立延迟加载面板统一承载新建、重命名、归档、废纸篓、恢复、导入、导出和备份；不继续堆积 AppBar。App/Store/API 接线与 1440、1024、390px 真实浏览器验收已完成。
- [x] `workspace-writer-lock`：Node-backed Standalone/Desktop 在恢复前取得 workspace 级原子写锁；第二写者 fail-closed，正常关闭释放，残留锁不自动猜测删除。

每个行为切片先运行能证明缺口的失败测试，再做最小实现。Wave 集成后运行完整自动化门禁；可见 UI 额外在 1440、1024 和 390px 验证命中、遮挡、溢出、焦点和 console。Board 生命周期、Run、Candidate、导入导出与备份必须运行真实 Bridge 集成测试和故障注入，不以 mock UI 代替。

## 10. Slice W5：Legacy 生产代码删除

### 删除

- [x] 删除 `src/LegacyApp.tsx` 及生产动态 import。
- [x] 删除 v1 App/Store/Canvas projection 和仅由其使用的组件。
- [x] 删除 Action、executor、tool、chain 类型与 UI。
- [x] 删除 Action HTTP、Action runtime、chain runner 和 v1 Board/Run store。
- [x] 删除 v1 直接 `node.text` 写回和重复 status/runCount。
- [x] 删除旧入口测试、bundle entry、API alias 和只服务旧 UI 的模块。
- [x] 删除意外副本、废弃 demo 和旧流程脚本。
- [x] 删除 `src/styles.css` 中遗留的 legacy/migration 与旧组件 selector；当前组件类覆盖检查和前端构建通过。

### 归档边界

- [x] 生产 bridge 不保留 legacy adapter、migration route 或 compatibility API。
- [x] v1 Board/Run 已移入日期归档，产品运行时不扫描。
- [x] 历史文档和验证证据留在 archive/Git history，不参与构建。
- [x] 必要恢复改为产品之外的显式离线工具政策。

架构测试必须证明生产入口不能 import LegacyApp、Action HTTP、chain runner 或 legacy adapter；旧术语只能出现在拒绝性校验、架构测试、归档说明和历史报告。

## 11. Slice W6：验证与收口

- [x] 聚焦 Workflow/architecture 测试覆盖领域、store、service、route、frontend state/UX 与 legacy removal；精确文件数和用例数以当次最终命令输出为准，不在路线中固化。
- [x] 删除只验证旧产品存在的测试，并增加单一生产架构测试。
- [x] `pnpm test`、TypeScript、frontend build、bridge build、`git diff --check`。
- [x] 浏览器完成普通推进、保存模板、应用三步计划、运行到下游目标、Candidate 和模板删除。
- [x] 1440、1024 与 390px 验证无重叠、页面溢出和不可达命令。
- [x] 验证生产 bundle 不含 legacy chunk。
- [x] 新增 Workflow 真实验证报告，不覆盖旧报告。
- [x] README 与权威文档同步到 Workflow 与离线归档政策。

## 12. 真实课题

## 12A. Slice F1：单 Markdown Card 本地文件自动同步

- [x] 为 Markdown Card 增加单文件、workspace-relative 的绑定基线；file-reference 不可绑定。
- [x] 在 human、restore、ai 和 Candidate adoption 的新 Head 后自动同步；使用临时文件与原子 replace。
- [x] 检测外部修改、文件缺失和读写失败；冲突不覆盖文件且不回滚 CardVersion。
- [x] 提供 overwrite/import/unbind 命令，import 追加 human Version，历史保留在 Mira。
- [x] 详情面板显示绑定路径、同步状态和冲突处理命令；导出、备份、复制不携带绑定。
- [x] 增加 Bridge 集成、Store/API/UI 测试及浏览器验收证据。

### W-T1：研究简报方法复用

在 Board A 完成并验证：`三份材料 -> 事实摘要 -> 判断 -> 一页简报`。保存模板后，在 Board B 选择新材料应用。验收：铺出三步、零 Run、每步可先人工修改再继续。

### W-T2：计划中人工编辑

运行第二步时人工修改目标并加入唯一标记。验收：返回结果成为 Candidate，人工 Head 不变，第三步不自动启动。

### W-T3：结构歧义

准备 fan-out 和 merge 路径。验收：保存预览在歧义前停止并解释原因，服务拒绝伪造的非线性请求。

### W-T4：模板生命周期

同一模板应用两次后删除模板。验收：两次 applicationId 和对象互相独立；已有计划仍可执行并显示`模板已删除`。

### C-T1：跨画板整理材料

在 Board A 选择三张不同尺寸且有明确相对布局的 Card，复制后切换到 Board B 粘贴，再重复粘贴。验收：每次产生独立 Card/Version 身份，当前内容、尺寸和组内布局保持；两次粘贴整体错开，原 Transformation、运行和 Workflow provenance 均未复制。

### C-T2：批量删除安全边界

选择两张无引用 Card 和一张仍被 Transformation 引用的 Card 后删除。验收：服务拒绝整批，三张 Card 与全部结构均保持；显式删除引用后，再经二次确认可一次删除整组。

## 12B. Slice F2：Context dock 并行分支批量创建

在既有单步添加语义上增加`添加分支`：用户在本地草稿中填写 2–16 个成果目标，确认后一次 Board 写入创建共享同一组来源、彼此独立的普通 Transformation 与空目标 Card；不创建 Group、Workflow 或计划对象，不创建 Run/Candidate。

- [x] 产品、规格、UX/UI 文档同步 2–16 并行分支契约，并澄清创建时只按来源当前 Head 校验、版本冻结由 Run 负责。
- [x] Bridge 提供 `POST /boards/:boardId/transformations/batch`：先校验全部来源与全部条目，再在一次 Board 变更中提交；单条或超过 16 条拒绝且整批零写入，零 Run。
- [x] API client、Store 与布局策略提供 `generateBranches` 批量流程、空目标落位避让和成功/失败通知状态。
- [x] ContextDock 并行拆解编辑器支持 2–16 行、添加/删除、取消和`添加 N 个分支`；390px 输入与删除触控尺寸均为 44px，无横向溢出。
- [x] 验证：Bridge/Store/API/UI 定向测试先红后绿；全仓 973 用例、TypeScript、frontend build、bridge build 与 `git diff --check` 通过；独立临时 workspace 完成桌面与 390px 真实浏览器验收，console 无应用错误。

实现位于 `codex/parallel-branch-targets` 的五个独立提交（`6f474e8` docs、`17ce270` bridge、`fa7885f` store/api、`fc231e2` UI/styles、`3df2c57` 390px 触控修复），已于 `db26344` 合并进 `main`，并完成合并后的全仓门禁与真实浏览器验收。

## 12C. Slice F3：workspace 独立灵感池

灵感池从“普通来源 Board 的 Card”改为 workspace 级独立记录集合：条目保存到 `inspiration-pool-v2.json`，没有画布坐标、Transformation、Run 或 Board 生命周期。记录只写池；只有用户明确`添加到当前画板`时才创建带 `{ poolId, entryId, versionId }` 出处的普通 Card 快照。旧 Board Card 不自动迁入池，历史 `boardId/cardId` 出处只做兼容展示。

- [x] AGENTS、agent.md、产品定义、核心规格、体验与 UI 文档同步独立池语义，并写明不自动迁移旧 Board Card。
- [x] Bridge 提供 `GET /inspiration-pool` 与 `POST /inspiration-pool/entries`，池文件经临时文件校验与原子替换；空池可读、空白条目零写入。
- [x] MiraBackup 与恢复覆盖可选灵感池；BoardArtifact 出处兼容新旧两种引用；旧引用在导入时按 opaque 处理。
- [x] Store/API/UI 改为浏览、记录、筛选并有序添加到当前画板；InspirationPicker 移除来源画板选择，390px 全屏 sheet 无横向溢出。
- [x] 验证：Bridge/Store/UI 定向测试覆盖存储、HTTP、路由、备份与落 Board 出处；全仓 987 用例、TypeScript、frontend build、bridge build 与 `git diff --check` 通过；真实浏览器完成“记录 → 返回检索 → 添加到画板 → 校验 pool 出处”和 390px 验收。

实现位于 `codex/inspiration-pool` 的三个独立提交（`195fc00` docs、`9fad194` bridge、`ef0073c` v2），已于 `51f276b` 合并进 `main`，并完成合并后的全仓门禁与真实浏览器验收。

## 12D. Slice F4：Beta.3 Run 可观测性

- [x] Run 持久化当前公开进度和最近 20 条严格递增事件；旧 Run 缺少事件列表时继续合法。
- [x] phase、label 与 detail 使用 Unicode 字符上限和白名单字段；超长输入有界扫描，reasoning、Prompt、密钥与完整工具内容不落公共事件。
- [x] success、failure、interrupt 与启动恢复在 Run 锁内追加固定脱敏终态；RunStore、BoardArtifact 和 MiraBackup 共用 fail-closed 校验。
- [x] 运行中目标 Card 提供进度与停止入口；详情显示步骤位置、当前阶段、可靠时间和事件时间线，Candidate 决策与失败原因优先于审计记录。
- [x] 停止后立即重算画布投影；`运行到这里`在每个实际启动步骤前显示依赖路径 `X/N` 和成果名。
- [x] 完成 RED→GREEN、99 files / 1137 tests、TypeScript、frontend/bridge build、三档视口、六套外观、Stop 与 Candidate 真实浏览器验收。

证据见 [Beta.3 Run 可观测性验证](../validation/2026-09-05-beta3-run-observability-validation.md)。

## 12E. 当前画板卡片搜索

- [x] 复用搜索入口检索当前 Head 标题/全文与引用文件名/路径，显示命中片段；不检索其他画板、历史版本或文件正文。
- [x] 结果只定位并选中原 Card，取消保持选择与视口；键盘、390px 与侧栏避让通过真实浏览器验收。
- [x] 7 项新增回归测试及全仓 1144 项用例、类型检查、前后端构建通过；证据见[卡片搜索验证](../validation/2026-09-06-card-search-validation.md)。
- [x] 2026-09-06 用户确认开发验收完成；本批只收口当前画板搜索与定位。

## 12F. 2026-09-06 Store 边界收口

- [x] 保留主线已有的 `runSlice.ts`，补充 Run 轮询和 Candidate 编排边界测试。
- [x] 复用版本管理分支的 `inspirationSlice.ts`，从根 Store 移出灵感记录与批量放入；不改变公开契约、API 或会话历史语义。
- [x] 补充切换离开再返回同一 Board 后，迟到批量成功/失败响应不污染当前画板的回归测试。
- [x] 当前切片完整门禁通过，100 files / 1148 tests；证据见 [Store 边界验证](../validation/2026-09-06-store-boundary-validation.md)。

以上为首批 Store 边界收口；详情与样式由下方后续切片完成。

## 12G. 2026-09-06 剩余边界拆分

- [x] 根 Store 仅保留初始状态与组合；Board、Card、Canvas/history、Workflow、Transformation 命令分别归入 slice，复用唯一请求上下文。
- [x] DetailDrawer 保留稳定延迟入口、四页签与全部既有命名导出，8 个内部模块各自承载内容、版本、关系、Run、控件与纯展示 helper。
- [x] 集中 CSS 按原有顺序拆为 17 个连续语义模块；导入入口、归属、覆盖完整性与原始层叠指纹由测试锁定。
- [x] 更新源码约束测试以扫描全部 Store slice 和完整 CSS 导入树，避免拆分导致断言失去覆盖。
- [x] 三切片按本地提交集成后，独立审查确认 Store 函数体与 action 集合等价；完整门禁及 1440/1024/390px 真实浏览器验证通过。

未合入画布版本管理功能，也未改 API、产品语义或真实用户数据。将来集成该分支时须按新
面板与 CSS owner 迁移其变更。证据见 [剩余边界拆分集成验证](../validation/2026-09-06-boundary-split-integration-validation.md)。

## 13. 提交边界

### 画布版本管理交付

从已确认的 `8594438` 实现迁入当前主线：继续采用线性 CardVersion、手动命名检查点、每
Board 20 个上限、恢复只创建新副本与同批 MiraBackup V2；不迁入旧 Beta.3 的标签删除等语义。

- [x] Checkpoint domain/store/service、API、永久清除与备份恢复的既有实现保留。
- [x] 版本详情与 CSS 迁入已拆分模块，根 Store 保持组合入口。
- [x] 预览异步请求、完整 Run 比较与副本导航回归收口。
- [x] 最新主线集成全仓门禁（117 files / 1279 tests）、三档浏览器、arm64 make 与普通/备份恢复 packed smoke 收口。

历史实现和当时证据见 [原分支验证](../validation/2026-09-05-card-canvas-version-management-validation.md)；后续交付报告单独记录，不覆盖原报告的浏览器限制。

交付证据见 [2026-09-06 版本管理交付验证](../validation/2026-09-06-checkpoint-delivery-validation.md)。

建议保持可独立回滚：

1. 领域类型和失败测试。
2. Workflow store/service/API。
3. Workflow UI state 与 API client。
4. 保存/模板库/应用预览 UI。
5. 画布复制、批量写入与选择工具栏。
6. 旧生产代码和测试删除。
7. 文档、响应式与真实验证收口。

不要在同一提交中批量迁移用户数据并删除恢复路径。

## 14. 完成定义

### 已有转化的多来源管理（2026-09-07）

- [x] 独立分支 `codex/transformation-sources` 支持拖线追加、点选确认/取消、移除和排序，保留目标与历史，零自动 Run。
- [x] 复用 Transformation PATCH；补齐来源依赖环拒绝，沿用当前 Head、CAS、Run/Candidate 门禁。
- [x] 与主干卡片交互及 GFM 预览集成，1464 项测试、类型检查、前后端构建与桌面/390px 浏览器验收通过；交付 main，未打包发布。证据见[多来源转化编辑验证](../validation/2026-09-07-transformation-sources-validation.md)。

### 2026-09-07 卡片与推进体验增量

- [x] B1/B2/B4：标题拖动、正文选字与键盘隔离、稳定卡片、同任务阅读/编辑和扩展详情、渐进工具栏。
- [x] B3/B5：原子尺寸 CAS 与撤销、所选范围整理、保存成功后连续新建及不确定回执保护。
- [x] R1/R2/R3/R6：来源伴随阅读与历史输入核对、只读运行范围预估、成果就近修改步骤。
- [x] R5：三个独立可导入人工教学示例、方法库成果摘要与折叠步骤、换材料显式绑定且零自动 Run。

基线 `37f72db`，卡片交互已由 `5119a04` 合入 main，Markdown 预览修正为 `e27843b`。
完整证据与未覆盖边界见[验证报告](../validation/2026-09-07-card-interaction-validation.md)；
真实任务效果与设备触屏仍待验证，不由样本非空正文推断方法有效性。

### 既有完成定义

- 生产产品只有一块画板、一个 workspace 灵感池和一套方法库，没有第二套模式或执行引擎。
- Workflow 应用显式铺出计划且零 Run。
- 画布流程中的所有产物都是 CardVersion，所有执行都是普通 Run。
- WorkflowTemplate 删除、计划修改和步骤失败都不影响已有内容安全。
- 只有用户手动画图或明确创建目标才产生分支。
- 复制只复用当前 Head 内容与布局，粘贴对象的身份、历史、关系、运行和 Workflow provenance 独立。
- 批量 Card 创建、移动和删除没有部分写入；结构引用阻止整批删除。
- 桌面和触屏都能显式到达选择、新建、复制、粘贴与二次删除确认；内部剪贴板边界为当前页面会话。
- 有限撤销/重做只覆盖当前 Board 会话的约定 Card 操作，正文重放保持 Version 不可变，删除恢复不能成为导入入口。
- workspace 灵感池独立保存条目；筛选零写入，只有显式添加到当前 Board 时才创建带 pool 出处的普通 Card 快照。旧 Board Card 不自动迁入池。
- Run 只保存长度受限的公开进度和最近 20 条事件；终态固定脱敏，运行入口、停止、Candidate 与旧数据回退保持可达且不覆盖人工 Head。
- 生产源码、bundle、路由、Store、样式和测试中无 v1 重复路径。
- 旧数据只读归档；如需恢复只能走显式离线工具，产品运行时无兼容或迁移入口。
- 文档、实现、测试和真实浏览器证据互相一致。

## 15. 待讨论产品方向

登记日期：2026-09-06。以下只记录候选方向，不是已确认产品规则，不进入实现或排期；确认后
仍需先同步产品定义、核心规格与 UX/UI。用户已确认推导链折叠暂缓，先使用现有颜色与分组
验证真实需求；子图与循环也不因此进入实现。

- [ ] 保留首尾的推导链折叠（暂缓、未排期）：用户确认现在不做；[TODO 与保留方案](chain-collapse-design-todo.md)记录重启条件、D1–D5 和分组兼容未决项。区分减少阅读噪声与收紧布局，未经重新确认不开始实现。

- [ ] 子图：讨论命名、成员与边界输入/输出、整体整理、折叠及复用的关系；区分视图组织和可执行/可复用子图，明确共享节点、嵌套、结构删除与 Candidate 可达性。是否扩展线性 WorkflowTemplate 另行决定。
- [ ] 循环/有界迭代：讨论手动再迭代一轮与显式启动多轮的范围，明确上一轮版本如何反馈、固定输入、轮次记录、轮数/时间/费用上限，以及人工编辑、Candidate、失败和停止边界。当前 Workflow v1 的禁止循环规则保持不变。
