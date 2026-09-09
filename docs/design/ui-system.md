# Mira UI 系统

- 状态：Board 生命周期、六套外观与可移植数据 UI 基线
- 日期：2026-09-05
- 方向：Studio / Editorial / Blueprint，各含 Light 与 Dark

## 1. 视觉意图

Mira 是一件长期使用的知识工作工具。视觉首先服务内容阅读、来源确认和步骤状态，不做营销式构图，也不把流程表现成复杂自动化控制台。

层级顺序：

1. Card 内容。
2. 当前来源、目标和关系。
3. 本次明确可执行的命令。
4. Version、Run 和 Workflow provenance。
5. 低频设置与诊断。

不使用大面积米色、紫蓝渐变、装饰光斑、厚重阴影、超大圆角或胶囊堆叠。页面 section 不做浮动 Card；不在 Card 内继续嵌套 Card。

## 2. Token

外观由两个正交维度组成：`studio | editorial | blueprint` 决定字体、几何、材质和动效语气，`light | dark` 决定配色。三种方向共享全部功能、信息架构和产品语义；切换外观不得重置 viewport、选择、drawer、草稿或运行状态。

- **Studio**：安静的原生工作室。紧凑圆角、克制半透明 chrome、柔和但清晰的层级与短促 spring-like 反馈。
- **Editorial**：内容优先的编辑部。衬线展示标题、平面纸张感、细分隔线、近乎无阴影。
- **Blueprint**：精确的蓝图台。方角、等宽元数据、硬边框、红色命令强调；不使用玻璃、渐变或装饰阴影。

每个组合必须提供完整 semantic token，包括 `canvas / grid / surface / ink / muted / faint / border / control-border / accent / on-accent / danger / on-danger / warning / shadows / radii / fonts`。小号正文对背景至少 `4.5:1`，控件边界与焦点至少 `3:1`；深色主按钮不能硬编码白字。

### 2.1 Light

| Token | Value | 用途 |
| --- | --- | --- |
| `--canvas` | `#F7F9F8` | 画布 |
| `--grid` | `#D5DDD8` | 低对比点阵 |
| `--surface` | `#FFFFFF` | Card、App bar、drawer |
| `--surface-subtle` | `#F1F4F2` | 输入、来源条、hover |
| `--border` | `#DDE4E0` | 默认边界 |
| `--ink` | `#1E2421` | 主文字 |
| `--ink-muted` | `#69736D` | 次要信息 |
| `--ink-faint` | `#929B96` | 元数据 |
| `--accent` | `#356F59` | 选择、主命令、Transformation |
| `--accent-soft` | `#E8F0EC` | 低对比选中背景 |
| `--workflow` | `#63747D` | 轻量计划分组、Workflow provenance 与步骤编号 |
| `--workflow-soft` | `#EDF2F4` | Workflow 轻量背景 |
| `--warning` | `#9A681A` | stale、待比较 |
| `--warning-soft` | `#F3E8D2` | warning 背景 |
| `--danger` | `#AA4039` | 失败、删除 |
| `--danger-soft` | `#F5E2E0` | error 背景 |

Workflow 色只标识轻量计划分组与方法来源，不表达运行状态。状态色优先级高于 provenance 色。

### 2.2 Dark

| Token | Value |
| --- | --- |
| `--canvas` | `#151917` |
| `--grid` | `#252C28` |
| `--surface` | `#1D2320` |
| `--surface-subtle` | `#28302C` |
| `--border` | `#36413B` |
| `--ink` | `#EEF2EF` |
| `--ink-muted` | `#A6B0AA` |
| `--ink-faint` | `#737F78` |
| `--accent` | `#63C99C` |
| `--accent-soft` | `#203D31` |
| `--workflow` | `#9AAEB7` |
| `--workflow-soft` | `#28343A` |
| `--warning` | `#E1B765` |
| `--warning-soft` | `#3E3422` |
| `--danger` | `#E27A72` |
| `--danger-soft` | `#442724` |

## 3. 字体与尺寸

```css
--font-ui: "Avenir Next", "SF Pro Text", "PingFang SC", "Microsoft YaHei", sans-serif;
--font-content: "Avenir Next", "SF Pro Text", "PingFang SC", sans-serif;
--font-mono: "IBM Plex Mono", "SFMono-Regular", monospace;
```

- Card 正文：13px / 1.7。
- Card 标题：15px / 600 / 1.35。
- Drawer 标题：16px / 600。
- App bar、按钮、输入：12px-13px / 500。
- 元数据和步骤编号：11px / 500，数字使用 tabular figures。
- 字距恒为 `0`；字体大小不随 viewport 连续缩放。

基准间距为 4px，常用间距 8/12/16/24px。Card 圆角 6px，菜单和输入 4px，drawer 与 sheet 不使用装饰性圆角。Icon button 为固定 32px；触屏提升到至少 44px 命中区。

## 4. 布局

```text
App bar: 58px desktop / 52px mobile
Canvas: remaining viewport
ContentCard: 312px x 208px default
Context dock: max 760px
Selection toolbar: min-height 40px desktop / 48px touch
Transformation: 232px x 124px
Detail drawer: 380px floating panel + 12px right margin
Workflow library: 392px desktop reserved column
```

固定格式元素必须使用稳定尺寸：Card loading/empty/error 状态不能改变外框；步骤编号、handle、按钮和进度不能引发布局跳动。

Drawer 或方法库打开时，Desktop Canvas 使用剩余宽度，MiniMap、Controls 与 Context dock 同步避让；不触发 fitView、自动平移或 viewport 保存。Compact/Mobile 采用覆盖层，禁止造成 body 横向溢出。

## 5. 核心组件

### 5.1 AppBar

- 左侧使用衬线斜体 `mira.` 字标与统一画板菜单；字标独立使用 Georgia italic 字体栈，不随主题正文字体切换，保存状态仅异常时展开。菜单默认显示常用与已打开，搜索覆盖全部未归档画板；当前、运行中、待处理是独立状态标记，图钉和关闭为明确按钮。
- 顶栏采用对称三列：左右弹性区相等，中央搜索最大 440px，Compact 最大 280px，Mobile 为 44px 搜索按钮。搜索中心不随左侧板名长度偏移；行为沿用体验设计 2.1。
- 右侧依次为撤销、重做和系统设置；Mobile 三项均保留 44px 命中，不藏进更多。
- 系统设置为右上临时面板：网格开关、三方向与明暗控件、模型设置入口；外点/Escape 关闭，焦点回到设置按钮。网格仅隐藏背景线，保留画布坐标、缩放、吸附、选择及草稿。
- 工作工具栏悬浮于画布左侧，距左 16px、顶栏下 20px，宽 148px / 收起 54px；图标文字同行，完整边框、主题圆角和轻阴影，按内容高度结束，不再贯穿整屏。短窗口自身滚动。
- 工具顺序为新建、多选、画布、灵感池、方法与计划、文件、画布版本；新建以 accent 强调，五项导航维持单一活动入口，多选独立表达模式。新建复用原创建与草稿离开保护。
- 工具栏全部入口平铺，不保留更多与重复搜索。管理全部画板位于顶栏画板菜单底部，所有原命令仍可从中央搜索找到。
- 菜单内允许单字段快速新建。重命名、归档、废纸篓、导入、导出和备份进入独立 BoardManager。关闭只移出本机已打开列表，最后一项关闭后显示选择或新建画板的空态。
- 方法与计划面板上部为搭一个计划，下部为已保存的方法。计划表单分离步骤成果名称与处理要求，最后一步成果只读跟随最终成果；预览后在画布显式绑定材料并添加，不自动运行。
- React Flow controls 位于右下并跟随可用 Canvas 区域，避免与 drawer、dock 或外观入口重叠；移动端控件命中区至少 44px。
- 不显示第二套模式切换或另一类执行节点入口。

### 5.2 ContentCard

Card 使用固定标题拖动栏、可选字/滚动正文、标签槽与稳定底栏。阅读/编辑入口常可达，状态变化不改变外框。内容详情沿用同一任务，默认阅读，单一编辑/预览入口原位切换，并提供 Maximize2/Minimize2 扩展；桌面扩展面板与右侧 12px 边距合计为 `min(800px, W - N - 360px)` 并保留至少 360px 画布，Compact/Mobile 同层覆盖。来源辅助阅读宽时并列、窄时返回，草稿不得卸载。工具栏与整理菜单沿用现有六套外观及 Lucide，32px 桌面/44px 触屏命中，详情菜单与底部保存避让软键盘。

结构自上而下：标题拖动栏、正文阅读区、等高标签槽、稳定 footer。标题栏提供阅读/编辑命令，footer 保留版本与状态入口；下方仍有内容时显示继续阅读图标，显隐不改变槽位尺寸。

标题栏优先展示独立卡片名称，名称旁直接放置 TextCursorInput `重命名`按钮，不使用单项更多菜单。详情顶部仅显示一次名称与改名入口，点击后原位变成带可见 label 的单行输入、`保存名称`与`取消改名`；不与正文表单嵌套，清空恢复默认标题。保存或取消后焦点回到改名入口。名称草稿加入统一离开保护，冲突同层展示最新名称并保留输入，核对后才允许再次保存。390px 输入和按钮至少 44px，允许换行排列。

- 默认：白色 surface、1px border、轻微结构阴影。
- 选中：accent 边框与清晰焦点环。
- 空方法目标：等高轮廓、`等待生成`、不使用骨架动画。
- Running：内容区域低调进度，尺寸不变。
- Failed/Candidate/stale：用图标、短文字和状态色组合，不只用颜色。
- 用户标签位于正文与 footer 之间，最多显示两个，超出时显示 `+N`；长标签截断但完整列表保留在可访问名称中。标签不替代 Card 状态，也不制造固定内容类型。
- Workflow 步骤不增加 Card 类型标签；`1/3` 放在对应 Transformation 标签中。
- Markdown 预览共用 CommonMark + GFM 渲染：标题、列表、引用、强调、代码块、链接/图片，以及表格、只读任务列表、删除线、自动链接和脚注。表格和长代码在自身区域横向滚动，图片不超出阅读宽度；卡片、完整阅读和来源预览规则一致。原始 HTML 不执行，危险 URL 继续过滤；预览不改写正文或任务勾选状态，非 Markdown 文件仍显示纯文本。
- Markdown Card 的详情将`本地文件`绑定行与灵感出处归入默认折叠的`卡片信息`：显示相对路径、同步状态和绑定/解除命令。冲突时在同一区域提供`用 Mira 版本覆盖`与`导入本地修改`，不使用嵌套弹窗；file-reference 不显示绑定命令。

### 5.3 TransformationBlock

- Transformation 固定为约 `232 × 124px` 的紧凑步骤节点，明显小于 ContentCard；不使用 Card 正文排版，也不嵌套内容卡。
- 顶部窄条显示`步骤`和来源数量，主体显示成果名称；底部只保留运行状态和`运行到这里` icon command。模型覆盖只在详情显示。
- 左右各一个固定 handle；来源边进入左侧，唯一输出边从右侧进入目标 Card。转化块左侧输入端接受内容卡追加来源，拖线期间用 accent / danger 边界区分可接入与拒绝状态，并提供原因。命中区域至少 44px，视觉圆点保持紧凑。输出端只展示既有连线，不发起连接；Card 到 Card 的直连仍禁止。
- 自动创建目标 Card 或铺出 WorkflowPlan 时，转化块与两侧 ContentCard 各保留至少 32px 净空，连线顺序必须清楚呈现为`内容卡 → 转化块 → 内容卡`。
- 转化块允许直接拖动；保存坐标后不再随来源或目标 Card 自动回到中点。块内按钮必须使用 `nodrag`，避免运行命令触发拖动。
- 多来源数量过大时可以隐藏逐条入向边，但必须在转化块显示`N 个输入`，并在详情保留完整有序列表。
- WorkflowPlan 复用相同节点，只按 `planRef` 在顶部增加 workflow 色 `1/N`，不添加包围整条计划的容器；旧 `workflowRef` 数据继续兼容投影。
- 选中使用 accent 边界与焦点环；运行、失败、stale 和 Candidate 不能改变节点尺寸。
- 不用大容器包住整条计划，不让 provenance 抢过内容关系。

### 5.4 CanvasSelectionToolbar

选择工具栏是画布整理命令面，不是 Card 或 drawer。它固定在画布顶部中央，使用稳定高度和紧凑 icon button；与底部 Context dock 分离，避免把“整理选择”和“推进来源”混成一个主命令。

- 有 Card 选择时，左侧固定显示`已选 N 张`，随后依次提供复制、创建副本、删除、粘贴、多选开关和取消选择。
- 选择清空但内部剪贴板仍有内容时，显示`已复制 N 张`、粘贴与清空；切换画板不让粘贴入口消失。
- 第一次点击删除只进入行内确认。工具栏原位显示`删除 N 张卡片？`、`取消`和 danger 样式的`确认删除`，不使用另一个嵌套 Card 或遮住选择对象的模态框。
- 任一卡仍被 Transformation 引用时，不进入确认态；使用短状态提示要求先处理相关结构，不能暗示会部分删除。
- 使用固定命中区，hover/active 不改变外框；窄屏仅在工具栏内部横向滚动，不制造页面横向溢出。

#### 5.4.1 颜色与分组

卡片颜色以低饱和顶边色条表达，与选中外环、失败标记及 Run/Candidate 文案分离；默认色保留既有外观。六个预设在浅/深色主题保持可识别，不改变正文对比度。色板使用带颜色名称与选中状态的 swatch，不用颜色替代 accessible name。

分组框使用透明或极淡背景与虚线边界，置于内容、转化与交互控件下方。标题有独立不透明底面、明确的拖动把手和组命令入口；标题允许换行，框顶部预留标题区。框内空白不拦截平移、框选或连线，不产生新的 Card 外观。颜色与分组菜单沿用既有 surface、字体、focus-visible、图标 tooltip 和 390px 命中区规则，不增加视觉主题。

### 5.5 ContextDock

Dock 是工作控件，不是营销 Card：紧凑、横向、稳定贴近底部。

- 来源 chips 允许横向滚动，不因长标题撑宽页面。
- file-reference 来源以 basename 为主标签，完整路径放在 tooltip/accessibility metadata；出现同名 basename 时附加能区分它们的最短父目录后缀。路径没有可用 basename 时显示规范化路径，仍不可用时回退为`文件材料`；390px 下必须截断或滚动而不撑出页面。
- 建议超过一行时自然换行，最多三个。
- 自定义目标输入至少 44px 高；主命令尺寸稳定。
- 建议按钮与自定义目标共用`添加步骤`动作语义：只创建结构，不启动模型；不暴露内部分段或模式选择。任一创建请求进行中时锁定全部建议、输入和提交命令，快速重复触发只发送一次请求。
- 自定义目标旁提供`添加分支` icon+text 命令。进入并行拆解后，使用连续行编辑 2–16 个成果目标，显示分支序号、添加/删除命令和`添加 N 个分支`主命令，达到上限时添加命令禁用；提交一次性创建多个普通 Transformation 与空目标，保持零 Run。分支草稿未提交时不写 Board。
- Context dock 的`添加步骤`和已有关系上的`运行到这里`必须文案不同。
- 添加 WorkflowPlan 后用单行状态说明步骤已添加且尚未生成，不显示全局进度条。

### 5.6 DetailDrawer

Drawer 是无内层 Card 的连续信息面：tabs、分隔线、列表和对比区域直接落在 surface 上。

- Candidate 从运行详情显式打开宽比较窗口；最大 1120px、距视口 32px，Compact 距视口 16px，Mobile 全屏。内容区 ≥900px 双栏独立滚动，其余纵向完整阅读；底部固定稍后处理、丢弃、采用，提交中锁定关闭与相反决策。当前栏固定打开时 Head，更新只提示，重新比较才换基线。
- 普通详情使用 380px 悬浮面板，距顶栏、右侧和底部各 12px；Desktop 展开后面板与右边距合计 `min(800px, 视口 - 实际导航宽 - 360px)`；Compact 展开 `min(800px, 视口 - 54px - 32px)`。来源栏 240px，详情外框不足 736px 时同层返回正文；正文草稿不卸载。来源自身返回与关闭整个详情是两个明确命令。
- 比较完整阅读复用安全 GFM；逐行差异使用加减符号和语义颜色。合计超过 200,000 字符或行数矩阵超过 1,000,000 格时在计算前降级到完整阅读，不把未计算显示成无差异。
- 有未处理 Candidate 时，关系详情突出`比较待处理结果`；重新生成、编辑和删除命令禁用，并显示先采用或丢弃的短说明。
- 采用与丢弃 Candidate 共用一次提交锁；请求期间两个决策同时禁用并显示当前动作，不能连续发出相反命令。
- Relation 与 Run 视图在活动 Run 期间都持续显示`停止`，移动 sheet 不要求用户先返回画布寻找节点。
- 运行中的目标 Card 使用 `Activity` 打开运行详情，`Square` 停止生成；两个 icon button 都有明确 accessible name 和 tooltip，点击不触发 Card 选择或覆盖当前 drawer 意图。
- 运行详情使用无嵌套 Card 的紧凑时间线：状态摘要在顶部，最近 20 条事件按发生顺序排列，每行显示时间、label 和可选 detail。长 detail 换行，不撑宽 Drawer；旧 Run 无事件时显示低干扰空态，终态缺少 `finishedAt` 时不显示虚假耗时。
- 正文或标签 dirty 时保留本地草稿；Head 异步变化只显示冲突提示。关闭、页签切换、对象切换、`Esc` 和 scrim 统一显示`继续编辑 / 放弃修改`，未确认不得卸载编辑器。
- 异步创建或 Run 完成时，仅在右侧详情槽位空闲时自动导航；用户等待期间打开的新 drawer 或面板优先保留，结果通过通知和画布状态继续可达。
- Version 列表使用时间轴或紧凑行，不为每个版本创建装饰 Card。当前行明确显示`当前 vN`；human、ai、restore、import 使用稳定来源文案。
- 选中历史 Version 后与当前 Head 做 Markdown diff；无正文变化显示明确空态。恢复确认显示将创建 `vN+1`，旧 Version 不变；冲突后保留当前选择。
- 带 `planRef` 的关系详情展示计划名、步骤编号、步骤导航和`计划已调整`状态；只有带 `workflowRef` 时才补充模板名、`applicationId` 和`模板已删除`状态。
- Transformation 设置连续展示成果名称、有序输入、模型策略、目标说明和完成标准。模型默认继承；固定模型只填写模型 ID，并明确只影响当前步骤。
- 不提供无目标的`运行全部`或后台自动化设置；关系详情只提供有明确终点的`运行到这里`。
- 来源管理使用无内层 Card 的有序列表，上移、下移、移除使用带 tooltip 的图标命令；添加来源进入非模态画布点选。点选工具条暂代 Context dock 与整理工具栏，包含有序候选、可键盘操作的选择菜单、确认和取消；长标题截断并保留完整 accessible name，390px 内不得遮挡确认按钮或产生页面横向溢出。

### 5.7 InspirationPicker

灵感选择器是宽任务弹窗，不是第二个 Canvas。桌面最大宽约 1040px、高度不超过视口减 64px；顶部固定池状态、搜索与标签筛选，主体为结果与 240px 已选栏，底部固定确认命令。默认静态三行摘要，可切换两行紧凑列表；结果内部宽度至少 600px 才使用两列摘要，DOM 顺序与视觉一致。不使用漂浮、瀑布流或完整 ContentCard。全文在同一窗口内阅读并返回原检索位置。

标题区提供带图标的`记录灵感`命令，并用 `aria-expanded` / `aria-controls`表达模式切换。记录模式在同一弹窗中替换检索主体，使用一个有可见 label 的 textarea、常用标签、单行自定义标签输入和独立`保存灵感`主命令；直接保存时，自定义标签输入中的有效文字必须一并提交，不能静默丢弃。不把记录表单叠在结果列表上，也不打开第二个 modal。`Esc` 在记录模式只返回检索并把焦点交回模式切换命令，在检索模式才关闭选择器。

全文底部提供`编辑灵感`，沿用记录表单，主命令变为`保存修改`；取消返回全文。正文或标签未保存时同层确认，保存期间禁用重复操作。冲突保留可复制的草稿，并提供明确的`放弃草稿，载入最新内容`。保存后回到更新后的全文；已选旧版本保持原样并显示`已选旧版本 · 灵感池有新版`。全文底部操作可换行，390px 保持可达。

记录成功后清空正文、刷新灵感池结果、保持选择器打开并使用 `aria-live=polite`确认；记录失败使用 `role=alert`，保留正文与标签以便重试。保存灵感时不创建 Card 或 CanvasHistory；只有添加到当前 Board 时，新 Card 才进入当前 Canvas 和一条可撤销的 `create` 会话历史。

结果行显示两至三行摘要、标签和更新时间，整行是稳定的选择命中区；选中时显示有序编号与 `aria-pressed`，不能只依赖颜色。右侧已选项使用上移、下移和移除 icon button，长正文不进入排序区。

检索模式主命令为`添加到当前画板（N）`，零选择、来源未就绪、画板不可写或提交中禁用；成功后关闭弹窗，保留原选择、编辑、drawer、分支草稿与视口并通知数量。记录模式主命令为`保存灵感`，正文空白、来源未就绪或提交中禁用，独立于当前画板。未保存记录离开时同层确认；失败保留正文、查询、筛选和有序选择。

Mobile 使用无装饰圆角的全屏 sheet，记录与检索主体继续互斥，`结果 / 已选`为分段控件，标签只在自身区域滚动。记录模式的`保存灵感`在 390px 软键盘打开时仍固定可达；检索模式的`添加到当前画板（N）`同样固定在计入 safe-area 的底部命令区。触屏不依赖从结果拖到 Canvas，所有命中区至少 44px。

### 5.8 WorkflowLibrary

界面统一称为`方法`。列表是密度适中的行列表，而不是卡片墙；每行包含名称、可选说明、具名需要内容、完整有序步骤、`使用`和删除 icon command。列表顶部提供`搭一个计划`，进入同一侧栏内的 PlanComposer，不嵌套 Card。

每个模板直接用编号列表展示完整步骤；每步显示成果标签和 instruction。v1 不显示可编辑控件。

第一次点击删除只展开行内确认，不立即请求服务；确认区固定显示`删除方法？`、`不影响已经添加的步骤。`、`取消`和`确认删除`。

### 5.9 SaveWorkflowForm

- 关系详情中的触发命令：`保存为方法`。
- 名称必填，说明可选。
- 步骤为连续编号列表，不嵌套 Card。
- 任一步目标缺少真实当前 Head、Markdown 仅空白或 file-reference 路径为空时，保存命令禁用并显示`成果未完成`；仅有 headVersionId 不得进入可保存状态。
- 每个外部来源显示可编辑槽名、说明、必填和 `one/many` 数量约束。
- 若提取在 fan-out 前停止，使用 warning 行说明；步骤中的额外来源提取为输入槽。
- 底部明确`只保存方法，不复制当前内容`。
- 命令：`取消`、`保存`。

### 5.10 PlanDraft

直接计划和方法应用复用同一 PlanDraft。直接计划的编辑表单先收集计划名称、最终成果和有序的`每步做法`；紧邻字段说明`最终成果将作为最后一步成果名称`，不能让用户误以为最后一项做法被覆盖。草稿直接投影在 Canvas：步骤块显示需要的具名输入槽，空目标使用虚线轮廓，内部步骤边预连。草稿不得复用正式 Transformation 的 ID 或写入 Board。

第一步草稿节点内显示必填完成度、取消命令和确认命令，并固定说明`不会自动生成`。直接计划使用`取消搭计划`/`添加计划`；方法应用使用`取消使用方法`/`添加步骤`。不再增加常驻底部草稿 dock。

内容卡可连到槽 handle；槽旁同时提供`使用已选`作为触屏和键盘后备。方法库入口使用`使用`，确认使用`添加步骤`；不能使用播放、闪电或“一键执行”图形暗示自动运行。确认后打开第一步关系详情，并用轻量通知说明尚未生成。

### 5.11 CanvasFocus

- Board 超过 6 个节点时，首次只定位最左侧 2 张移动端或 3 张桌面内容卡，保证正文可读；完整结构仍可通过平移、缩放和小地图访问。
- 开始使用方法时，无显式内容选择只聚焦第一步；有显式选择时聚焦所选内容与第一步。不得为了展示整条方法而把节点缩到不可操作。
- 新建 Card 使用视口中心作为意图锚点，但实际位置经过确定性碰撞避让；相同锚点连续创建的稳定尺寸 Card 不相交。
- PlanDraft 落地后仅消费一次包含真实来源、第一步 Transformation 和第一目标的 focus intent。用户已平移、Board 已切换或请求身份过期时不得执行迟到聚焦。
- 灵感池添加保持原 viewport、选择与编辑上下文，不自动定位或 fit 新 Card。
- 选中内容卡后，两跳内节点与连线保持完整对比度；无关结构降至低对比度，hover 时可临时辨认。
- 多选与方法连接期间关闭分支淡化，避免隐藏用户正在组织或连接的对象。

### 5.12 BoardManager

BoardManager 是延迟加载的管理弹窗，不使用 Card 墙，也不把管理 Card 嵌套进页面 Card。顶部使用`正在使用 / 已归档 / 废纸篓`分段视图；每行显示标题、更新时间、状态和清晰的 icon command。

- 重命名使用行内表单，冲突保留草稿并显示最新标题；归档、移入废纸篓必须二次确认。
- archived 行提供重命名、恢复、导出和移入废纸篓；trashed 行只提供恢复和导出。两种状态都退出内容、结构与运行写命令，第一批不显示永久清除。
- 导入采用独立预览步骤，连续展示对象数量、外部出处、文件依赖、不会安装的方法出处与`作为新画板导入，不覆盖现有内容`；未知格式或校验错误使用 `role=alert`。
- 导出与备份使用 `Download` icon；导入使用 `Upload` icon。熟悉的单项命令可使用 icon-only + tooltip，`导入画板副本`和`备份 Mira 数据`保留 icon + text。
- 每个 Board 行使用 `History` icon-only 命令打开其画布版本；archived/trashed 行仍可查看、导出、创建副本、重命名和删除版本。
- Mobile 使用全宽 sheet，生命周期分段和底部确认区自身稳定；长画板名换行，不能挤出恢复或确认命令。
- BoardManager 只下载完整备份，不展示对当前 workspace 的恢复命令；完整恢复入口只在 Desktop 启动 chooser 或 Standalone 离线 CLI 出现。

### 5.13 BoardHistory

BoardHistory 是无嵌套 Card 的延迟加载面板。摘要使用连续行和分隔线，显示名称、保存时间、Card/步骤/Run 数量与备注首行；内部 revision 不作为用户版本号。列表、保存表单、只读预览、与当前画板比较、创建副本确认、重命名和删除确认在同一任务层切换。

- Desktop 宽 360px 并缩小 Canvas 可用区域；Compact 覆盖 Canvas；Mobile 使用无装饰圆角的全屏 sheet。
- 预览 Canvas 不挂载编辑、连接、运行或文件绑定命令。首版只比较一个 Checkpoint 与当前 Board；布局和结构显示汇总，Card 正文显示 Markdown diff。
- 保存表单只收集名称和可选备注。活动 Run、未处理 Candidate 和 20 个上限使用明确禁用说明，不提供绕过入口。
- 保存、删除和创建副本使用固定底部命令区；删除为行内二次确认。长标题换行，所有触控命中至少 44px。
- 关闭后焦点回到触发入口；异步失败保留所选 Checkpoint 和当前表单草稿，成功结果通过 NoticeRegion 播报。

### 5.14 NoticeRegion

全局通知使用结构化 `progress / info / success / error / attention`，不能从文案字符串推断类型。success/info 自动过期；progress 必须由同一操作的终态替换；error/attention 保持到用户关闭或问题被处理。旧通知的 timer 不得清除后来到达的新通知。

NoticeRegion 使用可预测的堆叠区域并避让 App bar、选择工具栏、drawer、Context dock、modal 和面板 footer。它不得覆盖命令中心 hit target。`aria-live=polite` 用于普通变化，阻止继续工作的错误使用 `role=alert`；同一状态变化不能重复播报。

## 6. 图标与命令

使用现有 Lucide 图标：`Workflow`、`Play`、`Activity`、`Square`、`History`、`Save`、`Undo2`、`Redo2`、`Lightbulb`、`GitBranch`、`AlertTriangle`、`Check`、`Copy`、`CopyPlus`、`ClipboardPaste`、`MousePointer2`、`Archive`、`ArchiveRestore`、`Download`、`Upload`、`Trash2`、`X`、`MoreHorizontal`。熟悉的 icon-only 命令配 tooltip；业务命令使用 icon + text。

- `Play` 用于有明确目标的`运行到这里`；执行期间目标步骤显示进行中，其他运行节点按普通 Run 状态呈现。
- `Undo2`、`Redo2`只表示当前 Board 页面会话中的有限 Card 历史，禁用态不得暗示存在持久恢复点。
- `Workflow` 只表示模板和 provenance。
- `GitBranch` 只用于用户明确画出的方向。
- `Copy`、`CopyPlus`和`ClipboardPaste`只操作 Mira 当前页面会话的内部剪贴板，不使用系统剪贴板图形反馈或跨应用承诺。
- 破坏性命令用 danger 色，并在实际删除前列出影响。

## 7. 状态与动效

- hover/focus：100-140ms。
- drawer/sheet：160-220ms。
- Running 指示可循环，但尊重 `prefers-reduced-motion`。
- 不用脉冲光环、粒子或整条 Workflow 的持续流动动画。
- 状态改变不得移动 Card、改变 dock 高度或遮挡相邻内容。
- success/info 默认短暂显示；生成、导入、导出和备份 progress 必须在成功、失败或停止后离开进行态。

## 8. 响应式

### Desktop `>= 1100px`

App bar 高 58px，左侧悬浮工具栏宽 84px / 收起 54px；drawer（含右边距）与方法库默认占用右侧 392px，画布版本占用右侧 360px；Canvas 与侧栏不重叠。方法骨架与 WorkflowPlan 默认水平铺开，保证需要内容和第一步在视口内。

### Compact `720px..1099px`

54px 悬浮图标工具栏；侧栏和画布版本以模态覆盖 Canvas，背景 inert，通知在任务内呈现；Context dock 左右留 16px；方法详情用单列；第一步方法节点内的确认区不能遮住输入槽或相邻内容。

### Mobile `< 720px`

App bar 高 52px，保留字标、管理画板按钮、画板选择、中央搜索图标、右侧撤销/重做/设置；底部为高 60px + safe-area 的悬浮工具栏，四周留 12px，包含新建、多选与六项工作入口，390px 全部平铺，更窄时自身横向滚动；详情打开时隐藏。drawer/library/BoardHistory 全屏；可视高度使用 VisualViewport，短视口下正文滚入可视区、保存区固定。菜单项、drawer 页签、选择工具栏和计划节点内的命令至少 44px，必要时自身横向滚动；长步骤名换行，禁止缩小字体或截断唯一关键信息。

## 9. 无障碍

- 文本和背景达到 WCAG AA；焦点环与选中边框均清晰。
- 所有 icon button 有 accessible name；tooltip 不作为唯一说明。
- 来源顺序可通过键盘调整，并播报新位置。
- Dialog/Sheet 正确锁定焦点，关闭后回到触发元素。
- BoardHistory 列表、预览和确认保持单一 modal task；状态切换不丢失焦点或表单草稿。
- 同一时刻只有一个 modal task；已有 dialog 或移动 sheet 时，`Cmd/Ctrl + K` 不叠加命令菜单。
- drawer 页签使用 `tablist/tab/tabpanel` 与 roving tabindex，支持方向键、`Home` 和 `End`。
- Card footer 在键盘焦点进入时可见；标签的完整列表具有 group/list 语义。
- Plan 创建、Run 结束、Candidate 到达使用 `aria-live=polite`。
- 异步结果不得关闭用户后来打开的详情或面板，也不得把焦点移出当前任务。
- 连线和状态在非视觉辅助文本中提供等价描述。

## 10. UI 验收

- 用户不会在任何生产入口看到第二套模式或旧执行节点语言。
- 方法连接和应用后状态都明确“尚未生成”。
- Workflow 步骤在视觉上属于普通 Transformation，而非第二种节点。
- 1440、1024 和 390px 视口无工具栏、drawer、dock 重叠或页面横向溢出。
- 最长模板标题和中文步骤名能换行，不溢出按钮或列表。
- 计划、运行、失败、stale 和 Candidate 状态不会改变 Card 尺寸。
- 选择工具栏在有选择、内部剪贴板或显式多选状态时可达，在 Desktop/Compact/Mobile 均不遮住 Context dock 或造成 body 溢出。
- 复制、创建副本、粘贴与删除使用熟悉 icon 和 accessible name；删除二次确认明确显示 Card 数量。
- 触屏无需长按即可从悬浮工具栏进入多选与新建 Card，所有画布整理命令命中区至少 44px。
- 撤销/重做在桌面与窄屏 App bar 均可达，禁用状态稳定且不会被误解为完整对象图恢复。
- 画布内容始终比 provenance 和工具控件更突出。
- 方法连接期间没有第二个底部草稿操作面；确认与取消始终位于第一步节点内。
- 灵感选择器在桌面为宽弹窗、390px 为全屏 sheet；记录与检索主体互斥，textarea、结果、已选列表和对应固定底部命令无重叠，软键盘打开时`保存灵感`仍可达，选择顺序可见且可调整。
- `Esc` 在记录模式先返回检索、在检索模式才关闭；记录成功与失败均有无障碍反馈。保存灵感池不增加 CanvasHistory，添加到当前 Board 才增加可撤销的 `create` 历史。
- PlanComposer 在 1440、1024 与 390px 均能添加、排序和删除步骤；底部命令、表单与 Canvas dock 不重叠，页面无横向溢出。
- 空画板主命令的可见中心命中目标就是该按钮；点击一次创建且聚焦一张 Card。连续创建不重叠。
- Plan 落地在 1440、1024 与 390px 保持主对象可读，不因 fit 全部对象缩成缩略图。
- NoticeRegion 在 Candidate + 选择工具栏、PlanComposer footer、1024px drawer 和 390px 撤销/重做场景中没有矩形相交，关键按钮中心仍命中按钮。
- BoardManager 在三档视口中可完成重命名、归档、移入废纸篓、恢复、导出、导入预览和备份；破坏性确认与格式错误不被通知层遮挡。
- BoardHistory 在三档视口中可完成保存、预览、比较、重命名、删除和创建副本；Run/Candidate/上限禁用说明可读，固定命令区不遮挡内容。
