import { access, mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateBoardV2 } from '../bridge/domain/validation.js'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outputRoot = resolve(process.argv[2] || repositoryRoot)
const boardKey = '11-coffee-opening'
const boardId = `board-showcase-${boardKey}`
const boardPath = resolve(outputRoot, 'boards-v2', `${boardId}.json`)
const baseTime = Date.parse('2026-08-25T02:00:00.000Z')
const cardWidth = 330
const cardHeight = 220
const columnGap = 520
const rowGap = 300

function atMinute(index) {
  return new Date(baseTime + index * 60_000).toISOString()
}

function digestText(value) {
  let hash = 0x811c9dc5
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= byte
    hash = Math.imul(hash, 0x01000193)
  }
  return `fnv1a:${(hash >>> 0).toString(16).padStart(8, '0')}`
}

function markdown(title, lines) {
  return [`# ${title}`, '', ...lines].join('\n')
}

function cardId(key) {
  return `card-${boardKey}-${key}`
}

function versionId(key) {
  return `version-${boardKey}-${key}-1`
}

function transformationId(key) {
  return `transformation-${boardKey}-${key}`
}

function runId(key) {
  return `run-${boardKey}-${key}`
}

const sourceDefinitions = [
  {
    key: 'project-brief', col: 0, row: 0, title: 'A1 · 项目边界',
    lines: ['- 上海徐汇区天平路街道，70–80㎡社区咖啡店。', '- 目标：90 天内从立项推进到正式开业。', '- 不做正餐，以咖啡、烘焙和邻里活动为主。', '- 阅读方式：从左向右，A 原始材料 → G 经营决策。'],
  },
  {
    key: 'capex-limit', col: 0, row: 1, title: 'A2 · 投资上限',
    lines: ['- 可用资金：80 万元；开业投入上限 65 万元。', '- 至少保留 15 万元现金缓冲。', '- 装修不超过 18 万，设备不超过 16 万。'],
  },
  {
    key: 'neighborhood', col: 0, row: 2, title: 'A3 · 街区范围',
    lines: ['- 衡山路—天平路步行 15 分钟圈。', '- 居民、写字楼与周末游客混合。', '- 早高峰强，午后停留需求明显。'],
  },
  {
    key: 'team-availability', col: 0, row: 3, title: 'A4 · 团队条件',
    lines: ['- 创始人 1 名，可全职驻店 3 个月。', '- 已确定店长候选 1 名。', '- 开业前最多招聘 4 名全职与 2 名兼职。'],
  },
  {
    key: 'business-targets', col: 0, row: 4, title: 'A5 · 生意目标',
    lines: ['- 首月日均 115 单，客单价 38 元。', '- 综合毛利率不低于 68%。', '- 第 3 个月稳定超过 125 单/日。'],
  },
  {
    key: 'service-constraints', col: 0, row: 5, title: 'A6 · 服务约束',
    lines: ['- 不使用明火，不建完整后厨。', '- 工作日 07:30 前可营业。', '- 高峰平均出杯时间不超过 4 分钟。'],
  },
  {
    key: 'interviews', col: 1, row: 0, title: 'A7 · 24 位顾客访谈',
    lines: ['- 15 人需要上班路上的稳定快取。', '- 11 人周末希望安静坐 60–90 分钟。', '- 9 人愿为稳定豆单多付 5–8 元。', '- 6 人在意宠物友好与儿童座位。'],
  },
  {
    key: 'footfall', col: 1, row: 1, title: 'A8 · 三日人流采样',
    lines: ['- 07:30–09:30：平均 462 人/小时。', '- 11:30–13:30：平均 318 人/小时。', '- 周末 14:00–17:00：平均 391 人/小时。', '- 雨天总人流下降约 27%。'],
  },
  {
    key: 'competitors', col: 1, row: 2, title: 'A9 · 竞店观察',
    lines: ['- 800 米内 9 家咖啡店，4 家连锁。', '- 连锁均价 27 元，但高峰排队 8–12 分钟。', '- 精品店均价 42 元，营业普遍晚于 09:00。', '- 市场空档：早开、稳定、可停留。'],
  },
  {
    key: 'rent-a', col: 1, row: 3, title: 'A10 · 铺位 A 报价',
    lines: ['- 68㎡，月租 2.3 万，押六付三。', '- 地铁口 230 米，门头可见度高。', '- 电力仅 18kW，扩容预计 4–6 周。'],
  },
  {
    key: 'rent-b', col: 1, row: 4, title: 'A11 · 铺位 B 报价',
    lines: ['- 76㎡，月租 2.8 万，押三付三。', '- 地铁口 410 米，社区入口转角。', '- 具备 35kW 三相电与独立排水。'],
  },
  {
    key: 'supplier-quote', col: 1, row: 5, title: 'A12 · 供应商报价',
    lines: ['- 双头咖啡机 9.8 万，交期 28 天。', '- 磨豆机两台共 2.7 万。', '- 拼配豆 92 元/kg，鲜奶 13 元/L。', '- 烘焙成品每日一配，起订 40 件。'],
  },
  {
    key: 'regulations', col: 1, row: 6, title: 'A13 · 证照与物业要求',
    lines: ['- 食品经营许可预计 20–30 个工作日。', '- 员工需健康证；招牌需单独报审。', '- 消防、电路、排水须在隐蔽工程前确认。', '- 物业禁止明火与夜间高噪施工。'],
  },
  {
    key: 'week-one-pos', col: 7, row: 0, title: 'P1 · 首周 POS 明细',
    lines: ['- 7 天共 736 单，营收 27,379 元。', '- 日均 105 单，客单 37.2 元。', '- 工作日早高峰占订单 51%。', '- 周末午后座位利用率峰值 96%。'],
  },
  {
    key: 'operations-log', col: 7, row: 1, title: 'P2 · 首周运营日志',
    lines: ['- 记录 144 人时；高峰 P90 出杯 5分06秒。', '- 燕麦奶缺货 2 次，烘焙报损 6.9%。', '- 顾客找错取餐口 17 次。', '- 0 次食品与设备安全事故。'],
  },
  {
    key: 'feedback-pulse', col: 7, row: 2, title: 'P3 · 首周顾客反馈',
    lines: ['- 回收 72 份，NPS 51。', '- 18 人提到早高峰等待偏长。', '- 14 人认为周末安静区边界不清。', '- 12 人明确称赞 07:30 营业。'],
  },
  {
    key: 'member-data', col: 7, row: 3, title: 'P4 · 会员与复购数据',
    lines: ['- 首月注册会员 286 人。', '- 7 日复购率 24%，30 日复购率 36%。', '- 邻里体验券核销率 58%。', '- 会员订单客单比非会员高 4.6 元。'],
  },
  {
    key: 'month-one-pnl', col: 7, row: 4, title: 'P5 · 首月损益',
    lines: ['- 日均 118 单，营收 13.38 万元。', '- 综合毛利率 68.7%，毛利 9.19 万元。', '- 租金、人力及其他固定支出 8.4 万元。', '- 月经营贡献约 0.79 万元，尚未达到扩张门槛。'],
  },
]

const derivedDefinitions = [
  {
    key: 'segments', col: 2, row: 0, title: 'B1 · 三类核心顾客',
    sources: ['interviews', 'neighborhood'], label: '划分顾客',
    instruction: '把访谈与街区结构合并为可服务的顾客分层。',
    acceptance: '每类包含场景、频率、核心需求与支付意愿。',
    lines: ['1. 通勤快取：工作日 3–5 次，重视速度与稳定。', '2. 午后办公：每周 1–2 次，需要插座、安静与续杯。', '3. 周末邻里：停留 60–90 分钟，重视空间与友好服务。'],
  },
  {
    key: 'occasions', col: 2, row: 1, title: 'B2 · 需求时段地图',
    sources: ['interviews', 'footfall'], label: '归纳场景',
    instruction: '把口述需求与分时人流整理成一天的机会窗口。',
    acceptance: '标出峰值、需求、天气影响和服务含义。',
    lines: ['- 07:30–10:00：快取主场，目标 55% 订单。', '- 12:00–14:00：轻食搭配，控制等待。', '- 14:00–18:00：停留与邻里活动。', '- 雨天用预点单和外带动线抵消人流下降。'],
  },
  {
    key: 'location-score', col: 2, row: 2, title: 'B3 · 铺位评分表',
    sources: ['neighborhood', 'footfall', 'competitors', 'rent-a', 'rent-b'], label: '比较铺位',
    instruction: '按流量、成本、工程条件和定位匹配度比较两个铺位。',
    acceptance: '使用同一权重，并明确不可逆风险。',
    lines: ['| 维度 | 权重 | A | B |', '|---|---:|---:|---:|', '| 人流与可见度 | 30% | 9 | 7 |', '| 工程条件 | 25% | 5 | 9 |', '| 租约现金压力 | 25% | 5 | 7 |', '| 社区停留匹配 | 20% | 6 | 9 |', '', '**加权分：A 6.4；B 7.9。**'],
  },
  {
    key: 'unit-economics', col: 2, row: 3, title: 'B4 · 单店经济模型 v1',
    sources: ['capex-limit', 'rent-a', 'rent-b', 'supplier-quote', 'business-targets'], label: '测算模型',
    instruction: '基于真实报价建立保守、基准和目标三档模型。',
    acceptance: '包含客单、毛利、固定成本和盈亏平衡单量。',
    lines: ['- 基准客单：38 元；综合毛利率：69%。', '- 月固定成本：租金 2.8 万、人力 4.2 万、其他 1.4 万。', '- 现金盈亏平衡：约 107 单/日。', '- 120 单/日时月经营贡献约 1.0 万元。'],
  },
  {
    key: 'compliance-gaps', col: 2, row: 4, title: 'B5 · 合规缺口清单',
    sources: ['regulations', 'service-constraints', 'project-brief'], label: '识别缺口',
    instruction: '把营业设想与证照、物业要求逐项比对。',
    acceptance: '每项给出责任人、前置材料和最晚完成日。',
    lines: ['- 食品许可：租赁合同后立即申报，负责人店长。', '- 电路与排水：设计冻结前取得物业书面确认。', '- 招牌：开业前 35 天提交效果图。', '- 健康证：录用后 5 日内集中办理。'],
  },
  {
    key: 'capacity-model', col: 2, row: 5, title: 'B6 · 服务能力模型',
    sources: ['team-availability', 'footfall', 'service-constraints'], label: '测算产能',
    instruction: '把客流峰值、出杯目标和人员条件转成班次产能。',
    acceptance: '明确高峰瓶颈、最低在岗人数和冗余。',
    lines: ['- 双吧台峰值产能：42 杯/小时。', '- 早高峰最低 3 人：点单、咖啡、交付各 1。', '- 午后 2 人可维持基础营业。', '- 需训练 1 名可替补咖啡位的店长。'],
  },
  {
    key: 'positioning', col: 3, row: 0, title: 'C1 · 定位陈述',
    sources: ['segments', 'occasions', 'competitors'], label: '确定定位',
    instruction: '从顾客、时段和竞店空档形成一句可执行定位。',
    acceptance: '包含服务谁、何时使用、为何选择以及主动放弃什么。',
    lines: ['**为天平路周边通勤者和居民提供早开、稳定、能停留的社区咖啡。**', '', '- 早晨以 4 分钟内快取为核心。', '- 午后提供安静座位和稳定豆单。', '- 不追求复杂餐食与网红高频上新。'],
  },
  {
    key: 'selected-site', col: 3, row: 1, title: 'C2 · 选址决策：铺位 B',
    sources: ['location-score', 'unit-economics', 'compliance-gaps'], label: '作出选址',
    instruction: '综合评分、现金模型和合规风险给出选址结论。',
    acceptance: '写明选择、放弃原因、谈判条件和反转条件。',
    lines: ['**选择铺位 B，前提是拿到 30 天免租装修期。**', '', '- 放弃 A：电力扩容会压缩许可与设备调试窗口。', '- B 虽贵 5000 元/月，但押付压力更低。', '- 若免租期低于 20 天，则重新谈 A 的扩容分摊。'],
  },
  {
    key: 'format-hours', col: 3, row: 2, title: 'C3 · 店型与营业时间',
    sources: ['positioning', 'selected-site', 'capacity-model'], label: '定义店型',
    instruction: '把定位、场地和产能转为座位、动线与营业时段。',
    acceptance: '高峰与低峰的人力、座位和服务承诺可执行。',
    lines: ['- 24 个座位，8 个带电源，外带取餐口独立。', '- 工作日 07:30–19:00；周末 08:30–20:00。', '- 早高峰保留 70% 吧台能力给基础咖啡。', '- 宠物仅限门口 4 个外摆位。'],
  },
  {
    key: 'menu-architecture', col: 3, row: 3, title: 'C4 · 首发菜单架构',
    sources: ['positioning', 'occasions', 'supplier-quote', 'service-constraints'], label: '设计菜单',
    instruction: '用需求时段、供应与出杯限制设计最小菜单。',
    acceptance: 'SKU 数量受控，并区分快取主力、利润品和引流品。',
    lines: ['- 咖啡 8 款：浓缩基底 5、手冲 2、季节款 1。', '- 非咖啡 4 款；烘焙 6 款，每日动态补货。', '- 早高峰隐藏手冲，避免拖慢队列。', '- 首月总 SKU 控制在 18 个。'],
  },
  {
    key: 'price-ladder', col: 3, row: 4, title: 'C5 · 价格梯度',
    sources: ['menu-architecture', 'unit-economics', 'competitors'], label: '制定价格',
    instruction: '结合成本、目标毛利和竞店锚点形成价格梯度。',
    acceptance: '每个价格带有角色，组合后达到整体毛利目标。',
    lines: ['- 入门：美式 25 元，建立日常频率。', '- 主力：拿铁 32 元，预计占订单 38%。', '- 升级：手冲 42–48 元。', '- 咖啡+烘焙组合减 4 元；预计综合毛利 69.5%。'],
  },
  {
    key: 'success-criteria', col: 3, row: 5, title: 'C6 · 开业成功门槛',
    sources: ['business-targets', 'unit-economics', 'capacity-model'], label: '设定门槛',
    instruction: '把目标转成可在首周和首月判断的领先与结果指标。',
    acceptance: '包含通过、警戒、停止三个区间。',
    lines: ['- 首周：日均 ≥90 单，4 分钟内出杯率 ≥85%。', '- 首月：日均 ≥115 单，客单 ≥36 元，毛利 ≥67%。', '- 警戒：连续 7 天低于 95 单。', '- 停止扩张：第 3 月仍低于 107 单/日。'],
  },
  {
    key: 'lease-checklist', col: 4, row: 0, title: 'D1 · 租约谈判清单',
    sources: ['selected-site', 'compliance-gaps', 'capex-limit'], label: '准备签约',
    instruction: '把选址条件转成签约前必须锁定的条款。',
    acceptance: '每项有底线、证据和退出条件。',
    lines: ['- 免租装修期 ≥30 天。', '- 押三付三，不接受额外进场费。', '- 电力、排水与招牌位置写入附件。', '- 证照因物业条件失败时可无责解约。'],
  },
  {
    key: 'floor-plan', col: 4, row: 1, title: 'D2 · 平面与动线要求',
    sources: ['format-hours', 'selected-site', 'compliance-gaps'], label: '冻结动线',
    instruction: '把店型、场地与合规要求转成平面设计输入。',
    acceptance: '顾客、员工、外卖和补货动线互不冲突。',
    lines: ['- 入口右侧点单，左侧独立取餐。', '- 吧台后场形成洗杯—制备—出品单向流。', '- 8 个电源座与 4 个外摆位。', '- 隐蔽工程验收后才封板。'],
  },
  {
    key: 'equipment-list', col: 4, row: 2, title: 'D3 · 设备采购单',
    sources: ['floor-plan', 'menu-architecture', 'supplier-quote', 'capex-limit'], label: '确定设备',
    instruction: '按菜单、产能、平面和预算确定采购优先级。',
    acceptance: '包含价格、交期、安装条件和替代方案。',
    lines: ['- 双头咖啡机：9.8 万，T-28 天到货。', '- 磨豆机 2 台：2.7 万；净水系统 1.2 万。', '- 冷藏、制冰、洗杯设备合计 4.9 万。', '- 总额 18.6 万，需租赁制冰机将采购压回 15.8 万。'],
  },
  {
    key: 'supplier-plan', col: 4, row: 3, title: 'D4 · 供应与补货方案',
    sources: ['menu-architecture', 'supplier-quote', 'capacity-model'], label: '安排供应',
    instruction: '把菜单销量、交期和储存能力转成首月供应计划。',
    acceptance: '核心原料有安全库存、补货频率和备用供应商。',
    lines: ['- 咖啡豆安全库存 7 天，每周二、五补货。', '- 鲜奶安全库存 2.5 天，每日盘点。', '- 烘焙采用每日两次补货，晚间退货上限 8%。', '- 豆与奶各保留 1 家经验证备选。'],
  },
  {
    key: 'hiring-plan', col: 4, row: 4, title: 'D5 · 招聘与排班计划',
    sources: ['format-hours', 'capacity-model', 'business-targets'], label: '规划人员',
    instruction: '根据营业时段、产能与单量目标拆出岗位和班次。',
    acceptance: '高峰不缺岗，工时与人力成本进入经济模型。',
    lines: ['- 全职咖啡师 3 名、全职店长 1 名、兼职 2 名。', '- 早班 3 人 07:00 到岗；平峰保留 2 人。', '- 月人力预算 4.2 万以内。', '- T-35 天完成核心员工录用。'],
  },
  {
    key: 'permit-schedule', col: 4, row: 5, title: 'D6 · 证照关键路径',
    sources: ['selected-site', 'compliance-gaps', 'lease-checklist'], label: '排定证照',
    instruction: '按签约、设计、施工和招聘前置关系排定申报计划。',
    acceptance: '所有证照有最晚启动日、负责人和缓冲。',
    lines: ['- T-60：租约与场地资料齐备。', '- T-55：食品许可预审与招牌报审。', '- T-40：消防、电路、排水中期检查。', '- T-20：员工健康证齐备；T-7 完成现场核验。'],
  },
  {
    key: 'training-plan', col: 5, row: 0, title: 'E1 · 10 天训练计划',
    sources: ['hiring-plan', 'menu-architecture', 'compliance-gaps'], label: '设计训练',
    instruction: '把岗位、菜单和合规要求变成开业前训练安排。',
    acceptance: '每天有动作、考核证据和不过关处理。',
    lines: ['- D1–3：设备、安全与标准配方。', '- D4–6：高峰站位和 4 分钟出杯演练。', '- D7–8：投诉、过敏原与清洁闭店。', '- D9–10：全流程模拟；低于 85 分不得独立上岗。'],
  },
  {
    key: 'preopen-budget', col: 5, row: 1, title: 'E2 · 开业前现金预算',
    sources: ['lease-checklist', 'equipment-list', 'supplier-plan', 'hiring-plan', 'permit-schedule'], label: '汇总预算',
    instruction: '汇总签约到开业的所有现金流出与时间点。',
    acceptance: '总投入不越线，保留缓冲并标出最大现金缺口。',
    lines: ['- 押金与首期租金：16.8 万。', '- 装修 17.5 万；设备采购 15.8 万。', '- 首批原料、证照、招聘与营销：7.1 万。', '- 合计 57.2 万，保留 22.8 万现金；预算通过。'],
  },
  {
    key: 'risk-register', col: 5, row: 2, title: 'E3 · 风险登记表',
    sources: ['unit-economics', 'lease-checklist', 'equipment-list', 'permit-schedule', 'business-targets'], label: '建立风险表',
    instruction: '把财务、合同、设备、证照和营收不确定性统一排序。',
    acceptance: '每项包含概率、影响、领先信号、负责人和应对。',
    lines: ['1. 证照延误：高影响；预留 14 天，不提前官宣日期。', '2. 设备延迟：准备租赁机备选。', '3. 首月单量不足：先缩短晚间营业。', '4. 预算超支：软装和非核心设备分阶段采购。'],
  },
  {
    key: 'marketing-calendar', col: 5, row: 3, title: 'E4 · 开业营销日历',
    sources: ['positioning', 'success-criteria', 'format-hours'], label: '安排获客',
    instruction: '围绕社区定位与成功指标设计开业前后四周动作。',
    acceptance: '动作可归因，不以虚高曝光代替到店和复购。',
    lines: ['- T-21：联合 3 家邻里商户发体验券。', '- T-14：招募 60 名试营业顾客。', '- T-7：发布早开与快取承诺，不提前打折。', '- 开业后按首访、二访和推荐分别追踪。'],
  },
  {
    key: 'renovation-acceptance', col: 5, row: 4, title: 'E5 · 工程验收结果',
    sources: ['floor-plan', 'equipment-list', 'permit-schedule'], label: '验收工程',
    instruction: '按动线、设备条件和证照节点完成分阶段验收。',
    acceptance: '隐蔽工程、通电、排水和设备联调都有签字证据。',
    lines: ['- 电力 35kW 满载测试通过。', '- 给排水连续运行 4 小时无渗漏。', '- 吧台动线模拟 40 杯/小时无交叉。', '- 招牌亮度需下调 15%，其余项目通过。'],
  },
  {
    key: 'menu-test', col: 5, row: 5, title: 'E6 · 菜单压力测试',
    sources: ['menu-architecture', 'price-ladder', 'supplier-plan'], label: '测试菜单',
    instruction: '用真实原料、价格和连续订单测试首发菜单。',
    acceptance: '记录出杯时间、损耗、毛利和顾客盲测反馈。',
    lines: ['- 120 单模拟：中位出杯 3分18秒，P90 4分42秒。', '- 燕麦拿铁 P90 过慢，调整备料位置。', '- 烘焙报损模拟 6.5%，低于 8% 上限。', '- 盲测中主力拼配 31/40 人愿意复购。'],
  },
  {
    key: 'staff-readiness', col: 6, row: 0, title: 'F1 · 团队就绪度',
    sources: ['training-plan', 'hiring-plan'], label: '评估团队',
    instruction: '汇总训练成绩、排班覆盖和关键岗位备份。',
    acceptance: '关键班次有人、关键技能有备份、低分项有补训。',
    lines: ['- 4 名全职通过，平均 91 分。', '- 2 名兼职完成基础站位，尚不能独立开店。', '- 店长与 1 名咖啡师可互为关键岗位备份。', '- 投诉处理需在试营业前再演练一次。'],
  },
  {
    key: 'permit-status', col: 6, row: 1, title: 'F2 · 证照状态',
    sources: ['permit-schedule', 'renovation-acceptance'], label: '确认许可',
    instruction: '把计划节点与现场验收结果合并成开业许可状态。',
    acceptance: '明确已取得、待补件和会阻止开业的事项。',
    lines: ['- 食品经营许可：已核准。', '- 员工健康证：6/6 齐备。', '- 招牌备案：补交亮度调整照片后通过。', '- 当前无阻止营业的证照缺口。'],
  },
  {
    key: 'soft-opening', col: 6, row: 2, title: 'F3 · 三日试营业方案',
    sources: ['marketing-calendar', 'menu-test', 'staff-readiness', 'format-hours'], label: '设计试营业',
    instruction: '把获客、菜单测试和人员能力组合成受控试营业。',
    acceptance: '每天限制客流，并有明确观察指标与调整窗口。',
    lines: ['- Day 1：邀请 30 人，验证全流程。', '- Day 2：开放 60 单，重点看早高峰。', '- Day 3：开放 90 单，模拟正式营业。', '- 每晚冻结菜单和站位调整，次日开店前复核。'],
  },
  {
    key: 'go-no-go', col: 6, row: 3, title: 'F4 · 正式开业 Go/No-Go',
    sources: ['renovation-acceptance', 'permit-status', 'staff-readiness', 'preopen-budget', 'risk-register'], label: '作出开业决策',
    instruction: '在同一门槛下审查工程、证照、团队、现金与风险。',
    acceptance: '给出单一结论、未关闭事项、负责人和最后期限。',
    lines: ['**结论：有条件 Go，按 9 月 18 日正式开业。**', '', '- 9 月 16 日前完成招牌亮度照片归档。', '- 开业投入 57.2 万，现金缓冲 22.8 万。', '- 首周不开放外卖平台，保护现场产能。'],
  },
  {
    key: 'daily-dashboard', col: 6, row: 4, title: 'F5 · 首月经营看板',
    sources: ['success-criteria', 'go-no-go', 'price-ladder'], label: '建立看板',
    instruction: '把开业门槛和价格模型转成每日可采集指标。',
    acceptance: '指标有口径、负责人、警戒线和行动规则。',
    lines: ['- 订单：总量、分时、渠道；目标 115 单/日。', '- 体验：4 分钟内出杯率、退款、投诉。', '- 财务：客单、毛利、报损、人力工时。', '- 留存：7 日复购与邻里券核销。'],
  },
  {
    key: 'week-one-review', col: 8, row: 0, title: 'G1 · 首周复盘',
    sources: ['week-one-pos', 'operations-log', 'feedback-pulse', 'member-data', 'daily-dashboard', 'soft-opening'], label: '复盘首周',
    instruction: '把 POS、运营、反馈和会员证据与原定看板、试营业假设逐项比较。',
    acceptance: '区分事实、解释和待验证假设，不用单日峰值下结论。',
    lines: ['- 日均 105 单；工作日早高峰占 51%。', '- 客单 37.2 元；首周收入高于 90 单警戒线。', '- 4 分钟内出杯率 82%，未达 85% 门槛。', '- 周末午后满座，但安静区冲突集中出现。'],
  },
  {
    key: 'issue-backlog', col: 8, row: 2, title: 'G2 · 问题优先级',
    sources: ['week-one-review', 'operations-log', 'feedback-pulse', 'risk-register'], label: '排序问题',
    instruction: '把实际偏差与既有风险合并，按影响和可逆性排序。',
    acceptance: '前三项有负责人、证据与一周内动作。',
    lines: ['1. 早高峰 P90 出杯 5分06秒：调整点单与取餐标识。', '2. 周末座位周转低：测试 90 分钟后温和提醒。', '3. 燕麦奶报损 11%：降低安全库存。', '4. 晚间 18:00 后订单不足：继续观察两周。'],
  },
  {
    key: 'day-30-plan', col: 8, row: 4, title: 'G3 · 30 天调整计划',
    sources: ['week-one-review', 'issue-backlog', 'unit-economics', 'marketing-calendar'], label: '制定调整',
    instruction: '把首周证据转成可在 30 天内验证的经营调整。',
    acceptance: '每项有假设、动作、证据门槛和停止条件。',
    lines: ['- 第 1 周：重排早高峰站位，P90 目标 <4分30秒。', '- 第 2 周：测试午后第二杯半价，不降低首杯价格。', '- 第 3 周：缩短周一至周四晚间营业 1 小时。', '- 第 4 周：按复购、毛利和工时决定是否固化。'],
  },
  {
    key: 'day-30-review', col: 9, row: 2, title: 'G4 · 30 天经营复盘',
    sources: ['day-30-plan', 'month-one-pnl', 'member-data', 'operations-log', 'daily-dashboard'], label: '验证调整',
    instruction: '用首月损益、复购、运营日志和原定看板验证调整是否有效。',
    acceptance: '逐项报告目标、实际、差异与仍无法确认的原因。',
    lines: ['- 日均 118 单，超过首月 115 单门槛。', '- 客单 37.8 元、毛利 68.7%，经营贡献 0.79 万元。', '- P90 出杯降至 4分18秒；燕麦奶报损降至 4.1%。', '- 30 日复购 36%，仍低于下一阶段 40% 目标。'],
  },
  {
    key: 'next-stage-decision', col: 10, row: 2, title: 'G5 · 下一阶段决策',
    sources: ['day-30-review', 'business-targets', 'unit-economics'], label: '决定下一步',
    instruction: '对照 30 天复盘、原始目标和单位经济，决定维持、调整或扩张。',
    acceptance: '结论包含继续投入条件、暂缓事项和下一次复盘时间。',
    lines: ['**维持单店优化，不启动第二店。**', '', '- 首月已经越过现金盈亏线，但贡献不足以覆盖扩张风险。', '- 下一周期重点把复购从 36% 提升到 40%。', '- 连续 8 周日均 ≥125 单且月贡献 ≥1.5 万后再评估第二店。'],
  },
]

function makeCard(definition, origin, sequence) {
  const id = cardId(definition.key)
  const content = { kind: 'markdown', markdown: markdown(definition.title, definition.lines) }
  const createdAt = atMinute(sequence)
  const version = {
    id: versionId(definition.key),
    cardId: id,
    sequence: 1,
    content,
    digest: digestText(`markdown\0${content.markdown}`),
    origin,
    ...(origin === 'ai' ? { sourceRunId: runId(definition.key) } : {}),
    createdAt,
  }
  return {
    id,
    contentKind: 'markdown',
    x: definition.col * columnGap,
    y: definition.row * rowGap,
    width: cardWidth,
    height: cardHeight,
    headVersionId: version.id,
    versions: [version],
    createdAt,
    updatedAt: createdAt,
  }
}

const cards = []
const cardsByKey = new Map()
for (const definition of sourceDefinitions) {
  const card = makeCard(definition, 'human', cards.length + 1)
  cards.push(card)
  cardsByKey.set(definition.key, card)
}
for (const definition of derivedDefinitions) {
  for (const sourceKey of definition.sources) {
    if (!cardsByKey.has(sourceKey)) {
      throw new Error(`${definition.key} references a source that has not been created: ${sourceKey}`)
    }
  }
  const card = makeCard(definition, 'ai', cards.length + 1)
  cards.push(card)
  cardsByKey.set(definition.key, card)
}

function head(card) {
  return card.versions[0]
}

function snapshot(card) {
  const version = head(card)
  return {
    cardId: card.id,
    versionId: version.id,
    contentKind: card.contentKind,
    resolvedContent: version.content.markdown,
    digest: digestText(version.content.markdown),
  }
}

const transformations = derivedDefinitions.map((definition, index) => {
  const timestamp = atMinute(sourceDefinitions.length + index + 1)
  return {
    id: transformationId(definition.key),
    sourceCardIds: definition.sources.map((key) => cardsByKey.get(key).id),
    targetCardId: cardsByKey.get(definition.key).id,
    label: definition.label,
    instruction: definition.instruction,
    acceptance: definition.acceptance,
    permissions: { workspaceWrite: false },
    lastRunId: runId(definition.key),
    lastAppliedRunId: runId(definition.key),
    createdAt: timestamp,
    updatedAt: timestamp,
  }
})

const transformationsByTargetKey = new Map(
  derivedDefinitions.map((definition, index) => [definition.key, transformations[index]]),
)

const runs = derivedDefinitions.map((definition, index) => {
  const target = cardsByKey.get(definition.key)
  const transformation = transformationsByTargetKey.get(definition.key)
  const output = head(target).content.markdown
  const createdAt = atMinute(sourceDefinitions.length + index + 1)
  return {
    id: runId(definition.key),
    boardId,
    transformationId: transformation.id,
    sourceSnapshot: definition.sources.map((key) => snapshot(cardsByKey.get(key))),
    targetCardId: target.id,
    targetBaseVersionId: null,
    intent: 'create',
    createdAt,
    startedAt: createdAt,
    finishedAt: atMinute(sourceDefinitions.length + index + 2),
    status: 'succeeded',
    result: {
      output,
      digest: digestText(output),
      disposition: 'applied',
      appliedVersionId: target.headVersionId,
    },
  }
})

const board = {
  schemaVersion: 2,
  id: boardId,
  title: '11 · 社区咖啡店：调研到开业 30 天（52 卡 / 34 转化）',
  cards,
  transformations,
  viewport: { x: 40, y: 40, zoom: 0.22 },
  createdAt: atMinute(0),
  updatedAt: atMinute(sourceDefinitions.length + derivedDefinitions.length + 2),
}

const boardErrors = validateBoardV2(board)
if (boardErrors.length > 0) throw new Error(boardErrors.join('; '))
if (cards.length !== 52) throw new Error(`Expected 52 cards, got ${cards.length}`)
if (transformations.length !== 34) {
  throw new Error(`Expected 34 transformations, got ${transformations.length}`)
}
if (runs.length !== transformations.length) throw new Error('Every transformation needs an applied Run')

const outputFiles = [
  { path: boardPath, value: board },
  ...runs.map((run) => ({ path: resolve(outputRoot, 'runs-v2', `${run.id}.json`), value: run })),
]

for (const file of outputFiles) {
  try {
    await access(file.path)
    throw new Error(`Refusing to overwrite existing showcase data: ${file.path}`)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
}

for (const file of outputFiles) {
  await mkdir(dirname(file.path), { recursive: true })
  const tempPath = `${file.path}.tmp`
  await writeFile(tempPath, `${JSON.stringify(file.value, null, 2)}\n`, 'utf8')
  await rename(tempPath, file.path)
}

console.log(JSON.stringify({
  boardId,
  title: board.title,
  cards: cards.length,
  transformations: transformations.length,
  appliedRuns: runs.length,
  projectedNodes: cards.length + transformations.filter((item) => item.sourceCardIds.length > 1).length,
  outputRoot,
}, null, 2))
