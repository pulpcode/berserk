# R15 执行器说明

只新增本轮执行器；未改旧轮次文件、未调用真实模型、未提交 Git。

## 怎样保证四组可比

- G0、GS、GT、GST 共同归档自产品基线 `6a631a42b99b01de334cd2017c07bf0d9d58a560`。
- GS/GST 只覆盖本轮 `candidate-skills/` 两份 Skill；GT/GST 只覆盖 `runtime.ts` 列明的六个工具文件。旧工作副本 Skill 和 resource-tools 不复制进去。
- 每题先建立四个独立会话，核对规范化后的业务数据、题目、权限和固定日期相同，再开始请求。
- 四组都固定 Flash enabled/high，按需读取 Skill。逐请求保存实际 wire、Skill 目录/正文出现情况、实际模型、token、原始响应、公开历史、工具调用及真实地图状态。
- Skill 的显示名称和适用说明也出现在原生 `skill_read` 参数描述中。只对经过真实 Skill 元数据核对的两处描述做比较归一化；其他 schema 必须一致，每组原始 schema 自身也必须稳定。实际字段差异见 `offline-logs/four-factor-schema-and-p12-proof.json`。

## 预算与停止

固定 48 个题次，不自动重试或恢复。整批上限：600 次模型请求、1200 万输入 token、100 万输出 token、2000 AFP；包括子任务、压缩、失败请求。未知用量停止，不能按零费用继续。

新四组开始前预留 24 次请求、60 万输入、131072 输出、100 AFP；这是整批剩余额度的保守检查，不是单题截断。题目开始后按真实原生循环继续；超过 12 次请求或 10 分钟只提醒，300 秒无进展停止。

未预设答案的必要澄清留待定，继续独立题。当前隔离草稿内的错误写入记该题失败：必须核实请求已终止、确切请求ID一致、来源和指令未改、无全局技术错误、共享采用/发布和权限绑定未改。不能因为随后的澄清把真实越权改为待定。跨界或无法确认隔离则停批次。

HTTP、协议、模型/代码/配置漂移、预算耗尽或未知用量停止整批，保留原记录。独立审核通过的 freezeHash 与执行器源冻结必须一致；真实入口只允许一次 `.local/spatial-r15/live-claim.json`，改输出目录不能重复启动。

## 执行命令（根会话使用）

以下从 `experiments/harness-lab` 执行。先通过独立检查，再生成冻结文件；`NEW_FREEZE` 和 `NEW_OUTPUT` 必须不存在。

```sh
node --import tsx ../../.trellis/tasks/10-15-agent-map-spatial/r15-20261027/live.ts prepare NEW_FREEZE
```

独立复核记录 `r15-20261027/offline-gate.json`，至少包含 `status:"passed"`、该冻结内容的 SHA-256 `freezeHash`、非空 `evidence` 路径列表。根会话按现有安全方式提供已核对的 Agent Plan 环境变量，不把 Key 写入报告或命令行。

```sh
node --import tsx ../../.trellis/tasks/10-15-agent-map-spatial/r15-20261027/live.ts run NEW_OUTPUT NEW_FREEZE ACCOUNT_PREFLIGHT 4707
```

`NEW_OUTPUT` 须在 `.local/spatial-r15/` 内，父目录存在。状态读取 `runs.json`、`budget.json`、`attempts.json`、`batch-state.json`；每题目录保存 `review.json`、`deterministic-evidence.json`、`judge-input.json` 和原始 native 会话。脚本结束不等于通过，语义评分仍待独立复核。

## 离线验证与保全

本轮离线模型响应均为模拟；它验证执行器接线，不能作为模型正确率。

- provider/预算 6 项检查通过，包括计费一次、未知用量停止、四组真实参数、零思考内容合法、目录描述的精确差异范围。
- task TypeScript 与仓库根目录真实 ESLint 检查通过。
- 稳定的完整流程：P01/P07/P08/P12 四组共 16 个原生任务通过，136 次模拟请求全计账；P07 每题 17 次请求未被截断。确认 Skill 真实按需读取、固定 700 米结果保存、1200 米仅预览、P12 新旧对象保留，以及普通/API预设澄清继续。
- 故障及边界回归原批 13 项中 12 项通过；API 澄清发生在越权之后时，真实效果已正确记 task failure，但摘要 stop 仍保留旧澄清原因。局部修复为保留 precedingStop，并以已确认越权作为最终 stop；类型/lint 复过，仅该项四组复验通过。原失败和单列补验分别见 `offline-logs/r15-native-boundaries-stable.log`、`offline-logs/r15-native-isolated-api-fixed.log`。13 个独立检查项现均有通过证据，没有新增真实模型请求。

所有开发期失败原日志保留在 `offline-logs/`：先发现 R15 日期清单格式不同；随后并行/自身编辑被 source freeze 拦截；再发现 Skill 目录说明导致预期的工具描述差异，以及显示名称不能拿 ID 代替。上述问题均只在离线暴露。原失败不删除，不并入正式 48 项计分。最后一次边界检查的负向 Node 测试名称过滤未排除完整流程，因此额外重复了已通过的 16 项离线接线；没有新增真实模型任务。
