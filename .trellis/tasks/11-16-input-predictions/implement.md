# 实施计划

> 用户于 2026-11-16 批准当前方案并要求先提交方案、再开始实施。实施完成后记录各项验证结果。

## 进入实现前

- [x] 用户已审阅 [PRD](prd.md) 和 [设计](design.md)，明确批准首版范围，尤其是跟随当前模型、默认开启与空框建议/输入隐藏/删空恢复交互。
- [x] 确认仍在 `/Users/lau/.codex/worktrees/input-predictions/berserk` 的 `codex/input-predictions`，基线为 `codex/axon-r3a`；如合入其他分支修改，重新核对证据与冲突。
- [x] 通过 `trellis-before-dev` 加载 frontend/backend harness、model-thinking、task-access、HITL 与 conversation-references 相关约束。
- [x] 新 worktree 已按锁文件安装依赖；在 `experiments/harness-lab` 执行 `npm ci`，使用项目要求的 Node 24，不复制任何线上配置或密钥。
- [x] 已运行 `python3 .trellis/scripts/task.py start .trellis/tasks/11-16-input-predictions`，保持 inline 实现；本任务不需要派生子 Agent 或新聊天。

## 1. 契约和独立生成器

- [x] 增加共享请求/响应类型，严格验证请求来源轮次、finalMessageId 和预期模型。
- [x] 实现纯 transcript/提示构建和输出解析，明确 NONE、截断、无正文及工具调用处理；复用公开 estimateTokens，包含队列产生的真实多条用户消息。
- [x] 从既有 controlled-stream 最小提取 provider 兼容函数，新预测使用捕获的 ModelRuntime.completeSimple；不修改 Agent 执行循环、主提醒、压缩或 native retry。
- [x] 使用 fake fetch 捕获真实 SDK wire：目标 profile、thinking off/high/缺省兼容、无 tools、限额、timeout/abort、零 transport retry；正式回复 wire 保持原语义。

## 2. 宿主和 API

- [x] PiLab 内提供窄预测方法，复用授权快照和模型目录，添加短期 controller/来源轮次去重，覆盖同轮多标签页并发。
- [x] 在既有席位路由注册 POST；通过当前账号/席位范围访问，不接收浏览器 transcript 和配置，不获取模型管理权限。
- [x] 在新发送、模型切换、配置替换及 close 时取消；断开和超时释放 listeners/并发许可；权限、leaf、模型版本及终态在回包前复核。
- [x] 通过 API/集成测试证明：越权不可见、旧轮拒绝、当前轮只调用一次、取消后不返回旧文本、任务归档/结束和专家撤权跳过。
- [x] 生成前后比较原生历史、业务目录及快照，确认没有多余消息、文件、active/lastResult/主请求用量变化。

## 3. 前端生命周期与候选恢复

- [x] 在 useChat 的前台完成路径提供短期通知；usePromptSuggestion 只响应本页面当前合格终态，不在历史加载、刷新和按键时调用。
- [x] 使用现有认证 request + 自有 AbortController/generation token，覆盖 A→B→A、注销重登、迟到请求和重复终态。
- [x] 整理空框展示/暂藏/恢复判据并测试：任意输入含匹配前缀、空格、换行都隐藏；部分删除不恢复、完全删空恢复，采纳后删空也恢复；明确 Esc/新轮次等失效不恢复。
- [x] 保留既有 draft owner/version；待返回时输入则取消且之后删空不补算，已有候选只在本地暂藏/恢复。空框采纳整条走正常草稿路径，不清除同轮候选。

## 4. 灰字、IME 和开关

- [x] 保留 textarea 与原自动高度，使用临时 placeholder 显示整条灰字；按后续反馈移除额外采纳按钮，保留 textarea 完整候选 title 和 Tab 采纳，不建设前后缀镜像或光标定位层。
- [x] 给引用选择器增加最小菜单占用通知，按“IME → 引用 → 预测 → 原 Enter”处理，明确 Escape 与 Shift+Tab 出路。
- [x] 增加个人偏好开关及登录范围布尔存储，支持正式普通用户、管理员个人范围、测试席位；管理员通用偏好入口与业务专家偏好分开授权；关闭立即取消，不自动补算本轮。
- [x] Playwright 使用真实本地 PiLab/API 与确定性模型，覆盖输入隐藏/删空恢复、IME、整条采纳不发送、Esc 拒绝后不恢复、空 Enter、历史不补算、开关、跨会话竞态和现有编辑功能。
- [x] 1440px、960px、桌面三栏及 125%/150% CSS 缩放核验，目视检查桌面与三栏截图；原生系统 IME、浏览器快捷键缩放另列为未验证，无手机验收。

## 5. 验证和交付

以下命令在 `experiments/harness-lab` 执行；新增测试文件名为计划值，实施时与最终路径保持一致。

```sh
# 先验证新增行为和受影响的真实 SDK 构造
npx vitest run tests/pi/prompt-suggestion.test.ts tests/prompt-suggestion-api.test.ts tests/web/prompt-suggestion.test.ts tests/pi/model-thinking.test.ts tests/pi/model-catalog.test.ts
npx playwright test tests/e2e/prompt-suggestion.spec.ts tests/e2e/references.spec.ts tests/e2e/message-queue.spec.ts tests/e2e/hitl.spec.ts tests/e2e/model-selection.spec.ts tests/e2e/chat.spec.ts

# 再完成既有项目质量门
npm run typecheck
npm run lint
npm test
npm run build
```

- [x] 所有 A1–A12 有对应断言或明确截图/手工记录，见 [验证记录](verification.md)；离线测试不调用真实 provider。
- [x] 在验证记录列出真实预测质量样本及需要记录的用量/延迟与人工判断，明确标为未验证。
- [x] 将最终契约用英文补入 backend/prompt-suggestions.md，前后端索引链接该规范；记录实际错误行为、边界与易错点。
- [ ] 供用户验收。提交/部署按后续明确指令执行；如提交，Git 信息使用中文。

## 风险文件与回退

`pi/controlled-stream.ts`、`pi/lab.ts`、`web/main.tsx`、`web/ComposerReferences.tsx` 是现有关键路径。改动仅限必要接入；不顺手重构整个主组件、模型目录或队列系统。发现需要改变正式执行语义时返回方案审阅。

首选回退为关闭输入建议；移除独立 API/hook/占位提示接入即可回到既有编辑和执行流程，无数据库或原生记录迁移。原 `codex/axon-r3a` 工作目录和当前用户其他 worktree 保持独立。


## 当前实施记录（2026-11-16）

- 方案提交：`a659c78`（`docs: 确定输入建议预测方案与验收标准`）。用户随后已授权实施，任务为 `in_progress`。
- 最小变更边界：在 PiLab/原会话 API 新增一次性预测，以公开 DTO 对接；输入框仍为原 textarea，useChat 仅增加前台成功通知，ComposerReferences 仅增加菜单占用通知，Settings 仅增加登录范围开关。不修改正式 Agent 循环、持久历史格式、业务工作关联或移动端行为。
- 共享改动仅为从 controlledStream 提取原 provider payload 兼容处理；原模型目录/思考配置的 27 项回归已通过。
- 最终专项与原模型配置回归共 5 文件、54 项通过，其中新增 27 项，含真实 SDK wire、权限与原生历史无变化、并发/取消/总超时/设置更新、五条同轮用户消息的上下文上限及实际工具名称的正文过滤。
- 类型检查、lint 和 build 已通过；lint 保留未改动 InteractionCard 的两条既有 effect cleanup 警告，build 保留既有大 bundle 提示。
- 125 项相关浏览器用例经分批执行与失败项复核通过，含 8 项本功能用例。旧引用/模型测试区分正式 Agent 调用和独立预测调用；旧项目入口断言移至实际进入对话之后。首次侧栏悬浮提示失败，未改产品代码，隔离复测通过。
- 完整离线集首轮 187 文件通过、1 文件失败（1880 项通过、2 项失败）；失败仅在新增预测测试的正文过滤与零余量历史裁剪。最终源码修正后以 54 项专项复测通过，未重复整套长回归。原始结果与复核边界见验证记录。
- 代码实现和规范同步完成，等待用户验收及实现提交确认；不将任务标为用户已验收或归档。
- 未执行真实付费模型或远程推送。后续按用户授权已更新 4316，见 [部署记录](research/online-4316-notes.md)。浏览器 IME 是 composition/229 事件模拟，125%/150% 为 CSS 缩放，不能宣称原生系统输入法或浏览器快捷键缩放已实测。

## 测试反馈修正（2026-11-16 22:50，UTC+8）

- 用户要求移除“采纳建议 / Tab”冗余控件，改为仅灰字和 Tab 采纳；随后反馈切换窗口回来候选消失。
- 调整仅涉及 PromptSuggestion、main、styles 和 usePromptSuggestion：后台可见性变化暂藏已有候选，不调用 dismiss；取消在途请求的行为保留，返回不补算。切换对话/轮次/模型等仍按原来源判据失效。
- 更新 8 项原浏览器用例并补充 2 项后台恢复/在途取消用例，10 项通过；typecheck、lint、build 通过，既有警告不变。页面可见性测试采用事件模拟；桌面截图已目视核验无冗余按钮。
- 已无重启更新 4316，25 个文件校验通过，4315/4316 PID 均未变，未改业务数据。见 research/online-4316-ui-update.json 与在线发布记录。

## 同一身份内按会话保留（用户批准实施）

- 用户明确授权：同一身份下切换会话、业务页面、模型时保留已生成建议，用户/席位/登录态变化时清空；采用浏览器内存 Map，不持久化候选。
- 改动边界：预测 hook 保存按会话索引的候选，main 传入独立的身份活跃状态与业务失效事实，纯来源判断支持模型无关的候选复核；相关浏览器/来源测试同步。复用原账号 Provider 和现有 GET 会话接口，不增加后端存储、数据库或模型请求。
- 返回已缓存会话/聊天页前，读取会话核对权限与最新来源；与模型选择过程、输入框就绪状态分开，不因暂时不可展示而删除候选。新轮次、明确拒绝、关闭功能、业务依据失效仍删除对应候选。
- 已生成候选按新规则保留；在途请求仍沿用原取消规则，晚到响应不跨身份或会话复活。完成针对性验证后仅更新4316。

### 内存缓存实施结果（2026-11-16 23:29，Asia/Singapore）

- 已在应用顶层预测 hook 增加当前登录/席位作用域的会话 Map；模型不作为缓存键。返回会话/聊天页时以原有 GET 会话接口检查来源与访问权限，再安装当前展示副本；模型选择和其他临时就绪变化只影响展示。
- 明确的业务失效与临时遮挡拆开；新轮次、明确拒绝等删除对应项，用户/席位/登录态变化、关闭开关及卸载清空全部。原生草稿、后端生成、并发与在途取消机制不变。
- 输入建议 Playwright 15/15 通过（56.8 秒），新增独立 A/B 候选、页面和模型往返、刷新丢失、外部新轮次、权限拒绝、席位往返、不同用户登录往返等覆盖。补强浏览器不落盘断言和读回完成等待后，相关 2 项复测通过。来源判定单测 4/4 通过。
- typecheck、lint、build 通过；lint 仅保留原 InteractionCard 两条既有警告，构建保留既有 bundle 提示。
- 23:29 已无重启更新4316，24文件逐项校验；4315/4316进程不变、健康200。业务数据未触及，模型调用0。待用户测试，未提交实现/推送/归档。
