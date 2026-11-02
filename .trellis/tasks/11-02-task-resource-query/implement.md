# 执行顺序

按已批准方案 B2-01—08：基础筛选和可选能力 → 条件取数 → 关系判断和归并 → 数量统计 → 固定结果 → 空间衔接 → Pi 注册 → 验收交接。

实施代理直接实施，不再派实施/检查代理。覆盖全部 D01—24，完整执行 D15 五子例；原始样例与预期分离，禁止把预期硬编码进实现。先 typecheck/lint、相关 Vitest、build，再必要桌面回归；npm 测试和构建采用 --configLoader runner，node_modules 指向其他 worktree，不写其缓存。

先保留首次失败，修复后只复查相关项；localhost 监听如受限说明并由主代理申请。禁止真实模型调用。独立检查由主代理随后派出，最后同步已实现规范并产出 results.md/offline-checks.md/review.md。
