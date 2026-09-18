# W01-6 实施计划

状态：**已实现并通过开发验收**。实际验证见 [验收记录](research/validation-results.md)。

## 实施顺序

| 步骤 | 工作与退出条件 |
| --- | --- |
| P1 接入探针 | 在 Pi 0.85.1 验证固定 extensionFactories、显式工具启用、异步 beforeToolCall 的组合顺序、拒绝和停止；验证 tree-sitter Node 绑定与 Bash grammar 在现用 Node、macOS／Ubuntu 的兼容性并锁定依赖；不修改内核 |
| P2 共用交互机制 | 建立带 kind 的契约、请求内等待、严格历史解析、响应 API 与 SSE；验证首次响应、取消竞争、保存失败、刷新和重启；不引入数据库或持久化 Run |
| P3 Web AskUser | 固定扩展注册 ask_user，接入问题卡片、答案／跳过、草稿及导航待回答；用真实 Pi 和确定性模型验证回答后续作、上下文不重复；只在主 Agent 启用 |
| P4 操作确认与命令规则 | 实现服务端 allow／ask／deny、完整命令分析、确认卡片与导航；接入默认关闭的 confirmation_demo；按样例先验证策略，再接现有 Docker 命令入口，保持沙盒限制 |
| P5 集成验收 | 完成 F01～F18、必要既有回归和真实模型／容器验收；更新实际规范与结果记录，交用户浏览器验收 |

P1 不通过时先说明技术差异并调整方案；不能静默改成自研循环、脆弱的命令拆分或扩大为持久化 Run。解析器只提供语法树，Axon 的规则与未知语法分支仍须独立测试。

## 实际改动位置

路径相对 `experiments/harness-lab/`：

- `src/pi/`：固定 AskUser 扩展与网页桥接、操作拦截、历史记录；调整 `lab.ts` 原钩子的组合。Pi 类型继续限制在该边界。
- `src/execution/`：纯命令策略模块及解析器适配，不改变 Docker 权限或文件挂载。
- `src/contracts/`、`src/server/`：交互契约、响应路由、明确错误和演示开关。工作区／席位由会话确定，不接受客户端自定授权范围。
- `src/web/`：两类卡片、`useChat`、API、草稿和导航；不增加审批中心或权限设置页。
- `tests/`、`scripts/`：策略样例、Pi 集成、浏览器和真实验收探针；已新增 `probe:hitl`。
- `package.json`、锁文件：仅新增经 P1 验证的解析器依赖。

复用现有 AbortController、请求活动标记、SSE、GET 快照、Pi JSONL 和持久化失败守卫。

## 验证命令

```bash
npm --prefix experiments/harness-lab run typecheck
npm --prefix experiments/harness-lab run lint
npm --prefix experiments/harness-lab test
npm --prefix experiments/harness-lab run test:e2e
npm --prefix experiments/harness-lab run build
git diff --check
```

已使用隔离数据目录与测试文件，完成 F17 真实模型和 Docker 验收。沿用现有 DeepSeek 与 Ubuntu 配置；实际验收在独立 Ubuntu 目录和测试数据中完成，原服务数据保持独立。

## 重点检查与回退

- 问题答案与操作授权必须分开校验；不因回答“同意”生成授权，也不重复注入工具结果。
- 停止不能卡在等待 Promise；批准必须在实际执行前，持久化或规则故障不得放行。
- 命令规则覆盖实际参数和完整命令链；未知情况不能按安全前缀放行，也不宣称能审计任意脚本内容。
- 已批准、已执行和请求终态分别记录；保留原工具钩子、子 Agent 只读范围、AGENTS.md、压缩及历史校验。
- 旧会话无需迁移；部署前备份数据。回退代码保留新交互记录，旧版本使用备份或隔离目录，不能删除记录以绕过校验。
- 演示开关关闭仅移除验证工具，不关闭 bash 规则或历史展示。生产后新增交互记录的读取能力不能通过关开关消失。

所有提交信息以中文为主体。

开发验收（2026-09-18）：307 项单元／集成测试、48 项全量浏览器测试及后续 8 项、5 项针对性回归通过；类型、Lint、构建通过。真实模型与 Docker 的提问、批准、拒绝、停止四个场景通过，详细证据见验收记录。
