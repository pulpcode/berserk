# 实施审阅

2026-10-15。审阅默认A实现、两个新增取证驱动和确定性测试；本审阅未调用真实模型、提交Git或部署。B隔离构建及真实批次由主会话冻结和验收，不能从下面的确定性检查推导模型解释正确。

## Findings (fixed)

- File: `experiments/harness-lab/src/pi/annotation-tools.ts`、`tests/pi/provider-payload.test.ts`、`tests/probe-map-query-scope.test.ts`
  - Issue: 新说明错误地把对话引用的互斥范围契约套用于读取参数。实际 `readInput`/`service.read` 接受图层和对象筛选的交集；指定对象不在指定图层中才失败。
  - Fix: 单独定义读取参数说明，保留 `annotationSelectionSchema` 原契约及所有验证约束；说明交集和失败边界。实际服务测试覆盖合法交集、图层外对象拒绝及引用仍拒绝双选择。主会话同步修正方案和驱动检查，未改变服务行为。
- File: `experiments/harness-lab/scripts/probe-map-query-scope.ts`、`tests/probe-map-query-scope.test.ts`
  - Issue: 原诊断测试只检查内存Context，不能证明SDK最终传给提供方的内容与工具限制。
  - Fix: 导出仅测试驱动使用的 `diagnosticRuntime`，补充真实标注服务→真实工具适配→诊断Context→公开SDK→假fetch的完整检查。核对读取参数及tool-call对应关系、实际结果逐字保留、没有可调用工具、没有隐藏备注/评分数据/凭据、DeepSeek模型配置和thinking disabled保持一致。这里的假回答只验证传输，不作为模型语义证据。
- File: `experiments/harness-lab/src/pi/annotation-tools.ts`、`tests/pi/provider-payload.test.ts`
  - Issue: 审阅修改中一度用对象展开附加说明，丢失TypeBox的Optional元数据，导致真实Pi调用验证失败；provider回归检测到了该问题。
  - Fix: 改回显式 `Type.Optional(Type.Array(...))` 构造，增加实际provider schema中layerIds/objectIds/fields仍非必填的断言。失败发生于冻结前的确定性检查，没有真实模型调用。

## Findings (not fixed)

没有尚未修复的产品代码阻断项。以下属于待主会话完成的交付边界，不在本审阅中冒称通过：

- 候选B构建的单独差异与实际payload核对、原场景及固定99次案例的模型语义审阅仍需执行。默认产品A没有scope，counts没有改名；候选收益须按既定门槛独立判断。
- `.trellis/spec/backend/map-annotations.md` 与 `agent-scenario-validation.md` 需由主会话按最终实现同步：读取交集与引用互斥区别、必做工具契约、固定次数与诊断非自主性质；不能把候选scope写成默认已采用。

## 核查结果

- 默认产品改动限于工具说明和参数description，保持服务、HTTP、content/details、格式v1、自动输入v5、CAS、权限及回执行为。
- 受控Q的assistant/tool历史明确标记为测试驱动执行，来自真实适配结果；没有评分答案、完整未读文档或后续工具能力，不能称自主决策证据。
- H01–H03的问题、业务数据与固定预期匹配已审阅文件；未把预期答案放入模型输入。G02-order只改图层顺序，层内坐标与内容保持原夹具。
- `querySchedule`固定45项：30业务、15受控诊断，加原54业务合计99案例；每例3次、配对顺序A/B→B/A→A/B正确，无失败补跑入口。新的隔离目录拒绝覆盖旧尝试。
- 读取结果/状态相等及写入尝试检查只证明结构与副作用边界，正文仍待逐条独立审阅，不按关键词自动判语义通过。

## Verification

- Lint: pass（含Pi/browser依赖边界）。
- TypeCheck: pass，最终完整检查通过。
- Tests: pass，9文件72个不同测试；最终完整批次全部通过。
- `git diff --check`: pass。

初次本地fixture测试因沙箱禁止127.0.0.1监听出现EPERM；获准运行本机隔离测试后通过。其余早期校验失败及修复如上保留；没有把这些准备/确定性失败算成模型答复错误。

## 主会话收尾核对

上述当时待完成事项已执行：默认规范已同步，B仅隔离一行scope差异，354文件冻结前后一致，97次实际案例已完成审阅。确定性检查通过不代表语义全通过；完整结论见validation.md。scope未达到采用门槛，默认不采用、未部署。H01暴露的数据归属歧义与额外答复错误已分别记录，不改题补跑。
