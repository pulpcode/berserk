# 读取依据与失败恢复：实施和验证清单

日期：2026-10-14。状态：**实现、独立审阅及固定真实模型复测完成，保留已披露问题。** 以下勾选只表示实际完成的工作。

基线：`e9a01b4`（完善地图标注工具与会话工作流）。上一阶段完成清单可在该提交查看，实际结果仍见 [validation.md](validation.md) 与 [review.md](review.md)。本次依据 [PRD](prd.md) 的 RC1～RC8 和 [设计](design.md)，新结果另存，旧报告不覆盖。

## 0. 开工条件与范围

- [x] 用户明确批准最新修订设计实施，并要求完成后用原场景复测。
- [x] 开工时核对工作区变化、Pi 版本、当前 hooks；加载本次相关 backend spec（未改前端）。批准方案与原已实施 spec 的差异按本稿范围处理，不自行扩大。
- [x] 保留 e9a01b4 与旧固定批次证据，记录新实现边界；不推送、不部署，除非后续另有指令。

主要责任文件：`experiments/harness-lab/src/pi/annotation-state.ts`、`annotation-tools.ts`、`lab.ts`，必要的 `context-tools.ts`；`src/annotations/service.ts` 及实际需要的错误契约；现有地图 Skill 与相关测试。没有需求时不改 Web 布局、HTTP 参数或数据库结构。

## 1. 先固定可复现边界

- [x] RC1：无 draft read 直接创建；固定基线创建；已存在草稿、绑定不匹配、准备后绑定改变、并发创建、撤权/取消，失败均无额外修订。
- [x] RC2/RC3：读取来源后创建/参数失败仍保留来源；草稿冲突后来源保留；单个来源变化后草稿及其他来源保留；缺多项时一次列出已知缺项。
- [x] RC4：真实 Pi loop + 假 provider，三写第二项失败后第三项未执行；下次推理修正普通参数即可用保留依据，不能因全局 blocked 要求无关重读。
- [x] RC5：覆盖 schema 拒绝、before hook 拒绝、after hook 标错/替换、tool_execution_end；新的失败观察不提升，不删除旧确认依据。
- [x] RC6：同请求 steer/follow-up、新请求、重启、取消、成功/失败压缩分别断言，不混用一种 invalidate 路径。
- [x] RC7：已提交后回执或钩子异常、旧回执重放、无回执的未决状态；不得重复创建或错误报告未保存。

测试应断言实际草稿内容/修订、来源记录和是否执行后续工具，不只断言内部方法名。新规则需要替换旧的“所有失败都全量失效”断言，不能删去真正的并发/授权保护。

## 2. 创建路径（RC1）

- [x] 取消模型创建前必须观察 empty 的要求；保留显式 null/固定 baseRef。
- [x] 服务捕获并核对当前绑定和无草稿条件，在同一现有事务提交前重检，保留每会话唯一草稿、固定基线访问和动作回执。
- [x] 不将 create 自动转成 apply，不覆盖/追加已有草稿，不自动采用最新任务标注。
- [x] 创建成功根据可信回执建立草稿依据；不能继续依赖旧 emptyBasis 才允许 committed 更新。
- [x] 同一动作幂等返回保持原意图校验和当前权限检查；旧回执不推进当前编辑版本。

## 3. 按资源保留与错误恢复（RC2/RC3/RC4/RC7）

- [x] 去除普通错误触发的全量清空；独立保存草稿、完整来源引用和任务当前序号，使用时仍由服务核对。
- [x] 将同一 assistant 输出的写入暂停与依据记录分开；普通错误在下一次正常推理恢复执行资格，但并不跳过缺失或过期依据。
- [x] 结果不确定使用原动作回执核对；不要仅因下一次推理或读到当前草稿就声称原动作已确定，也不要无回执就换 ID 重放。
- [x] 明确错误类别、相关资源/项、提交状态和必要恢复步骤；不匹配中文错误字符串决定状态迁移，不新建通用错误引擎。
- [x] 在已授权范围一次返回已知缺项；网络/权限错误保持真实原因，不额外探测无权来源。
- [x] 来源记录上限拒绝不得破坏已有记录；继续 1～20 项准备后原子保存，保留真实几何和 UTC 时间。

## 4. Pi 钩子与上下文生命周期（RC4/RC5/RC6）

- [x] 联合修改工具 execute catch、before/after hook、tool_execution_end、input.consumed、compaction、abort，避免残留第二条全量清空路径。
- [x] 新观察只在成功、完整的结果进入下一次正常推理后生效；结果被改坏时只丢弃该调用新观察，不能暴露未交给模型的来源修订。
- [x] 成功本链写入仍可即时推进机械条件；同输出 read/query 不提前授权预生成写入。
- [x] 同请求补充输入保留记录并等待下一次推理处理意图；不解除尚未返回模型的批次暂停、不改变捕获身份。
- [x] 新请求/重启不恢复请求缓存；成功压缩采用保守按需重读，失败压缩及取消沿用停止逻辑。
- [x] 保留 Pi 原生 sequential、重试和原 hooks，不修改 SDK/内核/provider，不引入自有调度或跨请求缓存。

## 5. 说明、兼容与规范

- [x] 修改工具描述及 map-annotations Skill 中与创建/恢复规则冲突的文字，保留按需读取、来源保真和图层澄清要求；不强制每次加载整份 Skill。
- [x] 保留 HTTP 显式 CAS、旧工具历史/回执、既有地图入口；结构化错误不得被 UI 误认成成功写入结果。
- [x] 验证请求/用户/席位/任务/会话隔离及读后撤权；授权固定参考不会切换可写目标。
- [x] 验证通过后再同步 `.trellis/spec/backend/map-annotations.md` 等实际受影响规范，同步实际契约。

## 6. 确定性检查

在 `experiments/harness-lab`、Node 24 执行，实际命令如下（测试拆为 12 文件产品回归和 1 文件驱动检查，合计 157 项）：

```sh
npm run typecheck
npm run lint
npm test -- tests/annotations.test.ts tests/annotations-acceptance.test.ts tests/annotation-from-source.test.ts tests/pi/annotations.test.ts tests/pi/annotation-source-history.test.ts tests/pi/annotation-workflow.test.ts tests/pi/annotation-hook-boundaries.test.ts tests/pi/compaction.test.ts tests/pi/message-intake-lab.test.ts tests/pi/recovery.test.ts tests/annotation-map-evidence.test.ts tests/pi/map-skill.test.ts tests/probe-map-workflow.test.ts
npm run build
git diff --check
```

- [x] 上述检查通过；如重命名/新增测试，记录实际命令和结果，不机械保持过时命令。
- [x] 对同请求补充输入、压缩和原 hooks 重点复核：原先安全要求仍成立，但不再靠全量遗忘实现。
- [x] 仅在桌面流程或工具结果呈现实际受影响时补跑对应桌面 E2E；不新增手机检查，不重复无关验收。

## 7. 固定真实模型复测（RC8）

- [x] 开工后冻结新代码、schema、Skill hash、模型配置和独立合成资料，沿用现有已授权真实模型验证范围，不发送实际业务资料。
- [x] 沿用原主流程业务步骤，固定 3 个独立无草稿起步案例（原 main-3 加 2 个名称/措辞变体），都不预建草稿/图层；提示中不写正确工具顺序或机械版本。
- [x] 核对来源查询、首次创建、三对象批量上图、明确发布、来源变化后保 ID 刷新；检查实际几何、时间、图层、旧发布/当前指针；会话隔离另由确定性测试覆盖。
- [x] 记录首次合法调用率、各类错误、连续拒绝、重读对象、工具/模型调用数与 token。重点判定是否仍有宿主全量清空导致的交替拒绝；不能用最终成功掩盖中间循环。
- [x] 任一失败原样保留，不追加运行挑选成功结果。模型自行参数错误、Skill 未加载、图层意图或正文错误分别评分，不承诺本期全部解决。

原 main-3 与新 3 案是有限诊断样本，不据此宣称普遍成功率。若新代码、模型或语料改变，另标批次，不把不同条件混成同一对照。

## 8. 交付与回退

- [x] 新结果保存到 `recovery-validation.md`，必要的审阅保存到 `recovery-review.md`；旧 validation/review 不覆盖，本轮不预建完成报告。
- [x] 报告哪些 RC 通过、哪些未执行/未通过，保留已知图层与正文质量问题。仅恢复机制通过不等于全面业务验收。
- [x] 确认没有表迁移、旧历史改写或新的外部权限；需要回退时依据已提交基线和明确差异处理，不自动重置用户工作区。
- [x] 用户另行要求后再提交新实现或安排部署；本轮未执行提交或部署。

实际批次、全部错误、对照数据及未覆盖边界见 [recovery-validation.md](recovery-validation.md)；独立审阅见 [recovery-review.md](recovery-review.md)。本清单完成不代表全面业务验收或线上发布。
