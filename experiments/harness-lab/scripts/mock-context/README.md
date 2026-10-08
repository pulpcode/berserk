# 多源能力验证用模拟服务

本目录独立维护合成报告、对象和变化，不包含 Axon 任务或研判答案。应用宿主只能经 HTTP 查询，禁止把本目录挂到 Agent 工作区或导入应用运行路径。它不是未来特情／态势产品的数据模型。

在 harness-lab 目录中启动（查询令牌自行保存在本地环境变量）：

```sh
export MOCK_CONTEXT_CONTROL_SOCKET=/tmp/axon-mock-context.sock
npx tsx --env-file-if-exists=.env.local scripts/mock-context/main.ts
```

必须设置 `MOCK_CONTEXT_API_TOKEN`；默认仅监听 `127.0.0.1:4401`，可用 `MOCK_CONTEXT_PORT` 修改端口。Axon 使用 `fixtures/context-config.example.json` 的绝对路径作为 `LAB_CONTEXT_CONFIG`，在宿主配置同一查询令牌。入站通知的来源令牌另行配置，不复用查询令牌。

控制脚本经权限 0600 的本机 Unix socket 工作，不新增任何公开控制 API：

```sh
npx tsx scripts/mock-context/control.ts reset
npx tsx scripts/mock-context/control.ts advance intel
npx tsx scripts/mock-context/control.ts event E1
npx tsx scripts/mock-context/control.ts advance situation
npx tsx scripts/mock-context/control.ts event E2
npx tsx scripts/mock-context/control.ts advance unknown
npx tsx scripts/mock-context/control.ts event E3
npx tsx scripts/mock-context/control.ts unavailable situation on
npx tsx scripts/mock-context/control.ts requests
```

`advance` 只改变外部事实，`event` 只输出通知 JSON；二者都不会自动发送消息或调用模型。测试驱动把通知 POST 到 Axon 既有 `/api/integrations/:sourceId/events`。Axon 任务的创建、S6 时间变体和 S7 需求互换由 Axon API 完成，不在模拟系统维护。重复发送同一通知用于核验 Axon 原有去重。

`reset` 恢复 S0；先后 `advance intel/situation/unknown` 对应 E1/E2/E3。S3 可从 S0 直接推进 situation。`unavailable situation on/off` 验证 S5。`advance contract` 仅供接口测试，增加第二条资源变化和未知观测时间报告，不用于主场景真实模型验收。

变化游标含实例代次，须读取实际 `changeCursor/nextAfter` 或 event E2 的内容，不要硬编码文档中的 seq-100/101。reset 后旧变化游标失效；推进/重置后旧分页游标失效。`requests` 只记录方法、路径和 HTTP 状态，不记录认证头。

测试可导入 `createMockContextServer({token})`，调用 `listen()` 获得真实 HTTP 地址；控制函数仅由测试进程持有。退出后调用 `close()`。
