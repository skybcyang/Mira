# Markdown 预览验证

- 日期：2026-09-07
- 基线：`5119a04`；分支 `codex/card-interaction-integration`，未合并 main 或推送。
- 请求：网页 Markdown 支持常用语法，修复表格不能渲染。

## 实现

原先三个入口仅使用 react-markdown 的基础 CommonMark 解析，表格被当成普通段落。
新增共享 `MarkdownContent`，接入 `remark-gfm@4.0.1`；卡片、内容阅读（含 Markdown 文件）
和来源预览统一支持表格、只读任务列表、删除线、自动链接和脚注，保留原有常用 Markdown。
表格与长代码局部横向滚动，图片限制在内容宽度内；脚注与辅助标签 ID 按渲染实例隔离。
不启用原始 HTML 执行、不覆盖默认 URL 过滤；不改写 CardVersion 或任务勾选状态。

沿用现有解析器，未自写 Markdown parser 或更换编辑器。参考
[react-markdown 插件说明](https://github.com/remarkjs/react-markdown#use-a-plugin)与
[remark-gfm](https://github.com/remarkjs/remark-gfm)。锁文件只新增该依赖及其依赖项，没有升级既有包。

## 验证

- 新增 8 项渲染回归测试，先复现表格、任务列表、历史来源和脚注失败，再通过实现；基础语法与危险 HTML/URL 保护一并覆盖。
- `pnpm test`：131 个文件、1448 项测试全部通过。两个既有测试进程仍有 Node 26 experimental localStorage 提示，没有失败。
- `pnpm exec tsc --noEmit`、`pnpm build`、`pnpm build:bridge`、`git diff --check` 全部通过。主入口约 343.53 kB、gzip 106.13 kB，无 chunk-size warning，详情继续延迟加载。
- 独立只读审查未发现具体渲染、安全或样式冲突问题；独立定向测试 8/8 通过。
- [浏览器检查脚本](../../scripts/check-markdown-browser.mjs)自动创建临时 workspace 与独立随机端口，使用真实 Chrome 检查 1440px/390px 下的卡片、详情和来源表格；宽表可横向滚动，页面无横向溢出，任务列表只读，代码不强制换行，console 无 warning/error。读取前后 Board 完全一致。
- 最终浏览器回执 `passed: true`；四张截图在 `/var/folders/7z/5dcj6kmx005b6sm35w8tnnl80000gn/T/mira-markdown-check-odmu3U`，已检查桌面与窄屏截图。脚本结束关闭浏览器和临时 runtime，临时样本保留供复核。

复验：先 `pnpm build`，再将 `MIRA_PLAYWRIGHT_REQUIRE` 设置为本机可用 Playwright 的模块路径，运行 `node scripts/check-markdown-browser.mjs`。

当前隔离预览地址仍为 `http://127.0.0.1:62678/graphmind/`；没有强制刷新用户页面，避免丢失未保存草稿。
本轮不增加数学公式、Mermaid、代码语法高亮、HTML 执行或可点击写回的任务框，也不修改桌面宿主/打包。
