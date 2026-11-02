# 第一批独立审查记录

2026-11-02；审查角色：独立 trellis-check 子代理。审查基线为已批准方案提交 `2a5fd9f`；涵盖产品 diff、新资源契约、12 个开发样例、对应测试、任务 PRD/design/implement、check.jsonl 所列规范及新增 task-resources spec。未运行真实模型、未提交或推送。

## Findings (fixed)

1. `experiments/harness-lab/src/contracts/task-resources.ts`
   - 问题：`ResourceCoverage.status=partial` 原来强制要求 `nextCursor`，把局部业务覆盖等同于“尚有下一页”，无法表达来源只能覆盖部分资源且没有更多分页的情形。
   - 修复：经主代理明确授权，保留 `asOf`，要求 `nextCursor` 或非空白 `reason` 至少一个；完整结果禁止下一页，unavailable/unsupported 仍需原因。给 reason 添加非空白约束。
   - 回归：可续页 partial、无后续页但有局部覆盖原因的 partial、无原因且无游标、空白原因、complete 携带游标。
2. `experiments/harness-lab/fixtures/task-resources-v1/inputs.json`
   - 问题：S07 的 unknown-boat 同时给出明确单体/entityId 和未知实体数量，削弱“数量未知不能当零”的独立样例含义。
   - 修复：该记录改为 granularity=unknown，移除 entityId；保留数量 null、类别与单位。未增加“单体数量必须为 1”等产品约束。
3. `experiments/harness-lab/tests/task-resources.test.ts`
   - 问题：原权限测试先导入来源对象，草稿已经继承来源权限，不能单独证明新增 annotation evidence 带来间接来源限制；公开派生仅同席位验证；工具资源写入只验 schema。
   - 修复：新增独立空白草稿仅经 annotation evidence 继承权限、随后删除依赖对象仍保留限制的实际服务检查；新增已存在跨席位私有依据拒绝且无草稿/回执、所有资源 evidence 槽位公开裁剪、公开哈希与跨席位派生一致、关联保留和权限撤销检查。已有工具检查增加真正执行 annotation_action 并读取保存字段；S06 coverage alternatives 也通过来源解码器。

## Findings (not fixed)

没有发现尚未修复的本批范围内缺陷或需要改变公共接口的阻断问题。

- 查询默认范围执行、资源归并/数量合计、资源级空间结果和原生用户消息解析尚未实现；这是明确的后续批次边界，不计为本批缺陷。12 个 expected 只作为独立业务预期，当前离线检查不宣称已验证这些计算结果。
- 构建仍给出大于 500 kB 的 chunk 提示；与本批数据契约无关，未擅自进行前端拆包改造。

## Independent review evidence

- **声明与身份分离**：共享 resource schema 仅承载声明；add_layer/add_object/update_object 的普通输入拒绝 resourceAssociation。明确来源导入核对授权、精确来源与修订，来源 resourceData 只允许实际单体携带 entityId。旧 availableCount 不会自动转成受信单体；sourceRefs 和 originFeatureRef 不升级为实体证明。
- **生命周期**：源导入、普通编辑、copy_object、来源 refresh、固定基线和发布派生均沿用 AnnotationService。普通复制清除 association；编辑状态/位置保留固定关联，meaning/granularity/category 不兼容时清除。刷新不重写 resource 事实；来源身份缺失/汇总/变化全部拒绝，原修订与几何不变。
- **授权与隐私**：resourceEvidence 遍历顶层、quantity、availability、position、taskRelations；来源证据与关联加入单调 requiredSystemIds，固定标注依据走 accessible 同任务/席位权限和真实对象检查。公开投影同时用于公开读回、哈希和派生，替换私有依据而保留明确共享的声明值。源适配入口拒绝私有 annotation evidence 与跨系统来源证据。
- **严格契约与旧兼容**：类型、TypeBox schema、服务白名单和 Pi read fields 同步；原型污染、负数/小数、非法关系、单位不符、非法日期与空依据拒绝。资源字段缺省不注入；固定 legacy 样本 shape/hash 保持；已有 composer/history 测试通过。数据库、历史包裹版本和旧空间算法未变。
- **工具路径**：共享 resourceSchema 接入现有 action 的 $defs；SDK 参数校验及实际 action.execute 都保存资源声明，annotation_read 真实内容带回请求字段。未新增工具、Skill 或模型配置。
- **开发样例**：逐项审阅 S01—S12 的输入/独立预期；S01/S08 的受控导入指令是后续执行要求，不授权普通写入伪造 identity。S05 相同来源命名空间的明确 entityId 为合并依据；S06 覆盖与无覆盖分别交接；S07 未知数量保留；S10 完整空与不可用分开；S11 固定发布与后续草稿分开；S12 用户消息定位契约不认证自然语言或消息存在性。未用预期自证查询结果。
- **其他 diff**：provider-payload.test.ts 的旧字符串断言修正符合基线实际文案；直接检查 `git show 2a5fd9f:.../annotation-tools.ts` 确认该文案早已存在，产品文案未因此改变。此次不涉及平台配置/模板，未漏平台生成物。
- **规范同步**：主代理维护新增 task-resources.md 及 backend 索引/标绘/来源入口；已通知主代理同步 partial 覆盖修复，不修改其余文档所有权。

## Verification

工作目录：`experiments/harness-lab`。

- Lint：**pass**，`npm run lint`，含 Pi/browser dependency boundaries。
- TypeCheck：**pass**，`npm run typecheck`。
- Tests：**pass，9 文件 / 151 测试**，`npm test -- --configLoader runner tests/task-resources.test.ts tests/annotations.test.ts tests/annotation-results.test.ts tests/annotation-geometry.test.ts tests/annotation-edit-changes.test.ts tests/map-symbol-contracts.test.ts tests/pi/annotations.test.ts tests/pi/composer-input.test.ts tests/pi/provider-payload.test.ts`，20.78s。
- 新资源测试：**14 项**（原 12 项 + 2 项独立权限/公开派生测试）；12 个开发样例的契约数据通过实际解码，不等同 12 项端到端业务查询通过。
- Build：**pass**，`npm run build -- --configLoader runner`，6.54s。首次 `npm run build` 因 node_modules 指向另一工作树，默认加载器写 `.vite-temp` 触发 EPERM；改用 runner 避免越界写入后通过，未更改产品配置或申请扩大权限。
- `git diff --check`：**pass**。
- Desktop Playwright：本审查未重复运行；主代理已报告 3 项既有桌面标绘回归通过（独立草稿、紧凑面板隐藏字段、对象编辑保留默认字段，36.6s）。该结果由主代理持有，不计入独立 151 项测试。
