# 实施顺序：多源上下文接入与自动综合研判

状态：实现完成，待用户验收。代码路径均相对 `experiments/harness-lab/`，实现与验证记录见 [验证记录](research/validation-results.md)。

| 顺序 | 交付与主要落点 | 完成条件 |
| --- | --- | --- |
| P1 任务上下文 | `src/contracts/access.ts`、`src/access/store.ts`、`src/server/task-routes.ts`：可选 context、完整校验、创建摘要与 revision、服务任务读取投影 | MX01～MX03、MX17 相关用例；无新表或全量历史迁移 |
| P2 查询与模拟服务 | 新 `src/contracts/context.ts`、`src/context/`、`scripts/mock-context/`：按 [交互契约](integration-contract.md) 实现配置、主体检查、HTTP 适配、记录依据、分页、取消；独立双源 fixture 和触发脚本 | MX04、MX05、MX12、MX19；真实 HTTP 联调，应用不直接读 fixture，外部数据无任务答案 |
| P3 Pi 与后台接入 | 新 `src/pi/context-tools.ts`；`pi/lab.ts`、`pi/background-runner.ts`、`background/config.ts`、`background/service.ts`、`background/store.ts`、相关 contracts 与 server 配线 | 查询注册给前后台主 Agent；Profile 范围快照、领取／查询／投递／读取检查；MX06、MX10～MX13、MX15 |
| P4 现有页面增量 | `web/Tasks.tsx`、`InformationRules.tsx`、`InformationCenter.tsx`、`InformationCenter.tsx` 中的 InformationDrawer、`Inbox.tsx`、共享展示／API：任务字段、Profile 查询说明、正文与查询依据、接续文案 | MX14～MX16；桌面侧栏及会话草稿不受影响，无新增影响状态机 |
| P5 场景与回归 | 合成数据初始化／推进脚本、只读查询及权限测试、桌面 E2E、真实模型验证记录、运行说明 | MX01～MX20 逐项有证据；不足明确记录，不以单个假模型案例代替真实查询分析 |

## 关键实施约束

- 查询服务独立于队列启停，普通对话也能使用。服务身份与席位身份共用业务查询实现，但分别校验。
- 任务字段只扩展现有 JSON；作业范围随原 Profile 快照保存。若实施发现必须新增表或更换持久化方案，先说明实际缺口再调整设计。
- 资料范围配置在服务启动时加载，按主体和作业 Profile 快照校验访问；重处理保留原配置依据。动态撤权、权限热更新及存量资料治理不进入本期实施。
- 结果、工具、文件及导入入口复用同一个范围检查，不能只覆盖收件页；不把后台整个 collaborationTools 打开以获得任务读取。
- 原生工具结果保存实际资料和引用。页面通过受控后端投影读取依据，不解析模型 Markdown 生成业务关系。
- 沿用现有取消、压缩、运行状态、模型并发、后台 ask 拒绝及交接确认机制；不顺带重构它们。
- 模拟服务、初始化脚本只操作指定隔离数据根。任务经现有 API 创建，真实 UUID 写入测试映射；fixture 可重置，线上数据不自动清空。
- 先验证交互契约的真实 HTTP 请求／响应，再接 Pi；测试答案和控制脚本不挂载到 Agent 工作区，来源通知与查询均不预置任务影响结论。
- 更新规范应在实现验证后进行，不把本期待审设计提前写成已实现的工程规范。

## 验证与发布准备

在 `experiments/harness-lab` 执行现有检查：`npm run typecheck`、`npm run lint`、`npm test`、`npm run build`；运行覆盖变更的桌面 `npm run test:e2e`。新增的查询、任务与后台测试优先覆盖数据流和权限，不仅复述工具定义。

真实模型脚本验证 E1、独立 E2、缺失与失败资料，以及 S7 互换任务条件后的表现，结果记录到本任务的验证文档。保留 HTTP 及原生工具依据；沿用已有模型接入，若配置或环境不足，说明具体缺项。模拟服务本身不调用模型。

开发验证完成后，先提交中文 Git 记录，再按用户当时的部署指令更新现有单实例。发布包纳入新运行配置示例及模拟服务启动说明，密钥继续由环境提供；不提前创建第二套线上实例。

需要审阅的范围与通过条件分别见 [review.md](review.md)、[acceptance.md](acceptance.md)。
