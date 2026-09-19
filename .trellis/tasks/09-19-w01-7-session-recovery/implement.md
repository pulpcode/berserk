# W01-7 实施计划

状态：**已实现，自动验收通过，待用户验收**。沿用现有 Pi、DeepSeek 和 Ubuntu 配置，P1～P4 已完成。

## 实施顺序

| 步骤 | 工作与退出条件 |
| --- | --- |
| P1 补齐验证 | 在隔离数据目录使用真实 Axon／Pi，补测首次请求、工具前后、两类等待及压缩期间退出；检查已有记录能否正确归属，不改 Pi 内核 |
| P2 最小后端调整 | 从既有资源／结束记录判断各请求状态；缩小普通中断的禁止续聊范围；调整旧 pending 在请求边界失效的解析。保留独立异常检查，不新增持久记录或上下文注入 |
| P3 网页适配 | 复用最后请求状态显示中断及必要的缺失结果说明；旧卡片失效，输入可用，快照刷新不重发，不覆盖草稿 |
| P4 验收 | 完成 G01～G15、必要回归及真实模型／Docker 验证；记录结果并更新已实现规范，交用户验收 |

如果测试发现 Pi 或现有记录无法支持具体场景，先说明缺口和必要改动；不能为保持计划而补造结果、恢复旧批准或引入整套恢复框架。

## 实际改动位置

路径相对 `experiments/harness-lab/`。

- `src/pi/lab.ts`、`history-evidence.ts` 及交互／相关历史投影：按既有 requestId 区分活动、结束与中断，正确解析后续请求；复用现有 Pi 生命周期。
- `src/contracts/` 与 `src/web/`：读取结果支持 interrupted，调整最后请求提示、活动缓存、卡片与输入状态。不新增独立中断记录列表或时间字段。
- `src/execution/`：验证现有初始化清理；仅在发现实际缺陷时修正，不新增恢复状态机或容器接管。
- `tests/`、`scripts/`：复用既有测试设施验证崩溃、重启、续聊、交互及真实文件效果。

无需增加依赖、API 路由、数据库、历史格式或迁移；现有 AGENTS.md 提醒和 Pi 默认压缩维持原样。

## 验证

```bash
npm --prefix experiments/harness-lab run typecheck
npm --prefix experiments/harness-lab run lint
npm --prefix experiments/harness-lab test
npm --prefix experiments/harness-lab run test:e2e
npm --prefix experiments/harness-lab run build
git diff --check
```

- 核心中断点使用测试自身创建的子进程 SIGKILL；不能用正常关闭或浏览器断线替代。确定性传输验证机制，真实 DeepSeek 验证实际续聊，分别记录。
- 打开、重启与多次 GET 前后比较 JSONL 字节和文件效果；均不得增加模型／工具调用。显式新消息正常追加，旧消息不重发。
- 测试先中断、再完成新请求、再次重启，以及连续两次中断；旧请求的缺失结果和新请求的正常结果不能混淆，旧 pending 不能挡住新交互。
- 真实 Docker／模型验收使用独立 Ubuntu 进程和测试文件，不终止用户现有服务。核对真实效果，不只看模型自述；相同新调用可能重复效果的对照已有独立证据可复用。
- 结果写入 `research/validation-results.md`，尚未验证的项目保留待验证，不保存凭证。测试时限不进入产品默认配置。

## 交付

完成后更新相关 backend／frontend 规范。部署前备份会话、索引和工作区，先用隔离副本验收；无需格式迁移，回退不删除历史。所有提交信息以中文为主体。

实现和验证完成后，已按用户后续授权提交、推送并更新服务，结果见 [验收记录](research/validation-results.md)。
