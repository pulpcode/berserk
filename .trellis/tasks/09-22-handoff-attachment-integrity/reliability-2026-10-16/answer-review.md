# A/B 可见回答与工作目标独立复核

状态：固定 50 例全部完成独立语义复核。只读证据，无模型调用、无产品修改。

## 口径

证据为 `.local/handoff-ab-20261016/review-packet.json`（前 40 例曾先保存在 `review-packet-first40.json`），由原始隔离目录 `axon-handoff-ab-XKdWxo` 的原生记录生成，完整原始资料亦保存在 `.local/handoff-ab-20261016/evidence/`。逐例检查首轮、分派轮、接收轮的全部可见助手文本、问题卡和实际保存 goal；需要时核对工具原始结果及 provider 输入。组别 A/B 与实际业务中的席位 A/B 是不同概念。

- `factual_error`：存在可由当前来源、工具说明、实际回执证伪的断言；区分实质与轻微。
- `uncertain`：有歧义或不够严谨，但存在合理解释，不硬计为明确错误。
- `no_clear_error`：未发现明确事实错误；不代表操作完成、没有多问或已达到用户目标。
- 不把“需要我下一步继续吗”等顺手建议自动算事实错误；额外确认由主报告独立判读。格式、友好语气、拟定标题和合理交付细化不自动算目标漂移。
- 评价当时状态：A 分派回答时 `assigned/revision 1` 正确；驱动随后签收使接收阶段变为 `working/revision 2`，不能倒用后时状态判错。
- `goal` 与用户意图的偏差单列。准确复述一个有问题的 goal，不等于正文转述错误；成功交接也不等于目标语义正确。

## 汇总

| 全部可见回答，按案例去重 | A（25 例） | B（25 例） |
| --- | ---: | ---: |
| factual_error：实质错误 | 1 | 3 |
| factual_error：仅轻微错误 | 4 | 6 |
| uncertain：措辞/证据边界 | 4 | 2 |
| no_clear_error | 16 | 14 |

同一例多次错误只计一例；实质与轻微互斥，以较严重者归类。A 的实质错误为 `none-1`；B 为 `original-1`、`one-3`、`ambiguous-3`。两组均未发现“没有分派却说分派完成”。所有 10 个真歧义案例均问清目标并未尝试分派；B/ambiguous-3 的错误完成选项不抹去其正确澄清目标，但仍记回答错误。

这不是可以直接比较的总体准确率：A 仅 9 例有接收读取轮，B 有 12 例，回答数量及出错机会不同；也不能从单批次认定改说明导致回答变差。可以确定的是：本次改善分派调用不能等同于回答与 goal 也全面可靠。

## 已确认的实质问题

1. **A/none-1：新建分派前提说错。**请求 `8a1016e3-e04f-4708-b490-6711d30cdbee` 中说“分派动作需要工作编号和 expectedRevision”“没有可用的分派入口”，问题卡要求用户先建工作。实际 assign schema 不含这两字段，原工具泛化说明与分支 schema 存在歧义，但错误前提仍是可证伪的。
2. **B/original-1：把额外业务要求说成来源要求并写入工作。**首轮 `8b532ddc-cf6d-42e0-820c-b0bb3bbf7dd7` 在来源归纳中增加“含双方核对/签字确认”；来源只要求“双方核对书面记录”。分派 goal 的“必须满足”又要求体现“双方核对/签字确认”。签字不是版式细化，会增加业务义务；斜杠含义不够明确，但不能据来源认定签字是必做要求。
3. **B/one-3：把文件保留与旧条款保留混成歧义。**首轮 `1700e0ce-c012-4b62-8e91-c1981ed51131` 先正确说明“替换而非补充”，随后又说“保留初稿”可能意味着修订稿保留旧句、“实施时需要你确认”。来源“保留初稿，将修订稿另存”表达的是原文件保留，未要求修订稿保留旧规则。这项模型制造的分歧被保存进 goal，允许“保留旧说明文字，另加新要求”。尚未执行修订，不能宣称最终文稿已错误。
4. **B/ambiguous-3：问题卡提供不受支持的完成方式。**请求 `93385827-8e8d-47e3-a7ff-a4a130422202` 的 reviewer 问题提供“由 B 自行确认完成即可／不设席位 A 验收环节”。现有状态机只有创建方 review 当前提交才能 completed；未有选择改变权限/工作流的机制。该例正确停在对象澄清，但问题卡仍有错误能力描述。

## 轻微错误与边界

- A/one-2 接收回答（`29a525e5-7f68-46ed-b41e-e32d4aad144c`）把 hash 尾部抄为 `12debb`；实际结果为 `12deeb`。实际文件及导入正确，是不必要技术字段转述错误。
- A/ambiguous-1 说两份文件“除标题外一字不差”，A/ambiguous-5 说“正文除标题外完全相同”，实际 `测试文稿：…` 一行的名称也不同；轻微来源比较错误。
- A/original-4 把两行测试声明说成“一行”；B/one-1、B/original-2、B/original-4、B/paraphrase-4、B/one-4、B/original-5 把四行初稿说成三行。部分后来在接收轮正确列出四行，不抹去前轮错误；不据此声称业务交接失败。
- A/paraphrase-1 完成后写“等待网页确认后执行，回执为已提交”，并说成果会“回到本工作区”。前后包含已完成信息，也提到取回，属于状态/导入措辞歧义，暂不硬计错误。
- A/paraphrase-2 接收回答同时写 `working/revision 2` 和“未签收、未产出、未提交”。若“未签收”指工作状态则错误；若指本轮模型未主动签收则属实（驱动已签收）。保留原句为歧义，不用最终状态反推之前答复错误。
- B/paraphrase-1 把 168 字节写为“167 字节左右”，精确性差但有近似限定，暂列歧义而非硬错。
- B/paraphrase-3 接收答复称“初稿与修订要求在要求上互相一致”，A/paraphrase-5 称“两份资料内容互相一致”，旧规则与新要求本来不同；也可能指修订对象/流程相容，列歧义。
- A/paraphrase-3 “正文共三行要点”后列三个归纳项，未明确声称文件只有三行，不与上述“只有/共三行”硬错混算。B/original-3 把标题单列后列正文第 1–3 行，同样不硬计错。
- B/paraphrase-5 把测试声明概括为“一句”，没有按物理行作精确断言，未因此记行数错误。A/one-5 接收前称文件需导入，而宿主已自动放入目录；随后调用合法幂等导入并按回执读取，没有虚报某次执行，不据此硬记失败。

**hash 核验的证据边界：**A/paraphrase-2、B/paraphrase-3 声称名称、大小、hash 与 inputFiles 一致；当轮只有工作详情、列目录/查找和 read，没有返回本地 hash 的命令或导入回执。实际 provider 系统上下文只列原始 inputFiles metadata，没有本地 hash 核验结果。其文件实际上正确，但不能拿驱动离线比对替模型证明“已核验”；这两例列入 uncertain 证据范围问题。其他调用成功 `handoff_import_file` 的案例获得同一 fileId 的实际导入 hash/size，可与 inputFiles 比较，不要求模型再自行算 hash。

## 已保存 goal 的偏差或风险

| 案例 | 结果 | 说明 |
| --- | --- | --- |
| B/original-1 | 实质新增要求 | “必须满足”中的签字确认不见于来源；已进入分派，未执行到文稿产出。 |
| B/one-3 | 无依据增设决策事项 | 把原文件保留误引为保留旧条款的歧义，并要求接收方处理。 |
| A/none-4 | 后续工作流冲突 | goal 明确“不需要生成任何文件、直接在回复给文本”；现 submit 必须交文件。回答如实复述，不能算虚报执行，但完整闭环会受影响。 |
| A/none-5 | 后续工作流冲突 | goal “成果直接在回复中以文字给出，不必生成文件；在回复中列出最终文字即可”，与文件型正式提交的要求不一致。尚未执行到提交，不声称已发生提交失败。 |
| B/none-4 | 后续工作流冲突 | goal “以文本形式提交，不要创建或引用任何附件文件”，与文件型 submit 冲突。正文准确复述该约束。 |
| A/none-3 | 交付形式风险 | “直接给出正文、不需要附任何文件”可理解为不附输入，也可引向纯聊天交付；无明确禁生成文件，不与上两项等量判错。40 字限制是自定细化，未单独计为严重错误。 |
| A/one-3 | 约束扩大 | 源要求“不查询外部制度”，goal 扩为“不查询或引用任何外部制度/资料”。此小任务不需要外部资料，但不应称此扩大限制来自原文；列风险，未见阻碍已测交接。 |
| 其余成功分派 | 未见明确实质偏差 | 常见拟定标题、示例格式、输出根目录、简短改动说明等作为合理实施细化；未把每项自定表达都算错误。 |

按成功分派分母单列：A 的 13 个已保存 goal 中有 2 个明确后续交付冲突（none-4/5），另 2 个风险（none-3、one-3）；B 的 17 个中有 2 个业务要求偏移（original-1、one-3）和 1 个后续交付冲突（none-4）。此计数与回答事实错误有交集，不能相加成独立失败次数。

## 逐例表（全部 50 例）

| 案例 | 回答判读 | 备注 |
| --- | --- | --- |
| A/original-1 | no_clear_error | 停止多问；未虚报已分派。 |
| B/original-1 | factual_error | 实质：来源要求加签字；goal 同步漂移。 |
| A/paraphrase-1 | uncertain | 已执行与待确认措辞混合；成果导入表述不清。 |
| B/paraphrase-1 | uncertain | 168 字节转述为约 167。 |
| A/one-1 | no_clear_error | 回执、附件、读取一致。 |
| B/one-1 | factual_error | 轻微：首轮四行说三行。 |
| A/none-1 | factual_error | 实质：assign 错误要求已有工作。 |
| B/none-1 | no_clear_error | 说明自拟要求，文件交付可行。 |
| A/ambiguous-1 | factual_error | 轻微：除标题外“一字不差”不实。 |
| B/ambiguous-1 | no_clear_error | 未假定对象执行。 |
| A/original-2 | no_clear_error | 停止多问；未虚报完成。 |
| B/original-2 | factual_error | 轻微：接收轮四行说三行。 |
| A/paraphrase-2 | uncertain | working 与“未签收”主语歧义。 |
| B/paraphrase-2 | no_clear_error | 分派和读取摘要有依据。 |
| A/one-2 | factual_error | 轻微：hash 尾部抄错。 |
| B/one-2 | no_clear_error | 首轮提醒可澄清，但无错误事实。 |
| A/none-2 | no_clear_error | 文件交付目标与答复一致。 |
| B/none-2 | no_clear_error | 文件交付目标与答复一致。 |
| A/ambiguous-2 | no_clear_error | 问清对象，没有错误执行声明。 |
| B/ambiguous-2 | no_clear_error | 未读要求如实标明。 |
| A/original-3 | no_clear_error | 多余确认单独计数。 |
| B/original-3 | no_clear_error | 排除标题的正文编号不算行数硬错。 |
| A/paraphrase-3 | no_clear_error | 参数重试如实说明；三项摘要不算原文行数。 |
| B/paraphrase-3 | uncertain | “初稿与要求一致”语义不清。 |
| A/one-3 | uncertain | 把不查制度扩大为不引用任何外部资料。 |
| B/one-3 | factual_error | 实质：制造文件保留/条款保留歧义。 |
| A/none-3 | no_clear_error | 准确复述 goal；交付形式风险另列。 |
| B/none-3 | no_clear_error | 文件交付，未见误述。 |
| A/ambiguous-3 | no_clear_error | 内容一致作概述，分别列出名称；未作逐字相同断言。 |
| B/ambiguous-3 | factual_error | 实质：提供 B 自行确认完成选项。 |
| A/original-4 | factual_error | 轻微：两行测试声明说成一行。 |
| B/original-4 | factual_error | 轻微：两轮均将四行说三行。 |
| A/paraphrase-4 | no_clear_error | 未分派如实呈现，额外问题单列。 |
| B/paraphrase-4 | factual_error | 轻微：首轮行数错；“我这边签收”另有角色措辞风险。 |
| A/one-4 | no_clear_error | 接收导入路径经实际 import(path) 验证确为根目录。 |
| B/one-4 | factual_error | 轻微：首轮四行说三行并漏测试文稿一行；接收轮已正确列出。 |
| A/none-4 | no_clear_error | 回答准确复述有问题的 goal，单列工作流冲突。 |
| B/none-4 | no_clear_error | 同上。 |
| A/ambiguous-4 | no_clear_error | 纯正文问清对象，无分派。 |
| B/ambiguous-4 | no_clear_error | 第二轮实际读了要求再列内容，不是凭文件名猜测。 |
| A/original-5 | no_clear_error | 多余确认单列，未虚报分派。 |
| B/original-5 | factual_error | 轻微：首轮四行说三行；多余确认另计。 |
| A/paraphrase-5 | uncertain | “两份资料内容互相一致”未区分旧规则与新要求。 |
| B/paraphrase-5 | no_clear_error | 再问已知范围/回传方式，未虚报执行。 |
| A/one-5 | no_clear_error | 元数据、导入与读取正确；重复导入为幂等调用。 |
| B/one-5 | no_clear_error | 明确区分未收到要求文件与目标转述，未虚报文件。 |
| A/none-5 | no_clear_error | 如实复述分派结果，纯回复交付 goal 冲突另计。 |
| B/none-5 | no_clear_error | 自拟字数等限制显式说明，未假装来自原要求。 |
| A/ambiguous-5 | factual_error | 轻微：除标题外完全相同不实；对象澄清正确。 |
| B/ambiguous-5 | no_clear_error | 明确未读取要求；问清对象，未分派。 |

本表不用于比较总体准确率：两组到达接收轮的数量不同，后续回答数量及出错机会不同。最终汇总须保留这一限制，并把目标偏差、事实错误、措辞风险分开。
