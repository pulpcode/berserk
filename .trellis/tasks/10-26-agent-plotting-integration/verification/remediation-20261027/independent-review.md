# 第5版修复独立工程复核

日期：2026-10-27。复核角色：Trellis check 子代理。基线：`c6b5dc8`（方案与历史测评记录），原产品测评版本：`8c58af1ed15687915d54e598d1d4ef2c8c248f89`。本复核是 Agent 工程检查，不是用户人工金标或新真实模型成绩。

## 范围

核对第5版方案、实施补充、原整合PRD/设计/实施记录及相关后端/前端符号、标绘和测评规范。产品部分为两个工具描述、两个按需Skill和两个集成测试；测评部分为独立 `evaluation-v2/`、历史依赖清单和复核说明。

产品改动只涉及模型可见描述与Skill正文，没有新增参数结构、服务写入逻辑、前端交互或宿主事实判断状态。A/B/C分别落实目标依据、明确要求完成检查和结论依据核对，保留权限、CAS、字段整体替换与不确定回执规则。新测试检查原生请求/按需Skill实际送达和真实工具组合；不把受控provider选择当模型能力提升。

## 发现及处理

- 结束语中“请先选择目标图层”“为了保存范围，请先提供目标图层”曾因“请”后非紧邻动词被判 `finished`。独立复现后交由该文件的实施代理修复，并补相邻测试。
- 扩大检测到裸“请”后，真实C08-1回答引用备注“外部已核实，请保留”又被当成必要问题。独立纯函数测试曾为3/4通过，已向实施代理报告，不能把引用内容当成用户需回答的问题。
- 可选邀请检测的请求前缀曾与必要输入检测不一致：插入“先/你”会把同一条件输入要求从 `needs_review` 变成 `finished`。已要求复用一致前缀，并保持不明确语句待复核。

上述问题由负责 `evaluation-v2/interactions.ts` 的实施代理修复：请求前缀覆盖常见修饰词，未识别的“请”限于句首，可选邀请使用相同请求前缀；补充必要请求、修饰语与真实引用备注反例。复核代理未并发覆盖其文件。最终独立结束语/计数单测4/4通过；目前未发现待修复的具体问题。

## 验证

本复核代理独立执行：

- 产品 `npm run typecheck`：通过。
- 产品 `npm run lint`：通过，包含Pi/browser依赖边界。
- `git diff --check`：通过。
- 原 `evaluation/` 和旧 `verification/live-20261027/` 对比 `c6b5dc8`：无差异。
- 历史依赖清单455个文件SHA256逐一与原版本Git blob核对，以及原protocol SHA256核对：通过。
- `node --import tsx --test ../../.trellis/tasks/10-26-agent-plotting-integration/evaluation-v2/remediation.test.ts`（package目录）：首次3/4暴露上述C08误报，修复后独立复跑4/4通过。
- 新驱动 `node_modules/.bin/tsc -p ../../.trellis/tasks/10-26-agent-plotting-integration/evaluation-v2/tsconfig.json`（package目录）：最终独立复跑通过。
- 新驱动ESLint：从package目录直接检查外部目录时因全部ignored退出2，未计通过；改从repo根执行 `experiments/harness-lab/node_modules/.bin/eslint --no-ignore --config experiments/harness-lab/eslint.config.js .trellis/tasks/10-26-agent-plotting-integration/evaluation-v2/*.ts`，最终独立复跑通过。

产品260个唯一回归及构建通过引用实施代理的 [product-checks.md](product-checks.md)，本复核没有重复运行这些已通过测试。完整新版驱动HTTP/Pi离线测试由测评器实施代理执行：首轮本地监听受沙箱限制，允许本地监听后14/15通过，唯一失败为上述已修C08纯函数回归；其余包括30槽准备、4槽受控原生读写/CAS、重复写停止和磁盘持久计数对照均通过。最终纯函数4/4复跑补齐该失败，15个唯一检查均有通过结果，不重复计数。详细命令与证据路径见实施代理的 `evaluator-checks.md`。

## 限制与后续

结束语三态仍是保守协议启发式，不能证明所有自然语言问题都识别正确；`finished/recorded`不等于请求完整完成或事实正确，仍需逐项语义复核。复杂可选邀请可以保留 `needs_review`，不为消除旧误报而自动批准操作。

未调用真实模型、未启动或改动4324服务、未合并或提交Git。跨场景真实复测仍按方案另行冻结和授权；原22/30严格成绩不改变。
