# 实施顺序

1. 复现A06及完整成员重叠；按[方案T01—T14](../10-28-agent-spatial-plotting/resource-followup-20261102/01-tool-correctness.md)独立计算预期。
2. 修复生成、聚合和校验，必要时按结果版本冻结旧算法。
3. 验证HTTP→工具→原生历史→读取与空间续用；缺位置允许partial/unclassified。
4. 运行相关Vitest、npm run typecheck、npm run lint、npm run build。
5. 独立检查、修复发现，落盘逐项证据及限制，提交第一轮结果后供审阅。

禁止付费模型调用、正式测评和自动进入第二轮。
