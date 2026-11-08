# 修复工程检查

2026-11-08。用户要求后续测验在tencent-server执行。测试使用独立目录`/home/ubuntu/axon-scenario-release-68dded362074/probe-repair-20261108`，未替换生产代码、配置、数据或账号。

| 检查 | 结果 | 服务器证据 |
| --- | --- | --- |
| TypeScript、lint/依赖边界、build | 通过 | engineering-attempt-1/logs/{types,lint,build}.log |
| 来源修复、执行、Context HTTP等首组回归 | 40项通过，驱动夹具1项失败后修正 | engineering-attempt-1/logs/focused.log |
| 完整确定性驱动 | 2/2通过 | engineering-attempt-3/logs/probe.log |
| 全量单元/集成 | 140文件1616项通过；其余旧断言及缺失资料已单独复验通过，合计142文件1630项 | engineering-attempt-3/logs/full-unit.log；engineering-attempt-4/logs/affected-unit.log |
| 静态全范围复核 | 无待修阻塞，diff检查通过 | trellis-check复核来源、契约、解码、权限、工具、profile、驱动、桌面夹具 |
| 桌面交互 | 首组30/31通过；唯一失败项随后复验通过，合计31项 | engineering-attempt-4/logs/desktop-limited.log；desktop-recheck.log；desktop-recheck2.log |

## 失败及调整保留

- attempt-1驱动夹具的8192上下文触发SDK输出参数收缩，与已冻结131072配置不一致；修正夹具，不改变产品模型预算。
- attempt-2完整驱动在旧90秒测试超时处中断，21条消息、期限核对及首组历史已完成；单项工程测试超时调整至300秒后attempt-3通过。没有真实模型调用，也未给产品增加累计预算停止。
- 全量测试中旧导演接口断言只允许v5/v4，且将v6当未知版本，现与新增v6同步；测试包漏带既有spatial fixture，现补齐。对应两文件15项全部通过。未改变业务断言。
- 首次桌面回归曾与其他检查争用资源，发生Chrome OOM；后续串行桌面仍导致服务器响应迟缓，已停止本次隔离目录的进程，健康检查200。再运行使用独立systemd用户scope，硬内存上限1400MiB，避免测试挤占生产；原失败和中断日志、截图、trace全部保留，不计为通过。

正式三轮真实模型仅在最终候选提交、完整源码指纹和口径冻结后启动；失败不替换。

- 桌面唯一剩余项：第一次单独复验确认cgroup内存1400MiB上限触发Chrome OOM（browser-memory-kernel.log）。第二次保持源码及业务断言不变，服务器专用expect就绪等待20秒、内存硬上限1700MiB、CPU上限150%，通过（1.0分钟）。所有31项已有通过结果；原5秒/1400MiB失败不删除、不冒称同批全绿。产品页面和交互未为测试改变。线上健康检查仍为200。
