# 桌面正式发行准备

本页说明已实现的准备路径，不表示已有签名版或正式 Release。权威分发契约见[平台规格](../specs/platform-adapters.md)，现有每次 main push 的四架构未签名包仍按[内部打包](desktop-internal-builds.md)运行。

## 准备与凭据

`.github/workflows/desktop-release-prepare.yml` 仅手动触发，输入明确源码 ref 和与 package.json 完全一致的 SemVer。verify 固定提交 SHA 并执行完整工程门禁；四个原生 runner 分别打 macOS arm64/x64、Windows arm64/x64，不拼接不同 SHA 的成功包。

先在 GitHub 配置受保护的 `desktop-release` environment，限制可发行的分支/提交并启用人工审批。仅对已审阅源码运行，不能把不可信 PR/ref 交给持有证书的 job。凭据由维护者在受限 Secrets 中配置，不在聊天、仓库或 workspace 里传递：

| 类型 | 配置 |
| --- | --- |
| macOS environment variable | `MIRA_MAC_SIGN_IDENTITY`：实际 Developer ID Application 身份 |
| macOS secrets | `MIRA_MAC_P12_BASE64`、`MIRA_MAC_P12_PASSWORD`、`MIRA_KEYCHAIN_PASSWORD`、`MIRA_APPLE_ID`、`MIRA_APPLE_TEAM_ID`、`MIRA_APPLE_APP_PASSWORD` |
| Windows secrets | `MIRA_WINDOWS_P12_BASE64`、`MIRA_WINDOWS_P12_PASSWORD`：支持自动化 Authenticode 的有效证书 |

当前 Windows 实现使用可导入 PFX/P12 私钥；只有硬件令牌或远程签名服务时不能伪装成可用配置，需要据实际服务调整签名适配。脚本不采购证书、不读取用户现有私钥。凭据导入到临时钥匙串/当前用户证书存储，步骤结束清理。macOS notary 凭据保存在临时 keychain profile；日志不打印子进程可能包含秘密的错误参数。

默认 `internal` 不签名；显式 `MIRA_DESKTOP_BUILD_PROFILE=release` 缺凭据则失败，不降级为 unsigned。macOS 检查 codesign、hardened runtime、公证、staple、Gatekeeper；DMG 另签名、公证。Windows 对 EXE/DLL/原生模块签名，核对证书指纹、有效状态与时间戳。ZIP 分发完整应用目录，不是假定已有安装器。

## 资产与证据

正常及恢复 packed smoke 都在目标 runner 执行，正常 smoke 还验证包内 PDF 两页文本/空白判定和 PNG 渲染，不依赖目标机器安装 Node。PDF.js worker、字体、CMaps 与目标架构 canvas 模块放在独立 pdf-runtime；不分发 PDF viewer、示例、source map 或远程字体。应用依赖许可证及 PDF 字体独立许可随包保留。

实际签名检查通过后才产生每个资产的 `.signature.json` 证据，含字节 SHA-256。目标清单验证证据与资产匹配；合并清单再次核对四目标、固定版本/SHA、文件名、重复资产与实际文件摘要，拒绝缺项、换包和版本混用。签名回执不是独立可信签名，审阅时仍检查最终二进制原生签名；其作用是阻止准备流程仅凭 release 环境变量假报成功。

workflow 只上传有效期 7 天的 Actions 审阅附件，权限为 contents: read。`complete-signed-release-review` 含版本 manifest、SHA256SUMS 与四平台资产；没有创建 tag、Release、latest 或更新 feed。源码中的本地准备不代表这些远端 job 已执行。

正式发布前还需四目标真实客户端验收、升级/回退记录、最低系统与已知限制说明，以及独立的发布决定。未通过时保留失败证据，不能给未完成项打勾。

## 手动升级与回退

系统设置显示版本，Desktop 同时显示实际平台/架构，并提供官方发行页入口。浏览器版不会冒充本地架构。没有后台检查、下载、安装或重启。

只读 `GET /application-info` 由 Node Host 返回白名单版本/平台/架构，普通 Bridge 返回 `{ desktop: false }`；不暴露宿主路径或秘密配置。

1. 保存正文与计划草稿，处理 Candidate，结束活动 Run。备份 Mira 数据；新备份已包含明确收纳的原件，未收纳的旧引用文件和项目其他文件仍需另行保管。关闭所有使用该 workspace 的 Mira 实例。
2. 下载与系统/架构一致的明确版本，核对发布 manifest 与 SHA-256。macOS 使用 `shasum -a 256 <asset>`，Windows 使用 `Get-FileHash -Algorithm SHA256 <asset>`；再核对系统签名、公证和发行说明。
3. 在隔离副本先检查启动、旧 Board/Run/Workflow/池/Checkpoint 阅读，以及新版本保存后重新打开。macOS 替换应用；Windows 整体解压新目录并从新目录启动，不混用旧 DLL。当前工作区路径不随应用目录搬迁。
4. 回退只在旧版本已验证兼容当前格式时直接更换应用。不兼容时，保留新工作区，把升级前备份恢复到全新或空目录，再由旧版本打开副本；不覆盖、不批量降级改写当前数据。

每个目标记录旧/新版本与 SHA、系统和 CPU、签名检查、操作、实际结果、数据前后摘要、恢复路径和截图。浏览器、Rosetta 或 mock 不能替代 Windows 原生/Intel Mac 客户端证据。本批只有 Mac 本地构建与 packed smoke，签名、四原生目标与真实升级回退尚待环境验证，详见[本批报告](../validation/2026-09-13-a3-b8-validation.md)。

应用内自动更新属于后续阶段：先定义平台安装格式、签名 feed、用户确认、草稿/运行退出及失败恢复，再实现；本次未接 updater。

2026-09-13 项目工作区安装补充：本机 arm64 已从 `95a8e8c` 主干构建替换，实际旧布局复制到新项目，原目录和旧应用保留；完整备份及恢复副本重启验证通过，见[迁移、安装与回退记录](../validation/2026-09-13-project-workspace-install.md)。这不替代正式签名或其他原生目标验收。

2026-09-14 依赖维护补充：本机 arm64 已替换为 Electron 44.3.0 构建，旧应用、workspace 和桌面状态保留在私有回退目录；普通/恢复 packed smoke、原生窗口与安装后原 workspace 启动通过，见[依赖维护与本机安装验证](../validation/2026-09-14-dependency-maintenance.md)。仍是未签名 internal Alpha，不改变正式发行门禁。
