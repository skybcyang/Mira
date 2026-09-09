# Mira 归档与清理规格

- 状态：生产清理与完整工程、桌面及窄屏验证已完成；归档政策持续生效
- 日期：2026-09-01
- 目标模型：[`core-specification.md`](core-specification.md)

## 1. 目标

本轮清理删除三类重复事实来源：

1. v1 与 v2 并存的 App、Store、Canvas、HTTP 和写回逻辑。
2. Action、chain 与内容转化并存造成的第二套产品心智。
3. 旧需求、原型和当前规范并列造成的文档歧义。

生产链路只保留：

```text
Card -> Version -> Transformation -> Run -> Version | Candidate
                         |
                         +-> 提取 WorkflowTemplate
                                  |
                                  +-> 铺出普通 WorkflowPlan（零 Run）
```

## 2. 归档政策

1. 被新模型替代的源码、测试、样式和重复文档可以删除，历史由 Git 和日期归档追溯。
2. 用户原始 v1 Board/Run 不因代码清理而删除或改写，只作为离线只读归档。
3. Mira 产品运行时不扫描、不解析、不展示 v1 数据。
4. Mira UI、HTTP API、bridge 和 production bundle 不提供 legacy compatibility、preview、migration 或 export endpoint。
5. 如需恢复旧内容，必须由操作者显式运行产品之外的一次性离线工具。
6. 旧 Action/chain 不自动转换为 WorkflowTemplate；方法必须在当前画板重新走通并满足模板提取门槛。
7. 归档不参与生产 import、构建、测试 fixture 或启动时发现。

## 3. 存储边界

| 数据 | 位置 | 生产行为 |
| --- | --- | --- |
| Board v2 | `boards-v2/` | 唯一 Board 读写来源 |
| Run v2 | `runs-v2/` | 唯一 Run 读写来源 |
| WorkflowTemplate | `workflows-v2/` | 全局模板读写来源 |
| v1 Board/Run | `archive/2026-08-23-vnext-rebaseline/data/` | 产品运行时完全忽略，只供离线恢复 |
| 历史代码/文档 | `archive/` 与 Git history | 只供人工追溯 |

物理目录仍存在不代表运行时兼容。生产入口必须只构造 v2 BoardStore、RunStore 和 WorkflowStore，不能按目录存在与否回退到 v1。

## 4. 离线恢复协议

离线恢复不是 Mira 功能，也不提供常驻脚本或后台服务。只有在用户明确提出恢复某份历史数据时，才为该次任务准备受控工具。

### 4.1 输入保护

- 解析前记录原始文件路径、大小和 digest。
- 工具只读原文件，不在原目录创建 temp 或状态文件。
- 固定输入副本用于测试，不能直接用可变用户目录作为 fixture。
- 解析失败时输出报告，不修补或覆盖原 JSON。

### 4.2 可恢复内容

- 可确认的文本可生成新的 ContentCard 与 `origin: import` CardVersion。
- 可确认的一对多来源、单目标关系可生成新的 Transformation。
- 缺少 Version、来源快照或目标依据时不伪造历史 Run。
- 系统占位、执行状态和错误正文不冒充用户内容。
- Action、executor、tool、next edge、session 和 chain run 只保留在原始归档报告中。

### 4.3 输出与导入

```text
只读原始输入
  -> 离线解析与报告
  -> 内存生成独立 BoardV2
  -> schema 与引用完整性校验
  -> 写入操作者指定的新文件
  -> 重新读取并校验 digest
  -> 操作者显式放入 boards-v2/
```

输出使用新的 Board ID，不覆盖任何已有 v2 Board。失败不得留下可被生产服务误认的半写文件。

## 5. Workflow 与历史链的边界

WorkflowTemplate 不是旧 chain 的新名字：

- 模板只来自当前 Board 中有序、线性、无环的 Transformation。
- 每一步目标必须有当前 Head，且 Head 内容非空白、结构可用。
- 模板不保存旧节点 ID、正文、Run、session、tool 或 runtime branch。
- 应用模板只创建普通 Card/Transformation 和 `workflowRef`，不会运行。
- 后续步骤不会因前一步成功而自动开始。
- 结构分支仍只由用户手动画图或明确创建目标产生。

离线恢复得到的 Card/Transformation 只有在用户重新检查并走通后，才可以像其他当前对象一样保存为模板。

## 6. 已落地的生产清理

从当前生产源码表面已移除：

- LegacyApp 与第二套 App/Store/types/API client。
- 旧 Canvas 组件、Inspector、Toolbar 和 Action/chain 展示。
- Action HTTP、Action runtime、chain runner、v1 Board/Run store。
- v1 executable、suggestion/transformation HTTP 和直接 `node.text` 写回。
- legacy Board adapter 与运行时 migration route。
- 只服务旧 UI 的测试、export prototype 和脚本。
- `src/styles.css` 中 legacy/migration 及已删除组件的 selector。

当前生产边界为：

```text
src/App.tsx + src/v2/ + src/domain/
bridge/main.js + bridge/mira-application.js + bridge/v2-* + bridge/domain/
bridge/node-host.js + bridge/dsh-cordis-adapter.js
bridge/workflow-store.js + bridge/workflow-service.js
```

“已移除”同时受架构测试、完整构建和浏览器验收约束。当前完成证据见
[`2026-08-23 Workflow 重构验收`](../validation/2026-08-23-workflow-rebuild-validation.md)、
[`2026-08-31 Release 候选验收`](../validation/2026-08-31-release-candidate-validation.md)与
[`2026-08-31 macOS 桌面 Alpha 验证`](../validation/2026-08-31-macos-desktop-alpha-validation.md)，
当前文档与后续功能见[`2026-09-01 PR4 集成分支验证`](../validation/2026-09-01-current-main-documentation-validation.md)；
之后的功能仍必须取得自己的新鲜门禁证据。

## 7. 架构约束

- `src/App.tsx` 不得动态或静态加载第二套应用。
- 核心应用和所有平台适配器不得构造 v1 Store、legacy adapter 或 Action/chain service。
- `bridge/v2-routes.js` 对任何 migration/legacy 路径返回 404。
- Board validator 拒绝嵌入 legacy object graph。
- package、Vite 和 index 不保留旧 export/prototype entry。
- 生产源码搜索到 Action/chain/legacy 时，只允许出现在拒绝性校验或架构测试中，不能形成可调用能力。

## 8. 文档政策

Active `docs/` 只保留文档地图列出的产品、规格、UX/UI、用户手册、路线和验证报告。旧 redirect/stub、HTML prototype 和重复说明已从 active docs 删除。

历史验证报告保留当时事实和真实 ID，并使用 superseded 注记说明其结论不再定义当前产品。归档文档不得被生产代码或当前规范当作依赖。

## 9. 验证门槛

每次可能影响生产边界、Workflow 或归档政策的变更在完成前必须运行：

```text
targeted workflow and architecture tests
full unit and integration tests
TypeScript check
frontend build
bridge build
desktop browser workflow
compact and mobile browser workflow
git diff --check
```

其中浏览器必须覆盖：保存已走通路径、拒绝空白成果、应用计划零 Run、从下游运行到指定目标且不越界、素材变化只重跑受影响步骤、Candidate 保留人工 Head，以及手动分支。

离线恢复工具只有实际创建时才需要单独验证：原文件未变、失败零写入、输出 schema 有效、ID 不冲突、重复运行可预测。

## 10. 完成定义

- 产品只有当前画板与流程模板库。
- 生产 UI、API、bridge、bundle 和启动路径不含 v1/Action/chain 兼容或迁移能力。
- v1 数据只读归档，恢复只能由操作者显式使用离线工具。
- WorkflowTemplate 与 WorkflowPlan 完全复用当前 Card/Transformation/Run 安全语义。
- 应用流程零 Run，后续步骤零自动启动，系统零自动结构分支。
- 权威文档互相一致。
- 完整工程验证与桌面、窄屏浏览器主流程均有新鲜证据。
