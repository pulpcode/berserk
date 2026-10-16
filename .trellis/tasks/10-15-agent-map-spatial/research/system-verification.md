# 第一阶段空间分析：系统验证与独立代码审查

日期：2026-10-16。审查者：`agent:spatial_check`，属于自动化代理审查，不冒称人类评审。工作区为 `codex/agent-map-spatial` 独立 worktree；未修改 main 或其他会话工作区。

## 结论与适用范围

最终稳定实现的 typecheck、完整 lint/依赖边界、生产 build 和差异空白检查通过。完整 Vitest 与针对性复核的结果如下，保留运行过程中首次失败，不把不同批次的重叠测试数相加。首轮工程检查没有尚未解决的产品代码审查阻塞；对应精确版本已随首轮报告提交为 `5910928`。后续有限修正与补充验证须单独记录，不能沿用首轮检查声称新版本已全部验证。

首轮 216/216 次真实模型试验及独立代理语义审核均已完成，**AC10 未通过**。详见 [首轮模型评测](model-evaluation-v1.md)。B/C 五维语义全部通过分别为 43/72、40/72，保留集分别为 11/18、11/18；两组均未达到 90%，且各有 1 条已核实关键错误。纠正 D18 非分析误标后的 C 组分析前加载率为 28/48，仍低于 90%。程序、浏览器或假模型通过不证明 Skill 已提升可靠性。第二轮 D11 聚焦补充验证也已完成 9/9 执行及审阅，完整语义通过为 A2/3、B1/3、C1/3；不能替代完整首轮或宣告 AC10 通过。

## 审查发现与修复复核

1. **无效面被计算库接受**：独立运行复现外环外孔、嵌套孔、零面积环及 MultiPolygon 内部重叠被 booleanValid 接受，可能产生错误面积。后端补充环包含/非重叠/非零面积检查；审查者重跑原四个反例，均返回 `SPATIAL_GEOMETRY_INVALID`。合法孔、分离多面及孔中独立岛屿由回归测试覆盖。
2. **参照几何未进入地图结果**：原实现只保留 input.items，点点测距/点线测距/关系判断的 target 消失。现使用独立 referenceItems 保留固定参照，模型投影不带坐标，地图以独立身份显示；不把参照混入可供下游使用的结果集合。
3. **损坏结果正文绕过历史权限检查**：原检查只重检有效元数据，hook 使 spatialResult=null 时仍可能留下原成功正文。现以 spatialRejected 区分被拒绝的成功与普通错误；历史隐藏损坏成功正文、续问失败关闭；普通缺字段等工具错误仍可继续更正。实际原生测试覆盖此恢复行为。
4. **来源输入契约错配**：原 schema 允许 100 个精确引用/区域，而 ContextService 实际为 20/10；且误把标绘 ASCII ID 规则应用于已有 ContextRef。现对齐上限并支持合法中文来源对象 ID，重复修订条件按完整身份元组判断，属性顺序不能绕过去重。已有标绘保存的 ID 兼容限制仍明确保留。
5. **业务时间缺失**：后端自查补齐 source.effectiveAt/validTime（含空端点），分页重复对象的时间变化也纳入完整性检查。此补丁恰逢完整测试运行，相关首次失败及稳定复核单独记录。
6. **面板遮挡分析定位**：前端增加按实际面板占位定位，桌面窄分屏可见空间不足时收起面板。前端测试核对实际地图投影屏幕坐标，不仅检查控件存在。
7. **规范同步**：审查者新增 `.trellis/spec/backend/spatial-analysis.md`，并在前后端 index 加入口，记录工具、结果引用/read delivery、worker、来源时间、保存及验证边界。

以上产品修复按文件所有权交由原实现负责人执行，避免并行覆盖。审查者直接负责规范及最终检查，没有自动提交。

## 检查记录

| 检查 | 结果 | 证据与解释 |
| --- | --- | --- |
| 首次默认并发全量 | 1000 通过 / 2 失败，共 94 文件、1002 测试 | `/private/tmp/spatial-check-vitest.log`。referenceItems 测试读到中途旧实现；既有 background/crash 的 queued 子进程 10 秒边界超时 |
| 既有 crash 独立复核 | 5/5 通过 | `/private/tmp/spatial-check-crash-rerun.log`，单 worker；首次超时证据保留，不修改原测试计时或产品行为 |
| 完整受限并发全量 | 1012 通过 / 1 失败，共 95 文件、1013 测试 | `/private/tmp/spatial-check-vitest-final.log`，`npm test -- --maxWorkers=2`，309.02 秒。唯一失败为新业务时间断言 |
| 稳定树受影响补测 | 4 文件、48/48 通过 | `/private/tmp/spatial-check-final-affected.log`：spatial-source、spatial-contract-boundaries、spatial-map-ui、当时版本的 probe-spatial-evaluation |
| 评测器最终追加断言 | 13 测试通过 | 独立评测负责人通过主会话提供的结果；晚于上述 48 条收集，不能将当时的 10 条评测器测试描述为最终 13 条。其独立 typecheck/ESLint 也通过 |
| 最终 typecheck | 通过 | `/private/tmp/spatial-check-typecheck-final.log` |
| 最终完整 lint | 通过，含 Pi/browser 依赖边界 | `/private/tmp/spatial-check-lint-final.log` |
| 最终 build | 通过，6.45 秒 | `/private/tmp/spatial-check-build-final.log`。保留既有超过 500 kB 的 chunk 提示；未借此扩范围做分包重构 |
| git diff --check | 通过 | 包含规范文档变更 |

完整受限并发运行的唯一失败明确显示 source 实际只有旧字段 ref/revision/queriedAt，而新断言要求 effectiveAt/validTime。审查时记录的 353 文件哈希清单 `/private/tmp/spatial-check-final-manifest.json` 确认测试运行期间 inputs/shared contract/对应测试发生变更。稳定树补测已验证新字段及真实时间语义，不将此失败未经核验地归为随机噪音，也不宣称最后一次完整测试来自完全冻结的单一快照。

另有原生压缩、精确保存、来源权限、计算数值与 worker 边界的针对性检查由实现者及主会话运行。真实 SDK 压缩测试产生 latestCompaction，随后 read 固定 resultRef 并保存同一几何；不是以重启替代压缩验收。

## 浏览器证据

前端负责人在 `/private/tmp/spatial-browser-panel-final` 完成 6/6 桌面浏览器测试，包含中国/澳大利亚、三种底图、参考几何、绘制保留及定位可见性。最后把 localPanel.current 传参改为 callback ref state 后，在 `/private/tmp/spatial-browser-panel-confirm` 复核测量两例，2/2 通过（31.8 秒）。主会话另外实际查看宽屏 distance、窄屏 point_to_line 和保存/read 截图。

此处如实转述对应负责人及主会话证据；审查者没有重复占用浏览器槽位，也没有把这些测试描述为自己执行。自动化使用受控本地底图夹具，不据此声称完成新的公共瓦片连通性测试。

## 首轮报告独立核对

审查者以仓库保存的 216 条 `entry-reviews.json` 重算原评分、五维、保留集和组合结果，并对照 `root-measurement-audit.json`、首轮正文及本人负责的 D17/D18/H01—H06 共 72 条原始 review。导出 review 与原始 review 对象完全一致；原评分通过 A/B/C 为 48/60/56，五维语义全部通过为 34/43/40，原评分及五维共同通过为 30/42/37。配对改善/退化为 B 对 A 17/8、C 对 A 17/11。所有五维通过而原评分失败的条目均有单独勘误，未覆盖原评分。以上为独立统计复核，不声称重审了其他代理负责的 144 条原始对话。

本人负责的 72 条中，唯一关键错误为 H01-1-C：只分析请求中出现保存尝试，可信引用校验拒绝，未实际写入。共享 32 steps 契约歧义、H04 缺字段覆盖缺陷、D18 加载分母误标分别保留，不作为放宽总体门槛的理由。仅豁免术语歧义的上限亦未达到整体门槛。完整证据及各组报告见 `research/evaluation-v1/`。

## 首轮之后的有限修正复核

后端与评测负责人明确代码稳定后，审查者独立核对七个改动 TypeScript 文件。新结果输入消歧在权限重检之后执行；显式 geometry/items 选择保留固定快照，`read` 旧结果分支不受新计算输入限制。缓冲说明变更不修改算法或几何。原生循环测试验证同一次请求中收到可操作歧义错误后，使用原 resultRef 和 geometry:true 恢复，不重算、不保存。后端空间规范已同步。

稳定版本针对性检查：5 文件 **62/62** 测试通过（12.75 秒），覆盖 spatial-source、pi/spatial、spatial-contract-boundaries、spatial-math-oracles、probe-spatial-evaluation；完整 typecheck、lint/依赖边界及 diff --check 通过。日志为 `/private/tmp/spatial_check_v11_tests_authorized.log`、`spatial_check_v11_typecheck.log`、`spatial_check_v11_lint.log`。首次受限运行因 Vite 临时缓存写权限无法启动，零测试执行，原日志保留于 `/private/tmp/spatial_check_v11_tests.log`；授权后的同命令运行通过，未以修改源码绕过。检查对应七个差异文件哈希保存在 `/private/tmp/spatial_check_v11_verified_manifest.json`。本次未重复全量或浏览器测试。主会话随后运行新版本最终 build，通过（6.48 秒），审查者核对日志 `/private/tmp/spatial-root-v11-build.log`；保留既有超过 500 kB 的 chunk 提示。模型批次结束后再次核对七个差异 TypeScript 文件哈希，没有变化。

评分器现在接受先前已验证结果的显式生成几何，并拒绝未来、自身、被篡改及重复覆盖的引用；重复 read 只允许 delivery 变化，保持首次出现顺序。仍存在一个明确的评分限制：buffer B 的生成几何进入 R.items 后，再经 S 复用 R.items，S 的 scope 引用 R 而非直接引用 B，当前直接派生断言仍会误拒。已通知主会话及评测负责人，本轮限定修正未扩展传递识别算法；若出现该合法链必须独立勘误，不得单凭 raw critical 判为模型伪造。该限制不影响 D11 直接固定 buffer→filter 的预定补充验证。

## D11 第二轮聚焦模型验证

`/private/tmp/spatial-eval-20261016-v1_1-focused` 的 9/9 试次执行并由本审查者逐条独立审阅，sourceDrift=false。完整答复、两轮工具链、原始夹具和只读状态均核对；每条保留原 score 并写独立 manual-review，详见该目录 `review-focused.md` 与 `focused-independent-summary.json`。原程序通过 A2/3、B3/3、C3/3，五维完整语义通过 A2/3、B1/3、C1/3。九次均恰好生成一次缓冲并真实复用同一旧生成几何，但 A2 选错了外部车辆中心和外部候选集，因此正确用户基点及完整资源图层筛选为 A2/3、B3/3、C3/3。九次均无保存尝试、无实际写入、无关键错误；新增 Skill 分析前加载 A0/3、B3/3、C2/3。

独立核对使用原始夹具的点位置、R=6371008.8m 的 haversine 及二维射线包含判断，并将最后 filter 的参考几何与首次 buffer 全坐标比较；不由修正后的产品计算函数生成答案。A1 省略 geometry 后被新歧义校验拒绝并按提示同轮恢复。仍有选错对象、边界位置无依据叙述、错误额外距离/排序，以及把 truck 类别点数推为车辆运力缺口的问题。有限修正改善了显式结果选择，不能把机械几何复用视为任务整体可靠；本轮不改变 AC10 未通过结论。

## 尚待完成

- [有限修正](post-baseline-corrections.md) 的差异审查和针对性工程检查已完成；保留新旧版本与评测产物的边界。
- 两轮结果与全部失败均已保存；后续若改进模型方法或 Skill，需要另定开发/新保留集及新版本验证，不能以这 9 次替代完整整体及保留集验收。
- AC10 保持未通过；任务保持进行中。首轮精确源码及报告已经提交，不表示已经部署或合并主线。
