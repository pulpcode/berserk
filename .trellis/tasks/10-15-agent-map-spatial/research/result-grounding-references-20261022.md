# 成熟Agent经验与本项目的使用边界

整理日期：2026-10-22（Asia/Singapore）。用途：支撑[改进方案第10节](../post-round1-improvement-plan.md#10-r6之后的改进工具做对了也要把过程和结果说对)。本记录整理本次对话已查阅的官方资料及本地证据，不是新增源码审计或外部实验复现；不会把文章经验写成已在本产品验证的结论。

## 1. 外部参考：原文说了什么，我们借鉴什么

| 参考与日期 | 原文支持的事实 | 本项目借鉴方式 | 证据限制 |
| --- | --- | --- | --- |
| [Anthropic：Writing effective tools for agents](https://www.anthropic.com/research/writing-tools-for-agents)，2025-09-11；重点看“Returning meaningful context”及工具评测部分 | Agent可能错误理解工具返回；工具应提供与任务相关、易理解的信息。作者报告语义更明确的标识能减少检索幻觉，并要求用评测选择返回结构 | 核对现有数值、单位、对象、操作状态是否明确；有缺口才补最小投影，不重复返回一份模型摘要 | 这是工具设计经验，不是每种JSON结构都有效的证明；没有本项目保存状态或地理解释错误的改善数据 |
| [LangChain：Improving Deep Agents with harness engineering](https://www.langchain.com/blog/improving-deep-agents-with-harness-engineering)，2026-02-17；重点看“Build & Self-Verify” | 固定gpt-5.2-codex，多项harness调整使Terminal Bench 2.0得分52.8→66.5；包含结束前提醒验证、环境信息和轨迹分析等 | 回答前对照原任务和真实结果；先从失败轨迹定位缺口，再比较候选 | 13.7个百分点是综合改动的成绩，没有单独证明结束检查的收益；不是空间分析正确率，也不能外推我们的90%目标 |
| [Claude Code：Hooks reference](https://code.claude.com/docs/en/hooks#stop)，2026-10-22查阅；另见[Agent-based hooks](https://code.claude.com/docs/en/hooks#agent-based-hooks) | Stop在主Agent响应结束时触发，能够要求继续；Agent hook可检查文件等实际证据。当前文档标明Agent hook为实验功能，生产流程优先考虑command hook | 借鉴“可验证条件接入执行流程”的边界；先离线验证具体检查规则，必要时再评审在线接入 | 是公开接口文档，不是完整Claude Code内核源码；用户配置的hook不代表默认已审查所有回答。Stop不证明此前可见文字被拦截 |
| [Anthropic：How we built our multi-agent research system](https://www.anthropic.com/research/multi-agent-research-system)，2025-06-13；重点看架构中的CitationAgent | 研究报告与来源交给引用处理步骤，定位论断对应的出处 | 将本项目重要数字和状态对应到具体结果、动作回执与版本；先用于离线评分和解释方法 | 引用对应不等于内容绝对正确；文中整体多Agent收益不是引用步骤的独立收益。本轮不照搬多Agent架构 |
| [Anthropic：Demystifying evals for AI agents](https://www.anthropic.com/research/demystifying-evals-for-ai-agents)，2026-01-09；重点看outcome、conversational/research agents | 区分环境中的真实结果与Agent声称完成的结果；研究型回答可检查论断依据、覆盖度、来源质量，并用专家判断校准模型评分 | 主任务、过程解释、最终解释、真实修改分别评分；记录证据和时间，校准误判；保持固定分母 | 不是照搬关键词或要求固定工具调用序列；原文没有替我们规定90%门槛，也没有证明模型评审不会误判 |

这些资料共同支持“减少含糊工具信息、使用实际证据验证、检查完整交互”的方向。它们没有证明通用正确性拦截器已经成熟，也没有证明增加一次模型自检必然提高本项目成绩。引用链接为官方现行页面，可能后续更新；实施时核对相关段落，不沿用未验证的具体API假设。

## 2. 本项目证据：哪些事实已经确认

本轮代码核对基线为main与旧空间分支共同提交`6ce86513022350fb752eaa3dc04a96a5d2d82a6e`。本节只读检查，未改代码。

| 证据位置 | 能确认什么 | 对设计的约束 |
| --- | --- | --- |
| [R6完整报告](r6-results-20261022.md)及[语义复核](r6-semantic-check-20261022.md) | D17-E2先误述宽度，后续分类正确；D16-E0误称只在内存，但当时原生JSONL已有完整结果 | 不归因于分类算法；必须覆盖过程说明；草稿状态不能代替持久化状态 |
| [主线集成记录](main-integration-management-20261022.md) | 当前集成版本包含新工具、目录入口和宿主变化；E1/E2正文仍未正式采用 | 新对照基准不能直接沿用R6旧E0；没有新的完整组合模型成绩 |
| [空间契约及投影](../../../../experiments/harness-lab/src/contracts/spatial.ts)的SpatialResult、projectSpatialResult | 当前已有实际范围、数量、方法、限制、单位等字段；模型投影保留分析事实并去除几何转抄需求 | 先核对真实收到的字段，不默认新建事实摘要、计算宽度或重写持久协议 |
| [空间工具](../../../../experiments/harness-lab/src/pi/spatial-tools.ts)的spatial_analyze、annotation_from_analysis | 分析与保存分开；保存复用回执、读取依据、版本与不确定结果处理 | 不把分析成功说成草稿已保存；不确定结果不能用简单成功/失败代替 |
| [标绘返回适配](../../../../experiments/harness-lab/src/pi/annotation-results.ts)及[回执契约](../../../../experiments/harness-lab/src/contracts/annotation-results.ts) | 模型文本投影和界面原始回执已有分离；回查、重放及写入有来源区别 | 复用现有结果展示和真实回执，避免第二份由模型维护的状态 |
| [宿主说明](../../../../experiments/harness-lab/src/pi/lab.ts) | 已有Skill选择/读取约定，以及业务交接必须依据回执的局部规则 | 如果试验通用表达约定，应在现有机制内做最小改动并独立对照，不新增提示词框架 |

“现有字段能够提供某事实”与“模型可靠使用该事实”是不同问题。若真实轨迹已经包含完整字段但模型仍误述，应归入理解、遵循或表达问题，不能为了让工具背锅再加重复字段。

## 3. 本轮确定保留与等待验证的内容

- 保留现有空间能力、主线结果投影、真实写入回执和版本检查；不建设通用范围凭证。
- 拟验证：短Skill流程是否减少无关估值与状态混淆，必要的返回值澄清是否帮助模型，未读Skill时一条通用宿主约定是否有收益。
- 首先改离线评测的证据核对；通用在线审核Agent、完整输出缓冲、逐句拦截和新增持久化体系均不在本轮默认实施范围。
- 需要另行批准：任何产品/Skill/评测代码实施、模型调用预算、可选宿主对照、在线验证方式，以及最终采用与部署。本轮只整理文档和分支，不运行测试。
