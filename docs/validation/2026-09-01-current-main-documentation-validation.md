# 2026-09-01 PR4 集成分支与用户文档验证

- 状态：PR4 直接记录灵感、文档与两档浏览器验收完成；保留已知历史容量和窄屏 toast 限制
- 代码基线：`e5f01c0`（`codex/merge-direct-inspiration`，合并 PR4 direct capture）
- 已标记基线：`v0.1.0-beta.2` 位于 `8880a07`，不包含灵感池或直接记录
- 环境：macOS，Node.js `v26.7.0`，pnpm `9.0.0`

> 当前解释（2026-09-04）：本文中“向指定来源画板直接记录、按来源 Board 检索”的语义已被 workspace 独立灵感池取代，见 [2026-09-04 workspace 独立灵感池验证](2026-09-04-inspiration-pool-validation.md)。本文保留当时验证事实，不再定义当前产品。

本报告验证 PR4 合入隔离集成分支后的源码、权威文档和用户手册是否一致。验证使用独立临时
workspace，不读取或改写仓库中的 Board、Run 或 Workflow 数据。工作区原有的业务数据、
桌面图标/打包测试和架构导出不属于本次文档修改，也没有被带入验证结论。

## 文档范围

- [用户使用手册](../user/user-guide.md)首节保留 Desktop 与 Standalone Quickstart，并补充
  主动切换 workspace、关闭窗口不退出、HTTPS、模型建议实际文本传输与单写者边界。
- 灵感入口同时覆盖已有内容检索/有序放入和向指定来源画板直接记录；直接记录只创建普通
  Markdown Card，不创建 Transformation、Run、`inspirationRef` 或自动选择。
- 手册补齐 Transformation 文案/来源编辑、步骤模型覆盖、停止/重试、Candidate 和有限历史。
- `cards/restore` 仍只定义为同进程精确删除回执的 undo 通道，不是 import 或通用恢复 API。
- Beta.2 文档保持历史 tag 边界；当前集成能力不回写 `v0.1.0-beta.2` 的变化范围。

## 自动化门禁

| 命令 | 结果 |
| --- | --- |
| `pnpm test` | 通过：62 个测试文件，545 个用例 |
| `pnpm exec tsc --noEmit` | 通过，exit 0 |
| `pnpm build` | 通过；保留独立 `canvas-vendor`、`DetailDrawer`、`WorkflowLibrary`、`ModelSettings` 与 `InspirationPicker` chunk，无 500 kB warning |
| `pnpm build:bridge` | 通过，exit 0 |
| `git diff --check` | 通过，exit 0 |

全量测试包含直接记录的输入/标签映射、指定 Board 写入、服务端 `board-bottom` 几何、
Store 当前/外部 Board 行为、HTTP 路由与失败零写入，也覆盖已有灵感选择顺序、Card 历史、
Transformation 模型覆盖、桌面边界和动态 feature。Bridge 集成覆盖没有用 mock UI 代替。

## 真实浏览器

最新 renderer 先执行生产构建，再通过独立临时 workspace 的 Standalone Node Host 验证。
本轮未配置模型适配器，因此浏览器范围集中在直接记录、布局、焦点和持久化，不声称真实模型
生成通过。

### 桌面 1280 x 720

- 从 App bar 打开`灵感`，选择来源画板并进入`记录灵感`；正文输入自动获得焦点。
- 输入 Markdown、常用标签与自定义标签后，`保存灵感`成功，界面显示目标画板反馈并清空
  正文；重新读取来源画板可见新普通 Card，位于已有内容底部。
- 新 Card 没有跨画板出处、Relation、Transformation 或 Run；当前画板不会被自动切换或选中。
- 聚焦且选中的 Card 使用 React Flow 原生键盘交互：`ArrowRight` 从 `x=640` 移到
  `x=645`，`Shift + ArrowRight` 再移到 `x=665`；`onNodesChange` 写回位置，撤销回到
  `645`、重做到 `665`。App 的快捷键策略未拦截这一原生行为。
- 弹窗、页体均无横向溢出，最终 console warning/error 为 0。

### 窄屏 390 x 844

- 灵感选择器覆盖完整 viewport；`记录灵感`替换检索主体，正文、标签和固定底部
  `保存灵感`在 390px 视口内可达。本轮没有实际唤起 macOS 系统软键盘，不把软键盘避让记为已验收。
- 使用正文和标签完成直接记录，成功反馈可见；返回检索后仍可继续筛选已有内容。
- 页面与选择器均无横向溢出，直接记录流程无控件遮挡，console warning/error 为 0。

## 已知限制

### P1：历史容量契约不一致

浏览器每个 Board 会话最多保留 50 条历史命令；Bridge 只在当前进程合计保留最近 500 张
已删除 Card 的精确回执。单条批量删除可以超过普通历史粒度，后续删除也会淘汰旧回执，因此
较大或较旧批次即使仍显示在 50 条 UI 历史中，撤销也可能返回
`CARD_RESTORE_CONFLICT`。服务会整批拒绝，不会部分恢复。发布前应统一两个容量契约，或
让前端在回执不可恢复时明确失效对应历史项。当前失败项仍留在栈顶，重复撤销不会跳过它，
因此更早的历史也会被挡住。

### 现有 UI 与验证限制

- 窄屏执行撤销/重做后，`.v2-toast` 仍可能纵向拉伸并遮挡内容；本轮直接记录流程未触发
  该命令，因此“390px 直接记录无溢出/console 错误”不等于 toast 缺陷已经修复。
- 从灵感结果加入当前 Board 已有 Card 时，Store 会选中但不会把离屏 Card 自动平移到视口；
  这仍低于产品与 UX 的“定位并选中”目标。
- 未配置 API Key，未执行真实模型连接、生成、Candidate 或多步`运行到这里`。
- 本轮未运行 `desktop:make:*` 或 packed smoke；2026-08-31 桌面报告只证明当时产物。
  当前 Desktop 仍是未签名、未公证、无自动更新的 macOS internal Alpha，任何既有图标或
  打包改动都需要独立 make、packed smoke 和真实 `.app` 验收。
