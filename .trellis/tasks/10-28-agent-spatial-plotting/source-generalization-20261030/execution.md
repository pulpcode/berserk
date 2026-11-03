# 执行方法与语义复核

工作目录为仓库 `experiments/harness-lab`。所有命令通过现有 Node/tsx 执行；真实调用由根会话在独立复核通过后运行。

## 冻结及启动

1. `node --import tsx ../../.trellis/tasks/10-28-agent-spatial-plotting/source-generalization-20261030/run.ts freeze <绝对路径/freeze.json>`
2. 根据 freeze.json 的 freezeHash 创建授权文件：`{"approvedByUser":true,"freezeHash":"实际哈希","limits":{"requests":96,"input":3000000,"output":300000}}`。
3. `node --import tsx ../../.trellis/tasks/10-28-agent-spatial-plotting/source-generalization-20261030/run.ts live <全新绝对批次目录> <授权文件绝对路径>`。

默认仅读取此前空间工作区的 `.env.local`，也支持 `SOURCE_EVAL_ENV_FILE` 明确提供同一 Flash/Agent Plan 配置文件路径。运行器校验固定端点及模型，不输出密钥。批次目录必须全新；同冻结版本真实调用建立一次性 claim，不自动重启或覆盖旧记录。

冻结后不要编辑本轮顶层源码/MD、题目数据或共享依赖。新增结果报告放 `records/`、`review/` 或其他子目录，不影响冻结源码。默认端口 5408；CLI 不自动占用/关闭其他服务。

## 如何处理待复核项

进程保持原生会话并等待；查看批次 `pending.json`，按其中 evidencePath 读取真实证据，然后在 decisionPath **新建** JSON：

```json
{"checkpointHash":"pending中的哈希","reviewer":"Codex root","reason":"引用实际问题和所问内容，解释为何继续","action":"finish"}
```

`finish` 只表示本题结束，**不是评分通过**。答案错但已结束也可 finish，后续另判失败。

普通文本必要追问：将 action 改为 `reply`，加 `selection:{"axes":["candidate"]}`（资源）或 `reference`（边界）或两项。真实笼统来源问题且未指定哪一项，使用 `selection:{"axes":[],"generic":true}`。程序依据冻结材料生成答复，不能填写任意新文本。

原生 AskUser：action=reply；单问题可用 selection，多问题使用 `answers:[{"questionId":"实际ID","selection":{"axes":["candidate"]}},...]`，必须完整对应当前问题。程序通过原生交互的文本答案提交，不强迫匹配选项，也不改成新聊天轮。

未知业务问题、反复追问无法完成：root确认属于模型偏离而非题目缺材料后，使用 `fail_task`。原生 AskUser 会取消本题当前请求，保存未完成记录并继续下一隔离题。`stop` 用于材料缺口/流程故障等，停止批次。错误哈希、变更的会话状态、非法重复答复均不继续。

资源与边界分别最多澄清一次；已明确内容最多额外重述一次。每次答复的所问项、范围状态和固定文字均落盘。评测器不根据关键词替root决定语义。

## 记录位置与限制

每题保存 fixture、manifest、provider请求/回执、native sessions、全部SSE事件、交互决定、普通回答决定及前后状态。provider原始记录含模型思考，仅留本地受限目录。对外报告/提交前必须剔除思考、认证头及登录凭据，不能直接发布整个临时数据目录。

完整来源状态和草稿状态保留供后续复核，不能因工具调用成功自动判题通过。查询审计等技术变化须单独说明，不能掩盖版本/发布/采用或来源对象变化。

无进展保护复用既有规则：同一用户轮最后三条工具调用的名称、参数和返回内容相同（忽略请求/调用ID）时阻止进一步调用。它是保守的重复证据检测，不等于自动证明模型失败；若触发，原始记录留存供root判定。不同参数、不同返回或新用户答复不触发此条件。

## 离线检查

`node --import tsx --test ../../.trellis/tasks/10-28-agent-spatial-plotting/source-generalization-20261030/run.test.ts`

`npx tsc --noEmit -p ../../.trellis/tasks/10-28-agent-spatial-plotting/source-generalization-20261030/tsconfig.json`

本机隔离 HTTP/Unix socket 需要允许监听。测试 provider 是构造响应，不访问模型端点。当前模拟管理契约要求同时注册 intel 与 situation；前者只保留空报告目录，后者完整替换为题包对象，没有旧地区/道路或任务业务引用。
