# 运行框架与执行交接

本目录仅增加测评代码。运行时以 `git archive 12e1cc9` 创建产品独立副本，未改产品源码或 Skill；前端从该副本构建（包括 public 资源），共享现有安装依赖并冻结两份 Pi SDK 的实际文件 hash。每次模型出网前重新核对产品、SDK 和任务执行材料 hash。`configuredRuntime` 由真实 PiLab 使用，high、1,024,000 上下文、32,768 单次输出均由测试 profile 配置，经实际 SDK 外发验证，不重写请求正文。

`runtime.ts` 建立本地来源 HTTP 服务、正式登录账号、任务及会话；来源经过真实 ContextService。标绘经过真实 AnnotationService 创建、发布、设置任务采用版本和受控导入。每次重复使用全新数据目录、账号、任务和会话。全程 cwd 保持冻结产品包目录，满足原生空间 worker 解析 tsx 的运行环境。

`run.ts` 串行执行冻结排期；P01 使用真实桌面 Chromium 点击，其他题走产品 messages API。每次终答一律暂停完整文本复核，不能由问号或关键词判澄清。复核决定只能选择冻结业务事实，结构化追问按真实 interaction/question ID 接续；普通文本通过下一条正常用户消息接续。预设轮次在终答确认后自动发送，P04 来源变化由控制器单独记录。A02 先前用户报告也是同任务中的真实用户轮，照常计请求。

## 准备与运行

从仓库根目录执行；本地服务器需要环境允许 loopback 监听。准备不读取密钥、不调用模型。

```sh
node --import ./experiments/harness-lab/node_modules/tsx/dist/loader.mjs .trellis/tasks/11-02-task-resource-acceptance/run.ts prepare .local/task-resource-acceptance/<unique-batch>
node --import ./experiments/harness-lab/node_modules/tsx/dist/loader.mjs .trellis/tasks/11-02-task-resource-acceptance/run.ts run .local/task-resource-acceptance/<unique-batch> P01-1 /absolute/path/to/approved/.env.local --browser
node --import ./experiments/harness-lab/node_modules/tsx/dist/loader.mjs .trellis/tasks/11-02-task-resource-acceptance/run.ts run .local/task-resource-acceptance/<unique-batch> P02-1 /absolute/path/to/approved/.env.local
```

P01 命令自己启动 browser helper，并同时监看结构化追问；不要另外重复运行 browser helper。每题默认 localhost:4335，结束后关闭。新实例目录已存在即拒绝，不支持整题重试。正式排期为 A01—A08 重复1，A08—A01 重复2。

准备后的批目录需由复核者填写 `readiness.json`，其中离线与材料审阅必须已有证据。按用户最新指示，平台余额观察为可选信息，不作为启动阻断；原有请求/token预算仍强制执行：

```json
{"reviewer":"实际复核者","offlinePassed":true,"materialsReviewed":true,"platformBalanceObservedAt":"实际平台观察时间 ISO","platformAvailable":true}
```

首次终答或追问后，控制台打印 `*-review.json` 及 `*-decision.json` 路径。读 review 完整 evidence，把其 `evidenceHash` 原样带入 decision。例如：

```json
{"evidenceHash":"原review哈希","kind":"final","reviewer":"实际复核者","rationale":"已完成当前用户轮，未要求继续所必需的信息"}
```

`kind=clarify` 必须附冻结 `factId`；结构化问题另附实际 `questionId`，可附经语义核对的 `optionIds`。不提供自由生成的额外业务事实。`fixture_gap` 保留现场结束本题；`incomplete` 记录模型未完成。超过20请求或30分钟只暂停人工进展查看，使用 `kind=continue` 表示有新证据且可继续；不是自动判失败。

每题完成后审阅 `result.json`、全部对话及 state-before/after，在该题目录写 `continuation-review.json`：

```json
{"reviewer":"实际复核者","rationale":"证据可评分且影响限于本题","continuationAllowed":true,"trajectoryAuditable":true,"isolatedEffectsVerified":true}
```

stateChanged 为 true 时必须实际核对隔离范围后才填 isolatedEffectsVerified。正式题启动前另需批目录 `public-gate.json`：

```json
{"approved":true,"reviewer":"实际复核者","trials":["P01-1","P02-1","P03-1","P04-1"]}
```

这些是测评复核记录，不是追加用户授权；模型业务答案错误但轨迹可评分，仍可通过公开流程门槛。评分由独立 scoring.ts 与人工证据复核进行。

## 预算、时间与限制

240 次实际模型 HTTP 尝试、800万输入、100万输出共用持久 ledger。每次出网先按 UTF-8 请求字节加4096预留输入估计，按 SDK 当次输出cap预留输出；usage返回后用真实值结算，思考不重复累加。实际超预留或缺失usage立即暂停批次；未知用量保留预留，绝不填0。产品原生瞬态重试仍启用、transport重试0；有明确usage的瞬态失败可原生重试并逐笔计账。无usage时原生重试进入同一预算门，被拒绝出网——这是批准方案“未知用量暂停”的优先规则。不能宣称所有提供方错误均在线完成3次重试。

首个实际响应模型版本写入 ledger，后续任务亦比对；漂移暂停。无额外连通性请求。高思考只核对真实请求配置，不要求提供方返回私有思考。

产品业务判断目前直接使用真实 Date，没有注入时钟接口。本批固定全部业务事实时间，正常事实无运行期间的到期临界值，唯一过期事实固定在运行之前；请求时间保留真实墙钟。因此是相同业务事实及有效性状态，不能称服务时钟冻结。禁止 patch global Date；执行前后检查状态有效性一致。

执行环境关闭 Docker 文件执行（题目全部只读资源/空间），没有新增宿主执行通道。地图底图外网在 browser helper 中阻断，不影响本地业务对象；报告须保留此披露。

私有原始请求、响应、原生history、凭据与state保存在 `.local` 批目录，不提交Git。评分答案仅作为文件hash冻结，运行器不解释或注入答案。

## 离线发现及修正

- 第一次准备：共享 node_modules 的 Vite 临时config写入遇沙箱权限拒绝。改为 Vite公开 `--configLoader runner`，不修改产品或依赖。
- 第一次集成：loopback监听被沙箱拒绝，获准在沙箱外运行本地服务测试；无外部模型请求。
- 来源区域对象第一次实际边界解码失败：夹具缺 `properties.memberRefs`。用例作者补空数组并新增完整 SituationObject 解码验证，不为区域补隐式资源关系。
- 原生空间续轮第一次失败：从仓库根执行时空间worker找不到tsx。运行器改为真实产品包工作目录，针对查询→空间→汇总→固定read的5次SDK请求回路已通过。
- 全量回归与最终检查结果见 `checks/offline-tests.txt`、`checks/typecheck.txt`、`checks/lint.txt`。离线提供方均为确定性假响应，不证明模型业务正确率。
