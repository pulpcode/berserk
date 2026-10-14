# 规划依据与调研结论

日期：2026-10-14。只读调研，无产品修改、无模型调用。

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
