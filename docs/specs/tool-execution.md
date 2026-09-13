# 步骤工具、MCP 与 Python 执行契约

2026-09-14：用户确认完整设计并要求一次完成剩余实施。本规格落实产品定义 §5.13；普通 Run/CAS/Candidate 不变，不增加工作流引擎。实际验证与不可用平台分别记录。

## 对象与范围

步骤可选 `toolPolicy: { tools, allowTemporaryPython }`；tools 为最多 8 个有序配置，每项 `{id,tool,phase,arguments,urls?}`，phase 为 before/model/after。tool 快照包含稳定 id、title、description、source（builtin/mcp/python）、version（定义摘要）、name、inputSchema、phases 与 effect（read/review/check）；非内置项另含 bindingId，需重新绑定时标 requiresBinding。显示名称不能用于绑定。同工具不同阶段为不同实例。

内置能力：冻结材料检索、数字运算、CSV 摘要、明确 URL 网页读取和正文检查。工具只得到 Run 冻结来源片段、显式参数及 after 阶段的实际输出；不得补读未选正文。网页仅访问 urls 中明确列出的精确 URL，沿用既有公开网页读取器与跳转校验。

Skill 可明确声明 requiredTools/optionalTools（能力 id 列表）；缺必需依赖允许保存计划但阻止 Run。配置、连接发现、方法应用均零 Run。模型按需只对声明支持工具的适配器开放，不支持时创建 Run 前失败，不静默撤下已选能力。

## 能力管理与适配器

宿主保存独立 `capability-settings-v1.json`（新项目位于 `.mira/`），revision CAS、临时文件校验后原子 replace。内容为连接、发现目录、已审阅脚本与项目启用列表，不属于可移植内容。凭据仅保留当前 Host 内存，API 只返回 hasCredential，UI 明示“仅本次会话，重启重填”；连接配置和凭据不进入任何数据包。

MCP 支持 Streamable HTTP 与 stdio。明确测试连接才握手、分页列工具或启动本地程序，不调用业务工具。stdio 展示程序/参数/目录/环境变量名，不继承宿主秘密环境。远程地址不内嵌凭据，禁止重定向携带认证。不自动安装服务、登录、启用新工具。连接成功、项目逐工具启用和本步选择是三个状态。schema/连接变化使旧快照失效；断开保留历史。

未经验证的 MCP 注解不作为宿主只读保证，默认 effect=review。用户明确核对并标只读后，仅对本步固定绑定参数自动调用；模型不能修改这些参数或扩大范围。其他调用须逐次审阅实际请求。SDK/网络/进程只在 Node 适配器内。

`createMcpClient()` 返回 `discover(connection,{signal}) -> {tools:[{name,description,inputSchema,annotations?}]}`、`call(connection,name,args,{signal}) -> {text,isError?}`、`close()`。connection 为 `{id,transport:'http'|'stdio',url?,command?,args?,cwd?,env?,token?}`；env/token 只供宿主。发现最多 100 工具/10 页，响应最多 1 MiB，业务文本最多 64 KiB；所有操作可取消并限时。

Python 使用明确准备的 Docker Linux 镜像及 immutable image ID，运行时不得 pull/install。下载镜像与依赖准备是独立显式操作；镜像、Docker、Linux 与隔离探针不满足时显示不可用。普通 subprocess 或 venv 不构成隔离。脚本登记保存全文、摘要、schema、环境 ID 和版本；更新追加版本，执行核对摘要，测试不创建 Run/Card。

`createPythonRunner()` 返回 `status({image?}) -> {available,reason?,imageId?,runtime?}`、`prepare({image,dependencies?},{signal})`、`execute({code,input,imageId,timeoutMs?},{signal}) -> {text,files?:[{name,mimeType,data}]}`，data 为 base64。input 为 `{sources:[{text}],arguments,output?}`；脚本从 stdin 读 JSON，stdout 为正文或 `{text,files}` JSON。代码与输入经本次 stdin 进入容器，不读真实 workspace。准备依赖不得使用 shell 插值。

容器无网络、无宿主目录/Docker socket 挂载、根只读、非 root、drop-all capabilities/no-new-privileges，512 MiB 内存、1 CPU、32 进程、16 MiB 临时目录；时间和 stdout/stderr 有界。停止/超时移除仅本次随机身份的容器。附件仅 PNG/CSV/TXT，单个 1 MiB、最多 4 个；先预览再明确下载，不自动写 workspace。实际 Docker 隔离探针验证宿主哨兵、网络、根写入均被阻止。该保障不声称防御内核漏洞或恶意 Docker daemon。

## 运行、审阅与预算

每 Run 最多 8 次工具、4 轮模型工具响应；单工具 30 秒（最大 60 秒）、总执行 5 分钟、等待审阅最多 10 分钟且独立计时。before 失败停止；model 确定失败结构化回传模型并消耗次数；after 检查不通过保留正文和诊断。外部调用不确定立即停止，不盲重放。停止取消在途调用，迟到结果不得写 Head。

临时代码默认关闭；开启仅允许模型提出代码。代码或外部操作执行前 Run 保持 running，phase=awaiting-review，显示唯一 requestId、能力版本、精确参数/范围、完整代码（如有）、环境及资源限制。批准绑定 Run/requestId/内容摘要，消费一次；拒绝、停止、超时和重启使批准失效。批准仍不能越过本步已选能力集合。外部副作用不会因停止而回滚。

Run 冻结 toolPolicySnapshot；toolExecutions 保存真实开始/成功/失败与检查结果，公开 progressEvents 继续只保存最近 20 条脱敏摘要。review 单独展示，不把完整参数塞入 progress。每条证据最多 64 KiB 文本、32 KiB 参数，整 Run 512 KiB；超限明确失败，不把截断当完整。认证、环境秘密、模型思维不持久化。协议要求回传的 reasoning 只存在当次内存。

## 可移植性与验收

方法只保存能力需求、阶段与顺序，不保存具体参数/URL/机器绑定/批准，应用后待绑定。BoardArtifact/Checkpoint 副本中的非内置能力标 requiresBinding，不能按同名资源重绑。完整备份保留步骤需求与历史证据，不安装连接/脚本/凭据；缺资源阻止执行。附件从所有可移植包省略并明确标记，允许留存的有界文本证据随 Run 保留。旧数据缺工具字段合法。

错误：TOOL_POLICY_INVALID (422)，TOOL_UNAVAILABLE / TOOL_CHANGED / TOOL_DEPENDENCY_MISSING / MODEL_TOOLS_UNAVAILABLE / CAPABILITY_CONFLICT / REVIEW_CONFLICT (409)；MCP_AUTH_REQUIRED / MCP_UNAVAILABLE / MCP_INCOMPATIBLE、PYTHON_UNAVAILABLE、TOOL_TIMEOUT / TOOL_LIMIT / TOOL_FAILED / TOOL_OUTCOME_UNKNOWN / REVIEW_EXPIRED 明确区分。配置失败保留草稿，证据写失败停止执行，不继续下一工具。

必须验收真实本地 HTTP/stdio MCP、发现分页/schema 变化/认证失败/取消/超限；真实 Docker 允许输出和拒绝越界、超时清理；本地模型 HTTP 服务的完整 tool_call_id 往返；普通 Run 前后阶段、拒绝/重复批准/超时/停止/重启、人工 Head 冲突、存储故障及可移植秘密排除。真实桌面/1024/390 检查目录、范围、排序、等待审阅、长代码、错误恢复、焦点和 console。Windows/Intel 没有原生证据不得标通过；无 Docker 的宿主仍可配置并得到明确不可用。
