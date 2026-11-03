# 接入现有测评流程

## 1. 交付状态

本包已经完成场景、JSON 业务数据、标准答案和离线校验。**尚未编写或运行产品接入适配器，现有 runner 不能直接接收这些 JSON。** 应复用原生冷启动流程，加一层任务范围内的 fixture/题干适配，不另建 Agent runner、状态机或产品级门禁。

核对基准为分支 `codex/agent-spatial-plotting` 的 `925314f995f1e05f136818bcc18a6bd99c7e9614`。如果执行时分支已经前进，先固定实际版本；不要默默用新代码，却沿用本包的旧版本说明。

## 2. 选择正确的运行基线

本轮目标是当前产品的来源选择泛化，所以使用该提交的实际产品文件，当前两份 Skill 对应 G2。上轮 `qwen-comparison-20261030/comparison.ts` 用的是 G1 历史现场；不要复制它的历史消息重放或前两次预制工具调用。

旧 `improvement-20261029/runtime.ts` 会归档 `74986e0`，再覆盖四份候选文件，因此调用 `buildRuntime(...,'G2')` 本身并不等于“直接运行当前 HEAD”。如复用该函数，必须在运行清单中明确历史基座及覆盖文件；要声称当前产品测试，需核实与当前产品运行代码一致，或改为隔离归档本包固定 HEAD。仅改变运行封装与 fixture，保持被测产品逻辑不变。

固定模型为上一轮 Flash 对照用的请求 ID、思考开关/high 和 32768 输出上限，实际回包版本必须记录。`manifest.json` 给出的是已观察的版本约束，不是声明该型号永远不变。重试、采样、工具注册等沿正常已确定配置并记录，不随用例改变。

当前产品的正常系统/工作区指令与受控 Skill 目录要被保留。旧驱动在 `run.ts` 中另写了 `businessContext`；如果复制该段额外来源规则，就不再是仅验证当前产品默认指令。接入时明确选择并冻结：本包建议使用产品正常指令，只将场景任务背景保持中性，避免任务描述暗含资源调度目标。不得注入“本题考来源歧义”“候选/区域要分别确认”等评测提醒。

## 3. 两种 fixture 结构分别接入

每个 fixture 顶层是评测包装，不直接传给模型或业务接口。接入者只分发其中的业务字段：

| 字段 | 去向 |
|---|---|
| `draftLayers` | 通过真实草稿创建接口逐层 `add_layer` |
| `sourceScene.objects/reports/asOf` | 独立模拟来源后端的 scene |
| `logical_source_system_id` | 与本次真实模拟实例 ID 建立机械映射 |
| `case_id/schema_version/business_time` | 评测记录；业务时间同时用于同步场景时钟 |

草稿是 `AnnotationLayer/AnnotationFeature`，来源是 `SituationObject/ContextRef`；不要相互原样复制。

来源对象使用 `ref:{systemId,objectType,objectId}`、`revision`、`areaIds`、`effectiveAt`、`validTime`、`geometry`、`properties`。所有 `validTime:null`，来源 `asOf` 与 `effectiveAt` 固定为 `2026-10-30T09:00:00+08:00`。同步 `probe-situation-map.ts` 的 day 与任务 `context.focus.time`，避免以真实宿主时钟隐式筛掉本次数据。宿主 `queriedAt` 仍记录真实查询时间，不能冒充源数据快照时间。

草稿区域位于 `reference`，候选点位于 `resources`。G05 的 `resources` 中另有一条线，不能把整层当纯点集合。来源候选为 `objectType=resource` 的 Point；G04 另有 `road` 干扰对象。所有几何都在同一小范围，不保留旧 fixture 的远距离道路。

**替换本次模拟实例的整份 scene，不在旧默认对象列表后追加。**否则会多出未计入 oracle 的候选、同名区域或跨 10° 几何。更新配套目录/系统绑定/任务引用，确保只暴露本题预定的对象，而不是让引用仍指向已删掉的旧区域。

具体需要同步核对 `context.config.systems[].areas`、`task.context.focus.areaIds`、`task.context.businessRefs` 和 `manifest.objects`。旧 `startMapTrial` 中的 west/east 区域与 `map-…-road-west-01`、`map-…-vehicles-west-01` 等引用不能继续悬空存在；可清除不适用引用，或一致映射到本题真实存在的对象。不要通过隐蔽传入黄金候选 ID 来掩盖残留。

### 机械映射

运行时只允许替换：逻辑来源 systemId、后端实例/workspace/session ID、真实草稿 setId/revision、生成的创建/查询时间、请求 ID 等运行身份。映射表写入证据，并能逆向映射回 oracle。

`objectId`、名称、区域几何、点几何、属性、标签、成员关系及题干保持原样。若接口要求带实例前缀，可一对一映射这些逻辑对象 ID，但不得更改其关系或省略对象。所有 `memberRefs` 也必须应用同一映射。

当前产品的来源系统目录通常以 `situation` 标识系统。接入可把本包逻辑 systemId 整体映射为该已配置系统，或注册真正可发现的新系统；必须连同对象、成员引用和配置一起映射，不能把任意逻辑字符串直接当成可调用工具的系统。

真实草稿 ref 从创建/读取回执取得，不能写死 UUID 或 `latest`。`fixture-source-g01` 等只是逻辑别名，不能未经绑定当成真实来源实例。

G04 的区域 `memberRefs` 与 `areaIds` 一致，但二者有意不等于几何包含关系。不要按空间位置修正它们，也不要用它们预先缩小“全部来源资源点”。其标准答案是全体合法资源点中的几何命中结果。

## 4. 冷启动流程

复用 `improvement-20261029/run.ts` 的原生会话/SSE/复核流程，但替换静态导入的固定 cases、schedule、prepare 和旧 fixture 选择逻辑。

1. 每题启动独立模拟后端与产品运行实例，加载本题来源 scene。
2. 调用 `POST /api/tasks/{manifest.tasks.supply}/workspace` 建独立工作区。
3. 调用 `POST /api/sessions`，body 为 `{workspaceId}`。
4. 通过 `POST /api/sessions/{sessionId}/annotation/actions` 创建草稿：`action:create_draft`、真实生成的 `clientActionId`、`baseRef:null`，将每个 `draftLayers` 作为 `add_layer` 操作。
5. 固定正常产品指令与中性任务背景，记录哈希；保存来源与草稿开始状态。
6. 确认会话没有旧 assistant/tool 消息、已读 Skill 正文、旧分析结果或指定 `contextRefs`。
7. 向 `POST /api/sessions/{sessionId}/messages` 发送且仅发送 `{text:当前题prompt}`。
8. 让 Agent 自行发现、查询、读取方法和计算；按 `PROTOCOL.md` 发送固定澄清，不发送纠错反馈。
9. 保存完整调用参数和回执、前后业务状态、用量、结束原因，再做语义判分。

前置建草稿属于 fixture 准备，发生在开始状态快照之前，不是本题 Agent 的业务副作用。准备阶段的读取不能作为旧工具消息注入被测会话。

`noSkills:true` 在当前实现中关闭的是 Pi 文件系统自动发现；受控 `skill_read` 仍可用。不应由适配器替模型加载 Skill 正文。来源几何通过 `situation_query`，不要误用读取固定资料的 `source_read`。

## 5. 在任何模型调用前完成的接入核验

离线校验器已经检查数据本身；适配器还需通过既有 prepare/mock 流程核验以下真实行为：

- 来源目录、工作区绑定和任务引用解析正常；每题确实只有一个可用来源系统及两份指定区域。
- 全量来源查询可以取得 fixture 中全部资源点；G04 的两个未贴区域标签的内部点仍然可发现，不能被默认 task area 或查询适配提前隐藏。
- 草稿创建成功，固定 ref 可读；完整图层、名称、几何和对象 ID 与 fixture 一致。
- 没有遗留旧场景对象、其他区域、历史消息、Skill 预读或答案提示。
- G01/G02 的跨来源组合是当前工具支持的合法请求；点/线类型筛选不会被 fixture 适配层偷做成模型答案。
- 正常澄清可逐轴答复，双轴题不会因复用旧 T03 的单个 replyId 而在第二个合法问题时中止。
- 普通文字与 `ask_user` 均可传回预定来源选择；G07 的交叉选择不能被驱动悄悄改成同来源选项。按产品原生支持的自由文字机制处理；驱动不能表达合法回复时先修接入，不靠改用户偏好通过。
- provider 请求参数与回包版本、思考字段处理、工具调用参数记录及用量统计可核验。

这些检查失败时修复 fixture/适配层，不将其计为模型答错，也不为了让数据检查通过而改黄金几何结果。

## 6. 证据与评分的物理隔离

不将 `oracles/`、预留目录、评分模板、本文、完整测试包或离线预计算结果挂载到被测 Agent 可读目录。只在后端注入业务对象，通过正常接口暴露。用户首条消息只有题干；系统/Skill 不增加答案线索。

本包逻辑 ID、fixture 包装及评分标记都属于评测侧。被测业务对象中不含 `expected`、`inside`、测试象限或标准答案字段，点名也不暗示内外。

预留集还需与负责修改 Skill/工具的 Agent 隔离。若整个包进入其工作区并被读取，就将预留集标为已见回归数据。

## 7. 已核对的仓库依据

以下链接固定到审阅提交，避免分支后移改变依据。

- [当前空间 Skill：来源分别确认、真实几何与答复核对](https://github.com/pulpcode/berserk/blob/925314f995f1e05f136818bcc18a6bd99c7e9614/experiments/harness-lab/fixtures/skills/spatial-analysis/SKILL.md)
- [原生场景准备与草稿接口](https://github.com/pulpcode/berserk/blob/925314f995f1e05f136818bcc18a6bd99c7e9614/.trellis/tasks/10-28-agent-spatial-plotting/live-20261029/cases.ts)
- [冷启动运行、会话与交互复核](https://github.com/pulpcode/berserk/blob/925314f995f1e05f136818bcc18a6bd99c7e9614/.trellis/tasks/10-28-agent-spatial-plotting/improvement-20261029/run.ts)
- [历史基座与 G0/G1/G2 覆盖机制](https://github.com/pulpcode/berserk/blob/925314f995f1e05f136818bcc18a6bd99c7e9614/.trellis/tasks/10-28-agent-spatial-plotting/improvement-20261029/runtime.ts)
- [上一轮续跑与 G1 选择](https://github.com/pulpcode/berserk/blob/925314f995f1e05f136818bcc18a6bd99c7e9614/.trellis/tasks/10-28-agent-spatial-plotting/qwen-comparison-20261030/comparison.ts)
- [来源对象数据契约](https://github.com/pulpcode/berserk/blob/925314f995f1e05f136818bcc18a6bd99c7e9614/experiments/harness-lab/src/contracts/context.ts)
- [草稿图层与对象数据契约](https://github.com/pulpcode/berserk/blob/925314f995f1e05f136818bcc18a6bd99c7e9614/experiments/harness-lab/src/contracts/annotations.ts)
- [来源 fixture 与成员标签处理](https://github.com/pulpcode/berserk/blob/925314f995f1e05f136818bcc18a6bd99c7e9614/.trellis/tasks/10-15-agent-map-spatial/r15-20261027/data.ts)

交付只完成测试设计与数据校验。上述链接和接入说明不替代实际适配后的 prepare/类型检查结果。
