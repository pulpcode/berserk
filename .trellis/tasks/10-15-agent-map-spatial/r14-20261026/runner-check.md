# R14 运行器离线检查

2026-10-26。这里只记录运行器检查，**不代表模型正确率，也不表示144项已获离线放行**。全部模型响应由本地固定传输生成，真实模型调用为 **0**，未创建正式 `live-claim.json`，未提交 Git。

## 已实现

- A/B/C 三组共用固定产品归档、Skill和真实 HTTP/Pi 工具循环；Pro 使用自己的原生模型登记。仅隔离评测脚本适配固定合成日期和本轮来源夹具，产品 `src` 与 Skill 不变。
- 实际出站统一 `max_completion_tokens=32768`，不发送 `max_tokens`、`temperature`、`top_p`。A禁用思考；B/C启用high。原生SDK处理工具结果及思考历史，不拼接另一套Agent循环。
- 实际模型身份、用量、思考信号、工具参数/回执、逐轮状态和来源变更均留证；私有思考不进入公开语义评分。所有实际模型调用共用预算，辅助调用同样配置和计数。
- 1600请求、3600万输入、300万输出、12000AFP分别生效；按Flash/Pro系数计AFP，输出包含思考，不重复加算。三项前完成预留与每请求全输出预留独立检查。账户窗口按真实观察余额扣本批消耗和其他用途预留，不自动跨窗口补充。
- 账户超额设置以 `observedOverageEnabled:boolean|null` 如实记录，不要求用户改变现状；代码不调用设置接口。不能用未知额度或不完整usage继续发请求。
- 不必要确认记该任务未完成，真正未知必要澄清停批次；仅D05/D06可获得一次冻结回复。重复询问不再次代答。正常工具往返继续；长任务只有警示与300秒无进展保护，无小额单题强截断。
- 正式模式还要求 `offline-gate.json` 的 `status=passed`、最终 `freezeHash` 一致和检查依据非空；不把该门禁文件纳入自身freeze。当前D04阻塞，不能生成通过门禁。

## 检查结果

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| 提供商与预算基础集 | 5/5通过 | 终端会话43353，37.71秒 |
| 真实本地HTTP/Pi集成与边界基础集 | 14/14通过 | 终端会话24787，237.54秒 |
| 澄清/账户定向回归 | 4/4通过 | [runner-targeted-offline.log](runner-targeted-offline.log)，终端会话68182，29.06秒 |
| 日期/预览定向回归 | 3/3通过 | [runner-preview-date-offline.log](runner-preview-date-offline.log)，终端会话50050，22.55秒 |
| 本责任区ESLint及整个R14 TypeScript | 通过 | 终端会话91021；此前6181、45402也通过 |

19项基础检查之外，定向回归新增5个独立用例（执行门禁、重复澄清、冻结日期、每用户轮预览前提、D18自纠保存）；另2个是既有D06及账户预算用例的复跑，不重复计成新用例。运行器共有24个不同离线测试通过，分轮定向执行，并非一次跑完整24项。最早ESLint调用未指定项目配置，报找不到配置；随后使用下面的正确命令通过，未掩盖首次工具配置错误。

基础HTTP集成包括15个独立模拟任务（5个历史题家族×3组、84次mock请求），验证来源读取、按需Skill正文送达、同轮及新用户轮思考字段回传、工具参数错误自纠、两次范围生成与第一次结果沿用、固定几何保存。另验证4类提供商失败均只发生1次外部mock尝试；不必要确认、未知问题、缺少前置结果、可选邀请、D06普通/API选择以及D12真实来源4→1更新。

最终日期从 `cases.json.syntheticDay` 读取并纳入freeze，不再使用执行当日。核对固定产品归档：mock来源 `current` 查询按ref/area/name选当前快照，SpatialInputs保留业务有效时间，不按墙钟日期过滤；`queriedAt`仍记录真实查询时间。历史事实并不因此成为现实当日资源可用性证明。

D18新集成在原第一用户轮生成800米，原第二轮先900米再自纠1200米，第三轮保存1200米；三组都完成（24次mock请求），未把全局第二个buffer误当用户第二次预览。保存证据记录原用户轮、实际resultRef和授权候选；不确定引用留语义复核。第一轮多个结果不能满足第二轮缺失的预览前提，读取旧结果也不能冒充新生成。

D12在真实本地来源服务更新后，旧分析仍含1个对象、新分析含0个，旧快照没有被新值改写。D06重复选择回归中三组都只收到一次脚本回复，随后记未完成并继续其他计划槽，不伪造答案。

## 可复核的原始离线材料

系统临时目录前缀：`/var/folders/td/741qp46d52b2b8_2zdzj7ps40000gn/T/`。

- 完整15任务：`r14-offline-complete-Jpfajc/batch`。
- HTTP429、模型漂移、缺usage、截断：依次 `r14-offline-failure-ETnDE4`、`DdqBvA`、`qJgjBq`、`0eErKK` 的 `batch`。
- D06普通/API：`r14-offline-clarification-d9ztTo/batch`。
- D12来源更新：`r14-offline-update-pGni8G/batch`。
- 定向回归stdout已落盘，上述原始目录包含账本、请求/SSE、实际工具结果、原生会话及状态。基础集stdout只保留在工具会话，未声称存在单独完整日志文件。

## 复现命令

以下均为离线，工作目录是 `experiments/harness-lab`：

```bash
node --import tsx --test ../../.trellis/tasks/10-15-agent-map-spatial/r14-20261026/provider-budget.test.ts
node --import tsx --test ../../.trellis/tasks/10-15-agent-map-spatial/r14-20261026/live.test.ts
node --import tsx --test --test-name-pattern='D06|execution gate|AFP counts' ../../.trellis/tasks/10-15-agent-map-spatial/r14-20261026/live.test.ts ../../.trellis/tasks/10-15-agent-map-spatial/r14-20261026/provider-budget.test.ts
node --import tsx --test --test-name-pattern='synthetic date|two buffers|D18 native' ../../.trellis/tasks/10-15-agent-map-spatial/r14-20261026/live.test.ts
```

从仓库根目录执行：

```bash
./experiments/harness-lab/node_modules/.bin/eslint --config experiments/harness-lab/eslint.config.js --no-ignore .trellis/tasks/10-15-agent-map-spatial/r14-20261026/*.ts
./experiments/harness-lab/node_modules/.bin/tsc --noEmit -p .trellis/tasks/10-15-agent-map-spatial/r14-20261026/tsconfig.json
```

## 未解决事项

**D04仍阻塞正式测评。** 固定产品要求来源 `resource` 有 `availableCount` 和 `unit`；原计划缺数量的来源对象会导致真实查询契约失败，不能按原题得到完整三对象。运行器中D04缺口文字的mock检查只证明停止逻辑，不证明该真实任务可执行。详情见 [d04-review.md](d04-review.md) 与 [check-cases.md](check-cases.md)。没有改产品、伪造工具成功、替换原题或启动收费测试。

正式调用还须由主会话完成最终独立检查、任务口径处理、账户观察及源freeze。运行命令是 `live.ts run NEW_OUTPUT FREEZE ACCOUNT_PREFLIGHT [PORT]`；当前不得执行。首个实际D01三组才核实服务端兼容性和返回模型，不另加收费探测。普通澄清文字匹配仍有措辞覆盖限制；未预见问题保留并停查，不能临场猜测回复。
