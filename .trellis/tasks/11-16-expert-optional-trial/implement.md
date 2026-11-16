# Implementation

- [x] 固定提交创建独立 worktree/分支，记录用户方案及开工批准。
- [x] 读取 R1/R2/R3/R3A、前端和跨层指南；准备真实 manifests。
- [x] 按 Trellis implement agent 协议实现五个源文件和对应回归测试，保持最小改动。
- [x] 同步 4 份现行契约文档。
- [x] 定向服务/API/权限/试用/兼容与桌面 e2e 验证（1060/1440，独立本地端口）。
- [x] typecheck、lint/boundaries、build 和单测；独立 Trellis check agent 审查。
- [x] 汇总证据并审阅 diff，准备一次性中文提交计划。
- [x] 用户明确回复“提交”，批准本次中文提交计划；按清单提交本地实施成果。
- [ ] 后续产品验收及部署由用户另行决定；本轮不归档、不部署、不推送。

## Commands
在 experiments/harness-lab 执行 npm run typecheck、npm run lint、npm run build、npm test；定向 vitest capability-management/capability-trial-management-sync/skills 和 playwright capability-management.spec.ts。
共享相同版本 node_modules 仅作为只读依赖目录链接；不得更改其他工作树源文件或执行 npm install 修改共享目录。测试输出写本任务或本工作树下。

## Review / rollback
只检查本工作树，原 R3A dirty tree 完全不动。回退本地实现可切回基线；没有数据或线上变更。用户产品验收与自动测试分开报告，不因测试通过标记 R3A 已验收。
