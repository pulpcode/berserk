# 第二批 Pi 接入与离线检查

2026-11-02｜实现分工：Pi/native｜未调用真实模型、未提交或推送

## 完成内容

- 新增 `src/pi/task-resource-tools.ts`：前台主 Agent 的 `task_resource_query`，支持 query/read/summarize，复用资源服务与已有空间权限检查。
- 新增 `src/pi/task-resource-results.ts`：原生分支结果解析、模型投影、读回交付核验、真实用户消息定位。
- `src/pi/lab.ts`：工具注册、hook 结果防改写、历史安全投影、续问和每次模型/压缩发送前权限复核、事件安全投影。
- `src/contracts/index.ts`、`src/web/useChat.ts`：资源结果历史/事件字段兼容透传；没有增加结果卡片。
- 新增两个 `tests/pi/task-resource*.test.ts`。

没有新建结果库、消息库或 Agent 循环，也没有扩大后台/子 Agent 的工具列表。

## 接口说明

- `resolveResourceResult(entries, resultRef)` 只认同一原生分支中的成功 query/summarize 调用。校验 requestId、toolCallId、参数、details 与模型正文；read 的 delivery 不成为新来源。
- `validateResourceDelivery(entries, result)` 核对 read 自己的调用归属、引用、offset/limit。结果原始身份保持不变。
- `resourceToolResult(result, offset?, limit?)` 生成 `resource.model-result.v1` 文本和完整原生 details。
- `resourceUserMessages(...)` / `resolveResourceMessage(...)` 只认同一分支、已验证 composer 选择对应的第一条真实 user 消息。助手文本、压缩摘要、其他分支和未附明确资源引用的消息不能充当这类证据。
- 服务通过 `listMessages` 获得消息候选，并自行只保留本次查询涉及资源的引用；工具通过 `resolveMessage` 核实原文定位。自由文字含义仍未自动认证。
- summarize 先解析真实资源结果与可选空间结果，再分别重检权限，最后交服务核对对应关系。

## 检查结果

工作目录：`experiments/harness-lab`。

| 检查 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| 本分工修改文件 ESLint（7 个文件） | 通过 |
| `npm test -- --configLoader runner tests/pi/task-resource.test.ts tests/pi/task-resource-results.test.ts tests/pi/spatial.test.ts tests/pi/composer-input.test.ts` | 4 文件、55 项通过 |
| `git diff --check` | 通过 |

55 项中，新增 17 项，既有空间/composer 回归 38 项。重复执行不累计为独立样本。

新增检查覆盖：

1. 真实 Pi 工具循环 query → classify → summarize → read，重启后读回，同席位其他会话拒绝复制引用。
2. hook 改写成功结果后隐藏结构化内容并禁止继续；普通可恢复查询错误不阻断后续请求。
3. 实际自动压缩后仍从原生分支读取原结果。
4. 历史依赖撤权后隐藏结果，续问在模型调用前拒绝；同请求工具完成后撤权，下一轮 provider 不被调用。
5. 原调用缺失、重复原引用、参数/正文/details/归属/错误标志篡改及 delivery 冒充 origin 均拒绝。
6. read 分页与实际调用一致，不能改页码后仍作为合法交付。
7. 真实用户＋明确资源选择可定位；助手、摘要、其他会话、道路选择和未获本次选择的后续消息不作为资源报告。

## 首次失败及修复记录

- 最初类型检查出现并行空间扩展相关类型错误，已反馈对应实现者；本分工 fixture 的 JSON 字面量类型较宽，改为经 `decodeComposerInput` 校验后使用，最终类型检查通过。
- 原生结果单元 fixture 的空集合 `entityCount` 与同时完善中的契约不一致，两个真实性测试曾被严格校验拒绝。最终按已批准语义固定为：task 查询且关系覆盖不足时，实际实体总数为 `null`。这不是放宽产品校验，也没有修改真实性断言。
- 一次局部脚本因工作目录使用错误未写入文件，随后在仓库根执行；最终检查已覆盖实际修改。

## 交接与限制

- 根代理统一运行浏览器历史/空间结果回归和构建；本分工没有占用桌面回归端口。
- 本文件只报告 Pi 分工检查，不替代全部 D01—D24 业务/HTTP/空间验收。
- 用户消息正反例验证了原生分支与 composer 契约；资源服务对 messageCandidates 的过滤、消息语义保留与权限检查由业务服务测试另行覆盖。
- 没有证明真实模型会正确调用工具或理解用户补充，相关 Skill 与模型测评仍属于后续批次。
