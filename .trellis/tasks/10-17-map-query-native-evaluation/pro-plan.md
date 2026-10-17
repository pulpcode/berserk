# DeepSeek Pro 完整流程对照增补

2026-10-17，用户已授权执行。保持原3类场景各5次、产品代码、工具/提示词/Skill和review-rubric.md不变；只调整任务内测评脚本的模型配置及其定向测试。

- 配置：`NATIVE_EVAL_MODEL=deepseek-v4-pro`，现有DeepSeek端点/Key，thinking disabled，max_tokens=2048，请求60秒，每条6次、全批90次请求、输入200万/输出6万预算。未设置新变量仍为Flash。
- 容量：宿主原生配置仅预置Flash容量；测试进程显式传入两者相同的1000000，不改产品配置或模型目录。与Flash原先默认1000000等效。官方依据：https://api-docs.deepseek.com/quick_start/pricing/ 。不追加思考参数或采样参数。
- 按F1→F2→F3重复5轮，每条独立夹具；F2前轮编辑由Pro真实完成，随后自行决定比较路径。先prepare-only零外发，再冻结全部夹具。错误样本不替换，不人工补答；鉴权、额度、缺失usage、安全问题按原规则停止。
- 对照已有Flash批次live-20261017-native-01，不重跑Flash，不重放它的工具调用，也不向Pro提供错误提示或隐藏答案。这是同协议历史批次对照，不是逐字相同上下文续答或同期随机A/B。独立UUID、时间和前轮模型回答自然变化。
- 原主问题正确、全回答/中途事实准确、操作正确、严格通过口径不变；明确检验整图/图层数量混淆与A甲/B乙误配。所有新错误同样计入，不只盯原两类。
- 真实请求核对model、thinking、输出上限和工具schema，保存输入/响应/回执/前后快照/原生会话。复用既有证据留存和审阅规则；若仅单人评分须披露，不冒称独立双评。
- 交付pro-results.md、pro-ratings.json、pro-dialogue-excerpts.md、pro-evidence-index.json。raw留在.local；不提交Key，不部署，不修改默认服务模型，不自动commit/push。

运行命令（experiments/harness-lab）：

```sh
NATIVE_EVAL_MODEL=deepseek-v4-pro node --import tsx --env-file-if-exists=.env.local ../../.trellis/tasks/10-17-map-query-native-evaluation/run.ts prepare-only preflight-pro-20261017-01 4470
NATIVE_EVAL_MODEL=deepseek-v4-pro node --import tsx --env-file-if-exists=.env.local ../../.trellis/tasks/10-17-map-query-native-evaluation/run.ts run live-20261017-pro-01 4470
```
