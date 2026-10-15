# P0—P1 验证记录

日期：2026-10-15。分支 `codex/handoff-reliability`，基线 `fdba343`。本轮仅增加保护测试与审计材料；没有修改业务源码、调用付费模型或访问生产。

## 1. 实际执行与结果

以下 npm / Playwright 命令的工作目录为 `experiments/harness-lab`。日志根目录为仓库下 `.local/handoff-reliability-20261015/`，原始日志不加入 Git。

| 检查 | 实际结果 | 日志 |
| --- | --- | --- |
| `npm run typecheck`（基线） | exit 0 | baseline-typecheck.log |
| `npm run lint`（基线） | exit 0 | baseline-lint.log |
| `npm run build` | exit 0；既有大于 500 kB 的 chunk 提示 | baseline-build.log |
| 14 文件确定性基线 | 316/316，172.07 秒 | baseline-tests-local-listen.log |
| 桌面浏览器确认/交接 | 32/32，约 1.7 分钟 | baseline-e2e.log、baseline-e2e/ |
| 增量保护测试及所属文件 | 3 文件 69/69，64.27 秒 | protection-tests.log |
| 修改后 lint / typecheck / diff-check | 全部通过（exit 0）；独立审阅见 review.md | final-lint.log / final-typecheck.log / review.md |

316 和 69 不是互不重叠的用例，不能相加为 385 个独立测试。此次新增 6 个参数化实例，替换原来的 1 个实例，净新增 5 个；69 覆盖修改后三个文件全部用例。基线日志完成时间为 14:01:28 UTC，测试文件首次写入为 14:02:32 UTC，基线在新增测试前完成。

首次在沙箱执行相同基线命令时，测试夹具监听 localhost 遇到 EPERM；独立 listen 探针也复现该环境错误。该轮由 Ctrl-C 停止（exit 130），日志 baseline-tests.log 保留，不能计为通过，也不算业务断言失败。允许本地监听后完整重跑得出上述 316/316。

### 确定性基线

```sh
npm test -- --maxWorkers=1 \
  tests/collaboration/service.test.ts tests/collaboration/crash.test.ts \
  tests/pi/collaboration.test.ts tests/pi/interactions.test.ts \
  tests/pi/background-runner.test.ts tests/execution/command-policy.test.ts \
  tests/background/service.test.ts tests/background/files.test.ts \
  tests/background/crash.test.ts tests/background/store.test.ts \
  tests/background/configuration.test.ts tests/files/service.test.ts \
  tests/access.test.ts tests/seat-api.test.ts
```

### 桌面浏览器

```sh
CI=1 AXON_E2E_PORT=5193 npx playwright test \
  tests/e2e/handoff.spec.ts tests/e2e/hitl.spec.ts \
  --workers=1 --grep-invert '375px|mobile|cards align' \
  --output=../../.local/handoff-reliability-20261015/baseline-e2e \
  --reporter=line
```

使用新启动的 Vite 服务，不复用可能过期的运行实例。handoff 包含真实本地业务服务、存储与确定性 provider；通用 HITL 部分使用浏览器 mock。两者不能统称真实模型端到端。排除了既有移动端用例，没有添加手机适配或测试。

### 修改后增量

```sh
npm test -- tests/collaboration/service.test.ts tests/access.test.ts tests/pi/collaboration.test.ts --maxWorkers=1
```

新增保护的必要性、观察项和边界见 [protection-tests.md](protection-tests.md)。只修改测试后不重复整套 build/浏览器/316 基线；最终 lint/typecheck 检查新增测试本身。

## 2. 任务书覆盖映射

编号表示本轮已审计并执行的对应断言，不意味着覆盖该编号下所有可能组合。详细测试位置见三份 research 报告。

| 编号 | 本轮证据 | 限制或下一轮动作 |
| --- | --- | --- |
| C01 | Pi 正常批准、一个 work、真实附件/receipt；浏览器真实交接 | 不证明自然语言选择正确 |
| C02 | 旧准备失效在卡片前拒绝；旧工具历史恢复不能重放写入 | 当前不再暴露旧 commit 工具，不为复现重开旧入口 |
| C03 | 拒绝、取消；新增真实工作确认超时，expired、无 receipt/work，晚批准拒绝 | 确定性 provider，不是模型主动判断 |
| C04 | stop、restart、SIGKILL 前后故障，旧批准不能恢复写入 | 保留 unknown，不承诺外部命令 exactly-once |
| C05 | 同操作去重、双批准、提交前/后异常、既有回执查询；浏览器页面响应丢失 | 真 Agent handoff 丢批准响应的组合可补，不据分层通过宣称全部组合覆盖 |
| C06 | 两个旧 revision 的 claim/submit 竞争，仅一个成功 | 既有机制，未改并发协议 |
| C07 | 准备后源文件改变，接收固定旧字节 | 不表示固定副本永久不可能丢失 |
| C08 | 新增固定副本提交前 missing/corrupt；提交后导入拒绝；账号停用后回执/重放 HTTP 401 | 部分覆盖。停用账号不撤销已接受请求；其他受支持权限转换仍待测，不能模拟不存在的任务移除成员功能 |
| A01 | 明确选定文件的字节/清单与 receiver 导入；浏览器双附件 | 服务传输正确不等于自然选片正确 |
| A02 | 单文件、显式 []；新 Agent 遗漏字段拒绝；旧 schema/page 兼容 | 模型仍可能错选 []，属于自然评测 |
| A03 | 越界/符号链接/跨席位及任务范围拒绝 | 无新增权限能力 |
| A04 | 既有同名文件不覆盖；新增坏副本导入保留人员编辑 | 逐文件导入，不宣称整组回滚 |
| B01 | 原完整命令策略 allow；两后台模式 fixed provider/fake Docker 路径 | fake 输出不等于实际 hash/wc 正确 |
| B02 | **真实容器计算未执行** | 本机 Docker daemon 不可连接；需要隔离可用环境 |
| B03 | ask/deny 工具拒绝、原生继续；解析/持久化终止和 failed job 不投递 | 正常回答未完成业务仍可能 runtime succeeded；不能把业务目标和运行状态混为一谈 |
| U01 | 真交接刷新、接收方隔离；通用 HITL 切席/未知结果；实际卡片附件 | 交接切席与丢响应组合未全部覆盖；已发现提交后工具异常的文字歧义，候选 D1 待审 |
| U02 | 页面单次确认与 Agent 原生确认各自链路；禁止页面提交 Agent 准备 | 反向 page→Agent 来源检查有源码依据，未新增完整双向组合矩阵 |

## 3. 未执行与判断

- `docker info --format '{{.ServerVersion}}'` 返回 exit 1，无法连接本机 Docker socket。未启动全局 Docker、未改用生产服务器。真实计算 B02 不能记通过。
- 本轮付费模型调用 **0**；没有新的自然多轮成功率，不能关闭 BUG-001。计划中的 6 类 × 5 次只是下一轮提议，不是本轮结果。
- 没有生产版本核对、部署、Git commit/push 或 Issue 关闭；线上是否与基线一致仍未知。
- 结论：现有主要机制及本轮保护回归正常；发现的窄问题是交接提交后工具异常的展示歧义。自然选片与真实容器计算证据仍有缺口，不能宣称三项业务缺陷全部修复或稳定。
