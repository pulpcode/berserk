# 工程Issue状态索引

2026-11-09 · 按当前分支仓库issues.md/bugs.md及后续验证/发布记录核对，共15条带编号事项。不是GitHub实时状态；没有在本次操作远程关闭issue。未发现关闭证据的条目保持开放。

| 编号 | 内容 | 当前可确认状态 |
| --- | --- | --- |
| SIM-DOMAIN-001 | 模拟外部系统按管理域拆分 | 后续建设，未实施完整拆分 |
| SIM-NOTICE-001 | 来源来报去除作者任务编号、控场说明 | 已实施并发布；待确认关闭，原清单未上线状态已过时 |
| SIM-TASK-001 | 总体席从来报判断并创建任务纳入演示 | 已实施并发布；待最终用户验收，不代表模型语义全面合格 |
| SIM-TASK-002 | 无来源手动任务的轮次归属 | 待设计；此前隐藏运行上下文提议已撤回 |
| SIM-EVAL-001 | 无关来报对照与抗干扰测试 | 延后丰富，尚未按该issue完整验收 |
| SIM-COMMAND-001 | 分步下达间再研判与最新态势上下文 | 需求/触发方式待明确，未实施 |
| SIM-MAP-001 | 来报预填地图关注范围及新增资源补充 | 本次新增，方案已搁置，未编码 |
| PLOT-I01 | Agent标绘候选预览与用户确认 | 已暂缓，未实施 |
| MAP-Q01 | 局部读取误推断整个版本不存在对象 | 已复现，未见关闭记录 |
| MAP-Q02 | 未筛图层却按图层解释分页/数量 | 已复现，未见关闭记录 |
| MAP-Q03 | 无必要的状态补充产生歧义 | 保留待优化，未见关闭记录 |
| PERM-001 | 完善跨席位/任务/工具权限与确认边界 | 后续待设计，未完成该整体建设 |
| BUG-001 | 跨席交接遗漏实际附件 | 机制已有修复，原自然多轮及独立对照验收未补齐，保持开放 |
| BUG-002 | 普通文件检查命令误触发确认导致后台失败 | 已修复/部署/回归，原记录建议关闭GitHub #2；远程关闭未核实 |
| BUG-003 | 分派准备与确认跨轮衔接失败 | 单工具修复/回归及一轮实际交接通过，建议关闭GitHub #3；远程关闭未核实 |

## 尚未单独编号、按报告跟踪的遗留

最新执行反馈修复三轮报告仍有：1处漏关联（原关系83/84）；正文/持久理由中的修订主体、道路别名、状态变化、证据利用和范围表述问题；12次被严格校验拒绝的工具调用错误（最终63条有成功记录回执）；来源区域标签未覆盖目的地导致的检索覆盖限制。均有证据记录，尚不能统称全部解决。

复验报告：[执行反馈修复结果](tasks/11-08-scenario-execution-feedback/repair-plan/research/retest-results.md)。本次不新启动修复、测试或部署。

## 权威记录

- 场景事项及SIM-MAP-001：[场景issue清单](tasks/11-03-scenario-demo/issues.md)。来源文案发布见其research/source-notice-release.md；人员建任务发布见tasks/11-05-scenario-business-flow/research/online-release.md。
- 标绘候选：[标绘issue](tasks/10-26-agent-plotting-integration/issues.md)。
- 地图查询范围：[MAP-Q清单](tasks/10-15-map-query-scope/issues.md)。
- 权限：[PERM清单](tasks/09-23-background-handoff-board/issues.md)。
- 交接缺陷：[BUG清单](tasks/09-22-handoff-attachment-integrity/bugs.md)，后续附件机制进展见其reliability-2026-10-15/verification.md。

本索引是审阅快照；后续实现/发布/验收应在对应issue及本索引同步更新，历史事实保留。
