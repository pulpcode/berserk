# 实施与验证记录

## 2026-10-17 调用前

- 方案先提交 `39d4a80`，之后建立 `codex/map-query-native-evaluation`。
- 产品基线 `8cab905`；开始时 src/、fixtures/、锁文件与基线无差异。
- 本机已有配置：deepseek / deepseek-flash / https://api.deepseek.com；凭据存在，未打印凭据。真实批次单独限制输出2048和请求60秒，不改配置文件。
- 现有定向测试：probe-map-query-cases、probe-map-query-scope、pi/provider-payload、pi/annotation-workflow、pi/annotations，合计51项通过。第一次沙箱运行50通过、1因127.0.0.1监听EPERM失败；同一HTTP测试文件获得监听权限后5/5通过。这是环境权限重跑，不是真实模型样本重跑。
- 调用前尚无真实模型新结果；真实批次结果见下面的执行后记录。

## 测试落点补充

任务目录增加 package.json（仅 private/type:module）、tsconfig.json 和 native-smoke.test.ts，分别解决任务目录 ESM 执行、显式类型检查、实际 HTTP→Pi→工具链确定性验证；没有修改产品 package/lock 或运行机制。已有 ask 仅增加末尾可选 annotationRefs，默认请求字节不变。

首次 prepare-only 的预检目录 `.local/map-query-native/preflight-implement-20261017` 因 Git 中文路径的引号转义导致文件哈希读取失败，真实外发0次；保留失败，改用 Git NUL 分隔读取。这是付费样本开始前的测试驱动故障，不计入15条模型测评。

## 最终调用前关口与真实执行

- trellis-check复核：新增单元测试13/13、实际HTTP→Pi确定性smoke 2/2；包与任务独立TypeScript/ESLint均通过，git diff --check通过。
- 成功prepare-only：`.local/map-query-native/preflight-review-20261017`，15/15准备，0 provider外发，stop=null，服务全部关闭。
- 真实命令（experiments/harness-lab）：`node --import tsx --env-file-if-exists=.env.local ../../.trellis/tasks/10-17-map-query-native-evaluation/run.ts run live-20261017-native-01 4450`。
- 使用现有已授权DeepSeek凭据及合成任务数据；批次15/15终态、53请求，未替换/重跑。15查询状态不变，5前置编辑正确；13/15严格通过，业务主问题14/15，详见results.md。
- 实际所有15首轮输入无助手/工具预置历史，F1/F3无隐藏目标ID或答案；53次工具schema一致，20原生请求均succeeded。
- 结束后核对冻结时所有文件hash均一致，再更新文档；src/fixtures/package/lock与8cab905无差异。
- 4450～4464无残留监听；25份原生会话JSONL已从隔离临时目录复制到批次native-sessions，保留完整证据，不复制账号/服务密钥文件。
- 双份独立人工复核得分一致；无新模型请求、产品修复、push、部署。

## Pro 同协议对照

新增模型配置测试与原单元共14/14通过，任务tsc、ESLint及diff检查通过。prepare-only 15/15、0外发；live-20261017-pro-01完成15/15、63次200响应，输出模型均为deepseek-v4-pro，thinking disabled与2048上限不变。产品/场景/评分hash核对一致；初始输入无隐藏答案。25份原生会话已保留，350份证据索引已核对，服务停止。本轮只有单人语义初评，T06范围歧义须单列；不把初评当双份复核。详见pro-results.md。
