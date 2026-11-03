# 测评器 v2 离线验证记录

2026-10-27。本记录仅涉及测评器工程验证，真实模型请求 **0**；不更新原严格22/30或原始3个waiting_user。

## 实施内容

- 新增 `evaluation-v2/`，原 `evaluation/`、旧30槽原始证据及评分逐字保留。
- 结束语分为 `finished`、`needs_reply`、`needs_review`。条件词本身不表示可选；必要输入继续等待，无法确定问句所属范围时保留复核，不自动回答。原冻结澄清和权限限制保持。
- 最终计数从ledger取得，与provider attempts对照，再把同一快照写入review.entry、result、runs及batch-state。0请求和有请求但未知usage分别记录；不一致停止批次。
- 历史依赖清单保存455个源文件的SHA-256，均与 `8c58af1ed15687915d54e598d1d4ef2c8c248f89` 的Git blob核对一致，见 `historical-dependencies.json`。还原整个固定提交即可恢复旧产品、辅助程序和驱动，不需复制浮动worktree。

## 检查结果

命令默认在 `experiments/harness-lab` 执行，Lint从仓库根执行。

| 检查 | 结果 |
| --- | --- |
| `node --import tsx --test ../../.trellis/tasks/10-26-agent-plotting-integration/evaluation-v2/evaluation.test.ts ../../.trellis/tasks/10-26-agent-plotting-integration/evaluation-v2/remediation.test.ts` | 共15个唯一用例；完整HTTP轮14/15，唯一历史C08结束语回归随后修复，相关测试重新通过，最终15项均有通过覆盖 |
| `node --import tsx --test ../../.trellis/tasks/10-26-agent-plotting-integration/evaluation-v2/remediation.test.ts` | 修复后4/4通过；包括条件必要问题、请先/请您先、后续邀请、模糊请求和历史原文 |
| `node --import tsx --test --test-name-pattern='controlled native HTTP/Pi\|clarification excludes' ../../.trellis/tasks/10-26-agent-plotting-integration/evaluation-v2/evaluation.test.ts` | 最终受影响2项通过；4个真实HTTP/Pi槽位，16次受控响应，0真实模型请求 |
| `node_modules/.bin/tsc -p ../../.trellis/tasks/10-26-agent-plotting-integration/evaluation-v2/tsconfig.json` | 通过 |
| 同命令改为原 `evaluation/tsconfig.json` | 通过；没有修改原驱动 |
| `experiments/harness-lab/node_modules/.bin/eslint --config experiments/harness-lab/eslint.config.js .trellis/tasks/10-26-agent-plotting-integration/evaluation-v2` | 从仓库根执行，通过，无ignored警告 |
| `git diff --exit-code c6b5dc8 -- .trellis/tasks/10-26-agent-plotting-integration/evaluation .trellis/tasks/10-26-agent-plotting-integration/verification/live-20261027` | 无差异 |

15项包含原11项及新增4项；重复运行不累加测试数量。已覆盖30个独立HTTP准备、真实CAS、重复写停止、预算、失败保留、未知用量、模型漂移、冻结来源及完整评分分母。集成测试从磁盘读取review.entry/result/runs/batch-state，并与ledger/attempts逐项核对，避免只比较同一内存对象。

## 失败与修复保留

1. 初次纯函数4项中3项通过：C02-2“，如该坐标……”未被识别为条件句，误记needs_reply。补一般条件句识别后保守记needs_review。
2. 沙箱内完整15项中12项通过，3个HTTP测试均在本地模拟服务启动时失败，真实模型请求0。允许隔离本地监听后重新执行，不更换模型或样本。
3. 完整HTTP轮14/15：新增裸“请”检测误伤C08原文中的备注“外部已核实，请保留”。将未知请求限制在句首，并统一明确输入请求和可选邀请判断中的“您/你/先”修饰规则；补相邻反例后4项纯函数及受影响HTTP用例通过。

保留的临时执行证据：

- 30槽prepare：`/var/folders/td/741qp46d52b2b8_2zdzj7ps40000gn/T/plotting-integration-eval-4BPolT/batch`
- 初轮native4：`/var/folders/td/741qp46d52b2b8_2zdzj7ps40000gn/T/plotting-integration-eval-vZZOWP/batch`
- 重复写停止：`/var/folders/td/741qp46d52b2b8_2zdzj7ps40000gn/T/plotting-integration-eval-RMA8Ci/batch`
- 最终native4：`/var/folders/td/741qp46d52b2b8_2zdzj7ps40000gn/T/plotting-integration-eval-eiaZPE/batch`

## 结束语离线回放及限制

`ending-replay.json` 只读取原30槽最终公开结束语，保存原review哈希与新分类：23 finished、5 needs_review、2 needs_reply。原3个误报均保守转为needs_review；另外4段也被标出需答复/复核，包括条件性的到场依据说明、候选范围检查等。这说明文本启发式仍会过度保守，不能称为完整语义识别器，也不能直接据此改写旧协议状态。

`finished` 只表示未检测到阻塞请求，不证明任务完成或事实正确。例如C10-1遗漏明确属性，仍保持原有语义失败。以后真实批次仍需结合当时请求、工具证据及全部公开表述独立复核；这次回放不计为模型能力改善。
