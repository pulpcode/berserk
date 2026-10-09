# 实施计划：信息自动归口与任务内接续处理

状态：2026-10-09 已完成 P1—P5；工程验证通过，真实模型复验及限制已记录，待用户验收。验证记录见 [review.md](review.md)。

## P1 任务判断数据与访问服务

- 在 contracts 增加任务判断、建议创建回执、人员决定、可见列表／详情类型；明确已有任务关联、建议新建、暂不归口与未记录的区别。
- 迁移同一 SQLite 到 schema 4，增加人员决定表及唯一键、任务索引；更新 access/database、access/store、background/store 的版本检查与完整性检查。
- 新建 `background/task-links.ts`（或同责任模块），集中实现有效集合选择、人工覆盖、CAS 和授权；沿用 BackgroundStore 事务，避免各页面与工具各算一套。
- 提取现有信息内容授权组合：任务可见 + 对应成功作业的来源授权／本席位投递 + 资料范围。
- 验证：多任务、重复、三种判断互斥、空集合、重处理顺序、权限交集、人工覆盖及迁移重开。

## P2 Pi 任务判断工具

- 在 `pi/task-information-tools.ts` 增加 information_record_task_assessment；通过 BackgroundExecutor 输入回调连接宿主存储，避免 Pi 层直接依赖队列数据库。
- 由成功任务查询记录本次所见 ID／revision；工具绑定当前作业，检查版本与取消。新建建议要求本次成功查询过任务；仅启用它的 preprocess Profile 注册，不赋予模型创建任务能力。
- 调整 config 允许工具目录、相关 Profile 校验和示例，保持旧配置有效；补一句通用任务判断目标，不追加样例答案或固定的新建触发关键词。
- 利用 finishJob 成功核验使关联有效，失败／取消／中断不发布；不增新 Run 状态、二次分类请求或 prepare/commit 工具。
- 验证：原生 Pi 确定性提供方覆盖工具漏调用、暂不归口、新建建议、错误 ID、任务改版、重复调用、工具后中断与正常结果投递；没有匹配不自动生成新建建议。

## P3 人工建任务、查询与接续

- 提供任务关联列表／详情／下载及人员纠正 API，前端和工具共用 P1 服务。
- 新增从建议“创建公共任务并关联”的接口；复用 AccessStore 校验，抽出事务内写入，统一保存 TaskSpace、task_actions、人工 include 和 job 创建回执。来源纳入幂等参数；按同一建议复用已建结果，普通创建接口保持兼容。
- 覆盖事务回滚、响应丢失后的查询／重试及两人同时创建同一建议；只确认创建元数据，不创建目录、调用模型或修改投递。
- 席位主 Agent 增加 task_information_list/read，复用当前身份和任务；不增加子 Agent 或自动服务历史读取权限。
- `background/service.ts` 将 analyse 的来源授权和后续准备分开，支持 inbox 与 task_information；BackgroundAction / seat_analysis 新 origin 保持旧记录兼容，领取执行时再校验。
- 复用现有文件副本、导入计划、取消、幂等和原生会话；analysis-options 改为未建工作区时可读取默认受控能力，不为浏览创建目录。
- 验证：只读无副作用、精确版本、附件作用域、幂等不重复制、两个任务／席位文件隔离、前台仅明确发送操作启动模型、查询与重开不重发、后台显式确认及旧收件路径。

## P4 现有工作台接入

- 新建任务“相关信息”内容视图；在 `WorkspaceNavigation` 任务操作和 `TaskPanel` 增加入口，`main.tsx` 加深链接及视图切换，保留聊天挂载。
- 抽取可复用的分析详情／接续表单，避免复制 Inbox 中整套异步准备逻辑。
- Inbox 展示关联任务及优先候选；单关联可预选、多关联不随意选第一个；手动选择不隐式改关联。
- Inbox / InformationCenter 展示对应作业的任务判断，明确未记录、暂不归口、建议新建、历史版本；新建复用 TaskPanel 表单，预填名称与目标，展示公共可见范围，确认后返回新任务入口。
- 验证：建议查看与创建权限、改选已有任务、未采纳不阻塞投递、创建失败保留输入、空态、查询失败恢复、编辑冲突保留、切换任务／身份的迟到响应隔离及前台回复不中断。

## P5 回归与真实能力验证

在 `experiments/harness-lab` 执行 typecheck、lint／边界、Vitest、build、桌面 Playwright。本机测试按单 worker 顺序执行，避免上一轮已观察的资源争抢和 artifact 清理竞争；失败需定位，不修改断言来迎合结果。

```sh
npm run typecheck
npm run lint
npm test -- --maxWorkers=1
npm run build
npm run test:e2e -- --workers=1 --output=/tmp/axon-task-linking-e2e
```

新增测试建议：task-links.test.ts、task-information.test.ts、tests/e2e/task-information.spec.ts；回归 context-background、task-context、access、background、information 和现有会话／文件／交接测试。

复用上期独立 HTTP 模拟服务与隔离数据，以真实模型验证两个相关公共任务、无关任务、完全无关信息和任务条件改变；加入“需要独立办理且无任务承接”“已有任务可承接”“无匹配但仅供参考”三类新建建议对照场景。保存实际判断调用、依据及错误；不提供期望关联 ID 或新建结论，不改写结果，不因自动测试通过就宣称判断质量通过。工程与语义验收分别记录。

## 交付与发布顺序

完成代码及验证 → 用户查看本机／隔离结果 → 按授权中文提交 → 备份并更新线上 → 用户验收。此次设计不授权发布、重处理现有消息或创建线上测试数据。

主要风险点：共享数据库版本检查、任务／来源权限组合、finishJob 与原生结果核验、Inbox 的 action 重试与迟到导航。迁移前保留可恢复备份；历史任务、会话和消息不要求迁移重写。

用户验收期间追加的接续界面优化按 [continuation-ui.md](research/continuation-ui.md) 实施并回归，变更不包含线上发布。
