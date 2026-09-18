# Axon

产品名称为 Axon；仓库名、目录及内部技术标识继续沿用 `berserk`。

面向消防救援等垂直场景的 Agent 作业与协同平台。以多轮对话为主要交互方式，依托具备 Tool、Memory、Skill、Subagent、上下文管理与压缩能力的统一 Harness，连接业务系统，完成信息处理、任务分派、协作与成果交付。MVP 以消防救援为样板，综合特情、态势等多源信息形成可追溯的简报与筹划方案，完成审核和归档。

Memory 在本项目中明确指 Agent 指令文件（如 AGENTS.md、CLAUDE.md），保存约定、偏好与工作规则，按工作区加载和受控编辑；不包含结构化长期记忆数据库、自动提取或召回服务。

首步使用 Pi 验证多轮对话与最小工具接入，Pi 调用集中在独立模块，历史先复用原生机制。后续补齐平台接口、工作记录及可替换边界，保留未来完全自研并移除 Pi 依赖的路径；首轮使用不代表长期选型已通过。

当前 W01-1 已完成实现与 C01～C06 验收，应用位于 [experiments/harness-lab](experiments/harness-lab/README.md)，本地检查与真实模型验收结果见 [验证记录](.trellis/tasks/09-16-w01-harness-validation/research/validation-results.md)。规划内容根据 [项目讨论](https://chatgpt.com/share/6aa9fb5b-1938-83e8-be06-54d1be680784) 及后续调整更新至 v0.8：先交付 Pi 多轮对话，再完善 Harness 能力、Web 文件与脚本作业、运行管理与作业框架，随后开展样板业务和信息模拟服务。完整 Run、确认恢复、平台快照和导出检查不作为第一步前置条件。业务工作分派、子 Agent 委派与外部调度分别管理，调度实现继续后延。

- [W01-4：子 Agent 委派与协作](.trellis/tasks/09-17-w01-4-subagent/review.md)（S2c：优先复用 Pi，基础多角色配置与单层只读委派；已实现，验收见阶段记录）
- [W01-5：Web 通用文件作业](.trellis/tasks/09-17-w01-5-artifact-versions/review.md)（S3a：任务 × 席位工作区、普通文件上传、Pi 文件工具、最小执行沙盒与下载交付；已实现并通过 E01～E15 组合验收）
- [W01-3：上下文管理与压缩](.trellis/tasks/09-17-w01-3-context-compaction/review.md)（S2b：Pi 默认压缩，已实现并通过 B01～B13 组合验收）
- [已完成 W01-2：审阅与验收](.trellis/tasks/archive/2026-09/09-16-w01-2-workspace-memory/review.md)（工作区、文件式 Memory、Skill；已实现并通过 A01～A12 组合验收）
- [MVP 文档入口](docs/mvp/README.md)
- [MVP 范围与需求](docs/mvp/prd.md)
- [设计边界](docs/mvp/design.md)
- [阶段工作与依赖](docs/mvp/implement.md)
- [验收场景](docs/mvp/acceptance.md)
- [讨论依据与待决策项](docs/mvp/decisions.md)
- [首个任务 W01：具体设计](.trellis/tasks/09-16-w01-harness-validation/design.md) · [需求与验收](.trellis/tasks/09-16-w01-harness-validation/prd.md) · [实施计划](.trellis/tasks/09-16-w01-harness-validation/implement.md)
- [W01 开工前审阅清单](.trellis/tasks/09-16-w01-harness-validation/review.md)
- [W01 后续设计：运行管理与可替换边界](.trellis/tasks/09-16-w01-harness-validation/design-later.md)

开发流程见 [.trellis/workflow.md](.trellis/workflow.md)。
