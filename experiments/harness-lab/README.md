# W01-1：多轮对话实验

基于 Pi SDK 的本地 Web 多轮对话：新建／切换独立会话、流式回答、按 ID 读取两份示例资料、停止、错误提示和原生历史保存。当前只覆盖 S0、S1；完整 Run、确认、Memory、Skill、压缩、Subagent 和外部调度尚未实现。

2026-09-16 已使用 DeepSeek Flash 完成 C01～C06 首增量验收：真实多轮、工具、隔离、取消及独立进程重启续聊通过。详情见下方验证记录；不代表完整 W01 或业务 MVP 完成。

## 启动

需要 Node.js 24 和 npm。首次安装：

```bash
cd experiments/harness-lab
npm ci
cp .env.example .env.local
```

如 `.env.local` 已存在，直接编辑，避免覆盖已有密钥。配置：

```dotenv
LLM_PROVIDER=deepseek
LLM_MODEL=deepseek-flash
LLM_BASE_URL=https://api.deepseek.com
LLM_API_KEY=在本地填写
```

```bash
npm run dev
```

访问 http://127.0.0.1:5173 。API 在 127.0.0.1:4310；服务仅监听本地回环地址。修改配置后重启 API。无密钥也可打开页面、管理会话，发送消息会明确提示未配置。

构建后单服务运行：

```bash
npm run build
npm start
```

访问 http://127.0.0.1:4310 。此实验暂不部署到 Ubuntu，也未提供多用户登录。

## 使用与保存

- 新建会话后输入任意问题，支持连续追问和纠正。Enter 发送，Shift+Enter 换行；中文输入法选词不会发送。
- 可尝试“读取项目讨论纪要，整理待确认事项”，再追问“把培训时长改为 60 分钟后应调整什么”。示例资料为虚构通用文本。
- 切换会话不会停止正在执行的请求；各会话的上下文和未发送草稿独立。草稿保存在当前浏览器标签页的 sessionStorage。
- 点击停止后等待执行收敛。忙时不接收第二条消息，不自动排队；刷新／断线不会重发消息。
- 历史保存在 `.local/sessions/` 的 Pi 原生 JSONL 文件内。正常完成的会话可以重启续聊；运行中崩溃不自动续跑。检测到未完成协议历史时保留原记录并提示新建会话。
- `.env.local`、`.local/`、构建和测试产物均被 Git 忽略。密钥仅在服务端使用；不要把真实凭证写入 `.env.example`。

## 单次请求限制

| 配置 | 默认值 | 意义 |
| --- | --- | --- |
| REQUEST_TIMEOUT_MS | 90000 | 整个用户请求的总时限，含工具循环 |
| MAX_TOOL_CALLS | 4 | 实际工具调用数上限；模型请求最多为该值 + 1 |
| MAX_OUTPUT_TOKENS | 2048 | 每次模型输出上限；达到截断时明确提示 |
| LAB_DATA_DIR | .local | 实验历史目录，相对本工程目录 |

用户已选择 deepseek-flash，当前显式发送 `thinking: {type: "disabled"}`。验收不设置 10 条请求总量限制；每次调用仍受上述边界约束。模型目录注册的价格为占位值，不能当作真实费用统计。

逻辑工具名为 `source.read`，DeepSeek 协议侧使用符合函数名约束的 `source_read`，公开页面仍显示 `source.read`。关闭默认文件／Shell 工具、扩展、Skill、上下文文件自动发现，以及自动压缩和重试。

## 验证

```bash
npm run typecheck
npm run lint
npm test
npm run test:e2e
npm run build
# 下列命令会实际调用配置的模型并消耗额度
npm run probe:live
npm run probe:live -- --case C02
```

浏览器测试首次运行如提示缺浏览器，可执行 `npx playwright install chromium`。普通测试使用确定性模型流但运行真实 Pi 会话／工具／历史代码，不访问外部 API。浏览器测试使用受控 API 响应验证界面；这些均不替代真实模型验收。

真实探针按 C01～C05 验证多轮、工具、隔离、取消和历史重载，证据写入被忽略的 `.local/probes/`；C05 脚本重建运行时，实际进程重启和页面交互需另外检查。C06 通过依赖检查和集成测试验证。完成情况见 [验证记录](../../.trellis/tasks/09-16-w01-harness-validation/research/validation-results.md)。

官方依据（2026-09-16 核对）：[DeepSeek 更新记录](https://api-docs.deepseek.com/updates/)、[Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion/)、[Pi SDK v0.85.1](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/sdk.md)。
