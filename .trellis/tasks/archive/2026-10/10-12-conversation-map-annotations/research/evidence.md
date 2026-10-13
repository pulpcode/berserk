# 设计依据与尚待验证项

记录日期：2026-10-12。以下区分代码现状、外部文档与本稿建议；本轮没有运行绘制原型、迁移或功能测试。

## E1：账号、席位与任务权限

- [access/store.ts:41](../../../../experiments/harness-lab/src/access/store.ts)：one_enabled_account_per_seat 对启用账号建立席位唯一索引。
- 同文件 70–71 行：身份包含 userId、seatId、createPublicTask 等；151 行：公共任务管理检查 createPublicTask，私人任务检查 ownerSeatId。
- 同文件 166 行：任务写入使用 acquire，与归档互斥。
- 设计影响：工作成果按现有席位边界归属，账号用于行为审计；复用现有公共任务管理能力，不自行解释为“只有任务创建者”。归档只读沿用现有业务约束。
- 设计新增：发布不能泄露其他席位的私人草稿；管理任务不等于能读取所有私人内容。

## E2：工作区共享与宿主存储

- [workspaces/store.ts:93](../../../../experiments/harness-lab/src/workspaces/store.ts)：get 按 seatId 限定工作区；101 行解析会话绑定；111–123 行按 taskSpaceId × seatId 复用工作区并获取写入 admission；149 行建立会话绑定。
- [pi/lab.ts:687](../../../../experiments/harness-lab/src/pi/lab.ts)：现有系统上下文明确同任务同席位会话共享普通文件。
- [execution/docker.ts:180](../../../../experiments/harness-lab/src/execution/docker.ts)：执行容器挂载工作区到 /workspace，日志只读挂载到 /logs。
- 设计影响：会话隔离不能仅靠普通文件命名或 Agent 提示词。权威标注内容应放在宿主业务存储，由受控服务校验写目标；不添加第二套用户空间或额外文件同步机制。

## E3：地图和来源刷新

- [package.json](../../../../experiments/harness-lab/package.json)：maplibre-gl 固定为 6.4.0。
- [MapCanvas.tsx:17](../../../../experiments/harness-lab/src/web/situation/MapCanvas.tsx)：底图是 raster source；31–35 行通过一个 GeoJSON source 和多个渲染 layer 展示区域、道路、资源，颜色和虚线已有业务含义。
- [SituationView.tsx:57](../../../../experiments/harness-lab/src/web/situation/SituationView.tsx)：15 秒轮询来源态势。
- [MapContext.tsx](../../../../experiments/harness-lab/src/web/situation/MapContext.tsx)：既有地图侧栏与来源引用导航入口。
- [context-routes.ts:18](../../../../experiments/harness-lab/src/server/context-routes.ts)：默认 OSM raster 配置可被已有 map 配置替代。
- 设计影响：保留 MapLibre 和来源刷新；业务图层映射为渲染 source/layer，身份状态由图层面板承担，不复用业务颜色／线型。人工版本引用与来源当前查询分别处理。

## E4：模拟控制的现有边界

- [context-routes.ts:21](../../../../experiments/harness-lab/src/server/context-routes.ts)：模拟控制检查配置、资料读取和后台来源管理权限。
- 同文件 39–53 行：请求转发到配置中的模拟服务；对象变更、动作读取及发送通知有独立入口。
- [.trellis/spec/backend/situation-map.md](../../../spec/backend/situation-map.md) 和 [原地图任务 PRD](../../10-11-situation-map-interaction/prd.md)：记录当前展示、来源引用和模拟能力边界。
- 设计影响：新草稿不通过模拟接口保存。模拟数据继续标明模拟；发布标注不会修改共同来源，也不会调用模拟动作的发送接口。

## E5：Pi 工具与原生输入

- [pi/lab.ts:698](../../../../experiments/harness-lab/src/pi/lab.ts)：资源、来源和任务工具由宿主闭包注入当前身份与上下文；1039–1042 行通过原生 sendCustomMessage 保存实际载入的用户选择。
- [pi/composer-input.ts:10](../../../../experiments/harness-lab/src/pi/composer-input.ts)：当前 custom type 为 berserk.composer-input.v1；46–60 行检查允许字段及历史内容与生成正文一致。
- [contracts/index.ts](../../../../experiments/harness-lab/src/contracts/index.ts)：ComposerSelection 与来源 contextRefs 契约。
- 设计影响：采用普通 defineTool 和原生消息，不建设自有 Agent 运行循环。加入 annotationRefs 时须保留旧版消息解码与正文，不能用新生成器重写旧记录。

## E6：排队与操作身份

- [server/app.ts:146](../../../../experiments/harness-lab/src/server/app.ts)：输入队列只接收 submissionId、expectedRequestId、mode、text。
- 同文件 161–172 行：普通消息支持 contextRefs 等选择，调用 lab.start 时现有作用域参数是 seatId。
- [pi/lab.ts](../../../../experiments/harness-lab/src/pi/lab.ts)：submitInput 和 start 接入现有请求／队列生命周期。
- 设计影响：不把本任务扩大为通用附件队列。带新的标注引用的消息待空闲发送；普通文本排队保留原行为。
- 需要补齐的能力：宿主内部将已认证 userId 与请求上下文绑定，用于标注审计和执行时重新授权；不由模型提供，不从后来切换的浏览器身份推断。

## E7：共享 SQLite 与迁移

- [access/database.ts:7](../../../../experiments/harness-lab/src/access/database.ts)：collaboration.sqlite 是共享业务数据库，开启 foreign_keys 和 FULL synchronous；26 行接受 v1–v8。
- [access/store.ts:30](../../../../experiments/harness-lab/src/access/store.ts)：认证表升级入口；47–54 行识别后台状态，无后台升级终态为 v7。
- [background/store.ts:119](../../../../experiments/harness-lab/src/background/store.ts)：后台迁移入口，161 行终态为 v8。
- [server/app.ts:35](../../../../experiments/harness-lab/src/server/app.ts)：启动时依据已有数据库版本判断后台存储。
- [collaboration/service.ts](../../../../experiments/harness-lab/src/collaboration/service.ts)：同样使用业务数据库。
- 设计影响：不能只在一个 store 追加表后忽略其他 constructor 的版本白名单和升级逻辑。拟新增 v9／v10 是当前基线上的建议；实施前须与届时主线复核。不得降版本号伪装回退。

## E8：既有范围与实施验证入口

- [原地图任务 PRD](../../10-11-situation-map-interaction/prd.md)：人工编辑等未属于原地图接入交付。
- [task-access.md](../../../spec/backend/task-access.md)、[conversation-references.md](../../../spec/backend/conversation-references.md)：继承现有任务权限及历史依据约束；版本号等现状以代码为准，实施时同步有变化的契约。
- [package.json](../../../../experiments/harness-lab/package.json)：已存在 typecheck、lint、test、build、test:e2e；具体执行顺序与新增语义验收见 implement.md。
- 本轮只核对设计与代码，不宣称以上检查已运行。

## E9：绘制依赖的官方依据

查阅的是官方仓库和 MapLibre 文档，未安装新依赖。

- [Terra Draw 官方 MapLibre adapter 包定义](https://github.com/JamesLMilner/terra-draw/blob/main/packages/terra-draw-maplibre-gl-adapter/package.json)：查阅时主分支 peerDependencies 声明 maplibre-gl >=4，terra-draw ^1.0.0，MIT 许可。主分支声明不是已发布版本锁定，也不证明本项目已兼容。
- [Terra Draw 官方 adapters 指南](https://github.com/JamesLMilner/terra-draw/blob/main/guides/3.ADAPTERS.md)：提供 TerraDrawMapLibreGLAdapter 接入方式。
- [MapLibre 官方 Terra Draw 示例](https://maplibre.org/maplibre-gl-js/docs/examples/draw-geometries-with-terra-draw/)：证明相关集成方式已有示例；示例采用第三方工具栏封装，不能等同本项目拟采用的官方底层 adapter。
- 建议：优先直接使用 Terra Draw 与其官方 adapter，复用项目自己的图层、权限和版本界面，不照搬示例工具栏。
- 实施前验证：MapLibre 6.4.0 实际兼容、点线面编辑、文字注记锚点、样式重载、现有 worker、重挂载与清理、只读参考层不进入编辑器。通过后固定实际依赖版本；失败时报告并修订选型。

## 仍未通过运行验证的内容

绘制库兼容性、容量边界、几何校验成本、迁移组合、浏览器编辑交互和真实模型语义均留待实施阶段验证。它们已有验证路径，不作为本次审阅稿已实现或已通过的能力。
