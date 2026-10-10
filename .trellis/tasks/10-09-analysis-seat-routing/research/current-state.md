# 现状核对与设计依据

本文件保留实施前核对记录；本期实现见 [验证记录](validation.md)。

日期：2026-10-09。代码基线：`2f25840`。仅本地只读核对产品代码，未修改线上配置。

表内路径相对 experiments/harness-lab。

| 当前事实 | 代码依据 | 设计影响 |
| --- | --- | --- |
| 规则持有接收者，Profile 不持有 | src/contracts/background.ts | recipientSeatIds 保持固定接收者，不改成候选或兜底 |
| 来源限定 Profile 和席位范围 | src/background/config.ts | 补充候选仍受服务端授权限制 |
| 接入保存规则／Profile 快照，重处理沿旧快照 | src/background/service.ts | 增加职责与审批席位快照，不静默改写旧处理条件 |
| 核验成功结束后生成固定投递 | src/background/store.ts 的 finishJob | 保持固定路径，在同一结束边界创建待批准事项；不增加原消息先送达或失败自动投递 |
| 投递检查固定名单，有独立状态及重试 | src/background/store.ts 的 validateIntegrity；service.ts 的 deliver | 扩充完整性依据，补充收件必须来自批准决定；复用发送链路 |
| 席位目录仅 id／name；已有席位能力及账号脚本 | src/access/store.ts、scripts/access-admin.ts | 增加统一职责和维护命令，不按来源重复配置职责，不需要完整组织编辑器 |
| 来源授权与资料范围分别检查 | src/background/service.ts、src/background/config.ts | 总体席审批资格需显式 ID、来源管理和结果读取权限，不由管理员名称推断 |
| 已有任务判断工具及宿主回调 | src/pi/task-information-tools.ts、src/background/executor.ts | 补充建议沿用公开 Pi 工具机制；任务关联与收件建议分别表达 |
| Pi prompt 可运行多轮模型／工具循环 | src/pi/lab.ts；安装版 pi-agent-core 的 agent-loop.js | 同一作业不等于一次模型调用，无需先拆两个分析 Agent |
| 任务关联不等于信息读取权限 | src/background/task-links.ts | 关联多个任务不会自动让所有席位读取结果 |
| 已有信息中心和规则页面 | src/web/InformationRules.tsx 及信息中心组件 | 扩展现有导航、列表与详情，不另建门户 |
| 收件投影目前删除 ruleSnapshot 后返回 job | src/background/service.ts 的收件投影 | 新增建议／审批元数据须显式裁剪，普通收件不返回管理内容 |

## 设计依据

- 固定投递保留常规接收渠道；Agent 提议扩大范围，总体席承担批准责任。这是本次用户讨论确定的方向，不声称 Pi 自带业务投递审批。
- 总体席、情报席、筹划席、态势席是初步职责，不等于外部系统分类，也不等于常驻 Agent。
- 持久审批的具体需求是：分析已结束、总体席可能离线，稍后或重启后仍能处理同一建议。因此保存一项业务审批，不维持后台执行等待。
- 不增加完整持久化执行引擎、通用流程模板、审批转交或多级授权体系。
- 先验证同一 Pi 作业内的分析及建议；用户已要求不做架构基线对比，效果出现问题后再比较。

## 界面依据

沿用现有 Axon 导航和组件，保持可见标签、字段错误、提交反馈及草稿保留。固定投递、补充审批、送达结果分别展示，避免“作业结束却似乎还在执行”或“批准等于收到”的误解。

本轮未执行模型验证，不预写选择正确率或验收通过结论。
