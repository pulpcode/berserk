# R12 C：回答生成对照材料与运行说明

状态：已实现离线准备和执行器；本文件不表示真实请求已经执行。真实调用仅由主会话在所有离线检查通过后按用户授权启动。

## 1. 六个回答时点

每份材料都截取在真实工具返回后、原目标回答生成前。旧目标回答、后续消息和裁判结论不进入输入；较早助手公开说明原样保留。两组都保留原Skill正文和工具定义，不使用R12 B候选。

| ID | 来源与回答时点 | 材料性质 | 本次复核重点 |
| --- | --- | --- | --- |
| C01 | R11 `Q02-2-S0-N/provider-0134-wire-input.json` | 真实历史 | query关键词成功不能说成按返回区域ID重新查询；点数1与车辆数量4分别说明 |
| C02 | R11 `Q04-2-S1-N/provider-0168-wire-input.json` | 真实历史 | 第一次500米结果，筛选命中0；额外排序不能无依据或说错 |
| C03 | R11 `Q05-1-S0-P/provider-0073-wire-input.json` | 真实历史 | 读取多个图层，不代表这些图层都参加resources候选计算 |
| C04 | R11 `Q06-1-S1-P/provider-0096-wire-input.json` | 真实历史 | 第一轮只预览，第二轮保存成功回执revision=2；未发布、未设当前 |
| C05 | R11 `Q01-1-S1-P/provider-0012-wire-input.json` | **构造：只补用户解释要求** | 方法和依据必须说明；真实结果为内部2、边界2、外部1，包含边界共4 |
| C06 | R11 `Q05-2-S1-P/provider-0194-wire-input.json` | 真实历史 | 按用户明确要求给两个点的名称和直线距离，不得漏答必要数值 |

来源路径均相对于 `.local/spatial-r11/batch-20261025/`。C03和C06属于同一Q05家族，六个回答时点不是六个独立业务场景。选材用于开发诊断，不是新保留集。

C05在**原来的用户消息**末尾追加一句“请同时说明你采用的判断方法和依据。”，不插入新的工具后用户轮次，不改工具结果。准备器保存原请求和构造后输入的哈希、消息索引及追加原文。内部/边界数量直接对真实工具values做断言，不能凭印象写人工预期。

程序中的 `review` 文本仅进入评测材料清单，**不会加入请求正文**。评分人员应以完整实际工具证据为准；历史较早说明与本次新生成内容分开标记，不能把既有错误算作本次开启或关闭推理造成的新错误。

## 2. 对照与预算

- C0：Flash，`thinking.type=disabled`，不传 `reasoning_effort`。
- C1：同一Flash，`thinking.type=enabled`，`reasoning_effort=high`。
- 两组都使用 `max_tokens=32768`、`top_p=1.0`，不传temperature，保留原stream=true。
- 同一时点两组的消息、工具定义和其余参数完全相同；程序只允许thinking及reasoning_effort不同。
- 六对各一次、共12次。奇数材料先C0，偶数材料先C1；顺序提前固定。
- 独立预算：12次请求、40万输入tokens、40万输出tokens，输出包含思考，不重复加算reasoning_tokens。不得借用B的剩余额度。
- 输入启动预留采用对应历史请求返回的prompt_tokens，加2048余量及构造附加文本的UTF-8字节数；这是保守预留估计，实际计费以新返回usage为准。完整材料预留不足时停止，不裁剪上下文。

## 3. 什么情况下停止

第一对包含在12次中，承担兼容性检查。开启组必须返回非空思考字段或正数reasoning_tokens；关闭组不得出现思考信号。未确认生效、HTTP错误、未知用量、模型版本变化、冻结内容改变等立即停止后续请求，失败与未执行项都保留，不自动重试。

返回工具调用只记“需要继续取证”，本程序不执行任何工具，不算完整回答成功，也不因提出工具调用就自动判事实错误。length结束记“截断”，不计回答通过，也不当作证据充分的能力失败。公开内容的事实准确性另由证据复核判断。

`run-claim.json`在首个请求前以排他方式写入准备目录，防止同一冻结批次换一个输出目录重新运行。网络失败也会占用已尝试请求；原始SSE和进度先落盘。没有自动恢复、追加或独立连通性探测。

## 4. 命令与产物

工作目录：`experiments/harness-lab`。准备命令不读取Key、不调用模型：

```bash
node --import tsx ../../.trellis/tasks/10-15-agent-map-spatial/r12-20261025/reasoning-prepare.ts <全新绝对路径：.local/spatial-r12/C-prepared>
```

主会话确认所有离线检查通过后，使用既有 `.env.local` 和下面命令执行已授权批次；不得运行两次：

```bash
node --import tsx --env-file=.env.local ../../.trellis/tasks/10-15-agent-map-spatial/r12-20261025/reasoning-live.ts run <C-prepared> <全新C-output>
```

准备目录包含六份base、十二份实际请求和freeze.json。运行目录包含protocol.json、progress.json、results.json，以及每次request.json、response.sse、record.json；异常另存failure.json或response-error.txt。请求不保存鉴权头。思考内容仅保存在原始响应中用于协议追溯，不进入语义评分材料；record只记录思考长度和用量。

本程序复用现有Agent Plan环境校验与SSE解析，不经过会强制关闭推理的产品适配链路。因此C结果只代表固定历史后的单步生成，不证明完整产品工具循环的推理接入已经正确。
