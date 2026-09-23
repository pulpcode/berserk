# 三项 GitHub Issue 审阅

2026-09-23。用户报告当前流程已初步完成一轮端到端测试。本次读取了三个开放 Issue 的正文及评论（均无评论），核对已发布代码、既有自动测试和该轮业务回执；没有关闭 Issue 或发布评论。

## 结论

| Issue | 建议 | 依据与剩余条件 |
| --- | --- | --- |
| [#1 跨席位分派未实际交接附件](https://github.com/pulpcode/berserk/issues/1) | 暂时保留 | 最新一轮已实际分派两份附件并完成验收，但不能据此确认覆盖原自然多轮输入、无关文件对照及纯文字真实模型场景。原记录中的失败样本仍保留，不能把一次成功视为这些验收条件全部通过。 |
| [#2 文件检查误拦导致后台失败](https://github.com/pulpcode/berserk/issues/2) | 可以关闭 | 两条复现命令及相关规则已有确定性回归，服务器原生解析校验通过；后台 ask 已改为未执行的工具错误反馈，Pi 可以继续。受限命令、技术失败和失败不投递均保留测试；复测04真实预处理完成并投递。 |
| [#3 分派准备与确认跨轮失败](https://github.com/pulpcode/berserk/issues/3) | 可以关闭 | 模型改用一次 work_item_action，宿主内部完成准备、确认、提交；卡片前检查、批准后复检、拒绝／取消及旧历史兼容已有回归。最新一轮 Agent 分派与提交具有正式成功回执，两份输入附件实际登记在工作中。 |

关闭 #2 表示已解决记录中的误拦和后台整请求终止问题，不表示权限体系已完善；后续工作仍由 [PERM-001](../issues.md) 跟踪。关闭 #3 表示旧 prepare／commit 拆分故障链已经消除，不保证模型永远不会选错对象或漏选附件。

## 本轮业务证据

- 消息与后台作业见 [复测04](manual-retest-04.json)。
- 工作：`6ec582f1-917a-493b-b139-786b8f4164c7`，标题“修订值班交接说明（初稿→修订稿）复测04”，当前 `completed`、revision 4。
- 实际输入文件数为 2，提交记录数为 1。

| 操作 | 来源 | 回执状态 | 操作编号 |
| --- | --- | --- | --- |
| 分派 | Agent | committed → assigned | fc7fbc59-7f11-418a-89ba-e96d40821e4e |
| 签收 | 页面 | committed → working | 34af863a-d4ca-458f-995f-e72f9cd79d0e |
| 提交 | Agent | committed → submitted | a5dc18bb-734b-404e-8835-4fbb65b12b81 |
| 验收 | 页面 | committed → completed | 3a6541ef-09f9-40ba-bc6f-3b53b08684a8 |

这是一轮用户手动混合流程，不是四种动作全部通过 Agent 的真实模型测试，也不是原自然多轮／独立对照探针的重跑。没有在本次核查中重新读取附件字节或补造成功记录。

## 代码与测试依据

- `tests/execution/command-policy.test.ts`：同目录 cd、有限文件通配、完整命令链、受限命令和解析故障。
- `tests/pi/background-runner.test.ts`：后台工具受阻后继续、普通无法完成答复、基础设施失败；`tests/background/service.test.ts`：作业终态与投递。
- `tests/pi/collaboration.test.ts`：单次确认动作、预检失效、批准后版本变化、拒绝／取消和回执绑定。
- `tests/e2e/handoff.spec.ts`、`hitl.spec.ts`：真实确认卡与单工具调用的浏览器链路。
- 既有全量结果为 527 项 Vitest、103 项 Playwright 通过，类型、lint、构建通过。本次逐文件对比待提交工程与已测试、已部署的 183 文件源码包，内容未变化；只补充验收及审阅文档，没有重复调用模型或重跑已通过测试。

上述源码路径相对于 `experiments/harness-lab/`。GitHub Issue 保持开放，关闭建议供用户决定。
