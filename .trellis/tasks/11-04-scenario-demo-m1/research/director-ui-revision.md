# 导演台事件融合实施边界

日期：2026-11-05；按用户要求实施供审阅。

现有差距：任务卡片常驻并与事件/预览/通知分栏，任务与事件的编排关系未展示。

- ScenarioDirector.tsx与样式改为单列表、一次展开一条；首事件复用initialize、activate两个显式操作，不新增自动串行请求或持久化工作流。任务创建、启用、预览、应用和发送仍可分别核对，不因打开/刷新执行写入。
- contracts/scenarios.ts与场景来源的detail只读投影补充taskCodes及taskDefinitions。data.ts单独持有导演标签映射，不改sceneWorld、definitionHash、存量快照或消息。host status白名单接受新增只读字段。未知旧版本元数据缺失时不猜测关联。
- 事件中的剧本任务按code解析成当前实例taskId，仅作导演导航；不返回业务来源、工具或通知。普通来源原有作者编号文案仍按SIM-NOTICE-001延后。
- 相关来源/API/权限和桌面回归、typecheck/lint/build；本地真实HTTP检查页面。线上检查须更新本轮明确改动，保留数据备份、原任务与未投放事件，不自动推进业务。

保留父子任务待用户检查，不实施P3—P6。
