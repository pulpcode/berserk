# Fixture 实施与契约纠正

2026-11-03，首次真实 `situationObject` 离线解码检查发现：原题包把 `properties.memberRefs` 用于 N02 的 lq-morning/lq-evening 和 N05 的 hk-all/lt-all；实际 `experiments/harness-lab/src/context/validation.ts` 的资源分支只接受空 properties 或旧 availableCount/unit，memberRefs 只接受于区域对象。TypeScript 的 properties 联合类型本身不能证明资源分支可解码。

原失败检查保留在 [fixture-decoder-pre-correction.log](fixture-decoder-pre-correction.log)，13/14 通过，资源解码以 CONTEXT_INVALID_ARGUMENT 失败。检查没有调用模型、没有修改产品。

主会话审阅后裁决：删除上述四行冗余非法字段并保持 `properties={}`；同步 cases.md 三处技术描述。全部 source/object/entity ID、名称、几何、数量、完整成员ID、时间、导入、用户原文和评分预期不变。N02 的五个真实单体仍能经同源 situation_query 读取 entityId/name；N05 四车与三艇单体保留，lt-e81 仍仅为完整成员表中的ID。此纠正不新增假对象或宿主关联。

实现采用 buildFixture(caseId, taskId, t0)，无环境时间 fallback。运行器必须先保存实际时钟响应，再传入一次 T0；来源默认 asOf、版本/标绘 createdAt/查询 queriedAt/导入回执全部由实际服务响应取得。N05 的两个合成 asOf 由实际 HTTP 来源返回并留存。P04 更新通过 materializeSourceUpdate(fixture, actualUpdatedAt) 构造下一来源版本，不修改旧 fixture。

N02/N03 的来源汇总是首轮用户 contextRefs 附件，不偷换成 task businessRefs；标绘选择分别使用固定图层或对象。N02/N04 仅提供真实单体导入意图，resourceAssociation 必须由 AnnotationService/from-source 生成并在运行时核对。

离线 oracle 仅在 fixtures.test.ts 读取，运行入口不得导入。集合并集和矩形不等式是独立人工/测试推导，未使用被测产品汇总/空间函数。真实 HTTP 分页、服务持久化、导入回执、浏览器显式引用由运行器离线集成与公开流程另行验证。
