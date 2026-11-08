# 实施安排（已批准）

1. 按已确认方向新增独立业务控制席，复用登录与协作并配置独立下达授权；整体方案及最小外部接收范围经审阅批准后再进入实施。
2. 按 task-handoff 契约实际验证固定附件导入、转交和审核，复用可用路径，仅修补确认的阻断。
3. 增加最小指令及回执契约，外部模拟服务负责接收、持久回执和去重；Axon 保存发送与核对记录，沿用来源凭据管理。两端按 HTTP 分别提交，不假设跨系统事务。
4. 接通控制席页面和受权限约束的 Agent 工具，复用原生确认。提交前后复核任务与演示归属、身份和指令内容，避免确认期间切轮后误发。
5. 真实 HTTP、持久化、权限、确认、去重、未知结果、取消及换轮回归，再做实际席位桌面验证。模型生成内容与程序结果分别评审。

## 影响位置

路径相对 experiments/harness-lab。

- src/contracts/access.ts、src/server/seat-scope.ts 及既有账户配置入口，用于明确指挥权限。
- src/contracts/collaboration.ts、src/collaboration/service.ts、src/collaboration/files.ts、src/server/collaboration-routes.ts，用于复用交接与固定文件。
- src/pi/collaboration-tools.ts 及现有 Pi 确认接入，用于复用工具人员确认。
- scripts/mock-context/server.ts 及 scenarios 持久化，用于最小外部指令接收。
- src/web/Workbench.tsx、WorkInbox.tsx 及任务入口，用于必要的下达展示。

## 验证与兼容

批准后按影响范围运行单元／HTTP 测试及桌面套件，并运行 npm run typecheck、npm run lint、npm run build。新增持久化时验证旧数据迁移和备份重开；先固定接口再补必要实现上下文。保留既有审核、工作状态、原生历史及旧演示资料。

本轮已获实施授权。完成工程与实际席位验证后提交结果供审阅，部署另按授权执行。
