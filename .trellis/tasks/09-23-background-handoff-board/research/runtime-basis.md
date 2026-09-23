# 后台工具反馈与结束语义依据

核对日期：2026-09-23，仅用于待审设计。源码路径相对于 `experiments/harness-lab/`。

## 当前执行

- `src/pi/lab.ts:660`：后台 ask 触发整请求失败；前面的 deny 仅返回工具错误。本期将 ask 改为不执行该命令、返回普通错误，不新建 Agent 循环。
- `src/pi/lab.ts:966–974`：后台完成检查验证最终助手正文、正常停止及无悬空工具调用，没有业务目标判断。
- `src/pi/lab.ts:996`：未取消、无失败原因时记录 succeeded。
- `src/background/service.ts:378–398`：核对原生请求和 finalMessageId，沿用终态。
- `src/background/store.ts:222`：正常结束的预处理建立结果投递。

因此，Agent 只回复“目前无法完成”也可能正常结束并投递该答复。本期将 succeeded 展示为“执行完成”，不承诺完整成果；详情展示受阻事实和答复，不根据关键词或曾出现 ask 自动改判。

## 重新处理与权限

`src/execution/command-policy.ts` 按命令与参数判断，普通 Python／Node 文件脚本可执行，未审计其正文效果；`src/pi/file-tools.ts` 同时提供文件写入与编辑工具。`src/execution/docker.ts` 将 `/workspace` 挂载为可写，限制容器网络、宿主访问及进程权限。因此，命令入口规则不能保证对其他工具产生的等效删除或覆盖逐次确认；相关完善需求见 [PERM-001](../issues.md)。

`src/background/service.ts` 的 reprocess 创建新作业，使用 previous.ruleSnapshot 和原输入，保存 retryOfJobId。更新当前来源配置不会修改原快照；替换输入或使用新规则需要新消息。已有投递重试不执行模型。

来源管理权允许既有作业操作，不授予命令批准或服务器维护权。环境修复可以由维护人员完成，重处理本身不能让原来受限的命令获准。

preprocess 使用独立服务目录；seat_analysis 使用席位已有 Session 和工作区（`src/pi/background-runner.ts:50`）。已有席位分析可以由本人回到关联会话，本期不新增从失败预处理创建席位接手会话的能力。

## 本期边界

沿用六种作业状态与现有原生证据，不增加 request_handoff、blocked 或投递类型，不引入新的持久化停止协议。技术故障仍失败，取消和异常退出保持当前收尾方式；旧失败保留，不自动改写或重放。
