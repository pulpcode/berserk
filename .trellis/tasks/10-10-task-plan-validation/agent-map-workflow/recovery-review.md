# 读取依据与失败恢复：独立代码审阅

日期：2026-10-14。对照本目录已批准设计、PRD RC1～RC8 和基线 `e9a01b4` 审阅。产品实现检查通过，可以冻结后进行真实模型复测；本报告不代替 RC8 的真实模型结果。

## Findings (fixed)

未发现需要由审阅者再次修改的产品缺陷；本审阅没有修改产品代码或测试。实施者已将提交回调移至 SQLite 事务成功返回之后、访问保护释放之前。审阅确认：适配器据此识别提交后返回失败，包括 `RequestError`，不会误报为未提交。

## Findings (not fixed)

- `scripts/probe-map-workflow.ts` 的初始恢复批次只改变任务/图层名称，业务句式相同；计划另要求两例措辞变体。已交由负责脚本的主会话在冻结前处理，审阅者没有越过文件责任边界修改。
- `.trellis/spec/backend/map-annotations.md` 仍描述旧的全量失效、empty 预读和补充输入失效规则。主会话负责在验证后同步，不将旧规范视为新设计的验收目标。
- RC8 真实模型三例尚待主会话执行。图层歧义、Skill 触发、正文空间尺度和保存字段误述是既有业务质量限制，不因本次确定性检查通过而消失；不在本次恢复机制审阅中扩大实现。

## 已核实的关键行为

- 创建无需 empty 预读；服务捕获当前绑定，并在提交前重新检查绑定、草稿不存在、授权及取消。已有草稿不会被覆盖，也不会自动转成追加。固定基线仍经过访问校验。
- 草稿、来源 fullRef、任务当前序号分别保留。参数错误、缺项和冲突只暂停当前输出的后续地图写入，不删除其他依据；保存时继续采用原 CAS，不能吸收外部新 head。
- 新读取按原生 toolCallId 暂存；下一次普通推理才提升。schema 拒绝、before hook 阻断、after hook 标错/替换/原地修改及 tool_execution_end 错误均不会提升该调用的观察。后置钩子异常仍停止请求。
- 同链成功提交可立即推进机械条件；旧幂等回执不推进或倒退。结果不确定跨推理、单独重读仍阻断；原回执成功交给模型后才解除未决状态，并清除对应编辑依据以要求重新读取。不存在回执不能解释为未执行。
- 普通 steer/follow-up 保留读取记录；新请求另建状态。成功压缩清除依据，失败/取消沿用停止路径。未增加跨请求恢复、数据库表、历史改写或模型权限。
- 来源批次仍在网络读取完成后重检权限和草稿条件，一次事务保存快照及回执；来源几何、UTC 时间、固定发布、跨任务/席位/会话边界保持既有契约。

## Verification

环境：`experiments/harness-lab`，Node `v24.14.0`，Pi `0.85.1`。

| 检查 | 结果 | 执行方 |
| --- | --- | --- |
| `npm run typecheck` | 通过，退出 0 | 实施者及独立审阅者 |
| `npm run lint` | 通过，含 Pi/browser 依赖边界 | 实施者及独立审阅者 |
| 下列 12 文件回归 | 154/154 通过 | 实施者；审阅者检查实际日志与用例 |
| `npm test -- tests/probe-map-workflow.test.ts` | 3/3 通过 | 独立审阅者 |
| `npm run build` | 通过，保留既有 >500 kB 包体积提示 | 独立审阅者 |
| `git diff --check` | 通过 | 实施者及独立审阅者 |

```sh
npm test -- tests/annotations.test.ts tests/annotations-acceptance.test.ts tests/annotation-from-source.test.ts tests/pi/annotations.test.ts tests/pi/annotation-source-history.test.ts tests/pi/annotation-workflow.test.ts tests/pi/annotation-hook-boundaries.test.ts tests/pi/compaction.test.ts tests/pi/message-intake-lab.test.ts tests/pi/recovery.test.ts tests/annotation-map-evidence.test.ts tests/pi/map-skill.test.ts
```

12 文件回归于 16:41:24 开始，27.50 秒；驱动测试于 16:44:01 开始。合计 13 个文件、157 个不同用例，不重复累计实施者的定向重跑。实施记录与完整日志分别在包内 `.local/agent-map-recovery/implementation-checks.md`、`implementation-regression.log`。

本次没有布局或地图入口渲染修改，未重复浏览器 E2E；没有真实模型调用、部署或 Git 提交。当前代码审阅无阻断项；主会话应在脚本最终变体及相应检查完成后冻结本轮模型批次。

## 实测后收尾复核

主会话已在冻结前加入两例措辞变体，并完成固定批次 `.local/agent-map-recovery/2026-10-14T08-47-33.036Z/`。审阅者只读核对新验证报告、analysis/semantic-review、实际 S01/S02/S03 快照及回执、旧 main-3 和更新后的规范，没有重新调用模型。

- 确认三例均无草稿起步，首次导入为一次三项批量，真实 UTC 查询时间与回执逐项相同，固定发布和任务当前指针保持不变。末版分别为 r3/r3/r4；main-3 的额外道路说明/属性编辑确有保存。
- 确认总计 39 次工具调用、38 次模型请求、647,977 tokens，错误分布 2/0/1。7/9 业务步骤首次调用合法，不能表述为三个案例全程零错误。
- 原 main-3 S01 提示逐字一致；25 工具 / 22 模型 / 8 错误变为 6 / 5 / 0，tokens 371,331→70,981。正文保留了有限样本、工具说明与 Skill 同时变化、其他场景未复测的限制，没有把改善归因于单一改动或宣称普遍成功率。
- 独立重新计算 322 个冻结文件 hash，全部一致。规范中的创建条件、按调用观察、普通失败暂停、未决回执与生命周期描述符合已审阅代码；初审的措辞变体和规范同步待办已解决。
- 向主会话提出两处报告文字澄清：校验发生在准备阶段及事务内提交前，不是 COMMIT 后；main-3 对旧发布版的“closed 状态”表述与 main-1 同样混淆来源事实和保存字段，main-2 的“指向 closed 状态”也有歧义，需一并披露。该问题不否定几何/来源结构保存正确，也不能因为新草稿确已保存 open 而忽略旧发布没有 closed 属性。
- 主会话已确认两处报告文字修正完成：补充 main-2/3 的旧发布表述限制，并与 main-3 新草稿实际保存 open 区分。

结论：恢复机制及结构化保存结果的报告有证据支持，无新增产品或规范阻断；保留三次工具错误和正文质量限制后，可交付本轮结果。真实模型执行由主会话完成，前文“没有真实模型调用”仅描述独立审阅者的执行范围。
