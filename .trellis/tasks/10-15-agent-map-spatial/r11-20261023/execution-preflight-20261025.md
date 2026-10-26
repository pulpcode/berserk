# R11 真实执行前核对（2026-10-25）

用户已接受C30—C37的替换材料和判定，并授权在离线检查后执行24次评分校准；校准通过后执行四组64项及初次评分，不重试、不追加。本文件记录启动前核对与命令，不表示已调用模型。

## 当前可用配置

- 工作树：`/Users/lau/.codex/worktrees/agent-result-grounding/berserk`，分支`codex/agent-result-grounding`。
- Node：`v24.14.0`。
- 当前工作树`experiments/harness-lab/.env.local`存在；`LLM_API_KEY`已设置，仅检查非空，未显示其值。
- `.env.local`中的`LLM_BASE_URL`为`https://ark.cn-beijing.volces.com/api/plan/v3`，`LLM_MODEL`为`deepseek-v4.1-flash`；父进程未设置覆盖它们的同名变量。
- 固定评分配置可直接使用`calibration-v2/judge-config.example.json`。它不含密钥，内容已经与配置schema和执行器约束一致；没有必要复制或另建一份配置。
- 请求型号`deepseek-v4.1-flash`，响应型号严格核对`deepseek-v4-1-flash-261017`；thinking disabled，输出上限8192。评分为非流式JSON，Agent为原生Pi流式工具循环。没有其他计费端点或模型回退。
- 核对时，唯一共享账本`.local/spatial-r11/ledger.json`尚不存在；`.local/spatial-r11/`仅有历史证据目录。没有删除或清空既有账本。

以上是本地配置核对，没有额外连通性请求或额度查询。实际响应型号及usage由获准的首条校准请求验证；Agent Plan端点本身不证明账户扣费方式或余额。

## 必须先满足的离线条件

1. 新24条材料、人工标签、来源记录和曝光记录全部完成，`--materials-only`与`--verify-labels`通过。新8条为5条真实历史与3条构造错误对照，来源保留在评审记录中，不以标签暗示评分器。
2. 评分输入仍使用相同顶层字段白名单，不把人工标签、建议判定或构造来源类型送入评分请求。保留评价该声明所需的公开语境，后来的证据不能给先前断言补证。
3. 全24条实际评分请求在离线阶段通过`requestBody`的字段、模型配置和完整输入大小检查；不截断材料以绕过100 KB保守保护。
4. TypeScript、受影响的ESLint和评分器离线测试通过，独立检查完成，所有源码/材料稳定后再生成新的freeze文件。

冻结覆盖`calibration-v2`内的材料、代码、标签和文档（仅跳过`__pycache__`），也覆盖R11根目录的TS/JSON及复用代码。**真实批次期间不要修改这些文件，连校准目录内的说明文档也不能改。** `.local/spatial-r11/`运行产物不会反过来改变冻结值。

## 准确执行命令

以下命令均从`experiments/harness-lab`执行。输出目录必须尚不存在，禁止覆盖旧证据。64项与评分必须使用同一freeze、同一评分配置和唯一共享账本。

```bash
cd /Users/lau/.codex/worktrees/agent-result-grounding/berserk/experiments/harness-lab

# 1. 所有离线检查与独立检查通过、文件稳定后：只准备冻结，不调用模型。
node --import tsx ../../.trellis/tasks/10-15-agent-map-spatial/r11-20261023/live.ts prepare \
  /Users/lau/.codex/worktrees/agent-result-grounding/berserk/.local/spatial-r11/freeze-20261025.json

# 2. 24次评分校准。失败、格式不合法、usage未知、型号变化均停止，不重试。
node --import tsx --env-file=.env.local ../../.trellis/tasks/10-15-agent-map-spatial/r11-20261023/judge.ts calibrate \
  /Users/lau/.codex/worktrees/agent-result-grounding/berserk/.local/spatial-r11/calibration-20261025 \
  /Users/lau/.codex/worktrees/agent-result-grounding/berserk/.local/spatial-r11/freeze-20261025.json \
  /Users/lau/.codex/worktrees/agent-result-grounding/berserk/.local/spatial-r11/ledger.json \
  /Users/lau/.codex/worktrees/agent-result-grounding/berserk/.trellis/tasks/10-15-agent-map-spatial/r11-20261023/calibration-v2/judge-config.example.json

# 3. 只有校准gate-result.json确认8/8且共享账本可核对时才执行64项。
node --import tsx --env-file=.env.local ../../.trellis/tasks/10-15-agent-map-spatial/r11-20261023/live.ts run \
  /Users/lau/.codex/worktrees/agent-result-grounding/berserk/.local/spatial-r11/batch-20261025 \
  /Users/lau/.codex/worktrees/agent-result-grounding/berserk/.local/spatial-r11/freeze-20261025.json \
  /Users/lau/.codex/worktrees/agent-result-grounding/berserk/.local/spatial-r11/ledger.json \
  /Users/lau/.codex/worktrees/agent-result-grounding/berserk/.trellis/tasks/10-15-agent-map-spatial/r11-20261023/calibration-v2/judge-config.example.json \
  /Users/lau/.codex/worktrees/agent-result-grounding/berserk/.local/spatial-r11/calibration-20261025/results.json \
  4617

# 4. Agent批次停止并封存后，按原始证据作每项至多一次的初次评分。
node --import tsx --env-file=.env.local ../../.trellis/tasks/10-15-agent-map-spatial/r11-20261023/judge.ts grade \
  /Users/lau/.codex/worktrees/agent-result-grounding/berserk/.local/spatial-r11/grading-20261025 \
  /Users/lau/.codex/worktrees/agent-result-grounding/berserk/.local/spatial-r11/freeze-20261025.json \
  /Users/lau/.codex/worktrees/agent-result-grounding/berserk/.local/spatial-r11/ledger.json \
  /Users/lau/.codex/worktrees/agent-result-grounding/berserk/.trellis/tasks/10-15-agent-map-spatial/r11-20261023/calibration-v2/judge-config.example.json \
  /Users/lau/.codex/worktrees/agent-result-grounding/berserk/.local/spatial-r11/calibration-20261025/results.json \
  /Users/lau/.codex/worktrees/agent-result-grounding/berserk/.local/spatial-r11/batch-20261025
```

各阶段分开启动，不把上述命令连成无人工检查的流水线。校准未过不修改规则再重跑，也不进入64项。执行中定期只读`ledger.json`和阶段进度文件；不频繁转储完整请求、原生历史或环境配置。若确认无进展循环，停止当前进程并保留记录。整批预算保护、单任务完成余量及不自动续批规则不变。

## 本次检查记录

2026-10-25：环境与既有命令核对完成；R11 TypeScript检查、judge两文件ESLint通过。评分器离线测试10/10通过，全部使用注入的模拟响应，没有真实请求。当前24条输入为16条开发材料加C30—C37八条验证材料，均通过真实`requestBody`的完整请求构建；请求大小为13,696—58,462 bytes，未截断。既有judge实现与新材料兼容，无需修改。端口4617核对时未发现监听。

材料负责人已确认稳定；`--materials-only`完整性通过、无错误，`--verify-labels`返回`ready=true`且人工确认24条。验证集为4条失败、4条通过，来自5条历史轨迹（其中3条为人工构造错误对照）；此范围仅支持本轮评分校准，不代表广泛独立保留集。最终材料哈希：manifest `edce0788d28b58540b78900592f9aa34e2f878d69496f9f308070c568bc35efa`，inputs `7da21781cf39a31888b982071057c8222c19946680b129f5b4c70f07689524f6`，labels `d0d9382b468129a54e12927e2bd04907edc37021091647bf6fccc6f3a159a0d0`。

等待独立检查通过和执行消息后生成freeze。未调用真实模型，未创建freeze或新账本，未提交Git。

执行状态补记：以上为启动前记录。2026-10-25已按授权执行校准和64项任务，整题评分在首条格式失败后停止；完整结果见[本轮结果](results-20261025.md)。
