# 用户文档与案例图验证

后续更新：本报告保留首次文档批次的历史证据；四张案例图和场景说明已由[真实工作场景案例验证](2026-09-09-realistic-use-cases-validation.md)对应的新批次替换。

- 日期：2026-09-09
- 源码基线：`75db013`，本批只修改文档与静态图片。
- 范围：合并 AI 协作入口、改写产品介绍、首次使用教程、四个领域案例与真实界面图。

## 产品与文档边界

`agent.md` 的协作、原子性、数据安全、历史保护和文档治理规则已去重并合入根 `AGENTS.md`，旧文件删除，历史可从 Git 追溯。永久清除提示改为链接现有产品定义与核心规格，不改变产品语义。实施路线中对旧文件的提及保留为当时的交付记录，不作为当前读取入口。

根 README 改为产品价值、真实截图、使用场景和上手入口；原运行环境、模型适配、LaunchAgent、开发与数据目录说明迁入[运行、开发与维护](../operations/development.md)。教程、案例和手册均明确模型调用、手动运行、版本及桌面内部测试边界。旧 README 中把灵感直接记录描述为写入来源画板的过时说明已移除。

本批未修改产品、核心规格、生产代码、桌面宿主或打包配置；没有启动写入用户真实 workspace 的服务。

## UX 可发现性

使用 Chrome 与临时 Node Host，在独立临时 workspace、随机本地端口复现教程：画板菜单新建 → 新建卡片 → 输入教程原文 → 保存正文 → 关闭详情 → 选择来源 → 填写成果 → 添加步骤。

HTTP 复核得到两张 Card、一条 Transformation，目标 Head 仍为空，符合「添加步骤不自动生成」。桌面教程验证视口为 1440×1000，案例图为 1920×1000，窄屏为 390×844。窄屏核对菜单 Escape 后焦点返回、编辑保存入口与页面横向溢出。

初次截图宿主没有注入 Standalone 的模型设置服务，进入步骤详情时出现 `/api/v2/model-settings` 404。核对 `scripts/start-standalone.mjs` 后，在临时宿主注入同一 `createModelSettingsService`，重跑成功；未修改产品实现。最终浏览器运行无 console warning/error 与 pageerror。

## 图片与阅读质量

- `docs/assets/software-iteration.png`：需求范围与验收。
- `docs/assets/reading-notes.png`：概念笔记与一周实践。
- `docs/assets/research-synthesis.png`：证据对照与待验证判断。
- `docs/assets/content-writing.png`：文章结构与初稿。
- `docs/assets/first-step.png`：教程来源选择和成果输入。

案例图为当前 React UI 的 Chrome 截图，原生工作室浅色、收起导航、关闭网格。材料与成果均为专门编写的虚构/原创 human 内容，经正常 API 创建；没有伪造 AI Run，因此转化块保持「尚未生成」，文档明确说明人工示例身份。截图已逐张目视检查正文、连接、遮挡与裁切。

README、教程与案例通过现有 React Markdown + GFM 在临时 HTML 中渲染，分别检查 1440px 与 390px 宽度：图片正常加载、页面无横向溢出。表格和代码块可在自身区域横向滚动。此项是本地 Markdown 渲染检查，不声称已在 GitHub 发布或完成 GitHub 页面验收。

## 工程验证

| 命令 | 结果 |
| --- | --- |
| `pnpm test` | 139 个测试文件、1525 项测试通过 |
| `pnpm exec tsc --noEmit` | 通过 |
| `pnpm build` | 通过，无 500 kB chunk warning |
| `pnpm build:bridge` | 通过 |
| `git diff --check` | 通过 |

本地链接检查覆盖本批编辑文档中的相对目标与标题锚点，图片全部位于仓库内，无需外链资源。测试输出包含 Node 26 的 localStorage ExperimentalWarning 与 SSR useLayoutEffect 提示；这些测试仍通过，浏览器证据单独记录。

## 验证限制

未连接真实模型、未消耗模型 API、未评价模型输出质量；教程的生成、Candidate 和方法复用说明依据权威规格及完整测试，不把人工案例当作这些行为的实跑证据。未开展真实新手用户测试、原生触屏或 Windows 客户端验收；本批也不涉及桌面 make、安装或发布。
