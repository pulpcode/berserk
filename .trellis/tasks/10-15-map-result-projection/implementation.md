# 地图结果投影实施记录

2026-10-15。用户批准修订方案后实施；基线 `efe2fb6`。产品实现及确定性检查完成，原54请求与新3只读请求复测已完成，整体说明与泛化门槛未通过。未推送、部署；最终验收以 validation.md、semantic-review.md 为准。

## 实现范围

详见 [产品实现记录](product-implementation.md) 和 [独立审阅](review.md)。模型接收必要业务结果及原查询参数；原始成功回执经 Pi details 进入实时/历史界面，继续生成既有地图入口。只移除已知标注元信息 hash，保留业务属性同名字段、固定引用和恢复数据。新地图输入 v5 保留旧版本兼容与基线/current 关键说明，未引入新审核流程、MCP、自动全量查询或回答改写。

## 验收材料适配

- 原 `scripts/probe-desktop-map.ts` 初始仅适配 A01 的来源回执取证，首批后补充 C01 的取证解析适配（见下）：新消息读取 annotationResult.receipt；明确拒绝的 null 或缺失新结构不回退凑成功；旧 plain JSON 仍可读取。原业务输入、顺序、权限、数量和断言不变。
- 原 `scripts/probe-map-workflow.ts --recovery`、其业务输入和来源夹具保持不变。
- 新 `scripts/probe-map-result-projection.ts` 复用既有隔离账号、HTTP、会话与 ask/mapState 助手。一个环境、三个独立会话、每例一次；固定“仓储设施”5个对象、“维修设施”2个对象；全部对象真实保存备注、几何和样式。
- G01 查询维修设施图层；G02 查询仓储设施第4～5项；G03 查询北仓的名称、类型和样式。只读前后完整持久状态对照。实际调用未覆盖对应边界时记为未覆盖，不能因文字看似合理算通过。
- 新驱动拒绝重试/选例参数，语义检查始终留待离线审阅。首次零模型准备通过，未改用例迎合模型。

## 检查与冻结

- 160 个不同确定性用例通过（实现者157 + 主会话新增只读驱动2 + 新旧 compare 取证1）；独立检查59项与上述覆盖重叠，不重复相加。
- 16 个桌面 Playwright 用例通过；包括新旧回执、真实原生执行流经 SSE 到界面的发布入口、刷新和固定版本。
- typecheck、lint、build、diff check 通过。真实批次之前的沙箱本地监听 EPERM 和产品开发期间夹具/断言修正见产品记录；首批后的驱动取证及测试修正另见下文。
- 冻结350个 src/fixtures/scripts/tests/dist 及顶层配置文件：`.local/map-result-projection/implementation-freeze.json`。真实批次期间不修改这些文件；每批结束核对，报告文档和离线分析不作为模型输入。
- Node v24.14.0，既有 DeepSeek 端点，配置模型 deepseek-flash。实际 thinking/max_tokens/stream/temperature 以捕获的 provider 请求再核对，不通过配置名推测。
- 四组零模型准备共11个环境全部通过，provider调用均为0，见 `.local/map-result-projection/preparation-results.json`。

## 证据规则

真实调用沿用已获得的虚构隔离数据授权。完整输入、工具 content/details、全部可见回答、截图和独立存储保存在 `.local/`，不记录凭据。原45请求与旧基线直接对照，来源恢复9请求和只读泛化3请求单列。任何中断或失败保留，不重试凑通过；地图入口准确不自动算正文正确。

## 首批验收脚本适配遗漏

默认桌面批次 `.local/desktop-map-acceptance/2026-10-15T08-20-48.898Z` 完成23个业务请求，C01原自动检查误报“没有比较”。原因是驱动另一处仍按 plain JSON 的 left/right/counts 读取，未解开新模型结果 data；不是模型没有比较。独立检查已核对真实 compare(P1,P2)、采用后 current=P2/sequence+1、发布文档及草稿不变。

保留原 C01 incomplete、原证据及首批冻结记录，不改写为自动通过。默认批次结束后只修正该取证解析，并增加新旧/错误/未知格式边界测试；两个驱动文件之外350项冻结中的其余文件（包括产品和构建）完全未变。11项驱动测试、typecheck、lint通过；初次类型检查发现测试 resultMissing 被推断为 boolean，固定为 true 字面量后通过。

新旧冻结分别为 implementation-freeze-initial.json 和 implementation-freeze.json，差异见 driver-only-freeze-diff.json。原定后两条完整协同链使用修正驱动，作为受影响完整链的复核。全部业务输入和模型配置未变；首链正文范围错误仍保留，不能把驱动修复算作回答修复。
