# Contributing to Mira

欢迎通过复现问题、改进文档、补充案例或提交代码参与。项目处于早期阶段；较大的功能先开 Issue 讨论用户场景、边界与验收，小修正可以直接提 PR。

## 本地开发

安装 Node.js >=22.12.0 和 pnpm 9。Fork 后克隆自己的仓库，在根目录执行：

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

打开 http://127.0.0.1:56300/graphmind/。这是本地单用户服务，默认没有网络用户认证。业务数据默认写入当前目录并被 Git 忽略；日常使用建议按[独立工作区说明](docs/user/user-guide.md#13-standalone三条命令启动)放到另一个文件夹。

开发前端时保留一个 Standalone 实例，再在另一终端运行 `pnpm dev`，使用终端给出的开发地址。不要同时启动多个写同一工作区的服务。没有模型密钥也能写卡、搭计划、导入案例和运行测试。模型连接由贡献者自行配置，不把真实密钥、材料或运行记录提交到 PR。

## 修改前

- [AGENTS.md](AGENTS.md) 是 AI 协作入口；[产品定义](docs/product/product-definition.md)与[核心规格](docs/specs/core-specification.md)定义产品行为。
- [架构图](docs/architecture/system-map.md)说明模块边界。UI → Store/API → route/handler → domain/store，不复制领域规则。
- 行为变更先写失败测试，再做最小实现。涉及产品语义时先讨论，不通过代码顺便改变语义。
- 测试使用临时工作区和随机端口；测试夹具放在 `test/`，可导入的人工案例放在 `docs/examples/`。

## 提交 PR

```sh
pnpm test
pnpm exec tsc --noEmit
pnpm build
pnpm build:bridge
git diff --check
```

可见 UI 变化补充桌面和 390px 窄屏截图，检查键盘焦点、溢出和控制台错误。存储、Run、Candidate 或 Workflow 变化需要对应 Bridge 集成测试。桌面修改还需目标平台 make 与 packed smoke，见[内部打包说明](docs/operations/desktop-internal-builds.md)。

PR 说明具体问题、变更后的行为、实际验证及剩余限制。保持单一主题，不附带格式化全仓、个人工作区数据或无关依赖更新。不要求固定提交信息格式；标题应能说明改了什么。

代码与原创贡献按 [MIT](LICENSE) 提供。提交者须有权贡献相关内容；保留第三方署名与许可证，不复制来源不明的代码、图片或书籍原文。当前不额外要求 CLA。

## 适合开始的任务

见[短期路线图](ROADMAP.md)。提交问题时请提供操作步骤、系统和版本、预期与实际行为；使用虚构最小材料复现。安全问题走 [SECURITY.md](SECURITY.md) 中的私密渠道，不贴到公开 Issue。

维护者按精力处理反馈，不承诺固定响应时间。请尊重其他参与者，讨论聚焦问题与证据，避免人身攻击、骚扰或公开他人个人信息。
