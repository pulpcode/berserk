# 工作区说明与附件遗漏核查依据

## 线上事实

核查日期：2026-09-22；环境：腾讯云 Axon 4315。仅读取本次模拟文稿修订相关记录，未修改线上任务和文件。

| 对象 | 标识／结果 |
| --- | --- |
| 公共任务 | `edf1fd60-81fd-4eff-94da-2a27e557ef35`，值班交接说明修订测试 |
| A 会话 | `df6de98a-982a-4b4c-8ab2-0ebedb06aed7` |
| 分派操作 | `3d5fdeec-3b91-4b42-83bc-8242da1a871a` |
| 已分派工作 | `d8b1ac53-5bd8-44d2-bda5-62bb9bc9db15` |
| B 会话 | `01a0c7fa-c509-76f3-9b7e-73a8419c0ab5` |

1. A 的 `bash`、`read` 工具结果确认两份文件存在，且实际读取初稿和要求。
2. 用户随后说“直接全部分派给B去执行”。A 文本表示 `inputPaths` 将包含两份文件。
3. Pi 原始 JSONL 中 `2026-09-22T07:15:30.795Z` 的 `work_item_prepare` 调用，`payload` 含 `workspaceId`、`assigneeSeatId`、`title`、`goal`，完全未包含 `inputPaths`。
4. 准备结果 `files: []`；`07:15:51.726Z` 成功提交后，工作记录 `inputFileIds: []`、`inputFiles: []`。
5. B 的 `ls` 返回空目录。实际资料未随工作交接，不能靠获知 A 的路径或原始来源附件 ID 获得访问权限。

这能证明调用遗漏和界面未显露遗漏，不能由单次日志确定模型内部为什么漏填。A 曾正确提到 `inputPaths`，也不能据此断定它已经充分理解并贯彻了工作区设计。

## 模型可见说明的缺口

`src/pi/lab.ts:584` 当前写法是：“当前工作目录是 /workspace，属于当前任务和席位，多会话共享其普通文件。”已给出当前归属，但没有明确将共享限定为同任务、同席位，也没有直接说明 A、B 的 `/workspace` 对应不同目录。

`src/pi/lab.ts:569-571` 提供当前席位、工作区、任务 ID 和关联工作的实际 `inputFiles`，并说明接收侧用 `handoff_import_file` 导入。发送侧 `work_item_prepare` 则没有解释 `inputPaths` 才选择真正交接的文件，也未说明目标文字中的路径不会产生文件副本。

因此可以确认宿主说明不完整，不能简单归结为模型在完整理解设计后漏填参数。修复从补清工作区与交接语义开始，再通过实际工具调用和文件交接验证效果；不预先认定参数必填是必要修复。

## 代码依据

- `src/contracts/collaboration.ts:32`：`inputPaths` 当前可选，无字段语义说明。
- `src/collaboration/service.ts:65`：存储初始化复用现有 `workPrepareSchema` 校验历史准备输入，收紧共用 schema 会破坏兼容。
- `src/collaboration/service.ts:213`：仅遍历 `inputPaths ?? []` 冻结文件；目标文字不产生附件。
- `src/collaboration/service.ts:224`：确认说明包含 Agent 生成的 `goal`；真实 `files` 来自固定副本记录。
- `src/collaboration/service.ts:269`：提交时以实际 `files` 生成工作输入引用。
- `src/pi/collaboration-tools.ts:51`：现有说明要求准备成功后立即调用 commit，没有明确返回附件核对步骤。
- `src/contracts/collaboration.ts:33-35`：`claim`、`submit`、`review` 都需要 `expectedRevision`；现有“assign/submit 用当前工作区，其他操作用最新 revision”的说明不够准确。
- `src/contracts/collaboration.ts:12-16`、`src/collaboration/service.ts:324`：可导入文件包括工作输入和提交成果，不能将 `handoff_import_file.fileId` 的说明限定为 `inputFiles`。
- `src/web/InteractionCard.tsx:60`、`src/web/WorkInbox.tsx:189`、`src/web/HandoffFiles.tsx:10`：零附件不会呈现明确空状态。

以上源码路径相对 `experiments/harness-lab/`，行号为本次核查快照，后续以符号和实际代码为准。

## 公开参考与采用范围

- [Codex 官方工具示例](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-5.3-codex#shell_command)：工具用途与参数含义分别说明，保留必要的调用前提。本方案借鉴这种组织方式，不将示例视为所有 Codex 版本的完整内置提示。
- [Claude Agent SDK 自定义工具](https://code.claude.com/docs/en/agent-sdk/custom-tools#create-a-custom-tool)和[Claude Code PreToolUse](https://code.claude.com/docs/en/hooks#pretooluse)：工具描述、输入结构和执行处理各有职责，执行层另行处理许可。用于支持说明与程序约束的分工，不构成本项目新增 hook 的需求。
- [Anthropic 工具设计经验](https://www.anthropic.com/engineering/writing-tools-for-agents)：补清模型缺少的资源关系、输入输出，通过独立场景检验效果，避免只适配既有评测。本方案保留真实故障作回归，并增加不同任务与文件的对照。

采用的原则是：共享范围在环境说明中给出，字段描述解释输入，工具说明交代用途与必要衔接；旧准备单失效等实现细节留在开发设计，测试口语留在验收，不分别改写成常驻禁止句。

## 备选机制研究（未纳入实施）

Pi 0.85.1 的公开工具处理顺序为 `prepareArguments → schema validation → beforeToolCall → execute`，参数处理错误返回普通工具错误。依据：安装包 `@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-agent-core/dist/agent-loop.js:409`、`:452`。

原生参数校验存在类型转换：本地校验中单个路径字符串可转换成数组，`null` 也可能转为字符串数组。相关机制见 `@earendil-works/pi-ai/dist/utils/validation.js` 的 `validateToolArguments`。这是以后评估参数约束时可参考的事实，不构成本次新增拦截的需求或实施任务。

## 验证覆盖

- `tests/pi/collaboration.test.ts` 使用确定性模型，分派成功用例预先构造了正确的附件参数；证明后续固定副本、确认、隔离和回执行为。
- `scripts/probe-handoff.ts:74` 的真实模型探针明确要求“附上当前项目的任务书.txt和数据.csv”，并断言两份实际附件。已有真实成功记录，见 W01-8 `research/validation-results.md`。
- 原探针包含后续退回、修改、再次提交等多轮验证，但未发现“首轮读附件，后轮仅用全部指代”的分派覆盖。

本次补充针对该自然多轮路径的验证，不将已通过的文件复制测试误写成对任意自然语言分派的完整性保证。
