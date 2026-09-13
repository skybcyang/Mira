# A3–B8 实施与验证记录

日期：2026-09-13。用户已批准整批规格；当前继续实施，本文逐项记录实际证据，不表示整批完成。

## B7：限定输入范围

产品命题：用户明确选择每一步读取的原文片段与顺序；保存范围零 Run，文件或来源版本变化先要求重新确认；方法复用只保留重选要求，不复用旧材料偏移。普通推导和文本提取走同一冻结输入路径。

实现：共享范围校验、SHA-256 全文指纹、精确 UTF-16 片段、原文行号、章节解析；创建/PATCH/Run、stale、运行到这里、方法提取/应用、可移植校验和身份重映射已接入。Markdown 章节复用现有解析器 `mdast-util-from-markdown` 2.0.3，显式声明原有传递依赖，不新增另一种 Markdown 语法。

UX 可发现性：生成步骤 → 来源 → 输入范围。真实 Chrome 验证章节选择、顺序、保存、离开保护和重新读取；1440×1000、1024×768、390×844 均无页面横向溢出。390px 保存按钮 72×44px，键盘聚焦后完整可见；console warning/error 与 pageerror 记录为空。这是浏览器验证，不能替代 A3 真机触屏、软键盘或原生桌面验收。

产物准确性：明确标注的 CRLF 演示访谈包含重复句子。原生选择第二处“相同的文字。”保存为 `[51,57)`，与原始字符串位置一致；先第二章再第一章保存为 `[43,74)`、`[14,43)`，保留用户顺序。目标仍为空且无 lastRunId。HTTP 集成测试检查普通/提取两种实际模型适配器入参均不包含选区外正文；此处为可控测试适配器证据，不作为 Kimi 输出质量证据。

工程正确性：新增失败测试后实现；覆盖重叠/空白/Unicode/CRLF/章节、全文变化拒绝、方法换材料、导入缺失历史、元数据夹带正文、范围 stale、逐步运行阻挡与导航意图。验收中发现 CRLF 末尾行号多算一行，先补失败测试后修正。

2026-09-13 本地门禁：`pnpm test` **145 files / 1576 tests passed**；`pnpm exec tsc --noEmit`、`pnpm build`、`pnpm build:bridge`、`git diff --check` 均通过。Node 26 测试进程有既有 localStorage ExperimentalWarning；浏览器无对应错误。

证据：

- [桌面范围面板](evidence/2026-09-13-source-scope-desktop.png)
- [390px 范围面板](evidence/2026-09-13-source-scope-mobile.png)
- [390px 保存操作与焦点](evidence/2026-09-13-source-scope-mobile-footer.png)

截图记录首次浏览器验收状态；后续将片段按钮改为已有 secondary-button 样式。整批交付前重跑最终界面与集成门禁。临时数据位于独立 `/tmp/mira-a3-b8-qa.jjdB5P`，不读取或改写用户 Board/Run。

## B3/B4：显式内置指导（实现阶段）

已接入证据对照、材料精读和按反馈修订三种纯文本指导，默认不启用。用户可查看全文、修改并保存；证据对照要求自定完成标准。Run 使用冻结正文，方法提取/应用保留快照，导入和存储验证真实 SHA-256 摘要，不扫描或执行本机 skill。新增 `@noble/hashes` 2.4.0 的 SHA-256 子模块用于同步可移植校验，避免核心校验依赖 Node 或异步 WebCrypto；范围指纹沿用相同摘要格式。

真实 Chrome 已验收：默认关闭；标准空白时保存被拒绝；自定义指导逐字保存且目标仍空、零 Run；替换显示旧/新文本差异；离开有草稿保护。1440px、1024px、390px 无横向溢出、console/pageerror 记录为空；390px 保存按钮高 44px、聚焦后可见。证据：[桌面](evidence/2026-09-13-guidance-desktop.png)、[390px](evidence/2026-09-13-guidance-mobile.png)。

新增 domain、HTTP、方法与可移植集成测试通过。指导主流程集成门禁记录为 146 files / 1581 tests，类型检查、前端/Bridge 构建、diff check 通过；之后补 Run 存储的坏摘要拒绝测试，31 项定向通过，沿用既有 RUN_WRITE_FAILED 写入错误封装。最终整批仍需重跑门禁。这里证明实现与交互，不证明模型质量改善；B5 的两材料复用和真实 Kimi 对照尚未完成，B3/B4 不能据此整体勾选。

## B1/B2/B8：材料阅读、选择与剪藏

产品命题：先由用户指定材料并阅读，再明确选取保存；读取零 Card/Run，保存仅将选定 Markdown 与出处写为普通 Card 或独立灵感。网页不递归抓取、登录或执行脚本，PDF 只支持文本与原页对照，不承诺 OCR。

实现使用注入式 MaterialService、Node 网页/PDF adapter 和独立 MaterialReader；没有复制领域到 Desktop。网页校验所有 DNS/重定向结果并固定连接地址，限制原始/解压字节、正文和时限。PDF worker 接收冻结字节，禁止网络，使用随包 PDF.js 5.4.624、字体/CMaps 与 canvas；原页渲染沿同一快照。临时缓存最多 5 项/64 MiB/10 分钟，取消/关闭清理。服务端按真实范围组装正文，客户端不能提交自造出处或摘录。

验证覆盖私网/数值别名/IPv6/混合 DNS/私网重定向拒绝、静态脚本剔除、登录阻挡、DNS 未返回时取消；材料数量及字节上限、回执重试/过期/不确定状态；实际 Board 存储故障零半写、归档拒绝、初始出处、编辑剥离/恢复保留、池快照入画板、备份拒绝隐藏原文。PDF 实际生成文字/空白/仅图形 fixture，区分 text/empty/unreadable，坏文件和取消明确失败；文件替换后渲染及文本仍来自旧字节，路径越界拒绝。

真实资料：RFC 9110 网页选择“HTTP Semantics”14 字符，确认后仅一张 Card、无 Run；W3C 公开 dummy.pdf 原页显示并选物理页 1 剪藏，个人备注分离；NIST PDF 实际读取 48 页，物理页 6 输入 Kimi，未选全文不进入输入。材料清洗后段落/断词仍需人工核对，未把表格或扫描页验收扩大为所有 PDF 均可靠。

浏览器实际 Chrome 在 1440、1024、390px 检查材料阅读、原生选择、确认正文、草稿离开保护和焦点；保存按钮 44px、无横向溢出。发现“未选中文字”点击会抛未捕获异常，已修为明确提示，复测没有新增 console/pageerror。最初失败事件保留在验收日志，不以清空日志宣称未发生。证据：[最终材料 1024px](evidence/2026-09-13-final-material-1024.png)、[最终材料 390px](evidence/2026-09-13-final-material-390.png)、[PDF 移动宽度](evidence/2026-09-13-material-pdf-mobile.png)。

## B6 后续：旧卡对照与明确更新

新清单版本与旧批次明确绑定，只对标题/正文完全相同且两侧唯一者预填对应。旧卡当前正文默认保留；用户选择新条目并编辑完整拟采用正文，再逐卡 CAS 保存。支持多个新条目到一张旧卡以及逐卡一对多，不自动删除未出现项，不伪装成多目标 Run/Candidate。版本追加 extractionSources，保留原 extractionRef，正文撤销恢复原精确版本与元数据。

真实 Board/Store/可移植定向测试覆盖源/目标版本冲突、活动 Run/Candidate、故障零写、缺失历史、重排/重复对应、人工补充、文件同步边界与撤销。浏览器以明确标注的启动体验演示清单运行对照，保存后仍保留“人工补充：需要分别记录冷启动与热启动。”；只有一张旧卡新增版本。曾发现对照模式详情标题为空，已补回并复测。1440/1024px 为同一右侧任务面板，390px 全屏，按钮 44px、焦点可见、无新增错误。

证据：[最终桌面](evidence/2026-09-13-final-reconciliation-1440.png)、[1024px](evidence/2026-09-13-final-reconciliation-1024.png)、[390px](evidence/2026-09-13-final-reconciliation-390.png)。公开 GDS/NIST 材料另有真实 Kimi 4/14 条目，见下节，不把演示卡当成实际用户研究。

## B3/B4/B5 最终质量记录

已完成 20 次新的 Kimi k3 调用：六组有/无指导 12 次；依据实际失败修订指导 1.0.1 追加 6 次；公开文章/PDF 提取 2 次。三种指导各有两材料复用。旧指导快照和失败输出保留，默认仍关闭，不自动升级或自动修改来源。

完整输入、输出、字符/条目数、逐项依据和未满足约束见[质量复核](2026-09-13-model-quality-review.md)。部分措辞改善，但 GDS/PDF 对照仍超长，PDF 提取含未标明的补充解释，故质量集未全绿。真人修改字符数/用时未测，保持 null。可选工具的实现通过与模型正确性分别判断。

## A3/A4：平台与发行

已实现独立手动发行准备 workflow，固定源码/版本、四 native runner、release 凭据缺失即失败、Mac 签名/公证/DMG 检查、Windows Authenticode、真实签名回执与资产摘要、统一 manifest/SHA256SUMS。脚本拒绝错版本/架构文件名、缺目标、重复资产、错源码、缺签名证据和修改后的真实字节。默认主干 unsigned CI 保持，准备脚本没有 tag/push/Release/latest 写入。YAML 可解析，新增 download-artifact 固定 SHA 已通过 GitHub 只读 API 核对；workflow 尚未上传或执行远端验证。

系统设置显示版本、Desktop 实际架构以及官方发行页；1440/1024/390px 链接焦点与 44px 操作区域可见，无新 console 错误。[390px 证据](evidence/2026-09-13-final-settings-390.png)。无后台更新检查/下载/安装。凭据、四目标验收及手动升级回退步骤见[发行规程](../operations/desktop-release.md)。

本机 macOS Apple Silicon 上生成 arm64 与 x64 unsigned DMG/ZIP，并分别运行正常与恢复 packed smoke；正常 smoke 包含内置 PDF worker 解析和 PNG 渲染。x64 是本机 Rosetta 执行，不能称 Intel Mac 原生验收，更不能代替 Windows。最小 staging 排除 PDF viewer/maps，保留必要字体许可与 THIRD_PARTY_NOTICES.txt；锁文件许可证清单更新为 708 条版本记录。

另在独立 `/tmp/mira-native-final-8gNONS` 启动本批 arm64 `.app`，原生可访问性树确认新工作台、材料/方法入口和空画板，宿主 ready。只做原生启动观察，未完成目录选择/焦点/窗口关闭的完整客户验收；宿主记录 fs.Stats 的 DEP0180 deprecation warning，不宣称零 warning。原已安装 `/Applications/Mira.app` 没有替换、退出或改写。

本机无有效 codesigning 身份；未提供 Windows native、真实 Intel Mac、手机触屏和正式签名通道。A3 软键盘/旋转/safe-area 真机、A4 四原生目标/签名/升级回退/正式发行仍未完成。浏览器宽度模拟与当前准备代码不替代这些条件。

## 集成门禁与剩余事项

最终门禁结果在本报告末尾记录；前文各阶段测试数量保留历史事实。差异复核重点为命令写入范围、真实输入、可移植数据排除、过期/并发回执、域依赖与签名证据。发现的备份出处缺校验、DNS 取消、PDF 取消错误类型、未选文字异常及对照标题问题均已修复并定向验证。

生产依赖审计为 0 项；全量审计仍有既有 DMG 构建工具 image-size@0.7.5 两项高危解析 DoS 公告，与 [9/10 记录](2026-09-10-dependency-upgrades.md)一致。只处理仓库受控图标，不把不可信阅读材料送入 DMG 工具；未声称全量审计通过。Node 26 测试仍有既有 localStorage ExperimentalWarning。

用户数据未迁移或批量改写；QA 只用独立临时 workspace。没有提交、推送、PR、合并、分支清理、安装替换或公开发布。统一 TODO 保留 A3/A4、B2 Windows 原生和 B5 稳定质量/真人修改成本的未完成状态。

### 最终门禁（2026-09-13 03:15，Asia/Shanghai）

| 检查 | 实际结果 |
| --- | --- |
| `pnpm test` | **155 files / 1609 tests passed**；包含真实 socket 地址固定、gzip 解压后上限与 PDF worker 测试 |
| `pnpm exec tsc --noEmit` | 通过 |
| `pnpm build` / `pnpm build:bridge` | 通过 |
| `git diff --check`、active Markdown 相对链接 | 通过；所有已检查相对路径存在 |
| macOS arm64 make、正常及恢复 packed smoke | 通过；正常 smoke 验证包内 PDF 文字/空白状态与 PNG |
| macOS x64 make、正常及恢复 packed smoke | 通过；在 Apple Silicon/Rosetta 执行，非 Intel Mac 原生 UI 认证 |
| 最终 `.asar` 分发检查 | THIRD_PARTY_NOTICES.txt 和 PDF worker 存在，PDF viewer 不存在，source maps 为 0 |
| 本地资产字节及摘要 | [四个 Mac DMG/ZIP 记录](evidence/2026-09-13-desktop-builds.json)；unsigned，明确标记未提交工作树，非正式 Release manifest |

全部 20 次模型 Run 已结束，隔离浏览器、QA HTTP 服务和本轮原生测试进程已关闭，进程内模型凭据不留运行实例；证据文件未包含提供的密钥。临时 QA 材料保留便于追溯，不删除用户数据。未把已实现的工作清单等同于 A3–B8 全部验收完成。
