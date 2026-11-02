# 第二批资源查询与空间衔接：离线检查

日期：2026-11-02。这里记录确定性程序检查，**不是模型测评，也不是 Agent 正确率**。未调用真实模型、未修改 Skill 或模型配置、未提交或推送。

## 本批实现

- 新增资源查询服务与共享结果契约。`task_resource_query` 的 query/read/summarize 使用实际来源、固定标绘和 Pi 原生结果；不建第二套结果库。
- 基础来源读取不带平台任务 ID。可选的任务发现要求配置已实现的 identity 映射；支援要求 explicit-task-relation 规则。缺配置记入关系覆盖，不影响正常基础取数。
- 按来源实体身份及受控导入关联归并，保留不同记录；同名、普通引用、相同内容 hash 不建立实体等同。跨系统实体总数不能自行确认。
- 记录数、可核实实体数和数量分别返回。数量保留类别、单位、含义、范围与时间分组；knownValue 表示已知部分，unknownCount 表示未知或不可合计记录，value 不伪造完整总量。
- 当前任务默认范围使用平台明确引用及结构化关联、当前绑定草稿/基线和采用发布版；无关联不扩大到全部来源扫描。消息原文由原生分支与明确引用核实，解释仍标为待核验。
- 空间工具增加 kind:resource，结果数据版本 3 保留完整候选、可计算对象和未分类位置。原 v1/v2、Turf 算法和旧结果正文保持兼容。
- 统计核对空间结果的候选资源 Q，不能把仅作为参照目标的 Q 冒充候选；派生统计继承目标区域等依赖。已有显式保存精确复用几何并携带来源权限，不写私有资源定位到公开对象。

## 实际检查结果

本表保留实施阶段记录。独立审查修复后的最终结果为 **13 文件 226/226**，typecheck/lint/build/diff 全通过，见 [review.md](./review.md)；不可把本表较早命令作为最终版本。

命令工作目录均为 `experiments/harness-lab`。测试/构建使用 `--configLoader runner`，没有向共享 node_modules 写缓存。

| 命令 | 本次结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `npm run lint` | 通过，含 Pi/browser dependency boundaries |
| `npm run build -- --configLoader runner` | 通过；仅 Vite 现有大 chunk 提示 |
| `npx vitest run --configLoader runner tests/task-resource-spatial.test.ts tests/spatial-point-classification.test.ts tests/spatial-source.test.ts tests/task-resources.test.ts tests/pi/task-resource-results.test.ts tests/pi/task-resource.test.ts` | **6 文件，99/99 通过**；11:22:10 开始，20.26 秒 |
| 来源基础与 HTTP 回归 | **24/24 通过**，详见 [source-checks.md](./source-checks.md) |
| D01—D18 真实业务/HTTP 服务 | **33/33 通过**，详见 [source-checks.md](./source-checks.md)；最新整包复核由独立检查统一报告 |
| Pi/native 与既有空间/composer | **55/55 通过**，详见 [pi-checks.md](./pi-checks.md) |
| 桌面历史/空间回归 | 由主代理独立执行，结果见 [desktop-checks.md](./desktop-checks.md) |

不同命令有重叠文件，不能把 99、24、33、55 简单相加当作独立样本。最终整包数量以主代理/独立检查报告为准。

## 24 组验收如何对应

| 范围 | 证据 |
| --- | --- |
| D01—D12 第一批独立业务样例 | `task-resource-query.test.ts` 读取既有 inputs/expected，经真实 HTTP、Access、Annotation、资源与空间服务；没有修改原始独立预期来迁就实现。细目见 source-checks |
| D13—D15 来源类型/分页/无任务接口五分支 | context-resource-query、context-http、task-resource-query；明确数据条件与任务关系分离 |
| D16 权限、D17 身份和时效 | task-resource-query、task-resource-spatial、Pi task-resource；重检任务/席位/会话/来源和固定标绘依赖 |
| D18 缺位置及空间分类 | task-resource-query 与 task-resource-spatial；内/边/外独立坐标、缺失/计划/估计/站点/冲突位置；后续 nearest/filter 保留缺口。既有 point-classification 检查孔和边界算法；不声称标绘接口已支持带孔面 |
| D19 统计对应 | task-resource-spatial 核对 Q/S 及内/边/外分组，另一 Q 的 S 拒绝；task-resource-query 验证单位/含义/未知与任务关系口径 |
| D20 历史真实性、D21 固定读取分页 | Pi 原始调用/正文/details/delivery/参数/分支/压缩/重启检查，及资源投影仅含当前页记录；resource/spatial 共享严格契约 |
| D22 边界和取消 | task-resource-spatial 新增 501 条、50 页、1 MiB、中途取消；超限不返回截断成功全集。不可用或未知覆盖仍保留限制，不伪装完整零结果 |
| D23 用户消息 | Pi 真 user/当前分支/composer 选择正反例，业务核实原文及资源关联；不将自由文字语义认证为来源事实 |
| D24 全链兼容 | 确定性 Pi query→classify→summarize→read，已有保存/publication 权限检查，旧空间/B1/桌面回归 |

实施阶段资源空间专项的 11 项检查含（最终已扩为 15 项，见 review.md）：5 候选中 3 项分类、2 项未分类；nearest 及下一次分类保留缺口；错误 Q/S 拒绝；全部缺位置不计外部；契约/正文/数量/依赖篡改拒绝；查后撤权；精确保存与公开版本不泄私有定位；取消和错误会话；4 类运行边界。

## 首次失败记录与修复

以下记录用于交接，失败未算作通过；修复后重跑不累计样本。

1. 最初类型检查发现资源请求 union 的 read 不可能比较分支，移除无效比较。新空间 union 导致旧 probe 与 AnalysisPanel 缺 resource 分支，以及 shared decoder 的 unknown 类型收窄问题；补兼容后通过。
2. 首轮 3 文件 62 项：59 通过、3 失败。2 项为真实资源结果被严格 decoder 拒绝：数量分组临时 key 不应挂在结果对象上，即便不可枚举；改为外部 Map。1 项为测试 publish 漏 title，补齐现有必填参数，未放宽接口。空间专项随后 7/7 通过。
3. 业务首轮 30 项有 5 项失败，原因、产品修复及测试入口纠正见 source-checks；最终 33 项通过。空任务实体数改为 null，保留已知空名单与“实际未知”限制。
4. 并行编辑期间短暂把 query 参数校验插入 authorize，类型检查暴露 request 未定义；移回 query 后类型检查通过。
5. 一次组合测试中，本子代理环境禁止 localhost 监听，31 项因 `listen EPERM 127.0.0.1` 失败；没有解释为业务失败或通过。来源代理通过获准本地监听实际跑完 33 项。另 2 个 Pi fixture 因空任务 entityCount 旧值不符合新契约被拒绝，按实际未知语义改为 null，未放宽真实性校验。
6. D22 页数夹具首次使用“空页但有后页”，先被已有 HTTP 契约拒绝，未触达 50 页上限。改为每页 1 个有效对象后实际触达页上限；最终 11 项专项通过。
7. 最终记录的 6 文件 99 项全部通过。类型/lint/build 与独立最终回归仍由主代理汇总，避免并行阶段旧命令冒充最新全部状态。

## 仍需明确的限制

- 这里只实现 identity 任务映射与明确来源关系规则；真实来源其他映射/支援规则需要实际适配，不能只填一个配置名。
- 用户补充可证明“这句来自当前 user 且带该资源引用”；不能证明模型对自由文字的解释正确，不自动改来源或草稿。
- 数据覆盖、任务关系覆盖和可计算位置是三种不同限制。记录完整读取不能称任务资源全集；位置可计算也不能证明已分配或可用。
- 状态逐项在 items 中保留；独立审查已补 summarize 的 availability 筛选、statisticsScope 固定时刻/实际范围、spatialCoverage 未分类缺口及数量共享重核验。模型仍不能把已知数量说成批准调度量。第三批 Skill 与第四批模型测评尚未开展。
