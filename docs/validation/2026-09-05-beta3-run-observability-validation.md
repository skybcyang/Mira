# 2026-09-05 Beta.3 Run 可观测性验证

- 状态：公开 Run 进度历史、Canvas 入口、运行详情与安全校验完成；自动化门禁和真实浏览器验收通过。
- 代码基线：`codex/beta3-run-observability-integration` 的 `5f2cce1` 与 `0b35e09`；本报告随后作为文档提交加入同一分支。
- 环境：macOS arm64，Node.js `v26.7.0`，pnpm `9.0.0`。
- 范围：Run 进度领域策略、RunStore/portable 校验、HTTP 执行路径、Canvas Card、运行详情、`运行到这里`通知，以及相关产品、规格与用户文档。

## 1. 实现范围

- Run 保存当前公开 `progress` 和最近 20 条 `progressEvents`；sequence 严格递增，裁剪后不重新编号，当前进度与末事件保持镜像。
- 公开字段按 Unicode 字符限制为 phase 40、label 160、detail 200；校验在超过上限时提前停止，不为超长导入字符串创建等长数组。
- 模型进度回调只持久化白名单公开字段。成功、失败、停止和启动恢复使用固定终态事件，不复制 reasoning、Prompt、密钥、原始错误或完整工具内容。
- RunStore、BoardArtifact 与 MiraBackup 共用严格校验；终态事件的 phase、label 和 detail 不符合固定契约时 fail closed。缺少整个事件列表的旧 Run 继续合法。
- 运行中的目标 Card 常显`查看运行进度`与`停止生成`；两个命令不触发 Card 选择，并继续经过现有详情意图与草稿保护。
- 运行详情显示路径位置、当前公开阶段、可用时的脱敏细节与可靠耗时，以及最近 20 条事件。Candidate 决策和失败诊断位于时间线之前；非法或反序旧时间不会崩溃或伪造耗时。
- `运行到这里`在每个实际启动步骤前显示依赖路径中的第 `X/N` 步和成果名；跳过已最新上游时保留原路径位置。
- 停止请求返回后立即重算 React Flow 投影，即使轮询已经退出，Card 和 Transformation 也不会残留运行中入口。

## 2. 测试驱动证据

实现前的定向 RED 覆盖：缺少公开事件历史、20 条窗口、终态追加、恢复停止、Unicode 截断、敏感字段过滤、Canvas 进度入口、逐步通知、运行详情时间线、停止后的投影，以及 Candidate/诊断顺序。

独立复核随后补出并先证伪了以下边界：终态伪造活动事件、终态 detail 泄漏、超长字符串内存放大、非法与反序时间、终态旧 progress 误导、长无断点 label、成功状态读屏公告和关键 Candidate 动作被时间线下推。对应最小实现后，相关定向测试全部转绿。

## 3. 自动化门禁

| 命令 | 结果 |
| --- | --- |
| `pnpm test` | 通过：99 个测试文件，1137 个用例 |
| `pnpm exec tsc --noEmit` | 通过，exit 0 |
| `pnpm build` | 通过：2182 modules transformed，无 chunk warning |
| `pnpm build:bridge` | 通过；生成 `dist-bridge/bridge.bundle.js` 与 `bridge.cordis.js` |
| `git diff --check` | 通过，exit 0 |

测试覆盖 HTTP success/failure/interrupt/start-failure、并发 progress、启动恢复、RunStore 写前校验、portable round-trip、旧 Run 兼容、逐步执行、停止投影、DOM 语义、长文本与六套外观样式契约。

## 4. 真实浏览器证据

验证使用独立临时 workspace 与本地 Standalone `http://127.0.0.1:57444/graphmind/`。模型适配器发送 22 条公开事件、额外的私有字段和一条长 detail，并延迟终态以覆盖运行中交互。

1. 1440px 下运行中的目标 Card 同时显示进度与停止入口；Card footer 的 `clientWidth` 与 `scrollWidth` 均为 308px，无内部横向溢出。点击进度只打开 Run drawer，没有触发 Card 节点选择副作用。
2. 22 条输入后，详情只保留 sequence 3..22 的最近 20 条；长 detail 正常换行，页面中没有适配器注入的 Prompt 或密钥标记。
3. 从 Run drawer 停止后 250ms 内，Card 的进度/停止入口数量都变为 0，Transformation 退出生成中并恢复`来源已变化`；无需等待下一次轮询。
4. 运行期间把目标 Head 改为`人工调整的体验建议`后，模型完成得到 Candidate，人工 Head 保持不变。采用/丢弃动作位于 20 条时间线之前，状态标题带 `aria-live=polite`。
5. 1440px、1024px 与 390px 的页面 `clientWidth === scrollWidth`；桌面 drawer 为 392px，移动 sheet 为 390px、`aria-modal=true`，Candidate 按钮高度均为 44px。
6. Studio、Editorial、Blueprint 的 Light/Dark 六个组合在 1024px 逐一切换并截图检查；六组根 token 正确、画面非空且均无页面横向溢出。
7. 最新构建完成整个 Run、停止和 Candidate 链路后，browser console warning/error 为 0。

## 5. 已知边界

- 公开事件是模型适配器主动提供的产品摘要，不是底层会话日志；不支持安全摘要的平台仍可只报告固定生命周期事件。
- 单个 Run 事件持久化，整条客户端`运行到这里`依赖序列仍不会在刷新后自动恢复。
- 本次 in-app browser 的 390px 验收使用 fine pointer；coarse-pointer 的 44px Card footer 命中区由 CSS 契约测试覆盖，未宣称真实触屏设备验证。
- 本批未修改 `desktop/`、打包配置或平台宿主，因此没有重复执行双架构 Desktop make 与 packed smoke；桌面发布成熟度仍是 internal Alpha。

## 6. 结论

Beta.3 Run 可观测性已接入当前六套外观和既有 Candidate/dirty/异步详情安全体系，没有回灌旧分支的标签删除、非语义页签或抢占详情行为。用户现在能在成果 Card 上直接判断运行是否继续、打开最近事件、停止执行，并在终态优先完成 Candidate 决策或读取失败原因。
