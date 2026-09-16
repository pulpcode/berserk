# 模型与本地运行条件

核验日期：2026-09-16。本文保留规划阶段研究；W01-1 已安装应用依赖并完成真实 DeepSeek 验证，当前结论见 [验证记录](validation-results.md)。未连接 Ubuntu。

## 已有条件

用户已有 DeepSeek、Kimi 等 API 和 Ubuntu 主机。当前开发机实测为 Node.js `v24.14.0`、npm `11.9.0`、Python `3.14.3`；规划阶段仓库尚无应用工程；2026-09-16 已启动 W01-1，实际工程与状态见 [验证记录](validation-results.md)。已有前后端规范大多为占位模板，不能视为技术栈已定案。

## 接入结论

| 对象 | 官方资料核验 | 对本任务的影响 |
| --- | --- | --- |
| DeepSeek | [Tool Calls](https://api-docs.deepseek.com/guides/tool_calls/) 描述模型提出工具调用、客户端回传结果；[Thinking Mode](https://api-docs.deepseek.com/guides/thinking_mode/) 对携带 tools 的历史 reasoning_content 有保留要求 | 接入层保留所选模型要求的原生消息字段；首轮与多轮工具测试均需真实通过，不能只测一句问答 |
| Kimi | [API Overview](https://platform.kimi.ai/docs/api/overview) 列出 Chat Completions 地址 `https://api.moonshot.ai/v1`；[Thinking Models](https://platform.kimi.ai/docs/guide/use-thinking-models) 中各模型的 thinking 参数、历史保留要求不同 | 由用户确认账号对应的端点和可用模型；不能把国内／国际／Coding 套餐凭证视作可任意互换，也不能统一强制关闭 thinking |
| Node.js | [官方发布表](https://nodejs.org/en/about/previous-releases) 列出 Node 24 为 LTS | 实验优先 Node 24；安装时核对依赖 engine 和最新安全补丁，当前机器有 Node 不代表依赖已兼容 |
| API 与页面 | [Fastify LTS](https://fastify.dev/docs/latest/Reference/LTS/) 和 [Vite Guide](https://vite.dev/guide/) 提供运行要求与 TypeScript／React 入口 | 建议 Fastify 5、React + Vite；安装时固定实际版本并验证 Node 24，不把文档推荐写成测试结果 |
| 原型存储 | [better-sqlite3 README](https://github.com/WiseLibs/better-sqlite3) 提供本地 SQLite 事务访问，部署受原生依赖构建／预编译包条件影响 | 首步不安装；S3 平台存储候选，届时验证安装、事务与重启；M1 多进程数据库定案须有单独证据 |

首增量先用一组真实端点／模型，优先验证 Chat Completions 兼容协议；不要求首步适配第二提供方，也不承诺本轮所有模型通过。具体 model ID 不在设计中猜定，真实调用前根据账号补齐。

模型原生上下文缓存不替代 AGENTS.md 式持久指引文件。文件按工作区加载、编辑和重载；历史及压缩另行管理，不建设结构化记忆数据库。保留原生协议字段是为了正确续接模型请求，普通页面不展示内部思考内容。

## 真实接入前需补齐

1. 提供方、账号对应 `baseURL`、准确 `modelId`、thinking 模式及模型上下文上限。
2. 是否需要代理、已知限流与可接受的测试调用预算；默认不会在普通自动测试中启动真实调用。
3. API Key 由用户在项目的 `.env.local` 配置，Git 忽略且只由服务端读取。设计阶段不要求提供。

首步 C01～C06 覆盖真实多轮、最小工具与追问、取消、基本限制及原生完成历史重载；压缩、确认恢复和平台重建在 S2～S4 按 T 用例验证。保存模型标识、依赖版本、测试时间、脱敏请求结构和结果引用，不记录 Authorization 或原始密钥。

## 推迟到有需求时再索取

Ubuntu 不阻塞本地设计或开发。需要部署验证时，再索取主机地址、SSH 端口、用户名、认证方式与系统／资源信息；优先使用用户本机 SSH 配置或密钥，密码通过适当的本地登录方式使用，不写入文档或 Git。W01 不包含公网部署，正式 Ubuntu 交付仍属于 W13。

## 尚待实测的技术风险

- 内核内置 provider 是否跟上所选模型的 thinking 与原生消息格式；必要时局部替换 provider 适配，不另造一套 Agent 循环。
- 压缩后的新上下文如何满足所选模型协议：保留近期完整工具块；旧块整体用有来源的摘要替换；不留下缺失结果或原生字段的半个工具回合。
- Token 估算与服务端实际计量有误差；预算保留安全余量，usage 缺失时标记估算，不报告虚构的精确费用。
- S3／S4 再验证 SQLite 驱动、原生历史向平台保存的转换，以及恢复／并发；这些风险不作为首步阻塞，但仍影响长期路线。

## W01-1 已确认接入（2026-09-16）

用户已选 DeepSeek 默认端点和 deepseek-flash。官方当前文档已核验，旧 deepseek-chat 不再作为首步配置。显式关闭 thinking，使用 OpenAI-compatible Chat Completions，经 Pi 原生工具循环调用；不设真实验收总请求数上限，保留单请求执行边界。配置入口为 experiments/harness-lab/.env.local，用户已配置密钥，真实多轮、工具、取消及进程重启续聊已通过。
