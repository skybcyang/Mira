# 2026-09-05 六套外观与画布 UX 验证

- 状态：三种设计方向及浅色/深色组合、画布与详情交互加固完成；自动化门禁和真实浏览器验收通过。
- 代码基线：`codex/mira-six-themes` 的 `c4761a4`；本报告随后作为文档提交加入同一分支。
- 环境：macOS arm64，Node.js `v26.7.0`，pnpm `9.0.0`。
- 范围：Appearance、App bar、React Flow Canvas、Context dock、详情/任务侧栏、BoardManager，以及相关 Store 异步导航策略。

## 1. 实现范围

- 外观拆为正交的设计方向 `studio | editorial | blueprint` 与配色 `light | dark`，形成六个完整组合。三种方向共享全部功能、数据和交互语义。
- 外观入口收进`更多`，切换时保留 viewport、选择、drawer、草稿与 Run 状态；React Flow 网格、MiniMap、字体、几何和语义色均由外观 token 驱动。
- Card 画布直接显示最多两个用户标签与 `+N` 汇总；完整标签列表保留可访问语义，不重新引入固定内容类型标签。
- App bar、命令菜单、Context dock、详情 drawer 和移动 sheet 统一了关闭、焦点返回、提交锁与异步结果导航行为。
- 默认自动落位的新步骤保持`内容 Card -> Transformation -> 目标 Card`两侧至少 32px 净空；手动分支尊重用户指定落点。快速重复提交只创建一次结构，创建步骤仍不自动 Run。
- dirty 正文/标签、Head 并发变化、Candidate 决策、停止生成、Board 切换与目录刷新均有明确保护，迟到响应不得静默卸载当前任务或覆盖较新目录状态。

## 2. 自动化门禁

| 命令 | 结果 |
| --- | --- |
| `pnpm test` | 通过：98 个测试文件，1102 个用例 |
| `pnpm exec tsc --noEmit` | 通过，exit 0 |
| `pnpm build` | 通过：2182 modules transformed，无 chunk warning |
| `pnpm build:bridge` | 通过；生成 `dist-bridge/bridge.bundle.js` 与 `bridge.cordis.js` |
| `git diff --check` | 通过，exit 0 |

测试包含六套 token 完整性、旧主题迁移、React Flow 外观映射、布局净空、重复提交、dirty
草稿、Candidate/Stop、菜单键盘行为、移动焦点约束、异步详情归属、Board 导航、目录刷新与
Run 终态刷新竞态。

## 3. 真实浏览器证据

验证使用本地 Standalone `http://127.0.0.1:4182/graphmind/`，覆盖 1440px、1024px 与
390px 视口：

1. Studio、Editorial、Blueprint 的 Light/Dark 六个组合均可切换，视觉方向明确；切换前后 React Flow transform 保持一致。
2. 1440px 打开详情时，右栏宽 392px，Canvas 使用剩余宽度；MiniMap、Controls、选择工具栏与 Context dock 对 drawer 的重叠面积均为 0。
3. 1024px 下外观入口不遮挡 Context dock，drawer、MiniMap、Controls 与选择工具栏互不覆盖；页面横向溢出为 0。
4. 390px sheet 为 `role=dialog`、`aria-modal=true`，scrim 不进入 Tab 顺序；drawer tabs 与`更多`菜单项高度均为 44px，页面横向溢出为 0。
5. `更多`支持 Escape 关闭并回到真实触发按钮；移动 sheet 的 Tab/Shift+Tab 在面板内循环。
6. dirty 正文关闭会出现原生确认，取消后草稿仍在；详情、模型设置和文件选择器关闭后均回到有效触发入口。
7. warm 模块下从详情切换模型设置，焦点停在新面板；冷加载版本详情后焦点进入 drawer；Canvas 选择工具栏挂载时不会把用户焦点抢回已有 drawer。
8. 三档验证期间 browser console warning/error 为 0。

## 4. 结论

- 视觉：三种方向不是简单换色；字体、圆角、材质、边界、状态色与画布 chrome 共同形成独立语气，暗色也使用各自完整 token。
- 交互：高频内容动作留在 App bar，低频任务统一进入`更多`；菜单、modal、drawer 和移动 sheet 不再叠加或丢失焦点。
- 安全：生成、Candidate、草稿与 Board 导航保留原领域门禁；mockup 只提供视觉与交互意图，没有替换生产 Store/API 语义。
- 响应式：Desktop 使用保留列，Compact 使用覆盖与控件避让，Mobile 使用完整模态 sheet；三个断点均无页面级横向溢出。

## 5. 已知边界

- 当前 Desktop internal Alpha 的 renderer session 是临时会话，外观偏好跨应用完整重启不保证持久；Standalone 同一浏览器 origin 使用 localStorage 保留选择。
- BoardManager 在单窗口 UI 内串行化会导航或改变生命周期的任务。绕过 UI 直接并发调用 Store 生命周期方法时，仍需要更通用的服务端/Store 请求所有权策略；当前正常产品操作不可达该交错。
- 本批没有修改 `desktop/`、打包配置、Bridge 协议或领域存储，因此未重复执行双架构 Desktop make 与 packed smoke；桌面发布成熟度仍沿用 2026-08-31 的 internal Alpha 验证结论。
- 本轮是实现与可用性检查，不等同于无引导外部用户研究。
