# 首次开源发布

本次选择 MIT，范围为当前源码、文档与专门制作的演示素材。桌面安装包仍是未签名、未公证的 internal Alpha，不随首次源码开源自动公开发布。

首次源码开源时，桌面打包曾仅在 private 仓库执行。2026-09-10 用户已授权主干每次更新后生成四平台未签名 Actions 测试包；当前触发与下载规则见[桌面打包](desktop-internal-builds.md)。本文保留首次源码发布的操作背景，不限制之后已批准的测试产物。

## 公开内容与私有数据

公开入口使用一个**不继承私有开发历史的新 Git 仓库**。原私仓及真实工作区保持可用，不通过清空历史、强推或删除数据来改造日常工作目录。仅在隔离的准备分支取消跟踪以下内容，再由该分支的提交导出源码快照：

- `boards-v2/`、`runs-v2/`、`workflows-v2/`、检查点、灵感池、附件、迁移备份和 workspace lock。
- `reference/`、`archive/`、`mockups/`、`showcase-materials/` 与 `docs/superpowers/` 中的私有参考和设计过程。
- `.env` 等秘密配置、依赖安装目录、构建产物及日志。

公开案例只来自 `docs/examples/`；53 卡布局回归测试使用 `test/fixtures/coffee-layout.json` 的最小几何数据，不再读取真实工作区。历史验证报告中的个人机器路径仅作脱敏，不改写当时的验证结果。

不要把准备分支的数据移除提交直接合并进仍承载真实数据的旧工作树。准备分支适用于导出，不是清理用户文件的脚本。

## 发布前验证

1. 在导出的新仓库冻结安装依赖，运行 `pnpm test`、`pnpm exec tsc --noEmit`、`pnpm build`、`pnpm build:bridge` 和 `git diff --check`。
2. 在新的临时 workspace 启动 Standalone，确认不依赖作者目录、真实模型密钥或私有数据；案例导入另用临时 workspace 验证。
3. 用 Gitleaks 扫描待发布文件和新历史，使用 `--redact=100`，不要在日志中输出潜在秘密。旧历史的密钥扫描通过不能证明其中的个人数据可以公开。
4. 运行 `pnpm audit --json`、`pnpm audit --prod --json` 和 `pnpm licenses list --json`，更新 `docs/licenses/` 的清单与随包许可证原文；单独记录未修复公告及其可达范围。
5. 如改动桌面工具链，执行目标平台 make、普通 packed smoke 与备份恢复 smoke。CI 打包证据不能替代客户端真机 UI 验收。

最新结果见 [2026-09-10 开源准备验证](../validation/2026-09-10-open-source-readiness.md)。

## 确认目标仓库后操作

仓库命名及公开发布属于最后的确认步骤。若继续使用现有 `skybcyang/Mira` 名称，先确认旧私仓的保留名称，再创建新的公开仓库；不要直接将含私有历史的旧仓改为 public。

- 仅推送审阅过的新首提交，不迁入旧分支、标签、Issue 附件、Release 或 Actions 产物。
- 设置简介、主题和 README 链接；启用 Issues 及 private vulnerability reporting。安全反馈流程见根目录 `SECURITY.md`。
- 默认分支启用禁止强推/删除与 PR 合并保护，以 `CI required` 作为必需检查。仓库权限和 GitHub 套餐限制需在实际目标仓确认。
- 启用可用的 Dependabot alerts、secret scanning 与 push protection。仓库已提供依赖更新配置，但文件存在不等于这些服务已开启。
- 首次源码版本通过 CI 后再创建标记与 Release 说明，明确“源码预览”和已验证平台；不上传内部安装包。维护者核对后可从 `ROADMAP.md` 选取适合外部贡献者的任务。

本文件提供操作顺序；没有把待确认的仓库设置、云端检查或发布步骤标为已完成。
