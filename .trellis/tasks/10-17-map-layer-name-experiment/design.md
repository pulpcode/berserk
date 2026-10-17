# 最小设计与冻结测评

## 产品边界

新增可选 `layerNames:string[]`（1–32 个唯一的非空名称，每项不超过现有图层名 120 字符），与 layerIds 互斥；与 objectIds 同时提供时维持原交集/缺失拒绝规则。

名称解析位于 AnnotationService.read：先由原 version(actor, taskId, ref) 完成授权及固定快照读取，再在该文档 layers 精确匹配名称。所有名称各自唯一才复用原对象筛选/分页。名称顺序不改变保存顺序。不自动去空格、折叠大小写、转译或寻找最新版本。

缺名返回有区别的只读错误；同名错误含该授权快照内候选 ID，用现有错误 message 承载小型候选列表，保持错误协议，不新增状态、回执或成功结果。多名称任一失败则整次失败，不部分成功。

结果的 layers 继续提供实际命中的 ID/name；模型 query 原样包含提供的 layerNames。输入名称不是永久引用，输出 ref + layerId/objectId 才是固定依据。AnnotationSelection、HTTP 固定引用 URL、前端接口无需新增名称定位。

## 预计改动文件/函数

`experiments/harness-lab/` 下：

| 文件 | 必要变化 |
| --- | --- |
| src/contracts/annotations.ts / AnnotationReadInput | 可选名称参数，结果结构不改 |
| src/annotations/validation.ts / readInput | 长度/唯一性/互斥验证 |
| src/annotations/service.ts / read | 授权后固定版本精确匹配、歧义/缺名明确拒绝 |
| src/pi/annotation-tools.ts / readSelection、draft/read | 新参数说明和透传，仅校正直接相关描述 |
| src/pi/annotation-results.ts / annotationToolResult | query 回显 layerNames |
| tests 中现有标注 service/tools/projection 测试 | 边界、权限、原ID兼容及实际 schema 验证 |

不改变服务写事务、AnnotationRequestState、工具包装器、hook 或 receipt。仍由实际成功读取建立原有依据，失败不建立依据；hook 改写/丢弃仍走现有保护。HTTP read 若共用 DTO，能力自然一致；不加路由。

## A/B 隔离与固定条件

A 使用 ae7236c 的源码归档；B 使用本工作区候选；两者使用同一版本依赖和相同测评脚本，不在运行中改写工具或 provider 内容。A/B 各创建 14 个独立虚构身份/会话/数据库。不会使用生产资料。

模型 deepseek-v4-pro，thinking disabled、max_tokens 2048、contextWindow 1000000、请求超时 60000ms，沿用原 Native Pi、Observer、ask、mapState 与 F1/F2/F3 fixtures。模型只看业务指令及正常工具结果，评分真值不进入工作区。

每组沿用 Observer 的上限：90 次 provider 请求、2M input、60K output（合计至多 180/4M/120K）；每条最多 6 次 provider 请求/360 秒。不替换失败，不额外补测。不触碰 .env.local；只通过现有 DeepSeek endpoint 使用已授权凭据。

## 固定场景（各组每类 2 次）

| 场景 | 步骤与正确边界 |
| --- | --- |
| F1 | 原“仓储设施”第4–5项；东仓/山脚仓，图层5、全图7 |
| F2 | 原 Agent 先改 B乙备注，再对照引用 A甲与 B甲；仅乙改动，比较 A现场讨论/基线备注 |
| F3 | 原“应急补给”第51–52项；松林/湖湾，点；图层58、全图64 |
| N1 | 新名称“河岸巡查”，不透明 ID，查询第2–3项；验证非针对旧中文名称 |
| N2 | 两个同名“临时停靠”图层；只问该图层第1项，未指定 ID。应呈现歧义/请求选择，不能擅选或混合序号 |
| N3 | 查询不存在的“备用观察”；应明确本草稿未找到，不能把全图对象当目标返回 |
| N4 | 固定旧版图层叫“潮汐观察”，当前已改名；用户引用旧版并查旧名第2项。应按旧版名称返回旧对象，不切到当前草稿 |

原三类业务指令、数据、评分标准不变。新四类在首次真实调用前冻结具体数据和文本。可合法使用摘要发现 ID；不强制调用 layerNames 才算完成。单独记录名称能力是否实际使用。

## 退出与回退

鉴权/额度错误、缺 usage、证据写入失败、越权写入尝试、非预期状态变化则停止批次，保留已有和未执行分母。工具普通参数拒绝允许原生 Agent 自行恢复；同名正常澄清记为该场景成功终点，不自动答复。

任何核心边界回归不进入 live。live 若出现实质性新增错误或未达门槛，不推广候选；保留失败证据，可逐文件恢复 ae7236c 的上述产品文件。回退无数据库迁移，无部署回滚需求；保留实验文档/脚本/报告。未达到门槛时不当场改提示词继续刷分。
