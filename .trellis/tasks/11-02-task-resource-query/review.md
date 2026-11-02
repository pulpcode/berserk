# 第二批独立审查与最终复验

2026-11-02｜审查角色：trellis-check｜实现基线 `ea30f46`，当前工作区修改｜未提交、推送或调用真实模型

已分段通读批准方案，检查任务 PRD/design/implement/check.jsonl、所列规范、tracked diff 与新增文件，以及 source-checks、pi-checks、offline-checks。实施者停止写产品后，由本审查统一修复。下列接口细化均经主代理确认，依据已批准的数量、固定结果、位置缺口和覆盖验收要求；未扩大到 Skill、模型设置、新交互或后续批次。

## 已发现并修复

| 文件 | 问题与修复 |
| --- | --- |
| `src/spatial/inputs.ts`、`contracts/spatial.ts` | 资源派生 buffer 按 `geometry:true` 再用时，原资源 itemIds 与生成面 ID 不一致，真实结果会被严格读取拒绝。生成几何继续携带来源/固定资料依赖，但撤去“它是资源实体位置”的统计资格；结构化 `resourceInput` 拒绝额外键。 |
| `src/spatial/service.ts` | 新资源输入曾把非 Point 候选在点面分类中转成未分类，偏离批准的非法类型报错要求。恢复原几何类型错误；缺少实际位置仍单列，不取中心点。 |
| `scripts/probe-spatial-evidence.ts` | 旧离线证据工具重建 source 集合时漏了新 `objectTypes` 条件；按完整类型范围匹配。该工具没有资源原生快照时继续明确不可验证，不发明证据。未重跑任何模型测评。 |
| `contracts/resource-summary.ts`、`resource-results.ts`、`context/task-resources.ts` | 资源结果原先只检查数量条目的 ID；同时改写 details 和模型正文中的数量仍可能通过。纯数量函数移到共享契约模块，服务与严格读取复用；按原固定统计时刻重新核对数量数组，避免维护两套算法。 |
| 同上及 `pi/task-resource-results.ts` | 连续统计可能按上次统计时间重新判断旧数量时效；空 data 查询再统计的默认关系口径也可能被错误校验。新增 `statisticsScope.at/relation/availability` 回显实际口径，时间沿原查询传递，原生 parent 链核对。统计不得改写原 records/items、覆盖或丢失原/空间依赖。 |
| `resource-results.ts`、`context/task-resources.ts`、`pi/task-resource-tools.ts` | D01 原检查靠测试代码人工筛选可用项，工具统计不能直接限定状态。summarize 增加可选 `availability`，与关系、位置条件组合；原有省略行为兼容。实际验证已分配、可用、内部为 1 辆。 |
| `contracts/resource-summary.ts` | 原覆盖去重仅看成员身份，可能删除不同数量含义或不同有效时间的已知事实。现在同类别、单位、含义、范围、时间及有效条件可比，且同来源有明确覆盖时才避免重复相加；过期汇总不能覆盖有效明细。 |
| 来源契约/适配链及 `context/task-resources.ts` | D22 “无下一页但业务仅局部覆盖”原无输入接口，翻完页一律记 complete。由来源代理补可选 `resourceCoverage` 与真实 HTTP 测试，本审查补多页/多段一致性检查和业务传播；partial 保留原因，不当完整空结果。旧响应省略该字段仍维持请求级完整语义。 |
| `resource-results.ts`、`context/task-resources.ts`、`pi/task-resource-results.ts` | 位置统计原只留文字限制，全部缺位置时可能返回确定实体 0。统计结果现在保留 `spatialCoverage` 和未分类 ID/原因；有未分类时实体总数为 null，已知项数仍保留。再次统计继续保留缺口，原生核对真实空间结果。 |

### D06 测试口径纠正

历史输入是“站点可用量 3 辆”和“单车实体量 1 辆”。旧测试额外断言有覆盖时不允许出现任何数量 1，这比“不得重复相加为 4”更强，也会删除不同含义的已知事实。现保留 3 辆 available 与 1 辆 entities 两组，不求一个合计；原输入/expected 文件未修改。另加同义同时间有效覆盖、缺覆盖、覆盖已过期三个正反例，避免仅放宽断言。

## 实际验收证据

| 范围 | 复核内容 |
| --- | --- |
| D01—D12 | 实际业务/Access/Annotation/本地 HTTP，第一批独立输入；默认范围、受控归并、未知/冲突、数量含义及固定采用版。D12 验证用户原文与消息身份，不冒称理解自由文本准确。 |
| D13—D17 | 来源类型在分页前筛选；分页及同来源跨段快照变化；D15 五例无任务接口与可选任务/支援能力；撤权和会话身份；跨系统实体、复制、过期和条件状态。 |
| D18 | 实际资源 Q→空间服务分类、nearest/filter 后续、计划/估计/站点/冲突/缺位置，非法 Point 类型拒绝；生成范围复用保留依赖但不充当资源位置。孔算法有独立坐标预期，未扩展单环标绘/HTTP摄入契约。 |
| D19 | 真实 Q/S 对应、错误 Q 拒绝、位置与关系/状态组合、不同单位/含义分列、partial 位置统计总数未知。 |
| D20 | 原始成功调用、参数/details/正文/归属/delivery、重复引用；新数量同步篡改拒绝；parent 固定统计时间、范围、记录和依赖核验；原生压缩/重启。 |
| D21 | 实际 HTTP 来源变更、草稿和任务采用版变化后，旧结果不变、新 query 读新版；真实 Pi 两页 read 保留原清单/统计，页码/总量准确。不是仅测试 Array.slice。 |
| D22 | 501 原始记录、50 页、1 MiB 查询、途中取消；partial 末页及原因传播。没有真实模型请求。 |
| D23 | 当前分支真实 user 与明确资源选择；助手、摘要、其他会话、未绑定的后续消息不冒充证据；真实 quote 不认证模型转述，不写来源或草稿。 |
| D24 | 真实 Pi 确定性 query→classify→summarize→read，旧 v1/v2、source/classification/contract/composer 回归，精确保存与公开依赖/私有定位检查。桌面回归由主代理独立执行。 |

## 最终检查

以下命令均在 `experiments/harness-lab`，最后一轮产品与测试已冻结：

- `npm run typecheck`：通过。
- `npm run lint`：通过，包括 Pi/browser dependency boundaries。
- `npm run build -- --configLoader runner`：通过；只有既有 Vite 大 chunk 提示。
- `git diff --check`：通过。
- 最终统一 Vitest：**13 个不同文件、226/226 通过**。11:31:49 开始，24.85 秒。临时 localhost HTTP 获准执行；provider 为确定性替代，无真实模型。

```sh
npm test -- --configLoader runner \
  tests/context-resource-query.test.ts \
  tests/context-http.test.ts \
  tests/context-cli.test.ts \
  tests/task-resource-query.test.ts \
  tests/task-resource-spatial.test.ts \
  tests/task-resources.test.ts \
  tests/spatial-source.test.ts \
  tests/spatial-point-classification.test.ts \
  tests/spatial-contract-boundaries.test.ts \
  tests/pi/task-resource-results.test.ts \
  tests/pi/task-resource.test.ts \
  tests/pi/spatial.test.ts \
  tests/pi/composer-input.test.ts
```

其中来源专题包含最新版 12 项及既有 HTTP 14、CLI 1。资源业务专题 37 项、空间资源专题 15 项；其余以统一 226 分母为准，不与此前 99/24/33/55 或重复运行相加。主代理的 4 项桌面回归另见 desktop-checks.md；本审查没有重复启动浏览器或占用相同端口。

### 审查期间的首次失败保留

- 一次追加测试用了相对根路径，但命令工作目录已在包内，文件未写入；更正路径后实际新增回归。一次 npm typecheck 误在仓库根执行 ENOENT，随后在包内执行通过。均不是产品测试结果。
- 新 partial 业务测试的模拟 Response 漏 `content-type: application/json`，首轮 4 文件 69/70，明确收到“来源未返回 JSON 数据”；修正夹具头后测试通过，未放宽产品 HTTP 校验。
- 增加位置覆盖传递前的统一 13 文件也曾 226/226；它是中间版本证据，最终状态以上述 11:31:49 一轮为准。

## 未修项和边界

未发现需要阻止本批交付的剩余缺陷。下列是明确范围限制，没有通过本次审查偷偷扩展：

- 真实来源部署、非 identity 任务映射、其他支援规则仍需后续适配；本批没有证明外部系统已全量接入。
- 消息引用可核实不等于自然语言理解已正确；Skill、真实模型效果与新交互属于后续批次。
- 孔面算法可用不等于现有标绘/来源摄入支持孔面；保留原不支持错误。
- 数据读取、任务关系、位置覆盖分开；已知数量和实体项不构成现实任务全集、批准调配或实际可用的保证。
- 本轮未运行整个仓库的所有测试；运行的是列出的受影响 13 文件和主代理 4 项桌面回归，不能把它表述为全仓测试通过。
