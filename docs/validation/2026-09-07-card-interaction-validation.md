# 卡片与推进体验验证

公开副本已脱敏个人绝对路径；原始验证事实与结果保留。

- 日期：2026-09-07
- 基线：`37f72db`
- 分支：`codex/card-interaction-integration`
- 实现目录：`/Users/<local-user>/Projects/Mira/.worktrees/card-interaction`
- 状态：本轮实现与下述验证完成；未合并 main、未推送、未创建 PR。
- 范围：[设计记录](../refactor/card-interaction-design-proposal.md)与[TODO](../refactor/competitor-reference-todo.md)中的 B1-B5、R1-R3、R5-R6。

## 已交付

1. 标题拖卡、正文原生选字与键盘隔离；稳定标题、标签槽和底栏，正文溢出提示；同一详情任务内阅读/编辑、展开与返回。
2. 尺寸预设、数值输入、拖动尺寸、同宽/对齐/等间距；organization 尺寸 CAS、原子写入、会话撤销与组框实时投影。
3. 保存成功后连续新建，未保存标签门禁，保存失败保留草稿，创建回执不确定时禁止盲目重试；不复制来源或自动运行。
4. 来源伴随阅读、冻结历史输入与当前来源对照、只读运行范围预估、成果就近修改步骤。
5. 方法库最终成果摘要和可展开步骤；三个独立可导入的人工教学示例，显式提取方法后换新材料绑定。

统一 Card、不可变 Version、普通 Transformation/Run/Candidate 规则保持；没有新增语义卡片类型、普通关系线或执行引擎，也没有增加依赖。

## 自动化门禁

在实现目录使用 Node.js 26.7.0 运行：

| 命令 | 结果 |
| --- | --- |
| `pnpm test` | 130 个文件、1440 项测试全部通过 |
| `pnpm exec tsc --noEmit` | 通过 |
| `pnpm build` | 通过；主入口约 303.81 kB，DetailDrawer 约 49.97 kB，保留延迟加载 |
| `pnpm build:bridge` | 通过 |
| `git diff --check` | 通过 |

全仓测试包含真实临时存储下的 organization、Workflow、Run、Candidate、BoardArtifact 与备份集成测试。两个既有测试进程输出 Node 26 的 experimental localStorage 警告；没有测试失败。这不是浏览器 console 错误。

新增失败测试先于实现；尺寸冲突与零半写、反向历史、组框投影、连续记录失败/迟到响应、草稿基线保护、预估前沿和历史来源变化均有定向覆盖。

## 真实浏览器

使用已安装 Google Chrome，经 Playwright 启动 headless 浏览器，连接 Standalone 实例。全部写入位于临时 workspace `/tmp/mira-card-ui-XTlwFM`，未访问或修改真实用户画板。

```sh
MIRA_UI_BASE_URL=http://127.0.0.1:56283 \
MIRA_TEST_WORKSPACE=/tmp/mira-card-ui-XTlwFM \
MIRA_PLAYWRIGHT_REQUIRE=/Users/<local-user>/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/ \
node scripts/check-card-interaction-browser.mjs
```

脚本路径：[check-card-interaction-browser.mjs](../../scripts/check-card-interaction-browser.mjs)。运行前需独立启动指向该临时目录和当前 dist 的 Standalone；Playwright 路径应使用本机已安装运行时。

最终回执：`passed: true`，交互画板 `board-3y4mdimtr6atqc`，方法复用画板 `board-2l5fv0mtr6b3az`，15 张截图。脚本先使用画布的适应全部命令，再按可见标题正文定位鼠标拖选，避免初始自动聚焦把目标移出视口。

- 1440px：原生鼠标拖选不改卡片选择，阅读方向键不移动 Card；草稿读写切换、展开、来源往返；尺寸保存/撤销、Esc 取消 resize 及取消后再次拖动无跳变。
- 保存并新建：只追加一个 Version 和一张独立空卡；保存请求挂起时 Esc 不丢正文、标签输入禁用；注入创建 503 后已保存正文保留，禁止重复创建。
- 来源迟到读取：切换来源后释放旧文件响应，旧响应不替换当前预览。
- 1024px 与 390px：阅读/编辑、关闭、保存入口可达，页面无横向溢出。人工检查桌面来源双栏与 390px 编辑截图，无正文/操作遮挡。
- 原生工作室、编辑部、蓝图台各自浅/深外观：实际切换并截图，页面无横向溢出。
- 方法复用：从示例保存三步方法，方法库展开完整步骤，切换到新画板并绑定新材料；生成三个空目标及三个步骤，不复制示例正文，导出确认零 Run。
- 浏览器无未预期 console warning/error 或 pageerror。创建 503 是明确注入的失败，脚本仅豁免该精确 URL 的资源错误，其余仍失败。

截图保存在本机 `/tmp/mira-card-ui-screenshots`：`desktop-cards.png`、`desktop-editor.png`、`desktop-source.png`、`desktop-range.png`、`1024-reader.png`、`1024-editor.png`、`390-reader.png`、`390-editor.png`、六张 `theme-*.png`、`desktop-method.png`。临时截图不作为产品资产提交。

补充[触屏底栏压力脚本](../../scripts/check-card-footer-browser.mjs)：同样设置 `MIRA_UI_BASE_URL` 与 `MIRA_PLAYWRIGHT_REQUIRE` 后运行。使用真实 Chrome 的 `hasTouch:true`、390px viewport，克隆当前底栏并追加 stale/运行按钮，仅验证 CSS 几何，不冒充真实运行状态集成。280px、312px 两档中可见按钮均至少 44px，文字不溢出，停止按钮不侵入 resize 预留区。截图为 `/tmp/mira-card-footer-coarse-review-after.png`。

## 审查修复

独立切片审查与集成复核发现并修复：阅读事件先被 ReactFlow 接收、文本拖选改变选卡、保存中残留尺寸预览、Esc 未取消 resize、组框忽略临时尺寸、未保存标签被连续创建跳过、回到旧草稿基线时误报已保存、保存过程中 Esc 丢弃草稿。相关定向测试和真实浏览器已重验。

最终补查修复了最窄触屏卡片的重复阅读提示占位冲突。另在确认 XYResizer 回调顺序后，将取消/无变化时的测量恢复放在 vendor end 之后，并保留 Board/会话保护；浏览器未复现持续跳变，但原事件序列可短暂保留旧 measured，不能只依赖后续 ResizeObserver 修正。

## 未验证边界

- 未配置或调用付费/真实模型，没有以预览或 mock 证明实际生成效果。
- 三个示例是人工编写并静态核对的虚构教学材料，不是真实访谈、性能测量或业务有效性证据；真实材料上的任务收益仍待验证。
- 窄屏是浏览器 viewport 模拟，不代表已验证原生触屏长按、中文输入法、真实软键盘或移动设备。
- 未改桌面宿主或打包路径，本轮没有重新 make 或 packed smoke，不能宣称已打包 macOS UI 验收。
- 未将独立分支合并 main。原主工作树中的设计文档改动原样保留，没有重写用户数据或执行迁移。
