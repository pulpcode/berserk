# 临港仓储火情场景来源

本目录只维护合成业务世界和导演控制。Axon通过真实HTTP读取已提交事实；未来步骤仅由带控制令牌的专用接口返回，不放入普通来源查询或Agent工作目录。默认不开启新场景引擎，旧模拟实例继续使用原协议。

## 数据与时间

- 六站二十四车、六路、八水源、三个地点、六区域：53对象，其中41项resource。
- 初始一般可用17辆、不可用5辆、未知2辆。车辆身份、车型、所属站、状态和位置依据分别保留；V24是08:50的过期位置记录。
- 固定业务日期2026-11-03、初始09:10，按预设事件手动前进；没有自动走时或自动投放。是否自动分析来报由独立的显式处理规则决定。
- 12个步骤产生13条独立通知。main_story 对应“主线演示”，在09:18的待决策节点停止；source_replay 对应“完整事件演示”，可手动投放全部十二步。事件进度与业务任务状态分别核对。
- 版本4只自动创建“城西交通救援”“临港登高演练”两个开场已有任务，表示09:00已开展的业务；“临港三号仓库火情”由总体席从来报的分析结果确认创建，继承原来报所属演示。旧版保存的三任务映射保持严格校验，不补写或重建历史。
- 保存事实与发送通知分开。每步与businessNow、revision、待发通知原子提交；消息的真实接收时间另记。E09在场景09:24送达，观测仍是09:11，不改变R01关闭。

## 地理底稿（场景版本 2）

道路、建筑和街区坐标取自 2026-11-05 读取的上海临港 OpenStreetMap 快照，使用 WGS84 经纬度。选用的坐标随 `geography.ts` 离线提供，运行演示无需请求 OSM API。几何数据 © OpenStreetMap contributors，按 [ODbL](https://www.openstreetmap.org/copyright) 提供。业务名称、设施用途、辖区、车辆、封路事件和时序均由剧本设定。

| 场景对象 | 可复核的地物依据（数字为 OSM way ID） |
| --- | --- |
| R01 中轴桥 | 同顺大道跨水桥段 [376561255 v2](https://www.openstreetmap.org/way/376561255/history/2)，仅取桥面；下方水面 376574534。 |
| R02 东环线 | 从东城站附近经竹柏路、紫娇路、申港大道、塘下公路、同顺大道至江山路口，沿相接的道路节点绕开 R01，与 R03 共用路口节点。依次取 375081291、375068481、375068484、375068467、1316726164、375072407、1107727367、1259058721、1259058722、1107727365、400399070、400399072、413951098、376552505、376564343、1077410144、1258958549 的连续路段。 |
| R03—R06 | 分别取同顺大道桥头至仓储区路段 376561234 v6、工业区道路 1023515002 v2、三三公路 404378397 v8、南侧厂区内部道路 636920868 v2。 |
| S01—S06、L01 | 站点落在六处既有建筑轮廓内，way ID 在坐标旁标明；三号仓库落在园区大型仓库屋顶 [401941361 v1](https://www.openstreetmap.org/way/401941361/history/1)。站点与在站车辆共用来源位置。 |
| L02、L03、H01—H08 | 城西交通救援现场取泥城路车道节点，登高演练场取仓库入口旁硬化空地；八个消火栓按各自街道或园区道路边缘选点。各点使用项目默认 Esri 影像逐处核对。 |
| A01—A06 | 使用道路围合的街区、北部道路与水系围合地块，以及南湾工业用地 445644397 的边界，作为演示辖区。 |

影像核对采用项目默认 Esri World Imagery，与地图组件共用 WGS84 / Web Mercator 定位。路线用于展示道路事件和绕行方向，实际调度需要另行核实可通行性和行驶时间。

首次试用该版本建议使用独立演示数据目录。复用旧目录时，先在旧版本核对通知回执、暂停活动轮，再切换版本，从导演台重新演示。已保存的轮次保留创建时的几何快照。

## 隔离配置

仅在新的演示数据目录使用，下列JSON都只含环境变量名称，没有真实令牌：

- `fixtures/scenario-demo/context.example.json`：两来源均显式信任scenarioClock，包含导演及五个业务席读取范围及独立directorSeatId。
- `fixtures/scenario-demo/background.example.json`：登记双系统入站来源及来报核对Profile；配置文件本身不自动创建规则或重跑历史。
- `fixtures/scenario-demo/rules.example.json`：通过现有信息中心处理规则入口设置的建议值，两条规则均只向总体席投递初析结果。按实际部署的 sourceId 映射填写，不按场景或轮次创建新来源。
- `fixtures/scenario-demo/notifications.example.json`：模拟服务发送到Axon的来源映射；URL仅为Axon origin。

从experiments/harness-lab目录准备环境变量，配置路径必须改为该工作树中的绝对路径。四个令牌各用独立随机值；启动Axon与模拟服务的终端须使用相同配置和令牌：

```sh
export LAB_DATA_DIR=/tmp/axon-scenario-demo
export MOCK_CONTEXT_DATA_DIR=/tmp/axon-scenario-source
export LAB_CONTEXT_CONFIG=/absolute/path/berserk/experiments/harness-lab/fixtures/scenario-demo/context.example.json
export LAB_BACKGROUND_CONFIG=/absolute/path/berserk/experiments/harness-lab/fixtures/scenario-demo/background.example.json
export MOCK_CONTEXT_NOTIFICATION_CONFIG=/absolute/path/berserk/experiments/harness-lab/fixtures/scenario-demo/notifications.example.json
export MOCK_CONTEXT_SCENARIOS_ENABLED=true
export MOCK_CONTEXT_API_TOKEN="$(openssl rand -hex 32)"
export MOCK_CONTEXT_CONTROL_TOKEN="$(openssl rand -hex 32)"
export MOCK_INTEL_SOURCE_TOKEN="$(openssl rand -hex 32)"
export MOCK_SITUATION_SOURCE_TOKEN="$(openssl rand -hex 32)"
```

首次账号开通沿用现有离线命令，服务必须停止。导演账号固定绑定seat-director，独立授予场景控制能力；为了初始化/归档演示任务，另外授予既有公共任务管理能力。后者仍管理全部公共任务元数据，不授予任何席位私有文件/聊天权限。密码由终端交互输入，不使用默认密码：

```sh
npm run access:admin -- account --data-dir /tmp/axon-scenario-demo --username director --name 场景导演 --seat seat-director --seat-name 导演席 --control-scenarios --manage-tasks --service-stopped
```

导演席与业务协作隔离：公共任务管理能力仅用于准备/归档演示任务，不使导演成为业务参与者。导演没有分派、签收、提交、验收或办理对话入口，服务端也拒绝直接调用；业务接收名单与Agent分派目录排除导演，登录页仍可选择导演。任务说明、地图和已授权来源回执可只读核对。

原有四个业务账号使用既有开通方式，席位分别是seat-overall、seat-intelligence、seat-planning、seat-situation；它们不授予controlScenarios。导演需要核对入站回执时，在同样停服条件下对两来源分别授予`view`（读取）权限，不需要通用来源manage：

```sh
npm run background:admin -- grant --data-dir /tmp/axon-scenario-demo --source mock-intel-source --seat seat-director --permission view --service-stopped
npm run background:admin -- grant --data-dir /tmp/axon-scenario-demo --source mock-situation-source --seat seat-director --permission view --service-stopped
```

账号开通生成的认证配置沿用现有启动机制。随后在共享环境配置的两个终端分别运行：

```sh
npm run mock:context
```

```sh
npm start
```

同一Axon登录页选择导演席并认证后进入导演台。创建实例、初始化两个开场已有任务、激活、预览和应用事件，再分别发送每条冻结通知并核对回执。需要下一事件时，前一步所有通知须已确认接收。未配置自动规则的通知可以显示“未匹配处理规则”，这不代表接收失败。

## 业务控制席与指令下达

新增控制席沿用同一登录页和既有业务协作。停服后开通独立账号，密码由终端输入。

```sh
npm run access:admin -- account --data-dir /tmp/axon-scenario-demo --username control --name 业务控制 --seat seat-control --seat-name 控制席 --service-stopped
npm run background:admin -- grant --data-dir /tmp/axon-scenario-demo --source mock-intel-source --seat seat-control --permission view --service-stopped
npm run background:admin -- grant --data-dir /tmp/axon-scenario-demo --source mock-situation-source --seat seat-control --permission view --service-stopped
```

示例 context 配置用 `commands.enabled=true` 和 `commands.seatIds=["seat-control"]` 显式授予指挥接口资格，并把控制席加入双系统读取范围。账号名称本身不授予指挥权。接口固定连接该配置中的 simulation 地址和服务端控制令牌，业务页面及模型不能选择 endpoint、凭据或演示编号。导演席的控场权限独立，不能下达业务指令。

业务约定为“业务席提交文件 → 总体席审核 → 总体席将固定文件副本交给控制席 → 控制席核对并确认下达”。可使用现有工作分派、退回、验收和附件导入。方案审核没有成为指挥接口的前置状态，附件可选。已绑定有效任务的控制席可从任务主页打开下达入口，也可让 Agent 准备指令后在原生确认卡批准。

本轮模拟服务只接收并持久保存指令，返回可查询接收回执；车辆位置、占用与场景时间不因接收而变化。结果不明时查询原编号，不能借新编号盲目重发。车辆行动和动态反馈由后续阶段建设。

## 来报初析与人员建任务

在独立演示目录中，给总体席两来源的 `manage` 权限，用于现有处理规则管理；协作所需的其他业务席按需授予来源 `view`，导演仍只用 `view`。沿用上面的停服授权命令，修改 `--seat` 与 `--permission` 即可，不授予他人私有会话访问权。

服务启动后，由有来源管理权的业务人员在信息中心“处理规则”中按 `rules.example.json` 建立两条普通预处理规则；也可通过既有 `POST /api/information/rules` 接口提交对应对象并添加新 `clientActionId`。已有启用规则时先核对其修订与用途，不覆盖或另建冲突规则；同一来源不要同时启用持续分析。规则只对未来接收生效，重复投放返回原回执，不以此重跑旧消息。

初析送达总体席后，总体席审阅事实和建议，从该结果点击“创建公共任务并关联”。有建议可编辑，没有建议也可自行填写；均须人员确认。来源来报的 eventId 和实际分析的 jobId 用于追溯，宿主继承已核验的轮次，业务席不选择或填写轮次。全局直接创建无来源任务的归属仍属 SIM-TASK-002，本阶段未改变。

总体席按需使用已有任务协作分派事实核实工作，由业务席接收、提交并审核。关联不会扩大来源权限，不能把工作提交当作车辆已出动。信息中心已有“重新预处理”保留原输入、规则与结果，新增分析版本；同一来报已有创建任务时应查看原任务，不再次创建。

新轮开始前暂停旧轮并核对未确认回执；保留旧轮未发送通知须显式确认。新实例使用全新对象/报告/消息ID，旧轮冻结为只读；不会删除已有任务、聊天或文件。重启只恢复快照，不自动发送、推进或调用模型。

导演与业务席并行演示使用不同浏览器配置文件或独立登录会话；同一浏览器配置中的新标签页共用身份，不能靠开标签页隔离账号。

## 工程验证

`tests/mock-scenarios.test.ts`使用真实本机HTTP和SQLite，覆盖完整来源投放、旧消息晚到、原子故障回滚、幂等、暂停、回执、跨轮引用与重启恢复。这些验证不证明真实模型已能正确研判，也不表示方案审批或车辆执行阶段已实现。

`tests/scenario-business-flow.test.ts`覆盖真实来源到原生 Pi 的确定性业务链、人员建任务、重处理去重、固定文件协作、人工任务归档及中断重演。`tests/probe-scenario-budget.test.ts`使用真实 SDK 和替代 fetch 验证限额及完整驱动，不访问真实模型。

真实模型探针默认仅准备独立数据与规则，必须指定不存在的新目录：

```sh
LLM_CONTEXT_WINDOW=131072 LLM_MAX_OUTPUT_TOKENS=8192 npm run probe:scenario-business -- --prepare-only --output /tmp/axon-business-prepare-new
```

只有显式 `--live` 并提供全部有限预算，才会投放来报并调用当前配置模型。例如，以下费率须由操作者按实际模型核验；不能把示例单价沿用到其他模型。`--scripted-handoff` 表示脚本通过正式 API 执行业务确认，不是 Agent 自主操作或独立人工验收：

```sh
LLM_CONTEXT_WINDOW=131072 LLM_MAX_OUTPUT_TOKENS=8192 npm run probe:scenario-business -- --live --scripted-handoff --output /tmp/axon-business-live-new --max-api-requests 80 --max-input-tokens 2000000 --max-output-tokens 131072 --provider-input-limit-tokens 1048576 --max-seconds 1200 --max-cost-cny 10 --input-cny-per-million 2 --output-cny-per-million 8
```

密钥沿用已有环境配置，不进入输出。探针不复用线上数据库，不覆盖已有证据；预算按已核验提供方输入上界和实际输出上限预留，未知 usage、失败或额度不足即停止，不自动重跑。`protocolCompleted` 与模型判断正确分别审阅，保留原生历史、处理结果和独立语义核查记录。
