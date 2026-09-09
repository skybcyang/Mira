# 剩余边界拆分集成验证

- 日期：2026-09-06
- 分支：`codex/store-boundary-cleanup`，未合入 `main`、未推送。
- 基线：首批灵感 slice 拆分提交 `70497ac`。
- 环境：macOS，Node.js 26.7.0，pnpm 9.0.0，Codex in-app Browser。
- 范围：保持行为的 Store、DetailDrawer 与 CSS 模块拆分，不包含画布检查点功能。

## 实施与等价性

| 入口 | 拆分前行数 | 拆分后行数 | 职责 |
| --- | ---: | ---: | --- |
| `src/v2Store.ts` | 2486 | 70 | 初始状态与 7 个 command slice 组合 |
| `src/v2/DetailDrawer.tsx` | 1087 | 86 | 稳定入口、页签、panel 路由与既有导出 |
| `src/styles.css` | 6564 | 18 | 按固定顺序导入 17 个 CSS 模块 |

Store 使用 `storeContext.ts` 维护唯一导航代次、写入序号、刷新合并、投影和通知。
Board 生命周期/目录/可移植数据、Card 正文/标签/绑定、Canvas 几何/剪贴板/历史、
Workflow/计划、Transformation 命令分别归位；已有 Run 与灵感 slice 保持边界。

独立审查对照 `70497ac`：101 个原有函数/方法在导航字段引用、共享操作序号 helper 与写入
序号 helper 的明确替换后等价；初始状态一致，64 个根 action 恰好保留一次。工厂初始化
没有提前 get/set/API 副作用，不创建第二份并发状态。

详情分为 8 个内部模块，保持全部 13 个命名导出；27 个函数/常量声明除 export 修饰符外
正文相同，原有 JSX、key、dirty guard、异步意图与 hooks 逻辑不变。

CSS 只沿原有连续语义段切分；全部模块按原分隔连接与基线文本一致。结构化 CSS 指纹
`74fb6c2d03bcd5f40b01e815531259071c012839f7a68672f4defa86550a9fbf` 锁定 selector、
声明、media 与顺序。构建 CSS 仍是 `index-B6HUqBcO.css`（110.89 kB），无视觉规则变化。

## 自动化门禁

- 三切片均先观察边界测试失败，再提取实现；原有行为测试继续保留。
- Store 定向 135 项、详情定向 78 项、样式定向 86 项通过。
- 集成后修正两处测试读取边界：详情 CSS 改读导入树；通知检查扫描全部 Store slice。
- 最终 `pnpm test`：103 个测试文件、1161 项用例通过，包含完整 Bridge 集成测试。
- `pnpm exec tsc --noEmit`、`pnpm build`、`pnpm build:bridge`、`git diff --check` 通过。
- 所有原有延迟 feature chunk 保留，最大 JS chunk 326.33 kB，无 500 kB warning。
- Node 26 测试保留既有 localStorage ExperimentalWarning；不宣称自动化输出零 warning。

## 真实浏览器

使用独立 `/tmp/mira-split-browser.Wl3uT1/workspace` 和 `127.0.0.1:57446`，只使用确定性
本地模型适配器，无远端模型请求或 API Key。

1. 1440x900：新建立即聚焦正文，保存形成 v1；进入版本页后返回编辑，dirty 时切页进入离开确认，继续编辑保留草稿并返回 textarea 焦点，保存形成 v2。
2. 创建 Transformation 后目标为空、零自动 Run；显式运行得到普通成果 Card，Run 详情显示真实终态和公开事件，桌面侧栏与 Canvas 分开。
3. 390x844：详情为 `aria-modal=true` 的 390px sheet，焦点在内部；方向键可从内容切至关系，方法保存表单和方法库均可达。使用方法只出现未绑定草稿，取消不新增对象。
4. 390px 六套外观逐一切换并截图检查，root theme/color-scheme 正确，所有组合 `scrollWidth === innerWidth === 390`。样式切换不改画板内容。
5. 灵感直接记录后池条目从 0 到 1，画板仍是原来的两张 Card；1024x900 灵感弹窗左右留 24px，无页面溢出。
6. 临时 HTTP 场景在 Run 执行期间追加人工 Head，断言模型完成为 Candidate 且人工 Head 不变；刷新后浏览器仍可打开比较。390px 采用/丢弃按钮均为 44px、位于时间线之前；采用追加 v3，人工 v2 仍在版本列表。
7. 较长模拟 Run 中通过详情停止，终态为 interrupted，已有目标内容保留；停止入口消失，画布恢复运行命令，依赖运行通知收敛为已中断。
8. 1440、1024、390px 已检查界面溢出、详情/命令遮挡与焦点；浏览器 console warning/error 均为 0。

验收中调整视口后曾尝试点击视口外的 Canvas 节点；使用可见 Fit View 命令重新定位后正常。
首次停止检查的 2.5 秒模拟生成提前完成，改为 20 秒临时适配器后完成停止路径；均未因此
修改产品代码。此次使用浏览器模拟窄屏，不宣称真实触屏设备或软键盘验收。

持久截图位于忽略目录 `out/boundary-split-validation-20260906/`：
`compact-inspiration.png`、`mobile-candidate.png`、`mobile-stop.png`、`desktop-stop.png`。
六套外观与桌面/移动 Run 截图还在本次浏览器工具记录中。

## 交付边界

详情与样式切片来自各自独立 worktree，按本地提交集成，未修改 `main`、用户数据或其他
工作分支。旧画布版本管理分支仍待自己的浏览器验收；本报告不替代其验收，也不宣称它
已经合入。该分支后续集成时必须将其详情/CSS 改动移到新模块，不能整文件覆盖旧入口。

桌面宿主与打包配置未变，本批没有重复执行 Desktop make/packed smoke。临时验收服务
完成后关闭；此前已停止的真实 Mira 后台不启动，根 workspace 不重新创建锁文件。
