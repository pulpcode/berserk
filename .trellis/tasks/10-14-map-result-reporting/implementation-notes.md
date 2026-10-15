# 实施记录与确定性检查

日期：2026-10-14。实施者：`trellis-implement`。用户已批准本方案；本记录只覆盖实现和确定性检查，真实模型复测及语义结论由主会话另记。

## 实际修改

- D1：`src/pi/annotation-tools.ts` 的说明使用既有 `canSetCurrent`，与原 schema 权限裁剪一致。列表、固定读取、历史回执与本次动作的证据范围分别说明；未修改执行函数、schema、权限或回执。
- D2：现有 `fixtures/skills/map-annotations/SKILL.md` 集中说明当前状态、操作归属、来源事实和已保存字段的边界。只在证据不足时定向读取，无固定测试对象或强制重复读取。
- D3：`src/pi/composer-input.ts` 新增 v3。新地图输入走 v3，仅方法/角色输入仍走 v1；保留 v1/v2 模板原输出。`history-evidence.ts` 显式接纳 v3，所有历史身份、正文、顺序、Skill 快照与只读限制不放宽。未知版本拒绝。`lab.ts` 原分派已覆盖，未改动。
- D4：AnnotationReceipt、服务事务、HTTP DTO、来源复制、AnnotationRequestState、UI 均未修改。
- D5：`scripts/probe-desktop-map.ts` 增加 `--reporting-recheck`，固定两个独立完整协同环境，默认五环境不变；禁止与 `--prepare-case` 组合，可零模型准备。每请求新增只用于离线审阅的 `visibleEvidence`，包括中途说明、最终答复和问题/答复；失败后尝试获取终态快照，保留实际活动 requestId。原操作员权限与次数、模型请求禁用和无重试规则保持不变。
- 补充相关测试、驱动 README，以及 map-annotations/conversation-references 已实施规范。未修改本任务状态/计划文件或 validation.md。

产品路径均相对 `experiments/harness-lab`。

## 历史兼容证据

实施前从未修改的 `b201934` 生成器保存四个固定样本到 `tests/pi/fixtures/composer-input-legacy.json`：v1 来源、v1 Skill/角色、v2 固定标注、v2 混合引用。来源为本地虚构 mock 服务，无真实模型。固定期望值不会在测试时由新生成器生成。

回归覆盖：固定样本逐字一致；v3 来源/草稿/标注引用及方法组合；v1/v2/v3 混合原生会话重开并续聊；取消准备不重放选择；未知版本、伪造身份/正文/字段/Skill、重复与晚到输入、只读子任务和容量限制。既有自动上下文 2→500 对象不增长、固定链接、子任务工具隔离测试继续通过。

额外直接对照 Git 基线：v1/v2 两个模板函数和原 `mainChain`、`ambiguity`、`collaboration` 场景函数主体与 `b201934` **逐字一致**。新版模式复用原协同函数，未改变原业务指令。

## 确定性检查

Node `v24.14.0`，Pi `0.85.1`。工作目录 `experiments/harness-lab`。

| 命令 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `npm run lint` | 通过，含依赖边界 |
| `npm test -- tests/pi/composer-input.test.ts tests/pi/annotations.test.ts tests/pi/map-skill.test.ts tests/context-composer-map.test.ts tests/annotation-map-evidence.test.ts tests/probe-desktop-map.test.ts` | 6 文件，62/62 |
| `npm test -- tests/annotations-acceptance.test.ts tests/annotation-from-source.test.ts tests/pi/annotation-workflow.test.ts tests/pi/annotation-hook-boundaries.test.ts tests/pi/annotation-source-history.test.ts` | 5 文件，80/80 |
| `CI=1 AXON_E2E_PORT=5304 npx playwright test tests/e2e/annotations.spec.ts tests/e2e/situation-map.spec.ts --workers=1` | 14/14，约 1.8 分钟 |
| `npm run build` | 通过；保留既有 >500 kB 包大小提示 |
| `git diff --check` | 通过 |

合计 142 项单元/集成测试 + 14 项桌面 E2E。测试为确定性提供方或本地来源，不证明真实模型表达已改善。

初次 lint 发现测试中一个未使用的导入，移除后复跑通过；一次从仓库根目录误跑 npm 因无 package.json 未执行，随后在正确包目录执行。首次本地 mock 监听受沙箱限制，获得本地测试执行授权后保存样本成功。这些均未触发真实模型调用。

## 交接时的关键文件 SHA-256

| 文件 | SHA-256 |
| --- | --- |
| `src/pi/annotation-tools.ts` | `78ee45ed26cd2c29c327d96cb3b5f53ffc64393e49168d34d1832e44c68d1d9f` |
| `src/pi/composer-input.ts` | `9cafae19e51192f7d4cacad080f731bd59a8369535465a58991f150d038fe090` |
| `src/pi/history-evidence.ts` | `a13004c670d90e8281b8f439405e99b1f2e839c0b7df00c84d5df0513d30f499` |
| `fixtures/skills/map-annotations/SKILL.md` | `d78958c9af8c6739316d64a28f44ee44297f3011e596ebdfe9789d39a6635934` |
| `scripts/probe-desktop-map.ts` | `0580562b38e29ab4824f2befa815f942b67d3b626c99919b6598fffea9b279d7` |

主会话仍需冻结前独立审阅、所有零模型准备、原桌面五环境 + 两次额外协同 + 原恢复三例，以及全可见说明的人工语义核对。记录真实模型输出，不因确定性检查通过而预判说明质量。新 v3 记录写出后，回退须保留 v3 历史读取能力。未提交、推送或部署。
