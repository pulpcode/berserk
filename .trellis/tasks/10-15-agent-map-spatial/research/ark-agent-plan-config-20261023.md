# 火山方舟 Agent Plan 测评配置（2026-10-23）

用户仅授权提交方案、配置后续测评所用方舟入口；本轮改进仍未开工，没有启动服务、连通性调用或模型评测。方案提交为`6a8ba1c`，分支为`codex/agent-result-grounding`。

## API Key 填在哪里

本机文件：`/Users/lau/.codex/worktrees/agent-result-grounding/berserk/experiments/harness-lab/.env.local`。

只需填写`LLM_API_KEY=`右侧的值。文件权限为600，已被Git忽略，不复制旧DeepSeek Key、不提交真实凭据。可提交的空Key模板见[.env.ark-plan.example](../../../../experiments/harness-lab/.env.ark-plan.example)。

| 配置 | 值 |
| --- | --- |
| LLM_PROVIDER | volcengine-agent-plan（本项目自定义provider标识） |
| LLM_MODEL | deepseek-v4.1-flash（按当前Flash型号配置，非V4旧版或economy） |
| LLM_BASE_URL | https://ark.cn-beijing.volces.com/api/plan/v3 |
| 协议 | 复用当前Pi的openai-completions，即Chat Completions兼容接口 |
| LLM_CONTEXT_WINDOW | 1048576 |
| LLM_MAX_OUTPUT_TOKENS | 393216 |

地址末尾不包含用户消息中的中文逗号，不额外拼`/v1`；SDK负责请求`/chat/completions`。上下文与输出值为官方模型容量，不是已批准的整轮用量预算；新测评的单请求参数和总预算仍需冻结和审批。

使用[Agent Plan控制台](https://console.volcengine.com/ark/region:cn-beijing/subscription/agent-plan)中的专属Key，不能用Coding Plan或普通后付费Key。官方依据：[快速开始](https://ark.volcengine.com/region:cn-beijing/docs/agent-plan-personal-get-started)、[Pi配置](https://ark.volcengine.com/region:cn-beijing/docs/agent-plan-personal-pi)。后者直接列出上述OpenAI兼容地址、Flash模型ID和容量。查阅日期2026-10-23。

## 本次生效范围与后续前提

- 只为新worktree创建本地环境文件。main、旧空间worktree、线上服务及其保存的模型设置均未修改；没有改全局Pi或Codex客户端配置。
- 本项目现有服务启动命令会读取本目录`.env.local`，但环境中已导出的同名变量可能覆盖env-file；已有数据目录中的模型设置也可能覆盖启动配置。以后执行前核对有效provider、完整base URL、model和容量，只报告Key是否存在，不输出Key。
- R5/R6历史执行器仍调用`r3-20261022/live.ts`的`liveEnvironment`：它只允许DeepSeek官方地址，并强制`deepseek-v4-pro`、100万上下文和4096输出。它不会因为本次新增配置就变成方舟Flash执行器；不得直接运行，也不修改已冻结历史代码。
- 后续获批实施/测评时，为新批次接入上述配置，并核对网络允许列表、请求观察器、实际请求model与URL、推理参数及用量统计。缺Key、鉴权失败或套餐额度不足时停下，不自动回退DeepSeek官网或方舟后付费地址。此约束目前是待实施要求，不声称新执行器已完成。
- 新批次所有可比较组使用同一方舟Flash模型与参数；历史Pro成绩只作背景，不能将跨provider/模型变化归为Skill收益。旧DeepSeek资费不能用于推算方舟AFP实际扣费；套餐仍有额度限制，预算另批、不自动追加。
- 填入Key不等于授权开测。尚未验证账户权限、连通性、实际模型响应或套餐扣费归属；本次只有配置格式、忽略规则及静态一致性检查。
