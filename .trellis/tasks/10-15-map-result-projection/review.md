# 独立实现审阅

2026-10-15。按最新已批准的 PRD/design/implement 和 check.jsonl 审阅。此处先记录真实模型批次前的独立检查；真实模型操作及正文结论见随后 validation.md、semantic-review.md，不能用本检查替代。

## Findings (fixed)

- `experiments/harness-lab/tests/pi/composer-input.test.ts`：静态审阅发现“新输入使用 v5”的局部用例仍用 v4 做解码断言，混合历史用例标题/材料仍停留于 v4。已通知实现者改为 v5 解码并增加 v5 混合条目，独立复测通过。已有原生混合重开测试此前已覆盖 v1–v5，故不是已证实的产品兼容缺陷。
- 本审阅者未修改产品代码；没有需要另行自修复的机械缺陷。

## Findings (not fixed)

- 未发现阻断本轮固定真实模型复测的实现缺陷或未解决设计偏离。
- 模型业务解释准确性仍待原场景及三个只读案例验证。投影和查询范围说明不能保证正文不编造，不据此预填“回答改善”。

## 审阅范围与证据

- 逐段核对工具原始结果 → 模型投影/原生 details → hook → 实时完成/历史快照 → useChat → 固定地图入口。服务事务、权限、HTTP DTO、CAS 和原始读取依据未被改写；新内容/元数据不匹配时不生成成功入口，旧 plain JSON 兼容路径独立。
- 核对仅在已知元信息路径移除 hash；业务 attributes.hash、实际字段和来源时间保留。查询结果直接回显原选择，计数/分页仍来自服务；没有自动全图查询、结果审核器或新持久回执系统。
- 核对 v1–v4 生成器未改动、固定历史夹具和 v5 精确校验、原生压缩/重开回执测试。关键 baseRef/current 说明仍随自动上下文和工具提供。
- 原桌面驱动仅调整 A01 的回执取证路径，原提示、步骤和业务断言未变。新 G01–G03 使用三个独立会话，固定图层/分页/字段案例；只读状态比较与实际调用覆盖分别记录，覆盖布尔值没有自动赋予语义通过。没有重试到通过的选项。
- backend/map-annotations、backend/conversation-references、frontend/harness-lab 已同步实际契约。项目仅桌面浏览器范围保持不变。

## Verification

- Lint：**pass**。独立执行 `npm run lint`，包括 Pi/浏览器依赖边界。
- TypeCheck：**pass**。独立执行 `npm run typecheck`。
- Tests：**pass**。独立执行下列 6 个文件，**59/59**，包含主会话新增只读驱动 2 项：

  `npm test -- tests/annotation-results.test.ts tests/pi/provider-payload.test.ts tests/pi/composer-input.test.ts tests/pi/annotation-hook-boundaries.test.ts tests/probe-map-result-projection.test.ts tests/probe-desktop-map.test.ts`

- Diff check：**pass**，`git diff --check`。
- 实现者记录另有 157 个不同确定性用例、16 个桌面用例及构建通过，详见 [product-implementation.md](product-implementation.md)。本次 59 项与它们存在重叠，不能相加为新增覆盖；新只读驱动 2 项之外不重复计数。
- 未重复 E2E/构建：最后产品构建后仅调整测试材料，独立审阅没有产品修改。未调用真实 provider、未提交、推送或部署。

结论：静态实现与上述独立检查通过，可冻结产品和驱动并执行已批准的真实模型批次。

## 真实批次后的取证补丁审阅

默认批次暴露一个静态检查未发现的验收驱动遗漏：C01 比较判据仍直接读取旧 JSON 顶层 left/right/counts，新结果位于 data，导致真实比较已完成却被判 `No comparison of actual P1 and P2`。主会话保留首批原始 incomplete 与原冻结清单，只修正 `scripts/probe-desktop-map.ts` 的比较取证，并在 `tests/probe-desktop-map.test.ts` 增加新/旧格式、错误/未知格式边界测试。

检查者已审阅该补丁：仍要求实际 annotation_read 成功结果包含真实 P1/P2 和 counts，业务输入、步骤与断言没有放宽；错误/缺失/未知外层被拒绝。产品和构建未修改。主会话记录修正后两类驱动测试 11 项、lint、typecheck 通过；独立语义审阅又确认首批实际 compare 及后续持久状态符合原业务要求，后两条完整协同链 protocol_completed。详情见 [collaboration-semantic-review.md](collaboration-semantic-review.md)。

此遗漏已修复，但首批自动判据的失败不追溯改写；不同驱动冻结批次单列。真实回答仍有两条已证实语义错误，不能沿用静态检查通过结论称业务回答全面通过。
