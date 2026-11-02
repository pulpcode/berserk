# 第一轮资源统计修复记录

状态：第一轮实现与离线检查完成，独立复核通过；第二轮尚未开始。

方案提交：`ff9ea83`。本地main是当前分支祖先，启动时无需合并。只实施第一轮；第二轮规则与Skill修改、独立模型验收尚未开始。

## 修复前证据

[原始失败日志](checks/before.log)来自修改产品前的真实本地HTTP来源服务回归，两项断言失败：

- T02：来源有1条记录，任务选中集合为0，旧生成返回entityCount=0；任务关系覆盖不完整，应为null。原始记录需要保留。
- T06：完整成员A={X,Y}、B={Y,Z}且数量含义、来源、范围与时间一致，旧生成value=4、knownValue=4；独立集合预期为3。

这是确定性产品行为复现，不是付费模型测试或模型正确率。

## 修改与检查

- 资源服务与校验共用统计选中集合、空集合未知规则；原始记录仍保留。
- 新汇总按可靠身份与同口径完整成员并集去重；未知重叠不相加，`knownValue`仅计可证明贡献。单份声明仍可保留，身份或粒度未知的多份声明不能据此推导精确合计。
- 新查询和重算使用`ResourceResult.schemaVersion:2`；`resource-summary-v1.ts`冻结旧算法。已与`ff9ea83`逐字比对，仅函数名及冻结注释不同。外层模型结果格式不变，旧版本正文不重写。
- 真正调用服务对v1结果重算生成新引用/v2结果；历史合计4仍可读，新重算为3，不能只改版本号冒充新版。

| 方案要求 | 实际回归与结果 |
| --- | --- |
| T01、T05 | `task-resource-query`明确空来源、partial空来源；已有D10/D14覆盖不可用来源。真零与未知分开 |
| T02 | 原始1条、任务选中0条、总量null；保留原记录并通过严格校验 |
| T03 | 明确data读取后按任务关系汇总，空选中仍为未知 |
| T04 | 混合已知/未确认关系，完整和partial末页均保留覆盖声明 |
| T06、T07 | `resource-summary`重叠并集3、互不相交4、相同集合2；真实HTTP服务也覆盖重叠 |
| T08、T09 | 完整加未知合计null、已知贡献2；双未知合计null、已知贡献0；未知/省略粒度补真实解码与HTTP反例 |
| T10 | 多个汇总覆盖同一单体、来源单体与实际受控导入副本并存，只计一次 |
| T11 | 跨来源ID、单位、类别、范围、时间、数量含义、条件分别检查，不擅自合并 |
| T12 | 完整成员与数量矛盾、全集成员不能证明可用子集、失效/条件/空数量不冒充已知贡献 |
| T13 | 固定v1合计4样例和原生读取、实际服务v1→v2新引用、拒绝改标签和旧无效空集结果 |
| T14 | T02/T06/T08分别经过真实本地HTTP解码→Pi工具→原生历史→读取/空间续用→关闭重启续读；缺实际位置如实partial/unclassified，没有虚构位置 |

检查工作目录为`experiments/harness-lab`：

```sh
npm test -- --reporter=dot tests/resource-summary.test.ts tests/context-resource-query.test.ts tests/task-resource-query.test.ts tests/task-resource-spatial.test.ts tests/pi/task-resource.test.ts tests/pi/task-resource-results.test.ts tests/pi/spatial.test.ts
npm run typecheck
npm run lint
npm run build
```

- [相关测试日志](checks/tests.log)：7文件、130项通过。
- [类型检查](checks/typecheck.log)、[Lint及依赖边界](checks/lint.log)、[构建](checks/build.log)：均通过。
- `git diff --check`通过。构建保留大于500kB的分包提示；测试有Node SQLite实验特性提示，均非本轮失败。
- 没有运行付费模型、浏览器人工验收或正式20项模型任务；本轮130项是离线回归，不能换算为Agent正确率。

## 独立复核与旧断言调整

[独立复核记录](review.md)发现初版仍会把无身份、粒度未知的两条声明相加；已按原修复范围补修，并纳入最终130项检查。未增加轮次。

旧D06的valid断言曾把可用数量的全集成员覆盖当作可用子集身份，预期合计3。按本轮已批准规则，保留原始数量声明，但推导合计改为未知；单份available=3仍有正例。保留[调整前失败日志](checks/old-assertion-review.log)，没有删去失败或重写历史模型评分。

## 根因与防复发

空集故障来自生成与校验各自选择不同集合；已共享选择规则。重叠问题来自把“每份成员完整”误当作“多份互不重叠”，以及漏考虑未声明粒度；已用独立集合预期和真实链路反例保护。历史回执会重算校验，因此采用版本分派而非替换旧算法。相关约束已同步到`.trellis/spec/backend/task-resource-query.md`。

本轮离线案例中，三项专门工具缺陷未再现；这不替代后续独立模型验收的工具门槛，也不预告其通过。

## 保留边界

旧结果按旧版本读取，不改字节；旧值不代表新版重算正确。原A06无效记录不改写。成员完整不等于位置完整，空间续用允许如实返回partial/unclassified。

`hasDraft()`未考虑`annotationRefs`、用户消息无差别影响可用性继续作为独立待办。本轮不证明模型解释能力提升，也不代表全部资源业务已经完善。
