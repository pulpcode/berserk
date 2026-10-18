# R2 Skill 正文候选变更记录

日期：2026-10-18。根据已获实施授权的 post-round1-improvement-plan.md 制作隔离候选。这里只保存待评测快照，不替换产品 fixtures，不修改目录或加载机制，不声称效果已验证。

## 变体与隔离

- baseline：两个 SKILL.md 逐字节复制当前产品文件。
- map-only：只变更 map-annotations 正文；spatial-analysis 与 baseline 字节相同。
- spatial-only：只变更 spatial-analysis 正文；map-annotations 与 baseline 字节相同。
- 六份文件的 YAML 前言（包括 description）与对应产品文件完全一致。原生目录描述不在本候选中修改，避免正文与触达同时变化。
- 不包含评测编号、案例名称、特定坐标或预期答案。原则使用通用对象/范围语义。

## 规则来源与实际变化

| 主题 | 已有规则 | 本候选变化 |
| --- | --- | --- |
| map：目标与身份 | 草稿归属、固定版本、必要字段定向读取已存在；后端规范要求共同基线身份 | 将当前轮显式对象优先和跨会话双方核实放到读取前；明确名称/短 ID 不是跨草稿身份，区分共同基线继承与分支后新增；摘要没列出不等于不存在 |
| map：图层解析 | 既有 Skill 要求同名先澄清；工具已有 layerNames 精确解析 | 优先利用 layerNames，解释缺失和歧义结果，不默选首项；条件答案规则见下节 |
| spatial：组织 | 已有范围、方法、引用、恢复、核对、保存规则 | 重组为范围→必要数据与方法→依赖计算→可见回答；合并重复说明并保留方法、固定引用和保存的必要语义，正文由 8585 精简至 7902 字节 |
| spatial：返回边界 | 已有 candidateCount、summarize.total、完整候选、固定结果及附言准确性 | 在计算前明确 query/fields/total/hasMore、带过滤空集、nearest 截断的含义；需补查而非拒绝可回答问题 |
| spatial：事实解释 | 已有数点不推容量、来源/时间区分、额外声明须有依据 | 将方位/边界/距离核验落实到可见表述前；contains 的闭集语义不证明对象恰在边界；未核验不提前报数，错误如实纠正，必要事实不省略 |
| 约束保留 | WGS84、单位、方法、真实引用、分页/错误、权限、保存/发布/采用分离 | 不改计算规则、几何、数据权限、工具可用性、固定结果恢复和未知写入回执处理，不增加审批或产品审核 Agent |

## 新交互原则与实验局限

按此次实施授权采用：纯信息查询允许分别给出完整且标明身份/范围的条件答案；需要唯一结果或任何动作时先澄清，任何情况下不自行合并候选冒充指定范围。它是本次产品交互政策变化，不能把历史 J09 分数按新规则覆盖。

为保持单 Skill 正文变量，另一份 Skill 在各候选中保留原文，其原有“先澄清”表述可能与新条件回答许可同时存在。许可不是必须条件回答：合理必要澄清仍可满足交互规则；是否给出条件答案、是否多余澄清需在评测中分别观察，不能将该组称为已统一替换两份 Skill 的完整产品方案。若后续组合，需另做组合验证。

## 静态核对

已检查六文件 UTF-8 字节长度均不超过受控 16 KiB，所有前言与产品逐字一致；baseline 及每组未变 Skill 与产品字节相同。spatial 按语义逐项核对七类方法的类型/单位/边界/筛选依赖，完整身份和固定 resultRef、geometry/items 选择、read 恢复、原范围续用、错误与分页处理、权限、无损保存及未知写入回执规则均保留；不宣称段落逐字不变。合并了重复的范围、单位、错误与事实核验表述，不要求向用户输出内部清单。map 除新目标/解析段及重复消歧句替换外，其余原文保留。另以脚本核对六文件前言、大小、变体隔离与案例编号缺席。skill-creator 的 quick_validate.py 因当前 Python 缺少 PyYAML 未运行成功；未为此安装依赖，使用前言字节一致性与必需 name/description 检查补充核对。静态验证不证明模型效果，真实测评由主会话单独执行。

| 变体 | Skill | UTF-8 字节 | SHA-256 |
| --- | --- | ---: | --- |
| baseline | map-annotations | 4443 | `d78958c9af8c6739316d64a28f44ee44297f3011e596ebdfe9789d39a6635934` |
| baseline | spatial-analysis | 8585 | `eadbcbe1865b95732f3ae5869fe58646daae50d67eae3a9bd51b85bbfd5a2f40` |
| map-only | map-annotations | 6059 | `07c1b86c819370257045be114d6f376afeddf6f9b6e99846a509baf8be42ed7b` |
| map-only | spatial-analysis | 8585 | `eadbcbe1865b95732f3ae5869fe58646daae50d67eae3a9bd51b85bbfd5a2f40` |
| spatial-only | map-annotations | 4443 | `d78958c9af8c6739316d64a28f44ee44297f3011e596ebdfe9789d39a6635934` |
| spatial-only | spatial-analysis | 7902 | `c18acc69065df85fb63d960d347ea5b27ffa1f9419c0d336ada37bee6ae44f61` |
