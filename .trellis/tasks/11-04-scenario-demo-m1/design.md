# 第一里程碑执行边界

沿用父任务milestone-1-design.md v0.5与现有Pi、HTTP、SQLite和React/useApi机制。

## 所有权与接口协作

- 场景实现者：scripts/mock-context的场景定义、实例引擎、持久化/HTTP接入及对应测试；拥有src/contracts/scenarios.ts共享导演DTO，先公布契约供前后端使用。
- 身份实现者：contracts/access.ts、access认证存储/迁移、离线账号管理与访问测试；新增默认关闭的controlScenarios，不修改导演前端或场景引擎。
- 页面实现者：web/ScenarioDirector.tsx、页面样式、main.tsx导航/路由和Seats.tsx登录落地；与其他实现者共享DTO，不添加第二套状态存储。
- 主代理：context中的场景时钟解码/配置、资源v4/历史兼容、Axon控制代理与任务映射、最终联调和质量检查。

## 必须保持的约束

场景时间与业务事实同一事务提交；保存和发送分开；控制权限由当前认证身份及配置指定导演席双重验证，旧来源管理权不构成新场景授权。旧模拟API和旧资源结果保持原义，不能绕过新场景权限。不得读取生产配置/数据或启动付费模型。

## 修改范围

仅experiments/harness-lab相关场景、契约、查询、认证和前端，以及对应spec/测试/任务记录。地图合成覆盖层明确出处和合成含义，不宣称道路行驶时间或真实路网已验证。
