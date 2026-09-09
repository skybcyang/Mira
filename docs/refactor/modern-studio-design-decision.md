# Modern Studio 设计处理决策

- 日期：2026-09-09
- 结论：用户明确要求保留 mockup 存档，不予实施。

`codex/modern-studio` 的视觉与交互探索仅保留为私有开发存档 `archive/2026-09-09-modern-studio/`，包括只读 mockup 图册和完整源码差异。开源准备时保全原存档，但不随公开源码快照分发；以下核对记录保持为当时事实。

本次进入 `main` 的仅为上述存档和文档记录，不合入该工作区的 `src/` 改动，不新增实施任务，不改变当前产品规则、UI 系统或桌面交付版本。未来若重新采用其中某项设计，应另行提出具体需求并验收。

`codex/contextual-inspector` 是独立的已交付开发线：它继承工作台布局、独立卡片名字和灵感池编辑，并完成右侧浮动详情栏、直接重命名、选择跟随、编辑草稿保护，以及转换卡切回内容卡时的详情同步修复。Modern Studio 存档不替代或撤回这条开发线，也不将该分支的合并视为本次存档操作的一部分。

## 存档核对

后续决策（2026-09-09）：用户随后明确要求将 `codex/contextual-inspector` 合入 `main`。本次集成保留 Modern Studio 存档，接入已交付的工作台、命名、灵感编辑与上下文详情栏代码；Modern Studio 仍不实施。上文关于存档操作范围的说明保留为当时记录。

- 13 个已跟踪文件差异和 1 个未跟踪组件全文与原工作区逐字一致。
- 三张快照使用临时 workspace 的虚构内容，未复制用户画板或秘密配置。
- 图册在 1280px 与 390px 浏览器中图片加载完整、无横向溢出，未记录 console warning/error；快照保留原桌面设计，不表示原设计完成移动端验收。
- `main` 基线的 132 个测试文件、1464 项测试通过；`pnpm exec tsc --noEmit`、`pnpm build`、`pnpm build:bridge` 与 `git diff --check` 通过。测试中存在 Node localStorage ExperimentalWarning。
- Modern Studio 仅为截图重新执行前端构建，不因此视为生产实现或产品验收通过。
