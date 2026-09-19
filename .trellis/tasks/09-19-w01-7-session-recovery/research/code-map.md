# W01-7 设计依据与代码入口

核对日期：2026-09-19。产品基线：`dacd411`，Pi 0.85.1。本文为设计依据，不是本期验收结果。

## 已验证的事实

[Pi 中断验证报告](../../09-16-w01-harness-validation/research/pi-recovery-validation.md) 与 [机器证据](../../09-16-w01-harness-validation/research/pi-recovery-evidence.json) 记录了七个真实子进程中断点，以及三份中断历史通过 DeepSeek 继续的结果。

Pi 可以重新打开这些文件并接受新用户输入；缺失工具结果仅在协议载荷中补位。不会因打开会话而自动执行旧调用，但新的相同调用可能重复效果。首轮、Axon 真实交互桥接、容器、子 Agent 和压缩中断仍须按本阶段补测。

## 当前代码

路径相对 `experiments/harness-lab/`。

| 入口 | 当前行为及设计影响 |
| --- | --- |
| `src/pi/lab.ts` initialize／start | 严格加载后，发现未结束请求或待配对工具调用即设置 warning；start 统一以 RECOVERY_REQUIRED 拒绝。这是缩小限制的主要位置 |
| 同文件 createSession／watchPersistence | 先写原生文件头并重开，再绑定工作区；已有保存故障守卫，不能因续聊绕过 |
| 同文件 openSession／`src/pi/controlled-stream.ts` | 每次用户请求创建独立 Pi 执行对象，固定指令快照；已有 AGENTS.md 提醒保持现状，不扩展为恢复提示词 |
| `src/pi/history-evidence.ts` | 已有资源记录界定请求、结果记录表示正常结束；读取时推导中断，不新增记录格式；需正确处理下一请求前的未完成范围 |
| `src/pi/interactions.ts` | 无活动请求时 pending 投影为 expired、批准缺结果为 unknown；解析中须按下一请求边界使旧 pending 失效，才能接入新交互，无需补写结果 |
| `src/pi/subagent-history.ts`、lab validateChildren | 父子原生文件及结果关联受严格校验；当前不完整子任务阻止父会话续聊，本期保留此边界 |
| `src/pi/compaction-history.ts` | openStrictSession 拒绝坏行、错误父链及无效摘要；不能使用 Pi 宽松读取替代 |
| `src/execution/docker.ts` initialize | 启动按实例标签删除旧容器再检查镜像；本期复用初始化成功状态作为相关会话放行条件，不新增恢复状态 |
| `src/contracts/index.ts`、`src/web/useChat.ts` | DTO、活动缓存与本地提交备份需要识别 interrupted；不能把已有用户消息当作待重发草稿 |
| `src/web/main.tsx`、`WorkspaceNavigation.tsx` | warning 当前禁止发送并显示需要恢复；可继续的中断要用独立提示，未读蓝点语义保持不变 |

## 设计性质

原生保存、模型循环、协议配对和压缩复用 Pi。Axon 仅调整基于现有记录的放行判断、旧交互解析和 Web 提示；不新增持久中断记录、恢复提示词或恢复框架。继续验证真实缺口，再决定是否需要额外定制。
