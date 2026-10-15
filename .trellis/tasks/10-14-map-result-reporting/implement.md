# 地图结果说明改进：执行清单

日期：2026-10-14。状态：**实施与固定复测已完成，所有结果及未通过项见 validation.md。**

方案见 [design.md](design.md)，要求见 [prd.md](prd.md)。当前基线提交 `b201934a15f3cf35ba0b278fcd51c0840464560b`。

## 0. 开工门槛

- [x] 用户在本版方案之后明确批准实施；批准前不运行 `task.py start`、不改产品、不启动模型复测。
- [x] 核对新工作区变化、当前任务及父任务范围；按 Trellis 加载本任务上下文，不把历史任务的批准扩展成本任务批准。
- [x] 保存旧输入固定样本、当前工具/Skill/驱动 hash 和历史证据入口。确认 Node 24、Pi 0.85.1、原模型配置及隔离环境可用。
- [x] 核对十个隔离环境的固定批次与原业务输入；同意的测试材料仍限虚构数据。不部署或推送。

## 1. 按最小范围修改

- [x] D1：基于现有 canSetCurrent 同步工具描述；准确说明动作、固定版本和任务当前的范围。保留原 schema 权限裁剪、服务校验和 Pi 原生参数错误。
- [x] D2：改写已有 map-annotations Skill 的完成核对段，集中表达通用证据边界；不新增场景专名、示范答案或强制全量读取。
- [x] D3：保留 v1/v2 原输出；新增地图输入 v3 及严格历史识别，去掉新输入中手写 href 的指导；维持数据字段和身份边界。
- [x] D4：核对服务回执、来源复制、读取依据状态与 UI 入口未被改动；不顺带增加摘要卡片或 actor 映射。
- [x] D5：复用桌面协同函数增加固定两次 --reporting-recheck 模式，默认五环境不变；补齐全可见文本/问答取证与离线审阅清单。

预期涉及的产品文件：`src/pi/annotation-tools.ts`、`src/pi/composer-input.ts`、`src/pi/history-evidence.ts`、`fixtures/skills/map-annotations/SKILL.md`；均相对 `experiments/harness-lab`。`src/pi/lab.ts` 仅核对现有分派，若函数已覆盖就不修改。数据库、AnnotationService/Store/RequestState、HTTP API 和 UI 组件不在预期修改范围。

## 2. 必要的确定性检查

- [x] 两种任务权限下，schema 与工具描述一致；无权限席位仍不能采用，具权限席位原流程仍可用。
- [x] 固定旧 v1/v2 样本可读取，混合 v1/v2/v3 会话重开并续聊；来源 context-only、新标注上下文、固定引用、纯 Skill/子 Agent 分支都覆盖。
- [x] 篡改身份、requestId、正文、未知字段、重复/晚到输入仍失败；只读子任务不得获得标注写能力。历史文件不被修复程序静默改写。
- [x] 新输入不含手写 `(href)` 指导，自动内容不随地图对象数量增长；旧合法来源链接/固定标注入口仍通过原证据匹配。
- [x] 测试固定协同重复选项、与 prepare-case 的互斥、prepare-only 零模型边界、每次环境独立及无失败重试。默认八场景输入、人工交互规则与步骤未改变。
- [x] 语义取证包含确认前说明、正常问答及最终回复；审阅结果不会注入模型，不能用关键词匹配宣告解释正确。

在 `experiments/harness-lab` 执行，按实际文件变化补充必要的现有测试，不机械新增同义测试：

```sh
npm run typecheck
npm run lint
npm test -- tests/pi/composer-input.test.ts tests/pi/annotations.test.ts tests/pi/map-skill.test.ts tests/context-composer-map.test.ts tests/annotation-map-evidence.test.ts tests/probe-desktop-map.test.ts
npm test -- tests/annotations-acceptance.test.ts tests/annotation-from-source.test.ts tests/pi/annotation-workflow.test.ts tests/pi/annotation-hook-boundaries.test.ts tests/pi/annotation-source-history.test.ts
CI=1 AXON_E2E_PORT=5304 npx playwright test tests/e2e/annotations.spec.ts tests/e2e/situation-map.spec.ts --workers=1
npm run build
```

检查通过后除非有新改动/失败/未解疑点，不无理由重复；确定性检查与真实模型语义结果分开报告。

## 3. 冻结、零模型准备与正式复测

- [x] 构建完成后冻结代码、构建、夹具、Skill、模板、schema、驱动和模型参数；固定三组运行数量，不执行中修改材料。
- [x] 跑完整桌面准备和原来源恢复准备；模型入口必须被 prepare-only 阻止。准备失败不算模型失败，也不能算场景通过。
- [x] 原桌面完整五环境一次；A01→A02 三轮，其他六场景全部完成。
- [x] 固定两次额外完整协同链，使 B01/B02/C01/C02 合计三次独立观察；与完整五环境报告分列。
- [x] 原恢复三例分别执行 S01→S02→S03；同一道路来源变化后刷新，逐项核对保存内容和原发布版。
- [x] 每组结束比对冻结材料；保留所有失败、正常交互、未执行和原始证据，不自动重跑或拼接通过。

以下前四条命令是原有入口，最后两条为本次 D5 已实现的固定协同复测入口：

```sh
LAB_EXECUTION_ENABLED=false node --env-file-if-exists=.env.local --import tsx scripts/probe-desktop-map.ts --prepare-only --port 4361
LAB_EXECUTION_ENABLED=false node --env-file-if-exists=.env.local --import tsx scripts/probe-desktop-map.ts --port 4361
LAB_EXECUTION_ENABLED=false node --env-file-if-exists=.env.local --import tsx scripts/probe-map-workflow.ts --recovery --prepare-only --port 4343
LAB_EXECUTION_ENABLED=false node --env-file-if-exists=.env.local --import tsx scripts/probe-map-workflow.ts --recovery --port 4343
LAB_EXECUTION_ENABLED=false node --env-file-if-exists=.env.local --import tsx scripts/probe-desktop-map.ts --reporting-recheck --prepare-only --port 4361
LAB_EXECUTION_ENABLED=false node --env-file-if-exists=.env.local --import tsx scripts/probe-desktop-map.ts --reporting-recheck --port 4361
```

命令顺序以“所有准备通过→原桌面→额外协同→原恢复”为准，不并发占用相同端口。保留原来源驱动遇额外交互即记录取消的条件，不临时套用桌面操作员规则。

## 4. 独立审阅与交付

- [x] 按 design.md 第 5 节逐条核对状态、归属、保存字段与地图入口；同时核对模型当时确实获得的证据。
- [x] 通过/错误/歧义/信息不足分别记录。C01 不要求每次改备注都查任务当前；C02 不要求故意调用无权限操作来获得拒绝。
- [x] 新增 `validation.md`：完整八场景、额外两次协同、原恢复三例分别列结果；给出操作/说明/效率三列及历史差异、模型参数、全部证据位置。
- [x] 新增 `review.md`：审阅代码边界、旧历史兼容、原场景未被改题及报告是否超过证据；不以一次通过宣称普遍稳定。
- [x] 实际实现后再更新相关 spec 的真实契约；当前待审设计不写成已实施规范。
- [x] 若仍有说明错误或新循环，保留并报告，不自行扩大到模型替换、事实缓存或第二审核 Agent。
- [x] 向用户展示复测结果；提交新实现或上线按后续明确指令处理。

## 5. 回退点

- 真实模型前：确定性检查失败时不启动正式批次。
- 真实模型中：材料变化/跨边界问题停止受影响步骤，保留证据并区分未执行。
- 已写出 v3 后：回退行为时保留 v3 历史读取支持，不直接恢复不认识 v3 的旧程序，不放松历史校验。

实际命令与确定性检查见 implementation-notes.md；真实批次、失败和语义判定见 validation.md。


## 2026-10-15 后续最小改进

用户已批准继续实施。上一轮结论及记录保留；本轮范围以 [base-current-followup.md](base-current-followup.md) 为准，实施见 [base-current-implementation.md](base-current-implementation.md)，检查见 [base-current-review.md](base-current-review.md)，原场景复测见 [base-current-validation.md](base-current-validation.md)。
