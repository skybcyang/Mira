# Mira v0.1.0-beta.1 候选验收记录

> 历史证据：本报告记录 Beta.1 候选当时的范围和测试数字，不定义后续源码。当前用户文档、
> 集成能力和门禁结果见[2026-09-01 验证](2026-09-01-current-main-documentation-validation.md)。

- 日期：2026-08-31
- 服务：`http://127.0.0.1:56301/graphmind/`
- 状态：代码与 UI 门禁通过；真实 Kimi 生成待凭据
- 对应方案：[`../release/0.1.0-beta.1.md`](../release/0.1.0-beta.1.md)

## 1. 本轮范围

本轮验证覆盖线性网格、紧凑 Transformation 卡、`运行到这里`的依赖规划与 Store 编排、Workflow 输入连线、单步模型设置、Candidate/失败停止规则，以及 Standalone/Bridge 构建。用户 Board/Run 数据不作为规格或发布载荷。

## 2. 自动化证据

最终工作区执行结果：

| 门禁 | 结果 |
| --- | --- |
| `pnpm test` | 通过：47 个测试文件，371 个用例 |
| `pnpm exec tsc --noEmit` | 通过 |
| `pnpm build` | 通过：2164 modules transformed |
| `pnpm build:bridge` | 通过 |
| `git diff --check` | 通过 |

其中 `src/v2Store.execution.test.ts` 覆盖 stale 上游按依赖顺序执行、重复点击锁、全部最新时零 Run、Candidate 停止和失败停止；`src/v2State.test.ts` 覆盖依赖排序、循环拒绝、人工内容保留、空目标、stale、缺素材与运行信息不可确认。完整 Bridge 集成测试随全量测试通过。

## 3. 浏览器证据

- 1440 × 900：线性网格可见；当前 Board 的 5 个 Transformation 均暴露`运行到这里`；紧凑节点、内容卡和连线无异常遮挡。
- 390 × 844：页面宽度与文档滚动宽度均为 390px，无横向溢出；关系详情使用全宽 sheet。
- 窄屏详情主命令尺寸为 362 × 44px，完整显示`运行到这里`，与相邻命令无重叠。
- 内置浏览器当前不提供 console 事件流读取，因此未独立导出 console warning/error；页面加载、DOM 快照和实际交互未出现可见错误状态。

## 4. 模型连接证据

Standalone 初始返回 `configured:false`，因此用户点击生成得到 `MODEL_UNAVAILABLE`。随后已把当前服务会话的默认模型设置为：

- Base URL：`https://api.kimi.com/coding/v1`
- Model：`k3`
- Transformation 覆盖：无，全部继承默认模型

连接测试返回 `401 MODEL_AUTH_FAILED / Invalid Authentication`，因为当前进程和仓库均没有 Kimi API Key。此结果证明错误位于凭据配置，不是`运行到这里`依赖编排；但也意味着尚未完成真实模型的两步端到端验收。

## 5. 发布结论

- 可以上传 feature branch 并创建 Draft PR。
- 可以把 `v0.1.0-beta.1` 作为 prerelease 候选设计。
- 在提供有效 Kimi API Key、连接测试通过并完成一次真实两步`运行到这里`前，不应创建 stable Release，也不应把真实模型狗食标记为通过。
