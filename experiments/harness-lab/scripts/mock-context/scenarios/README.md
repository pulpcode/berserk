# 临港仓储火情场景来源

本目录只维护合成业务世界和导演控制。Axon通过真实HTTP读取已提交事实；未来步骤仅由带控制令牌的专用接口返回，不放入普通来源查询或Agent工作目录。默认不开启新场景引擎，旧模拟实例继续使用原协议。

## 数据与时间

- 六站二十四车、六路、八水源、三个地点、六区域：53对象，其中41项resource。
- 初始一般可用17辆、不可用5辆、未知2辆。车辆身份、车型、所属站、状态和位置依据分别保留；V24是08:50的过期位置记录。
- 固定业务日期2026-11-03、初始09:10，按预设事件手动前进；没有自动走时、自动投放或自动模型调用。
- 12个步骤产生13条独立通知。main_story在09:18的待决策节点停止；source_replay可投放全部来源事件，结尾只表示来源回放完成。
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

- `fixtures/scenario-demo/context.example.json`：两来源均显式信任scenarioClock，包含五席读取范围及独立directorSeatId。
- `fixtures/scenario-demo/background.example.json`：登记入站来源和可选核对Profile；**不创建任何执行规则**，保持来源接收而不自动运行模型。
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

四个业务账号使用既有开通方式，席位分别是seat-overall、seat-intelligence、seat-planning、seat-situation；它们不授予controlScenarios。导演需要核对入站回执时，在同样停服条件下对两来源分别授予`view`（读取）权限，不需要通用来源manage：

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

同一Axon登录页选择导演席并认证后进入导演台。创建实例、初始化三个任务、激活、预览和应用事件，再分别发送每条冻结通知并核对回执。需要下一事件时，前一步所有通知须已确认接收。未配置自动规则的通知可以显示“未匹配处理规则”，这不代表接收失败。

新轮开始前暂停旧轮并核对未确认回执；保留旧轮未发送通知须显式确认。新实例使用全新对象/报告/消息ID，旧轮冻结为只读；不会删除已有任务、聊天或文件。重启只恢复快照，不自动发送、推进或调用模型。

导演与业务席并行演示使用不同浏览器配置文件或独立登录会话；同一浏览器配置中的新标签页共用身份，不能靠开标签页隔离账号。

## 工程验证

`tests/mock-scenarios.test.ts`使用真实本机HTTP和SQLite，覆盖完整来源投放、旧消息晚到、原子故障回滚、幂等、暂停、回执、跨轮引用与重启恢复。这些验证不证明真实模型已能正确研判，也不表示方案审批或车辆执行阶段已实现。
