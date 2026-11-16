# 实施计划

> 用户于 2026-11-16 批准当前方案并要求先提交方案、再开始实施。实施完成后记录各项验证结果。

## 进入实现前

- [x] 用户已审阅 [PRD](prd.md) 和 [设计](design.md)，明确批准首版范围，尤其是跟随当前模型、默认开启与空框建议/输入隐藏/删空恢复交互。
- [x] 确认仍在 `/Users/lau/.codex/worktrees/input-predictions/berserk` 的 `codex/input-predictions`，基线为 `codex/axon-r3a`；如合入其他分支修改，重新核对证据与冲突。
- [ ] 通过 `trellis-before-dev` 加载 frontend/backend harness、model-thinking、task-access、HITL 与 conversation-references 相关约束。
- [ ] 新 worktree 尚无依赖安装；按锁文件在 `experiments/harness-lab` 执行 `npm ci`，使用项目要求的 Node 24，不复制任何线上配置或密钥。
- [ ] 再运行 `python3 .trellis/scripts/task.py start .trellis/tasks/11-16-input-predictions`，保持 inline 实现；本任务不需要派生子 Agent 或新聊天。

## 1. 契约和独立生成器

- [ ] 增加共享请求/响应类型，严格验证请求来源轮次、finalMessageId 和预期模型。
- [ ] 实现纯 transcript/提示构建和输出解析，明确 NONE、截断、无正文及工具调用处理；复用公开 estimateTokens，包含队列产生的真实多条用户消息。
- [ ] 从既有 controlled-stream 最小提取 provider 兼容函数，新预测使用捕获的 ModelRuntime.completeSimple；不修改 Agent 执行循环、主提醒、压缩或 native retry。
- [ ] 使用 fake fetch 捕获真实 SDK wire：目标 profile、thinking off/high/缺省兼容、无 tools、限额、timeout/abort、零 transport retry；正式回复 wire 保持原语义。

## 2. 宿主和 API

- [ ] PiLab 内提供窄预测方法，复用授权快照和模型目录，添加短期 controller/来源轮次去重，覆盖同轮多标签页并发。
- [ ] 在既有席位路由注册 POST；通过当前账号/席位范围访问，不接收浏览器 transcript 和配置，不获取模型管理权限。
- [ ] 在新发送、模型切换、配置替换及 close 时取消；断开和超时释放 listeners/并发许可；权限、leaf、模型版本及终态在回包前复核。
- [ ] 通过 API/集成测试证明：越权不可见、旧轮拒绝、当前轮只调用一次、取消后不返回旧文本、任务归档/结束和专家撤权跳过。
- [ ] 生成前后比较原生历史、业务目录及快照，确认没有多余消息、文件、active/lastResult/主请求用量变化。

## 3. 前端生命周期与候选恢复

- [ ] 在 useChat 的前台完成路径提供短期通知；usePromptSuggestion 只响应本页面当前合格终态，不在历史加载、刷新和按键时调用。
- [ ] 使用现有认证 request + 自有 AbortController/generation token，覆盖 A→B→A、注销重登、迟到请求和重复终态。
- [ ] 整理空框展示/暂藏/恢复判据并测试：任意输入含匹配前缀、空格、换行都隐藏；部分删除不恢复、完全删空恢复，采纳后删空也恢复；明确 Esc/新轮次等失效不恢复。
- [ ] 保留既有 draft owner/version；待返回时输入则取消且之后删空不补算，已有候选只在本地暂藏/恢复。空框采纳整条走正常草稿路径，不清除同轮候选。

## 4. 灰字、IME 和开关

- [ ] 保留 textarea 与原自动高度，使用临时 placeholder 显示整条灰字；已有工具栏增加采纳按钮与完整候选 title/可访问说明，不建设前后缀镜像或光标定位层。
- [ ] 给引用选择器增加最小菜单占用通知，按“IME → 引用 → 预测 → 原 Enter”处理，明确 Escape 与 Shift+Tab 出路。
- [ ] 增加个人偏好开关及登录范围布尔存储，支持正式普通用户、管理员个人范围、测试席位；管理员通用偏好入口与业务专家偏好分开授权；关闭立即取消，不自动补算本轮。
- [ ] Playwright 使用真实本地 PiLab/API 与确定性模型，覆盖输入隐藏/删空恢复、IME、整条采纳不发送、Esc 拒绝后不恢复、空 Enter、历史不补算、开关、跨会话竞态和现有编辑功能。
- [ ] 1440px、960px、桌面三栏及 125%/150% 缩放目视/截图核验；无须增加手机验收。

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

- [ ] 所有 A1–A12 有对应断言或明确截图/手工记录；离线测试不调用真实 provider。
- [ ] 需要真实预测质量验证时，另列代表性的“等待反馈、两文件编制、工作已结束、无明确下一步”等短样本，记录额外用量/延迟与人工判断；未执行时明确标为未验证。
- [ ] 将最终契约用英文补入适当 spec，记录验证结果和任何未覆盖项目；不把拟议功能写成已实现规范。
- [ ] 供用户验收。提交/部署按后续明确指令执行；如提交，Git 信息使用中文。

## 风险文件与回退

`pi/controlled-stream.ts`、`pi/lab.ts`、`web/main.tsx`、`web/ComposerReferences.tsx` 是现有关键路径。改动仅限必要接入；不顺手重构整个主组件、模型目录或队列系统。发现需要改变正式执行语义时返回方案审阅。

首选回退为关闭输入建议；移除独立 API/hook/占位提示接入即可回到既有编辑和执行流程，无数据库或原生记录迁移。原 `codex/axon-r3a` 工作目录和当前用户其他 worktree 保持独立。
