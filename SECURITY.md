# Security policy

## Reporting a vulnerability

请不要在公开 Issue、PR 或讨论中提交漏洞利用细节、真实 API Key、个人画板、完整运行日志或完整工作区备份。

优先使用仓库 **Security → Advisories → Report a vulnerability** 私密报告。该入口不可用时，可在普通 Issue 中只请求维护者提供私密联系方式，不附漏洞细节；等待维护者安排后再提供材料。

报告建议包含受影响的 commit/版本、操作系统、最小复现、影响与建议修复方式。使用虚构数据，凭据只给脱敏占位符。维护者会按影响优先处理，但目前没有固定响应时限或漏洞奖励计划。

## Supported scope

目前优先维护默认分支的源码版本。旧标签和内部桌面构建不保证回补；报告旧版问题时请注明是否也能在当前源码复现。安全修复确认后通过修复提交、发布说明或安全公告记录适用版本。

## Deployment and data boundaries

- Standalone 面向本机单用户，默认只监听 `127.0.0.1`，没有多用户认证。不要直接暴露到公网；确需远程使用时，需要自行配置受控网络、HTTPS 和认证。
- 本地保存不等于离线推理。调用模型建议或生成时，所选来源的实际文本会发送给配置的模型服务；费用、留存与服务隐私政策由该服务决定。
- 同一工作区只运行一个可写实例。运行数据、附件和备份可能包含个人或业务内容，不属于源码贡献。
- Mira 备份不包含 API Key、运行时会话配置或引用文件正文。原始文件请单独备份；恢复只进入新建或空工作区。
- 当前桌面包用于内部验证，未签名、未公证，没有自动更新。源码公开不代表桌面包完成公开分发验收。

完整使用边界见[用户手册](docs/user/user-guide.md)。如果凭据已经提交或公开，先撤销或轮换，再联系维护者处理仓库历史；仅删除最新文件不足以撤销泄露。

## Known development dependency advisories

2026-09-10 的审计仍报告 `image-size@0.7.5` 两项高危拒绝服务公告：[ICNS 解析循环](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr)、[JXL/HEIF 解析循环](https://github.com/advisories/GHSA-5p2g-fcmc-qvqq)，公告未提供修复版本。它由 `@electron-forge/maker-dmg → electron-installer-dmg → appdmg` 引入，用于开发机制作 DMG，不在应用运行依赖中。打包只使用仓库内审阅过的图形资源，不向此工具传入下载的任意图片；在上游修复或替换该工具链前持续跟踪，不将全量审计标记为通过。同期 `pnpm audit --prod` 为 0 项公告。
