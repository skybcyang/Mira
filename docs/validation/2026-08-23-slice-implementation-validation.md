# Mira Slices A-E 实现验证

- 日期：2026-08-23
- 范围：工程与技术狗食验证，不替代目标用户研究
- 服务：独立重载的 DSH web profile，`http://127.0.0.1:56300/graphmind/`

> **当前解释（2026-08-23）**：本文证明 CardVersion、Candidate、多来源、手动分支和响应式 v2 基线。本文中的“高级模式动态加载 LegacyApp”是当时 Slice E 的隔离方案，现已被后续产品决策取代，不再是目标行为。当前产品只有一套画板与流程体验；旧 Action/chain 只保留为产品之外的只读归档，UI、API 和 bridge 均无兼容或迁移入口。复用方法统一为 WorkflowTemplate，应用只铺出普通 Card/Transformation 且不启动 Run。本文保留原始验证事实，不定义当前产品。

## 1. 结论

Slices A-E 已接入同一条 v2 默认路径。默认界面不再要求用户理解 Action、input、output、next 或 executor；这些能力只在动态加载的高级模式中出现。

核心安全命题通过真实运行验证：模型运行期间人工编辑目标 Card，最终输出进入 Candidate，人工 Head 和历史版本保持不变。

## 2. 持久证据

### T1 单卡推进

- Board：`board-uvkfhfmt57n6pp`，标题“Slice 验收画板”。
- 来源 Card：`card-d03nipmt57q14n`。
- 首次 Run：`run-3g47e9mt57ub93`，结果 `succeeded/applied`。
- 结果 Card 建立 AI v1，随后人工追加“`[人工决策-不可丢] 暂定名称：回声`”形成 v2。
- UI 验证了新卡原地编辑、Version footer、成果建议、稳定目标卡和版本 drawer。

### T2 多来源

- Board：`board-mbeeyymt587230`，标题“T2 多来源验收”。
- 三张来源以 1/2/3 显示在 Card 角标和 Context dock。
- 来源可前移、后移和移除。
- 真实建议为“综合成一页决策”“比较并给出选择”“整理成执行计划”。
- Bridge 集成测试另外验证 source snapshot 严格保留用户顺序。

### T4 并发编辑

- Run：`run-0s9dgpmt57yhft`。
- Run 基于目标 v1 启动，运行中人工创建 v2 并加入唯一标记。
- 终态为 `succeeded/candidate`，目标 Head 仍为人工 v2。
- Candidate drawer 展示当前内容与模型结果；采用会创建新版本，丢弃不修改 Card。

## 3. 手动分支与 legacy

- 从选中 Card 的连接点拖到画布空白处后，Context dock 显示“新方向”；取消不会写入 Board。
- 连到现有 Card 只创建普通 Relation。
- 重新生成、stale 和 Candidate 都不会自动创建分支。
- 更多菜单进入高级模式时才加载 `LegacyApp` chunk；界面持续显示“高级模式”，可显式退出回 v2。

## 4. 响应式证据

- `1440+`：Canvas 与 360px drawer 使用稳定列。
- `1024x768`：drawer 左缘 664px，Context dock 右缘 648px，无重叠；页面宽度 1024px。
- `390x844`：页面宽度和 body scroll width 都为 390px；drawer 宽 390px；主要命令高度 44px；drawer 打开时 dock 隐藏。

## 5. 工程验证

```text
pnpm test             37 files, 176 tests passed
pnpm exec tsc --noEmit
pnpm build
pnpm build:bridge
```

真实 DSH 存储还验证了：写入临时 JSON、重新读取校验、通过 `processPath` 调用 Node 原子 rename，再加载最终文件。失败诊断产生的两个 `.tmp` 文件已清理，未留下错误 Board。
