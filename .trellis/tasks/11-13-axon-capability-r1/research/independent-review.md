# R1 独立静态审查（实施中）

审查对象：codex/axon-r1-experts 工作区当前变更；依据用户提供的 R1 v0.2 A01—A12、0B v0.3 与项目能力/会话/鉴权规范。主代理仍在修复与补测试，本文件不是验收通过声明。审查遵循只读产品代码分工，修复由主代理负责。

## 已发现并反馈

1. **P1 子专家状态未进入准入**（A08）：初稿 runSubagent 只继承父 capabilityRequestId，无法阻止停用或封禁 role-reviewer 后的委派。主代理已增加子请求自身 acceptRequest/release 与父请求联合守卫。复查位置 `experiments/harness-lab/src/pi/lab.ts:1269`。
2. **P1 委派修订与实际父请求角色快照不一致**（A02/A06）：初稿委派时 current(role-name) 可能被另一请求重新登记，而实际 role.systemPrompt 来自较早父请求。主代理已以 registerRoles 返回值建立父请求 roleExperts，再固定读取对应修订。复查位置 `src/pi/lab.ts:1418` 和 `:1258`。
3. **P1 按需技能读取绕过技能状态**（A08）：只固定声明技能及显式选择；通用助手自动 skill_read 仍能读取已停用/封禁的技能。反馈要求在最终有效 tool args 处，按本次 snapshot SkillRevision 加入 accepted request 并检查当前状态；不能将客户端声明当作已经准入。主代理正在修复。
4. **P1 新绑定可被后置绕过历史一致性校验**（A09）：`src/pi/history-evidence.ts:146` 初稿允许首次非 legacy 的 EXPERT_BINDING 出现在请求/消息之后；此前 manifest 在 binding 未赋值时不检查一致性。建议非 legacy 绑定必须在所有工作前；legacy 绑定须独立清单证明，不可仅信任 legacy:true。主代理已接收。
5. **P1 跨存储创建不完整却完成回执**（A04/A10）：`src/pi/lab.ts:457` 先 records.set 后 workItem bind；如果后者写入失败，重试 `:408` 直接完成创建，未核对 workItem 关联。建议先核对原 workItem 关联，与原 intent 一致才完成；冲突或无法证明则阻断，保留现场。
6. **P2 中断创建接受不匹配的模型记录**（A04/A09）：初稿仅见 MODEL_SELECTION 即跳过写入，不验证其值。主代理已增加现有模型记录数量和 selectedModelId 与原参数的核对，见 `src/pi/lab.ts:443`。
7. **P1 多轮继续跳过修订元数据校验**（A09/A11）：初稿 execute 使用 record.expert 缓存，不调用 resolve(binding.ref,digest)，而 acceptRequest 只查 revisions 是否存在。运行中修改 revisions.digest 后仍执行旧内存配置且不报错。建议每请求开始解析固定 ref+expectedDigest（内容缓存仍可命中），循环内部继续固定已接受快照；不要求热路径重新读取不可变正文文件。

上述行号为审查时位置，后续编辑会移动。主代理需在修复及测试后逐项更新最终状态。

## 未作为问题报告的约束

- 内容缓存按已校验不可变文件使用；不要求每次命中都检查外部磁盘篡改。冷读取/重启必须验证正文摘要；规范没有要求建立实时文件监视器。
- 管理员是独立账号角色，不能替代业务权限。UI 允许管理员读能力目录与只读概览不应视为业务提权。
- 不引入动态技能导入、MCP、网页发布或后台迁移作为 R1 修复手段。

## 验证边界

本轮按主代理要求不另启全量 lint/typecheck/test，避免与正在运行的基线和集成检查争用资源。上述问题由实际代码路径核对，不宣称已运行故障注入。主代理负责运行最终检查以及补充权限、历史损坏、并发与恢复回归。真实模型、Docker、完整旧程序回退和实测性能仍须分别记录，不能由静态审查替代。

## 修复复查与独立回归

主代理修复以上 7 项后，复查结果：

- 子专家独立准入、父子联合守卫及父请求 roleExperts 固定映射已经接入。`src/pi/lab.ts:1294`、`:1333`、`:1443`。
- 最终 tool args 的 skill_read 加入 accepted request 后复核当前技能状态；每用户技能撤权参与同一状态判断。`src/pi/lab.ts:1039`、`:1041`。
- 非 legacy 绑定禁止出现在工作之后；启动时 legacy 标记必须匹配能力库旧会话清单。`src/pi/history-evidence.ts:151`、`src/pi/lab.ts:292`。
- 创建重试核对并补齐原工作项关联，不接受冲突；中断创建检查现有模型记录。`src/pi/lab.ts:413`、`:443`。
- 多轮请求按固定 revisionId/digest 调用解析器，热缓存也校验数据库元数据。`src/pi/lab.ts:1415`。
- 子历史 manifest 额外比对保存修订与原父请求角色正文、工具集合。`src/pi/lab.ts:1196`。

新增独立回归 `tests/pi/capability-guards.test.ts`，仅替换模型 transport，执行实际 Pi 会话、工具循环和原生存储：

| 场景 | 证据位置 | 结果 |
|---|---|---|
| 自主按需技能 disabled / banned / 当前账号 revoked | :48，真实开通账号与个人工作区；拒绝正文记录且不发第二次模型调用 | 3 项通过 |
| 父助手可用而子专家被封禁 | :62，无子专家模型调用 | 通过 |
| 同名角色并发更新后的父请求固定修订 | :73，门控实际 AgentSession.prompt，检查旧正文及子 manifest；重启仍有效 | 通过 |
| 热会话修订数据库 digest 损坏 | :111，第二轮无模型调用 | 通过 |
| 后置非 legacy 绑定与伪造 legacy 标记 | :122，解码拒绝，重启拒绝续跑且不改写文件 | 通过 |

命令：`./node_modules/.bin/vitest run tests/pi/capability-guards.test.ts --maxWorkers=1 --testTimeout=60000`。最终 7/7 通过（28.14s，包括 import 与转换）；检查仅限上述文件，未重新运行全量测试。主代理负责全量 lint/typecheck/build 与其他回归。

无剩余已确认产品代码缺陷阻断本次静态审查，但这不是全部 R1 验收通过声明。真实模型探测遇到 `insufficient_quota`，Docker daemon 不可用；两项保持待验证。主代理另外报告完整旧程序回退与性能样本已经取得，应以其专门证据记录为准。

定向 ESLint：`./node_modules/.bin/eslint tests/pi/capability-guards.test.ts` 通过。Typecheck 沿用主代理统一结果，本复查未另启动。

## 后续真实模型复测（2026-11-13）

用户指定方舟配置后，主代理完成三轮真实模型任务及独立新进程的一轮续聊，记录见 ark-live-probe.json、ark-process-restart.json。原 DeepSeek 直连额度错误不再作为当前真实模型阻塞；Docker daemon 仍不可用。该补充是主代理运行证据，不改变上述独立代码审查的范围。
