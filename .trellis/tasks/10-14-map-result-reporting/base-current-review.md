# 草稿基线与任务当前：独立代码审阅

日期：2026-10-15。审阅角色：trellis-check。基线：`4c84f4f`，本轮范围以 [base-current-followup.md](base-current-followup.md) 为准。

结论：代码审阅未发现阻断问题，可以冻结材料并按既定数量进行真实场景复测。此结论仅覆盖实现与确定性验证，不代表模型已经不再混淆基线和任务当前。

## Findings (fixed)

- File: `.trellis/spec/backend/map-annotations.md`
- Issue: Tests Required 段仍描述新请求和取消准备为 v3，与本次已经更新的 v4 测试不一致。
- Fix: 同步固定 v1/v2/v3 样本、v3/v4 严格检查、v1/v2/v3/v4 混合历史、v4 取消准备和无 Skill 关键说明可见性。仅文档修正，未改产品或测试。

## Findings (not fixed)

无尚未修复的代码问题。以下为验收边界而非待修缺陷：

- 规则仍由模型解释执行，成功投放说明不能证明模型回答正确；三条原协同链必须逐条审阅全部可见文本。
- 历史助手错误不会被此修改删除；新说明要求历史回答不能代替本次查询。未新增自动事实校验、状态注入或强制查询。
- 真正的采用成功只证明提交时状态；旧动作查询和 `replayed:true` 不提供实时采用依据。工具说明已表达该边界，执行逻辑未改。

## 审阅证据

- 对比完整产品与测试 diff，产品仅新增 v4 文本/版本路由、历史显式识别及工具描述。未改 Skill、业务驱动、HTTP/DTO、服务、RequestState、权限、模型配置、UI 或 Pi 循环。
- 从 Git `4c84f4f` 取出 v1/v2/v3 生成器函数，逐字与工作区比较，三者一致。再直接执行基线 v3 生成器，对新固定 fixture 的两份文本分别比对，均完全相同。不是只相信 fixture 的 baseline 标签。
- 将 annotation-tools.ts 的 description 字符串归一化后与基线全文比较，完全相同；唯一 schema 变化是 baseRef 的描述元信息，没有新增参数、改变验证形状或执行路径。
- 核对 `PiLab.start` 自动产生 annotationContext、发送原生 composer input 的路径，及实际 fake-runtime 捕获请求的断言。无显式 Skill、readSkills 为空、无工具调用时，基线/草稿修订/草稿编辑权限/当前状态未提供说明以及工具证据规则均已送入模型。
- 核对两条历史读取路径：composerHistory 保留前缀筛选后严格版本解码；validateHistoryEvidence 显式加入 v4，未知版本、身份、顺序、重复、正文一致性、容量、Skill 快照与只读子任务限制保留。
- 测试同时覆盖固定旧样本、新旧混合历史重开并追加 v4、取消准备后继续、无 Skill 投放、自动上下文不随对象数量膨胀、管理与普通席位描述/schema 一致。

## Verification

- Lint: pass，审阅代理独立运行 `npm run lint`，包含依赖边界检查。
- TypeCheck: pass，审阅代理独立运行 `npm run typecheck`。
- Tests: pass，采用实施代理已完成的 11 文件、143 个不同用例结果；本次仅修正文档，未重复运行已经通过的产品测试。首组 4 个本机监听权限受阻用例在获准环境中按原用例通过，详见 [实施记录](base-current-implementation.md)。
- Build: pass，采用实施记录；本次无构建输入变化。
- Baseline compatibility: pass，独立比较三个历史生成器源码及两份基线 v3 固定输出。
- Diff check: pass。

本审阅未执行真实模型、提交、推送或部署。真实复测与语义审阅结果另见后续验证记录。
