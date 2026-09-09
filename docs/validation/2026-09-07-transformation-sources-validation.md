# 已有转化的多来源编辑验证

- 日期：2026-09-07。
- 开发分支：`codex/transformation-sources`；原始基线 `37f72db`，功能提交 `9e30832`。
- 集成：与主干 `e27843b` 合并后重新验证，作为 main 交付。下方原始验证记录保留，最新结果见末节。
- 开发使用 `.worktrees/transformation-sources`；本次交付后清理该已合并工作树与分支。主工作树原有未提交文档未带入或覆盖。
- 环境：macOS、Node.js 26.7.0、pnpm、Playwright 驱动的真实 Chrome。

## 产品与实现

用户确认修改旧 LINK-01：仍禁止 Card 之间的普通关系线，但允许内容卡连入已有转化块追加来源。
原来源顺序保留，新来源按操作顺序追加，重复来源零写入。关系详情直接管理添加、移除与排序，
不再要求重新选择全部来源后替换。点选草稿不持久化，取消或切换画板不写来源。

来源操作复用普通 PATCH，保留目标 Card、Version、Run 与方法出处。新建目标、自动 Run、
CanvasHistory 和迁移均不在本次变更范围。前后端拒绝自引用与多步依赖环；服务端继续执行
当前 Head、活动 Run、未处理 Candidate 和 baseUpdatedAt 门禁。

来源策略位于 `transformationSources.ts`，点选状态位于 `sourceSlice.ts`；
详情列表与画布工具条分别独立为 SourceManager 与 SourcePickerToolbar。既有样式 token、
44px 命中区与焦点规则沿用，未增加依赖或整体改版。

## 自动化证据

- 基线：121 个文件、1332 项用例通过。
- 先观察拖线无更新、无拒绝提示、点选状态缺失及后端接受依赖环的失败，再实现。
- 最终：122 个文件、1348 项用例通过，包含 Bridge 测试。
- `pnpm exec tsc --noEmit`、`pnpm build`、`pnpm build:bridge`、`git diff --check` 均通过。
- 最大 JS chunk 为 canvas-vendor 326.33 kB；详情仍延迟加载，无 500 kB warning。
- 定向用例覆盖有序追加、去重、末来源保护、排序、无自动 Run、无历史命令、运行/Candidate 锁、
  并发保存拒绝、旧基线冲突保留草稿、取消与切换画板、迟到响应不抢新详情。
- Node 26 的既有 localStorage ExperimentalWarning 仍出现，不宣称测试输出零 warning。

## 浏览器证据

脚本：`scripts/check-transformation-sources-browser.mjs`。先运行 `pnpm build`，再通过
`MIRA_PLAYWRIGHT_REQUIRE` 指向已安装 Playwright 的 package.json 执行该脚本。
每次运行自动建立独立临时 workspace 与系统分配的 loopback 端口，使用真实 HTTP、存储与
Run 写回，仅模型输出为确定性测试适配器；不请求远端模型、不读取 API Key 或真实用户 Board。

1. 1440x1000：从单来源拖入第二来源，重复连接不增加 revision；目标自连有提示且零写入。
2. 添加来源进入画布点选，选择后 Escape 取消保持原 Board，焦点返回详情；重新点选确认成功。
3. 上移与移除保持预期顺序；来源编辑不增加 Card、Transformation 或 Run。
4. 显式运行后，持久 Run 的 sourceSnapshot 精确包含全部有序来源。
5. 390x844：来源菜单、确认和取消均可达；列表追加后 stale 可见，原 lastRunId 保持不变，刷新来源仍保留。
6. 控件中心命中、按钮文字与页面横向溢出检查通过；浅色与深色截图检查完成，深色同时启用 reduced-motion。
7. 应用 console warning/error 为 0。测试宿主对浏览器自动请求的 `/favicon.ico` 返回既有 404，
   脚本单独记录 baselineResourceErrors，没有修改该无关资源。

最终截图保留于：
`/var/folders/7z/5dcj6kmx005b6sm35w8tnnl80000gn/T/mira-source-ui-Nc0vMW/screenshots/`。
包括 desktop-connection、desktop-picker、desktop-sources、mobile-picker、mobile-sources 与 mobile-dark-sources。

## 边界与审阅

收尾对当前 diff 核对了依赖方向、来源 PATCH 单写入、CAS、取消与迟到回调、旧历史保留和 CSS
模块归属。此处为独立分支阶段审阅；主干热点核对与重新验证见下方集成记录。

此次仅验收 Chrome 模拟窄屏，不代表真实触屏设备、软键盘或真实模型任务效果。
桌面宿主与打包未修改，未运行 Desktop make/packed smoke，也未产出新安装包。

## 主干集成验收

主干基线 `e27843b` 包含卡片阅读、尺寸整理、连续记录、来源伴随预览、运行范围与 GFM 渲染。
本次在功能工作树集成后再交付 main，保留上述功能。冲突处理覆盖 App 点击与键盘保护、
转化节点运行范围入口、来源详情、响应式样式及文档；来源管理在详情直接可达，
历史输入对照保留在`来源状态摘要`，可进入当时/当前正文预览。

首轮 1464 项测试中，加载保护位置和样式指纹两项失败。保留加载期间的键盘阻断、
核对 CSS owner/层叠后更新集成指纹，定向 141 项及最终 132 个文件、1464 项测试全部通过。
`pnpm exec tsc --noEmit`、`pnpm build`、`pnpm build:bridge`、`git diff --check` 均通过。
最大 JS chunk 349.67 kB，DetailDrawer 50.52 kB，Bridge 302.1 kB，无 500 kB chunk warning。

浏览器曾复现详情关闭后的焦点恢复抢走新来源选择器焦点；来源工具条在下一帧完成交接，
同一浏览器回归现已通过。新增验证覆盖编辑来源后仍能查看冻结输入、切换当前正文、返回来源管理，
且此过程 Board 零写入。1440×1000、390×844、深色与 reduced-motion 均完成截图与可达性检查，
console warning/error 为 0。主干已提供 favicon，删除原脚本的 404 豁免，继续严格检查控制台。

额外重跑 `scripts/check-card-interaction-browser.mjs`，覆盖正文选字、阅读/编辑、来源伴随阅读、
尺寸修改与撤销、保存并新建、运行范围、迟到文件响应、窄屏及方法应用。第一次测试宿主缺少
model-settings 配置导致 404；补齐临时宿主的标准服务后全套通过，未豁免此错误。

最新截图：

- 多来源：`/var/folders/7z/5dcj6kmx005b6sm35w8tnnl80000gn/T/mira-source-ui-qYtkqR/screenshots/`。
- 卡片交互：`/tmp/mira-card-ui-source-integration-zUN6H0/screenshots/`，15 张。

收尾审阅再次核对完整 main 差异的领域环路检查、PATCH 原子性、版本基线、Candidate 可达性、
导航与焦点，以及原有卡片交互保留。删除旧来源替换 UI 的过期断言与两组夹具，保留来源、
结构、并发、Bridge 和浏览器有效回归；不为减少数量删除不同边界的测试。清理仅限本次已合并
分支与工作树，其他任务分支、用户数据及临时浏览器验收数据保留。
