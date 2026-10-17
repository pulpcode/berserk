# 执行清单

2026-10-17 · 待审阅，仅计划。不得把未勾选步骤当作已执行。

## P0 已完成的事实核对

- [x] 当前旧测评记录已快进合入main并push，远端SHA核实为8cab905。
- [x] 产品代码未包含readSummary候选；原始首次调用前确实无storage映射，工具已有发现ID说明。
- [x] 核实prepareCase、seedLayers、ask/mapState、HTTP annotationRefs入口、原生重试和现有成本配置；落盘三份规划。
- [ ] 用户批准本方案场景、5次重复、预算及验收口径。

## P1 批准后准备

1. 核对main与8cab905的产品差异；有变化先审计，不将其他分支空间工具/底图能力混入。
2. 建立独立codex/测评分支，将任务转in_progress；只实施design第5节测试文件，保持src/fixtures Skill/lockfile不变。
3. 新驱动复用原生HTTP及Pi，扩展ask可选annotationRefs时默认行为保持不变。准备F1/F2/F3，F2前置编辑是正式模型步骤，不能预填助手历史。
4. 为新驱动及ask定向测试。使用确定性provider证明fixture隔离、引用投递、只读快照、首轮无答案注入、失败/预算停止；不将这些结果算入真实测评。
5. `prepare-only`创建排他证据目录 `.local/map-query-native/<batch-id>/`，预生成15条独立初始化与评分规则；拦截provider外发，必须0次。F2此时只准备服务状态，不执行B前置模型编辑。
6. 冻结文件hash、锁文件、模型配置、产品工具和Skillhash、用户原话、场景逻辑、各试次初始化数据和评分规则。全部预期真值只存在评估者目录，不导入模型上下文。第一次真实请求的schema/系统内容仍需与冻结基线核对。

## P2 本地检查与调用前关口

已有命令（在experiments/harness-lab）：

    npm test -- tests/probe-map-query-cases.test.ts tests/probe-map-query-scope.test.ts tests/pi/provider-payload.test.ts tests/pi/annotation-workflow.test.ts tests/pi/annotations.test.ts
    npm run typecheck
    npm run lint

新task-local驱动命令在批准实现后提供help/prepare-only/run接口及node:test或vitest测试命令；现在文件尚不存在，不给出冒充可运行的命令。

必须确认：

- [ ] F1初始化等于原G02-order；F3目标确实不在默认全图前50项。
- [ ] F2原生B前置提示与比较提示、固定annotationRefs投递路径正确；没有读取整个旧B02脚本并顺带运行编辑/发布/交接。
- [ ] 实际输入不含评分/隐藏值、新readSummary或额外地图指令。
- [ ] 预算统计包含所有provider调用及原生技术重试，响应旁路采集不改变流内容。
- [ ] 未授权写入可观察、发现后取消并检查是否已经提交；不修改产品hook实现“更安全的测评版本”。
- [ ] 产品目录diff为空，测试helper改动默认兼容；不复制ask的已有执行循环。

## P3 固定真实模型批次

逐repeat执行F1→F2→F3，共5轮；不按成绩调度。每条最多6provider请求，F2两轮对话合计计算；全批90次、输入200万、输出6万。严格执行design的时间/预算/技术与安全停止规则。

每条步骤：

1. 核对冻结fixture并保存阶段前快照。
2. F2先运行真实B前轮编辑，审查实际操作与可见说明；状态不符合则比较不执行，依赖失败照实保留。
3. 从原话发送主问题，任由Pi选择读取与补查；不插入标准工具参数、不替用户答复。
4. 保存所有请求/结果、工具调用与中途文字、最终答复、usage、阶段后快照；检查状态是否改变。
5. 正常终态或明确失败后才进入下一独立样本；安全、预算或基础设施故障按设计停止，不补样本。

## P4 复核与报告

逐条以真值、实际查询范围和可见输出评分，不只判断最后一句。两份评分如有差异保留理由并核实原始证据。单列实际已知ID与未知ID、发现性查询、首次目标查询、必要补查、自我恢复、额外确认及技术失败。

交付：完整结果表、3个典型成功/失败对话节选、工具和状态事实、调用成本、缺陷定位与仍未解决的问题。计划分母与条件分母分别列出；不得与上轮S1直接计算提升率。

## P5 结束

仅保存测试驱动和结果，保持产品不变；停止本机隔离服务，原始证据保留。下一步修复须另给具体最小改动并待审阅；不自动修复、换模型、push或上线。
