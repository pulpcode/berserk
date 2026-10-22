# 开发主线集成与分支管理记录（2026-10-22）

用户已授权按建议管理：先推送空间分支、审查最终组合、完成检查、合入开发main，并清理已合并的历史分支。没有授权或执行新一轮付费模型评测。本次不新增产品行为，不采用精简Skill候选，不将开发集成标记为90%效果验收通过。

## 合并范围与决定

产品来源为codex/agent-map-spatial@bab2291；它已完整包含main@e7d56e8和底图分支a79f1ae，合并可快进，不需要重复合入底图。空间分支原领先远端的25个提交已推送到pulpcode/berserk。

保留现有代码组合：地图三视图、空间分析、名称查询、点面分类、原生结果/历史读取，以及当前Skill目录入口和错误方法提示。两份E1/E2精简正文继续仅作任务目录候选，正式Skill不替换。读取入口与错误提示的效果尚未证实；整支产品组合不等于R6 E2，也没有新的完整组合模型成绩。本次工程检查通过，不据此宣称模型可靠率提高。

## 最终版本检查

| 检查 | 结果 |
| --- | --- |
| TypeScript | 通过 |
| ESLint及Pi/browser依赖边界 | 通过 |
| Vite构建 | 通过；保留既有大chunk提示 |
| 全量单元/离线集成 | 101个文件、1119项全部通过，maxWorkers=2 |
| 桌面浏览器回归 | 38项全部通过，涵盖标绘、底图、空间结果、Skill引用 |

浏览器第一次因5198端口占用未启动测试，未中断占用服务；记录保留在browser-startup-port5198.log。随后使用系统分配空闲端口51957完成38项。没有重跑模型、消耗新付费测评预算或清理旧失败证据。原始本轮工程日志见main-integration-evidence-20261022/；独立审阅见[检查记录](main-integration-check-20261022.md)。

被测产品代码和正式fixtures仍为bab2291；本次后续提交只更新三份方案入口、任务管理记录与验证材料。历史评测文件末尾空行保留原样，不将其当产品阻断或修改历史记录。

## 分支整理范围

[管理前引用快照](main-integration-refs-20261022.json)保留所有原分支提交及恢复方法。以下六个本地分支的提交在管理前就已被main包含，且没有独立worktree：

- codex/handoff-reliability
- codex/map-query-native-evaluation
- codex/map-query-pro-evaluation
- codex/map-read-evidence
- codex/ui-work
- codex/work-inbox-overview-design

main完成同步后，已删除上述本地分支及两个远端旧分支codex/handoff-reliability、codex/ui-work。删除远端前再次核对实际提交，用预期提交约束删除，避免覆盖并行新工作。分支名称可删除，提交历史仍由main保留。

保留main、codex/agent-map-spatial、codex/map-basemaps及三个现有worktree；不删除本地.local原始证据或正在使用的工作目录。后续新任务从同步后的main新建codex/前缀分支和独立worktree；不反复使用已完成历史分支。

## 执行状态

- 空间快照bab2291已推送；最终产品检查已完成。
- main已从e7d56e8快进到51fa8bf并推送；底图a79f1ae已随空间分支完整进入main。
- 六个本地及两个远端历史分支已清理，删除前再次验证提交归属与预期远端引用；没有强推现有分支历史。
- main工作目录已用锁文件补齐52个依赖包（ignore-scripts），package.json/package-lock.json字节未变化；main目录再次typecheck通过。
- 保留三个现有worktree和全部.local原始测评记录；本次管理完成记录也同步到main和空间分支。
- 模型效果AC10仍未通过，整体90%门槛不变；保持任务进行中，不归档为功能验收完成。
