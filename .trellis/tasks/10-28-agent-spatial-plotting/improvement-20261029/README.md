# 本轮执行入口

计划与授权分别为plan.md、authorization.json。所有历史24/30项文件不变。本轮独立证据目录建议 `.local/agent-spatial-plotting-improvement-20261029/live`，必须不存在；驱动拒绝覆盖和重用同一freeze claim。

## 冻结与启动

独立离线复核通过后，在experiments/harness-lab运行 `node --import tsx <本轮run.ts绝对路径> freeze <本轮records/freeze.json绝对路径>`。事先创建records目录。freeze文件和实际运行授权文件必须放records等子目录，不能放本轮根目录（根目录TS/JSON纳入freeze）。

读取freezeHash，写records/run-authorization.json：`approvedByUser:true`、该freezeHash、`limits:{requests:360,input:8000000,output:200000}`。根目录authorization.json保留用户原始授权，不在真实批次中改写。不要更改候选、代码、task-list或review-protocol，所有这些在每次请求前重验。

在同一个包目录，以已配置环境启动：

```sh
node --import tsx --env-file=.env.local <本轮run.ts绝对路径> live <全新证据目录绝对路径> <records/run-authorization.json绝对路径>
```

仅使用已批准Agent Plan Flash配置；不额外连通探测。不能退出后自动重启live，不能自动追加或重跑任务。所有已返回证据保留。

## 接续复核

驱动把当前待复核事项写入证据目录pending.json并保持服务存活。

- ending：读取checkpointPath的完整原生会话/地图，按review-protocol判断已作答可advance，或真实追问选择一个允许的冻结replyId。正常答错应advance并在评分记失败。
- interaction：读取evidencePath，通过原生AskUser回答。只选allowedReplies中的冻结回复，多问题可用answers数组映射questionId/replyId；不猜回答。
- browser：只检查T07同一真实保存对象，确认几何、plan与note，不再保存或重新造对象。写checked:true、checkpointHash、reviewer、reason。
- first6：前6项流程与证据检查通过后写pass:true、checkpointHash、reviewer、reason。业务错误单独评分，不因某组答错而否决流程；流程错误/预算/平台错误按计划停。

决定文件写到pending.decisionPath，需完整匹配checkpointHash并署名和理由。不用超时当批准；hold保留现场并等待下一个决定文件。完成48项后停止，不自动重试。组别/正确率/失败原因需逐项语义复核，不从调用成功直接得分。
