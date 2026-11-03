# 设计依据与修改边界

设计以[已审阅方案](../10-28-agent-spatial-plotting/resource-followup-20261102/01-tool-correctness.md)为准，不另写一套方案。

缺口位于资源服务的统计筛选、共享数量聚合与结果校验之间。预计修改context/task-resources.ts、contracts/resource-summary.ts、contracts/resource-results.ts及必要的Pi历史读取分支和相关测试。保留严格校验，版本化新规则，旧字节不改。T14必须经过真实解码、HTTP、工具和原生历史。

不新增存储、身份服务或Agent框架。只有必要的共享统计规则提取；用旧版本固定样例和相关回归证明兼容。
