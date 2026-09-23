# Research: 单工具工作交接与确认衔接

- Query: 如何把模型侧 prepare/commit 改为一次 `work_item_action({ action })`，复用现有 hook/grant，并保留网页 API、业务存储和旧原生历史。
- Scope: internal（包含本地已安装的 Pi SDK 源码核对）
- Date: 2026-09-22

## Findings

### 已确认的问题链路

1. `src/pi/collaboration-tools.ts:51–61` 把准备与确认提交注册为两个独立工具。prepare 只返回 WorkAction，卡片尚不存在；模型可以不调用 commit 就结束请求。`src/pi/lab.ts:999` 随后 endRequest，使未提交准备单失效。
2. `src/pi/lab.ts:634` 的 commit hook 仅调用 getAction。`src/collaboration/service.ts:124–127` 将失效准备单投影为 `expired`，并不抛错；hook 不检查状态，仍展示卡片。批准以后 `lab.ts:659–660` 才调用 authorizeAgent；`service.ts:247–248` 此时才发现原 requestId 已失效。
3. `lab.ts:664–666` 的统一 catch 把这类业务冲突变为“操作规则或交互记录不可用”，并停止请求。原本可说明给模型的“原操作已失效”信息丢失。

以下 `src/`、`tests/`、`scripts/` 均相对 `experiments/harness-lab/`。

### 最小可行设计

- 新增模型专用 action schema/type，仍包含 assign、claim、submit、review。保留现有 `{kind, payload, workItemId?, expectedRevision?}` 形状，只从模型 schema 删除 assign.taskSpaceId 与 assign/submit.payload.workspaceId。其他业务字段、optional inputPaths、expectedRevision、submissionId 不自动猜测。现有 `workPrepareSchema` / `pageWorkPrepareSchema` 及服务 DTO 不变，避免网页及 SQLite 校验连带变化（`contracts/collaboration.ts:30–42`）。
- 仅注册 `work_item_action` 作为交接变更工具；list/read/import 保留。工具描述说明：一次调用先准备固定文件、显示确认、等待批准并返回业务回执；对象或文件不明确时先澄清。同步 `lab.ts:570` 的当前工作说明，移除对两个旧工具的指示。
- 在现有 beforeToolCall 中，先保留并执行 originalBefore；其 block 直接返回。对新工具克隆最终有效 `{action}` 参数，另外构建服务输入：从本次会话 workspace 注入 taskSpaceId/workspaceId，并只在这份内部副本上处理 `/workspace/` 相对路径。使用真实当前 `sessionId/requestId/toolCallId` 调用 service.prepare，准备完成并确认请求仍活动后，才记录 policy 并显示 handoffConfirmation。
- 直接复用 waitForInteraction、原批准/拒绝分支、参数一致性检查、authorizeAgent、commitAgent。prepare 返回的固定副本恰是卡片内容；批准以后不再次 prepare，不重新读取源文件替代固定副本。
- hook 的局部变量可在等待期间持有 WorkAction，无需新增持久层。批准后把已有 Active.grants 的值扩为 request 内 `toolCallId → {operationId, parameters, grant}`（或同等局部封装）；execute 检查真实参数快照，再取 operationId 和原 grant 调 commitAgent；不要把 envelope 的额外字段传入 grant。可在 execute 的 finally 删除该调用 envelope；request stop/end 继续用已有 endRequest 撤销服务内授权。
- 内部 prepare 与 commit 现在自然使用同一个真实 toolCallId。**不要为此全局强制 service.checkAgent 要求 origin.toolCallId === grant.toolCallId**：现有二阶段服务测试与旧调用关系原本允许 prepare/commit 两个 ID（`tests/collaboration/service.test.ts:100–108`）；新工具自身的局部绑定已满足新路径，不必改变旧服务契约。
- prepare 已在复制前、复制后验证权限/状态/revision，并校验 agent session 的 task/workspace（`service.ts:200–220`）。因此正常新路径不需要另建“恢复旧 operationId”服务。若 prepare 去重返回已有操作，展示前只接受可确认的 prepared 操作；不得展示 expired/cancelled/committed 为待执行卡片。

### 预检错误怎样保留给模型

在 hook 内围绕“构建服务输入 + prepare”的狭窄范围捕获已知可恢复业务错误，返回 `{block: true, reason: '<code>: <message>'}`，不设 terminate、不调用 stop、不保存 pending interaction，也不进入统一基础设施 catch。例：INVALID_INPUT、WORK_NOT_FOUND、WORK_CONFLICT、缺失文件、无效路径/文件类型、附件超限，以及当前任务禁止分派等明确权限/业务拒绝。错误后模型应能读最新工作状态、修正路径或说明失败。

不可简单写成“所有 RequestError/所有 4xx 都可恢复”：`resources/files.ts:9` 的 RESOURCE_STATE_INVALID 是 RequestError(409)；`collaboration/files.ts:29,39` 的 FILE_OPERATION_FAILED 表示文件服务/结果不可确认。数据库异常、资源损坏、原 hook 故障、policy/interaction 持久化失败仍走原 stop + terminate。显式业务错误分类仅服务于该预检边界，不扩散到整个 beforeToolCall。捕获前后先判断 aborted/stopped，取消优先。

依据本地 Pi 0.85.1：`pi-agent-core/dist/agent-loop.js:426–435` 会把 block reason 保存为真实 `isError: true` toolResult；`:303–314` 表明被 block 的工具不会执行 afterToolCall，故预检失败不会误带 executionStarted。不要伪造 toolResult 或在事件对象上补结果。

### 原生历史兼容与参数真实性

- 保存的新 policy.toolName / interaction.toolName 必须是实际 `work_item_action`；policy.parameters / interaction.action.parameters 必须是模型实际 `{action}` 参数。operationId、固定 files 属于 `action.handoff`。宿主注入的 workspace/task 参数只进服务输入，不能反写 context.args、toolCall.arguments、历史消息或用 prepareArguments 假装模型传过这些字段。
- `pi/interactions.ts:36,113–118,139` 都需加入新工具分支。旧 `work_item_commit` 分支继续严格要求 `{operationId: handoff.operationId}`；新分支验证模型专用 `{action}` schema、action.kind 与 handoff.kind 一致、title/description 与 handoff 一致、不得含 command/cwd。两类成功结果都必须有 approved interaction 和 matching policy。
- 保持 `interactions.ts:164–166,180–189` 的真实原生调用参数相等、policy 相等、requested/resolved 不可变字段校验；不能为了兼容新工具放宽这些约束。测试新工具原始绝对路径依然留在历史参数中，而内部服务使用相对路径。
- 旧 `work_item_prepare` 的普通原生结果继续原样解析；旧 `work_item_commit` 的 policy、卡片、结果、unknown/expired 重启投影继续支持。注册列表无需包含旧工具才能读历史。模型若再次输出旧工具调用，Pi 已有 `Tool ... not found` 错误（agent-loop.js:400–407）；不添加偷偷代理到新工具的别名，不重放旧准备或批准。
- 新结果是一次真实执行返回的 WorkReceipt，其 operationId 应与卡片和服务 envelope 一致。崩溃后依旧通过 read 查询 SQLite 真相，保留原生 missing-result/unknown；不得根据业务回执补一条成功历史。

### 取消、拒绝与等待期间变化

`lab.ts:1012–1043` 已有双 signal、listener 清理和取消落盘；`lab.ts:383–391` 的 stop 先 abort 再 endRequest。复用即可。prepare 的 await 后和 approve 后均检查 stopped；不允许在取消后出现卡片或执行 commit。拒绝继续产生未执行的真实错误结果，模型可解释；未提交准备单随请求结束过期，不新增取消状态机。

等待期间其他会话改变 revision，批准后 commit 仍可能返回真实业务冲突：保留 `service.ts:274–278` 的事务内复检，不能把“展示前预检通过”当成之后必定成功。批准事件回调立刻 cancel 的现有边界也应覆盖新工具；已提交后的取消不回滚业务事实。

### 需同步文件与回归

| 文件 | 变更/验证重点 |
| --- | --- |
| `src/contracts/collaboration.ts` | 新模型 action schema/type；网页完整输入及存储 schema 保留；拒绝模型额外传入 host authority 字段。 |
| `src/pi/collaboration-tools.ts` | 新工具注册、内部作用域转换、批准 envelope 消费及原样业务回执；旧变更工具不注册。 |
| `src/pi/lab.ts` | 工作说明、prepare-before-card hook、狭窄预检错误处理、现有 grants envelope；originalBefore/originalAfter 保持组合。 |
| `src/pi/interactions.ts` | 新旧名字分支；新增新参数结构的严格 replay；旧 commit 规则保持。 |
| `src/web/ChatMessage.tsx:14` | 增加新工具显示名；已有 underscore/dot 旧标签保留。卡片组件已按 handoff 数据渲染，可继续复用。 |
| `tests/pi/collaboration.test.ts` | 单次模型工具调用即出现卡片，批准后才有一个业务回执（模型回合从 prepare→commit→final 变 action→final）；四种业务动作（review 含 accept/return）、固定文件、跨任务/席位、无 host IDs 的 schema、scope 注入、模型工具注册断言。 |
| `tests/pi/collaboration.test.ts` / `tests/pi/interactions.test.ts` | stale revision、缺文件、错误对象预检：无卡片、无业务效果、模型下一次得到精确错误并可修正；基础设施/持久化错误仍 terminal；新增原参数/注入字段/政策/回执绑定断言。 |
| `tests/pi/collaboration.test.ts` / `tests/pi/fixtures/handoff-crash.ts` | reject、等待时 cancel、prepare 期间 cancel、approved 回调立即 cancel、等待中 revision 变化；waiting/before/after commit SIGKILL 保持原边界，新工具无第二次模型 commit 调用。 |
| 旧原生历史 fixture + `tests/pi/interactions.test.ts` | 单独保留旧 prepare/commit 历史样本，在不注册旧工具时重开、显示、继续；旧 pending→expired、approved missing result→unknown；不能只把全部旧 fixture 重命名而丢掉兼容覆盖。 |
| `tests/collaboration/service.test.ts`、`tests/seat-api.test.ts`、`tests/e2e/handoff.spec.ts` | 网页 prepare/commit/cancel、page/agent 分离、DB 原格式继续通过；服务主体不必重构。 |
| `tests/e2e/hitl.spec.ts:60,86` | 增加新卡片参数示例与真实新工具浏览器确认流程；旧工具展示样本至少保留一例。 |
| `tests/pi/background-runner.test.ts:52`、`tests/background/config.test.ts:37` | 验证新变更工具不进入后台/子 agent。现有 `not.toEqual(arrayContaining([...]))` 只能证明“并非全包含”，宜使用逐项不包含/交集为空断言。 |
| `scripts/probe-handoff.ts:108,204–216` | 更新卡片工具名与附件证据提取：从真实 action 调用、卡片 handoff、最终 receipt 关联，不再依赖 prepare toolResult。只同步脚本，本轮不运行真实模型。 |
| `.trellis/spec/backend/task-handoff.md`、`.trellis/spec/backend/hitl.md` | 实施时同步新模型契约、旧历史兼容及预检错误与基础设施故障的不同路径。本研究不修改 specs。 |

## Files Found

- 上表列出主要生产代码、测试、脚本及用途；重点行号已内联于 Findings。
- `src/collaboration/service.ts` — 现有准备、固定文件、授权、事务和请求生命周期，适合作为复用边界。
- `src/collaboration/files.ts` — prepare 固定副本及不同错误语义；基础设施错误也是 RequestError。
- `src/contracts/errors.ts` — RequestError 只承载 code/message/statusCode，不能凭类型区分业务拒绝与损坏。
- `src/server/collaboration-routes.ts` — 网页独立 prepare/commit API 边界，保持不变。

## External References

- 未访问网络。`experiments/harness-lab/package.json` 锁定 `@earendil-works/pi-coding-agent` / `pi-ai` 0.85.1。
- 本地核对 `node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-agent-core/dist/agent-loop.js`（package version 0.85.1），以及 `pi-coding-agent/dist/core/agent-session.js:223–265` 的原 hook 组合。这里只说明当前已安装版本行为。

## Related Specs

- `.trellis/workflow.md` — 当前处于研究/方案待审，不实施。
- `.trellis/spec/backend/index.md` — backend 入口。
- `.trellis/spec/backend/hitl.md` — 真实工具调用、持久历史、停止与执行证据契约。
- `.trellis/spec/backend/task-handoff.md` — 固定文件、作用域、page/agent 分离及业务真相；其中“两工具”段落需要随实施更新。
- `.trellis/spec/frontend/index.md` — frontend 入口；本方案 UI 变化主要为工具显示名及确认回归。

## Caveats / Not Found

- 只做静态代码和本地 SDK 核对；未运行任何测试、真实模型或线上服务，未更改产品代码。
- 新工具消除“模型漏 commit / 下一轮复用旧 operationId”的可执行入口，不能保证模型一定选对对象、附件或一定调用工具；这些仍由原参数、卡片与回执提供可核对依据。
- 只保留旧历史读取，并不保证新数据可由旧版本 parser 打开；不应把向前兼容误写成支持旧版本无条件回滚。

## Review of Draft PRD / Design / Implementation Plan

已审阅 2026-09-22 新写入的三份待审稿。总体可实施，scope 对准已证实问题；不需要新框架、额外持久状态或 bash 策略修改。错误分类与兼容回退描述已覆盖主要风险。建议在实施约束中明确三点即可：

1. **“卡片前预检”尽量直接复用 prepare 的现有验证。** 它已经复制前后复检（service.ts:206,219）；另加准备状态/当前请求检查足够覆盖主要缺口。不要为这一步另造通用预检框架或重复整套状态判断。等待期间的变化留给既有 commit 事务复检。
2. **历史变更不是只加工具名。** 新 action.parameters 是真实 `{action}`，旧 commit 参数是 `{operationId}`，必须分别验证，再共用原调用/策略/不可变快照校验。实施稿已要求搜索和保留旧 fixture；还应明确旧历史续聊时 provider context 仍含旧调用/结果，但提供的 tools 已无旧注册。
3. **取消测试分三个有实际差异的时刻。** 除等待中停止，覆盖 prepare 冻结文件尚未返回时停止、approved 回调立即停止。用明确屏障控制时序，验证没有延迟卡片/commit；再保留既有 commit 前后 SIGKILL 的业务回执与 native unknown 分离。不要靠短 sleep 猜测命中边界。

非阻断的文字建议：design 第 2 节“在 Agent 输入适配层去掉已知 ID”宜理解为从模型 schema 删除字段并由宿主补入服务 DTO；不应实现为接收任意模型传来的 ID 后静默剔除。多余字段继续严格拒绝。
