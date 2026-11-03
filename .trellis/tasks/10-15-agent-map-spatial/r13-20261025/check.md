# R13 独立离线复核

> 2026-10-26。方案提交 `94fbdbc`，用户已批准“提交方案git，然后开始本轮”。本页由独立检查代理维护。结论：**离线检查通过，放行主会话按已批准协议启动唯一正式批次。** 本结论不表示真实模型结果或90%效果验收通过。

## 审查范围及保留边界

仅 R13 任务本地评测驱动、夹具与记录。未改产品、旧 R11/R12 证据、SDK 内核或部署。两组共同使用 `6a631a42b99b01de334cd2017c07bf0d9d58a560` 产品归档及原生按需 Skill。共10个完整任务、16条预定业务用户消息；预算为共享96请求、250万输入、40万输出，单任务12请求/24工具/10分钟只警示。

主会话在放行前重新核对 `.local/spatial-r13/history-before-20261026.json`：4532份历史文件、7份产品文件及整个 harness-lab Git diff 均与开工前一致。检查代理未调用真实模型、创建正式批次声明或提交 Git。

## Findings（已修复并复核）

- `runtime.ts`：初版将总请求时限设为不合法的0；现删除 `LLM_REQUEST_TIMEOUT_MS`，保留原生默认和300秒无HTTP字节空闲保护，整轮无额外时限。两组产品归档无候选改动。
- `cases.ts`：配对校验改成明确字段路径，仅归一化生成的身份、指定时间和端口；业务名称、几何、属性及业务日期保留。属性恰好等于动态ID仍会检出不同，避免抹平业务差异。
- `cases.ts` / `live.ts`：分离“普通阻塞澄清”与“可按原题回答的澄清”。未提供事实/权限不自动补充，普通问题和交互API分别记录；原生技术错误停止批次。
- `live.ts`：冻结五份实际历史夹具、实际旧helper及HTTP/夹具脚本、SDK、共同归档和评分/协议文件。换输出目录不能绕过唯一正式批次声明。
- `provider.ts`：截断在尝试、共享账本和停止原因中一致记录；合法JSON但不符合工具schema的参数错误仍走原生工具纠错。未知用量、HTTP失败、模型漂移后不再外发。
- `live.test.ts`：修正多行Skill在JSON转义后的无预加载断言；真实输入确认首请求有目录无正文，随后由原生 `skill_read` 送达正文。
- `live.ts`：多轮前提按不同 `resultRef` 计数，读取同一范围不冒充生成第二范围。无真实结果时不捏造后续依赖；半径、沿用顺序、必要内容留语义评分。
- `live.ts`：盲审材料显式区分模型实际wire输入与宿主/UI真值；隐藏几何、状态真值不能反向证明模型当时读到了它。

修复由对应文件的并行实现者完成，检查代理核对最终代码及回归，未覆盖并行修改。

## Verification

- **Lint：通过。** 检查代理从仓库根目录执行：
  `./experiments/harness-lab/node_modules/.bin/eslint --config experiments/harness-lab/eslint.config.js --no-ignore .trellis/tasks/10-15-agent-map-spatial/r13-20261025/*.ts`
- **TypeCheck：通过。** 检查代理执行：
  `./experiments/harness-lab/node_modules/.bin/tsc --noEmit -p .trellis/tasks/10-15-agent-map-spatial/r13-20261025/tsconfig.json`
- **Tests：通过。** 实现者执行，检查代理阅读测试源码及结果：runtime/真实HTTP夹具4/4；provider-budget + live完整集14/14；最后仅修改不同resultRef前提与证据标签后，重跑受影响的完整10任务真实SDK模拟及去重单测2/2。共覆盖19个不同测试，不把回归重复计成新增用例。
- 测试命令从 `experiments/harness-lab` 执行：
  `node --import tsx --test ../../.trellis/tasks/10-15-agent-map-spatial/r13-20261025/runtime-cases.test.ts`
  `node --import tsx --test ../../.trellis/tasks/10-15-agent-map-spatial/r13-20261025/provider-budget.test.ts ../../.trellis/tasks/10-15-agent-map-spatial/r13-20261025/live.test.ts`
  最终受影响回归：上述 `live.test.ts` 中“ten real native SDK trials”与“dependent turns require distinct real results”。

证据由各测试保留于系统临时目录 `r13-fixture-*`、`r13-offline-complete-*`、`r13-offline-failure-*`、`r13-offline-boundary-*`、`r13-offline-clarification-*`，包含真实本地后端状态、原生SDK历史、mock provider输入/响应及账本；不是付费模型结果。实现者终端测试记录：完整集session70032；最终回归session11143。检查代理最终lint/typecheck终端记录：session41103、session65193，均exit0。

覆盖：十个新会话/全部预定用户轮、真实查询/计算/固定结果保存、E1同轮工具及新用户轮的原生思考字段回传、思考不进入公开回答/盲审输入、参数纠错、普通与API澄清、HTTP错误/模型漂移/未知用量/截断不重试、缺失多轮前提/未知问题不误当完成、共享上限和非父请求配置/计数。非父请求是适配器级模拟，不声称真实发生子代理或compaction。

## Findings（未修复）及放行条件

没有遗留阻断问题。未追加产品接口、通用状态体系或默认推理配置；本轮新增约定已落在独立 `protocol.md`，无需修改产品规范。

放行仅适用于下列最终源码与既定10项、同一预算；主会话先生成freeze，再唯一一次run。不得自动重试、扩样或恢复，正式前后继续核对历史基线。

真实执行后的语义复核仍必须独立完成：`recorded/succeeded`不等于正确；F04另核对恰新增一对象、同一固定结果与几何、原对象保留及无发布/采用；全程解释依据实际送达模型的输入，先盲审再揭盲。私有思考不作为答案正确证据。

## 放行源码快照

| 文件 | SHA-256 |
| --- | --- |
| `budget.ts` | `f8d35babb961e40577d4bafbf25c8558e980062462a21aabe09f776802cf0634` |
| `cases.ts` | `1ddbca05d7043d79164fdbc42b8f4f1c10b08a11e55d6cbd535a9fdd919ea02a` |
| `live.ts` | `cebd1edce2d8388bed1f34e80dfea3613dff06d5d0eabb554dc0a5a52119f619` |
| `provider.ts` | `be7a0690aaf3d96f3c5ac280f9ccffffb6dbe664bf54e1dd38e064986d18dca3` |
| `runtime.ts` | `df150232d1bd6b9abd8bc4c3efabfe6274a0b672ec561ecc683aae159675a0c7` |
| `live.test.ts` | `7c40465dc3aa8aa16b9cb578a2741b55ac3dc6d3a77b72b6ef42c5d9eb697d55` |
| `provider-budget.test.ts` | `1a6b8dc92d7f349494f048e7d1f2101ff6cfc8c0287022e0bb5a5d50571b2cf7` |
| `runtime-cases.test.ts` | `1977ebc13cbfb67cef3c2de030fc47484eb02663390bef6f8e3def1d122420f6` |
| `protocol.md` | `c729abeddd637bbc846fdcf1cc02ce9b29e431b18773712d8b36d9cadbe6b33c` |
| `review-rules.md` | `8c6739863cff2af121a51631b19564c6f9494c767dbc6d8b5cdbea9c2249075e` |

## 驱动离线检查补充（2026-10-26，r13_loop）

工作目录为 `experiments/harness-lab`。以下全部使用显式 mock 提供商，只访问本机 HTTP/Pi 和真实后端工具，真实模型调用 0；没有创建 live-claim。

- 完整驱动检查：`node --import tsx --test ../../.trellis/tasks/10-15-agent-map-spatial/r13-20261025/provider-budget.test.ts ../../.trellis/tasks/10-15-agent-map-spatial/r13-20261025/live.test.ts`。会话 70032，**14/14 通过**，120.56 秒。覆盖预算边界、wire配置/历史不改写、响应协议、非父模型请求入账；10个隔离任务全工具循环、E1同轮/跨轮thinking、参数纠错、真实保存；4种提供商失败；3种任务边界；普通/API澄清。
- 之后按审查只修正“重复读取同一buffer不能算第二个结果”，并给盲审材料增加模型可见证据/宿主真值的用途标注。新增去重单测，运行 `node --import tsx --test --test-name-pattern='ten real native|dependent turns' ../../.trellis/tasks/10-15-agent-map-spatial/r13-20261025/live.test.ts`。会话 11143，**2/2 通过**，50.19 秒，其中完整10任务为复跑，不另算新的模型评测。
- 真正完整 mock 的原始账本、输入、SSE、工具结果和状态在 `/private/var/folders/td/741qp46d52b2b8_2zdzj7ps40000gn/T/r13-offline-complete-8Nt4rc/batch`（14项检查中的完整任务）和 `.../r13-offline-complete-RaJXf8/batch`（最终受影响复查）。两者均10任务 recorded、56个mock请求、无未知用量；这不代表模型语义正确率。
- 最终失败证据：同一临时目录下 `r13-offline-failure-yk6d67`（429）、`km866k`（模型漂移）、`rpE8IS`（未知用量）、`0ELruP`（截断）；各保留1次尝试，后续任务未执行。边界记录为 `r13-offline-boundary-kXjQmU`（缺少依赖）、`Kg9sui`（未知普通问题）、`PHPrqj`（本机技术失败）；澄清接线为 `r13-offline-clarification-mbAm8p`。
- 首次离线运行会话 45847 是 **11/12通过、1失败**：实现者运行中追加测试导致源码冻结校验拒绝继续（`r13-offline-complete-WbGDPU`），原记录保留，之后固定源码重新运行。未把该次计成正式模型测评。
- 以上测试 stdout 由工具会话保留，未声称存在另存的原始 stdout 文件；临时目录是可复核的原始离线运行证据。最终 TypeScript/ESLint 由独立 reviewer 再核对。
