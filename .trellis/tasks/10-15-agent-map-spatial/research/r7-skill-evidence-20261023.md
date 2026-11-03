# R7 Skill 候选与旧失败证据核对

日期：2026-10-23。分支：`codex/agent-result-grounding`。对照基线：`af13107`。本记录是 Agent 复核，不是人类双盲审阅；未改历史分数。候选效果须由本轮同模型、同题 A/B 验证，不能用旧 Pro 分数与新 Flash 相减。

## 1. 旧失败实际收到什么

原始根目录：`/Users/lau/.codex/worktrees/agent-map-spatial/berserk/.local/spatial-r6/r6-20261022-01/`，只读检查。

| 失败 | 可定位的原句与时序 | 真实工具信息 | 判断与本轮处理 |
| --- | --- | --- | --- |
| D17-E2 过程宽度 | `review.json#/final/messages/5/text` 在调用分类前称“东西约 1.7 km” | `provider-0025-input.json` 中已有固定区域和资源点几何；`provider-0026-input.json` 含实际 classify_points 结果，values 为 total=5、interior=2、boundary=2、exterior=1。南北边长度约 1846.731 / 1847.164 米（旧独立核对），分类接口没有返回宽度 | 不是分类工具算错或丢字段。问成员却附加未经测量的数值；正文指导先判断指标是否必要，必要则选测量口径并计算。后来的正确分类不抹去此前过程错误 |
| D16-E0 留存状态 | `review.json#/final/messages/5/text` 在 buffer 后称“只是内存中的分析结果” | `provider-0038-input.json` 中空间投影含 operation=buffer、distanceM=500、resultRef、固定版本、scope、method、limitations 和 geometryType=Polygon；没有“只在内存”依据。`native-sessions/2026-10-22T09-45-44-987Z_01a16300-951b-76cc-b3f4-d2ee52d56439.jsonl` 实际保留完整 Polygon 与 spatialResult | 生成分析与添加草稿对象被混淆，并推断了内部机制。说明本次动作效果即可；不新增 persisted:true，因为函数尚未返回时不能保证宿主后续写入 |

当前 `src/contracts/spatial.ts` 的 `projectSpatialResult` 保留分类、数值、身份、范围、版本、方法与限制，仅省略大块几何坐标。`src/pi/spatial-results.ts` 的 `spatialToolResult` 同时提供模型投影和原始 details，固定结果由真实历史恢复。标绘回执已有成功效果、对象、版本，错误已有 code/outcome 和回查入口。

**未发现需要新增工具字段的已证明缺口。** 本轮仅 A/B，不预设 C 组；不修改工具、历史、存储或宿主循环。D02 原有读取限制歧义不靠改 Skill 替旧题指定答案，应由评测题明确区分候选限制和禁止读取限制。

## 2. 两份正文改什么

所有改动从当前产品正文出发，保留 frontmatter、受控 ID、已有加载路径和原生历史兼容；不复制旧 E1/E2 最好片段，不写入测试对象名、坐标、预期数量或用例答案。

- `experiments/harness-lab/fixtures/skills/spatial-analysis/SKILL.md`：开头给出“明确需求—执行—核对”的短顺序；过程和最终共同使用已有证据。保留全部测量、过滤、排序、统计、固定结果及保存流程；补齐当前已存在的 classify_points 用法，撤除旧“严格内部无法区分”的过时暗示。宽度按上下文确定口径，有需要就计算，没问则不额外估算。合并原核对段的重复提醒，按对象数值、范围时间、动作状态三个方面组织。
- `experiments/harness-lab/fixtures/skills/map-annotations/SKILL.md`：原查找、定向读取、创建、来源复制、编辑、冲突恢复、发布采用接口流程保持。用四行动作表区分生成分析、草稿写入、发布、设为当前；明确 not_committed 与 unknown 的表述边界，以及旧回执不是新执行。必要数值先取证；已输出错误需明确更正。

例子仅展示方法：成员问题不附无依据尺寸，明确长度问题必须测量；生成分析只能说明本次未添加草稿对象。不会以少回答提高严格分，也不要求每句话额外调用工具。

这些变化只是模型指导，不是程序事实验证器；未读取正文时没有这些新增规则的实际曝光，需另行报告。自动按需读取和正式保留集不在本次 A/B 效果结论内。

## 3. 离线验证

- 两份正文都小于现有 16 KiB 限制，frontmatter name/description 保持不变。
- `git diff --check` 通过。
- Skill Creator 通用 quick_validate 尝试未完成：当前 Python 缺少 PyYAML，未为此安装依赖。
- 首次 `npx vitest` 发现新 worktree 缺少 node_modules，提示下载非锁定 Vitest 后立即停止，未运行测试、未修改锁文件。随后确认主工作区锁文件一致，使用链接的本地 Vitest 4.1.11 运行 `./node_modules/.bin/vitest run tests/pi/map-skill.test.ts tests/pi/skill-metadata.test.ts`：2 文件、16 项全部通过。覆盖精确正文按需/显式送达、受控元数据、哈希和历史重开兼容；不代表模型会遵循。

| 正文 | 基线字节数 | 候选字节数 | 候选 SHA-256 |
| --- | ---: | ---: | --- |
| spatial-analysis | 8585 | 9754 | `64b0100f87bb15cfd4b18042194fb8f0a747f4bba72aa6e31ef675a84787146f` |
| map-annotations | 4443 | 5934 | `e113340bc4af9491bf5331cf731ec83cca36b310d38b3850db7b81eef16e67f5` |

正文较基线略增，不将本轮称为“更短一定更好”的实验；对照变量是两份说明流程候选。元数据、接口、宿主与算法保持相同。
