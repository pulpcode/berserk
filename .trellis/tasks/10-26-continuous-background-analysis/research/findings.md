# 并行研究与设计依据

日期：2026-10-26。基线 `6ce86513022350fb752eaa3dc04a96a5d2d82a6e`。三位只读研究代理分别核对后台、Pi、交互；主代理汇总。没有产品代码改动、模型调用或线上访问。

## 1. 后台执行研究

- `experiments/harness-lab/src/contracts/background.ts:7`：只有 preprocess、seat_analysis 两种 job。
- `experiments/harness-lab/src/background/service.ts:233`、`:690`：预处理按事件创建 job/session，并构造当前事件＋Profile输入；无上一任务判断基线。
- `experiments/harness-lab/src/background/store.ts:137`、`:140`：jobs/deliveries 均强绑定单 event/source，批次不可借第一条事件代替授权。
- `experiments/harness-lab/src/background/store.ts:409`：running 恢复为 interrupted，不自动重放。
- `experiments/harness-lab/src/background/service.ts:160`：内容权限依赖来源／投递与scope；新多来源历史须组合校验，静默结果须有明确读取路径。
- `experiments/harness-lab/src/background/service.ts:749`：已有队列并发和领取，可扩充输入与kind，不需第二个运行时。

推荐固定共同权限的持续配置，合并批次后一次原生请求分析多个任务；不引入固定两段模型流水线。必要新元数据是配置/session归属、批次输入、已发布结果引用和通知；正文仍原生历史。

## 2. Pi与业务背景研究

- `experiments/harness-lab/package.json`：Pi固定0.85.1。
- `experiments/harness-lab/src/pi/lab.ts:388`：预处理一job一session；正常对话已有公开SessionManager/createAgentSession的多轮使用。
- `experiments/harness-lab/src/pi/lab.ts:730`、`experiments/harness-lab/src/background/task-links.ts:133`：可复用已查询任务revision的观察与校验方式。
- `experiments/harness-lab/src/contracts/access.ts:29`：任务只有title/goal/context/state等元数据，无正式计划或执行进度正文；goal可容纳人员明确维护的条件，context仅refs/focus。
- `experiments/harness-lab/src/contracts/task-information.ts:11`：TaskAssessment是任务归属记录，不是持续业务研判。

推荐保留Pi原生多轮和默认压缩；宿主记录业务已发布引用，不以历史末尾assistant冒充当前。失败/中断之后的分支恢复仍需后续本地最小验证，不能写成现成可靠能力。 task.goal改变是新的业务条件，不能因此重置连续分析；Profile目标或授权改变则新配置代次隔离。

## 3. 桌面交互研究

- `experiments/harness-lab/src/web/TaskHome.tsx:29`、`TaskInformation.tsx:48`：现有任务首页和相关信息可承载当前研判，不需新全局导航。
- `experiments/harness-lab/src/web/InformationCenter.tsx:78`：规则、接收与队列控制在工作总览；已有入口可以增加持续模式。
- `experiments/harness-lab/src/web/InformationContinuation.tsx:112`：用户显式接续到本席位对话；不能让后台往用户输入框注入消息。
- `experiments/harness-lab/src/web/Inbox.tsx:91` 与 `.trellis/spec/backend/workbench.md:19`：办理状态需要人员明确操作；阅读或执行完成不代表已处理。
- `.trellis/spec/backend/task-information.md:26`：任务可见不等于来源内容可见；固定event/job引用不能静默换最新。
- `experiments/harness-lab/src/web/styles.css:800`、`:1040`：已有列表/详情宽度约束；不新增第四常驻栏，只做桌面窄容器适配。

建议当前页显示最新研判与资料截止，历史链接固定版本；自动更新保留选择、滚动、草稿与焦点。无变化静默更新不能同时保留每条原始来报的待办，否则只是新增一层提醒。首期配置覆盖来源与公共任务，不把逐任务订阅入口误记成用户已批准。

## 4. 已排除的假设

- 用户只明确认同自动接续原则，并未逐项批准订阅界面、合并秒数、自动正式业务动作。
- 不能把来源allowedRecipient、公共任务管理权限或某一来源view单独视为多来源混合结果授权。
- 不能把私有方案文件或聊天自动作为公共任务背景。
- 不能强制所有变化属于既有任务；零任务关联也可能有重要信息。
- 不能将未列出任务当成无变化，不能把投递成功当成判断正确。
- 不能把原生多轮可用推导为任意中断自动恢复已经可用。

## 5. 规划检查状态

研究结论已进入prd/design/implement，经过第二轮只读审查并修正文档问题。文档结构、Markdown链接、上下文清单路径、JSON、12项需求与11项验收编号检查通过。当前仅新增本任务8个文件；task状态为planning。原主工作区仍在main，原两项未跟踪部署记录保持不变。产品测试、真实模型评估与浏览器验收均未在本轮执行。

## 6. 第二轮方案审查修正

- 补充配置代次最新已发布引用及有界历史查询，确保无任务归属的结果在恢复后仍可读。
- 保留处理中说明与最终答复的界限，禁止将中间断言提升为当前结论。
- 补充固定接收者的研判记录入口，静默且无任务的结果也能找到；此入口不开放来源管理或跨席位工作总览权限。
- 任务修订与待处理输入须同事务登记，防止崩溃丢触发。
- 受控历史读取明确包含当时成功来源查询证据，不只读取模型转述。
- 任务修订输入必须被该任务的明确更新覆盖；漏评暂停待核对，资料不足和归档有明确结果，不无限重排。
- 普通失败、主动取消和中断统一保留输入并暂停所属代次，旧代次不再吸收新修订。
- 提醒条件统一为任务重要变化或未归属重要变化；重要提醒仍是需人工结清的独立待办，已明确告知取舍。
