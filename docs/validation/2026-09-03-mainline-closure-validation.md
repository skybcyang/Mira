# 2026-09-03 主线收口验证

- 状态：当前 `main` 的自动化门禁、文档一致性与 macOS 双架构分发包校验通过
- 验证基线：`c109f3e`（文档收口前的当前主线）
- 环境：macOS arm64，Node.js `v26.7.0`，pnpm `9.0.0`
- 范围：普通 Relation 移除后的主线、右侧栏/弹窗入口、Workflow/Board 生命周期、Desktop 打包产物

## 自动化门禁

| 命令 | 结果 |
| --- | --- |
| `pnpm test` | 通过：87 个测试文件，955 个测试 |
| `pnpm exec tsc --noEmit` | 通过，exit 0 |
| `pnpm build` | 通过；2177 modules transformed，无 chunk warning |
| `pnpm build:bridge` | 通过；生成 `dist-bridge/bridge.bundle.js` 与 `bridge.cordis.js` |
| `git diff --check` | 通过，exit 0 |

完整测试覆盖 Bridge 存储/API、Board 生命周期与导入恢复、Run/Candidate、Workflow、灵感池、
Desktop 宿主、架构边界、Relation 移除、右侧详情页签和响应式 UI 测试。

## Desktop 分发包

本轮执行 `pnpm desktop:make`，arm64 与 x64 均成功生成 `.dmg` 和 `.zip`：

| 架构 | DMG | ZIP |
| --- | --- | --- |
| arm64 | `out/desktop/make/Mira-0.1.0-beta.2-arm64.dmg` | `out/desktop/make/zip/darwin/arm64/Mira-darwin-arm64-0.1.0-beta.2.zip` |
| x64 | `out/desktop/make/Mira-0.1.0-beta.2-x64.dmg` | `out/desktop/make/zip/darwin/x64/Mira-darwin-x64-0.1.0-beta.2.zip` |

`hdiutil verify` 对两个 DMG 校验通过，`unzip -t` 对两个 ZIP 校验通过；解包后的应用主二进制
分别为 Mach-O `arm64` 与 `x86_64`。产物是 macOS 13+ unsigned、未公证的 internal Alpha，
不代表公开发布资格。

## 一致性收口

- 产品定义和核心规格已明确：Card 之间不存在普通关系连线，残留 `relations` 字段在读取和导入时静默忽略。
- 当前架构图、体验设计、实施路线和用户指南已移除普通 Relation 的现行产品表述，并更新到当前 `main` 与现行入口文案。
- 右侧详情、方法、计划和模型设置继续共用单一右侧栏；灵感池、文件选择器和画板管理使用真正的 `<dialog>` 弹窗；移动端右侧栏变为全宽 sheet。
- 远程 `origin/codex/inspiration-pool-picker` 已删除；其提交已是当前 `main` 的祖先，功能已完全包含在主线。

本轮没有改写 Board、Run 或 Workflow 数据；仓库根目录的 `.mira-workspace.lock` 与 `mockups/`
仍为本地未跟踪文件，不属于本次提交。
