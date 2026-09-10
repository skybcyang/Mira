# 主干自动桌面构建验证

日期：2026-09-10。用户授权：主干更新后由 GitHub 自动打包 macOS / Windows 的 ARM64 与 Intel/AMD x64 测试包。

## 设计与边界

- `main` 每次 push 都执行 Desktop builds，无路径过滤；保留手动入口，打包相关 PR 提前验证。
- 四个原生 runner：macos-15、macos-15-intel、windows-2022、windows-11-arm。先核对实际 process.platform/arch，拒绝把交叉构建当原生证据。
- 全仓门禁通过后，各目标执行桌面定向测试、make、普通 packed smoke、含 Checkpoint 的 restore smoke，成功后上传 DMG/ZIP。
- 产物名称含目标、unsigned 和源码 SHA；保留 14 天。README 链接最新成功的主干运行；失败运行不能标成最新成功版本。
- 公开仓库可上传这些测试产物，替代首次源码开源的 private-only 限制。workflow 只需 contents: read，无签名、模型或发布秘密，不创建 Release，不实现应用内自动更新。
- 两平台继续复用同一 renderer、Host、workspace 锁和领域代码，没有引入第二套产品实现。

## 本地实际验证

- Windows ARM64 目标测试在实现前因 unsupported target 失败，实现后通过；覆盖四个合法目标与非法架构拒绝、两个 Windows 架构的 EXE 路径及隔离 smoke 环境、Electron ARM64 下载校验和。
- 使用系统 Ruby YAML 解析真实 workflow，主干全路径触发断言在改动前失败；改动后四 runner、只读权限、验证依赖、普通/恢复 smoke 先于上传、缺失产物拒绝、SHA 命名等契约检查通过。不为配置检查新增项目依赖。
- 完整门禁：140 个测试文件、1532 项测试，TypeScript、前端构建、Bridge 构建、git diff --check 通过。
- macOS arm64/x64 make 各生成 DMG/ZIP；两架构均通过普通 packed smoke 与 restore smoke。真实 renderer/Board API ready、恢复 Board/Checkpoint、正常退出与 workspace 锁释放通过。本机 x64 通过 Rosetta 运行，不替代 GitHub Intel 原生 runner。
- 本轮依赖升级的生产浏览器、390px 焦点、画布拖拽/撤销、正文保存及 HMR 草稿保留，见[依赖升级验证](2026-09-10-dependency-upgrades.md)。

本机原生可见交互验证启动时发现 macOS 锁屏，尚未完成本批目录选择和窗口交互复验；不沿用旧报告冒充本批结果。
Windows 客户端原生目录选择、焦点、系统提示和最低系统兼容性仍需要真机交互验收。

## GitHub 验证

PR #9 首轮[运行 34440219754](https://github.com/skybcyang/Mira/actions/runs/34440219754) 全部成功。
PR head 为 `c222120ebe118ee2c7257da2b4b4b3bcc4aae142`；GitHub 默认检出的 PR 合并快照为
`45184a12443634346a41558502f5bb40f248fbb9`，产物名称使用后者，不能误称为主干提交。

| 原生目标 | 验证结果 | Artifact ID | 字节数 |
| --- | --- | --- | --- |
| macOS ARM64 | 定向测试、make、启动/恢复 smoke、上传成功 | 10137685691 | 255159243 |
| macOS Intel x64 | 定向测试、make、启动/恢复 smoke、上传成功 | 10137711453 | 262704607 |
| Windows x64 | 定向测试、make、启动/恢复 smoke、上传成功 | 10137696266 | 157753255 |
| Windows ARM64 | 定向测试、make、启动/恢复 smoke、上传成功 | 10137712693 | 156235489 |

GitHub API 确认四份 artifact 均存在、未过期并有 SHA-256 digest。通用 Linux/macOS CI 和密钥扫描也通过。
Actions 对 pnpm/action-setup 与 upload-artifact 的 Node 20 运行时有弃用提示，实际由 GitHub 强制使用 Node 24；项目命令仍使用显式安装的 Node 22。
上述原生构建结果与 smoke 均未受该提示影响，不声称 CI 零告警。

文档补充后的 PR 检查及合并后的主干 push 自动构建，以 [PR #9](https://github.com/skybcyang/Mira/pull/9)
和[主干构建记录](https://github.com/skybcyang/Mira/actions/workflows/desktop-build.yml?query=branch%3Amain)为准；主干最终运行证据另记录在 PR 中，避免为记录自身反复触发新构建。
