# 临港仓储火情场景来源

本目录只维护合成业务世界和导演控制。Axon通过真实HTTP读取已提交事实；未来步骤仅由带控制令牌的专用接口返回，不放入普通来源查询或Agent工作目录。默认不开启新场景引擎，旧模拟实例继续使用原协议。

## 数据与时间

- 六站二十四车、六路、八水源、三个地点、六区域：53对象，其中41项resource。
- 初始一般可用17辆、不可用5辆、未知2辆。车辆身份、车型、所属站、状态和位置依据分别保留；V24是08:50的过期位置记录。
- 固定业务日期2026-11-03、初始09:10，按预设事件手动前进；没有自动走时、自动投放或自动模型调用。
- 12个步骤产生13条独立通知。main_story在09:18的待决策节点停止；source_replay可投放全部来源事件，结尾只表示来源回放完成。
- 保存事实与发送通知分开。每步与businessNow、revision、待发通知原子提交；消息的真实接收时间另记。E09在场景09:24送达，观测仍是09:11，不改变R01关闭。
- 点线面均为临港周边底图范围中的**合成业务覆盖层**，坐标不表示真实消防站、车辆、道路或路况。底图署名沿用现有地图来源；不据此声称真实路网、行驶距离或ETA已校验。

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
