# Pi 标注真实模型验收

日期：2026-10-13（Asia/Singapore）。仅使用新建临时目录、虚构任务和标注；未向模型发送实际任务数据，未部署，未更改供应商或生产模型配置。

## 授权与原始失败保留

1. 首次五轮 probe 全部失败、0 个工具调用。原始证据保留于 `/var/folders/td/741qp46d52b2b8_2zdzj7ps40000gn/T/axon-map-Qw1YhR/annotation-evidence`，日志 `/tmp/berserk-annotations-live.log`。当时生产错误脱敏只显示模型调用失败。
2. 最小外发诊断被自动审批拒绝，理由为未知外部目的地的凭据及内部 schema 披露授权不足。没有绕过拒绝。
3. 用户随后明确授权：使用项目现有 DeepSeek 配置与凭据，向 `https://api.deepseek.com` 发送隔离虚构标注、测试指令和工具 schema，消耗少量额度。后续诊断及 probe 在此授权下通过审批执行。
4. 无工具最小请求 HTTP 200，14 tokens，确认配置、网络和账号可用。原配置 `max_tokens=393216` 的最小请求也 HTTP 200，18 tokens；没有据猜测降低生产输出上限。
5. 带工具的最小请求明确返回 HTTP 400：`annotation_action` 中的坐标 tuple 生成 `items: [schema, schema]`，provider 要求 `items` 为 boolean/object。根 schema 已显式标明 object；单独保留此诊断，不把此前失败删除。
6. 改为 `items: number`、`minItems=maxItems=2`，保留 TypeScript 的精确二元组类型；业务服务继续严格校验经度 ±180、纬度 ±90。`$defs/$ref` 复用得以保留。修正后最小工具请求 HTTP 200，prompt 4,296、completion 1 tokens。该数字是当时三个工具和短指令的总输入，不代表完整应用请求或单个工具的独立成本。

生产错误脱敏未被关闭；未补造工具结果或重写旧原生消息。

## 真实场景结果

| 试验 | 结果 | 原始证据 |
| --- | --- | --- |
| 默认草稿读取、下一请求识别人工新修订、Agent 编辑、固定历史比较、发布后设当前（5 轮） | 实际读取 r1/r2，保存 r3，按 r3 与 r1 比较，发布并设当前成功；对象与版本核对通过 | `/var/folders/td/741qp46d52b2b8_2zdzj7ps40000gn/T/axon-map-pOAGzW/annotation-evidence` |
| 自然语言从空白创建、添加 C、删除 B（3 轮） | 每轮实际保存，最终仅 A/C；未要求发布时没有发布或设当前 | `/var/folders/td/741qp46d52b2b8_2zdzj7ps40000gn/T/axon-map-nKG76P/annotation-evidence` |
| 含糊目标观察 | 模型用普通文字询问对象与距离；未调用写工具，修订不变。没有强制要求使用 ask_user | 同上 `observation-ambiguous.json` |
| 直接修改另一会话原稿观察 | 模型说明权限边界，不复制、不派生、不写；自己草稿 r3 与参考草稿 r1 均不变 | 同上 `observation-foreign.json` |
| 收紧工具说明后的新会话定向复测（2 轮） | 先取无几何摘要，再只读 A 几何；设当前前实际调用 annotation_list 读取 sequence，发布和设定成功 | `/var/folders/td/741qp46d52b2b8_2zdzj7ps40000gn/T/axon-map-gLqSEw/annotation-evidence` |

第一组五轮成功记录仍存在两项行为不足：模型为单点 A 问题读取了整份两对象几何；设当前时未先查询当前序号，直接使用了新任务恰好有效的 0。CAS 原本会拒绝错误序号，但不保证模型先查询。针对这两项已观察行为，只收紧 annotation_read/action 的具体工具描述，不加入自建意图识别、模型重试循环或强制补调工具。最后一组新会话复测验证了改善；它不是删除早期不足后的替代记录。

模型部分过程说明使用英文、最终回答偏向列出版本/hash，属于表现观察；没有错改对象、虚构读写完成或不经要求发布。一次通过不能证明所有模型和输入下均有相同语义表现。

## 上下文与实际用量

最终定义按 UTF-8 字节测量（不是字符串字符数，也不是 tokens）：

| 工具 | 参数 schema | 含名称、描述、参数的定义 |
| --- | ---: | ---: |
| annotation_list | 154 B | 358 B |
| annotation_read | 2,513 B | 3,077 B |
| annotation_action | 8,148 B | 8,785 B |

单请求自动草稿身份 JSON 为 153 B；对应原生输入正文含边界说明为 570 B。2 个对象与 500 个对象的自动正文大小相同，已由本地测试确认。最终定向试验的摘要读取返回 520 B，单点几何读取返回 492 B。工具定义、历史元信息与实际结果均有上下文成本；不宣称零 token。

以下为原生 usageSummary 汇总，包含工具循环和重复历史；input 与 cacheRead 分列，totalTokens 包含两者及 output，不能再次把 cacheRead 加到 totalTokens：

| 试验 | 普通请求数 | input | cacheRead | output | totalTokens |
| --- | ---: | ---: | ---: | ---: | ---: |
| 版本/发布 | 5 | 18,578 | 116,096 | 1,871 | 136,545 |
| 创建/增删及两个边界观察 | 5 | 17,231 | 77,184 | 1,606 | 96,021 |
| 定向改善复测 | 2 | 13,379 | 64,384 | 1,043 | 78,806 |

这些是全部宿主工具和历史共同参与的真实请求用量，不能归因为标注功能单独增量；没有从字节数推算 tokens 或费用。

## 可复跑入口与本地检查

在 experiments/harness-lab 下，使用现有环境文件运行：

```bash
node --import tsx --env-file-if-exists=.env.local scripts/probe-annotations.ts
node --import tsx --env-file-if-exists=.env.local scripts/probe-annotations.ts --mutations
node --import tsx --env-file-if-exists=.env.local scripts/probe-annotations.ts --focused
```

每次都新建隔离试验目录，结束停止服务。失败/取消或语义检查失败返回非零退出码；保留每步 stream、snapshot、实际 binding/version/current。再次运行仍需遵守实际外发授权，不是生产自动验收任务。

本地最近检查：完整 typecheck、负责文件 ESLint、`tests/pi/annotations.test.ts` 的 12 项测试通过，包含 provider schema 结构回归、非法纬度不写入、原生 compaction 后固定版本重读、跨任务 receipt 拒绝、同席位换账号撤权、子 Agent 无写工具与上下文大小。主会话另行执行最终全包回归。
