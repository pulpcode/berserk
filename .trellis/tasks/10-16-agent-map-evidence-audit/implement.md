# 执行清单与审阅门槛

2026-10-16 · 待审阅。本文是下一阶段执行计划，不是已经实施的记录。

## P0 本轮已完成

- [x] 阅读用户任务书，核对其与已有source-plan副本一致；按用户指令收窄到地图。
- [x] 核实本地main、远端main、初始工作区和其他工作树边界。
- [x] 阅读指定问题报告、阶段验证和相关函数；核实原始证据/冻结哈希。
- [x] 运行已有地图确定性基线和类型检查；结果、环境失败单列在audit.md。
- [x] 写入四份文档；仅Trellis任务元数据与文档改变。
- [ ] 用户审阅批准候选、付费评测范围和预算。未批准不执行P1及以后。

## P1 冻结和本地候选（获批后）

1. 重新核对HEAD、工作区与audit基线。若main的地图接口/hook/回执已变化，先做差异审计，不能直接套用旧patch；保留其他任务改动。
2. 在独立候选分支或隔离副本实施，默认分支前缀codex/。Trellis状态经批准后才进入in_progress。A基线与B候选来自同一个核实提交，无运行时实验开关。
3. 仅实现design第3节产品函数与定向测试。事实摘要使用执行参数及真实服务页；所有非对象读取、错误和写入分支保持原输出。
4. 创建薄重放驱动与测试，复用旧运输/解析函数；不改旧驱动的MODELS/schedule/固定目录，不覆盖任何历史运行。
5. 增加本任务独立输出目录 .local/map-read-evidence/<batch-id>，排他创建。冻结源码diff、锁文件、工具定义、题目/数据/评分、候选函数、原始输入及A/B实际请求hash。
6. 新N1–N3使用本机隔离身份/任务/会话和真实AnnotationService准备；prepare-only必须拦截provider。检查每个参数实际命中预定边界。

## P2 确定性检查

在experiments/harness-lab执行以下已有命令；其中新的测试在实施阶段才补入。不要使用默认probe命令意外发起真实模型调用。

    npm test -- tests/annotation-results.test.ts tests/annotation-map-evidence.test.ts tests/pi/provider-payload.test.ts tests/pi/annotation-workflow.test.ts tests/pi/annotations.test.ts tests/annotations-acceptance.test.ts
    npm test -- tests/pi/annotation-hook-boundaries.test.ts tests/annotations.test.ts tests/annotation-from-source.test.ts tests/probe-map-query-cases.test.ts tests/probe-map-query-scope.test.ts
    npm run typecheck
    npm run lint

本任务新增驱动计划入口（未创建，必须先检查其help与prepare-only无外发）：

    node --import tsx ../../.trellis/tasks/10-16-agent-map-evidence-audit/replay.mjs prepare --output <新目录>
    node --import tsx --test ../../.trellis/tasks/10-16-agent-map-evidence-audit/replay.test.mjs

保护矩阵：

| 类别 | 必测 |
| --- | --- |
| 实际范围 | 无筛选、对象筛选、图层筛选、合法交集、非法交集拒绝；不对齐两次不同范围 |
| 分页 | 默认0/50、末页offset>0、越界空页、真实零匹配层；total与returned不能互换 |
| 字段 | 省略fields、空数组、style/note/attributes；业务hash不被移除，未读字段不生成空值事实 |
| 非目标分支 | empty、compare、list、receipt、create/apply/from_source/publish/set_current输出与A逐值相同 |
| hook | before hook改变查询时摘要使用真正执行条件；after hook仅改摘要也使依据失效；内容/详情篡改、异常与失去回执沿原路径处理 |
| 历史与UI | 混合旧/新读取历史重开和真实压缩；写回执content/details配对、固定入口、replay标识和受损元数据拒绝不变 |
| provider | tools与常驻说明哈希A/B相同；content包含事实，details不泄入模型；原24次证据不变 |
| 驱动 | 除允许字段外的A/B差异拒绝；预算/超时/输出截断、序号重复、原证据缺失、无结果不被算成成功 |

读取事实测试应至少用一组真实服务结果独立比对原文档；不能让两个断言共用同一个错误格式函数。保留既有选中不存在ID返回安全404，不改为成功空列表来方便测例。

以上通过才允许S1。若候选迫使修改服务、HTTP、hook或写回执合同，退出实施并重新审阅。

## P3 固定模型实验

严格执行design的S1→S2→S3及停止门槛；不同时换模型、改工具说明或加载新Skill。

- S1历史30次：C1/C2/C4 × A/B × 5；完整保留不对称范围与原错误调用。
- S2新边界30次：N1/N2/N3 × A/B × 5；先于S1冻结，但S1未通过不运行。
- S3原场景6次：B02/G02-order各3，真实Pi循环，每次最多6推理；本地准备与业务操作分开记。
- 总上限96 provider调用、输入200万token（含缓存）、输出6万token；单调用60秒和2048输出上限。达到限制停止，不以旧授权无限扩张。
- 凭据只由现有环境读取；不打印env/headers，不复制生产任务数据。本文批准前不运行。网络/预算不可用时记录“未执行”，不以模拟结果替代。

重放驱动run命令、样本序号及实际冻结hash由prepare输出后记录在本任务verification文件；不能拿未生成的hash预填报告。输入中已有提醒不重复注入，原生场景继续使用现有Pi/controlledStream，不共用第二套业务循环。

## P4 审阅与结果

先按匿名样本ID审阅全部可见输出及证据，再解盲。若仅由同一执行者审阅，明确标记“非独立审核”；不得声称已做独立审查。

每条至少记录：

    用户目标 / 实际读取参数 / 实际匹配与页 / 模型可见字段
    全部中途及最终文字 / 额外断言 / 必要且有效的补查
    完整性 / 明确错误 / 歧义 / 冗余 / 技术失败
    是否有写入尝试 / 独立前后快照 / 工具与provider成本

报告不把请求succeeded、核心一句正确、正确下一步、整段准确或业务完成互相替代。明确缺陷仍存或收益未证实；不隐藏旧失败、不给模型补隐藏答案。

## P5 回退与交付

候选失败：停止后续阶段；保留实验材料；仅撤回src/pi/annotation-results.ts的候选行为。无数据库迁移、历史清洗、权限变更或模型配置回退。报告保留“未采用”。

候选通过：交付最小diff、逐项结果与限制，供另行审阅是否合入；不自行push/merge/deploy。新增spec仅描述获准采用的真实合同。确认原main其余机制完整保留。
