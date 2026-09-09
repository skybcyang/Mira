# 当前画板卡片搜索验证

- 日期：2026-09-06
- 状态：开发验收完成，用户已确认。
- 范围：当前画板搜索、结果片段、键盘选择与可读定位。未实现修订功能、跨画板搜索或文件正文索引。
- 环境：macOS、Node.js 26.7.0、独立 Chrome 浏览器、临时 workspace `/private/tmp/mira-card-search-JbloAa`。

## 实现与自动化

复用现有命令弹窗、Card 当前 Head 摘要与 Store 选择动作；未新增依赖、API、持久对象或数据迁移。纯检索位于 `src/v2View.ts`，定位几何位于 `src/canvasOperations.ts`。

- RED：新增 6 项测试均因缺少卡片检索、定位或搜索文案失败。
- 浏览器发现首次画板自动 fit 动画可能覆盖显式搜索定位；新增第 7 项回归测试，确认失败后增加延迟 fit 门禁及定位动画中断。
- GREEN：`pnpm test`，100 个测试文件、1144 项用例通过，含全仓 Bridge 集成测试。
- `pnpm exec tsc --noEmit`、`pnpm build`、`pnpm build:bridge` 和 `git diff --check` 通过；前端无 500 kB chunk warning。
- 全仓测试首次在沙箱内因本地 HTTP listen EPERM 失败，授权后完整重跑通过。Node 26 输出一次既有 localStorage ExperimentalWarning，不计为测试失败。

## 用户验收

2026-09-06，用户确认“可以的，开发验收完成”，并要求更新文档、提交及推送远端。本次验收收口的是当前画板卡片搜索与定位；不扩展到 AI 修订、跨画板检索、后台任务或公开发行。大型真实画板的规模与长期使用价值仍需继续观察，不由这次验收推定。

## 真实浏览器

使用临时 API 创建 21 张卡片，其中目标位于 `(6500, 3000)`；另建一个画板验证搜索范围。浏览器验证脚本位于 `/private/tmp/mira-card-search-JbloAa/verify.mjs`；测试工具仅安装在该临时目录，不改项目依赖。

1. 1440x900：标题命中优先；正文深处的 Billing 关键词在结果片段可见。键盘下移并 Enter 后只选中目标 Card，正文卡显示 312x208，未打开详情。
2. 取消搜索：原选择与 viewport 不变，焦点返回搜索入口；其他画板独有词无结果。
3. 长列表：18 项结果中连续下移到最后一项，活动结果仍在列表可见范围内。
4. 390x844：从更多进入搜索，点击结果后目标完整可见；Card 位于 `(39, 272)`，尺寸 312x208，未与顶部选择栏或底部 Context dock 相交，无页面横向溢出。
5. 1024x900：保留已打开的详情栏，搜索另一个 Card 后目标位于侧栏左侧可读区域，原详情仍保留。
6. 验证前后通过 API 读取的 Board JSON 完全一致；检索和定位没有领域写入。

独立 Chrome 截图已由图像审阅检查，无文本遮挡或结果行溢出。内置浏览器工具因本机 model catalog 配置错误无法启动，未修改该配置，改用隔离的 Chrome 完成上述验证。

Console：应用脚本错误为 0；开发站点 `/favicon.ico` 有一次 404 资源错误，原样保留在证据中，未宣称 console 全零。未运行桌面打包或 packed smoke，本次不涉及桌面宿主。

## 本地产物

截图及机器证据保存在被 Git 忽略的 `out/card-search-validation-20260906/`：

- `desktop-search.png`、`desktop-located.png`
- `mobile-search.png`、`mobile-located.png`
- `compact-sidebar.png`、`evidence.json`

产品价值仍需用户在真实大型画板上验证；本报告证明实现、可发现入口和已覆盖交互，不证明检索已适合所有规模。
