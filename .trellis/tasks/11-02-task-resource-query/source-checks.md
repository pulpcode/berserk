# B2-01 来源查询链路检查

日期：2026-11-02。范围：基础 HTTP 筛选和可选任务/支援查询，不代表第二批全部验收或模型正确率。没有调用真实模型，没有提交或推送。

## 修改与接口交接

- `contracts/context.ts`：`SituationQueryParams.objectTypes` 支持 road/resource/area；增加内部可选 `taskId/relation/category` 条件。
- `context/config.ts`：来源可选 `resourceCapability`，旧配置保持不变。能力必须属于该来源且只允许态势适配器配置。缺任务映射或支援规则不拒绝整个配置。
- `context/validation.ts`：严格校验条件；任务/关系/类别查询仅 current 模式，关系条件须带任务 ID。返回值不满足所请求类型、任务关系或类别时明确拒绝，不能当作查询成功。
- `context/service.ts`：新增 `queryTaskResources(scope, principal, signal?)`。返回普通 `ContextQueryResult`，数据为 current 快照；每页 100 条，`scope.cursor` 续页。基本引用或类型查询仍走 `query('situation_query', ...)`，不需要任务 ID。
- 可选任务发现只支持显式 `taskIdMapping: "identity"` 加 `filters: ["task", ...]`；按关系查询还需声明该关系。支援筛选要求已实现的 `supportRule.id: "explicit-task-relation"`，只读取来源已声明的该任务支援关系，不按距离或名称推断。类别筛选须声明 category 能力和对应类别。其他映射/规则明确不支持。
- `scripts/mock-context/server.ts`：同样实施能力检查，在分页之前执行类型、任务、关系和类别过滤。测试驱动可注入 `situationObjects` 和 `resourceCapability`，提供来源事实而非预置业务结论。
- `pi/context-tools.ts`：普通 `situation_query` 公开 objectTypes 及其分页前筛选语义；任务关系发现交给第二批业务工具，不在普通工具中增加新的意图规则。

主业务服务可通过 `ContextService.config.systems` 读取受控能力配置。调用仍须原有席位或服务主体，未授权时先拒绝，不发送 HTTP。需要自选分页大小或精确引用条件时，可直接调用 `query`，使用同一能力门控；wrapper 不另建查询状态。

## 检查结果

所有 npm 命令目录为 `experiments/harness-lab`。

| 检查 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `npx eslint src/contracts/context.ts src/context/config.ts src/context/service.ts src/context/validation.ts src/pi/context-tools.ts scripts/mock-context/server.ts tests/context-resource-query.test.ts` | 通过 |
| `node scripts/check-boundaries.mjs` | 通过 |
| `npm test -- --configLoader runner tests/context-resource-query.test.ts tests/context-http.test.ts tests/context-cli.test.ts` | 3 文件、24 项全部通过 |
| `git diff --check` | 通过 |

新增 9 项检查包含：无能力精确读取兼容；30 条无关区域与 26 条资源混合时类型过滤先于分页；分页条件改变拒绝旧游标；变化查询类型筛选；非法或矛盾条件；来源实际任务/支援/类别筛选；缺映射/规则时基础读取保留；来源 HTTP 独立拒绝未声明能力；响应违反筛选条件被拒绝；授权与目录不泄漏。多项断言合并在各场景中。

## 首次失败与处理

1. 首次误在仓库根目录运行 typecheck，因根目录没有 package.json 报 ENOENT。改在实际包目录运行后通过，不涉及代码失败。
2. 普通沙箱首次执行 HTTP 测试，20 项因 `listen EPERM 127.0.0.1` 失败，另 3 项通过。申请本地临时 HTTP 监听权限后运行相关 3 个文件，24 项全部通过。没有访问真实模型或外部服务。

## 边界及后续

这里只证明数据获取和可选来源关系筛选实际可用。D15 的平台引用、默认范围、关系覆盖、缺关联不报零，以及资源汇总/空间衔接，由主业务实施与检查报告共同验证。类型过滤不能证明来源真的覆盖全部任务；分页完成也不能宣称全任务资源完整。

当前只实现受控的 identity 映射及显式来源支援记录规则。真实来源的其他映射和规则需要后续适配，不能仅改配置宣称已支持。现有生产配置未自动启用资源关系查询。

## 追加：D01—D18 独立业务验收

新增文件：`experiments/harness-lab/tests/task-resource-query.test.ts`。本代理只编辑该测试和本记录；发现的产品问题交主实施修复。

最终命令：`npm test -- --configLoader runner tests/task-resource-query.test.ts`，**33/33 通过**，2026-11-02 11:19 本地执行，10.27 秒。采用获准的临时 localhost HTTP 监听，无模型调用。前一次完整运行 30/30，通过后新增 3 个身份/快照用例及空间后续断言；最终统计使用 33 项完整运行，不拼接分母。

测试读取第一批 `fixtures/task-resources-v1/inputs.json` 原始数据，与 `expected.json` 独立业务预期对照。任务 ID 替换为实际 AccessStore 创建的任务 UUID；第一批受控导入经真实 `AnnotationService.fromSource` 建立身份，再按输入修改声明。来源服务器返回原始 SituationObject、按请求条件分页，绝不返回 ResourceResult 或预设结论。任务查询、标绘、授权、持久化和空间分析使用实际服务。

| 组 | 实际覆盖 |
| --- | --- |
| D01 | 默认任务读取、来源/受控导入归并、5 项资源与排除提示、实际位置分类、已分配且可用 1 辆、支援/未知/故障/缺位置分别保留；最终结果契约有效 |
| D02 | 原标绘读取 4 个普通点，不强制资源声明或新工具 |
| D03 | 跨来源同名不合并，2 条记录但实体总数未知 |
| D04 | 普通来源引用不产生受控身份、不继承可用状态；补充资源声明后仍与来源分列 |
| D05 | 同实体两份状态冲突保留两份依据，实体一次、可用 0；不同依据的相同数量仍为 1 艘 |
| D06 | 明细有/无覆盖关系分别检查；不相加成 4；站点位置不作为车辆位置 |
| D07 | 已知 2 辆、已知 1 艘、未知 1 项分别保留；使用 knownValue/unknownCount 表达，整个船组 value 仍未知 |
| D08 | 计划位置保留资源，但列为未分类，不判区域外 |
| D09 | 登记地区 A 筛选与实际位置在外独立成立 |
| D10 | 完整空来源与不可用来源分列；任务实体总数未知 |
| D11 | 采用他会话固定发布版，后续原草稿改动不影响采用版读取 |
| D12 | 保留 user 原文与报告时间内容，明确未认证解释；拒绝 assistant 作为用户消息；来源和草稿未写入。自然语言理解不在离线断言中冒充已验证 |
| D13 | 120 条无关区域与 120 条资源混合；类型过滤先于 2 页读取，缺几何无关项不污染资源结果 |
| D14 | 分页版本变化、重复游标、同 ID 内容变化、精确对象缺失；以及同来源分段精确读取发生快照变化，全部撤去不一致来源记录，不形成确定合计、不重试 |
| D15-a | 平台明确引用 R1，来源无任务能力，仅发送精确对象条件；相关不升级为已分配 |
| D15-b | 明确来源的两项资源关系未知仍进入真实空间分类；数据覆盖与关系覆盖分开 |
| D15-c | 缺全部关联不扫描来源，不声称任务已分配零项 |
| D15-d | 明确数据范围保留 R1/R2，仅 R1 平台相关；两者都不升级已分配 |
| D15-e | 有 identity 映射/支援规则时实际按任务发现；缺映射不调用；缺支援规则不认支援；基础精确读取持续可用 |
| D16 | 查后撤权、跨任务/席位/无绑定、另席位私有草稿；authorize、summarize 和空间使用拒绝。Pi 原生历史/送模链路由主实施另测 |
| D17 | 同来源实体归并、普通复制失去关联、跨系统相同 entityId 不合并、到期与有条件状态不冒充可用；不同 set 相同内容 hash 不合并记录 |
| D18 | 实际服务判内/边/外；缺失、计划、估计、站点和冲突位置共 5 项未分类；后续 filter/nearest 保留缺口，非法标绘几何组合拒绝。孔内/孔边用真实查询所得资源位置送同一 classifyPoint 算法检查独立坐标预期；**不宣称标绘或来源 HTTP 已接受带孔面** |

### 业务首轮失败及修复归属

首次 30 项运行：25 通过、5 失败，均保留如下记录：

- D01：业务清单及分类通过，但 `resourceResultValid` 拒绝真实结果。主实施移除数量分组对象上的额外隐藏 key，使用外部 Map。
- D07：原断言要求船组 `value:1`，会与同组未知数量冲突。主实施已增加 `knownValue:1/unknownCount:1/value:null`；测试按已知与未知独立语义检查，没有把未知当零。
- D10、D15-c：没有完整资源/关联资料时实体总数返回 0。主实施修为未知，保留已知空名单与限制。
- D18：测试试图把带孔面写入现有仅支持单环的标绘，属于测试入口错误。改为单环真实服务验收，加同一空间计算库对真实查询资源的孔内/孔边独立测试；未扩张产品标绘接口。

初次测试文件还出现坐标 tuple/几何联合类型、未使用 import 等编译问题，已在测试中修正；summarize relation 字面量类型推导缺陷交主实施修正。最后完整 33 项全部通过。

业务文件定向 ESLint 与 `git diff --check` 通过。业务最终 typecheck 首次遇到主线并行编辑的 `context/task-resources.ts:67` 引用未定义 request；主实施已修复，该次不是业务测试失败。移交时已启动复查，最终全包质量门由主代理独立检查统一记录。

## D22 复核修复：分页结束不等于业务覆盖完整

独立审查发现，旧 current 响应只能表达是否还有下一页，缺少“本站仅覆盖部分登记资源”的声明。本次在来源层补齐，不增加模型调用。

- `SituationCurrent.resourceCoverage?: {status:'complete'|'partial', reason?:string}`。`partial` 必须给非空原因，最长 1000 字符；未知状态、多余字段、错误类型明确拒绝。省略保留旧响应形状，仅沿用请求级读取完成语义，不推断全任务完整。
- 字段仅用于 current 响应，changes 不扩展。Mock 可注入同名覆盖声明，所有 current 页和无下一页的末页保留原值；空结果也可同时标记 partial。
- `context/service.ts` 无需变更：现有 HTTP 校验后原样传递。跨页/跨段一致性与业务结果传播由独立审查代理在资源服务中实施，单独记录。
- 新增 3 项测试覆盖实际 HTTP 多页 partial、末页无 cursor、空 partial、显式 complete、旧响应省略兼容，以及严格解码错误和 changes 拒绝该字段。

命令 `npm test -- --configLoader runner tests/context-resource-query.test.ts tests/context-http.test.ts tests/context-cli.test.ts`：**27/27 通过**，3 文件，2026-11-02 11:26 本地运行，3.48 秒。定向 ESLint 与 diff-check 通过。没有重跑真实模型或更改测试预算。

本次 D22 来源层完成后 `npm run typecheck` 通过。
