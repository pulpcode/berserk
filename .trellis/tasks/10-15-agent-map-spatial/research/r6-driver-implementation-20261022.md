# R6十二项执行对照：驱动实施与离线检查

本记录只覆盖测试驱动的实现与确定性检查，**不包含真实模型成绩**。获准范围为D02/D11/D17/D16各E0/E1/E2一轮、全部显式选择目标Skill，共12项；不自动追加、重试或覆盖旧记录。

## 实现边界

新增`r6-20261022/live.ts`、`live-provider.ts`、`live-budget.ts`、`smoke.test.ts`、`provider.test.ts`、`package.json`和`tsconfig.json`。没有修改产品代码或冻结R3/R4/R5文件。运行时、题单、评分和审阅文档由其他协作任务分别完成。

驱动沿用R5串行原生HTTP/Pi流程，直接复用既有provider记录器、用量核算、SSE解析、环境约束与副作用核查。`runtime.ts`负责隔离E0/E1/E2；驱动将其输入哈希连同R6及所依赖旧批次、当前产品源码/夹具/脚本一起冻结，运行期间变更会停止后续请求。`resume`只跳过已开始条目，不重放失败。

预算为180请求、300万输入token、6万输出token；开始下一题前预留24请求、30万输入、1万输出。单题24请求/64工具/10分钟是提示线，允许正常推进的当前任务完成，超额如实留证。未知用量或提供方故障保留原记录并停止，不能自动付费重试。

## D11如何继续真实澄清

API问题与普通正文问题都由主Agent查看完整现场记录后决定是否发送冻结答案，测试程序不凭问号、关键词或模型自述判断问题有效。

- API路径：首次单个问题出现后，保存完整snapshot、真实interaction、固定答案和显式Skill选择，暂停在`clarification-gate.json`。批准后，经正式interaction response API发送原答案。
- 正文路径：仅首个用户回合正常结束、没有实际API回答时，保存相同的审阅资料。批准后，经正式messages API发送原答案，继续使用相同显式Skill选择。
- `decision.json`必须恰有`approve`、`evidence`、`reviewer`、`entryId`、`requestId`、`gateHash`。gateHash覆盖完整审阅输入；错题、旧request、错hash、缺证据或额外answer均拒绝。主Agent应原子写入该文件，避免半写入JSON。
- 拒绝不发答案：保留原未完成记录；正在等API的问题仅做取消清理。清理取消不是用户选择。
- 每题总共最多发送一次冻结答案。API已经回答后不再补正文；批准后的再次API问题不会自动回答；普通路径也不会出现第二次审阅补答。
- 技术失败、取消、中断均不进入普通续聊gate。无需必要澄清的其他题不获得隐藏回答。

这只是一条测试续聊协议。审阅者是主Agent，不是独立人工盲评；不属于产品新增交互框架。

## 实际provider输入检查

每个entry的每个用户回合首次parent请求必须含目标Skill精确正文，所选hash必须对应运行时原文件。每次请求继续记录所有方法的实际bodyPresent，并核对原目录简介；后续允许原生压缩后的正文摘要，不能将合法压缩一概判为加载故障。

E0/E1工具schema完全相同。E2只允许`annotation_read`和`spatial_analyze`的定义变化，且实际wire中必须出现objectNames和classify_points。其他工具定义保持一致，skill_read仍是R4字符串入口，不把主动读取候选混入执行对照。每组内部schema固定；漂移在外部传输前拒绝。

## 离线检查结果

命令从`experiments/harness-lab`执行：

```sh
./node_modules/.bin/tsc -p ../../.trellis/tasks/10-15-agent-map-spatial/r6-20261022/tsconfig.json
node --import tsx --test ../../.trellis/tasks/10-15-agent-map-spatial/r6-20261022/smoke.test.ts ../../.trellis/tasks/10-15-agent-map-spatial/r6-20261022/provider.test.ts
```

结果16/16通过，全部使用假模型，外部传输被替换：

- 12槽位端到端流程共17次模拟provider请求。D11-E0通过真实API答复，D11-E1通过真实下一轮消息答复，D11-E2故意模拟提前选择而拒绝补答，原样记录incomplete；其余槽位记录完成。再次resume没有新增请求。
- D16-E2另用7次模拟请求经过真实读取、注入CAS冲突、重读和保存，最终几何与首次预览一致，外部备注保留。
- 四项审批边界：错entryId、错requestId、错gateHash、注入answer均拒绝。
- 三项D11边界：已答后再问、拒绝API问题、提供方503均没有额外隐藏答案；503只尝试一次模拟传输，未转普通gate。
- 六项provider检查：其他工具变化、E1业务工具变化、首次正文缺失、目录变化、主动发现入口混入均在下一次传输前拒绝；E2两项允许变化可正常通过。同回合后续缺全文被记录，新用户回合仍必须有显式全文。此项没有实际触发Pi压缩，不作为压缩端到端验收。

任务TypeScript、仓库根目录显式ESLint配置检查及`git diff --check`均通过。检查后的两处纯文案修正只明确审阅可引用interaction，并避免测试标题暗示实际执行过压缩；无行为变化，最终再次完成类型和lint检查。

真实测试由主会话另行启动，原始证据放新的`.local/spatial-r6/`目录。本实现Agent没有调用付费模型，也没有提交或推送Git。正式90%验收目标不由这些离线结果替代。
