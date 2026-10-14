# Agent 与框架主流程验证

以 `.trellis/tasks/10-10-task-plan-validation/agent-framework-e2e-plan.md` 为审阅依据。该入口仅运行 S01–S07 合成流程；并行/异常、桌面交互、真实业务语义另行审阅。

从 `experiments/harness-lab` 执行，使用 Node 24：

```sh
npm run probe:agent-framework -- --prepare-only --port 4331
npm run probe:agent-framework -- --runs 1 --port 4331
npm run probe:agent-framework -- --runs 3 --port 4331
```

`--prepare-only` 创建全新正式账号与模拟来源、通过模拟 API 写入初始事实、上传初稿、创建会话后关闭实例。它不调用模型，也不代表 Docker 已通过。正式运行需已配置的真实模型和可用 Docker；每一轮重新创建数据目录，不继承上一轮模型答案。`--runs` 默认 1，最多 3；三轮中某轮失败不会阻止后续独立轮次，也不自动重试失败步骤。

端口也可通过 `AGENT_FRAMEWORK_PORT` 指定。现有 `LLM_*`、`LAB_EXECUTION_*`、请求时限等沿用项目环境配置。无 `.git` 的远端隔离副本可设置 `AGENT_FRAMEWORK_REVISION`，驱动会标明该提交值来自操作者，并另存当前脚本与初稿 SHA-256。不要把凭据写在命令参数中。

驱动沿用地图试验的初始化：预置四个席位和三个任务；仅总体席、筹划席办理西区补给任务，东区作对照。情报席、态势席不办理工作；西区转移任务仍是可查询候选，是否被读取以实际工具记录为准。不发送来源通知或调用后台分析；前台 Agent 自主查询已获授权的来源 API。本次覆盖任务分派、查询、标注、文件及复核，不将其等同于后台接入/自动投递的端到端验收。

仅 `初稿.md` 上传到工作区；`review-checklist.md` 是独立评审材料，不送入模型。道路初始事实为 09:20—09:50 不可通行、可用车辆 2 辆；主任务要求 09:40、3 辆。第一版提交后才更新道路对象及报告为 09:35 恢复通行，车辆资料保持不变。几何沿用来源自身数据。

每一步使用自然业务指令。脚本仅对当前步骤精确匹配的工作分派/提交/复核卡执行“合成场景中的人工业务确认”，保存原始卡和准备记录，不称作真人审阅。签收使用页面操作并单列回执。不自动回答问题、不批准 Bash、不提供遗漏事实或正确工具作为补救；额外交互会取消当次请求，保留失败。部分写入成功时不回滚、不伪称整体未执行。

输出的 collection `runs.json` 逐步记录状态；每轮独立 dataDir 中包括：

- `agent-framework-evidence/*-input.json`：实际用户指令及允许的业务确认范围。
- `*.sse`、步骤 JSON：原始事件、会话快照、用量、查询结果及字节统计。
- `model-inputs.jsonl`：本轮 provider 的最终请求 JSON 正文，无认证头；包含工具定义与实际历史，用于上下文分析。
- 各步 `*-state.json`：真实来源、工作回执、草稿、固定发布版、任务当前及待办状态。
- 提交的 v1/v2 Markdown 固定副本、来源更新和脚本确认记录。
- 原有 `sessions/`：Pi 原生历史；`agent-framework-result.json` 列出其文件名。

保留整个独立目录以便复查，但不要把其中 `credentials.json`、`service-secrets.json` 或认证配置纳入 Git、报告或公开材料。原始模型证据也不应直接对外发布。

`protocol_completed` 仅表示驱动的结构性检查完成；所有轮次 `semanticReview` 初值都是 `pending_review`，须结合独立清单审阅实际内容。没有执行的步骤、Docker阻塞、错误、人工纠正和模型不完整结论均不能计为通过。来源通知投递、桌面视觉及上下文压缩未执行时单列未覆盖。
