# 第一里程碑设计依据与文档复核

日期：2026-11-04。用户明确要求“给出设计方案文件，待我审阅，先不实施”。本轮仅研究代码与编写任务设计文件，没有运行产品实现、服务、模型或部署。

## 代码依据

以下代码路径相对experiments/harness-lab，spec路径相对仓库根；引用基线为278d82f。

| 位置 | 已核实现状 | 设计处理 |
| --- | --- | --- |
| src/contracts/context.ts:34 | 来源对象限制road/resource/area，资源信息可选 | 首期维持三类；站点/水源/事件地点归resource细类 |
| src/contracts/task-resources.ts:24 | 资源粗类别与可用/位置依据已有，没有细分车型 | 提议可选vehicle字段，沿同一资源字段端到端保留 |
| src/context/task-resources.ts:15、25、27 | 带conditions的事实不直接当有效；actual位置才用于当前几何 | 确定不可用和条件未知分别表达；V24最后位置不冒充当前定位 |
| src/context/task-resources.ts:54、55 | 资源statisticsScope.at等于真实createdAt | 提议受配置限制的snapshotClock及场景业务时间 |
| src/contracts/resource-results.ts:77 | 固定结果校验强制query的at=createdAt | 明确需要v4兼容扩展，不能只改来源时间 |
| src/context/config.ts:104 | 来源配置在启动时加载 | 固定系统/凭证，场景实例由来源内部管理，不通过页面热改配置 |
| src/server/context-routes.ts:20、38 | 代理已有来源管理/读取校验，控制令牌不发给浏览器 | 新导演台入口沿用同一身份与范围检查 |
| scripts/mock-context/control-api.ts:69、92 | 操作ID、修订、冻结通知及独立发送已存在 | 步骤批量事实沿相同语义扩展，发送逐条核对 |
| scripts/mock-context/server.ts:65 | 持久地图实例拒绝原地reset | 重演新建实例，旧轮冻结并保留固定引用 |
| scripts/mock-context/persistence.ts:9 | 旧单实例快照在simulation_snapshot表 | 新场景存储独立版本，不重写旧实例 |
| src/web/situation/map-data.ts:39 | 来源状态显示主要是道路/可用车辆汇总 | 需显示单车状态、车型、依据时间和未知 |
| src/web/situation/MapCanvas.tsx:51、98 | 来源点目前使用普通circle，专业标绘由另一运行时渲染 | 本期仅复用目录做明确车型到来源图形的映射，缺素材有中性退化 |

## 交互依据

使用ui-ux-pro-max完整说明及两次本地检索：

- ux查询“multi-step progress error recovery”：命中Progress Indicators、Error Recovery、Error Messages，适用于多步导演操作。
- react查询“loading status async actions”：采纳显式异步错误反馈；不据通用推荐重写已有useApi或状态管理。

这些指导促成：单步预览、应用与发送分别反馈、原回执核对入口、暂停时禁用动作、键盘可达及状态文字。保持现有桌面token与Lucide图标，未增加手机端设计或新的视觉体系。

## 设计审阅边界

首期主故事停止点、来源回放模式、业务时钟/v4、重演与地图选址是待审阅提案，不视为用户已批准。具体地图位置尚未选择，未声称坐标/真实路网已核验。

对照总体计划补齐了M1不能执行P3/P4的边界、十二次投放至少十三条来源消息、任务初始化与源激活的部分失败，以及暂停/未发送记录的恢复语义。设计文件中的所有新接口均未实现。

## 2026-11-04现状与差距补充

按用户要求，将四项能力的现状整理入milestone-1-design.md，并从总体design.md链接到同一清单，仍为待审阅方案。分支HEAD为278d82f；本次复核main为51e04dc，相关experiments/harness-lab/src、scripts/mock-context及.trellis/spec/backend与HEAD无差异。

- TaskHome.tsx:10、29保留任务目标/说明、assessment插槽和新建对话；ContinuousAssessments.tsx:59提供当前研判，因此任务综合展示应扩展现有入口。
- contracts/collaboration.ts:4—18记录工作办理与交接，不包含车辆接令/出发/到场业务状态。聊天或文件方案与审核已有，结构化候选方案和调派决定尚缺。
- contracts/task-resources.ts:25—35已有单体、可用性与位置声明；MapCanvas.tsx:50—52会按对象数据刷新几何，但Simulation.tsx:18—20只更新对象属性/报告，没有坐标更新或逐车移动驱动。
- 图形刷新、工具执行成功、工作验收与车辆实际到场分别表达，不能据前几项宣称已有后者。P1/P2准备数据与展示，P3补方案，P4补车辆执行，P5汇集页面。

## 同轮时间问题只读核对

- pi/lab.ts:815—824使用自定义systemPrompt，未专门注入“当前真实日期/时间”。本地安装的Pi 0.85.1在dist/core/system-prompt.js的customPrompt分支也没有自动追加当前时间；工作区约定或用户资料仍可能自行携带日期。
- context/service.ts:70返回真实queriedAt，context/task-resources.ts:54—55返回真实createdAt并以其作为statisticsScope.at；这些工具结果会让Agent接触真实时间。
- background/continuous-service.ts:192将occurredAt与真实receivedAt一起放入研判输入。pi/context-tools.ts:45已解释查询时间、来源快照与业务时间的区别，但尚无本方案拟增加的场景当前时刻。
- 启用文件执行环境时，pi/file-tools.ts:36—46提供bash，现有命令策略允许普通date查询，因此前台Agent可能读取容器系统时间。持续研判使用只读工具，不获得bash；它仍能从上述输入看到真实时间。本轮未启动容器或模型验证。
- 混淆风险既包括模型误解，也包括现有资源服务按真实时间计算有效期。snapshotClock及v4时间口径仍为提案，不能声称当前已解决模拟时间与真实时间的混用。

## 本期虚拟时间方案完善（2026-11-04）

用户明确要求确认虚拟时间是否在本期建设，并在纳入本期时修改完善方案。本轮将其明确列入M1（P0—P2），补充责任、单服务共用时钟、查询一致性、业务状态边界、模型可见输入及验收；授权仍为文档修改，不是产品实现。

- 实例时钟复用既有模拟服务和快照持久化，不新增独立时间服务、Agent时钟工具或全局Date替换。应用步骤时与事实/待发通知一并提交；控制台仅提交操作。
- context/task-resources.ts:15、20、25—27实际按传入时点检查来源声明的关系、可用性及位置；不是从维修原文自动推导综合出动资格。现有query在:54—55使用真实createdAt，本期需将场景查询的实际计算时点改为受控businessNow。
- contracts/resource-results.ts:77强制原query的statisticsScope.at等于createdAt，:90—99生成模型可见投影；因此v4需要同时调整校验、投影、固定历史与消费者，不能只改变结果字段或页面文案。
- pi/context-tools.ts的execute把查询结果JSON写入模型可见content；pi/task-resource-results.ts:11对资源投影做同样处理。场景时间与真实时间的说明需进入实际正文，不能只存在于details。
- 现有mock在初始化使用预设asOf，control更新时在server.ts:192—193改用真实时间；新场景接口须从同一实例快照读取一致的asOf和snapshotClock，旧场景保持原协议。
- 未来多管理域服务的时间同步继续后延SIM-DOMAIN-001；本期只验证同进程intel/situation、HTTP查询与资源计算共用时点。M1工程验证使用确定性替身，真实模型解释随P3/P6核验。

文档关联：PRD增加R13/A12，总体设计补时间责任与资源工具边界，建设计划明确P0/P1/P2分工，M1增加A17—A20验收。运行模式与其他尚未批准的提案未因本次文档完善而获得实施授权。

## 专用导演席与独立授权设计（2026-11-04）

用户已确认专用导演席单独授予场景控制权限，四个业务席位不开放导演台，并明确只补方案、先不实施。本轮在M1方案v0.5第1/7/10节固化登录、入口及授权，增加A21—A24工程验收，同步PRD的R14/A13、总体设计与P2计划；未创建账号或执行授权。

- web/Seats.tsx:63—90复用席位选择加密码认证；server/auth.ts:66—76按账号认证并建立同一登录会话。仅增加入口或前端席位名称判断不足以授权，需服务端核验专用导演身份和独立能力。
- contracts/access.ts:1—7及access/store.ts:72—95已有席位能力的Identity投影和持久化，没有controlScenarios；新增能力必须默认false并迁移兼容，不能写成当前已有字段。
- server/context-routes.ts:20—30以全部模拟入站来源manage及对应资料可读判断旧simulationEnabled。该判定会使具备来源管理权的业务席具备旧模拟能力，不能直接复用为新导演授权；新场景需独立鉴权并封闭旧状态/编辑/action路径旁路。
- server/auth.ts:33—34使用同源axon.session Cookie；:51—58逐次读取当前身份并检测viewId，web/Seats.tsx:53—76广播身份变化。新标签页共享同一浏览器配置的登录；跨导演/业务账号并行使用独立会话，不能把“另开标签页”宣称为多账号隔离。
- access/store.ts:139、155已有公共任务管理能力检查，范围为全部公共任务元数据。导演任务初始化需另配该既有授权，不伪造actor或声称场景能力自动附带；来源读取另行授权，通用来源manage和业务审批权均不随场景能力赋予。

本次只对规划文件做结构、链接、权限矩阵及状态校验。四业务席的拒绝、撤权、旧接口隔离和并行登录仍是待实施验收，不声称运行系统已有该隔离。
