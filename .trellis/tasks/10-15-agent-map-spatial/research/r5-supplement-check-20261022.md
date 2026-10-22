# R5补测局部独立复核

复核者：既有trellis-check子Agent r5_check；主Agent将其只读结论归档。未修改产品、冻结代码或评分规则，未调用模型、重跑工程或提交Git。

补测入口check、Lint、diff通过。5槽位准确，预算收紧实际作用于原runLive；旧unknownUsage仍1，原603文件哈希均未变。两批合成日期相同。

D16两组主任务和效果均通过，解释均失败：L0 messages[12]/9c0cc2ef明确称16对象内容不变，但revision2→3实际给origin新增note；L1 messages[8]/2d8c5576把真实name基点写成原点，ID和计算对象仍正确。L1 messages[16]对象清单未变的说法有依据，不另判错。

两组都只buffer一次，首次500米预览与保存geometry逐值相同；仅向derived新增临时范围，其他文档与冲突注入后完全相同，外部备注保留、publication/current不变。后续服务提议及明确省略号引用不额外判错。

D16 review SHA256：
- L0：0980a178d3df9679b3773d2b7189e7172ee68b437aacc9ef90e32e5339646034
- L1：045ac244d33f72e1591c51232164217d84a4dc0a60d2b8d40da3fa2e72adf54a

这是两项及运行边界的独立局部复核，不是全部8项双盲评分。
