# 模型重放调用前审查

2026-10-15。**调用前审查通过（ready），无遗留阻断发现。** 审查范围仅为 `replay.mjs`、`replay.test.mjs` 与批准的 `plan.md`。未发起模型请求、未读取环境文件、未执行模型工具。未修改实现者正在编辑的文件。

## Findings (fixed)

- 本审查未直接修改驱动。主会话先前指出的请求模型被响应模型覆盖、缺省端点问题，在本次读取版本中已修正：请求身份保留为 `model/requestedModel`，提供方身份另存 `responseModel`；缺省 URL 为官方 HTTPS 地址。
- `replay.mjs:57` 与 `replay.test.mjs:78`：审查发现解构声明未使用的 `_model` 违反现有 ESLint。通知文件所有者后，由实现者改为复制对象并删除副本 `model`，不修改原始 payload。审查者复跑定向 lint 通过。

## Findings (not fixed)

- 无。

## Verification

- Lint：修复后通过。使用现有 `experiments/harness-lab/eslint.config.js` 对两个文件定向检查，退出码 0。
- TypeCheck：不适用；两个 `.mjs` 文件不在产品 TypeScript 工程中。两文件 `node --check` 通过；未将语法检查冒称类型检查，也未重跑无关产品检查。
- Tests：审查者运行 `node --test .trellis/tasks/10-15-map-query-scope/model-comparison/replay.test.mjs`，5/5 通过，全部运输请求使用 mock。两处 lint 修复后，实现者再次报告 5/5 通过；审查者遵循冻结后指令仅复跑 lint。
- 原始 JSONL 第 9/2/1/3 行与 C1/C2/C3/C4 对应，测试将两模型实际请求与原始 payload 深比较，只有 `model` 不同。四份均为 `thinking.type=disabled`、`stream=true`、`max_tokens=393216`；消息数依次为 14/6/6/8，工具数为 22/22/0/22。
- 请求直接发送冻结 JSON 字节，不重新走 Pi 封装，不增加提示词或连接本批输出。计划、驱动、输入和来源文件有 hash 检查。
- 调度为 4 案例 × 2 模型 × 3 重复，共 24 次；第 2 轮逆转模型顺序。独占输出目录、前项完成检查和运行锁阻止覆盖、跳项及并发重入。每项一次 fetch，无重试和工具执行入口。
- 两模型共用 300 秒 AbortController；HTTP、运输、超时、截断、过滤及解析失败分别保留。中途流内容保留。未实耗等待 300 秒；测试覆盖状态分类，计时器与 fetch/读取阶段的连接由源码检查。
- URL 只允许 `https://api.deepseek.com` 的根路径、`/v1` 或相应 chat/completions 路径，禁止重定向。日志不保存请求头/环境/异常对象，响应文件在落盘前脱敏现有 API key。
- SSE 测试覆盖 UTF-8 跨字节分块、CRLF、多行 data、工具参数增量拼接、usage 与 DONE，以及错误和不完整输出。模型请求身份与提供方返回身份分别验证。

本报告仅支持调用前运输与取证审查；真实提供方兼容性、24 次实际执行及后续独立盲评尚未由本审查证明。一次性测试驱动未改变产品契约，无需同步产品 spec。
