# 来源标注改进：隔离真实模型验证

使用 Node 24，在 `experiments/harness-lab` 运行。读取既有模型配置；只发送新建的合成任务和地图数据。不会触达线上任务，不需要 Docker，也没有工作分派、文件交接或自动审批。

```sh
LAB_EXECUTION_ENABLED=false npx tsx --env-file-if-exists=.env.local scripts/probe-source-annotations.ts --prepare-only --runs 1 --cases main --port 4339
LAB_EXECUTION_ENABLED=false npx tsx --env-file-if-exists=.env.local scripts/probe-source-annotations.ts --runs 3 --cases all --port 4339
```

第二条明确调用真实模型。`--cases main` 仅执行独立主流程，`--cases special` 仅执行四项专项；`--runs` 限制为 1～3。`--prepare-only` 完成账号、来源、任务、空草稿/图层准备，不发模型消息。无 Git 的源码包设置 `SOURCE_ANNOTATIONS_REVISION` 留存代码版本。不要为了变绿连续追加批次。

每轮使用独立账号、任务、mock 实例和会话。主流程有三条业务指令：复用来源西区/道路/车辆上图；发布固定第一版但不采用；来源通道恢复后刷新同一标注并保存草稿新修订，保持旧发布。指令不提供工具名、正确坐标或修订答案。空草稿/讨论图层由驱动预建，属于明确测试前置准备，不冒充模型自动创建。

专项分别是用户明确给定坐标的自定义区域、来源区域缺少几何、来源离线、两个集合点下的歧义操作。缺几何通过驱动精确拦截本轮 mock `/situation/objects` 响应，仅删除西区对象的 `geometry`；真实 HTTP 的原始返回与服务实际收到的注入返回并存，不新增产品控制接口，也不把未交给服务的原始坐标算成 Agent 已读证据。离线使用现有 mock control，两个来源均离线。专项使用新试验目录，不继承主流程答案。

任何待处理交互都会保存并取消，没有自动回答或批准。歧义专项中提问后取消属于可审阅的观察；主流程发生此情况则记为未完成。保存每步实际 SSE、完整会话状态、工具返回与 usageSummary、前后草稿/发布/当前版本、来源原始及实际响应、最终 provider JSON 正文（不含认证头）、脚本和 fixture hash。证据目录在标准输出中给出；只保留本地私有目录，不将凭据或完整证据入 Git。

`protocol_completed` 仅表示三步请求及固定发布已经完成，**不表示语义验收通过**。`checks.json` 记录几何对照、对象编号、旧发布和当前指针；仍须独立核对每个来源引用修订/查询时间、模型正文时区、工具错误和无依据推断。自定义专项不要求来源几何相等；缺几何/离线/歧义的无写入只是机制观察，必须同时查看最终解释。原始失败全部保留，没有循环重跑。
