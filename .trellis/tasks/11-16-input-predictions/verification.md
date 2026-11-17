# 实施验证记录

日期：2026-11-16。分支：`codex/input-predictions`。方案提交：`a659c78`（`docs: 确定输入建议预测方案与验收标准`）。实现尚未提交；后续已按用户授权更新 4316，未推送，待用户验收。发布证据见 [部署记录](research/online-4316-notes.md)。

## 实现结果

当前页面观察到前台成功回复后，以当前模型独立请求一条建议。仅在完全空的输入框显示灰字；任何输入均隐藏，已有候选删空可恢复。Tab 整条采纳到普通草稿，由用户自行发送。设置 → 个人偏好可关闭。历史加载、刷新、聚焦或清空输入不补算；等待生成时输入会取消本轮预测，迟到响应不能恢复。服务端复用现有授权、模型配置和并发许可，不写原生历史、业务记录或上一轮用量。

## 验证结果

命令均在 `experiments/harness-lab` 执行，模型使用确定性 provider 或真实 SDK + fake HTTP，无真实付费模型请求。

| 验证 | 结果与范围 |
| --- | --- |
| `npm run typecheck` | 通过。 |
| `npm run lint` | 通过，无错误；保留未改动 `InteractionCard.tsx:209` 的两条既有 effect cleanup 警告，Pi/Web 依赖边界检查通过。 |
| `npm run build` | 通过，保留既有大 bundle 提示。 |
| `npx vitest run tests/pi/prompt-suggestion.test.ts tests/prompt-suggestion-api.test.ts tests/web/prompt-suggestion.test.ts tests/pi/model-thinking.test.ts tests/pi/model-catalog.test.ts` | 最终源码 5 文件、54 项全部通过，含新增 27 项及原模型目录/思考配置 27 项。 |
| `npm test -- --maxWorkers=2` | 首轮 188 文件：187 通过、1 失败；1882 项：1880 通过、2 失败，耗时 873.51 秒。失败仅在新增预测文件的正文过滤和零余量历史裁剪；最终修正以以上 54 项复测通过，未重新跑完整长回归。 |
| 相关 Playwright 回归 | `prompt-suggestion`、`references`、`message-queue`、`hitl`、`model-selection`、`chat` 共 125 项经分批执行和失败项复核通过；不是一次全绿的 125 项执行记录。包含本功能 8 项专项。 |

浏览器首轮 117 通过、8 失败。旧测试对模型调用次数的断言需区分正式 Agent 与独立无工具预测，项目标题只打开任务详情的入口需等进入真实对话再断言；新夹具修正发送完成同步和管理员登录落点。修改后 22 项相关子集通过 21 项，余下模型调用计数修正后与侧栏悬浮提示共 2 项隔离复测通过。侧栏产品代码与测试未修改。最终无未解释的失败项。

上下文过滤使用项目实际注册的下划线工具名称，文件/Skill/方法正文和 shell 日志只保留工具名称与状态。零余量历史使用显式空数组，避免 `slice(-0)` 返回全部旧消息。这两项都有最终回归断言。

## 验收对应证据

| 标准 | 证据 |
| --- | --- |
| A1 | 浏览器 fresh-turn/history/reload 用例；API once/concurrent-tabs；客户端 source-proof 单测拒绝失败、取消、恢复/缺失终态证据。 |
| A2 | 生成器 NONE、无正文、多行/控制字符/超长、截断、thinking-only、工具输出断言；API abort/permit-timeout；快照保持不变。 |
| A3 | API 比较原生 JSONL、工作区目录、activity、snapshot 和主用量；浏览器真实 value/高度不变、空 Enter 不发送。 |
| A4 | 浏览器匹配前缀、部分删除、空格、换行均隐藏；完全删空及采纳后删空恢复，模型计数保持一次。 |
| A5 | 浏览器 Tab/点击只填草稿、刷新恢复真实草稿，Esc 后删空不恢复。 |
| A6 | 浏览器 composition/229 事件模拟验证不采纳/发送，取消组词恢复候选。原生系统输入法未实测。 |
| A7 | 浏览器引用菜单优先级专项及原 references/message-queue/hitl/chat 回归；生产判据复用原附件、引用和人工交互状态。 |
| A8 | 浏览器等待时输入、A→B→A、开关/刷新；API 新发送、模型切换、配置保存及身份失效；真实登录 scope 卸载隔离。 |
| A9 | API 跨席位/账号 404、额外权限字段 400、CSRF 403、归档任务 409、专家 admission 撤权、回包前登录撤销 401；结束场景沿用已有 task writability 守卫，未单列真实场景生命周期端到端用例。 |
| A10 | 浏览器 1440/960、三栏、125%/150% CSS zoom 和中英文/emoji 长建议；完整 title/采纳、宽高和页面溢出断言。桌面与三栏截图已目视检查。 |
| A11 | 浏览器失焦后其他控件 Tab 不采纳、Esc/Tab 导航；原生 button/title/可访问名称、单次 live announcement。真实屏幕阅读器未实测。 |
| A12 | 测试席位开关、刷新保留、重新开启不补算；正式普通席位/管理员个人空间 API；管理员真实登录 UI 的个人偏好及模型管理权限隔离。 |

截图：`/tmp/axon-input-prediction-desktop.png`、`/tmp/axon-input-prediction-three-pane.png`。截图是本机临时验证产物，不作为仓库二进制文件提交。

## 真实模型质量待验证

以下样本尚未调用真实 provider，不能根据离线断言声称建议有用、延迟较低或命中缓存。后续实际验证逐项记录候选/是否跳过、人工判断、耗时和额外 token 用量：

| 样本 | 关注点 |
| --- | --- |
| 对方等待用户反馈，关键信息尚缺 | 不虚构反馈或代用户批准，可返回无建议。 |
| 同时编制两份待提交文件 | 延续真实文件对象，避免把一份文件的目标或提交对象套到另一份。 |
| 工作已结束，用户没有提出新目标 | 不强行生成“继续”或新任务。 |
| 对话缺少明确下一步或关键对象 | 允许 NONE；不能补造文件、收件人或完成状态。 |

125%/150% 检查使用 CSS 缩放；未实际操作系统 IME、浏览器快捷键缩放、真实辅助阅读器或真实模型计费。当前任务保留 `in_progress`，不宣称用户验收完成。

## 用户测试反馈修正与复核（2026-11-16 22:50，UTC+8）

移除可见“采纳建议 / Tab”按钮；完整候选通过 textarea title 查看，仍可 Tab 整条采纳。切换浏览器窗口/标签页时仅暂藏已有候选，返回同一有效来源时恢复，不重算；在途预测仍取消，不复活。

最终 `npx playwright test tests/e2e/prompt-suggestion.spec.ts --workers=1`：10/10 通过（39.5 秒），其中两项新增覆盖已有候选后台往返恢复及在途预测后台取消；原采纳断言改为键盘，新增无采纳按钮断言。后台状态通过 visibilitychange 模拟，不宣称原生系统窗口自动化验证。

`npm run typecheck`、`npm run lint`、`npm run build` 均通过，既有两条 InteractionCard lint 警告与 bundle 提示保持。桌面截图目视确认无冗余按钮。仅前端变更，未重跑未变动的后端和全量长测试。25 文件无重启发布并核对 HTTP 字节，业务数据未改，模型调用零次。证据见 research/online-4316-ui-update.json 和 research/online-4316-ui-local-check.json。

## 按会话内存保留：最终复核（2026-11-16 23:29，Asia/Singapore）

采用用户明确批准的内存方案：同一身份跨会话、业务页面和模型保留，每会话最新一条；用户/席位/登录态变化清空整个 Map，刷新丢失，未采纳文本不落盘。返回缓存会话/聊天页时，通过既有 GET 会话接口核对权限及最新来源后恢复，模型不作为旧候选失效条件。

- Playwright `tests/e2e/prompt-suggestion.spec.ts`：15/15，通过跨会话分别保留、能力中心往返、模型切换和 Tab 采纳、刷新丢失、外部新轮次失效、权限拒绝、席位切换全清、退出/另一用户/原用户重登无恢复。保留原后台/IME/引用/迟到响应/偏好/桌面布局验收。
- 两项补强断言复测通过：未采纳候选不在 localStorage/sessionStorage，等待新轮次 GET 完成后不展示旧候选。
- Vitest `tests/web/prompt-suggestion.test.ts`：4/4，通过模型无关的缓存来源匹配及活动/新轮次/恢复异常拒绝。
- 类型、lint、构建均通过，原有两条 InteractionCard 警告及 bundle 提示保留。无后端改动，未重复全量长回归；此次无真实模型调用。
- 发布证据：`research/online-4316-memory-update.json`、`research/online-4316-memory-local-check.json`，包清单 `research/memory-deploy-source.json`。
