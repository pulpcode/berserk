# 重复错误验证工程：独立复核

2026-10-28。复核者：独立代码审查 Agent。此处是工程审查，不是人工业务评分，也不是真实模型能力验收。

## 范围与结论

本轮审查 `evaluation-v3`、`loading-diagnostic` 和随后接入的 `loading-diagnostic-live`。最终结论：本轮工程交付通过，无未修复的阻塞代码问题。原 `evaluation`、`evaluation-v2`、历史已提交测评证据及产品代码/Skill 继续冻结。本轮没有真实模型请求，没有产品纠错改动。

第一阶段 `loading-diagnostic` 仅提供 offline prepare：通过真实本地 HTTP/Pi 路径送入请求，由受控 provider 返回合成结果，执行实际只读工具。24 槽、48 次 synthetic provider 请求只证明传输与加载路径可用，不代表 24 个业务任务完成或错误已修复。该目录的 `proposedLimits` 仍只表示建议，不能直接套用 v3 的完整批次预算运行诊断。第二阶段已在独立目录实现带预算守卫的 live runner，见后文；真实批次授权、模型可用性核验和业务能力评分尚未执行。

## 审查发现及处理

1. 早期 v3 代答仍把“请明确具体图层”等错误字段当作车型澄清，把含 90° 的坐标请求当作方向确认。已交实现代理收窄请求匹配并补负例；结构化提问只读取 prompt，候选选项不能污染判断。
2. 实际发送计数原先在 HTTP 成功前增加。已改为分别记录 `messageSendAttempts` 与成功 HTTP 对应的 `sentTurns`。
3. 后续复核又发现“消防车是否已到场”“90°方向是否有障碍”类问题仍可能触发代答，以及严重效果错误可能导致成功响应漏计。实现代理已改为整句匹配冻结的车型/方向提问，未知说法保留待复核；成功响应已在效果判定前计数。独立复核代码及 7 项纯函数回归通过。
4. 诊断初版只比较单槽前后数据，没有 A/B 配对初态断言。已补充同案例/轮次业务 document 比较，仅归一合成资源标识；其余会话/版本/时间等运行身份另行披露。

## 已检查的实际路径

- 泛化重发原题分支已删除；无法确定的问题留待复核，不推断额外授权。结束语分类仅为协议提示，不能等同业务正确或完成。
- v3 冻结自身和复用的 v2 模块；不修改历史题目、答案或既有成绩。
- 诊断 A 使用普通请求，B 使用原生 `skill: {id, hash}` 选择；当前 Skill 正文不变。保留实际 native/wire 请求，断言 B 正文送达、A 未预置正文及工具 schema 一致。
- 诊断 workspace 只从产品文件构建；期望答案不安装到运行环境。受控 provider 仅返回一次读取和一次结束，禁止外网及多余继续；读取后数据不变。
- 诊断拒绝 live 模式和证据覆盖，最后核验来源冻结；读取输出和测试通过不作为模型理解证据。

## 验证记录

- 独立执行 ESLint：最终两目录 TypeScript 文件通过；使用 harness-lab 的 ESLint 配置。
- 独立执行 TypeScript：最终两目录 `tsc --noEmit -p .../tsconfig.json` 均通过。
- 独立核验 `unchanged-baseline.json`：244 个文件 SHA-256 全部一致。
- 独立执行 `git diff --check`：通过。
- 独立运行 v3 `remediation.test.ts`：7/7 通过。首次通过 tsx CLI 运行因沙箱 IPC `listen EPERM` 未启动；改用 `node --import tsx --test` 在沙箱内完成，未调用模型。
- v3 HTTP/Pi 套件由实现代理执行：初轮完整 18/18，最终受影响 10/10；最终共 19 个测试定义，没有声称最终全量 19 项重跑。独立读取 `PJYJnt`、`PL259A`、`HDlJiZ`、`edDQCi` 四批 `batch-state.json` 核实：30 槽准备、4 槽读写/CAS、重复写停批且仍计成功响应、C09 每槽仅发送一次且协议待复核。临时证据根目录和完整名称见 [evaluator-checks.md](evaluator-checks.md)。
- 加载诊断最终 HTTP/Pi 测试 2/2 通过。独立读取 `plotting-loading-odLxy9/batch` 的 summary/runs：24 prepared、48 synthetic、0 real，12 组 A/B 业务文档逐一相同。详细命令、失败记录和绝对路径见 [diagnostic-checks.md](diagnostic-checks.md)。

## 后续 live 接入

上述 offline 工程审查完成后，主会话另行分配独立 `loading-diagnostic-live/` 接入。本段不改变前面离线批次的原始范围，也不表示真实模型调用已发生。

已静态复核：live 复用原 Provider 与持久 ledger，以子类执行更低的 120 requests / 4M input / 200k output 上限；请求前检查、实际结算后越限停止，未知用量继续沿用原停批规则。固定 24 槽、精确 scope/freeze/预算授权与独立一次性 claim；不允许替换排期。冻结包含 v3 澄清规则、offline 题目及逐题判定方案。实际模型版本、thinking 与截断守卫复用原 Provider。

A/B 使用相同合成业务初态和工具，B 每次消息用原生 Skill 选择。只有 T1 可以使用已冻结的车型澄清答案；其他未知问题保留待复核。R1/R2/S2 只读、来源系统不变、公开发布/采用及额外对象等关键效果检查都接入实际回合结果，严重错误停止后续槽位。

独立运行最终授权/claim、lower ledger（含第 121 次请求拒绝）、评分分母、只读/来源 guard 四项纯函数测试：4/4 通过。独立执行最终 live 目录 TypeScript、ESLint：均 exit 0。

评分审查发现：没有 outcome 的槽可以仅靠一份 review 进入 strict 计数。主会话提出后独立确认，实现代理已修正，拒绝无对应结果和 `not_executed/prepared/started` 状态的 review，同时保留 `needs_review` 经证据复核后语义通过。独立复读最终 guard，并复跑包含该负例的测试通过。

实现代理完整 HTTP 套件 6/6 通过，最后评分守卫修改后受影响纯测试 1/1 通过，没有声称最终全量重复执行。独立读取最终两批 `batch-state.json`：`plotting-loading-live-c1WTeF/batch` 为 24 recorded、68 synthetic、0 unknown，检查 12 组业务初态一致、24 槽首请求加载条件正确、工具 schema 一致、逐槽 accounting 无错误；`plotting-loading-live-TdCGs8/batch` 首槽越界失败、3 synthetic，剩余 23 槽未执行，停止原因 `unexpected_or_duplicate_object`。两批均无真实模型请求；原始路径和失败记录见 [live-readiness-checks.md](live-readiness-checks.md)。

再次核对产品/Skill、旧驱动和历史证据 244 个受保护文件 SHA-256：全部一致。最终实施记录与新增 spec 对应实际代码；任务保持进行中，不能把工程通过写成真实 Agent 错误已改善。后续按冻结批次核验模型与额度、执行真实对照并独立审阅证据，属于尚未开展的业务验证。
