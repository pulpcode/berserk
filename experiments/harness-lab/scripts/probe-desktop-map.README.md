# 桌面地图使用验收

运行目录 `experiments/harness-lab`，Node 24；先 `npm run build`。需现有 Playwright Chromium。沿用已授权模型设置，仅虚构隔离资料，禁用命令执行；不访问线上任务、推送或部署。

```sh
LAB_EXECUTION_ENABLED=false node --env-file-if-exists=.env.local --import tsx scripts/probe-desktop-map.ts --prepare-only --port 4361
LAB_EXECUTION_ENABLED=false node --env-file-if-exists=.env.local --import tsx scripts/probe-desktop-map.ts --port 4361
```

准备调试可加 `--prepare-case main-1|ambiguity|collaboration|main-2|main-3`，必须同时带 `--prepare-only`；正式运行固定五个独立环境，不能缩减、重试挑选或自动批准。准备模式在消息入口及提供方 HTTP 入口均阻止模型调用。

结果说明复测可用 `--reporting-recheck`，固定执行 `collaboration-1`、`collaboration-2` 两个全新环境，各自复用完整 B01→B02→C01→C02 流程、原业务输入与操作员规则。它不是另两轮完整八场景验收，不改变默认五环境，不提供失败重试。可与 `--prepare-only` 组合，不能与 `--prepare-case` 混用：

```sh
LAB_EXECUTION_ENABLED=false node --env-file-if-exists=.env.local --import tsx scripts/probe-desktop-map.ts --reporting-recheck --prepare-only --port 4361
LAB_EXECUTION_ENABLED=false node --env-file-if-exists=.env.local --import tsx scripts/probe-desktop-map.ts --reporting-recheck --port 4361
```

每轮请求另存 `visibleEvidence`：按实际 requestId 保留用户输入、中途助手说明、最终答复和问题/答复。它不评分、不改写文本、不进入模型上下文；完整 snapshot、工具结果和原生历史继续保留。语义审阅须包含确认前说明，不能只看最终答复。

正式次序：main-1（A01→A02→A03）、ambiguity（A04）、collaboration（B01→B02→C01→C02）、main-2、main-3（各 A01→A02）。每个环境使用新账号、数据库、任务及来源；一个环境内会话共享任务。筹划席浏览器的两个页面共享同一个账号身份；总体席使用独立 context。所有发送、人工编辑、引用、发布版采用通过实际 UI/HTTP。API 仅用于明确的初始化、独立快照核对和 C02 正式认证拒绝对照，不将初始化算作模型完成。

地图仍由 MapLibre 渲染，唯一被 browser route 替换的是 map-config 与固定本地瓦片。来源树定位后，通过已知夹具几何计算屏幕位置并实际点击地图验证来源选择；业务 API 不 mock。坐标新增用现有表单。截图保持桌面 1440×960 和 1280×900，不验收手机。

A04 仅对唯一匹配“现场讨论”的对象选择问题提交预定回答，排除权限、发布、采用和额外操作；正文问题先保留未写入证据再提交预定正常业务回答，由审阅者判断是否真的属于澄清。其他提问/确认取消并记录。三次连续同参数失败且没有新工具信息时终止该步，产品原生执行循环不变。模型未完成或断言失败不重试；独立场景继续，依赖未满足记 `not_executed`。

证据位于 `.local/desktop-map-acceptance/<timestamp>/`：准备和运行失败均保留。包含实际 UI 请求正文（contextRefs/annotationRefs 分开）、无头信息的真实模型 JSON、来源响应、SSE、原生会话、每轮快照/回执/累计 usage、步骤截图、检查及未执行状态。登录密码、cookie、认证头、浏览器 storageState/trace 不导出。manifest 只包含合成 ID 和本地路径。外部批次冻结脚本负责整个代码/build/夹具 hash；驱动另存脚本/Skill hash，schema 与模型参数可从实际 model-inputs 提取。

`prepared` 仅证明准备路径、选择器及零模型边界；`protocol_completed` 仅表示自动结构检查通过。必须对照八场景设计人工审阅每步 UI、数据、实际回答与权限，不能把技术状态当业务通过。真实工具恢复与正常业务澄清允许，措辞有合理歧义不自动判“虚报保存”。

## 第二批实验条件

首批 `2026-10-14T09-56-53.477Z` 保留原结果，不重写为通过。第二批只调整验收驱动，产品、Skill、模型配置不变：

- A01 结果入口超过三个时，先在最后一条助手答复展开“另有 N 个地图入口”，再点击最后一个标注入口。首批 main-1/2 已写入，但驱动未展开折叠区而超时；不是产品缺少入口。
- 协同环境在加载页面前将道路初始化为 closed r2，记录 `collaboration-source-initial.json`。B02 更新为 open r3 并断言两端状态/修订；首批实际是 open r1→open r2，不能冒称覆盖原计划状态变化。
- 三条主链统一使用明确的业务输入：“把引用的西区道路、该区域边界与车辆这三个来源对象，一起放到本会话的‘现场讨论’图层。当前没有草稿，请建空白草稿。位置采用已有来源，先不发布。”首批“围绕引用的西区道路，查询该区域边界与车辆，一起放到……”可被理解为只加入后两类，main-3 实际加入两对象后询问道路是否加入。因此这是声明过的新业务输入条件，不能算原提示通过，也不加入工具调用提示或纠错答案。

第二批仍完整运行五环境、三条主链，不把两批零散成功拼接为整体验收通过。

## 第三批交互条件

第二批 `2026-10-14T10-04-37.832Z` 保留原取消和未完成结果。第三批沿用第二批明确的三对象业务输入、产品、Skill、schema 与模型配置，只调整测试操作员交互：

- A04 即使模型提供多选框，也只勾选预定的唯一“现场讨论”选项；提交前核对仅一项选中，绝不选“两个都改”。多选呈现不等于要求多选。
- 除 A04 既定目标澄清外，每次请求最多允许一次验收操作员回答正常业务问题。遇到合适的 `question` 时输出 `waiting_acceptance_operator`，将原始业务目标、pending 问题、requestId/interactionId、snapshot 写入 `<场景>-<interactionId>.question.json`。等待同目录 `.answer.json` 最多 120 秒。命令/权限扩大等明显越界问题与 `confirmation` 不进入答复通道；不会自动批准。
- 操作员是 `acceptance-agent`，不是用户本人或真人审批人。只澄清已授权业务目标；不提供正确工具、机械版本、评分答案、新权限或补救提示。所有操作员答复单独归档，报告中明确标识，不能算无交互完成。
- 答复文件形如 `{"operator":"acceptance-agent","interactionId":"实际 ID","requestId":"实际 ID","answers":[{"questionId":"实际问题 ID","optionIds":["明确选项 ID"]}]}`；自由文本用 `{"questionId":"…","text":"原业务目标的澄清"}`。建议操作员先写临时文件再原子重命名，避免半写 JSON。错误或过期 ID、非法选项、重复问题、空回答直接停止，不能借此跨请求答复。
- 提交前重新读取真实服务，要求同一 request 仍 active、同一 interaction 仍 pending、问题内容未变化；按确切选项位置/ID填入实际 UI 后点击提交。答复文件不是产品接口或访问令牌，不增加任何产品持久状态。
- C02 分开记录 `C02-agent`（模型尝试）与 `C02`（正式认证 API 和真实 UI 权限边界）。模型被取消或未完成仍继续独立负向权限检查，但取消不算模型通过，场景整体结论须同时说明两条路径。
