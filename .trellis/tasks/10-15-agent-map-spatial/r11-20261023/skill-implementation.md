# R11 Skill 实施记录

日期：2026-10-24。工作分支：`codex/agent-result-grounding`。方案提交：`dcaeb52`。用户已要求“提交git，然后开始实施”；本记录只涉及两份Skill正文及对应规范的实现与离线检查。人工校准标签尚未确认，不表示评分校准或64项测评已经启动或通过。

## 变更边界

已观察到的缺口是来源含义不明确、读取与计算范围混淆，以及正确结果被额外解释写错。规则位于受控Skill正文；现有后端已提供固定引用、真实候选、完整性、数量与保存回执。本次保持前言名称/描述、注册目录、宿主按需加载和工具不变，便于后续四组只比较正文与送达方式。

- `fixtures/skills/map-annotations/SKILL.md`：区分来源对象、草稿对象和引用副本；结合明确引用与实际候选消歧；用操作前后表达例子区分准备保存和已保存，草稿保存与发布、采用分别报告。
- `fixtures/skills/spatial-analysis/SKILL.md`：分别确定参照对象和候选集合；用户指定草稿点可以计算，但不认证真实可用资源；区分点数、数量属性、容量与状态，以及读取范围和计算范围；使用简短、单一含义的事实句。
- `.trellis/spec/backend/map-annotations.md`、`spatial-analysis.md`：记录上述已加入Skill的解释规则，以及它们没有增加资源字段、范围凭证或服务端业务准入检查的边界。
- 本文件：记录实际改动、版本和检查，供后续冻结实验核对。

保留原有方法、单位、边界语义、固定结果引用、完整性、权限、并发版本、不确定写入恢复和保存/发布/采用规则。没有新增schema、算法、hook、审核模型、结果存储或强制读取步骤；没有修改前端、主线、部署配置或其他任务文件。

## 业务口径如何落入正文

明确引用足够时直接使用；“本会话”单独出现不自动指定草稿。候选信息不足时定向查询；多个合理解释会改变答案时澄清，或提供完整的条件答案，不无故增加询问。只有用户要求联合统计才合并；身份不能核实时分开报告，不按同名去重。

用户指定草稿点可以做空间分析，不要求先证明它是正式资源。相应结论仍是指定点集的空间关系；真实数量和可用状态各自需要实际数据。对完整、单位明确、身份不重复的数量字段允许简单求和，不把`summarize`的对象计数当成属性求和，也不另造工具。

表达例子采用设备层/定位层、3个点与27箱物资、临时堆场/装卸口、巡查线。未复制Q01—Q08题干、对象ID、坐标或固定范围答案；这些例子是说明规则，不能据此声称本批是新保留集。保留回答用户要求的名称、数量、单位和必要限制，不通过删减必答内容降低误述率。

## 为什么没有改工具说明

已核对`src/pi/annotation-tools.ts`和`src/pi/spatial-tools.ts`：

| 需要的事实 | 现有工具提供的含义 |
| --- | --- |
| 读取范围与完整性 | `annotation_read`已解释query选择、`objects.total`筛选后分页前数量、`hasMore`与字段缺省语义 |
| 实际计算范围 | `spatial_analyze`已解释input/target、scope、candidateCount、items和referenceItems |
| 数量口径 | filter说明命中对象与候选数；summarize字段说明分类计对象、不对属性求和 |
| 固定范围 | resultRef、geometry/items选择、read不刷新来源均有说明 |
| 写入状态 | 草稿、发布、采用各有操作和回执；未知结果恢复已具备 |

本轮问题不足以证明这些接口缺少必要事实，因此未制造共同工具patch。评测四组沿用同一工具契约。若后续出现确实无法取得必要事实的新案例，应单列证据和接口提案，不混入已冻结对照。

## Skill版本与哈希

S0为`c95b3d3`中的两份B版Skill；实施前工作树中两份正文与其一致。S1为本次候选。哈希针对完整UTF-8文件，包括前言；两版前言逐字相同。四组运行时其余冻结方式由评测驱动记录，不把本工作树所有后续代码自动混入历史运行时。

| Skill | S0 SHA-256 | S1 SHA-256 | 字节数 S0 → S1 |
| --- | --- | --- | --- |
| `map-annotations` | `e113340bc4af9491bf5331cf731ec83cca36b310d38b3850db7b81eef16e67f5` | `bdfcb0979100f5f32a2147c7c91979e0d6bf08134f6ba4db73803fbcde212f70` | 5934 → 7517 |
| `spatial-analysis` | `64b0100f87bb15cfd4b18042194fb8f0a747f4bba72aa6e31ef675a84787146f` | `bca14ca50603ff0481100b212cd24a1614db45b65fa0d15b54e50139cd68ad58` | 9754 → 11601 |

正文增加了业务解释和少量例子，两个文件均小于现有16 KiB上限；长度增加带来的成本与干扰仍须在四组测评中观察，不能只凭文本审阅宣称增益。

## 已完成的离线检查

- `git diff --check`：通过。
- 对两份完整文件核对S0/S1前言逐字一致、SHA-256及16 KiB上限：通过。
- `npm run typecheck`：通过。
- `npm run lint`（含Pi与浏览器依赖边界）：通过。
- 下列9个离线测试文件共131项通过，使用确定性provider及隔离数据，无真实模型请求：

```text
tests/pi/map-skill.test.ts
tests/pi/skill-metadata.test.ts
tests/resources.test.ts
tests/spatial-contract-boundaries.test.ts
tests/spatial-source.test.ts
tests/pi/spatial.test.ts
tests/pi/annotation-workflow.test.ts
tests/annotation-from-source.test.ts
tests/annotations-acceptance.test.ts
```

这些测试覆盖实际受控正文与目录、按需/显式送达和历史恢复、合法分析、权限与固定版本、只读与保存等既有契约。未新增只匹配新措辞的测试。没有前端或运行代码改动，未重复浏览器验收；上述通过不能证明模型遵守新规则。

`skill-creator`附带的Python `quick_validate.py`尝试执行但因本机缺少PyYAML未能完成；未为此安装依赖。已使用项目实际前言解析器/受控资源加载及native Skill测试完成产品相关检查，不能把辅助脚本记为通过。

## 尚待进行

人工标签确认、评分校准、四组实际请求送达审计和真实模型测评均由主会话按方案门槛推进。当前不宣称自动读取改善或正确率提升，不修改历史成绩。未读取密钥、调用真实provider、提交或推送本次实现、合并或部署。
