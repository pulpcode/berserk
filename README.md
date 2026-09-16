# Berserk

面向消防救援等垂直场景的 Agent 作业与协同平台。以多轮对话为主要交互方式，依托具备 Tool、Memory、Skill、Subagent、上下文管理与压缩能力的统一 Harness，连接业务系统，完成信息处理、任务分派、协作与成果交付。MVP 以消防救援为样板，综合特情、态势等多源信息形成可追溯的简报与筹划方案，完成审核和归档。

当前处于 MVP 规划阶段，尚无业务实现。规划内容根据 [项目讨论](https://chatgpt.com/share/6aa9fb5b-1938-83e8-be06-54d1be680784) 及后续调整更新至 v0.4：先实现上述 Harness 基础能力与作业框架，再开展样板业务和信息模拟服务。成熟 Harness 的能力与对话体验是建设目标；具体内核、模型效果和技术栈仍需验证。业务工作分派、子 Agent 委派与外部调度分别管理，调度实现继续后延。

- [MVP 文档入口](docs/mvp/README.md)
- [MVP 范围与需求](docs/mvp/prd.md)
- [设计边界](docs/mvp/design.md)
- [阶段工作与依赖](docs/mvp/implement.md)
- [验收场景](docs/mvp/acceptance.md)
- [讨论依据与待决策项](docs/mvp/decisions.md)

开发流程见 [.trellis/workflow.md](.trellis/workflow.md)。
