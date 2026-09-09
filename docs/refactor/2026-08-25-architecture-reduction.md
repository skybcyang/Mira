# 2026-08-25 架构减重记录

## 目标

在不改变 Card、Transformation、Run、Candidate、Workflow 或 HTTP API 行为的前提下，降低首屏体积，并把高变化策略从高耦合编排器中移出。

## 结果

| 指标 | 重构前 | 重构后 |
| --- | ---: | ---: |
| `src/v2Store.ts` | 1433 行 | 1298 行 |
| `bridge/v2-http.js` | 1029 行 | 863 行 |
| 两个编排器合计 | 2462 行 | 2161 行 |
| 最大前端 chunk | 536.89 kB | 326.14 kB |
| 产品入口 chunk | 536.89 kB | 184.63 kB |
| 500 kB 构建警告 | 有 | 无 |

两个编排器减少 301 行。迁出的 `storeTypes`、`storePolicy` 和 `v2-http-policy` 合计 290 行，因此该范围生产代码净减少 11 行；主要收益是策略可独立测试和变更隔离，而不是把同一复杂度隐藏到更多文件。

## 决策

1. 详情、流程库和模型设置改为动态 feature 入口。Canvas shell 保持首屏可用，非画布功能只在打开时加载。
2. React Flow 拆为稳定 `canvas-vendor` chunk。产品代码变更不再使 326.14 kB 画布依赖失效缓存。
3. Store 公共契约迁入 `src/v2/storeTypes.ts`，错误映射和传输分类迁入 `src/v2/storePolicy.ts`。`src/v2Store.ts` 只保留 Zustand 与异步编排。
4. 默认建议、请求 helper、prompt、建议解析、进度规范化和单调时间戳迁入 `bridge/v2-http-policy.js`。`createV2Handlers` 的公开入口和返回方法保持不变。
5. 暂不机械拆分 `styles.css` 和 `DetailDrawer.tsx`。CSS 层叠与跨 panel 交互仍需先建立更明确的归属测试。

## 验证范围

- 新增前端边界、Store policy 和 HTTP policy 测试。
- 原有 Store canvas/lifecycle/structure/workflow 测试保持通过。
- 原有 58 个 v2 HTTP handler 回归用例保持通过。
- 完整测试、类型检查、前端构建、bridge 构建和 diff 校验作为最终发布门槛。

后续拆分顺序与风险见 [当前架构图](../architecture/system-map.md) 的“已知热点”。
