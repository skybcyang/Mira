# Mira 文档地图

开源协作入口：[贡献指南](../CONTRIBUTING.md) · [安全说明](../SECURITY.md) · [短期路线图](../ROADMAP.md) · [发布准备](operations/open-source-release.md)。

本次开源准备的测试、依赖审计和未发布边界见 [2026-09-10 验证记录](validation/2026-09-10-open-source-readiness.md)。

## 用户入口

最新导航：统一画板搜索、常用与已打开、手动关闭，以及“方法与计划”的合并入口，见[2026-09-09 验证记录](validation/2026-09-09-board-navigation-plan-validation.md)。

第一次使用从[新手教程](user/getting-started.md)开始：用可复制的反馈材料完成第一份需求说明，再推进为验收清单。[场景案例](user/use-cases.md)提供需求变更、主题阅读、竞争解释与人工改稿四种不同结构的真实界面图；[下载案例](examples/README.md)可导入画板，或恢复包含灵感池、方法和画布版本的独立练习工作区。

查具体功能请读[用户使用手册](user/user-guide.md)。手册首节提供 macOS Desktop 与
Standalone Quickstart，后续覆盖六套外观、模型连接、Card/版本、workspace 灵感池记录与检索、添加步骤、Run 进度与按需生成、计划/方法、Candidate、
有限撤销/重做、快捷键、数据边界和排障。手册解释当前界面，不覆盖下方产品与规格权威来源。

2026-09-05 当前源码包含三种设计方向及浅色/深色组合，并完成画布、详情、菜单、移动端交互与 Run 可观测性加固。
使用旧 Beta.2 安装包时，界面能力可能少于本手册；已标记版本范围见
[Beta.2 Release 基线](release/0.1.0-beta.2.md)。

## 权威顺序

遇到冲突时按以下顺序判断：

1. [产品定义](product/product-definition.md)：产品解决什么问题、用户如何工作、哪些能力不做。
2. [核心规格](specs/core-specification.md)：对象、状态、原子性、API 和验收契约。
3. [体验设计](design/experience-design.md)：信息架构、流程、语言、响应式与无障碍。
4. [UI 系统](design/ui-system.md)：视觉 token、组件和状态呈现。
5. [迁移与清理规格](specs/migration-plan.md)：旧数据、旧代码和文档如何退出。
6. [实施路线](refactor/implementation-roadmap.md)：当前切片、验证门槛和完成状态。

AI 工具统一从仓库根目录的 [AGENTS.md](../AGENTS.md) 开始，其中已合并协作、数据安全与文档治理规则；当前代码依赖方向和改动路由见 [架构图](architecture/system-map.md)。这些入口不覆盖上述产品和规格权威顺序。

源码启动、环境变量、模型适配、macOS 后台服务与开发命令见[运行、开发与维护](operations/development.md)；macOS / Windows 内部测试包获取与构建见[内部桌面打包](operations/desktop-internal-builds.md)。根 [README](../README.md) 只承担产品介绍与新用户入口。

平台部署与扩展接口见 [平台适配器契约](specs/platform-adapters.md)：核心应用、文件存储、模型执行、Standalone Node host、macOS Electron thin shell 与可选 DSH/Cordis 适配器的依赖边界。桌面宿主的已采纳决策见 [macOS 桌面 ADR](architecture/adr-macos-desktop-shell.md)。Node workspace 锁残留的离线处理见 [Workspace Lock Recovery](operations/workspace-lock-recovery.md)。

产品主线只有一句：

> **默认从内容开始，也允许先搭计划；走通后再固化方法。**

用户可以先把新想法记录到 workspace 灵感池，再从灵感池筛选并添加到当前画板；也可以在“方法与计划”填写计划名称、最终成果和至少一个有序步骤，或使用已验证模板。计划入口都先放入页面内 PlanDraft，由用户手动绑定内容，再原子添加普通 WorkflowPlan，并且零自动 Run。WorkflowTemplate 仍只从已经验证的 Transformation 路径提取：每一步目标的当前 Head 都必须存在且实际内容非空白、结构可用。Mira 始终使用同一套画板、内容与执行语义；有限撤销/重做只覆盖当前 Board 会话中的约定 Card 操作。

## 验证证据

- [2026-09-09 真实工作场景案例](validation/2026-09-09-realistic-use-cases-validation.md)：重做四种画板与操作近景，提供可导入案例及完整练习工作区，验证来源变化、待比较结果与可移植边界。

- [2026-09-09 用户文档与案例图](validation/2026-09-09-user-documentation-validation.md)：单一 Agent 入口、产品介绍、首次使用教程、四个领域真实界面图、链接与桌面/390px 阅读验证，以及 1525 项测试和构建门禁。

- [2026-09-09 跨平台内部打包](validation/2026-09-09-desktop-ci-validation.md)：GitHub Actions、Mac 双架构 make/smoke、Windows x64 打包配置及 Host 退出锁释放回归。

- [2026-09-09 上下文详情栏合入 main](validation/2026-09-09-inspector-main-integration.md)：保留 Modern Studio 存档，1504 项测试、类型检查、前后端构建与桌面/390px 卡片切换复核通过。

- [2026-09-08 独立名称与悬浮详情 macOS 本地交付](validation/2026-09-08-inspector-macos-install-validation.md)：1504 项测试、90 项桌面定向、arm64 构建及两种 packed smoke、原生 UI 验证和可回退安装。

- [2026-09-08 悬浮详情与卡片跟随验证](validation/2026-09-08-contextual-inspector-validation.md)：直接改名、单选跟随、统一保存后离开、冲突草稿保护及 1502 项测试与三档浏览器验收。

- [2026-09-07 多来源转化编辑验证](validation/2026-09-07-transformation-sources-validation.md)：拖线追加、点选来源、移除排序、依赖环拒绝，以及与卡片交互主干集成后的 1464 项测试和桌面/390px 浏览器验收。

- [2026-09-06 卡片颜色与显式分组验证](validation/2026-09-06-card-grouping-validation.md)：独立分支、约束、原子整理与回执、可移植数据、桌面与 390px 浏览器验收。

- [2026-09-06 版本管理交付验证](validation/2026-09-06-checkpoint-delivery-validation.md)：当前模块边界适配、预览和副本并发修复、三档浏览器、原生桌面选择/保存、完整备份恢复与 arm64 packed smoke。

- [2026-09-05 Card 与画布版本管理验证](validation/2026-09-05-card-canvas-version-management-validation.md)：检查点、备份 V2 与版本体验的原分支验证；当时未完成的浏览器验收由交付批次补齐，不回写历史结论。

- [2026-09-06 剩余边界拆分集成验证](validation/2026-09-06-boundary-split-integration-validation.md)：Store 命令 slices、详情分面与 17 个 CSS 模块的等价性、集成门禁、三档视口、Candidate 与停止验收。

- [2026-09-06 Store 边界验证](validation/2026-09-06-store-boundary-validation.md)：灵感命令 slice 提取、Run/灵感编排防回流、迟到响应回归与完整自动化门禁；无可见 UI 或产品语义变化。

- [2026-09-06 当前画板卡片搜索验证](validation/2026-09-06-card-search-validation.md)：当前 Head 检索、命中片段、键盘与三档可读定位、取消保持上下文，以及完整自动化门禁；用户已确认开发验收完成。

- [2026-09-05 Beta.3 Run 可观测性验证](validation/2026-09-05-beta3-run-observability-validation.md)：最近 20 条公开 Run 事件、Canvas 入口、停止投影、Candidate 安全、三档响应式与六套外观的自动化和真实浏览器证据。
- [2026-09-05 六套外观与画布 UX 验证](validation/2026-09-05-six-appearances-canvas-ux-validation.md)：三方向与浅色/深色组合、画布/详情交互、异步安全、三档响应式和焦点行为的自动化与真实浏览器证据。
- [2026-09-04 workspace 独立灵感池验证](validation/2026-09-04-inspiration-pool-validation.md)：独立池存储/记录/添加的自动化与真实浏览器验收、390px 与打包 smoke 的当次证据。
- [2026-09-03 主线收口验证](validation/2026-09-03-mainline-closure-validation.md)：当前 `main` 的完整自动化门禁、双架构桌面分发包完整性、文档一致性与远程分支清理结果。
- [2026-09-02 Board 生命周期与可移植数据集成验证](validation/2026-09-02-board-lifecycle-portability-validation.md)：Board 生命周期、导入导出、完整备份与恢复、永久清除、workspace 写锁、三档浏览器和双架构 Desktop 的最新集成证据。
- [2026-09-01 PR4 集成分支与用户文档验证](validation/2026-09-01-current-main-documentation-validation.md)：灵感直接记录、检索、有限会话历史、用户手册、自动化门禁与桌面/390px 入口核对的当次证据。
- [2026-08-31 macOS 桌面 Alpha 验证](validation/2026-08-31-macos-desktop-alpha-validation.md)：Electron 44 双架构 unsigned app/DMG/ZIP、packed smoke、可见桌面/390px UI 与完整全仓门禁的当次证据。
- [2026-08-31 Release 候选验收](validation/2026-08-31-release-candidate-validation.md)：`运行到这里`、线性网格、模型设置、完整自动化门禁与两档浏览器验证；真实 Kimi 生成仍受缺少 API Key 阻塞。
- [2026-08-25 11 号画布布局验收](validation/2026-08-25-showcase-11-layout-validation.md)：53 张卡片的阶段化流程布局、超高扇入聚合节点、桌面零重叠与移动端首屏可读性证据。
- [2026-08-23 Workflow 重构验收](validation/2026-08-23-workflow-rebuild-validation.md)：单模式、方法提取、三来源应用、真实三步运行、Candidate 安全、模板生命周期与三档响应式的当前证据。
- [2026-08-22 核心闭环验证](validation/2026-08-22-core-loop-validation.md)：重构前的技术狗食，暴露多来源和人工覆盖问题。
- [2026-08-23 Slices A-E 实现验证](validation/2026-08-23-slice-implementation-validation.md)：CardVersion、Candidate、多来源与响应式 v2 基线；其中“高级模式隔离”已被后续 Workflow 产品决策取代。

工程减重记录见 [2026-08-25 架构减重](refactor/2026-08-25-architecture-reduction.md)，其中包含模块行数、构建 chunk 和后续热点，不作为产品事实来源。

最新已标记版本的范围、版本策略和发布门禁见 [v0.1.0-beta.2 Release 基线](release/0.1.0-beta.2.md)。分支迁移已经完成，当前 `main` 已继续演进；历史 `beta.1` 方案和验证记录保持不变。

## 平台实施

- [GitHub Actions 内部桌面打包](operations/desktop-internal-builds.md)：手动或打包相关变更 push 触发，生成 macOS arm64/x64 DMG/ZIP 与 Windows x64 免安装 ZIP，先检查与 packed smoke，再上传内部产物，不自动发布 Release。

- [macOS 桌面薄壳实施记录](refactor/macos-desktop-shell-todo.md)：Electron 44 internal Alpha 已实现，复用同一 React UI、HTTP API 和 Node Host。当前只用于内部验证，未签名、未公证、没有自动更新或公开分发。
- Web/Standalone 仍是产品与日常开发主线；Desktop 是发布验证目标，不得演化成第二套领域、Store、API 或 UI。

## 画布版本管理

- [Card 与画布版本管理详细设计](refactor/card-canvas-version-management-todo.md)：D1–D5 已确认，检查点、从版本创建独立副本、MiraBackup V2 与旧备份兼容按同一批交付。实现沿用当前 Store slice、详情分面和 CSS 模块；具体进度以实施路线和最新验证证据为准。

## 卡片与推进体验

- [2026-09-08 独立卡片名称与灵感编辑](validation/2026-09-08-card-names-inspiration-edit-validation.md)：独立名称、池版本编辑、并发和草稿保护，1495 项测试、真实 HTTP 与桌面/390px 验收。

- [工作台布局与交互详细设计](refactor/workbench-layout-design.md)：D1–D5 已实现，保留当前六套外观，覆盖导航、同一详情任务、候选比较、灵感浏览与三档布局。
- [2026-09-08 工作台实施验证](validation/2026-09-08-workbench-layout-validation.md)：1478 项测试、类型检查、两套构建及 Web 主链路通过；逐项记录 30 个设计场景的证据与真机等未验证边界。
- [2026-09-08 顶栏与悬浮工具细化](validation/2026-09-08-floating-tools-validation.md)：按反馈调整字标、居中搜索、历史/设置入口、悬浮工具栏与网格显示偏好。
- [2026-09-08 顶栏画板管理与平铺工具栏](validation/2026-09-08-direct-work-tools-validation.md)：管理画板上移、工具全部直达、去除重复搜索与衬线斜体字标。
- [2026-09-08 工作台新版 macOS 安装](validation/2026-09-08-workbench-macos-install-validation.md)：arm64 构建、packed smoke、原生 UI 验证与本机应用替换。

- [2026-09-07 Markdown 预览修复](validation/2026-09-07-markdown-preview-validation.md)：卡片、详情和来源统一支持常用 GFM 语法，表格局部滚动，1448 项测试及桌面/390px 浏览器验证通过。

- [卡片与推进体验设计记录](refactor/card-interaction-design-proposal.md)：D1-D5 已确认并实现，保留交互取舍、尺寸历史与连续创建边界。
- [竞品参考与体验改进 TODO](refactor/competitor-reference-todo.md)：本轮 B1-B5、R1-R3、R5-R6 已实现，R8-R9 暂缓；不增加语义卡片类型或普通关系线。
- [2026-09-07 卡片交互验证](validation/2026-09-07-card-interaction-validation.md)：独立集成分支、1440 项测试、三档浏览器、六套外观和方法复用证据；真实模型及触屏设备未验收。

## 暂缓与待讨论

- [保留首尾的推导链折叠 TODO](refactor/chain-collapse-design-todo.md)：2026-09-06 用户确认暂缓，不实现、不排期。先使用颜色与分组验证真实痛点；重启条件和分组兼容未决项保留在 TODO，不属于当前产品规则。

验证报告记录当时真实事实和 ID，不因结论过时而改写。报告顶部的“当前解释”说明哪些假设已被后续决策或实现取代。只有当结论进入产品定义和规格后，才会改变当前实现。

## 历史与归档

- [Modern Studio 设计处理决策](refactor/modern-studio-design-decision.md)：2026-09-09 用户确认仅保留 mockup 和源码差异存档，不实施、不排期；存档已纳入 main。

旧需求、架构、Action runtime、chain 狗食、原型和设计过程位于：

- 私有开发存档中的 `archive/2026-08-23-vnext-rebaseline/`
- 更早的日期归档与私有开发 Git history；公开源码快照不包含这些原始资料

Active docs/ 不保留 redirect/stub 或旧 HTML prototype。`docs/architecture/` 下的 HTML、PNG 或
JSON 架构导出若存在，只是非权威审阅产物，当前边界仍以 `system-map.md` 为准，因此不列入
文档地图。用户手册是面向操作的非规格文档；归档只用于追溯，不属于产品规范，不得被生产
代码、构建或测试依赖。

旧 Action/chain 数据只作为离线只读归档：

- Mira UI、HTTP API 和 bridge 运行时不扫描、不加载，也不暴露兼容入口。
- 如需恢复，由操作者显式运行离线工具；工具只读原始输入并生成新的、经过校验的 v2 文件。
- 无法可靠转换的对象继续保留在原始归档中。

旧链不会自动变成 WorkflowTemplate；要复用方法，必须在当前画板重新走通并保存。

## 变更流程

    用户目标或验证证据
      -> 产品定义
      -> 核心规格与验收
      -> UX/UI
      -> 失败测试
      -> 实现
      -> 工程验证与真实课题
      -> 同步状态和证据

任何文档若同时定义产品和实现、或与上述权威文件重复，应合并后删除。当前代码、可变 Board 和历史计划不能反向成为产品事实来源。
