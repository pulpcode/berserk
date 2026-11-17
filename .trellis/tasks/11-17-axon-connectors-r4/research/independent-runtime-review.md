# R4 独立运行时审阅与局部修复

日期：2026-11-17。审阅范围为原 Pi 会话准入、MCP 工具适配、提问/确认/严格历史、专家引用与 R3A 衔接，以及相关原有 Web 呈现。基础存储/密钥/迁移/业务路由由另一审阅者负责，传输与官方 SDK 由原传输 owner 负责；本记录不代替主会话的最终全量检查、真实模型/第三方验证或用户验收。

依据：当前任务 PRD/design/implement、原 v0.2 的 M06/M09—M12/M14/M15/M18—M20、mcp-runtime-map，以及 backend HITL/task-access/capabilities-r2/authoring-r3a 和 frontend harness-lab 合同。保留其他并发修改，无提交、部署、生产迁移或验收状态变更。

## Findings (fixed)

1. **隐式专业专家多连接绕过目标询问。**
   - 文件：`experiments/harness-lab/src/pi/lab.ts`。
   - 原实现只有通用助手的多个候选会进入 pendingTarget；专业专家配置多个 connectorRequirements 时全部工具直接具备目标资格。
   - 修复：多个隐式专家引用也进入同一原生宿主问题约束。不能使用 ask_user 的专家在模型/网络前返回明确的原输入区选择提示，不扩充旧 allowedTools；用户显式选定多个服务仍逐次确认。
   - 回归：原生 Pi 的 general/expert 参数化场景均先阻止调用、接受原问题的真实回答、阻止非选中连接，再等待独立操作批准。另覆盖禁止 ask_user 的专家可显式选定服务，以及旧 null/空工具范围专家不取得 MCP。

2. **缓存目录参与候选计数导致首次本人凭证不可自动使用、并可能错误偏向已有缓存。**
   - 文件：`experiments/harness-lab/src/pi/lab.ts`、`src/pi/mcp-tools.ts`。
   - 原候选仅包含当前主体已有可用目录项的连接，新配置本人凭证没有该主体目录，会从候选中消失。
   - 修复：计数包含所有获准、凭证已配置、当前修订已开放动作的 MCP；唯一目标只在当前请求以本人身份发现。多个候选且有任一主体目录尚不可用时，在模型/任何 HTTP 前要求原输入区显式选定。专业专家的隐式多引用也在共享 RequestMcpTools 边界执行相同无目录规则。多个都有目录的候选仍走原生准确提问。
   - 回归：唯一未缓存本人连接的发现与调用仅使用当前账号凭证；缓存 A 加未缓存 B 不会自动选择 A、不向任一候选联网；显式选 B 后只发现/调用 B。后一场景同时覆盖通用助手与专业专家。
   - Web 核对：原 ConnectorPicker 的可选性只依据启用状态/凭证，未因 tools=[] 错误禁用该服务，故无需改 UI。原 useChat 的失败准备路径恢复文字/附件并保留连接选择。

3. **专家范围校验晚于认证发现。**
   - 文件：`experiments/harness-lab/src/pi/mcp-tools.ts`。
   - 原实现先 admit/潜在远程发现，再检查 connectorRequirements 成员与动作开放契约。选择不属于当前专家的本人凭证连接，可在拒绝之前发出认证目录请求。
   - 修复：成员与当前开放动作契约检查移到 RemoteMcpSession/发现之前。
   - 回归先红后绿：不属于专家引用的未缓存本人连接，在原实现额外产生 2 个 HTTP 请求；修复后没有 HTTP、没有模型调用。

4. **严格历史接受互相矛盾的 MCP 结果证据。**
   - 文件：`experiments/harness-lab/src/pi/interactions.ts`。
   - 原实现接受 mcp.status=success 与 isError=true、mcp.sent=true 与 executionStarted=false，或删去 mcp 但保留 executionStarted=true 的错误结果。
   - 修复：MCP 状态必须与原生错误标志一致，sent 必须与执行标志一致；无 MCP 实际证据不得声称已开始。保留错误但未执行、未知外部效果及旧 v1 解码分支。
   - 回归先红后绿：真实已批准原生历史可读，上述三种矛盾篡改及原有来源/参数篡改均被拒绝。

5. **静态检查局部问题。**
   - `src/pi/interactions.ts`：把已判定存在的 targetQuestion 保存到局部常量后供回调使用，消除 TS18048。
   - `src/pi/lab.ts`：删除改用 interactionRecordType 后未使用的旧交互常量导入，消除 ESLint 错误。

## Findings (not fixed)

- 未发现本次责任范围内尚待修复的产品问题。
- `src/web/InteractionCard.tsx:210` 保留两条既有 react-hooks/exhaustive-deps 警告：清理回调读取 focusScope.current/composerInput.current。已核对 HEAD 同一逻辑原样存在，不是本轮引入，lint 不失败；无本轮具体交互缺陷证据，未改原有焦点恢复语义。
- 新 R4 spec 的最终同步由主会话负责，已明确交接：未缓存的多候选/禁止 ask_user 的专家要求原输入区选择；专家引用/动作检查先于认证发现。未在此并发修改 spec。

## 其余核对

- 请求准入仍检查当前账号/原工作区/专家/连接/动作/认证主体；个人凭证可以用于本人原权限范围内的公共任务，不向其他席位或后台借用。
- 普通停用在 assertAdmission 的已准入分支允许原范围收尾；当前修订/使用策略/凭证变更仍阻止后续调用。没有账号或服务故障自动切换路径。
- 写入/未知效果使用持久意图且不重发；原生停止、未知结果和重开历史均保留实际来源证据。
- 原生 admission/policy/confirmation 与当前请求 manifest 身份/工具清单、最终参数、原模型参数摘要和结果来源相互核对；旧交互 v1、MCP v2、作者确认 v3 分开处理。
- 对 authoring/expert 文件另作只读复核：旧专家 schema1 字节/摘要不变；新引用经过复制/恢复/部分 R3A patch 保存，发布在提交边界重新核对动作契约；管理 Skill/试用不获得远程执行。未发现具体缺陷。
- 原 CandidateContents 已完整展示 connectorRequirements；新增呈现回归证明原 schema3 保存确认中，schema2 提案的 before/candidate 连接 ID、动作名称、契约摘要均可见，仍有独立“确认保存草稿”按钮，无需产品 UI 修改。

## Verification

- TypeCheck：`npm run typecheck` 通过（全部产品修复后）。
- Lint：`npm run lint` 通过，0 errors；上述原有 2 warnings；Pi/browser dependency boundaries 通过。
- 最终原生 MCP：`npx vitest run tests/pi/mcp-runtime.test.ts`，**21/21 通过**（最后的专业专家未缓存守卫后重跑）。
- 最终 Web 呈现：`npx vitest run tests/web/mcp-presentation.test.ts`，**4/4 通过**；该文件 ESLint 通过。
- 中间原生回归：MCP runtime + interactions + capability-history + authoring-history + mcp-presentation 五文件 **61/61 通过**；随后新增专业专家未缓存及作者候选呈现检查按上述责任文件分别重跑，未冒称完整五文件再次运行。
- 只读专家/R3A复核：connectors-experts + pi/authoring-history **4/4 通过**，相关 authoring/capability 文件 ESLint 通过。
- `git diff --check` 通过。
- 初次本地受控监听器运行在 sandbox 中被 EPERM 阻止，17 项均未进入行为断言；随后在获准的本地监听执行环境实际运行。保存两次回归的真实红例：矛盾结果证据被错误接受、专家越界发现多发 2 次 HTTP；均在修复后通过。
- 未在本审阅中重跑最终全量 unit/build/browser，未执行真实 Ark/第三方或用户验收；由主会话分别留证。
