# 测评器 v3 检查记录（2026-10-28）

## 结论

测评器修正已完成：不再重复发送原题；只有冻结的窄澄清请求可代答；解释性证据不足保留待复核；实际请求、响应、原题轮次与协议接受轮次分别记录。原评分规则和历史证据未改。此次全部provider返回均受控模拟，真实模型请求为0，不能算业务能力改善证明。

## 检查结果

- 完整离线套件第一轮 **18/18通过**：30槽HTTP夹具准备、4槽原生Pi受控读写与真实CAS、预算/参数/失败证据/关键错误停批、旧结束语回归、C09解释无echo。
- 复核后进一步收窄车型/方向问题，增加结构化选项污染负例；成功响应在关键效果错误判定之前计数，并新增重复写失败时仍计入实际响应的断言。受影响套件 **10/10通过**（含2项真实本机HTTP测试）。未重复运行未变的30夹具准备等慢测试。最终源码共19个测试定义；完整18项结果与追加/受影响10项结果分开记录，不宣称最终全量重跑19项。
- 最终 TypeScript 与 ESLint 均通过。
- `evaluation/`、`evaluation-v2/` 无本轮修改；v3复用v2文件并将其纳入冻结清单。

命令均从 `experiments/harness-lab` 执行：

```sh
node --import tsx --test --test-concurrency=1 ../../.trellis/tasks/10-26-agent-plotting-integration/evaluation-v3/*.test.ts
node --import tsx --test --test-concurrency=1 --test-name-pattern='scripted|structured|clarification|endings|conditional|optional|settled|explanatory|uncertain explanation|duplicate same-value' ../../.trellis/tasks/10-26-agent-plotting-integration/evaluation-v3/*.test.ts
node_modules/.bin/tsc --noEmit -p ../../.trellis/tasks/10-26-agent-plotting-integration/evaluation-v3/tsconfig.json
node_modules/.bin/eslint --config eslint.config.js ../../.trellis/tasks/10-26-agent-plotting-integration/evaluation-v3/*.ts
```

HTTP服务需要本地监听权限。首次沙箱运行有8项通过、4项失败，均在模拟服务启动处终止，没有真实provider调用。随后批准本地隔离HTTP权限，完整套件通过。另有一次新增测试写入命令使用了错误工作目录而报文件不存在，未写入文件；纠正路径后执行成功。

## 可追溯证据

临时证据根目录：`/var/folders/td/741qp46d52b2b8_2zdzj7ps40000gn/T/`。目录不会被覆盖；系统可能清理临时目录，因此不将其当成永久归档。

| 批次 | 证据子目录 | 结果 |
| --- | --- | --- |
| 全量30槽准备 | `plotting-integration-eval-PJYJnt/batch` | 30槽；provider请求0 |
| 原生读写/CAS | `plotting-integration-eval-PL259A/batch` | 4槽；受控provider调用16 |
| 首轮重复写 | `plotting-integration-eval-67H79t/batch` | 受控调用4；关键错误停批 |
| 首轮C09无echo | `plotting-integration-eval-Wh0dE4/batch` | 受控调用2；每槽只发送1轮 |
| 最终重复写/响应计数 | `plotting-integration-eval-HDlJiZ/batch` | 受控调用4；业务失败仍记成功响应1 |
| 最终C09无echo | `plotting-integration-eval-edDQCi/batch` | 受控调用2；每槽sent=1、successfulResponse=1、respondedUser=1、completed=0 |

首次沙箱失败证据分别为 `plotting-integration-eval-SIzAjl/batch/C01-1/failure.json`、`plotting-integration-eval-t93BHX/batch/C03-1/failure.json`、`plotting-integration-eval-s3Ww6K/batch/C03-1/failure.json`、`plotting-integration-eval-uLRzNp/batch/C09-1/failure.json`；均为“模拟服务启动失败，请核对本期模拟配置”。

## 回归边界

覆盖真实C09原句，以及证据不足解释与必须提供输入之间的相邻反例；C02到场/移动问题、C08障碍/含义问题、坐标/图层请求、跨句关键词、structured options、后续可选邀请、发布/删除要求不会获得冻结答案。未知句式可能产生更多待复核，这是保守边界，不代表已全面理解自然语言。C02/C08冻结答案只服务于原题，不用于用户产品交互。

后续真实诊断必须单独冻结版本与证据，保持原始失败，不用本轮离线通过覆盖旧模型成绩。
