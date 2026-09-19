# Research: W01-8 提交与确认方案审阅

- Query: 只读审阅当前设计第 4～7、9～10 节及对应 PRD；检查固定内容、两类确认入口、幂等及存储边界，寻找最少必要缺口。
- Scope: internal；不改主文档或代码。
- Date: 2026-09-19

## Findings

### 总体结论

方案可继续送审。`prepare → commit` 两个工具与独立 operationId 合理：prepare 返回固定内容；commit 的原生参数仅为 operationId，确认附加信息由宿主读取准备单生成。无需把宿主选择的文件 hash 回填已保存的 Pi 调用，也无需把 operationId 强行等同于 interactionId。

已写清且建议保持：

- `design.md:70` 每次成果一份文件；`:74` 批准后引用同一副本，`:77` 不承诺工作目录一致时刻。
- `design.md:79` 新增交接复制原语，不误用 `FileService.publish` 的单调用幂等。
- `design.md:111` 文件先保存、DB 短事务后引用；允许孤立副本，无需跨存储事务协议。
- `design.md:114` 同 operationId 幂等，另一个 operationId 仍校验业务 revision；`:120` 不扩大为任意工具恰好执行一次。
- `design.md:115` 业务 DB 成功不依赖 Pi 结束记录；不补造旧 toolResult。
- `design.md:154` 保留旧索引与 Pi 历史；`:158` 未承诺旧代码可读新增业务确认。

### 必须补：区分页面准备单与 Agent 准备单的执行授权

**位置：** `design.md:90-98`、`:113-116`、`:142-144`。

目前页面 REST commit 收 `{confirm:true}`，又说两类入口共用 prepare/commit。若不限定来源，它可以直接提交 Agent 准备单，从而绕过该 Agent 请求的原生 Interaction 批准。operationId 只是对象标识，不应成为批准凭证。

建议在第 6 节加一段：

> 准备单记录 source（page 或 agent）及创建席位。页面提交接口只接受 page 准备单，并将当前用户的明确按钮操作作为确认。Agent 准备单还绑定 sessionId、requestId；只能由同一请求的 work_item.commit 经现有 Interaction 批准后调用内部提交服务。内部校验 operationId、当前 commit 工具调用与 interactionId 的对应关系，不接受浏览器或模型传入 approved 字段。两类入口不得互相借用准备单绕过各自的确认。

第 9 节 REST commit 行补“仅 page 来源”。Agent 调用不走该公开 REST 入口，而由可信宿主构造本次具体授权。无须新增通用权限令牌、授权表或 ledger。

鉴权应先于幂等回执返回；旧成功结果可以经已有查询入口跨请求、跨重启读取，不能因要求原请求仍活跃而变成不可查。旧批准不允许推动未提交准备单。

**代码依据：** `src/pi/lab.ts:464-468` 只在当前批准后继续；`:825-844` 校验原请求并记录原生用户决定；`src/pi/interactions.ts:172-181` 要求调用参数、规则和决定不被替换。本节为这些已有约束补业务准备单绑定，不改变 Pi。

### 必须澄清：刷新与失效的不同

**位置：** `prd.md:30` K09；`design.md:98`、`:116`。

PRD“刷新、重复点击、响应丢失及重启……未完成的确认失效”容易理解为刷新也使等待失效。现有 HITL 支持刷新后继续查看/回答同一活跃请求。

K09 后半句建议替换为：

> 刷新后查询原准备单和确认状态，不自动重发；服务进程重启后，未提交准备单失效。Agent 原请求结束或取消也使其未提交准备单失效。已成功的业务结果可查询，不依赖助手是否成功回复。

第 6 节相应写“刷新保留仍有效的等待；停止、请求结束和进程重启按第 7 节使未提交动作失效”。这与 `design.md:116` 的当前进程/请求边界一致。

### 应补一句：页面取消的准确含义

**位置：** `design.md:77`、`:117`、第 9 节接口表。

Agent 取消可复用活跃请求停止，但页面未提交准备单只绑定当前进程；现文未说明页面取消如何使它不能再提交。

若页面提供“取消本次操作”，建议明确：

> 页面取消将该未提交准备单标记为已放弃；后续 commit 拒绝。已成功提交不因此撤销。取消与提交在同一业务存储内校验，先完成的决定生效。

可用一个窄的取消准备单接口，不新增工作项撤回或审批状态机。若本期界面仅关闭表单、并不作服务端放弃，应把按钮/文案定义为“关闭”，不要承诺旧准备单已撤销。两者任选其一，主设计需直白说明。

取消语句建议避免暗示无法观察的时序保证：在开始短事务前检查已生效的取消；事务已经开始则等待明确结果，不以超时抢跑返回“尚未提交”。

### 应补一句：退回/验收针对当前 submissionId

**位置：** `design.md:60-66`、`:142`。

PRD K07 已明确只能处理当前提交。技术表目前只说各 kind 有独立 payload，可用一句落到校验对象：

> review 准备单固定 submissionId、验收决定和意见；commit 同时核验它仍是工作项当前待验收的提交。claim、submit、review 必须提供 expectedRevision；只有创建新 WorkItem 的 assign 不需要已有 revision。

这不会增加对象或流程，只防止实现把“验收通过”应用到等待期间出现的另一份提交。

### 建议明确：受控文件导入的任务范围

**位置：** `design.md:81`、`:92`、`:146`。

工具写“当前会话工作区”，页面写“自己的 workspaceId”，但未直说可否复制到另一个任务空间。当前需求围绕同任务两个席位交接，建议补：

> 导入目标必须属于当前席位且与该交接文件所在工作项 taskSpaceId 相同；工具目标取当前会话工作区。跨任务复制不在本期提供。

如主设计有意允许复制到任何本人项目，应明确写出选择；不要依靠不同入口的默认行为形成差异。

## Files Found / Related Specs

- `.trellis/tasks/09-19-w01-8-task-handoff/design.md`：本次审阅的技术方案，行号以本文件写入时为准。
- `.trellis/tasks/09-19-w01-8-task-handoff/prd.md`：K05～K10 的确认、版本、隔离与幂等要求。
- `experiments/harness-lab/src/pi/lab.ts:441`、`:791`、`:825`：当前可信 hook、原生等待与响应归属校验。
- `experiments/harness-lab/src/pi/interactions.ts:115`：严格历史重放，不可借业务扩展绕过现有调用/参数/决定绑定。
- `.trellis/spec/backend/hitl.md`：刷新可继续原活跃等待；请求停止与重启失效。
- `.trellis/spec/backend/harness-lab.md:103`：中断续聊是新请求，不自动恢复旧工具效果。
- `research/submission-boundary.md`：此前完整代码与存储调研，本次未新增外部调研。

## Caveats / Not Found

- 本次没有发现需要通用 Run、通用业务 ledger、事务消息、全目录锁或每次文件写入版本库的必要性。
- Node SQLite 实验 API、固定副本不等于事务目录快照、JSONL 与业务事务不原子三项限制已被方案覆盖，不建议重复扩写。
- 审阅时 acceptance.md 与 storage-and-interaction.md 尚未写入，未把草稿中的链接视为已完成验收或已存在的依据。
