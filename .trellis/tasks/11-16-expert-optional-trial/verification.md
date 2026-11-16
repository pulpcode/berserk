# 本地实施与验收记录

## 结果
专家试用已改为可选：无试用、失败、运行中、中断、取消及未确认均可不携带试用引用直接发布；文件环境试用不再作为发布门槛。保留当前配置检查、依赖有效性、风险确认、有效业务使用范围、发布说明及页面发布确认。

试用仍由用户显式启动并沿用原隔离运行器。显式关联的试用仍须核对所有权、专家、当前草稿与校验记录、实际成功证据及管理员确认，提交时再次复核。管理详情仅向当前管理员投影自己的试用记录，避免自动关联他人记录。无引用的发布不生成试用通过证据；历史记录原样保留，无表结构迁移。

## 基线与隔离
- 来源：codex/axon-r3a @ 1e99845e91b62f30c966baa25d9bf9de3756808b。
- 本次分支：codex/expert-optional-trial。
- 工作树：/Users/lau/.codex/worktrees/expert-optional-trial/berserk。
- 原 R3A 未提交修改未合入或改写；4315/4316 未更新；本次按用户批准的清单提交；未推送。

## 验证
| 检查 | 结果 | 证据 |
|---|---|---|
| 定向服务/API/权限/同步 | 4文件27项通过 | research/implement-focused.log |
| 桌面浏览器 | 5项通过，包含1060/1440免试用发布、零模型调用和可选试用确认 | research/implement-e2e.log |
| 完整单测 | 183文件1849项通过，exit0，785.15秒 | research/full-unit.log |
| 类型检查 | 实施者与独立审查均exit0 | research/implement-typecheck.log、review-typecheck.log |
| Lint及边界 | 实施者与独立审查均exit0；InteractionCard.tsx原有2条hooks警告，0错误 | research/implement-lint.log、review-lint.log |
| 生产构建 | exit0；原有大chunk提示保留 | research/full-build.log |
| 独立审查 | 0项可操作问题，无需修复 | research/review.md |
| diff与源文件一致性 | git diff --check通过；最终5份源码hash与已验证快照一致 | research/source-and-checks.json |
| 人工视觉检查 | 1060/1440可发布界面及1440已发布界面均无溢出或控件遮挡 | research/optional-trial-*.png |

首轮同时执行全量测试、构建、定向和浏览器验证时，出现业务流程、协作等长耗时测试失败，已中断并保留 full-unit-first.log；没有修改无关业务代码或放宽断言，之后完整低并发复跑全部通过。这里只记录观察，不把资源争用推断标记为已证实根因。

首次浏览器测试仅因既定复选框文案变化失败；首次新增回归有嵌套事务模拟错误，已调整测试注入位置。详见 research/implement-notes.md。未执行真实模型/Docker物理验收，本次未变更运行器及执行环境，mock结果不代表物理环境验证。

## 验收映射
- AC1：服务/API不带trialId发布、文件工具无环境试用发布、两种桌面宽度零调用发布。
- AC2：prepared/running/failed/cancelled/interrupted/succeeded待确认记录不变且发布成功；原可选试用/确认浏览器流程保留。
- AC3：风险、范围、说明、校验、CAS及权限拒绝回归；原提交时守卫仍生效。
- AC4：跨所有者/专家/校验及无效引用拒绝，合格旧请求兼容，混合新旧发布记录重启读取及幂等通过。
- AC5：完整1849项包含原固定绑定、发布版本、历史、Skill及运行时回归；没有修改这些运行路径。
- AC6：上述工程检查、桌面验证与独立审查全部完成。

## 待审阅
本地技术验收完成，用户已明确回复“提交”，批准 commit-plan.md 的一次性中文提交计划。用户产品验收仍pending；原R3A阶段验收状态不改变，本任务不部署、不推送，不先行归档。
