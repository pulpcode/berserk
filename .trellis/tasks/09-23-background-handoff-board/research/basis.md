# 设计依据

核对日期：2026-09-23。区分当前实现、参考机制与待审方案；未修改产品代码或线上规则。

## 已验证问题

- BUG-002：`cd /workspace && ls -la` 执行前命中 `shell.review`，后台以 `HUMAN_ACTION_REQUIRED` 失败，无投递。见 [复测03](../../09-22-handoff-confirmation-flow/research/manual-retest-03.json) 和 [缺陷记录](../../09-22-handoff-attachment-integrity/bugs.md)。
- `src/execution/command-policy.ts:39,69`：未引用通配符与目录切换可能返回 ask，不等于已经确认命令危险；前台和后台共用此策略。
- `src/pi/lab.ts:660`：后台 ask 调用整请求 `stop(...,'failure')` 并返回 `terminate:true`；deny 已采用普通工具错误。
- `src/pi/file-tools.ts:42`：bash 说明包含网页确认，但后台没有相应交互。应描述当前模式实际具备的能力。
- 正常结束检查只验证有效最终答复，不判断业务目标是否完成；详见 [运行依据](runtime-basis.md)。

源码相对于 `experiments/harness-lab/`。Pi 固定版本 0.85.1，原生 beforeToolCall 可阻止工具并返回错误；未设置 terminate 且未取消时，Agent 可继续。

## Hermes 参考范围

官方来源已在前序讨论中核对，链接为当时 main／官网，不将其作为本项目后台审批恢复能力的证明。

| 机制 | 官方依据 | 本期采用范围 |
| --- | --- | --- |
| 无人值守场景默认立即阻止待审命令，返回工具结果 | [Security](https://hermes-agent.nousresearch.com/docs/user-guide/security)、[approval.py](https://github.com/NousResearch/hermes-agent/blob/main/tools/approval.py#L519-L599)、[terminal_tool.py](https://github.com/NousResearch/hermes-agent/blob/main/tools/terminal_tool.py#L800-L833) | 受阻反馈给 Pi，不直接结束整项作业；不引入自动批准 |
| 交互渠道可发送审批并等待 | [approval_gateway_wait.py](https://github.com/NousResearch/hermes-agent/blob/main/tools/approval_gateway_wait.py) | 继续使用 Axon 已有前台确认，本期不扩展后台等待 |
| Kanban 使用 blocked 及后续派工 | [Kanban](https://hermes-agent.nousresearch.com/docs/user-guide/features/kanban) | 只作为后续参考，本期不引入 blocked、接手投递或再派工协议 |
| Kanban 位于 Dashboard 导航内，采用状态列和详情侧栏 | [Dashboard GUI](https://hermes-agent.nousresearch.com/docs/user-guide/features/kanban#dashboard-gui) | 保留 Axon 侧边栏，增加作业看板和详情；沿用本系统状态及权限 |
| Docker 可访问宿主路径时仍检查命令 | [approval.py](https://github.com/NousResearch/hermes-agent/blob/main/tools/approval.py#L929-L943) | Axon 挂载持久目录，不按“用了容器”全部免审 |

Hermes 的单用户多 Profile 与 Axon 多席位权限不同。本期借鉴工具反馈和运行可见性，不复制其权限假设或整套 Kanban 编排。

## 约束

- 复用 Pi 循环、原生记录和当前作业投递；不为语义完成度新增模型、工具或持久状态。
- 共用策略修复不等于放宽所有审批；管理人员重处理不等于批准命令。
- 页面遵循稳定导航、可定位详情、准确状态、保留草稿及焦点的原则；具体依据见 [ui-basis.md](ui-basis.md)。
