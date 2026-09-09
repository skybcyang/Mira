# 下载案例，接着做下一步

[先看四种工作场景与界面图](../user/use-cases.md) · [新手教程](../user/getting-started.md)

这些是当前 Mira 可以导入的数据文件，不是图片模板。全部内容为虚构或原创的人工演示材料；运行记录来自本地预写文本适配器，不是外部模型生成记录。无需模型连接即可阅读和编辑已有内容，重新生成则需要自己的模型服务。

## 只导入一张画板

| 下载文件 | 导入后从这里开始 |
| --- | --- |
| [软件需求迭代](software.mira-board.json) | 查看「推导回归用例」的新增来源，再比较需求 v1/v2 |
| [读书与学习](reading.mira-board.json) | 打开「周日回看」的两个版本，补自己的阅读观察 |
| [研究整理](research.mira-board.json) | 沿两条竞争解释回查证据，保留反例与待验证任务 |
| [内容创作](writing.mira-board.json) | 点「比较待处理结果」，决定是否保留自己的表达 |

在 GitHub 文件页使用「Download raw file」保存原始 JSON。在 Mira 打开画板菜单中的「管理画板」，选择「导入画板副本」并选取文件。每次导入都创建独立画板，不覆盖同名画板。

单张包包含卡片、正文版本、分组、步骤、计划与相关运行；写作的待比较结果也保留。它不会安装工作区灵感池、方法模板或画布版本。包外出处只作为出处说明，不会意外关联到你本地同名或同 ID 的对象。

## 体验完整工作区

下载 [mira-four-scenarios.mira-backup.json](mira-four-scenarios.mira-backup.json)。包内有：

- 4 张画板、12 条演示运行，其中写作保留 1 个待比较结果。
- 3 条带标签的灵感记录，读书画板的一张卡来自其中的散步记录。
- 1 个经过三步成果检查后保存的写作方法。
- 1 个软件迭代的「周二评审通过 · 单篇下载」画布版本。

这是一个单独的练习工作区。恢复只进入新建或空文件夹，不能用来合并或覆盖日常工作区。

桌面版使用「从 Mira 备份恢复」，选择包和新的空文件夹。源码版先停止目标工作区的 Mira，在仓库根目录执行（把工作区路径改为你准备的新目录）：

```sh
pnpm restore:backup -- \
  --input docs/examples/mira-four-scenarios.mira-backup.json \
  --workspace /absolute/path/to/mira-demo
```

接着用桌面版打开该目录；或按[独立工作区启动说明](../user/user-guide.md#13-standalone三条命令启动)，同时设置 `MIRA_WORKSPACE_ROOT` 为恢复目录、`MIRA_STATIC_ROOT` 为已构建的 Mira `dist` 目录。

## 这些状态为什么还没“完成”？

需求案例的旧回归清单特意停在「来源已变化」，写作特意留了待比较结果。它们让你练习实际决策，而不是只看一张全部成功的流程图。检查框是正文里的演示标记，不能当作真实测试或发布验收。

软件需求在制作时绑定过 `delivery/offline-reading.md`，验证了编辑写回；可移植包按产品规则去掉了文件绑定。恢复后需在自己的工作区重新绑定。包不含原始引用文件正文、API Key 或运行时会话配置，原文件仍须独立保管。

数据制作与验证记录见[场景案例验证](../validation/2026-09-09-realistic-use-cases-validation.md)。
