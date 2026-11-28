# 执行计划：多平台上下文组装对照实验（Issue #4）

> **门禁说明：** 当前任务处于 `planning` 状态。在用户明确批准 [design.md](design.md) 中的方案、模型组合、运行环境与预算上限之前，**不执行 `task.py start`，不修改源码，不发起任何真实付费模型请求**。

---

## Stage 0：方案审阅与环境准备（已完成）

- [x] 用户审阅并确认 [prd.md](prd.md) 与 [design.md](design.md)（统一火山方舟 Key、保留 D2 专项对照、第 2 层 OpenCode + Claude Code CLI、本机 macOS 独立 worktree、预算上限）。
- [x] 执行 `python3 ./.trellis/scripts/task.py start 11-27-context-assembly-eval` 激活执行阶段。
- [x] 确认隔离 worktree (`/Users/lau/workspace/berserk-context-assembly-eval`) 具备 Node `v24.22.3` 运行时并完成 `npm ci`（未触碰主目录 `/Users/lau/workspace/berserk`）。
- [ ] 待用户提供隔离凭证文件 `/tmp/berserk-ctx-eval-secrets.env`（`chmod 600`）并确认方舟端点/模型 ID。
- [ ] 第 2 层运行前在 `/tmp/ctx-eval-tools` 隔离安装 OpenCode CLI 与 Claude Code CLI。

---

## Stage 1：实验框架实现与离线确定性协议门禁（已通过，零付费）

- [x] 在独立分支以零主业务侵入方式实现：
  1. 第 1 层策略模块 [context-eval-strategy.ts](../../../experiments/harness-lab/src/pi/context-eval-strategy.ts) 及可选挂载点（`PiLab.contextEvalStrategy` 缺省保持生产默认行为不变）；
  2. S1–S7 合成规则夹具与正交严格断言 [assertions.ts](../../../experiments/harness-lab/scripts/context-eval/assertions.ts)；
  3. 脱敏 wire 抓包与预算熔断器 [wire-capture.ts](../../../experiments/harness-lab/scripts/context-eval/wire-capture.ts)；
  4. 第 2 层本地脱敏 HTTP 反向代理 [proxy.ts](../../../experiments/harness-lab/scripts/context-eval/proxy.ts)；
  5. 第 1/2 层跑测脚本 [run-layer1.ts](../../../experiments/harness-lab/scripts/context-eval/run-layer1.ts) 与 [run-layer2.ts](../../../experiments/harness-lab/scripts/context-eval/run-layer2.ts)。
- [x] 运行离线确定性验证（真实 Pi `0.85.1` 适配器 + 本地模拟 HTTP）：
  - `npm run typecheck` 通过（0 errors）
  - `npm run lint` 通过（0 errors，Pi/browser 边界检查通过）
  - Vitest 5/5 文件、53/53 用例全绿（含新增 9 项离线协议门禁 + 原有 44 项 `provider-payload`/`multi-provider-context`/`model-platforms`/`model-thinking` 回归）
  - `run-layer1.ts --dry-run` 与 `run-layer2.ts --dry-run` 预检通过。
- [x] **离线门禁已通过，当前暂停等待用户提供火山方舟 Key 后启动真实调用。**

---

## Stage 2：第 1 层核心策略真实验证（已完成）

- [x] DeepSeek (`deepseek-v4.1-flash`, thinking off) × A / B / C / D1（S1–S6）+ D2（S1–S3, S6）：共 126 次真实请求，0 缺失 usage。
- [x] Kimi (`kimi-k2.8-preview`, Anthropic Messages) × A / C / D1（S1–S6）：共 78 次真实请求，0 缺失 usage。
- [x] 跨模型 S7（`DeepSeek → Kimi → DeepSeek`）× A / C / D1：共 18 次真实请求，0 缺失 usage。
- [x] 脱敏结果与失败样本全文已落盘至 `research/layer1-out/layer1-results.md` 与 `research/layer1-kimi-out/layer1-results.md`。

---

## Stage 3：第 2 层轻量外部 Harness 参照探针（已完成并清理）

- [x] 通过本地脱敏 HTTP 反向代理完成 OpenCode `1.19.6`（DeepSeek + Kimi）与 Claude Code `2.1.332`（Kimi）的 P0/P1/P2 探针，共 11 次真实请求，全部 wire 实证新规则已送达。
- [x] 结果已落盘至 `research/layer2-out/layer2-probes.md` 与 `layer2-evidence.json`。
- [x] 已清理 `/tmp/ctx-eval-tools`、`/tmp/ctx-eval-npm-cache`、`/tmp/berserk-ctx-eval-*`、`/tmp/berserk-ctx-eval-secrets.env` 与空目录 `~/.config/opencode`；主仓库 `feat/model-management-ux` 与用户自有配置零污染。

---

## Stage 4：综合分析与 Issue #4 决策产出（报告已落盘，待用户拍板收敛方案）

- [x] 完整综合对比报告已落盘至 `research/final-comparison-report.md`。
- [ ] 待用户审阅报告并在「选项 1：全平台统一 C 组」与「选项 2：全平台统一 D1+」之间拍板后，再决定是否实施主业务代码收敛、提交变更及更新 GitHub Issue #4。

---

## 回退点

- 本任务全程在独立分支 `exp/context-assembly-eval`（独立 worktree `/Users/lau/workspace/berserk-context-assembly-eval`）运行，不修改主仓库、不触碰数据库迁移、不部署 4316。
- 如实验过程中止或决定放弃，直接清理临时目录并移除 worktree/分支即可零副作用回退，已采集的脱敏报告可按需保留。
