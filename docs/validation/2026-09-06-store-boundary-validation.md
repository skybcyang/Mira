# Store 边界收口验证

- 日期：2026-09-06
- 分支：`codex/store-boundary-cleanup`
- 基线：`f9d2ff1`，独立 `.worktrees/store-boundary-cleanup`
- 环境：macOS，Node.js 26.7.0，pnpm 9.0.0
- 范围：行为保持的 Store 拆分、架构边界与进度文档校正；未合入 main。

## 实现

复用 `codex/card-canvas-version-management-integration` 的 `8594438` 中已有
`src/v2/inspirationSlice.ts`，将灵感记录与批量快照放入从根 Store 移出。
保留当前公开动作、历史兼容调用、API、50 条会话历史及 Board 导航代次保护。
根 Store 注入 context、setForBoard、投影和通知，不增加第二份导航或领域状态。

Run slice 已在主线，本次只补防回流测试及文档。版本管理分支的检查点、详情面板、样式和
备份格式不进入本次改动。该分支记录 D1–D5 已确认且实现完成，但三档真实浏览器复验待补；
文档地图据此区分分支进度与主线能力，不改变主线的产品规格。

## 验证

- 基线全仓：100 个测试文件、1144 项用例通过。
- RED：新增灵感 slice 架构测试因根 Store 尚未委托给 slice 而失败。
- 新增两项特征测试：离开后返回同一 Board，迟到批量成功或失败均不改当前画板状态；重构前后均通过。
- 定向 GREEN：架构、灵感 Store、Canvas、Run、灵感池 Bridge store/HTTP 共 44 项用例通过。
- 最终 `pnpm test`：100 个测试文件、1148 项用例通过，含全仓 Bridge 集成测试。
- `pnpm exec tsc --noEmit`、`pnpm build`、`pnpm build:bridge` 与 `git diff --check` 均 exit 0。
- 前端仍保留所有原有延迟 feature chunk；最大 JavaScript chunk 326.33 kB，无 500 kB 警告。
- 测试有 Node 26 既有 localStorage ExperimentalWarning；不宣称输出零警告。

完成后逐项复核提取代码与原实现：来源映射、批量顺序、错误返回、history 截断、context
检查和现有兼容调用保持不变。新增 slice 与上述集成分支文件一致，没有引入新依赖。

## 边界与剩余工作

本批未改 JSX、样式、可见交互或桌面宿主，没有启动产品服务、执行浏览器验收或桌面 make。
自动化回归不替代版本管理分支仍欠缺的真实浏览器验收。详情面板、集中样式及根 Store
其余职责继续作为后续热点，不把本切片描述为全部工程减重完成。

未修改用户 Board、Run、Workflow 或灵感池。根 workspace 的 `.mira-workspace.lock` 经核对
仍对应 PID 1717、工作目录为本仓库、监听 127.0.0.1:56300 的 Node 进程，未删除或停止该进程。
锁文件删除须先确认停止使用该 workspace 的写者，不能仅为了清洁 Git 状态移除活动锁。
