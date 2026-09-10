# 下载案例，接着做下一步

[看工作场景与界面图](../user/use-cases.md) · [新手教程](../user/getting-started.md)

四张画板使用真实项目文档、公共领域原典和有出处的研究摘要，通过 Kimi `k3` 实际生成。材料选择、问题设计和后续编辑由案例作者完成；不是用户项目实绩，也不是模型正确性的背书。包内保留来源快照、原始输出、正文版本和运行记录。无需连接模型即可阅读、修改和比较；重新生成需要自己的模型服务。

## 只导入一张画板

| 下载文件 | 导入后从这里开始 |
| --- | --- |
| [软件交付](software.mira-board.json) | 对照三层发布证据，检查人工修订后仍待更新的验收清单 |
| [原典阅读](reading.mira-board.json) | 对照斯密的原文与两段论证，质疑最终阅读札记 |
| [证据研究](research.mira-board.json) | 核对 AI 编程研究的任务、样本与时间指标，再审视本地试点设计 |
| [专题写作](writing.mira-board.json) | 比较人工编辑稿和第二次真实生成的待处理结果 |

在 GitHub 文件页使用「Download raw file」保存原始 JSON。在 Mira 的「管理画板 → 导入画板副本」选取文件。每次导入创建独立画板，不覆盖同名画板。

单张包包含卡片、版本、步骤与相关运行，写作的待比较结果也保留。它不会安装工作区灵感池、方法模板或画布版本。包外出处只作为说明，不关联到本地同 ID 对象。

## 体验完整工作区

下载 [mira-four-scenarios.mira-backup.json](mira-four-scenarios.mira-backup.json)，包含：

- 4 张画板、13 次 Kimi 真实生成，其中写作保留 1 个待比较结果。
- 1 条关于阅读评价尺度的灵感记录，以及明确添加到读书画板的卡片。
- 1 个三步写作方法：证据提纲、初稿、事实核查。
- 1 个软件交付的「发布证据初审｜模型推导原貌」画布版本。

恢复只进入新建或空文件夹，不能合并或覆盖日常工作区。桌面版使用「从 Mira 备份恢复」；源码版先停止目标工作区的 Mira，再执行：

```sh
pnpm restore:backup -- \
  --input docs/examples/mira-four-scenarios.mira-backup.json \
  --workspace /absolute/path/to/mira-demo
```

随后用桌面版打开该目录，或按[独立工作区启动说明](../user/user-guide.md#13-standalone三条命令启动)，设置 `MIRA_WORKSPACE_ROOT` 为恢复目录、`MIRA_STATIC_ROOT` 为构建后的 `dist` 目录。

## 保留判断，而不只是成功状态

软件交付案例的下游清单保留「来源已变化」，写作保留真实运行期间人工改稿造成的待比较结果。它们需要你继续作决定。模型提出的清单、试点和发布范围均为分析建议，不代表测试已执行、研究已开展或版本已发布。

包不含 API Key、运行时会话或文件绑定。研究摘要不替代全文，斯密原文的英文引文与模型中文解释有明确区别。来源、生成凭据和质量复核见[案例验证记录](../validation/2026-09-10-kimi-examples-validation.md)。
