# 加载诊断离线检查（2026-10-28）

交付范围：`loading-diagnostic/` 的 6 题 × A/B × 2 轮输入准备。没有真实模型调用，没有业务正确率结论；此检查完成时尚未提供 live runner。

## 最终结果

- TypeScript：`experiments/harness-lab/node_modules/.bin/tsc --noEmit -p .trellis/tasks/10-26-agent-plotting-integration/loading-diagnostic/tsconfig.json`，exit 0。
- ESLint：`experiments/harness-lab/node_modules/.bin/eslint --config experiments/harness-lab/eslint.config.js .trellis/tasks/10-26-agent-plotting-integration/loading-diagnostic/*.ts`，exit 0。
- 离线测试（工作目录 `experiments/harness-lab`）：`node --import tsx --test ../../.trellis/tasks/10-26-agent-plotting-integration/loading-diagnostic/prepare.test.ts`，**2/2 通过，0 失败，exit 0，约 89 秒**。
- `git diff --check`：exit 0。

最终证据目录：`/var/folders/td/741qp46d52b2b8_2zdzj7ps40000gn/T/plotting-loading-odLxy9/batch`。

```json
{"prepared":24,"syntheticProviderRequests":48,"realProviderRequests":0,"toolSchemasIdentical":true,"freezeHash":"dccce9287a6d29bedf3f228ee8bd6ea0ecdc631a159bf8859148e97ffe935186","liveEnabled":false}
```

本次通过内容：全部 24 槽真实 HTTP/Pi 入口、B 组原生显式选择的当前 Skill 正文送达、A 组不预置正文、12 组配对初始业务文档一致、全部工具 schema 一致、固定模型请求参数、真实 `annotation_read` 成功、每槽前后地图状态不变、拒绝覆盖证据目录、拒绝 `live` 模式。正文可见性复用现有审计器，同时识别原文及 JSON 转义形式。没有模拟成功的 Skill 读取。

48 次 synthetic 请求是可控传输预演，不是 24 项用户任务的执行结果。T/S 写入没有执行，R1 空间分析没有执行，语义结果均 `not_applicable`。线上模型版本未验证。

## 调试失败记录

- 首次 TypeScript 命令使用了错误的相对路径（`../../experiments/...`），未启动编译；改为仓库根路径后通过。
- `plotting-loading-PmXNKW` 与 `plotting-loading-KGuFZQ`：沙箱无法绑定本地测试端口，运行时启动失败，保留 `started` / `not_executed`，不是通过。获准仅为本地离线 HTTP 测试解除此限制后运行。
- `plotting-loading-HRPTkn`：B 槽正文可见性检测只查原文，未识别原生机制中的 JSON 转义正文，导致断言失败；改为复用既有 `auditPayload`，没有改变 Skill 或产品。
- `plotting-loading-K4iTJB`：修正检测后完成 24/48/0 预演。随后补充测试级配对文档断言、README 和移除重复证据写入，再执行上述最终批次，2/2 通过。

失败目录与最终目录位于同一个系统临时目录；未删除失败证据。原始 provider payload、资源目录、会话快照、原生 sessions 与配对文档保留在各槽下。目录为本地临时证据，长期归档需另行复制。

## 边界与后续

当前仅 `prepare` 可运行。`120 requests / 4M input / 200k output` 是真实对照预算建议，尚未接入预算执法，更不是已获真实调用额度。真实 runner 仍需接入现有 provider/ledger、多轮执行及题目副作用检查、判分和实际响应模型核验。具体缺口见 `loading-diagnostic/README.md`。不能依据本报告声称 Agent 理解能力已改善。
