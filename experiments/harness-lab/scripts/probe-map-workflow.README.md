# 地图工作流固定验收批次

Node 24，在本目录上一级 `experiments/harness-lab` 使用现有本机模型配置：

```sh
LAB_EXECUTION_ENABLED=false node --env-file-if-exists=.env.local --import tsx scripts/probe-map-workflow.ts --prepare-only --port 4343
LAB_EXECUTION_ENABLED=false node --env-file-if-exists=.env.local --import tsx scripts/probe-map-workflow.ts --port 4343
```

第二条会调用真实模型。执行前确认已有用户对合成资料和模型费用的授权。测试使用新建正式账号、独立任务/会话及本机模拟来源，无工作分派、Docker 执行、自动批准或真实任务数据。

固定 11 案，没有重试或选择最佳结果的选项：3 轮来源导入—发布—来源变化后刷新；4 对图层意图（已有层、新建层、同名歧义、未指定目标）。每对仅改变地图 Skill 是否进入请求资源目录，底层工具及模型配置相同。主流程前两轮预建空层，第三轮从无草稿开始；任务名/图层名改变，来源对象 ID 每轮独立，来源业务名称保持同一模拟夹具。

所有用户交互都会记录后取消，驱动不回答问题。歧义案需要同时检查实际问题文本及草稿未改动；主流程中的交互按未完成记录。`protocol_completed` 不能当作语义通过；需检查来源几何/时间、目标层、批次修订、旧发布/当前指针、工具错误及正文论断。

证据保存在 `.local/agent-map-workflow/<时间>/`：计划、每案基线与 Skill/script hash、实际模型 JSON 正文（无认证头）、来源响应、每步 SSE/会话状态/工具结果/用量、前后草稿、原生历史副本及结果。完整证据仅留本机，不提交认证数据。执行前另存生产代码/夹具 hash，实际工具 schema 可从模型输入去重提取。

准备阶段失败应保留，修复驱动后先 `--prepare-only`；未发送模型的准备错误单独报告，不冒称模型失败，也不隐藏在模型成功率里。真实模型开始后不根据输出临时修改提示或重复用例。

## 读取依据与恢复机制复测

```sh
LAB_EXECUTION_ENABLED=false node --env-file-if-exists=.env.local --import tsx scripts/probe-map-workflow.ts --recovery --prepare-only --port 4357
LAB_EXECUTION_ENABLED=false node --env-file-if-exists=.env.local --import tsx scripts/probe-map-workflow.ts --recovery --port 4357
```

`--recovery` 固定执行 3 个主流程，全部从没有草稿开始；main-3 保留原业务提示，另两案沿用相同步骤，改变任务/图层名称和业务措辞。不预建图层，不增加工具顺序、修订号或纠错提示。原默认 11 案保持不变；复测结果保存在独立 `.local/agent-map-recovery/<时间>/`，不可覆盖原批次。

重点检查原 main-3 的草稿/来源交替拒绝是否消失；另行统计模型普通参数错误、读取次数、实际调用和用量，不把保存成功等同首次顺畅。三个案例都执行查询并创建/导入、发布固定版本、来源变化后刷新三个步骤。此批次不重新做四对图层 Skill 诊断，不用其结果推断 Skill 的因果效果或全面业务成功率。
