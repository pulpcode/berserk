# 设计依据与核对范围

日期：2026-09-23。本目录记录设计依据，不代表已完成实现或验证。

## 项目事实

已核对当前任务访问、后台执行、Pi 工具装配和桌面页面。代码位置与能力缺口见：

- [后端适配核对](backend-fit.md)：TaskSpace JSON、服务身份、现有静态资料工具、Profile、结果访问入口。
- [交互研究](interaction.md)：任务面板、规则页、信息中心及 Inbox 的复用位置。
- [模拟场景](simulation-scenario.md)：双源数据职责、触发、对象／时间／版本以及候选任务。
- [交互契约](../integration-contract.md)：联调所需的请求／响应、过滤、时间、错误与游标；既有接收与拟新增查询分别标明。

当前实现规范以 `.trellis/spec/backend/task-access.md`、`background-execution.md`、`frontend/harness-lab.md` 为依据。早期后台方案中“待审命令直接使作业失败”等旧描述不作为本期事实；当前已实现阻止单次工具操作后返回 Pi，允许继续获准步骤。

本期缺口是动态多源查询、任务可选关联条件及综合资料的访问检查。现有会话、压缩、文件执行、后台排队与固定投递能够承接，无证据要求替换 Pi、迁移历史或增加完整工作流引擎。

## 外部参考及采用程度

- [Microsoft：领域分析](https://learn.microsoft.com/en-us/azure/architecture/microservices/model/domain-analysis)：业务边界可以拥有各自模型。用于区分 Axon 任务与外部报告／态势对象，不据此拆分微服务。
- [Microsoft：数据考虑](https://learn.microsoft.com/en-us/azure/architecture/microservices/design/data-considerations)：通过明确的数据职责及访问方式处理跨边界数据。用于保留来源权威和按需查询；本期不建外部全量副本。
- [Microsoft：适配边界](https://learn.microsoft.com/en-us/azure/architecture/patterns/anti-corruption-layer)：在边界转换不同系统的数据表达。采用宿主内适配器，不建设独立转换平台。
- [CloudEvents 1.0.2](https://github.com/cloudevents/spec/blob/v1.0.2/cloudevents/spec.md)：事件来源／消息身份与业务 subject 有不同用途。用于解释消息去重与对象关联的区别，不改造现有入站协议。
- [OGC SensorThings 1.1](https://docs.ogc.org/is/18-088/18-088.html)：提供围绕对象、观测、时间和位置查询的参考。这里只借鉴数据区分，不实现该标准或把其 Tasking 当作 Axon 任务。
- [FEMA ICS 209](https://training.fema.gov/EMIWeb/IS/ICSResource/assets/ICS%20Forms/ICS%20Form%20209,%20Incident%20Status%20Summary%20(v3).pdf)：事件状态报告可包含自身事件身份、报告时段和位置，提供与执行任务分工的现实参考；不是对所有领域系统的统一规定。

这些参考支持边界选择，不能代替本项目真实接入验证。本期具体 schema、工具、授权和 UI 是基于现有 Axon 的待审方案；正式范围以本目录 [设计](../design.md) 与 [验收](../acceptance.md) 为准。
