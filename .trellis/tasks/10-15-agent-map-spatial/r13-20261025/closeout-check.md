# R13 保存轮补齐：独立离线复核

日期：2026-10-26。复核代理：r13_check。依据：closeout-protocol.md、原 review-rules.md 和当前任务规范。原结果提交为 1757116。

## 结论

**离线门禁通过，允许主会话执行唯一的原 F04-E0 第二保存轮。** 只发送原 fixture.prompts[1]，不重跑第一轮、不执行其他任务、不自动重试或补问。执行前由主会话生成最终 freeze；固定单次 claim 和累计预算必须继续生效。本复核未调用外部模型。

## 已检查并修复的问题

- cases.ts：原“若需要……请告知”已完成后的可选建议不再误判为等待用户。按句及局部邀请处理，不能因整段出现条件词就豁免真正缺信息或授权的问题；混合表达仍阻塞。分类器结果不替代业务完成及事实评分。
- closeout.ts：写 claim 和创建目录前拒绝原批次或原数据目录内部路径。进一步使用 realpath 检查，覆盖 macOS /var 与 /private/var 别名及软链接父目录，避免污染旧证据。
- closeout.test.ts：保留原生自动注入的标绘上下文，改正把 wire user 消息总数误当业务轮数的测试断言。真实两条业务原文分别只出现一次，UI 业务轮数仍为 2。
- closeout.test.ts：删除未使用的 mapTrialRequest 导入；最后 ESLint/TypeScript 均通过。此清理发生在最终 mock 之后，仅删除未使用导入，不改变执行逻辑。

## 恢复和执行边界

1. 完整复制原数据目录，通过原生 Pi 会话加载恢复同一 session；实际 manager 的会话文件必须位于克隆目录。原 native JSONL、API 消息、草稿、权限和原 500 米 resultRef 在付费前校验一致；不手工重构助手/工具历史。
2. 同一产品归档 6a631a4、E0 关闭推理、原生 Skill 按需加载；原工作区业务指令和 Skill hash 校验。保留原端口，端口被占用就停止，不杀其他进程。
3. 入口固定原保存指令，只发这一条用户业务消息。SDK 可正常多次调用工具并继续回答；遇新澄清/权限、网络失败或未知用量就停，不自动回应或重试。
4. 原 46 次、897796 输入、11830 输出结转到新账本，新的正式请求从第 47 次开始；总上限仍为 96 次、2500000 输入、400000 输出。旧账本和旧 claim 不改。新 claim 固定，不能换输出目录重复执行。
5. 新评分材料连接原首轮和新保存轮，保留工具参数及时序；旧结果与误停记录不覆盖。原生成功结束也不自动认定语义通过，正式结果仍须检查实际保存效果和公开说明。

## 验证证据

- 独立 ESLint：通过，退出码 0（session 70852）。命令在仓库根目录执行：
  `./experiments/harness-lab/node_modules/.bin/eslint --config experiments/harness-lab/eslint.config.js --no-ignore .trellis/tasks/10-15-agent-map-spatial/r13-20261025/*.ts`
- 独立 TypeScript：通过，退出码 0（session 78883）：
  `./experiments/harness-lab/node_modules/.bin/tsc --noEmit -p .trellis/tasks/10-15-agent-map-spatial/r13-20261025/tsconfig.json`
- 独立分类器回归：4/4 通过（session 29448）；在 experiments/harness-lab 执行：
  `node --import tsx --test ../../.trellis/tasks/10-15-agent-map-spatial/r13-20261025/clarification-closeout.test.ts`
- 恢复回路：实现代理的最终真实 Pi/HTTP + mock provider 测试 1/1 通过（session 59934，14.37 秒），命令为同目录下 `node --import tsx --test ../../.trellis/tasks/10-15-agent-map-spatial/r13-20261025/closeout.test.ts`。复核代理另行只读核验其原始证据：
  `/private/var/folders/td/741qp46d52b2b8_2zdzj7ps40000gn/T/r13-offline-closeout-Qlpf4A/`
- 上述 mock 的 closeout/result.json：结转 2 次 mock 请求，新执行 3 次，累计 5 次，unknown=0、stop=null。review.json 实际从 16 对象变为 17 对象，恰新增 saved-range，旧 16 对象逐项相等；annotation_from_analysis 使用原首轮 resultRef。测试还断言同原几何、原 JSONL 前缀、旧证据与数据 hash 不变、单次 claim 和路径隔离。
- 同目录 failure/result.json：429 只发 1 次 mock 请求，unknown=1、stop=provider_http_429，没有重试。直接原路径、realpath 别名及软链父目录均在创建 claim/输出前拒绝。
- mock 首轮 2 次属于离线夹具；正式入口另行核对旧批次必须为 46 次。mock 不代表真实保存任务已经完成。

## 最终源码 SHA-256

| 文件 | SHA-256 |
|---|---|
| cases.ts | 929715625b774aea34a0aeab43a855a4591c62f23cd5c7a3dca523c1a0ccf7e7 |
| live.ts | cebd1edce2d8388bed1f34e80dfea3613dff06d5d0eabb554dc0a5a52119f619 |
| closeout.ts | 1bccfca442e15bd9156905af32b97e779f848921a7b85bd41a0880f8eb52f153 |
| closeout-runtime.ts | 61af83ab49d9fb2ef501b8e45c8b29fc7122f8d41a38c6800d6df41c16056073 |
| closeout.test.ts | 34e5559bd9468a8d03df91b49651a29aa2d4f836831e85997ca9f96987e30a67 |
| clarification-closeout.test.ts | c21e22d8e33e20c5b60c486e1ec45023e31b177ff4400b74ba418597ad9423ba |
| closeout-protocol.md | a9a1d9a4d0548d13c90bdbd3ef600db0893e6536d3ab4bf7efa05b1145629a7d |

## 未修复事项及限制

无剩余阻断问题。本地分类器仍是有限表达规则，不能代替全部自然语言的语义理解；本次覆盖真实误停和相邻反例，不据此宣称通用澄清识别已解决。真实保存正确率、公开解释是否准确，须待唯一正式补齐后独立复核。原结果保持历史状态，补齐单列；一次补齐不能构成新的独立样本或稳定性证明。
