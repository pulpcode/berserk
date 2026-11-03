# R16 运行器实现与离线检查

本轮只修改独立评测器。产品、两份 Skill 和六个工具均不再修改：候选内容取 Git `0cbe321e79765f14aae4debfa383126596f4e1cc`，原版取 `6a631a42b99b01de334cd2017c07bf0d9d58a560`。不读取产品工作区中未提交的 Skill 正文。

## 处理流程

- 固定 24 题 × 4 组 × 3 次，共 288 项。每项重新建立独立会话和草稿，四组的初始业务数据相同。
- 真实启动本地 HTTP、Pi 和标绘框架。工具读取与写入实际隔离草稿；空间结果由真实工具生成。离线检查只替换外部模型传输，不伪造工具响应。
- 每个原题轮次分别记录已发送、完成、未发送和额外澄清回复。普通文字询问和交互 API 都用固定白名单回答，不能补造业务事实。
- 不再要求前一轮数值或工具选择正确才发送下一轮。完成回答后的可选邀请不会替代下一道原题。
- 未知询问保留原记录并暂停整批，不能静默跳题。重复澄清、连续三次相同工具参数及相同公开结果，没有新增证据时停批。
- 清理请求所做的取消不算完成。已删除此前不可达的“缺数据询问取消后计完成”分支。
- Q22 的用户主动编辑通过真实 API 完成，更新后另存回执。后续检查将用户更新后的数据作为基准，不能误判 Agent 越权。
- 越权只影响当前隔离草稿、且确认无来源系统修改和隔离失效时，该题失败，继续剩余题。无法证明隔离或出现来源修改时停批。

## 额度和执行边界

按 `execution-amendment.md` 中用户“**不设额度，开始测试**”授权，取消原计划 3000 请求、6000 万输入、400 万输出、8000 AFP、1000 AFP 预留及 9000 AFP 启动门槛。这些值只保留为原计划记录。

每次模型请求、输入输出和估算 AFP 仍记账；真实 HTTP 失败、用量缺失、模型变化、输出截断、源文件变化及无进展仍停止。固定 288 项，不重试、不追加，不修改账户或开启超额付费。32768 是本轮冻结的单次输出配置，不是任务总预算。10 分钟、12 次请求和 24 次工具调用只告警，不按这些阈值取消任务。

首 12 项为 Q07、Q08、Q20 各四组。同一进程等待 root 复核：读取 `checkpoint-12.json`，核对通过后写入 `checkpoint-12-approval.json`，字段为该文件中的 `freezeHash`、`ids` 和 `decision: "continue_remaining_276"`。不重新创建任务，不重新调用这 12 项。

## 离线证据

- 初始原生 HTTP 运行器 14/14 通过，504 秒：原生 Skill 读取、工具与保存、多轮及额外澄清账本、超过 10 次请求继续处理、真实错误首次记录后停批、未知询问停批、隔离草稿越权只失败当前题、Q20 询问后保存、Q22 编辑后重算。日志：`offline-logs/runner-native-initial.log`。
- 最终预算修改的 provider/budget 7/7 通过，全 R16 TypeScript 与 ESLint 由独立 checker 复核通过。
- 六条 R15 真实误停材料重放及全 24 题 × 四组 HTTP 夹具结果见 `case-offline-checks.md`。这些是离线流程验证，不代表模型正确率。
- 最后补充的无进展和三次独立状态检查 2/2 通过，74.7 秒：第四次重复请求前停止；三次重复共 12 个独立会话和草稿，账本一致。日志：`offline-logs/runner-native-amendment.log`。

上述检查全部使用假模型，没有付费请求。早期失败日志保留，不覆盖。

## 正式执行

在 `experiments/harness-lab` 目录执行。先创建仓库 `.local/spatial-r16` 父目录，然后用 `live.ts prepare` 创建新的冻结文件。离线门禁 `offline-gate.json` 必须包含 `status: "passed"`、同一冻结文件 JSON 的 SHA256 `freezeHash`、非空 `evidence` 列表。账户快照继续记录观察时间、剩余额度、超额付费状态，可用 `sharedUsePolicy: "observed_shared_usage"` 与 `externalUseReserveAfp: 0`，不作为人为额度限制。

```sh
node --import ./node_modules/tsx/dist/loader.mjs ../../.trellis/tasks/10-15-agent-map-spatial/r16-20261028/live.ts prepare ABS_FREEZE.json
node --import ./node_modules/tsx/dist/loader.mjs ../../.trellis/tasks/10-15-agent-map-spatial/r16-20261028/live.ts run ABS_NEW_OUTPUT ABS_FREEZE.json ABS_ACCOUNT.json 4807
```

输出目录必须位于仓库 `.local/spatial-r16` 内且尚不存在。`live-claim.json` 是唯一执行登记，不能删除它来重跑。正式执行期间冻结文件和源代码保持不变。方案授权与 `execution-amendment.md` 一并冻结。
