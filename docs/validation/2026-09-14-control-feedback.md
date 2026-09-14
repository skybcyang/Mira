# 按钮反馈、运行指示与设置开关验证

当前状态：实现已合入 `main`，并已基于最新远端主干完成同步准备；初次提交 SHA 与当时的交付状态保留为历史事实，当前提交和复验见末尾记录。

日期：2026-09-14，Asia/Shanghai。本地分支 `codex/ui-control-feedback`，本批为前端局部打磨，未推送、合并 main、发布或替换安装版。工作期间共享仓库中的其他任务改动保留，本报告仅归属下述 UI 与验证改动。

## 产品命题与范围

常用命令提供短促按压反馈；运行指示反映既有 Run 状态；网格和深色开关表达当前设置。领域对象、创建/运行边界、Head/Candidate 写回和本机偏好存储保持原契约。唯一视觉规则见 [UI 系统 §7](../design/ui-system.md#7-状态与动效)。

参考 [Galaxy](https://github.com/uiverse-io/galaxy) 的局部反馈思路，使用 Mira 已有 CSS、Lucide 和原生 checkbox 实现，没有复制第三方组件源码、增加依赖或引入整库样式。

## UX 可发现性与产物质量

- Studio 按钮轻微缩放与内描边，Editorial / Blueprint 使用固定几何反馈；禁用态不触发按压反馈。
- 网格与深色外观共用原生 switch 样式。深色开关有固定可访问名称及开启/关闭文字；整行可点、Space 可切换，切换后保留焦点与画布位置，刷新保留本机设置。Blueprint 使用方角轨道与圆点。
- 步骤、空目标及运行详情共用 `RunActivityIndicator`。排队为静态时钟，运行中为旋转线圈；空目标去掉三条模拟正文骨架。现有正文与停止入口保持可用。
- 发现并修正画布状态文案遗漏：`interrupted` 原先落入“尚未生成”，现在显示“已停止”，与详情一致。
- 尊重减少动态效果偏好：运行指示静止、按钮不缩放，状态文字和可见焦点保留。

## 实现正确性

`src/v2/controlFeedback.test.ts` 先观察到 5 个预期失败：两套明暗开关语义、排队/运行指示、停止文案；随后 7 项通过。与现有运行详情、外观、Workflow UI 定向回归合计 4 文件 / 63 项通过。

最终工程门禁：

- `pnpm test`：185 文件 / 1857 项通过，包含 Bridge 存储、真实 HTTP、Run/Candidate/Workflow 集成回归。Node 26.7.0 输出 4 条关于未提供 `--localstorage-file` 的 ExperimentalWarning；不将其描述为无警告运行。
- `pnpm exec tsc --noEmit`：通过。
- `pnpm build`：通过，无 500 kB chunk warning。
- `pnpm build:bridge`：通过。
- `git diff --check`：通过。
- 样式基线在真实浏览器和目视复核后更新，原 import 顺序、模块 owner 与边界约束保留。

## 真实浏览器验证

运行 `scripts/check-control-feedback-browser.mjs`。使用有界临时 workspace、随机 localhost 端口、生产构建和可见 Chrome；模型为受控适配器，HTTP、Run 状态变迁及持久写回使用真实 Node Host，没有操作真实用户 workspace。

```sh
pnpm build
MIRA_PLAYWRIGHT_REQUIRE=/path/to/playwright/package.json node scripts/check-control-feedback-browser.mjs
```

本次证据目录：`/var/folders/7z/5dcj6kmx005b6sm35w8tnnl80000gn/T/mira-control-feedback-RL8Uy6/screenshots/`。

- 1440×1000、390×844：三方向 × 明暗共 12 组设置页；无页面横向溢出，设置弹层和开关行保持在视口内。
- Space 切换、焦点保留、关闭回到入口、偏好刷新保持、切换外观不移动画布通过。
- Studio 按压反馈、减少动态效果下无缩放和运行图标静止通过。
- 从 UI 启动步骤，运行详情和画布显示真实 running；两档视口停止按钮中心无遮挡且可操作。
- 受控模型完成后，真实成果写入 Card，运行图标全部消失；再次通过真实 HTTP 重跑，从 UI 停止，步骤显示“已停止”，尺寸不变。
- browser console warning/error 与 pageerror：0。
- 截图关闭瞬时动画以记录稳定布局；旋转与减少动态效果另以浏览器 computed style 检查，不把静态截图当作动效证据。

## 边界

未验证真实触屏设备、系统读屏器、Safari、原生桌面安装包或真实模型产物质量。390px 是浏览器窄屏证据。没有修改桌面宿主或打包配置，本批不声称完成 make/packed smoke 或安装版更新。临时验证 workspace 与截图保留供复核，测试 browser/runtime 已关闭。

## 合入本地主干与复验（2026-09-14）

用户明确要求合入主干后，将本批 16 个文件提交为 `4222a3c1b602926a2c0715d082375ae73683ad96`，从 `b47e58c` 快进合入本地 `main`，没有冲突或额外产品改动。合并前复审完整 diff，定向 5 文件 / 67 项通过。

在 `main` 的 `4222a3c` 上重新运行 `pnpm test`（185 文件 / 1857 项）、`pnpm exec tsc --noEmit`、`pnpm build`、`pnpm build:bridge` 和 `git diff --check`，全部通过；Node 测试仍有上述 4 条 localStorage ExperimentalWarning。

主干生产构建再次运行可见 Chrome 验证：六套外观、1440×1000 / 390×844、Space 切换、偏好保持、焦点返回、按压反馈、减少动态效果以及真实 HTTP 生成完成/停止均通过。browser warning/error 与 pageerror 为 0。此次截图位于 `/var/folders/7z/5dcj6kmx005b6sm35w8tnnl80000gn/T/mira-control-feedback-VUzLd7/screenshots/`，测试 browser/runtime 已关闭。

仅同步路线与本验证记录，不改写首轮证据。未推送远端、创建 PR、删除分支、发布或替换安装版；原生设备和模型质量验证边界保持不变。

## 远端同步准备与复验（2026-09-14）

用户要求更新文档并提交远端后，fetch 确认 `origin/main` 为 `cd048a1`：此前项目打开相关提交已有等价远端提交，且远端另含 PDF 打包资源路径修复。仅将本批两个尚未推送的 UI/文档提交重放到该基线上，没有冲突，保留远端修复；实现提交由 `4222a3c` 变为 `219b9e4`，主干集成记录提交由 `e26457a` 变为 `04d0b9c`。

更新使用手册中的深色/网格开关操作、减少动态效果及排队/运行/停止指示说明，并同步文档入口与路线。文档提交随 `main` 正常推送，不强制覆盖远端历史。

在合并后的源码上重新运行 `pnpm test`（185 文件 / 1858 项）、`pnpm exec tsc --noEmit`、`pnpm build`、`pnpm build:bridge`，全部通过。新增的一项测试来自远端 PDF 资源路径修复；Node 测试仍有 4 条 localStorage ExperimentalWarning，前端构建无 500 kB chunk warning。

同一生产构建再次通过 `scripts/check-control-feedback-browser.mjs`：六套外观、1440/390px、键盘与焦点、按压、减少动态效果、真实 HTTP 完成与停止均通过，browser warning/error 与 pageerror 为 0。证据目录为 `/var/folders/7z/5dcj6kmx005b6sm35w8tnnl80000gn/T/mira-control-feedback-0cnWLg/screenshots/`；测试 browser/runtime 已关闭。文档 diff 已复核，`git diff --check` 通过。

源码推送与桌面包构建分开核对：主干 push 会触发 Actions，测试包必须按此次最终源码 SHA 和实际工作流结果确认。本批没有替换本机安装版，也不新增原生设备或真实模型质量验收结论。
