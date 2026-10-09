# 实施步骤

状态：**待用户审阅，尚不激活开发**。

| 步骤 | 交付 | 主要涉及模块（位于 experiments/harness-lab） |
| --- | --- | --- |
| P1 席位及数据契约 | 中央职责字段、四席位合成配置、审批席位配置、规则候选、建议和审批契约、v5 迁移 | src/access、src/contracts/background.ts、src/background/config.ts、src/background/store.ts、scripts/access-admin.ts |
| P2 Agent 建议 | 同一 Pi 主 Agent 的候选上下文、建议工具、宿主校验与保存 | src/background/executor.ts、service.ts、src/pi/background-runner.ts、lab.ts；新增独立席位建议模块 |
| P3 固定投递与审批 | 成功结束生成固定投递及待批准事项；总体席决定、事务回执、批准后投递和重试 | src/background/store.ts、service.ts、服务端后台路由及管理脚本 |
| P4 页面 | 固定与补充候选表单、只读职责、待批准列表／详情、决定反馈、收件理由 | src/web/InformationRules.tsx、信息／作业详情、Inbox.tsx、api.ts 及现有样式 |
| P5 验证与文档 | 四席位隔离验证、真实模型建议、审批端到端、迁移及重启检查 | tests、合成配置及验证脚本、规范与发布说明 |

实施前核对准确组件与路由，不因计划中的模块划分重构整个 PiLab。Pi 适配器注册公开工具与回调，业务权限和审批放在宿主，不修改 Pi 内核。

前端从 `.trellis/spec/frontend/index.md` 进入，直接读取 harness-lab.md 中 Interaction and accessibility、Authenticated task entry、Information center navigation and job observation 等相关段落，避免长文件注入截断。

## 联动检查

1. 席位脚本更新职责不重设账号；旧目录、历史席位与固定规则仍可用。来源授权、资料范围和总体席审批资格分别校验。
2. 规则表单、配置解析、管理脚本、接入快照、重处理和上下文使用一致字段；职责不在每条规则重复维护。
3. 工具建议、原生调用结果、`finishJob`、审批决定、投递和启动完整性检查使用同一作业与版本依据。
4. 作业成功与审批等待分开；不占用 Agent、模型、作业并发名额或容器等待人员。
5. 批准事务、重复点击、响应丢失及不同浏览器决定竞争有一致结果；未批准的建议不新增收件或读取权限，已有来源查看权限保持原义。
6. 信息中心、收件和任务信息使用显式 DTO，保持私有会话及工作区隔离。

## 验证

使用项目 Node 24，在 experiments/harness-lab 执行现有质量检查：

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
```

按 [验收清单](acceptance.md) 测试真实工具注册、接口接入至审批和收件链路、迁移重开、幂等及取消边界；不只模拟最终名单函数。

真实模型验证使用独立数据目录、合成来源／任务／四席位和当前提供方。不在消息中塞入预期席位 ID，不强制调用新工具，不改写模型输出；记录建议、理由、是否遗漏、人员决定及实际收件。验证同一作业可综合任务和席位判断，不增加第二段模型分析作为测试前置条件。

本期不做单 Agent／分阶段分析的基线对比。发现效果不佳时先保留原始证据，再讨论是否需要阶段拆分；人工审批通过不能替代模型质量记录。

## 部署准备与交付

设计获准后实施和验证；提交、push、部署仍按用户后续指令执行，commit message 以中文为主体。

部署方案须列出四席位账号开通、职责配置、来源与资料授权、总体席绑定和规则启用步骤。新四席位用于后续验证；旧 A／B 数据保持原身份，不做隐式迁移。账号凭据通过本地受控配置，不写入设计文档或仓库。

先备份数据库及配置，验证 v3／v4 升级至 v5 和各读取入口；发布后确认旧规则仍固定投递，新规则仅对新输入产生建议。变更为新规则不会使旧消息重新分析时自动采用新快照。

完成后更新已实现规范。本轮仅修改待审文档，不把未实现能力写成 `.trellis/spec` 的现状。
