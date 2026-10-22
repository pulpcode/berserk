# R5 精确对象名称查询实施与离线检查

日期：2026-10-22。范围：已批准方案第 9.3-A；本记录不包含真实模型效果结论。

## 已实现行为

现有 `annotation_read` 的 `draft/read` 支持可选 `objectNames`；HTTP 固定读取共用 `AnnotationReadInput` 和服务校验。每次接受 1–32 个不重复、非空白、长度不超过 120 字符的名称，沿用现有图层名称输入规则；按原文精确匹配，不去空格、不折叠大小写、不模糊查找。

- `objectNames` 与 `objectIds` 互斥；与指定的 `layerIds` 或 `layerNames` 取交集。两类图层选择仍互斥。
- 服务先完成固定版本授权，再匹配名称。没有跨版本搜索、全图回退或权限扩张。
- 零匹配正常返回空页；同名对象全部保留，按已有文档顺序分页。`objects.total` 是这些名称在本次范围内合并后的分页前总数，不表示每个名字都命中。
- 返回原有对象 ID、图层 ID、名称与固定引用；`layers` 与原对象 ID 查询一样，仅保留有匹配对象的图层。`fields` 仍控制几何等额外字段。模型投影的 `query` 原样回显传入的 `objectNames`。
- 已有 ID 查询可直接使用；不增加“先查名称”的条件。不存在的显式对象 ID 仍按旧规则报错，不改成空页。
- 草稿读取的版本依据、CAS、固定引用读取不可编辑的边界不变。composer 引用仍使用 ID，不接受名称选择。

同时按主会话要求给 `annotationTools` 接入了主会话维护的 `methodAdvice` helper：仅在已知未提交错误、且方法可用时附加可选方法入口。原错误码、消息、恢复资源及未知结果处理保留；不自动读取、重试或改变保存条件。

## 文件

产品：

- `src/contracts/annotations.ts`
- `src/annotations/validation.ts`
- `src/annotations/service.ts`
- `src/pi/annotation-tools.ts`
- `src/pi/annotation-results.ts`

测试：

- `tests/annotations.test.ts`
- `tests/annotation-results.test.ts`
- `tests/pi/annotations.test.ts`
- `tests/pi/provider-payload.test.ts` 的 annotation_read 部分（Skill schema 部分由并行同伴维护）

以上均位于 `experiments/harness-lab/`。没有修改 Skill 正文、历史模板、空间计算或保存实现。

## 离线检查

- `npx vitest run tests/annotations.test.ts tests/annotation-results.test.ts tests/pi/annotations.test.ts tests/pi/provider-payload.test.ts`：4 文件、57 项通过。覆盖零/唯一/同名、多名称部分命中、分页、图层交集、精确大小写与空格、固定修订/发布后改名、跨任务/席位及来源权限、非法选择、实际 provider schema、真实 Pi 工具循环与重启。
- 新的真实 Pi 测试确认：固定名称读取没有建立草稿编辑依据；错误回执保留 `ANNOTATION_READ_REQUIRED`、`outcome`、`resources` 并附带 `map-annotations` 方法入口；随后草稿名称读取建立正常依据，原编辑可成功。
- 旧 ID 读取与新名称读取同会话持久化并重启后，消息和原生文件字节保持不变。普通读取不新增结构化回执版本，因此无需新历史解码器或迁移。
- `npm run lint`：通过，Pi/browser 依赖边界通过。
- `npm run typecheck`：名称/provider 测试的新增断言类型已修正；复核时只剩并行空间测试 `tests/pi/spatial.test.ts:154` 的临时语法错误，已通知主会话与负责同伴。最终集成检查由主会话完成。
- `git diff --check`：通过。

## 兼容与边界

旧输入、ID 查询、结果投影、原生历史及保存条件保持可用。本能力帮助定向找到候选，不保证模型选择了用户真正指代的对象；名称唯一也不证明意图解析正确。没有提交 Git、调用真实模型或执行后续 12 项测评。
