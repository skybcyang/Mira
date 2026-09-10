import { readFile } from 'node:fs/promises'

const source = (name, markdown) => ({ name, markdown })
const document = async (name, path) => source(name,
  `# ${name}\n\n来源：Mira 仓库 ${path}，源码基线 8e95063，读取日期 2026-09-10。以下是该文档的原始内容；历史报告只证明其记录时点。\n\n${await readFile(new URL('../' + path, import.meta.url), 'utf8')}`)
const smithUrl = 'https://www.gutenberg.org/files/3300/3300-h/3300-h.htm'
const step = (name, sources, instruction) => ({ name, sources, instruction })

export async function exampleSources() {
  const release = await document('S1｜源码公开与桌面分发边界', 'docs/operations/open-source-release.md')
  const validation = await document('S2｜9 月 10 日开源准备实证', 'docs/validation/2026-09-10-open-source-readiness.md')
  const desktop = await document('S3｜跨平台 native make 与 smoke 记录', 'docs/validation/2026-09-09-desktop-ci-validation.md')
  const reliability = source('S4｜内容可靠性的产品承诺', `# 内容可靠性的产品承诺\n\n来源：docs/product/product-definition.md §5.8、§5.10、§9；8e95063 基线的人工摘述。\n\nCardVersion 追加保存，不原地改写。Run 启动冻结有序来源和目标基线，返回时目标变化则结果进入 Candidate，人工内容保留。未处理 Candidate 必须保持可达。\n\n导入画板只创建新身份副本；完整备份只恢复到新建或空工作区，不覆盖使用中的数据。备份不含 API Key、文件引用指向的实际正文和本地文件绑定。每个 Node 可写 Host 必须取得 workspace 独占写锁。\n\n这些是规格承诺；是否实现应查看对应测试和验证记录，不能只凭承诺宣称验证通过。`)
  return [
    {
      key: 'software', title: '软件交付｜哪些证据足以支持发布？', sources: [release, validation, desktop, reliability],
      question: '一套源码检查、三种桌面打包记录和未完成的真机验收，应如何形成可执行的发布建议？本画板是基于仓库证据的模型分析，不授权发布。',
      steps: [
        step('区分三层发布证据', [0, 1, 2], '按源码可运行、原生打包可启动、真实客户端可使用三层整理证据。标注报告日期与原文路径。解释为什么 Windows runner 成功不能替代 Windows 真机交互。对记录冲突按时点解释，不能虚构新执行结果。'),
        step('提出本轮可交付范围', ['step0', 0, 3], '给维护者写一页发布范围建议。区分源码候选、内部安装包、公开安装包，分别写可交付项、尚缺前提和暂缓项。给出与数据安全承诺相关的验收门槛。所有建议明确为待维护者决定，不能宣布已发布或给未验证平台背书。'),
        step('生成可验收的后续清单', ['step1', 1, 2, 3], '把建议转为6到8条可验证的后续任务，每条说明要取得什么证据、在哪里观察、失败时如何停止。不要把历史通过项冒充本轮执行结果，不编造负责人和日期。区分跨平台客户端体验与源码开源工作。'),
      ],
    },
    {
      key: 'reading', title: '原典阅读｜分工的效率与人的完整性',
      question: '斯密一方面赞扬分工提高产量，另一方面担心劳动者判断力受损。两种论证是否矛盾？从原文机制出发阅读，不把它直接套成现代管理处方。',
      sources: [
        source('R1｜分工为什么提高产量', `# 分工为什么提高产量\n\n原文：Adam Smith, The Wealth of Nations (1776), Book I, Chapter I, “Of the Division of Labour”。公共领域英文原文，定位：段落起句 This great increase。来源：${smithUrl}\n\n> This great increase in the quantity of work, which, in consequence of the division of labour, the same number of people are capable of performing, is owing to three different circumstances; first, to the increase of dexterity in every particular workman; secondly, to the saving of the time which is commonly lost in passing from one species of work to another; and, lastly, to the invention of a great number of machines which facilitate and abridge labour, and enable one man to do the work of many.\n\n阅读任务：分别解释熟练、转换损耗、机器发明三种机制，不把生产率等同于个人福祉。`),
        source('R2｜专门化可能损害什么', `# 专门化可能损害什么\n\n原文：Adam Smith, The Wealth of Nations (1776), Book V, Chapter I, Part III, Article II, “Of the Expense of the Institutions for the Education of Youth”。公共领域英文原文。来源：${smithUrl}\n\n> In the progress of the division of labour, the employment of the far greater part of those who live by labour, that is, of the great body of the people, comes to be confined to a few very simple operations; frequently to one or two. But the understandings of the greater part of men are necessarily formed by their ordinary employments.\n\n> His dexterity at his own particular trade seems, in this manner, to be acquired at the expense of his intellectual, social, and martial virtues.\n\n阅读任务：识别“工作塑造能力”的假设；区分18世纪作者的判断与经现代研究验证的事实。不要去掉其历史语境。`),
        source('R3｜教育如何进入论证', `# 教育如何进入论证\n\n原文：Adam Smith, The Wealth of Nations (1776), Book V, Chapter I, Part III, Article II。公共领域英文原文。来源：${smithUrl}\n\n> But though the common people cannot, in any civilized society, be so well instructed as people of some rank and fortune; the most essential parts of education, however, to read, write, and account, can be acquired at so early a period of life, that the greater part, even of those who are to be bred to the lowest occupations, have time to acquire them before they can be employed in those occupations.\n\n> For a very small expense, the public can facilitate, can encourage and can even impose upon almost the whole body of the people, the necessity of acquiring those most essential parts of education.\n\n阅读任务：解释教育在前两段论证中的位置，不能推断斯密主张取消分工或已设计现代教育制度。`),
      ],
      inspiration: '# 待检验的阅读问题\n\n一种制度增加总体产出，是否足以证明它也改善了参与者的判断能力？先区分评价尺度，再讨论取舍。这是本案例编辑提出的问题，不是斯密原文，也不是实验结论。',
      steps: [
        step('重建效率论证', [0], '以论点、三个机制、隐含条件、没有回答的问题四部分重建这一段论证。保留 Book I / Chapter I 定位。中文解释不是原文引文，不增添现代实验数据。'),
        step('重建能力与教育论证', [1, 2], '解释重复工作怎样在作者论证中影响能力，教育承担何种补充作用。区分描述性判断与规范主张。写出一条对这段论证的可讨论质疑，但不能伪称已经证伪。'),
        step('形成有分歧的阅读札记', ['step0', 'step1', 0, 1, 2], '围绕分工提高产量却可能损害能力的张力，写700到900字札记。明确两段是否同一评价尺度，逐项引用 R1/R2/R3。保留两项原文尚未回答的问题，最后提出下一次需要查找的文本证据。避免生活鸡汤、当代政策处方和编造引文。'),
      ],
    },
    {
      key: 'research', title: '证据研究｜AI 编程到底节省了谁的时间？',
      question: '不同研究报告加速与减速，能否合成一个通用提效数字？本画板对照三份公开研究材料，不代表完整系统综述或对当前模型的评测。',
      sources: [
        source('E1｜固定编程任务的受控实验', '# 固定编程任务的受控实验\n\n来源：Peng et al., The Impact of AI on Developer Productivity: Evidence from GitHub Copilot, 2023，论文摘要人工事实摘述。https://arxiv.org/abs/2302.06590\n\n实验任务是用 JavaScript 实现一个 HTTP server；处理组可使用 GitHub Copilot，对照组不可使用。论文报告处理组完成任务快55.8%。\n\n材料仅覆盖该固定任务实验；不提供所有软件开发工作的平均收益，也不测量长期维护收益。不要擅自把“快55.8%”转换为另一个未核对的时间百分比。'),
        source('E2｜熟悉仓库的维护者实验', '# 熟悉仓库的维护者实验\n\n来源：METR，2025-07-10，Measuring the Impact of Early-2025 AI on Experienced Open-Source Developer Productivity。公开报告的人工事实摘述。https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/\n\n16名有经验的开源开发者，完成自己长期参与项目的246个真实任务。任务随机分配允许或不允许AI，使用的是2025年初工具。允许AI时耗时增加19%。开发者在实验前预期提速，实验后仍认为提速。\n\n作者明确不声称这些开发者或仓库代表多数开发工作，也不声称之后的新工具不会在同一场景提速。'),
        source('E3｜后续研究出现选择偏差', '# 后续研究出现选择偏差\n\n来源：METR，2026-02-24，We are Changing our Developer Productivity Experiment Design。公开更新的人工事实摘述。https://metr.org/blog/2026-02-24-uplift-update/\n\n后续研究从2025年8月开始。作者认为新数据不能可靠估计当前AI的生产率效果：部分开发者不愿参加需要禁用AI的实验，部分任务不愿提交随机分组；报酬变化和并行代理的耗时记录也影响解释。\n\n原参与者子集的任务耗时点估计下降18%，区间为下降38%到增加9%；新增参与者下降4%，区间为下降15%到增加9%。区间均跨零，且作者强调选择偏差。因此不能写成“已证明当前提效18%”，也不能继续把旧19%当作当前通用结论。'),
        source('E4｜准备回答的本地问题', '# 准备回答的本地问题\n\n案例研究问题，由编辑设定；不是已开展的企业实验。\n\n一个维护成熟代码库的小团队准备评估AI工具。任务包含熟悉模块修复、陌生模块探索和有明确验收的新增功能。关心的是达到可合并标准的总投入，包括阅读、实现、等待、核查、返工与评审。\n\n没有本团队实测数据；不得给出投资回报数字、虚构试点结果或用公开研究替代本地测量。需要输出下一轮如何收集证据的方案。'),
      ],
      steps: [
        step('核对研究可比性', [0, 1, 2], '用表格对照研究时点、参与者和任务、处理条件、指标、结果、适用边界。区分受控结果、自我感受和后续偏差，引用 E1/E2/E3。禁止平均三个百分比。'),
        step('解释表面冲突', ['step0', 0, 1, 2], '给出两个可竞争的解释：任务与经验差异、工具时点与选择偏差。分别列支持材料、目前不能判定的部分、需要的额外证据。不要把可能原因写成研究已经证明的机制。'),
        step('设计一次可解释的本地试点', ['step1', 3], '写一个小团队可以执行的试点草案，按任务类别分层，说明记录口径、质量检查、AI等待与并行工作的处理、失败和未完成任务如何保留。承认样本小，输出报告方式和继续/停止条件，不编造样本量功效或收益承诺。'),
      ],
    },
    {
      key: 'writing', title: '专题写作｜源码公开之后，谁来承担可用性？',
      question: '面向准备开放项目的独立开发者，用具体证据写一篇文章：测试通过、源码可用和安装包可公开分发之间，究竟还隔着哪些工作？',
      sources: [
        source('W1｜编辑任务与论证要求', '# 编辑任务与论证要求\n\n原创案例任务，不是真实采访或用户口述。读者是第一次准备开放项目的维护者。写一篇900到1200字的专题文章，用Mira仓库记录举例，解释源码公开后的可用性责任。\n\n不要写成教程命令合集，不虚构下载量、用户增长、收入或作者亲历。至少保留一个不能靠多写测试解决的问题，以及一个可核对的反例。源码开源与安装包发布分别论证，结尾给读者一个能检查自己项目的具体问题。'),
        release, validation, desktop, reliability,
      ],
      steps: [
        step('建立主张与证据提纲', [0, 1, 2, 3, 4], '形成文章主张、3到4节提纲、每节对应的文件来源和不可外推的边界。提出一个反方观点并公平回应。不能把待办写成已完成，把当日审计写成永久安全。'),
        step('写出有依据的专题初稿', ['step0', 0, 1, 2, 3, 4], '写900到1200字可阅读初稿，以一个具体交付判断开场，连接事实、取舍和读者行动。文内用文件名简短归因，不抄长段原文。准确区分native smoke与客户端验收；不替维护者宣告发布，不写虚构第一人称经历。'),
        step('逐项核查事实与主张', ['step1', 1, 2, 3, 4], '核查初稿中最多8个关键可检验主张，逐条给原文依据、支持/需要收窄/缺乏证据的判断以及具体改写建议。标明文章尚未对外发布，核查不是法律审计。不要默认初稿正确。'),
      ],
    },
  ]
}
