# 实施清单（v0.2已批准）

状态：v0.2 / in_progress；方案已提交b133400并按用户要求实施，工程检查及三轮真实复验已执行，整体关联语义未全部达标，本次不部署线上产品。首要业务目标是已有任务关联正确、完整，新建独立工作排在其后；工程上先补完成检查是为可靠落地和验收。

## 1. 批准与基线

- [x] 用户审阅v0.2 PRD/design，确认先覆盖所有应考虑任务、再考虑独立新建的优先级，以及显式记录要求和最多2次原生补做，再激活实施。
- [x] 加载后台、Pi、任务信息、轮次隔离及前端规范；冻结当前代码/业务fixture/配置，保留旧三轮完整复验证据。

## 2. A：完成检查

- [x] 扩展Profile契约/配置/快照：缺省false，检查必要工具，要求随作业冻结并提供给模型。
- [x] 复用/小范围抽取原生完成检查与follow-up；保留持续研判行为，接入普通初析只读核验。
- [x] 无有效记录可原请求补做最多2次；最终成功前再检查，不另启Agent循环或分析作业。
- [x] 现有状态机中表示失败及原因，无成功投递/有效新关联；原文可核对，取消/权限/超时/版本/结束门禁不绕过。

## 3. B：已有任务覆盖与补充新建

- [x] 在工具/Profile落实：授权范围内分页发现活动任务→按完整目标逐项核对→记录全部应有关联→最后判断是否有额外独立工作；不填场景ID、任务映射或标准答案。
- [x] 区分有依据的潜在影响、已确认影响、合理无关与资料不足；检索缺口不当无关，不以首个命中、任意Top N或广撒网关联替代正确覆盖。复用现有查询与理由，不新建任务索引、审核模型或长期状态体系。
- [x] 扩展共享校验/工具描述，允许关联＋新建，维持emptyReason互斥及字段、权限、版本检查。
- [x] 核对存储、重启、API、事件级人员创建去重及UI组合；保留历史/人工决定，不新建页面。
- [x] 同步实际规范，并明确新数据不能直接交旧代码读取的配对回退。

## 4. 验证与发布边界

确定性覆盖：正常无需补做；漏调/失败调用后补做；连续遗漏/旧回执/虚称记录；unchanged；未查询或查询失败；有效记录后新提交失败；补做中取消/超时/权限撤销/任务改版/结束演示/重启；旧可选Profile与持续研判；分页查询及多任务组合的实际返回/保存/展示、非法组合拒绝、权限过滤及人工创建幂等。并发使用显式屏障；这些测试不证明模型已经正确理解全部候选。

优先扩展现有 `tests/background/{task-links,continuous}.test.ts`、`tests/pi/{task-information,continuous-runner}.test.ts`、`tests/task-information-api.test.ts`、`tests/scenario-business-flow.test.ts`、相关桌面Playwright。

工作目录 `experiments/harness-lab`：

```bash
npm run typecheck
npm run lint
npm test -- --configLoader runner --maxWorkers=2
npm run build
npm run test:e2e -- --workers=1 tests/e2e/information.spec.ts tests/e2e/task-information.spec.ts tests/e2e/scenario-business-isolation.spec.ts
```

- [x] 先定向、再按规范完整检查；不争用测试运行器。仅桌面浏览器验收。
- [x] 测评前形成并冻结“信息×当时任务”的核验表和口径，明确应关联/不应关联/资料不足及依据，留在测评侧，不加载为模型答案；不拿后建任务倒扣首报漏关联。
- [x] 工程通过后，用usage-only驱动新建3轮完整复验，逐条核对全部13条来报与当时任务的覆盖、误关联、潜在影响表述、无法判断和真实保存。E05为回归重点而非唯一验收；新建合理性单列，不能抵消关联失败。
- [x] 保存回执、实际输入及完整目标可见性、检索范围/缺口、用量、补做和失败；Agent语义审阅明确标注，争议保留，不能冒称独立人工验收或单因素因果验证。
- [x] 不无限重试、不择优替换；基础设施故障和未执行项单列，失败保留在计划3轮分母。
- [ ] 结果待用户审阅，后续线上发布另行授权；保留配对备份，不以物理完成宣称语义通过。

## 预计改动位置

相对 `experiments/harness-lab/`：`src/contracts/{background,task-information}.ts`、`src/background/{config,store,task-links,executor,service}.ts`、`src/pi/{background-runner,lab,continuous-completion,task-information-tools}.ts`、场景Profile示例及上述测试。前端优先复用`TaskAssociations.tsx`和已有错误展示，仅必要时修改。

以上是预计责任范围，不要求每个文件都改；不得扩展为通用工作流、新数据库状态体系、模型切换或场景补答案。

执行结果见[三轮复验报告](research/retest-results.md)：工程通过，39条真实保存，关联语义仍有5漏/9无依据，保留用户审阅项未勾选。

2026-11-06后续：用户追加授权“更新线上服务”，已发布48c99a1，详见[发布记录](research/online-release.md)。此前“不部署/另行授权”描述为当时范围；本次上线不代表剩余关联语义问题通过验收。
