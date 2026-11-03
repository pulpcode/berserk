# R1–R4 独立静态复核

结论：未发现阻断本轮冻结的产品问题。本复核没有修改产品代码，也没有调用真实模型。

- **完整引用与权限**：`lab.ts` 使用当前会话分支解析定位；`composerHistory` 校验工作区、会话、原内容模板及重复请求；返回原固定 ref、layerIds、objectIds。`reference` 参数分支不接受另填筛选。读取继续经过 `AnnotationService.read → version → accessible` 的既有任务、席位、来源授权检查，不建立可写草稿依据，失败不回退全量。
- **历史和范围回显**：v1–v5 文本函数未改，引用请求新增 v6，解码与历史证据验证同步支持；`query` 回显为恢复后的实际选择。定向测试包含原历史字节保留、分页、压缩、重启、跨会话拒绝、拆分对象及非法序号。
- **规则与实际工具**：`spatial_analyze` 已移除“询问或完整分列条件答案”的无条件出口，与 Skill 的单范围澄清／明确比较规则一致；真实提供方请求检查覆盖描述与参数 schema。新增说明未引入强制 Skill 读取或通用范围凭证。
- **卡片**：未指定 position 的空间结果汇总显示“按所选空间结果集合统计”；指定 interior/boundary/exterior 仍显示对应标签，未修改统计数据。

非阻断文字问题：`tests/pi/annotations.test.ts` 的 “preserves cancelled v5 preparation” 标题仍为 v5，实际 spy 与写入路径已改为 v6；建议后续只更名，避免误读覆盖范围。

验证范围：本次为独立静态复核；未重复执行产品代理已通过的全套测试。此代理另行完成 T01–T03 实际离线工具链、题包 typecheck 与新增文件 lint，见 `tool-regression-review.md`。
