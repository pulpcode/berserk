# 规划依据与调研结论

日期：2026-10-14。只读调研，无产品修改、无模型调用。

本文件前半部分为第一阶段实施前的事实和当时批准结论，已随 `e9a01b4` 保存；本次新增的恢复机制调研见末节。旧批准不表示当前修订已批准实施。

## 本地事实

1. `src/pi/annotation-tools.ts` 的 from_source/schema 让模型传 expectedRevision 和 expectedSourceRevision；其余 apply 也暴露草稿 CAS。`src/annotations/service.ts` 真实拒绝旧 head，不能为了工具成功而去掉。
2. `src/pi/lab.ts` 每请求重新 openSession，工具闭包已有作用域；observedTasks 是按真实查询更新的小型请求内 Map，表明本地已有同类有限观察机制。本设计不会把它扩展成全局缓存。
3. 安装的 Pi 0.85.1 公开 beforeToolCall/afterToolCall context 含 assistantMessage、toolCall、args、context/result；现有代码已经组合原 hooks。可以识别同一模型输出含多个写入。尚须假 provider 集成测试证明结果可见性与重试/压缩时序，不能仅依赖事件名称推断。
4. 自动 annotationContext 只有 set/revision/base/writable；没有完整领域讲解。自定义案例的实际 annotation_read 已返回 discussion 层，因此不能称该错误只是“数据没传给模型”。
5. `src/resources/service.ts` 只注册 synthesis/review；`src/workspaces/store.ts` 对磁盘 skillIds 严格等于这两个；`src/pi/composer-input.ts:18` 只允许两个 Skill ID；`src/pi/history-evidence.ts:26` 只接受最多两个。新增方法必须覆盖快照、显式选择、历史重开和旧数据兼容。
6. MapContext 已有 EvidenceMapLinks 和 AnnotationHistoryLinks；ChatMessage 在来源工具/用户消息提供入口，assistant 正文主要靠 Markdown MapLink。可以扩展现有结果呈现，不需要新建“引用服务”。
7. `src/web/situation/evidence.ts` 只接受有实际查询证据的 href。来源打开会查询当前态势；固定标注则走 AnnotationSelection。二者时态不同，不能共用“历史地图已恢复”措辞。
8. annotation_actions 已有 actor/actionId/task/session/digest/data；不需要新操作表。省去模型机械字段后，要分离原始意图摘要与实际注入的 CAS 条件，并在同一回执留存实际依据。

以上源码相对 `experiments/harness-lab/`。真实模型私有证据：`.local/source-annotations-e2e/2026-10-14/`，保留上轮所有失败。

## 官方资料（本会话已检索并打开）

- [OpenAI Function calling](https://developers.openai.com/api/docs/guides/function-calling)：程序已知参数不必让模型填写，确定性工作交给代码。该原则不等于无条件使用最新业务状态。
- [Codex Prompting Guide](https://developers.openai.com/cookbook/examples/gpt-5/codex_prompting_guide) 与 [Apply Patch](https://developers.openai.com/api/docs/guides/tools-apply-patch)：模型表达补丁，执行器处理落地和冲突，错误返回后重新读取/调整。
- [Anthropic Text editor tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/text-editor-tool)：str_replace 使用精确且唯一的 old_str。公开 API 文档不等于 Claude Code 全部内部实现；这里只借鉴编辑依据与执行分工，不宣称完整并发保证。
- [Codex Skills](https://learn.chatgpt.com/docs/build-skills)、[Claude Code Skills](https://code.claude.com/docs/en/skills)：简介发现、按需加载正文；领域概念与工作方法适合 Skill，权限与事务仍由宿主保证。

## 设计推论与未证实假设

- 修订衔接失败已由真实参数证实；省去机械字段并支持批量可减少这类易错点，但不能预先宣称模型再无调用错误。
- 图层知识分散是事实；它是否导致上轮单次选错层，要通过统一接口下的 Skill 有无对照验证。
- 正文链接模板可能诱发 href=，尚无因果对照；确定性结果入口能独立消除“必须依赖手写 URL 才能打开”的障碍。
- 本期不加入对象级合并/永久编辑 token：这些不是解决当前已观察问题的必要前提。

## 固定源码快照审阅与已批准调整

用户提供 https://github.com/pulpcode/claude-code ，检查提交 4b9d30f7953273e567a18eb819f4eddd45fcc877（第三方镜像，自称 2026-03-31 暴露快照，不能代表当前正式版）。仅静态阅读，未执行或复制源码到产品。

- src/utils/fileStateCache.ts：有界 readFileState；FileReadTool 写入，FileEditTool 校验已读/变更，并在成功后立即更新。
- src/services/tools/toolOrchestration.ts：非并发安全调用逐个执行，共享上下文。
- src/screens/REPL.tsx、QueryEngine.ts：跨轮状态及历史恢复；services/compact/compact.ts 清理并重新读取部分文件。
- 据此取消原先同输出多写入全部拒绝及成功回执必须下一次推理才推进机械条件的规则。仍区分新读取可见性与本链成功提交；保留请求内作用域、数据库 CAS、失败后停止、发布明确版本，不引入会话缓存或文件时间戳检查。
- 用户随后明确“参照设计，然后动工”，本次实施已获授权。

## 恢复机制修订参考（2026-10-14，待审方案）

### 本地问题与现有能力

基线 `e9a01b4` 中 `src/pi/annotation-state.ts:27` 的 invalidate 同时清除 draft、sources、current 及 pending，并设置 blocked。`annotation-tools.ts:73` 通用 catch 调用它，`lab.ts:845,1129,1142` 的结果钩子、工具结束和补充输入也调用它。`validation.md` §4 的 main-3 记录了 4 次 ANNOTATION_READ_REQUIRED 与 4 次 SOURCE_READ_REQUIRED；它们不是来源持续变化引起的 8 个独立冲突。

`src/annotations/service.ts:312,403,428` 已检查空草稿、绑定基线和提交时唯一性，`mutation` 已提供事务及动作回执。取消模型 empty 预读仍需保留这些服务端检查，不必引入新存储或锁系统。创建成功后的状态推进也必须同步调整，不能仍要求先存在 EmptyBasis。

### 固定快照的实际行为

仍仅静态阅读用户提供的第三方仓库，固定提交 `4b9d30f7953273e567a18eb819f4eddd45fcc877`；以下不代表当前官方 Claude Code，也未执行或复制其源码。链接以该提交为准：

| 观察 | 证据 |
| --- | --- |
| 读取缓存按规范化文件路径保存内容、时间和读取范围，有容量限制 | [fileStateCache.ts](https://github.com/pulpcode/claude-code/blob/4b9d30f7953273e567a18eb819f4eddd45fcc877/src/utils/fileStateCache.ts#L4) |
| Read 文本后更新该路径记录 | [FileReadTool.ts:1032](https://github.com/pulpcode/claude-code/blob/4b9d30f7953273e567a18eb819f4eddd45fcc877/src/tools/FileReadTool/FileReadTool.ts#L1032) |
| Edit 检查是否读过、修改时间及特定条件下的内容一致性；失败返回具体原因，这些分支没有删除目标/其他读取记录 | [FileEditTool.ts:275](https://github.com/pulpcode/claude-code/blob/4b9d30f7953273e567a18eb819f4eddd45fcc877/src/tools/FileEditTool/FileEditTool.ts#L275) |
| Edit 真正写入前再次检查，成功后只更新该文件记录 | [FileEditTool.ts:453](https://github.com/pulpcode/claude-code/blob/4b9d30f7953273e567a18eb819f4eddd45fcc877/src/tools/FileEditTool/FileEditTool.ts#L453)、[FileEditTool.ts:520](https://github.com/pulpcode/claude-code/blob/4b9d30f7953273e567a18eb819f4eddd45fcc877/src/tools/FileEditTool/FileEditTool.ts#L520) |
| Write 同时支持创建与覆盖：不存在时可通过前置检查，已存在则检查读取记录；实际写入前再次核对 | [FileWriteTool.ts:185](https://github.com/pulpcode/claude-code/blob/4b9d30f7953273e567a18eb819f4eddd45fcc877/src/tools/FileWriteTool/FileWriteTool.ts#L185)、[FileWriteTool.ts:266](https://github.com/pulpcode/claude-code/blob/4b9d30f7953273e567a18eb819f4eddd45fcc877/src/tools/FileWriteTool/FileWriteTool.ts#L266) |
| Edit 的实现也包含 old_string 为空且文件不存在时的创建分支，因此不能只靠工具名字区分创建/修改 | [FileEditTool.ts:223](https://github.com/pulpcode/claude-code/blob/4b9d30f7953273e567a18eb819f4eddd45fcc877/src/tools/FileEditTool/FileEditTool.ts#L223) |
| 已检查的通用执行异常路径返回 is_error，不包含读取缓存的全量清空 | [toolExecution.ts:1589](https://github.com/pulpcode/claude-code/blob/4b9d30f7953273e567a18eb819f4eddd45fcc877/src/services/tools/toolExecution.ts#L1589) |
| 上下文压缩另行保存并清空读取缓存，再恢复部分最近文件内容；这是生命周期处理 | [compact.ts:517](https://github.com/pulpcode/claude-code/blob/4b9d30f7953273e567a18eb819f4eddd45fcc877/src/services/compact/compact.ts#L517)、[compact.ts:1400](https://github.com/pulpcode/claude-code/blob/4b9d30f7953273e567a18eb819f4eddd45fcc877/src/services/compact/compact.ts#L1400) |

“保留过期记录”不等于允许过期写入：上述 Edit 路径每次核对，旧记录未更新时会继续报过期。检查到的局部路径不足以证明整个产品永远不会清空状态，也不把文件时间戳检查称为数据库事务级保证。

### 迁移到地图的设计判断

借鉴的是按资源记录、真实写前核对、成功更新、创建与覆盖区别、错误具体可恢复。用草稿修订和来源修订替代文件时间戳，不复制其文件系统实现。

以下是本项目的适配决策：整份草稿 CAS、按完整来源对象标识维护依据、请求内作用域、同输出失败暂停但保留记录、固定发布/采用语义、来源网络查询后再事务提交。不声称这些规则在 Claude Code 中已有完全相同实现。

继续请求内状态是最小范围取舍：目前没有必要为修复失败循环新增跨请求缓存、历史扫描或持久化恢复；普通补充输入不清空记录。压缩后本期保守重读，不照搬自动回填文件流程。

不能因接口易用性改进就推断模型能可靠理解所有几何、图层意图和正文事实；这些仍以独立语义验收为准。

### 方案阶段授权边界（历史）

用户最新要求为“提交 git，然后修改方案文件，待审阅后再开动”。基线提交已完成，本次仅更新规划与任务审阅状态，没有修改产品代码、运行模型或部署；须获得对最新修订的后续明确批准才实施。

2026-10-14 后续：用户明确批准“按这个方案开始实施，完成后用原来的场景复测”。本轮已完成实施与复测，见 recovery-validation.md；未新增 Git 提交或部署。
