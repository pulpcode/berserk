# 引用分组修复与恢复准备：独立复核

2026-11-03；复核者 acceptance_resume_check（独立AI代码/证据复核，不是模型业务评分）。结论：**本次修复通过，可由主会话完成新批次准备和readiness后，按原计划恢复剩余10槽。** 未执行真实模型调用，未创建live-02，未读取密钥。

## Findings (fixed)

未发现需要修改代码的阻塞问题，复核者未编辑实现文件。

复核提出一个证据核验边界：resume.ts对前10槽计算当前文件hash并验证复制一致性，本身不等于证明自旧语义审阅后未漂移。主会话已另行用旧adjudicated packets核对94条snapshot引用的原始hash，10槽全部一致，结果见resume-reused-evidence-verification.json。此缺口已由恢复前的实际检查补齐，不需要新增通用恢复框架。

## Findings (not fixed)

没有待修复的阻塞项。保留两项既有边界：

- N06多问题交互/未准备额外回复规则没有修改。本次授权仅修N07引用分组并继续，不能借恢复补测N06或改变评分。
- 恢复脚本是绑定此次停止批次的单次工具：固定旧protocol、ledger、public gate、N07审计hash；相关tests依赖本地保留原件，不声称是可迁移的通用恢复系统或产品CI测试。

## 核对结论

1. reference-check只规范化比较副本，不改浏览器实际发送内容。同版本纯对象/纯图层引用允许拆分、重复与顺序变化；setId、revision、publication及whole/layer/object选择类别保持区别；混合过滤保持原子，不能把不同交集错误展开。
2. 原被冻结文件中只有browser.ts变化，恰为导入helper与替换deepEqual两处。产品、Skill、run.ts、题目、模型profile、预算、评分及追问契约未变。新helper及恢复脚本会进入下一次freezeFiles。
3. resume.ts拒绝已存在目的目录，检查48次全部已结算、每项usage存在、响应型号不变、旧停止原因正确；继承全部attempt和总用量。测试证明下一次begin是49，预算不会重置。
4. N07旧audit被pin，其preservedEvidence及实际POST再核对；旧N07无任何provider记录。新批复制前10槽完整目录与gate，保持逐文件hash，N07旧失败不覆盖。run.ts继续拒绝已有槽目录，因此前10槽不可重跑；顺序检查仍保留。
5. 新批protocol/ledger绑定修复后的freeze，原halt/ledger不改。resume manifest列旧hash/停止原因、复用10槽及剩余10槽。准备脚本故意不写readiness，主会话需核准后才能出网。
6. 真实N07桌面确定性检查通过：一次发送、两个同版本单对象附件、原生消息中的两份引用对象身份和固定hash一致、无页面错误。没有把实际POST重写成一份附件。

## Verification

- 单测：25/25通过（引用等价15，恢复/账本10）；独立复跑。
- TypeCheck：通过，`tsc --noEmit -p .trellis/tasks/11-03-resource-independent-acceptance/tsconfig.json`。
- Lint：通过，使用`experiments/harness-lab/eslint.config.js`检查本次5个TS文件。复核首次命令误写为不存在的mjs扩展名，纠正命令后通过，未为此修改代码。
- 产品变更边界：`git diff --name-only -- experiments/harness-lab .agents .codex`为空。
- N07桌面原件：`/private/tmp/resource-acceptance-resume-n07-20261103`，liveModelCalls=0、deterministicRequests=1。独立读取actual POST、native snapshot和result；没有重复启动浏览器或付费请求。

| N07离线原件 | SHA-256 |
| --- | --- |
| browser-turn-1/sent-message-bodies.json | 14caed1f528a79bdb921fc9f614a2dc321d934ea6cc10265b93b8d78b192249c |
| browser-turn-1/native-snapshot.json | b9aa5419334ddea28e812220142ef8447eba263959c210d00b12786af7d1f021 |
| browser-turn-1/result.json | 4ec3060cd9406dd5b9e754b1b33eaaaeafef657221049da858fc9aaa30822004 |

本复核证明引用断言及恢复记账流程可继续，不证明剩余模型任务会通过。真实语义成绩须继续双审原始轨迹。
