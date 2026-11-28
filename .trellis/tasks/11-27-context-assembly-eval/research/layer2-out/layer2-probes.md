# 第 2 层外部 Harness 参照探针结果（Issue #4）

- 生成时间：2026-11-28T08:32:44.203Z

## opencode-deepseek

| 步骤 | 规则文件 | 请求数 | Wire含新规则 | Wire含旧规则 | 归因判定 | 断言说明 |
| --- | --- | ---: | --- | --- | --- | --- |
| P0-初始R1 | AGENTS.md=R1 | 2 | YES | NO | PASS | PASS |
| P1-同会话替换R2 | AGENTS.md=R2 | 1 | YES | NO | MODEL_INERTIA_OR_CONTEXT_FAIL | 回答未以要求的前缀 【青竹】 开头；回答包含已失效的旧前缀 【赤松】 |
| P2-同会话清空规则 | AGENTS.md="" | 1 | YES | NO | MODEL_INERTIA_OR_CONTEXT_FAIL | 清空规则后仍出现旧前缀 【赤松】；清空规则后开头仍存在装饰性前缀标记: 【赤松】 |

## opencode-kimi

| 步骤 | 规则文件 | 请求数 | Wire含新规则 | Wire含旧规则 | 归因判定 | 断言说明 |
| --- | --- | ---: | --- | --- | --- | --- |
| P0-初始R1 | AGENTS.md=R1 | 2 | YES | NO | PASS | PASS |
| P1-同会话替换R2 | AGENTS.md=R2 | 1 | YES | NO | PASS | PASS |
| P2-同会话清空规则 | AGENTS.md="" | 1 | YES | NO | MODEL_INERTIA_OR_CONTEXT_FAIL | 清空规则后仍出现旧前缀 【赤松】；清空规则后开头仍存在装饰性前缀标记: 【赤松】 |

## claude-code-kimi

| 步骤 | 规则文件 | 请求数 | Wire含新规则 | Wire含旧规则 | 归因判定 | 断言说明 |
| --- | --- | ---: | --- | --- | --- | --- |
| P0-初始R1 | CLAUDE.md=R1 | 1 | YES | NO | PASS | PASS |
| P1-同会话替换R2 | CLAUDE.md=R2 | 1 | YES | NO | PASS | PASS |
| P2-同会话清空规则 | CLAUDE.md="" | 1 | YES | NO | PASS | PASS |

