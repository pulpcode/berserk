# 草稿基线与任务当前：最小改进

2026-10-15，用户已审阅聊天中的最小方案并批准实施、原场景复测。先提交上一轮为 `4c84f4f`，保留其未全部通过结论。本文件是本轮对原 PRD/design/implement 的范围补充；原报告不覆盖或改写。

## 需求与证据

上一轮 collaboration-2 首次发布时任务尚无当前版本，模型却把 baseRef P0 说成当前；后两次沿用自己历史回答，未查询就断言 P0 当前、P1/P2 均未采用。实际工具说明已要求核实当前，但自动上下文没有就地解释 baseRef；本会话未读取可选 Skill。

## 最小实施边界

1. `src/pi/composer-input.ts`：新地图输入 v4，紧邻原有 JSON 解释 baseRef 是草稿固定创建基线（null 表示未选基线），不是任务当前；draft.revision 为会话草稿修订；writable 仅为草稿编辑能力；这块上下文未提供任务当前。没有草稿时基线表示待创建所选基线。不增加字段或自动查询。保留 v1/v2/v3 逐字输出，纯方法/角色沿用 v1。
2. `src/pi/history-evidence.ts`：明确接受 v4，保持身份、顺序、重复、内容、容量、Skill 和子任务限制；新旧混合历史可续聊。不是全局版本注册重构。
3. `src/pi/annotation-tools.ts`：工具说明及 baseRef 参数说明直接提供关键语义，不依赖 skill_read。固定派生基线不证明曾被或正在被采用；保存/发布只证明本次效果；无需顺带总结全局状态；需要回答任务当前时以本次查询或本次实际成功采用回执为依据，历史回答/旧动作回执不能代替；缺字段不同于 current.publication:null。保留 canSetCurrent 条件、执行逻辑与数据 schema 形状。成功采用后不强制查询。用简短替换/整合而不是堆叠重复提示。
4. 相关单元/集成测试和固定旧 v3 样本；必要更新两个 backend spec。不修改 Skill、业务驱动、用户指令、回执 DTO、服务/存储/RequestState、HTTP、UI、权限、模型配置或 Pi 循环。

## 检查与复测

- typecheck/lint；composer-input、annotations、map-skill、context-composer-map、annotation-map-evidence、probe-desktop-map 及既有 annotations-acceptance/annotation-workflow/hook-boundaries/source-history 相关回归；构建。
- 明确验证未选择或读取 Skill 时关键文本仍出现在实际 Pi 请求；固定 v1/v2/v3 与新 v4 混合历史重开续聊，篡改和未知版本仍拒绝；元数据体积不随对象数增长。不是用新生成器即时生成旧版本期望值。
- 冻结实现/测试/Skill/驱动/构建。零模型准备：原桌面默认五环境和 --reporting-recheck 两环境。正式按同样两批执行，45 业务请求、三条完整 B01→B02→C01→C02 链；不重跑来源恢复三例，不宣称覆盖该范围。
- 原顺序和输入不变：共同 P0 两草稿交错修改/固定引用；A 发布 P1（current=null）；管理 UI 采用 P1；A/B 继续各自草稿；A 发布 P2（current=P1）；管理 Agent 比较并采用 P2；A 无权限请求采用 P1（current=P2）。无需用户重新授权已批准的隔离 DeepSeek 虚构数据实测。
- 原操作员规则保持；失败不改题、不重跑凑通过。实际输入、全可见回答、工具回执、独立 current/基线快照全部保留；独立审阅状态不注入模型。记录实际 Skill 加载情况，不强制或禁止读取。
- 核心验收：保存/发布/隔离/固定引用/权限继续通过；三链无 baseRef=current、无把旧回答说成已核实、无无依据采用历史断言；明确比较采用仍须正常完成。普通保存发布不强制全局查询或保存后读回。
- 其他回答错误同样披露，目标未复现与整体说明准确性分别判断。仅称本轮未复现，不声称普遍稳定。保留上轮记录。

## 分工与记录

实施子代理负责上述产品/测试/spec；主会话负责任务文件、真实模型复测及证据报告；独立检查代理评审实现与结果。遵照项目 Trellis 的 implement/check 调度，不再嵌套代理。

新结果落盘 `base-current-implementation.md`、`base-current-review.md`、`base-current-validation.md`。本次请求只要求开始前提交；新修改完成后不自动推送、部署。先实现并验证，再向用户报告实际结果。
