# 导演台整合实施设计

依据已审阅方案和用户本次“提交方案git，然后开始实施”。方案提交1f324a1；本次允许实现与技术验证，不部署，不标记用户验收。

## 需求接缝
现有ScenarioStore及ScenarioScope已有唯一活动轮次、CAS、暂停/结束隔离和activation恢复；自由调试接入这一原机制，不另设竞争的活动指针。扩展明确的调试轮次/操作方式，编辑和通知以实例归属验证。现有控制路由统一导演授权，旧无轮次写接口不得默认写入活动演练。服务端切换必须复用结束门禁，停止推进和在途工作、未确定通知阻挡、重复操作回执；进入演练选择后无自动启动。历史和原业务状态不伪造完成。

业务接入复用R4 SQLite及credential服务；情报/态势各自具有查询与入站配置，普通catalog不重复暴露入站卡片。运行source最终两个，旧source仅历史只读；停服显式迁移保存整个旧数据与外部凭证。历史event/job/delivery/payload/nativeJSONL不改写；来源归类只是读投影。必须保留处理范围与ACL，不把合并权限集合当成授权。规则和凭证冲突dry-run列明阻断，不静默丢配置；可明确逐source迁移策略后apply。

## 文件与责任
1. 轮次后端：contracts/scenarios及新增director契约、mock-context/scenarios及control、server/scenario/context routes、scenario模块、对应确定性测试。负责向UI交付精确API。
2. 业务接入：connectors与contracts/connectors、server/connector-routes、background入口/历史ACL必要适配、ConnectorLibrary、显式迁移脚本及fixture/test。不改轮次后端或主页面。
3. UI：ScenarioDirector、Simulation编辑器、main/sidebar/router/static fallback、样式及相关e2e。接入后端明确API后实现，不伪造模式。
父会话负责跨层集成与全局检查、规范/任务记录。共享文件先通知owner。只需适配桌面，不新增手机工作，不改变Pi内核，不增加OAuth。

## 发布与回退
本次交付代码与迁移工具，任何真实数据迁移/部署另待用户指令。新规则不能静默在旧根启动时套用；读取历史仍保留旧身份。完整备份配对旧程序、配置、密钥，dry-run零写，apply可核验和重入；新格式启动门禁避免半迁移。

## 接缝细化
现有activation收据必须指向一个新实例，无法表达“结束旧轮并进入无活动演练的选择页”；因此扩展一个仅记录过渡步骤的director transition收据，继续以source active pointer为唯一运行权威。不是新增独立mode状态源。
业务来源候选优先复用scenario-*两ID，旧mock-*保留历史/原策略作用域，不能继续外部接收；未来消息以canonical source接收，可信轮次决定精确policySource scope。事件/作业固定该策略作用域，模式切换不改变旧权限。需要严格核查连续分析与任务关联的对应校验。
