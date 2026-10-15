# 产品实现与确定性验证

2026-10-15。按本任务审阅后的方案实施；本记录仅覆盖产品和确定性测试。真实模型批次、最终语义判定由主会话另记。未提交、推送或部署。

## 实际改动

- `experiments/harness-lab/src/pi/annotation-results.ts` 从真实结果生成模型 `content`，外围格式为 `annotation.model-result.v1`，业务内容位于 `data`。成功 `draft/read` 仅回显实际提供的 objectIds/layerIds/fields，保留 total 和分页数据；不自动全图查询。
- `src/contracts/annotation-results.ts` 共享定点 hash 投影及回执校验。只移除标注元信息 hash，保留业务 attributes.hash、业务字段、来源时间、固定 refs 和恢复信息。完整原始写入/旧动作回执进入 Pi details.annotationResult，origin 区分 write/replay/receipt_read。
- `annotation-tools.ts` 接入上述适配并补足通用筛选、分页和字段说明；服务/HTTP/数据库/权限/CAS/原始宿主依据不变。错误仍使用原格式，不新增 committed=true。
- `composer-input.ts` 增加新地图输入 v5：原生 details 保留验证后的引用，模型文本省略其元信息 hash，说明选中摘要范围。旧 v1–v4 生成器原样保留；history-evidence 识别 v5。方法/角色单独输入仍 v1。
- `contracts/index.ts`、`lab.ts`、`useChat.ts`、`web/situation/evidence.ts` 将真实回执投影贯通实时事件与历史快照，复用现有地图按钮及固定引用路径。新数据缺失/损坏不退回模型文本凑成功；旧 plain JSON 回执保留严格兼容。
- 共享提取器返回 undefined 表示没有新结构、null 表示明确拒绝的新结构；null 可在历史中保留，避免 hook 把内容改成旧回执文本后恢复成功按钮。合法新回执还须与同条模型投影一致。
- 原生 hook 前快照 raw content 和 raw details；hook 替换、原地篡改（含仅修改 hash）或标为错误均拒绝读取依据并清除成功 UI 元数据。不确定写入仍需查询原回执、重新读取，不新建持久 registry。
- 同步 backend/map-annotations、backend/conversation-references 和 frontend/harness-lab 的实际契约。

## 验证结果

产品相关 **157 个不同确定性用例通过**（含后补的查询范围、压缩回执和 hash-only hook 篡改用例，重复运行不累计）：

- 首组 12 文件 150 项：annotation-results；pi/annotations、composer-input、provider-payload、annotation-hook-boundaries、annotation-source-history、annotation-workflow、map-skill；annotation-map-evidence、annotations-acceptance、annotation-from-source、probe-desktop-map。
- 追加 annotations 两项通过：真实服务的图层/对象/字段/分页范围，以及实际 native compaction、重开后固定回执保留。追加 hook hash-only 一项通过；所在 15 项 hook 组通过。
- context-composer-map 4 项通过；首次执行因沙箱禁止监听回环端口而 EPERM，获准运行同一组后 4/4 通过。环境拦截不计产品断言失败。
- 实际 provider HTTP SSE 捕获验证：新工具结果与 v5 引用不携带标注 hash/details，业务 attributes.hash 和备注仍进入模型；实时事件与历史回执相同；重开续聊仍不将原始 details 发给模型。
- 固定 v1/v2/v3 夹具及新增基线 efe2fb6 的 v4 夹具逐字校验；混合 v1–v5 原生历史重开、取消、续聊及未知版本拒绝通过。

桌面 Playwright **16 个不同用例通过**：原 annotations + situation-map 共 15 项（含旧/新回执参数化），另新增 native streamed publication 用例 1 项。后者经过实际 PiLab、Web SSE、发布按钮、固定版本加载和页面重载。后续草稿改名不改变入口指向的发布对象，也不改编辑目标。所有测试使用假模型；不作为真实模型理解证明。

`npm run typecheck`、`npm run lint`（含边界检查）、`npm run build` 和 `git diff --check` 通过。构建保留既有大包提示。最终测试小改后另由独立检查者复核类型/lint，不把先前执行隐瞒为后续文件检查。

## 开发期间修正记录

- 既有工具断言按原 plain JSON 比较整个结果；适配新 data 及 receipt_read origin 后通过，原效果断言保留。
- 新 hash-only 故障注入最初也尝试篡改后续错误结果的不存在 details，触发测试 hook 自身异常；改为只篡改有真实回执的结果，仍验证写入暂停、原回执核对和恢复。
- 新发布浏览器用例最初错误假设整版入口会自动选中某个对象；改为打开该只读参考图层并选择对象后核验。未改变产品交互以迎合测试。
- 新测试 text union 类型错误及 v5 裁剪未使用变量的 lint 错误已修正；最终检查通过。

## 剩余验证与限制

- 尚不能据此声称自然语言准确性提高；原 54 请求与新 G01–G03 只读案例由主会话按固定材料实际运行、逐条审阅。
- 不重写旧助手文字、旧工具结果或历史错误 hash；旧历史只保证可读兼容。
- 元数据投影与范围回显不能硬性禁止模型编造；不增加答案审核器、第二个模型或固定回答模板。
- 回退须保留 v5、新模型结果及结构化回执读取兼容，不能直接部署不认识新历史的旧二进制。
