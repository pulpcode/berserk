# Berserk 来源选择泛化测试包

版本：1.0.0；编制日期：2026-10-30（Asia/Singapore）。

**交付内容是 8 个主测用例、4 个预留验证用例、真实接口形状的业务 fixture、逐组合标准答案、澄清规则、评分模板和离线校验器。没有运行付费模型，也没有修改 GitHub 分支。**

## 从这里开始

1. 阅读 `TEST-PLAN.md`：8 个主测题干、预置数据、预期行为及各组合名单。
2. 阅读 `PROTOCOL.md`：哪些澄清可以回答、怎样判 main/strict、何时结束。
3. 接入时阅读 `INTEGRATION.md`：复用已有冷启动流程，适配 JSON fixture。现有 runner 不支持直接加载本包，不能把下面的离线命令当成模型测评命令。
4. 首轮只执行 `cases/main.json` 的固定顺序，每题一次。`cases/reserve.json`、`fixtures/reserve/`、`oracles/reserve/` 留给修改冻结后的验证。

## 离线检查

本命令仅使用 Python 标准库，不联网、不调用模型、不修改产品数据：

```bash
python3 tools/validate.py --suite main
```

评测负责人可检查全部编制数据：

```bash
python3 tools/validate.py --suite all
```

交付前已检查 12 题、48 个候选来源/参照来源组合；详见 `offline-validation.json`。检查采用十进制射线法及独立的矩形区间判断，并核对身份、名单、数量、标签、闭合几何、边界距离与跨度。这是 **fixture/oracle 校验**，不等于产品适配已经通过，亦不是模型实测结果。

## 文件说明

| 文件或目录 | 作用 | 是否进入被测模型上下文 |
|---|---|---|
| `cases/main.json` | 8 题题干及固定执行顺序 | 仅发送当前题的 `prompt` |
| `fixtures/main/` | 草稿图层与来源后端数据 | 只进入模拟业务后端，经正常工具可读 |
| `oracles/main/` | 评审答案、身份及固定澄清回复 | 否 |
| `cases/reserve.json`、两个 `reserve/` 目录 | 4 题预留验证数据 | 主测与修改阶段均不提供 |
| `manifest.json` | 分支版本、配置建议、边界说明 | 否 |
| `execution-freeze.template.json` | 接入完成后记录实际运行版本、指令、预算 | 否 |
| `score-template.json`、`results-template.json` | 单题和批次评分记录 | 否 |
| `tools/validate.py` | 纯离线数据与标准答案检查 | 否 |
| `SHA256SUMS.json` | 交付文件的 SHA-256 清单 | 否 |

## 使用边界

推荐基线是分支 `codex/agent-spatial-plotting` 在 `925314f995f1e05f136818bcc18a6bd99c7e9614` 的产品文件（G2 对应 Skill），加上已确定的 Flash 开启思考/high 配置。上一轮 G1 历史现场续跑只作为诊断背景，不与本轮直接合并算正确率。

本包回答“新的来源选择场景还会在哪一步失败”，不能用 8 题或 12 题证明产品整体准确率达到 90%。所有名称和坐标都是合成测试数据，不表示真实地理设施或资源可用性。

预留集采用工作流隔离，未加密。如果修改 Skill/工具的人员或 Agent 已读过其具体题目、数据或答案，应将它标为回归集，不能再称为未见验证集。
