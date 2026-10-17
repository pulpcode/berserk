# 审计与验证

## 调用前

- 原 Pro/Flash 结果已提交 ae7236c；未 push。
- 产品只改 5 个文件；没有改系统提示词、Skill、写入事务、回执、hook、数据库、前端或部署。
- Trellis implement 代理完成产品定向检查：8 文件 93/93，补充正式 HTTP 测试后 2/2；package typecheck、lint、依赖边界通过。
- 主代理测评脚本单测 16/16，新旧任务 typecheck、eslint 通过。
- 新任务初次单测启动因缺少 task/package.json 的 ESM 声明而失败，补齐 type:module 后通过；未影响产品或模型试次。
- 独立 check 代理核查权限、固定版本、失败依据、hook、原 ID 兼容，无阻塞缺陷、未修改文件。
- frozen.json 固定 A/B 各 221 个源码/脚本/配置输入及 11 个测评输入；check 代理逐项核对 A 与 git ae7236c 一致。两组差异仅为批准的 5 个产品文件。
- A/B prepare-only 各 14 份 fixture 成功，0 provider 请求；各自服务正常关闭。
- Native Pi 与实际 provider bytes 原样经过原观测器；没有人工构造工具结果或模型上下文，没有把评分材料放入工作区。

## 测评边界

A 先运行，B 后运行；非随机序列，样本小。F2 两组均由 Agent 实际执行前置；N2 的提问只记录，不自动回答或批准。interaction_recorded 不是语义通过，仍逐条审阅具体问题。

每组总上限为 90 次请求/2M input/60K output，单条6次/360秒；失败不换样本。完整性、操作、终答、中途事实分别评分。回执与地图 UI 未变，本轮不重做桌面视觉验收。

## 最终结果

真实流程已完成，结果见 results.md 与 ratings.json。原始 provider/工具/状态及 native JSONL 位于 evidence-index.json 指向的本地隔离目录，未上传远端。

- 运行后A/B冻结输入均0变化；79次provider均200，参数1个变体；除annotation_read外21工具均无schema差异。
- 原始证据497文件、36份native JSONL；任务文件未检出既有凭据值；4490–4523端口无残留监听。
- 独立语义复核与主审对A四条失败一致；B-T02范围措辞保留歧义，最终不计入13条确定通过。
