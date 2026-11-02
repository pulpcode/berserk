# 第三批实施中核实的边界

用户授权基于 d194f4c，真实模型调用保持0。以下是按最新代码选取的最小实现，不增加后续批次。

1. 资源卡分页：现有授权session snapshot已返回原生完整资源结果。分页重新读同会话授权投影后切页，不另发Agent消息或调用模型，不重新查询来源。没有结果或撤权时不得旧缓存兜底。
2. 来源导入：已有AnnotationService.fromSource及Agent工具，但没有网页HTTP入口。增加薄路由，沿用auth/session/task/CAS/幂等/取消/回执检查，复用服务；不是新增旧标注绑定接口。
3. 当前没有独立手动压缩产品入口。本批核对真实自动压缩与共享compaction参数，不为验收新建入口。
4. 产品已保留Pi原生会话重试(maxRetries=3)，供应商transport maxRetries=0。本批保持原生策略；方案T23的无自动重试仅指测试任务不自动追加及transport无重试，不宣称整个产品无重试。参数必须在既有原生续轮/重试中一致。

具体实现与最终检查以ui/model/skill-checks和review为准，不能由本记录推定已通过。
