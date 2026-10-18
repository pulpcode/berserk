# R2 评测驱动工程检查

日期：2026-10-18。此报告只证明评测接线、夹具及防护可运行，不是模型效果结论。此阶段没有真实模型请求。

## 实现与隔离

评测驱动位于 `r2-20261018/`：`cases.ts`、`run.ts`、`driver.test.ts`、`contract.json`、`package.json`、`tsconfig.json`。复用已冻结 R1 的 Observer、Budget、ask、effectCheck 等组件；未修改历史驱动或产品代码。

三组为 baseline、map-only、spatial-only；16种用例各3组，共48项，按用例轮换组顺序。显式选择一次只包含一个Skill，按用例固定选择；其他Skill仍可通过原生工具读取。每组使用私有runtime副本，除该组声明的一个Skill正文外，所有复制文件与产品源字节一致；不在产品工作树中切换文件。

每个实际provider请求前检查冻结来源、私有runtime、Asia/Singapore日期及预算；记录真实请求/响应和Skill正文可见性。采用同一模型、工具schema、背景及执行关闭配置。来源/日期/正文等guard失败会停止批次；当前R2封装更保守，provider异常（包括单试次预算异常）也会整批停止，而不自动跳到下一试次。输入预算按已结算usage检查，因此单次响应可能越过输入上限，之后不会再发请求；详见contract。

## 最终检查结果

| 检查 | 结果 | 可复核证据 |
| --- | --- | --- |
| R2 固定48计划及真实HTTP→Pi假提供方集成 | 2/2通过；6个试次、12个假provider包 | [mock-native.log](r2-engineering-evidence/mock-native.log) |
| R1复用预算/工具授权/精确保存与真实原生接线回归 | 8/8通过 | [reused-guards.log](r2-engineering-evidence/reused-guards.log) |
| 产品包 TypeScript / lint（主会话执行） | 均通过 | [package-typecheck.log](r2-engineering-evidence/package-typecheck.log)、[package-lint.log](r2-engineering-evidence/package-lint.log) |
| 产品Skill/Composer/provider/resources契约（主会话执行） | 4文件42测试通过 | [skill-contract-tests.log](r2-engineering-evidence/skill-contract-tests.log) |
| R2专用 TypeScript 检查 | exit 0，无诊断 | [typecheck.log](r2-engineering-evidence/typecheck.log) |
| 最终完整预检B | 48/48 prepared，0 provider attempts，exit 0 | [preflight-b.log](r2-engineering-evidence/preflight-b.log) |
| 变体独立核验 | 4种×3组通过；同用例三组document一致；268个冻结来源hash一致 | [variant-audit.json](r2-engineering-evidence/variant-audit.json)、[审计脚本](r2-engineering-evidence/variant-audit.py) |

假提供方测试覆盖三组各两种显式Skill：首包真实送达选定正文；再通过原生skill_read读取另一Skill，第二包确认其完整正文真实送达；请求均保持Pro、thinking disabled、4096输出限制，工具schema跨组一致。这里的“通过”是确定性传输与状态检查，不是模型语义通过。

预检B完整原始目录（被Git忽略）：
`.local/spatial-r2/preflight-20261018-b/`，内含protocol、48个实际fixture、resources、native-sessions和三组runtime-integrity。audit独立核验：V02第51/52名称与58条总数；V04中国近海平移后的闭区域4/5命中；V09实际保存数组及order均反转；V12三类计数为sensor 3、supply 1、缺字段1。迁移变体不是未见保留集。

检查命令（工作树根目录、Node 24.14.0）：

```sh
node --import ./experiments/harness-lab/node_modules/tsx/dist/loader.mjs --test .trellis/tasks/10-15-agent-map-spatial/r2-20261018/driver.test.ts
node --import ./experiments/harness-lab/node_modules/tsx/dist/loader.mjs --test .trellis/tasks/10-15-agent-map-spatial/round1-20261017/driver.test.ts .trellis/tasks/10-15-agent-map-spatial/round1-20261017/native-smoke.test.ts
node experiments/harness-lab/node_modules/typescript/bin/tsc -p .trellis/tasks/10-15-agent-map-spatial/r2-20261018/tsconfig.json --noEmit
node --import ./experiments/harness-lab/node_modules/tsx/dist/loader.mjs .trellis/tasks/10-15-agent-map-spatial/r2-20261018/run.ts preflight preflight-20261018-b 4490
```

批次目录拒绝覆盖；上述预检批次名已使用，不可作为新运行名复用。

## 保留的准备失败与修复

预检A：42项prepared、1项V09-spatial-only准备失败、5项未运行，0 provider attempts；原目录`.local/spatial-r2/preflight-20261018-a/`与[日志](r2-engineering-evidence/preflight-a.log)保留，不并入最终预检或模型计分。

根因：产品的`update_layer.order`只更新order字段，而annotation_read按document.layers实际保存数组读取；原准备代码没有真正交换读取顺序，预设断言正确阻断。修复仅发生在合成夹具：使用已有delete_layer/add_layer操作重建隔离草稿中的保存顺序，保留对象ID与预定内容，并保留原断言。没有为通过预检而删除检查或改产品服务。

较早mock还发现文本块数组JSON.stringify造成双重转义的首包匹配问题，现按实际text块取正文；另一次在并行更新rubric时触发源码hash漂移并取消，证明冻结防护生效。两者均无真实调用，临时日志分别保留在`/private/tmp/r2-driver-check.log`和`/private/tmp/r2-driver-final.log`；最终稳定源mock结果见上表。

## 后续边界

等待主会话与独立检查确认、提交冻结后才能执行真实48项。这里未开始live、未自动第二轮、未作语义重试，也未宣称90%验收通过。Skill实际收益仍须用完整模型轨迹和独立真值评价；工程检查不能代替该结论。

归档日志仅移除末尾空白行以满足 Git 空白检查；原始临时日志保留，内容及检查结论未改。
