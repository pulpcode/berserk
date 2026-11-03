# 讨论与源码核对依据

核对：2026-11-03，源码386de03506f00205b4e6655c942a18c258e979f6。仅静态阅读与既有结果，未新跑测试，也未重做分享讨论中的函数实验。

来源：[分享讨论](https://chatgpt.com/share/6ae98777-5768-83ec-a38a-b7ae45a6cc3e)。采用其先修明确遗漏、再聚焦模型对照的方向；28项规模、D06和预算是本方案提议，并非分享讨论已经批准。

下表路径均相对仓库根目录，行号对应上述基线。

| 发现 | 本地证据 | 判断 |
| --- | --- | --- |
| 工具仍允许直接分列条件答案 | experiments/harness-lab/src/pi/spatial-tools.ts:43 | 与新版单范围先澄清冲突，须修；不是N06唯一原因的证明 |
| Skill已有严格澄清规则 | experiments/harness-lab/fixtures/skills/spatial-analysis/SKILL.md:33 | 不能说规则已全部同步而模型仍不遵守 |
| 指定题号未参与通过判断 | .trellis/tasks/11-03-resource-independent-acceptance/scoring.ts:41、48 | N05不能替代N02；旧工具门槛应为未充分验证 |
| 冻结口径要求指定覆盖 | .trellis/tasks/11-03-resource-independent-acceptance/scoring.md:20 | 勘误遵循旧规则，不是追加门槛 |
| N02未走资源汇总路径 | .trellis/tasks/11-03-resource-independent-acceptance/report.md、records/tool-coverage-adjudications.json | 业务答对与工具被验证分开 |
| read只传版本会读全版本 | experiments/harness-lab/src/pi/annotation-tools.ts:121、124、142 | 新引用入口可减少重拼参数遗漏 |
| 宿主已保存完整选择 | experiments/harness-lab/src/pi/lab.ts:1117；src/pi/composer-input.ts:116 | 复用resolveSelections/composerHistory，不另建存储 |
| 工具注册未接通完整选择 | experiments/harness-lab/src/pi/lab.ts:764 | 新入口还需接通既有记录，不只加schema |
| 历史文本按版本校验 | experiments/harness-lab/src/pi/composer-input.ts:94、104、116 | 新展示格式保留旧模板 |
| 多问题最终被旧桥限制 | .trellis/tasks/11-03-resource-independent-acceptance/run.ts:25 → 11-02-resource-rules-evidence/evaluation-v2.ts:95 → 11-02-task-resource-acceptance/run.ts:24 | 最终要求questions.length===1；新协议需逐问匹配 |
| 无position默认显示内部 | experiments/harness-lab/src/web/ResourceResultCard.tsx:49 | 小范围修正标签 |
| 无position使用空间items | experiments/harness-lab/src/pi/task-resource-results.ts:53 | 不改统计语义 |
| Skill导出漏认实际工具名 | .trellis/tasks/11-03-resource-independent-acceptance/report.md的Skill章节 | 新导出兼容；旧8/16为轨迹核对后结果 |
| Qwen已有接入及续跑记录 | .trellis/tasks/10-28-agent-spatial-plotting/qwen-comparison-20261030/comparison-results.md | 复用适配，但最新工具schema仍需验证 |

旧分数为主任务12/16、严格8/16、有终答解释10/15。单产品单模型、8题各两遍，不能与不同题目的旧分数直接作因果比较。已覆盖路径未重现旧工具缺陷，指定N02组合缺覆盖；“未充分验证”不等于“工具已知失败”。

实施前读取现有规范：.trellis/spec/backend下的map-annotations、conversation-references、spatial-analysis、task-resource-query、task-resource-experience、hitl、model-thinking、agent-scenario-validation，以及前端harness-lab和质量规范。优先Pi公开机制，不扩大桌面产品边界。
