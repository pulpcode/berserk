# R12剩余5项执行入口

这是原R12批次的补充入口。只新增5次首次请求，不改变原12份输入、原7次结果、旧代码或旧run-claim。

## 操作

在 `experiments/harness-lab` 目录执行：

```sh
node --import tsx ../../.trellis/tasks/10-15-agent-map-spatial/r12-20261025/reasoning-completion.ts prepare ../../.local/spatial-r12/reasoning-completion-prepared-20261025
node --env-file=.env.local --import tsx ../../.trellis/tasks/10-15-agent-map-spatial/r12-20261025/reasoning-completion.ts run ../../.local/spatial-r12/reasoning-completion-prepared-20261025 ../../.local/spatial-r12/reasoning-completion-batch-20261025
```

第一行只做本地核对和冻结；第二行会调用模型，只由主会话在离线检查通过后执行一次。运行需要配置好的 Agent Plan 环境，不输出密钥。不要通过删除标记、改目录或重建冻结来恢复请求。

## 核对与留痕

- 固定5项顺序：C04-C0、C05-C0、C05-C1、C06-C1、C06-C0。
- 固定原始冻结和结果文件哈希；核对收尾前快照中的488项材料及3项产品文件。
- 重新解析7份旧SSE，对照每条请求、record、progress、results、usage和实际目录；旧C04-C1的failed标签不覆盖。
- 5份请求文件逐字节复制；发送时沿用原程序的JSON序列化，检查相同wire SHA-256。新的冻结文件同时记录请求文件哈希、新代码哈希、原材料和原预算身份。
- 新单次执行标记固定为 `.local/spatial-r12/reasoning-batch-20261025-completion-claim.json`。与输出目录无关；换目录不能重复发送。旧 `run-claim.json` 不动。
- 每次发出前先保存attempt及progress，立即计入requests和unknown。用量返回后才从unknown转为已知。HTTP、流、模型版本、哈希、用量或预算异常停止后续请求，不重试。
- 新结果分列本批次用量与原7次加本批次的累计用量；工具调用只记录，不执行。

## 响应判断

继续复用旧SSE解析器和环境校验。旧分类函数与旧程序已冻结，因此新文件保留一小段明确的协议检查，唯一规则差异是取消C1必须返回正思考信号的断言。没有伪造或补写reasoning token。

每条结果分别保存requestedThinking、requestedEffort、observedThinking和status。C1零思考可为answer、needs_evidence或truncated；C0非零思考仍停止。answer只代表协议完成且有正文，语义正确性仍待独立证据复核。

测试显式注入模拟transport，标为offlineSimulation，使用测试目录中的独立标记和占位密钥。真实CLI不开放模拟标记路径或transport参数。离线测试不会消耗真实执行标记，也不能将模拟结果混入真实批次。
