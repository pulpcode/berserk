# R15 工具改动与离线验证

## 改了什么

1. `annotation_read` 的名称条件完全没有匹配时，仅在已经授权的固定版本、原图层范围内检查同字符串的对象 ID。`nameLookupHints` 只含 objectId/name/layerId；不会补进原 objects.items/total，也不会带出几何、备注或属性。部分名称命中、名称与别的 ID 相同、仅分页为空时，不提示替代结果。
2. 标绘读取的模型返回增加范围、匹配总数、本页数量及只读说明，避免把过滤为空解释成整份草稿为空。原始查询条件仍保留在 data.query。
3. 空间返回按 buffer/filter/nearest/classify_points/summarize/measure/relate 说明数字含义，不把 items.length 一律称为命中数；只说明当前计算或读取未写草稿，不推测内部介质、作者或整个会话的保存状态。
4. 成功回执区分本次执行、幂等重放、读取旧回执；原动作、版本和涉及对象的数据不变。

## 新旧格式如何衔接

新增的是模型展示封装：`annotation.model-result.v2`、`spatial.model-result.v3`，字段为 format/data/meaning。原生 details、SpatialResult schemaVersion 1/2、原 projection、resultRef、创建时间、几何和回执均不改变。

共享解码器仍接受原 annotation v1、spatial v1/v2 正文；新格式必须同时匹配原真实数据以及程序重算的 meaning，额外未知字段、篡改说明或数据均拒绝。没有把自由文本变成证据。

旧历史消息不改写。读取旧结果的新调用可使用新展示封装说明“本次读取”，其 data 仅保留原结果及既有 delivery 字段。原有 method/limitations 不重新生成。新封装含固定措辞，未来改动这些措辞时应升级展示版本并保留本版解码，不能让已存历史失效。

## 产品覆盖清单

GT/GST 仅将以下6文件覆盖到 6a631a42b99b01de334cd2017c07bf0d9d58a560 归档。路径相对 `experiments/harness-lab/`。G0/GS 不覆盖工具文件。

| 文件 | SHA256 |
| --- | --- |
| src/annotations/service.ts | e7af82e061bd044687a646e73b655d8a384507ba0dff9236236e9f724fb4b3ea |
| src/contracts/annotations.ts | d9397adf8d73c0dd8a0c622a19f599d19022285c920ed718409cfaa7fb11bc32 |
| src/contracts/annotation-results.ts | 843e83c347672fe083e7ec6733a18d12d7a9d4a986c2a682e9b882f4b38393a8 |
| src/contracts/spatial.ts | 43c6c57a17986059286a5f12558c90c76384e1a477a7571c128fc6222977862e |
| src/pi/annotation-results.ts | 2bab2614c0da23bd739e3f81bec014ecf32239b115c56dccebfd9270204a9678 |
| src/pi/spatial-results.ts | 71a071e6a993dad3521acbeb236a6314f78009dc040d78281e4eca4570b78bc2 |

未改计算算法、数据库、工具输入 schema、resource-tools 或现有 Skill 文件。324项 protected-before 文件复核全部一致。

## 离线检查

- `npm run typecheck`：通过。
- `npm run lint`：通过，含 Pi/浏览器依赖边界。
- `npm run build`：通过；仍有大于500KB分块提示，不影响本轮构建。
- 首轮10文件167测试：166通过，1条旧断言要求“读取回执正文等于写入正文”失败。已改为原回执 data 相同，同时核对读取与写入 effect 不同，不改变幂等性评分。
- 修正后4文件57测试通过：annotations、pi/annotations、pi/spatial、annotations-acceptance。
- 最后措辞校准后3文件71测试通过：annotation-results、spatial-contract-boundaries、spatial-point-classification。
- 其余首轮通过：spatial-source、spatial-map-ui、pi/annotation-hook-boundaries、pi/provider-payload。
- 浏览器4项全部通过（45.2秒）：旧/新回执按钮、固定范围保存与读取、分类结果重开。命令：`AXON_E2E_PORT=5196 npx playwright test tests/e2e/spatial.spec.ts tests/e2e/annotations.spec.ts --grep 'native save preserves|v2 point classifications|receipt buttons' --workers=2`，使用本地夹具及假模型。
- 根会话审查后补充 not_committed/unknown 负例并明确参照字段位置，annotation-results + spatial-contract-boundaries 共32项通过。失败或未知outcome无法通过receiptMapEntry，不会获得成功meaning；真实工具异常仍走throw路径。

新增/更新测试覆盖：零名称匹配与部分匹配、ID/名称交叉、分页空页、原图层限制、历史版本、其他会话、来源权限撤销；新旧展示格式严格配对与篡改拒绝；实际原生会话写入旧v1/v2历史后重启，使用新v3读取、继续统计并保存原几何，旧消息保持不变；既有压缩、后置hook损坏、权限检查及前端证据测试保留。

测试文件：tests/annotation-results.test.ts、tests/annotations.test.ts、tests/pi/annotations.test.ts、tests/pi/spatial.test.ts、tests/spatial-contract-boundaries.test.ts、tests/spatial-point-classification.test.ts、tests/e2e/spatial.spec.ts。

## 仍需区分

这些检查证明接口、权限和历史兼容，不能证明模型会采纳说明。Skill是否及时读取、是否仍误述及四组效果，交给已批准的48项真实对照；本实现代理没有调用真实模型或提交Git。
