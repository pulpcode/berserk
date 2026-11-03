# 本轮运行器

仅本任务目录新增执行代码。产品归档固定为333cb5161ccd991d586c832430d96c7c18cdee5a；复用旧budget/provider和resource-evidence-v2接续，旧文件不修改。20槽为P01—P04、N01→N08、N08→N01；prepare核对题包schedule.json的slots完全相同。不开整题重试，不补跑，不设余额登录门槛。

每槽创建独立账号、任务、会话与目录。T0由实际本地只读HTTP时钟响应取得并保存原文；source按真实HTTP返回分页、coverage与固定asOf。导入副本走AnnotationService.fromSource，再仅改展示名称，保存回执和实际固定版本。所有初始引用通过真实桌面操作发送；P01额外验证普通点击不产生引用。N08第二轮沿用原生历史中的同一固定图层；P04在首轮完整固定query结果存在后更新来源，再发送原定第二轮，不向模型泄露新状态。

冻结包含题包、oracle文件hash（运行器不导入答案）、评分/接续依赖、运行器、产品全部归档文件、完整node_modules递归文件与符号链接目标、Node及显式启动的Chromium程序及其bundle。每次模型请求前完整核对，运行中依赖扫描放入异步子进程，避免同步大目录读取阻塞HTTP/Pi事件循环。请求JSON不改写，使用产品configuredRuntime的Flash high；预算仍240请求/800万输入/100万输出。提供方原始用量、真实型号与每个HTTP尝试均保留。

从仓库根目录启动：

```sh
node --import ./experiments/harness-lab/node_modules/tsx/dist/loader.mjs .trellis/tasks/11-03-resource-independent-acceptance/run.ts prepare /absolute/new-batch
node --import ./experiments/harness-lab/node_modules/tsx/dist/loader.mjs .trellis/tasks/11-03-resource-independent-acceptance/run.ts run /absolute/new-batch P01-1 /absolute/existing.env.local --browser
```

其余槽用相同run命令替换entry，按schedule顺序执行。P01必须加--browser；其余有引用的题也自动走桌面。prepare不调用模型。执行前在batch/readiness.json保存真实审阅结论：reviewer、offlinePassed=true、materialsReviewed=true。运行目录及槽位均禁止覆盖。

运行器写出*-review.json后等待同名*-decision.json。所有决定必须含reviewer、rationale、kind及对应evidenceHash。只有实际追问可选kind=clarify，另需observed.evidenceId、原句quote、冻结factId；API问题还需questionId及实际optionIds或冻结自由文本。不按关键词自动回复。每槽后填continuation-review.json的reviewer/rationale/continuationAllowed/trajectoryAuditable；若stateChanged需isolatedEffectsVerified。进入正式题前还需public-gate.json明确approved、reviewer与四个公开槽位trials。单题产品失败保留，基础设施/计量/冻结失真停止后续出网。

可调用helper：prepare、execute、buildRuntime、startTrial、selection、preparationClock、startSource、send、observedEvidence、reviewedAction、requireFixedQuery、driveBrowserTurn、offlineBrowser。selection仅作期望/离线断言，live初始引用由浏览器生成。
