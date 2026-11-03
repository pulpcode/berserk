# 修改边界

完整设计见[已审阅第二轮方案](../10-28-agent-spatial-plotting/resource-followup-20261102/02-rules-and-evidence.md)。

缺口位于资源公开结果的事实说明、两份现有Skill和离线评分/接续契约，不在模型内核。复用现有资源事实与时间字段，补原因及适用对象；公开投影若改变持久正文，按版本保留旧渲染。

预计修改contracts/resource-results及必要投影模块、context/task-resources、两份fixtures/skills与受控目录版本、相关测试；必要时现有结果卡片；独立新任务目录保存评分校准，旧题包/原始轨迹/原分数保持不变。现有评分模块若需复用仅做兼容扩展，版本化新规则。

不强制Skill读取，不新增自由文本拦截器、裁判Agent、Agent循环或持久化系统。状态原因不得把conflict降unknown、过期证据变当前否定、未收证据变事实未发生。
