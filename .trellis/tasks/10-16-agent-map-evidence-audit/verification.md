# 实施与测评记录

2026-10-16。方案提交 `1282d46`，候选分支 `codex/map-read-evidence`，产品基线 `3064bc6`。用户已明确批准本轮实施与方案内有界合成评测。

## 本地候选

仅产品 `src/pi/annotation-results.ts` 新增范围摘要；三处定向测试随之扩展。没有改模型、工具描述、系统提示、Skill、服务、HTTP、状态机或hook生产代码。

实施代理按design中的两条npm test命令运行11文件：146个唯一测试通过。初次本地listen EPERM导致1项环境失败，获准提升权限后该文件5/5通过；未修改代码解决端口限制。npm run typecheck、npm run lint通过。原生历史、压缩、损坏回执沿已有用例验证。

新增重放驱动4项node:test通过，检查真实服务夹具、离线准备、冻结完整性、A/B差异白名单、预算、无结果/截断、顺序与重复运行拒绝。初版驱动将数组形式content误按对象引用比较，离线测试识别后改为深值比较；未外发模型请求。

## 调用前冻结

输出目录：`.local/map-read-evidence/2026-10-16-read-summary-s1`。

manifest SHA256：`3ec9be0831be209996e6f213f0116b13c64fdfcf7f45d87cc4374c0830b49a36`。

12份A/B请求（历史3例、新3例）、新例完整服务证据、评分规则、候选差异、锁文件及相关源码hash在第一次调用前冻结。新例使用隔离显式测试身份及真实AnnotationService，不接触正式任务。生成阶段fetch禁止外发。

实际命令（在experiments/harness-lab）：

    node --import tsx --test ../../.trellis/tasks/10-16-agent-map-evidence-audit/replay.test.mjs
    node --import tsx ../../.trellis/tasks/10-16-agent-map-evidence-audit/replay.mjs prepare --output /Users/lau/workspace/berserk/.local/map-read-evidence/2026-10-16-read-summary-s1

S1已执行30次；以下为追加记录，冻结评分/设计未修改。

## 实际执行与关闭

    node --import tsx --env-file-if-exists=.env.local ../../.trellis/tasks/10-16-agent-map-evidence-audit/replay.mjs run S1 all --output /Users/lau/workspace/berserk/.local/map-read-evidence/2026-10-16-read-summary-s1

- 30/30正常返回，0工具调用、0截断/网络失败；输入393600（含缓存）、输出8686 token。
- 主执行者匿名评分先冻结SHA256：0220becc272ad6bd41dd1df927dd86f9a4a89c4b4a4c9d72d19623b950f3e658；随后解盲。检查代理未读取该评分或映射，独立完成匿名评分。
- 两份评分的完整答案、正确下一步、明确错误、遗漏、技术失败、写入尝试六项指标均30/30一致；歧义/冗余保留各自判断。
- 回退前replay verify通过：冻结源码/输入未变；30份实际请求hash与冻结输入一致，SSE重新解析与结果一致；旧24次证据未变。
- S1-gate.json明确accepted:false；S2/S3 0调用。
- 在确认整个产品差异等于冻结candidate.patch后，只恢复四个拥有文件；撤回后src/tests与HEAD完全一致，候选补丁仍在本任务目录。
- 回退后运行npm test -- tests/annotation-results.test.ts tests/pi/provider-payload.test.ts tests/pi/annotation-hook-boundaries.test.ts：3文件23/23通过。
- 产品无遗留diff；冻结驱动需在隔离checkout重新应用candidate.patch才能运行，不能把它当作当前产品测试。
