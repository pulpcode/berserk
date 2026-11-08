# 第二轮实施安排（v0.2 已授权）

1. 按 design.md 4.1/4.2 固定确定性动作、单位、路径连接、行程计算和显示边界。冻结新场景定义、执行协议及支持的路径、耗时和条件。明确接收回执与执行状态分别兼容，旧接收指令不自动执行。
2. 在外部模拟服务统一事务，串接接收、原子占用、逐车进展、来源对象修订和待发通知。验证同车并发、整批拒绝及存量数据升级。
3. 将行动节点加入手动时间推进与预览，按时间顺序应用道路变化和车辆移动，处理旧报告晚到及预设整对象覆盖冲突。
4. 在外部接口增加执行查询、调整和取消；Axon通过受控适配复用授权、幂等和原生确认，保留原指令及新操作引用。
5. 接回态势系统通知、现有初析和工作交接，指令详情及地图消费同一来源事实。只补本轮必要界面。
6. 冻结候选后进行真实HTTP／SQLite／原生确认回归、桌面完整主线与故障路径，再明确真实模型验证批次，结果供用户审阅。

## 代码落点

以下路径相对 experiments/harness-lab。

- scripts/mock-context/scenarios/{commands,store,control,data,query}.ts，及geography.ts中可复用的道路几何，用于外部执行和时间节点。
- src/contracts/commands.ts、src/commands/{service,validation}.ts、src/server/command-routes.ts、src/pi/command-tools.ts，用于版本契约、查询和人员确认的调整操作。
- src/contracts/context.ts、src/context及后台接入契约，用于来源事实、通知和权限核验。复用既有记录，不另建通用事件平台。
- src/web/TaskCommands.tsx、ScenarioDirector相关控制组件及态势地图，用于最小呈现。

## 检查

覆盖协议兼容、迁移重开、占用竞争、响应不明、通知重试、取消、调整、关轮和恢复。保留文件软流程，核对没有增加审核前置门禁。运行对应单元、HTTP和桌面测试，以及 npm run typecheck、npm run lint、npm run build。具体测试目录和精确接口在实施前按获批契约补齐上下文。

按用户授权实施并完成验证，线上发布另按明确授权执行。
