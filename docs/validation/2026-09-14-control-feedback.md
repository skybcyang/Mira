# 按钮反馈、运行指示与设置开关验证

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
