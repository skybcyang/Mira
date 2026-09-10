# 依赖升级集成验证

日期：2026-09-10。范围：Dependabot #1–#6；不改变 Board、Run、Candidate 或 Workflow 语义。

## 升级与修正

- #3 pnpm/action-setup、#1 setup-node 7.0.0、#2 checkout 7.0.1 在最新主干重新运行 Linux/macOS CI 后依次合入。Node 22 与 pnpm 9.0.0 保持不变。
- #5 React 构建插件 5.2.0、#6 React Flow 12.11.6、#4 React/React DOM 19.2.8 在隔离分支集成，锁文件冲突由 pnpm 重新解析。
- 原 #4 的 `@types/react-dom 18.3.7` 不接受 React 19 类型，严格 peer 检查先失败。补齐为 `~19.2.0`（锁定 19.2.7），与 `@types/react 19.2.18` 配套后严格安装通过。使用 minor 范围避免 DOM 19.3 类型要求 React 19.3。
- React 19 使主包达到 555.05 kB，实际产物大小断言失败。将 React、React DOM、scheduler 独立为 `react-vendor`；主包 371.74 kB、React 包 193.87 kB、画布包 184.83 kB，全部 JS chunk 均小于 500 kB，不提高告警阈值。
- 按当前安装图更新 678 条依赖许可记录及 128 项生产依赖原文，不保留安装路径。

## 实际验证

- 基线与升级后：140 个文件、1531 项测试通过；包含 Bridge 的 Run、Candidate、Workflow、导入和恢复集成测试。
- `pnpm install --strict-peer-dependencies`、TypeScript、前端与 Bridge 构建通过。
- 在独立临时 workspace 恢复四案例备份，通过真实浏览器验证画板切换、Fit View、小地图、缩放、卡片拖拽及撤销、新建、正文保存与 v1 追加。
- 1280×800 桌面与 390×844 详情检查通过；窄屏文档宽度 390，无横向溢出，Tab 焦点可见。生产构建浏览器 warning/error 为 0。
- 开发模式临时改动 AppBar 标记，界面即时更新，未保存正文草稿保持；标记随后恢复，源码无测试标记残留。
- macOS arm64 native make 生成 DMG/ZIP；普通 packed smoke 与含 Checkpoint 的 restore smoke 均通过，真实 renderer/API ready、正常退出与锁释放通过。

## 限制

开发模式新版 React Flow 对已有 `hideAttribution: true` 设置显示署名提示，本批保留既有设置并如实记录，不声称开发控制台零告警。Node 26 的测试进程仍有既有 localStorage 实验功能提示。

生产依赖审计 0 项；全量审计仍为 DMG 工具链 image-size 的 2 项高危解析拒绝服务公告，未增加，范围见根 SECURITY.md。不是全量审计零风险声明。

此报告的本地桌面证据仅覆盖 macOS arm64；后续四平台自动构建的原生 runner 结果独立记录，不以浏览器或本机证据代替 Windows/Intel 验收。
