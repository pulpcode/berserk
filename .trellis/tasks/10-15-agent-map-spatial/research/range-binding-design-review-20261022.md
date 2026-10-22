# 范围约束设计：公开源码依据与适用边界

审视日期：2026-10-22。关联方案：[空间分析改进方案](../post-round1-improvement-plan.md)。本文件归档本轮已经完成的只读源码/文档审视，不代表已实施任何候选，也不构成外部项目效果评测。

## 1. 研究边界

查阅对象是Codex CLI、Claude Code、DeepSeek Harness、Hermes的工具执行、修改前置条件、用户交互和授权检查。下面区分可直接观察的实现事实、对本项目的推论与不能保证的事项；没有对四个项目进行全仓审计、安装运行或对照测评。

链接使用审视时的官方main/master分支。它们会变化，不是不可变版本快照；未来实施应重新核对对应文件和提交。Claude Code官方仓库的公开材料不能当作完整运行内核源码，其核心行为依据官方文档、公开Hook示例；不使用泄露源码或第三方逆向材料。DeepSeek Harness官方明确标为developer preview，不能把四个项目统称为同等成熟、已验证可靠的架构标准。

## 2. Codex CLI

**源码事实：**

- [`codex-rs/apply-patch/src/file_update.rs`](https://github.com/openai/codex/blob/main/codex-rs/apply-patch/src/file_update.rs)：`derive_new_contents_from_chunks`读取实际文件，`compute_replacements`查找上下文和旧行，无法匹配返回错误。这是补丁可应用性的检查，不是证明文件正是用户意图中的目标，也不声称所有匹配必须唯一。
- [`codex-rs/core/src/tools/orchestrator.rs`](https://github.com/openai/codex/blob/main/codex-rs/core/src/tools/orchestrator.rs)：协调审批、沙箱选择和拒绝后的重试；提升执行权限可能需要重新审查。
- [`codex-rs/prompts/templates/guardian/policy_template.md`](https://github.com/openai/codex/blob/main/codex-rs/prompts/templates/guardian/policy_template.md)：结合对话评估单次动作风险、目标及副作用授权；区分可信用户内容与工具/助手内容。其主要目标是安全风险和授权，不是回答正确性。
- [`codex-rs/core/src/tools/handlers/request_user_input.rs`](https://github.com/openai/codex/blob/main/codex-rs/core/src/tools/handlers/request_user_input.rs)：通过session交互接收并返回用户回答，取消时不伪造答案；启用Guardian时相关回答可进入授权上下文。

**可借鉴：**检查应能指向真实输入/状态，错误有明确恢复路径；用户授权不能由助手自述替代。**不能类推：**Guardian含语义判断，不是纯确定性证明；风险审批通过或补丁上下文匹配，均不意味着业务任务选对对象。不能据此增设通用地理意图审批层。

## 3. Claude Code

**公开事实：**

- [官方运行机制](https://code.claude.com/docs/en/how-claude-code-works)：模型依据请求及工具反馈收集上下文、采取动作和验证结果；Skill说明按需加载。
- [PreToolUse文档](https://code.claude.com/docs/en/hooks#pretooluse)：可由扩展检查参数并作允许/拒绝/询问等决策，拒绝理由进入反馈；这是可扩展入口，不是内建通用用户意图判定器。
- [公开Bash验证示例](https://github.com/anthropics/claude-code/blob/main/examples/hooks/bash_command_validator_example.py)：`_validate_command`按具体模式检查命令，`main`以退出码2阻止调用并给出理由。该文件仅为示例，不能据此概括所有内部工具策略。
- [官方权限文档](https://code.claude.com/docs/en/permissions)：权限模式、规则及部分自动分类负责动作安全边界；不能作为语义正确性报告。

**可借鉴：**模型探索与明确工具规则可协作，局部检查须有可解释原因。**不能类推：**有Hook或自动审批不等于能证明“自然语言中的救援资源指的是A”。没有完整官方内核源码支持时，不声称已核实其全部目标绑定实现。

## 4. DeepSeek Harness

**源码事实：**

- [`packages/core/tools/src/index.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/core/tools/src/index.ts)：工具执行有pre-execute、guard、execute、post-execute和result等阶段；`guardReason`返回拒绝原因，后续执行阶段保留该拒绝。框架提供检查位置，具体语义由策略作者定义。
- [`packages/fs/fs-observation-policy/src/index.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/fs/fs-observation-policy/src/index.ts)：`ObservedStateGate`按owner和target记录未观察、已确认不存在或某个已观察版本；`editIntent`要求已有观察，`writeIntent`选择createIfAbsent或replaceIfVersion。原子版本检查由provider执行。
- [该策略README](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/fs/fs-observation-policy/README.md)明确：约束保证的是版本新鲜度，窗口读取也可作为后续写入依据，并不保证视图完整性；观察状态不持久化，恢复会话后需要重新观察。
- [官方项目说明](https://www.deepseek.com/harness/en/)标为开发者预览，仍在快速演进。

**可借鉴：**精确限定检查保证；将稳定错误与恢复说明交给模型，复用已有状态与执行后端。**不能类推：**读取过文件不代表选对文件；读取过图层也不代表用户指定了图层。本项目没有采用其插件架构的必要，更没有据此新增范围令牌或持久化目标状态的效果证据。

## 5. Hermes

**源码事实：**

- [`tools/file_tools.py`](https://github.com/NousResearch/hermes-agent/blob/main/tools/file_tools.py)：`write_file_tool`在写入前调用`_stale_overwrite_blocker`；返回实际解析路径等信息，让执行位置可以核对。
- [`tools/file_tools_write_guards.py`](https://github.com/NousResearch/hermes-agent/blob/main/tools/file_tools_write_guards.py)：`_stale_overwrite_blocker`检查过期信息及整文件覆盖基线，`_stale_write_refusal`说明文件未修改并提供恢复路径。该机制有新文件、无法解析路径及配置等分支，不应宣传为所有写入路径都具备绝对保证。
- [`tools/clarify_tool.py`](https://github.com/NousResearch/hermes-agent/blob/main/tools/clarify_tool.py)：`clarify_tool`通过平台callback取得回答；`_result`/`_response_status`区分answered、skipped、unanswered，未回答时user_response为空；描述将澄清与危险命令确认分开。

**可借鉴：**真实交互结果和操作效果应结构化保留，错误说明避免把失败写成成功。**不能类推：**回答来自用户只能证明用户回答了所呈现的问题，不能证明模型问题中的候选或前提正确；读取/写入基线也不能证明业务目标理解准确。

## 6. 对本项目的结论

### 6.1 撤回通用范围凭证的原因

1. 模型选错对象后仍可取得真实引用，凭证检查只会把错误转移到上游；模型生成的选择理由不构成独立证据。
2. 仅容许用户点选/唯一名称/澄清选择，会排除合法推导集合、跨层探索和连续计算。
3. 未经证明增加读取步骤、持久化状态或审批，会带来误阻断、恢复和交互负担。
4. 模型仍可能手算或把多个正确结果解释错；局部调用检查不是完整答案正确性的保证。

### 6.2 可保留的局部检查

真实对象与来源身份、固定版本和结果成员、实际权限、明确工具输入的唯一匹配要求、写入读取依据、并发版本和真实动作回执，均有程序可判断的条件。现有实现先复用：

- [名称解析](../../../../experiments/harness-lab/src/annotations/service.ts)：`read`对layerNames执行精确解析，多匹配返回歧义；直接layerIds是另一种合法输入，不等于用户明确授权。
- [空间输入](../../../../experiments/harness-lab/src/spatial/inputs.ts)：固定来源、版本和结果读取，检查对象成员及几何/原对象选择。
- [计算结果](../../../../experiments/harness-lab/src/spatial/service.ts)：保留实际scope、parameters及计算事实。
- [分析保存](../../../../experiments/harness-lab/src/pi/spatial-tools.ts)：复用已有读取依据、权限、并发版本和真实resultRef保存。

若提出新的排他范围检查，须另外证明现有宿主数据能独立表达用户约束、对象角色、有效轮次和合法派生关系。仅有自然语言和模型提取结果时，不声称已有可信硬边界。消息引用和地图选中通常只是上下文，不能默认成为排他白名单。

### 6.3 尚需自行建设与验证

外部源码不提供地图同名对象任务的现成正确率证据。仍需本项目建立条件回答与必要澄清判例、跨会话身份回归、实际Skill触达审计、误阻断/无必要提问指标，以及全文事实与实际效果的独立评分。模型、Skill、工具分别对照，正式总体及未见保留集90%目标不变；本次审视不授权新调用或新预算。
