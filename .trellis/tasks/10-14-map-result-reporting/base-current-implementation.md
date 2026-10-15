# 草稿基线与任务当前：最小实现记录

日期：2026-10-15。基线：`4c84f4f`。本轮范围以 [base-current-followup.md](base-current-followup.md) 为准；本记录仅报告实现与确定性检查，真实模型结果由主会话另存。

## 实际边界

原问题是模型把固定派生基线推断为任务共享采用状态；信息由自动输入和工具定义进入 Pi，故只在这两处补充就地说明，不增加服务状态或查询。

- `experiments/harness-lab/src/pi/composer-input.ts`：新增 v4 自动上下文说明。`baseRef` 是草稿固定派生基线；未建草稿时是待创建所选基线，null 表示未选。该引用不证明曾被或正在被采用。`draft.revision` 为本会话修订，`writable` 只表示草稿可编辑。此块未提供任务当前采用状态，采用不会改变会话基线/草稿。
- `experiments/harness-lab/src/pi/history-evidence.ts`：识别 v4，原严格解码、顺序、身份、正文一致性和子任务限制保留。纯方法/角色输入仍 v1。
- `experiments/harness-lab/src/pi/annotation-tools.ts`：create_draft 的 baseRef 参数说明明确派生含义；list 解释 current.publication/null 与缺字段的区别；action 只要求准确报告本次效果，不要求顺带总结全局状态。若回答任务当前，以本次查询或本次实际成功采用结果为依据；旧助手回答、旧回执和 replayed:true 不构成替代。实际采用成功后不强制再查询。canSetCurrent 权限分支与执行代码未变。
- `tests/pi/composer-input.test.ts`、`tests/pi/annotations.test.ts`：新增版本兼容覆盖和实际 Pi 输入可见性断言，复用原测试流程。
- `tests/pi/fixtures/composer-input-v3.json`：在修改生成器前，从基线 v3 生成器保存的固定 source-only、混合 annotation/context/Skill/role 样本。运行测试时不即时生成旧期望。
- `.trellis/spec/backend/conversation-references.md`、`map-annotations.md`：记录实际 v4 契约和不依赖 Skill 的关键说明。

未改 Skill、驱动、用户指令、模型参数、工具参数数据形状、HTTP/服务/事务/DTO/RequestState、权限、UI 或 Pi 循环。没有提交、推送、部署或运行真实模型。

## 确定性检查

命令工作目录：`experiments/harness-lab`。

| 检查 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `npm run lint` | 通过，含 Pi/browser 依赖边界 |
| `npm test -- tests/pi/composer-input.test.ts tests/pi/annotations.test.ts tests/pi/map-skill.test.ts tests/context-composer-map.test.ts tests/annotation-map-evidence.test.ts tests/probe-desktop-map.test.ts` | 59 通过；4 个 context-composer-map 用例因沙箱 `listen EPERM 127.0.0.1` 无法启动本机来源服务，没有产品断言失败 |
| `npm test -- tests/context-composer-map.test.ts`（获准沙箱外执行原测试） | 4/4 通过；仅环境权限不同，用例未改 |
| `npm test -- tests/annotations-acceptance.test.ts tests/annotation-from-source.test.ts tests/pi/annotation-workflow.test.ts tests/pi/annotation-hook-boundaries.test.ts tests/pi/annotation-source-history.test.ts` | 80/80 通过 |
| `npm run build` | 通过，保留既有大包提示 |
| `git diff --check` | 通过 |
| 比对基线 `4c84f4f` 的 v1/v2/v3 生成器函数源码 | 三个函数逐字相同 |

合计 11 个测试文件、143 个不同用例通过；重复执行的 4 个环境受阻用例不重复计数。没有新增手机验收或运行桌面 E2E；本轮真实桌面走查由原验收驱动承担。

## 关键覆盖与限制

- 未选择 Skill、readSkills 为空、没有 skill_read 或其他工具调用时，实际 Pi 模型请求已包含 baseRef/draft.revision/writable 的语义及任务当前未提供说明。实际工具定义同时包含当前状态依据、旧回执/重放边界和 baseRef 参数说明。
- 固定 v1/v2/v3 样本逐字回放通过；v1/v2/v3/v4 混合原生历史可重开并追加 v4，请求前缀不重写。
- v3/v4 均保留非法身份、未知字段、正文篡改、重复/晚到输入、错误 requestId、Skill 快照不一致、只读子任务、容量和未知版本拒绝。
- 自动上下文在地图从 2 增到 500 个对象时字节数不增长，未自动载入图形、业务备注或图层内容。
- 管理/非管理席工具说明与可用 schema 一致；原写入、来源保真、冲突、幂等、权限、恢复和证据回归通过。
- 这些测试证明关键说明被交给模型及兼容/操作约束未退化，不证明自然语言一定遵循说明。原场景三条协同链的回答准确性须按真实批次独立审阅。

本轮产品、测试、spec 与构建已停止修改，等待独立检查；若检查发现必要修复，重新记录并在真实模型冻结之前完成。
