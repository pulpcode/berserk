# P0 审计：现有修复与剩余证据缺口

2026-10-15。首轮只执行外部任务书 P0—P1；没有业务源码修复、付费模型调用、生产访问或部署。复用既有父任务，本目录与原历史材料并存。

## 1. 结论先行

任务书建议的单工具交接、显式附件选择、固定副本、确认前失效检查、受限后台文件检查，**当前 main 已经实现**。本轮不能以重新实现这些能力作为修复成果。相关确定性基线 316/316、桌面回归 32/32 通过；补测后的三个文件 69/69 通过，见 [verification.md](verification.md)。

真正未闭合的部分是：自然语言分派的稳定性；原完整后台命令在真实容器中的计算值证据；以及“业务已提交但工具返回失败”时 UI 文案可能让用户误认为未生效。前两项本轮未作真实模型/容器验收，后一项已有故障测试与源码映射证据，建议下一轮做最小展示修正。

## 2. 基线与取证边界

| 项目 | 本轮记录 |
| --- | --- |
| 仓库 | `/Users/lau/workspace/berserk` |
| 起始状态 | main，工作区干净 |
| HEAD / main / origin/main | `fdba343ec996f1f9515f84883e9fc9d4f0f39bf1`；本轮 `git fetch origin main` 后再次核对相同 |
| 新工作分支 | `codex/handoff-reliability`，未自动提交或推送 |
| Node / npm | v24.14.0 / 11.9.0，macOS |
| Pi 声明及实际安装 | pi-ai / pi-coding-agent 均 0.85.1 |
| package-lock SHA-256 | `62589991b06ea7485a99c30077e5de838c5bc2570ca7c36619de8306c9fde967` |
| 命令策略 | `axon-bash-v2`，tree-sitter / tree-sitter-bash 0.25.1 |
| 模型标识 | 源码缺省 `deepseek-flash`；DeepSeek 路径 `thinking: disabled`。未读取本地或线上有效密钥/模型设置，不能把缺省值当作生产实时配置 |
| 有效输入证据 | 当前工具定义、Pi 注册/适配代码、确定性 provider context 与既有探针；未捕获新的真实 provider 输入或 Skill 加载记录 |
| 日志 | `.local/handoff-reliability-20261015/`，不默认加入 Git |

`baseline.json` 保存必要源码/锁文件/公共 fixture 指纹。初次沙箱测试因本机监听 EPERM 未形成有效基线，保留日志并停止；获准监听后运行通过。没有读取 `.env` 或原始用户日志。Docker CLI 存在，但本机 daemon 不可连接，不访问生产替代。

## 3. 历史追踪：不是只看 Issue 或提交标题

已查看 main 最近 60 次提交（fdba343 至 c3b5bd6），并沿相关路径向前追到 09-18。代码与测试实际 diff、相关合并逐父差异保存在本地审计目录；稳定引用为提交号。地图与布局的大部分近期提交与三条原故障无直接因果，未将它们算成交接修复。

| 提交 | 实际变化与测试演进 | 与三项问题的关系 |
| --- | --- | --- |
| `683331b` | 引入 HITL、v1 命令策略及解析/权限测试 | 原命令 cd/glob 待审的前提；不是 Pi 强制审批 |
| `2abb782` | 引入 prepare/commit、请求授权、固定副本与业务事务；已有字节/隔离/幂等保护 | 原双调用衔接缺口在此；附件可省略是当时契约 |
| `baaedba` | 引入后台执行与投递；当时 ask 导致 HUMAN_ACTION_REQUIRED | BUG-002 原后台终止分支；后由 c14ec42 删除 |
| `047ab63` | 补工作区/附件说明及实际零附件展示；仍是旧两工具与可选附件 | 不能把说明修复等同确认协议或必填参数已改 |
| `c14ec42` | `work_item_action` 同调用串联准备/确认/提交；卡片前拒绝失效准备；后台 ask 改工具级错误，策略 v2；加入生命周期/旧历史/后台回归 | BUG-002、BUG-003 已有实质机制修复 |
| `9244e89` / `25a5a93` | 工作总览与席位/访问数据库合并兼容；检查相关父差异 | 需按当前正式登录和归档语义验证，不假设任意撤销 task 成员的新权限模型 |
| `e81f9d2` | 新 Agent inputPaths 必填，历史/page 仍兼容；回执返回 committed 与实际 files；新增遗漏纠正/历史解码测试 | 消除“省略静默等于无附件”，不能保证模型选片正确 |
| `99b40ec` | createSession/bindWorkItem 自动导入 receiver 输入；增加冲突、重试、跨任务保护 | “登记了附件但接收目录为空”已有宿主路径修复 |

公开 [#1](https://github.com/pulpcode/berserk/issues/1)、[#2](https://github.com/pulpcode/berserk/issues/2)、[#3](https://github.com/pulpcode/berserk/issues/3) 本轮读取仍为 Open，正文保留较早阶段描述。公开状态与当前源码不能互相替代。本轮不更新或关闭 Issue。

## 4. 问题—证据—最小动作

下表路径以 `experiments/harness-lab/` 为根。逐段代码行号及详细覆盖见三份 [确认研究](../research/reliability-20261015-confirmation.md)、[附件研究](../research/reliability-20261015-attachments.md)、[后台研究](../research/reliability-20261015-background.md)。

| 问题 | 历史修复 | 当前路径/条件 | 当前复现结论 | 原因层级与最小动作 | 验证 |
| --- | --- | --- | --- | --- | --- |
| BUG-001 省略附件 | e81f9d2、99b40ec | contracts/collaboration.ts 新旧 schema 分离；collaboration-tools 的 scopedWorkAction；service.freeze/commit/import；lab.importWorkInputs | 固定省略调用被拒绝，显式空数组有效；指定附件字节正确；自然语义仍待测 | 旧遗漏漏洞已修；少选/空选/额外澄清仍属未证明的模型行为。不新增自动选片或第二个模型 | 既有 Pi/服务/浏览器 + C08 新保护；下一轮自然场景 |
| BUG-002 原命令待审终止 | c14ec42 | command-policy.evaluateCommand；lab.beforeToolCall background ask→blocked result；background service/store 核对终态 | 原完整命令策略 allow；两后台模式 fake Docker 路径通过。真实 stdout 未测 | 机制已修，当前缺口是实际计算证据；不加 inspect_files 或扩大白名单 | 固定脚本＋真实隔离 Docker，非付费模型可验证 |
| BUG-003 旧准备单批准后失败 | c14ec42 | lab 同 call prepare/check/wait/authorize，collaboration-tools 单次消费 grant；service.checkAgent/commit | 旧工具不再注册；过期准备卡片前拒绝；同请求正常确认通过 | 已有单入口，保留请求授权；不新建 work_item_request 或跨轮恢复 | C01—C06、U01—U02 既有覆盖与超时补测 |
| 提交成功后返回异常 | 既有故障用例已保留真实 receipt | Pi collaboration 测试 commit after；InteractionCard executionLabels.failed | 同一测试业务 work=1/receipt存在，native tool仍failed；UI固定显示“执行失败” | 成功事实未丢，但折叠卡措辞有歧义。候选仅改工作交接的失败说明，区分工具返回与业务结果 | before/after 两种故障＋桌面展示，不改原生记录 |

## 5. 三条实际链与哪些“保护没生效”说法不成立

### 附件

模型 `inputPaths` → 当前严格 schema → 宿主注入固定 task/workspace → 安全打开源文件并保存私有副本 → action.files → 真实确认 → 提交前固定字节复核 → 短事务 work/files/receipt → receiver 按 task×seat 导入。

原故障选片为空，副本机制不会凭 goal 文字造出附件。当前必填只能消除省略，不能把模型的 `[]` 证明为用户想要零附件。固定副本缺失/损坏在 commit/preview/download/import 使用时校验，不是每次列元信息都扫描字节。已提交回执是历史事实，不能保证副本永远可用。

自动导入多文件不是全组回滚：后续文件失败时，前面正确副本可保留；已有会话先绑定再导入，失败 API 不返回成功，修复后可重试同字节。不得为了迎合任务书写成全组原子导入或删除已经正确导入的内容。

### 确认

同一真实 toolCallId 在 beforeToolCall 内准备 → 确认前检查状态 → 原生交互等待 → 批准后取消/参数/权限/版本再检查 → request-local grant → 工具 execute 单次消费 → 既有事务回执。

旧请求结束、重启或取消不会恢复批准。页面与 Agent 来源不能互用。service 保留 legacy prepare/commit 的不同 call ID 能力，新单入口的 exact call/args 绑定在宿主 map 中完成；不能仅截取 service 一处比较就宣布新调用可绕授权。

正式身份停用后新 HTTP 访问由 auth 层拒绝；已经接受的工作按现有 captured-seat 语义继续，不能擅自把退出登录改为取消业务。当前 task visibility/owner 不可变，没有单任务“移除成员”操作，直接篡改数据库伪造该场景不能证明现有入口有漏洞。

### 后台

后台注册获准工具，无 AskUser/交接写工具 → 同一命令策略 → allow 执行原命令；ask/deny 不执行该调用、返回工具错误 → Pi 可继续 → 服务复核原生结果和固定产出 → 仅正常 verified preprocess 生成 delivery。

失败 job 不投递；但 Agent 正常结束、回复“未完成业务”仍可能是运行 succeeded 并投递，这属于当前产品语义。不得把“某一次工具拒绝”偷换为“整个作业必须失败”，或把运行 succeeded 当作自然业务目标已完成。

## 6. 输入、Skill 与部署证据

根开发 AGENTS/Trellis 与产品 fixture Skill 是两套用途。当前工具约束由 contracts、collaboration-tools 和 Pi 注册提供，后台模式说明在真实 Bash 工具 description；不能仅看 factory.promptGuidelines 就断言模型收到它。

本轮确定性 provider 走实际 Pi 工具循环，但没有新增真实模型对话，因此只证实代码及模拟调用可见内容，不能断言原线上故障那一轮加载过某 Skill。后续自然评测复用 probe-handoff 的 provider payload 与原生资源证据，不新建平台快照系统、不采集隐藏推理。

09-22/09-23 发布记录含未提交差异，不能用当时单个 SHA 代替运行身份；10-10 记录还涉及自动导入后续发布。此次没有访问生产或核对在线文件，线上是否等同当前 HEAD 保持未确认。

## 7. 本轮退出判断

三项原机制已有实现且相关基线通过；新增保护也通过，没有制造红测或改生产源码。原自然问题未关闭，真实 Docker 证据受环境限制。进入下一轮应审阅 [最小计划](plan.md)，而不是直接照旧任务书重做所有 P2—P5。
