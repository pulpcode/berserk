# Agent 与标绘整合测评驱动

这是任务内的开发验收驱动，沿用产品的正式 HTTP → 原生 Pi → 既有工具/服务。默认只准备独立合成数据；本次实施没有调用真实模型。

## 已实现边界

- 10 道整合题 C01–C10、5 道 R13 题 F01–F05，每题独立两次，共 30 槽。每槽独立账号、数据目录和会话，不触及 4324 试用库。
- 只将产品 `src/scripts/fixtures` 等复制到隔离运行时；题目、预期答案、评分规则、旧回答均不进入 Agent 工作区。保留原生按需 Skill 加载，记录真正发出的 schema、消息、Skill 正文送达情况。
- 请求模型固定 `deepseek-v4.1-flash`，核验响应 `deepseek-v4-1-flash-261017`；thinking disabled、max_tokens 32768、top_p 1、temperature/reasoning_effort 缺省。产品模型配置不变。
- 硬上限 300 实际请求 / 800 万输入 / 60 万输出 token；新题重复对预留 36 请求 / 100 万输入 / 65536 输出。单次按 UTF-8 请求字节数 + 4096 预留输入，按 32768 预留输出，再结算真实 usage。缓存输入不重复计数；未知用量、提供商错误、截断、版本变化立即停止后续请求。12 请求 / 24 工具 / 10 分钟仅提示。
- C08 在实际 native history 中观察到当前请求成功读取目标 draft、返回目标 style 后，在下一次模型请求前进行一次真实服务并发写入；不修改模型已经收到的证据。若未到触发点则记 incomplete。原生宿主拒绝同一模型输出内尚未送达读取结果的写入；受控 native 测试验证实际 CAS 拒绝与重读。
- 只答复冻结的澄清；未识别的必要问题保留 waiting_user，正常条件性后续邀请不阻塞。不会自动批准发布、删除或额外权限。
- 原始 provider/native 输入、wire 输入、SSE 输出、逐轮快照/持久状态、并发写回执、原生会话及哈希均保留。`recorded` 只表明流程结束，始终 `semanticReview: pending`，绝不自动转业务通过。

## 与固定 R13 的关系

依据 `e07f46e756b5dcb373fdfae25da63c9585d5824e` 的 `r13-20261025/cases.ts` 核对 F01→Q02、F02→Q04、F03→Q05、F04→Q06、F05→Q01 映射及 F05 追加的方法要求。复用本工作树中固定提交的 r11/r10/round1 准备算法；保留相同题意和数据生成逻辑，重新生成合法身份。

R13 原准备器还依赖另一工作树 `.local/spatial-r11/.../fixture.json` 做历史实例字节对照，本驱动不依赖或复制该浮动私有目录。因此这里不宣称新夹具与旧实例逐字相同，也不沿用 R13 成绩。所有实际复用辅助文件的哈希会进入当前冻结清单；历史证据仅用于可追溯映射。

C09 夹具将实际来源查询快照的点几何、名称、版本及引用通过正式草稿写 API 建立为来源副本；它不是对 `annotation_from_source` 调用成功的独立证明。来源复制工具仍由工程契约测试覆盖。

## 离线验证

从 `experiments/harness-lab` 执行（Node 24）：

```sh
node --import tsx --test ../../.trellis/tasks/10-26-agent-plotting-integration/evaluation/evaluation.test.ts
node_modules/.bin/tsc -p ../../.trellis/tasks/10-26-agent-plotting-integration/evaluation/tsconfig.json
```

自动测试覆盖 30 槽实际 HTTP 准备、4 槽受控 provider 的 native 读写/CAS、预算停止、请求参数、失败证据、澄清、键顺序语义等价和评分门槛。受控 provider 仅为程序验证，不作为真实模型成绩。运行前保持产品源码稳定：即使只准备夹具，源码变化也会触发冻结停止，不能边改代码边将旧准备结果称为新版本通过。

只准备数据：

```sh
node --import tsx ../../.trellis/tasks/10-26-agent-plotting-integration/evaluation/run.ts prepare /tmp/plotting-integration-prepare-new
```

默认端口 5279。准备数据也使用真实本地服务；确认端口空闲，不停止别人的服务。输出目录必须尚不存在，证据不覆盖。

## 真实批次进入条件

1. 工程测试及本驱动离线检查通过，代码提交并保持不变。
2. 在 `evaluation/` 外生成冻结清单：`run.ts freeze /tmp/plotting-integration-freeze.json`。
3. 用户明确批准本批范围与硬额度，核对提供商当前可用额度及计费方式后，形成独立授权 JSON：`approvedByUser: true`、`providerAllowanceVerified: true`、实际 `billingNote`、该清单 `freezeHash`、与代码完全一致的 `limits`。不把此说明当作授权，也不自动充值或换端点。
4. 通过既有环境加载凭据，在 `.local/agent-plotting-integration/` 下选择一个不存在的输出目录：`run.ts live OUTPUT AUTHORIZATION_JSON [PORT]`。同一冻结版本会写一次性 claim，不能通过换输出目录重跑；失败保留、后续动作重新审阅。没有自动恢复/重试入口。

本阶段尚未提供真实 30 槽成绩。语义复核需根据每次公开陈述当时已有证据，逐项填写 `scoring.ts` 的 Review：任务完成、主任务、过程事实、最终事实、实际效果、权限边界与关键错误；注明复核人和证据路径。Agent 复核不得称为用户人工金标。`summarize` 保留全部 30 槽分母，未执行/未复核/待用户都阻止通过；仅在工程通过、完整复核、新题至少18/20、每题至少一次、总计至少27/30且关键错误为零时给出整合建议。该小样本不是独立保留集或稳定90%总体可靠性证明。

## 写入次数与重复保存复核

最终字段相同不能证明没有多余写入。C03/C04/C06/C07/C08 只要求修改一个字段，自动 guard 会按 native 成功回执的固定 `afterRef` 修订去重，并交叉检查实际前后 `headRevision` 增量；超过一次 Agent 提交即停止批次。C08 仅扣除驱动已记录的那一次外部并发修订。失败 CAS 不计成功提交，同一 actionId 的原结果重放或回执查询不产生额外提交；即使写成功但响应丢失，实际 head 增量也不能被忽略。

该“最多一次提交”规则只适用于上述单字段夹具。C01 可以分三次新增不同对象；C10 可能先保存固定分析结果再设置方案性质，不能机械套用相同阈值。所有场景的独立语义复核仍必须逐个核对真实写入回执、actionId、beforeRef/afterRef、操作对象和各修订内容：区分不同必要操作、失败操作、原动作重放与新动作重复保存；不能只比最终文档或数新增对象。自动 guard 没报错也不代表重复效果或全部语义已验收通过。
