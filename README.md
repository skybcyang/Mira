# Mira

[MIT](LICENSE) · [参与贡献](CONTRIBUTING.md) · [路线图](ROADMAP.md) · [安全说明](SECURITY.md)

### 把零散想法，变成拿得出手的成果。

Mira 是一块可以和 AI 一起工作的画板。把材料放上来，选中相关内容，说清下一步想得到什么：一份需求说明、一张读书笔记、一篇文章草稿。每份成果都留在画布上，能修改、追溯，也能成为下一步的材料。

[开始使用](docs/user/getting-started.md) · [看场景案例](docs/user/use-cases.md) · [使用手册](docs/user/user-guide.md)

![Mira 真实画布：需求分出回归与发布两条支线，新反馈加入回归，旧清单提示来源已变化](docs/assets/software-iteration.png)

*周三新反馈来了：需求与内测说明已经更新，回归清单仍待处理。真实界面，人工演示材料；[下载画板，接着操作](docs/examples/README.md)。*

## 从材料出发，每次推进一点

- **把上下文放在眼前。** 笔记、文件和成果放在同一画板，来源与转化步骤清楚可见。
- **让 AI 做一个具体步骤。** 选择一张或多张卡，描述成果，添加步骤后再点击「运行到这里」。
- **把判断留在自己手里。** 生成结果可以继续编辑；每次保存保留版本。运行期间改了正文，迟到的模型结果会等待你比较。
- **把好用的做法留下来。** 走通一段方法后保存，下次换一组材料复用；也可以先搭计划，再逐步完成。

不必先设计完整流程。先写一张卡，得到第一份可以修改的成果。

## 用 Mira 做什么？

| 你的工作 | 具体的一刻 | 怎样继续 |
| --- | --- | --- |
| [软件需求迭代](docs/user/use-cases.md#软件需求迭代) | 评审后又来了中断下载的反馈 | 更新回归支线，保留上次评审版本 |
| [读书与学习](docs/user/use-cases.md#读书与学习) | 重读《小王子》，想到周末的一次散步 | 找回灵感，写下新理解，也留下疑问 |
| [研究整理](docs/user/use-cases.md#研究整理) | 同一行为有两种解释，还出现了反例 | 分开推理，再决定下一轮验证什么 |
| [内容创作](docs/user/use-cases.md#内容创作) | 自己刚改好正文，另一版结果才返回 | 并排比较，保留自己的声音，再做发布核查 |

![读书场景：按主题摊开片段、灵感与未解问题，留下生活实践和改过一次的回看笔记](docs/assets/reading-notes.png)

*不只保存读过什么，也留下自己怎样理解、准备怎样使用。另有[研究与创作案例图](docs/user/use-cases.md)。*

## 开始使用

目前可从源码运行。桌面版处于内部测试阶段，macOS / Windows 构建获取方式见[内部桌面打包](docs/operations/desktop-internal-builds.md)；尚未签名，也没有自动更新，不作为正式公开发布版。

先克隆仓库，或下载并解压源码。全新工作区从空画板开始；想直接体验，可以导入[人工示例包](docs/examples/README.md)。

已安装 Node.js `>=22.12.0` 和 pnpm 后，在仓库根目录运行：

```sh
pnpm install
pnpm build
pnpm start
```

打开[本地 Mira](http://127.0.0.1:56300/graphmind/)，从右上角「系统设置 → 模型设置」测试并保存你的模型连接。然后跟着[新手教程](docs/user/getting-started.md)，用一份可复制的材料完成第一次生成。

默认数据写在当前目录；建议按[独立工作区说明](docs/user/user-guide.md#13-standalone三条命令启动)把日常数据放到单独文件夹。同一工作区同时只运行一个 Mira 实例。

## 内容属于你的工作区

画板和版本保存在本地。使用模型建议或生成时，所选来源的实际文本会发送给你配置的模型服务；本地存储不等于离线推理。未连接模型也可以写卡片、整理材料和搭计划。

画板可以导出为独立副本，也可以备份 Mira 数据。备份不包含引用文件正文和 API Key，原始文件请单独保管。具体边界见[使用手册](docs/user/user-guide.md)。

## 继续探索

[新手教程](docs/user/getting-started.md) · [四个场景案例](docs/user/use-cases.md) · [完整手册](docs/user/user-guide.md) · [运行与开发](docs/operations/development.md) · [文档地图](docs/README.md)

参与开发的 AI 工具统一从 [AGENTS.md](AGENTS.md) 进入；产品定义、规格、架构与验证记录集中在 `docs/`。

Mira 原创代码、文档和演示素材采用 [MIT License](LICENSE)。第三方依赖保留各自许可证，见 [第三方说明](THIRD_PARTY_NOTICES.md)。问题反馈和 PR 请先读[贡献指南](CONTRIBUTING.md)，漏洞报告请走[安全说明](SECURITY.md)中的私密渠道。
