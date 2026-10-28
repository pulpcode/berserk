# R13 实施记录

> 2026-10-26。用户已批准“提交方案git，然后开始本轮”。方案提交 `94fbdbc`。原方案中的待审措辞保留为提交时的历史状态，本记录明确当前授权。

## 范围和当前进度

- 分支 `codex/agent-result-grounding`，独立 worktree，不修改 main。
- 五项任务 × E0关闭/E1开启high × 各一次，共十次完整运行；正常按需 Skill，真实 HTTP/Pi 工具循环。
- 共同基准 `6a631a4`。R12 来源指引候选保留但不拷入两组。
- 批次上限 96 次请求、2,500,000 输入、400,000 输出（含思考）；无单项次数/时长硬截断，按方案预留完成空间。
- 原主批次：10项均已开始，9项完整完成，F04-E0因评测器误停而待定；46次请求。原记录见 [results.md](results.md)，保持不变。
- 当前：误停已修复，按新授权仅补齐F04-E0保存轮，新增3请求、累计49。完整结果见 [combined-results.md](combined-results.md)。

## 修改边界

缺口在评测入口：旧 C 不执行新工具，旧完整任务记录器又固定关闭推理。本轮复用现有后端工具循环，仅新增 R13 的运行时归档/夹具、推理与用量适配、批次入口和离线检查。不修改产品、Skill 正文、算法或权限，不自建 Agent 内核，不运行旧批次。

实施代理分别负责 runtime/cases 和 provider/budget/live；检查代理独立审查。只有主会话可执行已批准的真实批次。没有额外连通性探测、付费裁判、自动重试或第二轮。

## 历史保护

准备前的历史/产品哈希保存在 `.local/spatial-r13/history-before-20261026.json`。包含 R11 证据、R12 原/补充证据及全部 R12 任务文件、当前产品候选与运行接口。执行后已核对全部4,532个历史文件、7个产品文件及产品diff，均未改变；不覆盖旧记录。

## 后续记录

离线命令与结果见 [check.md](check.md)。正式批次 `.local/spatial-r13/batch-20261026`；独立盲审见 [blind-semantic-review.md](blind-semantic-review.md)，汇总见 [results.md](results.md)，执行核验见 [execution-audit.json](execution-audit.json)与[独立核验](independent-execution-review.md)。两组同用原Skill，本轮只比较推理配置。

原主批次驱动和结果已提交 `1757116`。后续单保存轮补齐已获新授权并完成，见下方记录；本次修复、补齐结果和完整对比随本次提交归档。

## 保存轮补齐（2026-10-26，新授权）

原主批次代码和结果已提交 `1757116`。用户已批准修复误停、离线验证后仅补齐F04-E0未执行的第二轮保存，见 [补齐协议](closeout-protocol.md)。旧结果与原证据保持不变，补测另存。离线及独立复核通过后已执行唯一保存轮：新增3次请求，保存原结果成功，各评分维度通过。见 [补齐结果](closeout-results.md)、[完整对比](combined-results.md)及[独立复核](closeout-independent-review.md)。不追加其他测试。
