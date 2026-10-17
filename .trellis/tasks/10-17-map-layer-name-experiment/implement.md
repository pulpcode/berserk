# 实施清单

- [x] 保存本轮 Pro/Flash 对照：ae7236c，未 push。
- [x] 用户授权最小实验；实现前冻结边界、数量与判断口径。
- [x] 实现显式 layerNames 及 service/Pi/projection 定向测试；不修改其它产品功能。
- [x] 复用原生测评观测器，冻结新四类 fixtures 与评分规则；准备 A 基线归档。
- [x] typecheck、lint、相关标注/hook/权限测试；prepare-only 无外发验证。
- [x] A/B 各 14 条 live；保留原始 provider 输入/响应、工具结果、状态及未完成样本。
- [x] 分开审核实际操作和可见回答，记录拒绝、恢复、调用数/耗时及采用条件。
- [x] 复核/报告；明确候选保留或回退，不部署。

产品实现由 trellis-implement 执行，主代理负责本任务目录测评脚本与报告；彼此不覆盖文件。报告保留证据索引和未测项。

完成：名称误用A5→B0；严格A10/14，B13确定通过+1措辞歧义。候选保留，随本次提交保存；未部署。独立复核见review-independent.md，最终口径见results.md。
